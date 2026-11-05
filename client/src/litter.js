import * as THREE from 'three';
import { mulberry32 } from './trees.js';
import { chainShader, LIBRARY } from './treegen.js';
import { rockKeep } from './tilepackage.js';
import { groundUniforms, GROUND_GLSL, seasonState } from './terrain.js';
import { buildDetailMaskSteps } from './groundDetail.js';
import { releaseTexture } from './gpuRelease.js';
import { bodyScale, onBodyScale } from './bodyScale.js';

// The body-scaled litter ring (2026-10-28): the small things on the ground that the photo and the 2 m detail textures
// only hint at, drawn in 3D around a small body. A vole's and a lizard's world is mostly litter and stone with blades
// standing out of it; a deer barely sees this layer, and from a body of scale 0.6 up (bodyScale.js: a deer, a lion,
// a bear, the spirit and the fliers) nothing here is drawn or updated, so their frame is exactly what it was.
//
// Six kinds, one instanced draw each, every shape built here at load (nothing downloaded):
//   grit    1-2.5 cm stones, a deformed icosahedron (20 triangles), flat-shaded
//   stone   2-6 cm stones, a deformed icosphere (80 triangles) with facets cut like rocks.js's pebbles, flat-shaded
//   leaf    fallen oak leaves, a curled 4 x 2 quad grid (16 triangles), alpha-tested against a leaf drawn on a canvas
//           at load (blue oak: oblong with shallow rounded lobes; coast live oak: oval, spine-toothed), two-sided
//           with a translucent back (sun through a curled edge seen from below), brown to grey
//   acorn   acorn caps (a scaly cup, cup up or down) and the odd whole acorn lying on its side (the nut's vertices
//           collapse into the cup on a cap-only instance, so both are one draw)
//   twig    5-30 cm bent, tapered cylinders (5 sides, 7 rings) lying along the ground, grey-brown
//   stem    dead grass stems lying down (thatch), 10-30 cm bent, arched three-sided tubes (a flat ribbon vanishes at
//           a vole's grazing view), lodged in a common direction per patch
//
// Where: the same material weights the terrain shader uses (terrain.js GROUND_GLSL, the `mk` block), replicated in JS
// from the GroundDetail mask (groundDetail.js: R slope / 90, G curvature, B bare, A road; 10 m texels, row 0 south),
// tile.masks (grassland, oak, chaparral), tile.canopy (tree cover), tile.roads (5 m) and the shader's own +-0.5
// border noise `bn` and ragged pavement edge, hashed exactly as the GPU hashes them. The shader shows the top two
// of five materials (thatch, litter, gravel, rock, pavement) blended by `b`; each material's presence here is its
// visible share times min(1, weight / 0.5), so the 3D stones sit where the detail texture already shows gravel:
//   gravel + 0.8 rock     pebbles and grit in groups (4-14 stones, Rayleigh scatter of 4-16 cm; never one alone),
//                         ~70 per m2 at full weight, more grit than stones, bigger stones where rock leads
//   litter x oak share    leaves, up to 150 per m2 (the season's leaf fall: x1 October-December, x0.8 January-March,
//                         x0.65 April-May when the live oaks drop theirs, x0.45 in summer), acorn caps 4 per m2 at
//                         full weight in autumn (a fifth of them whole acorns); the blue / live oak split and the oak
//                         share of the cover from the cell's species mix (tile.speciesMix oaks), else its habitat
//   litter (+ chaparral)  twigs, 8 per m2 at full weight
//   thatch                lying stems, 60 per m2 at full weight
//   nothing               on pavement (its weight takes the share), in water (tile.waterMask.inWater, as rocks.js and
//                         the plants keep off it) and where tilepackage's rockKeep opens the ground for the outcrops.
// Placement is a hash of the 2 m cell (no Math.random): every client draws the same litter. Cells are planned and
// cached as they come within the ring (nearest first, about 1.5 ms of planning a frame, so moving never stalls) and
// dropped when they fall well behind it.
//
// The ring: radius R = clamp(16 sqrt(scale), 1.5, 10) m around the player (a lizard ~2.6 m, a vole 3.3 m, a rabbit
// 6.4 m, a fox 10 m). Full density out to r0 = max(2.5, 0.45 R), then thinned as (r0 / d)^2, which keeps the litter
// at about the same density on screen; each instance is also drawn only out to 300 m per metre of its own size (a
// 1 cm grit stone to 3 m: a few pixels), and every limit fades over its outer fifth by the instance's own rank.
// The CPU fills the instance buffers from the cell plans when the player has moved 1 m (with a 1 m margin on every
// limit); the vertex shader applies the exact limits every frame and collapses what falls outside them.
//
// Seating: on tile.heights.ground(x, north), the surface drawn this frame (the fine mesh near the player, else the
// 10 m mesh; and terrain.js's micro patch under the body, tile.heights.micro). When heights.fine moves every cell is
// re-seated, when heights.micro is rebuilt or moves (its version) the cells under its old and new squares, nearest
// first within the frame budget (a stale seat stays drawn until its turn), and the buffers are refilled.
// Stones are lowered by 30 % of their height below the lowest ground under their footprint; leaves and stems lie on
// the ground's local plane; twigs run between the ground under their two ends.
//
// Look: Lambert lit like the rocks (atmosphere.patchLambert: the cascaded and cloud shadow on the sun term, the aerial
// perspective), the ground's own sky occlusion (canopy shade and the contact AO under near trees, as the terrain
// takes it), and each kind pulled part of the way toward the ground photo's colour under it (grass.js groundMatch's
// idea: grit and stones 30 %, stems 25 %, leaves 20 %, twigs 15 %, acorns not at all) and its brightness following
// the photo's (GROUND_BRIGHT: stones on pale decomposed granite pale, leaves hardly, the photo under a crown being dark
// with that crown's shade), so the litter belongs to the ground it lies on.
//
// Cost (2026-10-28, M-series, 1717 x 1363, the litter drawn alone over an empty frame, no early-z from the ground, so
// an upper bound): a lizard under oaks ~5.6 k instances submitted, 2.4 k drawn, 0.2-0.35 ms; a rabbit 10.8 k / 7.9 k,
// ~0.5 ms; a fox 24.7 k / 19.3 k, ~0.5 ms. CPU: planning a cell ~0.7 ms (a 2 m cell of full oak litter, ~600
// leaves), a refill of 27 k instances ~1.3 ms (cells wholly inside every limit are copied whole).
// Debugging: scene.getObjectByName('litter').userData.litter is this object (stats, drawn(), set(on)).

//
// The close layer (2026-11-04): the litter under each crown is that tree's own. The near trees (vegetation.js
// nearPlants: species, the drawn crown's half-width crownR, the bole's foot radius trunkR, old, snag; on the home
// tile every one a lidar crown) are indexed on a 10 m grid (buildCrowns, again when the near set is refreshed), and
// each 2 m cell draws from the trees whose crowns reach it. A tree covers a point by w = 1 - smooth(0.75 R, 1.35 R,
// d) (its drip line, spread by the wind), the cover of several by 1 - prod(1 - w), and a candidate there is the
// litter of one of them picked by w. What each tree drops is LITTER_SP (by species; a library species not in it by
// its foliage type): leaves from an eight-cell atlas (blue oak, live oak, valley oak, black oak, lanceolate (bay,
// buckeye, willow, ash and walnut leaflets), elliptic (madrone, alder, cottonwood), madrone's bark curls, palmate
// (maple, sycamore)) at the species' size and colours, fascicles of needles (gray pine 20-30 cm, ponderosa 12-25,
// Douglas-fir and incense cedar short), cones (gray pine's 15-25 cm hooked ones, ponderosa 8-13, Douglas-fir 5-9,
// incense cedar 2-3), acorn caps under the oaks, twigs, and fallen branches (more under old trees, most round snags)
// with surface roots radiating from big boles. Each kind's amount follows the cover and the species' month: the
// deciduous oaks, maple and walnut drop in October to December, the live oaks and bay in April and May, madrone its
// leaves in June and July and its bark in July to September, buckeye in July and August (summer deciduous), the pines
// their needles in September to November; the fresh share of the leaves (bright, uncurled) peaks then. Where a crown
// does not reach, the old rules hold (the canopy raster's litter with the cell's oak mix, at 40 % where the crown
// index is known, all of it where it is not). On the water system's bars (tile.water bar, or gravel and cobble on the
// dry bed and margins) rounded water-worn pebbles 0.6-4 cm lie thick (rocks.js lays the stones from 5 cm up). All of
// it darkens with the ground's wetness (weather.js, groundUniforms.wxGround.x).
// The duff gives the micro relief its height: tile.closeDuff(x, north) is the crown cover there (0..1, more under old
// trees and pines), which terrain.js MicroPatch.node takes as the litter weight and amplitude (2 cm to 5 cm).

const CELL = 2, MARGIN = 2, MOVE = 1, SHOW_MAX = 0.6, K_REACH = 300, PLAN_MS = 1.5, SALT = 0x11773;
const KINDS = ['grit', 'stone', 'leaf', 'acorn', 'twig', 'stem', 'needle', 'cone', 'wood', 'pebble', 'fungus'];
const REC = 8, AUX = 3;   // spec record: x, north, yaw, size, p0..p3; aux: rank, variant, size
// share of the ground photo's colour each kind takes; translucency of the back (leaves and stems)
const GROUND_MIX = { grit: 0.3, stone: 0.3, leaf: 0.2, acorn: 0, twig: 0.15, stem: 0.25, needle: 0.15, cone: 0, wood: 0.1, pebble: 0.2, fungus: 0 };
const TRANS = { grit: 0, stone: 0, leaf: 0.45, acorn: 0, twig: 0, stem: 0.35, needle: 0.3, cone: 0, wood: 0, pebble: 0, fungus: 0.2 };
// how far each kind's brightness follows the ground photo's (its luminance over GROUND_REF, the linear ground the
// palettes below were set against): pebbles on pale decomposed soil are pale, on dark loam darker
// (leaves least: the photo under a crown is dark with the crown's own shade, which the litter must not take twice)
const GROUND_BRIGHT = { grit: 0.6, stone: 0.5, leaf: 0.15, acorn: 0.15, twig: 0.3, stem: 0.4, needle: 0.15, cone: 0.1, wood: 0.15, pebble: 0.45, fungus: 0 }, GROUND_REF = 0.12;
// how much darker each kind is when soaked (weather.js wet 1): litter and wood drink water, stone only wets its skin
const WET_DARK = { grit: 0.35, stone: 0.35, leaf: 0.45, acorn: 0.3, twig: 0.4, stem: 0.4, needle: 0.45, cone: 0.35, wood: 0.45, pebble: 0.4, fungus: 0.15 };
// Fungi (a placeholder, off by default: Litter.fungi, or ?fungi=1): fruiting bodies in the wet months, on the fallen
// wood (brackets) and in the litter under the oaks (capped mushrooms). Each row: where, form (0 a cap on a stem, 1 a
// bracket), months (January first), how many (on a branch, or a square metre of full oak cover), size (cap width, m),
// sRGB colours. Aaron wants fungi eventually; these are stand-ins until the species and their seasons are researched.
const FUNGI = [
  { id: 'turkey_tail', on: 'wood', form: 1, months: [1, 1, 1, 0.6, 0.2, 0, 0, 0, 0, 0.2, 0.7, 1], per: 3, size: [0.025, 0.06], col: [[0.45, 0.36, 0.28], [0.32, 0.28, 0.25], [0.55, 0.47, 0.36]] },
  { id: 'oak_litter_cap', on: 'oak', form: 0, months: [0.8, 0.6, 0.4, 0.2, 0, 0, 0, 0, 0, 0.1, 0.6, 1], per: 0.6, size: [0.03, 0.09], col: [[0.62, 0.48, 0.32], [0.7, 0.6, 0.45], [0.5, 0.36, 0.24]] },
];
const LEAF_CELLS = 8;   // the leaf atlas: 0 blue oak, 1 live oak, 2 valley oak, 3 black oak, 4 lanceolate, 5 elliptic, 6 bark curl, 7 palmate

