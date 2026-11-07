import * as THREE from 'three';
import { snakeLine, SN_N } from './animalModels.js';
import { F } from './animalNet.js';

// The player's snake (Aaron, 2026-11-06: "Are there any tiles where we can be a snake"): a tile's own snake (fauna.json
// `reptile` 'snake': the western terrestrial garter snake on Lamar and Teton) played on the AI's model and template
// (animalModels.js SNAKE_BODY), driven by groundControl.js (GroundControl calls these with itself as `g` when the
// species' entry has rig 'snake'; snakeEntry makes that entry). docs/movement.md "The snake".
//
// The body follows the head. flight.pos is the steered point, moving along flight.yaw at the crawl's speed; the head
// (the snout's tip) swings to either side of it in a sine of the distance crawled (lateral undulation: the wavelength
// the template's crawl, L / waveN, the swing the one whose heading reaches the template's waveA at a full crawl), and
// every few millimetres of the head's travel go into a trail. The body is drawn along that trail (the shader's SN_PATH:
// each of its SN_N steps' heading and each node's height, sent as a uniform), so the wave stands on the ground and the
// body slides through it, a turn is a curve the body follows rather than a rigid swing, and the body lies over whatever
// the head crossed: the slope, a rock, the water. A strike throws the head straight out ahead of the trail (the body
// sliding up its own path behind it) and back.
//
// Coiling (X) bends the body onto the template's coil (the AI's own, SNAKE_DECL's coil, its snout kept where it is
// and heading the way it heads) by blending the step headings; X again crawls out of the coil a body length and lies
// there basking, stretched out; any move gets up, the trail first replaced by the body as drawn (a coiled snake crawls
// out of its coil). Entering an AI snake (enter) seeds the trail with that animal's own centreline (animalModels.js
// snakeLine: its wave, its turn, its coil), so the body taken is the one seen.
//
// For the group's members (bodySample.js) the body is also kept on the AI's channels (sample): its mean point and mean
// heading (where the AI's draw centres a snake), the wave's phase and gait, the turn's C, the coil: a member's page
// draws the player's snake as its AI snakes are drawn.

const TAU = Math.PI * 2;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const CAP = 512;                 // trail points kept (spaced REC of the body's length: three body lengths and more)
const REC = 1 / 120;             // a trail point every this much of the body's length crawled by the head
const COIL_T = 1.6, LIFT_T = 0.25;   // s to coil (or come out of it); to raise the fore body
const WIND = 0.2, THROW = 0.32;   // of the strike's time: the wind-up's end, the head's arrival (MOVES.strike: hitAt 0.15 of 0.5 s)
const TURN_R = 0.45, CREEP_R = 0.2;   // the tightest turn's radius under way and creeping round, of the body's length
const TONGUE_HZ = 7, TONGUE_N = 3;   // the tongue's flicks: in and out at this rate, this many to an act
const SN_BASK = 170, SN_CRAWL = 171, SN_ALERT = 172;   // animals.js snUpdate's states, for the members' mirror

// A snake's walker entry (playable.js registerStandIns: a stand-in slot whose fauna.json `reptile` is 'snake'): the
// speeds and the camera are fitted to the body when it is entered (fit).
export function snakeEntry(o) {
  return {
    short: o.code, common: o.common || o.one || o.code, model: o.drawn || null, rig: 'snake',
    walk: 0.12, run: 0.9, back: 0, ramp: 1.5, accel: 3, stop: 5, turn: 2.4, jumpH: 0, jumpL: 0, step: 0.2, wade: Infinity,
    half: 0.3, rad: 0.02, shoulder: 0.03, sprint: 4, recover: 20,
    cam: { back: 0.5, up: 0.05, look: 0.35, aimUp: 0.015, side: 0.3, clear: 0.025, near: 0.012, plus: { back: 0.15, up: 0.06 } },
    act: { tongue: true, sniff: true, t: TONGUE_N / TONGUE_HZ + 0.25, word: 'tasting the air' }, alert: { lift: true }, rest: 'coil',
    swims: o.swims ?? true,
  };
}

