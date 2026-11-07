import * as THREE from 'three';
import { Wisp } from './spirit.js';
import { animalMaterial, hasAnim2, faunaTemplate, loadFaunaModel } from './animalModels.js';
import { MODELS, G } from './bodyModels.js';
import { GROUND } from './groundControl.js';
import { FLIERS } from './flierControl.js';
import { OWN } from './playable.js';
import { rarityColor, rarityByCode } from './animals.js';
import { avatarFor } from './social.js';

// The home screen's bodies (Aaron, 2026-11-07): once a place is chosen, the animals the spirit can take there teleport in
// over the tile as two rings, the walkers on one plane and the fliers on another above it, the spirit bigger in the
// middle, chosen at first. The rings turn slowly; choosing an animal swings its ring round until it stands at the front
// (bottom centre, nearest the camera) and holds there. Each group member's pick, or the body they are in at that place,
// shows over that animal as their face and name (setMarks; multiplayer.js relays them through the hub).
//
// Live models, not stills: each animal is the client's own drawn model (bodyModels.js, animalModels.js), posed as the
// opening screen's stills pose it (standing, or on the wing: the fliers' wings beat), lit by the stills' lights and drawn
// with the page's renderer over the earth (render: its own scene and camera, after the earth, the depth cleared). Each one
// pops in once its model has loaded and its program compiled (compileAsync), in a random order a short gap apart, with
// the old lineup's arrival: a beam of its soul colour (animals.js rarityColor), a white flash and a spring to full size.
// Reduced motion: no turning and no swing, only fades. Sizes: a compressed true scale (a metre's share falls with size,
// so the vole is still seen beside the elk), no larger than the ring's spacing allows.
//
// Units: the walkers' ring has radius 1; the fliers' is wider and higher. layout(box) fits the whole within a screen box
// (CSS px), the walkers' ring centred on box.cx and the front of it at box.b; groundEllipse() says where that ring falls
// on screen (title.js frames the tile under it).
//
//   new BodyRing({ renderer, box, onPick, guest })   box: an element over the canvas for the faces and the hover name
//   show(tileId)      the tile's animals teleport in (a previous tile's go first); resolves when the list is known
//   clear()           every animal goes (beamed out)
//   select(code)      'spirit' or a species code: the ring swings that animal to the front
//   selected, picked  the code chosen; the entry { code, name, kind } or null for the spirit
//   setMarks(list)    [{ user, name, code, here }] the group's picks (here: the body they are in there)
//   hit(x, y)         the code under a screen point, or null
//   render(dt, W, H)  a frame, over what the renderer drew
//   dispose()         everything off the GPU and out of the DOM

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const ELEV = 34 * DEG, FOV = 18;                     // the rings' camera: looking down 34 degrees (near the earth's own view of the tile), a long lens
const R_AIR = 1.12, Y_AIR = 0.58;                    // the fliers' ring: its radius and height over the walkers'
const D_MAX = 0.3, D_SPIRIT = 0.42, M_REF = 2.2;     // an animal's largest side (ring radii) at most, for M_REF m and over; the spirit's
const SPACING = 0.86;                                // of the ring's spacing an animal may fill
const SPIN = [0.075, -0.055];                        // rad/s: the walkers' ring and the fliers' (the other way)
const SPIN_IN_S = 2.5;                               // the turn's ease in, from the first arrival
const SWING_W = 2.6;                                 // the swing to the front: a critically damped spring (rad/s)
const POP_GAP = [0.07, 0.17], POP_IN = 0.75, POP_OUT = 0.65, FADE_S = 0.6;
const FACE_TURN = 0.45;                              // the chosen animal turns this share from its path toward the camera
const LOADS = 4;                                     // models loading at once
const BEAT = 2.4;                                    // Hz: the fliers' wingbeat, slowed for the screen
const MARK_PX = 22;
const WISP_R = 0.45, WISP_LAP = 1.2;                 // m, s: the wisp's circle, chasing its tail (as the opening's sprite: compact)
const W_REST = [0.5, 0.6];                           // the wisp unchosen: its size and brightness (spirit.js REST_SCALE, REST_LUM)
const U = 2.3;                                       // metres per ring radius: the scene's scale, against which the wisp has its own size
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const easeOutBack = u => { const c = 1.6; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const getJSON = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const PLAIN = {   // animalMaterial without the game's atmosphere (as the opening stills draw them)
  patchLambert(m) {
    m.fog = false;
    m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nconst vec3 vAtmoPos = vec3(0.0);\nfloat cloudOnly(vec3 p) { return 1.0; }'); };
  },
};
// The body the spirit can take as which control (playable.js bodyKind, without a world: a stand-in by its kin)
const OWN_KIND = { raven: 'air', squirrel: 'ground', woodpecker: 'air' };
const kindOf = code => (OWN[code] ? OWN_KIND[OWN[code]] : GROUND[code] ? 'ground' : FLIERS[code] ? 'air' : null);
const TWIN = { corvus_corax: 'corvus_brachyrhynchos', sciurus_griseus: 'tamiasciurus_douglasii', melanerpes_formicivorus: 'leuconotopicus_villosus' };
const commonOf = code => (GROUND[code] || FLIERS[code])?.common || ({ corvus_corax: 'common raven', sciurus_griseus: 'western gray squirrel', melanerpes_formicivorus: 'acorn woodpecker' })[code] || code.replace(/_/g, ' ');

// The bodies of a tile: its species present (species.json) that the client draws and the spirit can take, and its own
// fauna's stand-ins (client/fauna.json slots on a kin with a body: playable.js registerStandIns' rule), each { code, name,
// kind: 'ground' | 'air', spec, tint, scale } (spec as MODELS': [pose kind, load, pose, soar]).
export async function bodiesOf(tileId) {
  const [sp, fauna] = await Promise.all([getJSON(`../tiles/${tileId}/species/species.json`), getJSON(`../tiles/${tileId}/client/fauna.json`)]);
  const list = Array.isArray(sp) ? sp : sp?.species || [];
  const out = [], seen = new Set();
  for (const s of list) {
    const code = s?.code; if (!code || s.present === false || seen.has(code) || !MODELS[code]) continue;
    const kind = kindOf(code); if (!kind) continue;
    seen.add(code); out.push({ code, name: commonOf(code), kind, spec: MODELS[code] });
  }
  for (const f of fauna?.slots || []) {
    const code = f?.code; if (!code || seen.has(code)) continue;
    const kin = f.kin, kk = kindOf(kin) || (TWIN[kin] ? kindOf(TWIN[kin]) : null), km = MODELS[kin];
    if (!kk || !km) continue;
    if (f.reptile === 'snake' && f.model?.kind !== 'snake') continue;   // a snake with no model of its own is not drawn (animals.js)
    const name = f.one || f.common || code.replace(/_/g, ' ');
    let spec = km, scale = Number.isFinite(f.scale) && f.scale > 0 ? clamp(f.scale, 0.05, 20) : 1, tint = Array.isArray(f.tint) ? f.tint : null;
    if (f.model?.path) {   // its own model, on its kin's template (animals.js DRAWN, opening_sprites.js jobSpec)
      const tpl = faunaTemplate(km[1], f), bird = kk === 'air';
      spec = [bird ? 'bird' : G, () => loadFaunaModel(f.model.path, tpl, { skin: f.model.skin !== false }), 0, f.archetype === 'soar' || tpl === 'hawk' ? 'soar' : undefined];
      scale = 1; tint = null;
    }
    seen.add(code); out.push({ code, name, kind: kk, spec, tint, scale, standIn: true });
  }
  return out;
}

function tintGeometry(geo, rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3 || !rgb.every(Number.isFinite)) return;
  for (const name of ['color', 'aColorB']) {
    const at = geo.getAttribute(name); if (!at) continue;
    const A = at.array, n = at.itemSize;
    for (let i = 0; i < A.length; i += n) for (let c = 0; c < 3; c++) A[i + c] *= rgb[c];
    at.needsUpdate = true;
  }
}
function disposeModel(model) {
  if (!model) return;
  for (const g of model.tiers || []) g?.dispose?.();
  model.geometry?.dispose?.();
  for (const t of model.maps || []) t?.dispose?.();
  const seen = new Set(), walk = (o, d) => {
    if (!o || typeof o !== 'object' || seen.has(o) || d > 4) return; seen.add(o);
    if (o.isTexture) { o.dispose(); return; }
    for (const v of Object.values(o)) walk(v, d + 1);
  };
  walk(model.skin, 0);
}

