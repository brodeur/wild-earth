import * as THREE from 'three';

const VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
  #include <fog_pars_vertex>
  void main(){
    vUv = uv; vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0); vPosW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FRAG = /* glsl */`
  uniform sampler2D map; uniform sampler2D masks; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyColor;
  uniform vec3 grassTint; uniform vec3 oakTint; uniform float oakMix; uniform sampler2D roads;
  varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
  #include <fog_pars_fragment>
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
  void main(){
    vec3 c = texture2D(map, vUv).rgb;
    vec3 w = texture2D(masks, vUv).rgb;                 // soft weights: grassland, oak woodland, chaparral
    w *= 1.0 - smoothstep(0.55, 0.75, texture2D(roads, vUv).r);   // decayed pavement keeps its grey
    // The texture is habitat colour times hillshade; re-colour grass and oak by season.
    c = mix(c, c * grassTint / vec3(0.84, 0.77, 0.47), w.r);
    c = mix(c, c * oakTint / vec3(0.67, 0.59, 0.28), w.g * oakMix);
    // Fine detail so the ground is not a blurred photo up close: 2 m and 9 m value noise.
    float d = 0.86 + 0.14 * vnoise(vPosW.xz * 0.5) + 0.10 * (vnoise(vPosW.xz * 0.11) - 0.5);
    c *= d;
    vec3 n = normalize(vNormalW);
    float diff = max(dot(n, sunDir), 0.0);
    vec3 light = sunColor * diff + skyColor * (0.55 + 0.45 * n.y);
    gl_FragColor = vec4(c * light, 1.0);
    #include <fog_fragment>
  }`;

export class Terrain {
  constructor(tile, { chunks = 10, spacing = 10 } = {}) {
    this.tile = tile; this.group = new THREE.Group();
    const tex = new THREE.Texture(tile.textureImage); tex.needsUpdate = true; tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const masks = new THREE.Texture(tile.masksImage); masks.needsUpdate = true;
    const roads = tile.roadsImage ? new THREE.Texture(tile.roadsImage) : new THREE.DataTexture(new Uint8Array(4), 1, 1); roads.needsUpdate = true;
    this.uniforms = {
      map: { value: tex }, masks: { value: masks }, roads: { value: roads },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(1, 0.95, 0.85) }, skyColor: { value: new THREE.Color(0.45, 0.55, 0.7) },
      grassTint: { value: new THREE.Color(0.8, 0.68, 0.36) }, oakTint: { value: new THREE.Color(0.55, 0.45, 0.22) }, oakMix: { value: 0 },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, fog: true });
    const size = tile.size, cs = size / chunks, nv = Math.round(cs / spacing) + 1;
    for (let cj = 0; cj < chunks; cj++) for (let ci = 0; ci < chunks; ci++) {
      const g = new THREE.PlaneGeometry(cs, cs, nv - 1, nv - 1);
      g.rotateX(-Math.PI / 2);                       // plane in xz, +y up; local z increases southward
      const pos = g.attributes.position, uv = g.attributes.uv;
      const x0 = ci * cs, north1 = size - cj * cs;   // chunk's west edge and north edge
      for (let k = 0; k < pos.count; k++) {
        const lx = pos.getX(k) + cs / 2, lz = pos.getZ(k) + cs / 2;   // 0..cs
        const x = x0 + lx, north = north1 - lz;
        pos.setXYZ(k, x, tile.heights.at(x, north), -north);
        uv.setXY(k, x / size, north / size);
      }
      g.computeVertexNormals(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.material); mesh.frustumCulled = true;
      this.group.add(mesh);
    }
  }
  setLook(look, sun) {
    this.uniforms.grassTint.value.setRGB(...look.grass);
    this.uniforms.oakTint.value.setRGB(...look.oakLeaf);
    this.uniforms.oakMix.value = 1 - look.oakLeafOn;
    this.uniforms.sunDir.value.set(...sun.dir);
  }
}
