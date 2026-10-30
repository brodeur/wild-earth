import * as THREE from 'three';
import { RAVEN_GROUND } from './animalModels.js';
import { Perches } from './perch.js';

// The raven: constant forward flight with pitch and yaw, a slow sink while gliding, flapping to climb,
// a hover (H, or S held to a stop) that holds position. The bird is `body` (a Group the model hangs
// from); the camera chases it from behind and a little above, or sits on it in first person (V toggles).
// Landing is by contact: fly into the ground (the body within CONTACT_G of the drawn terrain or a rock top) or into a
// branch (its bark within CONTACT_B of the body; perch.js: wood at least 1.5 cm thick, sloping less than ~44 degrees,
// 0.8 m or more above the ground) at under ATTACH_V m/s of airspeed and the bird takes hold: it stands there (`landed`;
// body LAND_H above its feet, `groundY`), on the ground on its heading, on a branch along the limb (whichever way along
// it is nearer the heading), its feet on the bark's top. Faster, or wood a bird cannot stand on (a trunk, a steep limb),
// and it bounces off (its heading mirrored about the contact normal, BOUNCE_KEEP of the speed kept, a flare of the
// wings); it skims a pond. Hover and Z down is the gentle way in (it reaches the contact
// slowly). Taking off, the bird ignores contacts for NO_LAND s (and the plant it left for a second).
// On the ground or a branch (updateGround; the first SETTLE s after touchdown the body slides onto its perch, the wings
// fold and the models swap, raven.js, and the keys wait) the raven hops, both feet, as ravens on the ground mostly do:
// W / S hop forward HOP_LEN m and back HOP_BACK m (held, hop after hop; on a branch along the limb, stopping where it
// ends: too thin, too steep, too low or at the parent limb, perch.js stepAlong); A / D hop round TURN_STEP (held, hop
// after hop) or, tapped (under TAP_T), step round STEP_ANG on the spot. The arrows, a drag, or Shift with W A S D look
// about (the head follows; on the ground the body hops round past HOP_TURN_STILL). Space takes off: forward and up to
// the 2 m climb-out from the ground, a drop and a glide from a branch; X straight up into a hover; either way the ground
// model's wings lift for LIFT_T s first. E pecks: an acorn within PICK_R of the bill (on a branch a crown acorn within
// PICK_BRANCH) is picked up (acorns.js playerPick, as the squirrel's E). On the ground the feet follow the drawn terrain
// and the tops of close rocks (a hop lands up to HOP_UP higher, its arc raised over what it crosses) and wade only
// WADE deep and in a pond only SHORE from dry ground (the squirrel controller's footing(): rock tops, creek beds, pond
// levels). The chase camera comes down to ~0.8 m up and 2.5 m back, a little to one side (camK blends the two set-ups),
// with a small dip as the bird lands. A HUD row says where it stands ("perched on a blue oak, 6 m up", "on the ground").
// body.userData.flight is this, for the model hanging from body.
// Spirit form (spirit.js; `spirit` true): the same keys drive a wisp instead (updateSpirit): it cruises at SPIRIT_CRUISE
// m/s, W (Shift faster) pushes it up to SPIRIT_MAX and, let go, it eases back to cruise; S stops it and backs it up as
// the raven's does; X / Z rise and sink faster than wings can, space lifts it. No glide or stall: speed is not traded
// for height, nothing sinks it, and nothing lands it: it passes over the ground, water and limbs alike, kept
// SPIRIT_FLOOR above the drawn terrain or a pond's or creek's surface.
// Other birds (flierControl.js; setSpecies): the same flight, landing and hopping with a species' own numbers in `sp`
// (RAVEN_SP below is the raven's, the defaults): cruise and top speed, the glide's sink, a flap's climb, X / Z rates,
// turn rate, the contact speed and height that land it, its body above its feet standing, its hop, its perch rule
// (perch.js: a red-tail on a snag or a pine), the chase camera's scale (by wingspan). A soarer's H (sp.soar) is a soar
// instead of a hover: it holds its speed in a slow circle (radius sp.soar.r at sp.soar.v m/s, in the way it was
// banking) climbing a little in the thermal, A / D tightening or opening it, W, S or H again flying on.
const SPIRIT_CRUISE = 12, SPIRIT_MAX = 90, SPIRIT_BACK = 10, SPIRIT_FLOOR = 0.8;   // m/s, m/s, m/s, m (cruise 25 before 2026-10-27: "too fast")
// W and S (owner, 2026-10-27): a tap nudges the speed by SPIRIT_TAP m/s; a hold ramps on an exponential curve, the
// rate toward the top (W) or the bottom (S) growing from SPIRIT_RAMP[0] per second to SPIRIT_RAMP[1] over
// SPIRIT_RAMP_T s of holding, and since it is a rate toward the end speed, the speed eases into it.
const SPIRIT_TAP = 2.5, SPIRIT_RAMP = [0.08, 2.2], SPIRIT_RAMP_T = 3;
const RAVEN_LOOK = 1.3;   // rad: how far the raven's head turns before the body follows a drag (flight.js look)
const SPIRIT_FRAME = -0.45;   // where the wisp sits in the frame: this much of the half view below the middle (the lower third)
// Scroll to zoom (owner, 2026-10-27): the wheel down zooms out, up zooms in. `zoom` scales the chase distance of every
// camera (this one, the spirit's, the ground animals' in groundControl.js, the squirrel's, the woodpecker's), ZOOM_RANGE
// times the set-up's own; a notch of 100 is about 11%. Not over the panel, the credits, a card or the opening screen.
const ZOOM_RANGE = [0.35, 4], ZOOM_RATE = 0.0012, ZOOM_STEP = 60, ZOOM_REACH = 2.5, ZOOM_EASE = 7;
// One wheel event moves the target by at most ZOOM_STEP px worth (a line or a page of deltaMode scaled to px), the
// target stays within ZOOM_REACH times the zoom the camera is at (so a trackpad flick's hundreds of events cannot pin
// it to an end of the range), and `zoom` eases toward the target at ZOOM_EASE per second as the cameras read it.
const LAND_H = RAVEN_GROUND.bodyY;   // the body above the feet, standing (raven_ground.glb)
const TERRAIN_SPACING = 10;          // terrain.js default vertex spacing (main.js builds it with the defaults)
export const FOLD_T = 0.25, XFADE_T = 0.12, LIFT_T = 0.2;   // s: wings fold before the swap; the dissolve; wings lift before take-off
const SETTLE = FOLD_T + XFADE_T;
const CONTACT_G = 0.35, CONTACT_B = 0.3, ATTACH_V = 7, BOUNCE_KEEP = 0.85, NO_LAND = 0.6, SWEEP = 0.15;   // m, m, m/s, -, s, m
const TURN_STEP = Math.PI / 4, STEP_ANG = 0.3, STEP_T = 0.2, TAP_T = 0.14, HOP_TURN_STILL = 1.0, TURN_HOP_T = 0.26;   // rad, rad, s, s, rad, s
const HOP_LEN = 0.6, HOP_BACK = 0.4, HOP_T = 0.36, HOP_H = 0.12, HOP_GAP = 0.06;   // m, m, s, m, s
const HOP_UP = 0.45, WADE = 0.04, SHORE = 0.5, PICK_R = 0.8, PICK_BRANCH = 1.2;   // m
// The raven's strike and feed (2026-10-30, docs/movement.md "The catch"): E on the ground within reach of the bill of prey
// its species hunts (animals.js preyNear: a lizard, a vole) gives STAB_N quick hard bill stabs of STAB_T s each, the kill on
// the last (catchNear); E beside a carcass (feedNear) the same stabs, the belly filled once per carcass (needs.js). The
// ground model draws a stab as a faster, deeper peck (raven.js).
const STAB_N = 3, STAB_T = 0.2;
const TAU = Math.PI * 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = u => u * u * (3 - 2 * u);
const yawOf = (dx, dz) => Math.atan2(-dx, -dz);   // the yaw whose forward (-sin yaw, -cos yaw) points along (dx, dz)
export const RAVEN_SP = { cruise: 12, fast: 18, vmax: 40, sprint: 8, recover: 30, sink: 0.6, flap: 6, climb: 9, turn: 1.4, attachV: ATTACH_V, contactG: CONTACT_G, landH: LAND_H,
  hopLen: HOP_LEN, hopBack: HOP_BACK, hopT: HOP_T, hopH: HOP_H, cam: 1, perch: null, soar: null };
