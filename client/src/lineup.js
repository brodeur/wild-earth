import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LIBRARY, LIBRARY_SOURCE, LIBRARY_RAW, BUILTIN, buildTree, canopyMaterial, trunkMaterial, applySeason, thinMidCanopy, ageClasses, SLOTS, addSpecies, SEASON_MONTH } from './treegen.js';

// Review page for the species library (docs/species-library.md): every species, three seeds,
// near or mid LOD, any season, against 5 m scale poles. URL: ?season=winter&mid=1&focus=<id>&shadows=0&ui=0
// ?classes=1 ("all variants"): one tree per age class plus the snag, labelled with class, height and share.
// ?close=1 (or the "close LOD" box): the close tier, the near trunk with the close twigs and canopy.
// Every species in library/species/index.json is on the page. ?add=<id>,<id> also loads files not (yet)
// in the index (library/species/<id>.json: a draft, or the generator's _test_ files); ?only=<id>,<id> shows
// just those. ?month=1..12 (or the Month menu) picks the month within the season, for species with
// foliage.leaf_on_by_month or month-bound flowers and berries; default the season's middle month.

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ORDER = ['pinus_ponderosa', 'pinus_sabiniana', 'quercus_wislizeni', 'quercus_douglasii', 'arctostaphylos_viscida', 'adenostoma_fasciculatum'];
const list = k => (params.get(k) || '').split(',').map(v => v.trim()).filter(Boolean);
for (const id of list('add')) {
  try { const r = await fetch(new URL(`../../library/species/${id}.json`, import.meta.url), { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); addSpecies(await r.json(), 'added'); }
  catch (e) { console.warn(`lineup: could not add species ${id}: ${e.message}`); }
}
const only = list('only');
const ids = ORDER.filter(id => LIBRARY[id]).concat(Object.keys(LIBRARY).filter(id => !ORDER.includes(id))).filter(id => !only.length || only.includes(id)).filter(id => !LIBRARY[id].groundForm);   // the grasses and forbs are not grown here
const SEEDS = [1000, 1017, 1034];   // the first three variant seeds vegetation.js uses (1000 + v * 17 + id length)

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9d6df);
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.5, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xd8e6f2, 0x8c8270, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: 0xb4ad9c }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// 5 m scale: a pole and a ground bar in alternating 1 m bands.
function scale5() {
  const g = new THREE.Group(), dark = new THREE.MeshLambertMaterial({ color: 0x222222 }), light = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  for (let i = 0; i < 5; i++) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1, 0.14), i % 2 ? light : dark); pole.position.set(0, i + 0.5, 0); pole.castShadow = true; g.add(pole);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.18), i % 2 ? light : dark); bar.position.set(i + 0.5, 0.015, 0.6); g.add(bar);
  }
  return g;
}

