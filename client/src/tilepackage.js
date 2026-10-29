// Loads a tile package's client rasters and exposes metric-space samplers.
// Client space: x = meters east of the tile's west edge, z = -(meters north of the south edge), y = elevation.
import { runSliced, yieldToMain, drain, aborted } from './slice.js';

// An image (an HTMLImageElement: textures, the mini-map) and, as img.bitmap, the same bytes decoded into an ImageBitmap
// off the main thread (createImageBitmap on the blob). A canvas drawImage of the element decodes it inside that task
// (tens to hundreds of ms for the large rasters, while the opening screen waits); of the bitmap it is a copy. The
// pixels are the same for a draw at the image's own size (a scaled draw of the element can differ: Chrome may decode
// a JPEG at a reduced scale for it, so scaled readers keep drawing the element). 1:1 readers draw
// `image.bitmap || image`; main.js closes the bitmaps (and deletes them) once the world is built.
async function loadDecoded(url, signal = null) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('image failed: ' + url);
  const blob = await r.blob(), img = new Image();
  img.decoding = 'async';
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('image failed: ' + url)); img.src = URL.createObjectURL(blob); });
  img.bitmap = await createImageBitmap(blob).catch(() => null);
  img.blob = blob;   // terrain.js uploads the large ones to the GPU from it, in bands
  return img;
}

export async function loadImageData(url, signal = null) {
  const img = await loadDecoded(url, signal);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img.bitmap || img, 0, 0);
  // read back in strips of about 4 MB, a strip per task (slice.js): the same pixels as one getImageData
  const W = img.width, H = img.height, data = new Uint8ClampedArray(W * H * 4), S = Math.max(1, Math.floor((1 << 20) / W));
  for (let y = 0; y < H; y += S) {
    const h = Math.min(S, H - y);
    data.set(ctx.getImageData(0, y, W, h).data, y * W * 4);
    if (y + h < H) { await yieldToMain(); if (signal?.aborted) throw aborted(signal); }
  }
  img.bitmap?.close(); delete img.bitmap;   // read: the element stays for textures
  return { width: img.width, height: img.height, data, image: img };
}

// Optional image: resolves to null instead of failing the tile load.
function loadOptionalImage(url, signal = null) {
  return loadDecoded(url, signal).catch(() => null);
}

// Lidar micro-relief (client/terrain_detail.png, docs/tile-spec.md "Lidar"): the 1 m DEM averaged to
// 2 m minus heights.png, one byte per pixel, residual m = (v - 128) * 0.04, pixel centres at x = 2i + 1,
// rows north to south. Only the red channel is kept (25 MB for the home tile's 5000 px); the image is
// read through a canvas in strips so the RGBA copy never holds the whole 100 MB at once.
async function loadDetail(url, signal = null) {
  const img = await loadDecoded(url, signal);
  const W = img.width, H = img.height, out = new Uint8Array(W * H), S = 250;   // a strip per task (slice.js)
  const c = document.createElement('canvas'); c.width = W; c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  for (let y = 0; y < H; y += S) {
    const h = Math.min(S, H - y);
    ctx.clearRect(0, 0, W, S); ctx.drawImage(img.bitmap || img, 0, y, W, h, 0, 0, W, h);
    const d = ctx.getImageData(0, 0, W, h).data;
    for (let k = 0, o = y * W, n = W * h; k < n; k++) out[o + k] = d[k * 4];
    await yieldToMain(); if (signal?.aborted) throw aborted(signal);
  }
  img.bitmap?.close(); delete img.bitmap;
  return { width: W, height: H, data: out };
}

// Lidar micro raster (client/lidar_micro.png, docs/tile-spec.md "Lidar"): on terrain_detail.png's 2 m grid, rows north to
// south, R ground-return intensity (relative within the tile), G ground roughness (cm x 4 about each 1 m cell's mean, the
// cell's tilt included), B the multi-return share of the open cells (standing low vegetation). Kept as RGB, three bytes a
// pixel (75 MB at 5000 px; the alpha would add a quarter), read in strips as loadDetail does. terrain.js reads it at the
// micro patch's 1 m material nodes. Optional: absent on most tiles, and nothing warns.
async function loadLidarMicro(url, signal = null) {
  const img = await loadDecoded(url, signal);
  const W = img.width, H = img.height, out = new Uint8Array(W * H * 3), S = 250;
  const c = document.createElement('canvas'); c.width = W; c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  for (let y = 0; y < H; y += S) {
    const h = Math.min(S, H - y);
    ctx.clearRect(0, 0, W, S); ctx.drawImage(img.bitmap || img, 0, y, W, h, 0, 0, W, h);
    const d = ctx.getImageData(0, 0, W, h).data;
    for (let k = 0, o = y * W * 3, n = W * h; k < n; k++) { out[o + k * 3] = d[k * 4]; out[o + k * 3 + 1] = d[k * 4 + 1]; out[o + k * 3 + 2] = d[k * 4 + 2]; }
    await yieldToMain(); if (signal?.aborted) throw aborted(signal);
  }
  img.bitmap?.close(); delete img.bitmap;
  return { width: W, height: H, data: out, channels: 3 };
}