export const ringRadius = s => Math.min(Math.max(16 * Math.sqrt(s), 1.5), 10);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const lin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const linRGB = (r, g, b) => [lin(r), lin(g), lin(b)];
function h32(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0;
}
// The terrain shader's lattice hash and rotated value noise (terrain.js FRAG hash / vnoise / rnoise), bit for bit, so
// the material borders fall where the GPU draws them.
function ghash(ix, iy) {
  const qx = (ix + 65536) >>> 0, qy = (iy + 65536) >>> 0;
  let h = (Math.imul(qx, 1597334677) ^ Math.imul(qy, 3812015801)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}
function vnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py); let fx = px - ix, fy = py - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = ghash(ix, iy), b = ghash(ix + 1, iy), c = ghash(ix, iy + 1), d = ghash(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function rnoise(px, py, a, scale) { const c = Math.cos(a), s = Math.sin(a); return vnoise((c * px - s * py) / scale, (s * px + c * py) / scale); }
// 3D value noise for the stone shapes (any hash will do: the shapes are built once)
function vnoise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const H = (i, j, k) => h32(i + seed * 131, j, k) / 4294967296;
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(H(ix, iy, iz), H(ix + 1, iy, iz), fx), l(H(ix, iy + 1, iz), H(ix + 1, iy + 1, iz), fx), fy),
           l(l(H(ix, iy, iz + 1), H(ix + 1, iy, iz + 1), fx), l(H(ix, iy + 1, iz + 1), H(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
// Bilinear lookup in an 8-bit raster at pixel coordinates (fx, fy) of pixel centres, clamped at the edges.
function bil(d, W, H, fx, fy, ch) {
  fx = Math.min(Math.max(fx, 0), W - 1.001); fy = Math.min(Math.max(fy, 0), H - 1.001);
  const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, i = (y0 * W + x0) * 4 + ch, r = W * 4;
  return (d[i] * (1 - tx) + d[i + 4] * tx) * (1 - ty) + (d[i + r] * (1 - tx) + d[i + r + 4] * tx) * ty;
}

// ---- shapes ----------------------------------------------------------------------------------------
// A stone: an icosphere of the given detail pushed out by 3D noise and cut by a few planes (facets), centred on its
// bounding box and scaled to a largest extent of 1. Vertex colour: a light mottle, darker underneath.
// (nCuts 0: a water-worn pebble, rounded, smooth-shaded by its caller)
function stoneGeometry(detail, seed, nCuts = 6) {
  const r = mulberry32(seed), cuts = [];
  for (let k = 0; k < nCuts; k++) { const n = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1], l = Math.hypot(...n) || 1; cuts.push([n[0] / l, n[1] / l, n[2] / l, 0.72 + 0.2 * r()]); }
  const g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const p = g.attributes.position, n = p.count, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    let x = p.getX(k), y = p.getY(k), z = p.getZ(k); const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
    let rad = 0.9 + 0.22 * vnoise3(x * 1.8 + 5, y * 1.8 + 5, z * 1.8 + 5, seed);
    for (const c of cuts) { const dd = x * c[0] + y * c[1] + z * c[2]; if (dd > 0.05) rad = Math.min(rad, c[3] / dd); }
    p.setXYZ(k, x * rad, y * rad, z * rad);
    lo[0] = Math.min(lo[0], x * rad); lo[1] = Math.min(lo[1], y * rad); lo[2] = Math.min(lo[2], z * rad);
    hi[0] = Math.max(hi[0], x * rad); hi[1] = Math.max(hi[1], y * rad); hi[2] = Math.max(hi[2], z * rad);
  }
  const s = 1 / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), c = [0, 1, 2].map(a => (hi[a] + lo[a]) / 2);
  const col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const x = (p.getX(k) - c[0]) * s, y = (p.getY(k) - c[1]) * s, z = (p.getZ(k) - c[2]) * s; p.setXYZ(k, x, y, z);
    const sh = (0.82 + 0.18 * vnoise3(x * 6, y * 6, z * 6, seed + 9)) * (0.88 + 0.12 * smooth(-0.4, 0.3, y));
    col.set([sh, sh, sh], k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
// A leaf: a 5 x 3 vertex grid over x, z in [-0.5, 0.5] (x along the blade), y the curl: cupped across, the tip and the
// stalk end lifted. The instance's y scale sets how much it curls (negative: lying domed, edges down).
const LEAF_YMAX = 0.26;
function leafGeometry() {
  const NX = 5, NZ = 3, pos = [], uv = [], col = [], idx = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const u = i / (NX - 1), v = j / (NZ - 1), x = u - 0.5, z = v - 0.5;
    const y = 0.14 * (2 * z) ** 2 + 0.08 * (2 * x) ** 2 + 0.04 * Math.max(0, 2 * x) ** 3;
    pos.push(x, y, z); uv.push(u, v); const sh = 0.9 + 0.1 * (1 - Math.abs(2 * z)); col.push(sh, sh, sh);
  }
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLitUv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
// A tube (or a flat ribbon) along x in [-0.5, 0.5] (length 1) around a centreline bent sideways (z) and arched a little (y).
// aLitAx carries each vertex's centreline point; the vertex shader scales the offset from it by the instance's
// thickness (aux.y, radius or half-width over length) and lifts it by that much, so one shape serves every girth.
function lineGeometry({ sides, rings, bend, arch, taper, ribbon }) {
  const pos = [], ax = [], nrm = [], col = [], idx = [];
  const C = t => [t - 0.5, arch * Math.sin(Math.PI * t), bend[0] * Math.sin(Math.PI * t) + bend[1] * Math.sin(3 * Math.PI * t)];
  const per = ribbon ? 2 : sides + 1;
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1), c = C(t), c2 = C(Math.min(t + 0.01, 1)), c1 = C(Math.max(t - 0.01, 0));
    let tx = c2[0] - c1[0], ty = c2[1] - c1[1], tz = c2[2] - c1[2]; const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    // side vector B = T x up, normal N = B x T
    let bx = -tz, bz = tx; const bl = Math.hypot(bx, bz); bx /= bl; bz /= bl;
    const nx = bz * ty, ny = bx * tz - bz * tx, nz = -bx * ty;
    const rad = 1 - taper * t;
    if (ribbon) {
      for (const s of [-1, 1]) { pos.push(c[0] + bx * s * rad, c[1], c[2] + bz * s * rad); ax.push(...c); nrm.push(nx, ny, nz); col.push(1, 1, 1); }
    } else {
      for (let k = 0; k <= sides; k++) {
        const a = k / sides * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const ox = nx * ca + bx * sa, oy = ny * ca, oz = nz * ca + bz * sa;
        pos.push(c[0] + ox * rad, c[1] + oy * rad, c[2] + oz * rad); ax.push(...c); nrm.push(ox, oy, oz);
        const sh = 0.8 + 0.2 * Math.max(oy, 0) + 0.06 * Math.sin(t * 23 + k); col.push(sh, sh, sh);
      }
    }
  }
  for (let r = 0; r < rings - 1; r++) for (let k = 0; k < per - 1; k++) {
    const a = r * per + k, b = a + 1, c = a + per, d = c + 1; idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLitAx', new THREE.Float32BufferAttribute(ax, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}
// An acorn cap (a scaly cup, diameter 1, its base at y = 0, open upward) and its nut (aLitNut = 1), an ellipsoid
// seated in the cup. The cap's scales are rings of lighter and darker vertex colour; the nut is a glossier brown.
function acornGeometry() {
  const prof = [[0.02, 0], [0.22, 0.03], [0.38, 0.1], [0.48, 0.2], [0.5, 0.27], [0.45, 0.29], [0.36, 0.2], [0.2, 0.12], [0.02, 0.1]].map(([x, y]) => new THREE.Vector2(x, y));
  const cap = new THREE.LatheGeometry(prof, 12).toNonIndexed();
  const nut = new THREE.SphereGeometry(1, 10, 8).toNonIndexed();
  nut.scale(0.38, 0.62, 0.38); nut.translate(0, 0.62, 0);
  const capN = cap.attributes.position.count, nutN = nut.attributes.position.count, n = capN + nutN;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), flag = new Float32Array(n);
  pos.set(cap.attributes.position.array, 0); pos.set(nut.attributes.position.array, capN * 3);
  const capC = linRGB(0.5, 0.42, 0.33), nutC = linRGB(0.52, 0.36, 0.2);
  for (let k = 0; k < n; k++) {
    const y = pos[k * 3 + 1];
    if (k < capN) { const s = 0.8 + 0.25 * (Math.floor(y * 40) % 2); col.set([capC[0] * s, capC[1] * s, capC[2] * s], k * 3); }
    else { const s = 0.85 + 0.25 * smooth(0.3, 1.2, y); col.set([nutC[0] * s, nutC[1] * s, nutC[2] * s], k * 3); flag[k] = 1; }
  }
  cap.dispose(); nut.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aLitNut', new THREE.BufferAttribute(flag, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
// Several lineGeometry tubes in one: each part a tube placed by a matrix (rotations about y and a uniform scale, so
// aLitAx stays its centreline and the girth scales with the part).
function mergeTubes(parts) {
  const pos = [], ax = [], nrm = [], col = [], idx = []; let base = 0;
  const v = new THREE.Vector3();
  for (const { g, m, shade = 1 } of parts) {
    const P = g.attributes.position, A = g.attributes.aLitAx, N = g.attributes.normal, C = g.attributes.color, nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(A, i).applyMatrix4(m); ax.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nrm.push(v.x, v.y, v.z);
      col.push(C.getX(i) * shade, C.getY(i) * shade, C.getZ(i) * shade);
    }
    for (const k of g.index.array) idx.push(k + base);
    base += P.count; g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLitAx', new THREE.Float32BufferAttribute(ax, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}
// about the point (px, 0, pz): rotate by a about y, scale by k
const placeAt = (px, pz, a, k, tx = 0, tz = 0) => new THREE.Matrix4().makeTranslation(px + tx, 0, pz + tz)
  .multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-px, 0, -pz));
// A pine's fascicle: three needles from one sheath at x = -0.5, splayed a little, each a three-sided tube.
function fascicleGeometry() {
  return mergeTubes([[-0.11, 1], [0.0, 0.96], [0.13, 0.92]].map(([a, k], i) => ({
    g: lineGeometry({ sides: 3, rings: 4, bend: [0.025 * (i - 1), 0.012], arch: 0.015, taper: 0.35, ribbon: false }), m: placeAt(-0.5, 0, a, k) })));
}
// A fallen branch (or a surface root): a bent, tapered tube with one side branch from 45 % of its length.
function woodGeometry() {
  const g = mergeTubes([
    { g: lineGeometry({ sides: 6, rings: 9, bend: [0.045, 0.015], arch: 0, taper: 0.55, ribbon: false }), m: new THREE.Matrix4() },
    { g: lineGeometry({ sides: 5, rings: 5, bend: [0.03, 0], arch: 0, taper: 0.6, ribbon: false }), m: placeAt(-0.5, 0, 0.6, 0.38, 0.45, 0.04), shade: 0.95 },
  ]);
  // bark: furrows along it (alternate sides darker) and a blotch per vertex, so a branch near the eye is not a pipe
  const C = g.attributes.color, r = mulberry32(919);
  for (let i = 0; i < C.count; i++) { const k = (i % 2 ? 0.72 : 1) * (0.8 + 0.35 * r()); C.setXYZ(i, C.getX(i) * k, C.getY(i) * k, C.getZ(i) * k); }
  return g;
}
// A cone lying with its axis along x (base at -0.5, tip at +0.5), its widest at 1 across, as an opened cone: a core and
// 72 woody scales on the golden-angle spiral, each a plate from the core out to a thickened apophysis with its umbo,
// leaning toward the tip. On the umbo a hook (aLitHook: the hook's tip offset, collapsed unless the instance's aux.y
// scales it: a gray pine's claw 1, a ponderosa's prickle 0.3, none on a Douglas-fir or a cedar). Flat-shaded, one
// triangle soup; vertex colours: the apophysis pale, the scale's underside and the core dark.
function coneGeometry() {
  const pos = [], col = [], hook = [];
  const R = t => 0.5 * Math.sin(Math.PI * Math.min(Math.max(t, 0), 1) ** 0.72) ** 0.75;
  const P = (t, rad, th) => [t - 0.5, rad * Math.cos(th), rad * Math.sin(th)];   // axis x, around it in y, z
  const tri = (a, b, c, s, h = null) => { pos.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) col.push(s, s * 0.97, s * 0.93); for (let k = 0; k < 3; k++) hook.push(...(h && k === 1 ? h : [0, 0, 0])); };
  const NS = 72, r = mulberry32(4242);
  for (let k = 0; k < NS; k++) {
    const t = 0.07 + 0.86 * (k + 0.5) / NS, th = k * 2.39996, Rt = Math.max(R(t), 0.08), dw = 0.42 / Math.max(Rt / 0.5, 0.35) * (0.9 + 0.2 * r());
    const lean = 0.06, out = Rt * (1.0 + 0.06 * r());
    const IL = P(t - 0.03, 0.3 * Rt, th - dw * 0.6), IR = P(t - 0.03, 0.3 * Rt, th + dw * 0.6);
    const OL = P(t + lean, out, th - dw * 0.5), OR = P(t + lean, out, th + dw * 0.5);
    const U = P(t + lean * 0.7, out + 0.07 * Rt / 0.5 * 0.5, th);
    const sh = 0.95 + 0.2 * r();
    tri(IL, IR, U, sh * 0.75); tri(IR, OR, U, sh); tri(OR, OL, U, sh * 1.1); tri(OL, IL, U, sh * 0.8);
    tri(IL, OL, OR, 0.5); tri(IL, OR, IR, 0.5);   // the underside, darker
    // the hook: down and out from the umbo, toward the base
    const Ua = P(t + lean * 0.7, out + 0.02, th - dw * 0.15), Ub = P(t + lean * 0.7, out + 0.02, th + dw * 0.15);
    const tip = P(t + lean * 0.7 - 0.07, out + 0.16, th), off = [tip[0] - U[0], tip[1] - U[1], tip[2] - U[2]];
    tri(Ua, U, Ub, 0.55, off); tri(Ub, U, Ua, 0.55, off);
  }
  const NC = 8, RC = 10;   // the core, and a stalk at the base
  for (let j = 0; j < RC; j++) for (let i = 0; i < NC; i++) {
    const t0 = j / RC, t1 = (j + 1) / RC, a0 = i / NC * Math.PI * 2, a1 = (i + 1) / NC * Math.PI * 2;
    const r0 = 0.3 * Math.max(R(t0), 0.05), r1 = 0.3 * Math.max(R(t1), 0.05);
    const A = P(t0, r0, a0), B = P(t0, r0, a1), C = P(t1, r1, a1), D = P(t1, r1, a0);
    tri(A, C, B, 0.4); tri(A, D, C, 0.4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aLitHook', new THREE.Float32BufferAttribute(hook, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// A mushroom: a domed cap 1 across at y 0.55-0.85, gills under it darker, on a stem (aLitNut 1: collapsed into the
// cap's underside when the instance is a bracket, aux.y 1).
function fungusGeometry() {
  const cap = new THREE.LatheGeometry([[0.02, 0.55], [0.35, 0.56], [0.5, 0.6], [0.47, 0.7], [0.32, 0.8], [0.02, 0.85]].map(([x, y]) => new THREE.Vector2(x, y)), 12).toNonIndexed();
  const stem = new THREE.CylinderGeometry(0.08, 0.1, 0.58, 7, 1, true).toNonIndexed(); stem.translate(0, 0.29, 0);
  const cN = cap.attributes.position.count, sN = stem.attributes.position.count, pos = new Float32Array((cN + sN) * 3), col = new Float32Array((cN + sN) * 3), flag = new Float32Array(cN + sN);
  pos.set(cap.attributes.position.array, 0); pos.set(stem.attributes.position.array, cN * 3);
  for (let k = 0; k < cN + sN; k++) { const y = pos[k * 3 + 1], under = k < cN && y < 0.575; const c = k >= cN ? 1.15 : under ? 0.7 : 1; col.set([c, c, c], k * 3); if (k >= cN) flag[k] = 1; }
  cap.dispose(); stem.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aLitNut', new THREE.BufferAttribute(flag, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// The leaf atlas, drawn on a canvas at load: LEAF_CELLS 256 px cells side by side, the blade along x (the first two
// below; the close layer's six after them, see LEAF_CELLS). Blue oak: oblong, about
// twice as long as wide, the margin in four or five shallow rounded lobes a side. Coast live oak: oval, cupped (the
// geometry), the margin set with small spines. Pale multipliers (the instance colour carries brown or grey): the
// blade near white with a mottle, the midrib and side veins darker, the stalk. Alpha is the blade.
function leafTexture() {
  const S = 256, NC = LEAF_CELLS, c = document.createElement('canvas'); c.width = NC * S; c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true }), r = mulberry32(777);
  const outline = (cx, len, wid, edge) => {
    ctx.beginPath();
    const N = 120, x0 = cx - len / 2;
    for (let s = 0; s <= 1; s += 1 / N) { const w = wid * edge(s); ctx.lineTo(x0 + s * len, S / 2 - w); }
    for (let s = 1; s >= 0; s -= 1 / N) { const w = wid * edge(s); ctx.lineTo(x0 + s * len, S / 2 + w); }
    ctx.closePath();
  };
  const blade = (cx, len, wid, edge, veins) => {
    ctx.fillStyle = 'rgb(246,243,238)'; outline(cx, len, wid, edge); ctx.fill();
    ctx.save(); outline(cx, len, wid, edge); ctx.clip();
    for (let k = 0; k < 160; k++) { const v = 215 + (r() * 40 | 0); ctx.fillStyle = `rgba(${v},${v - 6},${v - 14},0.35)`; ctx.beginPath(); ctx.arc(cx - len / 2 + r() * len, S / 2 + (r() - 0.5) * 2 * wid, 2 + r() * 7, 0, 7); ctx.fill(); }
    ctx.strokeStyle = 'rgba(185,175,160,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - len / 2, S / 2); ctx.lineTo(cx + len / 2, S / 2); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(200,190,176,0.8)';
    for (let k = 1; k < veins; k++) {
      const s = k / veins, x = cx - len / 2 + s * len, w = wid * edge(Math.min(s + 0.06, 1)) * 0.95;
      for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x, S / 2); ctx.quadraticCurveTo(x + len * 0.05, S / 2 + sg * w * 0.5, x + len * 0.09, S / 2 + sg * w); ctx.stroke(); }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgb(170,160,148)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx - len / 2 - 14, S / 2 + 2); ctx.lineTo(cx - len / 2 + 2, S / 2); ctx.stroke();
  };
  // blue oak
  blade(S / 2 + 6, 214, 62, s => Math.sin(Math.PI * Math.min(s * 1.08, 1)) ** 0.75 * (0.86 + 0.14 * Math.cos(s * Math.PI * 2 * 4.5)), 7);
  // coast live oak: spines where a fast saw tooth peaks
  blade(S + S / 2 + 6, 200, 70, s => { const t = (s * 9) % 1; return Math.sin(Math.PI * s) ** 0.6 * (0.9 + 0.12 * Math.max(0, 1 - t * 4) * (s > 0.1 && s < 0.95 ? 1 : 0)); }, 6);
  // valley oak: deep rounded lobes, four or five a side, the sinuses reaching half way to the midrib
  blade(2 * S + S / 2 + 6, 214, 78, s => Math.sin(Math.PI * Math.min(s * 1.05, 1)) ** 0.6 * (0.42 + 0.58 * Math.abs(Math.sin(s * Math.PI * 4.6 + 0.4)) ** 0.6), 6);
  // black oak: deep lobes ending in bristle points
  blade(3 * S + S / 2 + 6, 216, 84, s => { const ph = (s * 3.6 + 0.15) % 1, tooth = ph < 0.5 ? ph * 2 : 2 - ph * 2; return Math.sin(Math.PI * Math.min(s * 1.05, 1)) ** 0.55 * (0.35 + 0.65 * tooth ** 1.6); }, 5);
  // lanceolate: narrow, pointed (bay, buckeye and willow leaflets, ash, walnut)
  blade(4 * S + S / 2 + 6, 222, 40, s => Math.sin(Math.PI * Math.min(s * 1.02, 1)) ** 0.85 * (1.05 - 0.35 * s), 9);
  // elliptic: broad, leathery, entire (madrone, alder, cottonwood)
  blade(5 * S + S / 2 + 6, 200, 82, s => Math.sin(Math.PI * Math.min(s * 1.03, 1)) ** 0.55, 8);
  // madrone's bark curl: a ragged strip (the leaf geometry curls it into a scroll)
  ctx.fillStyle = 'rgb(240,232,224)'; outline(6 * S + S / 2, 230, 46, s => 0.85 + 0.15 * Math.sin(s * 37) * Math.sin(s * 13) + (s < 0.04 || s > 0.96 ? -0.3 : 0)); ctx.fill();
  for (let k = 0; k < 60; k++) { const v = 200 + (r() * 50 | 0); ctx.fillStyle = `rgba(${v},${v - 20},${v - 30},0.4)`; ctx.fillRect(6 * S + 20 + r() * 216, S / 2 - 40 + r() * 80, 4 + r() * 20, 1 + r() * 2); }
  // palmate: five pointed lobes from the stalk (maple, sycamore), drawn round its own centre
  { const cx = 7 * S + S / 2, cy = S / 2; ctx.fillStyle = 'rgb(244,240,232)'; ctx.beginPath();
    for (let k = 0; k <= 240; k++) { const a = k / 240 * Math.PI * 2, lobe = Math.abs(Math.cos(2.5 * a)) ** 0.7, notch = 1 - 0.5 * Math.max(0, Math.cos(a - Math.PI)) ** 8;
      const rr = 112 * (0.4 + 0.6 * lobe) * notch; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(190,180,165,0.85)'; ctx.lineWidth = 2.5;
    for (let k = -2; k <= 2; k++) { const a = Math.PI + k * 1.257; ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + Math.cos(a) * -100, cy + Math.sin(a) * -100); ctx.stroke(); }
    ctx.strokeStyle = 'rgb(170,160,148)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx - 40, cy + 2); ctx.stroke(); }
  const img = ctx.getImageData(0, 0, NC * S, S), d = new Uint8Array(img.data.length);
  for (let y = 0; y < S; y++) d.set(img.data.subarray(y * NC * S * 4, (y + 1) * NC * S * 4), (S - 1 - y) * NC * S * 4);   // rows bottom first (v = 0)
  for (let k = 0; k < d.length; k += 4) d[k + 3] = d[k + 3] > 100 ? 255 : 0;
  const t = new THREE.DataTexture(d, NC * S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; t.needsUpdate = true;
  return releaseTexture(t);
}

// ---- materials -------------------------------------------------------------------------------------
const RING_GLSL = /* glsl */`
  uniform vec4 litRing; uniform float litK, litGround, litBright, litTrans;
  attribute vec3 aLitC; attribute vec3 aLitR;
  varying float vLitSky;
`;
function litterMaterial(kind, atmosphere, ring, leafTex) {
  const flat = kind === 'grit' || kind === 'stone' || kind === 'cone', two = kind === 'leaf';
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: flat, side: two ? THREE.DoubleSide : THREE.FrontSide });
  atmosphere.patchLambert(m);
  const U = { litRing: ring, litK: { value: K_REACH }, litGround: { value: GROUND_MIX[kind] }, litBright: { value: GROUND_BRIGHT[kind] }, litTrans: { value: TRANS[kind] }, litLeaf: { value: leafTex }, litWet: { value: WET_DARK[kind] } };
  const line = kind === 'twig' || kind === 'stem' || kind === 'needle' || kind === 'wood';
  chainShader(m, `litter-${kind}`, shader => {
    Object.assign(shader.uniforms, groundUniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${RING_GLSL}
        ${GROUND_GLSL}
        ${line ? 'attribute vec3 aLitAx;' : ''}
        ${kind === 'acorn' || kind === 'fungus' ? 'attribute float aLitNut;' : ''}
        ${kind === 'cone' ? 'attribute vec3 aLitHook;' : ''}
        uniform float litWet;
        ${kind === 'leaf' ? 'attribute vec2 aLitUv; varying vec2 vLitUv;' : ''}`)
      // the ring first thing in main(): an instance outside it costs a few instructions per vertex
      .replace('#include <uv_vertex>', `vLitSky = 1.0;
        vec3 litO = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        { float d = distance(litO.xz, litRing.xy), reach = min(litRing.z, aLitR.z * litK);
          float thin = d > litRing.w ? (litRing.w / d) * (litRing.w / d) : 1.0;
          float keep = min(thin, 1.0) * (1.0 - smoothstep(0.8 * reach, reach, d));
          keep *= 1.0 - smoothstep(0.15, 0.6, wxGround.y);   // lying snow covers it
          if (aLitR.x >= keep) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } }
        ${kind === 'leaf' ? `vLitUv = vec2((aLitUv.x + aLitR.y) * ${(1 / LEAF_CELLS).toFixed(6)}, aLitUv.y);` : ''}
        #include <uv_vertex>`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        { vec3 c = aLitC;
          { vec3 gw; vec3 g = groundAlbedo(litO, 1.0, gw);
            float lg = max(dot(g, G_LUMA), 1e-3);
            c *= clamp(mix(1.0, lg / ${GROUND_REF.toFixed(3)}, litBright), 0.6, 2.2);
            c = mix(c, g * (dot(c, G_LUMA) / lg), litGround); }
          { float l = dot(c, G_LUMA); c = mix(c, max(mix(vec3(l), c, 1.25), 0.0) * (1.0 - litWet), wxGround.x); }   // soaked: darker, a little richer
          vColor.rgb *= c;
          vLitSky = groundSkyOcclusion(groundUv(litO)) * groundContactAO(litO); }`);
    if (line) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      `vec3 transformed = aLitAx + (position - aLitAx) * aLitR.y + vec3(0.0, aLitR.y, 0.0);`);
    if (kind === 'fungus') shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      'vec3 transformed = (aLitNut > 0.5 && aLitR.y > 0.5) ? vec3(position.x, 0.56, position.z) : position;');
    if (kind === 'cone') shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      'vec3 transformed = position + aLitHook * aLitR.y;');
    if (kind === 'acorn') shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      'vec3 transformed = (aLitNut > 0.5 && aLitR.y < 0.5) ? vec3(0.0, 0.1, 0.0) : position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float litTrans; varying float vLitSky;
        ${kind === 'leaf' ? 'uniform sampler2D litLeaf; varying vec2 vLitUv;' : ''}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= vLitSky;
        #if NUM_DIR_LIGHTS > 0
          if (litTrans > 0.0) reflectedLight.directDiffuse += litTrans * max(-dot(normal, directionalLights[0].direction), 0.0) * directionalLights[0].color * BRDF_Lambert(diffuseColor.rgb);
        #endif`);
    if (kind === 'leaf') shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      '{ vec4 lt = texture2D(litLeaf, vLitUv); if (lt.a < 0.5) discard; diffuseColor.rgb *= lt.rgb; }');
  });
  return m;
}

