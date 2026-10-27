import * as THREE from 'three';
import { buildTree, leafTexture, LIBRARY, resolveSpecies } from './treegen.js';
import { drain } from './slice.js';

// Impostor atlas, baked once at load from the real near-LOD trees (treegen), so a far tree has the
// silhouette of the tree that replaces it when you fly closer. Slots that share a tree (vegetation.js
// gives each age class several slots with one seed) are baked once: `index` maps each input to its cell row.
//
// Each tree gets VIEWS cells: four orthographic side views at azimuths 0, 45, 90 and 135 degrees
// (an orthographic view from the opposite side is the mirror image, so these give eight directions),
// and one view from straight above for the canopy cap. Two atlases share the layout:
//   albedo: sRGB colour with coverage in alpha (no lighting; the live shader lights it)
//   normal: the crown normal in the view's frame (x right, y up, z toward the viewer), 0..1 encoded.
//           Averaged, never renormalised: a texel that covers lobes facing different ways stores a
//           short normal, and the live shader lights it as that spread (Toksvig-style prefiltering),
//           so a far crown of a few pixels shades as a crown instead of as per-pixel noise.
// Everything is drawn in one render: each tree is rotated and scaled into its cell under one
// orthographic camera, rendered at SS x supersampling into a small offscreen renderer, read back,
// box-filtered (soft alpha edges), padded so mips do not bleed dark fringes, and mip-mapped with
// alpha shifted per level so the alpha-tested coverage holds (distant crowns do not thin out). The
// shift (not a scale, which saturates the outer texels and squares a small crown off into its cell)
// keeps each level's alpha linear, so the cutoff contour of the filtered texture is a smooth isoline.
// Each tree is drawn inside a margin of its cell (PAD), so the softer coarse levels round off inside
// the cell instead of being cut flat by its edge.
// The textures are plain DataTextures, so they upload to the main renderer like any other.

export const CELL = 128;          // texels per cell side
const PAD = 6;                    // empty texels on each side of the tree in its cell
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