// The flash and the fade, over animalMaterial's own patch
function ringPatch(m, u) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFlash; uniform float uAlpha; uniform vec3 uFlashCol;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFlashCol, uFlash);\n  gl_FragColor.a *= uAlpha;');
  };
  m.customProgramCacheKey = () => `${key ? key() : ''}|ring`;
  m.toneMapped = false;
  m.needsUpdate = true;
  return m;
}

const BEAM_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = /* glsl */`
uniform vec3 uCol; uniform float uA; varying vec2 vUv;
void main() {
  float up = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.08, vUv.y);
  float rim = 0.55 + 0.45 * sin(vUv.x * 6.2832 * 3.0 + vUv.y * 9.0);
  gl_FragColor = vec4(mix(uCol, vec3(1.0), 0.35) * up * rim * uA, 1.0);
}`;
const HALO_FRAG = /* glsl */`
uniform vec3 uCol; uniform float uA; varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (smoothstep(1.0, 0.55, r) * 0.55 + smoothstep(0.08, 0.0, abs(r - 0.82)) * 0.9) * uA;
  gl_FragColor = vec4(uCol * a, 1.0);
}`;

// The rings' fit in a screen box { l, r, t, b } (CSS px): px per ring radius and where the walkers' ring's centre falls
export function ringFit(box) {
  if (!box) return null;
  const sE = Math.sin(ELEV), cE = Math.cos(ELEV);
  const top = Math.max(sE + D_MAX * cE, Y_AIR * cE + R_AIR * sE + D_MAX * 0.6, D_SPIRIT + 0.3 * cE), bot = sE + 0.06, half = R_AIR + D_MAX * 0.5;
  const ppu = Math.max(20, Math.min((box.r - box.l) / (2 * half), (box.b - box.t) / (top + bot)));
  const spare = Math.max(0, box.b - box.t - (top + bot) * ppu);   // a narrow box (a phone): the room left over, a little more of it above
  return { ppu, cx: (box.l + box.r) / 2, cy: box.b - bot * ppu - spare * 0.42 };
}
// The walkers' ring on screen, { cx, cy, rx, ry } (CSS px): title.js frames the chosen tile under it
export function ringEllipse(box) {
  const f = ringFit(box);
  return f && { cx: f.cx, cy: f.cy, rx: f.ppu, ry: f.ppu * Math.sin(ELEV) };
}

