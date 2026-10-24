import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { SEASON_LOOK } from './season.js';

// Water in the streams and ponds, by season (docs/roadmap.md, browser push item 5).
//
// Every NHD flowline gets a pale sand-and-gravel bed ribbon, drawn in every season: in the dry
// half of the year it is what marks a channel from the air. On top of it a narrower water ribbon
// runs when the reach does: perennial creeks all year, intermittent ones in winter and spring,
// ephemeral ones only in winter. Ponds are flat polygons at their water level. One merged geometry
// per class, so a season change is a few visibility flags.
//
// The terrain is a fixed mesh of 10 m quads (terrain.js) with no banks at the scale of a 2-7 m
// channel, so a surface sunk below it would simply vanish. Instead the ribbons are draped on the
// exact mesh triangles (the same height function grass.js uses for blade roots) and pulled a
// little toward the camera in the vertex shader, along the view ray, so they win the depth test
// over the 10 m triangles they lie on without moving on screen; trees, ridges and the far bank of
// a valley still occlude them normally.

// NHD FCode -> class. 55800 artificial paths run through ponds and wide rivers (perennial);
// 33400 connectors join reaches through culverts and gaps (treated as intermittent); 33600 canals
// and ditches are part of the human footprint the rewilded tile erases, so they get nothing.
const STREAM_CLASS = { 46006: 'perennial', 55800: 'perennial', 46003: 'intermittent', 33400: 'intermittent', 46007: 'ephemeral', 33600: null };
// Lake/pond FCodes whose hydrographic category is intermittent; every other waterbody holds water.
const POND_INTERMITTENT = new Set([39001, 39005, 39006, 43601, 43603, 43604, 43605, 43606, 43607, 43608, 43609, 43610, 43611, 43612]);
const CLASSES = ['ephemeral', 'intermittent', 'perennial'];
// Which classes run in each season. Foothill streams follow the rains: winter storms fill every
// swale, spring keeps the intermittent reaches flowing, by summer only the perennial creeks are left.
export const WATER_SEASONS = {
  winter: { ephemeral: true, intermittent: true, perennial: true, ponds: true },
  spring: { ephemeral: false, intermittent: true, perennial: true, ponds: true },
  summer: { ephemeral: false, intermittent: false, perennial: true, ponds: false },
  fall:   { ephemeral: false, intermittent: false, perennial: true, ponds: false },
};
const WIDTH_BY_ORDER = [0, 1.5, 2.5, 4, 7];                       // water width (m) by Strahler order, 4+ = 7
const WATER_WIDTH_SCALE = { ephemeral: 0.6, intermittent: 0.8, perennial: 1 };   // a runoff trickle is narrower than the creek it becomes
const BED_STRENGTH = { ephemeral: 0.4, intermittent: 0.75, perennial: 0.95 };   // a grassy order-1 swale barely shows a bed
const STEP = 10;                                                  // metres between cross-sections along a path

// Rendered terrain height: Terrain's 10 chunks of ~10 m quads split as PlaneGeometry does
// (same function as grass.js), so draped vertices sit exactly on the visible triangles.
function terrainHeight(tile) {
  const size = tile.size, cs = size / 10, sp = cs / Math.round(cs / 10), H = tile.heights;
  return (x, north) => {
    const u = x / sp, v = (size - north) / sp, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j;
    const x0 = i * sp, x1 = x0 + sp, n0 = size - j * sp, n1 = n0 - sp;
    const b = H.at(x0, n1), d = H.at(x1, n0);
    if (fx + fy <= 1) { const a = H.at(x0, n0); return a + (d - a) * fx + (b - a) * fy; }
    const c = H.at(x1, n1); return c + (b - c) * (1 - fx) + (d - c) * (1 - fy);
  };
}

// Season from a SEASON_LOOK entry: by identity, else the nearest grass tint (as grass.js does).
function seasonOf(look) {
  let best = 'summer', bd = Infinity;
  for (const [k, v] of Object.entries(SEASON_LOOK)) {
    if (v === look) return k;
    const d = v.grass.reduce((s, c, i) => s + (c - look.grass[i]) ** 2, 0);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// True when two non-adjacent edges of the ring cross (earcut would return garbage for them).
function selfIntersects(ring) {
  const n = ring.length, cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;   // shares a vertex with edge 0
      const c = ring[j], d = ring[(j + 1) % n];
      const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 && d2 && d3 && d4) return true;
    }
  }
  return false;
}

