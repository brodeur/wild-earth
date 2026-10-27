import * as THREE from 'three';
import { SPECIES as PLANTS } from './trees.js';
import { buildWoodpecker, animalMaterial, animalDepthMaterial } from './animalModels.js';
import { addCaster } from './shadows.js';
import { trunkAt } from './animals.js';
import { acornGeometry } from './acorns.js';

// The playable acorn woodpecker (docs/game-acorn-stash.md, "Playable woodpecker"). A perch-and-fly controller beside
// RavenFlight and SquirrelControl: when the player is a woodpecker, main.js calls this instead of flight.update, and it
// drives the same `flight.pos` and `flight.yaw` (forward is -z at yaw 0), so the forest, grass, minimap, identify,
// animals, acorns and sound all follow it as they followed the raven. The raven's body is hidden.
//
// Two main modes, as the bird lives:
//   cling  on a trunk, braced on the tail (the AI's CLING_PITCH): W / S hitch up and down the bark in short hops (down
//          is tail first, as woodpeckers back down), A / D hitch round the trunk, Space launches outward. Up to just
//          under the fork (the drawn bole; above it the crown has no trunk to hold).
//   fly    short undulating flights: bursts of quick beats, then a closed-wing dip of about 30 cm (the real acorn
//          woodpecker's flight). W / S speed (2.5-12 m/s), A / D turn, a mouse drag or the arrows pitch and turn;
//          Space is a hard burst upward. Flying into a trunk (within GRIP_R of the bark, facing it) grips it and goes
//          to cling; S inside a crown lands on a branch there, and S near the ground (under 4 m) lands on the ground.
// Perched on the ground or a branch (rare for this species) W hops a short way, A / D turn, Space launches.
//
// E acts, through the acorn game's events (acorns.js): clinging, take a crown acorn within CROWN_R, or fly out to one
// within REACH_R in this tree's crown and back to the bark; flying, fly to the nearest acorn within FLY_PICK_R and
// take it (perching there); on the ground, take one at the bill. Carrying (cap 1, in the bill), E clinging on the
// family's granary hammers it in for 2-3 s (the AI's beat) and deposits it: a 'deposit' into 'granary', scored for
// acorn woodpeckers and the board's "you, a woodpecker". No burying.
//
// The family's granary is the AI families' rule (animals.familyGranary): the nearest stash tree within 150 m of the
// arrival point, else the nearest oak. The player arrives clinging to it.
//
// The model is the AI woodpecker's procedural one (buildWoodpecker, male or female) as one extra instance posed from
// the controller: aAnim = (wing phase, flap, wing fold, head strike), the instance pitch for the cling and the
// undulation. The acorn rides at the bill (the AI's CARRY point for the woodpecker).

const CODE = 'melanerpes_formicivorus';
const CLING_PITCH = -1.72;                                    // animals.js: nose up, just past vertical, tail on the bark
// flight
const V_MAX = 12, V_MIN = 2.5, V_CRUISE = 7, ACCEL = 5, DECEL = 6, TURN = 2.1, PITCH_RATE = 1.1, PITCH_MAX = 0.6, CEIL = 80;
const BURST = 0.42, DIP = 0.36, UND_A = 0.17, BEAT = 12;      // s of beats, s wings shut; m half the dip; Hz
const GRIP_R = 1.0, GRIP_T = 0.22;                            // m from the bark to take hold; s to settle onto it
// clinging: one hitch is a short hop of the feet
const HITCH = 0.13, HITCH_T = 0.11, HITCH_GAP = 0.08, ROUND_STEP = 0.12, BARK = 0.02;
// ground
const HOP_D = 0.45, HOP_T = 0.28, HOP_UP = 0.1;
// acorns
const CROWN_R = 1.2, REACH_R = 5, GROUND_R = 0.8, FLY_PICK_R = 5, PICK_T = 0.8, HAMMER = [2.0, 3.0];
const CARRY = { py: 0.062, pz: 0.05, ty: 0.066, tz: 0.137, flick: 0.45 };   // animals.js CARRY[WP]: the bill tip, the head pivot
// camera: the flight chase CAM_UP over and CAM_BACK behind with a longer lens (FLY_FOV degrees, vertical; the raven's
// 70 elsewhere), so the bird is 60-90 px on screen; on the bark the camera keeps out of the crowns (crownClear)
const CAM_BACK = 2, CAM_UP = 0.8, NEAR = 0.12, CLING_OUT = 0.85, FLY_FOV = 52;
const CROWN_PAD = [0.4, 0.12, 1.0], CROWN_LOWER = 1.1, CROWN_MIN = 0.6;   // the leaves drooping under the sphere: m + x its radius, at most m; m: lowest drop; shortest boom
const TAU = Math.PI * 2;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = t => t * t * (3 - 2 * t);

