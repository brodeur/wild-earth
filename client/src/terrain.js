import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { windUniforms, WIND_GLSL } from './wind.js';

// Ground colour, shared: the terrain shader and every grass and shrub material that wants to
// match the ground (blades, tufts, sward shells, clumps) bind these same uniform objects and call
// the same GLSL, so a texture switch or a season change reaches them all at once and a blade's
// colour at its root is exactly the colour of the ground it stands on.
export const groundUniforms = {
  map: { value: null }, masks: { value: null }, roads: { value: null }, tileSize: { value: 10000 },
  grassTint: { value: new THREE.Color(0.8, 0.68, 0.36) }, oakTint: { value: new THREE.Color(0.55, 0.45, 0.22) }, oakMix: { value: 0 },
  groundFx: { value: 1 },   // 0 turns off the sward grain, gust sheen and chaparral mottle (A/B timing)
  imagery: { value: 0 }, grassRef: { value: new THREE.Vector3(0.49, 0.47, 0.38) }, oakRef: { value: new THREE.Vector3(0.27, 0.34, 0.27) },
};
export const GROUND_GLSL = /* glsl */`
  uniform sampler2D map; uniform sampler2D masks; uniform sampler2D roads; uniform float tileSize;
  uniform vec3 grassTint; uniform vec3 oakTint; uniform float oakMix;
  uniform float imagery; uniform vec3 grassRef; uniform vec3 oakRef;   // imagery: 1 when map is the erased NAIP
  uniform float groundFx;
  const vec3 G_LUMA = vec3(0.299, 0.587, 0.114);
  vec2 groundUv(vec3 posW) { return vec2(posW.x, -posW.z) / tileSize; }
  // Season recolour of a texel (linear) given its soft habitat weights (grassland, oak, chaparral).
  vec3 groundRecolour(vec3 c, vec3 w) {
    if (imagery > 0.5) {
      // Summer NAIP: re-colour relative to the imagery's own grass and oak means. The ratio is
      // normalised to unit luminance so the photo keeps its brightness and only shifts in hue
      // toward the season's palette (the palette's absolute values are tuned for the habitat texture).
      vec3 rg = grassTint / max(grassRef, vec3(0.02)); rg /= max(dot(rg, G_LUMA), 0.05);
      vec3 ro = oakTint / max(oakRef, vec3(0.02));     ro /= max(dot(ro, G_LUMA), 0.05);
      c = mix(c, c * rg, w.r * 0.8);
      c = mix(c, c * ro, w.g * oakMix * 0.7);
    } else {
      // The texture is habitat colour times hillshade; re-colour grass and oak by season.
      c = mix(c, c * grassTint / vec3(0.84, 0.77, 0.47), w.r);
      c = mix(c, c * oakTint / vec3(0.67, 0.59, 0.28), w.g * oakMix);
    }
    return c;
  }
  // Habitat weights with decayed pavement removed (pavement keeps its grey).
  vec3 groundWeights(vec2 uv, float lod) {
    return textureLod(masks, uv, lod).rgb * (1.0 - smoothstep(0.55, 0.75, textureLod(roads, uv, lod).r));
  }
  // Ground albedo at a point, for vertex shaders (explicit mip level; lod 1 is ~5 m on the NAIP).
  vec3 groundAlbedo(vec3 posW, float lod, out vec3 w) {
    vec2 uv = groundUv(posW);
    w = groundWeights(uv, lod);
    return groundRecolour(textureLod(map, uv, lod).rgb, w);
  }
`;

const VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
  void main(){
    vUv = uv; vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0); vPosW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  }`;
const FRAG = /* glsl */`
  varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
  ${ATMOSPHERE_GLSL}
  ${GROUND_GLSL}
  ${WIND_GLSL}
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
  // Value noise on a rotated, scaled lattice: octaves on different rotations never line up into
  // the square grid a single lattice shows from the air.
  float rnoise(vec2 p, float a, float scale) { float c = cos(a), s = sin(a); return vnoise(mat2(c, s, -s, c) * p / scale); }
  void main(){
    vec3 w = texture2D(masks, vUv).rgb;                 // soft weights: grassland, oak woodland, chaparral
    w *= 1.0 - smoothstep(0.55, 0.75, texture2D(roads, vUv).r);   // decayed pavement keeps its grey
    vec3 c = groundRecolour(texture2D(map, vUv).rgb, w);
    // Fine detail so the ground is not a blurred photo up close: 2 m and 9 m value noise.
    float d = 0.86 + 0.14 * vnoise(vPosW.xz * 0.5) + 0.10 * (vnoise(vPosW.xz * 0.11) - 0.5);
    float dist = distance(vPosW, cameraPosition);
    if (dist < 420.0 && groundFx > 0.5) {
      // Metres per pixel here: each pattern fades out before it gets small enough to shimmer.
      float px = length(fwidth(vPosW.xz));
      // Sward grain in grassland: tufts at ~0.45 m and bunches at ~1.6 m, light tops over darker
      // gaps, so from 10-150 m up the ground reads as a textured sward rather than a smooth photo.
      if (w.r > 0.02) {
        float f1 = 1.0 - smoothstep(0.06, 0.16, px), f2 = 1.0 - smoothstep(0.25, 0.6, px);
        float f3 = 1.0 - smoothstep(0.6, 1.4, px);
        float g1 = rnoise(vPosW.xz, 0.6, 0.22), g2 = rnoise(vPosW.xz + 3.7, 1.9, 0.8), g3 = rnoise(vPosW.xz + 9.1, 1.1, 2.6);
        d *= 1.0 + w.r * (0.22 * f1 * (g1 - 0.5) + 0.2 * f2 * (g2 - 0.5) + 0.16 * f3 * (g3 - 0.5));
        // Gust sheen: the blades' own gust field, painted on the ground so gusts sweep visibly
        // across hillsides from altitude; bent grass shows paler. Subtle: +-6%.
        float gs = clamp((gust(vPosW.xz) - 0.7) / 0.55, -1.0, 1.0);
        d *= 1.0 + 0.06 * gs * w.r * (1.0 - smoothstep(320.0, 420.0, dist));
      }
      // Chaparral: dark gaps of shade and litter between ~2.5 m crowns, so the ground beyond the
      // shrub clumps keeps the mottled, closed-canopy look and the clumps never sit on bare photo.
      if (w.b > 0.02) {
        float f3 = 1.0 - smoothstep(0.35, 1.0, px);
        float m = rnoise(vPosW.xz, 0.4, 1.7) * 0.45 + rnoise(vPosW.xz + 5.1, 2.3, 0.75) * 0.35 + rnoise(vPosW.xz + 2.3, 1.3, 3.9) * 0.2;
        d *= 1.0 + w.b * f3 * 0.5 * (m - 0.5);
      }
    }
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
    const G = groundUniforms;
    G.map.value = this.textureFor(tile.textureImage);
    const masks = new THREE.Texture(tile.masksImage); masks.needsUpdate = true;
    masks.generateMipmaps = true; masks.minFilter = THREE.LinearMipmapLinearFilter;   // vertex shaders read coarse levels
    const roads = tile.roadsImage ? new THREE.Texture(tile.roadsImage) : new THREE.DataTexture(new Uint8Array(4), 1, 1); roads.needsUpdate = true;
    if (tile.roadsImage) { roads.generateMipmaps = true; roads.minFilter = THREE.LinearMipmapLinearFilter; }
    G.masks.value = masks; G.roads.value = roads; G.tileSize.value = tile.size;
    this.uniforms = { ...G, ...windUniforms, ...atmo };   // shared objects, so one update reaches every material
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
