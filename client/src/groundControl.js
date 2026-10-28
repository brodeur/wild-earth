import * as THREE from 'three';
import { trunkAt } from './animals.js';
import { animalMaterial, animalDepthMaterial, hasAnim2, antlerState, driveClips, makeClipState, DEER_DRIVE } from './animalModels.js';
import { addCaster } from './shadows.js';
import { HerdMarks } from './herdMarks.js';
import { HerdSilhouette } from './herdSilhouette.js';

// The playable walkers (owner's request 2026-10-26, "make the other animals playable"): one controller for every
// species that lives on the ground, parameterised per species by GROUND below. Black-tailed deer (doe and buck), gray
// fox, coyote, mountain lion, black bear, brush rabbit, black-tailed jackrabbit, California vole, California ground squirrel,
// western fence lizard, and the wild turkey and California quail on foot. When the player is one of them main.js calls
// this instead of flight.update; it drives `flight.pos` and `flight.yaw` (forward -z at yaw 0) as the squirrel's
// controller does, so the forest, grass, minimap, identify, animals and sound follow it. The raven's body is hidden.
//
// The ground is the squirrel controller's (squirrelControl.js, read only): footing() for the drawn terrain, close rock
// tops (stepped onto up to the species' `step`, otherwise a wall to jump), creek beds and pond levels; its tree index
// and animals.js trunkAt keep the body out of the drawn trunks; crownClear keeps the camera's line out of the crowns.
//
// Controls: W runs (a walk at first, building to the species' top speed over `ramp` s: a deer walks, trots, then
// gallops; Shift + W keeps to a walk, a stalk for the lion), S backs, A / D or a drag turn, a vertical drag tilts the
// look. Space jumps (`jumpH` m high, `jumpL` m long from a stand, further at a run); the turkey and the quail, from a
// run, flush instead: a whirring climb, a glide on bowed wings and a landing within a few seconds (A / D steer it,
// Space again a few more beats). Shift held still: alert, head up (the canids, deer, lion and birds) or sat up on the
// haunches (rabbits, vole, ground squirrel: the sentinel's bolt upright); the lizard does its push-ups. E: the species'
// idle act (graze, sniff, nibble, peck, a turkey's scratch, a lizard's head flick). X: lie down (bed), a jackrabbit's
// hunch in its form, the lizard's flat bask; X again or any move gets up. Water deeper than `wade` stops it at the
// edge (the small ones at the shore; deer, coyote and lion wade in), and wading slows it.
//
// The model is the AI's: animals.playerModel(name) (the drawn mesh's lod0, or the procedural model while it loads),
// one extra instance per model with its own aAnim / aAnim2, posed from this controller's state by the same rig
// templates the AI drives (quadruped walk / trot / gallop with the gait selector, the rodent's bound and sit-up, the
// bird's walk, peck and flush, the reptile's dash, bend and push-up). Entering from the spirit (enterAt) carries over
// the AI animal's size, colour variant (a hen quail or turkey, a male lizard), a buck's antlers, and its pose and gait
// phase, so a bedded deer stays bedded and a running fox keeps its stride.

const TAU = Math.PI * 2, G = 9.8;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = u => u * u * (3 - 2 * u);

