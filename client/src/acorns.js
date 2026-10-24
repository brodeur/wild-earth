import * as THREE from 'three';
import { mulberry32 } from './trees.js';
import { fieldGuide, acornSpecies, ACORNS } from './fieldguide.js';

// Acorn stash, the raven's fall forage-and-cache loop (docs/game-acorn-stash.md).
// Living oaks past the sapling stage near the raven carry acorns and, about one in eight, a stash hole on the trunk. Everything
// about an oak (acorn count and places, whether it has a hole, its capacity and height) is derived
// from a hash of the tree's stable id, so every player finds the same acorns in the same trees.
// Only oaks within LIVE_R of the raven get objects. Glows are billboards whose intensity is
// computed in the vertex shader from the distance to the camera: no per-frame CPU work for them.

const LIVE_R = 300;            // m: oaks within this get acorn and stash objects
const REFRESH_S = 0.5;         // s between live-set checks
const REFRESH_MOVE = 10;       // m the raven must move (or the forest rebuild) before the live set is rebuilt
const ACORN_CAP = 6000, STASH_CAP = 1000;
const PICK_R = 6, DEPOSIT_R = 6, CARRY_MAX = 3, DEPOSIT_BEAT = 0.6;
const STASH_ODDS = 1 / 8;

// FNV-1a over a string, then a salt mix: a 32-bit seed for mulberry32.
function seedOf(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Acorns per oak from the fall mast score (0..100) and the season. Spring and summer: at most one,
// present with probability score/100 (the design says "one at most"; this keeps it tied to the data).
export function acornCount(mast, season, r) {
  const fall = 1 + Math.round(mast / 25);
  if (season === 'fall') return fall;
  if (season === 'winter') return Math.round(fall / 2);
  return r < mast / 100 ? 1 : 0;
}

// Everything deterministic about one oak. `oak` is a record from Vegetation.oaks.
// A snag (dead) drops no acorns and a sapling bears none; neither gets a stash hole. Every other oak
// keeps its own hashed streams, so the same mature and veteran trees carry the same acorns and holes.
export const bearsAcorns = oak => !oak.snag && oak.cls !== 'sapling';
export function oakInfo(oak, mast, season, heights) {
  if (!bearsAcorns(oak)) return { acorns: [], stash: null };
  const s = oak.scale;
  const rnd = mulberry32(seedOf(oak.id, 0xacc0));
  const count = acornCount(mast, season, rnd());
  const acorns = [];
  for (let n = 0; n < count; n++) {
    const inBranches = rnd() < 0.35, a = rnd() * Math.PI * 2, u = rnd(), v = rnd(), spin = rnd();
    let r, x, z, y;
    if (inBranches) {   // lower branches: 1.2..2.5 m up, out from the trunk
      r = (0.6 + u * 1.6) * s; x = oak.x + Math.cos(a) * r; z = oak.z + Math.sin(a) * r;
      y = heights.atXZ(x, z) + 1.2 + v * 1.3;
    } else {            // on the ground under the canopy
      r = Math.sqrt(u) * 3.5 * s; x = oak.x + Math.cos(a) * r; z = oak.z + Math.sin(a) * r;
      y = heights.atXZ(x, z) + 0.22;
    }
    acorns.push({ n, x, y, z, spin });
  }
  // Stash hole: drawn from its own stream so it never depends on the acorn count (which changes with season).
  const rs = mulberry32(seedOf(oak.id, 0x57a5));
  let stash = null;
  if (rs() < STASH_ODDS) {
    const capacity = 3 + Math.floor(rs() * 6);          // 3..8
    let h = 1.5 + rs() * 1.5;                           // 1.5..3.0 m above the ground
    const facing = rs() * Math.PI * 2;                   // world angle of the hole's outward normal
    stash = { capacity, facing, ...trunkPoint(oak, h) };
  }
  return { acorns, stash };
}

// A point on the trunk surface at height h above the ground, facing `facing` (set by the caller),
// following the variant's lean. Trunk geometry: limb along +y from the base, rotateZ(lean), rotateY(leanDir);
// the instance adds rotateY(rot), uniform scale and a base 0.3 m below the ground.
const _p = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
function trunkPoint(oak, h) {
  const st = oak.stem, s = oak.scale;
  const topY = s * st.len * Math.cos(st.lean) - 0.3;   // trunk top above the ground
  h = Math.min(h, topY * 0.85);                          // keep the hole on the trunk, below the fork
  const t = (h + 0.3) / (s * Math.cos(st.lean));         // distance along the trunk axis (geometry space)
  _p.set(0, t, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), st.lean).applyAxisAngle(new THREE.Vector3(0, 1, 0), st.leanDir)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), oak.rot).multiplyScalar(s);
  const radius = s * (st.r0 + (st.r1 - st.r0) * Math.min(1, t / st.len));
  return { ax: oak.x + _p.x, ay: oak.y - 0.3 + _p.y, az: oak.z + _p.z, trunkR: radius, h };
}

