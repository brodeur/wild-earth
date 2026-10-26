// WGSL for the GPU placement prototype (docs/gpu-placement-prototype.md). Raw compute pipelines on
// WebGPURenderer's own GPUDevice; the draw is a TSL material in gpuPlaceTest.js.
//
// GEN: one thread per placement candidate. The CPU hands over a short list of work items (cell i, j,
// layer, rank range k0..k0+count) for the cells around the camera; a thread finds its item by binary
// search, runs grass.js's plantAt (mulberry32 draw, density x outcrop keep, road, water, bare patch,
// type, size, card role) and appends the plant to `outp` (two vec4 per plant, the client's instance
// layout: x, y, z, yaw | sxz, sy, seed, type + 2 * tier + 8 * role, with the rank in the fraction).
// Appends are compacted per workgroup (one global atomic per workgroup).
// ARGS: one thread turns the placed count into the cull pass's indirect dispatch size.
// CULL: one thread per placed plant: distance band and per-plant hand-over fade, card density LOD,
// frustum; survivors are appended to the draw buffer and counted into the indirect draw's instanceCount.

const COMMON = /* wgsl */`
struct Params {
  size: f32, res: f32, W: u32, H: u32,
  N: u32, nItems: u32, cap: u32, driftMean: f32,
  hW: u32, hRes: f32, sp: f32, gRes: f32,
  gW: u32, debug: u32, kTus: u32, kTuft: u32,
  oatK: f32, rTuft: f32, hasOutcrop: u32, total: u32,
};
// A work item: cell, layer, rank range, its first thread, the cell's annual share, and the cell origin on each
// noise lattice the placement samples (computed in double precision on the CPU: x = ox + dx, north = on - dy
// with ox = i res, on = size - j res; lat[s] = (int(ox / s), frac(ox / s), int(on / s), frac(on / s)) for
// s = 11, 4, 18, 6, 22, 7 m, lat[6] the same for the 5 m grids on x and on (size - north), lat[7] = ox, on as
// f32 hi + lo pairs for the water test). A thread then
// adds only its in-cell offset, so lattice coordinates keep ~1e-6 precision where plain f32 world
// coordinates (half a millimetre at 4-8 km) flipped a candidate or two per cell.
struct Item { i: u32, j: u32, layer: u32, k0: u32, count: u32, base: u32, share: f32, pad: u32, lat: array<vec4f, 8> };
`;

export const GEN_WGSL = COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> items: array<Item>;
@group(0) @binding(2) var<storage, read> cells: array<vec4f>;     // dens, herb, outcrop (0..255), 0
@group(0) @binding(3) var<storage, read> rw: array<u32>;          // 5 m grid, 2 px per word: road | water << 8
@group(0) @binding(4) var<storage, read> hts: array<f32>;         // heightfield (5 m)
@group(0) @binding(5) var<storage, read> wat: array<u32>;         // water buckets: segments and pond rings
@group(0) @binding(6) var<storage, read_write> outp: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> counters: array<atomic<u32>>;   // 0 placed, 2.. reject reasons
@group(0) @binding(8) var<storage, read_write> ids: array<vec2u>;              // debug: cell key, k | layer << 24

var<private> U: array<f32, 10>;
var<private> LAT: array<vec4f, 8>;
var<workgroup> wgCount: atomic<u32>;
var<workgroup> wgBase: u32;

