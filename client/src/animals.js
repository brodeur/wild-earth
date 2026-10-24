import * as THREE from 'three';
import { mulberry32 } from './trees.js';
import { hash } from './vegetation.js';
import { localXY } from './goto.js';
import { buildSquirrel, buildWoodpecker, buildRaven, buildDeer, animalMaterial } from './animalModels.js';

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

const LIVE_R = 400, REBUILD_MOVE = 100, NEAR_R = 150, TAG_R = 40, TAG_MAX = 6, BUCKET = 30;
const TAU = Math.PI * 2;
const CLING_PITCH = -1.72;   // a clinging woodpecker: nose up, tipped just past vertical so the tail braces on the bark

// FNV-1a over the oak id with the acorn game's stash salt: the same "one oak in eight has a stash
// hole" rule as acorns.js oakInfo(), so woodpecker granaries are the acorn game's stash trees.
function seedOf(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const isStashTree = oak => mulberry32(seedOf(oak.id, 0x57a5))() < 1 / 8;

// Suitability by habitat class (pipeline/habitat.py codes): 1 oak woodland, 2 conifer, 3 mixed,
// 4 chaparral, 5 grassland, 6 riparian, 7 water, 8 barren, 9 human (rewilded: treat as grassland).
const SUIT = {
  sciurus_griseus:         { 1: 1, 2: 0.45, 3: 0.9, 4: 0.1, 5: 0.2, 6: 0.75, 9: 0.15 },
  melanerpes_formicivorus: { 1: 1, 2: 0.2, 3: 0.7, 4: 0.05, 5: 0.35, 6: 0.6, 9: 0.3 },
  corvus_corax:            { 1: 0.6, 2: 0.45, 3: 0.55, 4: 0.5, 5: 0.6, 6: 0.6, 7: 0.4, 8: 0.6, 9: 0.6 },
  odocoileus_hemionus:     { 1: 0.8, 2: 0.3, 3: 0.5, 4: 0.35, 5: 0.7, 6: 1, 9: 0.6 },
};
// Expected individuals (or groups) per 30 m cell at suitability 1, and season multipliers.
const SEASON = {
  sciurus_griseus:         { fall: 1.25, winter: 0.8, spring: 1, summer: 0.9 },
  melanerpes_formicivorus: { fall: 1.2, winter: 1, spring: 1, summer: 0.9 },
  corvus_corax:            { fall: 1, winter: 1, spring: 1, summer: 1 },
  odocoileus_hemionus:     { fall: 1, winter: 1, spring: 1, summer: 1 },
};
const SPECIES = [
  { code: 'sciurus_griseus', one: 'squirrel', many: 'squirrels', k: 0.45, salt: 9101, cap: 160, scale: 1, build: buildSquirrel },
  { code: 'melanerpes_formicivorus', one: 'woodpecker', many: 'woodpeckers', k: 0.075, salt: 9202, cap: 200, scale: 1, build: buildWoodpecker },
  { code: 'corvus_corax', one: 'raven', many: 'ravens', k: 0.022, salt: 9303, cap: 60, scale: 1, build: buildRaven },
  { code: 'odocoileus_hemionus', one: 'deer', many: 'deer', k: 0.022, salt: 9404, cap: 80, scale: 1, build: buildDeer },
];
const SQ = 0, WP = 1, RV = 2, DR = 3;

// states
const S_PAUSE = 0, S_RUN = 1, S_CLIMB = 2, S_OUT = 3, S_SIT = 4, S_IN = 5, S_DOWN = 6;   // squirrel
const W_CLING = 10, W_TOP = 11, W_FLY = 12;                                             // woodpecker
const R_SOAR = 20, R_GLIDE = 21, R_PERCH = 22, R_CLIMB = 23;                           // raven
const D_WALK = 30, D_GRAZE = 31, D_BED = 32;                                           // deer

const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
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
    Object.assign(this, { tile, flight, veg, camera, identify });
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
      this.group.add(mesh);
      sp.tris = model.tris;
      return mesh;
    });
    this.tris = Object.fromEntries(SPECIES.map(sp => [sp.one, sp.tris]));
    // oak lookup (rebuilt when the vegetation rebuilds)
    this.oaks = []; this.oakGrid = new Map(); this.granary = new Uint8Array(0);
    // temporaries
    this._t = { x: 0, y: 0, z: 0, r: 0 }; this._p = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._s = new THREE.Vector3(); this._m = new THREE.Matrix4();
    // name tags
    this.tagGroup = new THREE.Group(); this.tagGroup.renderOrder = 19; this.group.add(this.tagGroup);
    this.tagPool = []; this.tagMats = {}; this.tagged = [];
    this.setObserver((typeof window !== 'undefined' && window.__we?.playerSpecies) || 'corvus_corax');
  }

  // ---- perception --------------------------------------------------------------------------------
  setObserver(code) {
    this.observer = code;
    const list = this.tile.perception?.perceives?.[code];
    this.perceived = new Set(list || SPECIES.map(s => s.code));   // no matrix: everything
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
        if (!live[s]) continue;
        const sp = SPECIES[s], suit = SUIT[sp.code][cls] || 0; if (!suit) continue;
        let f = suit;
        if (s === SQ) f *= 0.25 + 0.75 * Math.min(1, tree * 1.5);
        else if (s === WP) f *= 0.3 + 0.7 * Math.min(1, tree * 2);
        else if (s === RV) f *= 0.6 + 0.6 * edge;
        else f *= 0.6 + 0.5 * edge;
        const lambda = sp.k * f * this.priorAt(sp.code, cx, cn) * (SEASON[sp.code][this.season] || 1);
        const rnd = mulberry32(hash(i, j, sp.salt));
        if (rnd() >= lambda) continue;
        this.spawnCell(s, i, j, cx, cn, rnd, keep);
      }
    }
    // drop animals whose home cell left the live set; rebuild the per-species slot lists
    for (const [id, a] of this.byId) if (!keep.has(id)) this.byId.delete(id);
    this.list = [...this.byId.values()];
    this.bySpecies = SPECIES.map(() => []);
    for (const a of this.list) { const arr = this.bySpecies[a.sp]; if (arr.length < SPECIES[a.sp].cap) { a.slot = arr.length; arr.push(a); } else a.slot = -1; }
    this.list = this.list.filter(a => a.slot >= 0);
    this.bySpecies.forEach((arr, s) => { this.meshes[s].count = arr.length; });
    this.tagged.length = 0;
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
    } else {
      const n = 2 + Math.floor(rnd() * 3), g = { hx: x, hz: z, leader: null, wx: x, wz: z };
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.group = g; a.ox = m ? (rnd() - 0.5) * 8 : 0; a.oz = m ? (rnd() - 0.5) * 8 : 0;
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
      group: null, ox: 0, oz: 0,
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
    const d = Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz);
    a.dur = Math.max(0.5, d / 8); a.arc = Math.min(4, d * 0.12) + 0.3; a.u = 0; a.state = W_FLY; a.speed = d;
  }
  wpUpdate(a, dt, px, py, pz) {
    const r = a.rng; a.t -= dt;
    if (a.state === W_FLY) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, d = a.speed;
      const ox = a.x, oy = a.y, oz = a.z;
      a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u;
      a.y = a.sy + (a.ty - a.sy) * u + a.arc * Math.sin(Math.PI * u) + 0.25 * Math.sin(u * d / 2.5 * TAU) * Math.sin(Math.PI * u);
      // bounding flight: bursts of quick beats with the wings shut between them; flap through take-off and landing
      const burst = u < 0.15 || u > 0.8 || Math.sin(this.time * TAU * 2.2 + a.phase * 0.1) > -0.2;
      a.amp = damp(a.amp, burst ? 1 : 0, 20, dt); a.pose = damp(a.pose, burst ? 0 : 0.8, 20, dt);
      a.phase += dt * TAU * 13;
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = u > 0.85 && a.next === W_CLING ? damp(a.pitch, CLING_PITCH, 10, dt) : -Math.atan2(vy, vh + 1e-5) * 0.7;
      a.flick = 0;
      if (u >= 1) {
        a.state = a.next; a.amp = 0;
        a.t = a.state === W_CLING ? (a.tree === a.anchor && this.season === 'fall' ? 6 : 3) + r() * 9 : 4 + r() * 10;
        if (a.state === W_CLING) a.yaw = a.face + Math.PI;
      }
      return;
    }
    a.amp = damp(a.amp, 0, 10, dt); a.pose = damp(a.pose, 1, 8, dt);
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
      if (a.tree !== a.anchor && q < (fall ? 0.55 : 0.3)) this.wpFly(a, a.anchor, false);
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
        if (a.state !== D_WALK && a.t <= 0) {   // next waypoint: dry ground within 90 m of home
          for (let k = 0; k < 4; k++) {
            const x = g.hx + (r() - 0.5) * 180, z = g.hz + (r() - 0.5) * 180, c = this.tile.habitat.at(x, -z);
            if (c !== 7 && c !== 2) { g.wx = x; g.wz = z; break; }
          }
          a.state = D_WALK;
        }
        if (a.state === D_WALK) {
          const ex = g.wx - a.x, ez = g.wz - a.z, d = Math.hypot(ex, ez);
          if (d < 1) { a.state = D_GRAZE; a.t = 6 + r() * 14; }
          else { speed = 1; a.x += ex / d * dt; a.z += ez / d * dt; a.yaw += wrapAngle(Math.atan2(ex, ez) - a.yaw) * Math.min(1, dt * 2); }
        }
      } else {   // follow the leader at a loose offset
        const L = g.leader, ex = L.x + a.ox - a.x, ez = L.z + a.oz - a.z, d = Math.hypot(ex, ez);
        if (d > (a.state === D_WALK ? 0.6 : 2.5)) {
          a.state = D_WALK; speed = Math.min(1.4, 0.4 + d * 0.3);
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

  // ---- frame --------------------------------------------------------------------------------------
  update(dt, season, hour) {
    const t0 = performance.now();
    this.time += dt; this.hour = hour;
    if (season !== this.season) { this.season = season; this.dirty = true; }
    const want = typeof window !== 'undefined' && window.__we?.playerSpecies;   // a species switch elsewhere, when one exists
    if (want && want !== this.observer) this.setObserver(want);
    const P = this.flight.pos;
    if (this.veg.version !== this.vegVersion && this.veg.oaks.length) { this.indexOaks(); this.dirty = true; }
    if (!this.priorReady && performance.now() < this.priorDeadline) return;   // wait (briefly) for the occurrence prior
    if (this.dirty || !this.lastCenter || Math.hypot(P.x - this.lastCenter[0], P.z - this.lastCenter[1]) > REBUILD_MOVE) this.rebuild(P.x, P.z);
    const px = P.x, py = P.y, pz = P.z;
    const list = this.list, e = this._e, q = this._q, p = this._p, s = this._s, m = this._m;
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      a.flick = a.sp === WP ? a.flick : damp(a.flick, 0, 1, dt);
      if (a.sp === SQ) this.sqUpdate(a, dt, px, py, pz);
      else if (a.sp === WP) this.wpUpdate(a, dt, px, py, pz);
      else if (a.sp === RV) this.rvUpdate(a, dt);
      else this.drUpdate(a, dt);
      if (a.flickV > 0 && a.sp !== WP) { a.flick = Math.max(a.flick, Math.sin(Math.min(1, 1 - a.flickV) * Math.PI)); a.flickV -= dt * 3; }
      if (a.phase > 1e4) a.phase -= TAU * 1000;
      const mesh = this.meshes[a.sp], o = a.slot;
      e.set(a.pitch, a.yaw, a.roll, 'YXZ'); q.setFromEuler(e); p.set(a.x, a.y, a.z); s.setScalar(a.size * SPECIES[a.sp].scale);
      m.compose(p, q, s); m.toArray(mesh.instanceMatrix.array, o * 16);
      const an = mesh.geometry.attributes.aAnim.array;
      an[o * 4] = a.phase % TAU; an[o * 4 + 1] = a.amp; an[o * 4 + 2] = a.pose; an[o * 4 + 3] = a.flick;
    }
    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k], n = mesh.count; if (!n) continue;
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
      const an = mesh.geometry.attributes.aAnim; an.clearUpdateRanges(); an.addUpdateRange(0, n * 4); an.needsUpdate = true;
    }
    this.placeTags();
    this.ms = this.ms * 0.95 + (performance.now() - t0) * 0.05;
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
    const name = this.names[SPECIES[sp].code] || SPECIES[sp].one, font = '600 30px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
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
      sp.position.set(a.x, a.y + (a.sp === DR ? 2.1 : a.sp === RV ? 0.7 : 0.5), a.z); sp.visible = true; used++;
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
