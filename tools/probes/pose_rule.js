// The probe poses chosen by rule from the loaded tile's own data (tools/probes/probes.json `_notes` in an entry).
// Load into a page with the world ready, then:
//   await __poseRule.eye(x, north, [tx, tn, th])    -> { pose, ... }  an eye-height pose that shows its cell type
//   await __poseRule.river(x, north, [tx, tn, th])  -> { pose, ... }  on the bank, looking at the drawn river
// Both start from the old pose and move it as little as the rule allows; the view keeps the old bearing.
(() => {
  const W = () => window.__we;
  const median = a => { const b = a.filter(Number.isFinite).sort((p, q) => p - q); return b.length ? b[b.length >> 1] : NaN; };
  // offsets within r on a grid of step, nearest first (the search stops at the first position that meets the rule)
  const offsets = (r, step) => { const o = []; for (let b = -r; b <= r; b += step) for (let a = -r; a <= r; a += step) { const d = Math.hypot(a, b); if (d <= r) o.push([a, b, d]); } return o.sort((p, q) => p[2] - q[2]); };
  const ring = (x, n, r, k = 8) => Array.from({ length: k }, (_, i) => [x + r * Math.cos(2 * Math.PI * i / k), n + r * Math.sin(2 * Math.PI * i / k)]);

  // Eye pose: the cell type the old pose stood in (its species-mix row), at that row's median shrub cover (canopy.png G,
  // the cell's shrub %) with the row's median sward or more at the foot and in the foreground, nowhere under 0.75 of it (the grass the clump placement draws, as grass.js's swardDensity
  // gives it: bare patches, roads, channels and outcrops thin it), away from roads and the water system.
  const EYE = { R_MAX: 300, STEP: 2, FOOT_R: 6, FOOT_MIN: 0.75, SHRUB_TOL: 0.2, SHRUB_TOL_MIN: 3, ROAD_R: 20, WATER_R: 30 };
  async function eye(x0, n0, target) {
    const we = W(), tile = we.tile, mix = tile.speciesMix, can = tile.canopy, grass = we.grass, res = tile.habitat.res, size = tile.size;
    const cell = (x, n) => [Math.floor(x / res), Math.floor((size - n) / res)];
    const rowAt = (x, n) => { const [i, j] = cell(x, n); return mix.at(i, j)?.index ?? null; };
    const row0 = rowAt(x0, n0);
    const N = Math.round(size / res);
    const S = [], G = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if ((mix.at(i, j)?.index ?? null) !== row0) continue;
      S.push(can.channel(i, j, 1));
      let g = 0; for (const a of [0.2, 0.5, 0.8]) for (const b of [0.2, 0.5, 0.8]) g += grass.swardDensity((i + a) * res, size - (j + b) * res);
      G.push(g / 9);
    }
    const sMed = median(S), gMed = median(G), tol = Math.max(EYE.SHRUB_TOL_MIN, EYE.SHRUB_TOL * sMed);
    // the ground the camera sees close up: a disc of FOOT_R round the foot and the foreground along the view (4-16 m,
    // +-20 deg of the old bearing)
    const b0 = Math.atan2(target[1] - n0, target[0] - x0);
    const fore = [4, 8, 12, 16].flatMap(r => [-0.35, 0, 0.35].map(a => [r * Math.cos(b0 + a), r * Math.sin(b0 + a)]));
    const foot = (x, n) => {
      const pts = [[x, n], ...ring(x, n, EYE.FOOT_R / 2), ...ring(x, n, EYE.FOOT_R, 12), ...fore.map(([a, b]) => [x + a, n + b])];
      const v = pts.map(([a, b]) => grass.swardDensity(a, b));
      return [v.reduce((p, q) => p + q, 0) / v.length, Math.min(...v)];
    };
    const clear = (x, n, r, f) => [[x, n], ...ring(x, n, r), ...ring(x, n, r / 2)].every(([a, b]) => f(a, b));
    let best = null;
    for (const [dx, dn, d] of offsets(EYE.R_MAX, EYE.STEP)) {
      if (best) break;
      const x = x0 + dx, n = n0 + dn;
      if (rowAt(x, n) !== row0) continue;
      const [i, j] = cell(x, n); if (Math.abs(can.channel(i, j, 1) - sMed) > tol) continue;
      const [fm, fmin] = foot(x, n); if (fm < gMed || fmin < EYE.FOOT_MIN * gMed) continue;
      if (!clear(x, n, EYE.ROAD_R, (a, b) => !tile.roads || tile.roads.at(a, b) === 0)) continue;
      if (!clear(x, n, EYE.WATER_R, (a, b) => !tile.water || tile.water.zone(a, b) === 0)) continue;
      best = { d, x, n, shrub: can.channel(i, j, 1), foot: fm, footMin: fmin };
    }
    if (!best) return { error: 'no position meets the rule', row: row0, shrubMedian: sMed, swardMedian: gMed };
    const [tx, tn, th] = target;
    const pose = [Math.round(best.x), Math.round(best.n), 1.6, Math.round(best.x + tx - x0), Math.round(best.n + tn - n0), th];
    const oldFoot = foot(x0, n0), [oi, oj] = cell(x0, n0);
    return { pose, row: row0, rowCells: S.length, shrubMedian: sMed, swardMedian: +gMed.toFixed(3), moved_m: +best.d.toFixed(1),
             at: { shrub: best.shrub, foot: +best.foot.toFixed(3), footMin: +best.footMin.toFixed(3) },
             old: { shrub: can.channel(oi, oj, 1), foot: +oldFoot[0].toFixed(3), footMin: +oldFoot[1].toFixed(3) } };
  }

  // River pose: on the bank or terrace (water.png zone 3, 4) of the biggest stream near the old pose (the highest order
  // among the channel cells within ORDER_R), on dry ground (its water level DRY_M or more under the ground within DRY_R)
  // and within SEE_R of the edge of its drawn ribbon, looking at its channel cell between
  // VIEW_R[0] and VIEW_R[1] away whose bearing is nearest the old view's.
  const RIV = { R_MAX: 300, STEP: 1, ORDER_R: 150, DRY_M: 0.1, DRY_R: 3, SEE_R: 25, VIEW_R: [40, 120] };
  async function river(x0, n0, target) {
    const tile = W().tile, wg = tile.water;
    const cells = [];   // channel cells (zone 1) near the old pose, with their order
    const r5 = wg.res;
    for (let dn = -RIV.R_MAX - RIV.VIEW_R[1]; dn <= RIV.R_MAX + RIV.VIEW_R[1]; dn += r5) for (let dx = -RIV.R_MAX - RIV.VIEW_R[1]; dx <= RIV.R_MAX + RIV.VIEW_R[1]; dx += r5) {
      const I = wg.info(x0 + dx, n0 + dn); if (I.zone === 1) cells.push([x0 + dx, n0 + dn, I.order, I.perennial]);
    }
    const order0 = Math.max(...cells.filter(c => Math.hypot(c[0] - x0, c[1] - n0) <= RIV.ORDER_R).map(c => c[2]));
    const main = cells.filter(c => c[2] === order0);
    let best = null;
    for (const [dx, dn, d] of offsets(RIV.R_MAX, RIV.STEP)) {
      if (best) break;
      const x = x0 + dx, n = n0 + dn, I = wg.info(x, n);
      if ((I.zone !== 3 && I.zone !== 4) || I.order !== order0) continue;
      // dry ground: the water level (water.png B) at least DRY_M under the ground here, and on every cell within DRY_R
      if (![[x, n], ...ring(x, n, RIV.DRY_R)].every(([a, b]) => { const o = wg.index(a, b), v = o < 0 ? 0 : wg.d[o * 4 + 2]; return v === 0 || (v - 128) * 0.02 <= -RIV.DRY_M; })) continue;
      // within SEE_R of the edge of the nearest centreline's ribbon (its half width, water_width.png)
      let near = Infinity, nc = null; for (const c of main) { const r = Math.hypot(c[0] - x, c[1] - n); if (r < near) { near = r; nc = c; } }
      const half = nc ? wg.half(nc[0], nc[1]) : 0;
      if (near > half + RIV.SEE_R) continue;
      best = { d, x, n, toWater: near - half, toCentre: near, half };
    }
    if (!best) return { error: 'no bank cell meets the rule', order: order0 };
    const [tx, tn, th] = target, b0 = Math.atan2(tn - n0, tx - x0);
    let tgt = null;
    for (const c of main) {
      const r = Math.hypot(c[0] - best.x, c[1] - best.n); if (r < RIV.VIEW_R[0] || r > RIV.VIEW_R[1]) continue;
      let db = Math.abs(Math.atan2(c[1] - best.n, c[0] - best.x) - b0); db = Math.min(db, 2 * Math.PI - db);
      if (!tgt || db < tgt.db) tgt = { db, x: c[0], n: c[1] };
    }
    if (!tgt) return { error: 'no channel cell in view range', order: order0 };
    const pose = [Math.round(best.x), Math.round(best.n), 1.7, Math.round(tgt.x), Math.round(tgt.n), 0.3];
    return { pose, order: order0, moved_m: +best.d.toFixed(1), toWater_m: +best.toWater.toFixed(1), toCentre_m: +best.toCentre.toFixed(1), half_m: +best.half.toFixed(1),
             bearingChange_deg: +(tgt.db * 180 / Math.PI).toFixed(1), oldZone: wg.zone(x0, n0) };
  }
  window.__poseRule = { eye, river, EYE, RIV };
})();
