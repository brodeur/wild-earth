import * as THREE from 'three';
import { SPECIES as PLANTS } from './trees.js';
import { animalMaterial, animalDepthMaterial, hasAnim2 } from './animalModels.js';
import { addCaster } from './shadows.js';
import { trunkAt } from './animals.js';
import { acornGeometry } from './acorns.js';
import { chainShader } from './treegen.js';

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
// The whole tree (perch.js, the drawn wood of the near set: treegen.treeWood per instance): once on the bark the
// squirrel is on a stem of the tree at an arc length, on the side of it its `n` (out of the bark) points to, facing
// toward the stem's tip or its base. W climbs (head first up a steep stem; along a level limb it runs the way it
// faces), S comes down head first (a steep stem) or goes in toward the base (a limb: backing, unless it faces in).
// Past the fork it climbs on up the main stem (at a stem's end W carries on onto its leader, perch.js leader) to the
// top wood that holds a squirrel (HOLD_R);
// out a limb it stops at the thin end (END_R). Junctions: a child stem leaving within REACH of the feet on this side
// of the stem (perch.js kidsNear), or near a limb's base its parent up or down: A takes the one leaving most to the
// left, D the one most to the right (one nearly straight out is taken by either), shown by a ring round it and a
// line at the foot of the screen. With no junction on that side, A / D go round a steep stem (to underneath, too);
// a tap on a level limb turns round. Space: a leap to wood within LEAP_R in the facing direction (out from the bark
// on a steep stem), or a drop, legs spread, that catches a limb it crosses or lands on the ground (over STUN_H m:
// stunned for STUN_T s). E takes a crown acorn within CROWN_R of the squirrel.
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
// The wood (perch.js): thinnest wood climbed up a stem and run out along a limb (m radius); limb speeds (m/s); how far
// along the stem a junction is in reach (m, plus the stem's radius); a stem steeper than STEEP (sine) can be gone round,
// a shallower one is run along on top; leap reach (m); a fall that stuns (m) and for how long (s).
const HOLD_R = 0.02, END_R = 0.015, LIMB_RUN = 3.0, LIMB_BACK = 1.4, REACH = 0.4, STEEP = 0.45, LEAP_R = 2.5, STUN_H = 6, STUN_T = 1.0;
const PICK_R = 0.9, CROWN_R = 1.2, LIMB_R = 3.2, DIG_R = 1.0, LIMB_V = 2.2;
const WORK = { pick: 0.5, bury: 2.4, dig: 1.8 };             // s
const CAM_BACK = 2.5, CAM_UP = 0.6, NEAR = 0.3;
const CAM_SIDE = 0.4, CAM_SWING = 1.6;                       // rad (~23 deg) off the heading: a three-quarter view; 1/s
const CROWN_PAD = [0.4, 0.12, 1.0], CROWN_LOWER = 1.1, CROWN_MIN = 0.6, CROWN_BOOM = 0.55;   // woodpeckerControl.js crownClear: the leaves under the sphere; lowest drop; shortest boom
const CAM_CLEAR = 0.3, CAM_SIGHT = 0.15, CAM_WATER = 0.45;   // m over the terrain round the lens, along the sight line, over a pond
// The leaf cut (leafCut below): leaf and twig cards nearer the lens than the squirrel are dissolved within CUT_LENS of
// the squirrel's distance round the lens, and in a screen-space capsule (CUT_R at the squirrel, CUT_R2 at the limb ahead,
// in tan-of-angle units, eased out over CUT_EDGE) from the squirrel to CUT_AHEAD m along the way it faces; in the wood
// (and leaping, and dropping from it), eased in and out at CUT_K 1/s.
const CUT_LENS = 0.85, CUT_R = 0.2, CUT_R2 = 0.11, CUT_EDGE = 0.08, CUT_AHEAD = 1.4, CUT_K = 4;
// The leap camera: behind the leap and above it, looking a little ahead along it (m); a drop from the wood keeps a
// tree camera (back, up) over the fall and eases to the ground chase camera over its last DROP_EASE m.
// Round the stem to a clear line (sightRound): the swings tried (rad, nearest first), how often (s), and how near the
// squirrel wood is not counted (m: the stems it stands at a junction of).
const SIGHT_ROT = [0.45, -0.45, 0.9, -0.9, 1.35, -1.35], SIGHT_DT = 0.1, SIGHT_SKIP = 0.25;
const LEAP_BACK = 1.5, LEAP_UP = 0.7, LEAP_LOOK = 0.6, DROP_BACK = 1.7, DROP_UP = 1.1, DROP_EASE = 2.5;
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
    // on the wood (perch.js): the plant, stem, arc length, facing toward the tip (+1) or base (-1), and the frame
    this.w = { rec: null, st: null, s: 0, sign: 1, n: new THREE.Vector3(1, 0, 0), f: new THREE.Vector3(0, 1, 0), l: new THREE.Vector3(), a: {} };
    this._d = new THREE.Vector3(); this._x = new THREE.Vector3(); this._mb = new THREE.Matrix4(); this._qt = new THREE.Quaternion(); this._j = new THREE.Vector3();
    this.pOff = new THREE.Vector3(); this.cands = []; this.candA = null; this.candD = null; this.turnWas = 0; this.turnLock = false;
    this.leap = null; this.spread = false; this.fallTop = null; this.leftSt = null; this.leftT = 0; this.stunT = 0;
    this._kids = []; this._ta = {}; this._tb = {}; this._nutQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    // the rings that show the junctions A and D would take: a thin band round the wood with a chevron pointing the way
    // it leaves, breathing a little (showJunctions)
    const ringGeo = new THREE.TorusGeometry(1, 0.07, 6, 32), arrowGeo = new THREE.ConeGeometry(0.7, 1.4, 4).rotateX(Math.PI / 2).translate(0, 0, 2.2);
    this.rings = [0xffd27a, 0x8fd3ff].map(c => {
      const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false });
      const m = new THREE.Mesh(ringGeo, mat); m.add(new THREE.Mesh(arrowGeo, mat));
      m.visible = false; m.renderOrder = 6; m.frustumCulled = false; m.children[0].renderOrder = 6; m.children[0].frustumCulled = false; m.name = 'squirrel junction'; scene.add(m); return m;
    });
    leafCut(veg); this.cutS = 0; this._c = new THREE.Vector3();
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
    // which junction A and D take (on the wood)
    this.hint = document.createElement('div'); this.hint.id = 'sqHint';
    this.hint.style.cssText = 'position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:6;padding:4px 10px;border-radius:7px;'
      + 'background:#0f1512b0;color:#e6ede7;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;pointer-events:none;display:none;white-space:nowrap';
    document.body.appendChild(this.hint);
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
    const mesh = new THREE.InstancedMesh(geo, animalMaterial(this.atmosphere, model, { head: this.flight.headYaw }), 1);   // head: the look (flight.js)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'player squirrel';
    mesh.customDepthMaterial = animalDepthMaterial(model);
    mesh.visible = this.on; this.scene.add(mesh);
    addCaster(mesh, { cascades: [0], simple: false });   // follows the mesh's visibility
    this.mesh = mesh; this.model = model; this.sp = sp; this.rig = hasAnim2(model);
  }

  // ---- on and off ---------------------------------------------------------------------------------
  setOn(on) {
    this.flight.look = 0; this.flight.headYaw.value = 0; this.flight.lookMax = on ? 1.2 : 0;   // the look's head limit (flight.js)
    on = !!on;
    this.acorns?.setPlayerSpecies(on ? CODE : 'corvus_corax');
    if (on === this.on) return;
    this.on = on;
    if (!on && this.auto) this.finishArrival(true);   // left mid-arrival (spirit.js): its onDone still runs
    const f = this.flight;
    f.body.visible = !on && f.view === 'chase';
    if (this.mesh) this.mesh.visible = on;
    this.nut.visible = false;
    for (const r of this.ripples) r.m.visible = false;
    for (const m of this.rings) m.visible = false;
    this.hint.style.display = 'none'; if (this.hudRow) this.hudRow.style.display = 'none';
    if (on) { f.pitch = 0; f.roll = 0; f.hover = false; this.camSettled = false; this.lastYaw = f.yaw; this.place(f.pos.x, f.pos.z); }
    else {   // back to the raven (or the spirit, which places itself): aloft over the same spot; every state let go
      this.camera.up.set(0, 1, 0); f.reset(f.pos.x, f.pos.z, 30); this.cutS = 0; LEAF_CUT.a.value.w = 0;
      this.mode = 'ground'; this.work = null; this.limb = null; this.leap = null; this.spread = false; this.fallTop = null; this.stunT = 0;
      this.w.rec = null; this.tree = null; this.cands.length = 0; this.candA = this.candD = null; this.jumpQ = this.actQ = false;
    }
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
      + '<kbd>E</kbd> pick up, bury, dig · run into a trunk to climb (<kbd>W</kbd><kbd>S</kbd> up, down, out and in a limb; <kbd>A</kbd><kbd>D</kbd> onto the ringed limb, or round; <kbd>space</kbd> leap or drop) · '
      + '<kbd>M</kbd> map · <kbd>G</kbd> roads · <kbd>P</kbd> present day · <kbd>T</kbd> tags · <kbd>N</kbd> mute · <kbd>B</kbd> back to spirit form · click a tree to identify · drag mouse to turn and look' : W.help;
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
    this.w.rec = null; this.leap = null; this.spread = false; this.fallTop = null;
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
    const face = wrap(this.flight.yaw - Math.PI), Q = this.Q, rec = Q?.recAt(best.x, best.z), h = Math.min(1.4, this.topOf(tree));
    const hit = rec && Q.nearOn(rec, best.x + Math.sin(face) * 2, best.y + h, best.z + Math.cos(face) * 2, 3, HOLD_R);
    if (hit && hit.stem.level === 0) this.attachWood(rec, hit.stem, hit.s, hit.nx, 0, hit.nz, -1);   // head down on the bole
    else this.attach(tree, face, h);   // below the fork, so the camera is under the crown
    this.headUp = false; this.camSettled = false;
    this.auto = { t: 0, out: 0 };
    if (caption && this.captionEl) {
      const c = this.captionEl; c.querySelector('.cap-text').textContent = caption;
      c.hidden = false; c.getAnimations().forEach(a => a.cancel());
      const a = this.capAnim = c.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 6000, fill: 'forwards' });
      a.onfinish = () => { c.hidden = true; a.cancel(); };   // released: a filling animation would hold this control after a tile switch
    }
  }
  // The spirit (spirit.js) comes into an AI squirrel: the player carries on where it was (animals.js info: on the
  // ground, on the bole, or out on the wood, onto the drawn limb under it when perch.js finds one), facing its way.
  enterAt(o) {
    const f = this.flight, P = f.pos;
    this.auto = null; this.onArrived = null;
    f.yaw = this.lastYaw = o.yaw; f.pitch = 0; f.roll = 0;
    this.place(o.x, o.z);
    if (o.where === 'trunk' && o.tree) {
      const tr = this.record(o.tree);
      this.attach(tr, o.face, Math.max(0.15, Math.min(o.h, this.topOf(tr))));
    } else if (o.where === 'tree') {
      const Q = this.Q, h = Q && Q.near(o.x, o.y + 0.05, o.z, 0.8, END_R);
      if (h && h.rec) {
        const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw), steep = Math.abs(h.dy) > STEEP;
        this.attachWood(h.rec, h.stem, h.s, h.nx, h.ny, h.nz, steep ? (h.dy >= 0 ? 1 : -1) : (Math.sign(fx * h.dx + fz * h.dz) || 1));
      } else if (o.tree) {   // no wood known there: on the bole under it
        const tr = this.record(o.tree);
        this.attach(tr, Math.atan2(o.x - tr.x, o.z - tr.z), Math.min(Math.max(0.15, o.y - tr.y), this.topOf(tr)));
      }
    }
    this.headUp = true; this.camSettled = false; this.qFresh = false; this.last.copy(P);
  }
  // Where the player leaves this squirrel (spirit.js), for the AI to carry on from (animals.js release): as info.
  leaveInfo() {
    const P = this.flight.pos, m = this.mode, back = this.work?.back, f = this.flight;
    const o = { x: P.x, y: P.y, z: P.z, yaw: f.yaw, where: 'ground', tree: null, face: 0, h: 0, speed: 0 };
    if ((m === 'trunk' || (m === 'work' && back === 'trunk')) && this.tree) Object.assign(o, { where: 'trunk', tree: this.tree, face: this.face, h: this.h });
    else if (m === 'wood' || m === 'limb' || m === 'leap' || (m === 'work' && back === 'wood')) {
      const tr = this.treeNear(P.x, P.z, 12);
      if (tr) Object.assign(o, { where: 'tree', tree: tr });
    }
    if (o.where === 'ground') o.y = this.heights.atXZ(P.x, P.z);
    return o;
  }
  // The near set's tree whose trunk is nearest (x, z) within r m (indexTrees), or null.
  treeNear(x, z, r) {
    this.indexTrees();
    const ci = Math.floor(x / 10), cj = Math.floor(z / 10), n = Math.ceil(r / 10);
    let best = null, bd = r * r;
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
      for (const t of this.trees.get(`${i},${j}`) || []) { const d = (t.x - x) ** 2 + (t.z - z) ** 2; if (d < bd) { bd = d; best = t; } }
    }
    return best;
  }
  finishArrival(skipped) {
    const was = this.auto; this.auto = null;
    if (skipped && was && this.mode === 'trunk') this.dismount();
    if (skipped && was && this.mode === 'wood') this.dismountWood();
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
    if (A) return { fwd: this.mode === 'trunk' || this.mode === 'wood' ? -1 : 1, turn: 0, sit: false };
    return {
      fwd: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      turn: (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0),
      sit: k.has('ShiftLeft') || k.has('ShiftRight'),
    };
  }

  update(dt) {
    if (this.flight.moving()) this.flight.settleLook(dt);   // moving: the body turns into the look
    const f = this.flight, P = f.pos, ps = this.pose;
    f.body.visible = false; f.flap = 0; f.flapping = false; f.hover = false;   // the raven's keys still land in flight; ignore them
    if (P.distanceToSquared(this.last) > 20 * 20) this.place(P.x, P.z);       // moved from outside (R, Go to): onto the ground there
    const k = this.input();
    // a mouse drag turns (flight.yaw) and tilts the look (flight.pitch); on a trunk it orbits the camera instead
    const dragYaw = wrap(f.yaw - this.lastYaw);
    f.pitch = Math.max(-0.6, Math.min(0.7, f.pitch));
    const onWood = this.mode === 'wood' || (this.mode === 'work' && this.work?.back === 'wood');
    if (this.mode === 'trunk' || this.mode === 'limb' || onWood) { this.camOrbit += dragYaw; f.yaw = this.lastYaw; }
    this.leftT = Math.max(0, this.leftT - dt);
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
      case 'wood': this.wood(dt, k, jump, act); break;
      case 'leap': this.leaping(dt); break;
      case 'stun': this.stunned(dt); break;
    }
    if (this.mode !== 'wood') { this.cands.length = 0; this.candA = this.candD = null; }
    this.showJunctions();
    if (this.mode !== 'trunk' && this.mode !== 'limb' && this.mode !== 'wood' && this.mode !== 'work') this.camOrbit = damp(this.camOrbit, 0, 3, dt);
    this.lastYaw = f.yaw;
    // tail flicks now and then when still; the tip lags (the AI's channels)
    if (!this.swimming && Math.random() < dt * (this.v < 0.5 ? 0.8 : 0.15)) ps.flickV = 1;
    if (ps.flickV > 0) { ps.flick = Math.max(ps.flick, Math.sin(Math.min(1, 1 - ps.flickV) * Math.PI)); ps.flickV -= dt * 3; }
    else if (!this.work && !this.swimming) ps.flick = damp(ps.flick, 0, 1, dt);
    const splay = this.mode === 'trunk' || this.work?.back === 'trunk' || this.mode === 'stun' || (this.mode === 'air' && this.spread)
      || ((this.mode === 'wood' || this.work?.back === 'wood') && (Math.abs(this.w.f.y) > STEEP || this.w.n.y < 0.5));
    ps.e0 = damp(ps.e0, splay ? 1 : 0, 8, dt);
    ps.e1 = damp(ps.e1, ps.flick, 5, dt);
    if (ps.phase > 1e4) ps.phase -= TAU * 1000;
    this.pOff.multiplyScalar(Math.exp(-14 * dt));
    this.draw(dt);
    this.ripple(dt);
    this.updateCamera(dt);
    this.last.copy(P);
    const ground = Math.max(this.heights.atXZ(P.x, P.z), this.wet && this.mode !== 'trunk' ? this.wet.surf : -Infinity), speed = this.mode === 'trunk' || this.mode === 'wood' ? Math.abs(this.climbV || 0) : this.mode === 'air' ? Math.hypot(this.vel.x, this.vel.z) : Math.abs(this.v);
    f.speed = speed;
    const wf = this.w.f, wn = this.w.n, flat = Math.hypot(wf.x, wf.z) > 0.3;
    const hd = this.mode === 'trunk' ? this.face + Math.PI : onWood ? Math.atan2(-(flat ? wf.x : -wn.x), -(flat ? wf.z : -wn.z)) : f.yaw;
    const heading = (hd * -180 / Math.PI % 360 + 360) % 360;
    this.hudLine(ground);
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
      this.vel.set(fx * fw, JUMP_UP, fz * fw); this.mode = 'air'; this.sit = 0; this.fallTop = null; this.spread = false; return;
    }
    if (act) {
      if (swim) this.say('swimming: get out onto the bank first');
      else { this.action(); if (this.mode !== 'ground') return; }
    }
    // run into a trunk: take hold
    if (!swim && k.fwd > 0 && this.v > 0.3) {
      const tr = this.trunkAhead(P, fx, fz);
      if (tr) {
        const t = trunkAt(tr, 0.25, this._t), Q = this.Q, rec = Q?.recAt(tr.x, tr.z), hit = rec && Q.nearOn(rec, P.x, P.y + 0.25, P.z, 1.5, HOLD_R);
        if (hit) { const h = Math.hypot(hit.nx, hit.nz) || 1; this.attachWood(rec, hit.stem, hit.s, hit.nx / h, 0, hit.nz / h, 1); }
        else this.attach(tr, Math.atan2(P.x - t.x, P.z - t.z));
        this.v = 0; return;
      }
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
    if (this.fallTop === null || P.y > this.fallTop) this.fallTop = P.y;
    const nx = P.x + V.x * dt, nz = P.z + V.z * dt, ny = P.y + V.y * dt;
    if (this.spread && V.y < 0 && this.catchLimb(P.x, P.y, P.z, nx, ny, nz)) return;   // dropped from the wood: a limb it crosses
    const s = this.surface(nx, nz, Math.max(P.y, ny) + 0.05);
    if (s - ny > STEP + 0.15 && s > P.y) { V.x *= -0.2; V.z *= -0.2; }   // hit the side of a rock: drop back
    else { P.x = nx; P.z = nz; }
    P.y = ny;
    const F = this.footing(P.x, P.z, P.y + 0.05);   // lands on the ground, the bed of a shallow creek, or in the water
    if (P.y <= F.y && V.y <= 0) {
      P.y = F.y; this.mode = 'ground'; this.v = Math.hypot(V.x, V.z) * 0.8; this.setWet(F);
      if (this.wet) { this.rippleT = 0; if (this.swimming) this.v = Math.min(this.v, SWIM); } else ps.flickV = 1;
      const fell = (this.fallTop ?? P.y) - P.y; this.fallTop = null; this.spread = false;
      if (fell > STUN_H && !this.swimming) { this.mode = 'stun'; this.stunT = STUN_T; this.v = 0; this.say(`a ${Math.round(fell)} m fall: stunned`); }
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

  // ---- the wood: trunk, main stem, limbs and branches (perch.js) ------------------------------------
  get Q() { return this.flight.perchQuery?.() || null; }
  // Take hold of a stem of plant rec at arc length s, on the side (nx, ny, nz) points to, facing toward its tip (sign +1)
  // or its base (-1).
  attachWood(rec, st, s, nx, ny, nz, sign) {
    const Q = this.Q, w = this.w; Q.joins(rec);
    w.rec = rec; w.st = st; w.s = Math.max(Q.baseS(st), s); w.sign = sign; w.n.set(nx, ny, nz); w.main = this.isMain(rec, st);
    this.mode = 'wood'; this.v = 0; this.climbV = 0; this.wet = null; this.swimming = false; this.work = null; this.limb = null; this.tree = null;
    this.camOrbit = 0; this.toldEnd = false; this.spread = false; this.fallTop = null; this.leap = null;
    const a = Q.at(st, w.s, w.a);
    if (Math.abs(a.dy) <= STEEP) this.topSide(a, w.n);
    this.woodFrame();
  }
  // Whether a stem is the main stem: the root bole and the leaders carrying it on (perch.js leader), to the top.
  isMain(rec, st) {
    const Q = this.Q;
    for (let c = st; c; c = c.par) {
      if (!c.par) return c === Q.fork(rec)?.st;
      const L = Q.leader(rec, c.par, HOLD_R);
      if (!L || L.st !== c) return false;
    }
    return false;
  }
  // n: the way out of the bark straight up from a stem's axis (square to it), for a level limb.
  topSide(a, n) {
    n.set(-a.dy * a.dx, 1 - a.dy * a.dy, -a.dy * a.dz);
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
    return n.normalize();
  }
  // The frame at the feet (n square to the stem, f the facing, l the squirrel's left) and the position on the bark.
  woodFrame() {
    const w = this.w, a = this.Q.at(w.st, w.s, w.a), n = w.n, d = this._d.set(a.dx, a.dy, a.dz);
    n.addScaledVector(d, -n.dot(d));
    if (n.lengthSq() < 1e-6) { n.set(-d.z, 0, d.x); if (n.lengthSq() < 1e-6) n.set(1, 0, 0); }
    n.normalize();
    w.f.copy(d).multiplyScalar(w.sign); w.l.crossVectors(n, w.f);
    const R = a.r + 0.01;
    this.flight.pos.set(a.x + n.x * R, a.y + n.y * R, a.z + n.z * R);
    return a;
  }
  // Onto another stem (a junction, a leader, the parent) at s, facing sign; n the side to be on (null: keep this side,
  // or the top of a level limb). The drawn body eases across the step (pOff).
  onto(st, s, sign, n = null) {
    const w = this.w, P = this.flight.pos, ox = P.x, oy = P.y, oz = P.z;
    w.st = st; w.s = Math.max(this.Q.baseS(st), s); w.sign = sign; this.toldEnd = false;
    const a = this.Q.at(st, w.s, w.a);
    if (Math.abs(a.dy) <= STEEP) this.topSide(a, w.n); else if (n) w.n.copy(n);
    this.woodFrame();
    this.pOff.x += ox - P.x; this.pOff.y += oy - P.y; this.pOff.z += oz - P.z;
  }
  wood(dt, k, jump, act) {
    const Q = this.Q, w = this.w, ps = this.pose;
    if (!Q || !w.rec) { this.mode = 'air'; this.vel.set(0, 0, 0); this.spread = true; return; }
    let a = Q.at(w.st, w.s, w.a);
    const steep = Math.abs(a.dy) > STEEP;
    if (jump) { this.woodJump(steep); return; }
    if (act && this.woodAction()) return;
    this.junctions(a);
    // A / D: pressed, onto the junction on that side; held with none, round a steep stem; tapped on a level limb, about
    if (!k.turn) this.turnLock = false;
    const press = k.turn !== 0 && k.turn !== this.turnWas; this.turnWas = k.turn;
    if (press) {
      const c = k.turn > 0 ? this.candA : this.candD;
      if (c) { this.takeJunction(c); this.turnLock = true; return; }
      if (!steep) { w.sign = -w.sign; this.turnLock = true; }
    }
    const round = k.turn && steep && !this.turnLock;
    if (round) {
      const th = k.turn * Math.min(3, ROUND / (a.r + 0.06)) * dt, c = Math.cos(th), sn = Math.sin(th);   // round a thin limb: at most 3 rad/s
      w.n.multiplyScalar(c).addScaledVector(w.l, sn);   // toward the left for A
    } else if (!steep) {   // a level limb: back up onto its top
      const u = this.topSide(a, this._x); w.n.lerp(u, 1 - Math.exp(-6 * dt));
    }
    // W / S: up and down a steep stem head first; along a level limb W the way it faces, S in toward the base
    let want;
    if (steep) {
      const up = a.dy >= 0 ? 1 : -1;
      if (k.fwd > 0) w.sign = up; else if (k.fwd < 0) w.sign = -up;
      want = k.fwd > 0 ? CLIMB_UP * up : k.fwd < 0 ? -CLIMB_DOWN * up : 0;
    } else want = k.fwd > 0 ? LIMB_RUN * w.sign : k.fwd < 0 ? -(w.sign > 0 ? LIMB_BACK : LIMB_RUN) : 0;   // S: in toward the base (backing, or forward if it faces in)
    this.climbV = damp(this.climbV || 0, want, 10, dt);
    const ds = this.climbV * dt, minR = w.main ? HOLD_R : END_R, s0 = Q.baseS(w.st), end = Q.thinEnd(w.st, minR);
    let s = w.s + ds;
    if (s > end && ds > 0) {
      const L = Q.leader(w.rec, w.st, minR);   // the stem carries on in its leader: up the main stem to the top
      if (L) { const m = w.main; this.onto(L.st, Q.baseS(L.st) + 0.02, 1, w.n); w.main = m; return; }
      s = end; this.climbV = 0;
      if (!this.toldEnd) {
        this.toldEnd = true;
        this.say(w.main ? 'the top: the wood above is too thin to hold a squirrel' : 'the thin end: Space leaps to a limb ahead, or drops');
      }
    } else if (s < s0 && ds < 0) {
      if (w.st.par) { this.ontoParent(); return; }
      s = s0;
    }
    if (s < end - 0.3) this.toldEnd = false;
    w.s = Math.min(end, Math.max(s0, s));
    a = this.woodFrame();
    const P = this.flight.pos, g = this.heights.atXZ(P.x, P.z);
    if (!w.st.par && ds < 0 && P.y - g < 0.06) { this.dismountWood(); return; }   // down the bole onto the ground
    if (!w.st.par && P.y < g) { w.s += g - P.y; this.woodFrame(); }
    // pose: the climbing bound; ps.pitch / ps.yaw follow the facing so the air and the ground pick up from here
    const moving = Math.abs(this.climbV) > 0.1 || round;
    ps.amp = damp(ps.amp, moving ? 1 : 0, 10, dt);
    ps.phase += dt * TAU * (moving ? 3.5 * Math.max(0.6, Math.abs(this.climbV) / 1.8) : 0);
    ps.pose = 0; ps.bob = 0; ps.roll = 0;
    ps.pitch = -Math.asin(Math.max(-1, Math.min(1, w.f.y))); ps.yaw = Math.atan2(w.f.x, w.f.z);
  }
  // Back down a limb's base onto its parent, on the side the limb leaves from, facing the way most like this one
  // (a steep parent: the keys pick up or down there).
  ontoParent() {
    const Q = this.Q, w = this.w, c = w.st, p = c.par, b = Q.at(c, Q.baseS(c), this._ta), q = Q.at(p, c.parS, this._tb);
    const n = this._j.set(b.x - q.x, b.y - q.y, b.z - q.z);
    const sign = Math.sign(w.f.x * q.dx + w.f.y * q.dy + w.f.z * q.dz) || 1;
    this.onto(p, c.parS, sign, n.lengthSq() > 1e-8 ? n : null);
    w.main = this.isMain(w.rec, p);
  }
  takeJunction(c) {
    const Q = this.Q, w = this.w;
    if (c.parent) { const b = Q.at(w.st, Q.baseS(w.st), this._ta), q = Q.at(c.st, c.s, this._tb); this.onto(c.st, c.s, c.sign, this._j.set(b.x - q.x, b.y - q.y, b.z - q.z)); }
    else {   // onto a branch: its upper side (a steep one too, unless it stands nearly upright: then this side)
      const a = Q.at(c.st, c.s, this._ta);
      this.onto(c.st, c.s, 1, Math.abs(a.dy) < 0.9 ? this.topSide(a, this._j) : this._j.copy(w.n));
    }
    w.main = this.isMain(w.rec, w.st);
    this.climbV = 0;
  }
  // The junctions in reach: children leaving within REACH (plus the stem's radius) of the feet, on this side of a
  // thick stem; near a limb's base, its parent either way. A takes the one leaving most to the left, D most to the
  // right; one leaving nearly straight out (|side| < 0.35) either.
  junctions(a) {
    const Q = this.Q, w = this.w, l = w.l, n = w.n, C = this.cands; C.length = 0;
    const pool = this._cpool || (this._cpool = []), get = () => { const o = pool[C.length] || (pool[C.length] = {}); C.push(o); return o; };
    const lead = w.main ? Q.leader(w.rec, w.st, HOLD_R) : null;
    for (const k of Q.kidsNear(w.rec, w.st, w.s, REACH + a.r, END_R, this._kids)) {
      const b0 = Q.baseS(k.st), b = Q.at(k.st, b0 + 0.05, this._ta), q = Q.at(w.st, k.s, this._tb);
      let ox = b.x - q.x, oy = b.y - q.y, oz = b.z - q.z; const along = ox * q.dx + oy * q.dy + oz * q.dz;
      ox -= along * q.dx; oy -= along * q.dy; oz -= along * q.dz;
      const ol = Math.hypot(ox, oy, oz);
      if (a.r > 0.05 && ol > 1e-4 && (ox * n.x + oy * n.y + oz * n.z) / ol < -0.3) continue;   // round the far side of a thick stem
      const o = get(); o.parent = false; o.st = k.st; o.s = b0 + 0.02; o.sign = 1;
      o.side = b.dx * l.x + b.dy * l.y + b.dz * l.z; o.x = b.x + b.dx * 0.25; o.y = b.y + b.dy * 0.25; o.z = b.z + b.dz * 0.25;
      o.dx = b.dx; o.dy = b.dy; o.dz = b.dz; o.r = b.r; o.name = lead && lead.st === k.st ? 'up the main stem' : k.st.level === 0 ? 'the other stem' : k.st.level === 1 ? 'a limb' : 'a branch';
    }
    const p = w.st.par;
    if (p && w.s - Q.baseS(w.st) < REACH) {
      const q = Q.at(p, w.st.parS, this._tb), steepP = Math.abs(q.dy) > STEEP;
      for (const sg of [1, -1]) {
        const s1 = w.st.parS + sg * 0.5; if (s1 < Q.baseS(p) || s1 > Q.thinEnd(p, END_R)) continue;
        const o = get(); o.parent = true; o.st = p; o.s = w.st.parS; o.sign = sg;
        o.side = sg * (q.dx * l.x + q.dy * l.y + q.dz * l.z); o.dx = sg * q.dx; o.dy = sg * q.dy; o.dz = sg * q.dz;
        o.x = q.x + o.dx * 0.45; o.y = q.y + o.dy * 0.45; o.z = q.z + o.dz * 0.45; o.r = q.r;
        o.name = steepP ? `${o.dy > 0 ? 'up' : 'down'} the ${p.par ? 'stem' : 'trunk'}` : (sg > 0 ? 'on out along the limb' : 'back in along the limb');
      }
    }
    let A = null, D = null;
    for (const o of C) {
      if (o.side > -0.35 && (!A || o.side > A.side)) A = o;
      if (o.side < 0.35 && (!D || o.side < D.side)) D = o;
    }
    this.candA = A; this.candD = D;
  }
  // The rings round the junctions A and D would take, and the line naming them.
  showJunctions() {
    const C = [this.candA, this.candD];
    let text = '';
    for (let i = 0; i < 2; i++) {
      const m = this.rings[i], c = C[i], same = i === 1 && c && c === C[0];
      m.visible = !!c && !same;
      if (!m.visible) continue;
      const t = performance.now() / 1000, b = Math.sin(t * 5 + i * 1.6);
      m.position.set(c.x, c.y, c.z); m.scale.setScalar((c.r + 0.03) * (1 + 0.07 * b)); m.material.opacity = 0.72 + 0.18 * b;
      m.quaternion.setFromUnitVectors(this._x.set(0, 0, 1), this._j.set(c.dx, c.dy, c.dz));
    }
    if (C[0] && C[0] === C[1]) text = `<kbd>A</kbd> / <kbd>D</kbd> ${C[0].name}`;
    else if (C[0] || C[1]) text = [C[0] && `<kbd>A</kbd> ${C[0].name}`, C[1] && `<kbd>D</kbd> ${C[1].name}`].filter(Boolean).join(' &nbsp;·&nbsp; ');
    if (text !== this.hintWas) { this.hintWas = text; this.hint.innerHTML = text; this.hint.style.display = text ? '' : 'none'; }
  }
  // Space on the wood: a leap to wood within LEAP_R the way it faces (out from the bark, on a steep stem), else a drop.
  woodJump(steep) {
    const w = this.w, P = this.flight.pos, dir = this._j;
    if (steep || Math.hypot(w.f.x, w.f.z) < 0.35) dir.set(w.n.x, 0, w.n.z); else dir.set(w.f.x, 0, w.f.z);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();
    this.flight.yaw = this.lastYaw = Math.atan2(-dir.x, -dir.z); this.camOrbit = 0;
    this.leftSt = w.st; this.leftT = 0.5; this.cands.length = 0; this.candA = this.candD = null;
    const T = this.leapTarget(P, dir);
    if (T) {
      const d = Math.hypot(T.px - P.x, T.py - P.y, T.pz - P.z);
      this.leap = { x0: P.x, y0: P.y, z0: P.z, T, u: 0, dur: 0.28 + 0.13 * d, arc: 0.2 + 0.12 * d + Math.max(0, T.py - P.y) * 0.5, dx: dir.x, dz: dir.z };
      this.mode = 'leap'; this.w.rec = null; return;
    }
    this.vel.set(dir.x * 1.6, 1.4, dir.z * 1.6); P.addScaledVector(dir, 0.05);
    this.mode = 'air'; this.spread = true; this.fallTop = P.y; this.w.rec = null;
  }
  // The wood to leap to: sample along the way (0.6 to LEAP_R m out, 0.4 m up to 1.2 m down) for wood that holds a
  // squirrel (END_R), not the stem it leaves nor its own branches or parent (the junctions reach those), at least 0.8 m
  // off; the nearest, a drop counting more than a rise.
  leapTarget(P, dir) {
    const Q = this.Q, w = this.w; let best = null, bv = Infinity;
    for (let d = 0.6; d <= LEAP_R + 1e-6; d += 0.2) for (const dh of [0.4, 0, -0.4, -0.8, -1.2]) {
      const h = Q.nearBut(P.x + dir.x * d, P.y + 0.1 + dh, P.z + dir.z * d, 0.3, END_R, w.st); if (!h) continue;   // (along its own stem it runs)
      if (h.ay + h.r - h.ground < 0.4) continue;   // the ground's (a drop is the way there)
      if (h.stem.par === w.st || h.stem === w.st.par) continue;   // its own branches and parent: by the junctions
      const dist = Math.hypot(h.ax - P.x, h.ay - P.y, h.az - P.z); if (dist < 0.8 || dist > LEAP_R + 0.3) continue;
      const v = d + 1.5 * Math.max(0, -dh) + 0.5 * Math.max(0, dh) + h.gap;
      if (v >= bv) continue;
      bv = v;
      const steep = Math.abs(h.dy) > STEEP, n = this._x;
      if (steep) { n.set(P.x - h.ax, 0, P.z - h.az); n.addScaledVector(this._d.set(h.dx, h.dy, h.dz), -n.dot(this._d)); if (n.lengthSq() < 1e-6) n.set(-dir.x, 0, -dir.z); n.normalize(); }
      else this.topSide(h, n);
      const R = h.r + 0.01;
      best = { rec: h.rec, st: h.stem, s: h.s, nx: n.x, ny: n.y, nz: n.z, px: h.ax + n.x * R, py: h.ay + n.y * R, pz: h.az + n.z * R,
        sign: steep ? (h.dy >= 0 ? 1 : -1) : (Math.sign(dir.x * h.dx + dir.z * h.dz) || 1) };
    }
    return best;
  }
  leaping(dt) {
    const L = this.leap, T = L.T, P = this.flight.pos, ps = this.pose;
    L.u = Math.min(1, L.u + dt / L.dur);
    const u = L.u, y = L.y0 + (T.py - L.y0) * u + L.arc * Math.sin(Math.PI * u);
    const vy = (T.py - L.y0) + L.arc * Math.PI * Math.cos(Math.PI * u);
    P.set(L.x0 + (T.px - L.x0) * u, y, L.z0 + (T.pz - L.z0) * u);
    ps.amp = damp(ps.amp, 0.3, 6, dt); ps.phase += dt * TAU * 2; ps.pose = damp(ps.pose, 0, 10, dt); ps.bob = 0;
    ps.pitch = damp(ps.pitch, -Math.atan2(vy, Math.max(0.5, Math.hypot(T.px - L.x0, T.pz - L.z0))) * 0.6, 10, dt);
    ps.yaw = Math.atan2(L.dx, L.dz); ps.roll = 0;
    if (u >= 1) { this.attachWood(T.rec, T.st, T.s, T.nx, T.ny, T.nz, T.sign); this.pose.flickV = 1; }
  }
  // Dropping from the wood: a limb crossed between (x0, y0, z0) and (x1, y1, z1), not too steep, met from above: take hold.
  catchLimb(x0, y0, z0, x1, y1, z1) {
    const Q = this.Q; if (!Q) return false;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 0.1));
    for (let i = 1; i <= n; i++) {
      const t = i / n, h = Q.near(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + 0.03, z0 + (z1 - z0) * t, 0.1, END_R);
      if (!h || Math.abs(h.dy) > 0.8 || h.ny < 0.2 || (h.stem === this.leftSt && this.leftT > 0)) continue;
      if (h.ay - h.ground < 0.5) continue;
      const sign = Math.sign(this.vel.x * h.dx + this.vel.z * h.dz) || 1, fell = (this.fallTop ?? y0) - h.ay;
      this.attachWood(h.rec, h.stem, h.s, 0, 1, 0, sign);
      if (fell > 1.5) this.say(`caught a limb ${Math.round(fell)} m down`);
      return true;
    }
    return false;
  }
  stunned(dt) {
    const ps = this.pose;
    this.stunT -= dt; this.v = 0;
    ps.amp = damp(ps.amp, 0, 10, dt); ps.pose = damp(ps.pose, 0, 8, dt); ps.pitch = damp(ps.pitch, 0.1, 6, dt); ps.flick = damp(ps.flick, -0.3, 6, dt);
    if (this.stunT <= 0) this.mode = 'ground';
  }
  // Off the bottom of the bole onto the ground, facing out.
  dismountWood() {
    const f = this.flight, P = f.pos, n = this.w.n, h = Math.hypot(n.x, n.z) || 1;
    f.yaw = this.lastYaw = Math.atan2(-n.x / h, -n.z / h);
    P.x += n.x / h * 0.2; P.z += n.z / h * 0.2; P.y = this.heights.atXZ(P.x, P.z);
    this.mode = 'ground'; this.w.rec = null; this.v = 1.5; this.camOrbit = 0;
  }
  // E on the wood: a crown acorn within CROWN_R; else which way the nearest within 5 m is.
  woodAction() {
    const G = this.acorns, P = this.flight.pos, w = this.w;
    if (!G || !G.running) { this.say('start a game (panel: Start game) to gather acorns'); return true; }
    if (G.player.carrying > 0) { this.say('your mouth is full: bury this one first'); return true; }
    const near = G.acornNear(P.x, P.y, P.z, CROWN_R, true);
    if (near) { this.work = { kind: 'pick', t: WORK.pick, acorn: near, back: 'wood' }; this.mode = 'work'; return true; }
    let best = null, bd = 5;
    for (const a of G.liveAcorns) {
      if (!a.branch) continue;
      const d = Math.hypot(a.x - P.x, a.y - P.y, a.z - P.z); if (d < bd) { bd = d; best = a; }
    }
    if (!best) { this.say('no acorn within reach here'); return true; }
    const dx = best.x - P.x, dz = best.z - P.z, side = dx * w.l.x + dz * w.l.z, ahead = dx * w.f.x + dz * w.f.z;
    const way = Math.abs(side) > Math.abs(ahead) ? (side > 0 ? 'to the left' : 'to the right') : ahead > 0 ? 'ahead' : 'behind';
    this.say(`an acorn ${bd.toFixed(1)} m off, ${way}${best.y > P.y + 0.5 ? ', above' : best.y < P.y - 0.5 ? ', below' : ''}: run out along a limb to it`);
    return true;
  }
  // The HUD row: where the squirrel is ("on a blue oak, 7 m up, on a limb").
  hudLine(ground) {
    if (!this.hudRow) {
      const hud = document.getElementById('hud'); if (!hud) return;
      this.hudRow = Object.assign(document.createElement('div'), { className: 'row wide', innerHTML: '<span>where</span><b></b>' });
      const h1 = hud.querySelector('h1'); if (h1) h1.after(this.hudRow); else hud.prepend(this.hudRow);
    }
    const P = this.flight.pos, w = this.w, wood = this.mode === 'wood' || (this.mode === 'work' && this.work?.back === 'wood');
    let text;
    if (wood && w.rec) {
      const name = this.Q.nameOf(w.rec), up = Math.max(0, Math.round(P.y - this.heights.atXZ(P.x, P.z))), fk = this.Q.fork(w.rec);
      const under = w.n.y < -0.3 && Math.abs(w.f.y) < 0.8;
      const part = w.st === fk?.st && w.s < fk.s + 0.1 ? 'on the trunk' : w.main ? 'on the main stem' : w.st.level === 0 ? 'on a stem' : `${under ? 'under' : 'on'} ${w.st.level === 1 ? 'a limb' : 'a branch'}`;
      text = `on ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}, ${up} m up, ${part}`;
    } else if (this.mode === 'trunk' && this.tree) text = `on the trunk, ${Math.max(0, Math.round(P.y - ground))} m up`;
    else if (this.mode === 'air' || this.mode === 'leap') text = this.mode === 'leap' ? 'leaping' : P.y - ground > 1 ? `in the air, ${Math.round(P.y - ground)} m up` : 'in the air';
    else if (this.mode === 'stun') text = 'stunned';
    else text = this.swimming ? 'swimming' : this.wet ? 'wading' : 'on the ground';
    this.hudRow.style.display = '';
    const b = this.hudRow.lastChild; if (b.textContent !== text) b.textContent = text;
  }
  // Keep the camera's line to the squirrel out of the leaves (woodpeckerControl.js crownClear, the same rule): each
  // tree's crown within 12 m is a sphere above its fork (from the fork, or the species' crown base when higher, to the
  // top; as wide as that, at most the species' crown width); a crown the squirrel is in is skipped. The camera must be
  // outside the sphere grown by CROWN_PAD and the line from it to 0.4 of the way in outside the sphere; if not it drops
  // (up to CROWN_LOWER), else comes in along the line (no closer than CROWN_MIN). off: camera - P, changed in place.
  crownClear(P, off) {
    this.indexTrees();
    const S = this._crowns || (this._crowns = []); S.length = 0; this.inCrown = false;
    const ci = Math.floor(P.x / 10), cj = Math.floor(P.z / 10), t = this._t, own = this.w.rec;
    for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
      for (const tr of this.trees.get(`${i},${j}`) || []) {
        if (tr.snag || Math.hypot(tr.x - P.x, tr.z - P.z) > 12) continue;
        const sp = PLANTS[tr.species]?.targets || {}, H = tr.H, fork = this.topOf(tr);
        const base = Math.max(fork, (sp.crown_base_ratio ?? 0.15) * H);
        const R = Math.min((H - base) / 2, (sp.crown_width_ratio ?? 1) * H / 2); if (R < 0.5) continue;
        trunkAt(tr, Math.min(base, fork), t);
        const cx = t.x, cy = tr.y + base + R, cz = t.z;
        const G2 = (R + Math.min(CROWN_PAD[2], CROWN_PAD[0] + CROWN_PAD[1] * R)) ** 2;
        // the crown it is climbing in (or at the edge of) is skipped: no line clears it
        const mine = own && Math.abs(tr.x - own.x) < 0.05 && Math.abs(tr.z - own.z) < 0.05, d2 = (P.x - cx) ** 2 + (P.y - cy) ** 2 + (P.z - cz) ** 2;
        if (mine && d2 < G2) this.inCrown = true;
        if (mine || d2 < G2) continue;
        S.push(cx, cy, cz, R * R, G2);
      }
    }
    if (!S.length) return;
    const inside = (x, y, z, k) => {
      for (let n = 0; n < S.length; n += 5) if ((x - S[n]) ** 2 + (y - S[n + 1]) ** 2 + (z - S[n + 2]) ** 2 < S[n + k]) return true;
      return false;
    };
    const blocked = (ox, oy, oz) => {
      if (inside(P.x + ox, P.y + oy, P.z + oz, 4)) return true;
      for (const f of [0.85, 0.7, 0.55, 0.4]) if (inside(P.x + ox * f, P.y + oy * f, P.z + oz * f, 3)) return true;
      return false;
    };
    if (!blocked(off.x, off.y, off.z)) return;
    const g = this.heights.atXZ(P.x + off.x, P.z + off.z) + 0.25 - P.y;
    for (let d = 0.15; d <= CROWN_LOWER + 1e-6 && off.y - d >= g; d += 0.15) if (!blocked(off.x, off.y - d, off.z)) { off.y -= d; return; }
    const L = Math.hypot(off.x, off.y, off.z), lo = Math.min(1, CROWN_MIN / L);
    let f = 1;
    while (f > lo && inside(P.x + off.x * f, P.y + off.y * f, P.z + off.z * f, 4)) f -= 0.05;
    off.multiplyScalar(Math.max(lo, f));
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
      this.say(ok ? `${W.back === 'trunk' || W.back === 'wood' ? 'took an acorn from the crown' : 'picked up an acorn'}${this.nameOf(W.acorn)}` : 'someone took it first');
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
  draw(dt = 0.016) {
    const m = this.mesh, ps = this.pose, P = this.flight.pos; if (!m) return;
    m.visible = true;
    // on the wood the body is set by the bark (up: out of it, forward: along the stem); elsewhere by the Euler pose;
    // eased across, so a turn onto a limb or head-down on the trunk is a quick swivel, not a cut
    const wood = this.mode === 'wood' || (this.mode === 'work' && this.work?.back === 'wood');
    if (wood) { const w = this.w; this._mb.makeBasis(this._x.crossVectors(w.n, w.f), w.n, w.f); this._qt.setFromRotationMatrix(this._mb); }
    else { this._e.set(ps.pitch, ps.yaw, ps.roll, 'YXZ'); this._qt.setFromEuler(this._e); }
    if (this.qFresh) this._q.slerp(this._qt, 1 - Math.exp(-dt * (wood || this.mode === 'leap' ? 14 : 40))); else { this._q.copy(this._qt); this.qFresh = true; }
    this._p.set(P.x + this.pOff.x, P.y + ps.bob + this.pOff.y, P.z + this.pOff.z);
    this._m.compose(this._p, this._q, this._s);
    this._m.toArray(m.instanceMatrix.array, 0); m.instanceMatrix.needsUpdate = true;
    const an = m.geometry.attributes.aAnim; an.array[0] = ps.phase % TAU; an.array[1] = ps.amp; an.array[2] = ps.pose; an.array[3] = ps.flick; an.needsUpdate = true;
    if (this.rig) { const a2 = m.geometry.attributes.aAnim2; a2.array[0] = ps.e0; a2.array[1] = ps.e1; a2.array[2] = 0; a2.array[3] = 0; a2.needsUpdate = true; }
    // the acorn in its mouth
    const carrying = this.acorns?.running && this.acorns.player.carrying > 0;
    this.nut.visible = !!carrying;
    if (carrying) {
      const c = this.animals.carryPoint({ sp: this.sp, flick: ps.flick, pose: ps.pose, phase: ps.phase, amp: ps.amp }, this._m);
      this.nut.position.copy(c); this.nut.quaternion.copy(this._q).multiply(this._nutQ);
    }
  }

  // Chase camera: ~0.6 m up and 2.5 m back on the ground (higher and nearer sitting up), a three-quarter view CAM_SIDE
  // off the heading so the bound and the acorn in the mouth show past the tail. It sits on the inside of the last turn
  // (turning left, the left rear), the side the chase lag already swings it to, so the two add instead of cancelling
  // to a view of the tail, and it eases across behind when the turn changes side. On a trunk it
  // stands off the bark over the squirrel's shoulder and orbits with it round the trunk (a drag orbits it further).
  // A leap keeps a tree camera (behind and above the arc, into the landing limb's camera); a drop from the wood keeps
  // one over the fall and eases into the chase camera over the last DROP_EASE m. In the tree the leaf cards nearer the
  // lens than the squirrel are dissolved (cutLeaves). Then it is kept out of the ground: above the drawn terrain round the lens (the near plane is NEAR), the sight
  // line to the squirrel clear of a slope between them (running downhill the ground behind rises), and over a pond.
  updateCamera(dt) {
    const f = this.flight, P = f.pos, cam = this.camera, off = this._v, aim = this._w;
    let k = 7;
    const rate = wrap(f.yaw - (this.camYaw ?? f.yaw)) / Math.max(dt, 1e-3); this.camYaw = f.yaw;   // keys or a drag
    if (Math.abs(rate) > 0.3 && (this.mode === 'ground' || this.mode === 'air')) this.camSide = damp(this.camSide, -Math.sign(rate) * CAM_SIDE, CAM_SWING, dt);
    const wood = this.mode === 'wood' || (this.mode === 'work' && this.work?.back === 'wood');
    const leap = this.mode === 'leap' && this.leap, drop = this.mode === 'air' && this.spread;
    if (!wood) { this.sightGoal = 0; this.sightRot = damp(this.sightRot || 0, 0, 4, dt); }   // off the wood: no swing round a stem
    if (wood) {
      // over the shoulder: behind the way it faces and out from the bark (so under a limb when it is underneath), a
      // little to the side; on a steep stem close below (head up) or above (head down) and further out, as on the trunk
      // in its own crown, or out a limb (among the leaves), the boom shortens: fewer leaf cards between; eased. The
      // leaves still nearer than the squirrel are dissolved (cutLeaves), and wood across the line swings the boom round
      // the stem (sightRound)
      const w = this.w, fw = w.f, n = w.n, l = w.l, st = Math.min(1, Math.abs(fw.y) / 0.9);
      this.boomK = damp(this.boomK ?? 1, this.inCrown || !w.main ? CROWN_BOOM : 1, 2, dt);   // out a limb: in the leaves
      const K = this.boomK, back = (1.9 + (0.6 - 1.9) * st) * K, out = (0.75 + (1.9 - 0.75) * st) * K, side = 0.45 * K;
      off.set(-fw.x * back + n.x * out - l.x * side, -fw.y * back + n.y * out - l.y * side, -fw.z * back + n.z * out - l.z * side);
      const axis = this._d.set(w.a.dx, w.a.dy, w.a.dz);
      if (this.camOrbit) off.applyAxisAngle(axis, this.camOrbit);
      if (!this.auto) this.sightRound(dt, P, off, axis);
      aim.set(fw.x * 0.5 + n.x * 0.08, fw.y * 0.5 + n.y * 0.08, fw.z * 0.5 + n.z * 0.08);
      if (!this.auto) this.crownClear(P, off);
      k = 5;
    } else if (leap) {
      // a leap stays in the tree camera: behind the leap and above it, looking ahead along the arc to the landing; the
      // boom eases in from the limb's camera and out again into the landing limb's (no crown rule: the leaf cut keeps
      // the line clear, and the crown it leaps in would push the camera down under the limbs)
      const L = this.leap, T = L.T, tx = T.px - P.x, ty = T.py - P.y, tz = T.pz - P.z, tl = Math.hypot(tx, ty, tz), lk = Math.min(LEAP_LOOK, tl);
      off.set(-L.dx * LEAP_BACK, LEAP_UP, -L.dz * LEAP_BACK);
      if (tl > 1e-3) aim.set(tx / tl * lk, ty / tl * lk + 0.05, tz / tl * lk); else aim.set(L.dx * lk, 0.05, L.dz * lk);
      k = 5;
    } else if ((this.mode === 'trunk' || this.mode === 'limb' || (this.mode === 'work' && this.work?.back === 'trunk')) && this.tree) {
      const tr = this.tree, ang = this.face + this.camOrbit, t = trunkAt(tr, Math.max(0, this.h), this._t);
      const out = t.r + 2.1, side = 0.55, ox = Math.sin(ang), oz = Math.cos(ang);
      off.set(t.x + ox * out + oz * side - P.x, t.y + (this.headUp ? -0.55 : 0.75) - P.y, t.z + oz * out - ox * side - P.z);
      aim.set(0, this.headUp ? 0.5 : -0.35, 0);
      k = 5;
    } else {
      const z = f.zoom || 1, back = (CAM_BACK - 0.5 * this.sit) * z, up = (CAM_UP + 0.45 * this.sit) * z, ly = f.yaw + f.look, a = ly + this.camSide;   // z: the wheel's zoom; ly: the look's yaw (flight.js)
      off.set(Math.sin(a) * back, up, Math.cos(a) * back);
      const fx = -Math.sin(ly), fz = -Math.cos(ly), look = 1.2;
      aim.set(fx * look, 0.22 + 0.25 * this.sit + Math.tan(f.pitch) * (back + look), fz * look);
      if (drop) {   // dropped from the wood: a tree camera over the fall, easing to this one near the ground
        const g = Math.min(1, Math.max(0, (P.y - this.heights.atXZ(P.x, P.z) - 0.3) / DROP_EASE));
        off.lerp(this._c.set(Math.sin(a) * DROP_BACK, DROP_UP, Math.cos(a) * DROP_BACK), g);
        aim.lerp(this._c.set(fx * 0.3, 0.05, fz * 0.3), g);
        k = 7 - 2 * g;
      }
    }
    if (!this.camSettled) { this.camOff.copy(off); this.aimOff.copy(aim); this.camSettled = true; this.camLift = 0; }
    else {   // the boom's direction and length eased apart, so a swing round a stem never passes through the squirrel
      const u = 1 - Math.exp(-dt * k), L0 = this.camOff.length(), L1 = off.length();
      this.camOff.multiplyScalar(1 / Math.max(L0, 1e-6)).lerp(this._x.copy(off).multiplyScalar(1 / Math.max(L1, 1e-6)), u);
      if (this.camOff.lengthSq() < 1e-4) this.camOff.set(0, 1, 0);
      this.camOff.setLength(L0 + (L1 - L0) * u);
      this.aimOff.lerp(aim, u);
    }
    cam.position.copy(P).add(this.camOff);
    // the lift that keeps it out of the ground: up at once, back down gently (no bob over every bump)
    const need = this.camClear(P, cam.position) - cam.position.y;
    this.camLift = need > this.camLift ? need : damp(this.camLift, need, 3, dt);
    if (this.camLift > 0) cam.position.y += this.camLift;
    // short of a limb in the way: drawn in toward the squirrel (never nearer than 0.9 m), quickly but eased (a leap's
    // camera sweeps past limbs; a cut would pop), and back out gently
    let pull = 0;
    if ((wood || leap) && this.Q) for (let i = 0; i < 4 && this._x.copy(cam.position).lerp(P, pull).distanceTo(P) > 0.9 && this.Q.near(this._x.x, this._x.y, this._x.z, 0.3, 0.03); i++) pull = 1 - (1 - pull) * 0.8;
    this.pull = pull > (this.pull || 0) ? damp(this.pull || 0, pull, 15, dt) : damp(this.pull || 0, pull, 3, dt);
    if (this.pull > 1e-3) cam.position.lerp(P, this.pull);
    cam.up.set(0, 1, 0);
    cam.lookAt(aim.copy(P).add(this.aimOff));
    this.cutLeaves(dt, wood, leap, drop);
  }
  // Round the stem to a clear line: another limb or branch across the line from the lens to the squirrel (the leaf cut
  // clears leaves, not wood) swings the boom round the stem's axis to the nearest clear side (SIGHT_ROT, tried nearest
  // first; checked every SIGHT_DT s, eased), and back to straight behind when that clears. off: rotated in place.
  sightRound(dt, P, off, axis) {
    this.sightT = (this.sightT || 0) - dt;
    if (this.sightT <= 0) {
      this.sightT = SIGHT_DT;
      const v = this._sv || (this._sv = new THREE.Vector3()), clear = r => this.sightClear(P, v.copy(off).applyAxisAngle(axis, r));
      const g = this.sightGoal || 0;
      if (g && clear(0)) this.sightGoal = 0;
      else if (!clear(g)) for (const r of SIGHT_ROT) if (r !== g && clear(r)) { this.sightGoal = r; break; }
    }
    this.sightRot = damp(this.sightRot || 0, this.sightGoal || 0, 4, dt);
    if (Math.abs(this.sightRot) > 1e-3) off.applyAxisAngle(axis, this.sightRot);
  }
  // Whether the line from the squirrel's back out to P + off is clear of wood (any but its own stem, thicker than a
  // twig) beyond SIGHT_SKIP of the squirrel.
  sightClear(P, off) {
    const Q = this.Q, w = this.w, n = w.n, L = off.length();
    if (!Q || L < 0.3) return true;
    const x0 = P.x + n.x * 0.08, y0 = P.y + n.y * 0.08, z0 = P.z + n.z * 0.08;
    for (let u = SIGHT_SKIP / L; u < 0.95; u += 0.15) if (Q.nearBut(x0 + off.x * u, y0 + off.y * u, z0 + off.z * u, 0.05, 0.012, w.st)) return false;
    return true;
  }
  // The leaf cut's uniforms (leafCut): on in the tree (the wood, the old trunk climb, a leap, a drop from the wood),
  // eased; the squirrel's middle and the point CUT_AHEAD along the way it faces (the landing, in a leap), in view space.
  cutLeaves(dt, wood, leap, drop) {
    const cam = this.camera, P = this.flight.pos, U = LEAF_CUT, w = this.w;
    const inTree = wood || leap || drop || this.mode === 'trunk' || this.mode === 'limb' || (this.mode === 'work' && this.work?.back === 'trunk');
    this.cutS = damp(this.cutS, inTree ? 1 : 0, CUT_K, dt);
    if (this.cutS < 0.01) { this.cutS = 0; U.a.value.w = 0; return; }
    cam.updateMatrixWorld();
    const V = cam.matrixWorldInverse, c = this._c;
    if (wood) c.copy(P).addScaledVector(w.n, 0.08); else c.set(P.x, P.y + 0.1, P.z);
    const dist = c.distanceTo(cam.position);
    c.applyMatrix4(V); U.a.value.set(c.x, c.y, c.z, this.cutS);
    if (wood) c.copy(P).addScaledVector(w.f, CUT_AHEAD).addScaledVector(w.n, 0.05);
    else if (leap) c.set(this.leap.T.px, this.leap.T.py + 0.05, this.leap.T.pz);
    else c.set(P.x - Math.sin(this.flight.yaw) * CUT_AHEAD, P.y + 0.05, P.z - Math.cos(this.flight.yaw) * CUT_AHEAD);
    c.applyMatrix4(V); if (c.z > -0.05) c.copy(U.a.value);   // the point ahead behind the lens: the squirrel alone
    U.b.value.set(c.x, c.y, c.z, 0);
    U.r.value.set(CUT_R, CUT_R2, CUT_EDGE, 0);
    U.lens.value.set(CUT_LENS * dist, 0.5 * CUT_LENS * dist);
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

// The leaf cut: a dissolve, chained onto the vegetation's near and close leaf cards and close twigs (vegetation.js
// canopyMat, twigMat; once, from here, so the vegetation's own code is unchanged), that keeps the player squirrel and
// the limb ahead of it in view inside a crown. In view space (vViewPosition, which the Lambert shader already has): a
// card fragment is dropped when it is nearer the lens than the squirrel and (1) within lens.x m of the lens (eased
// over lens.y), or (2) inside the screen-space capsule from the squirrel (a.xyz, radius r.x) to the point ahead (b.xyz,
// radius r.y), eased over r.z. Dropped by an interleaved-gradient dither against the strength a.w, as the LOD
// cross-fades do (alpha hash), so the edge is a soft dissolve rather than a cut line. a.w = 0 skips it all (the raven,
// the woodpecker, the squirrel on the ground). Shadows are drawn with the depth materials, so a cut leaf still shades.
const LEAF_CUT = { a: { value: new THREE.Vector4() }, b: { value: new THREE.Vector4() }, r: { value: new THREE.Vector4() }, lens: { value: new THREE.Vector2() } };
const cutDone = new WeakSet();
function leafCut(veg) {
  const mats = [veg?.twigMat];
  for (const m of Object.values(veg?.canopyMat || {})) mats.push(m.near, m.close);
  for (const m of mats) {
    if (!m || cutDone.has(m)) continue;
    cutDone.add(m);
    chainShader(m, 'sq-cut', shader => {
      shader.uniforms.sqCutA = LEAF_CUT.a; shader.uniforms.sqCutB = LEAF_CUT.b; shader.uniforms.sqCutR = LEAF_CUT.r; shader.uniforms.sqCutL = LEAF_CUT.lens;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 sqCutA;\nuniform vec4 sqCutB;\nuniform vec4 sqCutR;\nuniform vec2 sqCutL;')
        .replace('#include <clipping_planes_fragment>', `if (sqCutA.w > 0.0) {
          vec3 cp = -vViewPosition; float cz = max(1e-3, -cp.z);
          vec2 cs = cp.xy / cz, ca = sqCutA.xy / max(1e-3, -sqCutA.z), cb = sqCutB.xy / max(1e-3, -sqCutB.z), ab = cb - ca;
          float ct = clamp(dot(cs - ca, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
          float cd = length(cs - ca - ab * ct), cr = mix(sqCutR.x, sqCutR.y, ct), depth = mix(-sqCutA.z, -sqCutB.z, ct);
          float ck = (1.0 - smoothstep(cr, cr + sqCutR.z, cd)) * (1.0 - smoothstep(depth - 0.25, depth - 0.05, cz));
          ck = max(ck, (1.0 - smoothstep(sqCutL.x - sqCutL.y, sqCutL.x, length(cp))) * (1.0 - smoothstep(-sqCutA.z - 0.25, -sqCutA.z - 0.05, cz)));
          float cn = fract(52.9829189 * fract(dot(gl_FragCoord.xy + vec2(23.0, 7.0), vec2(0.06711056, 0.00583715))));
          if (cn < ck * sqCutA.w) discard; }
        #include <clipping_planes_fragment>`);
    });
  }
}
