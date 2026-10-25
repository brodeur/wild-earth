// CPU reference for the GPU placement prototype (client/gpu_place_test.html). Runs grass.js's own
// placement code (Grass.prototype: plantAt, cellData, cardCell, fill, drain) on a bare object, without
// the constructor's meshes, materials and atlas bake, so the reference is the client's code, not a copy.
// The few module-private constants of grass.js the GPU side needs are restated here; the equality
// checks would fail if they drifted.
import { Grass } from '../grass.js';

export const P_TOTAL = 1 / 0.18 + 8;                                   // CLOSE_PER_M2 + GROUND_PER_M2
export const R_MAIN = (1 / 1.35) / P_TOTAL, R_CLOSE = (1 / 0.18) / P_TOTAL;
export const R_TUFT = (1 / 4) / 0.75 / P_TOTAL;
export const R_TUS = 1.15 * 0.6 / (Math.PI * 0.27 ** 2) / P_TOTAL;
export const OAT_K = 1.15 / (Math.PI * 0.32 ** 2) / P_TOTAL, R_OAT_END = R_TUFT + OAT_K * 0.37;
// Blade layers as grass.js's LAYERS (rank range, `now` radius, placement radius) and its pools.
export const LAYERS = [
  { name: 'main', r: [0, R_MAIN], now: 88, place: 112, pool: 'near' },
  { name: 'close', r: [R_MAIN, R_CLOSE], now: 33, place: 57, pool: 'near' },
  { name: 'ground', r: [R_CLOSE, 1], now: 19, place: 34, pool: 'ground' },
];
export const POOL_REBUILD = { near: 25, ground: 8 };
// Card fields (grass.js `card(...)`): role, atlas kind, ClumpField band and LOD.
export const CARDS = [
  { role: 1, kind: 1, name: 'tufts', band: [26, 38, 215, 250], D0: 120, KMIN: 0.4 },
  { role: 2, kind: 0, name: 'tussocks', band: [6, 12, 185, 225], D0: 34, KMIN: 0.14 },
  { role: 3, kind: 2, name: 'oats', band: [6, 12, 200, 240], D0: 30, KMIN: 0.14 },
];
export const CARD_NOW = 60, REFILL_MOVE = 15, CARD_CODE = [0, 2, 3, 4];

