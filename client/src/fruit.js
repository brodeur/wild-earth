import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPECIES, mulberry32 } from './trees.js';
import { decoActive, seasonMonth } from './treegen.js';
import { FH } from './shrubfield.js';

// Fruit on the plants (Aaron, 2026-11-04: "For each edible fruit, render a small version of it. Whenever a plant has
// fruit, show that fruit glowing around the plant just like we do for acorns. Fruits/nuts should become visible only
// when I'm close to a plant.").
//
// Every fruit, nut and seed of a woody plant that the data says an animal eats (KINDS: the berries of the thirteen
// berry shrubs, the walnut, the bay nut, the big-leaf maple's samaras, the two ceanothus' capsules and the redbud's
// pods) has a small model: the rose hips from Meshy (fruitModel below), the rest built here, made life size and drawn larger (SHOW_K: a life-size toyon
// cluster is a red speck from three metres), merged into one geometry per kind (a toyon's corymb of
// berries, a grape's bunch, a walnut in its husk), drawn as one InstancedMesh per kind with one shared material, and
// one shared InstancedMesh of glow billboards (the acorns' halo, acorns.js glowMaterial: a wide warm halo with a small
// hot core, additive) tinted toward the fruit's own colour. The acorns stay the acorn game's (acorns.js); the seeds of
// the herbs and grasses are the forage glow's (forage.js, forbs.js), too small and too many to draw one by one.
//
// When a plant shows fruit: a kind is "in fruit" when its species file's foliage.berries shows this month
// (treegen.js decoActive: the same test that paints the berries into the crowns and the impostors' domes), or, for a
// kind with no berries block (whiteleaf manzanita, the seeds), in the seasons its eaten_by rows give. And, as the
// acorns (2026-11-03: "Each animal should only see fruits they can harvest/eat"), only for a body that eats that part
// of that plant this season: the tile's games.json relations.forage rows, or the library's eaten_by on a tile whose
// games have no forage rows (Placerville). The spirit sees none, nor a body underground.
//
// Near the player only: the plants within FRUIT_R of the body (vegetation.js nearPlants, the 3D shrubs and trees; the
// shrub field's cached cells, shrubfield.js, the impostor shrubs, the same two sources forage.js reads) get their
// fruit, placed from a hash of the plant's position so the same toyon always carries the same clusters. Berries hang
// on the crown's outline (the 3D shrub's ellipsoid from its height and crown_width_ratio, the impostor's own dome:
// root + H/2, R across, H/2 tall); a tree's nuts lie on the ground under the crown, as the acorns do (those still on
// the tree are painted into its leaf cards by treegen.js; a nut placed in an open, leaning crown floated in the sky). The shaders fade both the fruit (it shrinks away) and its glow with the distance from
// the body, full inside FRUIT_FULL m, gone at FRUIT_R, so nothing pops at the edge and nothing is drawn for the
// whole tile; the CPU rebuilds the set only when the body has moved REBUILD_MOVE m or the plants changed.
//
// Cost: no texture, no new sampler (the 16 units are full); the fruit material is a Phong with vertex colours and
// instance colours (position, normal, color, instanceMatrix x4, instanceColor, aPlant: 9 of the 16 attribute slots),
// the glow a ShaderMaterial with position, instanceMatrix x4, instanceColor, aSize and aPlant (8). One draw per kind in fruit near
// the body, one for every glow. main.js builds it, setBody(code) from onBody, update(dt) each frame.
// Debugging: __we.fruit; fruit.all = true shows every kind round every plant that bears it (no diet or season),
// fruit.enabled, fruit.k (the glow's level), fruit.counts().
export const FRUIT_R = 16, FRUIT_FULL = 10;   // m from the body: gone at FRUIT_R, full inside FRUIT_FULL
const REBUILD_T = 0.25, REBUILD_MOVE = 2, GATHER_PAD = 4;   // s between checks; m moved; m past FRUIT_R gathered
const CAP = 1600, GLOW_CAP = 6000, PER_PLANT = 40;   // instances per kind; glows in all; clusters on one plant at most
const SHRUB_STRIDE = 8;   // shrubfield.js STRIDE: x y z R | H seed kind rank
const CHAP = ['adenostoma_fasciculatum', 'arctostaphylos_viscida'];   // the chaparral kinds 0 and 1
const SHOW_K = { hang: 2.2, tree: 1.4 };   // drawn this many times life size: a life-size toyon cluster is a red speck at 3 m
const GLOW_K = 1, GLOW_AMBER = new THREE.Color(1.0, 0.63, 0.25);
const TAU = Math.PI * 2;