// Ground heights. Every raster sample is a pixel centre (the pipeline writes heights.png on a
// rasterio from_bounds grid: sample (i, j) stands for x = (i + 0.5) res, north = size - (j + 0.5) res),
// so the bilinear lookup is at x / res - 0.5, as the GPU's texture lookups at uv = x / size are.
//   base(x, north)    heights.png alone (5 m on the lidar tile, 10 m elsewhere): the far terrain mesh's vertices
//   at(x, north)      the ground: base plus the lidar residual where the tile has terrain_detail.png
//                     (the 1 m ground averaged to 2 m), else base. Every footing query reads this.
//   coarse(x, north)  the far terrain mesh as drawn: base at the 10 m vertices, each square split SW-NE
//   ground(x, north)  the terrain exactly as drawn this frame: the micro patch under the body (terrain.js
//                     MicroPatch: the surface below plus a few cm of relief) where it is, then the near fine
//                     mesh, else coarse. For things placed every frame (the raven, animals, a lizard's feet);
//                     cached placement (grass, rocks) reads at(), which the fine mesh matches near the player.
// The heights of heights.png (24-bit, 0.1 m from -10000 m), a generator that yields every 64 rows (loadTile steps it
// with slice.js runSliced); returns { z, min, max }.
export function* decodeHeights(img) {
  const n = img.width * img.height, d = img.data, z = new Float32Array(n), rows = img.width * 64;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    if (i % rows === 0) yield;
    const v = -10000 + (d[i * 4] * 65536 + d[i * 4 + 1] * 256 + d[i * 4 + 2]) * 0.1;
    z[i] = v; if (v < min) min = v; if (v > max) max = v;
  }
  return { z, min, max };
}
export class Heightfield {
  // decoded: decodeHeights(img)'s result when the caller has run it already (loadTile, in slices)
  constructor(img, sizeM, detail = null, decoded = null) {
    this.w = img.width; this.h = img.height; this.size = sizeM; this.res = sizeM / img.width;
    let r = decoded; if (!r) { const g = decodeHeights(img); do r = g.next(); while (!r.done); r = r.value; }
    this.z = r.z; this.min = r.min; this.max = r.max;
    this.detail = detail && detail.width === detail.height ? detail : null;
    if (this.detail) { this.dW = detail.width; this.dRes = sizeM / detail.width; }
    this.coarseSpacing = 10;   // terrain.js default vertex spacing
    this.fine = null;          // terrain.js: the near fine mesh's grid while it is drawn
    // terrain.js: the micro patch under the body while it is drawn (MicroPatch): { x0, x1, n0, n1 (its square), band (m
    // over which its relief eases to nothing at the edge), fn(x, north) (the relief at a point, eased as drawn, 0
    // outside), ground(x, north) (the patch's surface exactly as drawn, between its own vertices), step (its cell, m),
    // version (bumps at every rebuild or move) }. Things that stand on the ground near the body re-seat on it when the
    // version changes.
    this.micro = null;
  }
  // x east (m), north (m from south edge)
  base(x, north) {
    const px = Math.min(Math.max(x / this.res - 0.5, 0), this.w - 1.001);
    const py = Math.min(Math.max((this.size - north) / this.res - 0.5, 0), this.h - 1.001);
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    const i = y0 * this.w + x0, z = this.z;
    const a = z[i], b = z[i + 1], c = z[i + this.w], d = z[i + this.w + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  // lidar residual (m), bilinear between the 2 m pixel centres; 0 without terrain_detail
  residual(x, north) {
    if (!this.detail) return 0;
    const W = this.dW, px = Math.min(Math.max(x / this.dRes - 0.5, 0), W - 1.001);
    const py = Math.min(Math.max((this.size - north) / this.dRes - 0.5, 0), W - 1.001);
    const x0 = px | 0, y0 = py | 0, fx = px - x0, fy = py - y0, i = y0 * W + x0, d = this.detail.data;
    const v = (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + W] * (1 - fx) + d[i + W + 1] * fx) * fy;
    return (v - 128) * 0.04;
  }
  at(x, north) { return this.detail ? this.base(x, north) + this.residual(x, north) : this.base(x, north); }
  atXZ(x, zc) { return this.at(x, -zc); }
  // Height of a 10 m mesh vertex: the 1 m ground itself (at; the 5 m heights on a tile without the lidar
  // residual), so the far surface passes through the true ground at every vertex and differs from it only inside
  // a cell (median 7 cm, 95th percentile 0.5 m, against 17 cm and 0.74 m from the 5 m heights alone): a road cut's
  // banks stand where they are, and what stands on them moves that little when the fine square arrives.
  vert(x, north) { return this.at(x, north); }
  coarse(x, north) {
    const S = this.coarseSpacing, n = Math.round(this.size / S) - 1;
    const fx = x / S, fn = north / S, i0 = Math.min(Math.max(Math.floor(fx), 0), n), n0 = Math.min(Math.max(Math.floor(fn), 0), n);
    const u = Math.min(Math.max(fx - i0, 0), 1), w = Math.min(Math.max(fn - n0, 0), 1);
    const SW = this.vert(i0 * S, n0 * S), SE = this.vert((i0 + 1) * S, n0 * S), NW = this.vert(i0 * S, (n0 + 1) * S), NE = this.vert((i0 + 1) * S, (n0 + 1) * S);
    return w > u ? SW + u * (NE - NW) + w * (NW - SW) : SW + u * (SE - SW) + w * (NE - SE);
  }
  // Inside the micro patch its surface (the fine or coarse surface plus the micro relief, as drawn); elsewhere groundIn.
  ground(x, north) {
    const M = this.micro;
    if (M && x > M.x0 && x < M.x1 && north > M.n0 && north < M.n1) return M.ground(x, north);
    return this.groundIn(this.fine, x, north);
  }
  // The surface a given fine square (a Heightfield.fine record, or null) draws: animals.js re-seats its still
  // animals from the square it placed them on to the one drawn now.
  groundIn(F, x, north) {
    if (F && x >= F.x0 && x <= F.x1 && north >= F.n0 && north <= F.n1) {
      // the fine grid: coordinates F.xs (west to east), F.ns (south to north), heights F.y[j * nx + i], squares split SW-NE
      const xs = F.xs, ns = F.ns, nx = xs.length;
      const i = Math.min(x < xs[1] ? 0 : Math.floor((x - xs[1]) / F.step) + 1, nx - 2);
      const j = Math.min(north < ns[1] ? 0 : Math.floor((north - ns[1]) / F.step) + 1, ns.length - 2);
      if (i === 0 || j === 0 || i === nx - 2 || j === ns.length - 2) return this.coarse(x, north);   // edge cells: the coarse surface (their vertices are pinned to it)
      const u = Math.min(Math.max((x - xs[i]) / (xs[i + 1] - xs[i]), 0), 1), w = Math.min(Math.max((north - ns[j]) / (ns[j + 1] - ns[j]), 0), 1);
      const y = F.y, k = j * nx + i, SW = y[k], SE = y[k + 1], NW = y[k + nx], NE = y[k + nx + 1];
      return w > u ? SW + u * (NE - NW) + w * (NW - SW) : SW + u * (SE - SW) + w * (NE - SE);
    }
    return this.coarse(x, north);
  }
  // Share of the 1 m ground in the drawn surface at a point: 1 inside the fine square, 0 outside it, easing
  // across its outer band as terrain.js does. Cached placement (grass cards, shrubs, rocks) stands on `at`
  // and is drawn at at + (1 - fineShare) x (coarse - at), so it sits on whichever surface is drawn there.
  fineShare(x, north, F = this.fine) {
    if (!F) return 0;
    const e = Math.min(x - F.x0, F.x1 - x, north - F.n0, F.n1 - north);
    if (e <= 0) return 0;
    const s = Math.min(e / F.band, 1);
    return s * s * (3 - 2 * s);
  }
  groundXZ(x, zc) { return this.ground(x, -zc); }
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

// Per-cell species mix from LANDFIRE (pipeline/species_mix.py, species_mix.json; docs/tile-spec.md,
// "Species mix"). A cell carries its row (the 8-bit index PNG, canvas-safe) and, in format 2, its two
// density multipliers (species_mix_density.png RGB: R tree, G shrub, byte / 100); the rows carry the
// weights for any number of species. at(i, j) on the habitat grid (same 333 px grid) returns the row
// record, or null where the index is 0 (no mix: callers fall back to the class mix); density(i, j) the
// cell's [tree, shrub] multipliers (the row's where there is no density PNG).
// Row record: { index, rule, name, trees, shrubs, ground (non-zero weights 0..1, each summing to 1, keyed by
// species id or alias, in the row's draw order; ground: the grasses and forbs, format 2 ground_bytes, 2026-10-29),
// weights (every column, zeros included), treeSum, shrubSum, groundSum
// (bytes), treeDensity, shrubDensity (multipliers, byte / 100), savanna (blue oak leads the trees),
// oaks: { blue, live } weights }.
// Formats: 2 (2026-10-25) mixes[].tree_bytes / shrub_bytes [[id, byte], ...] and density_bytes, keyed by
// canonical ids; 1, mixes[].bytes with species_mix.json `bytes_layout` naming each column by short alias
// (riparian trees appended); and the original eight-column layout without bytes_layout (MIX_LAYOUT).
// The draw order is the column order in every format, so a format-1 tile regenerated as format 2 places
// every plant exactly where it did.
const MIX_LAYOUT = { trees: { blue_oak: 0, live_oak: 1, gray_pine: 2, ponderosa: 3 }, shrubs: { manzanita: 4, chamise: 5 },
  tree_density: 6, shrub_density: 7 };
const BLUE_OAK = ['quercus_douglasii', 'blue_oak'], LIVE_OAK = ['quercus_wislizeni', 'live_oak'];
const RIP_ZONE = ['none', 'channel', 'margin', 'bank', 'terrace', 'pond_water', 'pond_margin', 'pond_shore', 'pond_terrace'];
export class SpeciesMix {
  constructor(img, json, sizeM, density = null) {
    this.img = img; this.size = sizeM; this.res = sizeM / img.width; this.json = json;
    this.format = json.format || 1;
    this.wide = (json.cells?.index_bytes || 1) > 1;   // rows over 255: R + 256 G
    this.dens = density && density.width === img.width ? density : null;
    this.rows = [null];
    const species = new Set();
    for (const m of json.mixes || []) {
      let T, S, td, sd, G = [];   // T, S, G: [[key, byte], ...] in column order
      if (this.format >= 2) {
        T = m.tree_bytes || []; S = m.shrub_bytes || []; G = m.ground_bytes || []; [td, sd] = m.density_bytes || [0, 0];
      } else {
        const lay = json.bytes_layout || MIX_LAYOUT, b = m.bytes || [];
        T = Object.entries(lay.trees).map(([k, c]) => [k, b[c] || 0]); S = Object.entries(lay.shrubs).map(([k, c]) => [k, b[c] || 0]);
        td = b[lay.tree_density]; sd = b[lay.shrub_density];
      }
      const sum = L => L.reduce((s, [, v]) => s + v, 0), treeSum = sum(T), shrubSum = sum(S), groundSum = sum(G), weights = {}, trees = {}, shrubs = {}, ground = {};
      for (const [L, tot, out] of [[T, treeSum, trees], [S, shrubSum, shrubs]]) for (const [k, v] of L) {
        const wgt = tot ? v / tot : 0;
        weights[k] = wgt; if (wgt > 0) { out[k] = wgt; species.add(k); }
      }
      // the ground layer (2026-10-29): the grasses and forbs, kept apart from `species` (vegetation.js grows no tree for them)
      for (const [k, v] of G) if (v > 0 && groundSum) ground[k] = v / groundSum;
      const byteOf = names => { for (const [k, v] of T) if (names.includes(k)) return v; return 0; };
      const wOf = names => { for (const k of names) if (weights[k]) return weights[k]; return 0; };
      // blue oak savanna: a mix led by blue oak (grassland_savanna, blue_oak, blue_oak_foothill_pine)
      this.rows[m.index] = { index: m.index, rule: m.rule, name: m.name, weights, trees, shrubs, ground, treeSum, shrubSum, groundSum,
        treeDensity: td / 100, shrubDensity: sd / 100, savanna: byteOf(BLUE_OAK) >= 128, oaks: { blue: wOf(BLUE_OAK), live: wOf(LIVE_OAK) } };
    }
    // The riparian zone rows (2026-10-29, pipeline species_mix.py riparian_rows): per zone, order class and permanence,
    // the trees, shrubs and ground species of a bank, a margin, a pond shore (ripRow); their species join `species`.
    this.rip = new Map();
    for (const [key, r] of Object.entries(json.riparian?.rows || {})) {
      const row = { trees: {}, shrubs: {}, ground: {}, density: r.density || [1, 1, 1], key };
      for (const layer of ['trees', 'shrubs', 'ground']) {
        const L = r[layer] || [], tot = L.reduce((s, [, v]) => s + v, 0);
        for (const [k, v] of L) if (v > 0 && tot) { row[layer][k] = v / tot; if (layer !== 'ground') species.add(k); }
      }
      row.treeSum = Object.keys(row.trees).length; row.shrubSum = Object.keys(row.shrubs).length; row.groundSum = Object.keys(row.ground).length;
      this.rip.set(key, row);
    }
    this.species = [...species];   // every species (id or alias) some row draws
  }
  // The riparian row for a WaterGrid info ({ zone, order, perennial }), or null: a zone's own species mix.
  ripRow(info) {
    if (!info || !info.zone || !this.rip.size) return null;
    const zone = RIP_ZONE[info.zone], cls = info.zone >= 5 ? 'pond' : info.order <= 2 ? 'small' : info.order <= 4 ? 'medium' : 'large';
    return this.rip.get(`${zone}|${cls}|${info.perennial ? 'perennial' : 'seasonal'}`) || null;
  }
  rowIndex(i, j) { const o = (j * this.img.width + i) * 4, d = this.img.data; return this.wide ? d[o] + 256 * d[o + 1] : d[o]; }
  at(i, j) { return this.rows[this.rowIndex(i, j)] || null; }
  // [tree, shrub] density multipliers of cell (i, j): the density PNG (format 2), else the row's; null without a row
  density(i, j, row = this.at(i, j)) {
    if (!row) return null;
    if (!this.dens) return [row.treeDensity, row.shrubDensity];
    const o = (j * this.img.width + i) * 4, d = this.dens.data;
    return [d[o] / 100, d[o + 1] / 100];
  }
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

// The water system (client/water.png, pipeline/water.py; docs/tile-spec.md "Water and riparian"): on the 5 m DEM grid,
// row 0 north, every waterway and pond with its riparian zones, bed material, water level and channel width:
//   R  zone (low 4 bits: WATER_ZONE), the stream order (bits 4-6) and 128 when the water is perennial
//   G  bed material (low 3 bits: BED_MATERIAL) and 8 on a bar
//   B  the water surface: heights.png's height at the cell + (B - 128) x 0.02 m; 0 off the water system
//   client/water_width.png (8-bit grey, the same grid): the channel's water half width at the nearest centreline sample, 0.1 m
// (a fourth channel in one RGBA file came back through the canvas premultiplied, the zone bits garbled)
// water.js draws the streams at the level and at the width; rocks.js lays the bed's stones by the material; the plant
// layers draw a zone's species from the species mix's riparian rows (SpeciesMix.ripRow); terrain.js tints the wet
// margins and the ponds' mud. The cells are the pipeline's: a 5 m pixel is channel where the centreline runs through it.
export const WATER_ZONE = { none: 0, channel: 1, margin: 2, bank: 3, terrace: 4, pond_water: 5, pond_margin: 6, pond_shore: 7, pond_terrace: 8 };
export const WATER_ZONE_NAMES = ['none', 'channel', 'margin', 'bank', 'terrace', 'pond_water', 'pond_margin', 'pond_shore', 'pond_terrace'];
export const BED_MATERIAL = ['none', 'silt', 'sand', 'gravel', 'cobble', 'boulder'];
export class WaterGrid {
  constructor(img, sizeM, heights, widthImg = null) {
    this.img = img; this.width = img.width; this.size = sizeM; this.res = sizeM / img.width; this.d = img.data;
    this.hw = widthImg && widthImg.width === img.width ? widthImg.data : null;
    this.heights = heights; this.sameGrid = !!heights && heights.w === img.width;
    this._info = { zone: 0, order: 0, perennial: false, pond: false };
    this.any = false; const d = img.data; for (let i = 0; i < d.length; i += 4) if (d[i]) { this.any = true; break; }
  }
  index(x, north) {
    if (!(x >= 0 && north >= 0 && x < this.size && north < this.size)) return -1;
    return Math.floor((this.size - north) / this.res) * this.width + Math.floor(x / this.res);
  }
  zone(x, north) { const o = this.index(x, north); return o < 0 ? 0 : this.d[o * 4] & 15; }
  // { zone, order (1-7; 0 at a pond), perennial, pond } at a point (one object, reused: copy what you keep)
  info(x, north) {
    const I = this._info, o = this.index(x, north), r = o < 0 ? 0 : this.d[o * 4];
    I.zone = r & 15; I.order = (r >> 4) & 7; I.perennial = r >= 128; I.pond = I.zone >= 5; return I;
  }
  material(x, north) { const o = this.index(x, north); return o < 0 ? 0 : this.d[o * 4 + 1] & 7; }
  bar(x, north) { const o = this.index(x, north); return o >= 0 && (this.d[o * 4 + 1] & 8) !== 0; }
  // the water surface height at a point, or null off the water system
  level(x, north) {
    const o = this.index(x, north); if (o < 0) return null;
    const b = this.d[o * 4 + 2]; if (!b) return null;
    const base = this.sameGrid ? this.heights.z[o] : this.heights.base((Math.floor(x / this.res) + 0.5) * this.res, this.size - (Math.floor((this.size - north) / this.res) + 0.5) * this.res);
    return base + (b - 128) * 0.02;
  }
  half(x, north) { const o = this.index(x, north); return o < 0 || !this.hw ? 0 : this.hw[o * 4] * 0.1; }
  // the share of a 30 m vegetation cell (i, j, cell size res30) in the woody riparian zones (bank, terrace, pond shore
  // and terrace) and in the wet ones (channel, margin, pond water and margin), cached: [woody, wet]
  cellShare(i, j, res30) {
    const key = j * 65536 + i; let v = this.shares?.get(key); if (v) return v;
    this.shares ??= new Map();
    const k = Math.max(1, Math.round(res30 / this.res)), x0 = Math.round(i * res30 / this.res), y0 = Math.round(j * res30 / this.res);
    let woody = 0, wet = 0, n = 0;
    for (let q = 0; q < k; q++) for (let p = 0; p < k; p++) {
      const xx = x0 + p, yy = y0 + q; if (xx >= this.width || yy >= this.width) continue;
      const z = this.d[(yy * this.width + xx) * 4] & 15; n++;
      if (z === 3 || z === 4 || z === 7 || z === 8) woody++; else if (z === 1 || z === 2 || z === 5 || z === 6) wet++;
    }
    v = n ? [woody / n, wet / n] : [0, 0]; this.shares.set(key, v); return v;
  }
  // a random riparian pixel's centre in cell (i, j) for a draw u in [0, 1), or null: where the extra bank trees go
  woodyPoint(i, j, res30, u) {
    const k = Math.max(1, Math.round(res30 / this.res)), x0 = Math.round(i * res30 / this.res), y0 = Math.round(j * res30 / this.res), list = [];
    for (let q = 0; q < k; q++) for (let p = 0; p < k; p++) {
      const xx = x0 + p, yy = y0 + q; if (xx >= this.width || yy >= this.width) continue;
      const z = this.d[(yy * this.width + xx) * 4] & 15; if (z === 3 || z === 4 || z === 7 || z === 8) list.push(xx, yy);
    }
    if (!list.length) return null;
    const m = Math.min(list.length / 2 - 1, Math.floor(u * list.length / 2)) * 2;
    return [(list[m] + 0.5) * this.res, this.size - (list[m + 1] + 0.5) * this.res];
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
  // The grid, made on first use; loadTile makes it ahead with buildSteps, in slices (slice.js), so the first frame's
  // grass and shrub placement does not make it inside one long task.
  build() { return drain(this.buildSteps()); }
  *buildSteps() {
    if (this.grid) return this;
    const t0 = performance.now(), W = this.width, res = this.res, g = new Uint8Array(W * W);
    const per = this.B / res;   // pixels per bucket side
    let nb = 0;
    for (const [k, b] of this.buckets) {
      if ((nb++ & 63) === 0) yield;
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

// The animal density prior (client/species_prior.json, layer client.species_prior; pipeline/derive.py
// species_prior), built from CC0 and CC BY occurrence records only: the records themselves
// (species/occurrences.geojson, CC BY-NC ones among them) are pipeline-only and never fetched here.
// Resolves to { cells, cellM, species: { code: Uint8Array(cells * cells), row 0 = north edge } } or null;
// animals.js turns a byte w into the prior 0.6 + 0.8 w / 255.
async function loadSpeciesPrior(url, signal = null) {
  const g = await fetch(url, { signal }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!g?.species || !(g.cells > 0)) return null;
  const species = {};
  for (const [code, s] of Object.entries(g.species)) {
    const bin = atob(s.w || ''), w = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) w[k] = bin.charCodeAt(k);
    if (w.length === g.cells * g.cells) species[code] = w;
  }
  return { cells: g.cells, cellM: g.cell_m || 100, species, datasets: g.datasets || [], licenses: g.licenses_used || [] };
}

export async function loadTile(tileId, base = '../tiles/', { signal = null } = {}) {   // signal: abandons the load (main.js)
  const idx = await (await fetch(base + 'index.json', { cache: 'no-cache', signal })).json();
  const id = tileId && idx.tiles.some(t => t.tile_id === tileId) ? tileId : idx.tiles[0]?.tile_id;
  if (!id) throw new Error('no tiles built');
  const dir = `${base}${id}/`;
  const m = await (await fetch(dir + 'manifest.json', { cache: 'no-cache', signal }, { signal })).json();
  const L = m.layers;
  for (const k of ['client.heights', 'client.texture', 'client.habitat', 'client.canopy', 'client.masks'])
    if (!L[k]) throw new Error(`tile ${id} lacks ${k}; run the derive step`);
  const MX = L['client.species_mix'], mixFiles = MX?.files || {};
  const [heights, texture, habitat, canopy, masks, species, perception, calendar, games, locomotion, imagery, features, roads, imageryTexture, mast, mixIndex, mixJson, mixDensity, outcrop, geology, soils, groundClasses, profile, speciesPrior, detail, canopyHeight, groundTexture, seasonImage, lidarMicro, waterImg, waterWidthImg] = await Promise.all([
    loadImageData(dir + L['client.heights'].path, signal), loadImageData(dir + L['client.texture'].path, signal),
    loadImageData(dir + L['client.habitat'].path, signal), loadImageData(dir + L['client.canopy'].path, signal),
    loadImageData(dir + L['client.masks'].path, signal),
    fetch(dir + 'species/species.json', { signal }).then(r => r.json()).catch(() => []),
    fetch(dir + 'perception.json', { signal }).then(r => r.json()).catch(() => null),
    fetch(dir + 'calendar.json', { signal }).then(r => r.json()).catch(() => null),
    fetch(dir + 'games.json', { signal }).then(r => r.json()).catch(() => null),   // the species' games and relations (pipeline/games.py); optional
    fetch(dir + 'locomotion.json', { signal }).then(r => r.json()).catch(() => null),   // how each species moves, from its taxon and body (pipeline/locomotion.py); optional
    // mini-map products (present-day imagery and features); optional
    L['client.imagery'] ? loadOptionalImage(dir + L['client.imagery'].path, signal) : null,
    L['client.features'] ? fetch(dir + L['client.features'].path, { signal }).then(r => r.ok ? r.json() : null).catch(() => null) : null,
    // decayed-road weight on the 5 m grid (255 pavement, falling to 0 over the verge); optional
    L['client.roads'] ? loadImageData(dir + L['client.roads'].path, signal).catch(() => null) : null,
    // NAIP with humans erased (JPEG, 4000 px); only the image is needed, not its pixels. Optional. Still fetched
    // beside client.texture_ground: groundDetail.js reads its bare-ground mask from it, and ?base=imagery shows it.
    L['client.texture_imagery'] ? loadOptionalImage(dir + L['client.texture_imagery'].path, signal) : null,
    // fall acorn_mast score 0..100 in R on the 30 m grid (acorn game); optional
    L['client.mast'] ? loadImageData(dir + L['client.mast'].path, signal).catch(() => null) : null,
    // LANDFIRE species mix per 30 m cell: the canvas-safe index PNG, the row table and (format 2) the
    // per-cell density PNG; optional
    MX ? loadImageData(dir + 'client/species_mix_index.png', signal).catch(() => null) : null,
    MX ? fetch(dir + MX.path, { signal }).then(r => r.ok ? r.json() : null).catch(() => null) : null,
    mixFiles['client/species_mix_density.png'] ? loadImageData(dir + 'client/species_mix_density.png', signal).catch(() => null) : null,
    // geology and soils step (tile-spec "Geology and soils"), all on the 30 m grid; optional (older
    // tiles have none: rocks.js then places nothing). outcrop R = likelihood 0..255; geology R = unit,
    // G = rock class (1-based into ground_classes.rock_classes); soils R = map unit, G = surface rock
    // fragments %, B = depth to bedrock dm (255 unknown).
    L['client.outcrop'] ? loadImageData(dir + L['client.outcrop'].path, signal).catch(() => null) : null,
    L['client.geology'] ? loadImageData(dir + L['client.geology'].path, signal).catch(() => null) : null,
    L['client.soils'] ? loadImageData(dir + L['client.soils'].path, signal).catch(() => null) : null,
    L['client.ground_classes'] ? fetch(dir + L['client.ground_classes'].path, { signal }).then(r => r.ok ? r.json() : null).catch(() => null) : null,
    // rewilded water beds and corridor (channel_profile B); optional
    L['client.channel_profile'] ? loadImageData(dir + L['client.channel_profile'].path, signal).catch(() => null) : null,
    // animal density prior from CC0 / CC BY records (animals.js); optional, null on older tiles
    L['client.species_prior'] ? loadSpeciesPrior(dir + L['client.species_prior'].path, signal) : null,
    // lidar step (tile-spec "Lidar"): the 2 m micro-relief residual and the 10 m canopy height; optional
    L['client.terrain_detail'] ? loadDetail(dir + L['client.terrain_detail'].path, signal).catch(e => { if (!signal?.aborted) console.warn('terrain detail:', e.message); return null; }) : null,
    L['client.canopy_height'] ? loadImageData(dir + L['client.canopy_height'].path, signal).catch(() => null) : null,
    // seasonal colour (tile-spec "Seasonal colour"): the erased NAIP with the tree crowns and their shadows
    // replaced by ground (the base the 3D trees stand on), and the Sentinel-2 monthly sheet; optional
    L['client.texture_ground'] ? loadOptionalImage(dir + L['client.texture_ground'].path, signal) : null,
    L['client.season_rgb'] ? loadOptionalImage(dir + L['client.season_rgb'].path, signal) : null,
    // lidar step, newer tiles (tile-spec "Lidar"): intensity, roughness and low-vegetation share on the 2 m grid, for the
    // micro relief under the body (terrain.js); optional and quiet when absent
    L['client.lidar_micro'] ? loadLidarMicro(dir + L['client.lidar_micro'].path, signal).catch(e => { if (!signal?.aborted) console.warn('lidar micro:', e.message); return null; }) : null,
    // the water system (tile-spec "Water and riparian"): zones, bed material, levels and widths on the 5 m grid; optional
    L['client.water'] ? loadImageData(dir + L['client.water'].path, signal).catch(e => { if (!signal?.aborted) console.warn('water grid:', e.message); return null; }) : null,
    L['client.water'] ? loadImageData(dir + 'client/water_width.png', signal).catch(() => null) : null,
  ]);
  if (signal?.aborted) throw aborted(signal);
  if (features) markRewilded(features, m);
  const decoded = await runSliced(decodeHeights(heights), 'heights', { signal });
  const rewild = profile ? new RewildGrid(profile, m.size_m || 10000) : null;
  const ti = L['client.texture_imagery'];
  const size = m.size_m || 10000;
  const waterMask = features ? new WaterMask(features, size, roads?.width || 2000) : null;
  if (waterMask) await runSliced(waterMask.buildSteps(), 'water mask', { signal });
  const heightfield = new Heightfield(heights, size, detail, decoded);
  const water = waterImg && waterImg.width === waterImg.height ? new WaterGrid(waterImg, size, heightfield, waterWidthImg) : null;
  return {
    id, manifest: m, size, dir, signal,   // signal: the world's (main.js); the modules' own loads and slices stop with it
    heights: heightfield, textureImage: texture.image, masksImage: masks.image,
    // the water system's zones, bed material, levels and widths (WaterGrid), or null on a tile without the water step
    water: water?.any ? water : null, waterImage: water?.any ? waterImg.image : null,
    habitat: new Grid8(habitat, size), canopy: new Grid8(canopy, size),
    roads: roads ? new Grid8(roads, size) : null, roadsImage: roads?.image || null,
    mast: mast ? new Grid8(mast, size) : null,
    outcrop: outcrop ? new Grid8(outcrop, size) : null, geology: geology ? new Grid8(geology, size) : null,
    soils: soils ? new Grid8(soils, size) : null, groundClasses,
    // lidar canopy (client/canopy_height.png, 10 m): R p95 canopy height x 0.25 m, G tree cover %, B shrub cover %; null without the lidar step
    canopyHeight: canopyHeight ? new Grid8(canopyHeight, size) : null,
    // lidar micro (client/lidar_micro.png, 2 m, RGB as loadLidarMicro): { width, height, data, channels }, or null
    lidarMicro: lidarMicro && lidarMicro.width === lidarMicro.height ? lidarMicro : null,
    // per-cell species weights and density multipliers (null: vegetation falls back to the class mix)
    speciesMix: mixIndex && mixJson?.mixes && mixIndex.width === habitat.width ? new SpeciesMix(mixIndex, mixJson, size, mixDensity) : null,
    // former reservoir and stock-pond beds (255) and their riparian corridor (160), or null
    rewild: rewild?.any ? rewild : null,
    // ponds (minus the rewilded ones), stream channels and the riparian band (exact tests; .at(x, north) like tile.roads)
    waterMask,
    // the imagery's own summer grass and oak means (sRGB 0..1), the baseline for season recolouring
    imageryTextureImage: imageryTexture, imageryRef: imageryTexture ? { grass_mean: ti.grass_mean, oak_mean: ti.oak_mean } : null,
    // the imagery without trees (client.texture_ground), and the season_rgb sheet (an Image; season.js reads its frames)
    groundTextureImage: groundTexture, seasonImage,
    species, perception, calendar, games, locomotion, imagery, features, speciesPrior,
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
