import * as THREE from 'three';
import { Wisp } from './spirit.js';
import {
  animalMaterial, hasAnim2, buildRaven, buildWoodpecker, loadDeerMesh, loadFoxMesh, loadCoyoteMesh, loadCougarMesh,
  loadSquirrelMesh, loadGroundSquirrelMesh, loadRabbitMesh, loadJackrabbitMesh, loadVoleMesh, loadQuailMesh, loadTurkeyMesh,
  loadLizardMesh, loadJayMesh, loadStellersJayMesh, loadRedtailMesh, loadVultureMesh,
} from './animalModels.js';

// The opening screen's mini scene (arrival.js OpeningScreen): one transparent canvas over the screen, its own renderer,
// drawing two things around the selected card while its tile loads behind the screen:
//   - the tile's animals (species/species.json; the drawn models of animals.js, loaded here through animalModels.js).
//     Loaded models wait in a queue and come out one at a time in a random order (POP_GAP s apart), each popping in
//     with a glimmer (a pale warm additive flash that swells and fades over GLIMMER_T s) as it scales in: ground
//     animals on the background just below the card, grouped under its width, a few pacing to and fro, the rest standing and now and then dipping
//     the head; birds on the wing, on slow orbits round the card's top, flapping in bursts or soaring. An orthographic
//     camera in CSS pixels (x right, y down as -y), so everything is placed straight from the card's bounding box.
//     One scale for all, true to life: the models are in metres, and a metre is PX_PER_M of the card's height (the
//     deer, 1.35 m to the ear tips, stands ~15% of it), so a squirrel is small at the deer's feet and the fence lizard
//     (18 cm, 3 cm high) is a speck.
//   - the spirit's wisp (spirit.js Wisp) as the loading spinner, in the card's middle, swirling; on ready() it
//     implodes as the card's Begin button grows in. A perspective camera of its own (the wisp is built in metres
//     and sizes its mist by the lens), the wisp placed at the depth where the card's width is ~5 m across.
// The canvas never takes the pointer. card() is asked each frame, so the lineup follows a scroll or a new
// selection (eased: the animals and the wisp regroup to the new card). Errors loading a model skip that species.
//
// API: new OpeningScene({ parent, card, tileId }); setLoading(on); ready(); stop(); dispose(); `wisp` false when the
// wisp could not be made (the screen keeps its CSS ring then); `ms` the mean frame time (update + draw).

const TAU = Math.PI * 2;
// Each species with a model: kind, a rough real size in m (body length, a bird's span) for the slots' widths, flap rate
// (Hz) for birds, pose for the folded-wing ground birds.
const G = 'ground', B = 'bird';
const SPECIES = {
  odocoileus_hemionus: { kind: G, load: loadDeerMesh, m: 1.6 },
  puma_concolor: { kind: G, load: loadCougarMesh, m: 2.0 },
  canis_latrans: { kind: G, load: loadCoyoteMesh, m: 1.2 },
  urocyon_cinereoargenteus: { kind: G, load: loadFoxMesh, m: 0.95 },
  meleagris_gallopavo: { kind: G, load: loadTurkeyMesh, m: 1.1, pose: 1 },
  lepus_californicus: { kind: G, load: loadJackrabbitMesh, m: 0.6 },
  sciurus_griseus: { kind: G, load: loadSquirrelMesh, m: 0.5 },
  otospermophilus_beecheyi: { kind: G, load: loadGroundSquirrelMesh, m: 0.42 },
  sylvilagus_bachmani: { kind: G, load: loadRabbitMesh, m: 0.35 },
  callipepla_californica: { kind: G, load: loadQuailMesh, m: 0.26, pose: 1 },
  sceloporus_occidentalis: { kind: G, load: loadLizardMesh, m: 0.18 },
  microtus_californicus: { kind: G, load: loadVoleMesh, m: 0.15 },
  corvus_corax: { kind: B, load: async () => buildRaven(), m: 1.25, flap: 2.4 },
  buteo_jamaicensis: { kind: B, load: loadRedtailMesh, m: 1.2, flap: 1.8, soar: true },
  cathartes_aura: { kind: B, load: loadVultureMesh, m: 1.7, flap: 1.4, soar: true },
  aphelocoma_californica: { kind: B, load: loadJayMesh, m: 0.4, flap: 5 },
  cyanocitta_stelleri: { kind: B, load: loadStellersJayMesh, m: 0.45, flap: 5 },
  melanerpes_formicivorus: { kind: B, load: async () => buildWoodpecker(), m: 0.43, flap: 5.5 },
};
const PX_PER_M = 0.112;                     // a metre as a fraction of the card's height (the deer's scale)
const POP_GAP = [0.18, 0.42], GLIMMER_T = 0.42;   // s between arrivals (random in the range); the glimmer's life
const VIEW_TILT = 0.24;                     // rad: everything is seen a little from above
const WISP_ACROSS = 5;                      // m of wisp-space across the card's width
const IMPLODE_T = 0.55;                     // s
const easeBack = u => { const c = 1.7; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// animalMaterial patches through the game's atmosphere; here a plain Lambert: no haze or cloud shadow, only the
// two names the underwing light reads in the fragment shader.
const PLAIN = {
  patchLambert(m) {
    m.fog = false;
    m.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nconst vec3 vAtmoPos = vec3(0.0);\nfloat cloudOnly(vec3 p) { return 1.0; }');
    };
  },
};

