import * as THREE from 'three';
import { releaseTexture } from './gpuRelease.js';

// Shared atmosphere: one set of uniforms and one GLSL chunk used by every material, so the
// terrain, trees, impostors, grass and sky dome all see the same air. Aerial perspective is two
// exponential height hazes: Rayleigh air (strongly chromatic, 8 km scale height), which turns the
// middle distance blue, and Mie aerosol (nearly grey, 800 m scale height, thickest in summer),
// which whitens the valleys. Their far colour is the sky dome's own horizon radiance (computed here
// with the dome's Preetham model, its low-sun lobe tinted gold), so distant ridges dissolve into
// the sky rather than into a fog colour; a mild contrast weight keeps dark crowns darker than the
// grass beside them while they do. Clouds are a procedural field in world metres (a slow coverage
// field, a domain warp and two shape octaves from one tileable noise texture, each layer at an
// unrelated scale and rotation and drifting at its own speed, so nothing repeats or tiles); the dome
// draws it as a slab of heightfield cumulus with flat bases and domed tops, plus a thin cirrus sheet
// above. Around the camera the opacity of those same clouds up the sun ray is baked into cloudMap,
// which the ground samples for shadows, so a shadow sits under the cloud you see.
//
// Weather (weather.js fx, passed to update) sets the base values first: the slab's coverage from the measured low
// and mid cloud (COVER: cloud fraction -> the field's coverage offset, calibrated on the noise), the cirrus from the
// high cloud, the deck's base from the dew-point spread, the drift from the wind; overcast and fog grey and flatten
// the light (the sun dimmed, the sky light raised and desaturated, the dome greyed); humidity, rain, drizzle, snow
// and fog thicken the haze. The spirit's look (spirit.js) is applied on top after this.

export const CLOUD_PERIOD = 30000;     // metres covered by the baked shadow map (cloudMap) around the camera
const CLOUD_SLICES = 3;               // cuts through the cloud slab per ray (dome and shadow bake alike)
const CLOUD_BAKE_RES = 768;            // texels across it: 39 m each
const CLOUD_BAKE_STRIPS = 4;           // baked a quarter per frame
// Cloud layers: [period m, rotation rad, wind speed m/s]. Periods share no simple ratio and every
// layer is turned and drifts differently, so the combined field never lines up with itself.
const CLOUD_LAYERS = {
  cover: [41000, 0.31, 3.0],    // large-scale coverage: clear and cloudy districts tens of km wide
  warp: [11300, 1.93, 4.5],     // bends the shapes so cells are not round blobs on a lattice
  base: [5300, -0.71, 6.0],     // cumulus bodies
  detail: [1370, 2.67, 7.2],    // cauliflower edges; drifting faster than the bodies, it slowly reshapes them
  cirrus: [26000, 0.42, 18.0],  // high streaks (stretched 3x along their length)
};
// Cloud fraction of the sky (the slab seen from below) -> cloudCover, from the field's statistics (the equalised noise:
// a Monte Carlo of cloudLarge + cloudShapeAt with erosion, cloud where x > 0.03).
const COVER = [[0, -0.75], [0.02, -0.45], [0.08, -0.3], [0.2, -0.1], [0.28, 0], [0.48, 0.2], [0.68, 0.4], [0.84, 0.6], [0.95, 0.8], [1, 1.1]];
function coverFor(f) {
  for (let i = 1; i < COVER.length; i++) if (f <= COVER[i][0]) { const [a, ca] = COVER[i - 1], [b, cb] = COVER[i]; return ca + (cb - ca) * (f - a) / (b - a); }
  return COVER[COVER.length - 1][1];
}
const DEG = Math.PI / 180;
const lum = col => 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
const clamp01 = x => Math.min(1, Math.max(0, x));

export const uniforms = {
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color(1, 1, 1) },        // linear hue, max channel 1
  sunLight: { value: new THREE.Color(3, 3, 3) },        // sunColor * intensity (irradiance)
  ambientSky: { value: new THREE.Color(0.5, 0.6, 0.7) },
  ambientGround: { value: new THREE.Color(0.2, 0.17, 0.12) },
  skyZenith: { value: new THREE.Color(0.5, 0.7, 1.0) },
  skyHorizon: { value: new THREE.Color(1.3, 1.5, 1.7) },   // dome at the horizon, away from the sun
  skySun: { value: new THREE.Color(2.0, 2.0, 2.0) },       // dome at the horizon, under the sun
  hazePhase: { value: new THREE.Vector4(0.6, 0, 1, 1) },   // x Mie weight, y hg(-c), z 1/(hg(c)-hg(-c)), w c = cos(sun elevation)
  hazeDensity: { value: 7.5e-5 },                          // Mie (aerosol) extinction per metre at hazeBase
  hazeHeightFalloff: { value: 1 / 800 },                   // 1 / Mie scale height
  hazeRayleigh: { value: new THREE.Vector3(1.2e-5, 2.7e-5, 6.6e-5) },   // Rayleigh extinction per metre (r, g, b) at hazeBase
  hazeRayleighFalloff: { value: 1 / 8000 },                // 1 / Rayleigh scale height
  hazeContrast: { value: 0.4 },                            // how much less air light a dark surface gets than a bright one
  sunGlowTint: { value: new THREE.Color(1, 1, 1) },        // gold on the dome's sun lobe when the sun is low (also in skySun)
  hazeBase: { value: 0 },                                  // y of the densest air (tile floor)
  landHeight: { value: 0 },                                // the dome draws a hazy plain at this y below the horizon, past the tile
  cloudMap: { value: null },                               // baked cloud opacity up the sun ray around the camera (shadows)
  cloudOffset: { value: new THREE.Vector2() },             // world xz * cloudBakeInv + cloudOffset = cloudMap uv
  cloudBakeInv: { value: 1 / CLOUD_PERIOD },
  cloudStrength: { value: 0.4 },                           // shadow darkness (fades out with the sun)
  cloudOpacity: { value: 1 },                              // visible clouds in the dome
  cloudCover: { value: 0 },                                // added to the field before the threshold (season, hour)
  cloudHeight: { value: 2000 },                            // y of the cumulus bases
  cloudNoise: { value: null },                             // tileable noise: r shape, gb warp, a billows
  cloudOfsA: { value: new THREE.Vector4() },               // uv drift of the cover (xy) and warp (zw) layers
  cloudOfsB: { value: new THREE.Vector4() },               // uv drift of the base (xy) and detail (zw) layers
  cloudShape: { value: new THREE.Vector4(0.62, 11, 0.2, 900) },   // x threshold, y opacity per unit of field at the edges (softness), z field excess of a full-height cloud, w slab thickness (m)
  cloudCirrus: { value: new THREE.Vector4(0, 0, 0.5, 7000) },         // xy uv drift, z amount, w height above the cumulus bases (m)
  cloudSun: { value: new THREE.Color(3, 3, 3) },           // sunlight at cloud height (it outlasts sunset there)
  windDrift: { value: new THREE.Vector2(1, 0.12).normalize() },   // the clouds' drift direction (x east, y = z south); the weather's wind, else a westerly
  skyWx: { value: new THREE.Vector4(0, 0, 1, 1) },         // the dome under weather: x greying (overcast), y fog veil, z cirrus sheet cap, w its brightness under a deck
  // Cascaded sun shadows (shadows.js renders the maps and sets these). Until it runs, every
  // matrix maps the world outside its cascade, so the lookup returns 1 (lit).
  csmMap0: { value: null }, csmMap1: { value: null }, csmMap2: { value: null },
  csmMatrix: { value: [0, 1, 2].map(() => new THREE.Matrix4().set(0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 1)) },
  csmTexel: { value: new THREE.Vector3(1, 1, 1) },     // metres per shadow texel, per cascade
  csmInvSize: { value: new THREE.Vector3(1, 1, 1) },   // 1 / map size, per cascade
  csmStrength: { value: 0 },                           // 0 below ~3 degrees of sun, 1 by 6
};

