// The legs: a gait engine for the quadrupeds (docs/movement.md "The legs"; Aaron, 2026-10-30: "the leg rigging for
// quadrupeds still needs work - how do we get a good result"). Pure arithmetic, no three.js, so tools/bake_gait.mjs can
// run it in node to bake the far tier's cycles with the same code the near tier runs live.
//
// A skinned quadruped (tools/rig_quadruped.py: 20 joints, every rest orientation the identity) is posed here each frame,
// per instance, on the CPU, from what the AI or the player already knows: where the body is and faces, how fast it goes,
// how fast it turns, the terrain's height, and its locomotion row (client/src/locomotion.js: the Froude bands walk_mps /
// trot_mps of the hip height, the stride rate stride_hz and length stride_m at the trot-gallop change, the posture, the
// turn block). The principles, by the rank of the tree they belong to:
//   kingdom   a limb pushes against the world and the body follows: a foot that has landed stays where it landed while
//             the body passes over it (the stance); a standing turn is the feet stepping round the turn
//   class     Mammalia: the gait by the Froude number (walk below 0.5, trot to 2.5, gallop beyond, Alexander & Jayes),
//             the footfalls of Hildebrand's gait diagrams (walk: the lateral sequence LH LF RH RF a quarter cycle apart;
//             trot: diagonal pairs; gallop: hind pair then fore pair, a suspension between), the duty factor falling
//             with speed (0.7 at a slow walk to 0.4 at a gallop), the cadence rising to stride_hz at the trot-gallop change
//             and the stride stretching beyond it (Heglund & Taylor), the spine flexing in the gallop, the head level
//   order     the foot: digitigrade (cats, dogs: up on the toes, the wrist and hock in the air), plantigrade (bears: the
//             sole flat, the heel on the ground); Ursidae amble: the lateral pairs together (a pace) where others trot
//   species   only its numbers (the row) and its skeleton (the GLB)
//
// Each foot: in stance it is held at the world point where it landed; at phase `duty` it lifts and swings on an arc to
// the next plant point, predicted half a stance ahead of where its hip will be at touchdown (the body's speed and turn
// rate carried forward), the height read from the terrain. Each leg: an analytic two-bone IK (upper, lower) to the ankle,
// the foot bone standing on its toe (digitigrade) or lying along the ground (plantigrade). The body: the hips' and chest's
// heights from the ground under the hind and fore feet (a slope is met by the legs bending, the back following most of the
// slope), a bob with the gait, a little roll onto the supporting side, the spine arching in the gallop and bending into a
// turn (the forequarters toward the heading the hips lag behind: the deer's bendOf), the head counter-pitched level and
// leading a turn, the tail lagging the turn and swinging with the gallop. Pose (the AI's aAnim.z) crouches the body
// (a stalk, a dig) and past a half lowers it onto the ground with the legs folded (bedded).
//
// Strides that are never the same (docs/behaviour-rig.md 5; docs/movement.md "Strides that vary"; Aaron, 2026-11-11: "not
// every stride or movement is the same"). Variation comes from causes, each a rule of the tree's `vary` block (Mammalia;
// the sources are in its note and in movement.md), never from noise laid on the joints:
//   the individual  individualParams(P, seed, size): from the instance's seed its condition (mass at its size), its lead in
//                   the gallop, a slight left-right asymmetry, a preferred speed; from its drawn size its own hip height, so
//                   its own Froude bands and cadence (a small animal steps quicker); a limp as an input
//   the stride      the stride clock st.sc counts strides (its fraction is the phase). The tempo drifts with it (drift():
//                   a white part and octaves of slow wander, so consecutive strides are alike and distant ones are not),
//                   and at each touchdown a foot draws its next landing's phase, reach and width from the same drift
//   the gait        the feet's lags chase the gait's diagram at a bounded rate instead of jumping to it; the walk's lag
//                   slides with speed; the gallop's lead is the individual's, the inside fore through a turn
//   the ground      the tempo answers the slope under the body; a foot looks for flat ground near its landing
//   the soft parts  the head and the tail follow the trunk late and overshoot (follow(): a damped spring)
//   standing        a foot left far from under its shoulder steps in, one at a time, and never quite square
// Everything is a function of the seed and the stride clock: a host streams the clock (animalNet.js `sc`) and a mirror's
// engine locks to it (inp.sc), so both pages draw the same strides. A stance foot is never moved: variation changes where
// and when a foot lands, not whether it slides.
//
// Output: the 3x4 matrix of every joint, [R | p - R q] for the posed head p, rest head q and rotation R (the frame
// tools/bake_clips.py writes), into a row of a pose texture (animalModels.js SKIN_LIVE reads the instance's row when
// aClip.x is negative). Far instances take baked cycles of the same engine (farDrive below, tools/bake_gait.mjs).

export const LEG_NAMES = ['FL', 'FR', 'HL', 'HR'];
const G = 9.81, TAU = Math.PI * 2;
// Hildebrand's footfalls: the phase (0..1 of the cycle) at which each foot lands, [FL, FR, HL, HR]
const FOOTFALL = {
  walk: [0.25, 0.75, 0.0, 0.5],              // lateral sequence: LH, LF, RH, RF
  trot: [0.5, 0.0, 0.0, 0.5],                // diagonal pairs: LH + RF, then RH + LF
  pace: [0.06, 0.56, 0.0, 0.5],              // lateral pairs: the bear's amble (LH + LF, RH + RF, the fore a touch late)
  transverse: [0.5, 0.65, 0.0, 0.15],        // gallop: LH, RH, LF, RF (horses, deer)
  rotary: [0.65, 0.5, 0.0, 0.15],            // gallop: LH, RH, RF, LF (cats and dogs at speed)
  bound: [0.5, 0.5, 0.0, 0.0],               // the rodents' bound (later)
};
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const ease = s => s * s * (3 - 2 * s);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const frac = x => x - Math.floor(x);
const wrap1 = x => x - Math.round(x);   // a cycle fraction into [-0.5, 0.5]

