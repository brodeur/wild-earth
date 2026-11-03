// Tree heights on a long-tailed curve (2026-11-02, Aaron: "some trees live significantly longer and get significantly
// bigger on a bell curve, so the horizon should be more irregular"). On tiles without a lidar crown list a canopy
// tree's height is drawn from its species' size distribution instead of a uniform 0.75-1.25 scale on its class's
// range, and its age class follows the drawn height, so the rare giant is drawn with the veteran's limbs.
//
//   stature(id)         the species' curve: typical (median), tall (95th percentile) and record heights in metres from
//                       the record's `stature` block (docs/species-library.md), else by form from height_m; the
//                       log-normal's sigma fitted to typical and tall; the age classes with their slots; which slots
//                       take the curve (`canopy`: the base and old classes; young classes and snags keep their own
//                       class range and the uniform scale).
//   siteFactor(...)     the stand and the site lower or raise the whole curve: x0.88 in a closed young stand (tree
//                       cover over 60 %, to 95 %), x1.1 on a flat floor (slope under 0.35, falling to 1 at 0.35).
//   emergentOf(...)     the 30 m cell's emergent, if it has one: a cell holds one with odds n / 250 (n its trees), the
//                       tree by hash. Deterministic per cell, so nothing re-rolls.
//   drawTree(...)       the tree's height and slot: the curve's quantile at the placement's own scale draw u
//                       (truncated at the record: u is spread under the record's quantile), or for the cell's emergent
//                       tall x (1 to 1.35), skewed low, under the record; the class
//                       whose range holds the height, the old class for the top OLD_Q of the curve and every emergent;
//                       a slot of that class by hash. Fills and returns one shared object (no allocation per tree).
//
// vegetation.js (the near and mid sets) and impostors.js (the far records) call drawTree with the same cell, plant
// index and draws, so a tree is the same height on both sides of the hand-over: the near tree is the slot's tree
// scaled to h, the far record carries -h and mapRecords scales the baked tree that stands in to it.

import { LIBRARY, SLOTS, variantSlots } from './treegen.js';
import { oldClassOf } from './crowns.js';

const OLD_Q = 0.92;          // the top 8 % of a species' curve is drawn as its old class (the lidar tiles' rule is 5 % by size)
const EMERGENT_PER = 250;    // a cell holds an emergent with odds (its trees) / 250: about one tree in 360 with the young and snags
const EMERGENT_SPAN = 0.35;  // an emergent stands at tall x (1 to 1.35), capped at the record
const U_MIN = 0.0015;        // the curve's draw is clamped to [U_MIN, 1 - U_MIN] (2.97 sigma either side)
const Z95 = 1.6449;

function h32(i, j, salt) {   // the same integer hash as vegetation.js hash(), kept here so this module imports nothing of it
  let h = (i * 73856093) ^ (j * 19349663) ^ (salt * 83492791); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// The normal distribution's quantile (Acklam's rational approximation, relative error under 1.2e-9).
const A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
export function probit(p) {
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1); }
  if (p > 1 - 0.02425) return -probit(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
}

// The normal distribution's cumulative probability (Abramowitz and Stegun 7.1.26 on erfc, error under 1.5e-7).
export function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
  return x >= 0 ? 1 - 0.5 * erfc : 0.5 * erfc;
}

// Defaults by form where a record has no `stature` block: typical the middle of height_m, tall its top x 1.15, record x 1.6.
export function statureNumbers(spec) {
  const hm = spec.height_m, st = spec.stature || {};
  const typical = st.typical_m ?? (hm[0] + hm[1]) / 2;
  const tall = Math.max(typical * 1.05, st.tall_m ?? hm[1] * 1.15);
  const record = Math.max(tall * 1.05, st.record_m ?? hm[1] * 1.6);
  return { typical, tall, record, given: !!spec.stature };
}

