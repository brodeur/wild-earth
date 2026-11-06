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
// it the camera can see (visibility(), 0..1: the terrain between, every near tree's crown as an ellipsoid (its drawn
// half-width across, its top at the tree's top; 2026-11-06, was a sphere a third of the height across, which let a
// Serengeti sausage tree's 11 m umbrella hide nothing) and its trunk as a cylinder (vegetation.js nearPlants, inside NEAR_R of the eye), the canopy raster's tree cover beyond that
// where the line runs under the stand's top (a flier's line passing high over a wood far off is not dimmed by it), and the
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
//
// A predator's eyes (owner, 2026-11-06: "predators should be able to see prey from very far away. When a user spots prey
// they must be actually visible line of sight to the camera. When they are line of sight they become highlighted in the
// species highlight color."). For the species the player's species hunts (animals.js preySlots, from games.json
// relations.predation) the roll above gives way to the line itself: a prey animal in the camera's view, within the
// player's vision of it (perception.json senses[player].vision, capped at QUARRY_R; not the prey's own sight signature,
// which is how near a watcher must be to notice it, not how far a hawk's eye reaches), is lit while its visibility is
// over SEEN_VIS and for PREY_HOLD s after, so the highlight follows the line of sight and goes when a ridge, a crown or
// the canopy closes it. animals.js keeps the hunted species alive and drawn out to its eye radius (setObserver: EYE_R)
// in place of their near cull. Far off a body is under a pixel, so a lit prey animal is also marked by a dot of its
// colour that keeps a few pixels on the screen (the marks: one Points draw, faded in past MARK_NEAR m). The tests are
// cheap and staggered: a heightfield march, the near trees through a grid of GRID m cells walked along the line (each
// cell once), the canopy raster beyond NEAR_R; each animal at most every TEST_T s and at most TEST_BUDGET tests a frame.
// The quarry the player has selected (quarry.js: Tab or a click) is tested every FOCUS_T s whether or not it is in the
// frame: losOf(a) is its line from the camera, which the dive (dive.js) is cancelled on.
const HOLD = 5, FADE_T = 1.0, PULSE_HZ = 1.6, SPOT_CAP = 32, SPOT_GAIN = 0.42;   // the gain: at 0.7 a lit deer was a flat cutout; at 0.42 its shading shows through the wash
const RATE = 3, RANGE_POW = 1.5;                        // per second at the eye; the fall with distance
const STILL = 0.3, WALK = 0.7, TROT = 1.5, BOLT = 4;    // the motion factor by the body's speed (SPEEDS): a lion standing 18 m off in the open is spotted about every 2 s, a bolting deer at once
const SPEEDS = [0.25, 1.6, 3.5];                        // m/s: still under, walk under, trot under, else a bolt
const SEES_K = 2.0, SEES_FROM = 0.8;                    // it sees you: per second per unit of (its notice / distance) over SEES_FROM
const TEST_T = 0.25, STEP = 4, MARCH_MAX = 60;          // s between visibility tests per animal; the terrain march step and its cap
const NEAR_R = 180;                                     // vegetation.js NEAR_R: inside it every tree is explicit
const CROWN_R = 0.33, CROWN_DEEP = 0.4, CROWN_K = 0.9;  // a crown: its drawn half-width (CROWN_R of the height where the plant has none), no deeper than CROWN_DEEP of the height; a chord through the middle hides CROWN_K
const SHRUB_H = 6, SHRUB_UP = 0.5, SHRUB_R = 0.45;       // a plant under SHRUB_H m is a shrub: foliage to the ground (a sphere at half its height, nearly as wide as tall), no trunk
const TRUNK_R = 0.025, TRUNK_R0 = 0.08, TRUNK_K = 0.35; // a trunk: a cylinder up to the crown's centre, hiding TRUNK_K
const COVER_K = 0.6, SHRUB_K = 0.6, CANOPY_H = 15;      // beyond NEAR_R: tree cover per raster cell (where the line runs under the stand's top: CANOPY_H m without a measured one); the shrub cover where the body stands
const DEFAULT_RANGE = 200, EYE = 0.6, BODY_UP = 0.6, EYE_UP = 0.4;   // m: a tile without senses; the player's body over its feet (its shoulder when the walker says); an animal's body centre over its feet (times its size), and its eye over that
const GROUND_TOL = 0.15;                                // m: the ground may rise this far over the line of sight (the micro-relief under two low bodies) before it hides
const QUARRY_R = 600, SEEN_VIS = 0.3, PREY_HOLD = 0.5, PREY_FADE = 0.3;   // a predator's prey: its reach (m), the visibility that lights it, held this long after the line closes, faded over the last of it
const TEST_BUDGET = 24, FOCUS_T = 0.1, GRID = 20;       // visibility tests a frame; the selected quarry's test interval; the near trees' grid cell (m)
const MARK_PX = 13, MARK_CAP = 96, MARK_NEAR = 18, MARK_FULL = 45;   // the far marks: their size on the screen (CSS px), how many, faded in from MARK_NEAR m to MARK_FULL m from the eye
const TAU = Math.PI * 2;