const rotGLSL = a => `mat2(${Math.cos(a).toFixed(6)}, ${Math.sin(a).toFixed(6)}, ${(-Math.sin(a)).toFixed(6)}, ${Math.cos(a).toFixed(6)})`;
const inv = k => (1 / CLOUD_LAYERS[k][0]).toExponential(6);
// The cloud field, shared by the dome and the shadow bake. Values are relative to the threshold:
// > 0 is cloud, and the cloud reaches sqrt(x / cloudShape.z) of the way up the slab.
const CLOUD_FIELD_GLSL = /* glsl */`
  uniform sampler2D cloudNoise; uniform vec4 cloudOfsA; uniform vec4 cloudOfsB; uniform vec4 cloudShape; uniform vec4 cloudCirrus; uniform vec3 cloudSun;
  // Slow, large layers: xy the warp displacement (m), z the coverage offset (with season and hour).
  vec3 cloudLarge(vec2 p) {
    float cov = texture2D(cloudNoise, ${rotGLSL(CLOUD_LAYERS.cover[1])} * p * ${inv('cover')} + cloudOfsA.xy).r;
    vec2 w = texture2D(cloudNoise, ${rotGLSL(CLOUD_LAYERS.warp[1])} * p * ${inv('warp')} + cloudOfsA.zw).gb - 0.5;
    return vec3(w * 900.0, (cov - 0.5) * 0.7 + cloudCover);
  }
  // Shape: bodies eroded by billows, deepest where the body is thin (erosion only, so no stray specks).
  // cloudBillow keeps the last billow value (0..1) for shading the lumps.
  float cloudBillow = 0.5;
  float cloudShapeAt(vec2 p, vec3 L) {
    vec2 q = p + L.xy;
    float b = texture2D(cloudNoise, ${rotGLSL(CLOUD_LAYERS.base[1])} * q * ${inv('base')} + cloudOfsB.xy).r;
    float d = texture2D(cloudNoise, ${rotGLSL(CLOUD_LAYERS.detail[1])} * q * ${inv('detail')} + cloudOfsB.zw).a;
    float x = b + L.z - cloudShape.x;
    cloudBillow = d;
    return x - (1.0 - d) * mix(0.22, 0.1, smoothstep(0.0, 0.2, x));
  }
  // Bodies only (one lookup), for the light march toward the sun.
  float cloudBodyAt(vec2 p, vec3 L) {
    return texture2D(cloudNoise, ${rotGLSL(CLOUD_LAYERS.base[1])} * (p + L.xy) * ${inv('base')} + cloudOfsB.xy).r + L.z - cloudShape.x;
  }
  float cloudCover0(float x) { x = max(x, 0.0); return 1.0 - exp(-x * cloudShape.y - x * x * 400.0); }   // opacity: thin edges translucent, bodies opaque
`;