// Per species (m, m/s, rad/s, s). rig: how the model is posed (quad, rodent, bird, lizard); model: animals.js DRAWN
// name. walk / run / back: speeds (W builds from walk to run over ramp s); accel, stop: 1/s toward the target speed;
// turn: rad/s at a walk (less at a run); jumpH, jumpL: a standing jump's height and length; step: a rise taken without
// a jump; wade: the deepest water it walks in; half: half its body length (the slope it stands on); rad: its body's
// radius (kept off the trunks); shoulder: its height at the shoulder (the trunk test's height, the HUD). cam: the
// chase camera, scaled to the body: back, up, look (the aim ahead), aimUp, side (rad off the heading), clear (m over
// the ground round the lens) and near (the near plane). Gait: quad stride (m, as animals.js MAMMAL) and trot (m/s: the
// trot-to-gallop switch); rodent bound(v) (m per bound), lift(v) (m of air in a bound), rock (pitch in a bound);
// bird stride. act: E's head dip (flick; dig: a quadruped's shoulders down and the head working) and how long (s); alert: Shift's head lift (flick) or sit-up (pose); rest:
// X's pose (null: none). flush (birds): the flush flight from a run over `from` m/s: speed, duration, climb, beat Hz.
// Framing (owner, 2026-10-27: "raise the camera so that the animal is in the bottom third of the screen"): the camera
// sits CAM_RAISE times higher than each body's `up`, and its pitch is set each frame from the line to the body's centre
// so that centre lands FRAME_Y of the half view below the screen's middle (-0.45: a little under a third up from the
// bottom), whatever the body's size, its sitting or the ground; the drag's tilt adds to it. The yaw stays the aim's.
export const CAM_RAISE = 1.3, FRAME_Y = -0.45, CAM_PLUS = { back: 0.5, up: 0.2 };   // CAM_PLUS: m added to every body's chase distance (owner, 2026-10-27: a rabbit's camera sat on its back)
// The herd pilot (owner, 2026-10-27): in a member of a herd, covey or flock (HERD_WORD's species; the animal's group,
// animals.js pilot) the group trends toward a point HERD_LEAD body half-lengths ahead of the player while the player
// steers; after HERD_IDLE s without a key the group takes back over: it goes on with its own life from where it is,
// and the player's body walks with it as a member (herdDrive: keys synthesized toward its slot, behind the leader in
// file or round the centre) until any key, which takes the reins back. The HUD's where line says which.
const HERD_WORD = { odocoileus_hemionus: 'herd', callipepla_californica: 'covey', meleagris_gallopavo: 'flock' };
const HERD_LEAD = 5, HERD_IDLE = 6;
export const GROUND = {
  odocoileus_hemionus: { short: 'deer', common: 'black-tailed deer', model: 'deer', rig: 'quad',
    walk: 1.3, run: 12, back: 0.8, ramp: 3, accel: 2.2, stop: 4, turn: 1.8, jumpH: 1.6, jumpL: 3.5, step: 0.5, wade: 0.7,
    half: 0.6, rad: 0.3, shoulder: 0.95, stride: 1.0, trot: 3,
    cam: { back: 4, up: 1.7, look: 3, aimUp: 1.0, side: 0.35, clear: 0.35, near: 0.25 },
    act: { flick: 1, t: 4, word: 'grazing' }, alert: { flick: -0.4 }, rest: 'bed' },
  urocyon_cinereoargenteus: { short: 'fox', common: 'gray fox', model: 'fox', rig: 'quad',
    walk: 1.0, run: 9, back: 0.7, ramp: 2, accel: 3.5, stop: 6, turn: 2.6, jumpH: 0.8, jumpL: 1.6, step: 0.35, wade: 0.2,
    half: 0.25, rad: 0.12, shoulder: 0.37, stride: 0.6, trot: 2.3,
    cam: { back: 2.2, up: 0.75, look: 1.5, aimUp: 0.35, side: 0.4, clear: 0.25, near: 0.15 },
    act: { flick: 1, t: 3, word: 'sniffing' }, alert: { flick: -0.3 }, rest: 'bed' },
  canis_latrans: { short: 'coyote', common: 'coyote', model: 'coyote', rig: 'quad',
    walk: 1.2, run: 12, back: 0.8, ramp: 2.5, accel: 3, stop: 5, turn: 2.2, jumpH: 1.0, jumpL: 2.2, step: 0.4, wade: 0.4,
    half: 0.35, rad: 0.18, shoulder: 0.58, stride: 0.8, trot: 2.8,
    cam: { back: 2.8, up: 1.0, look: 2, aimUp: 0.5, side: 0.4, clear: 0.3, near: 0.2 },
    act: { flick: 1, t: 3, word: 'sniffing' }, alert: { flick: -0.3 }, rest: 'bed' },
  puma_concolor: { short: 'lion', common: 'mountain lion', model: 'lion', rig: 'quad',
    walk: 1.0, run: 14, back: 0.7, ramp: 2.5, accel: 3, stop: 5, turn: 2.0, jumpH: 1.6, jumpL: 4.5, step: 0.5, wade: 0.45,
    half: 0.45, rad: 0.25, shoulder: 0.72, stride: 1.0, trot: 2.0, stalk: 0.45,
    cam: { back: 3.5, up: 1.3, look: 2.5, aimUp: 0.6, side: 0.35, clear: 0.3, near: 0.2 },
    act: { flick: 0.6, t: 3, word: 'sniffing' }, alert: { flick: -0.3 }, rest: 'bed' },
  // the black bear: an amble, a bounding run in bursts (to ~13 m/s), a heavy short jump; E digs and scratches at the
  // ground (the head down), X lies down
  ursus_americanus: { short: 'bear', common: 'black bear', model: 'bear', rig: 'quad',
    walk: 1.0, run: 11, back: 0.6, ramp: 3, accel: 2.5, stop: 4, turn: 1.6, jumpH: 0.7, jumpL: 1.8, step: 0.55, wade: 0.7,
    half: 0.5, rad: 0.3, shoulder: 0.8, stride: 0.9, trot: 2.6,
    cam: { back: 3.8, up: 1.4, look: 2.5, aimUp: 0.6, side: 0.35, clear: 0.35, near: 0.2 },
    act: { flick: 1, dig: true, t: 4, word: 'digging' }, alert: { flick: -0.4 }, rest: 'bed' },
  sylvilagus_bachmani: { short: 'rabbit', common: 'brush rabbit', model: 'rabbit', rig: 'rodent',
    walk: 1.0, run: 7, back: 0.5, ramp: 1, accel: 5, stop: 8, turn: 3.5, jumpH: 0.35, jumpL: 0.9, step: 0.15, wade: 0.04,
    half: 0.12, rad: 0.07, shoulder: 0.15,
    bound: v => v > 2 ? 0.9 : 0.32, lift: v => v > 2 ? 0.13 : 0.06, rock: 0.18,
    cam: { back: 1.0, up: 0.32, look: 0.8, aimUp: 0.15, side: 0.4, clear: 0.12, near: 0.06 },
    act: { nibble: true, t: 3, word: 'nibbling' }, alert: { pose: 1 }, rest: null },
  lepus_californicus: { short: 'jackrabbit', common: 'black-tailed jackrabbit', model: 'jackrabbit', rig: 'rodent',
    walk: 1.2, run: 14, back: 0.6, ramp: 1.5, accel: 4, stop: 6, turn: 3, jumpH: 0.6, jumpL: 2.2, step: 0.2, wade: 0.07,
    half: 0.2, rad: 0.09, shoulder: 0.3,
    bound: v => Math.min(6, 0.35 + 0.28 * v), lift: v => 0.035 + 0.02 * v, rock: 0.14,
    cam: { back: 1.5, up: 0.5, look: 1.2, aimUp: 0.25, side: 0.4, clear: 0.15, near: 0.08 },
    act: { flick: 0.9, nibble: true, t: 3, word: 'feeding' }, alert: { pose: 1 }, rest: 'hunch' },
  microtus_californicus: { short: 'vole', common: 'California vole', model: 'vole', rig: 'rodent',
    walk: 0.4, run: 1.6, back: 0.3, ramp: 0.6, accel: 8, stop: 12, turn: 4, jumpH: 0.05, jumpL: 0.12, step: 0.04, wade: 0.01,
    half: 0.05, rad: 0.025, shoulder: 0.04,
    bound: () => 0.09, lift: () => 0.004, rock: 0,
    cam: { back: 0.2, up: 0.07, look: 0.25, aimUp: 0.03, side: 0.35, clear: 0.035, near: 0.02 },
    act: { nibble: true, t: 2.5, word: 'clipping grass' }, alert: { pose: 1 }, rest: null },
  otospermophilus_beecheyi: { short: 'groundsquirrel', common: 'California ground squirrel', model: 'ground-squirrel', rig: 'rodent',
    walk: 0.5, run: 4.5, back: 0.4, ramp: 0.8, accel: 6, stop: 9, turn: 3.5, jumpH: 0.15, jumpL: 0.35, step: 0.1, wade: 0.02,
    half: 0.1, rad: 0.05, shoulder: 0.09,
    bound: v => v > 2 ? 0.32 : 0.16, lift: v => v > 2 ? 0.025 : 0.01, rock: 0.1,
    cam: { back: 0.6, up: 0.18, look: 0.5, aimUp: 0.08, side: 0.4, clear: 0.07, near: 0.04 },
    act: { nibble: true, t: 3, word: 'picking seeds' }, alert: { pose: 1 }, rest: null },
  sceloporus_occidentalis: { short: 'lizard', common: 'western fence lizard', model: 'lizard', rig: 'lizard',
    walk: 0.6, run: 2.5, back: 0.3, ramp: 0.4, accel: 10, stop: 14, turn: 4, jumpH: 0.05, jumpL: 0.15, step: 1.2, wade: 0.01,
    half: 0.04, rad: 0.02, shoulder: 0.025,
    cam: { back: 0.3, up: 0.09, look: 0.3, aimUp: 0.02, side: 0.35, clear: 0.035, near: 0.02 },
    act: { headFlick: true, t: 0.8, word: 'watching' }, alert: { pushups: true }, rest: 'bask' },
  meleagris_gallopavo: { short: 'turkey', common: 'wild turkey', model: 'turkey', rig: 'bird',
    walk: 0.7, run: 6, back: 0.4, ramp: 2, accel: 3, stop: 5, turn: 2.2, jumpH: 0.25, jumpL: 0.4, step: 0.3, wade: 0.15,
    half: 0.3, rad: 0.15, shoulder: 0.6, stride: 0.55,
    flush: { from: 2.5, v: 9, T: 3.2, peak: 3.5, beat: 5, up: 0.6 },
    cam: { back: 2.6, up: 1.2, look: 2, aimUp: 0.6, side: 0.35, clear: 0.3, near: 0.15 },
    act: { peck: true, scratch: true, t: 1.6, word: 'pecking' }, alert: { flick: -0.4 }, rest: null },
  callipepla_californica: { short: 'quail', common: 'California quail', model: 'quail', rig: 'bird',
    walk: 0.8, run: 4.5, back: 0.4, ramp: 0.8, accel: 6, stop: 9, turn: 4, jumpH: 0.12, jumpL: 0.25, step: 0.12, wade: 0.03,
    half: 0.1, rad: 0.06, shoulder: 0.15, stride: 0.14,
    flush: { from: 2, v: 13, T: 2.4, peak: 3, beat: 19, up: 0.5 },
    cam: { back: 0.9, up: 0.35, look: 0.8, aimUp: 0.12, side: 0.4, clear: 0.1, near: 0.05 },
    act: { peck: true, t: 1, word: 'pecking' }, alert: { flick: -0.4 }, rest: null },
};

