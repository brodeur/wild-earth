import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class SkyDome {
  constructor(scene, renderer) {
    this.sky = new Sky(); this.sky.scale.setScalar(450000); scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5); scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8fb4d8, 0x5a4a30, 0.6); scene.add(this.hemi);
    this.renderer = renderer; this.scene = scene;
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.8; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    scene.fog = new THREE.Fog(0xbfd0e0, 1200, 7000);
  }
  update(sun, look, camera) {
    const [x, y, z] = sun.dir; const d = new THREE.Vector3(x, y, z);
    this.sky.material.uniforms.sunPosition.value.copy(d);
    this.sky.material.uniforms.turbidity.value = 4 + 4 * (look.haze ?? 1);
    this.sun.position.copy(camera.position).addScaledVector(d, 2000); this.sun.target.position.copy(camera.position);
    const el = Math.max(sun.elevation, 0), day = Math.min(1, el / 0.35);
    const warm = new THREE.Color().setHSL(0.09, 0.8, 0.6), white = new THREE.Color(1, 0.98, 0.94);
    this.sun.color.copy(warm).lerp(white, day); this.sun.intensity = 0.3 + 2.4 * day;
    this.hemi.intensity = 0.25 + 0.6 * day;
    const fogC = new THREE.Color(0.75, 0.82, 0.90).lerp(new THREE.Color(0.95, 0.70, 0.50), 1 - day).multiplyScalar(0.35 + 0.65 * day);
    this.scene.fog.color.copy(fogC);
    this.renderer.toneMappingExposure = 0.5 + 0.3 * day;
    return { sunColor: this.sun.color, skyColor: fogC };
  }
}
