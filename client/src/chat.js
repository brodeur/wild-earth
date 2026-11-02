import { avatarFor } from './social.js';

// The chat (docs/multiplayer.md, "What the player sees" 8; lane 3), over hub.js. Bottom left: the input, and above it
// the translucent history pane, invisible until a message arrives, fading in on each new line and out again some
// seconds after the last unless the input has focus. The chat goes to the group when the player is in one (a picker
// when in several), and to the players on the same tile once in a world (hub.room is set); on the earth with no group
// the input says there is no one to talk to yet. Lines show the sender's display name and avatar.
//
// Nothing here is logged or kept: the lines live in this element and go with it. The hub echoes the sender's own line
// back, so a line is shown once, when the hub has it.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const HIDE_MS = 7000, LINES_MAX = 200, TEXT_MAX = 500;

export class Chat {
  // hub: the Hub; nameOf(id): a display name for a user id (social.js Social.nameOf); placeName(tileId) for the picker.
  constructor({ hub, nameOf = id => id, placeName = null }) {
    this.hub = hub; this.nameOf = nameOf; this.placeName = placeName || (id => id);
    this.scope = null; this.seeded = false; this.hideT = null; this.offs = [];
    this.el = document.createElement('div'); this.el.id = 'chat';
    this.el.innerHTML = `
      <div class="ch-hist" role="log" aria-live="polite" aria-label="chat"></div>
      <form class="ch-row" novalidate>
        <select class="ch-scope" aria-label="who to talk to" hidden></select>
        <input class="ch-input" maxlength="${TEXT_MAX}" autocomplete="off" spellcheck="true" aria-label="message">
      </form>`;
    document.body.append(this.el);
    this.hist = this.el.querySelector('.ch-hist'); this.input = this.el.querySelector('.ch-input'); this.picker = this.el.querySelector('.ch-scope');
    this.el.querySelector('form').addEventListener('submit', e => { e.preventDefault(); this.send(); });
    this.input.addEventListener('focus', () => this.show(true));
    this.input.addEventListener('blur', () => this.hideSoon());
    this.picker.onchange = () => { this.scope = this.picker.value; this.refresh(); };
    // keys typed here stay here (the world's controls listen on window)
    this.el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') this.input.blur(); });
    this.el.addEventListener('keyup', e => e.stopPropagation());
    this.offs.push(hub.on('open', d => this.welcome(d)));
    this.offs.push(hub.on('groups', () => this.refresh()));
    this.offs.push(hub.on('chat', d => this.line(d)));
    this.offs.push(hub.on('err', d => { if (d.re === 'chat' && d.why) this.system(d.why); }));
    this.offs.push(hub.on('close', () => this.refresh()));
    this.offs.push(hub.on('signedout', () => { this.system('signed out'); this.refresh(); }));
    this.refresh();
  }

  // The scopes open to the player: the tile's room once in a world, and each group.
  options() {
    const out = [];
    if (this.hub.room) out.push({ key: 'tile', label: `everyone in ${this.placeName(this.hub.room) || 'this place'}` });
    for (const g of this.hub.groups) out.push({ key: `g:${g.id}`, label: g.name || this.groupLabel(g), group: g.id });
    return out;
  }
  groupLabel(g) {
    const names = g.members.filter(m => m.id !== this.hub.you?.id).map(m => m.display || m.name);
    return names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '') : 'just you';
  }
  // The room changed (multiplayer.js, from the world's entry or a tile switch): the picker follows.
  setRoom() { this.refresh(); }
  // The group the chat goes to now (null when it goes to the tile, or nowhere): the group a place is asked of.
  currentGroup() { return this.options().find(o => o.key === this.scope)?.group || null; }
  refresh() {
    const opts = this.options(), connected = this.hub.connected;
    if (!opts.some(o => o.key === this.scope)) this.scope = opts.find(o => o.key !== 'tile')?.key || opts[0]?.key || null;
    this.picker.hidden = opts.length < 2;
    this.picker.innerHTML = opts.map(o => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('');
    if (this.scope) this.picker.value = this.scope;
    const cur = opts.find(o => o.key === this.scope);
    this.input.disabled = !cur || !connected;
    this.input.placeholder = !connected ? 'not connected to the hub' : !cur ? 'no one to talk to yet: add a friend and make a group'
      : opts.length < 2 ? `message ${cur.label}` : 'message…';
    this.el.classList.toggle('idle', !cur);
  }
  welcome(d) {
    this.refresh();
    if (this.seeded) return;   // a reconnect: the lines are already here
    this.seeded = true;
    for (const g of d.groups || []) for (const m of g.messages || []) this.line({ scope: 'group', group: g.id, from: m.from, text: m.text, at: m.at }, false);
    this.hist.scrollTop = this.hist.scrollHeight;
  }

  // ---- lines ----------------------------------------------------------------------------------------------------------
  line(d, fresh = true) {
    const row = document.createElement('div'); row.className = 'ch-line';
    if (d.from === this.hub.you?.id) row.classList.add('me');
    const who = d.scope === 'tile' ? (d.name || this.nameOf(d.from)) : this.nameOf(d.from);
    const g = d.scope === 'group' ? this.hub.groups.find(x => x.id === d.group) : null;
    const tag = d.scope === 'tile' ? (this.hub.groups.length ? 'here' : '') : this.options().length > 1 && g ? (g.name || this.groupLabel(g)) : '';
    row.append(avatarFor(d.from, 18));
    const body = document.createElement('span'); body.className = 'ch-body';
    body.innerHTML = `<b class="ch-who">${esc(who)}</b>${tag ? `<i class="ch-tag">${esc(tag)}</i>` : ''}<span class="ch-text">${esc(d.text)}</span>`;
    row.append(body);
    this.push(row, fresh);
  }
  system(text) {
    const row = document.createElement('div'); row.className = 'ch-line sys'; row.textContent = text; this.push(row, true);
  }
  push(row, fresh) {
    this.hist.append(row);
    while (this.hist.children.length > LINES_MAX) this.hist.firstChild.remove();
    this.hist.scrollTop = this.hist.scrollHeight;
    if (fresh) { this.show(true); this.hideSoon(); }
  }
  show(on) {
    clearTimeout(this.hideT); this.hideT = null;
    this.hist.classList.toggle('on', on && this.hist.children.length > 0);
  }
  hideSoon() {
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => { if (document.activeElement !== this.input) this.show(false); else this.hideSoon(); }, HIDE_MS);
  }

  send() {
    const text = this.input.value.trim(); if (!text) return;
    const cur = this.options().find(o => o.key === this.scope); if (!cur) return;
    const ok = cur.key === 'tile' ? this.hub.chat(text, 'tile') : this.hub.chat(text, 'group', cur.group);
    if (!ok) { this.system('not connected: the line was not sent'); return; }
    this.input.value = '';
  }

  dispose() {
    for (const off of this.offs) off?.();
    clearTimeout(this.hideT);
    this.el.remove();
  }
}