// Billboard glow: camera-facing quad, size and intensity from the distance to the camera, in the vertex shader.
function glowMaterial({ color, near, far, sizeNear, sizeFar, ring = false }) {
  return new THREE.ShaderMaterial({
    defines: ring ? { RING: 1 } : {},
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uNear: { value: near }, uFar: { value: far },
      uSizeNear: { value: sizeNear }, uSizeFar: { value: sizeFar }, uVisible: { value: 1 },
    },
    vertexShader: /* glsl */`
      attribute float aFull;
      uniform float uNear, uFar, uSizeNear, uSizeFar, uVisible;
      varying vec2 vUv; varying float vI;
      void main() {
        vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float d = distance(c.xyz, cameraPosition);
        float t = smoothstep(uNear, uFar, d);
        vI = (1.0 - t) * uVisible * (1.0 - aFull);
        vec4 mv = viewMatrix * c;
        mv.xyz += normalize(-mv.xyz) * min(0.6, d * 0.3);   // nudge toward the eye so ground and bark do not clip it
        mv.xy += position.xy * mix(uSizeNear, uSizeFar, t);
        vUv = position.xy;
        gl_Position = vI > 0.001 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);   // off: outside the clip volume
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying vec2 vUv; varying float vI;
      void main() {
        float r = length(vUv);
        #ifdef RING
          float a = exp(-pow((r - 0.55) / 0.16, 2.0)) + 0.2 * (1.0 - smoothstep(0.0, 1.0, r));
        #else
          float a = pow(max(0.0, 1.0 - r), 1.6) * 0.95 + 0.35 * exp(-r * r * 30.0);   // wide warm halo, small hot core
        #endif
        a *= vI * smoothstep(1.0, 0.85, r);
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function quad(cap) {
  const g = new THREE.PlaneGeometry(2, 2);   // -1..1
  g.setAttribute('aFull', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
  return g;
}

function acornGeometry() {
  const g = new THREE.IcosahedronGeometry(0.35, 1).toNonIndexed();
  g.scale(0.85, 1.2, 0.85);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const body = new THREE.Color(0x6b4a2b), cap = new THREE.Color(0x8a7a5a);   // brown nut, paler scaly cap
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getY(i) > 0.16 ? cap : body;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class AcornGame {
  constructor(tile, scene, flight, veg, ui) {
    this.tile = tile; this.scene = scene; this.flight = flight; this.veg = veg; this.ui = ui;
    this.running = false; this.season = null; this.elapsed = 0;
    this.carried = 0; this.depositT = 0; this.hudT = 0; this.refreshT = 0; this.nearFull = false;
    this.state = { picked: new Set(), stashes: {}, totals: { stashed: 0 }, species: [] };   // species: acorn kinds found in this world
    this.revealed = false;          // stash holes visible: first pickup this session, or the world already has stash contents
    this.cache = new Map();         // oak id -> oakInfo for the current season
    this.liveAcorns = [];           // { key, x, y, z }, index-aligned with the acorn instances
    this.liveStashes = [];          // { id, info, x, y, z } index-aligned with the stash instances
    this.labels = new Map();        // oak id -> Sprite
    this.markers = new Map();       // oak id -> screen-constant glowing acorn above a full stash's tree
    this.refCenter = null; this.refVersion = -1; this.dirty = true;

    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    this.nuts = new THREE.InstancedMesh(acornGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), ACORN_CAP);
    this.acornGlow = new THREE.InstancedMesh(quad(ACORN_CAP),
      glowMaterial({ color: 0xffa040, near: 8, far: 110, sizeNear: 1.1, sizeFar: 3.6 }), ACORN_CAP);
    const disc = new THREE.CylinderGeometry(1, 1, 0.12, 14); disc.rotateX(Math.PI / 2);   // unit radius, axis along +z
    this.holes = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0x140d07 }), STASH_CAP);
    this.ringGlow = new THREE.InstancedMesh(quad(STASH_CAP),
      glowMaterial({ color: 0xbfe0ff, near: 6, far: 140, sizeNear: 0.75, sizeFar: 3.4, ring: true }), STASH_CAP);
    for (const m of [this.nuts, this.acornGlow, this.holes, this.ringGlow]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
    this.acornGlow.renderOrder = this.ringGlow.renderOrder = 10;
    this.tmp = new THREE.Object3D();
    this.oakIndex = null; this.oakIndexVersion = -1;
    // Field notes: one HUD row, added here so index.html stays untouched (fieldguide.js holds its CSS).
    fieldGuide.mount();
    if (ui.box && !ui.notes) {
      const row = document.createElement('div'); row.className = 'row fg-notes';
      row.innerHTML = '<span>acorns found</span><b></b>';
      ui.box.insertBefore(row, ui.hint || null); ui.notes = row.querySelector('b');
    }
  }

  get key() { return `wild-earth:stash:${this.tile.id}/${this.season}`; }

  start(season) {
    if (season && season !== this.season) this.setWorld(season);
    this.running = true; this.group.visible = true; this.elapsed = 0; this.dirty = true;
    if (this.ui.box) this.ui.box.classList.remove('hidden');
    this.hud();
  }
  stop() {
    this.running = false; this.group.visible = false;
    if (this.ui.box) this.ui.box.classList.add('hidden');
  }

  // A world is tile + season: switching season saves this one and loads the other.
  setWorld(season) {
    if (this.season) this.save();
    this.season = season; this.cache.clear(); this.carried = 0; this.nearFull = false;
    this.state = { picked: new Set(), stashes: {}, totals: { stashed: 0 }, species: [] };
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        const d = JSON.parse(raw);
        this.state.picked = new Set(d.picked || []);
        this.state.stashes = d.stashes || {};
        this.state.totals = { stashed: 0, ...(d.totals || {}) };
        this.state.species = Array.isArray(d.species) ? d.species.filter(id => ACORNS[id]) : [];
      }
    } catch (e) { console.warn('acorns: could not load state', e); }
    this.revealed = Object.values(this.state.stashes).some(c => c > 0);
    for (const sp of this.labels.values()) { this.group.remove(sp); sp.material.map.dispose(); sp.material.dispose(); }
    this.labels.clear();
    for (const sp of this.markers.values()) { this.group.remove(sp); sp.material.dispose(); }
    this.markers.clear();
    this.dirty = true;
  }
  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ picked: [...this.state.picked], stashes: this.state.stashes, totals: this.state.totals, species: this.state.species }));
    } catch (e) { console.warn('acorns: could not save state', e); }
  }

  info(oak) {
    let v = this.cache.get(oak.id);
    if (!v) {
      if (this.cache.size > 30000) this.cache.clear();
      const mast = this.tile.mast ? this.tile.mast.at(oak.x, -oak.z) : 50;
      v = oakInfo(oak, mast, this.season, this.tile.heights); this.cache.set(oak.id, v);
    }
    return v;
  }

  // Rebuild the live acorn and stash instances from the oaks within LIVE_R of the raven.
  refresh() {
    const p = this.flight.pos, R2 = LIVE_R * LIVE_R;
    this.refCenter = [p.x, p.z]; this.refVersion = this.veg.version; this.dirty = false;
    const near = [];
    for (const o of this.veg.oaks) {
      const dx = o.x - p.x, dz = o.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 < R2) near.push([d2, o]);
    }
    near.sort((a, b) => a[0] - b[0]);   // nearest first, so an overflow drops the far ones
    const t = this.tmp, picked = this.state.picked, fullAttr = this.ringGlow.geometry.attributes.aFull;
    this.liveAcorns = []; this.liveStashes = [];
    let na = 0, ns = 0;
    for (const [, o] of near) {
      const inf = this.info(o);
      for (const a of inf.acorns) {
        const key = `${o.id}:${a.n}`;
        if (na >= ACORN_CAP || picked.has(key)) continue;
        t.position.set(a.x, a.y, a.z); t.rotation.set(0.3 * (a.spin - 0.5), a.spin * 6.283, 1.2 * (a.spin - 0.5)); t.scale.setScalar(1); t.updateMatrix();
        this.nuts.setMatrixAt(na, t.matrix);
        t.rotation.set(0, 0, 0); t.updateMatrix(); this.acornGlow.setMatrixAt(na, t.matrix);
        this.liveAcorns.push({ key, x: a.x, y: a.y, z: a.z, species: o.species }); na++;
      }
      const st = inf.stash;
      if (st && ns < STASH_CAP) {
        const nx = Math.sin(st.facing), nz = Math.cos(st.facing), r = st.trunkR * 0.9;
        const hx = st.ax + nx * r, hz = st.az + nz * r;
        const holeR = Math.min(0.3, st.trunkR * 0.75);
        t.position.set(hx, st.ay, hz); t.rotation.set(0, st.facing, 0); t.scale.set(holeR, holeR * 1.3, 1); t.updateMatrix();
        this.holes.setMatrixAt(ns, t.matrix);
        t.position.set(hx + nx * 0.15, st.ay, hz + nz * 0.15); t.rotation.set(0, 0, 0); t.scale.setScalar(1); t.updateMatrix();
        this.ringGlow.setMatrixAt(ns, t.matrix);
        const count = this.state.stashes[o.id] || 0;
        fullAttr.array[ns] = count >= st.capacity ? 1 : 0;
        const top = (o.y ?? st.ay) + ((o.height || 9) * (o.scale || 1));
        this.liveStashes.push({ id: o.id, info: st, x: hx + nx * 0.3, y: st.ay, z: hz + nz * 0.3, nx, nz, top, tx: st.ax, tz: st.az }); ns++;
      }
    }
    this.nuts.count = this.acornGlow.count = na; this.holes.count = this.ringGlow.count = ns;
    for (const m of [this.nuts, this.acornGlow, this.holes, this.ringGlow]) m.instanceMatrix.needsUpdate = true;
    fullAttr.needsUpdate = true;
    // labels: only for live stashes that hold something
    const live = new Set();
    const fullLive = new Set();
    for (const s of this.liveStashes) if ((this.state.stashes[s.id] || 0) > 0) {
      live.add(s.id); this.label(s);
      if ((this.state.stashes[s.id] || 0) >= s.info.capacity) { fullLive.add(s.id); this.marker(s); }
    }
    for (const [id, sp] of this.labels) sp.visible = live.has(id);
    for (const [id, sp] of this.markers) sp.visible = fullLive.has(id);
    this.applyReveal();
  }

  applyReveal() {
    this.holes.visible = this.revealed;
    this.ringGlow.material.uniforms.uVisible.value = this.revealed ? 1 : 0;
  }

  label(s) {
    const count = this.state.stashes[s.id] || 0, text = `${count} / ${s.info.capacity}`;
    let sp = this.labels.get(s.id);
    if (!sp) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      sp.scale.set(6, 1.5, 1); sp.renderOrder = 20; sp.userData = { canvas, text: null };
      this.labels.set(s.id, sp); this.group.add(sp);
    }
    sp.position.set(s.x + s.nx * 0.4, s.y + 1.4, s.z + s.nz * 0.4); sp.visible = true;
    if (sp.userData.text !== text) {
      const { canvas } = sp.userData, g = canvas.getContext('2d');
      g.clearRect(0, 0, 256, 64);
      g.fillStyle = 'rgba(10,15,12,0.72)'; g.beginPath(); g.roundRect(40, 6, 176, 52, 14); g.fill();
      g.font = '600 36px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = count >= s.info.capacity ? '#bfe0ff' : '#ffd08a'; g.fillText(text, 128, 33);
      sp.material.map.needsUpdate = true; sp.userData.text = text;
    }
  }

  // A glowing acorn icon above the tree of a full stash, constant size on screen so it reads from any distance.
  marker(s) {
    let sp = this.markers.get(s.id);
    if (!sp) {
      if (!AcornGame.markerTexture) AcornGame.markerTexture = makeAcornIcon();
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: AcornGame.markerTexture, transparent: true, depthTest: false, depthWrite: false,
        toneMapped: false, sizeAttenuation: false }));
      sp.scale.set(0.095, 0.095, 1); sp.renderOrder = 21;
      this.markers.set(s.id, sp); this.group.add(sp);
    }
    sp.position.set(s.tx, s.top + 4.5, s.tz); sp.visible = true;
  }

  removeAcorn(i) {
    const last = this.liveAcorns.length - 1, m = new THREE.Matrix4();
    if (i !== last) {
      this.nuts.getMatrixAt(last, m); this.nuts.setMatrixAt(i, m);
      this.acornGlow.getMatrixAt(last, m); this.acornGlow.setMatrixAt(i, m);
      this.liveAcorns[i] = this.liveAcorns[last];
    }
    this.liveAcorns.pop();
    this.nuts.count = this.acornGlow.count = this.liveAcorns.length;
    this.nuts.instanceMatrix.needsUpdate = this.acornGlow.instanceMatrix.needsUpdate = true;
  }

  // ---- lookups for the species card (identify.js) ----------------------------------------------
  // The oak record placed at (x, z) (a clicked trunk's position), or null. Oaks are the trees of the
  // last forest rebuild, so any tree in the near set is among them.
  oakAt(x, z, tol = 0.5) {
    let best = null, bd = tol * tol;
    for (const o of this.veg.oaks) {
      const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = o; }
    }
    return best;
  }
  oakById(id) {
    if (this.oakIndexVersion !== this.veg.version) {
      this.oakIndex = new Map(this.veg.oaks.map(o => [o.id, o])); this.oakIndexVersion = this.veg.version;
    }
    return this.oakIndex.get(id) || null;
  }
  // Acorns on one oak in the current world: { species, total, left, stash: { count, capacity } | null },
  // or null when the game has no world yet or the id is not a placed oak.
  acornsOn(id) {
    const o = this.oakById(id); if (!o || !this.season) return null;
    const inf = this.info(o);
    const left = inf.acorns.filter(a => !this.state.picked.has(`${o.id}:${a.n}`)).length;
    return { species: acornSpecies(o.species), total: inf.acorns.length, left,
      stash: inf.stash ? { count: this.state.stashes[o.id] || 0, capacity: inf.stash.capacity } : null };
  }

  update(dt, camera, season) {
    if (season && season !== this.season) this.setWorld(season);
    if (!this.running) return;
    this.elapsed += dt;
    const p = this.flight.pos;
    this.refreshT += dt;
    let rebuild = this.dirty || this.refVersion !== this.veg.version;
    if (!rebuild && this.refreshT >= REFRESH_S) {
      this.refreshT = 0;
      rebuild = Math.hypot(p.x - this.refCenter[0], p.z - this.refCenter[1]) > REFRESH_MOVE;
    }
    if (rebuild) this.refresh();

    // pickup: the nearest live acorn within PICK_R
    if (this.carried < CARRY_MAX) {
      let best = -1, bd = PICK_R * PICK_R;
      for (let i = 0; i < this.liveAcorns.length; i++) {
        const a = this.liveAcorns[i], dx = a.x - p.x, dy = a.y - p.y, dz = a.z - p.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = i; }
      }
      if (best >= 0) {
        const got = this.liveAcorns[best];
        this.state.picked.add(got.key); this.removeAcorn(best);
        this.carried++;
        const sp = acornSpecies(got.species);
        if (sp && !this.state.species.includes(sp)) this.state.species.push(sp);
        fieldGuide.acornPicked(got.species, this.ui.box);
        if (!this.revealed) { this.revealed = true; this.applyReveal(); }
        this.save(); this.hud(true);
      }
    }
    // deposit: one acorn per beat into a non-full stash within DEPOSIT_R
    let at = null, nearFull = false;
    if (this.carried > 0) {
      let bd = DEPOSIT_R * DEPOSIT_R;
      for (let i = 0; i < this.liveStashes.length; i++) {
        const s = this.liveStashes[i], dx = s.x - p.x, dy = s.y - p.y, dz = s.z - p.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 4 * DEPOSIT_R * DEPOSIT_R) continue;
        if ((this.state.stashes[s.id] || 0) >= s.info.capacity) nearFull = true;   // within 2x range of a full hole: say so
        else if (d2 < bd) { bd = d2; at = i; }
      }
    }
    if (nearFull !== this.nearFull) { this.nearFull = nearFull; this.hud(); }
    this.depositing = at !== null;
    if (at === null) this.depositT = DEPOSIT_BEAT / 2;   // first acorn goes in half a beat after arriving
    else if ((this.depositT -= dt) <= 0) {
      this.depositT = DEPOSIT_BEAT;
      const s = this.liveStashes[at], count = (this.state.stashes[s.id] || 0) + 1;
      this.state.stashes[s.id] = count; this.state.totals.stashed++; this.carried--;
      if (count >= s.info.capacity) {
        const full = this.ringGlow.geometry.attributes.aFull; full.array[at] = 1; full.needsUpdate = true;
        this.marker(s);
      }
      this.label(s); this.save(); this.hud(true);
      fieldGuide.stashFilled(this.ui.box);
    }
    this.hudT += dt;
    if (this.hudT > 0.25) { this.hudT = 0; this.hud(); }
  }

  hud(flash = false) {
    const u = this.ui; if (!u.box) return;
    const found = Object.values(this.state.stashes).filter(c => c > 0).length;
    u.carried.textContent = `${this.carried} / ${CARRY_MAX}`;
    u.stashed.textContent = this.state.totals.stashed;
    u.found.textContent = found;
    if (u.notes) {
      const notes = this.state.species.map(id => ACORNS[id].common).join(', ') || 'none yet';
      if (u.notes.textContent !== notes) u.notes.textContent = notes;
    }
    const sec = Math.floor(this.elapsed);
    u.time.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    u.hint.textContent = this.carried > 0 && this.nearFull && !this.depositing ? 'stash full, find another'
      : this.carried > 0 ? `you carry ${this.carried === 1 ? 'an acorn' : this.carried + ' acorns'}${this.carried >= CARRY_MAX ? ' (pouch full)' : ''}: stash holes now glow in some oaks`
      : 'find an oak: acorns glow when you are close';
    if (flash) { u.box.classList.remove('flash'); void u.box.offsetWidth; u.box.classList.add('flash'); }
  }
}


// Full-stash marker: the Lucide "nut" icon (https://lucide.dev/icons/nut), ISC licence,
// Copyright (c) Lucide Icons and Contributors, drawn as strokes over a soft amber glow.
const LUCIDE_NUT = [
  'M16.847 5.847 20 9a7.23 7.23 0 011.551 7.516C21.241 17.352 21 17.932 21 19v1a1 1 0 01-1 1h-1c-1.069 0-1.648.242-2.485.552A7.2 7.2 0 019.002 20l-3.155-3.153',
  'M18.21 5.43c-1.71.69-5.07 1.07-6.71 1.07.46 1.38.91 2.74.61 4.88a.88.88 0 01-.73.74c-1.78.28-3.54-.17-4.88-.62 0 1.64-.38 5-1.07 6.71-.21.52-.82.55-1.17.12A10 10 0 0118.33 4.26c.43.35.4.97-.12 1.17',
  'M4.93 4.93 3 3a.7.7 0 010-1',
];
function makeAcornIcon() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const glow = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  glow.addColorStop(0, 'rgba(255,190,100,0.85)'); glow.addColorStop(0.5, 'rgba(255,150,60,0.35)'); glow.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 128, 128);
  g.save(); g.translate(16, 16); g.scale(4, 4);            // 24-unit icon drawn at 96 px, centred
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [color, width] of [['rgba(30,18,8,0.9)', 3.6], ['#ffd9a0', 2]]) {   // dark halo stroke, then the icon
    g.strokeStyle = color; g.lineWidth = width;
    for (const d of LUCIDE_NUT) g.stroke(new Path2D(d));
  }
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
