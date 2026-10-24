import * as THREE from 'three';
import { mulberry32 } from './trees.js';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { groundUniforms, GROUND_GLSL } from './terrain.js';
import { windUniforms, WIND_GLSL } from './wind.js';

// Clump fields: vegetation seen from the air as many cheap impostors, one camera-facing quad per
// clump, shaded per pixel as an ellipsoid whose normal is rebuilt from the quad position and broken
// into lobes by 3D noise on that normal (stable as the camera turns). Two fields use it:
//
//   ShrubField (chaparral): chamise and manzanita fill each chaparral cell to its canopy shrub
//     cover, so the habitat reads as a closed, mottled grey-green carpet instead of scattered
//     bushes on bare photo (the 3D shrubs in vegetation.js are a few dozen per cell). Chamise:
//     rounded, twiggy, grey-green; manzanita: taller, upswept, darker, red-brown stems under the crown.
//     Each species has silhouette variants (chamise: rounded, ragged vase, vase with grey dead
//     stems; manzanita: upswept, sprawling, open with its red branching showing), crowns sized by
//     the canopy shrub %, and stands broken by occasional openings.
//   GrassClumps (grassland, 12-225 m): purple needlegrass tussocks (dense, bright arching tips),
//     coloured from the ground texture under them with its patches exaggerated, so the sward has
//     relief and silhouettes from the air and hands over to the photo.
//   StalkClumps (grassland, summer and fall, 10-240 m): sparse stands of dry wild oat, pale airy
//     sprays of culms and panicles standing above the cured sward.
//
// Both use the same density LOD ("clump models that change with distance"): past D0 a field thins
// as (D0/d)^2 (each clump dithers out at its own rank, never shrinking) and the survivors grow by 1/sqrt(keep), so cover is kept while the clumps per screen
// area (and the cost) stay about constant; a grown impostor is drawn with more, smaller lobes, so
// far away it stands for a patch of several plants rather than one swollen plant. Each cell's
// clumps are stored in random order and the CPU submits only the prefix the LOD can keep.
// Placement is deterministic per 30 m habitat cell, cached, generated a few cells per frame.

const STRIDE = 8, REFILL_MOVE = 15;
export const KIND = { chamise: 0, manzanita: 1, annual: 2, bunch: 3, stalk: 4 };
// Seed layout: integer part random, fractional part the silhouette variant (variant + 0.5) / 4.
const lam = c => -Math.log(1 - Math.min(c, 0.9));   // disc density giving cover c with random placement