// Layouts: 'seeds' (the three measured seeds of the base class, as before) or 'classes' (one tree per age
// class plus the snag). Each is built into its own root group and label set; the toggle swaps them.
const mats = {};   // species id -> canopy and trunk materials, shared by both layouts
const twigMat = trunkMaterial(null);
const matsOf = (id, spec) => mats[id] || (mats[id] = { near: canopyMaterial(spec, 'near'), mid: canopyMaterial(spec, 'mid'), close: canopyMaterial(spec, 'close'), trunk: trunkMaterial(null, spec) });
function buildLayout(kind) {
const root = new THREE.Group(), labels = document.createElement('div'), groups = [];
let x = 0;
for (const id of ids) {
  const spec = LIBRARY[id];
  const g = { id, spec, built: null, near: new THREE.Group(), mid: new THREE.Group(), close: new THREE.Group(), mats: matsOf(id, spec), canopies: [], tris: { near: [], mid: [], close: [] }, trees: [] };
  const rows = kind === 'classes' ? ageClasses(id) : SEEDS.map(seed => ({ seed: seed + id.length }));
  const built = rows.map(r => ({ row: r, near: buildTree(id, r.seed, 'near'), mid: buildTree(id, r.seed, 'mid'), close: buildTree(id, r.seed, 'close') }));
  g.built = built;
  const widths = built.map(b => { b.near.canopy.computeBoundingBox(); const bb = b.near.canopy.boundingBox.clone();
    if (kind === 'classes') { b.near.trunk.computeBoundingBox(); bb.union(b.near.trunk.boundingBox); }   // a snag's width is its wood
    return { w: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, kind === 'classes' ? 7 : 1), cx: (bb.max.x + bb.min.x) / 2 }; });   // classes: room for each tree's label
  const gap = Math.max(1, spec.height_m[1] * 0.12);
  const x0 = x;
  x += 1.5;   // room for the pole
  built.forEach((b, i) => {
    x += widths[i].w / 2;
    for (const lod of ['near', 'mid']) {
      const t = new THREE.Mesh(b[lod].trunk, g.mats.trunk), c = new THREE.Mesh(b[lod].canopy, g.mats[lod]);
      t.castShadow = c.castShadow = true; t.receiveShadow = c.receiveShadow = true;
      t.position.x = c.position.x = x - widths[i].cx;
      g[lod].add(t, c); g.canopies.push(c);
      g.tris[lod].push(b[lod].trunk.index.count / 3 + b[lod].canopy.index.count / 3);
    }
    {   // close: the near trunk, the twigs and the close canopy
      const t = new THREE.Mesh(b.near.trunk, g.mats.trunk), c = new THREE.Mesh(b.close.canopy, g.mats.close);
      const parts = [t, c]; if (b.close.twigs) parts.push(new THREE.Mesh(b.close.twigs, twigMat));
      for (const m of parts) { m.castShadow = m.receiveShadow = true; m.position.x = x - widths[i].cx; }
      g.close.add(...parts);
      g.tris.close.push(b.near.tris.trunk + b.close.tris.twigs + b.close.tris.canopy);
    }
    if (kind === 'classes') {   // per-tree label: class, height of this tree, share of plants
      const r = b.row, el = document.createElement('div'); el.className = 'lab sub';
      el.innerHTML = `<b>${r.name}</b><br>${b.near.height.toFixed(1)} m <span class="muted">(${r.height_m[0]}–${r.height_m[1]})</span><br><span class="muted">${Math.round(r.share * 100)}% of plants</span>`;
      labels.appendChild(el); g.trees.push({ x, el });
    }
    x += widths[i].w / 2 + gap;
  });
  const pole = scale5(); pole.position.x = x0 + 0.3; root.add(pole);
  g.x0 = x0; g.x1 = x - gap; g.h = Math.max(...built.map(b => b.near.height));
  root.add(g.near, g.mid, g.close);
  groups.push(g);
  x += Math.max(4, spec.height_m[1] * 0.25);
  // label
  const avg = a => Math.round(a.reduce((s, v) => s + v, 0) / a.length);
  const el = document.createElement('div'); el.className = 'lab';
  el.innerHTML = kind === 'classes'
    ? `<b>${spec.common}</b><br><i>${spec.scientific}</i><br><span class="muted">${built.length} variants of ${SLOTS} slots</span>`
    : `<b>${spec.common}</b><br><i>${spec.scientific}</i><br><span class="muted">${spec.architectural_model} · ${spec.height_m[0]}–${spec.height_m[1]} m<br>near ${avg(g.tris.near)} · mid ${avg(g.tris.mid)} tris</span>`;
  labels.appendChild(el); g.label = el;
}
scene.add(root); $('labels').appendChild(labels);
return { kind, root, labels, groups, totalW: x };
}
for (const id of ids) $('focus').insertAdjacentHTML('beforeend', `<option value="${id}">${LIBRARY[id].common}</option>`);
const layouts = { seeds: buildLayout('seeds'), classes: null };
const groups = layouts.seeds.groups;   // the measured layout
let L = layouts.seeds;

