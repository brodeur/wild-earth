import * as THREE from 'three';
import { mulberry32 } from './trees.js';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { groundUniforms, GROUND_GLSL } from './terrain.js';
import { windUniforms, WIND_GLSL } from './wind.js';

// Clump fields: vegetation seen from the air as many cheap impostors, one camera-facing quad per
// clump, shaded per pixel as an ellipsoid whose normal is rebuilt from the quad position and broken
// into lobes by 3D noise on that normal (stable as the camera turns). Two fields use it:
//
//   ShrubField (chaparral): chamise and manzanita fill each chaparral cell to its canopy shrub
//     cover, so the habitat reads as a closed, mottled grey-green carpet instead of scattered
//     bushes on bare photo (the 3D shrubs in vegetation.js are a few dozen per cell). Chamise:
//     rounded, twiggy, grey-green; manzanita: taller, upswept, darker, red-brown stems under the crown.
//   GrassClumps (grassland, 12-140 m): annual-grass patches (airy, pale seed heads) and purple
//     needlegrass tussocks (dense, bright arching tips), coloured from the ground texture under
//     them, so the sward has relief and silhouettes from the air and hands over to the photo.
//
// Both use the same density LOD ("clump models that change with distance"): past D0 a field thins
// as (D0/d)^2 and the survivors grow by 1/sqrt(keep), so cover is kept while the clumps per screen
// area (and the cost) stay about constant; a grown impostor is drawn with more, smaller lobes, so
// far away it stands for a patch of several plants rather than one swollen plant. Each cell's
// clumps are stored in random order and the CPU submits only the prefix the LOD can keep.
// Placement is deterministic per 30 m habitat cell, cached, generated a few cells per frame.

const STRIDE = 8, REFILL_MOVE = 15;
export const KIND = { chamise: 0, manzanita: 1, annual: 2, bunch: 3 };
const lam = c => -Math.log(1 - Math.min(c, 0.9));   // disc density giving cover c with random placement

