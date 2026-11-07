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
// embody(): the same flight to the selection, but into it (owner, 2026-11-06: "the spirit should travel all the way to the
// body as it does, but then enter the body - switch the avatar to the animal"). It homes on the animal until contact,
// however it moves: down to the body itself (the spirit's own floor stops it over the ground, no stand-off height), and
// faster than the animal runs (CHASE m/s over its speed, measured frame to frame). Contact is a touch's (spirit.js touch:
// within TOUCH_R of the body, TOUCH_AIR of one in the air, plus half the body's size), and it ends as a touch does, in
// spirit.enter for that individual: the take (on a mirror page the host's handshake, animals.js take), the camera's
// blend and the wisp diving in, then the player is that animal. Never another one: if that one cannot be taken (another
// player is in it), the flight stops with a word. It stops with a word too when the animal dies or goes, or when the
// spirit has had no line of sight to it (from the spirit's own place, sight.js visibility, past NEAR_T m) for LOST_T s
// with the ground between, LOST_LEAF s with only leaves between (an animal running under the trees is seen in glimpses).
// Any movement key, a drag that moves, or a touch steer hands control back at once (the target stays selected); Escape
// lets go of the target (quarry.js), which ends the flight too. Neither embodies anything.
// main.js calls step(dt) before the spirit's frame (flight.updateSpirit reads `piloted` to drop its own drift back to the
// cruise and its levelling).
const VIEW_K = 9, VIEW_MIN = 9, VIEW_MAX = 40, VIEW_UP = 0.45, ORBIT = 0.12, CLEAR = 18, LOOK = 220, PITCH_RUN = 30;
const CRUISE = 45, TURN = 1.4, DRAG_PX = 8;
const TOUCH_R = 2.5, TOUCH_AIR = 4, CHASE = 6, LOST_T = 2.5, LOST_LEAF = 6, SEEN = 0.3, LOS_T = 0.2, NEAR_T = 25;   // spirit.js TOUCH_R, TOUCH_AIR; m/s over the animal's speed; s with no line of sight; quarry.js SEEN_VIS; s between line tests; m inside which the line is not judged
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
    this.on = true; this.target = a; this.into = into; this.arrived = false; this.dragFrom = null; this.lostT = 0; this.av = 0; this.ap = null; this.losT = 0; this.los = 1; this.seen = false;
    this.ang = Math.atan2(P.z - a.z, P.x - a.x);   // the side it comes from is the side it looks from
    this.flight.hover = false; this.flight.piloted = true;
    return true;
  }
  embody() {
    const a = this.quarry.target; if (!a || !this.spirit.on) return false;
    if (this.animals.playable && !this.animals.playable(a)) { this.say?.(`a ${this.name(a)} cannot be embodied yet`); return false; }
    return this.go(a, true);
  }
  name(a) { return this.animals.speciesList()[a.sp]?.one || 'animal'; }
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
    if (this.steered()) { if (this.into) this.say?.('embody called off'); this.cancel(); return; }
    if (!a || a.gone || !A.alive(a)) { this.say?.(`the ${a ? this.name(a) : 'animal'} has gone`); return this.cancel(); }
    if (this.into && a.dead) { this.say?.(`the ${this.name(a)} died`); return this.cancel(); }
    const br = this.quarry.radius(a), ty = A.scentHeight(a) + (a.air ? 0 : 0.4 * br);
    if (this.into) {   // into it: home on its body until contact, then the touch's become (see the header)
      this.spirit.coolT = Math.max(this.spirit.coolT || 0, 0.2);   // this individual, not one it brushes past on the way
      // its line from the spirit itself (not the chase camera behind it, whose line runs through the crowns the spirit is
      // diving into), tested every LOS_T s; not judged within NEAR_T m, where contact is moments away
      const dh = Math.hypot(a.x - P.x, a.z - P.z);
      // the ground between (a ridge) loses it after LOST_T s; the leaves alone (a deer running under the oaks) after LOST_LEAF s
      if ((this.losT = (this.losT || 0) - dt) <= 0) {
        this.losT = LOS_T; this.ground = false;
        if (dh < NEAR_T) this.los = 1;
        else {
          this.ground = this.groundBetween(P, a.x, ty, a.z);
          if (!this.ground) { this.quarry.sight.indexTrees?.(); this.los = this.quarry.sight.visibility(P.x, P.y, P.z, a.x, ty, a.z, !a.air); } else this.los = 0;
        }
      }
      if (this.los >= SEEN) this.seen = true;   // (leaving sight needs having been in it: a chip's pick behind a ridge is flown to over it)
      this.lostT = this.los >= SEEN || !this.seen ? 0 : this.lostT + dt;
      if (this.lostT > (this.ground ? LOST_T : LOST_LEAF)) { this.say?.(`lost sight of the ${this.name(a)}`); return this.cancel(); }
      if (this.ap && dt > 0) this.av += (Math.min(40, Math.hypot(a.x - this.ap.x, a.z - this.ap.z) / dt) - this.av) * Math.min(1, dt * 4);   // its speed over the ground
      this.ap = { x: a.x, z: a.z };
      const d = Math.hypot(a.x - P.x, ty - P.y, a.z - P.z), reach = (a.air ? TOUCH_AIR : TOUCH_R) + 0.5 * br;
      if (d < reach) { this.cancel(); this.become(a); return; }
      this.fly(dt, a.x, ty, a.z, Math.hypot(a.x - P.x, a.z - P.z), 0, this.av);
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
  // chase: flying into an animal running at chase m/s (it goes down to the body and outruns it); null to a viewing spot
  fly(dt, gx, gy, gz, h, D, chase = null) {
    const f = this.flight, P = f.pos, H = this.animals.heights;
    const dx = gx - P.x, dz = gz - P.z, hl = Math.max(1e-3, Math.hypot(dx, dz)), ux = dx / hl, uz = dz / hl;
    // the highest ground in the next LOOK m of the line (to the goal at most), plus CLEAR: the height to hold until near
    let top = -Infinity; const run = Math.min(LOOK, hl);
    for (let s = 0; s <= run; s += 10) top = Math.max(top, H.atXZ(P.x + ux * s, P.z + uz * s));
    const near = hl < Math.max(40, D * 2.5);
    const into = chase !== null;
    const want = near ? (into ? gy : Math.max(gy, H.atXZ(P.x, P.z) + 3)) : Math.max(gy, top + CLEAR);   // into it: down to the body (the spirit's floor holds it over the ground)
    const yw = Math.atan2(-ux, -uz), k = TURN * dt;
    f.yaw += THREE.MathUtils.clamp(wrap(yw - f.yaw), -k * 2, k * 2);
    f.pitch = THREE.MathUtils.clamp(Math.atan2(want - P.y, near ? Math.max(into ? 2 : 6, Math.min(hl, PITCH_RUN)) : Math.max(PITCH_RUN, Math.min(hl, 120))), -1.2, 1.0);
    const facing = Math.cos(wrap(yw - f.yaw));   // slow while still turning toward it
    const base = into ? Math.max(chase + CHASE, Math.min(CRUISE, 0.8 * h + 4)) : Math.max(1.5, Math.min(CRUISE, 0.8 * h + 2));
    f.speed = Math.min(into ? CRUISE + 20 : CRUISE, base) * (0.35 + 0.65 * Math.max(0, facing));
    if (into) f.yaw += THREE.MathUtils.clamp(wrap(yw - f.yaw), -k * 2, k * 2);   // a chase turns twice as hard (a bolting deer jinks)
    f.hover = false; f.roll = 0;
  }
  // whether the ground rises over the line from P to (x, y, z) (not the last metres: the body's own footing)
  groundBetween(P, x, y, z) {
    const H = this.animals.heights, dx = x - P.x, dy = y - P.y, dz = z - P.z, L = Math.hypot(dx, dz), n = Math.max(2, Math.ceil(L / 4));
    for (let i = 1; i < n; i++) { const u = i / n; if (u * L > L - 2) break; if (P.y + dy * u < H.atXZ(P.x + dx * u, P.z + dz * u) - 0.15) return true; }
    return false;
  }
  // the touch's become (spirit.js touch -> enter): this individual only
  become(a) {
    const S = this.spirit;
    S.coolT = 0;
    if (S.enter(a.id)) return true;
    this.say?.(`could not become this ${this.name(a)}: another is in it`);
    return false;
  }
}
