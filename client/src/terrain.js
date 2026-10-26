import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { windUniforms, WIND_GLSL } from './wind.js';
import { GroundDetail, detailUniforms, DETAIL_GLSL } from './groundDetail.js';

// Ground colour, shared: the terrain shader and every grass and shrub material that wants to
// match the ground (blades, tufts, sward shells, clumps) bind these same uniform objects and call
// the same GLSL, so a texture switch or a season change reaches them all at once and a blade's
// colour at its root is exactly the colour of the ground it stands on.
export const groundUniforms = {
  map: { value: null }, masks: { value: null }, roads: { value: null }, tileSize: { value: 10000 },
  grassTint: { value: new THREE.Color(0.8, 0.68, 0.36) }, oakTint: { value: new THREE.Color(0.55, 0.45, 0.22) }, oakMix: { value: 0 },
  groundFx: { value: 1 },   // 0 turns off the sward grain, gust sheen and chaparral mottle (A/B timing)
  imagery: { value: 0 }, grassRef: { value: new THREE.Vector3(0.49, 0.47, 0.38) }, oakRef: { value: new THREE.Vector3(0.27, 0.34, 0.27) },
  canopyMap: { value: null },   // tile canopy raster: r = tree cover %, g = shrub cover % (8-bit percent)
  contactAO: { value: null },   // shadows.js: top-down sky occlusion under each near tree (r = 0 open .. 1 at the trunk)
  contactAOMatrix: { value: new THREE.Matrix4().set(0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 1) },   // world -> its uv
};
// Riparian floor (habitat 6), terrain shader only: the class has no channel in masks.png, so the
// client builds its weight from the habitat grid (ripMask, bilinear across the 30 m cells exactly as
// masks.png is). ripRef is the current texture's own linear mean over interior riparian cells, so one
// palette fits the summer photo and the habitat texture alike; ripOn is 0 for any other texture (the
// present-day peek shows the photo as it is).
const ripUniforms = {
  ripMask: { value: null }, ripRef: { value: new THREE.Vector3(0.1, 0.12, 0.08) }, ripOn: { value: 0 },
  ripTint: { value: new THREE.Color(0.25, 0.18, 0.05) }, ripDark: { value: 1 }, ripMix: { value: 0 },
};
export const GROUND_GLSL = /* glsl */`
  uniform sampler2D map; uniform sampler2D masks; uniform sampler2D roads; uniform float tileSize;
  uniform vec3 grassTint; uniform vec3 oakTint; uniform float oakMix;
  uniform float imagery; uniform vec3 grassRef; uniform vec3 oakRef;   // imagery: 1 when map is the erased NAIP
  uniform float groundFx; uniform sampler2D canopyMap; uniform sampler2D contactAO; uniform mat4 contactAOMatrix;
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
  // Sky light reaching the ground under the canopy: up to 35% less under full tree cover (and a
  // little under dense shrubs). Bilinear over the ~30 m cover cells, so it reads as soft woodland
  // floor shade, the ambient half of what a cast shadow does for the sun.
  float groundSkyOcclusion(vec2 uv) {
    vec2 cov = texture(canopyMap, uv).rg * 2.55;   // 8-bit percent -> 0..1
    return 1.0 - 0.35 * clamp(cov.r, 0.0, 1.0) - 0.1 * clamp(cov.g, 0.0, 1.0);
  }
  // Sky light reaching the ground at a trunk: a soft blob per near tree out to its crown edge
  // (rendered by shadows.js around the camera, faded out at the map's edge).
  float groundContactAO(vec3 posW) {
    vec2 uv = (contactAOMatrix * vec4(posW, 1.0)).xy;
    vec2 e = abs(uv - 0.5) * 2.0;
    if (max(e.x, e.y) >= 1.0) return 1.0;
    return 1.0 - texture(contactAO, uv).r * (1.0 - smoothstep(0.8, 1.0, max(e.x, e.y)));
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
  // Integer lattice hash. The usual fract(sin(dot(p, k)) * 43758) breaks down here: lattice
  // coordinates reach ~5e4 (0.22 m cells over a 10 km tile), so the sin argument is ~1e7, past
  // where the GPU's sin is accurate, and neighbouring cells' values come out correlated row by
  // row: from 60-150 m up the 0.8 m sward grain showed as a regular grid. Exact for any cell.
  float hash(vec2 p){ uvec2 q = uvec2(ivec2(p) + 65536); uint h = q.x * 1597334677u ^ q.y * 3812015801u;
    h = (h ^ (h >> 15)) * 2246822519u; h ^= h >> 13; return float(h) * (1.0 / 4294967296.0); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
  // Value noise on a rotated, scaled lattice: octaves on different rotations never line up into
  // the square grid a single lattice shows from the air.
  float rnoise(vec2 p, float a, float scale) { float c = cos(a), s = sin(a); return vnoise(mat2(c, s, -s, c) * p / scale); }
  ${DETAIL_GLSL}
  uniform sampler2D ripMask; uniform vec3 ripRef; uniform float ripOn; uniform vec3 ripTint; uniform float ripDark; uniform float ripMix;
  uniform float geoSlope;   // 1 on a tile with the lidar residual: the rock rule takes the mesh's own slope too
  void main(){
    vec3 w = texture2D(masks, vUv).rgb;                 // soft weights: grassland, oak woodland, chaparral
    float road = texture2D(roads, vUv).r;
    w *= 1.0 - smoothstep(0.55, 0.75, road);            // decayed pavement keeps its grey
    vec3 c = groundRecolour(texture2D(map, vUv).rgb, w);
    // Riparian floor by season: the texture's riparian mean is pulled to the season's hue (the ratio
    // normalised to unit luminance, so the photo's own light and dark survive) and brightness.
    float wRip = texture2D(ripMask, vUv).r * (1.0 - smoothstep(0.55, 0.75, road));
    if (wRip * ripOn * ripMix > 0.0) {
      vec3 rr = ripTint / max(ripRef, vec3(0.01)); rr /= max(dot(rr, G_LUMA), 0.05);
      c = mix(c, c * rr * ripDark, wRip * ripMix);
    }
    vec2 cov = texture2D(canopyMap, vUv).rg * 2.55;     // tree, shrub cover 0..1 (sky occlusion and litter)
    float dist = distance(vPosW, cameraPosition);
    vec3 dpx = dFdx(vPosW), dpy = dFdy(vPosW);          // outside every branch: the detail fetches use them
    vec3 nGeo = normalize(vNormalW), nL = nGeo;         // geometric normal; lighting normal (detail-bent)
    // Near-detail weight: full within 40 m, gone by 250 m, so the far ground is exactly as before.
    // Footprint fade on top: once one ~2.5 m repeat spans fewer than ~40 pixels, a field of repeats
    // starts to read as a lattice (stones, tufts at a fixed pitch), so the detail backs off to
    // nothing by 12 pixels per repeat.
    float foot = sqrt(length(dpx) * length(dpy));        // metres per pixel (geometric mean of the two axes)
    float fade = detailReady * detailOn * (1.0 - smoothstep(40.0, 250.0, dist)) * (1.0 - smoothstep(2.5 / 40.0, 2.5 / 12.0, foot));
    // Fine detail so the ground is not a blurred photo up close: 2 m and 9 m value noise, on
    // lattices turned to two different angles so neither lines up with the world axes.
    float d = 0.86 + 0.14 * rnoise(vPosW.xz, 0.35, 2.0) + 0.10 * (rnoise(vPosW.xz + 6.3, 1.45, 9.1) - 0.5);
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
    // The detail textures carry the fine structure near the camera: the noise grain keeps a third
    // of its strength there and all of it beyond 250 m.
    c *= mix(d, 1.0 + (d - 1.0) * 0.35, fade);
    if (fade > 0.0) {
      // Material weights (groundDetail.js mask: r slope/90, g curvature 0.5 +- convex/concave, b bare).
      vec4 mk = textureLod(detailMask, vUv, 0.0);
      // slope: the 10 m mask's (from the 5 m heights), or on a lidar tile the steeper of that and the drawn mesh's
      // own (the fine mesh's 2 m triangles near the player), so a road cut's bank takes the rock material
      float slopeDeg = max(mk.r * 90.0, geoSlope * degrees(acos(clamp(nGeo.y, 0.0, 1.0)))), curv = mk.g * 2.0 - 1.0, bare = mk.b, tree = clamp(cov.r, 0.0, 1.0);
      float bn = rnoise(vPosW.xz + 11.0, 0.8, 3.1) - 0.5;   // +-0.5 over ~3 m: ragged borders between materials
      float rock = max(smoothstep(24.0, 32.0, slopeDeg), max(smoothstep(0.35, 0.7, -curv), smoothstep(0.7, 0.9, bare)));
      // pavement where the road weight passes ~0.55, with a ragged, crumbling 1-2 m edge (the 5 m raster's own edge is straight)
      float pave = smoothstep(0.42, 0.68, road + 0.22 * bn + 0.18 * (rnoise(vPosW.xz + 3.3, 2.4, 0.9) - 0.5));
      float wt[5];
      wt[0] = w.r * (1.0 - 0.8 * tree);                                  // thatch: grassland in the open
      wt[1] = clamp(max(tree * 1.5, w.g * 0.5), 0.0, 1.0);               // litter: under tree cover
      wt[2] = clamp(0.06 + 0.7 * w.b + smoothstep(0.25, 0.6, bare) + 0.8 * smoothstep(0.15, 0.5, curv), 0.0, 1.0);   // gravel: chaparral, bare, convex
      wt[3] = rock;                                                       // cobble/rock: steep, channels, barren
      for (int i = 0; i < 3; i++) wt[i] *= (1.0 - 0.8 * rock) * max(1.0 + (i < 2 ? -bn : bn) * 0.8, 0.0);
      wt[3] *= max(1.0 + bn * 0.6, 0.0);
      for (int i = 0; i < 4; i++) wt[i] *= 1.0 - pave;
      wt[4] = pave;                                                       // pavement: road weight > 0.55
      // Top two weights; the third is subtracted from both so a change of rank never pops.
      int i1 = 0; for (int i = 1; i < 5; i++) if (wt[i] > wt[i1]) i1 = i;
      int i2 = i1 == 0 ? 1 : 0; for (int i = 0; i < 5; i++) if (i != i1 && wt[i] > wt[i2]) i2 = i;
      float w3 = 0.0; for (int i = 0; i < 5; i++) if (i != i1 && i != i2) w3 = max(w3, wt[i]);
      float a1 = max(wt[i1] - w3, 0.0), a2 = max(wt[i2] - w3, 0.0), b = a2 / max(a1 + a2, 1e-4);
      // Slopes past 35 degrees: the top material only, projected on the two planes that face the
      // slope best (biplanar; the 1/sqrt(3) remap leaves at most two non-zero), so rock faces do
      // not smear. Below 29.5 degrees the plain top-down projection carries the top two materials;
      // in between the second material fades out, so the switch is seamless.
      int axA = 1, axB = 1, mSec = i2; float mB = b * smoothstep(0.819, 0.87, nGeo.y);
      if (nGeo.y < 0.819) {
        vec3 aw = max(abs(nGeo) - 0.5773, 0.0);
        axA = aw.x >= aw.y && aw.x >= aw.z ? 0 : (aw.y >= aw.z ? 1 : 2);
        vec3 r = aw; r[axA] = -1.0;
        axB = r.x >= r.y && r.x >= r.z ? 0 : (r.y >= r.z ? 1 : 2);
        mB = aw[axB] / max(aw[axA] + aw[axB], 1e-4); mSec = i1;
      }
      // Macro variation, so no repeat shows from 50 m: a ~20 m and a ~7 m warp of the detail uv (locally
      // a shift plus a small rotation and shear), and two slow noises on the detail's contrast and brightness.
      vec2 warp = (vec2(rnoise(vPosW.xz, 0.7, 19.0), rnoise(vPosW.xz + 17.3, 2.1, 23.0)) - 0.5) * 2.4
                + (vec2(rnoise(vPosW.xz + 7.1, 1.6, 6.5), rnoise(vPosW.xz + 29.7, 0.3, 7.3)) - 0.5) * 1.0;   // second octave: breaks the local lattice
      vec3 a1c, t1, a2c, t2;
      dSample(i1, axA, vPosW, warp, dpx, dpy, a1c, t1);
      dSample(mSec, axB, vPosW, warp, dpx, dpy, a2c, t2);
      // Stochastic second copy of the top material on the top-down projection: the same scan turned
      // 63 degrees and shifted, swapped in over patches of a ~5 m noise with soft edges. A +-1 m warp of
      // a 3 m rock tile still lined up as a lattice over 30 m of open slope; two copies in patches do
      // not. (Steep faces use the biplanar projection, which already turns with the slope.)
      if (axA == 1) {
        const mat2 Q = mat2(0.454, 0.891, -0.891, 0.454);
        vec2 q = Q * vPosW.xz + vec2(4.37, 2.91);
        vec3 a1d, t1d;
        dSample(i1, 1, vec3(q.x, vPosW.y, q.y), warp.yx, vec3((Q * dpx.xz).x, dpx.y, (Q * dpx.xz).y), vec3((Q * dpy.xz).x, dpy.y, (Q * dpy.xz).y), a1d, t1d);
        t1d.xy = t1d.xy * Q;   // tangent xy back from the turned frame (row-vector times Q = transpose(Q) times column)
        float sw = smoothstep(0.42, 0.58, rnoise(vPosW.xz + 13.7, 0.9, 5.3));
        a1c = mix(a1c, a1d, sw); t1 = mix(t1, t1d, sw);
      }
      float con = mix(detailContrast[i1], detailContrast[mSec], mB);
      float m1 = rnoise(vPosW.xz + 5.0, 0.2, 29.0), m2 = rnoise(vPosW.xz + 41.0, 1.3, 47.0);
      c *= mix(vec3(1.0), mix(a1c, a2c, mB), fade * con * (0.7 + 0.6 * m1)) * mix(1.0, 0.9 + 0.2 * m2, fade);
      vec3 nd = normalize(mix(dToWorld(axA, t1, nGeo), dToWorld(axB, t2, nGeo), mB));
      nL = normalize(mix(nGeo, nd, fade));
    }
    // Same light as the lambert trees: sun (under cloud and cast shadow) plus hemisphere sky, over pi.
    // The terrain casts with its back faces (shadows.js), so a sunlit slope never shadows itself
    // and the normal offset here only has to clear the tree casters' depth. Cast shadows use the
    // geometric normal; the detail normal only bends the sun term, and never lights a face the geometry turns away from the sun.
    // The bumped term is divided by the cosine of the bump's tilt, which keeps the mean at the
    // flat-ground value (tilts toward and away from the sun average back to cos(sun)), so the
    // detail adds relief without dimming the photo.
    float geo = max(dot(nGeo, sunDir), 0.0);
    float bump = max(dot(nL, sunDir), 0.0) / max(dot(nL, nGeo), 0.6);
    float diff = geo > 0.0 ? mix(geo, bump, smoothstep(0.0, 0.12, geo)) : 0.0;
    float sunVis = geo > 0.0 ? csmShadow(vPosW, nGeo, 1.0, 1.0, 1.0) : 1.0;
    float skyOcc = 1.0 - 0.35 * clamp(cov.r, 0.0, 1.0) - 0.1 * clamp(cov.g, 0.0, 1.0);   // = groundSkyOcclusion(vUv)
    vec3 light = sunLight * diff * cloudOnly(vPosW) * sunVis
      + mix(ambientGround, ambientSky, 0.5 + 0.5 * nGeo.y) * skyOcc * groundContactAO(vPosW);
    gl_FragColor = vec4(atmosphereApply(c * light * 0.3183099, vPosW, cameraPosition), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Riparian weight (habitat class 6) on the habitat grid, one byte per 30 m cell, rows south to north
// (a DataTexture is not flipped on upload), sampled bilinearly like masks.png.
function riparianMask(tile) {
  const g = tile.habitat.img, W = g.width, H = g.height, a = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) a[(H - 1 - j) * W + i] = g.data[(j * W + i) * 4] === 6 ? 255 : 0;
  const t = new THREE.DataTexture(a, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  t.unpackAlignment = 1; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

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
    if (tile.canopy?.img?.image) {   // same orientation as the masks (image rows north to south, flipY)
      const canopy = new THREE.Texture(tile.canopy.img.image); canopy.needsUpdate = true;
      canopy.colorSpace = THREE.NoColorSpace; canopy.generateMipmaps = true; canopy.minFilter = THREE.LinearMipmapLinearFilter;
      G.canopyMap.value = canopy;
    } else { G.canopyMap.value = new THREE.DataTexture(new Uint8Array(4), 1, 1); G.canopyMap.value.needsUpdate = true; }
    // Near-ground detail materials and their per-tile masks (groundDetail.js); textures stream in after.
    this.detail = new GroundDetail(tile);
    ripUniforms.ripMask.value = riparianMask(tile);
    this.uniforms = { ...G, ...windUniforms, ...atmo, ...detailUniforms, ...ripUniforms, geoSlope: { value: tile.heights.detail ? 1 : 0 } };   // shared objects, so one update reaches every material
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms });
    const size = tile.size, cs = size / chunks, nv = Math.round(cs / spacing) + 1, H = tile.heights;
    H.coarseSpacing = spacing;
    this.chunks = []; this.chunkInfo = { chunks, cs, nv, spacing };
    for (let cj = 0; cj < chunks; cj++) for (let ci = 0; ci < chunks; ci++) {
      const g = new THREE.PlaneGeometry(cs, cs, nv - 1, nv - 1);
      g.rotateX(-Math.PI / 2);                       // plane in xz, +y up; local z increases southward
      const pos = g.attributes.position, uv = g.attributes.uv;
      const x0 = ci * cs, north1 = size - cj * cs;   // chunk's west edge and north edge
      for (let k = 0; k < pos.count; k++) {
        const lx = pos.getX(k) + cs / 2, lz = pos.getZ(k) + cs / 2;   // 0..cs
        const x = x0 + lx, north = north1 - lz;
        pos.setXYZ(k, x, H.vert(x, north), -north);   // on a lidar tile the 1 m ground at the vertex (Heightfield.vert)
        uv.setXY(k, x / size, north / size);
      }
      g.computeVertexNormals(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.material); mesh.frustumCulled = true;
      this.group.add(mesh);
      this.chunks.push({ mesh, g, x0, north1, full: g.index.array.slice(), holed: false });
    }
    // Near the player, on a tile with the lidar residual: a 2 m mesh of the 1 m ground (see FineTerrain).
    this.fine = H.detail ? new FineTerrain(this) : null;
  }
  // Each frame, with the player's position: keeps the fine mesh centred on them (a step at a time,
  // built over a few frames and swapped in whole).
  update(x, z) { if (this.fine) this.fine.update(x, -z); }
  // A/B switch (timing, comparisons): off drops the fine mesh and closes the coarse hole; footing follows.
  setFine(on) { if (this.fine) this.fine.setEnabled(on); }
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
  setTexture(image) {
    this.uniforms.map.value = this.textureFor(image);
    const own = image === this.tile.textureImage || image === this.tile.imageryTextureImage;
    this.uniforms.ripOn.value = own ? 1 : 0;
    if (own) this.uniforms.ripRef.value.copy(this.riparianRef(image));
  }
  // Linear mean of an image over the tile's interior riparian cells (all eight neighbours riparian
  // too, so the mean is the corridor's own colour, not its edges'), cached per image.
  riparianRef(image) {
    this.ripRefs ??= new Map();
    let r = this.ripRefs.get(image);
    if (r) return r;
    const g = this.tile.habitat.img, W = g.width, H = g.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data, lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const rip = (i, j) => g.data[(Math.min(Math.max(j, 0), H - 1) * W + Math.min(Math.max(i, 0), W - 1)) * 4] === 6;
    const s = [0, 0, 0]; let n = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let all = true;
      for (let dj = -1; dj <= 1 && all; dj++) for (let di = -1; di <= 1 && all; di++) all = rip(i + di, j + dj);
      if (!all) continue;
      const k = (j * W + i) * 4; s[0] += lin(px[k]); s[1] += lin(px[k + 1]); s[2] += lin(px[k + 2]); n++;
    }
    r = n ? new THREE.Vector3(s[0] / n, s[1] / n, s[2] / n) : new THREE.Vector3(0.1, 0.12, 0.08);
    this.ripRefs.set(image, r);
    return r;
  }
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
    const rp = look.riparian;
    this.uniforms.ripMix.value = rp ? rp.mix : 0;
    if (rp) { this.uniforms.ripTint.value.setRGB(...rp.tint, THREE.SRGBColorSpace); this.uniforms.ripDark.value = rp.dark; }
  }
}

// ---- the near fine mesh -------------------------------------------------------------------------
// A square of the ground FINE_HALF m either side of a centre on the 10 m lattice, its vertices on the
// lidar residual's own pixel centres (odd metres, 2 m apart) plus one row on each edge on the 10 m line,
// heights from Heightfield.at, so it shows the 1 m ground (road cuts, gullies, terraces) and matches
// footing. The coarse chunks drop their quads under the square (a hole in their index), and the square's
// edge rows are pinned to the coarse surface: across the outer FINE_BAND m the heights (and normals) ease
// from the coarse mesh's to the fine ones, so the seam is watertight and nothing steps. A skirt hangs
// under the edge against any sub-pixel crack at the T-junctions. When the player strays FINE_RECENTRE m
// (either axis) from the centre a new square is computed in slices (a time budget per frame) into
// staging arrays and swapped in in one frame, coarse hole and Heightfield.ground's grid with it.
const FINE_HALF = 110, FINE_BAND = 20, FINE_RECENTRE = 10, FINE_SKIRT = 0.6, FINE_BUDGET_MS = 1.5;
class FineTerrain {
  constructor(terrain) {
    this.terrain = terrain; this.H = terrain.tile.heights; this.size = terrain.tile.size;
    const n = this.n = 2 * FINE_HALF / 2 + 2;           // vertices per side: edge, 109 odd metres... , edge
    const nv = n * n, ns = 4 * (n - 1);                 // grid + skirt (one ring of edge vertices)
    this.nGrid = nv;
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((nv + ns) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array((nv + ns) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((nv + ns) * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {   // j south to north, i west to east; split SW-NE
      const sw = j * n + i, se = sw + 1, nw = sw + n, ne = nw + 1;
      idx.push(sw, se, ne, sw, ne, nw);
    }
    // the skirt: the edge ring (counter-clockwise from the SW corner seen from above), each vertex copied FINE_SKIRT m lower
    this.ring = [];
    for (let i = 0; i < n - 1; i++) this.ring.push(i);                       // south edge, west to east
    for (let j = 0; j < n - 1; j++) this.ring.push(j * n + n - 1);           // east edge, south to north
    for (let i = n - 1; i > 0; i--) this.ring.push((n - 1) * n + i);         // north edge, east to west
    for (let j = n - 1; j > 0; j--) this.ring.push(j * n);                   // west edge, north to south
    const R = this.ring.length;
    for (let r = 0; r < R; r++) {
      const a = this.ring[r], b = this.ring[(r + 1) % R], a2 = nv + r, b2 = nv + (r + 1) % R;
      idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);   // both windings: a crack is seen from either side
    }
    g.setIndex(idx);
    this.tris = idx.length / 3;
    this.mesh = new THREE.Mesh(g, terrain.material); this.mesh.name = 'terrainFine'; this.mesh.frustumCulled = true;
    this.mesh.visible = false;
    terrain.group.add(this.mesh);
    this.cur = null; this.job = null;
    this.stats = { tris: this.tris, builds: 0, lastMs: 0, lastFrames: 0, maxSliceMs: 0, commitMs: 0 };
  }
  setEnabled(on) {
    if (on === !this.off) return;
    this.off = !on; this.job = null;
    if (!on) { this.hole(this.cur, { x0: 0, x1: 0, n0: 0, n1: 0 }); this.cur = null; this.mesh.visible = false; this.H.fine = null; }
  }
  update(x, north) {
    if (this.off) return;
    const c = this.cur;
    if (!this.job && (!c || Math.max(Math.abs(x - c.cx), Math.abs(north - c.cn)) > FINE_RECENTRE)) {
      const snap = v => Math.min(Math.max(Math.round(v / 10) * 10, FINE_HALF), this.size - FINE_HALF);
      this.job = this.start(snap(x), snap(north));
      if (!c) { this.run(this.job, Infinity); this.commit(this.job); this.job = null; return; }   // the first one at once
    }
    if (this.job) {
      const t0 = performance.now();
      if (this.run(this.job, FINE_BUDGET_MS)) { this.commit(this.job); this.job = null; }
      this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, performance.now() - t0);
    }
  }
  start(cx, cn) {
    const n = this.n, x0 = cx - FINE_HALF, n0 = cn - FINE_HALF, xs = new Float64Array(n), ns = new Float64Array(n);
    for (let k = 0; k < n; k++) { const o = k === 0 ? 0 : k === n - 1 ? 2 * FINE_HALF : 2 * k - 1; xs[k] = x0 + o; ns[k] = n0 + o; }
    return { cx, cn, x0, x1: cx + FINE_HALF, n0, n1: cn + FINE_HALF, xs, ns, step: 2, y: new Float32Array(n * n),
      t: new Float32Array(n * n), nc: new Float32Array(n * n * 3), row: 0, nrow: 0, ms: 0, frames: 0 };
  }
  // Heights (rows south to north) then normals, until the time budget is spent; true when done.
  run(J, budget) {
    const t0 = performance.now(), n = this.n, H = this.H, xs = J.xs, ns = J.ns, nc = new THREE.Vector3();
    J.frames++;
    while (J.row < n) {
      const j = J.row++;
      for (let i = 0; i < n; i++) {
        const k = j * n + i, x = this.vx(J, i, j), north = this.vn(J, i, j), e = Math.min(x - J.x0, J.x1 - x, north - J.n0, J.n1 - north);
        const s = Math.min(Math.max(e / FINE_BAND, 0), 1), t = s * s * (3 - 2 * s);
        J.t[k] = t;
        if (t >= 1) { J.y[k] = H.at(x, north); continue; }
        const c = H.coarse(x, north);
        J.y[k] = t > 0 ? c + t * (H.at(x, north) - c) : c;
        this.coarseNormal(x, north, nc); J.nc[k * 3] = nc.x; J.nc[k * 3 + 1] = nc.y; J.nc[k * 3 + 2] = nc.z;
      }
      if (performance.now() - t0 > budget) { J.ms += performance.now() - t0; return false; }
    }
    if (!J.nrm) J.nrm = new Float32Array(n * n * 3);
    while (J.nrow < n) {
      const j = J.nrow++, y = J.y, jm = Math.max(j - 1, 0), jp = Math.min(j + 1, n - 1);
      for (let i = 0; i < n; i++) {
        const k = j * n + i, im = Math.max(i - 1, 0), ip = Math.min(i + 1, n - 1);
        const gx = (y[j * n + ip] - y[j * n + im]) / (xs[ip] - xs[im]), gn = (y[jp * n + i] - y[jm * n + i]) / (ns[jp] - ns[jm]);
        let ax = -gx, ay = 1, az = gn;   // world normal of the height field (z = -north)
        const t = J.t[k];
        if (t < 1) {
          const l = Math.hypot(ax, ay, az);
          ax = J.nc[k * 3] + t * (ax / l - J.nc[k * 3]); ay = J.nc[k * 3 + 1] + t * (ay / l - J.nc[k * 3 + 1]); az = J.nc[k * 3 + 2] + t * (az / l - J.nc[k * 3 + 2]);
        }
        const l = Math.hypot(ax, ay, az);
        J.nrm[k * 3] = ax / l; J.nrm[k * 3 + 1] = ay / l; J.nrm[k * 3 + 2] = az / l;
      }
      if (performance.now() - t0 > budget) { J.ms += performance.now() - t0; return false; }
    }
    J.ms += performance.now() - t0;
    return true;
  }
  // Vertex position: the grid's, except along the square's edge, where the vertex just past each 10 m
  // coarse vertex moves back onto it, so the edge holds every coarse vertex and runs exactly along the
  // coarse triangles' edges (an odd-metre edge would cut the corner at each coarse vertex: a crack).
  vx(J, i, j) { const x = J.xs[i]; return (j === 0 || j === this.n - 1) && (x - 1) % 10 === 0 ? x - 1 : x; }
  vn(J, i, j) { const v = J.ns[j]; return (i === 0 || i === this.n - 1) && (v - 1) % 10 === 0 ? v - 1 : v; }
  // The coarse chunks' own vertex normal at a point, interpolated over the coarse triangle as its height is
  // (so the fine edge shades exactly as the coarse mesh beside it).
  coarseNormal(x, north, out) {
    const T = this.terrain, { chunks, cs, nv, spacing: S } = T.chunkInfo, size = this.size, nMax = Math.round(size / S) - 1;
    const fx = x / S, fn = north / S, i0 = Math.min(Math.max(Math.floor(fx), 0), nMax), n0 = Math.min(Math.max(Math.floor(fn), 0), nMax);
    const u = Math.min(Math.max(fx - i0, 0), 1), w = Math.min(Math.max(fn - n0, 0), 1);
    const cx = Math.min(Math.floor((i0 + 0.5) * S / cs), chunks - 1), cy = Math.min(Math.floor((size - (n0 + 0.5) * S) / cs), chunks - 1);
    const ch = T.chunks[cy * chunks + cx], a = ch.g.attributes.normal.array;
    const v = (X, N) => (Math.round((ch.north1 - N) / S) * nv + Math.round((X - ch.x0) / S)) * 3;
    const SW = v(i0 * S, n0 * S), SE = v((i0 + 1) * S, n0 * S), NW = v(i0 * S, (n0 + 1) * S), NE = v((i0 + 1) * S, (n0 + 1) * S);
    for (let c = 0; c < 3; c++) {
      const sw = a[SW + c], se = a[SE + c], nw = a[NW + c], ne = a[NE + c];
      out.setComponent(c, w > u ? sw + u * (ne - nw) + w * (nw - sw) : sw + u * (se - sw) + w * (ne - se));
    }
    return out.normalize();
  }
  commit(J) {
    const t0 = performance.now(), n = this.n, g = this.geo, size = this.size;
    const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv.array;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = this.vx(J, i, j), north = this.vn(J, i, j);
      P[k * 3] = x; P[k * 3 + 1] = J.y[k]; P[k * 3 + 2] = -north;
      U[k * 2] = x / size; U[k * 2 + 1] = north / size;
    }
    N.set(J.nrm, 0);
    for (let r = 0; r < this.ring.length; r++) {
      const a = this.ring[r], s = this.nGrid + r;
      P[s * 3] = P[a * 3]; P[s * 3 + 1] = P[a * 3 + 1] - FINE_SKIRT; P[s * 3 + 2] = P[a * 3 + 2];
      N[s * 3] = N[a * 3]; N[s * 3 + 1] = N[a * 3 + 1]; N[s * 3 + 2] = N[a * 3 + 2];
      U[s * 2] = U[a * 2]; U[s * 2 + 1] = U[a * 2 + 1];
    }
    for (const a of Object.values(g.attributes)) a.needsUpdate = true;
    g.computeBoundingSphere();
    this.hole(this.cur, J);
    this.cur = J; this.mesh.visible = true;
    this.H.fine = { x0: J.x0, x1: J.x1, n0: J.n0, n1: J.n1, xs: J.xs, ns: J.ns, step: J.step, y: J.y, band: FINE_BAND };
    const st = this.stats; st.builds++; st.lastMs = Math.round(J.ms * 100) / 100; st.lastFrames = J.frames;
    st.commitMs = Math.round((performance.now() - t0) * 100) / 100;
  }
  // Re-index the coarse chunks the old or new square touches: every quad wholly inside the new square is dropped.
  hole(old, J) {
    const T = this.terrain, { cs, nv, spacing: S } = T.chunkInfo, q = nv - 1;
    for (const ch of T.chunks) {
      const hit = R => R && R.x0 < ch.x0 + cs && R.x1 > ch.x0 && R.n0 < ch.north1 && R.n1 > ch.north1 - cs;
      if (!hit(J) && !(ch.holed && hit(old))) continue;
      const idx = ch.g.index, out = idx.array, full = ch.full;
      let m = 0;
      for (let iy = 0; iy < q; iy++) {
        const nTop = ch.north1 - iy * S, nBot = nTop - S, rowIn = nBot >= J.n0 && nTop <= J.n1;
        for (let ix = 0; ix < q; ix++) {
          const xl = ch.x0 + ix * S;
          if (rowIn && xl >= J.x0 && xl + S <= J.x1) continue;
          const o = (iy * q + ix) * 6;
          for (let c = 0; c < 6; c++) out[m++] = full[o + c];
        }
      }
      ch.g.setDrawRange(0, m); idx.needsUpdate = true; ch.holed = m < full.length;
    }
  }
}
