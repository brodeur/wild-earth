import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addCaster } from './shadows.js';
import { loadRavenGroundMesh, animalMaterial, animalDepthMaterial, RAVEN_GROUND } from './animalModels.js';
import { FOLD_T, XFADE_T } from './flight.js';

// The player's raven: a rigged, skinned mesh with two clips, fly (a 1.4 s wingbeat) and glide
// (wings held out, a slow small flex), crossfaded on the flight model's `flapping` flag.
// Two models:
//  - 'meshy' (default): client/assets/raven_player.glb, built by tools/build_raven_player.py from a
//    Meshy text-to-3D glide preview (generated with Meshy, meshy.ai; CC BY-SA 4.0 with the project's
//    assets): true scale (0.62 m bill to tail, 1.25 m span), origin on the body at the wing roots,
//    bill toward +z, vertex colour (black with a blue-violet gloss band on the coverts), 10-bone
//    rig. The file holds three skinned tiers (lod0 2.5k, lod1 900, lod2 250 triangles); the player
//    draws lod0 only.
//  - 'cc0' (?raven=old, and the automatic fallback if the new file fails to load): client/assets/
//    raven.glb, "Raven" by Teh_Bucket, OpenGameArt, CC0; exported from Blender with the glide pose
//    added. It is 4.2 m across in Blender units, so it is scaled here, and its body sits about a
//    metre above the file's origin.
// window.__we.raven.setModel('cc0' | 'meshy') swaps them live (side-by-side checks).
// On the ground or a branch (flight.js `landed`: flown into slowly, or hover and Z down) the flying model gives way to the ground raven
// (client/assets/raven_ground.glb, the ambient ravens' standing model, lod0 with its texture; animalModels.js
// loadRavenGroundMesh), placed at the touchdown point with the same heading and its body where the flying model's was
// (the flying model's origin is its body, the ground model's its feet: RAVEN_GROUND.bodyY between them). Its folded
// wings settle on touchdown; its head follows the look (yaw up to ~65 degrees either side, pitch with the look) and
// the body follows in hops (legs together) when the look turns past that; C (the call) flicks the wings. Taking
// off swaps back. ?ravenground=proc keeps the flying model on the ground (A/B), its wings folded.
// Hopping and turning are flight.js's (flight.gnd: body heading, gait phase and amplitude, hops, the take-off's wing
// lift); this draws them: the legs swing together in a hop and alternate in a step round, the head follows the look and
// dips for a peck (E), the folded wings half lift in a forward hop.
// Spirit form (spirit.js) hides the bird: setHidden(true) keeps the flying model and the ground raven away (and their
// shadows: the casters follow visibility) while the wisp hangs from the same flight body; setHidden(false) brings back
// whichever the flight's state calls for, with no fold or dissolve (flight.cut).
// The swaps are hidden: at touchdown the flying model's wings fold over FOLD_T (the arm swept back and lowered, the
// hand swept in, the wing scaled down from the shoulder toward the folded wing's length and chord), then the ground
// model dissolves in over it (both drawn with alpha hash: the incoming one comes in fully over the first half of XFADE_T,
// the outgoing one dissolves away over the second, so the bird is never see-through) with its wings still settling.
// Taking off, the ground model's folded wings lift and open for LIFT_T (aAnim2.x up to FOLD.lift), then the flying model
// dissolves in from half folded at the top of a wingbeat (the fly clip from its start) and unfolds over UNFOLD_T.
const MODELS = {
  meshy: { url: new URL('../assets/raven_player.glb', import.meta.url), scale: 1, y: 0, rotY: Math.PI, tier: 'lod0', vertexColors: true },
  cc0: { url: new URL('../assets/raven.glb', import.meta.url), scale: 0.32, y: -0.32, rotY: 0, tier: null, vertexColors: false },
};
const Q = new URLSearchParams(location.search), PARAM = Q.get('raven');
const DEFAULT = PARAM === 'old' || PARAM === 'cc0' ? 'cc0' : 'meshy';
const GROUND = Q.get('ravenground') !== 'proc' && Q.get('animals') !== 'proc';
const HEAD_MAX = 1.1, UNFOLD_T = 0.3;
// The flying model's fold (the 'meshy' rig; bone-local: Z sweeps the wing back, X raises it; mirrored on the right)
// tilt: the body pitched nose up as the wings fold (rad at fold 1), toward the standing raven's carriage; lift: the
// ground model's wing flick (aAnim2.x) its folded wings reach before take-off
const FOLD = { armBack: 1.45, armDown: -0.12, foreBack: 0.25, handBack: 0.5, scale: 0.5, tilt: 0.3, lift: 1.6 };
const smooth = u => u * u * (3 - 2 * u), clamp01 = u => Math.min(1, Math.max(0, u));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Raven {
  constructor(parent, atmosphere) {
    this.group = new THREE.Group(); parent.add(this.group);   // parent carries position and attitude; this group is the model
    this.atmosphere = atmosphere;
    this.mixer = null; this.fly = null; this.glide = null; this.flapping = true;
    this.model = null; this.kind = null; this.loaded = {};
    this.setModel(DEFAULT);
    // the ground raven (see the header)
    this.flight = parent.userData.flight || null; this.parent = parent;
    this.ground = null; this.onGround = false;
    this.g = { e0: 0, wfV: 0, look: 0, flick: 0, hop: 0 };
    this.swapT = 0; this.fold = 0; this.fade = 0; this.foldFrom = 0; this.opFly = 1; this.FOLD = FOLD; this.hidden = false;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._up = new THREE.Vector3(0, 1, 0);
    if (GROUND && this.flight) loadRavenGroundMesh().then(m => this.buildGround(m), e => console.warn('ground raven failed to load; the flying model stays on the ground', e));
    addEventListener('keydown', e => { if (e.code === 'KeyC' && this.onGround && !(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT'))) this.g.wfV = 1; });
  }
  // One instance of the ground model's lod0 (textured), on its own copy of the geometry (the tiers are the ambient
  // ravens'), with its own shadow caster. It hangs in the scene, not from the flight body (no pitch or bank).
  buildGround(model) {
    const geo = model.tiers[0].clone();
    for (const n of ['aAnim', 'aAnim2']) { const a = new THREE.InstancedBufferAttribute(new Float32Array(4), 4); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(n, a); }
    const mesh = new THREE.InstancedMesh(geo, animalMaterial(this.atmosphere, model, { map: model.maps?.[0] || null }), 1);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 1; mesh.frustumCulled = false; mesh.visible = false; mesh.name = 'raven ground (player)';
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.material.alphaHash = true;   // the dissolve at the swaps (opacity 1 otherwise: nothing discarded)
    mesh.customDepthMaterial = animalDepthMaterial(model);
    (this.parent.parent || this.parent).add(mesh);
    addCaster(mesh, { cascades: [0] });
    this.ground = mesh; this.groundModel = model;
  }
  // Touchdown and take-off (the fold and the dissolve, see the header), then the ground model's pose from flight.gnd:
  // placed at the feet under the body on the body's heading, head turned and pitched toward the look.
  updateGround(dt) {
    const f = this.flight, mesh = this.ground;
    if (!f) return;
    if (f.cut) { f.cut = false; this.onGround = f.landed; this.swapT = 1e3; this.foldFrom = 0; }
    const on = !!f.landed, G = f.gnd;
    if (on !== this.onGround) {
      this.onGround = on; this.swapT = 0;
      if (on) { const g = this.g; g.e0 = 0.35; g.wfV = 0; g.look = 0; g.flick = 0; g.hop = 0; }   // wings still settling
      else {   // take-off: the flying model from half folded (fully, if it stayed on the ground), at the top of a wingbeat
        this.foldFrom = mesh ? 0.5 : this.fold;
        if (this.mixer) { this.fly.stopFading(); this.glide.stopFading(); this.flapping = true; this.fly.enabled = true; this.fly.time = 0; this.fly.setEffectiveWeight(1); this.fly.setEffectiveTimeScale(1); this.glide.setEffectiveWeight(0); }
      }
    }
    this.swapT += dt;
    // the flying model's fold and the ground model's share (fade)
    if (on) {
      const t = f.landT;
      this.fold = smooth(clamp01(t / FOLD_T));
      if (!mesh && G.lift >= 0) this.fold *= 1 - 0.5 * smooth(clamp01(G.lift));   // no ground model: the flying one opens a little
      this.fade = mesh ? clamp01((t - FOLD_T) / XFADE_T) : 0;
    } else {
      this.fold = this.foldFrom * (1 - smooth(clamp01(this.swapT / UNFOLD_T)));
      this.fade = mesh ? 1 - clamp01(this.swapT / XFADE_T) : 0;
    }
    // the dissolve: the incoming model fully in over the first half, the outgoing one away over the second
    const inc = on ? this.fade : 1 - this.fade, opIn = Math.min(1, 2 * inc), opOut = Math.min(1, 2 * (1 - inc));
    const opGround = on ? opIn : opOut;
    this.setFlyOpacity(on ? opOut : opIn);
    this.group.visible = this.opFly > 0;
    if (!mesh) return;
    mesh.material.opacity = opGround;
    mesh.visible = opGround > 0 && this.parent.visible;
    if (!mesh.visible) return;
    const g = this.g, amp = this.groundModel.amp;
    const head = THREE.MathUtils.clamp(wrap(f.yaw - G.yaw), -HEAD_MAX, HEAD_MAX);
    g.look += ((on ? head : 0) - g.look) * (1 - Math.exp(-dt * 10));
    const peck = G.peck > 0 ? Math.sin(Math.PI * (1 - G.peck)) * 1.7 : 0;   // E: the head dips to the ground and back
    g.flick += (THREE.MathUtils.clamp(-f.pitch / amp[2], -1.2, 1.0) + peck - g.flick) * (1 - Math.exp(-dt * (peck ? 18 : 8)));
    g.hop += ((G.hop ? 1 : 0) - g.hop) * (1 - Math.exp(-dt * 14));
    // the folded wings: lifted and opened before take-off, half lifted in a forward hop, a flick (C), settling
    if (G.lift >= 0 || !on) g.e0 = Math.max(g.e0, FOLD.lift * smooth(clamp01(on ? G.lift : 1)));
    else if (g.wfV > 0) { g.e0 = Math.max(g.e0 * Math.exp(-6 * dt), Math.sin(Math.PI * (1 - g.wfV)) * 0.9); g.wfV -= dt / 0.4; }
    else if (G.hop === 2) g.e0 = Math.max(g.e0 * Math.exp(-5 * dt), 0.55 * Math.sin(Math.PI * G.hopU));
    else g.e0 *= Math.exp(-5 * dt);
    const an = mesh.geometry.attributes.aAnim, a2 = mesh.geometry.attributes.aAnim2;
    an.array[0] = G.phase; an.array[1] = G.amp; an.array[2] = 1; an.array[3] = g.flick; an.needsUpdate = true;
    a2.array[0] = g.e0; a2.array[1] = g.look; a2.array[2] = g.hop; a2.array[3] = 0; a2.needsUpdate = true;
    // feet under the body: the flying model's origin (its body) less the ground model's body height
    this._p.set(f.pos.x, f.pos.y - RAVEN_GROUND.bodyY, f.pos.z);
    this._q.setFromAxisAngle(this._up, G.yaw + Math.PI);   // flight's forward is -z at yaw 0, the model's bill +z
    mesh.instanceMatrix.array.set(this._m.compose(this._p, this._q, this._s).elements); mesh.instanceMatrix.needsUpdate = true;
  }
  setFlyOpacity(o) {
    if (o === this.opFly) return;
    this.opFly = o;
    this.model?.traverse(m => { if (m.isMesh) m.material.opacity = o; });
  }
  // The flying model's wings folded by `this.fold` (0 open, 1 folded), on top of the clip's pose (after mixer.update).
  applyFold() {
    const u = this.fold, F = FOLD;
    this.group.rotation.x = F.tilt * u;
    const B = this.bones; if (!B) return;
    if (u > 0) this.neck.rotateX(F.tilt * u);   // the head stays level as the body tilts up
    for (const [s, ua, fa, h] of B) {
      ua.scale.setScalar(1 - (1 - F.scale) * u);
      if (u <= 0) continue;
      ua.rotateZ(s * F.armBack * u); ua.rotateX(F.armDown * u);
      fa.rotateZ(s * F.foreBack * u); h.rotateZ(s * F.handBack * u);
    }
  }
  // Load (once) and show one of MODELS; a failed 'meshy' load falls back to 'cc0'.
  setModel(kind) {
    if (!MODELS[kind]) return Promise.reject(new Error(`unknown raven model ${kind}`));
    this.want = kind;
    const ready = this.loaded[kind] || (this.loaded[kind] = this.load(kind));
    return ready.then(gltf => { if (this.want === kind) this.show(kind, gltf); return kind; }, e => {
      delete this.loaded[kind];
      if (kind === 'cc0') { console.error('raven model failed to load', e); throw e; }
      console.warn(`raven model '${kind}' failed to load, using the CC0 model`, e);
      return this.setModel('cc0');
    });
  }
  load(kind) {
    const cfg = MODELS[kind];
    return new GLTFLoader().loadAsync(cfg.url.href).then(gltf => {
      const model = gltf.scene;
      if (cfg.tier) for (const name of ['lod0', 'lod1', 'lod2']) if (name !== cfg.tier) model.getObjectByName(name)?.removeFromParent();
      model.scale.setScalar(cfg.scale);
      model.position.y = cfg.y;
      model.rotation.y = cfg.rotY;
      model.traverse(o => {
        if (!o.isMesh) return;
        // The file's PBR material becomes a lambert one, patched to take the scene's sun, sky, cloud shadow and haze like the trees.
        const mat = new THREE.MeshLambertMaterial({ map: o.material.map, color: 0xffffff, vertexColors: cfg.vertexColors && !!o.geometry.attributes.color, alphaHash: true });
        this.atmosphere.patchLambert(mat);
        o.material = mat;
        o.frustumCulled = false;   // the skinned bounds are the rest pose; wings leave them
      });
      const clip = n => {
        const c = gltf.animations.find(a => a.name === n);
        if (!c) throw new Error(`raven model '${kind}' has no '${n}' clip`);
        return c;
      };
      gltf.fly = clip('fly'); gltf.glide = clip('glide');
      return gltf;
    });
  }
  show(kind, gltf) {
    if (this.kind === kind) return;
    if (this.model) { this.mixer.stopAllAction(); this.group.remove(this.model); }
    const model = gltf.scene;
    this.group.add(model);
    this.model = model; this.kind = kind;
    this.mixer = new THREE.AnimationMixer(model);
    this.fly = this.mixer.clipAction(gltf.fly); this.glide = this.mixer.clipAction(gltf.glide);
    this.fly.play(); this.glide.play();
    this.fly.setEffectiveWeight(this.flapping ? 1 : 0); this.glide.setEffectiveWeight(this.flapping ? 0 : 1);
    const bone = n => model.getObjectByName(n);
    this.neck = bone('neck');
    this.bones = bone('upperarmL') && this.neck ? [[1, 'L'], [-1, 'R']].map(([s, d]) => [s, bone('upperarm' + d), bone('forearm' + d), bone('hand' + d)]) : null;
    const o = this.opFly; this.opFly = -1; this.setFlyOpacity(o);
    // The shadow caster mirrors the meshes under group, so it is rebuilt with them (addCaster replaces an
    // earlier registration; Shadows.sync makes the same call once the first model is in).
    addCaster(this.group, { cascades: [0], simple: true });
  }
  setHidden(h) {
    h = !!h; if (h === this.hidden) return;
    this.hidden = h;
    if (h) { this.group.visible = false; if (this.ground) this.ground.visible = false; }
    else if (this.flight) this.flight.cut = true;   // back as the flight stands now: no fold or dissolve
  }
  // flapping: whether the bird is working (climbing, boosting, a flap); speed: m/s, sets the wingbeat rate.
  update(dt, flapping, speed) {
    if (this.hidden) return;
    this.updateGround(dt);
    if (!this.mixer) return;
    if (flapping !== this.flapping) {
      this.flapping = flapping;
      const from = flapping ? this.glide : this.fly, to = flapping ? this.fly : this.glide;
      to.enabled = true; to.setEffectiveWeight(1); to.setEffectiveTimeScale(1);
      if (flapping) to.time = 0;
      from.crossFadeTo(to, flapping ? 0.25 : 0.45, false);
    }
    this.fly.setEffectiveTimeScale(0.9 + 0.3 * THREE.MathUtils.clamp((speed - 12) / 12, -1, 1));
    if (!this.group.visible) return;   // on the ground: the flying model is away
    this.mixer.update(dt);
    this.applyFold();
  }
}
