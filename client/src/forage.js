import * as THREE from 'three';
import { uniforms as atmo } from './atmosphere.js';
import { SPECIES } from './trees.js';
import { FORB_MAX } from './forbs.js';   // the herbs' slots; the species in them are the tile's own (forbs.species, forbs.js forbSet)
import { FH } from './shrubfield.js';

// The forager's food (Aaron, 2026-11-01: "For animals that can forage, plants they can forage should glow. They can
// smell nearby plants."). For a body whose species eats plants this season (the tile's games.json relations.forage:
// [animal, plant, part, resource, seasons], from the library records' eaten_by; needs.js foodPlants) the plants it can
// eat are shown to it two ways:
//
// 1. They glow. Within the body's sight of the ground (R_BY m by species: a deer or a bear 22, the rabbits 8-10, the
// vole 3; else R_DEFAULT) every food plant carries a soft warm glow (GLOW_COL, one colour for every forager: the plant's
// "food" rather than the species' rarity colour, which would paint a meadow purple for the abundant deer), pulsing
// slowly (PULSE_HZ), brighter for the nearest few (a boost inside 0.15 of the radius) and fading with distance
// ((1 - d / R)^1.2), brighter for the part in season (PART: a flower while the herb flowers, seeds once it has set
// them, a shrub's berries or flowers while its crown shows them; a part out of season glows at under half) and dimmer
// when the body is fed: the gain is GAIN_FED at a full belly rising to 1 at an empty one (needs.js hunger), so a hungry
// deer sees its food lit and a sated one barely. The glow rides on the existing draws as uniforms, no second pass:
// the herbs' shader (forbs.js: glow, glowSp[FORB_MAX], glowCol; the plant lit most at the soft edges of its picture)
// and the shrub impostors' (shrubfield.js: glow, glowFh[FH_N], glowKind, glowCol; the rim of the crown and a skirt
// past its outline). The near 3D shrubs (vegetation.js's near set, treegen's materials: the tree lane's files, untouched) and
// the sward where the grass itself is food (grass.js: thousands of clumps, the sward lane's file) take a halo from this
// module's one instanced draw instead (HALO_CAP soft additive discs lying on the ground: a pool of light under each
// 3D food shrub, 0.7 of its height across; until 2026-11-06 also one under the body's nose when the leading grass of the
// sward there was food, removed because it read as a glow under every grazer; a billboard behind the crown was tried first and read as a yellow cutout over the shrub). Nothing glows for a body with no forage rows this
// season (the lion, the lizard: its insects are not plants) or for the spirit or a flier.
//
// 2. They can smell nearby plants. sources(x, z, reach, cb) hands scent.js (its `plants` provider) one source per food
// species in reach: the nearest herb of it among the staged herbs (forbs.js, drawn within 45 m), the nearest food shrub
// among the near 3D plants and the impostor field's cached cells, and the sward as one source at the nearest food sward
// sampled on rings of bearings (SWARD_RINGS of the reach) when the body does not already stand in one. scent.js draws
// them as it draws an animal's scent (a strand on the ring round the head, flickering in when new and whenever the player
// sniffs with L, its label the plant's common name, in GLOW_COL), at PLANT_K of the species' reach (scent.js REACH): a
// deer smells a lupine from 70 m, a vole from 7. The source objects are kept per species (no new object per query).
//
// main.js builds it after the scent (scent.plants = forage) and calls update(dt) every frame; the uniforms it writes
// are declared in forbs.js and shrubfield.js. abilities.js lights the act slot (graze, nibble, peck) "ready" when
// needs.js has a named food plant within reach. Debugging: __we.forage; forage.on, forage.gain, forage.ids.
const R_BY = { odocoileus_hemionus: 22, ursus_americanus: 22, sylvilagus_bachmani: 8, lepus_californicus: 10, microtus_californicus: 3,
  otospermophilus_beecheyi: 8, sciurus_griseus: 10, meleagris_gallopavo: 10, callipepla_californica: 6, oreortyx_pictus: 6, sceloporus_occidentalis: 1.5 };
