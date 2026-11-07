import * as THREE from 'three';
import { MOVES, movesFor, GCD } from './strikes.js';
import { rarityColor } from './animals.js';

// The hunt's strikes for the player (owner, 2026-11-06: bite, swipe and pounce for the cats, "Those only work when a prey
// animal is in range ... When the prey is targeted, they have a health bar. Each type of attack should affect the health
// bar and have a cooldown - think WoW game mechanics for combat rather than tekken"). The rules are strikes.js's; the host
// decides every hit (animals.js hurt). This module is the player's side:
//
// - Which strikes: a walker whose species hunts (games.json relations.predation) gets its family's (strikes.js movesFor:
//   the cats bite, swipe, pounce; the bears bite, swipe, lunge; the rest bite and lunge), on keys 1-3 and as action-bar
//   slots (abilities.js) shown only while a prey animal is selected (quarry.js), greyed while it is out of that strike's
//   reach, with a radial sweep while the strike cools down (its own cooldown, or the global one after any strike).
// - A strike: in reach and ready, the body plays it (groundControl.js attack: the bite's lunge and snap, the swipe's
//   raked forepaw, the pounce's crouch and leap, the lunge's spring) and at its moment of contact, if the prey is still
//   within reach (a little slack: it may have stepped), the hit goes to the host (animals.hurt). A kill is the catch's: fed,
//   the word, the cat over its kill; on a mirror the host's answer comes as the kill event (animals.onCaught) or a miss.
//   E with prey in reach is the bite (groundControl's own catch gives way: the rush's leap no longer kills by itself).
// - Big prey may fight back (animals.js 'kick'): the body is thrown back and staggers (groundControl kicked), no strikes for
//   STUN s.
// - The target frame (index.html #targetFrame): the selection's name, its health bar and numbers, top centre, WoW's way;
//   and a small bar over the animal itself (#targetBar), both coloured by the species' colour and shown for any
//   selection (the spirit's too). The host's 'hp' events set the bar on every page, so two players striking the same prey
//   see the same bar; a struck number floats up over it.
const STUN = 1.5, SLACK = 1.35;   // s without strikes after a kick; the reach's slack at the moment of contact (the prey moves in the strike's wind-up)

