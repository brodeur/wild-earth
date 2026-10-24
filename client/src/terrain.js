import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';

const VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
  void main(){
    vUv = uv; vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0); vPosW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  }`;
const FRAG = /* glsl */`
  uniform sampler2D map; uniform sampler2D masks;
  uniform vec3 grassTint; uniform vec3 oakTint; uniform float oakMix; uniform sampler2D roads;
  uniform float imagery; uniform vec3 grassRef; uniform vec3 oakRef;   // imagery: 1 when map is the erased NAIP
  varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
  ${ATMOSPHERE_GLSL}
  const vec3 LUMA = vec3(0.299, 0.587, 0.114);
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
  void main(){
    vec3 c = texture2D(map, vUv).rgb;
    vec3 w = texture2D(masks, vUv).rgb;                 // soft weights: grassland, oak woodland, chaparral
    w *= 1.0 - smoothstep(0.55, 0.75, texture2D(roads, vUv).r);   // decayed pavement keeps its grey
    if (imagery > 0.5) {
      // Summer NAIP: re-colour relative to the imagery's own grass and oak means. The ratio is
      // normalised to unit luminance so the photo keeps its brightness and only shifts in hue
      // toward the season's palette (the palette's absolute values are tuned for the habitat texture).
      vec3 rg = grassTint / max(grassRef, vec3(0.02)); rg /= max(dot(rg, LUMA), 0.05);
      vec3 ro = oakTint / max(oakRef, vec3(0.02));     ro /= max(dot(ro, LUMA), 0.05);
      c = mix(c, c * rg, w.r * 0.8);
      c = mix(c, c * ro, w.g * oakMix * 0.7);
    } else {
      // The texture is habitat colour times hillshade; re-colour grass and oak by season.
      c = mix(c, c * grassTint / vec3(0.84, 0.77, 0.47), w.r);
      c = mix(c, c * oakTint / vec3(0.67, 0.59, 0.28), w.g * oakMix);
    }
    // Fine detail so the ground is not a blurred photo up close: 2 m and 9 m value noise.
    float d = 0.86 + 0.14 * vnoise(vPosW.xz * 0.5) + 0.10 * (vnoise(vPosW.xz * 0.11) - 0.5);
    c *= d;
    vec3 n = normalize(vNormalW);
    // Same light as the lambert trees: sun (under cloud shadow) plus hemisphere sky, over pi.
    float diff = max(dot(n, sunDir), 0.0);
    vec3 light = sunLight * diff * cloudShadow(vPosW) + mix(ambientGround, ambientSky, 0.5 + 0.5 * n.y);
    gl_FragColor = vec4(atmosphereApply(c * light * 0.3183099, vPosW, cameraPosition), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Terrain {
  constructor(tile, { chunks = 10, spacing = 10 } = {}) {
    this.tile = tile; this.group = new THREE.Group(); this.textures = new Map();
    const tex = this.textureFor(tile.textureImage);
    const masks = new THREE.Texture(tile.masksImage); masks.needsUpdate = true;
    const roads = tile.roadsImage ? new THREE.Texture(tile.roadsImage) : new THREE.DataTexture(new Uint8Array(4), 1, 1); roads.needsUpdate = true;
    this.uniforms = {
      map: { value: tex }, masks: { value: masks }, roads: { value: roads },
      grassTint: { value: new THREE.Color(0.8, 0.68, 0.36) }, oakTint: { value: new THREE.Color(0.55, 0.45, 0.22) }, oakMix: { value: 0 },
      imagery: { value: 0 }, grassRef: { value: new THREE.Vector3(0.49, 0.47, 0.38) }, oakRef: { value: new THREE.Vector3(0.27, 0.34, 0.27) },
      ...atmo,   // shared atmosphere uniforms (same objects, so one update reaches every material)
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms });
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
  // One GPU texture per image, made on first use and kept, so switching back and forth is free.
  textureFor(image) {
    let t = this.textures.get(image);
    if (!t) {
      t = new THREE.Texture(image); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
      this.textures.set(image, t);
    }
    return t;
  }
  setTexture(image) { this.uniforms.map.value = this.textureFor(image); }
  // imagery: 1 for the erased NAIP texture; ref = {grass_mean, oak_mean} from the manifest (sRGB 0..1)
  setImagery(on, ref) {
    this.uniforms.imagery.value = on ? 1 : 0;
    if (ref?.grass_mean) this.uniforms.grassRef.value.set(...ref.grass_mean);
    if (ref?.oak_mean) this.uniforms.oakRef.value.set(...ref.oak_mean);
  }
  setLook(look) {
    this.uniforms.grassTint.value.setRGB(...look.grass);
    this.uniforms.oakTint.value.setRGB(...look.oakLeaf);
    this.uniforms.oakMix.value = 1 - look.oakLeafOn;
  }
}
