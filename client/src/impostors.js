import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { SPECIES, SPECIES_IDS, mulberry32, resolveSpecies } from './trees.js';
import { VARIANTS, pick, hash, variantSeed, handover, cellPlan, placementSkip, placePlant, monthFor, crownPlan, rareSpecies, drawnSeed, tileSpecies } from './vegetation.js';
import { variantSlots, leafOnAt, treeWood } from './treegen.js';
import { hasCrowns, SCALE } from './crowns.js';
import { bakeImpostors, VIEWS, SIDE_VIEWS, ALPHA_REF } from './impostorBake.js';
import { seasonOfDate } from './season.js';

// Distant forest: one impostor per tree, for the whole tile, where the real trees (vegetation.js)
// end. Each impostor is the tree vegetation.js would put there (same per-cell random stream, so the
// same species, variant, position, scale and rotation) drawn from an atlas baked at load from that
// very tree (impostorBake.js), so flying in swaps a tree for itself.
//
//   - Mid band (to about nearRadius + 150..450 m, per tree): two crossed quads with the 0 and 90
//     degree views (the back of a quad shows the mirror image, which is the true opposite view).
//   - Far band: one camera-facing (cylindrical) billboard blending the two nearest of eight views.
//   - Both: a horizontal cap with the top view, visible when looking down.
//   - Lit live from the baked crown normals with the same sun, sky light, cloud shadow and aerial
//     perspective as the Lambert trees; alpha-to-coverage with a sharpened alpha edge. The normals are
//     prefiltered (impostorBake.js: averaged, not renormalised), so a texel over lobes facing several
//     ways is lit by the mean of their sun terms (a smooth max of the mean normal's term and its
//     spread) rather than by one arbitrary lobe: a far crown shades as a crown, not as salt and pepper.
//   - Pines get the real needles' light (treegen canopyMaterial: wrap, light through the needles when
//     backlit, the weak glow of a backlit crown) with the same fade, out by 900..1500 m from the eye,
//     so with the near forest radius (900 m) a backlit stand no longer darkens where it hands over
//     (compiled only where it can reach half strength, see update()).
//   - Hand-over (vegetation.js handover): per tree, by its distance to the eye (the bird), across
//     hand.x +/- hand.y m (1209-1279 m with the 1.5 km setting): the impostor keeps the pixels the mid
//     tree's dither drops (FRAG), so in the band each tree is drawn once per pixel, partly as itself
//     and partly as its own impostor, and the share moves smoothly with the eye; the mid set's rebuild
//     every 200 m changes nothing on screen. Nothing grows, thins or varies in the band (all of that
//     starts at nearRadius + RING, beyond the farthest the mid set reaches).
//   - Thinning: beyond nearRadius + RING (past the farthest edge of the mid set), only a fraction
//     (thin/d)^P of trees is kept (by a per-tree rank) and the survivors widen to keep the canopy
//     cover (each survivor's silhouette grows by 1/keep, width keep^-0.72 and height keep^-0.28, so the
//     cover of a stand, about 1 - exp(-density x area), holds out to the horizon instead of opening into
//     single trees); trees there also pick up height variance (about their own slot's height), width and
//     a slight lean, so repeated variants do not read as copies. Far shrubs stand for patches of chaparral.
//   - Shadows: casterMaterial() draws each impostor beyond hand.x as a sun-facing ellipse of its crown,
//     grown and thinned as the impostor is, into the largest cascade (shadows.js), where the mid set's
//     crown ellipsoids stop: the ground and the crowns beyond the real forest are shaded by the trees
//     drawn there.
// Trees are precomputed per 250 m chunk sorted by rank; every MOVE m the kept prefix of each chunk is
// copied either into the ring mesh (chunks that can reach the crossed band: two side quads and the cap)
// or into one of six angular sectors of billboard-only meshes (one quad, a third of the vertices),
// each one draw call and frustum-culled, so a view draws the ring and two to four sectors.

const CHUNK = 250, MOVE = 80, SECTORS = 6, STRIDE = 8;   // record: x y z rot | scale tree rank width (crown aspect, crowns.js; 1 for cell trees)
const THIN_P = 0.7;                // keep (thinStart / d)^P beyond thinStart
const GROW_W = 0.72, GROW_H = 0.28; // a kept tree's width and height grow by keep^-GROW (GROW_W + GROW_H = 1: area / keep)
const NEEDLE_FADE = [900, 1500];    // treegen canopyMaterial fades the needle light out over this view distance
const NEEDLE_ON = 1200;             // compile the needle light where trees can be nearer than this (half of it left)
const RING = 250;                  // the mid set reaches at most nearRadius + 200 + a cell from the eye: no thinning or variety inside +250
const CAST_KEEP = 0.5, CAST_R = 4500;   // far shadow casters: share kept, reach from the camera (see CASTER_VERT)
const HAND_MARGIN = 15;            // rebuild() measures from the camera, the hand-over from the bird (a chase camera's offset)
const CROSS = [150, 450];          // crossed -> billboard switch, per tree, at nearRadius + 150..450
// Lidar crowns (crowns.js) put 40% more trees on the home tile than the cell plan did (395 k against 281 k), and
// taller ones: beyond the thinning start the far tier keeps CROWN_KEEP of what it would (eased in over CROWN_EASE m,
// the survivors widening as for any thinning), so its instance count and cost stay near the cell plan's.
const CROWN_KEEP = 0.7, CROWN_EASE = 600;
const srgbToLin = v => Math.pow(v / 255, 2.2);

