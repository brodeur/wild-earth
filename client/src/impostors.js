import * as THREE from 'three';

// Distant forest: one crossed-quad impostor per 30 m cell with tree cover, for the whole
// tile, fading out where the near forest takes over. Two sprite shapes: broadleaf and conifer.

function sprite(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  if (kind === 'conifer') {
    for (let i = 0; i < 3; i++) { const x = 30 + i * 34, h = 90 + (i % 2) * 20; g.beginPath(); g.moveTo(x, 128 - h); g.lineTo(x - 16, 124); g.lineTo(x + 16, 124); g.closePath(); g.fill(); }
  } else {
    for (let i = 0; i < 7; i++) { const x = 20 + (i * 37) % 90, y = 40 + (i * 23) % 50, r = 22 + (i * 7) % 14; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    g.fillRect(58, 90, 12, 38);
  }
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; return t;
}

const VERT = /* glsl */`
  attribute vec3 instanceColor;
  uniform float nearRadius; uniform vec3 eye;
  varying vec2 vUv; varying vec3 vColor; varying float vFade;
  #include <fog_pars_vertex>
  void main(){
    vUv = uv; vColor = instanceColor;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    float d = distance(wp.xz, eye.xz);
    vFade = smoothstep(nearRadius - 350.0, nearRadius + 150.0, d);   // hidden where real trees exist
    vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FRAG = /* glsl */`
  uniform sampler2D map; uniform vec3 sunColor; uniform vec3 skyColor;
  varying vec2 vUv; varying vec3 vColor; varying float vFade;
  #include <fog_pars_fragment>
  void main(){
    float a = texture2D(map, vUv).a * vFade;
    if (a < 0.4) discard;
    vec3 light = skyColor * 0.9 + sunColor * 0.5;
    gl_FragColor = vec4(vColor * light, 1.0);
    #include <fog_fragment>
  }`;

export class Impostors {
  constructor(tile, scene) {
    this.tile = tile; this.group = new THREE.Group(); scene.add(this.group);
    const hab = tile.habitat, can = tile.canopy, res = hab.res, size = tile.size, w = hab.img.width, h = hab.img.height;
    const cells = { broadleaf: [], conifer: [] };
    const CLASS_COLOR = { 1: [0.36, 0.40, 0.22], 2: [0.17, 0.30, 0.19], 3: [0.26, 0.34, 0.20], 4: [0.30, 0.31, 0.22], 5: [0.38, 0.42, 0.22], 6: [0.26, 0.38, 0.25] };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const cls = hab.channel(i, j, 0); if (!CLASS_COLOR[cls]) continue;
      const tree = can.channel(i, j, 0) / 100; if (tree < 0.12 && cls !== 4) continue;
      const shrub = can.channel(i, j, 1) / 100; if (cls === 4 && shrub < 0.25 && tree < 0.12) continue;
      const x = (i + 0.5) * res, north = size - (j + 0.5) * res;
      const kind = cls === 2 ? 'conifer' : (cls === 3 && ((i * 7 + j * 13) % 3 === 0)) ? 'conifer' : 'broadleaf';
      const height = cls === 4 ? 4 + shrub * 6 : (kind === 'conifer' ? 14 + tree * 18 : 7 + tree * 9);
      const c = CLASS_COLOR[cls];
      // two clusters per cell, offset and varied, so the 30 m grid does not read as a checkerboard
      for (let k = 0; k < 2; k++) {
        const h1 = ((i * 31 + j * 17 + k * 101) % 13) / 13, h2 = ((i * 7 + j * 29 + k * 53) % 11) / 11;
        const px = x + (h1 - 0.5) * res * 0.9, pn = north + (h2 - 0.5) * res * 0.9;
        if (tile.roads && tile.roads.at(px, pn) > 140) continue;   // no forest on decayed pavement
        const vary = 0.78 + h1 * 0.4, hv = height * (0.8 + h2 * 0.5);
        cells[kind].push({ x: px, z: -pn, y: tile.heights.at(px, pn), height: hv, width: Math.max(10, hv * (kind === 'conifer' ? 0.9 : 1.5)), color: [c[0] * vary, c[1] * vary, c[2] * vary] });
      }
    }
    this.uniforms = { map: { value: null }, nearRadius: { value: 1500 }, eye: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color(1, 1, 1) }, skyColor: { value: new THREE.Color(0.5, 0.6, 0.7) }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) };
    this.meshes = [];
    for (const kind of ['broadleaf', 'conifer']) {
      const list = cells[kind]; if (!list.length) continue;
      const quad = new THREE.PlaneGeometry(1, 1); quad.translate(0, 0.5, 0);
      const quad2 = quad.clone(); quad2.rotateY(Math.PI / 2);
      const cap = new THREE.PlaneGeometry(0.9, 0.9); cap.rotateX(-Math.PI / 2); cap.translate(0, kind === 'conifer' ? 0.55 : 0.72, 0);   // seen from above
      const geom = mergeTwo(mergeTwo(quad, quad2), cap);
      const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, fog: true, side: THREE.DoubleSide,
        uniforms: { ...this.uniforms, map: { value: sprite(kind) } } });
      const mesh = new THREE.InstancedMesh(geom, mat, list.length); mesh.frustumCulled = false;
      const o = new THREE.Object3D(), colors = new Float32Array(list.length * 3);
      list.forEach((c, k) => { o.position.set(c.x, c.y - 0.5, c.z); o.rotation.set(0, (k % 7) * 0.45, 0); o.scale.set(c.width, c.height, c.width); o.updateMatrix(); mesh.setMatrixAt(k, o.matrix); colors.set(c.color, k * 3); });
      geom.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));
      this.group.add(mesh); this.meshes.push(mesh);
    }
    this.count = cells.broadleaf.length + cells.conifer.length;
  }
  update(camera, nearRadius, sunColor, skyColor, fog) {
    for (const m of this.meshes) { const u = m.material.uniforms; u.eye.value.copy(camera.position); u.nearRadius.value = nearRadius;
      u.sunColor.value.copy(sunColor); u.skyColor.value.copy(skyColor); u.fogColor.value.copy(fog.color); u.fogNear.value = fog.near; u.fogFar.value = fog.far; }
  }
}

function mergeTwo(a, b) {
  const pos = new Float32Array([...a.attributes.position.array, ...b.attributes.position.array]);
  const uv = new Float32Array([...a.attributes.uv.array, ...b.attributes.uv.array]);
  const idx = [...a.index.array, ...Array.from(b.index.array, i => i + a.attributes.position.count)];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); return g;
}
