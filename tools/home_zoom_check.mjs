// The home screen's flight to a place frames its tile (Aaron, 2026-11-07: "When clicking on the label, the dot or the
// card, the view should zoom to this zoom level. Right now the view zooms to somewhere not the tile"). Every entry point
// (the place's row in the list, its label on the map, its dot) from several starting views (far out, near another place,
// the tile near the earth's limb, after a deselect): when the flight ends, the tile's centre must be within 3% of the free
// centre's middle across, its near edge within 3% (of the stage's height) of the stage's bottom (title.js chosenPose:
// "The tile's final zoom resting point should be more like this", 2026-11-08), and the tile's middle 60-101% of the free
// centre's width (all of it unless the rings' stack meets the stage's top first).
// Then, on a cold and throttled load where the flight waits for the world, the tile must stay centred across and its
// centre on the stage all the while it waits (still far off, so its near edge is not yet down on the stage's bottom).
// The bug: the wait began with the travel 60% done, the tile off screen for as long as the build took.
//
//   tools/mp/chromes.sh 9500 &           # a headless Chrome (or any Chrome with --remote-debugging-port)
//   node tools/home_zoom_check.mjs --port 8781 --chrome 9500 [--tile utm12n_514_4838] [--size 1440x900] [--mode stub|guest|signin]
//
// --mode signin signs in on the local hub as --user/--password (a local test account; never the live site). Exit code 1
// on any failure; each case is printed. Node 22+.
import { Page } from './mp/cdp.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = arg('port', '8781'), CHROME = +arg('chrome', '9500'), TILE = arg('tile', 'utm12n_514_4838'), OTHER = arg('other', 'utm10n_680_4280');
const [W, H] = arg('size', '1440x900').split('x').map(Number), MODE = arg('mode', 'stub'), phone = W < 720;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await new Page(CHROME).open();
const ev = js => page.eval(js);
const until = async (js, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(js).catch(() => false)) return true; await sleep(200); } return false; };
await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: phone });
const base = `http://127.0.0.1:${PORT}/client/`;
if (MODE !== 'stub') {
  await page.nav(base); await sleep(1500);
  const sign = MODE === 'signin' ? `await fetch('/api/hub/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ${JSON.stringify(arg('user', 'aaron_t'))}, password: ${JSON.stringify(arg('password', 'local-test-pass-1'))} }) });` : '';
  await ev(`await fetch('/api/hub/signout', { method: 'POST' }); ${sign} return 1;`);
}
const open = async (tile, cold = false) => {
  if (cold) { await page.send('Network.enable'); await page.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 20e6 / 8, uploadThroughput: 20e6 / 8 }); }
  await page.nav(`${base}?${MODE === 'stub' ? 'hub=stub&' : ''}tile=${tile}`);
  if (!await until(`return window.__weTitle?.phase === 'lit' && window.__weTitle?.landed && document.querySelector('.tt-wrap.listed')`, 150000)) throw new Error('the home screen never lit');
  await sleep(2000);
  await ev(`const m = await import('./src/mapGlobe.js'); window.__zcLatLon = m.latLonToXYZ; return 1;`);
};
// the tile's place on screen against the focus area (title.js focusArea, freeArea, screenOf)
const MEASURE = `const t = window.__weTitle, p = t.byId['${TILE}'], W = innerWidth, H = innerHeight, a = t.stageArea(W, H), [fl, fr] = t.freeArea(W);
  const [w, s, e, n] = p.bounds, lat = (s + n) / 2, c = t.screenOf(p.p0), L = t.screenOf(window.__zcLatLon(lat, w)), R = t.screenOf(window.__zcLatLon(lat, e));
  const near = Math.max(...[w, (w + e) / 2, e].map(lo => t.screenOf(window.__zcLatLon(s, lo))?.[1] ?? -1e9));
  return { sel: t.sel, dx: c ? (c[0] - (fl + fr) / 2) / (fr - fl) : null, dy: c ? (near - a.b) / (a.b - a.t) : null,
    onScreen: !!c && c[0] > 0 && c[0] < W && c[1] > 0 && c[1] < H, inStage: !!c && c[1] > a.t && c[1] < a.b, ofWindow: L && R ? Math.abs(R[0] - L[0]) / W : null, ofFree: L && R ? Math.abs(R[0] - L[0]) / (fr - fl) : null };`;
