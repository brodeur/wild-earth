import * as THREE from 'three';

// First-person raven: constant forward flight with pitch and yaw, a slow sink while gliding, flapping to climb.
export class RavenFlight {
  constructor(camera, heights, dom) {
    this.camera = camera; this.heights = heights;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.roll = 0; this.speed = 12;
    this.keys = new Set(); this.flap = 0; this.drag = null; this.hover = false; this.sDwell = 0;
    window.addEventListener('keydown', e => { if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return; this.keys.add(e.code); if (e.code === 'KeyH') this.setHover(!this.hover); if (e.code === 'Space') { this.flap = 1; e.preventDefault(); } if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault(); });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    dom.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => this.drag = null);
    window.addEventListener('pointermove', e => { if (!this.drag) return; this.yaw -= (e.clientX - this.drag.x) * 0.0035; this.pitch -= (e.clientY - this.drag.y) * 0.0025; this.drag = { x: e.clientX, y: e.clientY }; });
  }
  setHover(on) { this.hover = on; if (!on && this.speed < 6) this.speed = 8; }
  reset(x, z, agl = 120) { this.pos.set(x, this.heights.atXZ(x, z) + agl, z); this.yaw = 0; this.pitch = -0.08; this.speed = 12; }  // yaw 0 faces north (-z)
  update(dt) {
    const k = this.keys, turn = 1.4, pitchRate = 1.0;
    let yawIn = (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0);
    let pitchIn = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    this.yaw += yawIn * turn * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchIn * pitchRate * dt, -1.2, 0.9);
    if (!pitchIn) this.pitch = THREE.MathUtils.lerp(this.pitch, -0.05, 1 - Math.exp(-dt * 0.15));  // settle toward a shallow glide, slowly (~7 s)
    this.roll = THREE.MathUtils.lerp(this.roll, yawIn * 0.6, 1 - Math.exp(-dt * 1.0));   // bank into the turn: left turn dips the left wing
    // W speeds up; S slows to a stop and, if held on past zero for half a second, backs up.
    if (k.has('KeyW')) { this.hover = false; this.speed += 8 * dt; }
    if (k.has('ShiftLeft') || k.has('ShiftRight')) { this.hover = false; this.speed += 20 * dt; }
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
    // Orient the camera first, then fly along the direction it actually looks, so view and motion never disagree.
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    this.pos.addScaledVector(dir, this.speed * dt);
    this.pos.y += (this.flap * 6 - (holding ? 0 : 0.6)) * dt;     // flap climbs, gliding sinks slowly, hovering holds
    const vert = (k.has('KeyX') ? 1 : 0) - (k.has('KeyZ') ? 1 : 0);   // X climbs, Z descends
    this.pos.y += vert * 9 * dt;
    this.flap = Math.max(0, this.flap - dt * 2.5);
    const ground = this.heights.atXZ(this.pos.x, this.pos.z);
    if (this.pos.y < ground + 2) { this.pos.y = ground + 2; this.pitch = Math.max(this.pitch, 0.05); }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, 50, this.heights.size - 50);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -this.heights.size + 50, -50);
    this.camera.position.copy(this.pos);
    this.camera.rotateZ(this.roll);
    return { hover: holding, agl: this.pos.y - ground, elev: this.pos.y, speed: this.speed, heading: ((Math.atan2(dir.x, -dir.z) * 180 / Math.PI) + 360) % 360 };
  }
}
