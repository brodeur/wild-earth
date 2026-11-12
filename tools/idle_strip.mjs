#!/usr/bin/env node
// A strip of the posed skeleton (client/src/gait.js with its idle layer, client/src/idle.js) to a PNG: an act played on a
// rigged GLB's skeleton, drawn from the side (top row) and the front (bottom row) at evenly spaced moments, so the pose can
// be looked at without a browser. Bones as lines (the spine and head pale, the left legs red, the right blue, the tail
// brown, the ears green), joints as dots, the nose and the ear tips marked, the planted feet as squares, the ground line.
//
//   ~/.nvm/versions/node/v24.13.0/bin/node tools/idle_strip.mjs coyote --act scratch [--frames 8] [--from 0] [--over 3] [--out file.png]
//   (a model: coyote, elk_cow, fauna/canis_lupus, hero/canis_lupus ...; --act: an act's name, or idle, sit, bed, walk, gallop;
//   --size 150: a cell's height in pixels; --seed: the individual; trot: 0.75 of the trot's top; gallop: the row's cruise or 1.6 x the trot's top,
//   the larger; --engine <file>: draw with another copy of gait.js)
// The act is asked for at 2 s, after the body has settled; --from is seconds after that, --over the span the frames cover.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';
const G = await import(process.argv.includes('--engine') ? pathToFileURL(resolve(process.argv[process.argv.indexOf('--engine') + 1])).href : '../client/src/gait.js');   // --engine: another copy of gait.js (a before and after)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (k, d) => argv.includes(k) ? argv[argv.indexOf(k) + 1] : d;
const name = argv.find((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--')) || 'coyote';
const ACT = opt('--act', 'idle'), N = +opt('--frames', 8), FROM = +opt('--from', 0), OVER = +opt('--over', 3), CELL = +opt('--size', 150);
const OUT = opt('--out', join('/private/tmp/claude-501/-Users-aaronbrodeur-Sites-wild-earth--claude-worktrees-angry-darwin-f5a92b/15c0cd17-42b0-4e64-950f-b2e5d7088348/scratchpad/idle', `${name.replace('/', '_')}_${ACT}.png`));
const TILES = ['utm12n_514_4838', 'utm12n_557_4964', 'utm10n_680_4280', 'utm10n_429_5293', 'utm11n_270_4180', 'utm10n_731_4235'];

// ---- the body ----
const TREE = JSON.parse(readFileSync(join(ROOT, 'library/animals/locomotion.json'), 'utf8'));
const noNotes = o => o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'note').map(([k, v]) => [k, noNotes(v)])) : o;
const mergeT = (a, b) => { const o = { ...a }; for (const k in b) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? mergeT(a[k], b[k]) : b[k]; return o; };
export function loadModel(name) {
  const buf = readFileSync(join(ROOT, 'client/assets', `${name}.glb`)), n = buf.readUInt32LE(12), ex = JSON.parse(buf.toString('utf8', 20, 20 + n)).extras;
  let row = null, from = '';
  for (const t of TILES) { try { row = JSON.parse(readFileSync(join(ROOT, 'tiles', t, 'locomotion.json'), 'utf8')).species[ex.species] || null; } catch { row = null; } if (row) { from = `tiles/${t}`; break; } }
  if (!row) {
    const tp = join(ROOT, 'library/animals/traits', `${ex.species}.json`);
    if (existsSync(tp)) {
      const rec = JSON.parse(readFileSync(tp, 'utf8')); row = { ...(rec.locomotion || {}) }; from = 'traits (idle from the tree)';
      let idle = {}; for (const r of ['kingdom', 'phylum', 'class', 'order', 'family', 'genus']) { const b = TREE.taxa[rec.taxonomy?.[r]]?.idle; if (b) idle = mergeT(idle, noNotes(b)); }
      row.idle = idle;
    }
  }
  return { name, species: ex.species, skel: G.skeletonOf(ex.skin), row, from };
}

