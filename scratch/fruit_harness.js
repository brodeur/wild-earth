// Browser harness for the fruit lane (2026-11-04; not part of the client). Load after the world is ready:
//   const s = document.createElement('script'); s.src = '/scratch/fruit_harness.js?v=' + Date.now(); document.head.append(s);
window.__fr = (() => {
  const we = window.__we, A = we.animals, SP = A.speciesList(), F = we.fruit;
  const frame = () => new Promise(r => { let done = false; requestAnimationFrame(() => { done = true; r(); }); setTimeout(() => { if (!done) r(); }, 400); });
  const wait = async ms => { const t0 = performance.now(); while (performance.now() - t0 < ms) await frame(); };
  // plants of species `id` near the body: the 3D near set and the shrub field's cells (nearest first)
  function find(id, r = 300) {
    const P = we.flight.pos, out = [];
    for (const q of we.veg.nearPlants) if (q.species === id) out.push({ src: '3d', x: q.x, z: q.z, h: q.height, d: Math.hypot(q.x - P.x, q.z - P.z) });
    const SF = we.grass.shrubs;
    for (const [, i, j] of SF.cells || []) {
      const c = SF.cache.get(j * SF.W + i); if (!c) continue;
      for (let q = 0, o = 0; q < c.n; q++, o += 8) {
        const k = c.data[o + 6];
        const sid = k < -0.5 ? window.__frFH[-1 - Math.round(k)] : k > 0.5 && k < 1.5 ? 'arctostaphylos_viscida' : null;
        if (sid === id) out.push({ src: 'imp', x: c.data[o], z: c.data[o + 2], h: c.data[o + 4], R: c.data[o + 3], d: Math.hypot(c.data[o] - P.x, c.data[o + 2] - P.z) });
      }
    }
    return out.filter(o => o.d < r).sort((a, b) => a.d - b.d);
  }
  // the body placed at (x, z), freed from its herd
  function place(x, z) {
    const G = we.ground;
    if (G.herd) { A.pilot(G.herd.g, null); G.herd = null; }
    G.place(x, z); G.auto = false;
    return we.flight.pos.toArray().map(v => +v.toFixed(1));
  }
  // an own camera drawn instead of the chase camera
  const cam = we.camera.clone(); let useCam = false;
  const R0 = we.renderer.render.bind(we.renderer);
  we.renderer.render = (s, c) => R0(s, useCam && c === we.camera ? cam : c);
  function view(x, z, h, tx, tz, th = 0.5) {
    if (x === null) { useCam = false; return null; }
    cam.aspect = we.camera.aspect; cam.fov = we.camera.fov; cam.near = 0.03; cam.far = we.camera.far; cam.updateProjectionMatrix();
    cam.position.set(x, we.tile.heights.atXZ(x, z) + h, z); cam.lookAt(tx, we.tile.heights.atXZ(tx, tz) + th, tz); cam.updateMatrixWorld(); useCam = true;
    return cam.position.toArray().map(v => +v.toFixed(1));
  }
  // the frame's cost with the fruit on and off: alternating rounds of n renders each (readPixels after each)
  function time(n = 25, rounds = 4) {
    const gl = we.renderer.getContext(), px = new Uint8Array(4);
    const run = () => { const ts = []; for (let i = 0; i < 3; i++) { we.renderer.render(we.scene, we.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      for (let i = 0; i < n; i++) { const t0 = performance.now(); we.renderer.render(we.scene, we.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); }
      return ts; };
    const on = [], off = []; let calls = [0, 0];
    for (let r = 0; r < rounds; r++) {
      F.group.visible = true; on.push(...run()); calls[0] = we.renderer.info.render.calls;
      F.group.visible = false; off.push(...run()); calls[1] = we.renderer.info.render.calls;
    }
    F.group.visible = true;
    on.sort((a, b) => a - b); off.sort((a, b) => a - b);
    const q = (t, p) => +t[Math.floor(t.length * p)].toFixed(2);
    return { on: { p10: q(on, 0.1), med: q(on, 0.5) }, off: { p10: q(off, 0.1), med: q(off, 0.5) }, calls, fruitMs: +F.ms.toFixed(3), buildMs: +F.buildMs.toFixed(2), counts: F.counts() };
  }
  // the canvas after a render with the current camera, posted to the scratch capture server (8799)
  async function save(name, q = 0.85) {
    we.renderer.render(we.scene, we.camera); const d = we.renderer.domElement.toDataURL('image/jpeg', q);
    return (await fetch(`http://127.0.0.1:8799/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: d })).text();
  }
  return { find, place, view, wait, time, cam, save };
})();

// A lineup of every fruit model (fruit.js fruitGeometry, from a fresh import so edits show without a reload), k times
// life size, in rows on the ground at (x0, z0), the vegetation hidden; returns the ids in order.
window.__frLineup = async (x0, z0, k = 3, cols = 5, step = 0.34) => {
  const we = window.__we, F = we.fruit, mod = await import('/client/src/fruit.js?v=' + Date.now()), ids = Object.keys(mod.FRUIT_KINDS);
  F.t = 1e9; F.update = () => {}; F.U.body.value.set(x0, z0, 100, 200); F.glow.count = 0;
  for (const m of F.meshes.values()) { m.count = 0; m.visible = false; }
  const t = F.tmp, h = we.tile.heights;
  ids.forEach((id, i) => {
    const m = F.mesh(id); m.geometry.dispose();
    const g = mod.fruitGeometry(id); g.setAttribute('aPlant', new (m.geometry.attributes.aPlant.constructor)(new Float32Array(m.geometry.attributes.aPlant.array.length), 4)); m.geometry = g;
    const r = Math.floor(i / cols), c = i % cols, x = x0 + c * step, z = z0 + r * step, hang = mod.FRUIT_KINDS[id].where !== 'tree';
    t.position.set(x, h.groundXZ(x, z) + (hang ? 0.12 * k : 0.005), z); t.rotation.set(0, 0.5, 0); t.scale.setScalar(k); t.updateMatrix();
    m.setMatrixAt(0, t.matrix); m.setColorAt(0, F.col.setRGB(1, 1, 1)); m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.count = 1; m.visible = true;
  });
  for (const o of [we.veg, we.far]) o.group.visible = false; we.grass.shrubs.enabled = false;
  return ids;
};
