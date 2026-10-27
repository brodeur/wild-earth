import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { SEASON_LOOK } from './season.js';
import { loadImageData } from './tilepackage.js';

// Water in the streams and ponds, by season (docs/roadmap.md, browser push item 5).
//
// Streams are the gravity-routed channels from the pipeline (pipeline/channels.py: D8 on the lidar
// DEM, named and classed by NHD), each carrying its water and bed width from drainage area; tiles
// built before that step carry raw NHD flowlines and fall back to widths by Strahler order.
// Every reach gets a pale sand-and-gravel bed ribbon, drawn in every season: in the dry
// half of the year it is what marks a channel from the air. On top of it a narrower water ribbon
// runs when the reach does: perennial creeks all year, intermittent ones in winter and spring,
// ephemeral ones only in winter. Ponds are flat polygons at their water level. One merged geometry
// per class, so a season change is a few visibility flags.
//
// The terrain is a fixed mesh of 10 m quads (terrain.js) with no banks at the scale of a 2-30 m
// channel, so a surface sunk below it would simply vanish. Instead the ribbons are draped on the
// exact mesh triangles (the same height function grass.js uses for blade roots) and pulled a
// little toward the camera in the vertex shader, along the view ray, so they win the depth test
// over the 10 m triangles they lie on without moving on screen; trees, ridges and the far bank of
// a valley still occlude them normally.
//
// Hydrology rewilding (pipeline/rewild_hydro.py, docs/tile-spec.md "Hydrology rewilding"): the
// reservoirs and stock ponds people made are listed in the manifest layer `hydro.human_water`; they
// are not drawn, and the restored channel the pipeline routed through each old bed is drawn as an
// ordinary reach. client/channel_profile.png carries each channel's thalweg depth (R, 2 cm) and
// riffle-pool index (G) from the DEM's long profile, and the rewilded beds (B). It loads after the
// tile; until it arrives the water keeps its plain colour and depthAt() uses a notional depth.
// Depth darkens the water (pools dark and glassy, riffles pale, rough and quick) and is exposed
// as depthAt(x, north) in metres.

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
// Fallback water width (m) by Strahler order, 7+ = 30, for streams without a `width` (NHD-only
// tiles). Orders 5-6 are rivers: the North Fork Cosumnes
// (order 6) runs about 20 m wide at spring flow.
const WIDTH_BY_ORDER = [0, 1.5, 2.5, 4, 7, 12, 20, 30];
const MAX_ORDER = WIDTH_BY_ORDER.length - 1;
const POND_BIG = 10000;     // m2: above ~1 ha a pond's level comes from its shoreline, below it the stock-pond rule
const POND_FADE = 1.5;      // m: alpha fade inside a pond's shoreline
const WATER_WIDTH_SCALE = { ephemeral: 0.6, intermittent: 0.8, perennial: 1 };   // a runoff trickle is narrower than the creek it becomes
const BED_STRENGTH = { ephemeral: 0.4, intermittent: 0.75, perennial: 0.95 };   // a grassy order-1 swale barely shows a bed
const STEP = 10;                                                  // metres between cross-sections along a path
const DEM_PREFERRED_M = 15;   // an NHD-sourced stretch within this of a DEM channel is a duplicate of it

