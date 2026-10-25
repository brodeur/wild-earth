import * as THREE from 'three';
import { rockKeep } from './tilepackage.js';

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
//   A  road weight (tile.roads, 5 m, max over each 10 m texel). The shader uses the sharper 5 m
//      roads texture it already reads; A is kept for anything that wants it without that fetch.
// Habitat weights (grassland / oak / chaparral) and tree cover come from tile.masks and tile.canopy,
// which the terrain shader samples anyway.

export const DETAIL_SLOTS = [
  // name,      metres per repeat, UV rotation (rad), normal strength, albedo contrast
  { name: 'thatch',   size: 2.0, angle: 0.35, normal: 1.0,  albedo: 0.85 },   // dry grass thatch
  { name: 'litter',   size: 2.0, angle: 1.20, normal: 1.0,  albedo: 0.9 },    // oak duff / leaf litter
  { name: 'gravel',   size: 2.0, angle: 2.05, normal: 1.1,  albedo: 0.9 },    // gravelly dirt
  { name: 'rock',     size: 3.0, angle: 2.75, normal: 1.25, albedo: 0.9 },    // cobbles and rock
  { name: 'pavement', size: 2.0, angle: 0.60, normal: 0.8,  albedo: 0.8 },    // worn pavement
];
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
};

function smooth(e0, e1, x) { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); }

// 3x3 box blur of one channel of an RGBA8 buffer, in place (two passes are close to a small gaussian).
function blur(data, W, ch, passes = 1) {
  const tmp = new Float32Array(W * W);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
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
  ctx.drawImage(image, 0, 0, W, W);
  return ctx.getImageData(0, 0, W, W).data;
}

