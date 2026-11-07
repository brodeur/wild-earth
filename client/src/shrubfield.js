import * as THREE from 'three';
import { mulberry32, SPECIES, SPECIES_IDS } from './trees.js';
import { leafOnAt, decoActive, seasonMonth, shrubFrame, variantSlots } from './treegen.js';
import { uniforms as atmo, ATMOSPHERE_GLSL, groundLook } from './atmosphere.js';
import { groundUniforms, GROUND_GLSL } from './terrain.js';
import { windUniforms, WIND_GLSL } from './wind.js';
import { rockKeep } from './tilepackage.js';
import { releaseTexture } from './gpuRelease.js';
import { borrowsNothing } from './vegetation.js';

// Clump fields: vegetation seen from the air as many cheap impostors, one camera-facing quad per
// clump. ShrubField (chaparral) shades each quad per pixel as an ellipsoid whose normal is rebuilt
// from the quad position and broken into lobes by 3D noise on that normal (stable as the camera
// turns): chamise and manzanita fill each chaparral cell to its canopy shrub cover, so the habitat
// reads as a closed, mottled grey-green carpet instead of scattered bushes on bare photo (the 3D
// shrubs in vegetation.js are a few dozen per cell). Chamise: rounded, twiggy, grey-green; manzanita:
// taller, upswept, darker, red-brown stems under the crown. Each species has silhouette variants
// (chamise: rounded, ragged vase, vase with grey dead stems; manzanita: upswept, sprawling, open with
// its red branching showing), crowns sized by species and stand age (the species files' heights and
// width ratios, as the 3D shrubs), and stands broken by occasional openings. Up close (nearBand) a
// second program from the same source (NEAR) draws the plant's own parts: baked leaf and needle
// pictures on the dome, an outline of single leaves, tufts and wands, stems at the base, and the
// species' season colours (see docs/grass-notes.md, fifth and sixth passes).
// grass.js runs three more fields on the same machinery with its own shader and its own placement
// (cfg.shader, cfg.cellList): the grass tuft cards, needlegrass tussocks and wild oat stands, each a
// baked picture of a blade clump that the near blade tiers draw in full at the same spot.
//
// Every field uses the same density LOD ("clump models that change with distance"): past D0 a field thins
// as (D0/d)^2 (each clump dithers out at its own rank, never shrinking) and the survivors grow by 1/sqrt(keep), so cover is kept while the clumps per screen
// area (and the cost) stay about constant; a grown impostor is drawn with more, smaller lobes, so
// far away it stands for a patch of several plants rather than one swollen plant. Each cell's
// clumps are stored in random order and the CPU submits only the prefix the LOD can keep.
// Placement is deterministic per 30 m habitat cell, cached, generated a few cells per frame.

const STRIDE = 8, REFILL_MOVE = 15;
export const KIND = { chamise: 0, manzanita: 1, annual: 2, bunch: 3, stalk: 4,   // 2-4: grass.js's impostors (tuft, tussock, oat)
  toyon: -1, redbud: -2, poison_oak: -3, coyote_brush: -4, elderberry: -5, coffeeberry: -6 };   // negative: the foothill shrubs (FH below; -1 - FH index)
// The foothill shrubs drawn by this field (2026-10-26; every shrub of the library but the two chaparral ones since
// 2026-10-29, in library order, up to FH_SLOTS): kind -1 - index. Their looks (FH_LOOK: lobe depth, how far the fringe
// breaks up, a narrow base; and whether the leaves are fine, taking chamise's picture rather than manzanita's) are a
// table by id; a shrub not in it takes the defaults.
const FH_SLOTS = 24;   // the riparian set (2026-10-29) brought the library past 16 shrubs
const FH_LOOK = {   // [lobe, open, vase, fine]
  heteromeles_arbutifolia: [0.34, 0.62, 0.0, 0], cercis_occidentalis: [0.24, 0.48, 0.26, 0], toxicodendron_diversilobum: [0.36, 0.38, 0.16, 0],
  baccharis_pilularis: [0.1, 0.7, 0.0, 1], sambucus_nigra_caerulea: [0.3, 0.42, 0.06, 0], frangula_californica: [0.14, 0.68, 0.0, 0],
  arctostaphylos_manzanita: [0.2, 0.55, 0.1, 0], ceanothus_cuneatus: [0.18, 0.62, 0.0, 1], ceanothus_integerrimus: [0.3, 0.4, 0.2, 0],
  cercocarpus_betuloides: [0.3, 0.45, 0.25, 0], diplacus_aurantiacus: [0.2, 0.5, 0.0, 1], rosa_californica: [0.28, 0.5, 0.05, 0],
  symphoricarpos_albus: [0.22, 0.4, 0.1, 1], ribes_roezlii: [0.26, 0.5, 0.05, 0], ribes_malvaceum: [0.22, 0.5, 0.15, 0] };
const FH_DEFAULT = [0.25, 0.5, 0.05, 0];
// A shrub not in the table (2026-11-06): the defaults, its leaves fine where its record's leaves are as small as the
// table's fine-leaved shrubs' (coyote brush, buckbrush, snowberry, monkeyflower: 12-25 mm; its broad-leaved ones 40 mm
// and over), so big sagebrush's small grey leaves take chamise's fine picture, not manzanita's broad leaves.
const FH_FINE_LEAF_M = 0.025;
// A shrub not in the table takes its look from its record (2026-11-06, iteration 8; the table's values were fitted to
// these same fields of its shrubs): lobe depth 1.5 x the crown envelope's lobe_depth; how far the fringe breaks up from
// the crown's porosity (targets.porosity: 0.95 - 1.5 p, so coyote brush's 0.2 is the table's 0.65-0.7 and poison oak's
// 0.35 its 0.38-0.43); a narrow base from the envelope profile (the base's width under half the widest: redbud's vase).
// Two more for every shrub: the porosity itself, which opens a fine-leaved crown up close (see FRAG, picF), and the
// leaf picture's tile from the leaf size (0.8 m for a 2 cm leaf: the picture's leaves at the record's size).
const fhLook = id => {
  const spec = SPECIES[id], env = spec?.crown?.envelope, prof = env?.profile, leaf = spec?.foliage?.leaf_size_m ?? 1;
  const por = Math.min(0.6, Math.max(0.05, spec?.targets?.porosity ?? 0.2));
  const wmax = prof?.length ? Math.max(...prof.map(q => q[1])) : 0;
  const own = [Math.min(0.4, Math.max(0.1, 1.5 * (env?.lobe_depth ?? 0.16))), Math.min(0.75, Math.max(0.3, 0.95 - 1.5 * por)),
    wmax > 0 ? Math.max(0, 0.9 * (0.5 - prof[0][1] / wmax)) : FH_DEFAULT[2], leaf <= FH_FINE_LEAF_M ? 1 : 0];
  return [...(FH_LOOK[id] || own), por, Math.min(1.2, Math.max(0.4, 0.8 * leaf / 0.02))];
};
export const FH = SPECIES_IDS.filter(id => SPECIES[id].shrubLike && id !== 'arctostaphylos_viscida' && id !== 'adenostoma_fasciculatum').slice(0, FH_SLOTS);   // exported for forage.js (the glow weights by index)
FH.forEach((id, k) => { for (const a of SPECIES[id].aliases || []) if (KIND[a] === undefined) KIND[a] = -1 - k; });
const FH_N = FH.length;
const fhArr = i => `float[${FH_N}](${FH.map(id => fhLook(id)[i].toFixed(2)).join(', ')})`;
// Twig shrubs (2026-11-06, Lamar's sagebrush): a shrub whose record describes a porous crown of small leaves (foliage
// leaf_size_m at most FH_FINE_LEAF_M, targets.porosity at least TWIG_POR) is, up close, its own branching (the species'
// skeleton from treegen: a short trunk splitting low into crooked stems, their branches and twigs) with a tuft of leaves at
// each twig end, sky and ground showing between them (TwigShrubs below); the impostor gives such a plant up inside
// twigBand (a radius per plant, hashed between the two, as the near / far hand-over). A low shrub only (the record's
// height_m to TWIG_HMAX): the tufts a crown needs grow as its height squared, and a taller crown (mountain mahogany, 2-5 m)
// drew as a few tufts on long bare stems within the budget, worse than its impostor. Big sagebrush, snowberry and Sierra
// gooseberry qualify; mountain mahogany and red huckleberry (too tall), coyote brush (porosity 0.2), buckbrush and the
// chaparral do not. The tuft is TWIG_TUFT_K leaf lengths across (a fascicle of leaves on a short shoot at the twig's end).
const TWIG_POR = 0.25, TWIG_TUFT_K = 3.5, TWIG_HMAX = 1.6;
// the tuft picture (bakeTuft): its fascicles (nodes x leaves at each), 18 leaves of 1 / TWIG_TUFT_K of the tuft covering 0.25
// of its square as the seven longer leaves did (so the crown's porosity holds); the leaves' mean tilt in the picture (b)
const TUFT_NODES = 6, TUFT_PER = 3, TUFT_TILT_MEAN = 0.65;
// the close tier's skeletons per record class (TwigShrubs), and the pictures of them past the hand-over (TwigShrubs.bake, TB_T below)
const VIS_W = 1.75;   // a crown's visible width over the card's R (see SHRUB_H below)
const TW_EL_LO = 8, TW_EL_HI = 12;   // the pictures whole below TW_EL_LO degrees over the plant, the dome above TW_EL_HI (VERT twP)
const TWIG_COPIES = 3, TB_T = 64, TB_AZ = 6, TB_EL = 4, TB_COLS = 32, TB_EL_DEG = [0, 30, 60, 89.5];
const isTwig = id => { const s = SPECIES[id]; return !!s && (s.foliage?.leaf_size_m ?? 1) <= FH_FINE_LEAF_M && (s.targets?.porosity ?? 0) >= TWIG_POR
  && (s.height_m?.[1] ?? 9) <= TWIG_HMAX && !s.palm; };
const FH_TWIG = FH.map(isTwig);
const twigArr = `float[${FH_N}](${FH_TWIG.map(t => (t ? 1 : 0).toFixed(1)).join(', ')})`;
// The crown porosity of each kind of this field (the record's targets.porosity, as fhLook clamps it; chamise and manzanita
// from theirs; 0 for grass.js's kinds), for shadows.js: an open crown's cast shadow lets the sun through (2026-11-06).
const porOf = id => Math.min(0.6, Math.max(0.05, SPECIES[id]?.targets?.porosity ?? 0.2));
const CLUMP_POR_GLSL = /* glsl */`
  const float CP_FH[${FH_N}] = ${fhArr(4)};
  float clumpPor(float kind) { return kind < -0.5 ? CP_FH[int(-kind - 0.5)] : kind < 0.5 ? ${porOf('adenostoma_fasciculatum').toFixed(3)} : kind < 1.5 ? ${porOf('arctostaphylos_viscida').toFixed(3)} : 0.0; }`;
// The foothill shrubs take negative kinds: shadows.js casts every kind over 1.5 as grass (its season height and a
// grass blade's sway, 0.35 H), which swung a toyon's shadow metres across its neighbours in the wind.
// Seed layout: integer part random, fractional part the silhouette variant (variant + 0.5) / 4.
const lam = c => -Math.log(1 - Math.min(c, 0.9));   // disc density giving cover c with random placement