// Fit the entry to the body: the AI's crawl and dash for its mass (animals.js snakeOf: SNK), the trail and the camera to
// its length L (m: the model's, times the animal's size). A copy per body (the size is the animal's).
export function fit(g) {
  const base = g.S, A = g.animals, info = A.snakeOf?.(g.code), model = g.body?.model;
  const Lm = model?.rig?.piv?.length_m || info?.len || 0.6, L = Lm * (g.size || 1), rad = (model?.rig?.piv?.radius_m || 0.02 * Lm) * (g.size || 1);
  const S = g.S = { ...base, base: base.base || base };
  if (info) { S.walk = info.crawl; S.run = info.dash; S.cruise = info.crawl + 0.4 * (info.dash - info.crawl); S.swims = info.swims; }
  S.half = 0.5 * L; S.rad = Math.max(0.005, 2 * rad); S.shoulder = 2 * rad; S.step = 0.25 * L;
  S.turn = clamp(S.run / (0.15 * L), 1.2, 3.2);
  S.cam = { back: 0.5 * L, up: 0.28 * L, look: 0.5 * L, aimUp: 0.02 * L, side: 0.3, clear: Math.max(0.02, 0.05 * L), near: Math.max(0.006, 0.012 * L),
    plus: { back: 0.15 * L, up: 0.08 * L }, frameY: -0.2 };   // low and close: round the body's middle (groundControl updateCamera), over the tail, looking down on it between the grass
  const sn = g.sn ||= {};
  sn.L = L; sn.Lm = Lm; sn.rad = rad;
  return S;
}

// ---- the trail ---------------------------------------------------------------------------------------------
function state(g) {
  const sn = g.sn ||= {};
  if (!sn.tx) {
    sn.tx = new Float32Array(CAP); sn.ty = new Float32Array(CAP); sn.tz = new Float32Array(CAP); sn.n = 0; sn.i = -1;
    sn.nodes = new Float32Array(3 * (SN_N + 1)); sn.th = new Float32Array(SN_N); sn.ny = new Float32Array(SN_N + 1);
    sn.coilTh = new Float32Array(SN_N); sn.coilY = new Float32Array(SN_N + 1); sn.line = new Float32Array(2 * (SN_N + 1));
    sn.head = new THREE.Vector3(); sn.phi = 0; sn.a = 0; sn.coilK = 0; sn.liftK = 0; sn.ext = 0; sn.hand = 1; sn.rest = null;
    sn.aiPhase = 0; sn.aiAmp = 0; sn.bend = 0; sn.tongue = 0; sn.cx = 0; sn.cy = 0; sn.cz = 0; sn.yaw = 0;
  }
  return sn;
}
function push(sn, x, y, z) { sn.i = (sn.i + 1) % CAP; sn.tx[sn.i] = x; sn.ty[sn.i] = y; sn.tz[sn.i] = z; if (sn.n < CAP) sn.n++; }
// the k-th trail point from the newest (k 0)
const at = (sn, k) => (sn.i - k + CAP * 4) % CAP;
function clearTrail(sn) { sn.n = 0; sn.i = -1; }
// The trail from an array of node positions (x, y, z per node, the snout first): oldest first, so the snout's is newest.
function seed(sn, nodes, count) {
  clearTrail(sn);
  const step = sn.L * REC;
  // past the tail, half a body length on straight (room for a strike's slide)
  const n = count - 1, lx = nodes[3 * n] - nodes[3 * n - 3], lz = nodes[3 * n + 2] - nodes[3 * n - 1], ll = Math.hypot(lx, lz) || 1;
  for (let k = Math.ceil(0.5 * sn.L / step); k >= 1; k--) push(sn, nodes[3 * n] + lx / ll * k * step, nodes[3 * n + 1], nodes[3 * n + 2] + lz / ll * k * step);
  for (let j = n; j >= 1; j--) {   // each node-to-node step resampled at the trail's spacing (from the tail toward the snout)
    const x0 = nodes[3 * j], y0 = nodes[3 * j + 1], z0 = nodes[3 * j + 2], x1 = nodes[3 * j - 3], y1 = nodes[3 * j - 2], z1 = nodes[3 * j - 1];
    const d = Math.hypot(x1 - x0, z1 - z0), m = Math.max(1, Math.round(d / step));
    for (let q = 0; q < m; q++) { const u = q / m; push(sn, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z0 + (z1 - z0) * u); }
  }
  push(sn, nodes[0], nodes[1], nodes[2]);
}

