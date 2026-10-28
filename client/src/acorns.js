import * as THREE from 'three';
import { mulberry32 } from './trees.js';
import { fieldGuide, acornSpecies, ACORNS } from './fieldguide.js';
import { GameNet } from './net.js';
import { trunkAt } from './animals.js';

// Acorn stash, the raven's fall forage-and-cache loop (docs/game-acorn-stash.md).
// Living oaks past the sapling stage near the raven carry acorns and, about one in eight, a stash hole on the trunk. Everything
// about an oak (acorn count and places, whether it has a hole, its capacity and height) is derived
// from a hash of the tree's stable id, so every player finds the same acorns in the same trees.
// Only oaks within LIVE_R of the raven get objects. Glows are billboards whose intensity is
// computed in the vertex shader from the distance to the camera: no per-frame CPU work for them.
//
// v2 (docs/game-acorn-stash.md, "v2"): the acorn game is a living world. Acorn woodpeckers, western gray
// squirrels and the ambient ravens (animals.js) gather from the same acorns as the player, through the same
// state and events (world, applyEvent below): woodpecker families hammer them into a granary, squirrels bury
// them one by one (a fading dug mark), ravens cache them under a shrub. A species leaderboard in the game HUD
// counts each species' acorns for the round (Start game: ROUND_S of game time) and for this world (tile +
// season, in localStorage beside the v1 state); L hides it. AI collectors work only while a game is running.
//
// v3 (docs/game-acorn-stash.md, "v3: shared world"): when the page's server has the game (net.js feature-detects
// GET /api/game), Start game joins the server's world for this tile and season. `world` is then the server's plus
// this client's events not yet answered (a prediction); dispatch sends each event, remote ones arrive through
// remote(), a rejected one rolls back (adoptWorld). The server runs the round; the AI collectors run in one
// browser per world (aiLocal, read by animals.js). Without the endpoint everything below is v2, offline.
//
// v4 (docs/game-acorn-stash.md, "v4: defence and pilfering"): stores get robbed and defended. Digging up someone
// else's buried acorn (a pilfer) scores for the digger's species and against the owner's; a raven or squirrel (AI
// jays and squirrels too) can pull an acorn from a woodpecker granary (a 'raid') when no family member is within
// RAID_GUARD_R; the family defends (animals.js: the rally call, one or two birds diving at the raider), and a hit is a
// 'mob' event: the raid interrupted, or the stolen acorn dropped, and the raider driven off for DRIVEN_S. The
// player's raid is proximity, like the raven's deposit: hold by the granary's trunk (raven) or climb it (squirrel).
// The board gains a "raided N" line per species (granary raids and pilfered caches, this round and this season).

const LIVE_R = 300;            // m: oaks within this get acorn and stash objects
const REFRESH_S = 0.5;         // s between live-set checks
const REFRESH_MOVE = 10;       // m the raven must move (or the forest rebuild) before the live set is rebuilt
const ACORN_CAP = 6000, STASH_CAP = 1000;
const PICK_R = 6, DEPOSIT_R = 6, CARRY_MAX = 3, DEPOSIT_BEAT = 0.6;
const PLAYER_CAP = { corvus_corax: CARRY_MAX, sciurus_griseus: 1, melanerpes_formicivorus: 1 };   // a squirrel or woodpecker holds one
const STASH_ODDS = 1 / 8;

// FNV-1a over a string, then a salt mix: a 32-bit seed for mulberry32.
function seedOf(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Acorns per oak from the fall mast score (0..100) and the season. Spring and summer: at most one,
// present with probability score/100 (the design says "one at most"; this keeps it tied to the data).
export function acornCount(mast, season, r) {
  const fall = 1 + Math.round(mast / 25);
  if (season === 'fall') return fall;
  if (season === 'winter') return Math.round(fall / 2);
  return r < mast / 100 ? 1 : 0;
}

// Everything deterministic about one oak. `oak` is a record from Vegetation.oaks.
// A snag (dead) drops no acorns and a sapling bears none; neither gets a stash hole. Every other oak
// keeps its own hashed streams, so the same mature and veteran trees carry the same acorns and holes.
export const bearsAcorns = oak => !oak.snag && oak.cls !== 'sapling';
export function oakInfo(oak, mast, season, heights) {
  if (!bearsAcorns(oak)) return { acorns: [], stash: null };
  const s = oak.scale;
  const rnd = mulberry32(seedOf(oak.id, 0xacc0));
  const count = acornCount(mast, season, rnd());
  const acorns = [];
  for (let n = 0; n < count; n++) {
    const inBranches = rnd() < 0.35, a = rnd() * Math.PI * 2, u = rnd(), v = rnd(), spin = rnd();
    let r, x, z, y;
    if (inBranches) {   // lower branches: 1.2..2.5 m up, out from the trunk
      r = (0.6 + u * 1.6) * s; x = oak.x + Math.cos(a) * r; z = oak.z + Math.sin(a) * r;
      y = heights.atXZ(x, z) + 1.2 + v * 1.3;
    } else {            // on the ground under the canopy
      r = Math.sqrt(u) * 3.5 * s; x = oak.x + Math.cos(a) * r; z = oak.z + Math.sin(a) * r;
      y = heights.atXZ(x, z) + ACORN_R * 1.1;   // lying on the ground (it sat 22 cm up when the nut was 70 cm across)
    }
    acorns.push({ n, x, y, z, spin, branch: inBranches, key: `${oak.id}:${n}`, oak: oak.id, species: oak.species });
  }
  // Stash hole: drawn from its own stream so it never depends on the acorn count (which changes with season).
  const rs = mulberry32(seedOf(oak.id, 0x57a5));
  let stash = null;
  if (rs() < STASH_ODDS) {
    const capacity = 3 + Math.floor(rs() * 6);          // 3..8
    let h = 1.5 + rs() * 1.5;                           // 1.5..3.0 m above the ground
    const facing = rs() * Math.PI * 2;                   // world angle of the hole's outward normal
    stash = { capacity, facing, ...trunkPoint(oak, h) };
  }
  return { acorns, stash };
}

// A point on the trunk surface at height h above the ground, facing `facing` (set by the caller),
// following the variant's lean. Trunk geometry: limb along +y from the base, rotateZ(lean), rotateY(leanDir);
// the instance adds rotateY(rot), uniform scale and a base 0.3 m below the ground.
const _p = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
function trunkPoint(oak, h) {
  const st = oak.stem, s = oak.scale;
  const topY = s * st.len * Math.cos(st.lean) - 0.3;   // trunk top above the ground
  h = Math.min(h, topY * 0.85);                          // keep the hole on the trunk, below the fork
  const t = (h + 0.3) / (s * Math.cos(st.lean));         // distance along the trunk axis (geometry space)
  _p.set(0, t, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), st.lean).applyAxisAngle(new THREE.Vector3(0, 1, 0), st.leanDir)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), oak.rot).multiplyScalar(s);
  const radius = s * (st.r0 + (st.r1 - st.r0) * Math.min(1, t / st.len));
  return { ax: oak.x + _p.x, ay: oak.y - 0.3 + _p.y, az: oak.z + _p.z, trunkR: radius, h };
}

