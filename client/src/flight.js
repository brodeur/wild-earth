import * as THREE from 'three';

// The raven: constant forward flight with pitch and yaw, a slow sink while gliding, flapping to climb.
// The bird is `body` (a Group the model hangs from); the camera chases it from behind and a little
// above, or sits on it in first person (V toggles).
export class RavenFlight {
  constructor(camera, heights, dom) {
    this.camera = camera; this.heights = heights;
    this.body = new THREE.Group();
    this.pos = this.body.position; this.yaw = 0; this.pitch = 0; this.roll = 0; this.speed = 12;
    this.keys = new Set(); this.flap = 0; this.drag = null;
    this.view = 'chase';                                  // 'chase' | 'first'
    this.camOff = new THREE.Vector3(); this.camUp = new THREE.Vector3(0, 1, 0); this.camSettled = false;
    this.flapping = false;
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._v = new THREE.Vector3(); this._look = new THREE.Vector3();
    window.addEventListener('keydown', e => {
      this.keys.add(e.code);
      if (e.code === 'Space') { this.flap = 1; e.preventDefault(); }
      if (e.code === 'KeyV') this.setView(this.view === 'chase' ? 'first' : 'chase');
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    dom.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => this.drag = null);
    window.addEventListener('pointermove', e => { if (!this.drag) return; this.yaw -= (e.clientX - this.drag.x) * 0.0035; this.pitch -= (e.clientY - this.drag.y) * 0.0025; this.drag = { x: e.clientX, y: e.clientY }; });
  }
  setView(v) { this.view = v; this.camSettled = false; this.body.visible = v === 'chase'; }
  reset(x, z, agl = 120) { this.pos.set(x, this.heights.atXZ(x, z) + agl, z); this.yaw = 0; this.pitch = -0.08; this.speed = 12; this.camSettled = false; }  // yaw 0 faces north (-z)
  update(dt) {
    const k = this.keys, turn = 1.4, pitchRate = 1.0;
    let yawIn = (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0);
    let pitchIn = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    this.yaw += yawIn * turn * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchIn * pitchRate * dt, -1.2, 0.9);
    if (!pitchIn) this.pitch = THREE.MathUtils.lerp(this.pitch, -0.05, 1 - Math.exp(-dt * 0.6));   // settle toward a shallow glide
    this.roll = THREE.MathUtils.lerp(this.roll, yawIn * 0.6, 1 - Math.exp(-dt * 4));   // bank into the turn: left turn dips the left wing
    const boost = k.has('ShiftLeft') || k.has('ShiftRight');
    if (k.has('KeyW')) this.speed += 8 * dt; if (k.has('KeyS')) this.speed -= 8 * dt;
    if (boost) this.speed += 20 * dt;
    // Diving speeds up, climbing slows down; gliding settles toward cruise.
    this.speed += -Math.sin(this.pitch) * 6 * dt - (this.speed - 12) * 0.15 * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, 5, 40);
    // Attitude first, then fly along the direction the bird actually points, so view and motion never disagree.
    this._q.setFromEuler(this._e.set(this.pitch, this.yaw, 0));
    const dir = this._v.set(0, 0, -1).applyQuaternion(this._q);
    this.pos.addScaledVector(dir, this.speed * dt);
    this.pos.y += (this.flap * 6 - 0.6) * dt;            // flap climbs, gliding sinks slowly
    const vert = (k.has('KeyX') ? 1 : 0) - (k.has('KeyZ') ? 1 : 0);   // X climbs, Z descends
    this.pos.y += vert * 9 * dt;
    this.flap = Math.max(0, this.flap - dt * 2.5);
    // Wings work when the bird is climbing or driving; otherwise it glides.
    this.flapping = this.flap > 0 || vert > 0 || boost || k.has('KeyW') || this.pitch > 0.12;
    const ground = this.heights.atXZ(this.pos.x, this.pos.z);
    if (this.pos.y < ground + 2) { this.pos.y = ground + 2; this.pitch = Math.max(this.pitch, 0.05); }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, 50, this.heights.size - 50);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -this.heights.size + 50, -50);
    this.body.quaternion.copy(this._q); this.body.rotateZ(this.roll);
    this.updateCamera(dt, dir);
    return { agl: this.pos.y - ground, elev: this.pos.y, speed: this.speed, heading: ((Math.atan2(dir.x, -dir.z) * 180 / Math.PI) + 360) % 360 };
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
