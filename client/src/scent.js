import * as THREE from 'three';
import { rarityColor } from './animals.js';
import { windUniforms, scentCarry } from './wind.js';
import { bodyScale, onBodyScale } from './bodyScale.js';
import { GROUND } from './groundControl.js';
import { FLIERS } from './flierControl.js';

// The smell sense (owner, 2026-10-28: "Animals should have the ability to smell each other. When an animal smells
// another animal a little whisp of color of that animal's rarity color appears pointing in the direction of the animal.
// Picture a horizontal plane at eye level with the animal's head. Picture a circle about 3' around for a deer's head,
// the whisp would point in the direction of the smell along that plane.")
//
// The sources: every live AI animal is one (animals.js scentSources: the species the body's perception does not
// perceive at all are not smelled either, and the body's own species is: the herd), and every carcass (animals.js kill:
// carrion) until it goes, which a scavenger's nose (games.json relations.scavenge: the coyote, the bear, the raven, the
// vulture) is drawn to from SCAV_K times as far and more strongly. The body's reach (REACH, m, by species code, with a
// fallback by rig) is how far it smells a source straight upwind: the bear 400, the coyote 300, the fox and the deer
// 200, the lion 150 (a cat hunts by eye), the rabbits 100, the squirrels 40, the vole 20, the turkey and the quails 15,
// the lizard 5; the raven and the hawk nothing (birds smell little), the turkey vulture nothing alive but carrion from
// CARRION_REACH (the one bird here that finds its food by smell); the spirit smells nothing. Each source's own scent is
// SOURCE times as strong (the musky canids and the bear more, a vole, a lizard or a bird less).
//
// The wind (wind.js windUniforms: windDir the way the measured wind blows, windStrength its strength; weather.js sets
// them each frame) shapes the reach: a source the wind blows from (upwind of the body) carries at the full reach,
// crosswind at about half, downwind at a fifth, and in a weak wind the shape gives way to still air (the scent pools)
// (wind.js scentCarry, which every animal's nose shares since 2026-10-29: animals.js noticeAt). A scent's strength
// falls from 1 at the body to 0 at that reach (S_POW). The query walks animals.list every QUERY_T s, not every frame,
// and keeps the strongest MAX_WISPS: `smelled` is that list, strongest first, as { animal, strength, bearing, carrion }
// (bearing from the body's heading, radians, 0 ahead and positive to the right: clockwise seen from above).
//
// The wisps: the circle round the head, in the horizontal plane at the head's height (groundControl S.shoulder times
// HEAD_UP by rig, lowered when the body beds down and raised when it sits up; a landed flier's head over its feet, a
// flier in the air its body), of radius RING_R m for the deer (0.9 m: about three feet) times bodyScale.v (a lizard's ring
// is a couple of centimetres, right for its camera; a flier's by its wingspan), centred on the head (S.half ahead of the body's origin), so it turns
// and moves with the body. Each smelled source puts a wisp on that ring at the source's bearing, pointing outward along
// it: a strand of MOTES soft glowing points flowing inward from its tip (the scent coming in on the air) and swaying,
// tapered (thick at the ring, a fine point toward the source), in the species' rarity colour (animals.js rarityColor,
// the spirit's souls' colours), WISP_LEN m long for the deer (20-40 cm, scaled with the ring) and brighter for a stronger
// scent; a faint one is a few flickering motes. A carcass's wisp is dimmer and heavier: bigger motes, slower, sagging.
// The strands drift and flicker on a time-based hash of each animal's id (no Math.random: two viewers in one body see
// the same), fade in and out over FADE s as scents come and go, and follow their source between queries. One draw
// (THREE.Points, MAX_WISPS x MOTES points, positions written each frame), no depth test or write and drawn late
// (renderOrder) so the head never hides its own wisps; no texture (the mote's shape is a falloff in the shader). The
// blend adds the mote's light and dims what is under it a little (premultiplied over, alpha at most 0.65), so a
// yellow-green or violet wisp keeps its hue on sunlit ground instead of washing out to white as a purely additive one did.
//
// main.js builds it after the hunt, calls update(dt) in a walker or a flier (with needs and the hunt) and in the gray
// squirrel's own control (squirrelControl.js, 2026-10-29: its head is a rodent's, SQ_SHOULDER over its feet, sitting
// up on shift, on the trunk or a limb at the body), and dispose() in disposeWorld. When update is not called (the
// spirit, the raven, the woodpecker, a menu) the wisps
// go dark at the next draw (onBeforeRender: the observer is no longer the body that smelled, or the update is more than
// STALE_MS old) and start from nothing when it is called again; `smelled` is empty meanwhile.

