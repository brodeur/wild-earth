import * as THREE from 'three';

// The spirit's autopilot (owner, 2026-11-06: "When in spirit form, if I click on any of the species along the bottom of
// the screen (species within view), my spirit changes course and pilots itself directly to the closest species." and
// "In spirit form, when an animal is targeted there is only one "action" [ Embody ] ... Clicking on it pilots the spirit
// directly to/into the target animal").
//
// go(a): the spirit turns and flies itself to the animal a (the selection, quarry.js: its ring shows where it is headed),
// following it as it moves, and stops short at a viewing distance VIEW_K of the body's size (VIEW_MIN to VIEW_MAX m off,
// VIEW_UP of that above it), then holds there circling it slowly (ORBIT rad/s), facing it and looking down at it. On the
// way it keeps CLEAR m over the ground it is about to cross (the highest ground in the next LOOK m of its line), so a ridge
// is a smooth climb and a descent beyond it, never a line through the hill; the nose is pitched toward that height over at
// least PITCH_RUN m. The speed eases from CRUISE far off to a crawl as it arrives. The spirit's own contact with animals
// (spirit.js touch: flying into one becomes it) is held off while it flies to a viewing spot.
// embody(): the same flight to the selection, but into it: within ARRIVE_IN m of its body the spirit becomes that
// individual (spirit.enter, the existing become); if it cannot (another page hosts it and refuses, another player is in
// it, it has gone), the nearest individual of the species is taken instead (the species' normal become).
// Any movement key, a drag that moves, or a touch steer hands control back at once (the target stays selected).
// main.js calls step(dt) before the spirit's frame (flight.updateSpirit reads `piloted` to drop its own drift back to the
// cruise and its levelling).
const VIEW_K = 9, VIEW_MIN = 9, VIEW_MAX = 40, VIEW_UP = 0.45, ORBIT = 0.12, CLEAR = 18, LOOK = 220, PITCH_RUN = 30;
const CRUISE = 45, ARRIVE_IN = 1.6, TURN = 1.4, DRAG_PX = 8;
const MOVE_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyX', 'KeyZ', 'KeyH', 'ShiftLeft', 'ShiftRight'];
const TAU = Math.PI * 2, wrap = a => a - TAU * Math.round(a / TAU);