const VERT = /* glsl */`
  ${ATMOSPHERE_GLSL}
  ${GROUND_GLSL}
  ${WIND_GLSL}
  uniform vec2 kParams;   // D0, KMIN
  uniform vec4 band;      // fade in from x to y, out from z to w (distance to camera)
  uniform float heightScale; uniform float dry;   // dry: 0 green season .. 1 cured summer sward
  attribute vec4 iPos; attribute vec4 iVar;   // root x y z, crown radius | height, seed, kind, rank
  varying vec2 vQ; varying vec3 vRight; varying vec3 vUp; varying vec3 vView;
  varying vec3 vAlbedo; varying vec3 vSun; varying vec3 vAmb; varying vec3 vAmbUp; varying vec3 vT; varying vec3 vIn;
  varying float vSeed; varying float vKind; varying float vLobes; varying float vYS; varying float vVar; varying float vDry; varying float vFade;
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
    bool grass = kind > 1.5, stalk = kind > 3.5;
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
    float grow = inversesqrt(keep);
    if (grass) H *= heightScale;
    R *= grow; H *= sqrt(grow);
    vec3 C = iPos.xyz + vec3(0.0, H * 0.5, 0.0);
    // Wind: woody shrubs lean a few cm in gusts, grass clumps sway.
    float g = gust(iPos.xz);
    C.xz += windDir * windStrength * g * (stalk ? 0.45 : grass ? 0.35 : 0.06) * H;
    vec3 V = normalize(cameraPosition - C);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), V) + vec3(1e-4, 0.0, 0.0));
    vec3 up = cross(V, right);
    // Half extents of the ellipsoid (R across, H/2 tall) projected on the quad's axes.
    float ce = up.y, se = sqrt(max(1.0 - ce * ce, 0.0));
    float ev = sqrt(H * H * 0.25 * ce * ce + R * R * se * se);
    vec2 q = position.xy * 1.2;   // a margin for the lobes and twigs
    vec3 p = C + right * q.x * R + up * q.y * ev + V * (0.6 * R);   // pulled toward the camera so the ground does not clip it
    vQ = q; vRight = right; vView = V; vSeed = seed; vKind = kind; vVar = floor(fract(seed) * 4.0); vDry = dry;
    vUp = up; vYS = R / max(H * 0.5, 0.01);   // sphere normal -> ellipsoid normal: scale its y by R / (H/2)
    vLobes = mix(1.0, 2.6, clamp((grow - 1.0) / 1.5, 0.0, 1.0));   // a far, grown impostor is a patch of plants
    vec3 gw; vec3 gc = groundAlbedo(iPos.xyz, 1.5, gw);
    float gl = dot(gc, G_LUMA);
    vec3 a;
    // Sky light under the canopy, as the terrain takes it: woodland shade from the cover raster and
    // the contact AO blob under near trees. A shrub crown is itself the shrub layer, so it takes only
    // the tree cover's share.
    vec2 guv = groundUv(iPos.xyz);
    float occ = (grass ? groundSkyOcclusion(guv) : 1.0 - 0.35 * clamp(texture(canopyMap, guv).r * 2.55, 0.0, 1.0)) * groundContactAO(iPos.xyz);
    if (grass) {
      // Grass: the ground's own colour (it is a photo of this grass), with the photo's patches
      // pushed further (the texel against the ~80 m mean), so swales, cured and greener patches
      // read across a field from the air; tussocks a little darker at heart; brighter where a gust
      // lays the blades over.
      vec3 gr = groundRecolour(textureLod(map, guv, 6.5).rgb, gw);
      float patchK = clamp(pow(gl / max(dot(gr, G_LUMA), 1e-3), 0.7), 0.78, 1.3);
      vec3 hue = clamp(gc / max(gr, vec3(1e-3)) * dot(gr, G_LUMA) / max(gl, 1e-3), vec3(0.85), vec3(1.18));   // the patch's hue shift, unit luminance
      a = gc * patchK * mix(vec3(1.0), hue, 0.6) * (0.9 + 0.2 * hh(seed * 3.3)) * (1.0 + 0.08 * clamp((g - 0.7) / 0.55, -1.0, 1.0));
      if (stalk) {
        // Wild oat: cured straw, a little paler and yellower than the sward it stands in (which
        // carries soil and shade), relative to the ground so it never turns to snow on a pale slope.
        a *= vec3(1.17, 1.13, 1.0) * (0.92 + 0.16 * hh(seed * 5.7));
      } else a *= mix(vec3(0.9, 0.93, 0.95), vec3(0.77, 0.82, 0.82), dry);   // needlegrass stays grey-green while the annuals cure gold
    } else {
      // Shrubs: species colour, varied per shrub and by stand (a warm, olive palette: chamise dark
      // olive-green, whiteleaf manzanita paler, grey-green to glaucous), pulled toward the photo.
      bool manz = kind > 0.5;
      a = manz ? vec3(0.09, 0.11, 0.07) : vec3(0.108, 0.113, 0.06);
      float v1 = hh(seed * 7.1), v2 = hh(seed * 3.3), stand = wNoise(iPos.xz * 0.025 + (manz ? 7.0 : 0.0));
      a *= manz ? mix(vec3(0.94, 1.0, 1.1), vec3(1.06, 1.03, 0.9), v1) : mix(vec3(0.9, 1.0, 1.04), vec3(1.1, 1.03, 0.86), v1);
      a *= mix(vec3(1.05, 1.0, 0.9), vec3(0.94, 1.0, 1.06), stand) * (0.78 + 0.44 * v2);
      float al = dot(a, G_LUMA);
      a = mix(a, gc * al / max(gl, 1e-3), 0.2) * mix(1.0, clamp(gl / 0.075, 0.8, 1.25), 0.5);
    }
    vAlbedo = a;
    vSun = sunLight * cloudShadow(C); vAmb = ambientGround * occ; vAmbUp = ambientSky * occ;
    vIn = atmosphereApply(vec3(0.0), C, cameraPosition);
    vT = atmosphereApply(vec3(1.0), C, cameraPosition) - vIn;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */`
  uniform vec3 sunDir; uniform float heads;
  varying vec2 vQ; varying vec3 vRight; varying vec3 vUp; varying vec3 vView;
  varying vec3 vAlbedo; varying vec3 vSun; varying vec3 vAmb; varying vec3 vAmbUp; varying vec3 vT; varying vec3 vIn;
  varying float vSeed; varying float vKind; varying float vLobes; varying float vYS; varying float vVar; varying float vDry; varying float vFade;
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
  void main() {
    // Distance fades: screen-space dither (the interleaved gradient noise the tree tiers hand over
    // with), never a size change.
    if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vFade) discard;
    float kind = vKind, vv = vVar;
    bool manz = kind > 0.5 && kind < 1.5, grass = kind > 1.5, bunch = kind > 2.5 && kind < 3.5, stalk = kind > 3.5;
    vec2 q = vQ;
    if (!grass) {
      // A shrub is several stems' crowns, not a ball: a main crown and two smaller ones set off to
      // the sides. Each pixel takes the crown it is deepest inside and is shaded on that crown's own
      // dome, so the outline is a cluster and the shading has a hollow between the masses.
      float k1 = h2(vec2(vSeed, 1.7)) * 6.2832, k2 = h2(vec2(vSeed, 2.9)), k3 = h2(vec2(vSeed, 4.1));
      vec2 o1 = vec2(cos(k1), sin(k1)) * (0.3 + 0.18 * k2), o2 = vec2(cos(k1 + 2.2 + k3), sin(k1 + 2.2 + k3)) * (0.28 + 0.2 * k3);
      float s0 = 0.8, s1 = 0.5 + 0.14 * k2, s2 = 0.44 + 0.14 * k3;
      float e0 = s0 - length(q), e1 = s1 - length(q - o1), e2 = s2 - length(q - o2);
      if (e1 > e0 && e1 >= e2) q = (q - o1) / s1; else if (e2 > e0) q = (q - o2) / s2; else q /= s0;
      // Outside every crown's widest possible outline (lobes, spikes, dead stems): nothing to shade.
      // Most of the quad around a cluster ends here, before any noise is evaluated.
      if (dot(q, q) > 1.9) discard;
    }
    float r2 = dot(q, q);
    float z = sqrt(max(1.0 - min(r2, 1.0), 0.0));
    // World normal of the ellipsoid point under this pixel; lobes keyed on it stay put on the plant.
    vec3 nW = vRight * q.x + vUp * q.y + vView * z; nW = normalize(vec3(nW.x, nW.y * vYS, nW.z));
    float lobe = n3(nW * 1.6 * vLobes + vSeed * 37.0), twig = n3(nW * 6.0 * vLobes + vSeed * 11.0);
    float rr = sqrt(r2), aa = fwidth(rr) + 1e-3;
    float rb, alpha, lc;
    vec3 col, N;
    if (!grass) {
      // Shrub crown. Variants (vv): chamise 0 rounded, 1 ragged vase, 2 vase with grey dead stems;
      // manzanita 0 upswept, 1 sprawling (set by its proportions), 2 open, red branching showing.
      rb = 0.72 + 0.34 * lobe + 0.14 * (twig - 0.5);
      // Chamise's upright stems: noise stretched along the vertical, so the edge breaks into
      // spikes, not bumps (manzanita's smooth-barked crowns do without).
      float streak = manz ? 0.5 : n3(vec3(nW.x * 9.0, nW.y * 1.6, nW.z * 9.0) * vLobes + vSeed * 17.0);
      bool vase = !manz && vv > 0.5;
      if (manz) rb += 0.12 * smoothstep(0.0, 0.8, q.y) * (lobe - 0.4) - 0.08 * smoothstep(-0.2, -0.9, q.y);
      if (vase) rb += -0.24 * smoothstep(0.15, -0.75, nW.y) + 0.26 * (streak - 0.45) * smoothstep(-0.1, 0.6, nW.y);   // narrow base, ragged spiky top
      else if (!manz) rb += 0.1 * (streak - 0.5) * smoothstep(0.0, 0.7, nW.y);
      if (manz && vv > 1.5) rb += 0.1 * (lobe - 0.5);   // open crown: deeper bays between branch masses
      alpha = clamp((rb - rr) / aa + 0.5, 0.0, 1.0);
      // Twiggy fringe: the outer band broken into stems and gaps (more on chamise, most on a vase).
      float fringe = smoothstep(rb - (vase ? 0.32 : 0.25), rb, rr);
      if (fringe > 0.0) alpha *= 1.0 - fringe * smoothstep(manz ? 0.55 : vase ? 0.4 : 0.45, manz ? 0.7 : vase ? 0.55 : 0.6, n3(nW * 14.0 * vLobes + vSeed * 3.0));
      // Dead chamise: bare grey stems poking up out of the crown, past its leafy outline.
      float dead = 0.0;
      if (!manz && vv > 1.5) {
        float ridge = 1.0 - smoothstep(0.0, 0.15, abs(n3(vec3(nW.x * 5.0, nW.y * 1.2, nW.z * 5.0) + vSeed * 5.0) - 0.5));
        dead = ridge * smoothstep(-0.3, 0.4, nW.y) * step(rr, rb + 0.3);
        alpha = max(alpha, dead * smoothstep(rb + 0.3, rb, rr) * clamp(0.06 / aa, 0.0, 1.0));
      }
      if (alpha < 0.05) discard;
      // Leaf clusters: brighter sunlit clumps over dark holes into the crown.
      lc = n3(nW * 4.0 * vLobes + vSeed * 5.0) * 0.6 + twig * 0.4;
      // Close up, a crown is many small leaf sprays: a fine octave, only where it is resolved.
      // Two fine octaves, the finer one cutting small dark gaps between sprays, so a near crown
      // is a mass of foliage and not a soft pebble.
      float close = 1.0 - smoothstep(0.01, 0.03, aa), gap = 1.0;
      if (close > 0.0) {
        float f1 = n3(nW * 22.0 + vSeed * 7.0), f2 = n3(nW * 55.0 + vSeed * 2.0);
        lc = mix(lc, lc * 0.5 + 0.32 * f1 + 0.3 * f2, close);
        gap = mix(1.0, 0.45 + 0.55 * smoothstep(0.18, 0.42, f2), close);
      }
      N = normalize(nW + (vec3(lobe, 0.5, twig) - 0.5) * 0.9);
      col = vAlbedo * (0.6 + 0.8 * lc) * gap;
      if (manz) {
        // Whiteleaf manzanita's smooth red-mahogany branches: under the crown where the view looks
        // in, and through the holes in the foliage (wide open on the open variant, few on the sprawl).
        float stem = step(0.8, h2(floor(vec2(q.x * 7.0 + vSeed * 3.0, 1.0)))) * smoothstep(0.0, -0.6, q.y) * smoothstep(0.3, -0.2, nW.y);
        float holeT = vv > 1.5 ? 0.42 : vv > 0.5 ? 0.26 : 0.34;
        float hole = smoothstep(holeT, holeT - 0.14, lc) * (1.0 - fringe * 0.7);
        // Branches: long, crooked lines (ridges of a low, vertically stretched noise), not specks.
        float branch = 1.0 - smoothstep(0.0, 0.1, abs(n3(vec3(nW.x * 2.2, nW.y * 4.5, nW.z * 2.2) + vSeed * 9.0) - 0.5));
        vec3 bark = vec3(0.2, 0.055, 0.03);
        // The red trunks show under the umbrella of foliage (lower half of the crown) and in the
        // deepest holes; the sprawling form keeps its branches hidden.
        float under = smoothstep(0.15, -0.5, nW.y) * (vv > 0.5 && vv < 1.5 ? 0.3 : 1.0);
        float showB = clamp(hole * smoothstep(0.1, -0.3, nW.y - 0.3) + under * smoothstep(0.6, 0.35, lc), 0.0, 1.0);
        col = mix(col, vAlbedo * 0.35, hole * 0.8);   // the shaded inside of the crown
        col = mix(col, bark, max(stem * 0.6, branch * showB * 0.85) * (1.0 - lc * 0.5));
      } else {
        if (dead > 0.0) col = mix(col, vec3(0.27, 0.255, 0.23), dead * (1.0 - smoothstep(0.55, 0.85, lc)));
        // Chamise in summer and fall: rusty flower clusters dried on the branch tips, on some plants.
        float rust = vDry * step(0.45, fract(vSeed * 0.731)) * smoothstep(0.55, 0.8, lc) * smoothstep(0.0, 0.6, nW.y);
        col = mix(col, vAlbedo * vec3(1.9, 1.15, 0.7), rust * 0.6);
      }
    } else if (stalk) {
      // Wild oat stand: an airy spray of dry culms with nodding panicles. Fine pale specks of seed
      // heads over darker culms, thinning out from the middle with no outline at all (a disc of
      // any kind reads as a cotton ball from the air), and the sward showing through everywhere.
      float body = n3(nW * 2.6 * vLobes + vSeed * 9.0);
      rb = 0.75 + 0.3 * lobe + 0.2 * (body - 0.5);
      float dens = 1.0 - smoothstep(0.05, rb, rr);
      // Far off, a stand fills in (it stands for many plants) and its features coarsen with the
      // pixel footprint, so it reads as a paler patch and does not sparkle.
      float farK = smoothstep(0.03, 0.12, aa), f = mix(15.0, 5.0, farK);
      float headN = n3(nW * f + vSeed * 3.0);
      float culmN = n3(vec3(nW.x * 16.0, nW.y * 2.2, nW.z * 16.0) + vSeed * 7.0);
      float t = 0.74 - 0.22 * dens - 0.1 * farK;
      float a1 = smoothstep(t, t + 0.06, headN + 0.08 * nW.y) * step(0.02, dens);
      float a2 = smoothstep(0.66, 0.74, culmN) * 0.7 * dens * (1.0 - smoothstep(0.2, 0.9, nW.y)) * (1.0 - farK);
      alpha = max(a1, a2) * 0.85 * smoothstep(0.05, 0.4, vDry);
      if (alpha < 0.05) discard;
      lc = headN;
      N = normalize(nW * 0.6 + vec3(0.0, 1.0, 0.0));
      col = vAlbedo * (a1 >= a2 ? 0.88 + 0.22 * headN : 0.62);   // culms deeper in the stand, in their own shade
    } else {
      // Grass clump: a soft-edged dome of blades. Seen from above, a tussock is a fountain: dark
      // at the crown, bright where the arching tips catch the light at the rim; an annual patch is
      // airy (ground shows through) and speckled with pale seed heads.
      float ang = atan(q.y, q.x);
      float star = abs(sin(ang * (bunch ? 5.5 : 3.5) + vSeed));
      rb = (bunch ? 0.74 : 0.7) + 0.2 * lobe + 0.08 * star;
      alpha = smoothstep(rb, rb - max(0.18, aa), rr);   // soft: a tussock has no hard outline
      float fine = n3(nW * 9.0 * vLobes + vSeed * 3.0);
      alpha *= bunch ? 1.0 - smoothstep(0.55, 0.75, rr / rb) * step(fine, 0.42)
                     : smoothstep(0.3, 0.45, fine + 0.25 * (1.0 - rr / rb));
      if (alpha < 0.05) discard;
      lc = fine;
      N = normalize(nW * 0.5 + vec3(0.0, 1.0, 0.0));   // lit nearly like the ground it grows from, so it adds texture, not dark dots
      // (the bright rim fades on a far, grown impostor: a patch of tussocks has no single fountain rim)
      col = vAlbedo * (bunch ? mix(0.84, mix(1.1, 0.92, smoothstep(1.3, 2.4, vLobes)), smoothstep(0.2, 0.9, rr / rb)) * (0.9 + 0.2 * fine) : 0.85 + 0.3 * lobe);
      if (!bunch) col = mix(col, vAlbedo * 1.45, heads * smoothstep(0.72, 0.85, twig) * 0.8);   // seed heads
    }
    float diff = max(dot(N, sunDir), 0.0);
    float ao = mix(grass ? 0.75 : 0.6, 1.0, smoothstep(-0.7, 0.6, nW.y)) * mix(grass ? 0.85 : 0.75, 1.0, lc);
    vec3 light = vSun * diff * mix(0.75, 1.0, lc) + mix(vAmb, vAmbUp, 0.5 + 0.5 * N.y) * ao;
    gl_FragColor = vec4((col * light * 0.3183099) * vT + vIn, alpha);
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
//   plant(x, n, rnd, cover) -> [kind, R, H, variant 0..3]
//   D0, KMIN         LOD: full density to D0, then keep (D0/d)^2, never below KMIN
//   band             [in0, in1, out0, out1] distance fades (per-plant cut-offs spread over each pair,
//                    dithered, no size change); range is out1
//   now              cells nearer than this are generated at once, the rest a couple of ms per frame
//   cap, salt, roadsMax
//   riparian         0..1: share of clumps thinned out at a stream centreline, less across the
//                    riparian band (none in water whatever this is)
export class ClumpField {
  constructor(tile, ground, uniforms, cfg) {
    this.tile = tile; this.ground = ground; this.cfg = cfg;
    this.cache = new Map(); this.cells = []; this.last = null; this.sig = NaN; this.n = 0;
    this.W = tile.habitat.img.width; this.H = tile.habitat.img.height;
    this.lamMax = lam(cfg.coverMax);
    this.uniforms = { ...groundUniforms, ...windUniforms, ...atmo, heightScale: uniforms.heightScale, heads: uniforms.heads, dry: uniforms.dry || { value: 1 },
      kParams: { value: new THREE.Vector2(cfg.D0, cfg.KMIN) }, band: { value: new THREE.Vector4(...cfg.band) } };
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cfg.cap * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    g.setAttribute('iVar', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, alphaToCoverage: true });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.name = cfg.name;
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._sph = new THREE.Sphere();
  }
  get count() { return this.n; }

  // Clumps of one cell in random order (any prefix is an even subsample), with a bounding sphere.
  cellData(i, j) {
    const key = j * this.W + i, cfg = this.cfg;
    let c = this.cache.get(key);
    if (c) return c;
    const { habitat: hab, size, roads, waterMask: wm } = this.tile, res = hab.res, out = [];
    if (cfg.cellAny(i, j)) {
      const n = Math.round(this.lamMax * res * res / cfg.meanArea), rnd = mulberry32((i * 73856093) ^ (j * 19349663) ^ cfg.salt);
      for (let k = 0; k < n; k++) {
        const px = (i + rnd()) * res, pn = size - (j + rnd()) * res, keep = rnd();
        const cov = cfg.coverAt(px, pn);
        if (cov <= 0 || keep * this.lamMax >= lam(cov)) { rnd(); rnd(); rnd(); rnd(); continue; }
        if (roads && roads.at(px, pn) > cfg.roadsMax) { rnd(); rnd(); rnd(); rnd(); continue; }
        // Nothing in ponds or stream channels; tussocks and oats thin out toward a creek.
        const wv = waterAt(wm, px, pn);
        if (wv === 255 || (wv && cfg.riparian && keep * this.lamMax >= lam(cov) * (1 - cfg.riparian * wv / 200))) { rnd(); rnd(); rnd(); rnd(); continue; }
        const [kind, R, Hh, variant = 0] = cfg.plant(px, pn, rnd, cov);
        out.push(px, this.ground(px, pn), -pn, R, Hh, Math.floor(rnd() * 100) + (variant + 0.5) / 4, kind, 0);
      }
      const m = out.length / STRIDE;
      for (let k = 0; k < m; k++) out[k * STRIDE + 7] = (k + 0.5) / m;   // rank: the order is already random
    }
    c = { data: new Float32Array(out), n: out.length / STRIDE, x: (i + 0.5) * res, y: 0, z: -(size - (j + 0.5) * res), r: res };
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
      if (!this.cfg.cellAny(i, j)) continue;
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
    if (sig !== this.sig) {
      this.sig = sig; let n = 0;
      for (let k = 0; k < pick.length; k += 2) { const c = pick[k], m = pick[k + 1]; arr.set(c.data.subarray(0, m * STRIDE), n * STRIDE); n += m; }
      this.n = n; this.mesh.geometry.instanceCount = n;
      this.buf.clearUpdateRanges(); this.buf.addUpdateRange(0, Math.max(n, 1) * STRIDE); this.buf.needsUpdate = true;
    }
    this.mesh.visible = this.n > 0;
  }
}

