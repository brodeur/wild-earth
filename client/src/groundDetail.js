import * as THREE from 'three';
import { runSliced, drain } from './slice.js';
import { rockKeep } from './tilepackage.js';
import { releaseTexture } from './gpuRelease.js';

// Near-ground detail for the terrain shader (terrain.js): five tileable CC0 surfaces (albedo +
// tangent-space normal, client/assets/ground/, see ATTRIBUTION.md) and one per-tile mask texture
// the shader turns into per-pixel material weights. The aerial photo stays the colour; the detail
// only modulates it (albedo stored divided by its own mean, so mid-grey = "photo unchanged") and
// bends the sun term with its normals, inside 250 m of the camera.
//
// Mask texture (1000 px over the tile, 10 m texels, RGBA8, row 0 = south edge like the terrain uv):
//   R  slope, degrees / 90 (from tile.heights, central differences over 5 m)
//   G  curvature, 0.5 + 0.5 * clamp(-laplacian / 0.05): > 0.5 convex (ridge, spur), < 0.5 concave
//      (swale, channel). Laplacian over 10 m on the DEM, then a 3x3 blur.
//   B  bare: the photo's own "bright and desaturated" look (dirt, rock, scree), raised to >= 0.8
//      on the barren habitat class and toward 0.92 where the outcrop likelihood (tile.outcrop)
//      passes ~0.5, blurred so the 30 m habitat cells do not show as squares.
//   A  the cliff pattern (CLIFF_PATTERN, from tile.geology's rock class at the texel's 30 m cell) x 85, read by the
//      terrain shader's cliff material (2026-11-02). It held the road weight before, which nothing read: the shader
//      uses the sharper 5 m roads texture, and detailWeightsAt reads tile.roads.
// Habitat weights (grassland / oak / chaparral) and tree cover come from tile.masks and tile.canopy,
// which the terrain shader samples anyway. The mask's bytes are kept on the CPU (mask.data, 4 MB) for
// detailWeightsAt, the shader's material rule run in JS at a point: terrain.js's micro patch reads it to
// choose its relief (rock ridges, gravel, tussocks, litter, nothing on pavement) to match the texture drawn.
//
// Third octave (2026-10-28): inside the micro patch under the body (terrain.js MicroPatch), the top material
// is fetched again at a tenth of its repeat (0.2 m; the rock 0.3 m), turned DETAIL_TURN3 further, and
// multiplied into the 2 m octave's albedo ratio, its tangent normal added to the 2 m octave's (rotated back
// to the projection plane first). The second material's own copy cost a third more for a border's worth. From a lizard's eye 9 cm up the 2 m scans' texels are 2 mm and blur;
// the tenth-scale copy puts stems in the thatch and grain in the rock. It fades with camera distance over
// detailOct3.x .. y (35% .. 50% of the patch's side: 1.4-1.9 m for a lizard, 8-12 m for a deer) and, like the
// 2 m octave, once one repeat spans fewer than ~40 pixels. Its coordinates are taken from vRel, the
// position less detailOrigin (a point near the patch, moved with it), plus a per-material, per-plane
// offset made here in double precision (setDetailOrigin): at 5 repeats a metre a world coordinate of
// 5000 m in float32 steps 2 texels at a time, which shows as blocks from 5 cm.

export const DETAIL_SLOTS = [
  // name,      metres per repeat, UV rotation (rad), normal strength, albedo contrast
  { name: 'thatch',   size: 2.0, angle: 0.35, normal: 1.0,  albedo: 0.85 },   // dry grass thatch
  { name: 'litter',   size: 2.0, angle: 1.20, normal: 1.0,  albedo: 0.9 },    // oak duff / leaf litter
  { name: 'gravel',   size: 2.0, angle: 2.05, normal: 1.1,  albedo: 0.9 },    // gravelly dirt
  { name: 'rock',     size: 3.0, angle: 2.75, normal: 1.25, albedo: 0.9 },    // cobbles and rock
  { name: 'pavement', size: 2.0, angle: 0.60, normal: 0.8,  albedo: 0.8 },    // worn pavement
  // The cliff layers (2026-11-02, made here: cliffLayerSteps), read by the terrain shader's cliff material (terrain.js
  // cliffShade) through its own hex-tiled fetch, never by the top-down material rule: a sheeted granite wall (joints in
  // two near-vertical sets and diagonal dihedrals, sheet edges as steps) and a slaty bank (thin beds dipping 27 degrees,
  // cross joints). size is the repeat the generator lays its joints over; the shader chooses the repeat it draws them at.
  { name: 'sheeted',  size: 4.0, angle: 0.0,  normal: 2.0,  albedo: 1.0, proc: 'sheeted' },
  { name: 'bedded',   size: 2.5, angle: 0.0,  normal: 1.2,  albedo: 1.0, proc: 'bedded' },
];
export const CLIFF_LAYER = { sheeted: 5, bedded: 6 };   // their slots
// The cliff pattern of a rock class (tile-spec "Geology and soils"; rocks.js LOOK has the classes' colours): 0 plain
// grey rock (no geology, or a cut in alluvium), 1 sheeted granite, 2 bedded slate and schist, 3 blocky greenstone and
// volcanic rock. The mask's A channel carries it as pattern x 85, so a bilinear read between two texels rounds to one
// of the two (four codes equally spaced).
export const CLIFF_PATTERN = { granitic: 1, limestone_marble: 1, slate_phyllite: 2, schist: 2, sandstone_conglomerate: 2, greenstone_metavolcanic: 3, serpentinite: 3, volcanic: 3, other: 3, alluvium: 0 };
export const DETAIL_PX = 1024, MASK_PX = 1000;
const ASSET_VERSION = 2;   // bump when a file in client/assets/ground/ is replaced (browser caches)

