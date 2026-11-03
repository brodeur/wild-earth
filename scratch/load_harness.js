// one call: load the capture harness files into the page (scratch)
window.__loadHarness = async () => { for (const f of ['whitewater_harness.js', 'cliff_poses.js', 'cliff_diag.js']) { const s = document.createElement('script'); s.src = '/scratch/' + f + '?v=' + Date.now(); document.head.append(s); await new Promise(r => s.onload = r); } return true; };
// keep a page alive while it works: await window.__pump(cond) in short calls (a hidden pane runs only while a call is open)
window.__pump = async (cond, max = 40000) => { const t0 = performance.now(); while (!cond() && performance.now() - t0 < max) await new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => setTimeout(r, 100); c.port2.postMessage(0); }); return cond(); };