// The SN_N + 1 nodes along the path from the drawn head (sn.head) back, the first `off` m along it (a strike: below 0,
// the head thrown out ahead along dir), into sn.nodes.
function walk(g, off, dx, dz) {
  const sn = g.sn, N = sn.nodes, ds = sn.L / SN_N, H = sn.head;
  // the polyline: [V (a strike's thrown head), H, the trail newest to oldest]
  let px, py, pz, k = -1, acc = 0;   // the segment's start; k: -1 the head itself, else the trail index
  const ext = Math.max(0, -off);
  if (ext > 0) { px = H.x + dx * ext; py = H.y; pz = H.z + dz * ext; k = -2; } else { px = H.x; py = H.y; pz = H.z; }
  let want = Math.max(0, off), i = 0, lx = 0, lz = 0, ly = py;
  const next = () => {   // the point after k on the polyline, or null at the end
    if (k === -2) return [H.x, H.y, H.z];
    const j = k + 1; if (j >= sn.n) return null;
    const q = at(sn, j); return [sn.tx[q], sn.ty[q], sn.tz[q]];
  };
  let nx = 0, ny = 0, nz = 0, seg = 0, have = false;
  const load = () => { const p = next(); if (!p) return false; [nx, ny, nz] = p; seg = Math.hypot(nx - px, nz - pz); return true; };
  have = load();
  while (i <= SN_N) {
    if (have && acc + seg >= want) {   // the node lies on this segment
      const u = seg > 1e-9 ? (want - acc) / seg : 0;
      N[3 * i] = px + (nx - px) * u; N[3 * i + 1] = py + (ny - py) * u; N[3 * i + 2] = pz + (nz - pz) * u;
      i++; want = Math.max(0, off) + i * ds; continue;
    }
    if (have) {   // on to the next segment
      if (seg > 1e-6) { lx = (nx - px) / seg; lz = (nz - pz) / seg; }
      acc += seg; px = nx; py = ny; pz = nz; k = k === -2 ? -1 : k + 1; ly = py;
      have = load(); continue;
    }
    // the trail ran out: on straight along its last direction (or straight back from the heading)
    if (!lx && !lz) { lx = Math.sin(g.flight.yaw); lz = Math.cos(g.flight.yaw); }
    const d = want - acc; N[3 * i] = px + lx * d; N[3 * i + 1] = ly; N[3 * i + 2] = pz + lz * d;
    i++; want = Math.max(0, off) + i * ds;
  }
}

// The steps' headings (the shader's convention: D = (-sin th, -cos th) from the snout toward the tail, in the frame of
// the instance's yaw yawA) and the nodes' heights from the first node, from sn.nodes; then the coil's blend; then the
// nodes again from the blended headings (sn.nodes: what is drawn, for the sample, the tongue and a bake).
function shape(g, yawA) {
  const sn = g.sn, N = sn.nodes, th = sn.th, ny = sn.ny, ds = sn.L / SN_N, size = g.size || 1;
  let prev = 0;
  for (let i = 0; i < SN_N; i++) {
    const dx = N[3 * i + 3] - N[3 * i], dz = N[3 * i + 5] - N[3 * i + 2];
    let t = Math.atan2(-dx, -dz) - yawA;
    t = i === 0 ? wrap(t) : prev + wrap(t - prev);
    th[i] = prev = t;
  }
  const y0 = N[1];
  for (let i = 0; i <= SN_N; i++) ny[i] = N[3 * i + 1] - y0;
  const c = sn.coilK;
  if (c > 1e-4) {
    for (let i = 0; i < SN_N; i++) th[i] += (sn.coilTh[i] - th[i]) * c;
    for (let i = 0; i <= SN_N; i++) ny[i] += (sn.coilY[i] - ny[i]) * c;
    for (let i = 0; i < SN_N; i++) {   // the nodes the blend draws
      const a = th[i] + yawA;
      N[3 * i + 3] = N[3 * i] - Math.sin(a) * ds; N[3 * i + 5] = N[3 * i + 2] - Math.cos(a) * ds; N[3 * i + 4] = y0 + ny[i + 1];
    }
  }
  // the uniform: headings per step, heights per node, in the model's units
  const U = g.body?.snPath?.value;
  if (U) { for (let i = 0; i <= SN_N; i++) { U[2 * i] = th[Math.min(i, SN_N - 1)]; U[2 * i + 1] = ny[i] / size; } }
}