const cache = new Map();
export function stature(id) {
  let s = cache.get(id); if (s !== undefined) return s;
  const spec = LIBRARY[id];
  if (!spec || spec.shrub || spec.groundForm) { cache.set(id, null); return null; }
  const { typical, tall, record, given } = statureNumbers(spec);
  const slots = variantSlots(id, SLOTS), old = oldClassOf(id);
  const classes = (spec.classes || [{ name: null, base: true, spec }]).map(c => ({ name: c.name, lo: c.spec.height_m[0], hi: c.spec.height_m[1], base: !!c.base, old: c.name === old, slots: [] }));
  const canopy = new Uint8Array(slots.length);
  slots.forEach((sl, v) => {
    if (sl.snag) return;
    const c = classes.find(q => q.name === sl.cls) || classes[0];
    c.slots.push(v); if (c.base || c.old || !spec.classes) canopy[v] = 1;
  });
  const live = classes.filter(c => c.slots.length);
  s = { id, typical, tall, record, given, sigma: Math.log(tall / typical) / Z95, classes: live, living: live.filter(c => !c.old), oldCls: live.find(c => c.old) || null, canopy };
  cache.set(id, s); return s;
}

export function siteFactor(tile, i, j) {
  const res = tile.habitat.res, H = tile.heights, x = (i + 0.5) * res, n = tile.size - (j + 0.5) * res, d = res * 0.5;
  const g = Math.hypot(H.at(x + d, n) - H.at(x - d, n), H.at(x, n + d) - H.at(x, n - d)) / (2 * d);
  const cover = tile.canopy.channel(i, j, 0) / 100;
  const dense = Math.min(1, Math.max(0, (cover - 0.6) / 0.35)), flat = 1 - Math.min(1, g / 0.35);
  return (1 - 0.12 * dense) * (1 + 0.1 * flat);
}

// The cell's emergent among its n trees (indices 0..n-1 in the caller's tree order), or -1.
export function emergentOf(i, j, n) {
  if (n <= 0 || h32(i, j, 0x5e7) >= n / EMERGENT_PER) return -1;
  return Math.min(n - 1, Math.floor(h32(i, j, 0x5e9) * n));
}

// The class whose range holds h, nearest its middle (the base class preferred a little), else the nearest range;
// crowns.js chooseClass's score.
function classFor(list, h) {
  let best = list[0], bs = Infinity;
  for (const c of list) {
    const out = Math.max(c.lo - h, h - c.hi, 0);
    const sc = out > 0 ? 10 + out / c.hi : Math.abs(h - (c.lo + c.hi) / 2) / Math.max(c.hi - c.lo, 0.5) - (c.base ? 0.1 : 0);
    if (sc < bs) { bs = sc; best = c; }
  }
  return best;
}

const OUT = { v: 0, h: 0, old: false, emergent: false };
// st: stature(id); (i, j, k) the cell and plant; u the plant's own scale draw in [0, 1); m the site factor; emergent
// whether this plant is the cell's emergent. Returns OUT: v the slot to draw, h the height in metres.
export function drawTree(st, i, j, k, u, m, emergent) {
  let h, q = u;
  if (emergent) {   // tall x 1 to 1.35 (skewed low), the span fitted under the record
    const w = h32(i, j, 0x5eb), lo = Math.min(st.tall * m, st.record * 0.97), hi = Math.min(st.tall * m * (1 + EMERGENT_SPAN), st.record);
    h = lo + (hi - lo) * w * Math.sqrt(w); q = 1;
  } else {   // the curve truncated at the record: the draw rescaled under the record's quantile, so nothing piles up there
    const top = Math.min(1 - U_MIN, normalCdf(Math.log(st.record / (st.typical * m)) / st.sigma));
    const p = U_MIN + Math.min(1, Math.max(0, u)) * (top - U_MIN);
    h = st.typical * m * Math.exp(st.sigma * probit(p));
  }
  const c = (q >= OLD_Q && st.oldCls) ? st.oldCls : classFor(st.living.length ? st.living : st.classes, h);
  OUT.v = c.slots[Math.min(c.slots.length - 1, Math.floor(h32(i + k * 7919, j, 0x51a7) * c.slots.length))];
  OUT.h = h; OUT.old = c.old; OUT.emergent = !!emergent;
  return OUT;
}
