import * as THREE from 'three';
import { treeWood } from './treegen.js';
import { isStashTree } from './animals.js';
import { mulberry32 } from './trees.js';
import { seasonState } from './terrain.js';

// Small life on the trees near the eye (2026-11-04, the close layer; docs/decisions.md "the close layer"):
//
//   granaries  the acorn woodpeckers' storage trees are the acorn game's stash trees (animals.js isStashTree: one oak in
//              eight, snags too, never a sapling; the woodpecker families live on them). Within GRAN_R of the eye their
//              bole is drilled from 0.6 m up to where the trunk forks (or 70 % of its length): holes 1.6-2.2 cm across,
//              250 a square metre on an old tree or a snag (holes a few centimetres apart, as on a real granary), 90 on
//              a younger one. Each hole holds an acorn, its blunt end flush with the bark, by the month's share (most in
//              autumn and winter, a third in summer when the store is eaten down), and at least as many as the acorn
//              game's granary holds. The holes sit on the drawn bole: the trunk stem of the tree's own wood
//              (treegen.treeWood, the skeleton the near tier tubes) through the near instance's matrix, on the faces of
//              its polygon: each hole is cast out from the trunk's axis onto the near trunk's own triangles and lies
//              flush on the facet it meets, a decal (polygon offset), with the acorn's dome standing 3 mm proud.
//   galls      oak apples on valley oaks (the California gall wasp's, 3-10 cm, cream with a red flush in spring, tan by
//              summer, brown by winter, a year-old one black) and the smaller galls of blue oaks (1-3 cm), on the
//              thinnest drawn wood of the crown, 0-40 a tree (a third of the trees heavily galled), within GALL_R.
//
// Per (species, seed) the sites are found once in the tree's frame; per tree they are placed by its instance matrix.
// One instanced draw each (holes, acorn butts, galls), vertex colours, no texture. Rebuilt when the eye has moved
// MOVE m or the near set or the month changed (about 1 ms with three granaries in reach).
// Debugging: scene.getObjectByName('close life').userData.life is this object (stats).

