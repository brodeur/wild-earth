import * as THREE from 'three';
import { uniforms as atmo } from './atmosphere.js';
import { scentCarry } from './wind.js';

// Scavenge (Aaron, 2026-11-02: "New game: Scavenge. When an animal dies, it begins to decompose over the course of 1
// day. It emits a smell 'dead animal' and appears to glow from an appropriate distance for carrion eaters."). The
// carcass model: every killed animal (animals.js kill, the catch: docs/movement.md) becomes a record here that lasts a
// real day (LIFE_H by the body's mass: a deer 24 h, a jackrabbit 12 h, a vole or a lizard 6 h) through stages drawn on
// the body as it fell, and then as a few pale bones that fade.
//
// The stages are one number, `decay` (0 fresh to 1 gone), from the carcass's age on the shared clock, hastened by the
// heat (SEASON_HEAT: summer half again as fast as spring, winter two thirds; the afternoon faster than the night,
// DIURNAL) and by feeding (every bite taken from the `meat` store, the body's mass in kg, advances it by EAT_K of the
// share eaten; an emptied store is bones at once). STAGES names the bands: fresh (as it fell, the catch's pose), bloated
// (the trunk swollen and slack), opened (the upper flank dark where the scavengers have fed), dried (the hide sunk over
// the bones, the colour gone grey-brown), bones (the body gone, BONES_D on: a small instanced mesh of pale shapes in the
// grass, fading to nothing at 1). The body is the dead animal's own instance in its species' mesh (animals.js: the
// bedded pose, on its side), which reads the stage from a spare per-instance channel: the gait phase aAnim.x is free
// once the fall is over (the gait's amplitude is 0), so a dead body writes -(1 + decay) there and the species' shaders
// (animalModels.js DECAY_*) bloat, sink and recolour from it: no new attribute (Metal's sixteen slots), no texture unit,
// no second draw. The bones (BONES_CAP instances) and the glow halos (HALO_CAP) are one small instanced draw each.
//
// The smell. A carcass is a scent source for scent.js as before (animals.js scentSources, carrion true), labelled
// "dead animal" until the sniffer is close enough to know the species, with a reach that grows with the stage
// (smellK: a fresh kill at half the species' carrion reach, bloated a third more, dried half, bones a fifth), shaped by
// the wind (wind.js scentCarry) as every scent is: a coyote's nose (300 m, times 1.5 for a scavenger) finds a fresh deer
// from about 250 m downwind and a bloated one from 600; the vulture's carrion nose (800 m) a bloated one from a
// kilometre. The glow. For a carrion eater (games.json relations.scavenge: the raven, the vulture, the coyote, the bear;
// and the lion for its own kills) a carcass glows as forage.js lights a forager's plants: a pool of warm light on the
// ground under it within SEE_R m of the body (the vulture 3 km from the air, the raven 400 m, the coyote 150, the bear
// 120, the lion 60), brighter with hunger (needs.js) and with the stage's smell, falling with distance, sized to stay a
// few pixels wide from far (a beacon the vulture steers by). The stage is named on the needs panel (needs.js
// carrionHint: "a deer, two hours dead · hold E") and, for a hunter, on the hunt panel when it has no prey.
//
// Feeding. The player's feed (E for the walkers, the raven's stabs, the vulture on contact: animals.js playerFeed) and
// the AI's (aiFeed, aiFeedTick) each draw BITE kg of the species from the store and fill the belly by that share of
// NEED (a coyote's 1.5 kg is a full belly; a raven's stab burst a tenth of a kilo, a full belly too). The AI scavengers
// come by what they would notice (aiNear: the vulture from the air within 1.5 km once the kill smells, the raven by
// sight within 400 m, the coyote by its nose downwind and mostly at dusk and night, the bear by its nose), feed in turns
// with a pecking order (yields: a canid, a bear or a lion feeding displaces the birds; a bear or a lion the coyote) and
// leave when full (one bite is a belly: animals.js fedAt).
//
// Sharing. A carcass is state of the tile: born of a kill, an event on the shared world's dig channel (dig.js DigNet,
// server.py GameWorld: `cev` messages numbered by cseq, carrionworld.py the server's copy of these rules, the snapshot's
// `carrion`), its stage from its birth on the server's clock, its meat drawn down by feed events, removed at 1 by the
// server's sweep (`gone`). Every player sees the same carcass at the same stage and a reload keeps it; a kill elsewhere
// kills the same animal here (the AI is not shared yet: the id names the animal). Alone (no server, ?net=0) it is this
// browser's, in memory. Debugging: __we.carrion; carrion.age(h) moves this page's clock h hours on (off: 0; the shared
// stage is the server's, so another page is not moved); carrion.list, carrion.describe().
const LIFE_H = { large: 24, mid: 12, small: 6 };   // hours: by mass (large over 5 kg, mid over 0.5, small)
const MASS = { deer: 55, buck: 75, jackrabbit: 2.5, 'brush rabbit': 0.8, vole: 0.05, 'fence lizard': 0.012 };   // kg, by the species' one-word name (animals.js SPECIES one)
const LEN = { deer: 1.5, buck: 1.6, jackrabbit: 0.55, 'brush rabbit': 0.35, vole: 0.14, 'fence lizard': 0.18 };   // m: the body's length (the bones' scale)
export const STAGES = [['fresh', 0.1], ['bloated', 0.35], ['opened', 0.6], ['dried', 0.85], ['bones', 1.0]];
export const BONES_D = 0.85, EAT_K = 0.45;
export const SEASON_HEAT = { winter: 0.65, spring: 1, summer: 1.45, fall: 1 };
const DIURNAL = 0.25, DIURNAL_PEAK = 14, TILE_UTC = -8;   // the day's swing of the decay rate; its peak hour (local); the tiles' zone (Pacific standard)
const BITE = { cathartes_aura: 0.4, corvus_corax: 0.12, canis_latrans: 1.5, ursus_americanus: 4, puma_concolor: 4, urocyon_cinereoargenteus: 0.3 };   // kg a feed draws
const NEED = { cathartes_aura: 0.4, corvus_corax: 0.1, canis_latrans: 1.5, ursus_americanus: 6, puma_concolor: 4, urocyon_cinereoargenteus: 0.3 };    // kg: a full belly
const SMELL_K = [[0, 0.5], [0.1, 0.8], [0.25, 1.3], [0.5, 1.2], [0.7, 0.6], [0.9, 0.2], [1, 0.1]];   // the scent's reach by decay (times the species' carrion reach)
const NAME_S = 0.45;   // a carrion scent this strong names the species; weaker is "dead animal"
const SEE_R = { cathartes_aura: 3000, corvus_corax: 400, canis_latrans: 150, ursus_americanus: 120, puma_concolor: 60, urocyon_cinereoargenteus: 60 };
const AI_R = { cathartes_aura: 1500, corvus_corax: 400, canis_latrans: 450, ursus_americanus: 600 };   // the AI's finding: the birds by sight (the vulture also by smell), the mammals by the nose
const GLOW_COL = new THREE.Color(1.0, 0.5, 0.22);   // a warm carrion glow (linear)
const GAIN_FED = 0.3, HUNGER_POW = 0.7, PULSE_HZ = 0.4, PULSE = 0.15;
const HALO_CAP = 32, BONES_CAP = 48, HALO_T = 0.1, STAGE_T = 0.5;
const REACH = 3.2, LIVE_R = 450, FEED_GAP = { walk: 2.2, bird: 3 };   // m the hint names a carcass at hand; m a carcass gets a body; s between the player's bites
const BIG = new Set(['canis_latrans', 'ursus_americanus', 'puma_concolor', 'urocyon_cinereoargenteus']), HUGE = new Set(['ursus_americanus', 'puma_concolor']);
const BIRDS = new Set(['corvus_corax', 'cathartes_aura']);
const TAU = Math.PI * 2, DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const clamp01 = v => Math.min(1, Math.max(0, v));

