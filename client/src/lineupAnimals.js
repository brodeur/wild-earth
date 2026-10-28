import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as AM from './animalModels.js';
import { Atmosphere, uniforms as atmo } from './atmosphere.js';
import { SEASON_LOOK, sunDirection, seasonOfDate } from './season.js';

// Animal lineup (client/lineup_animals.html): the counterpart of the tree lineup (lineup.js) for signing off the
// animal meshes (docs/animal-library.md, "Lineup page"). One row per species in library/animals/index.json plus
// every species with a drawn mesh: the drawn GLB (any tier) and the procedural model side by side at true size
// beside a 1 m pole and ground bar, posed by the same per-instance attributes animals.js writes (aAnim = phase,
// gait, pose, flick; aAnim2 = the rig templates' second channel), lit by the shared atmosphere (patchLambert, the
// atmosphere uniforms, the sky light and exposure) for a season and hour. Metrics come from the geometry at rest
// and are compared with the entry's size and the brief (library/animals/drafts/*.md).
// URL: ?tier=0|1|2 &motion=idle|walk|graze|rest|flap|glide|climb &season= &hour= &view=side|three|top &fit=1
//      &slow=1 &only=<species,...> &all=1 (load every GLB at once instead of as rows scroll into view)
// Scripting: window.__animalLineup (metrics(), table(), loadAll(), set({...}), rows, timing).

const T0 = performance.now();
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const LAT = 38.73;                                   // the home tiles' latitude (sun path)
const LIB = new URL('../../library/animals/', import.meta.url);
const ASSETS = new URL('../assets/', import.meta.url);
const TAU = Math.PI * 2;
const STORE = 'wildEarth.animalLineup.signoff.v1';
const FIXED_D = 5.5, FOV = 28, EYE_Y = 1.0;          // the fixed camera: 5.5 m away, eye and aim 1 m up
const ROW_DX = 60;                                   // rows stand 60 m apart along x in one scene

// ---- species tables -------------------------------------------------------------------------------------------
// Drawn meshes: the GLB that draws each species and the animalModels.js loader that gives it the game's rig
// constants. A listed loader that is not exported (yet) falls back to reading the GLB here with generic constants
// (GENERIC below); a load<Name>Mesh export that is not listed attaches to the row whose file matches its name, or
// adds a row; a .glb in client/assets whose extras.species is not listed adds a row too.
const DRAWN = {
  odocoileus_hemionus: { file: 'deer.glb', loader: 'loadDeerMesh' },
  'odocoileus_hemionus:buck': { file: 'deer_buck.glb', loader: 'loadDeerBuckMesh', species: 'odocoileus_hemionus', draft: 'odocoileus_hemionus_buck', label: 'black-tailed deer, buck' },
  sciurus_griseus: { file: 'squirrel.glb', loader: 'loadSquirrelMesh' },
  callipepla_californica: { file: 'quail.glb', loader: 'loadQuailMesh' },
  aphelocoma_californica: { file: 'scrubjay.glb', loader: 'loadJayMesh' },
  cyanocitta_stelleri: { file: 'stellersjay.glb', loader: 'loadStellersJayMesh' },
  corvus_corax: { file: 'raven_player.glb', skinned: true, note: 'the player raven (raven.js default, skinned, clips fly and glide); the ambient raven is procedural' },
  canis_latrans: { file: 'coyote.glb', loader: 'loadCoyoteMesh' },
  urocyon_cinereoargenteus: { file: 'fox.glb', loader: 'loadFoxMesh' },
  puma_concolor: { file: 'cougar.glb', loader: 'loadCougarMesh' },
  sylvilagus_bachmani: { file: 'rabbit.glb', loader: 'loadRabbitMesh' },
  lepus_californicus: { file: 'jackrabbit.glb', loader: 'loadJackrabbitMesh' },
  microtus_californicus: { file: 'vole.glb', loader: 'loadVoleMesh' },
  buteo_jamaicensis: { file: 'redtail.glb', loader: 'loadRedtailMesh' },
  cathartes_aura: { file: 'vulture.glb', loader: 'loadVultureMesh' },
  meleagris_gallopavo: { file: 'turkey.glb', loader: 'loadTurkeyMesh' },
  otospermophilus_beecheyi: { file: 'ground_squirrel.glb', loader: 'loadGroundSquirrelMesh' },
  sceloporus_occidentalis: { file: 'fence_lizard.glb', loader: 'loadLizardMesh' },
};
// Procedural models (animals.js SPECIES, which is not exported): species -> animalModels.js builder.
const PROC = {
  sciurus_griseus: 'buildSquirrel', melanerpes_formicivorus: 'buildWoodpecker', corvus_corax: 'buildRaven',
  odocoileus_hemionus: 'buildDeer', 'odocoileus_hemionus:buck': 'buildDeerBuck', callipepla_californica: 'buildQuail',
  aphelocoma_californica: 'buildJay', buteo_jamaicensis: 'buildHawk', cathartes_aura: 'buildVulture',
  urocyon_cinereoargenteus: 'buildFox', canis_latrans: 'buildCoyote', puma_concolor: 'buildCougar',
  sylvilagus_bachmani: 'buildRabbit', lepus_californicus: 'buildJackrabbit', microtus_californicus: 'buildVole', cyanocitta_stelleri: 'buildStellersJay',
  meleagris_gallopavo: 'buildTurkey', otospermophilus_beecheyi: 'buildGroundSquirrel', sceloporus_occidentalis: 'buildLizard',
};
// Body plan for the motion switch: quadruped, rodent (bounding pair, sits up), bird (ground bird: hops, flushes),
// soarer (glides, flaps in bursts, perches), reptile (sprawling walk and sprint with the spine wave, basks, pushes up).
const PLAN = {
  odocoileus_hemionus: 'quadruped', canis_latrans: 'quadruped', urocyon_cinereoargenteus: 'quadruped', puma_concolor: 'quadruped',
  sciurus_griseus: 'rodent', sylvilagus_bachmani: 'rodent', lepus_californicus: 'rodent', microtus_californicus: 'rodent',
  callipepla_californica: 'bird', aphelocoma_californica: 'bird', melanerpes_formicivorus: 'bird', cyanocitta_stelleri: 'bird',
  corvus_corax: 'soarer', buteo_jamaicensis: 'soarer', cathartes_aura: 'soarer',
  meleagris_gallopavo: 'bird', otospermophilus_beecheyi: 'rodent', sceloporus_occidentalis: 'reptile',
};
// Cycle rates (Hz) from animals.js: deer walk speed / 1.5 m at 1.1 m/s, squirrel bound 3.5, quail whirr 19 and
// walk speed / 0.14, jay rowing 11, woodpecker 13, raven 2.6, hawk 2.4; fox, coyote and lion walk (MAMMAL walk speed
// over the stride) and gallop (run), rabbit forage hop and bolt (1.1 m/s / 0.32 m, 5.5 / 0.9), jackrabbit lope and
// bolt (4.5 m/s / 1.61 m, 14 / 4.27: animals.js JACK.bound), vole scurry
// (0.55 m/s / 0.09 m, dash 1.6); turkey walk 0.35 m/s / 0.55 m and the flush's beat 5; ground squirrel feeding run
// (0.5 / 0.16) and dash (3.6 / 0.32); fence lizard walk (0.6 / 0.1) and sprint (12, the cap).
const RATE = {
  odocoileus_hemionus: { walk: 0.73 }, canis_latrans: { walk: 1.28, run: 3.4 }, urocyon_cinereoargenteus: { walk: 1.45, run: 4 }, puma_concolor: { walk: 0.85, run: 2.6 },
  sciurus_griseus: { walk: 3.5 }, sylvilagus_bachmani: { walk: 3.4, run: 6.1 }, lepus_californicus: { walk: 2.8, run: 3.3 }, microtus_californicus: { walk: 6, run: 17 },
  callipepla_californica: { walk: 2.1, flap: 19 }, aphelocoma_californica: { walk: 2.5, flap: 11 }, cyanocitta_stelleri: { walk: 2.5, flap: 11 }, melanerpes_formicivorus: { flap: 13 },
  corvus_corax: { flap: 2.6 }, buteo_jamaicensis: { flap: 2.4 }, cathartes_aura: { flap: 3 },
  meleagris_gallopavo: { walk: 0.64, flap: 5 }, otospermophilus_beecheyi: { walk: 3.1, run: 11 }, sceloporus_occidentalis: { walk: 6, run: 12 },
};
// Generic constants for a GLB read here (no loader in animalModels.js): the deer's amplitudes for quadrupeds,
// the squirrel's for rodents, the jay's for birds; rig constants (RIG keys) kept small.
const GENERIC = {
  quadruped: { amp: [0.3, 0.6, 1.5, 0], pose: [0.12, 0, -0.15, 0], k: { tipLag: 0.3, tipWave: 0.15 } },
  rodent: { amp: [0.9, 0.4, 0.35, 0], pose: [1, 0.5, 0.4, 0], k: { spine: 0.2, spinePhase: 1.2, sit: 0.3, foreFold: 0.6, tipLag: 0.5, tipWave: 0.2, tipCurl: 0.6 } },
  bird: { amp: [0.35, 0.35, 0.4, 1.0], pose: [1, 0.15, 0, 0.2], k: { handLag: 0.7, handAmp: 0.8, bow: 0.25, spread: 0.6, collapse: 1 } },
  soarer: { amp: [0, 0.2, 0.4, 0.75], pose: [1, -0.25, 0, 1.45], k: { handLag: 0.6, handAmp: 0.8, bow: 0.25, spread: 0.6, collapse: 1 } },
};
const MOTIONS = [
  ['idle', 'idle'], ['walk', 'walk / bound / hop'], ['run', 'run: gallop / bolt / dash / sprint'], ['graze', 'graze / tail flick / peck / head flick'], ['rest', 'bedded / sit up / perched / bask'],
  ['flap', 'flap'], ['glide', 'glide / soar'], ['climb', 'climb (legs splayed)'], ['display', 'display: push-up'],
];
const DRAFT_FALLBACK = { odocoileus_hemionus: 'odocoileus_hemionus_buck' };   // the doe has no brief of its own