export class GroundControl {
  constructor({ tile, scene, camera, flight, veg, animals, atmosphere, squirrel }) {
    Object.assign(this, { tile, scene, camera, flight, veg, animals, atmosphere, sq: squirrel });
    this.heights = animals.heights;
    this.on = false; this.code = null; this.S = null; this.mode = 'ground';
    this.v = 0; this.vel = new THREE.Vector3(); this.holdT = 0; this.sit = 0; this.resting = false; this.actT = 0; this.pushT = 0;
    this.size = 1; this.variant = 0; this.male = 0; this.buck = null; this.modelName = null;
    this.pose = { phase: 0, amp: 0, pose: 0, flick: 0, flickV: 0, e0: 0, e1: 0, e2: 0, e3: 0, pitch: 0, roll: 0, lift: 0, fl: 0, bend: 0 };
    this.jumpQ = false; this.actQ = false; this.restQ = false; this.wet = null; this.told = 0; this.fl = null;
    this.camOff = new THREE.Vector3(); this.aimOff = new THREE.Vector3(); this.camSettled = false; this.camSide = 0.4; this.camLift = 0;
    this.marks = new HerdMarks({ el: document.getElementById('herdMarks'), camera, animals });   // off-screen herd members (herdMarks.js)
    this.sil = new HerdSilhouette({ scene, animals, atmosphere });   // hidden herd members as luminous silhouettes (herdSilhouette.js)
    this.last = new THREE.Vector3(); this.N = new THREE.Vector3(0, 1, 0);
    this.meshes = new Map();   // model name -> Promise of { mesh, model, rig }
    this._t = { x: 0, y: 0, z: 0, r: 0 }; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._qt = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._x = new THREE.Vector3(); this._f = new THREE.Vector3(); this._mb = new THREE.Matrix4();
    this.toast = document.createElement('div'); this.toast.id = 'gcToast';
    this.toast.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:6;padding:6px 12px;border-radius:7px;'
      + 'background:#0f1512d8;border:1px solid #263128;color:#e6ede7;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
      + 'pointer-events:none;opacity:0;transition:opacity .3s;white-space:nowrap;max-width:calc(100vw - 32px);overflow:hidden;text-overflow:ellipsis';
    document.body.appendChild(this.toast);
    const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    addEventListener('keydown', e => {
      if (!this.on || typing(e) || e.metaKey || e.ctrlKey) return;
      if (e.code === 'Space') { this.jumpQ = true; e.preventDefault(); }
      if (e.code === 'KeyE' && !e.repeat) this.actQ = true;
      if (e.code === 'KeyX' && !e.repeat) this.restQ = true;
    });
  }

  // ---- model ---------------------------------------------------------------------------------------
  // One instance of the AI's model (animals.playerModel: the drawn lod0, else the procedural model), built once per model.
  meshFor(name) {
    let p = this.meshes.get(name);
    if (!p) {
      p = this.animals.playerModel(name).then(({ model, geometry }) => {
        const geo = geometry.clone(), rig = hasAnim2(model);
        geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
        if (rig) geo.setAttribute('aAnim2', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
        if (model.skin) geo.setAttribute('aClip', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));   // the skinned deer: clip, phase, blend
        const mesh = new THREE.InstancedMesh(geo, animalMaterial(this.atmosphere, model, { map: model.maps?.[0] || null, head: this.flight.headYaw }), 1);   // head: the look (flight.js)
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true; mesh.name = `player ${name}`;
        mesh.customDepthMaterial = animalDepthMaterial(model);
        mesh.visible = false; this.scene.add(mesh);
        addCaster(mesh, { cascades: [0], simple: false });   // follows the mesh's visibility
        return { mesh, model, rig };
      }).catch(e => { console.warn(`groundControl: no player model for ${name}`, e); return null; });
      this.meshes.set(name, p);
    }
    return p;
  }
  // The species (GROUND key) and model this body uses; the mesh comes in when it has loaded.
  useSpecies(code, modelName = null) {
    const S = GROUND[code]; if (!S) return false;
    this.code = code; this.S = S; this.modelName = modelName || S.model; this.body = null;
    { const A = this.animals; if (A && !A.preySlots) A.buildHunts?.(); const k = A ? A.speciesList().findIndex(sp => sp.code === code) : -1;
      if (this.needs) this.needs.hunter = !!(k >= 0 && A.preySlots?.[k]); }   // a hunter's hunger drains until a catch (needs.js)
    const want = this.modelName;
    for (const [n, p] of this.meshes) if (n !== want) p.then(b => { if (b) b.mesh.visible = false; });
    this.meshFor(want).then(b => { if (this.modelName !== want) return; this.body = b; if (b) b.mesh.visible = this.on; });
    return true;
  }

  // ---- on and off ---------------------------------------------------------------------------------
  // On as `code` (a GROUND key; enterAt sets it from the animal entered), or off (back to the spirit, which places itself).
  setOn(on, code = null) {
    on = !!on;
    if (on && code && code !== this.code) this.useSpecies(code);
    if (on && !this.S) this.useSpecies('odocoileus_hemionus');
    if (on === this.on) return;
    this.on = on;
    const f = this.flight;
    f.body.visible = !on && f.view === 'chase';
    if (this.body) this.body.mesh.visible = on;
    if (!on) for (const p of this.meshes.values()) p.then(b => { if (b) b.mesh.visible = false; });
    if (!on && this.herd) { this.animals.pilot(this.herd.g, null); this.herd = null; }   // the group goes on with its own life
    if (!on) this.animals?.setStalk?.(1);
    if (!on) { this.marks.clear(); this.sil.clear(); }
    if (this.hudRow) this.hudRow.style.display = on ? '' : 'none';
    f.look = 0; f.headYaw.value = 0; f.lookMax = on ? (this.S.rig === 'quad' ? 1.0 : this.S.rig === 'bird' ? 1.3 : 1.2) : 0;   // how far this body's head turns before the body follows a drag
    if (on) { f.pitch = 0; f.roll = 0; f.hover = false; this.camSettled = false; this.place(f.pos.x, f.pos.z); }
    else {
      this.camera.up.set(0, 1, 0); f.reset(f.pos.x, f.pos.z, 30);
      this.mode = 'ground'; this.fl = null; this.resting = false; this.jumpQ = this.actQ = this.restQ = false;
    }
    if (on) this.nearWas = this.camera.near;
    this.camera.near = on ? this.S.cam.near : this.nearWas || 0.5; this.camera.updateProjectionMatrix();
    this.hud(on);
  }