// Chaparral shrubs. Cover per cell: chaparral cells only, the canopy's shrub % (floored: a low value
// in a chaparral cell is more often a burn scar or a data gap than open ground), bilinear between
// cell centres so a stand thins out over a cell instead of stopping at a 30 m square.
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
    return c * smooth(t - 0.06, t + 0.06, g);
  };
  return new ClumpField(tile, ground, uniforms, {
    name: 'shrubfield', salt: 0x5eed, cap: 140000, roadsMax: 60,
    cellAny: anyAround(cover, W, H), coverAt, coverMax: 0.85,
    meanArea: 1.3 * (0.6 * Math.PI * 0.8 ** 2 + 0.4 * Math.PI * 1.1 ** 2),   // (x1.3: the crowns grew 1.15x)
    D0: 115, KMIN: 0.12, band: [3, 8, 370, 430], now: 140,   // gone only right at the camera, at every height (the 3D shrubs are too few to carry the cover)
    plant(px, pn, rnd, cov) {
      // Stands: manzanita and chamise clump into patches tens of metres across (~40% manzanita).
      const manz = rnd() < 0.1 + 0.75 * smooth(0.35, 0.75, vnoise(px / 45, pn / 45, 9));
      // Stand age: older stands grow bigger crowns and, in chamise, carry more dead wood.
      const age = vnoise(px / 28, pn / 28, 13), u = rnd();
      // Size follows the canopy shrub %: open, thin cover is small scattered plants; closed cover big crowns.
      // (x1.15: a crown drawn as a cluster of stems' crowns covers less than the disc it replaced)
      const size = 1.15 * (0.62 + 0.62 * cov) * (0.8 + 0.4 * age);
      if (manz) {
        // 1 sprawling (more where cover is thin: rocky ground), 2 open with red branching, 0 upswept.
        const variant = u < 0.2 + 0.3 * (0.85 - cov) ? 1 : u < 0.6 ? 2 : 0;
        const R = (0.7 + 0.8 * rnd()) * size * (variant === 1 ? 1.25 : 1);
        const hd = variant === 1 ? 0.5 + 0.2 * rnd() : 1.05 + 0.4 * rnd();   // height over diameter
        return [KIND.manzanita, R, 2 * R * hd, variant];
      }
      // 0 rounded, 1 ragged vase, 2 vase with grey dead stems (more in old stands).
      const variant = u < 0.12 + 0.3 * age ? 2 : u < 0.62 ? 1 : 0;
      const R = (0.5 + 0.6 * rnd()) * size * (variant ? 0.9 : 1);
      const hd = variant ? 1.15 + 0.35 * rnd() : 0.9 + 0.3 * rnd();
      return [KIND.chamise, R, 2 * R * hd, variant];
    },
  });
}

