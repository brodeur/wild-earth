import * as THREE from 'three';
import { mulberry32 } from './trees.js';
import { hash } from './vegetation.js';
import { localXY } from './goto.js';
import { addCaster, removeCaster } from './shadows.js';
import { buildSquirrel, buildWoodpecker, buildRaven, buildDeer, buildQuail, buildJay, buildHawk, buildVulture, buildStellersJay,
  animalMaterial, animalDepthMaterial, planarShadowMaterial, loadDeerMesh, loadSquirrelMesh, loadQuailMesh, loadJayMesh,
  loadStellersJayMesh, loadRedtailMesh, loadVultureMesh } from './animalModels.js';

// Ambient animals: the first step toward "many of each species always present" (docs/brief.md,
// Direction; roadmap visual pass step 6 "Life"). Western gray squirrels, acorn woodpeckers, other
// common ravens and black-tailed deer, each a procedural low-poly model (animalModels.js) drawn as
// one InstancedMesh, posed in the vertex shader from a per-instance vec4.
//
// Population is deterministic per 30 m habitat cell, like the vegetation: a cell's hash against an
// expected count from habitat suitability (class and tree canopy, woodland edges), a weak prior from
// the tile's occurrence records within ~500 m, and the season. Only cells within LIVE_R of the player
// hold animals; the set is rebuilt when the player has moved REBUILD_MOVE m, and an animal that stays
// in the set keeps its state. Behaviour is a small state machine per animal, anchored on the oaks the
// vegetation placed (veg.oaks). Only species the player's species perceives are created
// (tile.perception.perceives[observer]); setObserver(code) switches.
//
// Life seen from the air (a raven at 30-150 m): birds in flight are what a real raven notices, so
// there are flocks and flights. California quail coveys run across openings and burst into a short
// whirring flight when the raven passes low (or a hawk stoops at them, or now and then by
// themselves); scrub-jay groups hop tree to tree through the oaks; woodpeckers make long undulating
// flights between granaries 50-150 m apart; red-tailed hawks soar 100-250 m up with an occasional
// stoop; turkey vultures teeter in slow circles and long glides; Steller's jays work up through the pines
// branch by branch in small groups and glide down to the next tree. Birds in flight are drawn up to 1.6x
// their size with distance (true size within 30 m, 1.6x beyond 100 m) so they stay a few pixels
// wide; ground animals stay true scale. Deer move in herds of 3-6 that leave cover for open savanna
// at dawn and dusk and walk in file. Hawks and vultures are not tied to 30 m cells but to coarse
// territory cells (one bird per cell at most, at least one of each within the live radius).
// Turkey vulture is not in the tile's species list or perception matrix yet: it is a visual only,
// seen by every observer (VISUAL_ONLY) until the pipeline adds it.
//
// Shadows: animals receive the cascaded sun shadows through patchLambert. To cast, every species'
// InstancedMesh is registered with shadows.js addCaster on the near cascade (the only one
// re-rendered every frame, so the shadows move with the animals; it is off above ~110 m camera
// height), drawn with its customDepthMaterial (animalDepthMaterial: the same part animation, so a
// wingbeat's shadow beats). Deer also keep a planar shadow: the posed model projected onto the
// plane through its feet along the sun, which works at any height and gives the long dawn and dusk
// shadows that make a herd readable from the air; it fades out inside cascade 0's map, where the
// real shadow is drawn, so the ground under a near deer is not darkened twice.
//
// Events (for sound.js): on(type, fn) / off(type, fn). 'flush' { group, x, y, z, n, cause } when a
// quail covey bursts up (x, y, z: where it takes off; cause 'raven', 'hawk', 'self' or 'debug');
// 'stoop' { animal, x, y, z, target } when a red-tailed hawk tips into a stoop.

const LIVE_R = 400, REBUILD_MOVE = 100, NEAR_R = 150, TAG_R = 40, TAG_MAX = 6, BUCKET = 30;
// Drawn meshes (DRAWN below): the deer (a CC0 download, tools/build_deer.py) and the scrub-jay, quail,
// squirrel, Steller's jay, red-tailed hawk and turkey vulture (Meshy previews, tools/build_scrubjay.py,
// build_quail.py, build_squirrel.py, build_stellersjay.py, build_redtail.py, build_vulture.py) are drawn from a
// GLB in three tiers by distance from the eye: lod0 within lod[0] m, lod1 within lod[1] m, lod2 beyond. The
// procedural model (animalModels.js build*) still holds every animal's matrix and pose and is drawn instead
// until the GLB has loaded, if it fails to load, or with ?<param>=proc (?deer=proc, ?squirrel=proc,
// ?quail=proc, ?jay=proc, ?stjay=proc, ?hawk=proc, ?vulture=proc; ?animals=proc for all) for A/B; live:
// __we.animals.setMesh('quail', false) (and
// __we.animals.deerMesh = false as before). __we.animals.lodForce.quail = 0/1/2 pins every quail to one tier
// (deerLodForce still works). The drawn birds and squirrel take a second per-instance vec4 (aAnim2, see
// animalModels.js rig templates), filled here per animal: wing bow and tail spread for birds, leg splay and
// a lagged tail-tip flick for the squirrel, and the colour variant (female quail).
const LOD_R2 = 250 * 250;   // ground animals farther than this from the eye think on alternate frames (with the summed dt)
const FLY_NEAR = 30, FLY_FAR = 100, FLY_GROW = 0.6;   // birds in flight: true size within FLY_NEAR m of the eye, 1.6x beyond FLY_FAR
const VISUAL_ONLY = new Set(['cathartes_aura']);     // not in the species list or perception matrix yet: seen by everyone
const TAU = Math.PI * 2;
const CLING_PITCH = -1.72;   // a clinging woodpecker: nose up, tipped just past vertical so the tail braces on the bark

