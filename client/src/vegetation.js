import * as THREE from 'three';
import { buildTree, SPECIES, mulberry32 } from './trees.js';

// Species mix per habitat class (codes from pipeline/habitat.py). Weights sum to 1.
const MIX = {
  1: { blue_oak: 0.55, live_oak: 0.25, gray_pine: 0.2 },                       // oak woodland
  2: { ponderosa: 0.7, gray_pine: 0.12, live_oak: 0.18 },                      // conifer forest
  3: { ponderosa: 0.3, live_oak: 0.3, blue_oak: 0.2, gray_pine: 0.2 },         // mixed forest
  4: { gray_pine: 1.0 },                                                       // chaparral: occasional pine; shrubs below
  5: { blue_oak: 0.85, gray_pine: 0.15 },                                      // grassland / savanna
  6: { live_oak: 0.6, blue_oak: 0.2, ponderosa: 0.2 },                         // riparian (stand-ins)
};
const SHRUB_MIX = { 4: { chamise: 0.6, manzanita: 0.4 }, 1: { manzanita: 1 }, 3: { manzanita: 1 }, 2: { manzanita: 1 }, 6: { manzanita: 1 }, 5: { chamise: 1 } };
const VARIANTS = 3, CAP = 24000;

function pick(mix, r) { let acc = 0; for (const [k, w] of Object.entries(mix)) { acc += w; if (r <= acc) return k; } return Object.keys(mix)[0]; }
function hash(i, j, salt) { let h = (i * 73856093) ^ (j * 19349663) ^ (salt * 83492791); return h >>> 0; }

export class Vegetation {
  constructor(tile, scene, atmosphere) {
    this.tile = tile; this.scene = scene; this.group = new THREE.Group(); scene.add(this.group);
    this.radius = 1500; this.lastCenter = null; this.count = 0;
    this.oaks = []; this.version = 0;   // oaks placed by the last update (acorn game) and a counter bumped per rebuild
    this.trunkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.canopyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.deciduousMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff });
    for (const m of [this.trunkMat, this.canopyMat, this.deciduousMat]) atmosphere.patchLambert(m);   // cloud shadow + aerial perspective
    this.meshes = {}; // species -> [{trunk, canopy, cap}]
    for (const name of Object.keys(SPECIES)) {
      this.meshes[name] = [];
      for (let v = 0; v < VARIANTS; v++) {
        const t = buildTree(name, 1000 + v * 17 + name.length);
        const cap = SPECIES[name].shrub ? CAP : CAP / 2;
        const trunk = new THREE.InstancedMesh(t.trunk, this.trunkMat, cap);
        const canopy = new THREE.InstancedMesh(t.canopy, SPECIES[name].deciduous ? this.deciduousMat : this.canopyMat, cap);
        trunk.count = canopy.count = 0; trunk.frustumCulled = canopy.frustumCulled = false;
        this.group.add(trunk, canopy); this.meshes[name].push({ trunk, canopy, cap, n: 0, stem: t.stem, height: t.height });
      }
    }
    this.tmp = new THREE.Object3D();
  }
  setLook(look) {
    this.deciduousMat.color.setRGB(look.oakLeaf[0] / 0.45, look.oakLeaf[1] / 0.55, look.oakLeaf[2] / 0.25).multiplyScalar(0.9);
    this.deciduousMat.transparent = look.oakLeafOn < 1; this.deciduousMat.opacity = Math.max(0.15, look.oakLeafOn);
    this.deciduousMat.needsUpdate = true;
  }
  // Rebuild instances for cells within radius of (x, z). Deterministic per cell, so a tree is always in the same place.
  update(x, z, force = false) {
    if (!force && this.lastCenter && Math.hypot(x - this.lastCenter[0], z - this.lastCenter[1]) < 200) return;
    this.lastCenter = [x, z];
    const hab = this.tile.habitat, can = this.tile.canopy, res = hab.res, size = this.tile.size, heights = this.tile.heights, roads = this.tile.roads;
    for (const arr of Object.values(this.meshes)) for (const m of arr) m.n = 0;
    const oaks = [];
    const north = -z, r = this.radius, cells = Math.ceil(r / res);
    const [ci, cj] = hab.cellOf(x, north);
    let total = 0;
    for (let j = cj - cells; j <= cj + cells; j++) for (let i = ci - cells; i <= ci + cells; i++) {
      if (i < 0 || j < 0 || i >= hab.img.width || j >= hab.img.height) continue;
      const cx = (i + 0.5) * res, cn = size - (j + 0.5) * res;
      if (Math.hypot(cx - x, cn - north) > r) continue;
      const cls = hab.channel(i, j, 0); if (!MIX[cls] && !SHRUB_MIX[cls]) continue;
      const tree = can.channel(i, j, 0) / 100, shrub = can.channel(i, j, 1) / 100;
      const rnd = mulberry32(hash(i, j, 7));
      const nTrees = MIX[cls] ? Math.round(tree * (cls === 5 ? 3 : 11) + (rnd() < (tree * 11) % 1 ? 1 : 0)) : 0;
      const nShrubs = SHRUB_MIX[cls] ? Math.round(shrub * (cls === 4 ? 18 : 6)) : 0;
      for (let k = 0; k < nTrees + nShrubs; k++) {
        const isTree = k < nTrees;
        const name = pick(isTree ? MIX[cls] : SHRUB_MIX[cls], rnd());
        const variants = this.meshes[name], m = variants[Math.floor(rnd() * variants.length)];
        if (m.n >= m.cap) continue;
        const px = (i + rnd()) * res, pn = size - (j + rnd()) * res;
        const s = 0.75 + rnd() * 0.5, rot = rnd() * Math.PI * 2;   // all draws before any skip, so neighbours keep their place
        // Decayed roads: nothing on the pavement; trees thin out across the verge (shrubs creep in).
        const rw = roads ? roads.at(px, pn) : 0;
        if (rw > 140 || (isTree && rw > 0 && hash(k, i + j * 4096, 13) / 4294967296 < rw / 255)) continue;
        this.tmp.position.set(px, heights.at(px, pn) - 0.3, -pn);
        this.tmp.rotation.set(0, rot, 0); this.tmp.scale.setScalar(s); this.tmp.updateMatrix();
        m.trunk.setMatrixAt(m.n, this.tmp.matrix); m.canopy.setMatrixAt(m.n, this.tmp.matrix); m.n++; total++;
        if (name === 'blue_oak' || name === 'live_oak') oaks.push({ id: `${i},${j},${k}`, x: px, z: -pn, y: this.tmp.position.y + 0.3, scale: s, species: name, rot, stem: m.stem, height: m.height });
      }
    }
    for (const arr of Object.values(this.meshes)) for (const m of arr) {
      m.trunk.count = m.canopy.count = m.n; m.trunk.instanceMatrix.needsUpdate = true; m.canopy.instanceMatrix.needsUpdate = true;
    }
    this.count = total; this.oaks = oaks; this.version++;
  }
}
