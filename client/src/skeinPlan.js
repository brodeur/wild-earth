// Migration skeins over a tile (client/herds.json `skeins`, pipeline/herds.py skein_plan; 2026-11-07, Aaron: "many goose
// V's flying north or south"): when they cross, where, and where each bird of each skein is. Shared by the world
// (animals.js skeinUpdate) and the title's relief model (relief.js), and seeded by the wall clock, the tile and the
// species alone, so every page sees the same skeins at the same moment with nothing sent.
//
// Schedule: a species' plan for the season gives skeins per hour; time is cut into periods of 3600 / rate s, and skein k
// starts somewhere in its period (seeded), crossing the tile on its heading (the valley axis toward north in spring,
// south in fall) at its own speed and height above the highest ground under its path, offset across the tile, CROSS_M
// long so it enters and leaves out of sight. A skein is 30 % an echelon (one arm), else a V; its birds sit on the arms
// at SPAN_BACK and SPAN_SIDE wingspans per place (the arms some 35 degrees off the line of flight), the arms flexing
// slowly, the lead changing every 60-150 s (the leader drops back to the end of an arm and the rest move up, eased
// over LEAD_EASE s), and the wingbeat passing back along each arm (Portugal et al. 2014: flap phasing in the V).

const TAU = Math.PI * 2;
export const CROSS_M = 16000, SPAN_BACK = 1.05, SPAN_SIDE = 0.75, LEAD_EASE = 8;

function hash32(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}
function rng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The skeins of one species crossing the tile at wall-clock time T (s): [{ id, code, n, heading (rad from north toward
// east), speed, agl, echelon, side, x0, n0 (start, metres from the tile's south-west corner), t0, life, seed }].
export function activeSkeins(tileId, code, plan, T, sizeM = 10000) {
  const out = [];
  if (!plan || !(plan.per_hour > 0)) return out;
  const period = 3600 / plan.per_hour, speedLo = plan.speed_mps?.[0] ?? 14, speedHi = plan.speed_mps?.[1] ?? 18;
  const life = CROSS_M / speedLo, k1 = Math.floor(T / period), k0 = Math.floor((T - life) / period) - 1;
  const hd = (plan.heading_deg || 0) * Math.PI / 180;
  for (let k = k0; k <= k1; k++) {
    const r = rng(hash32(`${tileId}|${code}|${k}`, 0x5e1)), t0 = (k + r()) * period;
    const speed = speedLo + r() * (speedHi - speedLo), dur = CROSS_M / speed;
    if (T < t0 || T > t0 + dur) continue;
    const lo = plan.size?.[0] ?? 8, hi = plan.size?.[1] ?? 40, n = Math.max(3, Math.round(lo + (hi - lo) * r() * r()));
    const agl = (plan.agl_m?.[0] ?? 180) + r() * ((plan.agl_m?.[1] ?? 450) - (plan.agl_m?.[0] ?? 180));
    const off = (r() - 0.5) * sizeM * 0.8, fx = Math.sin(hd), fn = Math.cos(hd);
    const cx = sizeM / 2 - fn * off, cn = sizeM / 2 + fx * off;   // the line's closest point to the centre, offset across
    out.push({ id: `${code}:${k}`, code, n, heading: hd + (r() - 0.5) * 0.25, speed, agl, echelon: r() < 0.3, side: r() < 0.5 ? -1 : 1,
      x0: cx - fx * CROSS_M / 2, n0: cn - fn * CROSS_M / 2, t0, life: dur, seed: hash32(`${tileId}|${code}|${k}`, 0xb1d) });
  }
  return out;
}

// Where bird i of skein S is at time T: writes { x, n (metres from the tile's south-west corner), up (m above the
// skein's flying height), yaw (rad from north toward east), phase (its wingbeat, rad) } into `o`. span: the wingspan (m);
// beat: wingbeats per second.
export function birdIn(S, i, T, span, beat, o) {
  const t = T - S.t0, fx = Math.sin(S.heading), fn = Math.cos(S.heading);
  const hx = S.x0 + fx * S.speed * t, hn = S.n0 + fn * S.speed * t;   // the lead place
  // the lead changes: every `rot` s the leader drops to the end and everyone moves up one place, eased
  const rot = 60 + (S.seed % 90), c = Math.floor(t / rot), e = Math.min(1, (t - c * rot) / LEAD_EASE);
  const place = (i - c) % S.n, was = (i - c + 1) % S.n;
  const p0 = ((was % S.n) + S.n) % S.n, p1 = ((place % S.n) + S.n) % S.n;
  const pos = (p, out) => {
    if (p === 0) { out[0] = 0; out[1] = 0; return; }
    const arm = S.echelon ? S.side : (p % 2 ? -1 : 1), k = S.echelon ? p : Math.ceil(p / 2);
    const flex = Math.sin(t * 0.21 + k * 0.37 + (arm > 0 ? 1.3 : 0)) * 0.12 * k + Math.sin(t * 0.07 + (S.seed & 7)) * 0.05 * k;
    out[0] = arm * k * (SPAN_SIDE + flex * 0.4) * span; out[1] = -k * (SPAN_BACK + flex * 0.25) * span;
  };
  const a = birdIn.a || (birdIn.a = [0, 0]), b = birdIn.b || (birdIn.b = [0, 0]);
  pos(p0, a); pos(p1, b);
  const w = e * e * (3 - 2 * e), side = a[0] + (b[0] - a[0]) * w, back = a[1] + (b[1] - a[1]) * w;
  // (side right of the line of flight, back along it)
  o.x = hx + fn * side + fx * back; o.n = hn - fx * side + fn * back;
  o.up = Math.sin(t * 0.5 + p1 * 0.6) * 0.15 * span + (p1 ? -0.02 * span * Math.ceil(p1 / 2) : 0);
  o.yaw = S.heading + Math.sin(t * 0.3 + p1) * 0.04;
  o.phase = (t * beat * TAU - Math.ceil(p1 / 2) * 0.9) % TAU;   // the beat passes back along the arms
  return o;
}
