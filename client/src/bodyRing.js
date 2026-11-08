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
// over the tile in rings, the walkers on the lower planes and the fliers on the upper ones, the spirit bigger in the
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
// Pinned to the tile (Aaron, 2026-11-07: "lets have the avatar selector pinned to the tile ... The circle of animals
// should be "inside" the boundary of the tile"): the rings live in the tile's own frame (its centre on the earth, x east,
// y up, z south), drawn through the earth camera expressed in that frame (pin), so they stay registered to the tile as
// the view zooms, drifts or resizes. Units: the walkers' ring has radius 1 = RING_HW of the tile's half-width.
//
// Four rings on stacked planes, each turning on its own (Aaron, 2026-11-07 and 2026-11-08): many walkers stand in an outer
// and an inner ring, many fliers in an inner and an outer ring, each turning the other way from the one under it. Bottom
// to top: the walkers' outer ring on a plane at the relief's highest point (pin's top), their inner ring, the spirit, the
// fliers' inner ring, their outer ring (levels, GAP), each with its faint track and its animals' shadows on its own plane.
// Choosing an animal swings only its own ring; the pointer over an animal holds its ring still, and a drag on one turns
// that ring alone (grab, turn, letGo). The smaller walkers stand on the outer ring and the bigger on the inner, the
// smaller fliers on the inner and the bigger (the soarers) on the outer (splitBySize, by mass). Each animal is drawn bigger toward the front of its ring
// and smaller toward the back, beyond what the perspective does (DEPTH_K), the gaps between them widening and narrowing
// with it (warp), and a bird standing on the walkers' rings folds its wings.
//
//   new BodyRing({ renderer, box, onPick, guest })   box: an element over the canvas for the faces and the hover name
//   pin({ cam, earth, p0, hw, top })   each frame: the earth camera, the earth group, the tile's centre (unit vector, the
//                     earth's frame), its half-width and its relief's highest point over the sphere (earth radii); null: nothing drawn
//   show(tileId)      the tile's animals teleport in (a previous tile's go first); resolves when the list is known
//   clear()           every animal goes (beamed out)
//   select(code)      'spirit' or a species code: its ring alone swings that animal to the front
//   grab(code), turn(ring, px), letGo(ring, px/s)   the pointer's drag on a ring
//   selected, picked  the code chosen; the entry { code, name, kind } or null for the spirit
//   setMarks(list)    [{ user, name, code, here }] the group's picks (here: the body they are in there)
//   hit(x, y)         the code under a screen point, or null
//   render(dt, W, H)  a frame, over what the renderer drew
//   dispose()         everything off the GPU and out of the DOM

