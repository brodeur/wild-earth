import * as THREE from 'three';
import { drain } from './slice.js';
import { uploadImageSteps, canBand } from './gpuUpload.js';
import { releaseGeometry, releaseTexture } from './gpuRelease.js';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { windUniforms, WIND_GLSL } from './wind.js';
import { GroundDetail, detailUniforms, DETAIL_GLSL, buildDetailMaskSteps, resetDetailUniforms, detailWeightsAt, setDetailOrigin } from './groundDetail.js';
import { SeasonColour, LITTER } from './season.js';
import { bodyScale, onBodyScale } from './bodyScale.js';

// The ground, at every distance. Far: a 10 m mesh of the tile in 100 chunks (Terrain). Near, on a tile with the lidar
// residual: a 2 m square FINE_HALF m either side of the player (FineTerrain), the 1 m ground. Under the body: the micro
// patch (MicroPatch), a square of 96 cells whose side follows the body scale (3.9 m at 4 cm for a lizard, 24 m at
// 25 cm for a deer) with its lighting normals at 1 cm and 6 cm, the surface beneath raised by a few cm of relief chosen
// by the ground's material (rock ridges, pebbles, tussocks, litter), the same function in JS (Heightfield.ground, so
// feet stand on the bumps) and GLSL. One
// fragment shader colours all three: the photo (or the habitat texture) re-coloured by season, the near-detail scans
// within 250 m (groundDetail.js), and, within the micro patch, the scans again at a tenth of their repeat (the third
// octave), so the ground a lizard sees from 9 cm is stems and grain rather than a magnified texture.

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
  // Measured season (season.js SeasonColour): the ground texture times seasonMap's multiplier (stored as
  // multiplier / 2 in an sRGB texture, 20 m, smooth), in place of the palette; 1 while the map is the
  // ground or imagery texture of a tile with the seasons layers.
  seasonMap: { value: null }, seasonOn: { value: 0 },
  // Weather (weather.js): x the ground's wetness (darker, a little more saturated), y lying snow's cover of the ground,
  // z its cover on the grass (grass.js); 0 in dry weather.
  wxGround: { value: new THREE.Vector3() },
};
// The measured season for the CPU side: grass.js takes its blades' tint from `grass` (the open grass's
// flat-ground ratio for the date over July, linear) when it is set; `version` bumps on each change.
export const seasonState = { grass: null, date: null, version: 0 };
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
  uniform sampler2D seasonMap; uniform float seasonOn; uniform vec3 wxGround;
  const vec3 G_LUMA = vec3(0.299, 0.587, 0.114);
  // Weather on the ground (wxGround): wet ground about 40% darker and a little more saturated; lying snow over it,
  // fullest on flat ground and north-facing slopes (ny: the normal's y, north: 0..1 how much the slope faces north),
  // thinner under tree cover (tree 0..1).
  vec3 groundWeather(vec3 c, float ny, float north, float tree) {
    if (wxGround.x + wxGround.y <= 0.0) return c;
    float l = dot(c, G_LUMA);
    c = mix(c, max(mix(vec3(l), c, 1.2), 0.0) * 0.6, wxGround.x);
    float s = wxGround.y * (0.5 + 0.5 * smoothstep(0.7, 0.96, ny)) * (1.0 + 0.4 * north) * (1.0 - 0.45 * tree);
    return mix(c, vec3(0.72, 0.75, 0.8), clamp(s, 0.0, 1.0));
  }
  vec2 groundUv(vec3 posW) { return vec2(posW.x, -posW.z) / tileSize; }
  float groundPave(vec2 uv, float lod) { return smoothstep(0.55, 0.75, textureLod(roads, uv, lod).r); }
  // Season recolour of a texel (linear) given its soft habitat weights (grassland, oak, chaparral), its
  // uv and its pavement weight (decayed pavement keeps its grey).
  vec3 groundRecolour(vec3 c, vec3 w, vec2 uv, float pave) {
    if (seasonOn > 0.5) {
      // Measured: the Sentinel-2 ratio for the date over July, the litter under closed canopy (season.js).
      return c * mix(textureLod(seasonMap, uv, 0.0).rgb * 2.0, vec3(1.0), pave);
    }
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
    return groundWeather(groundRecolour(textureLod(map, uv, lod).rgb, w, uv, groundPave(uv, lod)), 1.0, 0.0, 0.0);
  }
`;

const VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW; varying vec3 vRel;
  uniform vec3 detailOrigin;   // groundDetail.js: the third octave's origin, near the micro patch
  void main(){
    vUv = uv; vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0); vPosW = wp.xyz; vRel = wp.xyz - detailOrigin;
    vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  }`;
