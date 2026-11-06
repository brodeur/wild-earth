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
//   cellStature(...)    the cell's stature: where the tile has a measured canopy height (client/canopy_top.png,
//                       pipeline/canopy_top.py: the mean p95 height of the cell's treed 10 m sub-cells, from the Meta /
//                       WRI canopy height map or the lidar CHM) measured stature wins over the site factor (2026-11-06):
//                       one factor f per cell, solved so that the stand the cell's tree mix draws has that top
//                       (standTop: the mix's crowns by crown area), and each species scaled by speciesScale(f): a species whose card height is not sourced (the
//                       template's) takes f; one whose card is sourced keeps its own curve while f is inside its
//                       sourced range (height_m low to tall over typical: the measurement is consistent with it) and
//                       is moved only by the part of f outside it. Every species moves the same way, so the subcanopy
//                       stays under the canopy and the cell's emergent over it. Without a measurement: the site factor.
//
// vegetation.js (the near and mid sets) and impostors.js (the far records) call drawTree with the same cell, plant
// index and draws, so a tree is the same height on both sides of the hand-over: the near tree is the slot's tree
// scaled to h, the far record carries -h and mapRecords scales the baked tree that stands in to it.

import { LIBRARY, LIBRARY_RAW, SLOTS, variantSlots, resolveSpecies } from './treegen.js';
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
  const sourced = heightSourced(id), lo = Math.min(1, spec.height_m[0] / typical), hi = Math.max(1, tall / typical);
  const wr = spec.targets?.crown_width_ratio ?? LIBRARY_RAW[id]?.targets?.crown_width_ratio ?? 0.6;
  s = { id, typical, tall, record, given, sigma: Math.log(tall / typical) / Z95, classes: live, living: live.filter(c => !c.old), oldCls: live.find(c => c.old) || null, canopy,
    sourced, band: [lo, hi], recordGiven: !!spec.stature?.record_m, wr };
  cache.set(id, s); return s;
}

