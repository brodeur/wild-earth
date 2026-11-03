// Scratch harness for the eat lane (2026-11-03): close-up montages of a body before and while it eats, posted to a local
// receiver (window.__save). Load after the world is up: s.src = '/scratch/eat_harness.js?v=' + Date.now().
(async () => {
  const THREE = await import('three'); const w = window.__we;
  const cam = window.__shotCam = new THREE.PerspectiveCamera(35, 4 / 3, 0.01, 2000);
  window.__save = async (name, data) => (await fetch('http://127.0.0.1:8797/' + name, { method: 'POST', body: data })).text();
  // a view of target t ({ x, y, z, yaw: the facing, forward -z at 0 }) from fwd m ahead, right m to its right, up m up, looking at look = [ahead, up]
  window.__grabT = (t, view, W = 400, H = 300) => {
    const [fwd, right, up, look] = view, F = [-Math.sin(t.yaw), -Math.cos(t.yaw)], Rt = [-F[1], F[0]], R = w.renderer, c = R.domElement;
    cam.aspect = c.width / c.height; cam.updateProjectionMatrix();
    cam.position.set(t.x + F[0] * fwd + Rt[0] * right, t.y + up, t.z + F[1] * fwd + Rt[1] * right); cam.lookAt(t.x + F[0] * look[0], t.y + look[1], t.z + F[1] * look[0]);
    R.setRenderTarget(null); R.render(w.scene, cam);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'), sw = c.height * W / H;
    g.drawImage(c, (c.width - sw) / 2, 0, sw, c.height, 0, 0, W, H); return cv;
  };
  // eight tiles: one standing, seven eating; eatSet(on) starts and stops the eat, info() the caption
  window.__seqT = async (target, view, label, name, eatSet, info, n = 7, gap = 160, pre = 1500) => {
    eatSet(false); await new Promise(r => setTimeout(r, pre)); const a = [window.__grabT(target(), view), 'standing · ' + info()];
    eatSet(true); const fr = []; for (let i = 0; i < n; i++) { await new Promise(r => setTimeout(r, gap)); fr.push([window.__grabT(target(), view), 'eating · ' + info()]); }
    const out = document.createElement('canvas'); out.width = 1600; out.height = 622; const g = out.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, 1600, 622);
    [a, ...fr].forEach(([c, t], i) => { g.drawImage(c, (i % 4) * 400, 22 + Math.floor(i / 4) * 300); g.fillStyle = '#ff0'; g.font = '13px sans-serif'; g.fillText(t, (i % 4) * 400 + 6, 22 + Math.floor(i / 4) * 300 + 16); });
    g.fillStyle = '#eee'; g.font = '15px sans-serif'; g.fillText(label, 8, 16);
    eatSet(false);
    return window.__save(name, out.toDataURL('image/jpeg', 0.85));
  };
  // the player's body: hold it still on its food (the herd pilot off), E's act kept running while __eat
  window.__playerEat = () => {
    const G = w.ground; clearInterval(window.__hold);
    window.__hold = setInterval(() => { G.idleT = -1e6; G.auto = false; G.actT = window.__eat ? 30 : 0; }, 30);
    return { target: () => ({ x: w.flight.pos.x, y: w.flight.pos.y, z: w.flight.pos.z, yaw: w.flight.yaw }), eatSet: v => { window.__eat = v; }, info: () => `flick ${G.pose.flick.toFixed(2)}` };
  };
  // the nearest cell (15 m steps, 300 m) where one of the body's foods this season scores at least min
  window.__foodNear = (min = 60) => {
    const N = w.needs, P = w.flight.pos, season = w.acorns.season; let best = null;
    for (const r of N.foods(season)) { const g = N.raster(r); if (!g) continue; for (let dx = -300; dx <= 300; dx += 15) for (let dz = -300; dz <= 300; dz += 15) { const v = g.at(P.x + dx, -(P.z + dz), { winter: 0, spring: 1, summer: 2, fall: 3 }[season]); if (v >= min && (!best || Math.hypot(dx, dz) < best.d)) best = { r, v, x: P.x + dx, z: P.z + dz, d: Math.hypot(dx, dz) }; } }
    return best;
  };
  window.__eatHarness = true;
})();