// Measured silhouette and colour per species, the same measures docs/tree-likeness-review.md took
// from the reference photographs (stored as `targets` in each species file): each seed is drawn
// side-on with an orthographic camera into a small offscreen target (two views, 90 degrees apart).
//   W/H: widest row of the plant (1st to 99th percentile of its pixels) / plant height
//   base: lowest crown pixels (5th percentile of canopy rows) / plant height
//   porosity: sky inside that row span, median over the upper 70% of the crown
//   r/g, b/g: mean canopy colour in linear light under a fixed sun (exposure-free ratios)
const MS = 256, mTarget = new THREE.WebGLRenderTarget(MS, MS), mBuf = new Uint8Array(MS * MS * 4);
const mScene = new THREE.Scene(), mCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
const mFlat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const mSun = new THREE.DirectionalLight(0xffffff, 2.2); mSun.position.set(-0.6, 1, 0.8);
mScene.add(new THREE.HemisphereLight(0xffffff, 0x8c8270, 0.9), mSun, mSun.target);
function measureView(objs, bb, axis, colour) {
  const c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3()), half = 0.52 * Math.max(size.x, size.y, size.z);
  mCam.left = -half; mCam.right = half; mCam.top = half; mCam.bottom = -half; mCam.updateProjectionMatrix();
  mCam.position.copy(c).add(axis === 'z' ? new THREE.Vector3(0, 0, 200) : new THREE.Vector3(200, 0, 0)); mCam.lookAt(c);
  mScene.background = new THREE.Color(1, 1, 1);
  for (const o of objs) mScene.add(o);
  renderer.setRenderTarget(mTarget); renderer.clear(); renderer.render(mScene, mCam); renderer.setRenderTarget(null);
  renderer.readRenderTargetPixels(mTarget, 0, 0, MS, MS, mBuf);
  for (const o of objs) mScene.remove(o);
  const mask = new Uint8Array(MS * MS); let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < MS * MS; i++) {
    const R = mBuf[4 * i], G = mBuf[4 * i + 1], B = mBuf[4 * i + 2];
    if (R + G + B < 3 * 250) { mask[i] = 1; if (colour) { r += R; g += G; b += B; n++; } }
  }
  return { mask, rg: n ? r / g : 0, bg: n ? b / g : 0 };   // the target is linear (no tone mapping), so these are linear ratios
}
function rowsOf(mask) {   // rows top (0) to bottom, from a bottom-up pixel buffer
  const rows = [];
  for (let y = MS - 1; y >= 0; y--) { const xs = []; for (let x = 0; x < MS; x++) if (mask[y * MS + x]) xs.push(x); rows.push(xs); }
  return rows;
}
function measureTree(b, mat) {
  const t = new THREE.Mesh(b.trunk, mFlat), cFlat = new THREE.Mesh(b.canopy, mat), cCol = new THREE.Mesh(b.canopy, mat);
  const bb = new THREE.Box3().setFromObject(t).union(new THREE.Box3().setFromObject(cFlat));
  const wood = b.twigs ? [t, new THREE.Mesh(b.twigs, mFlat)] : [t];   // close tier: the twigs are wood in the silhouette
  const out = { wh: 0, base: 0, por: 0, rg: 0, bg: 0 };
  for (const axis of ['z', 'x']) {
    const all = rowsOf(measureView([...wood, cFlat], bb, axis).mask);
    const top = all.findIndex(r => r.length), bot = all.length - 1 - [...all].reverse().findIndex(r => r.length), h = Math.max(1, bot - top + 1);
    let wmax = 0; const por = [];
    all.forEach((xs, i) => {
      if (xs.length < 2) return;
      const a = xs[Math.floor(xs.length * 0.01)], z = xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.99))], span = z - a + 1;
      wmax = Math.max(wmax, span);
      if (i >= top && i <= top + 0.7 * h) { let f = 0; for (const x of xs) if (x >= a && x <= z) f++; por.push(1 - f / span); }
    });
    const can = measureView([cCol], bb, axis, true), crow = rowsOf(can.mask), ys = [];
    crow.forEach((xs, i) => { for (let k = 0; k < xs.length; k++) ys.push(i); });
    ys.sort((p, q) => q - p);
    const lowest = ys.length ? ys[Math.floor(ys.length * 0.05)] : bot;
    por.sort((p, q) => p - q);
    out.wh += wmax / h / 2; out.base += Math.max(0, (bot - lowest) / h) / 2; out.por += (por.length ? por[Math.floor(por.length / 2)] : 0) / 2;
    out.rg += can.rg / 2; out.bg += can.bg / 2;
  }
  return out;
}
// lod: 'near' (the photo comparison), 'mid' (past 180 m) or 'close' (under about 90 m: the near trunk
// with the close canopy), so a change to one tier can be checked against the same targets. `dist`
// (mid only): measure the mid crown as the mid material thins it at that camera distance in metres.
// kind 'classes': one tree per age class (the "all variants" layout), reported per class as
// { id: [{ name, h, wh, base, por, rg, bg }, ...] } (snags, which have no foliage, are left out).
let NO_TWIGS = false;   // __lineupMetrics('close', 0, 'seeds', false): the close canopy without the twigs in the silhouette
function measureAll(lod = 'near', dist = 0, kind = 'seeds') {
  const res = {};
  if (kind === 'classes') {
    if (!layouts.classes) { layouts.classes = buildLayout('classes'); apply(); }
    for (const g of layouts.classes.groups) {
      const plain = { ...g.spec, foliage: { ...g.spec.foliage, color_var: [0, 0], leaf_on_var: 0 } }, mat = canopyMaterial(plain, lod);
      applySeason(mat, plain, 'summer');
      res[g.id] = g.built.filter(b => !b.row.snag).map(b => {
        const m = measureTree(lod === 'close' ? { trunk: b.near.trunk, twigs: NO_TWIGS ? null : b.close.twigs, canopy: b.close.canopy } : b[lod], mat);
        return { name: b.row.name, h: +b.near.height.toFixed(1), cards: b.near.tris.cards, tris: b.near.tris.trunk + b.near.tris.canopy, mid: b.mid.tris.trunk + b.mid.tris.canopy,
          ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(2)])) };
      });
    }
    return res;
  }
  for (const g of groups) {
    // measured without the per-plant tint (color_var), which would otherwise depend on where the seed stands
    const plain = { ...g.spec, foliage: { ...g.spec.foliage, color_var: [0, 0], leaf_on_var: 0 } }, mat = canopyMaterial(plain, lod);
    applySeason(mat, plain, 'summer');
    const ms = g.built.map(b => measureTree(lod === 'close' ? { trunk: b.near.trunk, twigs: NO_TWIGS ? null : b.close.twigs, canopy: b.close.canopy }
      : lod === 'mid' && dist ? { trunk: b.mid.trunk, canopy: thinMidCanopy(b.mid.canopy, dist) } : b[lod], mat));
    const avg = k => ms.reduce((s, m) => s + m[k], 0) / ms.length;
    res[g.id] = { wh: avg('wh'), base: avg('base'), por: avg('por'), rg: avg('rg'), bg: avg('bg'), target: g.spec.targets || null };
  }
  return res;
}
const fmt = (v, t, tol) => {
  const ok = t == null ? '' : Math.abs(v - t) <= tol ? 'color:#1d6b35' : 'color:#9a3b12';
  return `<span style="${ok}">${v.toFixed(2)}</span>${t == null ? '' : `<span class="muted">/${t}</span>`}`;
};
let METRICS = null;
function showMetrics() {
  if (params.get('metrics') === '0') return;
  METRICS = measureAll();
  for (const g of groups) {
    const m = METRICS[g.id], t = m.target || {};
    g.label.insertAdjacentHTML('beforeend', `<br><span class="muted" style="font-size:11px">W/H ${fmt(m.wh, t.crown_width_ratio, Math.max(0.1, 0.15 * (t.crown_width_ratio || 1)))} · base ${fmt(m.base, t.crown_base_ratio, 0.07)} · gaps ${fmt(m.por, t.porosity, 0.07)}<br>r/g ${fmt(m.rg, t.foliage_rg, 0.06)} · b/g ${fmt(m.bg, t.foliage_bg, 0.06)} <i>(measured / photo target)</i></span>`);
  }
}
const round = res => Object.fromEntries(Object.entries(res).map(([k, m]) => [k, { wh: +m.wh.toFixed(2), base: +m.base.toFixed(2), por: +m.por.toFixed(2), rg: +m.rg.toFixed(2), bg: +m.bg.toFixed(2), target: m.target && { wh: m.target.crown_width_ratio, base: m.target.crown_base_ratio, por: m.target.porosity, rg: m.target.foliage_rg, bg: m.target.foliage_bg } }]));
// __lineupMetrics() is the near-LOD table shown on the labels; __lineupMetrics('mid' | 'close') measures that
// tier, __lineupMetrics('mid', 800) the mid tier as thinned for a camera 800 m away, and
// __lineupMetrics('near', 0, 'classes') one tree per age class.
window.__lineupMetrics = (lod = 'near', dist = 0, kind = 'seeds', twigs = true) => { NO_TWIGS = !twigs; try { return kind === 'classes' ? measureAll(lod, dist, 'classes')
  : lod === 'near' && !dist ? METRICS && round(METRICS) : round(measureAll(lod, dist)); } finally { NO_TWIGS = false; } };

