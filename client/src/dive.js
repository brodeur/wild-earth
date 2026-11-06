import * as THREE from 'three';

// The dive (owner, 2026-11-06: "For predator birds above their prey, their should be a "swoop" or "dive" attack button
// when a prey is selected and the bird is above the prey. The bird tucks its wings and flies directly to the prey. The
// prey has a chance to detect this attack, increasing as the bird gets closer and closer. If the bird loses line of
// sight the attack is canceled and the bird reverts to soaring.").
//
// Offered (can(): the action bar's dive slot shows, Q or the slot starts it) while the player is a flier whose species
// hunts (flierControl.js FLIERS, animals.js preySlots), in the air, with a prey animal selected (quarry.js) that it has
// a line of sight to (sight.js losOf), that the catch can take (animals.js killable: not yet a ground squirrel, a tree
// squirrel or a quail, which Tab still selects), and is below it (ABOVE_MIN m or more) within DIVE_R m: from far away too
// (2026-11-06: "For birds, they can initiate a dive from far away"; it first asked to be over the prey). Then each frame, before the flight moves (flierControl.update calls steer), the bird is turned straight at
// the prey's body (TURN rad/s, the flight's pitch let down to PITCH_MIN for a stoop near the vertical), its wings tucked
// (flierControl.draw: the soarers' stoop pose, a jay's folded wings) and no wingbeat, and it gains speed as a falling
// body does (ACC m/s^2 plus gravity along the slope) up to the species' top (the flight's vmax).
//
// The prey's chance of seeing it coming: a hazard DET_K (1 - d/n)^2 per second within n, n how far the prey's species
// notices the player's (perception.json detects, animals.js det; DET_N where the tile does not say), so it rises as the
// bird closes; a prey animal that sees it is alarmed (animals.js startle; on a mirror the host is asked), and its own
// flight from danger runs, as at a watcher's call: the vole for cover, the ground squirrel down its burrow, the rabbit
// bolting. The line of sight is the camera's (sight.losOf, tested every sight.js FOCUS_T s): lost for LOST_T s, the dive
// is cancelled, the bird pulls out (PULL_T s, the nose up) and soars again (a soarer's circle; the others glide on). Q
// again, Escape, or the prey's death or loss cancel it too. Within one frame's flight of the prey (plus the species'
// reach) the strike is handed to the catch as the hawk's contact strike is (animals.js catchNear: the kill, or on a
// mirror the host's confirmation, animals.onCaught then flierControl.took), the bird down on it; a strike that finds no
// prey there is a miss, and the bird pulls out.
const ABOVE_MIN = 3, DIVE_R = 600;                             // m over the prey (2026-11-06: from far away, no longer from over it); m away (the eye's reach)
const TURN = 2.6, PITCH_MIN = -1.52, ACC = 4;                  // rad/s at the prey; the steepest stoop (rad); m/s^2 over the glide's own
const DET_K = 0.9, DET_N = 150, LOST_T = 0.3, PULL_T = 1.1;   // the prey's hazard at the strike (per s), its reach where unknown (m); s of no line before the cancel; the pull-out
const SEEN_VIS = 0.3;                                          // sight.js SEEN_VIS: the visibility that counts as in sight
const TAU = Math.PI * 2, wrap = a => a - TAU * Math.round(a / TAU);

