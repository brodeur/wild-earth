import * as THREE from 'three';

// One wind field shared by every material that moves or shimmers with it: grass blades, tufts,
// sward shells, shrub clumps and the gust sheen painted on the terrain. The same uniforms objects
// go into every material, so Grass.update advancing `time` reaches them all.
// The weather (weather.js) sets windDir (the way the measured wind blows) and windStrength (from its speed, with a slow
// gust swell) each frame; without weather they keep these defaults.
export const windUniforms = {
  time: { value: 0 }, windDir: { value: new THREE.Vector2(1, 0.25).normalize() }, windStrength: { value: 0.42 },
};

// The scent's carry (2026-10-28 scent.js, the player's nose; 2026-10-29 animals.js noticeAt, every animal's): how far a
// nose reaches a source at (dx, dz) from it (from the source to the nose), as a share of its reach straight upwind: a
// source the wind blows from carries at the full reach (SCENT_SHAPE(1)), crosswind at about half, downwind at a fifth,
// and in a weak wind the shape gives way to still air (SCENT_STILL all round: the scent pools), between SCENT_CALM and
// SCENT_FULL of windStrength.
export const SCENT_SHAPE = c => c >= 0 ? 0.5 + 0.5 * c : 0.5 + 0.3 * c, SCENT_STILL = 0.45, SCENT_CALM = 0.14, SCENT_FULL = 0.34;
export function scentCarry(dx, dz) {
  const w = windUniforms.windDir.value, ws = windUniforms.windStrength.value;
  const windy = Math.min(1, Math.max(0, (ws - SCENT_CALM) / (SCENT_FULL - SCENT_CALM))), wl = Math.hypot(w.x, w.y) || 1, dh = Math.hypot(dx, dz);
  const c = dh > 1e-3 ? (dx * w.x + dz * w.y) / (wl * dh) : 0;   // the wind blows from the source toward the nose: c > 0
  return SCENT_STILL + (SCENT_SHAPE(c) - SCENT_STILL) * windy;
}

export const WIND_GLSL = /* glsl */`
  uniform float time; uniform vec2 windDir; uniform float windStrength;
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }
  // Gust field: slow ~20 m gust cells advected downwind (the waves you see run across a field),
  // over two octaves of travelling sin/cos ripples. About 0.15 in a lull to 1.25 in a gust.
  float gust(vec2 p) {
    float slow = wNoise((p - windDir * time * 4.0) * 0.045);
    float o1 = sin(dot(p, vec2(0.21, 0.13)) - time * 1.9) * cos(dot(p, vec2(-0.07, 0.17)) - time * 1.3);
    float o2 = sin(dot(p, vec2(0.53, -0.41)) - time * 3.7);
    return 0.15 + 0.85 * smoothstep(0.25, 0.85, slow) + 0.16 * o1 + 0.06 * o2;
  }
`;
