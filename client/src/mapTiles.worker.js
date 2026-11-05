import { decodeTile } from './mvt.js';

// The home screen's map tiles, drawn off the main thread (mapGlobe.js asks; docs/decisions.md, "the home screen
// redesigned"). The data is OpenFreeMap's planet vector tiles (OpenMapTiles schema, map data © OpenStreetMap
// contributors; no key, no limits, commercial use allowed: the attribution is shown on the screen). Each tile asked for
// (z, x, y in Web Mercator, any zoom) is drawn from the vector tile at min(z, 14) that holds it, overzoomed past 14, on
// an OffscreenCanvas of SIZE px, and sent back as an ImageBitmap.
//
// The style is OSM's map in the home screen's night palette: land, landcover, parks and water first, then rivers,
// boundaries and roads, then the names of places, waters and peaks (each kept only when it lies wholly inside the tile,
// so nothing is cut at a seam). No buildings and no points of interest: the places, the land and the ways across it.
//
// Messages in: {t: 'tile', key, z, x, y} and {t: 'drop', keys} (no longer wanted: dropped from the queue).
// Out: {t: 'tile', key, bitmap} or {t: 'tile', key, error}. Nothing a player typed or where they are goes anywhere but
// the tile requests themselves, which are what any web map asks.

const SIZE = 512, DATA_MAX = 14, PARALLEL = 6, CACHE_MAX = 160;
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const LAYERS = new Set(['water', 'waterway', 'landcover', 'landuse', 'park', 'boundary', 'transportation', 'place', 'water_name', 'mountain_peak', 'aeroway', 'globallandcover']);

const C = {
  land: '#1c2520', water: '#0e2a38', waterLine: '#1f4a5c', ice: '#8fa4ab', sand: '#2e2f26', rock: '#272b28',
  wood: '#18301f', grass: '#1f2f22', farmland: '#232a1f', wetland: '#16302e', park: '#1d3a2633', parkLine: '#2f5a3e',
  residential: '#21252299', boundary: '#8a9a90', state: '#5b6b62', road: ['#9a8a5c', '#857a59', '#6d6a55', '#565a51', '#454b45', '#3a413c'],
  label: '#e6ede7', labelDim: '#b7c4ba', halo: '#0b0f0dd9', waterLabel: '#7fb6c9', peak: '#c9c2a8',
};

let template = null;
const tplP = fetch(TILEJSON).then(r => r.json()).then(j => { template = j.tiles[0]; }).catch(() => { template = null; });
const data = new Map();      // 'z/x/y' of a data tile -> Promise of its decoded layers (LRU by re-insertion)
const queue = [];            // the tiles asked for, oldest first
let running = 0;

onmessage = e => {
  const m = e.data;
  if (m.t === 'tile') { queue.push(m); pump(); }
  else if (m.t === 'drop') { const k = new Set(m.keys); for (let i = queue.length - 1; i >= 0; i--) if (k.has(queue[i].key)) queue.splice(i, 1); }
};

function pump() {
  while (running < PARALLEL && queue.length) {
    const m = queue.shift(); running++;
    draw(m).then(bitmap => postMessage({ t: 'tile', key: m.key, bitmap }, [bitmap]))
      .catch(err => postMessage({ t: 'tile', key: m.key, error: String(err?.message || err) }))
      .finally(() => { running--; pump(); });
  }
}

function dataTile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  let p = data.get(k);
  if (p) { data.delete(k); data.set(k, p); return p; }
  p = tplP.then(async () => {
    if (!template) throw new Error('no map source');
    const r = await fetch(template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    if (r.status === 204 || r.status === 404) return {};   // nothing there (open ocean at some zooms)
    if (!r.ok) throw new Error(`map tile ${r.status}`);
    return decodeTile(new Uint8Array(await r.arrayBuffer()), LAYERS);
  });
  p.catch(() => data.delete(k));
  data.set(k, p);
  while (data.size > CACHE_MAX) data.delete(data.keys().next().value);
  return p;
}

const nameOf = p => p['name:en'] || p['name:latin'] || p.name || '';