const FRAG = /* glsl */`
  varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW; varying vec3 vRel;
  #ifdef MICRO_PATCH
  varying vec3 vNormalMac;   // the micro patch: the surface's normal beneath its relief, for the material rules
  varying vec2 vMicroUv; uniform sampler2D mcNrm;   // and where on the patch, for the relief's gradient (MicroPatch bake)
  #endif
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
    vec3 c = groundRecolour(texture2D(map, vUv).rgb, w, vUv, smoothstep(0.55, 0.75, road));
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
    // The normal the material rules read (slope, the biplanar projection, cliffs): on the micro patch the surface's
    // beneath its relief, so a tussock's flank or a pebble's side never turns to rock; elsewhere the geometric one.
    #ifdef MICRO_PATCH
    vec3 nMac = normalize(vNormalMac);
    vec2 mg = texture2D(mcNrm, vMicroUv).rg;            // the relief's gradient: the surface's slope plus it, z = -north
    nGeo = normalize(nMac / max(nMac.y, 0.05) + vec3(-mg.x, 0.0, mg.y)); nL = nGeo;
    #else
    vec3 nMac = nGeo;
    #endif
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
      float slopeDeg = max(mk.r * 90.0, geoSlope * degrees(acos(clamp(nMac.y, 0.0, 1.0)))), curv = mk.g * 2.0 - 1.0, bare = mk.b, tree = clamp(cov.r, 0.0, 1.0);
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
      int axA = 1, axB = 1, mSec = i2; float mB = b * smoothstep(0.819, 0.87, nMac.y);
      if (nMac.y < 0.819) {
        vec3 aw = max(abs(nMac) - 0.5773, 0.0);
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
      // Third octave (groundDetail.js dSample3): within the micro patch, the top material again at a tenth of its repeat,
      // multiplied into both materials' albedo ratio and added to their tangent normals (the second material's own copy
      // cost 0.3 ms more for what shows only along a border); fades with camera distance over the patch's size and once
      // a 0.2 m repeat spans under ~40 pixels.
      float f3 = detailOct3.z * (1.0 - smoothstep(detailOct3.x, detailOct3.y, dist)) * (1.0 - smoothstep(0.2 / 40.0, 0.2 / 12.0, foot));
      if (f3 > 0.0) {
        vec3 b3, u3;
        dSample3(i1, axA, vRel, warp, dpx, dpy, b3, u3);
        b3 = mix(vec3(1.0), b3, f3); a1c *= b3; a2c *= b3;
        t1.xy += u3.xy * f3; t2.xy += u3.xy * f3;
      }
      float con = mix(detailContrast[i1], detailContrast[mSec], mB);
      float m1 = rnoise(vPosW.xz + 5.0, 0.2, 29.0), m2 = rnoise(vPosW.xz + 41.0, 1.3, 47.0);
      c *= mix(vec3(1.0), mix(a1c, a2c, mB), fade * con * (0.7 + 0.6 * m1)) * mix(1.0, 0.9 + 0.2 * m2, fade);
      vec3 nd = normalize(mix(dToWorld(axA, t1, nGeo), dToWorld(axB, t2, nGeo), mB));
      nL = normalize(mix(nGeo, nd, fade));
    }
    // Cliffs at any distance (2026-10-28, Yosemite's walls): past ~35 degrees the photo is a smooth grey, so the face
    // gets ledges (bands by height, 7 m and 2.6 m, wandering along the face) and streaks (water stains running down),
    // as a tone on the colour and a tilt of the lighting normal about the horizontal, so ledge tops catch the sun and
    // their undersides shade. Backs off where the near detail's rock takes over.
    {
      vec4 mkC = textureLod(detailMask, vUv, 0.0);
      float slopeC = max(mkC.r * 90.0, geoSlope * degrees(acos(clamp(nMac.y, 0.0, 1.0))));
      float cliff = smoothstep(33.0, 45.0, slopeC) * (1.0 - 0.7 * fade);
      if (cliff > 0.0) {
        vec2 along = normalize(vec2(nMac.z, -nMac.x) + vec2(1e-4, 0.0));
        float fx = dot(vPosW.xz, along);                                          // metres along the face
        float y0 = vPosW.y + (rnoise(vec2(fx, vPosW.y), 0.3, 38.0) - 0.5) * 9.0;  // the bands wander by +-4.5 m along the face
        float l1 = rnoise(vec2(y0, 0.0), 0.0, 7.0), l2 = rnoise(vec2(y0 + 3.1, 0.0), 0.0, 2.6);
        float l1u = rnoise(vec2(y0 + 0.5, 0.0), 0.0, 7.0), l2u = rnoise(vec2(y0 + 3.6, 0.0), 0.0, 2.6);
        float ledge = 0.65 * l1 + 0.35 * l2, dLedge = (0.65 * l1u + 0.35 * l2u) - ledge;   // the relief's rise per half metre up
        float streak = rnoise(vec2(fx, vPosW.y * 0.08), 0.0, 1.4);                 // stains: ~1.4 m across, ~17 m long
        c *= 1.0 + cliff * (0.28 * (ledge - 0.5) - 0.18 * (streak - 0.5));
        nL = normalize(nL - vec3(0.0, 4.0 * cliff * dLedge, 0.0));                 // relief out along the normal: rising relief faces down
      }
    }
    // Same light as the lambert trees: sun (under cloud and cast shadow) plus hemisphere sky, over pi.
    // The terrain casts with its back faces (shadows.js), so a sunlit slope never shadows itself
    // and the normal offset here only has to clear the tree casters' depth. Cast shadows use the
    // geometric normal; the detail normal only bends the sun term, and never lights a face the geometry turns away from the sun.
    // The bumped term is divided by the cosine of the bump's tilt, which keeps the mean at the
    // flat-ground value (tilts toward and away from the sun average back to cos(sun)), so the
    // detail adds relief without dimming the photo.
    c = groundWeather(c, nGeo.y, clamp(-nGeo.z * 3.0, 0.0, 1.0), clamp(cov.r, 0.0, 1.0));
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
  return releaseTexture(t);   // its bytes go once uploaded (gpuRelease.js)
}

// The constructor only records its arguments; build() (a generator main.js steps with slice.js runSliced, a terrain
// chunk at a time, so the opening screen keeps responding; drain(terrain.build()) runs it in one go) makes everything.
export class Terrain {
  constructor(tile, { chunks = 10, spacing = 10 } = {}) {
    this.tile = tile; this.group = new THREE.Group(); this.textures = new Map(); this.opts = { chunks, spacing };
  }
  *build() {
    const tile = this.tile, { chunks, spacing } = this.opts;
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
    // Measured season colour (tile-spec "Seasonal colour", season.js): a 20 m multiplier texture, rebuilt on
    // the CPU when the date changes (setDate). Until then, and on a tile without the layers, it is 1.
    yield 'textures';
    this.season = tile.seasonImage && tile.manifest.layers['client.season_rgb'] ? new SeasonColour(tile) : null;
    yield 'SeasonColour';
    const SN = this.season ? this.season.N : 1, sm = new THREE.DataTexture(new Uint8Array(SN * SN * 4).fill(188), SN, SN);   // sRGB 188 = 0.5: x 2 = 1
    sm.colorSpace = THREE.SRGBColorSpace; sm.magFilter = THREE.LinearFilter; sm.minFilter = THREE.LinearFilter; sm.generateMipmaps = false;
    sm.needsUpdate = true; G.seasonMap.value = sm;
    this.useLitter = !!tile.groundTextureImage;   // main.js turns it off for ?base=imagery (crowns still in the photo)
    // Near-ground detail materials and their per-tile masks (groundDetail.js); textures stream in after.
    this.detail = new GroundDetail(tile, { mask: yield* buildDetailMaskSteps(tile) });
    yield 'GroundDetail';
    ripUniforms.ripMask.value = riparianMask(tile);
    yield 'riparianMask';
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
      // Positions, normals and uvs go once uploaded (gpuRelease.js; 31 MB a tile): the heights are tile.heights, the uv is
      // x / size, and the normals are made again where the fine mesh needs them (chunkVertexNormal). The index stays:
      // FineTerrain.hole rewrites it.
      releaseGeometry(g, { keepIndex: true });
      const mesh = new THREE.Mesh(g, this.material); mesh.frustumCulled = true;
      this.group.add(mesh);
      this.chunks.push({ mesh, g, x0, north1, holed: false });
      yield;
    }
    // Near the player, on a tile with the lidar residual: a 2 m mesh of the 1 m ground (see FineTerrain).
    this.fine = H.detail ? new FineTerrain(this) : null;
    // Under the body, on every tile: the micro patch (see MicroPatch), sized by the body scale. The terrain material
    // records the camera it is drawn with, so the patch can park while the camera is high above the ground.
    this.micro = new MicroPatch(this);
    this.micro.setScale(bodyScale.v);
    this.unScale = onBodyScale(v => this.micro?.setScale(v));
    this.material.onBeforeRender = (r, sc, cam) => { if (cam.isPerspectiveCamera && this.micro) { this.micro.cam = cam; this.micro.renderer = r; } };
  }
  // The large ground images (the 4000 px photo, the 2000 px masks and roads) to the GPU a band at a time (gpuUpload.js;
  // main.js steps this before the first frame): three's own upload of such an image is one call of 50-350 ms. Each
  // becomes an ExternalTexture with the texels, sampler and mips three would have given the texture it replaces.
  *uploadSteps(renderer) {
    const G = groundUniforms;
    if (!canBand(renderer)) return;
    for (const k of ['map', 'masks', 'roads']) {
      const t = G[k].value, img = t?.image;
      if (!t || t.isExternalTexture || !img?.blob || img.width * img.height < 2000 * 2000) continue;
      yield `upload ${k}`;
      const ext = yield* uploadImageSteps(renderer, t);
      G[k].value = ext;
      for (const [im, tt] of this.textures) if (tt === t) this.textures.set(im, ext);
    }
  }
  // The world is being torn down (main.js disposes its scene, and with it these textures): the module's shared uniforms
  // let go of this tile's textures (the 4000 px photo and the rest), so nothing holds the abandoned world's images
  // until the next world sets its own.
  dispose() {
    for (const k of ['map', 'masks', 'roads', 'canopyMap', 'seasonMap', 'contactAO']) groundUniforms[k].value = null;
    this.unScale?.(); this.unScale = null;   // the body-scale listener, and the micro patch's mesh, texture and arrays
    this.micro?.dispose(); this.micro = null; this.material.onBeforeRender = () => {};
    if (this.tile.heights) this.tile.heights.micro = null;
    ripUniforms.ripMask.value = null;
    resetDetailUniforms();
    seasonState.grass = null; seasonState.date = null; seasonState.version++;
    this.textures.clear(); this.season = null;
  }
  // Each frame, with the player's position: keeps the fine mesh and the micro patch centred on them (a step at a time,
  // built over a few frames and swapped in whole).
  update(x, z) { if (this.fine) this.fine.update(x, -z); if (this.micro) this.micro.update(x, -z); }
  // A/B switch (timing, comparisons): off drops the fine mesh and closes the coarse hole; footing follows.
  setFine(on) { if (this.fine) this.fine.setEnabled(on); }
  // A/B switch: off hides the micro patch and the third octave; footing follows (Heightfield.micro null).
  setMicro(on) { if (this.micro) this.micro.setEnabled(on); }
  // The coarse chunks' own vertex normal at a point, interpolated over the coarse triangle as its height is (so a
  // fine or micro edge shades exactly as the coarse mesh beside it). The chunks' normal arrays are let go once uploaded
  // (gpuRelease.js, 12 MB a tile), so the vertex normals are made again (chunkVertexNormal), the value the array held,
  // kept in cache (a Map the caller owns) by vertex.
  coarseNormalAt(x, north, out, cache) {
    const { chunks, cs, nv, spacing: S } = this.chunkInfo, size = this.tile.size, nMax = Math.round(size / S) - 1;
    const fx = x / S, fn = north / S, i0 = Math.min(Math.max(Math.floor(fx), 0), nMax), n0 = Math.min(Math.max(Math.floor(fn), 0), nMax);
    const u = Math.min(Math.max(fx - i0, 0), 1), w = Math.min(Math.max(fn - n0, 0), 1);
    const cx = Math.min(Math.floor((i0 + 0.5) * S / cs), chunks - 1), cy = Math.min(Math.floor((size - (n0 + 0.5) * S) / cs), chunks - 1);
    const ci = cy * chunks + cx, ch = this.chunks[ci];
    const v = (X, N) => {
      const ix = Math.round((X - ch.x0) / S), iy = Math.round((ch.north1 - N) / S), key = (ci * nv + iy) * nv + ix;
      let n = cache.get(key);
      if (!n) { n = chunkVertexNormal(this.tile.heights, ch, nv, cs, ix, iy); cache.set(key, n); }
      return n;
    };
    const sw = v(i0 * S, n0 * S), se = v((i0 + 1) * S, n0 * S), nw = v(i0 * S, (n0 + 1) * S), ne = v((i0 + 1) * S, (n0 + 1) * S);
    for (let c = 0; c < 3; c++) out.setComponent(c, w > u ? sw[c] + u * (ne[c] - nw[c]) + w * (nw[c] - sw[c]) : sw[c] + u * (se[c] - sw[c]) + w * (ne[c] - se[c]));
    return out.normalize();
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
  setTexture(image) {
    this.uniforms.map.value = this.textureFor(image);
    const photo = image === this.tile.groundTextureImage || image === this.tile.imageryTextureImage;
    this.uniforms.seasonOn.value = photo && this.season ? 1 : 0;   // the measured multiplier is for the July photo
    const own = image === this.tile.textureImage || photo;
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
  // Season palette. On a tile with the seasons layers (after setDate) the habitat texture's grass, oak and
  // riparian take the measured class means (open_grass, oak_woodland, riparian: month over July, linear)
  // and the photo's riparian corridor is in the multiplier with every other class; else the hand palette.
  setLook(look) {
    const u = this.uniforms, m = this.measured;
    if (m?.grass) u.grassTint.value.setRGB(0.84 * m.grass[0], 0.77 * m.grass[1], 0.47 * m.grass[2]);   // the habitat texture's own grass x the ratio
    else u.grassTint.value.setRGB(...look.grass);
    if (m?.oak) { u.oakTint.value.setRGB(0.67 * m.oak[0], 0.59 * m.oak[1], 0.28 * m.oak[2]); u.oakMix.value = 1; }
    else { u.oakTint.value.setRGB(...look.oakLeaf); u.oakMix.value = 1 - look.oakLeafOn; }
    const rp = look.riparian;
    if (u.seasonOn.value > 0.5) u.ripMix.value = 0;
    else if (m?.rip) {
      const r = u.ripRef.value, q = m.rip;
      u.ripTint.value.setRGB(r.x * q[0], r.y * q[1], r.z * q[2]); u.ripDark.value = 0.299 * q[0] + 0.587 * q[1] + 0.114 * q[2]; u.ripMix.value = 1;
    } else {
      u.ripMix.value = rp ? rp.mix : 0;
      if (rp) { u.ripTint.value.setRGB(...rp.tint, THREE.SRGBColorSpace); u.ripDark.value = rp.dark; }
    }
  }
  // The measured season for a date (a Date; only month and day count): the multiplier texture from the two
  // months around it, and the class ratios for the habitat texture's palette and the grass blades. Returns
  // false on a tile without the seasons layers (the palette stays). CPU work only when the day changes.
  // setDateSteps: the same, as a generator that yields while the season colour builds (slice.js; main.js steps it
  // during the world build so the setDate that follows finds the date done).
  setDate(date) { return drain(this.setDateSteps(date)); }
  *setDateSteps(date) {
    if (!this.season) return false;
    const key = `${date.getMonth()}-${date.getDate()}-${this.useLitter}`;
    if (key === this.dateKey) return true;
    const t0 = performance.now(), S = this.season;
    const litter = this.useLitter ? yield* this.litterSteps() : null;
    const r = yield* S.buildSteps(date, litter), N = r.size, tex = this.uniforms.seasonMap.value, d = tex.image.data;
    for (let j = 0; j < N; j++) d.set(r.pixels.subarray(j * N * 4, (j + 1) * N * 4), (N - 1 - j) * N * 4);   // rows north first -> a DataTexture's south first
    tex.needsUpdate = true; this.dateKey = key;
    const mr = k => S.manifestRatio(date, k);
    this.measured = { grass: mr('open_grass') || mr('grassland'), oak: mr('oak_woodland'), rip: mr('riparian') };
    seasonState.grass = r.classes[5] || this.measured.grass; seasonState.date = date; seasonState.version++;
    this.seasonStats = { ms: Math.round(performance.now() - t0), months: r.months, slope: r.slope.map(v => +v.toFixed(3)), classes: r.classes };
    return true;
  }
  // Litter multipliers [needle, oak] (linear): litter albedo over the ground texture's own mean under
  // closed canopy (tree cover 60% and more), where the crown fill is a flat dry-grass beige. Once.
  litterTints() { return drain(this.litterSteps()); }
  *litterSteps() {
    if (this._litter) return this._litter;
    const S = this.season; yield* S.prepareSteps();
    yield;
    const N = S.N, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.tile.groundTextureImage, 0, 0, N, N);
    const px = ctx.getImageData(0, 0, N, N).data, lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const s = [0, 0, 0]; let n = 0;
    for (let k = 0; k < N * N; k++) if (S.cov[k] >= 0.6 && S.cls[k] !== 7) { for (let q = 0; q < 3; q++) s[q] += lin(px[k * 4 + q]); n++; }
    const fill = n > 50 ? s.map(v => v / n) : [0.25, 0.23, 0.15];
    const tint = srgb => srgb.map((v, q) => lin(v * 255) / Math.max(fill[q], 1e-3));
    this.fillMean = fill.map(v => +v.toFixed(4));
    return (this._litter = [tint(LITTER.needle), tint(LITTER.oak)]);
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
// A coarse chunk's vertex normal, as THREE.BufferGeometry.computeVertexNormals made it in Terrain.build: the plane's
// triangles that meet at vertex (column ix, row iy) — quad (qx, qy) is (a, b, d) then (b, c, d) with a = qx + nv * qy,
// b a row south, c and d a column east, the quads in row order — each face's unnormalised cross product added in that
// order and rounded to float32 at each step as the attribute array rounded it, then normalised as Vector3 does. The
// positions are made as the build made them (PlaneGeometry's float32 corner plus the chunk's origin, the height from
// H.vert at the same double), so the result is what the array held, bit for bit (checked over every vertex of the
// home tile's 100 chunks before the arrays were let go).
function chunkVertexNormal(H, ch, nv, cs, ix, iy) {
  const q = nv - 1, sw = cs / q, f = Math.fround;
  const P = (i, j) => {
    const lx = f(i * sw - cs / 2) + cs / 2, lz = f(j * sw - cs / 2) + cs / 2, x = ch.x0 + lx, north = ch.north1 - lz;
    return [f(x), f(H.vert(x, north)), f(-north)];
  };
  let nx = 0, ny = 0, nz = 0;
  const face = (A, B, C) => {   // cb x ab, accumulated as computeVertexNormals does
    const cbx = C[0] - B[0], cby = C[1] - B[1], cbz = C[2] - B[2], abx = A[0] - B[0], aby = A[1] - B[1], abz = A[2] - B[2];
    nx = f(nx + (cby * abz - cbz * aby)); ny = f(ny + (cbz * abx - cbx * abz)); nz = f(nz + (cbx * aby - cby * abx));
  };
  const quad = (qx, qy, first, second) => {
    if (qx < 0 || qy < 0 || qx >= q || qy >= q) return;
    const a = P(qx, qy), b = P(qx, qy + 1), c = P(qx + 1, qy + 1), d = P(qx + 1, qy);
    if (first) face(a, b, d);
    if (second) face(b, c, d);
  };
  quad(ix - 1, iy - 1, false, true); quad(ix, iy - 1, true, true); quad(ix - 1, iy, true, true); quad(ix, iy, true, false);
  const k = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
  return [f(nx * k), f(ny * k), f(nz * k)];
}
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
        this.coarseNormal(x, north, nc, J); J.nc[k * 3] = nc.x; J.nc[k * 3 + 1] = nc.y; J.nc[k * 3 + 2] = nc.z;
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
  // The coarse chunks' own vertex normal at a point (Terrain.coarseNormalAt), a few hundred per rebuild, cached on the job.
  coarseNormal(x, north, out, J) { return this.terrain.coarseNormalAt(x, north, out, J.normals ??= new Map()); }
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
    this.H.fine = { x0: J.x0, x1: J.x1, n0: J.n0, n1: J.n1, xs: J.xs, ns: J.ns, step: J.step, y: J.y, band: FINE_BAND, nrm: J.nrm };   // nrm: the vertex normals (the micro patch interpolates them)
    const st = this.stats; st.builds++; st.lastMs = Math.round(J.ms * 100) / 100; st.lastFrames = J.frames;
    st.commitMs = Math.round((performance.now() - t0) * 100) / 100;
  }
  // Re-index the coarse chunks the old or new square touches: every quad wholly inside the new square is dropped. The
  // index is written again in the plane's own order (THREE.PlaneGeometry: quad (ix, iy) is the triangles (a, b, d) and
  // (b, c, d) with a = ix + nv * iy, b below it, c and d one column east), so no copy of the full index is kept.
  hole(old, J) {
    const T = this.terrain, { cs, nv, spacing: S } = T.chunkInfo, q = nv - 1, full = q * q * 6;
    for (const ch of T.chunks) {
      const hit = R => R && R.x0 < ch.x0 + cs && R.x1 > ch.x0 && R.n0 < ch.north1 && R.n1 > ch.north1 - cs;
      if (!hit(J) && !(ch.holed && hit(old))) continue;
      const idx = ch.g.index, out = idx.array;
      let m = 0;
      for (let iy = 0; iy < q; iy++) {
        const nTop = ch.north1 - iy * S, nBot = nTop - S, rowIn = nBot >= J.n0 && nTop <= J.n1;
        for (let ix = 0; ix < q; ix++) {
          const xl = ch.x0 + ix * S;
          if (rowIn && xl >= J.x0 && xl + S <= J.x1) continue;
          const a = ix + nv * iy, b = a + nv, c = b + 1, d = a + 1;
          out[m++] = a; out[m++] = b; out[m++] = d; out[m++] = b; out[m++] = c; out[m++] = d;
        }
      }
      ch.g.setDrawRange(0, m); idx.needsUpdate = true; ch.holed = m < full;
    }
  }
}

// ---- the micro patch ----------------------------------------------------------------------------
// The ground under the body, at the body's own scale (2026-10-28). The fine square's 2 m triangles are smooth
// to a lizard 9 cm up: a square of side L = clamp(24 sqrt(scale), 3, 24) m (bodyScale.js: 3.9 m for a lizard,
// 9.5 m for a rabbit, 24 m for a deer, the spirit and the fliers) of MICRO_CELLS cells a side (4 cm, 10 cm, 25 cm)
// is drawn over the fine (or coarse) mesh, its vertices on the surface drawn there (Heightfield groundIn: the fine
// triangles, with their vertex normals interpolated as the GPU does) raised by micro(x, north), a few cm of relief
// chosen by the ground's material; its lighting normals come from the relief's gradient baked at MICRO_NRM texels a
// side (1 cm for a lizard, 6 cm for a deer), so the relief's finest octaves light even where the cells cannot hold
// them. The mesh under it keeps drawing: the relief is never negative, so the patch is on or above it, it is drawn
// first (renderOrder -1) so the fragments beneath fail the depth test, and a constant polygon offset wins the ties
// where the relief is nothing (pavement, water, the patch's edge). Across its outer MICRO_BAND of the side the relief
// eases to nothing with a smoothstep, whose slope is nothing at the edge too, so the edge meets the mesh beneath in
// height and normal and does not show.
//
// micro(x, north) = rock x ridged + gravel x pebbly + thatch x tussocks + litter x smooth, each a sum of value
// noise on rotated lattices (as the terrain shader's rnoise, with the same integer hash) at 1.6, 0.5, 0.15 and
// 0.05 m and a 0.35 m tussock lattice; an octave under 3 cells of the patch fades out (a lizard keeps all five, a
// deer the 1.6 and 0.5 m ones), so the relief is one function of world position for a given body. The four
// amplitudes (m) come from material nodes on a 1 m world lattice (MICRO_NODES square, re-made as the patch moves,
// a node's value a function of its position alone, the ones the last patch held copied), bilinear between them:
//   material   the terrain shader's own rule (groundDetail.js detailWeightsAt: thatch in open grassland, litter under
//              trees, gravel on chaparral, bare and convex ground, rock on steep, concave or barren ground, pavement on
//              the decayed roads), squared and normalised so the top material leads as the shader's top two do, times
//              MICRO_AMP (rock 12 cm, gravel 4, tussocks 10, litter 2; pavement and water nothing)
//   roughness  with client/lidar_micro.png: its G (the ground returns' spread about the 1 m DEM surface, the slope and
//              curvature removed by the pipeline) less the ranging noise (the tile's 10th percentile, 0.95 cm at home), in quadrature,
//              takes rock, gravel and litter from 0.6x (smooth) up by 1x per 5 cm, to 2.2x (a 37 degree outcrop at
//              home: 26 cm ridges); its B (the low vegetation's multi-return share) adds to the thatch weight and
//              its amplitude (0.75x to 1.25x); its R (ground-return intensity) scales the photo's bare reading 0.75x
//              to 1.25x, less where B says the bright return is dry grass. Without it, where the tile has the lidar
//              residual (terrain_detail.png), the RMS of the residual's 2 m laplacian over 6 m (a boulder field, an
//              outcrop step; its 4 cm steps read as ~1.3 cm, so below 2 cm nothing counts) takes them 0.7x to 1.5x
//   slope      on ground steeper than 18-35 degrees the two coarse octaves are blended toward copies stretched 3x
//              along the fall line (four fixed directions, the two nearest blended), so rock and scree run downhill
// The same function is in GLSL (MICRO_GLSL, the lattice frames as constants and each frame's offset at the patch's
// origin split into an integer and a fraction, so float32 holds 1e-5 of a lattice cell; it agrees with the JS to
// under a micrometre). The CPU builds only the surface beneath (positions relative to the patch origin, a whole
// metre), in slices of MICRO_BUDGET_MS like the fine square, and the swap in a frame of its own; the GPU bakes the
// relief at the vertices and its gradient (MicroPatch.bake), and the material rules (slope, biplanar rock, cliffs)
// keep the surface's normal (vNormalMac), so a tussock's flank never turns to rock.
// Heightfield.ground returns the patch's surface as drawn (the vertices' heights, lazily, between them as the
// triangles are split); Heightfield.micro publishes the patch ({ x0, x1, n0, n1, band, step, version, fn, ground }).
// It follows the player, re-centred when they stray MICRO_RECENTRE of the side, the body always inside the eased
// band so the relief under it never changes with a move, and parks (hidden, Heightfield.micro null, the third
// octave off) while the camera is more than the side (at least 4 m) above the ground: a flying spirit pays nothing.
// Measured 2026-10-28 (GPU timer queries around 40 draws, the terrain alone, 1717 x 1363, the machine shared with
// other work): the patch and the third octave add 1.0 ms over the fine mesh alone for a lizard, 0.9 a vole, 1.3 a
// rabbit, 0.7 a deer; the CPU 0.07 ms a frame on average, a rebuild slice at most ~1.2 ms.
const MICRO_CELLS = 96, MICRO_NRM = 384, MICRO_BAND = 0.15, MICRO_RECENTRE = 0.1, MICRO_NODES = 32, MICRO_BUDGET_MS = 1;
const MICRO_AMP = { rock: 0.12, gravel: 0.04, thatch: 0.1, litter: 0.02 };
const MICRO_OCT = [[1.6, 0.42], [0.5, 1.37], [0.15, 2.29], [0.05, 0.93], [0.35, 2.71]];   // [lattice m, turn]
const MICRO_STRETCH = 3, MICRO_FRAMES = 13;
// Lattice frame k: u = M p + salt, p = (x, north) in metres, M row-major (m00, m01, m10, m11) as float32. Frames 0-4
// the octaves; 5-8 the 1.6 m octave and 9-12 the 0.5 m one stretched along 0, 45, 90 and 135 degrees.
const MICRO_M = new Float32Array(MICRO_FRAMES * 4), MICRO_SALT = new Float64Array(MICRO_FRAMES * 2);
{
  const set = (k, a, along, across) => {
    const c = Math.cos(a), s = Math.sin(a);
    MICRO_M[k * 4] = c / along; MICRO_M[k * 4 + 1] = s / along; MICRO_M[k * 4 + 2] = -s / across; MICRO_M[k * 4 + 3] = c / across;
    MICRO_SALT[k * 2] = 97 * k; MICRO_SALT[k * 2 + 1] = 41 * k;
  };
  for (let o = 0; o < 5; o++) set(o, MICRO_OCT[o][1], MICRO_OCT[o][0], MICRO_OCT[o][0]);
  for (let o = 0; o < 2; o++) for (let d = 0; d < 4; d++) set(5 + 4 * o + d, d * Math.PI / 4, MICRO_OCT[o][0] * MICRO_STRETCH, MICRO_OCT[o][0]);
}
const microHash = (i, j) => {   // = mcHash (and the terrain shader's hash)
  let h = (Math.imul(i + 65536, 1597334677) ^ Math.imul(j + 65536, 3812015801 | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519 | 0) >>> 0; h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
};
const smooth01 = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
// The octave fades for a cell of h m: an octave fades out between 3 and 1.5 cells to its lattice.
const microFades = h => [smooth01(1.5 * h, 3 * h, MICRO_OCT[2][0]), smooth01(1.5 * h, 3 * h, MICRO_OCT[3][0]), smooth01(1.5 * h, 3 * h, MICRO_OCT[4][0])];

const f9 = v => { const t = Math.fround(v).toPrecision(9); return t.includes('.') || t.includes('e') ? t : t + '.0'; };
// Shared uniforms of the patch's relief (one patch at a time; MicroPatch writes them), for any material that wants to
// stand on it: include MICRO_GLSL and call microWorld(posW) for the relief at a world position (0 outside the patch).
export const microUniforms = {
  mcMat: { value: null },                                   // MICRO_NODES x 2 by MICRO_NODES RGBA float: amplitudes | stretch
  mcAi: { value: new Int32Array(MICRO_FRAMES * 2) }, mcAf: { value: new Float32Array(MICRO_FRAMES * 2) },
  mcRect: { value: new THREE.Vector4(0, 0, 0, 0) },         // the patch's x0, x1, n0, n1 less the origin
  mcPar: { value: new THREE.Vector4(1, 1, 0, 0) },          // x the ease band (m), y the cell (m)
  mcFade: { value: new THREE.Vector4(1, 1, 1, 0) },         // the 0.15 m, 0.05 m and tussock octaves' fades
  mcOrigin: { value: new THREE.Vector2(0, 0) },             // the patch origin (x, north), whole metres
  mcDisp: { value: null },                                  // the patch's vertices (MICRO_CELLS + 1 square, RGBA float): relief, x, north less the origin; baked per rebuild
  mcNrm: { value: null },                                   // the relief's gradient (d/dx, d/dnorth) over the patch, MICRO_NRM square, half float, baked per rebuild
  mcSpan: { value: new THREE.Vector4(0, 0, 1, 0) },         // the patch's south-west corner less the origin (x, north), its side (m)
};
export const MICRO_GLSL = /* glsl */`
  const vec4 MC_M[${MICRO_FRAMES}] = vec4[${MICRO_FRAMES}](${Array.from({ length: MICRO_FRAMES }, (_, k) => `vec4(${[0, 1, 2, 3].map(q => f9(MICRO_M[k * 4 + q])).join(', ')})`).join(', ')});
  uniform sampler2D mcMat; uniform ivec2 mcAi[${MICRO_FRAMES}]; uniform vec2 mcAf[${MICRO_FRAMES}];
  uniform vec4 mcRect; uniform vec4 mcPar; uniform vec4 mcFade; uniform vec2 mcOrigin;
  float mcHash(ivec2 i) { uvec2 q = uvec2(i + 65536); uint h = q.x * 1597334677u ^ q.y * 3812015801u;
    h = (h ^ (h >> 15)) * 2246822519u; h ^= h >> 13; return float(h) * (1.0 / 4294967296.0); }
  // value noise of frame k at pl (metres from the origin): the lattice point split, so float32 keeps its fraction
  float mcNoise(int k, vec2 pl) {
    vec4 M = MC_M[k]; vec2 u = vec2(dot(M.xy, pl), dot(M.zw, pl)) + mcAf[k], fl = floor(u), f = u - fl;
    ivec2 i = ivec2(fl) + mcAi[k]; f = f * f * (3.0 - 2.0 * f);
    float a = mcHash(i), b = mcHash(i + ivec2(1, 0)), c = mcHash(i + ivec2(0, 1)), d = mcHash(i + ivec2(1, 1));
    return (a + (b - a) * f.x) * (1.0 - f.y) + (c + (d - c) * f.x) * f.y;
  }
  vec4 mcBil(ivec2 i, vec2 f) {
    vec4 a = texelFetch(mcMat, i, 0), b = texelFetch(mcMat, i + ivec2(1, 0), 0), c = texelFetch(mcMat, i + ivec2(0, 1), 0), d = texelFetch(mcMat, i + ivec2(1, 1), 0);
    return (a + (b - a) * f.x) * (1.0 - f.y) + (c + (d - c) * f.x) * f.y;
  }
  // the relief before the edge ease, at pl
  float mcRaw(vec2 pl) {
    vec2 g = clamp(pl, vec2(0.0), vec2(${MICRO_NODES - 1}.0 - 0.001)), fl = floor(g);
    ivec2 i = ivec2(fl); vec2 f = g - fl;
    vec4 A = mcBil(i, f);
    if (A.x + A.y + A.z + A.w <= 0.0) return 0.0;
    vec2 sv = mcBil(i + ivec2(${MICRO_NODES}, 0), f).xy;
    float n0 = mcNoise(0, pl), n1 = mcNoise(1, pl), st = length(sv);
    if (st > 0.001) {
      float th = atan(sv.y, sv.x) * 0.5; if (th < 0.0) th += 3.14159265358979;
      float q = th / 0.785398163397448; int d0 = int(floor(q)); float fr = q - float(d0); d0 = min(d0, 3); int d1 = (d0 + 1) & 3;
      float s0 = mcNoise(5 + d0, pl), s1 = mcNoise(5 + d1, pl), s2 = mcNoise(9 + d0, pl), s3 = mcNoise(9 + d1, pl);
      n0 += ((s0 + (s1 - s0) * fr) - n0) * st; n1 += ((s2 + (s3 - s2) * fr) - n1) * st;
    }
    float n2 = mcFade.x > 0.0 ? mcNoise(2, pl) : 0.0, n3 = mcFade.y > 0.0 ? mcNoise(3, pl) : 0.0, nt = mcFade.z > 0.0 ? mcNoise(4, pl) : 0.0;
    float r0 = 1.0 - abs(2.0 * n0 - 1.0), r1 = 1.0 - abs(2.0 * n1 - 1.0), r2 = 1.0 - abs(2.0 * n2 - 1.0);
    float rock = 0.52 * r0 * r0 + 0.28 * r1 * r1 + mcFade.x * 0.13 * r2 + mcFade.y * 0.07 * n3;
    float grav = 0.2 * n0 + 0.3 * n1 + mcFade.x * 0.3 * n2 + mcFade.y * 0.2 * n3;
    float tt = clamp((nt - 0.35) / 0.4, 0.0, 1.0);
    float thatch = mcFade.z * tt * tt * (3.0 - 2.0 * tt) * (0.55 + 0.45 * n0) + 0.12 * mcFade.x * n2;
    float litter = 0.6 * n0 + 0.4 * n1;
    return A.x * rock + A.y * grav + A.z * thatch + A.w * litter;
  }
  float mcEase(vec2 pl) {
    float e = min(min(pl.x - mcRect.x, mcRect.y - pl.x), min(pl.y - mcRect.z, mcRect.w - pl.y));
    float s = clamp(e / mcPar.x, 0.0, 1.0); return s * s * (3.0 - 2.0 * s);
  }
  float microAt(vec2 pl) { float t = mcEase(pl); return t > 0.0 ? t * mcRaw(pl) : 0.0; }
  float microWorld(vec3 posW) { return microAt(vec2(posW.x, -posW.z) - mcOrigin); }
