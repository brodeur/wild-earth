import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { SEASON_LOOK } from './season.js';
import { buildAnnualClump, buildBunchClump, buildTussockClump, buildOatClump, buildSwardClump } from './grassBlades.js';
import { windUniforms, WIND_GLSL } from './wind.js';
import { groundUniforms, GROUND_GLSL, seasonState } from './terrain.js';
import { ShrubField, ClumpField, KIND, waterAt, shrubLeaves } from './shrubfield.js';
import { GrassShells } from './grassShells.js';
import { rockKeep } from './tilepackage.js';
import { bodyScale, onBodyScale } from './bodyScale.js';

// Grass in the Sierra foothill savanna: non-native annuals (wild oat, bromes, medusahead) over
// purple needlegrass bunchgrass. One population of plants, drawn two ways:
//   blades (to ~85 m): instanced clumps of real blade geometry, one mesh per type (annual, bunch),
//                    in three tiers that read nested rank ranges of the same placement: every plant
//                    within ~16 m (the ground tier, its own pair of meshes, refilled more often), the
//                    lowest 41% of ranks to 16-30 m (close), the lowest 5.5% to 55-85 m (main);
//   impostors (to 250 m): some plants also carry a card, a baked picture of their own blade clump
//                    (bake): annual tufts (the lowest ranks of the annuals), needlegrass tussocks (the
//                    lowest 22% of the bunchgrass, drawn as full tussocks) and wild oats (annuals in
//                    oat stands, with tall nodding panicles). Three ClumpFields (shrubfield.js) with
//                    their own shader; the tussock and oat plants' blade clumps have their own meshes.
// A card and its blade clump are the same plant (position, type, size, yaw, seed): each plant has one
// hand-over distance, where its blades thin out blade by blade as its card dithers in, in place (tufts
// at 26-38 m low down, 9-15 m from the air; tussocks and oats at 6-12 m at every height). A plant
// without a card thins out at its tier's band edge as before (density LOD). Nothing changes size in a
// fade: a scaled fade reads as plants growing out of the ground and sinking back into it.
// Placement is deterministic per 30 m habitat cell (candidate k of a cell is a pure function of the
// cell and k) and cached, so nothing re-rolls as you move; each frame only the cells in view are
// submitted to the GPU (see cull). Past 250 m the ground texture carries the sward.
// Seen from the air (docs/grass-notes.md) the sward shells (8-60 m up, grassShells.js) and the
// chaparral shrub impostors (shrubfield.js) hang off this class too.
// Every grass material takes its colour from the ground texture under it (terrain.js GROUND_GLSL)
// and moves with the shared gust field (wind.js), which the terrain also paints as a sheen.
// The body tier (2026-10-28): the tiers above are tuned for a chase camera 3-5 m up, and to a lizard or a vole (its
// eye a few cm up, its chase camera ~0.3 m) the ground tier's 8 plants per m^2 read as sparse stalks on a blurred photo, where the
// real sward is blades 2-5 cm apart. So under a small body (bodyScale.js, scale below BODY_MAX = 0.6: lizard,
// vole, ground squirrel, rabbits, fox; never a deer, lion, bear, coyote, turkey, the spirit or a flier, whose
// frame is exactly what it was) a ring of blades at real density follows the camera: radius
// 16 sqrt(scale) m clamped to 1.5-10 m (lizard 2.6, vole 3.3, rabbit 6.4, fox 10), thinning blade by blade
// over its outer quarter. Its unit is a young tiller clump of 3-6 leaves (grassBlades.js buildSwardClump: real
// sizes, tapered, rolled and twisted, normals rounded across each blade), annual or needlegrass by the same
// share and drifts as the plants, placed on a jittered 6.7 cm grid (225 clumps, ~1000 blades per m^2 on open
// grassland) thinned by the habitat's density, herb cover, outcrops, roads, water and the bare patches as the
// plants are, sized by the season's height like the other tiers. It has its own hashed placement, cached per
// 2 m cell (a pure function of the world position: every client sees the same blades) and sorted by rank, so
// any prefix of a cell is an even subsample: a 10 m ring for the fox would stage ~115 k clumps, so the ring is
// staged at BODY_CAP / its area (a lizard's and a rabbit's whole, a fox's about half). Cells
// within half the radius are made at once, the rest of the ring queued and made under 1 ms a frame, so moving
// never stalls a frame (a cell is ~0.2-0.4 ms). Inside terrain.js's micro patch (a few cm of relief under the body)
// the roots are re-seated on its surface as drawn, nearest first, in what is left of ~1.5 ms a frame (bodySeat).
// Its shader (BODY_VERT) is the near tier's: the palette's root-to-tip ramp, the ground match, wind, sky
// occlusion and grassShade, with a share of grey dead leaves, paler drying tips and a deeper shade at the root.
// The tiers above draw on unchanged inside it: their culms and seed heads stand out of this sward. Measured
// 2026-10-28 (M-series, open grassland at 6960, 7032 on 680_4280): drawn after culling, lizard ~7.9 k clumps,
// vole ~10 k, rabbit ~21 k, fox ~20 k (of ~60 k staged); the tier's own draws, timed alone, 0.6 ms at the lizard,
// 0.7 at the vole, 1.2-1.3 at the rabbit and fox (best of 40; more under load).

const NEAR_FADE = [55, 85], NEAR_REBUILD = 25, NEAR_PLACE = NEAR_FADE[1] + NEAR_REBUILD + 2;
const MID_END = 250;
const NEAR_PER_M2 = 1 / 1.35, MID_PER_M2 = 1 / 4;
// Close tier: more clumps near the camera, where a 1.35 m^2 spacing reads as bare ground between
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
// Tuft cards hand over at 26-38 m, just past the close tier's band, whatever the blades do: the main
// tier alone (one clump per 1.35 m^2) is too thin to carry 30-55 m from a camera a few metres up.
const MID_IN = [26, 38], MID_IN_HIGH = [9, 15];   // seen from the air (6-10 m up and more) at 9-15 m
// Tussock and oat cards hand over at 6-12 m at every height, so the plants you see from the air are
// the plants around you when you land.
const IMP_IN = [6, 12], IMP_W = 1.5, TUFT_W = 3;
// Body tier (see the header): on below BODY_MAX scale; BODY_CELL m cells of BODY_G x BODY_G candidates; at most
// BODY_CAP clumps staged; the ring's radius from the scale.
const BODY_MAX = 0.6, BODY_CELL = 2, BODY_G = 30, BODY_CAP = 60000, BODY_TIER = 3, BODY_LN = 5;
const bodyRadius = s => Math.min(Math.max(16 * Math.sqrt(s), 1.5), 10);

// ---- one placement per cell, read by every tier -----------------------------------------------
// A cell holds N = 900 m^2 x P_TOTAL candidate plants, candidate k with rank (k + 0.5) / N. Each tier
// reads a rank range: ground all, close the lowest R_CLOSE, main the lowest R_MAIN; the impostor
// fields read the plants given a card (`role`): tufts are annuals ranked below R_TUFT, tussocks
// bunchgrass below R_TUS, oats annuals in [R_TUFT, R_TUFT + OAT_K x stand). A role plant is always a
// main- or close-tier plant, so its blade clump exists at its hand-over distance.
const P_TOTAL = CLOSE_PER_M2 + GROUND_PER_M2;                 // 13.6 plants per m^2 at full density
const R_MAIN = NEAR_PER_M2 / P_TOTAL, R_CLOSE = CLOSE_PER_M2 / P_TOTAL;
const R_TUFT = MID_PER_M2 / 0.75 / P_TOTAL;                    // ~0.25 tufts / m^2 where 3/4 of the grass is annual
// Tussocks: 0.6 x the needlegrass share as cover of 0.27 m crowns (the old GrassClumps density, x1.15
// for the sward density it was placed with); oats: up to 0.37 x the annual share as cover of 0.32 m stands.
const R_TUS = 1.15 * 0.6 / (Math.PI * 0.27 ** 2) / P_TOTAL;
const OAT_K = 1.15 / (Math.PI * 0.32 ** 2) / P_TOTAL, R_OAT_END = R_TUFT + OAT_K * 0.37;
const ROLE = { none: 0, tuft: 1, tussock: 2, oat: 3 };
// A card's quad is its clump's full reach (bake box R, H); the instance carries the dense leaf mass,
// CARD_RK and CARD_HK of that, which shadows.js casts its contact-shadow ellipse from.
const CARD_RK = 0.5, CARD_HK = 0.65;
// Placement layers of the blade tiers, each cached per cell. `r`: rank range. `now`: a cell nearer
// than this is visible already and is generated at once; farther ones (the new ring at the edge of the
// placement radius) are queued and built a few per frame, so flying into new ground does not stall a
// frame. `place`: placement radius. `sub`: block size (m) a cell's instances are split into for
// culling (a 30 m cell block submitted ~2.4x the instances actually in view).
const LAYERS = [
  { r: [0, R_MAIN], tier: 0, now: NEAR_FADE[1] + 3, place: NEAR_PLACE, sub: 10, pool: 'near' },          // main
  { r: [R_MAIN, R_CLOSE], tier: 1, now: CLOSE_FADE[1] + 3, place: CLOSE_PLACE, sub: 10, pool: 'near' },  // close
  { r: [R_CLOSE, 1], tier: 2, now: GROUND_FADE[1] + 3, place: GROUND_PLACE, sub: 10, pool: 'ground' },    // ground
];
// Refill pools: each restages its own meshes (by type) from its layers when the camera has moved
// `rebuild` metres from where it last filled, out to `place`.
const POOLS = {
  near: { layers: [0, 1], sets: ['annual', 'bunch', 'tussock', 'oat'], rebuild: NEAR_REBUILD, place: NEAR_PLACE },
  ground: { layers: [2], sets: ['groundA', 'groundB'], rebuild: GROUND_REBUILD, place: GROUND_PLACE },
};
// Habitat class -> relative density and the annual share (the rest is needlegrass).
const HABITAT = { 5: { dens: 1.0, annual: 0.75 }, 1: { dens: 0.5, annual: 0.55 }, 6: { dens: 0.12, annual: 0.5 } };
const WET_MEADOW_ANNUAL = 0.4;   // annual share on a rewilded lakebed or stock-pond floor (annualAt)
// per instance: x, y, z, yaw | scale xz, scale y, seed, type + 2 * tier + 8 * role
// (type 0 annual, 1 bunch; tier 0 main, 1 close, 2 ground; role ROLE)
const STRIDE = 8;

