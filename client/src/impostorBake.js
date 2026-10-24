import * as THREE from 'three';
import { buildTree, leafTexture, LIBRARY, resolveSpecies } from './treegen.js';

// Impostor atlas, baked once at load from the real near-LOD trees (treegen), so a far tree has the
// silhouette of the tree that replaces it when you fly closer.
//
// Each tree gets VIEWS cells: four orthographic side views at azimuths 0, 45, 90 and 135 degrees
// (an orthographic view from the opposite side is the mirror image, so these give eight directions),
// and one view from straight above for the canopy cap. Two atlases share the layout:
//   albedo: sRGB colour with coverage in alpha (no lighting; the live shader lights it)
//   normal: the crown normal in the view's frame (x right, y up, z toward the viewer), 0..1 encoded
// Everything is drawn in one render: each tree is rotated and scaled into its cell under one
// orthographic camera, rendered at SS x supersampling into a small offscreen renderer, read back,
// box-filtered (soft alpha edges), padded so mips do not bleed dark fringes, and mip-mapped with
// alpha rescaled per level so the alpha-tested coverage holds (distant crowns do not thin out).
// The textures are plain DataTextures, so they upload to the main renderer like any other.

export const CELL = 128;          // texels per cell side
export const SIDE_VIEWS = 4;      // 0, 45, 90, 135 degrees; 180..315 are mirrored in the shader
export const VIEWS = SIDE_VIEWS + 1;
export const COLS = 10;           // two trees per atlas row
const SS = 2;                     // supersampling per axis
export const ALPHA_REF = 0.4;     // the live shader's alpha cutoff; mips preserve coverage at it

const VERT = /* glsl */`
  uniform mat3 viewRot;           // tree frame -> view frame, without the cell's non-uniform scale
  varying vec3 vC; varying vec3 vN; varying vec2 vUv;
  void main() {
    vC = color; vN = viewRot * normal; vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform sampler2D map; uniform float useMap; uniform float gain; uniform float mode;
  varying vec3 vC; varying vec3 vN; varying vec2 vUv;
  vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  void main() {
    vec3 c = vC;
    if (useMap > 0.5) { vec4 t = texture2D(map, vUv); if (t.a < 0.5) discard; c *= t.rgb * gain; }
    gl_FragColor = mode < 0.5 ? vec4(srgb(clamp(c, 0.0, 1.0)), 1.0) : vec4(normalize(vN) * 0.5 + 0.5, 1.0);
  }`;

