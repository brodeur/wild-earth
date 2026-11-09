import { F, FL_AIR } from './animalNet.js';

// Join as the friend is (Aaron, 2026-11-08: "When I click "Join" after a friend starts a tile, I should spawn right next
// to them, as the species they are, going the speed they are in the direction they are, but about 5 body lengths
// behind"; docs/multiplayer.md "Join as the friend is"). Where the joiner comes in, from the friend's relayed state
// (multiplayer.js gotPos: the hub's `pos`, kept in memory with the time it came and a short trail of where they went):
//   - the state moved on to now: their position carried along their heading at their speed for the time since it came
//     (and up or down at the rate the trail shows, in the air);
//   - the point 5 of their species' body lengths behind them along the trail they came by (straight back along the
//     heading past the trail's end), facing their way, at their speed: in the air at their height for a flier or the
//     spirit, on the ground for a walker (in the water when they swim);
//   - a point that cannot hold the body (off the tile, in a trunk or a crown, a cliff, under the ground, water too deep for
//     a walker, dry land for a swimmer in the water) slides along the trail, nearer first then further, and then to the
//     nearest good spot round it; with none, null (the caller falls back on the spirit above and behind).
// Pure but for the test the caller gives (main.js joinTest: the tile's footing, water, trunks, crowns and slopes) and the
// species tables (tables: { ground: groundControl.js GROUND, fliers: flierControl.js FLIERS }, passed in so this module
// loads under node for tests/test_join_spawn.py).

export const BEHIND_LENGTHS = 5;
const SPIRIT_LEN = 2;                     // the spirit's "body length" (m): ten metres behind
const TRAIL_S = 20, TRAIL_STEP = 0.25;    // the trail kept per member: the last 20 s, a point every 0.25 m at least
const AHEAD_MAX_S = 4;                    // the state is carried forward at most this long (a page busy with its first frames reads old messages)
const SLIDE = [5, 4.5, 5.5, 4, 6, 3.5, 7, 3, 8, 2.5, 10, 12, 15];   // body lengths behind, in the order tried
const RINGS = [1, 2, 3, 5, 8, 12, 16, 20], RING_N = 16;            // then round the 5-length point (m)

// A species' body length (m) at size 1 times its size: a walker's twice its half length (groundControl.js `half`), a
// bird's 0.45 of its span (a red-tailed hawk 0.56 m), the spirit SPIRIT_LEN.
export function bodyLength(code, size = 1, tables = {}) {
  if (!code || code === 'spirit') return SPIRIT_LEN;
  const g = tables.ground?.[code], f = tables.fliers?.[code];
  const base = g?.half ? 2 * g.half : f?.span ? 0.45 * f.span : code === 'corvus_corax' ? 0.6 : code === 'sciurus_griseus' ? 0.45 : code === 'melanerpes_formicivorus' ? 0.22 : 1;
  return base * (size > 0 ? size : 1);
}

// The trail of a member: points { x, y, z, t } oldest first, the last TRAIL_S seconds.
export function pushTrail(trail, d, t) {
  const last = trail[trail.length - 1];
  if (!last || Math.hypot(d.x - last.x, d.z - last.z, d.y - last.y) >= TRAIL_STEP || t - last.t > 1000) trail.push({ x: d.x, y: d.y, z: d.z, yaw: d.yaw || 0, t });
  else { last.t = t; last.yaw = d.yaw || 0; }
  while (trail.length > 2 && t - trail[0].t > TRAIL_S * 1000) trail.shift();
  return trail;
}

// The member's speed (m/s), climb (m/s) and turn rate (rad/s, + to the left as the flight's yaw grows): a body's own speed
// from its state (b: the stream's spd), the spirit's as it sends it (v), else the trail over its last second or so (the
// relay's times are when each came, so a short stretch reads the network's jitter).
export function leadMotion(lead, trail) {
  let v = Array.isArray(lead.b) ? Math.abs(lead.b[F.spd] || 0) : Number.isFinite(lead.v) ? lead.v : null, vy = 0, wr = 0;
  const n = trail.length;
  if (n >= 2) {
    const b = trail[n - 1]; let i = n - 2; while (i > 0 && b.t - trail[i].t < 900) i--;
    const a = trail[i], dt = (b.t - a.t) / 1000;
    if (dt > 0.3) {
      if (v === null) v = Math.hypot(b.x - a.x, b.z - a.z) / dt;
      vy = (b.y - a.y) / dt; wr = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) / dt;
    }
  }
  return { v: v ?? 0, vy, wr };
}

