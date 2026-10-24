import * as THREE from 'three';

// Shared atmosphere: one set of uniforms and one GLSL chunk used by every material, so the
// terrain, trees, impostors, grass and sky dome all see the same air. Aerial perspective is an
// exponential height haze whose far colour is the sky dome's own horizon radiance (computed
// here with the dome's Preetham model), so distant ridges dissolve into the sky rather than into
// a fog colour. Clouds are one tileable noise texture on a plane above the tile; the ground
// samples it along the sun direction for shadows and the dome samples it for the clouds you see.

export const CLOUD_PERIOD = 2500;      // metres per repeat of the cloud texture
const WIND = new THREE.Vector2(6, 0);  // m/s, along +x
const DEG = Math.PI / 180;

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
  hazeDensity: { value: 3e-4 },                            // extinction per metre at hazeBase
  hazeHeightFalloff: { value: 1 / 500 },                   // 1 / scale height
  hazeBase: { value: 0 },                                  // y of the densest air (tile floor)
  landHeight: { value: 0 },                                // the dome draws a hazy plain at this y below the horizon, past the tile
  cloudMap: { value: null },
  cloudOffset: { value: new THREE.Vector2() },
  cloudStrength: { value: 0.4 },                           // shadow darkness (fades out with the sun)
  cloudOpacity: { value: 0.8 },                            // visible clouds in the dome
  cloudCover: { value: 0 },                                // added to the noise before the coverage ramp
  cloudHeight: { value: 2000 },
  // Cascaded sun shadows (shadows.js renders the maps and sets these). Until it runs, every
  // matrix maps the world outside its cascade, so the lookup returns 1 (lit).
  csmMap0: { value: null }, csmMap1: { value: null }, csmMap2: { value: null },
  csmMatrix: { value: [0, 1, 2].map(() => new THREE.Matrix4().set(0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 1)) },
  csmTexel: { value: new THREE.Vector3(1, 1, 1) },     // metres per shadow texel, per cascade
  csmInvSize: { value: new THREE.Vector3(1, 1, 1) },   // 1 / map size, per cascade
  csmStrength: { value: 0 },                           // 0 below ~3 degrees of sun, 1 by 6
};

