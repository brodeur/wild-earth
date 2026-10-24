import * as THREE from 'three';
import { mulberry32 } from './trees.js';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { SEASON_LOOK } from './season.js';
import { buildAnnualClump, buildBunchClump, buildTuft } from './grassBlades.js';
import { windUniforms, WIND_GLSL } from './wind.js';
import { groundUniforms, GROUND_GLSL } from './terrain.js';
import { ShrubField, GrassClumps, StalkClumps, CLUMP_BAND, STALK_BAND, waterAt } from './shrubfield.js';
import { GrassShells } from './grassShells.js';

// Grass in the Sierra foothill savanna: non-native annuals (wild oat, bromes, medusahead) over
// purple needlegrass bunchgrass. Two LODs in one system, five draw calls:
//   near (to ~70 m): instanced clumps of real blade geometry, one mesh per type (annual, bunch),
//                    plus a denser close tier of the same clumps within ~30 m, and a denser ground
//                    tier again within ~16 m (its own pair of meshes, refilled more often);
//   mid (to 250 m):  leaning tuft cards whose blades are cut out in the fragment shader.
// Past 250 m the ground texture carries it. The handovers are stochastic: each near clump has its
// own cut-off distance in its tier's band (ground 10-16 m, close 16-30 m, main 55-85 m) and thins
// out blade by blade over a few metres there (each blade has its own threshold), while each tuft
// dithers in at its own distance in 26-38 m, so there is no seam line. Nothing changes size in a
// handover: a scaled fade reads as plants growing out of the ground and sinking back into it.
// Placement is deterministic per 30 m habitat cell and cached, so nothing re-rolls as you move;
// each frame only the cells in view are submitted to the GPU (see cull).
// Seen from the air (docs/grass-notes.md) three more layers hang off this class: sward shells for
// 8-60 m up (grassShells.js); needlegrass tussock, dry wild oat and chaparral shrub impostors (shrubfield.js).
// Every grass material takes its colour from the ground texture under it (terrain.js GROUND_GLSL)
// and moves with the shared gust field (wind.js), which the terrain also paints as a sheen.

const NEAR_FADE = [55, 85], NEAR_REBUILD = 25, NEAR_PLACE = NEAR_FADE[1] + NEAR_REBUILD + 2;
const MID_END = 250, MID_REBUILD = 60, MID_PLACE = MID_END + MID_REBUILD;
const NEAR_PER_M2 = 1 / 1.35, MID_PER_M2 = 1 / 4;
// Close tier: extra clumps near the camera, where a 1.35 m^2 spacing reads as bare ground between
// wisps. They hand over (thin out) between 16 and 30 m, where the grazing view fills in anyway.
const CLOSE_FADE = [16, 30], CLOSE_PLACE = CLOSE_FADE[1] + NEAR_REBUILD + 2, CLOSE_PER_M2 = 1 / 0.18;
// Ground tier: more clumps again within ~16 m. The chase camera sits 3.5-5 m up even with the raven
// on the ground, so it looks down 15-50 degrees at this ring, and the close tier alone (tuned for a
// level eye at 2 m, where the grazing view stacks blades into a solid sward) covered only a few per
// cent of the screen there: a bare disc around the camera. Its own meshes, refilled every 8 m, so it
// is placed only to 34 m (two refills beyond the cells that must exist now, so a cell entering the
// radius is always queued and built in the background before it is needed); cheap to draw, since
// the ring is small and culled in 10 m blocks.
const GROUND_FADE = [10, 16], GROUND_REBUILD = 8, GROUND_PLACE = GROUND_FADE[1] + 2 * GROUND_REBUILD + 2, GROUND_PER_M2 = 8;
// Tufts dither in over 26-38 m, just past the close tier's hand-over, whatever the blades do: the main
// tier alone (one clump per 1.35 m^2) is too thin to carry 30-55 m from a camera a few metres up.
const MID_IN = [26, 38];
// Placement layers, each cached per cell. `now`: a cell nearer than this is visible already and is
// generated at once; farther ones (the new ring at the edge of the placement radius) are queued
// and built a few per frame, so flying into new ground does not stall a frame. `place`: placement
// radius. `sub`: block size (m) a cell's instances are split into for culling; the near tiers use
// 10 m, since a 30 m cell block submitted ~2.4x the instances actually in view.
const LAYERS = [
  { perM2: NEAR_PER_M2, tier: 0, salt: 11, now: NEAR_FADE[1] + 3, place: NEAR_PLACE, sub: 10, pool: 'near' },                   // near, main
  { perM2: CLOSE_PER_M2 - NEAR_PER_M2, tier: 1, salt: 37, now: CLOSE_FADE[1] + 3, place: CLOSE_PLACE, sub: 10, pool: 'near' },  // near, close
  { perM2: GROUND_PER_M2, tier: 2, salt: 53, now: GROUND_FADE[1] + 3, place: GROUND_PLACE, sub: 10, pool: 'ground' },           // near, ground
  { perM2: MID_PER_M2, tier: 0, salt: 23, now: MID_END, place: MID_PLACE, sub: 30, pool: 'mid', mid: true },                    // mid tufts
];
// Refill pools: each restages its own meshes (by type for the blades) from its layers when the camera
// has moved `rebuild` metres from where it last filled, out to `place`.
const POOLS = {
  near: { layers: [0, 1], sets: ['annual', 'bunch'], rebuild: NEAR_REBUILD, place: NEAR_PLACE },
  ground: { layers: [2], sets: ['groundA', 'groundB'], rebuild: GROUND_REBUILD, place: GROUND_PLACE },
  mid: { layers: [3], sets: ['mid'], rebuild: MID_REBUILD, place: MID_PLACE },
};
// Habitat class -> relative density and the annual share (the rest is needlegrass).
const HABITAT = { 5: { dens: 1.0, annual: 0.75 }, 1: { dens: 0.5, annual: 0.55 }, 6: { dens: 0.12, annual: 0.5 } };
const STRIDE = 8;   // per instance: x, y, z, yaw | scale xz, scale y, seed, type + 2 * tier (type 0 annual, 1 bunch; tier 1 close, 2 ground)

