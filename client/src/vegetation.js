import * as THREE from 'three';
import { SPECIES, SPECIES_IDS, mulberry32, resolveSpecies } from './trees.js';
import { buildTree, canopyMaterial, trunkMaterial, applySeason, chainShader, SLOTS, variantSlots } from './treegen.js';
import { SEASON_LOOK } from './season.js';

// Species mix per habitat class (codes from pipeline/habitat.py). Weights sum to 1. Ids may be the
// short aliases; trees.js maps them to the species library (library/species/<id>.json).
// Exported with pick, hash and variantSeed so the far impostors (impostors.js) place the same trees.
export const MIX = {
  1: { blue_oak: 0.55, live_oak: 0.25, gray_pine: 0.2 },                       // oak woodland
  2: { ponderosa: 0.7, gray_pine: 0.12, live_oak: 0.18 },                      // conifer forest
  3: { ponderosa: 0.3, live_oak: 0.3, blue_oak: 0.2, gray_pine: 0.2 },         // mixed forest
  4: { gray_pine: 1.0 },                                                       // chaparral: occasional pine; shrubs below
  5: { blue_oak: 0.85, gray_pine: 0.15 },                                      // grassland / savanna
  6: { live_oak: 0.6, blue_oak: 0.2, ponderosa: 0.2 },                         // riparian (stand-ins)
};
export const SHRUB_MIX = { 4: { chamise: 0.6, manzanita: 0.4 }, 1: { manzanita: 1 }, 3: { manzanita: 1 }, 2: { manzanita: 1 }, 6: { manzanita: 1 }, 5: { chamise: 1 } };
// Variant slots per species: each plant draws one (one random number, as always) and treegen.variantSlots
// maps the slots to the species' age classes and snag in proportion to their weights (12 slots: shares in
// twelfths). Slots of the same tree share one set of meshes; the far impostors bake every slot.
export const VARIANTS = SLOTS;
const CAP = 24000;
export const variantSeed = (id, v) => variantSlots(id, VARIANTS)[v].seed;   // canonical species id, slot 0..VARIANTS-1
// The mid set's extent: every cell whose centre is within `radius` of `center` ([x, z]) is placed here,
// so the far impostors (impostors.js) draw exactly the cells outside it, each tree once.
export const midSet = { center: null, radius: 0, version: 0 };
// Two LODs. Every placed plant is in the mid set (rebuilt by the cell scan every 200 m); the near set
// holds the plants within NEAR_R + NEAR_MARGIN of where it was last refreshed (every NEAR_MOVE m, a
// copy out of the mid set, no cell scan). The switch itself is per frame in the vertex shader: near
// instances beyond NEAR_R of the eye and mid instances within it are collapsed, so each plant draws once.
export const NEAR_R = 180;
const NEAR_MARGIN = 60, NEAR_MOVE = 40, NEAR_CAP = { tree: 1500, shrub: 3000 };
// Close tier: within CLOSE_R of the camera (3D, to the plant's base) canopies switch from the near
// cards to the denser close cards (treegen 'close'), cross-faded over CLOSE_R +/- CLOSE_BAND (70-110 m).
// The close set is a copy of the near instances within reach, refreshed when the camera has moved
// CLOSE_MOVE m; it is empty whenever the camera is more than about 130 m from every plant (the start
// view), so it costs nothing there. Trunks are not duplicated: the near trunk is drawn with it.
export const CLOSE_R = 90;
const CLOSE_BAND = 20, CLOSE_MOVE = 15, CLOSE_CAP = { tree: 600, shrub: 1500 };

