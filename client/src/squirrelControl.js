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
// A / D go round the trunk, up to TOP of the tree's height; E there takes an acorn in the crown within CROWN_R, or
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
    this.jumpQ = false; this.actQ = false; this.camOrbit = 0; this.lastYaw = 0;
    this.camOff = new THREE.Vector3(); this.aimOff = new THREE.Vector3(); this.camSettled = false;
    this.last = new THREE.Vector3(); this.trees = new Map(); this.treeVersion = -1;
    this._t = { x: 0, y: 0, z: 0, r: 0 }; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
    this.ray = new THREE.Raycaster(); this.ray.ray.direction.set(0, -1, 0); this._hits = []; this._rockMesh = new THREE.Mesh();
    this.mesh = null; this.sp = 0;
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
    P.set(x, this.heights.atXZ(x, z), z);
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
    this.attach(tree, wrap(this.flight.yaw - Math.PI), Math.min(1.4, TOP * tree.H));   // below the fork, so the camera is under the crown
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
    if (Math.random() < dt * (this.v < 0.5 ? 0.8 : 0.15)) ps.flickV = 1;
    if (ps.flickV > 0) { ps.flick = Math.max(ps.flick, Math.sin(Math.min(1, 1 - ps.flickV) * Math.PI)); ps.flickV -= dt * 3; }
    else if (!this.work) ps.flick = damp(ps.flick, 0, 1, dt);
    ps.e0 = damp(ps.e0, this.mode === 'trunk' || this.work?.back === 'trunk' ? 1 : 0, 8, dt);
    ps.e1 = damp(ps.e1, ps.flick, 5, dt);
    if (ps.phase > 1e4) ps.phase -= TAU * 1000;
    this.draw();
    this.updateCamera(dt);
    this.last.copy(P);
    const ground = this.heights.atXZ(P.x, P.z), speed = this.mode === 'trunk' ? Math.abs(this.climbV || 0) : this.mode === 'air' ? Math.hypot(this.vel.x, this.vel.z) : Math.abs(this.v);
    f.speed = speed;
    const heading = ((this.mode === 'trunk' ? (this.face + Math.PI) : f.yaw) * -180 / Math.PI % 360 + 360) % 360;
    return { hover: false, agl: P.y - ground, elev: P.y, speed, heading };
  }

  ground(dt, k, jump, act) {
    const f = this.flight, P = f.pos, ps = this.pose;
    const sitting = k.sit && Math.abs(this.v) < 1.2;
    this.sit = damp(this.sit, sitting ? 1 : 0, sitting ? 4 : 8, dt);
    const target = sitting ? 0 : k.fwd > 0 ? RUN : k.fwd < 0 ? -BACK : 0;
    this.v = damp(this.v, target, target === 0 ? 7 : ACCEL, dt);
    if (Math.abs(this.v) < 0.02 && !target) this.v = 0;
    f.yaw += k.turn * TURN * (sitting ? 0.6 : 1) * dt;
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    if (jump && !sitting) {   // a hop: forward at least JUMP_FWD, with the run's speed if faster
      const fw = Math.max(Math.abs(this.v) < 0.3 ? 0 : JUMP_FWD, this.v);
      this.vel.set(fx * fw, JUMP_UP, fz * fw); this.mode = 'air'; this.sit = 0; return;
    }
    if (act) { this.action(); if (this.mode !== 'ground') return; }
    // run into a trunk: take hold
    if (k.fwd > 0 && this.v > 0.3) {
      const tr = this.trunkAhead(P, fx, fz);
      if (tr) { const t = trunkAt(tr, 0.25, this._t); this.attach(tr, Math.atan2(P.x - t.x, P.z - t.z)); this.v = 0; return; }
    }
    const nx = P.x + fx * this.v * dt, nz = P.z + fz * this.v * dt;
    const s = this.surface(nx, nz, P.y + STEP + 0.1);
    if (s - P.y > STEP) this.v = 0;   // a rock face: jump it
    else {
      P.x = Math.max(5, Math.min(this.tile.size - 5, nx)); P.z = Math.min(-5, Math.max(-this.tile.size + 5, nz));
      if (s < P.y - 0.35) { this.vel.set(fx * this.v, 0, fz * this.v); this.mode = 'air'; }   // off the edge of a rock
      else P.y = s;
    }
    // pose: the bound (stride lengthens with speed), sit-up, the body along the slope
    const sp = Math.abs(this.v), stride = 0.42 + 0.12 * sp;
    ps.amp = damp(ps.amp, sp > 0.15 ? Math.min(1, 0.35 + sp / 3) : 0, 10, dt);
    ps.phase += dt * TAU * sp / stride;
    ps.bob = Math.abs(Math.sin(ps.phase)) * (0.04 + 0.018 * sp) * ps.amp;
    ps.pose = damp(ps.pose, Math.max(this.sit, sp < 0.2 ? 0.12 : 0), 6, dt);
    const hf = this.heights.atXZ(P.x + fx * 0.15, P.z + fz * 0.15), hb = this.heights.atXZ(P.x - fx * 0.15, P.z - fz * 0.15);
    ps.pitch = damp(ps.pitch, -Math.atan2(hf - hb, 0.3) * (1 - this.sit), 10, dt);
    ps.yaw = f.yaw + Math.PI; ps.roll = damp(ps.roll, 0, 8, dt);
  }

  air(dt) {
    const f = this.flight, P = f.pos, ps = this.pose, V = this.vel;
    V.y -= GRAVITY * dt;
    const nx = P.x + V.x * dt, nz = P.z + V.z * dt, ny = P.y + V.y * dt;
    const s = this.surface(nx, nz, Math.max(P.y, ny) + 0.05);
    if (s - ny > STEP + 0.15 && s > P.y) { V.x *= -0.2; V.z *= -0.2; }   // hit the side of a rock: drop back
    else { P.x = nx; P.z = nz; }
    P.y = ny;
    const g = this.surface(P.x, P.z, P.y + 0.05);
    if (P.y <= g && V.y <= 0) { P.y = g; this.mode = 'ground'; this.v = Math.hypot(V.x, V.z) * 0.8; ps.flickV = 1; }
    // stretched out in the leap, the tail streaming
    ps.amp = damp(ps.amp, 0.3, 6, dt); ps.phase += dt * TAU * 2;
    ps.pose = damp(ps.pose, 0, 10, dt); ps.bob = 0;
    ps.pitch = damp(ps.pitch, -Math.atan2(V.y, Math.max(1, Math.hypot(V.x, V.z))) * 0.6, 10, dt);
    ps.yaw = f.yaw + Math.PI;
  }

  climb(dt, k, jump, act) {
    const tr = this.tree, ps = this.pose, top = TOP * tr.H;
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
    if (this.h >= top - 0.01 && want > 0 && !this.toldTop) { this.toldTop = true; this.say('as high as it goes: the crown is too thin above'); }
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
      if (hab === 7) return this.say('too wet to bury here');
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

  // Chase camera: ~0.6 m up and 2.5 m behind on the ground (higher and nearer sitting up); on a trunk it stands off
  // the bark over the squirrel's shoulder and orbits with it round the trunk (a drag orbits it further).
  updateCamera(dt) {
    const f = this.flight, P = f.pos, cam = this.camera, ps = this.pose, off = this._v, aim = this._w;
    let k = 7;
    if ((this.mode === 'trunk' || this.mode === 'limb' || (this.mode === 'work' && this.work?.back === 'trunk')) && this.tree) {
      const tr = this.tree, ang = this.face + this.camOrbit, t = trunkAt(tr, Math.max(0, this.h), this._t);
      const out = t.r + 2.1, side = 0.55, ox = Math.sin(ang), oz = Math.cos(ang);
      off.set(t.x + ox * out + oz * side - P.x, t.y + (this.headUp ? -0.55 : 0.75) - P.y, t.z + oz * out - ox * side - P.z);
      aim.set(0, this.headUp ? 0.5 : -0.35, 0);
      k = 5;
    } else {
      const back = CAM_BACK - 0.5 * this.sit, up = CAM_UP + 0.45 * this.sit;
      off.set(Math.sin(f.yaw) * back, up, Math.cos(f.yaw) * back);
      const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), look = 1.2;
      aim.set(fx * look, 0.22 + 0.25 * this.sit + Math.tan(f.pitch) * (back + look), fz * look);
    }
    if (!this.camSettled) { this.camOff.copy(off); this.aimOff.copy(aim); this.camSettled = true; }
    else { this.camOff.lerp(off, 1 - Math.exp(-dt * k)); this.aimOff.lerp(aim, 1 - Math.exp(-dt * k)); }
    cam.position.copy(P).add(this.camOff);
    const g = this.heights.atXZ(cam.position.x, cam.position.z) + 0.25;
    if (cam.position.y < g) cam.position.y = g;
    cam.up.set(0, 1, 0);
    cam.lookAt(aim.copy(P).add(this.aimOff));
    void ps;
  }
}
