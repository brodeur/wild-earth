// The hunt loop (2026-10-28, the first game loop honed to be played again): for a player whose species hunts
// (games.json relations.predation: the lion, the coyote, the fox; the hawk and the raven in the air), the panel above
// the needs shows the goal and the arc.
//
// The goal: the nearest prey within HUNT_R m, its distance, its bearing from the body's heading (an arrow) and its
// state: unaware (beyond its notice of you, which the stalk and the cover shrink: animals.js setStalk), alert (it has
// noticed you, head up; it flees when you come within its flee radius, which is small for a hunter it can barely
// see) or fleeing (a deer herd gallops for 7 s when the hunter is within 30 m, then trots; a rush from farther than
// about 25 m fails), and scented (2026-10-29) when the smell sense has the prey (scent.js smell(prey), main.js sets
// hunt.scent): the hunter has its scent, so the prey is upwind and the hunter downwind of it, the side to stalk from;
// "a faint scent" under SCENT_SURE. And the prey's own nose (the same day, animals.js noticeAt): unaware or alert is
// judged as the prey judges it, by sight and sound shrunk by the stalk, or by smell shaped by the wind; when the wind
// carries the hunter's scent to the prey (wind.js scentCarry over DOWNWIND) the line says " · downwind of you": the prey
// will smell the hunter from far, and the stalk should come round. The legs: a hunter's full run lasts a few seconds (groundControl S.sprint), then it is tired at
// half speed until the legs come back; a rush that reaches its prey catches it, a rush that fails makes you known
// (every species notices you 1.6x as far for 45 s). The arc: a hunter's body is taken hungry (needs.js 0.45) and
// drains over NEED_T.hunt min; a catch fills it: a full belly ends the arc with the time and the rushes it took;
// an empty one ends the body (needs.js onStarve: the spirit leaves). Kills per tile and the best time are kept in
// localStorage, like the acorn stash.
import { scentCarry } from './wind.js';
const HUNT_R = 400, DIRS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'], SCENT_SURE = 0.3, DOWNWIND = 0.75;
const TAU = Math.PI * 2;