export class Pilot {
  constructor({ flight, spirit, animals, quarry, say = null }) {
    Object.assign(this, { flight, spirit, animals, quarry, say });
    this.on = false; this.target = null; this.into = false; this.arrived = false; this.ang = 0; this.dragFrom = null;
    const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    this.onKey = e => {   // Embody: 1 or E, in spirit form with a target held
      if (e.repeat || typing(e) || e.metaKey || e.ctrlKey || e.altKey || !this.spirit.on || !this.quarry.target) return;
      if (e.code === 'Digit1' || e.code === 'KeyE') { e.preventDefault(); this.embody(); }
    };
    addEventListener('keydown', this.onKey);
  }
  dispose() { removeEventListener('keydown', this.onKey); this.cancel(); }
  get embodying() { return this.on && this.into; }
  go(a, into = false) {
    if (!a || !this.spirit.on) return false;
    const P = this.flight.pos;
    this.on = true; this.target = a; this.into = into; this.arrived = false; this.dragFrom = null;
    this.ang = Math.atan2(P.z - a.z, P.x - a.x);   // the side it comes from is the side it looks from
    this.flight.hover = false; this.flight.piloted = true;
    return true;
  }
  embody() { const a = this.quarry.target; if (!a || !this.spirit.on) return false; return this.go(a, true); }
  cancel() { if (!this.on) return; this.on = false; this.flight.piloted = false; this.target = null; this.into = false; }
  // a movement key, a drag that moves or a touch steer: control back (the selection stays)
  steered() {
    const f = this.flight; if (MOVE_KEYS.some(k => f.keys.has(k))) return true;
    if (f.drag) { this.dragFrom ||= { x: f.drag.x, y: f.drag.y }; return Math.hypot(f.drag.x - this.dragFrom.x, f.drag.y - this.dragFrom.y) > DRAG_PX; }
    this.dragFrom = null; return false;
  }
  step(dt) {
    if (!this.on) return;
    const f = this.flight, A = this.animals, P = f.pos, a = this.target, H = A.heights;
    if (!this.spirit.on) return this.cancel();
    if (this.steered()) { this.cancel(); return; }
    if (!a || a.gone || !A.alive(a)) { this.say?.('it has gone'); return this.cancel(); }
    const br = this.quarry.radius(a), ty = A.scentHeight(a) + (a.air ? 0 : 0.4 * br);
    if (this.into) {   // into it: aim at its body; within ARRIVE_IN, become it (or the nearest of its kind)
      const d = Math.hypot(a.x - P.x, ty - P.y, a.z - P.z);
      this.spirit.coolT = Math.max(this.spirit.coolT || 0, 0.2);   // this individual, not one it brushes past on the way
      if (d < Math.max(ARRIVE_IN, br * 2)) { this.cancel(); this.become(a); return; }
      this.fly(dt, a.x, ty, a.z, d, 0);
      return;
    }
    this.spirit.coolT = Math.max(this.spirit.coolT || 0, 0.2);   // no contact with what it passes on the way
    const D = Math.min(VIEW_MAX, Math.max(VIEW_MIN, VIEW_K * br)), gx = a.x + Math.cos(this.ang) * D, gz = a.z + Math.sin(this.ang) * D;
    const gy = Math.max(H.atXZ(a.x, a.z), a.y) + D * VIEW_UP;
    const h = Math.hypot(gx - P.x, gz - P.z);
    if (this.arrived || h < 3) {   // (the height eases in below: the climb's long pitch run would make it creep to it)   // there: circle it slowly, facing it, looking down at it
      if (!this.arrived) { this.arrived = true; this.say?.(`with the ${A.speciesList()[a.sp]?.one || 'animal'}`); }
      this.ang += ORBIT * dt;
      const k = 1 - Math.exp(-dt * 2.5);
      P.x += (gx - P.x) * k; P.z += (gz - P.z) * k; P.y += (Math.max(gy, H.atXZ(P.x, P.z) + 3) - P.y) * k;
      f.yaw = Math.atan2(-(a.x - P.x), -(a.z - P.z)); f.pitch = Math.atan2(ty - P.y, Math.max(1, Math.hypot(a.x - P.x, a.z - P.z))) * 0.6;
      f.speed = 0; f.hover = true;
      return;
    }
    this.fly(dt, gx, gy, gz, h, D);
  }
  // toward (gx, gy, gz), h m off in plan: the turn, the climb over what is ahead, the speed easing in
  fly(dt, gx, gy, gz, h, D) {
    const f = this.flight, P = f.pos, H = this.animals.heights;
    const dx = gx - P.x, dz = gz - P.z, hl = Math.max(1e-3, Math.hypot(dx, dz)), ux = dx / hl, uz = dz / hl;
    // the highest ground in the next LOOK m of the line (to the goal at most), plus CLEAR: the height to hold until near
    let top = -Infinity; const run = Math.min(LOOK, hl);
    for (let s = 0; s <= run; s += 10) top = Math.max(top, H.atXZ(P.x + ux * s, P.z + uz * s));
    const near = hl < Math.max(40, D * 2.5);
    const want = near ? Math.max(gy, H.atXZ(P.x, P.z) + 3) : Math.max(gy, top + CLEAR);
    const yw = Math.atan2(-ux, -uz), k = TURN * dt;
    f.yaw += THREE.MathUtils.clamp(wrap(yw - f.yaw), -k * 2, k * 2);
    f.pitch = THREE.MathUtils.clamp(Math.atan2(want - P.y, near ? Math.max(6, Math.min(hl, PITCH_RUN)) : Math.max(PITCH_RUN, Math.min(hl, 120))), -1.0, 1.0);
    const facing = Math.cos(wrap(yw - f.yaw));   // slow while still turning toward it
    f.speed = Math.max(1.5, Math.min(CRUISE, 0.8 * h + 2)) * (0.35 + 0.65 * Math.max(0, facing));
    f.hover = false; f.roll = 0;
  }
  // the existing become: this individual, else the nearest of its species (spirit.enter)
  become(a) {
    const S = this.spirit, A = this.animals;
    S.coolT = 0;
    if (S.enter(a.id)) return true;
    let best = null, bd = Infinity; const P = this.flight.pos;
    for (const b of A.list) { if (b === a || b.sp !== a.sp || b.dead || b.remote || b.culled) continue; const d = (b.x - P.x) ** 2 + (b.z - P.z) ** 2; if (d < bd) { bd = d; best = b; } }
    if (best && S.enter(best.id)) return true;
    this.say?.(`cannot become this ${A.speciesList()[a.sp]?.one || 'animal'}`);
    return false;
  }
}