export const ATMOSPHERE_GLSL = /* glsl */`
  uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 sunLight; uniform vec3 ambientSky; uniform vec3 ambientGround;
  uniform vec3 skyZenith; uniform vec3 skyHorizon; uniform vec3 skySun; uniform vec4 hazePhase;
  uniform float hazeDensity; uniform float hazeHeightFalloff; uniform float hazeBase; uniform float landHeight;
  uniform vec3 hazeRayleigh; uniform float hazeRayleighFalloff; uniform float hazeContrast; uniform vec3 sunGlowTint;
  uniform sampler2D cloudMap; uniform vec2 cloudOffset; uniform float cloudBakeInv; uniform float cloudStrength; uniform float cloudOpacity; uniform float cloudCover; uniform float cloudHeight;
  uniform vec4 skyWx;
  ${CLOUD_FIELD_GLSL}

  // ---- Cascaded sun shadow. Three depth maps with hardware compare (each tap is a bilinear 2x2
  // PCF); a point uses the sharpest cascade whose box holds it and blends into the next over the
  // box's outer 12%. Offsets are in texels of the cascade used: kN along the surface normal, kL
  // toward the sun, so the bias scales with the texel and never needs tuning per cascade.
  uniform highp sampler2DShadow csmMap0; uniform highp sampler2DShadow csmMap1; uniform highp sampler2DShadow csmMap2;
  uniform mat4 csmMatrix[3]; uniform vec3 csmTexel; uniform vec3 csmInvSize; uniform float csmStrength;
  ${[0, 1, 2].map(i => `float csmTap${i}(vec3 c, float soft) {
    if (soft < 0.5) return texture(csmMap${i}, c);
    float d = csmInvSize[${i}];
    return 0.25 * (texture(csmMap${i}, vec3(c.xy + vec2(-0.6, -1.4) * d, c.z)) + texture(csmMap${i}, vec3(c.xy + vec2(1.4, -0.6) * d, c.z))
                 + texture(csmMap${i}, vec3(c.xy + vec2(0.6, 1.4) * d, c.z)) + texture(csmMap${i}, vec3(c.xy + vec2(-1.4, 0.6) * d, c.z)));
  }
  vec3 csmCoord${i}(vec3 p, vec3 o) { return (csmMatrix[${i}] * vec4(p + o * csmTexel[${i}], 1.0)).xyz; }`).join('\n  ')}
  float csmEdge(vec3 c) { vec2 a = abs(c.xy - 0.5) * 2.0; return c.z > 1.0 ? 2.0 : max(a.x, a.y); }
  // 1 lit, 0 in a cast shadow. soft: 1 for four PCF taps (fragment shaders), 0 for one (per-vertex callers).
  float csmShadow(vec3 p, vec3 n, float kN, float kL, float soft) {
    if (csmStrength <= 0.0) return 1.0;
    const float BAND = 0.12;
    vec3 o = n * kN + sunDir * kL, c1, c2;
    float s, b, e1, e2;
    vec3 c0 = csmCoord0(p, o); float e0 = csmEdge(c0);
    if (e0 < 1.0) {
      s = csmTap0(c0, soft); b = smoothstep(1.0 - BAND, 1.0, e0);
      if (b > 0.0) { c1 = csmCoord1(p, o); s = mix(s, csmEdge(c1) < 1.0 ? csmTap1(c1, soft) : 1.0, b); }
    } else {
      c1 = csmCoord1(p, o); e1 = csmEdge(c1);
      if (e1 < 1.0) {
        s = csmTap1(c1, soft); b = smoothstep(1.0 - BAND, 1.0, e1);
        if (b > 0.0) { c2 = csmCoord2(p, o); s = mix(s, csmEdge(c2) < 1.0 ? csmTap2(c2, soft) : 1.0, b); }
      } else {
        c2 = csmCoord2(p, o); e2 = csmEdge(c2);
        s = e2 < 1.0 ? mix(csmTap2(c2, soft), 1.0, smoothstep(1.0 - BAND, 1.0, e2)) : 1.0;
      }
    }
    return mix(1.0, s, csmStrength);
  }

  // Shadow density over the point where the sun ray crosses the cloud base, from the bake: the
  // opacity of the same slices the dome draws along that ray, fading out at the edge of the bake.
  float atmoCloudDensity(vec2 xz) {
    vec2 uv = xz * cloudBakeInv + cloudOffset, e = abs(uv - 0.5) * 2.0;
    return texture2D(cloudMap, uv).r * (1.0 - smoothstep(0.85, 1.0, max(e.x, e.y)));
  }
  // 1 in sun, darker under a cloud: follows the sun ray up to the cloud base, so shadows sit
  // where the visible clouds are and stretch away from a low sun.
  float cloudOnly(vec3 worldPos) {
    vec2 xz = worldPos.xz + sunDir.xz * (cloudHeight - worldPos.y) / max(sunDir.y, 0.12);
    return 1.0 - cloudStrength * atmoCloudDensity(xz);
  }
  // Everything that shades by the sun without a normal (grass, shrubs, impostors, per vertex) gets
  // the cast shadow here too: one hardware-PCF tap, offset two texels toward the sun.
  float cloudShadow(vec3 worldPos) {
    return cloudOnly(worldPos) * csmShadow(worldPos, vec3(0.0), 0.0, 2.0, 0.0);
  }
  float atmoLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  // Weight of the sun-side horizon colour in direction v: a Henyey-Greenstein (g = 0.8) Mie lobe plus
  // a broad linear term, blended so the haze toward the sun matches the dome's glow.
  float atmoMieLobe(vec3 v) { float d = 1.64 - 1.6 * dot(v, sunDir); return clamp((1.0 / (d * sqrt(d)) - hazePhase.y) * hazePhase.z, 0.0, 1.0); }
  float atmoLobe(vec3 v) { return mix(clamp(0.5 + 0.5 * dot(v, sunDir) / hazePhase.w, 0.0, 1.0), atmoMieLobe(v), hazePhase.x); }
  // Horizon radiance of the dome in direction v: what an infinitely long path of air looks like.
  vec3 atmoSky(vec3 v) { return mix(skyHorizon, skySun, atmoLobe(v)); }
  // Optical depth (per unit extinction at hazeBase) along r through air whose density falls off
  // exponentially with height at rate k, so valleys hold more haze than ridges.
  float atmoDepth(float k, float dist, float ry, float cameraY) {
    float t = k * ry;
    float f = abs(t) > 1e-3 ? (1.0 - exp(-t)) / t : 1.0 - 0.5 * t;
    return dist * exp(-k * (cameraY - hazeBase)) * f;
  }
  // Rayleigh takes blue first (far light reddens, the air adds blue); Mie is nearly grey.
  vec3 atmoT(vec3 r, float cameraY) {
    float dist = length(r);
    return exp(-(hazeRayleigh * atmoDepth(hazeRayleighFalloff, dist, r.y, cameraY)
               + hazeDensity * atmoDepth(hazeHeightFalloff, dist, r.y, cameraY) * vec3(0.92, 1.0, 1.08)));
  }
  // Local contrast: a surface of luminance k (relative to the haze colour) gets air light scaled by
  // 1 - hazeContrast * (1 - k) * T, so dark crowns are lifted less than bright grass beside them,
  // and the weight fades out as T falls to 0, where everything meets the sky.
  float atmoContrast(float k, float T) { return 1.0 - hazeContrast * (1.0 - clamp(k, 0.0, 1.0)) * T; }
  // Callers that split the haze themselves as c * T + atmoInscatter(v) * (1 - T) (impostors.js, per
  // tree in the vertex shader) cannot pass the surface colour: atmoTransmittance remembers its T and
  // the following atmoInscatter applies the contrast weight for a surface of luminance ATMO_SPLIT_K
  // (far tree crowns). Define ATMO_SPLIT_K before this chunk to change it. Without a preceding
  // atmoTransmittance call in the same invocation (water reflections), atmoInscatter is the plain sky.
  #ifndef ATMO_SPLIT_K
  #define ATMO_SPLIT_K 0.12
  #endif
  float atmoSplitT = 0.0;
  vec3 atmoTransmittance(vec3 r, float cameraY) { vec3 T = atmoT(r, cameraY); atmoSplitT = T.g; return T; }
  vec3 atmoInscatter(vec3 v) { return atmoSky(v) * atmoContrast(ATMO_SPLIT_K, atmoSplitT); }
  // Aerial perspective: the surface colour fades toward the sky's horizon radiance in that direction.
  vec3 atmosphereApply(vec3 color, vec3 worldPos, vec3 cameraPos) {
    vec3 r = worldPos - cameraPos;
    vec3 T = atmoT(r, cameraPos.y);
    vec3 S = atmoSky(r / max(length(r), 1e-3));
    return color * T + S * (1.0 - T) * atmoContrast(atmoLum(color) / max(atmoLum(S), 1e-3), T.g);
  }
`;

