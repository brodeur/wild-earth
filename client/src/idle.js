// The idle layer of the leg engine (gait.js): what a body that stands, feeds or lies keeps doing (Aaron, 2026-11-11:
// "species-appropriate idle behaviors"; judged by whether the animal feels alive: tremor or looping reads as fake). Every
// number is in the taxonomy tree's `idle` block (library/animals/locomotion.json: Mammalia, and Artiodactyla, Cervidae,
// Carnivora, Canidae, Felidae, Ursidae, Lagomorpha where they differ), each with its source or "by eye" in the block's
// note; a locomotion row carries only what its taxon says differently from Mammalia's (pipeline/locomotion.py), and the
// default here, IDLE, is Mammalia's block (tests/test_locomotion_idle.py holds the two equal).
//
// Two tiers, both functions of the body's seed (P.ind.seed) and a clock (inp.t, seconds: legs.js keeps one a pool):
//   tier 1, always on
//     breathing   the chest (and a little of the spine) swells and settles, a scale on the joints' rotation about their
//                 own heads (gait.js writeRow), at Stahl's rate from the body's mass; quicker and deeper after running (a
//                 debt filled by the engine's own recent speed, paid back over a time that grows with mass)
//     weight      standing, the hips drift over one hind foot and back on a slow clock; the other hind leg eases
//     the gaze    a standing body looks somewhere, holds, looks somewhere else: quick turns and holds (min-jerk turns, held
//                 fixations drawn log-normally); a caller's world point (inp.look) wins. Feeding (the caller's flick over a
//                 half), the head comes up from the feed at intervals and goes down again (vigilance). Not while alert
//                 (flick below 0); bedded, a part of the turn and none of the bedded pose's own head
//     the tail    by family: a still tail (the class), the ungulates' switch, the canids' low carriage, the cats' tip
//     rumination  bedded ruminants chew in runs with a pause between; no jaw yet, so the small nod a jaw's work gives the head
//   tier 2, acts the body performs now and then, one at a time, scheduled by the director
//     shake, scratch, stretch (the bow), sit (on the haunches), sniff (to the ground, or up into the wind), stamp, groom,
//     the hares' face wash. Each is a short procedural motion built from the engine's own means (a foot's reach by IK
//     while the other three stay planted, the crouch, the head and neck, a twist of the skin along the spine)
// The director: per taxon a repertoire, each act with a share of idle time or a rate an hour and its bout length (log-
// normal: median and sigma); the gaps between acts are log-normal too (Tolkamp & Kyriazakis 1999: intervals between
// cattle's feeding bouts are log-normal, not exponential). All of it is read from (seed, clock): the timeline is cut into
// epochs, each epoch's acts drawn from the seed and the epoch's index alone, an act running over an epoch's end deleting
// those of the next it would overlap. So the same body does the same things on every page whose clock agrees. An act
// runs only while the body is in the state it needs (standing); it yields when the body starts to move or the caller's
// state changes, ramping out, never popping, and does not come back.
//
// Callers (gaitStep's inp): t (seconds), look ([x, y, z] world, or null), sit (0..1: on the haunches; Carnivora's and
// any caller's), act (the name of an act to play now, once: the lineup's &act=, a later attention lane; 'none': no acts).
// Output: st.id.D, read by gait.js gaitStep and hopStep. Off when the body is not an individual (P.ind null: the bake).