// Atlas slots per species (2026-10-25). Every plant draws one of VARIANTS (12) slots as always, but the
// atlas bakes only as many distinct trees per species as its share of the tile's plants is worth: a
// species with at least SLOT_TIERS[0][0] of its layer (trees or shrubs) gets 12 slots (in practice its
// 4-6 distinct class trees), any other placed species 4, and a species the tile never places none. Over
// MAX_TREES distinct baked trees (about 0.83 MB each, both atlases with mips: 64 trees, 53 MB), the species with the
// smallest share per baked tree gives up a tree (slots 12 -> 4 -> 3 -> 2 -> 1), repeatedly, so common
// species keep their variety and rare ones share what is left. A plant whose own tree is not baked takes
// the baked tree of its age class (else the nearest slot), so at the hand-over (about 1.2 km) a rare
// species' tree may swap for a sibling of its class.
const SLOT_TIERS = [[0.02, 12], [0, 4]];
const SLOT_STEPS = [12, 8, 4, 3, 2, 1];
export const MAX_TREES = 64;   // 64 trees x 5 views in rows of 10 cells of 128 texels: a 1280 x 4096 atlas, inside every WebGL2 device's texture size limit
const distinctTrees = (id, n) => new Set(variantSlots(id, n).map(s => s.seed)).size;
// The seed the impostor of slot v (0..VARIANTS-1) bakes when its species has n atlas slots.
export function impostorSeed(id, v, n) {
  const all = variantSlots(id, VARIANTS), own = all[v];
  if (n >= VARIANTS) return own.seed;
  const few = variantSlots(id, n);
  if (few.some(s => s.seed === own.seed)) return own.seed;
  const same = few.filter(s => s.cls === own.cls);
  if (same.length) return same[own.copy % same.length].seed;
  return few[Math.min(n - 1, Math.floor(v * n / VARIANTS))].seed;
}
// counts: species id -> { tree, shrub } plants placed. Returns { ids, slots: { id: n }, share: { id: s }, trees }.
export function planSlots(counts, maxTrees = MAX_TREES, library = SPECIES_IDS) {
  const ids = library.filter(id => counts[id] && counts[id].tree + counts[id].shrub > 0);
  let T = 0, Sh = 0; for (const id of ids) { T += counts[id].tree; Sh += counts[id].shrub; }
  const share = {}, slots = {};
  for (const id of ids) {
    const c = counts[id], asTree = c.tree >= c.shrub;
    share[id] = asTree ? c.tree / Math.max(1, T) : c.shrub / Math.max(1, Sh);
    slots[id] = SLOT_TIERS.find(([s]) => share[id] >= s)[1];
  }
  const total = () => ids.reduce((a, id) => a + distinctTrees(id, slots[id]), 0);
  let trees = total();
  // Over the cap, a tree goes from the species with the smallest share of all plants (shrubs are many but
  // small far away) per baked tree, in two rounds: no species goes under 2 trees before every one is at 2.
  const all = T + Sh, weight = Object.fromEntries(ids.map(id => [id, (counts[id].tree + counts[id].shrub) / Math.max(1, all)]));
  for (const floor of [2, 1]) while (trees > maxTrees) {
    let best = null, bc = Infinity;
    for (const id of ids) { const t = distinctTrees(id, slots[id]); if (slots[id] <= 1 || t <= floor) continue; const c = weight[id] / t; if (c < bc) { bc = c; best = id; } }
    if (!best) break;
    const t0 = distinctTrees(best, slots[best]);   // step down until it bakes one tree fewer
    while (slots[best] > 1 && distinctTrees(best, slots[best]) >= t0) slots[best] = SLOT_STEPS[SLOT_STEPS.indexOf(slots[best]) + 1] ?? 1;
    trees = total();
  }
  return { ids, slots, share, trees };
}

// A far tree's growth with distance d from the eye, shared by the impostor and its shadow caster:
// x width and y height multipliers on the tree's own size, z alive (0: dropped by thinning), w variety.
// k2 thins further on top of the distance rule (the shadow casters: CAST_KEEP), with the same growth.
const GROWTH_GLSL = /* glsl */`
  uniform vec4 hrange[NT]; uniform float nearRadius; uniform vec4 thin; uniform float crownKeep;
  float hsh(float n) { return fract(sin(n) * 43758.5453123); }
  vec4 farGrowth(float d, float s, float rank, vec4 hr, float k2) {
    float keep = (d < thin.x ? 1.0 : pow(thin.x / d, thin.y) * mix(1.0, crownKeep, smoothstep(thin.x, thin.x + ${CROWN_EASE.toFixed(1)}, d))) * k2;
    float shrubFar = hr.z * smoothstep(nearRadius + ${RING.toFixed(1)}, nearRadius + 1000.0, d);
    keep *= 1.0 - 0.5 * shrubFar;   // far shrubs: fewer, wider and a little taller (a patch of chaparral, not a bush)
    float alive = smoothstep(keep, keep * 0.88, rank);   // shrink out just before the rank is dropped
    if (alive <= 0.0) return vec4(0.0);
    float v = smoothstep(nearRadius + ${RING.toFixed(1)}, nearRadius + 1450.0, d);   // per-tree variety, none in the hand-over
    float seed = fract(rank * 7919.131) * 100.0, r1 = hsh(seed * 12.9898 + 1.0), r2 = hsh(seed * 78.233 + 2.0);
    float hMul = mix(1.0, mix(hr.x, hr.y, r1) / s, v) * pow(keep, -${GROW_H.toFixed(2)}) * (1.0 + 0.5 * shrubFar) * alive;
    float wMul = mix(1.0, 0.85 + 0.3 * r2, v) * pow(keep, -${GROW_W.toFixed(2)}) * (1.0 + 2.0 * shrubFar) * alive;
    return vec4(wMul, hMul, alive, v);
  }`;
// The mid tree's share of a tree's pixels in the hand-over band (vegetation.js lodPatch, the same expression).
const HAND_GLSL = /* glsl */`
  uniform vec3 handEye; uniform vec2 hand;
  float midShare(vec3 base) { return clamp((hand.x + hand.y - distance(base.xz, handEye.xz)) / (2.0 * hand.y), 0.0, 1.0); }`;