async function draw({ z, x, y }) {
  const dz = Math.max(0, z - DATA_MAX), k = 2 ** dz, sx = Math.floor(x / k), sy = Math.floor(y / k);
  const layers = await dataTile(z - dz, sx, sy);
  const cv = new OffscreenCanvas(SIZE, SIZE), g = cv.getContext('2d');
  const ox = x - sx * k, oy = y - sy * k;
  // tile units of the data tile -> this tile's pixels
  const tf = ext => { const s = SIZE * k / ext; return [s, -ox * SIZE, -oy * SIZE]; };
  const path = (f, close) => {
    const [s, tx, ty] = f.tf; g.beginPath();
    for (const r of f.geom) {
      g.moveTo(r[0] * s + tx, r[1] * s + ty);
      for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * s + tx, r[i + 1] * s + ty);
      if (close) g.closePath();
    }
  };
  const each = (name, fn) => { const l = layers[name]; if (!l) return; const t = tf(l.extent); for (const f of l.features) { f.tf = t; fn(f, f.props); } };
  const fill = (f, c) => { path(f, true); g.fillStyle = c; g.fill('evenodd'); };
  const line = (f, c, w, dash = null) => { path(f, false); g.strokeStyle = c; g.lineWidth = w; g.setLineDash(dash || []); g.stroke(); };
  g.lineJoin = 'round'; g.lineCap = 'round';
  // the ground
  g.fillStyle = C.land; g.fillRect(0, 0, SIZE, SIZE);
  const cover = { wood: C.wood, forest: C.wood, grass: C.grass, farmland: C.farmland, wetland: C.wetland, sand: C.sand, rock: C.rock, ice: C.ice, glacier: C.ice };
  each('globallandcover', (f, p) => { if (f.type === 3 && cover[p.class]) fill(f, cover[p.class]); });
  each('landcover', (f, p) => { if (f.type === 3 && cover[p.class]) fill(f, cover[p.class]); });
  each('landuse', (f, p) => { if (f.type === 3 && /^(residential|suburb|neighbourhood|commercial|industrial|retail)$/.test(p.class)) fill(f, C.residential); });
  each('park', f => { if (f.type === 3) { fill(f, C.park); if (z >= 8) line(f, C.parkLine, 1.2); } });
  each('water', (f, p) => { if (f.type === 3 && p.brunnel !== 'tunnel') fill(f, C.water); });
  // the lines over it
  const wz = Math.max(0, z - 8);
  each('waterway', (f, p) => {
    if (f.type !== 2 || p.brunnel === 'tunnel') return;
    const w = p.class === 'river' ? 1 + wz * 0.5 : p.class === 'canal' ? 0.8 + wz * 0.3 : z >= 12 ? 0.6 + (z - 12) * 0.35 : 0;
    if (w > 0) line(f, C.waterLine, w);
  });
  each('boundary', (f, p) => {
    if (f.type !== 2 || p.maritime) return;
    if (p.admin_level === 2) line(f, C.boundary, z < 4 ? 1 : 1.6, p.disputed ? [4, 4] : null);
    else if (p.admin_level === 4 && z >= 4) line(f, C.state, 1.1, [6, 4]);
  });
  const ROADS = { motorway: [0, 5], trunk: [1, 6], primary: [2, 8], secondary: [3, 10], tertiary: [4, 11], minor: [5, 13], service: [5, 15], track: [5, 14], path: [5, 15] };
  const roads = [];
  each('transportation', (f, p) => {
    const r = ROADS[p.class]; if (f.type !== 2 || !r || z < r[1] || p.brunnel === 'tunnel') return;
    roads.push([r[0], f, p]);
  });
  roads.sort((a, b) => b[0] - a[0]);   // the small ways first, the big ones over them
  for (const [rank, f, p] of roads) {
    const w = Math.max(0.6, (3.2 - rank * 0.45) * 2 ** ((z - 12) * 0.45));
    line(f, C.road[rank], Math.min(w, 14), p.class === 'path' || p.class === 'track' ? [3, 4] : null);
  }
  g.setLineDash([]);
  // the names: places by importance, then waters, then peaks; each wholly inside the tile and clear of the others
  const boxes = [], inside = (x0, y0, x1, y1) => x0 >= 3 && y0 >= 3 && x1 <= SIZE - 3 && y1 <= SIZE - 3;
  const label = (text, px, py, font, color, { upper = false, spacing = 0, mark = null } = {}) => {
    if (!text) return;
    const t = upper ? text.toUpperCase() : text;
    g.font = font; g.letterSpacing = `${spacing}px`;
    const w = g.measureText(t).width, h = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]);
    const dy = mark ? -h * 0.9 : 0, x0 = px - w / 2 - 3, y0 = py + dy - h * 0.62 - 2, x1 = px + w / 2 + 3, y1 = py + dy + h * 0.5 + 2;
    if (!inside(x0, mark ? py - 4 : y0, x1, mark ? py + 4 : y1) || !inside(x0, y0, x1, y1)) return;
    if (boxes.some(b => x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1])) return;
    boxes.push([x0, y0, x1, y1]);
    if (mark) mark(px, py);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = Math.max(3, h * 0.22); g.strokeStyle = C.halo; g.strokeText(t, px, py + dy);
    g.fillStyle = color; g.fillText(t, px, py + dy);
  };
  const at = f => { const [s, tx, ty] = f.tf, r = f.geom[0]; return r ? [r[0] * s + tx, r[1] * s + ty] : null; };
  const PLACE = {
    continent: [0, 24, 0, 2, 'bold', true, 3], country: [1, 3, 0, 6, '600', true, 2.5], state: [2, 4, 4, 8, '500', true, 2], city: [3, 4, 6, 99, '600', false, 0],
    town: [4, 8, 9, 99, '500', false, 0], village: [5, 11, 12, 99, '500', false, 0], hamlet: [6, 13, 14, 99, '400', false, 0],
    suburb: [6, 13, 14, 99, '400', false, 0], neighbourhood: [7, 14, 15, 99, '400', false, 0], island: [5, 9, 10, 99, 'italic 500', false, 0],
  };
  const places = [];
  each('place', (f, p) => { const s = PLACE[p.class]; if (s && f.type === 1 && z >= s[1] && z <= s[3]) places.push([s[0], p.rank ?? 99, f, p, s]); });
  places.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [imp, , f, p, s] of places) {
    const xy = at(f); if (!xy) continue;
    const big = z >= s[2];
    const size = [30, 24, 20, 26, 22, 20, 19, 18, 20][imp] * (big ? 1 : 0.85) * (z >= 11 ? 1.3 : 1);   // up close a tile is drawn smaller than its pixels
    const dot = imp >= 3 && imp <= 5 && z < 12 ? (px, py) => { g.fillStyle = C.labelDim; g.beginPath(); g.arc(px, py, 3.2, 0, Math.PI * 2); g.fill(); } : null;
    label(nameOf(p), xy[0], xy[1], `${s[4]} ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`, imp <= 2 ? C.labelDim : C.label, { upper: s[5], spacing: s[6], mark: dot });
  }
  each('water_name', (f, p) => {
    if (f.type !== 1) return; const xy = at(f); if (!xy) return;
    const big = p.class === 'ocean' || p.class === 'sea';
    if (big ? z > 7 : z < 9) return;
    label(nameOf(p), xy[0], xy[1], `italic 500 ${big ? 22 : 23}px system-ui, -apple-system, sans-serif`, C.waterLabel, { spacing: big ? 2 : 0 });
  });
  if (z >= 11) each('mountain_peak', (f, p) => {
    if (f.type !== 1 || p.class !== 'peak' && p.class !== 'volcano') return; const xy = at(f); if (!xy) return;
    const tri = (px, py) => { g.fillStyle = C.peak; g.beginPath(); g.moveTo(px, py - 5); g.lineTo(px + 5, py + 4); g.lineTo(px - 5, py + 4); g.closePath(); g.fill(); };
    label(nameOf(p), xy[0], xy[1], `500 22px system-ui, -apple-system, sans-serif`, C.peak, { mark: tri });
  });
  return cv.transferToImageBitmap();
}
