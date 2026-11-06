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
//
// The spirit and the chips (owner, 2026-11-06: "If a spirit clicks on an animal's avatar, rather than the chip, that animal
// becomes targeted. Tab also cycles through targeting every available target." and a chip on the near bar picks the
// nearest of its species). In spirit form (mode 'spirit') any animal is a target: Tab cycles every animal on the screen
// with a line of sight to it (out from the centre, within SPIRIT_R m), a click takes the one at the pointer, and the
// selection is kept until Escape or its going (the spirit may fly far round it). A chip (nearBar.js: pickSpecies) takes
// the nearest individual of that species, and the next nearest when the same chip is clicked again; in the spirit the
// autopilot then flies there (pilot.js), in a body only one the camera can see is taken. Where sight.js is not testing the
// selection (the spirit; a species the body does not hunt) this module tests its line itself every OWN_T s.
const SPIRIT_R = 450, OWN_T = 0.2, TAB_ROUND = 4;
const LOSE_T = 3, PICK_PX = 30, RING_PX = 0.032, RING_W = 1.5, AIR_DROP = 0.6;   // s; px; the ring's radius per m of distance; over the body's radius; m under a flier, per body radius
const PULSE_HZ = 1.2, DIM = 0.35, SEEN_VIS = 0.3;   // sight.js SEEN_VIS