// The coil to bend into, from the template's own (animalModels.js snakeLine, pose 1): its step headings turned so the
// snout's step keeps the present one, and the ground under it.
function makeCoil(g, yawA) {
  const sn = g.sn, model = g.body?.model; if (!model) return;
  const line = snakeLine(model, 0, 0, 1, 0, sn.hand, sn.line), ds = sn.L / SN_N, H = sn.head;
  let prev = 0, c0 = 0;
  for (let i = 0; i < SN_N; i++) {
    const dx = line[2 * i + 2] - line[2 * i], dz = line[2 * i + 3] - line[2 * i + 1];
    let t = Math.atan2(-dx, -dz); t = i === 0 ? t : prev + wrap(t - prev); prev = t;
    if (i === 0) c0 = t;
    sn.coilTh[i] = t - c0 + sn.th[0];
  }
  let x = H.x, z = H.z; sn.coilY[0] = 0;
  for (let i = 0; i < SN_N; i++) {
    const a = sn.coilTh[i] + yawA; x -= Math.sin(a) * ds; z -= Math.cos(a) * ds;
    sn.coilY[i + 1] = g.heights.atXZ(x, z) - H.y;
  }
}
// The trail replaced by the body as drawn (out of a coil, its crawl starts from the shape it is in).
function bake(g) {
  const sn = g.sn; seed(sn, sn.nodes, SN_N + 1); sn.coilK = 0;
  const N = sn.nodes; g.flight.pos.set(N[0], N[1], N[2]); sn.a = 0;
  g.flight.yaw = Math.atan2(-(N[0] - N[3]), -(N[2] - N[5]));
}

// ---- entering ---------------------------------------------------------------------------------------------
// From the AI animal a (or none: a fresh body, straight and still at the flight's place): the trail is its centreline.
export function enter(g, a) {
  const sn = state(g); fit(g);
  const f = g.flight, model = g.body?.model, N = sn.nodes, size = g.size || 1;
  sn.hand = a?.hand || (Math.random() < 0.5 ? -1 : 1); sn.coilK = 0; sn.liftK = 0; sn.ext = 0; sn.a = 0; sn.rest = null; sn.tongue = 0;
  if (a && model) {   // the animal's own body: its wave, its turn, its coil (as its draw had it), in the world
    const line = snakeLine(model, a.phase || 0, a.amp || 0, a.pose || 0, a.e0 ?? a.bend ?? 0, a.hand || 1, sn.line);
    const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    for (let i = 0; i <= SN_N; i++) {
      const mx = line[2 * i] * size, mz = line[2 * i + 1] * size, x = a.x + mx * cy + mz * sy, z = a.z - mx * sy + mz * cy;
      N[3 * i] = x; N[3 * i + 2] = z; N[3 * i + 1] = ground(g, x, z);
    }
    sn.phi = (a.phase || 0) - Math.PI / 2; sn.aiPhase = a.phase || 0; sn.aiAmp = a.amp || 0;
    if ((a.pose || 0) > 0.5) sn.rest = 'coil';
  } else {
    const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw), ds = sn.L / SN_N;   // straight back from the head
    for (let i = 0; i <= SN_N; i++) { const x = f.pos.x + fx * ds * i, z = f.pos.z + fz * ds * i; N[3 * i] = x; N[3 * i + 2] = z; N[3 * i + 1] = ground(g, x, z); }
  }
  seed(sn, N, SN_N + 1);
  f.pos.set(N[0], N[1], N[2]); sn.head.copy(f.pos);
  f.yaw = Math.atan2(-(N[0] - N[3]), -(N[2] - N[5]));
  g.resting = !!sn.rest; g.mode = 'ground'; g.v = 0; g.last.copy(f.pos);
}
// the ground (a rock top, the drawn terrain) at x, z under the body's height, or the water's surface where it swims
function ground(g, x, z) {
  const F = g.sq.footing(x, z, (g.flight.pos.y || g.heights.atXZ(x, z)) + 0.5), land = Math.max(F.bed, g.heights.atXZ(x, z)), r = g.sn?.rad || 0.01;
  return F.surf !== null && F.surf > land + r && g.S.swims ? F.surf - 0.4 * r : Math.max(land, F.y);
}

