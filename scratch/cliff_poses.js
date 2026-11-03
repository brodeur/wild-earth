// Cliff capture poses (2026-11-02, the cliff-geometry lane) with whitewater_harness.js (window.__ww): window.__cliffPoses()
// and __cliffCapture(prefix, keys, port). Tile utm11n_267_4175 unless noted. Landmarks in tile metres (x east, north):
// El Capitan summit (563, 4589) 2307 m, El Capitan meadow (1207, 3338) 1205 m, Half Dome summit (9808, 5644) 2693 m,
// Mirror Lake (8419, 5804), Yosemite Falls lip (4237, 6996) 1914 m and base (4252, 6252) 1231 m.
window.__cliffPoses = () => ({
  // view: [x, north, h over the ground, target x, target north, target h over its ground]
  c1: { view: [1207, 3338, 60, 750, 4250, 0] },          // El Capitan from the meadow at the raven's height, the whole face 1.4 km off
  c2: { view: [1000, 3700, 1.5, 720, 4250, 0] },         // El Capitan from the valley floor at a deer's eye, the face 650 m off
  c3: { view: [8700, 6300, 700, 9700, 5700, -250] },     // Half Dome's north-west face from the air, 1.2 km off
  c4: { view: [4260, 6250, 60, 4300, 6850, 150] },       // the walls above Yosemite Falls from the valley floor
  c5: { view: [4420, 6500, 40, 4420, 6830, 60] },        // the wall east of the upper fall from 330 m, in the near detail's range
  c6: { view: [9000, 6000, 120, 9450, 5850, -20] },      // Half Dome's base and the NW face from Tenaya canyon, 480 m off (the cliff mesh's range)
});
window.__cliffCapture = async (prefix, keys = null, port = 8798, hour = 15) => {
  const H = window.__ww, we = window.__we, P = window.__cliffPoses(), out = {};
  we.setHour(hour);
  for (const [k, p] of Object.entries(P)) {
    if (keys && !keys.includes(k)) continue;
    const r = await H.view(...p.view);
    await H.wait(600);
    const t = H.timeGpu(20);
    out[k] = { cam: r.cam, saved: await H.save(prefix + '_' + k, 0.85, port), ms: t.all.median, calls: t.calls };
  }
  return out;
};
// a seventh pose: the foot of El Capitan from 70 m at a raven's height, in the near detail's range
// El Capitan's wall in the DEM: the foot at (841, 4049) 1326 m, the rim at (772, 4183) 2164 m, 82-87 degrees between
window.__cliffPoses7 = () => ({
  c7: { view: [956, 3827, 250, 800, 4130, 0] },     // the wall from 330 m, a raven 250 m up, looking up at its lower third
  c8: { view: [870, 3990, 1.5, 820, 4100, 60] },    // a deer's eye 60 m from the foot of the wall
});
window.__cliffCapture7 = async (prefix, port = 8798, hour = 15) => {
  const H = window.__ww, we = window.__we, out = {};
  we.setHour(hour);
  for (const [k, p] of Object.entries(window.__cliffPoses7())) { const r = await H.view(...p.view); await H.wait(600); const t = H.timeGpu(20); out[k] = { cam: r.cam, saved: await H.save(prefix + '_' + k, 0.85, port), ms: t.all.median }; }
  return out;
};
// The home tile (utm10n_680_4280): the foothill outcrops, as the check that nothing else got worse
window.__cliffHome = () => ({
  h1: { view: [2120, 4880, 30, 2020, 4980, 5] },     // the serpentinite bank at (2027, 4970), 68 degrees, from 130 m
  h2: { view: [5700, 9440, 25, 5650, 9535, 5] },     // the granitic outcrop at (5661, 9535), 54 degrees, from 110 m
  h3: { view: [5000, 5000, 60, 5300, 5300, 0] },     // the start, the oak savanna toward the north-east
});
// A capture set by pose list, with and without the cliff material and slabs: prefix_on_* and prefix_off_*
window.__cliffAB = async (prefix, poses, hour = 15, port = 8798) => {
  const H = window.__ww, we = window.__we, out = {};
  we.setHour(hour);
  for (const [k, p] of Object.entries(poses)) {
    const r = await H.view(...p.view); await H.wait(600);
    for (const on of [1, 0]) {
      we.terrain.uniforms.cliffOn.value = on; we.cliffs?.set(!!on); await H.wait(300);
      out[k + (on ? '_on' : '_off')] = { saved: await H.save(`${prefix}_${on ? 'on' : 'off'}_${k}`, 0.85, port) };
    }
  }
  we.terrain.uniforms.cliffOn.value = 1; we.cliffs?.set(true);
  return out;
};
// GPU time of the frame at the current harness pose, per state, alternating (EXT_disjoint_timer_query_webgl2 around
// renderer.render with the harness camera): { p10, med, n } per state, in ms. states: [{ name, apply() }]
window.__cliffGpu = (states, n = 30) => new Promise(res => {
  const we = window.__we, gl = we.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), cam = window.__ww.cam;
  if (!ext) { res({ err: 'no timer query' }); return; }
  const pending = [], results = states.map(() => []); let i = 0;
  const step = () => {
    if (i < n * states.length) {
      const si = i % states.length; states[si].apply();
      const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); we.renderer.render(we.scene, cam); gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push([q, si]); i++;
    }
    for (let k = pending.length - 1; k >= 0; k--) {
      const [q, si] = pending[k];
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) results[si].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); pending.splice(k, 1); }
    }
    if (i >= n * states.length && !pending.length) {
      states[states.length - 1].apply();
      res(Object.fromEntries(states.map((s, k) => { const r = results[k].sort((a, b) => a - b); return [s.name, { p10: +(r[Math.floor(r.length * 0.1)] ?? NaN).toFixed(2), med: +(r[r.length >> 1] ?? NaN).toFixed(2), n: r.length }]; })));
      return;
    }
    setTimeout(step, 15);
  };
  step();
});
window.__cliffStates = () => { const we = window.__we, U = we.terrain.uniforms; return [
  { name: 'old', apply: () => { U.cliffOn.value = 0; we.cliffs.set(false); } },
  { name: 'step1', apply: () => { U.cliffOn.value = 1; we.cliffs.set(false); } },
  { name: 'step2', apply: () => { U.cliffOn.value = 1; we.cliffs.set(true); } },
]; };
// The rims where the rim rule (rims.js) raises the most: the wall west of Yosemite Falls (3600-3670, 6630-6860)
window.__cliffRims = () => ({
  r1: { view: [3650, 6250, 60, 3640, 6800, 0] },     // the rim from the valley floor, 550 m off
  r2: { view: [3250, 6350, 450, 3640, 6800, 0] },    // the rim from the air, 600 m off and level with it
  r3: { view: [6146, 3700, 250, 6146, 4047, 0] },    // the rim near Glacier Point from below
});
