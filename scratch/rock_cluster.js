// Rock spacing measures (2026-11-03, the rock clustering lane; scratch, not part of the client). Load after
// load_harness.js. __rockPts(x, north, R) gathers the planned rocks (masses, boulders, pebble-tier stones) within R m;
// __rockStats(x, north, R) measures their spacing:
//   ce     Clark-Evans ratio: the mean nearest-neighbour distance over its value for random points of the same density
//          (1 random, > 1 regular, < 1 clustered), points nearer the window's edge than their neighbour skipped
//   vmr    variance over mean of the counts in square quadrats of 10, 30 and 60 m (1 random, < 1 regular, > 1 clustered)
//   g      pair correlation in rings of r (m): pairs per ring over what random points give (1 random; > 1 at small r and
//          < 1 at mid r is clustering)
//   empty  the share of 10 m quadrats with no rock (gaps)
window.__rockPts = (x, north, R, kinds = ['out', 'bould', 'peb']) => {
  const rk = window.__we.rocks, res = rk.res, size = rk.tile.size, W = rk.W, pts = [];
  const i0 = Math.max(0, Math.floor((x - R) / res) - 1), i1 = Math.min(W - 1, Math.floor((x + R) / res) + 1);
  const j0 = Math.max(0, Math.floor((size - north - R) / res) - 1), j1 = Math.min(W - 1, Math.floor((size - north + R) / res) + 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const p = rk.plan(i, j), pp = kinds.includes('peb') ? rk.plan(i, j, 'peb') : null;
    for (const k of ['out', 'bould']) if (p && kinds.includes(k)) for (const r of p[k]) pts.push({ x: r.x, n: -r.z, s: r.s, k });
    if (pp) for (const r of pp) pts.push({ x: r.x, n: -r.z, s: r.s, k: 'peb' });
  }
  return pts.filter(p => (p.x - x) ** 2 + (p.n - north) ** 2 <= R * R);
};
window.__rockStats = (x, north, R, kinds = ['out', 'bould', 'peb'], minS = 0) => {
  const pts = window.__rockPts(x, north, R, kinds).filter(p => p.s >= minS), N = pts.length, A = Math.PI * R * R, lam = N / A;
  if (N < 5) return { n: N };
  // a grid for neighbour queries
  const G = new Map(), cs = 8, key = (a, b) => a * 100003 + b;
  for (const p of pts) { const k = key(Math.floor(p.x / cs), Math.floor(p.n / cs)); (G.get(k) || G.set(k, []).get(k)).push(p); }
  const near = (p, r) => { const out = [], a0 = Math.floor((p.x - r) / cs), a1 = Math.floor((p.x + r) / cs), b0 = Math.floor((p.n - r) / cs), b1 = Math.floor((p.n + r) / cs);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) for (const q of G.get(key(a, b)) || []) if (q !== p) { const d = Math.hypot(q.x - p.x, q.n - p.n); if (d <= r) out.push(d); } return out; };
  // Clark-Evans with edge exclusion
  let sum = 0, cnt = 0;
  for (const p of pts) {
    const edge = R - Math.hypot(p.x - x, p.n - north);
    let nn = Infinity; for (let r = 4; r <= 256 && nn === Infinity; r *= 2) { const d = near(p, r); if (d.length) nn = Math.min(...d); }
    if (nn < edge) { sum += nn; cnt++; }
  }
  const ce = cnt ? (sum / cnt) / (0.5 / Math.sqrt(lam)) : NaN;
  // quadrats inside the square inscribed in the circle
  const vmr = {}, empty = {}, half = R / Math.SQRT2;
  for (const q of [10, 30, 60]) {
    const m = Math.floor(2 * half / q); if (m < 2) continue;
    const c = new Array(m * m).fill(0);
    for (const p of pts) { const a = Math.floor((p.x - x + half) / q), b = Math.floor((p.n - north + half) / q); if (a >= 0 && b >= 0 && a < m && b < m) c[b * m + a]++; }
    const mu = c.reduce((s, v) => s + v, 0) / c.length, va = c.reduce((s, v) => s + (v - mu) ** 2, 0) / (c.length - 1);
    vmr[q] = +(va / Math.max(mu, 1e-9)).toFixed(2); empty[q] = +(c.filter(v => v === 0).length / c.length).toFixed(2);
  }
  // pair correlation in log rings, focal points at least rmax from the edge
  const rings = [0.5, 1, 2, 4, 8, 16, 32, 64], g = {};
  const rmax = rings[rings.length - 1], foc = pts.filter(p => R - Math.hypot(p.x - x, p.n - north) >= rmax);
  if (foc.length) {
    const cnts = new Array(rings.length - 1).fill(0);
    for (const p of foc) for (const d of near(p, rmax)) for (let k = 0; k < rings.length - 1; k++) if (d >= rings[k] && d < rings[k + 1]) { cnts[k]++; break; }
    for (let k = 0; k < rings.length - 1; k++) { const ar = Math.PI * (rings[k + 1] ** 2 - rings[k] ** 2); g[`${rings[k]}-${rings[k + 1]}`] = +(cnts[k] / (foc.length * lam * ar)).toFixed(2); }
  }
  const byKind = {}; for (const p of pts) byKind[p.k] = (byKind[p.k] || 0) + 1;
  return { n: N, perHa: +(lam * 1e4).toFixed(1), byKind, ce: +ce.toFixed(2), vmr, empty, g, focal: foc.length };
};
// A view of the ground at (x, north) from `dist` m off toward azimuth az (degrees east of north), `up` m above it
window.__groundView = (x, north, dist, up, az = 180) => {
  const H = window.__we.tile.heights, a = az * Math.PI / 180, cx = x + Math.sin(a) * dist, cn = north + Math.cos(a) * dist;
  return [cx, cn, H.at(x, north) + up - H.at(cx, cn), x, north, 0];
};
// The verification poses (2026-11-03): Yosemite: the talus at the foot of the north wall above Mirror Lake (low, as a
// hawk), Half Dome's north-west apron (low and high), the valley floor west of it, Mirror Meadow; the home tile: a
// slate slope and a meadow
window.__rockPoses = tile => tile === 'yos' ? {
  mlTalus: [8330.9, 6191.7, 55.16, 8350, 6300, 0], mlLow: __groundView(8363, 6231, 70, 20, 200), mlHigh: __groundView(8350, 6300, 450, 220, 200),
  hdLow: [9110, 5150, 164.1, 9250, 5150, 0], hdHigh: [8805.3, 5006.4, 405.3, 9200, 5150, 0],
  meadow: __groundView(8641, 5854, 150, 25, 200),
} : {
  slope: __groundView(4970, 6660, 120, 25, 180), slopeHigh: __groundView(4970, 6660, 380, 160, 200), slateFace: __groundView(5227, 5617, 120, 25, 180),
  meadow: __groundView(3500, 7600, 150, 25, 180),
};
window.__rockShots = async (prefix, tile, keys = null) => {
  const H = window.__ww, out = {}; window.__we.setHour(15.5); window.__rafPause = false;
  for (const [k, v] of Object.entries(window.__rockPoses(tile))) {
    if (keys && !keys.includes(k)) continue;
    await H.view(...v); await H.wait(1500); out[k] = await H.save(`${prefix}_${k}`, 0.88, 8799);
  }
  return out;
};
// The rocks' GPU cost at a pose: the terrain alone against the terrain and the rocks (__gpuAB's fenced protocol, K
// renders a query, medians), the fine mesh hidden; and the instances drawn (Rocks.drawn) after the bands refilled
window.__rockGpu = async (tile, keys, n = 12, K = 6) => {
  const H = window.__ww, we = window.__we, out = {}, fine = we.terrain.fine?.mesh; we.setHour(15.5);
  for (const [k, v] of Object.entries(window.__rockPoses(tile))) {
    if (keys && !keys.includes(k)) continue;
    window.__rafPause = false; await H.view(...v); await H.wait(1800);
    const drawn = we.rocks.drawn(H.cam);
    if (fine) fine.visible = false;
    const saved = we.scene.children.map(c => [c, c.visible]), rocksG = we.rocks.group;
    const show = r => { for (const [c] of saved) c.visible = c === we.terrain.group || (r && c === rocksG); };
    // __gpuAB hides everything but the terrain group itself; these states set the visibility after it
    const r = await window.__gpuAB([{ name: 'terrain', apply: () => show(false) }, { name: 'rocks', apply: () => show(true) }], n, K);
    for (const [c, vis] of saved) c.visible = vis; if (fine) fine.visible = true;
    out[k] = { drawn, terrain: r.terrain.med, withRocks: r.rocks.med, rocks: r.rocks.d50, q: [r.rocks.d25, r.rocks.d75] };
  }
  window.__rafPause = true;
  return out;
};
// A plan of the placed rocks in a square of side `side` m centred on (x, north): a dot per rock, its radius the rock's
// size (pebble-tier stones grey, boulders and masses dark), the substrate's bare rock pale, saved to the capture server
window.__rockMap = async (name, x, north, side = 300, px = 900, port = 8799) => {
  const pts = window.__rockPts(x, north, side * 0.75), S = window.__we.tile.substrate, k = px / side;
  const c = document.createElement('canvas'); c.width = c.height = px; const g = c.getContext('2d');
  g.fillStyle = '#e9e4d6'; g.fillRect(0, 0, px, px);
  if (S) for (let b = 0; b < px; b += 4) for (let a = 0; a < px; a += 4) {
    const e = S.at(x - side / 2 + a / k, north + side / 2 - b / k, 0); if (e > 128) { g.fillStyle = '#cfd6dc'; g.fillRect(a, b, 4, 4); }
  }
  for (const p of pts) {
    const a = (p.x - x + side / 2) * k, b = (north + side / 2 - p.n) * k; if (a < 0 || b < 0 || a > px || b > px) continue;
    g.fillStyle = p.k === 'peb' ? 'rgba(110,105,95,0.6)' : '#2a2622';
    g.beginPath(); g.arc(a, b, Math.max(0.8, p.s * k * 0.5), 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#000'; g.font = '16px sans-serif'; g.fillText(`${name}  ${side} m  rocks ${pts.length}`, 8, 20);
  const data = c.toDataURL('image/jpeg', 0.9);
  return (await fetch(`http://127.0.0.1:${port}/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: data })).text();
};
