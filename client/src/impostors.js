import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { SPECIES, SPECIES_IDS, mulberry32, resolveSpecies } from './trees.js';
import { VARIANTS, pick, hash, variantSeed, midSet, cellPlan, placementSkip } from './vegetation.js';
import { bakeImpostors, VIEWS, SIDE_VIEWS, ALPHA_REF } from './impostorBake.js';
import { seasonOfDate } from './season.js';

// Distant forest: one impostor per tree, for the whole tile, where the real trees (vegetation.js)
// end. Each impostor is the tree vegetation.js would put there (same per-cell random stream, so the
// same species, variant, position, scale and rotation) drawn from an atlas baked at load from that
// very tree (impostorBake.js), so flying in swaps a tree for itself.
//
//   - Mid band (to about nearRadius + 150..450 m, per tree): two crossed quads with the 0 and 90
//     degree views (the back of a quad shows the mirror image, which is the true opposite view).
//   - Far band: one camera-facing (cylindrical) billboard blending the two nearest of eight views.
//   - Both: a horizontal cap with the top view, visible when looking down.
//   - Lit live from the baked crown normals with the same sun, sky light, cloud shadow and aerial
//     perspective as the Lambert trees; alpha-to-coverage with a sharpened alpha edge.
//   - Hand-over: vegetation.js publishes the extent of its mid set (midSet: every cell whose centre is
//     within its radius of its last rebuild centre); the impostors draw exactly the other cells, so
//     each tree is drawn once, as itself or as its own impostor: no band of double cover, no gap, and
//     when the mid set moves (every 200 m) the trees on its edge swap for their own impostors.
//   - Thinning: beyond that edge (at most nearRadius + 200 from the eye) plus a margin, only a fraction
//     (thin/d)^P of trees is kept (by a per-tree rank) and the survivors widen to keep the canopy
//     cover; trees there also pick up height from the species' range, width and a slight lean, so
//     repeated variants do not read as copies. Far shrubs stand for patches of chaparral.
// Trees are precomputed per 250 m chunk sorted by rank; every MOVE m the kept prefix of each chunk is
// copied either into the ring mesh (chunks that can reach the crossed band: two side quads and the cap)
// or into one of six angular sectors of billboard-only meshes (one quad, a third of the vertices),
// each one draw call and frustum-culled, so a view draws the ring and two to four sectors.

const CHUNK = 250, MOVE = 80, SECTORS = 6, STRIDE = 8;   // record: x y z rot | scale tree rank cell
const THIN_P = 0.7;                // keep (thinStart / d)^P beyond thinStart
const RING = 250;                  // the mid set's edge is within nearRadius +/- 200 of the eye: no thinning or variety inside +250
const FADE = [350, 200];           // without a mid set (never in the app): dither in over nearRadius - 350..-200
const CROSS = [150, 450];          // crossed -> billboard switch, per tree, at nearRadius + 150..450
const srgbToLin = v => Math.pow(v / 255, 2.2);

