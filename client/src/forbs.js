import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { windUniforms, WIND_GLSL } from './wind.js';
import { groundUniforms, GROUND_GLSL, seasonState } from './terrain.js';
import { waterAt } from './shrubfield.js';
import { rockKeep } from './tilepackage.js';
import { SPECIES, SPECIES_IDS, mulberry32 } from './trees.js';
import { seasonMonth } from './treegen.js';
import { SEASON_LOOK } from './season.js';
import { ownGround } from './grass.js';

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
// The species are the tile's own (2026-11-06, forbSet): the ground plants its species mix lists, chosen when it loads,
// up to GS_MAX atlas slots; a tile that lists none keeps the library-wide set. The dwarf shrubs among them (crowberry,
// heather: woody records with a ground block, habit 'mat') are drawn as a carpet: their own candidates per cell, as many
// as cover the cell's carpet share (species_mix density_bytes[2] x canopy.png shrub cover), a low dome from the side and
// a ragged disc of shoots from above, in the season's leaf colour, with their flowers and berries in their months.
//
// For the animals and the field guide: pick(ray) finds the plant under the cursor (identify.js), nearest(x, z, r)
// the nearest plant to a body (needs.js names it when "food here" is one of the body's foods), speciesAround(x, z, r)
// what grows round it.
const FORB_R = 45, FADE = [36, 45], D0 = 18, KMIN = 0.25, REFILL = 8, CAP = 40000, FORB_PER_M2 = 1.2, STRIDE = 10;   // STRIDE 10 (2026-11-06, was 8): + the ground's slope. CAP 40000 (2026-11-06, was 24000): a heath's carpet
const CARPET_PER_M2 = 2.2, CARPET_MAX = 0.95, MAT_H = 0.7;   // the dwarf-shrub carpet's candidates per m^2 (enough for the closed patches); its cover at most; a mat's dome, of its box height
// A carpet mat is a clone's patch (2026-11-06, iteration 6): a heather or crowberry plant's shoots interlace with its
// neighbours' and layer where they touch the ground, so a heath is patches a metre or two across, not single domes. Each
// mat is drawn MAT_SPREAD x its card's crown width (heather 0.96 m -> 1.7 m, crowberry 0.85 -> 1.5) at the card's height,
// a plateau with rounded shoulders rather than a dome, so overlapping mats make one lumpy surface at the carpet's height.
// Its survivors in a closed patch (and of the distance thinning) grow across, hardly up (MAT_UP: height ~ width^0.35).
const MAT_SPREAD = 1.8, MAT_UP = 0.35, MAT_R = 0.36, R2A = 0.7548776662466927, R2B = 0.5698402909980532;   // MAT_R: the mat's radius in its tile (and quad), the rest its skirt
// The carpet reaches farther than the herbs (2026-11-06): it is the ground's cover, not a plant here and there, so it
// stays to CARPET_R (dithering out over its last fifth) and hands over there to the ground texture, its colour taken
// toward the texture's under it over the second half of its reach (the photo at 2.5 m is the heath's mean: mats and
// the ground between them).
// Thinned by rank past D0 as the herbs are, its survivors grown to keep the cover; a cell is staged only to the rank
// its nearest point can show (fill), so the farther ring costs a quarter of its candidates.
// From the air it reaches farther: to CARPET_R + 1.25 x the camera's height over the ground, at most CARPET_FAR (150 m
// up: 260 m), its survivors thinned to KMIN_C and grown to 3 x across (not in height), so a heath reads as a heath's
// mosaic from 10 to 150 m up, not only as the photo.
const CARPET_R = 78, CARPET_FAR = 260, KMIN_C = 0.1, TOP_LIFT = 0.95;
// A rosette taller than this (m; the sword fern's 0.9-1.5 m fronds arch up) has no lying quad: its top view laid on the
// ground at the picture box's width (1.7 x its height, 2.5 m for a sword fern) drew a flat green disc in the oak savanna
// (2026-11-08); a short rosette (filaree, a dandelion's) keeps it. spBox.w < 0 says so to the vertex shader.
const TALL_ROSETTE = 0.35;   // the top view's centre at TOP_LIFT of the dome's height
const carpetRange = agl => Math.min(CARPET_FAR, CARPET_R + 1.25 * Math.max(0, agl));
const keepAt = (d, kmin) => Math.min(1, Math.max(kmin, D0 * D0 / Math.max(d * d, 1)));   // the shader's thinning (kParams), at distance d
const T = 256, GS_MAX = 24;   // 24 (2026-11-04, was 16): the library's 19 California forbs and the Olympic ferns, sorrel and lupine (the atlas 512 x 6144)
export const FORB_MAX = GS_MAX;   // the species slots (forage.js sizes its weights to it)
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

// The ground plants a tile can draw (2026-11-06): the records of form "forb", and the dwarf shrubs (a woody record whose
// height tops out at or below 0.5 m: crowberry, heather, the mountain heathers), which pipeline/plantgen.py gives a
// `ground` block with woody: true from their trait cards and pipeline/species_mix.py moves from the shrub layer into
// the ground layer. `seed` is the species' own number (its place among the library's forbs, or 500 + its place among
// the woody ground plants), so its picture and its patches are the same whichever slot of the atlas it takes.
const FORB_IDS = SPECIES_IDS.filter(id => SPECIES[id].form === 'forb');
const WOODY_IDS = SPECIES_IDS.filter(id => SPECIES[id].form !== 'forb' && SPECIES[id].ground?.woody);
export const groundPlant = s => !!s && (s.form === 'forb' || !!s.ground?.woody);
function forbEntry(id, k) {
  const s = SPECIES[id], g = s.ground || {}, H = s.height_m || [0.2, 0.4], woody = !!g.woody, habit = g.habit || (woody ? 'mat' : 'erect');
  const hbm = (g.height_by_month && g.height_by_month.length === 12) ? g.height_by_month : new Array(12).fill(1);
  const boxH = habit === 'floating' ? 0.002 : H[1], boxW = habit === 'floating' ? 0.6 : (g.width_m || (ASPECT[habit] || 1) * H[1]) * (woody && habit === 'mat' ? MAT_SPREAD : 1);
  return { id, k, seed: woody ? 500 + WOODY_IDS.indexOf(id) : FORB_IDS.indexOf(id), common: s.common, habit, leaf: g.leaf || { shape: 'linear', size_m: 0.05, rgb: [100, 130, 80] }, flower: g.flower || null,
    fruit: g.fruit || null, hbm, dead: g.dead_rgb || [170, 150, 110], density: g.density ?? 1, classes: s.habitat?.classes || {}, shade: s.habitat?.shade ?? 0.2,
    disturbed: s.habitat?.disturbed ?? 1, boxH, boxW, evergreen: woody || Math.min(...hbm) >= 0.5, woody, area: Math.PI * boxW * boxW * 0.25 * 0.8,
    floating: habit === 'floating', riparian: !!s.habitat?.riparian?.zones };
}
// The library-wide set (as before 2026-11-06): the first GS_MAX forbs. A tile whose mix lists no ground plant of its
// own draws from it (its cells take the records' habitat class weights, or nothing where species_mix.json says
// class_fallback false).
export const FORB_SPECIES = FORB_IDS.slice(0, GS_MAX).map(forbEntry);
// A tile's own set, chosen when it loads: the ground plants of its mix (species_mix.json species.ground and the riparian
// rows' ground), by their share of the tile's cells when more than the atlas holds; where the tile may borrow the
// class weights (class_fallback not false) the library-wide set fills the free slots. In library order, so a tile whose
// own plants are the library-wide set draws exactly what it drew before.
export function forbSet(tile) {
  const SM = tile?.speciesMix, json = SM?.json, score = new Map();
  const canon = id => { const s = SPECIES[id]; return groundPlant(s) ? s.id || id : null; };
  for (const id of json?.species?.ground || []) { const c = canon(id); if (c && !score.has(c)) score.set(c, 0); }
  for (const m of json?.mixes || []) for (const [id, b] of m.ground_bytes || []) { const c = canon(id); if (c) score.set(c, (score.get(c) || 0) + b * (m.cells || 1)); }
  let tot = 0; for (const v of score.values()) tot += v;
  for (const r of SM?.rip?.values() || []) for (const id of Object.keys(r.ground)) { const c = canon(id); if (c) score.set(c, (score.get(c) || 0) + 0.02 * (tot || 1)); }
  // a tile outside the regional tables (class_fallback false, or natural_regions empty: grass.js ownGround) borrows nothing
  if (!score.size) return ownGround(json) ? [] : FORB_SPECIES;
  const ids = [...score.keys()].sort((a, b) => score.get(b) - score.get(a)).slice(0, GS_MAX);
  if (!ownGround(json)) for (const id of FORB_IDS) { if (ids.length >= GS_MAX) break; if (!ids.includes(id)) ids.push(id); }
  const order = id => SPECIES_IDS.indexOf(id);
  return ids.sort((a, b) => order(a) - order(b)).map(forbEntry);
}