const VERT = /* glsl */`
  #define VIEWS ${VIEWS.toFixed(1)}
  attribute vec4 iPos; attribute vec4 iA;
  uniform vec4 frame[NT]; uniform vec4 vext[NT * ${VIEWS}]; uniform vec3 tint[NS];
  uniform vec4 needle[NS]; uniform vec3 needleTint[NS];   // pines: wrap, translucency, scatter, mean thinness | glow tint
  uniform vec3 eye; uniform vec2 grid;
  ${GROWTH_GLSL}
  ${HAND_GLSL}
  varying float vMidShare;
  varying vec4 vUv; varying vec2 vMirror; varying float vBlend; varying vec3 vR; varying vec3 vU; varying vec3 vF;
  varying float vFade; varying vec3 vTint; varying vec3 vSun; varying vec3 vHazeT; varying vec3 vHazeS; varying float vSky;
  #ifdef NEEDLE
  varying vec4 vNeedle;
  #endif
  ${ATMOSPHERE_GLSL}
  vec2 cellUv(float tree, float view, vec2 uv) {
    float idx = tree * VIEWS + view;
    return (vec2(mod(idx, grid.x), floor(idx / grid.x)) + clamp(uv, 0.002, 0.998)) / grid;
  }
  void main() {
    // position.xy: quad corner (x -0.5..0.5, y 0..1); position.z: 0, 1 the side quads, 2 the cap
    vec3 base = iPos.xyz; float rot = iPos.w, s = iA.x, rank = iA.z, seed = fract(rank * 7919.131) * 100.0;
    int ti = int(iA.y + 0.5); vec4 fr = frame[ti]; vec4 hr = hrange[ti];
    float d = distance(base.xz, eye.xz);
    vMidShare = midShare(base);   // the mid tree's share of the pixels (FRAG keeps the rest)
    if (vMidShare >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 g = farGrowth(d, s, rank, hr, 1.0);
    if (g.z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float fade = 1.0, v = g.w, hMul = g.y, wMul = g.x;
    float r3 = hsh(seed * 37.719 + 3.0), r4 = hsh(seed * 93.989 + 4.0), r5 = hsh(seed * 51.137 + 5.0), r6 = hsh(seed * 23.417 + 6.0), r7 = hsh(seed * 67.351 + 7.0);
    float W = fr.x * s * wMul * iA.w, H = fr.y * s * hMul, y0 = fr.z * s * hMul;
    float lean = v * (r3 - 0.5) * 0.16, ld = r4 * 6.2831853;
    vec2 leanV = vec2(cos(ld), sin(ld)) * lean;   // horizontal shift per metre of height
    vec2 toCam = normalize(eye.xz - base.xz + vec2(1e-4, 0.0));
    float cr = cos(rot), sr = sin(rot);
    vec3 lx = vec3(cr, 0.0, -sr), lz = vec3(sr, 0.0, cr);   // the tree's local +x and +z in the world
    float quad = position.z;
    vec3 p; float view0 = 0.0, view1 = 0.0, blend = 0.0, m0 = 1.0, m1 = 1.0;
    vU = vec3(0.0, 1.0, 0.0);
    if (quad < 1.5) {
      #ifdef BILLBOARD
      if (true) {
      #else
      if (d > mix(thin.z, thin.w, r5)) {
      #endif
        if (quad > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // billboard: one quad
        vR = vec3(toCam.y, 0.0, -toCam.x); vF = vec3(toCam.x, 0.0, toCam.y);
        float f = mod((atan(toCam.x, toCam.y) - rot) / 0.78539816, 8.0), k0 = floor(f), k1 = mod(k0 + 1.0, 8.0);
        blend = f - k0;
        view0 = mod(k0, 4.0); m0 = k0 >= 4.0 ? -1.0 : 1.0;   // views 4..7 are 0..3 seen from behind: mirrored
        view1 = mod(k1, 4.0); m1 = k1 >= 4.0 ? -1.0 : 1.0;
      } else {
        vR = quad < 0.5 ? lx : -lz; vF = quad < 0.5 ? lz : lx; view0 = view1 = quad < 0.5 ? 0.0 : 2.0;
      }
    } else {
      vR = lx; vU = -lz; vF = vec3(0.0, 1.0, 0.0); view0 = view1 = ${SIDE_VIEWS.toFixed(1)};
    }
    // Trim the quad to the covered part of its view(s) (a mirrored view's u range is flipped).
    vec4 e0 = vext[ti * ${VIEWS} + int(view0)], e1 = vext[ti * ${VIEWS} + int(view1)];
    vec2 x0 = m0 > 0.0 ? e0.xy : 1.0 - e0.yx, x1 = m1 > 0.0 ? e1.xy : 1.0 - e1.yx;
    vec2 uv = vec2(position.x < 0.0 ? min(x0.x, x1.x) : max(x0.y, x1.y), position.y < 0.5 ? min(e0.z, e1.z) : max(e0.w, e1.w));
    if (quad < 1.5) {
      float hy = y0 + uv.y * H;
      p = base + vR * ((uv.x - 0.5) * W) + vec3(0.0, hy, 0.0);
      p.xz += leanV * max(hy, 0.0);
    } else {
      float cy = fr.w * s * hMul;
      p = base + lx * ((uv.x - 0.5) * W) - lz * ((uv.y - 0.5) * W) + vec3(0.0, cy, 0.0);
      p.xz += leanV * cy;
      fade *= smoothstep(0.1, 0.3, abs(normalize(eye - p).y));   // edge-on from the side: hidden
      if (fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    }
    vUv = vec4(cellUv(iA.y, view0, vec2(m0 > 0.0 ? uv.x : 1.0 - uv.x, uv.y)), cellUv(iA.y, view1, vec2(m1 > 0.0 ? uv.x : 1.0 - uv.x, uv.y)));
    vMirror = vec2(m0, m1); vBlend = blend; vFade = fade;
    // Per tree, not per pixel (a far tree spans a few pixels): cloud shadow on the sun, a stand shadow
    // (a far tree stands for its crown and the shade it casts; none at the hand-over) and the haze,
    // as transmittance T and in-scatter S, the two halves of atmosphereApply(c) = c * T + S.
    vec3 r = base + vec3(0.0, y0 + 0.5 * H, 0.0) - eye;
    vSun = sunLight * cloudShadow(eye + r) * (1.0 - 0.4 * v);
    vSky = 1.0 - 0.15 * v;   // and some of the sky light, to the crowns around it
    vHazeT = atmoTransmittance(r, eye.y); vHazeS = atmoInscatter(r / max(length(r), 1e-3)) * (1.0 - vHazeT);
    int si = int(hr.w + 0.5);
    vTint = tint[si] * (0.93 + 0.14 * r6) * vec3(1.0 + 0.06 * (r7 - 0.5), 1.0, 1.0 - 0.06 * (r7 - 0.5));
    #ifdef NEEDLE   // only in materials that can draw trees nearer than the fade's end (Impostors.update)
    // Needle light (pines), faded with the view distance exactly as on the real pines (treegen
    // canopyMaterial), per tree: rgb the light through the needles and the backlit crown's glow, by the
    // view-sun angle of the crown (back: 1 with the sun straight behind it); a the wrap.
    vec4 nd = needle[si] * (1.0 - smoothstep(${NEEDLE_FADE[0].toFixed(1)}, ${NEEDLE_FADE[1].toFixed(1)}, length(r)));
    float back = clamp(dot(normalize(r), sunDir), 0.0, 1.0), b2 = back * back;
    vec3 glow = needleTint[si];
    vNeedle = vec4(vSun * (nd.y * nd.w * (0.25 * back + 0.75 * b2 * b2) * glow + nd.z * b2 * (0.35 + 0.65 * nd.w) * mix(vec3(1.0), glow, 0.6)), nd.x);
    #endif
    vec4 wp = modelMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const FRAG = /* glsl */`
  uniform sampler2D albedoMap; uniform sampler2D normalMap;
  varying float vMidShare;
  varying vec4 vUv; varying vec2 vMirror; varying float vBlend; varying vec3 vR; varying vec3 vU; varying vec3 vF;
  varying float vFade; varying vec3 vTint; varying vec3 vSun; varying vec3 vHazeT; varying vec3 vHazeS; varying float vSky;
  #ifdef NEEDLE
  varying vec4 vNeedle;
  #endif
  uniform vec3 sunDir; uniform vec3 ambientSky; uniform vec3 ambientGround;
  void main() {
    // Gradients first: the normal fetches below run after the discards.
    vec2 dx0 = dFdx(vUv.xy), dy0 = dFdy(vUv.xy), dx1 = dFdx(vUv.zw), dy1 = dFdy(vUv.zw);
    vec4 c = mix(texture2D(albedoMap, vUv.xy), texture2D(albedoMap, vUv.zw), vBlend);
    // Alpha to coverage, sharpened to about one pixel of soft edge at any mip level.
    float a = (c.a - ${ALPHA_REF.toFixed(2)}) / max(fwidth(c.a), 1e-4) + 0.5;
    if (a <= 0.0) discard;
    float lodN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (lodN < vMidShare || (vFade < 1.0 && lodN >= vFade)) discard;   // the mid tree's pixels; the cap's edge-on fade
    vec3 n0 = textureGrad(normalMap, vUv.xy, dx0, dy0).xyz * 2.0 - 1.0, n1 = textureGrad(normalMap, vUv.zw, dx1, dy1).xyz * 2.0 - 1.0;
    n0.x *= vMirror.x; n1.x *= vMirror.y;
    vec3 n = mix(n0, n1, vBlend);
    vec3 N = vR * n.x + vU * n.y + vF * n.z * (gl_FrontFacing ? 1.0 : -1.0);   // the mean normal: shorter where it spreads
    // Same light as the Lambert trees: sun under cloud shadow plus the hemisphere sky light, over pi.
    // Sun: the mean over the texel's normals of max(n.L, 0), approximated as a smooth max of the mean
    // normal's term m and its spread (exact at length 1; 1/4 for normals spread over the sphere), with
    // the pines' wrap (n.L + w) / (1 + w). The sky term is linear in the normal, so the mean is exact.
    #ifdef NEEDLE
    float w = vNeedle.a;
    #else
    float w = 0.0;
    #endif
    float l2 = dot(N, N), m = (dot(N, sunDir) + w) / (1.0 + w);
    float sun = 0.5 * (m + sqrt(m * m + 0.25 * max(0.0, 1.0 - l2)));
    // Light through the needles (pines within the fade): on the real crown the crown's own shadow
    // (shadows.js) takes it away except at the rim and in the gaps, so here it is weighted by how far the
    // texel is from the solid inside of the crown (its coverage below 1).
    vec3 irr = vSun * sun + mix(ambientGround, ambientSky, 0.5 + 0.5 * N.y) * vSky;
    #ifdef NEEDLE
    irr += vNeedle.rgb * (1.0 - smoothstep(${ALPHA_REF.toFixed(2)}, 1.0, c.a));
    #endif
    vec3 col = c.rgb * vTint * irr * 0.3183099;
    gl_FragColor = vec4(col * vHazeT + vHazeS, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Shadow caster (shadows.js, largest cascade): impostors beyond the hand-over radius as sun-facing
// ellipses, the outline of the mid set's crown ellipsoid for the same tree (crown[t]: centre height,
// vertical and horizontal semi-axes, unscaled metres), grown and thinned as the impostor is and then
// thinned once more to CAST_KEEP of them, each grown by 1/CAST_KEEP in area (the cover a 4.9 m texel
// map can show is kept; the dapple is coarser). They are their own instance buffer (casterMesh, one
// quad per tree, chunks within CAST_R of the camera), rebuilt with the sectors: a draw costs about its
// instance count (the sectors' 200 000 trees as casters: 1.2 ms per map render at the start view; these
// 76 000: about 0.5 ms, only on the frames that re-render the map).
// Inside hand.x the mid set's own ellipsoids cast (shadows.js DEPTH_VERT), so each tree casts once.
const CASTER_VERT = /* glsl */`
  attribute vec4 iPos; attribute vec4 iA;
  uniform vec4 crown[NT]; uniform vec3 eye; uniform vec3 sunDir;
  ${GROWTH_GLSL}
  ${HAND_GLSL}
  varying vec2 vQ;
  void main() {
    vec3 base = iPos.xyz; float s = iA.x, rank = iA.z; int ti = int(iA.y + 0.5);
    vec4 g = distance(base.xz, handEye.xz) <= hand.x ? vec4(0.0) : farGrowth(distance(base.xz, eye.xz), s, rank, hrange[ti], ${CAST_KEEP.toFixed(2)});
    if (g.z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 cb = crown[ti];
    float R = cb.z * s * g.x * iA.w, Hh = cb.y * s * g.y;
    vec3 C = base + vec3(0.0, cb.x * s * g.y, 0.0);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), sunDir) + vec3(1e-4, 0.0, 0.0)), up = cross(sunDir, right);
    float ce = up.y, ev = sqrt(Hh * Hh * ce * ce + R * R * max(1.0 - ce * ce, 0.0));   // the ellipsoid's outline along up
    vQ = vec2(position.x * 2.0, position.y * 2.0 - 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(C + right * (vQ.x * R) + up * (vQ.y * ev), 1.0);
  }`;
const CASTER_FRAG = /* glsl */`
  varying vec2 vQ;
  void main() { if (dot(vQ, vQ) > 1.0) discard; gl_FragColor = vec4(1.0); }`;

export class Impostors {
  constructor(tile, scene) {
    const t0 = performance.now();
    this.tile = tile; this.group = new THREE.Group(); scene.add(this.group);
    // Records first (each holds its species and slot), then the atlas: the species the tile places, with
    // slots by how common each is (planSlots), every slot's tree from its exact seed where it is baked.
    // A tile with lidar crowns (crowns.js) places its trees from the crown plan, which loads after this: until
    // then the records hold the shrubs, and the atlas is planned from the cell plan's tree draws (counted, not
    // placed) as the estimate of each species' share; when the plan arrives the records are rebuilt on it.
    this.crownMode = hasCrowns(tile);
    this.buildRecords(null);
    const t1 = performance.now();
    const plan = this.plan = planSlots(this.counts);
    const ids = this.ids = plan.ids.length ? plan.ids : [SPECIES_IDS[0]];
    const bakeList = [], rare = rareSpecies(tile);
    // A rare species' trees share meshes in vegetation.js (drawnSeed); the atlas bakes those same trees when it
    // has room for them, else the usual reduction (impostorSeed).
    for (const id of ids) for (let v = 0; v < VARIANTS; v++) {
      const n = plan.slots[id] ?? VARIANTS;
      bakeList.push({ id, seed: rare.has(id) && n >= rare.get(id) ? drawnSeed(id, v, rare.get(id)) : impostorSeed(id, v, n) });
    }
    const bake = bakeImpostors(bakeList);
    this.bake = bake; this.bakeList = bakeList;
    this.mapRecords();
    if (this.crownMode) crownPlan(tile).then(cp => {
      const t = performance.now();
      if (!cp) this.crownMode = false;
      this.buildRecords(cp); this.mapRecords(); this.center = null;   // rebuilt on the next update
      this.uniforms.crownKeep.value = cp ? CROWN_KEEP : 1;
      console.info(`impostors: ${this.nRecords.toLocaleString()} plants indexed on the ${cp ? 'crown plan' : 'cell plan'} in ${Math.round(performance.now() - t)} ms`);
    });
    const t2 = performance.now();

    const NT = bake.frames.length, NS = ids.length;
    this.uniforms = {
      albedoMap: { value: bake.albedo }, normalMap: { value: bake.normal },
      frame: { value: bake.frames.map(f => new THREE.Vector4(f.W, f.H, f.y0, f.capY)) },
      vext: { value: bake.extents.map(e => new THREE.Vector4(...e)) },
      // Far height: the slot's own baked tree (a sapling or snag stays its size), varied per tree by the
      // species range's relative spread about it ([6, 12] m: +-1/3), not stretched to the mature range.
      hrange: { value: bake.frames.map(f => { const v = (f.hmax - f.hmin) / (f.hmax + f.hmin);
        return new THREE.Vector4(1 - v, 1 + v, f.shrub ? 1 : 0, ids.indexOf(f.species)); }) },
      tint: { value: ids.map(() => new THREE.Vector3(1, 1, 1)) },
      // Needle light per species, as treegen canopyMaterial sets it for a card texture with needle aux data
      // (foliage.needle_wrap, translucency, needle_scatter, translucency_rgb), with the texture's mean thinness.
      needle: { value: ids.map(id => { const F = SPECIES[id].foliage, f = bake.frames.find(q => q.species === resolveSpecies(id));
        return f && f.thin > 0 ? new THREE.Vector4(F.needle_wrap ?? 0.35, F.translucency ?? 2.5, F.needle_scatter ?? 0.15, f.thin) : new THREE.Vector4(); }) },
      needleTint: { value: ids.map(id => new THREE.Vector3(...(SPECIES[id].foliage.translucency_rgb || [1, 1.12, 0.55]))) },
      eye: { value: new THREE.Vector3() }, nearRadius: { value: 1500 }, thin: { value: new THREE.Vector4() }, crownKeep: { value: 1 },
      handEye: handover.eye, hand: handover.r,
      grid: { value: new THREE.Vector2(...bake.grid) },
      ...atmo,
    };
    // Alpha to coverage also writes the fragment's alpha into the canvas (premultiplied, with an alpha
    // channel), so partly covered pixels leave it below 1. On screen that is invisible (the page behind
    // is near black), but a capture through toDataURL or drawImage un-premultiplies those pixels into a
    // pale salt over the far forest: read captures from the drawing buffer's RGB. Keeping the canvas alpha
    // with a blend state cost about 0.45 ms at the start view, so it is not done here.
    const material = billboard => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      defines: billboard ? { NT, NS, BILLBOARD: 1 } : { NT, NS }, side: THREE.DoubleSide, alphaToCoverage: true });
    // `position` carries the quad corner and the quad id: the ring mesh has three quads (two side, one
    // cap), the far sectors one (the billboard).
    const quads = n => {
      const pos = [], idx = [];
      for (let q = 0; q < n; q++) { const b = q * 4; pos.push(-0.5, 1, q, 0.5, 1, q, -0.5, 0, q, 0.5, 0, q); idx.push(b, b + 2, b + 1, b + 2, b + 3, b + 1); }
      return [new THREE.Float32BufferAttribute(pos, 3), new THREE.Uint16BufferAttribute(idx, 1)];
    };
    this.shapes = { ring: quads(3), far: quads(1) };
    this.materials = { ring: material(false), far: material(true) };
    this.sectors = [];   // [ring, far sector 0..SECTORS-1]
    for (let k = 0; k <= SECTORS; k++) {
      const kind = k ? 'far' : 'ring', mesh = new THREE.Mesh(this.sectorGeometry(1024, kind), this.materials[kind]);
      mesh.raycast = () => {};   // not pickable (identify.js picks real trees)
      mesh.cap = 1024; mesh.kind = kind; this.group.add(mesh); this.sectors.push(mesh);
    }
    // Far shadow casters (shadows.js draws them with casterMaterial()): not in the scene.
    this.casterMesh = new THREE.Mesh(this.sectorGeometry(1024, 'far')); this.casterMesh.cap = 1024; this.casterMesh.kind = 'far';
    this.R = null; this.center = null; this.count = 0;
    this.setSeason(seasonOfDate());
    this.stats = { bakeMs: Math.round(t2 - t1), bakeRenderMs: Math.round(bake.renderMs), recordsMs: Math.round(t1 - t0), atlas: bake.size,
      atlasMB: +(bake.bytes / 1048576).toFixed(1), trees: this.nRecords, baked: NT, species: ids.length, slots: plan.slots };
    console.info(`impostors: atlas ${bake.size.join('x')} x2 (${this.stats.atlasMB} MB with mips), ${NT} trees for ${ids.length} species (${Object.entries(plan.slots).map(([k, n]) => `${k} ${n}`).join(', ')}) x ${VIEWS} views, baked in ${this.stats.bakeMs} ms; ${this.nRecords.toLocaleString()} plants indexed in ${this.stats.recordsMs} ms`);
  }

  // Depth material for the far shadow casters (see CASTER_VERT). crowns: one THREE.Vector4 per baked tree.
  casterMaterial(crowns) {
    const u = this.uniforms;
    return new THREE.ShaderMaterial({ vertexShader: CASTER_VERT, fragmentShader: CASTER_FRAG, colorWrite: false, side: THREE.DoubleSide,
      defines: { NT: this.bake.frames.length },
      uniforms: { crown: { value: crowns }, eye: u.eye, sunDir: u.sunDir, hrange: u.hrange, nearRadius: u.nearRadius, thin: u.thin, crownKeep: u.crownKeep, handEye: u.handEye, hand: u.hand } });
  }

  sectorGeometry(cap, kind) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', this.shapes[kind][0]); g.setIndex(this.shapes[kind][1]);
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * STRIDE), STRIDE, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    g.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    g.instanceCount = 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    return g;
  }

  // Library species x slot -> baked tree for every record (bakeList is ids x VARIANTS). A crown record carries
  // its target height (negative) in the scale field until here, where it becomes the scale of its baked tree.
  mapRecords() {
    const bake = this.bake, ids = this.ids, pos = SPECIES_IDS.map(id => ids.indexOf(id)), rec = this.records, H = new Map();
    let missing = 0;
    for (let q = 0; q < this.nRecords; q++) {
      const o = q * STRIDE + 5, key = rec[o], v = key % VARIANTS;
      let p = pos[(key - v) / VARIANTS]; if (p < 0) { p = 0; missing++; }
      const k = p * VARIANTS + v; rec[o] = bake.index[k];
      if (rec[o - 1] < 0) {
        let h = H.get(k); if (h === undefined) { const b = this.bakeList[k]; h = treeWood(b.id, b.seed)?.H || 10; H.set(k, h); }
        rec[o - 1] = Math.min(SCALE[1], Math.max(SCALE[0], -rec[o - 1] / h));
      }
    }
    if (missing) console.warn(`impostors: ${missing} plants of species the atlas did not bake drawn as ${ids[0]}`);
  }

  // Every plant vegetation.js would place on the tile, grouped by chunk and sorted by a thinning rank.
  // The per-cell plan (counts, LANDFIRE species mix, savanna oak) and the skips (roads, ponds, stream
  // channels, riparian thinning) are vegetation.js's own cellPlan and placementSkip, and the six draws
  // per plant are taken in Vegetation.update's order, so each record is the tree that replaces it.
  // With crowns (crownPlan: the plan, or null while it loads) the trees are the crowns', one record per crown.
  buildRecords(crownPlan) {
    const tile = this.tile, hab = tile.habitat, res = hab.res, size = tile.size, heights = tile.heights, crowns = this.crownMode;
    // rec[5] holds the species' library index x VARIANTS + slot until the constructor has baked the atlas
    // and replaces it with the baked tree; counts (per species, as tree and as shrub) size the atlas.
    const spCount = this.counts = {}, libIdx = Object.fromEntries(SPECIES_IDS.map((id, k) => [id, k]));
    let rec = new Float32Array(400000 * STRIDE), chunkOf = new Int32Array(400000), n = 0;
    const NC = Math.ceil(size / CHUNK); this.NC = NC;
    for (let j = 0; j < hab.img.height; j++) for (let i = 0; i < hab.img.width; i++) {
      const plan = cellPlan(tile, i, j); if (!plan) continue;
      const { rnd, nTrees, nShrubs, treeMix, shrubMix } = plan;
      for (let k = 0; k < nTrees + nShrubs; k++) {
        const isTree = k < nTrees;
        const name = pick(isTree ? treeMix : shrubMix, rnd());
        const variant = Math.floor(rnd() * VARIANTS);
        const px = (i + rnd()) * res, pn = size - (j + rnd()) * res;
        const s = 0.75 + rnd() * 0.5, rot = rnd() * Math.PI * 2;
        if (isTree && crowns) {   // trees are the crowns'; while the plan loads, count the cell draws as the atlas estimate
          if (!crownPlan) { const sid = resolveSpecies(name), c = spCount[sid] || (spCount[sid] = { tree: 0, shrub: 0 }); c.tree++; }
          continue;
        }
        // Same placement as the near forest (vegetation.js placePlant): skips, and willow and alder pulled
        // to the bank, so a tree stands in one place on both sides of the hand-over. No draws from rnd.
        const at = placePlant(tile, i, j, k, name, px, pn, isTree); if (!at) continue;
        const ax = at.x, an = at.n;
        if (n >= chunkOf.length) { const r2 = new Float32Array(rec.length * 2); r2.set(rec); rec = r2; const c2 = new Int32Array(chunkOf.length * 2); c2.set(chunkOf); chunkOf = c2; }
        const own = mulberry32(hash(i, j, k + 7001) ^ 0x5bd1e995);   // the impostor's own draws, outside the shared stream
        const o = n * STRIDE;
        rec[o] = ax; rec[o + 1] = heights.at(ax, an) - 0.3; rec[o + 2] = -an; rec[o + 3] = rot;
        const sid = resolveSpecies(name), c = spCount[sid] || (spCount[sid] = { tree: 0, shrub: 0 }); if (isTree) c.tree++; else c.shrub++;
        rec[o + 4] = s; rec[o + 5] = libIdx[sid] * VARIANTS + variant;   // species and slot; the constructor swaps in the baked tree
        rec[o + 6] = own(); rec[o + 7] = 1;
        chunkOf[n] = Math.min(NC - 1, Math.floor(ax / CHUNK)) + NC * Math.min(NC - 1, Math.floor(an / CHUNK));
        n++;
      }
    }
    if (crowns && !crownPlan) {   // every tree species a mix row names gets at least one into the estimate, so the atlas holds it
      for (const id of tileSpecies(tile)) if (!SPECIES[id].shrub) { const c = spCount[id] || (spCount[id] = { tree: 0, shrub: 0 }); c.tree = Math.max(c.tree, 1); }
    }
    if (crownPlan) {
      const P = crownPlan;
      if (n + P.count > chunkOf.length) { const L = n + P.count; const r2 = new Float32Array(L * STRIDE); r2.set(rec); rec = r2; const c2 = new Int32Array(L); c2.set(chunkOf); chunkOf = c2; }
      for (let q = 0; q < P.count; q++) {
        const ax = P.x[q], an = P.n[q], sid = P.speciesIds[P.sp[q]], o = n * STRIDE;
        rec[o] = ax; rec[o + 1] = heights.at(ax, an) - 0.3; rec[o + 2] = -an; rec[o + 3] = P.rot[q];
        rec[o + 4] = -P.h[q]; rec[o + 5] = libIdx[sid] * VARIANTS + P.slot[q];   // target height (mapRecords makes it the scale) and slot
        rec[o + 6] = mulberry32(hash(q, 0x6c1d, 7001) ^ 0x5bd1e995)(); rec[o + 7] = P.aspect[q];
        const c = spCount[sid] || (spCount[sid] = { tree: 0, shrub: 0 }); c.tree++;
        chunkOf[n] = Math.min(NC - 1, Math.floor(ax / CHUNK)) + NC * Math.min(NC - 1, Math.floor(an / CHUNK));
        n++;
      }
    }
    // Pack by chunk, rank ascending within each chunk, so a rebuild copies a prefix per chunk.
    const counts = new Int32Array(NC * NC + 1);
    for (let q = 0; q < n; q++) counts[chunkOf[q] + 1]++;
    for (let c = 0; c < NC * NC; c++) counts[c + 1] += counts[c];
    const order = new Int32Array(n), fill = counts.slice();
    for (let q = 0; q < n; q++) order[fill[chunkOf[q]]++] = q;
    const packed = new Float32Array(n * STRIDE);
    this.chunks = [];
    for (let c = 0; c < NC * NC; c++) {
      const a = counts[c], b = counts[c + 1];
      const ids = Array.from(order.subarray(a, b)).sort((p, q) => rec[p * STRIDE + 6] - rec[q * STRIDE + 6]);
      let y0 = Infinity, y1 = -Infinity;
      ids.forEach((q, m) => { packed.set(rec.subarray(q * STRIDE, q * STRIDE + STRIDE), (a + m) * STRIDE); y0 = Math.min(y0, rec[q * STRIDE + 1]); y1 = Math.max(y1, rec[q * STRIDE + 1]); });
      if (b > a) this.chunks.push({ start: a, n: b - a, x: ((c % NC) + 0.5) * CHUNK, z: -(Math.floor(c / NC) + 0.5) * CHUNK, y0, y1 });
    }
    this.records = packed; this.nRecords = n;
  }

  keep(d) {
    const t = this.R + RING; if (d < t) return 1;
    const e = Math.min(1, (d - t) / CROWN_EASE), k = this.uniforms.crownKeep.value;
    return Math.pow(t / d, THIN_P) * (1 + (k - 1) * e * e * (3 - 2 * e));
  }

  // Copy the kept prefix of every chunk that can be visible before the next rebuild into the ring mesh
  // (if any of it can come within the crossed band) or its far sector.
  rebuild(cx, cz) {
    const t0 = performance.now();
    this.center = [cx, cz];
    const R = this.R, hd = CHUNK * Math.SQRT1_2, rec = this.records;
    const lists = Array.from({ length: SECTORS + 2 }, () => ({ parts: [], n: 0, box: new THREE.Box3() }));   // ring, sectors, casters
    const cast = lists[SECTORS + 1], handOut = handover.r.value.x - MOVE - HAND_MARGIN - hd;
    const v = new THREE.Vector3();
    for (const c of this.chunks) {
      const dist = Math.hypot(c.x - cx, c.z - cz), dmin = Math.max(0, dist - hd), dmax = dist + hd;
      // entirely inside the hand-over band's inner edge until the next rebuild
      if (dmax + MOVE + HAND_MARGIN < handover.r.value.x - handover.r.value.y) continue;
      const kmax = this.keep(Math.max(0, dmin - MOVE));
      const prefix = k => { let lo = 0, hi = c.n;   // first record with rank >= k
        while (lo < hi) { const m = (lo + hi) >> 1; if (rec[(c.start + m) * STRIDE + 6] < k) lo = m + 1; else hi = m; }
        return lo; };
      const lo = prefix(kmax);
      if (!lo) continue;
      if (dmin - MOVE < CAST_R && dist > handOut) { const lc = prefix(kmax * CAST_KEEP); if (lc) { cast.parts.push(c.start, lc); cast.n += lc; } }
      const k = dmin - MOVE <= R + CROSS[1] ? 0 : 1 + ((Math.floor((Math.atan2(c.z - cz, c.x - cx) / (2 * Math.PI) + 1) * SECTORS) % SECTORS) + SECTORS) % SECTORS;
      const L = lists[k]; L.parts.push(c.start, lo); L.n += lo;
      L.box.expandByPoint(v.set(c.x - CHUNK / 2, c.y0, c.z - CHUNK / 2)).expandByPoint(v.set(c.x + CHUNK / 2, c.y1 + 90, c.z + CHUNK / 2));
    }
    let total = 0;
    lists.forEach((L, k) => {
      const mesh = k <= SECTORS ? this.sectors[k] : this.casterMesh;
      if (L.n > mesh.cap) { mesh.geometry.dispose(); mesh.cap = Math.ceil(L.n * 1.3); mesh.geometry = this.sectorGeometry(mesh.cap, mesh.kind); }
      const g = mesh.geometry, buf = g.attributes.iPos.data, arr = buf.array;
      let o = 0;
      for (let p = 0; p < L.parts.length; p += 2) { const a = L.parts[p] * STRIDE, len = L.parts[p + 1] * STRIDE; arr.set(rec.subarray(a, a + len), o); o += len; }
      g.instanceCount = L.n; mesh.visible = L.n > 0;
      if (L.n) { buf.clearUpdateRanges(); buf.addUpdateRange(0, L.n * STRIDE); buf.needsUpdate = true; L.box.expandByScalar(60).getBoundingSphere(g.boundingSphere); }
      if (k <= SECTORS) total += L.n;
    });
    this.castCount = cast.n;
    this.count = total; this.lastRebuildMs = performance.now() - t0;
  }

  // Season colour per species, relative to the baked summer colour (as applySeason does for the real trees).
  setSeason(season) {
    this.season = season;
    const month = monthFor(season);
    this.ids.forEach((id, k) => {
      const c = SPECIES[id].foliage.colors, s = c[season] || c.summer;
      // A crown is mostly leaves; a bare deciduous crown keeps its baked shape but goes to bark-grey.
      const on = leafOnAt(SPECIES[id], season, month);
      const t = s.map((x, i) => srgbToLin(x) / Math.max(1e-4, srgbToLin(c.summer[i])));
      const bark = SPECIES[id].trunk.bark_rgb.map((x, i) => srgbToLin(x) / Math.max(1e-4, srgbToLin(c.summer[i])) * 0.6);
      const wBark = (1 - on) * (1 - on);   // a thinned crown mostly shows its remaining leaves; a bare one, its twigs
      this.uniforms.tint.value[k].set(...t.map((x, i) => x * (1 - wBark) + bark[i] * wBark));
    });
  }

  update(camera, nearRadius) {
    const u = this.uniforms;
    u.eye.value.copy(camera.position);
    let force = false;
    if (nearRadius !== this.R) {
      this.R = nearRadius; force = true;
      u.nearRadius.value = nearRadius; u.thin.value.set(nearRadius + RING, THIN_P, nearRadius + CROSS[0], nearRadius + CROSS[1]);
      // The needle light costs about 0.1 ms in the ring and 0.3 ms over the far sectors' many small
      // quads at the start view, so a material compiles it only when it can hold trees where the real
      // pines still have at least half of it (NEEDLE_ON m): the ring's nearest trees are at the
      // hand-over band's inner edge, the sectors' about nearRadius + 450 m. With the default 1.5 km
      // forest neither does (the band starts at 1209 m; the real pines keep under half there).
      const hand = handover.r.value;
      for (const [m, nearest] of [[this.materials.ring, hand.x - hand.y], [this.materials.far, nearRadius + CROSS[1]]]) {
        const want = nearest < NEEDLE_ON;
        if (want !== ('NEEDLE' in m.defines)) { if (want) m.defines.NEEDLE = 1; else delete m.defines.NEEDLE; m.needsUpdate = true; }
      }
    }
    const x = camera.position.x, z = camera.position.z;
    if (force || !this.center || Math.hypot(x - this.center[0], z - this.center[1]) > MOVE) this.rebuild(x, z);
  }
}
