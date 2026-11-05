import * as THREE from 'three';

// The map on the home screen's globe (title.js; docs/decisions.md, "the home screen redesigned"): OpenStreetMap's map,
// drawn by mapTiles.worker.js from OpenFreeMap's vector tiles, draped over the earth as Web Mercator tiles chosen each
// frame from a quadtree, so the earth stays a globe from space and becomes a map as the camera comes down to a few
// kilometres. MapGlobe(group) adds its meshes to the earth's group (the unit sphere, the earth's own rotation);
// update(camera, H) picks the tiles to draw, asks the worker for the missing ones and draws each with its own picture,
// or with the part of an ancestor's picture (at most FALLBACK_UP levels up) until its own comes. `mix` fades the map
// over the earth's own picture (0 off, 1 the map alone). TileOutline draws a tile's square on the ground as a ribbon
// of constant screen width.
//
// A tile's mesh is a grid on the sphere whose rows follow the Mercator latitudes, positioned at its own centre (the
// vertices relative to it, so a tile at a few kilometres keeps its precision); at most PICTURES pictures are held, the
// least recently drawn let go first. Beyond the Mercator limit (85 degrees) there is no map: the earth's picture shows.

const DEG = Math.PI / 180;
const Z_MIN = 2, Z_MAX = 17, SPLIT_PX = 400, PICTURES = 72, ASK_MAX = 10, DRAW_MAX = 120, FALLBACK_UP = 2;
const LAT_MAX = 85.0511;