// ---- Preetham sky, ported from three/addons/objects/Sky.js so the haze can use its exact colours.
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
function hg(mu, g = 0.8) { const g2 = g * g; return (1 - g2) / Math.pow(1 - 2 * g * mu + g2, 1.5); }   // unnormalised, as in the GLSL
export function skyRadiance(dir, sun, p, out = new THREE.Color()) {
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(THREE.MathUtils.clamp(sun.y, -1, 1))) / 1.5)));
  const sunfade = 1 - THREE.MathUtils.clamp(1 - Math.exp(sun.y / 450000), 0, 1);
  const rc = p.rayleigh - (1 - sunfade);
  const za = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - za / DEG, -1.253));
  const ct = dir.dot(sun);
  const rP = 0.05968310365946075 * (1 + Math.pow(ct * 0.5 + 0.5, 2));
  const mP = 0.07957747154594767 * hg(ct, p.mieDirectionalG);
  const fz = THREE.MathUtils.clamp(Math.pow(1 - sun.y, 5), 0, 1), gamma = 1 / (1.2 + 1.2 * sunfade);
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bR = TOTAL_RAYLEIGH[i] * rc, bM = 0.434 * 0.2 * p.turbidity * 10e-18 * MIE_CONST[i] * p.mieCoefficient;
    const Fex = Math.exp(-(bR * 8.4e3 * inv + bM * 1.25e3 * inv));
    const ratio = (bR * rP + bM * mP) / (bR + bM);
    let Lin = Math.pow(sunE * ratio * (1 - Fex), 1.5);
    Lin *= (1 - fz) + fz * Math.pow(sunE * ratio * Fex, 0.5);
    c[i] = Math.pow((Lin + 0.1 * Fex) * 0.04 + [0, 0.0003, 0.00075][i], gamma);
  }
  return out.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
}

// Sun colour by elevation (degrees), linear: white-warm high, orange below 10, red-orange at the horizon.
const SUN_RAMP = [
  [-4, [0.85, 0.22, 0.10]], [0, [1.0, 0.36, 0.14]], [4, [1.0, 0.52, 0.25]], [10, [1.0, 0.70, 0.42]],
  [20, [1.0, 0.86, 0.68]], [35, [1.0, 0.95, 0.86]], [90, [1.0, 0.98, 0.94]],
];
function sunRamp(elDeg, out) {
  if (elDeg <= SUN_RAMP[0][0]) return out.setRGB(...SUN_RAMP[0][1]);
  for (let i = 1; i < SUN_RAMP.length; i++) {
    const [e1, c1] = SUN_RAMP[i], [e0, c0] = SUN_RAMP[i - 1];
    if (elDeg <= e1) { const t = (elDeg - e0) / (e1 - e0); return out.setRGB(c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t); }
  }
  return out.setRGB(...SUN_RAMP[SUN_RAMP.length - 1][1]);
}