const VERT = /* glsl */`
  ${ATMOSPHERE_GLSL}
  ${GROUND_GLSL}
  ${WIND_GLSL}
  // the trees' contact AO only (shadows.js: its g; r carries the shrubs' own crowns too, for the ground under them)
  float treeAO(vec3 p) {
    vec2 uv = (contactAOMatrix * vec4(p, 1.0)).xy, e = abs(uv - 0.5) * 2.0;
    if (max(e.x, e.y) >= 1.0) return 1.0;
    return 1.0 - texture(contactAO, uv).g * (1.0 - smoothstep(0.8, 1.0, max(e.x, e.y)));
  }
  uniform vec2 kParams;   // D0, KMIN
  uniform vec4 band;      // fade in from x to y, out from z to w (distance to camera)
  uniform float heightScale; uniform float dry;   // dry: 0 green season .. 1 cured summer sward
  uniform vec2 nearBand;  // the near detail (leaves, wands, stems) is full to x, gone by y (distance to camera)
  uniform vec2 twigBand;  // the twig shrubs' hand-over to TwigShrubs (m, horizontal, a radius per plant between x and y)
  const float FH_TWIG[${FH_N}] = ${twigArr};
  const vec2 TW_LIGHT = vec2(0.58, 0.68);   // (sun, sky) for a twig shrub past its hand-over (below)
  uniform float twBase[${FH_N}];   // a twig species' first picture (TwigShrubs.bake), -1 before
  uniform vec2 twEl;   // the pictures whole below x degrees over the plant, the dome from y (TW_EL_LO, TW_EL_HI)
  #ifndef NEAR
  varying vec4 vTw;   // a twig shrub's pictures: its first tile, the view's azimuth and elevation in tiles, the pictures' share
  #endif
  uniform vec3 fhCol[${FH_N}];  // the foothill shrubs (FH, kind -1 - index): this season's leaf albedo, from the species files (fhSeason)
  uniform vec4 glow; uniform float glowFh[${FH_N}]; uniform vec2 glowKind;   // the forager's food (forage.js): the body x z, its radius, the gain; each foothill shrub's weight this season; chamise's and manzanita's
  attribute vec4 iPos; attribute vec4 iVar;   // root x y z, crown radius | height, seed, kind, rank
  varying float vGlow;
  varying vec2 vQ; varying vec3 vRight; varying vec3 vUp; varying vec3 vView;
  varying vec3 vAlbedo; varying vec3 vSun; varying vec3 vAmb; varying vec3 vAmbUp; varying vec3 vT; varying vec3 vIn;
  varying float vSeed; varying float vKind; varying float vLobes; varying float vYS; varying float vVar; varying float vDry; varying float vFade;
  varying vec4 vDim;   // crown radius, half extent on the card's up axis, half height (m), near detail 0..1
  float hh(float n) { return fract(sin(n) * 43758.5453123); }
  // A stable random per plant from its root position (cm grid), independent of the 400 seed values.
  float ph(vec2 p, uint salt) {
    uvec2 q = uvec2(ivec2(floor(p * 64.0)) + 4194304);
    uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u) ^ (salt * 2798796415u);
    h = (h ^ (h >> 15)) * 2246822519u; h ^= h >> 13;
    return float(h) * (1.0 / 4294967296.0);
  }
  void main() {
    float R = iPos.w, H = iVar.x, seed = iVar.y, kind = iVar.z, rank = iVar.w;
    float d = distance(cameraPosition, iPos.xyz);
    float keep = clamp(kParams.x * kParams.x / max(d * d, 1.0), kParams.y, 1.0);
    // Fades never change a plant's size (a scaled fade reads as plants growing out of the ground and
    // sinking back into it): each plant has its own in and out distances inside the band edges and
    // dithers out over a short window around them (vFade, screen-space dither in the fragment), so
    // the field thins and fills plant by plant. The density LOD's rank cut is dithered the same way.
    float dout = mix(band.z, band.w, ph(iPos.xz, 2u)), wo = max(0.12 * (band.w - band.z), 0.4);
    // At the camera a plant goes whole, and only when the camera is in or at its crown (the distance to the crown's centre
    // under its half extent plus 0.1-0.4 m, the plant's own): a walker's eye can stand a metre from a sagebrush and see it,
    // and nothing dissolves into a screen door at the feet (2026-11-06, iteration 8; it was a dithered fade over
    // band.x-band.y m of the root, 1.2-3.5 m, which also took the shrub one walked up to). band.x-y stay for the uniforms.
    float sIn = step(max(R, 0.5 * H) * 1.05 + mix(0.1, 0.4, ph(iPos.xz, 1u)), distance(cameraPosition, iPos.xyz + vec3(0.0, 0.5 * H, 0.0)));
    float s = clamp((keep - rank) / 0.05, 0.0, 1.0) * sIn * (1.0 - smoothstep(dout - wo, dout + wo, d));
    // a twig shrub inside its own hand-over radius is drawn whole by TwigShrubs (the same test there, complementary)
    if (kind < -0.5 && FH_TWIG[int(-kind - 0.5)] > 0.5 && distance(cameraPosition.xz, iPos.xz) < mix(twigBand.x, twigBand.y, ph(iPos.xz, 4u))) s = 0.0;
    if (s < 0.01) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    vFade = s;
    // Near and far hand a plant over whole, at its own distance inside nearBand (a hash of its root), never by a dither of
    // its pixels: the two programs light a foothill shrub alike (FRAG), and a per-pixel split read as a coarse screen
    // door over every crown 14-26 m off (2026-11-06, iteration 8; Aaron on Teton's sage).
    float nearK = d < mix(nearBand.x, nearBand.y, ph(iPos.xz, 3u)) ? 1.0 : 0.0;
    // a twig shrub with its pictures baked is the far program's from its hand-over on (twigPicture in FRAG)
    int fki = kind < -0.5 ? int(-kind - 0.5) : 0;
    // ... and only seen within TW_EL_HI of the horizontal (the pictures are an eye-height look: from above a sage stand reads
    // by its domes, as before; the coordinator, 2026-11-06, after the 3D crowns from 15-30 m up measured half the domes'
    // contrast); above it the plant is the impostor's as before, the NEAR program's within nearBand
    bool twP = kind < -0.5 && FH_TWIG[fki] > 0.5 && twBase[fki] >= 0.0
            && normalize(cameraPosition - iPos.xyz - vec3(0.0, 0.5 * H, 0.0)).y < sin(radians(twEl.y));
    if (twP) nearK = 0.0;
    #ifdef NEAR
    if (nearK <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    #else
    if (nearK >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    #endif
    float grow = inversesqrt(keep);
    R *= grow; H *= sqrt(grow);
    // the glow (forage.js): the species' weight, the gain, fading with the distance from the body, a boost for the nearest few
    float gwt = kind < -0.5 ? glowFh[int(-kind - 0.5)] : kind < 0.5 ? glowKind.x : kind < 1.5 ? glowKind.y : 0.0;
    float gd = distance(iPos.xz, glow.xy);
    vGlow = gwt * glow.w * pow(clamp(1.0 - gd / max(glow.z, 0.01), 0.0, 1.0), 1.2) * (1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.15 * glow.z, gd)));
    vec3 C = iPos.xyz + vec3(0.0, H * 0.5, 0.0);
    // Wind: woody shrubs lean a few cm in gusts.
    float g = gust(iPos.xz);
    C.xz += windDir * windStrength * g * 0.06 * H;
    vec3 V = normalize(cameraPosition - C);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), V) + vec3(1e-4, 0.0, 0.0));
    vec3 up = cross(V, right);
    // Half extents of the ellipsoid (R across, H/2 tall) projected on the quad's axes.
    float ce = up.y, se = sqrt(max(1.0 - ce * ce, 0.0));
    float ev = sqrt(H * H * 0.25 * ce * ce + R * R * se * se);
    vec2 q = position.xy * 1.2;   // a margin for the lobes and twigs
    // Pulled toward the camera so the ground does not clip it, and shrunk by as much, so it covers the
    // screen of a card standing at the plant (unshrunk, a crown 3 m off drew up to 1.5x its size).
    float dc = distance(cameraPosition, C), pull = min(0.6 * R, max(dc - 0.3, 0.0));
    vec3 p = C + V * pull + (right * q.x * R + up * q.y * ev) * ((dc - pull) / max(dc, 1e-3));
    vQ = q; vRight = right; vView = V; vSeed = seed; vKind = kind; vVar = floor(fract(seed) * 4.0); vDry = dry;
    vUp = up; vYS = R / max(H * 0.5, 0.01);   // sphere normal -> ellipsoid normal: scale its y by R / (H/2)
    vDim = vec4(R, ev, H * 0.5, nearK);
    vLobes = mix(1.0, 2.6, clamp((grow - 1.0) / 1.5, 0.0, 1.0));   // a far, grown impostor is a patch of plants
    vec3 gw; vec3 gc = groundAlbedo(iPos.xyz, 1.5, gw);
    float gl = dot(gc, G_LUMA);
    // Sky light under the canopy, as the terrain takes it: woodland shade from the cover raster and
    // the contact AO blob under near trees. A shrub crown is itself the shrub layer, so it takes only
    // the tree cover's share.
    vec2 guv = groundUv(iPos.xyz);
    float occ = (1.0 - 0.35 * clamp(texture(canopyMap, guv).r * 2.55, 0.0, 1.0)) * treeAO(iPos.xyz);
    // Species colour, varied per shrub and by stand (a warm, olive palette: chamise dark olive-green,
    // whiteleaf manzanita paler, grey-green to glaucous), pulled toward the photo.
    bool fh = kind < -0.5;   // a foothill shrub (FH, kinds -1 to -6): its colour from its species file, this season
    bool manz = kind > 0.5;
    vec3 a = fh ? fhCol[int(-kind - 0.5)] : manz ? vec3(0.09, 0.11, 0.07) : vec3(0.108, 0.113, 0.06);
    float v1 = hh(seed * 7.1), v2 = hh(seed * 3.3), stand = wNoise(iPos.xz * 0.025 + (manz ? 7.0 : fh ? kind : 0.0));
    a *= (manz || fh) ? mix(vec3(0.94, 1.0, 1.1), vec3(1.06, 1.03, 0.9), v1) : mix(vec3(0.9, 1.0, 1.04), vec3(1.1, 1.03, 0.86), v1);
    a *= mix(vec3(1.05, 1.0, 0.9), vec3(0.94, 1.0, 1.06), stand) * (0.78 + 0.44 * v2);
    float al = dot(a, G_LUMA);
    // the chaparral domes are pulled toward the photo under them; a foothill shrub keeps its record's colour (fhSeason)
    if (!fh) a = mix(a, gc * al / max(gl, 1e-3), 0.2) * mix(1.0, clamp(gl / (0.075 * dot(groundGain, G_LUMA)), 0.8, 1.25), 0.5);   // against the ground's reflectance (terrain.js groundGain)
    vAlbedo = a;
    // The cast shadows (shadows.js's cascades), per plant: tested where the crown takes the sun, on its sun-facing side and
    // on its top, half each, not once at its centre 2 m toward the sun. The centre test put a whole crown in a neighbour's
    // shadow (or its own caster's) whenever that one point was: every such plant drew in sky light only, near-black among
    // lit ones, within the near cascade's reach (10-20 m, where the shrubs cast; 2026-11-06, iteration 8: Aaron's black
    // sagebrush on Teton, Lamar's black crowns at eye height).
    float shS = 0.5 * (csmShadow(C + sunDir * max(R, 0.5 * H) + vec3(0.0, 0.25 * H, 0.0), vec3(0.0), 0.0, 0.3, 0.0)
                     + csmShadow(C + vec3(0.0, 0.5 * H, 0.0), vec3(0.0), 0.0, 0.6, 0.0));
    vSun = sunLight * cloudOnly(C) * shS; vAmb = ambientGround * occ; vAmbUp = ambientSky * occ;
    // A twig shrub past its hand-over is lit as its own crown is up close (TwigShrubs), on average: a crown of small leaves
    // turned every way takes the sun at the leaves' mean incidence (0.6 of a face turned to it) and less inside the crown,
    // and the sky less inside it, where a dome lit as one surface took both whole (TW_LIGHT: measured, the 3D crowns' mean
    // linear colour over the impostor's at the probe eye pose, with the sun behind and ahead).
    if (kind < -0.5 && FH_TWIG[int(-kind - 0.5)] > 0.5) { vSun *= TW_LIGHT.x; vAmb *= TW_LIGHT.y; vAmbUp *= TW_LIGHT.y; }
    vIn = atmosphereApply(vec3(0.0), C, cameraPosition);
    vT = atmosphereApply(vec3(1.0), C, cameraPosition) - vIn;
    #ifndef NEAR
    vTw = vec4(0.0);
    if (twP) {
      // the view in the plant's own frame (TwigShrubs turns it by ph salt 6), in tiles of azimuth and elevation
      float rot = ph(iPos.xz, 6u) * 6.2831853, cr = cos(rot), sr = sin(rot);
      float az = atan(cr * V.x + sr * V.z, -sr * V.x + cr * V.z);
      float cls = min(floor(seed / 100.0), 7.0), copy = floor(ph(iPos.xz, 5u) * ${TWIG_COPIES}.0);
      vTw = vec4(twBase[fki] + cls * ${TWIG_COPIES * TB_EL * TB_AZ}.0 + copy * 0.25, fract(az / 6.2831853 + 1.0) * ${TB_AZ}.0,
                 clamp(asin(clamp(V.y, -1.0, 1.0)) * 57.29578 / 30.0, 0.0, ${TB_EL - 1}.0), grow);
    }
    #endif
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */`
  uniform vec3 sunDir; uniform float heads; uniform float dry;   // dry: the season (grass.js's palette value)
  uniform sampler2D leafM; uniform sampler2D leafC; uniform vec4 leafGain; uniform vec2 leafGainF; uniform vec3 leafMean;   // leaf pictures (bakeLeaves); their gain in sun (manzanita, chamise) and in shade (same)
  // The foothill shrubs (FH: kinds -1 to -6, index -1 - kind), this season (fhSeason): leaf-on (0 bare .. 1), the bark
  // and bare-twig albedo, and the flowers or berries showing (albedo, share of the outer crown they cover).
  uniform float fhLeaf[${FH_N}]; uniform vec3 fhBark[${FH_N}]; uniform vec4 fhDeco[${FH_N}];
  uniform vec3 glowCol; varying float vGlow;   // the forager's food (forage.js): the crown's rim lit warm and a skirt past its outline
  // Their outlines (docs/species-library.md, "Foothill shrubs", impostor cards): lobe depth (toyon lumpy in
  // sub-crowns, coffeeberry and coyote brush smooth), how far the fringe breaks up (poison oak and elderberry
  // open and ragged), and a narrow base (redbud's vase, poison oak's leaning stems).
  const float FH_LOBE[${FH_N}] = ${fhArr(0)};
  const float FH_OPEN[${FH_N}] = ${fhArr(1)};
  const float FH_VASE[${FH_N}] = ${fhArr(2)};
  const float FH_FINE[${FH_N}] = ${fhArr(3)};
  const float FH_POR[${FH_N}] = ${fhArr(4)};   // the record's crown porosity
  const float FH_T[${FH_N}] = ${fhArr(5)};     // the fine picture's tile (m), from the record's leaf size
  const float FH_TWIG_F[${FH_N}] = ${twigArr};   // a twig shrub (FH_TWIG)
  uniform sampler2D leafF;   // the fine-leaved shrubs' picture (bakeLeaves 'sprig'): sprigs of small leaves on crooked twigs
  #ifndef NEAR
  // A twig shrub past its hand-over: its pictures (TwigShrubs.bake), each texel lit as the close tier (TWIG_VERT) lights that
  // leaf or that piece of wood. Returns the coverage and the light leaving it (before the air); 0 where nothing is drawn.
  uniform sampler2D twA; uniform sampler2D twB; uniform vec2 twSize; uniform vec3 fhCol[${FH_N}];
  uniform vec3 twBark[${FH_N}]; uniform vec3 twDead[${FH_N}]; varying vec4 vTw; uniform vec2 twEl;
  const vec2 TW_LIGHT_F = vec2(0.58, 0.68);   // VERT's TW_LIGHT, which dims the dome's light: undone for the pictures
  #endif
  varying vec2 vQ; varying vec3 vRight; varying vec3 vUp; varying vec3 vView;
  varying vec3 vAlbedo; varying vec3 vSun; varying vec3 vAmb; varying vec3 vAmbUp; varying vec3 vT; varying vec3 vIn;
  varying float vSeed; varying float vKind; varying float vLobes; varying float vYS; varying float vVar; varying float vDry; varying float vFade;
  varying vec4 vDim;
  float h3(vec3 p) {
    uvec3 q = uvec3(ivec3(floor(p)) + 4096);
    uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u) ^ (q.z * 2798796415u);
    h = (h ^ (h >> 15)) * 2246822519u; h ^= h >> 13;
    return float(h) * (1.0 / 4294967296.0);
  }
  float n3(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // Three randoms for an integer cell.
  vec3 h33(vec3 p) {
    uvec3 q = uvec3(ivec3(floor(p)) + 65536);
    q = q * uvec3(1597334673u, 3812015801u, 2798796415u);
    q = (q.x ^ q.y ^ q.z) * uvec3(1597334673u, 3812015801u, 2798796415u);
    return vec3(q) * (1.0 / 4294967296.0);
  }
  #ifndef NEAR
  vec2 twCell(float t) { return vec2(mod(t, ${TB_COLS}.0), floor(t / ${TB_COLS}.0)); }
  // pk: the pictures' share against the dome (below). A grown plant's picture is the plant at its own size at the card's
  // centre, faded to the dome as it grows.
  float twigPicture(int fk, out vec3 col, out float pk) {
    col = vec3(0.0); pk = 0.0;
    float g = vTw.w, R1 = vDim.x / g, H1 = vDim.z * inversesqrt(g), ce = vUp.y, se = sqrt(max(1.0 - ce * ce, 0.0));
    float ev1 = sqrt(H1 * H1 * ce * ce + R1 * R1 * se * se);
    vec2 u = vec2(vQ.x * g, vQ.y * vDim.y / ev1);   // the card in the plant's own radii (x) and half extents (y)
    float base = floor(vTw.x), copy = fract(vTw.x) * 4.0;
    vec2 uq = u;
    // the pictures' share: whole up to TW_EL_LO above the horizontal, the dome's from TW_EL_HI; and a far plant the density
    // LOD has grown to stand for several goes back to the dome as it grows (1.1x to 1.5x)
    pk = (1.0 - smoothstep(twEl.x, twEl.y, vTw.z * 30.0)) * (1.0 - smoothstep(1.1, 1.5, g));
    if (pk <= 0.0) return 0.0;
    vec2 uv = uq / 2.4 + 0.5, gx = dFdx(u) / 2.4 / twSize, gy = dFdy(u) / 2.4 / twSize;
    // (no coarser than the 8 px mip of a tile: the tiles' margins hold 5 px, so a coarser one would mix in the next)
    float gm = max(length(gx * twSize), length(gy * twSize)) * ${TB_T}.0, gm0 = gm;   // texels per pixel
    if (gm > 8.0) { gx *= 8.0 / gm; gy *= 8.0 / gm; }
    float a0 = floor(vTw.y), wa = smoothstep(0.3, 0.7, vTw.y - a0);
    float e0 = min(floor(vTw.z), ${TB_EL - 2}.0), we = smoothstep(0.3, 0.7, vTw.z - e0);
    float tA = base + copy * ${TB_EL * TB_AZ}.0 + e0 * ${TB_AZ}.0, tB = tA + ${TB_AZ}.0;
    float c0 = mod(a0, ${TB_AZ}.0), c1 = mod(a0 + 1.0, ${TB_AZ}.0);
    float w[4]; float t[4];
    t[0] = tA + c0; t[1] = tA + c1; t[2] = tB + c0; t[3] = tB + c1;
    w[0] = (1.0 - wa) * (1.0 - we); w[1] = wa * (1.0 - we); w[2] = (1.0 - wa) * we; w[3] = wa * we;
    float alpha = 0.0, best = -1.0, tb = t[0]; vec4 A = vec4(0.0);
    for (int i = 0; i < 4; i++) {
      if (w[i] <= 0.0) continue;
      vec4 s = textureGrad(twA, (twCell(t[i]) + uv) / twSize, gx, gy);
      alpha += w[i] * s.a;
      if (w[i] * s.a > best) { best = w[i] * s.a; A = s; tb = t[i]; }
    }
    // the alpha sharpened about 0.5 where the tiles are magnified or near full size (its mips keep the covered share over
    // 0.5: twigMips): a crown's tufts and gaps crisp there; minified, alpha to coverage takes the mips' alpha as it is, so a
    // crown of a few pixels is a soft blob of its coverage, not a speckle of single pixels
    alpha = mix(clamp((alpha - 0.5) / max(fwidth(alpha), 0.05) + 0.5, 0.0, 1.0), alpha, smoothstep(1.0, 3.0, gm0));
    if (alpha < 0.02 || A.a < 0.004) return 0.0;
    vec4 B = textureGrad(twB, (twCell(tb) + uv) / twSize, gx, gy) / A.a;
    A.rgb /= A.a;
    float type = B.a * 3.0, rnd = B.b;
    bool leaf = type < 0.5;
    float deco = leaf ? step(1.0 - fhDeco[fk].a, fract(rnd * 7.31)) : 0.0;
    if (leaf && rnd >= fhLeaf[fk] && deco < 0.5) return 0.0;   // a leafing-out or dropping crown: that share of its tufts
    // the texel's place in its crown: on the card, and its depth along the view
    vec3 Rc = vec3(${(VIS_W / 2).toFixed(3)} * R1, H1, ${(VIS_W / 2).toFixed(3)} * R1);
    vec3 qv = (vRight * (uq.x * R1) + vUp * (uq.y * ev1) + vView * ((A.r * 2.0 - 1.0) * 1.3 * max(Rc.x, H1))) / Rc;
    // the sun through the crown from there to its sunward surface: the record's porosity across a diameter (Beer's law)
    vec3 Ls = sunDir / Rc;
    float qa = dot(Ls, Ls), qb = dot(qv, Ls), qc = dot(qv, qv) - 1.0;
    float tx = max((-qb + sqrt(max(qb * qb - qa * qc, 0.0))) / qa, 0.0);
    float trans = exp(log(max(FH_POR[fk], 0.05)) / (2.0 * dot(Rc, vec3(0.3333))) * tx);
    vec2 n2 = A.gb * 2.0 - 1.0;
    vec3 Nf = normalize(vRight * n2.x + vUp * n2.y + vView * sqrt(max(1.0 - dot(n2, n2), 0.0)));
    float sf = dot(Nf, sunDir), r = length(qv), hf = 0.5 + 0.5 * qv.y;
    vec3 N = leaf ? normalize(normalize(qv / Rc) + vec3(0.0, 0.35, 0.0)) : Nf;
    float diff = leaf ? (sf > 0.0 ? sf : -0.2 * sf) * B.g / ${TUFT_TILT_MEAN.toFixed(2)} : 0.25 + 0.75 * max(sf, 0.0);   // (the leaf's tilt about its mean only: TWIG_FRAG)
    float ao = mix(0.4, 1.0, smoothstep(0.15, 1.0, r)) * mix(0.65, 1.0, clamp(hf * 1.4, 0.0, 1.0));
    vec3 amb = mix(vAmb, vAmbUp, 0.5 + 0.5 * N.y) * (ao / TW_LIGHT_F.y);
    vec3 alb = leaf ? mix(fhCol[fk] * mix(0.86, 1.14, fract(rnd * 5.3)), fhDeco[fk].rgb, deco) : type < 1.5 ? twBark[fk] : type < 2.5 ? fhBark[fk] : twDead[fk];
    col = alb * (amb + vSun * (trans * diff / TW_LIGHT_F.x)) * (leaf ? B.r * 1.25 : 1.0) * 0.3183099;
    if (vGlow > 0.0) col += glowCol * vGlow * dot(vSun * 0.5 + vAmb * 1.5, vec3(0.3333)) * 0.3183099 * (leaf ? 0.25 : 0.08);
    return alpha;
  }
  #endif
  void main() {
    // Distance fades: screen-space dither (the interleaved gradient noise the tree tiers hand over
    // with), never a size change.
    if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vFade) discard;
    // Near and far are two programs from this one source (NEAR defined for the near one), each drawing
    // only its own plants (vDim.w: 1 near, 0 far, per plant; the vertex shader collapses the other's).
    #ifdef NEAR
    const float near = 1.0;
    #else
    const float near = 0.0;
    #endif
    float kind = vKind, vv = vVar;
    bool fh = kind < -0.5;           // a foothill shrub: drawn as manzanita is (leaf masses, stems), with its own look
    int fk = fh ? int(-kind - 0.5) : 0;
    // A twig shrub past its hand-over: its pictures (twigPicture), the dome only for a plant grown to stand for several
    // (blended by vTw.w as it grows, the pictures' coverage and light against the dome's)
    float aP = 0.0, pk = 0.0; vec3 cP = vec3(0.0);
    #ifndef NEAR
    if (vTw.w > 0.0) {
      aP = twigPicture(fk, cP, pk);
      if (pk >= 0.999) {
        if (aP < 0.02) discard;
        gl_FragColor = vec4(cP * vT + vIn, aP);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        return;
      }
    }
    #endif
    bool manz = kind > 0.5, broad = manz || fh, fine = fh && FH_FINE[fk] > 0.5;   // fine: small-leaved shrubs (coyote brush, buckbrush) take chamise's picture
    bool picM = broad && !fine;   // up close: the round-leaf picture (manzanita's) or the fine one (chamise's)
    bool picF = fine;             // a fine-leaved foothill shrub: its own sprig picture, not chamise's wands (2026-11-06)
    vec2 q0 = vQ, q = q0;
    float sc = 0.8, kSub = 0.0, seam = 1.0;
    {
      // A shrub is several stems' crowns, not a ball: a main crown and two smaller ones set off to
      // the sides. Each pixel takes the crown it is deepest inside and is shaded on that crown's own
      // dome, so the outline is a cluster and the shading has a hollow between the masses.
      float k1 = h2(vec2(vSeed, 1.7)) * 6.2832, k2 = h2(vec2(vSeed, 2.9)), k3 = h2(vec2(vSeed, 4.1));
      vec2 o1 = vec2(cos(k1), sin(k1)) * (0.3 + 0.18 * k2), o2 = vec2(cos(k1 + 2.2 + k3), sin(k1 + 2.2 + k3)) * (0.28 + 0.2 * k3);
      float s0 = 0.8, s1 = 0.5 + 0.14 * k2, s2 = 0.44 + 0.14 * k3;
      float e0 = s0 - length(q), e1 = s1 - length(q - o1), e2 = s2 - length(q - o2);
      if (near > 0.0) {   // up close the masses meet along a wavering line, not a straight seam
        float wb = 0.035 * sin(q0.x * 17.0 + vSeed) * sin(q0.y * 13.0 + vSeed * 2.3);
        e1 += wb; e2 -= wb;
      }
      if (e1 > e0 && e1 >= e2) { q = (q - o1) / s1; sc = s1; kSub = 1.0; } else if (e2 > e0) { q = (q - o2) / s2; sc = s2; kSub = 2.0; } else q /= s0;
      float eb = max(e0, max(e1, e2));
      seam = 2.0 * eb - (e0 + e1 + e2 - min(e0, min(e1, e2)));   // how much deeper in this crown than in the next one
      // Outside every crown's widest possible outline (lobes, spikes, dead stems; up close the wands and
      // stems reach a little further): nothing to shade. Most of the quad around a cluster ends here,
      // before any noise is evaluated.
      if (dot(q, q) > (near > 0.0 && !broad ? 2.2 : 1.9) && aP < 0.02) discard;
    }
    float r2 = dot(q, q);
    float z = sqrt(max(1.0 - min(r2, 1.0), 0.0));
    // World normal of the ellipsoid point under this pixel; lobes keyed on it stay put on the plant.
    vec3 nW = vRight * q.x + vUp * q.y + vView * z; nW = normalize(vec3(nW.x, nW.y * vYS, nW.z));
    float lobe = n3(nW * 1.6 * vLobes + vSeed * 37.0), twig = n3(nW * 6.0 * vLobes + vSeed * 11.0);
    // A foothill shrub's flowers or berries this season: clusters over the outer, upper crown, a hash of the crown
    // normal (stable on the plant as the view turns), the share fhDeco.a of them; they stay on a bare crown
    // (redbud's magenta on bare twigs in March).
    // The clusters are the peaks of two octaves of the crown-normal noise above the level that leaves the share uncovered
    // (FDK_Q: the noise's measured quantiles), irregular spots of several sizes: whole cells of the normal's 3D grid (a hash
    // per cell, as before) cut the dome into squares and triangles, a white or magenta checkerboard over a buckbrush or
    // redbud in bloom (2026-11-06, home).
    float fdk = 0.0;
    if (fh && fhDeco[fk].a > 0.0) {
      vec3 fcl = nW * 13.0 * vLobes + vSeed * 13.0;
      float s = fhDeco[fk].a, thr = s < 0.05 ? mix(0.8035, 0.7245, (s - 0.01) / 0.04) : s < 0.15 ? mix(0.7245, 0.646, (s - 0.05) / 0.1)
                                 : s < 0.3 ? mix(0.646, 0.5756, (s - 0.15) / 0.15) : mix(0.5756, 0.4635, (s - 0.3) / 0.3);
      fdk = smoothstep(thr - 0.012, thr + 0.012, 0.65 * n3(fcl) + 0.35 * n3(fcl * 2.3 + 17.0)) * smoothstep(-0.45, 0.25, nW.y);
    }
    float rr = sqrt(r2), aa = fwidth(rr) + 1e-3;
    float rb, alpha, fringe, dead = 0.0;
    // Shrub crown. Variants (vv): chamise 0 rounded, 1 ragged vase, 2 vase with grey dead stems;
    // manzanita 0 upswept, 1 sprawling (set by its proportions), 2 open, red branching showing.
    rb = 0.72 + 0.34 * lobe + 0.14 * (twig - 0.5);
    // Chamise's upright stems: noise stretched along the vertical, so the edge breaks into
    // spikes, not bumps (manzanita's smooth-barked crowns do without).
    float streak = broad ? 0.5 : n3(vec3(nW.x * 9.0, nW.y * 1.6, nW.z * 9.0) * vLobes + vSeed * 17.0);
    bool vase = !broad && vv > 0.5;
    if (manz) rb += 0.12 * smoothstep(0.0, 0.8, q.y) * (lobe - 0.4) - 0.08 * smoothstep(-0.2, -0.9, q.y);
    if (fh) rb += FH_LOBE[fk] * (lobe - 0.5) - FH_VASE[fk] * smoothstep(0.1, -0.8, nW.y) + (fine ? 0.08 * (twig - 0.5) : 0.0);
    // (a twig shrub's crown a little inside the dome: its own crown up close (TwigShrubs) covers ~0.86 of the dome's area,
    // measured at the probe eye pose)
    if (fh && FH_TWIG_F[fk] > 0.5) rb -= 0.06;
    if (vase) rb += -0.24 * smoothstep(0.15, -0.75, nW.y) + 0.26 * (streak - 0.45) * smoothstep(-0.1, 0.6, nW.y);   // narrow base, ragged spiky top
    else if (!broad) rb += 0.1 * (streak - 0.5) * smoothstep(0.0, 0.7, nW.y);
    if (manz && vv > 1.5) rb += 0.1 * (lobe - 0.5);   // open crown: deeper bays between branch masses
    alpha = clamp((rb - rr) / aa + 0.5, 0.0, 1.0);
    // Twiggy fringe: the outer band broken into stems and gaps (more on chamise, most on a vase).
    fringe = smoothstep(rb - (vase ? 0.32 : 0.25), rb, rr);
    if (near < 1.0) {
      if (fringe > 0.0) alpha *= 1.0 - fringe * smoothstep(fh ? FH_OPEN[fk] : manz ? 0.55 : vase ? 0.4 : 0.45, fh ? FH_OPEN[fk] + 0.15 : manz ? 0.7 : vase ? 0.55 : 0.6, n3(nW * 14.0 * vLobes + vSeed * 3.0));
      // A bare deciduous crown (redbud, poison oak, elderberry in winter) is a haze of twigs: a third of its
      // disc, broken by the fine octave, until its leaves come back.
      if (fh && fhLeaf[fk] < 0.999) alpha *= mix(max(0.42 * smoothstep(0.42, 0.6, twig), fdk), 1.0, clamp(fhLeaf[fk] * 1.4, 0.0, 1.0));
      // Dead chamise: bare grey stems poking up out of the crown, past its leafy outline.
      if (!broad && vv > 1.5) {
        float ridge = 1.0 - smoothstep(0.0, 0.15, abs(n3(vec3(nW.x * 5.0, nW.y * 1.2, nW.z * 5.0) + vSeed * 5.0) - 0.5));
        dead = ridge * smoothstep(-0.3, 0.4, nW.y) * step(rr, rb + 0.3);
        alpha = max(alpha, dead * smoothstep(rb + 0.3, rb, rr) * clamp(0.06 / aa, 0.0, 1.0));
      }
    }

    // ---- Near (to nearBand.x, gone by nearBand.y): the plant's own parts. The outline is single leaves
    // and tufts, chamise's wands stand out of it, and the bare stems show under the crown. ----
    float alphaN = 0.0, lres = 0.0, rim = 0.0, wandCov = 0.0, wandLeaf = 0.0, wandTip = 0.0, wandDead = 0.0;
    float stemCov = 0.0, stemDead = 0.0, hgt = 0.0, side = 0.0, body = 1.0, Hh = vDim.z;
    vec4 tex = vec4(0.5, 1.0, 0.5, 0.0);
    vec2 uv = vec2(0.0), ddx = vec2(0.0), ddy = vec2(0.0);   // the leaf picture's coordinates and their gradients
    float spray = 0.5;   // up close: the crown's sprays (outline bumps, and the recesses between them)
    if (near > 0.0) {
      float Rm = vDim.x, ce = vUp.y;
      float rootY = -Hh * ce / vDim.y;   // the root on the card
      vec2 wm = vec2(q0.x * Rm, (q0.y - rootY) * vDim.y);   // metres on the card from the root (y along its up axis)
      float pxm = length(fwidth(wm)) + 1e-5;   // metres per pixel
      hgt = wm.y; side = smoothstep(0.25, 0.65, ce);
      // The lowest ~15% of the height is bare stems (seen from the side), its edge following the lobes.
      float baseH = 2.0 * Hh * (broad ? 0.17 : 0.13) * (0.55 + 0.9 * lobe) * side;
      // Up close the outline breaks into sprays (manzanita: rounded leaf masses; chamise: upright tufts).
      spray = broad ? twig : streak;   // (the crown's own octaves: a further noise here cost 0.75 ms at 3 m)
      // (a porous fine-leaved crown's outline breaks deeper, by its porosity: sagebrush's tufts stand apart at its edge)
      float rbN = rb + (broad ? (0.34 + (picF ? FH_POR[fk] : 0.0)) * (twig - 0.5) : 0.45 * (streak - 0.5) + 0.12 * (twig - 0.5)) * smoothstep(-0.5, 0.2, nW.y);
      float dEdge = min((broad ? rbN : rbN * 0.93) - rr, (hgt - baseH) / max(vDim.y * sc, 0.1));   // > 0 inside the foliage
      // Leaves (manzanita: round, 2.5-5 cm, in sprays, a red twig in the gaps) and needle tufts on wands
      // (chamise), from a baked picture of each (bakeLeaves) wrapped round the crown by azimuth and height
      // (a whole number of tiles round, so no seam) with a flat cap on top: it stays on the plant as the
      // view turns, and its mipmaps fade it to its mean far off. Past the outline the picture runs on
      // outward and only the leaves' cores are kept, so the edge is single leaves and tufts, thinning out.
      vec3 s3 = vRight * q.x + vUp * q.y + vView * z;
      vec3 P = s3 * vec3(Rm, Hh, Rm) * sc;
      float T = picM ? 1.0 : picF ? FH_T[fk] : 0.8, Nu = max(1.0, floor(6.2832 * Rm * sc / T + 0.5)) / 6.2832;
      float az = atan(s3.z, s3.x);
      vec2 hx = dFdx(s3.xz), hy = dFdy(s3.xz);   // the azimuth's gradient, worked out (no jump at its cut)
      vec2 gA = vec2(s3.x * hx.y - s3.z * hx.x, s3.x * hy.y - s3.z * hy.x) / max(dot(s3.xz, s3.xz), 1e-4) * Nu;
      vec2 off = vec2(fract(vSeed * 0.37) + kSub * 0.31, fract(vSeed * 0.61));
      // Rows sheared per plant (a shear keeps the whole number of tiles round); past the outline the
      // picture moves on sideways, so it does not smear outward along the rim.
      float shear = (fract(vSeed * 0.83) - 0.5) * 0.8, ro = max(rr - 1.0, 0.0) * Rm * sc / T;
      uv = vec2(az * Nu + P.y / T * shear + ro, P.y / T) + off;
      ddx = vec2(gA.x + dFdx(P.y) / T * shear, dFdx(P.y) / T), ddy = vec2(gA.y + dFdy(P.y) / T * shear, dFdy(P.y) / T);
      vec2 uvT = P.xz / T + off.yx, dxT = dFdx(P.xz) / T, dyT = dFdy(P.xz) / T;
      float wc = smoothstep(0.45, 0.7, s3.y / max(length(s3), 1e-3));   // the cap
      tex = picM ? textureGrad(leafM, uv, ddx, ddy) : picF ? textureGrad(leafF, uv, ddx, ddy) : textureGrad(leafC, uv, ddx, ddy);
      if (wc > 0.0) tex = mix(tex, picM ? textureGrad(leafM, uvT, dxT, dyT) : picF ? textureGrad(leafF, uvT, dxT, dyT) : textureGrad(leafC, uvT, dxT, dyT), wc);
      // where resolved, a flower cluster is florets: most of the picture's leaves in the spot, the gaps between them leaves
      if (fdk > 0.0) fdk *= mix(1.0, step(fract(tex.b * 3.71), 0.8) * smoothstep(0.4, 0.55, tex.g), lres);
      // A porous crown (the record's porosity) is seen through between its tufts: a share of its gaps are holes through the
      // crown, most toward the outline, where a line of sight crosses the least foliage (whole gaps at a time, chosen by the
      // crown's fine octave: a fractional coverage dithered into a screen door). Its other gaps show its far side: the
      // picture again, offset and scaled, its tufts in the crown's shade.
      float see = picF ? step(twig, clamp(FH_POR[fk] * (1.2 + 1.3 * smoothstep(0.25, 0.9, rr / max(rbN, 0.3))), 0.0, 1.0)) : 0.0;
      if (picF && see < 0.5 && tex.g < 0.45) {
        vec4 t2 = textureGrad(leafF, uv * 0.79 + vec2(0.37, 0.61), ddx * 0.79, ddy * 0.79);
        tex = vec4(mix(tex.r, t2.r * 0.55, step(0.45, t2.g)), max(tex.g, t2.g), t2.b, t2.a * step(0.45, t2.g));
      }
      lres = 1.0 - smoothstep(3.0, 9.0, 512.0 * max(max(length(ddx), length(ddy)), wc * max(length(dxT), length(dyT))));
      rim = smoothstep(0.22, 0.0, dEdge);
      float outer = clamp(-dEdge / 0.2, 0.0, 1.0), thr = mix(0.5, 0.93, outer), gw = 0.5 * fwidth(tex.g) + 0.02;
      body = mix(alpha, mix(1.0, smoothstep(thr - gw, thr + gw, tex.g), max(rim, see)) * step(-0.2, dEdge), lres);   // foliage coverage
      if (fh && fhLeaf[fk] < 0.999) body *= max(step(fract(tex.b * 5.31), fhLeaf[fk]), fdk);   // a leafing-out or dropping crown: that share of its leaves (and its flowers)
      // Wood is drawn only where it can show: where the foliage does not cover the pixel, or through a
      // gap in the picture in the lower crown (most of a crown's face skips it).
      bool need = body < 0.99 || (tex.g < 0.5 && hgt < Hh * 0.75);
      if (!need) alphaN = body;
      else if (!broad) {
        // Chamise: 15-35 stiff wands fanning up from the burl (from above, all round), bowing outward;
        // each ends a little inside or past the leafy outline, tufted along its upper part, rust-tipped
        // in summer and fall. Decadent plants: many bare grey wands, poking out further.
        float rho = length(wm), th = atan(wm.x, wm.y);
        float spread = mix(3.1416, 0.8, side);
        float nw = floor(mix(16.0, 34.0, h2(vec2(vSeed, 8.3))) * spread / 0.8);
        float slot = 2.0 * spread / nw, i0 = floor((th + spread) / slot);
        float deadShare = vv > 1.5 ? 0.45 : 0.08, bow = 0.18 / max(Hh, 0.3);
        for (int j = -1; j <= 1; j++) {
          if (rr - rbN > 0.45 && hgt > Hh * 0.9) break;   // past every wand's reach
          float id = i0 + float(j);
          if (id < 0.0 || id >= nw) continue;
          vec3 r = h33(vec3(id, floor(vSeed * 7.0), 11.0));
          float tc = (id + 0.5 + 0.7 * (r.x - 0.5)) * slot - spread;
          bool dw = r.y < deadShare;
          float ext = dw ? mix(0.0, 0.45, r.z) : mix(-0.3, 0.36, r.z);   // reach past the leafy outline
          float ex = step(rr - rbN, ext) + step(hgt, Hh * 0.9);
          if (ex <= 0.0 || rho < 0.02) continue;
          float leafy = dw ? 0.0 : smoothstep(baseH, baseH + 0.2, hgt);
          float bead = smoothstep(0.34, 0.06, abs(fract(rho / 0.045 + r.z * 5.0) - 0.5)) * leafy;
          float hw = 0.003 + 0.009 * bead;
          float dd = rho * abs(th - tc * (1.0 + bow * rho));
          float cov = clamp((hw - dd) / pxm + 0.5, 0.0, 1.0);
          if (cov > wandCov) { wandCov = cov; wandLeaf = bead; wandDead = dw ? 1.0 : 0.0; wandTip = smoothstep(ext - 0.22, ext, rr - rbN) * leafy; }
        }
        alphaN = max(body, wandCov);
      } else {
        // Manzanita: 3-4 crooked stems from one base, spreading 20-45 degrees, each forking once,
        // with smooth S-bends; maroon, some grey and dead. Seen under the crown and through its holes.
        float ns = 3.0 + floor(h2(vec2(vSeed, 5.5)) * 2.0);
        // (Only within the crown or under it, and inside the fan the stems can reach: the loop is the
        // costliest part of the near crown.)
        float inside = side * max(step(-0.08, dEdge), step(hgt, baseH * 1.4));
        if (inside > 0.0 && hgt > 0.0 && hgt < max(baseH * 1.4, 1.2 * Hh) && abs(wm.x) < 0.12 * Rm + hgt * 1.6 + 0.08) {
          for (int j = 0; j < 4; j++) {
            if (float(j) >= ns) break;
            vec3 r = h33(vec3(float(j), floor(vSeed * 7.0), 23.0));
            float a = ((float(j) + 0.3 + 0.4 * r.x) / ns * 2.0 - 1.0) * 0.8;
            float x0 = (r.y - 0.5) * 0.15 * Rm, hf = (0.25 + 0.3 * r.z) * Hh;
            float wig = 0.04 * Rm * sin(hgt * 9.0 / max(Hh, 0.4) + r.z * 6.28) * min(hgt * 4.0, 1.0);
            float xs = x0 + hgt * tan(a) + wig;
            float hw = mix(0.035, 0.012, clamp(hgt / (1.3 * Hh), 0.0, 1.0)) * (0.7 + 0.5 * r.y) * clamp(Rm, 0.6, 1.4);
            float cov = clamp((hw - abs(wm.x - xs) * cos(a)) / pxm + 0.5, 0.0, 1.0);
            if (hgt > hf) {   // the fork: a second limb leaves at hf, bending away
              float a2 = a + (r.x > 0.5 ? 0.45 : -0.45);
              float xf = x0 + hf * tan(a) + wig + (hgt - hf) * (tan(a2) - tan(a));
              cov = max(cov, clamp((hw * 0.75 - abs(wm.x - xf) * cos(a2)) / pxm + 0.5, 0.0, 1.0));
            }
            cov *= smoothstep(1.4 * Hh, 0.9 * Hh, hgt);
            if (cov > stemCov) { stemCov = cov; stemDead = step(r.z, vv > 1.5 ? 0.3 : 0.12); }
          }
          stemCov *= inside;
        }
        alphaN = max(body, stemCov);
      }
      alpha = alphaN;
    }
    float gref = dot(vSun * 0.5 + vAmb * 1.5, vec3(0.3333)) * 0.3183099;   // the glow's level against the light of the hour
    if (alpha < 0.05 && aP < 0.02) {
      // outside the crown: a soft skirt of the glow past its outline (forage.js), else nothing
      float hal = vGlow * (1.0 - smoothstep(rb, rb + 0.25, rr)) * 0.22;
      if (hal < 0.02) discard;
      gl_FragColor = vec4(glowCol * hal * gref * vT, hal);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    // Leaf clusters: brighter sunlit clumps over dark holes into the crown (up close, from the octaves
    // already at hand: the leaf picture carries the finer structure).
    #ifdef NEAR
    float lc = lobe * 0.35 + twig * 0.65;
    #else
    float lc = n3(nW * 4.0 * vLobes + vSeed * 5.0) * 0.6 + twig * 0.4;
    #endif
    // (a porous crown is lit tuft by tuft more than as one dome: its normal bent further by the crown's octaves)
    vec3 N = normalize(nW + (vec3(lobe, 0.5, twig) - 0.5) * (fine ? 0.9 + 2.0 * FH_POR[fk] : 0.9));
    float diff = max(dot(N, sunDir), 0.0);
    // A porous foothill crown lets the sun through its tufts: its far side is lit through the crown (a wrap of 2 x its
    // porosity, both programs alike), so a sagebrush reads as a soft grey bush, not a stone with a hard terminator.
    if (fh) { float wr = 2.0 * FH_POR[fk]; diff = max((dot(N, sunDir) + wr) / (1.0 + wr), 0.0); }
    float ao = mix(0.6, 1.0, smoothstep(-0.7, 0.6, nW.y)) * mix(0.75, 1.0, lc);
    vec3 amb = mix(vAmb, vAmbUp, 0.5 + 0.5 * N.y);
    vec3 outH = vec3(0.0), outN = vec3(0.0);
    if (near < 1.0) {
      // Close up, a crown is many small leaf sprays: a fine octave, only where it is resolved.
      // Two fine octaves, the finer one cutting small dark gaps between sprays, so a near crown
      // is a mass of foliage and not a soft pebble.
      float lch = lc;
      float close = 1.0 - smoothstep(0.01, 0.03, aa), gap = 1.0;
      if (close > 0.0) {
        float f1 = n3(nW * 22.0 + vSeed * 7.0), f2 = n3(nW * 55.0 + vSeed * 2.0);
        lch = mix(lc, lc * 0.5 + 0.32 * f1 + 0.3 * f2, close);
        gap = mix(1.0, 0.45 + 0.55 * smoothstep(0.18, 0.42, f2), close);
      }
      vec3 col = vAlbedo * (0.6 + 0.8 * lch) * gap;
      if (fh) {
        // The foothill shrubs: the shaded inside of the crown in its holes, the bare twigs where the leaves are
        // gone (a deciduous crown in winter), and this season's flowers or berries as specks on the outer,
        // upper crown (toyon's red berries in winter, redbud's magenta in March, elderberry's cream plates).
        float hole = smoothstep(0.3, 0.16, lch) * (1.0 - fringe * 0.7);
        col = mix(col, vAlbedo * 0.4, hole * 0.7);
        col = mix(fhBark[fk] * (0.7 + 0.6 * lch), col, clamp(fhLeaf[fk] * 1.25, 0.0, 1.0));
        col = mix(col, fhDeco[fk].rgb * (0.85 + 0.3 * lch), fdk * 0.95);
      } else if (manz) {
        // Whiteleaf manzanita's smooth red-mahogany branches: under the crown where the view looks
        // in, and through the holes in the foliage (wide open on the open variant, few on the sprawl).
        float stem = step(0.8, h2(floor(vec2(q.x * 7.0 + vSeed * 3.0, 1.0)))) * smoothstep(0.0, -0.6, q.y) * smoothstep(0.3, -0.2, nW.y);
        float holeT = vv > 1.5 ? 0.42 : vv > 0.5 ? 0.26 : 0.34;
        float hole = smoothstep(holeT, holeT - 0.14, lch) * (1.0 - fringe * 0.7);
        // Branches: long, crooked lines (ridges of a low, vertically stretched noise), not specks.
        float branch = 1.0 - smoothstep(0.0, 0.1, abs(n3(vec3(nW.x * 2.2, nW.y * 4.5, nW.z * 2.2) + vSeed * 9.0) - 0.5));
        vec3 bark = vec3(0.2, 0.055, 0.03);
        // The red trunks show under the umbrella of foliage (lower half of the crown) and in the
        // deepest holes; the sprawling form keeps its branches hidden.
        float under = smoothstep(0.15, -0.5, nW.y) * (vv > 0.5 && vv < 1.5 ? 0.3 : 1.0);
        float showB = clamp(hole * smoothstep(0.1, -0.3, nW.y - 0.3) + under * smoothstep(0.6, 0.35, lch), 0.0, 1.0);
        col = mix(col, vAlbedo * 0.35, hole * 0.8);   // the shaded inside of the crown
        col = mix(col, bark, max(stem * 0.6, branch * showB * 0.85) * (1.0 - lch * 0.5));
      } else {
        if (dead > 0.0) col = mix(col, vec3(0.27, 0.255, 0.23), dead * (1.0 - smoothstep(0.55, 0.85, lch)));
        // Chamise in summer and fall: rusty flower clusters dried on the branch tips, on some plants.
        float rust = vDry * step(0.45, fract(vSeed * 0.731)) * smoothstep(0.55, 0.8, lch) * smoothstep(0.0, 0.6, nW.y);
        col = mix(col, vAlbedo * vec3(1.9, 1.15, 0.7), rust * 0.6);
      }
      float aoH = mix(0.6, 1.0, smoothstep(-0.7, 0.6, nW.y)) * mix(0.75, 1.0, lch);
      outH = col * (vSun * diff * mix(0.75, 1.0, lch) + amb * aoH);
    }
    if (near > 0.0) {
      // Season (species files, as a change of hue on the photo-matched colour, luminance kept within
      // about 10%): chamise darkest and greenest after the rains, rust in fall; manzanita a little
      // warmer in spring. Flower and seed tips: chamise cream (spring), rust (summer, fall), old brown
      // heads (winter); manzanita's white-pink flowers in winter and early spring.
      float wW = 1.0 - step(0.05, dry), wF = step(0.5, dry) * (1.0 - step(0.93, dry)), wS = step(0.05, dry) * (1.0 - step(0.5, dry)), wU = step(0.93, dry);
      vec3 tint = fh ? vec3(1.0) : manz ? wW * vec3(0.93, 0.98, 0.99) + wS * vec3(1.08, 0.98, 1.03) + wU + wF * vec3(0.96, 0.98, 1.0)
                       : wW * vec3(0.8, 0.96, 0.78) + wS * vec3(1.08, 1.06, 1.04) + wU + wF * vec3(1.08, 0.96, 0.94);
      vec3 tipRel = fh ? fhDeco[fk].rgb / max(vAlbedo, vec3(1e-3)) : manz ? vec3(2.6, 2.3, 2.4) : wW * vec3(1.4, 0.8, 0.55) + wS * vec3(3.2, 3.0, 2.9) + wU * vec3(2.1, 1.15, 0.65) + wF * vec3(1.8, 0.82, 0.5);
      float pl = fract(vSeed * 0.731);   // per plant: does it carry flowers or seed heads this year
      float tipShare = fh ? 0.0 : manz ? (wW * 0.06 + wS * 0.025) : step(0.3, pl) * (wW * 0.08 + wS * 0.2 + (wU + wF) * 0.22);
      vec3 fol = vAlbedo * tint;
      float cl = (0.6 + 0.8 * lc) * mix(0.8, 1.05, smoothstep(0.25, 0.65, spray));
      vec3 sunL = vSun * diff * mix(0.75, 1.0, lc) * mix(0.7, 1.0, smoothstep(0.2, 0.6, spray)), ambL = amb * ao;
      // The picture: shade (front leaves light, the next ones in half shaded, the gaps dark), coverage,
      // a random per leaf, wood. A manzanita leaf is held upright at its own azimuth, so it catches the
      // sun or stands edge-on to it; pale and glaucous. Chamise tufts an olive grain; tufts (or leaves)
      // near the top carry the season's flowers or seed heads. Wood: manzanita maroon, chamise grey-brown,
      // grey when dead (the random of a wood stroke).
      // Each leaf a little darker at its edge, so overlapping leaves part.
      float shade = tex.r * mix(1.0, mix(0.78, 1.04, clamp(tex.g * 2.0 - 1.0, 0.0, 1.0)), step(0.5, tex.g) * lres);
      float rnd = tex.b, woodF = tex.a, lv = fract(rnd * 7.31);
      float leafSun = 1.0; vec3 colF;
      if (broad && !fine) {
        float laz = rnd * 6.2832;
        leafSun = mix(1.0, 0.45 + 1.1 * abs(dot(vec3(cos(laz), 0.0, sin(laz)), sunDir)), lres * (1.0 - woodF));
        colF = fol * mix(vec3(0.85, 0.9, 0.86), vec3(1.2, 1.2, 1.28), lv);
      } else colF = fol * mix(0.8, 1.2, lv) * vec3(0.92, 1.0, 1.04);   // (the brown wands in the picture warm the mean)
      if (fh) colF = mix(colF, fhDeco[fk].rgb * mix(0.9, 1.15, lv), fdk);
      // (Tips carry the leaves' sun gain too, so chamise's are taken down by its larger gain.)
      // (strictly under the share: in the picture's gaps the per-leaf random is 0, and step(0, 0) is 1, which drew a foothill
      // shrub out of flower, whose tip colour is its flowers' (none: black), as black holes all through its crown)
      colF = mix(colF, fol * tipRel * (broad ? 1.0 : 0.6), float(rnd < tipShare * smoothstep(broad ? 0.0 : 0.1, 0.6, nW.y)) * lres);
      vec3 barkC = fh ? fhBark[fk] : manz ? vec3(0.12, 0.042, 0.038) : vec3(0.15, 0.11, 0.08), deadC = broad ? vec3(0.24, 0.23, 0.2) : vec3(0.24, 0.225, 0.2);
      float woodCov = broad ? stemCov : wandCov;
      vec3 woodLit = mix(barkC, deadC, broad ? stemDead : wandDead) * (sunL * 0.4 + amb * 1.1);
      vec3 texWood = mix(barkC, deadC, step(0.5, rnd)) * 0.8;
      if (!broad) woodLit = mix(woodLit, mix(fol, fol * tipRel * 0.6, wandTip * step(0.001, tipShare)) * cl * (sunL * 0.8 + ambL), wandLeaf);
      vec3 base = mix(colF, texWood, woodF);
      vec2 gn = picM ? leafGain.xz : picF ? leafGainF : leafGain.yw;
      vec3 folLit = base * cl * (sunL * leafSun * shade * gn.x + ambL * (0.5 + 0.5 * shade) * gn.y);
      // A foothill shrub up close is lit as its far program lights it (the same albedo, dome, clusters, sun and sky:
      // outH above), the picture only modulating that around its own mean (leafMean: the picture's mean shade over its
      // leaves), at 0.6 of its contrast, so near and far are one colour by construction (2026-11-06, iteration 8: the
      // measured gains put the sprig's lit tufts at 2.5-3.7x the record's albedo, white over the far side's dark gaps,
      // Lamar's and Teton's sage read as snow-dusted stones). The chaparral keeps its measured gains.
      if (fh) {
        float kS = mix(1.0, shade / (picM ? leafMean.x : picF ? leafMean.z : leafMean.y), 0.6);
        folLit = base * (0.6 + 0.8 * lc) * kS * (vSun * diff * mix(0.75, 1.0, lc) * leafSun + ambL);
        // and where the picture is not resolved, the crown's holes in its shaded inside, as the far program draws them
        folLit *= mix(1.0, 0.4 / (0.6 + 0.8 * lc), smoothstep(0.3, 0.16, lc) * (1.0 - fringe * 0.7) * 0.7 * (1.0 - lres));
      }
      // The geometric stems and wands show through the picture's gaps in the lower crown and the holes.
      float show = max(rim, smoothstep(Hh * 0.75, Hh * 0.45, hgt));
      folLit = mix(folLit, woodLit, woodCov * show * (1.0 - smoothstep(0.3, 0.5, tex.g)) * lres);
      // In the crown's notches between its masses, shade.
      float crev = mix(0.6, 1.0, smoothstep(0.0, 0.12, seam));
      // Where only a wand or a stem covers the pixel, it is drawn.
      outN = mix(woodLit, folLit, clamp(body / max(alpha, 1e-3), 0.0, 1.0)) * crev;
    }
    vec3 outC = (near > 0.0 ? outN : outH) * 0.3183099;
    if (vGlow > 0.0) outC += glowCol * vGlow * gref * (0.12 + 0.38 * (1.0 - z * z));   // the glow: most at the rim of the dome
    if (pk > 0.0) {   // between the pictures and the dome (a growing far plant)
      float aD = alpha < 0.05 ? 0.0 : alpha, a2 = mix(aD, aP, pk);
      if (a2 < 0.02) discard;
      outC = (outC * aD * (1.0 - pk) + cP * aP * pk) / a2; alpha = a2;
    }
    gl_FragColor = vec4(outC * vT + vIn, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Water at a point, for vegetation placement: 255 in a pond or a stream channel, 1..200 in the
// riparian band (200 at the centreline), 0 on dry land, from tile.waterMask's 5 m grid. The grid
// settles open water and dry land; within a pixel of a shore or a channel the exact test decides, so
// nothing stands on the water and no 5 m bare margin opens along a bank. Deterministic per point.
export function waterAt(wm, x, n) {
  if (!wm) return 0;
  const W = wm.width, r = wm.res;
  const i = Math.min(Math.max(Math.floor(x / r), 0), W - 1), j = Math.min(Math.max(Math.floor((wm.size - n) / r), 0), W - 1);
  const g = wm.channel(i, j);
  const a = wm.channel(Math.max(i - 1, 0), j), b = wm.channel(Math.min(i + 1, W - 1), j);
  const c = wm.channel(i, Math.max(j - 1, 0)), d = wm.channel(i, Math.min(j + 1, W - 1));
  if (g === 255 && a === 255 && b === 255 && c === 255 && d === 255) return 255;
  if (g === 0 && a !== 255 && b !== 255 && c !== 255 && d !== 255) return 0;
  return wm.inWater(x, n) ? 255 : g === 255 ? 200 : g;
}
function hash2(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// A clump field. cfg:
//   cellAny(i, j)    may this cell hold clumps (cheap test, also used to skip empty ground)
//   coverAt(x, n)    target cover 0..coverMax at a point
//   coverMax         the most cover anywhere (sets the candidates per cell)
//   meanArea         mean crown area, m^2
//   plant(x, n, rnd, cover) -> [kind, R, H, variant 0..3], or null to drop the candidate
//   D0, KMIN         LOD: full density to D0, then keep (D0/d)^2, never below KMIN
//   band             [in0, in1, out0, out1] distance fades (per-plant cut-offs spread over each pair,
//                    dithered, no size change); range is out1
//   now              cells nearer than this are generated at once, the rest a couple of ms per frame
//   cap, salt, roadsMax
//   riparian         0..1: share of clumps thinned out at a stream centreline, less across the
//                    riparian band (none in water whatever this is)
//   cellList(i, j)   optional: the cell's instances (STRIDE floats each, rank slot free) from an
//                    outside placement, in random order; replaces cellAny's candidates and plant()
//   extraAny(i, j), extra(i, j)   optional: more plants of the cell from a placement of their own (ShrubField:
//                    the foothill shrubs), instances in rank order with their ranks set; they are merged into
//                    the cell's list by rank, so the cell's own plants keep their ranks and any prefix is still
//                    an even subsample of both
//   shader           optional: { vertexShader, fragmentShader, uniforms } in place of the shrub shader
export class ClumpField {
  constructor(tile, ground, uniforms, cfg) {
    this.tile = tile; this.ground = ground; this.cfg = cfg;
    this.cache = new Map(); this.cells = []; this.last = null; this.sig = NaN; this.n = 0;
    this.W = tile.habitat.img.width; this.H = tile.habitat.img.height;
    this.lamMax = lam(cfg.coverMax);
    this.any = cfg.extraAny ? (i, j) => cfg.cellAny(i, j) || cfg.extraAny(i, j) : cfg.cellAny;
    // cfg.shader: { vertexShader, fragmentShader, uniforms } replaces the shrub shader (the instance
    // layout and the kParams / band uniforms stay, so shadows.js can cast from any field).
    const sh = cfg.shader || {};
    this.uniforms = { ...groundUniforms, ...windUniforms, ...atmo, heightScale: uniforms.heightScale, heads: uniforms.heads, dry: uniforms.dry || { value: 1 },
      ...(sh.uniforms || {}), kParams: { value: new THREE.Vector2(cfg.D0, cfg.KMIN) }, band: { value: new THREE.Vector4(...cfg.band) } };
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cfg.cap * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    g.setAttribute('iVar', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ vertexShader: sh.vertexShader || VERT, fragmentShader: sh.fragmentShader || FRAG, uniforms: this.uniforms, alphaToCoverage: true });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.name = cfg.name;
    // cfg.near (the shrub shader only): the near plants are drawn by a second program from the same
    // source (NEAR defined), a child of the mesh on the same instances, so the far one stays as cheap
    // as before and only near pixels pay for the near detail.
    if (cfg.near && !cfg.shader) {
      const nm = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, alphaToCoverage: true, defines: { NEAR: '' } });
      this.nearMesh = new THREE.Mesh(g, nm); this.nearMesh.frustumCulled = false; this.nearMesh.name = cfg.name + '-near';
      this.nearMesh.renderOrder = -1;   // first, so far plants behind near crowns fail the depth test before shading
      this.mesh.add(this.nearMesh);
    }
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._sph = new THREE.Sphere();
  }
  get count() { return this.n; }
  // A larger instance buffer (grass.js, a tile with tufts: a denser field); before the first update.
  setCap(cap) {
    if (cap <= this.cfg.cap) return;
    this.cfg.cap = cap; const g = this.mesh.geometry;
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    g.setAttribute('iVar', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    this.sig = NaN;
  }

  // Clumps of one cell in random order (any prefix is an even subsample), with a bounding sphere.
  cellData(i, j) {
    const key = j * this.W + i, cfg = this.cfg;
    let c = this.cache.get(key);
    if (c) return c;
    const { habitat: hab, size, roads, waterMask: wm } = this.tile, res = hab.res;
    let out = [];
    if (cfg.cellList) {
      // An outside placement (grass.js), already in rank order: any prefix is an even subsample.
      out = cfg.cellList(i, j);
      const m = out.length / STRIDE;
      for (let k = 0; k < m; k++) out[k * STRIDE + 7] = (k + 0.5) / m;
    } else if (cfg.cellAny(i, j)) {
      const n = Math.round(this.lamMax * res * res / cfg.meanArea), rnd = mulberry32((i * 73856093) ^ (j * 19349663) ^ cfg.salt);
      for (let k = 0; k < n; k++) {
        const px = (i + rnd()) * res, pn = size - (j + rnd()) * res, keep = rnd();
        const cov = cfg.coverAt(px, pn);
        if (cov <= 0 || keep * this.lamMax >= lam(cov)) { rnd(); rnd(); rnd(); rnd(); continue; }
        if (roads && roads.at(px, pn) > cfg.roadsMax) { rnd(); rnd(); rnd(); rnd(); continue; }
        // Nothing in ponds or stream channels; tussocks and oats thin out toward a creek.
        const wv = waterAt(wm, px, pn);
        if (wv === 255 || (wv && cfg.riparian && keep * this.lamMax >= lam(cov) * (1 - cfg.riparian * wv / 200))) { rnd(); rnd(); rnd(); rnd(); continue; }
        const pl = cfg.plant(px, pn, rnd, cov);
        if (!pl) continue;   // plant() may thin its own candidates (ShrubField: by expected crown size)
        const [kind, R, Hh, variant = 0] = pl;
        out.push(px, this.ground(px, pn), -pn, R, Hh, Math.floor(rnd() * 100) + (variant + 0.5) / 4, kind, 0);
      }
      const m = out.length / STRIDE;
      for (let k = 0; k < m; k++) out[k * STRIDE + 7] = (k + 0.5) / m;   // rank: the order is already random
    }
    if (cfg.extra && cfg.extraAny(i, j)) out = mergeByRank(out, cfg.extra(i, j));
    c = { data: new Float32Array(out), n: out.length / STRIDE, x: (i + 0.5) * res, y: 0, z: -(size - (j + 0.5) * res), r: res };
    // On a tile with the lidar residual the plants stand on the 1 m ground (Heightfield.at), which only the fine
    // square near the player draws; beyond it the 10 m mesh is drawn. dc: the 10 m mesh minus the 1 m ground at
    // each root, and dataC the cell as drawn on the 10 m mesh, so update() stands every plant on the surface drawn
    // under it (Heightfield.fineShare) and re-seats them when the square moves.
    const hf = this.tile.heights;
    if (hf.detail && c.n) {
      const d = c.data, dc = c.dc = new Float32Array(c.n), dataC = c.dataC = d.slice();
      for (let k = 0, o = 0; k < c.n; k++, o += STRIDE) { const x = d[o], pn = -d[o + 2]; dc[k] = hf.coarse(x, pn) - hf.at(x, pn); dataC[o + 1] += dc[k]; }
    }
    if (out.length) {
      let y0 = Infinity, y1 = -Infinity, hm = 0;
      for (let o = 0; o < out.length; o += STRIDE) { y0 = Math.min(y0, out[o + 1]); y1 = Math.max(y1, out[o + 1]); hm = Math.max(hm, out[o + 4]); }
      c.y = (y0 + y1) / 2 + hm; c.r = Math.hypot(res * 0.71 + 3, (y1 - y0) / 2 + 2 * hm);
    }
    if (this.cache.size > 3000) this.cache.clear();
    this.cache.set(key, c);
    return c;
  }

  // Cells within range that may hold clumps, nearest first.
  gather(x, north) {
    const res = this.tile.habitat.res, size = this.tile.size, r = this.cfg.band[3], cells = [];
    const i0 = Math.max(0, Math.floor((x - r) / res)), i1 = Math.min(this.W - 1, Math.floor((x + r) / res));
    const j0 = Math.max(0, Math.floor((size - north - r) / res)), j1 = Math.min(this.H - 1, Math.floor((size - north + r) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!this.any(i, j)) continue;
      const d = Math.hypot((i + 0.5) * res - x, size - (j + 0.5) * res - north);
      if (d <= r + res * 0.71) cells.push([d, i, j]);
    }
    this.cells = cells.sort((a, b) => a[0] - b[0]);
  }

  // band: optional [in0, in1, out0, out1] override for this frame.
  update(camera, on = true, band = null) {
    if (band) this.uniforms.band.value.set(...band);
    if (this.enabled === false || !on) { this.mesh.visible = false; return; }
    const cp = camera.position, north = -cp.z, cfg = this.cfg;
    if (!this.last || Math.hypot(cp.x - this.last[0], north - this.last[1]) > REFILL_MOVE) { this.last = [cp.x, north]; this.gather(cp.x, north); this.sig = NaN; }
    if (!this.cells.length) { this.mesh.visible = false; this.n = 0; return; }
    const t0 = performance.now();
    for (const [d, i, j] of this.cells) {
      if (this.cache.has(j * this.W + i)) continue;
      if (d > cfg.now && performance.now() - t0 > 2) break;
      this.cellData(i, j); this.sig = NaN;
    }
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const sph = this._sph, arr = this.buf.array, pick = [], D2 = cfg.D0 * cfg.D0;
    let sig = 0, total = 0;
    for (const [, i, j] of this.cells) {
      const c = this.cache.get(j * this.W + i);
      if (!c || !c.n) continue;
      const dc = Math.hypot(c.x - cp.x, c.y - cp.y, c.z - cp.z);
      if (dc - c.r > cfg.band[3] || dc + c.r < cfg.band[0]) continue;
      sph.center.set(c.x, c.y, c.z); sph.radius = c.r;
      if (!this._frustum.intersectsSphere(sph)) continue;
      const d = Math.max(dc - c.r, 1), keep = Math.min(Math.max(D2 / (d * d), cfg.KMIN), 1);
      const m = Math.min(c.n, Math.ceil(c.n * (keep + 0.06)));
      if (total + m > cfg.cap) break;
      pick.push(c, m); total += m; sig = (Math.imul(sig, 31) + j * this.W + i + m * 7919) | 0;
    }
    const hf = this.tile.heights, F = hf.fine;
    if (F !== this.fine) { this.fine = F; this.sig = NaN; }   // the fine square moved: re-seat
    if (sig !== this.sig) {
      this.sig = sig; let n = 0;
      const half = this.tile.habitat.res / 2, band = F ? F.band : 0;
      for (let k = 0; k < pick.length; k += 2) {
        const c = pick[k], m = pick[k + 1];
        if (!c.dc) { arr.set(c.data.subarray(0, m * STRIDE), n * STRIDE); n += m; continue; }
        // the cell's square against the fine square: wholly on the 10 m mesh, wholly on the fine mesh, or across its band
        const cx = c.x, cn = -c.z, out = !F || cx + half <= F.x0 || cx - half >= F.x1 || cn + half <= F.n0 || cn - half >= F.n1;
        const inner = F && cx - half >= F.x0 + band && cx + half <= F.x1 - band && cn - half >= F.n0 + band && cn + half <= F.n1 - band;
        arr.set((out ? c.dataC : c.data).subarray(0, m * STRIDE), n * STRIDE);
        if (!out && !inner) for (let q = 0, o = n * STRIDE; q < m; q++, o += STRIDE) arr[o + 1] += (1 - hf.fineShare(arr[o], -arr[o + 2], F)) * c.dc[q];
        n += m;
      }
      this.n = n; this.mesh.geometry.instanceCount = n;
      this.buf.clearUpdateRanges(); this.buf.addUpdateRange(0, Math.max(n, 1) * STRIDE); this.buf.needsUpdate = true;
    }
    this.mesh.visible = this.n > 0;
  }
}

// Two instance lists in rank order (slot 7) merged into one, still in rank order.
function mergeByRank(a, b) {
  if (!b.length) return a;
  if (!a.length) return b;
  const out = new Array(a.length + b.length);
  let i = 0, j = 0, o = 0;
  while (i < a.length || j < b.length) {
    const src = j >= b.length || (i < a.length && a[i + 7] <= b[j + 7]) ? a : b, k = src === a ? i : j;
    for (let c = 0; c < STRIDE; c++) out[o++] = src[k + c];
    if (src === a) i += STRIDE; else j += STRIDE;
  }
  return out;
}

// Leaf pictures for the near crowns, drawn once at load (canvas 2D), 512 px tiles that repeat, mipmapped:
// r shade (front leaves light, the leaves behind them half shaded, the gaps dark), g coverage (0.5 at a
// leaf's edge to 1 at its middle, 0 in a gap: the shader keeps only the cores past the crown's outline),
// b a random per leaf or stroke (a manzanita leaf's azimuth, flowers and seed heads; for wood, dead or
// alive), a wood. Manzanita (1 m tile): stiff round leaves 2.5-5 cm in sprays, each upright at its own
// azimuth (round face-on, a sliver edge-on), red twigs in the gaps. Chamise (0.8 m): upright wands, a few
// dead, with tufts of needles along them.
// Baked once per page (shrubLeaves; grass.js asks for each while the world builds, a task each, so ShrubField finds them).
// kind: true manzanita, false chamise, 'sprig' the fine-leaved foothill shrubs (2026-11-06, iteration 8: big sagebrush,
// coyote brush, buckbrush, snowberry drew chamise's wands, long dark stripes down a sagebrush; the sprig picture is small
// leaves in tufts at the ends of short crooked twigs, the gaps between tufts open, sized by the record's leaf: FH_T).
const leafPictures = new Map(), leafCoverage = new Map(), leafShadeMean = new Map();
export { leafCoverage };
export function shrubLeaves(kind) { let t = leafPictures.get(kind); if (!t) leafPictures.set(kind, t = bakeLeaves(kind)); return t; }
function bakeLeaves(kind) {
  const manz = kind === true, sprig = kind === 'sprig';
  const S = 512, rnd = mulberry32(manz ? 0x1eaf5 : sprig ? 0x5b41c : 0xc4a35);
  const ch = [0, 1, 2, 3].map(k => { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); g.fillStyle = k ? '#000' : sprig ? '#555' : '#333'; g.fillRect(0, 0, S, S); return g; });   // (the sprig's ground lighter: a porous crown's inside is lit twigs and leaves, not a dark hole)
  const grey = v => { const k = Math.round(Math.min(Math.max(v, 0), 1) * 255); return `rgb(${k},${k},${k})`; };
  const wrap = (x, y, r, f) => { for (let dx = -S; dx <= S; dx += S) for (let dy = -S; dy <= S; dy += S) if (x + dx > -r && x + dx < S + r && y + dy > -r && y + dy < S + r) f(x + dx, y + dy); };
  const leaf = (x, y, rx, ry, rot, v) => wrap(x, y, Math.max(rx, ry) + 2, (X, Y) => {
    for (let c = 0; c < 4; c++) {
      const g = ch[c]; g.save(); g.translate(X, Y); g.rotate(rot); g.scale(rx, ry); g.beginPath(); g.arc(0, 0, 1, 0, 2 * Math.PI);
      if (c === 1) { const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, grey(v[1])); gr.addColorStop(1, grey(0.5)); g.fillStyle = gr; } else g.fillStyle = grey(v[c]);
      g.fill(); g.restore();
    }
  });
  const stroke = (pts, w, v) => {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const r = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + w;
    wrap(cx, cy, r, (X, Y) => {
      for (let c = 0; c < 4; c++) {
        const g = ch[c]; g.save(); g.translate(X - cx, Y - cy); g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = grey(v[c]);
        g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]); g.stroke(); g.restore();
      }
    });
  };
  if (sprig) {
    // Crooked twigs, forking, mostly upward (a gnarled shrub's last two orders of branching), each segment ending in a tuft
    // of small leaves fanning up and out; the back tufts in half shade, the front ones lit from above by their place on the
    // twig. The picture's tile is the record's (FH_T: 0.8 m for a 2 cm leaf, so a leaf here is ~13 px long).
    const twigs = [];
    for (let k = 0; k < 125; k++) {
      let x = rnd() * S, y = rnd() * S, a = -Math.PI / 2 + (rnd() - 0.5) * 1.5; const pts = [[x, y]];
      for (let j = 0, m = 3 + Math.floor(rnd() * 3); j < m; j++) {
        a += (j % 2 ? 1 : -1) * (0.3 + 0.35 * rnd()); const L = 12 + 12 * rnd();
        x += Math.cos(a) * L; y += Math.sin(a) * L; pts.push([x, y]);
        if (rnd() < 0.35) { const b = a + (rnd() < 0.5 ? -1 : 1) * (0.6 + 0.4 * rnd()), L2 = 10 + 10 * rnd(); twigs.push([x, y, b, 1]); stroke([[x, y], [x + Math.cos(b) * L2, y + Math.sin(b) * L2]], 1.6, [0.3, 0.75, rnd() < 0.15 ? 1 : 0, 1]); twigs.push([x + Math.cos(b) * L2, y + Math.sin(b) * L2, b, 1]); }
        twigs.push([x, y, a, j / m]);
      }
      stroke(pts, 2.0 + 1.2 * rnd(), [0.28, 0.75, rnd() < 0.15 ? 1 : 0, 1]);
    }
    const tuft = (x, y, a, front, t) => {
      const sh = (front ? 0.66 + 0.34 * rnd() : 0.4 + 0.18 * rnd()) * (0.8 + 0.25 * t);
      for (let j = 0, m = 11 + Math.floor(rnd() * 7); j < m; j++) {
        const b = a + (rnd() - 0.5) * 2.6, L = 5 + 3 * rnd(), d = 1 + 8 * rnd();
        leaf(x + Math.cos(b) * (d + L), y + Math.sin(b) * (d + L), 2 + rnd(), L, b + Math.PI / 2, [sh * (0.9 + 0.2 * rnd()), front ? 1.0 : 0.85, rnd(), 0]);
      }
    };
    for (const front of [0, 1]) for (const [x, y, a, t] of twigs) if (rnd() < (front ? 0.62 : 0.8)) tuft(x + (rnd() - 0.5) * 6, y + (rnd() - 0.5) * 6, a, front, t);
  } else if (manz) {
    for (let k = 0; k < 32; k++) {   // crooked red twigs, seen in the gaps
      let x = rnd() * S, y = rnd() * S, a = -Math.PI / 2 + (rnd() - 0.5) * 1.6; const pts = [[x, y]];
      for (let j = 0; j < 5; j++) { a += (j % 2 ? 1 : -1) * (0.25 + 0.3 * rnd()); x += Math.cos(a) * (14 + 10 * rnd()); y += Math.sin(a) * (14 + 10 * rnd()); pts.push([x, y]); }
      stroke(pts, 2.5 + 2 * rnd(), [0.32, 0.75, rnd() < 0.2 ? 1 : 0, 1]);
    }
    // Leaves gather in sprays 20-30 cm across, each spray lit from above: its lower leaves in its own shade.
    const cl = Array.from({ length: 30 }, () => [rnd() * S, rnd() * S, 45 + 30 * rnd()]);
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.4;
    for (const front of [0, 1]) for (let k = 0; k < (front ? 920 : 1080); k++) {
      const c = cl[Math.floor(rnd() * cl.length)], r = 6 + 6 * rnd(), wf = 0.3 + 0.7 * rnd();
      const dx = gauss() * c[2], dy = gauss() * c[2], lit = Math.min(Math.max(0.8 + 0.3 * dy / c[2], 0.5), 1.05);
      leaf(c[0] + dx, c[1] + dy, r * wf, r * 1.15, (rnd() - 0.5) * 0.7,
        front ? [(0.75 + 0.25 * rnd()) * lit, 1.0, rnd(), 0] : [(0.45 + 0.2 * rnd()) * lit, 0.8, rnd(), 0]);
    }
  } else {
    const wands = (n, front) => {
      for (let k = 0; k < n; k++) {
        const x0 = rnd() * S, amp = 3 + 5 * rnd(), ph = rnd() * 6.28, f = 1 + Math.floor(rnd() * 2), dead = rnd() < (front ? 0.1 : 0.2);
        const xAt = y => x0 + amp * Math.sin(ph + 2 * Math.PI * f * y / S);
        const pts = []; for (let y = -8; y <= S + 8; y += 8) pts.push([xAt(y), y]);
        stroke(pts, front ? 2.4 : 1.8, [front ? 0.42 : 0.28, 0.75, dead ? 1 : 0, 1]);
        if (dead) continue;
        for (let y = rnd() * 10; y < S; y += 7 + 8 * rnd()) {   // a tuft of needles, fanning up and out
          const bunch = 0.75 + 0.3 * Math.sin(ph * 3 + 2 * Math.PI * y / (70 + 30 * (k % 3)));   // bunches along the wand, lit from above
          const x = xAt(y), t = rnd(), sh = (front ? 0.65 + 0.35 * rnd() : 0.4 + 0.18 * rnd()) * bunch;
          for (let j = 0, m = 6 + Math.floor(rnd() * 5); j < m; j++) {
            const a = (rnd() - 0.5) * 2.0, L = 6 + 6 * rnd(), y0 = y + (rnd() - 0.5) * 8;
            stroke([[x, y0], [x + Math.sin(a) * L, y0 - Math.cos(a) * L]], 1.3, [sh, front ? 0.9 : 0.72, t, 0]);
          }
        }
      }
    };
    wands(40, 0); wands(28, 1);
  }
  const img = ch.map(g => g.getImageData(0, 0, S, S).data), data = new Uint8Array(S * S * 4);
  let cov = 0;
  for (let i = 0; i < S * S; i++) { for (let c = 0; c < 4; c++) data[i * 4 + c] = img[c][i * 4]; if (img[1][i * 4] > 115) cov++; }
  leafCoverage.set(kind, cov / (S * S));   // the share the near crown keeps (g over 0.45), for inspection
  let sh = 0; for (let i = 0; i < S * S; i++) if (img[1][i * 4] > 115) sh += img[0][i * 4] / 255;
  leafShadeMean.set(kind, cov ? sh / cov : 0.6);   // the mean shade over its leaves (FRAG leafMean)
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return releaseTexture(t);   // its bytes go once uploaded (gpuRelease.js)
}

