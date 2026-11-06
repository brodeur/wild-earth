import * as THREE from 'three';
import { rarityColor } from './animals.js';

// The quarry (owner, 2026-11-06: "The user can press "tab" or click on a prey species to "select" them. This creates a
// glowing ring on the ground below the prey if on the ground or just below if flying."). A predator's prey lit in its
// sight (sight.js: in the camera's view with the line of sight open) can be selected: Tab takes the most central lit
// prey animal on the screen, and each Tab after it the next out from the centre; a click on or near a lit one (within
// PICK_PX on the screen) takes that one (identify.js asks claim() before its own pick, so the click does not also open
// a card). The selected animal gets a ring under it in its species' colour (animals.js rarityColor, the colour of its
// highlight, its soul and its chip on the bar): flat on the ground's slope under a body on the ground, level a little
// under a body in the air; wide enough to read at any distance (RING_PX of the distance, never under the body's own
// width: some 16 px in radius); drawn over the scene (no depth test: the leaf cards and the grass round a small body
// would hide a ring on the ground), bright and pulsing while the line of sight to it is open, dim while it is not. Escape clears it (and, having done so, does not
// also leave the body: spirit.js reads e.quarryCleared), as does losing the line to it for LOSE_T s (turning the camera
// away from it is not losing it: sight.js tests the selection in or out of the frame; and not while a dive is
// on it: dive.js cancels itself on the line of sight), its death, or leaving the body. sight.focus is the selection, so
// its line of sight is tested often, in or out of the frame. main.js calls update(dt, on) every frame (on: a body whose
// species hunts, above ground) and the hunt panel (hunt.js) names the selection as its goal.
const LOSE_T = 3, PICK_PX = 30, RING_PX = 0.032, RING_W = 1.5, AIR_DROP = 0.6;   // s; px; the ring's radius per m of distance; over the body's radius; m under a flier, per body radius
const PULSE_HZ = 1.2, DIM = 0.35, SEEN_VIS = 0.3;   // sight.js SEEN_VIS

export class Quarry {
  constructor({ animals, sight, camera, scene, dom, dive = null }) {
    Object.assign(this, { animals, sight, camera, dom, dive });
    this.target = null; this.lostT = 0; this.on = false; this.t = 0; this.radii = new Map();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(1, 1, 1) }, uK: { value: 1 }, uT: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uCol; uniform float uK; uniform float uT; varying vec2 vUv;
void main() {
  float r = length(vUv), band = smoothstep(0.62, 0.78, r) * (1.0 - smoothstep(0.86, 1.0, r));
  float glow = exp(-pow((r - 0.8) * 7.0, 2.0)) * 0.6 + (1.0 - smoothstep(0.0, 0.8, r)) * 0.08;
  float pulse = 0.75 + 0.25 * sin(uT * 6.2832);
  float a = (band + glow) * uK * pulse; if (a < 0.004) discard;
  gl_FragColor = vec4(uCol * a, 1.0);
}`,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat);
    this.ring.name = 'quarry ring'; this.ring.renderOrder = 12; this.ring.frustumCulled = false; this.ring.visible = false;
    scene.add(this.ring);
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0); this._c = new THREE.Color();
    const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    this.onKey = e => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Tab' && this.on) { e.preventDefault(); if (!e.repeat) this.cycle(); }
      else if (e.code === 'Escape' && this.target && !e.repeat) { this.select(null); e.quarryCleared = true; }
    };
    addEventListener('keydown', this.onKey, true);   // before the spirit's Escape (which would leave the body) and the page's Tab focus
  }
  // the body's radius (m): its mesh's bounding sphere times its size, per species once
  radius(a) {
    let r = this.radii.get(a.sp);
    if (r === undefined) { const g = this.animals.meshes[a.sp]?.geometry; if (g && !g.boundingSphere) g.computeBoundingSphere(); r = Math.max(0.08, g?.boundingSphere?.radius || 0.3); this.radii.set(a.sp, r); }
    return r * (a.size || 1);
  }
  select(a) {
    this.target = a || null; this.lostT = 0; this.sight.focus = this.target;
    if (!a && this.dive?.active) this.dive.cancel('called off');
  }
  // Tab: the lit prey ordered out from the screen's centre; the next after the present selection, else the first
  cycle() {
    const lit = this.sight.litPrey(); if (!lit.length) return null;
    lit.sort((p, q) => (p.sx * p.sx + p.sy * p.sy) - (q.sx * q.sx + q.sy * q.sy));
    const i = lit.findIndex(e => e.a === this.target), next = lit[(i + 1) % lit.length].a;
    this.select(next);
    return next;
  }
  // a click (identify.js, before its own pick): the lit prey animal nearest the click on the screen within PICK_PX; true when taken
  claim(cx, cy) {
    if (!this.on) return false;
    const r = this.dom.getBoundingClientRect(); let best = null, bd = PICK_PX * PICK_PX;
    for (const e of this.sight.litPrey()) {
      const x = r.left + (e.sx + 1) / 2 * r.width, y = r.top + (1 - e.sy) / 2 * r.height, d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 < bd) { bd = d2; best = e.a; }
    }
    if (best) this.select(best);
    return !!best;
  }
  update(dt, on) {
    this.on = !!on && this.sight.hunts; this.t += dt;
    const a = this.target;
    if (a && (!this.on || a.dead || a.gone || a.culled || !this.animals.alive(a))) this.select(null);
    else if (a) {
      const seen = this.sight.losOf(a) >= SEEN_VIS || (this.dive?.active && this.dive.target === a);   // its line from the camera, in or out of the frame
      this.lostT = seen ? 0 : this.lostT + dt;
      if (this.lostT > LOSE_T) this.select(null);
    }
    this.place();
  }
  // the ring under the selection (see the header)
  place() {
    const a = this.target, R = this.ring;
    if (!a) { R.visible = false; return; }
    const A = this.animals, H = A.heights, E = this.camera.position, br = this.radius(a), air = !!a.air;
    const y = air ? a.y - br * AIR_DROP : H.atXZ(a.x, a.z), d = Math.hypot(a.x - E.x, y - E.y, a.z - E.z);
    const rad = Math.max(br * RING_W, d * RING_PX);
    R.position.set(a.x, y + (air ? 0 : 0.03 + d * 0.0015), a.z);
    if (air) R.quaternion.identity();
    else {   // on the ground's slope (the heightfield's gradient over a metre either way)
      const gx = (H.atXZ(a.x + 1, a.z) - H.atXZ(a.x - 1, a.z)) / 2, gz = (H.atXZ(a.x, a.z + 1) - H.atXZ(a.x, a.z - 1)) / 2;
      R.quaternion.setFromUnitVectors(this._up, this._n.set(-gx, 1, -gz).normalize());
    }
    R.scale.setScalar(rad); R.visible = true;
    const u = R.material.uniforms; rarityColor(A.rarity[a.sp], u.uCol.value);
    u.uK.value = this.sight.losOf(a) >= SEEN_VIS || this.dive?.active ? 1 : DIM; u.uT.value = this.t * PULSE_HZ;
  }
  clear() { if (this.target) this.select(null); this.on = false; this.ring.visible = false; }
  dispose() { removeEventListener('keydown', this.onKey, true); this.ring.removeFromParent(); this.ring.geometry.dispose(); this.ring.material.dispose(); this.target = null; }
}
