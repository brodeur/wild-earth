import * as THREE from 'three';
import { SPECIES } from './trees.js';

// Roots in the tunnels (docs/game-dig.md "Roots", 2026-11-04; Aaron: "Another layer of this will be showing roots
// hanging from the ceiling and letting players either pull the plant down or eat the roots"). Where a tunnel's or a
// room's ceiling passes under a plant within the depth its roots reach, its roots hang from the ceiling there:
// - the grasses everywhere under the sward: fine fibrous roots on a 2.5 cm lattice by the sward's density, to 45 cm
//   under an annual sward (wild oats, bromes: most of their roots in the top 30 cm) and 1 m under the perennial
//   bunchgrasses (purple needlegrass roots past a metre and a half);
// - the forbs (forbs.js, each with its deterministic id): soap plant's bulb (7-15 cm, wrapped in brown fibres, set 15-30
//   cm deep) bulging from the ceiling with its roots, blue dicks' small corm (1-2 cm, 5-15 cm deep), any other herb a
//   taproot and a few fine roots, to 35 cm;
// - the trees and shrubs of the near set (vegetation.js nearPlants) within their drip line: an oak's thick roots (1-3 cm,
//   thinner away from the trunk; any depth a vole digs), a shrub's woody roots to 70 cm, a conifer's to 1.2 m.
// Drawn as instanced strands (a tapered five-sided tube bent down and out or sagging across, 20 vertices, two instance attributes) and
// instanced bulbs (a flattened icosphere), on the world's layer and the underground view's (dig.js XR), no texture.
// Each root is an item the body can eat (needs.js, through dig.underFood: E with the nose at it) and a forb's can be
// pulled down (F held: the `pull` world event, dig.js). A pulled plant lies on the tunnel's floor as food until eaten.
// Built again (at most twice a second) when the tunnels, the pulls, the near plants or the forbs change, or the body
// moves ROOT_MOVE m, for the tunnels within ROOT_R m of the body.

