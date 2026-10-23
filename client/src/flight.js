import * as THREE from 'three';

// First-person raven: constant forward flight with pitch and yaw, a slow sink while gliding, flapping to climb.
export class RavenFlight {
  constructor(camera, heights, dom) {
    this.camera = camera; this.heights = heights;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.roll = 0; this.speed = 12;
    this.keys = new Set(); this.flap = 0; this.drag = null;
    window.addEventListener('keydown', e => { this.keys.add(e.code); if (e.code === 'Space') { this.flap = 1; e.preventDefault(); } if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault(); });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    dom.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => this.drag = null);
    window.addEventListener('pointermove', e => { if (!this.drag) return; this.yaw -= (e.clientX - this.drag.x) * 0.0035; this.pitch -= (e.clientY - this.drag.y) * 0.0025; this.drag = { x: e.clientX, y: e.clientY }; });
  }
  reset(x, z, agl = 120) { this.pos.set(x, this.heights.atXZ(x, z) + agl, z); this.yaw = 0; this.pitch = -0.08; this.speed = 12; }  // yaw 0 faces north (-z)
  update(dt) {
    const k = this.keys, turn = 1.4, pitchRate = 1.0;
    let yawIn = (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0);
    let pitchIn = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    this.yaw += yawIn * turn * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchIn * pitchRate * dt, -1.2, 0.9);
    if (!pitchIn) this.pitch = THREE.MathUtils.lerp(this.pitch, -0.05, 1 - Math.exp(-dt * 0.6));   // settle toward a shallow glide
    this.roll = THREE.MathUtils.lerp(this.roll, yawIn * 0.6, 1 - Math.exp(-dt * 4));   // bank into the turn: left turn dips the left wing
    if (k.has('KeyW')) this.speed += 8 * dt; if (k.has('KeyS')) this.speed -= 8 * dt;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) this.speed += 20 * dt;
    // Diving speeds up, climbing slows down; gliding settles toward cruise.
    this.speed += -Math.sin(this.pitch) * 6 * dt - (this.speed - 12) * 0.15 * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, 5, 40);
    // Orient the camera first, then fly along the direction it actually looks, so view and motion never disagree.
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    this.pos.addScaledVector(dir, this.speed * dt);
    this.pos.y += (this.flap * 6 - 0.6) * dt;            // flap climbs, gliding sinks slowly
    const vert = (k.has('KeyX') ? 1 : 0) - (k.has('KeyZ') ? 1 : 0);   // X climbs, Z descends
    this.pos.y += vert * 9 * dt;
    this.flap = Math.max(0, this.flap - dt * 2.5);
    const ground = this.heights.atXZ(this.pos.x, this.pos.z);
    if (this.pos.y < ground + 2) { this.pos.y = ground + 2; this.pitch = Math.max(this.pitch, 0.05); }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, 50, this.heights.size - 50);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -this.heights.size + 50, -50);
    this.camera.position.copy(this.pos);
    this.camera.rotateZ(this.roll);
    return { agl: this.pos.y - ground, elev: this.pos.y, speed: this.speed, heading: ((Math.atan2(dir.x, -dir.z) * 180 / Math.PI) + 360) % 360 };
  }
}