// Warn when the fetched files and the built-in fallback differ (run library/embed_builtin.py).
const strip = r => { const c = { ...r }; delete c.notes; delete c.sources; delete c.authors; return JSON.stringify(c); };
const stale = Object.keys(LIBRARY_RAW).filter(id => LIBRARY_SOURCE[id] === 'library' && (!BUILTIN[id] || strip(LIBRARY_RAW[id]) !== JSON.stringify(BUILTIN[id])));
const fromBuiltin = ids.filter(id => LIBRARY_SOURCE[id] === 'built-in');
$('warn').textContent = (fromBuiltin.length ? `library not reachable for ${fromBuiltin.join(', ')}: showing built-in parameters. ` : '')
  + (stale.length ? `built-in copy out of date for ${stale.join(', ')}: run python3 library/embed_builtin.py` : '');

function frame(focus) {
  let x0 = 0, x1 = L.totalW, h = Math.max(...L.groups.map(g => g.h));
  if (focus !== 'all') { const g = L.groups.find(g => g.id === focus); x0 = g.x0 - 1; x1 = g.x1 + 1; h = g.h; }
  const cx = (x0 + x1) / 2, w = x1 - x0, aspect = innerWidth / innerHeight, vfov = camera.fov * Math.PI / 180;
  const dist = Math.max((h * 1.25) / (2 * Math.tan(vfov / 2)), (w * 1.08) / (2 * Math.tan(vfov / 2) * aspect));
  camera.position.set(cx, h * 0.45 + dist * 0.12, dist);
  controls.target.set(cx, h * 0.42, 0); controls.update();
  sun.position.set(cx - 0.5 * w - 20, Math.max(w, 40) * 0.9, Math.max(w, 40) * 0.6); sun.target.position.set(cx, 0, 0);
  const sc = sun.shadow.camera, half = Math.max(w, h * 2) * 0.62; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 4000; sc.updateProjectionMatrix();
}