export class Quarry {
  constructor({ animals, sight, camera, scene, dom, dive = null }) {
    Object.assign(this, { animals, sight, camera, dom, dive });
    this.mode = null; this.ownLos = 0; this.ownT = 0; this.pilot = null;
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
      if (e.code === 'Tab' && (this.on || this.mode === 'spirit')) { e.preventDefault(); if (!e.repeat) this.cycle(); }
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
    if (a !== this.target) { this.ownT = 0; this.ownLos = 1; }
    this.target = a || null; this.lostT = 0; this.sight.focus = this.target;
    if (!a && this.dive?.active) this.dive.cancel('called off');
    if (!a && this.pilot?.on) this.pilot.cancel();
  }
  // the selection's line of sight from the camera: sight.js's for a hunted species in a hunting body, else this module's own
  los(a) { return this.mode === 'hunt' && this.sight.prey?.has(a.sp) ? this.sight.losOf(a) : this.ownLos; }
  // an animal's body centre, and its line from the camera (sight.js visibility; no shrub cover for the spirit's view)
  aimY(a) { return this.animals.scentHeight(a) + (a.air ? 0 : 0.6 * this.radius(a)); }
  visibleFrom(a) { const E = this.camera.position; return this.sight.visibility(E.x, E.y, E.z, a.x, this.aimY(a), a.z, !a.air); }
  // the animals on the screen (NDC sx, sy) within SPIRIT_R m: any species (the spirit), or one species
  onScreen(sp = -1, needLos = true) {
    const A = this.animals, E = this.camera.position, v = this._v, out = [];
    this.sight.indexTrees?.();
    for (const a of A.list) {
      if (a.dead || a.gone || a.culled || a.remote || (sp >= 0 && a.sp !== sp) || !A.shown(a)) continue;
      const d = Math.hypot(a.x - E.x, a.z - E.z); if (d > SPIRIT_R) continue;
      v.set(a.x, this.aimY(a), a.z).project(this.camera);
      if (!(v.z < 1) || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      out.push({ a, sx: v.x, sy: v.y, d });
    }
    return needLos ? out.filter(e => this.visibleFrom(e.a) >= SEEN_VIS) : out;
  }
  // Tab: the lit prey (a hunting body) or every animal in view (the spirit) ordered out from the screen's centre; the
  // next after the present selection, else the first
  cycle() {
    const lit = this.mode === 'spirit' ? this.onScreen() : this.sight.litPrey(); if (!lit.length) return null;
    lit.sort((p, q) => (p.sx * p.sx + p.sy * p.sy) - (q.sx * q.sx + q.sy * q.sy));
    // the most central one not yet visited this round (a round ends after TAB_ROUND s without Tab, or when all were seen),
    // so Tab walks every target even as the list shifts under it (a bird flying out of the line, one stepping behind a tree)
    if (this.t - (this.tabT ?? -1e9) > TAB_ROUND) this.tabbed = new Set();
    this.tabT = this.t; this.tabbed ||= new Set();
    let e = lit.find(e => !this.tabbed.has(e.a) && e.a !== this.target);
    if (!e) { this.tabbed.clear(); e = lit.find(e => e.a !== this.target) || lit[0]; }
    if (this.target) this.tabbed.add(this.target);
    this.tabbed.add(e.a); this.select(e.a);
    return e.a;
  }
  // a click (identify.js, before its own pick): the lit prey animal nearest the click on the screen within PICK_PX; true when taken
  claim(cx, cy) {
    if (!this.on && this.mode !== 'spirit') return false;
    const r = this.dom.getBoundingClientRect(); let best = null, bd = PICK_PX * PICK_PX;
    for (const e of this.mode === 'spirit' ? this.onScreen(-1, false) : this.sight.litPrey()) {
      const x = r.left + (e.sx + 1) / 2 * r.width, y = r.top + (1 - e.sy) / 2 * r.height, d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 < bd) { bd = d2; best = e.a; }
    }
    if (best && this.mode === 'spirit' && this.visibleFrom(best) < SEEN_VIS) best = null;   // the one at the pointer, if the spirit can see it
    if (best) this.select(best);
    return !!best;
  }
  // A chip (nearBar.js): the nearest individual of species sp (the spirit: any; a body: one the camera can see), or the
  // next nearest when the selection is already one of them; the spirit flies to it (pilot.js). Returns it, or null.
  pickSpecies(sp) {
    const A = this.animals, P = this.camera.position;
    const all = A.list.filter(a => a.sp === sp && !a.dead && !a.gone && !a.culled && !a.remote && A.shown(a)).sort((p, q) => ((p.x - P.x) ** 2 + (p.z - P.z) ** 2) - ((q.x - P.x) ** 2 + (q.z - P.z) ** 2));
    const pool = this.mode === 'spirit' ? all : all.filter(a => this.visibleFrom(a) >= SEEN_VIS);
    if (!pool.length) return null;
    const i = this.target && this.target.sp === sp ? pool.indexOf(this.target) : -1, a = pool[(i + 1) % pool.length];
    this.select(a);
    if (this.mode === 'spirit') this.pilot?.go(a);
    return a;
  }
  // mode: 'hunt' (a body whose species hunts), 'body' (any other body), 'spirit', or null (none: underground, the arrival)
  update(dt, mode) {
    if (mode !== this.mode && this.target) this.select(null);   // a new body or form: a fresh start
    this.mode = mode || null; this.on = mode === 'hunt' && this.sight.hunts; this.t += dt;
    const a = this.target;
    if (a && (!this.mode || a.dead || a.gone || a.culled || !this.animals.alive(a))) this.select(null);
    else if (a) {
      if (!(this.mode === 'hunt' && this.sight.prey?.has(a.sp)) && (this.ownT -= dt) <= 0) { this.ownT = OWN_T; this.ownLos = this.visibleFrom(a); }
      const seen = this.mode === 'spirit' || this.los(a) >= SEEN_VIS || (this.dive?.active && this.dive.target === a);   // its line from the camera, in or out of the frame (the spirit keeps its target)
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
    u.uK.value = this.los(a) >= SEEN_VIS || this.dive?.active || this.pilot?.on ? 1 : DIM; u.uT.value = this.t * PULSE_HZ;
  }
  clear() { if (this.target) this.select(null); this.on = false; this.ring.visible = false; }
  dispose() { removeEventListener('keydown', this.onKey, true); this.ring.removeFromParent(); this.ring.geometry.dispose(); this.ring.material.dispose(); this.target = null; }
}