// Chaparral shrubs. Cover per cell: chaparral cells only, the canopy's shrub % (floored: a low value
// in a chaparral cell is more often a burn scar or a data gap than open ground), bilinear between
// cell centres so a stand thins out over a cell instead of stopping at a 30 m square.
// Heights (m) by age class, young / mature / decadent: library/species adenostoma_fasciculatum.json and
// arctostaphylos_viscida.json (height_m and their variants), as the 3D shrubs of vegetation.js. The card's
// visible crown (the cluster of stems' crowns with its outline) is about H tall (0.9 H past the near band)
// and VIS_W x R across (measured side on: 1.85 R near, 1.6 R at 40 m), so R = width / VIS_W.
const SHRUB_H = { chamise: [[0.6, 1.3], [1.2, 2.4], [1.5, 2.6]], manzanita: [[0.7, 1.5], [1.5, 3.5], [2.0, 3.5]] };
const CHAP_W = 2.2, GROW_W = 3.3, KMIN_LO = 0.04;   // the chaparral's typical visible crown width (m); a far impostor's widest; the LOD's lowest floor
// Ground cover as before the sizes followed the species: the old rule grew crowns with the cover and the
// stand age (size 1.15 (0.62 + 0.62 cover) (0.8 + 0.4 age), with the meanArea below), so a dense or old
// stand was more closed than its cover %, a thin one more open. Each place keeps the crown area per m^2 it
// had: the plant count follows the old mean crown area over the new one there (eOld / eNew, mean pi R^2
// of the species mix at that cover, age and age class), 0.34-2.9x (young stands of small plants need the
// most), times COVER_GAIN: at the same crown area per m^2 the lower, wider crowns hid 10-17% less of the
// ground in the chase camera's oblique views (15-100 m up, 30-250 m out, mean of 7 stands); 1.3 gives
// those views their old cover back (straight down it is ~15% more, still under the canopy %). Candidates
// are drawn for QMAX (99% of places) and plant() drops the rest.
const OLD_AREA = 1.3 * (0.6 * Math.PI * 0.8 ** 2 + 0.4 * Math.PI * 1.1 ** 2), COVER_GAIN = 1.3, QMAX = 3.25;
const AGE_Y = 0.21, AGE_D = 0.62;   // stand age noise below: young, above: decadent
const clamp01 = x => Math.min(Math.max(x, 0), 1);
const eH2 = ([a, b]) => ((a + b) / 2) ** 2 + (b - a) ** 2 / 24;   // mean H^2 of h0 + (h1 - h0) (u1 + u2) / 2
function eOld(cov, age, pm) {
  const s2 = (1.15 * (0.62 + 0.62 * cov) * (0.8 + 0.4 * age)) ** 2, p1 = clamp01(0.2 + 0.3 * (0.85 - cov));
  return Math.PI * s2 * (pm * 1.2633 * (1 + 0.5625 * p1) + (1 - pm) * 0.67 * (0.38 + 0.62 * 0.81));
}
function eNew(cov, cls, pm) {
  const k = 1.0048 / VIS_W ** 2, p1 = clamp01(0.2 + 0.3 * (0.85 - cov)), p2 = Math.max((cls === 2 ? 0.75 : 0.55) - p1, 0);
  const m = eH2(SHRUB_H.manzanita[cls]) * k * (p1 * 1.44 ** 2 + p2 * 1.45 ** 2 + Math.max(1 - p1 - p2, 0) * 1.15 ** 2);
  const c0 = 1 - [0.45, 0.65, 0.85][cls], c = eH2(SHRUB_H.chamise[cls]) * k * (c0 * 1.3 ** 2 + (1 - c0) * 1.12 ** 2);
  return Math.PI * (pm * m + (1 - pm) * c);
}
export function ShrubField(tile, ground, uniforms) {
  const hab = tile.habitat, can = tile.canopy, W = hab.img.width, H = hab.img.height, res = hab.res;
  const cover = new Float32Array(W * H), chapCover = new Float32Array(W * H);
  // The chamise and manzanita of this field are California's chaparral: a tile built outside the regional tables
  // (species_mix.json class_fallback false) draws them only where its own mix lists them (2026-11-06, iteration 6:
  // Lofoten's heath, a shrubland, class 4, was covered in chamise and manzanita domes, the manzanita's red branching
  // showing, over the heath's carpet). Its own shrubs (foothillShrubs) still take the class's shrub cover.
  // On a regional-table tile a shrubland cell draws the chaparral only where its own row lists a chaparral species
  // (2026-11-06: Yellowstone's Lamar Valley drew manzanita domes over its big sagebrush steppe); California's chaparral
  // rows list them, so the home tiles are unchanged.
  // (the same for a tile in no natural region of the tables, vegetation.js borrowsNothing: Teton's class-4 cells whose row
  // lists no shrub drew chamise and manzanita)
  const mix = tile.speciesMix, own = borrowsNothing(tile);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++)
    if (hab.channel(i, j, 0) === 4) {
      const o = j * W + i, row = own ? mix.at(i, j) : null;
      cover[o] = Math.min(Math.max(can.channel(i, j, 1) / 100, 0.3), 0.85);
      const r2 = mix?.json ? mix.at(i, j) : null, chapShare = Math.min(1, CHAP_IDS.reduce((a, id) => a + (r2?.shrubs?.[id] || 0), 0));
      chapCover[o] = own ? cover[o] * chapShare : !mix?.json || !r2 || !r2.shrubSum ? cover[o] : chapShare > 0 ? cover[o] : 0;
    }
  const cellCover = bilinear(chapCover, W, H, res, tile.size);
  // Openings: a stand is not a lawn. Rock outcrops, old burn patches and game trails leave gaps of
  // a few to ~15 m in about one tenth of the ground, more where the cover is thin.
  const coverAt = (x, n) => {
    const c = cellCover(x, n);
    if (c <= 0) return 0;
    const g = 0.65 * vnoise(x / 17, n / 17, 31) + 0.35 * vnoise(x / 6, n / 6, 32), t = 0.25 + 0.1 * (0.85 - c);
    return c * smooth(t - 0.06, t + 0.06, g) * rockKeep(tile, x, n);   // and the outcrops of rocks.js open the stand
  };
  const fh = foothillShrubs(tile, ground, cover);
  // The density LOD from the layer's crowns (2026-11-06, iteration 8): full density to D0, where the chaparral's typical
  // 2.2 m crown spans what it did at 115 m (D0 in proportion to the layer's crown width), then a far survivor grows by
  // 1 / sqrt(keep) to stand for the plants dropped around it, up to GROW_W across (1.5x the chaparral's crown, the rule
  // before): a layer of small crowns (Lamar's sagebrush, 0.7 m: D0 38 m) costs about what the chaparral's does per screen.
  let cw = 0, cs = 0;
  for (let o = 0; o < W * H; o++) { if (chapCover[o] > 0) { cw += chapCover[o] * CHAP_W; cs += chapCover[o]; } if (fh.cover[o] > 0) { cs += fh.cover[o]; cw += fh.cover[o] * (fh.cellWidth(o) || CHAP_W); } }
  const layerW = cs > 0 ? cw / cs : CHAP_W, KMIN = Math.min(1 / 1.5 ** 2, Math.max(KMIN_LO, (layerW / GROW_W) ** 2));
  const D0 = Math.min(115, Math.max(30, 115 * layerW / CHAP_W));
  const field = new ClumpField(tile, ground, uniforms, {
    name: 'shrubfield', salt: 0x5eed, cap: 200000, roadsMax: 60, near: true,
    extraAny: fh.any, extra: fh.cell,   // the foothill shrubs, merged into the chaparral's cells and the woodland's
    cellAny: anyAround(chapCover, W, H), coverAt, coverMax: 0.85,
    meanArea: OLD_AREA / QMAX,   // candidates for the densest places; plant() thins them (see eOld)
    // Gone only right at the camera, at every height (the 3D shrubs are too few to carry the cover). The
    // chase camera trails the raven by 3-5 m, so a 3-8 m cut emptied the ring around the bird itself.
    // KMIN 1 / 1.5^2: a far survivor grows by 1 / sqrt(keep), so it is never more than 1.5x its own width
    // (1.22x its height); past ~170 m the field keeps 44% of its plants instead of thinning further.
    D0, KMIN, band: [1.2, 3.5, 370, 430], now: 140,
    plant(px, pn, rnd, cov) {
      // Stands: manzanita and chamise clump into patches tens of metres across (~40% manzanita).
      const pm = 0.1 + 0.75 * smooth(0.35, 0.75, vnoise(px / 45, pn / 45, 9));
      // Stand age (the fire history): patches ~30 m across of one age class, a little younger where the
      // cover is thin; each plant a little off its stand's age. Young stands hold ~3x the plants per m^2 of
      // old ones (small crowns, same cover), so they take ~10% of the ground, mature ~58%, decadent ~32%,
      // for the species files' 25/50/25 young/mature/decadent plants.
      const age0 = vnoise(px / 28, pn / 28, 13), stand = age0 - 0.15 * Math.max(0.6 - cov, 0);
      const cls0 = stand < AGE_Y ? 0 : stand > AGE_D ? 2 : 1;
      if (rnd() * QMAX >= COVER_GAIN * eOld(cov, age0, pm) / eNew(cov, cls0, pm)) return null;   // the cover as before
      const manz = rnd() < pm, age = stand + 0.12 * (rnd() - 0.5);
      const cls = age < AGE_Y ? 0 : age > AGE_D ? 2 : 1, u = rnd();
      const [h0, h1] = SHRUB_H[manz ? 'manzanita' : 'chamise'][cls];
      let H = h0 + (h1 - h0) * 0.5 * (rnd() + rnd());   // most plants mid-range
      const wv = 0.88 + 0.24 * rnd();
      if (manz) {
        // 1 sprawling (more where cover is thin: rocky ground; low and wide), 2 open with red branching
        // (more in old stands), 0 upswept. Width over height 1.15-1.8, 1.4 on average (crown_width_ratio).
        const variant = u < 0.2 + 0.3 * (0.85 - cov) ? 1 : u < (cls === 2 ? 0.75 : 0.55) ? 2 : 0;
        if (variant === 1) H *= 0.8;
        const wh = variant === 1 ? 1.8 : variant === 2 ? 1.45 : 1.15;
        return [KIND.manzanita, wh * wv * H / VIS_W, H, variant];
      }
      // 0 rounded, 1 ragged vase, 2 vase with grey dead stems (deadwood: young 6%, mature 15%, decadent 55%).
      // Width over height 1.12-1.3, 1.2 on average (crown_width_ratio).
      const variant = u < [0.06, 0.15, 0.55][cls] ? 2 : u < [0.45, 0.65, 0.85][cls] ? 1 : 0;
      const wh = variant === 0 ? 1.3 : 1.12;
      return [KIND.chamise, wh * wv * H / VIS_W, H, variant];
    },
  });
  // Near detail (leaves, wands, stems): full to 14 m, handed to the far program by 26 m.
  field.uniforms.nearBand = { value: new THREE.Vector2(14, 26) };
  field.uniforms.leafM = { value: shrubLeaves(true) }; field.uniforms.leafC = { value: shrubLeaves(false) }; field.uniforms.leafF = { value: shrubLeaves('sprig') };
  field.uniforms.leafGain = { value: new THREE.Vector4(2.5, 4.0, 1.25, 1.4) };   // the near look matched to the far one in mean (measured on screen)
  field.uniforms.leafMean = { value: new THREE.Vector3(...[true, false, 'sprig'].map(k => leafShadeMean.get(k) || 0.6)) };   // (after shrubLeaves baked them)
  field.uniforms.leafGainF = { value: new THREE.Vector2(3.4, 1.2) };   // the sprig picture's (sun, shade), measured the same way (Lamar's sagebrush, 2026-11-06)
  // The foothill shrubs' season (fhSeason), set from the field's season (grass.js's `dry`) when it changes.
  Object.assign(field.uniforms, {
    fhCol: { value: FH.map(() => new THREE.Vector3()) }, fhBark: { value: FH.map(() => new THREE.Vector3()) },
    fhLeaf: { value: FH.map(() => 1) }, fhDeco: { value: FH.map(() => new THREE.Vector4()) },
    glow: { value: new THREE.Vector4(0, 0, 1, 0) }, glowFh: { value: new Float32Array(FH_N) }, glowKind: { value: new THREE.Vector2() }, glowCol: { value: new THREE.Color(1, 0.76, 0.34) } });   // the forager's food (forage.js writes them)
  // The twig shrubs up close (TwigShrubs): whole, each at its own radius between 9 and 13 m (horizontal).
  field.uniforms.twigBand = { value: new THREE.Vector2(9, 13) };
  // their wood's colours (the close tier's and the pictures'), and the pictures past the hand-over (TwigShrubs.bake): the two
  // atlases, their size in tiles, each species' first tile (-1 until baked: the dome is drawn)
  const lin = c => c.map(v => Math.pow(v / 255, 2.2) * (groundLook.physical ? 1.0 : 1.3));
  Object.assign(field.uniforms, {
    twBark: { value: FH.map(id => new THREE.Vector3(...lin(SPECIES[id]?.trunk?.bark_rgb || [110, 100, 90]))) },
    twDead: { value: FH.map(id => new THREE.Vector3(...lin(SPECIES[id]?.deadwood?.rgb || [140, 134, 124]))) },
    twA: { value: null }, twB: { value: null }, twEl: { value: new THREE.Vector2(TW_EL_LO, TW_EL_HI) },  twSize: { value: new THREE.Vector2(1, 1) }, twBase: { value: new Float32Array(FH_N).fill(-1) } });
  const twigs = FH_TWIG.some(Boolean) ? new TwigShrubs(field) : null;
  if (twigs) { field.mesh.add(twigs.group); field.mesh.onBeforeRender = r => { twigs.renderer = r; }; }
  const update = field.update.bind(field);
  let fhKey = null;
  field.update = (camera, on = true, band = null) => {
    const season = seasonOfDry(field.uniforms.dry.value), key = `${season}:${seasonMonth(season).toFixed(1)}`;
    if (key !== fhKey) { fhKey = key; fhSeason(field.uniforms, season); }
    update(camera, on, band);
    if (twigs && field.mesh.visible) { twigs.bakeNew(); twigs.update(camera); }
  };
  field.foothill = fh; field.layerWidth = layerW; field.twigs = twigs; field.clumpPorGLSL = CLUMP_POR_GLSL;
  return field;
}