// ---- palettes (linear) -----------------------------------------------------------------------------
const STONE_COL = [[0.36, 0.37, 0.38, 0.3], [0.48, 0.43, 0.36, 0.28], [0.55, 0.41, 0.3, 0.14], [0.38, 0.42, 0.38, 0.18], [0.3, 0.29, 0.28, 0.06], [0.86, 0.85, 0.8, 0.04]]
  .map(([r, g, b, w]) => [...linRGB(r, g, b), w]);
const GRIT_COL = linRGB(0.56, 0.49, 0.41);
const LEAF_FRESH = [linRGB(0.68, 0.52, 0.33), linRGB(0.6, 0.44, 0.27), linRGB(0.72, 0.6, 0.4)];
const LEAF_OLD = [linRGB(0.56, 0.52, 0.46), linRGB(0.48, 0.41, 0.33), linRGB(0.33, 0.27, 0.21)];
const TWIG_COL = [linRGB(0.38, 0.32, 0.27), linRGB(0.53, 0.5, 0.46), linRGB(0.3, 0.25, 0.21)];
const STEM_COL = [linRGB(0.74, 0.66, 0.5), linRGB(0.6, 0.56, 0.49), linRGB(0.68, 0.6, 0.45)];
const pick = (arr, u) => arr[Math.min(arr.length - 1, Math.floor(u * arr.length))];

