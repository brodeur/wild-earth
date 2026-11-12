#!/usr/bin/env node
// The stride measures in node (client/src/gaitMeasure.js; the lineup page runs the same as __animalLineup.strides): the leg
// engine on a rigged GLB's skeleton for a few hundred strides a gait, against the band the variation was read from
// (library/animals/locomotion.json Mammalia `vary`; docs/movement.md "Strides that vary").
//
//   ~/.nvm/versions/node/v24.13.0/bin/node tools/gait_measure.mjs [coyote elk_cow cougar snowshoe_hare bison_bison ...] [--old scratch/gait_old.mjs] [--strides 300] [--json]
//
// --old: an older copy of client/src/gait.js (git show main:client/src/gait.js > scratch/gait_old.mjs) measured by the same
// code, for the before and after of foot slide and frame cost. Exit code 1 when a measure is out of its band.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as G from '../client/src/gait.js';
import { strideStats, frameCost, driftApart, hostMirror } from '../client/src/gaitMeasure.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (k, d) => argv.includes(k) ? argv[argv.indexOf(k) + 1] : d;
const names = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').match(/^--(old|strides)$/));
const MODELS = names.length ? names : ['coyote', 'elk_cow', 'cougar', 'snowshoe_hare', 'fox', 'bobcat', 'bear', 'otter'];
const OLD = opt('--old', null) ? await import(pathToFileURL(resolve(opt('--old'))).href) : null;
const N = +opt('--strides', 300), JSON_OUT = argv.includes('--json');
const TILES = ['utm12n_514_4838', 'utm12n_557_4964', 'utm10n_680_4280', 'utm10n_429_5293', 'utm11n_270_4180', 'utm10n_731_4235'];
// the bands (the tree's note has the sources): the stride interval's spread against the tree's own stride_cv, the memory
// of stride series as measured in people (no quadruped series was found): alpha 0.87 +- 0.15 (Hausdorff et al. 1997)
const ALPHA = [0.6, 1.1];
const glbOf = name => { const a = join(ROOT, 'client/assets', `${name}.glb`); return existsSync(a) ? a : join(ROOT, 'client/assets/fauna', `${name}.glb`); };   // (a model of the fauna step: client/assets/fauna)