  // The HUD's words for the species (the originals come back on setOn(false)).
  hud(on) {
    const $ = id => document.getElementById(id), h1 = $('hud')?.querySelector('h1'), help = $('help'), S = this.S;
    if (!this.hudWas) this.hudWas = {
      h1: h1?.firstChild?.nodeValue, help: help?.innerHTML,
      agl: $('agl')?.previousElementSibling?.textContent, speed: $('speed')?.previousElementSibling?.textContent,
    };
    const W = this.hudWas;
    if (h1?.firstChild) h1.firstChild.nodeValue = on ? `${this.buck ? 'black-tailed deer (buck)' : S.common} ` : W.h1;
    if (help) help.innerHTML = on ? this.helpLine() : W.help;
    const agl = $('agl')?.previousElementSibling, sp = $('speed')?.previousElementSibling;
    if (agl) agl.textContent = on ? 'height above ground' : W.agl;
    if (sp) sp.textContent = on ? 'speed' : W.speed;
    const hb = $('hoverBtn'); if (hb) hb.style.display = on ? 'none' : '';
  }
  helpLine() {
    const S = this.S, k = s => `<kbd>${s}</kbd>`;
    const space = S.flush ? `${k('space')} hop; from a run, flush and fly` : `${k('space')} jump`;
    const shift = S.alert.pushups ? 'push-ups' : S.alert.pose ? 'sit up' : 'alert';
    const rest = S.rest === 'bed' ? ` · ${k('X')} lie down` : S.rest === 'hunch' ? ` · ${k('X')} hunch in a form` : S.rest === 'bask' ? ` · ${k('X')} bask` : '';
    return `${k('W')}${k('S')} run, back (${k('shift')}${k('W')} walk) · ${k('A')}${k('D')} turn · ${space} · ${k('shift')} ${shift} · ${k('E')} ${S.act.word}${rest} · `
      + `${k('M')} map · ${k('G')} roads · ${k('P')} present day · ${k('T')} tags · ${k('N')} mute · ${k('B')} back to spirit form · click a tree to identify · drag mouse to turn and look`;
  }
  say(text) {
    const t = this.toast; t.textContent = text; t.style.opacity = '1';
    clearTimeout(this.toastT); this.toastT = setTimeout(() => { t.style.opacity = '0'; }, 2200);
  }

  // ---- placing -------------------------------------------------------------------------------------
  // On the ground at (x, z), facing the way it faced (a switch, R, Go to).
  place(x, z) {
    const P = this.flight.pos, F = this.sq.footing(x, z, this.heights.atXZ(x, z) + 50);
    P.set(x, F.surf !== null ? F.bed : F.y, z); this.setWet(F);
    this.mode = 'ground'; this.v = 0; this.vel.set(0, 0, 0); this.fl = null; this.holdT = 0;
    this.last.copy(P); this.camSettled = false;
  }
  // The spirit (spirit.js) comes into an AI animal (animals.js info o): the player carries on as it was, where it was:
  // its size, colour, antlers, pose and stride; on the ground, or falling from a limb (a fox or a lion up an oak, a
  // turkey in its roost), or in a quail's or turkey's flush (it glides on down).
  enterAt(o) {
    const f = this.flight, a = this.animals.held?.get(o.id) || this.animals.byId?.get(o.id) || null;
    const buck = a && this.animals.meshes?.[a.sp]?.name === 'buck';
    this.useSpecies(o.code, buck ? 'buck' : null);
    this.size = a?.size ?? 1; this.variant = a?.variant ?? 0; this.male = a?.male ?? 0;
    this.buck = buck ? { u1: a.u1, u2: a.u2, u3: a.u3, young: a.young || 0 } : null;
    const ps = this.pose, S = this.S;
    ps.phase = a?.phase ?? 0; ps.amp = a?.amp ?? 0; ps.pose = a?.pose ?? 0; ps.flick = a?.flick ?? 0; ps.flickV = 0;
    ps.e0 = a?.e0 ?? 0; ps.e1 = a?.e1 ?? 0; ps.e2 = a?.e2 ?? 0; ps.e3 = a?.e3 ?? 0; ps.pitch = 0; ps.roll = 0; ps.lift = 0;
    f.yaw = o.yaw; f.pitch = 0; f.roll = 0;
    this.place(o.x, o.z);
    this.resting = S.rig === 'quad' ? ps.pose > 0.5 * (this.modelPoseMax() || 1) : S.rest === 'hunch' ? ps.pose < -0.3 : false;
    const g = f.pos.y;
    if (o.where === 'air' && S.flush) {   // mid-flush: the rest of the flight, gliding down
      f.pos.y = Math.max(o.y, g + 0.3);
      this.fl = { u: 0.5, T: S.flush.T, y0: f.pos.y + (f.pos.y - g), peak: 0, v: S.flush.v * 0.8, more: 0 }; this.mode = 'fly';
    } else if (o.y > g + 0.4) {   // up a tree: down to the ground
      f.pos.y = o.y; this.vel.set(0, 0.5, 0); this.mode = 'air';
    }
    this.v = Math.min(S.run, o.speed || 0);
    this.camSettled = false; this.last.copy(f.pos);
    this.herd = a?.group && HERD_WORD[o.code.split(':')[0]] ? { g: a.group, a, word: HERD_WORD[o.code.split(':')[0]] } : null;   // the herd pilot (herdDrive)
    this.idleT = 0; this.auto = false;
    this.hud(this.on);
  }
  // Where the player leaves this animal (spirit.js), for the AI to carry on from (animals.js release): as info.
  leaveInfo() {
    const P = this.flight.pos, air = this.mode === 'fly' || this.mode === 'air';
    return { x: P.x, y: air ? P.y : P.y, z: P.z, yaw: this.flight.yaw, where: air ? 'air' : 'ground', tree: null, face: 0, h: 0,
      speed: Math.abs(this.v), pose: this.pose.pose, resting: this.resting };
  }
  modelPoseMax() { return this.body?.model?.poseMax || 1; }

