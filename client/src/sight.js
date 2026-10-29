import * as THREE from 'three';
import { animalSilhouetteMaterial } from './animalModels.js';
import { rarityColor } from './animals.js';

// Sight (owner, 2026-10-29: "For prey animals, if they are within a certain distance of predators and visible to the
// camera, there is a chance that their body becomes highlighted in their rarity colors - the opposite of how a herd
// sees. The herd sees occluded, the predator sees only what is visible highlighted. Same vice versa - the prey animal
// has a chance of 'spotting' the predator. If that chance succeeds, the predator becomes highlighted. Any animal across
// species retains the highlight for 5 seconds - if they are spotted again within that 5 seconds, the timer resets.").
//
// Who: every live animal that the player's species hunts or is hunted by (games.json relations.predation, both ways:
// animals.js preySlots), within the player's vision of it (perception.json senses[player].vision against
// signatures[it].sight, the smaller). Each frame such an animal in the camera's view rolls a chance of being spotted:
// RATE per second at the eye, falling with distance over that range (RANGE_POW), times its motion (a frozen body STILL,
// a walk WALK, a trot TROT, a bolt BOLT: a bolting deer is spotted at once, a bedded one rarely) and times how much of
// it the camera can see (visibility(), 0..1: the terrain between, every near tree's crown as a sphere and its trunk as
// a cylinder (vegetation.js's near set, inside NEAR_R of the eye), the canopy raster's tree cover beyond that, and the
// shrub cover of the cell it stands in). A success holds the highlight HOLD s from now (a re-spot resets it), so an
// animal that steps behind cover is lost once the hold runs out. The same the other way: the animal's own chance of
// spotting the player, judged as its AI judges a threat (animals.js noticeAt: its eyes and ears shrunk by the stalk,
// or its nose in this wind), scaled by its view of the player's body; a success marks it "it sees you" for HOLD s.
//
// The highlight is the herd silhouette's opposite (herdSilhouette.js draws what cover hides): one InstancedMesh per
// species (SPOT_CAP bodies), the species' own posing (animalModels.js animalSilhouetteMaterial, its depth test turned
// to LessEqual with a polygon offset toward the eye), so only the surface the camera sees is lit, additively, in the
// species' rarity colour (animals.js rarityColor). The intensity rides in the instance matrix's unused element [3]
// (m[0][3], zero in any affine matrix; the vertex shader reads it out and zeroes it: no new vertex attribute, the
// buck's skin path being one short of Metal's sixteen), fading over FADE_T s at the end of the hold; a body that sees
// the player throbs (PULSE_HZ). main.js builds it after the scent and calls update(dt) while the player is in a body,
// clear() otherwise; hunt.js asks spotted(a) and seesMe(a) for its goal line.
const HOLD = 5, FADE_T = 1.0, PULSE_HZ = 1.6, SPOT_CAP = 16, SPOT_GAIN = 0.42;   // the gain: at 0.7 a lit deer was a flat cutout; at 0.42 its shading shows through the wash
const RATE = 3, RANGE_POW = 1.5;                        // per second at the eye; the fall with distance
const STILL = 0.3, WALK = 0.7, TROT = 1.5, BOLT = 4;    // the motion factor by the body's speed (SPEEDS): a lion standing 18 m off in the open is spotted about every 2 s, a bolting deer at once
const SPEEDS = [0.25, 1.6, 3.5];                        // m/s: still under, walk under, trot under, else a bolt
const SEES_K = 2.0, SEES_FROM = 0.8;                    // it sees you: per second per unit of (its notice / distance) over SEES_FROM
const TEST_T = 0.25, STEP = 4, MARCH_MAX = 60;          // s between visibility tests per animal; the terrain march step and its cap
const NEAR_R = 180;                                     // vegetation.js NEAR_R: inside it every tree is explicit
const CROWN_UP = 0.62, CROWN_R = 0.33, CROWN_K = 0.9;   // a crown: a sphere at CROWN_UP of the height, CROWN_R of it across; a chord through the middle hides CROWN_K
const SHRUB_H = 6, SHRUB_UP = 0.5, SHRUB_R = 0.45;       // a plant under SHRUB_H m is a shrub: foliage to the ground (a sphere at half its height, nearly as wide as tall), no trunk
const TRUNK_R = 0.025, TRUNK_R0 = 0.08, TRUNK_K = 0.35; // a trunk: a cylinder up to the crown's centre, hiding TRUNK_K
const COVER_K = 0.6, SHRUB_K = 0.6;                     // beyond NEAR_R: tree cover per raster cell; the shrub cover where the body stands
const DEFAULT_RANGE = 200, EYE = 0.6, BODY_UP = 0.6, EYE_UP = 0.4;   // m: a tile without senses; the player's body over its feet (its shoulder when the walker says); an animal's body centre over its feet (times its size), and its eye over that
const GROUND_TOL = 0.15;                                // m: the ground may rise this far over the line of sight (the micro-relief under two low bodies) before it hides
const TAU = Math.PI * 2;

