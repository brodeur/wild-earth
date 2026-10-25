// Standalone WebGL vs WebGPU benchmark (client/webgpu_test.html, docs/webgpu-evaluation.md).
// Not part of the client and imports nothing from it. The scene stands for the client's load:
//   - a terrain mesh of ~1.0 M triangles, lambert sun + two texture samples + height haze;
//   - CARDS instanced crossed cards (two quads each) in DRAWS spatial chunks, one vec4 position/scale
//     and one vec4 yaw/tint/phase instance attribute, a vertex wind sway, a leaf alpha texture
//     sharpened for alpha-to-coverage under 4x MSAA, and a screen-space interleaved-gradient-noise
//     dither fade by distance (the client's tier hand-over trick);
//   - a full-screen sky dome with a gradient, a sun lobe and four octaves of value-noise cloud;
//   - one shared "atmosphere" function (height haze to the horizon colour) used by all three, as the
//     client's ATMOSPHERE_GLSL chunk is.
// The same scene is written twice: GLSL ShaderMaterials for WebGLRenderer (how the client works
// today) and TSL node materials for WebGPURenderer (what a port would look like). Nothing else
// differs: same geometry, instance buffers, textures, camera, time and drawing-buffer size.

const P = new URLSearchParams(location.search);
const MODE = P.get('r') || 'webgl';                 // webgl | webgpu | webgpu-gl
const CARDS = +(P.get('cards') || 100000);
const DRAWS = +(P.get('draws') || 196);             // rounded to a square grid of chunks
const VIEW = P.get('view') || 'high';               // high (150 m up) | low (20 m) | ground (2 m)
const W = +(P.get('w') || 1920), H = +(P.get('h') || 1080);
const SEG = +(P.get('seg') || 708);                 // 708 x 708 quads = 1.003 M triangles
const MSAA = P.get('msaa') !== '0';
const FRAMES = +(P.get('frames') || 240);
const COMPUTE = P.get('compute') === '1';
const TONEMAP = P.get('tm') !== '0';                // tm=0: no tone mapping, linear output (no output pass on WebGPURenderer)
const AREA = 1600;                                  // cards cover AREA x AREA m around the origin
const TERRAIN = 4000;                               // terrain is TERRAIN x TERRAIN m
const FADE_NEAR = 900, FADE_FAR = 1300;             // card dither fade band (m)

const out = document.getElementById('out');
const log = s => { out.textContent += '\n' + s; };
out.textContent = `mode ${MODE}, ${CARDS} cards in ${DRAWS} draws, view ${VIEW}, ${W}x${H}, msaa ${MSAA}`;
const RESULT = window.RESULT = { mode: MODE, cards: CARDS, view: VIEW, toneMap: TONEMAP, w: W, h: H, msaa: MSAA, ua: navigator.userAgent };

// ---- shared CPU data ----------------------------------------------------------------------------

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Height field: six sine octaves (also written in TSL for the compute test, identically).
const HT = [[60, 0.0011, 0.0013, 0, 0], [25, 0.0047, 0.0041, 1.3, 0.7], [11, 0.0093, 0.0101, 2.1, 0.3],
  [6, 0.019, 0.017, 0.4, 1.9], [3, 0.041, 0.037, 2.7, 1.1], [1.5, 0.083, 0.079, 0.9, 2.4]];
function height(x, z) { let h = 0; for (const [a, fx, fz, px, pz] of HT) h += a * Math.sin(x * fx + px) * Math.cos(z * fz + pz); return h; }

function makeTerrain(THREE) {
  const g = new THREE.PlaneGeometry(TERRAIN, TERRAIN, SEG, SEG); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// Card placement on the CPU, the analogue of the client's per-cell grass / shrub / rock generation.
function placeCards(n, seed = 7) {
  const r = mulberry32(seed), pos = new Float32Array(n * 4), rot = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * AREA, z = (r() - 0.5) * AREA, s = 3 + 6 * r() * r();
    pos.set([x, height(x, z) - 0.2, z, s], i * 4);
    rot.set([r() * Math.PI, r(), r() * 6.283, 0], i * 4);
  }
  return { pos, rot };
}

function cardBase(THREE) {   // two crossed unit quads, base at y=0, 8 vertices, 4 triangles
  const P = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0, 0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5];
  const U = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  return { position: new THREE.BufferAttribute(new Float32Array(P), 3), uv: new THREE.BufferAttribute(new Float32Array(U), 2),
    index: new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]), 1) };
}