// Leaf fall by month (0 = January): the blue oaks' in autumn, the live oaks' in spring, the summer floor thinnest.
const LEAF_SEASON = [0.8, 0.8, 0.8, 0.65, 0.65, 0.45, 0.45, 0.45, 0.55, 1, 1, 1];
const ACORN_SEASON = [0.6, 0.4, 0.25, 0.2, 0.15, 0.1, 0.1, 0.15, 0.6, 1, 1, 0.9];
const FRESH_SEASON = [0.3, 0.2, 0.15, 0.4, 0.4, 0.15, 0.1, 0.15, 0.3, 0.6, 0.7, 0.5];

// ---- each species' litter (the close layer) --------------------------------------------------------
// Months January first: `amt` how much of the species' full litter lies on the ground, `fresh` the share just fallen.
const SEASONS = {
  decid:   { amt: [0.75, 0.7, 0.65, 0.55, 0.5, 0.45, 0.45, 0.5, 0.6, 0.85, 1, 0.9], fresh: [0.3, 0.2, 0.1, 0.05, 0.05, 0.05, 0.05, 0.1, 0.2, 0.6, 0.8, 0.5] },
  live:    { amt: [0.7, 0.7, 0.75, 0.95, 1, 0.9, 0.8, 0.75, 0.7, 0.7, 0.7, 0.7], fresh: [0.1, 0.1, 0.2, 0.6, 0.7, 0.3, 0.15, 0.1, 0.1, 0.1, 0.1, 0.1] },
  bay:     { amt: [0.8, 0.8, 0.85, 1, 1, 0.9, 0.85, 0.8, 0.8, 0.8, 0.8, 0.8], fresh: [0.2, 0.2, 0.3, 0.5, 0.5, 0.3, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2] },
  madrone: { amt: [0.6, 0.6, 0.6, 0.65, 0.8, 1, 1, 0.9, 0.8, 0.7, 0.65, 0.6], fresh: [0.1, 0.1, 0.1, 0.2, 0.4, 0.8, 0.8, 0.4, 0.2, 0.1, 0.1, 0.1] },
  curl:    { amt: [0.3, 0.25, 0.2, 0.2, 0.3, 0.5, 0.8, 1, 1, 0.7, 0.5, 0.4], fresh: [0.1, 0.1, 0.1, 0.1, 0.3, 0.6, 0.8, 0.8, 0.5, 0.2, 0.1, 0.1] },
  summer:  { amt: [0.5, 0.45, 0.4, 0.35, 0.35, 0.5, 0.8, 1, 1, 0.85, 0.7, 0.6], fresh: [0.05, 0.05, 0.05, 0.05, 0.1, 0.4, 0.8, 0.8, 0.4, 0.15, 0.1, 0.05] },
  pine:    { amt: [0.8, 0.8, 0.75, 0.7, 0.7, 0.7, 0.75, 0.85, 1, 1, 0.95, 0.85], fresh: [0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0.1, 0.3, 0.6, 0.7, 0.5, 0.2] },
};
const OLD_LEAF = [[0.56, 0.52, 0.46], [0.48, 0.41, 0.33], [0.33, 0.27, 0.21]];
const oak = (cell, size, fresh, s, cups) => ({ leaf: { cell, size, fresh, old: OLD_LEAF, s: SEASONS[s] }, cups });
const broad = (cell, size, fresh, s = 'decid', old = OLD_LEAF) => ({ leaf: { cell, size, fresh, old, s: SEASONS[s] } });
const conifer = (len, rate, fresh, old, L, D, hook, coneRate, coneCol) => ({ needle: { len, rate, fresh, old, s: SEASONS.pine }, cone: { L, D, hook, rate: coneRate, col: coneCol } });
// sRGB colours; sizes in metres (a leaf's blade length, a fascicle's length, a cone's length and its width over length)
const LITTER_SP = {
  quercus_douglasii: oak(0, [0.03, 0.06], [[0.68, 0.52, 0.33], [0.6, 0.44, 0.27], [0.72, 0.6, 0.4]], 'decid', 4),
  quercus_wislizeni: oak(1, [0.025, 0.05], [[0.62, 0.55, 0.32], [0.55, 0.5, 0.3], [0.66, 0.56, 0.36]], 'live', 4),
  quercus_chrysolepis: oak(1, [0.03, 0.065], [[0.64, 0.56, 0.34], [0.56, 0.5, 0.32], [0.6, 0.48, 0.3]], 'live', 3),
  quercus_lobata: oak(2, [0.05, 0.1], [[0.66, 0.5, 0.3], [0.58, 0.42, 0.24], [0.7, 0.56, 0.36]], 'decid', 3),
  quercus_kelloggii: oak(3, [0.09, 0.18], [[0.74, 0.48, 0.24], [0.66, 0.4, 0.2], [0.7, 0.55, 0.3]], 'decid', 2),
  umbellularia_californica: broad(4, [0.05, 0.1], [[0.62, 0.58, 0.3], [0.55, 0.52, 0.28], [0.66, 0.5, 0.28]], 'bay', [[0.45, 0.4, 0.3], [0.38, 0.32, 0.24]]),
  arbutus_menziesii: { ...broad(5, [0.07, 0.12], [[0.72, 0.3, 0.18], [0.78, 0.5, 0.2], [0.6, 0.25, 0.18]], 'madrone', [[0.45, 0.32, 0.24], [0.38, 0.28, 0.2]]),
    curls: { rate: 25, size: [0.04, 0.1], col: [[0.62, 0.3, 0.2], [0.7, 0.4, 0.26], [0.5, 0.25, 0.18]], s: SEASONS.curl } },
  aesculus_californica: broad(4, [0.06, 0.14], [[0.6, 0.5, 0.32], [0.52, 0.45, 0.3], [0.66, 0.56, 0.38]], 'summer'),
  acer_macrophyllum: broad(7, [0.14, 0.28], [[0.78, 0.62, 0.25], [0.7, 0.5, 0.22], [0.72, 0.58, 0.32]]),
  platanus_racemosa: broad(7, [0.12, 0.22], [[0.66, 0.52, 0.32], [0.6, 0.46, 0.28]]),
  populus_fremontii: broad(5, [0.05, 0.09], [[0.82, 0.68, 0.3], [0.74, 0.6, 0.28]]),
  alnus_rhombifolia: broad(5, [0.05, 0.08], [[0.42, 0.4, 0.24], [0.5, 0.44, 0.28]]),
  fraxinus_latifolia: broad(4, [0.05, 0.09], [[0.7, 0.62, 0.34], [0.62, 0.56, 0.32]]),
  juglans_hindsii: broad(4, [0.06, 0.1], [[0.62, 0.55, 0.3], [0.56, 0.48, 0.28]]),
  pinus_sabiniana: conifer([0.2, 0.3], 350, [[0.72, 0.58, 0.36], [0.68, 0.6, 0.4]], [[0.62, 0.55, 0.43], [0.53, 0.46, 0.37]], [0.15, 0.25], 0.8, 1, 0.5, [0.5, 0.38, 0.24]),
  pinus_ponderosa: conifer([0.12, 0.25], 600, [[0.78, 0.5, 0.25], [0.7, 0.45, 0.22]], [[0.58, 0.44, 0.31], [0.5, 0.39, 0.29]], [0.08, 0.13], 0.75, 0.3, 0.6, [0.55, 0.4, 0.26]),
  pseudotsuga_menziesii: conifer([0.02, 0.03], 600, [[0.62, 0.45, 0.25]], [[0.45, 0.36, 0.27]], [0.05, 0.09], 0.45, 0, 1.2, [0.55, 0.42, 0.3]),
  calocedrus_decurrens: conifer([0.015, 0.03], 400, [[0.66, 0.48, 0.26]], [[0.48, 0.38, 0.28]], [0.02, 0.03], 0.45, 0, 2, [0.5, 0.36, 0.24]),
};
for (const sp of ['salix_laevigata', 'salix_lasiandra', 'salix_lasiolepis', 'salix_exigua']) LITTER_SP[sp] = broad(4, [0.05, 0.1], [[0.72, 0.64, 0.32], [0.64, 0.58, 0.3]]);
// a library species not in the table, by its foliage: needles as a pine's without cones, scales as the cedar's,
// leaves lanceolate at their size, deciduous or not
const litterOf = new Map();
function litterSpecies(id) {
  if (litterOf.has(id)) return litterOf.get(id);
  let e = LITTER_SP[id] || null;
  const spec = LIBRARY[id];
  if (!e && spec && !spec.shrub) {
    const f = spec.foliage || {}, sz = f.leaf_size_m || 0.06;
    if (f.type === 'needle') e = { needle: { ...LITTER_SP.pinus_ponderosa.needle, len: [sz * 0.7, sz * 1.2] } };
    else if (f.type === 'scale') e = { needle: LITTER_SP.calocedrus_decurrens.needle };
    else e = broad(4, [sz * 0.6, sz * 1.1], [[0.64, 0.55, 0.32], [0.58, 0.48, 0.3]], spec.deciduous ? 'decid' : 'bay');
  }
  if (e) {   // linear colours, the leaf rate (smaller leaves lie thicker: 150 a square metre at 4.5 cm), the wood
    e = { ...e };
    for (const k of ['leaf', 'needle', 'curls']) if (e[k]) e[k] = { ...e[k], fresh: (e[k].fresh || e[k].col).map(c => linRGB(...c)), old: (e[k].old || e[k].col).map(c => linRGB(...c)) };
    if (e.leaf) e.leaf.rate = Math.min(Math.max(150 * (0.045 / ((e.leaf.size[0] + e.leaf.size[1]) / 2)) ** 1.2, 20), 200);
    if (e.cone) e.cone = { ...e.cone, lin: linRGB(...e.cone.col) };
    const dw = spec?.deadwood?.rgb || [140, 130, 118];
    e.wood = linRGB(dw[0] / 255, dw[1] / 255, dw[2] / 255);
  }
  litterOf.set(id, e); return e;
}