const GRAN_R = 25, GALL_R = 40, MOVE = 4;
const FILL = [0.85, 0.8, 0.7, 0.55, 0.45, 0.35, 0.3, 0.3, 0.4, 0.7, 0.85, 0.9];   // the share of holes holding an acorn, by month
const GALL_SP = {
  quercus_lobata: { size: [0.03, 0.1], heavy: 40, light: 6 },
  quercus_douglasii: { size: [0.01, 0.03], heavy: 30, light: 4 },
};
const lin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const linRGB = (r, g, b) => new THREE.Color(lin(r), lin(g), lin(b));
// gall colours by month: fresh in spring, tan in summer, brown in winter; a year-old gall blackened
const GALL_COL = m => m >= 3 && m <= 5 ? [0.82, 0.78, 0.62] : m >= 6 && m <= 8 ? [0.78, 0.68, 0.5] : m >= 9 && m <= 10 ? [0.62, 0.5, 0.36] : [0.45, 0.36, 0.27];

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// A pecked hole, drawn flush on the bark's facet (polygon offset wins the tie): a dark mouth 0.84 across, its pale rim of
// pecked wood out to 1, the edge softened into the bark by a darker outer ring.
function holeGeometry() {
  const N = 12, pos = [], col = [], idx = [];
  const ring = (r, c) => { const b = pos.length / 3; for (let k = 0; k < N; k++) { const a = k / N * Math.PI * 2; pos.push(Math.cos(a) * r, Math.sin(a) * r, 0); col.push(c, c * 0.95, c * 0.88); } return b; };
  const centre = pos.length / 3; pos.push(0, 0, 0); col.push(0.02, 0.02, 0.02);
  const mouth = ring(0.42, 0.04), lip = ring(0.47, 0.75), outer = ring(0.6, 0.5);
  for (let k = 0; k < N; k++) {
    const k1 = (k + 1) % N;
    idx.push(centre, mouth + k, mouth + k1);
    idx.push(mouth + k, lip + k, lip + k1, mouth + k, lip + k1, mouth + k1);
    idx.push(lip + k, outer + k, outer + k1, lip + k, outer + k1, lip + k1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
// An acorn's blunt end in its hole: a low dome 0.84 across, the pale cap scar at its top.
function buttGeometry() {
  const g = new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(Math.PI / 2); g.scale(1, 1, 0.45);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i), scar = z > 0.17 ? 1 : 0; col.set(scar ? [1.25, 1.1, 0.85] : [1, 1, 1], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// A gall: a lumpy ball 1 across, on a short neck at -y (where it joins the twig).
function gallGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 2), p = g.attributes.position, r = mulberry32(5150), bumps = [];
  for (let k = 0; k < 7; k++) { const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(); bumps.push([v, 0.04 + 0.05 * r()]); }
  const v = new THREE.Vector3(), col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let rad = 0.5; for (const [b, a] of bumps) rad += a * Math.max(0, v.dot(b)) ** 6;
    if (v.y < -0.85) rad *= 0.75;   // the neck
    p.setXYZ(i, v.x * rad, v.y * rad, v.z * rad);
    const sp = 0.9 + 0.2 * r(), blush = Math.max(0, v.y) * 0.15;
    col.set([sp + blush, sp - blush * 0.4, sp - blush * 0.6], i * 3);
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

export class CloseLife {
  constructor({ scene, veg, atmosphere = null, acorns = null }) {
    Object.assign(this, { scene, veg, acorns });
    this.group = new THREE.Group(); this.group.name = 'close life'; this.group.userData.life = this;
    scene.add(this.group);
    this.sites = new Map();   // `${species}:${seed}` -> { holes: Float32Array (x, y, z, nx, ny, nz, area weight), galls: [...] }
    this.stats = { granaries: 0, holes: 0, acorns: 0, galls: 0, ms: 0 };
    const mat = () => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); atmosphere?.patchLambert(m); return m; };
    const mk = (geo, name) => {
      const m = new THREE.InstancedMesh(geo, mat(), 1); m.count = 0; m.frustumCulled = false; m.name = `close life ${name}`;
      m.userData.cap = 0; this.group.add(m); return m;
    };
    this.holes = mk(holeGeometry(), 'holes'); this.butts = mk(buttGeometry(), 'acorns'); this.galls = mk(gallGeometry(), 'galls');
    for (const m of [this.holes.material, this.butts.material]) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4; }
    this.at = null; this.nearV = -1; this.month = -1; this.gameN = '';
    this.m4 = new THREE.Matrix4(); this.on = true;
  }
  set(on) { this.on = !!on; this.group.visible = this.on; }
  ensure(mesh, n) {
    if (n <= mesh.userData.cap && mesh.instanceColor) return;
    const cap = Math.max(n, Math.ceil(mesh.userData.cap * 1.5), 256);
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16).setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.userData.cap = cap;
  }
  // The sites of a (species, seed) in the tree's frame: holes on the trunk stem's faces from 0.6 m to its fork, and
  // gall seats on the thinnest drawn wood.
  sitesOf(species, seed, geo) {
    const key = `${species}:${seed}`; let S = this.sites.get(key); if (S) return S;
    const w = treeWood(species, seed);
    S = { holes: [], gall: [] };
    if (w?.stems?.length) {
      const st = w.stems.find(s => s.level === 0) || w.stems[0], P = st.pts, R = st.rad, n = R.length;
      // where the first child leaves the trunk: the fork (the first stem of level 1 starting above 1.5 m), else 70 %
      let top = P[(n - 1) * 3 + 1] * 0.7;
      for (const s of w.stems) if (s.level === 1 && s.pts[1] > 1.5) top = Math.min(top, s.pts[1]);
      // the drawn bole: the near trunk's triangles (its CPU positions are kept for picking) by 10 cm of height, those
      // near the trunk's axis only; a hole is cast out from the axis onto them and lies on the facet it meets
      const tris = new Map(), GP = geo?.attributes?.position, GI = geo?.index;
      if (GP && GI) {
        const ax = y => { let i = 0; while (i < n - 2 && P[i * 3 + 4] < y) i++; return i; };
        for (let t = 0; t < GI.count; t += 3) {
          const a = GI.getX(t), b = GI.getX(t + 1), c = GI.getX(t + 2);
          const y0 = Math.min(GP.getY(a), GP.getY(b), GP.getY(c)), y1 = Math.max(GP.getY(a), GP.getY(b), GP.getY(c));
          if (y1 < 0.5 || y0 > top + 0.3) continue;
          const cy = (y0 + y1) / 2, i = ax(cy), cx = (GP.getX(a) + GP.getX(b) + GP.getX(c)) / 3, cz = (GP.getZ(a) + GP.getZ(b) + GP.getZ(c)) / 3;
          if (Math.hypot(cx - P[i * 3], cz - P[i * 3 + 2]) > 1.6 * R[i] + 0.1) continue;
          for (let k = Math.floor(y0 / 0.1); k <= Math.floor(y1 / 0.1); k++) { let l = tris.get(k); if (!l) tris.set(k, l = []); l.push(a, b, c); }
        }
      }
      const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), pv = new THREE.Vector3(), tv = new THREE.Vector3(), qv = new THREE.Vector3();
      // the nearest facet out along (dx, dy, dz) from (ox, oy, oz) within lim: [t, nx, ny, nz] or null
      const cast = (ox, oy, oz, dx, dy, dz, lim) => {
        const l = tris.get(Math.floor(oy / 0.1)); if (!l) return null;
        let best = lim, bn = null;
        for (let k = 0; k < l.length; k += 3) {
          va.fromBufferAttribute(GP, l[k]); vb.fromBufferAttribute(GP, l[k + 1]); vc.fromBufferAttribute(GP, l[k + 2]);
          e1.subVectors(vb, va); e2.subVectors(vc, va); pv.set(dy * e2.z - dz * e2.y, dz * e2.x - dx * e2.z, dx * e2.y - dy * e2.x);
          const det = e1.dot(pv); if (Math.abs(det) < 1e-12) continue;
          tv.set(ox - va.x, oy - va.y, oz - va.z); const u = tv.dot(pv) / det; if (u < 0 || u > 1) continue;
          qv.crossVectors(tv, e1); const v = (dx * qv.x + dy * qv.y + dz * qv.z) / det; if (v < 0 || u + v > 1) continue;
          const t = e2.dot(qv) / det; if (t > 0 && t < best) { best = t; bn = e1.clone().cross(e2).normalize(); }
        }
        if (!bn) return null;
        if (bn.x * dx + bn.y * dy + bn.z * dz < 0) bn.negate();
        return [best, bn.x, bn.y, bn.z];
      };
      const r = mulberry32(hashStr(key) ^ 0x6a7a);
      for (let i = 0; i < n - 1; i++) {
        const ay = P[i * 3 + 1], by = P[i * 3 + 4]; if (by < 0.6 || ay > top) continue;
        const tx = P[i * 3 + 3] - P[i * 3], ty = by - ay, tz = P[i * 3 + 5] - P[i * 3 + 2], L = Math.hypot(tx, ty, tz); if (L < 1e-4) continue;
        // a frame round the segment: N from x crossed with the tangent, B = T x N
        const T = [tx / L, ty / L, tz / L]; let N = [0, T[2], -T[1]], nl = Math.hypot(...N); if (nl < 1e-3) { N = [-T[2], 0, T[0]]; nl = Math.hypot(...N); } N = N.map(v => v / nl);
        const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
        const rad = (R[i] + R[i + 1]) / 2, area = 2 * Math.PI * rad * L, k = Math.round(area * 260 + r());
        for (let q = 0; q < k; q++) {
          const t = r(), a = r() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), rr = R[i] + (R[i + 1] - R[i]) * t;
          const dx = N[0] * ca + B[0] * sa, dy = N[1] * ca + B[1] * sa, dz = N[2] * ca + B[2] * sa;
          const y = ay + ty * t, u = r(); if (y < 0.6 || y > top) continue;
          const ox = P[i * 3] + tx * t, oz = P[i * 3 + 2] + tz * t, hit = tris.size ? cast(ox, y, oz, dx, dy, dz, 2.5 * rr) : null;
          if (tris.size && !hit) continue;
          if (hit) S.holes.push(ox + dx * hit[0], y + dy * hit[0], oz + dz * hit[0], hit[1], hit[2], hit[3], u);
          else S.holes.push(ox + dx * rr, y + dy * rr, oz + dz * rr, dx, dy, dz, u);
        }
      }
      // gall seats: points on the thinnest stems, toward their tips, with a side to hang from
      const thin = w.stems.filter(s => s.level >= 2 && s.rad.length > 2), gr = mulberry32(hashStr(key) ^ 0x9a11);
      for (let q = 0; q < Math.min(60, thin.length * 2); q++) {
        const s = thin[Math.floor(gr() * thin.length)], m = s.rad.length, i = Math.min(m - 2, Math.floor((0.4 + 0.55 * gr()) * (m - 1)));
        S.gall.push(s.pts[i * 3], s.pts[i * 3 + 1], s.pts[i * 3 + 2], s.rad[i], gr(), gr());
      }
    }
    S.holes = Float32Array.from(S.holes); S.gall = Float32Array.from(S.gall);
    this.sites.set(key, S);
    if (this.sites.size > 64) this.sites.delete(this.sites.keys().next().value);
    return S;
  }
  update(eye) {
    if (!this.on || !this.veg) return;
    const mo = (seasonState.date || new Date()).getMonth(), G = this.acorns?.world?.granaries || {};
    const gameN = Object.values(G).join(',');
    if (this.at && Math.hypot(eye.x - this.at.x, eye.z - this.at.z) < MOVE && this.nearV === this.veg.nearVersion && this.month === mo && this.gameN === gameN) return;
    const t0 = performance.now();
    this.at = { x: eye.x, z: eye.z }; this.nearV = this.veg.nearVersion; this.month = mo; this.gameN = gameN;
    // the stash oaks near the eye, by their place
    const stash = new Map();
    for (const o of this.veg.oaks || []) {
      const d = Math.hypot(o.x - eye.x, o.z - eye.z); if (d > GRAN_R + 15) continue;
      if (isStashTree(o)) stash.set(`${o.x.toFixed(2)}:${o.z.toFixed(2)}`, o);
    }
    const H = [], A = [], Gl = [], m = this.m4, mx = new THREE.Vector3(), my = new THREE.Vector3(), mz = new THREE.Vector3();
    const put = (arr, x, y, z, nx, ny, nz, s, c) => {   // z axis along (nx, ny, nz), y as upright as it can be
      mz.set(nx, ny, nz).normalize(); mx.set(0, 1, 0).cross(mz); if (mx.lengthSq() < 1e-6) mx.set(1, 0, 0); mx.normalize(); my.copy(mz).cross(mx);
      m.makeBasis(mx.multiplyScalar(s), my.multiplyScalar(s), mz.multiplyScalar(s)); m.setPosition(x, y, z);
      arr.push([m.elements.slice(), c]);
    };
    let gran = 0;
    for (const [species, arr] of Object.entries(this.veg.meshes || {})) {
      const gs = GALL_SP[species];
      for (const e of arr) {
        const a = e.near.trunk.instanceMatrix.array;
        for (let i = 0; i < e.near.n; i++) {
          const o = i * 16, x = a[o + 12], z = a[o + 14], d = Math.hypot(x - eye.x, z - eye.z);
          if (d > Math.max(GRAN_R, GALL_R) + 15) continue;
          const oak = d < GRAN_R + 15 ? stash.get(`${x.toFixed(2)}:${z.toFixed(2)}`) : null;
          if (!oak && !gs) continue;
          const S = this.sitesOf(species, e.seed, e.near.trunk.geometry);
          const tr = (px, py, pz, out) => out.set(a[o] * px + a[o + 4] * py + a[o + 8] * pz + a[o + 12], a[o + 1] * px + a[o + 5] * py + a[o + 9] * pz + a[o + 13], a[o + 2] * px + a[o + 6] * py + a[o + 10] * pz + a[o + 14]);
          const dir = (px, py, pz, out) => out.set(a[o] * px + a[o + 4] * py + a[o + 8] * pz, a[o + 1] * px + a[o + 5] * py + a[o + 9] * pz, a[o + 2] * px + a[o + 6] * py + a[o + 10] * pz).normalize();
          const p = new THREE.Vector3(), nv = new THREE.Vector3();
          if (oak && d < GRAN_R) {
            gran++;
            const old = oak.old || oak.snag, keep = old ? 1 : 0.35, h = S.holes, r = mulberry32(hashStr(oak.id) ^ 0x6011);
            const nHoles = h.length / 7, want = Math.ceil((G[oak.id] || 0)), fillK = FILL[mo];
            let filled = 0;
            for (let q = 0; q < nHoles; q++) {
              if (h[q * 7 + 6] >= keep) continue;
              tr(h[q * 7], h[q * 7 + 1], h[q * 7 + 2], p); dir(h[q * 7 + 3], h[q * 7 + 4], h[q * 7 + 5], nv);
              const s = 0.016 + 0.006 * r(), full = r() < fillK || filled < want;
              const hk = 0.8 + 0.35 * r(); put(H, p.x, p.y, p.z, nv.x, nv.y, nv.z, s, linRGB(0.55 * hk, 0.5 * hk, 0.44 * hk));
              if (full) { filled++; const k = 0.8 + 0.3 * r(); put(A, p.x - nv.x * 0.002, p.y - nv.y * 0.002, p.z - nv.z * 0.002, nv.x, nv.y, nv.z, s * 0.95, linRGB(0.5 * k, 0.37 * k, 0.22 * k)); }
            }
          }
          if (gs && d < GALL_R) {
            const id = `${species}:${x.toFixed(1)}:${z.toFixed(1)}`, r = mulberry32(hashStr(id) ^ 0x6a11), heavy = r() < 0.33;
            const n = Math.min(S.gall.length / 6, Math.round((heavy ? gs.heavy : gs.light) * r()));
            const base = GALL_COL(mo);
            for (let q = 0; q < n; q++) {
              const g = q * 6, s = gs.size[0] + (gs.size[1] - gs.size[0]) * S.gall[g + 4] ** 1.5;
              tr(S.gall[g], S.gall[g + 1], S.gall[g + 2], p);
              const yearOld = S.gall[g + 5] < 0.25, c = yearOld ? [0.2, 0.17, 0.15] : base, k = 0.85 + 0.3 * r();
              // hanging under its twig: the ball's centre half a gall below the seat, its neck up
              p.y -= s * 0.45;
              put(Gl, p.x, p.y, p.z, 0, -1, 0.001, s, linRGB(c[0] * k, c[1] * k, c[2] * k));
            }
          }
        }
      }
    }
    for (const [mesh, list, key] of [[this.holes, H, 'holes'], [this.butts, A, 'acorns'], [this.galls, Gl, 'galls']]) {
      this.ensure(mesh, list.length);
      const M = mesh.instanceMatrix.array, C = mesh.instanceColor.array;
      list.forEach(([e, c], q) => { M.set(e, q * 16); C[q * 3] = c.r; C[q * 3 + 1] = c.g; C[q * 3 + 2] = c.b; });
      mesh.count = list.length; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      this.stats[key] = list.length;
    }
    this.stats.granaries = gran; this.stats.ms = +(performance.now() - t0).toFixed(2);
  }
  dispose() {
    this.scene.remove(this.group);
    for (const m of [this.holes, this.butts, this.galls]) { m.geometry.dispose(); m.material.dispose(); m.dispose?.(); }
    this.sites.clear(); this.group.userData.life = null; this.veg = null;
  }
}