// Grass tussocks for the 12-225 m band. density(x, n): the sward density the blades are placed
// with; annualShare(x, n): the annual share of the grass there. Past ~40 m the density LOD thins
// them and grows the survivors, so out to 225 m a far impostor stands for a patch of tussocks and
// the grassland keeps a grain from 60-200 m up for about the same number of clumps on screen.
export const CLUMP_BAND = [12, 20, 185, 225];
export function GrassClumps(tile, ground, uniforms, densGrid, density, annualShare) {
  const W = tile.habitat.img.width, H = tile.habitat.img.height;
  return new ClumpField(tile, ground, uniforms, {
    name: 'grassclumps', salt: 0x6a55, cap: 60000, roadsMax: 140, riparian: 0.75,
    // Tussocks only: annual grass is a continuous sward (the shells and the terrain grain carry it);
    // drawn as discrete clumps it reads as cotton balls from the air.
    // In patches (needlegrass holds the thin-soiled knolls and old ground, the annuals the rest), so
    // from the air the tussocks show as grey-green drifts rather than an even sprinkle.
    cellAny: anyAround(densGrid, W, H), coverMax: 0.45,
    coverAt: (x, n) => 0.6 * density(x, n) * (1 - annualShare(x, n)) * (0.25 + 1.5 * smooth(0.3, 0.75, 0.7 * vnoise(x / 18, n / 18, 51) + 0.3 * vnoise(x / 6, n / 6, 52))),
    meanArea: Math.PI * 0.27 ** 2,
    D0: 34, KMIN: 0.14, band: CLUMP_BAND, now: 60,
    plant(px, pn, rnd, cov) {
      const R = 0.2 + 0.14 * rnd();
      return [KIND.bunch, R * (0.85 + 0.4 * cov), 2 * R * (1.0 + 0.4 * rnd())];
    },
  });
}

