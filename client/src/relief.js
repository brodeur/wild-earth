import * as THREE from 'three';
import { latLonToXYZ } from './mapGlobe.js';
import { seasonOfDate } from './season.js';

// The chosen place as a relief model on the home screen's globe (Aaron, 2026-11-04: "When the user selects a tile in the
// start screen is it possible to quickly render an exaggerated relief map of the tile instead of the current flattened
// map tile?"). When a place is chosen (title.js choose), its own ground is fetched, the same files the world then
// loads, so the browser fetches them once:
// - client/heights.png (Terrain-RGB, 0.1 m from -10000 m, row 0 north);
// - client/canopy_height.png (G: the lidar's tree cover %), else client/canopy.png (R: LANDFIRE's);
// - client/water.png (R low 4 bits: 1 channel bed, 5 pond water), pooled at its own resolution into each cell's share of water.
// The heights are decoded at N x N with nearest sampling (createImageBitmap's 'pixelated' resize, which keeps the encoded
// heights whole) and built into a grid on the globe: the tile's UTM square, every vertex placed by its own latitude and
// longitude (utmToLatLon), raised by its height above the tile's lowest point times the exaggeration EX.
// EX = clamp(EX_SPAN / the tile's height range, 1, EX_MAX): the foothills (about 500 m of relief) stand 2.4x, Yosemite
// (about 2,000 m) as it is, so no place reaches the 10,000 ft camera. Short walls drop to the map around it, so it
// reads as a model standing on the map.
// The colour is a relief map's:
// - dry grass to tan with height, rock above 2,400 m and snow above 3,000 m;
// - forest green by tree cover;
// - blue water in the stream beds and ponds.
// The season's herds (client/herds.json, pipeline/herds.py: the herd species' herds of hundreds) stand on it as dark
// speckled patches where they gather: each herd up to HERD_DOTS bodies scattered over its disc, the disc spread
// HERD_SPREAD times as the heights are exaggerated (a herd of 400 on Lamar is some 270 m across, 5 px from the title's
// camera, its bison a tenth of a pixel; spread, a patch of 15 px reads), each body grown so the herd's dark share of
// its disc is about HERD_FILL, raised with the relief.
// It is lit by the title's sun and by a fixed light from the northwest, so its shape reads at any hour. It fades in
// over FADE s when it is built, and out when another place is chosen or the screen closes.
// Nothing here is sent anywhere: the files are the game's own.

const N = 192, EX_SPAN = 1200, EX_MAX = 3, LIFT_M = 12, FADE = 0.8, R_M = 6371000, TILE_M = 10000;
const HERD_DOTS = 160, HERD_FILL = 0.5, HERD_SPREAD = 3, HERD_COL = [0.035, 0.022, 0.014];   // (linear: a bison's dark brown in the relief's light)

// UTM (WGS84) to latitude and longitude in degrees (Snyder 1987, the series to the sixth order: well under a metre).
export function utmToLatLon(E, Nn, zone, north = true) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = E - 500000, y = north ? Nn : Nn - 10000000;
  const mu = y / k0 / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const C1 = ep2 * c * c, T1 = t * t, N1 = a / Math.sqrt(1 - e2 * s * s), R1 = a * (1 - e2) / (1 - e2 * s * s) ** 1.5, D = x / (N1 * k0);
  const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return { lat: lat * 180 / Math.PI, lon: (zone - 1) * 6 - 180 + 3 + lon * 180 / Math.PI };
}
export function parseTileId(id) {
  const m = /^utm(\d+)([ns])_(\d+)_(\d+)$/.exec(id || '');
  return m ? { zone: +m[1], north: m[2] === 'n', x0: +m[3] * 1000, y0: +m[4] * 1000 } : null;
}

async function pixels(url, n, quality = 'pixelated') {
  const r = await fetch(url); if (!r.ok) throw new Error('relief: ' + r.status + ' ' + url);
  const bmp = await createImageBitmap(await r.blob(), { resizeWidth: n, resizeHeight: n, resizeQuality: quality });
  const cv = new OffscreenCanvas(n, n), g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false; g.drawImage(bmp, 0, 0); bmp.close();
  return g.getImageData(0, 0, n, n).data;
}

