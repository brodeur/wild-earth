import { Hub, HubError } from './hub.js';

// The sign-in (docs/multiplayer.md, "What the player sees" 3; lane 3). A modal in the title screen's gate (title.js
// .tt-gate), over the crescent: a name and a password, Sign in with Discord (live when the hub's config lists it, else
// greyed and "soon" on hover), Google and Apple drawn greyed; a link to make an account (the name rules, the password,
// the six recovery codes shown once with a copy button and a plain warning); a recover path (name, code, new
// password). On success title.onSignedIn(you). When the page's server has no hub (title.config is null) the modal says
// so and offers Explore, which is the game as it is today (title.onSignedIn(null)). On the way back from Discord
// (multiplayer.js reads ?signin= and takes it off the URL) 'failed' shows what went wrong and 'discord' with no
// session found says so.
//
// Nothing here is kept: the session is the hub's HttpOnly cookie, the recovery codes are shown and gone, and a wrong
// password is reported by the hub's words (never the value typed).

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const NAME_RULE = '3 to 24 letters, digits, _ or .';
const PASS_RULE = 'at least 8 characters';

const ICONS = {
  discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.3 5.4A17 17 0 0 0 15.1 4l-.2.4a15.7 15.7 0 0 1 3.9 1.9 13.6 13.6 0 0 0-13.6 0A15.7 15.7 0 0 1 9.1 4.4L8.9 4a17 17 0 0 0-4.2 1.4C2 9.3 1.3 13.1 1.6 16.8a17 17 0 0 0 5.2 2.6l1.1-1.8a11 11 0 0 1-1.8-.9l.4-.3a12.2 12.2 0 0 0 11 0l.4.3a11 11 0 0 1-1.8.9l1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.3-.7-8-3.1-11.4ZM8.7 14.5c-1 0-1.9-1-1.9-2.1s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.1-1.9 2.1Zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.1-1.9 2.1Z"/></svg>',
  google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z"/><path fill="currentColor" opacity=".8" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a6 6 0 0 1-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="currentColor" opacity=".6" d="M6.4 13.9A6 6 0 0 1 6.4 10V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="currentColor" opacity=".9" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6A6 6 0 0 1 12 6Z"/></svg>',
  apple: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5a4.4 4.4 0 0 0-3.4-1.8c-1.4-.1-2.8.9-3.5.9-.7 0-1.9-.8-3.1-.8A4.6 4.6 0 0 0 4.5 10c-1.7 2.9-.4 7.2 1.2 9.6.8 1.1 1.7 2.4 3 2.4 1.2 0 1.6-.8 3.1-.8 1.4 0 1.8.8 3.1.8 1.3 0 2.1-1.2 2.9-2.3a10 10 0 0 0 1.3-2.7c0-.1-2.7-1-2.7-4.3ZM14.1 5.9c.6-.8 1.1-1.9.9-3a4.3 4.3 0 0 0-2.8 1.5c-.6.7-1.2 1.8-1 2.9 1.1.1 2.2-.6 2.9-1.4Z"/></svg>',
};

export class AccountModal {
  // title: the TitleScreen (its config, its gate element, onSignedIn); gate: where to stand (default the title's gate);
  // back: the URL's ?signin= on the way back from Discord ('discord' | 'failed'), taken off the URL by the caller.
  constructor({ title, gate = null, back = null }) {
    this.title = title; this.config = title.config || null;
    this.gate = gate || title.root.querySelector('.tt-gate') || title.root;
    this.gate.querySelector('.tt-explore')?.remove(); this.gate.querySelector('.tt-gate-note')?.remove();
    this.el = document.createElement('div'); this.el.className = 'ac-modal'; this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-label', 'sign in');
    this.gate.append(this.el);
    this.busy = false; this.done = false;
    // the way back from Discord: ?signin=failed says so here; ?signin=discord with no session found says so too
    this.note = back === 'failed' ? 'Discord did not sign you in. Try again, or use your name and password.'
      : back === 'discord' ? 'Discord signed you in, but this page found no session. Sign in again.' : '';
    this.view(this.config ? 'signin' : 'nohub');
    requestAnimationFrame(() => this.el.classList.add('on'));
  }

