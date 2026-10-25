import * as THREE from 'three';
import { RAVEN_GROUND } from './animalModels.js';

// The raven: constant forward flight with pitch and yaw, a slow sink while gliding, flapping to climb,
// a hover (H, or S held to a stop) that holds position. The bird is `body` (a Group the model hangs
// from); the camera chases it from behind and a little above, or sits on it in first person (V toggles).
// Landing: hovering (or slowed to a stop), Z descends past the 2 m flight floor to the ground, and the bird stands
// there (`landed`; body at LAND_H above the rendered terrain, `groundY`, so raven.js puts the ground model's feet
// on it); A / D turn, the arrows and a drag look about. Space, X or W take off: the bird climbs back to the
// flight floor rather than jumping to it. body.userData.flight is this, for the model hanging from body.
const LAND_H = RAVEN_GROUND.bodyY;   // the body above the feet, standing (raven_ground.glb)
const TERRAIN_SPACING = 10;          // terrain.js default vertex spacing (main.js builds it with the defaults)
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
    this.body.userData.flight = this;
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._v = new THREE.Vector3(); this._look = new THREE.Vector3();
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      this.keys.add(e.code);
      if (e.code === 'KeyH') this.setHover(!this.hover);
      if (e.code === 'KeyV') this.setView(this.view === 'chase' ? 'first' : 'chase');
      if (e.code === 'Space') { this.flap = 1; e.preventDefault(); }
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
  reset(x, z, agl = 120) { this.pos.set(x, this.heights.atXZ(x, z) + agl, z); this.landed = this.lifting = false; this.yaw = 0; this.pitch = -0.08; this.speed = 12; this.camSettled = false; }  // yaw 0 faces north (-z)
  update(dt) {
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
    if (this.landed && !k.has('KeyW') && !boost) this.speed = 0;   // standing: no creep along the ground
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
    if (this.landed) this.flapping = false;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, 50, this.heights.size - 50);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -this.heights.size + 50, -50);
    this.body.quaternion.copy(this._q); this.body.rotateZ(this.roll);
    this.updateCamera(dt, dir);
    return { hover: holding, agl: this.pos.y - ground, elev: this.pos.y, speed: this.speed, heading: ((Math.atan2(dir.x, -dir.z) * 180 / Math.PI) + 360) % 360 };
  }
  updateCamera(dt, dir) {
    const cam = this.camera;
    if (this.view === 'first') {
      cam.position.copy(this.pos); cam.quaternion.copy(this._q); cam.rotateZ(this.roll);
      return;
    }
    // Chase: behind and above in the bird's heading frame, following the pitch only partly so a dive
    // still shows the ground ahead. Smoothed, so banks and turns read as a pursuit, not a stick.
    const back = 5.5, up = 1.6, lookAhead = 6;
    const cp = Math.cos(this.pitch * 0.5), sp = Math.sin(this.pitch * 0.5);
    // Smooth the offset from the bird, not the camera position, so forward flight never lags the bird out of frame.
    const off = this._look.set(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp).multiplyScalar(back);
    off.y += up;
    if (!this.camSettled) { this.camOff.copy(off); this.camSettled = true; }
    else this.camOff.lerp(off, 1 - Math.exp(-dt * 6));
    cam.position.copy(this.pos).add(this.camOff);
    const ground = this.heights.atXZ(cam.position.x, cam.position.z);
    if (cam.position.y < ground + 1.5) cam.position.y = ground + 1.5;
    const aim = this._look.copy(this.pos).addScaledVector(dir, lookAhead); aim.y += 0.3;
    // A third of the bank in the camera's up vector keeps the horizon alive without making the viewer seasick.
    this.camUp.set(Math.sin(this.roll * 0.33) * -Math.cos(this.yaw), Math.cos(this.roll * 0.33), Math.sin(this.roll * 0.33) * Math.sin(this.yaw));
    cam.up.copy(this.camUp);
    cam.lookAt(aim);
  }
}