// ---- Twig shrubs up close (2026-11-06; FH_TWIG above). Each qualifying plant of the field within twigBand of the camera
// is drawn as one of its species' own skeletons (treegen shrubFrame: the record's trunk, levels and twigs, three copies of
// each age class), instanced at the field's root, height and crown width, turned by a hash of its root: the wood as thin
// tubes in the record's bark, twig and deadwood colours, and at each place the close tier hangs foliage (the twig ends) a
// tuft of the record's leaves (two crossed quads TWIG_TUFT_K leaf lengths across, the leaves drawn in the fragment shader
// as fanned wedges, no texture). A plant smaller than its skeleton keeps (scale)^2 of its tufts, so its leaves stay their
// own size and its crown stays as open. Lit as the impostor lights the same plant: the record's albedo (fhCol), the sun
// through the crown (a porous crown passes the record's porosity across its diameter: Beer's law from the point to the
// crown's sunward surface), the cast shadow of everything else tested just outside that surface, the sky occluded inside
// the crown, the air applied per vertex. The season as the impostor's: leaf-on share (a bare deciduous crown is its twigs),
// flowers or berries on a share of the tufts, the forager's glow.
const TWIG_CAP0 = 512, TWIG_MARGIN = 1, TWIG_LITE = 3.5;
const tuftOf = id => Math.min(0.25, Math.max(0.05, TWIG_TUFT_K * (SPECIES[id]?.foliage?.leaf_size_m ?? 0.02)));
const TWIG_VERT = /* glsl */`
  ${ATMOSPHERE_GLSL}
  ${GROUND_GLSL}
  ${WIND_GLSL}
  // the trees' contact AO only (shadows.js: its g; r carries the shrubs' own crowns too, for the ground under them)
  float treeAO(vec3 p) {
    vec2 uv = (contactAOMatrix * vec4(p, 1.0)).xy, e = abs(uv - 0.5) * 2.0;
    if (max(e.x, e.y) >= 1.0) return 1.0;
    return 1.0 - texture(contactAO, uv).g * (1.0 - smoothstep(0.8, 1.0, max(e.x, e.y)));
  }
  uniform vec2 twigBand;
  uniform vec3 fhCol[${FH_N}]; uniform vec3 fhBark[${FH_N}]; uniform float fhLeaf[${FH_N}]; uniform vec4 fhDeco[${FH_N}];
  uniform vec3 twBark[${FH_N}]; uniform vec3 twDead[${FH_N}];
  uniform vec4 glow; uniform float glowFh[${FH_N}];
  const float FH_POR[${FH_N}] = ${fhArr(4)};
  const float TW_THRU = 0.2;   // the sun through a leaf (a thick, hairy leaf passes little)
  const float TW_TUFT[${FH_N}] = float[${FH_N}](${FH.map(id => tuftOf(id).toFixed(3)).join(', ')});
  attribute vec3 aOff; attribute vec4 aT; attribute vec4 iP; attribute vec4 iS;   // aT: type (0 stem, 1 twig, 2 dead, 3 tuft), two randoms, height / H
  varying vec2 vUv; varying vec3 vCol; varying vec3 vSunC; varying vec3 vT; varying vec3 vIn; varying float vLeaf; varying float vRnd; varying float vGlow;
  float ph(vec2 p, uint salt) {
    uvec2 q = uvec2(ivec2(floor(p * 64.0)) + 4194304);
    uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u) ^ (salt * 2798796415u);
    h = (h ^ (h >> 15)) * 2246822519u; h ^= h >> 13;
    return float(h) * (1.0 / 4294967296.0);
  }
  void main() {
    // the impostor's hand-over test (VERT), so each plant is drawn by exactly one of the two
    if (distance(cameraPosition.xz, iP.xz) >= mix(twigBand.x, twigBand.y, ph(iP.xz, 4u))) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    int fk = int(iS.w + 0.5);
    float type = aT.x, sc = iS.x, H = iS.z;
    bool leaf = type > 2.5;
    float deco = leaf ? step(1.0 - fhDeco[fk].a, fract(aT.z * 7.31)) : 0.0;
    if (leaf && (aT.y > sc * sc || (aT.z >= fhLeaf[fk] && deco < 0.5))) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    float c = cos(iP.w), s = sin(iP.w);
    vec3 lp = position * vec3(iS.y, 1.0, iS.y) * sc;
    vec3 rp = vec3(c * lp.x - s * lp.z, lp.y, s * lp.x + c * lp.z);
    vec3 nrm = vec3(c * normal.x - s * normal.z, normal.y, s * normal.x + c * normal.z);
    vec3 Nf = nrm;
    if (leaf) {
      // the tuft's quad facing the eye; its leaves' faces (aOff) turned to the eye (two-sided)
      // The tuft faces the eye, the shoot as seen as its up: a fascicle seen down its shoot is a rosette of about the same
      // size. (It turned only about its shoot, so it went edge-on to a view along it, and the shoots point up: from above
      // the crowns lost their leaves and read as dark sparse twigs, a dark even fuzz from 15-30 m up; 2026-11-06.)
      vec3 V = normalize(cameraPosition - (iP.xyz + rp)), up2 = nrm - V * dot(nrm, V);
      float l2 = dot(up2, up2);
      up2 = l2 > 1e-4 ? up2 * inversesqrt(l2) : normalize(cross(V, abs(V.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 side = cross(up2, V);
      rp += (side * uv.x * 0.5 + up2 * (uv.y - 0.15)) * TW_TUFT[fk];
      Nf = vec3(c * aOff.x - s * aOff.z, aOff.y, s * aOff.x + c * aOff.z);
      Nf = dot(Nf, V) < 0.0 ? -Nf : Nf;
    }
    // wind: the plant leans a few cm in gusts (the impostor's 0.06 H at the crown's middle), its tufts flutter
    float hf = clamp(rp.y / max(H, 0.05), 0.0, 1.3), g = gust(iP.xz);
    rp.xz += windDir * windStrength * (g * 0.09 * H * hf * hf + (leaf ? 0.012 * sin(time * 7.0 + aT.z * 40.0) * g : 0.0));
    vec3 wp = iP.xyz + rp;
    // the crown as an ellipsoid: its centre, half extents (the field's crown width), the point's place in it
    vec3 Rc = vec3(0.55 * H * iS.y, 0.5 * H, 0.55 * H * iS.y), Cc = iP.xyz + vec3(0.0, 0.5 * H, 0.0);
    vec3 qv = (wp - Cc) / Rc;
    float r = length(qv);
    vec3 nC = normalize(qv / Rc);
    // a leaf is lit by its own face (the tuft quad's normal, turned to the eye: two-sided), the sun behind it coming through
    // at TW_THRU; the sky by the crown's normal
    vec3 N = leaf ? normalize(nC + vec3(0.0, 0.35, 0.0)) : nrm;
    // the sun through the crown: the chord from the point to the crown's sunward surface, the record's porosity across a diameter
    vec3 Ls = sunDir / Rc;
    float qa = dot(Ls, Ls), qb = dot(qv, Ls), qc = dot(qv, qv) - 1.0;
    float tx = max((-qb + sqrt(max(qb * qb - qa * qc, 0.0))) / qa, 0.0);
    float por = FH_POR[fk], kd = -log(max(por, 0.05)) / (2.0 * max(dot(Rc, vec3(0.3333)), 0.05));
    float trans = exp(-kd * tx);
    float shS = csmShadow(wp + sunDir * (tx + 0.15), vec3(0.0), 0.0, 0.5, 0.0);
    float sf = dot(Nf, sunDir);
    float diff = leaf ? (sf > 0.0 ? sf : -TW_THRU * sf) : 0.25 + 0.75 * max(dot(N, sunDir), 0.0);
    // sky light: the canopy's share and the contact AO as the impostor takes them, less inside the crown and low in it
    vec2 guv = groundUv(iP.xyz);
    float occ = (1.0 - 0.35 * clamp(texture(canopyMap, guv).r * 2.55, 0.0, 1.0)) * treeAO(iP.xyz);
    float ao = mix(0.4, 1.0, smoothstep(0.15, 1.0, r)) * mix(0.65, 1.0, clamp(hf * 1.4, 0.0, 1.0));
    vec3 amb = mix(ambientGround, ambientSky, 0.5 + 0.5 * N.y) * occ * ao;
    vec3 alb = leaf ? mix(fhCol[fk] * mix(0.86, 1.14, fract(aT.z * 5.3)), fhDeco[fk].rgb, deco)
             : type < 0.5 ? twBark[fk] : type < 1.5 ? fhBark[fk] : twDead[fk];
    vCol = alb * amb * 0.3183099; vSunC = alb * sunLight * (cloudOnly(Cc) * shS * trans * diff * 0.3183099);
    vIn = atmosphereApply(vec3(0.0), wp, cameraPosition);
    vT = atmoT(wp - cameraPosition, cameraPosition.y);   // (inside 15 m the contrast term's share of the plant's own light is nil)
    float gd = distance(iP.xz, glow.xy);
    vGlow = glowFh[fk] * glow.w * pow(clamp(1.0 - gd / max(glow.z, 0.01), 0.0, 1.0), 1.2) * (1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.15 * glow.z, gd))) * (leaf ? 1.0 : 0.3);
    vUv = uv; vLeaf = leaf ? 1.0 : 0.0; vRnd = aT.z;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
// The four tuft shapes: seven leaves each, alternating sides up the shoot's lower half, the lower ones splayed wider
// The tuft picture (bakeTuft, once per page): four tufts in a 2 x 2 atlas, each seven wedge-shaped leaves with three teeth
// at the blunt tip (big sagebrush's), alternating sides up the lower half of a short shoot, the lower ones splayed wider;
// r coverage, g shade (a leaf darker toward its base, each its own), b the sun its own turn takes (the leaves of a fascicle
// face every way: 0.25 to 1 of the quad's incidence, a mean of about 0.6). One per world (TwigShrubs): the world's teardown
// disposes it with the material, and its bytes are dropped once uploaded.
function bakeTuft() {
  const S = 128, N = 2 * S, r = mulberry32(0x7af7);
  const ch = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, N, N); return g; });
  const grey = v => { const k = Math.round(Math.min(Math.max(v, 0), 1) * 255); return `rgb(${k},${k},${k})`; };
  const sm = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * S, oy = Math.floor(v / 2) * S, P = (x, y) => [ox + (x + 0.5) * S, oy + (1 - y) * S];
    // A short shoot with its leaves in fascicles at TUFT_NODES nodes up its lower three quarters, TUFT_PER at each, each leaf
    // 1 / TWIG_TUFT_K of the tuft long (the record's leaf_size_m: the tuft is TWIG_TUFT_K of its leaves across), +-25 %,
    // splayed out and up, narrower toward the shoot's tip (2026-11-06: the seven leaves of 0.36-0.56 tuft, 1.3-2x the
    // record's leaf, fanned in one plane read as one large flat pale wedge per tuft at 1-2 m)
    for (let i = 0; i < TUFT_NODES * TUFT_PER; i++) {
      const node = Math.floor(i / TUFT_PER), k = i % TUFT_PER, r1 = r(), r2 = r(), r3 = r(), side = k % 2 ? -1 : 1;
      const th = (k === 0 ? (r1 - 0.5) * 0.4 : side * (0.35 + 0.7 * r1)) * (1 - 0.45 * node / (TUFT_NODES - 1));
      const bx = 0.015 * side * (k ? 1 : 0), by = 0.05 + 0.62 * node / (TUFT_NODES - 1), L = (0.75 + 0.5 * r2) / TWIG_TUFT_K, ax = [Math.sin(th), Math.cos(th)], nx = [ax[1], -ax[0]];
      const at = (t, s) => P(bx + ax[0] * t * L + nx[0] * s, by + ax[1] * t * L + nx[1] * s);
      const w = t => L * 0.17 * (0.2 + 0.8 * sm(0, 0.8, t));
      const pts = [];
      for (let k = 0; k <= 10; k++) { const t = 0.9 * k / 10; pts.push(at(t, w(t))); }
      const W = w(0.9);
      pts.push(at(1.0, 0.75 * W), at(0.94, 0.38 * W), at(1.0, 0), at(0.94, -0.38 * W), at(1.0, -0.75 * W));   // the three teeth
      for (let k = 10; k >= 0; k--) { const t = 0.9 * k / 10; pts.push(at(t, -w(t))); }
      const shade = 0.85 + 0.25 * r2, tilt = 0.25 + 0.75 * r3;
      for (let c = 0; c < 3; c++) {
        const g = ch[c]; g.beginPath(); g.moveTo(...pts[0]); for (const q of pts.slice(1)) g.lineTo(...q); g.closePath();
        if (c === 1) { const [x0, y0] = at(0, 0), [x1, y1] = at(1, 0), gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, grey(shade * 0.8)); gr.addColorStop(1, grey(shade * 1.04)); g.fillStyle = gr; }
        else g.fillStyle = grey(c === 0 ? 1 : tilt);
        g.fill();
      }
    }
  }
  const img = ch.map(g => g.getImageData(0, 0, N, N).data), data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { data[i * 4] = img[0][i * 4]; data[i * 4 + 1] = img[1][i * 4]; data[i * 4 + 2] = img[2][i * 4]; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return releaseTexture(t);
}
const TUFT_GLSL = /* glsl */`
  // A tuft from the picture (bakeTuft): uv x across (-1..1 is the tuft's width), y along the shoot (0..1). Returns the
  // coverage (sharpened to the pixel), sets the shade and the leaf's own sun.
  float tuft(vec2 uv, float seed, out float shade, out float tilt) {
    vec2 P = vec2(uv.x * 0.5, uv.y), q = (vec2(P.x + 0.5, 1.0 - P.y) * 0.98 + 0.01 + vec2(floor(fract(seed * 3.71) * 2.0), floor(fract(seed * 7.13) * 2.0))) * 0.5;
    vec4 t = texture2D(tuftMap, q);
    float px = max(length(fwidth(P)), 1e-4);
    float cov = clamp((t.r - 0.5) / max(fwidth(t.r), 0.02) + 0.5, 0.0, 1.0);
    shade = t.g / max(t.r, 0.05); tilt = t.b / max(t.r, 0.05);
    // far off (a leaf under a pixel or two wide) the tuft becomes a solid oval of its leaves' cover, so it neither sparkles
    // nor dithers into a haze
    float blur = smoothstep(0.06, 0.16, px);
    if (blur <= 0.0) return cov;
    float blob = clamp((0.27 - length((P - vec2(0.0, 0.4)) * vec2(1.25, 0.9))) / px + 0.5, 0.0, 1.0);
    if (blob > cov) { shade = 0.9; tilt = ${TUFT_TILT_MEAN.toFixed(2)}; }
    return mix(cov, blob, blur);
  }
