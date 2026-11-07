import * as THREE from 'three';
import { DEN_R_MAX, DEN_REACH, DEN_AT } from './dig.js';

// Dens (Aaron, 2026-11-06: "For diggers, once they are underground a new control appears. The 1 key "dig den" which
// makes a large area. Dens that overlap should have empty space. When you click build den, the den shape appears in a
// green silhouette, attached to the mouse, its location fixed below the surface, but tracking the mouse. You can place
// the den anywhere connected to a tunnel. Digging the den is a process that can be interrupted, and returned
// to/completed."). docs/game-dig.md "Dens".
//
// A den is a room node of the tunnels (dig.js applyEvent 'den', 'denk'; digworld.py the same), planned off the tunnel
// node `at` nearest its centre: it starts where `at` stands, at its bore, and as it is dug (k 0..1) its centre moves to
// the plan's and its radius grows to the plan's (dig.js denPlace), so the cavity grows out of the tunnel and is joined
// to it from the first moment. The carving draws it as any room (digCarve.js: an ellipsoid r, 0.8 r, r in the soil),
// so two dens that overlap are one cavity (the carved air is a union), and a finished den joins every finished den it
// overlaps with a segment, so the merged cavity is walked through.
//
// The player (a tunneller underground, DIGGERS kind 'tunnel' with a `den`): 1 (or the slot) shows the den's
// silhouette (green where it would join a tunnel, red where it would not) at the species' depth under the ground the
// mouse points at; a click places it (the `den` event), Esc, a right click or 1 again puts it away. Placed within
// reach of the body, the digging starts at once; elsewhere the plan waits (its outline drawn) until the body walks up
// to it and presses 1 or holds the dig key there. The digging is a process: DIG_S seconds (the species' den.s) of the
// body at work, the plan's progress sent every K_STEP (`denk`, so every page sees the cavity grow), stopped by a move
// key, E, F, X, Space, leaving the tunnel or the body, or a coyote opening the system from above; 1 or the dig key at
// the plan again resumes it from where it was left. The slot's sweep and the HUD show the progress.

const K_STEP = 0.02;          // the progress sent in steps of this (50 events a den)
const NEAR = 0.06;            // m past the den's surface and the body's own bore within which the body digs it
const PLAN_R = 15;            // m: the plans within this of the body have their outline drawn
const OUTLINES = 8;
const XR = 5;                 // dig.js XR: the underground view's layer
const OK_COL = new THREE.Color(0.25, 1.0, 0.4), BAD_COL = new THREE.Color(1.0, 0.25, 0.2), PLAN_COL = new THREE.Color(0.3, 0.9, 0.45);
const STOP_KEYS = ['KeyE', 'KeyF', 'KeyX', 'Space'];

