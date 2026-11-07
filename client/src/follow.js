import { avatarFor } from './social.js';

// Group follow (Aaron, 2026-11-06): "When a player in a group is in a tile with another player, and one of them leaves to
// go to the main screen - when that person presses "START" the other people in the group receive an invitation to join
// them which they can decline. Their screen fades to black and a loading bar begins and then they should enter the tile
// where the person who originated the invitation is, above and behind them." (docs/multiplayer.md "Group follow").
//
// The two pieces of page this needs, kept out of the title screen's files: the invitation (FollowToast, top middle, on the
// home screen and over the HUD alike: the inviter's avatar, "<name> started at <place>", Join and Decline, and a line
// that runs down to its expiry) and the veil a Join brings up (FollowVeil: the screen fades to black, "joining <name>"
// over the place's name, and a loading bar that follows the world's build step by step, main.js buildSteps' w.next).
// The same veil covers a group season change (multiplayer.js gotSeason): "<name> changed the season" over the season.
// multiplayer.js decides when each shows; this module only draws them. The styles are follow.css, linked from here.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const FADE_MS = 600;   // the veil's fade to black (follow.css #followVeil transition)

// The build's steps (main.js buildSteps, w.next) with rough weights of their time, as the home screen's bar has them
// (title.js STEPS): the bar stands at the start of the step under way and creeps toward its end. 'warm' runs only
// behind the home screen, so a switch skips its share.
const STEPS = [['loadTile', 3], ['atmosphere', 1], ['weather', 1], ['terrain', 10], ['sky', 1], ['vegetation', 12], ['impostors', 10], ['grass', 6], ['water', 4],
  ['rocks', 2], ['roads+flight', 1], ['shadows', 2], ['crownPlan', 8], ['impostors.crowns', 6], ['veg.update', 3], ['hud', 1], ['places', 1], ['arrival', 1],
  ['texture', 6], ['season', 6], ['applySeason', 1], ['acorns', 1], ['identify', 1], ['animals', 6], ['controls', 2], ['rocks.warm', 3], ['warm', 4],
  ['compile', 10], ['textures', 6], ['compile.wait', 4], ['upload', 3]];
const READY_AT = 0.94;   // the world built: the rest of the bar is the inviter's position and the first frames
const STEP_AT = (() => { const tot = STEPS.reduce((s, [, w]) => s + w, 0); let a = 0; const m = {}; for (const [n, w] of STEPS) { m[n] = [READY_AT * a / tot, READY_AT * (a + w) / tot]; a += w; } return m; })();

let linked = false;
function linkStyles() {
  if (linked) return; linked = true;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('../follow.css', import.meta.url).href;
  document.head.append(l);
}

// The invitation. show({ from, name, place, ms }) -> the element; onJoin / onDecline are called once, by a button or
// Escape (decline); onExpire when the line has run out. close() takes it down (fading).
export class FollowToast {
  constructor({ from, name, place, season = null, ms, onJoin, onDecline, onExpire }) {
    linkStyles();
    const el = this.el = document.createElement('div'); el.id = 'followInvite'; el.dataset.wePage = '';   // the page's, not a world's (main.js w.record) el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-live', 'assertive');
    el.setAttribute('aria-label', `${name} started at ${place}`);
    el.innerHTML = `<div class="fi-row"><span class="fi-av"></span><span class="fi-text"><span class="fi-line"><b>${esc(name)}</b> started at <b>${esc(place)}</b></span><small>Join them there?${season ? ` · ${esc(season)}` : ''}</small></span>
      <span class="fi-btns"><button type="button" class="fi-join">Join</button><button type="button" class="fi-no">Decline</button></span></div>
      <i class="fi-time" style="animation-duration:${Math.round(ms)}ms"></i>`;
    el.querySelector('.fi-av').replaceWith(avatarFor(from, 34));
    const once = fn => () => { if (this.done) return; this.done = true; this.close(); fn?.(); };
    el.querySelector('.fi-join').onclick = once(onJoin);
    el.querySelector('.fi-no').onclick = once(onDecline);
    el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') once(onDecline)(); });   // keys here stay here
    el.addEventListener('keyup', e => e.stopPropagation());
    this.timer = setTimeout(once(onExpire), ms);
    document.body.append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  }
  close() {
    clearTimeout(this.timer); this.done = true;
    const el = this.el; if (!el?.isConnected) return;
    el.classList.remove('on'); el.classList.add('off'); setTimeout(() => el.remove(), 400);
  }
}