// The share of each of the n x n cells that is open water (stream bed or pond), from client/water.png at its own
// resolution, so a creek a few metres wide still marks the cells it runs through.
async function waterShare(url, n) {
  const r = await fetch(url); if (!r.ok) throw new Error('relief: ' + r.status + ' ' + url);
  const bmp = await createImageBitmap(await r.blob()), W = bmp.width, H = bmp.height;
  const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0); bmp.close();
  const d = g.getImageData(0, 0, W, H).data, out = new Float32Array(n * n), cnt = new Float32Array(n * n);
  for (let y = 0; y < H; y++) { const j = Math.min(n - 1, (y * n / H) | 0); for (let x = 0; x < W; x++) {
    const i = Math.min(n - 1, (x * n / W) | 0), z = d[(y * W + x) * 4] & 15, k = j * n + i; cnt[k]++; if (z === 1 || z === 5) out[k]++;
  } }
  for (let k = 0; k < n * n; k++) out[k] = cnt[k] ? out[k] / cnt[k] : 0;
  return out;
}

const VERT = /* glsl */`
  attribute vec3 color; uniform vec3 lightNW;
  varying vec3 vC; varying vec3 vN; varying vec3 vL;
  void main() {
    vC = color; vN = normalize(mat3(modelMatrix) * normal); vL = normalize(mat3(modelMatrix) * lightNW);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform vec3 sunDir; uniform float opacity;
  varying vec3 vC; varying vec3 vN; varying vec3 vL;
  void main() {
    vec3 n = normalize(vN);
    float lit = 0.22 + 0.45 * max(dot(n, normalize(sunDir)), 0.0) + 0.55 * max(dot(n, vL), 0.0);
    gl_FragColor = vec4(vC * min(lit, 1.25), opacity);
    #include <colorspace_fragment>
  }`;