const ROOT_R = 9, ROOT_MOVE = 2.5, STRANDS = 8000, BULBS = 600, GRASS_STEP = 0.025, WOOD_STEP = 0.1;
// the colours (linear): grass fibre, forb root, oak, shrub, pale rootlet
const COLS = [[0.62, 0.53, 0.37], [0.56, 0.42, 0.27], [0.27, 0.19, 0.13], [0.36, 0.26, 0.18], [0.74, 0.66, 0.5]];
// what a root is worth to a body that eats it (needs.js scores 0-100; EAT_MIN 25)
export const ROOT_FOOD = { bulb: 100, corm: 90, pile: 100, forb: 50, grass: 35, wood: 30 };
const BULB_OF = {   // r: the bulb's radius; at: how deep it sits (m); roots: how far below it its roots reach
  chlorogalum_pomeridianum: { kind: 'bulb', r: 0.03, tall: 1.4, at: 0.22, roots: 0.5, col: [0.42, 0.3, 0.19], label: 'soap plant bulb' },
  dipterostemon_capitatus: { kind: 'corm', r: 0.009, tall: 0.8, at: 0.1, roots: 0.3, col: [0.6, 0.47, 0.33], label: 'blue dicks corm' },
};
const FORB_DEPTH = 0.35, GRASS_ANNUAL = 0.45, GRASS_BUNCH = 1.0;
const name = id => SPECIES[id]?.common || id.replace(/_/g, ' ');
function hash3(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function woodOf(sp) {
  const S = SPECIES[sp]; if (!S) return null;
  if (/^quercus_/.test(sp)) return { depth: 2, th: 0.018, col: 2 };
  if (S.form === 'shrub') return { depth: 0.7, th: 0.009, col: 3 };
  if (S.form === 'tree') return { depth: 1.2, th: 0.018, col: 2 };
  return null;
}

// a strand: iA (the start on the ceiling, its length), iB (its lean or way across, its thickness, its colour + 0.5 for
// an arc). Hanging, it drops and curls out; as an arc (a woody root) it crosses under the roof and sags between its ends.
const STRAND_VERT = /* glsl */`
  attribute vec4 iA; attribute vec4 iB; uniform vec3 cols[5];
  varying vec3 vN; varying vec3 vC; varying float vU;
  void main(){
    float u = position.y, L = iA.w, arc = step(0.25, fract(iB.w));
    vec2 n = normalize(iB.xy + 1e-6);
    vec3 cH = vec3(iB.x * u * u, -u, iB.y * u * u), tH = vec3(2.0 * iB.x * u, -1.0, 2.0 * iB.y * u);
    vec3 cA = vec3(n.x * u, -0.7 * u * (1.0 - u), n.y * u), tA = vec3(n.x, -0.7 * (1.0 - 2.0 * u), n.y);
    vec3 c = iA.xyz + mix(cH, cA, arc) * L, t = normalize(mix(tH, tA, arc) + 1e-5);
    float th = iB.z * mix(1.0 - 0.82 * u, 1.0 - 0.3 * u, arc);
    vec3 a = normalize(cross(t, abs(t.z) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0))), b = cross(t, a);
    vec3 off = a * position.x + b * position.z;
    vN = off; vC = cols[int(floor(iB.w) + 0.5)]; vU = u * (1.0 - arc);
    gl_Position = projectionMatrix * viewMatrix * vec4(c + off * th, 1.0); }`;
const BULB_VERT = /* glsl */`
  attribute vec4 iA; attribute vec4 iB; varying vec3 vN; varying vec3 vC; varying float vU;
  void main(){ vN = normal * vec3(1.0, 1.0 / iB.w, 1.0); vC = iB.rgb; vU = 0.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(iA.xyz + position * iA.w * vec3(1.0, iB.w, 1.0), 1.0); }`;
// lit as the walls are not (they are dark): a soft light from above so a root reads in the tunnel and the underground view
const ROOT_FRAG = /* glsl */`
  varying vec3 vN; varying vec3 vC; varying float vU; uniform float lit;
  void main(){ float d = max(dot(normalize(vN), normalize(vec3(0.3, 0.8, 0.45))), 0.0);
    vec3 col = vC * (0.35 + 0.65 * d) * (1.0 + 0.25 * vU) * lit;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Roots {
  constructor(dig, { forbs = null, veg = null, grass = null } = {}) {
    Object.assign(this, { dig, forbs, veg, grass });
    this.items = []; this.dirty = true; this.t = 0; this.at = null; this.sig = '';
    this.stats = { strands: 0, bulbs: 0, items: 0, ms: 0 };
    const lit = { value: 1 }; this.lit = lit;
    // the strand: four rings of three sides, from the ceiling (y 0) to the tip (y 1)
    const pos = [], idx = [], SIDES = 5, RINGS = 4;
    for (let k = 0; k < RINGS; k++) for (let s = 0; s < SIDES; s++) { const a = s / SIDES * Math.PI * 2; pos.push(Math.cos(a), k / (RINGS - 1), Math.sin(a)); }
    for (let k = 0; k < RINGS - 1; k++) for (let s = 0; s < SIDES; s++) { const a = k * SIDES + s, b = k * SIDES + (s + 1) % SIDES; idx.push(a, a + SIDES, b, b, a + SIDES, b + SIDES); }
    const sg = new THREE.InstancedBufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx);
    this.sA = new Float32Array(STRANDS * 4); this.sB = new Float32Array(STRANDS * 4);
    sg.setAttribute('iA', new THREE.InstancedBufferAttribute(this.sA, 4).setUsage(THREE.DynamicDrawUsage)); sg.setAttribute('iB', new THREE.InstancedBufferAttribute(this.sB, 4).setUsage(THREE.DynamicDrawUsage));
    sg.instanceCount = 0;
    const cols = { value: COLS.map(c => new THREE.Vector3(...c)) };
    this.strands = new THREE.Mesh(sg, new THREE.ShaderMaterial({ vertexShader: STRAND_VERT, fragmentShader: ROOT_FRAG, uniforms: { cols, lit }, side: THREE.DoubleSide }));
    const ico = new THREE.IcosahedronGeometry(1, 1), bg = new THREE.InstancedBufferGeometry();
    bg.setAttribute('position', ico.attributes.position); bg.setAttribute('normal', ico.attributes.normal); ico.index && bg.setIndex(ico.index);
    this.bA = new Float32Array(BULBS * 4); this.bB = new Float32Array(BULBS * 4);
    bg.setAttribute('iA', new THREE.InstancedBufferAttribute(this.bA, 4).setUsage(THREE.DynamicDrawUsage)); bg.setAttribute('iB', new THREE.InstancedBufferAttribute(this.bB, 4).setUsage(THREE.DynamicDrawUsage));
    bg.instanceCount = 0;
    this.bulbs = new THREE.Mesh(bg, new THREE.ShaderMaterial({ vertexShader: BULB_VERT, fragmentShader: ROOT_FRAG, uniforms: { lit } }));
    for (const m of [this.strands, this.bulbs]) { m.frustumCulled = false; m.renderOrder = 1; m.layers.enable(dig.XR); m.visible = false; dig.scene.add(m); }
    this.strands.name = 'dig roots'; this.bulbs.name = 'dig bulbs';
  }
  // the near set or the forbs changed, or the body moved on: built again soon
  watch(P) {
    const sig = `${this.veg?.nearVersion ?? 0}:${this.forbs?.month ?? 0}:${this.forbs?.cache?.size ? 1 : 0}`;
    if (sig !== this.sig) { this.sig = sig; this.dirty = true; }
    if (!this.at || Math.hypot(P.x - this.at.x, P.z - this.at.z) > ROOT_MOVE) this.dirty = true;
  }
  update(dt) {
    const P = this.dig.gc.flight.pos; this.watch(P);
    if ((this.t -= dt) > 0 || !this.dirty) return;
    this.t = 0.5; this.dirty = false; this.at = { x: P.x, z: P.z };
    const t0 = performance.now(); this.build(P); this.stats.ms = performance.now() - t0;
  }
  // the ceiling over (x, z) of a segment (A, B nodes) or a room: its height, the floor under it, the bore there; null
  // outside its footprint (within kLat of the bore's half-width)
  static ceilSeg(A, B, x, z, kLat) {
    const dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz;
    const t = l2 > 1e-10 ? Math.min(1, Math.max(0, ((x - A.x) * dx + (z - A.z) * dz) / l2)) : 0;
    const qx = A.x + dx * t, qz = A.z + dz * t, qy = A.y + (B.y - A.y) * t, r = (A.room ? B.r : B.room ? A.r : A.r + (B.r - A.r) * t);
    const d = Math.hypot(x - qx, z - qz); if (d > r * kLat) return null;
    const h = Math.sqrt(Math.max(r * r - d * d, 0));
    return { y: qy + h * 0.97, floor: qy - r * 0.85, r, d, qx, qz };
  }
  static ceilRoom(n, x, z, kLat) {
    const d = Math.hypot(x - n.x, z - n.z); if (d > n.r * kLat) return null;
    const h = 0.8 * n.r * Math.sqrt(Math.max(1 - (d * d) / (n.r * n.r), 0));
    return { y: n.y + h * 0.97, floor: n.y - 0.8 * n.r * 0.85, r: n.r, d, qx: n.x, qz: n.z };
  }
  build(P) {
    const D = this.dig, w = D.world, H = D.heights, R2 = ROOT_R * ROOT_R, items = this.items; items.length = 0;
    let ns = 0, nb = 0; const sA = this.sA, sB = this.sB, bA = this.bA, bB = this.bB;
    let capL = 1; const strand = (x, y, z, L, lx, lz, th, col) => { if (ns >= STRANDS) return; L = Math.min(L, capL); const o = ns++ * 4; sA[o] = x; sA[o + 1] = y; sA[o + 2] = z; sA[o + 3] = L; sB[o] = lx; sB[o + 1] = lz; sB[o + 2] = th; sB[o + 3] = col; };
    const bulb = (x, y, z, r, c, tall) => { if (nb >= BULBS) return; const o = nb++ * 4; bA[o] = x; bA[o + 1] = y; bA[o + 2] = z; bA[o + 3] = r; bB[o] = c[0]; bB[o + 1] = c[1]; bB[o + 2] = c[2]; bB[o + 3] = tall; };
    // the ceilings within reach: each segment and room near the body
    const ceils = [];
    for (const s of w.segs) { const A = D.node(s.a), B = D.node(s.b); if (!A || !B) continue; if (((A.x + B.x) / 2 - P.x) ** 2 + ((A.z + B.z) / 2 - P.z) ** 2 > R2) continue; ceils.push({ A, B }); }
    for (const n of w.nodes) if (n.room && (n.x - P.x) ** 2 + (n.z - P.z) ** 2 < R2) ceils.push({ room: n });
    if (!ceils.length) return this.finish(ns, nb);
    const ceilAt = (c, x, z, k) => (c.room ? Roots.ceilRoom(c.room, x, z, k) : Roots.ceilSeg(c.A, c.B, x, z, k));
    const box = c => { const a = c.room || c.A, b = c.room || c.B, r = Math.max(a.r, b.r); return [Math.min(a.x, b.x) - r, Math.min(a.z, b.z) - r, Math.max(a.x, b.x) + r, Math.max(a.z, b.z) + r]; };
    const G = this.grass, taken = new Set(), wood = new Set();
    // the grasses: a lattice point under the sward whose ceiling is within the grass's reach
    for (const c of ceils) {
      const b = box(c), mx = (b[0] + b[2]) / 2, mz = (b[1] + b[3]) / 2, sp = G?.speciesAt?.(mx, -mz), depth = sp ? (sp.type === 1 ? GRASS_BUNCH : GRASS_ANNUAL) : 0;
      if (!depth) continue;
      for (let i = Math.floor(b[0] / GRASS_STEP); i <= Math.floor(b[2] / GRASS_STEP); i++) for (let j = Math.floor(b[1] / GRASS_STEP); j <= Math.floor(b[3] / GRASS_STEP); j++) {
        const key = i * 1e6 + j; if (taken.has(key)) continue;
        const x = (i + hash3(i, j, 1)) * GRASS_STEP, z = (j + hash3(i, j, 2)) * GRASS_STEP;
        const q = ceilAt(c, x, z, 0.8); if (!q) continue;
        const gy = H.atXZ(x, z), deep = gy - q.y; if (deep < 0.01 || deep > depth) continue;
        capL = 1.3 * q.r;   // a root hangs no lower than the bore's lower part
        const cover = Math.min(1, G.sample ? G.sample(G.dens, x, -z) : 0.6) * (1 - deep / depth * 0.6);
        if (hash3(i, j, 3) > cover * 0.8) continue;
        taken.add(key);
        const n = 1 + (hash3(i, j, 4) * 3 | 0);
        for (let m = 0; m < n; m++) { const a = hash3(i, j, 10 + m) * Math.PI * 2, L = 0.015 + 0.045 * hash3(i, j, 20 + m) * Math.min(1, q.r / 0.03); strand(x, q.y + 0.003, z, L, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.0007 + 0.0005 * hash3(i, j, 30 + m), m ? 4 : 0); }
        if (n >= 2) items.push({ x, y: q.y, z, kind: 'grass', score: ROOT_FOOD.grass, label: `${name(sp.id)} roots`, sp: sp.id });
      }
    }
    // the forbs over the tunnels: each one's own root (a bulb, a corm, a taproot)
    if (this.forbs?.plantsIn) {
      const fx0 = P.x - ROOT_R, fz0 = P.z - ROOT_R, plants = this.forbs.plantsIn(fx0, fz0, P.x + ROOT_R, P.z + ROOT_R);
      for (const f of plants) {
        if (w.pulls.has(f.id)) continue;
        let best = null, bc = null;
        for (const c of ceils) { const q = ceilAt(c, f.x, f.z, 1.6); if (q && (!best || q.d < best.d)) { best = q; bc = c; } }
        if (!best) continue;
        // the root comes down to the ceiling's nearest part under the plant (within the bore's upper part)
        let x = f.x, z = f.z, y = best.y;
        if (best.d > best.r * 0.6) { const k = best.r * 0.6 / best.d; x = best.qx + (f.x - best.qx) * k; z = best.qz + (f.z - best.qz) * k; const q2 = ceilAt(bc, x, z, 1); if (q2) y = q2.y; }
        const gy = H.atXZ(f.x, f.z), deep = gy - y, B = BULB_OF[f.species]; if (deep < 0.01) continue;
        const reach = B ? B.at + B.roots : FORB_DEPTH; if (deep > reach) continue;
        const seed = hash3(Math.round(f.x * 100), Math.round(f.z * 100), 7); capL = 1.3 * best.r;
        if (B && deep < B.at + B.r * 2 + 0.04 && deep > B.at * 0.3) {   // the bulb itself in the ceiling (the tunnel passes at its depth)
          const r = B.r * (0.8 + 0.4 * seed) * Math.min(1.3, f.scale), low = Math.min(r * B.tall * 0.5, best.r * 0.7);   // mostly in the soil: its base shows, never lower than the bore's middle
          bulb(x, y - low + r * B.tall, z, r, B.col, B.tall);
          for (let m = 0; m < (B.kind === 'bulb' ? 9 : 5); m++) { const a = (m / 9 + seed) * Math.PI * 2; strand(x + Math.cos(a) * r * 0.4, y - low * 0.9, z + Math.sin(a) * r * 0.4, 0.02 + 0.04 * hash3(m, 3, seed * 1e4 | 0), Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.0009, 4); }
          items.push({ x, y, z, kind: B.kind, score: ROOT_FOOD[B.kind], label: B.label, sp: f.species, plantId: f.id, floor: best.floor, pull: true });
        } else {   // its roots only: a taproot (a herb), or the bulb's roots coming down from it above
          strand(x, y + 0.002, z, 0.03 + 0.05 * seed, 0.15, -0.1, B ? 0.0012 : 0.0025, 1);
          for (let m = 0; m < 4; m++) { const a = (m / 4 + seed) * Math.PI * 2; strand(x, y + 0.002, z, 0.015 + 0.03 * hash3(m, 5, seed * 1e4 | 0), Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0.0008, 4); }
          items.push({ x, y, z, kind: 'forb', score: ROOT_FOOD.forb, label: `${name(f.species)} roots`, sp: f.species, plantId: f.id, floor: best.floor, pull: true });
        }
      }
    }
    // the trees and shrubs: thick roots across the ceiling within the drip line
    for (const p of this.veg?.nearPlants || []) {
      const W = woodOf(p.species); if (!W) continue;
      const reachR = Math.max(0.6, (p.crownR || 1) * 1.1); if ((p.x - P.x) ** 2 + (p.z - P.z) ** 2 > (ROOT_R + reachR) ** 2) continue;
      for (const c of ceils) {
        const b = box(c); if (b[0] > p.x + reachR || b[2] < p.x - reachR || b[1] > p.z + reachR || b[3] < p.z - reachR) continue;
        // the WOOD_STEP cells the bore passes under (walked along its axis, so a narrow bore meets them as a wide one
        // does), a root in some, from the trunk's side
        const A = c.room || c.A, Bn = c.room || c.B, L = Math.hypot(Bn.x - A.x, Bn.z - A.z), n = Math.max(1, Math.ceil(L / 0.01));
        for (let s = 0; s <= n; s++) {
          const t = s / n, ax = A.x + (Bn.x - A.x) * t, az = A.z + (Bn.z - A.z) * t, i = Math.floor(ax / WOOD_STEP), j = Math.floor(az / WOOD_STEP), key = i * 1e6 + j;
          if (wood.has(key)) continue;
          const dT = Math.hypot(ax - p.x, az - p.z); if (dT > reachR) continue;
          wood.add(key);
          if (hash3(i, j, 43) > 0.95 - 0.45 * dT / reachR) continue;
          const ux = (p.x - ax) / (dT || 1), uz = (p.z - az) / (dT || 1), q0 = ceilAt(c, ax, az, 2); if (!q0) continue;
          const off = (hash3(i, j, 46) - 0.3) * 0.5 * q0.r, x = ax + ux * off, z = az + uz * off, q = ceilAt(c, x, z, 0.9) || q0; capL = 1.5 * q.r;
          const deep = H.atXZ(x, z) - q.y; if (deep < 0.02 || deep > W.depth) continue;
          const th = Math.max(0.003, W.th * (1 - 0.7 * dT / reachR)) * Math.min(1, q.r / 0.04 + 0.4);
          const La = Math.min(2.2 * q.r, 0.05 + 0.1 * hash3(i, j, 44)), a0 = Math.atan2(-uz, -ux) + (hash3(i, j, 47) - 0.5) * 1.2, dx = Math.cos(a0), dz = Math.sin(a0);
          capL = 1;
          strand(x - dx * La / 2, q.y + th * 0.6, z - dz * La / 2, La, dx, dz, th, W.col + 0.5);   // across the roof, running out from the trunk, sagging between its ends
          capL = 1.5 * q.r;
          strand(x - ux * 0.02, q.y, z - uz * 0.02, 0.02 + 0.03 * hash3(i, j, 45), uz * 0.7, -ux * 0.7, 0.0012, 4);
          items.push({ x, y: q.y, z, kind: 'wood', score: ROOT_FOOD.wood, label: `${name(p.species)} root`, sp: p.species });
        }
      }
    }
    // the plants pulled down: a heap of their leaves on the floor, as much as is left
    capL = 1;
    for (const u of w.pulls.values()) {
      if (u.left <= 0.02 || (u.x - P.x) ** 2 + (u.z - P.z) ** 2 > R2) continue;
      const k = Math.sqrt(u.left), s0 = Math.min(1, Math.max(0.5, (BULB_OF[u.sp]?.r ?? 0.015) / 0.02));   // a heap of leaves the size of the plant, on the floor
      for (let m = 0; m < 3; m++) { const a = m * 2.1 + u.x * 50; bulb(u.x + Math.cos(a) * 0.008, u.y + 0.003, u.z + Math.sin(a) * 0.008, (0.009 + 0.003 * m) * k * s0, [0.3, 0.38, 0.2], 0.3); }
      strand(u.x, u.y + 0.012 * k, u.z, 0.02 * k, 1.2, 0.3, 0.0012, 1);
      items.push({ x: u.x, y: u.y, z: u.z, kind: 'pile', score: ROOT_FOOD.pile, label: `${name(u.sp)}, pulled down`, sp: u.sp, plantId: u.id, left: u.left, floor: u.y });
    }
    this.finish(ns, nb);
  }
  finish(ns, nb) {
    const S = this.strands.geometry, B = this.bulbs.geometry;
    S.instanceCount = ns; S.attributes.iA.needsUpdate = S.attributes.iB.needsUpdate = true;
    B.instanceCount = nb; B.attributes.iA.needsUpdate = B.attributes.iB.needsUpdate = true;
    this.strands.visible = ns > 0; this.bulbs.visible = nb > 0;
    this.stats.strands = ns; this.stats.bulbs = nb; this.stats.items = this.items.length;
  }
  // the root at the nose (x, y, z), within reach m across and a bore's height up: the best one there (a pulled plant's
  // heap, a bulb, a corm, a herb's root before grass and wood: the one a body would go for), the nearest of those
  near(x, y, z, reach, up) {
    let best = null, bd = 0, r2 = reach * reach;
    for (const it of this.items) {
      const d2 = (it.x - x) ** 2 + (it.z - z) ** 2; if (d2 > r2) continue;
      if (it.kind === 'pile' ? Math.abs(it.y - y) > up * 0.6 : it.y - y > up || it.y < y - 0.02) continue;
      if (!best || it.score > best.score || (it.score === best.score && d2 < bd)) { best = it; bd = d2; }
    }
    return best;
  }
  dispose() { for (const m of [this.strands, this.bulbs]) { this.dig.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } }
}