// ---- a tiny rasteriser ----
function canvas(w, h, bg) { const d = new Uint8Array(w * h * 3); for (let i = 0; i < w * h; i++) d.set(bg, i * 3); return { w, h, d }; }
function px(C, x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= C.w || y >= C.h) return; C.d.set(c, (y * C.w + x) * 3); }
function line(C, x0, y0, x1, y1, c, wd = 1) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
  for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; for (let a = -wd + 1; a < wd; a++) for (let b = -wd + 1; b < wd; b++) px(C, x + a, y + b, c); }
}
function dot(C, x, y, r, c) { for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= r * r) px(C, x + a, y + b, c); }
function square(C, x, y, r, c) { for (let a = -r; a <= r; a++) { px(C, x + a, y - r, c); px(C, x + a, y + r, c); px(C, x - r, y + a, c); px(C, x + r, y + a, c); } }
function png(C) {
  const raw = Buffer.alloc((C.w * 3 + 1) * C.h);
  for (let y = 0; y < C.h; y++) { raw[y * (C.w * 3 + 1)] = 0; Buffer.from(C.d.buffer, y * C.w * 3, C.w * 3).copy(raw, y * (C.w * 3 + 1) + 1); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(t), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(C.w, 0); ih.writeUInt32BE(C.h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- the posed skeleton: every bone as [from, to, colour] in the body's frame ----
const COL = { trunk: [235, 235, 225], head: [250, 210, 80], L: [220, 70, 50], R: [60, 110, 230], tail: [170, 120, 70], ear: [60, 200, 90], ground: [120, 120, 110], foot: [40, 40, 40] };
export function bonesOf(skel, st) {
  const P = st.P, E = st.E, R = skel.rest, J = skel.idx, out = [];
  const CH = { Hips: 'Spine', Spine: 'Chest', Chest: 'Neck', Neck: 'Head', Tail1: 'Tail2', Tail2: 'Tail3' };
  for (let j = 0; j < skel.n; j++) {
    const nm = skel.names[j], p = P[j]; if (!p) continue;
    let q, c;
    if (CH[nm]) { q = P[J[CH[nm]]]; c = /Tail/.test(nm) ? COL.tail : nm === 'Neck' ? COL.head : COL.trunk; }
    else if (/^(UpperLeg|LowerLeg)/.test(nm)) { q = P[j + 1]; c = /L$/.test(nm) ? COL.L : COL.R; }
    else if (skel.attach?.[j] && st.M?.[j]) { const tip = (skel.ears?.find(e => e.j === j) || skel.scut).tip, M = st.M[j], d = [tip[0] - R[j][0], tip[1] - R[j][1], tip[2] - R[j][2]]; q = [p[0] + M[0] * d[0] + M[1] * d[1] + M[2] * d[2], p[1] + M[3] * d[0] + M[4] * d[1] + M[5] * d[2], p[2] + M[6] * d[0] + M[7] * d[1] + M[8] * d[2]]; c = COL.ear; }
    else { q = E[j] || p; c = nm === 'Head' ? COL.head : nm === 'Tail3' ? COL.tail : /L$/.test(nm) ? COL.L : COL.R; }
    out.push([p, q, c, nm]);
  }
  return out;
}

// ---- the run ----
if (process.argv[1] && process.argv[1].endsWith('idle_strip.mjs')) {
  const M = loadModel(name), skel = M.skel, P = G.gaitParams(M.row, skel), Q = G.individualParams(P, G.seedOf(opt('--seed', `idle:${name}`)), skel.h / P.h);
  const st = G.makeGait(), out = new Float32Array(skel.n * 12), DT = 1 / 120;
  const inp = { x: 0, y: 0, z: 0, yaw: 0, size: 1, v: 0, wr: 0, pose: 0, flick: 0, bend: 0, twitch: 0, terrain: () => 0, air: false, t: 1000, sit: 0, act: 'none', look: null };
  const acts = ['shake', 'scratch', 'stretch', 'sit', 'sniff', 'stamp', 'groom', 'wash'];
  const frames = [], times = []; for (let k = 0; k < N; k++) times.push(2 + FROM + OVER * k / Math.max(1, N - 1));
  let t = 0, z = 0;
  while (frames.length < N) {
    t += DT; inp.t += DT;
    if (acts.includes(ACT)) { inp.act = t > 2 ? ACT : 'none'; if (Q.ind) Q._noGate = argv.includes('--nogate'); }
    else if (ACT === 'sit') inp.sit = 1; else if (ACT === 'bed') inp.pose = 1; else if (ACT === 'walk' || ACT === 'trot' || ACT === 'gallop') inp.v = t > 2 ? (ACT === 'walk' ? 0.6 * Q.vw : ACT === 'trot' ? 0.75 * Q.vt : Math.max(M.row?.cruise_mps || 0, 1.6 * Q.vt)) : 0;
    else if (ACT === 'alert') inp.flick = -1; else if (ACT === 'graze') inp.flick = 1; else if (ACT === 'idle') inp.act = '';
    z += inp.v * DT; inp.z = z;
    G.gaitStep(skel, Q, st, inp, DT); G.writeRow(skel, st, out, 0);
    if (t >= times[frames.length]) frames.push({ t, bones: bonesOf(skel, st), feet: st.feet.map(F => [F.x, F.y, F.z - z, F.stance]), act: st.id?.D?.act || '' });
  }
  // the frame: the skeleton's rest bounds with a margin
  const h = skel.h, W = Math.round(CELL * 1.25), H = CELL, sc = H / (1.75 * h);
  const C = canvas(W * N, H * 2, [36, 40, 44]);
  frames.forEach((f, k) => {
    for (let v = 0; v < 2; v++) {   // 0: the side (z to the right, the nose right), 1: the front (x to the right, seen from ahead)
      const ox = k * W + W / 2 + (v ? 0 : -0.1 * W), oy = v * H + H - 0.12 * H, P2 = p => [ox + (v ? -p[0] : p[2]) * sc, oy - p[1] * sc];
      line(C, k * W + 2, oy, k * W + W - 3, oy, COL.ground);
      for (const [x, y, zz, s] of f.feet) { const [a, b] = P2([x, y, zz]); square(C, a, b, 2, s ? COL.foot : [90, 90, 90]); }
      const order = v ? f.bones : [...f.bones].sort((a, b) => (/R$|\.R/.test(a[3]) ? -1 : 0) - (/R$|\.R/.test(b[3]) ? -1 : 0));   // (the far side first from the side)
      for (const [p, q, c] of order) { const [a, b] = P2(p), [x, y] = P2(q); line(C, a, b, x, y, c, 2); dot(C, a, b, 2, c); }
      for (const [, q, c, n] of f.bones) if (n === 'Head' || /^Ear/.test(n) || skel.ears?.some(e => skel.names[e.j] === n)) { const [x, y] = P2(q); dot(C, x, y, 3, n === 'Head' ? [255, 255, 255] : COL.ear); }
      line(C, k * W, v * H, k * W, v * H + H - 1, [70, 74, 78]);
    }
  });
  mkdirSync(dirname(OUT), { recursive: true });
  const buf = png(C); writeFileSync(OUT, buf);
  console.log(`${OUT}: ${N} frames of ${name} (${M.species}, ${M.from || 'no row'}), ${ACT}, ${times.map(x => (x - 2).toFixed(2)).join(' ')} s after the ask; acts seen: ${[...new Set(frames.map(f => f.act))].join(',') || '-'}; ${(buf.length / 1024).toFixed(0)} KB`);
}
