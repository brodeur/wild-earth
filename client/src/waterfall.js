import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { releaseGeometry } from './gpuRelease.js';

// Waterfalls: wherever a drawn channel drops steeply, a fall (docs/decisions.md, "Waterfalls"; the white water of
// 2026-11-01, "White water").
//
// water.js hands over the reaches it draws (perennial and intermittent; ephemeral swales never make a fall), as the
// same runs it lays its ribbons on: outside ponds, without the NHD duplicates of a DEM channel. Each run is walked
// every 2.5 m on the ground the footing reads (Heightfield.at: the 1 m lidar ground where the tile has it, else
// heights.png), its long profile made non-increasing downstream (the smoothed centreline wanders a little up the
// walls of a gully; water does not), and its slope taken over +-5 m. A leap is a stretch steeper than 35 degrees
// (0.7) with the gentler gaps inside it under 10 m bridged, kept when it drops at least MIN_DROP m: shorter steps
// are riffles and cascades, drawn by the water's own foam. A run is extended into the run that starts where it
// ends, so a leap that crosses a junction is one fall and has its run-out; a leap whose lip lies in that extension
// belongs to the next run.
//
// Each leap is four things in one merged geometry, one draw call for all the falls of the tile:
//   - the curtain (kind 0), a strip from the lip to the plunge standing off the face along its normal (1 m at the
//     lip, arcing out to 6 m), two vertices across per 2.5 m sample, widening as it falls (spray);
//   - the boil (kind 3), a disc of opaque white water on the stream at the plunge, churning, never clear at its
//     centre, ragged at its rim: the pool where the fall lands (the reading: Malan's waterfall impacts are a broad
//     opaque foam region, not a cloud);
//   - the run-out (kind 1), foam rafts and streaks on the stream below the boil, riding the current and thinning
//     downstream over RUNOUT m (longer for a bigger drop and a wider creek), cut from the same lace as the creeks'
//     foam (FOAM_GLSL);
//   - the mist (kind 2), a few small ragged sprites about the plunge, thin and local, drifting up; one wide faint
//     one behind them on a big fall, where the spray cloud of May really is tens of metres across.
// The curtain's fragment shader scrolls the streaks in time of flight, sqrt(2 dv / g), so they accelerate and
// stretch as they fall: dense and bright at the lip, breaking into strands and clumps toward the base (the strands
// are kept to the plunge; the mist is the sprites' job). Lit like the water (atmosphere.js uniforms: sun, sky ambient,
// cloud and cascaded shadows, aerial perspective). The class of each leap follows the water's season (classWet): a
// fall on an intermittent creek is dry in summer and fall, as the creek's ribbon is. Static per world; the only
// per-frame input is the water's own time uniform.

const STEP = 2.5;                                 // m along a run between profile samples
const STEEP = Math.tan(35 * Math.PI / 180);       // slope that makes a fall
const WINDOW = 5;                                 // m each side for the local slope
const GAP = 10;                                   // m of gentler channel bridged inside a leap
const MIN_DROP = 8;                               // m: shorter steps are not falls
const MIN_MEAN = 0.6;                             // mean slope lip to plunge (after bridging)
const EXTEND = 80;                                // m of the downstream run appended to a run
const RUNOUT = (drop, w0) => Math.min(50, 12 + drop * 0.25 + w0 * 2);   // m of foam below the boil
// The plume's width by season over the channel's width (a Sierra fall is a broad sheet in May's melt, a thread by
// October): the curtain and the run-out this many times wider, the mist by its square root.
const FLOW = { winter: 1.5, spring: 2.2, summer: 0.6, fall: 0.45 };
// The foam's tuning (FOAM_GLSL foamTune): coverage scale, the lace threshold at no coverage, its fall per unit of
// coverage (full coverage still leaves gaps: a cascade is streaks and rafts over dark water), the foam's brightness.
export const FOAM_TUNE = [0.55, 0.8, 0.36, 1.0];