// ---- the frame --------------------------------------------------------------------------------------------
export function step(g, dt, k, jump, act, rest) {
  const f = g.flight, P = f.pos, S = g.S, sn = state(g), ps = g.pose;
  if (!sn.L) fit(g);
  if (g.mode === 'kicked') { g.kickedStep(dt); record(g, dt, 0); return; }
  if (g.mode === 'strike') { strikeStep(g, dt); return; }
  if (jump) { const now = performance.now(); if (now > g.told) { g.told = now + 4000; g.say(`a ${S.common} cannot jump`); } }
  // X: coil; X again: crawl out of the coil a body length and bask there, stretched out; any move gets up
  if (rest) {
    if (sn.rest === 'coil') { if (sn.coilK > 0.01) bake(g); sn.rest = null; sn.basking = sn.L * 1.0; g.say('stretching out to bask'); }
    else if (sn.rest === 'bask' || sn.basking) { sn.rest = null; sn.basking = 0; }
    else { sn.rest = 'coil'; makeCoil(g, f.yaw + Math.PI); }
  }
  const moving = k.fwd > 0 || k.turn !== 0;
  if (moving && (sn.rest || sn.basking)) { if (sn.coilK > 0.01) bake(g); sn.rest = null; sn.basking = 0; }
  g.resting = !!sn.rest;
  const alert = k.shift && !k.fwd && !k.turn && !sn.rest && !sn.basking;
  g.sit = damp(g.sit, alert ? 1 : 0, alert ? 6 : 8, dt);
  if (g.needs?.hunter && g.animals?.setStalk) g.animals.setStalk(Math.abs(g.v) < 0.02 ? 0.4 : Math.abs(g.v) < S.walk * 1.5 ? 0.55 : 1);   // a snake's stalk: still, or creeping
  // E: a strike at prey in reach (combat.js), else the tongue's flicks (the sniff: scent.js, sniffWave.js)
  const fights = !!g.combat?.active;
  if (act && fights && g.combat.useNear('strike')) { g.actT = 0; return; }
  if (act) { g.actT = S.act.t; sn.tongue = 0; ps.fl = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.3); }
  g.actT = Math.max(0, g.actT - dt);
  // the speed: W from the crawl to the cruise over `ramp` s, Shift W the dash (the legs: S.sprint s of it), A or D alone
  // a creep round (a snake turns by crawling); in water slower; S stops
  g.holdT = k.fwd > 0 ? g.holdT + dt : 0;
  const cruise = S.cruise ?? S.walk * 2, dashing = k.shift && k.fwd > 0 && !g.tired;
  let target = k.fwd > 0 ? S.walk + ((dashing ? S.run : cruise) - S.walk) * Math.min(1, g.holdT / S.ramp) : k.turn ? S.walk : 0;
  if (sn.basking > 0) { target = S.walk; sn.basking -= Math.abs(g.v) * dt; if (sn.basking <= 0) { sn.basking = 0; sn.rest = 'bask'; } }
  if (sn.rest) target = 0;
  if (g.wet) target *= 0.75;
  target *= g.needs?.slow ?? 1;
  {   // the legs: as the walkers' (groundControl), a dash lasts S.sprint s
    const fast = dashing && g.v > cruise * 0.95;
    g.stamina = clamp((g.stamina ?? 1) + (fast ? -dt / (S.sprint || 4) : dt / (S.recover || 20)), 0, 1);
    if (g.stamina <= 0) g.tired = true; else if (g.stamina > 0.5) g.tired = false;
    if (g.tired && target > cruise * 0.6) target = cruise * 0.6;
  }
  g.v = damp(g.v, target, target < g.v ? S.stop : S.accel, dt);
  if (g.v < 0.003 && !target) g.v = 0;
  // the turn: a curve no tighter than TURN_R of the body's length in radius under way, CREEP_R creeping round (A or D
  // alone: a snake turns by crawling round, the body following the head's curve)
  const rate = Math.min(S.turn, Math.max(g.v, S.walk * 0.5) / ((k.fwd > 0 ? TURN_R : CREEP_R) * sn.L));
  if (!sn.rest) f.yaw += k.turn * rate * dt;
  if (k.fwd || k.turn) f.settleLook(dt);
  // the step: water it cannot swim stops it, a face higher than S.step is a wall; it slides down any drop
  const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), d = g.v * dt;
  if (d > 0) {
    const nx = P.x + fx * d, nz = P.z + fz * d, Fo = g.sq.footing(nx, nz, P.y + S.step + 0.05);
    const surf = Fo.surf, depth = Fo.depth, land = Math.max(Fo.bed, g.heights.atXZ(nx, nz)), swim = surf !== null && depth > 2 * sn.rad && surf > land + sn.rad;   // (a creek's depth runs under its draped banks: the water must be over the drawn ground)
    if (swim && !S.swims) { g.v = 0; const now = performance.now(); if (now > g.told) { g.told = now + 6000; g.say(`a ${S.common} keeps out of the water`); } }
    else if (!swim && land - P.y > S.step) g.v = 0;
    else {
      P.x = clamp(nx, 5, g.tile.size - 5); P.z = clamp(nz, -g.tile.size + 5, -5);
      P.y = swim ? surf - 0.4 * sn.rad : Math.max(land, Fo.y);
      g.wet = swim ? { surf, depth: surf - land } : null;
    }
  }
  record(g, dt, d);
  animate(g, dt, alert);
}