export class Sight {
  constructor({ tile, animals, flight, veg, scene, camera, ground = null }) {
    Object.assign(this, { tile, animals, flight, veg, camera, ground });
    this.group = new THREE.Group(); this.group.name = 'sight highlights'; scene.add(this.group);
    this.meshes = new Map(); this.track = new Map(); this.t = 0; this.code = null; this.k = -1;
    this.prey = null; this.hunters = null; this.range = null;
    this.trees = { x: new Float32Array(0), y: new Float32Array(0), z: new Float32Array(0), h: new Float32Array(0), r: new Float32Array(0), rv: new Float32Array(0), tr: new Float32Array(0), n: 0, version: -1,
      x0: 0, z0: 0, nx: 0, nz: 0, start: new Int32Array(1), idx: new Int32Array(0), stamp: new Uint32Array(0), mark: 0, rmax: 0 };
    this.v = new THREE.Vector3(); this.pruneT = 0; this.ms = 0; this.tests = 0; this.budget = 0; this.focus = null; this.hunts = false;
    this.marks = this.makeMarks(); this.group.add(this.marks.points); this._c = new THREE.Color();
  }
  // the far marks: a dot per lit prey animal in its species' colour, a few pixels across at any distance (see the header)
  makeMarks() {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(MARK_CAP * 3), col = new Float32Array(MARK_CAP * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: MARK_PX * Math.min(2, window.devicePixelRatio || 1) } },
      vertexShader: `attribute vec4 aCol; uniform float uPx; varying vec4 vCol;
void main() { vCol = aCol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uPx; }`,
      fragmentShader: `varying vec4 vCol;
void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p);
  float a = smoothstep(1.0, 0.5, r) * 0.55 + smoothstep(0.42, 0.0, r) * 0.75; if (a < 0.01) discard;
  gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0); }`,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const points = new THREE.Points(geo, mat); points.frustumCulled = false; points.renderOrder = 12; points.name = 'prey in sight, far';
    return { points, geo, pos, col };
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
    // a predator's prey: as far as its eyes reach, the line of sight deciding (see the header)
    this.hunts = this.prey.size > 0;
    const far = Math.min(QUARRY_R, typeof sen?.vision === 'number' && sen.vision > 0 ? sen.vision : QUARRY_R);
    for (const k of this.prey) this.range[k] = Math.max(this.range[k], far);
    this.track.clear(); this.focus = null;
    for (const m of this.meshes.values()) m.count = 0;
  }
  relevant(sp) { return this.prey.has(sp) || this.hunters.has(sp); }
  // the near trees as arrays (vegetation.js nearPlants: each plant's foot, height, drawn crown half-width and bole
  // radius), rebuilt when that set changes
  indexTrees() {
    const V = this.veg, T = this.trees, P = V?.nearPlants; if (!P || T.version === V.nearVersion) return;
    T.version = V.nearVersion;
    const n = P.length;
    if (T.x.length < n) { for (const k of ['x', 'y', 'z', 'h', 'r', 'rv', 'tr']) T[k] = new Float32Array(n); }
    let i = 0;
    for (const q of P) {
      const h = q.height; if (!(h > 0.5)) continue;
      const shrub = h < SHRUB_H, r = q.crownR > 0 ? q.crownR : (shrub ? SHRUB_R : CROWN_R) * h;
      T.x[i] = q.x; T.y[i] = q.y; T.z[i] = q.z; T.h[i] = h; T.r[i] = r;
      T.rv[i] = shrub ? h * SHRUB_UP : Math.min(r, h * CROWN_DEEP);   // the crown's half-depth: a shrub's foliage to the ground; a tree's no deeper than CROWN_DEEP of its height
      T.tr[i] = q.trunkR > 0 ? q.trunkR : TRUNK_R * h; i++;
    }
    T.n = i;
    // the grid (GRID m cells, counting sort): visibility() walks the cells along its line, each once
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, rmax = 0;
    for (let j = 0; j < i; j++) { const x = T.x[j], z = T.z[j]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (T.r[j] > rmax) rmax = T.r[j]; }
    if (!i) { T.nx = T.nz = 0; return; }
    T.x0 = x0; T.z0 = z0; T.nx = Math.floor((x1 - x0) / GRID) + 1; T.nz = Math.floor((z1 - z0) / GRID) + 1; T.rmax = rmax;
    const nc = T.nx * T.nz; if (T.start.length < nc + 1) { T.start = new Int32Array(nc + 1); T.stamp = new Uint32Array(nc); T.mark = 0; }
    if (T.idx.length < i) T.idx = new Int32Array(T.x.length);
    const S = T.start; S.fill(0, 0, nc + 1);
    const cellOf = j => Math.floor((T.z[j] - z0) / GRID) * T.nx + Math.floor((T.x[j] - x0) / GRID);
    for (let j = 0; j < i; j++) S[cellOf(j) + 1]++;
    for (let c = 0; c < nc; c++) S[c + 1] += S[c];
    const fill = S.slice(0, nc);
    for (let j = 0; j < i; j++) T.idx[fill[cellOf(j)]++] = j;
  }
  // the stand's height at (x, z), m: the lidar canopy's p95 (tile.canopyHeight R x 0.25 m), else the measured stand top
  // (tile.canopyTop R x 0.5 m), else CANOPY_H
  canopyTop(x, z) {
    const ch = this.tile.canopyHeight, ct = this.tile.canopyTop;
    if (ch) { const h = ch.at(x, -z, 0) * 0.25; if (h > 0) return h; }
    if (ct) { const h = ct.at(x, -z, 0) * 0.5; if (h > 0) return h; }
    return CANOPY_H;
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
    const T = this.trees, L2 = dx * dx + dz * dz;
    // the near trees, cell by cell along the line seen from above (the cells within the widest crown of it), each cell once
    if (T.n && T.nx) {
      const mk = ++T.mark, reach = Math.ceil(T.rmax / GRID), Lh = Math.sqrt(L2), n = Math.max(1, Math.ceil(Lh / (GRID * 0.5)));
      for (let q = 0; q <= n; q++) {
        const u = q / n, gx = Math.floor((ex + dx * u - T.x0) / GRID), gz = Math.floor((ez + dz * u - T.z0) / GRID);
        for (let cz = gz - reach; cz <= gz + reach; cz++) {
          if (cz < 0 || cz >= T.nz) continue;
          for (let cx = gx - reach; cx <= gx + reach; cx++) {
            if (cx < 0 || cx >= T.nx) continue;
            const c = cz * T.nx + cx; if (T.stamp[c] === mk) continue; T.stamp[c] = mk;
            for (let p = T.start[c], pe = T.start[c + 1]; p < pe; p++) {
              const i = T.idx[p], h = T.h[i], R = T.r[i], Rv = T.rv[i], shrub = h < SHRUB_H, bx = T.x[i], by = T.y[i], bz = T.z[i], cy = by + h - Rv;
              // the crown: an ellipsoid (R across, Rv deep, its top at the tree's top), as a sphere of radius R with the
              // heights stretched by R / Rv; the chord of the segment through it
              const k = R / Rv, sdy = dy * k, Ls = Math.sqrt(L2 + sdy * sdy), vx = bx - ex, vy = (cy - ey) * k, vz = bz - ez;
              const t = (vx * dx + vy * sdy + vz * dz) / Ls;
              if (t > -R && t < Ls + R) {
                const tc = (t < 0 ? 0 : t > Ls ? Ls : t) / Ls, m2 = (vx - dx * tc) ** 2 + (vy - sdy * tc) ** 2 + (vz - dz * tc) ** 2;
                if (m2 < R * R) { const chord = 2 * Math.sqrt(R * R - m2); v *= 1 - CROWN_K * Math.min(1, chord / (1.2 * R)); }
              }
              // the trunk: the segment's closest approach to its axis, seen from above, at a height under the crown's middle
              if (!shrub && L2 > 1e-6) {
                let s = ((bx - ex) * dx + (bz - ez) * dz) / L2; s = s < 0 ? 0 : s > 1 ? 1 : s;
                const px = ex + dx * s - bx, pz = ez + dz * s - bz, rt = T.tr[i] * 1.3 + TRUNK_R0;
                if (px * px + pz * pz < rt * rt) { const hy = ey + dy * s; if (hy > by && hy < cy) v *= TRUNK_K; }
              }
              if (v < 0.02) return 0;
            }
          }
        }
      }
    }
    // beyond the near set the canopy raster stands in for the trees: its tree cover, cell by cell along the way
    const can = this.tile.canopy;
    if (can && L > NEAR_R) {
      const res = Math.max(can.res || 10, 10);
      for (let t = NEAR_R; t < L - 1; t += res) {
        const u = t / L, x = ex + dx * u, z = ez + dz * u;
        if (ey + dy * u - hts.atXZ(x, z) > this.canopyTop(x, z)) continue;   // the line passes over the stand there (a flier's line to the ground far off)
        const c = can.cellOf(x, -z); v *= 1 - COVER_K * can.channel(c[0], c[1], 0) / 100; if (v < 0.02) return 0;
      }
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
    const list = A.list, N = list.length, r0 = N ? (this.rot || 0) % N : 0; this.budget = TEST_BUDGET;
    if (this.focus && (this.focus.gone || this.focus.dead || !A.alive?.(this.focus))) this.focus = null;
    for (let q = 0; q < N; q++) {   // from where the budget ran out last frame, so every animal gets its turn
      const a = list[(r0 + q) % N];
      if (a.gone || a.dead || a.culled || a.sp === undefined || !this.relevant(a.sp) || !A.meshes[a.sp]?.visible || !(a.vis > 0.3)) continue;
      const dx = a.x - P.x, dz = a.z - P.z, d = Math.hypot(dx, dz), range = this.range[a.sp], quarry = this.prey.has(a.sp), focus = a === this.focus;
      const e = this.entry(a); e.a = a; e.at = t;
      // its speed, from where it was last frame (the species keep their speeds in their own fields)
      const mv = Math.hypot(a.x - e.x, a.z - e.z) / Math.max(dt, 1e-3); e.x = a.x; e.z = a.z;
      e.v += (Math.min(mv, 20) - e.v) * Math.min(1, dt * 4);
      const ty = A.scentHeight(a) + (a.air ? 0 : BODY_UP * (a.size || 1));   // its body's centre (the scent's height is its feet for most)
      // in the camera's view: in front and inside the frame (a little margin)
      v.set(a.x, ty, a.z).applyMatrix4(inv); const ahead = v.z < 0; let inView = false;
      if (ahead) { v.set(a.x, ty, a.z).project(cam); inView = Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05; e.sx = v.x; e.sy = v.y; }
      e.inView = inView; e.ty = ty; e.d = d;
      e.testT -= dt;
      if (e.testT <= 0 && (this.budget > 0 || focus)) {   // the visibility, each way, a few times a second (the selected quarry more often, and in or out of the frame)
        e.testT = focus ? FOCUS_T : TEST_T; this.tests++; this.budget--;
        if (this.budget <= 0 && !focus) this.rot = (r0 + q + 1) % N;
        e.los = (inView || focus) && d < range ? this.visibility(E.x, E.y, E.z, a.x, ty, a.z, !a.air) : 0;
        e.vis = inView ? e.los : 0;
        const n = A.noticeAt(a.sp, a.x, a.z, P.x, P.z);
        e.visMe = d < n * 1.5 ? this.visibility(a.x, ty + EYE_UP * (a.size || 1), a.z, P.x, me, P.z, true) : 0;   // from its eye to the player's body
        e.n = n;
      }
      if (!inView) e.vis = 0;
      if (quarry) {   // a predator's prey: lit while the line is open (see the header)
        if (e.vis >= SEEN_VIS && d < range) e.spotUntil = t + PREY_HOLD;
      } else if (e.vis > 0 && inView && d < range) {   // the player spots it: the chance per second, rolled over this frame
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
    const A = this.animals, t = this.t, counts = new Map(), M = this.marks, E = this.camera.position; let nm = 0;
    for (const e of this.track.values()) {
      const a = e.a, held = Math.max(e.spotUntil, e.seesUntil) - t; if (held <= 0 || a.gone || a.culled || a.slot < 0) continue;
      const k = a.sp, quarry = this.prey.has(k);
      let i = Math.min(1, held / (quarry && e.seesUntil <= t ? PREY_FADE : FADE_T));
      if (quarry && nm < MARK_CAP && e.ty !== undefined) {   // the far mark: a dot of its colour (see the header)
        const dd = Math.hypot(a.x - E.x, e.ty - E.y, a.z - E.z), w = Math.min(1, Math.max(0, (dd - MARK_NEAR) / (MARK_FULL - MARK_NEAR)));
        if (w > 0) {
          M.pos[nm * 3] = a.x; M.pos[nm * 3 + 1] = e.ty; M.pos[nm * 3 + 2] = a.z;
          const c = rarityColor(A.rarity[k], this._c); M.col[nm * 4] = c.r; M.col[nm * 4 + 1] = c.g; M.col[nm * 4 + 2] = c.b; M.col[nm * 4 + 3] = i * w * (a === this.focus ? 1.4 : 1); nm++;
        }
      }
      const m = this.mesh(k); if (!m) continue;
      const n = counts.get(k) || 0; if (n >= SPOT_CAP) continue;
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
    M.geo.setDrawRange(0, nm); M.points.visible = nm > 0;
    if (nm) { M.geo.attributes.position.needsUpdate = true; M.geo.attributes.aCol.needsUpdate = true; }
    for (const [k, m] of this.meshes) {
      const n = counts.get(k) || 0; m.count = n; m.visible = n > 0;
      if (n) { m.instanceMatrix.needsUpdate = true; for (const name of ['aAnim', 'aAnim2', 'aClip', 'aBend']) if (m.geometry.attributes[name]) m.geometry.attributes[name].needsUpdate = true; }
    }
  }
  // quarry.js and dive.js: the player's prey lit now (in sight); its line from the camera (0..1: the selected quarry's
  // is tested in or out of the frame); every prey animal lit now with its place on the screen (NDC sx, sy) and distance
  inSight(a) { const e = a && this.track.get(a.id); return !!e && e.a === a && this.prey.has(a.sp) && e.spotUntil > this.t; }
  losOf(a) { const e = a && this.track.get(a.id); return e && e.a === a ? e.los ?? 0 : 0; }
  litPrey() { const out = []; for (const e of this.track.values()) if (e.spotUntil > this.t && this.prey.has(e.a.sp) && !e.a.dead && !e.a.gone && e.inView) out.push(e); return out; }
  // debugging: who is held now
  held() { return [...this.track.values()].filter(e => Math.max(e.spotUntil, e.seesUntil) > this.t).map(e => ({ id: e.a.id, sp: this.animals.speciesList()[e.a.sp].one, spotted: e.spotUntil > this.t, seesMe: e.seesUntil > this.t, vis: +e.vis.toFixed(2), visMe: +e.visMe.toFixed(2), v: +e.v.toFixed(2) })); }
  clear() { if (this.track.size) this.track.clear(); for (const m of this.meshes.values()) if (m.count) { m.count = 0; m.visible = false; } this.marks.points.visible = false; this.marks.geo.setDrawRange(0, 0); }
  dispose() {
    this.group.removeFromParent();
    for (const m of this.meshes.values()) { m.geometry.dispose(); m.material.dispose(); }
    this.marks.geo.dispose(); this.marks.points.material.dispose();
    this.meshes.clear(); this.track.clear();
  }
}