// Per-cell plan, shared by every placer (Vegetation.update; impostors.js should call it too, so the far
// trees follow the same mix). The cell's random stream is the one placement has always used: this
// draws its first number (the stochastic extra tree) only where the class has a tree mix, exactly as
// before, and the caller then draws six per plant (species, variant, x, north, scale, rotation), so a
// plant k sits where it always did and only the mapping of its species draw changed.
// With tile.speciesMix (LANDFIRE weights per cell) the species come from the cell's mix and the counts
// scale by its density multipliers (clamped DENSITY); without it, or where the cell has no mix, the
// fixed class MIX / SHRUB_MIX and multiplier 1 apply. Returns null for a cell that grows nothing.
const DENSITY = [0.3, 2.0];
const OAKS_ONLY = { blue_oak: 1 };
const oakMixes = new Map();   // savanna rows -> their oak weights, renormalised
const oakMix = row => {
  let m = oakMixes.get(row); if (m) return m;
  const b = row.weights.blue_oak, l = row.weights.live_oak;
  m = l ? { blue_oak: b / (b + l), live_oak: l / (b + l) } : OAKS_ONLY; oakMixes.set(row, m); return m;
};
export function cellPlan(tile, i, j) {
  const cls = tile.habitat.channel(i, j, 0); if (!MIX[cls] && !SHRUB_MIX[cls]) return null;
  const can = tile.canopy, tree = can.channel(i, j, 0) / 100, shrub = can.channel(i, j, 1) / 100;
  const row = tile.speciesMix ? tile.speciesMix.at(i, j) : null;
  const clampD = v => Math.min(DENSITY[1], Math.max(DENSITY[0], v));
  const td = row ? clampD(row.treeDensity) : 1, sd = row ? clampD(row.shrubDensity) : 1;
  const treeMix = row && row.treeSum ? row.trees : MIX[cls], shrubMix = row && row.shrubSum ? row.shrubs : SHRUB_MIX[cls];
  const rnd = mulberry32(hash(i, j, 7)), t = tree * td;
  let nTrees = MIX[cls] ? Math.round(t * (cls === 5 ? 3 : 11) + (rnd() < (t * 11) % 1 ? 1 : 0)) : 0;
  const nShrubs = SHRUB_MIX[cls] ? Math.round(shrub * sd * (cls === 4 ? 18 : 6)) : 0;
  // Blue oak savanna the canopy layer calls treeless (EVC tree cover 0): about one oak per two cells.
  let savannaOak = false;
  if (!nTrees && tree === 0 && row?.savanna && (cls === 5 || cls === 1) && (hash(i, j, 23) & 1)) { nTrees = 1; savannaOak = true; }
  return { cls, rnd, nTrees, nShrubs, treeMix: savannaOak ? oakMix(row) : treeMix, shrubMix };
}
// Whether plant k of cell (i, j) at (px, pn) is skipped: road pavement and verge (as before), ponds
// and stream channels (tile.waterMask), and riparian thinning: a tree within RIPARIAN_M of a stream
// centreline is kept with odds rising from 0.35 at the channel to 1 at the band's edge. Uses hashes,
// never the cell's random stream, so a skip moves nothing else.
export function placementSkip(tile, i, j, k, px, pn, isTree) {
  const roads = tile.roads, rw = roads ? roads.at(px, pn) : 0;
  if (rw > 140 || (isTree && rw > 0 && hash(k, i + j * 4096, 13) / 4294967296 < rw / 255)) return true;
  const wm = tile.waterMask; if (!wm) return false;
  if (wm.inWater(px, pn)) return true;
  if (isTree) { const d = wm.streamDist(px, pn); if (d < 8 && hash(k, i + j * 4096, 29) / 4294967296 > 0.35 + 0.65 * d / 8) return true; }
  return false;
}

export function pick(mix, r) { let acc = 0; for (const [k, w] of Object.entries(mix)) { acc += w; if (r <= acc) return k; } return Object.keys(mix)[0]; }
export function hash(i, j, salt) { let h = (i * 73856093) ^ (j * 19349663) ^ (salt * 83492791); return h >>> 0; }