  // ---- the frame -----------------------------------------------------------------------------------
  input() {
    const k = this.flight.keys;
    return {
      fwd: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      turn: (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0),
      shift: k.has('ShiftLeft') || k.has('ShiftRight'),
    };
  }
  update(dt) {
    const f = this.flight, P = f.pos, S = this.S;
    f.body.visible = false; f.flap = 0; f.flapping = false; f.hover = false;   // the raven's keys still land in flight; ignore them
    if (P.distanceToSquared(this.last) > 20 * 20) this.place(P.x, P.z);       // moved from outside (R, Go to): onto the ground there
    f.pitch = clamp(f.pitch, -0.6, 0.7);
    const k = this.herdDrive(dt, this.input(), this.jumpQ || this.actQ || this.restQ), jump = this.jumpQ, act = this.actQ, rest = this.restQ;
    this.jumpQ = this.actQ = this.restQ = false;
    if (this.mode === 'air') this.air(dt);
    else if (this.mode === 'fly') this.fly(dt, k, jump);
    else this.ground(dt, k, jump, act, rest);
    if (this.mode === 'ground') this.trunkPush(P);
    this.draw(dt);
    this.updateCamera(dt);
    if (this.herd) { this.marks.update(this.herd.g, this.herd.a, (S.shoulder || 0.3) * 0.5); this.sil.update(this.herd.g, this.herd.a, this.body?.mesh || null); } else { if (this.marks.marks.size) this.marks.clear(); this.sil.clear(); }
    this.last.copy(P);
    const ground = Math.max(this.heights.atXZ(P.x, P.z), this.wet ? this.wet.surf : -Infinity);
    const speed = this.mode === 'fly' ? this.fl.v : this.mode === 'air' ? Math.hypot(this.vel.x, this.vel.z) : Math.abs(this.v);
    f.speed = speed;
    this.hudLine(ground);
    return { hover: false, agl: P.y - ground, elev: P.y, speed, heading: ((f.yaw * -180 / Math.PI) % 360 + 360) % 360 };
  }