// grass.js's placement noise, restated only to get DRIFT_MEAN (its mean of driftRaw) for the GPU.
function hash2(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const driftRaw = (x, n) => 0.25 + 1.5 * smooth(0.3, 0.75, 0.7 * vnoise(x / 18, n / 18, 51) + 0.3 * vnoise(x / 6, n / 6, 52));
export const DRIFT_MEAN = (() => { let s = 0; for (let j = 0; j < 120; j++) for (let i = 0; i < 120; i++) s += driftRaw(i * 13.7, j * 13.7); return s / 14400; })();

// grass.js terrainHeight (not exported): ground height on the rendered terrain mesh's triangles.
export function terrainHeight(tile) {
  const size = tile.size, cs = size / 10, sp = cs / Math.round(cs / 10), H = tile.heights;
  const f = (x, north) => {
    const u = x / sp, v = (size - north) / sp, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j;
    const x0 = i * sp, x1 = x0 + sp, n0 = size - j * sp, n1 = n0 - sp;
    const b = H.at(x0, n1), d = H.at(x1, n0);
    if (fx + fy <= 1) { const a = H.at(x0, n0); return a + (d - a) * fx + (b - a) * fy; }
    const c = H.at(x1, n1); return c + (b - c) * (1 - fx) + (d - c) * (1 - fy);
  };
  f.sp = sp;
  return f;
}

// A Grass with only the placement state: grass.js's own methods on it. dens > 1 multiplies the candidates
// per cell (an own `candidates` shadowing the prototype's): every rank range is a fraction of N, so the
// tiers and roles keep their shares and the GPU, given the same N, places the same plants.
export function makeRef(tile, dens = 1) {
  const g = Object.create(Grass.prototype);
  if (dens > 1) { const n = Grass.prototype.candidates.call({ tile }) * dens; g.candidates = () => n; }
  g.tile = tile; g.ground = terrainHeight(tile);
  g.cache = LAYERS.map(() => new Map()); g.queue = new Map(); g.dirty = { near: false, ground: false }; g.last = { near: null, ground: null };
  g._p = { ux: 0, uy: 0, px: 0, pn: 0, yaw: 0, sxz: 0, sy: 0, seed: 0, type: 0, role: 0 };
  g.buildDensityGrid();
  g.box = [{ R: 1, H: 1 }, { R: 1, H: 1 }, { R: 1, H: 1 }];   // unit bake boxes: card size = CARD_RK x sxz, CARD_HK x sy
  const set = cap => ({ stage: new Float32Array(cap * 8), cap, blocks: [], staged: 0, sig: NaN });
  g.sets = { annual: set(90000), bunch: set(90000), tussock: set(30000), oat: set(30000), groundA: set(50000), groundB: set(50000) };
  g.cardFields = CARDS.map(c => ({ ...c, cache: new Map(), cells: [], last: null }));
  return g;
}

export function resetRef(g) {
  for (const c of g.cache) c.clear();
  g.queue.clear(); g.dirty = { near: false, ground: false }; g.last = { near: null, ground: null };
  for (const f of g.cardFields) { f.cache.clear(); f.cells = []; f.last = null; }
}

// One frame of the CPU placement work the client does in Grass.update with the camera low enough for
// every pool (below 14 m): drain the queue (2 ms budget), refill the pools that moved, then the three card
// fields' cell generation as ClumpField.update does it (gather on a 15 m move, generate missing cells,
// nearest first, `now` cells at once, the rest within a 2 ms budget). Returns ms and what it did.
export function cpuFrame(g, x, north, cards = true) {
  const t0 = performance.now(); let nowCells = 0;
  const before = g.cache.reduce((s, c) => s + c.size, 0);
  if (g.queue.size) g.drain();
  for (const pool of ['near', 'ground']) {
    const last = g.last[pool], move = !last || Math.hypot(x - last[0], north - last[1]) > POOL_REBUILD[pool];
    if (!move && !g.dirty[pool]) continue;
    if (move) g.last[pool] = [x, north];
    g.dirty[pool] = false;
    g.fill(g.last[pool][0], g.last[pool][1], pool);
  }
  const blades = performance.now() - t0, built = g.cache.reduce((s, c) => s + c.size, 0) - before;
  let cardCells = 0, cardMissing = 0, cardTotal = 0;
  if (cards) for (const f of g.cardFields) {
    if (!f.last || Math.hypot(x - f.last[0], north - f.last[1]) > REFILL_MOVE) { f.last = [x, north]; f.cells = gather(g, x, north, f.band[3]); }
    const t1 = performance.now();
    for (const [d, i, j] of f.cells) {
      const key = j * g.W + i;
      if (f.cache.has(key)) continue;
      if (d > CARD_NOW && performance.now() - t1 > 2) break;
      if (d <= CARD_NOW) nowCells++;
      if (f.cache.size > 3000) f.cache.clear();
      f.cache.set(key, g.cardCell(i, j, f.role, f.kind)); cardCells++;
    }
    for (const [, i, j] of f.cells) { cardTotal++; if (!f.cache.has(j * g.W + i)) cardMissing++; }
  }
  return { ms: performance.now() - t0, bladesMs: blades, bladeCells: Math.max(0, built), cardCells, queue: g.queue.size, cardMissing, cardTotal };
}
function gather(g, x, north, r) {
  const res = g.tile.habitat.res, size = g.tile.size, cells = [];
  const i0 = Math.max(0, Math.floor((x - r) / res)), i1 = Math.min(g.W - 1, Math.floor((x + r) / res));
  const j0 = Math.max(0, Math.floor((size - north - r) / res)), j1 = Math.min(g.Hh - 1, Math.floor((size - north + r) / res));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (!g.cellAny(i, j)) continue;
    const d = Math.hypot((i + 0.5) * res - x, size - (j + 0.5) * res - north);
    if (d <= r + res * 0.71) cells.push([d, i, j]);
  }
  return cells.sort((a, b) => a[0] - b[0]);
}
export { gather };