const VERT = /* glsl */`
  ${ATMOSPHERE_GLSL}
  ${GROUND_GLSL}
  ${WIND_GLSL}
  uniform vec2 kParams;   // D0, KMIN
  uniform vec4 band;      // fade in from x to y, out from z to w (distance to camera)
  uniform float heightScale;
  attribute vec4 iPos; attribute vec4 iVar;   // root x y z, crown radius | height, seed, kind, rank
  varying vec2 vQ; varying vec3 vRight; varying vec3 vUp; varying vec3 vView;
  varying vec3 vAlbedo; varying vec3 vSun; varying vec3 vAmb; varying vec3 vAmbUp; varying vec3 vT; varying vec3 vIn;
  varying float vSeed; varying float vKind; varying float vLobes; varying float vYS;
  float hh(float n) { return fract(sin(n) * 43758.5453123); }
  void main() {
    float R = iPos.w, H = iVar.x, seed = iVar.y, kind = iVar.z, rank = iVar.w;
    bool grass = kind > 1.5;
    float d = distance(cameraPosition, iPos.xyz);
    float keep = clamp(kParams.x * kParams.x / max(d * d, 1.0), kParams.y, 1.0);
    float s = smoothstep(0.0, 0.05, keep - rank) * smoothstep(band.x, band.y, d) * (1.0 - smoothstep(band.z, band.w, d));
    if (s < 0.01) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    float grow = inversesqrt(keep);
    if (grass) H *= heightScale;
    R *= grow * s; H *= sqrt(grow) * s;
    vec3 C = iPos.xyz + vec3(0.0, H * 0.5, 0.0);
    // Wind: woody shrubs lean a few cm in gusts, grass clumps sway.
    float g = gust(iPos.xz);
    C.xz += windDir * windStrength * g * (grass ? 0.35 : 0.06) * H;
    vec3 V = normalize(cameraPosition - C);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), V) + vec3(1e-4, 0.0, 0.0));
    vec3 up = cross(V, right);
    // Half extents of the ellipsoid (R across, H/2 tall) projected on the quad's axes.
    float ce = up.y, se = sqrt(max(1.0 - ce * ce, 0.0));
    float ev = sqrt(H * H * 0.25 * ce * ce + R * R * se * se);
    vec2 q = position.xy * 1.2;   // a margin for the lobes and twigs
    vec3 p = C + right * q.x * R + up * q.y * ev + V * (0.6 * R);   // pulled toward the camera so the ground does not clip it
    vQ = q; vRight = right; vView = V; vSeed = seed; vKind = kind;
    vUp = up; vYS = R / max(H * 0.5, 0.01);   // sphere normal -> ellipsoid normal: scale its y by R / (H/2)
    vLobes = mix(1.0, 2.6, clamp((grow - 1.0) / 1.5, 0.0, 1.0));   // a far, grown impostor is a patch of plants
    vec3 gw; vec3 gc = groundAlbedo(iPos.xyz, 1.5, gw);
    float gl = dot(gc, G_LUMA);
    vec3 a;
    if (grass) {
      // Grass: the ground's own colour (it is a photo of this grass), tussocks a little darker at
      // heart, annual patches a little paler; brighter where a gust lays the blades over.
      a = gc * (kind > 2.5 ? vec3(0.9, 0.93, 0.95) : vec3(1.05)) * (0.9 + 0.2 * hh(seed * 3.3)) * (1.0 + 0.08 * clamp((g - 0.7) / 0.55, -1.0, 1.0));
    } else {
      // Shrubs: species colour and per-shrub variation, pulled toward the ground photo under it.
      a = kind > 0.5 ? vec3(0.08, 0.108, 0.062) : vec3(0.122, 0.14, 0.085);   // manzanita darker, chamise grey-olive
      a *= mix(vec3(0.92, 1.0, 1.06), vec3(1.08, 1.0, 0.9), hh(seed * 7.1)) * (0.8 + 0.4 * hh(seed * 3.3));
      float al = dot(a, G_LUMA);
      a = mix(a, gc * al / max(gl, 1e-3), 0.2) * mix(1.0, clamp(gl / 0.075, 0.8, 1.25), 0.5);
    }
    vAlbedo = a;
    vSun = sunLight * cloudShadow(C); vAmb = ambientGround; vAmbUp = ambientSky;
    vIn = atmosphereApply(vec3(0.0), C, cameraPosition);
    vT = atmosphereApply(vec3(1.0), C, cameraPosition) - vIn;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */`
  uniform vec3 sunDir; uniform float heads;
  varying vec2 vQ; varying vec3 vRight; varying vec3 vUp; varying vec3 vView;
  varying vec3 vAlbedo; varying vec3 vSun; varying vec3 vAmb; varying vec3 vAmbUp; varying vec3 vT; varying vec3 vIn;
  varying float vSeed; varying float vKind; varying float vLobes; varying float vYS;
  float h3(vec3 p) {
    uvec3 q = uvec3(ivec3(floor(p)) + 4096);
    uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u) ^ (q.z * 2798796415u);
    h = (h ^ (h >> 15)) * 2246822519u; h ^= h >> 13;
    return float(h) * (1.0 / 4294967296.0);
  }
  float n3(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    float kind = vKind;
    bool manz = kind > 0.5 && kind < 1.5, grass = kind > 1.5, bunch = kind > 2.5;
    vec2 q = vQ;
    float r2 = dot(q, q);
    float z = sqrt(max(1.0 - min(r2, 1.0), 0.0));
    // World normal of the ellipsoid point under this pixel; lobes keyed on it stay put on the plant.
    vec3 nW = vRight * q.x + vUp * q.y + vView * z; nW = normalize(vec3(nW.x, nW.y * vYS, nW.z));
    float lobe = n3(nW * 1.6 * vLobes + vSeed * 37.0), twig = n3(nW * 6.0 * vLobes + vSeed * 11.0);
    float rr = sqrt(r2), aa = fwidth(rr) + 1e-3;
    float rb, alpha, lc;
    vec3 col, N;
    if (!grass) {
      // Shrub crown: lobed; manzanita sweeps up (flatter bottom, taller irregular top).
      rb = 0.74 + 0.3 * lobe + 0.12 * (twig - 0.5);
      if (manz) rb += 0.12 * smoothstep(0.0, 0.8, q.y) * (lobe - 0.4) - 0.08 * smoothstep(-0.2, -0.9, q.y);
      alpha = clamp((rb - rr) / aa + 0.5, 0.0, 1.0);
      // Twiggy fringe: the outer band broken into stems and gaps (more on chamise).
      float fringe = smoothstep(rb - 0.25, rb, rr);
      if (fringe > 0.0) alpha *= 1.0 - fringe * smoothstep(manz ? 0.55 : 0.45, manz ? 0.7 : 0.6, n3(nW * 14.0 * vLobes + vSeed * 3.0));
      if (alpha < 0.05) discard;
      // Leaf clusters: brighter sunlit clumps over dark holes into the crown.
      lc = n3(nW * 4.0 * vLobes + vSeed * 5.0) * 0.6 + twig * 0.4;
      // Close up, a crown is many small leaf sprays: a fine octave, only where it is resolved.
      float close = 1.0 - smoothstep(0.01, 0.03, aa);
      if (close > 0.0) lc = mix(lc, lc * 0.6 + 0.55 * n3(nW * 22.0 + vSeed * 7.0), close);
      N = normalize(nW + (vec3(lobe, 0.5, twig) - 0.5) * 0.9);
      col = vAlbedo * (0.6 + 0.8 * lc);
      if (manz) {   // red-brown stems where the view looks in under the crown
        float stem = step(0.8, h2(floor(vec2(q.x * 7.0 + vSeed * 3.0, 1.0)))) * smoothstep(0.0, -0.6, q.y) * smoothstep(0.3, -0.2, nW.y);
        col = mix(col, vec3(0.16, 0.05, 0.03), stem * 0.55 * (1.0 - lc * 0.6));
      }
    } else {
      // Grass clump: a soft-edged dome of blades. Seen from above, a tussock is a fountain: dark
      // at the crown, bright where the arching tips catch the light at the rim; an annual patch is
      // airy (ground shows through) and speckled with pale seed heads.
      float ang = atan(q.y, q.x);
      float star = abs(sin(ang * (bunch ? 5.5 : 3.5) + vSeed));
      rb = (bunch ? 0.74 : 0.7) + 0.2 * lobe + 0.08 * star;
      alpha = smoothstep(rb, rb - max(0.18, aa), rr);   // soft: a tussock has no hard outline
      float fine = n3(nW * 9.0 * vLobes + vSeed * 3.0);
      alpha *= bunch ? 1.0 - smoothstep(0.55, 0.75, rr / rb) * step(fine, 0.42)
                     : smoothstep(0.3, 0.45, fine + 0.25 * (1.0 - rr / rb));
      if (alpha < 0.05) discard;
      lc = fine;
      N = normalize(nW * 0.5 + vec3(0.0, 1.0, 0.0));   // lit nearly like the ground it grows from, so it adds texture, not dark dots
      col = vAlbedo * (bunch ? mix(0.84, 1.1, smoothstep(0.2, 0.9, rr / rb)) * (0.9 + 0.2 * fine) : 0.85 + 0.3 * lobe);
      if (!bunch) col = mix(col, vAlbedo * 1.45, heads * smoothstep(0.72, 0.85, twig) * 0.8);   // seed heads
    }
    float diff = max(dot(N, sunDir), 0.0);
    float ao = mix(grass ? 0.75 : 0.6, 1.0, smoothstep(-0.7, 0.6, nW.y)) * mix(grass ? 0.85 : 0.75, 1.0, lc);
    vec3 light = vSun * diff * mix(0.75, 1.0, lc) + mix(vAmb, vAmbUp, 0.5 + 0.5 * N.y) * ao;
    gl_FragColor = vec4((col * light * 0.3183099) * vT + vIn, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function hash2(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// A clump field. cfg:
//   cellAny(i, j)    may this cell hold clumps (cheap test, also used to skip empty ground)
//   coverAt(x, n)    target cover 0..coverMax at a point
//   coverMax         the most cover anywhere (sets the candidates per cell)
//   meanArea         mean crown area, m^2
//   plant(x, n, rnd, cover) -> [kind, R, H]
//   D0, KMIN         LOD: full density to D0, then keep (D0/d)^2, never below KMIN
//   band             [in0, in1, out0, out1] distance fades; range is out1
//   now              cells nearer than this are generated at once, the rest a couple of ms per frame
//   cap, salt, roadsMax
export class ClumpField {
  constructor(tile, ground, uniforms, cfg) {
    this.tile = tile; this.ground = ground; this.cfg = cfg;
    this.cache = new Map(); this.cells = []; this.last = null; this.sig = NaN; this.n = 0;
    this.W = tile.habitat.img.width; this.H = tile.habitat.img.height;
    this.lamMax = lam(cfg.coverMax);
    this.uniforms = { ...groundUniforms, ...windUniforms, ...atmo, heightScale: uniforms.heightScale, heads: uniforms.heads,
      kParams: { value: new THREE.Vector2(cfg.D0, cfg.KMIN) }, band: { value: new THREE.Vector4(...cfg.band) } };
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cfg.cap * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    g.setAttribute('iVar', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, alphaToCoverage: true });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.name = cfg.name;
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._sph = new THREE.Sphere();
  }
  get count() { return this.n; }

  // Clumps of one cell in random order (any prefix is an even subsample), with a bounding sphere.
  cellData(i, j) {
    const key = j * this.W + i, cfg = this.cfg;
    let c = this.cache.get(key);
    if (c) return c;
    const { habitat: hab, size, roads } = this.tile, res = hab.res, out = [];
    if (cfg.cellAny(i, j)) {
      const n = Math.round(this.lamMax * res * res / cfg.meanArea), rnd = mulberry32((i * 73856093) ^ (j * 19349663) ^ cfg.salt);
      for (let k = 0; k < n; k++) {
        const px = (i + rnd()) * res, pn = size - (j + rnd()) * res, keep = rnd();
        const cov = cfg.coverAt(px, pn);
        if (cov <= 0 || keep * this.lamMax >= lam(cov)) { rnd(); rnd(); rnd(); rnd(); continue; }
        if (roads && roads.at(px, pn) > cfg.roadsMax) { rnd(); rnd(); rnd(); rnd(); continue; }
        const [kind, R, Hh] = cfg.plant(px, pn, rnd, cov);
        out.push(px, this.ground(px, pn), -pn, R, Hh, rnd() * 100, kind, 0);
      }
      const m = out.length / STRIDE;
      for (let k = 0; k < m; k++) out[k * STRIDE + 7] = (k + 0.5) / m;   // rank: the order is already random
    }
    c = { data: new Float32Array(out), n: out.length / STRIDE, x: (i + 0.5) * res, y: 0, z: -(size - (j + 0.5) * res), r: res };
    if (out.length) {
      let y0 = Infinity, y1 = -Infinity, hm = 0;
      for (let o = 0; o < out.length; o += STRIDE) { y0 = Math.min(y0, out[o + 1]); y1 = Math.max(y1, out[o + 1]); hm = Math.max(hm, out[o + 4]); }
      c.y = (y0 + y1) / 2 + hm; c.r = Math.hypot(res * 0.71 + 3, (y1 - y0) / 2 + 2 * hm);
    }
    if (this.cache.size > 3000) this.cache.clear();
    this.cache.set(key, c);
    return c;
  }

  // Cells within range that may hold clumps, nearest first.
  gather(x, north) {
    const res = this.tile.habitat.res, size = this.tile.size, r = this.cfg.band[3], cells = [];
    const i0 = Math.max(0, Math.floor((x - r) / res)), i1 = Math.min(this.W - 1, Math.floor((x + r) / res));
    const j0 = Math.max(0, Math.floor((size - north - r) / res)), j1 = Math.min(this.H - 1, Math.floor((size - north + r) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!this.cfg.cellAny(i, j)) continue;
      const d = Math.hypot((i + 0.5) * res - x, size - (j + 0.5) * res - north);
      if (d <= r + res * 0.71) cells.push([d, i, j]);
    }
    this.cells = cells.sort((a, b) => a[0] - b[0]);
  }

  // band: optional [in0, in1, out0, out1] override for this frame.
  update(camera, on = true, band = null) {
    if (band) this.uniforms.band.value.set(...band);
    if (this.enabled === false || !on) { this.mesh.visible = false; return; }
    const cp = camera.position, north = -cp.z, cfg = this.cfg;
    if (!this.last || Math.hypot(cp.x - this.last[0], north - this.last[1]) > REFILL_MOVE) { this.last = [cp.x, north]; this.gather(cp.x, north); this.sig = NaN; }
    if (!this.cells.length) { this.mesh.visible = false; this.n = 0; return; }
    const t0 = performance.now();
    for (const [d, i, j] of this.cells) {
      if (this.cache.has(j * this.W + i)) continue;
      if (d > cfg.now && performance.now() - t0 > 2) break;
      this.cellData(i, j); this.sig = NaN;
    }
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const sph = this._sph, arr = this.buf.array, pick = [], D2 = cfg.D0 * cfg.D0;
    let sig = 0, total = 0;
    for (const [, i, j] of this.cells) {
      const c = this.cache.get(j * this.W + i);
      if (!c || !c.n) continue;
      const dc = Math.hypot(c.x - cp.x, c.y - cp.y, c.z - cp.z);
      if (dc - c.r > cfg.band[3] || dc + c.r < cfg.band[0]) continue;
      sph.center.set(c.x, c.y, c.z); sph.radius = c.r;
      if (!this._frustum.intersectsSphere(sph)) continue;
      const d = Math.max(dc - c.r, 1), keep = Math.min(Math.max(D2 / (d * d), cfg.KMIN), 1);
      const m = Math.min(c.n, Math.ceil(c.n * (keep + 0.06)));
      if (total + m > cfg.cap) break;
      pick.push(c, m); total += m; sig = (Math.imul(sig, 31) + j * this.W + i + m * 7919) | 0;
    }
    if (sig !== this.sig) {
      this.sig = sig; let n = 0;
      for (let k = 0; k < pick.length; k += 2) { const c = pick[k], m = pick[k + 1]; arr.set(c.data.subarray(0, m * STRIDE), n * STRIDE); n += m; }
      this.n = n; this.mesh.geometry.instanceCount = n;
      this.buf.clearUpdateRanges(); this.buf.addUpdateRange(0, Math.max(n, 1) * STRIDE); this.buf.needsUpdate = true;
    }
    this.mesh.visible = this.n > 0;
  }
}

// Chaparral shrubs. Cover per cell: chaparral cells only, the canopy's shrub % (floored: a low value
// in a chaparral cell is more often a burn scar or a data gap than open ground), bilinear between
// cell centres so a stand thins out over a cell instead of stopping at a 30 m square.
export function ShrubField(tile, ground, uniforms) {
  const hab = tile.habitat, can = tile.canopy, W = hab.img.width, H = hab.img.height, res = hab.res;
  const cover = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++)
    if (hab.channel(i, j, 0) === 4) cover[j * W + i] = Math.min(Math.max(can.channel(i, j, 1) / 100, 0.3), 0.85);
  const coverAt = bilinear(cover, W, H, res, tile.size);
  return new ClumpField(tile, ground, uniforms, {
    name: 'shrubfield', salt: 0x5eed, cap: 140000, roadsMax: 60,
    cellAny: anyAround(cover, W, H), coverAt, coverMax: 0.85,
    meanArea: 0.6 * Math.PI * 0.8 ** 2 + 0.4 * Math.PI * 1.1 ** 2,
    D0: 115, KMIN: 0.12, band: [3, 8, 370, 430], now: 140,   // gone only right at the camera (the 3D shrubs are there)
    plant(px, pn, rnd, cov) {
      // Stands: manzanita and chamise clump into patches tens of metres across (~40% manzanita).
      const manz = rnd() < 0.1 + 0.75 * smooth(0.35, 0.75, vnoise(px / 45, pn / 45, 9));
      const r = manz ? [0.7, 1.5] : [0.5, 1.1], h = manz ? [1.05, 1.45] : [0.95, 1.25];   // crown radius, height over diameter
      const R = (r[0] + (r[1] - r[0]) * rnd()) * (0.8 + 0.3 * cov);   // denser stands, bigger crowns
      return [manz ? KIND.manzanita : KIND.chamise, R, 2 * R * (h[0] + (h[1] - h[0]) * rnd())];
    },
  });
}

// Grass clumps for the 12-140 m band. density(x, n): the sward density the blades are placed with;
// annual(i, j): the annual share of the cell's grass.
export function GrassClumps(tile, ground, uniforms, densGrid, density, annualShare) {
  const W = tile.habitat.img.width, H = tile.habitat.img.height;
  return new ClumpField(tile, ground, uniforms, {
    name: 'grassclumps', salt: 0x6a55, cap: 60000, roadsMax: 140,
    // Tussocks only: annual grass is a continuous sward (the shells and the terrain grain carry it);
    // drawn as discrete clumps it reads as cotton balls from the air.
    cellAny: anyAround(densGrid, W, H), coverAt: (x, n) => 0.6 * density(x, n) * (1 - annualShare(x, n)), coverMax: 0.45,
    meanArea: Math.PI * 0.27 ** 2,
    D0: 26, KMIN: 0.35, band: [12, 20, 90, 120], now: 60,
    plant(px, pn, rnd, cov) {
      const R = 0.2 + 0.14 * rnd();
      return [KIND.bunch, R * (0.85 + 0.4 * cov), 2 * R * (1.0 + 0.4 * rnd())];
    },
  });
}

function anyAround(grid, W, H) {
  return (i, j) => {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < W && b < H && grid[b * W + a] > 0) return true;
    }
    return false;
  };
}
function bilinear(grid, W, H, res, size) {
  return (x, north) => {
    const u = x / res - 0.5, v = (size - north) / res - 0.5, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, H1 = H - 1;
    const i0 = Math.min(Math.max(i, 0), W - 1), i1 = Math.min(Math.max(i + 1, 0), W - 1);
    const r0 = Math.min(Math.max(j, 0), H1) * W, r1 = Math.min(Math.max(j + 1, 0), H1) * W;
    return (grid[r0 + i0] * (1 - fx) + grid[r0 + i1] * fx) * (1 - fy) + (grid[r1 + i0] * (1 - fx) + grid[r1 + i1] * fx) * fy;
  };
}
