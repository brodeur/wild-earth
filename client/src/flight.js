import * as THREE from 'three';
import { RAVEN_GROUND } from './animalModels.js';

// The raven: constant forward flight with pitch and yaw, a slow sink while gliding, flapping to climb,
// a hover (H, or S held to a stop) that holds position. The bird is `body` (a Group the model hangs
// from); the camera chases it from behind and a little above, or sits on it in first person (V toggles).
// Landing: hovering (or slowed to a stop), Z descends past the 2 m flight floor to the ground, and the bird stands
// there (`landed`; body at LAND_H above its feet, `groundY`, so raven.js puts the ground model's feet on it).
// On the ground (updateGround; the first SETTLE s after touchdown the wings fold and the models swap, raven.js, and the
// keys wait): W / S walk forward and back (WALK, WALK_BACK m/s; the body turns toward the look in steps as it goes).
// A / D turn on the spot (the look turns at LOOK_TURN; the body follows in steps and hops round when it falls more than
// HOP_TURN_MOVING behind) or, walking, curve the walk (WALK_TURN, slower than the steps: no hops). The arrows and a
// drag look about (the head follows; standing still, the body hops round past HOP_TURN_STILL). Space hops forward
// HOP_LEN m with both feet; a second Space during the hop, or Space held HOLD_LAUNCH s, takes off forward; X takes off
// straight up into a hover; either way the ground model's wings lift for LIFT_T s first. E pecks: an acorn within
// PICK_R of the bill is picked up (acorns.js playerPick, as the squirrel's E). The feet follow the drawn terrain and
// the tops of close rocks, walk up slopes to MAX_SLOPE (rise over run: a steeper rock face is a wall; a hop lands up to
// HOP_UP higher), and wade into water only WADE deep and into pond water only SHORE from dry ground (the squirrel
// controller's footing(): rock tops, creek beds, pond levels). The chase camera comes down to ~0.8 m up and 2.5 m
// back, a little to one side (camK blends the two set-ups).
// body.userData.flight is this, for the model hanging from body.
const LAND_H = RAVEN_GROUND.bodyY;   // the body above the feet, standing (raven_ground.glb)
const TERRAIN_SPACING = 10;          // terrain.js default vertex spacing (main.js builds it with the defaults)
export const FOLD_T = 0.25, XFADE_T = 0.12, LIFT_T = 0.2;   // s: wings fold before the swap; the dissolve; wings lift before take-off
const SETTLE = FOLD_T + XFADE_T;
const WALK = 1.0, WALK_BACK = 0.5, WALK_ACC = 5;                       // m/s, m/s, m/s^2
const LOOK_TURN = 3.0, WALK_TURN = 1.3, STEP_TURN = 1.6, HOP_TURN_MOVING = 0.6, HOP_TURN_STILL = 1.0, TURN_HOP_T = 0.26;   // rad/s, rad/s, rad, rad, s
const HOP_LEN = 1.0, HOP_T = 0.38, HOP_H = 0.14, HOLD_LAUNCH = 0.3;     // m, s, m, s
const MAX_SLOPE = 1.5, HOP_UP = 0.45, WADE = 0.04, SHORE = 0.5, PICK_R = 0.8;   // m
const TAU = Math.PI * 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = u => u * u * (3 - 2 * u);
export class RavenFlight {
  constructor(camera, heights, dom) {
    this.camera = camera; this.heights = heights;
    this.body = new THREE.Group();
    this.pos = this.body.position; this.yaw = 0; this.pitch = 0; this.roll = 0; this.speed = 12;
    this.keys = new Set(); this.flap = 0; this.drag = null; this.hover = false; this.sDwell = 0;
    this.view = 'chase';                                  // 'chase' | 'first'
    this.camOff = new THREE.Vector3(); this.camUp = new THREE.Vector3(0, 1, 0); this.camSettled = false;
    this.flapping = false;
    this.landed = false; this.groundY = 0; this.lifting = false; this.wasHolding = false;
    // on the ground: body heading (yaw; this.yaw is the look), walking speed v, feet height, the gait (phase, amp), a hop
    // under way (hop 1: turning, 2: forward; hopU 0..1), the take-off's wing lift (lift 0..1, -1 none), a peck (1..0)
    this.gnd = { yaw: 0, v: 0, feet: 0, vy: 0, phase: 0, amp: 0, hop: 0, hopU: 1, hop0: 0, yawFrom: 0, yawTo: 0,
      hx: 0, hz: 0, hdx: 0, hdz: 0, hy0: 0, hy1: 0, hopL: 0, hopH: 0, lift: -1, liftMode: '', spaceT: 0, peck: 0, visPitch: 0, lastX: 0, lastZ: 0 };
    this.landT = 0; this.spaceQ = false; this.actQ = false; this.launchQ = false; this.cut = false;
    this.camK = 0; this.camYaw = 0; this._F = { y: 0, depth: 0, pond: false }; this._d = new THREE.Vector3();
    this.body.userData.flight = this;
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._v = new THREE.Vector3(); this._look = new THREE.Vector3();
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      this.keys.add(e.code);
      if (e.code === 'KeyH') this.setHover(!this.hover);
      if (e.code === 'KeyV') this.setView(this.view === 'chase' ? 'first' : 'chase');
      if (e.code === 'Space') { if (this.landed) { if (!e.repeat) this.spaceQ = true; } else this.flap = 1; e.preventDefault(); }
      if (e.code === 'KeyE' && !e.repeat && this.landed) this.actQ = true;
      if (e.code === 'KeyX' && !e.repeat && this.landed) this.launchQ = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    dom.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => this.drag = null);
    window.addEventListener('pointermove', e => { if (!this.drag) return; this.yaw -= (e.clientX - this.drag.x) * 0.0035; this.pitch -= (e.clientY - this.drag.y) * 0.0025; this.drag = { x: e.clientX, y: e.clientY }; });
  }
  setHover(on) { this.hover = on; if (!on && this.speed < 6) this.speed = 8; }
  setView(v) { this.view = v; this.camSettled = false; this.body.visible = v === 'chase'; }
  // Height of the rendered terrain mesh (terrain.js: vertices every TERRAIN_SPACING m, each square split along its
  // SW-NE diagonal; in a hollow it runs up to ~0.6 m above the bilinear field), as animals.js and rocks.js stand on.
  meshAt(x, z) {
    const h = this.heights, S = TERRAIN_SPACING, n = Math.round(h.size / S) - 1, north = -z;
    const fx = x / S, fn = north / S, i0 = Math.min(Math.max(Math.floor(fx), 0), n), n0 = Math.min(Math.max(Math.floor(fn), 0), n);
    const u = Math.min(Math.max(fx - i0, 0), 1), w = Math.min(Math.max(fn - n0, 0), 1);
    const SW = h.at(i0 * S, n0 * S), SE = h.at((i0 + 1) * S, n0 * S), NW = h.at(i0 * S, (n0 + 1) * S), NE = h.at((i0 + 1) * S, (n0 + 1) * S);
    return w > u ? SW + u * (NE - NW) + w * (NW - SW) : SW + u * (SE - SW) + w * (NE - SE);
  }
  reset(x, z, agl = 120) { this.pos.set(x, this.heights.atXZ(x, z) + agl, z); this.landed = this.lifting = false; this.gnd.lift = -1; this.gnd.hop = 0; this.cut = true; this.yaw = 0; this.pitch = -0.08; this.speed = 12; this.camSettled = false; }  // yaw 0 faces north (-z)
  update(dt) {
    if (this.landed) return this.updateGround(dt);
    const k = this.keys, turn = 1.4, pitchRate = 1.0;
    let yawIn = (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0);
    let pitchIn = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    this.yaw += yawIn * turn * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchIn * pitchRate * dt, -1.2, 0.9);
    if (!pitchIn) this.pitch = THREE.MathUtils.lerp(this.pitch, -0.05, 1 - Math.exp(-dt * 0.15));  // settle toward a shallow glide, slowly (~7 s)
    this.roll = THREE.MathUtils.lerp(this.roll, this.landed ? 0 : yawIn * 0.6, 1 - Math.exp(-dt * (this.landed ? 4 : 1.0)));   // bank into the turn: left turn dips the left wing
    // W speeds up; S slows to a stop and, if held on past zero for half a second, backs up.
    const boost = k.has('ShiftLeft') || k.has('ShiftRight');
    if (k.has('KeyW')) { this.hover = false; this.speed += 8 * dt; }
    if (boost) { this.hover = false; this.speed += 20 * dt; }
    if (k.has('KeyS')) {
      if (this.speed > 0.4) { this.speed = Math.max(0, this.speed - 8 * dt); this.sDwell = 0; }
      else if (this.speed >= -0.01 && (this.sDwell += dt) < 0.5) this.speed = 0;    // pause at zero: hover
      else this.speed = Math.max(-6, this.speed - 5 * dt);                           // then reverse
    } else this.sDwell = 0;
    if (this.hover) this.speed = THREE.MathUtils.lerp(this.speed, 0, 1 - Math.exp(-dt * 2.5));
    const gliding = this.speed > 4 && !this.hover;
    if (gliding) {
      // Diving speeds up, climbing slows down; a glide settles toward cruise.
      this.speed += -Math.sin(this.pitch) * 6 * dt - (this.speed - 12) * 0.15 * dt;
    }
    this.speed = THREE.MathUtils.clamp(this.speed, -6, 40);
    const holding = this.hover || Math.abs(this.speed) < 1.0;   // near zero: hold altitude like hover
    // Attitude first, then fly along the direction the bird actually points, so view and motion never disagree.
    this._q.setFromEuler(this._e.set(this.pitch, this.yaw, 0));
    const dir = this._v.set(0, 0, -1).applyQuaternion(this._q);
    this.pos.addScaledVector(dir, this.speed * dt);
    this.pos.y += (this.flap * 6 - (holding ? 0 : 0.6)) * dt;     // flap climbs, gliding sinks slowly, hovering holds
    const vert = (k.has('KeyX') ? 1 : 0) - (k.has('KeyZ') ? 1 : 0);   // X climbs, Z descends
    this.pos.y += vert * 9 * dt;
    this.flap = Math.max(0, this.flap - dt * 2.5);
    // Wings work when the bird is climbing, driving, hovering or too slow to glide; otherwise it glides.
    this.flapping = this.flap > 0 || vert > 0 || boost || k.has('KeyW') || this.pitch > 0.12 || !gliding;
    const ground = this.heights.atXZ(this.pos.x, this.pos.z);
    // The flight floor is 2 m; holding (hovering or stopped) the floor is the ground itself, where the bird lands.
    // Leaving the hold below 2 m (a take-off) climbs to the floor instead of jumping to it.
    const landY = this.meshAt(this.pos.x, this.pos.z) + LAND_H;
    if (!holding && this.wasHolding && this.pos.y < ground + 2) this.lifting = true;
    if (holding) this.lifting = false;
    if (holding) { if (this.pos.y < landY) this.pos.y = landY; }
    else if (this.lifting) {
      this.pos.y = Math.min(ground + 2, Math.max(this.pos.y, landY) + 6 * dt);
      if (this.pos.y >= ground + 2 - 1e-3) this.lifting = false;
    } else if (this.pos.y < ground + 2) { this.pos.y = ground + 2; this.pitch = Math.max(this.pitch, 0.05); }
    this.wasHolding = holding;
    this.landed = holding && this.pos.y <= landY + 0.02;
    this.groundY = landY - LAND_H;
    if (this.landed) this.enterGround();
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, 50, this.heights.size - 50);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -this.heights.size + 50, -50);
    this.body.quaternion.copy(this._q); this.body.rotateZ(this.roll);
    this.updateCamera(dt, dir);
    return { hover: holding, agl: this.pos.y - ground, elev: this.pos.y, speed: this.speed, heading: ((Math.atan2(dir.x, -dir.z) * 180 / Math.PI) + 360) % 360 };
  }
  // ---- on the ground ----------------------------------------------------------------------------------
  enterGround() {
    const G = this.gnd;
    G.yaw = this.yaw; G.v = 0; G.feet = this.groundY; G.vy = 0; G.hop = 0; G.hopU = 1; G.amp = 0; G.lift = -1; G.spaceT = 0; G.peck = 0;
    G.visPitch = this.pitch; G.lastX = this.pos.x; G.lastZ = this.pos.z;
    this.landT = 0; this.speed = 0; this.flap = 0; this.flapping = false; this.lifting = false;
    this.spaceQ = this.actQ = this.launchQ = false;
  }
  // Where the feet go at (x, z) below `from`: the drawn terrain, a close rock's top, or a creek or pond bed, and the
  // water's depth there (the squirrel controller's footing(); without it, the terrain mesh).
  footing(x, z, from) {
    const F = this._F, sq = window.__we?.squirrel;
    if (sq?.footing) { const s = sq.footing(x, z, from); F.depth = s.depth; F.y = s.depth > 0.005 ? s.bed : s.y; F.pond = s.depth > 0.005 && !s.stream; }
    else { F.y = this.meshAt(x, z); F.depth = 0; F.pond = false; }
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
  // The forward hop: as far as HOP_LEN that the ground lets it (every 0.25 m of the way no higher than HOP_UP, no deep
  // water, no landing on a high rock), the arc raised to clear whatever it passes over.
  hopForward() {
    const G = this.gnd, sx = -Math.sin(G.yaw), sz = -Math.cos(G.yaw), x = this.pos.x, z = this.pos.z, ys = [];
    let L = 0, y1 = G.feet;
    for (const l of [HOP_LEN, 0.75, 0.5, 0.25]) {
      ys.length = 0;
      for (let t = 0.25; t <= l + 1e-6; t += 0.25) { const y = this.standAt(x + sx * t, z + sz * t, G.feet, HOP_UP); if (y === null) break; ys.push(y); }
      if (ys.length === Math.round(l / 0.25)) { L = l; y1 = ys[ys.length - 1]; break; }
    }
    let h = HOP_H;   // high enough over each point on the way (the arc over the straight line from foot to foot)
    for (let k = 0; k < ys.length - 1 && L; k++) { const u = (k + 1) * 0.25 / L; h = Math.max(h, (ys[k] + 0.06 - (G.feet + (y1 - G.feet) * u)) / Math.sin(Math.PI * u)); }
    Object.assign(G, { hop: 2, hopU: 0, hx: x, hz: z, hdx: sx * L, hdz: sz * L, hy0: G.feet, hy1: y1, hopL: L, hopH: Math.min(h, 0.6), v: 0, spaceT: 0, hop0: Math.round(G.phase / TAU) * TAU });
  }
  // E: an acorn on the ground within PICK_R of the bill (acorns.js, the game's own pickup event, as the squirrel's E)
  peck() {
    const G = this.gnd, A = window.__we?.acorns; G.peck = 1;
    if (!A?.running || !A.player || A.player.carrying >= A.player.cap || !A.acornNear) return null;
    const bx = this.pos.x - Math.sin(G.yaw) * 0.3, bz = this.pos.z - Math.cos(G.yaw) * 0.3;
    const a = A.acornNear(bx, G.feet + 0.03, bz, PICK_R, null);
    if (a) A.playerPick(a);
    return a;
  }
  takeOff() {
    const G = this.gnd, up = G.liftMode === 'x';
    G.lift = -1; G.hop = 0; G.v = 0;
    this.landed = false; this.wasHolding = !up; this.lifting = !up; this.flap = 1; this.flapping = true;
    if (up) { this.hover = true; this.speed = 0; }   // straight up into a hover (X held climbs on)
    else { this.hover = false; this.speed = 6; }      // forward and up to the flight floor
  }
  updateGround(dt) {
    const k = this.keys, G = this.gnd, P = this.pos;
    this.landT += dt;
    if (Math.hypot(P.x - G.lastX, P.z - G.lastZ) > 3) { G.feet = this.footing(P.x, P.z, P.y + 50).y; G.hop = 0; }   // moved from outside (goto, the map)
    const ready = this.landT >= SETTLE && G.lift < 0;
    // the look: the arrows and a drag (the head follows); A / D turn the bird
    const lookIn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    const turnIn = ready ? (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0) : 0;
    this.yaw += (lookIn * 1.4 + turnIn * (Math.abs(G.v) > 0.3 ? WALK_TURN : LOOK_TURN)) * dt;   // walking: a curve in steps
    const pitchIn = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchIn * dt, -1.2, 0.9);
    this.roll *= Math.exp(-dt * 8);
    // hop, take off, peck
    if (this.spaceQ) { this.spaceQ = false; if (ready) { if (G.hop === 2) this.launch('space'); else this.hopForward(); } }
    if (this.launchQ) { this.launchQ = false; if (ready) this.launch('x'); }
    if (G.hop === 2 && G.lift < 0 && k.has('Space') && (G.spaceT += dt) >= HOLD_LAUNCH) this.launch('space');
    if (this.actQ) { this.actQ = false; if (ready && G.hop === 0) this.peck(); }
    G.peck = Math.max(0, G.peck - dt / 0.45);
    // walking speed
    const fwd = ready && G.hop !== 2 ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : 0;
    const target = fwd > 0 ? WALK : fwd < 0 ? -WALK_BACK : 0;
    G.v += THREE.MathUtils.clamp(target - G.v, -WALK_ACC * dt, WALK_ACC * dt);
    let lift = 0, stepping = false;
    if (G.hop === 1) {   // a turning hop, both feet
      G.hopU = Math.min(1, G.hopU + dt / TURN_HOP_T);
      const h = G.hopU;
      G.yaw = G.yawFrom + wrap(G.yawTo - G.yawFrom) * smooth(h);
      lift = 0.05 * Math.sin(Math.PI * h); G.phase = G.hop0 + h * TAU; G.amp = 1;
      if (h >= 1) G.hop = 0;
    } else if (G.hop === 2) {   // the forward hop
      G.hopU = Math.min(1, G.hopU + dt / HOP_T);
      const h = G.hopU, e = 0.5 * (h + smooth(h));
      P.x = G.hx + G.hdx * e; P.z = G.hz + G.hdz * e; G.feet = G.hy0 + (G.hy1 - G.hy0) * e;
      lift = G.hopH * Math.sin(Math.PI * h) * (G.hopL > 0 ? 1 : 0.4); G.phase = G.hop0 + h * TAU; G.amp = 1;
      if (h >= 1) { G.hop = 0; G.feet = G.hy1; }
    }
    if (G.hop === 0) {
      // the body follows the look: in steps while walking or turning, in a hop when it falls too far behind
      const gap = wrap(this.yaw - G.yaw), moving = Math.abs(G.v) > 0.05 || turnIn !== 0;
      if (ready && Math.abs(gap) > (moving ? HOP_TURN_MOVING : HOP_TURN_STILL)) {
        Object.assign(G, { hop: 1, hopU: 0, yawFrom: G.yaw, yawTo: G.yaw + gap, hop0: Math.round(G.phase / TAU) * TAU });
      } else if (moving && Math.abs(gap) > 0.01) { G.yaw += THREE.MathUtils.clamp(gap, -STEP_TURN * dt, STEP_TURN * dt); stepping = true; }
      // walk
      const d = G.v * dt;
      if (Math.abs(d) > 1e-6) {
        const nx = P.x - Math.sin(G.yaw) * d, nz = P.z - Math.cos(G.yaw) * d, y = this.standAt(nx, nz, G.feet, Math.max(0.02, Math.abs(d) * MAX_SLOPE));
        if (y === null) G.v = 0;
        else {
          P.x = nx; P.z = nz;
          if (y >= G.feet - 0.04) { G.feet = y; G.vy = 0; }
          else { G.vy += 9.8 * dt; G.feet = Math.max(y, G.feet - G.vy * dt); }   // off a rock: a short drop
        }
      } else if (G.vy > 0 || G.feet > this.meshAt(P.x, P.z) + 0.02) {   // still falling from a step
        const y = this.footing(P.x, P.z, G.feet + 0.05).y;
        if (y < G.feet - 0.005) { G.vy += 9.8 * dt; G.feet = Math.max(y, G.feet - G.vy * dt); } else G.vy = 0;
      }
      const walking = Math.abs(G.v) > 0.05 || stepping;
      G.amp += ((walking ? 1 : 0) - G.amp) * (1 - Math.exp(-dt * 10));
      G.phase += dt * TAU * (2.2 + Math.abs(G.v)) * (G.v < -0.05 ? -1 : 1);
    }
    // take-off: the wings lift for LIFT_T, the nose comes up, then off
    let pitchTo = 0;
    if (G.lift >= 0) {
      G.lift += dt / LIFT_T;
      pitchTo = G.liftMode === 'x' ? 0.05 : 0.12;
      this.pitch += (pitchTo - this.pitch) * (1 - Math.exp(-dt * 15));
    }
    P.y = G.feet + LAND_H + lift;
    G.lastX = P.x; G.lastZ = P.z;
    this.groundY = G.feet; this.speed = 0; this.flap = 0; this.flapping = false;
    // the body level (the flying model, while it folds) and on its own heading; pitched up as it takes off
    G.visPitch += ((G.lift >= 0 ? this.pitch : 0) - G.visPitch) * (1 - Math.exp(-dt * 12));
    this.body.quaternion.setFromEuler(this._e.set(G.visPitch, G.yaw, 0));
    this._q.setFromEuler(this._e.set(this.pitch, this.yaw, 0));
    const dir = this._v.set(0, 0, -1).applyQuaternion(this._q);
    if (G.lift >= 1) this.takeOff();
    this.updateCamera(dt, dir);
    const ground = this.heights.atXZ(P.x, P.z);
    return { hover: true, agl: P.y - ground, elev: P.y, speed: Math.abs(G.v), heading: ((Math.atan2(dir.x, -dir.z) * 180 / Math.PI) + 360) % 360 };
  }
  launch(mode) {
    const G = this.gnd; if (G.lift >= 0) return;
    G.lift = 0; G.liftMode = mode; G.v = 0;
    this.yaw = G.yaw;   // off along the body (the camera eases round to it)
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
    const L = THREE.MathUtils.lerp, back = L(5.5, 2.5, gk), up = L(1.6, 0.8, gk), lookAhead = L(6, 0.8, gk), yaw = this.camYaw + 0.4 * gk;
    const cp = Math.cos(this.pitch * 0.5), sp = Math.sin(this.pitch * 0.5);
    // Smooth the offset from the bird, not the camera position, so forward flight never lags the bird out of frame.
    const off = this._look.set(Math.sin(yaw) * cp, -sp, Math.cos(yaw) * cp).multiplyScalar(back);
    off.y += up;
    if (!this.camSettled) { this.camOff.copy(off); this.camSettled = true; }
    else this.camOff.lerp(off, 1 - Math.exp(-dt * 6));
    cam.position.copy(this.pos).add(this.camOff);
    let ground = this.heights.atXZ(cam.position.x, cam.position.z);
    if (gk > 1e-3) ground = Math.max(ground, this.meshAt(cam.position.x, cam.position.z));
    const clear = L(1.5, 0.3, gk);
    if (cam.position.y < ground + clear) cam.position.y = ground + clear;
    if (gk > 1e-3) {   // on the ground: aim along the eased camera heading
      const cy = Math.cos(this.pitch);
      dir = this._d.set(-Math.sin(this.camYaw) * cy, Math.sin(this.pitch), -Math.cos(this.camYaw) * cy).lerp(dir, 1 - gk);
    }
    const aim = this._look.copy(this.pos).addScaledVector(dir, lookAhead); aim.y += L(0.3, 0.05, gk);
    // A third of the bank in the camera's up vector keeps the horizon alive without making the viewer seasick.
    this.camUp.set(Math.sin(this.roll * 0.33) * -Math.cos(this.yaw), Math.cos(this.roll * 0.33), Math.sin(this.roll * 0.33) * Math.sin(this.yaw));
    cam.up.copy(this.camUp);
    cam.lookAt(aim);
  }
}
