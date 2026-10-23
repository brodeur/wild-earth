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

export async function loadTile(tileId, base = '../tiles/') {
  const idx = await (await fetch(base + 'index.json', { cache: 'no-cache' })).json();
  const id = tileId && idx.tiles.some(t => t.tile_id === tileId) ? tileId : idx.tiles[0]?.tile_id;
  if (!id) throw new Error('no tiles built');
  const dir = `${base}${id}/`;
  const m = await (await fetch(dir + 'manifest.json', { cache: 'no-cache' })).json();
  const L = m.layers;
  for (const k of ['client.heights', 'client.texture', 'client.habitat', 'client.canopy', 'client.masks'])
    if (!L[k]) throw new Error(`tile ${id} lacks ${k}; run the derive step`);
  const [heights, texture, habitat, canopy, masks, species, perception, calendar, imagery, features, roads] = await Promise.all([
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
  ]);
  const size = m.size_m || 10000;
  return {
    id, manifest: m, size, dir,
    heights: new Heightfield(heights, size), textureImage: texture.image, masksImage: masks.image,
    habitat: new Grid8(habitat, size), canopy: new Grid8(canopy, size),
    roads: roads ? new Grid8(roads, size) : null, roadsImage: roads?.image || null,
    species, perception, calendar, imagery, features,
    latitude: (m.bounds_wgs84[1] + m.bounds_wgs84[3]) / 2,
  };
}

export const HABITAT_NAMES = { 0: 'nodata', 1: 'oak woodland', 2: 'conifer forest', 3: 'mixed forest', 4: 'chaparral', 5: 'grassland', 6: 'riparian', 7: 'water', 8: 'barren', 9: 'human' };
