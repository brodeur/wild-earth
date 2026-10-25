import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './trees.js';
import { hash, placementSkip } from './vegetation.js';
import { chainShader } from './treegen.js';
import { addCaster } from './shadows.js';

// Rock outcrops and boulders placed from the geology and soils step (docs/tile-spec.md "Geology and
// soils"; decision 2026-10-25 "rocks come from geology and soils data"). Nothing here is downloaded:
// every shape is a deformed icosphere built at load, and every placement is a hash of the 30 m cell,
// so the same tile gives the same rocks on every client (no Math.random).
//
// Inputs per 30 m cell (tile.outcrop, tile.geology, tile.soils; absent on older tiles: no rocks):
//   L     outcrop likelihood 0..1 (resistance x shallow soil x slope/convexity x (1 - cover/2))
//   cls   rock class (geology G, 1-based into ground_classes.rock_classes)
//   frag  surface rock fragments % (soils G); depth to bedrock (soils B) is already inside L.
// Rules:
//   outcrop cluster   L > 0.45: 2-6 main masses around a jittered cell centre, in the class's form
//                     (below), plus slate tombstones or granite corestones; their size grows with L.
//   boulders / float  L 0.15-0.45 ramps 0 -> 12 per cell; fragments > 25 % add 2-8 per cell (times
//                     1 - tree cover / 2); an outcrop cell has 4-10 of talus; serpentinite x1.6;
//                     at most 20 per cell. Sizes 0.4-2 m (serpentinite rubble to 1.3 m), truncated
//                     Pareto (most are small), 60 % clumped around two centres in the cell.
//   skips             vegetation.js placementSkip (road pavement, ponds, stream channels), never a
//                     rock whose centre or either end is on one.
// Forms (the look from each lithology, Mother Lode belt):
//   fin    slate / phyllite: thin steep fins along the regional strike (STRIKE_DEG, about N35W),
//          leaning a little to the north-east dip, low reefs 2-12 m long plus upright tombstones,
//          dark grey with a slight sheen, rust streaks, lichen.
//   schist thicker, rounder fins along the same strike, wavy foliation, silvery grey.
//   knob   greenstone (and volcanic, marble): rounded knobby masses with a few fracture faces, dark
//          grey-green, heavily lichened.
//   dome   granitic: low broad domes with rounded corestones, some split in two; pale, speckled.
//   block  serpentinite (and sandstone): smooth blue-grey-green blocks with flat joint faces, waxy
//          sheen (Phong specular), plenty of rubble around.
// Placement on the ground: the rock's ground line (a fraction 20-30 % up its height, so that much is
// buried) is put on a plane fitted to the rendered terrain mesh (10 m triangles, sampled exactly)
// across the rock's footprint, by a vertical shear: rocks stay upright and fins keep their dip while
// the base follows the slope. It is lowered by the largest gap between that plane and the mesh under
// the footprint, so no edge floats on a bend. The vertex shader takes the inverse transpose of the
// instance matrix for normals (three's own instancing assumes no shear).
//
// Distance bands (3D distance from the camera to the rock's ground point), each the same shape
// (same variant, same instance matrix) at a lower icosphere detail:
//   close   outcrop masses, detail 8 (1620 triangles), to CLOSE_R +- CLOSE_W (60 m)
//   near    the masses at detail 2 (180 triangles), to NEAR_R +- NEAR_W (250 m)
//   far     the masses at detail 1 (80 triangles), to 400 m per metre of length (2 px), at most FAR_R1
//   bclose  boulders and float, detail 3 (320 triangles), to BCLOSE_R +- BCLOSE_W (40 m)
//   bould   boulders at detail 1, each dithered out at 160 m per metre of its length (4 px), at most NEAR_R
// Neighbouring tiers hand over with complementary screen-space dither (vegetation.js style: each
// pixel is drawn by exactly one of them, see OWN). Shadows come from the 80-triangle tiers only.
// No band ever scales a rock (no growing out of the ground). Instance sets are rebuilt from a cached
// per-cell plan when the camera has moved NEAR_MOVE / FAR_MOVE m; their radius is larger than the
// band by more than that, so nothing is added or removed where it can be seen.
// Shadows: the far masses cast for every mass into cascades 0-2 and the far boulders into 0-1
// (shadows.js addCaster), with depth materials that keep the same distance limits; every rock
// receives the sun's cascaded shadow and the cloud shadow through atmosphere.patchLambert.

export const NEAR_R = 250, NEAR_W = 25, FAR_R0 = 1300, FAR_R1 = 1500;
export const CLOSE_R = 60, CLOSE_W = 10, BCLOSE_R = 40, BCLOSE_W = 8;   // full-detail tiers (masses, boulders)
const NEAR_SET = 310, NEAR_MOVE = 30, FAR_SET = 1700, FAR_MOVE = 150;
export const STRIKE_DEG = -35;   // regional strike of the Mother Lode belt, degrees east of north (N35W)
const VARIANTS = 6;
// Roles: the geometry detail of each band (icosphere subdivisions: 8 = 1620 triangles, 3 = 320,
// 2 = 180, 1 = 80) and which list of the cell plan it draws.
const ROLE = {
  close: { detail: 8, src: 'out' }, near: { detail: 2, src: 'out' }, far: { detail: 1, src: 'out' },
  bclose: { detail: 3, src: 'bould' }, bould: { detail: 1, src: 'bould' },
};
const SALT = 0x0c4c;

// Look per rock class (sRGB colours). spec / shin: Blinn-Phong sheen. lichen: cover 0..1.
// speckle: dark mineral grains up close. rubble: boulder multiplier.
export const LOOK = {
  greenstone_metavolcanic: { form: 'knob', color: [0.36, 0.39, 0.33], mottle: [0.41, 0.40, 0.34], spec: 0.03, shin: 14, lichen: 0.8, speckle: 0.3 },
  serpentinite: { form: 'block', color: [0.42, 0.48, 0.45], mottle: [0.27, 0.35, 0.30], spec: 0.11, shin: 36, lichen: 0.25, speckle: 0.05, rubble: 1.6 },
  slate_phyllite: { form: 'fin', color: [0.40, 0.40, 0.40], mottle: [0.44, 0.41, 0.36], spec: 0.045, shin: 22, lichen: 0.9, speckle: 0, strike: true },
  schist: { form: 'schist', color: [0.48, 0.48, 0.46], mottle: [0.47, 0.42, 0.36], spec: 0.09, shin: 28, lichen: 0.6, speckle: 0.1, strike: true },
  granitic: { form: 'dome', color: [0.52, 0.51, 0.48], mottle: [0.43, 0.41, 0.37], spec: 0.02, shin: 10, lichen: 0.7, speckle: 0.8 },
  volcanic: { form: 'knob', color: [0.33, 0.31, 0.29], mottle: [0.40, 0.33, 0.27], spec: 0.03, shin: 14, lichen: 0.7, speckle: 0.2 },
  sandstone_conglomerate: { form: 'block', color: [0.56, 0.49, 0.39], mottle: [0.47, 0.40, 0.31], spec: 0.01, shin: 8, lichen: 0.5, speckle: 0.3 },
  limestone_marble: { form: 'knob', color: [0.70, 0.69, 0.65], mottle: [0.58, 0.56, 0.52], spec: 0.03, shin: 16, lichen: 0.5, speckle: 0.1 },
  alluvium: { form: 'dome', color: [0.50, 0.48, 0.44], mottle: [0.42, 0.40, 0.36], spec: 0.02, shin: 10, lichen: 0.3, speckle: 0.4 },
  other: { form: 'knob', color: [0.46, 0.45, 0.42], mottle: [0.40, 0.37, 0.32], spec: 0.02, shin: 10, lichen: 0.5, speckle: 0.2 },
};
const ROCK_CLASSES = Object.keys(LOOK);   // fallback order = pipeline's rock_classes