const settle = async () => { await until(`const t = window.__weTitle; return !t.flying && Math.abs(Math.log(t.alt / t.altGoal)) < 0.003`); await sleep(800); };
let fails = 0;
const report = (name, ok, m) => { fails += !ok; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${JSON.stringify(m, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v)}`); };

await open(OTHER);
const views = {
  far: async () => { await ev(`const t = window.__weTitle; t.unchoose?.(); t.stopFlight(); t.altGoal = t.alt = 2.5; return 1;`); await sleep(1500); },
  nearOther: async () => { await ev(`window.__weTitle.choose('${OTHER}'); return 1;`); await settle(); },
  limb: async () => { await ev(`const t = window.__weTitle; t.unchoose?.(); t.stopFlight(); t.yaw += 1.05; t.altGoal = t.alt = 1.2; return 1;`); await sleep(1500); },
  afterDeselect: async () => { await ev(`window.__weTitle.choose('${TILE}'); return 1;`); await settle(); await ev(`const t = window.__weTitle; t.unchoose(); t.altGoal = t.alt * 4; return 1;`); await sleep(1500); },
};
const press = {
  row: () => ev(`document.querySelector('.tt-row[data-tile=${TILE}]')?.click(); return window.__weTitle.sel === '${TILE}';`),
  label: () => ev(`const p = window.__weTitle.byId['${TILE}']; if (!p.label.classList.contains('on')) return null; p.label.click(); return true;`),
  dot: async () => {
    const d = await ev(`const p = window.__weTitle.byId['${TILE}']; return p.onScreen ? [p.sx, p.sy] : null;`); if (!d) return null;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: d[0], y: d[1] }); await sleep(200);
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: d[0], y: d[1], button: 'left', clickCount: 1 });
    await sleep(200); return ev(`return window.__weTitle.sel === '${TILE}';`);
  },
};
for (const [view, set] of Object.entries(views)) for (const [how, go] of Object.entries(press)) {
  await set(); await sleep(400);
  const pressed = await go();
  if (pressed === null) { console.log(`skip ${view} ${how}: not on screen from there`); continue; }
  if (!pressed) { report(`${view} ${how}`, false, { why: 'nothing chosen' }); continue; }
  await settle();
  const m = await ev(MEASURE);
  const sized = m.ofFree >= 0.6 && m.ofFree <= 1.01;
  report(`${view} ${how}`, m.sel === TILE && Math.abs(m.dx) <= 0.03 && Math.abs(m.dy) <= 0.03 && sized, m);
}
// the wait for a cold, throttled world: the tile centred and on screen throughout
await open(OTHER === TILE ? 'utm17n_210_932' : OTHER, true);
const held = await ev(`const t = window.__weTitle; t.choose('${TILE}'); const T0 = performance.now(), worst = { d: 0, off: 0, n: 0 };
  await new Promise(done => { const iv = setInterval(() => { const f = t.flying, u = f ? Math.min(1, f.t / f.ms) : 1;
    if (f?.rate && f.rate(u) < 0.5) { const m = (() => { ${MEASURE} })(); worst.n++; if (!m.onScreen || !m.inStage) worst.off++; worst.d = Math.max(worst.d, Math.abs(m.dx ?? 9)); }
    if (!t.flying && performance.now() - T0 > 500 || performance.now() - T0 > 150000) { clearInterval(iv); done(); } }, 250); });
  return worst;`);
report('held flight (cold, 20 Mbit/s)', held.off === 0 && held.d <= 0.03, held);
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
