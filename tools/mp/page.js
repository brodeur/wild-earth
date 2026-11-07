// Page-side helpers for tools/mp/visibility.mjs, evaluated into a signed-in Wild Earth page as window.__mpt. Reads the
// game's debugging handles (window.__we, window.__weMp, window.__weTitle); nothing here is part of the game.
window.__mpt = (() => {
  const T = {};
  const html = document.documentElement;
  T.uid = () => window.__weMp?.hub?.you?.id || null;
  T.connected = () => !!window.__weMp?.hub?.connected;
  T.inWorld = () => !!(window.__we && window.__weMp?.room?.tileId && !html.classList.contains('opening'));
  T.arriving = () => html.classList.contains('arriving') || html.classList.contains('switching');
  T.form = () => window.__we?.playerSpecies || 'spirit';
  T.season = () => window.__weMp?.room?.season?.now?.()?.season || null;
  T.room = () => ({ tile: window.__weMp?.hub?.room || null, season: window.__weMp?.hub?.roomSeason || null });
  T.pos = () => { const f = window.__we?.flight; return f ? { x: f.pos.x, y: f.pos.y, z: f.pos.z } : null; };
  // What this page draws of user `id`: nothing (seen false), or the slot's form, whether the wisp is shown, whether a
  // body (the remote record) is in the species' pool and drawn, the name label, the edge avatar and the map dot.
  T.vis = id => {
    const P = window.__we?.players, s = P?.slotOf(id);
    if (!s) return { seen: false };
    const rec = s.rec, A = window.__we.animals, m = rec ? A.meshes[rec.sp] : null;
    const drawn = !!(rec && m && m.visible && rec.slot >= 0 && m.instanceMatrix.array[rec.slot * 16 + 15] !== 0);
    return { seen: true, form: s.form, shown: !!s.shown, body: !!rec, drawn, mate: !!s.mate, label: !!s.labelOn, mark: !!s.mark,
      dot: !!P.others[s.i]?.on, tr: s.tr, name: s.name, at: s.D ? { x: s.D.x, y: s.D.y, z: s.D.z } : null };
  };
  T.groupWith = id => !!window.__weMp?.isMate?.(id);
  // The test's spirits touch nothing: a spirit going into whatever animal brushes it (spirit.js touch) would change the
  // case under test. Bodies are entered only by embody().
  T.noTouch = () => { const sp = window.__we?.spirit; if (sp) sp.coolT = 1e9; return true; };
  // The spirit to (x, z), up m over the ground, hovering, facing yaw (rad, the flight's frame) when given.
  T.goto = (x, z, up = 4, yaw = null) => {
    T.noTouch();
    const f = window.__we.flight, g = window.__we.animals.heights.atXZ(x, z);
    f.pos.set(x, g + up, z); f.speed = 0; f.hover = true; f.keys?.clear?.(); f.drag = null; f.camSettled = false;
    if (yaw !== null) { f.yaw = yaw; f.camYaw = yaw; }
    return { x, y: g + up, z };
  };
  // Live, playable animals of a species near (x, z), nearest first.
  T.near = (code, x, z, R = 2500) => {
    const A = window.__we.animals, out = A.within(code, x, A.heights.atXZ(x, z), z, R, []);
    return out.filter(a => !a.dead && !a.remote && !a.culled && A.present(a))
      .map(a => ({ id: a.id, x: a.x, y: a.y, z: a.z, d: Math.hypot(a.x - x, a.z - z) })).sort((p, q) => p.d - q.d);
  };
  // Into the nearest animal of `code` near (x, z) (the spirit's own touch path: spirit.enter), from beside it.
  T.embody = (code, x, z) => {
    if (T.form() !== 'spirit') T.leave();
    const a = T.near(code, x, z)[0]; if (!a) return { ok: false, why: `no ${code} near` };
    const f = window.__we.flight; f.pos.set(a.x + 1.5, a.y + 1.2, a.z); f.speed = 0; f.hover = true;
    const ok = window.__we.spirit.enter(a.id);
    return { ok, id: a.id, x: a.x, y: a.y, z: a.z };
  };
  // How closed the canopy is round (x, z): the tallest lidar canopy (m) at nine points within r m (0 where open).
  T.closed = (x, z, r = 12) => {
    const ch = window.__we.tile?.canopyHeight; if (!ch) return 0;
    let h = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) h = Math.max(h, ch.at(x + i * r, -(z + j * r), 0) * 0.25);
    return h;
  };
  // Deer near (x, z) standing in the open, the most open first.
  T.openDeer = (x, z, R = 2500) => T.near('odocoileus_hemionus', x, z, R).map(a => ({ ...a, h: T.closed(a.x, a.z) })).sort((p, q) => p.h - q.h || p.d - q.d).slice(0, 5);
  T.leave = () => { const r = window.__we.spirit.leave(); T.noTouch(); return r; };
  // The season select, as the player changes it (the group's season goes with it; the room follows, multiplayer.js).
  T.setSeason = v => { const s = document.getElementById('season'); s.value = v; s.dispatchEvent(new Event('change')); return v; };
  T.exit = () => { document.getElementById('exitBtn').click(); return true; };
  T.declineToasts = () => { const b = [...document.querySelectorAll('#followInvite button')].find(x => /Decline/.test(x.textContent)); b?.click(); return !!b; };
  // A camera for the screenshots: { eye: [x, y, z], at: [x, y, z] } or null. Set before players.update (so the names
  // and the wisps face it) and at each render of the world's camera; the game's own camera is back once cleared.
  T.cam = o => {
    window.__mpCam = o;
    const we = window.__we, apply = () => {
      const c = window.__mpCam, cam = window.__we?.camera; if (!c || !cam) return;
      cam.position.set(c.eye[0], c.eye[1], c.eye[2]); cam.lookAt(c.at[0], c.at[1], c.at[2]); cam.updateMatrixWorld(true);
    };
    if (we.players && !we.players.__mpWrapped) { const P = we.players, up = P.update.bind(P); P.update = dt => { apply(); return up(dt); }; P.__mpWrapped = true; }
    const R = we.renderer; if (!R.__mpWrapped) { const rr = R.render.bind(R); R.render = (sc, cam) => { if (cam === window.__we?.camera) apply(); return rr(sc, cam); }; R.__mpWrapped = true; }
    return true;
  };
  // Look at `at` from dist m away on the side of `from` (horizontally), up m higher.
  T.aim = (at, from, dist = 9, up = 2.5) => {
    let dx = from.x - at.x, dz = from.z - at.z; const d = Math.hypot(dx, dz);
    if (d < 0.5) { dx = 0; dz = 1; } else { dx /= d; dz /= d; }
    const ex = at.x + dx * dist, ez = at.z + dz * dist, g = window.__we.animals.heights.atXZ(ex, ez);
    return T.cam({ eye: [ex, Math.max(at.y + up, g + 1.5), ez], at: [at.x, at.y + 0.6, at.z] });
  };
  return T;
})();
true;
