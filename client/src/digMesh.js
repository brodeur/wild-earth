// The soil as a solid, and its surface meshed in chunks (Dig's carving, docs/game-dig.md "Drawing"). Shared by the
// mesher's worker (digMesh.worker.js) and dig's main thread when no worker can run. No three.js here: plain arrays.
//
// Aaron, 2026-11-04: "Right now it seems like we're making polygons but is there a way instead to "remove" from a
// polygon? What if we made a polygon on the underside of the earth that has the mirror polygon roof of the ground
// polygon. The user "digs" which creates a joint between these two surfaces, and then starts "removing" the polygon."
//
// The soil's distance field: f(p) = smax(y - G(x, z), -C(p), kL), negative in the soil. G is the drawn ground plus the
// spoil heaped on it (the chunk's own samples, bilinear between them); C the carved air: per group of primitives the
// plain minimum (a tunnel's straight run of round cones through its two-segment nodes: no bulge at a joint), across
// groups a smooth minimum of kJ (a junction, a room's doorway, the collar's bend into the tunnel, a pit breaking into
// a tunnel: filleted). The ground and the air meet in a rounded lip of kL: the mouth is one surface, ground into wall.
//
// A chunk is n^3 cells of h m from (ox, oy, oz): surface nets over the lattice points -1..n, a vertex per cell that
// the surface crosses (the mean of its edge crossings, then one Newton step onto the field's zero), a quad per lattice
// edge the chunk owns (start point in 0..n-1 on every axis), so two chunks of one h share their border's vertices
// exactly and the surface is watertight across them. The ground far from any opening is not kept (a quad all of whose
// vertices are ground-side, further than patchD from the air and under no spoil): the terrain draws it.

export const T_CAP = 1, T_ROOM = 2, T_COLLAR = 3, T_PIT = 4;
// a primitive: [type, _, ax, ay, az, ra, bx, by, bz, rb, slotA, slotB, joinA, joinB]
// T_CAP a round cone between two nodes (slots: the nodes' glow slots; join: that end is a plain two-segment node, so
// the next cone there is the same group). T_ROOM an ellipsoid (r, 0.8 r, r) at a. T_COLLAR a hole's vertical shaft, a
// to b at radius ra. T_PIT a bowl: rim on the ground at a (x, y0, z), radius ra, depth rb, its floor a parabola.
export const PSTRIDE = 14;
// cells by the smallest radius in reach: about a third of it, in powers of two so neighbouring chunks of a component agree
export const hFor = s => (s < 0.045 ? 0.01 : s < 0.12 ? 0.02 : 0.04);