const R_DEFAULT = 12;
export const GLOW_COL = new THREE.Color(1.0, 0.66, 0.24);   // a warm plant glow (linear)
const GAIN_K = 1;   // the glow's overall level (forage.k live)
const PULSE_HZ = 0.45, PULSE = 0.15, GAIN_FED = 0.3, HUNGER_POW = 0.7, NO_NEEDS_HUNGER = 0.5;   // the squirrel has no needs: a middling gain
const PART = { leaves: 1, browse: 1, bulbs: 0.8, flowers: [1.35, 0.4], seeds: [1.2, 0.45], berries: [1.3, 0.45], acorns: 0 };   // [in season, out]; a tree's acorns are not drawn here
const MASK_T = 0.5, HALO_T = 0.12, HALO_CAP = 48, SHRUB_H = 6;   // s between mask refreshes; between halo refreshes; halos at most; a near plant under this height is a shrub
const PLANT_K = 0.35, SWARD_RINGS = [0.25, 0.55, 1.0], SWARD_BEARINGS = 8;   // the scent: the share of the species' reach; the rings sampled for a sward's scent
const SHRUB_STRIDE = 8, CAND_MAX = 48;   // shrubfield.js STRIDE: x y z R | H seed kind rank
const CHAP = ['adenostoma_fasciculatum', 'arctostaphylos_viscida'];   // the chaparral kinds 0 and 1
const TAU = Math.PI * 2;

const VERT = /* glsl */`
  attribute vec4 iPos;   // centre x y z on the ground, radius (m)
  uniform vec4 glow;   // the body x z, the radius, the gain
  varying vec2 vQ; varying float vA;
  void main() {
    float d = distance(iPos.xz, glow.xy);
    float a = glow.w * pow(clamp(1.0 - d / max(glow.z, 0.01), 0.0, 1.0), 1.2) * (1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.15 * glow.z, d)));
    if (a < 0.01) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    vA = a; vQ = position.xy;
    vec3 p = iPos.xyz + vec3(position.x, 0.0, position.y) * iPos.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const FRAG = /* glsl */`
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

const partWeight = (part, inSeason) => { const p = PART[part] ?? 0.8; return Array.isArray(p) ? p[inSeason ? 0 : 1] : p; };