// The head's swing about the steered point by the distance crawled, and the trail behind it.
function record(g, dt, d) {
  const f = g.flight, P = f.pos, sn = g.sn, S = g.S, Kr = g.body?.model?.rig?.k;
  const waveN = Kr?.waveN || 1.35, waveA = Kr?.waveA || 0.65, lam = sn.L / waveN;
  const gait = clamp(g.v / Math.max(S.run, 1e-3) + 0.55, 0, 1) * (g.wet ? 1.25 : 1);   // a crawl 0.7 of the swing, a dash all of it; swimming wider
  const aT = g.v > 0.002 ? Math.tan(waveA * Math.min(1.2, gait)) * lam / TAU : sn.a;
  if (d > 0) { sn.a += (aT - sn.a) * (1 - Math.exp(-d / (0.25 * lam))); sn.phi += TAU * d / lam; }
  const rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw), s = sn.a * Math.sin(sn.phi);   // the right of the heading
  sn.head.set(P.x + rx * s, P.y, P.z + rz * s);
  if (g.wet) sn.head.y = P.y; else if (Math.abs(s) > 1e-4) sn.head.y = Math.max(P.y - 0.05, g.heights.atXZ(sn.head.x, sn.head.z));
  const q = at(sn, 0), step = sn.L * REC;
  if (sn.n === 0 || Math.hypot(sn.head.x - sn.tx[q], sn.head.z - sn.tz[q]) >= step) push(sn, sn.head.x, sn.head.y, sn.head.z);
  // the AI's channels (sample): the phase as snUpdate advances it, the gait, the turn's C
  const wr = wrap(f.yaw - (sn.yawWas ?? f.yaw)) / Math.max(dt, 1e-3); sn.yawWas = f.yaw;
  sn.aiPhase += TAU * waveN * d / Math.max(0.05, sn.L);
  sn.aiAmp = damp(sn.aiAmp, g.v > 0.002 ? clamp(0.7 + 0.3 * g.v / S.run, 0, 1) : 0, 3, dt);
  sn.bend = damp(sn.bend, clamp(wr * 0.3, -0.8, 0.8), 6, dt);
  g.spd = Math.abs(g.v); g.inAir = false;
}

// The pose's channels: the coil's blend, the fore body raised (Shift held still, a strike's wind-up), the head's turn.
function animate(g, dt, alert) {
  const sn = g.sn, ps = g.pose;
  sn.coilK = clamp(sn.coilK + (sn.rest === 'coil' ? dt : -dt) / COIL_T, 0, 1);
  if (sn.rest !== 'coil' && sn.coilK > 0 && sn.coilK < 1) sn.coilK = 0;   // (a coil left is baked into the trail: bake)
  sn.liftK = damp(sn.liftK, alert ? 1 : 0, 1 / LIFT_T, dt);
  ps.fl *= Math.exp(-1.2 * dt);
  const flick = g.actT > 0 ? 0.25 * Math.sin(performance.now() * 0.009) + ps.fl : ps.fl;
  ps.flick = damp(ps.flick, flick, 6, dt);
  if (g.actT > 0) sn.tongue += dt; else sn.tongue = 0;
}

