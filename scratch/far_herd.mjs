// The far tier (docs/movement.md "Strides that vary"): forty elk on the baked cycles, set walking together from one phase
// (the worst case): how far in step they stay (1: all in step; near 0: spread round the cycle).
//   node scratch/far_herd.mjs [an older copy of client/src/gait.js as .mjs, for the before]
import { readFileSync } from 'node:fs';
import * as G from '../client/src/gait.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const O = process.argv[2] ? await import(pathToFileURL(resolve(process.argv[2])).href) : null;
const buf = readFileSync('client/assets/elk_cow.glb'), ex = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12))).extras;
const J = JSON.parse(readFileSync('client/assets/elk_cow_clips.json', 'utf8')), names = Object.keys(J.clips);
const skin = { clip: Object.fromEntries(names.map((n, i) => [n, i])), table: names.map(n => J.clips[n]) };
const row = JSON.parse(readFileSync('tiles/utm12n_514_4838/locomotion.json', 'utf8')).species[ex.species];
const run = (E, vary) => {
  const skel = E.skeletonOf(ex.skin), P = E.gaitParams(row, skel), F = E.farTable(skin, P), out = new Float32Array(4), v = 0.6 * P.vw, N = 40;
  const herd = [...Array(N)].map((_, i) => { const size = 0.92 + 0.16 * ((i * 0.61803) % 1); const Q = vary ? E.individualParams(P, E.seedOf(`herd:elk:${i}`), size * skel.h / P.h) : null; const st = vary ? E.makeFar(Q) : E.makeFar(); if (vary) st.pA = 0; return st; });
  const R = t => { let c = 0, s = 0; for (const st of herd) { c += Math.cos(2 * Math.PI * st.pA); s += Math.sin(2 * Math.PI * st.pA); } return Math.hypot(c, s) / N; };   // 1: all in step; near 0: spread round the cycle
  const marks = [];
  for (let k = 0; k <= 60 * 60; k++) { for (const st of herd) E.farDrive(st, F, v, 0, 1 / 60, out, 0, 0); if ([60, 300, 600, 1200, 1800, 3600].includes(k)) marks.push(`${k / 60} s: ${R().toFixed(2)}`); }
  return marks.join(', ');
};
if (O) console.log('before (all from one phase):', run(O, false));
console.log('after  (all from one phase):', run(G, true));
const skel = G.skeletonOf(ex.skin), P = G.gaitParams(row, skel);
const starts = [...Array(40)].map((_, i) => G.makeFar(G.individualParams(P, G.seedOf(`herd:elk:${i}`), skel.h / P.h)).pA);
let c = 0, s = 0; for (const p of starts) { c += Math.cos(2 * Math.PI * p); s += Math.sin(2 * Math.PI * p); }
console.log('after, as they spawn (each its own place in the cycle): in-step measure', (Math.hypot(c, s) / 40).toFixed(2));
