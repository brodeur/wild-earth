// The stride measures (docs/behaviour-rig.md 5 "Measured"; docs/movement.md "Strides that vary"): the leg engine run
// offline on a skeleton for a few hundred strides, and what a gait laboratory would report of it. Pure arithmetic over an
// engine module E (client/src/gait.js, or an older copy of it for a before and after), so the lineup page
// (lineupAnimals.js: __animalLineup.strides) and node (tools/gait_measure.mjs) run the same code.
//   strideStats   stride interval and stride length of the left hind foot: mean, coefficient of variation, the lag-1
//                 autocorrelation and the DFA exponent alpha (0.5: no memory; toward 1: the long memory of real stride
//                 series); each foot's lag behind the left hind and its spread; the spread of the feet's width; foot
//                 slide (how far a drawn toe moves over the ground while its foot stands); the cost of a frame
//   driftApart    pairs of individuals started in step at one speed: how long until they are a quarter stride apart
//   hostMirror    a host's animal streamed at 4 Hz as animalNet.js does (quantized, 4 Hz) and drawn by a mirror between
//                 samples as animals.js mirrorStep does, at the mirror's own frame rate: do the two pages' feet land in
//                 the same places
const TAU = Math.PI * 2;
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, a.length - 1)); };
const r1 = a => { const m = mean(a); let n = 0, d = 0; for (let i = 0; i < a.length; i++) { d += (a[i] - m) ** 2; if (i) n += (a[i] - m) * (a[i - 1] - m); } return d ? n / d : 0; };
const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
// Detrended fluctuation analysis (Peng et al. 1995, as Hausdorff et al. use it on stride intervals): the slope of
// log F(n) on log n, boxes of 4 to a quarter of the series
export function dfa(a) {
  const N = a.length, m = mean(a), y = new Float64Array(N); let c = 0;
  for (let i = 0; i < N; i++) { c += a[i] - m; y[i] = c; }
  const xs = [], ys = [];
  for (let n = 4; n <= N / 4; n = Math.max(n + 1, Math.round(n * 1.3))) {
    let f = 0, boxes = 0;
    for (let b = 0; b + n <= N; b += n) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < n; i++) { sx += i; sy += y[b + i]; sxx += i * i; sxy += i * y[b + i]; }
      const k = (n * sxy - sx * sy) / (n * sxx - sx * sx), q = (sy - k * sx) / n;
      for (let i = 0; i < n; i++) { const e = y[b + i] - (k * i + q); f += e * e; }
      boxes++;
    }
    if (boxes) { xs.push(Math.log(n)); ys.push(0.5 * Math.log(f / (boxes * n))); }
  }
  const mx = mean(xs), my = mean(ys); let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : NaN;
}
const inputs = (v, size, terrain) => ({ x: 0, y: 0, z: 0, yaw: 0, size, v, wr: 0, pose: 0, flick: 0, bend: 0, twitch: 0, terrain: terrain || (() => 0), air: false });

export function strideStats(E, skel, P, { v, strides = 300, dt = 1 / 480, size = 1, terrain = null, warm = 4, maxT = 900 } = {}) {
  const st = E.makeGait(), inp = inputs(v, size, terrain), ter = inp.terrain;
  let t = 0, z = 0;
  const step = () => { z += v * dt; t += dt; inp.z = z; inp.y = ter(0, z); E.gaitStep(skel, P, st, inp, dt); };
  while (t < warm) step();
  const was = st.feet.map(F => F.stance), T = [], L = [], lags = [[], [], [], []], wide = [[], [], [], []];
  let lastT = NaN, lastZ = NaN, period = NaN;
  const hold = [null, null, null, null], slides = []; let miss = 0;
  while (T.length < strides && t < maxT) {
    step();
    for (let i = 0; i < 4; i++) {
      const F = st.feet[i], Lg = skel.legs[i];
      const l = st.E[Lg.f], toe = [l[0] * size, z + l[2] * size];   // the drawn toe over the ground (yaw 0)
      if (F.stance && !was[i]) {   // a touchdown
        if (i === 2) { if (lastT === lastT) { period = t - lastT; T.push(period); L.push(F.z - lastZ); } lastT = t; lastZ = F.z; }
        else if (period === period && lastT === lastT) lags[i].push(((t - lastT) / period) % 1);
        wide[i].push(F.x);
        hold[i] = { x: toe[0], z: toe[1], d: 0 };
      }
      if (F.stance && hold[i]) { hold[i].d = Math.max(hold[i].d, Math.hypot(toe[0] - hold[i].x, toe[1] - hold[i].z)); miss = Math.max(miss, Math.hypot(toe[0] - F.x, toe[1] - F.z)); }
      if (!F.stance && was[i] && hold[i]) { slides.push(hold[i].d); hold[i] = null; }
      was[i] = F.stance;
    }
  }
  const circ = a => {   // a lag's circular mean and spread (cycle fractions)
    let c = 0, s = 0; for (const x of a) { c += Math.cos(TAU * x); s += Math.sin(TAU * x); }
    const m = (Math.atan2(s, c) / TAU + 1) % 1; return { mean: m, sd: sd(a.map(x => x - m - Math.round(x - m))) };
  };
  const track = Math.abs(skel.legs[0].toe[0] - skel.legs[1].toe[0]) * size || 1;
  return {
    v, strides: T.length, gait: st.gait,
    interval: { mean: mean(T), cv: sd(T) / mean(T), r1: r1(T), alpha: dfa(T) },
    length: { mean: mean(L), cv: sd(L) / mean(L), r1: r1(L) },
    lag: [0, 1, 3].map(i => circ(lags[i])),                              // FL, FR, HR behind the left hind
    width: [(sd(wide[0]) + sd(wide[1])) / 2 / track, (sd(wide[2]) + sd(wide[3])) / 2 / track],   // fore, hind: a foot's sd across, over the track
    slide: { mean: mean(slides), max: Math.max(0, ...slides), miss, hip: skel.h * size },   // m a stance; miss: the drawn toe off its plant point
  };
}

