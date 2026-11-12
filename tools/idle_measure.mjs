#!/usr/bin/env node
// The idle layer's measures in node (client/src/idle.js on the leg engine, client/src/gait.js): a body standing for a
// simulated hour (and an elk bedded for one), against the tree's idle block (library/animals/locomotion.json; the sources
// are in its notes).
//
//   ~/.nvm/versions/node/v24.13.0/bin/node tools/idle_measure.mjs [coyote elk_cow cougar bear snowshoe_hare fauna/canis_lupus] [--hours 1] [--days 200]
//
// Per model: the breathing rate against Stahl's rule (and after a minute's gallop), the share of standing time in each act
// against the tree's (the engine over the hour, the director alone over --days hours), the head's holds and turns,
// planted feet (the drawn toe against its plant point while it stands; a lifted foot back on its place), two runs of one
// seed identical and two seeds different, starting to walk in the middle of each act (the largest turn of any joint in one
// frame against starting to walk from a plain stand), and the cost of a frame standing and walking with the layer and
// without it. Exit code 1 when a measure is out of its band.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../client/src/gait.js';
import { directorOf, actAt, makeIdle, idleOf } from '../client/src/idle.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (k, d) => argv.includes(k) ? argv[argv.indexOf(k) + 1] : d;
const names = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').match(/^--(hours|days)$/));
const MODELS = names.length ? names : ['coyote', 'elk_cow', 'cougar', 'bear', 'snowshoe_hare', 'fauna/canis_lupus', 'hero/canis_lupus', 'hero/bison_bison', 'hero/ursus_arctos'];
const HOURS = +opt('--hours', 1), DAYS = +opt('--days', 200), DT = 1 / 60;
const TILES = ['utm12n_514_4838', 'utm12n_557_4964', 'utm10n_680_4280', 'utm10n_429_5293', 'utm11n_270_4180', 'utm10n_731_4235'];
const TREE = JSON.parse(readFileSync(join(ROOT, 'library/animals/locomotion.json'), 'utf8'));
const noNotes = o => o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'note').map(([k, v]) => [k, noNotes(v)])) : o;
const mergeT = (a, b) => { const o = { ...a }; for (const k in b) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? mergeT(a[k], b[k]) : b[k]; return o; };

function load(name) {
  const file = join(ROOT, 'client/assets', `${name}.glb`), buf = readFileSync(file), n = buf.readUInt32LE(12), ex = JSON.parse(buf.toString('utf8', 20, 20 + n)).extras;
  let row = null, from = '';
  for (const t of TILES) { try { row = JSON.parse(readFileSync(join(ROOT, 'tiles', t, 'locomotion.json'), 'utf8')).species[ex.species] || null; } catch { row = null; } if (row) { from = `tiles/${t}`; break; } }
  if (!row) {   // a fauna model with no tile row: its generated trait record's row, with the idle block resolved from the tree by its taxonomy
    const tp = join(ROOT, 'library/animals/traits', `${ex.species}.json`);
    if (existsSync(tp)) {
      const rec = JSON.parse(readFileSync(tp, 'utf8')); row = { ...(rec.locomotion || {}) }; from = 'traits (idle from the tree)';
      let idle = {}; for (const r of ['kingdom', 'phylum', 'class', 'order', 'family', 'genus']) { const b = TREE.taxa[rec.taxonomy?.[r]]?.idle; if (b) idle = mergeT(idle, noNotes(b)); }
      row.idle = idle;
    }
  }
  return { name, species: ex.species, skel: G.skeletonOf(ex.skin), row, from };
}
const inputs = () => ({ x: 0, y: 0, z: 0, yaw: 0, size: 1, v: 0, wr: 0, pose: 0, flick: 0, bend: 0, twitch: 0, terrain: () => 0, air: false, t: 0, sit: 0, act: '', look: null });
const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
const f1 = x => x.toFixed(1), f2 = x => x.toFixed(2), f3 = x => x.toFixed(3), mm = x => (1000 * x).toFixed(2), pc = x => (100 * x).toFixed(2);
// the rotation angle between two joints' 3x3 (columns normalised: the breath's scale taken out)
function angleBetween(a, b, o) {
  let tr = 0;
  for (let c = 0; c < 3; c++) {
    const na = Math.hypot(a[o + c], a[o + 4 + c], a[o + 8 + c]) || 1, nb = Math.hypot(b[o + c], b[o + 4 + c], b[o + 8 + c]) || 1;
    tr += (a[o + c] * b[o + c] + a[o + 4 + c] * b[o + 4 + c] + a[o + 8 + c] * b[o + 8 + c]) / (na * nb);
  }
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
}