// lat/lon to a point on the unit sphere matching SphereGeometry's mapping (u = 0, lon -180, on -X; lon -90 on +Z).
export function latLonToXYZ(lat, lon, out = new THREE.Vector3()) {
  const la = lat * DEG, phi = (lon + 180) * DEG, c = Math.cos(la);
  return out.set(-c * Math.cos(phi), Math.sin(la), c * Math.sin(phi));
}
export const xyzToLatLon = p => ({ lat: Math.asin(THREE.MathUtils.clamp(p.y / p.length(), -1, 1)) / DEG, lon: (((Math.atan2(p.z, -p.x) / DEG - 180) % 360) + 540) % 360 - 180 });
const mercLat = (y, n) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / DEG;
export const lonToTileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
export const latToTileY = (lat, z) => { const l = THREE.MathUtils.clamp(lat, -LAT_MAX, LAT_MAX) * DEG; return Math.floor((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2 * 2 ** z); };

const MAP_VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vN;
  void main() {
    vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0);
    vN = normalize(w.xyz);   // the earth's centre is the origin
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
// The map lit by the title's sun, softly (a map should read on the whole facing side), in its own colours.
const MAP_FRAG = /* glsl */`
  uniform sampler2D map; uniform vec4 rect; uniform float mixA; uniform vec3 sunDir;
  varying vec2 vUv; varying vec3 vN;
  void main() {
    vec3 c = texture2D(map, rect.xy + vUv * rect.zw).rgb;
    float day = smoothstep(-0.25, 0.3, dot(normalize(vN), sunDir));
    gl_FragColor = vec4(c * (0.3 + 0.75 * day), mixA);
    #include <colorspace_fragment>
  }`;

class Tile {
  constructor(z, x, y) {
    this.z = z; this.x = x; this.y = y; this.key = `${z}/${x}/${y}`;
    const n = 2 ** z, lon0 = x / n * 360 - 180, lon1 = (x + 1) / n * 360 - 180, lat0 = mercLat(y, n), lat1 = mercLat(y + 1, n);
    this.bounds = [lon0, lat1, lon1, lat0];   // w, s, e, n
    this.samples = [];
    for (const v of [0, 0.5, 1]) for (const u of [0, 0.5, 1]) this.samples.push(latLonToXYZ(mercLat(y + v, n), lon0 + (lon1 - lon0) * u));
    this.center = this.samples[4].clone();
    this.radius = Math.max(...this.samples.map(p => p.distanceTo(this.center)));
    this.width = (lon1 - lon0) * DEG * Math.sqrt(Math.max(0, 1 - this.center.y ** 2));   // the tile's width along the ground, in earth radii
    this.tex = null; this.state = 'none'; this.used = 0; this.mesh = null;
  }
  geometry() {
    const N = this.z < 5 ? 32 : 16, n = 2 ** this.z, [w, , e] = this.bounds, pos = [], uv = [], idx = [], p = new THREE.Vector3();
    for (let j = 0; j <= N; j++) {
      const lat = mercLat(this.y + j / N, n);
      for (let i = 0; i <= N; i++) { latLonToXYZ(lat, w + (e - w) * i / N, p).sub(this.center); pos.push(p.x, p.y, p.z); uv.push(i / N, j / N); }
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.01);
    return g;
  }
}

export class MapGlobe {
  // group: the earth's group (the unit sphere); renderer: the page's; sunDir: the title's sun (a Vector3 it updates).
  constructor({ group, renderer, sunDir }) {
    this.group = group; this.renderer = renderer; this.sunDir = sunDir;
    this.root = new THREE.Group(); group.add(this.root);   // no renderOrder on the group: three would sort its children by it ahead of their own
    this.tiles = new Map(); this.frame = 0; this.mix = 1; this.asked = 0; this.disposed = false;
    this.anis = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.worker = new Worker(new URL('./mapTiles.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = e => this.got(e.data);
    this.worker.onerror = e => { console.warn('map: the tile worker failed', e.message || e); };
    this._m = new THREE.Matrix4(); this._f = new THREE.Frustum(); this._c = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Sphere();
    this.drawn = [];
  }
  tile(z, x, y) {
    const k = `${z}/${x}/${y}`; let t = this.tiles.get(k);
    if (!t) { t = new Tile(z, x, y); this.tiles.set(k, t); }
    return t;
  }

  // Pick and draw the tiles for this camera: H the canvas's CSS height (the split is by the tile's size on screen).
  update(camera, H) {
    if (this.disposed) return;
    this.frame++;
    const g = this.group; g.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(g.matrixWorld);
    this._f.setFromProjectionMatrix(this._m);
    const c = this._c.copy(camera.position).applyQuaternion(this._q.copy(g.quaternion).invert()), cl = c.length();
    const K = H / 2 / Math.tan(camera.fov / 2 * DEG);
    // the tiles in view, refined largest on screen first (so the near ground gets the detail when the count is capped)
    const horizon = Math.acos(Math.min(1, 1 / cl));   // the angle from the point under the camera to its horizon
    const look = t => {
      // beyond the horizon: the tile's centre further from the point under the camera than the horizon and its own size
      if (horizon + t.radius * 1.05 < Math.PI && t.center.dot(c) / cl < Math.cos(horizon + t.radius * 1.05)) return null;
      if (!this._f.intersectsSphere(this._s.set(t.center, t.radius))) return null;
      let near = Infinity; for (const p of t.samples) near = Math.min(near, p.distanceTo(c));
      t.near = near; t.px = t.width / Math.max(1e-6, near) * K;
      return t;
    };
    const out = [];
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) { const t = look(this.tile(Z_MIN, x, y)); if (t) out.push(t); }
    for (let guard = 0; guard < 400; guard++) {
      let bi = -1, bp = SPLIT_PX;
      for (let i = 0; i < out.length; i++) if (out[i].z < Z_MAX && out[i].px > bp) { bp = out[i].px; bi = i; }
      if (bi < 0 || out.length + 3 > DRAW_MAX) break;
      const t = out[bi]; out.splice(bi, 1);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = look(this.tile(t.z + 1, t.x * 2 + dx, t.y * 2 + dy)); if (k) out.push(k); }
    }
    const want = out.map(t => [t.near, t]);
    // ask for the missing pictures, nearest first, and each one's ancestor two levels up so a jump has a picture soon
    want.sort((a, b) => a[0] - b[0]);
    for (const [, t] of want) {
      if (this.asked >= ASK_MAX) break;
      this.ask(t);
      if (t.z > Z_MIN + 1) this.ask(this.tile(t.z - 2, t.x >> 2, t.y >> 2));
    }
    // draw: each picked tile with its own picture or its nearest ancestor's
    const keep = new Set();
    for (const t of out) {
      let src = t, d = 0;
      while (src && src.state !== 'ready') { if (d >= FALLBACK_UP || src.z === 0) { src = null; break; } src = this.tile(src.z - 1, src.x >> 1, src.y >> 1); d++; }
      if (!src) continue;   // nothing near enough: the earth's own picture shows until the tile comes (a far ancestor's names would be huge)
      src.used = this.frame;
      const m = t.mesh || (t.mesh = new THREE.Mesh(t.geometry(), new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, rect: { value: new THREE.Vector4() }, mixA: { value: 1 }, sunDir: { value: this.sunDir } },
        vertexShader: MAP_VERT, fragmentShader: MAP_FRAG, transparent: true, depthWrite: true })));
      m.position.copy(t.center); m.renderOrder = 1; m.userData.tile = t;
      const u = m.material.uniforms, s = 1 / 2 ** d;
      u.map.value = src.tex; u.rect.value.set((t.x - src.x * 2 ** d) * s, (t.y - src.y * 2 ** d) * s, s, s); u.mixA.value = this.mix;
      if (m.parent !== this.root) this.root.add(m);
      t.used = this.frame; keep.add(t);
    }
    for (const m of [...this.root.children]) if (!keep.has(m.userData.tile)) this.root.remove(m);
    this.drawn = out;
    this.evict();
  }
  ask(t) {
    if (t.state !== 'none') return;
    t.state = 'loading'; this.asked++;
    this.worker.postMessage({ t: 'tile', key: t.key, z: t.z, x: t.x, y: t.y });
  }
  got(m) {
    const t = this.tiles.get(m.key);
    if (t?.state === 'loading') this.asked--;
    if (this.disposed || !t || t.state !== 'loading') { m.bitmap?.close?.(); return; }
    if (m.error) { t.state = 'failed'; setTimeout(() => { if (t.state === 'failed') t.state = 'none'; }, 15000); return; }
    const tex = new THREE.Texture(m.bitmap);
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.anis;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
    t.tex = tex; t.state = 'ready'; t.used = this.frame;
  }
  // Let go of the pictures drawn longest ago past PICTURES, and the meshes of tiles not drawn for a while.
  evict() {
    const ready = [...this.tiles.values()].filter(t => t.state === 'ready' && t.used < this.frame);
    if (ready.length > PICTURES) {
      ready.sort((a, b) => a.used - b.used);
      for (const t of ready.slice(0, ready.length - PICTURES)) { t.tex.image?.close?.(); t.tex.dispose(); t.tex = null; t.state = 'none'; }
    }
    if (this.frame % 120 === 0) {
      for (const [k, t] of this.tiles) {
        if (t.used < this.frame - 240 && t.state !== 'loading') {
          if (t.mesh) { t.mesh.geometry.dispose(); t.mesh.material.dispose(); t.mesh = null; }
          if (t.state !== 'ready' && t.z > 3) this.tiles.delete(k);
        }
      }
    }
  }
  dispose() {
    this.disposed = true; this.worker.terminate();
    for (const t of this.tiles.values()) { if (t.mesh) { t.mesh.geometry.dispose(); t.mesh.material.dispose(); } if (t.tex) { t.tex.image?.close?.(); t.tex.dispose(); } }
    this.tiles.clear(); this.group.remove(this.root);
  }
}

