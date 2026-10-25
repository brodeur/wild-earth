import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './trees.js';
import { hash, placementSkip } from './vegetation.js';
import { STRIKE_DEG } from './tilepackage.js';
import { chainShader } from './treegen.js';
import { addCaster } from './shadows.js';

// Rock outcrops and boulders placed from the geology and soils step (docs/tile-spec.md "Geology and
// soils"; decision 2026-10-25 "rocks come from geology and soils data"). Nothing here is downloaded:
// every shape is a deformed icosphere or swept box built at load, and every placement is a hash of the 30 m cell,
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
//                     1 - tree cover / 2); an outcrop cell has 4-10; serpentinite x2.4 (at most 30,
//                     others 20). Sizes 0.4-2 m (serpentinite blocks 0.5-1.5 m), truncated Pareto,
//                     all in 1-3 clusters per cell (Rayleigh scatter of 1.5-4 m), most of a cell clear.
//   talus             every mass and every boulder over 1 m gets 5-30 smaller stones round its base,
//                     smaller further out, stretched and weighted down the slope; plus groups of
//                     5-20 small stones (0.08-0.4 m) at the clusters. Never a small stone alone.
//   water edges       cobble and gravel on the dry bed and banks of every stream (water.js widths,
//                     its pools and riffles kept out of), groups every ~1.5 m, gravel bars more often
//                     on the inside of a bend, bigger cobbles on bigger channels; a gravel band just
//                     outside pond shores. Water-worn: rounded, flattened, paler.
//   streams           masses use the cell's SALT stream (unchanged), leaves SALT + 7, talus and small
//                     groups SALT + 11, water stones SALT + 13.
//   skips             vegetation.js placementSkip (road pavement, ponds, stream channels), never a
//                     rock whose centre or either end is on one.
// Forms (the look from each lithology, Mother Lode belt):
//   fin    slate / phyllite: thin steep fins along the regional strike (STRIKE_DEG, about N35W),
//          leaning a little to the north-east dip, low reefs 2-12 m long plus upright tombstones;
//          the crest broken in steps along the bedding, ends splintered, thickness wandering, a
//          slight bend, cleavage leaves on the faces and flaking off the sides; dark grey, rust
//          streaks, lichen in colonies on the tops.
//   schist thicker fins along the same strike, wavy foliation, silvery grey.
//   knob   greenstone (and volcanic, marble): rounded knobby masses with a few fracture faces, dark
//          grey-green, heavily lichened.
//   dome   granitic: flat-topped domes and corestones split by near-vertical joints into rounded
//          blocks (crisp cracks drawn from the joint planes), exfoliation sheets, some corestones
//          split with a fresh pale face; grey, salt-and-pepper speckle, dark rind and water streaks.
//   block  serpentinite (and sandstone): angular grey-green blocks bounded by sharp joint faces,
//          the faces slickensided (darker, glossy, striated), waxy sheen, plenty of rubble around.
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
//   peb     every stone under ~0.4 m, all classes in one draw, 80 triangles (angular or water-worn
//           per instance), dithered out at 220 m per metre (~3 px), 10-50 m
// Fins and their float use a swept tube with the same budgets (1620, 176, 72; 320, 72 triangles).
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
export { STRIKE_DEG };   // regional strike of the Mother Lode belt (tilepackage.js: N35W), shared with the vegetation openings
const VARIANTS = 6;
// Roles: the geometry detail of each band (icosphere subdivisions: 8 = 1620 triangles, 3 = 320,
// 2 = 180, 1 = 80) and which list of the cell plan it draws.
const ROLE = {
  close: { detail: 8, src: 'out' }, near: { detail: 2, src: 'out' }, far: { detail: 1, src: 'out' },
  bclose: { detail: 3, src: 'bould' }, bould: { detail: 1, src: 'bould' }, peb: { detail: 1, src: 'peb' },
};
const SALT = 0x0c4c;
// stream classes and widths as water.js draws them (water 1.6 A^0.45 m or by order, bed 1.5 w + 1)
const STREAM_CLASS = { 46006: 'perennial', 55800: 'perennial', 46003: 'intermittent', 33400: 'intermittent', 46007: 'ephemeral', 33600: null };
const WIDTH_BY_ORDER = [0, 1.5, 2.5, 4, 7, 12, 20, 30], WATER_WIDTH_SCALE = { ephemeral: 0.6, intermittent: 0.8, perennial: 1 };
// The pebble tier: every stone under ~0.4 m (talus, small-stone groups, stream and shore gravel),
// all classes in one instanced draw (colour per instance), 80 triangles, faded at ~3 css px (s x 220 m, 10-50 m).
const PEB_OUT = s => `clamp(${s} * 220.0, 10.0, 50.0)`;
const PEB_LOOK = { spec: 0.04, shin: 16, lichen: 0.35, speckle: 0.15, far: 0.9 };

