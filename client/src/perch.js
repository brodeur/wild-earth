import { treeWood, LIBRARY } from './treegen.js';

// Where a bird can stand: the wood of the trees and shrubs in the vegetation's near set (the plants within about
// 240 m of the bird, vegetation.js), and the ground.
// Each placed plant is read from the near instances themselves (species, the variant's seed, and its instance matrix:
// position, scale and rotation), so the wood is exactly the drawn wood: treegen.treeWood gives the skeleton the near tier
// tubes for that (species, seed), in the tree's frame; the instance matrix puts it in the world. A plant's world-space
// stems (points, radii, arc lengths and a bounding box each) are built the first time a query comes near it and kept
// while it stays in the near set; a refresh of the near set keeps the plants that remain and drops the others.
// The plants sit on a CELL m grid, each in every cell its reach (a generous bound on its crown, refined once its wood
// is built) overlaps, so a query reads one cell.
// near(p, r): the closest wood surface to p within r (bark, so the axis distance less the radius), with whether a bird
// can stand there: the wood at least PERCH_R thick, sloping no more than PERCH_SLOPE (the sine of the climb along it),
// its top at least PERCH_H above the ground, and p not under it. stepAlong walks a perch along its stem, stopping where
// it stops being perchable (the thin end, a steep bend, the parent limb at its base).
// Cost: a query reads one grid cell (a few plants), skips plants and stems by their bounds, and tests the segments of
// the stems whose box p is inside: typically well under 0.05 ms. Building a plant's stems is a few hundred to a few
// thousand point transforms (about 0.1-0.4 ms for a big oak), once per plant per visit.
export const PERCH_R = 0.015, PERCH_H = 0.8, PERCH_SLOPE = 0.7;
const CELL = 10, MAX_Q = 1.5;   // m: grid cell; the largest query radius the grid is built for