// Rendered terrain height: Terrain's 10 chunks of ~10 m quads split as PlaneGeometry does
// (same function as grass.js), so draped vertices sit exactly on the visible triangles.
// On a tile with the lidar residual the ribbons carry two heights: the 1 m ground (Heightfield.at) in
// position.y and the 10 m mesh (Heightfield.coarse) in aCoarseY, and the vertex shader (DRAPE) takes the
// one the terrain draws there, easing across the fine mesh's band as terrain.js does (Heightfield.fine,
// mirrored each frame into the fineRect uniform). One height for both would vanish under the 10 m mesh
// where the lidar finds the channel deeper, or float over the fine one.
function terrainHeight(tile) {
  const size = tile.size, cs = size / 10, sp = cs / Math.round(cs / 10), H = tile.heights;
  if (H.detail) return (x, north) => H.at(x, north);
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
  constructor() { this.pos = []; this.nrm = []; this.flow = []; this.dir = []; this.extra = []; this.idx = []; this.n = 0; this.cy = null; }
  vertex(x, y, z, nx, ny, nz, s, across, half, speed, dx, dz, strength, cls, coarseY) {
    if (coarseY !== undefined) (this.cy ??= []).push(coarseY);
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
    if (this.cy) g.setAttribute('aCoarseY', new THREE.Float32BufferAttribute(this.cy, 1));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

const COMMON = /* glsl */`
  varying vec3 vPosW; varying vec3 vNormalW; varying vec4 vFlow; varying vec2 vDir; varying vec2 vExtra;
  uniform float uTime; uniform float depthPull; uniform float depthPullK;
  uniform vec4 fineRect; uniform float fineBand;   // terrain.js fine mesh: x0, x1, n0, n1 (x1 < x0: none) and its blend band
`;
const VERT = /* glsl */`
  ${COMMON}
  attribute vec4 aFlow; attribute vec2 aDir; attribute vec2 aExtra;
  #ifdef DRAPE
  attribute float aCoarseY;
  #endif
  void main() {
    vec3 p = position;
    #ifdef DRAPE
    float e = min(min(p.x - fineRect.x, fineRect.y - p.x), min(-p.z - fineRect.z, fineRect.w + p.z));
    p.y = mix(aCoarseY, p.y, smoothstep(0.0, fineBand, e));   // smoothstep is 0 for e <= 0: outside, the 10 m mesh
    #endif
    vec4 wp = modelMatrix * vec4(p, 1.0);
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
  uniform sampler2D profileTex; uniform float hasProfile; uniform float tileSize;
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
    // Creek depth (channel_profile.png): thalweg depth R (2 cm units) across a parabolic section, and
    // the riffle-pool index G (-1 pool .. +1 riffle). Riffles run faster and rougher, pools slower.
    float dep = 0.4, rif = 0.0;   // without a profile: a mid-depth creek, the look before profiles
    if (pond < 0.5 && hasProfile > 0.5) {
      vec4 pr = texture2D(profileTex, vec2(vPosW.x, -vPosW.z) / tileSize);
      float r = clamp(abs(vFlow.y) / max(vFlow.z, 1e-3), 0.0, 1.0);
      dep = pr.r * 255.0 * 0.02 * (1.0 - r * r);
      rif = pr.g > 0.0 ? pr.g * 2.0 - 1.0 : 0.0;
      speed *= 1.0 + 0.6 * rif;
    }
    // Fade each octave before it shrinks below a pixel (it would only shimmer), and widen the glint
    // instead, so a distant reach still glitters as a band rather than aliased sparks.
    float fine = 1.0 - smoothstep(0.04, 0.2, px), coarse = 1.0 - smoothstep(0.15, 0.8, px);
    float e = 0.12, h0 = ripple(q, speed, fine);
    vec2 g = vec2(ripple(q + vec2(e, 0.0), speed, fine) - h0, ripple(q + vec2(0.0, e), speed, fine) - h0) / e;
    g *= rippleAmp * max(coarse, 0.15) * (1.0 + 0.9 * max(rif, 0.0) - 0.35 * max(-rif, 0.0));
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
    vec3 lit = (sunLight * max(sunDir.y, 0.0) * sh + ambientSky * 2.0) * 0.3183099;
    vec3 body = vec3(0.020, 0.045, 0.040) * lit;
    // Shallow water shows its bed: warm gravel through a few centimetres, the dark column from about
    // half a metre down; riffles carry broken white water where they are steepest.
    float column = 1.0 - exp(-dep / 0.2);
    body = mix(vec3(0.16, 0.14, 0.09) * lit, body * mix(1.1, 0.5, smoothstep(0.25, 1.0, dep)), column);
    float froth = pond < 0.5 ? smoothstep(0.45, 1.0, rif) * smoothstep(0.55, 0.85, wNoise(q * vec2(1.6, 2.4) - vec2(uTime * speed * 3.0, 0.0))) * coarse : 0.0;
    body = mix(body, vec3(0.55, 0.57, 0.55) * lit, froth * 0.5);
    // Sun glint, normalised Blinn-Phong; the lobe widens with distance (see above).
    vec3 H = normalize(V + sunDir);
    float shin = mix(900.0, 90.0, smoothstep(0.03, 1.5, px));
    float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    float glint = Fs * (shin + 8.0) / 25.13 * pow(max(dot(N, H), 0.0), shin) * max(sunDir.y, 0.0);
    vec3 col = body * (1.0 - F) + skyR * F + sunLight * glint * sh;
    // Soft banks: ribbons fade over their outer third onto the bed under them.
    // Ponds carry their shoreline fade in vExtra.x (0 on the ring, 1 a metre or two inside).
    float edge = pond > 0.5 ? smoothstep(0.0, 1.0, vExtra.x) : 1.0 - smoothstep(0.55, 1.0, abs(vFlow.y) / vFlow.z);
    float a = clamp(edge * mix(opacity * mix(0.6, 1.0, column), 1.0, F) + glint * 0.5 * (pond > 0.5 ? edge : 1.0), 0.0, 1.0);
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

// The constructor records its arguments; build() (a generator main.js steps with slice.js runSliced, a pond or a
// stream at a time, so the opening screen keeps responding; drain(water.build()) runs it in one go) makes the water.
export class Water {
  constructor(tile, scene) { this.tile = tile; this.scene = scene; }
  *build() {
    const tile = this.tile, scene = this.scene;
    this.group = new THREE.Group(); this.group.name = 'water'; this.group.userData.water = this;
    this.season = null; this.look = null; this.stats = { skippedRings: 0, reaches: 0 };
    const time = { value: 0 };
    const base = { uTime: time, depthPull: { value: 0.25 }, depthPullK: { value: 0.003 },
      fineRect: { value: new THREE.Vector4(1, 0, 1, 0) }, fineBand: { value: 20 } };
    this.uniforms = base;
    const mk = (frag, extra) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: frag, uniforms: { ...atmo, ...base, ...extra },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      return m;
    };
    this.bedMaterial = mk(BED_FRAG, { classWet: { value: new THREE.Vector3(1, 1, 1) }, opacity: { value: 1 } });
    // depth profile texture, shared by both water materials (a 1 px placeholder until it loads)
    const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true;
    const prof = { profileTex: { value: blank }, hasProfile: { value: 0 }, tileSize: { value: tile.size } };
    this.profileUniforms = prof;
    this.waterMaterial = mk(WATER_FRAG, { rippleAmp: { value: 0.22 }, opacity: { value: 0.88 }, pond: { value: 0 }, ...prof });
    if (tile.heights.detail) for (const m of [this.bedMaterial, this.waterMaterial]) m.defines = { DRAPE: '' };   // ribbons only; ponds are flat at their level
    this.pondMaterial = mk(WATER_FRAG, { rippleAmp: { value: 0.07 }, opacity: { value: 0.93 }, pond: { value: 1 }, ...prof });
    this.pondBedMaterial = mk(BED_FRAG, { classWet: { value: new THREE.Vector3(0, 0, 0) }, opacity: { value: 0.8 } });

    const features = tile.features || {};
    const H = terrainHeight(tile);
    this.H = H;
    this.rewildList = tile.manifest?.layers?.['hydro.human_water']?.rewilded || [];
    const ponds = yield* this.buildPonds(features.waterbodies || [], H);
    yield* this.buildStreams(features.streams || [], H, ponds);

    // Draw order: beds, then streams, then ponds, after the opaque world.
    this.beds.renderOrder = 1; for (const c of CLASSES) this.streams[c].renderOrder = 2;
    this.ponds.renderOrder = 3; this.pondBeds.renderOrder = 1;
    scene.add(this.group);
    this.setSeason('summer');
    current = this;
    this.profile = null;
    this.profileReady = this.loadProfile(tile);
  }

  // client/channel_profile.png: pixels for depthAt() and a texture for the water shader. Optional.
  async loadProfile(tile) {
    const L = tile.manifest?.layers?.['client.channel_profile'];
    if (!L) return null;
    try {
      const img = await loadImageData(tile.dir + L.path);
      this.profile = { width: img.width, data: img.data, res: tile.size / img.width, size: tile.size };
      const tex = new THREE.Texture(img.image);
      tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
      this.profileUniforms.profileTex.value = tex; this.profileUniforms.hasProfile.value = 1;
      return this.profile;
    } catch (e) { console.info('water: no channel profile', e.message); return null; }
  }

  // Channel profile pixel (R, G, B) at a point, or null before it loads / off the tile.
  profileAt(x, north) {
    const P = this.profile; if (!P || x < 0 || north < 0 || x >= P.size || north >= P.size) return null;
    const i = Math.floor(x / P.res), j = Math.floor((P.size - north) / P.res), o = (j * P.width + i) * 4;
    return [P.data[o], P.data[o + 1], P.data[o + 2]];
  }

  // Rewilded water under a point (channel_profile.png B): 255 a former reservoir or stock-pond bed
  // (now a meadow or wet flat), 160 the riparian corridor along the restored channel through it, 0
  // elsewhere (and 0 until the profile loads). The hook for vegetation and ground.
  rewildAt(x, north) { const p = this.profileAt(x, north); return p ? p[2] : 0; }

  // Water depth in metres at (x, north): in a pond holding water this season, its level over the
  // drawn ground; in a creek running this season, the thalweg depth from the profile (pools and
  // riffles from the DEM's long profile) across a parabolic section of the drawn ribbon's width,
  // 0 at its edges; 0 on dry ground. Before the profile loads a creek uses a notional depth from its
  // width. opts.anySeason: count reaches and ponds that are dry this season too.
  depthAt(x, north, opts = {}) {
    let best = 0;
    for (const p of this.pondRings) {
      const [x0, y0, x1, y1] = p.bbox;
      if (x < x0 || x > x1 || north < y0 || north > y1) continue;
      if (!opts.anySeason && !(p.intermittent ? this.pondsSeasonal.visible : this.ponds.visible)) continue;
      if (inRing(x, north, p.ring)) best = Math.max(best, p.level - this.H(x, north));
    }
    const G = this.sectionGrid; if (!G) return Math.max(0, best);
    for (const k of G.get(Math.floor(north / SEC_B) * 4096 + Math.floor(x / SEC_B)) || []) {
      const S = this.sections, o = k * SEC_W, cls = S[o + 6];
      if (!opts.anySeason && !this.streams[CLASSES[cls]].visible) continue;
      const ax = S[o], ay = S[o + 1], bx = S[o + 7], by = S[o + 8], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (north - ay) * dy) / L2)) : 0;
      const half = S[o + 2] + (S[o + 9] - S[o + 2]) * t; if (half <= 0) continue;
      const r = Math.hypot(ax + dx * t - x, ay + dy * t - north); if (r >= half) continue;
      const fx = ax + dx * t, fy = ay + dy * t, px = this.profileAt(fx, fy);
      const D = px ? (px[0] ? px[0] * 0.02 : 0.02) : Math.min(1.2, 0.04 + 0.11 * half) * 0.6;
      best = Math.max(best, D * (1 - (r / half) ** 2));
    }
    return Math.max(0, best);
  }

  // Ponds: flat polygons at the water level. Large ponds and reservoirs (> ~1 ha) are
  // hydro-flattened in the DEM at the level of the day the lidar flew, often below the NHD shoreline,
  // with the bank sloping up to the ring; a surface at that flat stops 20-40 m inside the polygon.
  // Their level is the shoreline's own height instead: the 60th percentile of the mesh along the
  // ring (sampled every 2.5 m), sunk 10 cm, so the water reaches the ring nearly everywhere; the
  // polygon bounds it, so it cannot flood past the shore, and the depth pull hides the few
  // decimetres it floats over the lower stretches. Small stock ponds are 1-4 m bowls in the DEM,
  // where the minimum would leave a puddle: the level rises toward the interior median (at most
  // 1.5 m) and the rendered shore triangles above it cut the shoreline. Every pond fades from
  // transparent on its ring to full over POND_FADE metres inside it (an inset skirt), so the
  // shoreline is not a crisp polygon edge.
  *buildPonds(waterbodies, H) {
    const permanent = [], seasonal = [], dry = [], rings = [], rewilded = [];
    let skipped = 0;
    for (const w of waterbodies) {
      yield;
      let ring = w.ring.slice();
      if (ring.length > 3 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
      if (ring.length < 3) continue;
      if (selfIntersects(ring)) { skipped++; continue; }
      let area = signedArea(ring);
      if (area < 0) { ring.reverse(); area = -area; }   // counter-clockwise in (x, north): inward is to the left
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      // A reservoir or stock pond the pipeline rewilded: no surface; its restored channel is a stream.
      const rw = this.rewildList.find(r => bboxIoU(r.bbox, [x0, y0, x1, y1]) > 0.6);
      if (rw) { rewilded.push({ ring, bbox: [x0, y0, x1, y1], id: rw.id, name: rw.name, kind: rw.kind, area }); continue; }
      // Lowest mesh height: on the ring itself and on a grid inside it (2.5 m, capped at ~4000 samples).
      const shore = [];
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2.5));
        for (let j = 0; j < k; j++) shore.push(H(ax + (bx - ax) * j / k, ay + (by - ay) * j / k));
      }
      shore.sort((a, b) => a - b);
      let lo = shore[0];
      const step = Math.max(2.5, Math.sqrt((x1 - x0) * (y1 - y0) / 4000));
      const inside = [];
      for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step)
        if (inRing(x, y, ring)) { const h = H(x, y); inside.push(h); lo = Math.min(lo, h); }
      inside.sort((a, b) => a - b);
      const med = inside.length ? inside[inside.length >> 1] : lo;
      const level = area > POND_BIG
        ? Math.max(lo + 0.05, shore[Math.floor(0.6 * (shore.length - 1))] - 0.1)
        : lo + Math.min(Math.max(med - lo, 0), 1.5) + 0.05;
      const g = pondGeometry(ring, level, Math.min(POND_FADE, Math.sqrt(area) * 0.08));
      const intermittent = POND_INTERMITTENT.has(w.fcode);
      if (intermittent) { seasonal.push(g); dry.push(g.clone()); } else permanent.push(g);
      rings.push({ ring, bbox: [x0, y0, x1, y1], intermittent, level, area });
    }
    const merge = list => (list.length ? mergeGeometries(list) : new THREE.BufferGeometry());
    this.stats.skippedRings = skipped; this.stats.ponds = { permanent: permanent.length, seasonal: seasonal.length, rewilded: rewilded.length };
    this.pondRings = rings;
    this.rewildedRings = rewilded;   // the old shorelines of the water taken out (for placenames, vegetation, debugging)
    if (skipped) console.info(`water: skipped ${skipped} self-intersecting waterbody ring(s)`);
    // Perennial ponds always hold water; intermittent ones hold it in the wet season and show
    // their dry pan (the bed shader) the rest of the year.
    this.ponds = new THREE.Mesh(merge(permanent), this.pondMaterial);
    this.pondsSeasonal = new THREE.Mesh(merge(seasonal), this.pondMaterial); this.pondsSeasonal.renderOrder = 3;
    this.pondBeds = new THREE.Mesh(merge(dry), this.pondBedMaterial);
    this.group.add(this.ponds, this.pondsSeasonal, this.pondBeds);
    return rings;
  }

  *buildStreams(streams, H, ponds) {
    const bed = new RibbonBuffers(), water = Object.fromEntries(CLASSES.map(c => [c, new RibbonBuffers()]));
    const sec = [];   // per section: x, north, half, s, tx, tz, class, has-next (SEC_W floats... see sectionIndex)
    const inPond = (x, y) => ponds.some(p => x >= p.bbox[0] && x <= p.bbox[2] && y >= p.bbox[1] && y <= p.bbox[3] && inRing(x, y, p.ring));
    const nrm = new THREE.Vector3(), hf = this.tile.heights, drape = !!hf.detail;
    const normalAt = (x, n) => nrm.set(H(x - 2, n) - H(x + 2, n), 4, -(H(x, n - 2) - H(x, n + 2))).normalize();
    // Prefer the DEM's geometry: NHD-sourced stretches (kept where the DEM found no channel) are cut
    // wherever a DEM channel runs within DEM_PREFERRED_M of them, so a stream is never drawn twice.
    const nearDem = demIndex(streams, DEM_PREFERRED_M);
    let skippedInPond = 0;
    let reaches = 0;
    let k = 0;
    for (const st of streams) {
      if ((k++ & 7) === 0) yield;
      const cls = st.fcode in STREAM_CLASS ? STREAM_CLASS[st.fcode] : 'intermittent';
      if (!cls || !st.path || st.path.length < 2) continue;
      // A reach inside a waterbody ring is drawn as the pond, where the pond is drawn (a ring
      // skipped as self-intersecting leaves its reach to be drawn as a stream).
      if (st.in_waterbody) { const m = st.path[st.path.length >> 1]; if (inPond(m[0], m[1])) { skippedInPond++; continue; } }
      const order = Math.max(1, Math.min(MAX_ORDER, st.order || 1)), ci = CLASSES.indexOf(cls);
      // Widths from drainage area when the pipeline gives them (water 1.6 A^0.45 m, bed 1.5 w + 1);
      // else by order, with the dry bed (gravel bars, the flood channel) half again the water plus a metre.
      const ww = st.width > 0 ? st.width : WIDTH_BY_ORDER[order] * WATER_WIDTH_SCALE[cls];
      const bw = st.bed_width > 0 ? st.bed_width : WIDTH_BY_ORDER[order] * 1.5 + 1.0;
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
      const dup = st.source === 'nhd' && nearDem ? nearDem : null;
      for (const p of pts) { if (inPond(p[0], p[1]) || (dup && dup(p[0], p[1]))) { if (run.length > 1) runs.push(run); run = []; } else run.push(p); }
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
        // centreline sections with the drawn water half width, for depthAt()
        for (let i = 0; i < sections.length; i++) {
          const c = sections[i];
          sec.push(c.x, c.n, ww / 2 * wMod(c.s), c.s, c.tx, c.tz, ci, i + 1 < sections.length ? 1 : 0);
        }
        // Strip with `cols` cross-section vertices at offsets `offs` (metres, along the perp).
        const strip = (buf, half0, offs, strength, sp, mod) => {
          const cols = offs.length; let first = -1;
          for (const c of sections) {
            const px = -c.tz, pz = c.tx;   // perp in world xz
            const m = mod(c.s), half = half0 * m;
            for (const o0 of offs) {
              const o = o0 * m, x = c.x + px * o, z = -c.n + pz * o, n = -z;
              const nn = normalAt(x, n);
              const k = buf.vertex(x, H(x, n), z, nn.x, nn.y, nn.z, c.s, o, half, sp, c.tx, c.tz, strength, ci, drape ? hf.coarse(x, n) : undefined);
              if (first < 0) first = k;
            }
          }
          for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < cols - 1; j++) {
            const a = first + i * cols + j, b = a + 1, c = a + cols, d = c + 1;
            buf.idx.push(a, c, b, b, c, d);
          }
        };
        // Interior vertices (at most ~5 m apart) let a wide ribbon fold into a V-valley instead of
        // bridging it; a ribbon under ~6 m fits inside one 10 m terrain quad and needs only its two
        // edges (half the triangles, most of the network).
        const across = w => { const k = w > 6 ? Math.max(2, Math.ceil(w / 5)) : 1; return Array.from({ length: k + 1 }, (_, i) => -w / 2 + w * i / k); };
        strip(bed, bw / 2, across(bw), BED_STRENGTH[cls] * (order === 1 ? 0.8 : 1), 0, bMod);
        strip(water[cls], ww / 2, across(ww), 1, speed, wMod);
      }
    }
    this.stats.reaches = reaches; this.stats.skippedInPond = skippedInPond;
    this.sectionIndex(sec);
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

  // Segments between consecutive centreline sections on a SEC_B m grid (padded by the half width).
  // this.sections holds SEC_W floats per segment: a (x, north, half, s, tx, tz), class, then b (x, north, half).
  sectionIndex(sec) {
    const W = 8, segs = [];
    for (let i = 0; i + W <= sec.length; i += W) if (sec[i + 7]) segs.push(i);
    const S = new Float32Array(segs.length * SEC_W), G = new Map();
    segs.forEach((i, k) => {
      const o = k * SEC_W;
      S[o] = sec[i]; S[o + 1] = sec[i + 1]; S[o + 2] = sec[i + 2]; S[o + 3] = sec[i + 3]; S[o + 4] = sec[i + 4]; S[o + 5] = sec[i + 5];
      S[o + 6] = sec[i + 6]; S[o + 7] = sec[i + W]; S[o + 8] = sec[i + W + 1]; S[o + 9] = sec[i + W + 2];
      const pad = Math.max(S[o + 2], S[o + 9]);
      for (let j = Math.floor((Math.min(S[o + 1], S[o + 8]) - pad) / SEC_B); j <= Math.floor((Math.max(S[o + 1], S[o + 8]) + pad) / SEC_B); j++)
        for (let q = Math.floor((Math.min(S[o], S[o + 7]) - pad) / SEC_B); q <= Math.floor((Math.max(S[o], S[o + 7]) + pad) / SEC_B); q++) {
          const key = j * 4096 + q; let l = G.get(key); if (!l) G.set(key, l = []); l.push(k);
        }
    });
    this.sections = S; this.sectionGrid = G;
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
    const F = this.tile.heights.fine;   // the terrain's fine mesh this frame (DRAPE)
    if (F) { this.uniforms.fineRect.value.set(F.x0, F.x1, F.n0, F.n1); this.uniforms.fineBand.value = F.band; } else this.uniforms.fineRect.value.set(1, 0, 1, 0);
    if (look && look !== this.look) { this.look = look; const s = seasonOf(look); if (s !== this.season) this.setSeason(s); }
  }
}

// The Water built last (one per world): depthAt(x, north) and rewildAt(x, north) without a reference.
let current = null;
const SEC_B = 20, SEC_W = 10;   // depthAt section grid (m) and floats per segment
export function depthAt(x, north, opts) { return current ? current.depthAt(x, north, opts) : 0; }
export function rewildAt(x, north) { return current ? current.rewildAt(x, north) : 0; }

function bboxIoU(a, b) {
  const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (ix <= 0 || iy <= 0) return 0;
  const i = ix * iy, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
  return u > 0 ? i / u : 0;
}

// (x, north) -> true within `r` metres of a DEM-sourced reach's centreline; null without DEM reaches.
function demIndex(streams, r) {
  const B = 50, cells = new Map(), segs = [];
  for (const st of streams) {
    if (st.source !== 'dem' || !st.path) continue;
    for (let i = 0; i < st.path.length - 1; i++) {
      const s = [st.path[i][0], st.path[i][1], st.path[i + 1][0], st.path[i + 1][1]];
      for (let j = Math.floor((Math.min(s[1], s[3]) - r) / B); j <= Math.floor((Math.max(s[1], s[3]) + r) / B); j++)
        for (let k = Math.floor((Math.min(s[0], s[2]) - r) / B); k <= Math.floor((Math.max(s[0], s[2]) + r) / B); k++) {
          const key = j * 1000 + k; let c = cells.get(key); if (!c) cells.set(key, c = []); c.push(segs.length);
        }
      segs.push(s);
    }
  }
  if (!segs.length) return null;
  return (x, y) => {
    for (const n of cells.get(Math.floor(y / B) * 1000 + Math.floor(x / B)) || []) {
      const [ax, ay, bx, by] = segs[n], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      if ((ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2 < r * r) return true;
    }
    return false;
  };
}

// Twice-halved shoelace: positive when the ring runs counter-clockwise in (x, north).
function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

// The ring moved `d` metres inward (counter-clockwise ring): each vertex along the bisector of its
// two edges' inward normals, the miter capped at 3d. Null when the result folds over itself.
function insetRing(ring, d) {
  const n = ring.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n], c = ring[i], q = ring[(i + 1) % n];
    let ax = c[0] - p[0], ay = c[1] - p[1], bx = q[0] - c[0], by = q[1] - c[1];
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1; ax /= la; ay /= la; bx /= lb; by /= lb;
    let mx = -ay - by, my = ax + bx; const lm = Math.hypot(mx, my);
    if (lm < 1e-6) { mx = -ay; my = ax; } else { mx /= lm; my /= lm; }
    const k = d / Math.max(mx * -ay + my * ax, 1 / 3);
    out.push([c[0] + mx * k, c[1] + my * k]);
  }
  return signedArea(out) > 0 && !selfIntersects(out) ? out : null;
}

// A pond's water polygon at `level`: the inset ring triangulated at full alpha, plus a skirt of
// quads out to the shoreline where aExtra.x (edge alpha) falls to 0. Without a clean inset (a
// ring narrower than the fade) the plain polygon is drawn at full alpha.
function pondGeometry(ring, level, fade) {
  let inner = null;
  for (let d = fade; !inner && d > 0.2; d /= 2) inner = insetRing(ring, d);
  const n = ring.length, verts = inner ? inner.concat(ring) : ring;
  const tris = THREE.ShapeUtils.triangulateShape((inner || ring).map(([x, y]) => new THREE.Vector2(x, y)), []);
  const idx = tris.flat();
  if (inner) for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, j, n + i, j, n + j, n + i); }
  const nv = verts.length, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  const flow = new Float32Array(nv * 4), dir = new Float32Array(nv * 2), extra = new Float32Array(nv * 2);
  verts.forEach(([x, y], k) => {
    pos.set([x, level, -y], k * 3); nrm[k * 3 + 1] = 1;
    // Pond shader takes flow from world xz; the bed shader needs a large half-width so it is not faded.
    flow.set([x, y, 1e6, 0], k * 4); dir[k * 2] = 1;
    extra[k * 2] = inner && k >= n ? 0 : 1; extra[k * 2 + 1] = 1;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 4));
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 2));
  g.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
  g.setIndex(idx);
  return g;
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
