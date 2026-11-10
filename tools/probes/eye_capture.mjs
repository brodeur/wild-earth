// The held-out judge's eye-level captures (tools/probes/eye_level.py; docs/held-out-judge.md): the viewer's frame from
// each selected photo's camera point, at eye height, level, a 75-degree lens, toward the photo's heading; where the
// heading is unknown, eight bearings (eye_level.py then keeps the bearing and the tilt whose skyline fits the photo's).
//   node tools/probes/eye_capture.mjs <cdpPort> <viewer base url> <tile> <receiverPort> [hour]
// Needs a viewer serving this checkout, a headless Chrome with --remote-debugging-port, and
// tools/probes/receiver.py <receiverPort> tiles/<tile>/_cache/judge/renders. It opens its own tab and closes it.
import { readFileSync, writeFileSync } from 'node:fs';
const [port, base, tile, rport, hourArg] = process.argv.slice(2);
const hour = +(hourArg || 11), EYE_M = 1.6, FOV = 75;   // a tall frame: eye_level.py cuts a 45-degree window from it, at the tilt whose skyline fits the photo
const root = new URL('../../', import.meta.url).pathname;
const photos = JSON.parse(readFileSync(`${root}tiles/${tile}/judge/eye_photos.json`, 'utf8')).photos;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tabs.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 600000 }); if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text }; return r.result?.result?.value; };
const close = () => fetch(`http://127.0.0.1:${port}/json/close/${tabs.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 853, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${base}/client/?tile=${tile}&skip=1` });
const t0 = Date.now(); let ready = false;
while (Date.now() - t0 < 600000) { await new Promise(r => setTimeout(r, 5000)); ready = await ev('!!(window.__weWorld && window.__weWorld()?.ready)'); if (ready === true) break; }
if (ready !== true) { console.log(JSON.stringify({ ready, err: await ev('document.body.innerText.slice(0,200)') })); await close(); process.exit(1); }
console.log(JSON.stringify({ ready, loadSeconds: Math.round((Date.now() - t0) / 1000) }));
await ev(`new Promise(r => { const s = document.createElement('script'); s.src = '/scratch/whitewater_harness.js?v=' + Date.now(); s.onload = r; document.head.append(s); })`);
// colour captures: the spirit look off; a clear sky (the photos are fair-weather shots; the day's haze stays)
await ev(`(async () => { const we = window.__we; we.spirit.on = false; we.setFov && we.setFov(${FOV}); we.setHour(${hour});
  const W = we.weather, wup = W.update; W.update = function (dt, h) { const fx = wup.call(this, dt, h); Object.assign(fx, { slab: 0, high: 0, overcast: 0, sunDim: 1, fog: 0, rain: 0, drizzle: 0, snow: 0, flash: 0, rainVis: 0 }); return fx; };
  await window.__ww.wait(3000); return 1; })()`);
const out = { tile, hour, eye_m: EYE_M, render_fov_deg: FOV, viewer: base, at: new Date().toISOString(), renders: [] };
for (const p of photos) {
  const bearings = p.heading == null ? [0, 45, 90, 135, 180, 225, 270, 315] : [Math.round(p.heading)];
  const date = p.month ? String(p.month).padStart(2, '0') + '-15' : '';
  for (const b of bearings) {
    const name = `${p.id}_b${String(b).padStart(3, '0')}`;
    const r = await ev(`(async () => { const we = window.__we, H = window.__ww; we.setDate(${JSON.stringify(date)}); we.setHour(${hour});
      const x = ${p.x}, n = ${p.north}, a = ${b} * Math.PI / 180, tx = x + 300 * Math.sin(a), tn = n + 300 * Math.cos(a);
      const hs = we.tile.heights, level = hs.atXZ(x, -n) + ${EYE_M} - hs.atXZ(tx, -tn);   // a level camera
      await H.view(x, n, ${EYE_M}, tx, tn, level); await H.wait(2500);
      const saved = await H.save(${JSON.stringify(name)}, 0.85, ${+rport});
      return { saved: saved.slice(-60), ground_m: +hs.atXZ(x, -n).toFixed(1), fov: we.camera.fov }; })()`);
    out.renders.push({ photo: p.id, bearing: b, heading_known: p.heading != null, date: date || 'today', file: name + '.jpg', ...(r || {}) });
    console.log(name, JSON.stringify(r));
  }
}
out.shader_errors = await ev(`(window.__weRenderer?.info?.programs || []).filter(p => p.diagnostics).length`);
writeFileSync(`${root}tiles/${tile}/_cache/judge/renders/captures.json`, JSON.stringify(out, null, 1));
await close();
process.exit(0);