// A tile's square ([w, s, e, n] in degrees) as a ribbon on the ground, SEG segments a side, as wide as `width` times each
// vertex's distance from the camera (title.js sets it to a few pixels over the lens's pixels per radian, so it stays a
// few pixels wide near and far); the colour and opacity are the caller's.
const LINE_VERT = /* glsl */`
  attribute vec3 side; uniform float width; uniform float lift;
  void main() {
    float d = distance((modelMatrix * vec4(position, 1.0)).xyz, cameraPosition);
    vec3 p = position * (1.0 + lift) + side * width * d;   // width: pixels over the lens's pixels per radian
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const LINE_FRAG = /* glsl */`
  uniform vec3 color; uniform float opacity;
  void main() { gl_FragColor = vec4(color, opacity); }`;
export class TileOutline {
  constructor(bounds, color = 0xffe2b0) {
    const [w, s, e, n] = bounds, SEG = 24, ring = [];
    for (let i = 0; i < SEG; i++) ring.push([s, w + (e - w) * i / SEG]);
    for (let i = 0; i < SEG; i++) ring.push([s + (n - s) * i / SEG, e]);
    for (let i = 0; i < SEG; i++) ring.push([n, e - (e - w) * i / SEG]);
    for (let i = 0; i < SEG; i++) ring.push([n - (n - s) * i / SEG, w]);
    const P = ring.map(([la, lo]) => latLonToXYZ(la, lo)), L = P.length, pos = [], side = [], idx = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < L; i++) {
      const p = P[i], t = a.subVectors(P[(i + 1) % L], P[(i - 1 + L) % L]).normalize(), perp = b.crossVectors(p, t).normalize();
      pos.push(p.x, p.y, p.z, p.x, p.y, p.z); side.push(perp.x, perp.y, perp.z, -perp.x, -perp.y, -perp.z);
      const j = (i + 1) % L; idx.push(2 * i, 2 * j, 2 * i + 1, 2 * i + 1, 2 * j, 2 * j + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('side', new THREE.Float32BufferAttribute(side, 3)); g.setIndex(idx);
    this.uniforms = { width: { value: 0.0001 }, lift: { value: 0 }, color: { value: new THREE.Color(color) }, opacity: { value: 1 } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    this.mesh.renderOrder = 3; this.mesh.frustumCulled = false;
  }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