export class WoodpeckerControl {
  constructor({ tile, scene, camera, flight, veg, animals, acorns, atmosphere, caption = null }) {
    Object.assign(this, { tile, scene, camera, flight, veg, animals, acorns, atmosphere, captionEl: caption });
    this.heights = animals.heights;   // the drawn terrain mesh, as the animals stand on it
    this.on = false; this.mode = 'fly'; this.female = false;
    this.v = V_CRUISE; this.baseY = 0; this.burst = true; this.uc = 0; this.undA = 0; this.boost = 0; this.prevY = 0; this.vy = 0;
    this.tree = null; this.h = 0; this.face = 0; this.hitch = null; this.hitchGap = 0; this.perch = 'ground';
    this.path = null; this.work = null; this.auto = null; this.granary = null; this.granaryRec = null;
    this.pose = { phase: 0, amp: 0, fold: 1, flick: 0, pitch: 0, yaw: 0, roll: 0 };
    this.jumpQ = false; this.actQ = false; this.camOrbit = 0; this.lastYaw = 0; this.time = 0;
    this.camOff = new THREE.Vector3(); this.aimOff = new THREE.Vector3(); this.camSettled = false;
    this.last = new THREE.Vector3(); this.trees = new Map(); this.treeVersion = -1;
    this._t = { x: 0, y: 0, z: 0, r: 0 }; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._c = new THREE.Vector3();
    // the bird: one instance of the procedural woodpecker per sex (the one not chosen stays hidden)
    this.meshes = [false, true].map(female => this.build(female));
    // the acorn in its bill
    this.nut = new THREE.Mesh(acornGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.nut.scale.setScalar(0.045); this.nut.visible = false; scene.add(this.nut);
    // a short line for what E did (or why it did nothing)
    this.toast = document.createElement('div'); this.toast.id = 'wpToast';
    this.toast.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:6;padding:6px 12px;border-radius:7px;'
      + 'background:#0f1512d8;border:1px solid #263128;color:#e6ede7;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
      + 'pointer-events:none;opacity:0;transition:opacity .3s;white-space:nowrap;max-width:calc(100vw - 32px);overflow:hidden;text-overflow:ellipsis';
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
  build(female) {
    const model = buildWoodpecker(female), geo = model.geometry;
    geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
    const mesh = new THREE.InstancedMesh(geo, animalMaterial(this.atmosphere, model), 1);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true; mesh.name = `player woodpecker${female ? ' (female)' : ''}`;
    mesh.customDepthMaterial = animalDepthMaterial(model);
    mesh.visible = false; this.scene.add(mesh);
    addCaster(mesh, { cascades: [0], simple: false });   // follows the mesh's visibility
    return mesh;
  }
  get mesh() { return this.meshes[this.female ? 1 : 0]; }

  // ---- on and off ---------------------------------------------------------------------------------
  setOn(on, sex = null) {
    on = !!on;
    if (sex) this.female = sex === 'female';
    if (on) this.acorns?.setPlayerSpecies(CODE);
    for (const m of this.meshes) m.visible = false;
    if (on === this.on) { if (on) this.mesh.visible = true; return; }
    if (!on && this.auto) this.finishArrival(true);   // left mid-arrival (spirit.js): its onDone still runs
    this.on = on;
    const f = this.flight;
    f.body.visible = !on && f.view === 'chase';
    if (on) this.mesh.visible = true;
    this.nut.visible = false;
    if (on) { f.roll = 0; f.hover = false; this.camSettled = false; this.lastYaw = f.yaw; this.relocate(); }
    else {   // back to the raven (or the spirit, which places itself); every state let go
      this.camera.up.set(0, 1, 0); this.acorns?.setFamilyGranary?.(null); this.animals.familyOn?.(null); f.reset(f.pos.x, f.pos.z, 30);
      this.mode = 'fly'; this.tree = null; this.path = null; this.work = null; this.hitch = null; this.granary = this.granaryRec = null; this.familyDue = 0;
      this.jumpQ = this.actQ = false;
    }
    if (on) { this.nearWas = this.camera.near; this.fovWas = this.camera.fov; }
    this.camera.near = on ? NEAR : this.nearWas || 0.5;
    if (!on && this.fovWas) this.camera.fov = this.fovWas;   // the lens back for the raven (or the squirrel)
    this.camera.updateProjectionMatrix();
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
    if (h1?.firstChild) h1.firstChild.nodeValue = on ? 'acorn woodpecker ' : W.h1;
    if (help) help.innerHTML = on ? 'on a trunk: <kbd>W</kbd><kbd>S</kbd> hitch up, down · <kbd>A</kbd><kbd>D</kbd> round · <kbd>space</kbd> fly · '
      + 'flying: <kbd>W</kbd><kbd>S</kbd> speed · <kbd>A</kbd><kbd>D</kbd> turn · <kbd>↑</kbd><kbd>↓</kbd> or drag to climb, dive · <kbd>space</kbd> burst · fly into a trunk to cling · <kbd>S</kbd> low to land · '
      + '<kbd>E</kbd> take an acorn; at your granary, hammer it in · <kbd>M</kbd> map · <kbd>P</kbd> present day · <kbd>T</kbd> tags · <kbd>N</kbd> mute · <kbd>B</kbd> back to spirit form · click a tree to identify' : W.help;
    const agl = $('agl')?.previousElementSibling, sp = $('speed')?.previousElementSibling;
    if (agl) agl.textContent = on ? 'height above ground' : W.agl;
    if (sp) sp.textContent = on ? 'speed' : W.speed;
    const hb = $('hoverBtn'); if (hb) hb.style.display = on ? 'none' : '';
    // "your family's granary": its count and how far
    let row = $('wpGranary');
    if (!row && h1) {
      row = document.createElement('div'); row.className = 'row wide'; row.id = 'wpGranary';
      row.innerHTML = '<span>your family\'s granary</span><b>–</b>'; h1.after(row);
    }
    if (row) row.style.display = on ? '' : 'none';
  }
  hudTick() {
    const el = document.getElementById('wpGranary')?.querySelector('b'); if (!el) return;
    const g = this.granary, P = this.flight.pos;
    if (!g) { el.textContent = 'none near'; return; }
    const n = this.acorns?.world?.granaries?.[g.id] || 0, d = Math.hypot(g.x - P.x, g.z - P.z);
    const where = this.atGranary() ? 'you are on it' : d < 1000 ? `${Math.round(d)} m ${compass(Math.atan2(g.x - P.x, -(g.z - P.z)))}` : 'far';
    const text = `${n} acorn${n === 1 ? '' : 's'} · ${where}`;
    if (el.textContent !== text) el.textContent = text;
  }

  say(text) {
    const t = this.toast; t.textContent = text; t.style.opacity = '1';
    clearTimeout(this.toastT); this.toastT = setTimeout(() => { t.style.opacity = '0'; }, 2400);
  }

  // ---- placing -------------------------------------------------------------------------------------
  // Moved from outside (a switch from the raven, R, Go to): flying where it is, low over the ground.
  relocate() {
    const f = this.flight, P = f.pos, g = this.heights.atXZ(P.x, P.z);
    P.y = clamp(P.y, g + 3, g + 25);
    this.mode = 'fly'; this.v = V_CRUISE; this.baseY = P.y; this.undA = 0; this.burst = true; this.uc = 0; f.pitch = 0;
    this.tree = null; this.path = null; this.work = null; this.hitch = null;
    this.last.copy(P); this.prevY = P.y; this.camSettled = false;
  }

  // The family's granary near (x, z): the AI families' rule (animals.familyGranary). Shown in the HUD and on its tag.
  setGranary(x, z) {
    const g = this.animals.familyGranary?.(x, z) || null;
    this.granary = g; this.granaryRec = g ? this.record(g) : null;
    this.acorns?.setFamilyGranary?.(g ? g.id : null);
    this.familyDue = 1.5;   // the family on it, once the animals have rebuilt around the new place (animals.familyOn)
    return g;
  }
  // The family's granary is this oak (spirit.js: the AI bird the player came into lived there).
  setGranaryOak(o) {
    this.granary = o; this.granaryRec = o ? this.record(o) : null;
    this.acorns?.setFamilyGranary?.(o ? o.id : null);
    this.familyDue = 1.5;
  }
  // The spirit (spirit.js) comes into an AI woodpecker: the player carries on as it was (animals.js info): on the
  // bark of its tree, perched on the ground or in a crown, or in the air at its speed. Its family's granary is its own.
  enterAt(o) {
    const f = this.flight, P = f.pos;
    this.auto = null; this.onArrived = null;
    P.set(o.x, o.y, o.z); f.yaw = this.lastYaw = o.yaw; f.pitch = 0; f.roll = 0;
    this.mode = 'fly'; this.tree = null; this.path = null; this.work = null; this.hitch = null;
    if (o.anchor) this.setGranaryOak(o.anchor);
    if (o.where === 'cling' && o.tree) {
      const tr = this.record(o.tree);
      this.attach(tr, o.face, clamp(o.h, 0.3, this.top(tr))); this.place();
    } else if (o.where === 'ground') this.land('ground');
    else if (o.where === 'top') this.land('branch');
    else { this.v = clamp(o.speed || V_CRUISE, V_MIN, V_MAX); this.baseY = P.y; this.undA = 0; this.burst = true; this.uc = 0; }
    this.last.copy(P); this.prevY = P.y; this.camSettled = false; this.camOrbit = 0;
  }
  // Where the player leaves this woodpecker (spirit.js), for the AI to carry on from (animals.js release): as info.
  leaveInfo() {
    const P = this.flight.pos, m = this.mode, back = this.work?.back;
    const o = { x: P.x, y: P.y, z: P.z, yaw: this.flight.yaw, where: 'air', tree: null, face: 0, h: 0, speed: this.v };
    if ((m === 'cling' || (m === 'work' && back === 'cling')) && this.tree) Object.assign(o, { where: 'cling', tree: this.tree, face: this.face, h: this.h, yaw: this.face + Math.PI });
    else if (m === 'perch' || (m === 'work' && back)) o.where = (m === 'perch' ? this.perch : back) === 'ground' ? 'ground' : 'top';
    return o;
  }
  atGranary() {
    const g = this.granary, t = this.tree;
    return !!(g && t && (this.mode === 'cling' || this.work?.back === 'cling') && Math.hypot(t.x - g.x, t.z - g.z) < 0.5);
  }

  // The arrival for a woodpecker: clinging to the family's granary (the nearest stash tree to the chosen point, else
  // the nearest oak), the camera drifting in from a wider view for a few seconds. onDone when it ends (or a key skips it).
  arrive(point, caption, onDone = null) {
    const S = this.tile.size, x = Math.min(S - 60, Math.max(60, point?.x ?? S / 2)), z = -Math.min(S - 60, Math.max(60, point?.north ?? S / 2));
    this.veg.update(x, z, true);   // the forest around the point now, so its oaks are known
    const g = this.setGranary(x, z);
    this.flight.pos.set(x, this.heights.atXZ(x, z) + 10, z); this.last.copy(this.flight.pos);
    this.onArrived = onDone;
    if (!g) { this.relocate(); this.finishArrival(false); return; }
    const tree = this.granaryRec;
    const face = Math.atan2(x - g.x, z - g.z) + 0.6;   // the side toward the point, a little round
    this.attach(tree, face, Math.min(2.4, this.top(tree) * 0.7));
    this.place(); this.last.copy(this.flight.pos); this.prevY = this.flight.pos.y;
    this.camSettled = false; this.camOrbit = 0;
    this.auto = { t: 0 };
    this.say(`your family's granary: ${this.acorns?.world?.granaries?.[g.id] || 0} acorns in it`);
    if (caption && this.captionEl) {
      const c = this.captionEl; c.querySelector('.cap-text').textContent = caption;
      c.hidden = false; c.getAnimations().forEach(a => a.cancel());
      this.capAnim = c.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 6000, fill: 'forwards' });
      this.capAnim.onfinish = () => { c.hidden = true; };
    }
  }
  finishArrival(skipped) {
    this.auto = null;
    this.flight.keys.clear(); this.jumpQ = this.actQ = false;
    const cb = this.onArrived; this.onArrived = null; cb?.(skipped);
  }