// Billboard glow: camera-facing quad, size and intensity from the distance to the camera, in the vertex shader.
function glowMaterial({ color, near, far, sizeNear, sizeFar, ring = false }) {
  return new THREE.ShaderMaterial({
    defines: ring ? { RING: 1 } : {},
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uNear: { value: near }, uFar: { value: far },
      uSizeNear: { value: sizeNear }, uSizeFar: { value: sizeFar }, uVisible: { value: 1 },
    },
    vertexShader: /* glsl */`
      attribute float aFull;
      uniform float uNear, uFar, uSizeNear, uSizeFar, uVisible;
      varying vec2 vUv; varying float vI;
      void main() {
        vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float d = distance(c.xyz, cameraPosition);
        float t = smoothstep(uNear, uFar, d);
        vI = (1.0 - t) * uVisible * (1.0 - aFull);
        vec4 mv = viewMatrix * c;
        mv.xyz += normalize(-mv.xyz) * min(0.6, d * 0.3);   // nudge toward the eye so ground and bark do not clip it
        mv.xy += position.xy * mix(uSizeNear, uSizeFar, t);
        vUv = position.xy;
        gl_Position = vI > 0.001 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);   // off: outside the clip volume
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying vec2 vUv; varying float vI;
      void main() {
        float r = length(vUv);
        #ifdef RING
          float a = exp(-pow((r - 0.55) / 0.16, 2.0)) + 0.2 * (1.0 - smoothstep(0.0, 1.0, r));
        #else
          float a = pow(max(0.0, 1.0 - r), 1.6) * 0.95 + 0.35 * exp(-r * r * 30.0);   // wide warm halo, small hot core
        #endif
        a *= vI * smoothstep(1.0, 0.85, r);
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function quad(cap) {
  const g = new THREE.PlaneGeometry(2, 2);   // -1..1
  g.setAttribute('aFull', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
  return g;
}

export const ACORN_R = 0.012;   // m: a real acorn, about 2 cm across and 3 cm long (owner, 2026-10-27: "acorns can be realistically sized"); the glow finds it
export function acornGeometry() {
  const g = new THREE.IcosahedronGeometry(ACORN_R, 1);   // (a polyhedron is already non-indexed)
  g.scale(0.85, 1.2, 0.85);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const body = new THREE.Color(0x6b4a2b), cap = new THREE.Color(0x8a7a5a);   // brown nut, paler scaly cap
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getY(i) > ACORN_R * 0.46 ? cap : body;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ---- the game's state: one plain object and four events (docs/game-acorn-stash.md, v2) ----------------
// Everything a server would own later lives in `world`; the client's meshes, labels and HUD are derived from it.
// A change to it happens only through applyEvent(world, e), with e one of
//   { type: 'pickup',  by, key, x, y, z }                    an acorn taken from under (or in) an oak
//   { type: 'deposit', by, oak, into: 'stash' | 'granary', cap }   into a stash hole (cap: its capacity) or a granary
//   { type: 'bury',    by, id, x, y, z, kind: 'scatter' | 'cache' }   a squirrel's scatter hoard, a raven's cache
//   { type: 'dig',     by, id, keep }                       a buried acorn dug up (eaten, or carried when keep)
// `by` is a collector id: world.collectors[by] = { id, species, kind: 'ai' | 'player', carrying, cap, total }.
// Deposits and burials score for the collector's species (world.board) and for the round when one is on.
// v4 adds two events and the pilfer:
//   { type: 'raid', by, oak }                               an acorn pulled from a woodpecker granary
//   { type: 'mob',  by, drop }                              a raider mobbed: driven off for DRIVEN_S (drop: it lost the acorn)
//   a 'dig' of someone else's cache (own !== by; own, osp, pil: the server's verdict when it came from the server)
// A raid or pilfer scores for the raider (and its "raided" line) and is taken from the owner's species; what it took
// counts as dug (storing it again scores nothing) and as loot (dropped when mobbed, the score goes back).
export const BOARD_SPECIES = ['melanerpes_formicivorus', 'sciurus_griseus', 'corvus_corax'];
export const RAID_SPECIES = ['corvus_corax', 'sciurus_griseus', 'aphelocoma_californica', 'cyanocitta_stelleri'];
export const DRIVEN_S = 20;    // s of world clock a mobbed raider may not raid (server.py DRIVEN_S)
const BOARD_NAMES = { melanerpes_formicivorus: 'acorn woodpeckers', sciurus_griseus: 'western gray squirrels', corvus_corax: 'common ravens' };
const BOARD_ONE = { melanerpes_formicivorus: 'woodpecker', sciurus_griseus: 'squirrel', corvus_corax: 'raven' };
const BOARD_VERB = { melanerpes_formicivorus: 'stashed', sciurus_griseus: 'buried', corvus_corax: 'cached' };
const THIEF_ONE = { ...BOARD_ONE, aphelocoma_californica: 'scrub-jay', cyanocitta_stelleri: "Steller's jay" };
const CACHE_MAX = 300;   // buried acorns kept in the world (the oldest are forgotten, or found by someone else)

export function newWorld(tile, season) {
  return {
    tile, season, clock: 0,       // clock: game seconds this world has run (acorn regrowth, mark fading)
    picked: new Map(),            // acorn key -> clock when it was taken
    stashes: {},                  // oak id -> acorns in its stash hole (v1)
    granaries: {},                // oak id -> acorns hammered into its granary
    caches: [],                   // buried acorns: { id, x, y, z, by, species, kind, t }
    board: Object.fromEntries(BOARD_SPECIES.map(s => [s, 0])),   // all time in this world, per species
    you: 0,                       // the player's own deposits in this world
    species: [],                  // acorn kinds the player has found (field guide)
    collectors: {},
    round: null,                  // { t, length, counts: { species: n }, you, over, winner, raided, mobbed }
    raided: Object.fromEntries(BOARD_SPECIES.map(s => [s, 0])),   // v4: acorns each species stole (raids, pilfers)
    mobbed: {},                   // v4: times each species was driven off
  };
}

export function applyEvent(w, e) {
  const c = w.collectors[e.by]; if (!c) return false;
  switch (e.type) {
    case 'pickup':
      if (w.picked.has(e.key) || c.carrying >= c.cap) return false;
      w.picked.set(e.key, w.clock); c.carrying++; return true;
    case 'deposit': {
      if (c.carrying <= 0) return false;
      const into = e.into === 'granary' ? w.granaries : w.stashes, n = into[e.oak] || 0;
      if (e.cap && n >= e.cap) return false;
      into[e.oak] = n + 1; c.carrying--; if (stored(c)) score(w, c); return true;
    }
    case 'bury': {
      if (c.carrying <= 0) return false;
      c.carrying--;
      const fresh = stored(c);   // re-burying one it dug up (or stole) scores nothing (no farming a cache)
      w.caches.push({ id: e.id, x: e.x, y: e.y, z: e.z, by: e.by, species: c.species, kind: e.kind || 'scatter', t: w.clock });
      if (w.caches.length > CACHE_MAX) w.caches.splice(0, w.caches.length - CACHE_MAX);
      if (fresh) score(w, c);
      return true;
    }
    case 'dig': {
      const i = w.caches.findIndex(k => k.id === e.id);
      if (i < 0 || (e.keep && c.carrying >= c.cap)) return false;
      const k = w.caches[i];
      const own = e.own !== undefined ? e.own : (k.by ?? null), osp = e.osp !== undefined ? e.osp : k.species;
      const pil = e.pil !== undefined ? e.pil : own !== e.by;
      w.caches.splice(i, 1); if (e.keep) { c.carrying++; c.dug = (c.dug || 0) + 1; }
      if (pil && osp) {   // someone else's: a pilfer
        if (e.keep) c.loot = (c.loot || 0) + 1;
        gain(w, c); lose(w, osp, own);
      }
      return true;
    }
    case 'raid': {
      if (!RAID_SPECIES.includes(c.species)) return false;
      const n = w.granaries[e.oak] || 0;
      if (n <= 0 || c.carrying >= c.cap || w.clock < (c.off || 0)) return false;
      w.granaries[e.oak] = n - 1; c.carrying++;
      c.dug = (c.dug || 0) + 1; c.loot = (c.loot || 0) + 1;
      gain(w, c); lose(w, 'melanerpes_formicivorus', null);
      return true;
    }
    case 'mob': {
      if (e.drop && c.carrying <= 0) return false;
      c.off = Math.round((w.clock + DRIVEN_S) * 100) / 100;
      if (e.drop) {
        c.carrying--;
        if (c.loot > 0) { c.loot--; c.dug = Math.max(0, (c.dug || 0) - 1); ungain(w, c); }
        else if (c.dug > 0) c.dug--;
      }
      w.mobbed[c.species] = (w.mobbed[c.species] || 0) + 1;
      const r = w.round;
      if (r && !r.over) { r.mobbed ||= {}; r.mobbed[c.species] = (r.mobbed[c.species] || 0) + 1; }
      return true;
    }
  }
  return false;
}
// An acorn goes into a store: one the collector dug up or stole (already scored, or its own again) uses up a dug
// count and scores nothing. True when this one scores.
function stored(c) {
  if (c.dug > 0) { c.dug--; if (c.loot > 0) c.loot--; return false; }
  return true;
}
// A raid or a pilfer: scored for the raider's species, the round and the species' "raided" line (board species only).
function gain(w, c) {
  if (!BOARD_SPECIES.includes(c.species)) return;
  score(w, c);
  w.raided[c.species] = (w.raided[c.species] || 0) + 1;
  const r = w.round;
  if (r && !r.over) { r.raided ||= {}; r.raided[c.species] = (r.raided[c.species] || 0) + 1; }
}
// A dropped stolen acorn: the raid's score taken back (never below 0).
function ungain(w, c) {
  const sp = c.species; if (!BOARD_SPECIES.includes(sp)) return;
  w.board[sp] = Math.max(0, (w.board[sp] || 0) - 1); w.raided[sp] = Math.max(0, (w.raided[sp] || 0) - 1);
  c.total = Math.max(0, (c.total || 0) - 1);
  if (c.kind === 'player') w.you = Math.max(0, w.you - 1);
  const r = w.round;
  if (r && !r.over) {
    r.counts[sp] = Math.max(0, (r.counts[sp] || 0) - 1); r.raided ||= {}; r.raided[sp] = Math.max(0, (r.raided[sp] || 0) - 1);
    if (c.kind === 'player') r.you = Math.max(0, r.you - 1);
  }
}
// The owner's species (and the owner, when known and still here) loses the acorn (never below 0).
function lose(w, sp, own) {
  if (w.board[sp] !== undefined) w.board[sp] = Math.max(0, w.board[sp] - 1);
  const o = own != null ? w.collectors[own] : null;
  if (o) o.total = Math.max(0, (o.total || 0) - 1);
  if (o?.kind === 'player') w.you = Math.max(0, w.you - 1);
  const r = w.round;
  if (r && !r.over) {
    if (r.counts[sp] !== undefined) r.counts[sp] = Math.max(0, r.counts[sp] - 1);
    if (o?.kind === 'player') r.you = Math.max(0, r.you - 1);
  }
}
function score(w, c) {
  if (w.board[c.species] === undefined) w.board[c.species] = 0;
  w.board[c.species]++; c.total++;
  if (c.kind === 'player') w.you++;
  const r = w.round;
  if (r && !r.over) { r.counts[c.species] = (r.counts[c.species] || 0) + 1; if (c.kind === 'player') r.you++; }
}

// Fall regrowth: in fall the oaks keep dropping acorns, so a taken acorn's place fills again after REGROW_S game
// seconds (+ up to 50 %, hashed per acorn). Winter keeps what is on the ground (half the fall count, no new
// drops); spring and summer have the odd acorn and no regrowth (acornCount). Same seasons as v1.
const REGROW_S = 300, SWEEP_S = 5;
const ROUND_S = 600;              // a round: 10 minutes of game time (?round=<s> to test)
const RESERVE_S = 60;             // an AI's claim on an acorn lapses after this (it was dropped from the live set)
const CARRY_CAP = 160, MARK_CAP = 400, MARK_FADE = [60, 240];   // marks fade out from 1 to 4 game minutes
const SAVE_S = 2;                 // state is written at most this often
const WITNESS_R = 30;             // m: an AI deposit or burial this close to the camera shows its field-guide card
// v4: the player's raid. Within GRANARY_SCAN_R m of a granary that holds something, the raven within RAID_REACH m of
// its bark (hovering, or standing at its foot), or the squirrel on its trunk, pulls for RAID_PULL s (the squirrel
// RAID_PULL_SQ), and the acorn comes free if no family member is within RAID_GUARD_R m of the hole. Mobbed: MOBBED_S
// s of no raiding (and the event's DRIVEN_S on the world clock); after a raid the family can still chase the raider
// while it is within FLEE_R m of the granary with the stolen acorn.
const GRANARY_SCAN_R = 6, RAID_REACH = 2.2, RAID_PULL = 1.5, RAID_PULL_SQ = 2.0, RAID_GUARD_R = 8;
const MOBBED_S = 2.5, FLEE_R = 20, NEWS_S = 4.5;

export class AcornGame {
  constructor(tile, scene, flight, veg, ui) {
    this.tile = tile; this.scene = scene; this.flight = flight; this.veg = veg; this.ui = ui;
    this.running = false; this.season = null; this.elapsed = 0; this.epoch = 0;
    this.depositT = 0; this.hudT = 0; this.refreshT = 0; this.sweepT = 0; this.markT = 0; this.saveT = -1; this.nearFull = false;
    this.world = newWorld(tile.id, null);
    this.player = this.addPlayer();
    this.reserved = new Map();      // acorn key -> { by, t }: an AI collector is on its way to it
    this.listeners = {};
    this.revealed = false;          // stash holes visible: first pickup this session, or the world already has stash contents
    this.cache = new Map();         // oak id -> oakInfo for the current season
    this.liveAcorns = [];           // { key, x, y, z }, index-aligned with the acorn instances
    this.liveIdx = new Map();       // acorn key -> index in liveAcorns
    this.liveStashes = [];          // { id, info, x, y, z } index-aligned with the stash instances
    this.labels = new Map();        // oak id -> Sprite
    this.markers = new Map();       // oak id -> screen-constant glowing acorn above a full stash's tree
    this.granaryLabels = new Map(); // oak id -> screen-constant "granary N" label
    this.granaryAt = new Map();     // oak id -> where the last acorn went in (the label hangs just above it)
    this.refCenter = null; this.refVersion = -1; this.dirty = true; this.camera = null;
    this.ms = 0;
    // v4: the player's raid (raidUpdate), the mobbed state and the news line; animals.js sets this.animals
    this.animals = null; this.raidOak = null; this.raidAt = null; this.raidPull = 0; this.raidScanT = 0; this.raidGuarded = false;
    this.mobbedT = 0; this.mobbedBy = null; this.fleeing = null; this.newsT = 0; this._tp = { x: 0, y: 0, z: 0, r: 0 };
    const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    this.roundLength = +q.get('round') > 0 ? +q.get('round') : ROUND_S;

    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    const nutGeo = acornGeometry();
    nutGeo.setAttribute('aGround', new THREE.InstancedBufferAttribute(new Float32Array(ACORN_CAP), 1));
    this.nuts = new THREE.InstancedMesh(nutGeo, nutMaterial(), ACORN_CAP);
    this.acornGlow = new THREE.InstancedMesh(quad(ACORN_CAP),
      glowMaterial({ color: 0xffa040, near: 8, far: 110, sizeNear: 0.5, sizeFar: 3.6 }), ACORN_CAP);
    const disc = new THREE.CylinderGeometry(1, 1, 0.12, 14); disc.rotateX(Math.PI / 2);   // unit radius, axis along +z
    this.holes = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0x140d07 }), STASH_CAP);
    this.ringGlow = new THREE.InstancedMesh(quad(STASH_CAP),
      glowMaterial({ color: 0xbfe0ff, near: 6, far: 140, sizeNear: 0.75, sizeFar: 3.4, ring: true }), STASH_CAP);
    // acorns carried by AI collectors (placed each frame by animals.js at the bill or mouth) and their small glow
    this.carriedNuts = new THREE.InstancedMesh(acornGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), CARRY_CAP);
    this.carriedGlow = new THREE.InstancedMesh(quad(CARRY_CAP),
      glowMaterial({ color: 0xffb050, near: 18, far: 140, sizeNear: 0.05, sizeFar: 1.3 }), CARRY_CAP);
    // dug marks: squirrels' scatter hoards and ravens' caches, fading
    this.marks = new THREE.InstancedMesh(markGeometry(MARK_CAP), markMaterial(), MARK_CAP);
    for (const m of [this.nuts, this.acornGlow, this.holes, this.ringGlow, this.carriedNuts, this.carriedGlow, this.marks]) {
      m.count = 0; m.frustumCulled = false; this.group.add(m);
    }
    this.carriedNuts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.carriedGlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.acornGlow.renderOrder = this.ringGlow.renderOrder = this.carriedGlow.renderOrder = 10; this.marks.renderOrder = 2;
    this.nc = 0;
    this.tmp = new THREE.Object3D();
    this.oakIndex = null; this.oakIndexVersion = -1;
    // Field notes and the species leaderboard: HUD rows added here so index.html stays untouched.
    fieldGuide.mount();
    if (ui.box && !ui.notes) {
      const row = document.createElement('div'); row.className = 'row fg-notes';
      row.innerHTML = '<span>acorns found</span><b></b>';
      ui.box.insertBefore(row, ui.hint || null); ui.notes = row.querySelector('b');
    }
    if (ui.time?.previousElementSibling) ui.time.previousElementSibling.textContent = 'round';
    this.mountBoard();
    if (ui.box && typeof document !== 'undefined') {   // v4: one line of news (a raid, a pilfer, mobbed), shown for NEWS_S
      const n = document.createElement('div'); n.className = 'acorn-news';
      ui.box.insertBefore(n, this.board.el); this.news = n;
    }
    if (typeof addEventListener !== 'undefined') {
      addEventListener('keydown', e => {
        if (e.code !== 'KeyL' || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
        this.board.el.classList.toggle('off');
        try { localStorage.setItem('wild-earth:board-off', this.board.el.classList.contains('off') ? '1' : ''); } catch (err) { /* private mode */ }
      });
      addEventListener('pagehide', () => { if (this.season) this.save(); });
    }
    // v3: the shared world. aiLocal: this browser runs the AI collectors (always, offline; the AI host, online).
    this.aiLocal = true; this.worldMode = 'local';   // worldMode: 'local' (v2, localStorage) or 'net' (the server's)
    this.net = new GameNet(this, { applyEvent, newWorld });
  }

  get key() { return `wild-earth:stash:${this.tile.id}/${this.season}`; }
  get state() { return this.world; }                       // v1 name
  get carriedCount() { return this.player.carrying; }
  get active() { return this.running && !!this.season; }   // AI collectors work only during a game

  // The player's collector record. species: the player is the raven today; a later lane sets this to play a
  // squirrel or woodpecker (the leaderboard line follows it).
  addPlayer() {
    const sp = this.playerSpecies || 'corvus_corax';
    const p = { id: 'player', species: sp, kind: 'player', carrying: 0, cap: PLAYER_CAP[sp] || CARRY_MAX, total: this.world.you };
    this.world.collectors.player = p; return p;
  }
  // The player as another species (squirrelControl.js). A squirrel carries one acorn in its mouth and acts on a key
  // (E: pick up, bury, dig up; the controller calls the player* methods below) instead of the raven's proximity pickup,
  // and stash holes are the raven's, so it never deposits. The HUD rows and the board's "you" line follow the species.
  // A woodpecker (woodpeckerControl.js) likewise holds one, in the bill, and deposits only into its family's granary
  // (playerGranary, on E while clinging there). Both are small: the acorns near the eye shrink further (SMALL_NEAR).
  setPlayerSpecies(code) {
    this.playerSpecies = code; this.manual = code !== 'corvus_corax';
    this.net?.species(code);
    const p = this.player; p.species = code; p.cap = PLAYER_CAP[code] || CARRY_MAX; p.carrying = Math.min(p.carrying, p.cap);
    const u = this.ui, sq = code === 'sciurus_griseus';
    if (u.stashed?.previousElementSibling) u.stashed.previousElementSibling.textContent = sq ? 'acorns buried' : 'acorns stashed';
    if (u.found?.parentElement) u.found.parentElement.style.display = this.manual ? 'none' : '';
    // the size of an acorn near the eye: v1's (0.3 of the far size) for the raven, about life size for a small animal
    const small = this.manual;
    NUT_NEAR.k.value = small ? SMALL_NEAR.k : 0.3; NUT_NEAR.r.value = small ? SMALL_NEAR.r : 6;
    this.acornGlow.material.uniforms.uSizeNear.value = small ? 0.12 : 0.5;
    this.acornGlow.material.uniforms.uNear.value = small ? 3 : 8;
    this.hud();
  }
  playerGranary(oakId, x, y, z) { return this.depositGranary('player', oakId, x, y, z); }
  // The player woodpecker's family granary (an oak id, or null): its tag reads "your granary N" and shows from 0.
  setFamilyGranary(id) {
    const was = this.family; this.family = id || null;
    if (was && was !== this.family) this.granaryLabel(was, true);
    if (this.family) this.granaryLabel(this.family, true);
  }
  // The nearest live acorn within r of (x, y, z) (3D), or null; branch: true only those in the crown, false only
  // those on the ground, null either. { key, x, y, z, species, branch }
  acornNear(x, y, z, r, branch = null) {
    let best = null, bd = r * r;
    for (const a of this.liveAcorns) {
      if (branch !== null && a.branch !== branch) continue;
      const dx = a.x - x, dy = a.y - y, dz = a.z - z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }
  playerPick(a) { return this.dispatch({ type: 'pickup', by: 'player', key: a.key, x: a.x, y: a.y, z: a.z, species: a.species }); }
  playerBury(x, y, z) { return this.bury('player', x, y, z, 'scatter'); }
  playerDig(k) { return this.dig('player', k.id, true); }

  // An AI collector's record, made on first use (animals.js passes the animal id and its species code).
  collector(id, species, cap = 1) {
    return this.world.collectors[id] ||= { id, species, kind: 'ai', carrying: 0, cap, total: 0 };
  }

  // ---- events ------------------------------------------------------------------------------------
  on(type, fn) { (this.listeners[type] ||= []).push(fn); return () => { const a = this.listeners[type], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; }
  dispatch(e) {
    if (!this.active || (e.by !== 'player' && !this.aiLocal)) return false;   // AI events only from the AI host
    const pre = this.world.collectors[e.by]?.carrying;
    if (!applyEvent(this.world, e)) return false;
    if (this.net.live) this.net.event(e, pre);
    this.applied(e);
    return true;
  }
  applied(e) {
    this.effects(e);
    for (const fn of this.listeners[e.type] || []) { try { fn(e); } catch (err) { console.error(`acorns: '${e.type}' listener`, err); } }
    if (this.saveT < 0) this.saveT = SAVE_S;
  }
  // v3: another player's (or the AI host's) event, already applied to world by net.js: draw it.
  remote(e) { if (this.running) this.applied(e); }
  // v3: the prediction rebuilt from the server's world (a welcome, a reject, a remote event that did not apply).
  adoptWorld(w) {
    this.world = w; this.worldMode = 'net';
    this.player = w.collectors.player || this.addPlayer();
    if (this.playerSpecies) this.player.species = this.playerSpecies;
    this.revealed = this.revealed || Object.values(w.stashes).some(c => c > 0);
    this.dirty = true; this.layMarks();
    this.board.el.classList.toggle('done', !!w.round?.over);
    this.hud();
  }
  // v3: the server started or ended a round.
  roundChanged() {
    if (this.world.round?.over) this.showRoundEnd();
    else { this.board.el.classList.remove('done'); this.hud(true); }
  }
  // v3: the server's game went away before a join: back to this browser's own (v2) world.
  netLost() { if (this.season && this.worldMode === 'net') this.setWorld(this.season); }
  // What an applied event changes on screen.
  effects(e) {
    const mine = e.by === 'player';
    if (e.type === 'pickup') {
      this.reserved.delete(e.key);
      const i = this.liveIdx.get(e.key); if (i !== undefined) this.removeAcorn(i);
      if (mine) {
        const sp = acornSpecies(e.species);
        if (sp && !this.world.species.includes(sp)) this.world.species.push(sp);
        fieldGuide.acornPicked(e.species, this.ui.box);
        if (!this.revealed) { this.revealed = true; this.applyReveal(); }
        this.hud(true);
      }
    } else if (e.type === 'deposit') {
      if (e.into === 'stash') {
        const at = this.liveStashes.findIndex(s => s.id === e.oak);
        if (at >= 0) {
          const s = this.liveStashes[at];
          if (this.world.stashes[s.id] >= s.info.capacity) {
            const full = this.ringGlow.geometry.attributes.aFull; full.array[at] = 1; full.needsUpdate = true;
            this.marker(s);
          }
          this.label(s);
        }
        if (mine) { this.hud(true); fieldGuide.stashFilled(this.ui.box); }
      } else {
        if (e.x !== undefined) this.granaryAt.set(e.oak, [e.x, e.y, e.z]);   // (a remote player's deposit has no spot)
        this.granaryLabel(e.oak);
        if (this.near(e)) fieldGuide.witness('granary', this.ui.box);
      }
    } else if (e.type === 'bury') {
      this.layMarks();
      if (mine) this.hud(true);
      if (this.near(e)) fieldGuide.witness(this.world.collectors[e.by]?.species === 'corvus_corax' ? 'cache' : 'bury', this.ui.box);
    } else if (e.type === 'dig') {
      this.layMarks(); if (mine) this.hud(true);
      if (e.pil) {   // someone else's: a pilfer
        const sp = this.world.collectors[e.by]?.species, one = THIEF_ONE[sp] || 'thief';
        if (mine) this.say(e.osp === sp ? `another ${THIEF_ONE[sp]}'s buried acorn: it counts for you now, not for its owner`
          : `a ${THIEF_ONE[e.osp] || 'stranger'}'s buried acorn: +1 for ${BOARD_NAMES[sp] || 'you'}${BOARD_NAMES[e.osp] ? `, -1 for ${BOARD_NAMES[e.osp]}` : ''}`);
        else if (e.own === 'player') this.say(`a ${one} dug up one of your buried acorns`);
        if (mine || this.near(e)) fieldGuide.raidSeen('pilfer', sp, mine, this.ui.box);
      }
    } else if (e.type === 'raid') {
      this.granaryLabel(e.oak);
      const sp = this.world.collectors[e.by]?.species;
      if (mine) { this.hud(true); this.say(`you pulled an acorn from the granary: +1 for ${BOARD_NAMES[sp]}, -1 for the woodpeckers`); }
      else if (e.oak === this.family) this.say(`a ${THIEF_ONE[sp] || 'thief'} took an acorn from your family's granary`);
      if (mine || this.near(e)) fieldGuide.raidSeen('granary', sp, mine, this.ui.box);
    } else if (e.type === 'mob') { if (mine) this.hud(true); }
  }
  near(e) {
    const c = this.camera?.position; if (!c || e.x === undefined) return false;
    return Math.hypot(e.x - c.x, e.y - c.y, e.z - c.z) < WITNESS_R;
  }

  // ---- AI collectors' view of the supply (animals.js) ----------------------------------------------
  // A free acorn on this oak (not taken, not claimed by another collector), or null. ground / branch: only those.
  freeAcorn(oak, ground = false, branch = false) {
    if (!bearsAcorns(oak)) return null;
    const inf = this.info(oak), w = this.world, clock = w.clock;
    for (let n = 0; n < inf.acorns.length; n++) {
      const a = inf.acorns[n];
      if ((ground && a.branch) || (branch && !a.branch) || w.picked.has(a.key)) continue;
      const r = this.reserved.get(a.key); if (r && clock - r.t < RESERVE_S) continue;
      return a;
    }
    return null;
  }
  isFree(key) { return !this.world.picked.has(key); }
  reserve(key, by) { this.reserved.set(key, { by, t: this.world.clock }); }
  release(key, by) { const r = this.reserved.get(key); if (r && r.by === by) this.reserved.delete(key); }
  take(by, a) { return this.dispatch({ type: 'pickup', by, key: a.key, x: a.x, y: a.y, z: a.z, species: a.species }); }
  depositGranary(by, oakId, x, y, z) { return this.dispatch({ type: 'deposit', by, oak: oakId, into: 'granary', x, y, z }); }
  bury(by, x, y, z, kind) {
    // shared world: a player's burial gets a random id (unique among players, and not tied to who buried it)
    const id = by === 'player' && this.net.live ? `b${Math.random().toString(36).slice(2, 12)}` : `${by}@${this.world.clock.toFixed(2)}`;
    return this.dispatch({ type: 'bury', by, id, x, y, z, kind });
  }
  // A dig: the cache's place (for the guard and the field guide, local only: the server keeps no place for a player's)
  // and whose it was (own, osp, pil: the reducer's verdict, replaced by the server's when it answers).
  dig(by, id, keep = false) {
    const k = this.world.caches.find(c => c.id === id), e = { type: 'dig', by, id, keep };
    if (k) { e.x = k.x; e.y = k.y; e.z = k.z; e.own = k.by ?? null; e.osp = k.species; e.pil = e.own !== by; }
    return this.dispatch(e);
  }
  // v4, for animals.js: an AI raider's raid on a granary, and a raider mobbed (drop: it loses the acorn it carries).
  raid(by, oakId, x, y, z) { return this.dispatch({ type: 'raid', by, oak: oakId, x, y, z }); }
  mob(by, drop) { return this.dispatch({ type: 'mob', by, drop: !!drop }); }
  // A buried acorn within r of (x, z) (kind 'scatter' or 'cache'; any when null; notBy: not this collector's), nearest
  // first, or null.
  cacheNear(x, z, r, kind = null, notBy = null) {
    let best = null, bd = r * r;
    for (const k of this.world.caches) {
      if ((kind && k.kind !== kind) || (notBy && k.by === notBy)) continue;
      const dx = k.x - x, dz = k.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = k; }
    }
    return best;
  }
  // Acorns in the bill or mouth: animals.js calls carryBegin(), carryAt() per carrier, carryEnd() each frame.
  carryBegin() { this.nc = 0; }
  carryAt(x, y, z, yaw, pitch, s) {
    if (this.nc >= CARRY_CAP) return;
    const t = this.tmp, i = this.nc++;
    t.position.set(x, y, z); t.rotation.set(Math.PI / 2 + pitch, yaw, 0, 'YXZ'); t.scale.setScalar(s * 0.045 * 0.35 / ACORN_R); t.updateMatrix();   // the same size in the bill as before the nuts shrank
    this.carriedNuts.setMatrixAt(i, t.matrix);
    t.rotation.set(0, 0, 0); t.scale.setScalar(1); t.updateMatrix(); this.carriedGlow.setMatrixAt(i, t.matrix);
  }
  carryEnd() {
    const n = this.nc;
    if (n === 0 && this.carriedNuts.count === 0) return;
    this.carriedNuts.count = this.carriedGlow.count = n;
    for (const m of [this.carriedNuts, this.carriedGlow]) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16); m.instanceMatrix.needsUpdate = true; }
  }

  start(season) {
    if (season && season !== this.season) this.setWorld(season);
    this.running = true; this.group.visible = true; this.elapsed = 0; this.dirty = true; this.epoch++;
    const counts = Object.fromEntries(BOARD_SPECIES.map(s => [s, 0]));
    this.world.round = { t: 0, length: this.roundLength, counts, you: 0, over: false, winner: null,
      raided: Object.fromEntries(BOARD_SPECIES.map(s => [s, 0])), mobbed: {} };
    this.fleeing = null; this.raidPull = 0; this.mobbedT = 0;
    this.board.el.classList.remove('done');
    if (this.ui.box) this.ui.box.classList.remove('hidden');
    this.hud();
    this.net.join(this.tile.id, this.season);   // v3: the server's world when there is one (its round replaces this one)
  }
  stop() {
    this.net.leave();
    this.running = false; this.group.visible = false; this.epoch++;
    this.reserved.clear();
    for (const c of Object.values(this.world.collectors)) if (c.kind === 'ai') c.carrying = 0;   // AI tasks end with the game
    if (this.ui.box) this.ui.box.classList.add('hidden');
    if (this.season) this.save();
  }

  // A world is tile + season: switching season saves this one and loads the other.
  setWorld(season) {
    if (this.season) this.save();
    this.season = season; this.cache.clear(); this.nearFull = false; this.epoch++; this.reserved.clear();
    const round = this.world.round;
    this.world = newWorld(this.tile.id, season); this.world.round = round;
    this.worldMode = this.net.enabled ? 'net' : 'local';
    try {
      // shared world: only the totals last seen here, shown until the server's snapshot arrives
      const seen = this.worldMode === 'net' ? JSON.parse(localStorage.getItem(this.net.lastSeenKey(this.tile.id, season)) || 'null') : null;
      if (seen) {
        for (const s of BOARD_SPECIES) this.world.board[s] = +(seen.board?.[s]) || 0;
        this.world.you = +seen.you || 0;
        this.world.species = Array.isArray(seen.species) ? seen.species.filter(id => ACORNS[id]) : [];
      }
      const raw = this.worldMode === 'local' && localStorage.getItem(this.key);
      if (raw) {
        const d = JSON.parse(raw), w = this.world;
        for (const p of d.picked || []) { if (typeof p === 'string') w.picked.set(p, 0); else if (Array.isArray(p)) w.picked.set(p[0], +p[1] || 0); }
        w.stashes = d.stashes || {};
        w.granaries = d.granaries || {};
        w.caches = Array.isArray(d.caches) ? d.caches.filter(k => k && k.id && Number.isFinite(k.x)) : [];
        w.clock = +d.clock || 0;
        for (const s of BOARD_SPECIES) w.board[s] = +(d.board?.[s]) || 0;
        w.you = +d.you || +(d.totals?.stashed) || 0;   // v1 kept the player's count as totals.stashed
        if (!d.board) w.board.corvus_corax = Math.max(w.board.corvus_corax, w.you);
        w.species = Array.isArray(d.species) ? d.species.filter(id => ACORNS[id]) : [];
        for (const s of BOARD_SPECIES) w.raided[s] = +(d.raided?.[s]) || 0;
        if (d.mobbed && typeof d.mobbed === 'object') for (const [s, n] of Object.entries(d.mobbed)) w.mobbed[s] = +n || 0;
      }
    } catch (e) { console.warn('acorns: could not load state', e); }
    this.player = this.addPlayer();
    this.revealed = Object.values(this.world.stashes).some(c => c > 0);
    for (const sp of this.labels.values()) { this.group.remove(sp); sp.material.map.dispose(); sp.material.dispose(); }
    this.labels.clear();
    for (const sp of this.markers.values()) { this.group.remove(sp); sp.material.dispose(); }
    this.markers.clear();
    for (const sp of this.granaryLabels.values()) { this.group.remove(sp); sp.material.map.dispose(); sp.material.dispose(); }
    this.granaryLabels.clear();
    this.dirty = true; this.layMarks();
    if (this.family) this.granaryLabel(this.family);
    if (this.running && this.worldMode === 'net') this.net.join(this.tile.id, season);   // the season changed mid-game
  }
  save() {
    this.saveT = -1;
    const w = this.world;
    if (this.worldMode === 'net') {   // the server keeps the world; this browser only what it last saw
      try { localStorage.setItem(this.net.lastSeenKey(this.tile.id, this.season), JSON.stringify({ board: w.board, you: w.you, species: w.species })); } catch (e) { /* private mode */ }
      return;
    }
    try {
      localStorage.setItem(this.key, JSON.stringify({ v: 2, clock: +w.clock.toFixed(1), picked: [...w.picked].map(([k, t]) => [k, +t.toFixed(1)]),
        stashes: w.stashes, granaries: w.granaries, caches: w.caches, board: w.board, you: w.you, totals: { stashed: w.you }, species: w.species,
        raided: w.raided, mobbed: w.mobbed }));
    } catch (e) { console.warn('acorns: could not save state', e); }
  }

  info(oak) {
    let v = this.cache.get(oak.id);
    if (!v) {
      if (this.cache.size > 30000) this.cache.clear();
      const mast = this.tile.mast ? this.tile.mast.at(oak.x, -oak.z) : 50;
      v = oakInfo(oak, mast, this.season, this.tile.heights); this.cache.set(oak.id, v);
    }
    return v;
  }

  // Rebuild the live acorn and stash instances from the oaks within LIVE_R of the raven.
  refresh() {
    const p = this.flight.pos, R2 = LIVE_R * LIVE_R;
    this.refCenter = [p.x, p.z]; this.refVersion = this.veg.version; this.dirty = false;
    const near = [];
    for (const o of this.veg.oaks) {
      const dx = o.x - p.x, dz = o.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 < R2) near.push([d2, o]);
    }
    near.sort((a, b) => a[0] - b[0]);   // nearest first, so an overflow drops the far ones
    const t = this.tmp, picked = this.world.picked, fullAttr = this.ringGlow.geometry.attributes.aFull;
    this.liveAcorns = []; this.liveStashes = []; this.liveIdx.clear();
    let na = 0, ns = 0;
    for (const [, o] of near) {
      const inf = this.info(o);
      for (const a of inf.acorns) {
        const key = a.key;
        if (na >= ACORN_CAP || picked.has(key)) continue;
        t.position.set(a.x, a.y, a.z); t.rotation.set(0.3 * (a.spin - 0.5), a.spin * 6.283, 1.2 * (a.spin - 0.5)); t.scale.setScalar(1); t.updateMatrix();
        this.nuts.setMatrixAt(na, t.matrix); this.nuts.geometry.attributes.aGround.array[na] = a.branch ? 0 : 1;
        t.rotation.set(0, 0, 0); t.updateMatrix(); this.acornGlow.setMatrixAt(na, t.matrix);
        this.liveIdx.set(key, na);
        this.liveAcorns.push({ key, x: a.x, y: a.y, z: a.z, species: o.species, branch: a.branch }); na++;
      }
      const st = inf.stash;
      if (st && ns < STASH_CAP) {
        const nx = Math.sin(st.facing), nz = Math.cos(st.facing), r = st.trunkR * 0.9;
        const hx = st.ax + nx * r, hz = st.az + nz * r;
        const holeR = Math.min(0.3, st.trunkR * 0.75);
        t.position.set(hx, st.ay, hz); t.rotation.set(0, st.facing, 0); t.scale.set(holeR, holeR * 1.3, 1); t.updateMatrix();
        this.holes.setMatrixAt(ns, t.matrix);
        t.position.set(hx + nx * 0.15, st.ay, hz + nz * 0.15); t.rotation.set(0, 0, 0); t.scale.setScalar(1); t.updateMatrix();
        this.ringGlow.setMatrixAt(ns, t.matrix);
        const count = this.world.stashes[o.id] || 0;
        fullAttr.array[ns] = count >= st.capacity ? 1 : 0;
        const top = (o.y ?? st.ay) + ((o.height || 9) * (o.scale || 1));
        this.liveStashes.push({ id: o.id, info: st, x: hx + nx * 0.3, y: st.ay, z: hz + nz * 0.3, nx, nz, top, tx: st.ax, tz: st.az }); ns++;
      }
    }
    this.nuts.count = this.acornGlow.count = na; this.holes.count = this.ringGlow.count = ns;
    for (const m of [this.nuts, this.acornGlow, this.holes, this.ringGlow]) m.instanceMatrix.needsUpdate = true;
    fullAttr.needsUpdate = true; this.nuts.geometry.attributes.aGround.needsUpdate = true;
    // labels: only for live stashes that hold something
    const live = new Set();
    const fullLive = new Set();
    for (const s of this.liveStashes) if ((this.world.stashes[s.id] || 0) > 0) {
      live.add(s.id); this.label(s);
      if ((this.world.stashes[s.id] || 0) >= s.info.capacity) { fullLive.add(s.id); this.marker(s); }
    }
    for (const [id, sp] of this.labels) sp.visible = live.has(id);
    for (const [id, sp] of this.markers) sp.visible = fullLive.has(id);
    for (const id of Object.keys(this.world.granaries)) this.granaryLabel(id);
    if (this.family) this.granaryLabel(this.family);
    this.applyReveal();
  }

  applyReveal() {
    this.holes.visible = this.revealed;
    this.ringGlow.material.uniforms.uVisible.value = this.revealed ? 1 : 0;
  }

  label(s) {
    const count = this.world.stashes[s.id] || 0, text = `${count} / ${s.info.capacity}`;
    let sp = this.labels.get(s.id);
    if (!sp) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      sp.scale.set(6, 1.5, 1); sp.renderOrder = 20; sp.userData = { canvas, text: null };
      this.labels.set(s.id, sp); this.group.add(sp);
    }
    sp.position.set(s.x + s.nx * 0.4, s.y + 1.4, s.z + s.nz * 0.4); sp.visible = true;
    if (sp.userData.text !== text) {
      const { canvas } = sp.userData, g = canvas.getContext('2d');
      g.clearRect(0, 0, 256, 64);
      g.fillStyle = 'rgba(10,15,12,0.72)'; g.beginPath(); g.roundRect(40, 6, 176, 52, 14); g.fill();
      g.font = '600 36px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = count >= s.info.capacity ? '#bfe0ff' : '#ffd08a'; g.fillText(text, 128, 33);
      sp.material.map.needsUpdate = true; sp.userData.text = text;
    }
  }

  // A granary's count: a small screen-constant tag above the woodpeckers' working height on the trunk, shown
  // for granaries within GRANARY_TAG_R of the camera that hold something.
  granaryLabel(id, redraw = false) {
    const count = this.world.granaries[id] || 0, o = this.oakById(id), mine = id === this.family;
    let sp = this.granaryLabels.get(id);
    if (!o || (!count && !mine)) { if (sp) sp.visible = false; return; }
    if (!sp) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 56;
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false }));
      sp.scale.set(0.1, 0.022, 1); sp.renderOrder = 20; sp.userData = { canvas, text: null };
      this.granaryLabels.set(id, sp); this.group.add(sp);
    }
    const at = this.granaryAt.get(id);
    if (at) sp.position.set(at[0], at[1] + 0.5, at[2]);
    else sp.position.set(o.x, o.y + Math.min(4, (o.height || 8) * o.scale * 0.4) + 0.8, o.z);
    const text = mine ? `your granary ${count}` : `granary ${count}`;
    if (redraw) sp.userData.text = null;
    if (sp.userData.text !== text) {
      const { canvas } = sp.userData, g = canvas.getContext('2d');
      g.clearRect(0, 0, 256, 56);
      g.fillStyle = 'rgba(10,15,12,0.72)'; g.beginPath(); g.roundRect(8, 4, 240, 48, 12); g.fill();
      g.fillStyle = '#c8102e'; g.beginPath(); g.arc(34, 28, 8, 0, Math.PI * 2); g.fill();   // the woodpecker's red cap
      g.font = `600 ${mine ? 24 : 28}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`;
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = mine ? '#ffd08a' : '#f0e3b2'; g.fillText(text, 54, 30);
      sp.material.map.needsUpdate = true; sp.userData.text = text;
    }
    this.placeGranaryLabel(sp);
  }
  placeGranaryLabel(sp) {
    const c = this.camera?.position; if (!c) { sp.visible = true; return; }
    const d = sp.position.distanceTo(c);
    sp.visible = d < GRANARY_TAG_R;
  }

  // A glowing acorn icon above the tree of a full stash, constant size on screen so it reads from any distance.
  marker(s) {
    let sp = this.markers.get(s.id);
    if (!sp) {
      if (!AcornGame.markerTexture) AcornGame.markerTexture = makeAcornIcon();
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: AcornGame.markerTexture, transparent: true, depthTest: false, depthWrite: false,
        toneMapped: false, sizeAttenuation: false }));
      sp.scale.set(0.095, 0.095, 1); sp.renderOrder = 21;
      this.markers.set(s.id, sp); this.group.add(sp);
    }
    sp.position.set(s.tx, s.top + 4.5, s.tz); sp.visible = true;
  }

  // Dug marks from world.caches: a dark scuff of soil that fades over MARK_FADE game seconds (the cache stays;
  // a squirrel finds it again by smell).
  layMarks() {
    const t = this.tmp, fade = this.marks.geometry.attributes.aFade, w = this.world;
    let n = 0;
    for (const k of w.caches) {
      const age = w.clock - k.t, f = 1 - smoothstep(MARK_FADE[0], MARK_FADE[1], age);
      if (f <= 0.01 || n >= MARK_CAP) continue;
      const r = k.kind === 'cache' ? 0.24 : 0.17, h = seedOf(k.id, 0x3a7);
      t.position.set(k.x, k.y + 0.03, k.z); t.rotation.set(0, (h & 1023) / 1023 * 6.283, 0); t.scale.set(r, 1, r * 0.72); t.updateMatrix();
      this.marks.setMatrixAt(n, t.matrix); fade.array[n] = f; n++;
    }
    this.marks.count = n; this.marks.instanceMatrix.needsUpdate = true; fade.needsUpdate = true;
  }

  removeAcorn(i) {
    const last = this.liveAcorns.length - 1, m = new THREE.Matrix4();
    this.liveIdx.delete(this.liveAcorns[i].key);
    if (i !== last) {
      this.nuts.getMatrixAt(last, m); this.nuts.setMatrixAt(i, m);
      const gr = this.nuts.geometry.attributes.aGround; gr.array[i] = gr.array[last]; gr.needsUpdate = true;
      this.acornGlow.getMatrixAt(last, m); this.acornGlow.setMatrixAt(i, m);
      this.liveAcorns[i] = this.liveAcorns[last]; this.liveIdx.set(this.liveAcorns[i].key, i);
    }
    this.liveAcorns.pop();
    this.nuts.count = this.acornGlow.count = this.liveAcorns.length;
    this.nuts.instanceMatrix.needsUpdate = this.acornGlow.instanceMatrix.needsUpdate = true;
  }

  // ---- lookups for the species card (identify.js) ----------------------------------------------
  // The oak record placed at (x, z) (a clicked trunk's position), or null. Oaks are the trees of the
  // last forest rebuild, so any tree in the near set is among them.
  oakAt(x, z, tol = 0.5) {
    let best = null, bd = tol * tol;
    for (const o of this.veg.oaks) {
      const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = o; }
    }
    return best;
  }
  oakById(id) {
    if (this.oakIndexVersion !== this.veg.version) {
      this.oakIndex = new Map(this.veg.oaks.map(o => [o.id, o])); this.oakIndexVersion = this.veg.version;
    }
    return this.oakIndex.get(id) || null;
  }
  // Acorns on one oak in the current world: { species, total, left, stash: { count, capacity } | null },
  // or null when the game has no world yet or the id is not a placed oak.
  acornsOn(id) {
    const o = this.oakById(id); if (!o || !this.season) return null;
    const inf = this.info(o);
    const left = inf.acorns.filter(a => !this.world.picked.has(a.key)).length;
    return { species: acornSpecies(o.species), total: inf.acorns.length, left,
      stash: inf.stash ? { count: this.world.stashes[o.id] || 0, capacity: inf.stash.capacity } : null };
  }

  update(dt, camera, season) {
    if (season && season !== this.season) this.setWorld(season);
    if (camera) this.camera = camera;
    if (!this.running) return;
    const t0 = performance.now();
    this.net.tick();
    this.elapsed += dt; this.world.clock += dt;
    const p = this.flight.pos, w = this.world;
    this.refreshT += dt;
    let rebuild = this.dirty || this.refVersion !== this.veg.version;
    if (!rebuild && this.refreshT >= REFRESH_S) {
      this.refreshT = 0;
      rebuild = Math.hypot(p.x - this.refCenter[0], p.z - this.refCenter[1]) > REFRESH_MOVE;
      for (const sp of this.granaryLabels.values()) if (sp.userData.text) this.placeGranaryLabel(sp);
    }
    // fall: acorns keep dropping, so taken ones come back after a while
    if ((this.sweepT += dt) > SWEEP_S) {
      this.sweepT = 0;
      if (this.season === 'fall' && !this.net.live) for (const [k, tk] of w.picked) {   // shared: the server's regrowth
        if (w.clock - tk > REGROW_S * (1 + (seedOf(k, 0x6e9) % 1000) / 2000)) { w.picked.delete(k); rebuild = true; }
      }
    }
    if (rebuild) this.refresh();
    if ((this.markT += dt) > 2) { this.markT = 0; this.layMarks(); }

    // pickup: the nearest live acorn within PICK_R
    const me = this.player, manual = !!this.manual;   // a squirrel player picks and buries on a key instead
    if (!manual && me.carrying < me.cap) {
      let best = -1, bd = PICK_R * PICK_R;
      for (let i = 0; i < this.liveAcorns.length; i++) {
        const a = this.liveAcorns[i], dx = a.x - p.x, dy = a.y - p.y, dz = a.z - p.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = i; }
      }
      if (best >= 0) { const a = this.liveAcorns[best]; this.dispatch({ type: 'pickup', by: 'player', key: a.key, x: a.x, y: a.y, z: a.z, species: a.species }); }
    }
    // deposit: one acorn per beat into a non-full stash within DEPOSIT_R
    let at = null, nearFull = false;
    if (!manual && me.carrying > 0) {
      let bd = DEPOSIT_R * DEPOSIT_R;
      for (let i = 0; i < this.liveStashes.length; i++) {
        const s = this.liveStashes[i], dx = s.x - p.x, dy = s.y - p.y, dz = s.z - p.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 4 * DEPOSIT_R * DEPOSIT_R) continue;
        if ((w.stashes[s.id] || 0) >= s.info.capacity) nearFull = true;   // within 2x range of a full hole: say so
        else if (d2 < bd) { bd = d2; at = i; }
      }
    }
    if (nearFull !== this.nearFull) { this.nearFull = nearFull; this.hud(); }
    this.raidUpdate(dt, p);
    if (this.newsT > 0 && (this.newsT -= dt) <= 0 && this.news) this.news.textContent = '';
    this.depositing = at !== null;
    if (at === null) this.depositT = DEPOSIT_BEAT / 2;   // first acorn goes in half a beat after arriving
    else if ((this.depositT -= dt) <= 0) {
      this.depositT = DEPOSIT_BEAT;
      const s = this.liveStashes[at];
      this.dispatch({ type: 'deposit', by: 'player', oak: s.id, into: 'stash', cap: s.info.capacity, x: s.x, y: s.y, z: s.z });
    }
    // the round
    const r = w.round;
    if (r && !r.over && (r.t += dt) >= r.length && !this.net.live) this.endRound();   // shared: the server ends it
    if (this.saveT >= 0 && (this.saveT -= dt) <= 0) this.save();
    this.hudT += dt;
    if (this.hudT > 0.25) { this.hudT = 0; this.hud(); }
    this.ms = this.ms * 0.95 + (performance.now() - t0) * 0.05;
  }

  // ---- v4: the player's raid on a woodpecker granary --------------------------------------------------
  raidUpdate(dt, p) {
    const me = this.player, w = this.world, A = this.animals;
    if (this.mobbedT > 0 && (this.mobbedT -= dt) <= 0) this.ui.box?.classList.remove('mobbed');
    if (!RAID_SPECIES.includes(me.species) || !A) { this.raidPull = 0; this.raidAt = null; this.raidOak = null; return; }
    if ((this.raidScanT -= dt) <= 0) { this.raidScanT = 0.25; this.raidOak = this.granaryNear(p); }
    const o = this.raidOak;
    const at = o && (w.granaries[o.id] || 0) > 0 ? this.raidReach(o, p, me.species) : null;
    this.raidAt = at;
    // after a raid the family can still chase the raider off with the acorn (a squirrel drops it if hit)
    const fl = this.fleeing;
    if (fl && (me.carrying <= 0 || !(me.loot > 0) || Math.hypot(p.x - fl.x, p.z - fl.z) > FLEE_R)) this.fleeing = null;
    if (this.fleeing) A.raider('player', fl.oak, p.x, p.y, p.z, () => this.playerMobbed('family'));
    if (!at || me.carrying >= me.cap || this.mobbedT > 0 || w.clock < (me.off || 0) + 0.5) { this.raidPull = 0; this.raidGuarded = false; return; }
    A.raider('player', o.id, p.x, p.y, p.z, () => this.playerMobbed('family'));   // the family sees a raider at its granary
    this.raidPull += dt;
    if (this.raidPull < (me.species === 'sciurus_griseus' ? RAID_PULL_SQ : RAID_PULL)) return;
    this.raidGuarded = A.familyWithin(o.id, at.x, at.y, at.z, RAID_GUARD_R) > 0;   // one of them is right here: it does not come free
    if (this.raidGuarded) return;
    this.raidPull = 0;
    if (this.dispatch({ type: 'raid', by: 'player', oak: o.id, x: at.x, y: at.y, z: at.z })) this.fleeing = { oak: o.id, x: at.x, z: at.z };
  }
  // The nearest granary holding something within GRANARY_SCAN_R m (horizontally) of p, or null.
  granaryNear(p) {
    let best = null, bd = GRANARY_SCAN_R * GRANARY_SCAN_R;
    const g = this.world.granaries;
    for (const id in g) {
      if (!(g[id] > 0)) continue;
      const o = this.oakById(id); if (!o) continue;
      const dx = o.x - p.x, dz = o.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = o; }
    }
    return best;
  }
  // Within reach of the granary's bark: the raven within RAID_REACH m (up to 2.5 m above the fork), the squirrel on
  // the trunk (0.45 m of the bark, 0.6 m up or more). The point on the bark facing the raider (the hole), or null.
  raidReach(o, p, sp) {
    const fork = o.stem ? Math.max(1.5, o.scale * o.stem.len * Math.cos(o.stem.lean) - 0.3) : 2.5;
    const sq = sp === 'sciurus_griseus', hAG = p.y - o.y;
    if (hAG < -0.5 || hAG > fork + (sq ? 0.3 : 2.5)) return null;
    const t = trunkAt(o, Math.min(Math.max(hAG, 0.8), fork * 0.95), this._tp);
    const dc = Math.hypot(p.x - t.x, p.z - t.z), d = dc - t.r;
    if (sq ? (d > 0.45 || hAG < 0.6) : d > RAID_REACH) return null;
    const k = (t.r + 0.03) / Math.max(1e-3, dc);
    return { x: t.x + (p.x - t.x) * k, y: t.y, z: t.z + (p.z - t.z) * k };
  }
  // The family (by: 'family') or a cache's owner (by: 'squirrel') hit the player: the raid is interrupted, a squirrel
  // carrying drops the acorn, and the player is driven off (a 'mob' event; DRIVEN_S on the world clock).
  playerMobbed(by) {
    if (!this.active || this.mobbedT > 0) return;
    const me = this.player, drop = me.species === 'sciurus_griseus' && me.carrying > 0;
    this.raidPull = 0; this.fleeing = null; this.mobbedT = MOBBED_S; this.mobbedBy = by;
    if (!this.dispatch({ type: 'mob', by: 'player', drop })) return;
    this.ui.box?.classList.add('mobbed');
    this.say(by === 'squirrel' ? `the squirrel whose acorn that was chased you${drop ? ': you dropped it' : ''}`
      : `mobbed by the woodpecker family${drop ? ': you dropped the acorn' : ': the raid is off'}; they drive you off for ${DRIVEN_S} s`);
    fieldGuide.mobbed(by, me.species, this.ui.box);
    this.hud(true);
  }
  // One line of news in the game box for NEWS_S.
  say(text) { if (!this.news) return; this.news.textContent = text; this.newsT = NEWS_S; }

  endRound() {
    const r = this.world.round; r.over = true;
    let best = null, bn = -1, tie = false;
    for (const s of BOARD_SPECIES) { const n = r.counts[s] || 0; if (n > bn) { bn = n; best = s; tie = false; } else if (n === bn) tie = true; }
    r.winner = bn > 0 && !tie ? best : null;
    this.showRoundEnd();
  }
  showRoundEnd() {
    this.board.el.classList.remove('off'); this.board.el.classList.add('done');
    this.save(); this.hud(true);
  }

  // ---- HUD: v1 rows and the species leaderboard -------------------------------------------------
  mountBoard() {
    const box = this.ui.box; this.board = { el: document.createElement('div'), rows: {}, you: null, over: null };
    if (!document.getElementById('acornBoardStyle')) {
      const st = document.createElement('style'); st.id = 'acornBoardStyle'; st.textContent = BOARD_CSS; document.head.appendChild(st);
    }
    const el = this.board.el; el.className = 'acorn-board';
    try { if (localStorage.getItem('wild-earth:board-off')) el.classList.add('off'); } catch (e) { /* private mode */ }
    const names = Object.fromEntries((this.tile.species || []).map(s => [s.code, s.common]));
    el.innerHTML = `<div class="bh"><span>acorns gathered</span><span title="this round">round</span><span title="all rounds in this place and season">season</span></div>`
      + BOARD_SPECIES.map(s => `<div class="br" data-sp="${s}"><span>${esc(BOARD_NAMES[s] || names[s] || s)} <i>${BOARD_VERB[s]}</i></span><b class="r">0</b><b class="a">0</b></div>`).join('')
      + '<div class="over"></div><div class="keys"><kbd>L</kbd> hides the board</div>';
    for (const r of el.querySelectorAll('.br')) this.board.rows[r.dataset.sp] = { el: r, r: r.querySelector('.r'), a: r.querySelector('.a') };
    // v4: "raided N" under the raiding species (ravens, squirrels): acorns they took from a granary or someone else's
    // cache, this round and this season, and how often they were driven off this round
    for (const s of BOARD_SPECIES) {
      if (!RAID_SPECIES.includes(s)) continue;
      const row = this.board.rows[s], d = document.createElement('div');
      d.className = 'br raid'; d.title = 'acorns taken from a woodpecker granary or from someone else\'s buried acorns';
      d.innerHTML = '<span>raided<i></i></span><b class="r">0</b><b class="a">0</b>';
      row.el.after(d); row.raid = { el: d, r: d.querySelector('.r'), a: d.querySelector('.a'), off: d.querySelector('i') };
    }
    this.board.over = el.querySelector('.over');
    if (box) box.insertBefore(el, null);
  }
  // The player's line sits under their species' row (player.species).
  placeYou() {
    const sp = this.player.species, row = this.board.rows[sp]; if (!row) return;
    let you = this.board.you;
    if (!you) {
      you = document.createElement('div'); you.className = 'br you';
      you.innerHTML = '<span></span><b class="r">0</b><b class="a">0</b>';
      this.board.you = you = { el: you, name: you.querySelector('span'), r: you.querySelector('.r'), a: you.querySelector('.a'), sp: null };
    }
    if (you.sp !== sp) { you.sp = sp; you.name.textContent = `you, a ${BOARD_ONE[sp] || sp}`; row.el.after(you.el); }
  }
  updateBoard() {
    const w = this.world, r = w.round, set = (el, v) => { const s = String(v); if (el.textContent !== s) el.textContent = s; };
    let lead = null, ln = 0;
    for (const s of BOARD_SPECIES) {
      const row = this.board.rows[s], n = r ? r.counts[s] || 0 : 0;
      set(row.r, r ? n : '–'); set(row.a, w.board[s] || 0);
      if (n > ln) { ln = n; lead = s; } else if (n === ln) lead = null;
    }
    for (const s of BOARD_SPECIES) {
      this.board.rows[s].el.classList.toggle('lead', s === lead);
      const rd = this.board.rows[s].raid; if (!rd) continue;
      set(rd.r, r ? r.raided?.[s] || 0 : '–'); set(rd.a, w.raided?.[s] || 0);
      const m = r?.mobbed?.[s] || 0; set(rd.off, m ? ` · driven off ${m}` : '');
    }
    this.placeYou(); set(this.board.you.r, r ? r.you : '–'); set(this.board.you.a, w.you);
    let over = '';
    if (r?.over) {
      const parts = BOARD_SPECIES.filter(s => s !== r.winner).map(s => `${BOARD_NAMES[s]} ${r.counts[s] || 0}`).join(', ');
      over = r.winner ? `Round over. ${cap(BOARD_NAMES[r.winner])} gathered the most: ${r.counts[r.winner]}. Then ${parts}. You gathered ${r.you}.`
        : `Round over: a tie. ${BOARD_SPECIES.map(s => `${BOARD_NAMES[s]} ${r.counts[s] || 0}`).join(', ')}. You gathered ${r.you}.`;
    }
    set(this.board.over, over);
  }

  // v4: what the player's raid is doing, for the hint line (null when not at a granary).
  raidHint() {
    const me = this.player, w = this.world, o = this.raidOak;
    if (this.mobbedT > 0) return this.mobbedBy === 'squirrel' ? 'chased off by the owner' : 'mobbed: the woodpecker family is driving you off';
    if (!o || !RAID_SPECIES.includes(me.species)) return null;
    const off = (me.off || 0) + 0.5 - w.clock;
    if (off > 0) return `driven off: ${Math.ceil(off)} s before you can try their granary again`;
    const away = this.animals?.famAway(o.id), fam = away ? 'the family is away gathering' : 'the family is home: they will mob you';
    if (!this.raidAt) return me.species === 'sciurus_griseus' ? `a granary (${w.granaries[o.id] || 0} acorns): climb its trunk to pull one out; ${fam}`
      : `a granary (${w.granaries[o.id] || 0} acorns): hold by its trunk (H hovers) to pull one out; ${fam}`;
    if (me.carrying >= me.cap) return `your ${me.species === 'corvus_corax' ? 'pouch' : 'mouth'} is full: no room for a granary acorn`;
    if (this.raidGuarded) return 'a woodpecker is right by the hole: the acorn will not come free';
    return `pulling an acorn from the granary… ${fam}`;
  }

  hud(flash = false) {
    const u = this.ui; if (!u.box) return;
    const w = this.world, me = this.player, r = w.round;
    const found = Object.values(w.stashes).filter(c => c > 0).length;
    u.carried.textContent = `${me.carrying} / ${me.cap}`;
    u.stashed.textContent = w.you;
    u.found.textContent = found;
    if (u.notes) {
      const notes = w.species.map(id => ACORNS[id].common).join(', ') || 'none yet';
      if (u.notes.textContent !== notes) u.notes.textContent = notes;
    }
    const left = r ? Math.max(0, Math.ceil(r.length - r.t)) : 0;
    u.time.textContent = r?.over ? 'over' : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')} left`;
    const hint = this.raidHint() || (me.species === 'melanerpes_formicivorus' ? (me.carrying > 0
        ? 'an acorn in your bill: fly to your family\'s granary, cling to it and press E to hammer it in'
        : 'find an oak: E takes an acorn in the crown (clinging near it) or on the ground; acorns glow. Your family, the squirrels and the ravens are gathering too.')
      : me.species === 'sciurus_griseus' ? (me.carrying > 0
        ? 'an acorn in your mouth: E on open ground buries it, one acorn to a hole'
        : 'find an oak: E picks up an acorn under it, or climbing, in the crown; E on a dug mark digs one up. Woodpeckers, ravens and the other squirrels are gathering too.')
      : me.carrying > 0 && this.nearFull && !this.depositing ? 'stash full, find another'
      : me.carrying > 0 ? `you carry ${me.carrying === 1 ? 'an acorn' : me.carrying + ' acorns'}${me.carrying >= me.cap ? ' (pouch full)' : ''}: stash holes now glow in some oaks`
      : 'find an oak: acorns glow when you are close. Woodpeckers, squirrels and other ravens are gathering too.');
    if (u.hint.textContent !== hint) u.hint.textContent = hint;
    this.updateBoard();
    if (flash) { u.box.classList.remove('flash'); void u.box.offsetWidth; u.box.classList.add('flash'); }
  }
}