// Impostor atlas: every card kind baked from its blade clump, 8 azimuths x 5 elevations x 2 variants.
// Kinds (atlas row blocks): 0 needlegrass tussock, 1 annual (tufts), 2 wild oat.
const IMP = { T: 128, AZ: 8, EL: 5, VAR: 2, KINDS: 3, EL_STEP: 16 * Math.PI / 180, MARGIN: 124 / 128 };
IMP.TX = IMP.AZ * IMP.VAR; IMP.TY = IMP.EL * IMP.KINDS;

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
  uniform vec2 nearFade; uniform vec2 closeFade; uniform vec2 groundFade; uniform vec2 midIn; uniform vec2 impIn; uniform float impW;
  uniform float groundK; uniform float matchOn; uniform float tiltOn;
  uniform float heightScale; uniform float heads; uniform float thatch; uniform float leafScale; uniform float dry;
  uniform vec3 aRoot; uniform vec3 aTip; uniform vec3 aHead; uniform vec3 aAwn;
  uniform vec3 bRoot; uniform vec3 bTip; uniform vec3 bHead; uniform vec3 bAwn; uniform vec3 thatchCol;
  attribute vec4 iPos; attribute vec4 iVar;   // blades: x y z yaw | scale xz, scale y, seed, code; cards: see IMP_VERT
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
  // so the far sward is the colour of the texture it hands over to. The photo is of the annual sward:
  // needlegrass is held a little darker and greyer than it (most in the dry season, when it stays
  // grey-green while the annuals cure gold; the old tussock impostors' factor), so the tussocks still
  // show from the air. Grassland (and grass under oaks) only.
  vec3 groundMatch(vec3 c, float type, vec3 root, float m) {
    if (matchOn < 0.5) return c;
    vec3 gw; vec3 g = groundAlbedo(root, 1.0, gw);
    float on = smoothstep(0.05, 0.4, gw.r + 0.5 * gw.g);
    if (on < 0.01) return c;
    vec2 guv = groundUv(root);
    vec3 gr = groundRecolour(textureLod(map, guv, 8.0).rgb, gw, guv, groundPave(guv, 8.0));
    vec3 local = c * clamp(g / max(gr, vec3(1e-3)), vec3(0.75), vec3(1.3));
    vec3 mean = type > 0.5 ? mix(bRoot, bTip, 0.6) : mix(aRoot, aTip, 0.6);
    float ml = dot(mean, G_LUMA), gl = dot(g, G_LUMA);
    g *= clamp(gl, 0.6 * ml, 1.5 * ml) / max(gl, 1e-4);   // the photo's dark smudges do not make black grass
    vec3 far = c / max(mean, vec3(1e-3)) * g * groundK;
    if (type > 0.5) far *= mix(vec3(0.9, 0.93, 0.95), vec3(0.77, 0.82, 0.82), dry);
    return mix(c, mix(local, far, m), on);
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
    albedo = mix(albedo, vec3(0.7, 0.73, 0.78), wxGround.z * mix(1.0, 0.55, t));   // lying snow (weather.js), the tips standing out of it
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
    float t = aBlade.x, br = aBlade.y, part = aBlade.z, seed = iVar.z;
    float role = floor(iVar.w / 8.0 + 0.01), code = iVar.w - 8.0 * role, type = mod(code, 2.0);
    float d = distance(cameraPosition, iPos.xyz);
    // Hand-over: the clump thins blade by blade over dOut +/- w (a stable threshold per blade), at
    // full height; no fragment discard, so the opaque blades keep their hidden-surface removal. A plant
    // with a card hands over to it at the card's own distance (IMP_VERT computes the same dOut), so
    // the card dithers in exactly as its blades thin out, in place; the rest at their tier's band.
    vec2 band = code > 3.5 ? groundFade : code > 1.5 ? closeFade : nearFade;
    float w = 3.0;
    bool hand = role > 0.5;
    if (hand) { band = role < 1.5 ? midIn : impIn; w = role < 1.5 ? ${TUFT_W.toFixed(1)} : impW; }
    float dOut = mix(band.x, band.y, h11(seed * 517.3 + 0.37));   // this clump's own hand-over distance
    // A plant with a card comes in one of the atlas's two geometry variants (its blade heights, leans
    // and which culms flower), so blades and card are the same clump; the rest vary freely.
    float gs = role > 0.5 ? (seed < 0.5 ? 0.25 : 0.75) : seed;
    float hb = h11(gs * 71.9 + br * 131.7);
    float s = step(h11(seed * 23.9 + br * 97.3), 1.0 - smoothstep(dOut - w, dOut + w, d));
    if (part > 0.5) s *= step(hb, heads * (type < 0.5 ? 0.9 : 0.85));   // culms (~1/3 of blades): none in winter
    // Distance LOD (collapsed triangles never reach the tiler, and sub-pixel triangles are what
    // this GPU pays for): main-tier clumps thin to 40% from 30 to 80 m, leaves to half from 25 to
    // 50 m, awns go once sub-pixel. The grazing view keeps the far band looking full regardless.
    // Far blades are NOT widened: tried, and the fattened blades cost ~4 ms of overdraw. A clump
    // handing over to its card stays whole until it does, so the two match.
    if (!hand) {
      if (code < 1.5) s *= step(h11(seed * 41.3), mix(1.0, 0.4, smoothstep(30.0, 80.0, d)));
      if (part > 2.5) s *= step(d, 25.0 + 10.0 * hb);
      if (part < 0.5) s *= step(hb, mix(1.0, 0.5, smoothstep(25.0, 50.0, d)));
    }
    if (s < 0.01 || offscreen(iPos.xyz, 0.6 * max(iVar.y, iVar.x))) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    vec3 p = position;
    // Per blade per clump: height and a lean, so one clump mesh never repeats exactly.
    p.y *= (0.75 + 0.5 * h11(gs * 13.7 + br * 57.1)) * (part < 0.5 ? leafScale : 1.0);
    float la = h11(gs * 3.1 + br * 7.9) * 6.2832;
    p.xz += vec2(cos(la), sin(la)) * t * t * 0.07;
    float H = iVar.y * heightScale;
    p.xz *= iVar.x * mix(0.8, 1.0, heightScale);
    p.y *= H;
    vec3 w3 = vec3(yawRot(p.xz, iPos.w), p.y).xzy;
    vec3 n = vec3(yawRot(normal.xz, iPos.w), normal.y).xzy;
    vec2 cs = tiltCS(iPos.xyz); w3 = tilt(w3, iPos.xyz, cs); n = tilt(n, iPos.xyz, cs);
    // Wind: bend grows with t^2 so the root stays put; blades differ in stiffness and flutter.
    float g = gust(iPos.xz);
    float b = windStrength * g * (0.75 + 0.5 * h11(br * 3.7 + seed));
    float fl = sin(time * (4.0 + 3.0 * hb) + br * 40.0 + iPos.x * 0.6) * (0.025 + 0.045 * g);
    vec2 off = (windDir * b + vec2(-windDir.y, windDir.x) * fl) * t * t * max(H, 0.2);
    w3.xz += off; w3.y -= 0.5 * dot(off, off) / max(H, 0.2) * t;   // roughly keep the blade's length
    vec3 wp = iPos.xyz + w3;
    // papery glumes and awns glow against the sun
    // groundMatch is linear in the colour, so a factor G. Last year's grey thatch takes only its
    // brightness far off: through the green mean's ratios it turned rust-red.
    float m = smoothstep(12.0, 45.0, d), th = part < 0.5 && h11(br * 17.3 + seed * 3.7) < thatch ? m : 0.0;
    vec3 G = groundMatch(vec3(1.0), type, iPos.xyz, m);
    vec3 alb = grassAlbedo(type, t, part, br, seed, iPos.xz) * mix(G, vec3(dot(G, G_LUMA)), th);
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

// The body tier's blades (header): NEAR_VERT's rules for a sward clump at real size. A clump keeps its first 3-6
// blades and thins out blade by blade (a stable threshold per blade) over bodyFade, the ring's outer quarter,
// measured across the ground from the camera. Each blade's normal leans toward its edge on either side (aBlade.w,
// aSide), so a flat strip shades as if round; the wind bends it in proportion to its own length; a share of the
// leaves are last year's grey dead ones, the tips pale as they dry, and the root sits in the shade of the sward.
const BODY_VERT = /* glsl */`
  ${COMMON_VERT}
  ${SHADE_VERT}
  uniform vec2 bodyFade;
  attribute vec4 aBlade; attribute vec3 aSide;   // t, blade random, blade index / 6, side | width direction
  varying vec3 vColor;
  void main() {
    float t = aBlade.x, br = aBlade.y, seed = iVar.z, type = mod(iVar.w, 2.0);
    float d = distance(cameraPosition.xz, iPos.xz);
    float nb = 3.0 + floor(4.0 * h11(seed * 5.31 + 0.2));
    float s = step(aBlade.z * 6.0, nb) * step(h11(seed * 23.9 + br * 97.3), 1.0 - smoothstep(bodyFade.x, bodyFade.y, d));
    float H = iVar.y * heightScale;
    if (s < 0.01 || offscreen(iPos.xyz, 0.3 * H + 0.05)) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    float hb = h11(seed * 71.9 + br * 131.7);
    vec3 p = position;
    p.y *= (0.7 + 0.6 * h11(seed * 13.7 + br * 57.1)) * leafScale;
    float la = h11(seed * 3.1 + br * 7.9) * 6.2832;
    p.xz += vec2(cos(la), sin(la)) * t * t * 0.02;
    p.xz *= iVar.x * mix(0.8, 1.0, heightScale);
    p.y *= H;
    vec3 w3 = vec3(yawRot(p.xz, iPos.w), p.y).xzy;
    vec3 n = vec3(yawRot(normal.xz, iPos.w), normal.y).xzy;
    vec3 sd = vec3(yawRot(aSide.xz, iPos.w), aSide.y).xzy;
    vec2 cs = tiltCS(iPos.xyz); w3 = tilt(w3, iPos.xyz, cs); n = tilt(n, iPos.xyz, cs); sd = tilt(sd, iPos.xyz, cs);
    float g = gust(iPos.xz);
    float b = windStrength * g * (0.75 + 0.5 * h11(br * 3.7 + seed));
    float L = 0.3 * max(H, 0.3);
    float fl = sin(time * (5.0 + 4.0 * hb) + br * 40.0 + iPos.x * 2.0) * (0.03 + 0.05 * g);
    vec2 off = (windDir * b + vec2(-windDir.y, windDir.x) * fl) * t * t * L;
    w3.xz += off; w3.y -= 0.5 * dot(off, off) / L * t;
    vec3 wp = iPos.xyz + w3;
    if (dot(n, cameraPosition - wp) < 0.0) n = -n;
    n = normalize(n + 0.6 * aBlade.w * sd);
    vec3 G = groundMatch(vec3(1.0), type, iPos.xyz, 0.0);
    vec3 alb = grassAlbedo(type, t, 0.0, br, seed, iPos.xz) * G;
    if (h11(br * 29.1 + seed * 5.9) < 0.1 + 0.5 * thatch) alb = thatchCol * mix(0.65, 1.0, t) * dot(G, G_LUMA);
    alb *= mix(vec3(1.0), vec3(1.12, 1.06, 0.84), 0.6 * smoothstep(0.7, 1.0, t) * hb);
    vColor = grassShade(alb, n, wp, t, mix(0.3, 1.0, smoothstep(0.0, 0.75, t)) * skyOcc(iPos.xyz), 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

// ---- cards: a baked picture of the plant's own blade clump -------------------------------------
// One camera-facing quad per plant (ClumpField instance layout: root x y z, R | H, seed, kind + yaw /
// 2pi, rank; R and H are the clump's bake box at this plant's scale). The quad samples the atlas at
// the four views nearest the one the camera has of this plant (azimuth in the plant's own frame, so
// it turns with the yaw of its blades; elevation less the lean the blades take away from the camera,
// since a leaning clump seen from above shows as the upright clump seen from lower down). The atlas
// holds coverage, the height along the blade (t) and the part (leaf, culm, head, awn), so the card is
// coloured and lit by the blades' own rules here: palette root to tip and seed heads, the per-clump
// and field variation, the ground match at this distance, sun, sky occlusion, light through the blades.
const IMP_VERT = /* glsl */`
  ${COMMON_VERT}
  ${SHADE_VERT}
  uniform vec2 kParams; uniform vec4 cardBand; uniform float bandW; uniform vec2 impKind;   // atlas kind, grass type
  // (the field's own band uniform is what shadows.js casts with: see update)
  varying vec2 vQ; varying vec4 vTile; varying vec2 vSV; varying float vWe; varying vec3 vF; varying vec3 vFth; varying vec3 vSun; varying float vDiff;
  varying vec2 vBack; varying vec3 vAmbG; varying vec3 vAmbS; varying vec3 vT; varying vec3 vIn; varying float vFade;
  void main() {
    float R = iPos.w * ${(1 / CARD_RK).toFixed(5)}, H = iVar.x * ${(1 / CARD_HK).toFixed(5)}, seed = iVar.y, rank = iVar.w, yaw = fract(iVar.z) * ${(2 * Math.PI / 0.999).toFixed(6)};
    float d = distance(cameraPosition, iPos.xyz);
    float keep = clamp(kParams.x * kParams.x / max(d * d, 1.0), kParams.y, 1.0);
    // In at the plant's own hand-over distance (the hash its blade clump uses), out past band.zw; both
    // dithered (vFade), never a size change. The density LOD's rank cut is dithered the same way.
    vec4 band = cardBand;
    float din = mix(band.x, band.y, h11(seed * 517.3 + 0.37)), dout = mix(band.z, band.w, h11(seed * 91.3 + 0.71));
    float wo = max(0.12 * (band.w - band.z), 0.4);
    float s = clamp((keep - rank) / 0.05, 0.0, 1.0) * smoothstep(din - bandW, din + bandW, d) * (1.0 - smoothstep(dout - wo, dout + wo, d));
    float grow = inversesqrt(keep);
    R *= mix(0.8, 1.0, heightScale) * grow; H *= heightScale * sqrt(grow);
    if (s < 0.01 || offscreen(iPos.xyz, 0.6 * max(R, H))) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    vFade = s;
    vec2 cs = tiltCS(iPos.xyz);
    vec3 C = iPos.xyz + tilt(vec3(0.0, 0.5 * H, 0.0), iPos.xyz, cs);
    vec3 toC = cameraPosition - C; float dC = max(length(toC), 1e-3); vec3 V = toC / dC;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), V) + vec3(1e-4, 0.0, 0.0)), up = cross(V, right);
    vec3 r = iPos.xyz - cameraPosition;
    float e = atan(-r.y, length(r.xz)), ee = clamp(e - clamp(e * 0.5, 0.0, 0.45) * tiltOn, 0.0, ${(IMP.EL_STEP * (IMP.EL - 1)).toFixed(5)});
    float hh = 0.5 * H * cos(ee) + R * sin(ee);
    float rf = ee / ${IMP.EL_STEP.toFixed(5)}, r0 = min(floor(rf), ${(IMP.EL - 2).toFixed(1)}), e0 = r0 * ${IMP.EL_STEP.toFixed(5)}, e1 = e0 + ${IMP.EL_STEP.toFixed(5)};
    vSV = vec2(hh / (0.5 * H * cos(e0) + R * sin(e0)), hh / (0.5 * H * cos(e1) + R * sin(e1))) * ${IMP.MARGIN.toFixed(5)};
    vec2 vl = yawRot(cameraPosition.xz - iPos.xz, -yaw);
    float af = mod(atan(vl.y, vl.x) / ${(Math.PI / 4).toFixed(6)} + 8.0, 8.0), c0 = min(floor(af), 7.0), v = step(0.5, seed) * 8.0;
    vTile = vec4(v + c0, v + mod(c0 + 1.0, 8.0), impKind.x * ${IMP.EL.toFixed(1)} + r0, af - c0);
    vWe = rf - r0;
    // Pulled toward the camera, shrunk to keep its size on screen, so neither the ground nor the sward
    // shells (a 0.3 m deep sward drawn from 7 m out once the camera is 6-10 m up) clip its lower half:
    // the leaf mass of a tussock is mostly under 0.3 m. The top sways with the gust as the blade tips do.
    vec2 q = position.xy; vQ = q;
    float pull = min(R + 0.3, 0.5 * dC);
    vec3 p = C + V * pull + (right * q.x * R + up * q.y * hh) * ((dC - pull) / dC);
    float tq = 0.5 + 0.5 * q.y;
    p.xz += windDir * windStrength * gust(iPos.xz) * tq * tq * H;
    // Colour: grassAlbedo's per-clump and field variation, and groundMatch (linear in the colour, so
    // a factor) at this distance, exactly as the blades take them.
    float type = impKind.y, v1 = h11(seed * 7.7 + 0.1), v2 = h11(seed * 3.3 + 1.0);
    vec3 F = mix(vec3(0.94, 1.02, 1.05), vec3(1.06, 0.99, 0.88), v1) * (0.86 + 0.26 * v2);
    F *= mix(vec3(0.95, 1.03, 1.0), vec3(1.06, 0.98, 0.9), vnoise(iPos.xz * 0.05)) * (0.92 + 0.16 * vnoise(iPos.xz * 0.13 + 7.0));
    float m = smoothstep(12.0, 45.0, d);
    vec3 G = groundMatch(vec3(1.0), type, iPos.xyz, m);
    vF = F * G; vFth = F * mix(G, vec3(dot(G, G_LUMA)), m);   // thatch: as NEAR_VERT
    // Light: grassShade's terms, with the blades' normals taken as the mean of a clump of upright
    // blades turned to face the camera (horizontal, toward it).
    float sunUp = smoothstep(-0.03, 0.08, sunDir.y);
    vec3 Nb = normalize(vec3(V.x, 0.0, V.z) + vec3(1e-4, 0.0, 0.0));
    vSun = sunLight * cloudShadow(C);
    vDiff = max(dot(normalize(Nb + vec3(0.0, 1.0, 0.0)), sunDir), 0.0);
    vBack = vec2(max(-dot(Nb, sunDir), 0.0) * 0.3, pow(max(dot(-V, sunDir), 0.0), 5.0) * 0.55) * sunUp;
    float occ = skyOcc(iPos.xyz);
    vAmbG = ambientGround * occ; vAmbS = ambientSky * occ;
    vIn = atmosphereApply(vec3(0.0), C, cameraPosition);
    vT = atmosphereApply(vec3(1.0), C, cameraPosition) - vIn;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const IMP_FRAG = /* glsl */`
  uniform sampler2D impAtlas; uniform vec2 impKind; uniform vec3 wxGround;
  uniform vec3 aRoot; uniform vec3 aTip; uniform vec3 aHead; uniform vec3 aAwn;
  uniform vec3 bRoot; uniform vec3 bTip; uniform vec3 bHead; uniform vec3 bAwn; uniform vec3 thatchCol;
  varying vec2 vQ; varying vec4 vTile; varying vec2 vSV; varying float vWe; varying vec3 vF; varying vec3 vFth; varying vec3 vSun; varying float vDiff;
  varying vec2 vBack; varying vec3 vAmbG; varying vec3 vAmbS; varying vec3 vT; varying vec3 vIn; varying float vFade;
  vec4 tap(float col, float row, vec2 uv) { return texture(impAtlas, (vec2(col, row) + clamp(uv, 0.0, 1.0)) * vec2(${(1 / IMP.TX).toFixed(6)}, ${(1 / IMP.TY).toFixed(6)})); }
  void main() {
    // Distance fades: screen-space dither (the interleaved gradient noise the tree tiers use).
    if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vFade) discard;
    float c0 = floor(vTile.x + 0.5), c1 = floor(vTile.y + 0.5), r0 = floor(vTile.z + 0.5), wa = clamp(vTile.w, 0.0, 1.0), we = clamp(vWe, 0.0, 1.0);
    float u = 0.5 + 0.5 * vQ.x * ${IMP.MARGIN.toFixed(5)};
    vec2 uv0 = vec2(u, 0.5 + 0.5 * vQ.y * vSV.x), uv1 = vec2(u, 0.5 + 0.5 * vQ.y * vSV.y);
    vec4 g = mix(mix(tap(c0, r0, uv0), tap(c1, r0, uv0), wa), mix(tap(c0, r0 + 1.0, uv1), tap(c1, r0 + 1.0, uv1), wa), we);
    // Far off, a clump's leaves are a fraction of a pixel wide and the mips average them into a faint
    // haze, where the real plant (hundreds of leaves, not the clump's dozens) still reads as a solid
    // tuft: coverage is built up with the minification, as if the clump had more leaves (the way
    // survivors of a thinned field are widened to hold the cover). None at the hand-over distances,
    // where the card shows its texels one to one and must match its blades.
    vec2 tx = vec2(u, uv0.y) * ${(IMP.T).toFixed(1)};
    float mip = log2(max(max(length(dFdx(tx)), length(dFdy(tx))), 1.0));
    float cov = 1.0 - pow(1.0 - clamp(g.g, 0.0, 1.0), 1.0 + 2.0 * clamp(mip - 0.7, 0.0, 3.0));
    if (cov < 0.04) discard;
    float gc = max(g.g, 1e-4), t = clamp(g.b / gc, 0.0, 1.0), part = clamp(g.a / gc * 3.0, 0.0, 3.0), th = clamp(g.r / gc, 0.0, 1.0);
    bool bunch = impKind.y > 0.5;
    vec3 root = bunch ? bRoot : aRoot, tip = bunch ? bTip : aTip, head = bunch ? bHead : aHead, awn = bunch ? bAwn : aAwn;
    vec3 leafC = mix(mix(root, tip, smoothstep(0.0, 0.9, t)) * vF, thatchCol * mix(0.75, 1.05, t) * vFth, th);
    vec3 culmC = mix(root, mix(tip, head, 0.6), smoothstep(0.1, 1.0, t)) * vF;
    vec3 c = part < 1.0 ? mix(leafC, culmC, part) : part < 2.0 ? mix(culmC, head * vF, part - 1.0) : mix(head, awn, part - 2.0) * vF;
    c = mix(c, vec3(0.7, 0.73, 0.78), wxGround.z * mix(1.0, 0.55, t));   // lying snow, as grassShade
    float glow = mix(1.0, 1.6, clamp(part - 1.0, 0.0, 1.0));
    vec3 trans = c * normalize(c + 1e-4) * 1.7;
    vec3 amb = mix(vAmbG, vAmbS, 0.3 + 0.6 * t) * mix(0.35, 1.0, smoothstep(0.0, 0.7, t));
    vec3 col = (c * (vSun * vDiff * mix(0.45, 1.0, t) + amb) + trans * vSun * (vBack.x + vBack.y * t) * glow) * 0.3183099;
    gl_FragColor = vec4(col * vT + vIn, cov);   // coverage drives MSAA alpha-to-coverage
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
// Bake: the blade clump with NEAR_VERT's own per-blade heights, leans, flowering culms and thatch for
// one geometry variant seed, seen orthographically from one view, written into its tile of a strip.
// Out: r thatch, g coverage, b t, a part / 3 (premultiplied by coverage through the MSAA resolve and the
// mips, so the card divides by g).
const BAKE_VERT = /* glsl */`
  uniform float bSeed; uniform float bType; uniform vec2 bView; uniform vec3 bBox;   // R, H, tile column
  uniform float heads; uniform float thatch; uniform float leafScale;
  attribute vec4 aBlade;
  varying vec2 vXY; varying float vT; varying float vPart; varying float vTh;
  float h11(float n) { return fract(sin(n) * 43758.5453123); }
  void main() {
    float t = aBlade.x, br = aBlade.y, part = aBlade.z, seed = bSeed;
    float hb = h11(seed * 71.9 + br * 131.7);
    bool on = part < 0.5 || hb <= heads * (bType < 0.5 ? 0.9 : 0.85);
    vec3 p = position;
    p.y *= (0.75 + 0.5 * h11(seed * 13.7 + br * 57.1)) * (part < 0.5 ? leafScale : 1.0);
    float la = h11(seed * 3.1 + br * 7.9) * 6.2832;
    p.xz += vec2(cos(la), sin(la)) * t * t * 0.07;
    vTh = part < 0.5 && h11(br * 17.3 + seed * 3.7) < thatch ? 1.0 : 0.0;
    vT = t; vPart = part;
    float e = bView.x, a = bView.y;
    vec3 V = vec3(cos(e) * cos(a), sin(e), cos(e) * sin(a));
    vec3 right = normalize(vec3(V.z, 0.0, -V.x)), up = cross(V, right);
    vec3 q = p - vec3(0.0, 0.5 * bBox.y, 0.0);
    float hh = 0.5 * bBox.y * cos(e) + bBox.x * sin(e);
    vXY = vec2(dot(q, right) / bBox.x, dot(q, up) / hh);
    vec2 uv = 0.5 + 0.5 * vXY * ${IMP.MARGIN.toFixed(5)};
    gl_Position = on ? vec4((bBox.z + uv.x) / ${IMP.TX.toFixed(1)} * 2.0 - 1.0, uv.y * 2.0 - 1.0, -dot(q, V) / (bBox.x + bBox.y), 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
  }`;
const BAKE_FRAG = /* glsl */`
  varying vec2 vXY; varying float vT; varying float vPart; varying float vTh;
  void main() {
    if (abs(vXY.x) > 1.0 || abs(vXY.y) > 1.0) discard;
    gl_FragColor = vec4(vTh, 1.0, vT, vPart / 3.0);
  }`;
const COPY_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COPY_FRAG = /* glsl */`uniform sampler2D src; varying vec2 vUv; void main() { gl_FragColor = texture2D(src, vUv); }`;

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
// Needlegrass drifts (18 m and 6 m): needlegrass holds the thin-soiled knolls and old ground, the annuals
// the rest, so from the air the tussocks show as grey-green drifts rather than an even sprinkle. The
// bunchgrass share at a point is the habitat's, times this factor (mean 1).
const driftRaw = (x, n) => 0.25 + 1.5 * smooth(0.3, 0.75, 0.7 * vnoise(x / 18, n / 18, 51) + 0.3 * vnoise(x / 6, n / 6, 52));
const DRIFT_MEAN = (() => { let s = 0; for (let j = 0; j < 120; j++) for (let i = 0; i < 120; i++) s += driftRaw(i * 13.7, j * 13.7); return s / 14400; })();
// Wild oat stands, 10-30 m across where the annuals are thickest, plus a thin scatter: cover 0.01-0.37.
const oatStand = (x, n) => 0.01 + 0.36 * smooth(0.52, 0.72, 0.7 * vnoise(x / 22, n / 22, 41) + 0.3 * vnoise(x / 7, n / 7, 42));
// Candidate k of cell (i, j): ten uniforms, a pure function of (i, j, k) (mulberry32 steps from a
// per-candidate seed), so any tier can read any rank range of a cell and see the same plants.
const U = new Float64Array(10);
function draw(i, j, k) {
  let a = (Math.imul(i, 92821) ^ Math.imul(j, 68917) ^ Math.imul(k + 1, 0x9E3779B1) ^ 0x2c1b3c6d) | 0;
  for (let m = 0; m < 10; m++) {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    U[m] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
// Body tier candidate (gi, gj) on the tile-wide 6.7 cm grid: nine uniforms (jitter x, y, keep, type, size, yaw,
// width, seed, rank), a pure function of the grid point.
const UB = new Float64Array(9);
function bodyDraw(gi, gj) {
  let a = (Math.imul(gi, 0x27d4eb2d) ^ Math.imul(gj + 7, 0x165667b1) ^ 0x5bd1e995) | 0;
  for (let m = 0; m < 9; m++) {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    UB[m] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
const EMPTY = new Float32Array(0);

// Ground height on the rendered terrain mesh (Terrain's default 10 chunks of ~10 m quads, split
// NW-SE as PlaneGeometry does), so roots sit exactly on the triangles rather than the heightfield.
// On a tile with the lidar residual the terrain near the player is the 2 m fine mesh of
// Heightfield.at (terrain.js FineTerrain), out past where any blade is drawn, so roots stand on that;
// the cards beyond it are moved onto the 10 m mesh where that is drawn (shrubfield.js ClumpField).
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

function seasonOf(look) {
  let best = 'summer', bd = Infinity;
  for (const [k, v] of Object.entries(SEASON_LOOK)) {
    if (v === look) return k;
    const d = v.grass.reduce((s, c, i) => s + (c - look.grass[i]) ** 2, 0);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

// A clump's bake box at unit scale: R the farthest any blade reaches from the root (with the lean
// NEAR_VERT adds), H the highest tip (with its tallest per-blade height, 1.25x).
function clumpBox(geo) {
  const p = geo.attributes.position.array, b = geo.attributes.aBlade.array;
  let R = 0, H = 0;
  for (let k = 0; k < p.length / 3; k++) {
    const t = b[k * 4];
    R = Math.max(R, Math.hypot(p[k * 3], p[k * 3 + 2]) + 0.07 * t * t);
    H = Math.max(H, p[k * 3 + 1] * 1.25);
  }
  return { R: R * 1.02, H: H * 1.02 };
}

export class Grass {
  // The near blade meshes stage up to 90k instances each, the ground tier's 50k. The constructor only records its
  // arguments: build() (a generator main.js steps with slice.js runSliced, so the opening screen keeps responding
  // while it runs; drain(grass.build()) runs it in one go) makes everything, in the order it always has.
  constructor(tile, scene) { this.tile = tile; this.scene = scene; }
  *build() {
    const tile = this.tile, scene = this.scene;
    this.nearCap = 90000; this.groundCap = 50000;
    this.ground = terrainHeight(tile);
    this.last = { near: null, ground: null }; this.lookKey = '';
    this.cache = LAYERS.map(() => new Map());   // per layer: cell index -> instance groups
    this.queue = new Map(); this.dirty = { near: false, ground: false };   // cells waiting to be generated; pools to refill
    this.buildDensityGrid();
    this._p = { ux: 0, uy: 0, px: 0, pn: 0, yaw: 0, sxz: 0, sy: 0, seed: 0, type: 0, role: 0 };
    const col = () => new THREE.Color();
    this.uniforms = {
      ...windUniforms, ...groundUniforms, groundK: { value: 1.12 }, matchOn: { value: 1 }, tiltOn: { value: 1 },
      nearFade: { value: new THREE.Vector2(...NEAR_FADE) }, closeFade: { value: new THREE.Vector2(...CLOSE_FADE) },
      groundFade: { value: new THREE.Vector2(...GROUND_FADE) }, midIn: { value: new THREE.Vector2(...MID_IN) },
      impIn: { value: new THREE.Vector2(...IMP_IN) }, impW: { value: IMP_W }, bodyFade: { value: new THREE.Vector2(2, 3) },
      heightScale: { value: 1 }, heads: { value: 1 }, thatch: { value: 0 }, leafScale: { value: 1 }, dry: { value: 1 },
      aRoot: { value: col() }, aTip: { value: col() }, aHead: { value: col() }, aAwn: { value: col() },
      bRoot: { value: col() }, bTip: { value: col() }, bHead: { value: col() }, bAwn: { value: col() },
      thatchCol: { value: col().setRGB(...THATCH, THREE.SRGBColorSpace) },
      ...atmo,
    };
    const nearMat = new THREE.ShaderMaterial({ vertexShader: NEAR_VERT, fragmentShader: NEAR_FRAG, uniforms: this.uniforms, side: THREE.DoubleSide });
    // Visible distance per tier (indexed by tier; update moves the main tier's with height).
    const nearBands = [[0, NEAR_FADE[1] + 3], [0, CLOSE_FADE[1] + 3]], groundBands = [null, null, [0, GROUND_FADE[1] + 3]];
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._inv = new THREE.Matrix4(); this._sphere = new THREE.Sphere(); this._pick = [];
    yield 'setup';
    const annualGeo = buildAnnualClump(), bunchGeo = buildBunchClump(), tussockGeo = buildTussockClump(), oatGeo = buildOatClump();
    yield 'clumps';
    this.geos = [tussockGeo, annualGeo, oatGeo];   // by atlas kind
    // The tussock and wild oat plants (the ones with those cards) have their own clumps and meshes,
    // drawn only out to where they hand over (12 m), so their fuller geometry costs little.
    const cardBands = () => [[0, IMP_IN[1] + IMP_W + 2], [0, IMP_IN[1] + IMP_W + 2]];
    this.sets = {
      annual: this.makeSet(annualGeo, nearMat, this.nearCap, nearBands),
      bunch: this.makeSet(bunchGeo, nearMat, this.nearCap, nearBands),
      tussock: this.makeSet(tussockGeo, nearMat, 30000, cardBands()),
      oat: this.makeSet(oatGeo, nearMat, 30000, cardBands()),
      groundA: this.makeSet(annualGeo, nearMat, this.groundCap, groundBands),
      groundB: this.makeSet(bunchGeo, nearMat, this.groundCap, groundBands),
    };
    // The body tier's two meshes (annual and needlegrass sward clumps), off until a small body is taken. Its
    // band (indexed by tier) is set with the ring's radius; the listener holds this world only weakly, so a world
    // torn down without dispose() is still freed (and the listener drops itself on the next body change).
    const bodyMat = new THREE.ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader: NEAR_FRAG, uniforms: this.uniforms, side: THREE.DoubleSide });
    const bodyBands = () => [null, null, null, [0, 0]];
    this.sets.bodyA = this.makeSet(buildSwardClump(false), bodyMat, BODY_CAP, bodyBands());
    this.sets.bodyB = this.makeSet(buildSwardClump(true), bodyMat, BODY_CAP, bodyBands());
    this.body = { scale: bodyScale.v, R: 0, rebuild: 1, last: null, dirty: false, active: false, microV: 0, seat: null, stale: null, work: null, wi: 0, reseat: false, cache: new Map(), queue: new Map(),
      kf: new Float32Array(BODY_LN * BODY_LN), sz: new Float32Array(BODY_LN * BODY_LN), bt: new Float32Array(BODY_LN * BODY_LN) };
    const ref = new WeakRef(this);
    const off = onBodyScale(v => { const g = ref.deref(); if (!g || !g.body) { off(); return; } g.body.scale = v; });
    this._offBody = off;
    this.group = new THREE.Group(); this.group.name = 'grass';
    for (const s of Object.values(this.sets)) this.group.add(s.mesh);
    scene.add(this.group);
    yield 'sets';
    shrubLeaves(true); yield 'shrub leaves (manzanita)';
    shrubLeaves(false); yield 'shrub leaves (chamise)';
    // Chaparral's closed shrub canopy (shrubfield.js).
    this.shrubs = ShrubField(tile, this.ground, this.uniforms);
    yield 'ShrubField';
    // The cards: annual tufts, needlegrass tussocks and wild oats. Each card kind's bake box (R, H) at
    // unit plant scale, from its clump's geometry: a plant's card is this box times its own scale. LOD
    // as the old fields: tufts thin from ~120 m to 40%, tussocks and oats past 30-34 m (survivors grow).
    this.box = this.geos.map(clumpBox);
    this.impKinds = [];
    const card = (role, kind, type, cfg) => {
      const f = new ClumpField(tile, this.ground, this.uniforms, {
        cellAny: (i, j) => this.cellAny(i, j), cellList: (i, j) => this.cardCell(i, j, role, kind), now: 60, roadsMax: 140, ...cfg,
        shader: { vertexShader: IMP_VERT, fragmentShader: IMP_FRAG,
          uniforms: { ...this.uniforms, impAtlas: { value: null }, impKind: { value: new THREE.Vector2(kind, type) }, cardBand: { value: new THREE.Vector4(...cfg.band) },
            bandW: { value: role === ROLE.tuft ? TUFT_W : IMP_W } } },
      });
      this.impKinds.push(f); return f;
    };
    this.tufts = card(ROLE.tuft, 1, 0, { name: 'grasstufts', cap: 40000, D0: 120, KMIN: 0.4, band: [...MID_IN, MID_END - 35, MID_END] }); yield 'tufts';
    this.clumps = card(ROLE.tussock, 0, 1, { name: 'grassclumps', cap: 60000, D0: 34, KMIN: 0.14, band: [...IMP_IN, 185, 225] }); yield 'clumpField';
    this.stalks = card(ROLE.oat, 2, 0, { name: 'grassstalks', cap: 30000, D0: 30, KMIN: 0.14, band: [...IMP_IN, 200, 240] }); yield 'stalks';
    this.group.add(this.shrubs.mesh, this.tufts.mesh, this.clumps.mesh, this.stalks.mesh);
    // The atlas is baked with the main renderer, which this class is not handed: a never-drawn mesh
    // in the group records it when the scene renders, and update bakes on the next frame.
    const hook = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    hook.geometry.setDrawRange(0, 0); hook.frustumCulled = false;
    hook.onBeforeRender = r => { this.renderer = r; };
    this.group.add(hook);
    this.bakeKey = '';
    yield 'hook';
    // Sward shells for the 8-60 m band (grassShells.js), at the density the clumps are placed with.
    this.shells = new GrassShells(tile, this.ground, (x, n) => this.swardDensity(x, n), {});
    this.group.add(this.shells.mesh);
    this.mesh = this.tufts.mesh;   // kept for debugging handles that used the old single mesh
  }
  // Instances placed (staged) and drawn this frame, per LOD.
  get counts() {
    const s = this.sets;
    return { nearPlaced: s.annual.staged + s.bunch.staged + s.tussock.staged + s.oat.staged + s.groundA.staged + s.groundB.staged,
      nearDrawn: s.annual.n + s.bunch.n + s.tussock.n + s.oat.n + s.groundA.n + s.groundB.n,
      annualDrawn: s.annual.n + s.oat.n + s.groundA.n, bunchDrawn: s.bunch.n + s.tussock.n + s.groundB.n, cardBladesDrawn: s.tussock.n + s.oat.n,
      groundDrawn: s.groundA.n + s.groundB.n, bodyPlaced: s.bodyA.staged + s.bodyB.staged, bodyDrawn: s.bodyA.n + s.bodyB.n,
      bodyR: this.body?.active ? this.body.R : 0, midDrawn: this.tufts.n, tussockDrawn: this.clumps.n, oatDrawn: this.stalks.n };
  }

  // Bake the card atlas (IMP) from the blade clumps with the main renderer: each row of tiles (one
  // card kind at one elevation, 8 azimuths x 2 geometry variants) into a 4x MSAA strip, copied into
  // its row of the atlas; mipmaps once at the end. Rebaked when the season changes what the blades
  // draw (flowering culms, thatch, leaf length). A few ms.
  bake(renderer) {
    const T = IMP.T;
    this.bakeSetup();
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevCol = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    this.atlas.texture.generateMipmaps = false;
    for (let kind = 0; kind < IMP.KINDS; kind++) for (let r = 0; r < IMP.EL; r++) {
      const box = this.box[kind];
      this.bakeMeshes.forEach((m, c) => {
        const mu = m.material.uniforms, v = Math.floor(c / IMP.AZ);
        m.geometry = this.geos[kind];
        mu.bSeed.value = v === 0 ? 0.25 : 0.75; mu.bType.value = kind === 0 ? 1 : 0;
        mu.bView.value.set(r * IMP.EL_STEP, (c % IMP.AZ) * Math.PI / 4); mu.bBox.value.set(box.R, box.H, c);
      });
      renderer.autoClear = true; renderer.setRenderTarget(this.strip); renderer.render(this.bakeScene, this.bakeCam);
      this.atlas.viewport.set(0, (kind * IMP.EL + r) * T, T * IMP.TX, T);
      renderer.autoClear = false; renderer.setRenderTarget(this.atlas); renderer.render(this.copyScene, this.bakeCam);
    }
    this.atlas.viewport.set(0, 0, T * IMP.TX, T * IMP.TY);
    this.atlas.texture.generateMipmaps = true;
    renderer.setRenderTarget(this.atlas); renderer.render(this.emptyScene, this.bakeCam);   // builds the mipmaps
    renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto; renderer.setClearColor(prevCol, prevA);
  }
  // The bake's targets, scenes and materials, made once (on the first bake, or by precompileBake).
  bakeSetup() {
    if (this.atlas) return;
    const T = IMP.T, u = this.uniforms;
    this.atlas = new THREE.WebGLRenderTarget(T * IMP.TX, T * IMP.TY, { depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.strip = new THREE.WebGLRenderTarget(T * IMP.TX, T, { samples: 4, depthBuffer: true });
    this.bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bakeScene = new THREE.Scene(); this.bakeMeshes = [];
    for (let c = 0; c < IMP.TX; c++) {
      const m = new THREE.Mesh(this.geos[0], new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, side: THREE.DoubleSide,
        uniforms: { bSeed: { value: 0 }, bType: { value: 0 }, bView: { value: new THREE.Vector2() }, bBox: { value: new THREE.Vector3() },
          heads: u.heads, thatch: u.thatch, leafScale: u.leafScale } }));
      m.frustumCulled = false; this.bakeScene.add(m); this.bakeMeshes.push(m);
    }
    const copy = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: COPY_VERT, fragmentShader: COPY_FRAG,
      uniforms: { src: { value: this.strip.texture } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending }));
    copy.frustumCulled = false;
    this.copyScene = new THREE.Scene(); this.copyScene.add(copy); this.emptyScene = new THREE.Scene();
    for (const f of this.impKinds) f.uniforms.impAtlas.value = this.atlas.texture;
  }
  // The bake's programs compiled ahead (main.js, while the opening screen is up), each with its render target bound,
  // so the first bake does not compile them inside a frame. Returns the compileAsync promises.
  precompileBake(renderer) {
    this.bakeSetup();
    const prev = renderer.getRenderTarget(), out = [];
    renderer.setRenderTarget(this.strip); out.push(renderer.compileAsync(this.bakeScene, this.bakeCam));
    renderer.setRenderTarget(this.atlas); out.push(renderer.compileAsync(this.copyScene, this.bakeCam));
    renderer.setRenderTarget(prev);
    // the body tier's program too (both its meshes share it), against the screen as it is drawn, so taking a small
    // body does not compile it inside a frame
    const bm = this.sets.bodyA.mesh; bm.visible = true;
    try { out.push(renderer.compileAsync(bm, this.bakeCam, this.scene)); } finally { bm.visible = false; }
    return out;
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
    return Math.min(dens * smooth(thr - 0.1, thr + 0.1, bareField(x, n)) * (rw > 140 ? 0 : rw > 0 ? 0.5 : 1) * 1.15, 1) * rockKeep(this.tile, x, n);   // thin on outcrops
  }

  // May this cell (or a neighbour, for the bilinear density) hold grass?
  cellAny(i, j) {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < this.W && b < this.Hh && this.dens[b * this.W + a] > 0) return true;
    }
    return false;
  }
  candidates() { const res = this.tile.habitat.res; return Math.round(res * res * P_TOTAL); }

  // Candidate k of N in cell (i, j): the plant, or false where none grows (density, outcrops, roads,
  // water, bare patches). Fills this._p. A pure function of (i, j, k), so every tier that reads this
  // rank sees the same plant: position, type, size, yaw, seed, and its card (role), if any.
  plantAt(i, j, k, N, annualShare) {
    draw(i, j, k);
    const { habitat: hab, size, roads, waterMask: wm } = this.tile, res = hab.res, P = this._p;
    const ux = U[0], uy = U[1], keep = U[2], px = (i + ux) * res, pn = size - (j + uy) * res;
    const dens = this.sample(this.dens, px, pn) * rockKeep(this.tile, px, pn);   // thin on outcrops too
    if (keep >= dens) return false;
    // Decayed roads: no grass on the pavement, half density across the verge.
    const rw = roads ? roads.at(px, pn) : 0;
    if (rw > 140 || (rw > 0 && U[8] < 0.5)) return false;
    // None on ponds or in stream channels (the riparian band keeps its grass).
    const wv = wm ? waterAt(wm, px, pn) : 0;
    if (wv === 255) return false;
    // Bare patches, more of them where herb cover is thin, thinning out over a feathered edge; clumps
    // also shorten toward them. The blades keep 40% of their (shorter) clumps in a patch: seen from the
    // chase camera a few metres up, an empty patch (they are often 10-30 m across) read as the grass
    // vanishing around you rather than as thin ground. Those plants carry no card, so the patches
    // still show open from the air (as the shells leave them).
    const herb = this.sample(this.herb, px, pn), bare = bareField(px, pn), thr = 0.28 + 0.14 * (1 - herb);
    const open = smooth(thr - 0.06, thr + 0.06, bare);
    if (keep >= dens * (0.4 + 0.6 * open)) return false;
    const type = U[6] < Math.min((1 - annualShare) * driftRaw(px, pn) / DRIFT_MEAN, 0.95) ? 1 : 0;
    const s = (0.75 + 0.5 * U[4]) * (0.7 + 0.45 * herb) * (0.6 + 0.4 * smooth(thr, thr + 0.15, bare));
    // The card: tussocks and oats thin out toward a creek (75% and 85% gone at the centreline).
    const r = (k + 0.5) / N; let role = ROLE.none;
    if (keep < dens * open) {
      if (type === 1) { if (r < R_TUS && U[9] >= 0.75 * wv / 200) role = ROLE.tussock; }
      else if (r < R_TUFT) role = ROLE.tuft;
      else if (r < R_TUFT + OAT_K * oatStand(px, pn) && rw <= 120 && U[9] >= 0.85 * wv / 200) role = ROLE.oat;
    }
    // A needlegrass with a card is a mature tussock, a little larger than the young bunches around it.
    const big = role === ROLE.tussock ? 1.2 : 1;
    P.ux = ux; P.uy = uy; P.px = px; P.pn = pn; P.yaw = U[3] * Math.PI * 2; P.sxz = s * (0.85 + 0.3 * U[5]) * big; P.sy = s * big;
    P.seed = U[7]; P.type = type; P.role = role;
    return true;
  }
  // A former reservoir or stock-pond bed (species mix row rewilded_meadow) is a wet meadow: perennial
  // bunchgrass more than annuals.
  annualAt(i, j) {
    if (this.tile.rewild && this.tile.speciesMix?.at(i, j)?.rule === 'rewilded_meadow') return WET_MEADOW_ANNUAL;
    const hb = HABITAT[this.tile.habitat.channel(i, j, 0)]; return hb ? hb.annual : 0.6;
  }

  // Instances of one cell for one blade layer (its rank range), generated once and cached, sorted into
  // groups by mesh (annual, bunch) and by L.sub-metre block, each with a bounding sphere.
  cellData(i, j, layer) {
    const key = j * this.W + i, cache = this.cache[layer], L = LAYERS[layer];
    let groups = cache.get(key);
    if (groups) return groups;
    const ns = Math.max(1, Math.round(this.tile.habitat.res / L.sub)), nb = ns * ns;
    const out = Array.from({ length: 4 * nb }, () => []);   // by mesh (annual, bunch, tussock, oat), then block
    if (this.cellAny(i, j)) {
      const N = this.candidates(), k1 = Math.round(N * L.r[1]), share = this.annualAt(i, j), P = this._p;
      for (let k = Math.round(N * L.r[0]); k < k1; k++) {
        if (!this.plantAt(i, j, k, N, share)) continue;
        const blk = Math.min(Math.floor(P.uy * ns), ns - 1) * ns + Math.min(Math.floor(P.ux * ns), ns - 1);
        const mesh = P.role === ROLE.tussock ? 2 : P.role === ROLE.oat ? 3 : P.type;
        out[mesh * nb + blk].push(P.px, this.ground(P.px, P.pn), -P.pn, P.yaw, P.sxz, P.sy, P.seed, P.type + 2 * L.tier + 8 * P.role);
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
      const h = 1.6 * sy + 0.3;   // grass height above the highest root (wild oat culms reach 1.5 x sy)
      groups.push({ mesh: Math.floor(g / nb), tier: L.tier, data: new Float32Array(a), x: (x0 + x1) / 2, y: (y0 + y1 + h) / 2, z: (z0 + z1) / 2,
        r: Math.hypot((x1 - x0) / 2 + 0.6, (y1 - y0 + h) / 2, (z1 - z0) / 2 + 0.6) });
    });
    if (cache.size > 400) cache.clear();   // bounded at a few tens of MB
    cache.set(key, groups);
    return groups;
  }

  // One card field's instances in a cell (ClumpField layout, in rank order): the plants of that role,
  // read from the same candidates as the blades, so each card is its plant's blade clump.
  cardCell(i, j, role, kind) {
    const out = [];
    if (!this.cellAny(i, j)) return out;
    const N = this.candidates(), share = this.annualAt(i, j), P = this._p, box = this.box[kind], code = [0, KIND.annual, KIND.bunch, KIND.stalk][role];
    const k0 = role === ROLE.oat ? Math.floor(N * R_TUFT) : 0, k1 = Math.ceil(N * (role === ROLE.tussock ? R_TUS : role === ROLE.tuft ? R_TUFT : R_OAT_END));
    for (let k = k0; k < k1; k++) {
      if (!this.plantAt(i, j, k, N, share) || P.role !== role) continue;
      out.push(P.px, this.ground(P.px, P.pn), -P.pn, CARD_RK * box.R * P.sxz, CARD_HK * box.H * P.sy, P.seed, code + 0.999 * P.yaw / (Math.PI * 2), 0);
    }
    return out;
  }

  // ---- the body tier ----------------------------------------------------------------------------
  // One 2 m cell of the body tier: its clumps by type (annual, needlegrass), each a Float32Array in rank order (so
  // any prefix is an even subsample), and the cell's bounding sphere. The plant rules are read at a 0.5 m lattice
  // (5 x 5 points) and interpolated: density x outcrops x roads (none on the pavement, half on the verge) x water x
  // the bare patches (a fifth of the sward in them, so they read as open ground), the size factor of herb cover and
  // bare ground, and the needlegrass share with its drifts, all as plantAt takes them. Made once and cached.
  bodyCellData(ci, cj) {
    const B = this.body, key = cj * 100000 + ci;
    let c = B.cache.get(key);
    if (c) return c;
    const tile = this.tile, size = tile.size, res = tile.habitat.res, x0 = ci * BODY_CELL, n0 = cj * BODY_CELL, h = BODY_CELL / 2;
    c = { a: EMPTY, b: EMPTY, x: x0 + h, y: 0, z: -(n0 + h), r: 0 };
    const hi = Math.floor((x0 + h) / res), hj = Math.floor((size - n0 - h) / res);
    if (x0 >= 0 && n0 >= 0 && x0 < size && n0 < size && this.cellAny(hi, hj)) {
      const LN = BODY_LN, st = BODY_CELL / (LN - 1), kf = B.kf, sz = B.sz, bt = B.bt, wm = tile.waterMask, roads = tile.roads;
      const share = this.annualAt(Math.min(Math.max(hi, 0), this.W - 1), Math.min(Math.max(hj, 0), this.Hh - 1));
      let any = 0;
      for (let b = 0; b < LN; b++) for (let a = 0; a < LN; a++) {
        const x = x0 + a * st, n = n0 + b * st, o = b * LN + a;
        const dens = this.sample(this.dens, x, n) * rockKeep(tile, x, n), rw = roads ? roads.at(x, n) : 0;
        const herb = this.sample(this.herb, x, n), bare = bareField(x, n), thr = 0.28 + 0.14 * (1 - herb);
        const wet = wm && waterAt(wm, x, n) === 255;
        kf[o] = dens <= 0 || wet || rw > 140 ? 0 : dens * (rw > 0 ? 0.5 : 1) * (0.2 + 0.8 * smooth(thr - 0.06, thr + 0.06, bare));
        sz[o] = (0.7 + 0.45 * herb) * (0.6 + 0.4 * smooth(thr, thr + 0.15, bare));
        bt[o] = Math.min((1 - share) * driftRaw(x, n) / DRIFT_MEAN, 0.95);
        any = Math.max(any, kf[o]);
      }
      if (any > 0) {
        const G = BODY_G, sp = BODY_CELL / G, lists = [[], []];
        let o = 0, tx = 0, ty = 0, y0 = Infinity, y1 = -Infinity;
        const bil = A => (A[o] * (1 - tx) + A[o + 1] * tx) * (1 - ty) + (A[o + LN] * (1 - tx) + A[o + LN + 1] * tx) * ty;
        for (let gb = 0; gb < G; gb++) for (let ga = 0; ga < G; ga++) {
          bodyDraw(ci * G + ga, cj * G + gb);
          const lx = (ga + UB[0]) * sp, ln = (gb + UB[1]) * sp, fx = lx / st, fy = ln / st;
          const ia = Math.min(Math.floor(fx), LN - 2), ib = Math.min(Math.floor(fy), LN - 2);
          o = ib * LN + ia; tx = fx - ia; ty = fy - ib;
          if (UB[2] >= bil(kf)) continue;
          const x = x0 + lx, n = n0 + ln, type = UB[3] < bil(bt) ? 1 : 0, sc = (0.75 + 0.5 * UB[4]) * bil(sz), y = this.ground(x, n);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          lists[type].push(UB[8], x, y, -n, UB[5] * Math.PI * 2, sc * (0.85 + 0.3 * UB[6]), sc, UB[7], type + 2 * BODY_TIER);
        }
        const sorted = L => {
          const m = L.length / 9, idx = Array.from({ length: m }, (_, k) => k), out = new Float32Array(m * STRIDE);
          idx.sort((u, v) => L[u * 9] - L[v * 9]);
          for (let k = 0; k < m; k++) for (let q = 0; q < STRIDE; q++) out[k * STRIDE + q] = L[idx[k] * 9 + 1 + q];
          return out;
        };
        c.a = sorted(lists[0]); c.b = sorted(lists[1]);
        for (const A of [c.a, c.b]) { const m = A.length / STRIDE, ys = A.base = new Float32Array(m); for (let k = 0; k < m; k++) ys[k] = A[k * STRIDE + 1]; }
        if (y1 >= y0) { c.y = (y0 + y1) / 2 + 0.15; c.r = Math.hypot(h + 0.3, (y1 - y0) / 2 + 0.35, h + 0.3); }
      }
    }
    if (B.cache.size > 400) {   // a few MB; drop the cells far from the ring first
      const lp = B.last;
      for (const [k, v] of B.cache) if (!lp || Math.hypot(v.x - lp[0], v.z + lp[1]) > 3 * (B.R + B.rebuild) + 4) B.cache.delete(k);
      if (B.cache.size > 400) B.cache.clear();
    }
    B.cache.set(key, c);
    return c;
  }

  // Stage the body ring around (x, north): every 2 m cell out to the ring plus a refill's travel, nearest first,
  // each cell's rank-order prefix at the ring's staging fraction (BODY_CAP over the ring's candidate count, fixed
  // per radius so the density never shifts as cells arrive). Cells within half the radius are made at once if
  // missing (a few, on taking the body); the rest are queued (updateBody drains them).
  bodyFill(x, north) {
    const B = this.body, S = this.sets, tA = S.bodyA, tB = S.bodyB, place = B.R + B.rebuild + 0.75, h = BODY_CELL / 2;
    for (const t of [tA, tB]) { t.staged = 0; t.blocks.length = 0; t.sig = NaN; }
    B.queue.clear();
    const frac = Math.min(1, BODY_CAP / (Math.PI * place * place * (BODY_G / BODY_CELL) ** 2));
    const i0 = Math.floor((x - place) / BODY_CELL), i1 = Math.floor((x + place) / BODY_CELL);
    const j0 = Math.floor((north - place) / BODY_CELL), j1 = Math.floor((north + place) / BODY_CELL), cells = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot((i + 0.5) * BODY_CELL - x, (j + 0.5) * BODY_CELL - north);
      if (d - h * 1.42 <= place) cells.push([d, i, j]);
    }
    cells.sort((a, b) => a[0] - b[0]);
    for (const [d, i, j] of cells) {
      const key = j * 100000 + i;
      if (!B.cache.has(key) && d - h * 1.42 > 0.5 * B.R) { B.queue.set(key, [i, j]); continue; }
      const c = this.bodyCellData(i, j);
      for (const [t, arr] of [[tA, c.a], [tB, c.b]]) {
        const n = Math.round(arr.length / STRIDE * frac);
        if (!n || t.staged + n > t.cap) continue;
        t.stage.set(arr.subarray(0, n * STRIDE), t.staged * STRIDE);
        t.blocks.push({ x: c.x, y: c.y, z: c.z, r: c.r, tier: BODY_TIER, start: t.staged, count: n, src: arr });
        t.staged += n;
      }
    }
    B.reseat = true;
  }
  // Under the body the ground is terrain.js's micro patch (a few cm of relief over the fine mesh, Heightfield.micro):
  // the roots inside its square are re-seated on its surface as drawn, so no blade stands in the air over a hollow or
  // grows out of a bump. The seated heights are written into the cell's own arrays (each keeps its ground heights in
  // .base and the patch version it was seated at in .sv), so a refill copies them as they are. When the patch moves
  // or rebuilds (its version) the blocks under the new square are re-seated and those only under the old one put back
  // on the ground, nearest first, under `budget` ms a frame (a block, ~700 roots, at a time): the relief is anchored to
  // the world, so a block still waiting is off only in the patch's eased rim. A reseat (after a refill) only seats
  // the cells not yet seated at this version, and puts back any cell seated before that is now off the patch.
  bodySeat(budget) {
    const B = this.body, M = this.tile.heights.micro, v = M ? M.version : 0;
    const hit = (k, R) => R && !(k.x + k.r < R.x0 || k.x - k.r > R.x1 || -k.z + k.r < R.n0 || -k.z - k.r > R.n1);
    if (v !== B.microV || B.reseat) {
      if (B.seat) { const o = B.stale, q = B.seat; B.stale = o ? { x0: Math.min(o.x0, q.x0), x1: Math.max(o.x1, q.x1), n0: Math.min(o.n0, q.n0), n1: Math.max(o.n1, q.n1) } : { ...q }; }
      B.microV = v; B.reseat = false; B.seat = M ? { x0: M.x0, x1: M.x1, n0: M.n0, n1: M.n1 } : null;
      const work = [], lp = B.last || [0, 0];
      for (const t of [this.sets.bodyA, this.sets.bodyB]) for (const k of t.blocks) if (hit(k, B.seat) || hit(k, B.stale) || (k.src.sv | 0) !== 0) work.push([Math.hypot(k.x - lp[0], k.z + lp[1]), t, k]);
      B.work = work.sort((a, b) => a[0] - b[0]); B.wi = 0;
    }
    if (!B.work) return;
    const t0 = performance.now(), R = B.seat;
    while (B.wi < B.work.length) {
      const [, t, k] = B.work[B.wi++], src = k.src, ys = src.base, inR = hit(k, R);
      if (inR ? src.sv !== v || src.sn < k.count : (src.sv | 0) !== 0) {
        const m = inR ? k.count : src.sn | 0;
        for (let q = 0; q < m; q++) {
          const o = q * STRIDE, x = src[o], n = -src[o + 2];
          src[o + 1] = inR && x > R.x0 && x < R.x1 && n > R.n0 && n < R.n1 ? M.ground(x, n) : ys[q];
        }
        src.sv = inR ? v : 0; src.sn = inR ? m : 0;
      }
      t.stage.set(src.subarray(0, k.count * STRIDE), k.start * STRIDE); t.sig = NaN;
      if (performance.now() - t0 > budget) break;
    }
    if (B.wi >= B.work.length) { B.work = null; B.stale = null; }
  }

  // The body ring each frame: on below BODY_MAX scale while the camera is near the ground; its radius from the
  // scale; refilled when the camera has moved a fifth of the radius, or when queued cells have been made (under
  // 1 ms of them a frame); then the roots under the micro patch re-seated in what is left of ~1.5 ms. Off, it
  // stages nothing and its meshes stay hidden: a deer's frame is untouched.
  updateBody(cp, north, agl) {
    const B = this.body, S = this.sets;
    const on = this.bodyOn !== false && B.scale < BODY_MAX && agl < Math.max(3, 0.5 * bodyRadius(B.scale));   // bodyOn: false for A/B timing
    if (!on) {
      if (B.active) {
        B.active = false; B.last = null; B.queue.clear(); B.work = null;
        for (const t of [S.bodyA, S.bodyB]) { t.staged = t.n = 0; t.blocks.length = 0; t.sig = NaN; t.mesh.geometry.instanceCount = 0; }
      }
      S.bodyA.mesh.visible = S.bodyB.mesh.visible = false;
      return;
    }
    B.active = true;
    const R = bodyRadius(B.scale);
    if (R !== B.R) {
      B.R = R; B.rebuild = Math.max(0.4, 0.2 * R); B.last = null;
      this.uniforms.bodyFade.value.set(0.75 * R, R);
      S.bodyA.bands[BODY_TIER] = [0, R + 2]; S.bodyB.bands[BODY_TIER] = [0, R + 2];
    }
    const t0 = performance.now();
    if (B.queue.size) {
      for (const [k, [i, j]] of B.queue) {
        B.queue.delete(k);
        if (B.cache.has(k)) continue;
        this.bodyCellData(i, j); B.dirty = true;
        if (performance.now() - t0 > 1) break;
      }
    }
    const move = !B.last || Math.hypot(cp.x - B.last[0], north - B.last[1]) > B.rebuild;
    if (move || B.dirty) {
      if (move) B.last = [cp.x, north];
      B.dirty = false;
      this.bodyFill(B.last[0], B.last[1]);
    }
    // the micro patch's re-seat takes what is left of ~1.5 ms after the cells and the refill (none if they used it)
    const left = Math.min(0.75, 1.5 - (performance.now() - t0));
    if (left > 0 && (B.reseat || B.work || (this.tile.heights.micro?.version ?? 0) !== B.microV)) this.bodySeat(left);
    S.bodyA.mesh.visible = S.bodyA.staged > 0; S.bodyB.mesh.visible = S.bodyB.staged > 0;
  }

  // Let go of what the body tier holds and unhook its body-scale listener. The meshes stay in the group, so the
  // world's GPU sweep (main.js disposeGpu) frees their geometry and material with the rest of the grass; disposing
  // them here as well is harmless (three's dispose is idempotent).
  dispose() {
    this._offBody?.(); this._offBody = null;
    if (this.body) { this.body.cache.clear(); this.body.queue.clear(); this.body = null; }
    for (const k of ['bodyA', 'bodyB']) {
      const set = this.sets?.[k]; if (!set) continue;
      set.mesh.visible = false; set.mesh.geometry.dispose(); set.stage = EMPTY; set.blocks.length = 0; set.staged = set.n = 0;
    }
    this.sets?.bodyA?.mesh.material.dispose();
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
    // Measured season (terrain.js seasonState): the season's palette keeps its shape (root to tip, heads,
    // awns), and its mean leaf colour is set, in linear light, to the summer palette's (made for the July
    // photo) times the open grass's measured ratio for the date over July, so the blades are the colour of
    // the ground they stand on.
    let kl = null;
    const g = seasonState.grass;
    if (g) {
      const lin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      const mean = p => p.root.map((r, i) => lin(r + 0.6 * (p.tip[i] - r)));
      const ms = mean(PALETTE.summer.annual), mp = mean(P.annual);
      kl = ms.map((v, i) => Math.min(Math.max(v * g[i] / mp[i], 0.4), 2.5));
    }
    const set = kl
      ? (uni, rgb) => { uni.value.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace); uni.value.r *= kl[0]; uni.value.g *= kl[1]; uni.value.b *= kl[2]; }
      : (uni, rgb) => uni.value.setRGB(rgb[0] * k[0], rgb[1] * k[1], rgb[2] * k[2], THREE.SRGBColorSpace);
    set(u.aRoot, P.annual.root); set(u.aTip, P.annual.tip); set(u.aHead, P.annual.head); set(u.aAwn, P.annual.awn);
    set(u.bRoot, P.bunch.root); set(u.bTip, P.bunch.tip); set(u.bHead, P.bunch.head); set(u.bAwn, P.bunch.awn);
    u.heightScale.value = P.height; u.heads.value = P.heads; u.thatch.value = P.thatch; u.leafScale.value = P.leaf; u.dry.value = P.dry;
    this.season = season;
  }

  // x, z (the flight position) are kept for the caller's signature; the camera position is used.
  update(x, z, dt, camera, look) {
    this.uniforms.time.value += dt;
    const key = look.grass.join(',') + (look === SEASON_LOOK[this.season] ? '' : '?') + seasonState.version;
    if (key !== this.lookKey) { this.lookKey = key; this.applyLook(look); }
    const cp = camera.position, north = -cp.z, agl = cp.y - this.ground(cp.x, north);
    // From the air the blade clumps are sub-pixel and the shells and tussocks carry the sward, so the
    // blades hand over nearer the camera the higher it is: 55-85 m below 8 m, 30-45 m from 28 m up
    // (the tufts have dithered in by 38 m at every height, so no gap opens). A plant with a card hands
    // over to it nearer than that, so this moves only the plants without one.
    const k = this.altLod === false ? 0 : smooth(8, 28, agl), nf = this.uniforms.nearFade.value;   // altLod: false for A/B timing
    nf.set(NEAR_FADE[0] + (30 - NEAR_FADE[0]) * k, NEAR_FADE[1] + (45 - NEAR_FADE[1]) * k);
    this.sets.annual.bands[0][1] = nf.y + 3;
    // The ground tier is for the low chase camera looking down at the ring around it; once the shells
    // carry the sward (camera 10 m up and more) it is mostly under them, so it thins out blade by
    // blade from the camera outward over 8-14 m and is off above that.
    const gk = 1 - smooth(8, 14, agl);
    this.uniforms.groundFade.value.set(GROUND_FADE[0] * gk, GROUND_FADE[1] * gk);
    const on = { near: agl < nf.y + 3, ground: agl < 14 };
    if (this.queue.size) this.drain();
    for (const pool of ['near', 'ground']) {
      if (!on[pool]) continue;
      const last = this.last[pool], move = !last || Math.hypot(cp.x - last[0], north - last[1]) > POOLS[pool].rebuild;
      if (!move && !this.dirty[pool]) continue;
      if (move) this.last[pool] = [cp.x, north];
      this.dirty[pool] = false;
      this.fill(this.last[pool][0], this.last[pool][1], pool);
    }
    const S = this.sets;
    for (const [pool, P] of Object.entries(POOLS)) for (const k of P.sets) S[k].mesh.visible = on[pool] && S[k].staged > 0;
    if (this.body) this.updateBody(cp, north, agl);
    this.cull(camera);
    for (const set of Object.values(S)) if (set.n === 0) set.mesh.visible = false;
    // Shrub impostors: drawn to within 1.2-3.5 m of the camera at every height. The 3D shrubs of
    // vegetation.js are a few per 30 m cell (~6% cover against the 30-85% canopy shrub cover the
    // impostors fill to), so handing the near field over to them below 8 m (as this once did, at
    // 25-40 m) emptied a disc around the camera: the stand sank away as you came down to it.
    this.shrubs.update(camera, true, null);
    // The cards. Baked first (the renderer is known once the scene has drawn once), and rebaked when
    // the season changes what the blade clumps carry.
    const u = this.uniforms, bk = `${u.heads.value},${u.thatch.value},${u.leafScale.value}`;
    if (this.renderer && bk !== this.bakeKey) { this.bake(this.renderer); this.bakeKey = bk; }
    const ready = !!this.bakeKey;
    // Tufts: low down they hand over at 26-38 m behind the blade tiers, but from 8 m up the blade
    // clumps are sub-pixel and the shells too faint on a cured sward to carry the near field, so they
    // hand over at 9-15 m instead (a bare disc opened around a camera 10-30 m up otherwise). The edge
    // moves with height over 6-10 m; each plant's blades and card follow it together, in place.
    const up = smooth(6, 10, agl);
    u.midIn.value.set(MID_IN[0] + (MID_IN_HIGH[0] - MID_IN[0]) * up, MID_IN[1] + (MID_IN_HIGH[1] - MID_IN[1]) * up);
    this.tufts.uniforms.cardBand.value.set(u.midIn.value.x, u.midIn.value.y, MID_END - 35, MID_END);
    this.tufts.update(camera, ready && agl < MID_END, null);
    // Tussocks (to 225 m, so the sward keeps a grain from 60-200 m up) and wild oats (to 240 m) hand
    // over at 6-12 m at every height and in every season: the plants you see from the air are the plants
    // around you on the ground. The tussock field's `band` uniform is no longer its card fade but what
    // shadows.js casts its contact-shadow ellipses with: kept where those shadows always were (from
    // 45-60 m low down, 12-20 m from 10 m up), since a solid ellipse under a near clump of blades reads
    // as a dark blot on the ground.
    this.clumps.update(camera, ready && agl < 225, [45 - 33 * up, 60 - 40 * up, 185, 225]);
    this.stalks.update(camera, ready && agl < 240, null);
    this.shells.update(camera, agl, this.uniforms.heightScale.value);
  }
}