export class Combat {
  constructor({ animals, ground, flier, quarry, camera, frame, bar, say = null }) {
    Object.assign(this, { animals, ground, flier, quarry, camera, frame, bar, say });
    this.t = 0; this.cd = new Map(); this.gcd = 0; this.stun = 0; this.code = null; this.moves = []; this.active = false;
    this.floats = []; this._v = new THREE.Vector3(); this._c = new THREE.Color();
    const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    this.onKey = e => {
      if (e.repeat || typing(e) || e.metaKey || e.ctrlKey || e.altKey || !this.active) return;
      const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code); if (i < 0 || !this.moves[i]) return;
      e.preventDefault(); this.use(this.moves[i].key);
    };
    addEventListener('keydown', this.onKey);
    this.unhook = [
      animals.on?.('hp', e => this.onHp(e)),
      animals.on?.('kill', e => { if (e.venom && e.mine && this.ground.on) { this.ground.caught(e.animal); this.say?.(`the venom takes the ${this.name(e.animal)}`); } }),   // a viper's struck prey dying of the venom (animals.js venomTick): the player's catch
    ].filter(Boolean);
    animals.onKicked = a => this.kicked(a);
  }
  // the body's strikes (main.js onBody): a hunting walker's family's, else none
  setSpecies(code) {
    const A = this.animals; if (!A.preySlots) A.buildHunts?.();
    const k = A.speciesList().findIndex(sp => sp.code === code);
    const hunts = k >= 0 && !!A.preySlots?.[k]?.size;
    this.code = code; this.k = k; this.moves = hunts ? movesFor(A.bodyK(k).family) : []; this.cd.clear(); this.gcd = 0; this.stun = 0;
  }
  target() { const a = this.quarry.target; return a && !a.plant && !a.dead && !a.gone ? a : null; }   // (a plant target is for eating: quarry.js)
  dist(a) { const P = this.ground.flight.pos; return Math.hypot(a.x - P.x, a.z - P.z); }
  reach(key, a) { return this.animals.strikeReach(MOVES[key], this.code, a); }
  inReach(key, a = this.target()) { return !!a && this.animals.killable?.(a) && this.dist(a) <= this.reach(key, a); }
  // 0..1 of the strike's cooldown still to run (the longer of its own and the global one), for the slot's sweep
  cooling(key) {
    const own = Math.max(0, (this.cd.get(key) || 0) - this.t), g = Math.max(0, this.gcd - this.t);
    return own >= g ? own / MOVES[key].cd : g / GCD;
  }
  ready(key) { return this.t >= (this.cd.get(key) || 0) && this.t >= this.gcd && this.stun <= 0; }
  canUse(key) { const G = this.ground; return this.active && G.on && G.mode === 'ground' && this.ready(key) && this.inReach(key); }
  // E (groundControl): the bite at the selection, or at the prey in reach (which becomes the selection); true when it struck
  useNear(key) {
    if (this.quarry.target?.plant) return false;   // E with a plant targeted eats (groundControl)
    if (!this.target() || !this.inReach(key)) { const P = this.ground.flight.pos, p = this.animals.preyNear?.(P.x, P.y, P.z, MOVES[key].reach * this.animals.bodyK(this.k).len + 1.5); if (p) this.quarry.select(p); }
    return this.use(key);
  }
  use(key) {
    const a = this.target(), move = MOVES[key], G = this.ground;
    if (!a || !move || !this.moves.includes(move)) return false;
    if (!this.canUse(key)) {
      if (G.on && this.stun <= 0 && this.ready(key) && !this.inReach(key, a)) this.say?.(this.animals.killable?.(a) ? `out of reach for a ${key}` : `a ${this.name(a)} cannot be taken yet`);
      return false;
    }
    this.cd.set(key, this.t + move.cd); this.gcd = this.t + GCD;
    const hit = () => this.hit(key, a);
    if (move.gap) G.attack(key, a, { onLand: hit });
    else G.attack(key, a, { dur: move.dur, hitAt: move.hitAt, onHit: hit, stop: this.reach('bite', a) * 0.6 });
    return true;
  }
  // the moment of contact: still within reach (with slack), the host decides the hit
  hit(key, a) {
    if (!a || a.dead || a.gone) return null;
    if (this.dist(a) > this.reach(key, a) * SLACK + (MOVES[key].gap ? 1.2 : 0)) { this.say?.(`the ${key} misses`); return null; }
    const P = this.ground.flight.pos;
    this.animals.playerSize = this.ground.size || 1;
    const r = this.animals.hurt(a, key, this.code, 0, P.x, P.y, P.z);
    if (r === 'kill') this.ground.caught(a);
    return r;
  }
  name(a) { return this.animals.speciesList()[a.sp]?.one || 'prey'; }
  onHp(e) {
    const a = e.animal; if (!a || a !== this.quarry.target) return;
    const lost = (this._lastHp?.a === a ? this._lastHp.hp : this.animals.hpMax(a)) - e.hp;
    this._lastHp = { a, hp: e.hp };
    if (lost > 0.05) this.floats.push({ a, t: 0, text: `-${lost >= 10 ? Math.round(lost) : lost.toFixed(1)}`, mine: !e.aid || e.mine });
  }
  kicked(a) {
    if (!this.ground.on) return;
    this.ground.kicked(a); this.stun = STUN; this.say?.(`the ${this.name(a)} fights back`);
  }
  update(dt) {
    this.t += dt; this.stun = Math.max(0, this.stun - dt);
    this.animals.playerSize = this.ground.on ? (this.ground.size || 1) : 1;   // the body's size, for the strikes' and the eating's reach
    this.active = this.ground.on && this.moves.length > 0;
    this.draw(dt);
  }
  // the target frame and the bar over the animal (see the header)
  draw(dt) {
    const a = this.quarry.target, F = this.frame, B = this.bar, A = this.animals;
    if (!a || a.gone) { if (F && !F.hidden) F.hidden = true; if (B && !B.hidden) B.hidden = true; this.floats.length = 0; return; }
    if (a.plant) {   // a food plant: its name and the part in season; no health (quarry.js plant targets)
      if (B && !B.hidden) B.hidden = true;
      if (F) {
        F.hidden = false; F.classList.add('plant'); F.classList.remove('low'); F.style.setProperty('--soul', '#ffd173');
        const nm = F.querySelector('.tf-name'), txt = `${a.name} · ${a.part}`; if (nm.textContent !== txt) nm.textContent = txt;
        F.querySelector('.tf-bar').hidden = true;
      }
      return;
    }
    if (F) { F.classList.remove('plant'); F.querySelector('.tf-bar').hidden = false; }
    const max = A.hpMax(a), hp = A.hpNow(a), frac = Math.max(0, Math.min(1, hp / max)), col = `#${rarityColor(A.rarity[a.sp], this._c).getHexString()}`;
    if (F) {
      F.hidden = false;
      const nm = F.querySelector('.tf-name'), fill = F.querySelector('.tf-fill'), num = F.querySelector('.tf-num');
      const name = A.speciesList()[a.sp]?.common || this.name(a);
      if (nm.textContent !== name) nm.textContent = name;
      F.style.setProperty('--soul', col); fill.style.width = `${(frac * 100).toFixed(1)}%`;
      num.textContent = a.dead ? 'dead' : `${hp >= 10 ? Math.round(hp) : hp.toFixed(1)} / ${max >= 10 ? Math.round(max) : max.toFixed(1)}`;
      F.classList.toggle('low', frac < 0.3);
    }
    if (B) {   // over the animal: its head's height plus a little, projected
      const v = this._v.set(a.x, A.scentHeight(a) + 0.6 * (A.bodyK(a.sp).len * (a.size || 1)) + 0.3, a.z).project(this.camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      B.hidden = !on;
      if (on) {
        B.style.left = `${((v.x + 1) / 2 * innerWidth).toFixed(1)}px`; B.style.top = `${((1 - v.y) / 2 * innerHeight).toFixed(1)}px`;
        B.style.setProperty('--soul', col); B.firstChild.style.width = `${(frac * 100).toFixed(1)}%`;
        // the struck numbers, floating up from it
        for (let i = this.floats.length - 1; i >= 0; i--) {
          const f = this.floats[i]; f.t += dt;
          if (!f.el) { f.el = document.createElement('span'); f.el.className = 'tb-float'; f.el.textContent = f.text; B.append(f.el); }
          f.el.style.transform = `translate(-50%, ${(-14 - 26 * f.t).toFixed(1)}px)`; f.el.style.opacity = `${Math.max(0, 1 - f.t / 1.2).toFixed(2)}`;
          if (f.t > 1.2 || f.a !== a) { f.el.remove(); this.floats.splice(i, 1); }
        }
      }
    }
  }
  dispose() {
    removeEventListener('keydown', this.onKey); for (const u of this.unhook) u?.();
    if (this.animals.onKicked) this.animals.onKicked = null;
    if (this.frame) this.frame.hidden = true; if (this.bar) { this.bar.hidden = true; for (const f of this.floats) f.el?.remove(); }
  }
}