// Collapse instances on the wrong side of the switch. Canopies cross-fade over +/-LOD_BAND m with
// complementary screen-space dither (both LODs draw in the band, each keeps the pixels the other drops);
// trunks switch hard at NEAR_R (the two LODs share a skeleton, so they barely differ).
// role: 'near' | 'mid' (the 2D switch at NEAR_R), or 'close' (the 3D switch at CLOSE_R). A near
// canopy (`inner`) also hands over to the close tier inside CLOSE_R, with the complementary dither.
const LOD_BAND = 15;
function lodPatch(material, u, role, fade = false, inner = false) {
  const W = fade ? LOD_BAND.toFixed(1) : '0.0', CW = CLOSE_BAND.toFixed(1), near = role === 'near';
  const keep = role === 'close'   // vLodT: the fraction of pixels this layer gives up (near) or keeps (mid, close)
    ? `float cD = distance(lodP, closeEye);
       vLodT = clamp((closeR + ${CW} - cD) / (2.0 * ${CW}), 0.0, 1.0);
       if (cD > closeR + ${CW}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`
    : `float lodD = distance(lodP.xz, lodEye.xz);
       vLodT = clamp((lodD - lodR + ${W}) / (2.0 * ${W} + 1e-4), 0.0, 1.0);
       if (lodD ${near ? '>' : '<='} lodR ${near ? '+' : '-'} ${W}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
       ${inner ? `float cD = distance(lodP, closeEye);
       vLodT = max(vLodT, clamp((closeR + ${CW} - cD) / (2.0 * ${CW}), 0.0, 1.0));
       if (cD < closeR - ${CW}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);` : ''}`;
  return chainShader(material, `lod-${role}${fade ? '-fade' : ''}${inner ? '-inner' : ''}`, shader => {
    shader.uniforms.lodEye = u.lodEye; shader.uniforms.lodR = u.lodR; shader.uniforms.closeEye = u.closeEye; shader.uniforms.closeR = u.closeR;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 lodEye;\nuniform float lodR;\nuniform vec3 closeEye;\nuniform float closeR;\nvarying float vLodT;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vLodT = 0.0;
        #ifdef USE_INSTANCING
        { vec3 lodP = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          ${keep} }
        #endif`);
    if (fade) shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLodT;')
      .replace('#include <clipping_planes_fragment>', `{ float lodN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (${near ? 'lodN < vLodT' : 'lodN >= vLodT'}) discard; }
        #include <clipping_planes_fragment>`);
  });
}

