import * as THREE from 'three';
import { Wisp } from '../src/spirit.js';
import {
  animalMaterial, hasAnim2, buildRaven, buildWoodpecker, loadDeerMesh, loadFoxMesh, loadCoyoteMesh, loadCougarMesh,
  loadSquirrelMesh, loadGroundSquirrelMesh, loadRabbitMesh, loadJackrabbitMesh, loadVoleMesh, loadQuailMesh, loadTurkeyMesh,
  loadLizardMesh, loadJayMesh, loadStellersJayMesh, loadRedtailMesh, loadVultureMesh, loadBearMesh, loadMountainQuailMesh,
} from '../src/animalModels.js';

// The opening screen's sprites (client/src/arrival.js plays them with CSS, so nothing on the screen animates from
// JavaScript while the world builds):
//   wisp.webp   the spirit seen from straight above flying one circle per loop, chasing its tail: N frames of
//               FRAME px (2x), COLS x ROWS on one sheet, transparent, its additive light kept (alpha = the light's
//               strength). The weave of its ribbons is not periodic over a lap, so 2N frames are rendered (two laps)
//               and the sheet is the second lap cross-faded into the first (frame k = (1 - k/N) lap2[k] + k/N lap1[k]),
//               which wraps seamlessly.
//   <code>.webp one still per species: the drawn model (animalModels.js) in the lineup's light, seen 3/4 from a
//               little above, facing right, ground animals standing, birds on the wing; PX_PER_M px per metre for all
//               (the deer ~360 px tall), cropped to the drawn pixels.
// Sends PNGs to tools/sprite_receiver.py, which converts them to WebP and writes index.json.
// ?only=<code,...>: render just those stills (no wisp) and merge them into the index.json already published, so a new
// species does not re-render (and re-encode) the rest.

const RECV = 'http://127.0.0.1:8798';
const N = 48, FRAME = 384, COLS = 8, ROWS = 6, LOOP_S = 1.2;     // the wisp loop
const R = 0.45, SWELL = 0.3, HALF = 1.0, FOV = 20;                // m: the circle's radius; the frame's half-width
const PX_PER_M = 268;                                              // the stills: the deer (1.345 m to the ear tips) ~360 px
const TILT = 0.24, YAW = Math.PI / 2 - 0.45;                       // the lineup's view: a little from above, 3/4 facing right
const G = 'ground', B = 'bird';
const SPECIES = {
  odocoileus_hemionus: [G, loadDeerMesh], ursus_americanus: [G, loadBearMesh], puma_concolor: [G, loadCougarMesh], canis_latrans: [G, loadCoyoteMesh],
  urocyon_cinereoargenteus: [G, loadFoxMesh], meleagris_gallopavo: [G, loadTurkeyMesh, 1], lepus_californicus: [G, loadJackrabbitMesh],
  sciurus_griseus: [G, loadSquirrelMesh], otospermophilus_beecheyi: [G, loadGroundSquirrelMesh], sylvilagus_bachmani: [G, loadRabbitMesh],
  callipepla_californica: [G, loadQuailMesh, 1], oreortyx_pictus: [G, loadMountainQuailMesh, 1], sceloporus_occidentalis: [G, loadLizardMesh], microtus_californicus: [G, loadVoleMesh],
  corvus_corax: [B, async () => buildRaven()], buteo_jamaicensis: [B, loadRedtailMesh, 0, 'soar'], cathartes_aura: [B, loadVultureMesh, 0, 'soar'],
  aphelocoma_californica: [B, loadJayMesh], cyanocitta_stelleri: [B, loadStellersJayMesh], melanerpes_formicivorus: [B, async () => buildWoodpecker()],
};
const PLAIN = {   // animalMaterial without the game's atmosphere (as the old openingScene.js did)
  patchLambert(m) {
    m.fog = false;
    m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nconst vec3 vAtmoPos = vec3(0.0);\nfloat cloudOnly(vec3 p) { return 1.0; }'); };
  },
};

const $ = id => document.getElementById(id);
const log = m => { $('log').textContent += m + '\n'; console.log(m); };
const canvas2d = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
async function send(name, cv) {
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  if (!$('send').checked) return blob.size;
  const r = await fetch(`${RECV}/save/${name}`, { method: 'POST', body: blob });
  if (!r.ok) throw new Error(`receiver: ${r.status}`);
  return blob.size;
}

