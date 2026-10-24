import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural low-poly trees, one parameter set per species. An agent building a new
// region writes a parameter set like these rather than modelling a tree by hand.
// Each species yields { trunk, canopy } geometries so canopies can change with season.

export const SPECIES = {
  blue_oak:      { height: [7, 11],  trunkR: 0.38, trunkH: 0.35, lean: 0.08, branches: 4, blobs: 6, blobR: [2.2, 3.4], spread: 1.25, flat: 0.75, bark: [0x5a, 0x58, 0x52], leaf: [0x6a, 0x7f, 0x3c], deciduous: true },
  live_oak:      { height: [8, 13],  trunkR: 0.45, trunkH: 0.30, lean: 0.06, branches: 5, blobs: 7, blobR: [2.4, 3.6], spread: 1.1,  flat: 0.8,  bark: [0x4a, 0x47, 0x42], leaf: [0x3e, 0x55, 0x30], deciduous: false },
  gray_pine:     { height: [14, 22], trunkR: 0.35, trunkH: 0.45, lean: 0.14, branches: 5, blobs: 6, blobR: [1.6, 2.6], spread: 0.9,  flat: 0.9,  bark: [0x6b, 0x66, 0x5e], leaf: [0x7e, 0x8a, 0x66], deciduous: false },
  ponderosa:     { height: [24, 36], trunkR: 0.55, trunkH: 0.55, lean: 0.02, branches: 0, blobs: 7, blobR: [1.8, 3.2], spread: 0.55, flat: 1.0,  bark: [0x9a, 0x5e, 0x3c], leaf: [0x2f, 0x58, 0x34], deciduous: false, conical: true },
  manzanita:     { height: [2, 3.2], trunkR: 0.10, trunkH: 0.35, lean: 0.25, branches: 3, blobs: 4, blobR: [0.7, 1.1], spread: 1.0,  flat: 0.8,  bark: [0x7a, 0x2e, 0x22], leaf: [0x3a, 0x5a, 0x3a], deciduous: false, shrub: true },
  chamise:       { height: [1.2, 2], trunkR: 0.06, trunkH: 0.30, lean: 0.2,  branches: 2, blobs: 3, blobR: [0.5, 0.9], spread: 1.0,  flat: 0.9,  bark: [0x5e, 0x52, 0x44], leaf: [0x6e, 0x78, 0x55], deciduous: false, shrub: true },
};

export function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function colored(geom, rgb, jitter, rnd) {
  const n = geom.attributes.position.count, col = new Float32Array(n * 3);
  const lin = rgb.map(v => Math.pow(v / 255, 2.2));   // colours are authored as sRGB hex; lighting is linear
  for (let i = 0; i < n; i++) { const j = 1 + (rnd() - 0.5) * jitter; col[i * 3] = lin[0] * j; col[i * 3 + 1] = lin[1] * j; col[i * 3 + 2] = lin[2] * j; }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geom;
}

function limb(r0, r1, len, segs = 5) {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, true); g.translate(0, len / 2, 0); return g;
}

export function buildTree(name, seed = 1) {
  const p = SPECIES[name], rnd = mulberry32(seed);
  const H = p.height[0] + rnd() * (p.height[1] - p.height[0]);
  const trunkParts = [], canopyParts = [];
  const lean = (rnd() - 0.5) * 2 * p.lean, leanDir = rnd() * Math.PI * 2;
  const trunkLen = H * p.trunkH;
  const trunk = limb(p.trunkR * H / 10 * (p.shrub ? 10 : 1), p.trunkR * 0.5 * H / 10 * (p.shrub ? 10 : 1), trunkLen, 6);
  trunk.rotateZ(lean); trunk.rotateY(leanDir);
  trunkParts.push(trunk);
  const top = new THREE.Vector3(Math.sin(lean) * trunkLen * Math.cos(leanDir), Math.cos(lean) * trunkLen, Math.sin(lean) * trunkLen * Math.sin(leanDir));
  // branches fan out from the trunk top
  for (let b = 0; b < p.branches; b++) {
    const a = (b / p.branches) * Math.PI * 2 + rnd() * 0.8, tilt = 0.6 + rnd() * 0.6, len = H * (0.25 + rnd() * 0.25);
    const g = limb(p.trunkR * 0.5 * H / 10, p.trunkR * 0.15 * H / 10, len, 4);
    g.rotateZ(tilt); g.rotateY(a); g.translate(top.x, top.y, top.z); trunkParts.push(g);
  }
  if (p.shrub) { // multi-stem shrubs
    for (let s = 0; s < 2 + Math.floor(rnd() * 2); s++) { const g = limb(p.trunkR * 0.8, p.trunkR * 0.3, trunkLen * (0.8 + rnd() * 0.4), 4); g.rotateZ(0.3 + rnd() * 0.4); g.rotateY(rnd() * Math.PI * 2); trunkParts.push(g); }
  }
  // canopy blobs
  const crownBase = top.y, crownH = H - crownBase;
  for (let i = 0; i < p.blobs; i++) {
    const t = p.blobs > 1 ? i / (p.blobs - 1) : 0.5;
    let r = p.blobR[0] + rnd() * (p.blobR[1] - p.blobR[0]);
    let y, rx;
    if (p.conical) { y = crownBase + t * crownH; r *= 1.15 - t * 0.9; rx = r * 0.25 * (1 - t); }
    else { y = crownBase + crownH * (0.25 + 0.6 * rnd()); rx = crownH * p.spread * 0.45 * Math.sqrt(rnd()); }
    const a = rnd() * Math.PI * 2;
    const g = new THREE.IcosahedronGeometry(r, 1); g.scale(1, p.flat, 1);
    g.translate(top.x + Math.cos(a) * rx, y, top.z + Math.sin(a) * rx);
    canopyParts.push(g);
  }
  const trunkG = colored(mergeGeometries(trunkParts.map(g => g.index ? g.toNonIndexed() : g), false), p.bark, 0.25, rnd);
  const canopyG = colored(mergeGeometries(canopyParts.map(g => g.index ? g.toNonIndexed() : g), false), p.leaf, 0.35, rnd);
  trunkG.computeVertexNormals(); canopyG.computeVertexNormals();
  // trunk shape (geometry space, before instance scale/rotation): limb along +y, then rotateZ(lean), rotateY(leanDir)
  const stem = { len: trunkLen, r0: p.trunkR * H / 10 * (p.shrub ? 10 : 1), r1: p.trunkR * 0.5 * H / 10 * (p.shrub ? 10 : 1), lean, leanDir };
  return { trunk: trunkG, canopy: canopyG, height: H, stem };
}
