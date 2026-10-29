import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { windUniforms, WIND_GLSL } from './wind.js';
import { groundUniforms, GROUND_GLSL } from './terrain.js';
import { waterAt } from './shrubfield.js';
import { rockKeep } from './tilepackage.js';
import { SPECIES, SPECIES_IDS, mulberry32 } from './trees.js';
import { seasonMonth } from './treegen.js';
import { SEASON_LOOK } from './season.js';

// The herbs (2026-10-29; Aaron: "more grass and shrub and herb species, especially for terrestrial animals"): the
// library's records of form "forb" (library/species, docs/species-library.md "Grasses, herbs and shrubs of the
// foothill understory"), drawn as small plants within FORB_R of the camera: three alpha-tested quads per plant (two
// crossed upright ones and one lying on the ground, for the rosettes and the sprawlers) textured from a picture of
// the species baked here at load with canvas 2D from its record's `ground` block (habit, leaf shape, size and colour,
// flower shape, colour and months, height_by_month, dead_rgb) for the month the season stands for: a side view and a
// top view, so a poppy is a mound of ferny leaves with orange cups in April and a few pale stalks in July, a filaree a
// flat rosette, blue dicks a bare stalk with a purple ball. Nothing is downloaded.
//
// Placement: per 30 m cell, candidate k of N (N = FORB_PER_M2 per m^2) is a pure function of (cell, k) with rank k / N,
// kept where its draw is under the cell's forb density (the herb cover of canopy.png B, by habitat class, none on
// pavement, half on the verge, none in water, thinned on outcrops and in the sward's bare patches) and drawn as a
// species from the cell's ground mix (tile.speciesMix row.ground, the forbs' share of it; the records' own habitat
// class weights where a cell has no row) weighted by the month (a species with height 0 this month is absent),
// the cell's shade (tree cover against the species' `shade`) and a patch noise of its own (poppies in drifts,
// popcorn flower in sheets). Density LOD as the clump fields: full to D0, then (D0/d)^2 kept down to KMIN, by rank, the
// survivors not grown (a herb is a herb). The far edge fades over FADE by a screen-space dither. A month change
// rebakes the atlas and clears the cells (the species present change with it).
//
// For the animals and the field guide: pick(ray) finds the plant under the cursor (identify.js), nearest(x, z, r)
// the nearest plant to a body (needs.js names it when "food here" is one of the body's foods), speciesAround(x, z, r)
// what grows round it.
const FORB_R = 45, FADE = [36, 45], D0 = 18, KMIN = 0.25, REFILL = 8, CAP = 24000, FORB_PER_M2 = 1.2, STRIDE = 8;
const T = 256, GS_MAX = 16;
const HABITAT = { 5: 1.0, 1: 0.7, 6: 0.8, 3: 0.4, 4: 0.35, 2: 0.2 };
const CLASS_NAME = { 1: 'oak_woodland', 2: 'conifer_forest', 3: 'mixed_forest', 4: 'chaparral', 5: 'grassland', 6: 'riparian' };
const ASPECT = { erect: 0.7, bulb: 0.55, mound: 1.3, rosette: 1.7, sprawling: 1.9, climbing: 1.3, floating: 40 };   // picture box width / height by habit (floating: duckweed, a mat on the water)
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
function hash2(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const bareField = (x, n) => 0.6 * vnoise(x / 11, n / 11, 3) + 0.4 * vnoise(x / 4, n / 4, 4);   // grass.js's bare patches, the same fields
const U = new Float64Array(8);
function draw(i, j, k) {   // candidate k of cell (i, j): eight uniforms, a pure function of (i, j, k)
  let a = (Math.imul(i, 73428767) ^ Math.imul(j, 912367) ^ Math.imul(k + 1, 0x9E3779B1) ^ 0x7f4a7c15) | 0;
  for (let m = 0; m < 8; m++) {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    U[m] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export const FORB_SPECIES = SPECIES_IDS.filter(id => SPECIES[id].form === 'forb').slice(0, GS_MAX).map((id, k) => {
  const s = SPECIES[id], g = s.ground || {}, H = s.height_m || [0.2, 0.4], habit = g.habit || 'erect';
  const hbm = (g.height_by_month && g.height_by_month.length === 12) ? g.height_by_month : new Array(12).fill(1);
  return { id, k, common: s.common, habit, leaf: g.leaf || { shape: 'linear', size_m: 0.05, rgb: [100, 130, 80] }, flower: g.flower || null,
    hbm, dead: g.dead_rgb || [170, 150, 110], density: g.density ?? 1, classes: s.habitat?.classes || {}, shade: s.habitat?.shade ?? 0.2,
    disturbed: s.habitat?.disturbed ?? 1, boxH: habit === 'floating' ? 0.002 : H[1], boxW: habit === 'floating' ? 0.6 : (ASPECT[habit] || 1) * H[1], evergreen: Math.min(...hbm) >= 0.5,
    floating: habit === 'floating', riparian: !!s.habitat?.riparian?.zones };
});

// ---- the plant's state in a month ------------------------------------------------------------------------------
// h: its height this month (0..1 of boxH; 0: absent), flowering, dead (dried stalks after flowering: the colour dead_rgb).
export function forbState(F, month) {
  const m = Math.min(11, Math.max(0, Math.floor(month - 1))), h = F.hbm[m], prev = F.hbm[(m + 11) % 12], fl = F.flower;
  const inMonths = (a, b, x) => a <= b ? x >= a && x <= b : x >= a || x <= b;
  const flowering = !!fl && inMonths(fl.months[0], fl.months[1], m + 1) && h > 0;
  const afterFlower = fl ? (fl.months[0] <= fl.months[1] ? m + 1 > fl.months[1] : m + 1 > fl.months[1] && m + 1 < fl.months[0]) : false;
  const dead = !F.evergreen && h > 0.15 && afterFlower && h <= prev;
  return { h, flowering, dead };
}

// ---- the pictures (canvas 2D) ----------------------------------------------------------------------------------
const css = (rgb, k = 1, a = 1) => `rgba(${Math.min(255, rgb[0] * k) | 0},${Math.min(255, rgb[1] * k) | 0},${Math.min(255, rgb[2] * k) | 0},${a})`;
// One leaf of the species' shape at (x, y), pointing along angle a (radians, 0 = up on the picture), length L px.
function leaf(g, F, x, y, a, L, rnd, col) {
  const sh = F.leaf.shape, w = L * (sh === 'round' ? 0.9 : sh === 'ovate' ? 0.55 : sh === 'strap' || sh === 'linear' ? 0.12 : sh === 'ferny' ? 0.5 : 0.4);
  g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round';
  if (sh === 'ferny') {   // a feather of fine lobes
    g.lineWidth = Math.max(1, L * 0.05); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L); g.stroke();
    const n = 5 + Math.floor(rnd() * 3);
    for (let q = 1; q <= n; q++) { const t = q / (n + 1), l = w * (1 - 0.6 * Math.abs(t - 0.5)); g.lineWidth = Math.max(1, L * 0.045);
      g.beginPath(); g.moveTo(0, -L * t); g.lineTo(-l, -L * t - l * 0.35); g.moveTo(0, -L * t); g.lineTo(l, -L * t - l * 0.35); g.stroke(); }
  } else if (sh === 'palmate') {   // 5-7 leaflets from a point
    const n = 5 + Math.floor(rnd() * 3);
    for (let q = 0; q < n; q++) { const b = (q / (n - 1) - 0.5) * 2.4; g.beginPath(); g.ellipse(Math.sin(b) * L * 0.45, -Math.cos(b) * L * 0.45, L * 0.5, L * 0.09, b, 0, Math.PI * 2); g.fill(); }
  } else if (sh === 'trifoliate') {
    for (const b of [-0.7, 0, 0.7]) { g.beginPath(); g.ellipse(Math.sin(b) * L * 0.5, -Math.cos(b) * L * 0.5, L * 0.42, L * 0.16, b, 0, Math.PI * 2); g.fill(); }
    g.lineWidth = Math.max(1, L * 0.04); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L * 0.3); g.stroke();
  } else if (sh === 'round') { g.beginPath(); g.ellipse(0, -L * 0.5, L * 0.45, L * 0.42, 0, 0, Math.PI * 2); g.fill(); }
  else if (sh === 'ovate') { g.beginPath(); g.ellipse(0, -L * 0.5, L * 0.52, L * 0.26, 0, 0, Math.PI * 2); g.fill(); }
  else if (sh === 'strap') { g.lineWidth = Math.max(1.5, L * 0.07); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.15, -L * 0.7, L * 0.35, -L); g.stroke(); }
  else if (sh === 'linear') { g.lineWidth = Math.max(1, L * 0.09); g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.08, -L); g.stroke(); }
  else if (sh === 'pinnate') {   // pairs of leaflets along a stalk, a tendril at the tip
    g.lineWidth = Math.max(1, L * 0.035); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L); g.stroke();
    for (let q = 1; q <= 5; q++) { const t = q / 6; for (const sgn of [-1, 1]) { g.beginPath(); g.ellipse(sgn * L * 0.14, -L * t, L * 0.13, L * 0.045, sgn * 0.5, 0, Math.PI * 2); g.fill(); } }
  } else {   // lobed
    g.beginPath(); g.ellipse(0, -L * 0.5, L * 0.4, L * 0.32, 0, 0, Math.PI * 2); g.fill();
    for (const b of [-0.9, 0, 0.9]) { g.beginPath(); g.ellipse(Math.sin(b) * L * 0.35, -L * 0.6 - Math.cos(b) * L * 0.25, L * 0.2, L * 0.15, b, 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
}
// A flower (or a flower head) of the species' shape at (x, y), size s px.
function flower(g, F, x, y, s, rnd) {
  const fl = F.flower, col = css(fl.rgb), sh = fl.shape;
  g.save(); g.translate(x, y); g.fillStyle = col; g.strokeStyle = col;
  if (sh === 'cup') { for (let q = 0; q < 4; q++) { const b = q * Math.PI / 2 + 0.4; g.beginPath(); g.ellipse(Math.cos(b) * s * 0.22, Math.sin(b) * s * 0.22 - s * 0.1, s * 0.32, s * 0.26, b, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = css(fl.rgb, 0.75); g.beginPath(); g.arc(0, -s * 0.1, s * 0.12, 0, Math.PI * 2); g.fill(); }
  else if (sh === 'spike') { for (let q = 0; q < 9; q++) { const t = q / 8, k = 0.8 + 0.4 * (q % 2); g.fillStyle = css(fl.rgb, q % 3 === 0 ? 1.25 : 1); g.beginPath(); g.ellipse((q % 2 ? 1 : -1) * s * 0.12, -t * s, s * 0.13 * k, s * 0.09, 0, 0, Math.PI * 2); g.fill(); } }
  else if (sh === 'coil') { for (let q = 0; q < 8; q++) { const b = q * 0.55; g.beginPath(); g.arc(Math.sin(b) * s * 0.3 * (1 - q / 10), -s * 0.5 - Math.cos(b) * s * 0.3 * (1 - q / 10), s * 0.08, 0, Math.PI * 2); g.fill(); } }
  else if (sh === 'umbel') { g.lineWidth = 1; for (let q = 0; q < 14; q++) { const b = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * s * 0.5; g.beginPath(); g.arc(Math.cos(b) * r, -s * 0.1 + Math.sin(b) * r * 0.3, s * 0.09, 0, Math.PI * 2); g.fill(); } }
  else if (sh === 'ball') { for (let q = 0; q < 12; q++) { const b = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * s * 0.42; g.fillStyle = css(fl.rgb, 0.85 + 0.3 * rnd()); g.beginPath(); g.arc(Math.cos(b) * r, -s * 0.45 + Math.sin(b) * r, s * 0.13, 0, Math.PI * 2); g.fill(); } }
  else if (sh === 'daisy') { for (let q = 0; q < 12; q++) { const b = q * Math.PI / 6; g.beginPath(); g.ellipse(Math.cos(b) * s * 0.32, -s * 0.4 + Math.sin(b) * s * 0.32, s * 0.22, s * 0.08, b, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = css([fl.rgb[0] * 0.55, fl.rgb[1] * 0.45, fl.rgb[2] * 0.3]); g.beginPath(); g.arc(0, -s * 0.4, s * 0.14, 0, Math.PI * 2); g.fill(); }
  else if (sh === 'pea') { for (let q = 0; q < 7; q++) { g.beginPath(); g.ellipse(s * 0.12, -q * s * 0.14, s * 0.14, s * 0.08, -0.6, 0, Math.PI * 2); g.fill(); } }
  else { for (let q = 0; q < 10; q++) { const b = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * s * 0.5; g.beginPath(); g.arc(Math.cos(b) * r, -s * 0.3 + Math.sin(b) * r * 0.6, s * 0.07, 0, Math.PI * 2); g.fill(); } }   // tiny: a scatter
  g.restore();
}
// The side view of species F in its box (boxW x boxH m) at state st into tile (cx, cy) of the atlas; `top` draws the top view.
function drawTile(g, F, st, cx, cy, top) {
  g.save(); g.beginPath(); g.rect(cx, cy, T, T); g.clip(); g.clearRect(cx, cy, T, T);
  if (st.h <= 0) { g.restore(); return; }
  const rnd = mulberry32(1000 + F.k * 17 + (top ? 7 : 0)), ppm = T / Math.max(F.boxW, F.boxH);   // px per metre, the box fits the tile
  const H = F.boxH * st.h * ppm, W = F.boxW * ppm * Math.min(1, 0.45 + 0.55 * st.h), Lf = Math.max(6, F.leaf.size_m * ppm);
  const base = css(F.leaf.rgb), leafCol = k => css(st.dead ? F.dead : F.leaf.rgb, k);
  const hb = F.habit, x0 = cx + T / 2, y0 = top ? cy + T / 2 : cy + T - 2;
  const nLeaves = Math.round(Math.min(60, 6 + 40 * (W * H) / (Lf * Lf) * 0.5));
  if (F.floating) {   // a floating mat (duckweed): a ragged disc of tiny fronds, drawn on the water in the ground quad only
    if (!top) { g.restore(); return; }
    const R = T * 0.46, n = 900;
    for (let q = 0; q < n; q++) { const b = rnd() * Math.PI * 2, r = R * Math.sqrt(rnd()) * (0.75 + 0.25 * vnoise(Math.cos(b) * 3, Math.sin(b) * 3, 77)); g.fillStyle = leafCol(0.8 + 0.45 * rnd()); g.beginPath(); g.arc(x0 + Math.cos(b) * r, y0 + Math.sin(b) * r, 2.2 + 1.5 * rnd(), 0, Math.PI * 2); g.fill(); }
    g.restore(); return;
  }
  if (top) {   // the plant from above: leaves radiating from the centre, the flowers on top
    const R = Math.min(W, T) * 0.5;
    for (let q = 0; q < nLeaves; q++) { const b = rnd() * Math.PI * 2, r = (hb === 'erect' || hb === 'bulb' ? 0.2 : 0.35 + 0.6 * rnd()) * R, L = Lf * (0.7 + 0.6 * rnd());
      leaf(g, F, x0 + Math.cos(b) * r * 0.3, y0 + Math.sin(b) * r * 0.3, b + Math.PI / 2, Math.min(L, R - r * 0.3 + L * 0.2), rnd, leafCol(0.8 + 0.4 * rnd())); }
    if (st.flowering && F.flower) { const n = Math.max(1, Math.round((F.flower.per_plant || 3) * 0.7)), fs = Math.max(5, F.flower.size_m * ppm);
      for (let q = 0; q < n; q++) { const b = rnd() * Math.PI * 2, r = (hb === 'erect' || hb === 'bulb' ? 0.15 : 0.6) * R * rnd(); flower(g, F, x0 + Math.cos(b) * r, y0 + Math.sin(b) * r + fs * 0.3, fs, rnd); } }
    g.restore(); return;
  }
  // stems (erect, bulb, mound: a few; climbing: a tangle)
  const stemCol = st.dead ? css(F.dead, 0.9) : css(F.leaf.rgb, 0.8), nStems = hb === 'rosette' ? 0 : hb === 'climbing' ? 6 : hb === 'bulb' ? 1 : hb === 'erect' ? 2 : 4;
  g.strokeStyle = stemCol; g.lineCap = 'round';
  for (let q = 0; q < nStems; q++) { const x1 = x0 + (rnd() - 0.5) * W * 0.6, lean = (rnd() - 0.5) * W * 0.5; g.lineWidth = Math.max(1, H * 0.012);
    g.beginPath(); g.moveTo(x0 + (rnd() - 0.5) * W * 0.15, y0); g.quadraticCurveTo(x1, y0 - H * 0.55, x1 + lean * 0.4, y0 - H * (0.85 + 0.15 * rnd())); g.stroke(); }
  // leaves: a rosette lies flat and low, a mound fills its dome, an erect stem carries them along it
  for (let q = 0; q < nLeaves; q++) {
    const u = rnd(), v = rnd(), L = Lf * (0.7 + 0.6 * rnd());
    let x, y, a;
    if (hb === 'rosette') { x = x0 + (u - 0.5) * W; y = y0 - v * Math.min(H, Lf * 0.8); a = (u - 0.5) * 2.2; }
    else if (hb === 'sprawling') { x = x0 + (u - 0.5) * W; y = y0 - v * H * 0.8; a = (rnd() - 0.5) * 2.6; }
    else if (hb === 'erect' || hb === 'bulb') { const t = 0.05 + v * 0.7; x = x0 + (u - 0.5) * W * 0.25; y = y0 - H * t; a = (u - 0.5) * 2.0 * (hb === 'bulb' ? 0.4 : 1); if (hb === 'bulb') { y = y0 - v * H * 0.35; } }
    else if (hb === 'climbing') { x = x0 + (u - 0.5) * W; y = y0 - v * H; a = (rnd() - 0.5) * 3; }
    else { const b = (u - 0.5) * Math.PI, r = Math.sqrt(v); x = x0 + Math.sin(b) * r * W * 0.5; y = y0 - Math.cos(b) * r * H * 0.85 - H * 0.05; a = b * 0.8; }   // mound
    leaf(g, F, x, y, a, L, rnd, leafCol(0.75 + 0.45 * rnd()));
  }
  // flowers: over the top of the plant (a rosette's on short stalks above it)
  if (st.flowering && F.flower) {
    const n = Math.max(1, F.flower.per_plant || 3), fs = Math.max(5, F.flower.size_m * ppm), fh = hb === 'rosette' ? Math.max(H, Lf * 1.2) : H;
    for (let q = 0; q < n; q++) { const x = x0 + (rnd() - 0.5) * W * (hb === 'erect' || hb === 'bulb' ? 0.3 : 0.9), y = y0 - fh * (0.75 + 0.3 * rnd());
      g.strokeStyle = stemCol; g.lineWidth = Math.max(1, fs * 0.06); g.beginPath(); g.moveTo(x0 + (x - x0) * 0.3, y0 - fh * 0.3); g.lineTo(x, y + fs * 0.3); g.stroke();
      flower(g, F, x, y, fs, rnd); }
  }
  g.restore();
}

// ---- GLSL --------------------------------------------------------------------------------------------------------
const VERT = /* glsl */`
  ${WIND_GLSL}
  ${GROUND_GLSL}
  ${ATMOSPHERE_GLSL}
  uniform vec2 fade; uniform vec2 kParams; uniform vec4 spBox[${GS_MAX}];   // per species: box w, box h, height this month (0..1), top quad lift
  uniform float forbOn;
  attribute vec4 iPos; attribute vec4 iVar;   // root x y z, scale | species, seed, yaw, rank
  attribute float aQuad;   // 0, 1: the crossed uprights; 2: the one on the ground
  varying vec2 vUv; varying vec3 vSun; varying vec3 vAmb; varying vec3 vT; varying vec3 vIn; varying float vFade; varying float vDiff;
  float h11(float n) { return fract(sin(n) * 43758.5453123); }
  void main() {
    int sp = int(iVar.x + 0.5); vec4 B = spBox[sp];
    float d = distance(cameraPosition, iPos.xyz);
    float keep = clamp(kParams.x * kParams.x / max(d * d, 1.0), kParams.y, 1.0);
    float s = step(iVar.w, keep) * (1.0 - smoothstep(fade.x, fade.y, d)) * forbOn;
    if (s < 0.01 || B.z <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    float sc = iPos.w, yaw = iVar.z + aQuad * 1.5707963;
    float c = cos(yaw), sn = sin(yaw);
    vec3 p;
    if (aQuad < 1.5) {   // upright: x across, y up; the picture's box is B.x wide, B.y tall (the plant B.z of it this month)
      vec2 q = vec2(position.x * B.x, uv.y * B.y) * sc;
      p = iPos.xyz + vec3(q.x * c, q.y, -q.x * sn);
      float t = uv.y;
      p.xz += windDir * windStrength * gust(iPos.xz) * t * t * 0.18 * B.y * sc;
    } else {   // on the ground, a little above it so it does not z-fight, the size of the top view
      vec2 q = vec2(position.x, position.y) * B.x * sc;
      p = iPos.xyz + vec3(q.x * c - q.y * sn, B.w, -(q.x * sn + q.y * c));
    }
    vUv = vec2((uv.x + (aQuad > 1.5 ? 1.0 : 0.0)) * 0.5, (uv.y + float(sp)) / ${GS_MAX}.0);
    vFade = s;
    // Light as the grass cards take it: sun on a surface facing the camera, bent to the ground normal; sky and
    // ground ambient with the canopy's occlusion and the near trees' contact AO; cloud shadow; the atmosphere.
    vec3 V = normalize(cameraPosition - iPos.xyz);
    vec3 Nb = aQuad > 1.5 ? vec3(0.0, 1.0, 0.0) : normalize(vec3(V.x, 0.0, V.z) + vec3(1e-4, 0.0, 0.0));
    vDiff = max(dot(normalize(Nb + vec3(0.0, 1.0, 0.0)), sunDir), 0.0);
    vSun = sunLight * cloudShadow(iPos.xyz);
    float occ = groundSkyOcclusion(groundUv(iPos.xyz)) * groundContactAO(iPos.xyz);
    vAmb = mix(ambientGround, ambientSky, 0.55) * occ;
    vIn = atmosphereApply(vec3(0.0), iPos.xyz, cameraPosition);
    vT = atmosphereApply(vec3(1.0), iPos.xyz, cameraPosition) - vIn;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform sampler2D atlas; uniform vec3 wxGround;
  varying vec2 vUv; varying vec3 vSun; varying vec3 vAmb; varying vec3 vT; varying vec3 vIn; varying float vFade; varying float vDiff;
  void main() {
    if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vFade) discard;
    vec4 t = texture2D(atlas, vUv);
    if (t.a < 0.3) discard;
    vec3 alb = pow(t.rgb, vec3(2.2));
    alb = mix(alb, vec3(0.7, 0.73, 0.78), wxGround.z * 0.6);   // lying snow (weather.js)
    vec3 col = (alb * (vSun * (0.4 + 0.6 * vDiff) + vAmb) + alb * alb * vSun * 0.15) * 0.3183099;
    gl_FragColor = vec4(col * vT + vIn, t.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Forbs {
  constructor(tile, scene, grass) {
    this.tile = tile; this.scene = scene; this.grass = grass;
    this.cache = new Map(); this.last = null; this.month = -1; this.season = 'summer'; this.states = [];
    this.uniforms = { ...windUniforms, ...groundUniforms, ...atmo, atlas: { value: null }, fade: { value: new THREE.Vector2(...FADE) },
      kParams: { value: new THREE.Vector2(D0, KMIN) }, spBox: { value: FORB_SPECIES.map(F => new THREE.Vector4(F.boxW, F.boxH, 0, 0.03)).concat(Array.from({ length: GS_MAX - FORB_SPECIES.length }, () => new THREE.Vector4())) },
      forbOn: { value: 1 } };
    // geometry: two crossed upright quads (x across, uv.y up) and one on the ground, 12 vertices
    const g = new THREE.InstancedBufferGeometry(), pos = [], uv = [], quad = [], idx = [];
    for (let q = 0; q < 3; q++) {
      const b = pos.length / 3;
      if (q < 2) { pos.push(-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0); uv.push(0, 0, 1, 0, 1, 1, 0, 1); }
      else { pos.push(-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0); uv.push(0, 0, 1, 0, 1, 1, 0, 1); }
      quad.push(q, q, q, q); idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aQuad', new THREE.Float32BufferAttribute(quad, 1)); g.setIndex(idx);
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(CAP * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buf, 4, 0)); g.setAttribute('iVar', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    g.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.DoubleSide, alphaToCoverage: true });
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.name = 'forbs'; this.mesh.renderOrder = 2;
    this.group = new THREE.Group(); this.group.name = 'forbs'; this.group.add(this.mesh); scene.add(this.group);
    this.n = 0; this.staged = []; this.on = true;
    this.buildDensity();
    this.mixCache = new Map();
  }
  // Forb density per cell: the herb cover (floored at 0.3, as the grass takes it) times the habitat class's share.
  buildDensity() {
    const hab = this.tile.habitat, can = this.tile.canopy, W = hab.img.width, H = hab.img.height;
    this.W = W; this.Hh = H; this.dens = new Float32Array(W * H); this.cover = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, h = Math.min(Math.max(can.channel(i, j, 2) / 100, 0.3), 1), hb = HABITAT[hab.channel(i, j, 0)] || 0;
      this.dens[k] = hb * (0.5 + 0.5 * h); this.cover[k] = can.channel(i, j, 0) / 100;
    }
  }
  sample(grid, x, north) {
    const res = this.tile.habitat.res, u = x / res - 0.5, v = (this.tile.size - north) / res - 0.5;
    const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, W = this.W, H1 = this.Hh - 1;
    const i0 = Math.min(Math.max(i, 0), W - 1), i1 = Math.min(Math.max(i + 1, 0), W - 1);
    const r0 = Math.min(Math.max(j, 0), H1) * W, r1 = Math.min(Math.max(j + 1, 0), H1) * W;
    return (grid[r0 + i0] * (1 - fx) + grid[r0 + i1] * fx) * (1 - fy) + (grid[r1 + i0] * (1 - fx) + grid[r1 + i1] * fx) * fy;
  }
  // The forb species of cell (i, j) this month: cumulative weights over FORB_SPECIES (the cell's mix row's forbs, else the
  // records' habitat class weights), each by its density, its presence this month, its shade against the cell's tree
  // cover and its liking for the verge. Cached per (row, month).
  speciesMix(i, j) {
    const row = this.tile.speciesMix?.at(i, j), key = (row ? row.index : -this.tile.habitat.channel(i, j, 0)) * 1000 + (j * this.W + i) % 7 * 0;
    let m = this.mixCache.get(key); if (m) return m;
    const cls = CLASS_NAME[this.tile.habitat.channel(i, j, 0)], cover = this.cover[j * this.W + i], fromRow = row?.groundSum && Object.keys(row.ground).some(id => SPECIES[id]?.form === 'forb');
    const cum = []; let acc = 0;
    for (const F of FORB_SPECIES) {
      const st = this.states[F.k]; if (!st || st.h <= 0) continue;
      let w = fromRow ? row.ground[F.id] || 0 : (F.classes[cls] || 0) * F.density;
      w *= F.shade > 0.5 ? 0.25 + 1.5 * cover : 1.2 - cover * (1 - F.shade);   // shade lovers under the trees, the rest in the open
      if (w <= 0) continue;
      acc += w; cum.push([F.k, acc]);
    }
    m = { cum, total: acc }; this.mixCache.set(key, m); return m;
  }
  // The forbs of a riparian zone (tile.water, 2026-10-29): the zone row's forbs (SpeciesMix.ripRow: nettle, mugwort,
  // monkeyflower, watercress, duckweed...) this month, as speciesMix's cum; cached per row and month. Null without a row.
  zoneMix(row) {
    const key = 'rip:' + row.key; let m = this.mixCache.get(key); if (m) return m;
    const cum = []; let acc = 0;
    for (const F of FORB_SPECIES) {
      const st = this.states[F.k]; if (!st || st.h <= 0) continue;
      const w = (row.ground[F.id] || 0) * F.density; if (w <= 0) continue;
      acc += w; cum.push([F.k, acc]);
    }
    m = { cum, total: acc }; this.mixCache.set(key, m); return m;
  }
  // The plants of cell (i, j): a Float32Array of instances (STRIDE each), in rank order, and the cell's bounds.
  cellData(i, j) {
    const key = j * this.W + i;
    let c = this.cache.get(key); if (c) return c;
    const { habitat: hab, size, roads, waterMask: wm, water: WG, speciesMix: SM } = this.tile, res = hab.res, out = [];
    const cellMix = this.speciesMix(i, j), N = Math.round(res * res * FORB_PER_M2);
    const ripCell = WG && SM?.rip?.size && WG.cellShare(i, j, res).some(v => v > 0);   // any riparian zone in the cell
    if (cellMix.total > 0 || ripCell) for (let k = 0; k < N; k++) {
      draw(i, j, k);
      const px = (i + U[0]) * res, pn = size - (j + U[1]) * res;
      let dens = this.sample(this.dens, px, pn) * rockKeep(this.tile, px, pn);
      const rw = roads ? roads.at(px, pn) : 0; if (rw > 140) continue;
      // The water system's zones (tile.water): in a zone the row's forbs (zoneMix) at the zone's density; a channel bed, a
      // pond's basin and its mud hold only those (watercress in the shallows, duckweed on the water, nothing else); on the
      // wet margin the upland forbs stay at half. In the water itself (the water mask) only a floating or riparian forb.
      let mix = cellMix, wz = null, floatY = null;
      if (WG) {
        wz = WG.info(px, pn);
        if (wz.zone) {
          const row = SM?.ripRow(wz), zm = row && this.zoneMix(row);
          const wetZone = wz.zone === 1 || wz.zone === 5 || wz.zone === 6;
          if (zm && zm.total > 0) { mix = zm; dens = Math.max(dens, 0.6) * row.density[2] * (wetZone ? 0.6 : 1); }
          else if (wetZone) continue;
          else if (wz.zone === 2) dens *= 0.5;
          if (wz.zone === 5) { floatY = WG.level(px, pn); }
        }
      }
      if (dens <= 0 || mix.total <= 0) continue;
      // the species, then its own patches (drifts a few to twenty metres across) and the sward's bare patches
      let sp = mix.cum[0][0]; const r = U[2] * mix.total; for (const [kk, a] of mix.cum) { sp = kk; if (r <= a) break; }
      const F = FORB_SPECIES[sp];
      if (wm && waterAt(wm, px, pn) === 255 && !(F.floating || F.riparian)) continue;
      if (F.floating && floatY === null) continue;
      const patch = 0.12 + 0.88 * smooth(0.38, 0.72, 0.65 * vnoise(px / 13, pn / 13, 400 + sp) + 0.35 * vnoise(px / 4.5, pn / 4.5, 500 + sp));
      const bare = 0.35 + 0.65 * smooth(0.25, 0.45, bareField(px, pn)), verge = rw > 0 ? Math.min(1, 0.5 * F.disturbed) : 1;
      if (U[3] >= dens * patch * bare * verge * 0.9) continue;
      const sc = (0.75 + 0.5 * U[4]) * (0.8 + 0.3 * dens);
      const y = floatY !== null ? floatY + 0.01 : this.grass.ground(px, pn);
      out.push(px, y, -pn, sc, sp, U[5], U[6] * Math.PI * 2, (k + 0.5) / N);
    }
    const arr = new Float32Array(out);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let o = 0; o < arr.length; o += STRIDE) { x0 = Math.min(x0, arr[o]); x1 = Math.max(x1, arr[o]); y0 = Math.min(y0, arr[o + 1]); y1 = Math.max(y1, arr[o + 1]); z0 = Math.min(z0, arr[o + 2]); z1 = Math.max(z1, arr[o + 2]); }
    c = arr.length ? { arr, x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 0.5, z: (z0 + z1) / 2, r: Math.hypot((x1 - x0) / 2 + 1, (y1 - y0) / 2 + 1, (z1 - z0) / 2 + 1) } : { arr, x: 0, y: 0, z: 0, r: 0 };
    if (this.cache.size > 300) this.cache.clear();
    this.cache.set(key, c); return c;
  }
  // The atlas for the month: every species' side and top view (drawTile), 2 x FORB_SPECIES tiles of T px.
  bake(month) {
    this.month = month; this.states = FORB_SPECIES.map(F => forbState(F, month));
    const c = this.canvas || (this.canvas = document.createElement('canvas')); c.width = 2 * T; c.height = GS_MAX * T;
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    FORB_SPECIES.forEach(F => { const st = this.states[F.k]; drawTile(g, F, st, 0, F.k * T, false); drawTile(g, F, st, T, F.k * T, true);
      this.uniforms.spBox.value[F.k].set(F.boxW, F.boxH, st.h, 0.03); });
    if (!this.atlas) { this.atlas = new THREE.CanvasTexture(c); this.atlas.colorSpace = THREE.SRGBColorSpace; this.atlas.generateMipmaps = true; this.atlas.minFilter = THREE.LinearMipmapLinearFilter; this.atlas.anisotropy = 4; this.uniforms.atlas.value = this.atlas; }
    this.atlas.needsUpdate = true;
    this.cache.clear(); this.mixCache.clear(); this.last = null;
  }
  setLook(look) {
    const season = Object.keys(SEASON_LOOK).find(k => SEASON_LOOK[k] === look) || 'summer', month = seasonMonth(season);
    if (Math.abs(month - this.month) > 0.6 || season !== this.season) { this.season = season; this.bake(month); }
  }
  // Stage the cells within FORB_R + REFILL of (x, north) into the buffer (every instance; the shader thins and fades).
  fill(x, north) {
    const res = this.tile.habitat.res, size = this.tile.size, place = FORB_R + REFILL + 1, buf = this.buf.array; let n = 0;
    this.staged.length = 0;
    const i0 = Math.max(0, Math.floor((x - place) / res)), i1 = Math.min(this.W - 1, Math.floor((x + place) / res));
    const j0 = Math.max(0, Math.floor((size - north - place) / res)), j1 = Math.min(this.Hh - 1, Math.floor((size - north + place) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * res, cn = size - (j + 0.5) * res; if (Math.hypot(cx - x, cn - north) > place + res * 0.71) continue;
      const c = this.cellData(i, j), m = c.arr.length / STRIDE; if (!m || n + m > CAP) continue;
      buf.set(c.arr, n * STRIDE); this.staged.push({ start: n, count: m, x: c.x, y: c.y, z: c.z, r: c.r, arr: c.arr }); n += m;
    }
    this.n = n; this.mesh.geometry.instanceCount = n;
    this.buf.clearUpdateRanges(); this.buf.addUpdateRange(0, Math.max(n, 1) * STRIDE); this.buf.needsUpdate = true;
  }
  update(camera, look) {
    if (look) this.setLook(look);
    if (!this.atlas) return;
    const cp = camera.position, north = -cp.z, agl = cp.y - this.grass.ground(cp.x, north);
    const on = this.on && agl < FORB_R + 20;
    this.uniforms.forbOn.value = on ? 1 : 0;
    if (!on) { this.mesh.visible = false; return; }
    if (!this.last || Math.hypot(cp.x - this.last[0], north - this.last[1]) > REFILL) { this.last = [cp.x, north]; this.fill(cp.x, north); }
    this.mesh.visible = this.n > 0;
  }
  get counts() { return { staged: this.n, species: FORB_SPECIES.length, month: this.month }; }
  // The plant under a ray (identify.js): the nearest instance whose box the ray passes within, out to `far` m.
  pick(origin, dir, far = FORB_R) {
    let best = null; const buf = this.buf.array;
    for (let q = 0; q < this.n; q++) {
      const o = q * STRIDE, sp = buf[o + 4] | 0, F = FORB_SPECIES[sp], st = this.states[sp]; if (!F || !st || st.h <= 0) continue;
      const sc = buf[o + 3], H = F.boxH * st.h * sc, R = Math.max(0.1, 0.5 * F.boxW * sc * 0.7);
      const vx = buf[o] - origin.x, vy = buf[o + 1] + 0.5 * H - origin.y, vz = buf[o + 2] - origin.z;
      const t = vx * dir.x + vy * dir.y + vz * dir.z, rr = Math.max(R, 0.3 * H);
      if (t < rr + 0.3 || t > far) continue;   // a plant the camera stands in is not under the cursor
      const l2 = vx * vx + vy * vy + vz * vz - t * t;
      if (l2 > rr * rr) continue;
      if (!best || t < best.distance) best = { distance: t, species: F.id, id: `forb:${q}`, x: buf[o], z: buf[o + 2], y: buf[o + 1], point: new THREE.Vector3(buf[o], buf[o + 1] + 0.5 * H, buf[o + 2]) };
    }
    return best;
  }
  // The nearest plant to (x, z) within r m, optionally of the species in `ids` (a Set): { species, d, x, z } or null.
  nearest(x, z, r, ids = null) {
    let best = null; const buf = this.buf.array, r2 = r * r;
    for (let q = 0; q < this.n; q++) {
      const o = q * STRIDE, sp = buf[o + 4] | 0, F = FORB_SPECIES[sp]; if (!F || (ids && !ids.has(F.id))) continue;
      const dx = buf[o] - x, dz = buf[o + 2] - z, d2 = dx * dx + dz * dz; if (d2 > r2) continue;
      if (!best || d2 < best.d2) best = { species: F.id, d2, x: buf[o], z: buf[o + 2] };
    }
    if (best) best.d = Math.sqrt(best.d2);
    return best;
  }
  // Counts by species within r m of (x, z).
  speciesAround(x, z, r) {
    const out = {}, buf = this.buf.array, r2 = r * r;
    for (let q = 0; q < this.n; q++) { const o = q * STRIDE, dx = buf[o] - x, dz = buf[o + 2] - z; if (dx * dx + dz * dz > r2) continue; const F = FORB_SPECIES[buf[o + 4] | 0]; if (F) out[F.id] = (out[F.id] || 0) + 1; }
    return out;
  }
  dispose() {
    this.mesh.visible = false; this.mesh.geometry.dispose(); this.material.dispose(); this.atlas?.dispose(); this.cache.clear(); this.mixCache.clear();
  }
}