// trees: [{ id, seed }] (canonical or alias ids). Returns { albedo, normal, frames, extents, index, grid, ms, bytes }.
// index[k]: the baked tree (cell row) for input k; inputs with the same species and seed share one.
// frames[t] = { W, H, y0, capY, height, hmin, hmax, shrub, species, thin } for baked tree t, in metres of the
// unscaled tree: W x H from y0 is the whole cell (the tree and its margin), height is this slot's own tree (a
// sapling or snag is its own size), hmin/hmax the species' mature range, thin the mean needle thinness of the
// species' card texture (0 for broadleaves; the live shader's light through needles).
// extents: per cell (tree * VIEWS + view) [u0, u1, v0, v1], the part of the cell any mip level covers
// (0..1), so the live quads can be trimmed to it.
// bakeSteps is the same bake as a generator that yields between trees, read-back bands and rows of the CPU passes
// (slice.js runSliced steps it while the opening screen is up); bakeImpostors runs it in one go. The atlas is identical.
const READ_BAND = 512;   // rows of the supersampled target read back per step
export function bakeImpostors(input) { return drain(bakeSteps(input)); }
export function* bakeSteps(input) {
  const t0 = performance.now();
  const keyOf = ({ id, seed }) => `${resolveSpecies(id)}:${seed}`, at = new Map(), trees = [];
  const index = input.map(t => { const k = keyOf(t); if (!at.has(k)) { at.set(k, trees.length); trees.push(t); } return at.get(k); });
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
  yield;
  for (let k = 0; k < trees.length; k++) {
    const { id, seed } = trees[k];
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
    const W = 2 * r * 1.02, H = (y1 - y0) * 1.01, f = (CELL - 2 * PAD) / CELL;   // the tree spans f of its cell
    const tex = leafTexture(spec), gain = 1 / tex.userData.mean;
    frames.push({ W: W / f, H: H / f, y0: y0 - PAD / CELL * H / f, capY: (cy0 + cy1) / 2, height: t.height, hmin: spec.height_m[0], hmax: spec.height_m[1],
      shrub: !!spec.shrub, species: sid, thin: needleThinness(tex) });
    for (let v = 0; v < VIEWS; v++) {
      const idx = k * VIEWS + v, col = idx % COLS, row = Math.floor(idx / COLS);
      const o = new THREE.Group();
      if (v < SIDE_VIEWS) {
        // Rotate the tree so the view direction (azimuth v*45 from the tree) faces the camera (+z),
        // then map x in [-W/2, W/2] and y in [y0, y0 + H] onto the cell.
        o.scale.set(f * CELL / W, f * CELL / H, f * CELL / W);
        o.position.set((col + 0.5) * CELL, row * CELL + PAD - y0 * f * CELL / H, 0);
        o.rotation.set(0, -v * Math.PI / 4, 0);
      } else {
        // Top view: tree +y toward the camera, -z up the cell (u along +x, v along -z).
        o.scale.set(f * CELL / W, f * CELL / W, f * CELL / W);
        o.position.set((col + 0.5) * CELL, (row + 0.5) * CELL, -2000);
        o.rotation.set(Math.PI / 2, 0, 0);
      }
      o.add(new THREE.Mesh(t.trunk, material(null, 1, v)), new THREE.Mesh(t.canopy, material(tex, gain, v)));
      scene.add(o);
    }
    yield;
  }
  const tGeom = performance.now();
  // The bake's programs, compiled in parallel by the driver before the first render (runSliced waits for the promise;
  // drain does not, and the render compiles them as it always did).
  renderer.setRenderTarget(rt); yield renderer.compileAsync(scene, cam); renderer.setRenderTarget(null);
  // Rendered once per mode, read back in bands of READ_BAND rows (the target keeps its pixels between reads).
  function* read(mode) {
    for (const m of mats) m.uniforms.mode.value = mode;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
    yield;
    const W = AW * SS, H = AH * SS, buf = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += READ_BAND) {
      const h = Math.min(READ_BAND, H - y);
      renderer.readRenderTargetPixels(rt, 0, y, W, h, buf.subarray(y * W * 4, (y + h) * W * 4));
      yield;
    }
    return buf;
  }
  const albedoSS = yield* read(0), normalSS = yield* read(1);
  const tRead = performance.now();
  const tRender = performance.now() - t0;
  renderer.setRenderTarget(null); rt.dispose(); for (const m of mats) m.dispose(); for (const g of geoms) g.dispose();
  renderer.dispose(); renderer.forceContextLoss();   // leaf textures are shared with the main renderer: not disposed

  yield;
  const albedo = yield* downsample(albedoSS, AW, AH, false), normal = yield* downsample(normalSS, AW, AH, true);
  for (let i = 3; i < normal.length; i += 4) normal[i] = albedo[i];   // pad by the albedo's coverage
  const tDown = performance.now();
  yield* pad(albedo, AW, AH); yield* pad(normal, AW, AH);
  const tPad = performance.now();
  const albedoMips = yield* mips(albedo, AW, AH, false), normalMips = yield* mips(normal, AW, AH, true);
  const extents = yield* cellExtents(albedoMips, trees.length * VIEWS);
  const tMips = performance.now();
  const tex = (levels, srgb) => {
    const t = new THREE.DataTexture(levels[0].data, AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.mipmaps = levels; t.generateMipmaps = false;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; t.flipY = false;
    t.needsUpdate = true; return t;
  };
  const bytes = [albedoMips, normalMips].reduce((s, L) => s + L.reduce((a, l) => a + l.data.length, 0), 0);
  return { albedo: tex(albedoMips, true), normal: tex(normalMips, false), frames, extents, index, grid: [COLS, rows], size: [AW, AH],
    ms: performance.now() - t0, renderMs: tRender, ctxMs: tCtx - t0, geomMs: tGeom - tCtx, readMs: tRead - tGeom, downMs: tDown - t0 - tRender, padMs: tPad - tDown, mipMs: tMips - tPad, bytes };
}

// Covered box of each cell in cell units: the union, over the levels down to 8 x 8 texels a cell, of
// the texels whose alpha reaches the live shader's soft edge (about a pixel wide around the cutoff),
// plus a one-texel margin. A far tree drawn from a coarse level is thus not cut flat by a quad trimmed
// to its sharp level-0 outline, and the quads stay as small as that outline allows (fragment cost).
function* cellExtents(levels, n) {
  const out = [], lo = Math.round(ALPHA_REF * 255 * 0.6);
  for (let c = 0; c < n; c++) {
    if ((c & 15) === 0) yield;
    let x0 = CELL, x1 = -1, y0 = CELL, y1 = -1;
    for (let L = 0, cs = CELL; cs >= 8; L++, cs >>= 1) {
      const { data: d, width: w } = levels[L], k = CELL / cs, cx = (c % COLS) * cs, cy = Math.floor(c / COLS) * cs;
      for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) if (d[((cy + y) * w + cx + x) * 4 + 3] > (L ? lo : 0)) {
        x0 = Math.min(x0, x * k); x1 = Math.max(x1, (x + 1) * k - 1); y0 = Math.min(y0, y * k); y1 = Math.max(y1, (y + 1) * k - 1);
      }
    }
    if (x1 < 0) { out.push([0.5, 0.5, 0, 0]); continue; }
    const m = 1;
    out.push([Math.max(0, x0 - m) / CELL, Math.min(CELL, x1 + 1 + m) / CELL, Math.max(0, y0 - m) / CELL, Math.min(CELL, y1 + 1 + m) / CELL]);
  }
  return out;
}

// Mean thinness of a needle texture's opaque texels (treegen needleTexture: the aux texture's alpha,
// through the shader's ramp smoothstep(0.1, 0.7, a)); 0 for textures without one.
function needleThinness(tex) {
  const aux = tex.userData.aux, img = tex.mipmaps?.[0], a = aux?.mipmaps?.[0];
  if (!aux || !img?.data || !a?.data || a.width !== img.width) return 0;
  let s = 0, n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] >= 128) {
    const t = Math.min(1, Math.max(0, (a.data[i] / 255 - 0.1) / 0.6)); s += t * t * (3 - 2 * t); n++;
  }
  return n ? s / n : 0;
}