// Value noise shared by the water shaders (water.js imports it: this module evaluates first).
export const NOISE_GLSL = /* glsl */`
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y); }
`;
// White water (docs/decisions.md "White water"). Foam is opaque, bright and structured: a lace of value noise
// stretched along the flow and cut by a sharp threshold, its coverage set by whoever calls (the creeks' walk, the
// riffles, the rocks' wakes, a fall's boil and run-out). It moves with the water: the flow coordinates scroll, in two
// phases half a cycle apart blended by a triangle wave (Vlachos, "Water Flow in Portal 2", SIGGRAPH 2010), so where
// the speed varies the pattern never shears or snaps; the blend is renormalised so the coverage does not pulse with
// the phase. Needs NOISE_GLSL and a `uTime` uniform.
export const FOAM_GLSL = /* glsl */`
  // foamTune: coverage scale, the lace threshold at no coverage, its fall per unit coverage, the foam's brightness
  // (FOAM_TUNE; a uniform so the look can be dialled in live from the console)
  uniform vec4 foamTune;
  // an integer hash shared with JS (water.js rockHash): the same rock at the same place on both sides
  float rHash(float k, float seed) {
    uint x = uint(k + 0.5) * 2654435761u + uint(seed + 0.5) * 2246822519u;
    x ^= x >> 15u; x *= 2246822507u; x ^= x >> 13u; x *= 3266489909u; x ^= x >> 16u;
    return float(x & 0xFFFFFFu) / 16777216.0;
  }
  // the lace: a streaky octave along the flow and a ridged finer one (bubble lines)
  float foamN(vec2 q) {
    float a = wNoise(q * vec2(1.0 / 1.5, 1.0 / 0.38));
    float b = wNoise(q * vec2(1.0 / 0.55, 1.0 / 0.17) + 3.3);
    return a * 0.6 + (1.0 - abs(2.0 * b - 1.0)) * 0.4;
  }
  // two-phase advection of the flow coordinates at speed sp (m/s): the blended noise, variance kept
  float foamField(vec2 q, float sp) {
    float T = 3.0, p1 = fract(uTime / T), p2 = fract(p1 + 0.5), wA = 1.0 - abs(2.0 * p1 - 1.0);
    float n1 = foamN(q - vec2(sp * T * p1, 0.0)), n2 = foamN(q - vec2(sp * T * p2, 0.0) + vec2(13.7, 4.1));
    float n = wA * (n1 - 0.5) + (1.0 - wA) * (n2 - 0.5);
    return 0.5 + n / sqrt(wA * wA + (1.0 - wA) * (1.0 - wA));
  }
  // foam coverage cov (0..1) -> the lace cut from the field (sharp-edged, opaque where it is). Full coverage still
  // leaves gaps in the lace (a cascade is streaks and rafts over dark water, never a flat white sheet).
  float foamCut(float n, float cov) {
    cov = clamp(cov * foamTune.x, 0.0, 1.0);
    float th = foamTune.y - foamTune.z * cov;
    return smoothstep(th - 0.06, th + 0.04, n) * smoothstep(0.0, 0.05, cov);
  }
`;