`;
// The relief is baked once per rebuild (MicroPatch.bake), not evaluated per vertex per frame: five evaluations a vertex for
// a normal cost ~3 ms of GPU a frame. Two bakes: each vertex drawn as a point into its own texel of mcDisp (its position
// from the position attribute, MICRO_GLSL's microAt there, ~0.1 ms), which the vertex shader reads for its height
// (gl_VertexID: the grid row by row, south to north); and the relief's gradient at MICRO_NRM texels a side into mcNrm,
// which the fragment shader reads for the lighting normal. The geometry is MICRO_CELLS a side, not the 192 first tried:
// seen from 9 cm up, 2 cm triangles are a few pixels tall and the GPU shades every 2 x 2 quad each touches, so the patch
// cost twice the fine mesh's per pixel (192 cells: +2.2 ms over the fine mesh alone; 128: +1.2; with 96 and the normal
// map the relief's 5 cm octave still lights, at 1 cm for a lizard).
const MICRO_VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW; varying vec3 vRel; varying vec3 vNormalMac; varying vec2 vMicroUv;
  uniform vec3 detailOrigin; uniform sampler2D mcDisp;
  void main(){
    ivec2 c = ivec2(gl_VertexID % ${MICRO_CELLS + 1}, gl_VertexID / ${MICRO_CELLS + 1});
    float m = texelFetch(mcDisp, c, 0).r;
    vNormalMac = normalize(mat3(modelMatrix) * normal); vNormalW = vNormalMac;   // the fragment shader adds the relief (mcNrm)
    vMicroUv = vec2(c) / ${MICRO_CELLS}.0; vUv = uv;
    vec4 wp = modelMatrix * vec4(position.x, position.y + m, position.z, 1.0); vPosW = wp.xyz; vRel = wp.xyz - detailOrigin;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const MICRO_BAKE_VERT = /* glsl */`
  varying vec2 vPl;
  void main(){
    ivec2 c = ivec2(gl_VertexID % ${MICRO_CELLS + 1}, gl_VertexID / ${MICRO_CELLS + 1});
    gl_Position = vec4((vec2(c) + 0.5) * ${f9(2 / (MICRO_CELLS + 1))} - 1.0, 0.0, 1.0); gl_PointSize = 1.0;
    vPl = vec2(position.x, -position.z);
  }`;
// The gradient bake: texel (k + 0.5) / MICRO_NRM of the patch's side, central differences over a texel.
const MICRO_NRM_FRAG = /* glsl */`
  ${MICRO_GLSL}
  uniform vec4 mcSpan;
  void main(){
    vec2 pl = mcSpan.xy + gl_FragCoord.xy * (mcSpan.z / ${MICRO_NRM}.0), e = vec2(mcSpan.z / ${MICRO_NRM}.0, 0.0);
    gl_FragColor = vec4((microAt(pl + e.xy) - microAt(pl - e.xy)) / (2.0 * e.x), (microAt(pl + e.yx) - microAt(pl - e.yx)) / (2.0 * e.x), 0.0, 1.0);
  }`;

class MicroPatch {
  constructor(terrain) {
    this.terrain = terrain; this.tile = terrain.tile; this.H = terrain.tile.heights; this.size = terrain.tile.size;
    const n = this.n = MICRO_CELLS + 1, nv = this.nv = n * n;
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nv * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint16Array(MICRO_CELLS * MICRO_CELLS * 6);
    let q = 0;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {   // j south to north, i west to east; split SW-NE as the fine square
      const sw = j * n + i, se = sw + 1, nw = sw + n, ne = nw + 1;
      idx[q++] = sw; idx[q++] = se; idx[q++] = ne; idx[q++] = sw; idx[q++] = ne; idx[q++] = nw;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.matData = new Float32Array(MICRO_NODES * 2 * MICRO_NODES * 4);
    const t = this.matTex = new THREE.DataTexture(this.matData, MICRO_NODES * 2, MICRO_NODES, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
    microUniforms.mcMat.value = t;
    // the bake: every vertex a point on its own texel of a float target (bake()), sharing the patch's position attribute
    this.dispRT = new THREE.WebGLRenderTarget(n, n, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false });
    microUniforms.mcDisp.value = this.dispRT.texture;
    this.bakeMat = new THREE.ShaderMaterial({ uniforms: microUniforms, depthTest: false, depthWrite: false, vertexShader: MICRO_BAKE_VERT,
      fragmentShader: `varying vec2 vPl;\n${MICRO_GLSL}\n  void main(){ gl_FragColor = vec4(microAt(vPl), vPl, 1.0); }` });
    const pg = this.bakeGeo = new THREE.BufferGeometry(); pg.setAttribute('position', g.attributes.position);
    const pts = new THREE.Points(pg, this.bakeMat); pts.frustumCulled = false;
    this.bakeScene = new THREE.Scene(); this.bakeScene.add(pts); this.bakeCam = new THREE.Camera();
    // and the gradient, on a quad over a MICRO_NRM square half-float target (linear filtered: the fragment shader reads between texels)
    this.nrmRT = new THREE.WebGLRenderTarget(MICRO_NRM, MICRO_NRM, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
    this.nrmRT.texture.wrapS = this.nrmRT.texture.wrapT = THREE.ClampToEdgeWrapping;
    microUniforms.mcNrm.value = this.nrmRT.texture;
    this.nrmMat = new THREE.ShaderMaterial({ uniforms: microUniforms, depthTest: false, depthWrite: false, vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: MICRO_NRM_FRAG });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.nrmMat); quad.frustumCulled = false;
    this.nrmScene = new THREE.Scene(); this.nrmScene.add(quad);
    this.material = new THREE.ShaderMaterial({ vertexShader: MICRO_VERT, fragmentShader: FRAG, uniforms: { ...terrain.uniforms, mcDisp: microUniforms.mcDisp, mcNrm: microUniforms.mcNrm },
      defines: { MICRO_PATCH: '' }, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });   // a constant pull only: a slope-scaled one grows at a lizard's grazing view until it hides the pebbles and rock feet standing on the ground
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.name = 'terrainMicro'; this.mesh.visible = false;
    this.mesh.renderOrder = -1;   // drawn before the rest of the opaque scene, so the fine mesh's fragments under it fail the depth test early
    this.cur = null; this.job = null; this.version = 0; this.off = false; this.cam = null;
    this.w5 = [0, 0, 0, 0, 0]; this.v3 = new THREE.Vector3(); this.normals = new Map();
    this.stats = { builds: 0, lastMs: 0, lastFrames: 0, maxSliceMs: 0, commitMs: 0, reusedNodes: 0, L: 0, cell: 0 };
    this.setScale(1);
  }
  // From the body scale (bodyScale.js): the side, the cell, the vertices' offsets and the octave fades; the next update
  // rebuilds at once.
  setScale(v) {
    const L = Math.min(Math.max(24 * Math.sqrt(v), 3), 24);
    if (L === this.L) return;
    this.L = L; this.h = L / MICRO_CELLS; this.fades = microFades(this.h); this.job = null;
    const off = this.off0 = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) off[i] = L * (i / MICRO_CELLS - 0.5);
    const o3 = detailUniforms.detailOct3.value; o3.x = 0.35 * L; o3.y = 0.5 * L;
    this.stats.L = +L.toFixed(3); this.stats.cell = +this.h.toFixed(4);
  }
  setEnabled(on) { this.off = !on; if (!on) this.park(); }
  park() {
    this.mesh.visible = false; this.cur = null; this.job = null;
    if (this.H.micro?.owner === this) this.H.micro = null;
    detailUniforms.detailOct3.value.z = 0;
  }
  // The camera's height over the ground (the terrain material records the camera it is drawn with).
  camAGL() {
    const c = this.cam; if (!c) return 0;
    return c.position.y - this.H.groundIn(this.H.fine, c.position.x, -c.position.z);
  }
  update(x, north) {
    if (this.off) return;
    if (!this.mesh.parent) this.terrain.group.add(this.mesh);   // after shadows.js listed the group's casters: the patch casts nothing (the mesh beneath casts the same ground)
    if (this.needBake) this.bake();
    if (this.camAGL() > Math.max(this.L, 4)) { if (this.cur || this.job) this.park(); return; }
    const c = this.cur, F = this.H.fine;
    if (!this.job && (!c || c.h !== this.h || c.F !== F || Math.max(Math.abs(x - c.cx), Math.abs(north - c.cn)) > MICRO_RECENTRE * this.L)) {
      const h = this.h, lo = this.L / 2 + 2, hi = this.size - this.L / 2 - 2;
      const snap = v => Math.round(Math.min(Math.max(v, lo), hi) / h) * h;
      this.job = this.start(snap(x), snap(north));
      if (!c || c.h !== this.h) { this.run(this.job, Infinity); this.commit(this.job); this.job = null; return; }   // a new body: at once
    }
    if (this.job && !this.terrain.fine?.job) {   // the fine square's rebuild goes first: the two never share a frame's budget
      const t0 = performance.now();
      if (this.job.done) { this.commit(this.job); this.job = null; }   // the swap and the bake in a frame of their own
      else this.job.done = this.run(this.job, MICRO_BUDGET_MS);
      this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, performance.now() - t0);
    }
  }
  start(cx, cn) {
    const L = this.L, x0 = cx - L / 2, n0 = cn - L / 2, x1 = cx + L / 2, n1 = cn + L / 2;
    const Ox = Math.floor(x0), On = Math.floor(n0), nNodes = Math.min(MICRO_NODES, Math.ceil(x1 - Ox) + 2);
    // the arrays: the patch before last's, when it has gone (two sets alternate, so a move allocates nothing)
    const sp = this.spare; this.spare = null;
    const J = { cx, cn, h: this.h, x0, x1, n0, n1, Ox, On, nNodes, F: this.H.fine, fades: this.fades, band: MICRO_BAND * L,
      mat: sp?.mat || new Float32Array(MICRO_NODES * 2 * MICRO_NODES * 4), base: sp?.base || new Float32Array(this.nv), nrm: sp?.nrm || new Float32Array(this.nv * 3),
      lx: sp?.lx || new Float32Array(this.n), ln: sp?.ln || new Float32Array(this.n),
      Ai: sp?.Ai || new Float64Array(MICRO_FRAMES * 2), Af: sp?.Af || new Float64Array(MICRO_FRAMES * 2), node: 0, row: 0, reused: 0, ms: 0, frames: 0 };
    // vertex coordinates less the origin, as float32 holds them: the drawn positions, the bake's and ground()'s
    for (let i = 0; i < this.n; i++) { J.lx[i] = cx - Ox + this.off0[i]; J.ln[i] = cn - On + this.off0[i]; }
    return J;
  }
  // Material nodes (copied where the previous patch holds the same world node), then the surface beneath at each vertex
  // (row by row), until the budget is spent; true when done.
  run(J, budget) {
    const t0 = performance.now(), P = this.cur, NN = MICRO_NODES, n = this.n;
    J.frames++;
    while (J.node < J.nNodes) {
      const j = J.node++;
      for (let i = 0; i < J.nNodes; i++) {
        const k = (j * NN * 2 + i) * 4, ks = k + NN * 4;
        const pi = P ? J.Ox + i - P.Ox : -1, pj = P ? J.On + j - P.On : -1;
        if (P && pi >= 0 && pj >= 0 && pi < P.nNodes && pj < P.nNodes) {
          const pk = (pj * NN * 2 + pi) * 4;
          for (let c = 0; c < 4; c++) { J.mat[k + c] = P.mat[pk + c]; J.mat[ks + c] = P.mat[pk + NN * 4 + c]; }
          J.reused++;
        } else this.node(J.Ox + i, J.On + j, J.mat, k, ks);
      }
      if (performance.now() - t0 > budget) { J.ms += performance.now() - t0; return false; }
    }
    const nrmF = J.F?.nrm, v = this.v3;
    while (J.row < n) {
      const j = J.row++, north = J.On + J.ln[j];
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        J.base[k] = this.beneath(J.F, nrmF, J.Ox + J.lx[i], north, v);
        J.nrm[k * 3] = v.x; J.nrm[k * 3 + 1] = v.y; J.nrm[k * 3 + 2] = v.z;
      }
      if (performance.now() - t0 > budget) { J.ms += performance.now() - t0; return false; }
    }
    J.ms += performance.now() - t0;
    return true;
  }
  // The surface drawn beneath at a point and its normal (into out): the fine square's triangles (Heightfield.groundIn,
  // the same cells and split) with its vertex normals interpolated as the GPU does, else the coarse chunks'.
  beneath(F, nrm, x, north, out) {
    const H = this.H;
    if (F && nrm && x >= F.x0 && x <= F.x1 && north >= F.n0 && north <= F.n1) {
      const xs = F.xs, ns = F.ns, nx = xs.length;
      const i = Math.min(x < xs[1] ? 0 : Math.floor((x - xs[1]) / F.step) + 1, nx - 2);
      const j = Math.min(north < ns[1] ? 0 : Math.floor((north - ns[1]) / F.step) + 1, ns.length - 2);
      const u = Math.min(Math.max((x - xs[i]) / (xs[i + 1] - xs[i]), 0), 1), w = Math.min(Math.max((north - ns[j]) / (ns[j + 1] - ns[j]), 0), 1);
      const sw = j * nx + i, se = sw + 1, nw = sw + nx, ne = nw + 1;
      const tri = (A, a) => w > u ? A[sw * a] + u * (A[ne * a] - A[nw * a]) + w * (A[nw * a] - A[sw * a]) : A[sw * a] + u * (A[se * a] - A[sw * a]) + w * (A[ne * a] - A[se * a]);
      const tri3 = c => w > u ? nrm[sw * 3 + c] + u * (nrm[ne * 3 + c] - nrm[nw * 3 + c]) + w * (nrm[nw * 3 + c] - nrm[sw * 3 + c]) : nrm[sw * 3 + c] + u * (nrm[se * 3 + c] - nrm[sw * 3 + c]) + w * (nrm[ne * 3 + c] - nrm[se * 3 + c]);
      out.set(tri3(0), tri3(1), tri3(2)).normalize();
      if (i === 0 || j === 0 || i === nx - 2 || j === ns.length - 2) return H.coarse(x, north);   // as groundIn: the edge cells are pinned to the coarse surface
      return tri(F.y, 1);
    }
    if (this.normals.size > 4096) this.normals.clear();
    this.terrain.coarseNormalAt(x, north, out, this.normals);
    return H.coarse(x, north);
  }
  // One material node (world whole metres x, north): amplitudes (rock, gravel, thatch, litter) into mat[k..k+3], the
  // fall line's doubled angle times the stretch into mat[ks..ks+1].
  node(x, north, mat, k, ks) {
    const T = this.tile, H = this.H, mask = this.terrain.detail?.mask;
    const gx = (H.at(x + 1, north) - H.at(x - 1, north)) / 2, gn = (H.at(x, north + 1) - H.at(x, north - 1)) / 2;
    const s = Math.hypot(gx, gn), slopeDeg = Math.atan(s) * 180 / Math.PI;
    let bareK = 1, thatchAdd = 0, thatchK = 1, rough = 1;
    const LM = T.lidarMicro;
    if (LM) {
      const r = this.lidarMicroAt(LM, x, north);
      // intensity: bright returns are bare rock, gravel and cut banks, but dry grass is bright at 1064 nm too, so the
      // low-vegetation share takes it back
      bareK = (0.75 + 0.5 * r[0]) * (1 - 0.7 * r[2]); thatchAdd = r[2]; thatchK = 0.75 + 0.5 * r[2];
      // roughness: G (cm x 4 -> m), the ground returns' spread about the 1 m DEM surface (the pipeline removes the cell's
      // slope and curvature: docs/tile-spec.md "Lidar"), less the ranging noise every return carries (the tile's 10th
      // percentile, 0.95 cm on the home tile, in quadrature): p50 1.7 cm reads 0.87, p90 3.1 cm 1.19, p99 6 cm 1.78
      const sd = r[1] * 255 / 400, fl = this.lidarFloor ??= (T.manifest?.layers?.['client.lidar_micro']?.stats?.roughness_cm?.p10 ?? 1) / 100;
      rough = Math.min(0.6 + Math.sqrt(Math.max(sd * sd - fl * fl, 0)) / 0.05, 2.2);
    } else if (H.detail) rough = 0.7 + 0.8 * smooth01(0.02, 0.1, this.residualRoughness(x, north));
    let rk = 0, gr = 0, th = 0, li = 0, dry = 1;
    if (mask?.data) {
      const w = detailWeightsAt(T, mask, x, north, H.detail ? slopeDeg : 0, bareK, thatchAdd, this.w5);
      const q0 = w[0] * w[0], q1 = w[1] * w[1], q2 = w[2] * w[2], q3 = w[3] * w[3], q4 = w[4] * w[4], sum = q0 + q1 + q2 + q3 + q4;
      if (sum > 1e-6) { th = q0 / sum; li = q1 / sum; gr = q2 / sum; rk = q3 / sum; }
      dry = 1 - Math.max(w.water, T.waterMask?.at(x, north) === 255 ? 1 : 0);
    }
    mat[k] = MICRO_AMP.rock * rk * rough * dry; mat[k + 1] = MICRO_AMP.gravel * gr * rough * dry;
    mat[k + 2] = MICRO_AMP.thatch * th * thatchK * dry; mat[k + 3] = MICRO_AMP.litter * li * rough * dry;
    const st = smooth01(18, 35, slopeDeg), a = 2 * Math.atan2(-gn, -gx);
    mat[ks] = st > 0 ? Math.cos(a) * st : 0; mat[ks + 1] = st > 0 ? Math.sin(a) * st : 0; mat[ks + 2] = 0; mat[ks + 3] = 0;
  }
  // RMS of the lidar residual's 4-neighbour laplacian over the 3 x 3 pixels (6 m) round a point, m.
  residualRoughness(x, north) {
    const D = this.H.detail, W = D.width, d = D.data, ci = Math.round(x / this.H.dRes - 0.5), cj = Math.round((this.size - north) / this.H.dRes - 0.5);
    const at = (i, j) => d[Math.min(Math.max(j, 0), W - 1) * W + Math.min(Math.max(i, 0), W - 1)];
    let s = 0;
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const l = at(i, j) - 0.25 * (at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1));
      s += l * l;
    }
    return Math.sqrt(s / 9) * 0.04;
  }
  // client/lidar_micro.png's three channels at a point, bilinear between its 2 m pixel centres, 0..1 each.
  lidarMicroAt(LM, x, north) {
    const W = LM.width, d = LM.data, res = this.size / W, fx = x / res - 0.5, fy = (this.size - north) / res - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, out = this._lm ??= [0, 0, 0];
    const v = (i, j, c) => d[(Math.min(Math.max(j, 0), W - 1) * W + Math.min(Math.max(i, 0), W - 1)) * 3 + c];
    for (let c = 0; c < 3; c++) out[c] = ((v(x0, y0, c) * (1 - tx) + v(x0 + 1, y0, c) * tx) * (1 - ty) + (v(x0, y0 + 1, c) * (1 - tx) + v(x0 + 1, y0 + 1, c) * tx) * ty) / 255;
    return out;
  }
  commit(J) {
    const t0 = performance.now(), n = this.n, g = this.geo, size = this.size, h = J.h;
    const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv.array;
    for (let j = 0; j < n; j++) {
      const ln = J.ln[j];
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        P[k * 3] = J.lx[i]; P[k * 3 + 1] = J.base[k]; P[k * 3 + 2] = -ln;
        U[k * 2] = (J.Ox + J.lx[i]) / size; U[k * 2 + 1] = (J.On + ln) / size;
      }
    }
    N.set(J.nrm, 0);
    for (const a of Object.values(g.attributes)) a.needsUpdate = true;
    g.computeBoundingSphere(); g.boundingSphere.radius += 0.5;   // the relief rises above the surface the positions hold
    this.mesh.position.set(J.Ox, 0, -J.On);
    // the patch's uniforms: the nodes, each lattice frame's offset at the origin split in two, the square, band and fades
    this.matData.set(J.mat); this.matTex.needsUpdate = true;
    const Ai = microUniforms.mcAi.value, Af = microUniforms.mcAf.value;
    for (let k = 0; k < MICRO_FRAMES; k++) {
      const a = MICRO_M[k * 4] * J.Ox + MICRO_M[k * 4 + 1] * J.On + MICRO_SALT[k * 2], b = MICRO_M[k * 4 + 2] * J.Ox + MICRO_M[k * 4 + 3] * J.On + MICRO_SALT[k * 2 + 1];
      J.Ai[k * 2] = Ai[k * 2] = Math.floor(a); J.Ai[k * 2 + 1] = Ai[k * 2 + 1] = Math.floor(b);
      J.Af[k * 2] = Af[k * 2] = a - Math.floor(a); J.Af[k * 2 + 1] = Af[k * 2 + 1] = b - Math.floor(b);
    }
    for (let q = 0; q < MICRO_FRAMES * 2; q++) J.Af[q] = Af[q];   // the fraction as float32 holds it, so JS and GLSL start from the same number
    J.rect = [J.x0 - J.Ox, J.x1 - J.Ox, J.n0 - J.On, J.n1 - J.On].map(Math.fround);
    J.fadesF = J.fades.map(Math.fround); J.bandF = Math.fround(J.band);
    microUniforms.mcRect.value.set(...J.rect); microUniforms.mcPar.value.set(J.band, h, 0, 0);
    microUniforms.mcFade.value.set(J.fades[0], J.fades[1], J.fades[2], 0); microUniforms.mcOrigin.value.set(J.Ox, J.On);
    microUniforms.mcSpan.value.set(J.x0 - J.Ox, J.n0 - J.On, J.x1 - J.x0, 0);
    this.bake();
    setDetailOrigin(J.Ox, Math.round(J.base[(n * n) >> 1]), -J.On);
    detailUniforms.detailOct3.value.z = 1;
    if (this.cur) this.spare = this.cur;
    this.cur = J; this.mesh.visible = true; (this.drawn ??= new Float32Array(this.nv)).fill(NaN);
    this.H.micro = { owner: this, x0: J.x0, x1: J.x1, n0: J.n0, n1: J.n1, band: J.band, step: h, version: ++this.version,
      fn: (x, north) => this.fn(x, north), ground: (x, north) => this.ground(x, north) };
    const st = this.stats; st.builds++; st.lastMs = Math.round(J.ms * 100) / 100; st.lastFrames = J.frames; st.reusedNodes = J.reused;
    st.commitMs = Math.round((performance.now() - t0) * 100) / 100;
  }
  // Draws the relief at every vertex into mcDisp with the renderer the terrain was last drawn with (the terrain material
  // records it); before the first frame the patch waits a frame, flat. The position attribute is the patch's own, so
  // the bake uploads what commit wrote.
  bake() {
    const R = this.renderer;
    this.needBake = !R; if (!R) return;
    const prev = R.getRenderTarget();
    R.setRenderTarget(this.dispRT); R.render(this.bakeScene, this.bakeCam);
    R.setRenderTarget(this.nrmRT); R.render(this.nrmScene, this.bakeCam); R.setRenderTarget(prev);
  }
  // The relief before the ease at (lx, ln) m from the patch origin: MICRO_GLSL's mcRaw, in double.
  raw(J, lx, ln) {
    const NN = MICRO_NODES, M = J.mat, gx = Math.min(Math.max(lx, 0), NN - 1 - 0.001), gy = Math.min(Math.max(ln, 0), NN - 1 - 0.001);
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    const bil = (o, c) => {
      const a = M[((j * NN * 2) + i + o) * 4 + c], b = M[((j * NN * 2) + i + 1 + o) * 4 + c], cc = M[(((j + 1) * NN * 2) + i + o) * 4 + c], d = M[(((j + 1) * NN * 2) + i + 1 + o) * 4 + c];
      return (a + (b - a) * fx) * (1 - fy) + (cc + (d - cc) * fx) * fy;
    };
    const A0 = bil(0, 0), A1 = bil(0, 1), A2 = bil(0, 2), A3 = bil(0, 3);
    if (A0 + A1 + A2 + A3 <= 0) return 0;
    const noise = k => {
      const u = MICRO_M[k * 4] * lx + MICRO_M[k * 4 + 1] * ln + J.Af[k * 2], v = MICRO_M[k * 4 + 2] * lx + MICRO_M[k * 4 + 3] * ln + J.Af[k * 2 + 1];
      const fu = Math.floor(u), fv = Math.floor(v), ii = fu + J.Ai[k * 2], jj = fv + J.Ai[k * 2 + 1];
      let a = u - fu, b = v - fv; a = a * a * (3 - 2 * a); b = b * b * (3 - 2 * b);
      const h00 = microHash(ii, jj), h10 = microHash(ii + 1, jj), h01 = microHash(ii, jj + 1), h11 = microHash(ii + 1, jj + 1);
      return (h00 + (h10 - h00) * a) * (1 - b) + (h01 + (h11 - h01) * a) * b;
    };
    const svx = bil(NN, 0), svy = bil(NN, 1), st = Math.hypot(svx, svy), F = J.fadesF;
    let n0 = noise(0), n1 = noise(1);
    if (st > 0.001) {
      let th = Math.atan2(svy, svx) * 0.5; if (th < 0) th += Math.PI;
      const q = th / (Math.PI / 4); let d0 = Math.floor(q); const fr = q - d0; d0 = Math.min(d0, 3); const d1 = (d0 + 1) & 3;
      const s0 = noise(5 + d0), s1 = noise(5 + d1), s2 = noise(9 + d0), s3 = noise(9 + d1);
      n0 += ((s0 + (s1 - s0) * fr) - n0) * st; n1 += ((s2 + (s3 - s2) * fr) - n1) * st;
    }
    const n2 = F[0] > 0 ? noise(2) : 0, n3 = F[1] > 0 ? noise(3) : 0, nt = F[2] > 0 ? noise(4) : 0;
    const r0 = 1 - Math.abs(2 * n0 - 1), r1 = 1 - Math.abs(2 * n1 - 1), r2 = 1 - Math.abs(2 * n2 - 1);
    const rock = 0.52 * r0 * r0 + 0.28 * r1 * r1 + F[0] * 0.13 * r2 + F[1] * 0.07 * n3;
    const grav = 0.2 * n0 + 0.3 * n1 + F[0] * 0.3 * n2 + F[1] * 0.2 * n3;
    const tt = Math.min(Math.max((nt - 0.35) / 0.4, 0), 1);
    const thatch = F[2] * tt * tt * (3 - 2 * tt) * (0.55 + 0.45 * n0) + 0.12 * F[0] * n2;
    const litter = 0.6 * n0 + 0.4 * n1;
    return A0 * rock + A1 * grav + A2 * thatch + A3 * litter;
  }
  // The relief as drawn at (lx, ln) from the origin: eased to nothing across the outer band (MICRO_GLSL microAt).
  local(J, lx, ln) {
    const R = J.rect, e = Math.min(lx - R[0], R[1] - lx, ln - R[2], R[3] - ln), s = Math.min(Math.max(e / J.bandF, 0), 1), t = s * s * (3 - 2 * s);
    return t > 0 ? t * this.raw(J, lx, ln) : 0;
  }
  // The relief at a world point (Heightfield.micro.fn), 0 outside the patch.
  fn(x, north) { const J = this.cur; return J ? this.local(J, x - J.Ox, north - J.On) : 0; }
  // The patch's surface as drawn (Heightfield.micro.ground): its vertices' heights (the surface beneath plus the relief,
  // made on first use and kept until the patch moves), between them as the cell's two triangles are split.
  ground(x, north) {
    const J = this.cur, n = this.n, D = this.drawn;
    const cell = (A, v) => { let lo = 0, hi = MICRO_CELLS; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (A[mid] <= v) lo = mid; else hi = mid; } return lo; };
    const lx = x - J.Ox, ln = north - J.On, i = cell(J.lx, lx), j = cell(J.ln, ln);
    const u = Math.min(Math.max((lx - J.lx[i]) / (J.lx[i + 1] - J.lx[i]), 0), 1), w = Math.min(Math.max((ln - J.ln[j]) / (J.ln[j + 1] - J.ln[j]), 0), 1);
    const v = k => {
      let y = D[k];
      if (y !== y) { const ii = k % n; y = D[k] = J.base[k] + this.local(J, J.lx[ii], J.ln[(k - ii) / n]); }
      return y;
    };
    const sw = j * n + i, SW = v(sw), SE = v(sw + 1), NW = v(sw + n), NE = v(sw + n + 1);
    return w > u ? SW + u * (NE - NW) + w * (NW - SW) : SW + u * (SE - SW) + w * (NE - SE);
  }
  dispose() {
    this.park();
    this.mesh.removeFromParent();
    this.geo.dispose(); this.material.dispose(); this.matTex.dispose(); this.dispRT.dispose(); this.bakeMat.dispose(); this.bakeGeo.dispose();
    this.nrmRT.dispose(); this.nrmMat.dispose(); this.nrmScene.children[0].geometry.dispose();
    if (microUniforms.mcNrm.value === this.nrmRT.texture) microUniforms.mcNrm.value = null;
    if (microUniforms.mcMat.value === this.matTex) microUniforms.mcMat.value = null;
    if (microUniforms.mcDisp.value === this.dispRT.texture) microUniforms.mcDisp.value = null;
    this.matData = null; this.drawn = null; this.normals.clear(); this.cam = null; this.renderer = null;
  }
}