export class Perches {
  // veg: the Vegetation; groundAt(x, z): the drawn terrain height
  constructor(veg, groundAt) {
    this.veg = veg; this.groundAt = groundAt;
    this.version = -1; this.grid = new Map(); this.byKey = new Map(); this.built = 0;
    this.hit = { rec: null, stem: null, i: 0, t: 0, s: 0, ax: 0, ay: 0, az: 0, dx: 0, dy: 0, dz: 0, r: 0, gap: 0, nx: 0, ny: 0, nz: 0, perch: false, ground: 0 };
    this.stats = { queries: 0, segs: 0, ms: 0, builds: 0, buildMs: 0 };
  }
  // The near set as plant records on the grid (rebuilt when the vegetation refreshes it).
  index() {
    const veg = this.veg; if (!veg || veg.nearVersion === this.version) return;
    this.version = veg.nearVersion; this.grid.clear();
    const keep = new Map();
    for (const [species, arr] of Object.entries(veg.meshes)) for (const e of arr) {
      const a = e.near.trunk.instanceMatrix.array, H = e.height || 10;
      for (let i = 0; i < e.near.n; i++) {
        const o = i * 16, x = a[o + 12], y = a[o + 13], z = a[o + 14], scale = Math.hypot(a[o], a[o + 1], a[o + 2]);
        const key = `${species}:${e.seed}:${x.toFixed(2)}:${z.toFixed(2)}`;
        let rec = this.byKey.get(key);
        if (!rec) rec = { key, species, seed: e.seed, cls: e.cls, snag: e.snag, m: a.slice(o, o + 16), x, y, z, scale, R: 0.75 * H * scale + 1.5, top: y + 1.3 * H * scale + 1, stems: null };
        keep.set(key, rec);
        const R = rec.R + MAX_Q;
        for (let j = Math.floor((z - R) / CELL); j <= Math.floor((z + R) / CELL); j++)
          for (let k = Math.floor((x - R) / CELL); k <= Math.floor((x + R) / CELL); k++) {
            const c = `${k},${j}`; let l = this.grid.get(c); if (!l) this.grid.set(c, l = []); l.push(rec);
          }
      }
    }
    this.byKey = keep;   // plants that left the near set (and their stems) are dropped
    this.built = 0; for (const r of keep.values()) if (r.stems) this.built++;
  }
  // A plant's stems in world space, built on first use.
  stemsOf(rec) {
    if (rec.stems) return rec.stems;
    const t0 = performance.now(), w = treeWood(rec.species, rec.seed), m = rec.m, out = [];
    let top = rec.y, R = 0;
    for (const s of w ? w.stems : []) {
      const n = s.rad.length, pts = new Float32Array(n * 3), rad = new Float32Array(n), cum = new Float32Array(n);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) {
        const px = s.pts[i * 3], py = s.pts[i * 3 + 1], pz = s.pts[i * 3 + 2];
        const x = m[0] * px + m[4] * py + m[8] * pz + m[12], y = m[1] * px + m[5] * py + m[9] * pz + m[13], z = m[2] * px + m[6] * py + m[10] * pz + m[14];
        pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z; rad[i] = s.rad[i] * rec.scale;
        if (i) cum[i] = cum[i - 1] + Math.hypot(x - pts[i * 3 - 3], y - pts[i * 3 - 2], z - pts[i * 3 - 1]);
        const rr = rad[i];
        if (x - rr < min[0]) min[0] = x - rr; if (y - rr < min[1]) min[1] = y - rr; if (z - rr < min[2]) min[2] = z - rr;
        if (x + rr > max[0]) max[0] = x + rr; if (y + rr > max[1]) max[1] = y + rr; if (z + rr > max[2]) max[2] = z + rr;
      }
      if (rad[0] < PERCH_R * 0.5) continue;   // twig-thin from its base: nothing stands or bumps on it
      top = Math.max(top, max[1]); R = Math.max(R, Math.hypot(min[0] - rec.x, min[2] - rec.z), Math.hypot(max[0] - rec.x, max[2] - rec.z));
      out.push({ level: s.level, dead: s.dead, pts, rad, cum, len: cum[n - 1], min, max, parentR: -1 });
    }
    rec.stems = out; rec.top = top; rec.R = Math.min(rec.R, R + 0.1);
    this.built++; this.stats.builds++; this.stats.buildMs += performance.now() - t0;
    return out;
  }
  // The closest wood surface to (x, y, z) within r (r <= MAX_Q), thicker than minR, or null; `skip` a plant record to
  // leave out (the one just left); `level`: only wood sloping no more than PERCH_SLOPE. The result (this.hit, reused)
  // is described in the header.
  near(x, y, z, r, minR = PERCH_R, skip = null, level = false) {
    const t0 = performance.now();
    this.index();
    const l = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`), H = this.hit;
    let best = r, segs = 0; H.rec = null;
    if (l) for (const rec of l) {
      if (rec === skip || y > rec.top + r || y < rec.y - r) continue;
      if (Math.hypot(x - rec.x, z - rec.z) > rec.R + r) continue;
      for (const st of this.stemsOf(rec)) {
        const mn = st.min, mx = st.max;
        if (x < mn[0] - r || x > mx[0] + r || y < mn[1] - r || y > mx[1] + r || z < mn[2] - r || z > mx[2] + r) continue;
        const P = st.pts, R = st.rad;
        for (let i = 0; i < R.length - 1; i++) {
          if (R[i] < minR) break;   // radii taper outward: the rest is thinner
          segs++;
          const ax = P[i * 3], ay = P[i * 3 + 1], az = P[i * 3 + 2], dx = P[i * 3 + 3] - ax, dy = P[i * 3 + 4] - ay, dz = P[i * 3 + 5] - az;
          const L2 = dx * dx + dy * dy + dz * dz; if (L2 < 1e-8 || level && dy * dy > PERCH_SLOPE * PERCH_SLOPE * L2) continue;
          const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2));
          const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t, rr = R[i] + (R[i + 1] - R[i]) * t;
          if (rr < minR) continue;
          const d = Math.hypot(x - cx, y - cy, z - cz), gap = d - rr;
          if (gap >= best) continue;
          best = gap; const L = Math.sqrt(L2), di = d > 1e-6 ? 1 / d : 0;
          Object.assign(H, { rec, stem: st, i, t, s: st.cum[i] + t * L, ax: cx, ay: cy, az: cz, dx: dx / L, dy: dy / L, dz: dz / L, r: rr, gap,
            nx: (x - cx) * di, ny: d > 1e-6 ? (y - cy) * di : 1, nz: (z - cz) * di });
        }
      }
    }
    if (H.rec) {
      H.ground = this.groundAt(H.ax, H.az);
      H.perch = H.r >= PERCH_R && Math.abs(H.dy) <= PERCH_SLOPE && H.ay + H.r - H.ground >= PERCH_H && H.ny > -0.25;
    }
    const S = this.stats; S.queries++; S.segs += segs; S.ms += performance.now() - t0;
    return H.rec ? H : null;
  }
  // The axis point, direction and radius at arc length s of a stem: { x, y, z, dx, dy, dz, r } in `out`.
  at(st, s, out) {
    const P = st.pts, C = st.cum, n = st.rad.length;
    let i = 0; while (i < n - 2 && C[i + 1] < s) i++;
    const L = C[i + 1] - C[i], t = L > 0 ? Math.min(1, Math.max(0, (s - C[i]) / L)) : 0;
    const dx = P[i * 3 + 3] - P[i * 3], dy = P[i * 3 + 4] - P[i * 3 + 1], dz = P[i * 3 + 5] - P[i * 3 + 2], D = Math.hypot(dx, dy, dz) || 1;
    out.x = P[i * 3] + dx * t; out.y = P[i * 3 + 1] + dy * t; out.z = P[i * 3 + 2] + dz * t;
    out.dx = dx / D; out.dy = dy / D; out.dz = dz / D; out.r = st.rad[i] + (st.rad[i + 1] - st.rad[i]) * t;
    return out;
  }
  // The bark's top at arc length s (the axis point raised by the radius, square to the stem): { x, y, z } in `out`.
  top(st, s, out) {
    this.at(st, s, out);
    let ux = -out.dy * out.dx, uy = 1 - out.dy * out.dy, uz = -out.dy * out.dz;   // up, less its component along the stem
    const L = Math.hypot(ux, uy, uz) || 1;
    out.x += ux / L * out.r; out.y += uy / L * out.r; out.z += uz / L * out.r;
    return out;
  }
  // The radius of the thickest other stem of the plant at the stem's base (its parent limb), cached on the stem.
  parentR(rec, st) {
    if (st.parentR >= 0) return st.parentR;
    const x = st.pts[0], y = st.pts[1], z = st.pts[2];
    let pr = 0;
    for (const o of this.stemsOf(rec)) {
      if (o === st || o.level >= st.level) continue;
      const P = o.pts;
      for (let i = 0; i < o.rad.length - 1; i++) {
        const ax = P[i * 3], ay = P[i * 3 + 1], az = P[i * 3 + 2], dx = P[i * 3 + 3] - ax, dy = P[i * 3 + 4] - ay, dz = P[i * 3 + 5] - az, L2 = dx * dx + dy * dy + dz * dz;
        if (L2 < 1e-8) continue;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2)), rr = o.rad[i] + (o.rad[i + 1] - o.rad[i]) * t;
        if (Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t) < rr + 0.02) pr = Math.max(pr, rr);
      }
    }
    return st.parentR = pr;
  }
  // Whether a bird can stand at arc length s of the stem (thick enough, not too steep, high enough, clear of the parent).
  perchable(rec, st, s, tmp) {
    if (s < 0 || s > st.len) return false;
    if (st.level > 0 && s < this.parentR(rec, st) + 0.1) return false;
    const a = this.at(st, s, tmp);
    return a.r >= PERCH_R && Math.abs(a.dy) <= PERCH_SLOPE && a.y + a.r - this.groundAt(a.x, a.z) >= PERCH_H;
  }
  // From arc length s, how far along the stem (sign: toward the tip +1 or the base -1) the perch goes, up to `max` m,
  // in STEP m steps: the new arc length.
  stepAlong(rec, st, s, sign, max, tmp) {
    const STEP = 0.05; let s1 = s;
    for (let d = STEP; d <= max + 1e-6; d += STEP) { const q = s + sign * d; if (!this.perchable(rec, st, q, tmp)) break; s1 = q; }
    return s1;
  }
  // A plant's name for the HUD: "blue oak".
  nameOf(rec) { return LIBRARY[rec.species]?.common || rec.species.replace(/_/g, ' '); }
}