export class Forage {
  constructor({ tile, needs, forbs, shrubs, veg, grass, scene, flight, ground, squirrel = null, season }) {
    Object.assign(this, { tile, needs, forbs, shrubs, veg, grass, flight, ground, squirrel, season });
    this.enabled = true; this.k = GAIN_K;   // A/B: false turns the glow, the halos and the plant scents off; k the level
    this.on = false; this.gain = 0; this.t = 0; this.key = null; this.ids = new Set(); this.parts = new Map(); this.R = R_DEFAULT;
    this.maskT = 0; this.haloT = 0; this.ms = 0;
    this.forbW = new Float32Array(FORB_MAX); this.fhW = new Float32Array(FH.length); this.chapW = [0, 0];   // the species' weights, this season (PART)
    this.grassFood = new Set(); this.shrubIds = new Set();
    this.targets = [forbs.uniforms, shrubs.uniforms].filter(u => u && u.glow);
    for (const u of this.targets) u.glowCol.value.copy(GLOW_COL);
    // the halos: one instanced draw of soft additive discs
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.hPos = new Float32Array(HALO_CAP * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.hPos, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.instanceCount = 0;
    this.uniforms = { glow: { value: new THREE.Vector4(0, 0, 1, 0) }, glowCol: { value: GLOW_COL.clone() }, sunLight: atmo.sunLight, ambientSky: atmo.ambientSky };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.halos = new THREE.Mesh(g, this.mat); this.halos.frustumCulled = false; this.halos.visible = false; this.halos.renderOrder = 3; this.halos.name = 'forage halos';
    scene.add(this.halos);
    this.nHalo = 0;
    // the scent sources, one per species, kept (scent.js holds them in its slots between queries)
    this.src = new Map(); this.bestD = new Float64Array(FORB_MAX); this.bestX = new Float64Array(FORB_MAX); this.bestZ = new Float64Array(FORB_MAX);
    this.bestShrub = new Map();
  }
  // this body's species and season: the food plant ids, their parts, the species' weights for the shaders
  setKey(code, season) {
    this.key = `${code}:${season}`; this.ids = this.needs.foodPlants(season); this.parts.clear();
    for (const [a, plant, part, , seasons] of this.tile.games?.relations?.forage || []) {
      if (a !== code || (seasons.length && !seasons.includes(season))) continue;
      let set = this.parts.get(plant); if (!set) this.parts.set(plant, set = new Set()); set.add(part);
    }
    this.grassFood.clear(); this.shrubIds.clear();
    for (const id of this.ids) { const s = SPECIES[id]; if (!s) continue; if (s.form === 'grass') this.grassFood.add(id); else if (s.form !== 'forb' && s.form !== 'emergent' && s.form !== 'tree' && !this.forbs.species.some(f => f.id === id)) this.shrubIds.add(id); }   // a dwarf shrub of the ground layer glows with the herbs
    this.R = R_BY[code] ?? R_DEFAULT;
    this.refreshMasks();
  }
  // the weight of plant `id` (0: not food) with its parts in or out of season
  weight(id, inSeason) {
    const parts = this.parts.get(id); if (!parts) return 0;
    let w = 0; for (const p of parts) w = Math.max(w, partWeight(p, inSeason)); return w;
  }
  refreshMasks() {
    const F = this.forbs, st = F.states;
    for (let k = 0; k < FORB_MAX; k++) { const sp = F.species[k], s = sp && st[k]; this.forbW[k] = sp && s && s.h > 0 ? this.weight(sp.id, s.flowering || s.dead) : 0; }
    const deco = this.shrubs.uniforms.fhDeco?.value;
    for (let k = 0; k < FH.length; k++) this.fhW[k] = this.weight(FH[k], !!(deco && deco[k].w > 0));
    this.chapW[0] = this.weight(CHAP[0], false); this.chapW[1] = this.weight(CHAP[1], false);
    const fu = F.uniforms; if (fu.glowSp) fu.glowSp.value.set(this.forbW);
    const su = this.shrubs.uniforms; if (su.glowFh) su.glowFh.value.set(this.fhW); if (su.glowKind) su.glowKind.value.set(this.chapW[0], this.chapW[1]);
  }
  update(dt) {
    const t0 = performance.now();
    this.t += dt;
    const N = this.needs, body = (!!this.ground?.on && this.ground.mode !== 'tunnel') || !!this.squirrel?.on, code = N.code, season = this.season();   // underground (dig.js) no plant is in sight
    if (body && code && `${code}:${season}` !== this.key) this.setKey(code, season);
    const on = this.enabled && body && !!code && this.ids.size > 0;
    if (on !== this.on) { this.on = on; if (!on) { this.gain = 0; this.halos.visible = false; this.nHalo = 0; } }
    if (!on) { for (const u of this.targets) u.glow.value.w = 0; this.uniforms.glow.value.w = 0; return; }
    const hunger = N.sp ? N.hunger : NO_NEEDS_HUNGER;
    const pulse = 1 - PULSE + PULSE * Math.sin(this.t * TAU * PULSE_HZ);
    this.gain = (GAIN_FED + (1 - GAIN_FED) * Math.pow(1 - hunger, HUNGER_POW)) * pulse * this.k;
    const P = this.flight.pos;
    for (const u of this.targets) u.glow.value.set(P.x, P.z, this.R, this.gain);
    this.uniforms.glow.value.set(P.x, P.z, this.R, this.gain);
    this.maskT -= dt; if (this.maskT <= 0) { this.maskT = MASK_T; this.refreshMasks(); }
    this.haloT -= dt; if (this.haloT <= 0) { this.haloT = HALO_T; this.placeHalos(P); }
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  // the halos (the header): a pool of light on the ground under each near 3D food shrub within R. The pool on the sward
  // under the nose where its grass is food is gone (Aaron, 2026-11-06: "There is a faint glow below the player no matter
  // what animal - lets remove that"): every grazer stood in it all the time, so it read as a light under the body.
  placeHalos(P) {
    const pos = this.hPos, R = this.R, R2 = R * R; let n = 0;
    if (this.shrubIds.size) for (const q of this.veg.nearPlants || []) {
      if (n >= HALO_CAP) break;
      if (!this.shrubIds.has(q.species) || !(q.height < SHRUB_H)) continue;
      const dx = q.x - P.x, dz = q.z - P.z; if (dx * dx + dz * dz > R2) continue;
      const h = q.height || 1, o = n * 4;
      pos[o] = q.x; pos[o + 1] = q.y + 0.05; pos[o + 2] = q.z; pos[o + 3] = Math.max(0.6, h * 0.7); n++;
    }
    this.nHalo = n; this.halos.geometry.instanceCount = n; this.halos.visible = n > 0;
    if (n) { this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, n * 4); this.aPos.needsUpdate = true; }
  }
  // ---- the scent (the header, 2): the plant sources within reach of (x, z), one per species, to cb(source) ------
  source(id, name) {
    let s = this.src.get(id); if (!s) this.src.set(id, s = { id: `plant:${id}`, x: 0, z: 0, plant: true, species: id, name, col: GLOW_COL });
    return s;
  }
  get plantReach() { return PLANT_K; }
  sources(x, z, reach, cb) {
    if (!this.on || !(reach > 0)) return;
    const r2 = reach * reach;
    // the herbs: the nearest of each food species among the staged
    const F = this.forbs, buf = F.buf.array, bd = this.bestD, bx = this.bestX, bz = this.bestZ; let any = false;
    bd.fill(Infinity);
    for (let q = 0, n = F.n; q < n; q++) {
      const o = q * 8, sp = buf[o + 4] | 0; if (!(this.forbW[sp] > 0)) continue;
      const dx = buf[o] - x, dz = buf[o + 2] - z, d2 = dx * dx + dz * dz; if (d2 > r2 || d2 >= bd[sp]) continue;
      bd[sp] = d2; bx[sp] = buf[o]; bz[sp] = buf[o + 2]; any = true;
    }
    if (any) for (let k = 0; k < FORB_MAX; k++) if (bd[k] < Infinity) { const G = F.species[k], s = this.source(G.id, G.common || G.id); s.x = bx[k]; s.z = bz[k]; cb(s); }
    // the shrubs: the near 3D plants and the impostor field's cached cells, the nearest of each food species
    if (this.shrubIds.size) {
      const B = this.bestShrub; B.clear();
      for (const q of this.veg.nearPlants || []) {
        if (!this.shrubIds.has(q.species) || !(q.height < SHRUB_H)) continue;
        const dx = q.x - x, dz = q.z - z, d2 = dx * dx + dz * dz; if (d2 > r2) continue;
        const b = B.get(q.species); if (!b) B.set(q.species, { d2, x: q.x, z: q.z }); else if (d2 < b.d2) { b.d2 = d2; b.x = q.x; b.z = q.z; }
      }
      const SF = this.shrubs, res = this.tile.habitat.res;
      for (const [d, i, j] of SF.cells || []) {
        if (d > reach + res) break;
        const c = SF.cache.get(j * SF.W + i); if (!c || !c.n) continue;
        const a = c.data;
        for (let q = 0, o = 0; q < c.n; q++, o += SHRUB_STRIDE) {
          const kind = a[o + 6], id = kind < -0.5 ? FH[-1 - Math.round(kind)] : kind < 1.5 ? CHAP[Math.round(kind)] : null;
          if (!id || !this.shrubIds.has(id)) continue;
          const dx = a[o] - x, dz = a[o + 2] - z, d2 = dx * dx + dz * dz; if (d2 > r2) continue;
          const b = B.get(id); if (!b) B.set(id, { d2, x: a[o], z: a[o + 2] }); else if (d2 < b.d2) { b.d2 = d2; b.x = a[o]; b.z = a[o + 2]; }
        }
      }
      for (const [id, b] of B) { const s = this.source(id, SPECIES[id]?.common || id); s.x = b.x; s.z = b.z; cb(s); }
    }
    // the sward: one source at the nearest food sward on the rings (the first ring with one), unless the body stands in one
    if (this.grassFood.size) {
      const foodOf = g => g ? (this.grassFood.has(g.id) ? g.id : g.ids.find(q => this.grassFood.has(q)) || null) : null;
      if (!foodOf(this.grass.speciesAt(x, -z))) {
        let bx0 = 0, bz0 = 0, bid = null;
        for (const f of SWARD_RINGS) {
          for (let b = 0; b < SWARD_BEARINGS && !bid; b++) {
            const ang = (b + (f > 0.3 ? 0.5 : 0)) * TAU / SWARD_BEARINGS, px = x + Math.sin(ang) * f * reach, pz = z - Math.cos(ang) * f * reach;
            const id = foodOf(this.grass.speciesAt(px, -pz)); if (id) { bid = id; bx0 = px; bz0 = pz; }
          }
          if (bid) break;
        }
        if (bid) { const s = this.source('sward', 'grass'); s.name = SPECIES[bid]?.common || 'grass'; s.species = bid; s.x = bx0; s.z = bz0; cb(s); }
      }
    }
  }
  // ---- plant targets (quarry.js, 2026-11-06: "Herbivores also can target plants, and must be close enough to the target
  // to eat") ----------------------------------------------------------------------------------------------------
  // Every food plant within R m of (x, z), from the same sources as the glow and the scent, one target each (not one per
  // species): the staged herbs (forbs.js), the near 3D food shrubs and the impostor field's cached shrubs, and the sward
  // where its grass is food, as a patch at each sample of SWARD_RINGS x SWARD_BEARINGS rings of R. A target is
  // { plant: true, key, species, name, part, x, y, z, r (m: how far its foliage reaches from its centre) }; nearest first,
  // at most max (CAND_MAX by default; the sniff's wave, sniffWave.js, asks for more).
  candidates(x, z, R, max = CAND_MAX) {
    const out = []; if (!this.on || !(R > 0)) return out;
    const r2 = R * R, push = (key, species, px, py, pz, r) => { const dx = px - x, dz = pz - z, d2 = dx * dx + dz * dz; if (d2 <= r2) out.push({ plant: true, key, species, name: SPECIES[species]?.common || species, part: this.partOf(species), x: px, y: py, z: pz, r, d2 }); };
    const F = this.forbs, buf = F.buf.array;
    for (let q = 0, n = F.n; q < n; q++) {
      const o = q * 8, sp = buf[o + 4] | 0; if (!(this.forbW[sp] > 0)) continue;
      push(`forb:${buf[o].toFixed(2)},${buf[o + 2].toFixed(2)}`, F.species[sp].id, buf[o], buf[o + 1], buf[o + 2], Math.max(0.15, 0.3 * (buf[o + 3] || 1)));
    }
    if (this.shrubIds.size) {
      for (const q of this.veg.nearPlants || []) if (this.shrubIds.has(q.species) && q.height < SHRUB_H) push(`shrub:${q.id}`, q.species, q.x, q.y, q.z, Math.max(0.4, q.crownR || q.height * 0.35));
      const SF = this.shrubs, res = this.tile.habitat.res;
      for (const [d, i, j] of SF.cells || []) {
        if (d > R + res) break;
        const c = SF.cache.get(j * SF.W + i); if (!c || !c.n) continue;
        const a = c.data;
        for (let q = 0, o = 0; q < c.n; q++, o += SHRUB_STRIDE) {
          const kind = a[o + 6], id = kind < -0.5 ? FH[-1 - Math.round(kind)] : kind < 1.5 ? CHAP[Math.round(kind)] : null;
          if (id && this.shrubIds.has(id)) push(`imp:${i},${j},${q}`, id, a[o], a[o + 1], a[o + 2], Math.max(0.4, a[o + 3] || 0.6));
        }
      }
    }
    if (this.grassFood.size) {   // the sward: a patch at each ring sample where its grass is food
      const foodOf = g => g ? (this.grassFood.has(g.id) ? g.id : g.ids.find(q => this.grassFood.has(q)) || null) : null;
      for (const f of SWARD_RINGS) for (let b = 0; b < SWARD_BEARINGS; b++) {
        const ang = (b + (f > 0.3 ? 0.5 : 0)) * TAU / SWARD_BEARINGS, px = x + Math.sin(ang) * f * R, pz = z - Math.cos(ang) * f * R;
        const id = foodOf(this.grass.speciesAt(px, -pz)); if (id) push(`sward:${Math.round(px)},${Math.round(pz)}`, id, px, this.grass.ground(px, -pz), pz, 0.9);
      }
    }
    out.sort((p, q) => p.d2 - q.d2); if (out.length > max) out.length = max;
    return out;
  }
  // the parts of plant `id` this body eats this season, as words ("seeds", "leaves and flowers")
  partOf(id) { const p = [...(this.parts.get(id) || [])].map(w => String(w).replace(/_/g, ' ')); return p.length > 1 ? `${p.slice(0, -1).join(', ')} and ${p.at(-1)}` : p[0] || 'food'; }
  dispose() {
    this.halos.removeFromParent(); this.halos.geometry.dispose(); this.mat.dispose();
    for (const u of this.targets) u.glow.value.w = 0;
    this.src.clear(); this.on = false;
  }
}
