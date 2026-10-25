import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addCaster } from './shadows.js';
import { loadRavenGroundMesh, animalMaterial, animalDepthMaterial, RAVEN_GROUND } from './animalModels.js';

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
// On the ground (flight.js `landed`: hover, then Z down to the ground) the flying model gives way to the ground raven
// (client/assets/raven_ground.glb, the ambient ravens' standing model, lod0 with its texture; animalModels.js
// loadRavenGroundMesh), placed at the touchdown point with the same heading and its body where the flying model's was
// (the flying model's origin is its body, the ground model's its feet: RAVEN_GROUND.bodyY between them). Its folded
// wings settle on touchdown; its head follows the look (yaw up to ~65 degrees either side, pitch with the look) and
// the body follows in hops (legs together) when the look turns past that; C (the call) flicks the wings. Taking
// off swaps back. ?ravenground=proc keeps the flying model on the ground (A/B).
const MODELS = {
  meshy: { url: new URL('../assets/raven_player.glb', import.meta.url), scale: 1, y: 0, rotY: Math.PI, tier: 'lod0', vertexColors: true },
  cc0: { url: new URL('../assets/raven.glb', import.meta.url), scale: 0.32, y: -0.32, rotY: 0, tier: null, vertexColors: false },
};
const Q = new URLSearchParams(location.search), PARAM = Q.get('raven');
const DEFAULT = PARAM === 'old' || PARAM === 'cc0' ? 'cc0' : 'meshy';
const GROUND = Q.get('ravenground') !== 'proc' && Q.get('animals') !== 'proc';
const HEAD_MAX = 1.1, TURN_AT = 1.0, HOP_T = 0.26, TAU = Math.PI * 2;
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
    this.g = { yaw: 0, hopU: 1, hopFrom: 0, hopTo: 0, e0: 0, wfV: 0, look: 0, flick: 0, gait: 0 };
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
    mesh.customDepthMaterial = animalDepthMaterial(model);
    (this.parent.parent || this.parent).add(mesh);
    addCaster(mesh, { cascades: [0] });
    this.ground = mesh; this.groundModel = model;
  }
  // Touchdown and take-off, then the ground model's pose: placed at the feet under the body, heading the body's
  // (lagging the look and catching up in hops), head turned and pitched toward the look.
  updateGround(dt) {
    const f = this.flight, mesh = this.ground;
    const on = !!(f && mesh && f.landed);
    if (on !== this.onGround) {
      this.onGround = on;
      this.group.visible = !on;
      if (on) { const g = this.g; g.yaw = f.yaw; g.hopU = 1; g.e0 = 0.9; g.wfV = 0; g.look = 0; g.flick = 0; g.gait = 0; }   // wings settle
    }
    if (!mesh) return;
    mesh.visible = on && this.parent.visible;
    if (!mesh.visible) return;
    const g = this.g, amp = this.groundModel.amp;
    // body heading: a hop round when the look has turned past TURN_AT
    let lift = 0, hop = 0;
    if (g.hopU < 1) {
      g.hopU = Math.min(1, g.hopU + dt / HOP_T);
      const h = g.hopU, e = h * h * (3 - 2 * h);
      g.yaw = g.hopFrom + wrap(g.hopTo - g.hopFrom) * e;
      lift = 0.05 * Math.sin(Math.PI * h); hop = 1; g.gait = 1;
    } else {
      g.gait = Math.max(0, g.gait - dt * 8);
      if (Math.abs(wrap(f.yaw - g.yaw)) > TURN_AT) { g.hopU = 0; g.hopFrom = g.yaw; g.hopTo = f.yaw; }
    }
    const head = THREE.MathUtils.clamp(wrap(f.yaw - g.yaw), -HEAD_MAX, HEAD_MAX);
    g.look += (head - g.look) * (1 - Math.exp(-dt * 10));
    g.flick += (THREE.MathUtils.clamp(-f.pitch / amp[2], -1.2, 1.0) - g.flick) * (1 - Math.exp(-dt * 8));   // head pitch: the look's
    if (g.wfV > 0) { g.e0 = Math.max(g.e0 * Math.exp(-6 * dt), Math.sin(Math.PI * (1 - g.wfV)) * 0.9); g.wfV -= dt / 0.4; }
    else g.e0 *= Math.exp(-5 * dt);
    const an = mesh.geometry.attributes.aAnim, a2 = mesh.geometry.attributes.aAnim2;
    an.array[0] = (g.hopU < 1 ? g.hopU : 0) * TAU; an.array[1] = g.gait; an.array[2] = 1; an.array[3] = g.flick; an.needsUpdate = true;
    a2.array[0] = g.e0; a2.array[1] = g.look; a2.array[2] = hop || g.gait > 0 ? 1 : 0; a2.array[3] = 0; a2.needsUpdate = true;
    // feet under the body: the flying model's origin (its body) less the ground model's body height
    this._p.set(f.pos.x, f.pos.y - RAVEN_GROUND.bodyY + lift, f.pos.z);
    this._q.setFromAxisAngle(this._up, g.yaw + Math.PI);   // flight's forward is -z at yaw 0, the model's bill +z
    mesh.instanceMatrix.array.set(this._m.compose(this._p, this._q, this._s).elements); mesh.instanceMatrix.needsUpdate = true;
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
        const mat = new THREE.MeshLambertMaterial({ map: o.material.map, color: 0xffffff, vertexColors: cfg.vertexColors && !!o.geometry.attributes.color });
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
    // The shadow caster mirrors the meshes under group, so it is rebuilt with them (addCaster replaces an
    // earlier registration; Shadows.sync makes the same call once the first model is in).
    addCaster(this.group, { cascades: [0], simple: true });
  }
  // flapping: whether the bird is working (climbing, boosting, a flap); speed: m/s, sets the wingbeat rate.
  update(dt, flapping, speed) {
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
    this.mixer.update(dt);
  }
}