export class Dens {
  constructor(dig) {
    this.dig = dig; this.placing = null; this.job = null; this.kLocal = new Map(); this.mouse = new THREE.Vector2(0, -0.3); this.ray = new THREE.Raycaster();
    const geo = new THREE.SphereGeometry(1, 28, 18);
    const mat = (col, op) => new THREE.MeshBasicMaterial({ color: col.clone(), transparent: true, opacity: op, depthTest: false, depthWrite: false });
    // the silhouette being placed: a filled ellipsoid and its wire
    this.sil = new THREE.Group(); this.sil.visible = false; this.sil.name = 'den silhouette';
    this.silFill = new THREE.Mesh(geo, mat(OK_COL, 0.22)); this.silWire = new THREE.Mesh(geo, Object.assign(mat(OK_COL, 0.55), { wireframe: true }));
    for (const m of [this.silFill, this.silWire]) { m.layers.set(XR); m.renderOrder = 8; m.frustumCulled = false; this.sil.add(m); }
    this.sil.layers.set(XR); dig.scene.add(this.sil);
    // the plans not yet dug out: their remaining outline
    this.outlines = [];
    for (let i = 0; i < OUTLINES; i++) { const m = new THREE.Mesh(geo, Object.assign(mat(PLAN_COL, 0.3), { wireframe: true })); m.layers.set(XR); m.renderOrder = 7; m.frustumCulled = false; m.visible = false; m.name = 'den plan'; dig.scene.add(m); this.outlines.push(m); }
    this.onMove = e => { this.mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); };
    this.onDown = e => {   // while placing, a click places and a right click puts it away; neither reaches the camera or the identify click
      if (!this.placing || e.target?.tagName !== 'CANVAS') return;
      e.stopImmediatePropagation(); e.preventDefault(); this.swallow = true;   // (and the click or menu that follows)
      this.onMove(e);
      if (e.button === 2) this.cancel(); else if (e.button === 0) this.place();
    };
    this.onBlock = e => { if ((this.placing || this.swallow) && e.target?.tagName === 'CANVAS') { e.stopImmediatePropagation(); e.preventDefault(); this.swallow = false; } };
    this.onKey = e => {
      if (e.repeat || (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA'))) return;
      // (on the capture: underground 1 is the den's, not a strike's; Esc puts the den away, not the hunt's target)
      if (e.code === 'Digit1' && this.can()) { e.stopImmediatePropagation(); e.preventDefault(); this.press(); }
      else if (e.code === 'Escape' && this.placing) { e.stopImmediatePropagation(); this.cancel(); }
    };
    addEventListener('pointermove', this.onMove); addEventListener('pointerdown', this.onDown, true);
    addEventListener('click', this.onBlock, true); addEventListener('contextmenu', this.onBlock, true); addEventListener('keydown', this.onKey, true);
  }
  // the den this body digs (DIGGERS den), when it is a tunneller underground
  spec() { const g = this.dig.gc, D = g.on && g.mode === 'tunnel' && this.dig.tun ? this.dig.DIGGERS[g.code] : null; return D?.kind === 'tunnel' && D.den ? D : null; }
  can() { return !!this.spec(); }
  // 1 (or the slot): put the silhouette away; or resume a plan within reach; or take the silhouette out
  press() {
    if (this.placing) return this.cancel();
    if (!this.spec()) return;
    const n = this.planNear();
    if (n && !this.job) { this.start(n, 'back at the den: digging'); return; }
    this.stop(null); this.placing = { ok: false, at: null, c: new THREE.Vector3(), r: this.spec().den.r };
    this.dig.gc.say('dig den: point where it goes (green joins a tunnel), click to place, Esc to put it away');
  }
  cancel() { if (!this.placing) return; this.placing = null; this.sil.visible = false; }
  // the planned den (k < 1) the body is at: within NEAR of its surface (as dug so far) past its own bore
  planNear() {
    const dig = this.dig, T = dig.tun, S = this.spec(); if (!T || !S) return null;
    const Q = dig.axisAt(T, this._q ||= new THREE.Vector4());
    let best = null, bd = Infinity;
    for (const n of dig.world.nodes) {
      if (!n.den || n.den.k >= 1) continue;
      const d = Math.hypot(n.x - Q.x, n.y - Q.y, n.z - Q.z) - n.r - S.r;
      if (d < NEAR && d < bd) { bd = d; best = n; }
    }
    return best;
  }
  // where the silhouette goes: the ground the mouse points at (marched along the camera's ray), the species' depth under it
  aim() {
    const P = this.placing, dig = this.dig, S = this.spec(); if (!P || !S) return;
    this.ray.setFromCamera(this.mouse, dig.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction; let hit = null, t0 = 0;
    for (let t = 0.25; t < 40; t += 0.25) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= dig.groundY(x, z)) { let a = t0, b = t; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (o.y + d.y * m <= dig.groundY(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; } hit = b; break; }
      t0 = t;
    }
    if (hit === null) { P.ok = false; P.at = null; this.sil.visible = false; return; }
    const x = o.x + d.x * hit, z = o.z + d.z * hit, r = S.den.r;
    P.c.set(x, dig.groundY(x, z) - S.den.depth, z); P.r = r;
    // it joins the dug space it overlaps most (a tunnel's node within its radius and a little, a room or a finished den
    // it overlaps; not a den still being dug), within DEN_REACH of its centre
    let at = null, bd = Infinity;
    for (const n of dig.world.nodes) {
      if (n.den && n.den.k < 1) continue;
      const dd = Math.hypot(n.x - x, n.y - P.c.y, n.z - z); if (dd > DEN_REACH || dd > r + Math.max(0.12, n.r * 0.9)) continue;
      if (dd - n.r < bd) { bd = dd - n.r; at = n; }
    }
    P.at = at; P.ok = !!at && r <= DEN_R_MAX;
    this.sil.visible = true; this.sil.position.copy(P.c); this.sil.scale.set(r, r * 0.8, r);
    const col = P.ok ? OK_COL : BAD_COL; this.silFill.material.color.copy(col); this.silWire.material.color.copy(col);
    this.silFill.material.opacity = P.ok ? 0.22 : 0.12; this.silWire.material.opacity = P.ok ? 0.55 : 0.3;
  }
  // the click: the plan sent; dug at once when the body is at it
  place() {
    const P = this.placing, dig = this.dig, S = this.spec(); if (!P || !S) return;
    this.aim();
    if (!P.ok) { dig.gc.say('a den has to join a tunnel: move it over one'); return; }
    const a = P.at, id = dig.newId(), seg = dig.newId();
    const e = { type: 'den', id, seg, at: a.id, x: P.c.x, y: P.c.y, z: P.c.z, r: P.r, ax: a.x, ay: a.y, az: a.z, ar: Math.min(a.r, 0.12) };
    if (Math.hypot(a.x - e.ax, a.y - e.ay, a.z - e.az) > DEN_AT || !dig.dispatch(e)) { dig.gc.say('the den could not be placed there'); return; }
    this.placing = null; this.sil.visible = false;
    const n = dig.node(id), near = this.planNear();
    if (near === n) this.start(n, 'digging the den'); else dig.gc.say('the den is planned: go to its outline and press 1 (or hold Q) to dig it');
  }
  start(n, say) { this.job = { id: n.id }; this.dig.gc.say(say); }
  stop(why) { if (!this.job) return; this.job = null; if (why) this.dig.gc.say(why); }
  // what the slot and the HUD show: the den being dug, or at hand (its id, progress)
  progress() { const n = this.job ? this.dig.node(this.job.id) : this.planNear(); if (!n?.den) return null; return Math.max(n.den.k, this.kLocal.get(n.id) || 0); }
  // one frame in the tunnel (dig.js tunnelStep, before its own dig): k its keys, held the dig key. true while the den
  // is dug this frame (the body in the digging pose, no tunnel dug)
  step(dt, k, held) {
    const dig = this.dig, S = this.spec(); if (!S) { this.stop(null); return false; }
    const K = dig.gc.flight.keys;
    if (this.job && (k.fwd || k.turn || STOP_KEYS.some(c => K.has(c)))) this.stop('the den left for now: 1 or Q at it goes on');
    const n = this.job ? dig.node(this.job.id) : held ? this.planNear() : null;
    if (!n?.den || n.den.k >= 1) { if (this.job) this.stop(null); return false; }
    if (this.job && this.planNear() !== n) { this.stop('too far from the den to dig it'); return false; }
    // the work: DIG_S s of it in all, the progress sent in K_STEP steps
    let kl = Math.max(n.den.k, this.kLocal.get(n.id) || 0);
    kl = Math.min(1, kl + dt * dig.mult / S.den.s); this.kLocal.set(n.id, kl);
    const send = kl >= 1 ? 1 : Math.floor(kl / K_STEP) * K_STEP;
    if (send > n.den.k + 1e-6) dig.dispatch({ type: 'denk', id: n.id, k: +send.toFixed(3) });
    const dx = n.den.x - n.x, dz = n.den.z - n.z, l = Math.hypot(dx, dz) || 1;
    dig.specksFrom(n.x + dx / l * n.r, n.y - n.r * 0.5, n.z + dz / l * n.r, -dx / l, -dz / l, S.r > 0.04 ? 0.008 : 0.004, dt, S.r > 0.04 ? 45 : 30, S.r > 0.04 ? 0.6 : 0.25);
    if (n.den.k >= 1) this.finish(n);
    return true;
  }
  // the den dug out: joined to every finished den it overlaps (one cavity, walked through)
  finish(n) {
    const dig = this.dig; this.stop(null); this.kLocal.delete(n.id);
    for (const o of dig.world.nodes) {
      if (o === n || !o.den || o.den.k < 1 || o.segs.some(id => { const s = dig.node(id); return s && (s.a === n.id || s.b === n.id); })) continue;
      const d = Math.hypot(o.x - n.x, o.y - n.y, o.z - n.z); if (d < (o.r + n.r) * 0.95 && d <= 0.6) dig.dispatch({ type: 'join', a: n.id, b: o.id, seg: dig.newId() });
    }
    dig.gc.say('the den is dug out: W walks into it');
  }
  // a coyote opened the system from above (dig.js drawEvent 'open'): the digging stops
  opened(sys) { const n = this.job && this.dig.node(this.job.id); if (n && n.sys === sys) this.stop('the den is broken into from above: the digging stops'); }
  // each frame (dig.js update): the silhouette after the mouse; the plans' outlines near the body
  update() {
    if (this.placing && !this.spec()) this.cancel();
    if (!this.spec()) this.job = null;
    if (this.placing) this.aim();
    const dig = this.dig, P = dig.gc.flight.pos, under = dig.xk > 0; let i = 0;
    if (under) for (const n of dig.world.nodes) {
      if (i >= OUTLINES) break; if (!n.den || n.den.k >= 1 || Math.hypot(n.den.x - P.x, n.den.z - P.z) > PLAN_R) continue;
      const m = this.outlines[i++]; m.visible = true; m.position.set(n.den.x, n.den.y, n.den.z); m.scale.set(n.den.r, n.den.r * 0.8, n.den.r);
      m.material.opacity = 0.18 + 0.2 * (this.job?.id === n.id ? 1 : 0);
    }
    for (; i < OUTLINES; i++) this.outlines[i].visible = false;
  }
  dispose() {
    removeEventListener('pointermove', this.onMove); removeEventListener('pointerdown', this.onDown, true);
    removeEventListener('click', this.onBlock, true); removeEventListener('contextmenu', this.onBlock, true); removeEventListener('keydown', this.onKey, true);
    for (const m of [this.sil, ...this.outlines]) this.dig.scene.remove(m);
    this.silFill.geometry.dispose(); this.silFill.material.dispose(); this.silWire.material.dispose(); for (const m of this.outlines) m.material.dispose();
  }
}