// ---- the plant's state in a month ------------------------------------------------------------------------------
// h: its height this month (0..1 of boxH; 0: absent), flowering, dead (dried stalks after flowering: the colour dead_rgb),
// rgb: the leaves' colour in the season (a dwarf shrub's ground.leaf.rgb_by_season: heather bronze in winter), fruiting
// (a dwarf shrub's ground.fruit months: crowberry's black berries from August).
export function forbState(F, month, season = null) {
  const m = Math.min(11, Math.max(0, Math.floor(month - 1))), h = F.hbm[m], prev = F.hbm[(m + 11) % 12], fl = F.flower;
  const inMonths = (a, b, x) => a <= b ? x >= a && x <= b : x >= a || x <= b;
  const flowering = !!fl && inMonths(fl.months[0], fl.months[1], m + 1) && h > 0;
  const afterFlower = fl ? (fl.months[0] <= fl.months[1] ? m + 1 > fl.months[1] : m + 1 > fl.months[1] && m + 1 < fl.months[0]) : false;
  const dead = !F.evergreen && h > 0.15 && afterFlower && h <= prev;
  const rgb = (season && F.leaf.rgb_by_season?.[season]) || F.leaf.rgb, fr = F.fruit;
  const fruiting = !!fr && inMonths(fr.months[0], fr.months[1], m + 1) && h > 0;
  return { h, flowering, dead, rgb, fruiting };
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
  const rnd = mulberry32(1000 + F.seed * 17 + (top ? 7 : 0)), ppm = T / Math.max(F.boxW, F.boxH);   // px per metre, the box fits the tile
  const H = F.boxH * st.h * ppm, W = F.boxW * ppm * Math.min(1, 0.45 + 0.55 * st.h), Lf = Math.max(6, F.leaf.size_m * ppm);
  const leafCol = k => css(st.dead ? F.dead : st.rgb || F.leaf.rgb, k);
  const hb = F.habit, x0 = cx + T / 2, y0 = top ? cy + T / 2 : cy + T - 2;
  const nLeaves = Math.round(Math.min(F.habit === 'erect' ? 120 : 60, 6 + 40 * (W * H) / (Lf * Lf) * 0.5));   // an erect clump: leafy stems
  if (F.floating) {   // a floating mat (duckweed): a ragged disc of tiny fronds, drawn on the water in the ground quad only
    if (!top) { g.restore(); return; }
    const R = T * 0.46, n = 900;
    for (let q = 0; q < n; q++) { const b = rnd() * Math.PI * 2, r = R * Math.sqrt(rnd()) * (0.75 + 0.25 * vnoise(Math.cos(b) * 3, Math.sin(b) * 3, 77)); g.fillStyle = leafCol(0.8 + 0.45 * rnd()); g.beginPath(); g.arc(x0 + Math.cos(b) * r, y0 + Math.sin(b) * r, 2.2 + 1.5 * rnd(), 0, Math.PI * 2); g.fill(); }
    g.restore(); return;
  }
  // a mat's side view fills its box (the quad maps the tile to boxW x boxH: the dome MAT_H of it, flatter than the box),
  // its top view the disc
  if (hb === 'mat') { drawMat(g, F, st, x0, y0, top ? W : T * 2 * MAT_R, top ? H : T * MAT_H * st.h, Lf, ppm, top, rnd, leafCol, top ? 1 : F.boxW / F.boxH); g.restore(); return; }
  if (top) {   // the plant from above: leaves radiating from the centre, the flowers on top
    const R = Math.min(W, T) * 0.5;
    for (let q = 0; q < nLeaves; q++) { const b = rnd() * Math.PI * 2, r = (hb === 'erect' || hb === 'bulb' ? 0.2 : 0.35 + 0.6 * rnd()) * R, L = Lf * (0.7 + 0.6 * rnd());
      leaf(g, F, x0 + Math.cos(b) * r * 0.3, y0 + Math.sin(b) * r * 0.3, b + Math.PI / 2, Math.min(L, R - r * 0.3 + L * 0.2), rnd, leafCol(0.8 + 0.4 * rnd())); }
    if (st.flowering && F.flower) { const n = Math.max(1, Math.round((F.flower.per_plant || 3) * 0.7)), fs = Math.max(5, F.flower.size_m * ppm);
      for (let q = 0; q < n; q++) { const b = rnd() * Math.PI * 2, r = (hb === 'erect' || hb === 'bulb' ? 0.15 : 0.6) * R * rnd(); flower(g, F, x0 + Math.cos(b) * r, y0 + Math.sin(b) * r + fs * 0.3, fs, rnd); } }
    g.restore(); return;
  }
  // stems (erect, bulb, mound: a few; climbing: a tangle)
  const stemCol = st.dead ? css(F.dead, 0.9) : css(F.leaf.rgb, 0.8);
  // an erect forb (2026-11-08): a clump of stems of several heights leaning out from the root (a nettle or mugwort colony
  // is many stems; two upright ones carrying a column of same-size leaves read as beaded sticks on the Merced's bar)
  const nStems = hb === 'rosette' ? 0 : hb === 'climbing' ? 6 : hb === 'bulb' ? 1 : hb === 'erect' ? 3 + Math.min(3, Math.floor(F.boxH / 0.6)) : 4;
  g.strokeStyle = stemCol; g.lineCap = 'round';
  const stems = [];
  for (let q = 0; q < nStems; q++) {
    const sx = x0 + (rnd() - 0.5) * W * (hb === 'erect' ? 0.3 : 0.15);
    const x1 = hb === 'erect' ? sx + (sx - x0) * 0.8 + (rnd() - 0.5) * W * 0.15 : x0 + (rnd() - 0.5) * W * 0.6, lean = (rnd() - 0.5) * W * 0.5;
    const h = hb === 'erect' ? H * (0.55 + 0.45 * rnd()) : H * (0.85 + 0.15 * rnd()), x2 = hb === 'erect' ? x1 + (x1 - x0) * 0.5 + lean * 0.3 : x1 + lean * 0.4;
    stems.push([sx, x1, x2, h]);
    g.lineWidth = Math.max(1, H * 0.012);
    g.beginPath(); g.moveTo(sx, y0); g.quadraticCurveTo(x1, y0 - h * 0.55, x2, y0 - h); g.stroke();
  }
  // leaves: a rosette lies flat and low, a mound fills its dome, an erect stem carries them along it
  const Wb = Math.max(W * 0.2, Math.min(W, T - 1.7 * Lf));
  for (let q = 0; q < nLeaves; q++) {
    const u = rnd(), v = rnd(), L = Lf * (0.7 + 0.6 * rnd());
    let x, y, a;
    // the leaves' bases within Wb, so a long leaf (a sword fern's 0.7 m frond) ends inside the picture rather than cut
    // off square at its edge (2026-11-06)
    if (hb === 'rosette') { x = x0 + (u - 0.5) * Wb; y = y0 - v * Math.min(H, Lf * 0.8); a = (u - 0.5) * 2.2; }
    else if (hb === 'sprawling') { x = x0 + (u - 0.5) * Wb; y = y0 - v * H * 0.8; a = (rnd() - 0.5) * 2.6; }
    else if (hb === 'erect' && stems.length) {   // along a stem's curve, outward and a little down, alternate sides, smaller upward
      const [sx, x1, x2, h] = stems[q % stems.length], t = 0.08 + 0.9 * Math.pow(v, 1.15), m = 1 - t;
      x = m * m * sx + 2 * m * t * x1 + t * t * x2; y = y0 - (2 * m * t * 0.55 + t * t) * h;
      const tx = 2 * m * (x1 - sx) + 2 * t * (x2 - x1), ty = -(2 * m * 0.55 + 2 * t * 0.45) * h, up = Math.atan2(tx, -ty);
      a = up + (q % 2 ? 1 : -1) * (0.9 + 0.5 * rnd()) * (1 - 0.35 * t);
      leaf(g, F, x, y, a, L * (1.6 - 0.95 * t), rnd, leafCol(0.72 + 0.45 * rnd() + 0.1 * t));
      continue;
    }
    else if (hb === 'erect' || hb === 'bulb') { const t = 0.05 + v * 0.7; x = x0 + (u - 0.5) * W * 0.25; y = y0 - H * t; a = (u - 0.5) * 2.0 * (hb === 'bulb' ? 0.4 : 1); if (hb === 'bulb') { y = y0 - v * H * 0.35; } }
    else if (hb === 'climbing') { x = x0 + (u - 0.5) * W; y = y0 - v * H; a = (rnd() - 0.5) * 3; }
    else { const b = (u - 0.5) * Math.PI, r = Math.sqrt(v); x = x0 + Math.sin(b) * r * Wb * 0.5; y = y0 - Math.cos(b) * r * H * 0.85 - H * 0.05; a = b * 0.8; }   // mound
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

// A dwarf shrub's mat (habit 'mat': crowberry, heather): a low dome of wiry shoots densely set with small leaves. From
// the side the dome's outline (a flattened half-ellipse, ragged); from above a disc with a ragged edge, which is what
// makes the carpet. (2026-11-06) Lit as a dome: a dark body inside (no ground shows through the mat's middle), the
// shoots drawn from the inside out, darker deep in the mat and toward its rim and base, brightest over its top; in
// flower, the shoots near the surface carry their flowers along them (heather's racemes of small bells: a purple haze
// over the whole mat, as a heath in August), the berries among them in their months.
// (2026-11-06, iteration 6) A clone's patch rather than a dome: a plateau with rounded shoulders (side view and the top
// quad's lift, MAT_R), the shoots in drifts of older, browner wood and fresher tips (and, in flower, of more and fewer
// flowers), the side view's sprigs drawn for the box's aspect (the quad stretches the tile to boxW x boxH: a sprig drawn
// round came out a smear), and from above a skirt round the disc: the mat's shade and litter on the ground, translucent
// (alpha to coverage), so the ground between overlapping mats takes the carpet's dark tone instead of the photo's.
// `asp`: the side view's px per m up over px per m across (boxW / boxH); 1 from above.
function drawMat(g, F, st, x0, y0, W, H, Lf, ppm, top, rnd, leafCol, asp = 1) {
  // a shoot 3-5 cm (its leaves too small to draw one by one), enough of them to close the mat
  const L = Math.min(14, Math.max(6, Math.max(Lf, 0.035 * ppm))), n = top ? 2600 : 1900, ns = top ? 0 : 14, fine = F.leaf.shape === 'linear' || F.leaf.shape === 'strap';
  const fl = st.flowering && F.flower ? F.flower : null, show = fl ? Math.min(1, fl.size_m / 0.03) : 0, pf = fl ? Math.min(0.95, (fl.per_plant || 12) / 30) * show : 0;   // show: how much of the shoot its flowers cover (crowberry's 4 mm flowers little, heather's 6 cm racemes all)
  g.lineCap = 'round';
  const R = top ? T * MAT_R : 0, rag = rnd() * 10;
  // the top view's edge at angle b: lobed and ragged (a clone spreads unevenly), so a field of them is a mosaic, not dots
  const rim = b => R * (0.72 + 0.28 * smooth(0.2, 0.8, 0.7 * vnoise(Math.cos(b) * 1.6 + rag, Math.sin(b) * 1.6, 91) + 0.3 * vnoise(Math.cos(b) * 5 + rag, Math.sin(b) * 5, 93)));
  const plateau = q => Math.pow(Math.max(0, 1 - q * q * q * q), 0.5);   // the profile at q (0 centre, 1 rim): flat over most of the mat, rounding down at its edge
  const dome = u => H * plateau(2 * Math.abs(u)) * (0.8 + 0.2 * vnoise(u * 7 + rag, 0, 92));   // the side view's top at u (-0.5..0.5 of W)
  // the shoots' colour: the season's leaf, in drifts toward the old wood's (dead_rgb) and toward fresh tips
  const leafRgb = st.dead ? F.dead : st.rgb || F.leaf.rgb, drift = (x, y) => vnoise((x - x0) / 34 + rag, (y - y0) / 34, 95);
  const shoot = (k, x, y) => { const t = drift(x, y), o = 0.32 * smooth(0.45, 0.85, t), f = 0.12 * smooth(0.5, 0.15, t);
    return css(leafRgb.map((c, i) => c * (1 - o) + F.dead[i] * o + (255 - c) * f * 0.25), k); };
  if (top) {   // the skirt: shade and litter on the ground round the mat, fading out by the tile's edge
    const sk = leafRgb.map((c, i) => (c * 0.7 + F.dead[i] * 0.3) * 0.62), grd = g.createRadialGradient(x0, y0, R * 0.6, x0, y0, T * 0.5);
    grd.addColorStop(0, `rgba(${sk.map(v => v | 0).join(',')},0.85)`); grd.addColorStop((R * 1.02 - R * 0.6) / (T * 0.5 - R * 0.6), `rgba(${sk.map(v => v | 0).join(',')},0.7)`);
    grd.addColorStop(1, `rgba(${sk.map(v => v | 0).join(',')},0)`);
    g.fillStyle = grd; g.beginPath();
    for (let q = 0; q <= 64; q++) { const b = q / 64 * Math.PI * 2, r = T * (0.4 + 0.1 * vnoise(Math.cos(b) * 2.5 + rag, Math.sin(b) * 2.5, 94)); q ? g.lineTo(x0 + Math.cos(b) * r, y0 + Math.sin(b) * r) : g.moveTo(x0 + r, y0); }
    g.fill();
  }
  g.fillStyle = leafCol(0.42); g.beginPath();   // the mat's dark inside
  if (top) { for (let q = 0; q <= 64; q++) { const b = q / 64 * Math.PI * 2, r = rim(b) * 0.9; q ? g.lineTo(x0 + Math.cos(b) * r, y0 + Math.sin(b) * r) : g.moveTo(x0 + r, y0); } }
  else { g.moveTo(x0 - W * 0.46, y0); for (let q = 0; q <= 32; q++) { const u = (q / 32 - 0.5) * 0.92; g.lineTo(x0 + u * W, y0 - dome(u) * 0.88); } g.lineTo(x0 + W * 0.46, y0); }
  g.fill();
  if (!top) {   // the woody shoots under the leaves
    g.strokeStyle = css(F.dead, 0.7);
    for (let q = 0; q < ns; q++) { const u = rnd() - 0.5, x1 = x0 + u * W * 0.9, y1 = y0 - H * plateau(2 * Math.abs(u)) * (0.6 + 0.35 * rnd());
      g.lineWidth = Math.max(1, H * 0.015); g.beginPath(); g.moveTo(x0 + u * W * 0.3, y0); g.quadraticCurveTo(x0 + u * W * 0.7, y0 - H * 0.15, x1, y1); g.stroke(); }
  }
  // the shoots: place them, then draw the deep ones first
  const S = [];
  for (let q = 0; q < n; q++) {
    let x, y, d, lit;   // d: depth into the mat (0 its surface, 1 deep inside); lit: the dome's light there (its top 1)
    if (top) { const b = rnd() * Math.PI * 2, e = rim(b), rr = Math.sqrt(rnd()); x = x0 + Math.cos(b) * rr * e; y = y0 + Math.sin(b) * rr * e; d = Math.pow(rnd(), 1.5); lit = 1 - 0.3 * Math.pow(rr, 4); }
    else { const u = rnd() - 0.5, v = Math.pow(rnd(), 0.4); x = x0 + u * W; y = y0 - v * dome(u); d = 1 - v; lit = 0.55 + 0.45 * v * (1 - 0.6 * Math.pow(2 * u, 4)); }
    S.push([d, x, y, lit]);
  }
  S.sort((p, q) => q[0] - p[0]);
  for (const [d, x, y, lit] of S) {
    const k = (0.5 + 0.6 * (1 - d)) * lit * (0.82 + 0.36 * rnd());
    const a = (rnd() - 0.5) * (top ? Math.PI * 2 : 1.8), l = L * (0.7 + 0.6 * rnd()), col = shoot(Math.max(0.28, k), x, y);
    const dx = Math.sin(a) * l, dy = -Math.cos(a) * l * asp;   // the sprig as it will look once the quad maps the tile to the box
    if (fine) { g.strokeStyle = col; g.lineWidth = Math.max(1.6, l * 0.32); g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y + dy); g.stroke(); }   // a needle-leaved shoot: a short thick sprig
    else leaf(g, F, x, y, a, l, rnd, col);
    if (fl && d < 0.7 && rnd() < pf * (0.35 + 1.1 * smooth(0.25, 0.75, vnoise((x - x0) / 46 + rag, (y - y0) / 46, 96)))) {   // its flowers along it, in drifts
      const m = Math.round((2 + 7 * show) * (0.6 + 0.8 * rnd())), r0 = Math.max(0.9, Math.min(3, fl.size_m * ppm * 0.1));
      for (let q = 0; q < m; q++) { const t = 0.3 + 0.7 * q / m; g.fillStyle = css(fl.rgb, (0.75 + 0.4 * rnd()) * Math.min(1.1, 0.6 + 0.5 * lit));
        g.beginPath(); g.ellipse(x + dx * t + (rnd() - 0.5) * 2, y + dy * t + (rnd() - 0.5) * 2 * asp, r0 * (0.8 + 0.4 * rnd()), r0 * (0.8 + 0.4 * rnd()) * Math.min(asp, 3), 0, 0, Math.PI * 2); g.fill(); }
    }
  }
  if (st.fruiting && F.fruit) {
    const fr = F.fruit, r0 = Math.max(2, fr.size_m * ppm * 0.6); g.fillStyle = css(fr.rgb);
    for (let q = 0; q < (fr.per_plant || 20); q++) {
      let x, y; if (top) { const b = rnd() * Math.PI * 2, r = R * 0.85 * Math.sqrt(rnd()); x = x0 + Math.cos(b) * r; y = y0 + Math.sin(b) * r; }
      else { const u = (rnd() - 0.5) * 0.85; x = x0 + u * W; y = y0 - dome(u) * (0.75 + 0.25 * rnd()); }
      g.beginPath(); g.ellipse(x, y, r0, r0 * Math.min(asp, 3), 0, 0, Math.PI * 2); g.fill();
    }
  }
}

// The mean albedo (linear) of the opaque texels of the atlas tile at (x, y), what the far colour match divides by, and
// the share of the tile they cover (a mat's top view: its area, which the carpet's count is made from). The mat proper:
// its translucent skirt (alpha under 0.8) is ground, not mat.
function meanAlbedo(g, x, y) {
  const d = g.getImageData(x, y, T, T).data, lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }, m = [0, 0, 0];
  let w = 0; for (let o = 0; o < d.length; o += 16) if (d[o + 3] > 200) { m[0] += lin(d[o]); m[1] += lin(d[o + 1]); m[2] += lin(d[o + 2]); w++; }
  return { mean: w ? new THREE.Vector3(m[0] / w, m[1] / w, m[2] / w) : new THREE.Vector3(0.05, 0.08, 0.04), share: w / (d.length / 16) };
}