let bad = 0;
const band = (ok, s) => { if (!ok) bad++; return `${s} ${ok ? 'ok' : 'OUT'}`; };
for (const name of MODELS) {
  const M = load(name), skel = M.skel, P = G.gaitParams(M.row, skel), Q = G.individualParams(P, G.seedOf(`idle:${name}`), skel.h / P.h);
  Q._caps = G.capsOf(skel, Q);   // (the capability gate: what this skeleton can do, before the director is made)
  const I = Q.idle, K = directorOf(Q), hop = !!Q.hop;
  console.log(`\n${name} (${M.species}, ${M.row ? M.from : 'no row: the body alone'}; ${skel.n} joints${skel.ears ? ', ears' : ''}): ${f1(Q.mass)} kg, tail ${I.tail?.style}, keeps ${K.list.map(a => `${a.name} ${pc(a.share)} %`).join(', ')}${K.gone.length ? `; gated off: ${K.gone.join(', ')}` : ''}${I.ruminate ? '; ruminates bedded' : ''} (neck joints ${Q._caps.neck_joints}, a hind toe within ${f2(Q._caps.reach_neck)} of the withers' height of the neck)`);
  // ---- an hour standing ----
  const run = (Qx, T, setup = () => {}, each = () => {}) => {
    const st = G.makeGait(), inp = inputs(), out = new Float32Array(skel.n * 12);
    setup(st, inp);
    for (let f = 0, n = Math.round(T / DT); f < n; f++) { inp.t += DT; each(st, inp, f); G.gaitStep(skel, Qx, st, inp, DT); G.writeRow(skel, st, out, 0); each.after?.(st, inp, out, f); }
    return { st, out };
  };
  const T = HOURS * 3600, actT = {}, yawS = [], earS = [], earOut = { sw: 0, p0: 0, p1: 0 }, feetHold = [null, null, null, null];
  let miss = 0, plantMove = 0, liftBack = 0, lifts = 0, prevLift = [0, 0, 0, 0], brMax = 0, holdMiss = 0;
  const each = () => {}; each.after = (st, inp, out, f) => {
    const D = st.id?.D; if (D && D.act && D.busy > 0.5) actT[D.act] = (actT[D.act] || 0) + DT;
    // the head's yaw in the body's frame (the nose from the head joint)
    const h = st.P[skel.idx.Head], nz = st.E[skel.idx.Head]; yawS.push(D && D.busy > 0.01 ? NaN : Math.atan2(nz[0] - h[0], nz[2] - h[2]));
    if (skel.ears && D && D.ear) { earS.push(D.busy > 0.01 ? NaN : (D.ear[0][0] + D.ear[1][0]) / 2); for (const a of D.ear) { earOut.sw = Math.max(earOut.sw, Math.abs(a[0])); earOut.p0 = Math.min(earOut.p0, a[1]); earOut.p1 = Math.max(earOut.p1, a[1]); } }
    if (D) brMax = Math.max(brMax, Math.hypot(out[skel.idx.Chest * 12], out[skel.idx.Chest * 12 + 4], out[skel.idx.Chest * 12 + 8]) - 1);
    for (let i = 0; i < 4; i++) {
      const F = st.feet[i], Lg = skel.legs[i], toe = st.E[Lg.f], lw = D && D.lift === i ? D.lw : 0;
      if (lw > 1e-4 || (hop && Lg.fore && st.sit > 0.05)) { prevLift[i] = 1; continue; }   // (a hare sitting up holds its fore paws off the ground)
      const d = Math.hypot(toe[0] - F.x, toe[2] - F.z, toe[1] - F.y);
      if (prevLift[i]) { lifts++; liftBack = Math.max(liftBack, d, feetHold[i] ? Math.hypot(F.x - feetHold[i][0], F.z - feetHold[i][1]) : 0); prevLift[i] = 0; }
      if (F.stance) { if (!feetHold[i]) feetHold[i] = [F.x, F.z]; plantMove = Math.max(plantMove, Math.hypot(F.x - feetHold[i][0], F.z - feetHold[i][1])); miss = Math.max(miss, d); }
      else feetHold[i] = null;
    }
  };
  const t0 = performance.now(), A = run(Q, T, undefined, each), wall = (performance.now() - t0) / 1000;
  // breathing: the count of breaths against Stahl's rule (the debt is nil standing)
  const rule = 53.5 * Math.pow(Q.mass, -0.26), rate = A.st.id.bn / (T / 60);
  console.log(`  standing ${HOURS} h (${f1(wall)} s of node): breathing ${f1(rate)} a minute, Stahl's rule ${f1(rule)}: ${band(Math.abs(rate / rule - 1) < 0.05, `${pc(rate / rule - 1)} %`)}; the chest's swell up to ${pc(brMax)} % across`);
  // after a minute's gallop: the debt
  let rAfter = 0, rLate = 0;
  { const st = G.makeGait(), inp = inputs(); let z = 0, n0 = 0;
    for (let f = 0; f < 60 / DT; f++) { inp.t += DT; inp.v = 1.6 * Q.vt; z += inp.v * DT; inp.z = z; G.gaitStep(skel, Q, st, inp, DT); }
    inp.v = 0; for (let f = 0; f < 3 / DT; f++) { inp.t += DT; G.gaitStep(skel, Q, st, inp, DT); }
    n0 = st.id.bn; for (let f = 0; f < 30 / DT; f++) { inp.t += DT; G.gaitStep(skel, Q, st, inp, DT); } rAfter = (st.id.bn - n0) * 2;
    for (let f = 0; f < 600 / DT; f++) { inp.t += DT; G.gaitStep(skel, Q, st, inp, DT); } n0 = st.id.bn; for (let f = 0; f < 60 / DT; f++) { inp.t += DT; G.gaitStep(skel, Q, st, inp, DT); } rLate = st.id.bn - n0; }
  console.log(`  after a minute's gallop: ${f1(rAfter)} a minute over the first 30 s ${band(rAfter > 1.4 * rule, '(quicker)')}, ${f1(rLate)} ten minutes on ${band(rLate < 1.15 * rule, '(settled)')}`);
  // the acts: the engine's hour, and the director alone over DAYS hours
  const dir = {}, S = makeIdle(), seed = Q.ind.seed;
  for (let t = 0; t < DAYS * 3600; t += 0.25) { const e = actAt(S, seed, K, t); if (e) dir[e.a.name] = (dir[e.a.name] || 0) + 0.25; }
  for (const a of K.list) {
    const d = (dir[a.name] || 0) / (DAYS * 3600), e = (actT[a.name] || 0) / T, sdv = Math.sqrt(a.share * a.mean / (DAYS * 3600)) * 1.5;   // (a bout's length in the count's spread)
    console.log(`    ${a.name.padEnd(8)} the tree ${pc(a.share)} % (${a.share * 3600 / a.mean > 0 ? f1(a.share * 3600 / a.mean) : 0} an hour of ${f1(a.mean)} s); the director over ${DAYS} h ${band(Math.abs(d - a.share) <= Math.max(0.15 * a.share, 3 * sdv), `${pc(d)} %`)}; the engine's hour ${pc(e)} %`);
  }
  // the head: holds and turns (the gaze alone, outside the acts)
  if (!hop) {
    const holds = [], speeds = []; let run0 = 0, turns = 0, inTurn = false;
    for (let f = 1; f < yawS.length; f++) {
      const a = yawS[f], b = yawS[f - 1]; if (!(a === a) || !(b === b)) { run0 = 0; inTurn = false; continue; }
      const w = Math.abs(a - b) / DT; speeds.push(w);
      if (w < 0.08) { run0 += DT; if (inTurn) inTurn = false; } else { if (run0 > 0.3) holds.push(run0); run0 = 0; if (!inTurn && w > 0.3) { turns++; inTurn = true; } }
    }
    const mh = median(holds), peak = speeds.reduce((m, x) => x > m ? x : m, 0);
    console.log(`  the gaze: ${turns} turns and ${holds.length} holds in the hour outside the acts; median hold ${f2(mh)} s ${band(mh > 0.6 * I.look.hold_s[0] && mh < 2 * I.look.hold_s[0], `(the tree's median ${I.look.hold_s[0]} s)`)}; peak turn ${f2(peak)} rad/s ${band(peak > 1 && peak < 9, '(quick, not a wander)')}`);
  }
  // the ears: within their range; leading the head (the lag at which the ears' swivel rate best matches the head's yaw rate)
  if (skel.ears && earS.length) {
    const E = I.ears, okR = earOut.sw <= E.range + 1e-6 && earOut.p0 >= -E.flat - 1e-6 && earOut.p1 <= E.alert + E.flick.amp + 1e-6;
    const vel = a => a.map((x, i) => i ? (x - a[i - 1]) / DT : NaN), ve = vel(earS), vh = vel(yawS);
    let best = -Infinity, lagB = 0;
    for (let L = -60; L <= 60; L += 2) { let s = 0; for (let i = 61; i < ve.length - 61; i++) { const a = ve[i], b = vh[i + L]; if (a === a && b === b) s += a * b; } if (s > best) { best = s; lagB = L; } }
    const S2 = run(G.individualParams(P, G.seedOf(`idle:${name}:2`), skel.h / P.h), 120, undefined, Object.assign(() => {}, { after: () => {} })).st, S1 = run(Q, 120).st;
    const differ = JSON.stringify(S1.id.D.ear) !== JSON.stringify(S2.id.D.ear);
    console.log(`  the ears: swivel up to ${f2(earOut.sw)} rad (range ${E.range}), pitch ${f2(earOut.p0)} to ${f2(earOut.p1)} rad ${band(okR, `(-${E.flat} to ${E.alert + E.flick.amp})`)}; ${hop ? 'no gaze is drawn on a hare: its ears wander on their own clocks' : `the ears' turn best matches the head's ${f2(lagB * DT)} s later ${band(lagB > 0, '(they lead)')}`}; two seeds ${band(differ, differ ? 'differ' : 'THE SAME')}`);
    // a gallop lays them flat
    const g = G.makeGait(), ig = inputs(); for (let f = 0; f < 240; f++) { ig.t += DT; ig.v = 1.6 * Q.vt; ig.z += ig.v * DT; G.gaitStep(skel, Q, g, ig, DT); }
    const Mg = g.loc?.[skel.ears[0].j]; const back = Mg ? Math.atan2(-(Mg[5]), Mg[4]) : 0;
    console.log(`  in a gallop the left ear turned back ${f2(-Math.atan2(Mg ? Mg[7] : 0, Mg ? Mg[4] : 1))} rad about its base ${band(Mg && (hop ? -Math.atan2(Mg[7], Mg[4]) > 0.9 * E.flat : Math.abs(Math.atan2(Mg[7], Mg[4]) + E.flat) < 0.05), hop ? '(the hare\'s own laid-back ears: at least the flat)' : `(flat: ${E.flat})`)}`);
  }
  console.log(`  feet: a planted toe off its plant point at most ${mm(miss)} mm ${band(miss < 0.002 * Math.max(1, skel.h), '')}; a plant point moved while it stood ${mm(plantMove)} mm ${band(plantMove < 1e-6, '')}; ${lifts} lifts by the acts, back on their place within ${mm(liftBack)} mm ${band(liftBack < 0.002, '')}`);
  // two runs of one seed, and two seeds
  const sig = (Qx, t) => { const R = run(Qx, t); let h = 0; for (let i = 0; i < R.out.length; i++) h = (h * 31 + Math.round(R.out[i] * 1e6)) % 1e12; return h; };
  const Q2 = G.individualParams(P, G.seedOf(`idle:${name}:2`), skel.h / P.h);
  const s1 = sig(Q, 600), s2 = sig(Q, 600), s3 = sig(Q2, 600);
  const acts1 = [], acts2 = []; { const S1 = makeIdle(), S2 = makeIdle(), K2 = directorOf(Q2); for (let t = 0; t < 7200; t += 1) { acts1.push(actAt(S1, seed, K, t)?.a.name || ''); acts2.push(actAt(S2, Q2.ind.seed, K2, t)?.a.name || ''); } }
  const same = acts1.filter((a, i) => a === acts2[i] && a).length;
  console.log(`  determinism: one seed twice ${band(s1 === s2, s1 === s2 ? 'identical' : 'DIFFERENT')}; two seeds ${band(s1 !== s3, s1 !== s3 ? 'differ' : 'THE SAME')} (in an act together ${same} s of 2 h)`);
  // starting to walk in the middle of an act: the largest turn of any joint in one frame, against from a plain stand
  const jump = (act) => {
    let worst = 0, own = 0, prev = null;
    const st = G.makeGait(), inp = inputs(), out = new Float32Array(skel.n * 12); inp.t = 50000 + (act ? 0 : 0);
    const dur = act ? Math.max(1, (I.acts?.[act]?.bout_s?.[0]) || 3) : 2, tWalk = 3 + Math.min(dur / 2, 4);
    for (let f = 0; f < (tWalk + (act ? 1.5 : 4)) / DT; f++) {   // (the plain walk over 4 s: its own quickest turn, the plantigrade foot's flex at a lift, falls at different phases)
      const t = f * DT; inp.t += DT; inp.act = act && t > 3 ? act : 'none'; inp.sit = 0;
      if (t >= tWalk) { inp.v = 0.6 * Q.vw; inp.z += inp.v * DT; }
      G.gaitStep(skel, Q, st, inp, DT); G.writeRow(skel, st, out, 0);
      if (prev) for (let j = 0; j < skel.n; j++) { const a = angleBetween(prev, out, j * 12); if (t >= tWalk - DT) worst = Math.max(worst, a); else if (t > 3) own = Math.max(own, a); }   // (own: the act's own quickest turn standing: a shake turns the head quickly by itself)
      prev = Float32Array.from(out);
    }
    return [worst, own];
  };
  const base = jump('')[0], jl = [];
  for (const a of K.list) { const [w, own] = jump(a.name); jl.push(`${a.name} ${f3(w)}${own > base ? ` (its own ${f3(own)})` : ''}`); if (!(w <= Math.max(base, own) + 0.12)) { bad++; jl[jl.length - 1] += ' OUT'; } }
  console.log(`  starting to walk mid-act, the largest turn of a joint in a frame (rad): from a plain stand ${f3(base)}; ${jl.join(', ')} (band: within 0.12 of the plain stand's, or of the act's own quickest turn standing)`);
  // the bed (an elk: an hour bedded, the rumination)
  if (I.ruminate && I.ruminate.chew_hz) {
    let nods = 0, last = 0, runs = [], cur = 0, gaps = [], tLast = -1;
    const bed = run(Q, T, (st, inp) => { inp.pose = 1; }, Object.assign(() => {}, { after: (st, inp) => {
      const n = st.id.D.nod, up = n > 0.5 * I.ruminate.nod;
      if (up && !last) { if (tLast >= 0 && inp.t - tLast > 1.5) { gaps.push(inp.t - tLast); runs.push(cur); cur = 0; } nods++; cur++; tLast = inp.t; }
      last = up; } }));
    const brate = bed.st.id.bn / (T / 60), mr = median(runs), mg = median(gaps);
    console.log(`  bedded ${HOURS} h: breathing ${f1(brate)} a minute ${band(Math.abs(brate / rule - 1) < 0.05, '')}; ${nods} chews, runs of median ${mr} chews ${band(mr >= I.ruminate.chews[0] && mr <= I.ruminate.chews[1], `(the tree ${I.ruminate.chews.join(' to ')})`)}, pauses of median ${f2(mg)} s ${band(mg >= I.ruminate.pause_s[0] && mg <= I.ruminate.pause_s[1] + 1.2, `(the tree ${I.ruminate.pause_s.join(' to ')} s, plus a chew's own time)`)}`);
  }
  // the cost: a frame standing and walking, with the layer and without it (interleaved, the median of rounds)
  const Qoff = Object.create(Q); Qoff.idle = null;
  const cost = (Qx, v, n = 6000) => { const st = G.makeGait(), inp = inputs(), out = new Float32Array(skel.n * 12); inp.v = v;
    for (let i = 0; i < 1200; i++) { inp.t += DT; inp.z += v * DT; G.gaitStep(skel, Qx, st, inp, DT); G.writeRow(skel, st, out, 0); }
    const a = performance.now(); for (let i = 0; i < n; i++) { inp.t += DT; inp.z += v * DT; G.gaitStep(skel, Qx, st, inp, DT); G.writeRow(skel, st, out, 0); } return (performance.now() - a) * 1000 / n; };
  const C = { on0: [], off0: [], onW: [], offW: [] };
  cost(Q, 0); cost(Qoff, 0); cost(Q, 0.6 * Q.vw); cost(Qoff, 0.6 * Q.vw);   // (the compiler warmed first)
  for (let r = 0; r < 9; r++) { C.on0.push(cost(Q, 0)); C.off0.push(cost(Qoff, 0)); C.onW.push(cost(Q, 0.6 * Q.vw)); C.offW.push(cost(Qoff, 0.6 * Q.vw)); }
  const lo = a => Math.min(...a);   // (the least of nine interleaved rounds: the machine's other load taken out as far as it can be)
  const d0 = lo(C.on0) - lo(C.off0), dW = lo(C.onW) - lo(C.offW);
  console.log(`  a frame standing ${f1(lo(C.on0))} us against ${f1(lo(C.off0))} without the layer (+${f1(d0)}) ${band(d0 < 2.5, '')}; walking ${f1(lo(C.onW))} against ${f1(lo(C.offW))} (+${f1(dW)}) ${band(dW < 0.8, '')}`);
}
console.log(bad ? `\n${bad} measures out of band` : '\nall in band');
process.exit(bad ? 1 : 0);