export class Dive {
  constructor({ animals, flight, flier, sight, quarry, say = null }) {
    Object.assign(this, { animals, flight, flier, sight, quarry, say });
    this.active = false; this.target = null; this.pull = 0; this.lostT = 0; this.t = 0; this.detected = false; this.log = [];
    this.detK = DET_K;   // (tests: 0 for a prey that never sees it coming)
    this.last = null;   // the last dive's end: { why, t, detected, d0 } (tests, the docs' verification)
    const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    this.onKey = e => {
      if ((e.code !== 'KeyQ' && e.code !== 'Digit1') || e.repeat || typing(e) || e.metaKey || e.ctrlKey || e.altKey || !this.flier.on) return;
      this.toggle();
    };
    addEventListener('keydown', this.onKey);
  }
  // the player's species, its slot, its reach and whether it hunts
  me() {
    const A = this.animals, code = this.flier.code, k = code ? A.speciesList().findIndex(sp => sp.code === code) : -1;
    return { code, k, hunts: k >= 0 && !!A.preySlots?.[k]?.size, reach: (k >= 0 && A.reach?.[k]) || 1.2 };
  }
  // the prey's body: where the dive aims (its centre over its feet; a flier's own height)
  aim(a) { return this.animals.scentHeight(a) + (a.air ? 0 : 0.25 * (a.size || 1)); }
  above(a) {
    const P = this.flight.pos, dy = P.y - this.aim(a), h = Math.hypot(a.x - P.x, a.z - P.z);
    return dy >= ABOVE_MIN && Math.hypot(h, dy) <= DIVE_R;
  }
  can() {
    const a = this.quarry.target, f = this.flight;
    return !this.active && this.flier.on && !f.landed && !!a && this.me().hunts && (this.animals.killable?.(a) ?? true) && this.sight.losOf(a) >= SEEN_VIS && this.above(a);
  }
  toggle() { if (this.active) this.cancel('called off'); else this.start(); }
  start() {
    if (!this.can()) return false;
    const f = this.flight, a = this.quarry.target;
    this.active = true; this.target = a; this.t = 0; this.lostT = 0; this.pull = 0; this.detected = false;
    this.d0 = Math.hypot(a.x - f.pos.x, this.aim(a) - f.pos.y, a.z - f.pos.z);
    f.hover = false; f.flap = 0; f.pitchMin = PITCH_MIN; f.speed = Math.max(f.speed, f.sp.cruise);
    this.say?.(`stooping at the ${this.animals.speciesList()[a.sp]?.one || 'prey'}`);
    return true;
  }
  // over: the bird pulls out (unless it is down on its kill) and the selection stays for another try
  end(why, pull = true) {
    const f = this.flight; this.active = false; f.pitchMin = undefined;
    this.last = { why, t: +this.t.toFixed(2), detected: this.detected, d0: +(this.d0 || 0).toFixed(1) };
    if (pull && !f.landed) this.pull = PULL_T;
    this.target = null;
  }
  cancel(why = 'lost sight') {
    if (!this.active) return;
    if (why === 'lost sight') this.say?.('lost sight of it: pulled out');
    this.end(why);
  }
  // The frame, before the flight moves (flierControl.update): the pull-out, or the dive's steering, the prey's chance of
  // seeing it, and the strike.
  steer(dt) {
    const f = this.flight;
    if (!this.active) {
      if (this.pull > 0) {   // the pull-out: the nose up, then the soar again
        this.pull -= dt; f.pitch += (0.25 - f.pitch) * Math.min(1, dt * 4);
        if (this.pull <= 0 && !f.landed && f.sp.soar) f.setHover(true);
      }
      return;
    }
    const A = this.animals, a = this.target, P = f.pos;
    if (!this.flier.on || f.landed) return this.end('down', false);
    if (!a || a.dead || a.gone || a.culled || !A.alive(a)) { this.say?.('it is gone'); return this.end('gone'); }
    this.t += dt;
    // the line of sight from the camera (sight.js tests the selection every FOCUS_T s)
    this.lostT = this.sight.losOf(a) >= SEEN_VIS ? 0 : this.lostT + dt;
    if (this.lostT > LOST_T) return this.cancel('lost sight');
    const ty = this.aim(a), dx = a.x - P.x, dy = ty - P.y, dz = a.z - P.z, h = Math.hypot(dx, dz), d = Math.hypot(h, dy);
    // straight at it: the yaw (0 faces -z) and the pitch turned toward the line, the wings tucked, the speed of a fall
    const yw = Math.atan2(-dx, -dz), pw = Math.max(PITCH_MIN, Math.atan2(dy, h)), k = TURN * dt;
    f.yaw += THREE.MathUtils.clamp(wrap(yw - f.yaw), -k, k);
    f.pitch += THREE.MathUtils.clamp(pw - f.pitch, -k, k);
    f.roll += (0 - f.roll) * Math.min(1, dt * 4);
    f.hover = false; f.flap = 0; f.noLand = Math.max(f.noLand, 0.2);
    f.speed = Math.min(f.sp.vmax, Math.max(f.speed, 4) + (ACC + 9.8 * Math.max(0, -Math.sin(f.pitch))) * dt);
    // the prey's chance of seeing it coming (see the header)
    const me = this.me();
    if (!this.detected) {
      const n = A.det?.[a.sp]?.[me.k], N = Number.isFinite(n) && n > 0 ? n : DET_N;
      const lam = d < N ? this.detK * (1 - d / N) ** 2 : 0;
      if (lam > 0 && Math.random() < 1 - Math.exp(-lam * dt)) {
        this.detected = true; A.startle(a, P.x, P.y, P.z, me.code);
        this.say?.(`the ${A.speciesList()[a.sp]?.one || 'prey'} saw you coming`);
      }
    }
    this.log.push([+this.t.toFixed(2), +d.toFixed(1), +f.speed.toFixed(1), +f.pitch.toFixed(2), this.detected ? 1 : 0]); if (this.log.length > 400) this.log.shift();
    // the strike: within this frame's flight of it, plus the species' reach
    if (d <= f.speed * dt * 1.5 + me.reach) this.strike(a, ty);
  }
  // handed to the catch (see the header): the bird down at the prey, the kill (the host's) or the host asked (a mirror)
  strike(a, ty) {
    const A = this.animals, f = this.flight;
    const c = A.catchNear(a.x, ty, a.z), asked = A.catchAsked;
    if (c || asked) {
      const g = f.footing(a.x, a.z, ty + 1).y; f.pos.set(a.x, g + f.sp.landH, a.z); f.pitch = 0; f.roll = 0; f.speed = 0; f.settleOn(null, g); f.gnd.runout = f.gnd.runN = 0;   // down on it, no landing hops (a hop ends the mantle)
      this.end(c ? 'caught' : 'struck', false);
      if (c) this.flier.took(c);   // the hawk mantles over it; on a mirror animals.onCaught does this when the host confirms
      return;
    }
    const one = A.speciesList()[a.sp]?.one || 'prey';
    this.say?.(A.reachedCover?.(a) ? `the ${one} got to cover` : 'the strike misses'); this.end(A.reachedCover?.(a) ? 'cover' : 'missed');
  }
  dispose() { removeEventListener('keydown', this.onKey); if (this.active) this.end('gone', false); }
}
