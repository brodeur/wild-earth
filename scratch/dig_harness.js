// Browser harness for the Dig game (2026-11-02; not part of the client). Load after the world is ready:
//   const s = document.createElement('script'); s.src = '/scratch/dig_harness.js?v=' + Date.now(); document.head.append(s);
// __dh.become('vole' | 'coyote', x, z): summon one near (x, z) and enter it through the spirit, as a player would;
// __dh.hold(keys, s): hold keys (codes) for s seconds of frames; __dh.state(): where the body and the tunnels are;
// __dh.pose(yaw, pitch): the body's heading and the look's pitch (the drag's).
window.__dh = (() => {
  const we = window.__we, D = we.dig, A = we.animals;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function become(kind, x, z) {
    const f = we.flight, g = we.heights?.atXZ?.(x, z) ?? A.heights.atXZ(x, z);
    if (!we.spirit.on) { we.spirit.leave?.(); await wait(300); }
    f.pos.set(x, g + 1.2, z); f.yaw = 0; f.pitch = -0.3;
    await wait(200);
    const made = A.summon(kind, 1.5); if (!made?.length) return 'no summon';
    const a = made[0]; a.x = x; a.z = z - 0.4; a.y = g;
    await wait(100);
    const ok = we.spirit.enter(a.id); if (!ok) return 'no enter';
    await wait(1500); we.ground.place(x, z); f.yaw = 0; f.pitch = 0;
    return we.playerSpecies;
  }
  async function hold(keys, s) { const K = we.flight.keys; for (const k of keys) K.add(k); await wait(s * 1000); for (const k of keys) K.delete(k); }
  function pose(yaw, pitch) { if (yaw !== null && yaw !== undefined) we.flight.yaw = yaw; if (pitch !== null && pitch !== undefined) we.flight.pitch = pitch; }
  function state() {
    const P = we.flight.pos, w = D.world;
    return { sp: we.playerSpecies, mode: we.ground.mode, pos: [P.x, P.y, P.z].map(v => +v.toFixed(3)), hud: we.ground.on && we.ground.mode === 'tunnel' ? D.hudText() : document.querySelector('#gcWhere b')?.textContent,
      nodes: w.nodes.length, segs: w.segs.length, holes: w.nodes.filter(n => n.hole).length, pits: w.pits.length, chamber: w.nodes.filter(n => n.r > 0.05).length,
      net: { conn: D.net.connected, host: D.net.host, pending: D.net.pending.length, ...D.net.stats }, ms: +D.stats.ms.toFixed(3) };
  }
  return { become, hold, pose, state, wait };
})();
// __dh2: voles summoned onto runways beside a point; their states
window.__dh2 = (() => {
  const we = window.__we, A = we.animals;
  function voles(x, z, n = 3) {
    const made = A.summon('vole', 1.5) || [], out = [];
    for (let i = 0; i < n && i < made.length; i++) {
      const a = made[i], ang = i * 2.1;
      a.sx = x + Math.cos(ang) * 0.3; a.sz = z + Math.sin(ang) * 0.3; a.tx = a.sx + Math.cos(ang) * 1.5; a.tz = a.sz + Math.sin(ang) * 1.5;
      a.u = 0.1; a.h = 0.1; a.x = a.sx; a.z = a.sz; a.state = 111; a.t = 30; out.push(a.id);
    }
    return out;
  }
  function states(ids) { return ids.map(id => { const a = A.byId.get(id); return a ? [a.state, +a.x.toFixed(2), +a.y.toFixed(2), +a.z.toFixed(2), !!a.buried, a.tun ? a.tun.i + '/' + a.tun.path.length : a.dig ? 'dig' + a.dig.stage : '-'] : null; }); }
  return { voles, states };
})();
// __dh3.iso(n): the dig meshes' own GPU time (ms per draw): only they are drawn, K times in one timer query
// (EXT_disjoint_timer_query_webgl2), against the same with them hidden; the median of n differences.
// __dh3.camAt(p, t): hold the camera at p looking at t (null: the control's own camera again).
window.__dh3 = (() => {
  const we = window.__we, D = we.dig, R = we.renderer, gl = R.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const S2 = new we.scene.constructor(), K = 10;
  const timeK = (clones, src, vis) => new Promise(res => {
    clones.forEach((c, i) => { c.visible = vis && src[i].visible; });
    const ac = R.autoClear; R.autoClear = false; const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    for (let k = 0; k < K; k++) { R.clearDepth(); R.render(S2, we.camera); }
    gl.endQuery(ext.TIME_ELAPSED_EXT); R.autoClear = ac;
    const poll = () => { if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return setTimeout(poll, 5); const dj = gl.getParameter(ext.GPU_DISJOINT_EXT), ns = gl.getQueryParameter(q, gl.QUERY_RESULT); gl.deleteQuery(q); res(dj ? null : ns / 1e6 / K); };
    poll();
  });
  async function iso(n = 15) {
    const src = [D.tubes.pre, D.rooms.pre, D.tubes, D.rooms, D.bowls, D.heaps].filter(Boolean);
    const clones = src.map(m => { const c = new m.constructor(m.geometry, m.material); c.frustumCulled = false; c.renderOrder = m.renderOrder; S2.add(c); return c; });
    const d = []; for (let i = 0; i < n; i++) { const a = await timeK(clones, src, true), b = await timeK(clones, src, false); if (a !== null && b !== null) d.push(a - b); }
    clones.forEach(c => S2.remove(c)); d.sort((p, q) => p - q); return +d[d.length >> 1].toFixed(3);
  }
  const G = we.ground; G._uc ||= G.updateCamera;
  function camAt(p, t) { if (!p) { G.updateCamera = G._uc; return; } G.updateCamera = function () { const c = we.camera; c.position.set(...p); c.up.set(0, 1, 0); c.lookAt(...t); }; }
  return { iso, camAt };
})();