  // ---- trees ---------------------------------------------------------------------------------------
  // The near set's trees (not shrubs) on a 10 m grid: position, scale and rotation from the instance matrix, the
  // variant's stem and height (as squirrelControl.js). Rebuilt when the vegetation refreshes its near set.
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
  record(o) { return { id: o.id, species: o.species, x: o.x, y: o.y, z: o.z, scale: o.scale, rot: o.rot, stem: o.stem, height: o.height, H: Math.max(2, (o.height || 8) * o.scale), snag: o.snag }; }
  // How high a woodpecker can cling: just under the fork of the drawn bole (the AI's forkHeight * 0.95).
  top(tr) { return 0.95 * (tr.stem ? Math.max(1.5, tr.scale * tr.stem.len * Math.cos(tr.stem.lean) - 0.3) : 2.5); }
  // A trunk to grip: within GRIP_R of the bark at the bird's height (below the fork), roughly ahead.
  trunkAhead(P, fx, fz) {
    this.indexTrees();
    const ci = Math.floor(P.x / 10), cj = Math.floor(P.z / 10), t = this._t;
    let best = null, bd = GRIP_R, bh = 0;
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const l = this.trees.get(`${i},${j}`); if (!l) continue;
      for (const tr of l) {
        const h = P.y - tr.y; if (h < 0.25 || h > this.top(tr)) continue;
        trunkAt(tr, h, t);
        const dx = t.x - P.x, dz = t.z - P.z, d = Math.hypot(dx, dz), gap = d - t.r;
        if (gap > bd || d < 1e-3) continue;
        if ((dx * fx + dz * fz) / d < 0.4) continue;   // not flying at it
        bd = gap; best = tr; bh = h;
      }
    }
    return best ? { tree: best, h: bh } : null;
  }
  // The tree whose crown holds P (for landing on a branch), or null.
  crownAt(P) {
    this.indexTrees();
    const ci = Math.floor(P.x / 10), cj = Math.floor(P.z / 10);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      for (const tr of this.trees.get(`${i},${j}`) || []) {
        const h = P.y - tr.y, r = Math.hypot(P.x - tr.x, P.z - tr.z);
        if (h > 1.2 && h < tr.H * 0.9 && r < Math.max(1.5, 0.35 * tr.H) && h > this.top(tr) * 0.6) return tr;
      }
    }
    return null;
  }
  attach(tree, face, h) {
    this.tree = tree; this.face = face; this.h = h; this.mode = 'cling'; this.v = 0; this.hitch = null; this.hitchGap = 0;
    this.camOrbit = 0; this.work = null; this.path = null;
  }
  // The bird's place on the bark for (tree, face, h).
  barkPoint(tree, face, h, out) {
    const t = trunkAt(tree, Math.max(0, h), this._t), rr = t.r + BARK;
    return out.set(t.x + Math.sin(face) * rr, t.y, t.z + Math.cos(face) * rr);
  }
  place() { if (this.tree) this.barkPoint(this.tree, this.face, this.h, this.flight.pos); }

  // ---- the frame -----------------------------------------------------------------------------------
  input() {
    const k = this.flight.keys;
    if (this.auto) return { fwd: 0, turn: 0, pitch: 0 };
    return {
      fwd: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      turn: (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0),
      pitch: (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0),
    };
  }

  update(dt) {
    const f = this.flight, P = f.pos, ps = this.pose;
    this.time += dt;
    f.body.visible = false; f.flap = 0; f.flapping = false; f.hover = false;   // the raven's keys still land in flight; ignore them
    if (P.distanceToSquared(this.last) > 20 * 20) this.relocate();            // moved from outside (R, Go to)
    const k = this.input();
    // a mouse drag: in flight it steers (flight.yaw, flight.pitch); on the bark it orbits the camera; perched it turns
    const dragYaw = wrap(f.yaw - this.lastYaw);
    if (this.mode === 'cling' || (this.mode === 'work' && this.work.back === 'cling') || this.mode === 'path') { this.camOrbit += dragYaw; f.yaw = this.lastYaw; }
    if (this.auto && (this.auto.t += dt) > 4) this.finishArrival(false);
    if (this.familyDue > 0 && (this.familyDue -= dt) <= 0) this.family = this.animals.familyOn?.(this.granary) || [];
    // Space and E pressed during a short flight, a hop or the pecking wait for it to end (half a second at most)
    const busy = this.mode === 'path' || this.mode === 'work';
    if (this.jumpQ) this.jumpQ = this.jumpQ === true ? this.time : this.jumpQ;
    if (this.actQ) this.actQ = this.actQ === true ? this.time : this.actQ;
    const jump = !busy && !!this.jumpQ && this.time - this.jumpQ < 0.5, act = !busy && !!this.actQ && this.time - this.actQ < 0.5;
    if (!busy || (this.jumpQ && this.time - this.jumpQ >= 0.5)) this.jumpQ = false;
    if (!busy || (this.actQ && this.time - this.actQ >= 0.5)) this.actQ = false;
    switch (this.mode) {
      case 'cling': this.cling(dt, k, jump, act); break;
      case 'fly': this.fly(dt, k, jump, act); break;
      case 'perch': this.perched(dt, k, jump, act); break;
      case 'path': this.onPath(dt); break;
      case 'work': this.working(dt); break;
    }
    if (this.mode !== 'cling' && this.mode !== 'path' && this.mode !== 'work') this.camOrbit = damp(this.camOrbit, 0, 3, dt);
    this.lastYaw = f.yaw;
    if (ps.phase > 1e4) ps.phase -= TAU * 1000;
    this.vy = dt > 0 ? (P.y - this.prevY) / dt : 0; this.prevY = P.y;
    this.draw();
    this.updateCamera(dt);
    this.last.copy(P);
    if ((this.hudT = (this.hudT || 0) + dt) > 0.25) { this.hudT = 0; this.hudTick(); }
    const ground = this.heights.atXZ(P.x, P.z);
    const speed = this.mode === 'fly' ? this.v : this.mode === 'path' ? this.path.speed : this.mode === 'cling' && this.hitch ? HITCH / (HITCH_T + HITCH_GAP) : 0;
    f.speed = speed;
    const yaw = this.mode === 'cling' || this.work?.back === 'cling' ? this.face + Math.PI : f.yaw;
    const heading = (yaw * -180 / Math.PI % 360 + 360) % 360;
    return { hover: false, agl: P.y - ground, elev: P.y, speed, heading };
  }

  // On the bark: hitching in short hops, round the trunk, launching off it.
  cling(dt, k, jump, act) {
    const tr = this.tree, ps = this.pose, f = this.flight, P = f.pos;
    if (jump) { this.launch(this.face + Math.PI, 5, 0.12, 0.2); return; }
    if (act && this.clingAction()) return;
    const top = this.top(tr);
    // one hitch at a time: the feet let go, the body springs up (or down, or round) about 13 cm, and grips again
    this.hitchGap -= dt;
    if (!this.hitch && this.hitchGap <= 0 && (k.fwd || k.turn)) {
      const t = trunkAt(tr, this.h, this._t), rr = t.r + BARK;
      let dh = k.fwd * HITCH;
      if (this.h + dh > top) { dh = Math.max(0, top - this.h); if (!this.toldTop) { this.toldTop = true; this.say('as high as the trunk goes: above is the crown'); } }
      if (this.h <= 0.3 && k.fwd < 0 && !k.turn) { this.toGround(); return; }
      dh = Math.max(dh, 0.25 - this.h);
      const df = -k.turn * Math.min(0.3, ROUND_STEP / Math.max(rr, 0.12));   // at most 0.3 rad a hitch round a thin bole
      if (Math.abs(dh) > 1e-3 || df) this.hitch = { u: 0, h0: this.h, f0: this.face, dh, df };
    }
    if (this.h < top - 0.4) this.toldTop = false;
    let bump = 0;
    if (this.hitch) {
      const H = this.hitch; H.u = Math.min(1, H.u + dt / HITCH_T);
      const s = smooth(H.u); this.h = H.h0 + H.dh * s; this.face = wrap(H.f0 + H.df * s); bump = Math.sin(Math.PI * H.u);
      if (H.u >= 1) { this.hitch = null; this.hitchGap = HITCH_GAP; }
    }
    this.place();
    // the body springs off the bark a little in each hitch; the tail stays braced
    const ox = Math.sin(this.face), oz = Math.cos(this.face);
    P.x += ox * 0.025 * bump; P.z += oz * 0.025 * bump;
    ps.amp = damp(ps.amp, 0, 10, dt); ps.fold = damp(ps.fold, 1, 10, dt);
    ps.pitch = damp(ps.pitch, CLING_PITCH + 0.18 * bump, 14, dt); ps.yaw = this.face + Math.PI; ps.roll = 0;
    // now and then a probe of the bark (the AI's pecking), never while moving
    if (!this.hitch && Math.random() < dt * 0.35) this.peckV = 0.8;
    ps.flick = this.peckV > 0 ? Math.max(0, Math.sin(this.time * 38)) * Math.min(1, this.peckV) : damp(ps.flick, 0, 10, dt);
    this.peckV = (this.peckV || 0) - dt;
  }
  toGround() {
    const tr = this.tree, f = this.flight, P = f.pos, out = trunkAt(tr, 0, this._t).r + 0.35;
    f.yaw = this.face + Math.PI; this.lastYaw = f.yaw;
    const x = tr.x + Math.sin(this.face) * out, z = tr.z + Math.cos(this.face) * out;
    this.go(new THREE.Vector3(x, this.heights.atXZ(x, z), z), { dur: 0.35, arc: 0.1, then: () => this.land('ground') });
  }

  // Off the bark or the ground into flight: heading `yaw` (flight frame), speed v, climbing at pitch.
  launch(yaw, v, pitch, out = 0) {
    const f = this.flight, P = f.pos;
    f.yaw = yaw; this.lastYaw = yaw; f.pitch = pitch;
    P.x += -Math.sin(yaw) * out; P.z += -Math.cos(yaw) * out;
    this.mode = 'fly'; this.v = v; this.baseY = P.y; this.undA = 0; this.burst = true; this.uc = 0; this.boost = 0.25;
    this.tree = null; this.hitch = null; this.toldTop = false;
  }

  fly(dt, k, jump, act) {
    const f = this.flight, P = f.pos, ps = this.pose;
    if (k.fwd > 0) this.v = Math.min(V_MAX, this.v + ACCEL * dt);
    else if (k.fwd < 0) this.v = Math.max(V_MIN, this.v - DECEL * dt);
    else this.v = damp(this.v, V_CRUISE, 0.25, dt);   // left alone, back to an easy cruise
    f.yaw += k.turn * TURN * dt;
    f.pitch = clamp(f.pitch + k.pitch * PITCH_RATE * dt, -PITCH_MAX, PITCH_MAX);
    if (!k.pitch && !f.drag) f.pitch = damp(f.pitch, 0, 0.5, dt);   // settles to level flight
    if (jump) this.boost = 0.5;
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), ch = Math.cos(f.pitch), sh = Math.sin(f.pitch);
    // the undulation: bursts of beats rising, a closed-wing dip falling; slow, braking or climbing hard it beats on
    const steady = this.v < 4.5 || k.fwd < 0 || f.pitch > 0.3 || this.boost > 0;
    this.uc += dt;
    if (this.burst) { if (this.uc >= BURST && !steady) { this.burst = false; this.uc = 0; } }
    else if (this.uc >= DIP || steady) { this.burst = true; this.uc = 0; }
    this.undA = damp(this.undA, steady ? 0 : UND_A * clamp((this.v - 3) / 5, 0, 1), 4, dt);
    const s = Math.min(1, this.uc / (this.burst ? BURST : DIP));
    const o = this.burst ? -1 + 2 * smooth(s) : 1 - 2 * s * s;
    this.baseY += (this.v * sh + (this.boost > 0 ? 2.4 : 0)) * dt; this.boost -= dt;
    const nx = P.x + fx * this.v * ch * dt, nz = P.z + fz * this.v * ch * dt;
    P.x = clamp(nx, 5, this.tile.size - 5); P.z = clamp(nz, -this.tile.size + 5, -5);
    const g = this.heights.atXZ(P.x, P.z);
    if (this.baseY < g + 0.35) { this.baseY = g + 0.35; if (f.pitch < 0) f.pitch = damp(f.pitch, 0.05, 6, dt); }
    if (this.baseY > g + CEIL) this.baseY = damp(this.baseY, g + CEIL, 2, dt);
    P.y = Math.max(g + 0.2, this.baseY + this.undA * o);
    // pose: wings beating in the burst, shut in the dip; the body follows the climb and the dip
    const beating = this.burst || this.undA < 0.03;
    ps.amp = damp(ps.amp, beating ? 1 : 0, 20, dt); ps.fold = damp(ps.fold, beating ? 0 : 0.8, 20, dt);
    if (beating) ps.phase += dt * TAU * BEAT * (this.v < 4.5 ? 1.15 : 1);
    ps.flick = damp(ps.flick, 0, 10, dt);
    ps.pitch = damp(ps.pitch, -Math.atan2(this.vy, Math.max(1, this.v)) * 0.7 + (beating ? -0.06 : 0.12), 10, dt);
    ps.yaw = f.yaw + Math.PI; ps.roll = damp(ps.roll, -k.turn * 0.45, 6, dt);
    // E: to the nearest acorn within reach
    if (act) { this.flyAction(); if (this.mode !== 'fly') return; }
    // into a trunk: grip it
    const hit = this.trunkAhead(P, fx, fz);
    if (hit) {
      const t = trunkAt(hit.tree, hit.h, this._t), face = Math.atan2(P.x - t.x, P.z - t.z), h = hit.h;
      const to = this.barkPoint(hit.tree, face, h, new THREE.Vector3());
      this.go(to, { dur: GRIP_T, arc: 0, grip: true, yawEnd: face + Math.PI, then: () => { this.attach(hit.tree, face, h); this.place(); this.gripped(); } });
      return;
    }
    // S inside a crown: onto a branch there; S low elsewhere: down onto the ground
    if (k.fwd < 0) {
      const agl = P.y - g, tr = agl > 1.5 ? this.crownAt(P) : null;
      if (tr) this.go(new THREE.Vector3(P.x + fx * 0.3, P.y - 0.1, P.z + fz * 0.3), { dur: 0.3, arc: 0.05, then: () => this.land('branch') });
      else if (agl < 4) {
        const x = P.x + fx * Math.min(2, this.v * 0.25), z = P.z + fz * Math.min(2, this.v * 0.25);
        this.go(new THREE.Vector3(x, this.heights.atXZ(x, z), z), { dur: clamp(agl * 0.15, 0.3, 0.7), arc: 0.05, then: () => this.land('ground') });
      }
    }
  }
  gripped() {
    const n = this.atGranary() ? this.acorns?.world?.granaries?.[this.granary.id] || 0 : null;
    if (n !== null) this.say(`on your family's granary (${n} acorn${n === 1 ? '' : 's'})${this.acorns?.running && this.acorns.player.carrying ? ': E to hammer yours in' : ''}`);
  }
  land(where) {
    this.mode = 'perch'; this.perch = where; this.v = 0; this.path = null; this.hopCD = 0;
    if (where === 'ground') { const P = this.flight.pos; P.y = this.heights.atXZ(P.x, P.z); }
  }

  // Perched on the ground (or a branch): a short hop with W, turn with A / D, Space launches.
  perched(dt, k, jump, act) {
    const f = this.flight, P = f.pos, ps = this.pose;
    f.yaw += k.turn * 2.2 * dt;
    if (jump) { this.launch(f.yaw, 4.5, 0.35); return; }
    if (act && this.perchAction()) return;
    this.hopCD -= dt;
    if (k.fwd > 0 && this.hopCD <= 0) {
      const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), x = P.x + fx * HOP_D, z = P.z + fz * HOP_D;
      const y = this.perch === 'ground' ? this.heights.atXZ(x, z) : P.y;
      this.go(new THREE.Vector3(x, y, z), { dur: HOP_T, arc: HOP_UP, hop: true, then: () => this.land(this.perch) });
      this.hopCD = 0.15; return;
    }
    if (this.perch === 'ground') P.y = this.heights.atXZ(P.x, P.z);
    ps.amp = damp(ps.amp, 0, 12, dt); ps.fold = damp(ps.fold, 1, 10, dt);
    ps.pitch = damp(ps.pitch, -0.35, 8, dt); ps.yaw = f.yaw + Math.PI; ps.roll = damp(ps.roll, 0, 8, dt);
    ps.flick = damp(ps.flick, 0, 8, dt);
  }

  // A scripted short flight or hop from here to `to` (an acorn, the bark, the ground), then `then()`.
  go(to, { dur, arc = 0, then, hop = false, grip = false, yawEnd = null }) {
    const from = this.flight.pos.clone(), d = from.distanceTo(to);
    this.path = { from, to, u: 0, dur: Math.max(0.12, dur), arc, then, hop, grip, yawEnd, speed: d / Math.max(0.12, dur) };
    this.mode = 'path';
  }
  onPath(dt) {
    const L = this.path, P = this.flight.pos, ps = this.pose, f = this.flight;
    L.u = Math.min(1, L.u + dt / L.dur);
    const u = smooth(L.u), a = L.from, b = L.to;
    P.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + L.arc * Math.sin(Math.PI * L.u), a.z + (b.z - a.z) * u);
    const dx = b.x - a.x, dz = b.z - a.z;
    if (Math.hypot(dx, dz) > 0.05 && !L.grip) { ps.yaw = Math.atan2(dx, dz); f.yaw = ps.yaw + Math.PI; this.lastYaw = f.yaw; }
    // wings: a few beats (a hop: a flick of them); onto the bark: the tail swings in to brace
    ps.amp = damp(ps.amp, L.hop ? 0.5 : 1, 20, dt); ps.fold = damp(ps.fold, L.hop ? 0.5 : 0, 20, dt);
    ps.phase += dt * TAU * BEAT;
    if (L.grip) { ps.pitch = damp(ps.pitch, CLING_PITCH, 14, dt); if (L.yawEnd !== null) ps.yaw += wrap(L.yawEnd - ps.yaw) * (1 - Math.exp(-dt * 16)); }
    else ps.pitch = damp(ps.pitch, L.hop ? -0.25 : -Math.atan2(b.y - a.y, Math.hypot(dx, dz) + 0.3) * 0.6, 10, dt);
    ps.roll = damp(ps.roll, 0, 8, dt); ps.flick = damp(ps.flick, 0, 10, dt);
    if (L.u >= 1) { this.path = null; ps.amp = L.hop ? 0 : ps.amp; L.then?.(); }
  }

  // Pecking an acorn loose, or hammering one into the granary; then back to `back`.
  working(dt) {
    const W = this.work, ps = this.pose, G = this.acorns;
    W.t -= dt;
    ps.amp = damp(ps.amp, 0, 12, dt); ps.fold = damp(ps.fold, 1, 10, dt);
    if (W.kind === 'hammer') {   // the AI's beat: strikes at ~6 Hz, the body rocking with them
      ps.flick = Math.max(0, Math.sin(this.time * 38));
      ps.pitch = damp(ps.pitch, CLING_PITCH + 0.06 * ps.flick, 30, dt);
      this.place();
    } else {                     // bent to the acorn, a few pecks
      ps.flick = Math.max(0, Math.sin(this.time * 20)) * 0.9;
      if (W.back === 'cling') { ps.pitch = damp(ps.pitch, CLING_PITCH + 0.5, 10, dt); this.place(); }
      else ps.pitch = damp(ps.pitch, 0.45, 8, dt);
    }
    if (W.t > 0) return;
    this.work = null;
    if (W.kind === 'hammer') {
      this.mode = 'cling'; ps.flick = 0;
      const t = trunkAt(this.tree, this.h, this._t), P = this.flight.pos;
      const ok = G.playerGranary(this.granary.id, P.x + (P.x - t.x) * 0.5, P.y, P.z + (P.z - t.z) * 0.5);
      const n = G.world.granaries[this.granary.id] || 0;
      this.say(ok ? `hammered it into your family's granary: ${n} acorn${n === 1 ? '' : 's'} in it now` : 'it would not go in');
      return;
    }
    const ok = G.isFree(W.acorn.key) && G.playerPick(W.acorn);
    this.say(ok ? `took an acorn ${W.acorn.branch ? 'from the crown' : 'from the ground'}${nameOf(W.acorn)}: back to your granary` : 'someone took it first');
    if (W.back === 'cling') {
      if (W.from) this.go(W.from, { dur: W.dur, arc: 0.3, grip: true, yawEnd: this.face + Math.PI, then: () => { this.mode = 'cling'; this.place(); } });
      else this.mode = 'cling';
    } else this.land(W.back);
  }

  // ---- acorns: E -----------------------------------------------------------------------------------
  ready() {
    const G = this.acorns;
    if (!G || !G.running) { this.say('start a game (panel: Start game) to gather acorns'); return false; }
    return true;
  }
  // Clinging: hammer the one in the bill into the granary, or take one from the crown (in reach, or a short flight).
  clingAction() {
    if (!this.ready()) return true;
    const G = this.acorns, P = this.flight.pos;
    if (G.player.carrying > 0) {
      if (this.atGranary()) {
        this.work = { kind: 'hammer', t: HAMMER[0] + Math.random() * (HAMMER[1] - HAMMER[0]), back: 'cling' }; this.mode = 'work'; this.hitch = null;
        return true;
      }
      const g = this.granary;
      this.say(g ? `not your granary: yours is ${Math.round(Math.hypot(g.x - P.x, g.z - P.z))} m ${compass(Math.atan2(g.x - P.x, -(g.z - P.z)))}` : 'no granary near: an acorn woodpecker family keeps one');
      return true;
    }
    const near = G.acornNear(P.x, P.y + 0.08, P.z, CROWN_R, true);
    if (near) { this.work = { kind: 'pick', t: PICK_T, acorn: near, back: 'cling' }; this.mode = 'work'; this.hitch = null; return true; }
    // out to one in this tree's crown, and back to this spot on the bark
    const tr = this.tree; let best = null, bd = REACH_R;
    for (const a of G.liveAcorns) {
      if (!a.branch) continue;
      const d = Math.hypot(a.x - P.x, a.y - P.y, a.z - P.z); if (d >= bd) continue;
      if (Math.hypot(a.x - tr.x, a.z - tr.z) > Math.max(3, 4 * tr.scale)) continue;   // this tree's crown
      bd = d; best = a;
    }
    if (!best) {
      const any = G.acornNear(P.x, P.y, P.z, 30, null);
      this.say(any ? `nearest acorn ${Math.round(Math.hypot(any.x - P.x, any.z - P.z))} m off: fly to it (E when close)` : 'no acorns in this tree: try another oak');
      return true;
    }
    this.flyToAcorn(best, 'cling');
    return true;
  }
  flyAction() {
    if (!this.ready()) return;
    const G = this.acorns, P = this.flight.pos;
    if (G.player.carrying > 0) { this.say('your bill is full: take it to your family\'s granary and cling there'); return; }
    const a = G.acornNear(P.x, P.y, P.z, FLY_PICK_R, null);
    if (!a) { this.say('no acorn within reach: fly close to one (they glow)'); return; }
    this.flyToAcorn(a, a.branch ? 'branch' : 'ground');
  }
  perchAction() {
    if (!this.ready()) return true;
    const G = this.acorns, P = this.flight.pos, f = this.flight;
    if (G.player.carrying > 0) { this.say('your bill is full: take it to your family\'s granary'); return true; }
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    const a = this.perch === 'ground' ? G.acornNear(P.x + fx * 0.15, P.y + 0.1, P.z + fz * 0.15, GROUND_R, false)
      : G.acornNear(P.x, P.y, P.z, CROWN_R, true);
    if (a) { f.yaw = Math.atan2(-(a.x - P.x), -(a.z - P.z)); this.work = { kind: 'pick', t: PICK_T, acorn: a, back: this.perch }; this.mode = 'work'; return true; }
    const far = G.acornNear(P.x, P.y, P.z, FLY_PICK_R, null);
    if (far) { this.flyToAcorn(far, far.branch ? 'branch' : 'ground'); return true; }
    this.say(this.perch === 'ground' ? 'nothing at your bill: acorns lie under the oaks' : 'no acorn within reach on this branch');
    return true;
  }
  // A short flight to an acorn, a few pecks, and (from the bark) back to the same spot on it.
  flyToAcorn(a, back) {
    const P = this.flight.pos, from = P.clone();
    const dx = P.x - a.x, dz = P.z - a.z, e = Math.hypot(dx, dz) || 1;
    const x = a.x + dx / e * 0.12, z = a.z + dz / e * 0.12;
    const to = new THREE.Vector3(x, a.branch ? a.y - 0.05 : this.heights.atXZ(x, z), z);
    const d = from.distanceTo(to), dur = clamp(d / 6, 0.3, 1.2);
    this.hitch = null;
    this.go(to, { dur, arc: Math.min(0.8, d * 0.12), then: () => {
      this.flight.yaw = Math.atan2(-(a.x - to.x), -(a.z - to.z)); this.lastYaw = this.flight.yaw;
      this.work = { kind: 'pick', t: PICK_T, acorn: a, back, from: back === 'cling' ? from : null, dur };
      if (back !== 'cling') this.perch = back;
      this.mode = 'work';
    } });
  }

  // ---- drawing -------------------------------------------------------------------------------------
  draw() {
    const m = this.mesh, ps = this.pose, P = this.flight.pos;
    m.visible = true;
    this._e.set(ps.pitch, ps.yaw, ps.roll, 'YXZ'); this._q.setFromEuler(this._e);
    this._m.compose(P, this._q, this._s);
    this._m.toArray(m.instanceMatrix.array, 0); m.instanceMatrix.needsUpdate = true;
    const an = m.geometry.attributes.aAnim; an.array[0] = ps.phase % TAU; an.array[1] = ps.amp; an.array[2] = ps.fold; an.array[3] = ps.flick; an.needsUpdate = true;
    // the acorn in its bill: the AI's CARRY point turned with the head strike, through the instance matrix
    const carrying = this.acorns?.running && this.acorns.player.carrying > 0;
    this.nut.visible = !!carrying;
    if (carrying) {
      const y = CARRY.ty - CARRY.py, z = CARRY.tz - CARRY.pz, g = ps.flick * CARRY.flick, c = Math.cos(g), s = Math.sin(g);
      this.nut.position.set(0, c * y - s * z + CARRY.py, s * y + c * z + CARRY.pz).applyMatrix4(this._m);
      this.nut.rotation.set(Math.PI / 2 + ps.pitch, ps.yaw, 0, 'YXZ');
    }
  }

  // Camera: on the bark over the bird's shoulder, standing off the trunk and orbiting with it (a drag orbits it
  // further) and kept out of the crowns (crownClear); in flight a chase CAM_UP over and CAM_BACK behind, following the
  // climb partly, through a longer lens (FLY_FOV); perched, low behind.
  updateCamera(dt) {
    const f = this.flight, P = f.pos, cam = this.camera, off = this._v, aim = this._w;
    let k = 6, fov = this.fovWas || 70;
    const onBark = (this.mode === 'cling' || this.work?.back === 'cling') && this.tree;
    if (onBark) {
      const tr = this.tree, ang = this.face + this.camOrbit, t = trunkAt(tr, Math.max(0, this.h), this._t);
      const A = this.auto ? 1 - smooth(Math.min(1, this.auto.t / 3.5)) : 0;   // the arrival: from wider, drifting in
      // close (inside the leaves of a low crown), a little to the side and below, looking up the bark past the bird
      const out = t.r + CLING_OUT + 4 * A, side = 0.3 + 1.5 * A, ox = Math.sin(ang), oz = Math.cos(ang);
      off.set(t.x + ox * out + oz * side - P.x, t.y + 0.12 + 1.2 * A - P.y, t.z + oz * out - ox * side - P.z);
      aim.set(0, 0.22, 0);
      if (!this.auto) this.crownClear(P, off);   // the arrival keeps its wide drift in; the camera settles out of the leaves after
      k = 5;
    } else if (this.mode === 'perch' || (this.mode === 'work' && this.work.back !== 'cling') || (this.mode === 'path' && this.path.hop)) {
      const back = 1.6, up = 0.6;
      off.set(Math.sin(f.yaw) * back, up, Math.cos(f.yaw) * back);
      aim.set(-Math.sin(f.yaw) * 1.5, 0.1, -Math.cos(f.yaw) * 1.5);
    } else {
      const cp = Math.cos(f.pitch * 0.5), sp = Math.sin(f.pitch * 0.5);
      off.set(Math.sin(f.yaw) * cp * CAM_BACK, CAM_UP - sp * CAM_BACK, Math.cos(f.yaw) * cp * CAM_BACK);
      const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), look = 4;
      aim.set(fx * look, 0.2 + Math.sin(f.pitch) * look, fz * look);
      k = 5; fov = Math.min(fov, FLY_FOV);   // longer than the raven's lens, never wider than it (?fov= may already be narrow)
    }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = this.camSettled ? damp(cam.fov, fov, 3, dt) : fov; cam.updateProjectionMatrix(); }
    if (!this.camSettled) { this.camOff.copy(off); this.aimOff.copy(aim); this.camSettled = true; }
    else { this.camOff.lerp(off, 1 - Math.exp(-dt * k)); this.aimOff.lerp(aim, 1 - Math.exp(-dt * k)); }
    cam.position.copy(P).add(this.camOff);
    const g = this.heights.atXZ(cam.position.x, cam.position.z) + 0.25;
    if (cam.position.y < g) cam.position.y = g;
    cam.up.set(0, 1, 0);
    cam.lookAt(this._c.copy(P).add(this.aimOff));
  }
  // Keep the bark camera's line to the bird out of the leaves: each tree's crown within 12 m is a sphere above its
  // fork (from the fork, or the species' crown base when higher, to the top; as wide as that, at most the species'
  // crown width). A crown the bird itself is in is skipped. The camera must be outside the sphere grown by CROWN_PAD
  // (the leaves that droop below it, and the cards' size), and the line from it to 0.4 of the way in (the last of it,
  // by the bird, is the bird's own business) outside the sphere itself. If not, the camera drops (up to CROWN_LOWER,
  // looking up the bark past the bird, under the leaves) until it clears, else it comes in along the line to the first
  // clear point (no closer than CROWN_MIN). off: camera - P, changed in place.
  crownClear(P, off) {
    this.indexTrees();
    const S = this._crowns || (this._crowns = []); S.length = 0;
    const ci = Math.floor(P.x / 10), cj = Math.floor(P.z / 10), t = this._t;
    for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
      for (const tr of this.trees.get(`${i},${j}`) || []) {
        if (tr.snag || Math.hypot(tr.x - P.x, tr.z - P.z) > 12) continue;
        const sp = PLANTS[tr.species]?.targets || {}, H = tr.H, fork = this.top(tr) / 0.95;
        const base = Math.max(fork, (sp.crown_base_ratio ?? 0.15) * H);
        const R = Math.min((H - base) / 2, (sp.crown_width_ratio ?? 1) * H / 2); if (R < 0.5) continue;
        trunkAt(tr, Math.min(base, this.top(tr)), t);
        const cx = t.x, cy = tr.y + base + R, cz = t.z;
        if ((P.x - cx) ** 2 + (P.y - cy) ** 2 + (P.z - cz) ** 2 < R * R) continue;   // the bird is in it: no line clears it
        S.push(cx, cy, cz, R * R, (R + Math.min(CROWN_PAD[2], CROWN_PAD[0] + CROWN_PAD[1] * R)) ** 2);
      }
    }
    if (!S.length) return;
    const inside = (x, y, z, k) => {   // k 3: the sphere, 4: grown
      for (let n = 0; n < S.length; n += 5) if ((x - S[n]) ** 2 + (y - S[n + 1]) ** 2 + (z - S[n + 2]) ** 2 < S[n + k]) return true;
      return false;
    };
    const blocked = (ox, oy, oz) => {
      if (inside(P.x + ox, P.y + oy, P.z + oz, 4)) return true;
      for (const f of [0.85, 0.7, 0.55, 0.4]) if (inside(P.x + ox * f, P.y + oy * f, P.z + oz * f, 3)) return true;
      return false;
    };
    if (!blocked(off.x, off.y, off.z)) return;
    const g = this.heights.atXZ(P.x + off.x, P.z + off.z) + 0.25 - P.y;   // no lower than the ground clamp
    for (let d = 0.15; d <= CROWN_LOWER + 1e-6 && off.y - d >= g; d += 0.15) {
      if (!blocked(off.x, off.y - d, off.z)) { off.y -= d; return; }
    }
    const L = Math.hypot(off.x, off.y, off.z), lo = Math.min(1, CROWN_MIN / L);
    let f = 1;
    while (f > lo && inside(P.x + off.x * f, P.y + off.y * f, P.z + off.z * f, 4)) f -= 0.05;
    off.multiplyScalar(Math.max(lo, f));
  }
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
function compass(a) { return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]; }   // a: atan2(east, north)
function nameOf(a) { const s = { blue_oak: 'blue oak', live_oak: 'interior live oak' }[a.species]; return s ? ` (${s})` : ''; }