export class Litter {
  constructor(tile, scene, { terrain = null, atmosphere = null, veg = null } = {}) {
    Object.assign(this, { tile, scene, terrain, atmosphere, veg });
    this.on = true; this.cells = new Map(); this.scale = bodyScale.v; this.R = ringRadius(this.scale);
    this.stats = { cells: 0, planned: 0, planMs: 0, fillMs: 0, fills: 0, reseats: 0, crowns: 0 };
    for (const k of KINDS) this.stats[k] = 0;
    this.crowns = null; this.crownsV = -1;
    this.fungi = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fungi') === '1';   // the fungi placeholder (FUNGI), off by default
    this.group = new THREE.Group(); this.group.name = 'litter'; this.group.visible = false; this.group.userData.litter = this;
    scene.add(this.group);
    this.ring = { value: new THREE.Vector4(0, 0, this.R, 2.5) };
    if (!atmosphere || !tile.heights) { this.enabled = false; return; }
    this.enabled = true;
    // The GroundDetail mask's bytes: three drops them once the texture is uploaded (groundDetail.js releaseTexture),
    // which is after this (the world's first render); holding the array keeps it for the placement here. When it is
    // gone already, the same mask is built again in slices from update().
    const mt = terrain?.detail?.mask?.texture;
    this.mask = mt?.image?.data || null; this.maskW = mt?.image?.width || 0;
    if (!this.mask) this.maskGen = buildDetailMaskSteps(tile);
    this.readMasks();
    this.leafTex = leafTexture();
    this.geos = {
      grit: stoneGeometry(0, 31), stone: stoneGeometry(1, 47), leaf: leafGeometry(), acorn: acornGeometry(),
      twig: lineGeometry({ sides: 5, rings: 7, bend: [0.06, 0.02], arch: 0, taper: 0.45, ribbon: false }),
      stem: lineGeometry({ sides: 3, rings: 7, bend: [0.05, 0.015], arch: 0.03, taper: 0.4, ribbon: false }),
      needle: fascicleGeometry(), cone: coneGeometry(), wood: woodGeometry(), pebble: stoneGeometry(2, 63, 0), fungus: fungusGeometry(),
    };
    this.mats = {}; this.meshes = {};
    for (const k of KINDS) {
      this.mats[k] = litterMaterial(k, atmosphere, this.ring, this.leafTex);
      const m = new THREE.InstancedMesh(this.geos[k], this.mats[k], 1);
      m.count = 0; m.frustumCulled = false; m.name = `litter ${k}`; m.userData.cap = 0;
      this.ensure(m, 1024);
      this.meshes[k] = m; this.group.add(m);
    }
    this.seasonV = -1; this.fine = tile.heights.fine; this.micro = null; this.microV = -1;
    this.fillAt = null; this.dirty = true; this.sinceFill = 0;
    this.unhook = onBodyScale(v => this.setScale(v));
    this.setScale(bodyScale.v);
  }
  // The habitat weights (masks.png: R grassland, G oak woodland, B chaparral) at 10 m, read once from the image the
  // terrain uploads (rows north first). Without it the habitat classes stand in (1 oak, 4 chaparral, 5 grassland).
  readMasks() {
    const img = this.tile.masksImage; this.hab = null;
    try {
      if (!img?.width) throw new Error('no masks image');
      const W = 1000, c = document.createElement('canvas'); c.width = c.height = W;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img.bitmap || img, 0, 0, W, W);
      this.hab = { d: ctx.getImageData(0, 0, W, W).data, W };
    } catch (e) { console.warn('litter: habitat weights from the classes (', e.message, ')'); }
  }
  setScale(v) {
    this.scale = v; this.R = ringRadius(v);
    const r0 = Math.max(2.5, 0.45 * this.R);
    this.ring.value.z = this.R; this.ring.value.w = r0; this.r0 = r0;
    this.dirty = true; this.fillAt = null;
  }
  set(on) { this.on = !!on; if (!this.on) this.group.visible = false; }
  ensure(m, n) {
    if (n <= m.userData.cap) return;
    const cap = Math.max(n, Math.ceil(m.userData.cap * 1.6), 1024);
    const im = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16).setUsage(THREE.DynamicDrawUsage);
    const ic = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const ir = new THREE.InstancedBufferAttribute(new Float32Array(cap * AUX), AUX).setUsage(THREE.DynamicDrawUsage);
    m.instanceMatrix = im; m.geometry.setAttribute('aLitC', ic); m.geometry.setAttribute('aLitR', ir); m.userData.cap = cap;
  }

  // ---- the material weights (terrain.js GROUND_GLSL's mk block, in JS) ----
  // Fills `o` with the densities 0..1 at (x, north): g gravel (+ rock), rk the rock share of it, l litter, s thatch,
  // c chaparral weight, and keep (rockKeep).
  weightsAt(x, north, o) {
    const t = this.tile, size = t.size, z = -north;
    const MW = this.maskW, mu = x / size * MW - 0.5, mv = north / size * MW - 0.5, M = this.mask;
    let slope = bil(M, MW, MW, mu, mv, 0) / 255 * 90;
    const curv = bil(M, MW, MW, mu, mv, 1) / 255 * 2 - 1, bare = bil(M, MW, MW, mu, mv, 2) / 255;
    const hf = t.heights;
    if (hf.detail) {   // a lidar tile: the steeper of the mask's slope and the drawn ground's own (terrain.js geoSlope)
      const gx = (hf.at(x + 1, north) - hf.at(x - 1, north)) / 2, gn = (hf.at(x, north + 1) - hf.at(x, north - 1)) / 2;
      slope = Math.max(slope, Math.atan(Math.hypot(gx, gn)) * 180 / Math.PI);
    }
    const cv = t.canopy, tree = cv ? Math.min(Math.max(bil(cv.img.data, cv.img.width, cv.img.height, x / cv.res - 0.5, (size - north) / cv.res - 0.5, 0) / 100, 0), 1) : 0;
    const rd = t.roads, road = rd ? bil(rd.img.data, rd.img.width, rd.img.height, x / rd.res - 0.5, (size - north) / rd.res - 0.5, 0) / 255 : 0;
    let wr, wg, wb;
    if (this.hab) {
      const H = this.hab, res = size / H.W, fx = x / res - 0.5, fy = (size - north) / res - 0.5;
      wr = bil(H.d, H.W, H.W, fx, fy, 0) / 255; wg = bil(H.d, H.W, H.W, fx, fy, 1) / 255; wb = bil(H.d, H.W, H.W, fx, fy, 2) / 255;
    } else {
      const cls = t.habitat ? t.habitat.at(x, north) : 0;
      wr = cls === 5 ? 1 : 0; wg = cls === 1 ? 1 : 0; wb = cls === 4 ? 1 : 0;
    }
    const unpave = 1 - smooth(0.55, 0.75, road); wr *= unpave; wg *= unpave; wb *= unpave;
    const bn = rnoise(x + 11, z + 11, 0.8, 3.1) - 0.5;
    const rock = Math.max(smooth(24, 32, slope), Math.max(smooth(0.35, 0.7, -curv), smooth(0.7, 0.9, bare)));
    const pave = smooth(0.42, 0.68, road + 0.22 * bn + 0.18 * (rnoise(x + 3.3, z + 3.3, 2.4, 0.9) - 0.5));
    const wt = this._wt || (this._wt = new Float64Array(5));
    wt[0] = wr * (1 - 0.8 * tree);
    wt[1] = Math.min(Math.max(Math.max(tree * 1.5, wg * 0.5), 0), 1);
    wt[2] = Math.min(Math.max(0.06 + 0.7 * wb + smooth(0.25, 0.6, bare) + 0.8 * smooth(0.15, 0.5, curv), 0), 1);
    wt[3] = rock;
    for (let i = 0; i < 3; i++) wt[i] *= (1 - 0.8 * rock) * Math.max(1 + (i < 2 ? -bn : bn) * 0.8, 0);
    wt[3] *= Math.max(1 + bn * 0.6, 0);
    for (let i = 0; i < 4; i++) wt[i] *= 1 - pave;
    wt[4] = pave;
    // the top two, the third subtracted from both (as the shader blends them)
    let i1 = 0; for (let i = 1; i < 5; i++) if (wt[i] > wt[i1]) i1 = i;
    let i2 = i1 === 0 ? 1 : 0; for (let i = 0; i < 5; i++) if (i !== i1 && wt[i] > wt[i2]) i2 = i;
    let w3 = 0; for (let i = 0; i < 5; i++) if (i !== i1 && i !== i2) w3 = Math.max(w3, wt[i]);
    const a1 = Math.max(wt[i1] - w3, 0), a2 = Math.max(wt[i2] - w3, 0), b = a2 / Math.max(a1 + a2, 1e-4);
    const pres = i => (i === i1 ? 1 - b : i === i2 ? b : 0) * Math.min(1, wt[i] / 0.5);
    const pg = pres(2), pr = pres(3);
    o.g = pg + 0.8 * pr; o.rk = o.g > 0 ? 0.8 * pr / o.g : 0; o.l = pres(1); o.s = pres(0); o.c = wb;
    o.keep = t.outcrop ? rockKeep(t, x, north) : 1;
    return o;
  }

  // ---- the near trees overhead (the close layer) ----
  // The trees of the near set (vegetation.js nearPlants) on a 10 m grid, each in every bucket its drip line reaches:
  // x, north, crown half-width R, bole radius tr, old, snag, its species' litter (litterSpecies) and a hash of its id.
  // Rebuilt when the near set is refreshed; the first time, the cells planned without it are planned again.
  buildCrowns() {
    const P = this.veg?.nearPlants; this.crownsV = this.veg?.nearVersion ?? -1;
    if (!P?.length) return;
    const G = new Map(); let n = 0;
    for (const p of P) {
      if (!(p.crownR > 0.4) || LIBRARY[p.species]?.shrub) continue;
      const L = litterSpecies(p.species); if (!L) continue;
      const t = { x: p.x, n: -p.z, R: p.crownR, tr: p.trunkR || 0.1, old: !!p.old, snag: !!p.snag, L, h: h32(p.id >>> 0, 0x5eed, 7) };
      const reach = 1.35 * t.R + 1;
      for (let j = Math.floor((t.n - reach) / 10); j <= Math.floor((t.n + reach) / 10); j++)
        for (let i = Math.floor((t.x - reach) / 10); i <= Math.floor((t.x + reach) / 10); i++) {
          const key = j * 8192 + i; let b = G.get(key); if (!b) G.set(key, b = []); b.push(t);
        }
      n++;
    }
    const was = !!this.crowns; this.crowns = G; this.stats.crowns = n;
    if (!was) this.cells.clear();
    // the duff under the crowns gives the micro relief its height (terrain.js MicroPatch.node)
    const w = new Float64Array(256);
    this.tile.closeDuff = (x, north) => {
      const b = G.get(Math.floor(north / 10) * 8192 + Math.floor(x / 10)); if (!b) return 0;
      let deep = 0; const C = this.cover(b, x, north, w);
      for (let k = 0; k < b.length && k < 256; k++) if (w[k] > 0) deep = Math.max(deep, w[k] * (b[k].old ? 1.4 : 1) * (b[k].L.needle ? 1.25 : 1));
      return Math.min(Math.max(C, deep), 1.5);
    };
  }
  // The cover of the trees `b` at (x, north): each tree's w into w[], 1 - prod(1 - w) returned. Nothing at the bole.
  cover(b, x, north, w) {
    let keep = 1;
    for (let k = 0; k < b.length && k < 256; k++) {
      const t = b[k], d = Math.hypot(x - t.x, north - t.n), v = d < t.tr ? 0 : 1 - smooth(0.75 * t.R, 1.35 * t.R + 0.5, d);
      w[k] = v; keep *= 1 - v;
    }
    return 1 - keep;
  }
  // one of them, by weight, for a draw u in [0, 1)
  pickTree(b, w, u) {
    let S = 0; const n = Math.min(b.length, 256); for (let k = 0; k < n; k++) S += w[k];
    let a = u * S; for (let k = 0; k < n; k++) { a -= w[k]; if (a <= 0 && w[k] > 0) return b[k]; }
    return b[n - 1];
  }
  // The close layer's share of a cell: the litter of the trees whose crowns reach it (see the header).
  planCrowns(trees, x0, n0, mo, r, push, skip) {
    const W = this._cw || (this._cw = new Float64Array(256)), A = CELL * CELL;
    const along = (o, k) => o.s[k][mo];
    let maxLeaf = 0, maxNeedle = 0, maxCone = 0, maxCup = 0, maxCurl = 0;
    for (const t of trees) {
      const L = t.L; if (t.snag) continue;
      if (L.leaf) maxLeaf = Math.max(maxLeaf, L.leaf.rate * along(L.leaf, 'amt'));
      if (L.needle) maxNeedle = Math.max(maxNeedle, L.needle.rate * along(L.needle, 'amt'));
      if (L.cone) maxCone = Math.max(maxCone, L.cone.rate);
      if (L.cups) maxCup = Math.max(maxCup, L.cups * ACORN_SEASON[mo]);
      if (L.curls) maxCurl = Math.max(maxCurl, L.curls.rate * along(L.curls, 'amt'));
    }
    const candidate = () => { const u = r() * CELL, v = r() * CELL, x = x0 + u, n = n0 + v; const C = this.cover(trees, x, n, W); return { u, v, x, n, C }; };
    // leaves, clumped a little by a ~0.7 m noise (drifts against stems and stones)
    const NL = Math.round(A * maxLeaf * 1.55);
    for (let k = 0; k < NL; k++) {
      const { u, v, x, n, C } = candidate();
      if (r() >= C) continue;
      const t = this.pickTree(trees, W, r()), L = t.L.leaf; if (!L || t.snag) continue;
      const clump = 0.45 + 1.1 * vnoise(x / 0.7 + 3.1, n / 0.7 + 1.7);
      if (r() * maxLeaf * 1.55 >= L.rate * along(L, 'amt') * clump) continue;
      if (skip(x, n, u, v, r())) continue;
      const fresh = r() < along(L, 'fresh'), s = L.size[0] + (L.size[1] - L.size[0]) * r();
      const dome = !fresh && r() < 0.35, curl = dome ? -(0.25 + 0.5 * r()) : fresh ? 0.1 + 0.4 * r() : 0.3 + 0.8 * r();
      const c0 = pick(fresh ? L.fresh : L.old, r()), m = 0.85 + 0.3 * r();
      push('leaf', x, n, r() * Math.PI * 2, s, curl, 0.9 + 0.2 * r(), 0, 0, [c0[0] * m, c0[1] * m, c0[2] * m], L.cell);
    }
    // madrone's bark: thin red curls shed in summer
    const NC = Math.round(A * maxCurl);
    for (let k = 0; k < NC; k++) {
      const { u, v, x, n, C } = candidate();
      if (r() >= C) continue;
      const t = this.pickTree(trees, W, r()), L = t.L.curls; if (!L) continue;
      if (r() * maxCurl >= L.rate * along(L, 'amt')) continue;
      if (skip(x, n, u, v, r())) continue;
      const fresh = r() < along(L, 'fresh'), c0 = pick(fresh ? L.fresh : L.old, r()), m = 0.85 + 0.3 * r();
      push('leaf', x, n, r() * Math.PI * 2, L.size[0] + (L.size[1] - L.size[0]) * r(), 0.9 + 0.5 * r(), 0.55 + 0.2 * r(), 0, 0, [c0[0] * m, c0[1] * m, c0[2] * m], 6);
    }
    // needles in fascicles (pines), short single needles and sprays (Douglas-fir, incense cedar); the duff's top layer
    const NN = Math.round(A * maxNeedle);
    for (let k = 0; k < NN; k++) {
      const { u, v, x, n, C } = candidate();
      if (r() >= C) continue;
      const t = this.pickTree(trees, W, r()), L = t.L.needle; if (!L || t.snag) continue;
      if (r() * maxNeedle >= L.rate * along(L, 'amt')) continue;
      if (skip(x, n, u, v, r())) continue;
      const len = L.len[0] + (L.len[1] - L.len[0]) * r(), rad = len > 0.08 ? 0.0008 + 0.0003 * r() : 0.0006;
      const fresh = r() < along(L, 'fresh'), c0 = pick(fresh ? L.fresh : L.old, r()), m = 0.85 + 0.3 * r();
      push('needle', x, n, r() * Math.PI * 2, len, 0, 0, 0, 0, [c0[0] * m, c0[1] * m, c0[2] * m], rad / len, Math.min(len, 0.015));
    }
    // cones: lying on their sides, any roll; the older ones greyer
    const NK = Math.round(A * maxCone + r());
    for (let k = 0; k < NK; k++) {
      const { u, v, x, n, C } = candidate();
      if (r() >= C) continue;
      const t = this.pickTree(trees, W, r()), L = t.L.cone; if (!L) continue;
      if (r() * maxCone >= L.rate * (t.snag ? 0.3 : 1)) continue;
      if (skip(x, n, u, v, r())) continue;
      const len = L.L[0] + (L.L[1] - L.L[0]) * r(), age = r(), m = 0.85 + 0.3 * r(), grey = 0.45 * age;
      const c = L.lin.map((q, i) => (q * (1 - grey) + [0.3, 0.29, 0.27][i] * grey) * m);
      push('cone', x, n, r() * Math.PI * 2, len, L.D * (0.9 + 0.2 * r()), r() * Math.PI * 2, 0, 0, c, L.hook);
    }
    // acorn caps (a fifth of them whole acorns) under the oaks, in autumn
    const NA = Math.round(A * maxCup + r());
    for (let k = 0; k < NA; k++) {
      const { u, v, x, n, C } = candidate();
      if (r() >= C) continue;
      const t = this.pickTree(trees, W, r()); if (!t.L.cups || t.snag) continue;
      if (r() * maxCup >= t.L.cups * ACORN_SEASON[mo]) continue;
      if (skip(x, n, u, v, r())) continue;
      const nut = r() < 0.2, m = 0.85 + 0.3 * r();
      push('acorn', x, n, r() * Math.PI * 2, 0.012 + 0.01 * r(), nut ? 1 : 0, r() < 0.45 ? 1 : 0, r(), 0, [m, m, m], nut ? 1 : 0);
    }
    // twigs and fallen branches: more under old trees, most round a snag
    const NT = Math.round(A * 10);
    for (let k = 0; k < NT; k++) {
      const { u, v, x, n, C } = candidate();
      if (r() >= C) continue;
      const t = this.pickTree(trees, W, r());
      if (r() >= (t.snag ? 1 : t.old ? 0.8 : 0.5)) continue;
      if (skip(x, n, u, v, r())) continue;
      const q = r(), L = 0.05 + 0.3 * q * q, rad = (0.0015 + 0.004 * r()) * (0.7 + 0.6 * Math.sqrt(q)), c0 = pick(TWIG_COL, r()), m = 0.85 + 0.3 * r();
      push('twig', x, n, r() * Math.PI * 2, L, 0, 0, 0, 0, [c0[0] * m, c0[1] * m, c0[2] * m], rad / L);
    }
    const NB = Math.round(A * 0.6 + r());
    for (let k = 0; k < NB; k++) {
      const { u, v, x, n, C } = candidate();
      if (r() >= C) continue;
      const t = this.pickTree(trees, W, r()), rate = 0.08 * (t.old ? 3 : 1) * (t.snag ? 5 : 1);
      if (r() * 0.6 >= rate) continue;
      if (skip(x, n, u, v, r())) continue;
      const big = t.old || t.snag, q = r(), L = 0.35 + (big ? 2.8 : 1.4) * q * q, rad = Math.min(0.012 + (big ? 0.07 : 0.035) * r() * (0.5 + q), 0.4 * t.tr + 0.01);
      const fresh = r(), c = t.L.wood.map((w, i) => (w * (0.55 + 0.45 * fresh) + [0.2, 0.16, 0.13][i] * (1 - fresh) * 0.6) * (0.85 + 0.3 * r()));
      const yaw = r() * Math.PI * 2;
      push('wood', x, n, yaw, L, 0.12, rad / L, 0, 0, c, rad / L);
      // brackets along a fallen branch in the wet months (the fungi placeholder)
      const F0 = this.fungi && FUNGI[0];
      if (F0 && F0.months[mo] > 0 && r() < 0.6) {
        const nb = Math.round(F0.per * F0.months[mo] * (0.5 + r()) * L);
        for (let b = 0; b < nb; b++) {
          const along = (r() - 0.5) * L * 0.8, side = r() < 0.5 ? -1 : 1, bx = x + Math.cos(yaw) * along - Math.sin(yaw) * side * rad * 0.9, bn = n - Math.sin(yaw) * along - Math.cos(yaw) * side * rad * 0.9;
          const fs = F0.size[0] + (F0.size[1] - F0.size[0]) * r(), c0 = linRGB(...pick(F0.col, r()));
          push('fungus', bx, bn, r() * Math.PI * 2, fs, rad * 1.4, 0, 0, 0, c0, 1);
        }
      }
    }
    // capped mushrooms in the oak litter (the fungi placeholder)
    const F1 = this.fungi && FUNGI[1];
    if (F1 && F1.months[mo] > 0) {
      const NF = Math.round(A * F1.per * F1.months[mo] + r());
      for (let k = 0; k < NF; k++) {
        const { u, v, x, n, C } = candidate();
        if (r() >= C) continue;
        const t = this.pickTree(trees, W, r()); if (!t.L.cups) continue;
        if (skip(x, n, u, v, r())) continue;
        const ring = 1 + Math.floor(r() * 4);   // in small troops
        for (let q = 0; q < ring; q++) {
          const fs = F1.size[0] + (F1.size[1] - F1.size[0]) * r(), c0 = linRGB(...pick(F1.col, r()));
          push('fungus', x + (r() - 0.5) * 0.15, n + (r() - 0.5) * 0.15, r() * Math.PI * 2, fs, 0, 0, 0, 0, c0, 0);
        }
      }
    }
    // surface roots: from boles past 12 cm, three to seven, half buried, laid in the cell holding their middle
    for (const t of trees) {
      if (t.tr < 0.12 || t.snag && t.tr < 0.2) continue;
      const rr = mulberry32(t.h), NR = 3 + Math.floor(rr() * 4) + (t.old ? 2 : 0);
      for (let k = 0; k < NR; k++) {
        const a = (k + 0.3 + 0.4 * rr()) / NR * Math.PI * 2, L = (0.5 + 1.1 * rr()) * (0.6 + 3 * t.tr), rad = t.tr * (0.16 + 0.12 * rr());
        const dx = Math.cos(a), dn = Math.sin(a), mid = t.tr * 0.8 + L / 2, x = t.x + dx * mid, n = t.n + dn * mid, sink = 0.55 + 0.25 * rr();
        if (x < x0 || x >= x0 + CELL || n < n0 || n >= n0 + CELL) continue;
        if (skip(x, n, x - x0, n - n0, 0)) continue;
        const m = 0.8 + 0.25 * rr(), c = t.L.wood.map((w, i) => (w * 0.15 + [0.16, 0.11, 0.075][i] * 0.85) * m);   // bark-brown, soiled
        push('wood', x, n, -a, L, sink, rad / L, 0, 0, c, rad / L);
      }
    }
  }
  // Rounded, water-worn pebbles 0.6-4 cm lying thick on a bar or on the dry bed and margin of a gravel or cobble reach
  // (tile.water: its bar flag, zones channel and margin, bed material); rocks.js lays the stones from 5 cm up there.
  planBar(x0, n0, r, push, skip) {
    const Wg = this.tile.water; if (!Wg) return;
    const barAt = (x, n) => Wg.bar(x, n) || (Wg.zone(x, n) <= 2 && Wg.zone(x, n) >= 1 && Wg.material(x, n) >= 3);
    if (!(barAt(x0 + 1, n0 + 1) || barAt(x0, n0) || barAt(x0 + CELL - 0.01, n0) || barAt(x0, n0 + CELL - 0.01) || barAt(x0 + CELL - 0.01, n0 + CELL - 0.01))) return;
    const N = Math.round(CELL * CELL * 160);
    for (let k = 0; k < N; k++) {
      const u = r() * CELL, v = r() * CELL, x = x0 + u, n = n0 + v;
      if (!barAt(x, n) || skip(x, n, u, v, 0)) continue;
      const q = r(), s = 0.006 + 0.034 * q * q * q;
      const cu = r(); let acc = 0, e = STONE_COL[0]; for (const sc of STONE_COL) { acc += sc[3]; if (cu < acc) { e = sc; break; } }
      const m = (0.9 + 0.3 * r()), pale = 0.25 * r();
      push('pebble', x, n, r() * Math.PI * 2, s, 0.4 + 0.3 * r(), 0.65 + 0.3 * r(), r(), r(), e.slice(0, 3).map(c => (c + (0.6 - c) * pale) * m), 0);
    }
  }

  // ---- planning one 2 m cell ----
  plan(ci, cj) {
    const t = this.tile, x0 = ci * CELL, n0 = cj * CELL, r = mulberry32(h32(ci, cj, SALT));
    // densities on a 3 x 3 grid of 1 m spacing, bilinear between
    const S = []; let gMax = 0, lMax = 0, tMax = 0, sMax = 0;
    for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
      const o = this.weightsAt(x0 + a, n0 + b, {}); S.push(o);
      gMax = Math.max(gMax, o.g); lMax = Math.max(lMax, o.l); sMax = Math.max(sMax, o.s); tMax = Math.max(tMax, o.l + 0.5 * o.c * o.g);
    }
    const at = (u, v, k) => {   // u, v in metres within the cell
      const a = Math.min(Math.floor(u), 1), b = Math.min(Math.floor(v), 1), fu = u - a, fv = v - b;
      const A = S[b * 3 + a][k], B = S[b * 3 + a + 1][k], C = S[(b + 1) * 3 + a][k], D = S[(b + 1) * 3 + a + 1][k];
      return (A * (1 - fu) + B * fu) * (1 - fv) + (C * (1 - fu) + D * fu) * fv;
    };
    // oak share and the blue / live split, per 30 m cell (the species mix, else the habitat class)
    let oak = 0.6, blue = 0.5;
    const hab = t.habitat, cx = x0 + 1, cn = n0 + 1;
    if (hab) {
      const [hi, hj] = hab.cellOf(cx, cn), row = t.speciesMix?.at?.(hi, hj), cls = hab.channel(hi, hj, 0);
      if (row?.trees) {
        let q = 0; for (const [k, w] of Object.entries(row.trees)) if (/quercus|oak/i.test(k)) q += w;
        oak = Math.min(1, q + 0.1);
        const ob = row.oaks?.blue || 0, ol = row.oaks?.live || 0; if (ob + ol > 0) blue = ob / (ob + ol);
      } else oak = { 1: 0.95, 2: 0.1, 3: 0.5, 6: 0.4, 4: 0.5 }[cls] ?? 0.6;
    }
    const date = seasonState.date || new Date(), mo = date.getMonth();
    const leafK = LEAF_SEASON[mo] * oak, acornK = ACORN_SEASON[mo] * oak, fresh = FRESH_SEASON[mo];
    const wm = t.waterMask;
    const wet = wm && (wm.bucket(x0, n0) || wm.bucket(x0 + CELL, n0) || wm.bucket(x0, n0 + CELL) || wm.bucket(x0 + CELL, n0 + CELL));
    const skip = (x, n, u, v, rr) => (wet && wm.inWater(x, n)) || rr > at(u, v, 'keep');
    const out = {}; for (const k of KINDS) out[k] = { spec: [], col: [], aux: [] };
    const push = (k, x, n, yaw, s, p0, p1, p2, p3, c, variant, reachS = s) => {
      const o = out[k]; o.spec.push(x, n, yaw, s, p0, p1, p2, p3); o.col.push(c[0], c[1], c[2]); o.aux.push(r(), variant, reachS);
    };
    // the trees overhead (null when the crown index is not built: then the canopy raster's litter is all there is)
    const trees = this.crowns ? (this.crowns.get(Math.floor(n0 / 10) * 8192 + Math.floor(x0 / 10)) || []) : null;
    const rasterK = trees ? 0.4 : 1, CW = this._cw2 || (this._cw2 = new Float64Array(256));
    const under = (x, n) => trees && trees.length ? this.cover(trees, x, n, CW) : 0;
    const inCell = (u, v) => u >= 0 && v >= 0 && u < CELL && v < CELL;
    // pebbles and grit, in groups
    if (gMax > 0.004) for (let k = 0; k < 32; k++) {
      const u = r() * CELL, v = r() * CELL, acc = r();
      if (acc >= at(u, v, 'g')) continue;
      const rk = at(u, v, 'rk'), sig = 0.04 + 0.12 * r(), N = 4 + Math.floor(r() * 11);
      for (let q = 0; q < N; q++) {
        const ang = r() * Math.PI * 2, rad = sig * Math.sqrt(-2 * Math.log(1 - r() * 0.999));
        const uu = u + Math.cos(ang) * rad, vv = v + Math.sin(ang) * rad;
        if (!inCell(uu, vv)) continue;
        const x = x0 + uu, n = n0 + vv;
        if (skip(x, n, uu, vv, r())) continue;
        const cl = r() - 0.25 * rk, far = Math.min(rad / (2 * sig), 1);
        let s, kind;
        if (cl < 0.58) { kind = 'grit'; s = 0.01 + 0.015 * r(); }
        else if (cl < 0.9) { kind = 'stone'; s = (0.02 + 0.02 * r()) * (1 - 0.25 * far); }
        else { kind = 'stone'; s = (0.04 + 0.02 * r()) * (1 + 0.5 * rk) * (1 - 0.25 * far); }
        // the stones' palette by weight; grit half way to the soil's tan (its own fines on it)
        const cu = r(); let acc2 = 0, e = STONE_COL[0]; for (const sc of STONE_COL) { acc2 += sc[3]; if (cu < acc2) { e = sc; break; } }
        const m = 0.85 + 0.3 * r(), gk = kind === 'grit' ? 0.5 : 0;
        const c = [0, 1, 2].map(a => (e[a] * (1 - gk) + GRIT_COL[a] * gk) * m);
        push(kind, x, n, r() * Math.PI * 2, s, 0.45 + 0.35 * r(), 0.6 + 0.35 * r(), r(), r(), c, 0);
      }
    }
    // leaves (and acorn caps) under the oaks; clumped a little by a ~0.7 m noise (drifts against stems and stones)
    // (where the crown index is known, 40 % of it outside the drawn crowns: the duff under shrubs and the cover the raster
    // sees but no near tree carries; the trees' own litter is planCrowns')
    if (lMax * leafK * rasterK > 0.003) {
      const N = Math.round(930 * lMax * leafK * rasterK);   // 150 per m2 at full weight, times the clump noise's peak (1.55)
      for (let k = 0; k < N; k++) {
        const u = r() * CELL, v = r() * CELL, x = x0 + u, n = n0 + v, acc = r();
        const clump = 0.45 + 1.1 * vnoise(x / 0.7 + 3.1, n / 0.7 + 1.7);
        if (acc * lMax * 1.55 >= at(u, v, 'l') * clump * (1 - under(x, n))) continue;
        if (skip(x, n, u, v, r())) continue;
        const live = r() > blue, s = live ? 0.025 + 0.025 * r() : 0.03 + 0.03 * r();
        const dome = r() < 0.3, curl = dome ? -(0.25 + 0.5 * r()) : 0.2 + (live ? 0.9 : 0.7) * r();
        const c0 = r() < fresh ? pick(LEAF_FRESH, r()) : pick(LEAF_OLD, r()), m = 0.85 + 0.3 * r();
        push('leaf', x, n, r() * Math.PI * 2, s, curl, 0.9 + 0.2 * r(), 0, 0, [c0[0] * m, c0[1] * m, c0[2] * m], live ? 1 : 0);
      }
      const NA = Math.round(16 * lMax * acornK * rasterK + r());
      for (let k = 0; k < NA; k++) {
        const u = r() * CELL, v = r() * CELL, x = x0 + u, n = n0 + v;
        if (r() * lMax >= at(u, v, 'l')) continue;
        if (skip(x, n, u, v, r())) continue;
        const nut = r() < 0.2, m = 0.85 + 0.3 * r();
        push('acorn', x, n, r() * Math.PI * 2, 0.012 + 0.008 * r(), nut ? 1 : 0, r() < 0.45 ? 1 : 0, r(), 0, [m, m, m], nut ? 1 : 0);
      }
    }
    // twigs under any tree cover and in the chaparral
    if (tMax > 0.004) {
      const N = Math.round(32 * tMax + r());
      for (let k = 0; k < N; k++) {
        const u = r() * CELL, v = r() * CELL, x = x0 + u, n = n0 + v;
        if (r() * tMax >= at(u, v, 'l') + 0.5 * at(u, v, 'c') * at(u, v, 'g')) continue;
        if (skip(x, n, u, v, r())) continue;
        const q = r(), L = 0.05 + 0.25 * q * q, rad = (0.0015 + 0.0035 * r()) * (0.7 + 0.6 * Math.sqrt(q)), c0 = pick(TWIG_COL, r()), m = 0.85 + 0.3 * r();
        push('twig', x, n, r() * Math.PI * 2, L, 0, 0, 0, 0, [c0[0] * m, c0[1] * m, c0[2] * m], rad / L);
      }
    }
    // dead stems lying in the grass, lodged along a direction that wanders over a few metres
    if (sMax > 0.004) {
      const N = Math.round(240 * sMax);
      for (let k = 0; k < N; k++) {
        const u = r() * CELL, v = r() * CELL, x = x0 + u, n = n0 + v;
        if (r() * sMax >= at(u, v, 's')) continue;
        if (skip(x, n, u, v, r())) continue;
        const dir = vnoise(x / 4 + 9.3, n / 4 + 2.1) * Math.PI * 4 + (r() - 0.5) * 1.4;
        const L = 0.1 + 0.2 * r(), wd = 0.0007 + 0.0007 * r(), c0 = pick(STEM_COL, r()), m = 0.85 + 0.3 * r();
        push('stem', x, n, dir, L, 0, 0, 0, 0, [c0[0] * m, c0[1] * m, c0[2] * m], wd / L);
      }
    }
    if (trees && trees.length) this.planCrowns(trees, x0, n0, mo, r, push, skip);
    this.planBar(x0, n0, r, push, skip);
    const cell = { ci, cj, seated: false, stale: true, k: {} };
    for (const k of KINDS) {
      const o = out[k], n = o.aux.length / AUX;
      let minS = Infinity; for (let q = 0; q < n; q++) minS = Math.min(minS, o.aux[q * AUX + 2]);
      cell.k[k] = { n, minS, spec: Float32Array.from(o.spec), col: Float32Array.from(o.col), aux: Float32Array.from(o.aux), mat: new Float32Array(n * 16) };
    }
    return cell;
  }

  // ---- seating a cell's instances on the surface drawn now ----
  seat(cell) {
    const hf = this.tile.heights, G = (x, n) => hf.ground(x, n);
    const nrm = (x, n, e, o) => {   // the ground's normal (scene x, y, z) from samples e m apart
      const gx = (G(x + e, n) - G(x - e, n)) / (2 * e), gn = (G(x, n + e) - G(x, n - e)) / (2 * e);
      const l = Math.hypot(gx, 1, gn); o[0] = -gx / l; o[1] = 1 / l; o[2] = gn / l; return o;   // scene z = -north
    };
    const N = [0, 0, 0];
    // columns X, Y, Z and origin into m at offset q * 16
    const put = (m, q, X, Y, Z, ox, oy, oz) => { m.set([X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, ox, oy, oz, 1], q * 16); };
    for (const kind of KINDS) {
      const K = cell.k[kind], sp = K.spec, m = K.mat;
      for (let q = 0; q < K.n; q++) {
        const o = q * REC, x = sp[o], n = sp[o + 1], yaw = sp[o + 2], s = sp[o + 3], p0 = sp[o + 4], p1 = sp[o + 5], p2 = sp[o + 6], p3 = sp[o + 7];
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        if (kind === 'grit' || kind === 'stone' || kind === 'pebble') {
          // Ryaw * S(s, s f, s w) * Rrand: the shape turned at random, flattened, laid at its yaw (flat shading takes
          // its normals from the surface, so the non-orthogonal frame is fine)
          const a = p2 * Math.PI * 2, b = p3 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
          // Rrand = Rz(b) * Rx(a): columns
          const R0 = [cb, sb, 0], R1 = [-sb * ca, cb * ca, sa], R2 = [sb * sa, -cb * sa, ca];
          const sc = [s, s * p0, s * p1];
          const col = c => { const v = [c[0] * sc[0], c[1] * sc[1], c[2] * sc[2]]; return [cy * v[0] + sy * v[2], v[1], -sy * v[0] + cy * v[2]]; };
          const hx = 0.35 * s;
          const g = Math.min(G(x, n), G(x + hx, n), G(x - hx, n), G(x, n + hx), G(x, n - hx));
          put(m, q, col(R0), col(R1), col(R2), x, g + 0.2 * s * p0, -n);
        } else if (kind === 'leaf' || kind === 'stem' || kind === 'needle') {
          nrm(x, n, Math.max(0.15, s * 0.5), N);
          let tx = cy, tz = sy; const d = tx * N[0] + tz * N[2]; let ty = -d * N[1]; tx -= d * N[0]; tz -= d * N[2];
          const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
          const bx = ty * N[2] - tz * N[1], by = tz * N[0] - tx * N[2], bz = tx * N[1] - ty * N[0];   // X x Y
          const g = G(x, n);
          if (kind === 'leaf') {
            // the blade spans 0.84 of its atlas cell's length: the quad is that much longer than the leaf, and as wide
            // (the cell is square; p1 varies the width a little)
            const L = s / 0.84, ys = s * p0, lift = 0.0015 + (ys < 0 ? -ys * LEAF_YMAX : 0), w = L * p1;
            put(m, q, [tx * L, ty * L, tz * L], [N[0] * ys, N[1] * ys, N[2] * ys], [bx * w, by * w, bz * w], x + N[0] * lift, g + N[1] * lift, -n + N[2] * lift);
          } else put(m, q, [tx * s, ty * s, tz * s], [N[0] * s, N[1] * s, N[2] * s], [bx * s, by * s, bz * s], x, g + 0.001, -n);
        } else if (kind === 'cone') {
          // the axis along the ground at its yaw, rolled about it by p1; its middle a little under its widest radius
          nrm(x, n, Math.max(0.1, s * 0.5), N);
          let tx = cy, tz = sy; const d = tx * N[0] + tz * N[2]; let ty = -d * N[1]; tx -= d * N[0]; tz -= d * N[2];
          const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
          const bx = ty * N[2] - tz * N[1], by = tz * N[0] - tx * N[2], bz = tx * N[1] - ty * N[0];
          const D = s * p0, cr = Math.cos(p1), sr = Math.sin(p1), g = G(x, n), lift = 0.42 * D;
          const Y = [(cr * N[0] + sr * bx) * D, (cr * N[1] + sr * by) * D, (cr * N[2] + sr * bz) * D];
          const Z = [(-sr * N[0] + cr * bx) * D, (-sr * N[1] + cr * by) * D, (-sr * N[2] + cr * bz) * D];
          put(m, q, [tx * s, ty * s, tz * s], Y, Z, x + N[0] * lift, g + N[1] * lift, -n + N[2] * lift);
        } else if (kind === 'fungus') {
          // upright on the ground (a cap) or a shelf at p0 up (a bracket on its branch's side)
          const g = G(x, n), h = s * 0.8;
          put(m, q, [cy * s, 0, sy * s], [0, h, 0], [-sy * s, 0, cy * s], x, g + p0 - (p0 > 0 ? 0.56 * h : 0.01), -n);
        } else if (kind === 'twig' || kind === 'wood') {
          const hx = cy * s / 2, hn = -sy * s / 2;   // yaw is in scene x, z: north = -z
          const g1 = G(x - hx, n - hn), g2 = G(x + hx, n + hn), gc = G(x, n);
          let Xx = 2 * hx, Xy = g2 - g1, Xz = -2 * hn; const L = Math.hypot(Xx, Xy, Xz); Xx /= L; Xy /= L; Xz /= L;
          let Yx = -Xy * Xx, Yy = 1 - Xy * Xy, Yz = -Xy * Xz; const yl = Math.hypot(Yx, Yy, Yz); Yx /= yl; Yy /= yl; Yz /= yl;
          const Zx = Xy * Yz - Xz * Yy, Zy = Xz * Yx - Xx * Yz, Zz = Xx * Yy - Xy * Yx;
          // a branch sinks p0 of its diameter (2 p1 s) into the litter; a root about half
          const sink = kind === 'wood' ? 2 * p0 * p1 * s : 0;
          put(m, q, [Xx * s, Xy * s, Xz * s], [Yx * s, Yy * s, Yz * s], [Zx * s, Zy * s, Zz * s], x, Math.max(gc, (g1 + g2) / 2) - 0.002 - sink, -n);
        } else {   // acorn: cap up, cap down, or a whole acorn on its side
          nrm(x, n, 0.15, N);
          const M4 = this._m4 || (this._m4 = new THREE.Matrix4()), Q = this._q || (this._q = new THREE.Quaternion()), Q2 = this._q2 || (this._q2 = new THREE.Quaternion());
          const V = this._v || (this._v = new THREE.Vector3()), E = this._e || (this._e = new THREE.Euler());
          Q.setFromUnitVectors(V.set(0, 1, 0), V.clone().set(N[0], N[1], N[2]));
          const nut = p0 > 0.5, down = p1 > 0.5;
          E.set(nut ? 0 : down ? Math.PI : 0, yaw, nut ? Math.PI / 2 : 0, 'YXZ'); Q2.setFromEuler(E); Q.multiply(Q2);
          const lift = nut ? 0.36 * s : down ? 0.28 * s : 0, g = G(x, n);
          M4.compose(V.set(x + N[0] * lift, g + N[1] * lift - 0.001, -n + N[2] * lift), Q, this._sv || (this._sv = new THREE.Vector3(s, s, s)).set(s, s, s));
          m.set(M4.elements, q * 16);
        }
      }
    }
    cell.seated = true; cell.stale = false; this.stats.reseats++;
  }

  // ---- filling the instance buffers from the cells around (cx, cz) ----
  fill(cx, cz) {
    const t0 = performance.now(), north = -cz, R = this.R, r0 = this.r0, need = (R + MARGIN) ** 2;
    const list = [];
    for (const c of this.cells.values()) {
      if (!c.seated) continue;   // a stale seat stays drawn until its turn comes
      const ex = (c.ci + 0.5) * CELL - cx, en = (c.cj + 0.5) * CELL - north;
      if (ex * ex + en * en <= need + 4) list.push(c);
    }
    for (const kind of KINDS) {
      let total = 0; for (const c of list) total += c.k[kind].n;
      const mesh = this.meshes[kind]; this.ensure(mesh, total);
      const M = mesh.instanceMatrix.array, C = mesh.geometry.attributes.aLitC.array, A = mesh.geometry.attributes.aLitR.array;
      let q = 0;
      for (const c of list) {
        const K = c.k[kind], sp = K.spec, mat = K.mat, col = K.col, aux = K.aux;
        if (!K.n) continue;
        // a cell wholly inside every limit (full density, within the smallest instance's reach): copied whole
        if (Math.hypot((c.ci + 0.5) * CELL - cx, (c.cj + 0.5) * CELL - north) + CELL * 0.7072 - MOVE <= Math.min(r0, R, K.minS * K_REACH)) {
          M.set(mat.subarray(0, K.n * 16), q * 16); C.set(col.subarray(0, K.n * 3), q * 3); A.set(aux.subarray(0, K.n * AUX), q * AUX);
          q += K.n; continue;
        }
        for (let i = 0; i < K.n; i++) {
          const dx = sp[i * REC] - cx, dn = sp[i * REC + 1] - north, dd = Math.max(Math.sqrt(dx * dx + dn * dn) - MOVE, 0);
          if (dd > Math.min(R, aux[i * AUX + 2] * K_REACH)) continue;
          if (dd > r0 && aux[i * AUX] >= (r0 / dd) * (r0 / dd)) continue;
          for (let e = 0; e < 16; e++) M[q * 16 + e] = mat[i * 16 + e];
          C[q * 3] = col[i * 3]; C[q * 3 + 1] = col[i * 3 + 1]; C[q * 3 + 2] = col[i * 3 + 2];
          A[q * 3] = aux[i * 3]; A[q * 3 + 1] = aux[i * 3 + 1]; A[q * 3 + 2] = aux[i * 3 + 2];
          q++;
        }
      }
      mesh.count = q; this.stats[kind] = q;
      for (const at of [mesh.instanceMatrix, mesh.geometry.attributes.aLitC, mesh.geometry.attributes.aLitR]) {
        at.clearUpdateRanges(); if (q) { at.addUpdateRange(0, q * at.itemSize); at.needsUpdate = true; }
      }
    }
    this.fillAt = { x: cx, z: cz }; this.dirty = false; this.sinceFill = 0;
    this.stats.fillMs = Math.round((performance.now() - t0) * 100) / 100; this.stats.fills++;
  }

  update(dt, camera, pos) {
    if (!this.enabled) return;
    const show = this.on && this.scale < SHOW_MAX;
    if (!show) { this.group.visible = false; return; }
    const t0 = performance.now();
    if (this.maskGen) {   // the mask, rebuilt (its bytes were dropped before this was made)
      let r; do r = this.maskGen.next(); while (!r.done && performance.now() - t0 < 4);
      if (!r.done) return;
      const tex = r.value.texture; this.mask = tex.image.data; this.maskW = tex.image.width; tex.dispose(); this.maskGen = null;
    }
    const hf = this.tile.heights;
    if (seasonState.version !== this.seasonV) { this.seasonV = seasonState.version; this.cells.clear(); this.dirty = true; }
    if (this.veg && this.veg.nearVersion !== this.crownsV) { this.buildCrowns(); this.dirty = true; }
    // the surface under the litter changed: the fine square moved (every cell), or the micro patch under the body was
    // rebuilt or moved (heights.micro.version; the cells under its old square and its new one)
    if (hf.fine !== this.fine) { this.fine = hf.fine; for (const c of this.cells.values()) c.stale = true; }
    const mc = hf.micro, mv = mc ? mc.version : -1;
    if (mc !== this.micro || mv !== this.microV) {
      for (const r of [this.microRect, mc && { x0: mc.x0, x1: mc.x1, n0: mc.n0, n1: mc.n1 }]) {
        if (!r) continue;
        for (const c of this.cells.values()) {
          const x0 = c.ci * CELL, n0 = c.cj * CELL;
          if (x0 + CELL >= r.x0 && x0 <= r.x1 && n0 + CELL >= r.n0 && n0 <= r.n1) c.stale = true;
        }
      }
      this.micro = mc; this.microV = mv; this.microRect = mc && { x0: mc.x0, x1: mc.x1, n0: mc.n0, n1: mc.n1 };
    }
    const cx = pos.x, cz = pos.z, north = -cz, R = this.R;
    this.ring.value.x = cx; this.ring.value.y = cz;
    // the cells the ring needs, nearest first: planned and seated within the frame's budget
    const reach = R + MARGIN, i0 = Math.floor((cx - reach) / CELL), i1 = Math.floor((cx + reach) / CELL);
    const j0 = Math.floor((north - reach) / CELL), j1 = Math.floor((north + reach) / CELL), W = Math.ceil(this.tile.size / CELL);
    const want = [];
    for (let j = Math.max(j0, 0); j <= Math.min(j1, W - 1); j++) for (let i = Math.max(i0, 0); i <= Math.min(i1, W - 1); i++) {
      const ex = (i + 0.5) * CELL - cx, en = (j + 0.5) * CELL - north, d2 = ex * ex + en * en;
      if (d2 > (reach + 1.5) ** 2) continue;
      const key = j * 8192 + i, c = this.cells.get(key);
      if (!c || c.stale) want.push([d2, i, j, key, c]);
    }
    if (want.length) {
      want.sort((a, b) => a[0] - b[0]);
      for (const [, i, j, key, c0] of want) {
        if (performance.now() - t0 > PLAN_MS) break;
        let c = c0; if (!c) { c = this.plan(i, j); this.cells.set(key, c); this.stats.planned++; }
        this.seat(c); this.dirty = true;
      }
    }
    // drop cells well behind the ring
    if (this.cells.size > 2 * Math.PI * (reach + 6) ** 2 / (CELL * CELL) + 50) {
      const far2 = (reach + 6) ** 2;
      for (const [key, c] of this.cells) { const ex = (c.ci + 0.5) * CELL - cx, en = (c.cj + 0.5) * CELL - north; if (ex * ex + en * en > far2) this.cells.delete(key); }
    }
    this.stats.cells = this.cells.size; this.stats.planMs = Math.round((performance.now() - t0) * 100) / 100;
    this.sinceFill += dt;
    const moved = !this.fillAt || Math.hypot(cx - this.fillAt.x, cz - this.fillAt.z) > MOVE;
    if (moved || (this.dirty && (this.sinceFill > 0.12 || !want.length))) this.fill(cx, cz);
    this.group.visible = true;
  }
  // Instances the vertex shader keeps at the ring's centre now, per kind (what the GPU shades).
  drawn() {
    const out = {}, v = this.ring.value;
    for (const k of KINDS) {
      const m = this.meshes[k], M = m.instanceMatrix.array, A = m.geometry.attributes.aLitR.array; let n = 0;
      for (let q = 0; q < m.count; q++) {
        const d = Math.hypot(M[q * 16 + 12] - v.x, M[q * 16 + 14] - v.y), reach = Math.min(v.z, A[q * 3 + 2] * K_REACH);
        const keep = Math.min(d > v.w ? (v.w / d) ** 2 : 1, 1) * (1 - smooth(0.8 * reach, reach, d));
        if (A[q * 3] < keep) n++;
      }
      out[k] = n;
    }
    return out;
  }
  dispose() {
    this.enabled = false;   // update() is a no-op from here
    this.unhook?.(); this.unhook = null;
    this.scene.remove(this.group);
    for (const m of Object.values(this.meshes || {})) m.dispose?.();
    for (const g of Object.values(this.geos || {})) g.dispose();
    for (const m of Object.values(this.mats || {})) m.dispose();
    this.leafTex?.dispose();
    this.cells.clear(); this.mask = null; this.hab = null; this.maskGen = null; this.crowns = null;
    if (this.tile) this.tile.closeDuff = null;
    this.group.userData.litter = null;
  }
}
