import * as THREE from 'three';
import { meshChunk, PSTRIDE, T_CAP, T_ROOM, T_COLLAR, T_PIT, hFor } from './digMesh.js';

// Dig's drawing (docs/game-dig.md "Drawing", 2026-11-04): the soil is a solid and digging removes it. Every segment,
// room, hole and pit of the world (dig.js, unchanged) is a primitive of the carved air (digMesh.js); the surface where
// the soil meets the air is meshed in chunks of CH m that exist only where something is dug, each with cells sized by
// the smallest radius in it (1 cm for a vole's bore, 2 cm for a rabbit's or a room, 4 cm for a big pit; one size over
// a joined component, so neighbours share their border exactly), in a Web Worker. Only the chunks a change touches are
// meshed again. The chunks are drawn REG^3 to a region, one draw each, with the dirt's look (DIRT_FRAG) in the world
// and the channel's glow (XRAY_FRAG) in the underground view. A hole's mouth comes out of the field: the ground and its
// spoil within PATCH_D of an opening are part of the same surface as the tunnel's wall (Aaron's "joint between these
// two surfaces"), and the terrain's cut disc sits just inside that patch (Dig.update), where the spoil hides its edge.
// Glow (the scent along an opened system) is per node, in a float texture the vertex shader reads by the node's slot.

export const CH = 0.16;
const REG = 4, PATCH_D = 0.06, JOBS_MAX = 4, GLOW_W = 256;
const SINK = 0.003;   // the bare ground of a patch a little under the terrain's: only the spoil comes up through it, in its own smooth outline
const MK = 5.5;   // a primitive reaches chunks within MK of its cells: the three cells and the fillet its field needs at a chunk's border, and the border cell
export const NODE_SLOTS = 8192;
const kLfor = h => 1.2 * h, kJfor = h => 1.5 * h;   // the mouth's lip and the junctions' fillet, by the cell
const VIS_OPEN = 3, VIS_FAR = 30, XR_R = 10;   // the dirt drawn within VIS_OPEN of an opening (seen down a hole or a pit) and VIS_FAR of the camera
export const holeCut = r => r + Math.min(kLfor(hFor(r)), 0.03);   // the terrain's cut round a hole: inside the patch and the spoil
const SPOIL_K = 0.75, SPOIL_IN = 1.35, SPOIL_OUT = 3.6, SPOIL_FAN = 1.6;   // a hole's spoil: its height and reach in radii, and how far the fan runs out away from the tunnel

// ---- the dirt and the channel ---------------------------------------------------------------------
const GLOW_GLSL = /* glsl */`
  uniform sampler2D glowTex;
  float glowAt(float s){ if (s < -0.5) return 0.0; int i = int(s + 0.5); return texelFetch(glowTex, ivec2(i % ${GLOW_W}, i / ${GLOW_W}), 0).r; }`;
