// The herds' stigmergy fields (2026-11-08; Aaron: "Do a bit of research on stygmergy and the rules of movements for
// flocks/herds... the general principles can create more dynamic movement"): what the herds and flocks write on the land
// and read back from it, on FCELL m cells over the tile, owned by the animal host and sent to the mirrors as deltas.
//
//   forage   the grass's biomass B (0-255, up to the cell's Bmax: its herb cover, less under trees) and its quality Q
//            (0-255; base Q_BASE). Grazing takes biomass and raises quality: a grazed lawn regrows younger, greener and
//            faster (compensatory growth, rate x (1 + Q/255)), so it draws the herd back; the herds that keep grazing a
//            valley keep it in early growth, and home ranges emerge (Geremia et al. 2019, PNAS 116: 25707-25713,
//            "Migrating bison engineer the green wave"). B regrows toward Bmax with e-folding B_REGROW_H hours; Q relaxes
//            to its base over Q_DECAY_H.
//   trail    passage: every animal walking past lays a little (TRAIL_STEP a step), it fades over TRAIL_DECAY_H and lowers
//            the cost of walking there, so the walkers that follow take it and keep it (the active walker model:
//            Helbing, Schweitzer, Keltsch and Molnar 1997, Physical Review E 56: 2527-2539); game trails emerge where
//            many go the same way: to water, over saddles, along contours.
//   fear     alarms and kills mark the ground round where they happened (FEAR_R_ALARM, FEAR_R_KILL m), fading over
//            FEAR_DECAY_H; a herd's goals avoid it (the landscape of fear: Laundre, Hernandez and Altendorf 2001).
// Each cell keeps its value as last written and the quarter-hour it was written (Uint16), and its value now is worked
// out when read (regrowth and decay are closed forms), so nothing runs per cell per frame. The fields are deterministic
// per tile and season (the starting state is the tile's own: Bmax from its herb cover), so a page joining later is sent
// only the cells that changed (deltas), and nothing is stored: no position or history leaves memory.
// Water: the distance to running or standing water on the 30 m habitat grid (multi-source chamfer over the cells whose
// water depth is over WET_D m), for the thirsty to find it.

export const FCELL = 10;
const B_REGROW_H = 24 * 9, Q_DECAY_H = 24 * 20, Q_BASE = 60, TRAIL_DECAY_H = 24 * 30, FEAR_DECAY_H = 24 * 2.5;
export const TRAIL_STEP = 2, FEAR_R_ALARM = 60, FEAR_R_KILL = 90;
const WET_D = 0.08;
const F_B = 0, F_Q = 1, F_T = 2, F_F = 3;