const VERT = /* glsl */`
  #define VIEWS ${VIEWS.toFixed(1)}
  attribute vec4 iPos; attribute vec4 iA;
  uniform vec4 frame[NT]; uniform vec4 hrange[NT]; uniform vec4 vext[NT * ${VIEWS}]; uniform vec3 tint[NS];
  uniform vec3 eye; uniform float nearRadius; uniform vec4 thin; uniform vec2 grid;
  uniform vec4 mid; uniform vec3 cells;   // mid set: centre x, z, radius, on | habitat cell size, tile size, cells per row
  varying vec4 vUv; varying vec2 vMirror; varying float vBlend; varying vec3 vR; varying vec3 vU; varying vec3 vF;
  varying float vFade; varying vec3 vTint; varying vec3 vSun; varying vec3 vHazeT; varying vec3 vHazeS; varying float vSky;
  ${ATMOSPHERE_GLSL}
  float hsh(float n) { return fract(sin(n) * 43758.5453123); }
  vec2 cellUv(float tree, float view, vec2 uv) {
    float idx = tree * VIEWS + view;
    return (vec2(mod(idx, grid.x), floor(idx / grid.x)) + clamp(uv, 0.002, 0.998)) / grid;
  }
  void main() {
    // position.xy: quad corner (x -0.5..0.5, y 0..1); position.z: 0, 1 the side quads, 2 the cap
    vec3 base = iPos.xyz; float rot = iPos.w, s = iA.x, rank = iA.z, seed = fract(rank * 7919.131) * 100.0;
    int ti = int(iA.y + 0.5); vec4 fr = frame[ti]; vec4 hr = hrange[ti];
    float d = distance(base.xz, eye.xz);
    float fade;
    if (mid.w > 0.5) {   // exactly the cells the mid set does not place (vegetation.js: cell centre beyond the radius)
      float ci = mod(iA.w, cells.z), cj = floor(iA.w / cells.z);
      vec2 cc = vec2((ci + 0.5) * cells.x, (cells.y - (cj + 0.5) * cells.x) * -1.0);
      fade = distance(cc, mid.xy) > mid.z ? 1.0 : 0.0;
    } else fade = smoothstep(nearRadius - ${FADE[0].toFixed(1)}, nearRadius - ${FADE[1].toFixed(1)}, d);
    float keep = d < thin.x ? 1.0 : pow(thin.x / d, thin.y);
    float shrubFar = hr.z * smoothstep(nearRadius + ${RING.toFixed(1)}, nearRadius + 1000.0, d);
    keep *= 1.0 - 0.5 * shrubFar;   // far shrubs: fewer, wider and a little taller (a patch of chaparral, not a bush)
    float alive = smoothstep(keep, keep * 0.88, rank);   // shrink out just before the rank is dropped
    if (fade <= 0.0 || alive <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float v = smoothstep(nearRadius + ${RING.toFixed(1)}, nearRadius + 1450.0, d);   // per-tree variety, none at the hand-over
    float r1 = hsh(seed * 12.9898 + 1.0), r2 = hsh(seed * 78.233 + 2.0), r3 = hsh(seed * 37.719 + 3.0),
          r4 = hsh(seed * 93.989 + 4.0), r5 = hsh(seed * 51.137 + 5.0), r6 = hsh(seed * 23.417 + 6.0), r7 = hsh(seed * 67.351 + 7.0);
    float hMul = mix(1.0, mix(hr.x, hr.y, r1) / s, v) * pow(keep, -0.15) * (1.0 + 0.5 * shrubFar) * alive;
    float wMul = mix(1.0, 0.85 + 0.3 * r2, v) * pow(keep, -0.38) * (1.0 + 2.0 * shrubFar) * alive;
    float W = fr.x * s * wMul, H = fr.y * s * hMul, y0 = fr.z * s * hMul;
    float lean = v * (r3 - 0.5) * 0.16, ld = r4 * 6.2831853;
    vec2 leanV = vec2(cos(ld), sin(ld)) * lean;   // horizontal shift per metre of height
    vec2 toCam = normalize(eye.xz - base.xz + vec2(1e-4, 0.0));
    float cr = cos(rot), sr = sin(rot);
    vec3 lx = vec3(cr, 0.0, -sr), lz = vec3(sr, 0.0, cr);   // the tree's local +x and +z in the world
    float quad = position.z;
    vec3 p; float view0 = 0.0, view1 = 0.0, blend = 0.0, m0 = 1.0, m1 = 1.0;
    vU = vec3(0.0, 1.0, 0.0);
    if (quad < 1.5) {
      #ifdef BILLBOARD
      if (true) {
      #else
      if (d > mix(thin.z, thin.w, r5)) {
      #endif
        if (quad > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // billboard: one quad
        vR = vec3(toCam.y, 0.0, -toCam.x); vF = vec3(toCam.x, 0.0, toCam.y);
        float f = mod((atan(toCam.x, toCam.y) - rot) / 0.78539816, 8.0), k0 = floor(f), k1 = mod(k0 + 1.0, 8.0);
        blend = f - k0;
        view0 = mod(k0, 4.0); m0 = k0 >= 4.0 ? -1.0 : 1.0;   // views 4..7 are 0..3 seen from behind: mirrored
        view1 = mod(k1, 4.0); m1 = k1 >= 4.0 ? -1.0 : 1.0;
      } else {
        vR = quad < 0.5 ? lx : -lz; vF = quad < 0.5 ? lz : lx; view0 = view1 = quad < 0.5 ? 0.0 : 2.0;
      }
    } else {
      vR = lx; vU = -lz; vF = vec3(0.0, 1.0, 0.0); view0 = view1 = ${SIDE_VIEWS.toFixed(1)};
    }
    // Trim the quad to the covered part of its view(s) (a mirrored view's u range is flipped).
    vec4 e0 = vext[ti * ${VIEWS} + int(view0)], e1 = vext[ti * ${VIEWS} + int(view1)];
    vec2 x0 = m0 > 0.0 ? e0.xy : 1.0 - e0.yx, x1 = m1 > 0.0 ? e1.xy : 1.0 - e1.yx;
    vec2 uv = vec2(position.x < 0.0 ? min(x0.x, x1.x) : max(x0.y, x1.y), position.y < 0.5 ? min(e0.z, e1.z) : max(e0.w, e1.w));
    if (quad < 1.5) {
      float hy = y0 + uv.y * H;
      p = base + vR * ((uv.x - 0.5) * W) + vec3(0.0, hy, 0.0);
      p.xz += leanV * max(hy, 0.0);
    } else {
      float cy = fr.w * s * hMul;
      p = base + lx * ((uv.x - 0.5) * W) - lz * ((uv.y - 0.5) * W) + vec3(0.0, cy, 0.0);
      p.xz += leanV * cy;
      fade *= smoothstep(0.1, 0.3, abs(normalize(eye - p).y));   // edge-on from the side: hidden
      if (fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    }
    vUv = vec4(cellUv(iA.y, view0, vec2(m0 > 0.0 ? uv.x : 1.0 - uv.x, uv.y)), cellUv(iA.y, view1, vec2(m1 > 0.0 ? uv.x : 1.0 - uv.x, uv.y)));
    vMirror = vec2(m0, m1); vBlend = blend; vFade = fade;
    // Per tree, not per pixel (a far tree spans a few pixels): cloud shadow on the sun, a stand shadow
    // (a far tree stands for its crown and the shade it casts; none at the hand-over) and the haze,
    // as transmittance T and in-scatter S, the two halves of atmosphereApply(c) = c * T + S.
    vec3 r = base + vec3(0.0, y0 + 0.5 * H, 0.0) - eye;
    vSun = sunLight * cloudShadow(eye + r) * (1.0 - 0.4 * v);
    vSky = 1.0 - 0.15 * v;   // and some of the sky light, to the crowns around it
    vHazeT = atmoTransmittance(r, eye.y); vHazeS = atmoInscatter(r / max(length(r), 1e-3)) * (1.0 - vHazeT);
    vTint = tint[int(hr.w + 0.5)] * (0.93 + 0.14 * r6) * vec3(1.0 + 0.06 * (r7 - 0.5), 1.0, 1.0 - 0.06 * (r7 - 0.5));
    vec4 wp = modelMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const FRAG = /* glsl */`
  uniform sampler2D albedoMap; uniform sampler2D normalMap;
  varying vec4 vUv; varying vec2 vMirror; varying float vBlend; varying vec3 vR; varying vec3 vU; varying vec3 vF;
  varying float vFade; varying vec3 vTint; varying vec3 vSun; varying vec3 vHazeT; varying vec3 vHazeS; varying float vSky;
  uniform vec3 sunDir; uniform vec3 ambientSky; uniform vec3 ambientGround;
  void main() {
    // Gradients first: the normal fetches below run after the discards.
    vec2 dx0 = dFdx(vUv.xy), dy0 = dFdy(vUv.xy), dx1 = dFdx(vUv.zw), dy1 = dFdy(vUv.zw);
    vec4 c = mix(texture2D(albedoMap, vUv.xy), texture2D(albedoMap, vUv.zw), vBlend);
    // Alpha to coverage, sharpened to about one pixel of soft edge at any mip level.
    float a = (c.a - ${ALPHA_REF.toFixed(2)}) / max(fwidth(c.a), 1e-4) + 0.5;
    if (a <= 0.0) discard;
    if (vFade < 1.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vFade) discard;
    vec3 n0 = textureGrad(normalMap, vUv.xy, dx0, dy0).xyz * 2.0 - 1.0, n1 = textureGrad(normalMap, vUv.zw, dx1, dy1).xyz * 2.0 - 1.0;
    n0.x *= vMirror.x; n1.x *= vMirror.y;
    vec3 n = mix(n0, n1, vBlend);
    vec3 N = normalize(vR * n.x + vU * n.y + vF * n.z * (gl_FrontFacing ? 1.0 : -1.0));
    // Same light as the Lambert trees: sun under cloud shadow plus the hemisphere sky light, over pi.
    vec3 irr = vSun * max(dot(N, sunDir), 0.0) + mix(ambientGround, ambientSky, 0.5 + 0.5 * N.y) * vSky;
    vec3 col = c.rgb * vTint * irr * 0.3183099;
    gl_FragColor = vec4(col * vHazeT + vHazeS, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Impostors {
  constructor(tile, scene) {
    const t0 = performance.now();
    this.tile = tile; this.group = new THREE.Group(); scene.add(this.group);
    // Atlas: every species x variant the vegetation uses, from its exact seed.
    const bakeList = [];
    for (const id of SPECIES_IDS) for (let v = 0; v < VARIANTS; v++) bakeList.push({ id, seed: variantSeed(id, v) });
    const bake = bakeImpostors(bakeList);
    this.bake = bake;
    const t1 = performance.now();
    this.buildRecords();
    const t2 = performance.now();

    const NT = bakeList.length, NS = SPECIES_IDS.length;
    this.uniforms = {
      albedoMap: { value: bake.albedo }, normalMap: { value: bake.normal },
      frame: { value: bake.frames.map(f => new THREE.Vector4(f.W, f.H, f.y0, f.capY)) },
      vext: { value: bake.extents.map(e => new THREE.Vector4(...e)) },
      hrange: { value: bake.frames.map(f => new THREE.Vector4(f.hmin / f.height, f.hmax / f.height, f.shrub ? 1 : 0, SPECIES_IDS.indexOf(f.species))) },
      tint: { value: SPECIES_IDS.map(() => new THREE.Vector3(1, 1, 1)) },
      eye: { value: new THREE.Vector3() }, nearRadius: { value: 1500 }, thin: { value: new THREE.Vector4() },
      mid: { value: new THREE.Vector4() }, cells: { value: new THREE.Vector3(tile.habitat.res, tile.size, tile.habitat.img.width) },
      grid: { value: new THREE.Vector2(...bake.grid) },
      ...atmo,
    };
    const material = billboard => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      defines: billboard ? { NT, NS, BILLBOARD: 1 } : { NT, NS }, side: THREE.DoubleSide, alphaToCoverage: true });
    // `position` carries the quad corner and the quad id: the ring mesh has three quads (two side, one
    // cap), the far sectors one (the billboard).
    const quads = n => {
      const pos = [], idx = [];
      for (let q = 0; q < n; q++) { const b = q * 4; pos.push(-0.5, 1, q, 0.5, 1, q, -0.5, 0, q, 0.5, 0, q); idx.push(b, b + 2, b + 1, b + 2, b + 3, b + 1); }
      return [new THREE.Float32BufferAttribute(pos, 3), new THREE.Uint16BufferAttribute(idx, 1)];
    };
    this.shapes = { ring: quads(3), far: quads(1) };
    this.materials = { ring: material(false), far: material(true) };
    this.sectors = [];   // [ring, far sector 0..SECTORS-1]
    for (let k = 0; k <= SECTORS; k++) {
      const kind = k ? 'far' : 'ring', mesh = new THREE.Mesh(this.sectorGeometry(1024, kind), this.materials[kind]);
      mesh.raycast = () => {};   // not pickable (identify.js picks real trees)
      mesh.cap = 1024; mesh.kind = kind; this.group.add(mesh); this.sectors.push(mesh);
    }
    this.R = null; this.center = null; this.count = 0; this.mid = null; this.midVersion = -1;
    this.setSeason(seasonOfDate());
    this.stats = { bakeMs: Math.round(t1 - t0), bakeRenderMs: Math.round(bake.renderMs), recordsMs: Math.round(t2 - t1), atlas: bake.size,
      atlasMB: +(bake.bytes / 1048576).toFixed(1), trees: this.nRecords };
    console.info(`impostors: atlas ${bake.size.join('x')} x2 (${this.stats.atlasMB} MB with mips), ${NT} trees x ${VIEWS} views, baked in ${this.stats.bakeMs} ms; ${this.nRecords.toLocaleString()} plants indexed in ${this.stats.recordsMs} ms`);
  }

  sectorGeometry(cap, kind) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', this.shapes[kind][0]); g.setIndex(this.shapes[kind][1]);
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * STRIDE), STRIDE, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    g.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    g.instanceCount = 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    return g;
  }

  // Every plant vegetation.js would place on the tile, grouped by chunk and sorted by a thinning rank.
  // The per-cell plan (counts, LANDFIRE species mix, savanna oak) and the skips (roads, ponds, stream
  // channels, riparian thinning) are vegetation.js's own cellPlan and placementSkip, and the six draws
  // per plant are taken in Vegetation.update's order, so each record is the tree that replaces it.
  buildRecords() {
    const tile = this.tile, hab = tile.habitat, res = hab.res, size = tile.size, heights = tile.heights;
    const treeIdx = {}; SPECIES_IDS.forEach((id, k) => treeIdx[id] = k * VARIANTS);
    let rec = new Float32Array(400000 * STRIDE), chunkOf = new Int32Array(400000), n = 0;
    const NC = Math.ceil(size / CHUNK); this.NC = NC;
    for (let j = 0; j < hab.img.height; j++) for (let i = 0; i < hab.img.width; i++) {
      const plan = cellPlan(tile, i, j); if (!plan) continue;
      const { rnd, nTrees, nShrubs, treeMix, shrubMix } = plan;
      for (let k = 0; k < nTrees + nShrubs; k++) {
        const isTree = k < nTrees;
        const name = pick(isTree ? treeMix : shrubMix, rnd());
        const variant = Math.floor(rnd() * VARIANTS);
        const px = (i + rnd()) * res, pn = size - (j + rnd()) * res;
        const s = 0.75 + rnd() * 0.5, rot = rnd() * Math.PI * 2;
        if (placementSkip(tile, i, j, k, px, pn, isTree)) continue;
        if (n >= chunkOf.length) { const r2 = new Float32Array(rec.length * 2); r2.set(rec); rec = r2; const c2 = new Int32Array(chunkOf.length * 2); c2.set(chunkOf); chunkOf = c2; }
        const own = mulberry32(hash(i, j, k + 7001) ^ 0x5bd1e995);   // the impostor's own draws, outside the shared stream
        const o = n * STRIDE;
        rec[o] = px; rec[o + 1] = heights.at(px, pn) - 0.3; rec[o + 2] = -pn; rec[o + 3] = rot;
        rec[o + 4] = s; rec[o + 5] = treeIdx[resolveSpecies(name)] + variant; rec[o + 6] = own(); rec[o + 7] = i + j * hab.img.width;
        chunkOf[n] = Math.min(NC - 1, Math.floor(px / CHUNK)) + NC * Math.min(NC - 1, Math.floor(pn / CHUNK));
        n++;
      }
    }
    // Pack by chunk, rank ascending within each chunk, so a rebuild copies a prefix per chunk.
    const counts = new Int32Array(NC * NC + 1);
    for (let q = 0; q < n; q++) counts[chunkOf[q] + 1]++;
    for (let c = 0; c < NC * NC; c++) counts[c + 1] += counts[c];
    const order = new Int32Array(n), fill = counts.slice();
    for (let q = 0; q < n; q++) order[fill[chunkOf[q]]++] = q;
    const packed = new Float32Array(n * STRIDE);
    this.chunks = [];
    for (let c = 0; c < NC * NC; c++) {
      const a = counts[c], b = counts[c + 1];
      const ids = Array.from(order.subarray(a, b)).sort((p, q) => rec[p * STRIDE + 6] - rec[q * STRIDE + 6]);
      let y0 = Infinity, y1 = -Infinity;
      ids.forEach((q, m) => { packed.set(rec.subarray(q * STRIDE, q * STRIDE + STRIDE), (a + m) * STRIDE); y0 = Math.min(y0, rec[q * STRIDE + 1]); y1 = Math.max(y1, rec[q * STRIDE + 1]); });
      if (b > a) this.chunks.push({ start: a, n: b - a, x: ((c % NC) + 0.5) * CHUNK, z: -(Math.floor(c / NC) + 0.5) * CHUNK, y0, y1 });
    }
    this.records = packed; this.nRecords = n;
  }

  keep(d) { const t = this.R + RING; return d < t ? 1 : Math.pow(t / d, THIN_P); }

  // Copy the kept prefix of every chunk that can be visible before the next rebuild into the ring mesh
  // (if any of it can come within the crossed band) or its far sector.
  rebuild(cx, cz) {
    const t0 = performance.now();
    this.center = [cx, cz];
    const R = this.R, hd = CHUNK * Math.SQRT1_2, rec = this.records;
    const lists = Array.from({ length: SECTORS + 1 }, () => ({ parts: [], n: 0, box: new THREE.Box3() }));
    const v = new THREE.Vector3();
    for (const c of this.chunks) {
      const dist = Math.hypot(c.x - cx, c.z - cz), dmin = Math.max(0, dist - hd), dmax = dist + hd;
      // entirely inside the real forest (the mid set, or the eye-based fade without one) until the next rebuild
      if (this.mid ? Math.hypot(c.x - this.mid[0], c.z - this.mid[1]) + hd + 25 < this.mid[2] : dmax + MOVE < R - FADE[0]) continue;
      const kmax = this.keep(Math.max(0, dmin - MOVE));
      let lo = 0, hi = c.n;   // first record with rank >= kmax
      while (lo < hi) { const m = (lo + hi) >> 1; if (rec[(c.start + m) * STRIDE + 6] < kmax) lo = m + 1; else hi = m; }
      if (!lo) continue;
      const k = dmin - MOVE <= R + CROSS[1] ? 0 : 1 + ((Math.floor((Math.atan2(c.z - cz, c.x - cx) / (2 * Math.PI) + 1) * SECTORS) % SECTORS) + SECTORS) % SECTORS;
      const L = lists[k]; L.parts.push(c.start, lo); L.n += lo;
      L.box.expandByPoint(v.set(c.x - CHUNK / 2, c.y0, c.z - CHUNK / 2)).expandByPoint(v.set(c.x + CHUNK / 2, c.y1 + 90, c.z + CHUNK / 2));
    }
    let total = 0;
    lists.forEach((L, k) => {
      const mesh = this.sectors[k];
      if (L.n > mesh.cap) { mesh.geometry.dispose(); mesh.cap = Math.ceil(L.n * 1.3); mesh.geometry = this.sectorGeometry(mesh.cap, mesh.kind); }
      const g = mesh.geometry, buf = g.attributes.iPos.data, arr = buf.array;
      let o = 0;
      for (let p = 0; p < L.parts.length; p += 2) { const a = L.parts[p] * STRIDE, len = L.parts[p + 1] * STRIDE; arr.set(rec.subarray(a, a + len), o); o += len; }
      g.instanceCount = L.n; mesh.visible = L.n > 0;
      if (L.n) { buf.clearUpdateRanges(); buf.addUpdateRange(0, L.n * STRIDE); buf.needsUpdate = true; L.box.expandByScalar(60).getBoundingSphere(g.boundingSphere); }
      total += L.n;
    });
    this.count = total; this.lastRebuildMs = performance.now() - t0;
  }

  // Season colour per species, relative to the baked summer colour (as applySeason does for the real trees).
  setSeason(season) {
    this.season = season;
    SPECIES_IDS.forEach((id, k) => {
      const c = SPECIES[id].foliage.colors, s = c[season] || c.summer;
      // A crown is mostly leaves; a bare deciduous crown keeps its baked shape but goes to bark-grey.
      const on = SPECIES[id].foliage.leaf_on[season] ?? 1;
      const t = s.map((x, i) => srgbToLin(x) / Math.max(1e-4, srgbToLin(c.summer[i])));
      const bark = SPECIES[id].trunk.bark_rgb.map((x, i) => srgbToLin(x) / Math.max(1e-4, srgbToLin(c.summer[i])) * 0.6);
      const wBark = (1 - on) * (1 - on);   // a thinned crown mostly shows its remaining leaves; a bare one, its twigs
      this.uniforms.tint.value[k].set(...t.map((x, i) => x * (1 - wBark) + bark[i] * wBark));
    });
  }

  update(camera, nearRadius) {
    const u = this.uniforms;
    u.eye.value.copy(camera.position);
    let force = false;
    if (nearRadius !== this.R) {
      this.R = nearRadius; force = true;
      u.nearRadius.value = nearRadius; u.thin.value.set(nearRadius + RING, THIN_P, nearRadius + CROSS[0], nearRadius + CROSS[1]);
    }
    if (midSet.center && midSet.version !== this.midVersion) {   // the real forest moved: draw its complement
      this.midVersion = midSet.version; this.mid = [midSet.center[0], midSet.center[1], midSet.radius]; force = true;
      u.mid.value.set(midSet.center[0], midSet.center[1], midSet.radius, 1);
    }
    const x = camera.position.x, z = camera.position.z;
    if (force || !this.center || Math.hypot(x - this.center[0], z - this.center[1]) > MOVE) this.rebuild(x, z);
  }
}