$('mid').parentElement.insertAdjacentHTML('afterend', '<label class="check"><input type="checkbox" id="close"> close LOD (under 90 m: twigs, more cards)</label>');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
$('season').insertAdjacentHTML('afterend', `<label for="month">Month</label><select id="month"><option value="">middle of the season</option>${MONTHS.map((m, k) => `<option value="${k + 1}">${m}</option>`).join('')}</select>`);
const state = { season: params.get('season') || 'summer', month: +params.get('month') || null, mid: params.get('mid') === '1', close: params.get('close') === '1', focus: params.get('focus') || 'all', shadows: params.get('shadows') !== '0', classes: params.get('classes') === '1' };
// a month belongs to its season: picking one sets the season too
const seasonOfMonth = m => (m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'fall');
if (state.month) state.season = seasonOfMonth(state.month);
$('month').value = state.month || '';
$('season').value = state.season; $('mid').checked = state.mid; $('close').checked = state.close; $('focus').value = state.focus; $('shadows').checked = state.shadows; $('classes').checked = state.classes;
function apply() {
  if (state.classes && !layouts.classes) layouts.classes = buildLayout('classes');
  L = state.classes ? layouts.classes : layouts.seeds;
  for (const k of ['seeds', 'classes']) if (layouts[k]) { layouts[k].root.visible = layouts[k] === L; layouts[k].labels.style.display = layouts[k] === L ? '' : 'none'; }
  const tier = state.mid ? 'mid' : state.close ? 'close' : 'near';
  for (const g of L.groups) {
    for (const lod of ['near', 'mid', 'close']) {
      const on = applySeason(g.mats[lod], g.spec, state.season, state.month ? state.month + 0.5 : SEASON_MONTH[state.season]);
      g[lod].visible = lod === tier;
      g[lod].children.forEach(m => { if (m.material === g.mats[lod]) m.visible = on > 0; });
    }
  }
  renderer.shadowMap.enabled = state.shadows; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  const tot = L.groups.reduce((s, g) => s + g.tris[tier].reduce((a, b) => a + b, 0), 0);
  $('stats').textContent = `${tier} LOD · ${tot.toLocaleString()} triangles for ${L.groups.reduce((s, g) => s + g.built.length, 0)} plants`;
}
$('season').onchange = e => { state.season = e.target.value; state.month = null; $('month').value = ''; apply(); };
$('month').onchange = e => { state.month = +e.target.value || null; if (state.month) { state.season = seasonOfMonth(state.month); $('season').value = state.season; } apply(); };
$('mid').onchange = e => { state.mid = e.target.checked; apply(); };
$('close').onchange = e => { state.close = e.target.checked; apply(); };
$('shadows').onchange = e => { state.shadows = e.target.checked; apply(); };
$('classes').onchange = e => { state.classes = e.target.checked; apply(); frame(state.focus); };
$('focus').onchange = e => { state.focus = e.target.value; frame(state.focus); };
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); frame(state.focus); });
if (params.get('ui') === '0') $('panel').style.display = 'none';   // clean captures for docs
showMetrics();
apply(); frame(state.focus);

