import * as THREE from 'three';
import { mulberry32 } from './trees.js';

// Procedural grass geometry: one merged clump per grass type for the near LOD (curved,
// tapered blades as thin triangle strips, culms with seed heads and awns), and the
// leaning "fountain" tuft cards for the mid LOD. Sizes are metres at full spring height;
// the shader scales them by season and per instance.
//
// Vertex attributes (clumps):
//   position  rest position in clump space (root at y = 0)
//   normal    blade face normal (either side; the shader faces it to the camera)
//   aBlade    x: t, 0 at the root to 1 at the tip (along the blade), y: per-blade random,
//             z: part (0 leaf, 1 culm, 2 seed head / spikelet, 3 awn), w: unused

export const PART = { LEAF: 0, CULM: 1, HEAD: 2, AWN: 3 };
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

class ClumpBuilder {
  constructor() { this.p = []; this.n = []; this.b = []; this.idx = []; }
  vert(pos, nrm, t, r, part) {
    this.p.push(pos.x, pos.y, pos.z); this.n.push(nrm.x, nrm.y, nrm.z); this.b.push(t, r, part, 0);
    return this.p.length / 3 - 1;
  }
  // A tapered strip along a centreline; `pointed` ends it in a single tip vertex.
  strip(pts, ts, widths, wdirs, r, part, pointed) {
    const L = [], R = [], last = pts.length - 1;
    for (let k = 0; k <= last; k++) {
      const tan = (k < last ? pts[k + 1].clone().sub(pts[k]) : pts[k].clone().sub(pts[k - 1])).normalize();
      const nrm = v3().crossVectors(wdirs[k], tan).normalize();
      if (pointed && k === last) { const i = this.vert(pts[k], nrm, ts[k], r, part); L.push(i); R.push(i); continue; }
      const h = wdirs[k].clone().multiplyScalar(widths[k] / 2);
      L.push(this.vert(pts[k].clone().sub(h), nrm, ts[k], r, part));
      R.push(this.vert(pts[k].clone().add(h), nrm, ts[k], r, part));
    }
    for (let k = 0; k < last; k++) {
      if (pointed && k === last - 1) { this.idx.push(L[k], R[k], L[k + 1]); continue; }
      this.idx.push(L[k], R[k], R[k + 1], L[k], R[k + 1], L[k + 1]);
    }
  }
  // A spikelet or floret: a small diamond from `base` along `dir`.
  diamond(base, dir, len, width, r, part) {
    const side = sideOf(dir), nrm = v3().crossVectors(side, dir).normalize();
    const tip = base.clone().addScaledVector(dir, len), mid = base.clone().addScaledVector(dir, len * 0.42);
    const a = this.vert(base, nrm, 1, r, part), c = this.vert(tip, nrm, 1, r, part);
    const b = this.vert(mid.clone().addScaledVector(side, width / 2), nrm, 1, r, part);
    const d = this.vert(mid.clone().addScaledVector(side, -width / 2), nrm, 1, r, part);
    this.idx.push(a, b, c, a, c, d);
    return tip;
  }
  // An awn: a fine bristle from `base`, bending from `dir` toward `dir2` (geniculate when they differ).
  awn(base, dir, dir2, len, width, r) {
    const p1 = base.clone().addScaledVector(dir, len * 0.4), p2 = p1.clone().addScaledVector(dir2, len * 0.6);
    const pts = [base, p1, p2], w = sideOf(dir);
    this.strip(pts, [1, 1, 1], [width, width * 0.7, 0], [w, w, w], r, PART.AWN, true);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aBlade', new THREE.Float32BufferAttribute(this.b, 4));
    g.setIndex(this.idx);
    return g;
  }
}

function sideOf(dir) {
  const s = v3().crossVectors(dir, UP);
  return s.lengthSq() < 1e-6 ? v3(1, 0, 0) : s.normalize();
}

// Centreline of a blade leaning toward azimuth phi: the angle from vertical starts at theta0
// and grows by `droop` toward the tip, so leaves arch over and culms stay nearly straight.
function arc(root, phi, theta0, droop, len, segs, pow = 1.6) {
  const D = v3(Math.cos(phi), 0, Math.sin(phi)), pts = [root.clone()], ts = [0];
  let p = root.clone();
  for (let k = 1; k <= segs; k++) {
    const th = theta0 + droop * Math.pow((k - 0.5) / segs, pow), step = len / segs;
    p = p.clone().addScaledVector(D, Math.sin(th) * step); p.y += Math.cos(th) * step;
    pts.push(p); ts.push(k / segs);
  }
  return { pts, ts, D };
}