// m: the reach upwind, by species code (the body's)
const REACH = {
  ursus_americanus: 400, canis_latrans: 300, urocyon_cinereoargenteus: 200, odocoileus_hemionus: 200, puma_concolor: 150,
  lepus_californicus: 100, sylvilagus_bachmani: 100, otospermophilus_beecheyi: 40, sciurus_griseus: 40, microtus_californicus: 20,
  meleagris_gallopavo: 15, callipepla_californica: 15, oreortyx_pictus: 15, sceloporus_occidentalis: 5,
  corvus_corax: 0, buteo_jamaicensis: 0, cathartes_aura: 0, aphelocoma_californica: 0, cyanocitta_stelleri: 0, melanerpes_formicivorus: 0,
  spirit: 0,
};
const RIG_REACH = { quad: 200, rodent: 40, bird: 15, lizard: 5 };      // a walker not in REACH, by groundControl rig; a flier 0
const CARRION_REACH = { cathartes_aura: 800 };                          // m: carrion only (the vulture's nose)
const SCAV_K = 1.5, SCAV_S = 1.35;                                      // a scavenger smells carrion SCAV_K times as far, SCAV_S as strong
// each source's own scent (times the reach); 1 if not named
const SOURCE = {
  ursus_americanus: 1.2, canis_latrans: 1.15, urocyon_cinereoargenteus: 1.1, puma_concolor: 1, odocoileus_hemionus: 1,
  microtus_californicus: 0.6, sceloporus_occidentalis: 0.4, sciurus_griseus: 0.8, otospermophilus_beecheyi: 0.8,
  callipepla_californica: 0.6, oreortyx_pictus: 0.6, meleagris_gallopavo: 0.8, corvus_corax: 0.6, buteo_jamaicensis: 0.5,
  cathartes_aura: 0.7, aphelocoma_californica: 0.5, cyanocitta_stelleri: 0.5, melanerpes_formicivorus: 0.5,
};
const S_POW = 1.4;   // the wind's shaping of the reach: wind.js scentCarry
const QUERY_T = 0.25, MAX_WISPS = 6, FADE = 0.5;
// the ring and the strands (m, for the deer; times the body's scale)
const RING_R = 0.9, WISP_LEN = [0.2, 0.4], MOTES = 20, MOTE_R = 0.065;   // 2026-10-28: half again as big as first built, so a wisp reads from the chase camera
const HEAD_UP = { quad: 1.25, rodent: 1.1, bird: 1.4, lizard: 1.2 };   // the head's height over the shoulder's, by rig
const SQ_SHOULDER = 0.1, SQ_HALF = 0.12;                                // m: the gray squirrel's own control (no GROUND entry): shoulder height, half its body length
const STALE_MS = 1000;                                                 // update older than this at a draw: the wisps are dark
// a legibility floor (2026-10-29): a strand shorter than LEN_PX px on screen (the squirrel's 2.7 cm ring strand from its
// chase camera 2.6 m off was 10 px, a smudge) is drawn longer, with its motes bigger, by up to GROW_MAX; the ring itself keeps its size
const LEN_PX = 36, GROW_MAX = 6;
const NONE = Object.freeze([]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const VERT = /* glsl */`
  attribute float aSize; attribute vec3 aCol;
  uniform float uScale, uOn;
  varying vec3 vCol;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(-mv.z, 0.01), px = aSize * uScale / d;
    vCol = aCol * uOn * min(1.0, px / 2.0);   // a mote under 2 px dims rather than shrinks
    gl_PointSize = clamp(px, 3.0, 96.0);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */`
  varying vec3 vCol;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-r * r * 3.5) * (1.0 - smoothstep(0.75, 1.0, r));
    float m = max(vCol.r, max(vCol.g, vCol.b));
    gl_FragColor = vec4(vCol * a, a * min(1.0, m) * 0.65);   // light added, and the ground under it dimmed a little: the hue holds on bright ground
  }`;

function hashStr(s) {   // FNV-1a over an animal's id, to 0..1
  let h = 2166136261; const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
const h11 = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export class Scent {
  constructor({ tile, animals, flight, ground, flier, scene, camera, squirrel = null }) {
    Object.assign(this, { tile, animals, flight, ground, flier, scene, camera, squirrel });
    this.wind = windUniforms;   // debugging: the uniforms the query reads
    this._smelled = []; this.code = null; this.reach = 0; this.carrionReach = 0; this.scav = false;
    this.t = 0; this.qT = 0; this.lastT = -1e9; this.ms = 0;
    this.head = new THREE.Vector3(); this.headY = null; this.scale = bodyScale.v;
    this.slots = Array.from({ length: MAX_WISPS }, () => ({ a: null, id: null, s: 0, sv: 0, k: 0, carrion: false, alpha: 0, want: 0,
      ux: 1, uz: 0, seed: 0, col: new THREE.Color() }));
    const N = MAX_WISPS * MOTES;
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.size = new Float32Array(N);
    const g = new THREE.BufferGeometry(), dyn = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(this.pos, 3)); g.setAttribute('aCol', dyn(this.col, 3)); g.setAttribute('aSize', dyn(this.size, 1));
    this.mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 800 }, uOn: { value: 0 } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 30; this.points.name = 'scent wisps';
    this.points.visible = false;
    this.points.onBeforeRender = () => { if (this.stale()) this.mat.uniforms.uOn.value = 0; };
    scene.add(this.points);
    this._b = new THREE.Vector2();
    this.unhook = onBodyScale(v => { this.scale = v; this.headY = null; });
  }
  // The strongest scents now (see the header); empty while update is not being called (no body that smells).
  get smelled() { return this.stale() ? NONE : this._smelled; }
  // No body that smells now: the update has not run for STALE_MS, or the body has changed since it last did.
  stale() { return performance.now() - this.lastT > STALE_MS || this.animals.observer !== this.code; }
  // The body's reach (m) for live animals and for carrion, and whether it scavenges.
  setSpecies(code) {
    this.code = code;
    const rig = GROUND[code]?.rig;
    this.reach = code in REACH ? REACH[code] : rig ? RIG_REACH[rig] ?? 0 : 0;
    this.scav = !!this.animals.scavenges?.(code);
    this.carrionReach = CARRION_REACH[code] ?? this.reach * (this.scav ? SCAV_K : 1);
    this.clear();
  }
  clear() { for (const s of this.slots) { s.a = null; s.id = null; s.alpha = 0; s.want = 0; s.sv = 0; } this._smelled = []; this.qT = 0; this.headY = null; }

  // The head: where the ring is centred (see the header). Writes this.head; returns the ring's radius.
  placeHead(dt) {
    const f = this.flight, P = f.pos, G = this.ground, Q = this.squirrel, yaw = f.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let y, ahead, R;
    if (Q?.on) {   // the gray squirrel's own control: a rodent's head over its feet on the ground (sitting up on shift), at the body on wood or in the air
      const onGround = Q.mode === 'ground', up = onGround ? 1 + 0.45 * (Q.sit || 0) : 0.5;
      y = P.y + SQ_SHOULDER * HEAD_UP.rodent * up;
      ahead = onGround ? SQ_HALF * 0.7 : 0;
      R = RING_R * this.scale;
    } else if (G?.on && G.S) {
      const S = G.S, k = HEAD_UP[S.rig] ?? 1.2, sit = G.sit || 0;
      const up = S.rig === 'rodent' ? 1 + 0.45 * sit : 1 + 0.1 * sit;   // a rodent sits up on its haunches; a quadruped's head lifts
      y = P.y + S.shoulder * k * up * (G.resting ? 0.55 : 1);
      ahead = (S.half || 0) * (S.rig === 'quad' ? 1 : 0.7) * (G.size || 1);
      R = RING_R * this.scale;
    } else {
      const span = FLIERS[this.code]?.span ?? 1;
      y = f.landed ? (f.gnd?.feet ?? P.y) + span * 0.3 : P.y;
      ahead = f.landed ? span * 0.12 : span * 0.1;
      R = RING_R * clamp(span / 1.8, 0.2, 1);
    }
    this.headY = this.headY === null ? y : y + (this.headY - y) * Math.exp(-dt * 10);   // the head's height eased (a bound, a jump)
    this.head.set(P.x + fx * ahead, this.headY, P.z + fz * ahead);
    return R;
  }

  // The strength (0..1) of one source at the head now, by the header's formula: 0 beyond its reach, and 0 while no body
  // smells. hunt.js asks for its prey (which may be beyond the MAX_WISPS strongest that `smelled` keeps).
  smell(a) {
    if (this.stale() || !a || a.gone || a.sp === undefined) return 0;
    return this.strengthOf(a, a.sp, !!a.dead, this.animals.scentHeight(a));
  }
  strengthOf(a, k, carrion, y) {
    const code = this.animals.speciesList()[k].code, H = this.head;
    const base = carrion ? this.carrionReach : this.reach * (SOURCE[code] ?? 1); if (base <= 0) return 0;
    const dx = H.x - a.x, dz = H.z - a.z, d = Math.hypot(dx, dz, (H.y - y) * 0.5);
    const R = base * scentCarry(dx, dz); if (d >= R) return 0;
    let s = (1 - d / R) ** S_POW; if (carrion && this.scav) s = Math.min(1, s * SCAV_S);
    return s;
  }

  // The strongest MAX_WISPS scents at the head now (see the header): this.smelled, and the slots they fill.
  query() {
    const A = this.animals, H = this.head, smelled = [];
    const reachMax = Math.max(this.reach * 1.25, this.carrionReach * 1.25);   // the strongest source's reach (SOURCE up to 1.2)
    if (reachMax > 0) {
      A.scentSources(H.x, H.z, reachMax, (a, k, carrion, y) => {
        const s = this.strengthOf(a, k, carrion, y); if (s <= 0) return;
        smelled.push({ animal: a, strength: s, bearing: 0, carrion, k });
      });
      smelled.sort((p, q) => q.strength - p.strength);
      if (smelled.length > MAX_WISPS) smelled.length = MAX_WISPS;
    }
    // the slots: a source still smelled keeps its slot; a lost one fades; a new one takes a slot that is dark or fading
    const S = this.slots, keep = new Set(smelled.map(e => e.animal));
    for (const s of S) if (s.a && !keep.has(s.a)) s.want = 0;
    for (const e of smelled) {
      let s = S.find(q => q.a === e.animal);
      if (!s) {
        s = S.find(q => !q.a) || S.filter(q => q.want === 0).sort((p, q) => p.alpha - q.alpha)[0];
        if (!s) continue;
        s.a = e.animal; s.id = e.animal.id; s.alpha = 0; s.sv = e.strength; s.seed = hashStr(e.animal.id);
        const dx = e.animal.x - this.head.x, dz = e.animal.z - this.head.z, l = Math.hypot(dx, dz) || 1; s.ux = dx / l; s.uz = dz / l;
      }
      s.want = 1; s.s = e.strength; s.k = e.k; s.carrion = e.carrion;
      rarityColor(this.animals.rarity[e.k], s.col);
    }
    const yaw = this.flight.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const e of smelled) {
      const dx = e.animal.x - this.head.x, dz = e.animal.z - this.head.z;
      e.bearing = Math.atan2(dz * fx - dx * fz, dx * fx + dz * fz);   // clockwise seen from above: facing north (-z), east (+x) is +pi/2
      delete e.k;
    }
    this._smelled = smelled;
  }

  update(dt) {
    const t0 = performance.now();
    if (t0 - this.lastT > STALE_MS) this.clear();   // back in a body after a gap: start from nothing
    this.lastT = t0; this.t += dt;
    if (typeof window !== 'undefined' && window.__we && window.__we.scent !== this) window.__we.scent = this;   // debugging
    const code = this.animals.observer;
    if (code !== this.code) this.setSpecies(code);
    const R = this.placeHead(dt), H = this.head;
    this.qT -= dt;
    if (this.qT <= 0) { this.qT = QUERY_T; this.query(); }
    // the lens: the drawing buffer's height over the view's height at 1 m (as the spirit's mist)
    const cam = this.camera, rr = typeof window !== 'undefined' ? window.__we?.renderer : null;
    const bh = rr ? rr.getDrawingBufferSize(this._b).y : (typeof window !== 'undefined' ? window.innerHeight * (window.devicePixelRatio || 1) : 800);
    const uScale = this.mat.uniforms.uScale.value = bh / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov || 60) / 2));
    this.mat.uniforms.uOn.value = 1;
    const camD = Math.max(cam.position.distanceTo(H), 0.05);   // the head's distance from the camera, for the legibility floor
    const A = this.animals, t = this.t, pos = this.pos, col = this.col, size = this.size;
    let any = false;
    for (let i = 0; i < MAX_WISPS; i++) {
      const s = this.slots[i], o = i * MOTES;
      if (s.a && (s.a.gone || (!s.a.dead && !A.alive(s.a)))) s.want = 0;   // eaten, buried or rebuilt away
      s.alpha = s.want ? Math.min(1, s.alpha + dt / FADE) : Math.max(0, s.alpha - dt / FADE);
      if (s.a && !s.want && s.alpha <= 0) s.a = s.id = null;
      if (!s.a || s.alpha <= 0) { col.fill(0, o * 3, (o + MOTES) * 3); size.fill(0, o, o + MOTES); continue; }
      any = true;
      s.sv += (s.s - s.sv) * (1 - Math.exp(-dt * 4));
      // the bearing follows the source between queries, eased so a near one does not swing
      const dx = s.a.x - H.x, dz = s.a.z - H.z, l = Math.hypot(dx, dz);
      if (l > 1e-3) { const u = 1 - Math.exp(-dt * 6); s.ux += (dx / l - s.ux) * u; s.uz += (dz / l - s.uz) * u; const n = Math.hypot(s.ux, s.uz) || 1; s.ux /= n; s.uz /= n; }
      const sd = s.seed * 97, sw = 0.06 * Math.sin(t * 0.7 + sd) + 0.03 * Math.sin(t * 1.9 + sd * 1.7);   // the whole strand's slow sway (rad)
      const cs = Math.cos(sw), sn = Math.sin(sw), ux = s.ux * cs - s.uz * sn, uz = s.ux * sn + s.uz * cs, tx = -uz, tz = ux;
      const st = s.sv, heavy = s.carrion ? 1 : 0;
      const len0 = R * (WISP_LEN[0] + (WISP_LEN[1] - WISP_LEN[0]) * st) / RING_R * (1 + 0.3 * heavy);
      const grow = clamp(LEN_PX * camD / (len0 * uScale), 1, GROW_MAX), len = len0 * grow;   // the legibility floor (see LEN_PX)
      const flow = (0.55 + 0.5 * st) * (heavy ? 0.45 : 1), lum = (0.35 + 1.15 * st) * (heavy ? 0.6 : 1) * s.alpha;
      const c = s.col, ms = R / RING_R * grow;
      for (let j = 0; j < MOTES; j++) {
        const q = o + j, hj = h11(j + sd);
        // shown: all for a strong scent, fewer and flickering for a faint one
        const on = hj < 0.3 + 1.4 * st ? 1 : 0;
        const p = ((j / MOTES + t * flow + s.seed) % 1 + 1) % 1;   // 0 at the tip, 1 at the ring: the scent coming in
        const along = R + len * (1 - p), lat = len * (0.16 * Math.sin(t * 1.7 + sd + p * 4.0) + 0.06 * Math.sin(t * 4.3 + j)) * (0.4 + 0.6 * (1 - p));
        const vy = len * (0.1 * Math.sin(t * 2.3 + sd * 1.3 + p * 5.0)) - heavy * len * 0.35 * (1 - p) * (1 - p);
        pos[q * 3] = H.x + ux * along + tx * lat; pos[q * 3 + 1] = H.y + vy; pos[q * 3 + 2] = H.z + uz * along + tz * lat;
        const taper = 0.35 + 0.65 * p;   // thick at the ring, a fine point toward the source
        size[q] = MOTE_R * ms * taper * (0.75 + 0.35 * st) * (1 + 0.5 * heavy) * 2;
        const env = Math.sin(Math.PI * p), fl = st > 0.35 ? 0.8 + 0.2 * Math.sin(t * 11 + j * 2.1 + sd) : Math.max(0, Math.sin(t * (5 + 7 * hj) + j * 2.7 + sd)) ** 2;
        const f = on * env * fl * lum * 1.8;
        col[q * 3] = c.r * f; col[q * 3 + 1] = c.g * f; col[q * 3 + 2] = c.b * f;
      }
    }
    this.points.visible = any;
    const ga = this.points.geometry.attributes; ga.position.needsUpdate = ga.aCol.needsUpdate = ga.aSize.needsUpdate = true;
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  // Everything released: off the scene, the geometry and material freed, the body-scale listener unhooked.
  dispose() {
    this.unhook?.(); this.unhook = null;
    this.points.removeFromParent(); this.points.geometry.dispose(); this.mat.dispose();
    this._smelled = []; for (const s of this.slots) s.a = null;
    if (typeof window !== 'undefined' && window.__we?.scent === this) delete window.__we.scent;
  }
}