// the cost of a frame: microseconds for the engine's step and the pose row, at 60 frames a second
export function frameCost(E, skel, P, { v, n = 20000, size = 1 } = {}) {
  const st = E.makeGait(), inp = inputs(v, size, null), out = new Float32Array(skel.n * 12); let z = 0;
  for (let i = 0; i < 2000; i++) { z += v / 60; inp.z = z; E.gaitStep(skel, P, st, inp, 1 / 60); E.writeRow(skel, st, out, 0); }
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { z += v / 60; inp.z = z; E.gaitStep(skel, P, st, inp, 1 / 60); E.writeRow(skel, st, out, 0); }
  return (performance.now() - t0) * 1000 / n;
}

// Pairs of individuals of one species started side by side in step (the same stride clock) at speed v: the seconds and
// the strides until they are a quarter of a stride out of step. sameSize: both the species' size (only the tempo, the
// condition and the stride's drift differ); else each its own size drawn from the seed.
export function driftApart(E, skel, P, { v, pairs = 40, maxT = 600, dt = 1 / 60, sameSize = false } = {}) {
  const times = [], counts = [];
  for (let k = 0; k < pairs; k++) {
    const A = E.individualParams(P, E.seedOf(`pair${k}a`), sameSize ? 1 : 0), B = E.individualParams(P, E.seedOf(`pair${k}b`), sameSize ? 1 : 0);
    let a = 1, b = 1, t = 0, n = 0;   // the clocks alone (strideRate is the engine's tempo on flat ground)
    while (t < maxT) {
      const ra = E.strideRate(A, a, v), rb = E.strideRate(B, b, v);
      a += ra * dt; b += rb * dt; t += dt; n += ra * dt;
      if (Math.abs(a - b) >= 0.25) break;
    }
    times.push(t); counts.push(n);
  }
  return { v, pairs, seconds: median(times), strides: median(counts), slowest: Math.max(...times), fastest: Math.min(...times) };
}