const blank = () => { const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); t.needsUpdate = true; return t; };
const blankArray = () => { const t = new THREE.DataArrayTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, 1); t.needsUpdate = true; return t; };

// Shared uniform objects (the terrain material spreads these in, so one assignment reaches it).
export const detailUniforms = {
  detailAlbedo: { value: blankArray() }, detailNormal: { value: blankArray() }, detailMask: { value: blank() },
  detailReady: { value: 0 },   // 1 once the textures are uploaded
  detailOn: { value: 1 },      // 0 turns the whole near-detail layer off (A/B; window.__we.terrain.detail.set(false))
  // per slot: x = 1 / metres per repeat, y = cos(angle), z = sin(angle), w = normal strength
  detailParams: { value: DETAIL_SLOTS.map(s => new THREE.Vector4(1 / s.size, Math.cos(s.angle), Math.sin(s.angle), s.normal)) },
  detailContrast: { value: DETAIL_SLOTS.map(s => s.albedo) },
  // Third octave: x, y the camera distances it fades over (m), z 1 on / 0 off, w unused. terrain.js sets it with the
  // body scale; off while there is no micro patch.
  detailOct3: { value: new THREE.Vector4(0, 0, 0, 0) },
  // per slot: the third octave's metres -> repeats matrix, row-major (m00, m01, m10, m11): the slot's turn plus
  // DETAIL_TURN3, at OCT3_RATIO of its repeat
  detailM3: { value: DETAIL_SLOTS.map(() => new THREE.Vector4()) },
  // per slot and projection plane (slot * 3 + axis): the fractional repeat at detailOrigin, so vRel's repeats line up
  detailOff3: { value: DETAIL_SLOTS.flatMap(() => [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()]) },
  detailOrigin: { value: new THREE.Vector3() },
};
export const DETAIL_TURN3 = 1.9, OCT3_RATIO = 0.1;
for (let m = 0; m < DETAIL_SLOTS.length; m++) {
  const sl = DETAIL_SLOTS[m], a = sl.angle + DETAIL_TURN3, k = 1 / (sl.size * OCT3_RATIO);
  detailUniforms.detailM3.value[m].set(Math.cos(a) * k, -Math.sin(a) * k, Math.sin(a) * k, Math.cos(a) * k);
}
// Moves the third octave's origin (terrain.js, when the micro patch moves): o is world (x, y, z). The offsets are made
// from the float32 matrix the shader holds, in double, so the octave is continuous across a move.
export function setDetailOrigin(x, y, z) {
  const U = detailUniforms; U.detailOrigin.value.set(x, y, z);
  const o = U.detailOrigin.value, P = [[o.z, o.y], [o.x, o.z], [o.x, o.y]], f = Math.fround, fr = v => v - Math.floor(v);
  for (let m = 0; m < DETAIL_SLOTS.length; m++) {
    const M = U.detailM3.value[m], a = f(M.x), b = f(M.y), c = f(M.z), d = f(M.w);
    for (let ax = 0; ax < 3; ax++) { const [u, v] = P[ax]; U.detailOff3.value[m * 3 + ax].set(fr(a * u + b * v), fr(c * u + d * v)); }
  }
}

// Back to the blanks the page started with (terrain.js dispose: a world torn down lets go of its detail textures).
const blanks = { detailAlbedo: detailUniforms.detailAlbedo.value, detailNormal: detailUniforms.detailNormal.value, detailMask: detailUniforms.detailMask.value };
export function resetDetailUniforms() { detailUniforms.detailAlbedo.value = blanks.detailAlbedo; detailUniforms.detailNormal.value = blanks.detailNormal; detailUniforms.detailMask.value = blanks.detailMask; detailUniforms.detailReady.value = 0; detailUniforms.detailOct3.value.z = 0; }

function smooth(e0, e1, x) { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); }

// 3x3 box blur of one channel of an RGBA8 buffer, in place (two passes are close to a small gaussian).
function* blur(data, W, ch, passes = 1) {
  const tmp = new Float32Array(W * W);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      if (i === 0 && (j & 127) === 0) yield;
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= W) continue;
        for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= W) continue; s += data[(jj * W + ii) * 4 + ch]; n++; } }
      tmp[j * W + i] = s / n;
    }
    for (let k = 0; k < W * W; k++) data[k * 4 + ch] = Math.round(tmp[k]);
  }
}

// Photo pixels on the mask grid (canvas downscale, rows north to south as the image).
function photoPixels(image, W) {
  if (!image) return null;
  const c = document.createElement('canvas'); c.width = c.height = W;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, W, W);   // the element, not tilepackage's bitmap: a scaled draw of the element differs (Chrome decodes a JPEG at scale)
  return ctx.getImageData(0, 0, W, W).data;
}