// ---- noise (JS, for shapes and placement) --------------------------------------------------------
function h3(x, y, z, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(s, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => h3(xi + dx, yi + dy, zi + dz, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), fx), L(c(0, 1, 0), c(1, 1, 0), fx), fy), L(L(c(0, 0, 1), c(1, 0, 1), fx), L(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
function fbm3(x, y, z, s, oct = 4) {   // about -1..1
  let a = 0, amp = 1, n = 0;
  for (let o = 0; o < oct; o++) { a += amp * (vnoise3(x, y, z, s + o * 101) - 0.5) * 2; n += amp; amp *= 0.5; x *= 2.03; y *= 2.03; z *= 2.03; }
  return a / n;
}
const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
const srgb = c => Math.pow(c, 2.2);
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---- shapes ----------------------------------------------------------------------------------------
// Parameters of one variant: axes (radii before normalising), noise, the class's special terms and
// planar cuts {n, d, soft} (fracture and joint faces). Built from a seeded stream, so variant v of a
// form is the same shape at every detail level and on every client.
function shapeParams(form, kind, v) {
  const r = mulberry32(hashStr(`${form}:${kind}:${v}`)), R = () => r();
  const P = { form, seed: (R() * 1e6) | 0, ax: [1, 0.5, 0.5], amp: 0.1, freq: 1.6, ridge: 0, jag: 0, jagF: 5, taper: 0, plate: 0, wavy: 0, cuts: [], ground: 0.3, split: false };
  const cut = (n, d, soft) => { const l = Math.hypot(...n); P.cuts.push({ n: n.map(c => c / l), d, soft }); };
  const randCut = (d0, d1, soft, yMin = -0.2) => { const n = [R() * 2 - 1, yMin + R() * (1 - yMin), R() * 2 - 1]; cut(n, d0 + (d1 - d0) * R(), soft); };
  const tall = v >= 3;
  if (kind !== 'bould') {
    if (form === 'fin') {
      Object.assign(P, tall ? { ax: [1, 0.75 + 0.2 * R(), 0.1 + 0.03 * R()], jag: 0.3, taper: 0.3, ground: 0.25 }
        : { ax: [1, 0.3 + 0.1 * R(), 0.09 + 0.03 * R()], jag: 0.45, taper: 0.5, ground: 0.3 });
      Object.assign(P, { amp: 0.07, freq: 2.2, plate: 0.3, jagF: 4 + 3 * R() });
      cut([1, 0.3 * (R() - 0.5), 0.2 * (R() - 0.5)], 0.8 + 0.15 * R(), 0.05); cut([-1, 0.3 * (R() - 0.5), 0.2 * (R() - 0.5)], 0.8 + 0.15 * R(), 0.05);   // broken ends
    } else if (form === 'schist') {
      Object.assign(P, tall ? { ax: [1, 0.6 + 0.15 * R(), 0.24], taper: 0.4 } : { ax: [1, 0.3 + 0.08 * R(), 0.2 + 0.05 * R()], taper: 0.6 });
      Object.assign(P, { amp: 0.12, freq: 1.8, wavy: 0.05, jag: 0.15, jagF: 3, ground: 0.3 });
    } else if (form === 'knob') {
      Object.assign(P, { ax: [1, 0.55 + 0.25 * R(), 0.7 + 0.25 * R()], amp: 0.18, freq: 1.3, ridge: 0.14, ground: 0.3 });
      for (let k = 0, n = 3 + (R() * 3 | 0); k < n; k++) randCut(0.72, 0.88, 0.25);
    } else if (form === 'dome') {
      // granitic: low whalebacks and corestones, rounded but jointed (soft cuts) and pitted, not eggs
      if (!tall) Object.assign(P, { ax: [1, 0.3 + 0.1 * R(), 0.8 + 0.15 * R()], amp: 0.1, freq: 1.6, ridge: 0.05, ground: 0.12 });
      else { Object.assign(P, { ax: [1, 0.7 + 0.1 * R(), 0.8 + 0.1 * R()], amp: 0.1, freq: 1.6, ridge: 0.05, ground: 0.2, split: v >= 4 }); }
      for (let k = 0; k < 2; k++) randCut(0.75, 0.9, 0.35, -0.5);
    } else {   // block
      // serpentinite: lumpy, slick masses broken by a few joint faces at odd angles (not boxes)
      Object.assign(P, { ax: [1, 0.6 + 0.15 * R(), 0.75 + 0.15 * R()], amp: 0.13, freq: 1.4, ridge: 0.06, ground: 0.3 });
      const j = () => 0.9 * (R() - 0.5);
      for (const n of [[1, j(), j()], [j(), 1, j()], [j(), j(), 1]]) cut(n, 0.7 + 0.15 * R(), 0.15);
      for (let k = 0; k < 3; k++) randCut(0.72, 0.88, 0.2, 0.0);
    }
  } else {
    if (form === 'fin') { Object.assign(P, { ax: [1, 0.45 + 0.15 * R(), 0.28 + 0.1 * R()], amp: 0.1, freq: 1.8, plate: 0.15 }); for (let k = 0; k < 4; k++) randCut(0.6, 0.8, 0.05); }
    else if (form === 'schist') { Object.assign(P, { ax: [1, 0.45 + 0.1 * R(), 0.4 + 0.1 * R()], amp: 0.12, freq: 1.6, wavy: 0.03 }); randCut(0.7, 0.85, 0.2); randCut(0.7, 0.85, 0.2); }
    else if (form === 'knob') { Object.assign(P, { ax: [1, 0.7 + 0.15 * R(), 0.8 + 0.15 * R()], amp: 0.14, freq: 1.5, ridge: 0.08 }); for (let k = 0, n = 3 + (R() * 2 | 0); k < n; k++) randCut(0.7, 0.85, 0.15); }
    else if (form === 'dome') { Object.assign(P, { ax: [1, 0.7 + 0.15 * R(), 0.8 + 0.15 * R()], amp: 0.1, freq: 1.6, ground: 0.25, split: v === 5 }); randCut(0.72, 0.88, 0.3); randCut(0.72, 0.88, 0.3); }
    else { Object.assign(P, { ax: [1, 0.65 + 0.15 * R(), 0.8 + 0.15 * R()], amp: 0.12, freq: 1.5 }); for (let k = 0; k < 4; k++) randCut(0.68, 0.85, 0.15, -0.3); }
  }
  // Superellipsoid exponents per axis (1 round, toward 0 box-like): the bedded rocks get flat
  // cleavage faces and blunt broken ends, serpentinite and sandstone flat joint faces.
  const EX = kind !== 'bould'
    ? { fin: tall ? [0.45, 0.4, 0.28] : [0.35, 0.5, 0.28], schist: [0.55, 0.6, 0.45], knob: [0.85, 0.8, 0.85], dome: [0.9, 0.9, 0.9], block: [0.75, 0.75, 0.75] }
    : { fin: [0.5, 0.55, 0.4], schist: [0.7, 0.7, 0.6], knob: [0.8, 0.8, 0.8], dome: [0.9, 0.9, 0.9], block: [0.8, 0.8, 0.8] };
  P.ex = EX[form] || [1, 1, 1];
  // cut distances are fractions of the shape's extent along the cut normal
  for (const c of P.cuts) c.d *= Math.hypot(c.n[0] * P.ax[0], c.n[1] * P.ax[1], c.n[2] * P.ax[2]);
  if (P.split) { const a = 0.25 * (R() - 0.5); P.splitN = [Math.cos(a), 0.15 * (R() - 0.5), Math.sin(a)]; P.splitG = 0.035; }
  return P;
}

const ROUGH = { fin: 0.03, schist: 0.04, knob: 0.06, dome: 0.05, block: 0.045 };
// Displace one unit-sphere direction. Returns [x, y, z, noise] in the shape's own (unnormalised) space.
function displace(px, py, pz, P, half = 0) {
  const s = P.seed, f = P.freq;
  const n = fbm3(px * f + 11.3, py * f + 3.1, pz * f + 7.7, s, 4);
  let r = 1 + P.amp * n;
  r += ROUGH[P.form] * fbm3(px * 4.6 + 2.3, py * 4.6 + 8.1, pz * 4.6 + 4.4, s + 13, 3);   // knobs and pits at a quarter of the size
  if (P.ridge) r += P.ridge * (1 - Math.abs(fbm3(px * 2.2 + 1.7, py * 2.2, pz * 2.2 + 5.1, s + 7, 2))) - P.ridge * 0.5;
  const se = (c, e) => e === 1 ? c : Math.sign(c) * Math.pow(Math.abs(c), e);
  let x = se(px, P.ex[0]) * r * P.ax[0], y = se(py, P.ex[1]) * r * P.ax[1], z = se(pz, P.ex[2]) * r * P.ax[2];
  if (P.taper || P.jag) {
    const u = Math.min(Math.abs(x / P.ax[0]), 1);
    if (y > 0) {
      y *= 1 - P.taper * Math.pow(u, 2.5);
      // serrated, ribbed top edge: two octaves, the coarse one ridged so the crest breaks into points
      const j1 = 1 - Math.abs(vnoise3(x * P.jagF, 0.5, 0.5, s + 31) * 2 - 1), j2 = vnoise3(x * P.jagF * 2.9, 0.5, 0.5, s + 37);
      y *= 1 + P.jag * ((j1 - 0.5) * 1.4 + (j2 - 0.5) * 0.8);
    }
  }
  if (P.plate) z *= 1 + 0.6 * P.plate * (vnoise3(x * 2.3, 0.3, 0.6, s + 45) - 0.5);   // thickness varies along the fin
  if (P.plate) {   // cleavage plates: the faces step out and in, in bands
    const q = Math.floor(vnoise3(x * 3.1, y * 4.7, 0.3, s + 41) * 3) / 2;   // 0, 0.5, 1
    z += Math.sign(z) * P.plate * P.ax[2] * (q - 0.5) * Math.min(Math.abs(z) / (P.ax[2] * 0.4), 1);
  }
  if (P.wavy) z += P.wavy * Math.sin(x * 11 + 3 * vnoise3(x * 2, y * 2, 0.7, s + 51)) * P.ax[0];
  for (const c of P.cuts) {
    const d = x * c.n[0] + y * c.n[1] + z * c.n[2] - c.d;
    if (d > 0) { const k = d * (1 - c.soft); x -= c.n[0] * k; y -= c.n[1] * k; z -= c.n[2] * k; }
  }
  if (half) {   // split boulder: this half is clamped to its side of a plane through the centre
    const N = P.splitN, d = x * N[0] + y * N[1] + z * N[2], g = P.splitG;
    if (half > 0 && d < g) { const k = g - d; x += N[0] * k; y += N[1] * k; z += N[2] * k; }
    if (half < 0 && d > -g) { const k = d + g; x -= N[0] * k; y -= N[1] * k; z -= N[2] * k; }
  }
  return [x, y, z, n];
}

// Normalisation of a variant (length 1 along x, ground line at y = 0), from a fine sample so every
// detail level of the variant shares it.
const norms = new Map();
function normOf(form, kind, v, P) {
  const key = `${form}:${kind}:${v}`; if (norms.has(key)) return norms.get(key);
  const g = new THREE.IcosahedronGeometry(1, 10), p = g.attributes.position;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < p.count; k++) {
    for (const half of P.split ? [1, -1] : [0]) {
      const q = displace(p.getX(k), p.getY(k), p.getZ(k), P, half);
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a]); hi[a] = Math.max(hi[a], q[a]); }
    }
  }
  g.dispose();
  const s = 1 / (hi[0] - lo[0]), y0 = lo[1] + P.ground * (hi[1] - lo[1]);
  const N = { s, off: [-(hi[0] + lo[0]) / 2, -y0, -(hi[2] + lo[2]) / 2],
    dims: { wid: (hi[2] - lo[2]) * s, hgt: (hi[1] - y0) * s, below: (y0 - lo[1]) * s } };
  norms.set(key, N); return N;
}