// Split the instances into a grid of spatial chunks, one InstancedBufferGeometry each (frustum-culled
// by three like the client's sectors), all sharing the base attributes.
function makeChunks(THREE, data) {
  const base = cardBase(THREE), k = Math.max(1, Math.round(Math.sqrt(DRAWS))), cell = AREA / k;
  const buckets = Array.from({ length: k * k }, () => []);
  for (let i = 0; i < CARDS; i++) {
    const cx = Math.min(k - 1, Math.floor((data.pos[i * 4] / AREA + 0.5) * k)), cz = Math.min(k - 1, Math.floor((data.pos[i * 4 + 2] / AREA + 0.5) * k));
    buckets[cz * k + cx].push(i);
  }
  return buckets.filter(b => b.length).map(b => {
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(base.index); g.setAttribute('position', base.position); g.setAttribute('uv', base.uv);
    const ip = new Float32Array(b.length * 4), ir = new Float32Array(b.length * 4);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    b.forEach((i, j) => {
      for (let c = 0; c < 4; c++) { ip[j * 4 + c] = data.pos[i * 4 + c]; ir[j * 4 + c] = data.rot[i * 4 + c]; }
      x0 = Math.min(x0, ip[j * 4]); x1 = Math.max(x1, ip[j * 4]); z0 = Math.min(z0, ip[j * 4 + 2]); z1 = Math.max(z1, ip[j * 4 + 2]);
      y0 = Math.min(y0, ip[j * 4 + 1]); y1 = Math.max(y1, ip[j * 4 + 1] + ip[j * 4 + 3]);
    });
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 4)); g.setAttribute('iRot', new THREE.InstancedBufferAttribute(ir, 4));
    g.instanceCount = b.length;
    const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    g.boundingSphere = new THREE.Sphere(c, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 10);
    return g;
  });
}