// ---- GLSL --------------------------------------------------------------------------------------------------------
const VERT = /* glsl */`
  ${WIND_GLSL}
  ${GROUND_GLSL}
  ${ATMOSPHERE_GLSL}
  uniform vec2 fade; uniform vec2 carpetFade; uniform float carpetKmin; uniform vec2 kParams; uniform vec4 spBox[${GS_MAX}];   // per species: box w, box h, height this month (0..1), top quad lift
  uniform vec3 spMean[${GS_MAX}];   // per species: its top view's mean albedo this month (linear; the carpet's colour match)
  uniform float forbOn;
  uniform vec4 glow; uniform float glowSp[${GS_MAX}];   // the forager's food (forage.js): the body x z, its radius, the gain; each species' weight this season (0: not food)
  attribute vec4 iPos; attribute vec4 iVar; attribute vec2 iSlope;   // root x y z, scale | species, seed, yaw, rank | the ground's slope dy/dx, dy/dz
  attribute float aQuad;   // 0, 1: the crossed uprights; 2: the one on the ground
  varying vec2 vUv; varying vec3 vSun; varying vec3 vAmb; varying vec3 vT; varying vec3 vIn; varying float vFade; varying float vDiff; varying float vGlow; varying vec3 vTint;
  varying float vSkirt;   // a mat's skirt shows where the carpet closes (its cover there, the integer part of iVar.y / 32)
  float h11(float n) { return fract(sin(n) * 43758.5453123); }
  void main() {
    int sp = int(iVar.x + 0.5); vec4 B = spBox[sp];
    float d = distance(cameraPosition, iPos.xyz);
    float mat = step(1.5, iVar.w);   // a dwarf shrub of the carpet (rank + 2): its survivors grow to keep the cover
    float keep = clamp(kParams.x * kParams.x / max(d * d, 1.0), mat > 0.5 ? carpetKmin : kParams.y, 1.0);
    vec2 fd = mat > 0.5 ? carpetFade : fade;   // the carpet reaches farther (carpetRange)
    float s = step(iVar.w - 2.0 * mat, keep) * (1.0 - smoothstep(fd.x, fd.y, d)) * forbOn;
    if (s < 0.01 || B.z <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    // out of view: the plant's bounding sphere outside a side plane of the frustum, before the costly part (the mesh is
    // not frustum culled: the carpet stages every mat round the camera, a quarter or less of them in view)
    {
      float rad = 0.6 * max(B.x * iPos.w * mix(1.0, inversesqrt(keep), mat), B.y * iPos.w) + 0.3;
      vec4 v = viewMatrix * vec4(iPos.xyz + vec3(0.0, 0.3 * B.y * iPos.w, 0.0), 1.0);
      float w = -v.z, P0 = projectionMatrix[0][0], P1 = projectionMatrix[1][1];
      if (w < -rad || P0 * abs(v.x) - w > rad * sqrt(P0 * P0 + 1.0) || P1 * abs(v.y) - w > rad * sqrt(P1 * P1 + 1.0)) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    }
    float gd = distance(iPos.xz, glow.xy);   // the glow: the species' weight, the gain, fading with the distance from the body, a boost for the nearest few
    vGlow = glowSp[sp] * glow.w * pow(clamp(1.0 - gd / max(glow.z, 0.01), 0.0, 1.0), 1.2) * (1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.15 * glow.z, gd)));
    float sc = iPos.w * mix(1.0, inversesqrt(keep), mat), scY = mat > 0.5 ? pow(iPos.w, ${MAT_UP.toFixed(2)}) : iPos.w, yaw = iVar.z + aQuad * 1.5707963;   // a mat grows across, hardly up (MAT_UP)
    float c = cos(yaw), sn = sin(yaw);
    vec3 p;
    if (aQuad < 1.5) {   // upright: x across, y up; the picture's box is B.x wide, B.y tall (the plant B.z of it this month)
      vec2 q = vec2(position.x * B.x * sc, uv.y * B.y * scY);
      p = iPos.xyz + vec3(q.x * c, q.y + dot(vec2(q.x * c, -q.x * sn), iSlope), -q.x * sn);   // sheared to the ground's slope
      float t = uv.y;
      p.xz += windDir * windStrength * gust(iPos.xz) * t * t * 0.18 * B.y * scY;
    } else {   // on the ground, a little above it so it does not z-fight, the size of the top view (none for a tall rosette)
      vec2 q = vec2(position.x, position.y) * B.x * sc * (B.w < 0.0 ? 0.0 : 1.0), o = vec2(q.x * c - q.y * sn, -(q.x * sn + q.y * c));
      float qq = dot(position.xy, position.xy) / ${(MAT_R * MAT_R).toFixed(4)};   // (the radius over the mat's, MAT_R)^2
      float lift = mat > 0.5 ? mix(0.02, B.w, sqrt(max(1.0 - qq * qq, 0.0))) * scY : max(B.w, 0.0);   // a mat's plateau: B.w over most of it, down to the ground at its rim and under its skirt
      p = iPos.xyz + vec3(o.x, lift + dot(o, iSlope), o.y);   // on the ground's slope
    }
    // species k's pictures are the canvas's k-th row of tiles from the top; the CanvasTexture is flipped (flipY), so
    // that row is v (GS_MAX - 1 - k) / GS_MAX up (2026-11-06: (uv.y + k) / GS_MAX showed species k the picture of
    // species GS_MAX - 1 - k, and the first three slots an empty tile)
    vUv = vec2((uv.x + (aQuad > 1.5 ? 1.0 : 0.0)) * 0.5, (uv.y + float(${GS_MAX - 1} - sp)) / ${GS_MAX}.0);
    vFade = s;
    // The carpet's colour (2026-11-06): the ground texture under the mat (the photo at 2.5 m: the heath's measured mean,
    // mats and the ground between them, in the date's season) sets it. Near, the mat's own picture with its mean taken
    // halfway (geometrically) to the photo's, and a shade of its own (a clone's), so the species' colours, heather's
    // flowers and crowberry's dark leaves, stay, but no mat is darker or brighter than the place measured allows; toward
    // the fade all the way, so it hands over to the ground texture without an edge.
    vTint = vec3(1.0); vSkirt = 1.0;
    if (mat > 0.5) {
      vSkirt = aQuad > 1.5 ? smoothstep(0.55, 0.9, floor(iVar.y) / 32.0) : 1.0;
      vec3 gw; vec3 g = groundAlbedo(iPos.xyz, 1.0, gw);
      vec3 r = clamp(g / max(spMean[sp] * groundGain, vec3(1e-3)), vec3(0.25), vec3(4.0));   // the picture at the ground's reflectance (FRAG)
      float hv = h11(iVar.y * 517.3 + 3.1), hw = h11(iVar.y * 91.7 + 7.3) - 0.5;   // a clone's own shade, and its own warmth (browner or greener)
      vec3 own = sqrt(r) * mix(vec3(0.86, 0.9, 0.86), vec3(1.12, 1.08, 1.1), hv) * vec3(1.0 + 0.14 * hw, 1.0, 1.0 - 0.14 * hw);
      vTint = mix(own, r, smoothstep(0.45 * fd.x, fd.x, d));
    }
    // Light as the grass cards take it: sun on a surface facing the camera, bent to the ground normal; sky and
    // ground ambient with the canopy's occlusion and the near trees' contact AO; cloud shadow; the atmosphere.
    vec3 V = normalize(cameraPosition - iPos.xyz);
    vec3 Nb = aQuad > 1.5 ? normalize(vec3(-iSlope.x, 1.0, -iSlope.y)) : normalize(vec3(V.x, 0.0, V.z) + vec3(1e-4, 0.0, 0.0));
    vDiff = max(dot(normalize(Nb + vec3(0.0, 1.0, 0.0)), sunDir), 0.0);
    vSun = sunLight * cloudShadow(iPos.xyz);
    float occ = groundSkyOcclusion(groundUv(iPos.xyz)) * groundContactAO(iPos.xyz);
    vAmb = mix(ambientGround, ambientSky, 0.55) * occ;
    vIn = atmosphereApply(vec3(0.0), iPos.xyz, cameraPosition);
    vT = atmosphereApply(vec3(1.0), iPos.xyz, cameraPosition) - vIn;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform sampler2D atlas; uniform vec3 wxGround; uniform vec3 glowCol; uniform vec3 groundGain; uniform float groundSat;
  varying vec2 vUv; varying vec3 vSun; varying vec3 vAmb; varying vec3 vT; varying vec3 vIn; varying float vFade; varying float vDiff; varying float vGlow; varying vec3 vTint;
  varying float vSkirt;
  void main() {
    if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vFade) discard;
    vec4 t = texture2D(atlas, vUv);
    if (t.a < 0.8) t.a *= vSkirt;   // a mat's skirt (translucent, round its disc) only where the carpet closes: elsewhere the ground is the gaps' own
    if (t.a < 0.3) discard;
    // the pictures were drawn to match the photo's display colour: at the ground's reflectance they take its factor
    // (terrain.js groundGain, as the grass palettes do)
    vec3 alb = t.rgb * vTint * groundGain; alb = max(mix(vec3(dot(alb, vec3(0.299, 0.587, 0.114))), alb, groundSat), vec3(0.0));   // terrain.js groundRefl   // the atlas is an sRGB texture, decoded to linear by the sampler (2026-11-06: a pow 2.2 on top decoded it twice, and a leaf of sRGB 64 came out black)
    alb = mix(alb, vec3(0.7, 0.73, 0.78), wxGround.z * 0.6);   // lying snow (weather.js)
    vec3 col = (alb * (vSun * (0.4 + 0.6 * vDiff) + vAmb) + alb * alb * vSun * 0.15) * 0.3183099;
    // the forager's glow (forage.js): the plant lit warm against the light of the hour, by the leaf's own tone and its
    // texel's alpha, so the picture's structure stays under the light and the mip-averaged haze of a dense card a few
    // metres off is lit less than its leaves (a halo from the alpha skirt under the cut, and a glow strongest at the
    // soft edges, were tried first: both lit that haze into a yellow block)
    if (vGlow > 0.0) col += glowCol * vGlow * dot(vSun * 0.5 + vAmb * 1.5, vec3(0.3333)) * 0.3183099 * 0.6 * (0.35 + 0.65 * smoothstep(0.3, 0.8, t.a)) * (0.4 + 0.6 * min(1.0, dot(alb / max(groundGain, vec3(0.05)), vec3(0.3333)) / 0.2));   // the leaf's tone as drawn
    gl_FragColor = vec4(col * vT + vIn, t.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// A cell's instances and their bounds (a sphere for culling), as herbData and matData return them.
function bounds(arr, ks, i, j) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let o = 0; o < arr.length; o += STRIDE) { x0 = Math.min(x0, arr[o]); x1 = Math.max(x1, arr[o]); y0 = Math.min(y0, arr[o + 1]); y1 = Math.max(y1, arr[o + 1]); z0 = Math.min(z0, arr[o + 2]); z1 = Math.max(z1, arr[o + 2]); }
  return arr.length ? { arr, ks, i, j, x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 0.5, z: (z0 + z1) / 2, r: Math.hypot((x1 - x0) / 2 + 1, (y1 - y0) / 2 + 1, (z1 - z0) / 2 + 1) } : { arr, ks, x: 0, y: 0, z: 0, r: 0 };
}

export class Forbs {
  constructor(tile, scene, grass) {
    this.tile = tile; this.scene = scene; this.grass = grass;
    this.species = forbSet(tile);   // the tile's own ground plants (forbSet), slot k = species[k].k
    this.cache = new Map(); this.last = null; this.month = -1; this.season = 'summer'; this.states = [];
    this.uniforms = { ...windUniforms, ...groundUniforms, ...atmo, atlas: { value: null }, fade: { value: new THREE.Vector2(...FADE) }, carpetFade: { value: new THREE.Vector2(0.8 * CARPET_R, CARPET_R) }, carpetKmin: { value: KMIN_C },
      spMean: { value: Array.from({ length: GS_MAX }, () => new THREE.Vector3(0.05, 0.08, 0.04)) },
      kParams: { value: new THREE.Vector2(D0, KMIN) }, spBox: { value: Array.from({ length: GS_MAX }, (_, k) => { const F = this.species[k]; return F ? new THREE.Vector4(F.boxW, F.boxH, 0, 0.03) : new THREE.Vector4(); }) },
      forbOn: { value: 1 },
      glow: { value: new THREE.Vector4(0, 0, 1, 0) }, glowSp: { value: new Float32Array(GS_MAX) }, glowCol: { value: new THREE.Color(1, 0.76, 0.34) } };   // the forager's food (forage.js writes them)
    // geometry: two crossed upright quads (x across, uv.y up) and one on the ground, 4 + 4 + 25 vertices: the ground one a
    // centre, two rings of 8 (at 0.6 and 1.0 of the mat's radius MAT_R) and the square's 8 edge points, so a mat's top view
    // is its plateau (the side view's profile, which the uprights stay inside), at its height over most of the mat and
    // meeting the ground at its rim, its skirt on the ground (2026-11-06: lifted flat, the mats read as rugs floating over
    // the slope; iteration 6: rings instead of a 5 x 5 grid, which could not hold a plateau's edge). The herbs' stays flat
    // (every vertex in the one plane, so their pictures map exactly as on the square before)
    const g = new THREE.InstancedBufferGeometry(), pos = [], uv = [], quad = [], idx = [];
    for (let q = 0; q < 2; q++) {
      const b = pos.length / 3;
      pos.push(-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0); uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      quad.push(q, q, q, q); idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    { const b = pos.length / 3, P = (x, y) => { pos.push(x, y, 0); uv.push(x + 0.5, y + 0.5); quad.push(2); };
      P(0, 0);
      for (const rr of [0.6 * MAT_R, MAT_R]) for (let k = 0; k < 8; k++) P(rr * Math.cos(k * Math.PI / 4), rr * Math.sin(k * Math.PI / 4));
      for (let k = 0; k < 8; k++) { const c = Math.cos(k * Math.PI / 4), sn = Math.sin(k * Math.PI / 4), m = 0.5 / Math.max(Math.abs(c), Math.abs(sn)); P(c * m, sn * m); }   // the square's mid-edges and corners
      for (let k = 0; k < 8; k++) { const k1 = (k + 1) % 8; idx.push(b, b + 1 + k, b + 1 + k1);
        for (const o of [1, 9]) idx.push(b + o + k, b + o + 8 + k, b + o + 8 + k1, b + o + k, b + o + 8 + k1, b + o + k1); } }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aQuad', new THREE.Float32BufferAttribute(quad, 1)); g.setIndex(idx);
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(CAP * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buf, 4, 0)); g.setAttribute('iVar', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    g.setAttribute('iSlope', new THREE.InterleavedBufferAttribute(this.buf, 2, 8));
    g.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.DoubleSide, alphaToCoverage: true });
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.name = 'forbs'; this.mesh.renderOrder = 2;
    this.group = new THREE.Group(); this.group.name = 'forbs'; this.group.add(this.mesh); scene.add(this.group);
    this.n = 0; this.staged = []; this.on = true; this._sl = [0, 0];
    this.gone = null;   // the plants pulled down from below (dig.js: the world's pulls, by id `f:<i>.<j>.<k>`): not drawn
    this.buildDensity();
    this.mixCache = new Map(); this.noFallback = ownGround(this.tile?.speciesMix?.json);   // 2026-11-06 (iteration 7): natural_regions empty too
    // the dwarf-shrub carpet (2026-11-06): a row's carpet density (species_mix.json mixes[].density_bytes[2] / 100: the
    // dwarf shrubs' share of the community's shrubs) times the cell's shrub cover (canopy.png G) is the carpet's cover
    this.carpetRow = new Map();
    for (const m of this.tile?.speciesMix?.json?.mixes || []) { const c = (m.density_bytes?.[2] || 0) / 100; if (c > 0) this.carpetRow.set(m.index, c); }
    this.hasCarpet = this.carpetRow.size > 0 && this.species.some(F => F.woody);
  }
  // Forb density per cell: the herb cover (floored at 0.3, as the grass takes it) times the habitat class's share.
  buildDensity() {
    const hab = this.tile.habitat, can = this.tile.canopy, W = hab.img.width, H = hab.img.height;
    this.W = W; this.Hh = H; this.dens = new Float32Array(W * H); this.cover = new Float32Array(W * H); this.shrub = new Float32Array(W * H);
    // A shrubland whose community description gives its herb cover (species_mix.json mixes[].herb_cover, 2026-11-06, iteration
    // 8): its herbs grow on the ground the shrubs leave open at that cover over the open share, as grass.js takes it, so the
    // forbs between the shrubs are a grassland's (Lamar's montane sagebrush steppe: 0.98, was 0.35 x 0.65).
    const SM = this.tile.speciesMix, mixRows = new Map((SM?.json?.mixes || []).map(m => [m.index, m]));
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const cls = hab.channel(i, j, 0), hc = cls === 4 ? mixRows.get(SM?.at(i, j)?.index)?.herb_cover : null, s = can.channel(i, j, 1) / 100;
      const k = j * W + i, h = hc ? Math.min(1, (hc[0] + hc[1]) / 2 / Math.max(0.15, 1 - s)) : Math.min(Math.max(can.channel(i, j, 2) / 100, 0.3), 1), hb = (hc ? HABITAT[5] : HABITAT[cls]) || 0;
      this.dens[k] = hb * (0.5 + 0.5 * h); this.cover[k] = can.channel(i, j, 0) / 100; this.shrub[k] = s;
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
    for (const F of this.species) {
      const st = this.states[F.k]; if (!st || st.h <= 0 || F.woody) continue;   // the dwarf shrubs: carpetMix
      // a tile built outside the regional tables (species_mix.json class_fallback false) never borrows the class weights,
      // which are California's forbs (world pipeline phase 1: filaree rosettes lying flat on the Serengeti and at Lofoten)
      let w = fromRow ? row.ground[F.id] || 0 : this.noFallback ? 0 : (F.classes[cls] || 0) * F.density;
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
    for (const F of this.species) {
      const st = this.states[F.k]; if (!st || st.h <= 0) continue;
      const w = (row.ground[F.id] || 0) * F.density; if (w <= 0) continue;
      acc += w; cum.push([F.k, acc]);
    }
    m = { cum, total: acc }; this.mixCache.set(key, m); return m;
  }
  // The dwarf shrubs of a mix row this month (the carpet's species), as speciesMix's cum; cached per row and month.
  carpetMix(row) {
    const key = 'mat:' + row.index; let m = this.mixCache.get(key); if (m) return m;
    const cum = []; let acc = 0;
    for (const F of this.species) {
      if (!F.woody) continue;
      const st = this.states[F.k]; if (!st || st.h <= 0) continue;
      const w = (row.ground[F.id] || 0) * F.density; if (w <= 0) continue;
      acc += w; cum.push([F.k, acc]);
    }
    m = { cum, total: acc }; this.mixCache.set(key, m); return m;
  }
  // The ground's slope at a plant (scene x and z: dy/dx, dy/dz), clamped to 1.5 (56 degrees), so the ground quad (the
  // top view: a rosette, a mat) lies on the slope instead of cutting into it uphill and floating downhill.
  slope(px, pn, y) {
    const e = 0.6, gx = (this.grass.ground(px + e, pn) - y) / e, gn = (this.grass.ground(px, pn + e) - y) / e, m = Math.hypot(gx, gn), k = m > 1.5 ? 1.5 / m : 1;
    this._sl[0] = gx * k; this._sl[1] = -gn * k; return this._sl;
  }
  // The plants of cell (i, j): a Float32Array of instances (STRIDE each), in rank order, and the cell's bounds.
  // Every plant of cell (i, j), the herbs and the whole carpet (dig.js's roots, plantsIn): one record as herbData's.
  cellData(i, j) {
    const h = this.herbData(i, j), m = this.matData(i, j, 1);
    if (!m.arr.length) return h;
    if (!h.arr.length) return m;
    const arr = new Float32Array(h.arr.length + m.arr.length); arr.set(h.arr); arr.set(m.arr, h.arr.length);
    return { arr, ks: [...h.ks, ...m.ks], i, j, x: h.x, y: h.y, z: h.z, r: Math.max(h.r, m.r) };
  }
  // The herbs of cell (i, j): a Float32Array of instances (STRIDE each), in rank order, and the cell's bounds; cached.
  herbData(i, j) {
    const key = j * this.W + i;
    let c = this.cache.get(key); if (c) return c;
    const { habitat: hab, size, roads, waterMask: wm, water: WG, speciesMix: SM } = this.tile, res = hab.res, out = [], ks = [], gone = this.gone;
    const cellMix = this.speciesMix(i, j), N = Math.round(res * res * FORB_PER_M2);
    const ripCell = WG && SM?.rip?.size && WG.cellShare(i, j, res).some(v => v > 0);   // any riparian zone in the cell
    if (cellMix.total > 0 || ripCell) for (let k = 0; k < N; k++) {
      if (gone?.has(`f:${i}.${j}.${k}`)) continue;
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
      const F = this.species[sp];
      if (wm && waterAt(wm, px, pn) === 255 && !(F.floating || F.riparian)) continue;
      if (F.floating && floatY === null) continue;
      const patch = 0.12 + 0.88 * smooth(0.38, 0.72, 0.65 * vnoise(px / 13, pn / 13, 400 + F.seed) + 0.35 * vnoise(px / 4.5, pn / 4.5, 500 + F.seed));
      const bare = 0.35 + 0.65 * smooth(0.25, 0.45, bareField(px, pn)), verge = rw > 0 ? Math.min(1, 0.5 * F.disturbed) : 1;
      if (U[3] >= dens * patch * bare * verge * 0.9) continue;
      const sc = (0.75 + 0.5 * U[4]) * (0.8 + 0.3 * dens);
      const y = floatY !== null ? floatY + 0.01 : this.grass.ground(px, pn), sl = floatY !== null ? [0, 0] : this.slope(px, pn, y);
      out.push(px, y, -pn, sc, sp, U[5], U[6] * Math.PI * 2, (k + 0.5) / N, sl[0], sl[1]); ks.push(k);
    }
    c = bounds(new Float32Array(out), ks, i, j);
    if (this.cache.size > 1200) this.cache.clear();
    this.cache.set(key, c); return c;
  }
  // The carpet's mats of cell (i, j) whose rank is under kmax (0..1): a prefix of the cell's mats in rank order (a pure
  // function of the cell, so a longer prefix starts with the shorter one); cached with the rank it reaches, and made
  // again, longer, when a nearer view needs more of it. A far cell is a few per cent of the work of a near one.
  matData(i, j, kmax) {
    const key = j * this.W + i;
    let c = this.cache.get(-1 - key); if (c && c.kmax >= Math.min(kmax, 1)) return c;   // the mats share the herbs' cache (dig.js clears it), keyed -1 - cell
    kmax = Math.min(1, Math.max(kmax, c ? Math.min(1, c.kmax * 2) : 0));
    const { habitat: hab, size, roads, waterMask: wm, water: WG, speciesMix: SM } = this.tile, res = hab.res, out = [], ks = [], gone = this.gone;
    const N = Math.round(res * res * FORB_PER_M2);   // the herbs' candidates come first in the cell's numbering
    // The dwarf-shrub carpet (a heath: crowberry and heather): candidates N.. N + NC - 1 of the cell, drawn from the
    // row's dwarf shrubs (carpetMix), each kept so the mats cover the carpet's share here: for a cover c the mats of
    // area A (their top view) need -ln(1 - c) / A per m^2 (laid at random). The share is the cell's (cov) on average,
    // laid as a heath's mosaic (2026-11-06; the even scatter read as dots from the air): a field over 5-16 m takes it
    // from nearly closed carpet, where the mats merge, to open gaps, by up to 0.9 x the nearer of cov and 1 - cov either
    // way, and the mats are larger where it is closed (old clones; 0.8-1.4 x). Each species in its own drifts. None
    // in a channel, a pond or its mud, half on a margin or a verge, none on pavement or water, thinned on outcrops.
    // Their rank + 2 marks them for the shader (the survivors of the distance thinning grow to keep the cover).
    // (2026-11-06, iteration 6) Their places follow the R2 sequence from a point of the cell's own (Roberts 2018: every
    // prefix of it spread evenly), not independent draws: at random the mats of a closed patch left a twentieth of it
    // open in holes, and the distance thinning (a prefix by rank) kept clumps; evenly spread they close it and thin evenly.
    const crow = this.hasCarpet && SM ? SM.at(i, j) : null, cden = crow ? this.carpetRow.get(crow.index) || 0 : 0;
    const cm = cden > 0 ? this.carpetMix(crow) : null, cov = cm?.total > 0 ? Math.min(CARPET_MAX, cden * this.shrub[j * this.W + i]) : 0;
    if (cov > 0.005) {
      const NC = Math.round(res * res * CARPET_PER_M2), spread = 0.9 * Math.min(cov, 1 - cov), wts = cm.cum.map(([kk, a], q) => [kk, a - (q ? cm.cum[q - 1][1] : 0)]);
      draw(i, j, N - 1); const a0 = U[6], b0 = U[7];   // the cell's start in the sequence
      for (let q = 0, qn = Math.min(NC, Math.ceil(kmax * NC)); q < qn; q++) {
        const k = N + q; if (gone?.has(`f:${i}.${j}.${k}`)) continue;
        draw(i, j, k);
        const px = (i + (a0 + q * R2A) % 1) * res, pn = size - (j + (b0 + q * R2B) % 1) * res;
        const sf = smooth(0.3, 0.7, 0.65 * vnoise(px / 16, pn / 16, 600) + 0.35 * vnoise(px / 5, pn / 5, 601));
        const c = Math.min(CARPET_MAX, Math.max(0.02, cov + spread * (2 * sf - 1)));
        let sp = wts[0][0];   // the species, each weighted by its own drifts here
        if (wts.length > 1) {
          let tot = 0; const w = wts.map(([kk, wt]) => { const F = this.species[kk], v = wt * (0.35 + 1.3 * smooth(0.3, 0.7, 0.65 * vnoise(px / 9, pn / 9, 400 + F.seed) + 0.35 * vnoise(px / 3.5, pn / 3.5, 500 + F.seed))); tot += v; return v; });
          let r = U[2] * tot; for (let m = 0; m < w.length; m++) { sp = wts[m][0]; r -= w[m]; if (r <= 0) break; }
        }
        const F = this.species[sp], sc = (0.8 + 0.4 * U[4]) * (0.8 + 0.6 * sf);
        if (U[3] >= -Math.log(1 - c) / (F.area * sc * sc * CARPET_PER_M2)) continue;
        const rw = roads ? roads.at(px, pn) : 0; if (rw > 140) continue;
        let keep = rockKeep(this.tile, px, pn) * (rw > 0 ? 0.5 : 1);
        if (WG) { const z = WG.info(px, pn).zone; if (z === 1 || z === 5 || z === 6) continue; if (z === 2) keep *= 0.5; }
        if (U[7] >= keep || (wm && waterAt(wm, px, pn) === 255)) continue;
        const y = this.grass.ground(px, pn), sl = this.slope(px, pn, y);
        out.push(px, y, -pn, sc, sp, Math.round(32 * c) + U[5], U[6] * Math.PI * 2, 2 + (q + 0.5) / NC, sl[0], sl[1]); ks.push(k);   // the cover here in 32nds, and its seed
      }
    }
    c = bounds(new Float32Array(out), ks, i, j); c.kmax = kmax;
    if (this.cache.size > 1200) this.cache.clear();
    this.cache.set(-1 - key, c); return c;
  }
  // The atlas for the month: every species' side and top view (drawTile), 2 x this.species tiles of T px.
  bake(month) {
    this.month = month; this.states = this.species.map(F => forbState(F, month, this.season));
    const c = this.canvas || (this.canvas = document.createElement('canvas')); c.width = 2 * T; c.height = GS_MAX * T;
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    this.species.forEach(F => { const st = this.states[F.k]; drawTile(g, F, st, 0, F.k * T, false); drawTile(g, F, st, T, F.k * T, true);
      this.uniforms.spBox.value[F.k].set(F.boxW, F.boxH, st.h, F.woody ? TOP_LIFT * MAT_H * F.boxH * st.h : F.habit === 'rosette' && F.boxH > TALL_ROSETTE ? -1 : 0.03);   // a mat's top view: its centre near the top of its dome
      if (F.woody) { const a = meanAlbedo(g, T, F.k * T); this.uniforms.spMean.value[F.k].copy(a.mean); if (st.h > 0) F.area = F.boxW * F.boxW * Math.max(0.2, a.share); } });
    if (!this.atlas) { this.atlas = new THREE.CanvasTexture(c); this.atlas.colorSpace = THREE.SRGBColorSpace; this.atlas.generateMipmaps = true; this.atlas.minFilter = THREE.LinearMipmapLinearFilter; this.atlas.anisotropy = 4; this.uniforms.atlas.value = this.atlas; }
    this.atlas.needsUpdate = true;
    this.cache.clear(); this.mixCache.clear(); this.last = null;
  }
  setLook(look) {
    // the month of the day shown (a fixed date: ?date=08-25 is heather in flower), else of today or the season's middle
    const season = Object.keys(SEASON_LOOK).find(k => SEASON_LOOK[k] === look) || 'summer', month = seasonMonth(season, seasonState.date || undefined);
    if (Math.abs(month - this.month) > 0.6 || season !== this.season) { this.season = season; this.bake(month); }
  }
  // Stage the cells around (x, north) into the buffer (the shader thins and fades): their herbs within FORB_R + REFILL
  // (while the camera is low enough to see them), and the carpet's mats out to its reach for the camera's height agl
  // (carpetRange) + REFILL, of each cell only the ranks the shader can keep at its nearest point before the next refill
  // (keepAt), so the far ring stages a few per cent of its mats.
  fill(x, north, agl) {
    const res = this.tile.habitat.res, size = this.tile.size, half = res * 0.71, buf = this.buf.array;
    const placeF = agl < FORB_R + 20 ? FORB_R + REFILL + 1 : -Infinity, R = this.hasCarpet ? carpetRange(agl) : 0;
    const placeC = R ? Math.sqrt(Math.max(0, R * R - Math.max(0, agl - 40) ** 2)) + REFILL + 1 : -Infinity, place = Math.max(placeF, placeC, 0);
    let n = 0; this.staged.length = 0; this.range = R;
    const i0 = Math.max(0, Math.floor((x - place) / res)), i1 = Math.min(this.W - 1, Math.floor((x + place) / res));
    const j0 = Math.max(0, Math.floor((size - north - place) / res)), j1 = Math.min(this.Hh - 1, Math.floor((size - north + place) / res));
    const put = (a, from, count, c) => { buf.set(a.subarray(from * STRIDE, (from + count) * STRIDE), n * STRIDE); this.staged.push({ start: n, count, x: c.x, y: c.y, z: c.z, r: c.r, arr: a }); n += count; };
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * res, cn = size - (j + 0.5) * res, dc = Math.hypot(cx - x, cn - north); if (dc > place + half) continue;
      if (dc <= placeF + half) { const h = this.herbData(i, j), m = h.arr.length / STRIDE; if (m && n + m <= CAP) put(h.arr, 0, m, h); }
      if (dc <= placeC + half) {   // the mats whose rank the shader keeps somewhere in the cell (ranks ascend)
        const kmax = 2 + keepAt(Math.hypot(Math.max(0, dc - half - REFILL), Math.max(0, agl - 40)), KMIN_C), c = this.matData(i, j, kmax - 2), a = c.arr;
        let lo = 0, hi = a.length / STRIDE; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid * STRIDE + 7] < kmax) lo = mid + 1; else hi = mid; }
        if (lo && n + lo <= CAP) put(a, 0, lo, c);
      }
    }
    this.n = n; this.mesh.geometry.instanceCount = n;
    this.buf.clearUpdateRanges(); this.buf.addUpdateRange(0, Math.max(n, 1) * STRIDE); this.buf.needsUpdate = true;
  }
  update(camera, look) {
    if (look) this.setLook(look);
    if (!this.atlas) return;
    const cp = camera.position, north = -cp.z, agl = cp.y - this.grass.ground(cp.x, north);
    const on = this.on && (agl < FORB_R + 20 || (this.hasCarpet && agl < CARPET_FAR - 30));
    this.uniforms.forbOn.value = on ? 1 : 0;
    if (!on) { this.mesh.visible = false; return; }
    const R = this.hasCarpet ? carpetRange(agl) : 0; this.uniforms.carpetFade.value.set(0.8 * R, R);
    // refill after REFILL m, or when the carpet's reach has moved a tenth (climbing or descending), or the herbs come in or go
    if (!this.last || Math.hypot(cp.x - this.last[0], north - this.last[1]) > REFILL || Math.abs(R - this.range) > 0.1 * R || (agl < FORB_R + 20) !== this.last[2]) {
      this.last = [cp.x, north, agl < FORB_R + 20]; this.fill(cp.x, north, agl);
    }
    this.mesh.visible = this.n > 0;
  }
  get counts() { return { staged: this.n, species: this.species.length, month: this.month }; }
  // The plant under a ray (identify.js): the nearest instance whose box the ray passes within, out to `far` m.
  pick(origin, dir, far = FORB_R) {
    let best = null; const buf = this.buf.array;
    for (let q = 0; q < this.n; q++) {
      const o = q * STRIDE, sp = buf[o + 4] | 0, F = this.species[sp], st = this.states[sp]; if (!F || !st || st.h <= 0) continue;
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
  // Every forb whose root is within the box (x0..x1, z0..z1, scene z), with its deterministic id (`f:<i>.<j>.<k>`: the
  // habitat cell and the candidate, the same on every page), species, place and scale: dig's roots hang theirs.
  plantsIn(x0, z0, x1, z1, out = []) {
    const res = this.tile.habitat.res, size = this.tile.size;
    const i0 = Math.max(0, Math.floor(x0 / res)), i1 = Math.min(this.W - 1, Math.floor(x1 / res));
    const j0 = Math.max(0, Math.floor((size + z0) / res)), j1 = Math.min(this.Hh - 1, Math.floor((size + z1) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = this.cellData(i, j), a = c.arr;
      for (let q = 0; q < a.length / STRIDE; q++) {
        const o = q * STRIDE, x = a[o], z = a[o + 2]; if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        const F = this.species[a[o + 4] | 0]; if (!F) continue;
        out.push({ id: `f:${i}.${j}.${c.ks[q]}`, species: F.id, x, y: a[o + 1], z, scale: a[o + 3] });
      }
    }
    return out;
  }
  // a plant pulled down (dig.js): its cell placed again without it, the buffer filled again
  forget(id) {
    const m = /^f:(\d+)\.(\d+)\./.exec(id); if (!m) return;
    const key = +m[2] * this.W + +m[1]; this.cache.delete(key); this.cache.delete(-1 - key); this.last = null;
  }
  // The nearest plant to (x, z) within r m, optionally of the species in `ids` (a Set): { species, d, x, z } or null.
  nearest(x, z, r, ids = null) {
    let best = null; const buf = this.buf.array, r2 = r * r;
    for (let q = 0; q < this.n; q++) {
      const o = q * STRIDE, sp = buf[o + 4] | 0, F = this.species[sp]; if (!F || (ids && !ids.has(F.id))) continue;
      const dx = buf[o] - x, dz = buf[o + 2] - z, d2 = dx * dx + dz * dz; if (d2 > r2) continue;
      if (!best || d2 < best.d2) best = { species: F.id, d2, x: buf[o], z: buf[o + 2] };
    }
    if (best) best.d = Math.sqrt(best.d2);
    return best;
  }
  // Counts by species within r m of (x, z).
  speciesAround(x, z, r) {
    const out = {}, buf = this.buf.array, r2 = r * r;
    for (let q = 0; q < this.n; q++) { const o = q * STRIDE, dx = buf[o] - x, dz = buf[o + 2] - z; if (dx * dx + dz * dz > r2) continue; const F = this.species[buf[o + 4] | 0]; if (F) out[F.id] = (out[F.id] || 0) + 1; }
    return out;
  }
  dispose() {
    this.mesh.visible = false; this.mesh.geometry.dispose(); this.material.dispose(); this.atlas?.dispose(); this.cache.clear(); this.mixCache.clear();
  }
}
