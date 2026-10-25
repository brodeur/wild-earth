import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addCaster } from './shadows.js';

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
const MODELS = {
  meshy: { url: new URL('../assets/raven_player.glb', import.meta.url), scale: 1, y: 0, rotY: Math.PI, tier: 'lod0', vertexColors: true },
  cc0: { url: new URL('../assets/raven.glb', import.meta.url), scale: 0.32, y: -0.32, rotY: 0, tier: null, vertexColors: false },
};
const PARAM = new URLSearchParams(location.search).get('raven');
const DEFAULT = PARAM === 'old' || PARAM === 'cc0' ? 'cc0' : 'meshy';

export class Raven {
  constructor(parent, atmosphere) {
    this.group = new THREE.Group(); parent.add(this.group);   // parent carries position and attitude; this group is the model
    this.atmosphere = atmosphere;
    this.mixer = null; this.fly = null; this.glide = null; this.flapping = true;
    this.model = null; this.kind = null; this.loaded = {};
    this.setModel(DEFAULT);
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
