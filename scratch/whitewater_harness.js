// Browser harness for the white-water lane (2026-11-01; not part of the client). Load after the world is ready:
//   const s = document.createElement('script'); s.src = '/scratch/whitewater_harness.js?v=' + Date.now(); document.head.append(s);
// Freezes the spirit at a pose, renders a frame and posts the canvas (a jpeg data url) to a scratch upload server
// (POST http://127.0.0.1:8797/save?name=...; any server that writes its body to a file), so the same poses can be
// captured on two builds. Also times the frame at the pose (render-only, CPU side: gl.finish measures the CPU).
window.__ww = (() => {
  const we = window.__we;
  const frame = () => new Promise(r => { let done = false; requestAnimationFrame(() => { done = true; r(); }); setTimeout(() => { if (!done) r(); }, 400); });
  const wait = async ms => { const t0 = performance.now(); while (performance.now() - t0 < ms) await frame(); };
  // the spirit frozen at (x, north) agl m up, facing yaw (radians, 0 north, clockwise seen from above as flight.js) with pitch
  async function pose(x, north, agl, yaw = 0, pitch = -0.3, settle = 1200) {
    const f = we.flight;
    f.reset(x, -north, agl); f.hover = true; f.speed = 0; f.yaw = yaw; f.pitch = pitch;
    await wait(settle);
    f.yaw = yaw; f.pitch = pitch; f.speed = 0; f.hover = true;
    await frame();
    return { pos: f.pos.toArray().map(v => +v.toFixed(1)), yaw: f.yaw, pitch: f.pitch, agl: f.pos.y - we.tile.heights.atXZ(f.pos.x, f.pos.z) };
  }
  // the spirit frozen at (x, north) agl m up, looking at the point (tx, tn) ty m over the ground there
  async function aim(x, north, agl, tx, tn, ty = 0, settle = 1200) {
    const h = we.tile.heights.atXZ(x, -north) + agl, th = we.tile.heights.atXZ(tx, -tn) + ty;
    const yaw = Math.atan2(tx - x, tn - north), pitch = Math.atan2(th - h, Math.hypot(tx - x, tn - north));
    return pose(x, north, agl, yaw, pitch, settle);
  }
  // an own camera (the flight's is a chase camera behind the bird): the spirit parked hovering at (x, north) so the
  // terrain's fine mesh and the near vegetation follow, the camera at (x, north, h over the ground) looking at
  // (tx, tn, th over the ground); every shot after this uses it until view(null)
  const cam = we.camera.clone(); let useCam = false;
  async function view(x, north, h, tx, tn, th = 0.3, settle = 1200) {
    if (x === null) { useCam = false; return null; }
    const f = we.flight; f.reset(x, -north, Math.max(2, h)); f.hover = true; f.speed = 0;
    await wait(settle);
    cam.aspect = we.camera.aspect; cam.fov = we.camera.fov; cam.near = we.camera.near; cam.far = we.camera.far; cam.updateProjectionMatrix();
    cam.position.set(x, we.tile.heights.atXZ(x, -north) + h, -north);
    cam.lookAt(tx, we.tile.heights.atXZ(tx, -tn) + th, -tn); cam.updateMatrixWorld(); useCam = true;
    await frame();
    return { cam: cam.position.toArray().map(v => +v.toFixed(1)) };
  }
  // render now and return the canvas as a jpeg data url (the drawing buffer is not preserved: render first)
  function shot(q = 0.8) { we.renderer.render(we.scene, useCam ? cam : we.camera); return we.renderer.domElement.toDataURL('image/jpeg', q); }
  async function save(name, q = 0.8, port = 8797) {
    const data = shot(q);
    const r = await fetch(`http://127.0.0.1:${port}/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: data });
    return r.text();
  }
  // n renders back to back, the CPU time per frame (ms): the median and the mean, after a warm-up
  function time(n = 30) {
    const gl = we.renderer.getContext(), ts = [];
    for (let i = 0; i < 5; i++) { we.renderer.render(we.scene, we.camera); gl.finish(); }
    for (let i = 0; i < n; i++) { const t0 = performance.now(); we.renderer.render(we.scene, we.camera); gl.finish(); ts.push(performance.now() - t0); }
    ts.sort((a, b) => a - b);
    return { median: +ts[n >> 1].toFixed(2), mean: +(ts.reduce((a, b) => a + b, 0) / n).toFixed(2), min: +ts[0].toFixed(2), calls: we.renderer.info.render.calls };
  }
  // n renders each followed by a 1x1 readPixels (the readback waits for the GPU, so this includes the GPU's time, which
  // gl.finish on ANGLE/Metal does not): ms per frame, median and mean, with the water drawn and with it hidden
  function timeGpu(n = 40) {
    const gl = we.renderer.getContext(), px = new Uint8Array(4), c = useCam ? cam : we.camera;
    const run = () => { const ts = []; for (let i = 0; i < 5; i++) { we.renderer.render(we.scene, c); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      for (let i = 0; i < n; i++) { const t0 = performance.now(); we.renderer.render(we.scene, c); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); }
      ts.sort((a, b) => a - b); return { median: +ts[n >> 1].toFixed(2), mean: +(ts.reduce((a, b) => a + b, 0) / n).toFixed(2), min: +ts[0].toFixed(2) }; };
    const all = run(); we.water.group.visible = false; const noWater = run(); we.water.group.visible = true; const all2 = run();
    return { all, all2, noWater, calls: we.renderer.info.render.calls };
  }
  // the water shaders' compile diagnostics (a reserved word once cost an hour: 'patch' is one in GLSL ES 3.00)
  function check() {
    const R = we.renderer, out = {};
    for (const [k, m] of [['water', we.water.waterMaterial], ['pond', we.water.pondMaterial], ['bed', we.water.bedMaterial], ['falls', we.waterfalls.material]]) {
      const pr = R.properties.get(m), progs = pr.programs ? [...pr.programs.values()] : [];
      out[k] = progs.map(p => p.diagnostics ? (p.diagnostics.fragmentShader?.log || p.diagnostics.vertexShader?.log || p.diagnostics.programLog || '').slice(0, 300) : 'ok');
    }
    return out;
  }
  // the water's time set, so two captures share the ripple phase
  function setTime(t) { we.water.uniforms.uTime.value = t; }
  return { we, frame, wait, pose, aim, view, shot, save, time, timeGpu, setTime, cam, check };
})();
