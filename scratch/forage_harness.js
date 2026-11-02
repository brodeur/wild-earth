// Browser harness for the forage lane (2026-11-01; not part of the client). Load after the world is ready:
//   const s = document.createElement('script'); s.src = '/scratch/forage_harness.js?v=' + Date.now(); document.head.append(s);
// Puts the player in a walker at a point (through the spirit's own enter, so needs, the observer and the body scale are
// real), frees it from its herd's pilot, sets its hunger, parks an own camera and posts the canvas to a scratch capture
// server (POST http://127.0.0.1:8798/save?name=...), and times the frame with the forage on and off (readPixels after
// each render: GPU-inclusive).
window.__fh = (() => {
  const we = window.__we, A = we.animals, SP = A.speciesList();
  const frame = () => new Promise(r => { let done = false; requestAnimationFrame(() => { done = true; r(); }); setTimeout(() => { if (!done) r(); }, 400); });
  const wait = async ms => { const t0 = performance.now(); while (performance.now() - t0 < ms) await frame(); };
  const codeOf = a => SP[a.sp]?.code;
  // into the nearest live animal of `code` to (x, z), summoning one ahead of the camera when none is near; the body
  // placed at (x, z) and freed from its herd
  async function body(code, x, z) {
    if (we.spirit.body) { we.spirit.leave(); await wait(300); }
    we.flight.reset(x, z, 30); we.flight.hover = true; we.flight.speed = 0;
    await wait(200);
    let best = null, bd = Infinity;
    for (const a of A.list) { if (codeOf(a) !== code || !A.alive(a)) continue; const d = (a.x - x) ** 2 + (a.z - z) ** 2; if (d < bd) { bd = d; best = a; } }
    if (!best || bd > 400 * 400) { A.summon(code, 12); await wait(300); for (const a of A.list) { if (codeOf(a) !== code || !A.alive(a)) continue; const d = (a.x - x) ** 2 + (a.z - z) ** 2; if (d < bd) { bd = d; best = a; } } }
    if (!best) return 'none';
    if (!we.spirit.enter(best.id)) return 'enter failed';
    await wait(300);
    const G = we.ground;
    if (G.herd) { A.pilot(G.herd.g, null); G.herd = null; }
    G.place(x, z); G.auto = false;
    await wait(300);
    return { id: best.id, code: we.playerSpecies, pos: we.flight.pos.toArray().map(v => +v.toFixed(1)) };
  }
  function hunger(v) { we.needs.hunger = v; return we.needs.hunger; }
  // an own camera at (x, h over the ground, z) looking at (tx, th over the ground, tz); null puts the chase camera back
  const cam = we.camera.clone(); let useCam = false;
  function view(x, z, h, tx, tz, th = 0.3) {
    if (x === null) { useCam = false; return null; }
    cam.aspect = we.camera.aspect; cam.fov = we.camera.fov; cam.near = we.camera.near; cam.far = we.camera.far; cam.updateProjectionMatrix();
    cam.position.set(x, we.tile.heights.atXZ(x, z) + h, z); cam.lookAt(tx, we.tile.heights.atXZ(tx, tz) + th, tz); cam.updateMatrixWorld(); useCam = true;
    return cam.position.toArray().map(v => +v.toFixed(1));
  }
  // the eye of the body: a camera at the head looking ahead and a little down
  function eye(down = 0.25, back = 0) {
    const f = we.flight, S = we.ground.S, P = f.pos, yaw = f.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const h = (S.shoulder || 0.5) * (we.ground.size || 1) * 1.25;
    cam.aspect = we.camera.aspect; cam.fov = we.camera.fov; cam.near = 0.03; cam.far = we.camera.far; cam.updateProjectionMatrix();
    cam.position.set(P.x + fx * ((S.half || 0.3) - back), P.y + h, P.z + fz * ((S.half || 0.3) - back));
    cam.lookAt(P.x + fx * 10, P.y + h - 10 * down, P.z + fz * 10); cam.updateMatrixWorld(); useCam = true;
    return cam.position.toArray().map(v => +v.toFixed(2));
  }
  // the body's mesh hidden for an eye shot (the chase model fills the eye's view)
  let hide = false; function hideBody(on) { hide = !!on; }
  function shot(q = 0.8) {
    const m = we.ground.body?.mesh, was = m ? m.visible : false; if (m && hide) m.visible = false;
    we.renderer.render(we.scene, useCam ? cam : we.camera); const d = we.renderer.domElement.toDataURL('image/jpeg', q);
    if (m) m.visible = was; return d;
  }
  async function save(name, q = 0.8, port = 8798) {
    const data = shot(q);
    const r = await fetch(`http://127.0.0.1:${port}/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: data });
    return r.text();
  }
  // the frame's cost with the forage on and off: alternating rounds of n renders each (readPixels after each), the
  // p10 and median of each, ms
  function time(n = 25, rounds = 4) {
    const gl = we.renderer.getContext(), px = new Uint8Array(4), c = useCam ? cam : we.camera, F = we.forage;
    const run = () => { const ts = []; for (let i = 0; i < 3; i++) { we.renderer.render(we.scene, c); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      for (let i = 0; i < n; i++) { const t0 = performance.now(); we.renderer.render(we.scene, c); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); }
      ts.sort((a, b) => a - b); return ts; };
    const on = [], off = [];
    for (let r = 0; r < rounds; r++) {
      F.enabled = true; F.update(0.016); on.push(...run());
      F.enabled = false; F.update(0.016); off.push(...run());
    }
    F.enabled = true; F.update(0.016);
    on.sort((a, b) => a - b); off.sort((a, b) => a - b);
    const q = (t, p) => +t[Math.floor(t.length * p)].toFixed(2);
    return { on: { p10: q(on, 0.1), med: q(on, 0.5) }, off: { p10: q(off, 0.1), med: q(off, 0.5) }, calls: we.renderer.info.render.calls, forageMs: +F.ms.toFixed(3), scentMs: +we.scent.ms.toFixed(3) };
  }
  // the scents now: name, strength, bearing (deg)
  const smelled = () => we.scent.smelled.map(e => ({ name: e.animal.plant ? e.animal.name : SP[e.animal.sp]?.one, plant: !!e.animal.plant, s: +e.strength.toFixed(2), bearing: Math.round(e.bearing * 180 / Math.PI), d: Math.round(Math.hypot(e.animal.x - we.flight.pos.x, e.animal.z - we.flight.pos.z)) }));
  // the herbs near the body by species, with whether each glows (forage.js weights)
  function herbs(r = 12) {
    const F = we.forbs, out = {}, P = we.flight.pos, buf = F.buf.array, W = we.forage.forbW;
    for (let q = 0; q < F.n; q++) { const o = q * 8, dx = buf[o] - P.x, dz = buf[o + 2] - P.z; if (dx * dx + dz * dz > r * r) continue; const sp = buf[o + 4] | 0, id = F.constructor.name && (window.__forbSpecies || [])[sp]; const k = `${sp}`; out[k] = out[k] || { n: 0, w: +W[sp].toFixed(2) }; out[k].n++; }
    return out;
  }
  return { body, hunger, view, eye, hideBody, shot, save, time, smelled, herbs, wait, frame, cam };
})();