export class Vegetation {
  constructor(tile, scene, atmosphere) {
    this.tile = tile; this.scene = scene; this.group = new THREE.Group(); scene.add(this.group);
    this.radius = 1500; this.lastCenter = null; this.lastNear = null; this.count = 0; this.nearCount = 0;
    this.oaks = []; this.version = 0;   // oaks placed by the last update (acorn game) and a counter bumped per rebuild
    this.nearPlants = []; this.nearVersion = 0;   // every plant in the near set: { id, species, x, y, z, scale, height }
    this.closeCount = 0; this.lastClose = null; this.closeVersion = -1;
    this.lodU = { lodEye: { value: new THREE.Vector3() }, lodR: { value: NEAR_R }, closeEye: { value: new THREE.Vector3(0, 1e9, 0) }, closeR: { value: CLOSE_R } };
    const patch = m => atmosphere.patchLambert(m);   // cloud shadow + aerial perspective
    this.trunkMat = { near: lodPatch(trunkMaterial(patch), this.lodU, 'near'), mid: lodPatch(trunkMaterial(patch), this.lodU, 'mid') };   // shared (shadow casters use it)
    this.barkMat = {};     // species id -> { near, mid }: the species' bark texture and normal map (treegen barkTexture)
    this.canopyMat = {};   // species id -> { near, mid, close }
    this.meshes = {};      // species id -> [{ near: {trunk, canopy, cap, n, ids}, mid: {...}, close: {canopy, cap, n}, stem, height, tris, cls }], one per distinct tree
    this.slots = {};       // species id -> VARIANTS entries of this.meshes (a class with several slots repeats its entries)
    this.stats = {};
    for (const id of SPECIES_IDS) {
      const spec = SPECIES[id];
      this.canopyMat[id] = { near: lodPatch(canopyMaterial(spec, 'near', patch), this.lodU, 'near', true, true), mid: lodPatch(canopyMaterial(spec, 'mid', patch), this.lodU, 'mid', true),
        close: lodPatch(canopyMaterial(spec, 'close', patch), this.lodU, 'close', true) };
      this.barkMat[id] = { near: lodPatch(trunkMaterial(patch, spec), this.lodU, 'near'), mid: this.trunkMat.mid };   // bark texture within NEAR_R; beyond, plain vertex colour (same mean)
      this.meshes[id] = []; this.slots[id] = [];
      const bySeed = new Map();
      for (let v = 0; v < VARIANTS; v++) {
        const seed = variantSeed(id, v);
        if (bySeed.has(seed)) { this.slots[id].push(bySeed.get(seed)); continue; }
        const entry = { seed, cls: variantSlots(id, VARIANTS)[v].cls };
        bySeed.set(seed, entry); this.slots[id].push(entry);
        for (const lod of ['near', 'mid']) {
          const t = buildTree(id, seed, lod);
          const cap = lod === 'mid' ? (spec.shrub ? CAP : CAP / 2) : NEAR_CAP[spec.shrub ? 'shrub' : 'tree'];
          const trunk = new THREE.InstancedMesh(t.trunk, this.barkMat[id][lod], cap);
          const canopy = new THREE.InstancedMesh(t.canopy, this.canopyMat[id][lod], cap);
          canopy.instanceMatrix = trunk.instanceMatrix;   // one matrix buffer for both parts
          trunk.count = canopy.count = 0; trunk.frustumCulled = canopy.frustumCulled = false;
          this.group.add(trunk, canopy);
          entry[lod] = { trunk, canopy, cap, n: 0, tris: t.tris.trunk + t.tris.canopy, ids: new Uint32Array(cap) };
          if (lod === 'near') { entry.stem = t.stem; entry.height = t.height; }
        }
        const c = buildTree(id, seed, 'close'), ccap = CLOSE_CAP[spec.shrub ? 'shrub' : 'tree'];
        const closeCanopy = new THREE.InstancedMesh(c.canopy, this.canopyMat[id].close, ccap);
        closeCanopy.count = 0; closeCanopy.frustumCulled = false; closeCanopy.visible = false;
        this.group.add(closeCanopy);
        entry.close = { canopy: closeCanopy, cap: ccap, n: 0, tris: c.tris.canopy };
        this.meshes[id].push(entry);
      }
      const avg = lod => Math.round(this.meshes[id].reduce((s, e) => s + e[lod].tris, 0) / this.meshes[id].length);
      this.stats[id] = { near: avg('near'), mid: avg('mid'), closeCanopy: avg('close') };
    }
    this.tmp = new THREE.Object3D();
  }
  setLook(look) {
    const season = Object.keys(SEASON_LOOK).find(k => SEASON_LOOK[k] === look) || 'summer';
    this.leafOn = {};
    for (const id of SPECIES_IDS) for (const lod of ['near', 'mid', 'close']) {
      const on = applySeason(this.canopyMat[id][lod], SPECIES[id], season);
      this.leafOn[id] = on;
      for (const e of this.meshes[id]) e[lod].canopy.visible = on > 0 && (lod !== 'close' || e.close.n > 0);   // a bare crown draws nothing
    }
  }
  // Rebuild instances for cells within radius of (x, z). Deterministic per cell, so a tree is always in the same place.
  update(x, z, force = false) {
    this.lodU.lodEye.value.set(x, 0, z);
    if (!force && this.lastCenter && Math.hypot(x - this.lastCenter[0], z - this.lastCenter[1]) < 200) {
      if (Math.hypot(x - this.lastNear[0], z - this.lastNear[1]) > NEAR_MOVE) this.refreshNear(x, z);
      return;
    }
    this.lastCenter = [x, z];
    midSet.center = this.lastCenter; midSet.radius = this.radius; midSet.version++;
    const tile = this.tile, hab = tile.habitat, res = hab.res, size = tile.size, heights = tile.heights;
    for (const arr of Object.values(this.meshes)) for (const e of arr) e.mid.n = 0;
    const oaks = [];
    const north = -z, r = this.radius, cells = Math.ceil(r / res);
    const [ci, cj] = hab.cellOf(x, north);
    let total = 0;
    for (let j = cj - cells; j <= cj + cells; j++) for (let i = ci - cells; i <= ci + cells; i++) {
      if (i < 0 || j < 0 || i >= hab.img.width || j >= hab.img.height) continue;
      const cx = (i + 0.5) * res, cn = size - (j + 0.5) * res;
      if (Math.hypot(cx - x, cn - north) > r) continue;
      const plan = cellPlan(tile, i, j); if (!plan) continue;
      const { rnd, nTrees, nShrubs, treeMix, shrubMix } = plan;
      for (let k = 0; k < nTrees + nShrubs; k++) {
        const isTree = k < nTrees;
        const name = pick(isTree ? treeMix : shrubMix, rnd());
        const variants = this.slots[resolveSpecies(name)], e = variants[Math.floor(rnd() * variants.length)], m = e.mid;   // slot draw as before: VARIANTS slots, weighted by class
        const px = (i + rnd()) * res, pn = size - (j + rnd()) * res;
        const s = 0.75 + rnd() * 0.5, rot = rnd() * Math.PI * 2;   // all draws before any skip, so neighbours keep their place
        if (m.n >= m.cap) continue;   // after the draws: a full model slot must not shift the rest of the cell (impostors use the same sequence)
        // Decayed roads: nothing on the pavement; trees thin out across the verge (shrubs creep in).
        // Nothing in ponds or stream channels; trees thin out toward a stream (placementSkip).
        if (placementSkip(tile, i, j, k, px, pn, isTree)) continue;
        this.tmp.position.set(px, heights.at(px, pn) - 0.3, -pn);
        this.tmp.rotation.set(0, rot, 0); this.tmp.scale.setScalar(s); this.tmp.updateMatrix();
        m.trunk.setMatrixAt(m.n, this.tmp.matrix); m.ids[m.n] = hash(i, j, k + 101); m.n++; total++;
        if (name === 'blue_oak' || name === 'live_oak') oaks.push({ id: `${i},${j},${k}`, x: px, z: -pn, y: this.tmp.position.y + 0.3, scale: s, species: name, rot, stem: e.stem, height: e.height });
      }
    }
    for (const arr of Object.values(this.meshes)) for (const e of arr) {
      e.mid.trunk.count = e.mid.canopy.count = e.mid.n;
      e.mid.trunk.instanceMatrix.addUpdateRange(0, e.mid.n * 16); e.mid.trunk.instanceMatrix.needsUpdate = true;
    }
    this.count = total; this.oaks = oaks; this.version++;
    this.refreshNear(x, z);
  }
  // Copy the mid instances near (x, z) into the near set: no cell scan, no height lookups.
  refreshNear(x, z) {
    this.lastNear = [x, z];
    const R2 = (NEAR_R + NEAR_MARGIN) ** 2;
    let total = 0, dropped = 0;
    const plants = [];
    for (const [species, arr] of Object.entries(this.meshes)) for (const e of arr) {
      const src = e.mid.trunk.instanceMatrix.array, dst = e.near.trunk.instanceMatrix.array, cap = e.near.cap;
      let n = 0;
      for (let i = 0; i < e.mid.n; i++) {
        const o = i * 16, dx = src[o + 12] - x, dz = src[o + 14] - z;
        if (dx * dx + dz * dz > R2) continue;
        if (n >= cap) { dropped++; continue; }
        for (let k = 0; k < 16; k++) dst[n * 16 + k] = src[o + k];
        e.near.ids[n] = e.mid.ids[i];
        const scale = Math.hypot(src[o], src[o + 1], src[o + 2]);
        plants.push({ id: e.mid.ids[i], species, x: src[o + 12], y: src[o + 13] + 0.3, z: src[o + 14], scale, height: e.height * scale });
        n++;
      }
      e.near.n = e.near.trunk.count = e.near.canopy.count = n; total += n;
      e.near.trunk.instanceMatrix.addUpdateRange(0, n * 16); e.near.trunk.instanceMatrix.needsUpdate = true;
    }
    if (dropped && !this.warned) { this.warned = true; console.warn(`vegetation: near set full, ${dropped} plants within ${NEAR_R} m are not drawn; raise NEAR_CAP`); }
    this.nearCount = total; this.nearPlants = plants; this.nearVersion++;
  }
  // Close tier, per frame from the camera: moves the fade centre, and every CLOSE_MOVE m (or after a
  // near refresh) copies the near instances within reach into the close set. A plain array copy.
  updateClose(eye) {
    this.lodU.closeEye.value.copy(eye);
    if (this.closeVersion === this.nearVersion && this.lastClose && this.lastClose.distanceToSquared(eye) < CLOSE_MOVE * CLOSE_MOVE) return;
    this.lastClose = (this.lastClose || new THREE.Vector3()).copy(eye); this.closeVersion = this.nearVersion;
    const R2 = (CLOSE_R + CLOSE_BAND + CLOSE_MOVE + 2) ** 2;
    let total = 0;
    for (const [id, arr] of Object.entries(this.meshes)) for (const e of arr) {
      const src = e.near.trunk.instanceMatrix.array, c = e.close, dst = c.canopy.instanceMatrix.array;
      let n = 0;
      for (let i = 0; i < e.near.n && n < c.cap; i++) {
        const o = i * 16, dx = src[o + 12] - eye.x, dy = src[o + 13] - eye.y, dz = src[o + 14] - eye.z;
        if (dx * dx + dy * dy + dz * dz > R2) continue;
        for (let k = 0; k < 16; k++) dst[n * 16 + k] = src[o + k];
        n++;
      }
      if (n || c.n) { c.canopy.instanceMatrix.addUpdateRange(0, n * 16); c.canopy.instanceMatrix.needsUpdate = true; }
      c.n = c.canopy.count = n; total += n;
      c.canopy.visible = n > 0 && (this.leafOn?.[id] ?? 1) > 0;
    }
    this.closeCount = total;
  }
}
