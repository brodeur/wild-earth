// Browser harness for the tree-heights lane (2026-11-02; not part of the client). Load after the world is ready:
//   const s = document.createElement('script'); s.src = '/scratch/heights_harness.js?v=' + Date.now(); document.head.append(s);
// Own camera at a pose (the spirit parked there so the near forest and the fine ground follow), a jpeg of the frame
// posted to a scratch receiver (POST http://127.0.0.1:8799/save?name=...), a GPU-inclusive frame time at the pose,
// and histograms of the drawn tree heights per species: the far records (every plant on the tile: the placement's own
// scale times the baked tree's height) and the mid set (the trees within the near forest's radius).
window.__th = (() => {
  const we = window.__we;
  // a yield that hidden tabs do not throttle (rAF stops and timers stretch to a minute there): a MessageChannel task
  const mc = new MessageChannel(), waiters = []; mc.port1.onmessage = () => { const w = waiters.shift(); if (w) w(); };
  const frame = () => new Promise(r => { waiters.push(r); mc.port2.postMessage(0); });
  const wait = async ms => { const t0 = performance.now(); while (performance.now() - t0 < ms) await frame(); };
  const cam = we.camera.clone(); let useCam = false;
  // the spirit parked hovering at (x, north) so the world streams there; the camera h m over the ground at (x, north)
  // looking at (tx, tn) th m over the ground there
  async function view(x, north, h, tx, tn, th = 0.3, settle = 1500) {
    if (x === null) { useCam = false; return null; }
    const f = we.flight; f.reset(x, -north, Math.max(2, h)); f.hover = true; f.speed = 0;
    await wait(settle);
    cam.aspect = we.camera.aspect; cam.fov = we.camera.fov; cam.near = we.camera.near; cam.far = we.camera.far; cam.updateProjectionMatrix();
    cam.position.set(x, we.tile.heights.atXZ(x, -north) + h, -north);
    cam.lookAt(tx, we.tile.heights.atXZ(tx, -tn) + th, -tn); cam.updateMatrixWorld(); useCam = true;
    // the hidden pane runs no frames: stream the world to the pose as main.js's frame does, twice (the far rebuild reads
    // the near forest's radius and the terrain's fine square follows the bird)
    for (let r = 0; r < 2; r++) {
      we.terrain.update(x, -north); we.veg.update(x, -north, true); we.veg.updateClose(cam.position);
      we.sky?.update?.(cam); we.far.update(cam, we.veg.radius); we.rocks?.update?.(cam);
    }
    await frame();
    return { cam: cam.position.toArray().map(v => +v.toFixed(1)), ground: +we.tile.heights.atXZ(x, -north).toFixed(1) };
  }
  // clear: the aerosol haze thinned to a tenth for the shot (the frame loop sets it again next frame), so the far
  // treeline's silhouette shows; set by __thCapture's caller, the same for the before and after sets
  let atmo = null; import('/client/src/atmosphere.js').then(m => { atmo = m.uniforms; });
  const opts = { clear: false };
  function shot(q = 0.85) { if (opts.clear && atmo) atmo.hazeDensity.value *= 0.1; we.renderer.render(we.scene, useCam ? cam : we.camera); return we.renderer.domElement.toDataURL('image/jpeg', q); }
  async function save(name, q = 0.85, port = 8799) {
    const r = await fetch(`http://127.0.0.1:${port}/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: shot(q) });
    return r.text();
  }
  async function saveText(name, text, port = 8799) {
    const r = await fetch(`http://127.0.0.1:${port}/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: text });
    return r.text();
  }
  // n renders each followed by a 1x1 readPixels (waits for the GPU): ms per frame, median / mean / min
  function timeGpu(n = 40) {
    const gl = we.renderer.getContext(), px = new Uint8Array(4), c = useCam ? cam : we.camera, ts = [];
    for (let i = 0; i < 5; i++) { we.renderer.render(we.scene, c); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    for (let i = 0; i < n; i++) { const t0 = performance.now(); we.renderer.render(we.scene, c); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); }
    ts.sort((a, b) => a - b);
    return { median: +ts[n >> 1].toFixed(2), mean: +(ts.reduce((a, b) => a + b, 0) / n).toFixed(2), min: +ts[0].toFixed(2), calls: we.renderer.info.render.calls, tris: we.renderer.info.render.triangles };
  }
  // GPU time of the whole frame at the current camera (EXT_disjoint_timer_query_webgl2): n renders each in its own
  // query, the results read once available; median and quartiles in ms
  async function gpuTime(n = 40) {
    const gl = we.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return null;
    const c = useCam ? cam : we.camera, qs = [];
    for (let i = 0; i < 5; i++) we.renderer.render(we.scene, c);
    for (let i = 0; i < n; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); we.renderer.render(we.scene, c); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
    const calls = we.renderer.info.render.calls, tris = we.renderer.info.render.triangles;   // before any yield: another render may run then
    const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let t = 0; t < 20000 && !gl.getQueryParameter(qs[n - 1], gl.QUERY_RESULT_AVAILABLE); t++) await frame();
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) return { disjoint: true };
    const ms = qs.map(q => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b); qs.forEach(q => gl.deleteQuery(q));
    return { median: +ms[n >> 1].toFixed(2), q1: +ms[n >> 2].toFixed(2), q3: +ms[(3 * n) >> 2].toFixed(2), calls, tris };
  }
  const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0;
  const summarize = (byId, bin = 5) => {
    const out = {};
    for (const [id, arr] of Object.entries(byId)) {
      const a = Float64Array.from(arr).sort(); if (!a.length) continue;
      const h = {}; for (const v of a) { const b = Math.floor(v / bin) * bin; h[b] = (h[b] || 0) + 1; }
      out[id] = { n: a.length, p50: +pct(a, 0.5).toFixed(1), p95: +pct(a, 0.95).toFixed(1), p99: +pct(a, 0.99).toFixed(1), p999: +pct(a, 0.999).toFixed(1), max: +a[a.length - 1].toFixed(1),
        over13: +(a.filter(v => v > pct(a, 0.5) * 1.33).length / a.length * 100).toFixed(2), hist: h };
    }
    return out;
  };
  // Every far record (the whole tile): height = |scale| x the baked tree's own height; shrubs left out
  function farHist(bin = 5) {
    const far = we.far, rec = far.records, S = 8, frames = far.bake.frames, by = {};
    for (let q = 0; q < far.nRecords; q++) {
      const o = q * S, t = rec[o + 5], f = frames[t]; if (!f || f.shrub) continue;
      (by[f.species] ||= []).push(Math.abs(rec[o + 4]) * f.height);
    }
    return summarize(by, bin);
  }
  // The mid set as drawn now (within the near forest's radius): height = entry height x the matrix's y scale
  function midHist(bin = 5) {
    const by = {};
    for (const [id, arr] of Object.entries(we.veg.meshes)) for (const e of arr) {
      const m = e.mid.trunk.instanceMatrix.array;
      for (let i = 0; i < e.mid.n; i++) { const o = i * 16; (by[id] ||= []).push(e.height * Math.hypot(m[o + 4], m[o + 5], m[o + 6])); }
    }
    return summarize(by, bin);
  }
  const fmt = h => Object.entries(h).map(([id, s]) => `${id.padEnd(26)} n ${String(s.n).padStart(7)}  p50 ${String(s.p50).padStart(5)}  p95 ${String(s.p95).padStart(5)}  p99 ${String(s.p99).padStart(5)}  p99.9 ${String(s.p999).padStart(5)}  max ${String(s.max).padStart(5)}  >1.33xp50 ${s.over13}%`).join('\n');
  return { gpuTime, opts, we, cam, wait, frame, view, shot, save, saveText, timeGpu, farHist, midHist, fmt };
})();