// A host and a mirror. The host walks an animal along a path (speed and turn rate from `path(t)`), its engine at 60 frames
// a second; every 250 ms it sends the stream's row (x, z to 0.01 m, yaw to 0.001, spd and wr to 0.01, sc to 0.001) which
// arrives `latency` s later. The mirror draws it as animals.js mirrorStep does (a run from where it is drawn to the newest
// sample over the samples' spacing, then on at the run's velocity for a little) at its own frame rate, its engine locked
// to the host's clock (lock true) or left on its own (the engine before the stride clock). Returns how far apart the two
// pages' footfalls land: each of the mirror's against the host's nearest landing of that foot.
export function hostMirror(E, skel, P, { path, T = 60, latency = 0.08, fps = 50, lock = true, seed = 7 } = {}) {
  const Q = E.individualParams ? E.individualParams(P, seed, 1) : P;
  const q = (x, d) => Math.round(x * 10 ** d) / 10 ** d, terrain = () => 0;
  const host = { st: E.makeGait(), x: 0, z: 0, yaw: 0, v: 0, wr: 0 }, prints = [[], [], [], []], wasH = [true, true, true, true];
  const mir = { st: E.makeGait(), x: 0, z: 0, yaw: 0, v: 0, wr: 0, m0: null, m1: null, mt: 0, mdur: 0, mn: 0, mAt: 0, rate: 0 }, printsM = [[], [], [], []], wasM = [true, true, true, true];
  mir.st.sc = 1 + 0.37;   // a mirror that began elsewhere in the cycle
  const queue = []; let tH = 0, tM = 0, nextTick = 0.25;
  const inpH = inputs(0, 1, terrain), inpM = inputs(0, 1, terrain);
  const note = (st, was, out, t) => { for (let i = 0; i < 4; i++) { const F = st.feet[i]; if (F.stance && !was[i]) out[i].push([F.x, F.z, t]); was[i] = F.stance; } };
  const dtM = 1 / fps;
  while (tH < T) {
    // the host's frame
    const dt = 1 / 60, c = path(tH); host.v = c.v; host.wr = c.wr || 0; host.yaw += host.wr * dt;
    host.x += Math.sin(host.yaw) * host.v * dt; host.z += Math.cos(host.yaw) * host.v * dt; tH += dt;
    Object.assign(inpH, { x: host.x, z: host.z, yaw: host.yaw, v: host.v, wr: host.wr });
    E.gaitStep(skel, Q, host.st, inpH, dt); note(host.st, wasH, prints, tH);
    if (tH >= nextTick) { nextTick += 0.25; queue.push({ at: tH + latency, s: [q(host.x, 2), q(host.z, 2), q(host.yaw, 3), q(host.v, 2), q(host.wr, 2), q(host.st.sc || 0, 3)] }); }
    // the mirror's frames up to now
    while (tM + dtM <= tH) {
      tM += dtM;
      while (queue.length && queue[0].at <= tM) {   // a sample: the run starts where it is drawn now
        const s = queue.shift().s, gap = mir.mn ? tM - mir.mAt : 0;
        mir.m0 = [mir.x, mir.z, mir.yaw, mir.v, mir.wr]; mir.m1 = s; mir.mAt = tM;
        mir.mdur = mir.mn ? Math.min(1.2, Math.max(0.1, gap)) : 0; mir.mt = 0; mir.mn++;
        if (mir.mn === 1) { mir.m0 = s.slice(0, 5); mir.mdur = 0; }
      }
      if (!mir.m1) continue;
      mir.mt += dtM;
      const m0 = mir.m0, m1 = mir.m1, dur = mir.mdur;
      if (dur <= 0 || mir.mt >= dur) { const k = dur > 0 ? Math.min(mir.mt - dur, 0.4) / dur : 0; mir.x = m1[0] + (m1[0] - m0[0]) * k; mir.z = m1[1] + (m1[1] - m0[1]) * k; mir.yaw = m1[2]; mir.v = m1[3]; mir.wr = m1[4]; }
      else { const u = mir.mt / dur, w = 1 - u; mir.x = m0[0] * w + m1[0] * u; mir.z = m0[1] * w + m1[1] * u; mir.yaw = m0[2] + Math.atan2(Math.sin(m1[2] - m0[2]), Math.cos(m1[2] - m0[2])) * u; mir.v = m0[3] * w + m1[3] * u; mir.wr = m0[4] * w + m1[4] * u; }
      Object.assign(inpM, { x: mir.x, z: mir.z, yaw: mir.yaw, v: mir.v, wr: mir.wr });
      inpM.sc = lock && E.mirrorClock ? E.mirrorClock(m1[5], mir.mt, mir.mdur, mir.rate) : 0;
      E.gaitStep(skel, Q, mir.st, inpM, dtM); mir.rate = mir.st.moving ? mir.st.rate : 0;
      note(mir.st, wasM, printsM, tM);
    }
  }
  // each of the mirror's landings (after the first 5 s) against the host's nearest landing of that foot
  const d = [];
  for (let i = 0; i < 4; i++) for (const p of printsM[i]) { if (p[2] < 5) continue; let best = Infinity; for (const h of prints[i]) best = Math.min(best, Math.hypot(p[0] - h[0], p[1] - h[1])); d.push(best); }
  d.sort((a, b) => a - b);
  return { landings: d.length, median: d[d.length >> 1], p90: d[Math.floor(d.length * 0.9)], worst: d[d.length - 1], hostLandings: prints.reduce((s, a) => s + a.length, 0) };
}