export class RavenFlight {
  constructor(camera, heights, dom) {
    this.camera = camera; this.heights = heights;
    this.body = new THREE.Group();
    this.pos = this.body.position; this.yaw = 0; this.pitch = 0; this.roll = 0; this.speed = 12;
    this.keys = new Set(); this.flap = 0; this.drag = null; this.hover = false; this.sDwell = 0;
    this.stamina = 1; this.tired = false;   // the wings' sprint meter (sp.sprint s of the boost, back over sp.recover s)
    // The look (owner, 2026-10-27): a drag turns the camera, and the player's head with it, up to lookMax rad each way
    // (the control sets it for its body; 0 for the spirit, which has no head); past that the drag turns the body
    // instead so the camera keeps moving. look is the head's yaw off the body; the cameras look along yaw + look;
    // moving (W, turns) settles the look back into the body's heading (settleLook: the body turns under a camera
    // that stays). headYaw is the uniform the player's material reads (animalModels.js animalMaterial head).
    this.look = 0; this.lookMax = 0; this.headYaw = { value: 0 }; this._d2 = new THREE.Vector3();
    this._zoom = 1; this.zoomTarget = 1; this._zoomAt = performance.now();   // the wheel's zoom (ZOOM_RANGE): every chase camera scales its distance by it
    window.addEventListener('wheel', e => {
      if (document.documentElement.classList.contains('opening') || e.target?.closest?.('#panel, #credits, #speciesCard, #opening, #fieldGuide')) return;
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY, d = Math.max(-ZOOM_STEP, Math.min(ZOOM_STEP, px));
      const z = this.zoom, t = this.zoomTarget * Math.exp(d * ZOOM_RATE);   // down (positive) zooms out, up zooms in (owner, 2026-10-27: inverted from the first cut)
      this.zoomTarget = Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], Math.min(z * ZOOM_REACH, Math.max(z / ZOOM_REACH, t))));
    }, { passive: true });
    this.view = 'chase';                                  // 'chase' | 'first'
    this.camOff = new THREE.Vector3(); this.camUp = new THREE.Vector3(0, 1, 0); this.camSettled = false;
    this.flapping = false; this.spirit = false; this.lift = 0; this.sp = RAVEN_SP; this.soarDir = 1;
    this.landed = false; this.groundY = 0; this.lifting = false;
    // in the air: contacts ignored for noLand s (and the plant `leftRec` for leftT s); a falling start off a branch (dropV,
    // m/s); a bounce's cool-down
    this.noLand = 0; this.leftRec = null; this.leftT = 0; this.dropV = 0; this.bounceT = 0; this.perches = null;
    // on the ground or a branch: body heading (yaw; this.yaw is the look), feet height, the gait (phase, amp: steps and
    // hops), a hop under way (hop 1: turning, 2: moving; hopU 0..1), the take-off's wing lift (lift 0..1, -1 none), a peck
    // (1..0); perch: null on the ground, else { rec, st, s } (perch.js: the plant, its stem, the arc length along it);
    // the touchdown's slide (from x, y, z, yaw to the perch)
    this.gnd = { yaw: 0, feet: 0, phase: 0, amp: 0, hop: 0, hopU: 1, hop0: 0, yawFrom: 0, yawTo: 0, hopT: TURN_HOP_T,
      hx: 0, hz: 0, hdx: 0, hdz: 0, hy0: 0, hy1: 0, hopL: 0, hopH: 0, hopS: 0, lift: -1, liftMode: '', peck: 0, visPitch: 0, lastX: 0, lastZ: 0,
      perch: null, from: { x: 0, y: 0, z: 0, yaw: 0, look: 0 }, to: { x: 0, y: 0, z: 0, yaw: 0 }, turnHeld: 0, turnDir: 0, turned: false, gap: 0 };
    this.landT = 0; this.camDip = 0; this.actQ = false; this.launchQ = false; this.spaceQ = false; this.cut = false;
    this.camK = 0; this.camYaw = 0; this._F = { y: 0, depth: 0, pond: false, surf: null }; this._d = new THREE.Vector3(); this._from = new THREE.Vector3(); this._to = new THREE.Vector3(); this._a = {}; this._b = {};
    this.body.userData.flight = this;
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._v = new THREE.Vector3(); this._look = new THREE.Vector3();
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      this.keys.add(e.code);
      if (e.code === 'KeyH' && !this.landed) this.setHover(!this.hover);
      if (e.code === 'KeyV') this.setView(this.view === 'chase' ? 'first' : 'chase');
      if (e.code === 'Space') { if (this.landed) { if (!e.repeat) this.spaceQ = true; } else this.flap = 1; e.preventDefault(); }
      if (e.code === 'KeyE' && !e.repeat && this.landed) this.actQ = true;
      if (e.code === 'KeyX' && !e.repeat && this.landed) this.launchQ = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    dom.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => this.drag = null);
    window.addEventListener('pointermove', e => { if (!this.drag) return; this.turnLook(-(e.clientX - this.drag.x) * 0.0035); this.pitch -= (e.clientY - this.drag.y) * 0.0025; this.drag = { x: e.clientX, y: e.clientY }; });
  }
  setHover(on) {
    if (on && this.sp.soar) this.soarDir = this.roll < -0.05 ? -1 : 1;   // a soar: on round the way it banks
    this.hover = on; if (!on && this.speed < 6) this.speed = 8;
  }
  // Another bird's numbers (flierControl.js), or null for the raven's.
  setSpecies(sp) { this.sp = sp ? { ...RAVEN_SP, ...sp } : RAVEN_SP; }
  setView(v) { this.view = v; this.camSettled = false; this.body.visible = v === 'chase'; }
  // the look (see the constructor): a drag's turn goes to the head up to lookMax, the rest to the body
  turnLook(d) {
    this.look += d; const m = this.lookMax;
    if (this.look > m) { this.yaw += this.look - m; this.look = m; } else if (this.look < -m) { this.yaw += this.look + m; this.look = -m; }
    this.headYaw.value = this.look;
  }
  settleLook(dt, k = 3) { if (!this.look) return; const d = this.look * (1 - Math.exp(-dt * k)); this.yaw += d; this.look -= d; if (Math.abs(this.look) < 1e-4) this.look = 0; this.headYaw.value = this.look; }
  get lookYaw() { return this.yaw + this.look; }
  moving() { const k = this.keys; return k.has('KeyW') || k.has('KeyA') || k.has('KeyS') || k.has('KeyD') || k.has('ArrowUp') || k.has('ArrowDown') || k.has('ArrowLeft') || k.has('ArrowRight') || k.has('Space'); }
  // The zoom the cameras read: eased toward the wheel's target by the time since the last read (the controls read it
  // every frame; none of them runs this flight's update while they are on).
  get zoom() {
    const now = performance.now(), dt = Math.min(0.1, (now - this._zoomAt) / 1000); this._zoomAt = now;
    if (dt > 0) this._zoom += (this.zoomTarget - this._zoom) * (1 - Math.exp(-dt * ZOOM_EASE));
    return this._zoom;
  }
  set zoom(v) { this._zoom = this.zoomTarget = Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], v)); }
  // Height of the terrain as drawn this frame (tilepackage.js Heightfield.ground: the near fine mesh of the lidar
  // ground where the tile has one, else the 10 m mesh with each square split along its SW-NE diagonal), as
  // animals.js and rocks.js stand on.
  meshAt(x, z) { return this.heights.ground(x, -z); }
  // The branches of the near set (perch.js), once the vegetation is up.
  perchQuery() {
    if (!this.perches && window.__we?.veg) this.perches = new Perches(window.__we.veg, (x, z) => this.meshAt(x, z));
    return this.perches;
  }
  reset(x, z, agl = 120) {   // yaw 0 faces north (-z)
    this.pos.set(x, this.heights.atXZ(x, z) + agl, z); this.landed = this.lifting = false; this.gnd.lift = -1; this.gnd.hop = 0; this.gnd.perch = null;
    this.cut = true; this.yaw = 0; this.pitch = -0.08; this.speed = 12; this.camSettled = false; this.noLand = 0; this.dropV = 0; this.leftRec = null;
  }
  // Spirit form on or off (spirit.js): off the ground or branch at once, no wings, no pending take-off or landing.
  setSpirit(on) {
    this.spirit = !!on;
    if (!on) return;
    this.landed = this.lifting = false; this.gnd.lift = -1; this.gnd.hop = 0; this.gnd.perch = null;
    this.flap = 0; this.flapping = false; this.dropV = 0; this.noLand = 0; this.leftRec = null; this.bounceT = 0; this.lift = 0;
    this.spaceQ = this.actQ = this.launchQ = false;
  }
  update(dt) {
    this.lookMax = this.spirit ? 0 : RAVEN_LOOK;
    if (this.spirit) { if (this.look) { this.yaw += this.look; this.look = 0; this.headYaw.value = 0; } return this.updateSpirit(dt); }
    if (this.moving()) this.settleLook(dt);
    if (this.landed) return this.updateGround(dt);
    const k = this.keys, sp = this.sp, turn = sp.turn, pitchRate = 1.0, soar = !!sp.soar && this.hover;
    let yawIn = (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0);
    let pitchIn = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    this.yaw += yawIn * turn * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchIn * pitchRate * dt, -1.2, 0.9);
    if (!pitchIn) this.pitch = THREE.MathUtils.lerp(this.pitch, -0.05, 1 - Math.exp(-dt * 0.15));  // settle toward a shallow glide, slowly (~7 s)
    this.roll = THREE.MathUtils.lerp(this.roll, yawIn * 0.6, 1 - Math.exp(-dt * 1.0));   // bank into the turn: left turn dips the left wing
    // W speeds up to sp.fast (a pace the bird holds; the true top sp.vmax is the sprint's, or a dive's); S slows to a stop
    // and, if held on past zero for half a second, backs up. Shift is the sprint: full speed for sp.sprint s, then the
    // wings are tired until they come back over sp.recover s (owner, 2026-10-29: every animal's top is not its top).
    const boost = (k.has('ShiftLeft') || k.has('ShiftRight')) && !this.tired, fast = sp.fast ?? sp.cruise * 1.5;
    if (k.has('KeyW')) { this.hover = false; if (this.speed < fast) this.speed = Math.min(fast, this.speed + 8 * dt); }
    if (boost) { this.hover = false; this.speed += 20 * dt; }
    { const sprinting = boost && this.speed > sp.cruise * 1.2;
      this.stamina = Math.max(0, Math.min(1, this.stamina + (sprinting ? -dt / (sp.sprint || 8) : dt / (sp.recover || 30))));
      if (this.stamina <= 0) this.tired = true; else if (this.stamina > 0.5) this.tired = false; }
    if (k.has('KeyS')) {
      if (this.speed > 0.4) { this.speed = Math.max(0, this.speed - 8 * dt); this.sDwell = 0; }
      else if (this.speed >= -0.01 && (this.sDwell += dt) < 0.5) this.speed = 0;    // pause at zero: hover
      else this.speed = Math.max(-6, this.speed - 5 * dt);                           // then reverse
    } else this.sDwell = 0;
    if (soar) {   // the soar: the circle's turn and bank, its speed, the nose level (a drag or the arrows still pitch it)
      const S = sp.soar, w = S.v / S.r, bank = this.soarDir * Math.atan(S.v * S.v / (9.8 * S.r)) * 1.3;
      const teeter = S.teeter ? 0.2 * Math.sin(performance.now() * 0.0017) + 0.09 * Math.sin(performance.now() * 0.0033) : 0;
      // round the circle; A / D tighten it (the way it turns) or open it, in place of their own turn
      this.yaw += this.soarDir * w * (1 + 0.6 * yawIn * this.soarDir) * dt - yawIn * turn * dt;
      this.roll = THREE.MathUtils.lerp(this.roll, bank * (1 + 0.5 * yawIn * this.soarDir) + teeter, 1 - Math.exp(-dt * 1.5));
      if (!pitchIn && !this.drag) this.pitch = THREE.MathUtils.lerp(this.pitch, 0.02, 1 - Math.exp(-dt * 1.5));
      this.speed = THREE.MathUtils.lerp(this.speed, S.v, 1 - Math.exp(-dt * 0.8));
    } else if (this.hover) this.speed = THREE.MathUtils.lerp(this.speed, 0, 1 - Math.exp(-dt * 2.5));
    const gliding = this.speed > 4 && !this.hover;
    if (gliding) {
      // Diving speeds up, climbing slows down; a glide settles toward cruise.
      this.speed += -Math.sin(this.pitch) * 6 * dt - (this.speed - sp.cruise) * 0.15 * dt;
    }
    this.speed = THREE.MathUtils.clamp(this.speed, -6, sp.vmax);
    const holding = this.hover || Math.abs(this.speed) < 1.0;   // near zero: hold altitude like hover
    // Attitude first, then fly along the direction the bird actually points, so view and motion never disagree.
    this._q.setFromEuler(this._e.set(this.pitch, this.yaw, 0));
    const dir = this._v.set(0, 0, -1).applyQuaternion(this._q);
    const from = this._from.copy(this.pos);
    this.pos.addScaledVector(dir, this.speed * dt);
    this.pos.y += (this.flap * sp.flap - (holding ? 0 : sp.sink) + (soar ? sp.soar.lift || 0 : 0) + this.dropV) * dt;     // flap climbs, gliding sinks slowly, hovering holds (a soar rises in its thermal)
    this.dropV *= Math.exp(-dt * 2.5);
    const vert = (k.has('KeyX') ? 1 : 0) - (k.has('KeyZ') ? 1 : 0);   // X climbs, Z descends
    this.pos.y += vert * sp.climb * dt;
    this.flap = Math.max(0, this.flap - dt * 2.5);
    // Wings work when the bird is climbing, driving, hovering or too slow to glide; otherwise it glides.
    this.flapping = this.flap > 0 || vert > 0 || boost || k.has('KeyW') || (this.pitch > 0.12 && !soar) || (!gliding && !soar);
    this.noLand = Math.max(0, this.noLand - dt); this.bounceT = Math.max(0, this.bounceT - dt);
    if ((this.leftT -= dt) <= 0) this.leftRec = null;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, 50, this.heights.size - 50);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -this.heights.size + 50, -50);
    // After a take-off from the ground the bird climbs out to 2 m before it is free.
    const ground = this.heights.atXZ(this.pos.x, this.pos.z), mesh = this.meshAt(this.pos.x, this.pos.z);
    if (holding) this.lifting = false;
    if (this.lifting) {
      this.pos.y = Math.min(Math.max(ground, mesh) + 2, this.pos.y + 6 * dt);
      if (this.pos.y >= Math.max(ground, mesh) + 2 - 1e-3) this.lifting = false;
    }
    // contacts along the frame's move, every SWEEP m (a long frame or a fast dive must not pass through a limb)
    const to = this._to.copy(this.pos), n = Math.max(1, Math.ceil(from.distanceTo(to) / SWEEP));
    for (let i = 1; i <= n; i++) {
      this.pos.lerpVectors(from, to, i / n); this.hitNow = false;
      this.contacts(dir, holding);
      if (this.landed) return this.updateGround(0);
      if (this.hitNow) break;
    }
    this.groundY = mesh;
    this.body.quaternion.copy(this._q); this.body.rotateZ(this.roll);
    this.updateCamera(dt, dir);
    this.hud(dt);
    return { hover: holding, agl: this.pos.y - ground, elev: this.pos.y, speed: this.speed, heading: ((Math.atan2(dir.x, -dir.z) * 180 / Math.PI) + 360) % 360 };
  }
  // The wisp's flight (see the header): the raven's attitude keys, its own speeds, no contacts.
  updateSpirit(dt) {
    const k = this.keys, turn = 1.6, pitchRate = 1.2;
    const yawIn = (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0);
    const pitchIn = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    this.yaw += yawIn * turn * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchIn * pitchRate * dt, -1.3, 1.1);
    if (!pitchIn && !this.drag) this.pitch = THREE.MathUtils.lerp(this.pitch, 0, 1 - Math.exp(-dt * 0.3));   // levels out, slowly
    this.roll = THREE.MathUtils.lerp(this.roll, yawIn * 0.5, 1 - Math.exp(-dt * 2));
    const boost = k.has('ShiftLeft') || k.has('ShiftRight'), push = k.has('KeyW') || boost, slow = k.has('KeyS');
    const ramp = hold => SPIRIT_RAMP[0] * Math.pow(SPIRIT_RAMP[1] / SPIRIT_RAMP[0], Math.min(1, hold / SPIRIT_RAMP_T));   // the rate per second, exponential in the hold
    if (push) {
      this.hover = false;
      if (!this.wHold) this.speed = Math.min(SPIRIT_MAX, Math.max(this.speed, 0) + SPIRIT_TAP);   // the tap
      this.wHold = (this.wHold || 0) + dt;
      this.speed += (SPIRIT_MAX - this.speed) * Math.min(1, (boost ? 2 : 1) * ramp(this.wHold) * dt);   // eases into the top
    } else this.wHold = 0;
    if (slow) {
      if (!this.sHold && this.speed > 0.4) this.speed = Math.max(0, this.speed - SPIRIT_TAP);   // the tap
      this.sHold = (this.sHold || 0) + dt;
      const r = Math.min(1, ramp(this.sHold) * dt);
      if (this.speed > 0.4) { this.speed = Math.max(0, this.speed - this.speed * r); this.sDwell = 0; }
      else if (this.speed >= -0.01 && (this.sDwell += dt) < 0.5) this.speed = 0;
      else this.speed += (-SPIRIT_BACK - this.speed) * r;   // eases into the bottom (backing)
    } else this.sHold = 0;
    if (!slow) this.sDwell = 0;
    if (this.hover) this.speed = THREE.MathUtils.lerp(this.speed, 0, 1 - Math.exp(-dt * 3));
    else if (!push && !k.has('KeyS') && this.speed > 4) this.speed += (SPIRIT_CRUISE - this.speed) * (1 - Math.exp(-dt * 0.7));   // back to cruise
    const holding = this.hover || Math.abs(this.speed) < 1.0;
    this._q.setFromEuler(this._e.set(this.pitch, this.yaw, 0));
    const dir = this._v.set(0, 0, -1).applyQuaternion(this._q);
    const P = this.pos;
    P.addScaledVector(dir, this.speed * dt);
    if (this.flap > 0) { this.lift = Math.max(this.lift, 10); this.flap = 0; }   // space: a lift (no wingbeat, nothing for the sound's wings)
    const vert = (k.has('KeyX') ? 1 : 0) - (k.has('KeyZ') ? 1 : 0);
    P.y += (vert * 16 + this.lift) * dt;
    this.lift *= Math.exp(-dt * 3);
    this.flapping = false;
    P.x = THREE.MathUtils.clamp(P.x, 50, this.heights.size - 50);
    P.z = THREE.MathUtils.clamp(P.z, -this.heights.size + 50, -50);
    // over the ground and water, never into them
    const ground = this.heights.atXZ(P.x, P.z), mesh = this.meshAt(P.x, P.z);
    let floor = Math.max(ground, mesh);
    if (P.y < floor + SPIRIT_FLOOR + 3) { const F = this.footing(P.x, P.z, P.y + 1); if (F.surf != null && F.depth > 0.005) floor = Math.max(floor, F.surf); }
    if (P.y < floor + SPIRIT_FLOOR) P.y = floor + SPIRIT_FLOOR;
    this.groundY = mesh;
    this.body.quaternion.copy(this._q); this.body.rotateZ(this.roll);
    this.updateCamera(dt, dir);
    this.hud(dt);
    return { hover: holding, agl: P.y - ground, elev: P.y, speed: this.speed, heading: ((Math.atan2(dir.x, -dir.z) * 180 / Math.PI) + 360) % 360 };
  }
  // ---- contact: take hold of the ground or a branch, or bounce off ---------------------------------------
  contacts(dir, holding) {
    const P = this.pos, sp = this.sp, slow = Math.abs(this.speed) < sp.attachV, free = this.noLand <= 0, CG = sp.contactG;
    // the ground: the drawn terrain or a rock's top under the body; water deeper than WADE is skimmed at its surface
    const mesh = this.meshAt(P.x, P.z);
    if (P.y - mesh < CG + 3) {
      const F = this.footing(P.x, P.z, P.y), floor = (F.depth > WADE && F.surf != null ? F.surf : F.y);
      if (P.y < floor + CG) {
        const y = free && slow ? this.standAt(P.x, P.z, F.y, 1e3) : null;
        if (y !== null) return this.enterGround(null, y);
        P.y = floor + CG; this.hitNow = true;
        this.bounce(dir, 0, 1, 0, 0.1);
      }
    }
    // a branch: the closest wood surface within CONTACT_B of the body
    const Q = this.perchQuery(); if (!Q) return;
    let h = slow && free ? Q.near(P.x, P.y, P.z, CONTACT_B, undefined, this.leftRec, true, sp.perch) : null;   // a limb to stand on first
    if (h && h.perch) {
      // on the limb at the contact, or the nearest point along it a bird can stand on (clear of the parent limb)
      let s = NaN;
      for (let d = 0; d <= 0.6 + 1e-6 && s !== s; d += 0.05) for (const q of d ? [h.s + d, h.s - d] : [h.s]) if (s !== s && Q.perchable(h.rec, h.stem, q, this._a, this.sp.perch)) s = q;
      if (s === s) return this.enterGround({ rec: h.rec, st: h.stem, s }, 0);
    }
    h = Q.near(P.x, P.y, P.z, CONTACT_B, undefined, this.leftRec);
    if (!h) return;
    // bounce: out of the bark, the velocity reflected about the normal (a bump against a limb that will not hold it)
    const out = CONTACT_B - h.gap; this.hitNow = true;
    P.x += h.nx * out; P.y += h.ny * out; P.z += h.nz * out;
    this.bounce(dir, h.nx, h.ny, h.nz, -1);
  }
  // Mirror the flight direction about the normal n when it runs into it (a flare: the wings open, BOUNCE_KEEP of the
  // speed kept); minPitch >= 0 noses the bird up off the ground (a skim along it: as the old flight floor).
  bounce(dir, nx, ny, nz, minPitch) {
    const sp = this.speed, vx = dir.x * sp, vy = dir.y * sp + this.dropV, vz = dir.z * sp, vn = vx * nx + vy * ny + vz * nz;
    if (minPitch >= 0) this.pitch = Math.max(this.pitch, minPitch * 0.5);
    this.dropV = Math.max(0, this.dropV);
    if (vn >= -0.5 || sp < 0.5) return;   // grazing, or barely moving: pushed out only
    if (this.bounceT > 0) return;
    this.bounceT = 0.25;
    const wx = vx - 2 * vn * nx, wy = vy - 2 * vn * ny, wz = vz - 2 * vn * nz, w = Math.hypot(wx, wy, wz);
    if (sp > 0 && w > 0.5) {
      this.speed = sp * BOUNCE_KEEP; this.yaw = yawOf(wx, wz);
      this.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(wy / w, -1, 1)), -1.0, 0.9);
      if (minPitch >= 0) this.pitch = Math.max(this.pitch, minPitch);
    } else this.speed *= BOUNCE_KEEP;
    this.flap = 1; this.hover = false;   // the flare
  }
  // ---- on the ground or a branch ----------------------------------------------------------------------
  // perch: null for the ground (feet at `feet`), or { rec, st, s } for a branch. The bird slides from where it is to
  // the perch over FOLD_T (raven.js folds the wings meanwhile), its heading turning to the limb's.
  enterGround(perch, feet) {
    const G = this.gnd, P = this.pos, Q = this.perches;
    G.from.x = P.x; G.from.y = P.y; G.from.z = P.z; G.from.yaw = this.yaw; G.from.look = this.yaw;
    if (perch) {
      const a = Q.top(perch.st, perch.s, this._a);
      feet = a.y; G.to.x = a.x; G.to.z = a.z;
      const along = yawOf(a.dx, a.dz);   // along toward the tip, or back toward the trunk: whichever is nearer the heading
      G.to.yaw = Math.abs(wrap(along - this.yaw)) <= Math.PI / 2 ? along : wrap(along + Math.PI);
      if (Math.hypot(a.dx, a.dz) < 0.2) G.to.yaw = this.yaw;
    } else { G.to.x = P.x; G.to.z = P.z; G.to.yaw = this.yaw; }
    G.to.y = feet + this.sp.landH; G.perch = perch;
    G.yaw = this.yaw; G.feet = feet; G.hop = 0; G.hopU = 1; G.amp = 0; G.lift = -1; G.peck = 0; G.turnHeld = 0; G.turned = false; G.gap = 0;
    G.visPitch = this.pitch; G.lastX = G.to.x; G.lastZ = G.to.z;
    this.landed = true; this.groundY = feet;
    this.landT = 0; this.speed = 0; this.flap = 0; this.flapping = false; this.lifting = false; this.hover = false; this.dropV = 0;
    this.spaceQ = this.actQ = this.launchQ = false;
    this.camDip = perch ? 0.12 : 0.06;
  }
  // Standing at once (spirit.js: a raven taken over where it stood, on the ground or a limb): enterGround without the
  // touchdown's slide, fold and dip, as if it had settled there a while ago.
  settleOn(perch, feet) {
    this.enterGround(perch, feet);
    const G = this.gnd;
    this.pos.set(G.to.x, G.to.y, G.to.z); G.yaw = this.yaw = G.to.yaw; G.lastX = G.to.x; G.lastZ = G.to.z;
    this.landT = SETTLE; this.camDip = 0; this.cut = true;
  }
  // A limb a raven can stand on within r of (x, y, z) (as a contact finds one), or null.
  perchNear(x, y, z, r) {
    const Q = this.perchQuery(); if (!Q) return null;
    const h = Q.near(x, y, z, Math.min(r, 1.5), undefined, null, true, this.sp.perch);
    if (!h || !h.perch) return null;
    let s = NaN;
    for (let d = 0; d <= 0.6 + 1e-6 && s !== s; d += 0.05) for (const q of d ? [h.s + d, h.s - d] : [h.s]) if (s !== s && Q.perchable(h.rec, h.stem, q, this._a, this.sp.perch)) s = q;
    return s === s ? { rec: h.rec, st: h.stem, s } : null;
  }
  // Where the feet go at (x, z) below `from`: the drawn terrain, a close rock's top, or a creek or pond bed, and the
  // water's depth and surface there (the squirrel controller's footing(); without it, the terrain mesh).
  footing(x, z, from) {
    const F = this._F, sq = window.__we?.squirrel;
    if (sq?.footing) { const s = sq.footing(x, z, from); F.depth = s.depth; F.y = s.depth > 0.005 ? s.bed : s.y; F.pond = s.depth > 0.005 && !s.stream; F.surf = s.surf ?? null; }
    else { F.y = this.meshAt(x, z); F.depth = 0; F.pond = false; F.surf = null; }
    return F;
  }
  // The feet height at (x, z) when coming from feet height `y`, or null: a step higher than `up`, water deeper than
  // WADE, or pond water more than SHORE from dry ground (the lidar flattens a pond's bed to within centimetres of its
  // level, so its depth says little: a raven wades only at the edge).
  standAt(x, z, y, up) {
    const S = this.heights.size;
    if (x < 50 || x > S - 50 || z > -50 || z < -S + 50) return null;
    const F = this.footing(x, z, y + 2), fy = F.y;
    if (F.depth > WADE || fy > y + up) return null;
    if (F.depth > 0.005 && F.pond) {
      let dry = false;
      for (let k = 0; k < 8 && !dry; k++) { const a = k * Math.PI / 4; dry = this.footing(x + Math.cos(a) * SHORE, z + Math.sin(a) * SHORE, y + 2).depth <= 0.005; }
      if (!dry) return null;
    }
    return fy;
  }
  // A hop forward (sign 1) or back (-1). On the ground: as far as the length that the ground lets it (every 0.15 m of
  // the way no higher than HOP_UP, no deep water, no landing on a high rock), the arc raised to clear whatever it passes
  // over. On a branch: along the limb, the way the body faces along it, as far as it stays perchable; facing across the
  // limb, or at its end, a hop on the spot.
  hop(sign) {
    const G = this.gnd, sp = this.sp, x = this.pos.x, z = this.pos.z, len = sign > 0 ? sp.hopLen : sp.hopBack;
    const fx = -Math.sin(G.yaw) * sign, fz = -Math.cos(G.yaw) * sign;
    let L = 0, y1 = G.feet, h = sp.hopH, tx = x, tz = z, yawTo = G.yaw;
    if (G.perch) {
      const B = G.perch, Q = this.perches, a = Q.at(B.st, B.s, this._a), hl = Math.hypot(a.dx, a.dz);
      const c = hl > 1e-3 ? (a.dx * fx + a.dz * fz) / hl : 0;
      let s1 = B.s;
      if (Math.abs(c) > 0.4) s1 = Q.stepAlong(B.rec, B.st, B.s, Math.sign(c), len, this._b, sp.perch);
      const t = Q.top(B.st, s1, this._b);
      tx = t.x; tz = t.z; y1 = t.y; L = Math.hypot(tx - x, tz - z);
      B.s = s1;
      // the body keeps to the limb as it bends (when it faces along it)
      const along = yawOf(t.dx, t.dz), al = Math.abs(wrap(along - G.yaw)) <= Math.PI / 2 ? along : wrap(along + Math.PI);
      if (Math.abs(wrap(al - G.yaw)) < 0.4) yawTo = al;
    } else {
      const ys = [];
      for (const l of [len, len * 0.75, len * 0.5, len * 0.25]) {
        ys.length = 0;
        const n = Math.round(l / 0.15), step = l / n;
        for (let i = 1; i <= n; i++) { const y = this.standAt(x + fx * step * i, z + fz * step * i, G.feet, HOP_UP); if (y === null) break; ys.push(y); }
        if (ys.length === n) { L = l; y1 = ys[n - 1]; break; }
      }
      for (let k = 0; k < ys.length - 1 && L; k++) { const u = (k + 1) / ys.length; h = Math.max(h, (ys[k] + 0.06 - (G.feet + (y1 - G.feet) * u)) / Math.sin(Math.PI * u)); }
      tx = x + fx * L; tz = z + fz * L;
    }
    Object.assign(G, { hop: 2, hopU: 0, hx: x, hz: z, hdx: tx - x, hdz: tz - z, hy0: G.feet, hy1: y1, hopL: L, hopH: Math.min(h, 0.6), hopS: sign,
      yawFrom: G.yaw, yawTo, hop0: Math.round(G.phase / TAU) * TAU });
  }
  // A hop round (both feet) by `ang`, or (stepped) a shuffle round on the spot; the look turns with the body.
  turn(ang, stepped) {
    const G = this.gnd;
    Object.assign(G, { hop: 1, hopU: 0, yawFrom: G.yaw, yawTo: G.yaw + ang, hopT: stepped ? STEP_T : TURN_HOP_T, stepped, hop0: Math.round(G.phase / TAU) * TAU });
    this.yaw += ang;
  }
  // E: an acorn within reach of the bill: on the ground within PICK_R, on a branch one in the crown within PICK_BRANCH
  // (acorns.js, the game's own pickup event, as the squirrel's E)
  peck() {
    const G = this.gnd, A = window.__we?.acorns; G.peck = 1; G.peckT = 0.45;
    const bx = this.pos.x - Math.sin(G.yaw) * 0.3, bz = this.pos.z - Math.cos(G.yaw) * 0.3;
    const AN = window.__we?.animals;   // the raven's strike at prey within reach of the bill, or its feed at a carcass: the stabs (STAB_N)
    if (!G.perch && AN?.observer === 'corvus_corax' && AN.preyNear) {
      const p = AN.preyNear(bx, G.feet, bz, null, NaN), k = p ? null : AN.feedNear?.(bx, G.feet, bz);
      if (p || k) { G.stab = STAB_N; G.stabAt = p || k; G.stabPrey = !!p; G.peckT = STAB_T; return p || k; }
    }
    if (!A?.running || !A.player || A.player.carrying >= A.player.cap || !A.acornNear) return null;
    const a = G.perch ? A.acornNear(bx, G.feet + 0.25, bz, PICK_BRANCH, true) : A.acornNear(bx, G.feet + 0.03, bz, PICK_R, null);
    if (a) A.playerPick(a);
    return a;
  }
  // The last stab of a series (peck): the kill of the prey within reach of the bill, or the feed at the carcass, fills the
  // belly (needs.js) and says so (the ground control's toast).
  stabDone() {
    const G = this.gnd, AN = window.__we?.animals, M = window.__weWorld?.()?.m, N = M?.needs, say = t => M?.ground?.say?.(t);
    const bx = this.pos.x - Math.sin(G.yaw) * 0.3, bz = this.pos.z - Math.cos(G.yaw) * 0.3, at = G.stabAt; G.stabAt = null;   // (peckT stays the stab's for the last dip; the next peck() resets it)
    if (!AN) return;
    if (G.stabPrey) { const c = AN.catchNear(bx, G.feet, bz); if (c) { N?.fed?.(); say(`took a ${AN.speciesList()[c.sp]?.one || 'prey'}`); } else say('the stab misses'); }
    else if (at && this.fedAt !== at) { this.fedAt = at; N?.fed?.(); say(`fed at the ${AN.speciesList()[at.sp]?.one || 'carcass'}`); }
  }
  takeOff() {
    const G = this.gnd, up = G.liftMode === 'x', branch = !!G.perch;
    G.lift = -1; G.hop = 0;
    this.landed = false; this.flap = 1; this.flapping = true; this.noLand = NO_LAND;
    if (branch) { this.leftRec = G.perch.rec; this.leftT = 1.0; }
    this.lifting = !up && !branch;
    if (up) { this.hover = true; this.speed = 0; }                                      // straight up into a hover (X held climbs on)
    else if (branch) { this.hover = false; this.speed = 7; this.pitch = -0.1; this.dropV = -2; this.flap = 0.5; }   // off the limb: a drop, then a glide
    else { this.hover = false; this.speed = 6; }                                        // forward and up to 2 m
    G.perch = null;
  }
  updateGround(dt) {
    const k = this.keys, G = this.gnd, P = this.pos, B = G.perch;
    this.landT += dt;
    if (Math.hypot(P.x - G.lastX, P.z - G.lastZ) > 3) { G.perch = null; G.feet = this.footing(P.x, P.z, P.y + 50).y; G.hop = 0; G.to.x = P.x; G.to.z = P.z; this.landT = Math.max(this.landT, SETTLE); }   // moved from outside (goto, the map)
    const ready = this.landT >= SETTLE && G.lift < 0;
    // the look: the arrows, a drag, or Shift with W A S D (the head follows)
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    const lookIn = (k.has('ArrowLeft') || shift && k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || shift && k.has('KeyD') ? 1 : 0);
    const pitchIn = (k.has('ArrowUp') || shift && k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || shift && k.has('KeyS') ? 1 : 0);
    this.yaw += lookIn * 1.4 * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchIn * dt, -1.2, 0.9);
    this.roll *= Math.exp(-dt * 8);
    // A / D: held, hops round TURN_STEP at a time; tapped, a step round STEP_ANG
    const turnIn = shift ? 0 : (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0);
    if (turnIn && ready) {
      if (G.turnDir !== turnIn) { G.turnDir = turnIn; G.turnHeld = 0; G.turned = false; }
      G.turnHeld += dt;
      if (G.turnHeld >= TAP_T && G.hop === 0 && G.gap <= 0) { this.turn(turnIn * TURN_STEP, false); G.turned = true; }
    } else if (G.turnDir) {
      if (!G.turned && G.turnHeld > 0 && ready && G.hop === 0) this.turn(G.turnDir * STEP_ANG, true);
      G.turnDir = 0; G.turnHeld = 0; G.turned = false;
    }
    // W / S: a hop, held hop after hop
    const fwd = shift ? 0 : (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    if (fwd && ready && G.hop === 0 && G.gap <= 0 && !turnIn) this.hop(fwd);
    // take off, peck
    if (this.spaceQ) { this.spaceQ = false; if (ready) this.launch('space'); }
    if (this.launchQ) { this.launchQ = false; if (ready) this.launch('x'); }
    if (this.actQ) { this.actQ = false; if (ready && G.hop === 0) this.peck(); }
    G.peck = Math.max(0, G.peck - dt / (G.peckT || 0.45));
    if (G.stab > 0 && G.peck <= 0) {   // the next stab of the series; the last one lands the strike (the kill) or the feed
      G.stab--; G.peck = 1; G.peckT = STAB_T;
      if (G.stab === 0) this.stabDone();
    }
    G.gap = Math.max(0, G.gap - dt);
    let lift = 0;
    if (G.hop === 1) {   // a turning hop, both feet (or a step round)
      G.hopU = Math.min(1, G.hopU + dt / G.hopT);
      const h = G.hopU;
      G.yaw = G.yawFrom + wrap(G.yawTo - G.yawFrom) * smooth(h);
      lift = G.stepped ? 0 : 0.05 * Math.sin(Math.PI * h); G.phase = G.hop0 + h * TAU; G.amp = 1;
      if (h >= 1) { G.hop = 0; G.gap = HOP_GAP; }
    } else if (G.hop === 2) {   // a hop forward or back
      G.hopU = Math.min(1, G.hopU + dt / this.sp.hopT);
      const h = G.hopU, e = 0.5 * (h + smooth(h));
      P.x = G.hx + G.hdx * e; P.z = G.hz + G.hdz * e; G.feet = G.hy0 + (G.hy1 - G.hy0) * e;
      G.yaw = G.yawFrom + wrap(G.yawTo - G.yawFrom) * smooth(h);
      lift = G.hopH * Math.sin(Math.PI * h) * (G.hopL > 0.02 ? 1 : 0.4); G.phase = G.hop0 + h * TAU; G.amp = 1;
      if (h >= 1) { G.hop = 0; G.feet = G.hy1; G.gap = HOP_GAP; }
    }
    if (G.hop === 0) {
      // on the ground the body hops round when the look runs too far ahead of it (on a branch it stays along the limb)
      const gap = wrap(this.yaw - G.yaw);
      if (!B && ready && !turnIn && Math.abs(gap) > HOP_TURN_STILL) Object.assign(G, { hop: 1, hopU: 0, yawFrom: G.yaw, yawTo: G.yaw + gap, hopT: TURN_HOP_T, stepped: false, hop0: Math.round(G.phase / TAU) * TAU });
      G.amp *= Math.exp(-dt * 10);
    }
    // touchdown: from where it touched to the perch, turning to its heading there, over FOLD_T
    let y = G.feet + this.sp.landH + lift;
    if (this.landT < FOLD_T) {
      const u = smooth(Math.min(1, this.landT / FOLD_T)), F = G.from, T = G.to;
      P.x = F.x + (T.x - F.x) * u; P.z = F.z + (T.z - F.z) * u; y = F.y + (T.y - F.y) * u;
      G.yaw = F.yaw + wrap(T.yaw - F.yaw) * u; this.yaw = F.look + wrap(T.yaw - F.look) * u;
      this.pitch += (THREE.MathUtils.clamp(this.pitch, -0.35, 0.3) - this.pitch) * (1 - Math.exp(-dt * 8));   // the look comes up off a steep dive
    } else if (this.landT - dt < FOLD_T) { P.x = G.to.x; P.z = G.to.z; G.yaw = G.to.yaw; this.yaw = G.to.yaw; }
    // take-off: the wings lift for LIFT_T, the nose comes up (down, off a branch), then off
    if (G.lift >= 0) {
      G.lift += dt / LIFT_T;
      const pitchTo = G.liftMode === 'x' ? 0.05 : B ? -0.15 : 0.12;
      this.pitch += (pitchTo - this.pitch) * (1 - Math.exp(-dt * 15));
    }
    P.y = y;
    G.lastX = P.x; G.lastZ = P.z;
    this.groundY = G.feet; this.speed = 0; this.flap = 0; this.flapping = false;
    // the body level (the flying model, while it folds) and on its own heading, the bank easing out; pitched as it takes off
    G.visPitch += ((G.lift >= 0 ? this.pitch : 0) - G.visPitch) * (1 - Math.exp(-dt * 12));
    this.body.quaternion.setFromEuler(this._e.set(G.visPitch, G.yaw, 0)); this.body.rotateZ(this.roll);
    this._q.setFromEuler(this._e.set(this.pitch, this.yaw, 0));
    const dir = this._v.set(0, 0, -1).applyQuaternion(this._q);
    if (G.lift >= 1) this.takeOff();
    this.updateCamera(dt, dir);
    this.hud(dt);
    const ground = this.heights.atXZ(P.x, P.z);
    return { hover: true, agl: P.y - ground, elev: P.y, speed: G.hop === 2 ? G.hopL / this.sp.hopT : 0, heading: ((Math.atan2(dir.x, -dir.z) * 180 / Math.PI) + 360) % 360 };
  }
  launch(mode) {
    const G = this.gnd; if (G.lift >= 0) return;
    G.lift = 0; G.liftMode = mode;
    this.yaw = G.yaw;   // off along the body (the camera eases round to it)
  }
  // A HUD row (added to #hud): where the bird stands, while it stands.
  hud(dt) {
    if ((this.hudT = (this.hudT || 0) + dt) < 0.15 && dt) return;
    this.hudT = 0;
    if (this.hudRow === undefined) {
      const hud = document.getElementById('hud');
      this.hudRow = hud ? Object.assign(document.createElement('div'), { className: 'row wide', innerHTML: '<span>landed</span><b></b>' }) : null;
      if (this.hudRow) { this.hudRow.style.display = 'none'; const h1 = hud.querySelector('h1'); if (h1) h1.after(this.hudRow); else hud.prepend(this.hudRow); }
    }
    if (!this.hudRow) return;
    const G = this.gnd, on = this.landed;
    this.hudRow.style.display = on ? '' : 'none';
    if (!on) return;
    const name = G.perch && this.perches.nameOf(G.perch.rec);
    const text = G.perch ? `perched on ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}, ${Math.max(1, Math.round(G.feet - this.meshAt(this.pos.x, this.pos.z)))} m up` : 'on the ground';
    const b = this.hudRow.lastChild; if (b.textContent !== text) b.textContent = text;
  }
  updateCamera(dt, dir) {
    const cam = this.camera;
    // camK: 0 the flight set-up, 1 the ground's (lower, closer, a three-quarter view); eased both ways
    const gk = this.camK += ((this.landed ? 1 : 0) - this.camK) * (1 - Math.exp(-dt * 4));
    this.camYaw = gk < 1e-3 ? this.yaw : this.camYaw + wrap(this.yaw - this.camYaw) * (1 - Math.exp(-dt * 6));
    if (this.view === 'first') {
      cam.position.copy(this.pos); cam.quaternion.copy(this._q); cam.rotateZ(this.roll);
      return;
    }
    // Chase: behind and above in the bird's heading frame, following the pitch only partly so a dive
    // still shows the ground ahead. Smoothed, so banks and turns read as a pursuit, not a stick.
    const perched = this.landed && this.gnd.perch ? 1 : 0;
    this.camP = (this.camP || 0) + (perched - (this.camP || 0)) * (1 - Math.exp(-dt * 3));   // perched: closer in (less of the crown between)
    const L = THREE.MathUtils.lerp, c = this.spirit ? 1 : this.sp.cam;   // c: the camera's scale for another bird (sp.cam)
    const z = this.zoom, back = L(L(5.5, 2.5, gk), 1.7, this.camP) * c * z, up = L(L(1.6, 0.8, gk), 0.55, this.camP) * c * z, lookAhead = L(6, 0.8, gk) * c, yaw = this.camYaw + 0.4 * gk + this.look;
    const cp = Math.cos(this.pitch * 0.5), sp = Math.sin(this.pitch * 0.5);
    // Smooth the offset from the bird, not the camera position, so forward flight never lags the bird out of frame.
    const off = this._look.set(Math.sin(yaw) * cp, -sp, Math.cos(yaw) * cp).multiplyScalar(back);
    off.y += up;
    if (!this.camSettled) { this.camOff.copy(off); this.camSettled = true; }
    else this.camOff.lerp(off, 1 - Math.exp(-dt * 6));
    cam.position.copy(this.pos).add(this.camOff);
    if (this.camP > 0.01 && this.perches) {   // perched: brought in short of any limb between it and the bird
      for (let i = 0; i < 4 && this.perches.near(cam.position.x, cam.position.y, cam.position.z, 0.35, 0.03); i++) cam.position.lerp(this.pos, 0.3);
    }
    let ground = this.heights.atXZ(cam.position.x, cam.position.z);
    if (gk > 1e-3) ground = Math.max(ground, this.meshAt(cam.position.x, cam.position.z));
    const clear = L(1.5, 0.3, gk) * Math.min(1, c);
    if (this.landed && this.landT < 0.6) cam.position.y -= this.camDip * Math.sin(Math.PI * this.landT / 0.6) * (1 - this.landT / 0.6);   // the landing's dip
    if (cam.position.y < ground + clear) cam.position.y = ground + clear;
    if (gk > 1e-3) {   // on the ground: aim along the eased camera heading
      const cy = Math.cos(this.pitch);
      dir = this._d.set(-Math.sin(this.camYaw) * cy, Math.sin(this.pitch), -Math.cos(this.camYaw) * cy).lerp(dir, 1 - gk);
    }
    if (this.look) { const c = Math.cos(this.look), sn = Math.sin(this.look); dir = this._d2.set(dir.x * c + dir.z * sn, dir.y, dir.z * c - dir.x * sn); }   // the aim turned by the look
    const aim = this._look.copy(this.pos).addScaledVector(dir, lookAhead); aim.y += L(0.3, 0.05, gk);
    if (this.spirit) {   // the spirit in the lower third of the frame (owner, 2026-10-27; as the walkers, groundControl.js FRAME_Y): the
      // pitch from the line to the wisp, looking SPIRIT_FRAME of the half view above it, plus half the wisp's own pitch; the yaw the aim's
      const hd = Math.hypot(this.pos.x - cam.position.x, this.pos.z - cam.position.z), ha = Math.hypot(aim.x - cam.position.x, aim.z - cam.position.z);
      const toBody = Math.atan2(this.pos.y - cam.position.y, Math.max(hd, 1e-3)), above = Math.atan(-SPIRIT_FRAME * Math.tan(cam.fov * Math.PI / 360));
      aim.y = cam.position.y + Math.max(ha, 1e-3) * Math.tan(toBody + above + this.pitch * 0.5);
    }
    // A third of the bank in the camera's up vector keeps the horizon alive without making the viewer seasick.
    this.camUp.set(Math.sin(this.roll * 0.33) * -Math.cos(this.yaw), Math.cos(this.roll * 0.33), Math.sin(this.roll * 0.33) * Math.sin(this.yaw));
    cam.up.copy(this.camUp);
    cam.lookAt(aim);
  }
}
