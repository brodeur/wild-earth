// Lidar tree crowns (client/trees_lidar.bin, layer client.trees_lidar; docs/tile-spec.md, "Lidar"): where a
// tile has them, every tree stands on a real crown instead of cellPlan's random count per 30 m cell.
//
//   loadCrowns(tile)   fetch and decode the crown list (once per tile): positions, heights, radii, confidence,
//                      multi-return share and the 100 m cell index (crowns of index cell ci, cj are records
//                      offsets[cj * cells + ci] .. offsets[cj * cells + ci + 1], tallest first).
//   planCrowns(...)    the tree each crown becomes: species, variant slot, target height and crown width,
//                      rotation, age (old, landmark) and snags. Deterministic per crown (hashes of its index),
//                      so the near forest (vegetation.js) and the far impostors (impostors.js) agree.
//
// Species: the crown's 30 m cell's tree mix (vegetation.js cellTreeMix: the LANDFIRE row's weights, else the
// habitat class mix; water and barren cells borrow the nearest mix within two cells), drawn by weight times fit:
// 1 up to the top of the species' tallest class range (blue oak 14 m, live oak 16, gray pine 24, ponderosa 40),
// falling to 0.1 at REACH (1.4) times that and 0 beyond. A crown no species in the row reaches takes the row's
// tallest-capable species (gray pine over oak woodland, ponderosa in its stands). Variant: the age class whose
// height range best holds the crown height (old classes only by the age rule; classes topping out under 4.5 m,
// blue oak saplings, never: the list has no crown under 4 m), a seed of that class by hash; the drawn tree is
// scaled so its height is the crown height (clamped to SCALE) and widened or narrowed so its crown radius roughly
// matches the crown's (aspect clamped to ASPECT, so the wood stays a plausible shape and readers that take the
// instance's x scale as its size stay close).
// Age: a crown is old (the species' veteran / old-growth / old class, with the gnarl and deadwood those carry)
// when its size (height plus crown radius) is in the top OLD_Q (5%) of its species within its OLD_BLOCK (500 m)
// block (the block's cut held within 0.8 and 1.15 of the species' tile-wide cut, and the crown at least the
// mature class's lower height), or when it is taller than the species' absolute threshold (OLD_ABS: blue oak
// 15 m, valley oak 25 m, ponderosa 40 m, gray pine 25 m; else the top of its old class's range). The LANDMARKS
// (20) largest crowns of each species on the tile are old too and carry a stable id, `<short name>:<30 m cell
// i>,<j>:<rank>`, for later work to name them.
// Snags: a living-size crown that is not old becomes the species' snag with the file's snag fraction (by hash).
// Crowns are real trees: none is thinned for rocks, roads or the built footprint; one whose position falls in
// a pond or stream channel moves to the nearest dry point under its own crown.

import { LIBRARY, SLOTS, variantSlots, resolveSpecies, treeWood } from './treegen.js';
import { drain } from './slice.js';

export const CROWN_LAYER = 'client.trees_lidar';
export const hasCrowns = tile => !!tile?.manifest?.layers?.[CROWN_LAYER];

const REACH = 1.4;                // a species can stand on a crown up to 1.4 x the top of its tallest class's height range
export const SCALE = [0.4, 1.7];  // the drawn tree's height scale, clamped
export const ASPECT = [0.8, 1.25]; // crown width over height scale, clamped
const OLD_Q = 0.95, OLD_BLOCK = 500, OLD_MIN = 12, LANDMARKS = 20;
const OLD_ABS = { quercus_douglasii: 15, quercus_lobata: 25, pinus_ponderosa: 40, pinus_sabiniana: 25 };   // else the old class's range top
const OLD_NAME = /veteran|old|decadent/i;