// grass.js draw(): ten mulberry32 steps from a per-candidate seed. JS Math.imul and |0 are u32 wrapping here.
fn draw(i: u32, j: u32, k: u32) {
  var a: u32 = (i * 92821u) ^ (j * 68917u) ^ ((k + 1u) * 0x9E3779B1u) ^ 0x2c1b3c6du;
  for (var m = 0u; m < 10u; m++) {
    a = a + 0x6D2B79F5u;
    var t: u32 = (a ^ (a >> 15u)) * (1u | a);
    t = (t + ((t ^ (t >> 7u)) * (61u | t))) ^ t;
    U[m] = f32(t ^ (t >> 14u)) / 4294967296.0;
  }
}
fn hash2(i: i32, j: i32, s: u32) -> f32 {
  var h: u32 = bitcast<u32>(i) * 374761393u + bitcast<u32>(j) * 668265263u + s * 982451653u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return f32(h ^ (h >> 16u)) / 4294967296.0;
}
fn vnoise(x: f32, y: f32, s: u32) -> f32 {
  let fi = floor(x); let fj = floor(y);
  var fx = x - fi; var fy = y - fj;
  fx = fx * fx * (3.0 - 2.0 * fx); fy = fy * fy * (3.0 - 2.0 * fy);
  let i = i32(fi); let j = i32(fj);
  let a = hash2(i, j, s); let b = hash2(i + 1, j, s); let c = hash2(i, j + 1, s); let d = hash2(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// vnoise at (x / s, north / s) from the item's lattice origin l and the in-cell offset (dx, dy).
fn vnoiseL(l: u32, s: f32, dx: f32, dy: f32, seed: u32) -> f32 {
  let L = LAT[l]; let tx = L.y + dx / s; let ty = L.w - dy / s; let fx0 = floor(tx); let fy0 = floor(ty);
  var fx = tx - fx0; var fy = ty - fy0;
  fx = fx * fx * (3.0 - 2.0 * fx); fy = fy * fy * (3.0 - 2.0 * fy);
  let i = i32(L.x + fx0); let j = i32(L.z + fy0);
  let a = hash2(i, j, seed); let b = hash2(i + 1, j, seed); let c = hash2(i, j + 1, seed); let d = hash2(i + 1, j + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
fn smooth3(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn bareField(dx: f32, dy: f32) -> f32 { return 0.6 * vnoiseL(0u, 11.0, dx, dy, 3u) + 0.4 * vnoiseL(1u, 4.0, dx, dy, 4u); }
fn driftRaw(dx: f32, dy: f32) -> f32 { return 0.25 + 1.5 * smooth3(0.3, 0.75, 0.7 * vnoiseL(2u, 18.0, dx, dy, 51u) + 0.3 * vnoiseL(3u, 6.0, dx, dy, 52u)); }
fn oatStand(dx: f32, dy: f32) -> f32 { return 0.01 + 0.36 * smooth3(0.52, 0.72, 0.7 * vnoiseL(4u, 22.0, dx, dy, 41u) + 0.3 * vnoiseL(5u, 7.0, dx, dy, 42u)); }

// tilepackage.js rockKeep: outcrop likelihood (bilinear on the 30 m grid) and strips along the strike.
fn vhash(i: i32, j: i32) -> f32 {
  var h: u32 = (bitcast<u32>(i) * 73856093u) ^ (bitcast<u32>(j) * 19349663u) ^ 0x9e3779b9u;
  h = (h ^ (h >> 15u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return f32(h ^ (h >> 16u)) / 4294967296.0;
}
fn vnoiseT(u: f32, v: f32) -> f32 {
  let fi = floor(u); let fj = floor(v); let i = i32(fi); let j = i32(fj);
  let fu = u - fi; let fv = v - fj; let su = fu * fu * (3.0 - 2.0 * fu); let sv = fv * fv * (3.0 - 2.0 * fv);
  return (vhash(i, j) * (1.0 - su) + vhash(i + 1, j) * su) * (1.0 - sv) + (vhash(i, j + 1) * (1.0 - su) + vhash(i + 1, j + 1) * su) * sv;
}
fn outc(i: i32, j: i32) -> f32 {
  let ii = u32(clamp(i, 0, i32(P.W) - 1)); let jj = u32(clamp(j, 0, i32(P.H) - 1));
  return cells[jj * P.W + ii].z;
}
fn rockKeep(x: f32, n: f32, cb: vec2i, cf: vec2f) -> f32 {
  if (P.hasOutcrop == 0u) { return 1.0; }
  let tx = cf.x; let ty = cf.y; let x0 = cb.x; let y0 = cb.y;   // x / res - 0.5, (size - n) / res - 0.5 as base + fraction
  let L = ((outc(x0, y0) * (1.0 - tx) + outc(x0 + 1, y0) * tx) * (1.0 - ty) + (outc(x0, y0 + 1) * (1.0 - tx) + outc(x0 + 1, y0 + 1) * tx) * ty) / 255.0;
  if (L <= 0.4) { return 1.0; }
  let t = min((L - 0.4) / 0.25, 1.0); let s = t * t * (3.0 - 2.0 * t);
  let SA = -0.573576436351046; let CA = 0.819152044288992;   // sin, cos of the strike, -35 degrees
  let along = x * SA + n * CA; let across = x * CA - n * SA;
  let p = 0.72 * vnoiseT(across / 8.0 + 3.1, along / 30.0 + 7.7) + 0.28 * vnoiseT(across / 3.5 + 11.3, along / 12.0 + 5.9);
  let o = clamp((p - 0.38) / 0.24, 0.0, 1.0); let open = o * o * (3.0 - 2.0 * o);
  return 1.0 - s * (0.35 + 0.5 * open);
}

// Grass.sample: bilinear between habitat cell centres (component 0 dens, 1 herb). The sample point is
// u = x / res - 0.5 = i + ux - 0.5, given as integer base cb and fraction cf (no f32 sum i + ux, which
// lost ~2e-6 of a cell and flipped density near-ties).
fn sampleCell(cb: vec2i, cf: vec2f, c: u32) -> f32 {
  let fx = cf.x; let fy = cf.y; let i = cb.x; let j = cb.y;
  let W = i32(P.W); let H1 = i32(P.H) - 1;
  let i0 = u32(clamp(i, 0, W - 1)); let i1 = u32(clamp(i + 1, 0, W - 1));
  let r0 = u32(clamp(j, 0, H1)) * P.W; let r1 = u32(clamp(j + 1, 0, H1)) * P.W;
  return (cells[r0 + i0][c] * (1.0 - fx) + cells[r0 + i1][c] * fx) * (1.0 - fy) + (cells[r1 + i0][c] * (1.0 - fx) + cells[r1 + i1][c] * fx) * fy;
}
// Base and fraction of i + u - 0.5 for u in [0, 1).
fn cellCoord(i: u32, u: f32) -> vec2f { if (u >= 0.5) { return vec2f(f32(i), u - 0.5); } return vec2f(f32(i) - 1.0, u + 0.5); }

// 5 m grids (roads byte 0, water mask byte 1), as Grid8.at / WaterMask.channel.
fn grid(i: u32, j: u32, b: u32) -> u32 { let p = j * P.gW + i; return (rw[p >> 1u] >> ((p & 1u) * 16u + b * 8u)) & 255u; }
// The 5 m pixel of the candidate, from the item's grid origin (lat[6]) and the in-cell offset.
fn gridPx(dx: f32, dy: f32) -> vec2i {
  let L = LAT[6]; let tx = L.y + dx / P.gRes; let ty = L.w + dy / P.gRes;
  return vec2i(i32(L.x + floor(tx)), i32(L.z + floor(ty)));
}
fn roadAt(px: vec2i) -> u32 {
  let i = u32(clamp(px.x, 0, i32(P.gW) - 1)); let j = u32(clamp(px.y, 0, i32(P.gW) - 1));
  return grid(i, j, 0u);
}
fn wf(o: u32) -> f32 { return bitcast<f32>(wat[o]); }
// Even-odd test against a ring stored relative to its integer origin; (x, y) relative to the same origin.
fn inRing(x: f32, y: f32, off: u32, cnt: u32) -> bool {
  var inside = false; var j = cnt - 1u;
  for (var i = 0u; i < cnt; i++) {
    let xi = wf(off + 2u * i); let yi = wf(off + 2u * i + 1u); let xj = wf(off + 2u * j); let yj = wf(off + 2u * j + 1u);
    if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) { inside = !inside; }
    j = i;
  }
  return inside;
}
// WaterMask.inWater: pond rings and channel segments of the 30 m bucket. The point is rebuilt relative to
// its bucket from the item's double-precision cell origin (lat[7] = ox, on as f32 hi + lo) and the in-cell
// offset, and the bucket's segments and the rings are stored relative to their own origins, so the test
// keeps ~1e-5 m precision: in world f32 a candidate 0.07 mm from a channel edge came out on the other side.
fn inWater(dx: f32, dy: f32) -> bool {
  let O = LAT[7]; let nb = i32(wat[0]);
  let bxf = floor(O.x / 30.0); var bi = i32(bxf); var rx = (O.x - bxf * 30.0) + O.y + dx;
  let byf = floor(O.z / 30.0); var bj = i32(byf); var ry = (O.z - byf * 30.0) + O.w - dy;
  for (var q = 0; q < 3; q++) { if (rx >= 30.0) { bi += 1; rx -= 30.0; } if (rx < 0.0) { bi -= 1; rx += 30.0; } if (ry >= 30.0) { bj += 1; ry -= 30.0; } if (ry < 0.0) { bj -= 1; ry += 30.0; } }
  if (bi < 0 || bj < 0 || bi >= nb || bj >= nb) { return false; }
  let bk = u32(bj * nb + bi);
  let e = wat[1] + 2u * bk; let off = wat[e]; let cnts = wat[e + 1u];
  let ns = cnts & 0xffffu; let nr = cnts >> 16u;
  for (var r = 0u; r < nr; r++) {
    let ri = wat[2] + 8u * wat[off + 5u * ns + r];
    let lx = f32(bi * 30 - bitcast<i32>(wat[ri])) + rx; let ly = f32(bj * 30 - bitcast<i32>(wat[ri + 1u])) + ry;
    if (lx >= wf(ri + 2u) && lx <= wf(ri + 4u) && ly >= wf(ri + 3u) && ly <= wf(ri + 5u) && inRing(lx, ly, wat[3] + 2u * wat[ri + 6u], wat[ri + 7u])) { return true; }
  }
  for (var s = 0u; s < ns; s++) {
    let o = off + 5u * s; let hw = wf(o + 4u);
    if (hw > 0.0) {
      let ax = wf(o); let ay = wf(o + 1u); let dxs = wf(o + 2u) - ax; let dys = wf(o + 3u) - ay; let L = dxs * dxs + dys * dys;
      var t = 0.0; if (L > 0.0) { t = clamp(((rx - ax) * dxs + (ry - ay) * dys) / L, 0.0, 1.0); }
      let ex = ax + dxs * t - rx; let ey = ay + dys * t - ry;
      if (ex * ex + ey * ey < hw * hw) { return true; }
    }
  }
  return false;
}
// shrubfield.js waterAt: the grid, and the exact test only next to water.
fn waterAt(dx: f32, dy: f32, px: vec2i) -> u32 {
  let W = i32(P.gW);
  let i = clamp(px.x, 0, W - 1); let j = clamp(px.y, 0, W - 1);
  let g = grid(u32(i), u32(j), 1u);
  let a = grid(u32(max(i - 1, 0)), u32(j), 1u); let b = grid(u32(min(i + 1, W - 1)), u32(j), 1u);
  let c = grid(u32(i), u32(max(j - 1, 0)), 1u); let d = grid(u32(i), u32(min(j + 1, W - 1)), 1u);
  if (g == 255u && a == 255u && b == 255u && c == 255u && d == 255u) { return 255u; }
  if (g == 0u && a != 255u && b != 255u && c != 255u && d != 255u) { return 0u; }
  if (inWater(dx, dy)) { return 255u; }
  if (g == 255u) { return 200u; }
  return g;
}
// Heightfield.base (heights.png, bilinear between pixel centres: sample i at (i + 0.5) res) and the terrain
// mesh's 10 m triangles over it (cpuRef.js terrainHeight).
fn hAt(x: f32, n: f32) -> f32 {
  let w = f32(P.hW);
  let px = clamp(x / P.hRes - 0.5, 0.0, w - 1.001); let py = clamp((P.size - n) / P.hRes - 0.5, 0.0, w - 1.001);
  let x0 = floor(px); let y0 = floor(py); let fx = px - x0; let fy = py - y0;
  let i = u32(y0) * P.hW + u32(x0);
  return (hts[i] * (1.0 - fx) + hts[i + 1u] * fx) * (1.0 - fy) + (hts[i + P.hW] * (1.0 - fx) + hts[i + P.hW + 1u] * fx) * fy;
}
fn ground(x: f32, n: f32) -> f32 {
  let u = x / P.sp; let v = (P.size - n) / P.sp; let i = floor(u); let j = floor(v); let fx = u - i; let fy = v - j;
  let x0 = i * P.sp; let x1 = x0 + P.sp; let n0 = P.size - j * P.sp; let n1 = n0 - P.sp;
  let b = hAt(x0, n1); let d = hAt(x1, n0);
  if (fx + fy <= 1.0) { let a = hAt(x0, n0); return a + (d - a) * fx + (b - a) * fy; }
  let c = hAt(x1, n1); return c + (b - c) * (1.0 - fx) + (d - c) * (1.0 - fy);
}

struct Plant { a: vec4f, b: vec4f, role: u32 };
// Grass.plantAt. Returns 0 (a plant) or the reason it is skipped: 1 density, 2 outcrop thinning, 3 road,
// 4 water, 5 bare patch.
fn plantAt(i: u32, j: u32, k: u32, share: f32, layer: u32, pl: ptr<function, Plant>) -> u32 {
  draw(i, j, k);
  let ux = U[0]; let uy = U[1]; let keep = U[2];
  let dx = ux * P.res; let dy = uy * P.res;
  // World position from the double-precision cell origin (lat[7]), so it rounds once to f32 as the CPU's does.
  let px = (LAT[7].x + dx) + LAT[7].y; let pn = (LAT[7].z - dy) + LAT[7].w;
  let ccx = cellCoord(i, ux); let ccy = cellCoord(j, uy);
  let cb = vec2i(i32(ccx.x), i32(ccy.x)); let cf = vec2f(ccx.y, ccy.y);
  let dRaw = sampleCell(cb, cf, 0u);
  let dens = dRaw * rockKeep(px, pn, cb, cf);
  if (keep >= dens) { if (keep < dRaw) { return 2u; } return 1u; }
  let gp = gridPx(dx, dy);
  let rwv = roadAt(gp);
  if (rwv > 140u || (rwv > 0u && U[8] < 0.5)) { return 3u; }
  let wv = waterAt(dx, dy, gp);
  if (wv == 255u) { return 4u; }
  let herb = sampleCell(cb, cf, 1u); let bare = bareField(dx, dy); let thr = 0.28 + 0.14 * (1.0 - herb);
  let open = smooth3(thr - 0.06, thr + 0.06, bare);
  if (keep >= dens * (0.4 + 0.6 * open)) { return 5u; }
  var ty = 0u; if (U[6] < min((1.0 - share) * driftRaw(dx, dy) / P.driftMean, 0.95)) { ty = 1u; }
  let s = (0.75 + 0.5 * U[4]) * (0.7 + 0.45 * herb) * (0.6 + 0.4 * smooth3(thr, thr + 0.15, bare));
  let r = (f32(k) + 0.5) / f32(P.N);
  var role = 0u;
  if (keep < dens * open) {
    if (ty == 1u) { if (k < P.kTus && U[9] >= 0.75 * f32(wv) / 200.0) { role = 2u; } }
    else if (k < P.kTuft) { role = 1u; }
    else if (r < P.rTuft + P.oatK * oatStand(dx, dy) && rwv <= 120u && U[9] >= 0.85 * f32(wv) / 200.0) { role = 3u; }
  }
  var big = 1.0; if (role == 2u) { big = 1.2; }
  (*pl).a = vec4f(px, ground(px, pn), -pn, U[3] * 6.283185307179586);
  (*pl).b = vec4f(s * (0.85 + 0.3 * U[5]) * big, s * big, U[7], f32(ty + 2u * layer + 8u * role) + 0.999 * r);
  (*pl).role = role;
  return 0u;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32, @builtin(num_workgroups) nwg: vec3u) {
  let t = gid.x + gid.y * nwg.x * 256u;
  if (li == 0u) { atomicStore(&wgCount, 0u); }
  workgroupBarrier();
  var pl: Plant; var ok = false; var slot = 0u; var key = 0u; var kl = 0u;
  if (t < P.total) {
    var lo = 0u; var hi = P.nItems - 1u;
    while (lo < hi) { let mid = (lo + hi + 1u) / 2u; if (items[mid].base <= t) { lo = mid; } else { hi = mid - 1u; } }
    let it = items[lo]; let k = it.k0 + (t - it.base); LAT = it.lat;
    let reason = plantAt(it.i, it.j, k, it.share, it.layer, &pl);
    ok = reason == 0u && (it.layer < 3u || pl.role != 0u);
    if (P.debug == 1u) { atomicAdd(&counters[2u + reason], 1u); key = it.j * P.W + it.i; kl = k | (it.layer << 24u); }
  }
  if (ok) { slot = atomicAdd(&wgCount, 1u); }
  workgroupBarrier();
  if (li == 0u) { wgBase = atomicAdd(&counters[0], atomicLoad(&wgCount)); }
  workgroupBarrier();
  if (ok) {
    let o = wgBase + slot;
    if (o < P.cap) {
      outp[2u * o] = pl.a; outp[2u * o + 1u] = pl.b;
      if (P.debug == 1u) { ids[o] = vec2u(key, kl); }
    }
  }
}
`;

export const ARGS_WGSL = /* wgsl */`
@group(0) @binding(0) var<storage, read> counters: array<u32>;
@group(0) @binding(1) var<storage, read_write> args: array<u32>;
@group(0) @binding(2) var<uniform> cap: vec4u;
@compute @workgroup_size(1)
fn main() {
  let n = min(counters[0], cap.x);
  let g = (n + 255u) / 256u;
  args[0] = min(g, 65535u); args[1] = max(1u, (g + 65534u) / 65535u); args[2] = 1u;
  args[3] = n;
}
`;

// Cull parameters: frustum planes, camera, per-tier bands, per-role card bands and LOD, card boxes.
export const CULL_WGSL = /* wgsl */`
struct Cull {
  planes: array<vec4f, 6>,
  cam: vec4f,                       // x, y, z, -
  tier: array<vec4f, 3>,            // blade tiers: fade0, fade1 (thin out), -, -
  band: array<vec4f, 4>,            // per role 1..3: card in0, in1, out0, out1
  lod: array<vec4f, 4>,             // per role 1..3: D0, KMIN, rank span of the role's range, its first rank
  box: array<vec4f, 4>,             // index 0: blade card (half-width k, height k); 1..3 per role card
  cap: u32, p0: u32, p1: u32, p2: u32,
};
@group(0) @binding(0) var<uniform> C: Cull;
@group(0) @binding(1) var<storage, read> inp: array<vec4f>;
@group(0) @binding(2) var<storage, read> args: array<u32>;     // [3] placed count
@group(0) @binding(3) var<storage, read_write> outd: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> ind: array<atomic<u32>>;   // drawIndexedIndirect args; [1] instanceCount
var<workgroup> wgCount: atomic<u32>;
var<workgroup> wgBase: u32;
fn smooth3(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32, @builtin(num_workgroups) nwg: vec3u) {
  let t = gid.x + gid.y * nwg.x * 256u;
  if (li == 0u) { atomicStore(&wgCount, 0u); }
  workgroupBarrier();
  var ok = false; var slot = 0u; var A = vec4f(0.0); var B = vec4f(0.0);
  if (t < args[3]) {
    A = inp[2u * t]; B = inp[2u * t + 1u];
    let codef = floor(B.w); let r = (B.w - codef) / 0.999; let c = u32(codef);
    let ty = c & 1u; let tier = (c >> 1u) & 3u; let role = c >> 3u;
    let d = distance(C.cam.xyz, A.xyz);
    var f = 1.0; var w = 0.0; var h = 0.0;
    if (tier < 3u) {
      f = 1.0 - smooth3(C.tier[tier].x, C.tier[tier].y, d);
      if (role != 0u) { f = min(f, 1.0 - smooth3(C.band[role].x, C.band[role].y, d)); }   // hands over to its card
      w = C.box[0].x * B.x; h = C.box[0].y * B.y;
    } else {
      f = smooth3(C.band[role].x, C.band[role].y, d) * (1.0 - smooth3(C.band[role].z, C.band[role].w, d));
      let L = C.lod[role];
      let keep = clamp(L.x * L.x / max(d * d, 1.0), L.y, 1.0);
      if ((r - L.w) / L.z >= keep + 0.06) { f = 0.0; }        // density LOD: the lowest ranks stay, survivors grow
      let g = 1.0 / sqrt(keep);
      w = C.box[role].x * B.x * g; h = C.box[role].y * B.y * sqrt(g);
    }
    if (f > 0.004) {
      let cen = A.xyz + vec3f(0.0, 0.5 * h, 0.0); let rad = max(w, 0.5 * h) * 1.5;
      var inside = true;
      for (var p = 0u; p < 6u; p++) { if (dot(C.planes[p].xyz, cen) + C.planes[p].w < -rad) { inside = false; } }
      if (inside) { ok = true; B = vec4f(w, h, f, f32(ty + 2u * role + select(0u, 8u, tier == 3u))); }
    }
  }
  if (ok) { slot = atomicAdd(&wgCount, 1u); }
  workgroupBarrier();
  if (li == 0u) { wgBase = atomicAdd(&ind[1], atomicLoad(&wgCount)); }
  workgroupBarrier();
  if (ok) { let o = wgBase + slot; if (o < C.cap) { outd[2u * o] = A; outd[2u * o + 1u] = B; } }
}
`;
// Clamp the indirect draw's instanceCount to the draw buffer's capacity (the cull counts every survivor).
export const CLAMP_WGSL = /* wgsl */`
@group(0) @binding(0) var<storage, read_write> ind: array<u32>;
@group(0) @binding(1) var<uniform> cap: vec4u;
@compute @workgroup_size(1)
fn main() { ind[5] = ind[1]; ind[1] = min(ind[1], cap.x); }
`;