// ---- variation: the seed, the drift, the follower ---------------------------------------------------------------------
export const SC_WRAP = 1024;   // the stride clock runs in [1, 1 + SC_WRAP) and wraps (0: none; the drift repeats over it)
export function seedOf(id) { const s = String(id); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
// an integer hash of (seed, channel, index) to [0, 1)
export function h32(seed, ch, k) {
  let h = (seed ^ Math.imul(ch + 0x9e3779b9 | 0, 0x85ebca6b) ^ Math.imul(k + 0x7f4a7c15 | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const gauss = (seed, ch, k) => (h32(seed, ch, k) + h32(seed, ch, k + 7919) + h32(seed, ch, k + 15838) - 1.5) * 2;   // near normal, unit variance, within +-3
// The drift: a signal of the stride clock s with zero mean and unit variance. W[0] weighs a white part (a new draw each
// stride), W[1..] octaves of smooth value noise with lattices 1, 4, 16, 64 and 256 strides apart (equal weights are near
// 1/f: the long-range correlation of stride intervals). W is normalised by driftWeights. Periodic over SC_WRAP.
const OCT = [1, 4, 16, 64, 256], VN = 2.0096, WN = 1.7320508;   // 1 / the sd of an octave's interpolated lattice, and of a uniform draw in [-1, 1]
export function driftWeights(w) { const n = Math.hypot(...w) || 1; return w.map(x => x / n); }
export function drift(seed, ch, s, W) {
  let x = W[0] ? W[0] * WN * (2 * h32(seed, ch * 8, Math.floor(s) % SC_WRAP) - 1) : 0;
  for (let o = 0; o < OCT.length; o++) {
    const w = W[o + 1]; if (!w) continue;
    const p = OCT[o], n = SC_WRAP / p, q = s / p, k = Math.floor(q), u = q - k, e = u * u * (3 - 2 * u);
    const a = h32(seed, ch * 8 + o + 1, k % n), b = h32(seed, ch * 8 + o + 1, (k + 1) % n);
    x += w * VN * ((a + (b - a) * e) * 2 - 1);
  }
  return x;
}
// A follower with lag and overshoot: S = { y, v } driven toward x as a damped spring of w rad/s and damping ratio z
// (stepped in parts when the frame is long, so a slow frame does not blow it up).
export function follow(S, x, w, z, dt) {
  if (!(S.y === S.y)) { S.y = x; S.v = 0; }
  const n = Math.max(1, Math.ceil(dt * w / 0.35)), h = dt / n;
  for (let i = 0; i < n; i++) { S.v += (w * w * (x - S.y) - 2 * z * w * S.v) * h; S.y += S.v * h; }
  return S.y;
}
const spring = () => ({ y: NaN, v: 0 });

// ---- small vector and rotation helpers (row-major 3x3 as 9 floats) ---------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
function mul3(A, B) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return o;
}
const apply3 = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
// Rodrigues: a rotation of `t` radians about the unit axis k
function axisAngle(k, t) {
  const c = Math.cos(t), s = Math.sin(t), v = 1 - c, [x, y, z] = k;
  return [c + x * x * v, x * y * v - z * s, x * z * v + y * s, y * x * v + z * s, c + y * y * v, y * z * v - x * s, z * x * v - y * s, z * y * v + x * s, c + z * z * v];
}
const rotX = t => axisAngle([1, 0, 0], t), rotY = t => axisAngle([0, 1, 0], t), rotZ = t => axisAngle([0, 0, 1], t);
// the smallest rotation carrying unit direction a onto unit direction b
function between(a, b) {
  const k = cross(a, b), s = len(k), c = dot(a, b);
  if (s < 1e-6) {
    if (c > 0) return I3();
    const p = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], ax = unit(cross(a, p));
    return axisAngle(ax, Math.PI);
  }
  return axisAngle(scale(k, 1 / s), Math.atan2(s, c));
}

// The leg's reach bounds the step (2026-11-11): a foot is not planted further ahead than its leg reaches, a planted foot
// lifts when the body has gone on past its leg's reach, and between the two the hips or the chest ride as low as the
// planted legs need (a straight-legged walker vaults over each leg: low with the legs spread, high over a planted one),
// by at most REACH_DROP of the leg, and REACH_RUN more in the gallop (a running body rides low over legs that fold under
// it). Without it a long stride left the drawn toe short of its plant point: foot slide. (The three numbers are by eye.)
const REACH_FOOT = 0.85, REACH_DROP = 0.06, REACH_RUN = 0.06;
// how far ahead (dir 1) or behind (-1) of its rest place a foot's leg reaches, the joint dropped by `drop`; local units
function reachOf(Lg, dir, drop) {
  const hb = Math.sqrt(Math.max(0, Lg.reach * Lg.reach - (Lg.sy - drop) * (Lg.sy - drop) - Lg.dx0 * Lg.dx0));
  return Math.max(0, hb - dir * Lg.dz0) / (1 - Lg.slide);
}
// how far the joint must come down for a planted foot at `here` (local) to stay within the leg's reach; jy: the joint's height now
function reachDrop(Lg, here, jy) {
  const dz = Lg.dz0 + (1 - Lg.slide) * (here[2] - Lg.toe[2]), dx = Lg.dx0 + here[0] - Lg.toe[0];
  return Math.max(0, jy - here[1] - Math.sqrt(Math.max(0, Lg.reach * Lg.reach - dz * dz - dx * dx)));
}

// A swinging foot's landing point tl (local) pulled in to where its leg will reach: from the joint as it is posed now (Sj:
// the last frame's, with the spine's flex and the body's height in it), carried on by the share of the foot's travel the
// joint goes with (here: the foot now). tl is in the body's frame now, `on` further along than it will be in the body's
// frame at the landing (the body's travel in the time left). Returns tl's z, changed only when it is out of reach.
function reachClamp(Lg, Sj, here, tl, on, drop = 0) {   // drop: how far the joint may still come down for it
  if (!Sj) return tl[2];
  const k = Lg.slide, z = tl[2] - on, jz = Sj[2] + k * (z - here[2] + on), dy = Sj[1] - drop - tl[1], dx = Sj[0] - tl[0], r = 0.97 * Lg.reach;
  const dz = z - jz, hz = Math.sqrt(Math.max(0, r * r - dy * dy - dx * dx));
  return Math.abs(dz) <= hz ? tl[2] : (Sj[2] + k * (on - here[2]) + Math.sign(dz) * hz) / (1 - k) + on;
}

// ---- the skeleton (from the GLB's extras.skin, tools/rig_quadruped.py) --------------------------------------------
export function skeletonOf(sk) {
  const idx = Object.fromEntries(sk.joints.map((n, i) => [n, i]));
  const rest = sk.joint_rest.map(p => p.slice());
  const legs = LEG_NAMES.map((name, i) => {
    const L = sk.legs[name], [u, l, f] = L.joints, toe = L.toe.slice();
    return { name, i, fore: name[0] === 'F', left: name[1] === 'L', u, l, f, toe, a: len(sub(rest[l], rest[u])), b: len(sub(rest[f], rest[l])),
      foot: sub(rest[f], toe), bend: name[0] === 'F' ? -1 : 1,
      // the reach: how far the toe can be from the shoulder or hip joint before the drawn toe leaves its plant point (legIK:
      // the leg straight, the foot bone continuing most of the line); slide: the share of a foot's travel the joint goes with it
      reach: len(sub(rest[l], rest[u])) + len(sub(rest[f], rest[l])) + REACH_FOOT * len(sub(rest[f], toe)), slide: name[0] === 'F' ? 0.35 : 0.15,
      sy: rest[u][1] - toe[1], dz0: toe[2] - rest[u][2], dx0: toe[0] - rest[u][0] };   // foot: the rest vector from the toe up to the ankle; bend: the knee's side (the elbow back, the stifle forward)
  });
  // on the move a pair's feet work about one place along the body, the middle of the two rest places (a mesh drawn in a
  // walking pose has one foot ahead of the other at rest; standing keeps it)
  for (const p of [0, 2]) { const m = (legs[p].toe[2] + legs[p + 1].toe[2]) / 2; legs[p].pz = legs[p + 1].pz = m; }
  const h = sk.withers_m || rest[idx.Chest][1] * 1.2;
  // a lagomorph's ears and scut (rig_quadruped.py skeleton_lago): joints carried by the head and the hips, each turned by
  // its own rotation in the parent's frame (st.loc, from hopStep), so an ear can swivel about its own length
  const ears = sk.ears ? ['L', 'R'].map(e => ({ j: sk.ears[e].joint, tip: sk.ears[e].tip.slice(), sx: e === 'L' ? 1 : -1 })) : null;
  const scut = sk.scut ? { j: sk.scut.joint, tip: sk.scut.tip.slice() } : null;
  const attach = new Array(sk.joints.length).fill(null);
  if (ears) for (const E of ears) attach[E.j] = { parent: idx.Head };
  if (scut) attach[scut.j] = { parent: idx.Hips };
  return { n: sk.joints.length, names: sk.joints, idx, rest, legs, tip: sk.tail_tip.slice(), nose: sk.nose.slice(), posture: sk.posture || 'digitigrade', h,
    kind: sk.kind || 'quadruped', ears, scut, attach,
    belly: Math.min(rest[idx['LowerLeg.FL']][1], rest[idx['LowerLeg.HL']][1]),   // the belly line: the elbow and stifle pivots
    rFoot: legs.reduce((s, L) => s + Math.hypot(L.toe[0], L.toe[2]), 0) / 4 };   // a foot's lever round the body's centre
}
// The variation's numbers where a row carries no `vary` (a tile built before it; the body alone): the tree's Mammalia
// block, library/animals/locomotion.json, where each number's source is noted. A row's block wins key by key.
export const VARY = {
  stride_cv: [0.03, 0.02, 0.02], drift: [1, 1, 0.8, 0.6, 0.45, 0.35], phase_sd: 0.012, step_sd: 0.012, width_sd: [0.085, 0.04], stand_sd: 0.06,
  size_cv: 0.033, mass_cv: 0.05, tempo_cv: 0.035, asym: 0.008, walk_lag: [0.23, 0.27], pair_lag: [0.15, 0.1], shift: 0.6,
  lead: { right: 0.49, keep: 0.66, block: 16, turn_rad_s: 0.35, hold_strides: 8 }, slope: { hz: 0.3, max: 0.5 },
  soft: { nod: 0.015, head_hz: 0.9, head_z: 0.55, head_k: 0.6, tail_hz: 0.7, tail_z: 0.3, tail_k: 0.8, ear_k: 0.6 },
  square: { after_s: [0.5, 2.5], off: 0.2 }, limp: { stride: -0.02, duty: 0.004, nod: 0.08 }, foothold: { rough: 0.04, reach: 0.12 },
};
function varyOf(v) {
  const o = { ...VARY };
  if (v) for (const k in v) o[k] = v[k] && typeof v[k] === 'object' && !Array.isArray(v[k]) ? { ...VARY[k], ...v[k] } : v[k];
  o.w = driftWeights(o.drift);
  return o;
}
// The gait's numbers from a locomotion row (pipeline/locomotion.py), or from the body alone where a tile has none.
export function gaitParams(row, skel) {
  const h = row?.hip_m || skel.h, mass = row?.mass_kg || 90 * h * h * h;
  const vw = row?.walk_mps || Math.sqrt(0.5 * G * h), vt = row?.trot_mps || Math.sqrt(2.5 * G * h);
  const ft = row?.stride_hz || 4.19 * Math.pow(mass, -0.15), Lt = row?.stride_m || vt / ft;
  const gaits = row?.gaits || {};
  const T = row?.turn || {}, B = row?.bend || {};
  // the lagomorphs' gait set (the tree's Lagomorpha `hop`; hopStep): the shuffle below shuffle_froude of the hip height
  const hop = row?.hop || (skel.kind === 'lagomorph' ? { set: 'half-bound' } : null);
  return { h, vw, vt, ft, Lt, mass, vary: varyOf(row?.vary), ind: null, body: skel.nose[2] - skel.tip[2], track: Math.abs(skel.legs[0].toe[0] - skel.legs[1].toe[0]) || 0.1, pace: gaits.walk === 'amble', gallop: /rotary/.test(gaits.gallop || '') ? 'rotary' : 'transverse',
    hop, vS: hop ? Math.sqrt((hop.shuffle_froude ?? 1) * G * h) : 0, observe: hop?.observe || null, flexMax: hop?.flex_rad ?? 0.28,
    posture: row?.posture || skel.posture,
    turn: { on: T.on ?? 0.45, off: T.off ?? 0.2, hold: T.hold ?? 0.35, hz: T.hz || [0.7, 2.4] }, lead: B.lead ?? 0.12, leadMax: B.lead_max ?? 0.25 };
}
// cadence (Hz) and stride (m) at speed v: toward stride_hz at the trot-gallop change (f ~ v^0.45 below it, nearly flat
// above, where the stride stretches instead)
export function cadence(P, v) {
  const u = Math.max(v, 0.12 * P.vt) / P.vt;
  const f = u < 1 ? P.ft * Math.pow(u, 0.45) : P.ft * Math.min(1.25, 1 + 0.12 * (u - 1));
  return { f, L: Math.max(v, 0.12 * P.vt) / f };
}
// The individual: the species' numbers as this body has them. seed: the instance's (seedOf(id)); size: its drawn scale
// against the species' (0: drawn from the seed within size_cv); o.mass: its mass against its size's (a thin animal under
// 1; else drawn within mass_cv), o.limp: { leg (0..3: FL FR HL HR), k (0..1) }, o.k: a scale on the stride's variation
// (0: none, the bake's even cycle). A body of size s has a hip s times as high, so by dynamic similarity its Froude bands
// are sqrt(s) of the species' and its stride rate (Heglund & Taylor: mass^-0.15) follows its own mass: a fawn steps
// quicker for its size, with nothing set by age. The species' P is the prototype: what is not the individual's is read through.
export function individualParams(P, seed, size = 0, o = {}) {
  const V = P.vary, z = k => clamp(gauss(seed, 0x51, k), -2.5, 2.5);
  const sz = size > 0 ? size : 1 + V.size_cv * z(1), km = o.mass > 0 ? o.mass : Math.max(0.6, 1 + V.mass_cv * z(2));
  const Q = Object.create(P), rs = Math.sqrt(sz);
  Q.h = P.h * sz; Q.vw = P.vw * rs; Q.vt = P.vt * rs; Q.vS = P.vS * rs; Q.mass = P.mass * sz * sz * sz * km;
  Q.ft = P.ft * Math.pow(sz * sz * sz * km, -0.15) * (1 + V.tempo_cv * z(4)); Q.Lt = Q.vt / Q.ft;   // (its own tempo: some bodies take quicker, shorter strides at a speed)
  const aF = V.asym * z(5), aH = V.asym * z(6);
  Q.ind = { seed: seed >>> 0, size: sz, mass: km, k: o.k ?? 1, far: (Q.ft / P.ft) * Math.pow(P.vt / Q.vt, 0.45),   // far: its cadence at a speed against the species' (the baked cycles' rate)
    lead: h32(seed, 0x51, 3) < V.lead.right ? 1 : -1,
    asym: [aF, -aF, aH, -aH], limp: o.limp && o.limp.k > 0 ? o.limp : null };
  return Q;
}
// the stride clock's rate (strides a second) for a body with no engine state (the far tier, the host's stream): the cadence
// with the drift at its clock, as gaitStep has it on flat ground
export function strideRate(P, sc, v, gait = v > P.vt ? 2 : v > P.vw ? 1 : 0) {
  v = Math.abs(v || 0); if (v <= 0.05) return 0;
  const I = P.ind, V = P.vary, c = P.hop ? hopCadence(P, v, v > P.vS ? 1 : 0) : cadence(P, v);
  return c.f * (I && I.k ? 1 + I.k * V.stride_cv[P.hop ? (v > P.vS ? 2 : 0) : gait] * drift(I.seed, 0, sc, V.w) : 1) * (I && I.limp ? 1 - V.limp.stride * I.limp.k : 1);
}
// A mirror's stride clock now: the host's at the newest sample (s1; under 1: none) carried to this moment of the run
// toward that sample (mt of mdur seconds: the run reaches the sample at its end, and goes on past it) at the clock's rate.
export function mirrorClock(s1, mt, mdur, rate) { return s1 >= 1 ? normSc(s1 + rate * ((mt || 0) - (mdur || 0))) : 0; }
export const wrapSc = e => e - SC_WRAP * Math.round(e / SC_WRAP);          // the shorter way between two stride clocks
export const normSc = sc => 1 + ((sc - 1) % SC_WRAP + SC_WRAP) % SC_WRAP;  // into [1, 1 + SC_WRAP)
// the lagomorphs' cadence (hopStep): the shuffle's stride kept within the body's length (quicker short hops, the feet under it)
function hopCadence(P, v, gk) { const c0 = cadence(P, Math.max(v, 0.05)), L = c0.L + (Math.min(c0.L, 0.8 * P.body) - c0.L) * (1 - gk); return { f: Math.max(v, 0.05) / L, L }; }
// the lead an individual takes on the straight: its own for most blocks of strides, the other for the rest
const leadOf = (I, V, sc) => h32(I.seed, 0x5e, Math.floor(sc / V.lead.block)) < V.lead.keep ? I.lead : -I.lead;
export function makeGait() {
  return { sc: 0, lag: null, lagT: [0, 0, 0, 0], leadNow: 0, leadHold: 0, stillT: 0, hd: spring(), ty: spring(), tp: spring(), tp2: spring(), nod: 0,
    phase: 0, gait: 0, tk: 0, gk: 0, v: 0, tq: 0, rate: 0, duty: 0.7, L: 0.5, moving: false, lastX: NaN, lastZ: NaN,
    feet: LEG_NAMES.map(() => ({ x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, stance: true, s: 1, has: false, gy: 0, l: [0, 0, 0], dp: 0, nz: 0, nx: 0, fz: 0, look: false, over: false, pl: 0, tl: null })),
    gF: 0, gH: 0, gL: 0, gR: 0, bob: 0, crouch: 0, bed: 0, pitch: 0, roll: 0, flex: 0, headP: 0, lead: 0, tailYaw: 0, air: 0,
    P: null, E: null };
}

// A foot has landed: it draws its next stride's own numbers from the drift at its stride's index (the same on a host and
// a mirror, whose clocks agree to well within half a stride): dp, how late it lands against the diagram (with the
// individual's own left-right asymmetry); nz and nx, how far along and across from its usual place.
function landed(I, V, st, F, i) {
  const k = ((Math.round(st.sc - st.lag[i]) % SC_WRAP) + SC_WRAP) % SC_WRAP;
  F.dp = I.asym[i] + (i === 2 ? 0 : I.k * V.phase_sd * drift(I.seed, 1 + i, k, V.w));   // (the left hind is the clock's own foot: its stride's spread is the tempo's)
  F.nz = drift(I.seed, 5 + i, k, V.w); F.nx = drift(I.seed, 9 + i, k, V.w);
}
// The foothold (once a swing, past its middle): how broken the ground is where the foot will land (the height at the
// point against the line between the ground half a foot ahead of it and behind); past `rough` of the hip height the foot
// reaches `reach` of the stride further or shorter if that ground is flatter. Returns the shift along the body, local.
function foothold(V, L, h, s, cy, sy, terrain, at, pz0) {
  const e = 0.08 * h * s, ex = sy * e, ez = cy * e;
  const rough = pz => { const w = at(pz); return Math.abs(terrain(w[0] + ex, w[2] + ez) + terrain(w[0] - ex, w[2] - ez) - 2 * w[1]) / s; };
  const r0 = rough(pz0); if (r0 <= V.foothold.rough * h) return 0;
  const d = V.foothold.reach * L, ra = rough(pz0 - d), rb = rough(pz0 + d);
  return ra < 0.6 * r0 && ra <= rb ? -d : rb < 0.6 * r0 ? d : 0;
}

// ---- one frame -------------------------------------------------------------------------------------------------------
// inp: { x, y, z (the body's origin: on the ground between the feet, world), yaw (the drawn yaw), size, v (m/s, negative
// backing), wr (rad/s), pose (0..1: crouch to half, bedded at 1), flick (the head dip: 1 to the ground, negative alert),
// bend (rad: the spine's yaw bend toward the control yaw), twitch (the tail tip, -1..1), terrain(xw, zw) -> yw, air (true
// in a jump or a fall: the legs tuck) }
export function gaitStep(skel, P, st, inp, dt) {
  if (P.hop) return hopStep(skel, P, st, inp, dt);
  dt = Math.min(Math.max(dt, 0), 0.1);
  const I = P.ind, V = P.vary, vk = I ? I.k : 0;   // the individual (null: the species' even stride, the bake's)
  const s = inp.size || 1, cy = Math.cos(inp.yaw), sy = Math.sin(inp.yaw), O = [inp.x, inp.y, inp.z];
  const toLocal = w => { const dx = w[0] - O[0], dz = w[2] - O[2]; return [(cy * dx - sy * dz) / s, (w[1] - O[1]) / s, (sy * dx + cy * dz) / s]; };
  const toWorld = l => [O[0] + s * (l[0] * cy + l[2] * sy), O[1] + s * l[1], O[2] + s * (-l[0] * sy + l[2] * cy)];
  const terrain = inp.terrain || (() => O[1]);
  const groundL = l => { const w = toWorld(l); return (terrain(w[0], w[2]) - O[1]) / s; };   // the ground's height under a local point, local
  const R = skel.rest, J = skel.idx;
  // a placement (a long jump of the origin): every foot is replanted at rest
  const jumped = st.lastX === st.lastX && Math.hypot(inp.x - st.lastX, inp.z - st.lastZ) > 3 * s;
  st.lastX = inp.x; st.lastZ = inp.z;
  // speed, gait by the Froude bands (hysteresis), the blends into the trot and the gallop
  const v = Math.abs(inp.v || 0), fwd = (inp.v || 0) < 0 ? -1 : 1;
  st.v = damp(st.v, v, 12, dt);
  const g0 = st.gait;
  if (g0 === 0 && v > P.vw * 1.05) st.gait = 1; else if (g0 === 1 && v < P.vw * 0.92) st.gait = 0;
  if (st.gait === 1 && v > P.vt * 1.05) st.gait = 2; else if (st.gait === 2 && v < P.vt * 0.9) st.gait = 1;
  st.tk = damp(st.tk, st.gait >= 1 ? 1 : 0, 6, dt); st.gk = damp(st.gk, st.gait === 2 ? 1 : 0, 6, dt);
  // the standing turn's hysteresis (as the deer's drive): over `on` rad/s it steps, until under `off` for `hold` s
  const aw = Math.abs(inp.wr || 0), still = v < 0.05 && !inp.air && (inp.pose || 0) < 0.5;
  if (still && aw > (st.tq > 0 ? P.turn.off : P.turn.on)) st.tq = P.turn.hold; else st.tq = still ? st.tq - dt : 0;
  const turning = st.tq > 0;
  // cadence and stride: the body's cadence at this speed, times the stride's own tempo (the drift at the stride clock, as
  // wide as the gait's spread of stride intervals) and the slope's (the ground under the fore feet against the hind:
  // shorter, quicker steps on a climb); the duty factor by the gait
  if (!(st.sc >= 1)) st.sc = inp.sc >= 1 ? inp.sc : 1 + (I ? h32(I.seed, 0x5c, 0) * SC_WRAP : 0);
  const cv = (V.stride_cv[0] * (1 - st.tk) + V.stride_cv[1] * st.tk) * (1 - st.gk) + V.stride_cv[2] * st.gk;
  const slope = clamp((st.gF - st.gH) / (R[J.Chest][2] - R[J.Hips][2]), -V.slope.max, V.slope.max) * fwd;
  const kf = (vk ? 1 + vk * cv * drift(I.seed, 0, st.sc, V.w) : 1) * (1 + V.slope.hz * slope) * (I && I.limp ? 1 - V.limp.stride * I.limp.k : 1);
  const c0 = cadence(P, Math.max(v, 0.05)), f = c0.f * kf, L = c0.L / kf;
  const fTurn = turning ? clamp(aw * skel.rFoot / (0.3 * P.Lt), P.turn.hz[0], P.turn.hz[1]) : 0;
  const moving = v > 0.05 || turning;
  const rate = v > 0.05 ? Math.max(f, fTurn) : fTurn;
  const duty = st.gait === 2 ? 0.42 - 0.07 * clamp((v - P.vt) / P.vt, 0, 1) : st.gait === 1 ? 0.5 : 0.72 - 0.17 * clamp(v / P.vw, 0, 1);
  st.duty = damp(st.duty, duty, 8, dt); st.L = (v > 0.05 ? L : 0.3 * P.Lt) / s;   // the stride in the body's own units (the feet's are)
  st.moving = moving; st.rate = rate;
  // the stride clock: its whole part counts strides, its fraction is the phase. A mirror's is locked to the host's
  // (inp.sc: the host's clock as of now): softly on the move, at once when standing, far off or newly placed
  if (inp.sc >= 1) {
    const e = wrapSc(inp.sc - st.sc);
    if (!moving || Math.abs(e) > 0.5 || !st.feet[0].has) st.sc = inp.sc; else st.sc += rate * dt * clamp(3 * e, -0.3, 0.3);
  }
  if (moving) st.sc += rate * dt;
  if (st.sc >= 1 + SC_WRAP) st.sc -= SC_WRAP;
  st.phase = frac(st.sc);
  const swingT = rate > 0.1 ? (1 - st.duty) / rate : 0.25;
  // the gallop's lead (1: the right fore lands last and reaches furthest): the individual's own; through a turn the
  // inside fore (a left turn is wr above 0), kept for some strides after it
  if (I) {
    const wr = inp.wr || 0;
    if (Math.abs(wr) > V.lead.turn_rad_s && v > 0.05) { st.leadNow = wr > 0 ? -1 : 1; st.leadHold = V.lead.hold_strides; }
    else if (st.leadHold > 0) st.leadHold -= rate * dt; else st.leadNow = leadOf(I, V, st.sc);
  } else st.leadNow = 1;
  // the feet's lags behind the left hind foot (the clock's reference: it lands at phase 0): the gait's diagram, the walk's
  // fore lag sliding with speed, the gallop's pair lag closing with speed and mirrored by the lead. Each foot's own lag
  // chases its diagram the short way round at a bounded rate, so a gait or a lead changes over about a stride.
  const LT = st.lagT;
  if (st.gait === 2) {
    const d = V.pair_lag[0] + (V.pair_lag[1] - V.pair_lag[0]) * clamp((v - P.vt) / P.vt, 0, 1), rot = P.gallop === 'rotary';
    const fa = rot ? 0.5 + d : 0.5, fb = rot ? 0.5 : 0.5 + d;   // the fore pair's lags on the right lead
    if (st.leadNow < 0) { LT[0] = fb - d; LT[1] = fa - d; LT[2] = 0; LT[3] = 1 - d; } else { LT[0] = fa; LT[1] = fb; LT[2] = 0; LT[3] = d; }
  } else if (st.gait === 1) { const T = FOOTFALL[P.pace ? 'pace' : 'trot']; LT[0] = T[0]; LT[1] = T[1]; LT[2] = T[2]; LT[3] = T[3]; }
  else { const D = V.walk_lag[0] + (V.walk_lag[1] - V.walk_lag[0]) * clamp(v / P.vw, 0, 1); LT[0] = D; LT[1] = D + 0.5; LT[2] = 0; LT[3] = 0.5; }
  if (!st.lag) st.lag = LT.slice();
  const dl = moving ? V.shift * rate * dt : 1;   // (only a foot in the air shifts: a planted foot keeps its time to lift, so no stance is stretched by a change)
  for (let i = 0; i < 4; i++) if (!moving || !st.feet[i].stance) st.lag[i] = frac(st.lag[i] + clamp(wrap1(LT[i] - st.lag[i]), -dl, dl));
  // the airborne body (a jump, a pounce): the feet tuck and are replanted on landing
  st.air = damp(st.air, inp.air ? 1 : 0, 10, dt);
  // ---- the feet ----
  const feet = st.feet, lf = new Array(4);
  const shoulderY = [R[J['UpperLeg.FL']][1], R[J['UpperLeg.FR']][1], R[J['UpperLeg.HL']][1], R[J['UpperLeg.HR']][1]];
  // standing: after a while a foot left far from under its shoulder steps in, the worst first and one at a time
  let sq = -1;
  if (moving || inp.air || st.bed > 0.02 || (inp.pose || 0) > 0.25) st.stillT = 0; else st.stillT += dt;
  const settle = V.square.after_s[0] + (V.square.after_s[1] - V.square.after_s[0]) * (I ? h32(I.seed, 0x5d, Math.floor(st.sc)) : 0);
  if (st.stillT > settle && feet[0].has && feet.every(F => F.stance)) {
    let worst = V.square.off * skel.h;
    for (let i = 0; i < 4; i++) {
      const F = feet[i], toe = skel.legs[i].toe, here = toLocal([F.x, F.y, F.z]);
      const d = Math.hypot(here[0] - toe[0] - vk * F.nx * V.width_sd[i >> 1] * P.track, here[2] - toe[2] - vk * F.nz * V.stand_sd * skel.h);
      if (d > worst) { worst = d; sq = i; }
    }
    if (sq >= 0) st.stillT = settle - 0.4;
  }
  const dropMax = REACH_DROP + REACH_RUN * st.gk;   // how far the body may come down for its legs' reach, of the leg
  const goes = v > 0.05;
  for (let i = 0; i < 4; i++) {
    const F = feet[i], Lg = skel.legs[i], toe = goes ? [Lg.toe[0], Lg.toe[1], Lg.pz] : Lg.toe, off = toe[2] - Lg.toe[2];   // (the pair's middle on the move)
    if (!F.has || jumped) {   // place at rest
      const w = toWorld(toe); F.x = w[0]; F.z = w[2]; F.y = terrain(w[0], w[2]); F.stance = true; F.s = 1; F.has = true; F.fz = 0;
    }
    if (inp.air) { F.stance = false; F.s = 0; F.has = false; const l = lerp3(toe, [toe[0], 0.3 * shoulderY[i], toe[2] - 0.15 * Lg.a * fwd], st.air); lf[i] = l; F.l = l; continue; }
    const dI = I && I.limp && I.limp.leg === i ? st.duty * (1 + V.limp.duty * I.limp.k) : st.duty;   // a lame leg's duty hardly changes (measured: under a hundredth)
    const pf = frac(st.phase - st.lag[i] - F.dp);
    const here = toLocal([F.x, F.y, F.z]);
    if (F.stance) {
      // dragged well behind its rest, or past where its leg reaches (the joint at its lowest): lift whatever the phase says
      const back = (toe[2] - here[2]) * fwd;   // how far behind its rest place the foot stands
      const late = back > 0.75 * st.L || (back > 0 && (F.over || back > 0.97 * reachOf(Lg, -fwd, dropMax * Lg.reach) + fwd * off));
      if ((moving && pf >= dI && pf < dI + (1 - dI) * 0.6) || late || i === sq) { F.stance = false; F.s = 0; F.lx = F.x; F.ly = F.y; F.lz = F.z; F.look = true; F.fz = 0; F.over = false; F.pl = pf; }
    }
    if (!F.stance) {
      // the swing ends at the foot's landing phase: it goes evenly over the time left to it, from wherever it lifted (on
      // time, early by its reach) and whatever its lag has become; past the landing phase it lands now
      if (moving) { const left = pf < F.pl - 0.5 ? 0 : 1 - pf; F.pl = pf; F.s = left > rate * dt ? F.s + (1 - F.s) * rate * dt / left : 1; }   // (pf fell back to 0: the landing phase has come)
      else F.s = Math.min(1, F.s + dt / Math.max(swingT, 0.12));
      // the plant point: the rest offset, half a stance ahead, in the body frame at touchdown (turned and moved on), with
      // this stride's own reach and width (drawn at the foot's last touchdown) and the foothold's shift
      const going = v > 0.05 ? 1 : 0, rem = (1 - F.s) * swingT, rot = (inp.wr || 0) * rem, dz = fwd * v * rem / s;
      const far = Math.max(0, 0.93 * reachOf(Lg, fwd, 0.85 * dropMax * Lg.reach) - fwd * off);   // no further ahead than the leg reaches
      const ahead = fwd * Math.min(dI * st.L * 0.5 + (going ? vk * fwd * F.nz * V.step_sd * st.L : 0), far) * going;
      const px = toe[0] + vk * F.nx * V.width_sd[i >> 1] * P.track, pz0 = toe[2] + ahead + (going ? 0 : vk * F.nz * V.stand_sd * skel.h);
      const c = Math.cos(rot), sn = Math.sin(rot);
      const at = pz => { const w = toWorld([c * px + sn * pz, 0, -sn * px + c * pz + dz]); w[1] = terrain(w[0], w[2]); return w; };
      if (F.look && F.s > 0.5) { F.look = false; F.fz = going ? foothold(V, st.L, skel.h, s, cy, sy, terrain, at, pz0) : 0; if (F.fz * fwd > 0 && Math.abs(ahead) + Math.abs(F.fz) > far) F.fz = 0; }
      let tw = at(pz0 + F.fz); F.tl = toLocal(tw);
      if (F.s > 0.5 && st.P) {   // near its landing: no further than the leg, as the body is posed, will reach
        const z1 = reachClamp(Lg, st.P[Lg.u], here, F.tl, dz, Math.max(0, 0.85 * dropMax * Lg.reach - ((Lg.fore ? st.dC : st.dH) || 0)));
        if (z1 !== F.tl[2]) { F.tl[2] = z1; tw = toWorld(F.tl); tw[1] = terrain(tw[0], tw[2]); F.tl[1] = (tw[1] - O[1]) / s; }
      }
      // the swing: off the ground and forward at once (a foot that dwelt behind after lifting trailed the body like a dragged
      // leg), fastest a third of the way, settling onto its point; the clearance a third of the ankle's height and a little of the stride
      const q = 1 - F.s, e = 1 - q * q * q * (1 + 3 * F.s), lift = (0.35 * R[Lg.f][1] + 0.03 * st.L * (1 + 0.5 * st.gk)) * s * Math.sin(Math.PI * F.s);
      F.x = F.lx + (tw[0] - F.lx) * e; F.z = F.lz + (tw[2] - F.lz) * e;
      F.y = Math.max(F.ly + (tw[1] - F.ly) * e, terrain(F.x, F.z)) + lift;
      if (F.s >= 1) { F.stance = true; F.x = tw[0]; F.y = tw[1]; F.z = tw[2]; if (vk) landed(I, V, st, F, i); }
    }
    lf[i] = toLocal([F.x, F.y, F.z]); F.l = lf[i];
    F.gy = groundL([lf[i][0], 0, lf[i][2]]);
  }
  // ---- the body ----
  // the ground under the fore and hind feet, and under the left and right: the back follows most of a slope, the legs the rest
  const gF = (feet[0].gy + feet[1].gy) / 2, gH = (feet[2].gy + feet[3].gy) / 2, gL = (feet[0].gy + feet[2].gy) / 2, gR = (feet[1].gy + feet[3].gy) / 2;
  const k = inp.air ? 2 : 8;
  st.gF = damp(st.gF, inp.air ? 0 : gF, k, dt); st.gH = damp(st.gH, inp.air ? 0 : gH, k, dt);
  st.gL = damp(st.gL, gL, k, dt); st.gR = damp(st.gR, gR, k, dt);
  const share = 0.8, ph = st.phase * TAU, phG = ph - TAU * (wrap1(st.lag[3]) / 2 - 0.075);   // phG: the gallop's phase from the middle of the hind pair's landings (either lead)
  // the bob: a walk vaults (highest mid-stance), a trot springs (lowest mid-stance), a gallop rises once a cycle
  const bobW = 0.02 * skel.h * Math.sin(2 * ph), bobT = -0.025 * skel.h * Math.cos(2 * ph), bobG = 0.05 * skel.h * Math.sin(phG + 0.6);
  st.bob = moving && !inp.air ? (bobW * (1 - st.tk) + bobT * st.tk) * (1 - st.gk) + bobG * st.gk : damp(st.bob, 0, 6, dt);
  // the crouch (pose to a half) and the bed (pose past it)
  const pose = clamp(inp.pose || 0, 0, 1);
  st.crouch = damp(st.crouch, clamp(pose * 2, 0, 1) * 0.3, 4, dt); st.bed = damp(st.bed, clamp((pose - 0.5) * 2, 0, 1), 3, dt);
  const legLen = R[J['UpperLeg.FL']][1], drop = st.crouch * legLen;
  const hipsRest = R[J.Hips], chestRest = R[J.Chest], spineRest = R[J.Spine];
  st.eatDrop = damp(st.eatDrop || 0, st.eatWant || 0, 3, dt);   // the eat's reach: the forequarters lowered (reachDip)
  // the hips and the chest as low as their planted legs need to reach their feet (the vault), quickly down and slowly up
  const yH0 = hipsRest[1] + st.gH * share - drop + st.bob, yC0 = chestRest[1] + st.gF * share - drop + st.bob - st.eatDrop;
  let nH = 0, nC = 0;
  if (!inp.air) for (let i = 0; i < 4; i++) {   // (a foot about to land counts in, more as it nears the ground, so the body is already down for it)
    const Lg = skel.legs[i], F = feet[i], w = F.stance ? 1 : ease(clamp((F.s - 0.5) / 0.5, 0, 1)); if (!w) continue;
    const n = w * Math.min(dropMax * Lg.reach, reachDrop(Lg, F.stance ? lf[i] : F.tl || lf[i], R[Lg.u][1] + (Lg.fore ? yC0 - chestRest[1] : yH0 - hipsRest[1])));
    if (Lg.fore) nC = Math.max(nC, n); else nH = Math.max(nH, n);
  }
  st.dH = nH > (st.dH || 0) ? nH : damp(st.dH || 0, nH, 10, dt); st.dC = nC > (st.dC || 0) ? nC : damp(st.dC || 0, nC, 10, dt);
  const yH = yH0 - st.dH, yC = yC0 - st.dC;
  const pitch = Math.asin(clamp((yC - yH - (chestRest[1] - hipsRest[1])) / (chestRest[2] - hipsRest[2]), -0.9, 0.9));   // nose-up positive
  st.pitch = damp(st.pitch, pitch, 10, dt);
  const track = Math.abs(skel.legs[0].toe[0] - skel.legs[1].toe[0]) || 0.1;
  const supportL = (feet[0].stance ? 1 : 0) + (feet[2].stance ? 1 : 0), supportR = (feet[1].stance ? 1 : 0) + (feet[3].stance ? 1 : 0);
  const roll = Math.atan((st.gL - st.gR) / track) * 0.5 + (moving ? 0.03 * (supportL - supportR) * (1 - st.gk) : 0);   // onto the supporting side
  st.roll = damp(st.roll, roll, 6, dt);
  // the gallop's flexion: the back arched as the hind feet come under (gathered), extended as the fore feet reach
  st.flex = 0.14 * st.gk * Math.cos(phG) * (moving ? 1 : 0);
  // the spine in two segments joined at the Spine joint: the hind segment with the hips, the fore segment bent toward the
  // control yaw (the deer's bendOf) and arched by the flex
  const bend = clamp(inp.bend || 0, -0.5, 0.5);
  const RA = mul3(rotZ(st.roll), rotX(-(st.pitch - st.flex)));
  const RB = mul3(rotY(bend), mul3(rotZ(st.roll), rotX(-(st.pitch + st.flex))));
  const Ph = [0, yH, hipsRest[2]];
  const Psp = add(Ph, apply3(RA, sub(spineRest, hipsRest)));
  const at = (rest, Rm, base, baseRest) => add(base, apply3(Rm, sub(rest, baseRest)));
  const Pc = at(chestRest, RB, Psp, spineRest);
  const Pn0 = at(R[J.Neck], RB, Psp, spineRest);
  // the shoulders and hips; the shoulder slides fore and aft with its foot (the scapula's swing, which gives a real leg
  // its reach), the hip a little (the pelvis rocks)
  const S = skel.legs.map((Lg, i) => {
    const p = Lg.fore ? at(R[Lg.u], RB, Psp, spineRest) : at(R[Lg.u], RA, Ph, hipsRest);
    const slide = (lf[i][2] - Lg.toe[2]) * (Lg.fore ? 0.35 : 0.15);
    return [p[0], p[1] - 0.12 * Math.abs(slide), p[2] + slide];
  });
  // ---- the legs: two-bone IK from the shoulder or hip to the ankle, the foot bone from the ankle to the toe ----
  const Pj = st.P || (st.P = new Array(skel.n)), E = st.E || (st.E = {});
  Pj[J.Hips] = Ph; Pj[J.Spine] = Psp; Pj[J.Chest] = Pc;
  for (let i = 0; i < 4; i++) {
    const Lg = skel.legs[i], F = feet[i];
    // the foot bone: on its toe (digitigrade) or flat (plantigrade), flexed up in the swing
    let fv = Lg.foot;
    const swing = F.stance ? 0 : Math.sin(Math.PI * F.s);
    if (swing > 0) fv = apply3(rotX(-(P.posture === 'plantigrade' ? 0.6 : 0.35) * swing * (Lg.fore ? 1 : 0.6)), fv);
    legIK(Lg, F.stance ? give(Lg, S[i], lf[i], F) : S[i], lf[i], fv, Pj, E);
  }
  // ---- the head: level over the stride, dipped by the flick (1: the nose at the ground, reachDip), leading a turn ----
  const lead = clamp((inp.wr || 0) * P.lead, -P.leadMax, P.leadMax);
  st.lead = damp(st.lead, lead, 8, dt);
  // the walk's nod: the nose's range a share of the hip height (the tree's soft.nod), the neck and the head together
  const headBob = moving ? V.soft.nod * skel.h / len(sub(skel.nose, R[J.Neck])) * Math.sin(2 * ph) * (1 - st.gk) : 0;
  // the head follows the chest late and overshoots (a spring toward the chest's height): left low as the chest rises
  // and carried on as it stops; a fore limb's limp nods it down onto the sound foot
  const SF = V.soft, lagH = yC - follow(st.hd, yC, TAU * P.ft * SF.head_hz, SF.head_z, dt);
  const soft = clamp(SF.head_k * lagH / len(sub(skel.nose, R[J.Neck])), -0.25, 0.25);
  const lame = I && I.limp && I.limp.leg < 2 ? I.limp : null;
  st.nod = damp(st.nod, lame && moving ? V.limp.nod * lame.k * ((feet[lame.leg].stance ? -1 : 0) + (feet[lame.leg ^ 1].stance ? 1 : 0)) : 0, 10, dt);
  const fl = inp.flick || 0, cN = 0.4 * (st.pitch + st.flex) + 0.5 * (soft + st.nod + headBob), cH = 0.5 * (st.pitch + st.flex) + 0.5 * (soft + st.nod + headBob);
  let dip = fl * 0.9;   // to a half (a stalk's low head, a sniff on the move) the old dip; past it toward the ground
  if (fl > 0.5 && !inp.air && st.bed < 0.5) {
    const r = reachDip(skel, RB, Pn0, 0.6, cN, 0.5, cH, st.lead, groundL), u = Math.min(1, (fl - 0.5) * 2);
    dip = 0.45 + (r.q - 0.45) * u;
    st.eatWant = clamp(st.eatDrop + r.short, 0, EAT_DROP * legLen) * u;
  } else st.eatWant = 0;
  const Rn = mul3(RB, rotX(dip * 0.6 + cN));                       // the neck: down with the dip, countering the chest
  const Rh = mul3(mul3(RB, rotY(st.lead)), rotX(dip * 0.5 + cH));
  const Phd = add(Pn0, apply3(Rn, sub(R[J.Head], R[J.Neck])));
  const nose = add(Phd, apply3(Rh, sub(skel.nose, R[J.Head])));
  Pj[J.Neck] = Pn0; Pj[J.Head] = Phd; E[J.Head] = nose;
  // ---- the tail: lags the turn, swings with the gallop, lifted by the flick, the tip twitched ----
  // (a spring behind the turn and behind the hips' height: it swings past the line as a turn ends and whips a little
  // with each rise of the hips, the far half later than the near)
  const wT = TAU * P.ft * SF.tail_hz, tailL = len(sub(skel.tip, R[J.Tail1])) || 1;
  st.tailYaw = follow(st.ty, -(inp.wr || 0) * 0.25, wT, SF.tail_z, dt);
  const sag1 = clamp(SF.tail_k * (yH - follow(st.tp, yH, wT, SF.tail_z, dt)) / tailL, -0.4, 0.4), sag2 = clamp(SF.tail_k * (st.tp.y - follow(st.tp2, st.tp.y, wT, SF.tail_z, dt)) / tailL, -0.4, 0.4);
  const swingT_ = 0.25 * st.gk * Math.sin(phG + 1.0), liftT = Math.max(0, inp.flick || 0) * 0.35;
  const Pt1 = at(R[J.Tail1], RA, Ph, hipsRest);
  let Rt = mul3(RA, mul3(rotY(st.tailYaw), rotX(-(liftT + swingT_ - sag1))));
  const Pt2 = add(Pt1, apply3(Rt, sub(R[J.Tail2], R[J.Tail1])));
  Rt = mul3(Rt, mul3(rotY(st.tailYaw), rotX(-(swingT_ * 0.6 - sag2))));
  const Pt3 = add(Pt2, apply3(Rt, sub(R[J.Tail3], R[J.Tail2])));
  Rt = mul3(Rt, rotY(st.tailYaw + (inp.twitch || 0) * 0.5));
  const tip = add(Pt3, apply3(Rt, sub(skel.tip, R[J.Tail3])));
  Pj[J.Tail1] = Pt1; Pj[J.Tail2] = Pt2; Pj[J.Tail3] = Pt3; E[J.Tail3] = tip;
  // ---- the bed: the body on the ground, the legs folded (blended by position) ----
  if (st.bed > 0.001) {
    const B = bedPose(skel), u = ease(st.bed);
    for (let j = 0; j < skel.n; j++) Pj[j] = lerp3(Pj[j], B.P[j], u);
    for (const k in B.E) E[k] = lerp3(E[k], B.E[k], u);
  }
  st.roll3 = st.roll; st.bendYaw = bend;
  return st;
}

// ---- the eat's reach (Aaron, 2026-11-03: "a more dramatic eating/gathering animation") ----------------------------------
// A flick of 1 is the mouth at the food on the ground (from a half up; below it the old dip, flick x 0.9). The head and neck are posed by one dip q (the neck turned down by
// kN q on top of cN, the head by kH q on top of cH, as the frame poses them); reachDip finds the least q that takes the
// nose to EAT_CLEAR of the hip height above the ground under it, scanning to REACH_MAX, and how far short it stays when
// the neck is too short for the legs (a fox, a bear): the frame then lowers the forequarters by that much (st.eatDrop,
// the fore legs bending under the planted feet, at most EAT_DROP of the leg's length), so the next frame reaches.
const EAT_CLEAR = 0.025, REACH_MAX = 2.4, EAT_DROP = 0.6;
function reachDip(skel, RB, Pn0, kN, cN, kH, cH, lead, groundL) {
  const R = skel.rest, J = skel.idx, n0 = sub(R[J.Head], R[J.Neck]), h0 = sub(skel.nose, R[J.Head]), Rl = mul3(RB, rotY(lead));
  let best = 0, gap0 = Infinity;
  for (let q = 0; q <= REACH_MAX; q += 0.05) {
    const p = add(add(Pn0, apply3(mul3(RB, rotX(q * kN + cN)), n0)), apply3(mul3(Rl, rotX(q * kH + cH)), h0));
    const gap = p[1] - groundL([p[0], 0, p[2]]) - EAT_CLEAR * skel.h;
    if (gap <= 0) return { q: Math.max(0, q - 0.05 * Math.min(1, -gap / Math.max(1e-6, gap0 - gap))), short: 0 };   // between this step and the last
    if (gap < gap0) { gap0 = gap; best = q; } else break;   // past the lowest: the nose comes back up
  }
  return { q: best, short: gap0 };
}

// ---- the lagomorphs: the shuffle and the half-bound (the tree's Lagomorpha `hop`; docs/movement.md "The rabbits") -----
// A rabbit's skeleton is drawn in its crouch (rig_quadruped.py skeleton_lago): the long hind feet flat on the ground, the
// fore legs short. Footfalls [FL, FR, HL, HR] (the phase each foot lands), the hind pair landing at HIND in both gaits so a
// change between them is a blend of the tables: the shuffle (the fore feet step one after the other, the hind pair hop up
// behind them; the body hardly leaves the ground) and the half-bound (the fore feet land one after the other, then the hind
// pair together, ahead of where the fore feet landed; the hind feet push off into a flight with the body extended, the
// fore feet catch it, and the back arches as the hind feet swing up under the chest). The standing turn pivots on the hind
// feet while the fore pair hop round. Every few bounds of a hare's lope (P.observe) one bound is longer and higher: the
// observation hop. Pose: above 0 the sit-up (the trunk raised on the hind feet, the fore paws off the ground, the ears
// up), below it the crouch (the freeze: flat, the ears laid back), at -1 the form (crouched in a shallow scrape). The ears
// (inp.ears, -1 laid back .. 1 up and alert; NaN: from the pose and the speed) swivel each on its own when up; the scut
// (inp.twitch above 0) is cocked up over the rump, the white flash of a bolting brush rabbit. The dig (inp.dig 0..1, the
// Dig game: dig.js): standing, the chest low and the head down, the fore feet in turn reach forward to the ground and rake
// back under the chest at DIG_HZ, lifted and curled on the way forward; the hind feet stay planted. The crawl (inp.crawl
// 0..1, in a tunnel: dig.js; Aaron, 2026-11-04: "the animal's rigging should be a crawling type so that the body never
// escapes the tunnel walls"): the shuffle only, no sit-up, the crouch's chest on the belly with the ears laid back, no
// bob, lean or arch, and the feet swung low.
const HIND = 0.55, DIG_HZ = 4.5;
const HOP_TD = { shuffle: [0.0, 0.18, 0.55, 0.57], bound: [0.0, 0.11, 0.55, 0.58], turn: [0.0, 0.04, 0.5, 0.5] };
const rnd = st => (st.seed = (Math.imul(st.seed || 0x9e3779b9, 1664525) + 1013904223) >>> 0) / 4294967296;
const crossed = (a, b, x) => a <= b ? a < x && b >= x : a < x || b >= x;   // the phase passed x going from a to b (wrapping)
export function hopStep(skel, P, st, inp, dt) {
  dt = Math.min(Math.max(dt, 0), 0.1);
  const I = P.ind, V = P.vary, vk = I ? I.k : 0;   // the individual (gaitStep's)
  if (I && !st.seed) st.seed = I.seed || 1;        // the ears' own clock starts from the individual
  const s = inp.size || 1, cy = Math.cos(inp.yaw), sy = Math.sin(inp.yaw), O = [inp.x, inp.y, inp.z];
  const toLocal = w => { const dx = w[0] - O[0], dz = w[2] - O[2]; return [(cy * dx - sy * dz) / s, (w[1] - O[1]) / s, (sy * dx + cy * dz) / s]; };
  const toWorld = l => [O[0] + s * (l[0] * cy + l[2] * sy), O[1] + s * l[1], O[2] + s * (-l[0] * sy + l[2] * cy)];
  const terrain = inp.terrain || (() => O[1]);
  const groundL = l => { const w = toWorld(l); return (terrain(w[0], w[2]) - O[1]) / s; };
  const R = skel.rest, J = skel.idx, h = skel.h;
  const jumped = st.lastX === st.lastX && Math.hypot(inp.x - st.lastX, inp.z - st.lastZ) > 3 * s;
  st.lastX = inp.x; st.lastZ = inp.z;
  const v = Math.abs(inp.v || 0), fwd = (inp.v || 0) < 0 ? -1 : 1;
  st.v = damp(st.v, v, 12, dt);
  // the gait: the shuffle below P.vS, the half-bound above (hysteresis); sp: how far into the bound (the duty falls, the
  // flex and the flight grow)
  st.crawl = damp(st.crawl || 0, clamp(inp.crawl || 0, 0, 1), 8, dt); const uK = st.crawl < 0.002 ? 0 : st.crawl;
  if (st.gait === 0 && v > P.vS * 1.06 && uK < 0.5) st.gait = 1; else if (st.gait >= 1 && (v < P.vS * 0.92 || uK >= 0.5)) st.gait = 0;
  st.gk = damp(st.gk, st.gait ? 1 : 0, 5, dt);
  const gk = st.gk, sp = clamp((v - P.vS) / (4 * P.vt), 0, 1);
  // the pose: the sit-up above 0, the crouch below (the form at -1)
  const pose = uK ? Math.min(clamp(inp.pose || 0, -1, 1), -0.7 * uK) : clamp(inp.pose || 0, -1, 1);   // the crawl: no sit-up, the freeze's crouch at least
  st.sit = damp(st.sit || 0, Math.max(0, pose), 5, dt); st.crouch = damp(st.crouch, Math.max(0, -pose), 6, dt);
  const uS = ease(clamp((st.sit - 0.05) / 0.6, 0, 1)), uC = ease(clamp(st.crouch, 0, 1));
  st.dig = damp(st.dig || 0, clamp(inp.dig || 0, 0, 1), 8, dt); const uD = st.dig < 0.002 ? 0 : st.dig;
  if (uD) st.digPh = ((st.digPh || 0) + DIG_HZ * dt) % 1;
  // the standing turn's hysteresis (as gaitStep)
  const aw = Math.abs(inp.wr || 0), still = v < 0.05 && !inp.air && st.sit < 0.3 && st.crouch < 0.5;
  if (still && aw > (st.tq > 0 ? P.turn.off : P.turn.on)) st.tq = P.turn.hold; else st.tq = still ? st.tq - dt : 0;
  const turning = st.tq > 0;
  st.tk = damp(st.tk, turning ? 1 : 0, 8, dt);
  // the cadence (gaitStep's), the shuffle's stride kept within the body's length (quicker short hops, the feet under it),
  // with the stride's own tempo and the slope's (gaitStep's)
  if (!(st.sc >= 1)) st.sc = inp.sc >= 1 ? inp.sc : 1 + (I ? h32(I.seed, 0x5c, 0) * SC_WRAP : 0);
  const slope = clamp((st.gF - st.gH) / (R[J.Chest][2] - R[J.Hips][2]), -V.slope.max, V.slope.max) * fwd;
  const kf = (vk ? 1 + vk * (V.stride_cv[0] + (V.stride_cv[2] - V.stride_cv[0]) * gk) * drift(I.seed, 0, st.sc, V.w) : 1) * (1 + V.slope.hz * slope);
  const c0 = hopCadence(P, v, gk), L = c0.L / kf, f = c0.f * kf;
  const fTurn = turning ? clamp(aw * skel.rFoot / (0.25 * P.Lt), P.turn.hz[0], P.turn.hz[1]) : 0;
  const moving = v > 0.05 || turning;
  const obs = st.obs || 1;
  const rate = (v > 0.05 ? Math.max(f, fTurn) : fTurn) / obs;
  st.L = (v > 0.05 ? L * obs : 0.3 * P.Lt) / s;   // in the body's own units (the feet's are)
  const prev = st.phase;
  if (inp.sc >= 1) {   // a mirror's clock, locked to the host's (gaitStep's)
    const e = wrapSc(inp.sc - st.sc);
    if (!moving || Math.abs(e) > 0.5 || !st.feet[0].has) st.sc = inp.sc; else st.sc += rate * dt * clamp(3 * e, -0.3, 0.3);
  }
  if (moving) st.sc += rate * dt;
  if (st.sc >= 1 + SC_WRAP) st.sc -= SC_WRAP;
  st.phase = frac(st.sc);
  st.moving = moving; st.rate = rate;
  // a bound ends at the hind pair's landing: a hare's lope counts them, and every few is the observation hop. Which
  // bounds are read from the stride clock's count (the same on every page): one in each run of `every`'s middle,
  // placed by the individual's seed, so the gaps stay within `every`
  if (moving && v > 0.05 && crossed(prev, st.phase, HIND)) {
    st.obs = 1;
    if (P.observe && st.gait && v > P.vt) {
      const E = P.observe.every, w = Math.round((E[0] + E[1]) / 2), j = Math.floor((E[1] - E[0]) / 2), k = Math.floor(st.sc - HIND), seed = I ? I.seed : 0;
      if (k % w === Math.floor(h32(seed, 0x0b, Math.floor(k / w)) * (j + 1))) st.obs = P.observe.longer || 1.4;
    }
  }
  st.obsK = damp(st.obsK || 0, st.obs > 1 ? 1 : 0, 6, dt);
  const dF = turning ? 0.5 : 0.6 + (0.32 - 0.18 * sp - 0.6) * gk, dH = turning ? 0.88 : 0.62 + (0.34 - 0.2 * sp - 0.62) * gk;   // the duty falls fast with speed (a hare at full stretch is mostly in the air)
  st.duty = dH;
  const swingOf = d => rate > 0.1 ? (1 - d) / rate : 0.2;
  st.air = damp(st.air, inp.air ? 1 : 0, 10, dt);
  // ---- the feet: planted where they land, swung on an arc to the next plant point (as gaitStep) ----
  const feet = st.feet, lf = new Array(4);
  for (let i = 0; i < 4; i++) {
    const F = feet[i], Lg = skel.legs[i], toe = Lg.toe, duty = Lg.fore ? dF : dH, swingT = swingOf(duty);
    const il = I && I.lead < 0 ? i ^ 1 : i;   // the individual's lead: which of a pair lands first
    const td = (turning ? HOP_TD.turn[il] : HOP_TD.shuffle[il] + (HOP_TD.bound[il] - HOP_TD.shuffle[il]) * gk) + F.dp;
    if (!F.has || jumped) { const w = toWorld(toe); F.x = w[0]; F.z = w[2]; F.y = terrain(w[0], w[2]); F.stance = true; F.s = 1; F.has = true; }
    if (inp.air) {   // a jump: the fore legs reach, the hind legs trail and tuck
      F.stance = false; F.s = 0; F.has = false;
      const l = lerp3(toe, Lg.fore ? [toe[0], 0.35 * R[Lg.u][1], toe[2] + 0.4 * Lg.a] : [toe[0], 0.3 * R[Lg.u][1], toe[2] - 0.5 * Lg.a], st.air);
      lf[i] = l; F.l = l; continue;
    }
    const pf = ((st.phase - td) % 1 + 1) % 1; F.pf = pf; F.duty = duty;
    const here = toLocal([F.x, F.y, F.z]);
    if (F.stance) {
      const late = here[2] * fwd < toe[2] * fwd - (0.75 - (Lg.fore ? 0 : 0.25 * gk)) * st.L - 0.3 * Lg.a || Math.abs(here[0] - toe[0]) > 1.2 * Lg.a || (F.over && here[2] * fwd < toe[2] * fwd);   // dragged well behind, twisted out, or past its leg's reach (give)
      const sitting = Lg.fore && st.sit > 0.3;   // the paws held up
      if (!sitting && ((moving && pf >= duty && pf < duty + (1 - duty) * 0.6) || late)) { F.stance = false; F.s = 0; F.lx = F.x; F.ly = F.y; F.lz = F.z; F.over = false; F.pl = pf; }
    }
    if (!F.stance) {
      if (moving) { const left = pf < F.pl - 0.5 ? 0 : 1 - pf; F.pl = pf; F.s = left > rate * dt ? F.s + (1 - F.s) * rate * dt / left : 1; }   // evenly over the time left to its landing (gaitStep's)
      else F.s = Math.min(1, F.s + dt / Math.max(swingT, 0.1));
      const going = v > 0.05 ? 1 : 0, rem = (1 - F.s) * swingT, rot = (inp.wr || 0) * rem, dz = fwd * v * rem / s;
      const ahead = fwd * duty * st.L * 0.5 * going;
      const c = Math.cos(rot), sn = Math.sin(rot), px = toe[0] + vk * F.nx * V.width_sd[i >> 1] * P.track, pz = toe[2] + ahead + vk * going * F.nz * V.step_sd * st.L;   // (this stride's own reach and width: landed)
      let tw = toWorld([c * px + sn * pz, 0, -sn * px + c * pz + dz]); tw[1] = terrain(tw[0], tw[2]);
      if (F.s > 0.5 && st.P) {   // near its landing: no further than the leg, as the body is posed, will reach (gaitStep's)
        const tl = toLocal(tw), z1 = reachClamp(Lg, st.P[Lg.u], here, tl, dz);
        if (z1 !== tl[2]) { tl[2] = z1; tw = toWorld(tl); tw[1] = terrain(tw[0], tw[2]); }
      }
      // the swing's clearance: the shuffle's low step, the bound's higher fold, the turn's little hops
      const eH = 1 - (1 - F.s) * (1 - F.s), e = ease(F.s) + (Lg.fore ? 0 : (eH - ease(F.s)) * 0.6 * gk);   // the hind pair swing up quickly after the push-off
      const lift = ((Lg.fore ? 0.5 : 0.6) * R[Lg.f][1] + (0.04 + 0.06 * gk) * st.L) * s * Math.sin(Math.PI * F.s) * (1 - 0.6 * uK);
      F.x = F.lx + (tw[0] - F.lx) * e; F.z = F.lz + (tw[2] - F.lz) * e;
      F.y = Math.max(F.ly + (tw[1] - F.ly) * e, terrain(F.x, F.z)) + lift;
      if (F.s >= 1) {
        F.stance = true; F.x = tw[0]; F.y = tw[1]; F.z = tw[2];
        if (vk) { const k = ((Math.round(st.sc - td) % SC_WRAP) + SC_WRAP) % SC_WRAP; F.dp = i === 2 ? 0 : I.k * V.phase_sd * drift(I.seed, 1 + i, k, V.w); F.nz = drift(I.seed, 5 + i, k, V.w); F.nx = drift(I.seed, 9 + i, k, V.w); }
      }
    }
    lf[i] = toLocal([F.x, F.y, F.z]); F.l = lf[i];
    F.gy = groundL([lf[i][0], 0, lf[i][2]]);
  }
  // ---- the body ----
  const gF = (feet[0].gy + feet[1].gy) / 2, gH = (feet[2].gy + feet[3].gy) / 2, gL = (feet[0].gy + feet[2].gy) / 2, gR = (feet[1].gy + feet[3].gy) / 2;
  const k = inp.air ? 2 : 8;
  st.gF = damp(st.gF, inp.air ? 0 : gF, k, dt); st.gH = damp(st.gH, inp.air ? 0 : gH, k, dt);
  st.gL = damp(st.gL, gL, k, dt); st.gR = damp(st.gR, gR, k, dt);
  const share = 0.8, psi = ((st.phase - HIND) % 1 + 1) % 1, tp = TAU * psi;
  const hipsRest = R[J.Hips], chestRest = R[J.Chest], spineRest = R[J.Spine], trunkL = chestRest[2] - hipsRest[2];
  // the cycle's shapes (psi = 0 at the hind pair's landing): the half-bound arches as the hind feet come under (psi ~ 0.95)
  // and extends in the flight after they push off (~0.4), the body highest there, nose-up at the push-off and down over
  // the fore feet; the shuffle rises a little as the hind pair hop up (psi 0.62 .. 1) and arches as they land
  const Af = P.flexMax * (0.7 + 0.3 * sp), hop = moving && !inp.air && !turning ? 1 : 0;
  const flexB = Af * Math.cos(tp - TAU * 0.95), bobB = ((0.1 + 0.12 * sp) * h * Math.cos(tp - TAU * 0.4) + st.obsK * (P.observe?.higher_hip || 0) * h * Math.max(0, Math.sin(Math.PI * clamp((psi - 0.3) / 0.7, 0, 1))));
  const pitchB = 0.13 * Math.sin(tp + TAU * 0.05), gzB = 0.14 * trunkL * (0.5 + 0.5 * sp) * Math.cos(tp - TAU * 0.95);
  const upS = psi > 0.62 ? Math.sin(Math.PI * (psi - 0.62) / 0.38) : 0;
  const flexS = 0.08 * Math.cos(tp), bobS = 0.03 * h * upS, pitchS = -0.07 * upS, gzS = 0.05 * trunkL * Math.cos(tp);
  const turnUp = turning ? Math.max(0, Math.sin(TAU * st.phase)) : 0;   // the fore pair's hops round the turn lift the chest
  const flexC = hop * (flexS + (flexB - flexS) * gk), bob = hop * (bobS + (bobB - bobS) * gk), pitchC = hop * (pitchS + (pitchB - pitchS) * gk) + 0.05 * turnUp * st.tk;
  const gz = hop * (gzS + (gzB - gzS) * gk);
  st.flex = damp(st.flex, (flexC + 0.12 * uC) * (1 - 0.8 * uK), 14, dt); st.bob = damp(st.bob, bob * (1 - 0.9 * uK), 14, dt); st.gz = damp(st.gz || 0, gz, 14, dt);
  // on the move the crouch leans forward: the back flatter, the hindquarters up on the hind legs, the head lower
  st.lean = damp(st.lean || 0, hop * (0.16 + 0.2 * gk + 0.1 * sp) * (1 - uK), 4, dt);
  // the lurch: the hindquarters wait over the planted hind feet and hop up after the chest, the chest waits over the fore
  // feet and is carried on (a: the share of the body's speed a segment keeps while its feet stand; most of it in the
  // half-bound, where the flight carries the body), so the feet stay under the body at a forage
  const lurch = (q, d, A) => q < d ? A * (1 - 2 * q / d) : -A + 2 * A * ease((q - d) / (1 - d));
  const aH = 0.6 + 0.3 * gk, aF = 0.7 + 0.2 * gk, tdS = (HOP_TD.shuffle[0] + HOP_TD.shuffle[1]) / 2, tdF = tdS + ((HOP_TD.bound[0] + HOP_TD.bound[1]) / 2 - tdS) * gk;
  const lu = v > 0.05 && !inp.air && !turning ? fwd : 0;
  st.oH = damp(st.oH || 0, lu * lurch(psi, dH, (1 - aH) * st.L * dH / 2), 20, dt);
  st.oF = damp(st.oF || 0, lu * lurch(((st.phase - tdF) % 1 + 1) % 1, dF, (1 - aF) * st.L * dF / 2), 20, dt);
  // the crouch: the chest down onto the belly, the haunch (already on the heels) hardly (the freeze); the form a little
  // further, the whole pose sunk into the scrape
  const belly = skel.belly, dropH = (uC * 0.15 + 0.45 * uK) * belly, dropC = (uC * 0.8 + 0.2 * uK) * belly, scrape = Math.max(0, (st.crouch - 0.7) / 0.3) * (0.15 * belly + 0.06 * h);
  // the sit-up: the trunk raised about the hips onto the hind feet, the hips up a little and back
  const sitA = 0.5 * uS, sitY = 0.1 * h * uS, sitZ = -0.08 * trunkL * uS;
  st.eatDrop = damp(st.eatDrop || 0, st.eatWant || 0, 3, dt);   // the eat's reach: the chest lowered onto the fore legs (reachDip)
  const yH = hipsRest[1] + st.gH * share - dropH + st.bob + sitY + 0.3 * h * st.lean, yC = chestRest[1] + st.gF * share - dropC + st.bob + sitY - st.eatDrop - 0.35 * belly * uD;   // uD: the dig's chest low
  const pitch = Math.asin(clamp((yC - yH - (chestRest[1] - hipsRest[1])) / trunkL, -0.9, 0.9)) + pitchC + sitA - st.lean;
  st.pitch = damp(st.pitch, pitch, 12, dt);
  const track = Math.abs(skel.legs[0].toe[0] - skel.legs[1].toe[0]) || 0.1;
  st.roll = damp(st.roll, Math.atan((st.gL - st.gR) / track) * 0.5, 6, dt);
  // the spine in two segments joined at the Spine joint: arched (flex above 0) lifts the middle of the back, the hind
  // segment nose-up and the fore segment nose-down; the hips carried forward as the hind feet come under (gz)
  const bend = clamp(inp.bend || 0, -0.5, 0.5);
  const RA = mul3(rotZ(st.roll), rotX(-(st.pitch + st.flex)));
  const RB = mul3(rotY(bend), mul3(rotZ(st.roll), rotX(-(st.pitch - st.flex))));
  const Ph = [0, yH, hipsRest[2] + st.gz + sitZ + st.oH];
  const Psp0 = add(Ph, apply3(RA, sub(spineRest, hipsRest))), dLu = [0, 0, st.oF - st.oH];   // the fore half carried by the chest's lurch
  const Psp = add(Psp0, scale(dLu, 0.5));
  const at = (rest, Rm, base, baseRest) => add(base, apply3(Rm, sub(rest, baseRest)));
  const Pc = add(at(chestRest, RB, Psp0, spineRest), dLu);
  const Pn0 = add(at(R[J.Neck], RB, Psp0, spineRest), dLu);
  const S = skel.legs.map((Lg, i) => {
    const p = Lg.fore ? add(at(R[Lg.u], RB, Psp0, spineRest), dLu) : at(R[Lg.u], RA, Ph, hipsRest);
    const slide = (lf[i][2] - Lg.toe[2]) * (Lg.fore ? 0.3 : 0.12) * (1 - uS);
    return [p[0], p[1] - 0.1 * Math.abs(slide), p[2] + slide];
  });
  // ---- the legs ----
  const Pj = st.P || (st.P = new Array(skel.n)), E = st.E || (st.E = {});
  Pj[J.Hips] = Ph; Pj[J.Spine] = Psp; Pj[J.Chest] = Pc;
  for (let i = 0; i < 4; i++) {
    const Lg = skel.legs[i], F = feet[i];
    let fv = Lg.foot, toe = lf[i];
    if (Lg.fore) {   // the paw curled back in the swing; held up under the chest in the sit-up
      const sw = F.stance ? 0 : Math.sin(Math.PI * F.s);
      if (sw > 0) fv = apply3(rotX(1.0 * sw), fv);
      if (uS > 0.001) {
        const reach = Lg.a + Lg.b, hang = [S[i][0] * 0.9, S[i][1] - 0.62 * reach, S[i][2] + 0.3 * reach];
        toe = lerp3(toe, hang, uS); fv = apply3(rotX(0.9 * uS), fv);
      }
      if (uD) {   // the dig: forward to the ground, raked back under the chest, the foot curled up on the way forward
        const ph = ((st.digPh || 0) + (i === 1 ? 0.5 : 0)) % 1, reach = Lg.a + Lg.b, back = ph < 0.55 ? ph / 0.55 : 1 - (ph - 0.55) / 0.45;
        const up = ph < 0.55 ? 0 : Math.sin(Math.PI * (ph - 0.55) / 0.45), g = groundL([Lg.toe[0], 0, Lg.toe[2]]);
        toe = lerp3(toe, [Lg.toe[0] * 0.85, g + 0.18 * reach * up, Lg.toe[2] + (0.35 - 0.8 * back) * reach], uD); fv = apply3(rotX(0.9 * up * uD), fv);
      }
    } else {         // the long foot flat in the stance, the heel rising off it at the push-off; folded up in the swing
      const prog = F.stance ? clamp((F.pf ?? 0) / (F.duty || 1), 0, 1) : 0;
      const heel = F.stance ? (0.95 * gk + 0.2) * ease(clamp((prog - 0.45) / 0.55, 0, 1)) * hop
        : (0.95 * gk + 0.2) * (1 - F.s) * (1 - F.s) + (0.25 + 0.3 * gk) * Math.sin(Math.PI * F.s);
      if (heel > 0.001) fv = apply3(rotX(heel), fv);
    }
    legIK(Lg, F.stance && toe === lf[i] ? give(Lg, S[i], toe, F) : S[i], toe, fv, Pj, E);
  }
  // ---- the head: level over the bound, dipped by the flick (nibbling), drawn in by the crouch, leading a turn ----
  const lead = clamp((inp.wr || 0) * P.lead, -P.leadMax, P.leadMax);
  st.lead = damp(st.lead, lead, 8, dt);
  const tilt = st.pitch - st.flex;   // the fore segment's pitch, countered
  const fl = inp.flick || 0, d0 = 0.35 * uC + 0.55 * uD + 0.3 * uK, cN = d0 * 0.6 + 0.45 * tilt, cH = d0 * 0.5 + 0.55 * tilt;   // uD: the dig's head down
  let dip = fl * 0.9;   // sitting up, the nibble at the paws (the old dip); to a half the same
  if (fl > 0.5 && !inp.air && uS < 0.3 && uD < 0.3) {   // on all fours, past a half (not digging): the nose to the grass (reachDip), the chest lowered if it must
    const r = reachDip(skel, RB, Pn0, 0.6, cN, 0.5, cH, st.lead, groundL), u = Math.min(1, (fl - 0.5) * 2);
    dip = 0.45 + (r.q - 0.45) * u;
    st.eatWant = clamp(st.eatDrop + r.short, 0, EAT_DROP * belly) * u;
  } else st.eatWant = 0;
  const Rn = mul3(RB, rotX(dip * 0.6 + cN));
  const Rh = mul3(mul3(RB, rotY(st.lead)), rotX(dip * 0.5 + cH));
  const Phd = add(Pn0, apply3(Rn, sub(R[J.Head], R[J.Neck])));
  const nose = add(Phd, apply3(Rh, sub(skel.nose, R[J.Head])));
  Pj[J.Neck] = Pn0; Pj[J.Head] = Phd; E[J.Head] = nose;
  // ---- the ears: up and swivelling each on its own when alert, laid back along the neck in flight or frozen ----
  const loc = st.loc || (st.loc = {});
  let ears = uK > 0.5 ? -1 : inp.ears;
  if (!(ears === ears) || ears === undefined) ears = uS > 0.3 ? 1 : uC > 0.3 ? -1 : v > 0.9 * P.vt ? -1 : v > P.vS ? -0.3 : 0.4;
  st.ears = damp(st.ears ?? 0, ears, ears < (st.ears ?? 0) ? 7 : 4, dt);
  const back = clamp(-st.ears, 0, 1), alert = clamp(st.ears, 0, 1);
  if (skel.ears) {
    st.earSw ||= [0, 0]; st.earAim ||= [0, 0]; st.earT ||= [0, 0];
    for (let e = 0; e < 2; e++) {
      if ((st.earT[e] -= dt) <= 0) { st.earAim[e] = (rnd(st) - 0.3) * (0.25 + 0.9 * alert) * skel.ears[e].sx; st.earT[e] = (alert > 0.5 ? 0.5 : 1.2) + rnd(st) * 1.5; }
      st.earSw[e] = damp(st.earSw[e], st.earAim[e] * (1 - back), alert > 0.5 ? 9 : 4, dt);
      const flop = (0.25 * st.bob + V.soft.ear_k * (st.bob - follow(st.hd, st.bob, TAU * P.ft * V.soft.head_hz, V.soft.head_z, e ? 0 : dt))) / h * (1 - back);   // the ears give a little to the bound, and late
      loc[skel.ears[e].j] = mul3(rotY(st.earSw[e]), mul3(rotX(-1.25 * back + 0.12 * alert - flop), rotZ(skel.ears[e].sx * 0.3 * back)));   // laid back, the pair drawn together
    }
  }
  // ---- the scut: cocked up over the rump (twitch), bouncing a little with the bound ----
  if (skel.scut) { st.scutUp = damp(st.scutUp || 0, clamp(inp.twitch || 0, 0, 1), 8, dt); loc[skel.scut.j] = rotX(0.9 * st.scutUp + 0.15 * hop * gk * Math.sin(tp)); }
  if (scrape > 0.0005) { for (let j = 0; j < skel.n; j++) if (Pj[j]) Pj[j] = [Pj[j][0], Pj[j][1] - scrape, Pj[j][2]]; for (const q in E) E[q] = [E[q][0], E[q][1] - scrape, E[q][2]]; }
  st.roll3 = st.roll; st.bendYaw = bend;
  return st;
}

// A planted foot just out of its leg's reach: the joint gives toward it (the shoulder blade slides, the pelvis tips), by
// at most a twelfth of the reach, so the drawn toe stays on its plant point.
// F.over: the giving is used up (the next frame lifts the foot: the body has gone on past it).
function give(Lg, S, toe, F) {
  const d = sub(toe, S), dl = len(d), over = dl - 0.995 * Lg.reach;
  F.over = over > Lg.reach / 12;
  return over > 0 ? add(S, scale(d, Math.min(over, Lg.reach / 12) / dl)) : S;
}
// Two-bone IK from the shoulder or hip S to the ankle over the toe (the foot bone fv from the toe up to the ankle), the knee
// to the leg's bend side; out of reach the leg straightens toward its toe, the foot bone continuing the line (an extended
// reach). Writes the leg's joints into Pj and the toe into E.
function legIK(Lg, S, toe, fv, Pj, E) {
  const W = add(toe, fv);
  const d0 = sub(W, S); let d = len(d0);
  const a = Lg.a, b = Lg.b, c = len(fv), dmax = (a + b) * 0.995, dmin = Math.abs(a - b) + 0.01;
  let u = scale(d0, 1 / (d || 1));
  let Ek, Wk, toeK;
  if (d > dmax) {
    const dt0 = sub(toe, S), dl = len(dt0); u = scale(dt0, 1 / (dl || 1));
    const reach = Math.min(dl, a + b + 0.85 * c);
    Ek = add(S, scale(u, a)); Wk = add(S, scale(u, a + b)); toeK = add(S, scale(u, reach));
  } else {
    if (d < dmin) { S = sub(W, scale(u, dmin)); d = dmin; }   // folded as far as it goes: the joint gives the rest, the toe stays on its point
    const ca = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), al = Math.acos(ca);
    let bd = [0, 0, Lg.bend]; bd = sub(bd, scale(u, dot(bd, u))); const bl = len(bd); bd = bl > 1e-4 ? scale(bd, 1 / bl) : [0, 0, Lg.bend];
    Ek = add(S, add(scale(u, a * Math.cos(al)), scale(bd, a * Math.sin(al))));
    Wk = add(S, scale(u, d)); toeK = add(Wk, scale(fv, -1));
  }
  Pj[Lg.u] = S; Pj[Lg.l] = Ek; Pj[Lg.f] = Wk; E[Lg.f] = toeK;
}

// The bedded pose, once per skeleton: the hips and chest down until the belly rests on the ground, the fore legs folded
// under the chest (a sphinx), the hind legs folded alongside, the head level and a little low, the tail along the ground.
const BED = new WeakMap();
export function bedPose(skel) {
  let B = BED.get(skel); if (B) return B;
  const R = skel.rest, J = skel.idx, P = new Array(skel.n), E = {};
  const drop = skel.belly * 0.92, dy = [0, -drop, 0];
  for (const n of ['Hips', 'Spine', 'Chest', 'Neck', 'Tail1']) P[J[n]] = add(R[J[n]], dy);
  P[J.Head] = add(R[J.Head], [0, -drop - 0.03 * skel.h, 0.02 * skel.h]);
  E[J.Head] = add(skel.nose, [0, -drop - 0.06 * skel.h, 0.02 * skel.h]);
  // the tail on the ground, curled to the left
  const t1 = P[J.Tail1], tl = len(sub(skel.tip, R[J.Tail1])) / 3;
  P[J.Tail2] = [t1[0] + tl * 0.5, Math.max(0.02, t1[1] - tl * 0.8), t1[2] - tl * 0.5];
  P[J.Tail3] = [P[J.Tail2][0] + tl * 0.8, 0.02, P[J.Tail2][2] - tl * 0.3];
  E[J.Tail3] = [P[J.Tail3][0] + tl * 0.9, 0.02, P[J.Tail3][2] + tl * 0.3];
  for (const Lg of skel.legs) {
    const sx = Lg.left ? 1 : -1, S = add(R[Lg.u], dy), a = Lg.a, b = Lg.b, c = len(Lg.foot);
    if (Lg.fore) {   // the elbow back and down beside the chest, the forearm forward along the ground, the paw ahead
      const Ek = [S[0] * 1.1, Math.max(0.02, S[1] - a * 0.9), S[2] - a * 0.35];
      const Wk = [Ek[0], 0.4 * c, Ek[2] + b * 0.95];
      P[Lg.u] = S; P[Lg.l] = Ek; P[Lg.f] = Wk; E[Lg.f] = [Wk[0], 0, Wk[2] + c * 0.9];
    } else {         // the stifle forward and out beside the belly, the shank back along the ground, the foot forward under it
      const Ek = [S[0] + sx * 0.3 * a, Math.max(0.03, S[1] - a * 0.6), S[2] + a * 0.5];
      const Wk = [Ek[0] + sx * 0.1 * b, 0.3 * c, Ek[2] - b * 0.9];
      P[Lg.u] = S; P[Lg.l] = Ek; P[Lg.f] = Wk; E[Lg.f] = [Wk[0] - sx * 0.05 * c, 0, Wk[2] + c * 0.8];
    }
  }
  B = { P, E }; BED.set(skel, B); return B;
}

// ---- the rotations and the pose row -----------------------------------------------------------------------------------
// Each bone's rotation is the smallest carrying its rest direction (to its child, or its end point for a leaf) onto its
// posed direction, the trunk's with the roll about its axis and the head's with its yaw lead. Writes skel.n x 3 texels of
// four floats at row `row` of `out` (row-major, width skel.n * 3): texel k of joint j = row k of [R | p - R q].
const CHILD = { Hips: 'Spine', Spine: 'Chest', Chest: 'Neck', Neck: 'Head', Tail1: 'Tail2', Tail2: 'Tail3' };
export function writeRow(skel, st, out, row) {
  const R = skel.rest, J = skel.idx, P = st.P, E = st.E, w = skel.n * 3 * 4, o = row * w;
  const Ms = st.M || (st.M = new Array(skel.n));
  for (let j = 0; j < skel.n; j++) {
    const name = skel.names[j], at = skel.attach?.[j];
    if (at) {   // an ear or the scut: its own turn in the parent's frame, carried with the parent
      const Mp = Ms[at.parent], pp = P[at.parent], M = mul3(Mp, st.loc?.[j] || I3());
      const p = add(pp, apply3(Mp, sub(R[j], R[at.parent]))); P[j] = p; Ms[j] = M;
      const q = R[j], b = o + j * 12;
      out[b] = M[0]; out[b + 1] = M[1]; out[b + 2] = M[2]; out[b + 3] = p[0] - (M[0] * q[0] + M[1] * q[1] + M[2] * q[2]);
      out[b + 4] = M[3]; out[b + 5] = M[4]; out[b + 6] = M[5]; out[b + 7] = p[1] - (M[3] * q[0] + M[4] * q[1] + M[5] * q[2]);
      out[b + 8] = M[6]; out[b + 9] = M[7]; out[b + 10] = M[8]; out[b + 11] = p[2] - (M[6] * q[0] + M[7] * q[1] + M[8] * q[2]);
      continue;
    }
    let childRest, childPose;
    if (CHILD[name]) { childRest = R[J[CHILD[name]]]; childPose = P[J[CHILD[name]]]; }
    else if (/^UpperLeg/.test(name)) { childRest = R[j + 1]; childPose = P[j + 1]; }
    else if (/^LowerLeg/.test(name)) { childRest = R[j + 1]; childPose = P[j + 1]; }
    else if (name === 'Head') { childRest = skel.nose; childPose = E[j]; }
    else if (name === 'Tail3') { childRest = skel.tip; childPose = E[j]; }
    else { const Lg = skel.legs.find(L => L.f === j); childRest = Lg.toe; childPose = E[j]; }   // a foot: to its toe
    let d0 = sub(childRest, R[j]), d1 = sub(childPose, P[j]);
    if (len(d0) < 1e-4) { d0 = [0, 0, 1]; d1 = [0, 0, 1]; }
    let M = between(unit(d0), unit(d1));
    if (name === 'Hips' || name === 'Spine' || name === 'Chest') M = mul3(M, axisAngle(unit(d0), st.roll3 || 0));
    else if (name === 'Head') M = mul3(rotY((st.lead || 0) + (st.bendYaw || 0)), M);
    else if (name === 'Neck') M = mul3(rotY(st.bendYaw || 0), M);
    const q = R[j], p = P[j]; Ms[j] = M;
    const tx = p[0] - (M[0] * q[0] + M[1] * q[1] + M[2] * q[2]), ty = p[1] - (M[3] * q[0] + M[4] * q[1] + M[5] * q[2]), tz = p[2] - (M[6] * q[0] + M[7] * q[1] + M[8] * q[2]);
    const b = o + j * 12;
    out[b] = M[0]; out[b + 1] = M[1]; out[b + 2] = M[2]; out[b + 3] = tx;
    out[b + 4] = M[3]; out[b + 5] = M[4]; out[b + 6] = M[5]; out[b + 7] = ty;
    out[b + 8] = M[6]; out[b + 9] = M[7]; out[b + 10] = M[8]; out[b + 11] = tz;
  }
}

// ---- the far tier: the baked cycles (tools/bake_gait.mjs) -------------------------------------------------------------
// From the clip set's index (animalModels.js loadClips: clip names -> indices, table rows with first, count, stride_m) a
// drive like the deer's but by the same Froude bands as the live engine: Idle, Walk, Trot, Gallop, Bed; the gaits' phase
// by distance (planted feet at any speed), a blend over 0.3 s (0.8 s into and out of the bed).
// A lagomorph's set (bake_gait.mjs for P.hop): Idle, Shuffle, Bound, Run (the fast half-bound, the hares' lope and bolt),
// Sit, Freeze and Form, by the hop's bands (the shuffle below P.vS, the bound to 3 x trot_mps) and the pose's sign.
// Eat (2026-11-03): one frame standing with the nose at the ground (flick 1, reachDip), taken standing at a flick over a
// half; a clip set baked before it has none, and the far tier stands at Idle.
export function farTable(skin, P) {
  const C = skin.clip, T = skin.table, pick = (...n) => n.map(k => C[k]).find(c => c !== undefined) ?? C.Idle ?? 0;
  if (P.hop) return { hop: true, idle: pick('Idle'), walk: pick('Shuffle', 'Walk'), trot: pick('Bound', 'Trot'), gallop: pick('Run', 'Gallop'), bed: pick('Form', 'Bed'),
    sit: pick('Sit'), freeze: pick('Freeze', 'Form'), eat: C.Eat ?? pick('Idle'), T, vw: P.vS, vt: 3 * P.vt };
  return { idle: pick('Idle'), walk: pick('Walk'), trot: pick('Trot'), gallop: pick('Gallop'), bed: pick('Bed'), eat: C.Eat ?? pick('Idle'), T, vw: P.vw, vt: P.vt, vary: P.vary };
}
// P: the individual's numbers (individualParams), so a herd on the baked cycles does not march in step: each body starts
// at its own place in the cycle, plays it at its own cadence (its size's and its tempo's) and drifts about that as the
// live strides do (the same drift, by its own count of cycles). The cycle's stride is the species', so a far foot slips by
// the difference: a few hundredths of a stride, beyond the live radius.
export function makeFar(P = null) { const I = P && P.ind; return { cur: -1, prev: 0, pA: I ? h32(I.seed, 0x5c, 2) : 0, pB: 0, blend: 0, tBlend: 0.3, kind: '', n: 0, seed: I ? I.seed : 0, k: I ? I.far : 1, vk: I ? I.k : 0 }; }
export function farDrive(st, F, v, pose, dt, out, o, flick = 0) {
  v = Math.abs(v || 0);
  let kind = F.hop ? (pose > 0.5 ? 'sit' : pose < -0.8 ? 'bed' : pose < -0.3 ? 'freeze' : '') : pose > 0.5 ? 'bed' : '';
  if (!kind) kind = v < 0.05 ? (flick > 0.5 ? 'eat' : 'idle') : v < F.vw * (st.kind === 'trot' ? 0.92 : 1.05) ? 'walk' : v < F.vt * (st.kind === 'gallop' ? 0.9 : 1.05) ? 'trot' : 'gallop';
  if (kind !== st.kind) {
    const next = F[kind];
    if (st.cur >= 0 && next !== st.cur) {
      st.prev = st.cur; st.pB = st.pA; st.blend = 1; st.tBlend = kind === 'bed' || st.kind === 'bed' ? 0.8 : kind === 'sit' || kind === 'freeze' || kind === 'eat' || st.kind === 'sit' || st.kind === 'freeze' || st.kind === 'eat' ? 0.4 : 0.3;
      const a = F.T[st.cur], b = F.T[next];
      st.pA = a.stride_m && b.stride_m ? ((st.pA - (a.touchdown || 0) + (b.touchdown || 0)) % 1 + 1) % 1 : st.pA;
    } else if (st.cur < 0) st.blend = 0;
    st.cur = next; st.kind = kind;
  }
  const V = F.vary, own = st.vk && V ? st.k * (1 + st.vk * V.stride_cv[kind === 'gallop' ? 2 : kind === 'trot' ? 1 : 0] * drift(st.seed, 0, st.n, V.w)) : st.k || 1;
  const rate = c => c.stride_m ? clamp(v / c.stride_m, 0.3 / (c.duration || 1), 1.6 / (c.duration || 1)) * own : 0;
  const adv = dt * rate(F.T[st.cur]); st.n = ((st.n || 0) + adv) % SC_WRAP;
  st.pA = (st.pA + adv) % 1;
  if (st.blend > 0) { st.pB = (st.pB + dt * rate(F.T[st.prev])) % 1; st.blend = Math.max(0, st.blend - dt / st.tBlend); }
  const w = st.blend * st.blend * (3 - 2 * st.blend);
  out[o * 4] = st.cur; out[o * 4 + 1] = st.pA; out[o * 4 + 2] = st.prev + Math.min(st.pB, 0.9999); out[o * 4 + 3] = w;
}

// A live row's aClip: the row in the first slot, flagged negative (the shader reads the pose texture), nothing blended.
export function liveClip(row, out, o) { out[o * 4] = -1 - row; out[o * 4 + 1] = 0; out[o * 4 + 2] = 0; out[o * 4 + 3] = 0; }

// The feet's world points (for the debug markers): [x, y, z, stance] per foot.
export function footPoints(st) { return st.feet.map(F => [F.x, F.y, F.z, F.stance ? 1 : 0]); }