export const ATMOSPHERE_GLSL = /* glsl */`
  uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 sunLight; uniform vec3 ambientSky; uniform vec3 ambientGround;
  uniform vec3 skyZenith; uniform vec3 skyHorizon; uniform vec3 skySun; uniform vec4 hazePhase;
  uniform float hazeDensity; uniform float hazeHeightFalloff; uniform float hazeBase; uniform float landHeight;
  uniform sampler2D cloudMap; uniform vec2 cloudOffset; uniform float cloudStrength; uniform float cloudOpacity; uniform float cloudCover; uniform float cloudHeight;

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

  float atmoCloudDensity(vec2 xz) {
    return smoothstep(0.45, 0.75, texture2D(cloudMap, xz / ${CLOUD_PERIOD.toFixed(1)} + cloudOffset).r + cloudCover);
  }
  // 1 in sun, darker under a cloud: follows the sun ray up to the cloud plane, so shadows sit
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
  // Horizon radiance of the dome in direction v: a Henyey-Greenstein (g = 0.8) Mie lobe plus a
  // broad linear term, blended so the haze toward the sun matches the dome's glow.
  vec3 atmoInscatter(vec3 v) {
    float mu = dot(v, sunDir), c = hazePhase.w;
    float d = 1.64 - 1.6 * mu;
    float wm = clamp((1.0 / (d * sqrt(d)) - hazePhase.y) * hazePhase.z, 0.0, 1.0);
    float wl = clamp(0.5 + 0.5 * mu / c, 0.0, 1.0);
    return mix(skyHorizon, skySun, mix(wl, wm, hazePhase.x));
  }
  // Transmittance along r (camera to point): optical depth through air whose density falls off
  // exponentially with height, so valleys hold more haze than ridges.
  vec3 atmoTransmittance(vec3 r, float cameraY) {
    float dist = length(r), t = hazeHeightFalloff * r.y;
    float f = abs(t) > 1e-3 ? (1.0 - exp(-t)) / t : 1.0 - 0.5 * t;
    float depth = hazeDensity * dist * exp(-hazeHeightFalloff * (cameraY - hazeBase)) * f;
    return exp(-depth * vec3(0.85, 1.0, 1.2));   // slightly chromatic: far light loses blue, the air adds it
  }
  // Aerial perspective: the surface colour fades toward the sky's horizon radiance in that direction.
  vec3 atmosphereApply(vec3 color, vec3 worldPos, vec3 cameraPos) {
    vec3 r = worldPos - cameraPos;
    vec3 T = atmoTransmittance(r, cameraPos.y);
    return color * T + atmoInscatter(r / max(length(r), 1e-3)) * (1.0 - T);
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

// Tileable fbm value noise on a canvas, generated once: the cloud field for shadows and sky.
function cloudTexture(size = 512) {
  const hash = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const octave = (u, v, period, seed) => {   // u, v in [0, 1); lattice wraps at `period`
    const x = u * period, y = v * period, i = Math.floor(x), j = Math.floor(y);
    let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const i1 = (i + 1) % period, j1 = (j + 1) % period;
    const a = hash(i, j, seed), b = hash(i1, j, seed), c = hash(i, j1, seed), d = hash(i1, j1, seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const f = new Float32Array(size * size); let mn = Infinity, mx = -Infinity;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let u = x / size, v = y / size;
    // a gentle periodic domain warp so the clouds are not lattice-aligned blobs
    const wu = octave(u, v, 4, 91) - 0.5, wv = octave(u, v, 4, 92) - 0.5;
    u = (u + wu * 0.08 + 1) % 1; v = (v + wv * 0.08 + 1) % 1;
    let n = 0, amp = 0.5, sum = 0;
    for (let o = 0, p = 3; o < 6; o++, p *= 2) { n += amp * octave(u, v, p, o + 1); sum += amp; amp *= 0.5; }
    n /= sum; f[y * size + x] = n; mn = Math.min(mn, n); mx = Math.max(mx, n);
  }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const g = canvas.getContext('2d'), img = g.createImageData(size, size);
  // Contrast curve: fbm piles up mid-grey, which would make every shadow edge hundreds of metres
  // soft; steepening it gives cumulus-like edges while the fine octaves keep them ragged.
  for (let k = 0; k < f.length; k++) {
    const n = Math.round(255 * THREE.MathUtils.smoothstep((f[k] - mn) / (mx - mn), 0.3, 0.8));
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = n; img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true;
  return t;
}

// Per-season cloud strength (shadow darkness) and cover (shifts how much sky is cloud).
const CLOUDS = { winter: [0.5, -0.02], spring: [0.45, -0.04], summer: [0.3, -0.35], fall: [0.4, -0.06] };   // [strength, cover]

export class Atmosphere {
  constructor(tile) {
    uniforms.cloudMap.value = cloudTexture();
    let mn = Infinity; const N = 64;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) mn = Math.min(mn, tile.heights.at(i / N * tile.size, j / N * tile.size));
    uniforms.hazeBase.value = mn;
    uniforms.cloudHeight.value = mn + 1800;
    uniforms.landHeight.value = mn + 120;
    this.skyParams = { turbidity: 6, rayleigh: 1.6, mieCoefficient: 0.004, mieDirectionalG: 0.8 };
    this.sun = new THREE.Vector3(); this.sunIntensity = 3; this.exposure = 0.6;
    // Look tunables. Light is in the dome's radiance units: the sun is about 5x the sky light, and
    // sunlit ground ends up a little under the horizon sky, as outdoors, so haze lifts rather than greys.
    this.tune = { sun: 11, ambient: 1.4, ambientSat: 0.6, haze: 0.75, exposure: 0.62 };
    this.time = 0; this._v = new THREE.Vector3(); this._c = new THREE.Color(); this._c2 = new THREE.Color();
  }
  // Sky dome material hooks: drive its parameters from the same haze state and draw the clouds.
  attachSky(sky) {
    this.skyMaterial = sky.material;
    sky.material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = ATMOSPHERE_GLSL + shader.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', /* glsl */`
        if (direction.y < 0.0 && cameraPosition.y > landHeight) {
          // Below the horizon: the land goes on past the tile as a hazy plain, so the world has no bright rim.
          vec3 r = direction * min((cameraPosition.y - landHeight) / -direction.y, 80000.0);
          vec3 land = vec3(0.10, 0.10, 0.065) * (sunLight * max(sunDir.y, 0.0) + ambientSky) * 0.3183099;
          vec3 T = atmoTransmittance(r, cameraPosition.y);
          retColor = land * T + retColor * (1.0 - T);
        }
        if (direction.y > 0.0) {
          float t = (cloudHeight - cameraPosition.y) / direction.y;
          float n = texture2D(cloudMap, (cameraPosition.xz + direction.xz * t) / ${CLOUD_PERIOD.toFixed(1)} + cloudOffset).r + cloudCover;
          float a = smoothstep(0.45, 0.75, n) * smoothstep(0.05, 0.3, direction.y) * cloudOpacity;   // fade before the 2.5 km repeat shows in rows
          float thick = smoothstep(0.7, 1.05, n);   // seen from below, thick cores are darker and thin edges glow
          vec3 lit = sunLight * (0.22 + 0.25 * max(dot(direction, sunDir), 0.0)) * (1.25 - 0.75 * thick) + ambientSky * (0.6 - 0.2 * thick);
          lit = mix(lit, atmoInscatter(direction), 1.0 - exp(-t * hazeDensity * 0.25));   // far clouds sink into the haze
          retColor = mix(retColor, lit, a * 0.9);
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
          reflectedLight.directDiffuse *= cloudOnly(vAtmoPos) * csmShadow(vAtmoPos, inverseTransformDirection(normal, viewMatrix), 1.5, 1.5, 1.0);`)
        .replace('#include <opaque_fragment>', 'outgoingLight = atmosphereApply(outgoingLight, vAtmoPos, cameraPosition);\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey = () => 'atmosphere-lambert';
    material.needsUpdate = true;
  }
  // sun: from sunDirection(); look: SEASON_LOOK entry; season name for clouds; hour for haze.
  update(dt, sun, look, season, hour, camera) {
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
    // Fit the Mie / linear blend so the GLSL lobe matches the dome at 90 degrees from the sun.
    const c = Math.max(Math.cos(sun.elevation), 0.05), hgMin = hg(-c), hgMax = hg(c);
    const lum = col => 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
    const span = lum(uniforms.skySun.value) - lum(uniforms.skyHorizon.value);
    const wSide = span > 1e-4 ? (lum(side) - lum(uniforms.skyHorizon.value)) / span : 0.5;
    const wm0 = (hg(0) - hgMin) / (hgMax - hgMin);
    uniforms.hazePhase.value.set(THREE.MathUtils.clamp((0.5 - wSide) / Math.max(0.5 - wm0, 1e-3), 0, 1), hgMin, 1 / (hgMax - hgMin), c);

    // Sun: colour by elevation, intensity fading through the last few degrees above the horizon.
    sunRamp(elDeg, uniforms.sunColor.value);
    const tune = this.tune;
    this.sunIntensity = tune.sun * (1 - Math.exp(-Math.max(elDeg + 1, 0) / 5));
    uniforms.sunLight.value.copy(uniforms.sunColor.value).multiplyScalar(this.sunIntensity);

    // Sky light: the dome between zenith and the side horizon; ground bounce is warm and follows the sun.
    const amb = uniforms.ambientSky.value.copy(uniforms.skyZenith.value).multiplyScalar(0.4).add(this._c.copy(side).multiplyScalar(0.6)).multiplyScalar(tune.ambient);
    const ambL = lum(amb);
    amb.setRGB(ambL + (amb.r - ambL) * tune.ambientSat, ambL + (amb.g - ambL) * tune.ambientSat, ambL + (amb.b - ambL) * tune.ambientSat);
    uniforms.ambientGround.value.setRGB(0.30, 0.24, 0.16).multiplyScalar(this.sunIntensity * 0.12 + ambL * 0.4);

    // Haze: season sets the base (summer thickest, winter clearest); low sun thickens it.
    uniforms.hazeDensity.value = tune.haze * 3.0e-4 * Math.pow(haze, 1.5) * (1 + 0.5 * lowSun);

    // Clouds drift with the wind; the offset wraps so it never loses precision.
    const [strength, cover] = CLOUDS[season] || CLOUDS.fall;
    uniforms.cloudStrength.value = strength * THREE.MathUtils.smoothstep(elDeg, -2, 6);   // no shadows without a sun
    uniforms.cloudCover.value = cover;
    uniforms.cloudOpacity.value = THREE.MathUtils.clamp(strength * 2, 0, 1);
    const o = uniforms.cloudOffset.value;
    o.x = (o.x - WIND.x * dt / CLOUD_PERIOD) % 1; o.y = (o.y - WIND.y * dt / CLOUD_PERIOD) % 1;

    // Exposure follows the brightness of the sky, partly: dusk is dimmer than noon but readable.
    // Facing a low sun the eye stops down, so the glare stays golden and the land goes to silhouette.
    const fwd = camera.getWorldDirection(this._v);
    const glare = Math.pow(Math.max(fwd.dot(s), 0), 6) * lum(uniforms.skySun.value);
    // A high sun on bare summer grass is about twice the light of a mid-morning one, so stop down for it too.
    const key = 0.7 * lum(side) + 0.1 * this.sunIntensity + 0.35 * glare;
    const ground = this.sunIntensity * Math.max(s.y, 0) + ambL;
    const target = THREE.MathUtils.clamp(tune.exposure * Math.pow(Math.max(key, 1e-3) / 1.7, -0.35) * Math.min(1, Math.pow(ground / 5.8, -0.5)), 0.25, 2.2);
    this.exposure += (target - this.exposure) * (1 - Math.exp(-dt * 2.5));
    return this;
  }
}