  $(sel) { return this.el.querySelector(sel); }
  providers() { return (this.config?.providers || []).map(String); }

  // ---- the views ----------------------------------------------------------------------------------------------------
  view(name, data = {}) {
    if (this.done) return;
    this.el.dataset.view = name;
    const fn = this[`v_${name}`]; this.el.innerHTML = fn ? fn.call(this, data) : '';
    this.wire(name, data);
    const first = this.$('input:not([type=hidden]), button.ac-primary'); first?.focus({ preventScroll: true });
  }
  providerRow() {
    const has = this.providers();
    const btn = (id, label) => {
      const live = has.includes(id);
      return `<button type="button" class="ac-prov${live ? '' : ' soon'}" data-prov="${id}" ${live ? '' : 'aria-disabled="true" data-soon="soon"'} title="${live ? `Sign in with ${label}` : `${label}: soon`}">${ICONS[id]}<span>${label}</span></button>`;
    };
    return `<div class="ac-provs">${btn('discord', 'Discord')}${btn('google', 'Google')}${btn('apple', 'Apple')}</div>`;
  }
  v_signin() {
    return `<h2>Sign in</h2>
      <form class="ac-form" novalidate>
        <label>Name<input name="name" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="24" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label>
        <p class="ac-err" role="alert">${esc(this.note)}</p>
        <button type="submit" class="ac-primary">Sign in</button>
      </form>
      <div class="ac-or"><span>or</span></div>
      ${this.providerRow()}
      <p class="ac-links"><a href="#" data-go="signup">Make an account</a><a href="#" data-go="recover">Lost your password?</a></p>`;
  }
  v_signup() {
    return `<h2>Make an account</h2>
      <form class="ac-form" novalidate>
        <label>Name <small>${NAME_RULE}</small><input name="name" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="24" required pattern="[A-Za-z0-9_.]{3,24}"></label>
        <label>Password <small>${PASS_RULE}</small><input name="password" type="password" autocomplete="new-password" maxlength="256" minlength="8" required></label>
        <p class="ac-note">No email address is asked for. Instead you get six recovery codes, shown once.</p>
        <p class="ac-err" role="alert"></p>
        <button type="submit" class="ac-primary">Make the account</button>
      </form>
      <p class="ac-links"><a href="#" data-go="signin">Back to sign in</a></p>`;
  }
  v_codes({ you, codes }) {
    return `<h2>Your recovery codes</h2>
      <p class="ac-note">Welcome, ${esc(you?.display || you?.name || '')}. These six codes are shown <b>once</b>. There is no email on this account, so a lost
        password can be reset only with one of them. Each code works one time. Keep them somewhere safe.</p>
      <ol class="ac-codes">${(codes || []).map(c => `<li><code>${esc(c)}</code></li>`).join('')}</ol>
      <div class="ac-rowbtns"><button type="button" class="ac-copy">Copy the codes</button><button type="button" class="ac-primary" data-go="done">I have them</button></div>`;
  }
  v_recover() {
    return `<h2>Recover the account</h2>
      <form class="ac-form" novalidate>
        <label>Name<input name="name" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="24" required></label>
        <label>A recovery code<input name="code" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength="64" required></label>
        <label>New password <small>${PASS_RULE}</small><input name="password" type="password" autocomplete="new-password" maxlength="256" minlength="8" required></label>
        <p class="ac-note">The code is spent, and every other sign-in of this account is ended.</p>
        <p class="ac-err" role="alert"></p>
        <button type="submit" class="ac-primary">Set the password</button>
      </form>
      <p class="ac-links"><a href="#" data-go="signin">Back to sign in</a></p>`;
  }
  v_recovered({ you, left }) {
    return `<h2>The password is set</h2>
      <p class="ac-note">Welcome back, ${esc(you?.display || you?.name || '')}. ${left === 1 ? 'One recovery code is' : `${left} recovery codes are`} left.</p>
      <button type="button" class="ac-primary" data-go="done">Continue</button>`;
  }
  v_nohub() {
    return `<h2>No hub here</h2>
      <p class="ac-note">This page's server has no hub: no accounts, no friends, no chat. You can explore alone, which is the game as it is today.</p>
      <button type="button" class="ac-primary" data-go="explore">Explore</button>`;
  }