// The decay (0..1) of a carcass record at wall-clock time `now` (s) in `season`: the header's rule; carrionworld.py
// decay_of is the same arithmetic, so the server's sweep and every client agree.
// The heat's day: the rate is (season) x (1 + DIURNAL cos(2 pi (hour - DIURNAL_PEAK) / 24)), integrated from the birth
// to now (the sine's difference), so a day's decay is the season's whatever the hour of the kill.
export function decayOf(rec, now, season) {
  const age = Math.max(0, now - rec.born), w = TAU / 86400, ph = t => (t + (TILE_UTC - DIURNAL_PEAK) * 3600) * w;
  const warm = age + DIURNAL * (Math.sin(ph(rec.born + age)) - Math.sin(ph(rec.born))) / w;
  let d = (SEASON_HEAT[season] ?? 1) * warm / (rec.lifeH * 3600) + EAT_K * (rec.meat0 > 0 ? rec.eaten / rec.meat0 : 1);
  if (rec.meat <= 1e-6) d = Math.max(d, BONES_D);
  return Math.min(1, d);
}
export const lifeOf = mass => mass > 5 ? LIFE_H.large : mass > 0.5 ? LIFE_H.mid : LIFE_H.small;
export const stageOf = d => { for (const [name, hi] of STAGES) if (d < hi) return name; return 'gone'; };
export function smellK(d) {
  for (let i = 1; i < SMELL_K.length; i++) if (d <= SMELL_K[i][0]) { const [a, ka] = SMELL_K[i - 1], [b, kb] = SMELL_K[i]; return ka + (kb - ka) * (d - a) / (b - a); }
  return SMELL_K[SMELL_K.length - 1][1];
}
// "two hours dead", "forty minutes dead", "a day dead"
export function agePhrase(s) {
  const m = s / 60, h = m / 60;
  if (m < 2) return 'just killed';
  if (m < 55) return `${Math.round(m / 5) * 5} minutes dead`;
  if (h < 1.5) return 'an hour dead';
  if (h < 12.5) return `${WORDS[Math.round(h)]} hours dead`;
  if (h < 30) return 'a day dead';
  return `${WORDS[Math.min(12, Math.round(h / 24))] || Math.round(h / 24)} days dead`;
}

