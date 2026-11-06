// Headless capture of one probe (tools/probes/run.sh): node capture.mjs <cdpPort> <url> <prefix> <hour> <posesJSON>
// node capture.mjs <cdpPort> <url> <prefix> <hour> <posesJSON>
const [port, url, prefix, hour, posesJSON] = process.argv.slice(2);
const poses = JSON.parse(posesJSON);
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tabs.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 600000 }); if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text }; return r.result?.result?.value; };
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
const t0 = Date.now(); let ready = false;
while (Date.now() - t0 < 600000) { await new Promise(r => setTimeout(r, 5000)); ready = await ev('!!(window.__weWorld && window.__weWorld()?.ready)'); if (ready === true) break; }
const err = await Promise.race([ev('document.body.innerText.slice(0,200)'), new Promise(r => setTimeout(() => r('page busy'), 15000))]);
if (ready !== true) { console.log(JSON.stringify({ ready, err })); await fetch(`http://127.0.0.1:${port}/json/close/${tabs.id}`); process.exit(1); }
console.log(JSON.stringify({ ready, loadSeconds: Math.round((Date.now() - t0) / 1000), err }));
if (ready !== true) process.exit(1);
await ev(`new Promise(r => { const s = document.createElement('script'); s.src = '/scratch/whitewater_harness.js?v=' + Date.now(); s.onload = r; document.head.append(s); })`);
await ev(`(async () => { window.__we.spirit.on = false; await window.__ww.wait(3000); return 1; })()`);
const out = {};
// The top-down pose ('d_...') is judged against Sentinel-2 L2A, which is corrected for the atmosphere: it is rendered
// without the haze (the Mie and Rayleigh extinction zeroed for that one frame), so surface is compared with surface.
for (const [k, p] of Object.entries(poses)) {
  const clear = k.startsWith('d_');
  out[k] = await ev(`(async () => { const H = window.__ww; window.__we.setHour(${+hour}); await H.view(...${JSON.stringify(p)}); await H.wait(3000);
    let u = null, keep = null;
    if (${clear}) { u = (await import('/client/src/atmosphere.js')).uniforms; keep = [u.hazeDensity.value, u.hazeRayleigh.value.clone()]; u.hazeDensity.value = 0; u.hazeRayleigh.value.set(0, 0, 0); }
    const r = H.save(${JSON.stringify(prefix + '_')} + ${JSON.stringify(k)}, 0.82, 8811);
    if (u) { u.hazeDensity.value = keep[0]; u.hazeRayleigh.value.copy(keep[1]); }
    return (await r).slice(-40); })()`);
}
out.animals = await ev(`(() => { const A = window.__we.animals, bs = A.bySpecies, o = {}; if (Array.isArray(bs)) bs.forEach((v, i) => { const n = (v?.length ?? v?.size ?? 0); if (n) o[A.names?.[i] ?? i] = n; }); return o; })()`);
out.errors = await ev(`(window.__weRenderer?.info?.programs || []).filter(p => p.diagnostics).length`);
console.log(JSON.stringify(out));
await fetch(`http://127.0.0.1:${port}/json/close/${tabs.id}`);
process.exit(0);
