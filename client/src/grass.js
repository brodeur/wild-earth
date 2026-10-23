import * as THREE from 'three';
import { mulberry32 } from './trees.js';

// Near-camera grass: crossed-quad tufts in grassland and savanna cells within a short
// radius, coloured by the season's grass tint, re-seeded deterministically per cell.
const VERT = /* glsl */`
  uniform float time; uniform vec3 eye; uniform float radius;
  varying vec2 vUv; varying float vFade;
  #include <fog_pars_vertex>
  void main(){
    vUv = uv;
    vec3 p = position;
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    float sway = sin(time * 1.7 + wp.x * 0.15 + wp.z * 0.11) * 0.12 * uv.y;   // wind: tips move, roots stay
    wp.x += sway; wp.z += sway * 0.6;
    float d = distance(wp.xz, eye.xz);
    vFade = 1.0 - smoothstep(radius * 0.7, radius, d);
    vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FRAG = /* glsl */`
  uniform vec3 tint; uniform vec3 light;
  varying vec2 vUv; varying float vFade;
  #include <fog_pars_fragment>
  void main(){
    float blade = smoothstep(0.0, 0.08, 0.5 - abs(vUv.x - 0.5) - vUv.y * 0.42);   // tapered blade silhouette
    if (blade * vFade < 0.3) discard;
    vec3 c = tint * (0.55 + 0.55 * vUv.y) * light;
    gl_FragColor = vec4(c, 1.0);
    #include <fog_fragment>
  }`;

export class Grass {
  constructor(tile, scene, cap = 24000) {
    this.tile = tile; this.cap = cap; this.radius = 220; this.lastCenter = null;
    const quad = new THREE.PlaneGeometry(0.9, 0.9); quad.translate(0, 0.45, 0);
    const q2 = quad.clone(); q2.rotateY(Math.PI / 2);
    const pos = new Float32Array([...quad.attributes.position.array, ...q2.attributes.position.array]);
    const uv = new Float32Array([...quad.attributes.uv.array, ...q2.attributes.uv.array]);
    const idx = [...quad.index.array, ...Array.from(q2.index.array, i => i + 4)];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    this.uniforms = { time: { value: 0 }, eye: { value: new THREE.Vector3() }, radius: { value: this.radius }, tint: { value: new THREE.Color(0.8, 0.68, 0.36) },
      light: { value: new THREE.Color(1, 1, 1) }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) };
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, fog: true, side: THREE.DoubleSide }), cap);
    this.mesh.count = 0; this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.tmp = new THREE.Object3D();
  }
  update(x, z, dt, camera, look, light, fog) {
    this.uniforms.time.value += dt; this.uniforms.eye.value.copy(camera.position);
    this.uniforms.tint.value.setRGB(...look.grass); this.uniforms.light.value.copy(light);
    this.uniforms.fogColor.value.copy(fog.color); this.uniforms.fogNear.value = fog.near; this.uniforms.fogFar.value = fog.far;
    if (this.lastCenter && Math.hypot(x - this.lastCenter[0], z - this.lastCenter[1]) < 40) return;
    this.lastCenter = [x, z];
    const hab = this.tile.habitat, can = this.tile.canopy, res = hab.res, size = this.tile.size, heights = this.tile.heights, roads = this.tile.roads;
    const north = -z, cells = Math.ceil(this.radius / res), [ci, cj] = hab.cellOf(x, north);
    let n = 0;
    for (let j = cj - cells; j <= cj + cells; j++) for (let i = ci - cells; i <= ci + cells; i++) {
      if (i < 0 || j < 0 || i >= hab.img.width || j >= hab.img.height) continue;
      const cls = hab.channel(i, j, 0); if (cls !== 5 && cls !== 1 && cls !== 6) continue;
      const cx = (i + 0.5) * res, cn = size - (j + 0.5) * res; if (Math.hypot(cx - x, cn - north) > this.radius) continue;
      const herb = Math.max(0.3, can.channel(i, j, 2) / 100), per = Math.round((cls === 5 ? 140 : 50) * herb);
      const rnd = mulberry32((i * 92821) ^ (j * 68917) ^ 11);
      for (let k = 0; k < per && n < this.cap; k++) {
        const px = (i + rnd()) * res, pn = size - (j + rnd()) * res, rot = rnd() * Math.PI;
        const s = 0.7 + rnd() * 0.8, sy = s * (0.8 + rnd() * 0.6);
        // Decayed roads: no tufts on the pavement, half density across the verge.
        const rw = roads ? roads.at(px, pn) : 0;
        if (rw > 140 || (rw > 0 && (k & 1))) continue;
        this.tmp.position.set(px, heights.at(px, pn), -pn); this.tmp.rotation.set(0, rot, 0);
        this.tmp.scale.set(s, sy, s); this.tmp.updateMatrix();
        this.mesh.setMatrixAt(n++, this.tmp.matrix);
      }
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}