  // ---- what the views do -------------------------------------------------------------------------------------------
  wire(name, data) {
    for (const a of this.el.querySelectorAll('[data-go]')) a.addEventListener('click', e => {
      e.preventDefault();
      const go = a.dataset.go;
      if (go === 'done') this.finish(data.you);
      else if (go === 'explore') this.finish(null);
      else { this.note = ''; this.view(go); }
    });
    for (const b of this.el.querySelectorAll('.ac-prov')) b.addEventListener('click', () => {
      if (b.classList.contains('soon')) return;
      if (b.dataset.prov === 'discord') { this.setBusy(true); location.assign(Hub.discordUrl()); }
    });
    this.$('.ac-copy')?.addEventListener('click', async e => {
      const btn = e.currentTarget, text = (data.codes || []).join('\n');
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (err) { ok = false; }
      if (!ok) {   // no clipboard: select the codes so a copy key takes them
        const r = document.createRange(); r.selectNodeContents(this.$('.ac-codes')); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      btn.textContent = ok ? 'Copied' : 'Selected: copy them'; btn.classList.add('did');
    });
    const form = this.$('form');
    if (form) form.addEventListener('submit', e => { e.preventDefault(); this.submit(name, form); });
  }
  setBusy(on) {
    this.busy = on; this.el.classList.toggle('busy', on);
    for (const b of this.el.querySelectorAll('button, input')) b.disabled = on;
  }
  fail(form, e) {
    const err = form.querySelector('.ac-err');
    err.textContent = e instanceof HubError ? (e.status === 429 ? 'Too many attempts; try again later.' : e.message)
      : e?.message ? `The hub did not answer (${e.message}).` : 'The hub did not answer.';
    for (const i of form.querySelectorAll('input')) i.classList.toggle('bad', !!(e?.field && i.name === e.field));
    (form.querySelector('input.bad') || form.querySelector('input'))?.focus({ preventScroll: true });
  }
  async submit(name, form) {
    if (this.busy || this.done) return;
    const f = Object.fromEntries(new FormData(form).entries());
    const err = form.querySelector('.ac-err'); err.textContent = '';
    for (const i of form.querySelectorAll('input')) i.classList.remove('bad');
    // the rules checked here first, in the same words the hub uses
    if (!f.name) return this.fail(form, { message: 'A name is needed.', field: 'name' });
    if (name !== 'signin' && !/^[A-Za-z0-9_.]{3,24}$/.test(f.name)) return this.fail(form, { message: `The name must be ${NAME_RULE}.`, field: 'name' });
    if (name === 'recover' && !f.code) return this.fail(form, { message: 'A recovery code is needed.', field: 'code' });
    if (!f.password) return this.fail(form, { message: 'A password is needed.', field: 'password' });
    if (name !== 'signin' && f.password.length < 8) return this.fail(form, { message: `The password needs ${PASS_RULE}.`, field: 'password' });
    this.setBusy(true);
    try {
      if (name === 'signin') { const r = await Hub.signin(f.name, f.password); this.finish(r.you); }
      else if (name === 'signup') { const r = await Hub.signup(f.name, f.password); this.setBusy(false); this.view('codes', { you: r.you, codes: r.recovery }); }
      else if (name === 'recover') { const r = await Hub.recover(f.name, f.code, f.password); this.setBusy(false); this.view('recovered', { you: r.you, left: r.left }); }
    } catch (e) {
      this.setBusy(false); this.fail(form, e);
    }
  }
  // Signed in (you), or exploring alone (null): the title takes over; the modal fades with the gate (title.css).
  finish(you) {
    if (this.done) return;
    this.done = true;
    this.el.classList.add('done');
    this.title.onSignedIn(you || null);
    setTimeout(() => this.el.remove(), 1200);
  }
  close() { this.done = true; this.el.remove(); }
}