async function renderWisp() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(FRAME, FRAME, false); renderer.setClearColor(0, 0);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(FOV, 1, 0.5, 100);
  cam.position.set(0, HALF / Math.tan(THREE.MathUtils.degToRad(FOV / 2)), 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
  const wisp = new Wisp({ renderer, camera: cam, scene });
  wisp.group.traverse(o => { const m = o.material; if (!m) return;   // light over a transparent canvas, alpha = its strength
    Object.assign(m, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: m.isSpriteMaterial ? THREE.SrcAlphaFactor : THREE.OneFactor,
      blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
    if (m.isShaderMaterial) m.fragmentShader = m.fragmentShader.replace(/}\s*$/, '  gl_FragColor.a = clamp(max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)), 0.0, 1.0);\n}');
    m.needsUpdate = true; });
  wisp.setSwell(SWELL);
  // one lap a loop, anticlockwise seen from above; the yaw puts its drift (beyond the remembered path) behind it
  const SUB = 6, dt = LOOP_S / N / SUB, w = Math.PI * 2 / LOOP_S, P = new THREE.Vector3();
  let t = 0;
  const step = () => { t += dt; const a = w * t; P.set(R * Math.cos(a), 0, -R * Math.sin(a)); wisp.animate(dt, P, a); };   // yaw a: its drift (sin a, cos a) points back along the lap
  for (let i = 0; i < 4 * N * SUB; i++) step();   // four laps to fill its path
  const frames = [];
  for (let f = 0; f < 2 * N; f++) {
    for (let s = 0; s < SUB; s++) step();
    renderer.render(scene, cam);
    const c = canvas2d(FRAME, FRAME); c.getContext('2d').drawImage(renderer.domElement, 0, 0); frames.push(c);
  }
  const sheet = canvas2d(COLS * FRAME, ROWS * FRAME), g = sheet.getContext('2d');
  for (let k = 0; k < N; k++) {
    const x = (k % COLS) * FRAME, y = Math.floor(k / COLS) * FRAME, a = k / N;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1 - a; g.drawImage(frames[N + k], x, y);
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = a; g.drawImage(frames[k], x, y);
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  $('out').append(Object.assign(frames[0], { title: 'wisp frame 0' }));
  const bytes = await send('wisp.png', sheet);
  wisp.dispose(); renderer.dispose();
  log(`wisp: ${N} frames of ${FRAME}px, sheet ${sheet.width}x${sheet.height}, png ${(bytes / 1024).toFixed(0)} KB`);
  return { file: 'wisp.webp', frames: N, cols: COLS, rows: ROWS, frame_px: FRAME, scale: 2, loop_s: LOOP_S,
    view: 'from straight above, one anticlockwise lap per loop (the spirit chasing its tail)', circle_m: R, frame_m: 2 * HALF, swell: SWELL };
}

async function renderStill(renderer, code, [kind, load, pose = 0, soar]) {
  const model = await load();
  const geo = (model.tiers ? model.tiers[0] : model.geometry).clone();
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(4), 4); geo.setAttribute('aAnim', anim);
  if (hasAnim2(model)) geo.setAttribute('aAnim2', new THREE.InstancedBufferAttribute(new Float32Array([soar ? 0.2 : 0, 0.25, 0, 0]), 4));
  // ground: standing (no gait), the folded-wing birds pose 1; birds on the wing: wings spread, a little above level
  anim.array.set(kind === G ? [0, 0, pose, 0] : [soar ? 0 : 0.7, soar ? 0 : 1, 0, 0]);
  const mesh = new THREE.InstancedMesh(geo, animalMaterial(PLAIN, model), 1);
  mesh.setMatrixAt(0, new THREE.Matrix4()); mesh.frustumCulled = false;
  const yawer = new THREE.Group(), tilt = new THREE.Group();
  yawer.add(mesh); tilt.add(yawer); tilt.rotation.x = TILT;
  yawer.rotation.set(0, YAW, kind === B ? 0.18 : 0, 'YXZ');
  const scene = new THREE.Scene(); scene.add(tilt);
  scene.add(new THREE.HemisphereLight(0xe4ecff, 0x40372a, 2.2));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.set(-0.5, 1, 0.9); scene.add(sun);
  scene.updateMatrixWorld(true);
  geo.computeBoundingBox();
  const box = geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld), pad = 0.15 * Math.max(box.max.x - box.min.x, box.max.y - box.min.y) + 0.02;
  const x0 = box.min.x - pad, x1 = box.max.x + pad, y0 = box.min.y - pad, y1 = box.max.y + pad;
  const W = Math.ceil((x1 - x0) * PX_PER_M), H = Math.ceil((y1 - y0) * PX_PER_M);
  const cam = new THREE.OrthographicCamera(x0, x0 + W / PX_PER_M, y0 + H / PX_PER_M, y0, -50, 50); cam.position.z = 10;
  renderer.setSize(W, H, false); renderer.render(scene, cam);
  // crop to the drawn pixels (+2 px)
  const c = canvas2d(W, H), g = c.getContext('2d'); g.drawImage(renderer.domElement, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  let l = W, r = -1, t = H, b = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 6) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
  if (r < 0) throw new Error(`${code}: nothing drawn`);
  l = Math.max(0, l - 2); t = Math.max(0, t - 2); r = Math.min(W - 1, r + 2); b = Math.min(H - 1, b + 2);
  const out = canvas2d(r - l + 1, b - t + 1); out.getContext('2d').drawImage(c, l, t, out.width, out.height, 0, 0, out.width, out.height);
  // the feet: where the model's origin (on the ground) lands in the crop, for the baseline
  const o = new THREE.Vector3().applyMatrix4(mesh.matrixWorld);
  const footY = Math.round((y1 - y0) * PX_PER_M - (o.y - y0) * PX_PER_M) - t;
  $('out').append(Object.assign(out, { title: code }));
  const bytes = await send(`${code}.png`, out);
  geo.dispose(); mesh.material.dispose();
  log(`${code}: ${out.width}x${out.height} px, foot at ${footY}, png ${(bytes / 1024).toFixed(0)} KB`);
  return { file: `${code}.webp`, width: out.width, height: out.height, px_per_m: PX_PER_M, kind, foot_px: Math.min(out.height, Math.max(0, footY)),
    pose: kind === G ? 'standing' : soar ? 'soaring, wings flat' : 'flying, wings up-stroke' };
}

