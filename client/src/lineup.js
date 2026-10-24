import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LIBRARY, LIBRARY_SOURCE, LIBRARY_RAW, BUILTIN, buildTree, canopyMaterial, trunkMaterial, applySeason } from './treegen.js';

// Review page for the species library (docs/species-library.md): every species, three seeds,
// near or mid LOD, any season, against 5 m scale poles. URL: ?season=winter&mid=1&focus=<id>&shadows=0&ui=0

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ORDER = ['pinus_ponderosa', 'pinus_sabiniana', 'quercus_wislizeni', 'quercus_douglasii', 'arctostaphylos_viscida', 'adenostoma_fasciculatum'];
const ids = ORDER.filter(id => LIBRARY[id]).concat(Object.keys(LIBRARY).filter(id => !ORDER.includes(id)));
const SEEDS = [1000, 1017, 1034];   // the first three variant seeds vegetation.js uses (1000 + v * 17 + id length)

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

const trunkMat = trunkMaterial();
const groups = [];
let x = 0;
for (const id of ids) {
  const spec = LIBRARY[id];
  const g = { id, spec, near: new THREE.Group(), mid: new THREE.Group(), mats: { near: canopyMaterial(spec, 'near'), mid: canopyMaterial(spec, 'mid') }, canopies: [], tris: { near: [], mid: [] } };
  const built = SEEDS.map(seed => ({ near: buildTree(id, seed + id.length, 'near'), mid: buildTree(id, seed + id.length, 'mid') }));
  const widths = built.map(b => { b.near.canopy.computeBoundingBox(); const bb = b.near.canopy.boundingBox; return { w: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, 1), cx: (bb.max.x + bb.min.x) / 2 }; });
  const gap = Math.max(1, spec.height_m[1] * 0.12);
  const x0 = x;
  x += 1.5;   // room for the pole
  built.forEach((b, i) => {
    x += widths[i].w / 2;
    for (const lod of ['near', 'mid']) {
      const t = new THREE.Mesh(b[lod].trunk, trunkMat), c = new THREE.Mesh(b[lod].canopy, g.mats[lod]);
      t.castShadow = c.castShadow = true; t.receiveShadow = c.receiveShadow = true;
      t.position.x = c.position.x = x - widths[i].cx;
      g[lod].add(t, c); g.canopies.push(c);
      g.tris[lod].push(b[lod].trunk.index.count / 3 + b[lod].canopy.index.count / 3);
    }
    x += widths[i].w / 2 + gap;
  });
  const pole = scale5(); pole.position.x = x0 + 0.3; scene.add(pole);
  g.x0 = x0; g.x1 = x - gap; g.h = Math.max(...built.map(b => b.near.height));
  scene.add(g.near, g.mid);
  groups.push(g);
  x += Math.max(4, spec.height_m[1] * 0.25);
  $('focus').insertAdjacentHTML('beforeend', `<option value="${id}">${spec.common}</option>`);
  // label
  const avg = a => Math.round(a.reduce((s, v) => s + v, 0) / a.length);
  const el = document.createElement('div'); el.className = 'lab';
  el.innerHTML = `<b>${spec.common}</b><br><i>${spec.scientific}</i><br><span class="muted">${spec.architectural_model} · ${spec.height_m[0]}–${spec.height_m[1]} m<br>near ${avg(g.tris.near)} · mid ${avg(g.tris.mid)} tris</span>`;
  $('labels').appendChild(el); g.label = el;
}
const totalW = x;

// Warn when the fetched files and the built-in fallback differ (run library/embed_builtin.py).
const strip = r => { const c = { ...r }; delete c.notes; delete c.sources; delete c.authors; return JSON.stringify(c); };
const stale = Object.keys(LIBRARY_RAW).filter(id => !BUILTIN[id] || strip(LIBRARY_RAW[id]) !== JSON.stringify(BUILTIN[id]));
const fromBuiltin = ids.filter(id => LIBRARY_SOURCE[id] !== 'library');
$('warn').textContent = (fromBuiltin.length ? `library not reachable for ${fromBuiltin.join(', ')}: showing built-in parameters. ` : '')
  + (stale.length ? `built-in copy out of date for ${stale.join(', ')}: run python3 library/embed_builtin.py` : '');

function frame(focus) {
  let x0 = 0, x1 = totalW, h = Math.max(...groups.map(g => g.h));
  if (focus !== 'all') { const g = groups.find(g => g.id === focus); x0 = g.x0 - 1; x1 = g.x1 + 1; h = g.h; }
  const cx = (x0 + x1) / 2, w = x1 - x0, aspect = innerWidth / innerHeight, vfov = camera.fov * Math.PI / 180;
  const dist = Math.max((h * 1.25) / (2 * Math.tan(vfov / 2)), (w * 1.08) / (2 * Math.tan(vfov / 2) * aspect));
  camera.position.set(cx, h * 0.45 + dist * 0.12, dist);
  controls.target.set(cx, h * 0.42, 0); controls.update();
  sun.position.set(cx - 0.5 * w - 20, Math.max(w, 40) * 0.9, Math.max(w, 40) * 0.6); sun.target.position.set(cx, 0, 0);
  const sc = sun.shadow.camera, half = Math.max(w, h * 2) * 0.62; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 4000; sc.updateProjectionMatrix();
}

const state = { season: params.get('season') || 'summer', mid: params.get('mid') === '1', focus: params.get('focus') || 'all', shadows: params.get('shadows') !== '0' };
$('season').value = state.season; $('mid').checked = state.mid; $('focus').value = state.focus; $('shadows').checked = state.shadows;
function apply() {
  for (const g of groups) {
    for (const lod of ['near', 'mid']) {
      const on = applySeason(g.mats[lod], g.spec, state.season);
      g[lod].visible = (lod === 'mid') === state.mid;
      g[lod].children.forEach(m => { if (m.material === g.mats[lod]) m.visible = on > 0; });
    }
  }
  renderer.shadowMap.enabled = state.shadows; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  const tot = groups.reduce((s, g) => s + g.tris[state.mid ? 'mid' : 'near'].reduce((a, b) => a + b, 0), 0);
  $('stats').textContent = `${state.mid ? 'mid' : 'near'} LOD · ${tot.toLocaleString()} triangles for ${groups.length * SEEDS.length} plants`;
}
$('season').onchange = e => { state.season = e.target.value; apply(); };
$('mid').onchange = e => { state.mid = e.target.checked; apply(); };
$('shadows').onchange = e => { state.shadows = e.target.checked; apply(); };
$('focus').onchange = e => { state.focus = e.target.value; frame(state.focus); };
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); frame(state.focus); });
if (params.get('ui') === '0') $('panel').style.display = 'none';   // clean captures for docs
apply(); frame(state.focus);

const v = new THREE.Vector3();
function loop() {
  controls.update();
  renderer.render(scene, camera);
  for (const g of groups) {
    v.set((g.x0 + g.x1) / 2, 0, 1.2).project(camera);
    const on = v.z < 1 && Math.abs(v.x) < 1.1;
    g.label.style.display = on ? '' : 'none';
    g.label.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; g.label.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight + 6 + (state.focus === 'all' && groups.indexOf(g) % 2 ? 78 : 0)}px`;
  }
  requestAnimationFrame(loop);
}
loop();
window.__lineup = { groups, scene, camera, renderer, state, apply, frame };
document.body.dataset.ready = '1';