// One variant's geometry at a detail level: position, smooth normal, vertex colour (class colour,
// mottling, crevice darkening, weathered tops, rust streaks, soil stain at the ground line).
function rockGeometry(cls, kind, v, detail) {
  const look = LOOK[cls], form = look.form, P = shapeParams(form, kind, v), N = normOf(form, kind, v, P);
  const halves = P.split ? [1, -1] : [0], parts = [];
  for (const half of halves) {
    let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position, nz = new Float32Array(p.count);
    for (let k = 0; k < p.count; k++) {
      const q = displace(p.getX(k), p.getY(k), p.getZ(k), P, half);
      p.setXYZ(k, (q[0] + N.off[0]) * N.s, (q[1] + N.off[1]) * N.s, (q[2] + N.off[2]) * N.s);
      nz[k] = q[3];
    }
    g.computeVertexNormals();
    const nr = g.attributes.normal, col = new Float32Array(p.count * 3);
    const base = look.color, mot = look.mottle, H = N.dims.hgt, S = P.seed;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k), ny = nr.getY(k);
      const m = smooth(0.35, 0.75, vnoise3(x * 3.2 + 4, y * 3.2, z * 3.2, S + 61)) * (form === 'block' ? 0.8 : 0.45);
      let c = [0, 1, 2].map(a => base[a] + (mot[a] - base[a]) * m);
      let shade = 0.74 + 0.26 * smooth(-0.55, 0.35, nz[k]);                 // crevices darker
      shade *= 1 + 0.1 * smooth(0.2, 0.9, ny);                               // weathered, bleached tops
      shade *= 0.92 + 0.16 * vnoise3(x * 9, y * 9, z * 9, S + 71);           // fine grain
      if (form === 'fin' || form === 'schist') {                             // rust streaks running down the faces
        const st = smooth(0.66, 0.85, vnoise3(x * 7, y * 0.8, z * 7, S + 81)) * 0.3;
        c = c.map((a, i) => a + ([0.46, 0.33, 0.22][i] - a) * st);
      }
      const stain = 1 - smooth(-0.01, Math.min(0.06, H * 0.12), y);          // soil splash and damp at the ground line
      c = c.map((a, i) => (a + ([0.24, 0.20, 0.15][i] - a) * 0.5 * stain) * shade);
      col[k * 3] = srgb(c[0]); col[k * 3 + 1] = srgb(c[1]); col[k * 3 + 2] = srgb(c[2]);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }
  if (parts.length === 1) return { geometry: parts[0], dims: N.dims };
  // two halves of a split boulder in one geometry
  const geometry = new THREE.BufferGeometry(), nv = parts.map(g => g.attributes.position.count), tot = nv[0] + nv[1];
  for (const name of ['position', 'normal', 'color']) {
    const a = new Float32Array(tot * 3); a.set(parts[0].attributes[name].array, 0); a.set(parts[1].attributes[name].array, nv[0] * 3);
    geometry.setAttribute(name, new THREE.BufferAttribute(a, 3));
  }
  const i0 = parts[0].index.array, i1 = parts[1].index.array, idx = new Uint32Array(i0.length + i1.length);
  idx.set(i0, 0); for (let k = 0; k < i1.length; k++) idx[i0.length + k] = i1[k] + nv[0];
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  parts.forEach(g => g.dispose());
  return { geometry, dims: N.dims };
}