const HALO_VERT = /* glsl */`
  attribute vec4 iPos; attribute float iGain;
  varying vec2 vQ; varying float vA;
  void main() {
    if (iGain < 0.01) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    vA = iGain; vQ = position.xy;
    vec3 p = iPos.xyz + vec3(position.x, 0.0, position.y) * iPos.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const HALO_FRAG = /* glsl */`
  uniform vec3 glowCol; uniform vec3 sunLight; uniform vec3 ambientSky;
  varying vec2 vQ; varying float vA;
  void main() {
    float r = length(vQ);
    float a = exp(-r * r * 2.6) * (1.0 - smoothstep(0.75, 1.0, r)) * vA;
    float ref = dot(sunLight * 0.5 + ambientSky * 1.5, vec3(0.3333)) * 0.3183099;   // the glow keeps its place against the light of the hour
    gl_FragColor = vec4(glowCol * a * ref * 0.3, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const BONES_VERT = /* glsl */`
  attribute vec4 iPos; attribute vec2 iRot;   // x y z, the scale; cos and sin of the yaw, and the fade in length? no: iRot = (yaw, fade)
  varying vec3 vN; varying float vFade; varying vec3 vP;
  void main() {
    if (iRot.y < 0.01) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    float c = cos(iRot.x), s = sin(iRot.x);
    mat3 R = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
    vec3 p = iPos.xyz + R * (position * iPos.w);
    vN = R * normal; vFade = iRot.y; vP = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const BONES_FRAG = /* glsl */`
  uniform vec3 sunDir; uniform vec3 sunLight; uniform vec3 ambientSky;
  varying vec3 vN; varying float vFade; varying vec3 vP;
  void main() {
    vec3 n = normalize(vN);
    float lit = max(dot(n, sunDir), 0.0);
    vec3 col = vec3(0.55, 0.52, 0.45) * (sunLight * lit * 0.6 + ambientSky * (0.5 + 0.3 * n.y)) * 0.3183099;   // a bleached bone, lit as the Lambert ground is (1/pi)
    gl_FragColor = vec4(col, vFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The bones: a skull, the spine, the pelvis, an arch of ribs and four long bones, lying in the body's frame (z forward,
// the unit the body's length), as one geometry of boxes.
function bonesGeometry() {
  const pos = [], nor = [], idx = [];
  const box = (sx, sy, sz, x, y, z, ry = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(sx, sy, sz); g.rotateZ(rz); g.rotateY(ry); g.translate(x, y, z);
    const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array, base = pos.length / 3;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
    for (let i = 0; i < ix.length; i++) idx.push(base + ix[i]);
    g.dispose();
  };
  box(0.11, 0.07, 0.17, 0.02, 0.035, 0.42, 0.25);                 // the skull
  box(0.05, 0.03, 0.06, 0.07, 0.015, 0.5, 0.25);                   // the muzzle
  box(0.025, 0.025, 0.72, 0, 0.012, 0.0);                          // the spine
  box(0.12, 0.05, 0.08, 0.01, 0.025, -0.33);                        // the pelvis
  for (let i = 0; i < 6; i++) {   // the ribs: an arch of short bars over the ground, from the spine out to the side
    const z = 0.22 - i * 0.07, r = 0.1 + 0.01 * (i === 0 || i === 5 ? -1 : 1);
    for (let k = 0; k < 5; k++) { const a0 = Math.PI * (k + 0.5) / 5, x = r * (1 - Math.cos(a0)), y = r * Math.sin(a0) * 0.9; box(0.018, 0.018, 0.034 * r / 0.1, x, y, z, 0, Math.PI / 2 - a0); }
  }
  box(0.018, 0.018, 0.2, 0.17, 0.009, 0.3, 0.9);                   // the long bones, scattered
  box(0.016, 0.016, 0.18, -0.14, 0.008, 0.25, -1.3);
  box(0.02, 0.02, 0.22, 0.2, 0.01, -0.2, 0.4);
  box(0.016, 0.016, 0.17, -0.16, 0.008, -0.3, 2.3);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  return g;
}

export class Carrion {
  // animals: animals.js (its carrion hooks: spawnCarcass, bury, alive, playerFeed); dig: dig.js (its DigNet carries the
  // shared events); season(): the world's season; hour(): the page's hour (the AI's dusk); needs, scent, ground, flier,
  // flight: the player's body and senses
  constructor({ tile, animals, scene, flight, ground, flier, needs, dig = null, season, hour = () => 12 }) {
    Object.assign(this, { tile, animals, scene, flight, ground, flier, needs, dig, season, hour });
    this.list = []; this.byId = new Map(); this.enabled = true; this.k = 1;
    this.offset = 0; this.skew = 0; this.t = 0; this.haloT = 0; this.stageT = 0; this.ms = 0;
    this.hint = ''; this.near = null; this.nearD = Infinity; this.lastFeed = new Map(); this.stats = { kills: 0, feeds: 0, remote: 0, gone: 0 };
    this.net = null; this.cseq = 0; this.pending = []; this.c = 0; this.shared = false;
    // the halos: one instanced draw of soft additive discs (forage.js's pools of light)
    const hg = new THREE.InstancedBufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); hg.setIndex([0, 1, 2, 0, 2, 3]);
    this.hPos = new Float32Array(HALO_CAP * 4); this.hGain = new Float32Array(HALO_CAP);
    this.aHPos = new THREE.InstancedBufferAttribute(this.hPos, 4).setUsage(THREE.DynamicDrawUsage); this.aHGain = new THREE.InstancedBufferAttribute(this.hGain, 1).setUsage(THREE.DynamicDrawUsage);
    hg.setAttribute('iPos', this.aHPos); hg.setAttribute('iGain', this.aHGain); hg.instanceCount = 0;
    this.haloMat = new THREE.ShaderMaterial({ vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, uniforms: { glowCol: { value: GLOW_COL.clone() }, sunLight: atmo.sunLight, ambientSky: atmo.ambientSky } });
    this.halos = new THREE.Mesh(hg, this.haloMat); this.halos.frustumCulled = false; this.halos.visible = false; this.halos.renderOrder = 3; this.halos.name = 'carrion halos';
    scene.add(this.halos);
    // the bones
    const bg = bonesGeometry();
    this.bPos = new Float32Array(BONES_CAP * 4); this.bRot = new Float32Array(BONES_CAP * 2);
    this.aBPos = new THREE.InstancedBufferAttribute(this.bPos, 4).setUsage(THREE.DynamicDrawUsage); this.aBRot = new THREE.InstancedBufferAttribute(this.bRot, 2).setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('iPos', this.aBPos); bg.setAttribute('iRot', this.aBRot); bg.instanceCount = 0;
    this.bonesMat = new THREE.ShaderMaterial({ vertexShader: BONES_VERT, fragmentShader: BONES_FRAG, transparent: true, uniforms: { sunDir: atmo.sunDir, sunLight: atmo.sunLight, ambientSky: atmo.ambientSky } });
    this.bones = new THREE.Mesh(bg, this.bonesMat); this.bones.frustumCulled = false; this.bones.visible = false; this.bones.name = 'carrion bones';
    scene.add(this.bones);
    this.nBones = 0; this.nHalo = 0;
    if (dig?.net) this.attach(dig.net);
  }
  get live() { return this.shared && !!this.net?.connected; }
  now() { return Date.now() / 1000 + this.offset + this.skew; }
  // debugging: this page's clock moved h hours on (the stage, the smell, the bones; not another page's)
  age(h) { this.skew = (h || 0) * 3600; this.stageT = 0; return this.skew; }
  isScavenger(code) { return code === 'puma_concolor' || !!this.animals.scavenges?.(code); }

  // ---- the records ----------------------------------------------------------------------------------------------------
  // The one-word name (animals.js SPECIES one) that keys MASS and LEN, and names the carcass
  oneOf(k) { return this.animals.speciesList()[k]?.one || 'animal'; }
  make({ id, one, code, x, y, z, yaw, size, born, by, meat, eaten, mass, lifeH }) {
    const m = mass ?? ((MASS[one] ?? 2) * (size || 1));
    const rec = { id, one, code, x, y, z, yaw: yaw || 0, size: size || 1, born, by: by || null, mass: m, meat0: m, meat: meat ?? m, eaten: eaten || 0, lifeH: lifeH ?? lifeOf(m),
      body: null, decay: 0, stage: 'fresh', boned: false, local: true, mine: false, bigT: -1e9, hugeT: -1e9, feeds: 0, len: (LEN[one] ?? 0.6) * (size || 1), gone: false };
    this.list.push(rec); this.byId.set(id, rec);
    return rec;
  }
  // animals.js kill: prey killed by `by` ('player', 'shared' for a kill the world told us of, or the AI hunter's code)
  onKill(prey, by, small) {
    const A = this.animals, one = this.oneOf(prey.sp), code = A.speciesList()[prey.sp].code;
    let rec = this.byId.get(prey.id);
    if (!rec) rec = this.make({ id: prey.id, one, code, x: prey.x, y: prey.yDead ?? prey.y, z: prey.z, yaw: prey.yaw, size: prey.size, born: this.now(), by: by === 'player' ? A.observer : by });
    rec.body = prey; prey.decay = 0; prey.carrionUntil = Infinity;
    if (by === 'player') rec.mine = true;
    this.stats.kills++;
    // to the shared world: a player's kill, or the AI host's (a kill the world told us of is already there)
    if (by !== 'shared' && this.live && (by === 'player' || this.net.host)) {
      this.send({ type: 'carcass', id: rec.id, one, sp: code, x: +rec.x.toFixed(2), y: +rec.y.toFixed(2), z: +rec.z.toFixed(2), yaw: +rec.yaw.toFixed(3), size: +rec.size.toFixed(3), mass: +rec.mass.toFixed(3), by: rec.by || undefined, ...(by === 'player' ? {} : { ai: true }) });
    }
    return rec;
  }
  recOf(body) { return body ? this.byId.get(body.id) || null : null; }
  // the stage factor of a carcass's scent (scent.js): by the body it is
  smellK(body) { const r = this.recOf(body); return r ? smellK(r.decay) : 1; }
  // the label scent.js gives a carrion wisp: the species once the scent is strong, else "dead animal"
  smellLabel(body, strength, one) { return strength >= NAME_S ? `${one} · dead` : 'dead animal'; }
  // "a deer, two hours dead"
  describeRec(rec) { return `a ${rec.one}, ${agePhrase(this.now() - rec.born)}${rec.stage === 'fresh' ? '' : `, ${rec.stage}`}`; }
  describe() { return this.list.map(r => `${r.id} ${this.describeRec(r)} decay ${r.decay.toFixed(2)} meat ${r.meat.toFixed(2)}/${r.meat0.toFixed(2)} kg${r.body ? '' : ' (no body)'}${r.local ? ' local' : ''}`); }

  // ---- feeding -------------------------------------------------------------------------------------------------------
  // A bite of `kg` from the carcass by species `code`: the store drawn, the stage advanced; shared when it is ours to
  // share (a player's, or the AI host's with ai true). Returns the kg taken (0 at an empty store).
  bite(rec, code, kg, ai) {
    const got = Math.min(rec.meat, kg); if (got <= 0) return 0;
    rec.meat -= got; rec.eaten += got; rec.feeds++; this.stats.feeds++;
    if (BIG.has(code)) rec.bigT = this.t; if (HUGE.has(code)) rec.hugeT = this.t;
    if (this.live && (!ai || this.net.host)) this.send({ type: 'feed', id: rec.id, kg: +got.toFixed(3), by: code, ...(ai ? { ai: true } : {}) });
    this.stageT = 0;
    return got;
  }
  // The player's feed at carcass body c (animals.js playerFeed, from the controls' E, the stabs, the vulture on
  // contact): a bite every FEED_GAP s per carcass; { kg, share (of a full belly), text } or null.
  playerFeed(c) {
    const rec = this.recOf(c), code = this.animals.observer; if (!rec || !code) return null;
    const bird = BIRDS.has(code), gap = bird ? FEED_GAP.bird : FEED_GAP.walk, last = this.lastFeed.get(rec.id) ?? -1e9;
    if (this.t - last < gap) return null;
    this.lastFeed.set(rec.id, this.t);
    if (rec.meat <= 1e-6) return { kg: 0, share: 0, text: `nothing left on the ${rec.one}` };
    const kg = this.bite(rec, code, BITE[code] ?? 0.5, false);
    return { kg, share: Math.min(1, kg / (NEED[code] ?? 1)), text: `fed at ${this.describeRec(rec)}` };
  }
  // The AI's feed: one bite (a raven's stab burst, the lion at its kill); true when something was taken.
  aiFeed(a, c) {
    const rec = this.recOf(c); if (!rec || rec.meat <= 1e-6) return false;
    const code = this.animals.speciesList()[a.sp].code;
    return this.bite(rec, code, BITE[code] ?? 0.3, true) > 0;
  }
  // The AI mammal's feeding spell at c (animals.js M_SNIFF with a.carr): a bite's worth over its stay, in quarter-kilo
  // bites; false when it should leave (the store empty, or a bigger scavenger at the carcass).
  aiFeedTick(a, c, dt) {
    const rec = this.recOf(c); if (!rec || rec.gone) return false;
    const code = this.animals.speciesList()[a.sp].code;
    if (this.yields(a, c)) return false;
    if (Math.hypot(a.x - rec.x, a.z - rec.z) > 3.5) return true;   // still on its way
    if (rec.meat <= 1e-6) return false;
    if (BIG.has(code)) rec.bigT = this.t; if (HUGE.has(code)) rec.hugeT = this.t;
    const bite = BITE[code] ?? 0.5, stay = Math.max(8, a.stay0 || 30);
    a.ate = (a.ate || 0) + bite / stay * dt;
    if (a.ate >= 0.25) { a.ate -= 0.25; if (this.bite(rec, code, 0.25, true) <= 0) return false; }
    return true;
  }
  // The pecking order: does scavenger `a` give way at carcass c? The birds to a canid, a bear or a lion feeding there
  // (within the last 1.5 s); the coyote and the fox to a bear or a lion; the player's body counts (update).
  yields(a, c) {
    const rec = this.recOf(c); if (!rec) return false;
    const code = this.animals.speciesList()[a.sp].code, recent = t => this.t - t < 1.5;
    if (BIRDS.has(code)) return recent(rec.bigT);
    if (code === 'canis_latrans' || code === 'urocyon_cinereoargenteus') return recent(rec.hugeT);
    return false;
  }
  // The AI's finding (animals.js carrionNear with the animal): the nearest carcass with a body that species `code` would
  // notice from where it is, or null. The vulture from the air within AI_R once the kill smells (decay past 0.06) or
  // within 300 m fresh; the raven by sight; the coyote by its nose, the wind shaping the reach, and mostly at dusk and
  // night (by day only within 80 m); the bear by its nose.
  aiNear(a) {
    const code = this.animals.speciesList()[a.sp].code, R = AI_R[code]; if (!R) return null;
    const hour = this.hour(), night = hour < 8 || hour > 16.5;
    let best = null, bd = Infinity;
    for (const rec of this.list) {
      if (!rec.body || rec.gone || rec.decay >= BONES_D || rec.meat <= 1e-6) continue;
      const dx = rec.x - a.x, dz = rec.z - a.z, d2 = dx * dx + dz * dz; if (d2 >= bd) continue;
      const d = Math.sqrt(d2); let reach;
      if (code === 'cathartes_aura') reach = rec.decay > 0.06 ? R : 300;
      else if (code === 'corvus_corax') reach = R;
      else { reach = R * smellK(rec.decay) * scentCarry(dx, dz); if (code === 'canis_latrans' && !night) reach = Math.min(reach, 80); }
      if (d < reach) { bd = d2; best = rec; }
    }
    return best ? best.body : null;
  }

  // ---- the shared world (dig.js DigNet's socket) ----------------------------------------------------------------------
  attach(net) {
    this.net = net; this.shared = true; this._onMsg = d => this.onMsg(d);
    net.also.push(this._onMsg);
  }
  send(e) {
    const p = { c: ++this.c, e }; this.pending.push(p); if (this.pending.length > 200) this.pending.shift();
    this.net.send({ t: 'cev', c: p.c, e });
  }
  onMsg(d) {
    if (d.t === 'dwelcome') {
      if (typeof d.now === 'number') this.offset = d.now - Date.now() / 1000;
      if (!d.carrion) { this.shared = false; return; }   // an older server: this browser's alone
      this.shared = true; this.cseq = d.carrion.seq || 0;
      this.adoptAll(d.carrion.list || {});
      for (const p of this.pending) this.net.send({ t: 'cev', c: p.c, e: p.e });   // still unanswered: the server decides
      return;
    }
    if (!this.shared) return;
    if (d.t === 'cev') {
      if (d.cseq !== this.cseq + 1) { this.net.open(); return; }   // a gap: a fresh welcome
      this.cseq = d.cseq;
      if (d.c !== undefined) { const i = this.pending.findIndex(p => p.c === d.c); if (i >= 0) this.pending.splice(i, 1); this.confirm(d.e, d.at); return; }
      this.stats.remote++; this.apply(d.e, d.at);
    } else if (d.t === 'crej') {
      const i = this.pending.findIndex(p => p.c === d.c); if (i >= 0) this.pending.splice(i, 1);
      if (d.why && typeof console !== 'undefined') console.warn('[carrion] rejected:', d.why);
    }
  }
  // our own event back from the server: the carcass's birth is the server's time now
  confirm(e, at) {
    const rec = this.byId.get(e.id); if (!rec) return;
    if (e.type === 'carcass' && typeof at === 'number') { rec.born = at; rec.local = false; }
  }
  apply(e, at) {
    if (e.type === 'carcass') this.adopt(e.id, { ...e, born: at ?? this.now() });
    else if (e.type === 'feed') { const rec = this.byId.get(e.id); if (rec) { const got = Math.min(rec.meat, e.kg); rec.meat -= got; rec.eaten += got; rec.feeds++; if (BIG.has(e.by)) rec.bigT = this.t; if (HUGE.has(e.by)) rec.hugeT = this.t; this.stageT = 0; } }
    else if (e.type === 'gone') for (const id of e.ids || []) this.remove(this.byId.get(id), true);
  }
  // a carcass from the world: ours already (born moved to the server's clock), a live animal of that id here (killed
  // now, as the world says), or a body to be made when the player is near (update)
  adopt(id, s) {
    let rec = this.byId.get(id);
    if (!rec) {
      rec = this.make({ id, one: s.one, code: s.sp, x: s.x, y: s.y, z: s.z, yaw: s.yaw, size: s.size, born: s.born, by: s.by, mass: s.mass, meat: s.meat, eaten: s.eaten });
      const a = this.animals.byId?.get(id);
      if (a && !a.dead && !a.gone) { this.animals.kill(a, 'shared'); rec.body = a; }
    } else { rec.born = s.born; if (s.meat !== undefined) { rec.meat = s.meat; rec.eaten = s.eaten || 0; } }
    rec.local = false;
    return rec;
  }
  adoptAll(list) {
    const seen = new Set();
    for (const [id, s] of Object.entries(list)) { this.adopt(id, s); seen.add(id); }
    for (const rec of [...this.list]) if (!seen.has(rec.id) && !rec.local && !this.pending.some(p => p.e.id === rec.id)) this.remove(rec, true);   // gone while we were away
    this.stageT = 0;
  }
  remove(rec, gone = false) {
    if (!rec || rec.gone) return;
    rec.gone = true; if (gone) this.stats.gone++;
    if (rec.body && !rec.body.gone) this.animals.bury(rec.body);
    rec.body = null;
    this.byId.delete(rec.id); const i = this.list.indexOf(rec); if (i >= 0) this.list.splice(i, 1);
    this.lastFeed.delete(rec.id);
  }

  // ---- every frame ----------------------------------------------------------------------------------------------------
  update(dt) {
    const t0 = performance.now();
    this.t += dt; this.haloT -= dt; this.stageT -= dt;
    const A = this.animals, P = this.flight.pos, now = this.now(), season = this.season();
    const stages = this.stageT <= 0; if (stages) this.stageT = STAGE_T;
    // the player's own feeding at a carcass counts in the pecking order (a canid, a bear or a lion crouched at a kill)
    const me = A.observer, meBig = me && BIG.has(me), feedingAt = this.ground?.feeding?.at || null;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const rec = this.list[i];
      if (stages || rec.decay === 0) { rec.decay = decayOf(rec, now, season); rec.stage = stageOf(rec.decay); }
      if (rec.decay >= 1) { if (this.skew === 0) this.remove(rec, false); else if (rec.body) { this.animals.bury(rec.body); rec.body = null; } continue; }   // gone (a debugging age keeps the record, so it comes back at age(0))
      let b = rec.body;
      if (b && (b.gone || !A.alive(b) || !b.dead)) { b = rec.body = null; }   // dropped by a rebuild (far), or the world's copy went
      const d2 = (rec.x - P.x) ** 2 + (rec.z - P.z) ** 2;
      if (rec.decay >= BONES_D) { if (b) { A.bury(b); rec.body = b = null; } rec.boned = true; }
      else if (!b && d2 < LIVE_R * LIVE_R) { const sp = A.spawnCarcass?.(rec); if (sp) { rec.body = b = sp; b.decay = rec.decay; } }
      if (b) { b.decay = rec.decay; b.fed = rec.meat0 > 0 ? rec.eaten / rec.meat0 : 0; }
      if (meBig && (feedingAt === b || (this.ground?.on && this.ground.actT > 0 && d2 < REACH * REACH))) { rec.bigT = this.t; if (HUGE.has(me)) rec.hugeT = this.t; }
    }
    this.placeBones();
    if (this.haloT <= 0) { this.haloT = HALO_T; this.placeHalos(P); }
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  placeBones() {
    const pos = this.bPos, rot = this.bRot; let n = 0;
    for (const rec of this.list) {
      if (!rec.boned || n >= BONES_CAP) continue;
      const fade = 1 - clamp01((rec.decay - BONES_D) / (1 - BONES_D)), o = n * 4;
      pos[o] = rec.x; pos[o + 1] = this.animals.heights.atXZ(rec.x, rec.z) + 0.01; pos[o + 2] = rec.z; pos[o + 3] = rec.len;
      rot[n * 2] = rec.yaw; rot[n * 2 + 1] = fade; n++;
    }
    if (n !== this.nBones || n) { this.nBones = n; this.bones.geometry.instanceCount = n; this.bones.visible = n > 0; }
    if (n) { this.aBPos.clearUpdateRanges(); this.aBPos.addUpdateRange(0, n * 4); this.aBPos.needsUpdate = true; this.aBRot.clearUpdateRanges(); this.aBRot.addUpdateRange(0, n * 2); this.aBRot.needsUpdate = true; }
  }
  // The glow (the header) for a scavenger's eye, and the hint for the panels.
  placeHalos(P) {
    const code = this.animals.observer, N = this.needs, body = !!(this.ground?.on || this.flier?.on);
    const R = body && code && this.enabled ? SEE_R[code] || 0 : 0;
    this.near = null; this.nearD = Infinity; let hint = '';
    const pos = this.hPos, gain = this.hGain; let n = 0;
    if (R > 0 && this.list.length) {
      const hunger = N?.sp ? N.hunger : 0.5, pulse = 1 - PULSE + PULSE * Math.sin(this.t * TAU * PULSE_HZ);
      const g0 = (GAIN_FED + (1 - GAIN_FED) * Math.pow(1 - hunger, HUNGER_POW)) * pulse * this.k;
      const lion = code === 'puma_concolor';
      for (const rec of this.list) {
        if (rec.gone || rec.boned || (lion && !rec.mine)) continue;
        const dx = rec.x - P.x, dz = rec.z - P.z, d = Math.hypot(dx, dz);
        if (d < this.nearD) { this.nearD = d; this.near = rec; }
        if (d >= R || n >= HALO_CAP) continue;
        const o = n * 4, r = Math.max(rec.len * 0.75, d * 0.012);
        pos[o] = rec.x; pos[o + 1] = (rec.body ? rec.body.y : this.animals.heights.atXZ(rec.x, rec.z)) + 0.05; pos[o + 2] = rec.z; pos[o + 3] = r;
        gain[n] = g0 * Math.min(1.4, smellK(rec.decay)) * Math.pow(1 - d / R, 0.8) * (0.55 + 0.45 * Math.min(1, d / 15));   // dimmer at hand, where the body itself is plain to see
        n++;
      }
      const nr = this.near;
      if (nr && this.nearD < REACH) hint = `${this.describeRec(nr)}${nr.meat > 1e-6 ? (N && N.hunger < 0.98 ? ' · hold E' : '') : ' · nothing left'}`;
      else if (nr && this.nearD < R) { const b = DIRS[Math.round(((Math.atan2(nr.x - P.x, -(nr.z - P.z)) * 180 / Math.PI) + 360) % 360 / 45) % 8]; hint = `${this.describeRec(nr)} · ${this.nearD < 1000 ? `${Math.round(this.nearD)} m` : `${(this.nearD / 1000).toFixed(1)} km`} ${b}`; }
    }
    this.hint = hint; if (N) N.carrionHint = hint;
    this.nHalo = n; this.halos.geometry.instanceCount = n; this.halos.visible = n > 0;
    if (n) { this.aHPos.clearUpdateRanges(); this.aHPos.addUpdateRange(0, n * 4); this.aHPos.needsUpdate = true; this.aHGain.clearUpdateRanges(); this.aHGain.addUpdateRange(0, n); this.aHGain.needsUpdate = true; }
  }
  dispose() {
    for (const rec of [...this.list]) { if (rec.body && !rec.body.gone) this.animals.bury(rec.body); }
    this.list.length = 0; this.byId.clear();
    this.halos.removeFromParent(); this.halos.geometry.dispose(); this.haloMat.dispose();
    this.bones.removeFromParent(); this.bones.geometry.dispose(); this.bonesMat.dispose();
    if (this.net) { const i = this.net.also.findIndex(f => f === this._onMsg); if (i >= 0) this.net.also.splice(i, 1); }
    if (this.needs) this.needs.carrionHint = '';
  }
}
