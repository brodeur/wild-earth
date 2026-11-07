// Who sees whom, end to end (docs/multiplayer.md "Who sees whom"): three signed-in pages on a local hub, A and B in a
// group, C a stranger, all in one tile; each case puts the players in forms and checks what every viewer draws of the
// others, both ways, from the page's own state (players.js slots, the remote bodies in animals.js), and screenshots each
// viewer's side with a camera aimed at the other player (or at where a hidden one really is). Strips per case are made by
// strip.py beside this file.
//
//   tools/mp/chromes.sh 9361 9362 9363                 # three headless Chromes, own profiles (own cookies)
//   WE_TEST_PASSWORD=... node tools/mp/visibility.mjs --base http://127.0.0.1:8821 --ports 9361,9362,9363 \
//       --names mpv_a,mpv_b,mpv_c --tile utm10n_680_4280 --out scratch/mp-visibility
//
// Local hubs only (the accounts are made if missing): never point it at the live site. The password comes from the
// environment and is never printed. Exit status 0 when every check passed.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Page } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://127.0.0.1:8821'), TILE = arg('tile', 'utm10n_680_4280'), OUT = arg('out', 'scratch/mp-visibility');
const PORTS = arg('ports', '9361,9362,9363').split(',').map(Number), NAMES = arg('names', 'mpv_a,mpv_b,mpv_c').split(',');
const ONLY = arg('only', null)?.split(',') || null, SKIP_SETUP = process.argv.includes('--in-world');
const PW = process.env.WE_TEST_PASSWORD;
if (!PW) { console.error('set WE_TEST_PASSWORD'); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(BASE)) { console.error('local hubs only'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const PAGE_JS = readFileSync(join(HERE, 'page.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = [], strips = [];

// ---- the pages ------------------------------------------------------------------------------------------------------
const P = {};   // A, B, C: { page, name, uid }
async function ev(who, expr, timeout) { return P[who].page.eval(expr, timeout); }
async function mpt(who, call) { return ev(who, `if (!window.__mpt) { ${PAGE_JS} } return __mpt.${call};`); }
async function until(who, call, ok, ms = 60000, every = 500) {
  const t0 = Date.now(); let v;
  for (;;) {
    try { v = await mpt(who, call); if (ok(v)) return v; } catch (e) { v = String(e).slice(0, 200); }
    if (Date.now() - t0 > ms) return { timeout: true, last: v };
    await sleep(every);
  }
}

async function signIn(who) {
  const p = P[who];
  await p.page.nav(`${BASE}/client/`); await sleep(2500);
  const body = JSON.stringify({ name: p.name, password: PW });
  const st = await p.page.eval(`const h = { 'Content-Type': 'application/json' };
    let r = await fetch('/api/hub/signin', { method: 'POST', headers: h, body: ${JSON.stringify(body)} });
    if (r.status !== 200) r = await fetch('/api/hub/signup', { method: 'POST', headers: h, body: ${JSON.stringify(body)} });
    return r.status;`);
  if (st !== 200) throw new Error(`${p.name}: sign-in ${st}`);
  await p.page.nav(`${BASE}/client/`);
  const v = await until(who, 'connected() && __mpt.uid()', x => !!x, 90000);
  if (v?.timeout) throw new Error(`${p.name}: hub not connected`);
  p.uid = v;
}
async function ensureGroup() {
  const [a, b, c] = ['A', 'B', 'C'].map(k => P[k]);
  if (await mpt('A', `groupWith(${JSON.stringify(b.uid)})`)) { log('A and B share a group'); }
  else {
    await ev('A', `__weMp.hub.send({ t: 'friend', op: 'request', user: ${JSON.stringify(b.uid)} }); return 1;`); await sleep(800);
    await ev('B', `__weMp.hub.send({ t: 'friend', op: 'accept', user: ${JSON.stringify(a.uid)} }); return 1;`); await sleep(800);
    await ev('A', `__weMp.hub.send({ t: 'group', op: 'create', name: 'Visibility test', users: [${JSON.stringify(b.uid)}] }); return 1;`);
    const g = await until('A', `groupWith(${JSON.stringify(b.uid)})`, x => x === true, 15000);
    if (g !== true) throw new Error('could not make the group');
  }
  for (const k of ['A', 'B']) if (await mpt(k, `groupWith(${JSON.stringify(c.uid)})`)) throw new Error(`${P[k].name} shares a group with ${c.name}: use another name for the stranger`);
}
async function start(who) {
  const r = await ev(who, `const W = ms => new Promise(r => setTimeout(r, ms)), T = ${JSON.stringify(TILE)}, t0 = performance.now();
    while (window.__weTitle?.phase !== 'lit' || window.__weTitle.closed) { if (performance.now() - t0 > 90000) return 'no title'; await W(400); }
    const t = window.__weTitle; t.choose(T);
    while (!t.readyIds.has(T)) { if (performance.now() - t0 > 240000) return 'not ready'; await W(600); }
    t.begin(); return 'begun';`, 300000);
  if (r !== 'begun') throw new Error(`${P[who].name}: ${r}`);
  const w = await until(who, 'inWorld() && !__mpt.arriving()', x => x === true, 400000, 1500);
  if (w !== true) { await ev(who, `dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX' })); return 1;`); await until(who, 'inWorld() && !__mpt.arriving()', x => x === true, 60000, 1000); }
  await mpt(who, 'declineToasts()');
}

// ---- checks and shots -----------------------------------------------------------------------------------------------
// want: 'spirit' (the wisp shown), a species code (the body drawn as it), or 'hidden' (nothing drawn of them).
function meets(v, want) {
  if (want === 'hidden') return !v.seen;
  if (!v.seen) return false;
  if (want === 'spirit') return v.form === 'spirit' && v.shown && !v.body;
  return v.form === want && v.body && v.drawn;
}
async function expect(cs, viewer, subject, want, ms = 30000) {
  const id = JSON.stringify(P[subject].uid), t0 = Date.now();
  let v = await until(viewer, `vis(${id})`, x => meets(x, want), ms, 400);
  if (want === 'hidden' && !v?.timeout) {   // and it stays hidden (not only between two samples)
    await sleep(2500); v = await mpt(viewer, `vis(${id})`);
  }
  const ok = !v?.timeout && meets(v, want);
  const got = v?.timeout ? v.last : v;
  results.push({ case: cs, viewer: P[viewer].name, subject: P[subject].name, want, ok, got: got?.seen === false ? 'hidden' : got, ms: Date.now() - t0 });
  log(ok ? 'ok  ' : 'FAIL', cs, `${P[viewer].name} sees ${P[subject].name}:`, want, ok ? '' : JSON.stringify(got));
  return ok;
}
// The viewer's side, aimed at the subject: where the viewer draws them, else where they really are.
async function shoot(cs, viewer, subject, tag = '') {
  const id = JSON.stringify(P[subject].uid);
  const v = await mpt(viewer, `vis(${id})`), me = await mpt(viewer, 'pos()');
  const at = v?.at || await mpt(subject, 'pos()');
  await mpt(viewer, `aim(${JSON.stringify(at)}, ${JSON.stringify(me)}, ${v?.body ? 4.5 : 5.5}, 1.5)`);
  await sleep(900);
  const file = join(OUT, `${cs}_${P[viewer].name}${tag}.jpg`);
  await P[viewer].page.shot(file);
  await mpt(viewer, 'cam(null)');
  return { file, caption: `${P[viewer].name} sees ${P[subject].name}: ${v?.seen ? (v.body ? v.form.replace(/_/g, ' ') : 'spirit') : 'nothing'}` };
}
function strip(cs, title, shots) {
  const out = join(OUT, `${cs}.jpg`), spec = JSON.stringify({ title, out, shots });
  try { execFileSync(join(HERE, '..', '..', '.venv', 'bin', 'python'), [join(HERE, 'strip.py'), spec], { stdio: 'inherit' }); strips.push(out); }
  catch (e) { log('strip failed', cs, String(e).slice(0, 200)); }
}
// Every spirit to the meeting point, spread so each sees the others (the wisps hover up m over the ground).
async function gather(M, who = ['A', 'B', 'C']) {
  const at = { A: [7, 0], B: [-6, 3], C: [0, -8] };
  for (const k of who) if ((await mpt(k, 'form()')) === 'spirit') await mpt(k, `goto(${M.x + at[k][0]}, ${M.z + at[k][1]}, 3)`);
}
const on = cs => !ONLY || ONLY.includes(cs);

// ---- the run --------------------------------------------------------------------------------------------------------
async function main() {
  ['A', 'B', 'C'].forEach((k, i) => { P[k] = { name: NAMES[i], port: PORTS[i] }; });
  for (const k of ['A', 'B', 'C']) P[k].page = await new Page(P[k].port).open();
  if (SKIP_SETUP) { for (const k of ['A', 'B', 'C']) P[k].uid = await mpt(k, 'uid()'); }
  else {
    for (const k of ['A', 'B', 'C']) { await signIn(k); log('signed in', P[k].name); }
    await ensureGroup();
    for (const k of ['C', 'B', 'A']) { await start(k); log('in the world', P[k].name, JSON.stringify(await mpt(k, 'room()'))); }
  }
  for (const k of ['A', 'B', 'C']) { if ((await mpt(k, 'form()')) !== 'spirit') await mpt(k, 'leave()'); await mpt(k, 'declineToasts()'); await mpt(k, 'noTouch()'); }
  // the meeting point: by a deer in the open near A, so the bodies taken stand among the spirits and the shots see them
  const a0 = await mpt('A', 'pos()'), deer = (await mpt('A', `openDeer(${a0.x}, ${a0.z})`))?.[0];
  const M = deer ? { x: deer.x, z: deer.z } : { x: a0.x, z: a0.z };
  log('meeting point', JSON.stringify(M), deer ? `by a deer, canopy ${deer.h.toFixed(1)} m, ${Math.round(deer.d)} m from A` : '(no deer near)');
  await gather(M); await sleep(3000);
  const both = (cs, x, y, wx, wy) => Promise.all([expect(cs, x, y, wx), expect(cs, y, x, wy)]);

  if (on('1')) {   // 1. strangers, both spirits
    await both('1_stranger_spirits', 'A', 'C', 'spirit', 'spirit');
    await expect('1_stranger_spirits', 'B', 'C', 'spirit');
    const v = await mpt('A', `vis(${JSON.stringify(P.C.uid)})`);
    results.push({ case: '1_stranger_spirits', viewer: P.A.name, subject: P.C.name, want: 'no edge avatar or map dot for a stranger', ok: !v.mark && !v.dot, got: v });
    results.push({ case: '1_stranger_spirits', viewer: P.A.name, subject: P.C.name, want: 'the stranger named by the hub', ok: v.name === P.C.name, got: v.name });
    strip('1_stranger_spirits', 'Strangers, both spirits: each sees the other\'s wisp', [await shoot('1_stranger_spirits', 'A', 'C'), await shoot('1_stranger_spirits', 'C', 'A')]);
  }
  if (on('2')) {   // 2 and 4. A into a deer: the stranger's spirit to an embodied viewer; the group sees the deer
    const e = await mpt('A', `embody('odocoileus_hemionus', ${M.x}, ${M.z})`); log('A embody', JSON.stringify(e));
    await sleep(1500); await gather(M, ['B', 'C']);
    await expect('2_stranger_spirit_to_body', 'A', 'C', 'spirit');
    await expect('2_stranger_spirit_to_body', 'C', 'A', 'hidden');
    strip('2_stranger_spirit_to_body', 'A stranger\'s spirit seen from a body; the body hidden from the stranger', [await shoot('2_stranger_spirit_to_body', 'A', 'C'), await shoot('2_stranger_spirit_to_body', 'C', 'A')]);
    await both('4_group_spirit_animal', 'B', 'A', 'odocoileus_hemionus', 'spirit');
    strip('4_group_spirit_animal', 'Group: a spirit and a deer see each other', [await shoot('4_group_spirit_animal', 'B', 'A'), await shoot('4_group_spirit_animal', 'A', 'B')]);
  }
  if (on('3')) {   // 3. the stranger embodied: hidden from A and B; it still sees B's spirit
    const sp = ['odocoileus_hemionus', 'sciurus_griseus', 'corvus_corax'];
    let e = null; for (const code of sp) { e = await mpt('C', `embody(${JSON.stringify(code)}, ${M.x}, ${M.z})`); if (e.ok) { e.code = code; break; } }
    log('C embody', JSON.stringify(e)); await sleep(1500); await gather(M, ['B']);
    await expect('3_stranger_body_hidden', 'B', 'C', 'hidden');
    await expect('3_stranger_body_hidden', 'A', 'C', 'hidden');
    await expect('3_stranger_body_hidden', 'C', 'B', 'spirit');
    strip('3_stranger_body_hidden', 'A stranger in a body is not shown as a player; from the body the group\'s spirit is', [await shoot('3_stranger_body_hidden', 'B', 'C'), await shoot('3_stranger_body_hidden', 'C', 'B')]);
  }
  if (on('5')) {   // 5. the group in two bodies, across species: B the raven, the squirrel, the woodpecker, a hawk
    const shots = [];
    for (const code of ['corvus_corax', 'sciurus_griseus', 'melanerpes_formicivorus', 'buteo_jamaicensis']) {
      const e = await mpt('B', `embody(${JSON.stringify(code)}, ${M.x}, ${M.z})`); log('B embody', code, JSON.stringify(e));
      if (!e.ok) { results.push({ case: '5_group_bodies', viewer: '-', subject: P.B.name, want: `into ${code}`, ok: false, got: e }); continue; }
      await sleep(1500);
      await both('5_group_bodies', 'A', 'B', code, 'odocoileus_hemionus');
      shots.push(await shoot('5_group_bodies', 'A', 'B', `_${code}`));
      if (code === 'corvus_corax') shots.push(await shoot('5_group_bodies', 'B', 'A', `_${code}`));
    }
    strip('5_group_bodies', 'Group: a deer and the other member in each body, seen in their own forms', shots);
  }
  if (on('6')) {   // 6. the transitions, from the group's side: A leaves the deer and goes into it again, B watching
    if ((await mpt('B', 'form()')) !== 'spirit') await mpt('B', 'leave()');
    if ((await mpt('A', 'form()')) === 'spirit') await mpt('A', `embody('odocoileus_hemionus', ${M.x}, ${M.z})`);
    await sleep(1500);
    const ap = await mpt('A', 'pos()'); await mpt('B', `goto(${ap.x - 6}, ${ap.z + 5}, 3)`); await sleep(2500);
    await expect('6_transitions', 'B', 'A', 'odocoileus_hemionus');
    const frames = async (tag, act, at) => {
      const bp = await mpt('B', 'pos()');
      await mpt('B', `aim(${JSON.stringify(at)}, ${JSON.stringify(bp)}, 6, 2)`); await sleep(700);
      const out = []; let acted = false;
      for (let i = 0; i < 7; i++) {
        const f = join(OUT, `6_transitions_${tag}_${i}.jpg`); await P.B.page.shot(f, 60);
        const v = await mpt('B', `vis(${JSON.stringify(P.A.uid)})`);
        out.push({ file: f, caption: `${tag} ${i}: ${v.seen ? (v.tr === 'in' ? 'diving in' : v.body ? 'deer' : 'spirit') : 'nothing'}` });
        if (!acted) { acted = true; await act(); }
      }
      await mpt('B', 'cam(null)');
      return out;
    };
    const leaveF = await frames('leave', () => mpt('A', 'leave()'), ap);
    await expect('6_transitions', 'B', 'A', 'spirit');
    await expect('6_transitions', 'C', 'A', 'spirit');   // out of the body: public again
    const deerNow = (await mpt('A', `near('odocoileus_hemionus', ${ap.x}, ${ap.z}, 60)`))?.[0];
    const tgt = deerNow || ap, mid = { x: (tgt.x + ap.x) / 2, y: Math.max(tgt.y, ap.y), z: (tgt.z + ap.z) / 2 };   // the wisp's way from where it is to the deer
    const enterF = await frames('embody', () => mpt('A', `embody('odocoileus_hemionus', ${tgt.x}, ${tgt.z})`), mid);
    await expect('6_transitions', 'B', 'A', 'odocoileus_hemionus');
    await expect('6_transitions', 'C', 'A', 'hidden');
    strip('6_transitions', 'A leaves the deer (the wisp grows out of it), then goes into it again (the wisp dives in): B\'s view', [...leaveF, ...enterF]);
  }
  if (on('7')) {   // 7. the season: C in winter is in another world: unseen both ways; back in fall, seen again
    for (const k of ['B', 'C']) if ((await mpt(k, 'form()')) !== 'spirit') await mpt(k, 'leave()');
    await sleep(1000); await gather(M, ['B', 'C']);
    await both('7_season', 'B', 'C', 'spirit', 'spirit');
    const was = await mpt('C', 'season()');
    await mpt('C', "setSeason('winter')");
    const r = await until('C', 'room()', x => x?.season === 'winter', 30000); log('C room', JSON.stringify(r));
    await sleep(2000); await gather(M, ['C']);
    await both('7_season', 'B', 'C', 'hidden', 'hidden');
    const shots = [await shoot('7_season', 'B', 'C', '_winter'), await shoot('7_season', 'C', 'B', '_winter')];
    await mpt('C', `setSeason(${JSON.stringify(was || 'fall')})`);
    await until('C', 'room()', x => x?.season === (was || 'fall'), 30000); await sleep(2000); await gather(M, ['C']);
    await both('7_season', 'B', 'C', 'spirit', 'spirit');
    shots.push(await shoot('7_season', 'B', 'C', '_back'));
    strip('7_season', `C changes the season to winter: another world, unseen both ways; back in ${was || 'fall'}, seen again`, shots);
  }
  if (on('8')) {   // 8. leaving the tile: C goes to the main screen and is gone for the others; so does B for A
    if ((await mpt('A', 'form()')) !== 'spirit') await mpt('A', 'leave()');
    await sleep(1000); await gather(M);
    await expect('8_leave_tile', 'A', 'C', 'spirit'); await expect('8_leave_tile', 'A', 'B', 'spirit');
    const before = await shoot('8_leave_tile', 'A', 'C', '_before');
    const cp = await mpt('C', 'pos()');
    await mpt('C', 'exit()'); await mpt('B', 'exit()');
    await expect('8_leave_tile', 'A', 'C', 'hidden', 8000); await expect('8_leave_tile', 'A', 'B', 'hidden', 8000);
    const ap = await mpt('A', 'pos()'); await mpt('A', `aim(${JSON.stringify(cp)}, ${JSON.stringify(ap)}, 9)`); await sleep(900);
    const f = join(OUT, `8_leave_tile_${P.A.name}_after.jpg`); await P.A.page.shot(f); await mpt('A', 'cam(null)');
    strip('8_leave_tile', 'C and B go to the main screen: gone for A', [before, { file: f, caption: `${P.A.name}: C and B gone` }]);
  }

  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ tile: TILE, results, strips }, null, 1));
  const bad = results.filter(r => !r.ok);
  log(`${results.length - bad.length}/${results.length} checks passed`); for (const r of bad) log('failed:', r.case, r.viewer, '->', r.subject, r.want);
  for (const k of ['A', 'B', 'C']) P[k].page.close();
  process.exit(bad.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(3); });
