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

// ---- the skeleton (from the GLB's extras.skin, tools/rig_quadruped.py) --------------------------------------------
export function skeletonOf(sk) {
  const idx = Object.fromEntries(sk.joints.map((n, i) => [n, i]));
  const rest = sk.joint_rest.map(p => p.slice());
  const legs = LEG_NAMES.map((name, i) => {
    const L = sk.legs[name], [u, l, f] = L.joints, toe = L.toe.slice();
    return { name, i, fore: name[0] === 'F', left: name[1] === 'L', u, l, f, toe, a: len(sub(rest[l], rest[u])), b: len(sub(rest[f], rest[l])),
      foot: sub(rest[f], toe), bend: name[0] === 'F' ? -1 : 1 };   // foot: the rest vector from the toe up to the ankle; bend: the knee's side (the elbow back, the stifle forward)
  });
  const h = sk.withers_m || rest[idx.Chest][1] * 1.2;
  return { n: sk.joints.length, names: sk.joints, idx, rest, legs, tip: sk.tail_tip.slice(), nose: sk.nose.slice(), posture: sk.posture || 'digitigrade', h,
    belly: Math.min(rest[idx['LowerLeg.FL']][1], rest[idx['LowerLeg.HL']][1]),   // the belly line: the elbow and stifle pivots
    rFoot: legs.reduce((s, L) => s + Math.hypot(L.toe[0], L.toe[2]), 0) / 4 };   // a foot's lever round the body's centre
}
// The gait's numbers from a locomotion row (pipeline/locomotion.py), or from the body alone where a tile has none.
export function gaitParams(row, skel) {
  const h = row?.hip_m || skel.h, mass = row?.mass_kg || 90 * h * h * h;
  const vw = row?.walk_mps || Math.sqrt(0.5 * G * h), vt = row?.trot_mps || Math.sqrt(2.5 * G * h);
  const ft = row?.stride_hz || 4.19 * Math.pow(mass, -0.15), Lt = row?.stride_m || vt / ft;
  const gaits = row?.gaits || {};
  const T = row?.turn || {}, B = row?.bend || {};
  return { h, vw, vt, ft, Lt, pace: gaits.walk === 'amble', gallop: /rotary/.test(gaits.gallop || '') ? 'rotary' : 'transverse',
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
export function makeGait() {
  return { phase: 0, gait: 0, tk: 0, gk: 0, v: 0, tq: 0, rate: 0, duty: 0.7, L: 0.5, moving: false, lastX: NaN, lastZ: NaN,
    feet: LEG_NAMES.map(() => ({ x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, stance: true, s: 1, has: false, gy: 0, l: [0, 0, 0] })),
    gF: 0, gH: 0, gL: 0, gR: 0, bob: 0, crouch: 0, bed: 0, pitch: 0, roll: 0, flex: 0, headP: 0, lead: 0, tailYaw: 0, air: 0,
    P: null, E: null };
}

// ---- one frame -------------------------------------------------------------------------------------------------------
// inp: { x, y, z (the body's origin: on the ground between the feet, world), yaw (the drawn yaw), size, v (m/s, negative
// backing), wr (rad/s), pose (0..1: crouch to half, bedded at 1), flick (the head dip: 1 to the ground, negative alert),
// bend (rad: the spine's yaw bend toward the control yaw), twitch (the tail tip, -1..1), terrain(xw, zw) -> yw, air (true
// in a jump or a fall: the legs tuck) }
export function gaitStep(skel, P, st, inp, dt) {
  dt = Math.min(Math.max(dt, 0), 0.1);
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
  const table = st.gait === 2 ? FOOTFALL[P.gallop] : st.gait === 1 ? FOOTFALL[P.pace ? 'pace' : 'trot'] : FOOTFALL.walk;
  // the standing turn's hysteresis (as the deer's drive): over `on` rad/s it steps, until under `off` for `hold` s
  const aw = Math.abs(inp.wr || 0), still = v < 0.05 && !inp.air && (inp.pose || 0) < 0.5;
  if (still && aw > (st.tq > 0 ? P.turn.off : P.turn.on)) st.tq = P.turn.hold; else st.tq = still ? st.tq - dt : 0;
  const turning = st.tq > 0;
  // cadence and stride; the duty factor by the gait
  const { f, L } = cadence(P, Math.max(v, 0.05));
  const fTurn = turning ? clamp(aw * skel.rFoot / (0.3 * P.Lt), P.turn.hz[0], P.turn.hz[1]) : 0;
  const moving = v > 0.05 || turning;
  const rate = v > 0.05 ? Math.max(f, fTurn) : fTurn;
  const duty = st.gait === 2 ? 0.42 - 0.07 * clamp((v - P.vt) / P.vt, 0, 1) : st.gait === 1 ? 0.5 : 0.72 - 0.17 * clamp(v / P.vw, 0, 1);
  st.duty = damp(st.duty, duty, 8, dt); st.L = v > 0.05 ? L : 0.3 * P.Lt;
  st.moving = moving; st.rate = rate;
  if (moving) st.phase = (st.phase + rate * dt) % 1;
  const swingT = rate > 0.1 ? (1 - st.duty) / rate : 0.25;
  // the airborne body (a jump, a pounce): the feet tuck and are replanted on landing
  st.air = damp(st.air, inp.air ? 1 : 0, 10, dt);
  // ---- the feet ----
  const feet = st.feet, lf = new Array(4);
  const shoulderY = [R[J['UpperLeg.FL']][1], R[J['UpperLeg.FR']][1], R[J['UpperLeg.HL']][1], R[J['UpperLeg.HR']][1]];
  for (let i = 0; i < 4; i++) {
    const F = feet[i], Lg = skel.legs[i], toe = Lg.toe;
    if (!F.has || jumped) {   // place at rest
      const w = toWorld(toe); F.x = w[0]; F.z = w[2]; F.y = terrain(w[0], w[2]); F.stance = true; F.s = 1; F.has = true;
    }
    if (inp.air) { F.stance = false; F.s = 0; F.has = false; const l = lerp3(toe, [toe[0], 0.3 * shoulderY[i], toe[2] - 0.15 * Lg.a * fwd], st.air); lf[i] = l; F.l = l; continue; }
    const pf = ((st.phase - table[i]) % 1 + 1) % 1;
    const here = toLocal([F.x, F.y, F.z]);
    if (F.stance) {
      const late = here[2] * fwd < toe[2] * fwd - 0.75 * st.L;   // dragged well behind its rest: lift whatever the phase says
      if ((moving && pf >= st.duty && pf < st.duty + (1 - st.duty) * 0.6) || late) { F.stance = false; F.s = 0; F.lx = F.x; F.ly = F.y; F.lz = F.z; }
    }
    if (!F.stance) {
      if (moving) { const sp = pf >= st.duty ? (pf - st.duty) / (1 - st.duty) : 1; F.s = Math.max(F.s, Math.min(1, sp + dt / swingT)); }
      else F.s = Math.min(1, F.s + dt / Math.max(swingT, 0.12));
      // the plant point: the rest offset, half a stance ahead, in the body frame at touchdown (turned and moved on)
      const rem = (1 - F.s) * swingT, rot = (inp.wr || 0) * rem, dz = fwd * v * rem;
      const ahead = fwd * st.duty * st.L * 0.5 * (v > 0.05 ? 1 : 0);
      const c = Math.cos(rot), sn = Math.sin(rot), px = toe[0], pz = toe[2] + ahead;
      const tl = [c * px + sn * pz, 0, -sn * px + c * pz + dz];
      const tw = toWorld(tl); tw[1] = terrain(tw[0], tw[2]);
      const e = ease(F.s), lift = (0.35 * R[Lg.f][1] + 0.03 * st.L * (1 + 0.5 * st.gk)) * s * Math.sin(Math.PI * F.s);   // the swing's clearance: a third of the ankle's height and a little of the stride
      F.x = F.lx + (tw[0] - F.lx) * e; F.z = F.lz + (tw[2] - F.lz) * e;
      F.y = Math.max(F.ly + (tw[1] - F.ly) * e, terrain(F.x, F.z)) + lift;
      if (F.s >= 1) { F.stance = true; F.x = tw[0]; F.y = tw[1]; F.z = tw[2]; }
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
  const share = 0.8, ph = st.phase * TAU;
  // the bob: a walk vaults (highest mid-stance), a trot springs (lowest mid-stance), a gallop rises once a cycle
  const bobW = 0.02 * skel.h * Math.sin(2 * ph), bobT = -0.025 * skel.h * Math.cos(2 * ph), bobG = 0.05 * skel.h * Math.sin(ph + 0.6);
  st.bob = moving && !inp.air ? (bobW * (1 - st.tk) + bobT * st.tk) * (1 - st.gk) + bobG * st.gk : damp(st.bob, 0, 6, dt);
  // the crouch (pose to a half) and the bed (pose past it)
  const pose = clamp(inp.pose || 0, 0, 1);
  st.crouch = damp(st.crouch, clamp(pose * 2, 0, 1) * 0.3, 4, dt); st.bed = damp(st.bed, clamp((pose - 0.5) * 2, 0, 1), 3, dt);
  const legLen = R[J['UpperLeg.FL']][1], drop = st.crouch * legLen;
  const hipsRest = R[J.Hips], chestRest = R[J.Chest], spineRest = R[J.Spine];
  const yH = hipsRest[1] + st.gH * share - drop + st.bob, yC = chestRest[1] + st.gF * share - drop + st.bob;
  const pitch = Math.asin(clamp((yC - yH - (chestRest[1] - hipsRest[1])) / (chestRest[2] - hipsRest[2]), -0.9, 0.9));   // nose-up positive
  st.pitch = damp(st.pitch, pitch, 10, dt);
  const track = Math.abs(skel.legs[0].toe[0] - skel.legs[1].toe[0]) || 0.1;
  const supportL = (feet[0].stance ? 1 : 0) + (feet[2].stance ? 1 : 0), supportR = (feet[1].stance ? 1 : 0) + (feet[3].stance ? 1 : 0);
  const roll = Math.atan((st.gL - st.gR) / track) * 0.5 + (moving ? 0.03 * (supportL - supportR) * (1 - st.gk) : 0);   // onto the supporting side
  st.roll = damp(st.roll, roll, 6, dt);
  // the gallop's flexion: the back arched as the hind feet come under (gathered), extended as the fore feet reach
  st.flex = 0.14 * st.gk * Math.cos(ph) * (moving ? 1 : 0);
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
    const Lg = skel.legs[i], F = feet[i], toe = lf[i];
    // the foot bone: on its toe (digitigrade) or flat (plantigrade), flexed up in the swing
    let fv = Lg.foot;
    const swing = F.stance ? 0 : Math.sin(Math.PI * F.s);
    if (swing > 0) fv = apply3(rotX(-(P.posture === 'plantigrade' ? 0.6 : 0.35) * swing * (Lg.fore ? 1 : 0.6)), fv);
    const W = add(toe, fv);
    const d0 = sub(W, S[i]); let d = len(d0);
    const a = Lg.a, b = Lg.b, c = len(fv), dmax = (a + b) * 0.995, dmin = Math.abs(a - b) + 0.01;
    let u = scale(d0, 1 / (d || 1));
    let Ek, Wk, toeK;
    if (d > dmax) {   // out of reach: the leg straightens toward its toe, the foot bone continuing the line (an extended reach)
      const dt0 = sub(toe, S[i]), dl = len(dt0); u = scale(dt0, 1 / (dl || 1));
      const reach = Math.min(dl, a + b + 0.85 * c);
      Ek = add(S[i], scale(u, a)); Wk = add(S[i], scale(u, a + b)); toeK = add(S[i], scale(u, reach));
    } else {
      if (d < dmin) d = dmin;
      const ca = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), al = Math.acos(ca);
      let bd = [0, 0, Lg.bend]; bd = sub(bd, scale(u, dot(bd, u))); const bl = len(bd); bd = bl > 1e-4 ? scale(bd, 1 / bl) : [0, 0, Lg.bend];
      Ek = add(S[i], add(scale(u, a * Math.cos(al)), scale(bd, a * Math.sin(al))));
      Wk = add(S[i], scale(u, d)); toeK = add(Wk, scale(fv, -1));
    }
    Pj[Lg.u] = S[i]; Pj[Lg.l] = Ek; Pj[Lg.f] = Wk; E[Lg.f] = toeK;
  }
  // ---- the head: level over the stride, dipped by the flick, leading a turn ----
  const dip = (inp.flick || 0) * 0.9, lead = clamp((inp.wr || 0) * P.lead, -P.leadMax, P.leadMax);
  st.lead = damp(st.lead, lead, 8, dt);
  const headBob = moving ? 0.03 * Math.sin(2 * ph) * (1 - st.gk) : 0;
  const Rn = mul3(RB, rotX(dip * 0.6 + 0.4 * (st.pitch + st.flex)));                       // the neck: down with the dip, countering the chest
  const Rh = mul3(mul3(RB, rotY(st.lead)), rotX(dip * 0.5 + 0.5 * (st.pitch + st.flex) + headBob));
  const Phd = add(Pn0, apply3(Rn, sub(R[J.Head], R[J.Neck])));
  const nose = add(Phd, apply3(Rh, sub(skel.nose, R[J.Head])));
  Pj[J.Neck] = Pn0; Pj[J.Head] = Phd; E[J.Head] = nose;
  // ---- the tail: lags the turn, swings with the gallop, lifted by the flick, the tip twitched ----
  st.tailYaw = damp(st.tailYaw, -(inp.wr || 0) * 0.25, 5, dt);
  const swingT_ = 0.25 * st.gk * Math.sin(ph + 1.0), liftT = Math.max(0, inp.flick || 0) * 0.35;
  const Pt1 = at(R[J.Tail1], RA, Ph, hipsRest);
  let Rt = mul3(RA, mul3(rotY(st.tailYaw), rotX(-(liftT + swingT_))));
  const Pt2 = add(Pt1, apply3(Rt, sub(R[J.Tail2], R[J.Tail1])));
  Rt = mul3(Rt, mul3(rotY(st.tailYaw), rotX(-swingT_ * 0.6)));
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
  for (let j = 0; j < skel.n; j++) {
    const name = skel.names[j];
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
    const q = R[j], p = P[j];
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
export function farTable(skin, P) {
  const C = skin.clip, T = skin.table, pick = n => C[n] ?? C.Idle ?? 0;
  return { idle: pick('Idle'), walk: pick('Walk'), trot: pick('Trot'), gallop: pick('Gallop'), bed: pick('Bed'), T, vw: P.vw, vt: P.vt };
}
export function makeFar() { return { cur: -1, prev: 0, pA: 0, pB: 0, blend: 0, tBlend: 0.3, kind: '' }; }
export function farDrive(st, F, v, pose, dt, out, o) {
  v = Math.abs(v || 0);
  let kind = pose > 0.5 ? 'bed' : v < 0.05 ? 'idle' : v < F.vw * (st.kind === 'trot' ? 0.92 : 1.05) ? 'walk' : v < F.vt * (st.kind === 'gallop' ? 0.9 : 1.05) ? 'trot' : 'gallop';
  if (kind !== st.kind) {
    const next = F[kind];
    if (st.cur >= 0 && next !== st.cur) {
      st.prev = st.cur; st.pB = st.pA; st.blend = 1; st.tBlend = kind === 'bed' || st.kind === 'bed' ? 0.8 : 0.3;
      const a = F.T[st.cur], b = F.T[next];
      st.pA = a.stride_m && b.stride_m ? ((st.pA - (a.touchdown || 0) + (b.touchdown || 0)) % 1 + 1) % 1 : st.pA;
    } else if (st.cur < 0) st.blend = 0;
    st.cur = next; st.kind = kind;
  }
  const rate = c => c.stride_m ? clamp(v / c.stride_m, 0.3 / (c.duration || 1), 1.6 / (c.duration || 1)) : 0;
  st.pA = (st.pA + dt * rate(F.T[st.cur])) % 1;
  if (st.blend > 0) { st.pB = (st.pB + dt * rate(F.T[st.prev])) % 1; st.blend = Math.max(0, st.blend - dt / st.tBlend); }
  const w = st.blend * st.blend * (3 - 2 * st.blend);
  out[o * 4] = st.cur; out[o * 4 + 1] = st.pA; out[o * 4 + 2] = st.prev + Math.min(st.pB, 0.9999); out[o * 4 + 3] = w;
}

// A live row's aClip: the row in the first slot, flagged negative (the shader reads the pose texture), nothing blended.
export function liveClip(row, out, o) { out[o * 4] = -1 - row; out[o * 4 + 1] = 0; out[o * 4 + 2] = 0; out[o * 4 + 3] = 0; }

// The feet's world points (for the debug markers): [x, y, z, stance] per foot.
export function footPoints(st) { return st.feet.map(F => [F.x, F.y, F.z, F.stance ? 1 : 0]); }
