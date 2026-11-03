// Browser harness for Scavenge (2026-11-02; not part of the client). Load after the world is ready, with the catch
// harness first (scratch/catch_harness.js: window.__ct):
//   const s = document.createElement('script'); s.src = '/scratch/scavenge_harness.js?v=' + Date.now(); document.head.append(s);
// window.__sh: kill(code, d) a prey of that species d m ahead of the body, killed by the player; stages(rec, ages)
// a montage of one carcass at those ages (hours: carrion.age) from a side camera into window.__shot; show() lays the
// last montage over the page for a screenshot, hide() takes it off; frameCost(n) times n renders.
window.__sh = (() => {
  const we = window.__we, A = we.animals, C = window.__ct, K = we.carrion;
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const frames = async n => { for (let i = 0; i < n; i++) await frame(); };
  function kill(code = 'odocoileus_hemionus', d = 4, side = 1.2) {
    const P = we.flight.pos, yaw = we.flight.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let a = C.pick(code, P.x, P.z, b => !b.dead);
    if (!a) { A.summon(code === 'odocoileus_hemionus' ? 'deer' : code, 8); A.update(0.016, A.season, A.hour); a = C.pick(code, P.x, P.z, b => !b.dead); }
    if (!a) return null;
    a.x = P.x + fx * d; a.z = P.z + fz * d; a.y = A.heights.atXZ(a.x, a.z); a.yaw = yaw + side; a.state = 30;
    A.kill(a, 'player');
    return K.byId.get(a.id);
  }
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d'), cam = we.camera.clone();
  // a side view of rec: dist m off, up m high, looking at the carcass
  function aim(rec, dist = 3.2, up = 1.5, ang = 0.9) {
    cam.aspect = we.camera.aspect; cam.fov = 50; cam.near = 0.05; cam.updateProjectionMatrix();
    const g = A.heights.atXZ(rec.x, rec.z), a = rec.yaw + ang;
    cam.position.set(rec.x + Math.sin(a) * dist, g + up, rec.z + Math.cos(a) * dist); cam.lookAt(rec.x, g + 0.25, rec.z); cam.updateMatrixWorld();
  }
  async function stages(rec, ages = [0, 2, 6, 11, 15, 19, 21.5, 23.5], { cols = 4, w = 480, dist = 3.2, up = 1.5, ang = 0.9, feed = null } = {}) {
    const src = we.renderer.domElement, h = Math.round(w * src.height / src.width), rows = Math.ceil(ages.length / cols);
    cv.width = cols * w; cv.height = rows * h; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
    const out = [];
    for (let i = 0; i < ages.length; i++) {
      K.age(ages[i]); if (feed) feed(i);
      K.update(0); await frames(3);
      aim(rec, dist, up, ang); we.renderer.render(we.scene, cam);
      ctx.drawImage(src, (i % cols) * w, Math.floor(i / cols) * h, w, h);
      const label = `${ages[i]} h · ${rec.stage} · decay ${rec.decay.toFixed(2)} · eaten ${(rec.eaten / rec.meat0 * 100).toFixed(0)}%`;
      ctx.fillStyle = '#000a'; ctx.fillRect((i % cols) * w, Math.floor(i / cols) * h, w, 26);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif'; ctx.fillText(label, (i % cols) * w + 8, Math.floor(i / cols) * h + 18);
      out.push(label);
    }
    K.age(0); K.update(0);
    window.__shot = cv.toDataURL('image/jpeg', 0.8);
    return out;
  }
  // a single view from camera c (a function placing `cam`) into window.__shot
  async function shot(place, label = '') {
    await frames(2);
    cam.aspect = we.camera.aspect; cam.fov = 50; cam.near = 0.05; cam.far = 20000; cam.updateProjectionMatrix();
    place(cam); cam.updateMatrixWorld(); we.renderer.render(we.scene, cam);
    const src = we.renderer.domElement; cv.width = src.width; cv.height = src.height; ctx.drawImage(src, 0, 0);
    if (label) { ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, cv.width, 34); ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif'; ctx.fillText(label, 10, 24); }
    window.__shot = cv.toDataURL('image/jpeg', 0.8);
  }
  let img = null;
  function show() { if (!img) { img = document.createElement('img'); Object.assign(img.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', objectFit: 'contain', zIndex: 99999, background: '#000' }); document.body.append(img); } img.src = window.__shot; img.hidden = false; }
  function hide() { if (img) img.hidden = true; }
  // n renders of the scene from the live camera, gl.finish'd: { mean, p50 } ms (CPU and the driver's wait)
  function frameCost(n = 60) {
    const gl = we.renderer.getContext(), t = [];
    for (let i = 0; i < n; i++) { const t0 = performance.now(); we.renderer.render(we.scene, we.camera); gl.finish(); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b); return { mean: +(t.reduce((s, v) => s + v, 0) / n).toFixed(2), p50: +t[n >> 1].toFixed(2), p90: +t[Math.floor(n * 0.9)].toFixed(2) };
  }
  // the body d m straight downwind of rec (the wind blows from the carcass to the nose), facing `face` rad off the line to it
  function downwind(rec, d = 300, face = 1.2) {
    const w = we.scent.wind.windDir.value, l = Math.hypot(w.x, w.y) || 1, x = rec.x + w.x / l * d, z = rec.z + w.y / l * d;
    we.ground.place(x, z); we.flight.yaw = Math.atan2(x - rec.x, z - rec.z) + face;   // yaw 0 faces -z: toward the carcass is atan2(dx, dz) of (body - carcass)
    return { x: Math.round(x), z: Math.round(z), wind: [+(w.x / l).toFixed(2), +(w.y / l).toFixed(2)], strength: +we.scent.wind.windStrength.value.toFixed(2) };
  }
  // the carrion scents the nose has now: { label, strength, bearing (deg, + right), d }
  function smelt() {
    const S = we.scent, P = we.flight.pos;
    return S.smelled.filter(e => e.carrion).map(e => ({ id: e.animal.id, strength: +e.strength.toFixed(2), bearing: Math.round(e.bearing * 180 / Math.PI), d: Math.round(Math.hypot(e.animal.x - P.x, e.animal.z - P.z)),
      label: S.slots.find(s => s.a === e.animal)?.label?.textContent || '' }));
  }
  // walk by the nose: each step turn by the carrion wisp's bearing and go `step` m that way (no knowledge of where the
  // carcass is but the scent); returns the track
  async function follow(step = 12, max = 60) {
    const track = [];
    for (let i = 0; i < max; i++) {
      we.scent.qT = 0; await frames(3);
      const s = smelt()[0]; if (!s) { track.push({ i, lost: true }); break; }
      track.push({ i, d: s.d, strength: s.strength, bearing: s.bearing, label: s.label });
      if (s.d < 3) break;
      const yaw = we.flight.yaw - s.bearing * Math.PI / 180, P = we.flight.pos, go = Math.min(step, Math.max(1, s.d - 2));
      we.ground.place(P.x - Math.sin(yaw) * go, P.z - Math.cos(yaw) * go); we.flight.yaw = yaw;
    }
    return track;
  }
  return { we, A, C, K, kill, stages, shot, show, hide, frames, frameCost, cam, aim, downwind, smelt, follow };
})();
