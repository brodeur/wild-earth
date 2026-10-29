import * as THREE from 'three';
import { rarityColor } from './animals.js';

// Sound cues (owner, 2026-10-29: "For sound, if I hear a predator or prey, little sound bubble waves pulse out
// around/near where the sound originated from. If the location is not in the viewport, the sound waves appear at the
// edge of the screen closest.").
//
// What is heard: every live animal the player's species hunts or is hunted by (games.json relations.predation,
// animals.js preySlots, both ways), as far as the player's hearing reaches (perception.json senses[player].hearing) and
// as far as the animal's own sound carries now: its signature (signatures[it].sound, the carry of its loudest sound)
// times what it is doing (ACT: a body standing or grazing hardly at all, a walk, a trot, a gallop or a bolt far; a
// bird on the wing its wingbeats), judged from its speed over the last frames (animals.js fled for a bolt). And the
// calls and flushes every species makes (the animals' event bus: 'alarm' with its carry from perception.json
// alarm_calls, 'flush', 'turkeyFlush', 'gsAlarm'), heard within their carry whoever made them: an alarm call is about a
// predator, a flush is prey going up. The sound's level is how much nearer than its carry the listener is.
//
// The cue: RINGS thin concentric rings pulsing out on the screen (index.html #soundCues, .scp) at the projected point of
// the sound's origin, in the species' rarity colour (animals.js rarityColor), fading over about a second; a source
// outside the viewport (or behind the camera) shows at the screen's edge nearest its direction (as the herd's
// off-screen marks, herdMarks.js). A continuing sound repeats its rings every PERIOD s, faster when louder; a call or a
// flush gives a burst of BURST_N. At most LIVE_MAX pulses on screen. main.js builds it after the scent and calls
// update(dt) while the player is in a body, clear() otherwise.
const RINGS = 3, PERIOD = [0.55, 1.1], BURST_N = 3, BURST_T = 0.35, LIFE = 1.3, LIVE_MAX = 24;
const EDGE = { left: 30, right: 30, top: 58, bottom: 100 };   // px: the edge box for an off-screen source, inside the menu button, the row and the mini-map's column
const SIZE = [20, 56];                                  // px: the rings' diameter at a faint sound and at a loud one
const ACT = { still: 0.06, walk: 0.35, trot: 0.8, bolt: 1.6, wing: 0.15 };
const SPEEDS = [0.25, 1.6, 3.5];                        // m/s: still under, walk under, trot under, else a bolt
const DEFAULT_HEARING = 300, DEFAULT_SOUND = 50;        // m: a tile without senses or signatures
const EVENTS = { alarm: e => e.carry, flush: () => 250, turkeyFlush: () => 400, gsAlarm: () => 200 };

