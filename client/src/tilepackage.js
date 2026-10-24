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

// Per-cell species mix from LANDFIRE (pipeline: client/species_mix*.png, species_mix.json). Read
// through the 8-bit index PNG (canvas-safe; the RGBA forms carry data in alpha, which a 2D canvas
// premultiplies away) and the JSON rows' `bytes`. at(i, j) on the habitat grid (same 333 px grid)
// returns the row record, or null where the index is 0 (no mix: callers fall back to the class mix).
// Row record: { index, rule, name, weights: {blue_oak, live_oak, gray_pine, ponderosa, manzanita,
// chamise} (0..1, trees and shrubs each summing to 1 or 0), trees, shrubs (non-zero weights only),
// treeSum, shrubSum (bytes), treeDensity, shrubDensity (multipliers, byte / 100), savanna }.
const MIX_SLOTS = ['blue_oak', 'live_oak', 'gray_pine', 'ponderosa', 'manzanita', 'chamise'];
export class SpeciesMix {
  constructor(img, json, sizeM) {
    this.img = img; this.size = sizeM; this.res = sizeM / img.width; this.json = json;
    this.rows = [null];
    for (const m of json.mixes || []) {
      const b = m.bytes || [], treeSum = b[0] + b[1] + b[2] + b[3], shrubSum = b[4] + b[5];
      const weights = {}, trees = {}, shrubs = {};
      MIX_SLOTS.forEach((k, n) => {
        const sum = n < 4 ? treeSum : shrubSum, wgt = sum ? b[n] / sum : 0;
        weights[k] = wgt; if (wgt > 0) (n < 4 ? trees : shrubs)[k] = wgt;
      });
      // blue oak savanna: a mix led by blue oak (grassland_savanna, blue_oak, blue_oak_foothill_pine)
      this.rows[m.index] = { index: m.index, rule: m.rule, name: m.name, weights, trees, shrubs, treeSum, shrubSum,
        treeDensity: b[6] / 100, shrubDensity: b[7] / 100, savanna: b[0] >= 128 };
    }
  }
  at(i, j) { return this.rows[this.img.data[(j * this.img.width + i) * 4]] || null; }
  atXY(x, north) {
    const i = Math.min(Math.max(Math.floor(x / this.res), 0), this.img.width - 1);
    const j = Math.min(Math.max(Math.floor((this.size - north) / this.res), 0), this.img.height - 1);
    return this.at(i, j);
  }
}

// Where the water is, from tile.features (rings and paths in tile-local metres, y = north). Ponds:
// inside any waterbody ring. Channels: perennial and intermittent reaches (NHD fcode, as water.js
// classes them), within the order's water width (1: 1.5 m, 2: 2.5, 3: 4, 4+: 7) / 2 + 1 m of the
// centreline. Riparian band: within RIPARIAN_M of any stream centreline (ephemeral swales included;
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
      const ring = w.ring; if (!ring || ring.length < 3) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const r = { ring, bbox: [x0, y0, x1, y1], fcode: w.fcode, area: Math.abs(ringArea(ring)) };
      this.rings.push(r); add(x0, y0, x1, y1, r);
    }
    for (const st of features?.streams || []) {
      const kind = st.fcode in STREAM_KIND ? STREAM_KIND[st.fcode] : 'intermittent';
      if (!kind || !st.path || st.path.length < 2) continue;
      const hw = kind === 'ephemeral' ? 0 : WATER_WIDTH[Math.max(1, Math.min(4, st.order || 1))] / 2 + 1;
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
  const [heights, texture, habitat, canopy, masks, species, perception, calendar, imagery, features, roads, imageryTexture, mast, mixIndex, mixJson] = await Promise.all([
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
  ]);
  const ti = L['client.texture_imagery'];
  const size = m.size_m || 10000;
  return {
    id, manifest: m, size, dir,
    heights: new Heightfield(heights, size), textureImage: texture.image, masksImage: masks.image,
    habitat: new Grid8(habitat, size), canopy: new Grid8(canopy, size),
    roads: roads ? new Grid8(roads, size) : null, roadsImage: roads?.image || null,
    mast: mast ? new Grid8(mast, size) : null,
    // per-cell species weights and density multipliers (null: vegetation falls back to the class mix)
    speciesMix: mixIndex && mixJson?.mixes && mixIndex.width === habitat.width ? new SpeciesMix(mixIndex, mixJson, size) : null,
    // ponds, stream channels and the riparian band (exact tests; .at(x, north) like tile.roads)
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