// FNV-1a over the oak id with the acorn game's stash salt: the same "one oak in eight has a stash
// hole" rule as acorns.js oakInfo(), so woodpecker granaries are the acorn game's stash trees.
function seedOf(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const isStashTree = oak => oak.cls !== 'sapling' && mulberry32(seedOf(oak.id, 0x57a5))() < 1 / 8;   // snags are real granaries; saplings are not

// Suitability by habitat class (pipeline/habitat.py codes): 1 oak woodland, 2 conifer, 3 mixed,
// 4 chaparral, 5 grassland, 6 riparian, 7 water, 8 barren, 9 human (rewilded: treat as grassland).
const SUIT = {
  sciurus_griseus:         { 1: 1, 2: 0.45, 3: 0.9, 4: 0.1, 5: 0.2, 6: 0.75, 9: 0.15 },
  melanerpes_formicivorus: { 1: 1, 2: 0.2, 3: 0.7, 4: 0.05, 5: 0.35, 6: 0.6, 9: 0.3 },
  corvus_corax:            { 1: 0.6, 2: 0.45, 3: 0.55, 4: 0.5, 5: 0.6, 6: 0.6, 7: 0.4, 8: 0.6, 9: 0.6 },
  odocoileus_hemionus:     { 1: 0.8, 2: 0.3, 3: 0.5, 4: 0.35, 5: 0.7, 6: 1, 9: 0.6 },
  callipepla_californica:  { 1: 0.6, 3: 0.3, 4: 0.75, 5: 0.85, 6: 0.7, 9: 0.8 },
  aphelocoma_californica:  { 1: 1, 2: 0.15, 3: 0.8, 4: 0.45, 5: 0.15, 6: 0.8, 9: 0.3 },
  cyanocitta_stelleri:     { 2: 1, 3: 0.7, 6: 0.2 },   // conifer and mixed forest (sound.js uses the same weights)
};
// Expected individuals (or groups) per 30 m cell at suitability 1, and season multipliers.
const SEASON = {
  sciurus_griseus:         { fall: 1.25, winter: 0.8, spring: 1, summer: 0.9 },
  melanerpes_formicivorus: { fall: 1.2, winter: 1, spring: 1, summer: 0.9 },
  corvus_corax:            { fall: 1, winter: 1, spring: 1, summer: 1 },
  odocoileus_hemionus:     { fall: 1, winter: 1, spring: 1, summer: 1 },
  callipepla_californica:  { fall: 1.1, winter: 1, spring: 1.2, summer: 1 },
  aphelocoma_californica:  { fall: 1.2, winter: 1, spring: 0.9, summer: 0.9 },
  cyanocitta_stelleri:     { fall: 1.15, winter: 1.1, spring: 0.9, summer: 0.9 },
};
const SPECIES = [
  { code: 'sciurus_griseus', one: 'squirrel', many: 'squirrels', k: 0.45, salt: 9101, cap: 160, scale: 1, build: buildSquirrel },
  { code: 'melanerpes_formicivorus', one: 'woodpecker', many: 'woodpeckers', k: 0.075, salt: 9202, cap: 200, scale: 1, build: buildWoodpecker },
  { code: 'corvus_corax', one: 'raven', many: 'ravens', k: 0.022, salt: 9303, cap: 60, scale: 1, build: buildRaven },
  { code: 'odocoileus_hemionus', one: 'deer', many: 'deer', k: 0.017, salt: 9404, cap: 90, scale: 1, build: buildDeer },
  { code: 'callipepla_californica', one: 'quail', many: 'quail', k: 0.04, salt: 9505, cap: 200, scale: 1, build: buildQuail, bird: true, common: 'California quail' },
  { code: 'aphelocoma_californica', one: 'scrub-jay', many: 'scrub-jays', k: 0.07, salt: 9606, cap: 100, scale: 1, build: buildJay, bird: true, common: 'California scrub-jay' },
  { code: 'buteo_jamaicensis', one: 'hawk', many: 'hawks', salt: 9707, cap: 6, scale: 1, build: buildHawk, bird: true, common: 'Red-tailed hawk', grid: 500, p: 0.45 },
  { code: 'cathartes_aura', one: 'vulture', many: 'vultures', salt: 9808, cap: 6, scale: 1, build: buildVulture, bird: true, common: 'Turkey vulture', grid: 450, p: 0.4 },
  { code: 'cyanocitta_stelleri', one: "Steller's jay", many: "Steller's jays", k: 0.06, salt: 9909, cap: 60, scale: 1, build: buildStellersJay, bird: true, common: "Steller's jay" },
];
const SQ = 0, WP = 1, RV = 2, DR = 3, QU = 4, SJ = 5, HK = 6, TV = 7, ST = 8;
const TAG_DY = [0.5, 0.5, 0.7, 2.1, 0.4, 0.4, 0.7, 0.7, 0.45];
const INDEX = Object.fromEntries(SPECIES.map((sp, k) => [sp.code, k]));
const DRAWN = {
  [DR]: { name: 'deer', param: 'deer', load: loadDeerMesh, lod: [30, 90], planar: true },
  [SQ]: { name: 'squirrel', param: 'squirrel', load: loadSquirrelMesh, lod: [12, 40] },
  [QU]: { name: 'quail', param: 'quail', load: loadQuailMesh, lod: [12, 40] },
  [SJ]: { name: 'scrub-jay', param: 'jay', load: loadJayMesh, lod: [12, 40] },
  [ST]: { name: 'stellers-jay', param: 'stjay', load: loadStellersJayMesh, lod: [12, 40] },
  // soarers: seen at 100-400 m nearly always; lod0 only on pull-outs near the ground or a raven alongside
  [HK]: { name: 'hawk', param: 'hawk', load: loadRedtailMesh, lod: [40, 150] },
  [TV]: { name: 'vulture', param: 'vulture', load: loadVultureMesh, lod: [50, 180] },
};
// Steller's jays perch in conifers (veg.nearPlants, the plants within ~240 m of the eye; veg.oaks holds only oaks)
// Crown radius as a fraction of the tree's height, by height fraction (the crown envelopes in library/species/).
const CONIFERS = new Set(['pinus_ponderosa', 'pinus_sabiniana']);
const CROWN = {
  pinus_ponderosa: [[0.4, 0.2], [0.6, 0.22], [0.8, 0.2], [0.92, 0.13], [1.0, 0.04]],
  pinus_sabiniana: [[0.22, 0.16], [0.38, 0.29], [0.55, 0.33], [0.7, 0.31], [0.84, 0.23], [0.94, 0.13], [1.0, 0.04]],
};
function crownR(sp, h) {
  const t = CROWN[sp] || CROWN.pinus_ponderosa;
  if (h <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (h <= t[i][0]) return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * (h - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
  return t[t.length - 1][1];
}

// states
const S_PAUSE = 0, S_RUN = 1, S_CLIMB = 2, S_OUT = 3, S_SIT = 4, S_IN = 5, S_DOWN = 6;   // squirrel
const W_CLING = 10, W_TOP = 11, W_FLY = 12;                                             // woodpecker
const R_SOAR = 20, R_GLIDE = 21, R_PERCH = 22, R_CLIMB = 23;                           // raven
const D_WALK = 30, D_GRAZE = 31, D_BED = 32;                                           // deer
const Q_FORAGE = 40, Q_WAIT = 41, Q_FLY = 42;                                           // quail (bird)
const G_FORAGE = 0, G_RUN = 1, G_SETTLE = 2;                                            // quail (covey)
const J_PERCH = 50, J_GROUND = 51, J_FLY = 52;                                          // scrub-jay
const H_SOAR = 60, H_STOOP = 61, H_PULL = 62;                                           // hawk
const V_SOAR = 70, V_GLIDE = 71;                                                        // vulture

const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// A point on an oak's trunk axis at height h above the ground, following the variant's lean (the
// same frame as acorns.js trunkPoint: limb along +y, rotateZ(lean), rotateY(leanDir + rot), scale).
function trunkAt(oak, h, out) {
  const st = oak.stem, s = oak.scale;
  if (!st) { out.x = oak.x; out.y = oak.y + h; out.z = oak.z; out.r = 0.25 * s; return out; }
  const sl = Math.sin(st.lean), cl = Math.cos(st.lean), A = st.leanDir + oak.rot;
  const t = (h + 0.3) / (s * cl);
  out.x = oak.x - sl * Math.cos(A) * t * s; out.y = oak.y + h; out.z = oak.z + sl * Math.sin(A) * t * s;
  out.r = s * (st.r0 + (st.r1 - st.r0) * Math.min(1, t / st.len));
  return out;
}
const forkHeight = oak => oak.stem ? Math.max(1.5, oak.scale * oak.stem.len * Math.cos(oak.stem.lean) - 0.3) : 2.5;
const treeHeight = oak => Math.max(3, (oak.height || 8) * oak.scale);

export class Animals {
  constructor({ tile, scene, flight, veg, atmosphere, camera, identify = null }) {
    Object.assign(this, { tile, flight, veg, camera, identify, atmosphere });
    this.heights = tile.heights;
    this.group = new THREE.Group(); this.group.name = 'animals'; scene.add(this.group);
    this.names = Object.fromEntries((tile.species || []).map(s => [s.code, s.common]));
    this.time = 0; this.season = null; this.hour = 9;
    this.list = []; this.byId = new Map(); this.bySpecies = SPECIES.map(() => []);
    this.lastCenter = null; this.vegVersion = -1; this.dirty = true;
    this.observer = null; this.perceived = new Set();
    this.ms = 0; this.counts = new Int32Array(SPECIES.length); this.lastDescribe = -1e9; this.text = '–';
    this.prior = null; this.priorReady = false; this.priorDeadline = performance.now() + 4000;
    this.loadPrior();
    // one InstancedMesh per species
    this.meshes = SPECIES.map(sp => {
      const model = sp.build();
      const geo = model.geometry;
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(sp.cap * 4), 4); anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const mesh = new THREE.InstancedMesh(geo, animalMaterial(atmosphere, model), sp.cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0; mesh.frustumCulled = false; mesh.name = sp.one;
      mesh.castShadow = mesh.receiveShadow = true;   // receive: patchLambert's csmShadow; cast: the proxies below
      this.group.add(mesh);
      sp.tris = model.tris; sp.model = model;
      return mesh;
    });
    // Shadow casters (see the header): every species on the near cascade through shadows.js
    // addCaster, which follows the mesh's count, visibility and instance buffer itself; deer also a
    // planar shadow.
    this.listeners = {};
    SPECIES.forEach((sp, k) => {
      const mesh = this.meshes[k];
      mesh.customDepthMaterial = animalDepthMaterial(sp.model);
      addCaster(mesh, { cascades: [0], simple: false });
      if (k === DR) {
        const ps = new THREE.InstancedMesh(mesh.geometry, planarShadowMaterial(sp.model, { drop: 0.6, nearFade: true }), sp.cap);
        ps.instanceMatrix = mesh.instanceMatrix; ps.count = 0; ps.frustumCulled = false; ps.name = 'deer shadow'; ps.renderOrder = 1;
        this.group.add(ps); this.planar = ps;
      }
    });
    this.tris = Object.fromEntries(SPECIES.map(sp => [sp.one, sp.tris]));
    // oak lookup (rebuilt when the vegetation rebuilds); conifer lookup (rebuilt when the near set refreshes)
    this.oaks = []; this.oakGrid = new Map(); this.granary = new Uint8Array(0);
    this.conifers = []; this.coniferGrid = new Map(); this.nearVersion = -1;
    // temporaries
    this._t = { x: 0, y: 0, z: 0, r: 0 }; this._p = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._s = new THREE.Vector3(); this._m = new THREE.Matrix4();
    // name tags
    this.tagGroup = new THREE.Group(); this.tagGroup.renderOrder = 19; this.group.add(this.tagGroup);
    this.coveys = []; this.frame = 0; this.camPos = camera.position;
    this.tagPool = []; this.tagMats = {}; this.tagged = [];
    this.setObserver((typeof window !== 'undefined' && window.__we?.playerSpecies) || 'corvus_corax');
    // drawn meshes (DRAWN): per species { on, tiers, planar, loading, casting }, filled by setMesh
    this.drawn = {}; this.lodForce = {}; this._dc = [0, 0, 0];
    this.anim2 = SPECIES.map((sp, k) => DRAWN[k] ? new Float32Array(sp.cap * 4) : null);
    const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    for (const k of Object.keys(DRAWN)) if (q.get(DRAWN[k].param) !== 'proc' && q.get('animals') !== 'proc') this.setMesh(+k, true);
  }

  // ---- drawn meshes (see DRAWN) ------------------------------------------------------------------------
  get deerMesh() { return !!this.drawn[DR]?.on; }
  set deerMesh(on) { this.setMesh(DR, !!on); }
  get deerLodForce() { return this.lodForce.deer ?? null; }
  set deerLodForce(t) { this.lodForce.deer = t; }
  // which: a species index, DRAWN name ('deer', 'squirrel', 'quail', 'scrub-jay') or URL param ('jay').
  async setMesh(which, on) {
    const k = typeof which === 'number' ? which : +Object.keys(DRAWN).find(i => DRAWN[i].name === which || DRAWN[i].param === which);
    const D = DRAWN[k]; if (!D) return;
    const st = this.drawn[k] ||= { on: false, tiers: null, planar: null, loading: null, casting: false };
    st.on = !!on;
    if (st.on && !st.tiers) {
      if (!st.loading) st.loading = D.load().then(model => this.buildTiers(k, model))
        .catch(e => console.warn(`${D.name} mesh failed to load; drawing the procedural ${D.name}`, e));
      await st.loading;
    }
    if (!st.tiers) { st.on = false; return; }   // fallback: the procedural model stays
    const proc = this.meshes[k], use = st.on;
    proc.material.visible = !use;
    if (use !== st.casting) {
      st.casting = use;
      if (use) { removeCaster(proc); for (const m of st.tiers) addCaster(m, { cascades: [0], simple: false }); }
      else { for (const m of st.tiers) removeCaster(m); addCaster(proc, { cascades: [0], simple: false }); }
    }
    for (const m of st.tiers) m.visible = false;
    if (st.planar) for (const m of st.planar) m.visible = false;
  }
  meshOn(k) { const st = this.drawn[k]; return !!(st && st.on && st.tiers); }
  buildTiers(k, model) {
    const sp = SPECIES[k], cap = sp.cap, D = DRAWN[k], st = this.drawn[k];
    st.model = model;
    st.tiers = model.tiers.map((geo, t) => {
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      if (model.rig) { const a2 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); a2.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aAnim2', a2); }
      const m = new THREE.InstancedMesh(geo, animalMaterial(this.atmosphere, model), cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.name = `${D.name} mesh lod${t}`; m.visible = false;
      m.castShadow = m.receiveShadow = true;
      m.customDepthMaterial = animalDepthMaterial(model);
      this.group.add(m);
      return m;
    });
    st.planar = D.planar ? st.tiers.map((m, t) => {
      const ps = new THREE.InstancedMesh(m.geometry, planarShadowMaterial(model, { drop: 0.6, nearFade: true }), cap);
      ps.instanceMatrix = m.instanceMatrix; ps.count = 0; ps.frustumCulled = false; ps.name = `${D.name} mesh shadow lod${t}`; ps.renderOrder = 1; ps.visible = false;
      this.group.add(ps);
      return ps;
    }) : null;
    sp.meshTris = model.tris;
  }
  // Copy each animal's matrix and pose from the procedural mesh's buffers (written by update) into its tier.
  distribute(k) {
    const st = this.drawn[k], D = DRAWN[k];
    const src = this.meshes[k], n = src.count, M = src.instanceMatrix.array, A = src.geometry.attributes.aAnim.array, A2 = this.anim2[k];
    const C = this.camPos, cnt = this._dc, T = st.tiers, f = this.lodForce[D.name] ?? null, rig = !!st.model.rig;
    const r0 = D.lod[0] * D.lod[0], r1 = D.lod[1] * D.lod[1];
    cnt[0] = cnt[1] = cnt[2] = 0;
    for (let i = 0; i < n; i++) {
      const x = M[i * 16 + 12] - C.x, y = M[i * 16 + 13] - C.y, z = M[i * 16 + 14] - C.z, d2 = x * x + y * y + z * z;
      const t = f ?? (d2 < r0 ? 0 : d2 < r1 ? 1 : 2), m = T[t], j = cnt[t]++;
      m.instanceMatrix.array.set(M.subarray(i * 16, i * 16 + 16), j * 16);
      m.geometry.attributes.aAnim.array.set(A.subarray(i * 4, i * 4 + 4), j * 4);
      if (rig) m.geometry.attributes.aAnim2.array.set(A2.subarray(i * 4, i * 4 + 4), j * 4);
    }
    for (let t = 0; t < 3; t++) {
      const m = T[t], c = cnt[t], an = m.geometry.attributes.aAnim;
      m.count = c; m.visible = src.visible && c > 0;
      if (st.planar) { st.planar[t].count = c; st.planar[t].visible = m.visible; }
      if (!c) continue;
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, c * 16); m.instanceMatrix.needsUpdate = true;
      an.clearUpdateRanges(); an.addUpdateRange(0, c * 4); an.needsUpdate = true;
      if (rig) { const a2 = m.geometry.attributes.aAnim2; a2.clearUpdateRanges(); a2.addUpdateRange(0, c * 4); a2.needsUpdate = true; }
    }
  }

  // ---- events (see the header) --------------------------------------------------------------------
  on(type, fn) { (this.listeners[type] ||= []).push(fn); return () => this.off(type, fn); }
  off(type, fn) { const a = this.listeners[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(type, e) {
    const a = this.listeners[type]; if (!a) return;
    for (const fn of a.slice()) { try { fn(e); } catch (err) { console.error(`animals: '${type}' listener`, err); } }
  }
  // Unregister the shadow casters (a teardown; main.js keeps one Animals for the page's life).
  dispose() { for (const m of this.meshes) removeCaster(m); this.group.removeFromParent(); }

  // ---- perception --------------------------------------------------------------------------------
  setObserver(code) {
    this.observer = code;
    const list = this.tile.perception?.perceives?.[code];
    this.perceived = new Set(list || SPECIES.map(s => s.code));   // no matrix: everything
    for (const c of VISUAL_ONLY) this.perceived.add(c);
    SPECIES.forEach((sp, k) => { this.meshes[k].visible = this.perceived.has(sp.code); });
    this.dirty = true;
  }

  // ---- occurrence prior --------------------------------------------------------------------------
  // Records per 100 m cell, smoothed over an 11 x 11 box (~500 m radius) with a summed-area table.
  // prior = 0.6 + 0.8 * d / (d + dMean): 0.6 where nobody recorded the species, up to 1.4 where many did.
  // A weak prior on purpose: records follow observers (roads, houses), not animals.
  async loadPrior() {
    try {
      const g = await (await fetch(this.tile.dir + 'species/occurrences.geojson')).json();
      const N = Math.ceil(this.tile.size / 100), grids = {};
      for (const f of g.features || []) {
        const code = f.properties?.species_code, c = f.geometry?.coordinates;
        if (!code || !c || !SPECIES.some(s => s.code === code)) continue;
        const p = localXY(this.tile, c[1], c[0]); if (!p) continue;
        const grid = grids[code] || (grids[code] = new Float32Array(N * N));
        const i = Math.min(N - 1, Math.floor(p.x / 100)), j = Math.min(N - 1, Math.floor(p.north / 100));
        grid[j * N + i]++;
      }
      const prior = {};
      for (const [code, grid] of Object.entries(grids)) {
        const sat = new Float64Array((N + 1) * (N + 1));
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
          sat[(j + 1) * (N + 1) + i + 1] = grid[j * N + i] + sat[j * (N + 1) + i + 1] + sat[(j + 1) * (N + 1) + i] - sat[j * (N + 1) + i];
        const d = new Float32Array(N * N); let sum = 0, nz = 0;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const i0 = Math.max(0, i - 5), i1 = Math.min(N, i + 6), j0 = Math.max(0, j - 5), j1 = Math.min(N, j + 6);
          const v = sat[j1 * (N + 1) + i1] - sat[j0 * (N + 1) + i1] - sat[j1 * (N + 1) + i0] + sat[j0 * (N + 1) + i0];
          d[j * N + i] = v; if (v > 0) { sum += v; nz++; }
        }
        prior[code] = { d, mean: nz ? sum / nz : 1, N };
      }
      this.prior = prior;
    } catch (e) { console.warn('animals: no occurrence prior', e); }
    this.priorReady = true; this.dirty = true;
  }
  priorAt(code, x, north) {
    const p = this.prior?.[code]; if (!p) return 1;   // no records loaded: neutral; species with no records at all: neutral too
    const i = Math.min(p.N - 1, Math.max(0, Math.floor(x / 100))), j = Math.min(p.N - 1, Math.max(0, Math.floor(north / 100)));
    const d = p.d[j * p.N + i];
    return 0.6 + 0.8 * d / (d + p.mean);
  }

  // ---- oaks ---------------------------------------------------------------------------------------
  indexOaks() {
    this.oaks = this.veg.oaks; this.vegVersion = this.veg.version;
    const grid = new Map(), n = this.oaks.length, gran = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const o = this.oaks[k];
      const key = Math.floor(o.x / BUCKET) + Math.floor(-o.z / BUCKET) * 4096;
      let arr = grid.get(key); if (!arr) grid.set(key, arr = []);
      arr.push(k); gran[k] = isStashTree(o) ? 1 : 0;
    }
    this.oakGrid = grid; this.granary = gran;
  }
  // Nearest oak to (x, z) within r (granaryOnly: stash trees only), or null. No allocation.
  nearestOak(x, z, r, granaryOnly = false) {
    const n = -z, b = Math.ceil(r / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(n / BUCKET);
    let best = null, bd = r * r;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.oakGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const idx = arr[k]; if (granaryOnly && !this.granary[idx]) continue;
        const o = this.oaks[idx], dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = o; }
      }
    }
    return best;
  }
  // A random oak within r of (x, z), other than `not` (reservoir sampling, no allocation).
  randomOak(x, z, r, rng, not = null, minH = 0) {
    const n = -z, b = Math.ceil(r / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(n / BUCKET);
    let pick = null, seen = 0;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.oakGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const o = this.oaks[arr[k]]; if (o === not) continue;
        const dx = o.x - x, dz = o.z - z; if (dx * dx + dz * dz > r * r) continue;
        if (minH && treeHeight(o) < minH) continue;
        seen++; if (rng() * seen < 1) pick = o;
      }
    }
    return pick;
  }

  // A random oak between rMin and rMax of (x, z) (granaryOnly: stash trees only), or null. No allocation.
  ringOak(x, z, rMin, rMax, rng, granaryOnly = false, not = null) {
    const n = -z, b = Math.ceil(rMax / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(n / BUCKET);
    let pick = null, seen = 0;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.oakGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const idx = arr[k]; if (granaryOnly && !this.granary[idx]) continue;
        const o = this.oaks[idx]; if (o === not) continue;
        const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz; if (d2 > rMax * rMax || d2 < rMin * rMin) continue;
        seen++; if (rng() * seen < 1) pick = o;
      }
    }
    return pick;
  }

  // ---- conifers (Steller's jays) ------------------------------------------------------------------
  // { x, y, z, height } per pine in the vegetation's near set; y is the ground at the trunk.
  indexConifers() {
    this.nearVersion = this.veg.nearVersion;
    const had = this.conifers.length, grid = new Map(), list = [];
    for (const pl of this.veg.nearPlants || []) {
      if (!CONIFERS.has(pl.species) || !(pl.height > 4)) continue;
      const o = { id: pl.id, sp: pl.species, x: pl.x, y: pl.y, z: pl.z, height: pl.height, conifer: true };
      const key = Math.floor(o.x / BUCKET) + Math.floor(-o.z / BUCKET) * 4096;
      let arr = grid.get(key); if (!arr) grid.set(key, arr = []);
      arr.push(list.length); list.push(o);
    }
    this.conifers = list; this.coniferGrid = grid;
    if (!had && list.length) this.dirty = true;   // the first near set: place the jays now rather than after 100 m
  }
  // Nearest conifer to (x, z) within r, or a random one between rMin and rMax (other than `not`); no allocation.
  nearestConifer(x, z, r) {
    const b = Math.ceil(r / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(-z / BUCKET);
    let best = null, bd = r * r;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.coniferGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) { const o = this.conifers[arr[k]], dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = o; } }
    }
    return best;
  }
  ringConifer(x, z, rMin, rMax, rng, not = null) {
    const b = Math.ceil(rMax / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(-z / BUCKET);
    let pick = null, seen = 0;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.coniferGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const o = this.conifers[arr[k]]; if (o === not || (not && o.id === not.id)) continue;
        const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz; if (d2 > rMax * rMax || d2 < rMin * rMin) continue;
        seen++; if (rng() * seen < 1) pick = o;
      }
    }
    return pick;
  }

  // ---- population ---------------------------------------------------------------------------------
  rebuild(px, pz) {
    this.lastCenter = [px, pz]; this.dirty = false;
    const t = this.tile, hab = t.habitat, can = t.canopy, res = hab.res, size = t.size, north = -pz;
    const [ci, cj] = hab.cellOf(px, north), cells = Math.ceil(LIVE_R / res);
    const keep = new Set();
    const live = SPECIES.map(sp => this.perceived.has(sp.code));
    for (let j = cj - cells; j <= cj + cells; j++) for (let i = ci - cells; i <= ci + cells; i++) {
      if (i < 0 || j < 0 || i >= hab.img.width || j >= hab.img.height) continue;
      const cx = (i + 0.5) * res, cn = size - (j + 0.5) * res;
      if (Math.hypot(cx - px, cn - north) > LIVE_R) continue;
      const cls = hab.channel(i, j, 0); if (!cls) continue;
      const tree = can.channel(i, j, 0) / 100;
      let edge = 0;   // woodland next to open ground within 60 m
      if (cls !== 7) {
        const wood = c => c === 1 || c === 2 || c === 3 || c === 6, open = c => c === 4 || c === 5 || c === 9;
        const me = wood(cls);
        for (const [di, dj] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= hab.img.width || jj >= hab.img.height) continue;
          const c2 = hab.channel(ii, jj, 0); if (me ? open(c2) : wood(c2) && open(cls)) { edge = 1; break; }
        }
      }
      for (let s = 0; s < SPECIES.length; s++) {
        if (!live[s] || SPECIES[s].grid) continue;   // soarers: territory cells (spawnSoarers)
        const sp = SPECIES[s], suit = SUIT[sp.code][cls] || 0; if (!suit) continue;
        let f = suit;
        if (s === SQ) f *= 0.25 + 0.75 * Math.min(1, tree * 1.5);
        else if (s === WP) f *= 0.3 + 0.7 * Math.min(1, tree * 2);
        else if (s === RV) f *= 0.6 + 0.6 * edge;
        else if (s === QU) f *= (0.35 + 0.65 * edge) * (1 - 0.5 * Math.min(1, tree));   // open ground with cover near
        else if (s === SJ) f *= 0.4 + 0.6 * Math.min(1, tree * 2);
        else if (s === ST) f *= 0.3 + 0.7 * Math.min(1, tree * 1.5);
        else f *= 0.6 + 0.5 * edge;
        const lambda = sp.k * f * this.priorAt(sp.code, cx, cn) * (SEASON[sp.code][this.season] || 1);
        const rnd = mulberry32(hash(i, j, sp.salt));
        if (rnd() >= lambda) continue;
        this.spawnCell(s, i, j, cx, cn, rnd, keep);
      }
    }
    for (const s of [HK, TV]) if (live[s]) this.spawnSoarers(s, px, pz, keep);
    // drop animals whose home cell left the live set; rebuild the per-species slot lists
    for (const [id, a] of this.byId) if (!keep.has(id)) this.byId.delete(id);
    this.list = [...this.byId.values()];
    this.bySpecies = SPECIES.map(() => []);
    for (const a of this.list) { const arr = this.bySpecies[a.sp]; if (arr.length < SPECIES[a.sp].cap) { a.slot = arr.length; arr.push(a); } else a.slot = -1; }
    this.list = this.list.filter(a => a.slot >= 0);
    this.bySpecies.forEach((arr, s) => { this.meshes[s].count = arr.length; });
    const cov = new Set(); for (const a of this.bySpecies[QU]) cov.add(a.group);
    this.coveys = [...cov];
    this.tagged.length = 0;
  }

  // Hawks and vultures: one bird per coarse territory cell with probability sp.p, its home a hashed
  // point in the cell; those within LIVE_R + 100 m live. At least one of each always: if no cell
  // passes, the cell whose draw came closest does.
  spawnSoarers(s, px, pz, keep) {
    const sp = SPECIES[s], G = sp.grid, north = -pz, R = LIVE_R + 100, size = this.tile.size;
    let best = null, bestU = 2, n = 0;
    for (let J = Math.floor((north - R) / G); J <= Math.floor((north + R) / G); J++)
      for (let I = Math.floor((px - R) / G); I <= Math.floor((px + R) / G); I++) {
        const rnd = mulberry32(hash(I + 1000, J + 1000, sp.salt)), u = rnd();
        const hx = (I + 0.1 + 0.8 * rnd()) * G, hn = (J + 0.1 + 0.8 * rnd()) * G;
        if (hx < 0 || hn < 0 || hx > size || hn > size || Math.hypot(hx - px, hn - north) > R) continue;
        if (u < sp.p) { this.spawnSoarer(s, I, J, hx, -hn, rnd, keep); n++; }
        else if (u < bestU) { bestU = u; best = [I, J, hx, -hn, rnd]; }
      }
    if (!n && best) this.spawnSoarer(s, best[0], best[1], best[2], best[3], best[4], keep);
  }
  spawnSoarer(s, I, J, x, z, rnd, keep) {
    this.add(`${s}:T${I},${J}`, s, rnd, a => {
      a.hx = x; a.hz = z;
      const dir = rnd() < 0.5 ? 1 : -1, th = rnd() * TAU;
      if (s === HK) this.soarStart(a, x, z, 45 + rnd() * 45, 100 + rnd() * 150, dir, th, H_SOAR);
      else this.soarStart(a, x, z, 50 + rnd() * 60, 40 + rnd() * 140, dir, th, V_SOAR);
    }, keep);
  }

  // One cell's animals (a squirrel; a woodpecker family; a raven or a pair; a deer group).
  spawnCell(s, i, j, cx, cn, rnd, keep) {
    const x = cx + (rnd() - 0.5) * 30, z = -(cn + (rnd() - 0.5) * 30);
    const base = `${s}:${i},${j}`;
    if (s === SQ) {
      const home = this.nearestOak(x, z, 45); if (!home) return;
      this.add(base, s, rnd, a => { a.anchor = home; a.tree = home; this.sqStart(a); }, keep);
    } else if (s === WP) {
      const gran = this.nearestOak(x, z, 150, true) || this.nearestOak(x, z, 60); if (!gran) return;
      const n = 2 + Math.floor(rnd() * 3);
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => { a.anchor = gran; this.wpStart(a, m); }, keep);
    } else if (s === RV) {
      const n = rnd() < 0.55 ? 2 : 1, R = 35 + rnd() * 40, alt = 50 + rnd() * 100, dir = rnd() < 0.5 ? 1 : -1, th = rnd() * TAU;
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.hx = x; a.hz = z; this.rvStart(a, x, z, R + m * 8, alt + m * 6, dir, th + m * 0.6);
      }, keep);
    } else if (s === QU) {
      const se = this.season, n = se === 'spring' ? 2 + Math.floor(rnd() * 3) : se === 'summer' ? 6 + Math.floor(rnd() * 7) : 8 + Math.floor(rnd() * 8);
      const g = { x, z, hx: x, hz: z, tx: x, tz: z, dx: 0, dz: 1, state: G_FORAGE, t: 5 + rnd() * 30, cool: 10 + rnd() * 60, n, leader: null, speed: 3 };
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.group = g; a.rank = m; if (!m) g.leader = a;
        const ang = rnd() * TAU, d = Math.sqrt(rnd()) * 2.8;
        a.ox = Math.cos(ang) * d; a.oz = Math.sin(ang) * d;
        a.x = x + a.ox; a.z = z + a.oz; a.y = this.heights.atXZ(a.x, a.z); a.yaw = rnd() * TAU;
        a.state = Q_FORAGE; a.pose = 1; a.t = rnd() * 3;
      }, keep);
    } else if (s === SJ || s === ST) {   // a family group around a home tree (oaks; pines for the Steller's jay)
      const home = s === ST ? this.nearestConifer(x, z, 60) : this.nearestOak(x, z, 60); if (!home) return;
      const n = 2 + Math.floor(rnd() * 3), g = { home, tree: home, leader: null, move: 0, t: 4 + rnd() * 15, ground: false };
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.group = g; a.rank = m; if (!m) g.leader = a; a.anchor = home; a.tree = home;
        this.jaySpot(a, home, false); a.x = a.tx; a.y = a.ty; a.z = a.tz;
        a.state = J_PERCH; a.pose = 1; a.yaw = rnd() * TAU; a.t = rnd() * 4;
      }, keep);
    } else {
      const n = 3 + Math.floor(rnd() * 4), g = { hx: x, hz: z, leader: null, wx: x, wz: z };
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.group = g; a.rank = m; a.ox = m ? (rnd() - 0.5) * 9 : 0; a.oz = m ? (rnd() - 0.5) * 9 : 0;
        if (!m) g.leader = a;
        a.x = x + a.ox; a.z = z + a.oz; a.yaw = rnd() * TAU; a.state = D_GRAZE; a.t = rnd() * 10;
      }, keep);
    }
  }
  add(id, s, rnd, init, keep) {
    keep.add(id);
    const old = this.byId.get(id);
    if (old) return;   // still live: keeps its state
    const seed = (rnd() * 4294967296) >>> 0;
    const a = {
      id, sp: s, slot: -1, rng: mulberry32(seed), size: 0.9 + rnd() * 0.2,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, lift: 0,
      state: 0, t: 0, u: 0, dur: 1, speed: 0, next: 0,
      phase: rnd() * TAU, amp: 0, pose: 0, flick: 0, flickV: 0,
      sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, arc: 0,
      anchor: null, tree: null, face: 0, h: 0, scared: 0,
      hx: 0, hz: 0, cx: 0, cz: 0, R: 50, alt: 80, dir: 1, th: 0, flapT: 0,
      group: null, ox: 0, oz: 0, rank: 0, air: 0, fly: 0, acc: 0, wait: 0, moveSeen: 0, peak: 0, V: 10, rock: 0,
      e0: 0, e1: 0, variant: s === QU ? seedOf(id, 0x5e7) & 1 : 0,   // aAnim2 (drawn meshes); the quail's sex
      hopU: 1, hopX: 0, hopZ: 0, hopDX: 0, hopDZ: 0, hopH: 0,         // scrub-jay ground hop
      hFrac: 0.5,                                                      // Steller's jay: perch height in the crown (fraction of the tree)
    };
    init(a);
    this.byId.set(id, a);
  }

  // ---- squirrel -----------------------------------------------------------------------------------
  sqStart(a) {
    const o = a.tree, r = a.rng;
    if (r() < (this.season === 'fall' ? 0.25 : 0.45)) {   // start up in the crown
      a.face = r() * TAU; this.sqBranch(a); a.state = S_SIT; a.t = 3 + r() * 20; a.pose = 1;
      a.x = a.tx; a.y = a.ty; a.z = a.tz; a.pitch = -0.5;
    } else {
      const ang = r() * TAU, d = Math.sqrt(r()) * (3 + 3 * o.scale);
      a.x = o.x + Math.cos(ang) * d; a.z = o.z + Math.sin(ang) * d; a.y = this.heights.atXZ(a.x, a.z);
      a.yaw = r() * TAU; a.state = S_PAUSE; a.t = r() * 3;
    }
  }
  sqBranch(a) {   // a sitting place out on a limb, just above the fork
    const o = a.tree, r = a.rng, fh = forkHeight(o), t = trunkAt(o, fh, this._t);
    const d = (1.0 + r() * 1.6) * o.scale, hh = 0.3 + r() * 0.9;
    a.tx = t.x + Math.sin(a.face) * d; a.ty = t.y + hh; a.tz = t.z + Math.cos(a.face) * d;
  }
  sqRunTo(a, x, z, speed, next) {
    a.tx = x; a.tz = z; a.speed = speed; a.next = next; a.state = S_RUN;
    a.yaw = Math.atan2(x - a.x, z - a.z);
  }
  sqToTrunk(a, speed) {   // run to the trunk base on the side facing us, then climb
    const o = a.tree; a.face = Math.atan2(a.x - o.x, a.z - o.z);
    const t = trunkAt(o, 0, this._t), rr = t.r + 0.06;
    this.sqRunTo(a, t.x + Math.sin(a.face) * rr, t.z + Math.cos(a.face) * rr, speed, S_CLIMB);
  }
  sqUpdate(a, dt, px, py, pz) {
    const r = a.rng, H = this.heights;
    const dx = a.x - px, dy = a.y - py, dz = a.z - pz, near2 = dx * dx + dy * dy + dz * dz;
    if ((a.state === S_PAUSE || (a.state === S_RUN && a.next !== S_CLIMB)) && near2 < 15 * 15) {
      a.tree = this.nearestOak(a.x, a.z, 30) || a.anchor; a.scared = 1;
      this.sqToTrunk(a, 4.5);
    }
    a.t -= dt;
    switch (a.state) {
      case S_PAUSE: {
        a.amp = damp(a.amp, 0, 10, dt); a.pose = damp(a.pose, 0.15, 4, dt); a.pitch = damp(a.pitch, 0, 6, dt);
        if (r() < dt * 1.2) a.flickV = 1;   // tail flicks and a dip of the head
        a.y = H.atXZ(a.x, a.z);
        if (a.t <= 0) {
          const fall = this.season === 'fall', q = r(), o = a.tree;
          if (q < (fall ? 0.7 : 0.45)) {   // forage: a hop to another spot under this oak
            const ang = r() * TAU, d = Math.sqrt(r()) * (2 + 3.5 * o.scale);
            const x = o.x + Math.cos(ang) * d, z = o.z + Math.sin(ang) * d, dd = Math.hypot(x - a.x, z - a.z);
            this.sqRunTo(a, x, z, dd > 2 ? 3 : 1.5, S_PAUSE);
          } else if (q < (fall ? 0.86 : 0.65)) {   // over to another oak in the home range
            const o2 = this.randomOak(a.anchor.x, a.anchor.z, 40, r, o) || a.anchor;
            a.tree = o2; const ang = r() * TAU, d = (1 + r() * 2.5) * o2.scale;
            this.sqRunTo(a, o2.x + Math.cos(ang) * d, o2.z + Math.sin(ang) * d, 3, S_PAUSE);
          } else this.sqToTrunk(a, 2.5);   // up the tree
        }
        break;
      }
      case S_RUN: {
        const ex = a.tx - a.x, ez = a.tz - a.z, d = Math.hypot(ex, ez), step = a.speed * dt;
        a.amp = damp(a.amp, 1, 12, dt); a.pose = damp(a.pose, 0, 10, dt);
        a.phase += dt * TAU * a.speed / 0.42;
        a.yaw = Math.atan2(ex, ez);
        if (d <= step) {
          a.x = a.tx; a.z = a.tz;
          if (a.next === S_CLIMB) { a.state = S_CLIMB; a.h = 0; }
          else { a.state = S_PAUSE; a.t = (this.season === 'fall' ? 2 : 1) + r() * 4; }
        } else { a.x += ex / d * step; a.z += ez / d * step; }
        a.y = H.atXZ(a.x, a.z) + Math.abs(Math.sin(a.phase)) * 0.05 * a.amp;
        break;
      }
      case S_CLIMB: case S_DOWN: {
        const up = a.state === S_CLIMB, fh = forkHeight(a.tree), v = a.scared ? 2.2 : 1.3;
        a.h += (up ? v : -1.1) * dt;
        a.amp = 1; a.phase += dt * TAU * 3.5; a.pose = 0;
        a.pitch = up ? -Math.PI / 2 : Math.PI / 2; a.yaw = up ? a.face + Math.PI : a.face;
        const t = trunkAt(a.tree, Math.max(0, Math.min(a.h, fh)), this._t), rr = t.r + 0.06;
        a.x = t.x + Math.sin(a.face) * rr; a.y = t.y; a.z = t.z + Math.cos(a.face) * rr;
        if (up && a.h >= fh) { this.sqBranch(a); a.sx = a.x; a.sy = a.y; a.sz = a.z; a.u = 0; a.state = S_OUT; }
        else if (!up && a.h <= 0) { a.state = S_PAUSE; a.t = 1 + r() * 2; a.pitch = 0; a.yaw = a.face + (r() - 0.5) * 2; a.scared = 0; }
        break;
      }
      case S_OUT: case S_IN: {
        a.u = Math.min(1, a.u + dt / 1.1);
        const k = a.u; a.amp = 1; a.phase += dt * TAU * 4;
        a.x = a.sx + (a.tx - a.sx) * k; a.y = a.sy + (a.ty - a.sy) * k; a.z = a.sz + (a.tz - a.sz) * k;
        a.yaw = Math.atan2(a.tx - a.sx, a.tz - a.sz); a.pitch = -0.15;
        if (a.u >= 1) {
          if (a.state === S_OUT) { a.state = S_SIT; a.t = a.scared ? 15 + r() * 25 : 5 + r() * 20; }
          else { a.state = S_DOWN; a.h = forkHeight(a.tree); }
        }
        break;
      }
      case S_SIT: {
        a.amp = damp(a.amp, 0, 8, dt); a.pose = damp(a.pose, 1, 3, dt); a.pitch = damp(a.pitch, -0.55, 3, dt);
        if (r() < dt * 0.5) a.flickV = 1;
        if (r() < dt * 0.15) a.yaw += (r() - 0.5) * 1.5;   // looks around
        if (near2 < 20 * 20) a.t = Math.max(a.t, 4);      // stays put while the raven is close
        if (a.t <= 0) {   // back along the limb to the trunk, then down
          const t = trunkAt(a.tree, forkHeight(a.tree), this._t), rr = t.r + 0.06;
          a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tx = t.x + Math.sin(a.face) * rr; a.ty = t.y; a.tz = t.z + Math.cos(a.face) * rr;
          a.u = 0; a.state = S_IN; a.pose = 0;
        }
        break;
      }
    }
  }

  // ---- woodpecker ---------------------------------------------------------------------------------
  wpStart(a, m) {
    const r = a.rng, o = m === 0 || r() < 0.5 ? a.anchor : (this.randomOak(a.anchor.x, a.anchor.z, 45, r) || a.anchor);
    if (r() < 0.25) this.wpPlaceTop(a, o); else this.wpPlaceCling(a, o, r() * TAU);
    a.x = a.tx; a.y = a.ty; a.z = a.tz; a.state = a.next; a.t = r() * 8; a.pose = 1;
    a.yaw = a.state === W_CLING ? a.face + Math.PI : r() * TAU; a.pitch = a.state === W_CLING ? CLING_PITCH : -0.35;
  }
  wpPlaceCling(a, o, face) {
    const r = a.rng, top = Math.min(forkHeight(o) * 0.95, 6), h = 1.2 + r() * Math.max(0.3, top - 1.2);
    const t = trunkAt(o, h, this._t), rr = t.r + 0.02;
    a.tree = o; a.h = h; a.face = face;
    a.tx = t.x + Math.sin(face) * rr; a.ty = t.y; a.tz = t.z + Math.cos(face) * rr; a.next = W_CLING;
  }
  wpPlaceTop(a, o) {
    const r = a.rng, ang = r() * TAU, d = r() * 1.2 * o.scale;
    a.tree = o; a.tx = o.x + Math.cos(ang) * d; a.tz = o.z + Math.sin(ang) * d; a.ty = o.y + treeHeight(o) * 0.96; a.next = W_TOP;
  }
  wpFly(a, o, toTop) {
    a.sx = a.x; a.sy = a.y; a.sz = a.z;
    if (toTop) this.wpPlaceTop(a, o);
    else this.wpPlaceCling(a, o, Math.atan2(a.x - o.x, a.z - o.z) + (a.rng() - 0.5));
    const d = Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz), long = d > 40;
    // long flights between granaries go up over the crowns, in deeper undulations
    a.dur = Math.max(0.5, d / (long ? 9.5 : 8)); a.arc = long ? Math.min(14, 5 + d * 0.06) : Math.min(4, d * 0.12) + 0.3;
    a.peak = long ? 0.7 : 0.25; a.u = 0; a.state = W_FLY; a.speed = d;
  }
  wpUpdate(a, dt, px, py, pz) {
    const r = a.rng; a.t -= dt;
    if (a.state === W_FLY) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, d = a.speed;
      const ox = a.x, oy = a.y, oz = a.z;
      a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u;
      a.y = a.sy + (a.ty - a.sy) * u + a.arc * Math.sin(Math.PI * u) + a.peak * Math.sin(u * d / (a.peak > 0.5 ? 6 : 2.5) * TAU) * Math.sin(Math.PI * u);
      a.air = 1;
      // bounding flight: bursts of quick beats with the wings shut between them; flap through take-off and landing
      const burst = u < 0.15 || u > 0.8 || Math.sin(this.time * TAU * 2.2 + a.phase * 0.1) > -0.2;
      a.amp = damp(a.amp, burst ? 1 : 0, 20, dt); a.pose = damp(a.pose, burst ? 0 : 0.8, 20, dt);
      a.phase += dt * TAU * 13;
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = u > 0.85 && a.next === W_CLING ? damp(a.pitch, CLING_PITCH, 10, dt) : -Math.atan2(vy, vh + 1e-5) * 0.7;
      a.flick = 0;
      if (u >= 1) {
        a.state = a.next; a.amp = 0; a.air = 0;
        a.t = a.state === W_CLING ? (a.tree === a.anchor && this.season === 'fall' ? 6 : 3) + r() * 9 : 4 + r() * 10;
        if (a.state === W_CLING) a.yaw = a.face + Math.PI;
      }
      return;
    }
    a.amp = damp(a.amp, 0, 10, dt); a.pose = damp(a.pose, 1, 8, dt); a.air = 0;
    const dx = a.x - px, dy = a.y - py, dz = a.z - pz, flush = dx * dx + dy * dy + dz * dz < 8 * 8;
    if (a.state === W_CLING) {
      a.pitch = damp(a.pitch, CLING_PITCH, 8, dt); a.yaw = a.face + Math.PI;
      // pecking: drilling and wedging acorns at the granary in fall, probing bark otherwise
      const granaryFall = a.tree === a.anchor && this.season === 'fall';
      if (r() < dt * (granaryFall ? 1.2 : 0.5)) a.flickV = 1.6;
      a.flick = a.flickV > 0 ? Math.max(0, Math.sin(this.time * 38)) * Math.min(1, a.flickV) : 0;
      a.flickV -= dt;
      if (r() < dt * 0.15 && a.h < forkHeight(a.tree) * 0.85) {   // hitch up the trunk
        a.h += 0.25; const t = trunkAt(a.tree, a.h, this._t), rr = t.r + 0.02;
        a.x = t.x + Math.sin(a.face) * rr; a.y = t.y; a.z = t.z + Math.cos(a.face) * rr;
      }
    } else {   // W_TOP: a sentinel on the crown
      a.pitch = damp(a.pitch, -0.35, 6, dt); a.flick = damp(a.flick, 0, 6, dt);
      if (r() < dt * 0.4) a.yaw += (r() - 0.5) * 2;
    }
    if (a.t <= 0 || flush) {
      const q = r(), fall = this.season === 'fall';
      const far = !flush && r() < (fall ? 0.18 : 0.12) ? (this.ringOak(a.x, a.z, 50, 150, r, true, a.tree) || this.ringOak(a.x, a.z, 50, 120, r, false, a.tree)) : null;
      if (far) this.wpFly(a, far, r() < 0.3);   // a long flight to a granary (or any oak) 50-150 m off
      else if (a.tree !== a.anchor && q < (fall ? 0.55 : 0.3)) this.wpFly(a, a.anchor, false);
      else if (q < 0.8 || flush) this.wpFly(a, this.randomOak(a.anchor.x, a.anchor.z, 45, r, a.tree) || a.anchor, false);
      else this.wpFly(a, r() < 0.5 ? a.tree : (this.randomOak(a.anchor.x, a.anchor.z, 45, r, a.tree) || a.anchor), true);
    }
  }

  // ---- raven --------------------------------------------------------------------------------------
  rvStart(a, cx, cz, R, alt, dir, th) {
    a.cx = cx; a.cz = cz; a.R = R; a.alt = alt; a.dir = dir; a.th = th; a.state = R_SOAR; a.t = 15 + a.rng() * 40;
    a.x = cx + R * Math.cos(th); a.z = cz + R * Math.sin(th); a.y = this.heights.atXZ(cx, cz) + alt;
  }
  rvUpdate(a, dt) {
    const r = a.rng, H = this.heights, V = 10; a.t -= dt;
    a.flapT -= dt;
    a.air = a.state === R_PERCH ? 0 : 1;
    if (a.state === R_SOAR) {
      // the centre drifts on the breeze and is pulled back toward home
      const hx = a.hx - a.cx, hz = a.hz - a.cz, hd = Math.hypot(hx, hz);
      a.cx += (0.6 + (hd > 120 ? hx / hd * 1.5 : 0)) * dt; a.cz += (0.3 + (hd > 120 ? hz / hd * 1.5 : 0)) * dt;
      a.th += a.dir * V / a.R * dt;
      a.x = a.cx + a.R * Math.cos(a.th); a.z = a.cz + a.R * Math.sin(a.th);
      const gy = H.atXZ(a.cx, a.cz) + a.alt + 5 * Math.sin(a.th * 0.5 + a.phase);
      a.y = damp(a.y, Math.max(gy, H.atXZ(a.x, a.z) + 25), 0.5, dt);
      const vx = -Math.sin(a.th) * a.dir, vz = Math.cos(a.th) * a.dir;
      a.yaw = Math.atan2(vx, vz);
      const lx = Math.cos(a.yaw), lz = -Math.sin(a.yaw), left = (a.cx - a.x) * lx + (a.cz - a.z) * lz;
      a.roll = damp(a.roll, (left > 0 ? -1 : 1) * Math.atan(V * V / (9.8 * a.R)) * 1.4, 2, dt);
      a.pitch = damp(a.pitch, 0, 2, dt);
      if (a.flapT <= 0 && r() < dt * 0.08) a.flapT = 1 + r() * 1.5;   // a few beats now and then
      a.amp = damp(a.amp, a.flapT > 0 ? 1 : 0, 6, dt); a.pose = damp(a.pose, 0, 4, dt);
      if (a.flapT > 0) a.phase += dt * TAU * 2.6; else a.phase = damp(a.phase, Math.round(a.phase / Math.PI) * Math.PI, 3, dt);
      a.flick = damp(a.flick, 0, 3, dt);
      if (a.t <= 0) {
        const o = r() < 0.35 ? this.randomOak(a.cx, a.cz, 140, r, null, 7) : null;
        if (o) {   // glide down to a treetop
          a.tree = o; a.sx = a.x; a.sy = a.y; a.sz = a.z;
          a.tx = o.x + (r() - 0.5) * o.scale; a.tz = o.z + (r() - 0.5) * o.scale; a.ty = o.y + treeHeight(o) * 0.97;
          const d = Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz); a.dur = d / V; a.u = 0; a.state = R_GLIDE;
        } else a.t = 20 + r() * 40;
      }
    } else if (a.state === R_GLIDE || a.state === R_CLIMB) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, e = a.state === R_GLIDE ? 1 - (1 - u) * (1 - u) : u * u * (3 - 2 * u);   // glide: steep at first, flat on the approach
      const ox = a.x, oy = a.y, oz = a.z;
      a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u; a.y = a.sy + (a.ty - a.sy) * e;
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = damp(a.pitch, -Math.atan2(vy, vh + 1e-5) * 0.6, 4, dt); a.roll = damp(a.roll, 0, 2, dt);
      const flap = a.state === R_CLIMB || u > 0.85;
      a.amp = damp(a.amp, flap ? 1 : 0, 6, dt); a.pose = damp(a.pose, 0, 6, dt);
      if (flap) a.phase += dt * TAU * 3;
      if (u >= 1) {
        if (a.state === R_GLIDE) { a.state = R_PERCH; a.t = 15 + r() * 35; a.pitch = 0; }
        else { a.state = R_SOAR; a.th = Math.atan2(a.z - a.cz, a.x - a.cx); a.t = 30 + r() * 60; }
      }
    } else {   // R_PERCH on a treetop
      a.amp = damp(a.amp, 0, 6, dt); a.pose = damp(a.pose, 1, 3, dt); a.roll = damp(a.roll, 0, 4, dt); a.pitch = damp(a.pitch, -0.1, 3, dt);
      if (r() < dt * 0.3) a.flickV = 1;
      if (r() < dt * 0.1) a.yaw += (r() - 0.5) * 2;
      if (a.t <= 0) {   // back up to a new circle near home
        a.cx = a.hx + (r() - 0.5) * 120; a.cz = a.hz + (r() - 0.5) * 120; a.R = 35 + r() * 40;
        a.th = Math.atan2(a.z - a.cz, a.x - a.cx); a.alt = 50 + r() * 100;
        a.sx = a.x; a.sy = a.y; a.sz = a.z;
        a.tx = a.cx + a.R * Math.cos(a.th); a.tz = a.cz + a.R * Math.sin(a.th); a.ty = H.atXZ(a.cx, a.cz) + a.alt;
        a.dur = Math.max(4, Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz) / 7); a.u = 0; a.state = R_CLIMB;
      }
    }
  }

  // ---- deer ---------------------------------------------------------------------------------------
  // How open a spot is for a herd at dawn or dusk: grassland and savanna best, closed woods and
  // chaparral poor, water and conifer forest never (-1).
  openness(x, z) {
    const c = this.tile.habitat.at(x, -z); if (c === 7 || c === 2 || !c) return -1;
    const can = this.tile.canopy.at(x, -z) / 100;
    return c === 5 ? 1 : c === 9 ? 0.9 : c === 1 ? 0.95 - can : c === 6 ? 0.5 : c === 3 ? 0.35 - can * 0.2 : 0.2;
  }
  drUpdate(a, dt) {
    const r = a.rng, g = a.group, H = this.heights, hr = this.hour;
    const active = hr < 9.5 || hr > 16.5;   // dawn and dusk; bedded through the middle of the day
    a.t -= dt;
    let speed = 0;
    if (!active) {
      a.state = D_BED; a.pose = damp(a.pose, 1, 0.8, dt); a.flick = damp(a.flick, 0, 2, dt);
    } else {
      a.pose = damp(a.pose, 0, 1.2, dt);
      if (a.pose > 0.3) { a.state = D_GRAZE; }
      else if (g.leader === a) {
        if (a.state !== D_WALK && a.t <= 0) {   // next waypoint: the most open of a few spots 40-110 m off, within 160 m of home
          let best = -2;
          for (let k = 0; k < 6; k++) {
            const ang = r() * TAU, d = 40 + r() * 70;
            let x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
            const hx = x - g.hx, hz = z - g.hz, hd = Math.hypot(hx, hz);
            if (hd > 160) { x = g.hx + hx / hd * 160; z = g.hz + hz / hd * 160; }
            const sc = this.openness(x, z) + r() * 0.3;
            if (sc > best) { best = sc; g.wx = x; g.wz = z; }
          }
          a.state = D_WALK;
        }
        if (a.state === D_WALK) {
          const ex = g.wx - a.x, ez = g.wz - a.z, d = Math.hypot(ex, ez);
          if (d < 1) { a.state = D_GRAZE; a.t = 4 + r() * 8; }
          else { speed = 1.1; a.x += ex / d * speed * dt; a.z += ez / d * speed * dt; a.yaw += wrapAngle(Math.atan2(ex, ez) - a.yaw) * Math.min(1, dt * 2); }
        }
      } else {   // walking: single file behind the leader; grazing: spread around it
        const L = g.leader || a, walking = L.state === D_WALK;   // a herd can lose its leader; follow yourself
        let tx, tz;
        if (walking) {
          const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw), back = a.rank * 2.6, side = a.ox * 0.18;
          tx = L.x - fx * back + fz * side; tz = L.z - fz * back - fx * side;
        } else { tx = L.x + a.ox; tz = L.z + a.oz; }
        const ex = tx - a.x, ez = tz - a.z, d = Math.hypot(ex, ez);
        if (d > (a.state === D_WALK ? 0.6 : 2.5)) {
          a.state = D_WALK; speed = Math.min(1.6, 0.4 + d * 0.3);
          a.x += ex / d * speed * dt; a.z += ez / d * speed * dt;
          const want = Math.atan2(ex, ez); a.yaw += wrapAngle(want - a.yaw) * Math.min(1, dt * 3);
        } else a.state = D_GRAZE;
      }
      a.flick = damp(a.flick, a.state === D_GRAZE ? 1 : 0, 2, dt);
    }
    a.amp = damp(a.amp, speed > 0.05 ? 1 : 0, 5, dt);
    a.phase += dt * TAU * speed / 1.5;
    const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    const hf = H.atXZ(a.x + sy * 0.6, a.z + cy * 0.6), hb = H.atXZ(a.x - sy * 0.6, a.z - cy * 0.6);
    a.pitch = -Math.atan2(hf - hb, 1.2) * 0.8;
    a.y = Math.min(hf, hb) * 0.5 + H.atXZ(a.x, a.z) * 0.5 - 0.6 * a.pose;
  }

  // ---- California quail ---------------------------------------------------------------------------
  // The covey is the unit: it forages in a loose knot, now and then runs across an opening in a
  // stream, and flushes all at once (staggered by a few tenths of a second) away from a threat: the
  // raven low overhead, a stooping hawk, or now and then nothing anyone can see.
  groupRng(g, list) {
    // A group can lose its leader (member cap hit while placing, or a rebuild mid-season); adopt any member.
    if (!g.leader || !g.leader.rng) { g.leader = null; for (const a of list) if (a.group === g) { g.leader = a; break; } }
    return g.leader ? g.leader.rng : null;
  }
  coveyUpdate(g, dt, px, py, pz) {
    const r = this.groupRng(g, this.bySpecies[QU]); if (!r) return;
    const H = this.heights;
    g.t -= dt; g.cool -= dt;
    if (g.state !== G_SETTLE && g.cool <= 0) {
      const dx = px - g.x, dz = pz - g.z;
      if (dx * dx + dz * dz < 48 * 48 && py - H.atXZ(g.x, g.z) < 42) { this.flushCovey(g, px, pz, 'raven'); return; }
      if (r() < dt / 160) { const ang = r() * TAU; this.flushCovey(g, g.x + Math.cos(ang) * 30, g.z + Math.sin(ang) * 30, 'self'); return; }
    }
    if (g.state === G_FORAGE) {
      if (g.t <= 0) {   // run across an opening: 15-40 m, back toward home when strayed
        const hx = g.hx - g.x, hz = g.hz - g.z, hd = Math.hypot(hx, hz);
        let ang = r() * TAU; if (hd > 45) ang = Math.atan2(hz, hx) + (r() - 0.5);
        const d = 15 + r() * 25;
        g.tx = g.x + Math.cos(ang) * d; g.tz = g.z + Math.sin(ang) * d; g.dx = Math.cos(ang); g.dz = Math.sin(ang);
        g.speed = 2.4 + r() * 1.2; g.state = G_RUN;
      }
    } else if (g.state === G_RUN) {
      const ex = g.tx - g.x, ez = g.tz - g.z, d = Math.hypot(ex, ez), step = g.speed * dt;
      if (d <= step) { g.x = g.tx; g.z = g.tz; g.state = G_FORAGE; g.t = 15 + r() * 35; }
      else { g.x += ex / d * step; g.z += ez / d * step; }
    } else if (g.t <= 0) { g.state = G_FORAGE; g.t = 20 + r() * 30; }   // G_SETTLE: everyone down, regrouping
  }
  flushCovey(g, fx, fz, cause = 'raven') {
    if (g.state === G_SETTLE) return;
    const r = this.groupRng(g, this.bySpecies[QU]); if (!r) return;
    let n = 0; for (const a of this.bySpecies[QU]) if (a.group === g) n++;
    if (n) this.emit('flush', { group: g, x: g.x, y: this.heights.atXZ(g.x, g.z), z: g.z, n, cause });
    let ang = Math.atan2(g.z - fz, g.x - fx) + (r() - 0.5) * 0.8;   // away from the threat
    const d = 35 + r() * 40;
    let lx = g.x + Math.cos(ang) * d, lz = g.z + Math.sin(ang) * d;
    const o = this.nearestOak(lx, lz, 30); if (o) { lx = o.x + (lx - o.x) * 0.3; lz = o.z + (lz - o.z) * 0.3; }   // into cover
    g.x = lx; g.z = lz; g.state = G_SETTLE; g.t = 9; g.cool = 40 + r() * 40;
    for (const a of this.bySpecies[QU]) if (a.group === g) {
      a.state = Q_WAIT; a.wait = a.rank * 0.04 + r() * 0.45;
      a.tx = lx + a.ox * 2.2 + (r() - 0.5) * 5; a.tz = lz + a.oz * 2.2 + (r() - 0.5) * 5;
    }
  }
  quUpdate(a, dt) {
    const r = a.rng, g = a.group, H = this.heights;
    a.t -= dt;
    if (a.state === Q_WAIT) {   // crouch, then go
      a.wait -= dt; a.amp = damp(a.amp, 0, 10, dt);
      if (a.wait <= 0) {
        a.sx = a.x; a.sy = a.y; a.sz = a.z; a.ty = H.atXZ(a.tx, a.tz);
        const d = Math.hypot(a.tx - a.sx, a.tz - a.sz);
        a.dur = Math.max(1.5, d / 13); a.peak = 2.5 + r() * 3 + d * 0.03; a.u = 0; a.state = Q_FLY; a.air = 1;
      }
      return;
    }
    if (a.state === Q_FLY) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, ox = a.x, oy = a.y, oz = a.z;
      a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u;
      // up steeply on whirring wings, then a long flat glide down into cover
      const rise = u < 0.25 ? Math.sin(u / 0.25 * Math.PI / 2) : 1 - Math.pow((u - 0.25) / 0.75, 2.2);
      a.y = Math.max(H.atXZ(a.x, a.z) + 0.15, a.sy + (a.ty - a.sy) * u + a.peak * rise);
      const whirr = u < 0.5 || u > 0.93;
      a.amp = damp(a.amp, whirr ? 1 : 0, 25, dt); a.pose = damp(a.pose, 0, 20, dt);
      if (whirr) a.phase += dt * TAU * 19; else a.phase = damp(a.phase, Math.round(a.phase / TAU) * TAU + 0.6, 8, dt);
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = -Math.atan2(vy, vh + 1e-5) * 0.6;
      if (u >= 1) {
        a.state = Q_FORAGE; a.air = 0; a.t = 1 + r() * 3; a.pitch = 0;
        a.ox = a.x - g.x; a.oz = a.z - g.z;   // landed scattered; drift back into a knot
      }
      return;
    }
    // Q_FORAGE: keep to a slot around the covey centre (or a place in the stream while it runs)
    a.air = 0;
    let tx, tz;
    if (g.state === G_RUN) {
      const back = a.rank * 0.75, side = a.oz * 0.35;
      tx = g.x - g.dx * back - g.dz * side; tz = g.z - g.dz * back + g.dx * side;
    } else {
      if (g.state === G_FORAGE) { const k = Math.min(1, dt * 0.15); a.ox -= a.ox * k * (Math.abs(a.ox) > 3 ? 1 : 0); a.oz -= a.oz * k * (Math.abs(a.oz) > 3 ? 1 : 0); }
      if (a.t <= 0) { a.t = 1.5 + r() * 4; a.ox += (r() - 0.5) * 1.2; a.oz += (r() - 0.5) * 1.2; }
      tx = g.x + a.ox; tz = g.z + a.oz;
    }
    const ex = tx - a.x, ez = tz - a.z, d = Math.hypot(ex, ez);
    let speed = 0;
    if (d > 0.25) {
      speed = Math.min(g.state === G_RUN ? 4.5 : 3, d * 2.5);
      a.x += ex / d * speed * dt; a.z += ez / d * speed * dt;
      a.yaw += wrapAngle(Math.atan2(ex, ez) - a.yaw) * Math.min(1, dt * 10);
    } else if (r() < dt * 1.5) a.flickV = 1;   // peck
    a.amp = damp(a.amp, speed > 0.1 ? 1 : 0, 12, dt); a.pose = damp(a.pose, 1, 10, dt);
    a.phase += dt * TAU * speed / 0.14;
    a.pitch = damp(a.pitch, 0, 8, dt);
    a.y = H.atXZ(a.x, a.z);
  }

  // ---- California scrub-jay -----------------------------------------------------------------------
  // A family group moves through the oaks together: the leader flies to a tree 20-90 m off (or drops
  // to the ground under one to forage and, in fall, to bury acorns), the others follow one by one.
  // The Steller's jay does the same in the pines (stellerSpot), and between moves works up its tree in short hops
  // from branch to branch (jayFly with hop > 0), then glides down to the next tree with the group.
  jaySpot(a, o, ground, hop = 0) {
    if (o.conifer) return this.stellerSpot(a, o, ground, hop);
    const r = a.rng, ang = r() * TAU;
    if (ground) {
      const d = (1.5 + r() * 4) * o.scale;
      a.tx = o.x + Math.cos(ang) * d; a.tz = o.z + Math.sin(ang) * d; a.ty = this.heights.atXZ(a.tx, a.tz);
    } else {
      const d = r() * 1.6 * o.scale;
      a.tx = o.x + Math.cos(ang) * d; a.tz = o.z + Math.sin(ang) * d; a.ty = o.y + treeHeight(o) * (0.86 + 0.1 * r());
    }
    a.next = ground ? J_GROUND : J_PERCH;
  }
  // A branch in a pine's crown: out along a limb (30-80 % of the crown's radius at that height), on the side
  // facing a random direction; hop > 0 climbs that much (fraction of the height) above the present perch.
  stellerSpot(a, o, ground, hop) {
    const r = a.rng, H = o.height;
    const ang = hop ? Math.atan2(a.z - o.z, a.x - o.x) + (r() - 0.5) * 1.2 : r() * TAU;   // a hop stays on the same side of the trunk
    if (ground) {
      const d = 1 + r() * Math.max(1.5, 0.12 * H);
      a.tx = o.x + Math.cos(ang) * d; a.tz = o.z + Math.sin(ang) * d; a.ty = this.heights.atXZ(a.tx, a.tz);
    } else {
      const lo = o.sp === 'pinus_sabiniana' ? 0.3 : 0.45;
      const h = hop ? Math.min(0.9, a.hFrac + hop) : lo + r() * 0.25; a.hFrac = h;
      const d = H * crownR(o.sp, h) * (0.3 + 0.5 * r());
      a.tx = o.x + Math.cos(ang) * d; a.tz = o.z + Math.sin(ang) * d; a.ty = o.y + H * h;
    }
    a.next = ground ? J_GROUND : J_PERCH;
  }
  jayFly(a, o, ground, hop = 0) {
    a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tree = o;
    this.jaySpot(a, o, ground, hop);
    const d = Math.hypot(a.tx - a.sx, a.tz - a.sz);
    a.dur = hop ? Math.min(0.9, 0.3 + Math.hypot(d, a.ty - a.sy) / 10) : Math.max(0.8, d / 9); a.u = 0; a.state = J_FLY; a.air = 1;
    if (hop) { a.peak = -0.3; return; }   // a short bound up to the next branch
    // a drop from the perch, low across the gap, and a swoop up into the next crown
    a.peak = ground ? -Math.min(2, d * 0.1) : Math.min(0.4 * Math.max(0, Math.min(a.sy, a.ty) - this.heights.atXZ((a.sx + a.tx) / 2, (a.sz + a.tz) / 2) - 2), d * 0.25);
  }
  sjUpdate(a, dt, px, py, pz) {
    const r = a.rng, g = a.group, H = this.heights;
    a.t -= dt;
    if (a.state === J_FLY) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, ox = a.x, oy = a.y, oz = a.z;
      const e = u * u * (3 - 2 * u);
      a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u;
      a.y = Math.max(H.atXZ(a.x, a.z) + 0.8 * (1 - (u > 0.9 && a.next === J_GROUND ? (u - 0.9) * 10 : 0)), a.sy + (a.ty - a.sy) * e - a.peak * Math.sin(Math.PI * u));
      const glide = u > 0.78 || Math.sin(this.time * TAU * 1.6 + a.phase * 0.05) < -0.45;   // rowing beats with short glides; glide in
      a.amp = damp(a.amp, glide ? 0 : 1, 18, dt); a.pose = damp(a.pose, 0, 14, dt);
      if (!glide) a.phase += dt * TAU * 11;
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = -Math.atan2(vy, vh + 1e-5) * 0.7;
      if (u >= 1) { a.state = a.next; a.air = 0; a.t = 3 + r() * 8; a.pitch = 0; }
      return;
    }
    a.air = 0;
    a.amp = damp(a.amp, 0, 10, dt); a.pose = damp(a.pose, 1, 8, dt);
    if (a.state === J_PERCH) {
      a.pitch = damp(a.pitch, -0.2, 5, dt); if (r() < dt * 0.6) a.flickV = 1; if (r() < dt * 0.3) a.yaw += (r() - 0.5) * 2;
      if (a.tree?.conifer && a.hFrac < 0.84 && a.moveSeen === g.move && r() < dt * 0.08) { this.jayFly(a, a.tree, false, 0.05 + 0.07 * r()); return; }
    }
    else {   // J_GROUND: hops, probes and (in fall) pushes acorns into the ground
      a.pitch = damp(a.pitch, 0, 6, dt);
      if (a.hopU < 1) {   // a two-footed hop: a low arc over 0.16 s, tail flicked up on landing
        a.hopU = Math.min(1, a.hopU + dt / 0.16); const k = a.hopU;
        a.x = a.hopX + a.hopDX * k; a.z = a.hopZ + a.hopDZ * k;
        a.y = H.atXZ(a.x, a.z) + Math.sin(Math.PI * k) * a.hopH;
        if (a.hopU >= 1) a.e1 = 1;
      } else {
        if (r() < dt * (this.season === 'fall' ? 1.4 : 0.8)) a.flickV = 1;   // probing, or pushing an acorn in
        if (r() < dt * 0.5) {
          const h = 0.3 + r() * 0.4; a.yaw += (r() - 0.5) * 1.5;
          a.hopX = a.x; a.hopZ = a.z; a.hopDX = Math.sin(a.yaw) * h; a.hopDZ = Math.cos(a.yaw) * h; a.hopH = 0.03 + h * 0.1; a.hopU = 0;
        }
        a.y = H.atXZ(a.x, a.z);
      }
    }
    const dx = a.x - px, dy = a.y - py, dz = a.z - pz, flush = dx * dx + dy * dy + dz * dz < 10 * 10;
    if (g.leader === a) {
      g.t -= dt;
      if (g.t <= 0 || flush) {   // the group moves on
        const ground = !flush && r() < (this.season === 'fall' ? 0.4 : 0.25);
        const o = ground && r() < 0.5 ? g.tree : g.home.conifer ? (this.ringConifer(g.home.x, g.home.z, 0, 90, r, g.tree) || g.home)
          : (this.ringOak(g.home.x, g.home.z, 0, 90, r, false, g.tree) || g.home);
        g.tree = o; g.ground = ground; g.move++; g.t = 8 + r() * 22;
        a.moveSeen = g.move; this.jayFly(a, o, ground);
      }
    } else if (a.moveSeen !== g.move) {   // follow, one after another
      if (a.wait <= 0) a.wait = 0.4 + a.rank * 0.7 + r() * 1.5;
      a.wait -= dt;
      if (a.wait <= 0 || flush) { a.moveSeen = g.move; a.wait = 0; this.jayFly(a, g.tree, g.ground); }
    }
  }

  // ---- soarers: red-tailed hawk, turkey vulture ---------------------------------------------------
  soarStart(a, cx, cz, R, alt, dir, th, state) {
    a.cx = cx; a.cz = cz; a.R = R; a.alt = alt; a.dir = dir; a.th = th; a.state = state; a.air = 1;
    a.t = state === H_SOAR ? 30 + a.rng() * 60 : 40 + a.rng() * 60; a.V = state === H_SOAR ? 9 : 9.5;
    a.x = cx + R * Math.cos(th); a.z = cz + R * Math.sin(th); a.y = this.heights.atXZ(cx, cz) + alt;
    a.rock = a.rng() * 100;
  }
  // One step around the circle; returns the bank angle for it.
  circle(a, dt, floor) {
    const H = this.heights;
    a.th += a.dir * a.V / a.R * dt;
    a.x = a.cx + a.R * Math.cos(a.th); a.z = a.cz + a.R * Math.sin(a.th);
    const gy = H.atXZ(a.cx, a.cz) + a.alt + 6 * Math.sin(a.th * 0.5 + a.phase);
    a.y = damp(a.y, Math.max(gy, H.atXZ(a.x, a.z) + floor), 0.12, dt);   // a thermal: slow rises, never into the hill
    a.yaw = Math.atan2(-Math.sin(a.th) * a.dir, Math.cos(a.th) * a.dir);
    return a.dir * Math.atan(a.V * a.V / (9.8 * a.R)) * 1.3;   // same sense as the raven's: right turn, left wing up
  }
  // Re-centre the circle on the bird's present heading so a new one starts where it is (no jump).
  joinCircle(a, R, dir) {
    a.R = R; a.dir = dir; a.th = dir > 0 ? -a.yaw : Math.PI - a.yaw;
    a.cx = a.x - R * Math.cos(a.th); a.cz = a.z - R * Math.sin(a.th);
  }
  hkUpdate(a, dt) {
    const r = a.rng, H = this.heights; a.t -= dt; a.flapT -= dt; a.air = 1;
    if (a.state === H_SOAR) {
      const hx = a.hx - a.cx, hz = a.hz - a.cz, hd = Math.hypot(hx, hz);
      a.cx += (0.5 + (hd > 200 ? hx / hd * 1.2 : 0)) * dt; a.cz += (0.25 + (hd > 200 ? hz / hd * 1.2 : 0)) * dt;
      const bank = this.circle(a, dt, 40);
      a.roll = damp(a.roll, bank, 1.5, dt); a.pitch = damp(a.pitch, 0, 2, dt);
      const low = a.y < H.atXZ(a.cx, a.cz) + a.alt - 40;   // working up out of a stoop: flap now and then
      if (a.flapT <= 0 && r() < dt * (low ? 0.4 : 0.04)) a.flapT = 0.8 + r();
      a.amp = damp(a.amp, a.flapT > 0 ? 1 : 0, 6, dt); a.pose = damp(a.pose, 0, 3, dt);
      if (a.flapT > 0) a.phase += dt * TAU * 2.4; else a.phase = damp(a.phase, Math.round(a.phase / Math.PI) * Math.PI, 3, dt);
      if (a.t <= 0) {   // stoop: at a covey in reach (if this observer sees quail), else at open ground below
        let tx = 0, tz = 0, cov = null, bd = 230 * 230;
        if (this.meshes[QU].visible) for (const g of this.coveys) { const dx = g.x - a.x, dz = g.z - a.z, d2 = dx * dx + dz * dz; if (d2 < bd && g.state !== G_SETTLE) { bd = d2; cov = g; } }
        if (cov) { tx = cov.x; tz = cov.z; }
        else { const ang = r() * TAU, d = 30 + r() * 90; tx = a.x + Math.cos(ang) * d; tz = a.z + Math.sin(ang) * d; }
        if (cov || this.openness(tx, tz) > 0.5) {
          a.group = cov; a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tx = tx; a.tz = tz; a.ty = H.atXZ(tx, tz) + 2.5;
          a.dur = Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz) / 24 + 0.8; a.u = 0; a.state = H_STOOP;
          this.emit('stoop', { animal: a, x: a.x, y: a.y, z: a.z, target: cov });
        } else a.t = 15 + r() * 30;
      }
    } else if (a.state === H_STOOP) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, ox = a.x, oy = a.y, oz = a.z, e = u * u * (1.6 - 0.6 * u);   // tips over slowly, then falls fast
      a.x = a.sx + (a.tx - a.sx) * e; a.z = a.sz + (a.tz - a.sz) * e; a.y = a.sy + (a.ty - a.sy) * e;
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = damp(a.pitch, -Math.atan2(vy, vh + 1e-5) * 0.9, 4, dt); a.roll = damp(a.roll, 0, 4, dt);
      a.amp = damp(a.amp, 0, 6, dt); a.pose = damp(a.pose, u > 0.15 ? 0.75 : 0.2, 3, dt);   // wings swept back
      if (u > 0.9 && a.group) { this.flushCovey(a.group, a.x, a.z, 'hawk'); a.group = null; }
      if (u >= 1) { a.state = H_PULL; a.t = 2.5; a.speed = 18; }
    } else {   // H_PULL: wings open, flap up out of the dive, then rejoin a circle and climb in it
      a.speed = damp(a.speed, 9, 0.8, dt);
      a.x += Math.sin(a.yaw) * a.speed * dt; a.z += Math.cos(a.yaw) * a.speed * dt;
      a.y = Math.max(a.y + 3.5 * dt, H.atXZ(a.x, a.z) + 2);
      a.pitch = damp(a.pitch, 0.35, 3, dt); a.pose = damp(a.pose, 0, 6, dt); a.amp = damp(a.amp, 1, 6, dt); a.phase += dt * TAU * 3;
      if (a.t <= 0) {
        this.joinCircle(a, 40 + r() * 45, r() < 0.5 ? 1 : -1);
        a.alt = 100 + r() * 150; a.state = H_SOAR; a.t = 50 + r() * 70;
      }
    }
  }
  tvUpdate(a, dt) {
    const r = a.rng, H = this.heights; a.t -= dt; a.air = 1;
    // teetering: an uneven rock on the dihedral, the vulture's signature at any distance
    const rock = 0.2 * Math.sin(this.time * 1.7 + a.rock) + 0.09 * Math.sin(this.time * 3.3 + a.rock * 2.1);
    if (a.state === V_SOAR) {
      a.cx += 0.4 * dt; a.cz += 0.2 * dt;   // drifts on the breeze
      const bank = this.circle(a, dt, 30);
      a.roll = damp(a.roll, bank * 0.8 + rock, 3, dt); a.pitch = damp(a.pitch, 0.05, 2, dt);
      if (a.t <= 0) {   // set off on a long straight glide, quartering the slopes, back toward home if strayed
        const hx = a.hx - a.x, hz = a.hz - a.z, hd = Math.hypot(hx, hz);
        const ang = hd > 250 ? Math.atan2(hx, hz) + (r() - 0.5) * 0.6 : a.yaw + (r() - 0.5) * 1.2;
        const d = 150 + r() * 200;
        a.sx = a.x; a.sz = a.z; a.tx = a.x + Math.sin(ang) * d; a.tz = a.z + Math.cos(ang) * d;
        a.alt = 40 + r() * 140; a.u = 0; a.dur = d / a.V; a.state = V_GLIDE;
      }
    } else {   // V_GLIDE
      a.u = Math.min(1, a.u + dt / a.dur);
      const want = Math.atan2(a.tx - a.sx, a.tz - a.sz);
      a.yaw += wrapAngle(want - a.yaw) * Math.min(1, dt * 0.6);   // turns out of the circle onto the line
      a.x += Math.sin(a.yaw) * a.V * dt; a.z += Math.cos(a.yaw) * a.V * dt;
      a.y = damp(a.y, Math.max(H.atXZ(a.x, a.z) + a.alt, H.atXZ(a.x, a.z) + 30), 0.15, dt);
      a.roll = damp(a.roll, rock * 1.2, 3, dt); a.pitch = damp(a.pitch, 0.05, 2, dt);
      if (a.u >= 1) { this.joinCircle(a, 50 + r() * 60, r() < 0.5 ? 1 : -1); a.state = V_SOAR; a.t = 40 + r() * 80; }
    }
    a.amp = damp(a.amp, 0, 3, dt); a.pose = damp(a.pose, 0, 3, dt);   // hardly ever flaps
  }

  // The animal of a species nearest to (x, y, z) within maxR, or null (for sound.js: calls placed on
  // real birds). No allocation.
  nearestOf(code, x, y, z, maxR = Infinity) {
    const s = INDEX[code]; if (s === undefined || !this.meshes[s].visible) return null;
    const arr = this.bySpecies[s]; let best = null, bd = maxR * maxR;
    for (let k = 0; k < arr.length; k++) { const a = arr[k], dx = a.x - x, dy = a.y - y, dz = a.z - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; best = a; } }
    return best;
  }
  // Every animal of a species within maxR of (x, y, z), pushed into out (cleared first). For sound.js.
  within(code, x, y, z, maxR, out = []) {
    out.length = 0;
    const s = INDEX[code]; if (s === undefined || !this.meshes[s].visible) return out;
    const arr = this.bySpecies[s], r2 = maxR * maxR;
    for (let k = 0; k < arr.length; k++) { const a = arr[k], dx = a.x - x, dy = a.y - y, dz = a.z - z; if (dx * dx + dy * dy + dz * dz < r2) out.push(a); }
    return out;
  }
  // Is this animal still in the live set (not dropped by a rebuild)?
  alive(a) { return this.byId.get(a.id) === a; }
  // debugging: flush the covey nearest to the player, as if the raven had dropped onto it
  flush() {
    const P = this.flight.pos; let best = null, bd = Infinity;
    for (const g of this.coveys) { const d = Math.hypot(g.x - P.x, g.z - P.z); if (d < bd) { bd = d; best = g; } }
    if (best) { best.cool = 0; if (best.state === G_SETTLE) best.state = G_FORAGE; this.flushCovey(best, P.x, P.z, 'debug'); }
    return best ? Math.round(bd) : null;
  }
  // debugging: send the hawk nearest the player into a stoop on its next frame
  stoop() {
    const P = this.flight.pos, h = this.nearestOf('buteo_jamaicensis', P.x, P.y, P.z);
    if (!h) return null;
    if (h.state === H_SOAR) h.t = 0;
    return Math.round(Math.hypot(h.x - P.x, h.y - P.y, h.z - P.z));
  }

  // ---- frame --------------------------------------------------------------------------------------
  update(dt, season, hour) {
    const t0 = performance.now();
    this.time += dt; this.hour = hour;
    if (season !== this.season) { this.season = season; this.dirty = true; }
    const want = typeof window !== 'undefined' && window.__we?.playerSpecies;   // a species switch elsewhere, when one exists
    if (want && want !== this.observer) this.setObserver(want);
    const P = this.flight.pos;
    if (this.veg.version !== this.vegVersion && this.veg.oaks.length) { this.indexOaks(); this.dirty = true; }
    if (this.veg.nearVersion !== this.nearVersion && this.perceived.has('cyanocitta_stelleri')) this.indexConifers();
    if (!this.priorReady && performance.now() < this.priorDeadline) return;   // wait (briefly) for the occurrence prior
    let fresh = false;   // slots were reassigned: every animal writes its matrix this frame
    if (this.dirty || !this.lastCenter || Math.hypot(P.x - this.lastCenter[0], P.z - this.lastCenter[1]) > REBUILD_MOVE) { this.rebuild(P.x, P.z); fresh = true; }
    const odd = (++this.frame) & 1;
    const px = P.x, py = P.y, pz = P.z;
    const list = this.list, e = this._e, q = this._q, p = this._p, s = this._s, m = this._m;
    if (this.meshes[QU].visible) for (let k = 0; k < this.coveys.length; k++) this.coveyUpdate(this.coveys[k], dt, px, py, pz);
    const C = this.camPos, cx = C.x, cy = C.y, cz = C.z;
    const dt0 = dt;
    for (let k = 0; k < list.length; k++) {
      const a = list[k], sp = a.sp;
      const ex = a.x - cx, ey = a.y - cy, ez = a.z - cz, d2 = ex * ex + ey * ey + ez * ez;
      a.acc += dt0;
      if (!fresh && !a.air && d2 > LOD_R2 && ((k & 1) === odd)) continue;   // far and on the ground: every other frame
      const dt = a.acc; a.acc = 0;
      a.flick = sp === WP ? a.flick : damp(a.flick, 0, 1, dt);
      if (sp === SQ) this.sqUpdate(a, dt, px, py, pz);
      else if (sp === WP) this.wpUpdate(a, dt, px, py, pz);
      else if (sp === RV) this.rvUpdate(a, dt);
      else if (sp === DR) this.drUpdate(a, dt);
      else if (sp === QU) this.quUpdate(a, dt);
      else if (sp === SJ || sp === ST) this.sjUpdate(a, dt, px, py, pz);
      else if (sp === HK) this.hkUpdate(a, dt);
      else this.tvUpdate(a, dt);
      if (a.flickV > 0 && a.sp !== WP) { a.flick = Math.max(a.flick, Math.sin(Math.min(1, 1 - a.flickV) * Math.PI)); a.flickV -= dt * 3; }
      if (a.phase > 1e4) a.phase -= TAU * 1000;
      const mesh = this.meshes[a.sp], o = a.slot;
      // birds in flight grow with distance from the eye so they stay a few pixels wide
      let grow = 1;
      if (a.air || a.fly > 0.01) {
        a.fly = damp(a.fly, a.air, 3, dt);
        grow = 1 + FLY_GROW * a.fly * clamp01((Math.sqrt(d2) - FLY_NEAR) / (FLY_FAR - FLY_NEAR));
      }
      e.set(a.pitch, a.yaw, a.roll, 'YXZ'); q.setFromEuler(e); p.set(a.x, a.y, a.z); s.setScalar(a.size * SPECIES[sp].scale * grow);
      m.compose(p, q, s); m.toArray(mesh.instanceMatrix.array, o * 16);
      const an = mesh.geometry.attributes.aAnim.array;
      an[o * 4] = a.phase % TAU; an[o * 4 + 1] = a.amp; an[o * 4 + 2] = a.pose; an[o * 4 + 3] = a.flick;
      const a2 = this.anim2[sp];
      if (a2) { this.extra(a, dt); a2[o * 4] = a.e0; a2[o * 4 + 1] = a.e1; a2[o * 4 + 2] = 0; a2[o * 4 + 3] = a.variant; }
    }
    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k], n = mesh.count; if (!n) continue;
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
      const an = mesh.geometry.attributes.aAnim; an.clearUpdateRanges(); an.addUpdateRange(0, n * 4); an.needsUpdate = true;
    }
    // (the shadow casters follow the meshes inside shadows.js)
    const meshDeer = this.meshOn(DR);
    if (this.planar) { const d = this.meshes[DR]; this.planar.count = d.count; this.planar.visible = d.visible && d.count > 0 && !meshDeer; }
    for (const k in DRAWN) if (this.meshOn(k)) this.distribute(k);
    this.placeTags();
    this.ms = this.ms * 0.95 + (performance.now() - t0) * 0.05;
  }

  // The drawn meshes' second channel (aAnim2.x, .y; see animalModels.js rig templates), eased per animal.
  extra(a, dt) {
    if (a.sp === SQ) {
      a.e0 = damp(a.e0, a.state === S_CLIMB || a.state === S_DOWN ? 1 : 0, 8, dt);   // legs splayed round the trunk
      a.e1 = damp(a.e1, a.flick, 5, dt);                                             // the tail tip lags the flick
    } else if (a.sp === QU) {
      const fly = a.state === Q_FLY;
      a.e0 = damp(a.e0, fly && a.amp < 0.5 ? 1 : 0, 6, dt);                          // wings set and bowed in the glide
      a.e1 = damp(a.e1, fly ? (a.u > 0.85 ? 1 : 0.4) : 0, 8, dt);                    // tail fanned to land
    } else if (a.sp === SJ || a.sp === ST) {
      const fly = a.state === J_FLY;
      a.e0 = damp(a.e0, fly && a.amp < 0.5 ? 0.4 : 0, 6, dt);
      a.e1 = damp(a.e1, fly ? (a.u > 0.75 ? 1 : 0.35) : 0, a.e1 > 0.9 && !fly ? 3 : 8, dt);   // fanned in, and briefly on a hop's landing
    } else if (a.sp === HK) {
      const stoop = a.state === H_STOOP;
      a.e0 = damp(a.e0, stoop ? a.pose : 0, 4, dt);                                  // hands droop as the wings tuck
      a.e1 = damp(a.e1, stoop ? -a.pose : a.state === H_PULL ? 0.3 : 0, 4, dt);       // tail closed in the dive, fanned pulling out
    }
  }

  // ---- HUD and tags (main.js HUD tick) ------------------------------------------------------------
  // "4 squirrels · 2 woodpeckers · 1 raven" within NEAR_R of the player, at most 4 times a second.
  describe(now = performance.now()) {
    if (now - this.lastDescribe < 250) return this.text;
    this.lastDescribe = now;
    const P = this.flight.pos, c = this.counts; c.fill(0);
    for (const a of this.list) { const dx = a.x - P.x, dy = a.y - P.y, dz = a.z - P.z; if (dx * dx + dy * dy + dz * dz < NEAR_R * NEAR_R) c[a.sp]++; }
    const parts = [];
    for (let k = 0; k < SPECIES.length; k++) if (c[k]) parts.push(`${c[k]} ${c[k] === 1 ? SPECIES[k].one : SPECIES[k].many}`);
    this.text = parts.length ? parts.join(' · ') : (this.list.length ? `none within ${NEAR_R} m` : '–');
    this.scanTags();
    return this.text;
  }
  get tagsOn() { return this.identify ? this.identify.tagsOn : true; }
  scanTags() {
    this.tagged.length = 0;
    if (!this.tagsOn) return;
    const cam = this.camera.position, cand = [];
    for (const a of this.list) {
      const dx = a.x - cam.x, dy = a.y - cam.y, dz = a.z - cam.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < TAG_R * TAG_R) cand.push([d2, a]);
    }
    cand.sort((x, y) => x[0] - y[0]);
    for (let i = 0; i < Math.min(TAG_MAX, cand.length); i++) this.tagged.push(cand[i][1]);
  }
  tagMaterial(sp) {
    if (this.tagMats[sp]) return this.tagMats[sp];
    const name = this.names[SPECIES[sp].code] || SPECIES[sp].common || SPECIES[sp].one, font = '600 30px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
    const c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = font; const w = Math.ceil(g.measureText(name).width) + 28; c.width = w; c.height = 46;
    g.font = font; g.fillStyle = 'rgba(28,20,10,0.66)'; g.beginPath(); g.roundRect(1, 1, w - 2, 44, 12); g.fill();
    g.fillStyle = '#ffe2b8'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, w / 2, 24);
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false, fog: false });
    m.userData.aspect = w / 46;
    return (this.tagMats[sp] = m);
  }
  placeTags() {   // per frame: follow the tagged animals (at most TAG_MAX sprites)
    const on = this.tagsOn; this.tagGroup.visible = on;
    const H = 0.028; let used = 0;
    if (on) for (const a of this.tagged) {
      if (!this.byId.has(a.id)) continue;
      let sp = this.tagPool[used];
      if (!sp) { sp = new THREE.Sprite(this.tagMaterial(a.sp)); sp.renderOrder = 19; this.tagPool.push(sp); this.tagGroup.add(sp); }
      const m = this.tagMaterial(a.sp); if (sp.material !== m) sp.material = m;
      sp.scale.set(H * m.userData.aspect, H, 1);
      sp.position.set(a.x, a.y + TAG_DY[a.sp], a.z); sp.visible = true; used++;
    }
    for (let i = used; i < this.tagPool.length; i++) this.tagPool[i].visible = false;
  }

  // debugging: { total, squirrel, woodpecker, raven, deer, ms }
  get stats() {
    const o = { total: this.list.length, ms: +this.ms.toFixed(3) };
    SPECIES.forEach((sp, k) => { o[sp.one] = this.bySpecies[k].length; });
    return o;
  }
}