// ---- renderer, scene, light --------------------------------------------------------------------------------------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const BG = new THREE.Color(0xc4ced6);
const camera = new THREE.PerspectiveCamera(FOV, 2, 0.05, 400);
// The shared atmosphere, on a flat stand-in tile: sun colour and intensity, sky light, exposure (atmosphere.js).
const atmosphere = new Atmosphere({ size: 100, heights: { at: () => 0 } });
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
sunLight.castShadow = true; sunLight.shadow.mapSize.set(2048, 2048); sunLight.shadow.bias = -0.0005; sunLight.shadow.normalBias = 0.01;
const hemi = new THREE.HemisphereLight(0x8fb4d8, 0x5a4a30, 1);
scene.add(sunLight, sunLight.target, hemi);
// The cascaded-shadow samplers (sampler2DShadow) must hold a depth texture with compare mode even unused
// (csmStrength 0), or every patched draw fails; shadows.js does the same with its real maps.
{
  const rt = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType) });
  rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.LinearFilter; rt.depthTexture.compareFunction = THREE.LessEqualCompare;
  renderer.setRenderTarget(rt); renderer.clear(); renderer.setRenderTarget(null);
  for (let i = 0; i < 3; i++) atmo[`csmMap${i}`].value = rt.depthTexture;
}
const lambert = color => { const m = new THREE.MeshLambertMaterial({ color }); atmosphere.patchLambert(m); return m; };
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 200), lambert(0x948f84));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// 1 m scale: a pole and a ground bar in alternating 10 cm bands.
const barDark = lambert(0x1e1e1e), barLight = lambert(0xf0f0f0);
function scaleBar() {
  const g = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const m = i % 2 ? barLight : barDark;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.1, 0.025), m); pole.position.set(0, i * 0.1 + 0.05, 0); pole.castShadow = true;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.006, 0.03), m); bar.position.set(i * 0.1 + 0.05, 0.003, 0.32); bar.receiveShadow = true;
    g.add(pole, bar);
  }
  return g;
}

// A depth material for three's shadow map that runs the same part animation as animalMaterial (so a bedded deer's
// shadow beds down): animalDepthMaterial's vertex text, split into its declarations and body, on MeshDepthMaterial.
const depthCache = new Map();
function depthFor(model) {
  const key = `${model.amp}|${model.pose}|${model.weighted ? 'w' : ''}|${model.rig ? model.rig.name : ''}|${model.skin ? model.skin.key : ''}`;
  if (depthCache.has(key)) return depthCache.get(key);
  let mat = null;
  try {
    const tmp = AM.animalDepthMaterial(model), src = tmp.vertexShader; tmp.dispose();
    const i = src.indexOf('void main() {'), j = src.indexOf('gl_Position', i);
    if (i > 0 && j > i) {
      const decl = src.slice(0, i), body = src.slice(i + 'void main() {'.length, j);
      mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      mat.onBeforeCompile = sh => { if (model.skin) sh.uniforms.uBones = { value: model.skin.tex }; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + decl).replace('#include <begin_vertex>', body); };
      mat.customProgramCacheKey = () => 'lineup-depth|' + key;
    }
  } catch (e) { console.warn('lineup: no animated shadow for', key, e); }
  depthCache.set(key, mat);
  return mat;
}

// One posed instance of a model's geometry, as animals.js draws it (an InstancedMesh with aAnim, and aAnim2 for
// the rig templates).
function instance(geo, model) {
  geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
  if (AM.hasAnim2(model)) geo.setAttribute('aAnim2', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
  if (model.skin) geo.setAttribute('aClip', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));   // the skinned deer: its first clip's first frame
  const m = new THREE.InstancedMesh(geo, AM.animalMaterial(atmosphere, model), 1);
  m.setMatrixAt(0, new THREE.Matrix4()); m.frustumCulled = false;
  m.castShadow = m.receiveShadow = true;
  const d = depthFor(model); if (d) m.customDepthMaterial = d;
  return m;
}

// ---- measurement ----------------------------------------------------------------------------------------------
const lin2s = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const s2lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const hex = rgb => '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const unhex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
function lab(srgb) {   // CIE L*a*b* (D65) of an sRGB triple in 0-1
  const [r, g, b] = srgb.map(s2lin);
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (h1, h2) => { const a = lab(unhex(h1)), b = lab(unhex(h2)); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };

// Rest-pose geometry in the model's frame (+z forward, +y up, feet at y 0):
//   L      nose (or bill) to tail tip, the z extent of every vertex
//   Lhb    head and body: nose to the tail root (the TAIL pivot), without the tail parts (TAIL, TAIL_TIP)
//   H      the highest point (head, ears, antlers);  foot  the lowest
//   span   the x extent (a bird's wings are open at rest: pose 0)
//   withers  top of the body (not the head or tail) from 5% of the head-body length ahead of the fore legs' pivot
//          to 20% behind it: the dorsal surface over the shoulders
//   rgb    area-weighted mean albedo (vertex colour, linear, shown as sRGB) of the body faces turned up (n.y > 0.2):
//          the back and upper flanks, the region a brief's first colour describes
function measureGeo(geo, { matrix = null, foreZ = null, occlusion = false } = {}) {
  const P = geo.attributes.position, n = P.count, part = geo.attributes.aPart, pw = geo.attributes.aPartW, pv = geo.attributes.aPivot, C = geo.attributes.color;
  const pos = new Float32Array(n * 3), v = new THREE.Vector3();
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i); if (matrix) v.applyMatrix4(matrix);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i * 3 + k]); mx[k] = Math.max(mx[k], pos[i * 3 + k]); }
  }
  const pid = i => part ? Math.round(part.getX(i)) : 0, strong = i => !pw || pw.getX(i) > 0.5;
  const tail = i => { const p = pid(i); return (p === 3 || p === 8) && strong(i); };
  const head = i => pid(i) === 6 && strong(i);
  let z0 = Infinity, z1 = -Infinity, tz = 0, tn = 0;
  for (let i = 0; i < n; i++) {
    if (!tail(i)) { z0 = Math.min(z0, pos[i * 3 + 2]); z1 = Math.max(z1, pos[i * 3 + 2]); }
    if (pv && pid(i) === 3) { v.set(pv.getX(i), pv.getY(i), pv.getZ(i)); if (matrix) v.applyMatrix4(matrix); tz += v.z; tn++; }
  }
  // nose to tail root: the TAIL pivot is the root when there is one (rump vertices blended into the tail would
  // otherwise stretch the body backward), else the rearmost body vertex
  const Lhb = part ? z1 - (tn ? Math.max(z0, tz / tn) : z0) : null;
  if (foreZ == null && part && pv) {   // the most forward leg pivot is the fore legs' (shoulder or elbow)
    let fz = -Infinity; for (let i = 0; i < n; i++) { const p = pid(i); if (p === 1 || p === 2) fz = Math.max(fz, pv.getZ(i)); }
    if (fz > -Infinity) foreZ = fz;
  }
  let withers = null;
  if (foreZ != null && Lhb) {
    let top = -Infinity;   // from just ahead of the fore legs' pivot back over the shoulder blades (not up the neck)
    for (let i = 0; i < n; i++) { const z = pos[i * 3 + 2] - foreZ; if (!tail(i) && !head(i) && z > -0.2 * Lhb && z < 0.05 * Lhb) top = Math.max(top, pos[i * 3 + 1]); }
    if (top > -Infinity) withers = top - mn[1];
  }
  let rgb = null;
  if (C) {
    const idx = geo.index, tri = idx ? idx.count / 3 : n / 3, acc = [0, 0, 0];
    // Procedural models are overlapping primitives: a face inside another piece (the deer's pale belly under its coat)
    // is not seen, so a ray from it along its normal that crosses the surface an odd number of times is skipped.
    let ray = null;
    const buried = (a, b, c, nrm) => {
      if (!ray) { const flat = new THREE.BufferGeometry(); flat.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (idx) flat.setIndex(idx);
        ray = { rc: new THREE.Raycaster(), mesh: new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), o: new THREE.Vector3() }; ray.mesh.updateMatrixWorld(); }
      ray.o.copy(a).add(b).add(c).divideScalar(3).addScaledVector(nrm, 1e-4);
      ray.rc.set(ray.o, nrm); ray.rc.near = 0; ray.rc.far = 100;
      return ray.rc.intersectObject(ray.mesh, false).filter(h => h.distance > 1e-5).length % 2 === 1;
    };
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    let area = 0;
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      if (part) { const ok = p => p === 0 || p === 7; if (!ok(pid(i0)) || !ok(pid(i1)) || !ok(pid(i2))) continue; }
      a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); c.fromArray(pos, i2 * 3);
      e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2);
      const len = e1.length(); if (len < 1e-12 || e1.y / len <= 0.2) continue;
      if (occlusion && buried(a, b, c, e1.divideScalar(len))) continue;
      const A = len / 2; area += A;
      for (let k = 0; k < 3; k++) acc[k] += A * (C.getComponent(i0, k) + C.getComponent(i1, k) + C.getComponent(i2, k)) / 3;
    }
    if (area > 0) rgb = hex(acc.map(x => lin2s(x / area)));
  }
  return { L: mx[2] - mn[2], Lhb, H: mx[1] - mn[1], top: mx[1], foot: mn[1], span: mx[0] - mn[0], withers, rgb, zmin: mn[2], zmax: mx[2] };
}