// Bilinear read of channel 0 of a Grid8 (tilepackage.js) at a point, 0..1, cell centres at (i + 0.5) * res.
function bilinear8(g, x, north) {
  const W = g.img.width, H = g.img.height, fx = x / g.res - 0.5, fy = (g.size - north) / g.res - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const v = (i, j) => g.channel(Math.min(Math.max(i, 0), W - 1), Math.min(Math.max(j, 0), H - 1), 0);
  return ((v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty) / 255;
}

// The terrain shader's value noise in JS (terrain.js FRAG hash / vnoise / rnoise): the same integer hash, the same
// rotated lattice, for the ragged material borders detailWeightsAt reproduces.
function fragHash(i, j) {
  let h = (Math.imul(i + 65536, 1597334677) ^ Math.imul(j + 65536, 3812015801 | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519 | 0) >>> 0; h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}
export function fragRnoise(px, py, a, scale) {
  const c = Math.cos(a), s = Math.sin(a), u = (c * px - s * py) / scale, v = (s * px + c * py) / scale;
  const i = Math.floor(u), j = Math.floor(v); let fx = u - i, fy = v - j;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a0 = fragHash(i, j), a1 = fragHash(i + 1, j), b0 = fragHash(i, j + 1), b1 = fragHash(i + 1, j + 1);
  return (a0 + (a1 - a0) * fx) * (1 - fy) + (b0 + (b1 - b0) * fx) * fy;
}
// Channel ch of a Grid8 bilinear between its pixel centres (as a linear-filtered texture of it), 0..1.
function bilinearCh(g, x, north, ch) {
  const W = g.img.width, H = g.img.height, fx = x / g.res - 0.5, fy = (g.size - north) / g.res - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const v = (i, j) => g.channel(Math.min(Math.max(i, 0), W - 1), Math.min(Math.max(j, 0), H - 1), ch);
  return ((v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty) / 255;
}
// The habitat classes' soft weights at a point: masks.png is the class one-hots on the 30 m habitat grid resampled
// bilinearly (pipeline derive.py), so the same bilinear on tile.habitat gives the weights the shader reads.
function classWeight(tile, x, north, cls) {
  const g = tile.habitat, W = g.img.width, H = g.img.height, fx = x / g.res - 0.5, fy = (g.size - north) / g.res - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const v = (i, j) => g.channel(Math.min(Math.max(i, 0), W - 1), Math.min(Math.max(j, 0), H - 1), 0) === cls ? 1 : 0;
  return (v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty;
}
// The terrain shader's near-detail material rule (terrain.js FRAG, the wt[] block) at a point, in JS: the weights of
// thatch, litter, gravel, rock and pavement before the shader keeps its top two. mask: buildDetailMask's result (its
// data, rows south first); slopeDeg: the drawn surface's own slope where the tile has the lidar residual (the shader's
// geoSlope), else 0. bareK scales the photo's bare reading and thatchAdd raises the thatch (terrain.js passes the lidar
// micro raster's intensity and low-vegetation share there; 1 and 0 reproduce the shader). out: a 5-array, returned.
// Also out.tree (cover 0..1) and out.water (0..1, habitat water) for the caller.
export function detailWeightsAt(tile, mask, x, north, slopeDeg = 0, bareK = 1, thatchAdd = 0, out = [0, 0, 0, 0, 0]) {
  const W = mask.width, D = mask.data, fx = x / tile.size * W - 0.5, fy = north / tile.size * W - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const m = ch => {
    const v = (i, j) => D[(Math.min(Math.max(j, 0), W - 1) * W + Math.min(Math.max(i, 0), W - 1)) * 4 + ch];
    return ((v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty) / 255;
  };
  const road = tile.roadsImage && tile.roads ? bilinearCh(tile.roads, x, north, 0) : 0, keep = 1 - smooth(0.55, 0.75, road);
  const wG = classWeight(tile, x, north, 5) * keep, wO = classWeight(tile, x, north, 1) * keep, wC = classWeight(tile, x, north, 4) * keep;
  const tree = Math.min(Math.max(bilinearCh(tile.canopy, x, north, 0) * 2.55, 0), 1);
  const slope = Math.max(m(0) * 90, slopeDeg), curv = m(1) * 2 - 1, bare = Math.min(m(2) * bareK, 1);
  const bn = fragRnoise(x + 11, -north + 11, 0.8, 3.1) - 0.5;
  const rock = Math.max(smooth(24, 32, slope), smooth(0.35, 0.7, -curv), smooth(0.7, 0.9, bare));
  const pave = smooth(0.42, 0.68, road + 0.22 * bn + 0.18 * (fragRnoise(x + 3.3, -north + 3.3, 2.4, 0.9) - 0.5));
  out[0] = Math.min(wG * (1 - 0.8 * tree) + thatchAdd, 1);
  out[1] = Math.min(Math.max(Math.max(tree * 1.5, wO * 0.5), 0), 1);
  out[2] = Math.min(Math.max(0.06 + 0.7 * wC + smooth(0.25, 0.6, bare) + 0.8 * smooth(0.15, 0.5, curv), 0), 1);
  out[3] = rock;
  for (let i = 0; i < 3; i++) out[i] *= (1 - 0.8 * rock) * Math.max(1 + (i < 2 ? -bn : bn) * 0.8, 0);
  out[3] *= Math.max(1 + bn * 0.6, 0);
  for (let i = 0; i < 4; i++) out[i] *= 1 - pave;
  out[4] = pave;
  out.tree = tree; out.water = classWeight(tile, x, north, 7);
  return out;
}

// The world build steps buildDetailMaskSteps (slice.js runSliced, terrain.js) so the opening screen keeps responding;
// buildDetailMask runs it in one go. The same mask.
export function buildDetailMask(tile, W = MASK_PX) { return drain(buildDetailMaskSteps(tile, W)); }
export function* buildDetailMaskSteps(tile, W = MASK_PX) {
  const t0 = performance.now(), size = tile.size, res = size / W, h = tile.heights;
  const out = new Uint8Array(W * W * 4);
  const photo = photoPixels(tile.imageryTextureImage || tile.textureImage, W);
  const BARREN = 8, geo = tile.geology || null, classes = tile.groundClasses?.rock_classes || Object.keys(CLIFF_PATTERN);
  // Height at DEM sample (column c, row r from the north edge), clamped. Samples are pixel centres
  // (x = (c + 0.5) res), so when the DEM is twice the mask's resolution each 10 m texel centre sits at
  // the middle of a 2 x 2 block of samples: Zm(c, r) is the mean of the block whose north-west sample
  // is (c, r), and the central differences below step whole samples from there instead of interpolating.
  const exact = h.w === 2 * W && h.h === 2 * W;
  const Z = (c, r) => h.z[Math.min(Math.max(r, 0), h.h - 1) * h.w + Math.min(Math.max(c, 0), h.w - 1)];
  const Zm = (c, r) => 0.25 * (Z(c, r) + Z(c + 1, r) + Z(c, r + 1) + Z(c + 1, r + 1));
  yield;
  for (let j = 0; j < W; j++) {
    if ((j & 31) === 0) yield;
    const north = (j + 0.5) * res, prow = (W - 1 - j) * W;   // photo rows run north to south
    const r0 = h.h - 2 - 2 * j;                              // DEM row just north of this texel's centre (exact case)
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * res, k = (j * W + i) * 4, c0 = 2 * i;
      // slope from the 5 m DEM (central differences over +-5 m) and the laplacian over 10 m
      let gx, gn, lap;
      if (exact) {
        gx = (Zm(c0 + 1, r0) - Zm(c0 - 1, r0)) / (2 * h.res); gn = (Zm(c0, r0 - 1) - Zm(c0, r0 + 1)) / (2 * h.res);
        lap = (Zm(c0 + 2, r0) + Zm(c0 - 2, r0) + Zm(c0, r0 - 2) + Zm(c0, r0 + 2) - 4 * Zm(c0, r0)) / (4 * h.res * h.res);
      } else {
        const e = 5, d = 10, z = h.base(x, north);
        gx = (h.base(x + e, north) - h.base(x - e, north)) / (2 * e); gn = (h.base(x, north + e) - h.base(x, north - e)) / (2 * e);
        lap = (h.base(x + d, north) + h.base(x - d, north) + h.base(x, north + d) + h.base(x, north - d) - 4 * z) / (d * d);
      }
      const slope = Math.atan(Math.hypot(gx, gn)) * 180 / Math.PI;
      const curv = Math.min(Math.max(-lap / 0.05, -1), 1);   // negative laplacian = convex
      // bare: desaturated and not dark (dirt, rock, scree), or very bright and only mildly saturated
      let bare = 0;
      if (photo) {
        const p = (prow + i) * 4, r = photo[p] / 255, g = photo[p + 1] / 255, b = photo[p + 2] / 255;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b, mx = Math.max(r, g, b), sat = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
        bare = Math.max(smooth(0.30, 0.42, lum) * (1 - smooth(0.08, 0.17, sat)), smooth(0.56, 0.66, lum) * (1 - smooth(0.18, 0.3, sat)));
      }
      if (tile.habitat && tile.habitat.at(x, north) === BARREN) bare = Math.max(bare, 0.85);
      // Outcrop clusters (rocks.js places them where the likelihood passes ~0.45): bare ground
      // around the fins, so the shader's rock rule (bare > 0.7) wins there, in the same strips along
      // the strike that open the vegetation (tilepackage rockKeep: 0.92 on a strip, ~0.38 between,
      // which the gravel rule takes). The blur below softens the edge further.
      if (tile.outcrop) bare = Math.max(bare, 0.92 * (1 - rockKeep(tile, x, north)) / 0.85);
      // the cliff pattern of the rock class at this texel's geology cell (CLIFF_PATTERN; 0 without the geology layer)
      let pat = 0;
      if (geo) { const ci = geo.channel(Math.min(Math.floor(x / geo.res), geo.img.width - 1), Math.min(Math.floor((size - north) / geo.res), geo.img.height - 1), 1); pat = ci ? (CLIFF_PATTERN[classes[ci - 1]] ?? 3) : 0; }
      out[k] = Math.round(Math.min(slope / 90, 1) * 255);
      out[k + 1] = Math.round((0.5 + 0.5 * curv) * 255);
      out[k + 2] = Math.round(bare * 255);
      out[k + 3] = pat * 85;
    }
  }
  yield* blur(out, W, 1, 1);   // curvature: one 3x3 pass (a 30 m footprint)
  yield* blur(out, W, 2, 2);   // bare: soften the 30 m habitat squares and single-pixel photo noise
  const tex = new THREE.DataTexture(out, W, W, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  releaseTexture(tex);   // three's copy goes once uploaded (gpuRelease.js); data below keeps the bytes for detailWeightsAt
  return { texture: tex, width: W, data: out, ms: Math.round(performance.now() - t0) };
}

// Decoded off the main thread into an ImageBitmap (createImageBitmap on the bytes), so pixelsOf's drawImage copies
// instead of decoding inside its task; the same pixels as the image element it replaced.
async function loadImage(url, signal = null) {
  const r = await fetch(url, { signal }).catch(e => { if (signal?.aborted) throw e; return null; });
  if (!r?.ok) throw new Error('ground detail image failed: ' + url);
  return createImageBitmap(await r.blob()).catch(() => { throw new Error('ground detail image failed: ' + url); });
}

// Pixels of one image at DETAIL_PX, rows flipped so row 0 is the image's bottom (OpenGL v = 0):
// the normal maps' +G then points along +v, as their OpenGL convention expects.
function pixelsOf(img) {
  const c = document.createElement('canvas'); c.width = c.height = DETAIL_PX;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.translate(0, DETAIL_PX); ctx.scale(1, -1); ctx.drawImage(img, 0, 0, DETAIL_PX, DETAIL_PX);
  img.close?.();
  return ctx.getImageData(0, 0, DETAIL_PX, DETAIL_PX).data;
}

// Procedural stand-in when a texture is missing: fbm albedo and a normal derived from it.
function proceduralPixels(seed, kind) {
  const N = DETAIL_PX, a = new Uint8ClampedArray(N * N * 4), n = new Uint8ClampedArray(N * N * 4), hgt = new Float32Array(N * N);
  const hash = (x, y) => { let q = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0; q = (q ^ (q >>> 13)) * 1274126177; return ((q ^ (q >>> 16)) >>> 0) / 4294967296; };
  const vn = (x, y, p) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = i => ((i % p) + p) % p;
    const h00 = hash(w(xi), w(yi)), h10 = hash(w(xi + 1), w(yi)), h01 = hash(w(xi), w(yi + 1)), h11 = hash(w(xi + 1), w(yi + 1));
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0, amp = 0.5, f = 8;
    for (let o = 0; o < 6; o++) { s += amp * vn(x / N * f, y / N * f, f); amp *= 0.5; f *= 2; }
    hgt[y * N + x] = s;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x, v = hgt[k], dx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N], dy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
    const g = 128 + (v - 0.5) * (kind === 'rock' ? 300 : 200);
    a[k * 4] = g; a[k * 4 + 1] = g; a[k * 4 + 2] = g; a[k * 4 + 3] = 255;
    const sx = -dx * 12, sy = -dy * 12, l = Math.hypot(sx, sy, 1);
    n[k * 4] = 128 + 127 * sx / l; n[k * 4 + 1] = 128 + 127 * sy / l; n[k * 4 + 2] = 128 + 127 / l; n[k * 4 + 3] = 255;
  }
  return { albedo: a, normal: n };
}

// ---- the cliff layers (2026-11-02) -------------------------------------------------------------------------------
// Made rather than scanned: no CC0 scan of a sheeted granite wall or a slaty bank was to hand, and a made one is
// tileable, has crisp joints at a known scale, and carries the step at every sheet edge in its normal map, so the light
// catches the edges. A height field in metres on a torus of DETAIL_PX texels over the slot's repeat (texels of 4 mm
// at 4 m), grain plus carved lines: a crack is a V of the line's width and depth with a stained halo three times as
// wide; a step (a sheet edge, a bed) drops the surface below the line by its height within 2 cm and lets it rise back
// over 25 cm, so the edge is crisp and the sheet below faces a little down. A line is iterated along its long axis (a
// row at a time within 45 degrees of vertical, a column at a time otherwise) and carved across it, which is exact for a
// straight line and close for the wander (a tileable noise) every line carries. The albedo is the array's ratio form
// (128 = the base colour), its mean 1, darker in the cracks and under the steps, with a slow tonal mottle and the
// granite's dark-mineral speckle; the normal is the height's gradient. Rows run bottom to top as pixelsOf lays the
// scans (v = 0 at row 0), so a line laid vertical here stands vertical on a wall.
//   sheeted  granite: ~7 vertical joints over the repeat (two sets, a few degrees apart), 4 diagonal dihedrals at 55-75
//            degrees; cracks 3-6 cm wide and 2-4 cm deep (the sheet edges are the shader's, tens of metres apart)
//   bedded   slate: 24 beds across the repeat (the family y = x / 2 + c, which closes on the torus), each a step of 8 mm
//            and a hairline crack, in two tones; 18 cross joints across them, 0.3-0.8 m long, 1.5 cm wide
function tileHash(x, y, seed) { let q = (x * 374761393 + y * 668265263 + seed * 1013904223) | 0; q = Math.imul(q ^ (q >>> 13), 1274126177); return ((q ^ (q >>> 16)) >>> 0) / 4294967296; }
// value noise on a lattice of P cells over the torus (x, y in cells), smooth, tileable
function tileNoise(x, y, P, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = i => ((i % P) + P) % P;
  const a = tileHash(w(xi), w(yi), seed), b = tileHash(w(xi + 1), w(yi), seed), c = tileHash(w(xi), w(yi + 1), seed), d = tileHash(w(xi + 1), w(yi + 1), seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
export function* cliffLayerSteps(kind, size, dst, off) {
  const N = DETAIL_PX, tex = size / N, n = N * N, h = new Float32Array(n), tone = new Float32Array(n).fill(1), wrap = i => ((i % N) + N) % N;
  const seed = kind === 'sheeted' ? 11 : 23, rnd = (() => { let s = seed * 7919; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; })();
  const dark = kind === 'sheeted' ? 0.5 : 0.6;
  // a crack along a line: rows y0..y0+len (texels, y up; floored: a typed array silently drops a write at a fractional
  // index, which once left the layer with no cracks at all), its x centre xc(y) with wander; profile across in metres
  const crackRows = (x0, y0, dxdy, len, w, depth, wander) => {
    const R = Math.ceil(3 * w / tex), cosA = 1 / Math.sqrt(1 + dxdy * dxdy);
    for (let t = 0; t < len; t++) {
      const y = wrap(Math.floor(y0) + t), xc = x0 + dxdy * t + wander * (tileNoise((x0 + dxdy * t) / N * 16, y / N * 16, 16, seed + 3) - 0.5) / tex, xi = Math.round(xc);
      const tip = Math.min(1, Math.min(t, len - t) / (0.15 * len + 1)), wt = w * (0.4 + 0.6 * tip);   // tapering to the tips
      for (let i = -R; i <= R; i++) {
        const d = Math.abs(xi + i - xc) * tex * cosA, k = y * N + wrap(xi + i);
        if (d < wt) { const p = 1 - d / wt; h[k] -= depth * tip * Math.pow(p, 0.7); tone[k] *= 1 - (1 - dark) * tip * p; }
        if (d < 3 * w) tone[k] *= 1 - 0.12 * tip * (1 - d / (3 * w));
      }
    }
  };
  // a step along a line within 45 degrees of horizontal: columns x0..x0+len, its y centre yc(x); the surface below
  // dropped by `step` (crisp over 2 cm) rising back over 25 cm; with a hairline crack `w` wide
  const stepCols = (x0, y0, dydx, len, step, w, wander, shade = 0.78) => {
    const below = Math.ceil(0.27 / tex), above = Math.ceil(w / tex) + 1;
    for (let t = 0; t < len; t++) {
      const x = wrap(x0 + t), yc = y0 + dydx * t + wander * (tileNoise(x / N * 12, (y0 + dydx * t) / N * 12, 12, seed + 5) - 0.5) / tex, yi = Math.round(yc);
      for (let j = -below; j <= above; j++) {
        const y = wrap(yi + j), k = y * N + x, dd = (yc - (yi + j)) * tex;   // metres below the line (> 0 below)
        if (dd > 0) { const s = dd < 0.008 ? dd / 0.008 : 1, back = dd < 0.02 ? 1 : Math.max(0, 1 - (dd - 0.02) / 0.25); h[k] -= step * s * back; if (dd < 0.04) tone[k] *= shade + (1 - shade) * dd / 0.04; }
        const ad = Math.abs(dd); if (w > 0 && ad < w) { const p = 1 - ad / w; h[k] -= 0.6 * step * p; tone[k] *= 0.7 + 0.3 * (1 - p); }
      }
    }
  };
  // grain: the rock's own roughness at a millimetre (two fine octaves; no slow relief: a slow bump stored in 8 bits
  // steps, and the steps showed as contour lines over the whole wall); the slow mottle goes to the tone only
  for (let y = 0; y < N; y++) {
    if ((y & 63) === 0) yield;
    for (let x = 0; x < N; x++) { const k = y * N + x; h[k] = 0.0007 * tileNoise(x / 2, y / 2, N / 2, seed) + 0.0005 * tileNoise(x / 5, y / 5, N / 5, seed + 1); tone[k] = 0.93 + 0.14 * tileNoise(x / 128, y / 128, N / 128, seed + 2); }
  }
  if (kind === 'sheeted') {
    for (let q = 0; q < 7; q++) {   // vertical joints: two sets a few degrees apart, each wandering, broken into runs
      const set = q & 1, dxdy = Math.tan(((set ? 4 : -3) + (rnd() - 0.5) * 6) * Math.PI / 180), x0 = rnd() * N, w = 0.03 + 0.03 * rnd(), depth = 0.02 + 0.02 * rnd();
      let y = rnd() * N; const runs = 1 + Math.floor(rnd() * 3);
      for (let r = 0; r < runs; r++) { const len = Math.floor(N * (0.25 + 0.6 * rnd()) / runs); crackRows(x0 + dxdy * y, y, dxdy, len, w, depth, 0.04); y += len + N * 0.05 * rnd(); }
      yield;
    }
    for (let q = 0; q < 4; q++) {   // diagonal dihedrals at 55-75 degrees, 0.4-0.9 repeats long
      const ang = (55 + 20 * rnd()) * (rnd() < 0.5 ? 1 : -1) * Math.PI / 180, dxdy = 1 / Math.tan(ang), len = Math.floor(N * (0.4 + 0.5 * rnd()) * Math.abs(Math.sin(ang)));
      crackRows(rnd() * N, rnd() * N, dxdy, len, 0.035 + 0.03 * rnd(), 0.025 + 0.02 * rnd(), 0.03);
      yield;
    }
    // no sheet edges in the layer: three a repeat tiled into ruled lines every 1.3 m over a whole wall; the sheets are
    // the shader's (terrain.js faceFields), at their own spacing of tens of metres
    yield;
  } else {
    const M = 24, sp = N / M;   // beds: y = x / 2 + c, c every N / 24 rows (closed on the torus: a shift of x by N moves c by N / 2 = 12 beds)
    for (let b = 0; b < M; b++) { stepCols(0, b * sp + (rnd() - 0.5) * 0.3 * sp, 0.5, N, 0.008, 0.004, 0.015, 0.82); if ((b & 7) === 7) yield; }
    for (let y = 0; y < N; y++) {   // the beds' two tones (by bed index, period 12 so the pattern tiles)
      if ((y & 127) === 0) yield;
      for (let x = 0; x < N; x++) { const b = Math.floor((y - 0.5 * x) / sp); tone[y * N + x] *= 0.92 + 0.16 * tileHash(((b % 12) + 12) % 12, 0, seed + 9); }
    }
    for (let q = 0; q < 18; q++) {   // cross joints, perpendicular to the beds (63 degrees from horizontal), short
      const dxdy = -0.5 + (rnd() - 0.5) * 0.1, len = Math.floor(N * (0.12 + 0.2 * rnd()) / size * 2.5);
      crackRows(rnd() * N, rnd() * N, dxdy, len, 0.012 + 0.008 * rnd(), 0.012 + 0.01 * rnd(), 0.02);
      if ((q & 5) === 5) yield;
    }
  }
  // the albedo ratio (mean 1) with the granite's dark-mineral speckle, and the normal from the height's gradient
  let mean = 0; for (let k = 0; k < n; k++) mean += tone[k]; mean /= n;
  for (let y = 0; y < N; y++) {
    if ((y & 63) === 0) yield;
    for (let x = 0; x < N; x++) {
      const k = y * N + x, sp = kind === 'sheeted' ? 1 + 0.08 * (tileNoise(x / 2, y / 2, N / 2, seed + 4) - 0.5) : 1;
      const dz = tileHash(x, y, seed + 6) - 0.5;   // dithered to 8 bits, so no slow gradient steps into a contour
      const g = Math.min(255, Math.max(0, Math.round(127.5 * tone[k] / mean * sp + dz)));
      dst.alb[off + k * 4] = g; dst.alb[off + k * 4 + 1] = g; dst.alb[off + k * 4 + 2] = g; dst.alb[off + k * 4 + 3] = 255;
      const nx = -(h[y * N + wrap(x + 1)] - h[y * N + wrap(x - 1)]) / (2 * tex), ny = -(h[wrap(y + 1) * N + x] - h[wrap(y - 1) * N + x]) / (2 * tex), l = Math.hypot(nx, ny, 1);
      dst.nrm[off + k * 4] = Math.round((nx / l + 1) * 127.5 + dz); dst.nrm[off + k * 4 + 1] = Math.round((ny / l + 1) * 127.5 + dz); dst.nrm[off + k * 4 + 2] = Math.round((1 / l + 1) * 127.5); dst.nrm[off + k * 4 + 3] = 255;
    }
  }
}

// Tile-scale low-pass of a per-pixel quantity (tileable: wraps at the edges): average into a
// 64 x 64 grid, gaussian blur there (sigma in grid cells), then read back bilinearly. Used to
// take the scans' own slow gradients out (a patch a little brighter, or tilted, across one repeat),
// which is what turns a repeat into a visible grid from 50-150 m once the texture is mipped down.
const LOW_N = 64;
function* lowPass(get, sigma = 6) {
  const N = DETAIL_PX, B = N / LOW_N, g = new Float32Array(LOW_N * LOW_N);
  for (let y = 0; y < N; y++) { if ((y & 127) === 0) yield; for (let x = 0; x < N; x++) g[((y / B) | 0) * LOW_N + ((x / B) | 0)] += get(y * N + x); }
  for (let k = 0; k < g.length; k++) g[k] /= B * B;
  const R = Math.ceil(sigma * 3), w = []; let ws = 0;
  for (let t = -R; t <= R; t++) { const v = Math.exp(-t * t / (2 * sigma * sigma)); w.push(v); ws += v; }
  const tmp = new Float32Array(g.length), wrap = i => ((i % LOW_N) + LOW_N) % LOW_N;
  for (let y = 0; y < LOW_N; y++) for (let x = 0; x < LOW_N; x++) { let a = 0; for (let t = -R; t <= R; t++) a += w[t + R] * g[y * LOW_N + wrap(x + t)]; tmp[y * LOW_N + x] = a / ws; }
  for (let y = 0; y < LOW_N; y++) for (let x = 0; x < LOW_N; x++) { let a = 0; for (let t = -R; t <= R; t++) a += w[t + R] * tmp[wrap(y + t) * LOW_N + x]; g[y * LOW_N + x] = a / ws; }
  return (x, y) => {   // bilinear, cell centres at (i + 0.5) * B
    const fx = x / B - 0.5, fy = y / B - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const a = g[wrap(y0) * LOW_N + wrap(x0)], b = g[wrap(y0) * LOW_N + wrap(x0 + 1)], c = g[wrap(y0 + 1) * LOW_N + wrap(x0)], d = g[wrap(y0 + 1) * LOW_N + wrap(x0 + 1)];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

// Normal map: subtract the tile-scale mean tilt (see lowPass), renormalise. Small bumps stay.
function* highPassNormal(src, dst, off) {
  const N = DETAIL_PX, n = N * N;
  const lx = yield* lowPass(i => src[i * 4] / 127.5 - 1), ly = yield* lowPass(i => src[i * 4 + 1] / 127.5 - 1);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (x === 0 && (y & 63) === 0) yield;
    const i = y * N + x;
    let tx = src[i * 4] / 127.5 - 1 - lx(x, y), ty = src[i * 4 + 1] / 127.5 - 1 - ly(x, y);
    const l2 = tx * tx + ty * ty; if (l2 > 0.9) { const k = Math.sqrt(0.9 / l2); tx *= k; ty *= k; }
    const tz = Math.sqrt(Math.max(1 - tx * tx - ty * ty, 0));
    dst[off + i * 4] = Math.round((tx + 1) * 127.5); dst[off + i * 4 + 1] = Math.round((ty + 1) * 127.5);
    dst[off + i * 4 + 2] = Math.round((tz + 1) * 127.5); dst[off + i * 4 + 3] = 255;
  }
  return n;
}

// Albedo -> mid-grey-normalised ratio, stored linear at half scale (128 = x1.0, 255 = x2.0).
// Normalised in sRGB (display) space, then converted to a linear multiplier: a ratio whose linear
// mean is 1 still reads darker once encoded (the curve is concave), so the scan would dim the photo.
// The scan's hue is kept at 60% so leaves and pebbles keep some colour of their own over the photo.
function* normaliseAlbedo(src, dst, off) {
  const n = DETAIL_PX * DETAIL_PX;
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += src[i * 4]; mg += src[i * 4 + 1]; mb += src[i * 4 + 2]; }
  yield;
  mr /= n; mg /= n; mb /= n;
  const mlum = 0.299 * mr + 0.587 * mg + 0.114 * mb;
  // tile-scale brightness gradients out (85%): the slow part of the scan is the photo's job
  const low = yield* lowPass(i => (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / mlum);
  for (let i = 0; i < n; i++) {
    if ((i & 65535) === 0) yield;
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
    const hp = 1 / (1 + 0.85 * (low(i % DETAIL_PX, (i / DETAIL_PX) | 0) - 1));
    const l = hp * (0.299 * r + 0.587 * g + 0.114 * b) / mlum;  // display-space luminance ratio
    const cr = hp * r / mr, cg = hp * g / mg, cb = hp * b / mb;  // display-space colour ratio
    dst[off + i * 4] = Math.min(255, Math.round(127.5 * Math.pow(Math.max(l + 0.6 * (cr - l), 0), 2.2)));
    dst[off + i * 4 + 1] = Math.min(255, Math.round(127.5 * Math.pow(Math.max(l + 0.6 * (cg - l), 0), 2.2)));
    dst[off + i * 4 + 2] = Math.min(255, Math.round(127.5 * Math.pow(Math.max(l + 0.6 * (cb - l), 0), 2.2)));
    dst[off + i * 4 + 3] = 255;
  }
}

function arrayTexture(data) {
  const t = new THREE.DataArrayTexture(data, DETAIL_PX, DETAIL_PX, DETAIL_SLOTS.length);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  return releaseTexture(t);   // the 20 MB of slots go once uploaded (gpuRelease.js); the mips are the GPU's
}

export class GroundDetail {
  // mask: buildDetailMask(tile)'s result when the caller has made it already (terrain.js, in slices)
  constructor(tile, { base = new URL('../assets/ground/', import.meta.url).href, mask = null } = {}) {
    this.tile = tile; this.base = base; this.uniforms = detailUniforms; this.substituted = [];
    const m = mask || buildDetailMask(tile);
    this.mask = m; this.maskMs = m.ms;
    detailUniforms.detailMask.value = m.texture;
    this.ready = this.load();
  }
  // The textures stream in after the world is made; an abandoned world's (tile.signal, main.js) stop at their next fetch
  // or slice and leave the shared uniforms as they are.
  load() { return this.loadSteps().catch(e => { if (this.tile.signal?.aborted) return null; throw e; }); }
  async loadSteps() {
    const t0 = performance.now(), L = DETAIL_SLOTS.length, S = DETAIL_PX * DETAIL_PX * 4, signal = this.tile.signal;
    const alb = new Uint8Array(S * L), nrm = new Uint8Array(S * L);
    await Promise.all(DETAIL_SLOTS.map(async (slot, s) => {
      let a, n;
      if (slot.proc) { await runSliced(cliffLayerSteps(slot.proc, slot.size, { alb, nrm }, s * S), `cliff layer ${slot.name}`, { signal }); return; }   // made, not scanned (cliffLayerSteps)
      try {
        const [ia, ina] = await Promise.all([loadImage(`${this.base}${slot.name}_albedo.jpg?v=${ASSET_VERSION}`, signal), loadImage(`${this.base}${slot.name}_normal.jpg?v=${ASSET_VERSION}`, signal)]);
        a = pixelsOf(ia); n = pixelsOf(ina);
      } catch (e) {
        if (signal?.aborted) throw e;
        console.warn(e.message, '- using a procedural stand-in'); this.substituted.push(slot.name);
        ({ albedo: a, normal: n } = proceduralPixels(s + 1, slot.name));
      }
      // in slices (slice.js): this runs while the world builds behind the opening screen; the same pixels
      await runSliced(normaliseAlbedo(a, alb, s * S), `ground detail ${slot.name} albedo`, { signal });
      await runSliced(highPassNormal(n, nrm, s * S), `ground detail ${slot.name} normal`, { signal });
    }));
    if (signal?.aborted) return null;
    detailUniforms.detailAlbedo.value = arrayTexture(alb);
    detailUniforms.detailNormal.value = arrayTexture(nrm);
    detailUniforms.detailReady.value = 1;
    this.loadMs = Math.round(performance.now() - t0);
    return this;
  }
  set(on) { detailUniforms.detailOn.value = on ? 1 : 0; }
}

// GLSL for the terrain fragment shader: uniforms, the per-axis planar projection, the whiteout
// normal blend into world space, and one detail fetch (albedo ratio + tangent normal) with explicit
// gradients, so it is safe inside the distance branch and the warp's own derivatives stay out of
// the mip choice.
export const DETAIL_GLSL = /* glsl */`
  uniform sampler2DArray detailAlbedo; uniform sampler2DArray detailNormal; uniform sampler2D detailMask;
  uniform float detailReady; uniform float detailOn; uniform vec4 detailParams[${DETAIL_SLOTS.length}]; uniform float detailContrast[${DETAIL_SLOTS.length}];
  // Projection axis: 0 faces x (plane zy), 1 faces up (plane xz), 2 faces z (plane xy).
  vec2 dProj(int ax, vec3 p) { return ax == 0 ? p.zy : ax == 1 ? p.xz : p.xy; }
  // Tangent normal of a projection to world, whiteout blend with the geometric normal N (Golus).
  vec3 dToWorld(int ax, vec3 t, vec3 N) {
    if (ax == 0) return vec3(t.xy + N.zy, abs(t.z) * N.x).zyx;
    if (ax == 1) return vec3(t.xy + N.xz, abs(t.z) * N.y).xzy;
    return vec3(t.xy + N.xy, abs(t.z) * N.z);
  }
  void dSample(int m, int ax, vec3 p, vec2 warp, vec3 dpx, vec3 dpy, out vec3 alb, out vec3 tn) {
    vec4 P = detailParams[m];
    mat2 R = mat2(P.y, P.z, -P.z, P.y) * P.x;   // per-material rotation and metres -> repeats
    vec2 co = R * (dProj(ax, p) + warp), gx = R * dProj(ax, dpx), gy = R * dProj(ax, dpy);
    vec3 L = vec3(co, float(m));
    alb = textureGrad(detailAlbedo, L, gx, gy).rgb * 2.0;          // 1.0 = the photo unchanged
    tn = textureGrad(detailNormal, L, gx, gy).rgb * 2.0 - 1.0; tn.xy *= P.w;
  }
  // The third octave of slot m on plane ax at q (vRel: the position less detailOrigin), with the 2 m octave's warp; the
  // tangent normal comes back turned to the plane (the matrix's rotation undone), so a bump lights from the sun's side.
  uniform vec4 detailOct3; uniform vec4 detailM3[${DETAIL_SLOTS.length}]; uniform vec2 detailOff3[${DETAIL_SLOTS.length * 3}];
  void dSample3(int m, int ax, vec3 q, vec2 warp, vec3 dpx, vec3 dpy, out vec3 alb, out vec3 tn) {
    vec4 M = detailM3[m];
    vec2 pq = dProj(ax, q) + warp, ex = dProj(ax, dpx), ey = dProj(ax, dpy);
    vec2 co = vec2(dot(M.xy, pq), dot(M.zw, pq)) + detailOff3[m * 3 + ax];
    vec2 gx = vec2(dot(M.xy, ex), dot(M.zw, ex)), gy = vec2(dot(M.xy, ey), dot(M.zw, ey));
    vec3 L = vec3(co, float(m));
    alb = textureGrad(detailAlbedo, L, gx, gy).rgb * 2.0;
    tn = textureGrad(detailNormal, L, gx, gy).rgb * 2.0 - 1.0;
    tn.xy = vec2(M.x * tn.x + M.z * tn.y, M.y * tn.x + M.w * tn.y) / length(M.xy) * detailParams[m].w;
  }
`;