// Leaf-cluster alpha texture (blobs inside a crown outline, a trunk stripe) and a ground texture.
function leafTexture(THREE) {
  const N = 256, d = new Uint8Array(N * N * 4), r = mulberry32(3), blobs = [];
  for (let i = 0; i < 70; i++) { const a = r() * 6.283, rr = Math.sqrt(r()) * 0.42; blobs.push([0.5 + Math.cos(a) * rr, 0.58 + Math.sin(a) * rr * 0.9, 0.03 + 0.05 * r(), r()]); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N; let a = 0, s = 0;
    for (const [bx, by, br, bs] of blobs) { const q = Math.hypot(u - bx, v - by) / br; if (q < 1) { a = 1; s = Math.max(s, bs * (1 - q)); } }
    const trunk = Math.abs(u - 0.5) < 0.025 && v < 0.35;
    const o = (y * N + x) * 4;
    d[o] = trunk ? 90 : 150 + 100 * s; d[o + 1] = trunk ? 70 : 190 + 60 * s; d[o + 2] = trunk ? 50 : 120 + 60 * s; d[o + 3] = a || trunk ? 255 : 0;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
function groundTexture(THREE) {
  const N = 512, d = new Uint8Array(N * N * 4), r = mulberry32(5), lat = new Float32Array(64 * 64).map(() => r());
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, L = (i, j) => lat[((j & 63) * 64) + (i & 63)];
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return (L(xi, yi) * (1 - ux) + L(xi + 1, yi) * ux) * (1 - uy) + (L(xi, yi + 1) * (1 - ux) + L(xi + 1, yi + 1) * ux) * uy; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let n = 0, a = 0.5, f = 8 / N; for (let o = 0; o < 5; o++) { n += a * vn(x * f, y * f); a *= 0.5; f *= 2; }
    const o = (y * N + x) * 4; d[o] = 120 + 110 * n; d[o + 1] = 110 + 90 * n; d[o + 2] = 70 + 60 * n; d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

const SUN = [0.45, 0.62, -0.64], SUN_L = [3.0, 2.85, 2.6], AMB = [0.42, 0.48, 0.58], HAZE = [0.62, 0.72, 0.86];

// ---- WebGLRenderer path: GLSL ShaderMaterials -------------------------------------------------

const ATMO_GLSL = /* glsl */`
  uniform vec3 hazeColor; uniform vec3 sunDir; uniform vec3 sunLight; uniform vec3 ambient; uniform float uTime;
  vec3 atmo(vec3 col, vec3 wp) {
    float d = length(wp - cameraPosition);
    float f = 1.0 - exp(-d * 1.1e-4 * exp(-max(wp.y, 0.0) / 800.0));
    return mix(col, hazeColor, f);
  }
  float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
`;
const OUT_GLSL = TONEMAP ? '#include <tonemapping_fragment>\n#include <colorspace_fragment>' : '';

function glMaterials(THREE, tex) {
  const U = () => ({ hazeColor: { value: new THREE.Color(...HAZE) }, sunDir: { value: new THREE.Vector3(...SUN).normalize() },
    sunLight: { value: new THREE.Color(...SUN_L) }, ambient: { value: new THREE.Color(...AMB) }, uTime: shared.uTime });
  const shared = { uTime: { value: 0 } };
  const terrain = new THREE.ShaderMaterial({ uniforms: { ...U(), ground: { value: tex.ground } },
    vertexShader: /* glsl */`varying vec3 vW; varying vec3 vN;
      void main() { vW = position; vN = normal; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: ATMO_GLSL + /* glsl */`uniform sampler2D ground; varying vec3 vW; varying vec3 vN;
      void main() {
        vec3 alb = texture2D(ground, vW.xz / 37.0).rgb * texture2D(ground, vW.xz / 410.0).rgb * 1.4;
        float l = max(dot(normalize(vN), sunDir), 0.0);
        vec3 col = alb * 0.55 * (ambient + sunLight * l);
        gl_FragColor = vec4(atmo(col, vW), 1.0);
        ${OUT_GLSL}
      }` });
  const cards = new THREE.ShaderMaterial({ uniforms: { ...U(), leaf: { value: tex.leaf } }, side: THREE.DoubleSide, alphaToCoverage: MSAA,
    vertexShader: /* glsl */`attribute vec4 iPos; attribute vec4 iRot; uniform float uTime; varying vec2 vUv; varying vec3 vW; varying float vTint;
      void main() {
        float c = cos(iRot.x), s = sin(iRot.x);
        vec3 p = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c) * iPos.w;
        float sway = sin(uTime * 1.7 + iRot.z) * 0.04 * iPos.w * uv.y * uv.y;
        p.x += sway; p.z += sway * 0.6;
        vW = p + iPos.xyz; vUv = uv; vTint = iRot.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: ATMO_GLSL + /* glsl */`uniform sampler2D leaf; varying vec2 vUv; varying vec3 vW; varying float vTint;
      void main() {
        float fade = 1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, length(vW - cameraPosition));
        float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (n >= fade) discard;
        vec4 t = texture2D(leaf, vUv);
        float a = clamp((t.a - 0.5) / max(fwidth(t.a), 1e-4) + 0.5, 0.0, 1.0);
        vec3 base = mix(vec3(0.16, 0.22, 0.09), vec3(0.34, 0.31, 0.15), vTint) * t.rgb;
        vec3 col = base * (ambient + sunLight * (0.3 + 0.7 * vUv.y));
        gl_FragColor = vec4(atmo(col, vW), a);
        ${OUT_GLSL}
      }` });
  const sky = new THREE.ShaderMaterial({ uniforms: U(), side: THREE.BackSide, depthWrite: false,
    vertexShader: /* glsl */`varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: ATMO_GLSL + /* glsl */`varying vec3 vW;
      void main() {
        vec3 dir = normalize(vW - cameraPosition);
        vec3 col = mix(hazeColor, vec3(0.22, 0.42, 0.78), pow(max(dir.y, 0.0), 0.5));
        col += vec3(1.0, 0.9, 0.7) * pow(max(dot(dir, sunDir), 0.0), 300.0) * 4.0;
        vec2 q = dir.xz / (max(dir.y, 0.0) + 0.08) * 3.0 + uTime * 0.01;
        float c = 0.0, amp = 0.5; for (int o = 0; o < 4; o++) { c += amp * vnoise(q); q *= 2.03; amp *= 0.5; }
        col = mix(col, vec3(1.05), smoothstep(0.45, 0.8, c) * smoothstep(0.0, 0.15, dir.y));
        gl_FragColor = vec4(col, 1.0);
        ${OUT_GLSL}
      }` });
  return { terrain, cards, sky, uTime: shared.uTime };
}

// ---- WebGPURenderer path: TSL node materials ---------------------------------------------------

function tslMaterials(THREE, T, tex) {
  const { Fn, uniform, attribute, vec2, vec3, vec4, float, positionGeometry, positionWorld, cameraPosition, screenCoordinate,
    texture, uv, mix, smoothstep, fract, dot, sin, cos, exp, max, clamp, normalize, length, floor, pow, fwidth, normalWorld, Loop } = T;
  const hazeColor = uniform(new THREE.Color(...HAZE)), sunDir = uniform(new THREE.Vector3(...SUN).normalize());
  const sunLight = uniform(new THREE.Color(...SUN_L)), ambient = uniform(new THREE.Color(...AMB)), uTime = uniform(0);
  // The shared chunk: in TSL a JS function returning nodes, imported where GLSL would be concatenated.
  const atmo = (col, wp) => {
    const d = length(wp.sub(cameraPosition));
    const f = float(1).sub(exp(d.mul(-1.1e-4).mul(exp(max(wp.y, 0).div(-800)))));
    return mix(col, hazeColor, f);
  };
  const hash12 = p => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
  const vnoise = p => {
    const i = floor(p), f = fract(p), u = f.mul(f).mul(f.mul(-2).add(3));
    return mix(mix(hash12(i), hash12(i.add(vec2(1, 0))), u.x), mix(hash12(i.add(vec2(0, 1))), hash12(i.add(vec2(1, 1))), u.x), u.y);
  };

  const terrain = new THREE.MeshBasicNodeMaterial();
  terrain.colorNode = Fn(() => {
    const wp = positionWorld;
    const alb = texture(tex.ground, wp.xz.div(37)).rgb.mul(texture(tex.ground, wp.xz.div(410)).rgb).mul(1.4);
    const l = max(dot(normalize(normalWorld), sunDir), 0);
    const col = alb.mul(0.55).mul(ambient.add(sunLight.mul(l)));
    return vec4(atmo(col, wp), 1);
  })();

  const cards = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  cards.alphaToCoverage = MSAA;
  const iPos = attribute('iPos', 'vec4'), iRot = attribute('iRot', 'vec4');
  cards.positionNode = Fn(() => {
    const p = positionGeometry, c = cos(iRot.x), s = sin(iRot.x), vy = uv().y;
    const sway = sin(uTime.mul(1.7).add(iRot.z)).mul(0.04).mul(iPos.w).mul(vy.mul(vy));
    const x = p.x.mul(c).sub(p.z.mul(s)).mul(iPos.w).add(sway), z = p.x.mul(s).add(p.z.mul(c)).mul(iPos.w).add(sway.mul(0.6));
    return vec3(x, p.y.mul(iPos.w), z).add(iPos.xyz);
  })();
  cards.colorNode = Fn(() => {
    const wp = positionWorld;
    const fade = float(1).sub(smoothstep(FADE_NEAR, FADE_FAR, length(wp.sub(cameraPosition))));
    const n = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
    n.greaterThanEqual(fade).discard();
    const t = texture(tex.leaf, uv());
    const a = clamp(t.a.sub(0.5).div(max(fwidth(t.a), 1e-4)).add(0.5), 0, 1);
    const base = mix(vec3(0.16, 0.22, 0.09), vec3(0.34, 0.31, 0.15), iRot.y).mul(t.rgb);
    const col = base.mul(ambient.add(sunLight.mul(uv().y.mul(0.7).add(0.3))));
    return vec4(atmo(col, wp), a);
  })();

  const sky = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  sky.colorNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const col = mix(hazeColor, vec3(0.22, 0.42, 0.78), pow(max(dir.y, 0), 0.5)).toVar();
    col.addAssign(vec3(1.0, 0.9, 0.7).mul(pow(max(dot(dir, sunDir), 0), 300).mul(4)));
    const q = dir.xz.div(max(dir.y, 0).add(0.08)).mul(3).add(uTime.mul(0.01)).toVar();
    const c = float(0).toVar(), amp = float(0.5).toVar();
    Loop(4, () => { c.addAssign(amp.mul(vnoise(q))); q.mulAssign(2.03); amp.mulAssign(0.5); });
    col.assign(mix(col, vec3(1.05), smoothstep(0.45, 0.8, c).mul(smoothstep(0, 0.15, dir.y))));
    return vec4(col, 1);
  })();
  return { terrain, cards, sky, uTime };
}

// GPU placement: the same six-octave height field and per-instance randoms in a compute shader,
// written to a storage buffer the cards could draw from directly.
function tslPlacement(THREE, T, n) {
  const { Fn, storage, instanceIndex, hash, vec4, float, sin, cos } = T;
  const attr = new THREE.StorageInstancedBufferAttribute(new Float32Array(n * 4), 4);
  const buf = storage(attr, 'vec4', n);
  const node = Fn(() => {
    const i = instanceIndex;
    const x = hash(i).sub(0.5).mul(AREA), z = hash(i.add(104729)).sub(0.5).mul(AREA), r = hash(i.add(7919));
    let h = float(0);
    for (const [a, fx, fz, px, pz] of HT) h = h.add(sin(x.mul(fx).add(px)).mul(cos(z.mul(fz).add(pz))).mul(a));
    buf.element(i).assign(vec4(x, h.sub(0.2), z, r.mul(r).mul(6).add(3)));
  })().compute(n);
  return node;
}

// ---- run ---------------------------------------------------------------------------------------

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
const r2 = x => Math.round(x * 100) / 100;
const raf = () => new Promise(r => requestAnimationFrame(r));
const mc = new MessageChannel(); const yieldTask = () => new Promise(r => { mc.port1.onmessage = r; mc.port2.postMessage(0); });

async function main() {
  const webgpu = MODE !== 'webgl';
  if (webgpu && MODE === 'webgpu' && !navigator.gpu) throw new Error('navigator.gpu missing: no WebGPU in this browser');
  const THREE = webgpu ? await import('three/webgpu') : await import('three');
  RESULT.three = THREE.REVISION;

  const t0 = performance.now();
  let renderer;
  if (webgpu) {
    renderer = new THREE.WebGPURenderer({ antialias: MSAA, powerPreference: 'high-performance', forceWebGL: MODE === 'webgpu-gl', trackTimestamp: true });
    await renderer.init();
    RESULT.backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (fallback)';
    if (renderer.backend.isWebGPUBackend) {
      const info = (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }))?.info || {};
      RESULT.adapter = [info.vendor, info.architecture, info.description].filter(Boolean).join(' / ');
      RESULT.timestampQuery = renderer.backend.trackTimestamp === true || (renderer.hasFeature?.('timestamp-query') ?? false);
    }
  } else {
    renderer = new THREE.WebGLRenderer({ antialias: MSAA, powerPreference: 'high-performance' });
    RESULT.backend = 'WebGL2';
  }
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.toneMapping = TONEMAP ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.outputColorSpace = TONEMAP ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  document.body.prepend(renderer.domElement);
  const gl = !webgpu ? renderer.getContext() : (renderer.backend.isWebGPUBackend ? null : renderer.backend.gl);
  if (gl) { const dbg = gl.getExtension('WEBGL_debug_renderer_info'); RESULT.adapter = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }
  RESULT.initMs = r2(performance.now() - t0);

  // GPU sync: WebGPU waits on the queue; WebGL on a fence, polled between tasks (the status of a
  // WebGL sync object can only change between tasks).
  const sync = async () => {
    if (!gl) return renderer.backend.device.queue.onSubmittedWorkDone();
    const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    while (gl.clientWaitSync(s, 0, 0) === gl.TIMEOUT_EXPIRED) await yieldTask();
    gl.deleteSync(s);
  };

  // Scene
  let tc = performance.now();
  const data = placeCards(CARDS);
  RESULT.cpuPlaceMs = r2(performance.now() - tc);
  const tex = { leaf: leafTexture(THREE), ground: groundTexture(THREE) };
  const M = webgpu ? tslMaterials(THREE, await import('three/tsl'), tex) : glMaterials(THREE, tex);
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), M.sky); sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
  const terrain = new THREE.Mesh(makeTerrain(THREE), M.terrain); scene.add(terrain);
  const chunks = makeChunks(THREE, data);
  for (const g of chunks) scene.add(new THREE.Mesh(g, M.cards));
  RESULT.chunks = chunks.length;
  RESULT.sceneBuildMs = r2(performance.now() - tc);

  const camera = new THREE.PerspectiveCamera(60, W / H, 0.5, 20000);
  const views = { high: [0, 150, 700, 0, 0, -200], low: [0, 20, 300, 0, 8, -200], ground: [0, 2, 120, 0, 2.5, -200] };
  const [cx, ch, cz, tx, th, tz] = views[VIEW] || views.high;
  camera.position.set(cx, height(cx, cz) + ch, cz); camera.lookAt(tx, height(tx, tz) + th, tz);
  sky.position.copy(camera.position); sky.updateMatrixWorld();

  let frame = 0;
  const draw = () => { M.uTime.value = (frame++) / 60; renderer.render(scene, camera); };

  // First frame: includes shader compilation / pipeline creation.
  tc = performance.now(); draw(); await sync();
  RESULT.firstFrameMs = r2(performance.now() - tc);
  for (let i = 0; i < 30; i++) { await raf(); draw(); }
  const info = renderer.info.render;
  RESULT.triangles = info.triangles; RESULT.drawCalls = info.drawCalls ?? info.calls;

  // 1) Uncapped GPU-bound throughput: 60 frames back to back, then wait for the GPU. Nine runs.
  const thr = [];
  for (let run = 0; run < 9; run++) {
    await sync(); const s = performance.now();
    for (let i = 0; i < 60; i++) draw();
    await sync(); thr.push((performance.now() - s) / 60);
    await raf();
  }
  RESULT.uncappedMsPerFrame = r2(median(thr)); RESULT.uncappedRuns = thr.map(r2);

  // 2) Presented frames (vsync-capped): rAF deltas and the CPU time spent in render().
  const dts = [], cpu = []; let last = performance.now();
  for (let i = 0; i < FRAMES; i++) {
    await raf(); const now = performance.now(); dts.push(now - last); last = now;
    const s = performance.now(); draw(); cpu.push(performance.now() - s);
  }
  RESULT.rafMedianMs = r2(median(dts)); RESULT.rafP95Ms = r2(pct(dts, 0.95)); RESULT.rafFps = r2(1000 / median(dts));
  RESULT.cpuRenderMedianMs = r2(median(cpu));

  // 3) GPU timestamps: WebGPU timestamp-query through WebGPURenderer (trackTimestamp), or
  //    EXT_disjoint_timer_query_webgl2 around WebGLRenderer.render().
  const gpu = [];
  if (webgpu && RESULT.timestampQuery) {
    for (let i = 0; i < 90; i++) {
      await raf(); M.uTime.value = (frame++) / 60;
      if (renderer.resolveTimestampsAsync) { renderer.render(scene, camera); await renderer.resolveTimestampsAsync('render'); }   // r171+
      else await renderer.renderAsync(scene, camera);                                                                       // r170
      await sync(); await yieldTask();
      if (i > 10 && renderer.info.render.timestamp > 0) gpu.push(renderer.info.render.timestamp);
    }
  } else if (!webgpu) {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    RESULT.timestampQuery = !!ext;
    if (ext) {
      const pending = [];
      for (let i = 0; i < 90; i++) {
        await raf();
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); draw(); gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q);
        for (let j = 0; j < pending.length; j++) {
          const pq = pending[j];
          if (gl.getQueryParameter(pq, gl.QUERY_RESULT_AVAILABLE)) {
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(pq, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(pq); pending.splice(j--, 1);
          }
        }
      }
    }
  }
  if (gpu.length) { RESULT.gpuTimestampMedianMs = r2(median(gpu)); RESULT.gpuTimestampSamples = gpu.length; }

  // 4) Placement on the GPU against the CPU (WebGPURenderer only).
  if (COMPUTE && webgpu) {
    const T = await import('three/tsl');
    for (const n of [CARDS, CARDS * 10]) {
      const node = tslPlacement(THREE, T, n);
      await renderer.computeAsync(node); await sync();      // first dispatch builds the pipeline
      const ts = [];
      for (let k = 0; k < 10; k++) { await sync(); const s = performance.now(); renderer.compute(node); await sync(); ts.push(performance.now() - s); }
      const sc = performance.now(); placeCards(n, 11); const cpuMs = performance.now() - sc;
      RESULT[`place${n}`] = { gpuDispatchPlusSyncMs: r2(median(ts)), cpuMs: r2(cpuMs) };
    }
  }

  out.textContent = JSON.stringify(RESULT, null, 1);
  document.title = 'done';
  renderer.setAnimationLoop?.(null);
}

main().catch(e => { RESULT.error = String(e && e.stack || e); log('ERROR ' + RESULT.error); document.title = 'error'; console.error(e); });
