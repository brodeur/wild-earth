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
  uniform sampler2D map; uniform sampler2D habitat; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyColor;
  uniform vec3 grassTint; uniform vec3 oakTint; uniform float oakMix;
  varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
  #include <fog_pars_fragment>
  void main(){
    vec3 c = texture2D(map, vUv).rgb;
    float hab = texture2D(habitat, vUv).r * 255.0;
    // The texture is habitat colour times hillshade; re-colour grass and oak by season.
    if (abs(hab - 5.0) < 0.5) c = c * grassTint / vec3(0.84, 0.77, 0.47);
    if (abs(hab - 1.0) < 0.5) c = mix(c, c * oakTint / vec3(0.67, 0.59, 0.28), oakMix);
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
    const hab = new THREE.Texture(tile.habitat.img.image); hab.needsUpdate = true;
    hab.magFilter = THREE.NearestFilter; hab.minFilter = THREE.NearestFilter; hab.generateMipmaps = false;
    this.uniforms = {
      map: { value: tex }, habitat: { value: hab },
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