// Tileable noise for the cloud field, generated once (about 0.35 s at startup): r cumulus bodies (value fbm with
// Worley cells), g and b smooth fbm for the warp and the cirrus, a billows (inverted Worley fbm).
// r and a are rank-equalised to an even spread, so the threshold sets the cloud fraction directly.
function cloudNoiseTexture(size = 512) {
  const hash = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const wrap = (i, p) => ((i % p) + p) % p;
  const value = (u, v, period, seed) => {   // u, v in [0, 1); lattice wraps at `period`
    const x = u * period, y = v * period, i = Math.floor(x), j = Math.floor(y);
    let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const i1 = (i + 1) % period, j1 = (j + 1) % period;
    const a = hash(i, j, seed), b = hash(i1, j, seed), c = hash(i, j1, seed), d = hash(i1, j1, seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const worley = (u, v, period, seed) => {   // distance to the nearest feature point, in cells
    const x = u * period, y = v * period, i = Math.floor(x), j = Math.floor(y);
    let m = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ci = wrap(i + di, period), cj = wrap(j + dj, period);
      const px = i + di + hash(ci, cj, seed), py = j + dj + hash(ci, cj, seed + 7);
      const dd = (px - x) * (px - x) + (py - y) * (py - y); if (dd < m) m = dd;
    }
    return Math.min(Math.sqrt(m), 1);
  };
  const fbm = (fn, u, v, p0, oct, seed) => { let n = 0, amp = 0.5, sum = 0; for (let o = 0, p = p0; o < oct; o++, p *= 2) { n += amp * fn(u, v, p, seed + o * 13); sum += amp; amp *= 0.5; } return n / sum; };
  const N = size * size, ch = [new Float32Array(N), new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, k = y * size + x;
    ch[0][k] = 0.45 * fbm(value, u, v, 4, 5, 1) + 0.55 * (1 - fbm(worley, u, v, 4, 3, 41));
    ch[1][k] = fbm(value, u, v, 3, 4, 101);
    ch[2][k] = fbm(value, u, v, 3, 4, 201);
    ch[3][k] = 1 - fbm(worley, u, v, 6, 3, 301) * 0.75 - 0.25 * value(u, v, 24, 333);
  }
  const equalise = f => { const idx = new Uint32Array(N).map((_, i) => i); idx.sort((a, b) => f[a] - f[b]); const out = new Float32Array(N); for (let r = 0; r < N; r++) out[idx[r]] = r / (N - 1); return out; };
  const stretch = f => { let mn = Infinity, mx = -Infinity; for (const q of f) { mn = Math.min(mn, q); mx = Math.max(mx, q); } return f.map(q => (q - mn) / (mx - mn)); };
  const R = equalise(ch[0]), G = stretch(ch[1]), B = stretch(ch[2]), A = equalise(ch[3]);
  const data = new Uint8Array(N * 4);
  for (let k = 0; k < N; k++) { data[k * 4] = R[k] * 255 + 0.5; data[k * 4 + 1] = G[k] * 255 + 0.5; data[k * 4 + 2] = B[k] * 255 + 0.5; data[k * 4 + 3] = A[k] * 255 + 0.5; }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return releaseTexture(t);   // its bytes go once uploaded (gpuRelease.js)
}

// The baked shadow: a full-screen pass that, for each point of the cloud base around the camera,
// takes the opacity of the cloud slices the dome would draw up the sun ray from there (so looking
// at the sun from inside a shadow, a cloud covers it), darker where the cloud is thick.
function cloudBakePass() {
  const targets = [0, 1].map(() => {
    const t = new THREE.WebGLRenderTarget(CLOUD_BAKE_RES, CLOUD_BAKE_RES, { depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
    t.texture.colorSpace = THREE.NoColorSpace; t.texture.wrapS = t.texture.wrapT = THREE.ClampToEdgeWrapping; t.scissorTest = true;
    return t;
  });
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, bakeOrigin: { value: new THREE.Vector2() } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float cloudCover; uniform vec3 sunDir; uniform vec2 bakeOrigin; varying vec2 vUv;
      ${CLOUD_FIELD_GLSL}
      void main() {
        vec2 p = bakeOrigin + vUv * ${CLOUD_PERIOD.toFixed(1)}, dxz = sunDir.xz / max(sunDir.y, 0.12) * cloudShape.w;
        vec3 L = cloudLarge(p);
        float T = 1.0, xm = 0.0;
        for (int k = 0; k < ${CLOUD_SLICES}; k++) {
          float f = float(k) / ${CLOUD_SLICES}.0, x = cloudShapeAt(p + dxz * f, L) - f * f * cloudShape.z;
          T *= 1.0 - cloudCover0(x); xm = max(xm, x);
        }
        gl_FragColor = vec4((1.0 - T) * mix(0.55, 1.0, smoothstep(0.0, 0.6 * cloudShape.z, xm)), 0.0, 0.0, 1.0);
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  return { targets, back: 1, step: 0, origin: new THREE.Vector2(), material, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
}

// Per-season cloud strength (shadow darkness) and cover (shifts how much sky is cloud).
// Per season: [shadow strength, cover, cirrus, afternoon build-up]. Cover shifts the field before
// the threshold (0 is about a quarter of the sky); the build-up is added around 15:00 and taken
// off in the early morning, as fair-weather cumulus grow with the day's heating.
const CLOUDS = { winter: [0.6, 0.06, 0.55, 0.03], spring: [0.6, 0.0, 0.5, 0.08], summer: [0.55, -0.2, 0.3, 0.12], fall: [0.6, -0.02, 0.6, 0.05] };

export class Atmosphere {
  constructor(tile) {
    uniforms.cloudNoise.value = cloudNoiseTexture();
    this.cloudBake = cloudBakePass();
    uniforms.cloudMap.value = this.cloudBake.targets[0].texture;   // empty (no shadows) until the first bake completes
    this.cloudOfs = Object.fromEntries(Object.keys(CLOUD_LAYERS).map(k => [k, new THREE.Vector2()]));
    let mn = Infinity; const N = 64;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) mn = Math.min(mn, tile.heights.at(i / N * tile.size, j / N * tile.size));
    uniforms.hazeBase.value = mn;
    uniforms.cloudHeight.value = mn + 1800; this.cloudBase0 = mn + 1800;
    uniforms.landHeight.value = mn + 120;
    this.skyParams = { turbidity: 6, rayleigh: 1.6, mieCoefficient: 0.004, mieDirectionalG: 0.8 };
    this.sun = new THREE.Vector3(); this.sunIntensity = 3; this.exposure = 0.6;
    // Look tunables. Light is in the dome's radiance units: the sun is about 5x the sky light, and
    // sunlit ground ends up a little under the horizon sky, as outdoors, so haze lifts rather than greys.
    // Haze: mie scales the aerosol (x SEASON_LOOK haze^2), mieHeight its scale height in metres, rayleigh
    // the clear-air blue (x sea-level Rayleigh), contrast the dark-surface air-light reduction, gold the
    // blue taken out of a low sun's glow.
    this.tune = { sun: 11, ambient: 1.4, ambientSat: 0.6, exposure: 0.62, mie: 1.0, mieHeight: 800, rayleigh: 2.0, contrast: 0.4, gold: 1.0 };
    this.time = 0; this._v = new THREE.Vector3(); this._c = new THREE.Color(); this._c2 = new THREE.Color();
  }
  // Sky dome material hooks: drive its parameters from the same haze state and draw the clouds.
  // Bake the cloud shadows around the camera, a quarter of the square a frame into a back buffer
  // that is swapped in when complete (so the shadows lag the clouds by a few frames, under a metre).
  // The square sits where the sun rays from the ground near the camera cross the cloud base, and
  // snaps to its texels so the shadow edges do not crawl.
  bakeClouds(renderer, camera) {
    const b = this.cloudBake, k = b.step++ % CLOUD_BAKE_STRIPS, texel = CLOUD_PERIOD / CLOUD_BAKE_RES;
    if (k === 0) {
      const s = uniforms.sunDir.value, d = (uniforms.cloudHeight.value - uniforms.hazeBase.value) / Math.max(s.y, 0.12) * 0.6;
      b.origin.set(Math.round((camera.position.x + s.x * d - CLOUD_PERIOD / 2) / texel) * texel, Math.round((camera.position.z + s.z * d - CLOUD_PERIOD / 2) / texel) * texel);
      b.material.uniforms.bakeOrigin.value.copy(b.origin);
    }
    const t = b.targets[b.back], h = CLOUD_BAKE_RES / CLOUD_BAKE_STRIPS;
    t.scissor.set(0, k * h, CLOUD_BAKE_RES, h);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(t); renderer.render(b.scene, b.camera); renderer.setRenderTarget(prev);
    if (k === CLOUD_BAKE_STRIPS - 1) {
      uniforms.cloudMap.value = t.texture;
      uniforms.cloudOffset.value.set(-b.origin.x / CLOUD_PERIOD, -b.origin.y / CLOUD_PERIOD);
      b.back = 1 - b.back;
    }
  }
  attachSky(sky) {
    this.skyMaterial = sky.material;
    sky.material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = ATMOSPHERE_GLSL + shader.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', /* glsl */`
        // A low sun's glow is gold, not cream: the same lobe the haze uses carries the tint.
        // At the horizon it follows the haze's lobe exactly (so land and sky meet in one colour); higher up
        // only the forward-scattering halo around the sun.
        retColor *= mix(vec3(1.0), sunGlowTint, max(sqrt(atmoMieLobe(direction)), atmoLobe(direction) * (1.0 - smoothstep(0.0, 0.35, direction.y))));
        if (direction.y < 0.0 && cameraPosition.y > landHeight) {
          // Below the horizon: the land goes on past the tile as a hazy plain of wooded foothills, hazed
          // exactly like the terrain, so it meets the far ridges in the same air with no pale strip.
          vec3 r = direction * min((cameraPosition.y - landHeight) / -direction.y, 80000.0);
          vec3 land = vec3(0.15, 0.145, 0.095) * (sunLight * max(sunDir.y, 0.0) + ambientSky) * 0.3183099;
          retColor = atmosphereApply(land, cameraPosition + r, cameraPosition);
        }
        if (direction.y > 0.0) {
          // weather: an overcast sky greys (the deck drawn below covers it); fog veils it in the haze's own colour
          retColor = mix(retColor, vec3(atmoLum(retColor)) * skyWx.w, skyWx.x);
          retColor = mix(retColor, atmoSky(direction), skyWx.y * (1.0 - 0.6 * smoothstep(0.1, 0.9, direction.y)));
          float mu = dot(direction, sunDir), horizon = smoothstep(0.0, 0.1, direction.y);
          // Forward scattering (silver linings when backlit), normalised so the mean is about 1.
          float silver = 0.5 + 0.5 * 0.6975 / pow(1.3025 - 1.1 * mu, 1.5);
          // Cirrus: a thin sheet of streaks far above, stretched along the wind; no shadow.
          float tc = (cloudHeight + cloudCirrus.w - cameraPosition.y) / direction.y;
          vec2 cp = ${rotGLSL(CLOUD_LAYERS.cirrus[1])} * (cameraPosition.xz + direction.xz * tc) * vec2(${inv('cirrus')}, ${(3 / CLOUD_LAYERS.cirrus[0]).toExponential(6)}) + cloudCirrus.xy;
          vec2 cn = texture2D(cloudNoise, cp).ga;
          float ci = smoothstep(0.5, 1.15, cn.x * 0.85 + cn.y * 0.25) * cloudCirrus.z * horizon;
          vec3 cirrus = cloudSun * (0.10 + 0.16 * silver) + ambientSky * 0.75;
          cirrus = mix(cirrus, atmoSky(direction), 1.0 - exp(-tc * (hazeDensity * 0.3 + hazeRayleigh.g) * 0.5));
          retColor = mix(retColor, cirrus, min(ci * 0.4, skyWx.z));

          // Cumulus: a slab of heightfield clouds with flat bases at cloudHeight. The ray is sampled at the
          // base plane and at heights up the slab, front to back, so the bases, the flanks and the tops of
          // far clouds all show; then two looks up the sun ray from the point seen, for the light.
          float EH = cloudShape.z, TK = cloudShape.w;
          float tb = (cloudHeight - cameraPosition.y) / direction.y;
          vec2 pb = cameraPosition.xz + direction.xz * tb, dxz = direction.xz * (TK / direction.y);
          vec3 L = cloudLarge(pb);
          // Three slices: the base, and the cloud's cross-sections a third and two thirds of the way up the
          // slab. A cloud's top is dome-shaped (height sqrt(x / EH)), so the upper sections are smaller lobes
          // set back along the ray: low down they stand behind the base as the heap's flanks and top.
          const int n = ${CLOUD_SLICES};
          float T = 1.0, wf = 0.0, wh = 0.0, wd = 0.0, w0 = 0.0; vec2 wp = vec2(0.0);
          for (int k = 0; k < n; k++) {
            if (T < 0.03) break;
            float f = float(k) / float(n);
            vec2 p = pb + dxz * f;
            float x = cloudShapeAt(p, L) - f * f * EH, w = cloudCover0(x) * T;
            wf += w * f; wh += w * clamp(x / EH, 0.0, 1.0); wd += w * cloudBillow; wp += w * p;
            if (k == 0) w0 = w;
            T -= w;
          }
          float a = 1.0 - T;
          if (a > 0.003) {
            float hf = wf / a, hh = wh / a, hd = wd / a; vec2 ph = wp / a;
            vec2 st = sunDir.xz / max(sunDir.y, 0.15) * (0.3 * TK);
            float occ = max(cloudBodyAt(ph + st, L) - (hf + 0.3) * EH, 0.0) + max(cloudBodyAt(ph + 2.2 * st, L) - (hf + 0.66) * EH, 0.0);
            vec3 sunC = cloudSun * exp(-occ / EH * 2.5);   // dimmed by cloud between this point and the sun
            float lump = mix(0.8, 1.12, hd);
            // Base, seen from below: sky and ground light, and sun through the cloud above it, which only
            // thin parts let through (glowing when backlit); thick cores stay grey.
            vec3 base = ambientSky * (0.62 - 0.25 * hh) + ambientGround * 0.25 + sunC * (0.05 * exp(-3.0 * hh) + 0.12 * silver * exp(-7.0 * hh));
            // Walls and tops face the viewer: sunlit with the sun behind us or high, brighter with height
            // (tops), rimmed where thin when backlit.
            float facing = mix(0.5 - 0.5 * dot(normalize(direction.xz + 1e-5), normalize(sunDir.xz + 1e-5)), 1.0, clamp(sunDir.y * 1.4, 0.0, 1.0));
            vec3 side = ambientSky * (0.5 + 0.2 * hf) + ambientGround * 0.12 + sunC * ((0.05 + 0.32 * facing) * (0.6 + 0.4 * hf) + 0.06 * silver * exp(-4.0 * hh));
            vec3 cc = mix(side, base, w0 / a) * lump;
            cc = mix(cc, atmoSky(direction), 1.0 - exp(-tb * (hazeDensity + hazeRayleigh.g) * 0.5));   // far clouds sink into the haze
            retColor = mix(retColor, cc, a * horizon * cloudOpacity);
          }
        }
        gl_FragColor = vec4( retColor, 1.0 );`);
    };
  }
  // Inject the shared uniforms, per-pixel cloud shadow on direct light and aerial perspective
  // into a MeshLambertMaterial (instanced trees).
  patchLambert(material) {
    material.fog = false;
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vAtmoPos;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 atmoWP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            atmoWP = instanceMatrix * atmoWP;
          #endif
          vAtmoPos = (modelMatrix * atmoWP).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vAtmoPos;\n' + ATMOSPHERE_GLSL)
        // Sun term only: the hemisphere light is indirect. The normal offset uses the shading normal
        // (crown-shaped on the leaf cards), which keeps the lit side of a crown free of acne.
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
          reflectedLight.directDiffuse *= cloudOnly(vAtmoPos) * csmShadow(vAtmoPos, transformNormalByInverseViewMatrix(normal, viewMatrix), 1.5, 1.5, 1.0);`)
        .replace('#include <opaque_fragment>', 'outgoingLight = atmosphereApply(outgoingLight, vAtmoPos, cameraPosition);\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey = () => 'atmosphere-lambert';
    material.needsUpdate = true;
  }
  // The weather's haze (main.js calls it after spirit.js's look): the aerosol swells with humidity; rain, drizzle,
  // snow and fog add their own extinction, rain and snow up to the cloud base, fog lying low (a ~180 m scale height,
  // so it fills the valleys). It comes after the look, not before it as the rest of the weather does, because the
  // look multiplies the haze 14-fold for its mist: on top of a rain's or a fog's extinction that is a white-out, so
  // the look thickens the clear air and the weather's own extinction is added to that as it is.
  applyWeatherHaze() {
    const wx = this.wx; if (!wx) return;
    const base = uniforms.hazeDensity.value * wx.hazeMul, add = wx.hazeAdd, fogX = 3.5e-3 * wx.fog, h0 = 1 / uniforms.hazeHeightFalloff.value;
    uniforms.hazeDensity.value = base + add;
    uniforms.hazeHeightFalloff.value = Math.max(base + add, 1e-9) / (base * h0 + (add - fogX) * Math.max(wx.cloudBase, h0) + fogX * 180);
  }
  // sun: from sunDirection(); look: SEASON_LOOK entry; season name for clouds; hour for haze; wx: weather.js fx (or
  // null: the season's own clouds and haze, as before the weather).
  update(dt, sun, look, season, hour, camera, wx = null) {
    if (wx && !wx.on) wx = null;
    this.time += dt;
    const elDeg = sun.elevation / DEG, haze = look.haze ?? 1;
    const lowSun = 1 - THREE.MathUtils.smoothstep(elDeg, 4, 25);
    const s = this.sun.set(...sun.dir).normalize();
    uniforms.sunDir.value.copy(s);

    // Dome parameters from the haze state: hazier air is whiter and dimmer blue.
    const p = this.skyParams;
    p.turbidity = 2 + 3.5 * haze + 1.0 * lowSun;
    p.rayleigh = 1.9 - 0.4 * haze;
    p.mieCoefficient = 0.002 + 0.0015 * haze;
    const grey = wx ? clamp01(0.85 * wx.overcast + wx.fog) : 0;
    if (wx) p.turbidity = Math.min(p.turbidity + 3 * wx.fog + 1.5 * wx.overcast + 1.5 * (wx.hazeMul - 1), 10);
    if (this.skyMaterial) {
      const u = this.skyMaterial.uniforms;
      u.sunPosition.value.copy(s); u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mieCoefficient; u.mieDirectionalG.value = p.mieDirectionalG;
    }

    // Horizon colours under and away from the sun, the side, and the zenith, from the dome's own model.
    const hz = Math.hypot(s.x, s.z) || 1, hx = s.x / hz, hzz = s.z / hz, v = this._v;
    skyRadiance(v.set(hx, 0, hzz), s, p, uniforms.skySun.value);
    skyRadiance(v.set(-hx, 0, -hzz), s, p, uniforms.skyHorizon.value);
    const side = skyRadiance(v.set(-hzz, 0, hx), s, p, this._c2);
    skyRadiance(v.set(0, 1, 0), s, p, uniforms.skyZenith.value);
    // weather: under a deck or in fog the sky's colours go to grey. The haze's far colours (the horizon, under and away
    // from the sun) also lose the clear sky's brightness under a deck, about half, and the sun's lobe in it: the air
    // between the eye and a far ridge is lit by the grey light under the deck, not by a clear sky's (the sky light the
    // ground gets is kept: zenith and side, below).
    if (grey > 0) {
      const H = uniforms.skyHorizon.value, S = uniforms.skySun.value;
      S.lerp(H, wx.overcast);
      for (const col of [S, H, side, uniforms.skyZenith.value]) {
        const l = lum(col) * (col === S || col === H ? 1 - 0.5 * wx.overcast : 1); col.lerp(this._c.setRGB(l, l, l * 1.03), grey);
      }
    }
    // Fit the Mie / linear blend so the GLSL lobe matches the dome at 90 degrees from the sun.
    const c = Math.max(Math.cos(sun.elevation), 0.05), hgMin = hg(-c), hgMax = hg(c);
    const span = lum(uniforms.skySun.value) - lum(uniforms.skyHorizon.value);
    const wSide = span > 1e-4 ? (lum(side) - lum(uniforms.skyHorizon.value)) / span : 0.5;
    const wm0 = (hg(0) - hgMin) / (hgMax - hgMin);
    uniforms.hazePhase.value.set(THREE.MathUtils.clamp((0.5 - wSide) / Math.max(0.5 - wm0, 1e-3), 0, 1), hgMin, 1 / (hgMax - hgMin), c);
    // The Preetham halo is neutral (even greenish) around a low sun and tone maps to cream. Light scattered
    // forward by aerosol has the colour of the reddened sun, so the lobe goes gold (from 26 degrees, full by 6): in
    // the dome (sunGlowTint) and in the haze toward the sun (skySun). The target is about the colour of an
    // 8-degree sun and a little dimmer, since ACES only keeps hue below its shoulder.
    const gold = this.tune.gold * (1 - THREE.MathUtils.smoothstep(elDeg, 6, 26));
    uniforms.sunGlowTint.value.setRGB(1 - 0.06 * gold, 1 - 0.32 * gold, 1 - 0.64 * gold);
    uniforms.skySun.value.multiply(uniforms.sunGlowTint.value);

    // Sun: colour by elevation, intensity fading through the last few degrees above the horizon.
    sunRamp(elDeg, uniforms.sunColor.value);
    const tune = this.tune;
    this.sunIntensity = tune.sun * (1 - Math.exp(-Math.max(elDeg + 1, 0) / 5)) * (wx ? wx.sunDim : 1);
    uniforms.sunLight.value.copy(uniforms.sunColor.value).multiplyScalar(this.sunIntensity);

    // Sky light: the dome between zenith and the side horizon; ground bounce is warm and follows the sun.
    const amb = uniforms.ambientSky.value.copy(uniforms.skyZenith.value).multiplyScalar(0.4).add(this._c.copy(side).multiplyScalar(0.6)).multiplyScalar(tune.ambient);
    // weather: a deck or fog spreads the sun into the sky light (more of it, flatter, greyer); lightning lifts it all
    if (wx) amb.multiplyScalar(1 + 0.35 * wx.overcast + 0.3 * wx.fog).addScalar(2.5 * wx.flash);
    const ambL = lum(amb), sat = tune.ambientSat * (1 - 0.8 * grey);
    amb.setRGB(ambL + (amb.r - ambL) * sat, ambL + (amb.g - ambL) * sat, ambL + (amb.b - ambL) * sat);
    if (wx?.flash) for (const col of [uniforms.skyHorizon.value, uniforms.skySun.value, uniforms.skyZenith.value]) col.addScalar(1.5 * wx.flash);
    uniforms.ambientGround.value.setRGB(0.30, 0.24, 0.16).multiplyScalar(this.sunIntensity * 0.12 + ambL * 0.4);

    // Haze: clear air is the same all year; the aerosol is set by the season (summer dust and smoke
    // thickest, rain-washed winter clearest) and thickens toward a low sun.
    uniforms.hazeDensity.value = tune.mie * 7.5e-5 * haze * haze * (1 + 0.5 * lowSun);
    uniforms.hazeHeightFalloff.value = 1 / tune.mieHeight;
    this.wx = wx;   // the weather's haze: applyWeatherHaze, after the spirit's look
    uniforms.hazeRayleigh.value.set(5.8e-6, 13.5e-6, 33.1e-6).multiplyScalar(tune.rayleigh);
    uniforms.hazeContrast.value = tune.contrast * (wx ? (1 - 0.6 * wx.rainVis) * (1 - 0.5 * wx.fog) : 1);

    // Clouds: coverage from the season plus an afternoon build-up; sunlight at cloud height, where the
    // sun sets about 1.4 degrees later than on the ground (horizon dip from ~1.8 km), so the cumulus
    // stay lit, pink and gold, a little after the land has gone into shade.
    const [strength, cover, cirrus, build] = CLOUDS[season] || CLOUDS.fall;
    const day = Math.exp(-Math.pow(((hour ?? 12) - 15) / 3.2, 2));
    uniforms.cloudStrength.value = strength * THREE.MathUtils.smoothstep(elDeg, -2, 6);   // no shadows without a sun
    uniforms.cloudCover.value = cover + build * (day - 0.35);
    uniforms.cloudOpacity.value = 1;
    uniforms.cloudCirrus.value.z = cirrus;
    uniforms.skyWx.value.set(0, 0, 1, 1);
    uniforms.cloudHeight.value = this.cloudBase0;
    if (wx) {
      // the measured sky: slab cover (a little afternoon swell kept for life), the cirrus, darker shadows under a thick
      // deck, the base from the dew-point spread (kept over the camera, so a deck is never seen from above)
      uniforms.cloudCover.value = coverFor(wx.slab) + 0.3 * build * (day - 0.35) * (1 - wx.overcast);
      uniforms.cloudCirrus.value.z = 1.4 * wx.high;
      uniforms.cloudStrength.value = (strength + (0.92 - strength) * wx.slab * wx.slab) * THREE.MathUtils.smoothstep(elDeg, -2, 6);
      uniforms.cloudHeight.value = Math.max(uniforms.hazeBase.value + wx.cloudBase, camera.position.y + 150);
      uniforms.skyWx.value.set(Math.min(1, 1.2 * grey), wx.fog, 0.4 + 0.45 * wx.high, 1 - 0.5 * wx.overcast);
      uniforms.windDrift.value.set(wx.windTo[0], wx.windTo[1]);
    } else uniforms.windDrift.value.set(1, 0.12).normalize();
    const elC = elDeg + 1.4;
    sunRamp(elC, uniforms.cloudSun.value).multiplyScalar(tune.sun * (1 - Math.exp(-Math.max(elC + 1, 0) / 5)) * (wx ? 1 - 0.5 * wx.overcast : 1));
    // the drift follows the wind: the layers' speeds scale from a third (calm) to about three times (40 km/h)
    const drift = wx ? Math.min(0.3 + wx.windKmh / 14, 4) : 1, WIND_DIR = uniforms.windDrift.value;
    // Each layer drifts at its own speed (the shear reshapes the clouds slowly); offsets are in the
    // layer's rotated uv and wrap, so they never lose precision.
    for (const [key, [period, angle, speed]] of Object.entries(CLOUD_LAYERS)) {
      const dir = key === 'cirrus' ? this._v.set(WIND_DIR.x * 0.95 - WIND_DIR.y * 0.3, 0, WIND_DIR.y * 0.95 + WIND_DIR.x * 0.3) : this._v.set(WIND_DIR.x, 0, WIND_DIR.y);
      const dx = dir.x * speed * drift * dt, dz = dir.z * speed * drift * dt, c = Math.cos(angle), sn = Math.sin(angle);
      const o = this.cloudOfs[key];
      const py = key === 'cirrus' ? period / 3 : period;   // cirrus is squeezed 3x across its streaks
      o.x = (o.x - (c * dx - sn * dz) / period) % 1; o.y = (o.y - (sn * dx + c * dz) / py) % 1;
    }
    const O = this.cloudOfs;
    uniforms.cloudOfsA.value.set(O.cover.x, O.cover.y, O.warp.x, O.warp.y);
    uniforms.cloudOfsB.value.set(O.base.x, O.base.y, O.detail.x, O.detail.y);
    uniforms.cloudCirrus.value.x = O.cirrus.x; uniforms.cloudCirrus.value.y = O.cirrus.y;

    // Exposure follows the brightness of the sky, partly: dusk is dimmer than noon but readable.
    // Facing a low sun the eye stops down, so the glare stays golden and the land goes to silhouette.
    const fwd = camera.getWorldDirection(this._v);
    const glare = Math.pow(Math.max(fwd.dot(s), 0), 6) * lum(uniforms.skySun.value);
    // A high sun on bare summer grass is about twice the light of a mid-morning one, so stop down for it too.
    const key = 0.7 * lum(side) + 0.1 * this.sunIntensity + 0.5 * glare;
    const ground = this.sunIntensity * Math.max(s.y, 0) + ambL;
    const target = THREE.MathUtils.clamp(tune.exposure * Math.pow(Math.max(key, 1e-3) / 1.7, -0.35) * Math.min(1, Math.pow(ground / 5.8, -0.5))
      * (wx ? 1 + 0.3 * wx.overcast + 0.2 * wx.fog : 1), 0.25, 2.2);   // the eye opens a little under a grey sky
    this.exposure += (target - this.exposure) * (1 - Math.exp(-dt * 2.5));
    return this;
  }
}
