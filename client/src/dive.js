import * as THREE from 'three';
import { bodyOf } from './strikes.js';

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
//
// The free dive (owner, 2026-11-11: "Every bird should have a "dive" ability - when used, they angle downwards and tuck
// their wings and "speed blurs" ripple across the edges of the viewport"). The same key (1 or Q, or the slot) with no prey
// selected, or with one the stoop cannot be made at (can() above), in the air as any bird the player flies: the fliers
// (flierControl.js), the raven (flight.js alone: main.js calls steer before its update) and the acorn woodpecker
// (woodpeckerControl.js fly, which hands this its speed). The nose goes down (TURN rad/s) to the species' steepest angle
// and the wings tuck (the wing rig's own pose: flierControl.draw, raven.js tuck, the woodpecker's fold), no wingbeat;
// A and D still turn it. The speed is a falling body's: it gains g sin(angle) less g (v / terminal)^2 a second, so it
// tends to terminal x sqrt(sin(angle)) and never passes it; W, S and Shift wait (flight.js `fall`). The terminal speed and
// the steepest angle are the species' row in the tile's locomotion.json (`dive`: pipeline/locomotion.py, from the tree's
// dive block in library/animals/locomotion.json, set at the class and at the falcons; docs/movement.md "The dive"); a
// stand-in reads its kin's row at its own mass; with no row the dive is the flight's own steepest pitch and top speed. The stoop at prey
// keeps its own push (ACC) and tops out at the species' flight top, or at the fall's speed for its slope where that is
// higher.
//
// How it ends: the key again (a press starts it and a press ends it, as the stoop's: a held key would take a hand from
// the steering), Escape (which then does not also leave the body), any key that asks for the wings (the up arrow,
// Space, S, X, or H: the soar or the hover), a bump against wood, or the ground: each frame the pull-out is stepped
// ahead from here at the present speed (low()), and where its path would come within CLEAR_M m plus CLEAR_S s of the
// fall of the ground, a rock's top or the water under it, the bird pulls out by itself; over a wood the crowns are the
// floor (the tile's canopy height), so a dive from above the trees ends over them, while a bird already down among
// the trunks (a jay off a limb) is stopped by the ground alone. It does not fly into the ground unasked, and while it
// dives a contact skims it instead of landing it. The
// pull-out is the stoop's (PULL_T s, the nose up); the wings open and their drag sheds the dive's speed back to the
// flight's top (bleed: the tree's pull_g_at_half_top, as the square of the speed). After a free dive a soarer flies on
// (it circles again only after a stoop at prey).
//
// The edge streaks (speedBlur.js) read blur(): how strong (the speed between the species' cruise and its dive top, faded
// in at the start and out through the pull-out) and how fast.
const ABOVE_MIN = 3, DIVE_R = 600;                             // m over the prey (2026-11-06: from far away, no longer from over it); m away (the eye's reach)
const TURN = 2.6, PITCH_MIN = -1.52, ACC = 4;                  // rad/s at the prey; the steepest stoop (rad); m/s^2 over the glide's own
const DET_K = 0.9, DET_N = 150, LOST_T = 0.3, PULL_T = 1.1;   // the prey's hazard at the strike (per s), its reach where unknown (m); s of no line before the cancel; the pull-out
const SEEN_VIS = 0.3;                                          // sight.js SEEN_VIS: the visibility that counts as in sight
const G = 9.81, PULL_UP = 0.25, PULL_K = 4;                    // m/s^2; the pull-out's nose-up (rad) and its rate (1/s)
const CLEAR_M = 2, CLEAR_S = 0.1, AFTER_S = 0.5;                // the ground guard: m over the ground along the pull-out, plus this many s of the fall (or two and a half frames of it); s of the climb looked at past the pull-out
const FLIGHT_ANGLE = 1.2;                                      // rad: flight.js's own steepest pitch, the dive's angle where the tile's table has no row
const END_KEYS = ['ArrowUp', 'Space', 'KeyS', 'KeyX'];         // the keys that ask for the wings: each ends a free dive
const BLUR_IN = 0.4, BLUR_FLOOR = 0.12;                        // s for the streaks to come in; their strength at the dive's start
const WOODPECKER = 'melanerpes_formicivorus', RAVEN = 'corvus_corax';
const STEP = 1 / 60;
const TAU = Math.PI * 2, wrap = a => a - TAU * Math.round(a / TAU);

