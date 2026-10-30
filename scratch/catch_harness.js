// Browser harness for the catch rigging (2026-10-30; not part of the client). Load after the world is ready:
//   const s = document.createElement('script'); s.src = '/scratch/catch_harness.js?v=' + Date.now(); document.head.append(s);
window.__ct = (() => {
  const we = window.__we, A = we.animals, SP = A.speciesList();
  const K = code => SP.findIndex(s => s.code === code);
  const wait = async ms => { const t0 = performance.now(); if (!rafDead) await new Promise(r => setTimeout(r, ms)); while (performance.now() - t0 < ms) await frame(); };
  // a frame: the page's own (requestAnimationFrame) while it runs; when the pane is off screen the browser gives none, so
  // the world is stepped by hand (step: the animals, the player's control or the spirit's flight) on a timer
  let rafDead = false, lastStep = 0;
  const step = dt => { A.update(dt, A.season || 'fall', A.hour); if (we.ground.on) we.ground.update(dt); else if (we.flier.on) we.flier.update(dt); else we.flight.update(dt); };
  const frame = () => new Promise(r => {
    if (rafDead) { setTimeout(() => { const now = performance.now(), dt = Math.min(0.1, (now - lastStep) / 1000 || 0.03); lastStep = now; step(dt); r(); }, 16); return; }
    let done = false; requestAnimationFrame(() => { done = true; r(); });
    setTimeout(() => { if (!done) { rafDead = true; lastStep = performance.now(); step(0.03); r(); } }, 400);
  });
  const pick = (code, x, z, pred) => { let best = null, bd = Infinity; for (const a of A.list) { if (SP[a.sp].code !== code || a.dead || a.culled || a.gone || (pred && !pred(a))) continue; const d = (a.x - x) ** 2 + (a.z - z) ** 2; if (d < bd) { bd = d; best = a; } } return best; };
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  const cam = we.camera.clone();
  // record frames every `every` s for `dur` s into a montage (window.__shot, a jpeg data url): own camera placed by at(cam, t) each frame, else the live one
  async function record({ dur = 2, every = 0.2, cols = 4, w = 480, at = null, label = '', pre = null, from = 0 } = {}) {
    const src = we.renderer.domElement, h = Math.round(w * src.height / src.width);
    const n = Math.round(dur / every) + 1, rows = Math.ceil(n / cols);
    cv.width = cols * w; cv.height = rows * h; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
    const t0 = performance.now(), out = [];
    for (let i = 0; i < n; i++) {
      const target = t0 + (from + i * every) * 1000;
      while (performance.now() < target) { if (pre) pre((performance.now() - t0) / 1000); await frame(); }
      const t = (performance.now() - t0) / 1000;
      if (at) { cam.aspect = we.camera.aspect; cam.fov = we.camera.fov; cam.near = 0.05; cam.updateProjectionMatrix(); at(cam, t); cam.updateMatrixWorld(); we.renderer.render(we.scene, cam); }
      else we.renderer.render(we.scene, we.camera);
      ctx.drawImage(src, (i % cols) * w, Math.floor(i / cols) * h, w, h);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif'; ctx.fillText(`${label} ${t.toFixed(2)} s${pre ? ' ' + pre(t) : ''}`, (i % cols) * w + 8, Math.floor(i / cols) * h + 20);
      out.push(t.toFixed(2));
    }
    window.__shot = cv.toDataURL('image/jpeg', 0.72);
    return out;
  }
  // a camera that follows body b from a side offset (m), a height, a distance back, looking at it
  const follow = (b, side = 7, up = 2.2, back = 0, lookUp = 0.4) => (c) => {
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    c.position.set(b.x + fz * side - fx * back, b.y + up, b.z - fx * side - fz * back);
    c.lookAt(b.x, b.y + lookUp, b.z);
  };
  // the spirit to (x, z), hovering, the live set rebuilt round it
  async function go(x, z, agl = 6) {
    we.flight.reset(x, z, agl); we.flight.hover = true; we.flight.speed = 0;
    A.dirty = true; await frame(); await frame(); await wait(400); await frame();
  }
  const st = a => ({ state: a.state, x: +a.x.toFixed(1), z: +a.z.toFixed(1), amp: +a.amp.toFixed(2), pose: +a.pose.toFixed(2), roll: +(a.roll || 0).toFixed(2), pitch: +(a.pitch || 0).toFixed(2), dead: !!a.dead, fall: a.fall, hunt: !!a.hunt, rush: a.rush, rolled: a.rolled, lift: +(a.lift || 0).toFixed(2), flick: +a.flick.toFixed(2), e0: a.e0, e1: a.e1 });
  // no prey notices hunter sp (its row of the detection matrix), no watcher calls: a hunt that reaches its prey
  function blind(code) { const h = K(code); for (const row of A.det) row[h] = 0; for (const c in (A.tile.perception?.alarm_calls || {})) A.alarmCool[c] = 1e9; }
  // a hunter set d m behind prey b, facing it, awake, and its hunt started
  function setHunt(h, b, d) {
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    h.x = b.x - fx * d; h.z = b.z - fz * d; h.y = A.heights.atXZ(h.x, h.z); h.yaw = Math.atan2(b.x - h.x, b.z - h.z);
    h.state = 81; h.t = 0; h.pose = 0; h.huntAt = 0; h.cool = 0; h.hunt = null; h.rush = 0; if (h.cs) h.cs.y0 = NaN;
    return A.huntStart(h);
  }
  const C = { we, A, SP, K, wait, frame, pick, record, follow, go, st, cam, blind, setHunt, step, kills: [], get rafDead() { return rafDead; } };
  A.on?.('kill', e => C.kills.push({ ...e, t: performance.now() }));
  // AI lion at a deer herd's leader from d m (the deer blind to lions): the rush, the catch, the fall; a montage following the deer
  C.lionAI = async ({ d = 12, dur = 3.5, every = 0.25, side = 4.5, up = 1.6, hour = 6.5, from = 0, cols = 4, w = 480 } = {}) => {
    we.setHour(hour); __weCarrion.lionCatch = 1; blind('puma_concolor');
    const P = we.flight.pos, lion = pick('puma_concolor', P.x, P.z, a => !a.group || a.group.leader === a); if (!lion) throw new Error('no lion');
    const deer = pick('odocoileus_hemionus', P.x, P.z, a => a.group?.leader === a); if (!deer) throw new Error('no deer');
    deer.group.fleeT = 0; await go(deer.x + 5, deer.z + 5, 3); await wait(800);
    const started = setHunt(lion, deer, d); C.kills.length = 0; const log = [], t0 = performance.now();
    const at = (c, t) => { follow(deer, side, up, -1.5, 0.5)(c); log.push([t.toFixed(2), 'L', lion.state, lion.rush, lion.rolled, 'd', Math.round(Math.hypot(lion.x - deer.x, lion.z - deer.z) * 10) / 10, 'lift', lion.lift.toFixed(2), 'pitch', lion.pitch.toFixed(2), 'pose', lion.pose.toFixed(2), 'flick', lion.flick.toFixed(2), 'e0', (lion.e0 || 0).toFixed(2), 'D', deer.dead ? deer.fall?.toFixed(2) : '-', deer.roll.toFixed(2)].join(' ')); };
    await record({ dur, every, cols, w, at, label: 'AI lion', from });
    return { started, kills: C.kills.map(k => ({ prey: k.prey, by: k.by, at: ((k.t - t0) / 1000).toFixed(2) })), log, lion: st(lion), deer: st(deer) };
  };
  // AI fox at a lizard (the date set to May so lizards are out)
  C.foxLizard = async ({ dur = 3, every = 0.2 } = {}) => {
    we.setDate('05-20'); we.setHour(17); __weCarrion.canidCatch = 1; await wait(1500);
    const P = we.flight.pos; let liz = pick('sceloporus_occidentalis', P.x, P.z, a => a.home && a.vis > 0.5 && a.site?.kind !== 'trunk');
    if (!liz) { const l = pick('sceloporus_occidentalis', P.x, P.z); if (l) { await go(l.x + 3, l.z + 3, 3); await wait(1500); liz = pick('sceloporus_occidentalis', P.x, P.z, a => a.home && a.vis > 0.5 && a.site?.kind !== 'trunk'); } }
    if (!liz) throw new Error('no lizard'); await go(liz.x + 4, liz.z + 2, 2.5); await wait(600);
    const fox = pick('urocyon_cinereoargenteus', liz.x, liz.z, a => !a.group || a.group.leader === a); if (!fox) throw new Error('no fox');
    blind('urocyon_cinereoargenteus'); const started = setHunt(fox, liz, 3.2); C.kills.length = 0; const log = [], t0 = performance.now();
    const at = (c, t) => { follow(liz, 1.6, 0.7, -0.6, 0.05)(c); log.push([t.toFixed(2), 'F', fox.state, 'd', Math.round(Math.hypot(fox.x - liz.x, fox.z - liz.z) * 10) / 10, 'lift', fox.lift.toFixed(2), 'pitch', fox.pitch.toFixed(2), 'flick', fox.flick.toFixed(2), 'pose', fox.pose.toFixed(2), 'L', liz.dead ? liz.fall?.toFixed(2) : '-', liz.roll.toFixed(2), liz.y.toFixed(2)].join(' ')); };
    await record({ dur, every, cols: 4, w: 480, at, label: 'AI fox+lizard' });
    return { started, kills: C.kills.map(k => ({ prey: k.prey, by: k.by, at: ((k.t - t0) / 1000).toFixed(2) })), log, fox: st(fox), liz: st(liz), site: liz.site?.kind, yGround: A.heights.atXZ(liz.x, liz.z).toFixed(2) };
  };
  // the player as the lion (the spirit into the nearest lion), set d m behind a deer herd's leader facing it, Shift+W held:
  // the rush, the leap, the kill at the landing, the feeding crouch; the live chase camera. The deer blind to the player.
  C.lionPlayer = async ({ d = 9, dur = 4, every = 0.25 } = {}) => {
    we.setHour(6.5); const P = we.flight.pos;
    const lion = pick('puma_concolor', P.x, P.z, a => !a.group || a.group.leader === a); if (!lion) throw new Error('no lion');
    const deer = pick('odocoileus_hemionus', P.x, P.z, a => a.group?.leader === a); if (!deer) throw new Error('no deer');
    if (!we.ground.on) { we.spirit.enter(lion.id); await wait(300); }
    C.notice0 ||= A.noticeAt; A.noticeAt = () => 0; deer.group.fleeT = 0;
    const g = we.ground, fx = Math.sin(deer.yaw), fz = Math.cos(deer.yaw);
    P.set(deer.x - fx * d, A.heights.atXZ(deer.x - fx * d, deer.z - fz * d), deer.z - fz * d); we.flight.yaw = Math.atan2(-fx, -fz); g.place(P.x, P.z); g.v = 0;
    await wait(600); C.kills.length = 0; const log = [], t0 = performance.now();
    we.flight.keys.add('KeyW'); we.flight.keys.add('ShiftLeft');
    const tick = t => { const ps = g.pose; log.push([t.toFixed(2), g.mode, 'v', g.v.toFixed(1), 'd', Math.round(Math.hypot(P.x - deer.x, P.z - deer.z) * 10) / 10, 'rush', !!g.rush, 'pitch', ps.pitch.toFixed(2), 'pose', ps.pose.toFixed(2), 'flick', ps.flick.toFixed(2), 'amp', ps.amp.toFixed(2), 'feed', !!g.feeding, 'D', deer.dead ? deer.fall?.toFixed(2) : '-'].join(' ')); return `${g.mode}${g.feeding ? ' feeding' : ''}`; };
    const rel = setInterval(() => { if (C.kills.length) { we.flight.keys.clear(); clearInterval(rel); } }, 30);   // the keys let go at the kill, so the body stays at it
    await record({ dur, every, cols: 4, w: 480, label: 'player lion', pre: tick });
    clearInterval(rel); we.flight.keys.clear();
    return { kills: C.kills.map(k => ({ prey: k.prey, by: k.by, at: ((k.t - t0) / 1000).toFixed(2) })), log, deer: st(deer), feeding: !!g.feeding };
  };
  // an AI canid (hunter code) at small prey (prey code) from d m: the fix, the spring, the kill or the paw strikes; the camera follows the prey
  C.canidAI = async ({ hunter = 'canis_latrans', prey = 'sylvilagus_bachmani', d = 3.0, dur = 3.5, every = 0.15, side = 2.2, up = 0.9, hour = 7, from = 0, cols = 4, w = 480, catchK = 1 } = {}) => {
    we.setHour(hour); __weCarrion.canidCatch = catchK; blind(hunter);
    const P = we.flight.pos, b = pick(prey, P.x, P.z, a => A.huntable(a)); if (!b) throw new Error('no ' + prey);
    const h = pick(hunter, P.x, P.z, a => !a.group || a.group.leader === a); if (!h) throw new Error('no ' + hunter);
    await go(b.x + 3, b.z + 3, 2.5); await wait(600);
    const started = setHunt(h, b, d); C.kills.length = 0; const log = [], t0 = performance.now();
    const at = (c, t) => { follow(b, side, up, -0.8, 0.1)(c); log.push([t.toFixed(2), 'H', h.state, 'd', Math.round(Math.hypot(h.x - b.x, h.z - b.z) * 10) / 10, 'lift', h.lift.toFixed(2), 'pitch', h.pitch.toFixed(2), 'roll', (h.roll || 0).toFixed(2), 'flick', h.flick.toFixed(2), 'pose', h.pose.toFixed(2), 'amp', h.amp.toFixed(2), 'P', b.state, b.dead ? b.fall?.toFixed(2) : '-', (b.roll || 0).toFixed(2)].join(' ')); };
    await record({ dur, every, cols, w, at, label: `AI ${SP[h.sp].one}`, from });
    return { started, kills: C.kills.map(k => ({ prey: k.prey, by: k.by, at: ((k.t - t0) / 1000).toFixed(2) })), log, h: st(h), prey: st(b) };
  };
  // the player as a canid (hunter code), set d m from small prey facing it, E pressed: the fix, the spring, the kill; the live chase camera
  C.canidPlayer = async ({ hunter = 'urocyon_cinereoargenteus', prey = 'sylvilagus_bachmani', d = 2.0, dur = 3.5, every = 0.15, hour = 7, run = false } = {}) => {
    we.setHour(hour); const P = we.flight.pos;
    const h = pick(hunter, P.x, P.z, a => !a.group || a.group.leader === a); if (!h) throw new Error('no ' + hunter);
    const b = pick(prey, P.x, P.z, a => A.huntable(a)); if (!b) throw new Error('no ' + prey);
    if (!we.ground.on || we.ground.code !== hunter) { if (we.ground.on) { we.spirit.leave(); await wait(400); } we.spirit.enter(h.id); await wait(300); }
    C.notice0 ||= A.noticeAt; A.noticeAt = () => 0;
    const g = we.ground, dx = b.x - P.x, dz = b.z - P.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    P.set(b.x - ux * d, A.heights.atXZ(b.x - ux * d, b.z - uz * d), b.z - uz * d); we.flight.yaw = Math.atan2(-ux, -uz); g.place(P.x, P.z); g.v = 0;
    await wait(500); C.kills.length = 0; const log = [], t0 = performance.now();
    if (run) { we.flight.keys.add('KeyW'); we.flight.keys.add('ShiftLeft'); } else g.actQ = true;
    const tick = t => { const ps = g.pose; log.push([t.toFixed(2), g.mode, g.pounce?.ph || '-', 'd', Math.round(Math.hypot(P.x - b.x, P.z - b.z) * 10) / 10, 'y', (P.y - A.heights.atXZ(P.x, P.z)).toFixed(2), 'pitch', ps.pitch.toFixed(2), 'roll', ps.roll.toFixed(2), 'flick', ps.flick.toFixed(2), 'pose', ps.pose.toFixed(2), 'amp', ps.amp.toFixed(2), 'act', g.actT.toFixed(1), 'P', b.dead ? b.fall?.toFixed(2) : '-'].join(' ')); return `${g.mode} ${g.pounce?.ph || ''}`; };
    const rel = setInterval(() => { if (C.kills.length || g.mode === 'pounce') { we.flight.keys.clear(); clearInterval(rel); } }, 30);
    await record({ dur, every, cols: 4, w: 480, label: `player ${SP[h.sp].one}`, pre: tick });
    clearInterval(rel); we.flight.keys.clear();
    return { kills: C.kills.map(k => ({ prey: k.prey, by: k.by, at: ((k.t - t0) / 1000).toFixed(2) })), log, prey: st(b) };
  };
  // an AI hawk sent into a stoop at small prey from `off` m away and `up` m up: the brake, the grab, the mantle; the camera follows the prey
  C.hawkAI = async ({ prey = 'microtus_californicus', off = 45, up = 40, dur = 3.2, every = 0.12, from = 0, side = 2.5, camUp = 1.0, cols = 4, w = 480, catchK = 1 } = {}) => {
    we.setHour(10); __weHunt.hawkCatch = catchK; blind('buteo_jamaicensis');
    const P = we.flight.pos, b = pick(prey, P.x, P.z, a => A.huntable(a)); if (!b) throw new Error('no ' + prey);
    const h = pick('buteo_jamaicensis', P.x, P.z) || A.list.find(a => SP[a.sp].code === 'buteo_jamaicensis'); if (!h) throw new Error('no hawk');
    await go(b.x + 3, b.z + 3, 2.5); await wait(600);
    const ang = Math.random() * Math.PI * 2; h.x = b.x + Math.cos(ang) * off; h.z = b.z + Math.sin(ang) * off; h.y = A.heights.atXZ(h.x, h.z) + up; h.state = 60; h.t = 1e9;
    A.hkStoop(h, b.x, b.z, null, b); C.kills.length = 0; const log = [], t0 = performance.now();
    const at = (c, t) => { const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw); c.position.set(b.x + fz * side, b.y + camUp, b.z - fx * side); c.lookAt(h.x, h.y, h.z); log.push([t.toFixed(2), 'H', h.state, 'u', (h.u || 0).toFixed(2), 'd', Math.round(Math.hypot(h.x - b.x, h.z - b.z) * 10) / 10, 'agl', (h.y - A.heights.atXZ(h.x, h.z)).toFixed(1), 'pitch', h.pitch.toFixed(2), 'pose', h.pose.toFixed(2), 'brake', h.brake, 'e0', (h.e0 || 0).toFixed(2), 'e1', (h.e1 || 0).toFixed(2), 'flick', h.flick.toFixed(2), 'P', b.dead ? b.fall?.toFixed(2) : '-', 'live', A.byId.get(h.id) === h, A.list.includes(h), 'T', A.time.toFixed(1)].join(' ')); };
    await record({ dur, every, cols, w, at, label: 'AI hawk', from });
    return { stoopDur: h.dur, kills: C.kills.map(k => ({ prey: k.prey, by: k.by, at: ((k.t - t0) / 1000).toFixed(2) })), log, h: st(h), prey: st(b) };
  };
  // trap an exception in the animals' frame (the loop dies at the throwing animal and every animal after it freezes)
  C.trap = () => { if (A.__trapped) return; const u = A.update.bind(A); A.__trapped = true; A.update = (...args) => { try { return u(...args); } catch (e) { (window.__errs ||= []).push({ t: A.time, e: String(e.stack || e) }); throw e; } }; };
  // the player as the hawk, put off m away and up m above small prey on a dive toward it at v m/s: the brake, the strike, the mantle; the live chase camera
  C.hawkPlayer = async ({ hunter = 'buteo_jamaicensis', prey = 'lepus_californicus', off = 28, up = 18, v = 20, dur = 3.2, every = 0.12 } = {}) => {
    we.setHour(10); const P = we.flight.pos, f = we.flight;
    const b = pick(prey, P.x, P.z, a => SP[a.sp].code === 'sceloporus_occidentalis' ? (a.home && a.state !== 155 && a.site?.kind !== 'trunk') : A.huntable(a)); if (!b) throw new Error('no ' + prey);
    const h = pick(hunter, P.x, P.z) || A.list.find(a => SP[a.sp].code === hunter); if (!h) throw new Error('no ' + hunter);
    if (!we.flier.on || we.flier.code !== hunter) { if (we.ground.on || we.flier.on || !we.spirit.on) { we.spirit.leave(); await wait(400); } we.spirit.enter(h.id); await wait(300); }
    C.notice0 ||= A.noticeAt; A.noticeAt = () => 0;
    const ang = Math.random() * Math.PI * 2, g = A.heights.atXZ(b.x, b.z);
    f.landed = false; f.hover = false; f.pos.set(b.x + Math.cos(ang) * off, g + up, b.z + Math.sin(ang) * off);
    const dx = b.x - f.pos.x, dz = b.z - f.pos.z; f.yaw = Math.atan2(-dx, -dz); f.pitch = -Math.atan2(up, off); f.speed = v; f.roll = 0; f.cut = true; f.keys.clear();
    C.kills.length = 0; const log = [], t0 = performance.now(), fl = we.flier;
    const tick = t => { const ps = fl.pose; log.push([t.toFixed(2), 'd', Math.round(Math.hypot(f.pos.x - b.x, f.pos.z - b.z) * 10) / 10, 'agl', (f.pos.y - A.heights.atXZ(f.pos.x, f.pos.z)).toFixed(1), 'v', f.speed.toFixed(1), 'pitch', f.pitch.toFixed(2), 'flare', fl.flare.toFixed(2), 'mantle', !!fl.mantle, 'landed', f.landed, 'pose', ps.pose.toFixed(2), 'e0', ps.e0.toFixed(2), 'e1', ps.e1.toFixed(2), 'flick', ps.flick.toFixed(2), 'pecks', fl.pecks || 0, 'gpeck', f.gnd.peck.toFixed(2), 'P', b.dead ? b.fall?.toFixed(2) : '-'].join(' ')); return `${fl.flare > 0 ? 'brake' : ''}${fl.mantle ? 'mantle' : ''}${fl.pecks ? ' pecks ' + fl.pecks : ''}`; };
    await record({ dur, every, cols: 4, w: 480, label: `player ${SP[h.sp].one}`, pre: tick });
    return { kills: C.kills.map(k => ({ prey: k.prey, by: k.by, at: ((k.t - t0) / 1000).toFixed(2) })), log, prey: st(b) };
  };
  // the player as the raven, set down 0.6 m from a lizard (May) or a vole, E: the three stabs and the kill; the live camera
  C.ravenPlayer = async ({ dur = 2.4, every = 0.1, close = false } = {}) => {
    we.setDate('05-20'); we.setHour(15); const P = we.flight.pos, f = we.flight;
    await wait(1200);
    let b = pick('sceloporus_occidentalis', P.x, P.z, a => a.home && a.state !== 155 && a.site?.kind !== 'trunk') || pick('microtus_californicus', P.x, P.z, a => A.huntable(a)); if (!b) throw new Error('no prey');
    const rv = pick('corvus_corax', P.x, P.z) || A.list.find(a => SP[a.sp].code === 'corvus_corax'); if (!rv) throw new Error('no raven');
    if (we.ground.on || we.flier.on) { we.spirit.leave(); await wait(400); }
    if (we.spirit.on) { we.spirit.enter(rv.id); await wait(300); }
    C.notice0 ||= A.noticeAt; A.noticeAt = () => 0;
    const g = A.heights.atXZ(b.x, b.z); f.pos.set(b.x + 0.6, g + 0.3, b.z + 0.3); f.yaw = Math.atan2(-(b.x - f.pos.x), -(b.z - f.pos.z)); f.settleOn(null, Math.max(g, b.y)); f.gnd.yaw = f.yaw;
    await wait(500); C.kills.length = 0; const log = [], t0 = performance.now(); f.actQ = true;
    const tick = t => { const G = f.gnd; log.push([t.toFixed(2), 'stab', G.stab, 'peck', G.peck.toFixed(2), 'peckT', G.peckT, 'flick', we.raven?.g?.flick?.toFixed(2), 'P', b.dead ? b.fall?.toFixed(2) : '-'].join(' ')); return `stab ${G.stab || 0}`; };
    const at = close ? c => { const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw); c.position.set(P.x + fz * 1.1 + fx * 0.3, P.y + 0.35, P.z - fx * 1.1 + fz * 0.3); c.lookAt(P.x + fx * 0.25, P.y - 0.1, P.z + fz * 0.25); } : null;
    await record({ dur, every, cols: 4, w: 480, label: 'player raven', pre: tick, at });
    return { kills: C.kills.map(k => ({ prey: k.prey, by: k.by, at: ((k.t - t0) / 1000).toFixed(2) })), log, prey: st(b) };
  };
  // a still of a body from close by
  C.close = async (b, d = 0.6, up = 0.35, label = 'close') => { const at = c => { c.position.set(b.x + d, b.y + up, b.z + d * 0.8); c.lookAt(b.x, b.y + 0.03, b.z); }; await record({ dur: 0, every: 1, cols: 1, w: 800, at, label }); return st(b); };
  return C;
})();
