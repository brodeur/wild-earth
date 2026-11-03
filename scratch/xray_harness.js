// Scratch harness for the rabbits' dig and the underground view (2026-11-03; not part of the client).
//   const s = document.createElement('script'); s.src = '/scratch/xray_harness.js?v=' + Date.now(); document.head.append(s);
// __xh.save(name): the canvas after the next frame's underground pass, POSTed to the scratch capture server (8811)
// __xh.hold(keys, s), __xh.state(), __xh.gpu(n, K): the underground pass's own GPU time (ms), K passes per timer query
window.__xh = (() => {
  const we = window.__we, D = we.dig, R = we.renderer, A = we.animals;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function save(name) {
    return new Promise(res => {
      const orig = D.xray; D.xray = function (r) { orig.call(D, r); D.xray = orig; const u = R.domElement.toDataURL('image/jpeg', 0.85);
        fetch('http://127.0.0.1:8811/' + name, { method: 'POST', body: u }).then(() => res(name), e => res('err ' + e)); };
    });
  }
  async function hold(keys, s) { const K = we.flight.keys; for (const k of keys) K.add(k); await wait(s * 1000); for (const k of keys) K.delete(k); }
  function state() {
    const P = we.flight.pos, w = D.world;
    return { sp: we.playerSpecies, mode: we.ground.mode, pos: [P.x, P.y, P.z].map(v => +v.toFixed(3)), ground: +A.heights.atXZ(P.x, P.z).toFixed(3),
      hud: we.ground.mode === 'tunnel' ? D.hudText() : document.querySelector('#gcWhere b')?.textContent, xk: +D.xk.toFixed(2),
      nodes: w.nodes.length, segs: w.segs.length, holes: w.nodes.filter(n => n.hole).length, rooms: w.nodes.filter(n => n.room).length, pits: w.pits.length, forms: w.pits.filter(p => p.k === 'form').length,
      net: { conn: D.net.connected, host: D.net.host, pending: D.net.pending.length, ...D.net.stats }, glows: D.xrList.length };
  }
  // GPU: the underground pass alone (D.xray), K times inside one EXT_disjoint_timer_query_webgl2 query per frame, after
  // the world's draw; the median over n frames, per pass. off: the same with the pass's meshes hidden (the floor of an
  // empty render: the traversal's GPU side and the depth clear)
  const gl = R.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  function gpu(n = 40, K = 8, off = false) {   // off: true (all) or a list of 'fade', 'chan', 'body', 'glows'
    return new Promise(res => {
      const out = [], pend = [], orig = D.xray;
      D.xray = function (r) {
        for (let i = pend.length - 1; i >= 0; i--) { const q = pend[i]; if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { const dj = gl.getParameter(ext.GPU_DISJOINT_EXT); const ns = gl.getQueryParameter(q, gl.QUERY_RESULT); gl.deleteQuery(q); pend.splice(i, 1); if (!dj) out.push(ns / 1e6 / K); } }
        if (out.length >= n) { D.xray = orig; orig.call(D, r); out.sort((a, b) => a - b); res({ median: +out[out.length >> 1].toFixed(3), p10: +out[Math.floor(out.length * 0.1)].toFixed(3), n: out.length, K }); return; }
        const pick = { fade: [D.fade], chan: D.xray3, body: [D.xrMesh], glows: [D.blobs] }, sel = off === true ? [D.fade, D.blobs, ...D.xray3, D.xrMesh] : Array.isArray(off) ? off.flatMap(k => pick[k]) : [];
        const hide = sel.filter(Boolean).map(m => [m, m.visible]);
        for (const [m] of hide) m.visible = false;
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        for (let k = 0; k < K; k++) orig.call(D, r);
        gl.endQuery(ext.TIME_ELAPSED_EXT); pend.push(q);
        for (const [m, v] of hide) m.visible = v;
      };
    });
  }
  return { save, hold, state, gpu, wait };
})();