const VERT = /* glsl */`
  attribute vec3 aSide; attribute vec4 aFall; attribute vec4 aInfo;
  uniform vec3 classWet; uniform float pull0; uniform float pullK; uniform float flow; uniform float uTime;   // flow: the season's plume width (FLOW)
  varying vec3 vPosW; varying vec3 vN; varying vec4 vFall; varying vec4 vInfo; varying float vThin;
  void main() {
    int cls = int(aInfo.y + 0.5);
    float wet = cls == 0 ? classWet.x : cls == 1 ? classWet.y : classWet.z;
    if (wet < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // dry this season: clipped
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    float d0 = length(cameraPosition - p);
    float pxm = 2.0 * d0 / (projectionMatrix[1][1] * 900.0);   // metres per pixel at this distance (about)
    vThin = 1.0;
    if (aFall.w > 2.5) {
      // the boil: a disc on the water, its rim pushed out by the season's flow
      p += aSide * (0.6 + 0.4 * flow);
    } else if (aFall.w > 1.5) {
      // mist: a billboard about its centre, corners in aFall.xy, radius aFall.z; the small sprites drift up and sway
      vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      float small = aSide.y, ph = uTime * 0.5 + aInfo.z;
      p += (r * (aFall.x + small * 0.25 * sin(ph)) + u * (aFall.y + small * (0.5 + 0.5 * sin(ph * 0.7 + 1.0)))) * aFall.z * sqrt(flow);
    } else {
      // curtain and run-out: at least ~1.3 px wide, thinner in alpha instead, so a far fall still reads as a line
      float hw = length(aSide), k = hw > 0.0 ? max(1.0, 1.3 * pxm / hw) : 1.0;
      p += aSide * aFall.x * k * flow; vThin = 1.0 / k;
    }
    vPosW = p; vN = normal; vFall = aFall; vInfo = aInfo;
    vec3 toCam = cameraPosition - p; float d = length(toCam);
    p += toCam * ((pull0 + d * pullK) / max(d, 1e-3));   // win the depth test over the face it stands off
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */`
  ${ATMOSPHERE_GLSL}
  ${NOISE_GLSL}
  uniform float uTime; uniform float flow;
  ${FOAM_GLSL}
  varying vec3 vPosW; varying vec3 vN; varying vec4 vFall; varying vec4 vInfo; varying float vThin;
  float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(fHash(i), fHash(i + vec2(1, 0)), u.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), u.x), u.y); }
  void main() {
    float kind = vFall.w, seed = vInfo.z, strength = vInfo.w;
    float px = length(fwidth(vPosW));   // metres per pixel
    float fine = 1.0 - smoothstep(0.15, 1.2, px);
    float sh = cloudOnly(vPosW) * csmShadow(vPosW, normalize(vN), 1.0, 1.0, 1.0);
    // White water scatters: a little of the sun reaches the side turned away, the sky lights it all round.
    float sunK = kind > 1.5 ? 0.55 : 0.35 + 0.65 * max(dot(normalize(vN), sunDir), 0.0);
    vec3 lit = (sunLight * sunK * sh * smoothstep(-0.05, 0.1, sunDir.y) + ambientSky * 1.3) * 0.3183099;
    float a; vec3 col;
    if (kind < 0.5) {
      // curtain: u across (-1..1), dv metres below the lip, D the leap's drop
      float u = vFall.x, dv = vFall.y, D = max(vFall.z, 1.0), w = vInfo.x;
      float t = clamp(dv / D, 0.0, 1.0);
      float tof = sqrt(2.0 * max(dv, 0.0) / 9.8);
      float ax = u * w * 0.5;
      float n1 = fNoise(vec2(ax / 0.9 + seed, (tof - uTime) * 2.2));
      float n2 = fNoise(vec2(ax / 0.3 + seed * 3.1, (tof - uTime) * 6.0 + 17.0));
      float streak = mix(0.5, n1 * 0.6 + n2 * 0.4, max(fine, 0.25));
      float brk = smoothstep(0.0, 0.85, t);   // 0 a glassy-white tongue at the lip, 1 strands and spray
      float edge = 1.0 - smoothstep(mix(0.75, 0.25, brk), 1.0, abs(u) + (n1 - 0.5) * 0.5 * brk);
      float body = mix(0.95, 0.75, brk) * smoothstep(mix(-0.2, 0.25, brk), mix(0.3, 0.62, brk), streak);
      // toward the plunge the strands break into clumps of spray, still strands, not a haze (the mist is the sprites')
      float clump = smoothstep(0.7, 1.0, t) * (1.0 - smoothstep(0.0, 1.0, abs(u)));
      float m2 = fNoise(vec2(ax / 1.6 + seed, (tof - uTime) * 3.0));
      a = edge * body;
      a = mix(a, 0.8 * edge * smoothstep(0.3, 0.7, n1 * 0.5 + m2 * 0.5), clump * 0.7);
      a *= smoothstep(-2.0, 1.0, dv) * mix(0.55, 1.0, strength);
      col = vec3(0.9, 0.92, 0.93) * lit * mix(1.0, 0.85, brk * (1.0 - n2));
    } else if (kind < 1.5) {
      // run-out: foam rafts and streaks on the stream below the boil, u across, dv metres downstream, D its length
      float u = vFall.x, dv = vFall.y, D = max(vFall.z, 1.0), w = vInfo.x;
      float t = clamp(dv / D, 0.0, 1.0);
      float cov = pow(1.0 - t, 1.4) * (1.0 - 0.3 * abs(u)) * mix(0.6, 1.0, strength);
      float n = foamField(vec2(dv, u * w * 0.5) + seed, 1.5 + 0.02 * D);
      float f = mix(cov * 0.7, foamCut(n, cov), fine);
      float edge = 1.0 - smoothstep(0.6, 1.0, abs(u) + (n - 0.5) * 0.3);
      a = f * edge * 0.97;
      col = vec3(0.93, 0.95, 0.96) * lit * (0.86 + 0.14 * n) * foamTune.w;
    } else if (kind < 2.5) {
      // mist sprite: a ragged cloud, thin, breaking up at its edge; the wide one (aSide.y = 0) fainter still
      vec2 c = vFall.xy; float r = length(c), small = vInfo.x;
      float b = fNoise(c * 2.5 + vec2(seed, -uTime * 0.35)) * 0.6 + fNoise(c * 5.0 + vec2(uTime * 0.2, seed * 2.0)) * 0.4;
      float rag = smoothstep(0.3, 0.75, b);
      a = (1.0 - smoothstep(0.1, 0.95, r)) * rag * mix(0.14, 0.32, small) * mix(0.5, 1.0, strength) * min(1.0, 0.45 + 0.4 * flow);
      col = vec3(0.88, 0.9, 0.92) * lit;
    } else {
      // the boil: a churning disc, opaque white at its centre, lace toward a ragged rim; u downstream, v across
      vec2 c = vFall.xy; float rr = length(c), R = vFall.z;
      vec2 q = c * R;
      float n = foamField(q + seed, 0.9);
      float churn = fNoise(q * 0.7 + vec2(seed, uTime * 0.6)) * 0.5 + fNoise(q * 1.8 - vec2(uTime * 0.9, seed)) * 0.5;
      float cov = (1.0 - 0.55 * smoothstep(0.25, 1.0, rr)) * mix(0.6, 1.0, strength);
      float f = mix(cov * 0.8, foamCut(n, cov), fine);
      float disc = 1.0 - smoothstep(0.75, 1.0, rr + (n - 0.5) * 0.35);
      a = max(f, (0.6 + 0.3 * churn) * (1.0 - smoothstep(0.0, 0.7, rr))) * disc * 0.97;
      col = vec3(0.94, 0.96, 0.97) * lit * (0.82 + 0.18 * (n * 0.5 + churn * 0.5)) * foamTune.w;
    }
    a = clamp(a * vThin, 0.0, 1.0);
    if (a < 0.004) discard;
    gl_FragColor = vec4(atmosphereApply(col, vPosW, cameraPosition), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The leaps along one run. pts: [[x, north], ...] (the run, then its downstream extension from index `own` on);
// at(x, north): ground height. Returns { xs, ns, s, z, g, leaps: [{ a, b, drop, run }] } in sample indices.
export function findLeaps(pts, own, at) {
  const xs = [], ns = [], s = [], isOwn = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(L / STEP));
    for (let j = 0; j < k; j++) { xs.push(ax + (bx - ax) * j / k); ns.push(ay + (by - ay) * j / k); s.push(acc + L * j / k); isOwn.push(i < own); }
    acc += L;
  }
  xs.push(pts.at(-1)[0]); ns.push(pts.at(-1)[1]); s.push(acc); isOwn.push(false);
  const n = xs.length, z = new Float64Array(n), g = new Float64Array(n);
  for (let k = 0, m = Infinity; k < n; k++) { m = Math.min(m, at(xs[k], ns[k])); z[k] = m; }
  for (let k = 0, a = 0, b = 0; k < n; k++) {
    while (s[a] < s[k] - WINDOW) a++;
    if (b < k) b = k;
    while (b + 1 < n && s[b + 1] <= s[k] + WINDOW) b++;
    g[k] = s[b] > s[a] ? (z[a] - z[b]) / (s[b] - s[a]) : 0;
  }
  const leaps = [];
  for (let k = 0; k < n;) {
    if (g[k] <= STEEP) { k++; continue; }
    const a = k; let b = k;
    for (k++; k < n; k++) {
      if (g[k] > STEEP) { b = k; continue; }
      if (s[k] - s[b] > GAP) break;
    }
    const drop = z[a] - z[b], run = s[b] - s[a];
    if (isOwn[a] && drop >= MIN_DROP && drop >= MIN_MEAN * run) leaps.push({ a, b, drop, run });
  }
  return { xs, ns, s, z, g, leaps };
}

