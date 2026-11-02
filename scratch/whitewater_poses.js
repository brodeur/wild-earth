// The home tile's capture poses for the white-water lane (with whitewater_harness.js): window.__wwPoses(). Each is
// { x, north, agl, yaw, pitch }, { aim: [x, north, agl, tx, tn, ty] } or { view: [x, north, h, tx, tn, th] } (an own camera);
// run them with __wwCapture(prefix).
window.__wwPoses = () => {
  const we = window.__we, W = we.water, S = W.sections;
  const tanAt = (x, n) => { let bd = 1e9, b = null; for (let k = 0; k < S.length / 10; k++) { const o = k * 10, d = Math.hypot(S[o] - x, S[o + 1] - n); if (d < bd) { bd = d; b = { x: S[o], n: S[o + 1], tx: S[o + 4], tz: S[o + 5], half: S[o + 2] }; } } return b; };
  const yawOf = (tx, tz) => Math.atan2(tx, -tz);
  const P = {};
  { const t = tanAt(6795, 8585), yaw = yawOf(t.tx, t.tz); P.p1 = { x: t.x - t.tx * 22, north: t.n + t.tz * 22, agl: 30, yaw, pitch: -0.62 }; }   // raven over the Weber Creek riffle, looking downstream
  { const t = tanAt(6795, 8585), px = -t.tz, pz = t.tx; const b = t.half + 2; P.p2 = { view: [t.x - t.tx * 6 + px * b, t.n + t.tz * 6 - pz * b, 1.3, t.x + t.tx * 14, t.n - t.tz * 14, 0.2] }; }   // a deer's eye on the right bank (2 m past the water), looking down the riffle
  { const t = tanAt(5630, 9855), yaw = yawOf(t.tx, t.tz); P.p3 = { x: t.x - t.tx * 18, north: t.n + t.tz * 18, agl: 14, yaw, pitch: -0.5 }; }   // the Hangtown Creek cascade from 14 m, looking down it
  { const t = tanAt(9982, 6665), yaw = yawOf(t.tx, t.tz); P.p4 = { x: t.x - t.tx * 15, north: t.n + t.tz * 15, agl: 18, yaw, pitch: -0.55 }; }   // Weber Creek's boulder riffle from 18 m
  // the wake: the biggest emergent rock within 90 m of the Hangtown Creek cascade (open ground), from 9 m upstream, 2 m aside and 6 m up;
  // on a build without emergent rocks (main) the same rock's place is given: (5643.3, 9863.2), r 1.18
  const rocks = (W.emergentRocks || []).filter(r => Math.hypot(r.x - 5640, r.north - 9860) < 90).sort((a, b) => b.r - a.r);
  const r = rocks[0] || { x: 5643.3, north: 9863.2, r: 1.18, fixed: true }, t = tanAt(r.x, r.north);
  P.p5 = { view: [r.x - t.tx * 9 - t.tz * 2, r.north + t.tz * 9 - t.tx * 2, 6, r.x + t.tx * 3, r.north - t.tz * 3, 0.3], rock: r };
  return P;
};
window.__wwCapture = async (prefix, keys = null) => {
  const H = window.__ww, P = window.__wwPoses(), out = {};
  window.__we.setHour(11);
  for (const [k, p] of Object.entries(P)) {
    if (keys && !keys.includes(k)) continue;
    const r = p.view ? await H.view(...p.view) : p.aim ? await H.aim(...p.aim) : (await H.view(null), await H.pose(p.x, p.north, p.agl, p.yaw, p.pitch));
    H.setTime(100);
    out[k] = { pos: r.pos || r.cam, saved: await H.save(prefix + '_' + k), rock: p.rock ? { x: +p.rock.x.toFixed(1), north: +p.rock.north.toFixed(1), r: +p.rock.r.toFixed(2) } : undefined };
  }
  return out;
};