// ---- materials -----------------------------------------------------------------------------------
const ROCK_GLSL = /* glsl */`
  uint rkH(uvec3 q) { uint h = q.x * 1597334677u ^ q.y * 3812015801u ^ q.z * 2798796415u; h = (h ^ (h >> 15)) * 2246822519u; h ^= h >> 13; return h; }
  float rkHash(vec3 p) { return float(rkH(uvec3(ivec3(floor(p)) + 1048576))) * (1.0 / 4294967296.0); }
  float rkNoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(rkHash(i), rkHash(i + vec3(1, 0, 0)), f.x), mix(rkHash(i + vec3(0, 1, 0)), rkHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(rkHash(i + vec3(0, 0, 1)), rkHash(i + vec3(1, 0, 1)), f.x), mix(rkHash(i + vec3(0, 1, 1)), rkHash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
`;
// Where a rock dithers out, from its length in metres (the instance matrix's longer horizontal
// axis): boulders at about 4 px on screen (s x 160 m, 40-NEAR_R), far masses at about 2 px
// (s x 400 m, NEAR_R-FAR_R1), so small tombstones and corestones leave the far band early.
const BOULD_OUT = s => `clamp(${s} * 160.0, 40.0, ${NEAR_R.toFixed(1)})`;
const FAR_OUT = s => `clamp(${s} * 400.0, ${(NEAR_R + 2 * NEAR_W).toFixed(1)}, ${FAR_R1.toFixed(1)})`;
// Which pixels each role owns, as a range [a, b) of the screen-space dither value n (vRockAB): two
// neighbouring tiers split [0, 1) at the same threshold, so across a hand-over every pixel is drawn by
// exactly one of them. T0 close -> near (CLOSE_R), T1 near -> far (NEAR_R), B0 boulder close ->
// boulder (BCLOSE_R), BF a boulder's own fade-out, FF a far mass's fade-out.
const BANDS = /* glsl */`
  float T0 = clamp((rD - ${(CLOSE_R - CLOSE_W).toFixed(1)}) / ${(2 * CLOSE_W).toFixed(1)}, 0.0, 1.0);
  float T1 = clamp((rD - ${(NEAR_R - NEAR_W).toFixed(1)}) / ${(2 * NEAR_W).toFixed(1)}, 0.0, 1.0);
  float B0 = clamp((rD - ${(BCLOSE_R - BCLOSE_W).toFixed(1)}) / ${(2 * BCLOSE_W).toFixed(1)}, 0.0, 1.0);
  float BF = 1.0 - smoothstep(rOut * 0.85, rOut * 1.1, rD);
  float FF = 1.0 - smoothstep(rFarOut * ${(FAR_R0 / FAR_R1).toFixed(3)}, rFarOut, rD);`;