function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,250,235,0.85)'); gr.addColorStop(0.45, 'rgba(255,236,200,0.25)'); gr.addColorStop(1, 'rgba(255,230,190,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// light added over the transparent canvas, its alpha the light's strength (see the wisp's blending below)
const LIGHT_BLEND = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor };

function shadowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export class OpeningScene {
  constructor({ parent, card, tileId }) {
    this.card = card; this.parent = parent;
    const r = this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5)); r.setClearColor(0x000000, 0); r.autoClear = false;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = r.domElement; this.canvas.className = 'op-canvas'; this.canvas.setAttribute('aria-hidden', 'true');
    parent.append(this.canvas);
    // the animals: pixels, y up (screen y is -y)
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(0, 1, 0, -1, -4000, 4000);
    this.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x40372a, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.set(-0.5, 1, 0.9); this.scene.add(sun);
    this.shadowMap = shadowTexture(); this.glowMap = glowTexture();
    this.queue = []; this.popT = 0.15; this.glimmers = [];
    // the wisp: metres, its own lens
    this.wscene = new THREE.Scene();
    this.wcam = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
    this.wisp = false;
    try {
      this.wisp = new Wisp({ renderer: r, camera: this.wcam, scene: this.wscene });
      // Additive light over a transparent (premultiplied) canvas: the colour is added as in the game, and the alpha
      // channel gets the light's strength too (its brightest channel), so the page under it is lit rather than the glow
      // being dropped (colour over zero alpha) or boxed in black (alpha 1 where the strips are faint).
      this.wisp.group.traverse(o => { const m = o.material; if (!m) return;
        const sprite = m.isSpriteMaterial;
        Object.assign(m, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: sprite ? THREE.SrcAlphaFactor : THREE.OneFactor, blendDst: THREE.OneFactor,
          blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
        if (m.isShaderMaterial) m.fragmentShader = m.fragmentShader.replace(/}\s*$/, '  gl_FragColor.a = clamp(max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)), 0.0, 1.0);\n}');
        m.needsUpdate = true; });
    } catch (e) { console.warn('opening: no wisp', e); this.wisp = false; }
    this.loading = true; this.implode = -1; this.wp = new THREE.Vector3();
    this.animals = []; this.anchor = null; this.t = 0; this.ms = 0; this.running = true;
    this.size = { w: 0, h: 0 };
    this.load(tileId);
    this.last = performance.now();
    this.frame = this.frame.bind(this); this.raf = requestAnimationFrame(this.frame);
    window.__weOpening = this;   // debugging handle
  }

  setLoading(on) { this.loading = on; if (on) this.implode = -1; }
  ready() { if (this.loading) { this.loading = false; this.implode = 0; } }

  async load(tileId) {
    const list = await fetch(`../tiles/${tileId}/species/species.json`).then(r => r.ok ? r.json() : []).catch(() => []);
    const known = list.map(s => s.code).filter(c => SPECIES[c]);
    // ground slots: biggest at the two ends, smallest toward the middle, in front of the card
    const ground = known.filter(c => SPECIES[c].kind === G).sort((a, b) => SPECIES[b].m - SPECIES[a].m);
    const n = ground.length, order = [];
    ground.forEach((c, i) => order[i % 2 ? n - 1 - (i >> 1) : i >> 1] = c);
    // each slot's share of the span by the animal's size, so a deer gets more room than a vole: f its centre (0..1)
    const wts = order.map(c => SPECIES[c].m ** 0.85 + 0.1), sum = wts.reduce((x, y) => x + y, 0) || 1;
    let acc = 0; this.slotF = wts.map(w => { const f = (acc + w / 2) / sum; acc += w; return f; });
    this.slotW = wts.map(w => w / sum);
    this.nGround = n;
    const birds = known.filter(c => SPECIES[c].kind === B);
    const jobs = order.map((c, slot) => [c, { slot }]).concat(birds.map((c, k) => [c, { orbit: k, nb: birds.length }]));
    await Promise.all(jobs.map(([code, place]) => this.add(code, place)));
  }

  async add(code, place) {
    const spec = SPECIES[code];
    let model;
    try { model = await spec.load(); } catch (e) { console.warn(`opening: no model for ${code}`, e); return; }
    if (!this.running) return;
    const geo = (model.tiers ? model.tiers[0] : model.geometry).clone();
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(4), 4); anim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', anim);
    let anim2 = null;
    if (hasAnim2(model)) { anim2 = new THREE.InstancedBufferAttribute(new Float32Array(4), 4); anim2.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aAnim2', anim2); }
    geo.computeBoundingBox();
    const bb = geo.boundingBox, hy = bb.max.y - bb.min.y, lz = bb.max.z - bb.min.z, sx = bb.max.x - bb.min.x;
    const mat = animalMaterial(PLAIN, model);
    mat.transparent = true; mat.opacity = 0;
    const mesh = new THREE.InstancedMesh(geo, mat, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4()); mesh.frustumCulled = false;
    const yawer = new THREE.Group(), tilt = new THREE.Group();
    yawer.add(mesh); tilt.add(yawer); tilt.rotation.x = VIEW_TILT;
    this.scene.add(tilt);
    tilt.visible = false;
    const rnd = Math.random;
    const a = { code, spec, model, mesh, mat, geo, anim, anim2, yawer, tilt, born: Infinity, ...place,
      hy, len: lz, wid: sx, phase: rnd() * TAU, amp: 0, flick: 0, flickT: 1 + rnd() * 4, dir: rnd() < 0.5 ? 1 : -1, yaw: 0, x: 0, walk: false,
      stateT: 1 + rnd() * 4, flapT: rnd() * 2, glide: 0, th: 0, cx: null };
    if (spec.kind === G) {
      a.walk = place.slot % 3 === 1;
      a.yaw = a.dir * (Math.PI / 2 - 0.5);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.shadowMap, transparent: true, depthWrite: false, opacity: 0 }));
      sh.renderOrder = -1; sh.visible = false; this.scene.add(sh); a.shadow = sh;
    } else {
      const k = place.orbit;
      a.th = k * 2.4 + rnd(); a.w = (0.28 + 0.05 * (k % 3)) * (k % 2 ? -1 : 1);
      a.rx = 0.5 + 0.14 * k; a.alt = [0.06, 0.14, 0.02, 0.18, 0.1, 0.0][k % 6];
    }
    this.queue.push(a);   // out one at a time (frame: popNext)
  }

  // The next queued animal, picked at random, appears with a glimmer at its spot.
  popNext(c) {
    const a = this.queue.splice(Math.floor(Math.random() * this.queue.length), 1)[0];
    a.born = this.t; a.tilt.visible = true; if (a.shadow) a.shadow.visible = true;
    this.animals.push(a);
    this.pose(a, c, 0);   // placed, so the glimmer starts where it stands or flies
    const s = c.h * PX_PER_M, size = Math.max(46, s * Math.max(a.len, a.wid, a.hy) * 1.3);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowMap, color: 0xfff1d8, transparent: true, depthWrite: false, depthTest: false, ...LIGHT_BLEND }));
    sp.position.copy(a.tilt.position); sp.position.y += a.spec.kind === G ? s * a.hy * 0.45 : 0; sp.position.z = 3000;
    sp.renderOrder = 10; this.scene.add(sp);
    this.glimmers.push({ sp, t: 0, size });
  }

  glimmer(dt) {
    for (let i = this.glimmers.length - 1; i >= 0; i--) {
      const g = this.glimmers[i]; g.t += dt;
      const u = Math.min(1, g.t / GLIMMER_T), e = 1 - (1 - u) ** 3;
      g.sp.scale.setScalar(g.size * (0.25 + 1.1 * e));
      g.sp.material.opacity = u < 0.15 ? u / 0.15 : (1 - u) ** 1.5;
      if (u >= 1) { g.sp.removeFromParent(); g.sp.material.dispose(); this.glimmers.splice(i, 1); }
    }
  }

  // the selected card's box in canvas pixels, eased so a new selection is a regroup rather than a jump
  track(dt) {
    const el = this.card?.(), host = this.parent.getBoundingClientRect();
    if (el) {
      const r = el.getBoundingClientRect(), b = { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height };
      if (!this.anchor) this.anchor = { ...b };
      else for (const k of ['x', 'y', 'w', 'h']) this.anchor[k] = damp(this.anchor[k], b[k], 7, dt);
    }
    return this.anchor;
  }

  resize() {
    const w = this.parent.clientWidth, h = this.parent.clientHeight;
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    Object.assign(this.cam, { left: 0, right: w, top: 0, bottom: -h }); this.cam.updateProjectionMatrix();
    this.wcam.aspect = w / h; this.wcam.updateProjectionMatrix();
  }

  frame(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.t += dt;
    const t0 = performance.now();
    this.resize();
    const c = this.track(dt);
    if (c) {
      this.popT -= dt;
      if (this.popT <= 0 && this.queue.length) { this.popNext(c); this.popT = POP_GAP[0] + Math.random() * (POP_GAP[1] - POP_GAP[0]); }
      for (const a of this.animals) this.pose(a, c, dt);
      this.glimmer(dt); this.spinner(c, dt);
    }
    const r = this.renderer;
    r.clear(); r.render(this.scene, this.cam);
    if (this.wisp && this.wisp.group.visible) r.render(this.wscene, this.wcam);
    this.ms = this.ms ? this.ms * 0.95 + (performance.now() - t0) * 0.05 : performance.now() - t0;
  }

  pose(a, c, dt) {
    const A = a.anim.array, u = Math.min(1, (this.t - a.born) / 0.6), grow = easeBack(u);
    if (a.mat.opacity !== Math.min(1, u * 1.6)) { a.mat.opacity = Math.min(1, u * 1.6); a.mat.transparent = a.mat.opacity < 1; }
    let pose = 0;
    if (a.spec.kind === G) {
      const span = Math.min(c.w * 1.3, this.size.w - 16), gap = span * this.slotW[a.slot];
      const back = a.slot % 2 === 1, s = (back ? 0.9 : 1) * c.h * PX_PER_M, L = a.len * s;
      const home = c.x + c.w / 2 - span / 2 + span * this.slotF[a.slot], foot = c.y + c.h + (back ? 0.16 : 0.18) * c.h;   // on the background below the card (its bottom margin)
      // pace to and fro (the walkers), else stand; turn at the ends; now and then dip the head (flick)
      a.stateT -= dt;
      if (a.stateT <= 0) { a.stateT = 3 + Math.random() * 5; if (a.slot % 3 !== 0) a.walk = !a.walk; }
      const range = gap * 0.35, want = a.dir * (Math.PI / 2 - 0.45);
      const turning = Math.abs(a.yaw - want) > 0.05;
      a.yaw = damp(a.yaw, want, 5, dt);
      const moving = a.walk && !turning;
      if (moving) { a.x += a.dir * L * 0.3 * dt; if (Math.abs(a.x) > range && Math.sign(a.x) === a.dir) a.dir = -a.dir; }
      a.amp = damp(a.amp, moving ? 1 : 0, 6, dt);
      if (moving || a.amp > 0.02) a.phase += dt * TAU * 1.6;
      a.flickT -= dt;
      if (a.flickT <= 0 && !moving) { a.flick = 1.4; a.flickT = 2.5 + Math.random() * 4; }
      a.flick = Math.max(0, a.flick - dt);
      pose = a.spec.pose || 0;
      A[3] = Math.sin(Math.min(1, a.flick / 1.4) * Math.PI);
      a.tilt.position.set(home + a.x, -foot, back ? 0 : 400);
      a.tilt.scale.setScalar(s * grow);
      a.yawer.rotation.y = a.yaw;
      const sh = a.shadow; sh.position.set(home + a.x, -foot - 2, back ? -1 : 399);
      sh.scale.set(s * Math.max(a.len * Math.abs(Math.sin(a.yaw)), Math.min(a.wid, a.len)) * 1.15 * grow, Math.max(3, L * 0.12) * grow, 1);   // the body's length as seen
      sh.material.opacity = a.mat.opacity;
    } else {
      // orbit round the card's top: x across, z in depth (nearer is bigger), a little up and down
      a.th += a.w * dt;
      const rx = c.w * a.rx, rz = c.w * 0.35, cy = c.y + c.h * a.alt;
      const x = c.x + c.w / 2 + rx * Math.cos(a.th), z = rz * Math.sin(a.th), y = cy + c.h * 0.03 * Math.sin(a.th * 2 + a.orbit);
      const vx = -rx * Math.sin(a.th) * a.w, vz = rz * Math.cos(a.th) * a.w;
      const near = 1 + 0.14 * Math.sin(a.th);
      const s = c.h * PX_PER_M * near;
      a.tilt.position.set(x, -y, 100 + z);
      a.tilt.scale.setScalar(s * grow);
      a.yawer.rotation.set(0, Math.atan2(vx, vz), -Math.sign(a.w) * 0.32, 'YXZ');
      // flap in bursts and glide (soarers mostly glide, wings flexing)
      a.flapT -= dt;
      if (a.flapT <= 0) { a.glide = a.glide ? 0 : 1; a.flapT = a.glide ? (a.spec.soar ? 3 + Math.random() * 3 : 0.8 + Math.random()) : (a.spec.soar ? 0.9 : 1 + Math.random()); }
      const flapping = !a.glide;
      a.amp = damp(a.amp, flapping ? 1 : (a.spec.soar ? 0.12 : 0), 6, dt);
      a.phase += dt * TAU * (flapping ? a.spec.flap : 0.4);
      if (a.anim2) { a.anim2.array[0] = a.spec.soar ? 0.2 : 0; a.anim2.array[1] = 0.25; a.anim2.needsUpdate = true; }
    }
    A[0] = a.phase; A[1] = a.amp; A[2] = pose;
    a.anim.needsUpdate = true;
  }

  // the wisp in the card's middle, circling a little so its ribbons swirl; imploding on ready()
  spinner(c, dt) {
    const w = this.wisp; if (!w) return;
    const { w: W, h: H } = this.size;
    const ppm = c.w / WISP_ACROSS, d = H / (2 * Math.tan(THREE.MathUtils.degToRad(this.wcam.fov) / 2) * ppm);
    const sx = c.x + c.w / 2 + ppm * 0.35 * Math.sin(this.t * 1.3), sy = c.y + c.h * 0.5 + ppm * 0.2 * Math.sin(this.t * 2.1);
    const P = this.wp.set((sx - W / 2) / ppm, (H / 2 - sy) / ppm + 0.35, -d);   // the core a little low, the ribbons rising over the middle
    if (this.loading) { w.setSwell(0.7); w.animate(dt, P, 0); return; }
    if (this.implode < 0) { if (w.group.visible) w.update(dt, P, 0, false); return; }
    this.implode += dt;
    const u = Math.min(1, this.implode / IMPLODE_T);
    w.update(dt, P, 0, u < 1, 1 - u, 1 + 2.5 * u * (1 - u), 0.6 * (1 - 0.6 * u), 0.7 * (1 - u) + 0.3 * (1 - u) * u * 4, 1 + 3 * u);
    if (u >= 1) this.implode = -1;
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  dispose() {
    this.stop();
    for (const g of this.glimmers) g.sp.material.dispose();
    this.glowMap.dispose();
    for (const a of this.animals.concat(this.queue)) { a.geo.dispose(); a.mat.dispose(); a.shadow?.geometry.dispose(); a.shadow?.material.dispose(); }
    this.animals = [];
    this.shadowMap.dispose();
    if (this.wisp) this.wisp.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss();
    this.canvas.remove();
    if (window.__weOpening === this) delete window.__weOpening;
  }
}
