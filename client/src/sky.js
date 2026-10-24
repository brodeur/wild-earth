import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { uniforms as atmo } from './atmosphere.js';

// Sky dome, sun and sky light. Every colour and the exposure come from the Atmosphere, so the
// dome, the lambert trees and the custom shaders agree. There is no scene fog: aerial
// perspective is applied per material by atmosphereApply.
export class SkyDome {
  constructor(scene, renderer, atmosphere) {
    this.sky = new Sky(); this.sky.scale.setScalar(450000); scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5); scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8fb4d8, 0x5a4a30, 1); scene.add(this.hemi);
    this.renderer = renderer; this.scene = scene; this.atmosphere = atmosphere;
    scene.fog = null;
    atmosphere.attachSky(this.sky);
  }
  update(camera) {
    const a = this.atmosphere;
    this.sun.position.copy(camera.position).addScaledVector(atmo.sunDir.value, 2000); this.sun.target.position.copy(camera.position);
    this.sun.color.copy(atmo.sunColor.value); this.sun.intensity = a.sunIntensity;
    this.hemi.color.copy(atmo.ambientSky.value); this.hemi.groundColor.copy(atmo.ambientGround.value); this.hemi.intensity = 1;
    this.renderer.toneMappingExposure = a.exposure;
  }
}
