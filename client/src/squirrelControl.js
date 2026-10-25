import * as THREE from 'three';
import { SPECIES as PLANTS } from './trees.js';
import { animalMaterial, animalDepthMaterial, hasAnim2 } from './animalModels.js';
import { addCaster } from './shadows.js';
import { trunkAt } from './animals.js';
import { acornGeometry } from './acorns.js';

// The playable western gray squirrel (docs/game-acorn-stash.md, "Playable squirrel"). A ground and trunk
// controller beside RavenFlight: when the player is a squirrel, main.js calls this instead of flight.update, and it
// drives the same `flight.pos` and `flight.yaw` (forward is -z at yaw 0) so the forest, grass, minimap, identify,
// animals, acorns and sound all keep following the player as they followed the raven. The raven's body is hidden.
//
// Controls: W / S run forward (a bound, up to RUN m/s, the squirrel's real top speed) and back; A / D (or the
// arrows, or a mouse drag) turn; Space jumps a short arc (a creek, onto a rock) or, on a trunk, jumps off it; Shift
// sits up to look around; E picks up an acorn, buries the one it carries on open ground, or digs one up from a dug
// mark. Run into a trunk (within LATCH_R) and the squirrel takes hold of the bark: W climbs, S goes down head first,
// A / D go round the trunk, up to its lowest fork (topOf); E there takes an acorn in the crown within CROWN_R, or
// runs out along a limb to one within LIMB_R.
//
// Climbing uses the trees of the near set (veg.nearPlants, the same instances the vegetation draws) with their
// variant's stem (lean, base and top radius) and rotation from the instance matrix, through animals.js trunkAt, so a
// squirrel climbs the drawn bole of an oak, a gray pine or a ponderosa. The ground is the drawn terrain mesh
// (animals.heights); rocks near the eye (rocks.js close tiers) are stood on by a downward ray, stepped onto up to
// STEP m and otherwise a wall to jump.
//
// The model is the AI squirrel's: one extra instance (a clone of the drawn mesh's lod0 geometry with its own aAnim and
// aAnim2) posed by the rodent rig template from the controller's state: bound phase and gait, sit-up (pose), tail
// flick, leg splay on the trunk, the lagged tail tip. The acorn it carries rides at the mouth (animals.carryPoint).