export class Hunt {
  constructor({ tile, animals, flight, ground, needs, el, scent = null }) {
    Object.assign(this, { tile, animals, flight, ground, needs, el, scent });
    this.on = false; this.k = -1; this.target = null; this.pickT = 0; this.done = false; this.kills = 0; this.t0 = 0;
    this.total = 0; this.best = null; this.load();
    this.els = el ? { target: el.querySelector('.hn-target'), legs: el.querySelector('.hn-legs'), legsBar: el.querySelector('.hn-legs b'), arc: el.querySelector('.hn-arc') } : null;
    this.unhook = animals.on?.('kill', e => this.onKill(e)) || null;
  }
  key() { return `wild-earth:hunt:${this.tile.id}`; }
  load() { try { const s = JSON.parse(localStorage.getItem(this.key()) || '{}'); this.total = s.kills || 0; this.best = s.best || null; } catch (err) { /* private mode */ } }
  save() { try { localStorage.setItem(this.key(), JSON.stringify({ kills: this.total, best: this.best })); } catch (err) { /* private mode */ } }
  // the player's species (main.js onBody): a hunter's panel shows; anyone else's hides
  setSpecies(code) {
    const A = this.animals; if (A && !A.preySlots) A.buildHunts?.();
    const k = A ? A.speciesList().findIndex(sp => sp.code === code) : -1;
    this.k = k; this.on = !!(k >= 0 && A?.preySlots?.[k]);
    this.kills = 0; this.done = false; this.t0 = performance.now(); this.target = null; this.pickT = 0;
    if (this.el) this.el.hidden = !this.on;
  }
  onKill(e) {
    if (!this.on || e.by !== this.animals.observer) return;
    this.kills++; this.total++; this.save();
  }
  // the nearest live prey of a species the player's hunts, within HUNT_R, or null
  pick(x, z) {
    const A = this.animals, prey = A.preySlots?.[this.k]; if (!prey) return null;
    let best = null, bd = HUNT_R * HUNT_R;
    for (const a of A.list) {
      if (!prey.has(a.sp) || a.dead || a.culled || a.air) continue;
      const d2 = (a.x - x) ** 2 + (a.z - z) ** 2; if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }
  state(a, d, P) {
    const A = this.animals;
    if (A.fled?.(a)) return 'fleeing';
    const n = P && A.noticeAt ? A.noticeAt(a.sp, a.x, a.z, P.x, P.z) : undefined;   // as the prey judges it: its eyes, ears and nose in this wind
    if (A.alert?.(a.sp, d, n)) return 'alert';
    return 'unaware';
  }
  update(dt) {
    if (!this.on || !this.els) return;
    const P = this.flight.pos, A = this.animals;
    this.pickT -= dt;
    if (this.pickT <= 0 || (this.target && (!A.alive?.(this.target) || this.target.dead))) { this.pickT = 0.25; this.target = this.pick(P.x, P.z); }
    const t = this.target, E = this.els;
    if (t) {
      const dx = t.x - P.x, dz = t.z - P.z, d = Math.hypot(dx, dz);
      // bearing from the body's heading (yaw 0 faces -z): 0 ahead, clockwise
      const yaw = this.flight.yaw + (this.flight.look || 0), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const ang = Math.atan2(dz * fx - dx * fz, dx * fx + dz * fz);   // clockwise seen from above: positive to the right (facing north, east is +pi/2)
      const i = ((Math.round(ang / (TAU / 8)) % 8) + 8) % 8;
      const st = this.state(t, d, P), name = A.speciesList()[t.sp]?.one || 'prey';
      E.target.textContent = `${name} · ${Math.round(d)} m ${DIRS[i]} · ${st}`;
      const sc = this.scent?.smell(t) || 0;   // the smell sense has this prey: it is upwind of the hunter
      if (sc > 0) { const sp = document.createElement('span'); sp.className = 'sc'; sp.textContent = ` · ${sc >= SCENT_SURE ? 'scented' : 'a faint scent'}`; E.target.appendChild(sp); }
      const dw = st !== 'fleeing' && scentCarry(t.x - P.x, t.z - P.z) >= DOWNWIND;   // the wind carries the hunter's scent to the prey
      if (dw) { const sp = document.createElement('span'); sp.className = 'dw'; sp.textContent = ' · downwind of you'; E.target.appendChild(sp); }
      E.target.className = `hn-target ${st}${sc ? ' scented' : ''}${dw ? ' downwind' : ''}`;
    } else {
      E.target.textContent = `no prey within ${HUNT_R} m · dawn and dusk on the open edges`;
      E.target.className = 'hn-target';
    }
    const g = this.ground, stamina = g?.stamina ?? 1;
    E.legsBar.style.width = `${Math.round(stamina * 100)}%`; E.legs.classList.toggle('tired', !!g?.tired);
    E.legs.hidden = !(g?.S?.sprint);
    const N = this.needs, mins = (performance.now() - this.t0) / 60000;
    if (!this.done && this.kills > 0 && N && N.hunger >= 0.999) {   // a full belly: the arc ends
      this.done = true; this.doneMins = mins;
      if (this.best == null || mins < this.best) this.best = mins;
      this.save();
      g?.say?.(`a full belly: ${this.kills} kill${this.kills > 1 ? 's' : ''} in ${mins.toFixed(1)} min, ${g.rushes || 0} rush${(g.rushes || 0) === 1 ? '' : 'es'}`);
    }
    const mm = s => `${Math.floor(s)}:${String(Math.round((s % 1) * 60)).padStart(2, '0')}`;
    if (this.done) { E.arc.textContent = `full belly in ${mm(this.doneMins)} · rest (X) · best ${mm(this.best)} · ${this.total} kills here`; E.arc.className = 'hn-arc done'; }
    else {
      const rushes = g?.rushes || 0;
      E.arc.textContent = `hunting ${mm(mins)} · ${rushes} rush${rushes === 1 ? '' : 'es'}${this.kills ? ` · ${this.kills} kill${this.kills > 1 ? 's' : ''}` : ''}${this.best != null ? ` · best ${mm(this.best)}` : ''}`;
      E.arc.className = 'hn-arc';
    }
  }
  dispose() { this.unhook?.(); }
}