// Look per rock class (sRGB colours). spec / shin: Blinn-Phong sheen. lichen: cover 0..1.
// speckle: dark mineral grains up close. rubble: boulder multiplier. fresh: colour of a fresh or
// polished face (aFace). stain: soil at the ground line. Fragment terms: flake (cleavage leaves on
// slate and schist faces), joint (crisp cracks along granite joints and exfoliation sheet edges),
// slick (slickensided serpentinite faces: polished, striated), far (albedo factor once a rock's
// cracks, pits and lichen are under a pixel, by metres per pixel, the same in every tier).
export const LOOK = {
  greenstone_metavolcanic: { form: 'knob', color: [0.36, 0.39, 0.33], mottle: [0.41, 0.40, 0.34], spec: 0.03, shin: 14, lichen: 0.8, speckle: 0.3, far: 0.92 },
  serpentinite: { form: 'block', color: [0.42, 0.45, 0.42], mottle: [0.29, 0.33, 0.29], fresh: [0.26, 0.32, 0.29], spec: 0.05, shin: 18, lichen: 0.2, speckle: 0.05, rubble: 2.4, slick: 1, far: 0.9 },
  slate_phyllite: { form: 'fin', color: [0.39, 0.39, 0.38], mottle: [0.43, 0.40, 0.35], fresh: [0.29, 0.30, 0.32], spec: 0.045, shin: 22, lichen: 0.9, speckle: 0, strike: true, flake: 1, far: 0.92 },
  schist: { form: 'schist', color: [0.42, 0.43, 0.41], mottle: [0.45, 0.43, 0.38], fresh: [0.53, 0.54, 0.54], spec: 0.09, shin: 28, lichen: 0.6, speckle: 0.1, strike: true, flake: 0.5, far: 0.92 },
  granitic: { form: 'dome', color: [0.55, 0.54, 0.51], mottle: [0.44, 0.43, 0.40], fresh: [0.62, 0.61, 0.58], stain: [0.56, 0.49, 0.39], spec: 0.02, shin: 10, lichen: 0.75, speckle: 0.8, joint: 1, far: 0.74 },
  volcanic: { form: 'knob', color: [0.33, 0.31, 0.29], mottle: [0.40, 0.33, 0.27], spec: 0.03, shin: 14, lichen: 0.7, speckle: 0.2, far: 0.92 },
  sandstone_conglomerate: { form: 'block', color: [0.56, 0.49, 0.39], mottle: [0.47, 0.40, 0.31], spec: 0.01, shin: 8, lichen: 0.5, speckle: 0.3, far: 0.9 },
  limestone_marble: { form: 'knob', color: [0.70, 0.69, 0.65], mottle: [0.58, 0.56, 0.52], spec: 0.03, shin: 16, lichen: 0.5, speckle: 0.1, far: 0.8 },
  alluvium: { form: 'dome', color: [0.50, 0.48, 0.44], mottle: [0.42, 0.40, 0.36], spec: 0.02, shin: 10, lichen: 0.3, speckle: 0.4, far: 0.8 },
  other: { form: 'knob', color: [0.46, 0.45, 0.42], mottle: [0.40, 0.37, 0.32], spec: 0.02, shin: 10, lichen: 0.5, speckle: 0.2, far: 0.9 },
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
// Two kinds of geometry, both built from a seeded stream so variant v of a form is the same shape at
// every detail level and on every client:
//   tube     slate and schist (fins, tombstones, float, flaking leaves): a loop of points around the
//            section swept along the strike through a few dozen columns and closed by a fan at each
//            end, so the crest can break in steps at chosen columns (a deformed box, in effect).
//   sphere   greenstone, granite, serpentinite and the rest: a deformed icosphere (superellipsoid,
//            noise, planar cuts for fracture and joint faces, joint grooves, exfoliation steps).
// Per vertex, besides position and normal: aFace (0..1, a fresh or polished face: the broken ends and
// risers of a fin, the split face of a granite boulder, a slickensided serpentinite face) and aJoint
// (signed distances to up to two joint planes, in the rock's own units, and the exfoliation field),
// which the fragment shader turns into crisp cracks and sheet edges finer than the mesh.

// Parameters of one sphere variant: axes (radii before normalising), noise, the class's special
// terms, planar cuts {n, d, soft} and joints {n, d} (granite).
function shapeParams(form, kind, v) {
  const r = mulberry32(hashStr(`${form}:${kind}:${v}`)), R = () => r();
  const P = { form, seed: (R() * 1e6) | 0, ax: [1, 0.5, 0.5], amp: 0.1, freq: 1.6, ridge: 0, cuts: [], joints: [], sheet: 0, ground: 0.3, split: false };
  const cut = (n, d, soft) => { const l = Math.hypot(...n); P.cuts.push({ n: n.map(c => c / l), d, soft }); };
  const randCut = (d0, d1, soft, yMin = -0.2) => { const n = [R() * 2 - 1, yMin + R() * (1 - yMin), R() * 2 - 1]; cut(n, d0 + (d1 - d0) * R(), soft); };
  const joint = (n, d) => { const l = Math.hypot(...n); P.joints.push({ n: n.map(c => c / l), d }); };
  const tall = v >= 3;
  if (kind !== 'bould') {
    if (form === 'knob') {
      Object.assign(P, { ax: [1, 0.55 + 0.25 * R(), 0.7 + 0.25 * R()], amp: 0.18, freq: 1.3, ridge: 0.14, ground: 0.3 });
      for (let k = 0, n = 3 + (R() * 3 | 0); k < n; k++) randCut(0.72, 0.88, 0.25);
    } else if (form === 'dome') {
      // granitic: low whalebacks (v 0-2) and corestones (3-5, 4 and 5 split): rounded but jointed by
      // near-vertical planes into blocks, flat-topped, the outer sheet peeling off in places
      if (!tall) Object.assign(P, { ax: [1, 0.32 + 0.1 * R(), 0.8 + 0.15 * R()], amp: 0.05, freq: 1.4, ridge: 0.02, ground: 0.12, sheet: 0.03 });
      else Object.assign(P, { ax: [1, 0.66 + 0.12 * R(), 0.8 + 0.1 * R()], amp: 0.05, freq: 1.5, ridge: 0.02, ground: 0.2, split: v >= 4, sheet: 0.025 });
      cut([0, 1, 0], 0.7 + 0.1 * R(), 0.2);                                  // flattened top
      for (let k = 0; k < 2; k++) randCut(0.78, 0.92, 0.35, -0.5);
      const a0 = R() * Math.PI, d0 = (R() - 0.5) * 0.5, tilt = () => 0.12 * (R() - 0.5);
      joint([Math.cos(a0), tilt(), Math.sin(a0)], d0);
      if (!tall) {                                                            // a parallel joint and a cross joint
        const a1 = a0 + 0.2 * (R() - 0.5), s = d0 > 0 ? -1 : 1;
        joint([Math.cos(a1), tilt(), Math.sin(a1)], d0 + s * (0.35 + 0.2 * R()));
        if (R() < 0.6) { const a2 = a0 + Math.PI / 2 + 0.3 * (R() - 0.5); joint([Math.cos(a2), tilt(), Math.sin(a2)], 0.4 * (R() - 0.5)); }
      } else if (v === 3) joint([tilt(), 1, tilt()], 0.05 + 0.15 * R());     // a corestone stacked on a sheeting joint
    } else {   // block
      // serpentinite (and sandstone): angular blocks bounded by sharp joint faces at odd angles
      Object.assign(P, { ax: [1, 0.6 + 0.15 * R(), 0.75 + 0.15 * R()], amp: 0.06, freq: 1.4, ridge: 0.03, ground: 0.28 });
      const j = () => 0.7 * (R() - 0.5);
      for (const n of [[1, j(), j()], [-1, j(), j()], [j(), 1, j()], [j(), j(), 1], [j(), j(), -1]]) cut(n, 0.62 + 0.2 * R(), 0.03);
      for (let k = 0; k < 2; k++) randCut(0.7, 0.85, 0.05, 0.0);
    }
  } else {
    if (form === 'knob') { Object.assign(P, { ax: [1, 0.7 + 0.15 * R(), 0.8 + 0.15 * R()], amp: 0.14, freq: 1.5, ridge: 0.08 }); for (let k = 0, n = 3 + (R() * 2 | 0); k < n; k++) randCut(0.7, 0.85, 0.15); }
    else if (form === 'dome') {
      Object.assign(P, { ax: [1, 0.66 + 0.15 * R(), 0.8 + 0.15 * R()], amp: 0.07, freq: 1.6, ground: 0.25, split: v === 5, sheet: 0.02 });
      cut([0, 1, 0], 0.8 + 0.1 * R(), 0.35); randCut(0.72, 0.88, 0.3, -0.5);
      if (v === 2 || v === 3) { const a = R() * Math.PI; joint([Math.cos(a), 0.1 * (R() - 0.5), Math.sin(a)], 0.3 * (R() - 0.5)); }
    } else {
      Object.assign(P, { ax: [1, 0.6 + 0.2 * R(), 0.75 + 0.2 * R()], amp: 0.06, freq: 1.5, ridge: 0.02 });
      cut([0.2 * (R() - 0.5), 1, 0.2 * (R() - 0.5)], 0.65 + 0.15 * R(), 0.03);
      for (let k = 0; k < 5; k++) randCut(0.6, 0.82, 0.03, -0.3);
    }
  }
  // Superellipsoid exponents per axis (1 round, toward 0 box-like).
  const EX = kind !== 'bould' ? { knob: [0.85, 0.8, 0.85], dome: [0.75, 0.8, 0.75], block: [0.6, 0.6, 0.6] }
    : { knob: [0.8, 0.8, 0.8], dome: [0.8, 0.85, 0.8], block: [0.62, 0.62, 0.62] };
  P.ex = EX[form] || [1, 1, 1];
  // cut and joint distances are fractions of the shape's extent along the normal
  for (const c of [...P.cuts, ...P.joints]) c.d *= Math.hypot(c.n[0] * P.ax[0], c.n[1] * P.ax[1], c.n[2] * P.ax[2]);
  if (P.split) { const a = 0.25 * (R() - 0.5); P.splitN = [Math.cos(a), 0.15 * (R() - 0.5), Math.sin(a)]; P.splitG = 0.04; }
  return P;
}

const ROUGH = { knob: 0.06, dome: 0.025, block: 0.025 };
const JOINT_CRACK = 0.05, JOINT_W = 0.14, JOINT_ROUND = 0.1, JOINT_WR = 0.22;   // granite joints (raw units, radius ~1)
// Displace one unit-sphere direction. Returns [x, y, z, noise, face, fdx, fdy, fdz, j0, j1, sheet] in
// the shape's own (unnormalised) space. half: +-1 for a split boulder's halves, 0 whole (a split
// variant drawn whole gets its split plane as a deep joint instead).
function displace(px, py, pz, P, half = 0) {
  const s = P.seed, f = P.freq;
  const n = fbm3(px * f + 11.3, py * f + 3.1, pz * f + 7.7, s, 4);
  let r = 1 + P.amp * n;
  r += (ROUGH[P.form] || 0.04) * fbm3(px * 4.6 + 2.3, py * 4.6 + 8.1, pz * 4.6 + 4.4, s + 13, 3);   // knobs and pits at a quarter of the size
  if (P.ridge) r += P.ridge * (1 - Math.abs(fbm3(px * 2.2 + 1.7, py * 2.2, pz * 2.2 + 5.1, s + 7, 2))) - P.ridge * 0.5;
  let sheet = 9;
  if (P.sheet) {   // exfoliation: where the field is positive the outer sheet has come away, a step down
    sheet = fbm3(px * 1.5 + 5.1, py * 1.5 + 2.2, pz * 1.5 + 8.3, s + 91, 2) * 1.4 + 0.4 * py - 0.25;
    r -= P.sheet * smooth(-0.05, 0.05, sheet);
  }
  const se = (c, e) => e === 1 ? c : Math.sign(c) * Math.pow(Math.abs(c), e);
  let x = se(px, P.ex[0]) * r * P.ax[0], y = se(py, P.ex[1]) * r * P.ax[1], z = se(pz, P.ex[2]) * r * P.ax[2];
  let nzo = n;
  const joints = P.split && !half ? [...P.joints, { n: P.splitN, d: 0, deep: true }] : P.joints;
  if (joints.length) {   // rounded blocks meeting in a crack: pushed in along the ellipsoid normal
    let ex = px / P.ax[0], ey = py / P.ax[1], ez = pz / P.ax[2]; const l = Math.hypot(ex, ey, ez); ex /= l; ey /= l; ez /= l;
    for (const J of joints) {
      const a = Math.abs(x * J.n[0] + y * J.n[1] + z * J.n[2] - J.d);
      const g = (J.deep ? 1.6 : 1) * JOINT_CRACK * (1 - smooth(0, JOINT_W, a)) + JOINT_ROUND * Math.pow(1 - smooth(0, JOINT_WR, a), 2);
      x -= ex * g; y -= ey * g; z -= ez * g; nzo -= 8 * g;
    }
  }
  let face = 0, fd = [0, 1, 0], best = 0.004;
  for (const c of P.cuts) {
    const d = x * c.n[0] + y * c.n[1] + z * c.n[2] - c.d;
    if (d > 0) {
      const k = d * (1 - c.soft); x -= c.n[0] * k; y -= c.n[1] * k; z -= c.n[2] * k;
      if (c.soft < 0.1 && k > best) { best = k; face = 1; fd = c.n; }
    }
  }
  if (half) {   // split boulder: this half is clamped to its side of a plane through the centre
    const N = P.splitN, d = x * N[0] + y * N[1] + z * N[2], g = P.splitG * (0.4 + 1.6 * smooth(-0.3, 1, y / P.ax[1]));   // a wedge, opening upward
    if (half > 0 && d < g) { const k = g - d; x += N[0] * k; y += N[1] * k; z += N[2] * k; face = 1; fd = N.map(c => -c); }
    if (half < 0 && d > -g) { const k = d + g; x -= N[0] * k; y -= N[1] * k; z -= N[2] * k; face = 1; fd = N; }
  }
  const jd = k => joints[k] ? x * joints[k].n[0] + y * joints[k].n[1] + z * joints[k].n[2] - joints[k].d : 9;
  return [x, y, z, nzo, face, fd[0], fd[1], fd[2], jd(0), jd(1), sheet];
}

// ---- tubes (slate and schist) ----
// detail -> [columns, face points per side, crest points, bottom points]; triangles 2 L (nu - 1) + 2 L
// with L = 2 nf + nt + nb: 1620 (8), 320 (3), 176 (2), 72 (1), inside each tier's budget.
const TUBE = { 8: [45, 7, 3, 1], 3: [20, 3, 1, 1], 2: [11, 3, 1, 1], 1: [6, 2, 1, 1] };
// Raw space: x along the strike from -1 to 1, y up with the ground line at 0, z across. Types:
//   reef   (out v 0-2)   low fin, the crest broken in 3-6 steps along the bedding, ends splintered
//   tomb   (out v 3-5)   upright tombstone slab, 1-2 breaks in a ragged top
//   slab   (bould v 0-2) a chunky block of float on edge
//   plate  (bould v 3-5) a plate of float lying on its cleavage face
//   leaf   (bould v 6-7) a thin leaf of slate flaked off a fin, leaned against it by placement
function tubeParams(form, kind, v) {
  const r = mulberry32(hashStr(`tube:${form}:${kind}:${v}`)), R = () => r();
  const schist = form === 'schist', bould = kind === 'bould';
  const type = !bould ? (v >= 3 ? 'tomb' : 'reef') : v >= 6 ? 'leaf' : v >= 3 ? 'plate' : 'slab';
  //            H     B     T      breaks  env   tilt  bend
  const D = { reef: [0.55, 0.22, 0.1, 3, 6, 0.35, 1.2, 0.08], tomb: [1.3, 0.4, 0.13, 1, 2, 0.12, 0.5, 0.03],
    slab: [0.65, 0.25, 0.2, 1, 2, 0.15, 0.5, 0.02], plate: [0.85, 0, 0.09, 1, 2, 0.1, 0.4, 0.004], leaf: [1.0, 0.18, 0.035, 1, 2, 0.25, 0.6, 0.04] }[type];
  const P = { tube: true, form, type, schist, seed: (R() * 1e6) | 0, lie: type === 'plate', ground: 0.4 };
  P.H = D[0] * (0.85 + 0.3 * R()); P.B = D[1]; P.T = D[2] * (schist ? 1.5 : 1) * (0.85 + 0.3 * R());
  P.env = D[5]; P.bend = D[7] * (0.5 + R()) * (R() < 0.5 ? -1 : 1);
  const nb = D[3] + Math.floor(R() * (D[4] - D[3] + 1)), bk = [];
  for (let t = 0; bk.length < nb && t < 40; t++) { const b = (R() * 2 - 1) * 0.8; if (bk.every(o => Math.abs(o - b) > 0.16)) bk.push(b); }
  bk.sort((a, b) => a - b); P.bk = bk;
  const edges = [-1, ...bk, 1];
  P.seg = edges.slice(1).map((e, j) => {
    const lo = type === 'reef' ? 0.5 : type === 'tomb' ? 0.65 : 0.8, end = j === 0 || j === bk.length ? 0.8 + 0.2 * R() : 1;
    return { lev: (lo + (1 - lo) * R()) * end, tilt: (R() - 0.5) * D[6], mid: (edges[j] + e) / 2 };
  });
  // the breaks a coarse tier keeps: the biggest steps first
  P.rank = bk.map((b, j) => [Math.abs(P.seg[j + 1].lev - P.seg[j].lev) + 0.3 * Math.abs(P.seg[j + 1].tilt - P.seg[j].tilt), b]).sort((a, b) => b[0] - a[0]).map(q => q[1]);
  // splintered ends: the end retreats in steps up the height, the top corner chipped, the last
  // tenth thinning to a sliver pushed to one side
  P.bite = [0, 1].map(() => [0.12 * R(), 0.12 * R(), 0.06 + 0.16 * R()]);
  P.endThin = 0.25 + 0.25 * R(); P.endSide = [R() < 0.5 ? -1 : 1, R() < 0.5 ? -1 : 1];
  return P;
}
function tubeTop(P, u) {
  let j = 0; while (j < P.bk.length && u > P.bk[j]) j++;
  const g = P.seg[j];
  return P.H * (1 - P.env * u * u) * (g.lev + g.tilt * (u - g.mid))
    + P.H * (0.1 * (vnoise3(u * 3.1, 0.5, 0.5, P.seed + 2) - 0.5) + 0.05 * (vnoise3(u * 7.3, 0.5, 0.5, P.seed + 3) - 0.5)) * 2;
}
// One section point: (u along, h 0..1 from the bottom to the crest, side +-1 face or 0 crest at
// across fraction zf). Returns [x, y, z, noise].
function tubePoint(P, u, top, h, side, zf = 0) {
  const s = P.seed, au = Math.abs(u), e = u < 0 ? 0 : 1;
  const yy = side ? -P.B + (top + P.B) * h : top + P.H * 0.035 * (vnoise3(u * 9.1, zf * 1.3, 0.3, s + 9) - 0.5) * 2 + (P.schist ? 0.04 * P.H * (1 - zf * zf) : 0);
  const yt = Math.min(Math.max(yy / Math.max(top, 1e-3), 0), 1);
  let ht = P.T * (0.6 + 0.8 * vnoise3(u * 1.7, 0.2, 0.7, s + 5)) * (1 - 0.5 * yt);   // wedge: thinner toward the crest
  ht *= P.endThin + (1 - P.endThin) * smooth(0.99, 0.8, au);
  const zc = P.bend * (u * u - 0.35) + P.bend * 0.7 * (vnoise3(u * 1.6, 0.4, 0.1, s + 7) - 0.5) * 2 + P.endSide[e] * P.T * 0.6 * smooth(0.8, 1, au);
  let z, nz = 0.3;
  if (side) {
    let fl;
    if (P.schist) fl = 0.22 * Math.sin(u * 10 + yy * 4 + 4 * vnoise3(u * 1.5, yy * 2, side, s + 11));   // wavy foliation
    else { const q = Math.floor(vnoise3(u * 5.5 + side * 13, yt * 3.2, side * 7.1, s + 11) * 3) / 2; fl = 0.4 * (q - 0.5); nz = (q - 0.5) * 1.2; }   // cleavage leaves step out and in
    z = zc + side * ht * (1 + (h > 0.05 ? fl : 0));
    if (h <= 0) nz = -1;
  } else z = zc + zf * ht * 0.85;
  const b = P.bite[e], bite = (yt < 0.33 ? b[0] : yt < 0.66 ? b[1] : b[1] + b[2] * (yt - 0.66) * 3) * smooth(0.55, 1, au);
  return [u - Math.sign(u) * bite, yy, z, nz];
}
// The tube mesh at a detail level: raw positions, index, noise per vertex.
function tubeMesh(P, detail) {
  const [nu, nf, nt, nbot] = TUBE[detail] || TUBE[8], L = 2 * nf + nt + nbot;
  // columns: the kept breaks as riser pairs, the rest spread evenly, none closer than 0.02
  const keep = P.rank.slice(0, detail >= 8 ? 9 : detail >= 3 ? 2 : detail >= 2 ? 3 : 1), dl = 0.012;
  const us = [];
  for (const b of keep) us.push(b - dl, b + dl);
  const nUni = nu - us.length;
  for (let q = 0; q < nUni; q++) { const u = -1 + 2 * q / (nUni - 1); if (q === 0 || q === nUni - 1 || us.every(o => Math.abs(o - u) > 0.02)) us.push(u); }
  us.sort((a, b) => a - b);
  const nc = us.length, pos = [], nzs = [];
  const fh = k => nf === 1 ? 0 : 1 - Math.pow(1 - k / (nf - 1), 1.5);
  for (const u of us) {
    const top = tubeTop(P, u), bevel = 0.2;
    const pts = [];
    for (let k = 0; k < nf; k++) pts.push(tubePoint(P, u, top, fh(k) * (1 - bevel * 0.25), 1));
    for (let c = 1; c <= nt; c++) pts.push(tubePoint(P, u, top, 1, 0, 1 - 2 * c / (nt + 1)));
    for (let k = nf - 1; k >= 0; k--) pts.push(tubePoint(P, u, top, fh(k) * (1 - bevel * 0.25), -1));
    for (let c = 0; c < nbot; c++) { const p = tubePoint(P, u, top, 0, 0, 0); p[1] = -P.B - 0.02; p[3] = -1; pts.push(p); }
    for (const p of pts) { pos.push(p[0], p[1], p[2]); nzs.push(p[3]); }
  }
  const idx = [];
  for (let c = 0; c < nc - 1; c++) for (let k = 0; k < L; k++) {
    const a = c * L + k, b = c * L + (k + 1) % L, c2 = a + L, d = b + L;
    idx.push(a, c2, b, b, c2, d);
  }
  // fix the side winding from one +z face triangle (normal must point +z)
  const tri = (i0, i1, i2) => {
    const A = [pos[i1 * 3] - pos[i0 * 3], pos[i1 * 3 + 1] - pos[i0 * 3 + 1], pos[i1 * 3 + 2] - pos[i0 * 3 + 2]];
    const B = [pos[i2 * 3] - pos[i0 * 3], pos[i2 * 3 + 1] - pos[i0 * 3 + 1], pos[i2 * 3 + 2] - pos[i0 * 3 + 2]];
    return [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
  };
  const mc = nc >> 1, kf = Math.max(0, (nf >> 1) - 1), t0 = (mc * L + kf) * 6;
  if (tri(idx[t0], idx[t0 + 1], idx[t0 + 2])[2] < 0) for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
  // end caps: a fan from the centroid of the end loop, wound to face out along -x / +x
  for (const [c, dir] of [[0, -1], [nc - 1, 1]]) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < L; k++) { const i = (c * L + k) * 3; cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
    const ci = pos.length / 3; pos.push(cx / L + dir * 0.004, cy / L, cz / L); nzs.push(0);
    const tris = []; let ax = 0;
    for (let k = 0; k < L; k++) { const a = c * L + k, b = c * L + (k + 1) % L; tris.push(ci, a, b); ax += tri(ci, a, b)[0]; }
    if (ax * dir < 0) for (let q = 0; q < tris.length; q += 3) { const t = tris[q + 1]; tris[q + 1] = tris[q + 2]; tris[q + 2] = t; }
    idx.push(...tris);
  }
  if (P.lie) for (let i = 0; i < pos.length; i += 3) { const y = pos[i + 1], z = pos[i + 2]; pos[i + 1] = z; pos[i + 2] = -(y - P.H / 2); }   // lay it on its face
  return { pos: new Float32Array(pos), index: new Uint32Array(idx), nz: new Float32Array(nzs) };
}

// Raw (unnormalised) mesh of a variant at a detail level: { pos, index, nz, face, fdir, joint }.
// Split granite: each half at a detail that keeps the pair inside the tier's budget (close: two of
// 720), the coarser tiers draw it whole with the split as a deep joint (a gap of a few cm at 60 m).
const SPLIT_DETAIL = { 8: 5 };
function rawShape(P, detail) {
  if (P.tube) {
    const t = tubeMesh(P, detail), n = t.pos.length / 3;
    return { ...t, face: new Float32Array(n), fdir: new Float32Array(n * 3), joint: new Float32Array(n * 3).fill(9) };
  }
  const halves = P.split && SPLIT_DETAIL[detail] ? [1, -1] : [0], d = halves.length > 1 ? SPLIT_DETAIL[detail] : detail;
  const parts = halves.map(half => {
    let g = new THREE.IcosahedronGeometry(1, d); g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position, n = p.count;
    const out = { pos: new Float32Array(n * 3), index: g.index.array, nz: new Float32Array(n), face: new Float32Array(n), fdir: new Float32Array(n * 3), joint: new Float32Array(n * 3) };
    for (let k = 0; k < n; k++) {
      const q = displace(p.getX(k), p.getY(k), p.getZ(k), P, half);
      out.pos.set(q.slice(0, 3), k * 3); out.nz[k] = q[3]; out.face[k] = q[4]; out.fdir.set(q.slice(5, 8), k * 3); out.joint.set(q.slice(8, 11), k * 3);
    }
    g.dispose(); return out;
  });
  if (parts.length === 1) return parts[0];
  const cat = (name, w) => { const a = new Float32Array((parts[0][name].length + parts[1][name].length)); a.set(parts[0][name]); a.set(parts[1][name], parts[0][name].length); return a; };
  const n0 = parts[0].pos.length / 3, index = new Uint32Array(parts[0].index.length + parts[1].index.length);
  index.set(parts[0].index); for (let k = 0; k < parts[1].index.length; k++) index[parts[0].index.length + k] = parts[1].index[k] + n0;
  return { pos: cat('pos'), index, nz: cat('nz'), face: cat('face'), fdir: cat('fdir'), joint: cat('joint') };
}

function paramsOf(form, kind, v) { return form === 'fin' || form === 'schist' ? tubeParams(form, kind, v) : shapeParams(form, kind, v); }

// Normalisation of a variant (length 1 along x, ground line at y = 0), from a fine sample so every
// detail level of the variant shares it. thk: the mean thickness of a fin's slab (placement sizes
// fins by it, so a bend or a flaking leaf does not thin the rock).
const norms = new Map();
function normOf(form, kind, v, P) {
  const key = `${form}:${kind}:${v}`; if (norms.has(key)) return norms.get(key);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const add = (x, y, z) => { const q = [x, y, z]; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a]); hi[a] = Math.max(hi[a], q[a]); } };
  if (P.tube) { const t = tubeMesh(P, 8); for (let k = 0; k < t.pos.length; k += 3) add(t.pos[k], t.pos[k + 1], t.pos[k + 2]); }
  else {
    const g0 = new THREE.IcosahedronGeometry(1, 10); g0.deleteAttribute('normal'); g0.deleteAttribute('uv');
    const g = mergeVertices(g0), p = g.attributes.position; g0.dispose();   // unique directions only
    for (let k = 0; k < p.count; k++) for (const half of P.split ? [1, -1] : [0]) { const q = displace(p.getX(k), p.getY(k), p.getZ(k), P, half); add(q[0], q[1], q[2]); }
    g.dispose();
  }
  const s = 1 / (hi[0] - lo[0]), y0 = P.tube && !P.lie ? 0 : lo[1] + P.ground * (hi[1] - lo[1]);
  const wid = (hi[2] - lo[2]) * s;
  const N = { s, off: [-(hi[0] + lo[0]) / 2, -y0, -(hi[2] + lo[2]) / 2],
    dims: { wid, hgt: (hi[1] - y0) * s, below: (y0 - lo[1]) * s, thk: P.tube && !P.lie ? Math.min(1.8 * P.T * s, wid) : wid } };
  norms.set(key, N); return N;
}