// SS x SS box filter. Colour is averaged over covered samples only (straight alpha); alpha is coverage.
function* downsample(src, w, h, isNormal) {
  const out = new Uint8Array(w * h * 4), SW = w * SS;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x === 0 && (y & 63) === 0) yield;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const i = ((y * SS + dy) * SW + x * SS + dx) * 4;
      if (src[i + 3] > 127) { r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
    }
    const o = (y * w + x) * 4;
    if (n) {
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;   // normals too: the mean, not renormalised
      out[o + 3] = Math.round(255 * n / (SS * SS));
    }
  }
  return out;
}

// Push colour into empty texels (alpha stays 0) from covered neighbours in the same cell, two rings
// deep, then fill the rest of each cell with its mean colour, so filtering and mips never pull in black.
function* pad(d, w, h, rings = 2) {
  const filled = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) filled[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  const add = new Int32Array(w * h * 4);
  for (let it = 0; it < rings; it++) {
    let na = 0;
    for (let y = 0; y < h; y++) {
      if ((y & 127) === 0) yield;
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
    if (cx === 0) yield;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy * CELL; y < (cy + 1) * CELL; y++) for (let x = cx * CELL, i = y * w + x; x < (cx + 1) * CELL; x++, i++) if (d[i * 4 + 3]) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++; }
    if (!n) continue;
    r /= n; g /= n; b /= n;
    for (let y = cy * CELL; y < (cy + 1) * CELL; y++) for (let x = cx * CELL, i = y * w + x; x < (cx + 1) * CELL; x++, i++) if (!filled[i]) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; }
  }
}

// Mip chain down to one texel per cell (cells never mix). Colour (and normal) is alpha-weighted and
// normals are not renormalised. Each level is filtered from the previous level's raw alpha; what is
// stored is that alpha shifted per cell, a' = a - t + ALPHA_REF for covered texels, with t chosen so
// the fraction of texels at or above ALPHA_REF matches level 0 (coverage-preserving mips, Castano
// 2010, with a shift rather than a scale so the alpha stays linear and the cutoff contour round).
function* mips(d0, w0, h0, isNormal) {
  const levels = [{ data: d0, width: w0, height: h0 }];
  const cellsX = w0 / CELL, cellsY = h0 / CELL, ref = ALPHA_REF * 255;
  const coverage = (d, w, cx, cy, cs, t) => {
    let n = 0; for (let y = cy * cs; y < (cy + 1) * cs; y++) for (let x = cx * cs; x < (cx + 1) * cs; x++) if (d[(y * w + x) * 4 + 3] >= t) n++;
    return n / (cs * cs);
  };
  const target = [];
  for (let cy = 0; cy < cellsY; cy++) { yield; for (let cx = 0; cx < cellsX; cx++) target.push(coverage(d0, w0, cx, cy, CELL, ref)); }
  let src = d0, w = w0, h = h0, cs = CELL;
  while (cs > 1) {
    const nw = w >> 1, nh = h >> 1, d = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      if (x === 0 && (y & 63) === 0) yield;
      let r = 0, g = 0, b = 0, a = 0, rr = 0, gg = 0, bb = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((2 * y + dy) * w + 2 * x + dx) * 4, al = src[i + 3];
        r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; rr += src[i]; gg += src[i + 1]; bb += src[i + 2];
      }
      const o = (y * nw + x) * 4;
      if (a > 0) { d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; } else { d[o] = rr / 4; d[o + 1] = gg / 4; d[o + 2] = bb / 4; }
      d[o + 3] = a / 4;
    }
    cs >>= 1;
    const out = new Uint8Array(d);   // the stored level: alpha shifted; `d` (raw) feeds the next level
    if (!isNormal) for (let cy = 0; cy < cellsY; cy++) for (let cx = 0; cx < cellsX; cx++) {
      if ((cx & 3) === 0) yield;
      const want = target[cy * cellsX + cx]; if (want <= 0) continue;
      let lo = 1, hi = 255;   // the raw alpha t whose coverage matches (coverage falls as t rises)
      for (let it = 0; it < 9; it++) { const m = (lo + hi) / 2; if (coverage(d, nw, cx, cy, cs, m) >= want) lo = m; else hi = m; }
      const shift = ref - lo;
      for (let y = cy * cs; y < (cy + 1) * cs; y++) for (let x = cx * cs; x < (cx + 1) * cs; x++) {
        const i = (y * nw + x) * 4 + 3; if (d[i]) out[i] = Math.max(1, Math.min(255, Math.round(d[i] + shift)));
      }
    }
    levels.push({ data: isNormal ? d : out, width: nw, height: nh });
    src = d; w = nw; h = nh;
  }
  return levels;
}