// Integer hash of crown q and a salt, uniform in [0, 1).
export function u01(q, salt) {
  let h = Math.imul(q ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// The u32 id a crown's tree carries in Vegetation's ids (the cell trees' ids are hashes; a crown's keeps its index).
export const crownId = q => (0x80000000 | q) >>> 0;
export const crownOf = id => (id & 0x80000000) ? id & 0x7fffffff : -1;

const loads = new WeakMap();
export function loadCrowns(tile) {
  if (!hasCrowns(tile)) return Promise.resolve(null);
  let p = loads.get(tile);
  if (!p) {
    const path = tile.manifest.layers[CROWN_LAYER].path;
    p = fetch(tile.dir + path, { signal: tile.signal }).then(r => { if (!r.ok) throw new Error(`${r.status} fetching ${path}`); return r.arrayBuffer(); }).then(decodeCrowns);
    loads.set(tile, p);
  }
  return p;
}

export function decodeCrowns(buf) {
  const dv = new DataView(buf), magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (magic !== 'WECR' || dv.getUint16(4, true) !== 1 || dv.getUint16(6, true) !== 8) throw new Error(`trees_lidar.bin: not a version 1 crown list (${magic})`);
  const cells = dv.getUint16(8, true), cellM = dv.getUint16(10, true), count = dv.getUint32(12, true);
  const xyU = dv.getFloat32(16, true), hU = dv.getFloat32(20, true), rU = dv.getFloat32(24, true);
  const offsets = new Uint32Array(buf, 32, cells * cells + 1).slice(), base = 32 + 4 * (cells * cells + 1);
  const x = new Float32Array(count), n = new Float32Array(count), h = new Float32Array(count), r = new Float32Array(count);
  const conf = new Uint8Array(count), multi = new Uint8Array(count), b = new Uint8Array(buf, base, count * 8);
  for (let q = 0, o = 0; q < count; q++, o += 8) {
    x[q] = (b[o] | b[o + 1] << 8) * xyU + 0.1; n[q] = (b[o + 2] | b[o + 3] << 8) * xyU + 0.1;
    h[q] = b[o + 4] * hU; r[q] = b[o + 5] * rU; conf[q] = b[o + 6]; multi[q] = b[o + 7];
  }
  return { count, cells, cellM, offsets, x, n, h, r, conf, multi };
}

// Age classes of a species, from its file (treegen normalizeSpecies): [{ name, lo, hi, base, old, slots: [v] }],
// the snag's slots, and the heights the age rule uses.
const infos = new Map();
export function oldClassOf(id) {
  const spec = LIBRARY[id], cl = spec?.classes; if (!cl) return null;
  const bi = cl.findIndex(c => c.base), last = cl[cl.length - 1];
  return cl.length > 1 && cl.length - 1 > bi && OLD_NAME.test(last.name) ? last.name : null;
}
function speciesInfo(id, dims) {
  let s = infos.get(id); if (s) return s;
  const spec = LIBRARY[id], slots = variantSlots(id, SLOTS), old = oldClassOf(id);
  const classes = (spec.classes || [{ name: null, base: true, spec }]).map(c => ({ name: c.name, lo: c.spec.height_m[0], hi: c.spec.height_m[1], base: !!c.base, old: c.name === old, slots: [] }));
  const snag = [];
  slots.forEach((sl, v) => { if (sl.snag) snag.push(v); else (classes.find(c => c.name === sl.cls) || classes[0]).slots.push(v); });
  // top: the highest class range's top (the typical veteran); a crown above it fits less and less, to none at REACH x.
  const top = Math.max(...classes.map(c => c.hi)), oldCls = classes.find(c => c.old);
  const base = classes.find(c => c.base) || classes[0];
  s = { id, classes: classes.filter(c => c.slots.length), snag, snagFrac: spec.snag?.weight || 0, top,
    oldAbs: OLD_ABS[id] ?? (oldCls ? oldCls.hi : spec.height_m[1] * 1.1), matureLo: base.lo, short: spec.aliases?.[0] || id };
  infos.set(id, s); return s;
}

// The species a crown of height h becomes in a cell whose mix is `cands` ([{ id, w, info }]), r in [0, 1): by
// weight times fit (1 up to the species' top, falling to 0.1 at REACH x top, 0 beyond), else the row's tallest.
const fit = (info, h) => h <= info.top ? 1 : h >= info.top * REACH ? 0 : 1 - 0.9 * (h - info.top) / (info.top * (REACH - 1));
function chooseSpecies(cands, h, r) {
  let tot = 0;
  for (const c of cands) tot += c.w * fit(c.info, h);
  if (tot > 0) {
    let acc = 0, t = r * tot, last = null;
    for (const c of cands) { const w = c.w * fit(c.info, h); if (!w) continue; acc += w; last = c; if (t < acc) return c; }
    return last;
  }
  let best = cands[0];
  for (const c of cands) if (c.info.top > best.info.top) best = c;
  return best;
}
// The living, not-old class a crown of height h falls in: the one whose range holds h with h nearest its
// middle, else the nearest range. Classes topping out at MIN_CROWN m or less (blue oak saplings) are never a
// crown's: the list holds no crown under 4 m.
const MIN_CROWN = 4.5;
function chooseClass(info, h) {
  let best = null, bs = Infinity;
  for (const c of info.classes) {
    if (c.old && info.classes.length > 1) continue;
    if (c.hi <= MIN_CROWN && info.classes.some(o => o.hi > MIN_CROWN && !o.old)) continue;
    const out = Math.max(c.lo - h, h - c.hi, 0);
    const s = out > 0 ? 10 + out / c.hi : Math.abs(h - (c.lo + c.hi) / 2) / Math.max(c.hi - c.lo, 0.5) - (c.base ? 0.1 : 0);
    if (s < bs) { bs = s; best = c; }
  }
  return best;
}

// The plan: per crown the species (index into speciesIds), slot (0..SLOTS-1), position (moved off water),
// target height and radius, rotation, aspect (crown width over the height scale of the drawn tree) and flags
// (1 old, 2 landmark, 4 snag); landmarks [{ id, species, q, x, n, h, r, rank }]; per-species stats.
// opts: treeMix(i, j) -> { name: weight } or null; dims(id, v) -> { H, R } of the tree slot v draws (Vegetation
// registers its meshes'; without them the slot's own seed's height from treegen, radius 0.35 H).
// planCrownsSteps is the same plan as a generator that yields every YIELD_EVERY crowns (slice.js runSliced steps it
// while the opening screen is up); planCrowns runs it in one go.
const YIELD_EVERY = 4096;
export function planCrowns(tile, raw, opts) { return drain(planCrownsSteps(tile, raw, opts)); }
export function* planCrownsSteps(tile, raw, { treeMix, dims: given, speciesIds }) {
  const t0 = performance.now();
  const dims = (id, v) => given?.(id, v) || fallbackDims(id, v);
  const N = raw.count, hab = tile.habitat, res = hab.res, size = tile.size, W = hab.img.width, Hh = hab.img.height;
  const libIdx = new Map(speciesIds.map((id, k) => [id, k]));
  const sp = new Uint8Array(N), slot = new Uint8Array(N), flags = new Uint8Array(N);
  const x = raw.x, n = raw.n, h = raw.h, r = raw.r, rot = new Float32Array(N), aspect = new Float32Array(N);
  // Candidates per mix object (rows repeat over many cells).
  const candsOf = new Map(), fallback = treeMix.fallback;
  const cands = mix => {
    let c = candsOf.get(mix); if (c) return c;
    c = Object.entries(mix).map(([k, w]) => ({ id: resolveSpecies(k), w })).filter(e => e.id && e.w > 0 && !LIBRARY[e.id].shrub)
      .map(e => ({ ...e, info: speciesInfo(e.id, dims) }));
    candsOf.set(mix, c); return c;
  };
  const wm = tile.waterMask;
  let moved = 0, wet = 0, borrowed = 0;
  // 1. Species (and a dry footing).
  for (let q = 0; q < N; q++) {
    if ((q & (YIELD_EVERY - 1)) === 0) yield;
    const i = Math.min(W - 1, Math.max(0, Math.floor(x[q] / res))), j = Math.min(Hh - 1, Math.max(0, Math.floor((size - n[q]) / res)));
    let mix = treeMix(i, j), c = mix && cands(mix);
    if (!c || !c.length) {   // water, barren, or a row without trees: the nearest cell with a tree mix within 2 cells
      borrowed++; c = null;
      for (let d = 1; d <= 2 && !c; d++) for (let jj = j - d; jj <= j + d && !c; jj++) for (let ii = i - d; ii <= i + d && !c; ii++) {
        if (ii < 0 || jj < 0 || ii >= W || jj >= Hh) continue;
        const m = treeMix(ii, jj), cc = m && cands(m); if (cc && cc.length) c = cc;
      }
      if (!c) c = cands(fallback);
    }
    const e = chooseSpecies(c, h[q], u01(q, 1));
    sp[q] = libIdx.get(e.id); rot[q] = u01(q, 2) * Math.PI * 2;
    if (wm && wm.inWater(x[q], n[q])) {
      wet++;
      let done = false;
      for (const f of [0.35, 0.7, 1, 1.4]) {
        for (let a = 0; a < 12 && !done; a++) {
          const ang = (a + u01(q, 3)) * Math.PI / 6, d = f * Math.max(r[q], 1.5) + 0.5;
          const px = x[q] + Math.cos(ang) * d, pn = n[q] + Math.sin(ang) * d;
          if (px > 0 && pn > 0 && px < size && pn < size && !wm.inWater(px, pn)) { x[q] = px; n[q] = pn; done = true; moved++; }
        }
        if (done) break;
      }
    }
  }
  // 2. Size per crown; the OLD_Q quantile of size per species and block, and per species over the tile.
  const NB = Math.ceil(size / OLD_BLOCK), NS = speciesIds.length, sz = new Float32Array(N), key = new Int32Array(N);
  const cnt = new Int32Array(NS * NB * NB + 1);
  yield;
  for (let q = 0; q < N; q++) {
    if ((q & (YIELD_EVERY - 1)) === 0) yield;
    sz[q] = h[q] + r[q];
    const bi = Math.min(NB - 1, Math.floor(x[q] / OLD_BLOCK)), bj = Math.min(NB - 1, Math.floor(n[q] / OLD_BLOCK));
    key[q] = sp[q] * NB * NB + bj * NB + bi; cnt[key[q] + 1]++;
  }
  for (let k = 0; k < NS * NB * NB; k++) cnt[k + 1] += cnt[k];
  const sorted = new Float32Array(N), fill = cnt.slice(0, -1);
  for (let q = 0; q < N; q++) sorted[fill[key[q]]++] = sz[q];
  const qBlock = new Float32Array(NS * NB * NB).fill(Infinity), qSp = new Float32Array(NS).fill(Infinity);
  const spAll = Array.from({ length: NS }, () => []);
  yield;
  for (let k = 0; k < NS * NB * NB; k++) {
    const a = cnt[k], b = cnt[k + 1]; if (b <= a) continue;
    if ((k & 63) === 0) yield;
    const s = sorted.subarray(a, b).sort();
    if (b - a >= OLD_MIN) qBlock[k] = s[Math.min(b - a - 1, Math.floor(OLD_Q * (b - a)))];
    spAll[Math.floor(k / (NB * NB))].push(s);
  }
  for (let s = 0; s < NS; s++) {
    const list = spAll[s], tot = list.reduce((t, a) => t + a.length, 0); if (!tot) continue;
    yield;
    const all = new Float32Array(tot); let o = 0; for (const a of list) { all.set(a, o); o += a.length; }
    all.sort(); qSp[s] = all[Math.min(tot - 1, Math.floor(OLD_Q * tot))];
  }
  // 3. Landmarks: the LANDMARKS largest crowns of each species (by size, then by index for ties).
  const top = Array.from({ length: NS }, () => []);
  for (let q = 0; q < N; q++) {
    if ((q & (YIELD_EVERY * 4 - 1)) === 0) yield;
    const t = top[sp[q]];
    if (t.length === LANDMARKS && sz[q] <= sz[t[t.length - 1]]) continue;
    let k = t.length; while (k > 0 && sz[t[k - 1]] < sz[q]) k--;
    t.splice(k, 0, q); if (t.length > LANDMARKS) t.pop();
  }
  const landmarks = [], landmarkOf = new Map();
  top.forEach((t, s) => t.forEach((q, rank) => {
    const id = speciesIds[s], i = Math.floor(x[q] / res), j = Math.floor((size - n[q]) / res);
    const lm = { id: `${speciesInfo(id, dims).short}:${i},${j}:${rank + 1}`, species: id, q, x: x[q], n: n[q], h: h[q], r: r[q], rank: rank + 1 };
    landmarks.push(lm); landmarkOf.set(q, lm.id); flags[q] |= 2;
  }));
  // 4. Age class, slot and aspect.
  const stats = {};
  for (let q = 0; q < N; q++) {
    if ((q & (YIELD_EVERY - 1)) === 0) yield;
    const id = speciesIds[sp[q]], info = speciesInfo(id, dims), st = stats[id] || (stats[id] = { crowns: 0, old: 0, snag: 0, landmarks: 0, maxH: 0 });
    st.crowns++; st.maxH = Math.max(st.maxH, h[q]);
    const oldCls = info.classes.find(c => c.old);
    const old = oldCls && ((flags[q] & 2) || h[q] >= info.oldAbs || (sz[q] >= Math.min(qBlock[key[q]], qSp[sp[q]] * 1.15) && sz[q] >= qSp[sp[q]] * 0.8 && h[q] >= info.matureLo));
    let list;
    if (old) { list = oldCls.slots; flags[q] |= 1; st.old++; }
    else if (info.snag.length && h[q] >= info.matureLo && u01(q, 4) < info.snagFrac) { list = info.snag; flags[q] |= 4; st.snag++; }
    else list = chooseClass(info, h[q]).slots;
    if (flags[q] & 2) st.landmarks++;
    const v = list[Math.floor(u01(q, 5) * list.length)];
    slot[q] = v;
    const d = dims(id, v), sh = Math.min(SCALE[1], Math.max(SCALE[0], h[q] / d.H));
    aspect[q] = Math.min(ASPECT[1], Math.max(ASPECT[0], r[q] / Math.max(0.3, d.R * sh)));
  }
  const ms = Math.round(performance.now() - t0);
  return { count: N, cells: raw.cells, cellM: raw.cellM, offsets: raw.offsets, x, n, h, r, rot, aspect, sp, slot, flags,
    landmarks, landmarkOf, stats, speciesIds, ms, moved, wet, borrowed };
}

const fb = new Map();
function fallbackDims(id, v) {
  const k = `${id}:${v}`; let d = fb.get(k);
  if (!d) { const H = treeWood(id, variantSlots(id, SLOTS)[v].seed)?.H || 10; d = { H, R: 0.35 * H }; fb.set(k, d); }
  return d;
}