// ---- briefs ---------------------------------------------------------------------------------------------------
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
function tableAfter(lines, i) { const rows = []; for (let k = i + 2; k < lines.length && lines[k].trim().startsWith('|'); k++) rows.push(cells(lines[k])); return rows; }
function metres(text) {   // "draw 0.58 m", "draw a female at 1.15 m", "about 4 cm", "53-61 cm": metres
  const unit = (x, u) => +x * (u === 'mm' ? 0.001 : u === 'cm' ? 0.01 : 1);
  let m = text.match(/draw[^;|]*?(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i); if (m) return unit(m[1], m[2]);
  m = text.match(/about\s+(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i); if (m) return unit(m[1], m[2]);
  m = text.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/); if (m) return unit((+m[1] + +m[2]) / 2, m[3]);
  return null;
}
function parseDraft(md, name) {
  const out = { name, common: null, scientific: null, size: {}, colours: [], refs: [] };
  const h1 = md.match(/^#\s+(.+?)\s*\(([^)]+)\)/m); if (h1) { out.common = h1[1].trim(); out.scientific = h1[2].trim(); }
  const lines = md.split('\n');
  lines.forEach((l, i) => {
    if (/^\|\s*mark\s*\|/i.test(l)) for (const [mark, target] of tableAfter(lines, i)) {
      const k = mark.toLowerCase(), x = metres(target || ''); if (x == null) continue;
      if (/total length/.test(k)) out.size.total ??= x;
      else if (/head and body/.test(k)) out.size.hb ??= x;
      else if (/shoulder|height/.test(k)) out.size.shoulder ??= x;
      else if (/wingspan/.test(k)) out.size.span ??= x;
      else if (/^length/.test(k)) out.size.total ??= x;
    }
    if (/^\|\s*region\s*\|\s*sRGB/i.test(l)) for (const r of tableAfter(lines, i)) { const h = (r[1] || '').match(/#[0-9a-f]{6}/i); if (h) out.colours.push({ region: r[0], hex: h[0].toLowerCase() }); }
  });
  if (!out.colours.length) {   // list style: "- Approximate sRGB: blue #2f5fae (deeper tail #24498a), mantle #8a8074, ..."
    const m = md.match(/Approximate sRGB[^:]*:([\s\S]*?)(\n\s*\n|\n- |\n#)/);
    if (m) for (const part of m[1].replace(/\([^)]*\)/g, '').split(/[,;]/)) { const h = part.match(/([A-Za-z][A-Za-z ,'-]*?)\s*#([0-9a-f]{6})/i); if (h) out.colours.push({ region: h[1].trim(), hex: '#' + h[2].toLowerCase() }); }
  }
  if (out.size.total == null) { const m = md.match(/Build target:\s*(\d+(?:\.\d+)?)\s*m long(?:,\s*(\d+(?:\.\d+)?)\s*m span)?/); if (m) { out.size.total = +m[1]; if (m[2]) out.size.span = +m[2]; } }
  // reference images: section 3, a table (| # | what | link | author | licence |) or a numbered list
  const s = lines.findIndex(l => /^##\s*3\.\s*Reference/i.test(l));
  if (s >= 0) {
    let e = lines.findIndex((l, k) => k > s && /^##\s/.test(l)); if (e < 0) e = lines.length;
    const sec = lines.slice(s + 1, e);
    const t = sec.findIndex(l => /^\|\s*#\s*\|/.test(l));
    if (t >= 0) {
      const head = cells(sec[t]).map(h => h.toLowerCase());
      const ci = re => head.findIndex(h => re.test(h));
      const cw = ci(/what|shows/), ca = ci(/author/), cl = ci(/licen/);
      for (const r of tableAfter(sec, t)) {
        const link = r.join(' ').match(/\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/); if (!link) continue;
        out.refs.push({ id: r[0], what: (r[cw] || '').replace(/\*\*/g, ''), url: link[2], author: r[ca] || '', licence: r[cl] || '', pick: /image-to-3d/i.test(r[cw] || '') });
      }
    } else {
      const items = []; let cur = null;
      for (const l of sec) { if (/^\d+\.\s/.test(l)) { cur = [l]; items.push(cur); } else if (cur && /^\s{2,}\S/.test(l)) cur.push(l.trim()); else cur = null; }
      for (const it of items) {
        const text = it.join(' '), url = ((text.match(/https?:\/\/\S+/) || [])[0] || '').replace(/[.,;]+$/, ''); if (!url) continue;
        const lic = (text.match(/\b(CC0|CC BY(?:-[A-Z]{2})*(?:\s*\d\.\d)?|public domain)\b/i) || [])[1] || '';
        const after = text.slice(text.indexOf(url) + url.length).replace(/^[\s(]+/, '');
        out.refs.push({ id: it[0].match(/^\d+/)[0], what: after.replace(/^[^,]*,\s*(CC0|CC BY(?:-[A-Z]{2})*(?:\s*\d\.\d)?|public domain)[.)]?\s*/i, '').slice(0, 140), url, author: after.split(/,/)[0].replace(/^\(/, '').slice(0, 60), licence: lic, pick: /image-to-3d/i.test(text) });
      }
    }
  }
  return out;
}
// The brief's main colour for a season: a row naming the season, else (outside summer) a winter row, else the
// body / back / coat row, else the first.
function briefColour(colours, season) {
  if (!colours?.length) return null;
  const seasons = ['winter', 'spring', 'summer', 'fall'], others = r => seasons.some(s => s !== season && r.region.toLowerCase().includes(s));
  const body = r => /coat|body|\bback\b|plumage|mantle/i.test(r.region);
  return colours.find(r => body(r) && r.region.toLowerCase().includes(season))
    || (season !== 'summer' && colours.find(r => body(r) && /winter/i.test(r.region)))
    || colours.find(r => !others(r) && /\bbody\b|plumage base|^back|coat|mantle/i.test(r.region))
    || colours.find(r => !others(r)) || colours[0];
}
const thumbOk = lic => /^(cc0|cc by(\s*\d(\.\d)?)?)$/i.test((lic || '').trim());
// A thumbnail URL from the source's own API (both answer cross-origin): Wikimedia Commons imageinfo, or the first
// photo of an iNaturalist observation. null for anything else (an iNat photo page, a plain web page): link only.
async function thumbFor(url) {
  try {
    let m = url.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/);
    if (m) {
      const q = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(decodeURIComponent(m[1]))}&prop=imageinfo&iiprop=url&iiurlwidth=320&format=json&origin=*`;
      const j = await (await fetch(q)).json(), page = Object.values(j?.query?.pages || {})[0];
      return page?.imageinfo?.[0]?.thumburl || null;
    }
    m = url.match(/inaturalist\.org\/observations\/(\d+)/);
    if (m) {
      const j = await (await fetch(`https://api.inaturalist.org/v1/observations/${m[1]}`)).json(), ph = j?.results?.[0]?.photos?.[0];
      return ph?.url ? ph.url.replace('/square.', '/small.') : null;
    }
  } catch { /* offline or refused: link only */ }
  return null;
}

// ---- data loading ---------------------------------------------------------------------------------------------
const getJSON = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
const getText = url => fetch(url).then(r => r.ok ? r.text() : null).catch(() => null);
// A static server's directory listing (python -m http.server), so missing files are known without a 404; null
// when the server has none (then each file is asked for).
async function listing(url) {
  const t = await getText(url); if (!t || !/<a href=/i.test(t)) return null;
  return new Set([...t.matchAll(/href="([^"?#]+)"/g)].map(m => decodeURIComponent(m[1])));
}

// ---- rows -----------------------------------------------------------------------------------------------------
const state = {
  tier: +(params.get('tier') ?? 0), motion: params.get('motion') || 'idle', season: params.get('season') || seasonOfDate(),
  hour: +(params.get('hour') ?? 10), view: params.get('view') || 'side', fit: params.get('fit') === '1', slow: params.get('slow') === '1', variant: false,
};
const rows = [];
const timing = { start: T0, firstFrame: null, ready: null, visibleMeshes: null };
let signoffs = {};
try { signoffs = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { signoffs = {}; }
const saveSignoffs = () => { try { localStorage.setItem(STORE, JSON.stringify(signoffs)); return true; } catch { return false; } };

const [index, assetList, draftList] = await Promise.all([getJSON(new URL('index.json', LIB)), listing(ASSETS), listing(new URL('drafts/', LIB))]);
const ids = [...(index?.species || [])];
const entries = Object.fromEntries(await Promise.all(ids.map(async id => [id, await getJSON(new URL(`${id}.json`, LIB))])));

// Species and loaders from the mesh tables: listed above, plus any new load<Name>Mesh / build<Name> export.
const keys = [...ids];
for (const k of Object.keys(DRAWN)) if (!keys.includes(k)) keys.push(k);
const exportsOf = re => Object.keys(AM).filter(n => re.test(n) && typeof AM[n] === 'function');
const stem = s => s.toLowerCase().replace(/[^a-z]/g, '');
for (const name of exportsOf(/^load\w+Mesh$/)) {
  if (Object.values(DRAWN).some(d => d.loader === name)) continue;
  const s = stem(name.slice(4, -4));   // loadDeerBuckMesh -> deerbuck
  const hit = Object.entries(DRAWN).find(([, d]) => stem(d.file.replace('.glb', '')) === s || stem(d.file).includes(s));
  if (hit) hit[1].loader = name; else { DRAWN[`export:${name}`] = { loader: name, file: null, label: name }; keys.push(`export:${name}`); }
}
const usedBuilds = new Set(Object.values(PROC));
for (const name of exportsOf(/^build[A-Z]\w*$/)) {
  if (usedBuilds.has(name)) continue;
  const s = stem(name.slice(5));
  const hit = keys.find(k => DRAWN[k]?.file && stem(DRAWN[k].file.replace('.glb', '')) === s);
  if (hit) PROC[hit] = name; else { PROC[`export:${name}`] = name; keys.push(`export:${name}`); }
}
// Any other GLB in assets/: read now (kept for the load) so its extras.species can put it on that species' row.
const glbCache = {};
if (assetList) {
  const known = new Set(Object.values(DRAWN).map(d => d.file).concat(['raven.glb']));
  await Promise.all([...assetList].filter(f => f.endsWith('.glb') && !known.has(f)).map(async f => {
    let sp = null;
    try {
      const buf = glbCache[f] = await (await fetch(new URL(f, ASSETS))).arrayBuffer(), dv = new DataView(buf);
      sp = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, dv.getUint32(12, true)))).extras?.species || null;
    } catch { /* unreadable: its own row */ }
    if (!sp) {   // no extras.species: a file stem inside one entry's common name or alias (woodpecker.glb -> acorn woodpecker)
      const st = stem(f.replace('.glb', '')), hits = ids.filter(id => [entries[id]?.common, ...(entries[id]?.aliases || [])].some(n => n && stem(n).includes(st)));
      if (hits.length === 1) sp = hits[0];
    }
    if (sp && !DRAWN[sp]) { DRAWN[sp] = { file: f }; if (!keys.includes(sp)) keys.push(sp); }
    else { DRAWN[`file:${f}`] = { file: f, label: f }; keys.push(`file:${f}`); }
  }));
}
const only = params.get('only') ? new Set(params.get('only').split(',')) : null;

const draftCache = {};
async function draftFor(key, species) {
  const names = [DRAWN[key]?.draft, species, DRAFT_FALLBACK[species]].filter(Boolean);
  for (const n of names) {
    if (draftList && !draftList.has(`${n}.md`)) continue;
    if (!(n in draftCache)) draftCache[n] = getText(new URL(`drafts/${n}.md`, LIB)).then(t => t && parseDraft(t, n));
    const d = await draftCache[n]; if (d) return d;
  }
  return null;
}

function makeRow(key, i) {
  const d = DRAWN[key] || null, species = d?.species || (key.includes(':') ? null : key) || key;
  const entry = d?.species && d.species !== key ? null : entries[species] || null;   // a variant row (the buck) has its own brief, no entry
  const row = { key, species, entry, cfg: d, i, x: i * ROW_DX, plan: PLAN[species] || (entry?.body_plan === 'bird' ? 'bird' : entry?.body_plan) || 'quadruped',
    procName: PROC[key] || null, group: new THREE.Group(), yaw: 0, draft: null, brief: null,
    drawn: { state: d?.file || d?.loader ? 'pending' : 'none', model: null, meshes: null, bytes: null, metrics: null, msg: '' },
    proc: { model: null, mesh: null, metrics: null }, flags: [] };
  row.group.position.x = row.x; row.group.visible = false; scene.add(row.group);
  row.bar = scaleBar(); row.group.add(row.bar);
  // DOM
  const sec = document.createElement('section'); sec.className = 'row'; sec.id = `row-${key.replace(/[^a-z0-9_]/gi, '-')}`;
  sec.innerHTML = `<header><h2></h2><i></i><span class="tag plan"></span><span class="status"></span></header>
    <div class="grid"><div class="view"><span class="lab d">drawn</span><span class="lab p">procedural</span><div class="msg"></div><span class="bar">pole and bar: 1 m in 10 cm bands</span></div>
    <div class="metrics"></div><div class="refs"><div class="muted">reference photos from the brief</div></div>
    <div class="sign"><select><option value="">verdict…</option><option value="right">reads right</option><option value="changes">needs changes</option><option value="wrong">wrong animal / unusable</option></select>
    <textarea placeholder="Notes for the build script: what reads wrong (ears, tail, coat, size, gait…)"></textarea>
    <button class="copy">copy JSON</button><span class="saved"></span></div></div>`;
  $('rows').appendChild(sec);
  row.el = { sec, h2: sec.querySelector('h2'), sci: sec.querySelector('header i'), plan: sec.querySelector('.plan'), status: sec.querySelector('.status'),
    view: sec.querySelector('.view'), labD: sec.querySelector('.lab.d'), labP: sec.querySelector('.lab.p'), msg: sec.querySelector('.msg'),
    metrics: sec.querySelector('.metrics'), refs: sec.querySelector('.refs'), verdict: sec.querySelector('.sign select'), notes: sec.querySelector('.sign textarea'),
    copy: sec.querySelector('.sign .copy'), saved: sec.querySelector('.sign .saved') };
  // drag to turn
  let drag = null;
  row.el.view.addEventListener('pointerdown', e => { drag = { x: e.clientX, yaw: row.yaw }; row.el.view.setPointerCapture(e.pointerId); });
  row.el.view.addEventListener('pointermove', e => { if (drag) row.yaw = drag.yaw + (e.clientX - drag.x) * 0.01; });
  row.el.view.addEventListener('pointerup', () => { drag = null; });
  row.el.view.addEventListener('dblclick', () => { row.yaw = 0; });
  // sign-off
  const so = signoffs[signKey(row)] || {};
  row.el.verdict.value = so.verdict || ''; row.el.notes.value = so.notes || '';
  if (so.date) row.el.saved.textContent = `saved ${so.date.slice(0, 10)}`;
  const save = () => {
    signoffs[signKey(row)] = { species: signKey(row), verdict: row.el.verdict.value, notes: row.el.notes.value, date: new Date().toISOString() };
    row.el.saved.textContent = saveSignoffs() ? 'saved in this browser' : 'not saved (storage blocked)';
  };
  row.el.verdict.onchange = save; row.el.notes.oninput = save;
  row.el.copy.onclick = () => copyText(JSON.stringify(signJSON(row), null, 2), row.el.saved);
  return row;
}
const signKey = row => row.key.startsWith('file:') || row.key.startsWith('export:') ? (row.species || row.key) : row.key;
const signJSON = row => ({ species: signKey(row), verdict: row.el.verdict.value, notes: row.el.notes.value });
async function copyText(text, el) {
  try { await navigator.clipboard.writeText(text); el.textContent = 'copied'; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); el.textContent = ok ? 'copied' : 'copy blocked: see console'; if (!ok) console.log(text);
  }
}

function names(row) {
  const e = row.entry, d = row.draft;
  const common = row.cfg?.label && !row.cfg.label.endsWith('.glb') && !row.cfg.label.startsWith('load') ? row.cfg.label : e?.common || d?.common || row.cfg?.label || row.species;
  return { common, scientific: e?.scientific || d?.scientific || (row.species.includes('_') ? row.species.replace('_', ' ').replace(/^./, c => c.toUpperCase()) : '') };
}

// The brief's numbers: the entry's size first, else the draft's "draw" values (or the GLB's build targets).
function briefOf(row) {
  const e = row.entry, s = e?.size, d = row.draft, bird = row.plan === 'bird' || row.plan === 'soarer', out = { src: {} };
  if (s && !row.cfg?.draft) {
    // whichever the note names first: "Head and body 0.75-1.00 m, ..." or "Total length 43-61 cm with the tail ..."
    const note = (s.note || '').toLowerCase(), at = k => { const i = note.indexOf(k); return i < 0 ? Infinity : i; };
    const totalish = bird || Math.min(at('total length'), at('with the tail')) < at('head and body');
    if (s.length_m != null) { out[totalish ? 'total' : 'hb'] = s.length_m; out.src.length = `entry size.length_m (${totalish ? 'with the tail' : 'head and body'})`; }
    if (s.shoulder_or_wingspan_m != null) { out[bird ? 'span' : 'shoulder'] = s.shoulder_or_wingspan_m; out.src.second = 'entry size.shoulder_or_wingspan_m'; }
  }
  if (d) for (const k of ['total', 'hb', 'shoulder', 'span']) if (out[k] == null && d.size[k] != null) { out[k] = d.size[k]; out.src[k] = `brief ${d.name}.md`; }
  const ex = row.drawn.model?.extras;
  if (ex) {
    if (out.shoulder == null && ex.withers_m) { out.shoulder = ex.withers_m; out.src.shoulder = 'GLB extras.withers_m'; }
    if (out.hb == null && ex.head_body_m) { out.hb = ex.head_body_m; out.src.hb = 'GLB extras.head_body_m'; }
  }
  const c = briefColour(d?.colours, state.season); out.colour = c?.hex || null; out.colourRegion = c?.region || null;
  return out;
}

// ---- building models ------------------------------------------------------------------------------------------
function buildProc(row) {
  const fn = row.procName && AM[row.procName];
  if (typeof fn !== 'function') return;
  const model = fn(), mesh = instance(model.geometry, model);
  row.proc.model = model; row.proc.mesh = mesh; row.group.add(mesh);
  row.proc.metrics = measureGeo(model.geometry, { occlusion: true });
  row.proc.tris = model.tris;
}
// Read a built GLB here as animalModels.js loadTiers does (lod0-lod2, COLOR_0, _PART, _PARTW, _PIVOT, _COLORB).
const RENAME = { _part: 'aPart', _partw: 'aPartW', _pivot: 'aPivot', _colorb: 'aColorB' };
async function parseGLB(file) {
  let buf = glbCache[file];
  if (!buf) { const res = await fetch(new URL(file, ASSETS)); if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`); buf = await res.arrayBuffer(); }
  const gltf = await new GLTFLoader().parseAsync(buf, ASSETS.href);
  return { gltf, bytes: buf.byteLength };
}
async function loadGeneric(row) {
  const { gltf, bytes } = await parseGLB(row.cfg.file);
  const extras = gltf.parser.json.extras || {};
  const tiers = ['lod0', 'lod1', 'lod2'].map(n => gltf.scene.getObjectByName(n)?.geometry).filter(Boolean);
  if (!tiers.length) throw new Error(`${row.cfg.file}: no lod0-lod2 meshes`);
  for (const g of tiers) { for (const [a, b] of Object.entries(RENAME)) { const at = g.getAttribute(a); if (at) { g.setAttribute(b, at); g.deleteAttribute(a); } } g.computeVertexNormals(); }
  if (extras.species && !row.entry && entries[extras.species]) row.entry = entries[extras.species];
  if (extras.species && row.key.startsWith('file:')) { row.species = extras.species; row.plan = PLAN[extras.species] || row.plan; }
  const plan = row.plan === 'soarer' ? 'soarer' : extras.rig?.kind === 'rodent' ? 'rodent' : extras.rig?.kind === 'bird' ? 'bird' : row.plan;
  const G = GENERIC[plan] || GENERIC.quadruped;
  const model = { tiers, tris: tiers.map(g => (g.index ? g.index.count : g.attributes.position.count) / 3), weighted: !!tiers[0].getAttribute('aPartW'), extras, amp: G.amp, pose: G.pose, generic: true };
  if (extras.rig?.kind) model.rig = { name: `lineup:${row.cfg.file}`, k: G.k, piv: extras.rig, kind: extras.rig.kind };
  model.variant = tiers[0].hasAttribute('aColorB');
  model.copyright = gltf.asset?.copyright || null;
  return { model, bytes };
}
async function loadSkinned(row) {
  const { gltf, bytes } = await parseGLB(row.cfg.file);
  const root = gltf.scene, fix = new THREE.Group(), holder = new THREE.Group();
  root.updateMatrixWorld(true);
  const headNode = root.getObjectByName('head'), hp = headNode ? headNode.getWorldPosition(new THREE.Vector3()) : null;
  fix.rotation.y = hp && hp.z < 0 ? Math.PI : 0;   // bill toward +z
  fix.add(root); holder.add(fix);
  const tiers = ['lod0', 'lod1', 'lod2'].map(n => root.getObjectByName(n)).filter(Boolean);
  for (const o of tiers) o.traverse(m => {
    if (!m.isMesh) return;
    const mat = new THREE.MeshLambertMaterial({ map: m.material.map, color: 0xffffff, vertexColors: !!m.geometry.attributes.color });
    atmosphere.patchLambert(mat); m.material = mat; m.frustumCulled = false; m.castShadow = m.receiveShadow = true;
  });
  const mixer = new THREE.AnimationMixer(root), clips = {};
  for (const c of gltf.animations) { clips[c.name] = mixer.clipAction(c); clips[c.name].play(); clips[c.name].setEffectiveWeight(0); }
  holder.updateMatrixWorld(true);
  const mesh0 = tiers[0].isMesh ? tiers[0] : tiers[0].getObjectByProperty('isMesh', true);
  const toModel = mesh0.matrixWorld.clone();   // mesh -> the bill-forward model frame (holder is at the origin here)
  const model = { skinned: true, holder, tiers, mixer, clips, tris: tiers.map(o => { const m = o.isMesh ? o : o.getObjectByProperty('isMesh', true); return m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3; }),
    extras: gltf.parser.json.extras || {}, copyright: gltf.asset?.copyright || null, measureGeo: mesh0.geometry, measureMatrix: toModel };
  return { model, bytes };
}
async function headSize(file) {
  try { const r = await fetch(new URL(file, ASSETS), { method: 'HEAD' }); return r.ok ? +r.headers.get('content-length') || null : null; } catch { return null; }
}
function loadDrawn(row) {
  const D = row.drawn, cfg = row.cfg;
  if (D.state !== 'pending') return D.promise || Promise.resolve();
  if (cfg.file && assetList && !assetList.has(cfg.file)) {
    D.state = 'missing'; D.msg = `${cfg.file} is missing from client/assets: showing the procedural model only`; refresh(row); return Promise.resolve();
  }
  D.state = 'loading'; refresh(row);
  const t0 = performance.now();
  const loader = cfg.loader && typeof AM[cfg.loader] === 'function' ? AM[cfg.loader] : null;
  const job = cfg.skinned ? loadSkinned(row)
    : loader ? Promise.all([loader(), cfg.file ? headSize(cfg.file) : null]).then(([model, bytes]) => ({ model, bytes }))
    : cfg.file ? loadGeneric(row) : Promise.reject(new Error('no file and no loader'));
  D.promise = job.then(({ model, bytes }) => {
    D.model = model; D.bytes = bytes; D.ms = performance.now() - t0; D.via = cfg.skinned ? 'skinned GLB (raven.js style)' : loader ? `animalModels.js ${cfg.loader}` : 'read here with generic rig constants (no loader in animalModels.js yet)';
    if (model.skinned) {
      row.group.add(model.holder);
      D.metrics = measureGeo(model.measureGeo, { matrix: model.measureMatrix });
    } else {
      D.meshes = model.tiers.map(g => instance(g, model));
      for (const m of D.meshes) row.group.add(m);
      D.metrics = measureGeo(model.tiers[0], { foreZ: model.extras?.rig?.fore?.[2] ?? null });
    }
    D.state = 'ok';
  }).catch(e => {
    D.state = 'error'; D.msg = `${cfg.file || cfg.loader} failed to load (${e.message || e}): showing the procedural model only`;
    console.warn('lineup:', D.msg, e);
  }).finally(() => { layout(row); refresh(row); });
  return D.promise;
}

// Place the pole, the drawn model and the procedural one left to right; each animal faces +x (nose right).
function layout(row) {
  const dm = row.drawn.state === 'ok' ? row.drawn.metrics : null, pm = row.proc.metrics;
  const bird = row.plan === 'bird' || row.plan === 'soarer';   // open wings reach across the gap in a turned view
  const gap = Math.max(0.25, 0.3 * Math.max(dm ? dm.L : 0, pm ? pm.L : 0), bird ? 0.45 * Math.max(dm ? dm.span : 0, pm ? pm.span : 0) : 0);
  let x = 0.25;   // local z maps to world x (rotation.y = pi / 2), so position.x = x - zmin puts the tail at x
  const place = (objs, m) => { for (const o of objs) { o.rotation.y = Math.PI / 2; o.position.x = x - m.zmin; } const mid = x + m.L / 2; x += m.L + gap; return mid; };
  row.posD = dm ? place(row.drawn.meshes || [row.drawn.model.holder], dm) : null;
  row.posP = pm ? place([row.proc.mesh], pm) : null;
  row.right = Math.max(1.0, x - gap);
  row.H = Math.max(dm ? dm.top : 0, pm ? pm.top : 0, 0.3);
}

// ---- motion ---------------------------------------------------------------------------------------------------
// What animals.js would write for the chosen motion on this body plan; ok false when the plan has no such motion.
function animFor(row, motion, t) {
  const r = RATE[row.species] || {}, plan = row.plan;
  const a = { phase: 0, gait: 0, pose: 0, flick: 0, e0: 0, e1: 0, e3: 0, ok: true, as: motion };
  const pulse = (k, s = 0) => Math.pow(Math.max(0, Math.sin((t - s) * TAU * k)), 2);
  const na = () => { a.ok = false; a.as = 'idle'; return idle(); };
  const idle = () => { if (plan === 'bird') a.pose = 1; return a; };
  if (plan === 'quadruped') {
    if (motion === 'walk') { a.phase = t * TAU * (r.walk || 0.8); a.gait = 0.75; }
    else if (motion === 'run') { a.phase = t * TAU * (r.run || 2.5); a.gait = 1.25; a.e3 = 1; }   // the gallop: fore pair against hind pair
    else if (motion === 'graze') a.flick = 1;
    else if (motion === 'rest') { a.pose = 1; a.e1 = 0.7 * Math.sin(t * 3.3); }   // bedded (the model's drop below); the lion's tail tip twitches
    else if (motion !== 'idle') return na();
  } else if (plan === 'rodent') {
    if (motion === 'walk') { a.phase = t * TAU * (r.walk || 3.5); a.gait = 1; }
    else if (motion === 'run') { a.phase = t * TAU * (r.run || r.walk * 1.8 || 6); a.gait = 1; a.flick = row.species === 'sylvilagus_bachmani' ? 0.8 : 0; }
    else if (motion === 'graze') { a.flick = pulse(1.2); a.e1 = pulse(1.2, 0.12); }
    else if (motion === 'rest') a.pose = 1;
    else if (motion === 'climb') { a.e0 = 1; a.phase = t * TAU * (r.walk || 3.5) * 0.6; a.gait = 0.7; }
    else if (motion !== 'idle') return na();
  } else if (plan === 'bird') {
    if (motion === 'walk') { if (!r.walk) return na(); a.pose = 1; a.gait = 1; a.phase = t * TAU * r.walk; }
    else if (motion === 'graze') { a.pose = 1; a.flick = 0.5 + 0.5 * Math.sin(t * TAU * 1.6); }
    else if (motion === 'rest' || motion === 'idle') a.pose = 1;
    else if (motion === 'flap') { a.gait = 1; a.phase = t * TAU * (r.flap || 10); }
    else if (motion === 'glide') { a.e0 = 1; a.e1 = 0.4; }
    else return na();
  } else if (plan === 'reptile') {   // the fence lizard: animals.js lzUpdate
    if (motion === 'walk' || motion === 'run') { const run = motion === 'run'; a.phase = t * TAU * (run ? r.run || 12 : r.walk || 6); a.gait = run ? 1 : 0.6; a.e1 = run ? Math.sin(a.phase * 0.5) : 0; }
    else if (motion === 'rest') a.pose = -0.95;                                    // basking flat
    else if (motion === 'display') a.pose = 0.5 - 0.5 * Math.cos(t * TAU * 2);    // push-ups at 2 Hz
    else if (motion === 'graze') a.flick = Math.sin(t * TAU * 0.7) > 0 ? 0.6 : -0.6;   // head flicks
    else if (motion !== 'idle') return na();
  } else {   // soarer
    if (motion === 'flap') { a.gait = 1; a.phase = t * TAU * (r.flap || 2.6); }
    else if (motion === 'rest') a.pose = 1;
    else if (motion === 'graze') { a.pose = 1; a.flick = pulse(0.8); }
    else if (motion === 'glide' || motion === 'idle') { a.as = 'glide'; }
    else return na();
  }
  return a;
}
// The buck's antlers for the page's season (a buck with the calendar's middle dates; the second-colour box draws a
// young forked-horn): aAnim2 = (growth, velvet, young), as animals.js antlers() writes them.
const antlersFor = season => AM.antlerState(AM.SEASON_MONTH[season] ?? 10.5);
function pose(row, t) {
  const want = state.motion, sets = [];
  if (row.drawn.state === 'ok' && !row.drawn.model.skinned) sets.push([row.drawn.model, row.drawn.meshes]);
  if (row.proc.mesh) sets.push([row.proc.model, [row.proc.mesh]]);
  const a = animFor(row, want, t);
  for (const [model, meshes] of sets) {
    // each model's own bedded drop and pose limit (animalModels.js: doe 0.49 m drawn, 0.6 m procedural; lion pose <= 0.6)
    const p = Math.min(a.pose, model.poseMax || 1), ant = model.antler ? antlersFor(state.season) : null;
    for (const m of meshes) {
      const A = m.geometry.attributes.aAnim; A.array[0] = a.phase % TAU; A.array[1] = a.gait; A.array[2] = p; A.array[3] = a.flick; A.needsUpdate = true;
      const A2 = m.geometry.attributes.aAnim2;
      if (A2) {
        const w = model.gait ? a.e3 : model.rig?.kind === 'reptile' ? (state.variant ? 0 : 1) : state.variant ? 1 : 0;   // the lizard: 1 male
        A2.array.set(ant ? [ant.growth, ant.velvet, state.variant ? 1 : 0, w] : [a.e0, a.e1, 0, w]); A2.needsUpdate = true;
      }
      m.position.y = -p * (model.drop || 0);
    }
  }
  if (row.drawn.state === 'ok') {
    const D = row.drawn;
    if (D.model.skinned) {
      const fly = want === 'flap', c = D.model.clips;
      if (c.fly) c.fly.setEffectiveWeight(fly ? 1 : 0); if (c.glide) c.glide.setEffectiveWeight(fly ? 0 : 1);
      D.model.tiers.forEach((o, k) => { o.visible = k === Math.min(state.tier, D.model.tiers.length - 1); });
    } else D.meshes.forEach((m, k) => { m.visible = k === Math.min(state.tier, D.meshes.length - 1); });
  }
}

// ---- metrics panel --------------------------------------------------------------------------------------------
const f2 = v => v == null ? '–' : v.toFixed(2);
const pct = (v, t) => v == null || t == null ? null : (v - t) / t;
function cmp(v, t) {
  if (v == null) return '–';
  const p = pct(v, t); if (p == null) return `${f2(v)}`;
  return `<span class="${Math.abs(p) > 0.1 ? 'bad' : 'ok'}">${f2(v)}</span> <span class="muted">${p >= 0 ? '+' : ''}${Math.round(p * 100)}%</span>`;
}
const sw = h => h ? `<span class="sw" style="background:${h}"></span>${h}` : '–';
function evaluate(row) {
  row.brief = briefOf(row);
  const b = row.brief, flags = [], bird = row.plan === 'bird' || row.plan === 'soarer';
  const check = (who, what, v, t) => { const p = pct(v, t); if (p != null && Math.abs(p) > 0.1) flags.push(`${who} ${what} ${v.toFixed(2)} m vs ${t} m (${p > 0 ? '+' : ''}${Math.round(p * 100)}%)`); };
  for (const [who, m] of [['drawn', row.drawn.metrics], ['procedural', row.proc.metrics]]) {
    if (!m) continue;
    m.lengthVs = b.total != null ? 'total' : b.hb != null ? 'hb' : null;
    check(who, 'length (with tail)', m.L, b.total);
    if (m.Lhb != null && !bird) check(who, 'head and body', m.Lhb, b.hb);
    if (bird) check(who, 'wingspan', m.span, b.span);
    else check(who, 'shoulder', m.withers, b.shoulder);
    m.dE = m.rgb && b.colour ? deltaE(m.rgb, b.colour) : null;
    if (m.dE != null && m.dE > 10) flags.push(`${who} back colour ${m.rgb} vs ${b.colour} (ΔE ${m.dE.toFixed(0)})`);
  }
  row.flags = flags;
}
function refresh(row) {
  const { common, scientific } = names(row);
  row.el.h2.textContent = common; row.el.sci.textContent = scientific;
  row.el.plan.textContent = row.plan;
  const D = row.drawn, P = row.proc;
  const st = D.state === 'ok' ? `drawn: ${row.cfg.file || row.cfg.loader} (${D.via}), ${Math.round(D.ms)} ms` : D.state === 'loading' ? 'drawn: loading…'
    : D.state === 'pending' ? 'drawn: loads when the row is in view' : D.state === 'none' ? (row.entry?.candidates?.length ? `no drawn mesh: ${row.entry.candidates.length} candidate(s) in the entry, none adopted` : 'no drawn mesh') : D.msg;
  row.el.status.textContent = st; row.el.status.className = `status${D.state === 'missing' || D.state === 'error' ? ' warn' : ''}`;
  const msgs = [];
  if (D.state === 'missing' || D.state === 'error') msgs.push(D.msg);
  if (D.state === 'none' && !P.mesh) msgs.push('nothing to draw: no mesh and no procedural model (sound only)');
  else if (D.state === 'none') msgs.push('no drawn mesh: procedural model only');
  if (!P.mesh && D.state !== 'none') msgs.push('no procedural model for this species');
  if (!animFor(row, state.motion, 0).ok) msgs.push(`${state.motion}: not a motion of this body plan, idle shown`);
  if (D.model?.skinned && !['flap', 'glide', 'idle'].includes(state.motion)) msgs.push(`drawn raven: skinned player model has only fly and glide clips, glide shown`);
  if (D.model?.generic && state.motion !== 'idle') msgs.push('drawn: generic rig constants (no loader in animalModels.js yet)');
  if (D.model?.antler) { const s = antlersFor(state.season); msgs.push(`antlers (${state.season}): ${s.growth === 0 ? 'cast' : s.velvet ? `velvet, ${Math.round(s.growth * 100)}% grown` : 'hard'}${state.variant ? ', young forked-horn' : ''}`); }
  row.el.msg.textContent = msgs.join(' · ');
  row.el.labD.style.display = D.state === 'ok' ? '' : 'none'; row.el.labP.style.display = P.mesh ? '' : 'none';
  row.el.labD.textContent = D.state === 'ok' ? `drawn · lod${Math.min(state.tier, D.model.tiers.length - 1)}` : '';
  evaluate(row);
  const b = row.brief, dm = D.metrics, pm = P.metrics, bird = row.plan === 'bird' || row.plan === 'soarer';
  const tris = D.state === 'ok' ? D.model.tris.map((t, k) => k === state.tier ? `<b>${t}</b>` : t).join(' / ') : '–';
  const entryT = row.entry?.tiers && row.entry.tiers.lod0 ? `${row.entry.tiers.lod0} / ${row.entry.tiers.lod1} / ${row.entry.tiers.lod2}` : '';
  const line = (label, d, p, t) => `<tr><th>${label}</th><td>${d}</td><td>${p}</td><td>${t}</td></tr>`;
  const lenRow = m => !m ? '–' : b.total != null ? cmp(m.L, b.total) : f2(m.L);
  const hbRow = m => !m || m.Lhb == null ? '–' : cmp(m.Lhb, b.hb);
  const second = bird ? line('wingspan m', dm ? cmp(dm.span, b.span) : '–', pm ? cmp(pm.span, b.span) : '–', f2(b.span))
    : line('shoulder m', dm ? cmp(dm.withers, b.shoulder) : '–', pm ? cmp(pm.withers, b.shoulder) : '–', f2(b.shoulder));
  const e = row.entry, src = e?.source;
  const lic = e ? `<b>${e.license || 'entry: no licence (no mesh adopted)'}</b>${src?.title ? ` · ${src.title}${src.author ? `, ${src.author}` : ''}` : ''}${src?.url && /^https?:/.test(src.url) ? ` · <a href="${src.url}" target="_blank" rel="noopener">source</a>` : ''}${src?.kind ? ` <span class="muted">(${src.kind})</span>` : ''}${e.status ? `<br><span class="muted">${e.status}</span>` : ''}`
    : D.model?.copyright ? `<span class="muted">no library entry; GLB says:</span> ${D.model.copyright}` : '<span class="muted">no library entry</span>';
  const glbNote = e && !e.license && D.model?.copyright ? `<br><span class="muted">GLB says:</span> ${D.model.copyright}` : '';
  const fileNote = glbNote + (row.cfg?.note ? `<br><span class="muted">${row.cfg.note}</span>` : '');
  const entryFile = e?.tiers?.file && row.cfg?.file && !e.tiers.file.endsWith(row.cfg.file) ? `<br><span class="bad">entry tiers.file is ${e.tiers.file}; the page draws ${row.cfg.file}</span>` : '';
  row.el.metrics.innerHTML = `<table class="m"><thead><tr><th></th><th>drawn</th><th>procedural</th><th>brief</th></tr></thead><tbody>
    ${line('triangles', tris, P.model ? P.model.tris : '–', entryT ? `<span class="muted">entry ${entryT}</span>` : '')}
    ${line('GLB', D.bytes ? `${(D.bytes / 1024).toFixed(0)} KB` : D.state === 'ok' ? '?' : '–', '', '')}
    ${line('length m', lenRow(dm), lenRow(pm), b.total != null ? f2(b.total) : '')}
    ${bird ? '' : line('head+body m', hbRow(dm), hbRow(pm), b.hb != null ? f2(b.hb) : '')}
    ${second}
    ${line('top m', dm ? f2(dm.top) : '–', pm ? f2(pm.top) : '–', '')}
    ${line('back colour', dm ? `${sw(dm.rgb)}${dm.dE != null ? ` <span class="${dm.dE > 10 ? 'bad' : 'muted'}">ΔE ${dm.dE.toFixed(0)}</span>` : ''}` : '–', pm ? `${sw(pm.rgb)}${pm.dE != null ? ` <span class="${pm.dE > 10 ? 'bad' : 'muted'}">ΔE ${pm.dE.toFixed(0)}</span>` : ''}` : '–', b.colour ? `${sw(b.colour)}<br><span class="muted">${b.colourRegion}</span>` : '–')}
    </tbody></table><div class="lic">${lic}${fileNote}${entryFile}</div>${row.flags.length ? `<div class="flags">${row.flags.join('<br>')}</div>` : ''}`;
}
function renderRefs(row) {
  const refs = row.draft?.refs || [];
  if (!refs.length) { row.el.refs.innerHTML = `<div class="muted">${row.draft ? 'no reference photos in the brief' : 'no brief in library/animals/drafts'}</div>`; return; }
  const best = [...refs.filter(r => r.pick), ...refs.filter(r => !r.pick)].slice(0, 2);
  row.el.refs.innerHTML = `<div class="muted" style="margin-bottom:4px">brief ${row.draft.name}.md</div>`;
  for (const r of best) {
    const div = document.createElement('div'); div.className = 'ref';
    const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = `${r.id}: ${r.what.replace(/^image-to-3d (candidate|pick [ab])\.?:?\s*/i, '').slice(0, 90) || r.url}`;
    const meta = document.createElement('div'); meta.className = 'muted'; meta.textContent = `${r.author}${r.author ? ', ' : ''}${r.licence || 'licence not stated'}`;
    if (thumbOk(r.licence)) thumbFor(r.url).then(t => {   // only CC0 / CC BY, and only if it loads cross-origin; otherwise the link stays alone
      if (!t) { meta.textContent += ' (no thumbnail from this source)'; return; }
      const img = new Image(); img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer'; img.alt = r.what;
      img.onload = () => { const l = document.createElement('a'); l.href = r.url; l.target = '_blank'; l.rel = 'noopener'; l.appendChild(img); div.prepend(l); r.thumb = t; };
      img.onerror = () => { meta.textContent += ' (thumbnail not available cross-origin)'; };
      img.src = t;
    });
    div.append(a, meta); row.el.refs.appendChild(div);
  }
}

// ---- controls -------------------------------------------------------------------------------------------------
for (const [v, l] of MOTIONS) $('motion').insertAdjacentHTML('beforeend', `<option value="${v}">${l}</option>`);
$('tier').value = String(state.tier); $('motion').value = state.motion; $('season').value = state.season; $('hour').value = String(state.hour);
$('view').value = state.view; $('fit').checked = state.fit; $('slow').checked = state.slow;
const hourText = h => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
$('hourv').textContent = hourText(state.hour);
function set(o) {
  Object.assign(state, o);
  for (const row of rows) refresh(row);
  snapLight = true;
}
$('tier').onchange = e => set({ tier: +e.target.value });
$('motion').onchange = e => set({ motion: e.target.value });
$('season').onchange = e => set({ season: e.target.value });
$('hour').oninput = e => { $('hourv').textContent = hourText(+e.target.value); set({ hour: +e.target.value }); };
$('view').onchange = e => set({ view: e.target.value });
$('fit').onchange = e => set({ fit: e.target.checked });
$('slow').onchange = e => set({ slow: e.target.checked });
$('variant').onchange = e => set({ variant: e.target.checked });
{ const l = $('variant').parentElement; if (l && l.lastChild?.nodeType === 3) l.lastChild.textContent = ' second colour set (female quail, hen turkey) · young forked-horn buck · female fence lizard'; }
$('jump').onchange = e => { const r = rows.find(r => r.key === e.target.value); if (r) r.el.sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); e.target.value = ''; };
$('copyall').onclick = e => copyText(JSON.stringify(rows.map(signJSON).filter(s => s.verdict || s.notes), null, 2), $('summary'));

// ---- build the rows -------------------------------------------------------------------------------------------
keys.filter(k => !only || only.has(k)).forEach((k, i) => rows.push(makeRow(k, i)));
for (const row of rows) { buildProc(row); layout(row); refresh(row); }
for (const row of rows) $('jump').insertAdjacentHTML('beforeend', `<option value="${row.key}">${names(row).common}</option>`);
await Promise.all(rows.map(async row => { row.draft = await draftFor(row.key, row.species); renderRefs(row); refresh(row); }));
// GLBs load as their rows come into view (?all=1: all at once).
const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { const row = rows.find(r => r.el.sec === e.target); if (row) loadDrawn(row); } }, { rootMargin: '300px 0px' });
const loadAll = () => Promise.all(rows.map(loadDrawn));
if (params.get('all') === '1') loadAll(); else for (const row of rows) io.observe(row.el.sec);

// ---- frame ----------------------------------------------------------------------------------------------------
let snapLight = true, last = performance.now(), clock = 0;
const v = new THREE.Vector3();
function placeCamera(row, aspect) {
  const tx = row.x + row.right / 2;
  let D = FIXED_D, ty = EYE_Y;
  if (state.fit) {
    const vh = Math.tan(FOV * Math.PI / 360);
    const w = row.right + 0.4, h = Math.max(row.H, 0.15) * 1.35;
    D = Math.max(h / (2 * vh), w / (2 * vh * aspect), 0.6); ty = h * 0.42;
  }
  const el = state.view === 'top' ? 1.2 : state.view === 'three' ? 0.3 : 0;
  const az = (state.view === 'three' ? 0.6 : 0) + row.yaw;   // three-quarter: from the front (the animals face +x)
  camera.position.set(tx + Math.sin(az) * Math.cos(el) * D, ty + Math.sin(el) * D, Math.cos(az) * Math.cos(el) * D);
  camera.lookAt(tx, state.fit ? ty : EYE_Y * (state.view === 'side' ? 1 : 0.5), 0);
  camera.aspect = aspect; camera.updateProjectionMatrix();
  return { tx, D };
}
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now; clock += dt * (state.slow ? 0.25 : 1);
  const W = innerWidth, H = innerHeight;
  if (canvas.width !== Math.floor(W * renderer.getPixelRatio()) || canvas.height !== Math.floor(H * renderer.getPixelRatio())) renderer.setSize(W, H, false);
  // the shared atmosphere for the season and hour; cloud shadows off (a review stand, not the open sky)
  const sun = sunDirection(LAT, state.season, state.hour), look = SEASON_LOOK[state.season];
  camera.position.set(0, EYE_Y, FIXED_D); camera.lookAt(0, EYE_Y, 0);
  atmosphere.update(snapLight ? 30 : dt, sun, look, state.season, state.hour, camera); snapLight = false;
  atmo.cloudStrength.value = 0;
  sunLight.color.copy(atmo.sunColor.value); sunLight.intensity = atmosphere.sunIntensity;
  hemi.color.copy(atmo.ambientSky.value); hemi.groundColor.copy(atmo.ambientGround.value); hemi.intensity = 1;
  renderer.toneMappingExposure = atmosphere.exposure;
  scene.background = BG;
  renderer.setClearColor(0x000000, 0); renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);   // (the background leaves its colour as the clear colour)
  let drawn = 0;
  for (const row of rows) {
    const r = row.el.view.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H || r.width < 2) continue;
    for (const o of rows) o.group.visible = o === row;
    if (row.drawn.model?.mixer) row.drawn.model.mixer.update(dt * (state.slow ? 0.25 : 1));
    pose(row, clock);
    const { tx } = placeCamera(row, r.width / r.height);
    const s = atmo.sunDir.value, span = Math.max(row.right, row.H) * 0.75 + 0.5;
    sunLight.target.position.set(tx, 0, 0); sunLight.position.set(tx + s.x * 20, Math.max(s.y, 0.05) * 20, s.z * 20);
    const sc = sunLight.shadow.camera; sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 0.5; sc.far = 60; sc.updateProjectionMatrix();
    renderer.setViewport(r.left, H - r.bottom, r.width, r.height); renderer.setScissor(r.left, H - r.bottom, r.width, r.height);
    renderer.render(scene, camera);
    // labels under each animal
    for (const [lab, px] of [[row.el.labD, row.posD], [row.el.labP, row.posP]]) {
      if (px == null) continue;
      v.set(row.x + px, -0.02, 0.32).project(camera);
      lab.style.left = `${(v.x * 0.5 + 0.5) * r.width}px`; lab.style.top = `${Math.min(r.height - 20, (-v.y * 0.5 + 0.5) * r.height + 4)}px`;
    }
    if (row.posD != null && row.posP != null && Math.abs(parseFloat(row.el.labD.style.left) - parseFloat(row.el.labP.style.left)) < 100)   // close together: stagger
      row.el.labP.style.top = `${Math.min(r.height - 20, parseFloat(row.el.labD.style.top) + 18)}px`, row.el.labD.style.top = `${parseFloat(row.el.labD.style.top) - (parseFloat(row.el.labD.style.top) > r.height - 40 ? 18 : 0)}px`;
    drawn++;
  }
  if (drawn && timing.firstFrame == null) timing.firstFrame = performance.now() - T0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
timing.ready = performance.now() - T0;
// Visible rows' meshes loaded (the load-time check).
requestAnimationFrame(() => requestAnimationFrame(async () => {
  const vis = rows.filter(r => { const b = r.el.view.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; });
  await Promise.all(vis.map(loadDrawn));
  timing.visibleMeshes = performance.now() - T0;
  summary();
}));
function summary() {
  const ok = rows.filter(r => r.drawn.state === 'ok').length, has = rows.filter(r => r.drawn.state !== 'none').length;
  $('summary').innerHTML = `${rows.length} species · ${ok}/${has} drawn meshes loaded<br>page ${Math.round(timing.ready)} ms${timing.visibleMeshes ? ` · rows in view ${Math.round(timing.visibleMeshes)} ms` : ''}`;
}
setInterval(summary, 1000);

// A mesh table exported later (animals.js SPECIES / DRAWN, or a table in animalModels.js) adds its species.
setTimeout(async () => {
  try {
    const mods = [AM]; try { mods.push(await import('./animals.js')); } catch { /* not importable here */ }
    for (const mod of mods) for (const name of ['SPECIES', 'DRAWN', 'MESHES', 'MESH_TABLE', 'SPECIES_MESHES']) {
      const t = mod[name]; if (!t || typeof t !== 'object') continue;
      const codes = Array.isArray(t) ? t.map(s => s?.code).filter(Boolean) : Object.keys(t).filter(c => /^[a-z]+_[a-z]+$/.test(c));
      const missing = codes.filter(c => !rows.some(r => r.species === c));
      if (missing.length) console.info(`lineup: ${name} lists ${missing.join(', ')}, not on this page yet: add them to DRAWN / PROC in lineupAnimals.js`);
    }
  } catch (e) { console.info('lineup: mesh table probe skipped', e); }
}, 4000);

// ---- scripting ------------------------------------------------------------------------------------------------
const r2 = x => x == null ? null : +x.toFixed(3);
const pack = m => m && { L: r2(m.L), Lhb: r2(m.Lhb), top: r2(m.top), withers: r2(m.withers), span: r2(m.span), rgb: m.rgb, dE: m.dE == null ? null : +m.dE.toFixed(1) };
function metrics() {
  return rows.map(row => {
    evaluate(row);
    const D = row.drawn;
    return { species: row.key, common: names(row).common, plan: row.plan, drawn: { state: D.state, file: row.cfg?.file || null, via: D.via || null, bytes: D.bytes, tris: D.model?.tris || null, ...pack(D.metrics), msg: D.msg || undefined },
      procedural: row.proc.model ? { builder: row.procName, tris: row.proc.model.tris, ...pack(row.proc.metrics) } : null,
      brief: { total: row.brief.total ?? null, hb: row.brief.hb ?? null, shoulder: row.brief.shoulder ?? null, span: row.brief.span ?? null, colour: row.brief.colour, colourRegion: row.brief.colourRegion, src: row.brief.src },
      licence: row.entry?.license ?? null, source: row.entry?.source?.title ? `${row.entry.source.title}${row.entry.source.author ? ', ' + row.entry.source.author : ''}` : (D.model?.copyright || null),
      refs: (row.draft?.refs || []).filter(r => r.pick).slice(0, 2).map(r => ({ url: r.url, licence: r.licence })), flags: row.flags };
  });
}
// one line per species and model, for console.table
function table() {
  const out = [];
  for (const m of metrics()) for (const [who, x] of [['drawn', m.drawn], ['proc', m.procedural]]) {
    if (!x || (who === 'drawn' && m.drawn.state !== 'ok')) continue;
    out.push({ species: m.species, model: who, tris: Array.isArray(x.tris) ? x.tris.join('/') : x.tris, KB: who === 'drawn' && x.bytes ? Math.round(x.bytes / 1024) : null,
      L: x.L, 'L brief': m.brief.total, Lhb: x.Lhb, 'Lhb brief': m.brief.hb, shoulder: x.withers, 'shoulder brief': m.brief.shoulder, span: x.span, 'span brief': m.brief.span,
      top: x.top, rgb: x.rgb, 'rgb brief': m.brief.colour, dE: x.dE });
  }
  return out;
}
window.__animalLineup = { rows, state, timing, metrics, table, loadAll, set, scene, renderer, camera };
document.body.dataset.ready = '1';
summary();