async function run() {
  $('go').disabled = true; $('log').textContent = ''; $('out').innerHTML = '';
  try {
    const only = (new URLSearchParams(location.search).get('only') || '').split(',').filter(Boolean);
    const prev = only.length ? await fetch('../assets/opening/index.json', { cache: 'no-store' }).then(r => r.json()) : null;
    const wisp = only.length ? prev.wisp : await renderWisp();
    const renderer = new THREE.WebGLRenderer({ alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const species = only.length ? { ...prev.species } : {};
    for (const [code, spec] of Object.entries(SPECIES)) {
      if (only.length && !only.includes(code)) continue;
      try { species[code] = await renderStill(renderer, code, spec); } catch (e) { log(`${code}: skipped (${e.message})`); }
    }
    renderer.dispose();
    const index = {
      generated: new Date().toISOString(), generator: 'client/tools/opening_sprites.html (three.js) + tools/sprite_receiver.py (PIL WebP q90)',
      note: 'Pre-rendered for the opening screen (client/src/arrival.js), which plays them with CSS only.',
      credits: 'Derived renders of the client\'s animal models (client/assets/*.glb, built by tools/build_*.py, and the procedural models in '
        + 'client/src/animalModels.js) and of the spirit\'s wisp (client/src/spirit.js). The models\' sources, authors and licences are in '
        + 'docs/animal-library.md and in each tile manifest\'s sources; these renders carry the same credits.',
      px_per_m: PX_PER_M, view: { tilt_rad: TILT, yaw_rad: YAW, facing: 'right', light: 'hemisphere 0xe4ecff/0x40372a 2.2 + directional 0xfff1dc 2.4 from upper left front' },
      wisp, species,
    };
    if ($('send').checked) {
      const r = await fetch(`${RECV}/done`, { method: 'POST', body: JSON.stringify(index) });
      log(`receiver: ${JSON.stringify(await r.json())}`);
    }
    log('done');
    window.__spritesDone = index;
  } catch (e) { log(`error: ${e.stack || e}`); window.__spritesDone = { error: String(e) }; }
  $('go').disabled = false;
}

$('go').onclick = run;
if (new URLSearchParams(location.search).get('go') === '1') run();