// Season palettes (sRGB). Annuals: wild oat and bromes; bunch: purple needlegrass. The season's
// `grass` tint stays the overall tone: these are scaled by tint / SEASON_LOOK[season].grass.
const PALETTE = {
  winter: { dry: 0, height: 0.5, heads: 0, thatch: 0.35, leaf: 1.0,
    annual: { root: [0.22, 0.29, 0.15], tip: [0.47, 0.66, 0.30], head: [0.62, 0.66, 0.36], awn: [0.62, 0.66, 0.40] },
    bunch: { root: [0.29, 0.33, 0.24], tip: [0.43, 0.57, 0.32], head: [0.50, 0.52, 0.40], awn: [0.55, 0.52, 0.45] } },
  spring: { dry: 0.15, height: 1.0, heads: 1, thatch: 0.08, leaf: 1.0,
    annual: { root: [0.21, 0.31, 0.12], tip: [0.50, 0.70, 0.26], head: [0.74, 0.77, 0.38], awn: [0.70, 0.74, 0.40] },
    bunch: { root: [0.27, 0.35, 0.21], tip: [0.45, 0.61, 0.28], head: [0.52, 0.44, 0.44], awn: [0.55, 0.42, 0.50] } },   // needlegrass awns: dusky purple
  summer: { dry: 1, height: 0.9, heads: 1, thatch: 0.0, leaf: 0.8,
    annual: { root: [0.46, 0.40, 0.27], tip: [0.86, 0.75, 0.48], head: [0.93, 0.86, 0.64], awn: [0.88, 0.80, 0.60] },
    bunch: { root: [0.37, 0.41, 0.32], tip: [0.73, 0.66, 0.47], head: [0.80, 0.75, 0.62], awn: [0.84, 0.79, 0.66] } },
  fall: { dry: 0.85, height: 0.8, heads: 1, thatch: 0.0, leaf: 0.7,
    annual: { root: [0.41, 0.37, 0.28], tip: [0.78, 0.69, 0.50], head: [0.83, 0.78, 0.63], awn: [0.79, 0.75, 0.63] },
    bunch: { root: [0.35, 0.39, 0.31], tip: [0.67, 0.62, 0.47], head: [0.74, 0.71, 0.62], awn: [0.76, 0.73, 0.64] } },
};
const THATCH = [0.58, 0.54, 0.45];   // last year's grey dead leaves, in among the new growth