const CODE = 'sciurus_griseus';
const RUN = 6, BACK = 1.8, ACCEL = 4.5, TURN = 2.6;          // m/s; 1/s to the target speed; rad/s
const JUMP_UP = 3.3, JUMP_FWD = 2.5, GRAVITY = 9.8;          // a ~0.55 m, ~0.7 s hop; at a run it carries 3-4 m
const STEP = 0.3;                                            // m: stepped onto without a jump (a rock edge, a bank)
const CLIMB_UP = 2.4, CLIMB_DOWN = 2.0, ROUND = 1.3;         // m/s up, down and round the trunk
const LATCH_R = 0.8, TOP = 0.85;                             // m from the bark to take hold; how high up the tree
const PICK_R = 0.9, CROWN_R = 1.2, LIMB_R = 3.2, DIG_R = 1.0, LIMB_V = 2.2;
const WORK = { pick: 0.5, bury: 2.4, dig: 1.8 };             // s
const CAM_BACK = 2.5, CAM_UP = 0.6, NEAR = 0.3;
const CAM_SIDE = 0.4, CAM_SWING = 1.6;                       // rad (~23 deg) off the heading: a three-quarter view; 1/s
const CAM_CLEAR = 0.3, CAM_SIGHT = 0.15, CAM_WATER = 0.45;   // m over the terrain round the lens, along the sight line, over a pond
// Water (water.js): deeper than SWIM_IN it swims (out again under SWIM_OUT), floating with the feet FLOAT under the
// surface, at SWIM m/s (a gray squirrel can swim but avoids it; a reservoir crossing should feel slow); shallower it
// wades at WADE of the run. No jump from the water. Creek depth is water.js depthAt(): the thalweg depth from the
// pipeline's channel profile (pools where the DEM's long profile flattens, riffles on its steps, scaled by drainage
// area; docs/tile-spec.md "Hydrology rewilding") across a parabolic section of the drawn ribbon, so a creek has
// riffles to wade and pools a squirrel has to swim where the real profile puts them. The ribbon (draped on the
// terrain) gives the surface; the bed is that surface minus the depth.
const SWIM = 1.0, SWIM_BACK = 0.5, WADE = 0.5, SWIM_IN = 0.15, SWIM_OUT = 0.11, FLOAT = 0.07;
const RIPPLE_EVERY = 0.4, RIPPLE_LIFE = 1.5;
const TAU = Math.PI * 2;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class SquirrelControl {
  constructor({ tile, scene, camera, flight, veg, animals, acorns, atmosphere, rocks = null, caption = null }) {
    Object.assign(this, { tile, scene, camera, flight, veg, animals, acorns, atmosphere, rocks, captionEl: caption });
    this.heights = animals.heights;   // the drawn terrain mesh, as the animals stand on it
    this.on = false; this.mode = 'ground';
    this.v = 0; this.vel = new THREE.Vector3(); this.tree = null; this.h = 0; this.face = 0; this.headUp = true;
    this.work = null; this.limb = null; this.auto = null; this.sit = 0;
    this.pose = { phase: 0, amp: 0, pose: 0, flick: 0, flickV: 0, e0: 0, e1: 0, pitch: 0, yaw: 0, roll: 0, bob: 0 };
    this.jumpQ = false; this.actQ = false; this.camOrbit = 0; this.lastYaw = 0; this.camSide = CAM_SIDE; this.camLift = 0;
    this.camOff = new THREE.Vector3(); this.aimOff = new THREE.Vector3(); this.camSettled = false;
    this.last = new THREE.Vector3(); this.trees = new Map(); this.treeVersion = -1;
    this._t = { x: 0, y: 0, z: 0, r: 0 }; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
    this.ray = new THREE.Raycaster(); this.ray.ray.direction.set(0, -1, 0); this._hits = []; this._rockMesh = new THREE.Mesh();
    this.mesh = null; this.sp = 0;
    this.swimming = false; this.wet = null; this.toldSwim = 0;   // this.wet: the water at the squirrel's feet, or null
    this._ft = { y: 0, bed: 0, surf: null, depth: 0 }; this._wq = { surf: 0, depth: 0 };
    this.ripples = []; this.rippleT = 0;
    this.ready = animals.playerModel('squirrel').then(r => this.build(r)).catch(e => console.warn('squirrel: no player model', e));
    // the acorn in its mouth
    this.nut = new THREE.Mesh(acornGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.nut.scale.setScalar(0.045); this.nut.visible = false; scene.add(this.nut);
    // a short line for what E did (or why it did nothing)
    this.toast = document.createElement('div'); this.toast.id = 'sqToast';
    this.toast.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:6;padding:6px 12px;border-radius:7px;'
      + 'background:#0f1512d8;border:1px solid #263128;color:#e6ede7;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
      + 'pointer-events:none;opacity:0;transition:opacity .3s;white-space:nowrap';
    document.body.appendChild(this.toast);
    const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    addEventListener('keydown', e => {
      if (!this.on || typing(e) || e.metaKey || e.ctrlKey) return;
      if (this.auto) { if (!e.altKey) { this.finishArrival(true); e.preventDefault(); } return; }   // any key skips the arrival
      if (e.code === 'Space') { this.jumpQ = true; e.preventDefault(); }
      if (e.code === 'KeyE' && !e.repeat) this.actQ = true;
    });
  }

  // ---- model ---------------------------------------------------------------------------------------
  build({ model, geometry, sp }) {
    const geo = geometry.clone();
    geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
    if (hasAnim2(model)) geo.setAttribute('aAnim2', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
    const mesh = new THREE.InstancedMesh(geo, animalMaterial(this.atmosphere, model), 1);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'player squirrel';
    mesh.customDepthMaterial = animalDepthMaterial(model);
    mesh.visible = this.on; this.scene.add(mesh);
    addCaster(mesh, { cascades: [0], simple: false });   // follows the mesh's visibility
    this.mesh = mesh; this.model = model; this.sp = sp; this.rig = hasAnim2(model);
  }

  // ---- on and off ---------------------------------------------------------------------------------
  setOn(on) {
    on = !!on;
    this.acorns?.setPlayerSpecies(on ? CODE : 'corvus_corax');
    if (on === this.on) return;
    this.on = on;
    const f = this.flight;
    f.body.visible = !on && f.view === 'chase';
    if (this.mesh) this.mesh.visible = on;
    this.nut.visible = false;
    for (const r of this.ripples) r.m.visible = false;
    if (on) { f.pitch = 0; f.roll = 0; f.hover = false; this.camSettled = false; this.lastYaw = f.yaw; this.place(f.pos.x, f.pos.z); }
    else { this.camera.up.set(0, 1, 0); f.reset(f.pos.x, f.pos.z, 30); }   // back to the raven: aloft over the same spot
    // a camera 0.6 m over a slope: the raven's 0.5 m near plane cut the hillside beside it open
    if (on) this.nearWas = this.camera.near;
    this.camera.near = on ? NEAR : this.nearWas || 0.5; this.camera.updateProjectionMatrix();
    this.hud(on);
  }

  // The HUD's words for the species (index.html stays the raven's; the originals come back on setOn(false)).
  hud(on) {
    const $ = id => document.getElementById(id), h1 = $('hud')?.querySelector('h1'), help = $('help');
    if (!this.hudWas) this.hudWas = {
      h1: h1?.firstChild?.nodeValue, help: help?.innerHTML,
      agl: $('agl')?.previousElementSibling?.textContent, speed: $('speed')?.previousElementSibling?.textContent,
    };
    const W = this.hudWas;
    if (h1?.firstChild) h1.firstChild.nodeValue = on ? 'western gray squirrel ' : W.h1;
    if (help) help.innerHTML = on ? '<kbd>W</kbd><kbd>S</kbd> run · <kbd>A</kbd><kbd>D</kbd> turn · <kbd>space</kbd> jump · <kbd>shift</kbd> sit up · '
      + '<kbd>E</kbd> pick up, bury, dig · run into a trunk to climb (<kbd>W</kbd><kbd>S</kbd> up, down; <kbd>A</kbd><kbd>D</kbd> round; <kbd>space</kbd> jump off) · '
      + '<kbd>M</kbd> map · <kbd>G</kbd> roads · <kbd>P</kbd> present day · <kbd>T</kbd> tags · <kbd>N</kbd> mute · click a tree to identify · drag mouse to turn and look' : W.help;
    const agl = $('agl')?.previousElementSibling, sp = $('speed')?.previousElementSibling;
    if (agl) agl.textContent = on ? 'height above ground' : W.agl;
    if (sp) sp.textContent = on ? 'speed' : W.speed;
    const hb = $('hoverBtn'); if (hb) hb.style.display = on ? 'none' : '';
  }

  say(text) {
    const t = this.toast; t.textContent = text; t.style.opacity = '1';
    clearTimeout(this.toastT); this.toastT = setTimeout(() => { t.style.opacity = '0'; }, 2200);
  }

  // ---- placing -------------------------------------------------------------------------------------
  // On the ground at (x, z), facing the way it faced (after a reset, Go to, or a switch from the raven).
  place(x, z) {
    const P = this.flight.pos;
    const F = this.footing(x, z, this.heights.atXZ(x, z) + 50);
    P.set(x, F.y, z); this.setWet(F);
    this.mode = 'ground'; this.v = 0; this.vel.set(0, 0, 0); this.tree = null; this.work = null; this.limb = null;
    this.last.copy(P); this.camSettled = false;
  }

  // The arrival for a squirrel: on the trunk of the oak nearest the chosen point, a couple of metres up and head
  // down; it runs down and out across the ground, then the player has it. onDone when it ends (or a key skips it).
  arrive(point, caption, onDone = null) {
    const S = this.tile.size, x = Math.min(S - 60, Math.max(60, point?.x ?? S / 2)), z = -Math.min(S - 60, Math.max(60, point?.north ?? S / 2));
    this.veg.update(x, z, true);   // the forest around the point now, so its oaks are known
    let best = null, bd = Infinity;
    for (const o of this.veg.oaks) {
      if (o.snag || o.cls === 'sapling') continue;
      const d = (o.x - x) ** 2 + (o.z - z) ** 2; if (d < bd) { bd = d; best = o; }
    }
    this.flight.pos.set(x, this.heights.atXZ(x, z), z); this.last.copy(this.flight.pos);
    this.onArrived = onDone;
    if (!best || bd > 400 * 400) { this.place(x, z); this.finishArrival(false); return; }
    const tree = this.record(best);
    this.flight.yaw = this.lastYaw = Math.atan2(x - best.x, z - best.z) + Math.PI;   // facing away from the trunk, toward the point
    this.attach(tree, wrap(this.flight.yaw - Math.PI), Math.min(1.4, this.topOf(tree)));   // below the fork, so the camera is under the crown
    this.headUp = false; this.camSettled = false;
    this.auto = { t: 0, out: 0 };
    if (caption && this.captionEl) {
      const c = this.captionEl; c.querySelector('.cap-text').textContent = caption;
      c.hidden = false; c.getAnimations().forEach(a => a.cancel());
      this.capAnim = c.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 6000, fill: 'forwards' });
      this.capAnim.onfinish = () => { c.hidden = true; };
    }
  }
  finishArrival(skipped) {
    const was = this.auto; this.auto = null;
    if (skipped && was && this.mode === 'trunk') this.dismount();
    this.flight.keys.clear(); this.jumpQ = this.actQ = false;
    const cb = this.onArrived; this.onArrived = null; cb?.(skipped);
  }

  // ---- trees ---------------------------------------------------------------------------------------
  // The near set's trees (not shrubs) as climbable records on a 10 m grid: position, scale and rotation from the
  // instance matrix, the variant's stem and height. Rebuilt when the vegetation refreshes its near set.
  indexTrees() {
    const veg = this.veg; if (veg.nearVersion === this.treeVersion) return;
    this.treeVersion = veg.nearVersion; this.trees.clear();
    for (const [species, arr] of Object.entries(veg.meshes)) {
      if (PLANTS[species]?.shrub) continue;
      for (const e of arr) {
        if (!e.stem) continue;
        const a = e.near.trunk.instanceMatrix.array;
        for (let i = 0; i < e.near.n; i++) {
          const o = i * 16, scale = Math.hypot(a[o], a[o + 1], a[o + 2]);
          const t = { id: e.near.ids[i], species, x: a[o + 12], y: a[o + 13] + 0.3, z: a[o + 14], scale, rot: Math.atan2(a[o + 8], a[o]),
            stem: e.stem, height: e.height, H: Math.max(2, e.height * scale), snag: e.snag };
          const k = `${Math.floor(t.x / 10)},${Math.floor(t.z / 10)}`;
          let l = this.trees.get(k); if (!l) this.trees.set(k, l = []); l.push(t);
        }
      }
    }
  }
  // An oak record from veg.oaks (the arrival's oak) in the same form.
  record(o) { return { id: o.id, species: o.species, x: o.x, y: o.y, z: o.z, scale: o.scale, rot: o.rot, stem: o.stem, height: o.height, H: Math.max(2, (o.height || 8) * o.scale), snag: o.snag }; }
  // The trunk the squirrel runs into: within LATCH_R of the bark near the ground, roughly ahead.
  trunkAhead(P, fx, fz) {
    this.indexTrees();
    const ci = Math.floor(P.x / 10), cj = Math.floor(P.z / 10), t = this._t;
    let best = null, bd = LATCH_R;
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const l = this.trees.get(`${i},${j}`); if (!l) continue;
      for (const tr of l) {
        trunkAt(tr, 0.25, t);
        const dx = t.x - P.x, dz = t.z - P.z, d = Math.hypot(dx, dz), gap = d - t.r;
        if (gap > bd || d < 1e-3) continue;
        if ((dx * fx + dz * fz) / d < 0.35) continue;   // not facing it
        bd = gap; best = tr;
      }
    }
    return best;
  }
  attach(tree, face, h = 0.15) {
    this.tree = tree; this.face = face; this.h = h; this.mode = 'trunk'; this.v = 0; this.headUp = true; this.camOrbit = 0;
    this.wet = null; this.swimming = false;
    this.work = null; this.limb = null;
  }
  // Off the bottom of the trunk onto the ground, facing out.
  dismount() {
    const f = this.flight; f.yaw = this.face + Math.PI; this.lastYaw = f.yaw;
    const P = f.pos, out = trunkAt(this.tree, 0, this._t).r + 0.25;
    P.x = this.tree.x + Math.sin(this.face) * out; P.z = this.tree.z + Math.cos(this.face) * out; P.y = this.heights.atXZ(P.x, P.z);
    this.mode = 'ground'; this.tree = null; this.v = 1.5;
  }

  // ---- ground under the squirrel: terrain mesh, or the top of a close rock --------------------------
  // The highest surface below `from` (m) at (x, z).
  surface(x, z, from) {
    const g = this.heights.atXZ(x, z);
    if (!this.rocks?.enabled || !this.rocks.on || from <= g) return g;
    let top = g;
    const r = this.ray; r.ray.origin.set(x, from, z); r.far = from - g + 0.05; r.near = 0;
    const tmp = this._rockMesh, M = this._m;
    for (const role of ['close', 'bclose']) {
      const grp = this.rocks.groups?.[role]; if (!grp) continue;
      for (const m of grp.children) {
        if (!m.visible || !m.count) continue;
        const geo = m.geometry; if (!geo.boundingSphere) geo.computeBoundingSphere();
        const R = geo.boundingSphere.radius, a = m.instanceMatrix.array;
        tmp.geometry = geo; tmp.material = m.material;
        for (let q = 0; q < m.count; q++) {
          const o = q * 16, s = Math.max(Math.hypot(a[o], a[o + 1], a[o + 2]), Math.hypot(a[o + 4], a[o + 5], a[o + 6]), Math.hypot(a[o + 8], a[o + 9], a[o + 10]));
          const dx = a[o + 12] - x, dz = a[o + 14] - z, rr = R * s + 0.1;
          if (dx * dx + dz * dz > rr * rr) continue;
          M.fromArray(a, o); tmp.matrixWorld.copy(M);
          this._hits.length = 0; tmp.raycast(r, this._hits);
          for (const h of this._hits) if (h.point.y > top) top = h.point.y;
        }
      }
    }
    return top;
  }

  // ---- water under the squirrel ----------------------------------------------------------------------
  // The footing at (x, z) below `from`: the ground (surface(): terrain or a rock top) and, in water, the bed, the water
  // surface and its depth. y is where the feet go: on the bed, or floating FLOAT under the surface once deeper than that.
  footing(x, z, from) {
    const F = this._ft, g = this.surface(x, z, from);
    F.y = F.bed = g; F.surf = null; F.depth = 0;
    const w = this.waterAt(x, z); if (!w) return F;
    // a pond lies on the drawn terrain (its bed); a creek's ribbon is draped on it, so its bed is notional, except
    // where a rock stands in the channel
    const bed = w.stream && g <= this.heights.atXZ(x, z) + 0.02 ? w.surf - w.depth : g;
    const depth = w.surf - bed; if (depth <= 0.005) return F;
    F.bed = bed; F.surf = w.surf; F.depth = depth; F.stream = w.stream; F.y = Math.max(bed, w.surf - FLOAT);
    return F;
  }
  // The water at (x, z): a pond holding water (its flat level), else a running creek (the drawn ribbon's height and
  // water.js depthAt there), or null.
  waterAt(x, z) {
    const q = this._wq, lvl = this.pondLevel(x, z);
    if (lvl !== null) { q.surf = lvl; q.depth = 0; q.stream = false; return q; }
    return this.streamAt(x, z);
  }
  waterObj() { return this.water ??= this.scene.children.find(o => o.userData?.water)?.userData.water ?? false; }
  // The stream ribbons that run this season (water.js streams[class], one merged mesh each), on a 10 m grid of their
  // triangles; the point's barycentric weights give the ribbon height (from the ribbon nearest its own centreline
  // where two overlap, by aFlow's across offset and half width), and the depth is W.depthAt(x, north).
  streamAt(x, z) {
    const W = this.waterObj(); if (!W?.streams) return null;
    const n = -z, key = Math.floor(n / 10) * 4096 + Math.floor(x / 10), q = this._wq;
    let found = null, bestR = Infinity;
    for (const cls in W.streams) {
      const mesh = W.streams[cls]; if (!mesh.visible) continue;
      const list = this.streamGrid(cls, mesh).get(key); if (!list) continue;
      const geo = mesh.geometry, P = geo.attributes.position.array, Fl = geo.attributes.aFlow.array, I = geo.index.array;
      for (const t of list) {
        const a = I[t], b = I[t + 1], c = I[t + 2];
        const ax = P[a * 3], az = P[a * 3 + 2], v0x = P[b * 3] - ax, v0z = P[b * 3 + 2] - az, v1x = P[c * 3] - ax, v1z = P[c * 3 + 2] - az;
        const den = v0x * v1z - v1x * v0z; if (Math.abs(den) < 1e-9) continue;
        const v2x = x - ax, v2z = z - az, u = (v2x * v1z - v1x * v2z) / den, v = (v0x * v2z - v2x * v0z) / den;
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
        const w0 = 1 - u - v;
        const across = w0 * Fl[a * 4 + 1] + u * Fl[b * 4 + 1] + v * Fl[c * 4 + 1], half = w0 * Fl[a * 4 + 2] + u * Fl[b * 4 + 2] + v * Fl[c * 4 + 2];
        const r = half > 0.05 ? Math.min(1, Math.abs(across) / half) : 1;
        if (r < bestR) { bestR = r; q.surf = w0 * P[a * 3 + 1] + u * P[b * 3 + 1] + v * P[c * 3 + 1]; q.stream = true; found = q; }
      }
    }
    if (found) found.depth = W.depthAt ? W.depthAt(x, n) : 0;
    return found;
  }
  streamGrid(cls, mesh) {
    const all = this._sg ??= new Map(); let G = all.get(cls); if (G) return G;
    all.set(cls, G = new Map());
    const P = mesh.geometry.attributes.position.array, I = mesh.geometry.index?.array; if (!I) return G;
    for (let t = 0; t < I.length; t += 3) {
      let x0 = Infinity, x1 = -Infinity, n0 = Infinity, n1 = -Infinity;
      for (let k = 0; k < 3; k++) { const o = I[t + k] * 3, x = P[o], n = -P[o + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
      for (let j = Math.floor(n0 / 10); j <= Math.floor(n1 / 10); j++) for (let i = Math.floor(x0 / 10); i <= Math.floor(x1 / 10); i++) {
        const key = j * 4096 + i; let l = G.get(key); if (!l) G.set(key, l = []); l.push(t);
      }
    }
    return G;
  }

  // ---- the frame -----------------------------------------------------------------------------------
  input() {
    const k = this.flight.keys, A = this.auto;
    if (A) return { fwd: this.mode === 'trunk' ? -1 : 1, turn: 0, sit: false };
    return {
      fwd: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      turn: (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0),
      sit: k.has('ShiftLeft') || k.has('ShiftRight'),
    };
  }

  update(dt) {
    const f = this.flight, P = f.pos, ps = this.pose;
    f.body.visible = false; f.flap = 0; f.flapping = false; f.hover = false;   // the raven's keys still land in flight; ignore them
    if (P.distanceToSquared(this.last) > 20 * 20) this.place(P.x, P.z);       // moved from outside (R, Go to): onto the ground there
    const k = this.input();
    // a mouse drag turns (flight.yaw) and tilts the look (flight.pitch); on a trunk it orbits the camera instead
    const dragYaw = wrap(f.yaw - this.lastYaw);
    f.pitch = Math.max(-0.6, Math.min(0.7, f.pitch));
    if (this.mode === 'trunk' || this.mode === 'limb') { this.camOrbit += dragYaw; f.yaw = this.lastYaw; }
    if (this.auto) {
      this.auto.t += dt;
      if (this.mode === 'ground') this.auto.out += dt;
      if (this.auto.out > 1.1 || this.auto.t > 6) this.finishArrival(false);
    }
    const jump = this.jumpQ, act = this.actQ; this.jumpQ = this.actQ = false;
    switch (this.mode) {
      case 'ground': this.ground(dt, k, jump, act); break;
      case 'air': this.air(dt); break;
      case 'trunk': this.climb(dt, k, jump, act); break;
      case 'limb': this.onLimb(dt); break;
      case 'work': this.working(dt); break;
    }
    if (this.mode !== 'trunk' && this.mode !== 'limb') this.camOrbit = damp(this.camOrbit, 0, 3, dt);
    this.lastYaw = f.yaw;
    // tail flicks now and then when still; the tip lags (the AI's channels)
    if (!this.swimming && Math.random() < dt * (this.v < 0.5 ? 0.8 : 0.15)) ps.flickV = 1;
    if (ps.flickV > 0) { ps.flick = Math.max(ps.flick, Math.sin(Math.min(1, 1 - ps.flickV) * Math.PI)); ps.flickV -= dt * 3; }
    else if (!this.work && !this.swimming) ps.flick = damp(ps.flick, 0, 1, dt);
    ps.e0 = damp(ps.e0, this.mode === 'trunk' || this.work?.back === 'trunk' ? 1 : 0, 8, dt);
    ps.e1 = damp(ps.e1, ps.flick, 5, dt);
    if (ps.phase > 1e4) ps.phase -= TAU * 1000;
    this.draw();
    this.ripple(dt);
    this.updateCamera(dt);
    this.last.copy(P);
    const ground = Math.max(this.heights.atXZ(P.x, P.z), this.wet && this.mode !== 'trunk' ? this.wet.surf : -Infinity), speed = this.mode === 'trunk' ? Math.abs(this.climbV || 0) : this.mode === 'air' ? Math.hypot(this.vel.x, this.vel.z) : Math.abs(this.v);
    f.speed = speed;
    const heading = ((this.mode === 'trunk' ? (this.face + Math.PI) : f.yaw) * -180 / Math.PI % 360 + 360) % 360;
    return { hover: false, agl: P.y - ground, elev: P.y, speed, heading };
  }

  ground(dt, k, jump, act) {
    const f = this.flight, P = f.pos, ps = this.pose, swim = this.swimming, wade = !swim && !!this.wet;
    const sitting = k.sit && !swim && Math.abs(this.v) < 1.2;
    this.sit = damp(this.sit, sitting ? 1 : 0, sitting ? 4 : 8, dt);
    const target = sitting ? 0 : swim ? (k.fwd > 0 ? SWIM : k.fwd < 0 ? -SWIM_BACK : 0) : (k.fwd > 0 ? RUN : k.fwd < 0 ? -BACK : 0) * (wade ? WADE : 1);
    // in deep water the run is lost at once (water drags) and the paddling builds speed slowly
    this.v = damp(this.v, target, swim ? (Math.abs(this.v) > Math.abs(target) ? 3 : 1.5) : target === 0 ? 7 : ACCEL, dt);
    if (Math.abs(this.v) < 0.02 && !target) this.v = 0;
    f.yaw += k.turn * TURN * (sitting || swim ? 0.6 : 1) * dt;
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    if (jump && swim) this.say('too deep to jump: swim for the bank');
    else if (jump && !sitting) {   // a hop: forward at least JUMP_FWD, with the run's speed if faster
      const fw = Math.max(Math.abs(this.v) < 0.3 ? 0 : JUMP_FWD, this.v);
      this.vel.set(fx * fw, JUMP_UP, fz * fw); this.mode = 'air'; this.sit = 0; return;
    }
    if (act) {
      if (swim) this.say('swimming: get out onto the bank first');
      else { this.action(); if (this.mode !== 'ground') return; }
    }
    // run into a trunk: take hold
    if (!swim && k.fwd > 0 && this.v > 0.3) {
      const tr = this.trunkAhead(P, fx, fz);
      if (tr) { const t = trunkAt(tr, 0.25, this._t); this.attach(tr, Math.atan2(P.x - t.x, P.z - t.z)); this.v = 0; return; }
    }
    this.ashore = Math.max(0, (this.ashore || 0) - dt);   // s since it left the water
    const nx = P.x + fx * this.v * dt, nz = P.z + fz * this.v * dt;
    const F = this.footing(nx, nz, P.y + STEP + 0.1), s = F.y;
    // a rock face (the solid ground: in water, the bed) is a wall: jump it, or from the water swim round it
    if (F.bed - P.y > STEP + (swim ? 0.1 : 0)) this.v = 0;
    else {
      P.x = Math.max(5, Math.min(this.tile.size - 5, nx)); P.z = Math.min(-5, Math.max(-this.tile.size + 5, nz));
      // Where the drawn shore lies below a reservoir's level (the lidar's hydro-flattened bank), the water's edge is a
      // step: into the water it floats up onto the surface, out of it it slides down the bank, neither a wall nor a fall.
      if (F.surf !== null && s > P.y) { P.y = Math.min(s, P.y + 2.5 * dt); this.setWet(F); }
      else if ((this.wet || this.ashore > 0) && F.surf === null && s < P.y - 0.05) { P.y = Math.max(s, P.y - 2.5 * dt); this.setWet(F); }
      else if (s < P.y - 0.35) { this.vel.set(fx * this.v, 0, fz * this.v); this.mode = 'air'; }   // off the edge of a rock
      else { P.y = s; this.setWet(F); }
    }
    const sp = Math.abs(this.v);
    const hf = this.heights.atXZ(P.x + fx * 0.15, P.z + fz * 0.15), hb = this.heights.atXZ(P.x - fx * 0.15, P.z - fz * 0.15);
    const slope = -Math.atan2(hf - hb, 0.3);   // along the ground, and along a creek's ribbon (draped on it)
    if (this.swimming) {   // paddling: head up, body low, legs cycling (never quite still: treading water), tail flat behind
      ps.amp = damp(ps.amp, 0.35 + 0.25 * Math.min(1, sp / SWIM), 6, dt);
      ps.phase += dt * TAU * (1.8 + 1.4 * sp);
      ps.bob = Math.sin(ps.phase * 2) * 0.006;
      ps.pose = damp(ps.pose, 0, 6, dt); ps.flick = damp(ps.flick, -0.35, 6, dt); ps.flickV = 0;
      ps.pitch = damp(ps.pitch, (this.wet.stream ? slope : 0) - 0.1, 4, dt);
      ps.yaw = f.yaw + Math.PI; ps.roll = damp(ps.roll, Math.sin(ps.phase) * 0.06, 8, dt);
      return;
    }
    // pose: the bound (stride lengthens with speed), sit-up, the body along the slope
    const stride = 0.42 + 0.12 * sp;
    ps.amp = damp(ps.amp, sp > 0.15 ? Math.min(1, 0.35 + sp / 3) : 0, 10, dt);
    ps.phase += dt * TAU * sp / stride;
    ps.bob = Math.abs(Math.sin(ps.phase)) * (0.04 + 0.018 * sp) * ps.amp;
    ps.pose = damp(ps.pose, Math.max(this.sit, sp < 0.2 ? 0.12 : 0), 6, dt);
    ps.pitch = damp(ps.pitch, slope * (1 - this.sit), 10, dt);
    ps.yaw = f.yaw + Math.PI; ps.roll = damp(ps.roll, 0, 8, dt);
  }
  // The water at the feet from a footing: wading, or swimming once deeper than SWIM_IN (until shallower than SWIM_OUT).
  setWet(F) {
    if (F.surf === null) { if (this.wet) this.ashore = 0.5; this.wet = null; this.swimming = false; return; }
    const w = this.wet ??= { surf: 0, depth: 0, stream: false }; w.surf = F.surf; w.depth = F.depth; w.stream = F.stream;
    if (!this.swimming && F.depth > SWIM_IN) {
      this.swimming = true; this.sit = 0;
      const now = performance.now(); if (now > this.toldSwim) { this.toldSwim = now + 20000; this.say('swimming: gray squirrels can, but would rather not'); }
    } else if (this.swimming && F.depth < SWIM_OUT) this.swimming = false;
  }

  air(dt) {
    const f = this.flight, P = f.pos, ps = this.pose, V = this.vel;
    V.y -= GRAVITY * dt;
    const nx = P.x + V.x * dt, nz = P.z + V.z * dt, ny = P.y + V.y * dt;
    const s = this.surface(nx, nz, Math.max(P.y, ny) + 0.05);
    if (s - ny > STEP + 0.15 && s > P.y) { V.x *= -0.2; V.z *= -0.2; }   // hit the side of a rock: drop back
    else { P.x = nx; P.z = nz; }
    P.y = ny;
    const F = this.footing(P.x, P.z, P.y + 0.05);   // lands on the ground, the bed of a shallow creek, or in the water
    if (P.y <= F.y && V.y <= 0) {
      P.y = F.y; this.mode = 'ground'; this.v = Math.hypot(V.x, V.z) * 0.8; this.setWet(F);
      if (this.wet) { this.rippleT = 0; if (this.swimming) this.v = Math.min(this.v, SWIM); } else ps.flickV = 1;
    }
    // stretched out in the leap, the tail streaming
    ps.amp = damp(ps.amp, 0.3, 6, dt); ps.phase += dt * TAU * 2;
    ps.pose = damp(ps.pose, 0, 10, dt); ps.bob = 0;
    ps.pitch = damp(ps.pitch, -Math.atan2(V.y, Math.max(1, Math.hypot(V.x, V.z))) * 0.6, 10, dt);
    ps.yaw = f.yaw + Math.PI;
  }

  // How high the squirrel climbs: the lowest fork, where the straight bole ends (stem.len, as animals.js forkHeight; the
  // trunk line trunkAt follows is straight, so above it the squirrel would float through the crown), or 60 % of the
  // height for a tree without stem data.
  topOf(tr) {
    const fork = tr.stem ? Math.max(1.5, tr.scale * tr.stem.len * Math.cos(tr.stem.lean) - 0.3) : 0.6 * tr.H;
    return Math.min(fork, TOP * tr.H);
  }

  climb(dt, k, jump, act) {
    const tr = this.tree, ps = this.pose, top = this.topOf(tr);
    if (jump) {   // off the bark, outward
      const ox = Math.sin(this.face), oz = Math.cos(this.face);
      this.vel.set(ox * 3, 1.6, oz * 3); this.flight.yaw = this.face + Math.PI; this.lastYaw = this.flight.yaw;
      const P = this.flight.pos; P.x += ox * 0.1; P.z += oz * 0.1;
      this.mode = 'air'; this.tree = null; return;
    }
    if (act && this.crownAction()) return;
    const want = k.fwd > 0 ? CLIMB_UP : k.fwd < 0 ? -CLIMB_DOWN : 0;
    this.climbV = damp(this.climbV || 0, want, 10, dt);
    if (k.fwd) this.headUp = k.fwd > 0;
    this.h = Math.min(top, this.h + this.climbV * dt);
    const t = trunkAt(tr, Math.max(0, this.h), this._t), rr = t.r + 0.06;
    this.face = wrap(this.face + k.turn * ROUND / Math.max(rr, 0.12) * dt);
    if (this.h <= 0 && k.fwd < 0) { this.dismount(); return; }
    this.h = Math.max(0, this.h);
    const P = this.flight.pos;
    P.set(t.x + Math.sin(this.face) * rr, t.y, t.z + Math.cos(this.face) * rr);
    const moving = Math.abs(this.climbV) > 0.1 || k.turn;
    ps.amp = damp(ps.amp, moving ? 1 : 0, 10, dt); ps.phase += dt * TAU * (moving ? 3.5 * Math.max(0.6, Math.abs(this.climbV) / 1.8) : 0);
    ps.pose = 0; ps.bob = 0;
    ps.pitch = damp(ps.pitch, this.headUp ? -Math.PI / 2 : Math.PI / 2, 12, dt);
    ps.yaw = this.headUp ? this.face + Math.PI : this.face; ps.roll = 0;
    if (this.h >= top - 0.01 && want > 0 && !this.toldTop) { this.toldTop = true; this.say(/oak|quercus/.test(tr.species) ? 'at the fork: E runs out along a limb to an acorn' : 'at the fork: as high as it climbs here'); }
    if (this.h < top - 0.5) this.toldTop = false;
  }

  // Out along a limb to a crown acorn, take it, and back to the trunk.
  onLimb(dt) {
    const L = this.limb, P = this.flight.pos, ps = this.pose;
    L.u = Math.min(1, L.u + dt * LIMB_V / L.d * (L.back ? 1 : 1));
    const a = L.back ? L.to : L.from, b = L.back ? L.from : L.to;
    P.set(a.x + (b.x - a.x) * L.u, a.y + (b.y - a.y) * L.u, a.z + (b.z - a.z) * L.u);
    ps.amp = 1; ps.phase += dt * TAU * 4; ps.pose = 0; ps.bob = 0; ps.roll = 0;
    ps.pitch = damp(ps.pitch, -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)) * 0.8 - 0.1, 10, dt);
    ps.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    if (L.u < 1) return;
    if (!L.back) {
      const ok = this.acorns.isFree(L.acorn.key) && this.acorns.playerPick(L.acorn);
      this.say(ok ? `took an acorn from the crown${this.nameOf(L.acorn)}` : 'someone took it first');
      L.back = true; L.u = 0;
    } else { this.mode = 'trunk'; this.limb = null; }
  }

  working(dt) {
    const W = this.work, ps = this.pose, P = this.flight.pos;
    W.t -= dt;
    const pick = W.kind === 'pick', bark = W.back === 'trunk';   // nose down and paws going (the AI's S_WORK)
    ps.amp = damp(ps.amp, pick ? 0 : 0.35, 10, dt); ps.pose = damp(ps.pose, 0, 6, dt);
    if (!bark) ps.pitch = damp(ps.pitch, 0.15, 6, dt);
    if (!pick) ps.phase += dt * TAU * 4.5;
    ps.flick = pick ? damp(ps.flick, 0.9, 10, dt) : 0.45 + 0.45 * Math.sin((W.t0 = (W.t0 || 0) + dt) * 15);
    ps.bob = 0; void P;
    if (W.t > 0) return;
    this.mode = W.back || 'ground'; this.work = null;
    const G = this.acorns;
    if (W.kind === 'pick') {
      const ok = G.isFree(W.acorn.key) && G.playerPick(W.acorn);
      this.say(ok ? `${W.back === 'trunk' ? 'took an acorn from the crown' : 'picked up an acorn'}${this.nameOf(W.acorn)}` : 'someone took it first');
    } else if (W.kind === 'bury') {
      this.say(G.playerBury(W.x, W.y, W.z) ? 'buried it: one acorn, one hole' : 'could not bury it here');
    } else if (W.kind === 'dig') {
      this.say(G.playerDig(W.cache) ? `dug up ${W.cache.by === 'player' ? 'your' : 'a'} buried acorn` : 'nothing left here');
    }
  }
  nameOf(a) { const s = { quercus_douglasii: 'blue oak', quercus_wislizeni: 'interior live oak', blue_oak: 'blue oak', live_oak: 'interior live oak' }[a.species]; return s ? ` (${s})` : ''; }

  // E on the ground: pick up, bury or dig up.
  action() {
    const G = this.acorns, f = this.flight, P = f.pos, me = G?.player;
    if (!G || !G.running) { this.say('start a game (panel: Start game) to gather acorns'); return; }
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), nx = P.x + fx * 0.2, nz = P.z + fz * 0.2;
    if (me.carrying > 0) {
      const g = this.heights.atXZ(nx, nz), hab = this.tile.habitat.at(nx, -nz);
      if (hab === 7 || this.wet) return this.say('too wet to bury here');
      if (P.y > this.heights.atXZ(P.x, P.z) + 0.1 || this.surface(nx, nz, P.y + 0.5) > g + 0.05) return this.say('rock: find open ground');
      this.indexTrees();
      for (const l of [this.trees.get(`${Math.floor(nx / 10)},${Math.floor(nz / 10)}`)]) for (const tr of l || []) {
        const t = trunkAt(tr, 0.2, this._t); if (Math.hypot(t.x - nx, t.z - nz) < t.r + 0.35) return this.say('roots in the way: find open ground');
      }
      this.work = { kind: 'bury', t: WORK.bury, x: nx, y: g, z: nz }; this.mode = 'work'; this.v = 0; return;
    }
    const a = G.acornNear(nx, P.y + 0.2, nz, PICK_R, false);
    if (a) { this.work = { kind: 'pick', t: WORK.pick, acorn: a }; this.mode = 'work'; this.v = 0; f.yaw = Math.atan2(-(a.x - P.x), -(a.z - P.z)); return; }
    const c = G.cacheNear(nx, nz, DIG_R);
    if (c) { this.work = { kind: 'dig', t: WORK.dig, cache: c }; this.mode = 'work'; this.v = 0; return; }
    const up = G.acornNear(P.x, P.y + 1.5, P.z, 3, true);
    this.say(up ? 'that acorn is up in the crown: climb the oak' : 'nothing here: acorns lie under the oaks');
  }

  // E on a trunk: a crown acorn within CROWN_R, or out along a limb to one within LIMB_R at about this height.
  crownAction() {
    const G = this.acorns, P = this.flight.pos;
    if (!G || !G.running) { this.say('start a game (panel: Start game) to gather acorns'); return true; }
    if (G.player.carrying > 0) { this.say('your mouth is full: bury this one first'); return true; }
    const near = G.acornNear(P.x, P.y, P.z, CROWN_R, true);
    if (near) { this.work = { kind: 'pick', t: WORK.pick, acorn: near, back: 'trunk' }; this.mode = 'work'; return true; }
    let best = null, bd = Infinity;
    for (const a of G.liveAcorns) {
      if (!a.branch) continue;
      const dx = a.x - P.x, dz = a.z - P.z, dy = a.y - P.y, d = Math.hypot(dx, dz);
      if (d > LIMB_R || Math.abs(dy) > 1.0) continue;
      const t = this.tree; if (Math.hypot(a.x - t.x, a.z - t.z) > 4 * t.scale) continue;   // this tree's crown
      if (d + Math.abs(dy) < bd) { bd = d + Math.abs(dy); best = a; }
    }
    if (!best) { this.say('no acorn within reach: climb nearer one'); return true; }
    const to = new THREE.Vector3(best.x, best.y - 0.05, best.z), from = P.clone();
    to.addScaledVector(this._v.copy(to).sub(from).setY(0).normalize(), -0.2);
    this.limb = { from, to, d: Math.max(0.3, from.distanceTo(to)), u: 0, back: false, acorn: best }; this.mode = 'limb';
    return true;
  }

  // Rings spreading on the water from a swimming or wading squirrel (a few reused meshes, after the water draws).
  ripple(dt) {
    const R = this.ripples, P = this.flight.pos, w = this.wet;
    if (!R.length) {
      const geo = new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2);
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe6eef0, transparent: true, opacity: 0, depthWrite: false }));
        m.visible = false; m.renderOrder = 5; m.frustumCulled = false; m.name = 'squirrel ripple'; this.scene.add(m); R.push({ m, age: 0 });
      }
    }
    if (w && (this.mode === 'ground' || this.mode === 'work') && (this.swimming || Math.abs(this.v) > 0.25)) {
      this.rippleT -= dt;
      if (this.rippleT <= 0) {
        this.rippleT = this.swimming ? RIPPLE_EVERY : RIPPLE_EVERY * 0.6;
        const r = R.find(q => !q.m.visible) || R.reduce((a, b) => (b.age > a.age ? b : a));
        r.age = 0; r.m.position.set(P.x, w.surf + 0.02, P.z); r.m.visible = true;
      }
    }
    for (const r of R) {
      if (!r.m.visible) continue;
      r.age += dt; const u = r.age / RIPPLE_LIFE;
      if (u >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar(0.1 + 0.5 * Math.sqrt(u)); r.m.material.opacity = 0.28 * (1 - u) * (1 - u);
    }
  }

  // ---- drawing -------------------------------------------------------------------------------------
  draw() {
    const m = this.mesh, ps = this.pose, P = this.flight.pos; if (!m) return;
    m.visible = true;
    this._e.set(ps.pitch, ps.yaw, ps.roll, 'YXZ'); this._q.setFromEuler(this._e);
    this._p.set(P.x, P.y + ps.bob, P.z);
    this._m.compose(this._p, this._q, this._s);
    this._m.toArray(m.instanceMatrix.array, 0); m.instanceMatrix.needsUpdate = true;
    const an = m.geometry.attributes.aAnim; an.array[0] = ps.phase % TAU; an.array[1] = ps.amp; an.array[2] = ps.pose; an.array[3] = ps.flick; an.needsUpdate = true;
    if (this.rig) { const a2 = m.geometry.attributes.aAnim2; a2.array[0] = ps.e0; a2.array[1] = ps.e1; a2.array[2] = 0; a2.array[3] = 0; a2.needsUpdate = true; }
    // the acorn in its mouth
    const carrying = this.acorns?.running && this.acorns.player.carrying > 0;
    this.nut.visible = !!carrying;
    if (carrying) {
      const c = this.animals.carryPoint({ sp: this.sp, flick: ps.flick, pose: ps.pose, phase: ps.phase, amp: ps.amp }, this._m);
      this.nut.position.copy(c); this.nut.rotation.set(Math.PI / 2 + ps.pitch, ps.yaw, 0, 'YXZ');
    }
  }

  // Chase camera: ~0.6 m up and 2.5 m back on the ground (higher and nearer sitting up), a three-quarter view CAM_SIDE
  // off the heading so the bound and the acorn in the mouth show past the tail. It sits on the inside of the last turn
  // (turning left, the left rear), the side the chase lag already swings it to, so the two add instead of cancelling
  // to a view of the tail, and it eases across behind when the turn changes side. On a trunk it
  // stands off the bark over the squirrel's shoulder and orbits with it round the trunk (a drag orbits it further).
  // Then it is kept out of the ground: above the drawn terrain round the lens (the near plane is NEAR), the sight
  // line to the squirrel clear of a slope between them (running downhill the ground behind rises), and over a pond.
  updateCamera(dt) {
    const f = this.flight, P = f.pos, cam = this.camera, off = this._v, aim = this._w;
    let k = 7;
    const rate = wrap(f.yaw - (this.camYaw ?? f.yaw)) / Math.max(dt, 1e-3); this.camYaw = f.yaw;   // keys or a drag
    if (Math.abs(rate) > 0.3 && (this.mode === 'ground' || this.mode === 'air')) this.camSide = damp(this.camSide, -Math.sign(rate) * CAM_SIDE, CAM_SWING, dt);
    if ((this.mode === 'trunk' || this.mode === 'limb' || (this.mode === 'work' && this.work?.back === 'trunk')) && this.tree) {
      const tr = this.tree, ang = this.face + this.camOrbit, t = trunkAt(tr, Math.max(0, this.h), this._t);
      const out = t.r + 2.1, side = 0.55, ox = Math.sin(ang), oz = Math.cos(ang);
      off.set(t.x + ox * out + oz * side - P.x, t.y + (this.headUp ? -0.55 : 0.75) - P.y, t.z + oz * out - ox * side - P.z);
      aim.set(0, this.headUp ? 0.5 : -0.35, 0);
      k = 5;
    } else {
      const back = CAM_BACK - 0.5 * this.sit, up = CAM_UP + 0.45 * this.sit, a = f.yaw + this.camSide;
      off.set(Math.sin(a) * back, up, Math.cos(a) * back);
      const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), look = 1.2;
      aim.set(fx * look, 0.22 + 0.25 * this.sit + Math.tan(f.pitch) * (back + look), fz * look);
    }
    if (!this.camSettled) { this.camOff.copy(off); this.aimOff.copy(aim); this.camSettled = true; this.camLift = 0; }
    else { this.camOff.lerp(off, 1 - Math.exp(-dt * k)); this.aimOff.lerp(aim, 1 - Math.exp(-dt * k)); }
    cam.position.copy(P).add(this.camOff);
    // the lift that keeps it out of the ground: up at once, back down gently (no bob over every bump)
    const need = this.camClear(P, cam.position) - cam.position.y;
    this.camLift = need > this.camLift ? need : damp(this.camLift, need, 3, dt);
    if (this.camLift > 0) cam.position.y += this.camLift;
    cam.up.set(0, 1, 0);
    cam.lookAt(aim.copy(P).add(this.aimOff));
  }
  // The lowest camera height at C (looking at the squirrel at P) that keeps the near plane out of the drawn terrain
  // and of a pond's surface, and the line from the squirrel's back to the lens above the ground between them.
  camClear(P, C) {
    const H = this.heights, r = NEAR * 1.6;
    let y = -Infinity;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) y = Math.max(y, H.atXZ(C.x + dx, C.z + dz) + CAM_CLEAR);
    const w = this.pondLevel(C.x, C.z); if (w !== null) y = Math.max(y, w + CAM_WATER);
    const y0 = P.y + 0.2;
    for (const t of [0.25, 0.5, 0.75]) {   // y0 + t (Cy - y0) >= ground + CAM_SIGHT at each point between
      const g = H.atXZ(P.x + (C.x - P.x) * t, P.z + (C.z - P.z) * t) + CAM_SIGHT;
      if (g > y0) y = Math.max(y, y0 + (g - y0) / t);
    }
    return y;
  }
  // The water level of a pond holding water over (x, z) (water.js: ponds are flat at their level; streams are draped on
  // the terrain, so the terrain clearance covers them), or null.
  pondLevel(x, z) {
    const W = this.waterObj();
    if (!W?.pondRings) return null;
    const n = -z;
    for (const p of W.pondRings) {
      const [x0, y0, x1, y1] = p.bbox;
      if (x < x0 || x > x1 || n < y0 || n > y1) continue;
      if (!(p.intermittent ? W.pondsSeasonal.visible : W.ponds.visible)) continue;
      if (inRing(x, n, p.ring)) return p.level;
    }
    return null;
  }
}

// Point in polygon (x, north rings), even-odd.
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
