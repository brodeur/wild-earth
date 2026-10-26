import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { groundUniforms, GROUND_GLSL } from './terrain.js';
import { windUniforms, WIND_GLSL } from './wind.js';

// Sward shells: a few stacked, cut-out copies of the ground under the camera (shell texturing, as
// for fur), so from 8-60 m up a grassland reads as a dense, deep sward rather than blades over a
// photo. Looking down is the best case for shells; toward grazing views they fade out, since the
// layers would separate into sheets there (and the blade clumps carry that view anyway).
// One instanced draw: a 2 m grid conforming exactly to the terrain's 10 m triangles, drawn once
// per layer (gl_InstanceID). Lighting, ground colour, density and the fades are per vertex; the
// fragment only cuts tufts out of two octaves of noise, offset by the gust field higher up.

const LAYERS = 4, SPACING = 2, HALF = 64, RECENTRE = 10;
const BAND = [7, 11, 40, 62];   // fade in from 7 to 11 m, out from 46 to 62 m (distance to camera)

const VERT = /* glsl */`
  ${ATMOSPHERE_GLSL}
  ${GROUND_GLSL}
  ${WIND_GLSL}
  uniform float shellH; uniform float layers; uniform vec4 band; uniform float aglFade;
  attribute float aDens;
  varying vec3 vPosW; varying vec3 vCol; varying vec3 vT; varying vec3 vIn; varying float vLt; varying float vA; varying vec2 vWind; varying vec2 vDir;
  void main() {
    float lt = (float(gl_InstanceID) + 1.0) / layers;
    vec3 p = position;
    float d = distance(cameraPosition, p);
    float el = (cameraPosition.y - p.y) / max(d, 1e-3);   // sine of the view's depression angle
    vec3 gw; vec3 g = groundAlbedo(p, 1.0, gw);
    float grassW = smoothstep(0.05, 0.4, gw.r + 0.5 * gw.g) * aDens;
    vA = grassW * aglFade * smoothstep(band.x, band.y, d) * (1.0 - smoothstep(band.z, band.w, d)) * smoothstep(0.12, 0.3, el);
    p.y += shellH * lt * step(0.01, vA);
    vWind = windDir * windStrength * gust(p.xz) * lt * lt * shellH * 0.8;
    // The sward lies in a direction that wanders over metres around the wind: strokes, not dots.
    vDir = normalize(windDir + 1.2 * (vec2(wNoise(p.xz * 0.09), wNoise(p.xz * 0.09 + 9.0)) - 0.5));
    // Low layers in the shade of the sward, tips in the light: the mean stays near the ground colour.
    float gs = clamp((gust(p.xz) - 0.7) / 0.55, -1.0, 1.0);
    vCol = g * (lt < 0.3 ? 0.9 : mix(1.02, 1.25, (lt - 0.5) * 2.0)) * (1.0 + 0.07 * gs);
    float diff = max(dot(normal, sunDir), 0.0);
    // Sky light under the canopy as the terrain takes it (woodland shade, contact AO at trunks), so the
    // sward under an oak stays as much darker than open grass as the ground there is.
    float occ = groundSkyOcclusion(groundUv(p)) * groundContactAO(p);
    vec3 light = sunLight * diff * cloudShadow(p) * mix(0.92, 1.0, lt) + mix(ambientGround, ambientSky, 0.5 + 0.5 * normal.y) * mix(0.85, 1.0, lt) * occ;
    vCol *= light * 0.3183099;
    vIn = atmosphereApply(vec3(0.0), p, cameraPosition);
    vT = atmosphereApply(vec3(1.0), p, cameraPosition) - vIn;
    vPosW = p; vLt = lt;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */`
  varying vec3 vPosW; varying vec3 vCol; varying vec3 vT; varying vec3 vIn; varying float vLt; varying float vA; varying vec2 vWind; varying vec2 vDir;
  vec3 h32(vec2 p) {
    uvec2 q = uvec2(ivec2(floor(p)) + 32768);
    uint h = q.x * 1597334677u ^ q.y * 3812015801u; h = (h ^ (h >> 15)) * 2246822519u; h ^= h >> 13;
    uint h2 = h * 2654435769u; uint h3 = h2 * 2246822519u;
    return vec3(float(h), float(h2 ^ (h2 >> 16)), float(h3 ^ (h3 >> 16))) * (1.0 / 4294967296.0);
  }
  // One lattice of tufts: each cell holds a tuft (a leaning cone of blades) with its own height,
  // width and brightness. Returns coverage at this layer height, and the tuft's brightness in .y.
  vec2 tufts(vec2 p, float lt, vec2 lean, float aa) {
    vec2 i = floor(p), f = fract(p);
    vec3 h = h32(i);
    float top = 0.55 + 0.5 * h.x;
    if (lt > top) return vec2(0.0);
    vec2 c = 0.5 + (h.yz - 0.5) * 0.36 + lean * lt;   // the tuft's centre at this height
    vec2 v = f - c;
    // a fan of blades, not a pebble: the outline is a ragged star
    float ang = atan(v.y, v.x);
    float r = (0.36 + 0.2 * h.y) * pow(max(1.0 - lt / top, 0.0), 0.4) * (0.65 + 0.45 * abs(sin(ang * 3.5 + h.y * 6.28)));
    float d = length(v);
    return vec2(clamp((r - d) / aa + 0.5, 0.0, 1.0), h.z);
  }
  void main() {
    if (vA < 0.02) discard;
    // The lowest shell is a full floor: the shade down in the sward, which the tufts stand out of.
    if (vLt < 0.3) { gl_FragColor = vec4(vCol * vT + vIn, smoothstep(0.02, 0.25, vA)); 
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return; }
    vec2 p = vPosW.xz - vWind;
    vec2 lean = vDir * 0.35;
    // Two lattices at different scales and angles, so no grid lines show from the air.
    vec2 pa = p / 0.3, pb = mat2(0.866, 0.5, -0.5, 0.866) * p / 0.21 + 17.0;
    float aa = fwidth(pa.x) * 1.2 + 1e-3;
    vec2 ta = tufts(pa, vLt, lean, aa), tb = tufts(pb, vLt * 1.15, lean, aa * 1.43);
    // thin grass keeps fewer tufts at every height
    float keep = smoothstep(0.0, 0.6, vA);
    ta.x *= step(fract(ta.y * 7.3), keep); tb.x *= step(fract(tb.y * 5.1), keep);
    float a = max(ta.x, tb.x) * smoothstep(0.02, 0.3, vA);
    if (a < 0.05) discard;
    float br = ta.x >= tb.x ? ta.y : tb.y;
    vec3 col = vCol * (0.8 + 0.4 * br) * mix(vec3(1.04, 1.0, 0.92), vec3(0.95, 1.01, 1.06), fract(br * 13.7));   // tuft to tuft: a little greener or more cured
    gl_FragColor = vec4(col * vT + vIn, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class GrassShells {
  // ground(x, north): height on the rendered terrain mesh; density(x, north): grass density 0..1.
  constructor(tile, ground, density, uniforms) {
    this.tile = tile; this.ground = ground; this.density = density; this.centre = null;
    const N = (2 * HALF) / SPACING + 1;
    this.N = N;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aDens', new THREE.BufferAttribute(new Float32Array(N * N), 1).setUsage(THREE.DynamicDrawUsage));
    // Split each quad SW-NE, as the terrain's PlaneGeometry and fine mesh do, so the 2 m triangles lie exactly
    // in the terrain's triangles (the grid is aligned to the 10 m lattice, or to the fine mesh's odd metres).
    const idx = [];
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;   // row j is the northern edge
      idx.push(a, c, b, c, d, b);
    }
    geo.setIndex(idx);
    geo.instanceCount = LAYERS;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.uniforms = { ...uniforms, ...groundUniforms, ...windUniforms, ...atmo,
      shellH: { value: 0.32 }, aglFade: { value: 1 }, layers: { value: LAYERS }, band: { value: new THREE.Vector4(...BAND) } };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, alphaToCoverage: true });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.name = 'grassShells';
  }

  // Re-centre the grid on the camera (snapped to the 10 m lattice) and refill it.
  build(cx, cn) {
    const N = this.N, size = this.tile.size, g = this.mesh.geometry;
    const pos = g.attributes.position.array, nrm = g.attributes.normal.array, den = g.attributes.aDens.array;
    // On a tile with the lidar residual the terrain under the shells is the fine mesh (terrain.js FineTerrain): 2 m
    // apart on odd metres, split SW-NE, normals from +-2 m. The grid moves 1 m onto those vertices and takes its
    // normals the same way, so each shell triangle lies in a fine-mesh triangle.
    const odd = this.tile.heights.detail ? 1 : 0, e = odd ? 2 : 1;
    const x0 = Math.round(cx / 10) * 10 - HALF + odd, n0 = Math.round(cn / 10) * 10 + HALF + odd;
    let any = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = Math.min(Math.max(x0 + i * SPACING, 0), size), n = Math.min(Math.max(n0 - j * SPACING, 0), size), k = j * N + i;
      const y = this.ground(x, n);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = -n;
      const gx = this.ground(x + e, n) - this.ground(x - e, n), gn = this.ground(x, n + e) - this.ground(x, n - e);
      const l = Math.hypot(gx, 2 * e, gn); nrm[k * 3] = -gx / l; nrm[k * 3 + 1] = 2 * e / l; nrm[k * 3 + 2] = gn / l;
      den[k] = this.density(x, n); any += den[k];
    }
    for (const a of Object.values(g.attributes)) a.needsUpdate = true;
    this.centre = [cx, cn]; this.any = any > 0;
  }

  update(camera, agl, heightScale) {
    const cp = camera.position, north = -cp.z;
    // From the air only: near eye level the blades carry the sward, and shells would hide them.
    const on = this.enabled !== false && agl > 6 && agl < BAND[3] && heightScale > 0.3;
    this.uniforms.aglFade.value = Math.min(Math.max((agl - 6) / 4, 0), 1);
    if (on && (!this.centre || Math.hypot(cp.x - this.centre[0], north - this.centre[1]) > RECENTRE)) this.build(cp.x, north);
    this.uniforms.shellH.value = 0.34 * heightScale;
    this.mesh.visible = on && this.any;
  }
}
