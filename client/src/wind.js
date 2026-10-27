import * as THREE from 'three';

// One wind field shared by every material that moves or shimmers with it: grass blades, tufts,
// sward shells, shrub clumps and the gust sheen painted on the terrain. The same uniforms objects
// go into every material, so Grass.update advancing `time` reaches them all.
// The weather (weather.js) sets windDir (the way the measured wind blows) and windStrength (from its speed, with a slow
// gust swell) each frame; without weather they keep these defaults.
export const windUniforms = {
  time: { value: 0 }, windDir: { value: new THREE.Vector2(1, 0.25).normalize() }, windStrength: { value: 0.42 },
};

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