// Normals with creases: faces meeting at more than `angle` keep their own normal (the vertex is
// split), so joint faces, fin risers and broken ends stay sharp while weathered curves stay smooth.
function creased(pos, index, extras, angle) {
  const nv = pos.length / 3, nt = index.length / 3, fn = new Float32Array(nt * 3), fu = new Float32Array(nt * 3);
  const adj = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) {
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1e-12;
    fn[t * 3] = nx; fn[t * 3 + 1] = ny; fn[t * 3 + 2] = nz; fu[t * 3] = nx / l; fu[t * 3 + 1] = ny / l; fu[t * 3 + 2] = nz / l;
    for (let k = 0; k < 3; k++) adj[index[t * 3 + k]].push(t);
  }
  const cosA = Math.cos(angle), map = new Map(), P = [], N = [], X = extras.map(() => []), idx = new Uint32Array(index.length);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const v = index[t * 3 + k]; let nx = 0, ny = 0, nz = 0;
    for (const o of adj[v]) if (fu[o * 3] * fu[t * 3] + fu[o * 3 + 1] * fu[t * 3 + 1] + fu[o * 3 + 2] * fu[t * 3 + 2] > cosA) { nx += fn[o * 3]; ny += fn[o * 3 + 1]; nz += fn[o * 3 + 2]; }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const key = `${v}|${Math.round(nx * 50)}|${Math.round(ny * 50)}|${Math.round(nz * 50)}`;
    let i = map.get(key);
    if (i === undefined) {
      i = P.length / 3; map.set(key, i); P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); N.push(nx, ny, nz);
      extras.forEach((e, q) => { for (let c = 0; c < e.size; c++) X[q].push(e.a[v * e.size + c]); });
    }
    idx[t * 3 + k] = i;
  }
  return { pos: new Float32Array(P), nrm: new Float32Array(N), index: idx, extras: X.map(a => new Float32Array(a)) };
}
// crease angle (degrees) per form, fine tiers / coarse tiers
const CREASE = { fin: [38, 55], schist: [45, 60], knob: [180, 180], dome: [55, 180], block: [32, 55] };