const GRANARY_TAG_R = 140;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const BOARD_CSS = `
#game .acorn-board { margin-top:6px; padding-top:6px; border-top:1px solid #263128; font-size:12px; max-width:300px; }
#game .acorn-board.off { display:none; }
#game .acorn-board .bh, #game .acorn-board .br { display:grid; grid-template-columns:1fr 42px 50px; gap:6px; align-items:baseline; }
#game .acorn-board .bh { color:#7f8c83; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; margin-bottom:2px; }
#game .acorn-board .bh span + span { text-align:right; }
#game .acorn-board .br span { color:#b7c4ba; }
#game .acorn-board .br span i { color:#7f8c83; font-style:normal; }
#game .acorn-board .br b { text-align:right; color:#e6ede7; font-weight:600; font-variant-numeric:tabular-nums; }
#game .acorn-board .br.lead span { color:#ffd08a; }
#game .acorn-board .br.you span { padding-left:12px; color:#9fb0a4; }
#game .acorn-board .br.you b { font-weight:500; color:#cfd8d1; }
#game .acorn-board .over:empty { display:none; }
#game .acorn-board .br.raid span { padding-left:12px; color:#8f9c93; font-size:11.5px; }
#game .acorn-board .br.raid span i { color:#e0a080; }
#game .acorn-board .br.raid b { font-weight:500; color:#c9b9a4; font-size:11.5px; }
#game .acorn-news { color:#ffd9a8; font-size:12px; margin-top:4px; max-width:300px; }
#game .acorn-news:empty { display:none; }
#game.mobbed { box-shadow:0 0 0 2px #c8102e88, 0 0 18px #c8102e55; }
#game .acorn-board .over { margin-top:6px; color:#ffe2b0; max-width:290px; }
#game .acorn-board .keys { color:#6f7c73; font-size:10.5px; margin-top:4px; }
#game .acorn-board .keys kbd { background:#1f2a23; border:1px solid #263128; border-radius:4px; padding:0 4px; color:#b7c4ba; font:inherit; }
`;