// ---- the strike (combat.js: groundControl attack('strike')) ------------------------------------------------
// Wind-up (to WIND of the strike): the fore body raised and drawn back up the path into an S; the throw (to THROW): the
// head out straight at the prey (a snake's strike reaches it in about a tenth of a second); the hit at hitAt; held a
// moment, then back down the path.
export function attack(g, p, o) {
  const f = g.flight, P = f.pos, sn = state(g);
  if (sn.coilK > 0.01) bake(g);
  sn.rest = null; sn.basking = 0; g.resting = false;
  const d = Math.hypot(p.x - P.x, p.z - P.z);
  g.strike = { kind: 'strike', t: 0, dur: o.dur, hitAt: o.hitAt, p, o, fired: false, reach: Math.max(0.02, Math.min(d, 0.45 * sn.L)) };
  g.mode = 'strike'; g.v = 0; g.actT = 0;
}
function strikeStep(g, dt) {
  const f = g.flight, P = f.pos, T = g.strike, sn = g.sn, p = T.p;
  T.t += dt; const u = Math.min(1, T.t / T.dur);
  if (p && !p.dead && !p.gone) { T.dx = p.x - sn.head.x; T.dz = p.z - sn.head.z; const l = Math.hypot(T.dx, T.dz) || 1; T.dx /= l; T.dz /= l; }
  else if (T.dx === undefined) { T.dx = -Math.sin(f.yaw); T.dz = -Math.cos(f.yaw); }
  const pull = -0.12 * sn.L, W = WIND, R = THROW;   // drawn back into the S (m up the path)
  sn.ext = u < W ? pull * (u / W) : u < R ? pull + (T.reach - pull) * ((u - W) / (R - W)) : u < R + 0.1 ? T.reach : T.reach * Math.max(0, 1 - (u - R - 0.1) / (0.9 - R));
  sn.liftK = u < W ? u / W : u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.4);
  g.pose.flick = damp(g.pose.flick, 0, 10, dt);
  if (!T.fired && T.t >= T.hitAt) { T.fired = true; T.o.onHit?.(); }
  if (u >= 1) { g.strike = null; g.mode = 'ground'; sn.ext = 0; }
  g.spd = 0; g.inAir = false;
}

// ---- drawing ---------------------------------------------------------------------------------------------
export function draw(g, dt) {
  const b = g.body, sn = g.sn; if (!b || !sn?.tx || !b.snPath) return;
  const m = b.mesh, f = g.flight, size = g.size || 1, ps = g.pose;
  m.visible = true;
  const yawA = f.yaw + Math.PI;
  // a strike throws the head out ahead (ext > 0: the path walked from a point ahead) or draws it back up the path
  walk(g, -sn.ext, g.strike?.dx ?? -Math.sin(f.yaw), g.strike?.dz ?? -Math.cos(f.yaw));
  shape(g, yawA);
  const N = sn.nodes, z0 = (b.model.rig.piv.snout_z ?? 0.35) - 0.5 * sn.Lm;
  g._p.set(N[0] - z0 * size * Math.sin(yawA), N[1], N[2] - z0 * size * Math.cos(yawA));
  g._e.set(0, yawA, 0, 'YXZ'); g._q.setFromEuler(g._e); g._s.setScalar(size);
  g._m.compose(g._p, g._q, g._s); g._m.toArray(m.instanceMatrix.array, 0); m.instanceMatrix.needsUpdate = true;
  const an = m.geometry.attributes.aAnim; an.array[0] = 0; an.array[1] = 0; an.array[2] = -0.85 * sn.liftK; an.array[3] = ps.flick; an.needsUpdate = true;
  const a2 = m.geometry.attributes.aAnim2; if (a2) { a2.array[0] = 0; a2.array[1] = sn.hand; a2.array[2] = 0; a2.array[3] = 0; a2.needsUpdate = true; }
  // the AI's view of the body (sample, leave): its mean point and mean heading
  let mx = 0, my = 0, mz = 0, mt = 0;
  for (let i = 0; i < SN_N; i++) { mx += 0.5 * (N[3 * i] + N[3 * i + 3]); my += 0.5 * (N[3 * i + 1] + N[3 * i + 4]); mz += 0.5 * (N[3 * i + 2] + N[3 * i + 5]); mt += sn.th[i]; }
  sn.cx = mx / SN_N; sn.cy = my / SN_N; sn.cz = mz / SN_N; sn.yaw = mt / SN_N + yawA;   // the AI's yaw: forward +z
  tongue(g);
}