export class Sight {
  constructor({ tile, animals, flight, veg, scene, camera, ground = null }) {
    Object.assign(this, { tile, animals, flight, veg, camera, ground });
    this.group = new THREE.Group(); this.group.name = 'sight highlights'; scene.add(this.group);
    this.meshes = new Map(); this.track = new Map(); this.t = 0; this.code = null; this.k = -1;
    this.prey = null; this.hunters = null; this.range = null;
    this.trees = { x: new Float32Array(0), y: new Float32Array(0), z: new Float32Array(0), h: new Float32Array(0), n: 0, version: -1 };
    this.v = new THREE.Vector3(); this.pruneT = 0; this.ms = 0; this.tests = 0;
  }
  // the player's species: whom it hunts and who hunts it (both ways), and its vision of each species
  setSpecies(code) {
    const A = this.animals, L = A.speciesList(); if (!A.preySlots) A.buildHunts?.();
    this.code = code; this.k = L.findIndex(sp => sp.code === code);
    const mine = new Set(L.map((sp, k) => sp.code === code ? k : -1).filter(k => k >= 0));
    this.prey = new Set(A.preySlots?.[this.k] || []);
    this.hunters = new Set(); A.preySlots?.forEach((s, h) => { if (s) for (const k of mine) if (s.has(k)) this.hunters.add(h); });
    const sen = this.tile.perception?.senses?.[code.split(':')[0]], sig = this.tile.perception?.signatures;
    this.range = L.map(sp => { const s = sig?.[sp.code.split(':')[0]]?.sight; return sen && typeof s === 'number' ? Math.min(sen.vision ?? 0, s) : DEFAULT_RANGE; });
    this.track.clear();
    for (const m of this.meshes.values()) m.count = 0;
  }
  relevant(sp) { return this.prey.has(sp) || this.hunters.has(sp); }
  // the near trees as arrays (the matrices of vegetation.js's near set), rebuilt when that set changes
  indexTrees() {
    const V = this.veg, T = this.trees; if (!V?.meshes || T.version === V.nearVersion) return;
    T.version = V.nearVersion;
    let n = 0; for (const arr of Object.values(V.meshes)) for (const e of arr) n += e.near?.n || 0;
    if (T.x.length < n) { T.x = new Float32Array(n); T.y = new Float32Array(n); T.z = new Float32Array(n); T.h = new Float32Array(n); }
    let i = 0;
    for (const arr of Object.values(V.meshes)) for (const e of arr) {
      const m = e.near; if (!m?.n) continue; const a = m.trunk.instanceMatrix.array;
      for (let j = 0; j < m.n; j++) {
        const b = j * 16, s = Math.hypot(a[b], a[b + 1], a[b + 2]);
        T.x[i] = a[b + 12]; T.y[i] = a[b + 13] + 0.3; T.z[i] = a[b + 14]; T.h[i] = e.height * s; i++;
      }
    }
    T.n = i;
  }
  // How much of a body at (tx, ty, tz) an eye at (ex, ey, ez) can see, 0..1 (see the header). shrub: the target stands
  // on the ground (its cell's shrub cover hides some of it).
  visibility(ex, ey, ez, tx, ty, tz, shrub = true) {
    const dx = tx - ex, dy = ty - ey, dz = tz - ez, L = Math.hypot(dx, dy, dz); if (L < 1e-3) return 1;
    const hts = this.animals.heights;
    // the ground between (not the metre at either end: the eye's and the body's own footing)
    const step = Math.max(STEP, L / MARCH_MAX);
    for (let t = 1.5; t < L - 1.5; t += step) { const u = t / L; if (ey + dy * u < hts.atXZ(ex + dx * u, ez + dz * u) - GROUND_TOL) return 0; }
    let v = 1;
    const T = this.trees, ux = dx / L, uy = dy / L, uz = dz / L, L2 = dx * dx + dz * dz;
    for (let i = 0; i < T.n; i++) {
      const h = T.h[i]; if (!(h > 0.5)) continue;
      const shrub = h < SHRUB_H, bx = T.x[i], by = T.y[i], bz = T.z[i], cy = by + (shrub ? SHRUB_UP : CROWN_UP) * h, R = (shrub ? SHRUB_R : CROWN_R) * h;
      // the crown: the chord of the segment through its sphere
      let vx = bx - ex, vy = cy - ey, vz = bz - ez, t = vx * ux + vy * uy + vz * uz;
      if (t > -R && t < L + R) {
        const tc = t < 0 ? 0 : t > L ? L : t, m2 = (vx - ux * tc) ** 2 + (vy - uy * tc) ** 2 + (vz - uz * tc) ** 2;
        if (m2 < R * R) { const chord = 2 * Math.sqrt(R * R - m2); v *= 1 - CROWN_K * Math.min(1, chord / (1.2 * R)); }
      }
      // the trunk: the segment's closest approach to its axis, seen from above, at a height inside it
      if (!shrub && L2 > 1e-6) {
        let s = ((bx - ex) * dx + (bz - ez) * dz) / L2; s = s < 0 ? 0 : s > 1 ? 1 : s;
        const px = ex + dx * s - bx, pz = ez + dz * s - bz, rt = TRUNK_R * h + TRUNK_R0;
        if (px * px + pz * pz < rt * rt) { const hy = ey + dy * s; if (hy > by && hy < cy) v *= TRUNK_K; }
      }
      if (v < 0.02) return 0;
    }
    // beyond the near set the canopy raster stands in for the trees: its tree cover, cell by cell along the way
    const can = this.tile.canopy;
    if (can && L > NEAR_R) {
      const res = Math.max(can.res || 10, 10);
      for (let t = NEAR_R; t < L - 1; t += res) { const u = t / L, c = can.cellOf(ex + dx * u, -(ez + dz * u)); v *= 1 - COVER_K * can.channel(c[0], c[1], 0) / 100; if (v < 0.02) return 0; }
    }
    if (can && shrub) { const c = can.cellOf(tx, -tz); v *= 1 - SHRUB_K * can.channel(c[0], c[1], 1) / 100; }
    return v;
  }
  entry(a) {
    let e = this.track.get(a.id);
    if (!e) this.track.set(a.id, e = { a, x: a.x, z: a.z, v: 0, vis: 0, visMe: 0, testT: Math.random() * TEST_T, spotUntil: -1, seesUntil: -1, at: this.t });
    return e;
  }
  // hunt.js: the player has this animal in sight now; it has the player
  spotted(a) { const e = a && this.track.get(a.id); return !!e && e.a === a && e.spotUntil > this.t; }
  seesMe(a) { const e = a && this.track.get(a.id); return !!e && e.a === a && e.seesUntil > this.t; }
  mesh(k) {
    let m = this.meshes.get(k); if (m) return m;
    const A = this.animals, st = A.drawn?.[k], drawn = A.meshOn(k) && st?.tiers?.[0];
    const src = drawn ? st.tiers[0] : A.meshes[k], model = drawn ? st.model : A.speciesList()[k].model;
    if (!src?.geometry || !model) return null;
    const geo = src.geometry.clone();
    for (const name of ['aAnim', 'aAnim2', 'aClip', 'aBend']) if (geo.attributes[name]) { const a = new THREE.InstancedBufferAttribute(new Float32Array(SPOT_CAP * 4), 4); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); }
    const mat = animalSilhouetteMaterial(model, { soul: rarityColor(A.rarity[k]), fade: new THREE.Vector2(1e8, 1e9), gain: SPOT_GAIN });
    // the silhouette's twin: the depth test the normal way (the visible surface only), the intensity from m[0][3]
    const from = 'vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(transformed, 1.0);';
    if (!mat.vertexShader.includes(from)) { console.warn('sight: the silhouette shader changed; no highlight for', A.speciesList()[k].one); mat.dispose(); return null; }
    mat.vertexShader = mat.vertexShader.replace('varying float vSilD;', 'varying float vSilD; varying float vSpot;')
      .replace(from, 'mat4 im = instanceMatrix; vSpot = im[0][3]; im[0][3] = 0.0;\n  vec4 mv = viewMatrix * modelMatrix * im * vec4(transformed, 1.0);');
    mat.fragmentShader = `uniform vec3 uSoul; varying float vSpot;
void main() { gl_FragColor = vec4(uSoul * (vSpot * ${SPOT_GAIN.toFixed(2)}), 1.0); }`;
    mat.depthFunc = THREE.LessEqualDepth; mat.polygonOffsetFactor = -4; mat.polygonOffsetUnits = -8;
    m = new THREE.InstancedMesh(geo, mat, SPOT_CAP); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false; m.renderOrder = 11; m.name = `${A.speciesList()[k].one} in sight`;
    this.group.add(m); this.meshes.set(k, m);
    return m;
  }
  update(dt) {
    const t0 = performance.now(), A = this.animals, f = this.flight, P = f.pos, cam = this.camera;
    if (A.observer !== this.code) this.setSpecies(A.observer);
    this.t += dt; const t = this.t;
    if (!this.prey.size && !this.hunters.size) { this.draw(); return; }
    this.indexTrees();
    const E = cam.position, inv = cam.matrixWorldInverse, me = P.y + (this.ground?.on && this.ground.S?.shoulder ? this.ground.S.shoulder * (this.ground.size || 1) : EYE), v = this.v;
    for (const a of A.list) {
      if (a.gone || a.dead || a.culled || a.sp === undefined || !this.relevant(a.sp) || !A.meshes[a.sp]?.visible || !(a.vis > 0.3)) continue;
      const dx = a.x - P.x, dz = a.z - P.z, d = Math.hypot(dx, dz), range = this.range[a.sp];
      const e = this.entry(a); e.a = a; e.at = t;
      // its speed, from where it was last frame (the species keep their speeds in their own fields)
      const mv = Math.hypot(a.x - e.x, a.z - e.z) / Math.max(dt, 1e-3); e.x = a.x; e.z = a.z;
      e.v += (Math.min(mv, 20) - e.v) * Math.min(1, dt * 4);
      const ty = A.scentHeight(a) + (a.air ? 0 : BODY_UP * (a.size || 1));   // its body's centre (the scent's height is its feet for most)
      // in the camera's view: in front and inside the frame (a little margin)
      v.set(a.x, ty, a.z).applyMatrix4(inv); const ahead = v.z < 0; let inView = false;
      if (ahead) { v.set(a.x, ty, a.z).project(cam); inView = Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05; }
      e.testT -= dt;
      if (e.testT <= 0) {   // the visibility, each way, a few times a second
        e.testT = TEST_T; this.tests++;
        e.vis = inView && d < range ? this.visibility(E.x, E.y, E.z, a.x, ty, a.z, !a.air) : 0;
        const n = A.noticeAt(a.sp, a.x, a.z, P.x, P.z);
        e.visMe = d < n * 1.5 ? this.visibility(a.x, ty + EYE_UP * (a.size || 1), a.z, P.x, me, P.z, true) : 0;   // from its eye to the player's body
        e.n = n;
      }
      // the player spots it: the chance per second, rolled over this frame
      if (e.vis > 0 && inView && d < range) {
        const motion = A.fled?.(a) ? BOLT : e.v < SPEEDS[0] ? STILL : e.v < SPEEDS[1] ? WALK : e.v < SPEEDS[2] ? TROT : BOLT;
        const p = RATE * Math.pow(Math.max(0, 1 - d / range), RANGE_POW) * motion * e.vis;
        if (Math.random() < 1 - Math.exp(-p * dt)) e.spotUntil = t + HOLD;
      }
      // it spots the player: as its AI judges the threat (noticeAt), its eyes and ears only through what it can see
      if (e.n > 0 && d > 1e-3) {
        const sight = (A.noticeSight?.[a.sp] ?? A.notice?.[a.sp] ?? 0) * (A.stalkK ?? 1), smell = e.n > sight ? e.n : 0;
        const r = Math.max(sight * e.visMe, smell) / d, p = r > SEES_FROM ? (r - SEES_FROM) * SEES_K : 0;
        if (p > 0 && Math.random() < 1 - Math.exp(-p * dt)) e.seesUntil = t + HOLD;
      }
    }
    this.pruneT -= dt;
    if (this.pruneT <= 0) { this.pruneT = 2; for (const [id, e] of this.track) if (t - e.at > 2) this.track.delete(id); }
    this.draw();
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  // the spotted bodies into the highlight meshes, the intensity in the matrix's element [3]
  draw() {
    const A = this.animals, t = this.t, counts = new Map();
    for (const e of this.track.values()) {
      const a = e.a, held = Math.max(e.spotUntil, e.seesUntil) - t; if (held <= 0 || a.gone || a.culled || a.slot < 0) continue;
      const k = a.sp, m = this.mesh(k); if (!m) continue;
      const n = counts.get(k) || 0; if (n >= SPOT_CAP) continue;
      let i = Math.min(1, held / FADE_T);
      if (e.seesUntil > t) i *= 0.65 + 0.35 * Math.sin(t * TAU * PULSE_HZ);   // it sees you: a throb
      const arr = m.instanceMatrix.array, src = A.meshes[k].instanceMatrix.array;
      arr.set(src.subarray(a.slot * 16, a.slot * 16 + 16), n * 16); arr[n * 16 + 3] = i;
      const srcAnim = A.meshes[k].geometry.attributes.aAnim, anim = m.geometry.attributes.aAnim;
      if (anim && srcAnim) anim.array.set(srcAnim.array.subarray(a.slot * 4, a.slot * 4 + 4), n * 4);
      const anim2 = m.geometry.attributes.aAnim2, src2 = A.anim2?.[k]; if (anim2 && src2) anim2.array.set(src2.subarray(a.slot * 4, a.slot * 4 + 4), n * 4);
      const clip = m.geometry.attributes.aClip, srcC = A.clip?.[k]; if (clip && srcC) clip.array.set(srcC.subarray(a.slot * 4, a.slot * 4 + 4), n * 4);
      const bend = m.geometry.attributes.aBend, srcB = A.bend?.[k]; if (bend && srcB) bend.array.set(srcB.subarray(a.slot * 4, a.slot * 4 + 4), n * 4);
      counts.set(k, n + 1);
    }
    for (const [k, m] of this.meshes) {
      const n = counts.get(k) || 0; m.count = n; m.visible = n > 0;
      if (n) { m.instanceMatrix.needsUpdate = true; for (const name of ['aAnim', 'aAnim2', 'aClip', 'aBend']) if (m.geometry.attributes[name]) m.geometry.attributes[name].needsUpdate = true; }
    }
  }
  // debugging: who is held now
  held() { return [...this.track.values()].filter(e => Math.max(e.spotUntil, e.seesUntil) > this.t).map(e => ({ id: e.a.id, sp: this.animals.speciesList()[e.a.sp].one, spotted: e.spotUntil > this.t, seesMe: e.seesUntil > this.t, vis: +e.vis.toFixed(2), visMe: +e.visMe.toFixed(2), v: +e.v.toFixed(2) })); }
  clear() { if (this.track.size) this.track.clear(); for (const m of this.meshes.values()) if (m.count) { m.count = 0; m.visible = false; } }
  dispose() {
    this.group.removeFromParent();
    for (const m of this.meshes.values()) { m.geometry.dispose(); m.material.dispose(); }
    this.meshes.clear(); this.track.clear();
  }
}
