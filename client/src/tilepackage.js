// Loads a tile package's client rasters and exposes metric-space samplers.
// Client space: x = meters east of the tile's west edge, z = -(meters north of the south edge), y = elevation.

export async function loadImageData(url) {
  const img = new Image();
  img.decoding = 'async';
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('image failed: ' + url)); img.src = url; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data, image: img };
}

// Optional image: resolves to null instead of failing the tile load.
function loadOptionalImage(url) {
  return new Promise(res => { const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null); img.src = url; });
}

export class Heightfield {
  constructor(img, sizeM) {
    this.w = img.width; this.h = img.height; this.size = sizeM; this.res = sizeM / img.width;
    const n = this.w * this.h, d = img.data;
    this.z = new Float32Array(n);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = -10000 + (d[i * 4] * 65536 + d[i * 4 + 1] * 256 + d[i * 4 + 2]) * 0.1;
      this.z[i] = v; if (v < min) min = v; if (v > max) max = v;
    }
    this.min = min; this.max = max;
  }
  // x east (m), north (m from south edge)
  at(x, north) {
    const px = Math.min(Math.max(x / this.res, 0), this.w - 1.001);
    const py = Math.min(Math.max((this.size - north) / this.res, 0), this.h - 1.001);
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    const i = y0 * this.w + x0, z = this.z;
    const a = z[i], b = z[i + 1], c = z[i + this.w], d = z[i + this.w + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  atXZ(x, zc) { return this.at(x, -zc); }
}

export class Grid8 {
  // 8-bit per-channel grid on the tile (habitat classes, canopy percentages, road weight); res follows the image width
  constructor(img, sizeM) { this.img = img; this.size = sizeM; this.res = sizeM / img.width; }
  cellOf(x, north) {
    const i = Math.min(Math.max(Math.floor(x / this.res), 0), this.img.width - 1);
    const j = Math.min(Math.max(Math.floor((this.size - north) / this.res), 0), this.img.height - 1);
    return [i, j];
  }
  channel(i, j, ch) { return this.img.data[(j * this.img.width + i) * 4 + ch]; }
  at(x, north, ch = 0) { const [i, j] = this.cellOf(x, north); return this.channel(i, j, ch); }
}

// Outcrop likelihood 0..1 at a point, bilinear between the 30 m cell centres of client/outcrop.png
// (0 on a tile without the geology step), and the share of vegetation kept there: grass blades,
// shells, tussocks and oats, the shrub impostors and the placed trees and shrubs all thin by this one
// curve (none below 0.4, 15% left from 0.65 up) so the outcrops of rocks.js show through.
export function outcropAt(tile, x, north) {
  const g = tile.outcrop; if (!g) return 0;
  const W = g.img.width, H = g.img.height, fx = x / g.res - 0.5, fy = (g.size - north) / g.res - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const v = (i, j) => g.channel(Math.min(Math.max(i, 0), W - 1), Math.min(Math.max(j, 0), H - 1), 0);
  return ((v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty) / 255;
}
// Regional strike of the Mother Lode belt, degrees east of north (N35W): the bedded rocks' fins
// (rocks.js) and the open strips between brush here both run along it.
export const STRIKE_DEG = -35;
const SA = Math.sin(STRIKE_DEG * Math.PI / 180), CA = Math.cos(STRIKE_DEG * Math.PI / 180);
// Value noise on a lattice, 0..1, integer hash (no sin: a sin hash shows its lattice).
const vhash = (i, j) => { let h = (i * 73856093) ^ (j * 19349663) ^ 0x9e3779b9; h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(u, v) {
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  return (vhash(i, j) * (1 - su) + vhash(i + 1, j) * su) * (1 - sv) + (vhash(i, j + 1) * (1 - su) + vhash(i + 1, j + 1) * su) * sv;
}
// Patchy: an outcrop in chaparral is a run of fins with brush between them, not a clearing. Along the
// strike the opening comes in strips (about 8 m across, 30 m along, a finer octave on top): on a strip
// 15% of the plants are kept, between strips 65%, both scaled by how strong the likelihood is.
export function rockKeep(tile, x, north) {
  const L = outcropAt(tile, x, north); if (L <= 0.4) return 1;
  const t = Math.min((L - 0.4) / 0.25, 1), s = t * t * (3 - 2 * t);
  const along = x * SA + north * CA, across = x * CA - north * SA;
  const p = 0.72 * vnoise(across / 8 + 3.1, along / 30 + 7.7) + 0.28 * vnoise(across / 3.5 + 11.3, along / 12 + 5.9);
  const o = Math.min(Math.max((p - 0.38) / 0.24, 0), 1), open = o * o * (3 - 2 * o);
  return 1 - s * (0.35 + 0.5 * open);
}

// Per-cell species mix from LANDFIRE (pipeline: client/species_mix*.png, species_mix.json). Read
// through the 8-bit index PNG (canvas-safe; the RGBA forms carry data in alpha, which a 2D canvas
// premultiplies away) and the JSON rows' `bytes`. at(i, j) on the habitat grid (same 333 px grid)
// returns the row record, or null where the index is 0 (no mix: callers fall back to the class mix).
// Row record: { index, rule, name, weights: {blue_oak, live_oak, gray_pine, ponderosa, willow, alder,
// cottonwood, manzanita, chamise} (0..1, trees and shrubs each summing to 1 or 0), trees, shrubs (non-zero
// weights only, keyed by the species aliases trees.js resolves), treeSum, shrubSum (bytes), treeDensity,
// shrubDensity (multipliers, byte / 100), savanna }. Which byte is which comes from the JSON's
// `bytes_layout` (2026-10-25: willow, alder and cottonwood appended); older tiles use the original eight.
const MIX_LAYOUT = { trees: { blue_oak: 0, live_oak: 1, gray_pine: 2, ponderosa: 3 }, shrubs: { manzanita: 4, chamise: 5 },
  tree_density: 6, shrub_density: 7 };
export class SpeciesMix {
  constructor(img, json, sizeM) {
    this.img = img; this.size = sizeM; this.res = sizeM / img.width; this.json = json;
    this.rows = [null];
    const lay = json.bytes_layout || MIX_LAYOUT, T = Object.entries(lay.trees), S = Object.entries(lay.shrubs);
    for (const m of json.mixes || []) {
      const b = m.bytes || [], sum = cols => cols.reduce((s, [, c]) => s + (b[c] || 0), 0);
      const treeSum = sum(T), shrubSum = sum(S), weights = {}, trees = {}, shrubs = {};
      for (const [cols, tot, out] of [[T, treeSum, trees], [S, shrubSum, shrubs]]) for (const [k, c] of cols) {
        const wgt = tot ? (b[c] || 0) / tot : 0;
        weights[k] = wgt; if (wgt > 0) out[k] = wgt;
      }
      // blue oak savanna: a mix led by blue oak (grassland_savanna, blue_oak, blue_oak_foothill_pine)
      this.rows[m.index] = { index: m.index, rule: m.rule, name: m.name, weights, trees, shrubs, treeSum, shrubSum,
        treeDensity: b[lay.tree_density] / 100, shrubDensity: b[lay.shrub_density] / 100, savanna: b[lay.trees.blue_oak] >= 128 };
    }
  }
  at(i, j) { return this.rows[this.img.data[(j * this.img.width + i) * 4]] || null; }
  atXY(x, north) {
    const i = Math.min(Math.max(Math.floor(x / this.res), 0), this.img.width - 1);
    const j = Math.min(Math.max(Math.floor((this.size - north) / this.res), 0), this.img.height - 1);
    return this.at(i, j);
  }
}

// Hydrology rewilding (docs/tile-spec.md): the reservoirs and stock ponds the pipeline took out are
// listed in the manifest layer `hydro.human_water` (`rewilded`, each with a tile-local bbox). A ring of
// client/features.json is one of them when its bounding box overlaps that bbox with IoU over 0.6 (the
// match water.js makes). loadTile marks those rings `rewilded: true` so the water mask and the pond-shore
// stones leave them out: the present-day waterbodies minus the removed ones. The mini-map still draws
// them (it is the present day).
export function markRewilded(features, manifest) {
  const list = manifest?.layers?.['hydro.human_water']?.rewilded || [];
  let n = 0;
  for (const w of features?.waterbodies || []) {
    const ring = w.ring; if (!ring || ring.length < 3) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    w.rewilded = list.some(r => r.bbox && bboxIoU(r.bbox, [x0, y0, x1, y1]) > 0.6);
    if (w.rewilded) n++;
  }
  return n;
}
function bboxIoU(a, b) {
  const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (ix <= 0 || iy <= 0) return 0;
  const i = ix * iy, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
  return u > 0 ? i / u : 0;
}

// The rewilded beds (client/channel_profile.png B, 5 m grid): 255 a former reservoir or stock-pond
// bed, now meadow; 160 the riparian corridor along the restored channel through it; 0 elsewhere.
// Loaded with the tile (water.js loads the same image later for its own use), B kept only.
export class RewildGrid {
  constructor(img, sizeM) {
    this.width = img.width; this.size = sizeM; this.res = sizeM / img.width;
    const n = img.width * img.height, d = img.data, b = this.b = new Uint8Array(n);
    let any = 0;
    for (let i = 0; i < n; i++) { b[i] = d[i * 4 + 2]; any |= b[i]; }
    this.any = any > 0;
  }
  at(x, north) {
    if (x < 0 || north < 0 || x >= this.size || north >= this.size) return 0;
    return this.b[Math.floor((this.size - north) / this.res) * this.width + Math.floor(x / this.res)];
  }
}

// Where the water is, from tile.features (rings and paths in tile-local metres, y = north). Ponds:
// inside any waterbody ring not marked `rewilded` (markRewilded). Channels: perennial and
// intermittent reaches (NHD fcode, as water.js classes them), within the reach's water width / 2 + 1 m of the centreline: `width` from drainage
// area (pipeline/channels.py: 1.6 A^0.45 m, 1-30), else by order (1: 1.5 m, 2: 2.5, 3: 4, 4+: 7). Riparian band: within RIPARIAN_M of any stream centreline (ephemeral swales included;
// canals, 33600, are human footprint and ignored).
//   inWater(x, north) -> bool, exact (vegetation placement)
//   streamDist(x, north) -> metres to the nearest stream centreline, Infinity beyond RIPARIAN_M
//   at(x, north) -> 0..255 on a 2000 px grid (5 m, the roads grid; built on first call): 255 in
//     water (pond, or the pixel centre within a channel), 1..200 in the riparian band (200 at the
//     centreline, falling to 1 at RIPARIAN_M), 0 elsewhere. Same call shape as tile.roads.
export const RIPARIAN_M = 8;
const STREAM_KIND = { 46006: 'perennial', 55800: 'perennial', 46003: 'intermittent', 33400: 'intermittent', 46007: 'ephemeral', 33600: null };
const WATER_WIDTH = [0, 1.5, 2.5, 4, 7];
export class WaterMask {
  constructor(features, sizeM, px = 2000) {
    this.size = sizeM; this.B = 30; this.nb = Math.ceil(sizeM / this.B); this.buckets = new Map();
    this.segs = []; this.rings = [];   // segs: [ax, ay, bx, by, halfWidth (0 = ephemeral, no channel)]
    this.width = px; this.height = px; this.res = sizeM / px; this.grid = null;
    const add = (x0, y0, x1, y1, ref) => {
      const B = this.B, i0 = Math.max(0, Math.floor(x0 / B)), i1 = Math.min(this.nb - 1, Math.floor(x1 / B));
      const j0 = Math.max(0, Math.floor(y0 / B)), j1 = Math.min(this.nb - 1, Math.floor(y1 / B));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * this.nb + i; let b = this.buckets.get(k); if (!b) this.buckets.set(k, b = { segs: [], rings: [] });
        ref.ring ? b.rings.push(ref) : b.segs.push(ref);
      }
    };
    for (const w of features?.waterbodies || []) {
      const ring = w.ring; if (!ring || ring.length < 3 || w.rewilded) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const r = { ring, bbox: [x0, y0, x1, y1], fcode: w.fcode, area: Math.abs(ringArea(ring)) };
      this.rings.push(r); add(x0, y0, x1, y1, r);
    }
    for (const st of features?.streams || []) {
      const kind = st.fcode in STREAM_KIND ? STREAM_KIND[st.fcode] : 'intermittent';
      if (!kind || !st.path || st.path.length < 2) continue;
      const ww = st.width > 0 ? st.width : WATER_WIDTH[Math.max(1, Math.min(4, st.order || 1))];
      const hw = kind === 'ephemeral' ? 0 : ww / 2 + 1;
      const reach = Math.max(RIPARIAN_M, hw);
      for (let n = 0; n < st.path.length - 1; n++) {
        const [ax, ay] = st.path[n], [bx, by] = st.path[n + 1], s = [ax, ay, bx, by, hw];
        this.segs.push(s);
        add(Math.min(ax, bx) - reach, Math.min(ay, by) - reach, Math.max(ax, bx) + reach, Math.max(ay, by) + reach, s);
      }
    }
  }
  bucket(x, north) {
    if (x < 0 || north < 0 || x >= this.size || north >= this.size) return null;
    return this.buckets.get(Math.floor(north / this.B) * this.nb + Math.floor(x / this.B)) || null;
  }
  inPond(x, north, b = this.bucket(x, north)) {
    if (b) for (const r of b.rings) { const q = r.bbox; if (x >= q[0] && x <= q[2] && north >= q[1] && north <= q[3] && inRing(x, north, r.ring)) return true; }
    return false;
  }
  inWater(x, north) {
    const b = this.bucket(x, north); if (!b) return false;
    if (this.inPond(x, north, b)) return true;
    for (const s of b.segs) if (s[4] > 0 && segDist2(x, north, s) < s[4] * s[4]) return true;
    return false;
  }
  streamDist(x, north) {
    const b = this.bucket(x, north); if (!b) return Infinity;
    let d2 = RIPARIAN_M * RIPARIAN_M;
    for (const s of b.segs) d2 = Math.min(d2, segDist2(x, north, s));
    return d2 < RIPARIAN_M * RIPARIAN_M ? Math.sqrt(d2) : Infinity;
  }
  build() {
    const t0 = performance.now(), W = this.width, res = this.res, g = new Uint8Array(W * W);
    const per = this.B / res;   // pixels per bucket side
    for (const [k, b] of this.buckets) {
      const bi = k % this.nb, bj = Math.floor(k / this.nb);
      for (let py = Math.floor(bj * per); py < Math.min(W, Math.ceil((bj + 1) * per)); py++) {
        const north = (py + 0.5) * res, row = (W - 1 - py) * W;   // row 0 = north edge, as the roads image
        for (let px = Math.floor(bi * per); px < Math.min(W, Math.ceil((bi + 1) * per)); px++) {
          const x = (px + 0.5) * res;
          if (this.inWater(x, north)) { g[row + px] = 255; continue; }
          const d = this.streamDist(x, north);
          if (d < RIPARIAN_M) g[row + px] = Math.max(1, Math.round(200 * (1 - d / RIPARIAN_M)));
        }
      }
    }
    this.grid = g; this.buildMs = Math.round(performance.now() - t0);
    return this;
  }
  cellOf(x, north) {
    const i = Math.min(Math.max(Math.floor(x / this.res), 0), this.width - 1);
    const j = Math.min(Math.max(Math.floor((this.size - north) / this.res), 0), this.height - 1);
    return [i, j];
  }
  channel(i, j) { if (!this.grid) this.build(); return this.grid[j * this.width + i]; }
  at(x, north) { const [i, j] = this.cellOf(x, north); return this.channel(i, j); }
}
function segDist2(x, y, s) {
  const dx = s[2] - s[0], dy = s[3] - s[1], L = dx * dx + dy * dy;
  const t = L ? Math.min(1, Math.max(0, ((x - s[0]) * dx + (y - s[1]) * dy) / L)) : 0;
  const ex = s[0] + dx * t - x, ey = s[1] + dy * t - y;
  return ex * ex + ey * ey;
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function ringArea(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return a / 2; }

export async function loadTile(tileId, base = '../tiles/') {
  const idx = await (await fetch(base + 'index.json', { cache: 'no-cache' })).json();
  const id = tileId && idx.tiles.some(t => t.tile_id === tileId) ? tileId : idx.tiles[0]?.tile_id;
  if (!id) throw new Error('no tiles built');
  const dir = `${base}${id}/`;
  const m = await (await fetch(dir + 'manifest.json', { cache: 'no-cache' })).json();
  const L = m.layers;
  for (const k of ['client.heights', 'client.texture', 'client.habitat', 'client.canopy', 'client.masks'])
    if (!L[k]) throw new Error(`tile ${id} lacks ${k}; run the derive step`);
  const [heights, texture, habitat, canopy, masks, species, perception, calendar, imagery, features, roads, imageryTexture, mast, mixIndex, mixJson, outcrop, geology, soils, groundClasses, profile] = await Promise.all([
    loadImageData(dir + L['client.heights'].path), loadImageData(dir + L['client.texture'].path),
    loadImageData(dir + L['client.habitat'].path), loadImageData(dir + L['client.canopy'].path),
    loadImageData(dir + L['client.masks'].path),
    fetch(dir + 'species/species.json').then(r => r.json()).catch(() => []),
    fetch(dir + 'perception.json').then(r => r.json()).catch(() => null),
    fetch(dir + 'calendar.json').then(r => r.json()).catch(() => null),
    // mini-map products (present-day imagery and features); optional
    L['client.imagery'] ? loadOptionalImage(dir + L['client.imagery'].path) : null,
    L['client.features'] ? fetch(dir + L['client.features'].path).then(r => r.ok ? r.json() : null).catch(() => null) : null,
    // decayed-road weight on the 5 m grid (255 pavement, falling to 0 over the verge); optional
    L['client.roads'] ? loadImageData(dir + L['client.roads'].path).catch(() => null) : null,
    // NAIP with humans erased (JPEG, 4000 px); only the image is needed, not its pixels. Optional.
    L['client.texture_imagery'] ? loadOptionalImage(dir + L['client.texture_imagery'].path) : null,
    // fall acorn_mast score 0..100 in R on the 30 m grid (acorn game); optional
    L['client.mast'] ? loadImageData(dir + L['client.mast'].path).catch(() => null) : null,
    // LANDFIRE species mix per 30 m cell: the canvas-safe index PNG plus the row table; optional
    L['client.species_mix'] ? loadImageData(dir + 'client/species_mix_index.png').catch(() => null) : null,
    L['client.species_mix'] ? fetch(dir + L['client.species_mix'].path).then(r => r.ok ? r.json() : null).catch(() => null) : null,
    // geology and soils step (tile-spec "Geology and soils"), all on the 30 m grid; optional (older
    // tiles have none: rocks.js then places nothing). outcrop R = likelihood 0..255; geology R = unit,
    // G = rock class (1-based into ground_classes.rock_classes); soils R = map unit, G = surface rock
    // fragments %, B = depth to bedrock dm (255 unknown).
    L['client.outcrop'] ? loadImageData(dir + L['client.outcrop'].path).catch(() => null) : null,
    L['client.geology'] ? loadImageData(dir + L['client.geology'].path).catch(() => null) : null,
    L['client.soils'] ? loadImageData(dir + L['client.soils'].path).catch(() => null) : null,
    L['client.ground_classes'] ? fetch(dir + L['client.ground_classes'].path).then(r => r.ok ? r.json() : null).catch(() => null) : null,
    // rewilded water beds and corridor (channel_profile B); optional
    L['client.channel_profile'] ? loadImageData(dir + L['client.channel_profile'].path).catch(() => null) : null,
  ]);
  if (features) markRewilded(features, m);
  const rewild = profile ? new RewildGrid(profile, m.size_m || 10000) : null;
  const ti = L['client.texture_imagery'];
  const size = m.size_m || 10000;
  return {
    id, manifest: m, size, dir,
    heights: new Heightfield(heights, size), textureImage: texture.image, masksImage: masks.image,
    habitat: new Grid8(habitat, size), canopy: new Grid8(canopy, size),
    roads: roads ? new Grid8(roads, size) : null, roadsImage: roads?.image || null,
    mast: mast ? new Grid8(mast, size) : null,
    outcrop: outcrop ? new Grid8(outcrop, size) : null, geology: geology ? new Grid8(geology, size) : null,
    soils: soils ? new Grid8(soils, size) : null, groundClasses,
    // per-cell species weights and density multipliers (null: vegetation falls back to the class mix)
    speciesMix: mixIndex && mixJson?.mixes && mixIndex.width === habitat.width ? new SpeciesMix(mixIndex, mixJson, size) : null,
    // former reservoir and stock-pond beds (255) and their riparian corridor (160), or null
    rewild: rewild?.any ? rewild : null,
    // ponds (minus the rewilded ones), stream channels and the riparian band (exact tests; .at(x, north) like tile.roads)
    waterMask: features ? new WaterMask(features, size, roads?.width || 2000) : null,
    // the imagery's own summer grass and oak means (sRGB 0..1), the baseline for season recolouring
    imageryTextureImage: imageryTexture, imageryRef: imageryTexture ? { grass_mean: ti.grass_mean, oak_mean: ti.oak_mean } : null,
    species, perception, calendar, imagery, features,
    latitude: (m.bounds_wgs84[1] + m.bounds_wgs84[3]) / 2,
  };
}

export const HABITAT_NAMES = { 0: 'nodata', 1: 'oak woodland', 2: 'conifer forest', 3: 'mixed forest', 4: 'chaparral', 5: 'grassland', 6: 'riparian', 7: 'water', 8: 'barren', 9: 'human' };

// Present-day imagery for the peek (P): NAIP with the human footprint still in it. Prefers the
// 4000 px `client.texture_present` (same UTM grid as the terrain), loaded lazily on first use and
// cached on the tile; falls back to the 1024 px mini-map imagery already in memory.
export function loadPresentTexture(tile) {
  if (tile._present) return tile._present;
  const L = tile.manifest.layers, p = L['client.texture_present'];
  const fallback = () => tile.imagery ? { image: tile.imagery, source: 'client.imagery', px: tile.imagery.width } : null;
  tile._present = (p ? loadOptionalImage(tile.dir + p.path) : Promise.resolve(null))
    .then(img => img ? { image: img, source: 'client.texture_present', px: img.width, year: p.year || p.naip_year } : fallback());
  return tile._present;
}