`;
const TWIG_FRAG = /* glsl */`
  uniform vec3 glowCol; uniform vec3 sunLight; uniform vec3 ambientSky; uniform sampler2D tuftMap;
  varying vec2 vUv; varying vec3 vCol; varying vec3 vSunC; varying vec3 vT; varying vec3 vIn; varying float vLeaf; varying float vRnd; varying float vGlow;
  ${TUFT_GLSL}
  void main() {
    float a = 1.0, sh = 1.0, tl = 1.0;
    if (vLeaf > 0.5) { a = tuft(vUv, vRnd, sh, tl); if (a < 0.02) discard; }
    // (the leaf's own tilt, the picture's b, is taken about its mean only: vSunC already holds the sun at the tuft's own face,
    // a random way across its shoot, which is the leaves' mean turn; a second factor of 0.25-1 (mean 0.6) put the crown's
    // sunlit leaves at 0.6 of an isotropic canopy's light (2026-11-06, calibration step). Over its mean it is each leaf's
    // own turn about the tuft's face, so the leaves of one fascicle part instead of reading as one flat card.)
    vec3 c = (vCol + vSunC * (tl / ${TUFT_TILT_MEAN.toFixed(2)})) * sh;
    if (vGlow > 0.0) c += glowCol * vGlow * dot(sunLight * 0.5 + ambientSky * 1.5, vec3(0.3333)) * 0.3183099 * 0.25;
    gl_FragColor = vec4(c * vT + vIn, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
// One skeleton's geometry: tubes for the wood (5, 4, 3 sides by level; twigs 3), two crossed quads per tuft. The tuft's
// vertices all sit at its anchor (position), their corners in aOff in tuft sizes, so the shader keeps them their own size.
const TUFT_EFF = 0.1, TUFT_MAX = 1500;
function twigGeometry(frame, seed, por, tuftM, scRef, lite = false) {
  const pos = [], nor = [], off = [], at = [], uv = [], idx = [], rnd = mulberry32(seed ^ 0x7a19);
  const H = Math.max(frame.H, 0.05), v3 = (a, i) => new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
  const tube = (s, sides, type) => {
    const n = s.pts.length / 3; if (n < 2) return;
    const P = Array.from({ length: n }, (_, i) => v3(s.pts, i));
    let t = P[1].clone().sub(P[0]).normalize();
    let u = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(t).normalize() : new THREE.Vector3(1, 0, 0).cross(t).normalize();
    const base = pos.length / 3, r2 = rnd(), d = new THREE.Vector3(), b = new THREE.Vector3(), nx = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (i > 0) d.subVectors(P[i], P[i - 1]).normalize(); else d.copy(t);
      if (i > 0 && i < n - 1) d.add(nx.subVectors(P[i + 1], P[i]).normalize()).normalize();
      u.addScaledVector(d, -u.dot(d)).normalize(); b.crossVectors(d, u);
      const R = Math.max(s.rad[i] ?? s.rad[s.rad.length - 1], 0.0012);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2; nx.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
        pos.push(P[i].x + nx.x * R, P[i].y + nx.y * R, P[i].z + nx.z * R); nor.push(nx.x, nx.y, nx.z); off.push(0, 0, 0);
        at.push(type, rnd(), r2, P[i].y / H); uv.push(0, 0);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
      const a = base + i * sides + k, bb = base + i * sides + (k + 1) % sides;
      idx.push(a, bb, a + sides, bb, bb + sides, a + sides);
    }
  };
  // (the outer branches, a millimetre or two across at the plant's size, as at most three rings: a kink nobody sees)
  const thin = s => { const n = s.pts.length / 3; if (n <= 3) return s; const k = [0, n >> 1, n - 1];
    return { ...s, pts: Float32Array.from(k.flatMap(i => [s.pts[i * 3], s.pts[i * 3 + 1], s.pts[i * 3 + 2]])), rad: Float32Array.from(k.map(i => s.rad[i])) }; };
  // (lite: the copy drawn past TWIG_LITE m, where a branch a few millimetres across is under a pixel: the trunk and its
  // first branches only, the tufts as in the full one)
  for (const s of frame.stems) if (!lite || s.level < 2) tube(s.level >= 2 || s.dead ? thin(s) : s, s.dead ? 3 : [4, 3, 3][Math.min(s.level, 2)], s.dead ? 2 : 0);
  if (!lite) for (const s of frame.twigs) tube(s, 3, s.dead ? 2 : 1);
  // The tufts: as many as make the crown as open as the record's porosity, drawn at scale scRef (the plant's size over the
  // skeleton's): the crown's side area (0.86 H^2: an ellipse 1.1 H wide) covered -ln(porosity) times over by tufts that each
  // cover TUFT_EFF of their square (two crossed quads, seven leaves). Taken from the close tier's places (the twig ends), a
  // random subset, or all of them and more around them (within a tuft of a twig end, its direction turned up to 35 degrees).
  // A tuft's thinning rank carries scRef^2, so a plant at scale sc keeps (sc / scRef)^2 of them (TWIG_VERT).
  const trnd = mulberry32(seed ^ 0x7f7f);   // the tufts' own stream: the same tufts in the full and the lite copy
  const S = tuftM / Math.max(scRef, 0.05);   // a tuft in the skeleton's units
  const need = Math.min(TUFT_MAX, Math.ceil(-Math.log(Math.max(por, 0.05)) * 0.86 * (H * scRef) ** 2 / (TUFT_EFF * tuftM * tuftM)));
  const tips = frame.tips.slice();
  for (let i = tips.length - 1; i > 0; i--) { const k = Math.floor(trnd() * (i + 1)); [tips[i], tips[k]] = [tips[k], tips[i]]; }
  // The tufts past the twig ends spread along the crown's outer branches and twigs (by length, where they lie in the outer
  // part of the crown envelope, past 0.45 of its radii), each a shoot along its branch. (They were heaped around the twig
  // ends, up to five a tip on a mature plant: the crown was a few puffs on bare sticks, half see-through from above and a
  // dark fuzz from 15-30 m up, though its tufts are enough to close it to its porosity; 2026-11-06.)
  const segs = []; let segL = 0;
  { const C = frame.centre, Rr = frame.radii.map(r => Math.max(r, 1e-3));
    for (const st of [...frame.twigs, ...frame.stems.filter(q => q.level >= 1 && !q.dead)]) {
      const P = st.pts, n = P.length / 3;
      for (let k = 0; k + 1 < n; k++) {
        const ax = P[k * 3], ay = P[k * 3 + 1], az = P[k * 3 + 2], bx = P[k * 3 + 3], by = P[k * 3 + 4], bz = P[k * 3 + 5];
        const r = Math.hypot(((ax + bx) / 2 - C[0]) / Rr[0], ((ay + by) / 2 - C[1]) / Rr[1], ((az + bz) / 2 - C[2]) / Rr[2]);
        const L = Math.hypot(bx - ax, by - ay, bz - az);
        if (r < 0.45 || L <= 0) continue;
        segs.push([ax, ay, az, bx, by, bz, L, segL]); segL += L;
      }
    } }
  const use = tips.length ? Array.from({ length: need }, (_, i) => {
    const t = tips[i % tips.length];
    if (i < tips.length) return t;
    if (segs.length) {
      const u = trnd() * segL; let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m][7] <= u) lo = m; else hi = m - 1; }
      const g = segs[lo], f = Math.min(1, Math.max(0, (u - g[7]) / g[6])), j = [trnd() - 0.5, trnd() - 0.5, trnd() - 0.5];
      const dd = new THREE.Vector3(g[3] - g[0], g[4] - g[1], g[5] - g[2]).normalize().add(new THREE.Vector3(trnd() - 0.5, trnd() - 0.5, trnd() - 0.5).multiplyScalar(0.8)).normalize();
      return { c: [g[0] + f * (g[3] - g[0]) + j[0] * S, g[1] + f * (g[4] - g[1]) + j[1] * S, g[2] + f * (g[5] - g[2]) + j[2] * S], d: dd.toArray() };
    }
    const j = [trnd() - 0.5, trnd() - 0.5, trnd() - 0.5], dd = new THREE.Vector3(...t.d).add(new THREE.Vector3(trnd() - 0.5, trnd() - 0.5, trnd() - 0.5).multiplyScalar(1.2)).normalize();
    return { c: [t.c[0] + j[0] * S * 2.5, t.c[1] + j[1] * S * 1.5, t.c[2] + j[2] * S * 2.5], d: dd.toArray() };
  }) : [];
  const up = new THREE.Vector3(), a = new THREE.Vector3(), w = new THREE.Vector3(), qn = new THREE.Vector3();
  for (const tip of use) {
    const d = new THREE.Vector3(...tip.d).normalize(), c = tip.c, r1 = trnd() * scRef * scRef, r2 = trnd();
    // a shoot points up and out: the card's direction pulled halfway to the vertical
    d.lerp(up.set(0, 1, 0), 0.5).normalize();
    // one quad per tuft, facing the eye with its shoot as seen as its up (TWIG_VERT); its leaves' faces (aOff) a random way across
    // the shoot, lighting it as if it did not turn
    a.set(trnd() - 0.5, trnd() - 0.5, trnd() - 0.5).cross(d).normalize(); qn.crossVectors(a, d).normalize();
    const base = pos.length / 3;
    for (const [x, y] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      pos.push(c[0], c[1], c[2]); nor.push(d.x, d.y, d.z); off.push(qn.x, qn.y, qn.z);
      at.push(3, r1, r2, c[1] / H); uv.push(x, y);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(pos.length / 3 < 65536 ? new THREE.Uint16BufferAttribute(idx, 1) : new THREE.Uint32BufferAttribute(idx, 1));
  return g;
}
// VERT's ph(p, salt) on the CPU (the same 32-bit integer hash of the root's 1/64 m cell), for the hand-over radius
function phJS(x, z, salt) {
  const qx = (Math.floor(x * 64) + 4194304) >>> 0, qz = (Math.floor(z * 64) + 4194304) >>> 0;
  let h = (Math.imul(qx, 1597334677) ^ Math.imul(qz, 3812015801 | 0) ^ Math.imul(salt, 2798796415 | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519 | 0) >>> 0; h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}
// ---- Twig shrubs past the hand-over (2026-11-06, Lamar's sage from 13 m out and from the air): the impostor draws pictures
// of the very skeletons TwigShrubs draws up close (TwigShrubs.bake), not a dome. Each species' TWIG_COPIES skeletons of each
// record class are rendered once, as the close tier draws them at the field's median plant of that class (their tufts as the
// close tier's far-off blobs, the stems, twigs and dead wood), from TB_AZ azimuths and TB_EL elevations (0, 30, 60, 90
// degrees), into TB_T px tiles of two atlases (constants with TWIG_POR above): A the depth along the view, the leaf's (or the wood's) face normal and the
// coverage; B the leaf's shade, its own sun, its random (colour, leaf-on, flowers) and the part (leaf, stem, twig, dead).
// The impostor lights each texel as the close tier lights that leaf (FRAG twigPicture): the sun through the crown by
// Beer's law from the texel's own place in it, the leaf's face to the sun, the sky by its place. A plant takes the tile
// of its own class, copy and turn nearest the view (crossfaded across the tile boundaries), so at the hand-over the picture
// is the plant it replaces, seen from within half a tile's angle. A far plant that the density LOD has grown to stand for
// several goes back to the dome as it grows (1.1x to 1.5x), which keeps the stand's colour from the air as it was. The
// pictures are an eye-height look only: whole within TW_EL_LO (8) degrees of the horizontal over the plant, the dome from
// TW_EL_HI (12) up, as before. From 15-30 m up the 3D crowns measured half the domes' contrast (a crown's mean about the
// grass's, as Sentinel-2 has it, the tufts lit at ~0.3 of the sun): until the crowns' light is calibrated, a stand seen
// from above stays the domes (the coordinator, 2026-11-06). The elevations 30-90 stay baked for that calibration.
const BAKE_VERT = /* glsl */`
  attribute vec3 aOff; attribute vec4 aT;
  uniform vec3 bV; uniform vec3 bRight; uniform vec3 bUp; uniform vec4 bFrame; uniform vec3 bScale; uniform float bKeep;
  varying vec2 vUv; varying vec3 vN; varying float vDepth; varying float vType; varying float vRnd;
  void main() {
    float type = aT.x; bool leaf = type > 2.5;
    if (leaf && aT.y > bKeep) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }   // (the close tier's thinning, at this size)
    vec3 lp = position * vec3(bScale.y, 1.0, bScale.y) * bScale.x, Nf = normal;
    if (leaf) {   // the tuft's quad facing the view, the shoot as seen as its up; its leaves lit by their own face (aOff), as TWIG_VERT
      vec3 up2 = normal - bV * dot(normal, bV); float l2 = dot(up2, up2);
      up2 = l2 > 1e-4 ? up2 * inversesqrt(l2) : normalize(cross(bV, abs(bV.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      lp += (cross(up2, bV) * uv.x * 0.5 + up2 * (uv.y - 0.15)) * bScale.z;
      Nf = aOff;
    }
    Nf = dot(Nf, bV) < 0.0 ? -Nf : Nf;
    vec3 rel = lp - vec3(0.0, 0.5 * bFrame.w, 0.0);
    float dz = dot(rel, bV) / bFrame.z;
    vN = vec3(dot(Nf, bRight), dot(Nf, bUp), dot(Nf, bV));
    vDepth = clamp(0.5 + 0.5 * dz, 0.0, 1.0); vType = leaf ? 0.0 : type + 1.0; vRnd = aT.z; vUv = uv;
    gl_Position = vec4(dot(rel, bRight) / bFrame.x, dot(rel, bUp) / bFrame.y, -dz, 1.0);
  }`;
const BAKE_FRAG = /* glsl */`
  uniform sampler2D tuftMap; uniform float bPass;
  varying vec2 vUv; varying vec3 vN; varying float vDepth; varying float vType; varying float vRnd;
  ${TUFT_GLSL}
  void main() {
    float a = 1.0, sh = 1.0, tl = 1.0;
    if (vType < 0.5) a = tuft(vUv, vRnd, sh, tl);
    if (a < 0.5) discard;
    vec3 n = normalize(vN);
    gl_FragColor = bPass < 0.5 ? vec4(vDepth, n.xy * 0.5 + 0.5, 1.0) : vec4(clamp(sh / 1.25, 0.0, 1.0), clamp(tl, 0.0, 1.0), vRnd, vType / 3.0);
  }`;
// The pictures' mipmaps, coverage-preserving (2026-11-06): a porous crown's 64 px tile averaged down has its alpha spread
// thin (a 2x2 box of tufts and gaps is 0.4, a 4x4 0.4 everywhere), and the impostor, which sharpens the alpha about 0.5
// (twigPicture), would draw the crown as a translucent veil or not at all from 15-30 m up (the coordinator's "dark even
// fuzz"). So in each tile at each level the alpha is scaled so that the share of texels over 0.5 is the share of covered
// texels at full size (the classic alpha-test fix), and the premultiplied channels with it (their values kept). The crown
// keeps its silhouette and its gaps, and its share of the ground, at every size. Two DataTextures with their mip chains.
function twigMips(px, W, H) {
  const levels = [], T0 = TB_T;
  let w = W, h = H, A = px[0], B = px[1];
  const cov0 = new Float32Array(Math.ceil(W / T0) * Math.ceil(H / T0));   // each tile's covered share at level 0
  for (let ty = 0; ty < H / T0; ty++) for (let tx = 0; tx < W / T0; tx++) {
    let n = 0; for (let y = 0; y < T0; y++) for (let x = 0; x < T0; x++) if (A[((ty * T0 + y) * W + tx * T0 + x) * 4 + 3] >= 128) n++;
    cov0[ty * (W / T0) + tx] = n / (T0 * T0);
  }
  levels.push([A, B, w, h]);
  let rawA = new Float32Array(w * h * 4), rawB = new Float32Array(w * h * 4);   // the unscaled averages, premultiplied
  for (let i = 0; i < w * h * 4; i++) { rawA[i] = A[i]; rawB[i] = B[i]; }
  for (let k = 1; w > 1 || h > 1; k++) {
    const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1), nA = new Float32Array(w2 * h2 * 4), nB = new Float32Array(w2 * h2 * 4);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) for (let c = 0; c < 4; c++) {
      let sa = 0, sb = 0, n = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const xx = Math.min(2 * x + dx, w - 1), yy = Math.min(2 * y + dy, h - 1), i = (yy * w + xx) * 4 + c; sa += rawA[i]; sb += rawB[i]; n++; }
      nA[(y * w2 + x) * 4 + c] = sa / n; nB[(y * w2 + x) * 4 + c] = sb / n;
    }
    rawA = nA; rawB = nB; w = w2; h = h2;
    const oA = new Uint8Array(w * h * 4), oB = new Uint8Array(w * h * 4), T = T0 >> k;
    const scale = new Float32Array(w * h).fill(1);
    if (T >= 1) for (let ty = 0; ty < Math.floor(h / T); ty++) for (let tx = 0; tx < Math.floor(w / T); tx++) {
      const c0 = cov0[ty * (W / T0) + tx]; if (!(c0 > 0)) continue;
      const v = []; for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) v.push(rawA[((ty * T + y) * w + tx * T + x) * 4 + 3]);
      v.sort((a, b) => b - a);
      const at = v[Math.min(v.length - 1, Math.max(0, Math.round(c0 * v.length) - 1))];
      const sc = at > 0 ? Math.min(8, Math.max(0.5, 128 / at)) : 1;
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) scale[(ty * T + y) * w + tx * T + x] = sc;
    }
    for (let i = 0; i < w * h; i++) {
      const a = rawA[i * 4 + 3], a2 = Math.min(255, a * scale[i]), r = a > 0 ? a2 / a : 0;
      for (let c = 0; c < 3; c++) oA[i * 4 + c] = Math.min(255, Math.round(rawA[i * 4 + c] * r));
      for (let c = 0; c < 4; c++) oB[i * 4 + c] = Math.min(255, Math.round(rawB[i * 4 + c] * r));
      oA[i * 4 + 3] = Math.round(a2);
    }
    levels.push([oA, oB, w, h]);
  }
  return [0, 1].map(j => {
    const t = new THREE.DataTexture(levels[0][j], W, H, THREE.RGBAFormat);
    t.mipmaps = levels.map(L => ({ data: L[j], width: L[2], height: L[3] }));
    t.generateMipmaps = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    return releaseTexture(t);
  });
}
class TwigShrubs {
  constructor(field) {
    this.field = field; this.group = new THREE.Group(); this.group.name = 'twigshrubs';
    this.kinds = new Map();   // fk -> { variants: [{ mesh, iP, iS, n, frame }], slots, old }
    this.last = null; this.sig = NaN; this.count = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: TWIG_VERT, fragmentShader: TWIG_FRAG, side: THREE.DoubleSide, alphaToCoverage: true,
      uniforms: { ...field.uniforms, tuftMap: { value: bakeTuft() } } });
  }
  // the species' skeletons: TWIG_COPIES of each age class (treegen variantSlots' class seeds), built when first needed
  kind(fk) {
    let K = this.kinds.get(fk);
    if (K) return K;
    const id = FH[fk], slots = variantSlots(id), lg = j => 1000 + j * 17 + id.length;
    const classes = [...new Set(slots.filter(s => !s.snag).map(s => s.cls))];
    const variants = [], byCls = new Map();
    for (const cls of classes) {
      const s0 = slots.find(s => s.cls === cls), base = s0.seed - lg(s0.copy), list = [];
      for (let j = 0; j < TWIG_COPIES; j++) {
        const seed = base + lg(j), frame = shrubFrame(id, seed);
        if (!frame) continue;
        const r = frame.radii, w = r[0] + r[2];   // the skeleton's crown width (twice the mean of its x and z radii)
        const v = { mesh: null, iP: null, iS: null, n: 0, cap: TWIG_CAP0, H: frame.H, w: Math.max(w, 0.05), frame, seed, id, name: `twig-${id}-${cls}-${j}` };
        variants.push(v); list.push(v);
      }
      list.hMean = list.reduce((a, v) => a + v.H, 0) / Math.max(1, list.length);
      byCls.set(cls, list);
    }
    const names = SPECIES[id]?.classes?.map(c => c.name) || classes;
    const byIdx = names.map((n, i) => { if (byCls.get(n)?.length) return byCls.get(n); for (let d = 1; d < names.length; d++) for (const j of [i - d, i + d]) if (byCls.get(names[j])?.length) return byCls.get(names[j]); return null; });
    K = { variants, byCls, byIdx };
    this.kinds.set(fk, K);
    return K;
  }
  // a variant's geometry, built for the first plant drawn with it (twigGeometry scRef: its scale, a little over)
  build(v, sc) {
    const spec = SPECIES[v.id], scRef = Math.min(1.5, Math.max(0.2, sc * 1.1));
    for (const lite of [false, true]) {
      const t = lite ? (v.lite = { n: 0, cap: TWIG_CAP0 }) : v;
      const g = twigGeometry(v.frame, v.seed, spec?.targets?.porosity ?? 0.3, tuftOf(v.id), scRef, lite);
      t.iP = new THREE.InstancedBufferAttribute(new Float32Array(t.cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      t.iS = new THREE.InstancedBufferAttribute(new Float32Array(t.cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iP', t.iP); g.setAttribute('iS', t.iS); g.instanceCount = 0;
      t.mesh = new THREE.Mesh(g, this.material); t.mesh.frustumCulled = false; t.mesh.visible = false; t.mesh.name = v.name + (lite ? '-lite' : '');
      t.verts = g.attributes.position.count;
      this.group.add(t.mesh);
    }
    v.scRef = scRef;
  }
  // The pictures past the hand-over (see TB_T above): every twig species found in the field's cells, baked when it is first
  // seen (the atlases re-made with it, the species before it baked again: a few tens of ms). Needs the main renderer
  // (this.renderer, recorded as the field draws).
  bakeNew() {
    const f = this.field, r = this.renderer; if (!r) return;
    this.scanned ||= new WeakSet(); this.samples ||= new Map();   // fk -> { H: [[...] per class], R: [...] }
    let fresh = false;
    for (const [, i, j] of f.cells) {
      const c = f.cache.get(j * f.W + i); if (!c || this.scanned.has(c)) continue;
      this.scanned.add(c);
      const D = c.data;
      for (let o = 0; o < c.n * STRIDE; o += STRIDE) {
        const kind = D[o + 6]; if (kind > -0.5) continue;
        const fk = Math.round(-kind - 1); if (!FH_TWIG[fk]) continue;
        let S = this.samples.get(fk);
        if (!S) { this.samples.set(fk, S = { H: [], R: [], baked: false }); }
        if (!S.baked) fresh = true;
        if (S.R.length < 4000) { const ci = Math.floor(D[o + 5] / 100); (S.H[ci] ||= []).push(D[o + 4]); S.R.push(D[o + 3] / D[o + 4]); }
      }
    }
    if (fresh) this.bake(r);
  }
  bake(renderer) {
    const f = this.field, u = f.uniforms, med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
    const list = [...this.samples.keys()].sort((a, b) => a - b), plan = [];
    let tiles = 0;
    for (const fk of list) {
      const K = this.kind(fk), S = this.samples.get(fk), nCls = K.byIdx.length;
      const all = S.H.flat(), Hs = med(all), RH = med(S.R), hMid = SPECIES[FH[fk]]?.classes?.map(c => { const h = c.spec?.height_m || SPECIES[FH[fk]].height_m; return (h[0] + h[1]) / 2; });
      const hAll = hMid ? hMid.reduce((a, b) => a + b, 0) / hMid.length : 1;
      plan.push({ fk, K, base: tiles, H: Array.from({ length: nCls }, (_, ci) => S.H[ci]?.length >= 5 ? med(S.H[ci]) : Hs * (hMid ? hMid[ci] / hAll : 1)), RH });
      tiles += nCls * TWIG_COPIES * TB_EL * TB_AZ;
    }
    const W = TB_COLS * TB_T, Hpx = Math.ceil(tiles / TB_COLS) * TB_T;
    const target = () => new THREE.WebGLRenderTarget(W, Hpx, { depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const old = this.atlas; this.atlas = [target(), target()];
    const mat = new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, side: THREE.DoubleSide,
      uniforms: { bV: { value: new THREE.Vector3() }, bRight: { value: new THREE.Vector3() }, bUp: { value: new THREE.Vector3() }, bFrame: { value: new THREE.Vector4() },
        bScale: { value: new THREE.Vector3() }, bKeep: { value: 1 }, bPass: { value: 0 }, tuftMap: this.material.uniforms.tuftMap } });
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mesh = new THREE.Mesh(undefined, mat);
    mesh.frustumCulled = false; scene.add(mesh);
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevCol = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
    for (const rt of this.atlas) { rt.viewport.set(0, 0, W, Hpx); rt.scissorTest = false; renderer.setRenderTarget(rt); renderer.clear(true, true, false); }
    const mu = mat.uniforms, Vv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const P of plan) {
      const spec = SPECIES[FH[P.fk]], wh = spec?.targets?.crown_width_ratio ?? 1.2;
      P.H.forEach((Ht, ci) => {
        const L = P.K.byIdx[ci]; if (!L?.length) return;
        const Rt = Ht * (P.RH || wh / VIS_W);
        for (let j = 0; j < TWIG_COPIES; j++) {
          const v = L[j % L.length], sc = Ht / v.H;
          if (!v.mesh) this.build(v, sc);
          const st = Math.min(1.35, Math.max(0.75, VIS_W * Rt / (v.w * sc)));
          // (the copy the close tier draws past TWIG_LITE: the trunk and first branches with every tuft; the full copy's
          // twigs, a few mm thick, came out as broken pixel-wide lines and drew each crown as a dark spiky skeleton from above)
          const g = (v.lite?.mesh || v.mesh).geometry, n0 = g.instanceCount; g.instanceCount = 1; mesh.geometry = g;
          mu.bScale.value.set(sc, st, tuftOf(v.id)); mu.bKeep.value = sc * sc;
          for (let e = 0; e < TB_EL; e++) for (let a = 0; a < TB_AZ; a++) {
            const el = TB_EL_DEG[e] * Math.PI / 180, az = a * 2 * Math.PI / TB_AZ;
            Vv.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
            mu.bV.value.copy(Vv); mu.bRight.value.crossVectors(up, Vv).add({ x: 1e-4, y: 0, z: 0 }).normalize(); mu.bUp.value.crossVectors(Vv, mu.bRight.value);
            const ce = mu.bUp.value.y, se = Math.sqrt(Math.max(1 - ce * ce, 0)), ev = Math.sqrt(Ht * Ht * 0.25 * ce * ce + Rt * Rt * se * se);
            mu.bFrame.value.set(1.2 * Rt, 1.2 * ev, 1.3 * Math.max(VIS_W * Rt / 2, Ht / 2), Ht);
            const t = P.base + ((ci * TWIG_COPIES + j) * TB_EL + e) * TB_AZ + a, x = (t % TB_COLS) * TB_T, y = Math.floor(t / TB_COLS) * TB_T;
            this.atlas.forEach((rt, pass) => {
              mu.bPass.value = pass; rt.viewport.set(x, y, TB_T, TB_T); rt.scissor.set(x, y, TB_T, TB_T); rt.scissorTest = true;
              renderer.setRenderTarget(rt); renderer.render(scene, cam);
            });
          }
          g.instanceCount = n0;
        }
      });
      this.samples.get(P.fk).baked = true;
      u.twBase.value[P.fk] = P.base;
    }
    const px = this.atlas.map(rt => { const b = new Uint8Array(W * Hpx * 4); rt.viewport.set(0, 0, W, Hpx); rt.scissorTest = false; renderer.readRenderTargetPixels(rt, 0, 0, W, Hpx, b); return b; });
    renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto; renderer.setClearColor(prevCol, prevA);
    mat.dispose();
    for (const rt of this.atlas) rt.dispose();
    const tex = twigMips(px, W, Hpx);
    this.atlas = tex;
    u.twA.value = tex[0]; u.twB.value = tex[1]; u.twSize.value.set(TB_COLS, Hpx / TB_T);
    if (old) for (const t of old) t.dispose();
  }
  update(camera, again = true) {
    const cp = camera.position, f = this.field, b = f.uniforms.twigBand.value, R = b.y + TWIG_MARGIN, R2 = R * R;
    if (again && this.last && Math.hypot(cp.x - this.last[0], cp.z - this.last[1]) < 0.5 && this.sig === f.sig) return;
    this.last = [cp.x, cp.z]; this.sig = f.sig;
    const fresh = [];   // variants seen for the first time: built for the median scale of their plants here, then this again
    for (const K of this.kinds.values()) for (const v of K.variants) { v.n = 0; if (v.lite) v.lite.n = 0; }
    const res = f.tile.habitat.res;
    let count = 0;
    for (const [d, i, j] of f.cells) {
      if (d > R + res * 0.71) break;
      const c = f.cache.get(j * f.W + i); if (!c || !c.n) continue;
      const D = c.data;
      for (let k = 0, o = 0; k < c.n; k++, o += STRIDE) {
        const kind = D[o + 6]; if (kind > -0.5) continue;
        const fk = Math.round(-kind - 1); if (!FH_TWIG[fk]) continue;
        const dx = D[o] - cp.x, dz = D[o + 2] - cp.z, d2 = dx * dx + dz * dz; if (d2 > R2) continue;
        const thr = b.x + (b.y - b.x) * phJS(D[o], D[o + 2], 4) + TWIG_MARGIN; if (d2 > thr * thr) continue;   // (TWIG_VERT decides exactly)
        // the record class the plant was drawn in (foothillShrubs: its seed / 100), one of its TWIG_COPIES skeletons and its turn
        // by hashes of its root (VERT's ph, salts 5 and 6), so the impostor past the hand-over shows pictures of the same
        // skeleton turned the same way (bake)
        const K = this.kind(fk), list = K.byIdx[Math.min(Math.floor(D[o + 5] / 100), K.byIdx.length - 1)];
        if (!list?.length) continue;
        const v = list[Math.floor(phJS(D[o], D[o + 2], 5) * TWIG_COPIES) % list.length];
        const Hh = D[o + 4], sc = Hh / v.H;
        if (!v.mesh) { if (!v.samples) { v.samples = []; fresh.push(v); } v.samples.push(sc); continue; }
        const t = d2 < TWIG_LITE * TWIG_LITE ? v : v.lite;
        if (t.n >= t.cap) this.grow(t);
        const st = Math.min(1.35, Math.max(0.75, VIS_W * D[o + 3] / (v.w * sc)));
        t.iP.array.set([D[o], D[o + 1], D[o + 2], phJS(D[o], D[o + 2], 6) * 6.2831853], t.n * 4);
        t.iS.array.set([sc, st, Hh, fk], t.n * 4);
        t.n++; count++;
      }
    }
    if (fresh.length) {
      for (const v of fresh) { v.samples.sort((a, b) => a - b); this.build(v, v.samples[v.samples.length >> 1]); v.samples = null; }
      if (again) return this.update(camera, false);
    }
    for (const K of this.kinds.values()) for (const v0 of K.variants) for (const v of [v0, v0.lite]) {
      if (!v?.mesh) continue;
      v.mesh.geometry.instanceCount = v.n; v.mesh.visible = v.n > 0;
      if (v.n) { v.iP.clearUpdateRanges(); v.iP.addUpdateRange(0, v.n * 4); v.iP.needsUpdate = true; v.iS.clearUpdateRanges(); v.iS.addUpdateRange(0, v.n * 4); v.iS.needsUpdate = true; }
    }
    this.count = count;
  }
  grow(v) {
    const cap = v.cap * 2, g = v.mesh.geometry;
    const iP = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage); iP.array.set(v.iP.array);
    const iS = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage); iS.array.set(v.iS.array);
    g.setAttribute('iP', iP); g.setAttribute('iS', iS); v.iP = iP; v.iS = iS; v.cap = cap;
  }
}