// Growable typed buffers for one merged ribbon geometry.
class RibbonBuffers {
  constructor() { this.pos = []; this.nrm = []; this.flow = []; this.dir = []; this.extra = []; this.idx = []; this.n = 0; }
  vertex(x, y, z, nx, ny, nz, s, across, half, speed, dx, dz, strength, cls) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.flow.push(s, across, half, speed);
    this.dir.push(dx, dz); this.extra.push(strength, cls); return this.n++;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(this.flow, 4));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(this.dir, 2));
    g.setAttribute('aExtra', new THREE.Float32BufferAttribute(this.extra, 2));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

const COMMON = /* glsl */`
  varying vec3 vPosW; varying vec3 vNormalW; varying vec4 vFlow; varying vec2 vDir; varying vec2 vExtra;
  uniform float uTime; uniform float depthPull; uniform float depthPullK;
`;
const VERT = /* glsl */`
  ${COMMON}
  attribute vec4 aFlow; attribute vec2 aDir; attribute vec2 aExtra;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz; vNormalW = normal; vFlow = aFlow; vDir = aDir; vExtra = aExtra;
    // Pull toward the camera along the view ray: the screen position is unchanged, but the draped
    // ribbon now beats the 10 m terrain triangles under it in the depth test. Grazing views need
    // more pull, so it grows with distance.
    vec3 toCam = cameraPosition - wp.xyz; float d = length(toCam);
    wp.xyz += toCam * ((depthPull + d * depthPullK) / max(d, 1e-3));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const NOISE = /* glsl */`
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y); }
`;

// Water: dark blue-green body, Fresnel sky reflection from the dome's own colours, a sun glint off
// a rippled normal (two octaves scrolling downstream; ponds use slow wind ripples instead).
const WATER_FRAG = /* glsl */`
  ${COMMON}
  ${ATMOSPHERE_GLSL}
  ${NOISE}
  uniform float rippleAmp; uniform float opacity; uniform float pond;
  // Ripple height in flow coordinates q = (metres downstream, metres across): crests run across
  // the flow (stretched across, short along), the fine octave scrolls faster than the coarse one.
  float ripple(vec2 q, float speed, float fine) {
    vec2 a = q * vec2(1.0 / 0.9, 1.0 / 2.2) - vec2(uTime * speed * 1.1, 0.0);
    vec2 b = mat2(0.8, 0.6, -0.6, 0.8) * (q * vec2(1.0 / 0.33, 1.0 / 0.6)) - vec2(uTime * speed * 2.6, uTime * 0.3);
    return wNoise(a) + 0.45 * fine * wNoise(b);
  }
  void main() {
    float px = length(fwidth(vPosW.xz));   // metres per pixel
    vec2 dir = normalize(vDir), perp = vec2(-dir.y, dir.x);
    // Flow coordinates: ribbons use arc length and offset across; ponds use world xz with a slow drift.
    vec2 q = pond > 0.5 ? vPosW.xz * 0.8 + vec2(uTime * 0.08, uTime * 0.05) : vec2(vFlow.x, vFlow.y);
    float speed = pond > 0.5 ? 0.15 : vFlow.w;
    // Fade each octave before it shrinks below a pixel (it would only shimmer), and widen the glint
    // instead, so a distant reach still glitters as a band rather than aliased sparks.
    float fine = 1.0 - smoothstep(0.04, 0.2, px), coarse = 1.0 - smoothstep(0.15, 0.8, px);
    float e = 0.12, h0 = ripple(q, speed, fine);
    vec2 g = vec2(ripple(q + vec2(e, 0.0), speed, fine) - h0, ripple(q + vec2(0.0, e), speed, fine) - h0) / e;
    g *= rippleAmp * max(coarse, 0.15);
    vec2 gw = pond > 0.5 ? g : g.x * dir + g.y * perp;   // gradient in world xz
    vec3 N = normalize(vec3(-gw.x, 1.0, -gw.y));
    vec3 V = normalize(cameraPosition - vPosW);
    float NdV = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N); R.y = abs(R.y);
    vec3 skyR = mix(atmoInscatter(normalize(vec3(R.x, 1e-3, R.z))), skyZenith, smoothstep(0.0, 0.6, R.y));
    // Shade on the water: cast shadow (riparian trees, banks) and clouds dim the glint and the sky
    // it mirrors a little (a shaded pool reflects the dark bank and canopy, not open sky).
    float sh = cloudOnly(vPosW) * csmShadow(vPosW, vec3(0.0, 1.0, 0.0), 1.0, 1.0, 1.0);
    // In a channel a few metres wide the banks and their grass stand where the low sky would be:
    // a reflection below ~15 degrees sees the far bank, so from a raven's height a creek is a dark
    // ribbon lit by glints, not a strip of horizon. Ponds are wide and see the low sky.
    vec3 bank = vec3(0.07, 0.075, 0.05) * (sunLight * max(sunDir.y, 0.0) * 0.5 + ambientSky) * 0.3183099;
    skyR = mix(bank, skyR, smoothstep(pond > 0.5 ? -0.02 : 0.08, pond > 0.5 ? 0.08 : 0.3, R.y));
    skyR *= mix(0.55, 1.0, sh);
    // Body: light scattered back up out of the water column, dark blue-green.
    vec3 body = vec3(0.020, 0.045, 0.040) * (sunLight * max(sunDir.y, 0.0) * sh + ambientSky * 2.0) * 0.3183099;
    // Sun glint, normalised Blinn-Phong; the lobe widens with distance (see above).
    vec3 H = normalize(V + sunDir);
    float shin = mix(900.0, 90.0, smoothstep(0.03, 1.5, px));
    float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    float glint = Fs * (shin + 8.0) / 25.13 * pow(max(dot(N, H), 0.0), shin) * max(sunDir.y, 0.0);
    vec3 col = body * (1.0 - F) + skyR * F + sunLight * glint * sh;
    // Soft banks: ribbons fade over their outer third onto the bed under them.
    float edge = pond > 0.5 ? 1.0 : 1.0 - smoothstep(0.55, 1.0, abs(vFlow.y) / vFlow.z);
    float a = clamp(edge * mix(opacity, 1.0, F) + glint * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(atmosphereApply(col, vPosW, cameraPosition), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Dry bed: pale sand and gravel with darker cobble patches, lit like the terrain, wet-dark where
// the reach runs, with ragged soft edges so it reads as a channel and not a painted stripe.
const BED_FRAG = /* glsl */`
  ${COMMON}
  ${ATMOSPHERE_GLSL}
  ${NOISE}
  uniform vec3 classWet;   // 1 where the class runs this season (ephemeral, intermittent, perennial)
  uniform float opacity;
  void main() {
    float px = length(fwidth(vPosW.xz));
    vec2 q = vec2(vFlow.x, vFlow.y);
    float n1 = wNoise(q * vec2(0.12, 0.5)), n2 = wNoise(q * vec2(0.6, 1.2) + 7.3), n3 = wNoise(q * vec2(2.0, 2.6) + 3.1);
    float fineK = 1.0 - smoothstep(0.1, 0.5, px);
    vec3 sand = vec3(0.50, 0.45, 0.36), gravel = vec3(0.36, 0.33, 0.28);
    vec3 c = mix(sand, gravel, smoothstep(0.35, 0.75, n1 * 0.6 + n2 * 0.4));
    c *= 0.9 + 0.2 * fineK * (n3 - 0.5);
    int cls = int(vExtra.y + 0.5);
    float wet = cls == 0 ? classWet.x : cls == 1 ? classWet.y : classWet.z;
    c *= mix(1.0, 0.62, wet);   // a running channel's bed is wet and darker
    vec3 n = normalize(vNormalW);
    float diff = max(dot(n, sunDir), 0.0);
    float sunVis = diff > 0.0 ? csmShadow(vPosW, n, 1.0, 1.0, 1.0) : 1.0;
    vec3 light = sunLight * diff * cloudOnly(vPosW) * sunVis + mix(ambientGround, ambientSky, 0.5 + 0.5 * n.y);
    // Ragged edges: the edge distance is jittered by the coarse noise so gravel bars bulge and pinch.
    float t = abs(vFlow.y) / vFlow.z + (n2 - 0.5) * 0.45;
    float a = vExtra.x * opacity * (1.0 - smoothstep(0.45, 1.0, t));
    gl_FragColor = vec4(atmosphereApply(c * light * 0.3183099, vPosW, cameraPosition), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Water {
  constructor(tile, scene) {
    this.tile = tile; this.group = new THREE.Group(); this.group.name = 'water'; this.group.userData.water = this;
    this.season = null; this.look = null; this.stats = { skippedRings: 0, reaches: 0 };
    const time = { value: 0 };
    const base = { uTime: time, depthPull: { value: 0.25 }, depthPullK: { value: 0.003 } };
    this.uniforms = base;
    const mk = (frag, extra) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: frag, uniforms: { ...atmo, ...base, ...extra },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      return m;
    };
    this.bedMaterial = mk(BED_FRAG, { classWet: { value: new THREE.Vector3(1, 1, 1) }, opacity: { value: 1 } });
    this.waterMaterial = mk(WATER_FRAG, { rippleAmp: { value: 0.22 }, opacity: { value: 0.88 }, pond: { value: 0 } });
    this.pondMaterial = mk(WATER_FRAG, { rippleAmp: { value: 0.07 }, opacity: { value: 0.93 }, pond: { value: 1 } });
    this.pondBedMaterial = mk(BED_FRAG, { classWet: { value: new THREE.Vector3(0, 0, 0) }, opacity: { value: 0.8 } });

    const features = tile.features || {};
    const H = terrainHeight(tile);
    const ponds = this.buildPonds(features.waterbodies || [], H);
    this.buildStreams(features.streams || [], H, ponds);

    // Draw order: beds, then streams, then ponds, after the opaque world.
    this.beds.renderOrder = 1; for (const c of CLASSES) this.streams[c].renderOrder = 2;
    this.ponds.renderOrder = 3; this.pondBeds.renderOrder = 1;
    scene.add(this.group);
    this.setSeason('summer');
  }

  // Ponds: flat polygons at the water level. The larger ponds are hydro-flattened in the DEM (the
  // interior median equals its minimum), so the water lies on that flat (5 cm up; the depth pull
  // does the rest; a level below it would be hidden under the mesh). Small stock ponds are 1-4 m
  // bowls in the DEM, where the minimum would leave a puddle: the level rises toward the interior
  // median (at most 1.5 m) and the rendered shore triangles above it cut the shoreline.
  buildPonds(waterbodies, H) {
    const permanent = [], seasonal = [], dry = [], rings = [];
    let skipped = 0;
    for (const w of waterbodies) {
      let ring = w.ring.slice();
      if (ring.length > 3 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
      if (ring.length < 3) continue;
      if (selfIntersects(ring)) { skipped++; continue; }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      // Lowest mesh height: on the ring itself and on a grid inside it (2.5 m, capped at ~4000 samples).
      let lo = Infinity;
      for (const [x, y] of ring) lo = Math.min(lo, H(x, y));
      const step = Math.max(2.5, Math.sqrt((x1 - x0) * (y1 - y0) / 4000));
      const inside = [];
      for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step)
        if (inRing(x, y, ring)) { const h = H(x, y); inside.push(h); lo = Math.min(lo, h); }
      inside.sort((a, b) => a - b);
      const med = inside.length ? inside[inside.length >> 1] : lo;
      const level = lo + Math.min(Math.max(med - lo, 0), 1.5) + 0.05;
      const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ShapeGeometry(shape);
      // ShapeGeometry builds in xy; move to xz at the water level (y = north -> z = -north).
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) { const x = p.getX(k), n = p.getY(k); p.setXYZ(k, x, level, -n); }
      g.deleteAttribute('uv');
      const nv = p.count;
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(nv * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      // Pond shader takes flow from world xz; the bed shader needs a large half-width so it is not faded.
      const flow = new Float32Array(nv * 4), dir = new Float32Array(nv * 2), extra = new Float32Array(nv * 2);
      for (let k = 0; k < nv; k++) { flow[k * 4] = p.getX(k); flow[k * 4 + 1] = -p.getZ(k); flow[k * 4 + 2] = 1e6; dir[k * 2] = 1; extra[k * 2] = 1; extra[k * 2 + 1] = 1; }
      g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 4));
      g.setAttribute('aDir', new THREE.BufferAttribute(dir, 2));
      g.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
      const intermittent = POND_INTERMITTENT.has(w.fcode);
      if (intermittent) { seasonal.push(g); dry.push(g.clone()); } else permanent.push(g);
      rings.push({ ring, bbox: [x0, y0, x1, y1], intermittent, level });
    }
    const merge = list => (list.length ? mergeGeometries(list) : new THREE.BufferGeometry());
    this.stats.skippedRings = skipped; this.stats.ponds = { permanent: permanent.length, seasonal: seasonal.length };
    if (skipped) console.info(`water: skipped ${skipped} self-intersecting waterbody ring(s)`);
    // Perennial ponds always hold water; intermittent ones hold it in the wet season and show
    // their dry pan (the bed shader) the rest of the year.
    this.ponds = new THREE.Mesh(merge(permanent), this.pondMaterial);
    this.pondsSeasonal = new THREE.Mesh(merge(seasonal), this.pondMaterial); this.pondsSeasonal.renderOrder = 3;
    this.pondBeds = new THREE.Mesh(merge(dry), this.pondBedMaterial);
    this.group.add(this.ponds, this.pondsSeasonal, this.pondBeds);
    return rings;
  }

  buildStreams(streams, H, ponds) {
    const bed = new RibbonBuffers(), water = Object.fromEntries(CLASSES.map(c => [c, new RibbonBuffers()]));
    const inPond = (x, y) => ponds.some(p => x >= p.bbox[0] && x <= p.bbox[2] && y >= p.bbox[1] && y <= p.bbox[3] && inRing(x, y, p.ring));
    const nrm = new THREE.Vector3();
    const normalAt = (x, n) => nrm.set(H(x - 2, n) - H(x + 2, n), 4, -(H(x, n - 2) - H(x, n + 2))).normalize();
    let reaches = 0;
    for (const st of streams) {
      const cls = st.fcode in STREAM_CLASS ? STREAM_CLASS[st.fcode] : 'intermittent';
      if (!cls || !st.path || st.path.length < 2) continue;
      const order = Math.max(1, Math.min(4, st.order || 1)), ci = CLASSES.indexOf(cls);
      const ww = WIDTH_BY_ORDER[order] * WATER_WIDTH_SCALE[cls], bw = WIDTH_BY_ORDER[order] * 1.5 + 1.0;
      const speed = 0.35 + 0.15 * order;
      // Resample at <= STEP m, keeping the original vertices.
      const pts = [];
      for (let i = 0; i < st.path.length - 1; i++) {
        const [ax, ay] = st.path[i], [bx, by] = st.path[i + 1], L = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(L / STEP));
        for (let j = 0; j < k; j++) pts.push([ax + (bx - ax) * j / k, ay + (by - ay) * j / k]);
      }
      pts.push(st.path.at(-1));
      // Split into runs outside ponds (the pond surface covers the artificial path through it).
      const runs = []; let run = [];
      for (const p of pts) { if (inPond(p[0], p[1])) { if (run.length > 1) runs.push(run); run = []; } else run.push(p); }
      if (run.length > 1) runs.push(run);
      if (runs.length) reaches++;
      // Width wanders along a reach (pools and riffles, gravel bars): two incommensurate sines with
      // a random phase per reach, so neighbouring reaches never pulse in step.
      const ph = Math.abs(Math.sin(st.path[0][0] * 12.9898 + st.path[0][1] * 78.233) * 43758.5) % 100, ph2 = (ph * 7.31) % 100;
      const wMod = s => Math.max(0.45, 1 + 0.28 * Math.sin(s / 23 + ph) + 0.16 * Math.sin(s / 8.7 + 1.7 * ph));
      const bMod = s => 1 + 0.22 * Math.sin(s / 37 + ph2) + 0.12 * Math.sin(s / 14.3 + 2.3 * ph2);
      for (const r of runs) {
        let s = 0;
        const sections = r.map((p, i) => {
          if (i) s += Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]);
          const a = r[Math.max(0, i - 1)], b = r[Math.min(r.length - 1, i + 1)];
          let tx = b[0] - a[0], tz = -(b[1] - a[1]); const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          return { x: p[0], n: p[1], s, tx, tz };
        });
        // Strip with `cols` cross-section vertices at offsets `offs` (metres, along the perp).
        const strip = (buf, half0, offs, strength, sp, mod) => {
          const cols = offs.length; let first = -1;
          for (const c of sections) {
            const px = -c.tz, pz = c.tx;   // perp in world xz
            const m = mod(c.s), half = half0 * m;
            for (const o0 of offs) {
              const o = o0 * m, x = c.x + px * o, z = -c.n + pz * o, n = -z;
              const nn = normalAt(x, n);
              const k = buf.vertex(x, H(x, n), z, nn.x, nn.y, nn.z, c.s, o, half, sp, c.tx, c.tz, strength, ci);
              if (first < 0) first = k;
            }
          }
          for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < cols - 1; j++) {
            const a = first + i * cols + j, b = a + 1, c = a + cols, d = c + 1;
            buf.idx.push(a, c, b, b, c, d);
          }
        };
        // A centre vertex lets a wide bed fold into a V-valley; a bed under ~6 m fits inside one 10 m
        // terrain quad and needs only its two edges (half the triangles, most of the network).
        strip(bed, bw / 2, bw > 6 ? [-bw / 2, 0, bw / 2] : [-bw / 2, bw / 2], BED_STRENGTH[cls] * (order === 1 ? 0.8 : 1), 0, bMod);
        strip(water[cls], ww / 2, [-ww / 2, ww / 2], 1, speed, wMod);
      }
    }
    this.stats.reaches = reaches;
    this.beds = new THREE.Mesh(bed.geometry(), this.bedMaterial);
    this.streams = {};
    for (const c of CLASSES) { this.streams[c] = new THREE.Mesh(water[c].geometry(), this.waterMaterial); this.group.add(this.streams[c]); }
    this.group.add(this.beds);
    const tri = m => (m.geometry.index ? m.geometry.index.count / 3 : 0);
    this.stats.triangles = {
      beds: tri(this.beds), ...Object.fromEntries(CLASSES.map(c => [c, tri(this.streams[c])])),
      ponds: tri(this.ponds) + tri(this.pondsSeasonal), pondBeds: tri(this.pondBeds),
    };
    this.stats.triangles.total = Object.values(this.stats.triangles).reduce((a, b) => a + b, 0);
  }

  // Season name ('winter' | 'spring' | 'summer' | 'fall'): which classes carry water.
  setSeason(s) {
    const w = WATER_SEASONS[s] || WATER_SEASONS.summer;
    this.season = s;
    for (const c of CLASSES) this.streams[c].visible = w[c];
    this.pondsSeasonal.visible = w.ponds; this.pondBeds.visible = !w.ponds;
    this.bedMaterial.uniforms.classWet.value.set(+w.ephemeral, +w.intermittent, +w.perennial);
  }

  // Per frame: animate the ripples and follow the season of the look (a SEASON_LOOK entry).
  update(dt, look) {
    this.uniforms.uTime.value = (this.uniforms.uTime.value + dt) % 3600;
    if (look && look !== this.look) { this.look = look; const s = seasonOf(look); if (s !== this.season) this.setSeason(s); }
  }
}

// Minimal merge for geometries with identical attribute layouts (avoids pulling in the addons path).
function mergeGeometries(list) {
  const out = new THREE.BufferGeometry(), names = Object.keys(list[0].attributes);
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  for (const name of names) {
    const size = list[0].attributes[name].itemSize, arr = new Float32Array(nv * size);
    let o = 0; for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let o = 0, base = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[o++] = g.index.getX(i) + base;
    else for (let i = 0; i < n; i++) idx[o++] = i + base;
    base += n;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