export class SoundCues {
  constructor({ tile, animals, flight, camera, el }) {
    Object.assign(this, { tile, animals, flight, camera, el });
    this.code = null; this.hearing = 0; this.sig = null; this.who = null;
    this.sources = new Map(); this.bursts = []; this.live = []; this.t = 0; this.ms = 0;
    this.v = new THREE.Vector3(); this.cv = new THREE.Vector3(); this.col = new THREE.Color();
    const A = animals;
    this.unhook = Object.entries(EVENTS).map(([type, carry]) => A.on?.(type, e => this.onEvent(type, e, carry(e)))).filter(Boolean);
  }
  setSpecies(code) {
    const A = this.animals, L = A.speciesList(); if (!A.preySlots) A.buildHunts?.();
    this.code = code;
    const k = L.findIndex(sp => sp.code === code), mine = new Set(L.map((sp, i) => sp.code === code ? i : -1).filter(i => i >= 0));
    this.who = new Set(A.preySlots?.[k] || []); A.preySlots?.forEach((s, h) => { if (s) for (const m of mine) if (s.has(m)) this.who.add(h); });
    const sen = this.tile.perception?.senses?.[code.split(':')[0]];
    this.hearing = typeof sen?.hearing === 'number' ? sen.hearing : DEFAULT_HEARING;
    const sig = this.tile.perception?.signatures;
    this.sig = L.map(sp => { const s = sig?.[sp.code.split(':')[0]]?.sound; return typeof s === 'number' ? s : DEFAULT_SOUND; });
    this.sources.clear(); this.bursts.length = 0;
  }
  // a call or a flush: heard within its carry (and the player's hearing), a burst of rings at its origin
  onEvent(type, e, carry) {
    if (!this.on || !(carry > 0) || this.live.length >= LIVE_MAX) return;
    const P = this.flight.pos, d = Math.hypot(e.x - P.x, e.z - P.z), reach = Math.min(carry, this.hearing); if (d >= reach) return;
    const L = this.animals.speciesList(), k = L.findIndex(sp => sp.code === e.species) >= 0 ? L.findIndex(sp => sp.code === e.species) : (e.group?.leader?.sp ?? e.animal?.sp ?? -1);
    this.bursts.push({ x: e.x, y: e.y, z: e.z, k, level: 1 - d / reach, n: BURST_N, nextT: 0, type });
  }
  update(dt) {
    const t0 = performance.now(), A = this.animals, P = this.flight.pos;
    this.on = true;
    if (A.observer !== this.code) this.setSpecies(A.observer);
    this.t += dt; const t = this.t;
    for (const s of this.sources.values()) s.alive = false;
    if (this.who.size) for (const a of A.list) {
      if (a.gone || a.dead || a.culled || a.sp === undefined || !this.who.has(a.sp) || !A.meshes[a.sp]?.visible) continue;
      const d = Math.hypot(a.x - P.x, a.z - P.z); if (d >= this.hearing) continue;
      let s = this.sources.get(a.id);
      if (!s) this.sources.set(a.id, s = { a, x: a.x, z: a.z, v: 0, nextT: Math.random() * PERIOD[0], alive: false, level: 0 });
      s.a = a;
      const mv = Math.hypot(a.x - s.x, a.z - s.z) / Math.max(dt, 1e-3); s.x = a.x; s.z = a.z;
      s.v += (Math.min(mv, 20) - s.v) * Math.min(1, dt * 4);
      const act = a.air ? ACT.wing : A.fled?.(a) ? ACT.bolt : s.v < SPEEDS[0] ? ACT.still : s.v < SPEEDS[1] ? ACT.walk : s.v < SPEEDS[2] ? ACT.trot : ACT.bolt;
      const reach = Math.min(this.sig[a.sp] * act, this.hearing); if (d >= reach) continue;
      s.alive = true; s.level = 1 - d / reach;
    }
    for (const [id, s] of this.sources) {
      if (!s.alive) { if (t - (s.lastT || t) > 3) this.sources.delete(id); continue; }
      s.lastT = t; s.nextT -= dt;
      if (s.nextT <= 0) { s.nextT = PERIOD[1] - (PERIOD[1] - PERIOD[0]) * s.level; this.pulse(s.a.x, A.scentHeight(s.a), s.a.z, s.a.sp, s.level); }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]; b.nextT -= dt;
      if (b.nextT <= 0) { b.nextT = BURST_T; b.n--; this.pulse(b.x, b.y + 0.5, b.z, b.k, b.level); }
      if (b.n <= 0) this.bursts.splice(i, 1);
    }
    // the pulses on screen follow their source's point while they live, then go
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      if (t - p.t0 > LIFE) { p.el.remove(); this.live.splice(i, 1); continue; }
      this.place(p);
    }
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  // one pulse: RINGS rings at the sound's point, sized by its level, in the species' colour
  pulse(x, y, z, k, level) {
    if (!this.el || this.live.length >= LIVE_MAX) return;
    const el = document.createElement('div'); el.className = 'scp';
    const c = k >= 0 ? rarityColor(this.animals.rarity[k], this.col) : this.col.set('#e6ede7');
    el.style.setProperty('--soul', `#${c.getHexString()}`);
    el.style.setProperty('--d', `${Math.round(SIZE[0] + (SIZE[1] - SIZE[0]) * Math.min(1, Math.max(0, level)))}px`);
    for (let i = 0; i < RINGS; i++) el.append(document.createElement('i'));
    const p = { el, x, y, z, t0: this.t, edge: false };
    this.place(p); this.el.append(el); this.live.push(p);
  }
  // the pulse at the projected point, or at the screen's edge nearest its direction (herdMarks.js)
  place(p) {
    const cam = this.camera, W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2;
    const behind = this.cv.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse).z > 0;
    this.v.set(p.x, p.y, p.z).project(cam);
    let nx = this.v.x, ny = this.v.y; if (behind) { nx = -nx; ny = -ny; }
    let sx, sy, edge;
    if (!behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1) { sx = cx + nx * cx; sy = cy - ny * cy; edge = false; }
    else {
      let dx = nx, dy = -ny; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;   // from the screen's centre toward it
      const tx = dx > 0 ? (W - EDGE.right - cx) / dx : dx < 0 ? (EDGE.left - cx) / dx : Infinity, ty = dy > 0 ? (H - EDGE.bottom - cy) / dy : dy < 0 ? (EDGE.top - cy) / dy : Infinity;
      const t = Math.min(tx, ty);
      sx = cx + dx * t; sy = cy + dy * t; edge = true;
    }
    p.el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px)`;
    if (edge !== p.edge) { p.edge = edge; p.el.classList.toggle('edge', edge); }
  }
  // debugging: what is heard now
  heard() { return [...this.sources.values()].filter(s => s.alive).map(s => ({ id: s.a.id, sp: this.animals.speciesList()[s.a.sp].one, level: +s.level.toFixed(2), v: +s.v.toFixed(2) })); }
  clear() {
    this.on = false;
    if (this.sources.size) this.sources.clear(); this.bursts.length = 0;
    for (const p of this.live) p.el.remove(); this.live.length = 0;
  }
  dispose() { this.clear(); for (const u of this.unhook) u?.(); this.unhook = []; }
}
