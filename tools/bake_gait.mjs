#!/usr/bin/env node
// Bake the leg engine's cycles (client/src/gait.js) for a rigged quadruped GLB (tools/rig_quadruped.py) into a clip set in
// tools/bake_clips.py's format, so the far tier is drawn by the same skin shader from a clip while the near tier runs the
// engine live: client/assets/<name>_clips.bin (RGBA16F, three texels a joint, one row a frame) and <name>_clips.json.
//
//   ~/.nvm/versions/node/v24.13.0/bin/node tools/bake_gait.mjs client/assets/fox.glb [--tile utm10n_680_4280] [--rate 30]
//
// Clips: Idle (one frame standing), Walk, Trot and Gallop (one cycle each on flat ground at 0.6 x walk_mps, 0.75 x trot_mps
// and 1.6 x trot_mps of the species' locomotion row, read from the tile's locomotion.json; the body alone where it has
// none), Bed (one frame, pose 1). A gait clip records stride_m (the engine's stride at that speed: the client advances the
// phase by distance over it), touchdown (the left fore foot's landing phase) and speed_mps.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skeletonOf, gaitParams, makeGait, gaitStep, writeRow, cadence } from '../client/src/gait.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
if (!argv.length || argv.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('import {')[0]); process.exit(0); }
const SRC = argv[0], opt = (k, d) => argv.includes(k) ? argv[argv.indexOf(k) + 1] : d;
const RATE = +opt('--rate', 30), TILE = opt('--tile', 'utm10n_680_4280');

const buf = readFileSync(SRC);
if (buf.toString('latin1', 0, 4) !== 'glTF') throw new Error(`${SRC}: not a GLB`);
const jsonLen = buf.readUInt32LE(12), js = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const sk = js.extras?.skin; if (!sk?.legs) throw new Error(`${SRC}: no extras.skin from rig_quadruped.py`);
const species = js.extras.species;
let row = null;
try { row = JSON.parse(readFileSync(join(ROOT, 'tiles', TILE, 'locomotion.json'), 'utf8')).species[species] || null; } catch { row = null; }
const skel = skeletonOf(sk), P = gaitParams(row, skel);
console.log(`INFO ${basename(SRC)}: ${species}, ${row ? `row from tiles/${TILE}` : 'no row: the body alone'}; walk ${P.vw.toFixed(2)} trot ${P.vt.toFixed(2)} m/s, stride ${P.Lt.toFixed(2)} m at ${P.ft.toFixed(2)} Hz, ${P.posture}, ${P.pace ? 'pace' : 'trot'}, ${P.gallop} gallop`);

const W = skel.n * 3, frames = [], clips = {};
const terrain = () => 0;
function run(name, v, pose, loop) {
  const st = makeGait(); let x = 0, z = 0; const dt = 1 / 240;
  const inp = { x: 0, y: 0, z: 0, yaw: 0, size: 1, v, wr: 0, pose, flick: 0, bend: 0, twitch: 0, terrain, air: false };
  const step = h => { z += v * h; inp.z = z; gaitStep(skel, P, st, inp, h); };
  for (let t = 0; t < 4; t += dt) step(dt);   // settle
  const first = frames.length;
  if (!loop) {
    const out = new Float32Array(W * 4); writeRow(skel, st, out, 0); frames.push(out);
    clips[name] = { first, count: 1, loop: false, duration: 0, root_motion: [0, 0, 0] };
    return;
  }
  const { f, L } = cadence(P, v), T = 1 / f, count = Math.max(8, Math.round(T * RATE)), h = T / count;
  // start the cycle at phase 0
  while (st.phase > 0.02) step(dt);
  let td = null;
  const stanceBefore = st.feet[0].stance;
  let was = stanceBefore;
  for (let k = 0; k < count; k++) {
    const out = new Float32Array(W * 4); writeRow(skel, st, out, 0); frames.push(out);
    const sub = 4; for (let q = 0; q < sub; q++) step(h / sub);
    const now = st.feet[0].stance; if (now && !was && td === null) td = (k + 1) / count; was = now;
  }
  clips[name] = { first, count, loop: true, duration: +T.toFixed(4), root_motion: [0, 0, 0], stride_m: +L.toFixed(4), touchdown: +(td ?? 0).toFixed(4), speed_mps: +v.toFixed(3), cadence_hz: +f.toFixed(3), duty: +st.duty.toFixed(3), gait: st.gait };
  console.log(`CLIP ${name}: ${count} frames, ${T.toFixed(3)} s, stride ${L.toFixed(3)} m at ${v.toFixed(2)} m/s, duty ${st.duty.toFixed(2)}, touchdown ${clips[name].touchdown}`);
}
run('Idle', 0, 0, false);
run('Walk', 0.6 * P.vw, 0, true);
run('Trot', 0.75 * P.vt, 0, true);
run('Gallop', 1.6 * P.vt, 0, true);
run('Bed', 0, 1, false);

// half floats
function toHalf(x) {
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer); f32[0] = x;
  const b = u32[0], s = (b >> 16) & 0x8000, e = ((b >> 23) & 0xff) - 112, m = b & 0x7fffff;
  if (e <= 0) return s | (e < -10 ? 0 : (m | 0x800000) >> (1 - e + 13));
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >> 13);
}
const H = frames.length, data = new Uint16Array(W * H * 4);
let worst = 0;
for (let r = 0; r < H; r++) for (let i = 0; i < W * 4; i++) { const x = frames[r][i]; worst = Math.max(worst, Math.abs(x)); data[r * W * 4 + i] = toHalf(x); }
const stem = basename(SRC).replace('.glb', ''), outBase = join(dirname(SRC), `${stem}_clips`);
writeFileSync(`${outBase}.bin`, Buffer.from(data.buffer));
const index = {
  rate: RATE, width: W, height: H, format: 'rgba16f', texels: "row f = frame f; texels j*3..j*3+2 = rows 0..2 of joint j's 3x4 matrix (adopted frame)",
  joints: skel.names, joint_rest: skel.rest.map(p => p.map(x => +x.toFixed(4))), scale: 1.0, offset: [0, 0, 0],
  source: { file: basename(SRC), engine: 'client/src/gait.js (tools/bake_gait.mjs)', species, tile: row ? TILE : null, params: { vw: P.vw, vt: P.vt, ft: P.ft, Lt: P.Lt, posture: P.posture, pace: P.pace, gallop: P.gallop } },
  clips,
};
writeFileSync(`${outBase}.json`, JSON.stringify(index, null, 1));
console.log(`WROTE ${outBase}.bin (${data.byteLength} bytes, ${W}x${H} rgba16f, values to ${worst.toFixed(2)}) and ${outBase}.json (${Object.keys(clips).length} clips)`);