const TAU = Math.PI * 2;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const mj = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 + u * (-15 + 6 * u));   // a minimum-jerk step (Flash & Hogan): peak rate 1.875 / its time
const env = (t, t0, t1, a, b) => Math.min(mj((t - t0) / a), mj((t1 - t) / b));   // up over a, down over b, inside [t0, t1]
// an integer hash of (seed, channel, index) to [0, 1) (gait.js h32's, kept here so the two modules import one way)
function hh(seed, ch, k) {
  let h = (seed ^ Math.imul(ch + 0x9e3779b9 | 0, 0x85ebca6b) ^ Math.imul(k + 0x7f4a7c15 | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const gz = (seed, ch, k) => (hh(seed, ch, k) + hh(seed, ch, k + 7919) + hh(seed, ch, k + 15838) - 1.5) * 2;   // near normal, unit variance
const lnDraw = (seed, ch, k, m) => m[0] * Math.exp(m[1] * clamp(gz(seed, ch, k), -2.5, 2.5));                 // log-normal: [median, sigma]
const lnMean = m => m[0] * Math.exp(m[1] * m[1] / 2);

// The tree's Mammalia block (library/animals/locomotion.json `idle`, without its note). A row's block wins key by key.
export const IDLE = {
  breath: { per_min_at_1kg: 53.5, mass_exp: -0.26, cv: 0.08, inhale: 0.42, chest: [0.03, 0.022], spine: 0.4, debt: { fill_s: 10, tau_s_at_50kg: 45, mass_exp: 0.25, rate: 1.6, depth: 1.2 } },
  weight: { shift: 0.25, drop: 0.035, roll: 0.035, hold_s: [14, 0.5], change_s: 1.8, square: 0.3 },
  look: { yaw: 0.9, pitch: [-0.3, 0.25], ahead: 0.3, hold_s: [2.2, 0.6], turn_s_at_50kg: 0.4, turn_exp: 0.15, neck: 0.45, bed: 0.6, feed: { every_s: [9, 0.6], up_s: [2.5, 0.4], rise_s: 0.5 } },
  tail: { style: "still" },
  sit: { trunk_deg: 45, seat: 0.22 },
  ears: { swivel: 0.6, range: 1.2, lead_s: 0.3, lead_k: 0.8, hold_s: [2.5, 0.6], turn_s: 0.12, back: 0.35, flick: { per_min: 2, s: 0.16, amp: 0.2 }, flat: 1.0, alert: 0.25, bed: [0.35, -0.15], rest: [0, 0] },
  gap_sigma: 1.0,
  acts: { shake: { per_h: 0.5, bout_s: [1.1, 0.2], hz_at_1kg: 9.5, hz_exp: -0.22 }, sniff: { per_h: 6, bout_s: [5, 0.4], up: 0 } },
  ruminate: false
};
function merge(a, b) {
  const o = { ...a };
  for (const k in b) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], b[k]) : b[k];
  return o;
}
export const idleOf = v => v ? merge(IDLE, v) : IDLE;

// The director's table for an individual (cached on P): each act's rate a second, its bout's [median, sigma] and mean,
// its share of idle time; the gap between acts so the shares come out as the tree's: with total rate R and share S the
// mean gap is (1 - S) / R.
export const ACTS = ['shake', 'scratch', 'stretch', 'sit', 'sniff', 'stamp', 'groom', 'wash'];
// The capability gate (docs/behaviour-rig.md "What makes it reliable"): an act names what the skeleton must have for it to
// look right (the tree's `needs`: neck_joints, at least so many joints in the neck; reach_neck, the hind toe brought by the
// engine's IK within that share of the withers' height of its mark beside the neck), tested once a skeleton (gait.js
// capsOf: P._caps). An act a skeleton cannot do leaves the repertoire and its share goes to standing; the tree's shares
// stay as nature has them.
export function canDo(c, caps) {
  if (!c.needs || !caps) return true;
  for (const k in c.needs) { const v = c.needs[k], have = caps[k]; if (have == null || (k.startsWith('reach_') ? !(have <= v) : !(have >= v))) return false; }
  return true;
}
export function directorOf(P) {
  if (Object.prototype.hasOwnProperty.call(P, '_idleK') && P._idleK && P._idleK.caps === P._caps) return P._idleK;   // (made again once the skeleton's capabilities are known)
  const I = P.idle, list = [], gone = [];
  for (const name of ACTS) {
    const c = I.acts?.[name]; if (!c || !c.bout_s) continue;
    if (!P._noGate && !canDo(c, P._caps)) { gone.push(name); continue; }
    const mean = lnMean(c.bout_s), rate = c.share != null ? c.share / mean : (c.per_h || 0) / 3600;
    if (rate > 0) list.push({ name, c, mean, rate, share: rate * mean });
  }
  const R = list.reduce((s, a) => s + a.rate, 0), S = list.reduce((s, a) => s + a.share, 0);
  let acc = 0; for (const a of list) { acc += a.rate / (R || 1); a.cum = acc; }
  const sg = I.gap_sigma ?? 1, G = R > 0 ? Math.max(1, (1 - Math.min(S, 0.9)) / R) : Infinity;
  const mass = P.mass || 30;
  return (P._idleK = { list, gone, caps: P._caps, R, S, gap: [G * Math.exp(-sg * sg / 2), sg], E: Math.max(1800, 8 * Math.max(0, ...list.map(a => a.mean))),
    shakeHz: (I.acts?.shake?.hz_at_1kg || 9.5) * Math.pow(mass, I.acts?.shake?.hz_exp ?? -0.22),
    breathHz: I.breath.per_min_at_1kg * Math.pow(mass, I.breath.mass_exp) / 60,
    tau: I.breath.debt.tau_s_at_50kg * Math.pow(mass / 50, I.breath.debt.mass_exp),
    turn: I.look.turn_s_at_50kg * Math.pow(mass / 50, I.look.turn_exp) });
}

// ---- the timelines: epochs of E seconds, each drawn from (seed, channel, epoch) alone ---------------------------------
// A list per epoch, cached (the last four). gen(k) returns the epoch's events sorted by t0 (absolute seconds).
function epochOf(C, k, gen) {
  let L = C.get(k); if (L) return L;
  L = gen(k); C.set(k, L);
  if (C.size > 5) C.delete(C.keys().next().value);
  return L;
}
// the event in force at t: the last with t0 <= t, from this epoch or the one before (null: none yet)
function lastAt(C, E, t, gen) {
  const H = C.hit; if (H && t >= H.a && t < H.b) return H.r;   // (the answer holds till the next event: kept)
  const k = Math.floor(t / E); let L = epochOf(C, k, gen), r = null, b = (k + 1) * E;
  for (let i = L.length - 1; i >= 0; i--) if (L[i].t0 <= t) { r = [L[i], L[i - 1] || lastOf(C, k - 1, gen)]; break; } else b = L[i].t0;
  if (!r) { const P = epochOf(C, k - 1, gen); r = [P[P.length - 1] || null, P[P.length - 2] || lastOf(C, k - 2, gen)]; }   // (none yet in this epoch: the last of the one before, and the one before that)
  C.hit = { a: r[0] ? Math.max(r[0].t0, k * E) : k * E, b, r };
  return r;
}
function lastOf(C, k, gen) { const L = epochOf(C, k, gen); return L[L.length - 1] || null; }

const CH = { act: 0x1d00, look: 0x1e00, feed: 0x1f00, wt: 0x2000, tail: 0x2100, rum: 0x2200, br: 0x2300, ear: 0x2400 };
// the acts' raw epoch (each act: t0, t1, its index in the director's list, a side, a draw)
function actsRaw(seed, K, k) {
  const out = [], E = K.E; let t = k * E;
  if (!K.list.length) return out;
  for (let n = 0; n < 512; n++) {
    t += lnDraw(seed, CH.act, k * 4096 + n * 4, K.gap); if (t >= (k + 1) * E) break;
    const u = hh(seed, CH.act + 1, k * 4096 + n), a = K.list.findIndex(x => u < x.cum), A = K.list[a < 0 ? K.list.length - 1 : a];
    const d = Math.max(0.6, lnDraw(seed, CH.act + 2, k * 4096 + n, A.c.bout_s));
    out.push({ t0: t, t1: t + d, a: A, side: hh(seed, CH.act + 3, k * 4096 + n) < 0.5 ? -1 : 1, u: hh(seed, CH.act + 4, k * 4096 + n) });
    t += d;
  }
  return out;
}
// the acts in force: an act that runs over its epoch's end deletes the next epoch's acts it would overlap
function actsEff(S, seed, K, k) {
  let L = S.actE.get(k); if (L) return L;
  const raw = j => epochOf(S.actR, j, j2 => actsRaw(seed, K, j2)), prev = raw(k - 1), end = prev.length ? prev[prev.length - 1].t1 : -Infinity;
  L = raw(k).filter(e => e.t0 >= end); S.actE.set(k, L); if (S.actE.size > 3) S.actE.delete(S.actE.keys().next().value);
  return L;
}
// the act at t (the director's own; null: none)
export function actAt(S, seed, K, t) {
  const k = Math.floor(t / K.E), L = actsEff(S, seed, K, k);
  for (let i = 0; i < L.length; i++) { if (L[i].t0 > t) break; if (t < L[i].t1) return L[i]; }
  const P = actsEff(S, seed, K, k - 1), e = P[P.length - 1];
  return e && t < e.t1 && e.t0 <= t ? e : null;
}

export function makeIdle() {
  return { actR: new Map(), actE: new Map(), lookC: new Map(), feedC: new Map(), wtC: new Map(), tailC: new Map(), rumC: new Map(),
    cur: null, gate: 0, lastW: 0, dead: false, forced: null, lastForced: -1e9, debt: 0, bph: -1, bn: 0, bk: 1, on: 0, lookOn: 0, bedK: 0, sitK: 0,
    ly: { y: 0, v: 0 }, lp: { y: 0, v: 0 }, t: 0, tOwn: 0,
    D: { on: 0, busy: 0, act: '', br: 0, sit: 0, hD: 0, cD: 0, hz: 0, wx: 0, rollH: 0, eased: -1, ew: 0, yaw: 0, pitch: 0, roll: 0, bend: 0, sniff: 0, feedMul: 1,
      tw: 0, twT: 0, twF: 0, lift: -1, lw: 0, lt: [0, 0, 0], ltN: [0, 0, 0], lflex: 0, lneck: 0, rake: 0, paws: 0, pawPh: 0, tYaw: 0, tPitch: 0, twitch: 0, nod: 0, bedYaw: 0 } };
}

// ---- one frame --------------------------------------------------------------------------------------------------------
// skel, P (the individual: P.ind, P.idle), st (the engine's state; st.id is the layer's), inp (gaitStep's), dt;
// c: { moving, v (the engine's damped speed), bed (0..1), hop (a lagomorph), lookL (inp.look in the body's frame) }.
// Returns D, or null when there is nothing to draw (moving, every weight run out): the engine then does nothing more.
export function idleStep(skel, P, st, inp, dt, c) {
  const S = st.id || (st.id = makeIdle()), I = P.idle, seed = P.ind.seed, K = directorOf(P), D = S.D;
  const t = inp.t >= 0 ? inp.t : (S.tOwn += dt);
  // the breath's debt: filled toward the share of a gallop the body runs at, paid back over tau
  const load = clamp((c.v - P.vw) / Math.max(0.1, 1.6 * P.vt - P.vw), 0, 1), B = I.breath;
  S.debt = load > S.debt ? S.debt + (load - S.debt) * Math.min(1, dt / B.debt.fill_s) : S.debt * Math.exp(-dt / K.tau);
  const flick = inp.flick || 0, pose = inp.pose || 0;
  const standing = !c.moving && !inp.air && (c.hop ? pose < 0.3 && pose > -0.3 : pose < 0.25) && c.bed < 0.1;
  S.on = damp(S.on, !c.moving && !inp.air ? 1 : 0, c.moving ? 8 : 3, dt);
  S.bedK = c.bed;
  const wantSit = clamp(inp.sit || 0, 0, 1); c.sitIn = wantSit;
  if (c.moving && S.on < 0.002 && S.gate < 0.002 && S.sitK < 0.002 && S.lookOn < 0.002 && !wantSit && !c.lookL) { D.on = 0; S.cur = null; return null; }
  D.on = S.on;
  // ---- breathing ----
  if (S.bph < 0) S.bph = hh(seed, CH.br, 0);   // each body breathes in its own phase
  const hz = K.breathHz * (1 + B.debt.rate * S.debt) * S.bk;
  S.bph += hz * dt;
  if (S.bph >= 1) { S.bph -= Math.floor(S.bph); S.bn++; S.bk = 1 + B.cv * clamp(gz(seed, CH.br, S.bn), -2.5, 2.5); }   // each breath its own length
  const fi = B.inhale, ph = S.bph, wave = ph < fi ? mj(ph / fi) : 1 - mj((ph - fi) / (1 - fi));
  D.br = wave * (1 + B.debt.depth * S.debt) * S.on;
  // reset the channels
  D.busy = 0; D.act = ''; D.sit = 0; D.hD = 0; D.cD = 0; D.hz = 0; D.wx = 0; D.rollH = 0; D.eased = -1; D.ew = 0; D.roll = 0; D.bend = 0; D.sniff = 0; D.feedMul = 1;
  D.tw = 0; D.troll = 0; D.lift = -1; D.lw = 0; D.lflex = 0; D.lneck = 0; D.rake = 0; D.paws = 0; D.tYaw = 0; D.tPitch = 0; D.twitch = 0; D.nod = 0; D.bedYaw = 0;
  // ---- the act: the director's, or a caller's (inp.act) ----
  let e = null;
  // (a caller's act waits for the act under way to yield and ramp out: one act at a time, nothing pops)
  const ask = inp.act && ACTS.includes(inp.act) && (!S.forced || S.forced.a.name !== inp.act) && t - S.lastForced > 1.5;
  if (ask && S.lastW > 0.01) S.dead = true;
  else if (ask) {
    const A = K.list.find(x => x.name === inp.act) || (K.gone.includes(inp.act) ? null : { name: inp.act, c: I.acts?.[inp.act] || { bout_s: [3, 0] }, mean: 3 });
    if (A) S.forced = { t0: t, t1: t + Math.max(1, A.c.bout_s ? A.c.bout_s[0] : 3), a: A, side: hh(seed, 0x77, Math.floor(t)) < 0.5 ? -1 : 1, u: hh(seed, 0x78, Math.floor(t)) };
  }
  if (S.forced && t >= S.forced.t1) { S.lastForced = t; S.forced = null; }
  e = inp.act === 'none' ? null : S.forced || actAt(S, seed, K, t);   // ('none': a caller wants no acts)
  if (e !== S.cur) { S.cur = e; S.tIn = t; const ok = e && okFor(e.a, standing, flick, pose, c); S.gate = ok ? 1 : 0; S.dead = !ok; }
  else if (e && !S.dead && !okFor(e.a, standing, flick, pose, c)) S.dead = true;     // the body moved, or the caller's state changed: yield
  if (S.dead) S.gate = damp(S.gate, 0, 8, dt);
  let w = 0;
  if (e && S.gate > 0.001) {
    const a = e.a.name, ramp = a === 'sit' ? 0.9 : a === 'shake' ? 0.15 : 0.35;
    w = Math.min(env(t, e.t0, e.t1, ramp, a === 'shake' ? 0.3 : ramp), mj((t - S.tIn) / ramp)) * S.gate;   // (an act met already under way, on a page's first frame or after a caller's, ramps in from then)
    if (w > 0.0005) actPose(skel, P, D, e, t - e.t0, e.t1 - e.t0, w, K, c);
  }
  D.busy = w; S.lastW = w;
  // ---- the sit: the act's, or the caller's ----
  // (up off the haunches quickly when the body goes)
  D.sitGoal = c.moving ? 0 : Math.max(wantSit, D.sit || 0);
  S.sitK = damp(S.sitK, D.sitGoal, c.moving ? 8 : 3, dt); D.sit = S.sitK < 0.001 ? 0 : S.sitK;
  // ---- the gaze ----
  const L = I.look, scanOn = !c.hop && (standing || c.bed > 0.5 || D.sit > 0.3) && flick >= 0;
  S.lookOn = damp(S.lookOn, scanOn || c.lookL ? 1 : 0, 6, dt);
  let yaw = 0, pitch = 0;
  if (c.lookL) {   // a caller's point: turned to quickly (a near-critical spring), held at the neck's reach
    const H = skel.rest[skel.idx.Head], dx = c.lookL[0] - H[0], dz = c.lookL[2] - H[2];
    const ty = clamp(Math.atan2(dx, dz), -1.6 * L.yaw, 1.6 * L.yaw), tp = clamp(Math.atan2(c.lookL[1] - H[1], Math.hypot(dx, dz)), -0.6, 0.6);
    const wl = TAU / (2.2 * K.turn); S.lyT = ty; spring(S.ly, ty, wl, dt); spring(S.lp, tp, wl, dt); yaw = S.ly.y; pitch = S.lp.y;
  } else if (S.lookOn > 0.001) {
    const g = gazeAt(S.lookC, seed, K, L, t); yaw = g[0]; pitch = g[1]; S.gRaw = yaw;
    S.ly.y = yaw; S.ly.v = 0; S.lp.y = pitch; S.lp.v = 0;
    yaw *= S.lookOn; pitch *= S.lookOn;
    if (flick > 0.5) {   // feeding: the head comes up at intervals and the scan is only while it is up
      const [v] = lastAt(S.feedC, 300, t, k => feedGen(seed, L.feed, k)), up = v && t < v.t1 ? env(t, v.t0, v.t1, L.feed.rise_s, L.feed.rise_s) : 0;
      D.feedMul = 1 - up; yaw *= up; pitch *= up;
    }
  }
  if (c.bed > 0.5) { D.bedYaw = yaw * L.bed; yaw *= 1 - c.bed; pitch *= 1 - c.bed; }
  D.yaw = yaw * (1 - w * (D.ownHead || 0)) + (D.ownHead ? D.yaw : 0); D.pitch = pitch * (1 - w * (D.ownHead || 0)) + (D.ownHead ? D.pitch : 0); D.ownHead = 0;
  // ---- the weight: over one hind foot and back ----
  if (!c.hop && standing && S.on > 0.01) {
    const W = I.weight, [g, g0] = lastAt(S.wtC, 600, t, k => weightGen(seed, W, k));
    const side = g ? (g0 ? g0.side : 0) + (g.side - (g0 ? g0.side : 0)) * mj((t - g.t0) / W.change_s) : 0, k = side * S.on * (1 - w);
    const hx = Math.abs(skel.legs[2].toe[0]);
    D.wx += k * W.shift * hx; D.rollH += k * W.roll; D.eased = k > 0 ? 3 : 2; D.ew = Math.abs(k) * W.drop;   // + : over the left hind (+x), the right hind eased
  }
  // ---- the tail ----
  const T = I.tail;
  if (T && T.style !== 'still' && S.on > 0.01 && !c.hop) {
    if (T.style === 'low') D.tPitch -= T.droop * S.on * (1 - c.bed);
    else if (T.style === 'switch' || T.style === 'twitch') {
      const [v] = lastAt(S.tailC, 300, t, k => tailGen(seed, T, k));
      if (v && t < v.t1) {
        const q = (t - v.t0) / (T.flick_s || T.twitch_s), n = Math.floor(q), u = q - n;
        if (T.style === 'switch') { D.tYaw += (n % 2 ? -1 : 1) * v.side * T.yaw * Math.sin(Math.PI * u) * S.on; D.tPitch += 0.15 * Math.sin(Math.PI * u) * S.on; }
        else D.twitch += T.amp * Math.sin(TAU * u) * v.side * S.on;
      }
    }
  }
  // ---- rumination, bedded: the jaw's work as a small nod of the head ----
  const RU = I.ruminate;
  if (RU && RU.chew_hz && c.bed > 0.5) {
    const [b] = lastAt(S.rumC, 600, t, k => rumGen(seed, RU, k));
    if (b && t < b.t1) { const q = (t - b.t0) * RU.chew_hz; D.nod = RU.nod * (0.5 - 0.5 * Math.cos(TAU * q)) * env(t, b.t0, b.t1, 0.5, 0.5) * c.bed; }
  }
  // ---- the ears (a skeleton with ears; the tree's `ears`) ----
  if (skel.ears && I.ears) earsOf(skel, P, S, D, I, K, seed, t, c, flick);
  return D;
}
// the scan's yaw and pitch at t (the fixation in force, turned to over its time; before any weight)
function gazeAt(C, seed, K, L, t) {
  const [f, f0] = lastAt(C, 120, t, k => lookGen(seed, K, L, k));
  if (!f) return [0, 0];
  const u = mj((t - f.t0) / f.T), y0 = f0 ? f0.yaw : 0, p0 = f0 ? f0.pitch : 0;
  return [y0 + (f.yaw - y0) * u, p0 + (f.pitch - p0) * u];
}
// The ears, by cause (D.ear[e] = [swivel, pitch, roll] in the head's frame, rad; e 0 the left): they point where the animal
// attends, leading the gaze (both turn toward the next fixation lead_s before the head does, and come back as the head
// arrives; a caller's point, toward it); when nothing holds the attention each wanders on its own clock (one forward and
// one turned out or back); a quick flick now and then; forward and still in the alert (flick below 0), turned out and
// down a little bedded. Flat back in the shake here and in the gallop by the engine (gait.js earsPose), which draws them.
function earsOf(skel, P, S, D, I, K, seed, t, c, flick) {
  const E = I.ears, A = D.ear || (D.ear = [[0, 0, 0], [0, 0, 0]]), alert = flick < 0 ? Math.min(1, -flick * 2) : 0, on = S.on;
  let lead = 0;
  if (c.lookL) lead = (S.lyT ?? 0) - S.ly.y;
  else if (S.lookOn > 0.01 && !c.hop) lead = (gazeAt(S.lookC2 || (S.lookC2 = new Map()), seed, K, I.look, t + E.lead_s)[0] - (S.gRaw || 0)) * S.lookOn;
  const held = Math.min(1, Math.abs(lead) / 0.3);   // (a coming turn holds the attention: the wander gives way)
  for (let e = 0; e < 2; e++) {
    const sx = e ? -1 : 1, C = e ? (S.earC1 || (S.earC1 = new Map())) : (S.earC0 || (S.earC0 = new Map()));
    const [f, f0] = lastAt(C, 120, t, k => earGen(seed, E, k, e, sx)), u = f ? mj((t - f.t0) / E.turn_s) : 0;
    const wsw = f ? (f0 ? f0.sw : 0) + (f.sw - (f0 ? f0.sw : 0)) * u : 0, wp = f ? (f0 ? f0.p : 0) + (f.p - (f0 ? f0.p : 0)) * u : 0;
    const free = (1 - held) * (1 - alert);
    let sw = clamp(E.lead_k * lead, -E.range, E.range) + wsw * free, p = E.rest[0] + wp * free + E.alert * alert, r = E.rest[1];
    const [q] = lastAt(e ? (S.flkC1 || (S.flkC1 = new Map())) : (S.flkC0 || (S.flkC0 = new Map())), 300, t, k => flickGen(seed, E.flick, k, e));
    if (q && t < q.t1) { const s = Math.sin(Math.PI * (t - q.t0) / E.flick.s); p += E.flick.amp * s * (1 - alert); r += 0.5 * E.flick.amp * s * (1 - alert); }
    if (c.bed > 0.5) { r += E.bed[0] * c.bed; p += E.bed[1] * c.bed; }
    const flat = D.tw || 0; sw *= 1 - flat; p += (-E.flat - p) * flat;
    A[e][0] = clamp(sw, -E.range, E.range) * on; A[e][1] = clamp(p, -E.flat, E.alert + E.flick.amp) * on; A[e][2] = r * on;
  }
}
function earGen(seed, E, k, e, sx) {   // each ear's own holds: a share turned out to its side or back, the rest about forward
  const out = []; let t = k * 120 + Math.max(E.turn_s + 0.3, lnDraw(seed, CH.ear + e, k * 1024, E.hold_s) * hh(seed, CH.ear + 4 + e, k));
  for (let n = 0; n < 300 && t < (k + 1) * 120; n++) {
    const i = k * 1024 + n, back = hh(seed, CH.ear + 8 + e, i) < E.back, v = hh(seed, CH.ear + 12 + e, i);
    out.push({ t0: t, sw: back ? sx * E.swivel * (0.5 + 0.5 * v) : E.swivel * 0.3 * (2 * v - 1), p: back ? -0.35 * E.swivel : 0.08 * (2 * v - 1) });
    t += Math.max(E.turn_s + 0.3, lnDraw(seed, CH.ear + 16 + e, i, E.hold_s));
  }
  return out;
}
function flickGen(seed, F, k, e) {
  const out = []; let t = k * 300; const m = [60 / Math.max(F.per_min, 1e-3), 0.8];
  for (let n = 0; n < 400; n++) { const i = k * 1024 + n; t += lnDraw(seed, CH.ear + 20 + e, i, m); if (t + F.s >= (k + 1) * 300) break; out.push({ t0: t, t1: t + F.s }); }
  return out;
}
function spring(Sp, x, w, dt) { const n = Math.max(1, Math.ceil(dt * w / 0.35)), h = dt / n; for (let i = 0; i < n; i++) { Sp.v += (w * w * (x - Sp.y) - 2 * 0.9 * w * Sp.v) * h; Sp.y += Sp.v * h; } }
// the state an act needs: every act is a standing act (the groom of a cat sits as part of it)
// (sitting at a caller's word, only what a sitting body does: the shake, the groom)
function okFor(A, standing, flick, pose, c) { return standing && flick <= 0.5 && flick >= 0 && !(c.sitIn > 0.3 && A.name !== 'shake' && A.name !== 'groom'); }

// the fixations: each a target (yaw, pitch) turned to over T seconds and held till the next. A share straight ahead;
// the rest out to either side; the turn's time from the body's mass and the size of the turn
function lookGen(seed, K, L, k) {
  const out = []; let t = k * 120 + Math.max(1.2 * K.turn + 0.4, lnDraw(seed, CH.look, k * 1024, L.hold_s) * hh(seed, CH.look + 5, k));   // (clear of a turn the epoch before began)
  let yPrev = 0;
  for (let n = 0; n < 200 && t < (k + 1) * 120; n++) {
    const i = k * 1024 + n, ahead = hh(seed, CH.look + 1, i) < L.ahead;
    const yaw = ahead ? 0.12 * (hh(seed, CH.look + 2, i) * 2 - 1) * L.yaw : (hh(seed, CH.look + 2, i) < 0.5 ? -1 : 1) * L.yaw * (0.3 + 0.7 * hh(seed, CH.look + 3, i));
    const pitch = L.pitch[0] + (L.pitch[1] - L.pitch[0]) * (0.5 + 0.5 * (hh(seed, CH.look + 4, i) + hh(seed, CH.look + 6, i) - 1));
    const T = K.turn * (0.6 + 0.6 * Math.min(1, Math.abs(yaw - yPrev) / L.yaw));
    out.push({ t0: t, yaw, pitch, T }); yPrev = yaw;
    t += Math.max(T + 0.4, lnDraw(seed, CH.look + 7, i, L.hold_s));
  }
  return out;
}
function feedGen(seed, F, k) {
  const out = []; let t = k * 300;
  for (let n = 0; n < 200; n++) { const i = k * 1024 + n; t += lnDraw(seed, CH.feed, i, F.every_s); const d = Math.max(2 * F.rise_s + 0.3, lnDraw(seed, CH.feed + 1, i, F.up_s)); if (t + d >= (k + 1) * 300) break; out.push({ t0: t, t1: t + d }); t += d; }
  return out;
}
function weightGen(seed, W, k) {
  const out = []; let t = k * 600 + Math.max(W.change_s + 1, lnDraw(seed, CH.wt, k * 1024, W.hold_s) * hh(seed, CH.wt + 3, k)), last = 0;
  for (let n = 0; n < 200 && t < (k + 1) * 600; n++) {
    const i = k * 1024 + n, u = hh(seed, CH.wt + 1, i);
    let side = u < W.square ? 0 : u < W.square + (1 - W.square) / 2 ? -1 : 1; if (side === last) side = last === 0 ? (u < 0.5 ? 1 : -1) : 0;
    out.push({ t0: t, side }); last = side; t += Math.max(W.change_s + 1, lnDraw(seed, CH.wt + 2, i, W.hold_s));
  }
  return out;
}
function tailGen(seed, T, k) {
  const out = []; let t = k * 300;
  for (let n = 0; n < 400; n++) {
    const i = k * 1024 + n; t += lnDraw(seed, CH.tail, i, T.every_s);
    const m = T.flicks ? T.flicks[0] + Math.floor(hh(seed, CH.tail + 1, i) * (T.flicks[1] - T.flicks[0] + 1)) : 1, d = m * (T.flick_s || T.twitch_s);
    if (t + d >= (k + 1) * 300) break; out.push({ t0: t, t1: t + d, side: hh(seed, CH.tail + 2, i) < 0.5 ? -1 : 1 }); t += d;
  }
  return out;
}
function rumGen(seed, R, k) {   // boli back to back: a run of chews, then a pause (the bolus swallowed and the next brought up)
  const out = []; let t = k * 600 + R.pause_s[0] * hh(seed, CH.rum + 3, k);
  for (let n = 0; n < 100; n++) {
    const i = k * 1024 + n, m = R.chews[0] + Math.floor(hh(seed, CH.rum, i) * (R.chews[1] - R.chews[0] + 1)), d = m / R.chew_hz;
    if (t + d >= (k + 1) * 600) break; out.push({ t0: t, t1: t + d }); t += d + R.pause_s[0] + (R.pause_s[1] - R.pause_s[0]) * hh(seed, CH.rum + 1, i);
  }
  return out;
}

// ---- the acts' motions: channels the engine applies (the body's frame, the skeleton's rest units) ---------------------
// tau: seconds into the act, dur: its length, w: its weight (the envelope and the yield). Shapes and amplitudes by eye.
function actPose(skel, P, D, e, tau, dur, w, K, c) {
  const R = skel.rest, J = skel.idx, a = e.a.name, cfg = e.a.c || {}, side = e.side, legF = R[J['UpperLeg.FL']][1], legH = R[J['UpperLeg.HL']][1];
  D.act = a;
  if (a === 'shake') {   // the skin twisted quickly from the head back along the spine and the tail (gait.js writeRow: a twist about each bone)
    D.tw = w; D.twT = tau; D.twF = K.shakeHz; D.cD += 0.04 * legF * w; D.hD += 0.04 * legH * w;
    D.troll = 0.1 * Math.sin(TAU * K.shakeHz * (tau - 0.06)) * w;   // the trunk sways with the skin, a little
    D.ownHead = 1; D.yaw = 0.55 * Math.sin(TAU * K.shakeHz * tau) * w; D.pitch = -0.12 * w;   // the head thrown side to side through tens of degrees, ahead of the skin's wave
  } else if (a === 'scratch') {   // down onto the haunches (half a sit), then a hind foot up beside the neck raking at hz, the head bent and tilted down to it
    const i = side > 0 ? 2 : 3, hz = cfg.hz || 5, u0 = c.hop ? 0.55 : 1.2, rise = 0.4, u1 = dur - 0.45;   // (the hind feet step in to the seat first: gait.js sitGeom)
    D.sit = Math.max(D.sit, (c.hop ? 0 : 0.75) * mj(tau / 0.5) * mj((dur - tau) / 0.5) * w);
    D.lift = i; D.lw = mj((tau - u0) / rise) * mj((u1 - tau) / 0.35) * w; D.lneck = c.hop ? 2 : 1;   // (the mark beside the neck as posed: gait.js neckTarget)
    D.rake = Math.sin(TAU * hz * Math.max(0, tau - u0 - rise)) * mj((tau - u0 - rise) / 0.15);
    D.ownHead = 1; D.yaw = 0.5 * side * w; D.pitch = -0.3 * w; D.roll = 0.4 * side * w; D.bend = 0.3 * side * w;
  } else if (a === 'stretch') {   // the bow (the fore end down along the fore legs, the rump high), then a hind leg trailed out, then the other
    const u = tau / dur, bow = mj(u / 0.15) * mj((0.5 - u) / 0.12), rise = u > 0.4 ? mj((u - 0.4) / 0.1) * mj((0.95 - u) / 0.1) : 0;
    D.cD += 0.42 * legF * bow * w; D.hD -= 0.03 * legH * bow * w; D.hz += 0.06 * legH * rise * w;
    D.ownHead = 1; D.yaw = 0; D.pitch = (0.35 * bow + 0.1 * rise) * w;
    const k = u < 0.5 ? -1 : u < 0.72 ? 0 : 1;
    if (k >= 0) { const i = (k === 0) === (side > 0) ? 2 : 3, Lg = skel.legs[i], u0 = k ? 0.72 : 0.5, s = mj((u - u0) / 0.06) * mj((u0 + 0.21 - u) / 0.06);
      D.lift = i; D.lw = s * w; D.lt[0] = Lg.toe[0]; D.lt[1] = 0.12 * legH; D.lt[2] = Lg.toe[2] - 0.45 * (Lg.a + Lg.b); D.lflex = -0.3; }
  } else if (a === 'sit') {
    D.sit = w;
  } else if (a === 'sniff') {   // the nose to the ground and along it; or up into the wind (the tree's `up`: the share of sniffs)
    const upw = e.u < (cfg.up || 0);
    D.ownHead = 1;
    if (upw) { D.yaw = 0.15 * Math.sin(TAU * tau / 4.5 + e.u * 9) * w; D.pitch = 0.5 * w; }
    else { D.sniff = w; D.yaw = 0.28 * Math.sin(TAU * tau / 3.2 + e.u * 9) * w; D.pitch = 0; }
  } else if (a === 'stamp') {   // a fore foot lifted and set down hard, once or twice
    const i = side > 0 ? 0 : 1, Lg = skel.legs[i], n = e.u < 0.5 ? 1 : 2, per = dur / n, q = tau % per, ki = Math.floor(tau / per);
    const lift = ki < n ? (q < 0.35 * per ? mj(q / (0.35 * per)) : q < 0.5 * per ? 1 : q < 0.58 * per ? 1 - (q - 0.5 * per) / (0.08 * per) : 0) : 0;
    D.lift = i; D.lw = clamp(lift, 0, 1) * w; D.lt[0] = Lg.toe[0]; D.lt[1] = 0.3 * legF; D.lt[2] = Lg.toe[2] + 0.06 * legF; D.lflex = 0.9;
    const hit = q > 0.58 * per && q < 0.72 * per ? Math.sin(Math.PI * (q - 0.58 * per) / (0.14 * per)) : 0;
    D.cD += 0.025 * legF * hit * w; D.ownHead = 1; D.yaw = 0; D.pitch = 0.12 * w;
  } else if (a === 'groom') {   // the head round to the shoulder or the flank, working at it (a cat sits for it: the tree's `sit`)
    const hz = cfg.hz || 2.5, reach = e.u < 0.5 ? 0.8 : 1.15;
    D.ownHead = 1; D.yaw = side * (reach + 0.06 * Math.sin(Math.PI * hz * tau)) * w; D.pitch = (-0.45 - 0.07 * Math.max(0, Math.sin(TAU * hz * tau))) * w;
    D.bend = 0.32 * side * w; D.roll = 0.25 * side * w; if (cfg.sit) D.sit = w;
  } else if (a === 'wash') {   // the hares' face wash: sitting up, the fore paws drawn down over the face
    D.paws = w; D.pawPh = tau * (cfg.hz || 3); D.ownHead = 1; D.yaw = 0; D.pitch = -0.2 * w;
  }
}