// The forked tongue: out and back TONGUE_N times while E's act runs, from the snout along the head's heading (the head's
// turn about the neck included), a little down at the forks.
function tongue(g) {
  const sn = g.sn, f = g.flight;
  if (!g.tongueMesh) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    g.tongueMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb3262e }));
    g.tongueMesh.frustumCulled = false; g.tongueMesh.name = 'player snake tongue'; g.scene.add(g.tongueMesh);
  }
  const T = g.tongueMesh, out = g.on && g.actT > 0 ? Math.max(0, Math.sin(Math.PI * Math.min(TONGUE_N, sn.tongue * TONGUE_HZ))) : 0;
  T.visible = out > 0.02;
  if (!T.visible) return;
  const N = sn.nodes, hx = N[0] - N[3], hz = N[2] - N[5], hl = Math.hypot(hx, hz) || 1;
  const turn = g.pose.flick * (g.body?.model?.rig?.k?.flickYaw || 0.5), c = Math.cos(turn), s = Math.sin(turn);
  const dx = (hx * c + hz * s) / hl, dz = (-hx * s + hz * c) / hl, len = 0.06 * sn.L * out, fork = 0.35 * len, lift = 0.6 * sn.rad + 0.85 * sn.liftK * 0.07 * sn.L;
  const x0 = N[0], y0 = N[1] + lift, z0 = N[2], x1 = x0 + dx * len, y1 = y0 - 0.1 * len, z1 = z0 + dz * len;
  const px = -dz, pz = dx, a = T.geometry.attributes.position.array;
  a.set([x0, y0, z0, x1, y1, z1, x1, y1, z1, x1 + dx * fork + px * fork * 0.45, y1 - 0.15 * fork, z1 + dz * fork + pz * fork * 0.45,
    x1, y1, z1, x1 + dx * fork - px * fork * 0.45, y1 - 0.15 * fork, z1 + dz * fork - pz * fork * 0.45]);
  T.geometry.attributes.position.needsUpdate = true;
}
export function hideTongue(g) { if (g.tongueMesh) g.tongueMesh.visible = false; }

// ---- for the others ------------------------------------------------------------------------------------------
// The body as the AI draws a snake (bodySample.js): out (animalNet.js FIELDS). The mean point and heading, the wave.
export function sample(g, out) {
  const sn = g.sn; if (!sn?.tx) return false;
  out[F.x] = sn.cx; out[F.y] = sn.cy; out[F.z] = sn.cz; out[F.yaw] = sn.yaw; out[F.pitch] = 0; out[F.roll] = 0;
  out[F.phase] = sn.aiPhase; out[F.amp] = sn.aiAmp; out[F.pose] = sn.coilK > 0.01 ? sn.coilK : -0.8 * sn.liftK; out[F.flick] = g.pose.flick;
  out[F.e0] = sn.bend; out[F.e1] = sn.hand; out[F.e2] = 0; out[F.e3] = 0;
  out[F.spd] = Math.abs(g.v); out[F.state] = g.v > 0.002 ? SN_CRAWL : sn.liftK > 0.5 ? SN_ALERT : SN_BASK;
  return true;
}
// Where the AI takes the body back (groundControl leaveInfo): its mean point and heading (the flight's frame), its coil.
export function leave(g, o) {
  const sn = g.sn; if (!sn?.tx) return o;
  o.x = sn.cx; o.z = sn.cz; o.y = sn.cy; o.yaw = wrap(sn.yaw - Math.PI); o.pose = sn.rest === 'coil' ? sn.coilK : 0; o.phase = sn.aiPhase;
  return o;
}
// The HUD's where line.
export function hudText(g) {
  const sn = g.sn || {};
  if (g.mode === 'strike') return 'striking';
  if (sn.rest === 'coil') return sn.coilK < 1 ? 'coiling' : 'coiled';
  if (sn.basking > 0) return 'stretching out';
  if (sn.rest === 'bask') return 'basking, stretched out';
  if (g.wet) return `swimming, ${Math.round(g.wet.depth * 100)} cm of water`;
  if (g.actT > 0) return 'tasting the air';
  if (sn.liftK > 0.5) return 'head raised, watching';
  return g.v > (g.S.cruise ?? 0.3) * 1.05 ? 'dashing' : g.v > 0.003 ? 'crawling' : 'lying still';
}