  ground(dt, k, jump, act, rest) {
    const f = this.flight, P = f.pos, S = this.S, ps = this.pose;
    if (rest) {
      if (!S.rest) this.say(`a ${S.common} does not lie down here`);
      else this.resting = !this.resting;
    }
    if (k.fwd || jump) this.resting = false;
    const still = !k.fwd && Math.abs(this.v) < 0.6;
    const alert = k.shift && still && !this.resting;
    this.sit = damp(this.sit, alert ? 1 : 0, alert ? 4 : 8, dt);
    if (this.needs?.hunter && this.animals?.setStalk) {   // a hunter's stalk: still 0.4, creeping 0.55, walking 1, running 1.3 (animals.js setStalk)
      const v = Math.abs(this.v); this.animals.setStalk(this.sit > 0.5 ? 0.4 : v < 0.9 ? 0.55 : v < 2.4 ? 1 : 1.3);
    }
    if (act) { this.actT = S.act.t; this.resting = false; if (S.act.headFlick) ps.fl = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6); if (S.act.scratch) this.scratch = Math.random() < 0.4; }
    if (act && this.animals?.catchNear) {   // a hunter's E within reach of its prey: the catch (animals.js kill, CARRION)
      const c = this.animals.catchNear(P.x, P.y, P.z);
      if (c) { this.needs?.fed?.(); this.say(`caught a ${this.animals.speciesList()[c.sp]?.one || 'prey'}`); }
      else { const k = this.animals.feedNear?.(P.x, P.y, P.z); if (k && this.fedAt !== k) { this.fedAt = k; this.needs?.fed?.(); this.say(`fed at the ${this.animals.speciesList()[k.sp]?.one || 'carcass'}`); } }   // a scavenger at carrion
    }
    if (k.fwd || Math.abs(this.v) > 0.5) this.actT = 0;
    this.actT = Math.max(0, this.actT - dt);
    // speed: W from a walk to the run over `ramp` s (Shift + W: a walk, the lion's stalk), S back; wading slows it
    this.holdT = k.fwd > 0 ? this.holdT + dt : 0;
    const runK = k.shift ? 0 : smooth(Math.min(1, this.holdT / S.ramp));
    let target = k.fwd > 0 ? (k.shift && S.stalk ? S.stalk : S.walk + (S.run - S.walk) * runK) : k.fwd < 0 ? -S.back : 0;
    if (this.resting) target = 0;
    if (this.wet) target *= 1 - 0.6 * Math.min(1, this.wet.depth / S.wade);
    target *= this.needs?.slow ?? 1;   // hungry or thirsty: slower (needs.js)
    this.v = damp(this.v, target, Math.abs(target) < Math.abs(this.v) ? S.stop : S.accel, dt);
    if (Math.abs(this.v) < 0.01 && !target) this.v = 0;
    if (!this.resting) f.yaw += k.turn * S.turn * (1 - 0.45 * Math.min(1, Math.abs(this.v) / S.run)) * dt;
    if (k.fwd || k.turn) f.settleLook(dt);   // moving: the body turns into the look
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    if (jump) {
      if (S.flush && this.v >= S.flush.from) return this.startFlush();
      const up = Math.sqrt(2 * G * S.jumpH), T = 2 * up / G, fw = Math.max(Math.abs(this.v) < 0.3 ? 0 : S.jumpL / T, this.v * 1.05);
      this.vel.set(fx * fw, up, fz * fw); this.mode = 'air'; this.sit = 0; return;
    }
    // the step: water too deep stops it (unless it is no deeper than where it stands: back out), a rock face is a wall
    const nx = P.x + fx * this.v * dt, nz = P.z + fz * this.v * dt;
    const F = this.sq.footing(nx, nz, P.y + S.step + 0.1), deep = F.depth > S.wade && F.depth > (this.wet?.depth ?? 0) + 1e-3;
    if (deep) {
      this.v = 0;
      const now = performance.now(); if (now > this.told) { this.told = now + 6000; this.say(`too deep for a ${S.common}`); }
    } else if (F.bed - P.y > S.step) this.v = 0;
    else {
      P.x = clamp(nx, 5, this.tile.size - 5); P.z = clamp(nz, -this.tile.size + 5, -5);
      const y = F.surf !== null ? F.bed : F.y;
      if (y < P.y - Math.max(0.35, S.step * 1.5)) { this.vel.set(fx * this.v, 0, fz * this.v); this.mode = 'air'; }   // off a rock's edge
      else { P.y = y; this.setWet(F); }
    }
    this.animate(dt, Math.abs(this.v), alert);
  }
  setWet(F) {
    if (F.surf === null || F.depth <= 0.005) { this.wet = null; return; }
    const w = this.wet ??= { surf: 0, depth: 0 }; w.surf = F.surf; w.depth = F.depth;
  }

  // A jump (or a fall off a rock): ballistic, landing on whatever is under it.
  air(dt) {
    const f = this.flight, P = f.pos, V = this.vel, S = this.S;
    V.y -= G * dt;
    const nx = P.x + V.x * dt, nz = P.z + V.z * dt, ny = P.y + V.y * dt;
    const s = this.sq.surface(nx, nz, Math.max(P.y, ny) + 0.05);
    if (s - ny > S.step + 0.15 && s > P.y) { V.x *= -0.2; V.z *= -0.2; }   // the side of a rock: drop back
    else { P.x = clamp(nx, 5, this.tile.size - 5); P.z = clamp(nz, -this.tile.size + 5, -5); }
    P.y = ny;
    const F = this.sq.footing(P.x, P.z, P.y + 0.05), y = F.surf !== null ? F.bed : F.y;
    if (P.y <= y && V.y <= 0) { P.y = y; this.mode = 'ground'; this.v = Math.hypot(V.x, V.z) * 0.85; this.setWet(F); }
    this.animate(dt, Math.hypot(V.x, V.z), false, true);
  }

  // The flush (turkey, quail): up steeply on whirring wings, a long flat glide down on bowed ones, a few beats to land.
  startFlush() {
    const P = this.flight.pos, S = this.S;
    this.fl = { u: 0, T: S.flush.T, y0: P.y, peak: S.flush.peak, v: S.flush.v, more: 0 };
    this.mode = 'fly'; this.resting = false; this.sit = 0;
  }
  fly(dt, k, again) {
    const f = this.flight, P = f.pos, S = this.S, ps = this.pose, L = this.fl;
    if (again && L.more < 3 && L.u > 0.3) { L.more++; L.u = Math.max(0.3, L.u - 0.3); L.y0 = P.y; L.peak = 1; }   // a few more beats
    L.u = Math.min(1, L.u + dt / L.T);
    f.yaw += k.turn * S.turn * 0.5 * dt;
    const u = L.u, oy = P.y, fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    P.x = clamp(P.x + fx * L.v * dt, 5, this.tile.size - 5); P.z = clamp(P.z + fz * L.v * dt, -this.tile.size + 5, -5);
    const F = this.sq.footing(P.x, P.z, P.y + 1), g = F.surf !== null ? Math.max(F.bed, F.surf) : F.y;
    const rise = u < 0.25 ? Math.sin(u / 0.25 * Math.PI / 2) : 1 - Math.pow((u - 0.25) / 0.75, 2.2);
    P.y = Math.max(g + 0.15 * (1 - u), L.y0 + (g - L.y0) * u + L.peak * rise);
    if (u >= 1) {
      if (F.depth > S.wade) { L.u = 0.85; L.y0 = P.y; L.peak = 0.3; }   // over water: glide on
      else { P.y = F.surf !== null ? F.bed : F.y; this.setWet(F); this.mode = 'ground'; this.v = Math.min(S.run, L.v * 0.3); this.fl = null; }
    }
    const whirr = u < S.flush.up || u > 0.93, glide = !whirr;
    ps.amp = damp(ps.amp, whirr ? 1 : 0, 25, dt); ps.pose = damp(ps.pose, this.mode === 'fly' ? 0 : 1, 20, dt);
    if (whirr) ps.phase += dt * TAU * S.flush.beat; else ps.phase = damp(ps.phase, Math.round(ps.phase / TAU) * TAU + 0.6, 8, dt);
    ps.e0 = damp(ps.e0, glide ? 1 : 0, 6, dt); ps.e1 = damp(ps.e1, u > 0.85 ? 1 : 0.4, 8, dt);
    ps.pitch = -Math.atan2((P.y - oy) / Math.max(dt, 1e-3), L.v) * 0.6; ps.roll = damp(ps.roll, -k.turn * 0.4, 4, dt); ps.lift = 0; ps.flick = damp(ps.flick, 0, 6, dt);
  }

  // The rig's channels from the controller's state (as the AI's update functions drive them for this species).
  animate(dt, sp, alert, inAir = false) {
    const S = this.S, ps = this.pose, f = this.flight, P = f.pos, act = this.actT > 0;
    this.spd = sp; this.inAir = inAir;   // for the skinned deer's clip choice (draw)
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), h = S.half * this.size;
    const hf = this.heights.atXZ(P.x + fx * h, P.z + fz * h), hb = this.heights.atXZ(P.x - fx * h, P.z - fz * h);
    const slope = -Math.atan2(hf - hb, 2 * h);   // nose down positive (the animals' pitch), as the ground runs
    ps.lift = 0; ps.roll = damp(ps.roll, 0, 8, dt);
    if (S.rig === 'quad') {
      const pmax = this.modelPoseMax();
      ps.amp = damp(ps.amp, inAir ? 1.25 : sp < 0.05 ? 0 : sp < S.trot * 0.75 ? 0.75 : sp < S.trot * 1.4 ? 1 : 1.25, 5, dt);
      ps.e3 = damp(ps.e3, inAir || sp > S.trot * 1.4 ? 1 : 0, 4, dt);
      ps.phase += dt * TAU * sp / (S.stride * this.size * (0.8 + 0.25 * sp));
      const stalk = S.stalk && this.input().shift && sp > 0.05;
      ps.pose = damp(ps.pose, this.resting ? pmax : stalk ? 0.45 * pmax / 0.6 : 0, this.resting ? 0.9 : 2, dt);
      ps.flick = damp(ps.flick, act ? S.act.flick : alert ? S.alert.flick : stalk ? 0.25 : 0, 3, dt);
      if (act && S.act.dig) { ps.pose = damp(ps.pose, 0.3 * pmax, 3, dt); ps.flick += 0.1 * Math.sin(performance.now() * 0.013); }   // a dig: shoulders down, the head working
      if (this.code === 'puma_concolor') ps.e1 = damp(ps.e1, (stalk || this.resting ? 0.7 : 0.15) * Math.sin(performance.now() * 0.0033) * (Math.sin(performance.now() * 0.0006) > 0.1 ? 1 : 0.15), 8, dt);
      if (this.buck) { const st = antlerState(this.animals.month ?? 10.5, this.buck.u1, this.buck.u2, this.buck.u3); ps.e0 = st.growth; ps.e1 = st.velvet; ps.e2 = this.buck.young; }
      if (!inAir) ps.pitch = damp(ps.pitch, slope * 0.8, 6, dt);
      else ps.pitch = damp(ps.pitch, -Math.atan2(this.vel.y, Math.max(1, Math.hypot(this.vel.x, this.vel.z))) * 0.5, 8, dt);
    } else if (S.rig === 'rodent') {
      ps.amp = damp(ps.amp, inAir ? 0.3 : sp > 0.05 ? (this.code === 'lepus_californicus' ? (sp < 2 ? 0.7 : sp < 7 ? 1 : 1.15) : 1) : 0, 10, dt);
      ps.phase += dt * TAU * (inAir ? 2 : sp / S.bound(Math.max(sp, 0.5)));
      const rest = this.resting && S.rest === 'hunch' ? -0.6 : 0;
      ps.pose = damp(ps.pose, alert ? S.alert.pose : rest, alert ? 5 : 4, dt);
      if (act && S.act.nibble && Math.random() < dt * 1.5) ps.flickV = 0.8;
      if (ps.flickV > 0) { ps.flick = Math.max(ps.flick, Math.sin(Math.min(1, 1 - ps.flickV) * Math.PI)); ps.flickV -= dt * 3; }
      else ps.flick = damp(ps.flick, act && S.act.flick ? S.act.flick : 0, act ? 6 : 2, dt);
      ps.lift = !inAir && sp > 0.05 ? S.lift(sp) * Math.max(0, Math.sin(ps.phase)) : 0;
      ps.pitch = damp(ps.pitch, inAir ? 0 : (sp > 0.05 ? -S.rock * Math.cos(ps.phase) * Math.min(1, sp / 4 + 0.4) : 0) + slope * (1 - Math.max(0, ps.pose)) * 0.8, 12, dt);
      ps.e0 = 0; ps.e1 = damp(ps.e1, ps.flick, 5, dt);
    } else if (S.rig === 'bird') {
      const turkey = this.code === 'meleagris_gallopavo', scratching = act && turkey && this.scratch;
      ps.pose = damp(ps.pose, 1, 10, dt);
      if (scratching) { ps.phase += dt * TAU * 2.4; ps.amp = damp(ps.amp, 0.8, 10, dt); }
      else { ps.amp = damp(ps.amp, sp > 0.1 ? (turkey ? Math.min(1, 0.45 + sp * 0.6) : 1) : 0, turkey ? 6 : 12, dt); ps.phase += dt * TAU * sp / S.stride; }
      if (act && S.act.peck && !scratching && Math.random() < dt * 2) ps.flickV = 1;
      if (ps.flickV > 0) { ps.flick = Math.max(ps.flick, Math.sin(Math.min(1, 1 - ps.flickV) * Math.PI)); ps.flickV -= dt * 3; }
      else ps.flick = damp(ps.flick, alert ? S.alert.flick : 0, 4, dt);
      ps.e0 = damp(ps.e0, 0, 6, dt); ps.e1 = damp(ps.e1, 0, 6, dt); ps.e3 = this.variant;
      ps.pitch = damp(ps.pitch, inAir ? 0 : slope * 0.5, 6, dt);
    } else {   // lizard: the dash, the bend into a turn, the tail whip, push-ups, the flat bask
      const k = this.input();
      ps.amp = damp(ps.amp, sp > 0.05 ? Math.min(1, sp / S.run + 0.3) : 0, 20, dt);
      ps.phase += dt * TAU * Math.min(12, sp / 0.1);
      this.pushT = alert ? this.pushT + dt : 0;
      const push = alert ? 0.5 - 0.5 * Math.cos(TAU * this.pushT * 2) : 0;
      if (alert) ps.pose = push; else ps.pose = damp(ps.pose, this.resting ? -0.95 : 0, 4, dt);
      ps.fl *= Math.exp(-1.5 * dt); ps.flick = damp(ps.flick, ps.fl, 12, dt);
      ps.bend = damp(ps.bend, k.turn && sp < 1.2 ? k.turn * 0.8 : 0, 10, dt);
      ps.e0 = ps.bend; ps.e1 = damp(ps.e1, sp > 1.5 ? Math.sin(ps.phase * 0.5) : alert ? 0.3 * Math.sin(this.pushT * 9) : 0, 10, dt);
      ps.e2 = 0; ps.e3 = this.male;
    }
  }

  // Keep the body out of the drawn trunks of the near set (the squirrel controller's tree index, animals.js trunkAt).
  trunkPush(P) {
    const sq = this.sq; sq.indexTrees();
    const R = this.S.rad * this.size, h = clamp(this.S.shoulder * 0.6, 0.05, 0.8), t = this._t;
    const ci = Math.floor(P.x / 10), cj = Math.floor(P.z / 10);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      for (const tr of sq.trees.get(`${i},${j}`) || []) {
        trunkAt(tr, h, t);
        const dx = P.x - t.x, dz = P.z - t.z, d = Math.hypot(dx, dz), min = t.r + R;
        if (d < min && d > 1e-4) { P.x = t.x + dx / d * min; P.z = t.z + dz / d * min; }
      }
    }
  }

  // ---- drawing -------------------------------------------------------------------------------------
  draw(dt) {
    const b = this.body; if (!b) return;
    const m = b.mesh, ps = this.pose, P = this.flight.pos, S = this.S;
    m.visible = true;
    const yawA = this.flight.yaw + Math.PI;
    if (S.rig === 'lizard' && this.mode === 'ground') {   // flat on the ground it stands on (a rock top, the slope)
      const sq = this.sq, d = 0.06, top = P.y + 0.3;
      const nx = sq.surface(P.x - d, P.z, top) - sq.surface(P.x + d, P.z, top), nz = sq.surface(P.x, P.z - d, top) - sq.surface(P.x, P.z + d, top);
      const N = this._v.set(nx, 2 * d, nz).normalize();
      this.N.lerp(N, 1 - Math.exp(-dt * 12)).normalize();
      const F = this._f.set(Math.sin(yawA), 0, Math.cos(yawA)); F.addScaledVector(this.N, -F.dot(this.N)).normalize();
      this._mb.makeBasis(this._x.crossVectors(this.N, F), this.N, F); this._qt.setFromRotationMatrix(this._mb);
    } else { this._e.set(ps.pitch, yawA, ps.roll, 'YXZ'); this._qt.setFromEuler(this._e); }
    if (this.qFresh) this._q.slerp(this._qt, 1 - Math.exp(-dt * 20)); else { this._q.copy(this._qt); this.qFresh = true; }
    const drop = (S.rig === 'quad' || this.code === 'otospermophilus_beecheyi') ? (b.model.drop || 0) * Math.max(0, ps.pose) * this.size : 0;
    this._p.set(P.x, P.y + ps.lift - drop, P.z); this._s.setScalar(this.size);
    this._m.compose(this._p, this._q, this._s);
    this._m.toArray(m.instanceMatrix.array, 0); m.instanceMatrix.needsUpdate = true;
    const an = m.geometry.attributes.aAnim; an.array[0] = ps.phase % TAU; an.array[1] = ps.amp; an.array[2] = ps.pose; an.array[3] = ps.flick; an.needsUpdate = true;
    if (b.rig) { const a2 = m.geometry.attributes.aAnim2; a2.array[0] = ps.e0; a2.array[1] = ps.e1; a2.array[2] = ps.e2; a2.array[3] = ps.e3; a2.needsUpdate = true; }
    if (b.model.skin) {   // the skinned deer: a jump runs the gallop in the air
      const ac = m.geometry.attributes.aClip, v = this.inAir ? Math.max(this.spd || 0, DEER_DRIVE.runAt + 0.1) : (this.spd || 0);
      driveClips(b.model.skin, DEER_DRIVE, this.cs ||= makeClipState(), v, Math.max(0, ps.pose) / (this.modelPoseMax() || 1), ps.flick, dt, ac.array, 0); ac.needsUpdate = true;
    }
    if (ps.phase > 1e4) ps.phase -= TAU * 1000;
  }

  // Chase camera, scaled to the body (S.cam): behind and above, a three-quarter view `side` off the heading on the
  // inside of the last turn (as the squirrel's), lower and nearer sitting up or lying down; the look tilted by a drag.
  // Kept over the drawn terrain round the lens, the sight line clear of a slope between, over a pond, and out of the
  // crowns (squirrelControl.js crownClear, for the taller bodies).
  updateCamera(dt) {
    const f = this.flight, P = f.pos, cam = this.camera, C = this.S.cam, off = this._v, aim = this._w;
    const rate = wrap(f.yaw - (this.camYaw ?? f.yaw)) / Math.max(dt, 1e-3); this.camYaw = f.yaw;
    if (Math.abs(rate) > 0.3) this.camSide = damp(this.camSide, -Math.sign(rate) * C.side, 1.6, dt);
    const low = this.resting ? 0.7 : 1, fly = this.mode === 'fly' ? 1.4 : 1;
    const z = f.zoom || 1, back = (C.back + CAM_PLUS.back) * (1 - 0.15 * this.sit) * fly * z, up = (C.up * CAM_RAISE + CAM_PLUS.up) * low * (1 + 0.3 * this.sit) * fly * z, ly = f.yaw + f.look, a = ly + this.camSide;   // z: the wheel's zoom; ly: the look's yaw (flight.js)
    off.set(Math.sin(a) * back, up, Math.cos(a) * back);
    const fx = -Math.sin(ly), fz = -Math.cos(ly);
    aim.set(fx * C.look, C.aimUp * low + Math.tan(f.pitch) * (back + C.look), fz * C.look);
    if (C.up > 0.5) this.sq.crownClear(P, off);
    if (!this.camSettled) { this.camOff.copy(off); this.aimOff.copy(aim); this.camSettled = true; this.camLift = 0; }
    else { const u = 1 - Math.exp(-dt * 6); this.camOff.lerp(off, u); this.aimOff.lerp(aim, u); }
    cam.position.copy(P).add(this.camOff);
    const need = this.camClear(P, cam.position, C) - cam.position.y;
    this.camLift = need > this.camLift ? need : damp(this.camLift, need, 3, dt);
    if (this.camLift > 0) cam.position.y += this.camLift;
    cam.up.set(0, 1, 0);
    // the aim point: the smoothed aim's x and z (the three-quarter view's yaw), its height from the framing rule above
    aim.copy(P).add(this.aimOff);
    const S = this.S, bodyY = P.y + (S.shoulder || C.aimUp) * 0.5, hd = Math.hypot(P.x - cam.position.x, P.z - cam.position.z);
    const toBody = Math.atan2(bodyY - cam.position.y, Math.max(hd, 1e-3)), above = Math.atan(-FRAME_Y * Math.tan(cam.fov * Math.PI / 360));
    const ha = Math.hypot(aim.x - cam.position.x, aim.z - cam.position.z);
    aim.y = cam.position.y + Math.max(ha, 1e-3) * Math.tan(toBody + above + f.pitch);
    cam.lookAt(aim);
  }
  camClear(P, Cp, C) {
    const H = this.heights, r = Math.max(0.05, C.near * 1.6);
    let y = -Infinity;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) y = Math.max(y, H.atXZ(Cp.x + dx, Cp.z + dz) + C.clear);
    const w = this.sq.pondLevel(Cp.x, Cp.z); if (w !== null) y = Math.max(y, w + Math.max(C.clear, 0.1));
    const y0 = P.y + C.aimUp * 0.5, sight = C.clear * 0.5;
    for (const t of [0.25, 0.5, 0.75]) {
      const g = H.atXZ(P.x + (Cp.x - P.x) * t, P.z + (Cp.z - P.z) * t) + sight;
      if (g > y0) y = Math.max(y, y0 + (g - y0) / t);
    }
    return y;
  }

  // A HUD row: what the body is doing.
  // The herd pilot: see HERD_WORD above. Returns the keys to drive the body with: the player's, or, once the group has
  // taken back over, the ones that keep the body in its slot.
  herdDrive(dt, k, pressed) {
    const h = this.herd; if (!h) return k;
    const f = this.flight, P = f.pos, S = this.S, A = this.animals, g = h.g, a = h.a;
    if (k.fwd || k.turn || k.shift || pressed) { this.idleT = 0; if (this.auto) { this.auto = false; this.say(`you lead the ${h.word}`); } }
    else this.idleT += dt;
    if (!this.auto && this.idleT > HERD_IDLE) { this.auto = true; A.pilot(g, null); this.say(`the ${h.word} moves on; any key to lead it`); }
    if (!this.auto) {   // the point the group trends toward: ahead of the body
      const lead = Math.max(1, HERD_LEAD * S.half);
      A.pilot(g, P.x - Math.sin(f.yaw) * lead, P.z - Math.cos(f.yaw) * lead);
      return k;
    }
    // the group leads: the body keeps its slot (round the covey's or flock's centre; behind the herd's leader in file
    // while it walks, spread round it while it grazes)
    let tx, tz;
    const L = g.leader && g.leader !== a ? g.leader : null;
    if (g.x != null) { tx = g.x + (a.ox || 0); tz = g.z + (a.oz || 0); }
    else if (L) {
      if ((L.amp || 0) > 0.5) { const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw), back = Math.max(1, a.rank || 1) * 2.6, side = (a.ox || 0) * 0.18; tx = L.x - fx * back + fz * side; tz = L.z - fz * back - fx * side; }
      else { tx = L.x + (a.ox || 0); tz = L.z + (a.oz || 0); }
    } else return { fwd: 0, turn: 0, shift: false };
    const ex = tx - P.x, ez = tz - P.z, d = Math.hypot(ex, ez), dy = wrap(Math.atan2(-ex, -ez) - f.yaw);
    const go = d > (Math.abs(this.v) > 0.1 ? 0.8 : 2.5) && Math.abs(dy) < 1.2;
    return { fwd: go ? 1 : 0, turn: d > 0.5 ? Math.max(-1, Math.min(1, dy / 0.35)) : 0, shift: d < 10 };
  }
  hudLine(ground) {
    if (!this.hudRow) {
      const hud = document.getElementById('hud'); if (!hud) return;
      this.hudRow = Object.assign(document.createElement('div'), { className: 'row wide', id: 'gcWhere', innerHTML: '<span>where</span><b></b>' });
      const h1 = hud.querySelector('h1'); if (h1) h1.after(this.hudRow); else hud.prepend(this.hudRow);
    }
    const S = this.S, P = this.flight.pos, rest = { bed: 'lying down', hunch: 'hunched in a form', bask: 'basking' }[S.rest];
    let text;
    if (this.mode === 'fly') text = `flying, ${Math.max(0, Math.round(P.y - ground))} m up`;
    else if (this.mode === 'air') text = 'in the air';
    else if (this.resting) text = rest;
    else if (this.wet) text = `wading, ${Math.round(this.wet.depth * 100)} cm deep`;
    else if (this.actT > 0) text = S.act.word;
    else if (this.sit > 0.5) text = S.alert.pushups ? 'doing push-ups' : S.alert.pose ? 'sitting up' : 'alert';
    else text = Math.abs(this.v) > (S.trot ?? S.run * 0.4) * 1.4 ? 'running' : Math.abs(this.v) > 0.05 ? 'on the move' : 'on the ground';
    if (this.herd) text += this.auto ? ` · the ${this.herd.word} leads` : ` · leading the ${this.herd.word}`;
    this.hudRow.style.display = '';
    const b = this.hudRow.lastChild; if (b.textContent !== text) b.textContent = text;
  }
}