const DIRT_VERT = /* glsl */`
  attribute vec4 aMix; attribute vec3 aGRef;
  varying vec3 vPos; varying vec3 vN; varying float vGlow; varying vec4 vMix;
  ${GLOW_GLSL}
  void main(){ vPos = position; vN = normal; vMix = aMix; vGlow = mix(glowAt(aGRef.x), glowAt(aGRef.y), aGRef.z);
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
// The wall: the soil's colour by the tile's soils layer, a 2 cm and a 6 mm grain, stones by its rock fragments, fine
// roots on the roof; lit by what kind of surface it is (vMix, from the field): inside a tunnel dark but for the light
// down the nearest holes and pits; a pit's bowl by the sky, less toward its floor; the ground and spoil round a mouth
// as the ground is lit, fresh earth darker and lumpier. The scent glow along an opened system is emissive.
const DIRT_FRAG = /* glsl */`
  varying vec3 vPos; varying vec3 vN; varying float vGlow; varying vec4 vMix;
  uniform vec4 lights[8]; uniform int lightN;
  uniform vec4 nose;
  uniform vec3 soil; uniform float stones; uniform vec3 glowCol; uniform float time; uniform float skyK;
  uniform vec3 sunDir; uniform vec3 sunLight; uniform vec3 ambientSky; uniform vec3 ambientGround;
  float hash3(vec3 p){ uvec3 q = uvec3(ivec3(floor(p)) + 65536); uint h = q.x * 1597334677u ^ q.y * 3812015801u ^ q.z * 2798796415u;
    h = (h ^ (h >> 15)) * 2246822519u; h ^= h >> 13; return float(h) * (1.0 / 4294967296.0); }
  float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  void main(){
    vec3 p = vPos; float pitK = vMix.x, outK = vMix.y, spoilK = vMix.z, under = max(vMix.w, 0.0), inK = (1.0 - outK) * (1.0 - pitK);
    vec3 n = normalize(vN); if (dot(n, cameraPosition - p) < 0.0) n = -n;
    float eye = distance(p, cameraPosition), near = 1.0 - smoothstep(1.0, 1.5, eye);
    float g1 = vnoise3(p * 50.0), g2 = near > 0.0 ? vnoise3(p * 160.0 + 7.0) : 0.5;
    vec3 col = soil * (0.75 + 0.35 * g1 + 0.26 * (g2 - 0.5) * near);
    if (near > 0.0) { vec3 c = floor(p * 33.0), f = fract(p * 33.0) - 0.5; float h = hash3(c + 11.0);
      if (h < stones * 0.55) { float s = 0.18 + 0.22 * hash3(c + 23.0); vec3 o = (vec3(hash3(c + 31.0), hash3(c + 37.0), hash3(c + 41.0)) - 0.5) * 0.5;
        float d = length(f - o) / s; if (d < 1.0) { float t = hash3(c + 47.0); col = mix(col, mix(vec3(0.3, 0.29, 0.27), vec3(0.42, 0.36, 0.3), t) * (0.8 + 0.4 * g2), smoothstep(1.0, 0.7, d)); } } }
    if (inK > 0.01 && near > 0.0 && -n.y > -0.3) { float rt = abs(vnoise3(vec3(p.x * 90.0, p.y * 25.0, p.z * 90.0) + 5.0) - 0.5) * 2.0;
      float root = smoothstep(0.965, 1.0, 1.0 - rt) * clamp(-n.y + 0.3, 0.0, 1.0) * step(0.55, g1) * near * inK;   // fine roots on the roof
      col = mix(col, vec3(0.5, 0.4, 0.27) * (0.8 + 0.4 * g2), root * 0.7); }
    col *= mix(1.0, 0.62 * (0.8 + 0.4 * vnoise3(p * 320.0 + 9.0)), max(spoilK, outK * 0.7));   // fresh earth round a mouth
    // inside: the light down the nearest holes and pits, the whiskers
    vec3 Lin = vec3(0.03, 0.032, 0.036), sky = (ambientSky * 0.8 + sunLight * 0.12 * max(sunDir.y, 0.0)) * skyK;
    for (int i = 0; i < 8; i++) { if (i >= lightN) break;
      vec3 to = lights[i].xyz - p; float w = lights[i].w, d = max(0.0, length(to) - w);
      Lin += 0.6 * sky * (w * w / (w * w + 2.5 * d * d)) * (0.45 + 0.55 * clamp(dot(n, normalize(to)), 0.0, 1.0)); }   // the sky seen up the shaft: its solid angle
    Lin += vec3(1.0, 0.82, 0.55) * 2.4 * exp(-length(nose.xyz - p) / nose.w);
    float deep = clamp(under / 0.45, 0.0, 1.0);
    vec3 Lpit = (ambientSky * (0.35 + 0.65 * max(n.y, 0.0)) * (1.0 - 0.75 * deep) + sunLight * max(dot(n, sunDir), 0.0) * (1.0 - 0.85 * deep)) * 0.3183;   // the walls shade the floor
    vec3 Lout = (sunLight * max(dot(n, sunDir), 0.0) + mix(ambientGround, ambientSky, 0.5 + 0.5 * n.y)) * 0.3183;
    vec3 outc = col * mix(mix(Lin, Lpit, pitK), Lout, outK);
    outc += glowCol * vGlow * (0.75 + 0.25 * sin(time * 3.0 + p.x * 20.0)) * 1.6 * (1.0 - outK);   // the scent of the voles
    gl_FragColor = vec4(outc, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
// The underground view's channel: the same surface, both faces added, bright at the silhouette and faint across (a
// glowing translucent pipe), a pit in a warning red, the spoil round the openings brighter across so a low mound seen
// from above still shows, the bare ground round a mouth faint; the scent glow along an opened stretch.
const XRAY_VERT = /* glsl */`
  attribute vec4 aMix; attribute vec3 aGRef; uniform vec3 xrAt;
  varying vec3 vPos; varying vec3 vN; varying float vGlow; varying vec4 vMix;
  ${GLOW_GLSL}
  void main(){ vec2 d = position.xz - xrAt.xz; if (dot(d, d) > ${(XR_R * XR_R).toFixed(1)}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vPos = position; vN = normal; vMix = aMix; vGlow = mix(glowAt(aGRef.x), glowAt(aGRef.y), aGRef.z);
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const XRAY_FRAG = /* glsl */`
  varying vec3 vPos; varying vec3 vN; varying float vGlow; varying vec4 vMix;
  uniform float xrK; uniform vec3 xrAt; uniform vec3 glowCol; uniform float time;
  void main(){
    vec3 p = vPos;
    float ndv = abs(dot(normalize(vN), normalize(cameraPosition - p))), rim = (1.0 - ndv) * (1.0 - ndv);
    float fall = 1.0 - smoothstep(${(XR_R * 0.6).toFixed(1)}, ${XR_R.toFixed(1)}, distance(p.xz, xrAt.xz));
    float bare = vMix.y * (1.0 - vMix.z);   // the ground round a mouth with no spoil on it
    vec3 base = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.28, 0.16), vMix.x);
    float across = mix(mix(0.07, 0.16, vMix.z), 0.025, bare);
    vec3 col = base * (across + 0.6 * rim * (1.0 - 0.75 * bare)) + glowCol * vGlow * (0.75 + 0.25 * sin(time * 3.0 + p.x * 20.0)) * (0.35 + 0.9 * rim) * (1.0 - vMix.y);
    gl_FragColor = vec4(col * xrK * fall, 1.0);
  }`;

const ckey = (i, j, k) => `${i},${j},${k}`;
const floorDiv = (a, b) => Math.floor(a / b);

export class Carve {
  constructor(dig) {
    this.dig = dig; this.scene = dig.scene;
    this.prims = new Map(); this.chunks = new Map(); this.regions = new Map();
    this.dirty = new Set(); this.stale = new Set(); this.seeds = new Set(); this.setChanged = false; this.busy = new Map(); this.jid = 0;
    this.slots = new Map(); this.free = []; this.nextSlot = 0;
    this.stats = { chunks: 0, regions: 0, verts: 0, tris: 0, jobs: 0, workerMs: 0, rebuilds: 0, inline: false };
    this.xrayOn = false; this.gWatch = { micro: -1, fine: null, t: 0 };
    // the glow per node slot
    const H = NODE_SLOTS / GLOW_W;
    this.glowData = new Float32Array(GLOW_W * H);
    this.glowTex = new THREE.DataTexture(this.glowData, GLOW_W, H, THREE.RedFormat, THREE.FloatType);
    this.glowTex.magFilter = this.glowTex.minFilter = THREE.NearestFilter; this.glowTex.needsUpdate = true;
    const u = dig.u, gt = { value: this.glowTex };
    this.dirtMat = new THREE.ShaderMaterial({ vertexShader: DIRT_VERT, fragmentShader: DIRT_FRAG, side: THREE.FrontSide,
      uniforms: { lights: u.lights, lightN: u.lightN, nose: u.nose, soil: u.soil, stones: u.stones, glowCol: u.glowCol, time: u.time, skyK: u.skyK,
        sunDir: u.sunDir, sunLight: u.sunLight, ambientSky: u.ambientSky, ambientGround: u.ambientGround, glowTex: gt },
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });   // the terrain wins a tie: the patch under it never shows through
    this.dirtMat.name = 'dirt';
    const xu = dig.xu;
    this.xrayMat = new THREE.ShaderMaterial({ vertexShader: XRAY_VERT, fragmentShader: XRAY_FRAG, side: THREE.DoubleSide,
      uniforms: { glowCol: u.glowCol, time: u.time, xrK: xu.xrK, xrAt: xu.xrAt, glowTex: gt },
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    this.xrayMat.name = 'dirt xray';
    // the workers (module workers, two where the machine has the cores; with none, the meshing runs here a few ms a frame)
    this.workers = [];
    try {
      const n = (navigator.hardwareConcurrency || 2) >= 6 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./digMesh.worker.js', import.meta.url), { type: 'module' });
        w.onmessage = m => this.onResult(m.data);
        w.onerror = () => this.lost(w);
        this.workers.push(w);
      }
    } catch (e) { this.workers.length = 0; }
    this.stats.inline = !this.workers.length; this.wi = 0;
  }
  get worker() { return this.workers.length ? this.workers : null; }
  lost(w) {   // a worker that failed (no module workers here): its chunks again, on another or here
    w.terminate(); this.workers = this.workers.filter(o => o !== w); this.stats.inline = !this.workers.length;
    for (const c of this.busy.values()) { c.busy = 0; this.dirty.add(c); } this.busy.clear();
  }

  // ---- the primitives ------------------------------------------------------------------------------
  slotOf(id) {
    let s = this.slots.get(id); if (s !== undefined) return s;
    s = this.free.length ? this.free.pop() : this.nextSlot < NODE_SLOTS ? this.nextSlot++ : -1;
    if (s >= 0) { this.slots.set(id, s); this.glowData[s] = 0; }
    return s;
  }
  setGlow(id, g) { const s = this.slots.get(id); if (s === undefined || s < 0) return; if (this.glowData[s] !== g) { this.glowData[s] = g; this.glowTex.needsUpdate = true; } }
  pos(n) { return [n.x, n.y, n.z]; }
  faceAt(n) { const a = this.dig.ahead; return a && a.id === n.id && a.id ? a : null; }
  // a prim: { d (Float32Array PSTRIDE, the field's) or spoil ({ hole | heap }: the ground raised), box, hp, margin }
  segPrim(s) {
    const w = this.dig.world, A = w.byId.get(s.a), B = w.byId.get(s.b); if (!A || !B) return this.drop('s:' + s.id);
    const [ax, ay, az] = this.pos(A), [bx, by, bz] = this.pos(B);
    const ra = A.room ? (B.room ? Math.min(A.r, B.r) * 0.5 : B.r) : A.r, rb = B.room ? (A.room ? Math.min(A.r, B.r) * 0.5 : A.r) : B.r;   // a tunnel enters a room at its own bore
    const plain = n => (!n.room && !n.hole && (n.segs.length === 2 || this.faceAt(n)) ? 1 : 0);   // a leaf drawn ahead: one group with its face
    const d = new Float32Array(PSTRIDE); d.set([T_CAP, 0, ax, ay, az, ra, bx, by, bz, rb, this.slotOf(A.id), this.slotOf(B.id), plain(A), plain(B)]);
    const r = Math.max(ra, rb), hp = hFor(Math.min(ra, rb));
    this.set('s:' + s.id, { d, hp, margin: MK * hp, box: [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r] });
  }
  nodePrims(n) {
    const id = n.id, fa = this.faceAt(n);
    // the player's face between the world's 2 cm steps (dig.faceAhead): a short cone from the leaf to where the face
    // really is, a primitive of its own so only its one or few chunks are meshed again each frame
    if (fa) {
      const r = n.r, hp = hFor(r), d = new Float32Array(PSTRIDE), x = n.x + fa.x, y = n.y + fa.y, z = n.z + fa.z;
      d.set([T_CAP, 0, n.x, n.y, n.z, r, x, y, z, r, this.slotOf(id), this.slotOf(id), 1, 0]);
      this.set('f:' + id, { d, hp, margin: MK * hp, box: [Math.min(n.x, x) - r, Math.min(n.y, y) - r, Math.min(n.z, z) - r, Math.max(n.x, x) + r, Math.max(n.y, y) + r, Math.max(n.z, z) + r] });
    } else this.drop('f:' + id);
    if (n.room) {
      const [x, y, z] = this.pos(n), r = n.r, hp = hFor(0.8 * r), d = new Float32Array(PSTRIDE); d.set([T_ROOM, 0, x, y, z, r, 0, 0, 0, 0, this.slotOf(id), this.slotOf(id), 0, 0]);
      this.set('r:' + id, { d, hp, margin: MK * hp, box: [x - r, y - r, z - r, x + r, y + r, z + r] });
    } else this.drop('r:' + id);
    if (n.hole) {
      const r = n.r, top = n.y + (2 + SPOIL_K) * r + 0.06, hp = hFor(r), d = new Float32Array(PSTRIDE);
      d.set([T_COLLAR, 0, n.x, n.y, n.z, r, n.x, top, n.z, r, this.slotOf(id), this.slotOf(id), 0, 0]);
      this.set('c:' + id, { d, hp, margin: MK * hp, box: [n.x - r, n.y - r, n.z - r, n.x + r, top + r, n.z + r] });
      // the spoil thrown out away from the tunnel: a ring round the mouth, run out into a fan
      let fx = 0, fz = 0; if (n.segs.length) { const o = this.dig.node(this.dig.otherEnd(n.segs[0], n)); if (o) { const dx = n.x - o.x, dz = n.z - o.z, dl = Math.hypot(dx, dz); if (dl > 1e-6) { fx = dx / dl; fz = dz / dl; } } }
      const gy = n.y + r, R = (SPOIL_OUT + SPOIL_FAN) * r;
      this.set('m:' + id, { spoil: { hole: true, x: n.x, z: n.z, r, fx, fz }, hp, margin: 3 * hp, box: [n.x - R, gy - 0.08, n.z - R, n.x + R, gy + SPOIL_K * r + 0.08, n.z + R] });
    } else { this.drop('c:' + id); this.drop('m:' + id); }
  }
  pitPrim(p) {
    const form = p.k === 'form', r = p.r, hp = form ? 0.02 : hFor(r), d = new Float32Array(PSTRIDE), sl = 0.3 * r + 0.03;
    d.set([T_PIT, 0, p.x, p.y0, p.z, r, 0, 0, 0, p.depth, -1, -1, 0, 0]);
    this.set('p:' + p.id, { d, hp, margin: MK * hp, box: [p.x - r, p.y0 - p.depth - sl, p.z - r, p.x + r, p.y0 + sl, p.z + r] });
    const R = form ? 0.7 * r + 0.04 : 0.5 * r + 0.12, hh = form ? 0.3 * p.depth + 0.004 : Math.min(0.25, 0.45 * p.depth + 0.01), gy = this.dig.groundY(p.hx, p.hz);
    this.set('h:' + p.id, { spoil: { hole: false, x: p.hx, z: p.hz, R, h: hh }, hp: hFor(R), margin: 3 * hFor(R), box: [p.hx - R, gy - 0.04 - 0.3 * R, p.hz - R, p.hx + R, gy + hh + 0.04 + 0.3 * R, p.hz + R] });
  }
  same(a, b) {
    if (!a || !b) return false;
    for (let i = 0; i < 6; i++) if (a.box[i] !== b.box[i]) return false;
    if (a.d && b.d) { for (let i = 0; i < PSTRIDE; i++) if (a.d[i] !== b.d[i]) return false; return a.hp === b.hp; }
    if (a.spoil && b.spoil) { for (const k in a.spoil) if (a.spoil[k] !== b.spoil[k]) return false; return true; }
    return false;
  }
  set(key, P) {
    const old = this.prims.get(key); if (old && this.same(old, P)) { this.live?.add(key); return; }
    P.key = key; P.chunks = []; this.prims.set(key, P); this.live?.add(key);
    const m = P.margin, b = P.box, moved = old ? this.moved(old, P) : null;
    const i0 = floorDiv(b[0] - m, CH), i1 = floorDiv(b[3] + m, CH), j0 = floorDiv(b[1] - m, CH), j1 = floorDiv(b[4] + m, CH), k0 = floorDiv(b[2] - m, CH), k1 = floorDiv(b[5] + m, CH);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const ck = ckey(i, j, k); let c = this.chunks.get(ck), fresh = false;
      if (!c) { c = { key: ck, i, j, k, prims: new Set(), wantH: 1, h: 0, res: null, busy: 0, ground: false, gs: null, region: null }; this.chunks.set(ck, c); this.seeds.add(c); fresh = true; }
      const had = c.prims.has(key); c.prims.add(key); P.chunks.push(c);
      if (fresh || !had || !moved || moved(c)) this.touchChunk(c);
    }
    if (old) { const keep = new Set(P.chunks); this.unlink(key, old, keep); }   // its old chunks it no longer reaches: let go (a chunk kept keeps its mesh until the new one comes)
  }
  // A cone whose one end moved (the face growing, drawn ahead): its surface changes in a chunk by at most the end's
  // move times how far along toward that end the chunk reaches; chunks it changes by under 0.2 mm keep their mesh.
  // null: any other change (every chunk again).
  moved(a, b) {
    if (!a.d || !b.d || a.d[0] !== T_CAP || b.d[0] !== T_CAP || a.hp !== b.hp) return null;
    for (const q of [5, 9, 10, 11, 12, 13]) if (a.d[q] !== b.d[q]) return null;
    const A = a.d, B = b.d, ax = B[2], ay = B[3], az = B[4], ux = B[6] - ax, uy = B[7] - ay, uz = B[8] - az, L2 = ux * ux + uy * uy + uz * uz, L = Math.sqrt(L2) || 1e-6;
    const perp = (x, y, z) => { const t = (x * ux + y * uy + z * uz) / (L2 || 1e-12); return Math.hypot(x - ux * t, y - uy * t, z - uz * t); };
    const mA = [B[2] - A[2], B[3] - A[3], B[4] - A[4]], mB = [B[6] - A[6], B[7] - A[7], B[8] - A[8]];
    const dA = Math.hypot(...mA), dB = Math.hypot(...mB), pA = perp(...mA), pB = perp(...mB), half = CH * 0.87 + a.margin;
    const caps = [];   // an end that moved: its cap's chunks (old and new place) mesh again
    if (dA > 1e-5) caps.push([A[2], A[3], A[4]], [B[2], B[3], B[4]]); if (dB > 1e-5) caps.push([A[6], A[7], A[8]], [B[6], B[7], B[8]]);
    const capR = Math.max(B[5], B[9]) + a.margin + CH * 0.87;
    return c => {
      const cx = (c.i + 0.5) * CH, cy = (c.j + 0.5) * CH, cz = (c.k + 0.5) * CH;
      for (const q of caps) if ((cx - q[0]) ** 2 + (cy - q[1]) ** 2 + (cz - q[2]) ** 2 < capR * capR) return true;
      const t = ((cx - ax) * ux + (cy - ay) * uy + (cz - az) * uz) / (L2 || 1e-12);
      const t0 = Math.max(0, Math.min(1, t - half / L)), t1 = Math.max(0, Math.min(1, t + half / L));
      return pA * (1 - t0) + pB * t1 > 0.0003;   // the side swung by under 0.3 mm here: kept
    };
  }
  unlink(key, P, keep = null) {
    for (const c of P.chunks) {
      if (keep?.has(c)) continue;
      c.prims.delete(key); this.touchChunk(c);
      if (!c.prims.size) {
        this.chunks.delete(c.key); this.dirty.delete(c); this.stale.delete(c); this.seeds.delete(c); this.setChanged = true; if (c.region) { c.region.chunks.delete(c); c.region.dirty = true; }
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) { const o = this.chunks.get(ckey(c.i + di, c.j + dj, c.k + dk)); if (o) this.seeds.add(o); }
      }
    }
    if (!keep) P.chunks = [];
  }
  drop(key) { const P = this.prims.get(key); if (!P) return; this.unlink(key, P); this.prims.delete(key); }
  touchChunk(c) { this.stale.add(c); this.dirty.add(c); }
  // after an event: the primitives at a node (its segments, its room, hole and spoil) or a pit made again
  touchNode(id) {
    const w = this.dig.world, n = w.byId.get(id);
    if (!n || !n.segs) { this.needSync = true; return; }
    for (const sid of n.segs) { const s = w.byId.get(sid); if (s) this.segPrim(s); }
    this.nodePrims(n);
  }
  touchPit(id) { const p = this.dig.world.byId.get(id); if (p?.pit) this.pitPrim(p); else this.needSync = true; }
  // the whole world again (a welcome, a room, a decay): every primitive set, the ones gone dropped, their slots freed
  syncAll() {
    const w = this.dig.world; this.needSync = false; this.live = new Set();
    for (const s of w.segs) this.segPrim(s);
    for (const n of w.nodes) this.nodePrims(n);
    for (const p of w.pits) this.pitPrim(p);
    for (const key of [...this.prims.keys()]) if (!this.live.has(key)) this.drop(key);
    this.live = null;
    for (const [id, s] of this.slots) if (!w.byId.has(id)) { this.slots.delete(id); this.free.push(s); this.glowData[s] = 0; this.glowTex.needsUpdate = true; }
  }

  // ---- the chunks ----------------------------------------------------------------------------------
  // one cell size over each joined component of chunks (26-neighbours): the finest any of them wants
  components() {
    const seeds = this.seeds; this.setChanged = false;
    for (const c of this.stale) { let h = 0.04; for (const k of c.prims) { const P = this.prims.get(k); if (P && P.hp < h) h = P.hp; } if (h !== c.wantH || !c.h) { c.wantH = h; seeds.add(c); } }
    this.stale.clear(); if (!seeds.size) return;
    // only the components a change touched (a created or emptied chunk, a chunk whose finest cell changed)
    const seen = new Set(), q = [];
    for (const c0 of seeds) {
      if (seen.has(c0) || this.chunks.get(c0.key) !== c0) continue;
      if (!c0.h) {   // a new chunk beside a component no coarser than it wants: it takes the component's cells (no walk)
        let nh = 0, mixed = false;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
          if (!di && !dj && !dk) continue; const o = this.chunks.get(ckey(c0.i + di, c0.j + dj, c0.k + dk)); if (!o) continue;
          if (!o.h || (nh && o.h !== nh)) mixed = true; else nh = o.h;
        }
        if (nh && !mixed && c0.wantH >= nh) { c0.h = nh; this.dirty.add(c0); seen.add(c0); continue; }
      }
      q.length = 0; q.push(c0); seen.add(c0); let h = c0.wantH;
      for (let qi = 0; qi < q.length; qi++) {
        const c = q[qi]; if (c.wantH < h) h = c.wantH;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
          if (!di && !dj && !dk) continue; const o = this.chunks.get(ckey(c.i + di, c.j + dj, c.k + dk)); if (o && !seen.has(o)) { seen.add(o); q.push(o); }
        }
      }
      for (const c of q) if (c.h !== h) { c.h = h; this.dirty.add(c); }
    }
    seeds.clear();
  }
  // the drawn ground and the spoil on it at (x, z) (scene z)
  groundAt(x, z) { return this.dig.heights.groundXZ ? this.dig.heights.groundXZ(x, z) : this.dig.heights.atXZ(x, z); }
  spoilAt(x, z, spoils) {
    let s = 0;
    for (const p of spoils) {
      const S = p.spoil;
      if (S.hole) {
        const dx = x - S.x, dz = z - S.z, al = Math.min(Math.max(dx * S.fx + dz * S.fz, 0), SPOIL_FAN * S.r);
        const rho = Math.hypot(dx - S.fx * al, dz - S.fz * al), t = Math.min(1, Math.max(0, (rho - SPOIL_IN * S.r) / ((SPOIL_OUT - SPOIL_IN) * S.r)));
        s += SPOIL_K * S.r * (1 - t * t * (3 - 2 * t));
      } else { const q = 1 - ((x - S.x) ** 2 + (z - S.z) ** 2) / (S.R * S.R); if (q > 0) s += S.h * q * Math.sqrt(q); }
    }
    return s;
  }
  job(c) {
    const h = c.h, n = Math.round(CH / h), ox = Math.round(c.i * CH / h) * h, oy = Math.round(c.j * CH / h) * h, oz = Math.round(c.k * CH / h) * h;
    const sdf = [], spoils = [];
    for (const k of c.prims) { const P = this.prims.get(k); if (!P) continue; if (P.d) { P.d.key = k; sdf.push(P.d); } else spoils.push(P); }
    const prims = new Float32Array(sdf.length * PSTRIDE); sdf.forEach((d, q) => prims.set(d, q * PSTRIDE));
    // the ground: none in a deep chunk (wholly under the ground by more than the lip and a few cells)
    const g5 = c.gs ||= new Float32Array(5), pts = [[ox, oz], [ox + CH, oz], [ox, oz + CH], [ox + CH, oz + CH], [ox + CH / 2, oz + CH / 2]];
    let gmin = Infinity; pts.forEach(([x, z], q) => { g5[q] = this.groundAt(x, z); gmin = Math.min(gmin, g5[q]); });
    const kL = kLfor(h), kJ = kJfor(h), deep = !spoils.length && !sdf.some(d => d[0] === T_PIT) && oy + CH + h < gmin - 0.05 - kL - 3 * h;   // (a pit's floor follows the drawn ground: never deep)
    // nothing carved within reach of the chunk's cells (its margin's empty chunks): no surface but bare ground, which is not kept
    const reach = Math.max(2 * h + kJ, PATCH_D + h), lo = [ox - h - reach, oy - h - reach, oz - h - reach], hi = [ox + CH + h + reach, oy + CH + h + reach, oz + CH + h + reach];
    const near = sdf.some(d => { const P = this.prims.get(d.key); const b = P?.box; return !b || (b[0] < hi[0] && b[3] > lo[0] && b[1] < hi[1] && b[4] > lo[1] && b[2] < hi[2] && b[5] > lo[2]); });
    let G = null, M = null;
    if (!deep) {
      const N = n + 2; G = new Float32Array(N * N); M = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = ox + (i - 1) * h, z = oz + (j - 1) * h, s = spoils.length ? this.spoilAt(x, z, spoils) : 0; G[j * N + i] = this.groundAt(x, z) - SINK + s; M[j * N + i] = s; }
    }
    c.ground = !deep;
    return { ox, oy, oz, h, n, kL, kJ, patchD: PATCH_D, prims, G, M, near };
  }
  send(c) {
    this.dirty.delete(c);
    if (!c.h) { this.dirty.add(c); return false; }
    const job = this.job(c); this.stats.jobs++;
    if (!job.near && !job.M?.some(v => v > 0.0005)) { this.apply(c, null); return false; }   // nothing carved in reach and no spoil: no surface
    if (!this.worker) { const t0 = performance.now(); const res = meshChunk(job); this.stats.workerMs += performance.now() - t0; this.apply(c, res); return true; }
    const jid = ++this.jid; c.busy = jid; this.busy.set(jid, c);
    const tr = [job.prims.buffer]; if (job.G) tr.push(job.G.buffer, job.M.buffer);
    this.workers[this.wi++ % this.workers.length].postMessage({ jid, job }, tr);
    return true;
  }
  onResult(m) {
    const c = this.busy.get(m.jid); this.busy.delete(m.jid); if (!c) return;
    c.busy = 0; if (m.error) { console.warn('dig mesher:', m.error); return; }
    this.stats.workerMs += m.ms || 0;
    if (this.chunks.get(c.key) !== c) return;
    this.apply(c, m.res);
  }
  apply(c, res) {
    c.res = res && res.idx.length ? res : null;
    const rk = ckey(floorDiv(c.i, REG), floorDiv(c.j, REG), floorDiv(c.k, REG));
    let R = this.regions.get(rk);
    if (!R) { R = { key: rk, i: floorDiv(c.i, REG), j: floorDiv(c.j, REG), k: floorDiv(c.k, REG), chunks: new Set(), dirty: true, mesh: null, xmesh: null, verts: 0, tris: 0 }; this.regions.set(rk, R); }
    if (c.region && c.region !== R) { c.region.chunks.delete(c); c.region.dirty = true; }
    c.region = R; R.chunks.add(c); R.dirty = true;
  }
  // a region's chunks into one geometry (one draw in the world, one in the underground view)
  rebuild(R) {
    R.dirty = false; this.stats.rebuilds++;
    let nv = 0, ni = 0; for (const c of R.chunks) if (c.res) { nv += c.res.pos.length / 3; ni += c.res.idx.length; }
    const old = R.mesh?.geometry;
    if (!nv) {
      if (R.mesh) { this.scene.remove(R.mesh, R.xmesh); R.mesh = R.xmesh = null; }
      old?.dispose(); R.verts = R.tris = 0;
      if (!R.chunks.size) this.regions.delete(R.key);
      return;
    }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), mix = new Float32Array(nv * 4), gref = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let v = 0, q = 0;
    for (const c of R.chunks) {
      const r = c.res; if (!r) continue;
      pos.set(r.pos, v * 3); nrm.set(r.nrm, v * 3); mix.set(r.mix, v * 4); gref.set(r.gref, v * 3);
      for (let t = 0; t < r.idx.length; t++) idx[q + t] = r.idx[t] + v;
      v += r.pos.length / 3; q += r.idx.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aMix', new THREE.BufferAttribute(mix, 4)); g.setAttribute('aGRef', new THREE.BufferAttribute(gref, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const S = REG * CH, cx = (R.i + 0.5) * S, cy = (R.j + 0.5) * S, cz = (R.k + 0.5) * S;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), S * 0.87 + 0.1);
    if (!R.mesh) {
      R.mesh = new THREE.Mesh(g, this.dirtMat); R.mesh.name = 'dirt'; R.mesh.renderOrder = 1;   // after the terrain: its depth hides the underground early
      R.xmesh = new THREE.Mesh(g, this.xrayMat); R.xmesh.name = 'dirt xray'; R.xmesh.layers.set(this.dig.XR); R.xmesh.renderOrder = 5; R.xmesh.visible = this.xrayOn;
      R.mesh.visible = false; R.mesh.matrixAutoUpdate = R.xmesh.matrixAutoUpdate = false;
      this.scene.add(R.mesh, R.xmesh); R.c = new THREE.Vector3(cx, cy, cz);
    } else { R.mesh.geometry = g; R.xmesh.geometry = g; }
    old?.dispose(); R.verts = nv; R.tris = ni / 3;
  }

  // ---- each frame ---------------------------------------------------------------------------------
  update() {
    if (this.needSync) this.syncAll();
    this.watchGround();
    if (this.stale.size || this.seeds.size) this.components();
    // the nearest changed chunks to the mesher (the worker: a few at a time; here: a few ms)
    if (this.dirty.size) {
      const P = this.dig.gc.flight.pos, L = [...this.dirty];
      if (L.length > 1) { const d = c => (c.i * CH - P.x) ** 2 + (c.j * CH - P.y) ** 2 + (c.k * CH - P.z) ** 2; L.sort((a, b) => d(a) - d(b)); }
      const t0 = performance.now();
      for (const c of L) {
        if (this.worker ? this.busy.size >= JOBS_MAX * this.workers.length : performance.now() - t0 > 4) break;
        if (c.busy) continue;
        this.send(c);
      }
    }
    // the changed regions into their geometry (the nearest first, a few a frame)
    let n = 0;
    for (const R of this.regions.values()) if (R.dirty && n++ < 6) this.rebuild(R);
    this.stats.chunks = this.chunks.size; this.stats.regions = this.regions.size;
  }
  // the drawn ground moved (the micro patch or the fine square under the player): a chunk with a mouth in it whose ground
  // changed by more than 2 mm is meshed again
  watchGround() {
    const H = this.dig.heights, M = H.micro, mv = M?.version ?? -1, fv = H.fine, W = this.gWatch, now = performance.now();
    if (mv === W.micro && fv === W.fine) return;
    if (now - W.t < 500) return;
    // where the drawn surface may have changed: the micro patch's square, old and new; anywhere near if the fine square moved
    const boxes = [];
    if (fv !== W.fine) { const P = this.dig.gc.flight.pos; boxes.push([P.x - 15, -P.z - 15, P.x + 15, -P.z + 15]); }
    if (M) boxes.push([M.x0, M.n0, M.x1, M.n1]); if (W.box) boxes.push(W.box);
    W.micro = mv; W.fine = fv; W.t = now; W.box = M ? [M.x0, M.n0, M.x1, M.n1] : null;
    for (const c of this.chunks.values()) {
      if (!c.ground || !c.gs || c.busy) continue;
      const ox = c.i * CH, on = -(c.k + 1) * CH;
      if (!boxes.some(b => ox + CH > b[0] && ox < b[2] && on + CH > b[1] && on < b[3])) continue;
      const oz = c.k * CH, pts = [[ox, oz], [ox + CH, oz], [ox, oz + CH], [ox + CH, oz + CH], [ox + CH / 2, oz + CH / 2]];
      if (pts.some(([x, z], q) => Math.abs(this.groundAt(x, z) - c.gs[q]) > 0.002)) this.dirty.add(c);
    }
  }
  // which regions are drawn (four times a second): in the world, those within VIS_OPEN of an opening (elsewhere the
  // ground hides them); in the underground view those within its reach
  visPass(opens, at) {
    const S = REG * CH * 0.87, C = this.dig.camera.position;
    for (const R of this.regions.values()) {
      if (!R.mesh) continue;
      let near = (C.x - R.c.x) ** 2 + (C.z - R.c.z) ** 2 < (VIS_FAR + S) ** 2;
      if (near) {
        near = false;
        for (const o of opens) { const r = VIS_OPEN + S + (o.r || 0); if ((o.x - R.c.x) ** 2 + ((o.y0 ?? o.y) - R.c.y) ** 2 + (o.z - R.c.z) ** 2 < r * r) { near = true; break; } }
      }
      R.mesh.visible = near;
      R.xmesh.visible = this.xrayOn && (!at || (at.x - R.c.x) ** 2 + (at.z - R.c.z) ** 2 < (XR_R + S) ** 2);
    }
  }
  setXray(on) { if (on === this.xrayOn) return; this.xrayOn = on; for (const R of this.regions.values()) if (R.xmesh) R.xmesh.visible = on; }
  counts() { let v = 0, t = 0; for (const R of this.regions.values()) { v += R.verts; t += R.tris; } this.stats.verts = v; this.stats.tris = t; return this.stats; }
  dispose() {
    for (const w of this.workers) w.terminate(); this.workers.length = 0;
    for (const R of this.regions.values()) { if (R.mesh) { this.scene.remove(R.mesh, R.xmesh); R.mesh.geometry.dispose(); } }
    this.regions.clear(); this.chunks.clear(); this.prims.clear();
    this.dirtMat.dispose(); this.xrayMat.dispose(); this.glowTex.dispose();
  }
}