const OWN = { close: 'vec2(T0, 1.0)', near: 'vec2(0.0, min(T0, 1.0 - T1))', far: 'vec2(1.0 - T1 * FF, 1.0)', bclose: 'vec2(B0, BF)', bould: 'vec2(0.0, min(B0, BF))' };
// Vertex: the band (collapsed when the role owns no pixels) and normals by the inverse transpose
// of the instance matrix (it carries a shear). Fragment: the dither, lichen on the upper faces,
// mineral speckle, surface roughness, and the cast shadow on the specular term too.
function rockMaterial(cls, role, atmosphere) {
  const look = LOOK[cls];
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, specular: new THREE.Color().setScalar(look.spec), shininess: look.shin });
  atmosphere.patchLambert(m);   // cloud + cascaded shadow on the sun term, aerial perspective
  const uLichen = { value: look.lichen }, uSpeckle = { value: look.speckle || 0 };
  chainShader(m, `rock-${role}`, shader => {
    shader.uniforms.rockLichen = uLichen; shader.uniforms.rockSpeckle = uSpeckle;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRockAB;')
      .replace('#include <defaultnormal_vertex>', `vec3 transformedNormal = objectNormal;
        #ifdef USE_INSTANCING
          transformedNormal = transpose(inverse(mat3(instanceMatrix))) * transformedNormal;
        #endif
        transformedNormal = normalMatrix * transformedNormal;`)
      // the band first thing in main(), so a rock outside it costs a few instructions per vertex
      .replace('#include <uv_vertex>', `vRockAB = vec2(0.0, 1.0);
        #ifdef USE_INSTANCING
        { vec3 rO = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float rD = distance(rO, cameraPosition), rSize = max(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
          float rOut = ${BOULD_OUT('rSize')}, rFarOut = ${FAR_OUT('rSize')};
          ${BANDS}
          vRockAB = ${OWN[role]};
          if (vRockAB.x >= vRockAB.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } }
        #endif
        #include <uv_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRockAB;\nuniform float rockLichen; uniform float rockSpeckle;\n' + ROCK_GLSL)
      .replace('#include <clipping_planes_fragment>', `{ float lodN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (lodN < vRockAB.x || lodN >= vRockAB.y) discard; }
        #include <clipping_planes_fragment>`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 P = vAtmoPos;
          float rPx = length(fwidth(P));                       // metres per pixel
          // Surface roughness: a 2-octave height field (5 cm and 1.5 cm) bent into the shading
          // normal by screen derivatives, as slope per metre so it does not change with distance;
          // it fades out before its features get under a few pixels.
          float rB = 0.04 * rkNoise(P * 4.3 + 3.0);
          vec2 rDp = vec2(length(dFdx(P)), length(dFdy(P))) + 1e-5;
          vec2 rSl = vec2(dFdx(rB), dFdy(rB)) / rDp * (1.0 - smoothstep(0.02, 0.08, rPx));
          { vec3 sx = normalize(dFdx(-vViewPosition)), sy = normalize(dFdy(-vViewPosition));
            vec3 r1 = cross(sy, normal), r2 = cross(normal, sx); float det = dot(sx, r1);
            normal = normalize(abs(det) * normal - sign(det) * (rSl.x * r1 + rSl.y * r2)); }
          vec3 rN = inverseTransformDirection(normal, viewMatrix);
          // Lichen: crustose and foliose patches ~0.1-0.5 m, most on the upper faces; orange
          // (Xanthoria, Caloplaca) on tops, grey-green (Xanthoparmelia) elsewhere. Under ~2 px a
          // patch is replaced by its mean cover so it never shimmers.
          float cover = rockLichen * (0.35 + 0.65 * smoothstep(-0.2, 0.75, rN.y));
          float th = 1.0 - 0.5 * cover;
          float rFar = smoothstep(0.04, 0.16, rPx);
          float m = 0.0, orange = 0.12, crust = 0.08;
          if (rFar < 1.0) {   // past ~6 px per 0.5 m nothing of the pattern is left: skip the noise
            m = rkNoise(P * 7.3) * 0.55 + rkNoise(P * 19.1 + 17.0) * 0.45;
            orange = smoothstep(0.62, 0.76, rkNoise(P * 1.7 + 5.0));
            crust = step(0.9, rkHash(floor(P * 14.0)));
          }
          orange *= smoothstep(0.3, 0.8, rN.y);
          float lich = mix(smoothstep(th, th + 0.06 + rPx * 0.6, m), cover * 0.22, rFar);
          vec3 lc = mix(vec3(0.19, 0.21, 0.15), vec3(0.36, 0.15, 0.03), orange);
          lc = mix(lc, vec3(0.05, 0.05, 0.045), crust * 0.6);   // black crust spots
          diffuseColor.rgb = mix(diffuseColor.rgb, lc, lich);
          specularStrength *= 1.0 - lich;
          // Mineral grains (granite's biotite and hornblende): only where a 2 cm grain is over a pixel.
          if (rockSpeckle > 0.0) {
            float g = step(0.86, rkHash(floor(P * 55.0)));
            diffuseColor.rgb *= 1.0 - rockSpeckle * mix(0.55 * g, 0.077, smoothstep(0.005, 0.02, rPx)) * (1.0 - lich);
          } }`)
      .replace(/reflectedLight\.directDiffuse \*= (cloudOnly\(vAtmoPos\) \* csmShadow\([^;]*\));/,
        'float rockSh = $1; reflectedLight.directDiffuse *= rockSh; reflectedLight.directSpecular *= rockSh;');
  });
  return m;
}

// Depth material for the shadow proxies: the same distance band, no dither (the shadow of a rock
// half dithered away is the whole rock's for those few metres). Back faces: a lit face never
// shadows itself, and the silhouette on the ground is the same.
const casterU = { rockEye: { value: new THREE.Vector3(0, 1e9, 0) } };
function casterMaterial(role) {
  const band = role === 'near' ? `rD > ${(NEAR_R + NEAR_W).toFixed(1)}`
    : role === 'far' ? `rD > ${FAR_OUT('rSize')}`
      : `rD > ${BOULD_OUT('rSize')} * 1.1`;
  return new THREE.ShaderMaterial({
    uniforms: casterU, side: THREE.BackSide, colorWrite: false,
    vertexShader: `uniform vec3 rockEye;
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        float rD = distance(m[3].xyz, rockEye), rSize = max(length(m[0].xyz), length(m[2].xyz));
        if (${band}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        gl_Position = projectionMatrix * viewMatrix * (m * vec4(position, 1.0));
      }`,
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
  });
}

// The distance (camera to ground point) out to which a role can draw a rock of length s metres.
function reachOf(role, s) {
  const bOut = Math.min(Math.max(s * 160, 40), NEAR_R) * 1.1;
  if (role === 'close') return CLOSE_R + CLOSE_W;
  if (role === 'near') return NEAR_R + NEAR_W;
  if (role === 'far') return Math.min(Math.max(s * 400, NEAR_R + 2 * NEAR_W), FAR_R1);
  if (role === 'bclose') return Math.min(BCLOSE_R + BCLOSE_W, bOut);
  return bOut;
}

// ---- the field -------------------------------------------------------------------------------------
export class Rocks {
  // spacing: the terrain mesh's vertex spacing (terrain.js default), so rocks sit on the drawn surface.
  constructor(tile, scene, atmosphere, { spacing = 10 } = {}) {
    this.tile = tile; this.atmosphere = atmosphere; this.spacing = spacing;
    this.group = new THREE.Group(); this.group.name = 'rocks'; scene.add(this.group);
    this.on = true; this.plans = new Map(); this.meshes = new Map(); this.geoms = new Map();
    this.nearCentre = null; this.farCentre = null;
    this.stats = { nearCells: 0, close: 0, near: 0, far: 0, bclose: 0, bould: 0, buildMs: 0, rebuilds: 0, meshes: 0 };
    const ok = tile.outcrop && tile.geology && tile.soils && tile.outcrop.img.width === tile.geology.img.width && tile.outcrop.img.width === tile.soils.img.width;
    this.enabled = !!ok;
    if (!ok) { this.reason = 'tile has no outcrop / geology / soils rasters'; return; }
    this.classes = tile.groundClasses?.rock_classes || ROCK_CLASSES;
    this.grid = tile.outcrop; this.W = tile.outcrop.img.width; this.res = tile.outcrop.res;
    this.groups = Object.fromEntries(Object.keys(ROLE).map(r => [r, new THREE.Group()]));
    for (const g of Object.values(this.groups)) this.group.add(g);
    // Shadow proxies follow each mesh's live count and instance buffer (shadows.js addCaster), so
    // meshes made later are registered again (registerCasters) as they appear.
    this.casterMats = { near: casterMaterial('near'), bould: casterMaterial('bould'), far: casterMaterial('far') };
  }

  // ---- terrain samplers ----
  // Height of the rendered terrain mesh (terrain.js: vertices every `spacing` m from the tile's
  // south-west corner, heights.at at the vertices, each square split along its SW-NE diagonal).
  meshH(x, north) {
    const S = this.spacing, h = this.tile.heights, n = Math.round(this.tile.size / S) - 1;
    const fx = x / S, fn = north / S, i0 = Math.min(Math.max(Math.floor(fx), 0), n), n0 = Math.min(Math.max(Math.floor(fn), 0), n);
    const u = Math.min(Math.max(fx - i0, 0), 1), w = Math.min(Math.max(fn - n0, 0), 1);
    const SW = h.at(i0 * S, n0 * S), SE = h.at((i0 + 1) * S, n0 * S), NW = h.at(i0 * S, (n0 + 1) * S), NE = h.at((i0 + 1) * S, (n0 + 1) * S);
    return w > u ? SW + u * (NE - NW) + w * (NW - SW) : SW + u * (SE - SW) + w * (NE - SE);
  }
  cellData(i, j) {
    const g = this.grid, t = this.tile;
    const L = g.channel(i, j, 0) / 255, ci = t.geology.channel(i, j, 1), frag = t.soils.channel(i, j, 1);
    const cls = this.classes[ci - 1] || null, tree = t.canopy ? Math.min(t.canopy.channel(i, j, 0) / 100, 1) : 0;
    return { L, cls: cls && LOOK[cls] ? cls : ci ? 'other' : null, frag, tree };
  }

  // Instance matrix for a rock: ground point (x, north), strike azimuth az (radians east of north,
  // the rock's local +x), lean (radians, about +x toward local +z), size (sx along x in metres,
  // sy, sz scale factors on the variant's own proportions). Returns null where it may not stand.
  place(x, north, az, lean, sx, sy, sz, dims, out) {
    const yaw = Math.PI / 2 - az, cy = Math.cos(yaw), sY = Math.sin(yaw);
    const a = 0.5 * sx, b = 0.5 * dims.wid * sx * sz;   // footprint half extents
    // local x -> world (east, north) = (cos yaw, sin yaw)... three: local x maps to (cos yaw, 0, -sin yaw)
    const ex = [cy, sY], ez = [sY, -cy];   // (east, north) of local +x and local +z
    let n = 0, sE = 0, sN = 0, sH = 0, sEE = 0, sNN = 0, sEN = 0, sEH = 0, sNH = 0;
    const pts = this._pts || (this._pts = new Float32Array(17 * 3));
    for (let k = 0; k < 17; k++) {
      let u = 0, v = 0;
      if (k > 0) { const ang = ((k - 1) % 8) / 8 * Math.PI * 2, r = k <= 8 ? 1 : 0.5; u = Math.cos(ang) * a * r; v = Math.sin(ang) * b * r; }
      const dE = ex[0] * u + ez[0] * v, dN = ex[1] * u + ez[1] * v, hh = this.meshH(x + dE, north + dN);
      pts[k * 3] = dE; pts[k * 3 + 1] = dN; pts[k * 3 + 2] = hh;
      n++; sE += dE; sN += dN; sH += hh; sEE += dE * dE; sNN += dN * dN; sEN += dE * dN; sEH += dE * hh; sNH += dN * hh;
    }
    // least-squares plane h = c + gE dE + gN dN
    const mE = sE / n, mN = sN / n, mH = sH / n;
    const cEE = sEE / n - mE * mE, cNN = sNN / n - mN * mN, cEN = sEN / n - mE * mN, cEH = sEH / n - mE * mH, cNH = sNH / n - mN * mH;
    const det = cEE * cNN - cEN * cEN;
    let gE = det > 1e-9 ? (cEH * cNN - cNH * cEN) / det : 0, gN = det > 1e-9 ? (cNH * cEE - cEH * cEN) / det : 0;
    const c = mH - gE * mE - gN * mN;
    let gap = 0;
    for (let k = 0; k < 17; k++) gap = Math.max(gap, c + gE * pts[k * 3] + gN * pts[k * 3 + 1] - pts[k * 3 + 2]);
    gE = Math.max(-1.2, Math.min(1.2, gE)); gN = Math.max(-1.2, Math.min(1.2, gN));
    const H = dims.hgt * sx * sy;
    const sink = Math.min(gap, 0.6 * H) + 0.02 * H + 0.02;
    // T * Shear * Ry(yaw) * Rx(lean) * S
    const q = this._q || (this._q = new THREE.Quaternion()), e = this._e || (this._e = new THREE.Euler());
    e.set(lean, yaw, 0, 'YXZ'); q.setFromEuler(e);
    const M = this._m || (this._m = new THREE.Matrix4());
    M.compose(this._zero || (this._zero = new THREE.Vector3()), q, (this._s || (this._s = new THREE.Vector3())).set(sx, sx * sy, sx * sz));
    const el = M.elements, gx = gE, gz = -gN;   // dh/dx, dh/dz in three's axes (z = -north)
    for (const o of [0, 4, 8]) el[o + 1] += gx * el[o] + gz * el[o + 2];
    el[12] = x; el[13] = c - sink; el[14] = -north;
    out.set(el);
    return out;
  }
  skip(i, j, k, x, north) { return x < 0 || north < 0 || x > this.tile.size || north > this.tile.size || placementSkip(this.tile, i, j, k, x, north, false, false); }   // plant = false: rocks are not thinned on outcrops

  // Per-cell plan: { out: [{ key, m, c }], bould: [...] } with the instance matrix and tint of each
  // rock, cached. countOnly: just the counts (the tile census).
  plan(i, j, countOnly = false) {
    const id = j * this.W + i;
    if (!countOnly && this.plans.has(id)) return this.plans.get(id);
    const d = this.cellData(i, j), res = this.res, size = this.tile.size;
    let result = null;
    const L = d.L, fragOn = d.frag > 25;
    if (d.cls && (L > 0.15 || fragOn) && this.tile.habitat.channel(i, j, 0) !== 7) {
      const look = LOOK[d.cls], form = look.form, rnd = mulberry32(hash(i, j, SALT));
      const out = [], bould = [];
      const push = (list, kind, v, x, north, az, lean, sx, sy, sz, k, ends = 0) => {
        const t = 0.86 + 0.28 * rnd(), hue = (rnd() - 0.5) * 0.08;   // drawn first: a skip moves nothing else
        if (this.skip(i, j, k, x, north)) return;
        if (ends) { const ce = Math.sin(az) * ends, cn = Math.cos(az) * ends; if (this.skip(i, j, k + 50, x + ce, north + cn) || this.skip(i, j, k + 51, x - ce, north - cn)) return; }
        if (countOnly) { list.push(1); return; }
        const dims = this.dimsOf(d.cls, kind === 'bould' ? 'bould' : 'out', v);
        const m = this.place(x, north, az, lean, sx, sy, sz, dims, new Float32Array(16));
        list.push({ key: `${d.cls}|${v}`, m, c: [t * (1 + hue), t, t * (1 - hue)], x, y: m[13], z: -north, s: Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[8], m[9], m[10])) });
      };
      const cx = (i + 0.5 + (rnd() - 0.5) * 0.5) * res, cn = size - (j + 0.5 + (rnd() - 0.5) * 0.5) * res;
      // strike: regional for the bedded classes (slowly wandering +-8 degrees across the tile),
      // joint sets loosely tied to it for greenstone, free for the massive rocks.
      const wander = (vnoise3(i * 0.08, j * 0.08, 0.5, 977) - 0.5) * 16;
      const strike = (STRIKE_DEG + wander) * Math.PI / 180;
      const dipLean = (5 + 15 * rnd()) * Math.PI / 180;   // dip 70-85 degrees toward the north-east
      let k = 0;
      if (L > 0.45) {
        const t = smooth(0.45, 0.9, L), nMain = Math.min(6, 2 + Math.floor(rnd() * (1 + 4 * t)));
        if (look.strike) {
          const thick = form === 'schist';
          const az = strike + (rnd() - 0.5) * 0.1, nb = 1 + Math.floor(rnd() * 2.5);
          const beds = [], gapB = 2 + 3 * rnd();
          for (let b = 0; b < nb; b++) beds.push({ off: (b - (nb - 1) / 2) * gapB + (rnd() - 0.5), s: -2 - 6 * rnd() });
          const sa = Math.sin(az), ca = Math.cos(az);   // strike direction (east, north); across = (ca, -sa)
          for (let q = 0; q < nMain; q++) {
            const bed = beds[q % nb], len = 1.5 + 6.5 * Math.pow(rnd(), 1.3) * (0.6 + 0.4 * t);
            const along = bed.s + len / 2; bed.s += len + 0.3 + 2.5 * rnd();
            const H = (thick ? 0.5 : 0.45) + (thick ? 1.2 : 1.1) * rnd() * (0.6 + 0.4 * t), T = thick ? 0.5 + 0.8 * rnd() : 0.25 + 0.5 * rnd();
            const v = Math.floor(rnd() * 3), dims = this.dimsOf(d.cls, 'out', v);
            push(out, 'out', v, cx + sa * along + ca * bed.off, cn + ca * along - sa * bed.off, az + (rnd() - 0.5) * 0.06, dipLean * (thick ? 0.6 : 1),
              len, H / (dims.hgt * len), T / (dims.wid * len), k++, len * 0.45);
          }
          const nTomb = Math.floor(rnd() * (thick ? 2 : 2 + 5 * t));
          for (let q = 0; q < nTomb; q++) {
            const bed = beds[Math.floor(rnd() * nb)], len = 0.5 + 1.5 * rnd(), along = (rnd() - 0.5) * 18;
            const H = 0.4 + 0.9 * rnd(), T = 0.1 + 0.2 * rnd(), v = 3 + Math.floor(rnd() * 3), dims = this.dimsOf(d.cls, 'out', v);
            const off = bed.off + (rnd() - 0.5) * 1.2;
            push(out, 'out', v, cx + sa * along + ca * off, cn + ca * along - sa * off, az + (rnd() - 0.5) * 0.1, dipLean,
              len, H / (dims.hgt * len), T / (dims.wid * len), k++);
          }
        } else {
          for (let q = 0; q < nMain; q++) {
            let D, v, rad;
            if (form === 'dome') { v = q === 0 ? Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 3); D = q === 0 ? 4 + 6 * rnd() * (0.5 + 0.5 * t) : 1.5 + 2 * rnd(); rad = q === 0 ? 0 : 4 + 5 * rnd(); }
            else if (form === 'block') { v = Math.floor(rnd() * VARIANTS); D = 1.5 + 3 * rnd() * (0.6 + 0.4 * t); rad = 1 + 5 * rnd(); }
            else { v = Math.floor(rnd() * VARIANTS); D = 2 + 6 * Math.pow(rnd(), 1.3) * (0.6 + 0.4 * t); rad = 1 + 6 * rnd(); }
            const ang = rnd() * Math.PI * 2;
            const az = form === 'knob' ? strike + (rnd() - 0.5) * 1.4 : rnd() * Math.PI * 2;
            push(out, 'out', v, cx + Math.cos(ang) * rad, cn + Math.sin(ang) * rad, az, (rnd() - 0.5) * 0.15, D, 0.85 + 0.3 * rnd(), 0.85 + 0.3 * rnd(), k++);
          }
        }
      }
      // boulders and float
      let lam = L > 0.45 ? 4 + 6 * smooth(0.45, 0.9, L) : 12 * smooth(0.15, 0.45, L);
      if (fragOn) lam += (2 + 6 * Math.min((d.frag - 25) / 75, 1)) * (1 - 0.5 * d.tree);
      lam = Math.min(lam * (look.rubble || 1), 20);
      const nB = Math.floor(lam + rnd());
      const cs = [[cx, cn], [(i + rnd()) * res, size - (j + rnd()) * res]], maxS = look.rubble ? 1.3 : 2;
      for (let q = 0; q < nB; q++) {
        let x, nn;
        if (rnd() < 0.6) { const c0 = cs[q & 1], r = 5 * Math.sqrt(-2 * Math.log(1 - rnd() * 0.999)), a = rnd() * Math.PI * 2; x = c0[0] + Math.cos(a) * r; nn = c0[1] + Math.sin(a) * r; }
        else { x = (i + rnd()) * res; nn = size - (j + rnd()) * res; }
        const u = rnd(), al = 1.7, s0 = 0.4, s = s0 * Math.pow(1 - u * (1 - Math.pow(s0 / maxS, al)), -1 / al);
        const v = Math.floor(rnd() * VARIANTS);
        const az = look.strike ? strike + (rnd() - 0.5) * 0.7 : rnd() * Math.PI * 2;
        push(bould, 'bould', v, x, nn, az, (rnd() - 0.5) * 0.3, s, 0.8 + 0.4 * rnd(), 0.8 + 0.4 * rnd(), 100 + k++);
      }
      if (out.length || bould.length) result = { out, bould };
    }
    if (!countOnly) this.plans.set(id, result);
    return result;
  }
  dimsOf(cls, kind, v) {
    const key = `${cls}|${kind}|${v}`; let g = this.geoms.get(key);
    if (!g) {
      const form = LOOK[cls].form, P = shapeParams(form, kind, v);
      g = { dims: normOf(form, kind, v, P).dims }; this.geoms.set(key, g);
    }
    return g.dims;
  }
  // The InstancedMesh for (role, class, variant), made on first use.
  mesh(role, key) {
    const mk = `${role}|${key}`; let m = this.meshes.get(mk);
    if (m) return m;
    const [cls, vs] = key.split('|'), v = +vs, kind = ROLE[role].src;
    const gk = `${cls}|${kind}|${v}|${ROLE[role].detail}`;
    let geo = this.geoms.get(gk);
    if (!geo) { geo = rockGeometry(cls, kind, v, ROLE[role].detail); this.geoms.set(gk, geo); }
    this.mats ||= {};
    const matKey = `${cls}|${role}`;
    const mat = this.mats[matKey] ||= rockMaterial(cls, role, this.atmosphere);
    m = new THREE.InstancedMesh(geo.geometry, mat, 64);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    m.count = 0; m.frustumCulled = false; m.visible = false; m.name = `rock ${role} ${key}`;
    m.userData.cap = 64;
    this.groups[role].add(m); this.meshes.set(mk, m); this.stats.meshes++;
    this.castersDirty = true;
    return m;
  }
  ensure(m, n) {
    if (n <= m.userData.cap) return;
    const cap = Math.max(n, Math.ceil(m.userData.cap * 1.6));
    const im = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16); im.setUsage(THREE.DynamicDrawUsage);
    const ic = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); ic.setUsage(THREE.DynamicDrawUsage);
    m.instanceMatrix = im; m.instanceColor = ic; m.userData.cap = cap;
  }
  // Fill the meshes of the given roles from the plans of cells within radius R of (x, z), keeping
  // only rocks the band can still show from anywhere within `margin` m of the camera (y): from
  // the air most boulders are past their own fade distance, so they are not submitted at all.
  fill(roles, x, y, z, R, margin) {
    const res = this.res, size = this.tile.size, W = this.W;
    const north = -z, i0 = Math.max(0, Math.floor((x - R) / res)), i1 = Math.min(W - 1, Math.floor((x + R) / res));
    const j0 = Math.max(0, Math.floor((size - north - R) / res)), j1 = Math.min(W - 1, Math.floor((size - north + R) / res));
    const lists = new Map(), R2 = (R + res) * (R + res);
    let cells = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ex = (i + 0.5) * res - x, en = size - (j + 0.5) * res - north;
      if (ex * ex + en * en > R2) continue;
      const p = this.plan(i, j); if (!p) continue;
      cells++;
      for (const role of roles) {
        const src = ROLE[role].src === 'bould' ? p.bould : p.out;
        for (const r of src) {
          const dx = r.x - x, dz = r.z - z; if (dx * dx + dz * dz > R * R) continue;
          const reach = reachOf(role, r.s) + margin;
          const dy = r.y - y; if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
          const mk = `${role}|${r.key}`; let l = lists.get(mk); if (!l) lists.set(mk, l = { role, key: r.key, items: [] });
          l.items.push(r);
        }
      }
    }
    for (const [mk, m] of this.meshes) if (roles.includes(mk.split('|')[0]) && !lists.has(mk)) { m.count = 0; m.visible = false; }
    let total = 0;
    for (const l of lists.values()) {
      const m = this.mesh(l.role, l.key), n = l.items.length;
      this.ensure(m, n);
      const a = m.instanceMatrix.array, c = m.instanceColor.array;
      for (let q = 0; q < n; q++) { a.set(l.items[q].m, q * 16); c.set(l.items[q].c, q * 3); }
      m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
      total += n;
    }
    return { cells, total };
  }
  update(camera) {
    if (!this.enabled) return;
    const p = camera.position;
    casterU.rockEye.value.copy(p);
    const moved = (c, d) => !c || Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) > d;
    if (moved(this.nearCentre, NEAR_MOVE) || moved(this.farCentre, FAR_MOVE)) {
      const t0 = performance.now();
      if (moved(this.nearCentre, NEAR_MOVE)) {
        this.nearCentre = { x: p.x, y: p.y, z: p.z };
        const r = this.fill(['close', 'near', 'bclose', 'bould'], p.x, p.y, p.z, NEAR_SET, NEAR_SET - NEAR_R - NEAR_W);
        this.stats.nearCells = r.cells;
        for (const k of ['close', 'near', 'bclose', 'bould']) this.stats[k] = this.countOf(k);
      }
      if (moved(this.farCentre, FAR_MOVE)) {
        this.farCentre = { x: p.x, y: p.y, z: p.z };
        this.fill(['far'], p.x, p.y, p.z, FAR_SET, FAR_SET - FAR_R1); this.stats.far = this.countOf('far');
      }
      this.stats.buildMs = Math.round((performance.now() - t0) * 10) / 10; this.stats.rebuilds++;
    }
    if (this.castersDirty) { this.castersDirty = false; this.registerCasters(); }
  }
  registerCasters() {
    // Low-poly casters only (80 triangles): the far masses stand in for every mass at any distance
    // (the far set holds all of them out to FAR_SET) and the far boulder LOD for every boulder.
    addCaster(this.groups.bould, { cascades: [0, 1], material: this.casterMats.bould });
    addCaster(this.groups.far, { cascades: [0, 1, 2], material: this.casterMats.far });
  }
  countOf(role) { let n = 0; for (const [mk, m] of this.meshes) if (mk.startsWith(role + '|')) n += m.count; return n; }
  set(on) { this.on = !!on; this.group.visible = this.on; }
  // Instances whose band keeps them at this camera position (what the GPU shades), per role.
  drawn(camera = window.__we?.camera) {
    const p = camera.position, out = { close: 0, near: 0, far: 0, bclose: 0, bould: 0, draws: 0 };
    for (const [mk, m] of this.meshes) {
      if (!m.visible || !m.count) continue;
      const role = mk.split('|')[0], a = m.instanceMatrix.array; let n = 0;
      for (let q = 0; q < m.count; q++) {
        const d = Math.hypot(a[q * 16 + 12] - p.x, a[q * 16 + 13] - p.y, a[q * 16 + 14] - p.z);
        const s = Math.max(Math.hypot(a[q * 16], a[q * 16 + 1], a[q * 16 + 2]), Math.hypot(a[q * 16 + 8], a[q * 16 + 9], a[q * 16 + 10]));
        const lo = role === 'near' ? 0 : role === 'far' ? NEAR_R - NEAR_W : role === 'bould' ? BCLOSE_R - BCLOSE_W : 0;
        const keep = d >= lo && d < reachOf(role, s);
        if (keep) n++;
      }
      out[role] += n; if (n) out.draws++;
    }
    return out;
  }
  // Whole-tile counts (no matrices): outcrop cells, masses, boulders.
  census() {
    const W = this.W, out = { outcropCells: 0, boulderCells: 0, masses: 0, boulders: 0, byClass: {} };
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const p = this.plan(i, j, true); if (!p) continue;
      const cls = this.cellData(i, j).cls, b = out.byClass[cls] ||= { cells: 0, masses: 0, boulders: 0 };
      if (p.out.length) out.outcropCells++; if (p.bould.length) out.boulderCells++;
      out.masses += p.out.length; out.boulders += p.bould.length; b.cells++; b.masses += p.out.length; b.boulders += p.bould.length;
    }
    return out;
  }
}