// Acorns on the ground and in the branches: v1's big glowing nuts read from the air; near the eye they shrink
// toward life size (0.3 of the far size inside 6 m, full beyond 40 m), the ground ones settling onto the ground
// (aGround), so a squirrel or a woodpecker at one is not dwarfed by it.
// For a small player (squirrel, woodpecker) they shrink further, to about life size at the bill (SMALL_NEAR: 0.06 of the
// far size, a ~5 cm nut, inside 2 m), so the acorn is not as big as the animal reaching for it.
const NUT_NEAR = { k: { value: 0.3 }, r: { value: 6 } };
const SMALL_NEAR = { k: 0.06, r: 2 };
function nutMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNutK = NUT_NEAR.k; sh.uniforms.uNutR = NUT_NEAR.r;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGround;\nuniform float uNutK, uNutR;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 nutC = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float nutK = mix(uNutK, 1.0, smoothstep(uNutR, 40.0, distance(nutC.xyz, cameraPosition)));
        transformed *= nutK;
        transformed.y -= aGround * 0.2 * (1.0 - nutK);`);
  };
  m.customProgramCacheKey = () => 'acorn-nut-near';
  return m;
}

// Dug marks: a flat disc whose alpha falls off to the rim, faded per instance.
function markGeometry(cap) {
  const g = new THREE.CircleGeometry(1, 12); g.rotateX(-Math.PI / 2);
  g.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
  return g;
}
function markMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      attribute float aFade; varying vec2 vP; varying float vF;
      void main() { vP = position.xz; vF = aFade; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec2 vP; varying float vF;
      void main() {
        float r = length(vP);
        float a = (1.0 - smoothstep(0.55, 1.0, r)) * vF * 0.85;
        if (a < 0.01) discard;
        vec3 c = mix(vec3(0.075, 0.05, 0.03), vec3(0.2, 0.15, 0.1), smoothstep(0.2, 0.8, r));   // dark fresh soil, paler at the rim
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
}

// Full-stash marker: the Lucide "nut" icon (https://lucide.dev/icons/nut), ISC licence,
// Copyright (c) Lucide Icons and Contributors, drawn as strokes over a soft amber glow.
const LUCIDE_NUT = [
  'M16.847 5.847 20 9a7.23 7.23 0 011.551 7.516C21.241 17.352 21 17.932 21 19v1a1 1 0 01-1 1h-1c-1.069 0-1.648.242-2.485.552A7.2 7.2 0 019.002 20l-3.155-3.153',
  'M18.21 5.43c-1.71.69-5.07 1.07-6.71 1.07.46 1.38.91 2.74.61 4.88a.88.88 0 01-.73.74c-1.78.28-3.54-.17-4.88-.62 0 1.64-.38 5-1.07 6.71-.21.52-.82.55-1.17.12A10 10 0 0118.33 4.26c.43.35.4.97-.12 1.17',
  'M4.93 4.93 3 3a.7.7 0 010-1',
];
function makeAcornIcon() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const glow = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  glow.addColorStop(0, 'rgba(255,190,100,0.85)'); glow.addColorStop(0.5, 'rgba(255,150,60,0.35)'); glow.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 128, 128);
  g.save(); g.translate(16, 16); g.scale(4, 4);            // 24-unit icon drawn at 96 px, centred
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [color, width] of [['rgba(30,18,8,0.9)', 3.6], ['#ffd9a0', 2]]) {   // dark halo stroke, then the icon
    g.strokeStyle = color; g.lineWidth = width;
    for (const d of LUCIDE_NUT) g.stroke(new Path2D(d));
  }
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
