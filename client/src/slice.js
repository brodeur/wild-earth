// Time-slicing for the world build (2026-10-26). The build runs while the opening screen is up, and a task that holds
// the main thread for seconds freezes the screen's hover and clicks, so every long loop of the build is written as a
// generator that `yield`s at cheap checkpoints (after a tree is grown, a row of cells is planned, a terrain chunk is
// laid), and runSliced() steps it, giving the main thread back between steps whenever SLICE_MS has passed. The work
// and its order are exactly the synchronous loop's: only where the task boundaries fall changes. drain() runs a
// generator to its end in one go (the same result, for callers that want it synchronously).
//
//   await yieldToMain()           one turn of the event loop: scheduler.yield() where the browser has it (the rest of
//                                 the build keeps its place in the queue), else a MessageChannel message (setTimeout(0)
//                                 is clamped to 4 ms once nested, which a build of thousands of slices would feel)
//   await runSliced(gen, label, { signal })   step gen to its end in slices of about SLICE_MS; resolves with gen's
//                                 return value (a step that yields a promise waits for it: `yield p` in place of
//                                 `await p`). With an AbortSignal (main.js: a world whose build was abandoned) it stops
//                                 at the next step after the abort: gen.return() runs and the call rejects with the
//                                 signal's reason, so no more than one slice of an abandoned build ever runs.
//   drain(gen)                    the same, synchronously
//   slicer()                      for an async loop: `const tick = slicer(); ... if (tick.due()) await tick.yield();`
//
// Every step longer than LONG_MS is counted in sliceStats (label, ms), so a checkpoint too coarse for the budget shows.

export const SLICE_MS = 10, LONG_MS = 50;
export const sliceStats = { slices: 0, yields: 0, long: [] };

const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null, waiting = [];
if (channel) channel.port1.onmessage = () => waiting.shift()?.();
export function yieldToMain() {
  sliceStats.yields++;
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  if (channel) return new Promise(r => { waiting.push(r); channel.port2.postMessage(0); });
  return new Promise(r => setTimeout(r, 0));
}

export function slicer(budget = SLICE_MS) {
  let t = performance.now();
  return {
    due: () => performance.now() - t > budget,
    yield: async () => { await yieldToMain(); t = performance.now(); },
  };
}

export const aborted = signal => signal?.reason ?? new DOMException('the build was abandoned', 'AbortError');
export async function runSliced(gen, label = '', { budget = SLICE_MS, signal = null } = {}) {
  let t = performance.now(), step = t, r, from, input;   // from: what the generator yielded before this step (a label, if any)
  for (;;) {
    if (signal?.aborted) { gen.return(); throw aborted(signal); }
    r = gen.next(input); input = undefined;
    const now = performance.now();
    if (now - step > LONG_MS) sliceStats.long.push({ label: from ? `${label}: ${from}` : label, ms: Math.round(now - step), at: Math.round(step) });
    from = r.value;
    if (r.done) break;
    if (typeof r.value?.then === 'function') { input = await r.value; from = null; t = step = performance.now(); }   // its value is what the yield returns
    else if (now - t > budget) { sliceStats.slices++; await yieldToMain(); t = step = performance.now(); } else step = now;
  }
  return r.value;
}

export function drain(gen) {   // a yielded promise is not waited for here (the step after it runs at once, as sync code would)
  let r; do r = gen.next(); while (!r.done);
  return r.value;
}