// The point `dist` m behind `head` along the trail (newest first), then straight back along the heading.
function behindOnTrail(head, trail, yaw, dist) {
  let left = dist, px = head.x, pz = head.z, py = head.y;
  for (let i = trail.length - 1; i >= 0; i--) {
    const q = trail[i], d = Math.hypot(q.x - px, q.z - pz);
    if (d < 1e-6) continue;
    if (d >= left) { const u = left / d; return { x: px + (q.x - px) * u, y: py + (q.y - py) * u, z: pz + (q.z - pz) * u }; }
    left -= d; px = q.x; pz = q.z; py = q.y;
  }
  return { x: px + Math.sin(yaw) * left, y: py, z: pz + Math.cos(yaw) * left };   // forward is (-sin, -cos): behind is +
}

// lead: the relayed pos { x, y, z, yaw, form, b?, c?, at } (at: performance.now() when it came); trail: pushTrail's;
// kind(code): 'ground' | 'flier' | 'raven' | 'squirrel' | 'woodpecker' | null (playable.js bodyKind); test(where, x, y, z,
// opts) -> { y, wet } or null. Returns { code, x, y, z, yaw, speed, where ('air' | 'ground'), flapping, soaring,
// soarDir, len, size, d, slid, head } or null.
export function planJoin({ lead, trail = [], now = performance.now(), kind, test, tables = {} }) {
  const GROUND = tables.ground || {}, FLIERS = tables.fliers || {};
  const code = lead.form && lead.form !== 'spirit' && kind(lead.form) ? lead.form : 'spirit';
  const size = Array.isArray(lead.c) && lead.c[0] > 0 ? lead.c[0] : 1;
  const len = bodyLength(code, size, tables), yaw = lead.yaw || 0;
  const { v, vy, wr } = leadMotion(lead, trail);
  const dt = Math.min(AHEAD_MAX_S, Math.max(0, (now - (lead.at ?? now)) / 1000));
  const airborne = code === 'spirit' || (Array.isArray(lead.b) ? lead.b[F.fl] === FL_AIR : false);
  const head = { x: lead.x - Math.sin(yaw) * v * dt, y: lead.y + (airborne ? vy * dt : 0), z: lead.z - Math.cos(yaw) * v * dt };
  const where = airborne ? 'air' : 'ground';
  const k = kind(code), swimmer = k === 'ground' && (GROUND[code]?.wade ?? 0) >= 1;
  const opts = { code, size, swimmer, water: where === 'ground' ? !!test('ground', head.x, head.y, head.z, { code, size, swimmer, probe: true })?.wet : false };
  const tryAt = (p, d) => { const r = test(where, p.x, where === 'air' ? p.y : head.y, p.z, opts); return r ? { x: p.x, y: r.y, z: p.z, d } : null; };
  let spot = null;
  for (const n of SLIDE) { spot = tryAt(behindOnTrail(head, trail, yaw, n * len), n * len); if (spot) break; }
  if (!spot) {
    const c = behindOnTrail(head, trail, yaw, BEHIND_LENGTHS * len);
    for (const r of RINGS) {
      for (let i = 0; i < RING_N && !spot; i++) { const a = i / RING_N * Math.PI * 2; spot = tryAt({ x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r }, null); }
      if (spot) break;
    }
  }
  if (!spot) return null;
  const amp = Array.isArray(lead.b) ? lead.b[F.amp] || 0 : 0;
  // a flier circling in a soar (FLIERS soar; turning steadily): soaring on round the same way (flight.js soarDir)
  const soaring = where === 'air' && !!FLIERS[code]?.flight?.soar && Math.abs(wr) > 0.08 && amp < 0.35;
  return { code, x: spot.x, y: spot.y, z: spot.z, yaw, speed: v, where, flapping: amp > 0.35, soaring, soarDir: wr < 0 ? -1 : 1, len, size,
    d: spot.d ?? Math.hypot(spot.x - head.x, spot.z - head.z), slid: spot.d !== BEHIND_LENGTHS * len, head };
}