const DEG = Math.PI / 180, TAU = Math.PI * 2;
export const RING_HW = 0.64;                                 // the walkers' ring's radius, of the tile's half-width
// The levels (Aaron, 2026-11-08: "we raise them above the top of the height map. The outer ring of the land animals is at
// the plane at the top of the height map, then above that is the inner ring, then above that is the soul, then above that
// is the inner ring of birds, and above that is the outer ring of birds"): each ring on its own plane, the lowest at the
// relief's highest point (pin's top), each next a gap above it (ring radii): close between the walkers' two, the spirit
// a little over them, then the fliers well up so their rings' fronts stand over the walkers' backs, not across them; an
// empty ring takes no level
const GAP = { land: 0.13, spirit: 0.2, air: 0.38, air2: 0.22 };   // to the walkers' inner, to the spirit, to the fliers' first, to their second
export const STACK_Y = GAP.land + GAP.spirit + GAP.air + GAP.air2;   // the top level over the lowest, all four rings filled
export const AIR_R = [1.0, 1.42], AIR_ONE = 1.3;             // the fliers' inner (the smaller) and outer (the bigger, the soarers) rings' radii; their one ring's when few
const WISP_UP = 0.07;                                 // the spirit over its level
const TRACK = [0.012, 0.14];                          // each ring's track on its plane: its width (ring radii) and brightness
const SUN = new THREE.Vector3(-0.5, 1, 0.9);           // the rings' light (as the stills'): the shadows fall away from it
const SHADOW = [0.62, 0.2];                           // the contact shadows' darkness: walkers, fliers (fainter and wider from their height)
const D_MAX = 0.44, D_SPIRIT = 0.3, M_REF = 2.2;     // an animal's largest side (ring radii) at most, for M_REF m and over; the spirit's halo
const D_EXP = 0.3, D_FLOOR = 0.56, A_MIN = 0.16;      // A_MIN: a walker's least visible size (its height or plan), ring radii: about 40% of the deer's                    // the size's compression (m^0.3) and its floor: the smallest at about half the largest
const ROWS2 = 14;                                     // more walkers (or fliers) than this stand in two rings, the smaller on one and the bigger on the other
const WALK_R = [1.16, 0.8];                          // the walkers' outer and inner rings' radii (ring radii)
const SPACING = 0.86;                                // of the ring's spacing an animal may fill
// rad/s: the walkers' outer ring, their inner ring (the other way: Aaron, 2026-11-07: "There are inner and outer rings of
// animals, they should spin in opposite directions and be independently controlled"), the fliers' inner and outer rings
// (each the other way from the one under it)
const SPIN = [0.075, -0.06, 0.05, -0.04];
// the size by depth (Aaron, 2026-11-07: "decrease the size of the avatars the further away they are from the camera", then
// "a bit stronger"): 1 + DEPTH_K per ring radius toward the camera, beyond perspective, within [DEPTH_MIN, DEPTH_MAX]: the
// outer ring's front about 1.6 and its back 0.45. The gaps between them follow it ("their margin should also grow"): each
// ring's even slots are warped toward the front (warp), the gap there 1 + e and at the back 1 - e of the even one
const DEPTH_K = 0.5, DEPTH_MIN = 0.45, DEPTH_MAX = 1.65;
const SPIN_IN_S = 2.5;                               // the turn's ease in, from the first arrival
const SWING_W = 2.6;                                 // the swing to the front: a critically damped spring (rad/s)
const POP_GAP = [0.07, 0.17], POP_IN = 0.75, POP_OUT = 0.65, FADE_S = 0.6;
const FACE_TURN = 0.45;                              // the chosen animal turns this share from its path toward the camera
const LOADS = 4;                                     // models loading at once
const BEAT = 2.4;                                    // Hz: the fliers' wingbeat, slowed for the screen
const MARK_PX = 22;
const WISP_R = 0.4, WISP_LAP = 1.2;                 // m, s: the wisp's circle, chasing its tail (as the opening's sprite: compact)
const W_REST = [0.5, 0.6];                           // the wisp unchosen: its size and brightness (spirit.js REST_SCALE, REST_LUM)
const U = 2.2;                                       // metres per ring radius: the scene's scale, against which the wisp has its own size
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
// kind: 'ground' | 'air', spec, tint, scale, mass } (spec as MODELS': [pose kind, load, pose, soar]; mass: kg, massOf).
export async function bodiesOf(tileId) {
  const [sp, fauna, loco] = await Promise.all([getJSON(`../tiles/${tileId}/species/species.json`), getJSON(`../tiles/${tileId}/client/fauna.json`), getJSON(`../tiles/${tileId}/locomotion.json`)]);
  const L = loco?.species || {};
  const list = Array.isArray(sp) ? sp : sp?.species || [];
  const out = [], seen = new Set();
  for (const s of list) {
    const code = s?.code; if (!code || s.present === false || seen.has(code) || !MODELS[code]) continue;
    const kind = kindOf(code); if (!kind) continue;
    seen.add(code); out.push({ code, name: commonOf(code), kind, spec: MODELS[code], mass: massOf(L, code) });
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
      spec = [bird ? 'bird' : G, () => loadFaunaModel(f.model.path, tpl, { skin: f.model.skin !== false }), !bird && f.bird ? 1 : 0, f.archetype === 'soar' || tpl === 'hawk' ? 'soar' : undefined];   // a bird on the walkers' ring stands, wings folded (pose 1)
      scale = 1; tint = null;
    }
    const mass = Number.isFinite(f.mass_kg) && f.mass_kg > 0 ? f.mass_kg : massOf(L, kin, Number.isFinite(f.scale) && f.scale > 0 ? f.scale : 1);
    seen.add(code); out.push({ code, name, kind: kk, spec, tint, scale, standIn: true, mass });
  }
  return out;
}