const v = new THREE.Vector3();
function loop() {
  controls.update();
  renderer.render(scene, camera);
  for (const g of L.groups) {
    const sub = L.kind === 'classes';
    v.set((g.x0 + g.x1) / 2, sub ? g.h * 1.08 : 0, 1.2).project(camera);
    const on = v.z < 1 && Math.abs(v.x) < 1.1;
    g.label.style.display = on ? '' : 'none';
    g.label.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    g.label.style.top = sub ? `${(-v.y * 0.5 + 0.5) * innerHeight - 64}px` : `${(-v.y * 0.5 + 0.5) * innerHeight + 6 + (state.focus === 'all' && L.groups.indexOf(g) % 2 ? 78 : 0)}px`;
    for (const [k, t] of g.trees.entries()) {   // class labels under each tree, staggered when crowded
      v.set(t.x, 0, 1.2).project(camera);
      t.el.style.display = v.z < 1 && Math.abs(v.x) < 1.1 ? '' : 'none';
      t.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; t.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight + 6 + (state.focus === 'all' ? (k % 3) * 46 : 0)}px`;
    }
  }
  requestAnimationFrame(loop);
}
loop();
// __lineupSeeds(id): the near metrics of each measured seed of one species (height, cards, triangles, W/H, base, gaps).
window.__lineupSeeds = id => { const g = groups.find(g => g.id === id), plain = { ...g.spec, foliage: { ...g.spec.foliage, color_var: [0, 0], leaf_on_var: 0 } }, mat = canopyMaterial(plain, 'near');
  applySeason(mat, plain, 'summer');
  return g.built.map(b => { const m = measureTree(b.near, mat); return { h: +b.near.height.toFixed(1), cards: b.near.tris.cards, tris: b.near.tris.trunk + b.near.tris.canopy, wh: +m.wh.toFixed(2), base: +m.base.toFixed(2), por: +m.por.toFixed(2) }; }); };
window.__lineup = { groups, layouts, scene, camera, controls, renderer, state, apply, frame };
document.body.dataset.ready = '1';
