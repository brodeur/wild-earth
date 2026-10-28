import * as THREE from 'three';
import { animalSilhouetteMaterial } from './animalModels.js';
import { rarityColor } from './animals.js';

// Hidden herd members (owner, 2026-10-27: "a luminous silhouette visible through trees, less luminous the further
// away until invisible"): in a herd, covey or flock (groundControl.js herd), each member's body is drawn a second
// time with the species' own posing (animalModels.js animalSilhouetteMaterial), but only where it lies behind what is already drawn (depthFunc
// GreaterDepth: the parts hidden by foliage, or a rise), as a flat silhouette in the species' soul colour
// (animals.js rarityColor), additive, no depth write, fading from full at SIL_NEAR m to nothing at SIL_FAR m. The
// visible parts stay as they are, so a half-hidden deer reads as one body. One small InstancedMesh per species
// (SIL_CAP members), filled every frame from the animals' own instance matrices and pose values (animals.js
// meshes[k], anim2[k]); the geometry is the drawn tier 0's or the procedural model's, cloned so it carries its own
// per-instance pose attributes. Nothing is drawn while the player is not in a group.
const SIL_CAP = 32, SIL_NEAR = 25, SIL_FAR = 150, SIL_GAIN = 0.85;
// What hides a member must not be the herd itself (owner, 2026-10-27): while the player is in a group, the bodies of
// that species (the AI's instanced meshes and drawn tiers) and the player's own body write STENCIL_HERD into the
// stencil as they are drawn, and the silhouette pass draws only where the stencil is not that, so only foliage,
// trunks, rocks and ground count as cover; a member's own far side and the members in front of it do not.
const STENCIL_HERD = 1;

export class HerdSilhouette {
  constructor({ scene, animals, atmosphere }) {
    this.animals = animals; this.atmosphere = atmosphere; this.meshes = new Map();
    this.group = new THREE.Group(); this.group.name = 'herd silhouettes'; scene.add(this.group);
  }
  mesh(k) {
    let m = this.meshes.get(k); if (m) return m;
    const A = this.animals, st = A.drawn?.[k], drawn = A.meshOn(k) && st?.tiers?.[0];
    const src = drawn ? st.tiers[0] : A.meshes[k], model = drawn ? st.model : A.speciesList()[k].model;
    if (!src?.geometry || !model) return null;
    const geo = src.geometry.clone();
    for (const name of ['aAnim', 'aAnim2']) if (geo.attributes[name]) { const a = new THREE.InstancedBufferAttribute(new Float32Array(SIL_CAP * 4), 4); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); }
    const mat = animalSilhouetteMaterial(model, { soul: rarityColor(A.rarity[k]), fade: new THREE.Vector2(SIL_NEAR, SIL_FAR), gain: SIL_GAIN });
    mat.stencilWrite = true; mat.stencilRef = STENCIL_HERD; mat.stencilFunc = THREE.NotEqualStencilFunc;   // not where a herd body is (mark below)
    mat.stencilFail = THREE.KeepStencilOp; mat.stencilZFail = THREE.KeepStencilOp; mat.stencilZPass = THREE.KeepStencilOp;
    m = new THREE.InstancedMesh(geo, mat, SIL_CAP); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false; m.renderOrder = 12; m.name = `${A.speciesList()[k].one} silhouettes`;
    this.group.add(m); this.meshes.set(k, m);
    return m;
  }
  // the herd's bodies mark the stencil while the player is in the group: every species slot in the group (a deer herd
  // holds does and bucks, two slots) and the player's own body
  setStencil(m, on) {
    if (!m || m.stencilWrite === on) return;
    m.stencilWrite = on; m.stencilRef = STENCIL_HERD; m.stencilFunc = THREE.AlwaysStencilFunc;
    m.stencilZPass = on ? THREE.ReplaceStencilOp : THREE.KeepStencilOp;
  }
  mark(k, on) {
    const A = this.animals;
    if (A.meshes[k]) this.setStencil(A.meshes[k].material, on);
    for (const m of A.drawn?.[k]?.tiers || []) this.setStencil(m.material, on);
  }
  // every frame: group the player's group (null: none), me the player's own animal, body the player's own mesh
  update(group, me, body = null) {
    const A = this.animals, counts = new Map(), want = new Set();
    if (group && me) want.add(me.sp);
    if (group) for (const a of A.list) if (a.group === group && a !== me && !a.culled) want.add(a.sp);
    if (!this.marked) this.marked = new Set();
    for (const k of this.marked) if (!want.has(k)) { this.mark(k, false); this.marked.delete(k); }
    for (const k of want) if (!this.marked.has(k)) { this.mark(k, true); this.marked.add(k); }
    const b = group && me ? body : null;
    if (this.markedBody !== b) { if (this.markedBody) this.setStencil(this.markedBody.material, false); if (b) this.setStencil(b.material, true); this.markedBody = b; }
    if (group) for (const a of A.list) {
      if (a.group !== group || a === me || a.culled || a.slot < 0) continue;
      const k = a.sp, m = this.mesh(k); if (!m) continue;
      const n = counts.get(k) || 0; if (n >= SIL_CAP) continue;
      m.instanceMatrix.array.set(A.meshes[k].instanceMatrix.array.subarray(a.slot * 16, a.slot * 16 + 16), n * 16);
      const anim = m.geometry.attributes.aAnim, srcAnim = A.meshes[k].geometry.attributes.aAnim;
      if (anim && srcAnim) anim.array.set(srcAnim.array.subarray(a.slot * 4, a.slot * 4 + 4), n * 4);
      const anim2 = m.geometry.attributes.aAnim2, src2 = A.anim2?.[k];
      if (anim2 && src2) anim2.array.set(src2.subarray(a.slot * 4, a.slot * 4 + 4), n * 4);
      counts.set(k, n + 1);
    }
    for (const [k, m] of this.meshes) {
      const n = counts.get(k) || 0; m.count = n; m.visible = n > 0;
      if (n) { m.instanceMatrix.needsUpdate = true; if (m.geometry.attributes.aAnim) m.geometry.attributes.aAnim.needsUpdate = true; if (m.geometry.attributes.aAnim2) m.geometry.attributes.aAnim2.needsUpdate = true; }
    }
  }
  clear() { this.update(null, null); }
}
