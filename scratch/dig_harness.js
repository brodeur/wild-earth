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