// Width directions along a centreline: horizontal and across the lean, rolled about the
// blade by a random amount plus a slow twist toward the tip.
function widthDirs(pts, phi, roll, twist) {
  const W = v3(-Math.sin(phi), 0, Math.cos(phi)), out = [];
  for (let k = 0; k < pts.length; k++) {
    const tan = (k < pts.length - 1 ? pts[k + 1].clone().sub(pts[k]) : pts[k].clone().sub(pts[k - 1])).normalize();
    const a = roll + twist * k / (pts.length - 1);
    const w = W.clone().multiplyScalar(Math.cos(a)).add(v3().crossVectors(tan, W).multiplyScalar(Math.sin(a)));
    out.push(w.sub(tan.clone().multiplyScalar(w.dot(tan))).normalize());
  }
  return out;
}

function leaf(B, rnd, { spread, theta, droop, len, width, segs = 4 }) {
  const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * spread, r = rnd();
  const root = v3(Math.cos(a) * rr, 0, Math.sin(a) * rr), phi = a + (rnd() - 0.5) * 1.4;
  const { pts, ts } = arc(root, phi, theta[0] + rnd() * (theta[1] - theta[0]), droop[0] + rnd() * (droop[1] - droop[0]), len[0] + rnd() * (len[1] - len[0]), segs);
  const w0 = width[0] + rnd() * (width[1] - width[0]);
  const widths = ts.map(t => w0 * (1 - 0.85 * Math.pow(t, 1.8)));
  B.strip(pts, ts, widths, widthDirs(pts, phi, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.6), r, PART.LEAF, true);
}

// A flowering stem: thin, nearly straight; returns its top point, tangent and lean direction.
function culm(B, rnd, { spread, theta, droop, len, width, segs = 3 }) {
  const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * spread, r = rnd();
  const root = v3(Math.cos(a) * rr, 0, Math.sin(a) * rr), phi = a + (rnd() - 0.5) * 0.8;
  const { pts, ts, D } = arc(root, phi, theta[0] + rnd() * (theta[1] - theta[0]), droop[0] + rnd() * (droop[1] - droop[0]), len[0] + rnd() * (len[1] - len[0]), segs, 2.0);
  B.strip(pts, ts, ts.map(t => width * (1 - 0.35 * t)), widthDirs(pts, phi, rnd() * 3, 0), r, PART.CULM, false);
  const top = pts[pts.length - 1], tan = top.clone().sub(pts[pts.length - 2]).normalize();
  return { top, tan, D, r, phi };
}

