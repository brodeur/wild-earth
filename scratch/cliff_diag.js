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
// Cost by term (2026-11-03, the cost pass): the terrain alone at a pose, K renders per query, medians; cliffDbg is a
// debug uniform on this branch (x the octave cap, y sheets, z grain, w the second plane), cliffSkip the full-rock skip
window.__cliffProf = async (tile, key, names, n = 24, K = 8) => {
  const H = window.__ww, we = window.__we, U = we.terrain.uniforms; we.setHour(15.5);
  await H.view(...window.__cliffSetPoses(tile)[key]); await H.wait(900);
  const D = { off: [0, 3, 1, 1, 1, 1], all: [1, 3, 1, 1, 1, 1], noSkip: [1, 3, 1, 1, 1, 0], oct2: [1, 2, 1, 1, 1, 1], oct1: [1, 1, 1, 1, 1, 1],
    oct0: [1, 0, 1, 1, 1, 1], noSheets: [1, 3, 0, 1, 1, 1], noGrain: [1, 3, 1, 0, 1, 1], onePlane: [1, 3, 1, 1, 0, 1], bare: [1, 0, 0, 0, 0, 1] };
  const st = names.map(nm => ({ name: nm, apply: () => { const d = D[nm]; U.cliffOn.value = d[0]; U.cliffDbg?.value.set(d[1], d[2], d[3], d[4]); if (U.cliffSkip) U.cliffSkip.value = d[5]; } }));
  const r = await window.__cliffTerrainGpu(st, n, K);
  U.cliffOn.value = 1; U.cliffDbg?.value.set(3, 1, 1, 1); if (U.cliffSkip) U.cliffSkip.value = 1; return r;
};
// Timing with the GPU idle at every query's start (ANGLE/Metal's TIME_ELAPSED also counts work still queued from
// before the begin: a render issued right after another read the other's time too). Per sample: the state applied and
// rendered once untimed (uniforms uploaded, program bound), a fence waited on, then one render inside the query, its
// result waited on before the next. Rounds of all the states; per state its min and median, and the median (and
// quartiles) of its difference from state 0 in the same round.
window.__gpuAB = (states, n = 60, K = 1) => new Promise(res => {
  const we = window.__we, gl = we.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), cam = window.__ww.cam;
  const saved = we.scene.children.map(c => [c, c.visible]); window.__rafPause = true;
  for (const [c] of saved) c.visible = c === we.terrain.group;
  const S = states.length, t = new Float64Array(n * S).fill(NaN); let i = 0, phase = 0, fence = null, q = null;
  const step = () => {
    if (phase === 0) { states[i % S].apply(); we.renderer.render(we.scene, cam); fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); phase = 1; }
    else if (phase === 1) {
      if (gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED) {
        gl.deleteSync(fence); q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        for (let k = 0; k < K; k++) we.renderer.render(we.scene, cam);
        gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush(); phase = 2;
      }
    } else if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) t[i] = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / K;
      gl.deleteQuery(q); i++; phase = 0;
    }
    if (i >= n * S) {
      for (const [c, v] of saved) c.visible = v;
      states[0].apply();
      const qt = (a, f) => { a = a.filter(x => !isNaN(x)).sort((x, y) => x - y); return +(a[Math.floor((a.length - 1) * f)] ?? NaN).toFixed(3); };
      const out = {};
      states.forEach((s, si) => {
        const own = [], d = [];
        for (let j = 0; j < n; j++) { own.push(t[j * S + si]); d.push(t[j * S + si] - t[j * S]); }
        out[s.name] = { min: qt(own, 0), med: qt(own, 0.5), d25: qt(d, 0.25), d50: qt(d, 0.5), d75: qt(d, 0.75) };
      });
      res(out); return;
    }
    const c = new MessageChannel(); c.port1.onmessage = step; c.port2.postMessage(0);
  };
  step();
});
window.__cliffAB = async (tile, key, names, n = 60, K = 1) => {
  const H = window.__ww, we = window.__we, U = we.terrain.uniforms; we.setHour(15.5);
  await H.view(...window.__cliffSetPoses(tile)[key]); await H.wait(600);
  const D = { off: [0, 3, 1, 1, 1, 1], all: [1, 3, 1, 1, 1, 1], noSkip: [1, 3, 1, 1, 1, 0], oct2: [1, 2, 1, 1, 1, 1], oct1: [1, 1, 1, 1, 1, 1],
    oct0: [1, 0, 1, 1, 1, 1], noSheets: [1, 3, 0, 1, 1, 1], noGrain: [1, 3, 1, 0, 1, 1], onePlane: [1, 3, 1, 1, 0, 1], bare: [1, 0, 0, 0, 0, 1] };
  const st = names.map(nm => ({ name: nm, apply: () => { const d = D[nm]; U.cliffOn.value = d[0]; U.cliffDbg?.value.set(d[1], d[2], d[3], d[4]); if (U.cliffSkip) U.cliffSkip.value = d[5]; } }));
  const r = await window.__gpuAB(st, n, K);
  U.cliffOn.value = 1; U.cliffDbg?.value.set(3, 1, 1, 1); if (U.cliffSkip) U.cliffSkip.value = 1; window.__rafPause = true; return r;
};
// Shader variants by define on the terrain's materials (recompiled once each, then cached by three.js): __cliffDef(names)
window.__cliffDef = names => {
  const mats = new Set(); window.__we.terrain.group.traverse(o => { if (o.material?.isShaderMaterial) mats.add(o.material); });
  for (const m of mats) {
    m.defines = m.defines || {}; let ch = false;
    for (const k of Object.keys(m.defines)) if (/^(STUB_|CLIFF_)/.test(k) && !names.includes(k)) { delete m.defines[k]; ch = true; }
    for (const k of names) if (!(k in m.defines)) { m.defines[k] = ''; ch = true; }
    if (ch) m.needsUpdate = true;
  }
};
// states as [name, cliffOn, defines]: the terrain alone at a pose
window.__cliffVar = async (tile, key, list, n = 10, K = 8) => {
  const H = window.__ww, we = window.__we, U = we.terrain.uniforms; we.setHour(15.5);
  await H.view(...window.__cliffSetPoses(tile)[key]); await H.wait(600);
  const st = list.map(([name, on, defs]) => ({ name, apply: () => { window.__cliffDef(defs); U.cliffOn.value = on; } }));
  const r = await window.__gpuAB(st, n, K);
  window.__cliffDef([]); U.cliffOn.value = 1; window.__rafPause = true;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [v.min, v.med, v.d25, v.d50, v.d75].join(' ')]));
};
// The cost pass's final protocol (2026-11-03): per pose the terrain alone with the fine mesh hidden (it follows the
// player, who spawns in different places), the draw calls and triangles, then cliffOn 0 / 1 by __gpuAB (fenced,
// K renders a query, medians)
window.__cliffFinal = async (tile, keys = ['far', 'mid', 'close'], n = 14, K = 8, extra = {}) => {
  const H = window.__ww, we = window.__we, U = we.terrain.uniforms, fine = we.terrain.fine?.mesh, out = {};
  we.setHour(15.5);
  for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(window.__cliffSetPoses(tile)).filter(([k]) => keys.includes(k))), ...extra })) {
    await H.view(...v); await H.wait(600);
    if (fine) fine.visible = false;
    window.__rafPause = true;
    const saved = we.scene.children.map(c => [c, c.visible]); for (const [c] of saved) c.visible = c === we.terrain.group;
    const ar = we.renderer.info.autoReset; we.renderer.info.autoReset = false; we.renderer.info.reset(); we.renderer.render(we.scene, H.cam);
    const calls = we.renderer.info.render.calls, tris = we.renderer.info.render.triangles; we.renderer.info.autoReset = ar;
    for (const [c, vis] of saved) c.visible = vis;
    const r = await window.__gpuAB([{ name: 'off', apply: () => { U.cliffOn.value = 0; } }, { name: 'on', apply: () => { U.cliffOn.value = 1; } }], n, K);
    out[k] = { calls, tris, off: r.off.med, on: r.on.med, d: r.on.d50, q: [r.on.d25, r.on.d75], min: [r.off.min, r.on.min] };
    if (fine) fine.visible = true;
  }
  U.cliffOn.value = 1; window.__rafPause = true;
  return out;
};