export class Relief {
  constructor(group, sunDir) {
    this.group = group; this.sunDir = sunDir;
    this.mesh = null; this.id = null; this.want = null; this.fading = [];
  }
  // build and show the relief of tile `id` (a later call or hide() abandons an earlier one still loading)
  async show(id) {
    if (id === this.id || id === this.want) return;
    this.hide(); this.want = id;
    const T = parseTileId(id); if (!T) return;
    const dir = `../tiles/${id}/client/`;
    let H, C, W;
    try {
      // tree cover: the lidar's (canopy_height.png G, 10 m) where the tile has it, else LANDFIRE's (canopy.png R, 30 m)
      const cover = pixels(dir + 'canopy_height.png', N, 'medium').then(d => ({ d, ch: 1 })).catch(() => pixels(dir + 'canopy.png', N, 'medium').then(d => ({ d, ch: 0 }))).catch(() => null);
      const herds = fetch(dir + 'herds.json').then(r => r.ok ? r.json() : null).catch(() => null);
      [H, C, W, this.herds] = await Promise.all([pixels(dir + 'heights.png', N), cover, waterShare(dir + 'water.png', N).catch(() => null), herds]);
    } catch (e) { if (this.want === id) this.want = null; console.warn(e.message); return; }
    if (this.want !== id) return;   // another place was chosen meanwhile
    this.want = null; this.id = id;
    this.mesh = this.build(T, H, C, W); this.mesh.material.uniforms.opacity.value = 0; this.mesh.userData.fade = 1;
    this.group.add(this.mesh);
  }
  hide() {
    this.want = null;
    if (this.mesh) { this.mesh.userData.fade = -1; this.fading.push(this.mesh); this.mesh = null; }
    this.id = null;
  }
  update(dt) {
    const step = dt / FADE;
    if (this.mesh) { const u = this.mesh.material.uniforms.opacity; u.value = Math.min(1, u.value + step); this.mesh.material.transparent = u.value < 1; }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const m = this.fading[i], u = m.material.uniforms.opacity; m.material.transparent = true; u.value -= step;
      if (u.value <= 0) { this.group.remove(m); for (const c of m.children) c.geometry.dispose(); m.geometry.dispose(); m.material.dispose(); this.fading.splice(i, 1); }
    }
  }
  dispose() {
    this.hide();
    for (const m of this.fading) { this.group.remove(m); for (const c of m.children) c.geometry.dispose(); m.geometry.dispose(); m.material.dispose(); }
    this.fading = [];
  }
  build(T, H, C, W) {
    const n = N, h = new Float32Array(n * n);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n * n; i++) {
      const v = -10000 + (H[i * 4] * 65536 + H[i * 4 + 1] * 256 + H[i * 4 + 2]) * 0.1;
      h[i] = v; if (v > -500) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    for (let i = 0; i < n * n; i++) if (h[i] <= -500) h[i] = lo;   // no data: the floor
    const ex = THREE.MathUtils.clamp(EX_SPAN / Math.max(hi - lo, 150), 1, EX_MAX);
    const mid = utmToLatLon(T.x0 + TILE_M / 2, T.y0 + TILE_M / 2, T.zone, T.north);
    const centre = latLonToXYZ(mid.lat, mid.lon).multiplyScalar(1 + LIFT_M / R_M);
    // the light from the northwest, 45 degrees up, in the earth's frame at the tile
    const up = latLonToXYZ(mid.lat, mid.lon), north = latLonToXYZ(mid.lat + 0.01, mid.lon).sub(up).normalize(), east = latLonToXYZ(mid.lat, mid.lon + 0.01).sub(up).normalize();
    const lightNW = up.clone().add(north.clone().multiplyScalar(0.7)).add(east.clone().multiplyScalar(-0.7)).normalize();
    const col = (k, out) => {
      const z = h[k], t = (z - lo) / Math.max(hi - lo, 1);
      out.setRGB(0.40 + 0.20 * t, 0.43 + 0.13 * t, 0.26 + 0.12 * t, THREE.SRGBColorSpace);   // dry grass to tan
      if (z > 2200) out.lerp(ROCK, THREE.MathUtils.smoothstep(z, 2200, 2600));
      if (z > 2900) out.lerp(SNOW, THREE.MathUtils.smoothstep(z, 2900, 3300));
      if (C) out.lerp(FOREST, Math.min(1, C.d[k * 4 + C.ch] / 70) * 0.9);   // closed forest at 70% cover
      if (W && W[k] > 0) out.lerp(WATER, Math.min(1, W[k] * 6));   // a creek a sixth of the cell wide reads as water
      return out;
    };
    // the top: n x n vertices at the cell centres, row 0 north; then the walls: the border's top and its foot
    const ring = [];
    for (let i = 0; i < n - 1; i++) ring.push(i);                          // north edge, west to east
    for (let j = 0; j < n - 1; j++) ring.push(j * n + n - 1);              // east edge, north to south
    for (let i = n - 1; i > 0; i--) ring.push((n - 1) * n + i);            // south edge, east to west
    for (let j = n - 1; j > 0; j--) ring.push(j * n);                      // west edge, south to north
    const nv = n * n + 2 * ring.length, pos = new Float32Array(nv * 3), clr = new Float32Array(nv * 3), idx = [];
    const p = new THREE.Vector3(), c = new THREE.Color(), cell = TILE_M / n;
    const put = (v, k, raise) => {
      const i = k % n, j = (k / n) | 0, ll = utmToLatLon(T.x0 + (i + 0.5) * cell, T.y0 + TILE_M - (j + 0.5) * cell, T.zone, T.north);
      latLonToXYZ(ll.lat, ll.lon, p).multiplyScalar(1 + (LIFT_M + (raise ? (h[k] - lo) * ex : 0)) / R_M).sub(centre);
      pos[v * 3] = p.x; pos[v * 3 + 1] = p.y; pos[v * 3 + 2] = p.z;
    };
    for (let k = 0; k < n * n; k++) { put(k, k, true); col(k, c); clr[k * 3] = c.r; clr[k * 3 + 1] = c.g; clr[k * 3 + 2] = c.b; }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const w0 = n * n, L = ring.length;
    for (let r = 0; r < L; r++) {
      const k = ring[r], top = w0 + r, foot = w0 + L + r;
      put(top, k, true); put(foot, k, false);
      col(k, c).multiplyScalar(0.55);
      for (const v of [top, foot]) { clr[v * 3] = c.r; clr[v * 3 + 1] = c.g; clr[v * 3 + 2] = c.b; }
      const t2 = w0 + (r + 1) % L, f2 = w0 + L + (r + 1) % L;
      idx.push(top, foot, t2, t2, foot, f2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(clr, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: this.sunDir }, lightNW: { value: lightNW }, opacity: { value: 0 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(g, mat);
    m.position.copy(centre); m.renderOrder = 2; m.frustumCulled = false;
    m.userData = { id: T, ex, lo, hi };
    const dots = this.herdDots(T, h, lo, ex, centre, up, north, east);
    if (dots) { const d = new THREE.Mesh(dots, mat); d.renderOrder = 2; d.frustumCulled = false; m.add(d); }
    return m;
  }
  // The season's herds as small dark boxes on the relief (see the header), one geometry; null without herds.
  herdDots(T, h, lo, ex, centre, up, north, east) {
    const all = this.herds?.herds; if (!all || typeof all !== 'object') return null;
    const season = seasonOfDate(new Date()), boxes = [];
    for (const code of Object.keys(all)) for (const hd of all[code]?.[season] || []) if ([hd.x, hd.n, hd.count, hd.r].every(Number.isFinite)) boxes.push(hd);
    if (!boxes.length) return null;
    const pos = [], nrm = [], clr = [], idx = [], p = new THREE.Vector3(), cell = TILE_M / N;
    // a unit box's corners and faces (x east, y up, z north), each face its own four vertices for flat normals
    const F = [[[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
      [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]], [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]]];
    let seed = 0x9e3779b9;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (const hd of boxes) {
      const m = Math.min(HERD_DOTS, Math.max(1, Math.round(hd.count))), R = hd.r * HERD_SPREAD, s = THREE.MathUtils.clamp(R * Math.sqrt(HERD_FILL * Math.PI / m), 6, 70);
      for (let k = 0; k < m; k++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.85, yaw = rnd() * Math.PI;
        const x = hd.x + Math.cos(a) * d, nn = hd.n + Math.sin(a) * d;
        const i = THREE.MathUtils.clamp(Math.floor(x / cell), 0, N - 1), j = THREE.MathUtils.clamp(Math.floor((TILE_M - nn) / cell), 0, N - 1);
        const ll = utmToLatLon(T.x0 + x, T.y0 + nn, T.zone, T.north);
        const base = latLonToXYZ(ll.lat, ll.lon, p).multiplyScalar(1 + (LIFT_M + (h[j * N + i] - lo) * ex) / R_M).sub(centre).clone();
        const hx = s * 0.8, hy = s * 0.45, hz = s * 0.45, c = Math.cos(yaw), sn = Math.sin(yaw);
        for (const [fn, corners] of F) {
          const v0 = pos.length / 3;
          for (const [cx, cy, cz] of corners) {
            const lx = cx * hx, lz = cz * hz, ex2 = lx * c - lz * sn, nz = lx * sn + lz * c, ly = (cy + 1) * hy;
            const q = base.clone().addScaledVector(east, ex2 / R_M).addScaledVector(north, nz / R_M).addScaledVector(up, ly / R_M);
            pos.push(q.x, q.y, q.z);
            const fx = fn[0] * c - fn[2] * sn, fz = fn[0] * sn + fn[2] * c, nv = east.clone().multiplyScalar(fx).addScaledVector(north, fz).addScaledVector(up, fn[1]);
            nrm.push(nv.x, nv.y, nv.z); clr.push(...HERD_COL);
          }
          idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    g.setIndex(idx);
    return g;
  }
}
const ROCK = new THREE.Color('#9b988e'), SNOW = new THREE.Color('#eef2f4'), FOREST = new THREE.Color('#2c4a2a'), WATER = new THREE.Color('#3f86b0');
