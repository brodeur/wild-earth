import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The player's raven: a rigged, skinned mesh with two clips, fly (a 1.4 s wingbeat) and glide
// (wings held out). Model: "Raven" by Teh_Bucket, OpenGameArt, CC0; exported from Blender
// with the glide pose added. The model is 4.2 m across in Blender units; a real raven spans
// about 1.3 m, so it is scaled here rather than in the file.
const MODEL_URL = new URL('../assets/raven.glb', import.meta.url);
const SCALE = 0.32;

export class Raven {
  constructor(parent, atmosphere) {
    this.group = new THREE.Group(); parent.add(this.group);   // parent carries position and attitude; this group is the model
    this.mixer = null; this.fly = null; this.glide = null; this.flapping = true;
    new GLTFLoader().load(MODEL_URL.href, gltf => {
      const model = gltf.scene;
      model.scale.setScalar(SCALE);
      model.position.y = -1.0 * SCALE;   // the body sits about a metre above the file's origin; put the body on the flight position
      model.traverse(o => {
        if (!o.isMesh) return;
        // The file's PBR material becomes a lambert one, patched to take the scene's sun, sky, cloud shadow and haze like the trees.
        const mat = new THREE.MeshLambertMaterial({ map: o.material.map, color: 0xffffff });
        atmosphere.patchLambert(mat);
        o.material = mat;
        o.frustumCulled = false;   // the skinned bounds are the rest pose; wings leave them
      });
      this.group.add(model);
      this.mixer = new THREE.AnimationMixer(model);
      const clip = n => gltf.animations.find(a => a.name === n);
      this.fly = this.mixer.clipAction(clip('fly')); this.glide = this.mixer.clipAction(clip('glide'));
      this.fly.play(); this.glide.play();
      this.glide.setEffectiveWeight(0);
    }, undefined, e => console.error('raven model failed to load', e));
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