// The veil: show(name, place, lead, tail) fades to black (resolves when black) over "<lead> <name> <tail>" and the place, step(name) moves the bar with the build, status(text)
// says what is going on under it, done() fills the bar and fades back in, fail(text) says why and fades back after a
// moment.
export class FollowVeil {
  constructor() {
    linkStyles();
    this.el = null; this.p = 0; this.shown = 0; this.goal = 0; this.stepEnd = 0; this.stepAt = 0; this.raf = 0;
  }
  get active() { return !!this.el; }
  show(name, place, lead = 'joining', tail = '') {
    this.remove();
    const el = this.el = document.createElement('div'); el.id = 'followVeil'; el.dataset.wePage = '';   // stands across the switch: never a world's node (main.js w.record) el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = `<div class="fv-mid"><p class="fv-who">${esc(lead)} <b>${esc(name)}</b> ${esc(tail)}</p><p class="fv-place">${esc(place)}</p>
      <div class="fv-bar" role="progressbar" aria-label="loading ${esc(place)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
      <p class="fv-status">&nbsp;</p></div>`;
    document.body.append(el);
    this.p = this.shown = this.stepEnd = 0; this.stepAt = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    const tick = () => { this.draw(); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
    this.drawT = setInterval(() => this.draw(), 100);   // a hidden page has no frames; the bar still moves
    return new Promise(r => setTimeout(r, FADE_MS + 40));
  }
  step(name) {
    const at = STEP_AT[name]; if (!this.el || !at) return;
    this.p = Math.max(this.p, at[0]); this.stepEnd = Math.max(this.stepEnd, at[1]); this.stepAt = performance.now();
  }
  status(text) { const s = this.el?.querySelector('.fv-status'); if (s) s.textContent = text || ' '; }
  ready() { if (this.el) { this.p = Math.max(this.p, READY_AT); this.stepEnd = Math.max(this.stepEnd, 0.99); this.stepAt = performance.now(); } }
  draw() {
    if (!this.el) return;
    const now = performance.now(), dt = Math.min(0.25, (now - (this.lastDraw || now)) / 1000); this.lastDraw = now;
    const creep = this.p + (Math.max(this.p, this.stepEnd) - this.p) * 0.85 * (1 - Math.exp(-(now - this.stepAt) / 6000));
    this.shown = Math.min(1, Math.max(this.shown, this.shown + (creep - this.shown) * (1 - Math.exp(-dt * 6))));
    this.el.querySelector('.fv-bar i').style.transform = `scaleX(${this.shown.toFixed(4)})`;
    this.el.querySelector('.fv-bar').setAttribute('aria-valuenow', String(Math.round(this.shown * 100)));
  }
  // The world is entered and the joiner placed: the bar fills, holds a moment, and the veil fades out.
  done(holdMs = 500) {
    if (!this.el) return Promise.resolve();
    this.p = this.stepEnd = 1; this.shown = 1; this.draw();
    const el = this.el;
    return new Promise(r => setTimeout(() => {
      if (this.el !== el) return r();
      el.classList.remove('on'); el.classList.add('out');
      setTimeout(() => { if (this.el === el) this.remove(); r(); }, FADE_MS + 100);
    }, holdMs));
  }
  fail(text) {
    if (!this.el) return;
    this.status(text); this.el.classList.add('failed');
    const el = this.el;
    setTimeout(() => { if (this.el === el) { el.classList.remove('on'); el.classList.add('out'); setTimeout(() => { if (this.el === el) this.remove(); }, FADE_MS + 100); } }, 2500);
  }
  remove() {
    cancelAnimationFrame(this.raf); clearInterval(this.drawT); this.raf = 0;
    this.el?.remove(); this.el = null;
  }
}