// One variant's geometry at a detail level: position, creased normal, vertex colour (class colour,
// mottling, crevice darkening, weathered tops, rust streaks or rind and water streaks, fresh faces,
// soil stain at the ground line) and the aFace / aJoint attributes.
function rockGeometry(cls, kind, v, detail) {
  const look = LOOK[cls], form = look.form, P = paramsOf(form, kind, v), N = normOf(form, kind, v, P);
  const raw = rawShape(P, detail);
  for (let k = 0; k < raw.pos.length; k += 3) for (let a = 0; a < 3; a++) raw.pos[k + a] = (raw.pos[k + a] + N.off[a]) * N.s;
  for (let k = 0; k < raw.joint.length; k++) if (raw.joint[k] < 8 && (k % 3) < 2) raw.joint[k] *= N.s;   // joint distances in the rock's units
  const ca = CREASE[form] || [180, 180], ang = (detail >= 3 ? ca[0] : ca[1]) * Math.PI / 180;
  const cr = creased(raw.pos, raw.index, [{ a: raw.nz, size: 1 }, { a: raw.face, size: 1 }, { a: raw.fdir, size: 3 }, { a: raw.joint, size: 3 }], ang);
  const [nzA, faceA, fdirA, jointA] = cr.extras, p = cr.pos, nr = cr.nrm, n = p.length / 3;
  const col = new Float32Array(n * 3), face = new Float32Array(n);
  const base = look.color, mot = look.mottle, fresh = look.fresh || base, stainC = look.stain || [0.24, 0.20, 0.15], H = N.dims.hgt, S = P.seed;
  const tube = !!P.tube;
  for (let k = 0; k < n; k++) {
    const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2], nx = nr[k * 3], ny = nr[k * 3 + 1], nzz = nr[k * 3 + 2];
    // fresh or polished face: a fin's breaks face along its length; a cut or split face faces its plane
    const fc = tube ? smooth(0.5, 0.85, Math.abs(nx)) * (y > -0.01 ? 1 : 0)
      : faceA[k] * smooth(0.75, 0.95, nx * fdirA[k * 3] + ny * fdirA[k * 3 + 1] + nzz * fdirA[k * 3 + 2]);
    face[k] = fc;
    const m = smooth(0.35, 0.75, vnoise3(x * 3.2 + 4, y * 3.2, z * 3.2, S + 61)) * (form === 'block' ? 0.8 : form === 'dome' ? 0.6 : 0.45);
    let c = [0, 1, 2].map(a => base[a] + (mot[a] - base[a]) * m);
    let shade = 0.74 + 0.26 * smooth(-0.55, 0.35, nzA[k]);                 // crevices darker
    shade *= 1 + (form === 'knob' || form === 'block' ? 0.1 : 0.04) * smooth(0.2, 0.9, ny);    // weathered, bleached tops
    shade *= 0.92 + 0.16 * vnoise3(x * 9, y * 9, z * 9, S + 71);           // fine grain
    if (form === 'fin' || form === 'schist') {                             // rust streaks running down the faces
      const st = smooth(0.66, 0.85, vnoise3(x * 7, y * 0.8, z * 7, S + 81)) * (form === 'schist' ? 0.15 : 0.3);
      c = c.map((a, i) => a + ([0.46, 0.33, 0.22][i] - a) * st);
    } else if (form === 'dome') {                                          // dark water streaks down the steep faces
      const st = smooth(0.55, 0.8, vnoise3(x * 6, y * 0.7, z * 6, S + 83)) * (1 - ny * ny) * 0.3;
      shade *= 1 - st;
    } else if (form === 'block') {                                         // weathered tan rind on the upper faces
      const wt = smooth(0.5, 0.8, vnoise3(x * 2.5, y * 2.5, z * 2.5, S + 87)) * smooth(0.2, 0.9, ny) * 0.5;
      c = c.map((a, i) => a + ([0.52, 0.50, 0.42][i] - a) * wt);
    }
    c = c.map((a, i) => a + (fresh[i] - a) * fc * 0.85);
    const stain = 1 - smooth(-0.01, Math.min(form === 'dome' ? 0.1 : 0.06, H * 0.12), y);   // soil splash at the ground line (grus around granite)
    c = c.map((a, i) => (a + (stainC[i] - a) * 0.5 * stain) * shade);
    col[k * 3] = srgb(c[0]); col[k * 3 + 1] = srgb(c[1]); col[k * 3 + 2] = srgb(c[2]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('aFace', new THREE.BufferAttribute(face, 1));
  geometry.setAttribute('aJoint', new THREE.BufferAttribute(jointA, 3));
  geometry.setIndex(new THREE.BufferAttribute(cr.index, 1));
  geometry.computeBoundingSphere();
  return { geometry, dims: N.dims };
}

// The pebble mesh: an 80-triangle angular stone (a few sharp joint faces, flat-shaded) and, in
// aSph / aSN, a water-worn ellipsoid with the same bounding box and smooth normals; the vertex
// shader blends them per instance (aRound). Length 1 along x, ground line at 30 % of its height.
let pebGeo = null, pebDim = null;
function pebbleGeometry() {
  if (pebGeo) return pebGeo;
  const r = mulberry32(4242), R = () => r();
  const P = { form: 'block', seed: 4242, ax: [1, 0.75, 0.85], amp: 0.08, freq: 1.5, ridge: 0.03, cuts: [], joints: [], sheet: 0, ex: [0.8, 0.8, 0.8] };
  for (let k = 0; k < 6; k++) { const n = [R() * 2 - 1, R() * 2 - 1, R() * 2 - 1], l = Math.hypot(...n); P.cuts.push({ n: n.map(c => c / l), d: (0.6 + 0.2 * R()) * Math.hypot(n[0] / l * P.ax[0], n[1] / l * P.ax[1], n[2] / l * P.ax[2]), soft: 0.04 }); }
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed(); g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const p = g.attributes.position, n = p.count, A = new Float32Array(n * 3), D = new Float32Array(n * 3);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k), l = Math.hypot(x, y, z);
    D.set([x / l, y / l, z / l], k * 3);
    const q = displace(x / l, y / l, z / l, P, 0); A.set(q.slice(0, 3), k * 3);
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a]); hi[a] = Math.max(hi[a], q[a]); }
  }
  const s = 1 / (hi[0] - lo[0]), y0 = lo[1] + 0.3 * (hi[1] - lo[1]), c = [0, 1, 2].map(a => (hi[a] + lo[a]) / 2), h = [0, 1, 2].map(a => (hi[a] - lo[a]) / 2);
  const off = [-c[0], -y0, -c[2]], S = new Float32Array(n * 3), SN = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) {
    A[k * 3 + a] = (A[k * 3 + a] + off[a]) * s;
    S[k * 3 + a] = (c[a] + D[k * 3 + a] * h[a] + off[a]) * s;
  }
  for (let k = 0; k < n; k++) {
    const nx = D[k * 3] / h[0], ny = D[k * 3 + 1] / h[1], nz = D[k * 3 + 2] / h[2], l = Math.hypot(nx, ny, nz);
    SN.set([nx / l, ny / l, nz / l], k * 3);
    const sh = (0.8 + 0.2 * vnoise3(D[k * 3] * 3, D[k * 3 + 1] * 3, D[k * 3 + 2] * 3, 91)) * (0.85 + 0.15 * smooth(-0.6, 0.8, D[k * 3 + 1]));
    col.set([sh, sh, sh], k * 3);
  }
  pebGeo = new THREE.BufferGeometry();
  pebGeo.setAttribute('position', new THREE.BufferAttribute(A, 3)); pebGeo.computeVertexNormals();   // flat: non-indexed
  pebGeo.setAttribute('aSph', new THREE.BufferAttribute(S, 3)); pebGeo.setAttribute('aSN', new THREE.BufferAttribute(SN, 3));
  pebGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  pebGeo.setAttribute('aFace', new THREE.BufferAttribute(new Float32Array(n), 1));
  pebGeo.setAttribute('aJoint', new THREE.BufferAttribute(new Float32Array(n * 3).fill(9), 3));
  pebGeo.computeBoundingSphere();
  pebDim = { hgt: (hi[1] - y0) * s, wid: (hi[2] - lo[2]) * s };
  return pebGeo;
}
function pebbleDims() { if (!pebDim) pebbleGeometry(); return pebDim; }

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
  float FF = 1.0 - smoothstep(rFarOut * ${(FAR_R0 / FAR_R1).toFixed(3)}, rFarOut, rD);
  float PF = 1.0 - smoothstep(rPebOut * 0.8, rPebOut, rD);`;
const OWN = { close: 'vec2(T0, 1.0)', near: 'vec2(0.0, min(T0, 1.0 - T1))', far: 'vec2(1.0 - T1 * FF, 1.0)', bclose: 'vec2(B0, BF)', bould: 'vec2(0.0, min(B0, BF))', peb: 'vec2(0.0, PF)' };
// Vertex: the band (collapsed when the role owns no pixels) and normals by the inverse transpose
// of the instance matrix (it carries a shear). Fragment: the dither, lichen on the upper faces,
// mineral speckle, surface roughness, and the cast shadow on the specular term too.
function rockMaterial(look, role, atmosphere) {
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, specular: new THREE.Color().setScalar(look.spec), shininess: look.shin });
  atmosphere.patchLambert(m);   // cloud + cascaded shadow on the sun term, aerial perspective
  const sa = STRIKE_DEG * Math.PI / 180;
  const U = { rockLichen: look.lichen, rockSpeckle: look.speckle || 0, rockFlake: look.flake || 0, rockJoint: look.joint || 0,
    rockSlick: look.slick || 0, rockFar: look.far || 0.9, rockStrike: new THREE.Vector2(Math.sin(sa), -Math.cos(sa)) };
  chainShader(m, `rock-${role}`, shader => {
    for (const [k, v] of Object.entries(U)) shader.uniforms[k] = { value: v };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRockAB; attribute float aFace; attribute vec3 aJoint; varying float vRockFace; varying vec3 vRockJoint; varying float vRockS;
        ${role === 'peb' ? 'attribute float aRound; attribute vec3 aSph; attribute vec3 aSN;' : ''}`)
      .replace('#include <beginnormal_vertex>', role === 'peb' ? `vec3 objectNormal = normalize(mix(vec3(normal), aSN, aRound));` : '#include <beginnormal_vertex>')
      .replace('#include <begin_vertex>', role === 'peb' ? `vec3 transformed = mix(vec3(position), aSph, aRound);` : '#include <begin_vertex>')
      .replace('#include <defaultnormal_vertex>', `vec3 transformedNormal = objectNormal;
        #ifdef USE_INSTANCING
          transformedNormal = transpose(inverse(mat3(instanceMatrix))) * transformedNormal;
        #endif
        transformedNormal = normalMatrix * transformedNormal;`)
      // the band first thing in main(), so a rock outside it costs a few instructions per vertex
      .replace('#include <uv_vertex>', `vRockAB = vec2(0.0, 1.0); vRockFace = ${role === 'peb' ? 'aRound' : 'aFace'}; vRockJoint = aJoint; vRockS = 1.0;
        #ifdef USE_INSTANCING
        { vec3 rO = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float rD = distance(rO, cameraPosition), rSize = max(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
          float rOut = ${BOULD_OUT('rSize')}, rFarOut = ${FAR_OUT('rSize')}, rPebOut = ${PEB_OUT('rSize')};
          ${BANDS}
          vRockAB = ${OWN[role]}; vRockS = rSize;
          if (vRockAB.x >= vRockAB.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } }
        #endif
        #include <uv_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRockAB; varying float vRockFace; varying vec3 vRockJoint; varying float vRockS;
        uniform float rockLichen, rockSpeckle, rockFlake, rockJoint, rockSlick, rockFar; uniform vec2 rockStrike;
        ` + ROCK_GLSL)
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
          float rFresh = vRockFace;
          // Joints (granite): crisp cracks where the joint planes meet the surface, finer than the
          // mesh (the signed plane distance interpolates exactly across a triangle), a damp darker
          // margin beside them; exfoliation: the sheet edge as a thin line, the surface under the
          // lost sheet fresher and paler. Both fade out before they get under a pixel.
          if (rockJoint > 0.0) {
            float fadeJ = 1.0 - smoothstep(0.03, 0.09, rPx), crack = 0.0, damp = 0.0;
            for (int q = 0; q < 2; q++) {
              float dW = abs(vRockJoint[q]) * vRockS, fw = fwidth(dW);
              crack = max(crack, 1.0 - smoothstep(0.012, 0.012 + 1.5 * fw, dW));
              damp = max(damp, 1.0 - smoothstep(0.0, 0.15, dW));
            }
            float sh = vRockJoint.z, fs = fwidth(sh);
            float peeled = smoothstep(-fs, fs, sh) * step(sh, 8.0);
            diffuseColor.rgb *= mix(1.0, 1.14, peeled);
            rFresh = max(rFresh, 0.5 * peeled);
            crack = max(crack, 0.35 * (1.0 - smoothstep(0.0, 1.5 * fs, abs(sh))) * step(abs(sh), 8.0));
            diffuseColor.rgb *= 1.0 - rockJoint * (0.82 * crack * fadeJ + 0.2 * damp);
          }
          // Cleavage leaves (slate, schist): flakes a few cm to a few dm, stretched along the strike
          // and up the face, thin across it; each leaf a little lighter or darker, its edge a dark line.
          if (rockFlake > 0.0) {
            float fadeF = 1.0 - smoothstep(0.012, 0.05, rPx);
            if (fadeF > 0.0) {
              vec3 Q = vec3(dot(P.xz, rockStrike), P.y, dot(P.xz, vec2(-rockStrike.y, rockStrike.x)));
              float fl = rkNoise(Q * vec3(0.9, 2.6, 9.0)) * 0.65 + rkNoise(Q * vec3(2.4, 7.0, 23.0) + 3.1) * 0.35;
              float lev = floor(fl * 6.0), edge = clamp(fwidth(lev), 0.0, 1.0);
              diffuseColor.rgb *= 1.0 + rockFlake * fadeF * (0.14 * (rkHash(vec3(lev, 3.0, 7.0)) - 0.5) - 0.25 * edge);
            }
          }
          // Slickensides (serpentinite): the polished joint faces are darker green, glossy and
          // striated along the slip; the rest has a waxy sheen.
          if (rockSlick > 0.0) {
            float st = rkNoise(vec3(P.x * 31.0, P.y * 1.7, P.z * 31.0));
            float sl = rockSlick * vRockFace;
            specularStrength *= 1.0 + sl * (1.2 + 2.0 * st);
            diffuseColor.rgb *= 1.0 - sl * 0.12 * st;
          }
          // Lichen: crustose and foliose patches ~0.1-0.5 m in colonies of a few metres, most on the
          // upper faces; orange (Xanthoria, Caloplaca) on tops, grey-green (Xanthoparmelia)
          // elsewhere, none on fresh faces. Under ~2 px a patch is replaced by its mean cover so it
          // never shimmers.
          float cover = rockLichen * (0.25 + 0.75 * smoothstep(-0.1, 0.7, rN.y)) * (1.0 - rFresh) * (0.7 + 0.6 * rkNoise(P * 1.3 + 11.0));
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
          // far: unresolved cracks, pits and lichen darken the mean albedo (same in every tier)
          diffuseColor.rgb *= mix(1.0, rockFar, smoothstep(0.04, 0.45, rPx));
          // Mineral grains (granite's biotite and hornblende): only where a 2 cm grain is over a pixel.
          if (rockSpeckle > 0.0) {
            float g = smoothstep(0.72, 0.76, rkNoise(P * 60.0));
            diffuseColor.rgb *= 1.0 - rockSpeckle * mix(0.55 * g, 0.06, smoothstep(0.005, 0.02, rPx)) * (1.0 - lich);
            // clots of mafic grains a few cm across, readable to ~20 m, their mean kept beyond
            float g2 = smoothstep(0.74, 0.8, rkNoise(P * 19.0 + 31.0));
            diffuseColor.rgb *= 1.0 - rockSpeckle * mix(0.3 * g2, 0.025, smoothstep(0.015, 0.06, rPx)) * (1.0 - lich);
          } }`)
      .replace('#include <lights_phong_fragment>', `#include <lights_phong_fragment>
        material.specularShininess = mix(shininess, 45.0, rockSlick * vRockFace);`)
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
  if (role === 'peb') return Math.min(Math.max(s * 220, 10), 50);
  if (role === 'bclose') return Math.min(BCLOSE_R + BCLOSE_W, bOut);
  return bOut;
}

// ---- the field -------------------------------------------------------------------------------------
export class Rocks {
  // spacing: the terrain mesh's vertex spacing (terrain.js default), so rocks sit on the drawn surface.
  constructor(tile, scene, atmosphere, { spacing = 10 } = {}) {
    this.tile = tile; this.atmosphere = atmosphere; this.spacing = spacing;
    this.group = new THREE.Group(); this.group.name = 'rocks'; scene.add(this.group);
    this.on = true; this.plans = new Map(); this.pebPlans = new Map(); this.meshes = new Map(); this.geoms = new Map();
    this.nearCentre = null; this.farCentre = null;
    this.stats = { nearCells: 0, close: 0, near: 0, far: 0, bclose: 0, bould: 0, peb: 0, buildMs: 0, rebuilds: 0, meshes: 0 };
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
  // mode 'full': masses and boulders with their matrices ({ out, bould }, cached); 'peb': the cell's
  // pebble-tier stones (cached for the cells near the camera only, matrices made on first use);
  // 'count': counts of all three (the census). Every mode draws the same random streams in the same
  // order, so a cell's stones are the same whichever list asked for them.
  plan(i, j, mode = 'full') {
    const id = j * this.W + i, cache = mode === 'full' ? this.plans : mode === 'peb' ? this.pebPlans : null;
    if (cache && cache.has(id)) return cache.get(id);
    const countOnly = mode !== 'full';
    const d = this.cellData(i, j), res = this.res, size = this.tile.size;
    const L = d.L, fragOn = d.frag > 25;
    const out = [], bould = [], peb = [];
    // A small stone (pebble tier): angular talus (round 0) or water-worn (round 1), colour linear.
    const pebble = (x, north, s, round, R, col) => {
      const yaw = R() * Math.PI * 2, tilt = (R() - 0.5) * (round ? 0.15 : 0.6), sy = round ? 0.4 + 0.25 * R() : 0.6 + 0.35 * R(), sz = 0.6 + 0.4 * R();
      if (mode === 'full' || x < 0 || north < 0 || x > size || north > size) return;
      if (!round && this.skip(i, j, 0, x, north)) return;
      if (mode === 'count') { peb.push(1); return; }
      // the matrix is made when the stone first comes within reach (fill): most planned cells are far
      peb.push({ key: 'peb', m: null, c: col, x, y: 0, z: -north, s, r: round, a: [sy, sz, yaw, tilt] });
    };
    if (d.cls && (L > 0.15 || fragOn) && this.tile.habitat.channel(i, j, 0) !== 7) {
      const look = LOOK[d.cls], form = look.form, rnd = mulberry32(hash(i, j, SALT));
      // push returns the rock's footprint (centre, strike, half extents a along / b across, height)
      // for the talus around it, or null where it may not stand
      const push = (list, kind, v, x, north, az, lean, sx, sy, sz, k, ends = 0, R = rnd) => {
        const t = 0.86 + 0.28 * R(), hue = (R() - 0.5) * 0.08;   // drawn first: a skip moves nothing else
        if (this.skip(i, j, k, x, north)) return null;
        if (ends) { const ce = Math.sin(az) * ends, cn = Math.cos(az) * ends; if (this.skip(i, j, k + 50, x + ce, north + cn) || this.skip(i, j, k + 51, x - ce, north - cn)) return null; }
        const dims = this.dimsOf(d.cls, kind === 'bould' ? 'bould' : 'out', v);
        const info = { x, north, az, a: 0.5 * sx, b: 0.5 * dims.wid * sx * sz, h: dims.hgt * sx * sy, s: sx };
        if (countOnly) { list.push(1); return info; }
        const m = this.place(x, north, az, lean, sx, sy, sz, dims, new Float32Array(16));
        list.push({ key: `${d.cls}|${v}`, m, c: [t * (1 + hue), t, t * (1 - hue)], x, y: m[13], z: -north, s: Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[8], m[9], m[10])) });
        return info;
      };
      const parents = [];
      const cx = (i + 0.5 + (rnd() - 0.5) * 0.5) * res, cn = size - (j + 0.5 + (rnd() - 0.5) * 0.5) * res;
      // strike: regional for the bedded classes (slowly wandering +-8 degrees across the tile),
      // joint sets loosely tied to it for greenstone, free for the massive rocks.
      const wander = (vnoise3(i * 0.08, j * 0.08, 0.5, 977) - 0.5) * 16;
      const strike = (STRIKE_DEG + wander) * Math.PI / 180;
      const dipLean = (5 + 15 * rnd()) * Math.PI / 180;   // dip 70-85 degrees toward the north-east
      let k = 0, kl = 0;
      if (L > 0.45) {
        const t = smooth(0.45, 0.9, L), nMain = Math.min(6, 2 + Math.floor(rnd() * (1 + 4 * t)));
        if (look.strike) {
          const thick = form === 'schist';
          const az = strike + (rnd() - 0.5) * 0.1, nb = 1 + Math.floor(rnd() * 2.5);
          const beds = [], gapB = 2 + 3 * rnd(), fins = [];
          for (let b = 0; b < nb; b++) beds.push({ off: (b - (nb - 1) / 2) * gapB + (rnd() - 0.5), s: -2 - 6 * rnd() });
          const sa = Math.sin(az), ca = Math.cos(az);   // strike direction (east, north); across = (ca, -sa)
          for (let q = 0; q < nMain; q++) {
            const bed = beds[q % nb], len = 1.5 + 6.5 * Math.pow(rnd(), 1.3) * (0.6 + 0.4 * t);
            const along = bed.s + len / 2; bed.s += len + 0.3 + 2.5 * rnd();
            const H = (thick ? 0.5 : 0.45) + (thick ? 1.2 : 1.1) * rnd() * (0.6 + 0.4 * t), T = thick ? 0.5 + 0.8 * rnd() : 0.25 + 0.5 * rnd();
            const v = Math.floor(rnd() * 3), dims = this.dimsOf(d.cls, 'out', v);
            const fx = cx + sa * along + ca * bed.off, fn = cn + ca * along - sa * bed.off, faz = az + (rnd() - 0.5) * 0.06, fl = dipLean * (thick ? 0.6 : 1);
            const f = push(out, 'out', v, fx, fn, faz, fl, len, H / (dims.hgt * len), T * (thick ? 0.8 : 0.6) / (dims.thk * len), k++, len * 0.45);
            fins.push({ x: fx, n: fn, az: faz, lean: fl, len, H, T }); if (f) parents.push(f);
          }
          const nTomb = Math.floor(rnd() * (thick ? 2 : 2 + 5 * t));
          for (let q = 0; q < nTomb; q++) {
            const bed = beds[Math.floor(rnd() * nb)], len = 0.5 + 1.5 * rnd(), along = (rnd() - 0.5) * 18;
            const H = 0.4 + 0.9 * rnd(), T = 0.1 + 0.2 * rnd(), v = 3 + Math.floor(rnd() * 3), dims = this.dimsOf(d.cls, 'out', v);
            const off = bed.off + (rnd() - 0.5) * 1.2;
            const f = push(out, 'out', v, cx + sa * along + ca * off, cn + ca * along - sa * off, az + (rnd() - 0.5) * 0.1, dipLean,
              len, H / (dims.hgt * len), T * (thick ? 0.8 : 0.7) / (dims.thk * len), k++);
            if (f) parents.push(f);
          }
          // Leaves of slate flaking off the fins' sides, leaned against them (top away from the fin,
          // past its own dip on the dip side), from a second stream so nothing above moves.
          const r2 = mulberry32(hash(i, j, SALT + 7));
          for (const f of fins) {
            const nL = Math.floor(r2() * (thick ? 1.6 : 3.4)), fs = Math.sin(f.az), fc = Math.cos(f.az);
            for (let q = 0; q < nL; q++) {
              const side = r2() < 0.5 ? -1 : 1, along = (r2() - 0.5) * f.len * 0.8, ll = Math.min(0.4 + f.len * 0.25 * r2(), 1.8);
              const hh = Math.min(f.H * (0.4 + 0.45 * r2()), ll * 1.2), th = 0.03 + 0.05 * r2(), tilt = 0.12 + 0.4 * r2();
              const lean = side > 0 ? f.lean + tilt : -tilt, v = 6 + (r2() < 0.5 ? 0 : 1), dims = this.dimsOf(d.cls, 'bould', v);
              const off = side * (f.T / 2 + 0.04 + (side > 0 ? f.H * Math.tan(f.lean) * 0.3 : 0));
              push(bould, 'bould', v, f.x + fs * along + fc * off, f.n + fc * along - fs * off, f.az + (r2() - 0.5) * 0.3, lean,
                ll, hh / (dims.hgt * ll), th / (dims.thk * ll), 300 + kl++, 0, r2);
            }
          }
        } else {
          for (let q = 0; q < nMain; q++) {
            let D, v, rad;
            if (form === 'dome') { v = q === 0 ? Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 3); D = q === 0 ? 4 + 6 * rnd() * (0.5 + 0.5 * t) : 1.5 + 2 * rnd(); rad = q === 0 ? 0 : 4 + 5 * rnd(); }
            else if (form === 'block') { v = Math.floor(rnd() * VARIANTS); D = 1.5 + 3 * rnd() * (0.6 + 0.4 * t); rad = 1 + 5 * rnd(); }
            else { v = Math.floor(rnd() * VARIANTS); D = 2 + 6 * Math.pow(rnd(), 1.3) * (0.6 + 0.4 * t); rad = 1 + 6 * rnd(); }
            const ang = rnd() * Math.PI * 2;
            const az = form === 'knob' ? strike + (rnd() - 0.5) * 1.4 : rnd() * Math.PI * 2;
            const f = push(out, 'out', v, cx + Math.cos(ang) * rad, cn + Math.sin(ang) * rad, az, (rnd() - 0.5) * 0.15, D, 0.85 + 0.3 * rnd(), 0.85 + 0.3 * rnd(), k++);
            if (f) parents.push(f);
          }
        }
      }
      // Boulders and float, in clusters: 1-3 centres per cell (the first on the outcrop), each a
      // tight Rayleigh scatter of a few metres, so most of the cell stays clear and a few spots are stony.
      let lam = L > 0.45 ? 4 + 6 * smooth(0.45, 0.9, L) : 12 * smooth(0.15, 0.45, L);
      if (fragOn) lam += (2 + 6 * Math.min((d.frag - 25) / 75, 1)) * (1 - 0.5 * d.tree);
      lam = Math.min(lam * (look.rubble || 1), look.rubble ? 30 : 20);
      const nB = Math.floor(lam + rnd()), nC = Math.max(1, Math.min(3, Math.round(nB / 6)));
      // rubble classes (serpentinite): blocks of 0.5-1.5 m with a heavier tail, not pebbles
      const maxS = look.rubble ? 1.5 : 2, s0 = look.rubble ? 0.5 : 0.4, al = look.rubble ? 1.2 : 1.7;
      const cs = [];
      for (let q = 0; q < nC; q++) cs.push(q === 0 && L > 0.45 ? [cx, cn, 4] : [(i + 0.15 + 0.7 * rnd()) * res, size - (j + 0.15 + 0.7 * rnd()) * res, 1.5 + 2 * rnd()]);
      for (let q = 0; q < nB; q++) {
        const c0 = cs[q % nC], r = c0[2] * Math.sqrt(-2 * Math.log(1 - rnd() * 0.995)), a = rnd() * Math.PI * 2;
        const x = c0[0] + Math.cos(a) * r, nn = c0[1] + Math.sin(a) * r;
        const u = rnd(), s = s0 * Math.pow(1 - u * (1 - Math.pow(s0 / maxS, al)), -1 / al);
        const v = Math.floor(rnd() * VARIANTS);
        const az = look.strike ? strike + (rnd() - 0.5) * 0.7 : rnd() * Math.PI * 2;
        const f = push(bould, 'bould', v, x, nn, az, (rnd() - 0.5) * 0.3, s, 0.8 + 0.4 * rnd(), 0.8 + 0.4 * rnd(), 100 + k++);
        if (f && s > 1) parents.push(f);
      }
      // Talus: a halo of smaller stones around the base of every mass and every boulder over 1 m,
      // smaller and sparser away from it, stretched down the slope; and groups of 5-20 small
      // stones (0.08-0.4 m) around the boulder clusters, never one alone. Own stream (SALT + 11).
      const r3 = mulberry32(hash(i, j, SALT + 11));
      const tone = () => {   // the class's weathered colour (between its base and its rind)
        const t = 0.8 + 0.3 * r3(), h = (r3() - 0.5) * 0.06, c = [0, 1, 2].map(a => (look.color[a] + look.mottle[a]) / 2 * t);
        return [srgb(c[0] * (1 + h)), srgb(c[1]), srgb(c[2] * (1 - h))];
      };
      let kh = 0;
      const stone = (x, nn, s, az) => {
        if (s >= 0.42) { const v = Math.floor(r3() * VARIANTS); push(bould, 'bould', v, x, nn, az, (r3() - 0.5) * 0.4, s, 0.8 + 0.4 * r3(), 0.8 + 0.4 * r3(), 500 + kh++, 0, r3); }
        else pebble(x, nn, s, 0, r3, tone());
      };
      for (const p of parents) {
        const big = Math.max(p.a * 2, p.b * 2), mass = big > 2.2;
        const n = Math.max(5, Math.min(Math.round((mass ? 8 + 3 * big : 5 + 4 * (big - 1)) * (0.7 + 0.6 * r3())), mass ? 30 : 14));
        const g = this.slopeAt(p.x, p.north), gl = Math.hypot(g[0], g[1]), pull = Math.min(1, gl * 2.5);
        const dh = gl > 1e-4 ? [-g[0] / gl, -g[1] / gl] : [0, 0];
        const ae = [Math.sin(p.az), Math.cos(p.az)], ac = [Math.cos(p.az), -Math.sin(p.az)];
        for (let q = 0; q < n; q++) {
          const th = r3() * Math.PI * 2, flip = r3() < 0.65 * pull;
          let ex = ae[0] * p.a * Math.cos(th) + ac[0] * p.b * Math.sin(th), en = ae[1] * p.a * Math.cos(th) + ac[1] * p.b * Math.sin(th);
          const el = Math.hypot(ex, en) || 1;
          if (flip && ex * dh[0] + en * dh[1] < 0) { ex = -ex; en = -en; }   // more on the downhill side
          const down = Math.max(0, (ex * dh[0] + en * dh[1]) / el);
          const dd = -Math.log(1 - r3() * 0.95) * (0.2 + 0.25 * Math.min(p.h, 2)) * (1 + 1.5 * pull * down);
          const sz = Math.min(0.9, 0.35 * big, Math.max(0.07, Math.min(big, 3) * (0.05 + 0.13 * r3()) * (1 - 0.5 * Math.min(dd / 2, 1))));
          stone(p.x + ex + ex / el * dd, p.north + en + en / el * dd, sz, r3() * Math.PI * 2);
        }
      }
      const nG = Math.min(6, Math.floor((fragOn ? 1 + 2 * Math.min((d.frag - 25) / 75, 1) : 0) + 3 * smooth(0.15, 0.9, L) + 0.5 * nC + r3()));
      for (let q = 0; q < nG; q++) {
        const c0 = r3() < 0.75 ? cs[q % nC] : [(i + r3()) * res, size - (j + r3()) * res, 3];
        const rr = (c0[2] + 1) * Math.sqrt(-2 * Math.log(1 - r3() * 0.99)), aa = r3() * Math.PI * 2;
        const gx = c0[0] + Math.cos(aa) * rr, gn = c0[1] + Math.sin(aa) * rr, n = 5 + Math.floor(r3() * 16), gr = 0.5 + 1.5 * r3();
        for (let k2 = 0; k2 < n; k2++) {
          const r = gr * Math.sqrt(r3()), a = r3() * Math.PI * 2;
          pebble(gx + Math.cos(a) * r, gn + Math.sin(a) * r, 0.08 + 0.32 * Math.pow(r3(), 2.2), 0, r3, tone());
        }
      }
    }
    const wet = mode === 'full' ? null : this.wetIn(i, j);
    if (wet) this.waterStones(i, j, d, wet, pebble);
    const result = mode === 'peb' ? (peb.length ? peb : null) : mode === 'count' ? { out, bould, peb }
      : out.length || bould.length ? { out, bould } : null;
    if (cache) cache.set(id, result);
    return result;
  }
  // Downhill gradient of the drawn terrain at (x, north): [dh/dEast, dh/dNorth].
  slopeAt(x, n) { return [(this.meshH(x + 1, n) - this.meshH(x - 1, n)) / 2, (this.meshH(x, n + 1) - this.meshH(x, n - 1)) / 2]; }
  // Instance matrix of a pebble: on the mesh triangle under it (sheared to its slope), a third of
  // its height buried.
  placeSmall(x, north, s, sy, sz, yaw, tilt, out) {
    const h = this.meshH(x, north), g = this.slopeAt(x, north), pd = pebbleDims();
    const q = this._q || (this._q = new THREE.Quaternion()), e = this._e || (this._e = new THREE.Euler());
    e.set(tilt, yaw, 0, 'YXZ'); q.setFromEuler(e);
    const M = this._m || (this._m = new THREE.Matrix4());
    M.compose(this._zero || (this._zero = new THREE.Vector3()), q, (this._s || (this._s = new THREE.Vector3())).set(s, s * sy, s * sz));
    const el = M.elements, gx = Math.max(-1.2, Math.min(1.2, g[0])), gz = -Math.max(-1.2, Math.min(1.2, g[1]));
    for (const o of [0, 4, 8]) el[o + 1] += gx * el[o] + gz * el[o + 2];
    el[12] = x; el[13] = h - 0.15 * pd.hgt * s * sy - 0.01; el[14] = -north;
    out.set(el); return out;
  }
  // Streams and pond shores near each cell (tile.features, the same widths water.js draws): stream
  // segments with water and dry-bed widths, arc length and bend; pond ring edges with their outward side.
  wetIn(i, j) {
    if (!this.wet) {
      const res = this.res, size = this.tile.size, W = this.W, map = this.wet = new Map(), wm = this.tile.waterMask, F = this.tile.features;
      const add = (x0, y0, x1, y1, ref, list) => {
        const i0 = Math.max(0, Math.floor(x0 / res)), i1 = Math.min(W - 1, Math.floor(x1 / res));
        const j0 = Math.max(0, Math.floor((size - y1) / res)), j1 = Math.min(W - 1, Math.floor((size - y0) / res));
        for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
          const key = jj * W + ii; let b = map.get(key); if (!b) map.set(key, b = { segs: [], edges: [] }); b[list].push(ref);
        }
      };
      const hasDem = (F?.streams || []).some(st => st.source && st.source !== 'nhd');
      for (const st of F?.streams || []) {
        const cls = st.fcode in STREAM_CLASS ? STREAM_CLASS[st.fcode] : 'intermittent', P = st.path;
        if (!cls || !P || P.length < 2 || (hasDem && st.source === 'nhd')) continue;
        if (st.in_waterbody && wm) { const m = P[P.length >> 1]; if (wm.inPond(m[0], m[1])) continue; }
        const order = Math.max(1, Math.min(WIDTH_BY_ORDER.length - 1, st.order || 1));
        const ww = st.width > 0 ? st.width : WIDTH_BY_ORDER[order] * WATER_WIDTH_SCALE[cls];
        const bw = st.bed_width > 0 ? st.bed_width : WIDTH_BY_ORDER[order] * 1.5 + 1.0;
        const ph = Math.abs(Math.sin(P[0][0] * 12.9898 + P[0][1] * 78.233) * 43758.5) % 100, ph2 = (ph * 7.31) % 100;
        const turnAt = n => {   // signed turn (radians, + left) at vertex n
          if (n <= 0 || n >= P.length - 1) return 0;
          const ax = P[n][0] - P[n - 1][0], ay = P[n][1] - P[n - 1][1], bx = P[n + 1][0] - P[n][0], by = P[n + 1][1] - P[n][1];
          return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
        };
        let s = 0;
        for (let n = 0; n < P.length - 1; n++) {
          const [ax, ay] = P[n], [bx, by] = P[n + 1], len = Math.hypot(bx - ax, by - ay); if (len < 1e-3) continue;
          const ref = { ax, ay, bx, by, len, s0: s, ww, bw, cls, ph, ph2, turn: (turnAt(n) + turnAt(n + 1)) / 2 };
          const mg = bw * 0.7 + 3;
          add(Math.min(ax, bx) - mg, Math.min(ay, by) - mg, Math.max(ax, bx) + mg, Math.max(ay, by) + mg, ref, 'segs');
          s += len;
        }
      }
      for (const w of F?.waterbodies || []) {   // not the reservoirs and stock ponds taken out (tilepackage markRewilded)
        const R = w.ring; if (!R || R.length < 3 || w.rewilded) continue;
        let A = 0; for (let n = 0; n < R.length; n++) { const p = R[n], q = R[(n + 1) % R.length]; A += p[0] * q[1] - q[0] * p[1]; }
        const outSide = A > 0 ? 1 : -1;   // counter-clockwise ring (north up): outside is to the right
        for (let n = 0; n < R.length; n++) {
          const [ax, ay] = R[n], [bx, by] = R[(n + 1) % R.length], len = Math.hypot(bx - ax, by - ay); if (len < 1e-3) continue;
          add(Math.min(ax, bx) - 4, Math.min(ay, by) - 4, Math.max(ax, bx) + 4, Math.max(ay, by) + 4, { ax, ay, bx, by, len, out: outSide }, 'edges');
        }
      }
    }
    return this.wet.get(j * this.W + i) || null;
  }
  // Water-worn cobble and gravel on the dry bed and banks of each stream through the cell, between
  // the water's edge (water.js's width, with its pools and riffles) and a metre past the bed, in
  // groups every few metres, a gravel bar more often on the inside of a bend; bigger cobbles on
  // bigger channels. Pond shores get a band of gravel just outside the ring. Own stream (SALT + 13).
  waterStones(i, j, d, wet, pebble) {
    const res = this.res, size = this.tile.size, r4 = mulberry32(hash(i, j, SALT + 13)), wm = this.tile.waterMask, roads = this.tile.roads;
    const x0 = i * res, x1 = x0 + res, n1 = size - j * res, n0 = n1 - res;
    const base = (d.cls && LOOK[d.cls] ? LOOK[d.cls] : LOOK.alluvium).color;
    const col = () => { const t = 0.85 + 0.3 * r4(), h = (r4() - 0.5) * 0.08, pale = 0.5 + 0.35 * r4(); return [0, 1, 2].map(c => srgb((base[c] + ([0.66, 0.64, 0.60][c] - base[c]) * pale) * t * (c === 0 ? 1 + h : c === 2 ? 1 - h : 1))); };
    const ok = (x, n, sz, self = null) => {
      if (x < x0 || x >= x1 || n < n0 || n >= n1) return false;
      if (roads && roads.at(x, n) > 140) return false;
      if (wm && wm.inPond(x, n)) return false;
      for (const q of wet.segs) {   // out of every other channel's water (at its widest pool)
        if (q === self) continue;
        const dx = q.bx - q.ax, dy = q.by - q.ay, t = Math.min(1, Math.max(0, ((x - q.ax) * dx + (n - q.ay) * dy) / (q.len * q.len)));
        const wh = q.ww / 2 * (1 + 0.28 + 0.16) + sz * 0.3; if ((q.ax + dx * t - x) ** 2 + (q.ay + dy * t - n) ** 2 < wh * wh && q.cls !== 'ephemeral') return false;
      }
      return true;
    };
    const DENS = { perennial: 1, intermittent: 0.85, ephemeral: 0.35 };
    for (const q of wet.segs) {
      const dx = (q.bx - q.ax) / q.len, dy = (q.by - q.ay) / q.len, nx = -dy, ny = dx, dens = DENS[q.cls] || 0.5;
      const cMax = Math.min(0.75, Math.max(0.2, 0.2 + 0.06 * q.ww)), gap = 1.5 / dens;
      // the part of the segment within reach of the cell
      const ccx = (x0 + x1) / 2, ccn = (n0 + n1) / 2, tc = (ccx - q.ax) * dx + (ccn - q.ay) * dy, reach = res * 0.75 + q.bw;
      const tA = Math.max(0, tc - reach), tB = Math.min(q.len, tc + reach);
      const inside = q.turn >= 0 ? 1 : -1, pIn = 0.5 + Math.min(0.4, Math.abs(q.turn) * 2);
      for (let t = tA + r4() * gap; t < tB; t += gap * (0.6 + 0.8 * r4())) {
        const s = q.s0 + t;
        const wHalf = q.cls === 'ephemeral' ? 0 : q.ww / 2 * Math.max(0.45, 1 + 0.28 * Math.sin(s / 23 + q.ph) + 0.16 * Math.sin(s / 8.7 + 1.7 * q.ph));
        const bHalf = q.bw / 2 * (1 + 0.22 * Math.sin(s / 37 + q.ph2) + 0.12 * Math.sin(s / 14.3 + 2.3 * q.ph2));
        const side = r4() < pIn ? inside : -inside, bar = r4() < 0.25 + 0.5 * Math.min(1, Math.abs(q.turn) * 3);
        const n = Math.max(5, Math.floor((bar ? 20 + 30 * r4() : 8 + 10 * r4()) * Math.max(0.6, dens)));
        const lo = wHalf + 0.1, hi = Math.max(bHalf + 1.5, lo + 1.5), oc = lo + (hi - lo) * (bar ? 0.2 + 0.3 * r4() : r4());
        for (let k = 0; k < n; k++) {
          const sz = 0.05 + (cMax - 0.05) * Math.pow(r4(), 1.4) * (bar ? 1 : 0.8);
          const o = Math.min(hi + 0.5, Math.max(lo + sz * 0.5, oc + (r4() - 0.5) * (bar ? Math.max(1.6, hi - lo) : 1.0))), at = t + (r4() - 0.5) * (bar ? 4 : 1.5);
          const x = q.ax + dx * at + nx * side * o, nn = q.ay + dy * at + ny * side * o;
          const c = col();
          if (ok(x, nn, sz, q)) pebble(x, nn, sz, 1, r4, c);
        }
      }
    }
    for (const e of wet.edges) {
      const dx = (e.bx - e.ax) / e.len, dy = (e.by - e.ay) / e.len, ox = dy * e.out, oy = -dx * e.out;   // outward normal
      for (let t = r4() * 2; t < e.len; t += 1.5 + 2 * r4()) {
        const n = 8 + Math.floor(r4() * 14), oc = 0.3 + 1.5 * r4();
        for (let k = 0; k < n; k++) {
          const sz = 0.06 + 0.34 * Math.pow(r4(), 1.6), o = Math.max(0.12 + sz * 0.5, oc + (r4() - 0.5) * 1.6), at = t + (r4() - 0.5) * 2.5;
          const x = e.ax + dx * at + ox * o, nn = e.ay + dy * at + oy * o, c = col();
          if (ok(x, nn, sz)) pebble(x, nn, sz, 1, r4, c);
        }
      }
    }
  }
  dimsOf(cls, kind, v) {
    const key = `${cls}|${kind}|${v}`; let g = this.geoms.get(key);
    if (!g) {
      const form = LOOK[cls].form, P = paramsOf(form, kind, v);
      g = { dims: normOf(form, kind, v, P).dims }; this.geoms.set(key, g);
    }
    return g.dims;
  }
  // The InstancedMesh for (role, class, variant), made on first use.
  mesh(role, key) {
    const mk = `${role}|${key}`; let m = this.meshes.get(mk);
    if (m) return m;
    this.mats ||= {};
    let geo, mat;
    if (role === 'peb') {   // one geometry, one material for every class's small stones
      geo = { geometry: pebbleGeometry() };
      geo.geometry.setAttribute('aRound', new THREE.InstancedBufferAttribute(new Float32Array(64), 1).setUsage(THREE.DynamicDrawUsage));
      mat = this.mats.peb ||= rockMaterial(PEB_LOOK, 'peb', this.atmosphere);
    } else {
      const [cls, vs] = key.split('|'), v = +vs, kind = ROLE[role].src;
      const gk = `${cls}|${kind}|${v}|${ROLE[role].detail}`;
      geo = this.geoms.get(gk);
      if (!geo) { geo = rockGeometry(cls, kind, v, ROLE[role].detail); this.geoms.set(gk, geo); }
      mat = this.mats[`${cls}|${role}`] ||= rockMaterial(LOOK[cls], role, this.atmosphere);
    }
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
    if (m.geometry.attributes.aRound) m.geometry.setAttribute('aRound', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
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
      const p = this.plan(i, j), pp = roles.includes('peb') ? this.plan(i, j, 'peb') : null;
      if (!p && !pp) continue;
      cells++;
      for (const role of roles) {
        const src = role === 'peb' ? pp || [] : p ? p[ROLE[role].src] : [];
        for (const r of src) {
          const dx = r.x - x, dz = r.z - z; if (dx * dx + dz * dz > R * R) continue;
          const reach = reachOf(role, r.s) + margin;
          if (!r.m) {   // a pebble not yet placed
            if (dx * dx + dz * dz > reach * reach) continue;
            r.m = this.placeSmall(r.x, -r.z, r.s, r.a[0], r.a[1], r.a[2], r.a[3], new Float32Array(16)); r.y = r.m[13];
          }
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
      const ar = m.geometry.attributes.aRound;
      if (ar) { for (let q = 0; q < n; q++) ar.array[q] = l.items[q].r; ar.needsUpdate = true; }
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
        const W = this.W, res = this.res, size = this.tile.size, keep2 = (NEAR_SET + 120) ** 2;   // pebble plans only near the camera
        for (const id of this.pebPlans.keys()) { const ex = (id % W + 0.5) * res - p.x, en = size - (Math.floor(id / W) + 0.5) * res + p.z; if (ex * ex + en * en > keep2) this.pebPlans.delete(id); }
        const r = this.fill(['close', 'near', 'bclose', 'bould', 'peb'], p.x, p.y, p.z, NEAR_SET, NEAR_SET - NEAR_R - NEAR_W);
        this.stats.nearCells = r.cells;
        for (const k of ['close', 'near', 'bclose', 'bould', 'peb']) this.stats[k] = this.countOf(k);
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
    const p = camera.position, out = { close: 0, near: 0, far: 0, bclose: 0, bould: 0, peb: 0, draws: 0 };
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
  // Whole-tile counts (no matrices): outcrop cells, masses, boulders, pebble-tier stones.
  census() {
    const W = this.W, out = { outcropCells: 0, boulderCells: 0, masses: 0, boulders: 0, pebbles: 0, pebbleCells: 0, byClass: {} };
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const p = this.plan(i, j, 'count'); if (!p.out.length && !p.bould.length && !p.peb.length) continue;
      const cls = this.cellData(i, j).cls, b = out.byClass[cls] ||= { cells: 0, masses: 0, boulders: 0 };
      if (p.out.length) out.outcropCells++; if (p.bould.length) out.boulderCells++;
      out.masses += p.out.length; out.boulders += p.bould.length; b.cells++; b.masses += p.out.length; b.boulders += p.bould.length;
      out.pebbles += p.peb.length; if (p.peb.length) out.pebbleCells++; b.pebbles = (b.pebbles || 0) + p.peb.length;
    }
    return out;
  }
}