// Bilinear read of channel 0 of a Grid8 (tilepackage.js) at a point, 0..1, cell centres at (i + 0.5) * res.
function bilinear8(g, x, north) {
  const W = g.img.width, H = g.img.height, fx = x / g.res - 0.5, fy = (g.size - north) / g.res - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const v = (i, j) => g.channel(Math.min(Math.max(i, 0), W - 1), Math.min(Math.max(j, 0), H - 1), 0);
  return ((v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty) / 255;
}

export function buildDetailMask(tile, W = MASK_PX) {
  const t0 = performance.now(), size = tile.size, res = size / W, h = tile.heights;
  const out = new Uint8Array(W * W * 4);
  const photo = photoPixels(tile.imageryTextureImage || tile.textureImage, W);
  const BARREN = 8;
  // Height at DEM sample (column c, row r from the north edge), clamped: the mask's 10 m texel
  // centres fall exactly on DEM samples when the DEM is twice the mask's resolution, so the
  // central differences below read the grid directly instead of interpolating.
  const exact = h.w === 2 * W && h.h === 2 * W;
  const Z = (c, r) => h.z[Math.min(Math.max(r, 0), h.h - 1) * h.w + Math.min(Math.max(c, 0), h.w - 1)];
  for (let j = 0; j < W; j++) {
    const north = (j + 0.5) * res, prow = (W - 1 - j) * W;   // photo rows run north to south
    const r0 = h.h - 1 - 2 * j;                              // DEM row of this texel's centre (exact case)
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * res, k = (j * W + i) * 4, c0 = 2 * i + 1;
      // slope from the 5 m DEM (central differences over +-5 m) and the laplacian over 10 m
      let gx, gn, lap;
      if (exact) {
        gx = (Z(c0 + 1, r0) - Z(c0 - 1, r0)) / (2 * h.res); gn = (Z(c0, r0 - 1) - Z(c0, r0 + 1)) / (2 * h.res);
        lap = (Z(c0 + 2, r0) + Z(c0 - 2, r0) + Z(c0, r0 - 2) + Z(c0, r0 + 2) - 4 * Z(c0, r0)) / (4 * h.res * h.res);
      } else {
        const e = 5, d = 10, z = h.at(x, north);
        gx = (h.at(x + e, north) - h.at(x - e, north)) / (2 * e); gn = (h.at(x, north + e) - h.at(x, north - e)) / (2 * e);
        lap = (h.at(x + d, north) + h.at(x - d, north) + h.at(x, north + d) + h.at(x, north - d) - 4 * z) / (d * d);
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
      // road weight: max over the 2x2 5 m cells in this texel
      let road = 0;
      if (tile.roads) for (let q = 0; q < 4; q++) road = Math.max(road, tile.roads.at(x + ((q & 1) ? 2.5 : -2.5), north + ((q & 2) ? 2.5 : -2.5)));
      out[k] = Math.round(Math.min(slope / 90, 1) * 255);
      out[k + 1] = Math.round((0.5 + 0.5 * curv) * 255);
      out[k + 2] = Math.round(bare * 255);
      out[k + 3] = road;
    }
  }
  blur(out, W, 1, 1);   // curvature: one 3x3 pass (a 30 m footprint)
  blur(out, W, 2, 2);   // bare: soften the 30 m habitat squares and single-pixel photo noise
  const tex = new THREE.DataTexture(out, W, W, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  return { texture: tex, data: out, width: W, ms: Math.round(performance.now() - t0) };
}

function loadImage(url) {
  return new Promise((res, rej) => { const img = new Image(); img.decoding = 'async'; img.onload = () => res(img); img.onerror = () => rej(new Error('ground detail image failed: ' + url)); img.src = url; });
}

// Pixels of one image at DETAIL_PX, rows flipped so row 0 is the image's bottom (OpenGL v = 0):
// the normal maps' +G then points along +v, as their OpenGL convention expects.
function pixelsOf(img) {
  const c = document.createElement('canvas'); c.width = c.height = DETAIL_PX;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.translate(0, DETAIL_PX); ctx.scale(1, -1); ctx.drawImage(img, 0, 0, DETAIL_PX, DETAIL_PX);
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

// Tile-scale low-pass of a per-pixel quantity (tileable: wraps at the edges): average into a
// 64 x 64 grid, gaussian blur there (sigma in grid cells), then read back bilinearly. Used to
// take the scans' own slow gradients out (a patch a little brighter, or tilted, across one repeat),
// which is what turns a repeat into a visible grid from 50-150 m once the texture is mipped down.
const LOW_N = 64;
function lowPass(get, sigma = 6) {
  const N = DETAIL_PX, B = N / LOW_N, g = new Float32Array(LOW_N * LOW_N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g[((y / B) | 0) * LOW_N + ((x / B) | 0)] += get(y * N + x);
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
function highPassNormal(src, dst, off) {
  const N = DETAIL_PX, n = N * N;
  const lx = lowPass(i => src[i * 4] / 127.5 - 1), ly = lowPass(i => src[i * 4 + 1] / 127.5 - 1);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
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
function normaliseAlbedo(src, dst, off) {
  const n = DETAIL_PX * DETAIL_PX;
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += src[i * 4]; mg += src[i * 4 + 1]; mb += src[i * 4 + 2]; }
  mr /= n; mg /= n; mb /= n;
  const mlum = 0.299 * mr + 0.587 * mg + 0.114 * mb;
  // tile-scale brightness gradients out (85%): the slow part of the scan is the photo's job
  const low = lowPass(i => (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / mlum);
  for (let i = 0; i < n; i++) {
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
  return t;
}

export class GroundDetail {
  constructor(tile, { base = new URL('../assets/ground/', import.meta.url).href } = {}) {
    this.tile = tile; this.base = base; this.uniforms = detailUniforms; this.substituted = [];
    const m = buildDetailMask(tile);
    this.mask = m; this.maskMs = m.ms;
    detailUniforms.detailMask.value = m.texture;
    this.ready = this.load();
  }
  async load() {
    const t0 = performance.now(), L = DETAIL_SLOTS.length, S = DETAIL_PX * DETAIL_PX * 4;
    const alb = new Uint8Array(S * L), nrm = new Uint8Array(S * L);
    await Promise.all(DETAIL_SLOTS.map(async (slot, s) => {
      let a, n;
      try {
        const [ia, ina] = await Promise.all([loadImage(`${this.base}${slot.name}_albedo.jpg?v=${ASSET_VERSION}`), loadImage(`${this.base}${slot.name}_normal.jpg?v=${ASSET_VERSION}`)]);
        a = pixelsOf(ia); n = pixelsOf(ina);
      } catch (e) {
        console.warn(e.message, '- using a procedural stand-in'); this.substituted.push(slot.name);
        ({ albedo: a, normal: n } = proceduralPixels(s + 1, slot.name));
      }
      normaliseAlbedo(a, alb, s * S);
      highPassNormal(n, nrm, s * S);
    }));
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
`;