export class Dive {
  // woodpecker: its control (its own flight); isRaven: whether the player is the raven (no other control on: main.js)
  constructor({ animals, flight, flier, sight, quarry, woodpecker = null, ground = null, isRaven = null, say = null }) {
    Object.assign(this, { animals, flight, flier, sight, quarry, woodpecker, ground, isRaven, say });
    this.active = false; this.target = null; this.pull = 0; this.lostT = 0; this.t = 0; this.detected = false; this.log = [];
    this.free = false; this.kind = null; this.vPeak = 0; this.tuck = 0;   // a free dive (no prey); whose flight it is ('flier', 'raven', 'woodpecker'); the fastest it went; the raven's and the woodpecker's tuck (0..1, eased: frame)
    this.detK = DET_K;   // (tests: 0 for a prey that never sees it coming)
    this.last = null;   // the last dive's end: { why, t, detected, d0, free, vPeak } (tests, the docs' verification)
    this._blur = { k: 0, v: 0 };
    const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    this.onKey = e => {
      if (e.repeat || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Escape') { if (this.active && this.free) { this.cancel('called off'); e.quarryCleared = true; } return; }   // (quarryCleared: spirit.js does not also leave the body on this Escape)
      if ((e.code !== 'KeyQ' && e.code !== 'Digit1') || !this.bird()) return;
      this.toggle();
    };
    addEventListener('keydown', this.onKey);
  }
  // whose wings the player has: 'flier' (flierControl.js), 'woodpecker' (flying, not on its bark), 'raven', 'flush' (a
  // ground bird in its flush: groundControl.js, whose dive is a drop to the ground, dropFlush), or null
  bird() {
    if (this.flier.on) return 'flier';
    if (this.woodpecker?.on) return this.woodpecker.mode === 'fly' ? 'woodpecker' : null;
    if (this.ground?.on) return this.ground.mode === 'fly' && this.ground.S?.flush ? 'flush' : null;
    return this.isRaven?.() ? 'raven' : null;
  }
  aloft(kind = this.bird()) { return kind === 'woodpecker' ? this.woodpecker.mode === 'fly' : kind === 'flush' ? this.ground.mode === 'fly' : !!kind && !this.flight.landed && !this.flight.spirit; }
  // the player's species, its slot, its reach and whether it hunts (a stoop at prey is the fliers': the raven's catch is
  // its bill on the ground, the woodpecker hunts nothing)
  me() {
    const A = this.animals, kind = this.bird(), code = this.codeOf(kind);
    const k = code ? A.speciesList().findIndex(sp => sp.code === code) : -1;
    return { code, k, hunts: kind === 'flier' && k >= 0 && !!A.preySlots?.[k]?.size, reach: (k >= 0 && A.reach?.[k]) || 1.2 };
  }
  // The species' dive from the tile's table (see the header): { vt: the terminal speed of its tucked body in a vertical
  // fall (m/s), angle: its steepest dive (rad), top: its speed at that angle, pullG: the spread wings' drag at half the
  // terminal speed (g) }; a stand-in's kin's; else the flight's own steepest pitch and top speed.
  codeOf(kind) { return kind === 'flier' ? this.flier.code : kind === 'woodpecker' ? WOODPECKER : kind === 'raven' ? RAVEN : kind === 'flush' ? this.ground.code : null; }
  spec(kind = this.bird() || this.kind) {
    const code = this.codeOf(kind) || RAVEN;
    if (this._spec && this._specFor === code) return this._spec;
    const A = this.animals, L = A.tile?.locomotion?.species || null, sp = A.speciesList().find(o => o.code === code);
    const own = L?.[code]?.dive || null, kin = !own && sp?.standIn?.kin ? L?.[sp.standIn.kin] : null, d = own || kin?.dive || null;
    this._specFor = code;
    if (d && d.terminal_mps > 0) {
      const k = kin?.mass_kg > 0 ? Math.pow(bodyOf(A.tile, sp).m / kin.mass_kg, 1 / 6) : 1;   // a stand-in: its kin's row at its own mass (the terminal speed goes as mass^(1/6))
      return this._spec = { vt: d.terminal_mps * k, angle: (d.angle_deg || 64) * Math.PI / 180, top: (d.top_mps || d.terminal_mps) * k, pullG: d.pull_g_at_half_top || 1.5, row: true };
    }
    const top = kind === 'woodpecker' ? this.woodpecker.vmax || 12 : kind === 'flush' ? 2 * (this.ground.S?.flush?.v || 10) : (kind === 'flier' ? this.flier.S?.flight?.vmax : 0) || this.flight.sp.vmax;
    return this._spec = { vt: top / Math.sqrt(Math.sin(FLIGHT_ANGLE)), angle: FLIGHT_ANGLE, top, pullG: 1.5, row: false };
  }
  speed() { return this.kind === 'woodpecker' || (!this.kind && this.bird() === 'woodpecker') ? this.woodpecker.v : this.flight.speed; }
  // the prey's body: where the dive aims (its centre over its feet; a flier's own height)
  aim(a) { return this.animals.scentHeight(a) + (a.air ? 0 : 0.25 * (a.size || 1)); }
  above(a) {
    const P = this.flight.pos, dy = P.y - this.aim(a), h = Math.hypot(a.x - P.x, a.z - P.z);
    return dy >= ABOVE_MIN && Math.hypot(h, dy) <= DIVE_R;
  }
  // the stoop at the selected prey (see the header)
  canStoop() {
    const a = this.quarry.target, f = this.flight;
    return !this.active && this.flier.on && !f.landed && !!a && !a.plant && this.me().hunts && (this.animals.killable?.(a) ?? true) && this.sight.losOf(a) >= SEEN_VIS && this.above(a);
  }
  canFree() { return !this.active && this.aloft() && this.bird() !== 'flush'; }
  can() { return this.canStoop() || this.canFree(); }
  toggle() { if (this.active) this.cancel('called off'); else if (this.bird() === 'flush') this.ground.dropFlush(); else this.start(); }
  start() {
    if (!this.canStoop()) return this.startFree();
    const f = this.flight, a = this.quarry.target;
    this.active = true; this.free = false; this.kind = 'flier'; this.target = a; this.t = 0; this.lostT = 0; this.pull = 0; this.detected = false; this.vPeak = f.speed;
    this.d0 = Math.hypot(a.x - f.pos.x, this.aim(a) - f.pos.y, a.z - f.pos.z);
    f.hover = false; f.flap = 0; f.pitchMin = PITCH_MIN; f.speed = Math.max(f.speed, f.sp.cruise);
    this.say?.(`stooping at the ${this.animals.speciesList()[a.sp]?.one || 'prey'}`);
    return true;
  }
  // the free dive (see the header): no prey, any bird in the air
  startFree() {
    if (!this.canFree()) return false;
    const f = this.flight, kind = this.bird(); this.kind = kind;
    const S = this.spec();
    this.active = true; this.free = true; this.target = null; this.t = 0; this.lostT = 0; this.pull = 0; this.detected = false; this.d0 = 0;
    this.vPeak = Math.max(0, this.speed());
    if (kind !== 'woodpecker') { f.hover = false; f.flap = 0; f.fall = true; f.pitchMin = Math.min(-FLIGHT_ANGLE, -S.angle); f.vcap = Math.max(f.sp.vmax, S.vt); }
    return true;
  }
  // over: the bird pulls out (unless it is down on its kill) and the selection stays for another try
  end(why, pull = true) {
    const f = this.flight; this.active = false; f.fall = false;
    this.last = { why, t: +this.t.toFixed(2), detected: this.detected, d0: +(this.d0 || 0).toFixed(1), free: this.free, vPeak: +this.vPeak.toFixed(1) };
    if (pull && this.aloft(this.kind)) this.pull = PULL_T; else { this.pull = 0; f.pitchMin = undefined; }   // (the steeper limit stays through the pull-out, so the nose is not snapped up)
    this.target = null;
  }
  cancel(why = 'lost sight') {
    if (!this.active) return;
    if (why === 'lost sight') this.say?.('lost sight of it: pulled out');
    this.end(why);
  }
  // The dive's speed shed once the wings are open (see the header): down to the flight's top, then the flight's own.
  bleed(dt) {
    const f = this.flight, W = this.bird() === 'woodpecker' ? this.woodpecker : null;
    if (W) { if (W.v > W.vmax) W.v = Math.max(W.vmax, W.v - this.spec().pullG * G * (2 * W.v / this.spec().vt) ** 2 * dt); return; }   // (its control's own speed: woodpeckerControl.js fly)
    if (f.vcap === undefined) return;
    const S = this.spec(), top = f.sp.vmax;
    if (f.speed > top) f.speed = Math.max(top, f.speed - S.pullG * G * (2 * f.speed / S.vt) ** 2 * dt);
    f.vcap = f.speed > top ? f.speed : undefined;
  }
  // The ground guard (see the header): whether the pull-out, begun now at speed v, would come within the clearance of
  // the ground, a rock's top, the water or (for a bird over the trees) the crowns anywhere under its path: the
  // pull-out's own pitch stepped ahead (and AFTER_S s of the climb past it, for ground that rises ahead), the ground
  // looked up every sixth of a second of it.
  // the height of the tree crowns over the ground at (x, z), m: the lidar canopy's (R x 0.25 m), else the measured stand
  // top (R x 0.5 m); 0 where neither has trees (sight.js canopyTop, without its default for an unmeasured stand)
  crowns(x, z) {
    const T = this.animals.tile, ch = T?.canopyHeight, ct = T?.canopyTop;
    return (ch && ch.at(x, -z, 0) * 0.25) || (ct && ct.at(x, -z, 0) * 0.5) || 0;
  }
  low(v, dt) {
    const f = this.flight, P = f.pos, size = f.heights.size, fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    const clear = CLEAR_M + v * Math.max(CLEAR_S, 2.5 * dt), n = Math.round((PULL_T + AFTER_S) / STEP);
    const over = P.y > f.heights.atXZ(P.x, P.z) + this.crowns(P.x, P.z) + 1;   // over the crowns: they count as the floor; down among the trees only the ground does
    let p = f.pitch, y = P.y, run = 0;
    for (let i = 1; i <= n; i++) {
      p += (PULL_UP - p) * PULL_K * STEP; y += v * Math.sin(p) * STEP; run += v * Math.cos(p) * STEP;
      if (i % 10 && i !== n) continue;
      const x = THREE.MathUtils.clamp(P.x + fx * run, 2, size - 2), z = THREE.MathUtils.clamp(P.z + fz * run, -size + 2, -2);
      const F = f.footing(x, z, y + 2), g = Math.max(f.heights.atXZ(x, z), f.meshAt(x, z), F.surf != null && F.depth > 0.005 ? F.surf : F.y);
      if (y - clear < g + (over ? this.crowns(x, z) : 0)) return true;
    }
    return false;
  }
  // The free dive's frame: the keys and the bumps that end it, the nose down, the fall's speed, the ground guard.
  steerFree(dt) {
    const f = this.flight, W = this.kind === 'woodpecker' ? this.woodpecker : null, S = this.spec(), keys = f.keys;
    if (this.bird() !== this.kind || !this.aloft(this.kind)) return this.end('down', false);
    for (const c of END_KEYS) if (keys.has(c)) return this.end('pulled up');
    if (!W && f.hover) return this.end('pulled up');   // H: the soar or the hover
    if (!W && f.hitNow && this.t > 0) return this.end('bumped');
    this.t += dt;
    const k = TURN * dt;
    f.pitch += THREE.MathUtils.clamp(-S.angle - f.pitch, -k, k);
    if (!W) { f.flap = 0; f.fall = true; f.noLand = Math.max(f.noLand, 0.2); }
    let v = Math.max(0, W ? W.v : f.speed);
    v = Math.max(0, v + G * (Math.max(0, -Math.sin(f.pitch)) - (v / S.vt) ** 2) * dt);
    if (W) W.v = v; else { f.speed = v; f.vcap = Math.max(f.sp.vmax, S.vt); }
    this.vPeak = Math.max(this.vPeak, v);
    this.log.push([+this.t.toFixed(2), 0, +v.toFixed(1), +f.pitch.toFixed(2), 0]); if (this.log.length > 400) this.log.shift();
    if (this.low(v, dt)) this.end('ground');
  }
  // Every frame, whoever flies (main.js): a dive whose bird is gone (the body left, a control switched) is dropped; the
  // raven's and the woodpecker's tuck eased.
  frame(dt) {
    if (this.active && (this.bird() !== this.kind || !this.aloft(this.kind))) this.end(this.free ? 'down' : 'gone', false);
    if (!this.bird() || (this.pull > 0 && !this.aloft(this.kind))) { const f = this.flight; this.pull = 0; f.pitchMin = undefined; if (!this.bird()) { f.vcap = undefined; f.fall = false; } }
    this.tuck += ((this.active ? 1 : 0) - this.tuck) * Math.min(1, dt * (this.active ? 7 : 4));
    if (this.tuck < 1e-3 && !this.active) this.tuck = 0;
  }
  // What the edge streaks draw (speedBlur.js): k their strength (0..1), v the speed (m/s).
  blur() {
    const B = this._blur, on = this.active || this.pull > 0;
    if (!on) { B.k = 0; B.v = 0; return B; }
    const S = this.spec(), v = Math.max(0, this.speed()), v0 = this.kind === 'woodpecker' ? this.woodpecker.vcruise || 7 : this.flight.sp.cruise;
    const u = Math.min(1, Math.max(0, (v - v0) / Math.max(1, S.top - v0)));
    const gate = this.active ? Math.min(1, this.t / BLUR_IN) : Math.min(1, this.pull / PULL_T);
    B.k = gate * (BLUR_FLOOR + (1 - BLUR_FLOOR) * Math.pow(u, 0.8)); B.v = v;
    return B;
  }
  // The frame, before the flight moves (flierControl.update): the pull-out, or the dive's steering, the prey's chance of
  // seeing it, and the strike.
  steer(dt) {
    const f = this.flight;
    if (!this.active) {
      this.bleed(dt);
      if (this.pull > 0) {   // the pull-out: the nose up, then (after a stoop at prey) the soar again
        this.pull -= dt; f.pitch += (PULL_UP - f.pitch) * Math.min(1, dt * PULL_K);
        if (this.pull <= 0) { f.pitchMin = undefined; if (!this.free && !f.landed && f.sp.soar) f.setHover(true); }
      }
      return;
    }
    if (this.free) return this.steerFree(dt);
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
    // its push and gravity along the slope, up to the flight's top or the fall's speed for this slope where that is higher (see the header)
    { const sl = Math.max(0, -Math.sin(f.pitch)), cap = Math.max(f.sp.vmax, this.spec().vt * Math.sqrt(sl)), v = Math.max(f.speed, 4);
      f.speed = v < cap ? Math.min(cap, v + (ACC + 9.8 * sl) * dt) : Math.max(cap, v - 2 * G * dt);
      f.vcap = Math.max(f.sp.vmax, f.speed); this.vPeak = Math.max(this.vPeak, f.speed); }
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
  dispose() { removeEventListener('keydown', this.onKey); if (this.active) this.end('gone', false); const f = this.flight; f.vcap = undefined; f.pitchMin = undefined; f.fall = false; }
}
