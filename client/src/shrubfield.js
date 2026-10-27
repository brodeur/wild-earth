import * as THREE from 'three';
import { mulberry32, SPECIES } from './trees.js';
import { leafOnAt, decoActive, seasonMonth } from './treegen.js';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { groundUniforms, GROUND_GLSL } from './terrain.js';
import { windUniforms, WIND_GLSL } from './wind.js';
import { rockKeep } from './tilepackage.js';

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
  toyon: -1, redbud: -2, poison_oak: -3, coyote_brush: -4, elderberry: -5, coffeeberry: -6 };   // negative: the foothill shrubs (FH below)
// The foothill shrubs take negative kinds: shadows.js casts every kind over 1.5 as grass (its season height and a
// grass blade's sway, 0.35 H), which swung a toyon's shadow metres across its neighbours in the wind.
// Seed layout: integer part random, fractional part the silhouette variant (variant + 0.5) / 4.
const lam = c => -Math.log(1 - Math.min(c, 0.9));   // disc density giving cover c with random placement

const VERT = /* glsl */`
  ${ATMOSPHERE_GLSL}
  ${GROUND_GLSL}
  ${WIND_GLSL}
  uniform vec2 kParams;   // D0, KMIN
  uniform vec4 band;      // fade in from x to y, out from z to w (distance to camera)
  uniform float heightScale; uniform float dry;   // dry: 0 green season .. 1 cured summer sward
  uniform vec2 nearBand;  // the near detail (leaves, wands, stems) is full to x, gone by y (distance to camera)
  uniform vec3 fhCol[6];  // the foothill shrubs (FH, kind -1 - index): this season's leaf albedo, from the species files (fhSeason)
  attribute vec4 iPos; attribute vec4 iVar;   // root x y z, crown radius | height, seed, kind, rank
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
    float din = mix(band.x, band.y, ph(iPos.xz, 1u)), dout = mix(band.z, band.w, ph(iPos.xz, 2u));
    float wi = max(0.12 * (band.y - band.x), 0.4), wo = max(0.12 * (band.w - band.z), 0.4);
    float s = clamp((keep - rank) / 0.05, 0.0, 1.0) * smoothstep(din - wi, din + wi, d) * (1.0 - smoothstep(dout - wo, dout + wo, d));
    if (s < 0.01) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    vFade = s;
    float nearK = 1.0 - smoothstep(nearBand.x, nearBand.y, d);
    #ifdef NEAR
    if (nearK <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    #else
    if (nearK >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    #endif
    float grow = inversesqrt(keep);
    R *= grow; H *= sqrt(grow);
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
    float occ = (1.0 - 0.35 * clamp(texture(canopyMap, guv).r * 2.55, 0.0, 1.0)) * groundContactAO(iPos.xyz);
    // Species colour, varied per shrub and by stand (a warm, olive palette: chamise dark olive-green,
    // whiteleaf manzanita paler, grey-green to glaucous), pulled toward the photo.
    bool fh = kind < -0.5;   // a foothill shrub (FH, kinds -1 to -6): its colour from its species file, this season
    bool manz = kind > 0.5;
    vec3 a = fh ? fhCol[int(-kind - 0.5)] : manz ? vec3(0.09, 0.11, 0.07) : vec3(0.108, 0.113, 0.06);
    float v1 = hh(seed * 7.1), v2 = hh(seed * 3.3), stand = wNoise(iPos.xz * 0.025 + (manz ? 7.0 : fh ? kind : 0.0));
    a *= (manz || fh) ? mix(vec3(0.94, 1.0, 1.1), vec3(1.06, 1.03, 0.9), v1) : mix(vec3(0.9, 1.0, 1.04), vec3(1.1, 1.03, 0.86), v1);
    a *= mix(vec3(1.05, 1.0, 0.9), vec3(0.94, 1.0, 1.06), stand) * (0.78 + 0.44 * v2);
    float al = dot(a, G_LUMA);
    a = mix(a, gc * al / max(gl, 1e-3), 0.2) * mix(1.0, clamp(gl / 0.075, 0.8, 1.25), 0.5);
    vAlbedo = a;
    vSun = sunLight * cloudShadow(C); vAmb = ambientGround * occ; vAmbUp = ambientSky * occ;
    vIn = atmosphereApply(vec3(0.0), C, cameraPosition);
    vT = atmosphereApply(vec3(1.0), C, cameraPosition) - vIn;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */`
  uniform vec3 sunDir; uniform float heads; uniform float dry;   // dry: the season (grass.js's palette value)
  uniform sampler2D leafM; uniform sampler2D leafC; uniform vec4 leafGain;   // leaf pictures (bakeLeaves); their gain in sun (manzanita, chamise) and in shade (same)
  // The foothill shrubs (FH: kinds -1 to -6, index -1 - kind), this season (fhSeason): leaf-on (0 bare .. 1), the bark
  // and bare-twig albedo, and the flowers or berries showing (albedo, share of the outer crown they cover).
  uniform float fhLeaf[6]; uniform vec3 fhBark[6]; uniform vec4 fhDeco[6];
  // Their outlines (docs/species-library.md, "Foothill shrubs", impostor cards): lobe depth (toyon lumpy in
  // sub-crowns, coffeeberry and coyote brush smooth), how far the fringe breaks up (poison oak and elderberry
  // open and ragged), and a narrow base (redbud's vase, poison oak's leaning stems).
  const float FH_LOBE[6] = float[6](0.34, 0.24, 0.36, 0.1, 0.3, 0.14);
  const float FH_OPEN[6] = float[6](0.62, 0.48, 0.38, 0.7, 0.42, 0.68);
  const float FH_VASE[6] = float[6](0.0, 0.26, 0.16, 0.0, 0.06, 0.0);
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
  void main() {
    // Distance fades: screen-space dither (the interleaved gradient noise the tree tiers hand over
    // with), never a size change.
    if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vFade) discard;
    // Near and far are two programs from this one source (NEAR defined for the near one), each drawing
    // only its own plants; across nearBand a plant is handed from one to the other by a dither of its
    // pixels (an R2 pattern, apart from the fade's), so no pixel runs both.
    float split = fract(dot(floor(gl_FragCoord.xy), vec2(0.7548777, 0.5698403)));
    #ifdef NEAR
    if (split >= vDim.w) discard;
    const float near = 1.0;
    #else
    if (split < vDim.w) discard;
    const float near = 0.0;
    #endif
    float kind = vKind, vv = vVar;
    bool fh = kind < -0.5;           // a foothill shrub: drawn as manzanita is (leaf masses, stems), with its own look
    int fk = fh ? int(-kind - 0.5) : 0;
    bool manz = kind > 0.5, broad = manz || fh, fine = fh && fk == 3;   // fine: coyote brush takes chamise's picture
    bool picM = broad && !fine;   // up close: the round-leaf picture (manzanita's) or the fine one (chamise's)
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
      if (dot(q, q) > (near > 0.0 && !broad ? 2.2 : 1.9)) discard;
    }
    float r2 = dot(q, q);
    float z = sqrt(max(1.0 - min(r2, 1.0), 0.0));
    // World normal of the ellipsoid point under this pixel; lobes keyed on it stay put on the plant.
    vec3 nW = vRight * q.x + vUp * q.y + vView * z; nW = normalize(vec3(nW.x, nW.y * vYS, nW.z));
    float lobe = n3(nW * 1.6 * vLobes + vSeed * 37.0), twig = n3(nW * 6.0 * vLobes + vSeed * 11.0);
    // A foothill shrub's flowers or berries this season: clusters over the outer, upper crown, a hash of the crown
    // normal (stable on the plant as the view turns), the share fhDeco.a of them; they stay on a bare crown
    // (redbud's magenta on bare twigs in March).
    float fdk = fh ? step(1.0 - fhDeco[fk].a, h3(floor(nW * 13.0 * vLobes + vSeed * 13.0))) * smoothstep(-0.45, 0.25, nW.y) : 0.0;
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
      float rbN = rb + (broad ? 0.34 * (twig - 0.5) : 0.45 * (streak - 0.5) + 0.12 * (twig - 0.5)) * smoothstep(-0.5, 0.2, nW.y);
      float dEdge = min((broad ? rbN : rbN * 0.93) - rr, (hgt - baseH) / max(vDim.y * sc, 0.1));   // > 0 inside the foliage
      // Leaves (manzanita: round, 2.5-5 cm, in sprays, a red twig in the gaps) and needle tufts on wands
      // (chamise), from a baked picture of each (bakeLeaves) wrapped round the crown by azimuth and height
      // (a whole number of tiles round, so no seam) with a flat cap on top: it stays on the plant as the
      // view turns, and its mipmaps fade it to its mean far off. Past the outline the picture runs on
      // outward and only the leaves' cores are kept, so the edge is single leaves and tufts, thinning out.
      vec3 s3 = vRight * q.x + vUp * q.y + vView * z;
      vec3 P = s3 * vec3(Rm, Hh, Rm) * sc;
      float T = picM ? 1.0 : 0.8, Nu = max(1.0, floor(6.2832 * Rm * sc / T + 0.5)) / 6.2832;
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
      tex = picM ? textureGrad(leafM, uv, ddx, ddy) : textureGrad(leafC, uv, ddx, ddy);
      if (wc > 0.0) tex = mix(tex, picM ? textureGrad(leafM, uvT, dxT, dyT) : textureGrad(leafC, uvT, dxT, dyT), wc);
      lres = 1.0 - smoothstep(3.0, 9.0, 512.0 * max(max(length(ddx), length(ddy)), wc * max(length(dxT), length(dyT))));
      rim = smoothstep(0.22, 0.0, dEdge);
      float outer = clamp(-dEdge / 0.2, 0.0, 1.0), thr = mix(0.5, 0.93, outer), gw = 0.5 * fwidth(tex.g) + 0.02;
      body = mix(alpha, mix(1.0, smoothstep(thr - gw, thr + gw, tex.g), rim) * step(-0.2, dEdge), lres);   // foliage coverage
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
    if (alpha < 0.05) discard;
    // Leaf clusters: brighter sunlit clumps over dark holes into the crown (up close, from the octaves
    // already at hand: the leaf picture carries the finer structure).
    #ifdef NEAR
    float lc = lobe * 0.35 + twig * 0.65;
    #else
    float lc = n3(nW * 4.0 * vLobes + vSeed * 5.0) * 0.6 + twig * 0.4;
    #endif
    vec3 N = normalize(nW + (vec3(lobe, 0.5, twig) - 0.5) * 0.9);
    float diff = max(dot(N, sunDir), 0.0);
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
      colF = mix(colF, fol * tipRel * (broad ? 1.0 : 0.6), step(rnd, tipShare * smoothstep(broad ? 0.0 : 0.1, 0.6, nW.y)) * lres);
      vec3 barkC = fh ? fhBark[fk] : manz ? vec3(0.12, 0.042, 0.038) : vec3(0.15, 0.11, 0.08), deadC = broad ? vec3(0.24, 0.23, 0.2) : vec3(0.24, 0.225, 0.2);
      float woodCov = broad ? stemCov : wandCov;
      vec3 woodLit = mix(barkC, deadC, broad ? stemDead : wandDead) * (sunL * 0.4 + amb * 1.1);
      vec3 texWood = mix(barkC, deadC, step(0.5, rnd)) * 0.8;
      if (!broad) woodLit = mix(woodLit, mix(fol, fol * tipRel * 0.6, wandTip * step(0.001, tipShare)) * cl * (sunL * 0.8 + ambL), wandLeaf);
      vec3 base = mix(colF, texWood, woodF);
      vec2 gn = picM ? leafGain.xz : leafGain.yw;
      vec3 folLit = base * cl * (sunL * leafSun * shade * gn.x + ambL * (0.5 + 0.5 * shade) * gn.y);
      // The geometric stems and wands show through the picture's gaps in the lower crown and the holes.
      float show = max(rim, smoothstep(Hh * 0.75, Hh * 0.45, hgt));
      folLit = mix(folLit, woodLit, woodCov * show * (1.0 - smoothstep(0.3, 0.5, tex.g)) * lres);
      // In the crown's notches between its masses, shade.
      float crev = mix(0.6, 1.0, smoothstep(0.0, 0.12, seam));
      // Where only a wand or a stem covers the pixel, it is drawn.
      outN = mix(woodLit, folLit, clamp(body / max(alpha, 1e-3), 0.0, 1.0)) * crev;
    }
    gl_FragColor = vec4(((near > 0.0 ? outN : outH) * 0.3183099) * vT + vIn, alpha);
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
// Baked once per page (shrubLeaves; grass.js asks for both while the world builds, a task each, so ShrubField finds them).
const leafPictures = new Map();
export function shrubLeaves(manz) { let t = leafPictures.get(manz); if (!t) leafPictures.set(manz, t = bakeLeaves(manz)); return t; }
function bakeLeaves(manz) {
  const S = 512, rnd = mulberry32(manz ? 0x1eaf5 : 0xc4a35);
  const ch = [0, 1, 2, 3].map(k => { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); g.fillStyle = k ? '#000' : '#333'; g.fillRect(0, 0, S, S); return g; });
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
  if (manz) {
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
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = img[c][i * 4];
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// Chaparral shrubs. Cover per cell: chaparral cells only, the canopy's shrub % (floored: a low value
// in a chaparral cell is more often a burn scar or a data gap than open ground), bilinear between
// cell centres so a stand thins out over a cell instead of stopping at a 30 m square.
// Heights (m) by age class, young / mature / decadent: library/species adenostoma_fasciculatum.json and
// arctostaphylos_viscida.json (height_m and their variants), as the 3D shrubs of vegetation.js. The card's
// visible crown (the cluster of stems' crowns with its outline) is about H tall (0.9 H past the near band)
// and VIS_W x R across (measured side on: 1.85 R near, 1.6 R at 40 m), so R = width / VIS_W.
const SHRUB_H = { chamise: [[0.6, 1.3], [1.2, 2.4], [1.5, 2.6]], manzanita: [[0.7, 1.5], [1.5, 3.5], [2.0, 3.5]] };
const VIS_W = 1.75;
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
  const cover = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++)
    if (hab.channel(i, j, 0) === 4) cover[j * W + i] = Math.min(Math.max(can.channel(i, j, 1) / 100, 0.3), 0.85);
  const cellCover = bilinear(cover, W, H, res, tile.size);
  // Openings: a stand is not a lawn. Rock outcrops, old burn patches and game trails leave gaps of
  // a few to ~15 m in about one tenth of the ground, more where the cover is thin.
  const coverAt = (x, n) => {
    const c = cellCover(x, n);
    if (c <= 0) return 0;
    const g = 0.65 * vnoise(x / 17, n / 17, 31) + 0.35 * vnoise(x / 6, n / 6, 32), t = 0.25 + 0.1 * (0.85 - c);
    return c * smooth(t - 0.06, t + 0.06, g) * rockKeep(tile, x, n);   // and the outcrops of rocks.js open the stand
  };
  const fh = foothillShrubs(tile, ground, cover);
  const field = new ClumpField(tile, ground, uniforms, {
    name: 'shrubfield', salt: 0x5eed, cap: 200000, roadsMax: 60, near: true,
    extraAny: fh.any, extra: fh.cell,   // the foothill shrubs, merged into the chaparral's cells and the woodland's
    cellAny: anyAround(cover, W, H), coverAt, coverMax: 0.85,
    meanArea: OLD_AREA / QMAX,   // candidates for the densest places; plant() thins them (see eOld)
    // Gone only right at the camera, at every height (the 3D shrubs are too few to carry the cover). The
    // chase camera trails the raven by 3-5 m, so a 3-8 m cut emptied the ring around the bird itself.
    // KMIN 1 / 1.5^2: a far survivor grows by 1 / sqrt(keep), so it is never more than 1.5x its own width
    // (1.22x its height); past ~170 m the field keeps 44% of its plants instead of thinning further.
    D0: 115, KMIN: 1 / 1.5 ** 2, band: [1.2, 3.5, 370, 430], now: 140,
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
  field.uniforms.leafM = { value: shrubLeaves(true) }; field.uniforms.leafC = { value: shrubLeaves(false) };
  field.uniforms.leafGain = { value: new THREE.Vector4(2.5, 4.0, 1.25, 1.4) };   // the near look matched to the far one in mean (measured on screen)
  // The foothill shrubs' season (fhSeason), set from the field's season (grass.js's `dry`) when it changes.
  Object.assign(field.uniforms, {
    fhCol: { value: FH.map(() => new THREE.Vector3()) }, fhBark: { value: FH.map(() => new THREE.Vector3()) },
    fhLeaf: { value: FH.map(() => 1) }, fhDeco: { value: FH.map(() => new THREE.Vector4()) } });
  const update = field.update.bind(field);
  let fhKey = null;
  field.update = (camera, on = true, band = null) => {
    const season = seasonOfDry(field.uniforms.dry.value), key = `${season}:${seasonMonth(season).toFixed(1)}`;
    if (key !== fhKey) { fhKey = key; fhSeason(field.uniforms, season); }
    update(camera, on, band);
  };
  field.foothill = fh;
  return field;
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
const FH = ['heteromeles_arbutifolia', 'cercis_occidentalis', 'toxicodendron_diversilobum', 'baccharis_pilularis',
  'sambucus_nigra_caerulea', 'frangula_californica'];   // kinds -1..-6
const FH_UNDER = { 1: 0.14, 2: 0.08, 3: 0.12, 5: 0.03, 6: 0.18 }, FH_CHAP = 0.8, FH_AREA = 3, FH_MAX = 0.4;
// Albedo from a species file's sRGB colour (linear, scaled to the chaparral shrubs' level: chamise's summer
// colour comes out within a few per cent of its own albedo here).
const FH_K = [0.6, 0.6, 0.48];
const linK = c => c.map((v, i) => Math.pow(v / 255, 2.2) * FH_K[i]);
const seasonOfDry = d => d < 0.05 ? 'winter' : d < 0.5 ? 'spring' : d < 0.93 ? 'fall' : 'summer';   // as FRAG reads it
function fhSeason(u, season) {
  const month = seasonMonth(season);
  FH.forEach((id, k) => {
    const spec = SPECIES[id]; if (!spec) return;
    const F = spec.foliage;
    u.fhCol.value[k].set(...linK(F.colors[season] || F.colors.summer));
    u.fhBark.value[k].set(...linK(spec.trunk.twig_rgb || spec.trunk.bark_rgb || [110, 100, 90]));
    u.fhLeaf.value[k] = Math.min(1, Math.max(0, leafOnAt(spec, season, month)));
    // flowers or berries showing this month (berries first when both do): their colour and a share of the crown
    const D = [F.berries, F.flowers].find(d => d?.rgb && decoActive(d, season, month));
    if (D) u.fhDeco.value[k].set(...linK(D.rgb), Math.min(0.6, (D.density ?? 0.4) * 0.5)); else u.fhDeco.value[k].set(0, 0, 0, 0);
  });
}
function foothillShrubs(tile, ground, chap) {
  const hab = tile.habitat, W = hab.img.width, H = hab.img.height, res = hab.res, mix = tile.speciesMix;
  const sizes = FH.map(id => {
    const spec = SPECIES[id]; if (!spec) return null;
    const cls = (spec.variants || []).map(v => ({ w: v.weight ?? 0, h: v.height_m || spec.height_m }));
    return { cls: cls.length ? cls : [{ w: 1, h: spec.height_m }], wh: spec.targets?.crown_width_ratio ?? 1.2 };
  });
  const cover = new Float32Array(W * H), weights = new Array(W * H);
  if (mix) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const row = mix.at(i, j); if (!row || !row.shrubSum) continue;
    const w = FH.map((id, k) => sizes[k] ? row.shrubs[id] || 0 : 0), share = w.reduce((a, b) => a + b, 0);
    if (share <= 0) continue;
    const cls = hab.channel(i, j, 0), o = j * W + i, sd = Math.min(Math.max(mix.density(i, j, row)[1], 0.3), 1.5);
    cover[o] = Math.min(FH_MAX, cls === 4 ? FH_CHAP * chap[o] * share : (FH_UNDER[cls] || 0) * share * sd / 0.6);
    weights[o] = w.map(v => v / share);
  }
  const coverAt = bilinear(cover, W, H, res, tile.size), any = anyAround(cover, W, H);
  const lamMax = lam(FH_MAX * 1.6);
  const cell = (i, j) => {
    const out = [], { size, roads, waterMask: wm } = tile, rnd = mulberry32((i * 73856093) ^ (j * 19349663) ^ 0xf007);
    const n = Math.round(lamMax * res * res / FH_AREA);
    for (let k = 0; k < n; k++) {
      const px = (i + rnd()) * res, pn = size - (j + rnd()) * res, keep = rnd(), u = rnd(), v = rnd(), w = rnd(), z = rnd();
      // patches tens of metres across: the understory clumps (mean 1 over the ground)
      const c = coverAt(px, pn) * 1.6 * smooth(0.28, 0.62, vnoise(px / 23, pn / 23, 47));
      if (c <= 0 || keep * lamMax >= lam(c)) continue;
      if (roads && roads.at(px, pn) > 60) continue;
      if (waterAt(wm, px, pn) === 255 || rockKeep(tile, px, pn) < u * 0.999) continue;
      const ci = Math.min(Math.max(Math.floor(px / res), 0), W - 1), cj = Math.min(Math.max(Math.floor((size - pn) / res), 0), H - 1);
      const wt = weights[cj * W + ci] || weights[j * W + i]; if (!wt) continue;
      let sp = 0, acc = wt[0]; while (sp < FH.length - 1 && v > acc) acc += wt[++sp];
      const sz = sizes[sp]; if (!sz) continue;
      let ci2 = 0, a2 = sz.cls[0].w, tot = sz.cls.reduce((s2, q) => s2 + q.w, 0) || 1;
      while (ci2 < sz.cls.length - 1 && w * tot > a2) a2 += sz.cls[++ci2].w;
      const [h0, h1] = sz.cls[ci2].h, Hh = h0 + (h1 - h0) * 0.5 * (z + rnd());
      const R = sz.wh * (0.88 + 0.24 * rnd()) * Hh / VIS_W;
      if (rnd() * Math.PI * R * R > FH_AREA * 1.5) continue;   // the larger crowns fewer, so the cover holds
      const variant = ci2 === sz.cls.length - 1 && sz.cls.length > 2 ? 2 : rnd() < 0.5 ? 0 : 1;   // 2: the old class (dead stems)
      out.push(px, ground(px, pn), -pn, R, Hh, Math.floor(rnd() * 100) + (variant + 0.5) / 4, KIND.toyon - sp, 0);
    }
    const m = out.length / STRIDE;
    for (let k = 0; k < m; k++) out[k * STRIDE + 7] = (k + 0.5) / m;
    return out;
  };
  return { any, cell, cover, coverAt };
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