// ---- GLSL shared by both LODs ---------------------------------------------------------------
const COMMON_VERT = /* glsl */`
  ${WIND_GLSL}
  ${GROUND_GLSL}
  uniform vec2 nearFade; uniform vec2 closeFade; uniform vec2 groundFade; uniform vec2 midIn; uniform float midEnd; uniform float groundK; uniform float matchOn; uniform float tiltOn;
  uniform float heightScale; uniform float heads; uniform float thatch; uniform float leafScale;
  uniform vec3 aRoot; uniform vec3 aTip; uniform vec3 aHead; uniform vec3 aAwn;
  uniform vec3 bRoot; uniform vec3 bTip; uniform vec3 bHead; uniform vec3 bAwn; uniform vec3 thatchCol;
  attribute vec4 iPos; attribute vec4 iVar;   // x y z yaw | scale xz, scale y, seed, type
  float h11(float n) { return fract(sin(n) * 43758.5453123); }
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  // Instance outside the view frustum (bounding sphere of radius r around a point r above the
  // root)? Lets the vertex shader skip the shading work for the ~2/3 of instances off screen.
  bool offscreen(vec3 root, float r) {
    vec4 c = projectionMatrix * (viewMatrix * vec4(root + vec3(0.0, r, 0.0), 1.0));
    float m = r * 2.0 * max(projectionMatrix[0][0], projectionMatrix[1][1]);
    return c.w < -r || abs(c.x) > c.w + m || abs(c.y) > c.w + m;
  }
  vec2 yawRot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x + s * v.y, -s * v.x + c * v.y); }
  // Albedo (linear): root-to-tip gradient per type, culms grading to the head colour, last year's
  // thatch in the green seasons, per-blade and per-clump hue/brightness, and field-scale patches.
  vec3 grassAlbedo(float type, float t, float part, float br, float seed, vec2 wxz) {
    bool bunch = type > 0.5;
    vec3 root = bunch ? bRoot : aRoot, tip = bunch ? bTip : aTip, head = bunch ? bHead : aHead, awn = bunch ? bAwn : aAwn;
    vec3 c;
    if (part < 0.5) {
      c = mix(root, tip, smoothstep(0.0, 0.9, t));
      if (h11(br * 17.3 + seed * 3.7) < thatch) c = thatchCol * mix(0.75, 1.05, t);
      else c *= 0.88 + 0.24 * h11(br * 91.7 + seed * 13.1);
    } else if (part < 1.5) c = mix(root, mix(tip, head, 0.6), smoothstep(0.1, 1.0, t));
    else c = part < 2.5 ? head : awn;
    float v1 = h11(seed * 7.7 + 0.1), v2 = h11(seed * 3.3 + 1.0);
    c *= mix(vec3(0.94, 1.02, 1.05), vec3(1.06, 0.99, 0.88), v1) * (0.86 + 0.26 * v2);
    c *= mix(vec3(0.95, 1.03, 1.0), vec3(1.06, 0.98, 0.9), vnoise(wxz * 0.05)) * (0.92 + 0.16 * vnoise(wxz * 0.13 + 7.0));
    return c;
  }
  // Tie a grass albedo to the ground under the root. Up close (m = 0) the blade keeps its palette,
  // which stands out paler than the ground as real wisps do, and takes only the ground's local
  // patchiness (the texel over a ~600 m regional mean). Toward the hand-over (m = 1) it keeps its
  // own variation (its ratio to its type's mean leaf colour) but takes the mean from the ground,
  // so the far sward is the colour of the texture it hands over to. Grassland (and grass under oaks) only.
  vec3 groundMatch(vec3 c, float type, vec3 root, float m) {
    if (matchOn < 0.5) return c;
    vec3 gw; vec3 g = groundAlbedo(root, 1.0, gw);
    float on = smoothstep(0.05, 0.4, gw.r + 0.5 * gw.g);
    if (on < 0.01) return c;
    vec3 gr = groundRecolour(textureLod(map, groundUv(root), 8.0).rgb, gw);
    vec3 local = c * clamp(g / max(gr, vec3(1e-3)), vec3(0.75), vec3(1.3));
    vec3 mean = type > 0.5 ? mix(bRoot, bTip, 0.6) : mix(aRoot, aTip, 0.6);
    float ml = dot(mean, G_LUMA), gl = dot(g, G_LUMA);
    g *= clamp(gl, 0.6 * ml, 1.5 * ml) / max(gl, 1e-4);   // the photo's dark smudges do not make black grass
    return mix(c, mix(local, c / max(mean, vec3(1e-3)) * g * groundK, m), on);
  }
  // Sky light reaching a plant at its root: the canopy cover's soft woodland shade and the contact
  // AO blob under each near tree, exactly the terms the terrain's ambient takes, so grass under an
  // oak is as much darker than open grass as the ground under it is (sun shadow: cloudShadow).
  float skyOcc(vec3 root) { return groundSkyOcclusion(groundUv(root)) * groundContactAO(root); }
  // Lean away from the camera by part of the view's depression angle, so blades seen from above
  // show their faces rather than their edges (Horizon's camera tilt); nothing at eye level.
  vec2 tiltCS(vec3 root) {
    vec3 r = root - cameraPosition; float hd = length(r.xz);
    float a = clamp(atan(-r.y, hd) * 0.5, 0.0, 0.45) * tiltOn;
    return vec2(cos(a), sin(a));
  }
  vec3 tilt(vec3 v, vec3 root, vec2 cs) {
    vec2 away = normalize(root.xz - cameraPosition.xz + vec2(1e-4, 0.0));
    float along = dot(v.xz, away), na = along * cs.x + v.y * cs.y;
    v.xz += away * (na - along); v.y = v.y * cs.x - along * cs.y;
    return v;
  }
`;
// Shading runs per vertex (blades are 4-5 vertex rows tall, so Gouraud loses nothing visible and
// the thin, overlapping blades no longer pay for haze and cloud shadow per fragment).
const SHADE_VERT = /* glsl */`
  ${ATMOSPHERE_GLSL}
  // Light on a blade in a sward: diffuse on the camera-facing side, bent toward the ground normal
  // (blades share the ground's light), fewer sun flecks low in the sward, ambient occlusion toward
  // the root, and light through the blade when the sun is behind it, strongest looking into the sun.
  vec3 grassShade(vec3 albedo, vec3 N, vec3 posW, float t, float ao, float glow) {
    vec3 V = normalize(cameraPosition - posW);
    N = normalize(N); if (dot(N, V) < 0.0) N = -N;
    vec3 Nl = normalize(N + vec3(0.0, 1.0, 0.0));
    float sh = cloudShadow(posW), sunUp = smoothstep(-0.03, 0.08, sunDir.y);
    float diff = max(dot(Nl, sunDir), 0.0) * mix(0.45, 1.0, t);
    float back = (max(-dot(N, sunDir), 0.0) * 0.3 + pow(max(dot(-V, sunDir), 0.0), 5.0) * 0.55 * t) * glow * sunUp;
    vec3 trans = albedo * normalize(albedo + 1e-4) * 1.7;   // light through a blade comes out more saturated
    vec3 amb = mix(ambientGround, ambientSky, 0.3 + 0.6 * t) * ao;
    vec3 c = (albedo * (sunLight * diff * sh + amb) + trans * sunLight * back * sh) * 0.3183099;
    return atmosphereApply(c, posW, cameraPosition);
  }
`;