// trees: [{ id, seed }] (canonical or alias ids). Returns { albedo, normal, frames, grid, ms, bytes }.
// frames[k] = { W, H, y0, capY, height, hmin, hmax, shrub, species } for tree k, in metres of the unscaled tree:
// height is this slot's own tree (a sapling or snag is its own size), hmin/hmax the species' mature range.
// extents: per cell (tree * VIEWS + view) [u0, u1, v0, v1], the covered part of the cell (0..1), so the
// live quads can be trimmed to it.
export function bakeImpostors(trees) {
  const t0 = performance.now();
  const rows = Math.ceil(trees.length * VIEWS / COLS), AW = COLS * CELL, AH = rows * CELL;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  const tCtx = performance.now();
  const rt = new THREE.WebGLRenderTarget(AW * SS, AH * SS, { depthBuffer: true, type: THREE.UnsignedByteType });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, AW, AH, 0, -4000, 4000);   // world units = atlas texels
  const frames = [], mats = [], geoms = [];
  const viewRot = v => v < SIDE_VIEWS ? new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationY(-v * Math.PI / 4))
    : new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const material = (map, gain, v) => {
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, vertexColors: true, side: map ? THREE.DoubleSide : THREE.FrontSide,
      uniforms: { map: { value: map }, useMap: { value: map ? 1 : 0 }, gain: { value: gain }, mode: { value: 0 }, viewRot: { value: viewRot(v) } } });
    mats.push(m); return m;
  };
  trees.forEach(({ id, seed }, k) => {
    const sid = resolveSpecies(id), spec = LIBRARY[sid], t = buildTree(sid, seed, 'near');
    geoms.push(t.trunk, t.canopy);
    // Frame: the cell spans the tree's full radius about its own base axis, and its full height.
    let r = 0, y0 = Infinity, y1 = -Infinity, cy0 = Infinity, cy1 = -Infinity;
    for (const [g, isCanopy] of [[t.trunk, false], [t.canopy, true]]) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        r = Math.max(r, Math.hypot(x, z)); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        if (isCanopy) { cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y); }
      }
    }
    const W = 2 * r * 1.02, H = (y1 - y0) * 1.01;
    frames.push({ W, H, y0, capY: (cy0 + cy1) / 2, height: t.height, hmin: spec.height_m[0], hmax: spec.height_m[1], shrub: !!spec.shrub, species: sid });
    const tex = leafTexture(spec), gain = 1 / tex.userData.mean;
    for (let v = 0; v < VIEWS; v++) {
      const idx = k * VIEWS + v, col = idx % COLS, row = Math.floor(idx / COLS);
      const o = new THREE.Group();
      if (v < SIDE_VIEWS) {
        // Rotate the tree so the view direction (azimuth v*45 from the tree) faces the camera (+z),
        // then map x in [-W/2, W/2] and y in [y0, y0 + H] onto the cell.
        o.scale.set(CELL / W, CELL / H, CELL / W);
        o.position.set((col + 0.5) * CELL, row * CELL - y0 * CELL / H, 0);
        o.rotation.set(0, -v * Math.PI / 4, 0);
      } else {
        // Top view: tree +y toward the camera, -z up the cell (u along +x, v along -z).
        o.scale.set(CELL / W, CELL / W, CELL / W);
        o.position.set((col + 0.5) * CELL, (row + 0.5) * CELL, -2000);
        o.rotation.set(Math.PI / 2, 0, 0);
      }
      o.add(new THREE.Mesh(t.trunk, material(null, 1, v)), new THREE.Mesh(t.canopy, material(tex, gain, v)));
      scene.add(o);
    }
  });
  const tGeom = performance.now();
  const read = mode => {
    for (const m of mats) m.uniforms.mode.value = mode;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
    const buf = new Uint8Array(AW * SS * AH * SS * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, AW * SS, AH * SS, buf);
    return buf;
  };
  const albedoSS = read(0), normalSS = read(1);
  const tRead = performance.now();
  const tRender = performance.now() - t0;
  renderer.setRenderTarget(null); rt.dispose(); for (const m of mats) m.dispose(); for (const g of geoms) g.dispose();
  renderer.dispose(); renderer.forceContextLoss();   // leaf textures are shared with the main renderer: not disposed

  const albedo = downsample(albedoSS, AW, AH, false), normal = downsample(normalSS, AW, AH, true);
  for (let i = 3; i < normal.length; i += 4) normal[i] = albedo[i];   // pad by the albedo's coverage
  const extents = cellExtents(albedo, AW, trees.length * VIEWS);
  const tDown = performance.now();
  pad(albedo, AW, AH); pad(normal, AW, AH);
  const tPad = performance.now();
  const albedoMips = mips(albedo, AW, AH, false), normalMips = mips(normal, AW, AH, true);
  const tMips = performance.now();
  const tex = (levels, srgb) => {
    const t = new THREE.DataTexture(levels[0].data, AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.mipmaps = levels; t.generateMipmaps = false;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; t.flipY = false;
    t.needsUpdate = true; return t;
  };
  const bytes = [albedoMips, normalMips].reduce((s, L) => s + L.reduce((a, l) => a + l.data.length, 0), 0);
  return { albedo: tex(albedoMips, true), normal: tex(normalMips, false), frames, extents, grid: [COLS, rows], size: [AW, AH],
    ms: performance.now() - t0, renderMs: tRender, ctxMs: tCtx - t0, geomMs: tGeom - tCtx, readMs: tRead - tGeom, downMs: tDown - t0 - tRender, padMs: tPad - tDown, mipMs: tMips - tPad, bytes };
}

// Covered box of each cell in cell units, with a 2-texel margin for the softer alpha of the mips.
function cellExtents(d, w, n) {
  const out = [];
  for (let c = 0; c < n; c++) {
    const cx = (c % COLS) * CELL, cy = Math.floor(c / COLS) * CELL;
    let x0 = CELL, x1 = -1, y0 = CELL, y1 = -1;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (d[((cy + y) * w + cx + x) * 4 + 3] > 0) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) { out.push([0.5, 0.5, 0, 0]); continue; }
    const m = 2;
    out.push([Math.max(0, x0 - m) / CELL, Math.min(CELL, x1 + 1 + m) / CELL, Math.max(0, y0 - m) / CELL, Math.min(CELL, y1 + 1 + m) / CELL]);
  }
  return out;
}

// SS x SS box filter. Colour is averaged over covered samples only (straight alpha); alpha is coverage.
function downsample(src, w, h, isNormal) {
  const out = new Uint8Array(w * h * 4), SW = w * SS;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const i = ((y * SS + dy) * SW + x * SS + dx) * 4;
      if (src[i + 3] > 127) { r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
    }
    const o = (y * w + x) * 4;
    if (n) {
      if (isNormal) {   // average of unit normals, renormalised
        let nx = r / n / 127.5 - 1, ny = g / n / 127.5 - 1, nz = b / n / 127.5 - 1; const l = Math.hypot(nx, ny, nz) || 1;
        out[o] = (nx / l * 0.5 + 0.5) * 255; out[o + 1] = (ny / l * 0.5 + 0.5) * 255; out[o + 2] = (nz / l * 0.5 + 0.5) * 255;
      } else { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; }
      out[o + 3] = Math.round(255 * n / (SS * SS));
    }
  }
  return out;
}

