import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { windUniforms, WIND_GLSL } from './wind.js';
import { groundUniforms, GROUND_GLSL } from './terrain.js';
import { SPECIES, SPECIES_IDS, mulberry32 } from './trees.js';
import { seasonMonth } from './treegen.js';
import { SEASON_LOOK } from './season.js';

// The emergents (2026-10-29; Aaron: "make sure there are plenty of riparian plant species ... cattail"): the library's
// records of form "emergent" (cattail, tule, bulrush, the sedges, rush, horsetail; docs/species-library.md), the tall
// wetland monocots that stand in the water and on the wet margins. Each plant is a clump drawn as two crossed
// alpha-tested quads textured from a picture of the species baked here at load with canvas 2D from its record's
// `ground` block (habit, palette by season, heads and their months, clump width, stems, height_by_month): a cattail
// is a fan of flat blades to 2.5 m with brown sausage heads from July, a tule a sheaf of round stems with a tassel,
// a sedge an arching tussock, a rush a stiff one, a horsetail a few jointed stems. Nothing is downloaded.
//
// Placement follows the water system (tile.water, pipeline/water.py; docs/tile-spec.md "Water and riparian"): per
// 30 m cell, candidate k of N is a pure function of (cell, k), kept where it falls on a channel bed (zone 1), a wet
// margin (2), a pond's margin (6) or shore (7) and drawn as a species from that zone's row (SpeciesMix.ripRow: the
// records' habitat.riparian zones, orders and permanence; so cattail and tule stand in the slow water of the bigger
// creeks and the pond shallows, torrent sedge on the rocks of the channel, rushes and sedges along the margins) in
// stands (a patch noise per species), at a density per zone (DENSITY) times the row's. They stand on the carved bed
// (tile.heights.at), so a cattail bed is in the water when the creek runs and on the mud when it dries. Range
// RANGE m with a dithered fade; density LOD by rank from D0. A month change rebakes the atlas.
//
// For the field guide and the animals: pick(ray), nearest(x, z, r), speciesAround(x, z, r) as forbs.js.
const RANGE = 120, FADE = [90, 120], D0 = 35, KMIN = 0.3, REFILL = 15, CAP = 20000, PER_M2 = 0.35, STRIDE = 8;
const T = 256, GS_MAX = 8;
const DENSITY = [0, 0.5, 0.7, 0, 0, 0, 0.9, 0.5, 0];   // by zone: channel, margin, ..., pond margin, pond shore
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
function hash2(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const U = new Float64Array(8);
function draw(i, j, k) {   // candidate k of cell (i, j): eight uniforms, a pure function of (i, j, k)
  let a = (Math.imul(i, 73428767) ^ Math.imul(j, 912367) ^ Math.imul(k + 1, 0x9E3779B1) ^ 0x3c6ef372) | 0;
  for (let m = 0; m < 8; m++) {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    U[m] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export const EMERGENT_SPECIES = SPECIES_IDS.filter(id => SPECIES[id].form === 'emergent').slice(0, GS_MAX).map((id, k) => {
  const s = SPECIES[id], g = s.ground || {}, H = s.height_m || [0.5, 1.5];
  const hbm = (g.height_by_month && g.height_by_month.length === 12) ? g.height_by_month : new Array(12).fill(1);
  return { id, k, common: s.common, habit: g.habit || 'sedge', palette: g.palette || {}, heads: g.heads || { shape: 'none', months: [0, 0] },
    clump: g.clump_m || 0.6, stems: g.stems || 20, hbm, density: g.density ?? 1, boxH: H[1], boxW: Math.max(g.clump_m || 0.6, H[1] * 0.5) };
});

// The clump's state in a month: h its height (0..1 of boxH), whether the heads show, the season's palette.
export function emergentState(F, month, season) {
  const m = Math.min(11, Math.max(0, Math.floor(month - 1))), h = F.hbm[m], hd = F.heads, [a, b] = hd.months || [0, 0];
  const heads = hd.shape !== 'none' && (a <= b ? m + 1 >= a && m + 1 <= b : m + 1 >= a || m + 1 <= b) && h > 0;
  const pal = F.palette[season] || F.palette.summer || { root: [90, 110, 70], tip: [120, 140, 80], head: [100, 70, 50] };
  return { h, heads, pal };
}

// ---- the pictures (canvas 2D): one clump, side view ----------------------------------------------------------------
const css = (rgb, k = 1, a = 1) => `rgba(${Math.min(255, rgb[0] * k) | 0},${Math.min(255, rgb[1] * k) | 0},${Math.min(255, rgb[2] * k) | 0},${a})`;
function drawTile(g, F, st, cx, cy) {
  g.save(); g.beginPath(); g.rect(cx, cy, T, T); g.clip(); g.clearRect(cx, cy, T, T);
  if (st.h <= 0) { g.restore(); return; }
  const rnd = mulberry32(2000 + F.k * 13), ppm = T / Math.max(F.boxW, F.boxH);
  const H = F.boxH * st.h * ppm, W = F.clump * ppm, x0 = cx + T / 2, y0 = cy + T - 2, pal = st.pal, hb = F.habit;
  const n = Math.min(90, F.stems);
  const grad = (x1, y1, x2, y2, k) => { const gr = g.createLinearGradient(x1, y1, x2, y2); gr.addColorStop(0, css(pal.root, k)); gr.addColorStop(1, css(pal.tip, k)); return gr; };
  g.lineCap = 'round';
  for (let q = 0; q < n; q++) {
    const u = (q + 0.5) / n, k = 0.8 + 0.4 * rnd(), xb = x0 + (u - 0.5) * W * (0.3 + 0.7 * rnd());
    const hh = H * (0.6 + 0.4 * rnd());
    if (hb === 'cattail') {   // flat blades fanning from the base, the outer ones leaning further out
      const lean = (u - 0.5) * 2 * (0.25 + 0.3 * rnd()), xt = xb + lean * hh * 0.5;
      g.lineWidth = Math.max(1.5, 0.022 * ppm); g.strokeStyle = grad(xb, y0, xt, y0 - hh, k);
      g.beginPath(); g.moveTo(xb, y0); g.quadraticCurveTo(xb + lean * hh * 0.15, y0 - hh * 0.55, xt, y0 - hh); g.stroke();
    } else if (hb === 'tule') {   // round stems, nearly upright, a few bent
      const lean = (rnd() - 0.5) * 0.35, xt = xb + lean * hh;
      g.lineWidth = Math.max(1.5, 0.012 * ppm); g.strokeStyle = grad(xb, y0, xt, y0 - hh, k);
      g.beginPath(); g.moveTo(xb, y0); g.quadraticCurveTo(xb + lean * hh * 0.4, y0 - hh * 0.5, xt, y0 - hh); g.stroke();
    } else if (hb === 'rush') {   // stiff round stems in a dense tussock, splaying a little
      const lean = (u - 0.5) * 2 * (0.15 + 0.25 * rnd()), xt = xb + lean * hh * 0.6;
      g.lineWidth = Math.max(1.2, 0.008 * ppm); g.strokeStyle = grad(xb, y0, xt, y0 - hh, k);
      g.beginPath(); g.moveTo(xb, y0); g.lineTo(xt, y0 - hh); g.stroke();
    } else if (hb === 'horsetail') {   // jointed upright stems with dark bands
      const lean = (rnd() - 0.5) * 0.2, xt = xb + lean * hh;
      g.lineWidth = Math.max(1.5, 0.01 * ppm); g.strokeStyle = css(pal.tip, k);
      g.beginPath(); g.moveTo(xb, y0); g.lineTo(xt, y0 - hh); g.stroke();
      g.strokeStyle = css(pal.root, 0.45); g.lineWidth = Math.max(1, 0.012 * ppm);
      const nj = 5 + Math.floor(rnd() * 5);
      for (let jj = 1; jj < nj; jj++) { const t = jj / nj; g.beginPath(); g.moveTo(xb + (xt - xb) * t - 1, y0 - hh * t); g.lineTo(xb + (xt - xb) * t + 1, y0 - hh * t); g.stroke(); }
    } else {   // sedge: an arching tussock, the blades curving over and down at the tips
      const lean = (u - 0.5) * 2 * (0.5 + 0.5 * rnd()), hh2 = hh * (0.7 + 0.3 * rnd());
      const xt = xb + lean * hh2 * 0.9, yt = y0 - hh2 * (0.55 + 0.25 * (1 - Math.abs(lean)));
      g.lineWidth = Math.max(1.2, 0.01 * ppm); g.strokeStyle = grad(xb, y0, xt, yt, k);
      g.beginPath(); g.moveTo(xb, y0); g.quadraticCurveTo(xb + lean * hh2 * 0.25, y0 - hh2 * 0.95, xt, yt); g.stroke();
    }
  }
  if (st.heads) {   // the heads: on the taller stems
    const sh = F.heads.shape, nh = Math.max(1, Math.round(n * (sh === 'cattail' ? 0.18 : sh === 'tassel' ? 0.4 : 0.5)));
    for (let q = 0; q < nh; q++) {
      const u = rnd(), xb = x0 + (u - 0.5) * W * 0.5, hh = H * (0.85 + 0.15 * rnd()), xt = xb + (u - 0.5) * hh * 0.3, yt = y0 - hh;
      g.fillStyle = css(pal.head, 0.85 + 0.3 * rnd()); g.strokeStyle = g.fillStyle;
      if (sh === 'cattail') { const L = Math.max(8, 0.18 * ppm), w = Math.max(3, 0.025 * ppm); g.beginPath(); g.ellipse(xt, yt + L * 0.9, w, L, 0, 0, Math.PI * 2); g.fill();
        g.lineWidth = 1.5; g.strokeStyle = css(pal.tip, 0.9); g.beginPath(); g.moveTo(xt, yt + L * 0.9); g.lineTo(xt, yt - L * 0.1); g.stroke(); }
      else if (sh === 'tassel') { g.lineWidth = Math.max(1, 0.006 * ppm); for (let t = 0; t < 4; t++) { const a = -0.3 + 0.6 * rnd(); g.beginPath(); g.moveTo(xt, yt + hh * 0.08); g.quadraticCurveTo(xt + a * 0.12 * ppm, yt + hh * 0.12, xt + a * 0.18 * ppm, yt + hh * 0.2); g.stroke();
        g.beginPath(); g.arc(xt + a * 0.18 * ppm, yt + hh * 0.2, Math.max(1.5, 0.012 * ppm), 0, Math.PI * 2); g.fill(); } }
      else if (sh === 'cluster') { for (let t = 0; t < 5; t++) { g.beginPath(); g.arc(xt + (rnd() - 0.5) * 0.05 * ppm, yt + hh * (0.12 + 0.08 * rnd()), Math.max(1.5, 0.01 * ppm), 0, Math.PI * 2); g.fill(); } }
      else { g.lineWidth = Math.max(2, 0.02 * ppm); g.beginPath(); g.moveTo(xt, yt + 0.02 * ppm); g.lineTo(xt + 0.01 * ppm, yt - 0.06 * ppm); g.stroke(); }   // spike
    }
  }
  g.restore();
}

// ---- GLSL ------------------------------------------------------------------------------------------------------------
const VERT = /* glsl */`
  ${WIND_GLSL}
  ${GROUND_GLSL}
  ${ATMOSPHERE_GLSL}
  uniform vec2 fade; uniform vec2 kParams; uniform vec4 spBox[${GS_MAX}];   // per species: box w, box h, height this month, 0
  uniform float emOn;
  attribute vec4 iPos; attribute vec4 iVar;   // root x y z, scale | species, seed, yaw, rank
  attribute float aQuad;
  varying vec2 vUv; varying vec3 vSun; varying vec3 vAmb; varying vec3 vT; varying vec3 vIn; varying float vFade; varying float vDiff;
  void main() {
    int sp = int(iVar.x + 0.5); vec4 B = spBox[sp];
    float d = distance(cameraPosition, iPos.xyz);
    float keep = clamp(kParams.x * kParams.x / max(d * d, 1.0), kParams.y, 1.0);
    float s = step(iVar.w, keep) * (1.0 - smoothstep(fade.x, fade.y, d)) * emOn;
    if (s < 0.01 || B.z <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    float sc = iPos.w, yaw = iVar.z + aQuad * 1.5707963;
    float c = cos(yaw), sn = sin(yaw);
    vec2 q = vec2(position.x * B.x, uv.y * B.y) * sc;
    vec3 p = iPos.xyz + vec3(q.x * c, q.y, -q.x * sn);
    float t = uv.y;
    p.xz += windDir * windStrength * gust(iPos.xz) * t * t * 0.22 * B.y * sc;   // the tops sway with the gusts
    vUv = vec2(uv.x, (uv.y + float(sp)) / ${GS_MAX}.0);
    vFade = s;
    vec3 V = normalize(cameraPosition - iPos.xyz);
    vec3 Nb = normalize(vec3(V.x, 0.0, V.z) + vec3(1e-4, 0.0, 0.0));
    vDiff = max(dot(normalize(Nb + vec3(0.0, 1.0, 0.0)), sunDir), 0.0);
    vSun = sunLight * cloudShadow(iPos.xyz);
    float occ = groundSkyOcclusion(groundUv(iPos.xyz)) * groundContactAO(iPos.xyz);
    vAmb = mix(ambientGround, ambientSky, 0.6) * occ;
    vIn = atmosphereApply(vec3(0.0), iPos.xyz, cameraPosition);
    vT = atmosphereApply(vec3(1.0), iPos.xyz, cameraPosition) - vIn;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform sampler2D atlas; uniform vec3 wxGround;
  varying vec2 vUv; varying vec3 vSun; varying vec3 vAmb; varying vec3 vT; varying vec3 vIn; varying float vFade; varying float vDiff;
  void main() {
    if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vFade) discard;
    vec4 t = texture2D(atlas, vUv);
    if (t.a < 0.35) discard;
    vec3 alb = pow(t.rgb, vec3(2.2));
    alb = mix(alb, vec3(0.7, 0.73, 0.78), wxGround.z * 0.5);
    vec3 col = (alb * (vSun * (0.45 + 0.55 * vDiff) + vAmb) + alb * alb * vSun * 0.12) * 0.3183099;
    gl_FragColor = vec4(col * vT + vIn, t.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Emergents {
  constructor(tile, scene) {
    this.tile = tile; this.scene = scene;
    this.cache = new Map(); this.last = null; this.month = -1; this.season = 'summer'; this.states = [];
    this.enabled = !!(tile.water && tile.speciesMix?.rip?.size && EMERGENT_SPECIES.length);
    this.uniforms = { ...windUniforms, ...groundUniforms, ...atmo, atlas: { value: null }, fade: { value: new THREE.Vector2(...FADE) },
      kParams: { value: new THREE.Vector2(D0, KMIN) }, spBox: { value: EMERGENT_SPECIES.map(F => new THREE.Vector4(F.boxW, F.boxH, 0, 0)).concat(Array.from({ length: GS_MAX - EMERGENT_SPECIES.length }, () => new THREE.Vector4())) },
      emOn: { value: 1 } };
    const g = new THREE.InstancedBufferGeometry(), pos = [], uv = [], quad = [], idx = [];
    for (let q = 0; q < 2; q++) {
      const b = pos.length / 3;
      pos.push(-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0); uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      quad.push(q, q, q, q); idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aQuad', new THREE.Float32BufferAttribute(quad, 1)); g.setIndex(idx);
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(CAP * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buf, 4, 0)); g.setAttribute('iVar', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    g.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.DoubleSide, alphaToCoverage: true });
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.name = 'emergents'; this.mesh.renderOrder = 2;
    this.group = new THREE.Group(); this.group.name = 'emergents'; this.group.add(this.mesh); scene.add(this.group);
    this.n = 0; this.staged = []; this.on = true; this.mixCache = new Map();
    this.W = tile.habitat.img.width; this.Hh = tile.habitat.img.height;
  }
  // The emergents of a zone row this month: cumulative weights over EMERGENT_SPECIES from the row's ground layer.
  zoneMix(row) {
    const key = row.key; let m = this.mixCache.get(key); if (m) return m;
    const cum = []; let acc = 0;
    for (const F of EMERGENT_SPECIES) {
      const st = this.states[F.k]; if (!st || st.h <= 0) continue;
      const w = (row.ground[F.id] || 0) * F.density; if (w <= 0) continue;
      acc += w; cum.push([F.k, acc]);
    }
    m = { cum, total: acc }; this.mixCache.set(key, m); return m;
  }
  cellData(i, j) {
    const key = j * this.W + i;
    let c = this.cache.get(key); if (c) return c;
    const { habitat: hab, size, water: WG, speciesMix: SM, heights } = this.tile, res = hab.res, out = [];
    const [, wet] = WG.cellShare(i, j, res), shore = wet > 0 || WG.cellShare(i, j, res)[0] > 0;
    const N = Math.round(res * res * PER_M2);
    if (shore) for (let k = 0; k < N; k++) {
      draw(i, j, k);
      const px = (i + U[0]) * res, pn = size - (j + U[1]) * res;
      const z = WG.info(px, pn), dz = DENSITY[z.zone]; if (!dz) continue;
      const row = SM.ripRow(z); if (!row) continue;
      const mix = this.zoneMix(row); if (mix.total <= 0) continue;
      let sp = mix.cum[0][0]; const r = U[2] * mix.total; for (const [kk, a] of mix.cum) { sp = kk; if (r <= a) break; }
      const F = EMERGENT_SPECIES[sp];
      // stands: a patch noise per species, so a cattail bed is a bed and a sedge margin is a strip
      const patch = 0.1 + 0.9 * smooth(0.4, 0.7, 0.6 * vnoise(px / 9, pn / 9, 600 + sp) + 0.4 * vnoise(px / 3, pn / 3, 700 + sp));
      if (U[3] >= dz * row.density[2] * patch) continue;
      const sc = 0.75 + 0.5 * U[4];
      out.push(px, heights.at(px, pn) - 0.02, -pn, sc, sp, U[5], U[6] * Math.PI * 2, (k + 0.5) / N);
    }
    const arr = new Float32Array(out);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let o = 0; o < arr.length; o += STRIDE) { x0 = Math.min(x0, arr[o]); x1 = Math.max(x1, arr[o]); y0 = Math.min(y0, arr[o + 1]); y1 = Math.max(y1, arr[o + 1]); z0 = Math.min(z0, arr[o + 2]); z1 = Math.max(z1, arr[o + 2]); }
    c = arr.length ? { arr, x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 1, z: (z0 + z1) / 2, r: Math.hypot((x1 - x0) / 2 + 1, (y1 - y0) / 2 + 1, (z1 - z0) / 2 + 1) } : { arr, x: 0, y: 0, z: 0, r: 0 };
    if (this.cache.size > 400) this.cache.clear();
    this.cache.set(key, c); return c;
  }
  bake(month, season) {
    this.month = month; this.states = EMERGENT_SPECIES.map(F => emergentState(F, month, season));
    const c = this.canvas || (this.canvas = document.createElement('canvas')); c.width = T; c.height = GS_MAX * T;
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    EMERGENT_SPECIES.forEach(F => { const st = this.states[F.k]; drawTile(g, F, st, 0, F.k * T); this.uniforms.spBox.value[F.k].set(F.boxW, F.boxH, st.h, 0); });
    if (!this.atlas) { this.atlas = new THREE.CanvasTexture(c); this.atlas.colorSpace = THREE.SRGBColorSpace; this.atlas.generateMipmaps = true; this.atlas.minFilter = THREE.LinearMipmapLinearFilter; this.atlas.anisotropy = 4; this.uniforms.atlas.value = this.atlas; }
    this.atlas.needsUpdate = true;
    this.cache.clear(); this.mixCache.clear(); this.last = null;
  }
  setLook(look) {
    const season = Object.keys(SEASON_LOOK).find(k => SEASON_LOOK[k] === look) || 'summer', month = seasonMonth(season);
    if (Math.abs(month - this.month) > 0.6 || season !== this.season) { this.season = season; this.bake(month, season); }
  }
  fill(x, north) {
    const res = this.tile.habitat.res, size = this.tile.size, place = RANGE + REFILL + 1, buf = this.buf.array; let n = 0;
    this.staged.length = 0;
    const i0 = Math.max(0, Math.floor((x - place) / res)), i1 = Math.min(this.W - 1, Math.floor((x + place) / res));
    const j0 = Math.max(0, Math.floor((size - north - place) / res)), j1 = Math.min(this.Hh - 1, Math.floor((size - north + place) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * res, cn = size - (j + 0.5) * res; if (Math.hypot(cx - x, cn - north) > place + res * 0.71) continue;
      const c = this.cellData(i, j), m = c.arr.length / STRIDE; if (!m || n + m > CAP) continue;
      buf.set(c.arr, n * STRIDE); this.staged.push({ start: n, count: m, x: c.x, y: c.y, z: c.z, r: c.r, arr: c.arr }); n += m;
    }
    this.n = n; this.mesh.geometry.instanceCount = n;
    this.buf.clearUpdateRanges(); this.buf.addUpdateRange(0, Math.max(n, 1) * STRIDE); this.buf.needsUpdate = true;
  }
  update(camera, look) {
    if (!this.enabled) return;
    if (look) this.setLook(look);
    if (!this.atlas) return;
    const cp = camera.position, north = -cp.z, agl = cp.y - this.tile.heights.at(cp.x, north);
    const on = this.on && agl < RANGE + 60;
    this.uniforms.emOn.value = on ? 1 : 0;
    if (!on) { this.mesh.visible = false; return; }
    if (!this.last || Math.hypot(cp.x - this.last[0], north - this.last[1]) > REFILL) { this.last = [cp.x, north]; this.fill(cp.x, north); }
    this.mesh.visible = this.n > 0;
  }
  get counts() { return { staged: this.n, species: EMERGENT_SPECIES.length, month: this.month, enabled: this.enabled }; }
  pick(origin, dir, far = RANGE) {
    let best = null; const buf = this.buf.array;
    for (let q = 0; q < this.n; q++) {
      const o = q * STRIDE, sp = buf[o + 4] | 0, F = EMERGENT_SPECIES[sp], st = this.states[sp]; if (!F || !st || st.h <= 0) continue;
      const sc = buf[o + 3], H = F.boxH * st.h * sc, R = Math.max(0.15, 0.5 * F.clump * sc);
      const vx = buf[o] - origin.x, vy = buf[o + 1] + 0.5 * H - origin.y, vz = buf[o + 2] - origin.z;
      const t = vx * dir.x + vy * dir.y + vz * dir.z, rr = Math.max(R, 0.4 * H);
      if (t < rr + 0.3 || t > far) continue;
      const l2 = vx * vx + vy * vy + vz * vz - t * t;
      if (l2 > rr * rr) continue;
      if (!best || t < best.distance) best = { distance: t, species: F.id, id: `emergent:${q}`, x: buf[o], z: buf[o + 2], y: buf[o + 1], point: new THREE.Vector3(buf[o], buf[o + 1] + 0.5 * H, buf[o + 2]) };
    }
    return best;
  }
  nearest(x, z, r, ids = null) {
    let best = null; const buf = this.buf.array, r2 = r * r;
    for (let q = 0; q < this.n; q++) {
      const o = q * STRIDE, sp = buf[o + 4] | 0, F = EMERGENT_SPECIES[sp]; if (!F || (ids && !ids.has(F.id))) continue;
      const dx = buf[o] - x, dz = buf[o + 2] - z, d2 = dx * dx + dz * dz; if (d2 > r2) continue;
      if (!best || d2 < best.d2) best = { species: F.id, d2, x: buf[o], z: buf[o + 2] };
    }
    if (best) best.d = Math.sqrt(best.d2);
    return best;
  }
  speciesAround(x, z, r) {
    const out = {}, buf = this.buf.array, r2 = r * r;
    for (let q = 0; q < this.n; q++) { const o = q * STRIDE, dx = buf[o] - x, dz = buf[o + 2] - z; if (dx * dx + dz * dz > r2) continue; const F = EMERGENT_SPECIES[buf[o + 4] | 0]; if (F) out[F.id] = (out[F.id] || 0) + 1; }
    return out;
  }
  dispose() {
    this.mesh.visible = false; this.mesh.geometry.dispose(); this.material.dispose(); this.atlas?.dispose(); this.cache.clear(); this.mixCache.clear();
  }
}