// Dry wild oat stands (summer and fall): sparse, pale, taller than the sward and airy, in patches
// 10-30 m across where the annuals are thickest, plus a thin scatter. From the air these are the
// pale flecks that stand above a cured hillside; the field is off while the grass is green.
export const STALK_BAND = [10, 18, 200, 240];
export function StalkClumps(tile, ground, uniforms, densGrid, density, annualShare) {
  const W = tile.habitat.img.width, H = tile.habitat.img.height;
  return new ClumpField(tile, ground, uniforms, {
    name: 'grassstalks', salt: 0x57a1, cap: 30000, roadsMax: 120, riparian: 0.85,
    cellAny: anyAround(densGrid, W, H),
    coverAt: (x, n) => {
      const d = density(x, n);
      if (d <= 0) return 0;
      const stand = smooth(0.52, 0.72, 0.7 * vnoise(x / 22, n / 22, 41) + 0.3 * vnoise(x / 7, n / 7, 42));
      return Math.min(d * annualShare(x, n) * (0.01 + 0.36 * stand), 0.4);
    },
    coverMax: 0.4,
    meanArea: Math.PI * 0.32 ** 2,
    D0: 30, KMIN: 0.14, band: STALK_BAND, now: 60,
    plant(px, pn, rnd, cov) {
      const R = (0.22 + 0.16 * rnd()) * (0.9 + 0.8 * cov);
      return [KIND.stalk, R, 0.85 + 0.45 * rnd()];
    },
  });
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