// ---- the models ---------------------------------------------------------------------------------------------------
// A tiny mesh builder: ellipsoid blobs (an icosahedron, analytic normals) and thin stalks, with a colour per vertex,
// merged into one non-indexed geometry. Units are metres; a hanging cluster hangs from its origin along -y, a fruit on
// the ground lies with its lowest point at the origin.
const ICO = [0, 1].map(d => new THREE.IcosahedronGeometry(1, d).attributes.position.array);
const sRGB = c => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; }
  blob(cx, cy, cz, rx, ry, rz, col, detail = 0, bump = 0, rnd = Math.random) {
    const P = ICO[detail], c = col.isColor ? col : sRGB(col);
    for (let i = 0; i < P.length; i += 3) {
      let x = P[i], y = P[i + 1], z = P[i + 2];
      if (bump) { const k = 1 + bump * Math.sin(x * 9.1 + y * 5.3) * Math.sin(z * 7.7 - y * 3.1); x *= k; y *= k; z *= k; }
      this.p.push(cx + x * rx, cy + y * ry, cz + z * rz);
      const nx = x / rx, ny = y / ry, nz = z / rz, l = Math.hypot(nx, ny, nz) || 1;
      this.n.push(nx / l, ny / l, nz / l);
      this.c.push(c.r, c.g, c.b);
    }
    return this;
  }
  // a three-sided stalk from a to b
  stalk(a, b, r, col) {
    const c = col.isColor ? col : sRGB(col), d = new THREE.Vector3().subVectors(b, a), L = d.length(); if (L < 1e-6) return this;
    d.divideScalar(L);
    const u = new THREE.Vector3(Math.abs(d.y) < 0.9 ? 0 : 1, Math.abs(d.y) < 0.9 ? 1 : 0, 0).cross(d).normalize(), v = new THREE.Vector3().crossVectors(d, u);
    const ring = k => { const t = k / 3 * TAU; return new THREE.Vector3().addScaledVector(u, Math.cos(t)).addScaledVector(v, Math.sin(t)); };
    for (let k = 0; k < 3; k++) {
      const n0 = ring(k), n1 = ring(k + 1), q0 = a.clone().addScaledVector(n0, r), q1 = a.clone().addScaledVector(n1, r);
      const q2 = b.clone().addScaledVector(n1, r * 0.6), q3 = b.clone().addScaledVector(n0, r * 0.6);
      for (const [q, n] of [[q0, n0], [q1, n1], [q2, n1], [q0, n0], [q2, n1], [q3, n0]]) { this.p.push(q.x, q.y, q.z); this.n.push(n.x, n.y, n.z); this.c.push(c.r, c.g, c.b); }
    }
    return this;
  }
  // a flat two-sided quad (a samara's wing): corners a b c d
  card(a, b, c2, d, col) {
    const c = col.isColor ? col : sRGB(col), n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    for (const [tri, s] of [[[a, b, c2, a, c2, d], 1], [[a, c2, b, a, d, c2], -1]])
      for (const q of tri) { this.p.push(q.x, q.y, q.z); this.n.push(n.x * s, n.y * s, n.z * s); this.c.push(c.r, c.g, c.b); }
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const STEM = [96, 84, 52], TWIG = [108, 82, 60];
const vary = (c, rnd, k = 0.12) => { const f = 1 + (rnd() - 0.5) * 2 * k; return [c[0] * f, c[1] * f, c[2] * f].map(v => Math.min(255, v)); };
const mixC = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// A cluster of round berries on pedicels from one stalk: n berries of radius r spread over a disc of radius w at depth
// `drop` (flat-topped corymbs and cymes), each a colour from `cols` (weights by repetition).
function corymb(B, rnd, { n, r, w, drop, cols, ry = 1, stalk = STEM, detail = 0, dome = 0.3 }) {
  B.stalk(V(0, 0, 0), V(0, -drop * 0.55, 0), Math.max(0.0008, r * 0.18), stalk);
  for (let k = 0; k < n; k++) {
    const a = k * 2.39996 + rnd() * 0.4, rr = w * Math.sqrt((k + 0.5) / n), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const y = -drop + (1 - (rr / w) ** 2) * dome * w * 0.5 + (rnd() - 0.5) * r * 0.6;
    B.stalk(V(0, -drop * 0.55, 0), V(x, y + r * 0.8, z), Math.max(0.0005, r * 0.12), stalk);
    B.blob(x, y, z, r, r * ry, r, vary(cols[Math.floor(rnd() * cols.length)], rnd), detail);
  }
}
// A drooping raceme: berries along a hanging stalk of length L, n of them, the lowest smaller.
function raceme(B, rnd, { n, r, L, cols, sway = 0.3 }) {
  let prev = V(0, 0, 0);
  for (let k = 0; k < n; k++) {
    const t = (k + 1) / n, p = V(Math.sin(t * 2.1) * L * sway, -L * t, Math.cos(t * 1.7) * L * sway * 0.5);
    B.stalk(prev, p, 0.0006, STEM); prev = p;
    const s = r * (1 - 0.25 * t), a = rnd() * TAU, off = s * 1.1;
    B.blob(p.x + Math.cos(a) * off, p.y - s * 0.4, p.z + Math.sin(a) * off, s, s, s, vary(cols[Math.floor(rnd() * cols.length)], rnd), 0);
  }
}

// The kinds. part: the eaten_by part that is this fruit; where: 'hang' on a shrub's crown, 'tree' on the ground under
// a tree; perM2: clusters per m2 of crown at the berries' density 1; ny: the band of the crown
// (the outline's normal's y) the clusters hang in; size: the cluster's half size (m, for the glow); build(B, rnd).
const KINDS = {
  heteromeles_arbutifolia: { name: 'toyon', part: 'berries', where: 'hang', perM2: 7, ny: [-0.1, 0.95], size: 0.05,
    build: (B, r) => corymb(B, r, { n: 16, r: 0.0042, w: 0.032, drop: 0.022, cols: [[214, 40, 32], [214, 40, 32], [226, 64, 30], [196, 30, 30]] }) },
  arctostaphylos_manzanita: { name: 'common manzanita', part: 'berries', where: 'hang', perM2: 6, ny: [-0.2, 0.9], size: 0.035,
    build: (B, r) => corymb(B, r, { n: 7, r: 0.0055, w: 0.016, drop: 0.024, ry: 0.82, dome: -0.6, cols: [[140, 72, 50], [156, 84, 52], [128, 60, 44]], stalk: [150, 70, 60] }) },
  arctostaphylos_viscida: { name: 'whiteleaf manzanita', part: 'berries', where: 'hang', perM2: 6, ny: [-0.2, 0.9], size: 0.035, rgb: [150, 86, 54],
    build: (B, r) => corymb(B, r, { n: 6, r: 0.005, w: 0.014, drop: 0.022, ry: 0.82, dome: -0.6, cols: [[150, 86, 54], [168, 102, 60], [136, 70, 48]], stalk: [160, 80, 70] }) },
  frangula_californica: { name: 'coffeeberry', part: 'berries', where: 'hang', perM2: 6, ny: [-0.3, 0.8], size: 0.03,
    build: (B, r) => corymb(B, r, { n: 5, r: 0.0062, w: 0.014, drop: 0.02, dome: -0.4, cols: [[36, 22, 26], [36, 22, 26], [116, 34, 32], [72, 26, 30], [122, 128, 64]] }) },
  cornus_sericea: { name: 'creek dogwood', part: 'berries', where: 'hang', perM2: 5, ny: [0.1, 0.95], size: 0.04,
    build: (B, r) => corymb(B, r, { n: 12, r: 0.0036, w: 0.026, drop: 0.016, cols: [[226, 230, 228], [214, 222, 232], [236, 236, 230]], stalk: [150, 70, 60] }) },
  ribes_malvaceum: { name: 'chaparral currant', part: 'berries', where: 'hang', perM2: 6, ny: [-0.4, 0.7], size: 0.035,
    build: (B, r) => raceme(B, r, { n: 7, r: 0.0042, L: 0.05, cols: [[92, 66, 92], [80, 58, 96], [104, 72, 96]] }) },
  ribes_roezlii: { name: 'Sierra gooseberry', part: 'berries', where: 'hang', perM2: 7, ny: [-0.6, 0.5], size: 0.025,
    build: (B, rnd) => {
      for (const sx of [-1, 1]) {
        const top = V(0, 0, 0), c = V(sx * 0.008, -0.022, rnd() * 0.004), R = 0.0068, col = vary([176, 42, 44], rnd);
        B.stalk(top, V(c.x, c.y + R, c.z), 0.0007, STEM).blob(c.x, c.y, c.z, R, R * 1.05, R, col, 1);
        for (let k = 0; k < 14; k++) {   // the spines
          const u = rnd() * 2 - 1, a = rnd() * TAU, s = Math.sqrt(1 - u * u), d = V(s * Math.cos(a), u, s * Math.sin(a));
          B.stalk(c.clone().addScaledVector(d, R * 0.9), c.clone().addScaledVector(d, R * 1.55), 0.00035, [200, 150, 120]);
        }
        B.blob(c.x, c.y - R * 1.02, c.z, R * 0.25, R * 0.2, R * 0.25, [70, 40, 30], 0);   // the dried flower at its tip
      }
    } },
  rosa_californica: { name: 'California wild rose', part: 'berries', where: 'hang', perM2: 5, ny: [-0.2, 0.9], size: 0.035, show: 1.6,
    build: (B, rnd) => {
      for (let k = 0; k < 3; k++) {
        const a = k * TAU / 3 + rnd() * 0.5, c = V(Math.cos(a) * 0.009, -0.02 - rnd() * 0.006, Math.sin(a) * 0.009), col = vary([196, 62, 38], rnd);
        B.stalk(V(0, 0, 0), V(c.x * 0.6, c.y + 0.008, c.z * 0.6), 0.0007, STEM).blob(c.x, c.y, c.z, 0.0055, 0.0082, 0.0055, col, 1);
        for (let s = 0; s < 4; s++) { const b = s * TAU / 4; B.stalk(V(c.x, c.y - 0.0075, c.z), V(c.x + Math.cos(b) * 0.004, c.y - 0.012, c.z + Math.sin(b) * 0.004), 0.0005, [60, 46, 30]); }   // the sepals left at its tip
      }
    } },
  rubus_ursinus: { name: 'California blackberry', part: 'berries', where: 'hang', perM2: 7, ny: [-0.3, 0.9], size: 0.03,
    build: (B, rnd) => {
      for (let k = 0; k < 3; k++) {
        const a = k * TAU / 3 + rnd(), c = V(Math.cos(a) * 0.012, -0.016 - rnd() * 0.008, Math.sin(a) * 0.012);
        const col = k === 2 ? [150, 30, 40] : [44, 32, 44];   // two ripe, one reddening
        B.stalk(V(0, 0, 0), V(c.x, c.y + 0.007, c.z), 0.0007, STEM);
        for (let q = 0; q < 16; q++) {   // the drupelets on an oval core
          const u = 1 - 2 * (q + 0.5) / 16, t = q * 2.39996, s = Math.sqrt(1 - u * u);
          B.blob(c.x + s * Math.cos(t) * 0.0042, c.y + u * 0.0058, c.z + s * Math.sin(t) * 0.0042, 0.0022, 0.0022, 0.0022, vary(col, rnd, 0.15), 0);
        }
      }
    } },
  sambucus_nigra_caerulea: { name: 'blue elderberry', part: 'berries', where: 'hang', perM2: 1.8, ny: [0.0, 0.95], size: 0.09,
    build: (B, rnd) => {   // a flat-topped compound umbel: rays from one point, a tight head of dusty blue berries on each
      const cols = [[142, 154, 178], [128, 140, 170], [156, 166, 186], [110, 112, 150]];
      for (let k = 0; k < 7; k++) {
        const a = k * TAU / 7 + rnd() * 0.3, rr = k === 6 ? 0 : 0.034, hub = V(Math.cos(a) * rr, -0.012, Math.sin(a) * rr);
        B.stalk(V(0, 0, 0), hub, 0.0009, [120, 128, 80]);
        for (let q = 0; q < 9; q++) {
          const b = q * 2.39996, w = 0.011 * Math.sqrt((q + 0.5) / 9), x = hub.x + Math.cos(b) * w, z = hub.z + Math.sin(b) * w, y = hub.y - 0.004 - (rnd() - 0.5) * 0.003;
          B.blob(x, y, z, 0.0029, 0.0029, 0.0029, vary(cols[Math.floor(rnd() * cols.length)], rnd), 0);
        }
      }
    } },
  symphoricarpos_albus: { name: 'common snowberry', part: 'berries', where: 'hang', perM2: 7, ny: [-0.3, 0.8], size: 0.025,
    build: (B, r) => corymb(B, r, { n: 4, r: 0.0062, w: 0.008, drop: 0.016, dome: -0.2, cols: [[238, 236, 230], [244, 242, 238], [226, 228, 226]], detail: 1 }) },
  toxicodendron_diversilobum: { name: 'poison oak', part: 'berries', where: 'hang', perM2: 3, ny: [-0.4, 0.7], size: 0.035,
    build: (B, r) => raceme(B, r, { n: 9, r: 0.0029, L: 0.045, sway: 0.4, cols: [[214, 202, 164], [222, 210, 170], [200, 190, 150]] }) },
  vitis_californica: { name: 'California wild grape', part: 'berries', where: 'hang', perM2: 2.5, ny: [-0.7, 0.2], size: 0.06, show: 1.6,
    build: (B, rnd) => {
      B.stalk(V(0, 0, 0), V(0.004, -0.02, 0), 0.0012, [110, 96, 60]);
      const n = 24;
      for (let k = 0; k < n; k++) {   // a bunch: a cone of berries, widest at the top
        const t = k / (n - 1), y = -0.022 - t * 0.075, w = 0.022 * (1 - t) + 0.005, a = k * 2.39996;
        B.blob(Math.cos(a) * w * 0.8, y, Math.sin(a) * w * 0.8, 0.0058, 0.006, 0.0058, vary([92, 70, 104], rnd, 0.14), 0);
      }
    } },
  juglans_hindsii: { name: 'black walnut', part: 'seeds', where: 'tree', perM2: 0.5, size: 0.04, ground: 0.016,
    build: (B, rnd) => B.blob(0, 0.016, 0, 0.016, 0.0155, 0.016, [150, 166, 92], 1, 0.03).stalk(V(0, 0.031, 0), V(0.002, 0.036, 0), 0.0012, [100, 90, 60]) },
  umbellularia_californica: { name: 'bay nut', part: 'seeds', where: 'tree', perM2: 0.6, size: 0.03, ground: 0.009,
    build: (B, rnd) => B.blob(0, 0.009, 0, 0.009, 0.009, 0.012, [96, 104, 60], 1).blob(0, 0.009, -0.0125, 0.0022, 0.0022, 0.002, [80, 70, 40], 0) },
  acer_macrophyllum: { name: 'big-leaf maple', part: 'seeds', where: 'tree', perM2: 0.8, size: 0.035, ground: 0.002,
    build: (B, rnd) => {   // a pair of samaras, lying flat: two hairy seeds joined, their wings spread at about 60 degrees
      const col = [176, 146, 96];
      for (const s of [-1, 1]) {
        const a = s * 0.55, dx = Math.sin(a), dz = Math.cos(a), seed = V(dx * 0.006, 0.004, dz * 0.006);
        B.blob(seed.x, seed.y, seed.z, 0.0055, 0.0042, 0.0062, [150, 124, 80], 0);
        const tip = V(dx * 0.045, 0.002, dz * 0.045), side = V(dz, 0, -dx).multiplyScalar(0.009 * s);
        B.card(seed.clone().add(side.clone().multiplyScalar(0.3)), tip.clone().add(side), tip.clone().sub(side.clone().multiplyScalar(0.2)), seed.clone().sub(side.clone().multiplyScalar(0.3)), col);
      }
    } },
  ceanothus_cuneatus: { name: 'buckbrush', part: 'seeds', where: 'hang', perM2: 6, ny: [-0.1, 0.95], size: 0.025,
    build: (B, rnd) => capsules(B, rnd, [96, 56, 44]) },
  ceanothus_integerrimus: { name: 'deerbrush', part: 'seeds', where: 'hang', perM2: 5, ny: [0.0, 0.95], size: 0.025,
    build: (B, rnd) => capsules(B, rnd, [86, 66, 46]) },
  cercis_occidentalis: { name: 'western redbud', part: 'seeds', where: 'hang', perM2: 3, ny: [-0.5, 0.6], size: 0.05,
    build: (B, rnd) => {
      for (let k = 0; k < 3; k++) {   // flat pods hanging from one spur, magenta-brown
        const a = (k - 1) * 0.5 + rnd() * 0.2, c = V(Math.sin(a) * 0.012, -0.034, Math.cos(a) * 0.004), col = vary(mixC([140, 62, 70], [124, 86, 62], rnd()), rnd);
        B.stalk(V(0, 0, 0), V(c.x * 0.4, -0.006, c.z * 0.4), 0.0007, TWIG).blob(c.x, c.y, c.z, 0.0065, 0.03, 0.0016, col, 1);
      }
    } },
};
function capsules(B, rnd, col) {   // a cluster of small three-lobed capsules (ceanothus)
  B.stalk(V(0, 0, 0), V(0, -0.01, 0), 0.0008, TWIG);
  for (let k = 0; k < 7; k++) {
    const a = k * 2.39996, rr = 0.011 * Math.sqrt((k + 0.5) / 7), cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, cy = -0.014 + (rnd() - 0.5) * 0.004;
    B.stalk(V(0, -0.01, 0), V(cx, cy + 0.002, cz), 0.0004, TWIG);
    const c = vary(col, rnd, 0.15);
    for (let l = 0; l < 3; l++) { const b = l * TAU / 3 + a; B.blob(cx + Math.cos(b) * 0.0014, cy, cz + Math.sin(b) * 0.0014, 0.0016, 0.0019, 0.0016, c, 0); }
  }
}
export const FRUIT_KINDS = KINDS;

// The Meshy models (Aaron, 2026-11-04: Meshy where a real shape and texture read at a few centimetres; the tiny
// clustered berries stay procedural): the rose hips and the acorn (acorns.js), each a Meshy
// text-to-3D model decimated to a few hundred triangles with its texture baked into vertex colours by
// tools/build_fruit.py (no sampler at draw time). The grape bunch stays procedural: at a few hundred triangles the
// Meshy bunch's 25 berries collapsed to a lump. Loaded once per page; each caller gets its own clone, and the
// procedural model above stands in until it arrives, or for good if it fails.
const MODEL_URL = { quercus_lobata: '../assets/fruit/quercus_lobata.glb', rosa_californica: '../assets/fruit/rosa_californica.glb' };
const modelCache = new Map();
export function fruitModel(id) {
  if (!MODEL_URL[id]) return Promise.resolve(null);
  let p = modelCache.get(id);
  if (!p) modelCache.set(id, p = new GLTFLoader().loadAsync(new URL(MODEL_URL[id], import.meta.url).href).then(gltf => {
    let geo = null; gltf.scene.traverse(o => { if (o.isMesh && !geo) geo = o.geometry; });
    return geo;
  }).catch(err => { console.warn(`fruit: the ${id} model did not load; the procedural one stays`, err); return null; }));
  return p.then(g => g && g.clone());
}
const KIND_IDS = Object.keys(KINDS);

// Each kind's geometry: three hashed variants merged side by side would be heavier; one model per kind, each instance
// turned and tinted (instanceColor) instead.
export function fruitGeometry(id) {   // (exported for a lineup of the models)
  const B = new Builder(); KINDS[id].build(B, mulberry32(0xf00d + id.length * 7919));
  return B.geometry();
}
// The fruit's representative colour (the glow's tint): its species' berries colour, else the kind's own.
function kindColor(id) {
  const K = KINDS[id], rgb = K.rgb || SPECIES[id]?.foliage?.berries?.rgb || [170, 130, 80];
  return sRGB(rgb);
}

// ---- the materials ------------------------------------------------------------------------------------------------
// An impostor shrub (shrubfield.js) writes the depth of a flat card pulled toward the camera from its crown's centre
// C by min(0.6 R, dc - 0.3), not its dome's: fruit on the dome's sides would be behind the card and hidden. So a
// fruit on an impostor (aPlant: C, R; R 0 for a 3D plant, left as it is) slides along its own view ray to just in
// front of the card, which keeps its place on the screen (its size scaled by the same ratio), and a fruit on the
// dome's far side is dropped (the dome hides it).
const SEAT = /* glsl */`
  // fruitSeat: the fruit at world point f on plant p (C, R): the distance to slide toward the eye (y) and keep (x: 0 hidden)
  vec2 fruitSeat(vec3 f, vec4 p) {
    if (p.w <= 0.0) return vec2(1.0, 0.0);
    vec3 V = cameraPosition - p.xyz; float dc = length(V); V /= max(dc, 1e-3);
    float pull = min(0.6 * p.w, max(dc - 0.3, 0.0)), off = dot(f - p.xyz, V);
    float keep = smoothstep(-0.3, -0.1, off / p.w);
    return vec2(keep, max(0.0, pull + 0.03 - off));
  }`;
// The fruit: Phong with vertex colours (a little gloss: berries shine), shrinking away with the distance from the
// body (fruitBody: x z, FRUIT_FULL, FRUIT_R) and lit a little from within by the same fade (the glow's core).
function fruitMaterial(U) {
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 48, specular: new THREE.Color(0.16, 0.16, 0.16) });
  m.onBeforeCompile = sh => {
    sh.uniforms.fruitBody = U.body; sh.uniforms.fruitSelf = U.self;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 fruitBody;\nattribute vec4 aPlant;\nvarying float vFruitK;' + SEAT)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 fc = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 seat = fruitSeat(fc.xyz, aPlant);
        float fk = (1.0 - smoothstep(fruitBody.z, fruitBody.w, distance(fc.xz, fruitBody.xy))) * seat.x;
        vFruitK = fk; transformed *= fk;`)
      .replace('#include <project_vertex>', `vec4 mvPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        { vec3 toEye = cameraPosition - fc.xyz; float de = length(toEye), sk = (de - seat.y) / max(de, 1e-3);
          mvPosition.xyz = fc.xyz + (mvPosition.xyz - fc.xyz) * sk + toEye / max(de, 1e-3) * seat.y; }
        mvPosition = viewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float fruitSelf;\nvarying float vFruitK;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * fruitSelf * vFruitK;');
  };
  m.customProgramCacheKey = () => 'fruit-near';
  return m;
}
// The glow: the acorns' billboard (acorns.js glowMaterial), its size the cluster's (aSize), its colour the instance's,
// its intensity from the distance to the body (the fade) and kept off the lens when the camera is inside it.
function glowMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { fruitBody: U.body, gain: U.gain },
    vertexShader: /* glsl */`
      attribute float aSize; attribute vec4 aPlant;   // (instanceMatrix and instanceColor: three's prefix declares them)
      uniform vec4 fruitBody; uniform float gain;
      ${SEAT}
      varying vec2 vUv; varying float vI; varying vec3 vCol;
      void main() {
        vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 seat = fruitSeat(c.xyz, aPlant);
        float fk = (1.0 - smoothstep(fruitBody.z, fruitBody.w, distance(c.xz, fruitBody.xy))) * seat.x;
        float d = distance(c.xyz, cameraPosition);
        vI = fk * gain * smoothstep(0.25, 1.2, d);
        c.xyz += normalize(cameraPosition - c.xyz) * seat.y; d -= seat.y;
        vec4 mv = viewMatrix * c;
        mv.xyz += normalize(-mv.xyz) * (seat.y > 0.0 ? 0.03 : min(0.35, d * 0.2));   // toward the eye, so the leaves and the ground do not clip it (a slid one is clear already)
        mv.xy += position.xy * aSize * (1.0 + 0.04 * d);
        vUv = position.xy; vCol = instanceColor;
        gl_Position = vI > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying float vI; varying vec3 vCol;
      void main() {
        float r = length(vUv);
        float a = pow(max(0.0, 1.0 - r), 1.6) * 0.95 + 0.35 * exp(-r * r * 30.0);   // wide warm halo, small hot core (the acorns')
        a *= vI * smoothstep(1.0, 0.85, r);
        if (a < 0.003) discard;
        gl_FragColor = vec4(vCol, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// FNV-1a of a plant's place (cm), for its own stream: the same plant, the same fruit
function seedAt(x, z, salt) {
  let h = 2166136261 ^ salt;
  for (const v of [Math.round(x * 100), Math.round(z * 100)]) { h ^= v & 0xffff; h = Math.imul(h, 16777619); h ^= v >>> 16; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class Fruit {
  constructor({ tile, scene, flight, veg, shrubs, ground = null, season }) {
    Object.assign(this, { tile, flight, veg, shrubs, ground, season });
    this.enabled = true; this.all = false; this.k = GLOW_K;
    this.code = undefined; this.key = null; this.active = new Map();   // kind id -> its weight (1: in fruit and food for this body)
    this.last = null; this.lastVer = -1; this.lastCells = -1; this.t = 0; this.ms = 0; this.buildMs = 0;
    this.U = { body: { value: new THREE.Vector4(0, 0, FRUIT_FULL, FRUIT_R) }, self: { value: 0.18 }, gain: { value: 0.5 } };
    this.group = new THREE.Group(); this.group.name = 'fruit'; this.group.visible = false; scene.add(this.group);
    this.mat = fruitMaterial(this.U);
    this.meshes = new Map();   // kind id -> InstancedMesh (made when the kind is first in fruit)
    const g = new THREE.PlaneGeometry(2, 2); g.deleteAttribute('normal'); g.deleteAttribute('uv');
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_CAP), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aSize', this.aSize);
    this.gPlant = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPlant', this.gPlant);
    this.glow = new THREE.InstancedMesh(g, glowMaterial(this.U), GLOW_CAP);
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.setColorAt(0, new THREE.Color()); this.glow.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.glow.count = 0; this.glow.frustumCulled = false; this.glow.renderOrder = 10; this.glow.name = 'fruit glow';
    this.group.add(this.glow);
    this.tint = new Map(KIND_IDS.map(id => [id, kindColor(id)]));
    this.models = new Map();   // kind id -> its loaded Meshy geometry (fruitModel), swapped in when it arrives
    for (const id of KIND_IDS) fruitModel(id).then(g => {
      if (!g || this.disposed) { g?.dispose(); return; }
      this.models.set(id, g);
      const m = this.meshes.get(id); if (!m) return;
      g.setAttribute('aPlant', m.geometry.getAttribute('aPlant')); m.geometry.dispose(); m.geometry = g;
    });
    this.tmp = new THREE.Object3D(); this.col = new THREE.Color(); this.gcol = new THREE.Color();
  }
  // the body the player is in (main.js onBody): a species code, or 'spirit'
  setBody(code) { this.code = code?.split(':')[0]; this.key = null; }
  // the diet rows: the tile's relations.forage, or the library's eaten_by on a tile without them
  rows() {
    const R = this.tile.games?.relations?.forage;
    if (R?.length) return R;
    if (!this._libRows) {
      this._libRows = [];
      for (const id of KIND_IDS) for (const e of SPECIES[id]?.relations?.eaten_by || []) this._libRows.push([e.animal, id, e.part, null, e.seasons || []]);
    }
    return this._libRows;
  }
  // the kinds in fruit for this body and season (the header)
  setKey(code, season) {
    this.key = `${code}:${season}:${this.all}`; this.active.clear();
    if (!code || code === 'spirit') return;
    const month = seasonMonth(season), eats = new Set();
    if (!this.all) for (const [a, plant, part, , s] of this.rows()) {
      const K = KINDS[plant];
      if (a === code && K && K.part === part && (!s?.length || s.includes(season))) eats.add(plant);
    }
    for (const id of KIND_IDS) {
      const spec = SPECIES[id]; if (!spec) continue;
      if (!this.all && !eats.has(id)) continue;
      const B = spec.foliage?.berries;
      if (!this.all && B && !decoActive(B, season, month)) continue;
      this.active.set(id, Math.min(1.4, (B?.density ?? 0.4) / 0.4));
    }
    this.last = null;
  }
  mesh(id) {
    let m = this.meshes.get(id);
    if (!m) {
      const g = this.models.get(id) || fruitGeometry(id);
      g.setAttribute('aPlant', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage));
      m = new THREE.InstancedMesh(g, this.mat, CAP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, new THREE.Color()); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.name = `fruit ${id}`;
      this.meshes.set(id, m); this.group.add(m);
    }
    return m;
  }
  update(dt) {
    const t0 = performance.now();
    const body = this.code && this.code !== 'spirit' && !(this.ground?.on && this.ground.mode === 'tunnel');
    const season = this.season();
    if (body && `${this.code}:${season}:${this.all}` !== this.key) this.setKey(this.code, season);
    const on = this.enabled && body && this.active.size > 0;
    this.group.visible = on;
    if (!on) return;
    const P = this.flight.pos;
    this.U.body.value.set(P.x, P.z, FRUIT_FULL, FRUIT_R);
    this.U.gain.value = 0.42 * this.k;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = REBUILD_T;
      const ver = this.veg.nearVersion, cells = this.shrubs?.cache?.size ?? 0, list = this.shrubs?.cells;   // the field's cells: generated, gathered
      if (!this.last || Math.hypot(P.x - this.last[0], P.z - this.last[1]) > REBUILD_MOVE || ver !== this.lastVer || cells !== this.lastCells || list !== this.lastList) {
        this.last = [P.x, P.z]; this.lastVer = ver; this.lastCells = cells; this.lastList = list;
        const b0 = performance.now(); this.rebuild(P.x, P.z); this.buildMs = performance.now() - b0;
      }
    }
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  // every plant in fruit within FRUIT_R + GATHER_PAD of (x, z): { id, x, y, z, rx, h } with its crown's centre height
  // cy and half height ry (3D plants: an ellipsoid of the height and crown_width_ratio; impostors: their dome)
  gather(x, z) {
    const out = [], R = FRUIT_R + GATHER_PAD, R2 = R * R;
    for (const q of this.veg.nearPlants || []) {
      if (!this.active.has(q.species)) continue;
      const dx = q.x - x, dz = q.z - z; if (dx * dx + dz * dz > R2) continue;
      const spec = SPECIES[q.species], h = q.height || 2, wr = spec?.targets?.crown_width_ratio ?? 1.1;
      out.push({ id: q.species, x: q.x, y: q.y, z: q.z, rx: Math.max(0.3, 0.5 * h * wr), cy: h * 0.5, ry: h * 0.5, h, imp: 0 });
    }
    const SF = this.shrubs, res = this.tile.habitat.res;
    if (SF?.cells) for (const [d, i, j] of SF.cells) {
      if (d > R + res) break;
      const c = SF.cache.get(j * SF.W + i); if (!c || !c.n) continue;
      const a = c.data;
      for (let q = 0, o = 0; q < c.n; q++, o += SHRUB_STRIDE) {
        const kind = a[o + 6], id = kind < -0.5 ? FH[-1 - Math.round(kind)] : kind < 1.5 ? CHAP[Math.round(kind)] : null;
        if (!id || !this.active.has(id)) continue;
        const dx = a[o] - x, dz = a[o + 2] - z; if (dx * dx + dz * dz > R2) continue;
        const Rr = a[o + 3], H = a[o + 4];
        out.push({ id, x: a[o], y: a[o + 1], z: a[o + 2], rx: Rr, cy: H * 0.5, ry: H * 0.5, h: H, imp: Rr });
      }
    }
    return out;
  }
  rebuild(x, z) {
    const plants = this.gather(x, z), n = new Map(), t = this.tmp, hts = this.tile.heights;
    let ng = 0;
    const gm = this.glow.instanceMatrix.array, gs = this.aSize.array, gc = this.glow.instanceColor.array;
    for (const p of plants) {
      const K = KINDS[p.id], m = this.mesh(p.id), w = this.active.get(p.id) ?? 1, base = this.tint.get(p.id);
      const rnd = mulberry32(seedAt(p.x, p.z, 0xf7a17));
      let cnt;
      if (K.where === 'tree') cnt = Math.round(Math.min(PER_PLANT, Math.PI * (p.rx * 0.8) ** 2 * K.perM2 * w * (0.6 + 0.8 * rnd())));
      else cnt = Math.round(Math.min(PER_PLANT, Math.max(1, Math.PI * p.rx * p.rx * K.perM2 * w * (0.6 + 0.8 * rnd()))));
      let k = n.get(p.id) || 0;
      for (let c = 0; c < cnt && k < CAP; c++) {
        let fx, fy, fz, rotX = 0, rotZ = 0, yaw = rnd() * TAU;
        const u = rnd(), v = rnd(), a = rnd() * TAU, tint = 0.86 + 0.28 * rnd();
        if (K.where === 'tree') {
          // on the ground under the crown, lying (the crown's own nuts are painted into its leaf cards: treegen.js)
          const r = Math.sqrt(u) * p.rx * 0.85, flat = p.id === 'acer_macrophyllum' ? 0.15 : 0.5;
          fx = p.x + Math.cos(a) * r; fz = p.z + Math.sin(a) * r;
          fy = hts.groundXZ(fx, fz) - (K.ground ?? 0.01) * 0.25 * SHOW_K.tree;
          rotX = (rnd() - 0.5) * flat; rotZ = (rnd() - 0.5) * flat;
        } else {   // hanging on the crown's outline, in the kind's band of it
          const ny = K.ny[0] + (K.ny[1] - K.ny[0]) * Math.sqrt(u), s = Math.sqrt(Math.max(0, 1 - ny * ny)), f = 0.97 + 0.06 * v;
          fx = p.x + Math.cos(a) * s * p.rx * f; fz = p.z + Math.sin(a) * s * p.rx * f;
          fy = p.y + p.cy + ny * p.ry * f;
          fy = Math.max(fy, hts.groundXZ(fx, fz) + 0.06);
          rotX = (rnd() - 0.5) * 0.4; rotZ = (rnd() - 0.5) * 0.4;
        }
        t.position.set(fx, fy, fz); t.rotation.set(rotX, yaw, rotZ); t.scale.setScalar((K.show ?? SHOW_K[K.where]) * (0.9 + 0.2 * rnd())); t.updateMatrix();
        m.setMatrixAt(k, t.matrix);
        const pa = m.geometry.attributes.aPlant.array, pg = this.gPlant.array, pc = p.y + p.cy;
        pa[k * 4] = p.x; pa[k * 4 + 1] = pc; pa[k * 4 + 2] = p.z; pa[k * 4 + 3] = p.imp;
        this.col.setRGB(tint, tint, tint); m.setColorAt(k, this.col);
        if (ng < GLOW_CAP) {   // its glow: at the cluster's centre, the size of the cluster (a nut's: a little larger)
          const o = ng * 16, gy = fy + (K.where === 'tree' ? 0.04 : -K.size * 0.5 * (K.show ?? SHOW_K.hang));
          gm.fill(0, o, o + 16); gm[o] = gm[o + 5] = gm[o + 10] = gm[o + 15] = 1; gm[o + 12] = fx; gm[o + 13] = gy; gm[o + 14] = fz;
          gs[ng] = Math.max(0.12, K.size * 1.7 * (K.show ?? SHOW_K[K.where]));
          pg[ng * 4] = p.x; pg[ng * 4 + 1] = pc; pg[ng * 4 + 2] = p.z; pg[ng * 4 + 3] = p.imp;
          this.gcol.copy(base).lerp(GLOW_AMBER, 0.45).multiplyScalar(0.8 + 0.4 * tint);
          gc[ng * 3] = this.gcol.r; gc[ng * 3 + 1] = this.gcol.g; gc[ng * 3 + 2] = this.gcol.b;
          ng++;
        }
        k++;
      }
      n.set(p.id, k);
    }
    for (const [id, m] of this.meshes) {
      const c = n.get(id) || 0; m.count = c; m.visible = c > 0;
      if (c) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, c * 16); m.instanceMatrix.needsUpdate = true;
        m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, c * 3); m.instanceColor.needsUpdate = true;
        const pa = m.geometry.attributes.aPlant; pa.clearUpdateRanges(); pa.addUpdateRange(0, c * 4); pa.needsUpdate = true; }
    }
    const G = this.glow; G.count = ng; G.visible = ng > 0;
    if (ng) {
      G.instanceMatrix.clearUpdateRanges(); G.instanceMatrix.addUpdateRange(0, ng * 16); G.instanceMatrix.needsUpdate = true;
      this.aSize.clearUpdateRanges(); this.aSize.addUpdateRange(0, ng); this.aSize.needsUpdate = true;
      this.gPlant.clearUpdateRanges(); this.gPlant.addUpdateRange(0, ng * 4); this.gPlant.needsUpdate = true;
      G.instanceColor.clearUpdateRanges(); G.instanceColor.addUpdateRange(0, ng * 3); G.instanceColor.needsUpdate = true;
    }
    this.nPlants = plants.length;
  }
  counts() { const o = {}; for (const [id, m] of this.meshes) if (m.count) o[id] = m.count; o.glow = this.glow.count; o.plants = this.nPlants; return o; }
  dispose() {
    this.disposed = true; this.group.removeFromParent();
    for (const m of this.meshes.values()) m.geometry.dispose();
    for (const g of this.models.values()) g.dispose();
    this.meshes.clear(); this.mat.dispose(); this.glow.geometry.dispose(); this.glow.material.dispose();
  }
}