export class BodyRing {
  constructor({ renderer, box = null, onPick = null, guest = false }) {
    this.renderer = renderer; this.box = box; this.onPick = onPick; this.guest = guest;
    this.reduced = reducedMotion();
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    this.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x40372a, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.set(-0.5, 1, 0.9); this.scene.add(sun);
    this.world = new THREE.Group(); this.world.scale.setScalar(U); this.scene.add(this.world);   // the rings, in ring radii
    this.rings = [0, 1].map(i => {
      const group = new THREE.Group(); group.position.y = i ? Y_AIR : 0; this.world.add(group);
      return { i, group, items: [], rot: i ? 0.5 : 0, vel: 0, target: null, R: i ? R_AIR : 1, spinAt: null };
    });
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); this.beamGeo.translate(0, 0.5, 0);
    this.discGeo = new THREE.PlaneGeometry(1, 1); this.discGeo.rotateX(-Math.PI / 2);
    this.haloGeo = new THREE.PlaneGeometry(1, 1);
    this.halo = this.makeHalo(); this.world.add(this.halo.mesh);
    // the spirit in the middle: the wisp, circling a little so its ribbons stream
    this.wisp = new Wisp({ renderer, camera: this.cam, scene: this.scene });
    this.wispP = new THREE.Vector3(); this.wispT = 0; this.wispIn = 0;
    this.items = new Map(); this.sel = 'spirit'; this.tile = null; this.gen = 0; this.marks = [];
    this.rarity = rarityByCode();
    this.layoutBox = null; this.ppu = 100; this.cx = 0; this.cy = 0; this.time = 0; this.popAt = 0;
    this._v = new THREE.Vector3(); this._c = new THREE.Color();
    this.markEls = new Map(); this.hoverCode = null;
    if (box) {
      this.marksEl = document.createElement('div'); this.marksEl.className = 'br-marks'; box.append(this.marksEl);
      this.nameEl = document.createElement('div'); this.nameEl.className = 'br-name'; this.nameEl.hidden = true; box.append(this.nameEl);
    }
  }

  makeHalo() {
    const u = { uCol: { value: new THREE.Color(0xffe2b0) }, uA: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: BEAM_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.Mesh(this.discGeo, mat); mesh.renderOrder = 1; mesh.frustumCulled = false;
    return { mesh, u, a: 0 };
  }

  get picked() { return this.sel === 'spirit' ? null : this.items.get(this.sel) || null; }
  get selected() { return this.sel; }

  // ---- the list ---------------------------------------------------------------------------------------------------
  // hold: load now (the flight to the place), pop in on release() (landed)
  async show(tileId, { hold = false } = {}) {
    if (tileId === this.tile) { if (!hold) this.release(); return this.list; }
    if (this.items.size || this.tile) this.clear();
    const gen = ++this.gen;
    this.held = hold; this.waiting = [];
    this.tile = tileId; this.sel = 'spirit';
    const list = await bodiesOf(tileId);
    if (gen !== this.gen) return null;
    this.list = list;
    const by = [list.filter(b => b.kind === 'ground'), list.filter(b => b.kind === 'air')];
    by.forEach((arr, ri) => {
      const ring = this.rings[ri], n = arr.length;
      ring.items = []; ring.target = null; ring.spinAt = null; ring.vel = 0;
      arr.forEach((b, k) => {
        const it = { ...b, ring, a: n ? (k / n) * TAU : 0, dmax: Math.min(D_MAX, SPACING * TAU * ring.R / Math.max(1, n)), state: 'loading', t: 0, scale: 0, flash: 0, alpha: 1,
          holder: new THREE.Group(), mesh: null, model: null, beam: null, phase: Math.random() * TAU, size: 0, h: 0 };
        it.holder.position.set(Math.sin(it.a) * ring.R, 0, Math.cos(it.a) * ring.R);
        it.holder.visible = false;
        ring.group.add(it.holder); ring.items.push(it); this.items.set(b.code, it);
      });
    });
    // load in a random order, a few at once; each pops in when ready, its slot kept
    const queue = [...this.items.values()].sort(() => Math.random() - 0.5);
    const next = async () => { while (queue.length && gen === this.gen) { const it = queue.shift(); await this.load(it, gen); } };
    for (let i = 0; i < LOADS; i++) next();
    return list;
  }

  async load(it, gen) {
    let model;
    try { model = await it.spec[1](); } catch (e) { console.warn(`bodyRing: ${it.code} did not load`, e); this.drop(it); return; }
    if (gen !== this.gen || !this.items.has(it.code) || this.items.get(it.code) !== it) { disposeModel(model); return; }
    const [poseKind, , pose = 0, soar] = it.spec, air = it.kind === 'air';
    const tiers = model.tiers;
    const geo = (tiers ? tiers[Math.min(tiers.length - 1, this.renderer.domElement.clientWidth < 720 ? 1 : 0)] : model.geometry).clone();
    if (it.tint) tintGeometry(geo, it.tint);
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(4), 4); geo.setAttribute('aAnim', anim);
    if (hasAnim2(model)) geo.setAttribute('aAnim2', new THREE.InstancedBufferAttribute(new Float32Array([soar ? 0.2 : 0, 0.25, 0, 0]), 4));
    // walkers standing (the folded-wing birds' pose 1); fliers on the wing, beating (a soarer's flat), as the stills
    it.flap = air && !soar; it.soar = air && !!soar;
    anim.array.set(air ? [it.phase, it.flap ? 1 : 0, 0, 0] : [0, 0, poseKind === G ? pose : 0, 0]);
    it.anim = anim;
    it.u = { uFlash: { value: 0 }, uAlpha: { value: 1 }, uFlashCol: { value: new THREE.Color(1, 1, 1) } };
    const mat = ringPatch(animalMaterial(PLAIN, model), it.u);
    const mesh = new THREE.InstancedMesh(geo, mat, 1); mesh.setMatrixAt(0, new THREE.Matrix4()); mesh.frustumCulled = false;
    geo.computeBoundingBox();
    const bb = geo.boundingBox, ext = bb.getSize(this._v);
    const m = Math.max(ext.x, ext.y, ext.z) * (it.scale || 1) || 1;
    const along = Math.max(ext.z, air ? 0 : ext.x * 0.4) * (it.scale || 1) || m;   // its length along the ring
    let D = D_MAX * Math.min(1, m / M_REF) ** 0.4;          // a compressed true scale: the deer near the most, the vole a third
    D = Math.min(D, it.dmax * m / Math.max(along, 1e-3));   // its length within the spacing
    const s = D / (m / (it.scale || 1));
    mesh.scale.setScalar(s);
    mesh.position.y = air ? -((bb.min.y + bb.max.y) / 2) * s : 0;   // a flier by its middle; a walker on its feet (the model's origin)
    it.size = D; it.h = (air ? ext.y / 2 : bb.max.y) * s;
    it.inner = new THREE.Group(); it.inner.add(mesh); it.holder.add(it.inner);
    it.mesh = mesh; it.model = model; it.geo = geo; it.mat = mat;
    // the beam it arrives in
    const bu = { uCol: { value: this.colourOf(it.code) }, uA: { value: 0 } };
    const bm = new THREE.ShaderMaterial({ uniforms: bu, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    const beam = new THREE.Mesh(this.beamGeo, bm); beam.frustumCulled = false; beam.renderOrder = 2; beam.visible = false;
    beam.scale.set(D * 0.26, D * 1.7, D * 0.26); beam.position.y = air ? -D * 0.8 : 0;
    it.holder.add(beam); it.beam = beam; it.bu = bu;
    it.u.uFlashCol.value.copy(bu.uCol.value).lerp(this._c.set(1, 1, 1), 0.6);
    // compiled before it is drawn, off the main thread where the browser can (KHR_parallel_shader_compile)
    try { await this.renderer.compileAsync(it.holder, this.cam, this.scene); } catch (e) { /* compiled on first draw instead */ }
    if (gen !== this.gen || this.items.get(it.code) !== it) return;
    if (this.held) { this.waiting.push(it); return; }
    this.pop(it);
  }
  pop(it) {
    const now = this.time, at = Math.max(now + 0.05, this.popAt || 0);
    this.popAt = at + POP_GAP[0] + Math.random() * (POP_GAP[1] - POP_GAP[0]);
    it.state = 'in'; it.t = now - at;
    for (const r of this.rings) if (r.spinAt == null) r.spinAt = at;
  }
  // The held ones pop in (in the random order they loaded), the rest as they load
  release() {
    if (!this.held) return;
    this.held = false; this.popAt = Math.max(this.popAt || 0, this.time + 0.35);   // the spirit first
    for (const it of this.waiting.splice(0)) if (this.items.get(it.code) === it) this.pop(it);
  }
  colourOf(code) {
    const r = this.rarity[code] ?? this.rarity[TWIN[code]];
    return r == null ? new THREE.Color(0.75, 0.86, 1) : rarityColor(r, new THREE.Color());
  }
  drop(it) {
    const ring = it.ring, i = ring.items.indexOf(it); if (i >= 0) ring.items.splice(i, 1);
    this.items.delete(it.code); it.holder.removeFromParent();
  }
  // Every animal beams out (a new tile's come in after them); the spirit stays.
  clear() {
    this.gen++; this.tile = null; this.list = null; this.sel = 'spirit'; this.held = false; this.waiting = [];
    for (const it of this.items.values()) {
      if (it.state === 'in') { it.state = 'out'; it.t = 0; this.leaving().push(it); } else this.free(it);
    }
    this.items = new Map();
    for (const r of this.rings) { r.target = null; r.items = []; }
    this.popAt = this.time + 0.45;
    this.onPick?.(this.sel, null);
  }
  free(it) {
    it.holder.removeFromParent();
    it.geo?.dispose(); it.mat?.dispose(); it.beam?.material.dispose(); disposeModel(it.model);
    it.geo = it.mat = it.model = null;
  }

  // ---- choosing --------------------------------------------------------------------------------------------------------
  select(code, { quiet = false } = {}) {
    if (code !== 'spirit' && !this.items.has(code)) return false;
    this.sel = code;
    for (const r of this.rings) r.target = null;
    const it = this.items.get(code);
    if (it) {
      const r = it.ring;
      let goal = -it.a; goal = r.rot + wrapPi(goal - r.rot);   // the nearest way round to the front
      r.target = goal;
      if (this.reduced) { r.rot = goal; r.vel = 0; }
    }
    if (!quiet) this.onPick?.(code, this.picked);
    return true;
  }
  setMarks(list) { this.marks = Array.isArray(list) ? list.filter(m => m && m.user && m.code) : []; }

  // ---- the frame ---------------------------------------------------------------------------------------------------------
  // box: the screen space the rings may fill { l, r, t, b } (CSS px); the walkers' ring's front stands at the bottom.
  layout(box) { this.layoutBox = box; }

  render(dt, W, H) {
    const box = this.layoutBox; if (!box || !this.renderer) return;
    this.time += dt;
    const f = ringFit(box); this.ppu = f.ppu; this.cx = f.cx; this.cy = f.cy;
    const cam = this.cam, d = U * H / (2 * Math.tan(FOV / 2 * DEG) * f.ppu);
    cam.aspect = W / H; cam.near = Math.max(0.05, d - 6 * U); cam.far = d + 6 * U;
    cam.position.set(0, Math.sin(ELEV) * d, Math.cos(ELEV) * d); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
    cam.setViewOffset(W, H, -(f.cx - W / 2), -(f.cy - H / 2), W, H);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // the rings: a slow turn once the first arrive, or the swing to the chosen one
    for (const r of this.rings) {
      if (r.target != null) {
        const x = r.rot - r.target, w = SWING_W;
        const a = -w * w * x - 2 * w * r.vel; r.vel += a * dt; r.rot += r.vel * dt;
        if (Math.abs(x) < 1e-4 && Math.abs(r.vel) < 1e-4) { r.rot = r.target; r.vel = 0; }
      } else if (r.spinAt != null && !this.reduced) {
        const goal = SPIN[r.i] * smooth(0, SPIN_IN_S, this.time - r.spinAt);
        r.vel += (goal - r.vel) * (1 - Math.exp(-dt * 1.5)); r.rot += r.vel * dt;
      } else r.vel = 0;
      r.group.rotation.y = r.rot;
    }
    // each animal: its arrival or going, its facing along its ring's turn (the chosen one turned toward the camera), the beat
    let halo = null;
    for (const it of [...this.items.values(), ...this.leaving()]) this.step(it, dt);   // (a leaving one may free itself)
    const it = this.items.get(this.sel);
    if (it && it.state === 'in' && it.t > 0.2) halo = it;
    // the halo under the chosen animal (or the spirit)
    const H0 = this.halo; H0.a += ((halo || this.sel === 'spirit' ? 1 : 0) - H0.a) * (1 - Math.exp(-dt * 6));
    if (halo) {
      this.world.worldToLocal(halo.holder.getWorldPosition(this._v));
      const air = halo.kind === 'air', sz = halo.size * (air ? 0.95 : 1.4);
      H0.mesh.position.set(this._v.x, this._v.y + (air ? -halo.size * 0.3 : 0.003), this._v.z);
      H0.mesh.scale.set(sz, 1, sz);
    } else if (this.sel === 'spirit') { H0.mesh.position.set(0, 0.003, 0); H0.mesh.scale.set(D_SPIRIT * 1.2, 1, D_SPIRIT * 1.2); }
    H0.u.uA.value = H0.a * (0.75 + 0.25 * Math.sin(this.time * 2.2));
    // the spirit: in first, circling a little where the rings' middle is, swelling when chosen
    this.wispIn = clamp(this.wispIn + (this.tile && !this.held ? 1 : -1.6) * dt / (this.reduced ? FADE_S : 0.9), 0, 1);
    this.wispT += dt;
    const sw = this.reduced ? 0.7 : 1, wr = WISP_R / U, ww = TAU / WISP_LAP * sw;
    this.wispP.set(Math.cos(this.wispT * ww) * wr, Y_AIR * 0.42 + Math.sin(this.wispT * 0.9) * 0.02, -Math.sin(this.wispT * ww) * wr);
    const k = this.swell = (this.swell ?? 1) + ((this.sel === 'spirit' ? 1 : 0.3) - (this.swell ?? 1)) * (1 - Math.exp(-dt * 4));
    if (this.wispIn > 0.002) {
      const grow = this.reduced ? 1 : easeOutBack(this.wispIn), lum = (W_REST[1] + (1 - W_REST[1]) * k) * (this.reduced ? this.wispIn : 1);
      this.wisp.update(dt, this._v.copy(this.wispP).multiplyScalar(U), this.wispT * ww, true, Math.max(0.01, grow), 1, W_REST[0] + (1 - W_REST[0]) * k, lum, 1 + 0.7 * k);
    } else if (this.wisp.shown) this.wisp.update(dt, this._v.copy(this.wispP).multiplyScalar(U), 0, false, 1, 1);
    // drawn over the earth: the depth cleared, the renderer left as it was
    const r = this.renderer, ac = r.autoClear;
    r.autoClear = false; r.clearDepth();
    r.render(this.scene, cam);
    r.autoClear = ac;
    this.syncDom(W, H);
  }
  leaving() { if (!this.gone) this.gone = []; return this.gone; }
  step(it, dt) {
    if (!it.mesh) return;
    it.t += dt;
    const t = it.t, R = this.reduced;
    let scale = 1, flash = 0, beam = 0, alpha = 1;
    if (it.state === 'in') {
      if (t < 0) { it.holder.visible = false; return; }
      if (R) alpha = clamp(t / FADE_S, 0, 1);
      else {
        scale = t < 0.12 ? 0 : easeOutBack(clamp((t - 0.12) / 0.42, 0, 1));
        flash = t < 0.12 ? 1 : 1 - smooth(0.12, 0.62, t);
        beam = smooth(0, 0.12, t) * (1 - smooth(0.3, POP_IN, t)) * 0.8;
      }
    } else if (it.state === 'out') {
      if (R) alpha = 1 - clamp(t / FADE_S, 0, 1);
      else {
        flash = smooth(0, 0.18, t); scale = 1 - smooth(0.12, 0.45, t);
        beam = smooth(0, 0.16, t) * (1 - smooth(0.3, POP_OUT, t));
      }
      if (t > (R ? FADE_S : POP_OUT)) { this.free(it); this.gone.splice(this.gone.indexOf(it), 1); return; }
    }
    it.holder.visible = true;
    const chosen = it.code === this.sel && it.state === 'in';
    it.pick = (it.pick || 0) + ((chosen ? 1 : 0) - (it.pick || 0)) * (1 - Math.exp(-dt * 5));
    it.inner.scale.setScalar(Math.max(1e-4, scale * (1 + 0.16 * it.pick)));
    it.u.uFlash.value = flash; it.u.uAlpha.value = alpha;
    const tr = alpha < 1; if (it.mat.transparent !== tr) { it.mat.transparent = tr; it.mat.depthWrite = !tr; it.mat.needsUpdate = true; }
    it.beam.visible = beam > 0.002; it.bu.uA.value = beam;
    // facing: along the ring's turn; the chosen one partly toward the camera (outward at the front)
    const dir = SPIN[it.ring.i] >= 0 ? 1 : -1, path = it.a + dir * Math.PI / 2;
    it.holder.rotation.y = path + wrapPi(it.a - path) * FACE_TURN * it.pick;
    if (it.kind === 'air') {
      it.holder.position.y = Math.sin(this.time * 0.8 + it.phase) * 0.02;
      it.inner.rotation.z = -dir * 0.16 * (1 - it.pick);   // banked into the turn
      if (it.flap) { it.anim.array[0] = (it.anim.array[0] + dt * TAU * BEAT) % TAU; it.anim.needsUpdate = true; }
    }
  }

  // The faces of the group's picks over their animals, and the hovered animal's name
  syncDom(W, H) {
    if (!this.marksEl) return;
    const byCode = new Map();
    for (const m of this.marks) { const k = this.items.has(m.code) || m.code === 'spirit' ? m.code : null; if (!k) continue; if (!byCode.has(k)) byCode.set(k, []); byCode.get(k).push(m); }
    const keep = new Set();
    for (const [code, ms] of byCode) {
      const p = this.screenOf(code, true); if (!p) continue;
      ms.forEach((m, i) => {
        const key = `${m.user}`; keep.add(key);
        let el = this.markEls.get(key);
        if (!el || el.dataset.code !== code || el.dataset.here !== String(!!m.here)) {
          el?.remove();
          el = document.createElement('div'); el.className = `br-mark${m.here ? ' here' : ''}`; el.dataset.code = code; el.dataset.here = String(!!m.here);
          const av = avatarFor(m.user, MARK_PX); el.append(av);
          const nm = document.createElement('span'); nm.textContent = m.name || 'someone'; el.append(nm);
          el.title = `${m.name || 'someone'} ${m.here ? 'is' : 'chose'} ${code === 'spirit' ? 'the spirit' : `the ${this.items.get(code)?.name || code.replace(/_/g, ' ')}`}`;
          this.marksEl.append(el); this.markEls.set(key, el);
        }
        const dx = (i - (ms.length - 1) / 2) * (MARK_PX + 4);
        el.style.transform = `translate(${(p.x + dx).toFixed(1)}px, ${(p.top - 6).toFixed(1)}px) translate(-50%, -100%)`;
        el.classList.toggle('front', p.front);
      });
    }
    for (const [k, el] of this.markEls) if (!keep.has(k)) { el.remove(); this.markEls.delete(k); }
    const h = this.hoverCode, n = this.nameEl;
    const hp = h ? this.screenOf(h, true) : null;
    if (hp) {
      const it = this.items.get(h), text = this.guest ? 'Log in or sign up to start' : h === 'spirit' ? 'the spirit' : it?.name || h;
      if (n.textContent !== text) n.textContent = text;
      n.classList.toggle('guest', !!this.guest);
      n.hidden = false; n.style.transform = `translate(${hp.x.toFixed(1)}px, ${(hp.bottom + 8).toFixed(1)}px) translate(-50%, 0)`;
    } else n.hidden = true;
  }
  // An animal's place on screen: { x, y (its middle), top, bottom, r (px), front (its depth's share toward the camera) }
  screenOf(code, live = false) {
    const W = this.renderer.domElement.clientWidth || innerWidth, H = this.renderer.domElement.clientHeight || innerHeight;
    let P, size, h;
    if (code === 'spirit') { P = this._v.copy(this.wispP).multiplyScalar(U); size = D_SPIRIT; h = 0; }
    else {
      const it = this.items.get(code); if (!it || !it.mesh || (live && (it.state !== 'in' || it.t < 0))) return null;
      it.holder.updateWorldMatrix(true, false);
      P = it.holder.getWorldPosition(this._v); size = it.size * (1 + 0.16 * (it.pick || 0)); h = it.kind === 'air' ? 0 : it.h * (1 + 0.16 * (it.pick || 0));
      P.y += h / 2 * U;
    }
    const z = P.z;
    P.project(this.cam);
    if (P.z > 1) return null;
    const x = (P.x + 1) / 2 * W, y = (1 - P.y) / 2 * H, pr = size * this.ppu * 0.5;
    return { x, y, top: y - Math.max(pr * 0.55, (h / 2) * this.ppu * 0.85), bottom: y + Math.max(pr * 0.55, (h / 2) * this.ppu), r: Math.max(14, pr), front: z > 0 };
  }
  // The code under a screen point (the nearest within its size, the nearer to the camera first), or null
  hit(x, y) {
    if (!this.layoutBox) return null;
    let best = null, bd = Infinity;
    for (const code of ['spirit', ...this.items.keys()]) {
      const p = this.screenOf(code, true); if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y) / p.r; if (d > 1.15) continue;
      const score = d - (p.front ? 0.3 : 0);
      if (score < bd) { bd = score; best = code; }
    }
    return best;
  }
  hover(code) { this.hoverCode = code || null; }

  dispose() {
    this.gen++;
    for (const it of [...this.items.values(), ...this.leaving()]) this.free(it);
    this.items.clear(); this.gone = [];
    this.wisp.dispose();
    this.halo.mesh.material.dispose();
    this.beamGeo.dispose(); this.discGeo.dispose(); this.haloGeo.dispose();
    this.scene.clear();
    this.marksEl?.remove(); this.nameEl?.remove();
    this.renderer = null;
  }
}