const NEAR_VERT = /* glsl */`
  ${COMMON_VERT}
  ${SHADE_VERT}
  attribute vec4 aBlade;   // t, blade random, part, -
  varying vec3 vColor;
  void main() {
    float t = aBlade.x, br = aBlade.y, part = aBlade.z, seed = iVar.z, type = mod(iVar.w, 2.0);
    float d = distance(cameraPosition, iPos.xyz);
    vec2 band = iVar.w > 3.5 ? groundFade : iVar.w > 1.5 ? closeFade : nearFade;
    float dOut = mix(band.x, band.y, h11(seed * 517.3 + 0.37));   // this clump's own hand-over distance
    float hb = h11(seed * 71.9 + br * 131.7);
    // Hand-over: the clump thins blade by blade over dOut +/- 3 m (a stable threshold per blade),
    // at full height; no fragment discard, so the opaque blades keep their hidden-surface removal.
    float s = step(h11(seed * 23.9 + br * 97.3), 1.0 - smoothstep(dOut - 3.0, dOut + 3.0, d));
    if (part > 0.5) s *= step(hb, heads * (type < 0.5 ? 0.9 : 0.85));   // culms (~1/3 of blades): none in winter
    // Distance LOD (collapsed triangles never reach the tiler, and sub-pixel triangles are what
    // this GPU pays for): main-tier clumps thin to 40% from 30 to 80 m, leaves to half from 25 to
    // 50 m, awns go once sub-pixel. The grazing view keeps the far band looking full regardless.
    // Far blades are NOT widened: tried, and the fattened blades cost ~4 ms of overdraw.
    if (iVar.w < 1.5) s *= step(h11(seed * 41.3), mix(1.0, 0.4, smoothstep(30.0, 80.0, d)));
    if (part > 2.5) s *= step(d, 25.0 + 10.0 * hb);
    if (part < 0.5) s *= step(hb, mix(1.0, 0.5, smoothstep(25.0, 50.0, d)));
    if (s < 0.01 || offscreen(iPos.xyz, 0.6 * max(iVar.y, iVar.x))) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    vec3 p = position;
    // Per blade per clump: height and a lean, so one clump mesh never repeats exactly.
    p.y *= (0.75 + 0.5 * h11(seed * 13.7 + br * 57.1)) * (part < 0.5 ? leafScale : 1.0);
    float la = h11(seed * 3.1 + br * 7.9) * 6.2832;
    p.xz += vec2(cos(la), sin(la)) * t * t * 0.07;
    float H = iVar.y * heightScale;
    p.xz *= iVar.x * mix(0.8, 1.0, heightScale);
    p.y *= H;
    vec3 w = vec3(yawRot(p.xz, iPos.w), p.y).xzy;
    vec3 n = vec3(yawRot(normal.xz, iPos.w), normal.y).xzy;
    vec2 cs = tiltCS(iPos.xyz); w = tilt(w, iPos.xyz, cs); n = tilt(n, iPos.xyz, cs);
    // Wind: bend grows with t^2 so the root stays put; blades differ in stiffness and flutter.
    float g = gust(iPos.xz);
    float b = windStrength * g * (0.75 + 0.5 * h11(br * 3.7 + seed));
    float fl = sin(time * (4.0 + 3.0 * hb) + br * 40.0 + iPos.x * 0.6) * (0.025 + 0.045 * g);
    vec2 off = (windDir * b + vec2(-windDir.y, windDir.x) * fl) * t * t * max(H, 0.2);
    w.xz += off; w.y -= 0.5 * dot(off, off) / max(H, 0.2) * t;   // roughly keep the blade's length
    vec3 wp = iPos.xyz + w;
    // papery glumes and awns glow against the sun
    vec3 alb = groundMatch(grassAlbedo(type, t, part, br, seed, iPos.xz), type, iPos.xyz, smoothstep(12.0, 45.0, d));
    vColor = grassShade(alb, n, wp, t, mix(0.35, 1.0, smoothstep(0.0, 0.7, t)) * skyOcc(iPos.xyz), part > 1.5 ? 1.6 : 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
const NEAR_FRAG = /* glsl */`
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const MID_VERT = /* glsl */`
  ${COMMON_VERT}
  ${SHADE_VERT}
  attribute float aPetal;
  varying vec2 vUv; varying float vKey; varying float vType; varying vec3 vColor; varying vec3 vHead; varying float vFade;
  void main() {
    float seed = iVar.z, type = iVar.w;
    float d = distance(cameraPosition, iPos.xyz);
    float dIn = mix(midIn.x, midIn.y, h11(seed * 517.3 + 0.37));
    float grow = smoothstep(dIn - 3.0, dIn + 3.0, d);
    // Thin out with distance (survivors widen to keep the cover) and end at midEnd.
    float keep = mix(1.0, 0.4, smoothstep(110.0, 220.0, d)) * (1.0 - smoothstep(midEnd - 35.0, midEnd, d));
    // Both fades are alpha only (dithered in the fragment shader): a tuft is drawn at full height or not.
    float s = grow * clamp((keep - h11(seed * 91.3 + 0.71)) / 0.06, 0.0, 1.0);
    if (s < 0.01 || offscreen(iPos.xyz, 0.6 * max(iVar.y, iVar.x) * 1.6)) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    float bunch = step(0.5, type);
    float H = iVar.y * heightScale * mix(0.62, 0.42, bunch);
    vec3 p = position;
    p.xz *= iVar.x * mix(0.6, 0.5, bunch) * mix(1.0, inversesqrt(max(keep, 0.4)), 0.5);
    p.y *= H;
    vFade = s;
    vec3 w = vec3(yawRot(p.xz, iPos.w), p.y).xzy;
    vec3 n = vec3(yawRot(normal.xz, iPos.w), normal.y).xzy;
    vec2 cs = tiltCS(iPos.xyz); w = tilt(w, iPos.xyz, cs); n = tilt(n, iPos.xyz, cs);
    vec2 off = windDir * windStrength * gust(iPos.xz) * uv.y * uv.y * max(H, 0.2);
    w.xz += off; w.y -= 0.5 * dot(off, off) / max(H, 0.2) * uv.y;
    vec3 wp = iPos.xyz + w;
    vUv = uv; vKey = seed * 31.7 + aPetal * 3.1; vType = type;
    float occ = skyOcc(iPos.xyz);
    vec3 leafC = grassShade(groundMatch(grassAlbedo(type, uv.y, 0.0, aPetal * 0.21 + 0.05, seed, iPos.xz), type, iPos.xyz, 1.0), n, wp, uv.y, mix(0.35, 1.0, uv.y) * occ, 1.0);
    vHead = grassShade(groundMatch(grassAlbedo(type, 1.0, bunch > 0.5 ? 3.0 : 2.0, 0.5, seed, iPos.xz), type, iPos.xyz, 0.6), n, wp, 1.0, occ, 1.6);
    // bunch tufts in flower: the awns tint the top of the tuft
    vColor = mix(leafC, vHead, uv.y * uv.y * 0.6 * heads * bunch);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
const MID_FRAG = /* glsl */`
  uniform float heads;
  varying vec2 vUv; varying float vKey; varying float vType; varying vec3 vColor; varying vec3 vHead; varying float vFade;
  float hf(float n) { return fract(sin(n) * 43758.5453123); }
  void main() {
    // Distance fades: screen-space dither (the interleaved gradient noise the tree tiers use).
    if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vFade) discard;
    // Seven thin blades fanning out of each card (about as wide as the near blades, so the two
    // LODs give the same sub-pixel cover from above); on annual tufts some carry a seed head.
    // Coverage per blade is limited by its width over the pixel's: a blade narrower than a pixel
    // must not paint the whole pixel, or far tufts turn into opaque blobs.
    float bunch = step(0.5, vType), aa = max(fwidth(vUv.x), 1e-4), a1 = 0.0, a2 = 0.0;
    for (int k = 0; k < 7; k++) {
      float fk = float(k), r = hf(vKey + fk * 7.31);
      float hk = mix(0.5 + 0.5 * r, 0.45 + 0.4 * r, bunch);
      float x0 = (fk + 0.5) / 7.0 + (r - 0.5) * 0.1;
      float xc = x0 + (x0 - 0.5) * vUv.y * mix(0.5, 0.9, bunch) + (r - 0.5) * 0.25 * vUv.y * vUv.y;
      float hw = 0.018 * (1.0 - vUv.y / hk);
      a1 = max(a1, clamp((hw - abs(vUv.x - xc)) / aa + 0.5, 0.0, 1.0) * min(1.0, 2.0 * hw / aa));
      if (heads > 0.5 && bunch < 0.5 && r > 0.6) {
        a1 = max(a1, clamp((0.008 - abs(vUv.x - x0 - (x0 - 0.5) * vUv.y * 0.35)) / aa + 0.5, 0.0, 1.0) * min(1.0, 0.016 / aa) * step(vUv.y, 0.8));
        vec2 q = (vUv - vec2(x0 + (x0 - 0.5) * 0.3, 0.86)) / vec2(0.03, 0.1);
        a2 = max(a2, clamp((1.0 - length(q)) * 0.03 / aa + 0.5, 0.0, 1.0) * min(1.0, 0.06 / aa));
      }
    }
    float alpha = max(a1, a2);
    if (alpha < 0.04) discard;
    gl_FragColor = vec4(a2 > a1 ? vHead : vColor, alpha);   // alpha drives MSAA coverage
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// ---- placement helpers ----------------------------------------------------------------------
function hash2(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// Field for bare patches (gopher workings, rock, trails), 11 m and 4 m: a few metres across, not
// the 30 m bald spots a coarser field gave.
const bareField = (x, n) => 0.6 * vnoise(x / 11, n / 11, 3) + 0.4 * vnoise(x / 4, n / 4, 4);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Ground height on the rendered terrain mesh (Terrain's default 10 chunks of ~10 m quads, split
// NW-SE as PlaneGeometry does), so roots sit exactly on the triangles rather than the heightfield.
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

function seasonOf(look) {
  let best = 'summer', bd = Infinity;
  for (const [k, v] of Object.entries(SEASON_LOOK)) {
    if (v === look) return k;
    const d = v.grass.reduce((s, c, i) => s + (c - look.grass[i]) ** 2, 0);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

export class Grass {
  // cap: mid-LOD tuft capacity (the near blade meshes stage up to 90k each, the ground tier's 50k).
  constructor(tile, scene, cap = 64000) {
    this.tile = tile; this.nearCap = 90000; this.groundCap = 50000; this.midCap = cap;
    this.ground = terrainHeight(tile);
    this.last = { near: null, ground: null, mid: null }; this.lookKey = '';
    this.cache = LAYERS.map(() => new Map());   // per layer: cell index -> instance groups
    this.queue = new Map(); this.dirty = { near: false, ground: false, mid: false };   // cells waiting to be generated; pools to refill
    this.buildDensityGrid();
    const col = () => new THREE.Color();
    this.uniforms = {
      ...windUniforms, ...groundUniforms, groundK: { value: 1.12 }, matchOn: { value: 1 }, tiltOn: { value: 1 },
      nearFade: { value: new THREE.Vector2(...NEAR_FADE) }, closeFade: { value: new THREE.Vector2(...CLOSE_FADE) },
      groundFade: { value: new THREE.Vector2(...GROUND_FADE) }, midIn: { value: new THREE.Vector2(...MID_IN) }, midEnd: { value: MID_END },
      heightScale: { value: 1 }, heads: { value: 1 }, thatch: { value: 0 }, leafScale: { value: 1 }, dry: { value: 1 },
      aRoot: { value: col() }, aTip: { value: col() }, aHead: { value: col() }, aAwn: { value: col() },
      bRoot: { value: col() }, bTip: { value: col() }, bHead: { value: col() }, bAwn: { value: col() },
      thatchCol: { value: col().setRGB(...THATCH, THREE.SRGBColorSpace) },
      ...atmo,
    };
    const nearMat = new THREE.ShaderMaterial({ vertexShader: NEAR_VERT, fragmentShader: NEAR_FRAG, uniforms: this.uniforms, side: THREE.DoubleSide });
    const midMat = new THREE.ShaderMaterial({ vertexShader: MID_VERT, fragmentShader: MID_FRAG, uniforms: this.uniforms, side: THREE.DoubleSide, alphaToCoverage: true });
    // Visible distance per tier (indexed by tier; update moves the main tier's with height).
    const nearBands = [[0, NEAR_FADE[1] + 3], [0, CLOSE_FADE[1] + 3]], groundBands = [null, null, [0, GROUND_FADE[1] + 3]];
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._inv = new THREE.Matrix4(); this._sphere = new THREE.Sphere(); this._pick = [];
    const annualGeo = buildAnnualClump(), bunchGeo = buildBunchClump();
    this.sets = {
      annual: this.makeSet(annualGeo, nearMat, this.nearCap, nearBands),
      bunch: this.makeSet(bunchGeo, nearMat, this.nearCap, nearBands),
      groundA: this.makeSet(annualGeo, nearMat, this.groundCap, groundBands),
      groundB: this.makeSet(bunchGeo, nearMat, this.groundCap, groundBands),
      mid: this.makeSet(buildTuft(), midMat, this.midCap, [[MID_IN[0] - 3, MID_END]]),
    };
    this.group = new THREE.Group(); this.group.name = 'grass';
    for (const s of Object.values(this.sets)) this.group.add(s.mesh);
    scene.add(this.group);
    // Chaparral's closed shrub canopy, and grass clumps for the 12-140 m band (shrubfield.js).
    this.shrubs = ShrubField(tile, this.ground, this.uniforms);
    this.clumps = GrassClumps(tile, this.ground, this.uniforms, this.dens, (x, n) => this.swardDensity(x, n),
      (x, n) => (HABITAT[tile.habitat.at(x, n)] || { annual: 0.6 }).annual);
    // Dry wild oat stands above the cured sward in summer and fall (shrubfield.js).
    this.stalks = StalkClumps(tile, this.ground, this.uniforms, this.dens, (x, n) => this.swardDensity(x, n),
      (x, n) => (HABITAT[tile.habitat.at(x, n)] || { annual: 0.6 }).annual);
    this.group.add(this.shrubs.mesh, this.clumps.mesh, this.stalks.mesh);
    // Sward shells for the 8-60 m band (grassShells.js), at the density the clumps are placed with.
    this.shells = new GrassShells(tile, this.ground, (x, n) => this.swardDensity(x, n), {});
    this.group.add(this.shells.mesh);
    this.mesh = this.sets.mid.mesh;   // kept for debugging handles that used the old single mesh
  }
  // Instances placed (staged) and drawn this frame, per LOD.
  get counts() {
    const s = this.sets;
    return { nearPlaced: s.annual.staged + s.bunch.staged + s.groundA.staged + s.groundB.staged,
      nearDrawn: s.annual.n + s.bunch.n + s.groundA.n + s.groundB.n, annualDrawn: s.annual.n + s.groundA.n, bunchDrawn: s.bunch.n + s.groundB.n,
      groundDrawn: s.groundA.n + s.groundB.n, midPlaced: s.mid.staged, midDrawn: s.mid.n };
  }

  // An instanced mesh plus a CPU staging copy of every placed instance, grouped in blocks (one
  // per cell and tier). Each frame only the blocks in view and in their distance band are copied
  // to the GPU buffer: the cost is per instance submitted (every vertex runs, even when the shader
  // throws it away), so drawing the ~1/3 that can be seen is the main saving.
  makeSet(geo, material, cap, bands) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = geo.index;
    for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    g.setAttribute('iVar', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    g.instanceCount = 0;
    const mesh = new THREE.Mesh(g, material); mesh.frustumCulled = false; mesh.visible = false;
    return { mesh, buf, cap, bands, stage: new Float32Array(cap * STRIDE), blocks: [], staged: 0, n: 0, sig: NaN };
  }

  // Per-cell density (habitat factor x herb cover) and herb cover, sampled bilinearly between
  // cell centres so density and size change smoothly instead of in 30 m squares.
  buildDensityGrid() {
    const hab = this.tile.habitat, can = this.tile.canopy, W = hab.img.width, Hh = hab.img.height;
    this.W = W; this.Hh = Hh; this.dens = new Float32Array(W * Hh); this.herb = new Float32Array(W * Hh);
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      // herb floored at 0.3 as before: a 0 is more often a data gap (or an oak's shade) than bare dirt
      const h = Math.min(Math.max(can.channel(i, j, 2) / 100, 0.3), 1), k = j * W + i, hb = HABITAT[hab.channel(i, j, 0)];
      this.herb[k] = h; this.dens[k] = hb ? hb.dens * (0.6 + 0.4 * h) : 0;
    }
  }
  sample(grid, x, north) {
    const res = this.tile.habitat.res, u = x / res - 0.5, v = (this.tile.size - north) / res - 0.5;
    const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, W = this.W, H1 = this.Hh - 1;
    const i0 = Math.min(Math.max(i, 0), W - 1), i1 = Math.min(Math.max(i + 1, 0), W - 1);
    const r0 = Math.min(Math.max(j, 0), H1) * W, r1 = Math.min(Math.max(j + 1, 0), H1) * W;
    return (grid[r0 + i0] * (1 - fx) + grid[r0 + i1] * fx) * (1 - fy) + (grid[r1 + i0] * (1 - fx) + grid[r1 + i1] * fx) * fy;
  }

  // Grass density at a point as the clump placement sees it (habitat x herb cover, bare patches,
  // decayed pavement and its verge, none on ponds or in stream channels), for the shells, tussocks and oats.
  swardDensity(x, n) {
    const dens = this.sample(this.dens, x, n);
    if (dens <= 0 || waterAt(this.tile.waterMask, x, n) === 255) return 0;
    const herb = this.sample(this.herb, x, n), thr = 0.28 + 0.14 * (1 - herb), rw = this.tile.roads ? this.tile.roads.at(x, n) : 0;
    return Math.min(dens * smooth(thr - 0.1, thr + 0.1, bareField(x, n)) * (rw > 140 ? 0 : rw > 0 ? 0.5 : 1) * 1.15, 1);
  }

  // Instances of one cell for one layer, generated once and cached, sorted into groups by mesh
  // (annual, bunch; the mid layer has one) and by L.sub-metre block, each with a bounding sphere.
  cellData(i, j, layer) {
    const key = j * this.W + i, cache = this.cache[layer], L = LAYERS[layer], mid = !!L.mid;
    let groups = cache.get(key);
    if (groups) return groups;
    const { habitat: hab, size, roads, waterMask: wm } = this.tile, res = hab.res;
    let any = false;
    for (let dj = -1; dj <= 1 && !any; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < this.W && b < this.Hh && this.dens[b * this.W + a] > 0) { any = true; break; }
    }
    const ns = Math.max(1, Math.round(res / L.sub)), nb = ns * ns;
    const out = Array.from({ length: 2 * nb }, () => []);   // by type, then block; the mid layer uses type 0 only
    if (any) {
      const hb = HABITAT[hab.channel(i, j, 0)], annualShare = hb ? hb.annual : 0.6;
      const n = Math.round(res * res * L.perM2), tier = L.tier;   // tier: 0 main, 1 close, 2 ground
      const rnd = mulberry32((i * 92821) ^ (j * 68917) ^ L.salt);
      for (let k = 0; k < n; k++) {
        const ux = rnd(), uy = rnd(), px = (i + ux) * res, pn = size - (j + uy) * res;
        const keep = rnd(), yaw = rnd() * Math.PI * 2, sv = rnd(), sj = rnd(), type = rnd() < annualShare ? 0 : 1, seed = rnd(), verge = rnd();
        const dens = this.sample(this.dens, px, pn);
        if (keep >= dens) continue;
        // Decayed roads: no grass on the pavement, half density across the verge.
        const rw = roads ? roads.at(px, pn) : 0;
        if (rw > 140 || (rw > 0 && verge < 0.5)) continue;
        // None on ponds or in stream channels (the riparian band keeps its grass).
        if (wm && waterAt(wm, px, pn) === 255) continue;
        // Bare patches, more of them where herb cover is thin, thinning out over a feathered edge;
        // clumps also shorten toward them. The blade tiers keep 40% of their (shorter) clumps in a
        // patch: seen from the chase camera a few metres up, an empty patch (they are often 10-30 m
        // across) read as the grass vanishing around you rather than as thin ground. The tufts (and
        // the shells) still leave it open, so the patches show from the air as before.
        const herb = this.sample(this.herb, px, pn), bare = bareField(px, pn), thr = 0.28 + 0.14 * (1 - herb);
        const open = smooth(thr - 0.06, thr + 0.06, bare);
        if (keep >= dens * (mid ? open : 0.4 + 0.6 * open)) continue;
        const s = (0.75 + 0.5 * sv) * (0.7 + 0.45 * herb) * (0.6 + 0.4 * smooth(thr, thr + 0.15, bare));
        const blk = Math.min(Math.floor(uy * ns), ns - 1) * ns + Math.min(Math.floor(ux * ns), ns - 1);
        out[(mid ? 0 : type) * nb + blk].push(px, this.ground(px, pn), -pn, yaw, s * (0.85 + 0.3 * sj), s, seed, type + 2 * tier);
      }
    }
    groups = [];
    out.forEach((a, g) => {
      if (!a.length) return;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, sy = 0;
      for (let o = 0; o < a.length; o += STRIDE) {
        x0 = Math.min(x0, a[o]); x1 = Math.max(x1, a[o]); y0 = Math.min(y0, a[o + 1]); y1 = Math.max(y1, a[o + 1]);
        z0 = Math.min(z0, a[o + 2]); z1 = Math.max(z1, a[o + 2]); sy = Math.max(sy, a[o + 5]);
      }
      const h = 1.2 * sy + 0.3;   // grass height above the highest root
      groups.push({ mesh: Math.floor(g / nb), tier: L.tier, data: new Float32Array(a), x: (x0 + x1) / 2, y: (y0 + y1 + h) / 2, z: (z0 + z1) / 2,
        r: Math.hypot((x1 - x0) / 2 + 0.6, (y1 - y0 + h) / 2, (z1 - z0) / 2 + 0.6) });
    });
    if (cache.size > (mid ? 3000 : 400)) cache.clear();   // bounded at a few tens of MB
    cache.set(key, groups);
    return groups;
  }

  // Cells within r of (x, north), nearest first, so a full buffer drops the farthest.
  cellsAround(x, north, r) {
    const hab = this.tile.habitat, res = hab.res, size = this.tile.size, cells = [];
    const i0 = Math.max(0, Math.floor((x - r) / res)), i1 = Math.min(this.W - 1, Math.floor((x + r) / res));
    const j0 = Math.max(0, Math.floor((size - north - r) / res)), j1 = Math.min(this.Hh - 1, Math.floor((size - north + r) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * res, cn = size - (j + 0.5) * res, d = Math.hypot(cx - x, cn - north);
      if (d <= r + res * 0.71) cells.push([d, i, j]);
    }
    return cells.sort((a, b) => a[0] - b[0]);
  }

  // Stage one pool's layers around (x, north), each out to its own placement radius, nearest cell
  // first, one block per cell group (blocks wholly outside the radius are skipped): plain copies, so
  // a refill costs no per-instance work. Cells not yet generated are made now if they are visible,
  // else queued (see update).
  fill(x, north, pool) {
    const P = POOLS[pool], targets = P.sets.map(k => this.sets[k]), half = this.tile.habitat.res * 0.71, layers = P.layers;
    for (const t of targets) { t.staged = 0; t.blocks.length = 0; t.sig = NaN; }
    for (const [k, q] of this.queue) if (layers.includes(q[2])) this.queue.delete(k);   // re-queued below if still wanted
    for (const [d, i, j] of this.cellsAround(x, north, P.place)) {
      for (const layer of layers) {
        const L = LAYERS[layer];
        if (d - half > L.place) continue;
        const key = j * this.W + i;
        if (!this.cache[layer].has(key) && d - half > L.now) { this.queue.set(layer * 1e7 + key, [i, j, layer]); continue; }
        for (const g of this.cellData(i, j, layer)) {
          if (Math.hypot(g.x - x, g.z + north) - g.r > L.place) continue;
          const t = targets[g.mesh], n = g.data.length / STRIDE;
          if (t.staged + n > t.cap) continue;
          t.stage.set(g.data, t.staged * STRIDE);
          t.blocks.push({ x: g.x, y: g.y, z: g.z, r: g.r, tier: g.tier, start: t.staged, count: n });
          t.staged += n;
        }
      }
    }
  }

  // Generate queued cells for up to `budget` ms, then mark their pools for a refill. The budget is
  // checked after each cell, and a ground-tier cell takes ~2 ms, so 2 ms means one such cell a frame.
  drain(budget = 2) {
    const t0 = performance.now();
    for (const [k, [i, j, layer]] of this.queue) {
      this.queue.delete(k);
      if (this.cache[layer].has(j * this.W + i)) continue;
      this.cellData(i, j, layer); this.dirty[LAYERS[layer].pool] = true;
      if (performance.now() - t0 > budget) break;
    }
  }

  // Copy the blocks in view and inside their distance band to the GPU buffer.
  cull(camera) {
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, this._inv.copy(camera.matrixWorld).invert());
    this._frustum.setFromProjectionMatrix(this._m);
    const cp = camera.position, sph = this._sphere;
    for (const set of Object.values(this.sets)) {
      if (!set.mesh.visible) continue;
      const pick = this._pick; pick.length = 0; let sig = 0;
      for (let b = 0; b < set.blocks.length; b++) {
        const k = set.blocks[b], band = set.bands[k.tier], d = Math.hypot(k.x - cp.x, k.y - cp.y, k.z - cp.z);
        if (d + k.r < band[0] || d - k.r > band[1]) continue;
        sph.center.set(k.x, k.y, k.z); sph.radius = k.r;
        if (!this._frustum.intersectsSphere(sph)) continue;
        pick.push(k); sig = (Math.imul(sig, 31) + b + 1) | 0;
      }
      if (sig === set.sig) continue;
      set.sig = sig; let n = 0;
      for (const k of pick) { set.buf.array.set(set.stage.subarray(k.start * STRIDE, (k.start + k.count) * STRIDE), n * STRIDE); n += k.count; }
      set.n = n; set.mesh.geometry.instanceCount = n;
      set.buf.clearUpdateRanges(); set.buf.addUpdateRange(0, Math.max(n, 1) * STRIDE); set.buf.needsUpdate = true;
    }
  }

  applyLook(look) {
    const season = seasonOf(look), P = PALETTE[season], ref = SEASON_LOOK[season].grass, u = this.uniforms;
    const k = look.grass.map((v, i) => Math.min(Math.max(v / ref[i], 0.6), 1.6));   // the tint sets the overall tone
    const set = (uni, rgb) => uni.value.setRGB(rgb[0] * k[0], rgb[1] * k[1], rgb[2] * k[2], THREE.SRGBColorSpace);
    set(u.aRoot, P.annual.root); set(u.aTip, P.annual.tip); set(u.aHead, P.annual.head); set(u.aAwn, P.annual.awn);
    set(u.bRoot, P.bunch.root); set(u.bTip, P.bunch.tip); set(u.bHead, P.bunch.head); set(u.bAwn, P.bunch.awn);
    u.heightScale.value = P.height; u.heads.value = P.heads; u.thatch.value = P.thatch; u.leafScale.value = P.leaf; u.dry.value = P.dry;
    this.season = season;
  }

  // x, z (the flight position) are kept for the caller's signature; the camera position is used.
  update(x, z, dt, camera, look) {
    this.uniforms.time.value += dt;
    const key = look.grass.join(',') + (look === SEASON_LOOK[this.season] ? '' : '?');
    if (key !== this.lookKey) { this.lookKey = key; this.applyLook(look); }
    const cp = camera.position, north = -cp.z, agl = cp.y - this.ground(cp.x, north);
    // From the air the blade clumps are sub-pixel and the shells and tussocks carry the sward, so the
    // blades hand over nearer the camera the higher it is: 55-85 m below 8 m, 30-45 m from 28 m up
    // (the tufts have dithered in by 38 m at every height, so no gap opens).
    const k = this.altLod === false ? 0 : smooth(8, 28, agl), nf = this.uniforms.nearFade.value;   // altLod: false for A/B timing
    nf.set(NEAR_FADE[0] + (30 - NEAR_FADE[0]) * k, NEAR_FADE[1] + (45 - NEAR_FADE[1]) * k);
    this.sets.annual.bands[0][1] = nf.y + 3;
    // The ground tier is for the low chase camera looking down at the ring around it; once the shells
    // carry the sward (camera 10 m up and more) it is mostly under them, so it thins out blade by
    // blade from the camera outward over 8-14 m and is off above that.
    const gk = 1 - smooth(8, 14, agl);
    this.uniforms.groundFade.value.set(GROUND_FADE[0] * gk, GROUND_FADE[1] * gk);
    const on = { near: agl < nf.y + 3, ground: agl < 14, mid: agl < MID_END };
    if (this.queue.size) this.drain();
    for (const pool of ['near', 'ground', 'mid']) {
      if (!on[pool]) continue;
      const last = this.last[pool], move = !last || Math.hypot(cp.x - last[0], north - last[1]) > POOLS[pool].rebuild;
      if (!move && !this.dirty[pool]) continue;
      if (move) this.last[pool] = [cp.x, north];
      this.dirty[pool] = false;
      this.fill(this.last[pool][0], this.last[pool][1], pool);
    }
    const S = this.sets;
    for (const [pool, P] of Object.entries(POOLS)) for (const k of P.sets) S[k].mesh.visible = on[pool] && S[k].staged > 0;
    this.cull(camera);
    for (const set of Object.values(S)) if (set.n === 0) set.mesh.visible = false;
    // Shrub impostors: drawn to within 3-8 m of the camera at every height. The 3D shrubs of
    // vegetation.js are a few per 30 m cell (~6% cover against the 30-85% canopy shrub cover the
    // impostors fill to), so handing the near field over to them below 8 m (as this once did, at
    // 25-40 m) emptied a disc around the camera: the stand sank away as you came down to it.
    this.shrubs.update(camera, true, null);
    // The tussock and oat impostors' near edges move with height over 6-10 m (it was a hard switch at
    // 8 m); every fade is a dither, so a moving edge thins plants, it never resizes them.
    const up = smooth(6, 10, agl), mixB = (low, high) => [low[0] + (high[0] - low[0]) * up, low[1] + (high[1] - low[1]) * up, high[2], high[3]];
    // Tussock impostors: from 12 m when seen from the air (low down the blade clumps and the tufts carry
    // the near field; a tussock impostor nearer than ~40 m to a low camera reads as a cotton ball) out
    // to 225 m, so the sward keeps a grain from 60-200 m up. Wild oat stands likewise, while the grass
    // is cured.
    const cb = CLUMP_BAND, sb = STALK_BAND;
    this.clumps.update(camera, agl < cb[3], mixB([45, 60], cb));
    this.stalks.update(camera, agl < sb[3] && this.uniforms.dry.value > 0.3, mixB([30, 45], sb));
    this.shells.update(camera, agl, this.uniforms.heightScale.value);
  }
}