function load(name) {
  const buf = readFileSync(glbOf(name)), n = buf.readUInt32LE(12), ex = JSON.parse(buf.toString('utf8', 20, 20 + n)).extras;
  let row = null;
  for (const t of TILES) { try { row = JSON.parse(readFileSync(join(ROOT, 'tiles', t, 'locomotion.json'), 'utf8')).species[ex.species] || null; } catch { row = null; } if (row) break; }
  return { name, species: ex.species, skel: G.skeletonOf(ex.skin), row };
}
const pct = x => (100 * x).toFixed(1), mm = x => (1000 * x).toFixed(1);
// the duty factor (the share of a stride a foot stands, fore and hind) and the largest angle of a standing leg's line from
// its shoulder or hip joint to the drawn toe, ahead of the vertical (protraction, at landing) and behind it (retraction,
// at lift), in degrees, fore and hind: 20 s at speed v after 4 s to settle, 240 steps a second
function legStats(E, skel, P, v) {
  const st = E.makeGait(), inp = { x: 0, y: 0, z: 0, yaw: 0, size: 1, v, wr: 0, pose: 0, flick: 0, bend: 0, twitch: 0, terrain: () => 0, air: false, t: 0, act: 'none' }, dt = 1 / 240;
  const n = [0, 0], on = [0, 0], pro = [0, 0], ret = [0, 0];
  for (let f = 0; f < 24 / dt; f++) {
    inp.z += v * dt; inp.t += dt; E.gaitStep(skel, P, st, inp, dt); if (f < 4 / dt) continue;
    for (let i = 0; i < 4; i++) {
      const k = i < 2 ? 0 : 1, F = st.feet[i], Lg = skel.legs[i]; n[k]++; if (!F.stance) continue; on[k]++;
      const J = st.P[Lg.u], T = st.E[Lg.f], a = Math.atan2(T[2] - J[2], J[1] - T[1]) * 180 / Math.PI;
      pro[k] = Math.max(pro[k], a); ret[k] = Math.max(ret[k], -a);
    }
  }
  return { duty: [on[0] / n[0], on[1] / n[1]], pro, ret };
}
let bad = 0; const all = {};
for (const name of MODELS) {
  const M = load(name), P = G.gaitParams(M.row, M.skel), Q = G.individualParams(P, G.seedOf(`measure:${name}`), M.skel.h / P.h), V = P.vary;   // (the model's own height against the species': an elk cow)
  if (P.hop) Q.observe = null;   // the hares' observation hop (every few bounds one is 1.4 times as long) is a behaviour of its own: measured without it
  const Po = OLD ? OLD.gaitParams(M.row, M.skel) : null; if (Po?.hop) Po.observe = null;
  const skO = OLD ? OLD.skeletonOf(JSON.parse(JSON.stringify((() => { const buf = readFileSync(glbOf(name)); return JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12))).extras.skin; })()))) : null;
  const gaits = P.hop ? [['shuffle', 0.75 * P.vS, 0], ['bound', 1.5 * P.vS, 2], ['run', Math.max(0.75 * (M.row?.cruise_mps || 2 * P.vt), 2.2 * P.vt), 2]]
    : [['walk', 0.6 * Q.vw, 0], ['trot', 0.75 * Q.vt, 1], ['gallop', 1.6 * Q.vt, 2]];
  console.log(`\n${name} (${M.species}${M.row ? '' : ', no row: the body alone'}): hip ${P.h.toFixed(2)} m, walk to ${P.vw.toFixed(2)}, trot to ${P.vt.toFixed(2)} m/s, ${P.ft.toFixed(2)} Hz at the change`);
  all[name] = {};
  for (const [g, v, ci] of gaits) {
    const S = strideStats(G, M.skel, Q, { v, strides: N }), want = V.stride_cv[ci];
    const cost = frameCost(G, M.skel, Q, { v }), So = OLD ? strideStats(OLD, skO, Po, { v, strides: Math.min(N, 120) }) : null, costO = OLD ? frameCost(OLD, skO, Po, { v }) : NaN;
    const D = driftApart(G, M.skel, P, { v }), Ds = driftApart(G, M.skel, P, { v, sameSize: true });
    const okCv = S.interval.cv > 0.6 * want && S.interval.cv < 1.5 * want, okA = S.interval.alpha > ALPHA[0] && S.interval.alpha < ALPHA[1];
    const okSlide = !So || S.slide.max <= So.slide.max + 0.002 * S.slide.hip, okDrift = D.seconds < 120;
    if (!(okCv && okA && okSlide && okDrift)) bad++;
    all[name][g] = { S, So, cost, costO, D, Ds };
    console.log(`  ${g.padEnd(8)} ${v.toFixed(2)} m/s, ${S.strides} strides of ${S.interval.mean.toFixed(3)} s and ${S.length.mean.toFixed(2)} m`);
    console.log(`    interval cv ${pct(S.interval.cv)} % (the tree: ${pct(want)} %) ${okCv ? 'ok' : 'OUT'}; lag-1 r ${S.interval.r1.toFixed(2)}; DFA alpha ${S.interval.alpha.toFixed(2)} (band ${ALPHA[0]} to ${ALPHA[1]}) ${okA ? 'ok' : 'OUT'}; length cv ${pct(S.length.cv)} %, lag-1 r ${S.length.r1.toFixed(2)}`);
    console.log(`    lags behind the left hind: FL ${S.lag[0].mean.toFixed(3)} +- ${S.lag[0].sd.toFixed(3)}, FR ${S.lag[1].mean.toFixed(3)} +- ${S.lag[1].sd.toFixed(3)}, HR ${S.lag[2].mean.toFixed(3)} +- ${S.lag[2].sd.toFixed(3)}; width sd fore ${pct(S.width[0])} %, hind ${pct(S.width[1])} % of the track`);
    const LS = legStats(G, M.skel, Q, v); all[name][g].legs = LS;
    if (g === 'walk' && !P.hop && !(Math.min(...LS.duty) > 0.5)) bad++;
    console.log(`    duty factor fore ${LS.duty[0].toFixed(2)}, hind ${LS.duty[1].toFixed(2)}${g === 'walk' && !P.hop ? (Math.min(...LS.duty) > 0.5 ? ' (a walk: over 0.5) ok' : ' (a walk: over 0.5) OUT') : ''}; a standing leg's line from the vertical: fore ${LS.pro[0].toFixed(0)} ahead to ${LS.ret[0].toFixed(0)} behind, hind ${LS.pro[1].toFixed(0)} ahead to ${LS.ret[1].toFixed(0)} behind (degrees)`);
    console.log(`    foot slide a stance: mean ${mm(S.slide.mean)} mm, worst ${mm(S.slide.max)} mm${So ? ` (before: mean ${mm(So.slide.mean)}, worst ${mm(So.slide.max)} mm)` : ''} ${okSlide ? 'ok' : 'WORSE'}; a frame ${cost.toFixed(1)} us${OLD ? ` (before ${costO.toFixed(1)} us)` : ''}`);
    console.log(`    two in step are a quarter stride apart after ${D.seconds.toFixed(0)} s (${D.strides.toFixed(0)} strides; ${D.fastest.toFixed(0)} to ${D.slowest.toFixed(0)} s over ${D.pairs} pairs); of one size ${Ds.seconds.toFixed(0)} s ${okDrift ? 'ok' : 'SLOW'}`);
  }
  // a host and a mirror over a minute of walk, trot, gallop, turns and a halt
  const path = t => { const u = t % 30; return { v: u < 6 ? 0.6 * P.vw : u < 12 ? (P.hop ? 1.5 * P.vS : 0.75 * P.vt) : u < 20 ? 1.6 * P.vt : u < 26 ? 0.8 * P.vw : 0, wr: u > 14 && u < 17 ? 0.5 : u > 21 && u < 24 ? -0.6 : 0 }; };
  const HM = hostMirror(G, M.skel, P, { path }), HMfree = hostMirror(G, M.skel, P, { path, lock: false });
  all[name].mirror = { HM, HMfree };
  console.log(`  host and mirror (60 s: walk, trot, gallop with a turn, walk with a turn, a halt; 4 Hz, 80 ms late, the mirror at 50 fps): ${HM.landings} landings, the mirror's against the host's of that foot: median ${mm(HM.median)} mm, 90 % within ${mm(HM.p90)} mm, worst ${mm(HM.worst)} mm; with the clock unlocked: median ${mm(HMfree.median)} mm, 90 % within ${mm(HMfree.p90)} mm`);
}
if (JSON_OUT) console.log(JSON.stringify(all));
console.log(bad ? `\n${bad} gait rows out of band` : '\nall in band');
process.exit(bad ? 1 : 0);
