// Cliff artifact diagnosis (2026-11-03, the cliff-substrate lane; scratch, not part of the client). After
// whitewater_harness.js and cliff_poses.js: __cliffDiag(prefix, view) renders the pose once per variant, each with
// one source of the square artifacts taken away, and saves them to the scratch upload server.
window.__cliffDiag = async (prefix, v, port = 8799, hour = 16, only = null) => {
  const H = window.__ww, we = window.__we, U = we.terrain.uniforms, out = {};
  we.setHour(hour);
  const black = new (await import('three')).DataTexture(new Uint8Array(4), 1, 1); black.needsUpdate = true;
  const canopy = U.canopyMap.value, csm = U.csmStrength.value;
  const reset = () => { we.rocks.set(true); U.canopyMap.value = canopy; U.csmStrength.value = csm; U.cliffOn.value = 1; we.cliffs?.set(true); };
  const variants = {
    base: () => {},
    noSlabs: () => we.cliffs?.set(false),
    noShadow: () => { U.csmStrength.value = 0; },
    noCanopy: () => { U.canopyMap.value = black; },
    noCliffMat: () => { U.cliffOn.value = 0; },
    noRocks: () => we.rocks.set(false),
    bare: () => { we.cliffs?.set(false); U.csmStrength.value = 0; U.canopyMap.value = black; },
  };
  for (const [k, f] of Object.entries(variants)) {
    if (only && !only.includes(k)) continue;
    reset(); f();
    // step away and back so the far shadow cascades re-render with the change
    await H.view(v[0] + 200, v[1] + 200, v[2], v[3], v[4], v[5], 300);
    await H.view(...v); await H.wait(500);
    out[k] = await H.save(`${prefix}_${k}`, 0.85, port);
  }
  reset();
  return out;
};
// The cliff material's terms one at a time (terrain.js cliffDbg / cliffDbg2, a debug pair on this branch only):
// x tilt (the bulge field), y the 100 m band, z the sheet edges, w the streaks; 2: x the joint layers, z lichen, w photo
window.__cliffTerms = async (prefix, v, port = 8799, hour = 16) => {
  const H = window.__ww, we = window.__we, U = we.terrain.uniforms, out = {};
  we.setHour(hour);
  const T = { base: [1, 1, 1, 1, 1, 1, 1, 1], noTilt: [0, 1, 1, 1, 1, 1, 1, 1], noBand: [1, 0, 1, 1, 1, 1, 1, 1], noEdges: [1, 1, 0, 1, 1, 1, 1, 1],
    noStreak: [1, 1, 1, 0, 1, 1, 1, 1], noJoints: [1, 1, 1, 1, 0, 1, 1, 1], noLichen: [1, 1, 1, 1, 1, 1, 0, 1], noPhoto: [1, 1, 1, 1, 1, 1, 1, 0],
    flat: [0, 0, 0, 0, 0, 1, 0, 0] };
  await H.view(...v); await H.wait(800);
  for (const [k, d] of Object.entries(T)) {
    U.cliffDbg.value.set(d[0], d[1], d[2], d[3]); U.cliffDbg2.value.set(d[4], d[5], d[6], d[7]);
    await H.wait(150); out[k] = await H.save(`${prefix}_${k}`, 0.85, port);
  }
  U.cliffDbg.value.set(1, 1, 1, 1); U.cliffDbg2.value.set(1, 1, 1, 1);
  return out;
};
// A view of the face at (x, north): the camera `dist` m out along the face's horizontal normal (downhill), `up` m
// above the face point's height, looking at it (a view array for H.view)
window.__faceView = (x, north, dist, up = 0, side = 0) => {
  const H = window.__we.tile.heights, at = (a, b) => H.atXZ(a, -b);
  const ge = (at(x + 4, north) - at(x - 4, north)) / 8, gn = (at(x, north + 4) - at(x, north - 4)) / 8, l = Math.hypot(ge, gn) || 1;
  const ox = -ge / l, on = -gn / l, cx = x + ox * dist - on * side, cn = north + on * dist + ox * side;
  const y = at(x, north) + up;
  return [cx, cn, y - at(cx, cn), x, north, 0];
};
// The verification poses (2026-11-03): far (a whole dome or face), mid, close (a raven a few metres off the face), per
// tile; __cliffSet(prefix, tile, port, hour) captures them all with the harness camera
window.__cliffSetPoses = tile => tile === 'yos' ? {
  far: [8700, 6300, 700, 9700, 5700, -250],            // Half Dome's north-west face from the air, 1.2 km off
  far2: [1207, 3338, 60, 750, 4250, 0],                // El Capitan from the meadow, 1.4 km off
  mid: [956, 3827, 250, 800, 4130, 0],                 // El Capitan's wall from 330 m
  close: __faceView(805, 4100, 9, 2, 3),               // El Capitan's wall, 9 m off
} : tile === 'plv' ? {
  far: __faceView(4637, 5147, 260, 30),                // the slate wall of the canyon on utm10n_690_4280 from 260 m
  mid: __faceView(4637, 5147, 60, 10),
  close: __faceView(4637, 5147, 7, 2),
} : {
  far: __faceView(5227, 5617, 220, 30),               // the slate face 600 m north of the start (47 degrees, 32 m tall)
  mid: __faceView(5227, 5617, 45, 8),
  close: __faceView(5227, 5617, 7, 2),                 // a raven 7 m off it
};
window.__cliffSet = async (prefix, tile, port = 8799, hour = 15.5, keys = null) => {
  const H = window.__ww, we = window.__we, out = {}; we.setHour(hour);
  for (const [k, v] of Object.entries(window.__cliffSetPoses(tile))) {
    if (keys && !keys.includes(k)) continue;
    await H.view(...v); await H.wait(900);
    out[k] = { v: v.map(a => +a.toFixed(1)), saved: await H.save(`${prefix}_${k}`, 0.88, port) };
  }
  return out;
};
// GPU time of the frame with the cliff material on and off (cliffOn 1 / 0; 0 is the cheap 2026-10-28 tone rule), and
// the slabs where the build has them, at each pose: p10 and median of n alternating timer-queried renders
window.__cliffTime = async (tile, n = 30, hour = 15.5, keys = null) => {
  const H = window.__ww, we = window.__we, U = we.terrain.uniforms, out = { px: [we.renderer.domElement.width, we.renderer.domElement.height] };
  we.setHour(hour);
  for (const [k, v] of Object.entries(window.__cliffSetPoses(tile))) {
    if (keys && !keys.includes(k)) continue;
    await H.view(...v); await H.wait(900);
    out[k] = await window.__cliffGpu([
      { name: 'off', apply: () => { U.cliffOn.value = 0; we.cliffs?.set(false); } },
      { name: 'on', apply: () => { U.cliffOn.value = 1; we.cliffs?.set(true); } }], n);
  }
  return out;
};
// The terrain alone (every other top-level object hidden), K renders inside one timer query, the states alternating,
// n samples each: the median per render, ms. The cliff material's cost is on - off at the same pose.
window.__cliffTerrainGpu = (states, n = 24, K = 8) => new Promise(res => {
  const we = window.__we, gl = we.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), cam = window.__ww.cam;
  const keep = new Set([we.terrain.group]), saved = we.scene.children.map(c => [c, c.visible]); window.__rafPause = true;
  for (const [c] of saved) c.visible = keep.has(c);
  const pending = [], results = states.map(() => []); let i = 0;
  const step = () => {
    if (i < n * states.length) {
      const si = i % states.length; states[si].apply();
      we.renderer.render(we.scene, cam);   // warm: uniforms uploaded, the state's program bound
      const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      for (let k = 0; k < K; k++) we.renderer.render(we.scene, cam);
      gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push([q, si]); i++;
    }
    for (let k = pending.length - 1; k >= 0; k--) {
      const [q, si] = pending[k];
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) results[si].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / K); gl.deleteQuery(q); pending.splice(k, 1); }
    }
    if (i >= n * states.length && !pending.length) {
      for (const [c, v] of saved) c.visible = v; window.__rafPause = false;
      states[states.length - 1].apply();
      res(Object.fromEntries(states.map((s, k) => { const r = results[k].sort((a, b) => a - b); return [s.name, { min: +(r[0] ?? NaN).toFixed(3), p10: +(r[Math.floor(r.length * 0.1)] ?? NaN).toFixed(3), med: +(r[r.length >> 1] ?? NaN).toFixed(3), n: r.length }]; })));
      return;
    }
    setTimeout(step, 10);
  };
  step();
});
window.__cliffTerrainTime = async (tile, keys = null, hour = 15.5, n = 24) => {
  const H = window.__ww, we = window.__we, U = we.terrain.uniforms, out = { px: [we.renderer.domElement.width, we.renderer.domElement.height] };
  we.setHour(hour);
  for (const [k, v] of Object.entries(window.__cliffSetPoses(tile))) {
    if (keys && !keys.includes(k)) continue;
    await H.view(...v); await H.wait(900);
    out[k] = await window.__cliffTerrainGpu([{ name: 'off', apply: () => { U.cliffOn.value = 0; } }, { name: 'on', apply: () => { U.cliffOn.value = 1; } }], n);
  }
  U.cliffOn.value = 1;
  return out;
};
// profile: the far pose with parts of the cliff material switched off (cliffDbg, a debug uniform on this branch)
window.__cliffProfile = async (tile, key = 'far', n = 40) => {
  const H = window.__ww, we = window.__we, U = we.terrain.uniforms; we.setHour(15.5);
  await H.view(...window.__cliffSetPoses(tile)[key]); await H.wait(900);
  const st = (name, on, d) => ({ name, apply: () => { U.cliffOn.value = on; U.cliffDbg.value.set(...d); } });
  const r = await window.__cliffTerrainGpu([st('off', 0, [1, 1, 1, 1]), st('all', 1, [1, 1, 1, 1]), st('noFacets', 1, [0, 1, 1, 1]), st('noSheets', 1, [1, 0, 1, 1]), st('noLith', 1, [1, 1, 0, 1]), st('bare', 1, [0, 0, 0, 1])], n, 6);
  U.cliffDbg.value.set(1, 1, 1, 1); return r;
};
window.__cliffProfile2 = async (tile, key, names, n = 100, K = 3) => {
  const H = window.__ww, we = window.__we, U = we.terrain.uniforms; we.setHour(15.5);
  await H.view(...window.__cliffSetPoses(tile)[key]); await H.wait(900);
  const D = { off: [0, [1, 1, 1, 1]], all: [1, [1, 1, 1, 1]], noFacets: [1, [0, 1, 1, 1]], noSheets: [1, [1, 0, 1, 1]], noLith: [1, [1, 1, 0, 1]], noLichen: [1, [1, 1, 1, 0]], bare: [1, [0, 0, 0, 0]] };
  const st = names.map(nm => ({ name: nm, apply: () => { U.cliffOn.value = D[nm][0]; if (U.cliffDbg) U.cliffDbg.value.set(...D[nm][1]); } }));
  const r = await window.__cliffTerrainGpu(st, n, K);
  U.cliffOn.value = 1; U.cliffDbg?.value.set(1, 1, 1, 1); return r;
};