// Annual grasses: wild oat (open, nodding panicle of dangling spikelets), ripgut / soft brome
// (a few large drooping spikelets with long awns) and medusahead (a dense spike bristling with awns).
export function buildAnnualClump(seed = 7) {
  const rnd = mulberry32(seed), B = new ClumpBuilder();
  // Annuals are scattered stems, not tufts: blades rise from anywhere in a ~0.3 m patch.
  for (let i = 0; i < 7; i++) leaf(B, rnd, { spread: 0.3, theta: [0.08, 0.45], droop: [0.3, 1.1], len: [0.26, 0.52], width: [0.011, 0.017] });
  for (let i = 0; i < 4; i++) {
    const c = culm(B, rnd, { spread: 0.28, theta: [0.03, 0.2], droop: [0.05, 0.3], len: [0.62, 0.95], width: 0.0045 });
    const out = c.D, style = i % 3;
    if (style === 0) {   // wild oat: spikelets hanging on fine branches from the top 15 cm
      for (let s = 0; s < 5; s++) {
        const az = c.phi + s * 2.4 + rnd() * 0.6, o = v3(Math.cos(az), 0, Math.sin(az));
        const base = c.top.clone().addScaledVector(c.tan, -0.03 * s - 0.01).addScaledVector(o, 0.018 + 0.01 * rnd());
        const dir = o.clone().multiplyScalar(0.45).add(v3(0, -0.85, 0)).addScaledVector(out, 0.2).normalize();
        B.diamond(base, dir, 0.04 + 0.012 * rnd(), 0.012, c.r, PART.HEAD);
      }
    } else if (style === 1) {   // ripgut brome: three big spikelets drooping out, each with a long awn
      for (let s = 0; s < 3; s++) {
        const az = c.phi + (s - 1) * 1.1 + (rnd() - 0.5) * 0.4, o = v3(Math.cos(az), 0, Math.sin(az));
        const dir = c.tan.clone().multiplyScalar(0.5).addScaledVector(o, 0.7).add(v3(0, -0.25 - 0.3 * rnd(), 0)).normalize();
        const tip = B.diamond(c.top.clone().addScaledVector(c.tan, -0.012 * s), dir, 0.055 + 0.015 * rnd(), 0.01, c.r, PART.HEAD);
        B.awn(tip, dir, dir.clone().add(v3(0, -0.4, 0)).normalize(), 0.05, 0.0025, c.r);
      }
    } else {   // medusahead: a stiff spike with a fan of awns
      const tip = B.diamond(c.top, c.tan, 0.05, 0.011, c.r, PART.HEAD);
      for (let s = 0; s < 5; s++) {
        const az = c.phi + s * 1.26, o = v3(Math.cos(az), 0, Math.sin(az));
        const base = tip.clone().addScaledVector(c.tan, -0.03 + 0.006 * s);
        B.awn(base, c.tan.clone().addScaledVector(o, 0.7).normalize(), c.tan.clone().addScaledVector(o, 1.2).normalize(), 0.06, 0.0022, c.r);
      }
    }
  }
  return B.geometry();
}

// Purple needlegrass: a dense tuft of fine, arching leaves from a narrow crown, with a couple
// of flowering culms whose florets carry long, twice-bent awns.
export function buildBunchClump(seed = 19) {
  const rnd = mulberry32(seed), B = new ClumpBuilder();
  for (let i = 0; i < 9; i++) leaf(B, rnd, { spread: 0.035, theta: [0.12, 0.55], droop: [0.9, 1.8], len: [0.24, 0.44], width: [0.0055, 0.0085] });
  for (let i = 0; i < 2; i++) {
    const c = culm(B, rnd, { spread: 0.03, theta: [0.06, 0.28], droop: [0.1, 0.35], len: [0.45, 0.62], width: 0.0035 });
    for (let s = 0; s < 4; s++) {
      const az = c.phi + s * 1.7 + rnd() * 0.5, o = v3(Math.cos(az), 0, Math.sin(az));
      const base = c.top.clone().addScaledVector(c.tan, -0.035 * s);
      const dir = c.tan.clone().multiplyScalar(0.35).addScaledVector(o, 0.45).add(v3(0, -0.5, 0)).normalize();
      const tip = B.diamond(base, dir, 0.014, 0.0045, c.r, PART.HEAD);
      const bend = o.clone().multiplyScalar(0.9).add(v3(0, -0.25 + 0.3 * rnd(), 0)).normalize();
      B.awn(tip, dir, bend, 0.075 + 0.025 * rnd(), 0.0028, c.r);
    }
  }
  return B.geometry();
}

// Mid-LOD tuft: four cards leaning outward like a fountain, unit height; the fragment shader
// cuts blades (and seed heads) out of each card. Attributes: position, normal, uv, aPetal.
export function buildTuft() {
  const p = [], n = [], uv = [], petal = [], idx = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, T = v3(Math.cos(a), 0, Math.sin(a)), N = v3(-Math.sin(a), 0, Math.cos(a));
    const b0 = N.clone().multiplyScalar(0.04), t0 = N.clone().multiplyScalar(0.3).add(v3(0, 1, 0));
    const corners = [[b0, -0.3, 0, 0], [b0, 0.3, 1, 0], [t0, 0.42, 1, 1], [t0, -0.42, 0, 1]];
    const nrm = v3().crossVectors(T, t0.clone().sub(b0)).normalize();
    const base = p.length / 3;
    for (const [c, s, u, v] of corners) {
      const q = c.clone().addScaledVector(T, s);
      p.push(q.x, q.y, q.z); n.push(nrm.x, nrm.y, nrm.z); uv.push(u, v); petal.push(i);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPetal', new THREE.Float32BufferAttribute(petal, 1));
  g.setIndex(idx);
  return g;
}