// ---- The foothill shrubs (2026-10-26): toyon, western redbud, poison oak, coyote brush, blue elderberry and
// California coffeeberry (library/species, docs/species-library.md "Foothill shrubs"), kinds -1 to -6 of the
// shrub field (negative kinds), drawn by the same impostor with their own look (FH_* in FRAG and the season uniforms below).
// They come from the tile's species mix (each cell's row's shrub weights for these six, pipeline
// species_mix.py), not from the shrub cover alone: the canopy layer gives woodland, grassland and riparian
// cells almost no shrub cover (EVC classes the cell by its trees), but they have an understory. Cover of the
// six in a cell: chaparral, FH_CHAP of the chaparral field's own cover (on top of it) times their share of
// the row's shrub weights; elsewhere FH_UNDER of the habitat class times that share times the row's shrub
// density, in patches (an understory is clumped: poison oak colonies, toyon under the oaks' edges, coyote
// brush along a grassland's edge). Their own random stream per cell (salt 0xf007), so the chamise and
// manzanita of a chaparral cell are exactly as before. Sizes from the species files' classes (height_m and
// weights) and crown_width_ratio, as the 3D shrubs.
// FH (the list of ids, kinds -1..-FH_N) and FH_LOOK are declared with KIND above.
const FH_UNDER = { 1: 0.14, 2: 0.08, 3: 0.12, 5: 0.03, 6: 0.18 }, FH_CHAP = 0.8, FH_AREA = 3, FH_MAX = 0.4;
// The chaparral program's species (ShrubField): a row listing any of them is California's chaparral.
const CHAP_IDS = ['adenostoma_fasciculatum', 'chamise', 'arctostaphylos_viscida', 'arctostaphylos_manzanita', 'manzanita'];
// Albedo from a species file's sRGB colour: linear, times FH_GAIN, the same for every channel (2026-11-06). 1.3 was a
// display-era lift (the ground drawn at its photo's display colour, the old exposure); with the ground at its reflectance
// (atmosphere.js groundLook.physical) the exposure is raised by groundLook.exposureK for the whole scene, and the record's
// colour is taken as it is, as the trees' leaves are (iteration 8: 1.3 on top of the 1.38 exposure drew Lamar's sagebrush
// near-white, the snow-dusted stones again).
const FH_GAIN = () => (groundLook.physical ? 1.0 : 1.3);
const linK = c => { const g = FH_GAIN(); return c.map(v => Math.pow(v / 255, 2.2) * g); };
const seasonOfDry = d => d < 0.05 ? 'winter' : d < 0.5 ? 'spring' : d < 0.93 ? 'fall' : 'summer';   // as FRAG reads it
function fhSeason(u, season) {
  const month = seasonMonth(season);
  FH.forEach((id, k) => {
    const spec = SPECIES[id]; if (!spec) return;
    const F = spec.foliage;
    // (a recorded per-species calibration of the leaf albedo, foliage.albedo_calibration.k with its reason: big sagebrush's
    // judged colour against Sentinel-2 from above and its sunlit leaves at eye height; 1 where none)
    u.fhCol.value[k].set(...linK(F.colors[season] || F.colors.summer).map(v => v * (F.albedo_calibration?.k ?? 1)));
    u.fhBark.value[k].set(...linK(spec.trunk.twig_rgb || spec.trunk.bark_rgb || [110, 100, 90]));
    u.fhLeaf.value[k] = Math.min(1, Math.max(0, leafOnAt(spec, season, month)));
    // flowers or berries showing this month (berries first when both do): their colour and a share of the crown
    const D = [F.berries, F.flowers].find(d => d?.rgb && decoActive(d, season, month));
    if (D) u.fhDeco.value[k].set(...linK(D.rgb), Math.min(0.6, (D.density ?? 0.4) * 0.5)); else u.fhDeco.value[k].set(0, 0, 0, 0);
  });
}
// The size of a shrub follows its record and its stand (2026-11-06, phase 1 iteration 8). Each record's age classes
// (variants' height_m and weights) give the plants' heights, drawn mid-range in each class; the stand height of a record
// is its crown-area-weighted mean height (sum w E[H^3] / sum w E[H^2]: the height the crowns that cover the ground
// have). Where a cell's row carries LANDFIRE EVH's shrub height (species_mix.json mixes[].shrub_h_m: the mean height of
// the dominant shrubs) and no chaparral, every plant's height is scaled by EVH over the row's stand height (the shrubs'
// own, weighted by the row), within STAND_K: Lamar's big sagebrush, whose record classes run to 2 m (a stand height of
// 1.36 m), stands at LANDFIRE's 0.8 m, knee to waist high. The plant count then follows the drawn crowns: a cell's
// candidates are its cover's disc density over the mean visible crown area of its mix at that scale (sizeStats), so the
// drawn cover is the cell's cover at any size (before, a fixed 3 m^2 per plant drew small-crowned shrubs at 0.4 of
// their cover and the patches at 1.6x it).
const STAND_K = [0.5, 2];
function sizeStats(sz) {
  const tot = sz.cls.reduce((s, c) => s + c.w, 0) || 1, G = 6, WV = [0.91, 0.97, 1.03, 1.09];
  let h2 = 0, h3 = 0;
  const each = f => { for (const c of sz.cls) { const [h0, h1] = c.h; for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) f(c.w / tot / (G * G), h0 + (h1 - h0) * 0.5 * ((a + 0.5) / G + (b + 0.5) / G)); } };
  each((w, H) => { h2 += w * H * H; h3 += w * H * H * H; });
  const memo = new Map();
  // mean visible crown area (pi (VIS_W R / 2)^2) per candidate at height scale k, after the size thinning in cell()
  const area = k => {
    const key = Math.round(k * 100); let A = memo.get(key);
    if (A === undefined) {
      A = 0;
      each((w, H) => { for (const wv of WV) { const R = sz.wh * wv * k * H / VIS_W, a = Math.PI * R * R; A += w / WV.length * Math.PI * (VIS_W * R / 2) ** 2 * Math.min(1, FH_AREA * 1.5 / a); } });
      memo.set(key, A);
    }
    return A;
  };
  return { Hs: h2 > 0 ? h3 / h2 : 1, area };
}
function foothillShrubs(tile, ground, chap) {
  const hab = tile.habitat, W = hab.img.width, H = hab.img.height, res = hab.res, mix = tile.speciesMix;
  const sizes = FH.map(id => {
    const spec = SPECIES[id]; if (!spec) return null;
    const cls = (spec.variants || []).map(v => ({ w: v.weight ?? 0, h: v.height_m || spec.height_m }));
    const sz = { cls: cls.length ? cls : [{ w: 1, h: spec.height_m }], wh: spec.targets?.crown_width_ratio ?? 1.2 };
    return Object.assign(sz, sizeStats(sz));
  });
  const cover = new Float32Array(W * H), weights = new Array(W * H);
  const kOf = new Float32Array(W * H).fill(1), areaOf = new Float32Array(W * H), stand = new Uint8Array(W * H);
  // A row's carpet (2026-11-06; species_mix.json density_bytes[2]: the dwarf shrubs' share of the community's shrub cover,
  // which forbs.js lays as the heath's carpet) is not these shrubs' to fill: they take the rest of the cover. On Lofoten's
  // heath (a shrubland, class 4) the junipers had filled the whole shrub cover as if it were chaparral, on top of the carpet.
  const carpet = new Map(); for (const m of mix?.json?.mixes || []) { const c = (m.density_bytes?.[2] || 0) / 100; if (c > 0) carpet.set(m.index, Math.min(1, c)); }
  const rowJson = new Map((mix?.json?.mixes || []).map(m => [m.index, m]));
  const rowK = new Map();   // row index -> its height scale (EVH over the row's stand height), cached
  if (mix) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const row = mix.at(i, j); if (!row || !row.shrubSum) continue;
    const w = FH.map((id, k) => sizes[k] ? row.shrubs[id] || 0 : 0), share = w.reduce((a, b) => a + b, 0);
    if (share <= 0) continue;
    const cls = hab.channel(i, j, 0), o = j * W + i, sd = Math.min(Math.max(mix.density(i, j, row)[1], 0.3), 1.5);
    const chapShare = CHAP_IDS.reduce((a, id) => a + (row.shrubs[id] || 0), 0);
    // A shrubland row without chaparral: these shrubs are its shrub layer, a stand at the cell's own cover (openings as
    // the chaparral's, standOpen below), not an understory on top of the chaparral (FH_CHAP) or in patches.
    stand[o] = cls === 4 && chapShare <= 0 ? 1 : 0;
    cover[o] = (stand[o] ? Math.min(0.85, chap[o] * share) : Math.min(FH_MAX, cls === 4 ? FH_CHAP * chap[o] * share : (FH_UNDER[cls] || 0) * share * sd / 0.6))
      * (1 - (carpet.get(row.index) || 0));
    weights[o] = w.map(v => v / share);
    let k = rowK.get(row.index);
    if (k === undefined) {
      const hEvh = rowJson.get(row.index)?.shrub_h_m;
      k = 1;
      if (hEvh > 0 && chapShare <= 0) { let hs = 0; w.forEach((v, q) => { if (v > 0) hs += v / share * sizes[q].Hs; }); if (hs > 0) k = Math.min(STAND_K[1], Math.max(STAND_K[0], hEvh / hs)); }
      rowK.set(row.index, k);
    }
    kOf[o] = k;
    let A = 0; weights[o].forEach((v, q) => { if (v > 0) A += v * sizes[q].area(k); });
    areaOf[o] = A;
  }
  const coverAt = bilinear(cover, W, H, res, tile.size), any = anyAround(cover, W, H);
  // the most cover a candidate of the cell can be given (bilinear between its neighbours; an understory's patches 1.6x)
  const cmax = c => Math.min(0.9, c);
  const cellMax = (i, j) => { let m = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < W && b < H) m = Math.max(m, cover[b * W + a]); } return m; };
  // A stand's openings (as the chaparral's coverAt: rock, old burns, trails in about a tenth of the ground; the cover lifted
  // by as much, so the cell's mean is its cover).
  const standOpen = (x, n, c) => { const g = 0.65 * vnoise(x / 17, n / 17, 31) + 0.35 * vnoise(x / 6, n / 6, 32), t = 0.25 + 0.1 * (0.85 - c); return smooth(t - 0.06, t + 0.06, g) * 1.12; };
  const cell = (i, j) => {
    const out = [], { size, roads, waterMask: wm } = tile, rnd = mulberry32((i * 73856093) ^ (j * 19349663) ^ 0xf007);
    const o0 = j * W + i, A = areaOf[o0] || FH_AREA, lamMax = lam(cmax(cellMax(i, j) * (stand[o0] ? 1.12 : 1.6)));
    const n = Math.min(6000, Math.round(lamMax * res * res / A));
    for (let k = 0; k < n; k++) {
      const px = (i + rnd()) * res, pn = size - (j + rnd()) * res, keep = rnd(), u = rnd(), v = rnd(), w = rnd(), z = rnd();
      // a stand: the cell's cover with openings; an understory: patches tens of metres across (mean 1 over the ground)
      const c0 = coverAt(px, pn), c = Math.min(0.9, stand[o0] ? c0 * standOpen(px, pn, c0) : c0 * 1.6 * smooth(0.28, 0.62, vnoise(px / 23, pn / 23, 47)));
      if (c <= 0 || keep * lamMax >= lam(c)) continue;
      if (roads && roads.at(px, pn) > 60) continue;
      if (waterAt(wm, px, pn) === 255 || rockKeep(tile, px, pn) < u * 0.999) continue;
      const ci = Math.min(Math.max(Math.floor(px / res), 0), W - 1), cj = Math.min(Math.max(Math.floor((size - pn) / res), 0), H - 1);
      let wt = weights[cj * W + ci] || weights[j * W + i];
      // The water system's zones (tile.water, 2026-10-29): none in a channel's bed or a pond's basin and mud; on the margin,
      // the bank, the terrace and a pond's shore the zone row's shrubs (blackberry, grape, sandbar and button willow,
      // dogwood, rose...) in place of the cell's, at the zone's shrub density where the cell has less cover.
      const wz = tile.water && tile.water.info(px, pn);
      if (wz && wz.zone) {
        if (wz.zone === 1 || wz.zone === 5 || wz.zone === 6) continue;
        const row = mix?.ripRow(wz);
        if (row?.shrubSum) { const rw = FH.map((id, k) => sizes[k] ? row.shrubs[id] || 0 : 0), sh = rw.reduce((a, b) => a + b, 0); if (sh > 0) { wt = rw.map(v => v / sh); if (keep * lamMax >= lam(Math.max(c, 0.22 * row.density[1]))) continue; } }
      }
      if (!wt) continue;
      let sp = 0, acc = wt[0]; while (sp < FH.length - 1 && v > acc) acc += wt[++sp];
      const sz = sizes[sp]; if (!sz) continue;
      let ci2 = 0, a2 = sz.cls[0].w, tot = sz.cls.reduce((s2, q) => s2 + q.w, 0) || 1;
      while (ci2 < sz.cls.length - 1 && w * tot > a2) a2 += sz.cls[++ci2].w;
      const [h0, h1] = sz.cls[ci2].h, Hh = (h0 + (h1 - h0) * 0.5 * (z + rnd())) * kOf[cj * W + ci];
      const R = sz.wh * (0.88 + 0.24 * rnd()) * Hh / VIS_W;
      if (rnd() * Math.PI * R * R > FH_AREA * 1.5) continue;   // the larger crowns fewer, so the cover holds
      const variant = ci2 === sz.cls.length - 1 && sz.cls.length > 2 ? 2 : rnd() < 0.5 ? 0 : 1;   // 2: the old class (dead stems)
      // (a twig shrub's seed carries the record class it was drawn in, x 100: TwigShrubs draws that class's skeletons, and the
      // impostor its pictures of them)
      out.push(px, ground(px, pn), -pn, R, Hh, (FH_TWIG[sp] ? ci2 * 100 : 0) + Math.floor(rnd() * 100) + (variant + 0.5) / 4, KIND.toyon - sp, 0);
    }
    const m = out.length / STRIDE;
    for (let k = 0; k < m; k++) out[k * STRIDE + 7] = (k + 0.5) / m;
    return out;
  };
  // a cell's typical visible crown width (m), from its mix's mean crown area, for the field's density LOD (ShrubField)
  const cellWidth = o => areaOf[o] > 0 ? Math.sqrt(areaOf[o] * 4 / Math.PI) : 0;
  return { any, cell, cover, coverAt, cellWidth, kOf };
}

function anyAround(grid, W, H) {
  return (i, j) => {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < W && b < H && grid[b * W + a] > 0) return true;
    }
    return false;
  };
}
function bilinear(grid, W, H, res, size) {
  return (x, north) => {
    const u = x / res - 0.5, v = (size - north) / res - 0.5, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, H1 = H - 1;
    const i0 = Math.min(Math.max(i, 0), W - 1), i1 = Math.min(Math.max(i + 1, 0), W - 1);
    const r0 = Math.min(Math.max(j, 0), H1) * W, r1 = Math.min(Math.max(j + 1, 0), H1) * W;
    return (grid[r0 + i0] * (1 - fx) + grid[r0 + i1] * fx) * (1 - fy) + (grid[r1 + i0] * (1 - fx) + grid[r1 + i1] * fx) * fy;
  };
}