export class Waterfalls {
  // shared: the water's uniforms ({ uTime }), so its update drives these too
  constructor(tile, shared) { this.tile = tile; this.shared = shared; this.count = 0; this.falls = []; }

  // runs: [{ pts: [[x, north], ...], ci (class index), width (water m), order, name }] as water.js draws them
  *build(runs) {
    const at = (x, n) => this.tile.heights.at(x, n);
    const key = p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const starts = new Map();
    for (const r of runs) { const k = key(r.pts[0]), o = starts.get(k); if (!o || o.width < r.width) starts.set(k, r); }
    const pos = [], nrm = [], side = [], fall = [], info = [], idx = [];
    let nv = 0;
    const vert = (p, nn, sd, f, inf) => { pos.push(...p); nrm.push(...nn); side.push(...sd); fall.push(...f); info.push(...inf); return nv++; };
    let k = 0;
    for (const r of runs) {
      if ((k++ & 15) === 0) yield;
      // the run plus up to EXTEND m of the one that continues it
      const pts = r.pts.slice(), own = pts.length - 1, next = starts.get(key(pts.at(-1)));
      if (next && next !== r) {
        let L = 0;
        for (let i = 1; i < next.pts.length && L < EXTEND; i++) { L += Math.hypot(next.pts[i][0] - next.pts[i - 1][0], next.pts[i][1] - next.pts[i - 1][1]); pts.push(next.pts[i]); }
      }
      if (pts.length < 2) continue;
      const P = findLeaps(pts, own, at);
      if (!P.leaps.length) continue;
      const { xs, ns, s, z, g } = P, n = xs.length;
      const strength = Math.min(1, Math.max(0, (r.width - 1) / 5));
      const w0 = Math.min(10, Math.max(2, r.width * 0.9));
      const tan = i => {   // downstream horizontal unit, scene xz (z = -north)
        const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
        const tx = xs[b] - xs[a], tz = -(ns[b] - ns[a]), l = Math.hypot(tx, tz) || 1;
        return [tx / l, tz / l];
      };
      for (let li = 0; li < P.leaps.length; li++) {
        const { a, b, drop, run } = P.leaps[li];
        const seed = Math.abs(Math.sin(xs[a] * 12.9898 + ns[a] * 78.233) * 43758.5) % 37;
        const inf = [0, r.ci, seed, strength];
        // the curtain, one sample above the lip to the plunge
        const a0 = Math.max(0, a - 1);
        let first = -1, last = null;
        for (let i = a0; i <= b; i++) {
          const [tx, tz] = tan(i), gi = Math.max(g[i], 0), cs = 1 / Math.hypot(1, gi), sn = gi * cs;
          const N = [tx * sn, cs, tz * sn];                  // the face's normal in the profile plane
          const dv = z[a] - z[i] + (i < a ? -(s[a] - s[i]) * 0.3 : 0);
          const off = 1 + Math.min(5, 0.035 * Math.max(dv, 0));
          const half = (w0 + Math.min(1.2 * w0, 0.05 * Math.max(dv, 0))) / 2;
          const c = [xs[i] + N[0] * off, z[i] + N[1] * off, -ns[i] + N[2] * off];
          const sd = [-tz * half, 0, tx * half];
          inf[0] = half * 2;
          const v = vert(c, N, sd, [-1, dv, drop, 0], inf);
          vert(c, N, sd, [1, dv, drop, 0], inf);
          if (first < 0) first = v; else idx.push(v - 2, v, v - 1, v - 1, v, v + 1);
          last = { c, N, i };
        }
        // the boil: a disc on the stream at the plunge, moved downstream by half its radius (the pool is below the foot)
        const Rb = Math.min(14, Math.max(2, w0 * 0.9 + 0.03 * drop)), [bx, bz] = tan(b);
        const bc = [xs[b] + bx * Rb * 0.5, at(xs[b] + bx * Rb * 0.5, ns[b] - bz * Rb * 0.5) + 0.25, -ns[b] + bz * Rb * 0.5];
        {
          inf[0] = Rb;
          const c0 = vert(bc, [0, 1, 0], [0, 0, 0], [0, 0, Rb, 3], inf), NR = 16, rim = [];
          for (let q = 0; q < NR; q++) {
            const ang = q / NR * Math.PI * 2, u = Math.cos(ang), v = Math.sin(ang);
            const sd = [(bx * u - bz * v) * Rb, 0, (bz * u + bx * v) * Rb];   // u downstream, v across, in scene xz
            rim.push(vert(bc, [0, 1, 0], sd, [u, v, Rb, 3], inf));
          }
          for (let q = 0; q < NR; q++) idx.push(c0, rim[q], rim[(q + 1) % NR]);
        }
        // run-out: foam on the stream below the boil, to the next lip or the end of the run
        const stop = li + 1 < P.leaps.length ? P.leaps[li + 1].a : n - 1;
        const L = RUNOUT(drop, w0), half = Math.max(1, r.width * 0.65);
        let prev = -1;
        for (let i = b; i <= stop && s[i] - s[b] <= L; i++) {
          const [tx, tz] = tan(i), y = at(xs[i], ns[i]) + 0.2;
          const c = [xs[i], y, -ns[i]], sd = [-tz * half, 0, tx * half];
          inf[0] = half * 2;
          const v = vert(c, [0, 1, 0], sd, [-1, s[i] - s[b], L, 1], inf);
          vert(c, [0, 1, 0], sd, [1, s[i] - s[b], L, 1], inf);
          if (prev >= 0) idx.push(prev, v, prev + 1, prev + 1, v, v + 1);
          prev = v;
        }
        // mist at the plunge: three small ragged sprites about the foot (aSide.y = 1: they drift and sway in the
        // vertex shader) and, on a big fall, one wide faint cloud behind them
        // (out from the face by half the radius along the stream, or the cliff behind would cut the billboard in half)
        const R = Math.min(45, 5 + drop * 0.12), [ox, oz] = tan(b), m = last.c;
        const sprite = (cx, cy, cz, rad, small, sd) => {
          inf[0] = small;
          const q = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([u, v]) => vert([cx, cy, cz], [0, 1, 0], [0, small, 0], [u, v, rad, 2], [inf[0], inf[1], sd, inf[3]]));
          idx.push(q[0], q[1], q[2], q[2], q[1], q[3]);
        };
        const rs = Math.max(1.5, R * 0.4), px = -oz, pz = ox;
        sprite(m[0] + ox * rs * 0.6, z[b] + rs * 0.5, m[2] + oz * rs * 0.6, rs, 1, seed);
        sprite(m[0] + ox * rs * 0.9 + px * rs * 0.7, z[b] + rs * 0.35, m[2] + oz * rs * 0.9 + pz * rs * 0.7, rs * 0.8, 1, seed + 11);
        sprite(m[0] + ox * rs * 0.9 - px * rs * 0.7, z[b] + rs * 0.35, m[2] + oz * rs * 0.9 - pz * rs * 0.7, rs * 0.8, 1, seed + 23);
        if (drop > 40) sprite(m[0] + ox * R * 0.5, z[b] + R * 0.3, m[2] + oz * R * 0.5, R, 0, seed + 5);
        this.falls.push({ x: +xs[a].toFixed(1), north: +ns[a].toFixed(1), plunge: [+xs[b].toFixed(1), +ns[b].toFixed(1)],
          top: +z[a].toFixed(1), base: +z[b].toFixed(1), drop: +drop.toFixed(1), run: +run.toFixed(1),
          cls: ['ephemeral', 'intermittent', 'perennial'][r.ci], width: +w0.toFixed(1), boil: +Rb.toFixed(1), order: r.order, name: r.name || null });
      }
    }
    this.count = this.falls.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 3));
    geo.setAttribute('aFall', new THREE.Float32BufferAttribute(fall, 4));
    geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
    geo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...atmo, uTime: this.shared.uTime, foamTune: this.shared.foamTune, classWet: { value: new THREE.Vector3(0, 1, 1) }, flow: { value: 1 }, pull0: { value: 0.5 }, pullK: { value: 0.004 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'waterfalls'; this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;   // the billboards grow in the shader; one draw call across the tile anyway
    this.mesh.visible = this.count > 0;
    this.stats = { falls: this.count, vertices: nv, triangles: idx.length / 3 };
    if (nv) releaseGeometry(geo);
  }

  // w: a WATER_SEASONS entry (which classes run)
  setSeason(w, s = null) {
    if (!this.material) return;
    this.material.uniforms.classWet.value.set(+w.ephemeral, +w.intermittent, +w.perennial);
    this.material.uniforms.flow.value = FLOW[s] ?? 1;
  }

  // falls within r metres of (x, north), nearest first
  near(x, north, r = 500) {
    return this.falls.map(f => ({ ...f, d: Math.hypot(f.x - x, f.north - north) })).filter(f => f.d <= r).sort((p, q) => p.d - q.d);
  }
}