export class HerdFields {
  // size: the tile (m); herb(x, n) 0..1 the herb cover there; tree(x, n) 0..1 the tree cover; depth(x, n) water depth (m);
  // habitat (Grid8: class 7 open water)
  constructor({ size, herb, tree, depth, habitat }) {
    const N = this.N = Math.ceil(size / FCELL), n2 = N * N; this.size = size;
    this.Bmax = new Uint8Array(n2); this.B0 = new Uint8Array(n2); this.Q0 = new Uint8Array(n2).fill(Q_BASE);
    this.T0 = new Uint8Array(n2); this.F0 = new Uint8Array(n2);
    this.tB = new Uint16Array(n2); this.tT = new Uint16Array(n2); this.tF = new Uint16Array(n2);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * FCELL, n = (j + 0.5) * FCELL, k = j * N + i;
      const b = Math.max(0, Math.min(255, Math.round(255 * herb(x, n) * (1 - 0.6 * tree(x, n)))));
      this.Bmax[k] = b; this.B0[k] = b;
    }
    this.h = 0;                    // the field clock, hours
    this.dirty = new Set();        // cells written since the last delta (the host's)
    this.trailDirty = new Set();   // trail cells changed since they were last painted on the ground (animals.js paintTrails)
    // water: distance (m) on the habitat grid
    const W = habitat.img.width, res = size / W, D = this.wd = new Float32Array(W * W).fill(1e9); this.wW = W; this.wRes = res;
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * res, n = size - (j + 0.5) * res;
      if (habitat.channel(i, j, 0) === 7 || depth(x, n) > WET_D || depth(x + res * 0.3, n) > WET_D || depth(x, n + res * 0.3) > WET_D) D[j * W + i] = 0;
    }
    const s2 = res * Math.SQRT2;
    for (let pass = 0; pass < 2; pass++) {   // chamfer: forward then back
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
        const k = j * W + i; let d = D[k];
        if (i > 0) d = Math.min(d, D[k - 1] + res); if (j > 0) d = Math.min(d, D[k - W] + res);
        if (i > 0 && j > 0) d = Math.min(d, D[k - W - 1] + s2); if (i < W - 1 && j > 0) d = Math.min(d, D[k - W + 1] + s2);
        D[k] = d;
      }
      for (let j = W - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
        const k = j * W + i; let d = D[k];
        if (i < W - 1) d = Math.min(d, D[k + 1] + res); if (j < W - 1) d = Math.min(d, D[k + W] + res);
        if (i < W - 1 && j < W - 1) d = Math.min(d, D[k + W + 1] + s2); if (i > 0 && j < W - 1) d = Math.min(d, D[k + W - 1] + s2);
        D[k] = d;
      }
    }
  }
  advance(dtS) { this.h += dtS / 3600; }
  q(h) { return Math.min(65535, Math.max(0, Math.round(h * 4))); }   // hours to the stamp
  cell(x, n) { const N = this.N, i = Math.floor(x / FCELL), j = Math.floor(n / FCELL); return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i; }
  // values now
  B(k) { const m = this.Bmax[k], a = this.h - this.tB[k] / 4, q = this.Q(k); return m - (m - this.B0[k]) * Math.exp(-Math.max(0, a) * (1 + q / 255) / B_REGROW_H); }
  Q(k) { const a = this.h - this.tB[k] / 4; return Q_BASE + (this.Q0[k] - Q_BASE) * Math.exp(-Math.max(0, a) / Q_DECAY_H); }
  T(k) { return this.T0[k] * Math.exp(-Math.max(0, this.h - this.tT[k] / 4) / TRAIL_DECAY_H); }
  F(k) { return this.F0[k] * Math.exp(-Math.max(0, this.h - this.tF[k] / 4) / FEAR_DECAY_H); }
  // by place (x east, n north of the tile's south-west corner; scene z = -n)
  forage(x, n) { const k = this.cell(x, n); if (k < 0) return 0; return (this.B(k) / 255) * (0.55 + 0.9 * this.Q(k) / 255); }
  trail(x, n) { const k = this.cell(x, n); return k < 0 ? 0 : this.T(k) / 255; }
  fear(x, n) { const k = this.cell(x, n); return k < 0 ? 0 : this.F(k) / 255; }
  // what a grazer wants of a place: forage, less fear
  utility(x, n) { return this.forage(x, n) - 1.6 * this.fear(x, n); }
  water(x, n) {   // metres to water, bilinear on the 30 m grid
    const W = this.wW, r = this.wRes, fx = x / r - 0.5, fy = (this.size - n) / r - 0.5;
    const i = Math.max(0, Math.min(W - 2, Math.floor(fx))), j = Math.max(0, Math.min(W - 2, Math.floor(fy))), u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
    const D = this.wd, k = j * W + i;
    return (D[k] * (1 - u) + D[k + 1] * u) * (1 - v) + (D[k + W] * (1 - u) + D[k + W + 1] * u) * v;
  }
  // the way downhill on the water distance: a unit (x, n) vector, or null at the water / with none on the tile
  waterDir(x, n, out) {
    const e = 20, dx = this.water(x + e, n) - this.water(x - e, n), dn = this.water(x, n + e) - this.water(x, n - e), l = Math.hypot(dx, dn);
    if (l < 1e-3 || this.water(x, n) > 5e8) return null;
    out.x = -dx / l; out.n = -dn / l; return out;
  }
  // writes (the host's; each marks the cell for the next delta)
  graze(x, n, units) {
    const k = this.cell(x, n); if (k < 0) return 0;
    const b = this.B(k), take = Math.min(b, units), q = this.Q(k);
    this.B0[k] = Math.max(0, Math.round(b - take)); this.Q0[k] = Math.min(255, Math.round(q + take * 0.9)); this.tB[k] = this.q(this.h);
    this.dirty.add(k); return take;
  }
  walk(x, n, units = TRAIL_STEP) {
    const k = this.cell(x, n); if (k < 0) return;
    this.T0[k] = Math.min(255, Math.round(this.T(k) + units)); this.tT[k] = this.q(this.h); this.dirty.add(k); this.trailDirty.add(k);
  }
  scare(x, n, r, v = 255) {
    const N = this.N, c = Math.ceil(r / FCELL), i0 = Math.floor(x / FCELL), j0 = Math.floor(n / FCELL);
    for (let j = j0 - c; j <= j0 + c; j++) for (let i = i0 - c; i <= i0 + c; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const d = Math.hypot((i + 0.5) * FCELL - x, (j + 0.5) * FCELL - n); if (d > r) continue;
      const k = j * N + i, f = Math.round(v * (1 - 0.6 * d / r));
      if (f > this.F(k)) { this.F0[k] = f; this.tF[k] = this.q(this.h); this.dirty.add(k); }
    }
  }
  // ---- between pages: the host sends the cells written since the last delta, as they are now; a mirror sets them
  // A cell's four values go as two 32-bit words: [k (20 bits) | B (8) | 4 spare] and [Q | T | F | 8 spare], base64'd, at
  // most `max` cells a message (6,000: 48 KB raw, 64 KB base64 is the socket's limit; animalNet.js sends 4,000).
  delta(max = 4000) {
    if (!this.dirty.size) return null;
    const ks = []; for (const k of this.dirty) { ks.push(k); if (ks.length >= max) break; }
    for (const k of ks) this.dirty.delete(k);
    const u = new Uint32Array(ks.length * 2);
    ks.forEach((k, o) => { u[o * 2] = (k << 12 | Math.round(this.B(k)) << 4) >>> 0; u[o * 2 + 1] = (Math.round(this.Q(k)) << 24 | Math.round(this.T(k)) << 16 | Math.round(this.F(k)) << 8) >>> 0; });
    return b64(new Uint8Array(u.buffer));
  }
  // every cell that differs from the starting state (a page that joins): in deltas of `max`
  all() { for (let k = 0; k < this.B0.length; k++) if (this.B0[k] !== this.Bmax[k] || this.Q0[k] !== Q_BASE || this.T0[k] || this.F0[k]) this.dirty.add(k); }
  apply(s) {
    const bytes = unb64(s); if (!bytes || bytes.length % 8) return 0;
    const u = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), t = this.q(this.h), n2 = this.B0.length;
    for (let o = 0; o < u.length; o += 2) {
      const k = u[o] >>> 12; if (k >= n2) continue;
      this.B0[k] = (u[o] >>> 4) & 255; this.Q0[k] = u[o + 1] >>> 24; this.T0[k] = (u[o + 1] >>> 16) & 255; this.F0[k] = (u[o + 1] >>> 8) & 255;
      this.tB[k] = t; this.tT[k] = t; this.tF[k] = t; this.trailDirty.add(k);
    }
    return u.length / 2;
  }
}
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { try { const t = atob(s), b = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return b; } catch (e) { return null; } }