// Push colour into empty texels (alpha stays 0) from covered neighbours in the same cell, two rings
// deep, then fill the rest of each cell with its mean colour, so filtering and mips never pull in black.
function pad(d, w, h, rings = 2) {
  const filled = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) filled[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  const add = new Int32Array(w * h * 4);
  for (let it = 0; it < rings; it++) {
    let na = 0;
    for (let y = 0; y < h; y++) {
      const cy0 = y - (y % CELL), cy1 = cy0 + CELL - 1;
      for (let x = 0; x < w; x++) {
        const i = y * w + x; if (filled[i]) continue;
        const cx0 = x - (x % CELL), cx1 = cx0 + CELL - 1;
        let r = 0, g = 0, b = 0, n = 0, j;
        if (x < cx1 && filled[j = i + 1]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++; }
        if (x > cx0 && filled[j = i - 1]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++; }
        if (y < cy1 && filled[j = i + w]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++; }
        if (y > cy0 && filled[j = i - w]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++; }
        if (n) { add[na++] = i; add[na++] = r / n; add[na++] = g / n; add[na++] = b / n; }
      }
    }
    for (let k = 0; k < na; k += 4) { const i = add[k]; d[i * 4] = add[k + 1]; d[i * 4 + 1] = add[k + 2]; d[i * 4 + 2] = add[k + 3]; filled[i] = 1; }
  }
  for (let cy = 0; cy < h / CELL; cy++) for (let cx = 0; cx < w / CELL; cx++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy * CELL; y < (cy + 1) * CELL; y++) for (let x = cx * CELL, i = y * w + x; x < (cx + 1) * CELL; x++, i++) if (d[i * 4 + 3]) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++; }
    if (!n) continue;
    r /= n; g /= n; b /= n;
    for (let y = cy * CELL; y < (cy + 1) * CELL; y++) for (let x = cx * CELL, i = y * w + x; x < (cx + 1) * CELL; x++, i++) if (!filled[i]) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; }
  }
}

// Mip chain down to one texel per cell (cells never mix). Colour is alpha-weighted; alpha is scaled
// per level so the fraction of texels above ALPHA_REF matches level 0, cell by cell (Castano 2010).
function mips(d0, w0, h0, isNormal) {
  const levels = [{ data: d0, width: w0, height: h0 }];
  const cellsX = w0 / CELL, cellsY = h0 / CELL;
  const coverage = (d, w, h, cx, cy, cs, scale = 1) => {
    let n = 0; for (let y = cy * cs; y < (cy + 1) * cs; y++) for (let x = cx * cs; x < (cx + 1) * cs; x++) if (d[(y * w + x) * 4 + 3] * scale >= ALPHA_REF * 255) n++;
    return n / (cs * cs);
  };
  const target = [];
  for (let cy = 0; cy < cellsY; cy++) for (let cx = 0; cx < cellsX; cx++) target.push(coverage(d0, w0, h0, cx, cy, CELL));
  let src = d0, w = w0, h = h0, cs = CELL;
  while (cs > 1) {
    const nw = w >> 1, nh = h >> 1, d = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0, rr = 0, gg = 0, bb = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((2 * y + dy) * w + 2 * x + dx) * 4, al = src[i + 3];
        r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; rr += src[i]; gg += src[i + 1]; bb += src[i + 2];
      }
      const o = (y * nw + x) * 4;
      if (a > 0) { d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; } else { d[o] = rr / 4; d[o + 1] = gg / 4; d[o + 2] = bb / 4; }
      if (isNormal) {
        const nx = d[o] / 127.5 - 1, ny = d[o + 1] / 127.5 - 1, nz = d[o + 2] / 127.5 - 1, l = Math.hypot(nx, ny, nz) || 1;
        d[o] = (nx / l * 0.5 + 0.5) * 255; d[o + 1] = (ny / l * 0.5 + 0.5) * 255; d[o + 2] = (nz / l * 0.5 + 0.5) * 255;
      }
      d[o + 3] = a / 4;
    }
    cs >>= 1;
    if (!isNormal) for (let cy = 0; cy < cellsY; cy++) for (let cx = 0; cx < cellsX; cx++) {
      const want = target[cy * cellsX + cx]; if (want <= 0) continue;
      let lo = 0.5, hi = 8;
      for (let it = 0; it < 10; it++) { const m = (lo + hi) / 2; if (coverage(d, nw, nh, cx, cy, cs, m) < want) lo = m; else hi = m; }
      for (let y = cy * cs; y < (cy + 1) * cs; y++) for (let x = cx * cs; x < (cx + 1) * cs; x++) { const i = (y * nw + x) * 4 + 3; d[i] = Math.min(255, d[i] * hi); }
    }
    levels.push({ data: d, width: nw, height: nh });
    src = d; w = nw; h = nh;
  }
  return levels;
}