const smin = (a, b, k) => { const h = k - Math.abs(a - b); return h <= 0 ? Math.min(a, b) : Math.min(a, b) - h * h * 0.25 / k; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// iq's round cone, a (r1) to b (r2); degenerate cases as spheres
function roundCone(px, py, pz, ax, ay, az, r1, bx, by, bz, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az, l2 = bax * bax + bay * bay + baz * baz;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const rr = r1 - r2, a2 = l2 - rr * rr;
  if (l2 < 1e-12 || a2 <= 1e-12) {   // one sphere holds the other (or none apart): the bigger
    const da = Math.hypot(pax, pay, paz) - r1, db = Math.hypot(px - bx, py - by, pz - bz) - r2;
    return Math.min(da, db);
  }
  const il2 = 1 / l2, y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y, x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2, z2 = z * z * l2, k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

// One chunk's field: the primitives parsed, grouped, with their bounds for the skip test
class Field {
  constructor(job) {
    const P = job.prims, np = P.length / PSTRIDE;
    this.P = P; this.np = np; this.kJ = job.kJ; this.kL = job.kL;
    this.ox = job.ox; this.oz = job.oz; this.h = job.h; this.n = job.n; this.G = job.G; this.M = job.M;
    // groups: a tunnel's straight run is one (its cones meet at plain nodes); everything else its own
    const par = new Int32Array(np); for (let i = 0; i < np; i++) par[i] = i;
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const at = new Map();
    for (let i = 0; i < np; i++) {
      const o = i * PSTRIDE; if (P[o] !== T_CAP) continue;
      for (const [s, j] of [[P[o + 10], P[o + 12]], [P[o + 11], P[o + 13]]]) {
        if (!j) continue;
        const k = at.get(s); if (k === undefined) at.set(s, i); else { const a = find(i), b = find(k); if (a !== b) par[a] = b; }
      }
    }
    const gid = new Map(); this.grp = new Int32Array(np);
    for (let i = 0; i < np; i++) { const r = find(i); let g = gid.get(r); if (g === undefined) { g = gid.size; gid.set(r, g); } this.grp[i] = g; }
    this.ng = gid.size; this.gmin = new Float64Array(this.ng);
    // bounds (the primitive's box, its radius in), for a lower bound on its distance
    this.box = new Float64Array(np * 6);
    for (let i = 0; i < np; i++) {
      const o = i * PSTRIDE, t = P[o], b = i * 6;
      if (t === T_PIT) { const r = P[o + 5]; this.box.set([P[o + 2] - r, -1e9, P[o + 4] - r, P[o + 2] + r, 1e9, P[o + 4] + r], b); continue; }
      if (t === T_ROOM) { const r = P[o + 5]; this.box.set([P[o + 2] - r, P[o + 3] - r, P[o + 4] - r, P[o + 2] + r, P[o + 3] + r, P[o + 4] + r], b); continue; }
      const r = Math.max(P[o + 5], P[o + 9]);
      this.box.set([Math.min(P[o + 2], P[o + 6]) - r, Math.min(P[o + 3], P[o + 7]) - r, Math.min(P[o + 4], P[o + 8]) - r,
        Math.max(P[o + 2], P[o + 6]) + r, Math.max(P[o + 3], P[o + 7]) + r, Math.max(P[o + 4], P[o + 8]) + r], b);
    }
  }
  // the ground (with spoil) and the spoil alone at (x, z): bilinear in the chunk's samples; none in a deep chunk
  ground(x, z, spoil = false) {
    const A = spoil ? this.M : this.G; if (!A) return spoil ? 0 : 1e4;
    const N = this.n + 2, h = this.h;
    let u = (x - this.ox) / h + 1, v = (z - this.oz) / h + 1;
    u = Math.min(Math.max(u, 0), N - 1.0001); v = Math.min(Math.max(v, 0), N - 1.0001);
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * N + i;
    return (A[k] * (1 - fu) + A[k + 1] * fu) * (1 - fv) + (A[k + N] * (1 - fu) + A[k + N + 1] * fu) * fv;
  }
  // one primitive's distance (negative inside the air)
  prim(i, x, y, z) {
    const P = this.P, o = i * PSTRIDE, t = P[o];
    if (t === T_CAP || t === T_COLLAR) return roundCone(x, y, z, P[o + 2], P[o + 3], P[o + 4], P[o + 5], P[o + 6], P[o + 7], P[o + 8], P[o + 9]);
    if (t === T_ROOM) {
      const r = P[o + 5], ry = r * 0.8, qx = (x - P[o + 2]) / r, qy = (y - P[o + 3]) / ry, qz = (z - P[o + 4]) / r;
      const k0 = Math.hypot(qx, qy, qz), k1 = Math.hypot(qx / r, qy / ry, qz / r);
      return k1 < 1e-9 ? -ry : k0 * (k0 - 1) / k1;
    }
    // T_PIT: the floor a parabola under the ground (its rim follows the ground)
    const r = P[o + 5], depth = P[o + 9], dx = x - P[o + 2], dz = z - P[o + 4], rho2 = dx * dx + dz * dz, rho = Math.sqrt(rho2);
    const g0 = this.G ? this.ground(x, z) - this.ground(x, z, true) : P[o + 3];
    const floor = g0 - depth * (1 - rho2 / (r * r)), sl = 2 * depth * rho / (r * r);
    return Math.max((floor - y) / Math.sqrt(1 + sl * sl), rho - r);
  }
  // the carved air's distance C (Infinity with nothing in reach); info: the nearest primitive
  carve(x, y, z, info = null) {
    const gm = this.gmin, ng = this.ng, B = this.box; gm.fill(Infinity);
    let best = Infinity, bi = -1;
    for (let i = 0; i < this.np; i++) {
      const b = i * 6;
      const ex = Math.max(B[b] - x, 0, x - B[b + 3]), ey = Math.max(B[b + 1] - y, 0, y - B[b + 4]), ez = Math.max(B[b + 2] - z, 0, z - B[b + 5]);
      const lb = Math.sqrt(ex * ex + ey * ey + ez * ez);   // the box holds the air: outside it, at least this far
      if (lb > best + this.kJ) continue;
      const d = this.prim(i, x, y, z), g = this.grp[i];
      if (d < gm[g]) gm[g] = d;
      if (d < best) { best = d; bi = i; }
    }
    if (info) info.near = bi;
    if (bi < 0) return Infinity;
    let c = Infinity;
    for (let g = 0; g < ng; g++) { const d = gm[g]; if (d === Infinity) continue; c = c === Infinity ? d : smin(c, d, this.kJ); }
    return c;
  }
  f(x, y, z) {
    const gT = y - this.ground(x, z), c = this.carve(x, y, z);
    if (c === Infinity) return gT;
    const a = gT, b = -c, k = this.kL, hh = k - Math.abs(a - b);   // smax
    return hh <= 0 ? Math.max(a, b) : Math.max(a, b) + hh * hh * 0.25 / k;
  }
}

// the gradient by four samples (a tetrahedron), into g; returns |g|^2 scaled to the true gradient
function grad(F, x, y, z, e, g) {
  const a = F.f(x + e, y - e, z - e), b = F.f(x - e, y - e, z + e), c = F.f(x - e, y + e, z - e), d = F.f(x + e, y + e, z + e);
  const s = 1 / (4 * e);
  g[0] = (a - b - c + d) * s; g[1] = (-a - b + c + d) * s; g[2] = (-a + b - c + d) * s;
  return g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
}

// job: { ox, oy, oz, h, n, kL, kJ, patchD, prims: Float32Array, G, M: Float32Array (n+2)^2 or null (deep) }
// returns { pos, nrm, mix, gref: Float32Array; idx: Uint32Array } (mix: pit, out, spoil, depth under the ground;
// gref: glow slots A, B and t along)
export function meshChunk(job) {
  const F = new Field(job), n = job.n, h = job.h, patchD = job.patchD;
  // positions from the global lattice (integer cells times h), so two chunks compute a shared cell bit for bit
  const bi = Math.round(job.ox / h), bj = Math.round(job.oy / h), bk = Math.round(job.oz / h);
  const LX = i => (bi + i) * h, LY = j => (bj + j) * h, LZ = k => (bk + k) * h;
  const N1 = n + 2, S = new Float32Array(N1 * N1 * N1);   // the field at the lattice points -1..n
  const PI = (i, j, k) => (k * N1 + j) * N1 + i;
  let neg = 0, air = 0;
  for (let k = 0; k < N1; k++) { const z = LZ(k - 1);
    for (let j = 0; j < N1; j++) { const y = LY(j - 1);
      for (let i = 0; i < N1; i++) { let v = F.f(LX(i - 1), y, z); if (v === 0) v = 1e-9; S[PI(i, j, k)] = v; if (v < 0) neg++; else air++; } } }
  const empty = { pos: new Float32Array(0), nrm: new Float32Array(0), mix: new Float32Array(0), gref: new Float32Array(0), idx: new Uint32Array(0) };
  if (!neg || !air) return empty;
  // a vertex per crossed cell (cells by their min corner's point index 0..n)
  const NC = n + 1, vid = new Int32Array(NC * NC * NC).fill(-1), CI = (i, j, k) => (k * NC + j) * NC + i;
  const P = [], Nn = [], Mx = [], Gr = [], keep = [];
  const g = [0, 0, 0], info = { near: -1 }, EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  for (let k = 0; k < NC; k++) for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
    let m = 0;
    for (let c = 0; c < 8; c++) { const v = S[PI(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; cv[c] = v; if (v < 0) m |= 1 << c; }
    if (m === 0 || m === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of EDGES) {
      const va = cv[a], vb = cv[b]; if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t; cnt++;
    }
    const x0 = LX(i - 1), y0 = LY(j - 1), z0 = LZ(k - 1);
    let x = x0 + sx / cnt * h, y = y0 + sy / cnt * h, z = z0 + sz / cnt * h;
    // one Newton step onto the surface, kept near its cell
    const e = h * 0.05, f0 = F.f(x, y, z), gg = grad(F, x, y, z, e, g);
    if (gg > 1e-8) {
      const lo = -0.3 * h, hi = 1.3 * h;
      x = Math.min(Math.max(x - f0 * g[0] / gg, x0 + lo), x0 + hi); y = Math.min(Math.max(y - f0 * g[1] / gg, y0 + lo), y0 + hi); z = Math.min(Math.max(z - f0 * g[2] / gg, z0 + lo), z0 + hi);
    }
    const g2 = grad(F, x, y, z, e, g), gl = Math.sqrt(g2) || 1;
    // what the surface is here: the ground (out) or the air's wall, a pit's bowl, spoil, and the nearest node's glow
    const gT = y - F.ground(x, z), c = F.carve(x, y, z, info), spoil = F.ground(x, z, true);
    const out = c === Infinity ? 1 : sstep(-0.5 * F.kL, 0.5 * F.kL, gT + c);
    const ni = info.near, po = ni * PSTRIDE, pt = ni >= 0 ? job.prims[po] : 0;
    let sa = -1, sb = -1, tt = 0;
    if (pt === T_CAP) {
      const Pp = job.prims, ax = Pp[po + 2], ay = Pp[po + 3], az = Pp[po + 4], bx = Pp[po + 6] - ax, by = Pp[po + 7] - ay, bz = Pp[po + 8] - az, l2 = bx * bx + by * by + bz * bz;
      tt = l2 > 1e-12 ? Math.min(1, Math.max(0, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / l2)) : 0; sa = Pp[po + 10]; sb = Pp[po + 11];
    } else if (pt === T_ROOM || pt === T_COLLAR) { sa = sb = job.prims[po + 10]; }
    vid[CI(i, j, k)] = P.length / 3;
    P.push(x, y, z); Nn.push(g[0] / gl, g[1] / gl, g[2] / gl);
    Mx.push(pt === T_PIT ? 1 : 0, out, out * sstep(0.0005, 0.004, spoil), (F.G ? F.ground(x, z) - spoil : 1) - y);
    Gr.push(sa, sb, tt);
    keep.push(out < 0.5 || c < patchD || spoil > 0.0005 ? 1 : 0);
  }
  // the quads: an owned lattice edge (start point 1..n in the point index: local 0..n-1) whose ends differ
  const I = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (!keep[a] && !keep[b] && !keep[c] && !keep[d]) return;
    if (flip) I.push(a, c, b, a, d, c); else I.push(a, b, c, a, c, d);
  };
  for (let k = 1; k <= n; k++) for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) {
    const s0 = S[PI(i, j, k)] < 0;
    if (s0 !== (S[PI(i + 1, j, k)] < 0))   // along x: the cells round it in (y, z)
      quad(vid[CI(i, j - 1, k - 1)], vid[CI(i, j, k - 1)], vid[CI(i, j, k)], vid[CI(i, j - 1, k)], !s0);
    if (s0 !== (S[PI(i, j + 1, k)] < 0))   // along y: in (z, x)
      quad(vid[CI(i - 1, j, k - 1)], vid[CI(i - 1, j, k)], vid[CI(i, j, k)], vid[CI(i, j, k - 1)], !s0);
    if (s0 !== (S[PI(i, j, k + 1)] < 0))   // along z: in (x, y)
      quad(vid[CI(i - 1, j - 1, k)], vid[CI(i, j - 1, k)], vid[CI(i, j, k)], vid[CI(i - 1, j, k)], !s0);
  }
  if (!I.length) return empty;
  // only the vertices the kept quads use
  const remap = new Int32Array(P.length / 3).fill(-1); let nv = 0;
  for (const v of I) if (remap[v] < 0) remap[v] = nv++;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), mix = new Float32Array(nv * 4), gref = new Float32Array(nv * 3), idx = new Uint32Array(I.length);
  for (let v = 0; v < remap.length; v++) {
    const w = remap[v]; if (w < 0) continue;
    pos[w * 3] = P[v * 3]; pos[w * 3 + 1] = P[v * 3 + 1]; pos[w * 3 + 2] = P[v * 3 + 2];
    nrm[w * 3] = Nn[v * 3]; nrm[w * 3 + 1] = Nn[v * 3 + 1]; nrm[w * 3 + 2] = Nn[v * 3 + 2];
    for (let q = 0; q < 4; q++) mix[w * 4 + q] = Mx[v * 4 + q];
    gref[w * 3] = Gr[v * 3]; gref[w * 3 + 1] = Gr[v * 3 + 1]; gref[w * 3 + 2] = Gr[v * 3 + 2];
  }
  for (let q = 0; q < I.length; q++) idx[q] = remap[I[q]];
  return { pos, nrm, mix, gref, idx };
}