// Whether a record's height is sourced: not when its notes list the height among the values NOT SOURCED (the
// template's, pipeline/tree_cards.py) or its stature block names no source before '(research record)'.
export function heightSourced(id) {
  const r = LIBRARY_RAW[id] || LIBRARY[id] || {}, st = r.stature || LIBRARY[id]?.stature;
  if (/NOT SOURCED[^]*?height \(the template's\)/.test(r.notes || '')) return false;
  if (st && /^\s*\(research record\)\s*$/.test(st.source || '')) return false;
  return true;
}

// A species' scale for the cell factor f: f itself for a template height; for a sourced one, 1 while f is inside its
// sourced band and the part of f outside it beyond (continuous, never reversing the order of two species' moves).
export function speciesScale(st, f) {
  if (!st.sourced) return f;
  const [lo, hi] = st.band;
  return f < lo ? f / lo : f > hi ? f / hi : 1;
}

// The top a cell's tree mix draws at cell factor f: the mean height of its canopy species' crowns weighted by their
// share and drawn crown area (crown_width_ratio x height x OUT.w, squared: the canopy surface the map sees is the big
// crowns'), each species' curve log-normal (so its crown-area-weighted mean is typical x exp(2.5 sigma^2), its mean
// area typical^2 x exp(2 sigma^2): the tall tail of a wide curve shows from above, a savanna's acacias most), times
// TOP_K: the measurement's statistic (the p95 of each treed 10 m sub-cell) is the tallest crown over it. TOP_K from
// the drawn canopies (the statistic on a 2 m surface of the mid set's crowns) of Manu, Danum, Corcovado, the
// Serengeti and Lofoten, 2026-11-06.
const TOP_K = 1.4, F_RANGE = [0.3, 3];
function standTop(list, f) {
  let num = 0, den = 0;
  for (const [st, w] of list) {
    const s = speciesScale(st, f), v = st.sigma * st.sigma, h = st.typical * s;
    const a = w * (st.wr * h * (s < 1 ? Math.min(WIDE_MAX, 1 / s) : 1)) ** 2 * Math.exp(2 * v);   // the drawn crown's width (OUT.w)
    num += a * h * Math.exp(2.5 * v); den += a;
  }
  return den > 0 ? TOP_K * num / den : 0;
}
const mixStands = new WeakMap();   // tree mix -> { list: [[stature, weight]], f: Map(top step -> f) }
function cellFactor(mix, top) {
  let ms = mixStands.get(mix);
  if (!ms) {
    const list = [];
    for (const [name, w] of Object.entries(mix)) { const st = stature(resolveSpecies(name) || name); if (st && w > 0) list.push([st, w]); }
    ms = { list, has: new Set(list.map(e => e[0])), f: new Map() }; mixStands.set(mix, ms);
  }
  if (!ms.list.length) return null;
  const key = Math.round(top * 2); let f = ms.f.get(key);
  if (f !== undefined) return f;
  // standTop is continuous and non-decreasing in f: bisect on log f
  let a = Math.log(F_RANGE[0]), b = Math.log(F_RANGE[1]);
  if (standTop(ms.list, Math.exp(a)) >= top) f = Math.exp(a);
  else if (standTop(ms.list, Math.exp(b)) <= top) f = Math.exp(b);
  else {
    for (let k = 0; k < 40; k++) { const c = (a + b) / 2; if (standTop(ms.list, Math.exp(c)) < top) a = c; else b = c; }
    f = Math.exp((a + b) / 2);
  }
  ms.f.set(key, f); return f;
}
// A species the cell draws outside its mix (a bank's or a terrace's zone species, a riparian extra: vegetation.js
// zoneSpecies) is its own stand under the measurement: the factor of a mix of it alone.
const alone = new Map();
function ownFactor(st, top) {
  let mix = alone.get(st.id); if (!mix) { mix = { [st.id]: 1 }; alone.set(st.id, mix); }
  return cellFactor(mix, top);
}

// The cell's stature for drawTree: { m: the site factor, f: the measured cell factor or 0, top: the measured top (m),
// mix: the tree mix f was solved for }. The same object is refilled for every cell (no allocation); read it before
// the next call.
const CS = { m: 1, f: 0, top: 0, mix: null };
export function cellStature(tile, i, j, treeMix) {
  const g = tile.canopyTop;
  CS.f = 0;
  if (g && treeMix && g.img.width === tile.habitat.img.width) {
    const top = g.channel(i, j, 0) * 0.5;
    if (top > 0) { const f = cellFactor(treeMix, top); if (f) { CS.f = f; CS.m = 1; CS.top = top; CS.mix = treeMix; return CS; } }
  }
  CS.m = siteFactor(tile, i, j);
  return CS;
}

export function siteFactor(tile, i, j) {
  const res = tile.habitat.res, H = tile.heights, x = (i + 0.5) * res, n = tile.size - (j + 0.5) * res, d = res * 0.5;
  const g = Math.hypot(H.at(x + d, n) - H.at(x - d, n), H.at(x, n + d) - H.at(x, n - d)) / (2 * d);
  const cover = tile.canopy.channel(i, j, 0) / 100;
  const dense = Math.min(1, Math.max(0, (cover - 0.6) / 0.35)), flat = 1 - Math.min(1, g / 0.35);
  return (1 - 0.12 * dense) * (1 + 0.1 * flat);
}

// A shrub's slot drawn at its own record's size (2026-11-06: Lofoten's common juniper, card 0.2-0.7 m, drew one plant
// in twelve as its Sierra juniper template's 15.5 m snag, unscaled by plantgen's height_scale). A slot whose tree is
// outside FIT x its class's height range (a snag: the record's whole range, every class's low to high) is drawn as
// one that fits, by the slot index (deterministic, the same on the near and far sides); a shrub with no fitting slot
// keeps its own. hOf(v): the height of slot v's tree as the caller builds it (the near mesh, the far baked tree).
const FIT = [0.5, 2];
const shrubFits = new Map();
export function shrubSlot(id, v, hOf) {
  let ok = shrubFits.get(id);
  if (ok === undefined) {
    const spec = LIBRARY[id]; ok = null;
    if (spec?.shrub) {
      const slots = variantSlots(id, SLOTS), cls = spec.classes || [];
      const all = [Math.min(spec.height_m[0], ...cls.map(c => c.spec.height_m[0])), Math.max(spec.height_m[1], ...cls.map(c => c.spec.height_m[1]))];
      const fits = slots.map((sl, q) => {
        const c = cls.find(k => k.name === sl.cls), [lo, hi] = sl.snag || !c ? all : c.spec.height_m, h = hOf(q);
        return h >= lo * FIT[0] && h <= hi * FIT[1];
      });
      if (fits.some(f => !f) && fits.some(f => f)) ok = { fits, list: fits.map((f, q) => f ? q : -1).filter(q => q >= 0) };
    }
    shrubFits.set(id, ok);
  }
  return !ok || ok.fits[v] ? v : ok.list[v % ok.list.length];
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

// A tree the measurement draws lower keeps its crown's width (the species' own, at its own height): its horizontal
// scale over its vertical, OUT.w, is 1 / speciesScale up to WIDE_MAX. The crown cover the cell's trees drew stays (a
// shorter canopy is not a sparser one: Manu at the map's 20 m kept 89 % cover this way, 41 % scaled whole), the palms'
// fronds stay their length, and the stand's upper crowns spread as a low canopy's do.
const WIDE_MAX = 2.5;
const OUT = { v: 0, h: 0, w: 1, old: false, emergent: false };
// st: stature(id); (i, j, k) the cell and plant; u the plant's own scale draw in [0, 1); cs the cell's stature
// (cellStature; a number is taken as the site factor); emergent whether this plant is the cell's emergent. Returns
// OUT: v the slot to draw, h the height in metres, w the crown's width over its height scale. A measured cell scales the species' curve by speciesScale (its
// record too where the record is the default's, not a sourced record_m, and the curve is raised); the age class is
// chosen at the unscaled height, so a tree the measurement draws lower is the same grown tree, not a young one.
export function drawTree(st, i, j, k, u, cs, emergent) {
  let m = typeof cs === 'number' ? cs : cs.m, rec = st.record, s = 1;
  if (typeof cs !== 'number' && cs.f) {
    const f = mixStands.get(cs.mix).has.has(st) ? cs.f : (ownFactor(st, cs.top) || cs.f);
    s = speciesScale(st, f); m = s; if (s > 1 && !st.recordGiven) rec *= s;
  }
  let h, q = u;
  if (emergent) {   // tall x 1 to 1.35 (skewed low), the span fitted under the record
    const w = h32(i, j, 0x5eb), lo = Math.min(st.tall * m, rec * 0.97), hi = Math.min(st.tall * m * (1 + EMERGENT_SPAN), rec);
    h = lo + (hi - lo) * w * Math.sqrt(w); q = 1;
  } else {   // the curve truncated at the record: the draw rescaled under the record's quantile, so nothing piles up there
    const top = Math.min(1 - U_MIN, normalCdf(Math.log(rec / (st.typical * m)) / st.sigma));
    const p = U_MIN + Math.min(1, Math.max(0, u)) * (top - U_MIN);
    h = st.typical * m * Math.exp(st.sigma * probit(p));
  }
  const c = (q >= OLD_Q && st.oldCls) ? st.oldCls : classFor(st.living.length ? st.living : st.classes, h / s);
  OUT.v = c.slots[Math.min(c.slots.length - 1, Math.floor(h32(i + k * 7919, j, 0x51a7) * c.slots.length))];
  OUT.h = h; OUT.w = s < 1 ? Math.min(WIDE_MAX, 1 / s) : 1; OUT.old = c.old; OUT.emergent = !!emergent;
  return OUT;
}
