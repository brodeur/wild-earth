// requestAnimationFrame that keeps running in a pane with no compositor (scratch): callbacks are queued; the real rAF
// drives them while it fires, a 16 ms interval drives them when it has not fired for 250 ms
(() => {
  const real = window.requestAnimationFrame.bind(window); let q = [], last = performance.now(), id = 1;
  const run = t => { if (window.__rafPause) return; const cbs = q; q = []; for (const [, cb] of cbs) { try { cb(t); } catch (e) { console.error(e); } } };
  const tick = t => { last = performance.now(); run(t); real(tick); };
  real(tick);
  setInterval(() => { if (performance.now() - last > 250) run(performance.now()); }, 16);
  window.requestAnimationFrame = cb => { q.push([id, cb]); return id++; };
  window.cancelAnimationFrame = k => { q = q.filter(([i]) => i !== k); };
})();