// A body's mass (kg): the tile's locomotion layer's (strikes.js bodyOf's source), else the model's size (its controller's
// half-length, cubed at a deer's density: GROUND half 0.6 m for 60 kg); a kin's scaled by the stand-in's size cubed; null
// when neither is known
const KG_PER_HALF3 = 280;
function massOf(L, code, scale = 1) {
  const m = L[code]?.mass_kg, half = GROUND[code]?.half;
  return Number.isFinite(m) && m > 0 ? m * scale ** 3 : Number.isFinite(half) ? KG_PER_HALF3 * (half * scale) ** 3 : null;
}

// The walkers split into [outer, inner]: the heaviest on the inner ring, as many as leave both rings' animals the same
// room for their length (each wants about its size, SIZE_OF, of its ring's circumference); each ring keeps the list's order
// so its sizes stay mixed round it. Unknown masses count as the middle one.
const SIZE_OF = m => Math.max(D_FLOOR, Math.min(1, Math.cbrt(m / 60)) ** D_EXP);
function splitBySize(walk, rSmall = WALK_R[0], rBig = WALK_R[1]) {
  const known = walk.map(b => b.mass).filter(m => m > 0).sort((a, b) => a - b), mid = known.length ? known[known.length >> 1] : 1;
  const mOf = b => b.mass > 0 ? b.mass : mid;
  const order = [...walk].sort((a, b) => mOf(b) - mOf(a) || (a.code < b.code ? -1 : 1));
  const w = order.map(b => SIZE_OF(mOf(b))), all = w.reduce((a, b) => a + b, 0);
  let best = 1, err = Infinity, sum = 0;
  for (let k = 1; k < order.length; k++) {
    sum += w[k - 1];
    const e = Math.abs(sum / rBig - (all - sum) / rSmall);
    if (e < err) { err = e; best = k; }
  }
  const inner = new Set(order.slice(0, best));
  return [walk.filter(b => !inner.has(b)), walk.filter(b => inner.has(b))];   // [the smaller, the bigger]
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
const SHADOW_FRAG = /* glsl */`
uniform float uA; varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0), a = 1.0 - smoothstep(0.0, 1.0, r);
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * uA);
}`;
const HALO_FRAG = /* glsl */`
uniform vec3 uCol; uniform float uA; varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (smoothstep(1.0, 0.55, r) * 0.55 + smoothstep(0.08, 0.0, abs(r - 0.82)) * 0.9) * uA;
  gl_FragColor = vec4(uCol * a, 1.0);
}`;

export class BodyRing {
  constructor({ renderer, box = null, onPick = null, guest = false }) {
    this.renderer = renderer; this.box = box; this.onPick = onPick; this.guest = guest;
    this.reduced = reducedMotion();
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    this.pinTo = null; this._e = new THREE.Vector3(); this._n = new THREE.Vector3(); this._u = new THREE.Vector3(); this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x40372a, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.copy(SUN); this.scene.add(sun);
    this.world = new THREE.Group(); this.world.scale.setScalar(U); this.scene.add(this.world);   // the rings, in ring radii
    // the walkers' outer ring (their only one when few), their inner ring, the fliers' inner ring (their only one when few)
    // and their outer ring, bottom to top; each turns on its own, on its own plane, its track drawn faintly on it
    this.trackGeo = new THREE.RingGeometry(1 - TRACK[0] / 2, 1 + TRACK[0] / 2, 160, 1); this.trackGeo.rotateX(-Math.PI / 2);
    this.rings = [0, 1, 2, 3].map(i => {
      const air = i >= 2, group = new THREE.Group(); this.world.add(group);
      const track = new THREE.Mesh(this.trackGeo, new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      track.renderOrder = -2; track.frustumCulled = false; this.world.add(track);
      return { i, air, group, track, items: [], rot: [0, 0.3, 0.5, 0.9][i], vel: 0, target: null, R: air ? AIR_R[i - 2] : 1, spin: SPIN[i], spinAt: null, drag: false, y: null };
    });
    this.base = null;   // the relief's top (ring radii), eased
    this._cd = new THREE.Vector2(0, 1);
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); this.beamGeo.translate(0, 0.5, 0);
    this.discGeo = new THREE.PlaneGeometry(1, 1); this.discGeo.rotateX(-Math.PI / 2);
    this.haloGeo = new THREE.PlaneGeometry(1, 1);
    this.halo = this.makeHalo(); this.world.add(this.halo.mesh);
    // the spirit in the middle: the wisp, circling a little so its ribbons stream
    this.wisp = new Wisp({ renderer, camera: this.cam, scene: this.scene });
    this.wispP = new THREE.Vector3(); this.wispT = 0; this.wispIn = 0;
    this.items = new Map(); this.sel = 'spirit'; this.tile = null; this.gen = 0; this.marks = [];
    this.rarity = rarityByCode();
    this.ppu = 100; this.shown = false; this.time = 0; this.popAt = 0;
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
    // the walkers: one ring, or (many) an outer ring of the smaller and an inner ring of the bigger (Aaron, 2026-11-07: "The
    // outer rings should be smaller species, the inner ring should be bigger species"), split by mass where each ring's
    // animals' room over its length comes out alike (splitBySize); the fliers the same way round, the smaller on their
    // inner ring and the bigger (the soarers) on their outer
    const walk = list.filter(b => b.kind === 'ground'), air = list.filter(b => b.kind === 'air');
    const [wSmall, wBig] = walk.length > ROWS2 ? splitBySize(walk) : [walk, []];
    const [aSmall, aBig] = air.length > ROWS2 ? splitBySize(air, AIR_R[0], AIR_R[1]) : [air, []];
    const by = [wSmall, wBig, aSmall, aBig];
    for (const r of this.rings) r.R = r.air ? (aBig.length ? AIR_R[r.i - 2] : AIR_ONE) : (wBig.length ? WALK_R[r.i] : 1);
    by.forEach((arr, ri) => {
      const ring = this.rings[ri], n = arr.length;
      ring.items = []; ring.target = null; ring.spinAt = null; ring.vel = 0; ring.drag = false;
      const dmax = Math.min(D_MAX, SPACING * TAU * ring.R / Math.max(1, n));
      arr.forEach((b, k) => {
        const r = ring.R;
        const it = { ...b, ring, a: n ? (k / n) * TAU : 0, r, dmax, state: 'loading', t: 0, scale: 0, flash: 0, alpha: 1, depthF: 1,
          holder: new THREE.Group(), mesh: null, model: null, beam: null, phase: Math.random() * TAU, size: 0, h: 0 };
        it.holder.position.set(Math.sin(it.a) * r, 0, Math.cos(it.a) * r);
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
    // walkers standing; fliers on the wing, beating (a soarer's flat), as the stills. A bird on the walkers' rings stands
    // with its wings folded (pose 1: Aaron, 2026-11-07: "Birds on the ground should not have their wings spread"), whatever
    // its entry's pose: every bird model's rig says so (the heron's, merganser's and mallard's templates spread at 0)
    it.flap = air && !soar; it.soar = air && !!soar;
    const fold = !air && model.rig?.kind === 'bird';
    anim.array.set(air ? [it.phase, it.flap ? 1 : 0, 0, 0] : [0, 0, fold ? Math.max(1, pose) : poseKind === G ? pose : 0, 0]);
    it.anim = anim;
    it.u = { uFlash: { value: 0 }, uAlpha: { value: 1 }, uFlashCol: { value: new THREE.Color(1, 1, 1) } };
    const mat = ringPatch(animalMaterial(PLAIN, model), it.u);
    const mesh = new THREE.InstancedMesh(geo, mat, 1); mesh.setMatrixAt(0, new THREE.Matrix4()); mesh.frustumCulled = false;
    geo.computeBoundingBox();
    const bb = geo.boundingBox, ext = bb.getSize(this._v);
    const m = Math.max(ext.x, ext.y, ext.z) * (it.scale || 1) || 1;
    const along = Math.max(ext.z, air ? 0 : ext.x * 0.4) * (it.scale || 1) || m;   // its length along the ring
    let D = D_MAX * Math.max(D_FLOOR, Math.min(1, m / M_REF) ** D_EXP);   // compressed: the deer near the most, a squirrel or a jay about half
    D = Math.min(D, it.dmax * m / Math.max(along, 1e-3));   // its length within the spacing
    let s = D / (m / (it.scale || 1));
    // the small walkers seen from above (a vole, a lizard, a snake): their height or their plan at least A_MIN, as far as the
    // spacing lets their length grow (Aaron, 2026-11-07: "The smallest animals should have their size increased more")
    if (!air) {
      const a = Math.max(bb.max.y, Math.sqrt(ext.x * ext.z) * 0.7) * s;
      if (a < A_MIN) { const g = Math.max(1, Math.min(A_MIN / a, 2.5, it.dmax / Math.max(1e-4, ext.z * s))); s *= g; D *= g; }
    }
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
    // its contact shadow on the ground under it (Aaron, 2026-11-07: "Ground animals should have drop shadows"): a soft
    // dark ellipse its length and breadth, the walkers' at their feet, a flier's fainter and wider far below it
    const su = { uA: { value: 0 } };
    const sm = new THREE.ShaderMaterial({ uniforms: su, vertexShader: BEAM_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false, toneMapped: false });
    const shadow = new THREE.Mesh(this.discGeo, sm); shadow.frustumCulled = false; shadow.renderOrder = -1;
    const len = Math.max(ext.z, ext.x * 0.5) * s, wid = Math.max(ext.x * (air ? 0.7 : 1.15) * s, len * (air ? 0.5 : 0.42));
    it.shS = [wid * (air ? 1.5 : 1.25), len * (air ? 1.3 : 1.25)]; shadow.scale.set(it.shS[0], 1, it.shS[1]); shadow.visible = false;
    this.world.add(shadow); it.shadow = shadow; it.su = su;   // on the rings' ground, placed each frame (step)
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
    it.geo?.dispose(); it.mat?.dispose(); it.beam?.material.dispose(); it.shadow?.removeFromParent(); it.shadow?.material.dispose(); disposeModel(it.model);
    it.geo = it.mat = it.model = null;
  }

  // ---- choosing --------------------------------------------------------------------------------------------------------
  select(code, { quiet = false } = {}) {
    if (code !== 'spirit' && !this.items.has(code)) return false;
    this.sel = code;
    const it = this.items.get(code);
    for (const r of this.rings) r.target = null;   // only the chosen one's ring swings (below); the others turn on, a ring held for an earlier choice too
    if (it) {
      const r = it.ring;
      let goal = (this.camA || 0) - it.a; goal = r.rot + wrapPi(goal - r.rot);   // the nearest way round to the front (the warp keeps the front where it is)
      r.target = goal;
      r.drag = false;
      if (this.reduced) { r.rot = goal; r.vel = 0; }
    }
    if (!quiet) this.onPick?.(code, this.picked);
    return true;
  }
  setMarks(list) { this.marks = Array.isArray(list) ? list.filter(m => m && m.user && m.code) : []; }

  // ---- the frame ---------------------------------------------------------------------------------------------------------
  pin(p) { this.pinTo = p; }
  // The earth camera in the tile's frame (scene units: metres, U to a ring radius): false when the tile is out of sight
  // (the earth's far side) or too small on screen to choose from
  frameCam(W, H) {
    const P = this.pinTo; if (!P?.cam || !P.earth || !P.p0) return false;
    const gc = P.cam, q = P.earth.quaternion, up = this._u.copy(P.p0).normalize();
    const east = this._e.set(up.z, 0, -up.x).normalize(), north = this._n.crossVectors(up, east);
    east.applyQuaternion(q); north.applyQuaternion(q); up.applyQuaternion(q);
    const k = P.hw * RING_HW / U;   // earth radii per scene unit
    const O = this._v.copy(up).add(P.earth.position);   // the tile's centre on the sphere
    const south = north.negate();
    this._m4.makeBasis(east, up, south);   // the tile's frame's axes in the earth scene
    const rel = gc.position.clone().sub(O);
    if (rel.dot(up) <= 0) return false;   // under the horizon of the tile: the far side
    const cam = this.cam;
    cam.position.set(rel.dot(east), rel.dot(up), rel.dot(south)).divideScalar(k);
    cam.quaternion.setFromRotationMatrix(this._m4).invert().multiply(gc.quaternion);
    cam.fov = gc.fov; cam.aspect = gc.aspect; cam.near = gc.near / k; cam.far = gc.far / k;
    if (gc.view?.enabled) cam.setViewOffset(gc.view.fullWidth, gc.view.fullHeight, gc.view.offsetX, gc.view.offsetY, gc.view.width, gc.view.height); else cam.clearViewOffset();
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    this.ppu = H / (2 * Math.tan(cam.fov / 2 * DEG)) / (cam.position.length() / U);   // px per ring radius at the tile's centre
    this.baseGoal = Math.max(0, P.top || 0) / (P.hw * RING_HW);   // the relief's top, earth radii to ring radii
    return this.ppu > 30;
  }

  render(dt, W, H) {
    if (!this.renderer) return;
    this.time += dt;
    this.shown = this.frameCam(W, H);
    if (this.box) this.box.style.visibility = this.shown ? '' : 'hidden';
    const cam = this.cam;
    // the rings: a slow turn once the first arrive, or the swing to the chosen one
    const hov = this.items.get(this.hoverCode)?.ring;
    for (const r of this.rings) {
      if (r.drag) { /* turned by the pointer (turn) */ }
      else if (r.target != null) {
        const x = r.rot - r.target, w = SWING_W;
        const a = -w * w * x - 2 * w * r.vel; r.vel += a * dt; r.rot += r.vel * dt;
        if (Math.abs(x) < 1e-4 && Math.abs(r.vel) < 1e-4) { r.rot = r.target; r.vel = 0; }
      } else if (r.spinAt != null && !this.reduced) {   // its slow turn, held while the pointer is over one of its animals
        const goal = r === hov ? 0 : r.spin * smooth(0, SPIN_IN_S, this.time - r.spinAt);
        r.vel += (goal - r.vel) * (1 - Math.exp(-dt * (r === hov ? 5 : 1.5))); r.rot += r.vel * dt;
      } else r.vel = 0;
      r.group.rotation.y = r.rot;
    }
    this.levels(dt);
    // each animal: its arrival or going, its facing along its ring's turn (the chosen one turned toward the camera), the beat
    let halo = null;
    this._cd.set(cam.position.x, cam.position.z); if (this._cd.lengthSq() > 1e-9) this._cd.normalize(); else this._cd.set(0, 1);   // toward the camera, level
    this.camA = Math.atan2(this._cd.x, this._cd.y);   // its angle round the rings (as an animal's: x sin, z cos)
    for (const it of [...this.items.values(), ...this.leaving()]) this.step(it, dt);   // (a leaving one may free itself)
    const it = this.items.get(this.sel);
    if (it && it.state === 'in' && it.t > 0.2) halo = it;
    // the halo under the chosen animal (or the spirit)
    const H0 = this.halo; H0.a += ((halo || this.sel === 'spirit' ? 1 : 0) - H0.a) * (1 - Math.exp(-dt * 6));
    if (halo) {
      this.world.worldToLocal(halo.holder.getWorldPosition(this._v));
      const air = halo.kind === 'air', sz = halo.size * halo.depthF * (air ? 0.95 : 1.4);
      H0.mesh.position.set(this._v.x, halo.ring.y + 0.003, this._v.z);   // on its ring's plane
      H0.mesh.scale.set(sz, 1, sz);
    } else if (this.sel === 'spirit') { H0.mesh.position.set(0, this.spiritY + 0.003, 0); H0.mesh.scale.set(D_SPIRIT * 1.2, 1, D_SPIRIT * 1.2); }
    H0.u.uA.value = H0.a * (0.75 + 0.25 * Math.sin(this.time * 2.2));
    // the spirit: in first, circling a little where the rings' middle is, swelling when chosen
    this.wispIn = clamp(this.wispIn + (this.tile && !this.held ? 1 : -1.6) * dt / (this.reduced ? FADE_S : 0.9), 0, 1);
    this.wispT += dt;
    const sw = this.reduced ? 0.7 : 1, wr = WISP_R / U, ww = TAU / WISP_LAP * sw;
    this.wispP.set(Math.cos(this.wispT * ww) * wr, this.spiritY + WISP_UP + Math.sin(this.wispT * 0.9) * 0.02, -Math.sin(this.wispT * ww) * wr);
    const k = this.swell = (this.swell ?? 1) + ((this.sel === 'spirit' ? 1 : 0.3) - (this.swell ?? 1)) * (1 - Math.exp(-dt * 4));
    if (this.wispIn > 0.002) {
      const grow = this.reduced ? 1 : easeOutBack(this.wispIn), lum = (W_REST[1] + (1 - W_REST[1]) * k) * (this.reduced ? this.wispIn : 1);
      this.wisp.update(dt, this._v.copy(this.wispP).multiplyScalar(U), this.wispT * ww, true, Math.max(0.01, grow), 1, W_REST[0] + (1 - W_REST[0]) * k, lum, 1 + 0.7 * k);
    } else if (this.wisp.shown) this.wisp.update(dt, this._v.copy(this.wispP).multiplyScalar(U), 0, false, 1, 1);
    // drawn over the earth: the depth cleared, the renderer left as it was
    if (!this.shown) return;
    const r = this.renderer, ac = r.autoClear;
    r.autoClear = false; r.clearDepth();
    r.render(this.scene, cam);
    r.autoClear = ac;
    this.syncDom(W, H);
  }
  leaving() { if (!this.gone) this.gone = []; return this.gone; }
  // The planes: bottom to top the walkers' outer ring, their inner, the spirit, the fliers' inner, their outer, the lowest
  // at the relief's top and each next a GAP above (an empty ring takes none), eased as the relief arrives or the cast
  // changes; each ring's track on its plane, faint, fading with its animals
  levels(dt) {
    const k = 1 - Math.exp(-dt * 4);
    this.base = this.base == null ? this.baseGoal || 0 : this.base + ((this.baseGoal || 0) - this.base) * k;
    const order = [...this.rings.filter(r => !r.air && r.items.length), 'spirit', ...this.rings.filter(r => r.air && r.items.length)];
    let y = this.base;
    order.forEach((r, n) => {
      if (n) y += r === 'spirit' ? GAP.spirit : r.air ? (order[n - 1] === 'spirit' ? GAP.air : GAP.air2) : GAP.land;
      if (r === 'spirit') { this.spiritY = this.spiritY == null ? y : this.spiritY + (y - this.spiritY) * k; return; }
      r.y = r.y == null ? y : r.y + (y - r.y) * k;
    });
    for (const r of this.rings) {
      if (r.y == null) r.y = this.base;
      r.group.position.y = r.y;
      const live = r.items.some(it => it.state === 'in' && it.t > 0);
      r.trackA = (r.trackA || 0) + ((live && !this.reduced ? 1 : live ? 0.6 : 0) - (r.trackA || 0)) * k;
      r.track.visible = r.trackA > 0.01; r.track.material.opacity = TRACK[1] * r.trackA;
      r.track.position.y = r.y + 0.002; r.track.scale.setScalar(r.R);
    }
  }
  // The depth spacing: an animal's even slot (its angle a plus its ring's turn) measured from the front, psi, is drawn at
  // psi + e sin psi, so the slots' gaps are 1 + e cos psi of the even one, following the size by depth (e: the size's slope
  // over the ring's radius, kept inside its bounds). Smooth and monotone in the turn (e < 1): nothing jitters as a ring
  // turns or overtakes its neighbour, and the front and the back stay where they are. Returns the ring's local angle.
  warpE(r) { return Math.min(DEPTH_K * r.R, 1 - DEPTH_MIN, DEPTH_MAX - 1); }
  warp(it) {
    const r = it.ring, c = this.camA || 0, psi = wrapPi(it.a + r.rot - c);
    return c + psi + this.warpE(r) * Math.sin(psi) - r.rot;
  }
  stretch(r, it) { return it && it.ring === r ? 1 + this.warpE(r) * Math.cos(it.a + r.rot - (this.camA || 0)) : 1; }
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
    // its place on its ring: its even slot warped toward the front, wider gaps there and tighter at the back
    it.aw = this.warp(it);
    it.holder.position.x = Math.sin(it.aw) * it.r; it.holder.position.z = Math.cos(it.aw) * it.r;
    // nearer the camera bigger, farther smaller, beyond the perspective: by its depth along the level line to the camera
    const P = this.world.worldToLocal(it.holder.getWorldPosition(this._sv || (this._sv = new THREE.Vector3())));
    it.depthF = clamp(1 + DEPTH_K * (P.x * this._cd.x + P.z * this._cd.y), DEPTH_MIN, DEPTH_MAX);
    it.inner.scale.setScalar(Math.max(1e-4, scale * (1 + 0.16 * it.pick) * it.depthF));
    it.u.uFlash.value = flash; it.u.uAlpha.value = alpha;
    const tr = alpha < 1; if (it.mat.transparent !== tr) { it.mat.transparent = tr; it.mat.depthWrite = !tr; it.mat.needsUpdate = true; }
    it.beam.visible = beam > 0.002; it.bu.uA.value = beam;
    it.su.uA.value = SHADOW[it.kind === 'air' ? 1 : 0] * Math.min(1, scale) * alpha;
    { // the shadow on its ring's own plane, cast away from the light by the body's height, turned with it
      const sh = it.shadow, up = it.kind === 'air' ? P.y - it.ring.y : it.h * 0.45 * it.depthF;
      sh.position.set(P.x - SUN.x / SUN.y * up, it.ring.y + 0.004, P.z - SUN.z / SUN.y * up);
      sh.rotation.y = it.ring.group.rotation.y + it.holder.rotation.y; sh.visible = it.su.uA.value > 0.003;
      sh.scale.set(it.shS[0] * it.depthF, 1, it.shS[1] * it.depthF);
    }
    // facing: along the ring's turn; the chosen one partly toward the camera (outward at the front)
    const dir = it.ring.spin >= 0 ? 1 : -1, path = it.aw + dir * Math.PI / 2;
    it.holder.rotation.y = path + wrapPi(it.aw - path) * FACE_TURN * it.pick;
    if (it.kind === 'air') {
      it.holder.position.y = it.h * it.depthF * 1.15 + 0.03 + Math.sin(this.time * 0.8 + it.phase) * 0.02;   // just over its plane
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
      const k = (1 + 0.16 * (it.pick || 0)) * (it.depthF || 1);
      P = it.holder.getWorldPosition(this._v); size = it.size * k; h = it.kind === 'air' ? 0 : it.h * k;
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
    if (!this.shown) return null;
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
  // The pointer turns the ring under it (title.js): grab(code) holds that animal's ring (null for the spirit), turn(ring,
  // px) moves its front by that many pixels across, letGo(ring, px/s) frees it with the fling, easing back to its own turn
  grab(code) {
    const r = this.items.get(code)?.ring; if (!r) return null;
    r.drag = true; r.target = null; r.vel = 0; r.held = this.items.get(code);
    return r;
  }
  turn(r, px) { if (r) r.rot += px / Math.max(1, r.R * this.ppu * this.stretch(r, r.held)); }   // kept under the pointer as the warp moves it there
  letGo(r, pxs = 0) {
    if (!r || !r.drag) return;
    r.drag = false; r.vel = this.reduced ? 0 : clamp(pxs / Math.max(1, r.R * this.ppu), -2.5, 2.5);
    if (r.spinAt == null) r.spinAt = this.time;
  }

  dispose() {
    this.gen++;
    for (const it of [...this.items.values(), ...this.leaving()]) this.free(it);
    this.items.clear(); this.gone = [];
    this.wisp.dispose();
    this.halo.mesh.material.dispose();
    this.beamGeo.dispose(); this.discGeo.dispose(); this.haloGeo.dispose(); this.trackGeo.dispose();
    for (const r of this.rings) r.track.material.dispose();
    this.scene.clear();
    this.marksEl?.remove(); this.nameEl?.remove();
    this.renderer = null;
  }
}
