// Friends, groups and the group chat (docs/multiplayer.md, "What the player sees" 5, 6 and 8; lane 3), over hub.js.
// Redesigned 2026-11-06 after Aaron's design ("Start screen, social panel v1", docs/decisions.md "the home screen's
// social panel"): one panel in two parts.
//
// The account card: the player's wisp ringed green while friends can see them (grey while appearing offline), the
// display name, "@handle · sharing your place" (or "online", or "appearing offline"), and a menu: "Friends see" (My
// place, Just online, Nothing: the hub's presence tile, online, hidden), Change display name, Blocked people (the hub's
// blocked list, each with Unblock) and Sign out.
//
// The social panel: "Find people by name" (three characters or more; the results drop down with Add friend, Asked,
// Friend, Accept or Unblock), then three tabs. Groups: a card per group (its members' wisps, the dim ones offline, its
// name, where its members are: "2 in Upper Hoh Road", "1 online" or "quiet", and its last line), and New group. A card
// opens the group's chat in the panel: back, the name and who is in it, the info button (the edit sheet: the name, the
// members with Remove for the group's creator, Add friends, Save, Leave group), "Join Maya and Juno in <place>" when
// members share a place, the lines (each with its sender and where they were when it came, or when), and the message
// box. Friends: the online ones (Join when they share a place, Invite when not: to the place chosen on the earth, or
// the world the player is in), More (Remove friend, Block), and the offline ones folded under "Offline · N". Requests:
// the requests in (Accept, Ignore) and out (Cancel). New group and the edit sheet rise from the panel's bottom.
//
// On the home screen the panel is the right column, always open (social.css, html.opening); in the world, and on a
// phone's home screen, it drops from the row of the friends online beside the HUD's menu button (the toggle). A toast
// (#soToast) says what a press did. Nothing here is a position: presence is a state and, when a friend allows it, a tile
// id, shown as the place's name. The chat lines live in memory for the page's life (the hub keeps a group's lines 7
// days); where a line's sender was is their shared place when the line came, never sent or kept.
//
// An avatar is a wisp coloured from the user's id, drawn on a small canvas (avatarFor, exported for the chat and the
// title screen): no uploads, nothing fetched.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const DEG = Math.PI / 180;
const ROW_MAX = 8;   // avatars in the row before "+N"
const SEARCH_MIN = 3, SEARCH_WAIT_MS = 350;
const LINES_MAX = 200, TEXT_MAX = 500, GROUP_ADD_MAX = 15, TOAST_MS = 4000;

// ---- the avatar ---------------------------------------------------------------------------------------------------
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
// The wisp's colours and turn from the user's id: a hue, a second hue, which way it swirls, two or three ribbons.
export function avatarSeed(id) {
  const h = hash32(id || ''), h2 = hash32(`${id || ''}/2`);
  return { hue: h % 360, hue2: (h % 360 + 50 + h2 % 160) % 360, dir: (h2 >> 9) & 1 ? 1 : -1, arms: 2 + ((h2 >> 3) & 1), tilt: (h >> 12) % 360 };
}
// A canvas of size x size CSS pixels: a dark disc, a glow of the first hue, the ribbons spiralling out from a bright core
// through the two hues. --hue is set on the element for a ring in CSS.
export function avatarFor(id, size = 28) {
  const s = avatarSeed(id), dpr = Math.min(3, devicePixelRatio || 1), px = Math.round(size * dpr);
  const cv = document.createElement('canvas'); cv.width = cv.height = px; cv.style.width = cv.style.height = `${size}px`;
  cv.className = 'so-avatar'; cv.style.setProperty('--hue', String(s.hue));
  const g = cv.getContext('2d'); if (!g) return cv;
  const c = px / 2, R = px / 2;
  g.fillStyle = '#0f1512'; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  const glow = g.createRadialGradient(c, c, 0, c, c, R);
  glow.addColorStop(0, `hsla(${s.hue}, 80%, 60%, .5)`); glow.addColorStop(1, `hsla(${s.hue}, 80%, 50%, 0)`);
  g.fillStyle = glow; g.fillRect(0, 0, px, px);
  g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  const N = 26, turn = 2.7, dh = ((s.hue2 - s.hue + 540) % 360) - 180;   // the shorter way round the hue circle
  for (let a = 0; a < s.arms; a++) {
    const a0 = s.tilt * DEG + a * Math.PI * 2 / s.arms;
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 1) / N;
      const r0 = R * (0.1 + 0.74 * u0), r1 = R * (0.1 + 0.74 * u1), t0 = a0 + s.dir * u0 * turn, t1 = a0 + s.dir * u1 * turn;
      g.strokeStyle = `hsla(${s.hue + dh * u0}, 85%, ${68 - 22 * u0}%, ${0.95 * (1 - u0 * 0.88)})`;
      g.lineWidth = Math.max(0.6, px * 0.12 * (1 - u0 * 0.8));
      g.beginPath(); g.moveTo(c + r0 * Math.cos(t0), c + r0 * Math.sin(t0)); g.lineTo(c + r1 * Math.cos(t1), c + r1 * Math.sin(t1)); g.stroke();
    }
  }
  const core = g.createRadialGradient(c, c, 0, c, c, R * 0.34);
  core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.35, 'rgba(255,242,220,.85)'); core.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = core; g.fillRect(0, 0, px, px);
  g.globalCompositeOperation = 'source-over';
  return cv;
}

// The rows are written as HTML with a blank <canvas data-av=id data-size=px> where the avatar goes (a canvas serialises
// blank): drawn here.
const drawAvatars = root => { for (const cv of root.querySelectorAll('canvas[data-av]')) { const a = avatarFor(cv.dataset.av, +cv.dataset.size || 24); a.className = `so-avatar ${cv.className}`.trim(); cv.replaceWith(a); } };
const av = (id, size, cls = '') => `<canvas data-av="${esc(id)}" data-size="${size}"${cls ? ` class="${cls}"` : ''}></canvas>`;
// "Maya", "Maya and Juno", "Maya, Juno and Tomás"
const andList = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
const ago = at => {
  if (!at) return '';
  const s = Date.now() / 1000 - at;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return new Date(at * 1000).toLocaleDateString(undefined, { weekday: 'long' });
};

const I = {
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M15.5 14.3a4.6 4.6 0 0 1 5 4.7"/></svg>',
  find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M19 8v6M16 11h6"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/></svg>',
  go: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
};
const PRESENCE = [['tile', 'My place'], ['online', 'Just online'], ['hidden', 'Nothing']];
const PRESENCE_LINE = { tile: 'sharing your place', online: 'online', hidden: 'appearing offline' };

export class Social {
  // hub: a connected (or connecting) Hub; placeName(tileId) -> the place's name for a friend's presence; onSignOut();
  // onJoin(tileId): go where a friend or the group is (multiplayer.js: the earth chooses it, a world switches to it);
  // onInvite(userIds) -> a message for the toast (multiplayer.js: asks them to the place chosen, or the world entered).
  constructor({ hub, placeName = null, onSignOut = null, onJoin = null, onInvite = null }) {
    this.hub = hub; this.placeName = placeName || (id => id); this.onSignOut = onSignOut; this.onJoin = onJoin; this.onInvite = onInvite;
    this.open = false; this.found = null; this.foundQ = ''; this.err = ''; this.errT = null;
    this.tab = 'groups'; this.openGroup = null; this.showOffline = false; this.menuOpen = false; this.moreFor = null;
    this.sheet = null;           // null | 'create' | 'edit' | 'name' | 'blocked'
    this.edit = null;            // the edit sheet's working copy: { gid, members, add: Set, leave: armed }
    this.pick = new Set();       // New group's ticks
    this.creating = null;        // the group ids before a create: the new one is opened when the hub tells it
    this.invited = new Set();    // friends invited from the Friends tab (this page only)
    this.msgs = new Map();       // group id -> [{ from, text, at, where }] (memory only)
    this.offs = [];
    this.el = document.createElement('div'); this.el.id = 'social';
    this.el.innerHTML = `
      <div class="so-bar">
        <div class="so-avatars" aria-label="friends online"></div>
        <button type="button" class="so-toggle" aria-expanded="false" aria-controls="socialPanel" title="friends and groups">${I.people}<b class="so-n" hidden></b></button>
      </div>
      <div class="so-panel" id="socialPanel" hidden>
        <div class="so-card"></div>
        <aside class="so-aside" aria-label="Friends and groups">
          <div class="so-list">
            <div class="so-find">
              <label class="so-findbox">${I.find}<input type="search" placeholder="Find people by name" autocomplete="off" spellcheck="false" maxlength="24" aria-label="Find people by name"></label>
              <div class="so-results" hidden></div>
            </div>
            <div class="so-tabs" role="tablist"></div>
            <div class="so-body so-scroll" role="tabpanel"></div>
          </div>
          <div class="so-chat" hidden>
            <div class="so-chead"></div>
            <div class="so-cta-slot"></div>
            <div class="so-lines so-scroll" role="log" aria-live="polite"></div>
            <form class="so-send" novalidate><input class="so-draft" maxlength="${TEXT_MAX}" autocomplete="off" spellcheck="true" aria-label="Message the group"><button type="submit" class="so-sendbtn" aria-label="Send">${I.send}</button></form>
          </div>
          <div class="so-sheetwrap" hidden><div class="so-sheet so-scroll" role="dialog"></div></div>
          <p class="so-err" role="alert" hidden></p>
        </aside>
      </div>`;
    document.body.append(this.el);
    this.toastEl = document.createElement('div'); this.toastEl.id = 'soToast'; this.toastEl.setAttribute('role', 'status'); this.toastEl.hidden = true;
    document.body.append(this.toastEl);
    this.toggle = this.$('.so-toggle'); this.panel = this.$('.so-panel');
    this.toggle.onclick = () => this.setOpen(!this.open);
    this.panel.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && this.panel.contains(b)) this.act(b.dataset.act, b.dataset.id, b, e); });
    const si = this.search = this.$('.so-find input');
    si.addEventListener('input', () => this.searchSoon());
    si.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.searchNow(); }
      else if (e.key === 'Escape' && si.value) { e.stopPropagation(); si.value = ''; this.searchNow(); }
    });
    this.$('.so-send').addEventListener('submit', e => { e.preventDefault(); this.send(); });
    for (const t of ['open', 'friends', 'presence', 'me', 'close', 'signedout']) this.offs.push(hub.on(t, () => this.render()));
    this.offs.push(hub.on('open', d => this.seed(d)));
    this.offs.push(hub.on('groups', () => this.gotGroups()));
    this.offs.push(hub.on('chat', d => this.gotLine(d)));
    this.offs.push(hub.on('found', d => { if (d.q === this.foundQ) { this.found = d.users || []; this.renderResults(); } }));
    this.offs.push(hub.on('err', d => this.showErr(d)));
    // keys typed in the panel stay in it (the world's controls listen on window); Escape steps back
    this.el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') this.escape(); });
    this.el.addEventListener('keyup', e => e.stopPropagation());
    this.outside = e => { if (this.menuOpen && !e.target.closest?.('.so-card')) { this.menuOpen = false; this.renderCard(); } };
    addEventListener('pointerdown', this.outside, true);
    this.render();
  }

  $(sel) { return this.el.querySelector(sel); }
  get you() { return this.hub.you; }
  get blocked() { return new Set((this.hub.blocked || []).map(u => u.id)); }
  // The friends online first (a presence of online or tile), then offline, each by display name.
  friendsSorted() {
    const on = u => (this.hub.online.get(u.id)?.state || 'offline') !== 'offline';
    return [...this.hub.friends].sort((a, b) => (on(b) - on(a)) || (a.display || a.name).localeCompare(b.display || b.name));
  }
  // Everyone the hub has named to us, by id: for the chat's lines too (multiplayer.js).
  nameOf(id) {
    if (!id) return '';
    if (this.you?.id === id) return this.you.display || this.you.name;
    for (const list of [this.hub.friends, this.hub.requests, ...this.hub.groups.map(g => g.members), this.hub.blocked || [], this.found || []]) {
      const u = list.find(x => x.id === id); if (u) return u.display || u.name;
    }
    return 'someone';
  }
  stateOf(id) {
    const p = this.hub.online.get(id);
    if (!p || p.state === 'offline') return { cls: 'off', text: 'offline' };
    if (p.state === 'tile' && p.tile) return { cls: 'on', text: `in ${this.placeName(p.tile) || 'a world'}`, tile: p.tile };
    return { cls: 'on', text: 'online' };
  }
  isOn(id) { return id === this.you?.id || this.stateOf(id).cls === 'on'; }

  setOpen(on) {
    this.open = !!on; this.panel.hidden = !this.open; this.toggle.setAttribute('aria-expanded', String(this.open));
    this.el.classList.toggle('open', this.open);
    if (this.open) { this.render(); this.onLayout?.(); }
  }
  showErr(d) {
    if (!d?.why || d.field === 'session') return;
    const p = this.$('.so-err'); p.textContent = d.why; p.hidden = false;
    clearTimeout(this.errT); this.errT = setTimeout(() => { p.hidden = true; }, 5000);
  }
  // A short line at the bottom of the screen saying what just happened.
  toast(text) {
    const t = this.toastEl; if (!t || !text) return;
    t.textContent = text; t.hidden = false; t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => { t.classList.remove('on'); this.toastT = setTimeout(() => { t.hidden = true; }, 400); }, TOAST_MS);
  }
  escape() {
    if (this.menuOpen) { this.menuOpen = false; this.renderCard(); this.$('.so-menubtn')?.focus(); }
    else if (this.sheet) this.closeSheet();
    else if (this.found !== null) { this.search.value = ''; this.searchNow(); }
    else if (this.openGroup) { this.openGroup = null; this.render(); }
  }

  // ---- the hub's lines ------------------------------------------------------------------------------------------------
  // The welcome's last lines per group (again after a reconnect: a line already here keeps where its sender was).
  seed(d) {
    const old = this.msgs; this.msgs = new Map();
    for (const g of d.groups || []) {
      const prev = old.get(g.id) || [];
      this.msgs.set(g.id, (g.messages || []).map(m => ({ from: m.from, text: m.text, at: m.at, where: prev.find(p => p.from === m.from && p.at === m.at && p.text === m.text)?.where || null })));
    }
    this.render();
  }
  gotLine(d) {
    if (d.scope !== 'group' || !d.group) return;
    const list = this.msgs.get(d.group) || []; this.msgs.set(d.group, list);
    const me = d.from === this.you?.id, st = me ? null : this.stateOf(d.from);
    const where = me ? (this.hub.room ? this.placeName(this.hub.room) : null) : st.tile ? this.placeName(st.tile) : null;
    list.push({ from: d.from, text: d.text, at: d.at || Math.floor(Date.now() / 1000), where });
    while (list.length > LINES_MAX) list.shift();
    if (this.openGroup === d.group) this.renderChat(true); else if (this.tab === 'groups' && !this.openGroup) this.renderBody();
  }
  gotGroups() {
    if (this.creating) {
      const g = this.hub.groups.find(x => !this.creating.has(x.id) && x.created_by === this.you?.id);
      if (g) { this.creating = null; this.openGroup = g.id; this.tab = 'groups'; this.toast(`Group “${g.name || this.groupLabel(g)}” made`); }
    }
    if (this.openGroup && !this.hub.groups.some(g => g.id === this.openGroup)) { this.openGroup = null; if (this.sheet === 'edit') this.closeSheet(false); }
    this.render();
  }

  // ---- rendering ------------------------------------------------------------------------------------------------------
  render() {
    if (this.disposed) return;
    const connected = this.hub.connected;
    this.el.classList.toggle('offline', !connected);
    // the row: the friends online (the world's HUD, and a phone's home screen)
    const row = this.$('.so-avatars'); row.replaceChildren();
    const online = this.friendsSorted().filter(u => this.stateOf(u.id).cls === 'on');
    for (const u of online.slice(0, ROW_MAX)) {
      const a = avatarFor(u.id, 28), st = this.stateOf(u.id);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'so-chip'; b.title = `${u.display || u.name} · ${st.text}`; b.setAttribute('aria-label', b.title);
      b.append(a); b.onclick = () => { this.tab = 'friends'; this.openGroup = null; this.setOpen(true); }; row.append(b);
    }
    if (online.length > ROW_MAX) { const m = document.createElement('span'); m.className = 'so-more'; m.textContent = `+${online.length - ROW_MAX}`; row.append(m); }
    const n = this.$('.so-n'); n.hidden = !online.length; n.textContent = String(online.length);
    const reqIn = this.hub.requests.filter(r => r.dir === 'in').length;
    this.toggle.classList.toggle('pending', reqIn > 0);
    this.toggle.title = connected ? `friends and groups${reqIn ? ` · ${reqIn} request${reqIn > 1 ? 's' : ''}` : ''}` : 'friends and groups (not connected)';
    if (!this.open) return;
    this.renderCard();
    const inChat = !!this.openGroup && this.hub.groups.some(g => g.id === this.openGroup);
    if (!inChat) this.openGroup = null;
    this.$('.so-list').hidden = inChat; this.$('.so-chat').hidden = !inChat;
    if (inChat) this.renderChat(); else { this.renderTabs(); this.renderBody(); this.renderResults(); }
    if (this.sheet === 'blocked') this.renderSheet();
    this.onLayout?.();
  }

  // The account card and its menu.
  renderCard() {
    const card = this.$('.so-card'), you = this.you, connected = this.hub.connected;
    if (!you) { card.innerHTML = `<p class="so-note">${connected ? '' : 'connecting to the hub…'}</p>`; return; }
    const pres = ['tile', 'online', 'hidden'].includes(you.presence) ? you.presence : 'tile';
    const focusMenu = this.menuOpen && card.contains(document.activeElement);
    card.innerHTML = `
      <span class="so-me ${connected && pres !== 'hidden' ? 'lit' : ''}">${av(you.id, 36)}</span>
      <span class="so-mecol"><b class="so-myname">${esc(you.display || you.name)}</b><small>@${esc(you.name)} · ${connected ? PRESENCE_LINE[pres] : 'connecting…'}</small></span>
      <button type="button" class="so-ghost so-menubtn" data-act="menu" aria-label="Account menu" aria-haspopup="menu" aria-expanded="${this.menuOpen}">${I.dots}</button>
      ${this.menuOpen ? `<div class="so-menu" role="menu">
        <div class="so-seg-wrap"><span class="so-cap" id="soSeeCap">Friends see</span>
          <div class="so-seg" role="radiogroup" aria-labelledby="soSeeCap">${PRESENCE.map(([v, l]) => `<button type="button" role="radio" aria-checked="${pres === v}" data-act="presence" data-id="${v}">${l}</button>`).join('')}</div></div>
        <button type="button" role="menuitem" class="so-mi" data-act="displayname">Change display name</button>
        <button type="button" role="menuitem" class="so-mi" data-act="blocked">Blocked people</button>
        <button type="button" role="menuitem" class="so-mi warn" data-act="signout">Sign out</button>
      </div>` : ''}`;
    drawAvatars(card);
    if (focusMenu) card.querySelector('.so-seg [aria-checked=true]')?.focus();
  }

  renderTabs() {
    const reqIn = this.hub.requests.filter(r => r.dir === 'in').length;
    const on = this.friendsSorted().filter(u => this.stateOf(u.id).cls === 'on').length;
    const tabs = [['groups', 'Groups', 0], ['friends', 'Friends', on], ['requests', 'Requests', reqIn]];
    const box = this.$('.so-tabs'), had = box.contains(document.activeElement);
    box.innerHTML = tabs.map(([v, l, n]) => `<button type="button" role="tab" class="so-tab" id="soTab-${v}" aria-selected="${this.tab === v}" data-act="tab" data-id="${v}">${l}${n ? `<span class="so-badge ${v === 'requests' ? 'hot' : ''}">${n}</span>` : ''}</button>`).join('');
    this.$('.so-body').setAttribute('aria-labelledby', `soTab-${this.tab}`);
    if (had) box.querySelector('[aria-selected=true]')?.focus();
  }

  // Where a group's members are: the place most of those sharing one are in, the names there, how many are online.
  placeOf(g) {
    const me = this.you?.id, others = g.members.filter(m => m.id !== me), at = new Map();
    for (const m of others) { const t = this.stateOf(m.id).tile; if (t) at.set(t, [...(at.get(t) || []), m]); }
    const best = [...at.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    return { tile: best?.[0] || null, where: best ? this.placeName(best[0]) : null, names: (best?.[1] || []).map(m => m.display || m.name), on: others.filter(m => this.isOn(m.id)).length };
  }
  groupLabel(g) {
    const names = g.members.filter(m => m.id !== this.you?.id).map(m => m.display || m.name);
    return names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '') : 'just you';
  }

  renderBody() {
    const body = this.$('.so-body'), h = [], me = this.you?.id;
    if (this.tab === 'groups') {
      for (const g of this.hub.groups) {
        const pl = this.placeOf(g), last = (this.msgs.get(g.id) || []).at(-1);
        const where = pl.where ? `${pl.names.length} in ${pl.where}` : pl.on ? `${pl.on} online` : 'quiet';
        h.push(`<button type="button" class="so-gcard" data-act="open" data-id="${esc(g.id)}">
          <span class="so-ghead"><span class="so-faces">${g.members.slice(0, 4).map(m => av(m.id, 24, this.isOn(m.id) ? '' : 'dim')).join('')}</span>
            <b class="so-gname">${esc(g.name || this.groupLabel(g))}</b><span class="so-where ${pl.where || pl.on ? 'live' : ''}">${esc(where)}</span></span>
          <span class="so-last">${last ? `<b>${esc(last.from === me ? 'You' : this.nameOf(last.from))}: </b>${esc(last.text)}` : 'No messages yet'}</span></button>`);
      }
      h.push(`<button type="button" class="so-new" data-act="new">${I.plus}New group</button>`);
    } else if (this.tab === 'friends') {
      const friends = this.friendsSorted(), on = friends.filter(f => this.stateOf(f.id).cls === 'on'), off = friends.filter(f => this.stateOf(f.id).cls !== 'on');
      if (!friends.length) h.push(`<p class="so-note">No friends yet. Find people by name above, or share your handle, <b>@${esc(this.you?.name || '')}</b>.</p>`);
      for (const f of on) {
        const st = this.stateOf(f.id), here = st.tile && st.tile === this.hub.room;
        h.push(`<div class="so-frow" data-id="${esc(f.id)}"><span class="so-avw">${av(f.id, 34)}<i class="so-dot"></i></span>
          <span class="so-names"><b>${esc(f.display || f.name)}</b><small>${esc(st.tile ? (here ? `here, in ${this.placeName(st.tile)}` : st.text) : 'online')}</small></span>
          ${st.tile && !here ? `<button type="button" class="so-solid" data-act="join" data-id="${esc(f.id)}">Join</button>`
            : !st.tile ? `<button type="button" class="so-pill" data-act="invite" data-id="${esc(f.id)}"${this.invited.has(f.id) ? ' disabled' : ''}>${this.invited.has(f.id) ? 'Invited' : 'Invite'}</button>` : ''}
          ${this.moreBtn(f)}</div>${this.moreRow(f)}`);
      }
      if (off.length) {
        h.push(`<button type="button" class="so-fold" data-act="offline" aria-expanded="${this.showOffline}">${I.chev}Offline · ${off.length}</button>`);
        if (this.showOffline) for (const f of off) h.push(`<div class="so-frow off" data-id="${esc(f.id)}"><span class="so-avw">${av(f.id, 30)}</span><span class="so-names"><b>${esc(f.display || f.name)}</b><small>offline</small></span>${this.moreBtn(f)}</div>${this.moreRow(f)}`);
      }
    } else {
      const reqs = this.hub.requests, ins = reqs.filter(r => r.dir === 'in'), outs = reqs.filter(r => r.dir === 'out');
      for (const r of ins) h.push(`<div class="so-req"><span class="so-avw">${av(r.id, 34)}</span><span class="so-names"><b>${esc(r.display || r.name)}</b><small>@${esc(r.name)} · asks to be friends</small></span>
        <button type="button" class="so-solid" data-act="accept" data-id="${esc(r.id)}">Accept</button><button type="button" class="so-ghost so-round" data-act="ignore" data-id="${esc(r.id)}" aria-label="Ignore ${esc(r.display || r.name)}">${I.x}</button></div>`);
      if (!ins.length) h.push(`<p class="so-note">No requests. Share your handle, <b>@${esc(this.you?.name || '')}</b>, so friends can find you.</p>`);
      if (outs.length) {
        h.push('<p class="so-cap so-sub">Asked</p>');
        for (const r of outs) h.push(`<div class="so-req out"><span class="so-avw">${av(r.id, 30)}</span><span class="so-names"><b>${esc(r.display || r.name)}</b><small>@${esc(r.name)} · waiting</small></span>
          <button type="button" class="so-pill" data-act="cancelreq" data-id="${esc(r.id)}">Cancel</button></div>`);
      }
    }
    const top = body.scrollTop;
    body.innerHTML = h.join('');
    drawAvatars(body);
    body.scrollTop = top;
  }
  moreBtn(f) { return `<button type="button" class="so-ghost so-round so-morebtn" data-act="more" data-id="${esc(f.id)}" aria-label="More for ${esc(f.display || f.name)}" aria-expanded="${this.moreFor === f.id}">${I.dots}</button>`; }
  moreRow(f) {
    return this.moreFor === f.id ? `<div class="so-morerow" data-id="${esc(f.id)}"><button type="button" class="so-pill" data-act="unfriend" data-id="${esc(f.id)}">Remove friend</button>
      <button type="button" class="so-pill warn" data-act="block" data-id="${esc(f.id)}">Block</button></div>` : '';
  }

  renderResults() {
    const box = this.$('.so-results');
    box.hidden = this.found === null;
    if (this.found === null) { box.replaceChildren(); return; }
    if (!this.found.length) { box.innerHTML = `<p class="so-note">No one named “${esc(this.foundQ)}”.</p>`; return; }
    const blocked = this.blocked;
    box.innerHTML = this.found.map(u => {
      const friend = this.hub.friends.some(f => f.id === u.id), req = this.hub.requests.find(r => r.id === u.id);
      const act = friend ? '<span class="so-state">Friend</span>' : req?.dir === 'out' ? '<span class="so-state">Asked</span>'
        : req?.dir === 'in' ? `<button type="button" class="so-pill" data-act="accept" data-id="${esc(u.id)}">Accept</button>`
        : blocked.has(u.id) ? `<button type="button" class="so-pill" data-act="unblock" data-id="${esc(u.id)}">Unblock</button>`
        : `<button type="button" class="so-pill" data-act="add" data-id="${esc(u.id)}">Add friend</button>`;
      return `<div class="so-rrow">${av(u.id, 28)}<span class="so-names"><b>${esc(u.display || u.name)}</b><small>@${esc(u.name)}</small></span>${act}</div>`;
    }).join('');
    drawAvatars(box);
  }

  // The open group: its header, the way to where its members are, its lines.
  renderChat(fresh = false) {
    const g = this.hub.groups.find(x => x.id === this.openGroup); if (!g) return;
    const me = this.you?.id, name = g.name || this.groupLabel(g), pl = this.placeOf(g);
    const who = [...g.members.filter(m => m.id !== me).map(m => m.display || m.name), 'You'].join(', ');
    const head = this.$('.so-chead');
    const key = `${name}|${who}`;
    if (head.dataset.key !== key) {
      head.dataset.key = key;
      head.innerHTML = `<button type="button" class="so-ghost so-sq" data-act="back" aria-label="Back to groups">${I.back}</button>
        <span class="so-ctitle"><b>${esc(name)}</b><small>${esc(who)}</small></span>
        <button type="button" class="so-ghost so-round so-infobtn" data-act="info" aria-label="Group info">${I.info}</button>`;
      this.$('.so-draft').placeholder = `Message ${name}`;
    }
    const here = pl.tile && pl.tile === this.hub.room;
    this.$('.so-cta-slot').innerHTML = pl.tile && !here ? `<button type="button" class="so-cta" data-act="together" data-id="${esc(pl.tile)}">${I.go}Join ${esc(andList(pl.names))} in ${esc(pl.where)}</button>` : '';
    const box = this.$('.so-lines'), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const lines = this.msgs.get(g.id) || [];
    box.innerHTML = `<span class="so-kept">Messages go after 7 days</span>${lines.map(m => `<div class="so-line${m.from === me ? ' me' : ''}">${av(m.from, 24)}<div class="so-lbody"><span class="so-lwho"><b>${esc(m.from === me ? (this.you.display || this.you.name) : this.nameOf(m.from))}</b> · ${esc(m.where || ago(m.at))}</span><span class="so-ltext">${esc(m.text)}</span></div></div>`).join('')}
      ${lines.length ? '' : '<p class="so-note so-empty">No messages yet. Say where you’re headed.</p>'}`;
    drawAvatars(box);
    if (atEnd || fresh !== false) box.scrollTop = box.scrollHeight;
    const draft = this.$('.so-draft'); draft.disabled = !this.hub.connected;
  }
  send() {
    const input = this.$('.so-draft'), text = input.value.trim(); if (!text || !this.openGroup) return;
    if (!this.hub.chat(text, 'group', this.openGroup)) { this.toast('Not connected: the message was not sent'); return; }
    input.value = '';
  }

  // ---- the sheets: New group, the group's edit, the display name, the blocked ----------------------------------------
  openSheet(kind) {
    this.sheet = kind; this.menuOpen = false;
    if (kind === 'edit') { const g = this.hub.groups.find(x => x.id === this.openGroup); if (!g) return; this.edit = { gid: g.id, members: g.members.map(m => m.id), add: new Set(), leave: false }; }
    if (kind === 'create') this.pick = new Set();
    this.renderCard(); this.renderSheet();
    const w = this.$('.so-sheetwrap'); w.hidden = false; requestAnimationFrame(() => w.classList.add('on'));
    this.$('.so-sheet input:not([type=checkbox])')?.focus(); if (!this.$('.so-sheet input:not([type=checkbox])')) this.$('.so-sheet button')?.focus();
  }
  closeSheet(focus = true) {
    const was = this.sheet; this.sheet = null; this.edit = null;
    const w = this.$('.so-sheetwrap'); w.classList.remove('on'); w.hidden = true; this.$('.so-sheet').innerHTML = '';
    if (focus) (was === 'edit' ? this.$('.so-infobtn') : was === 'create' ? this.$('.so-new') : this.$('.so-menubtn'))?.focus();
  }
  sheetHead(title) { return `<div class="so-shead"><span class="so-stitle">${title}</span><button type="button" class="so-ghost so-round" data-act="sheetclose" aria-label="Close">${I.x}</button></div>`; }
  box(on) { return `<span class="so-box${on ? ' on' : ''}" aria-hidden="true">${on ? I.check : ''}</span>`; }
  renderSheet() {
    const s = this.$('.so-sheet'), me = this.you?.id;
    if (this.sheet === 'create') {
      const friends = this.friendsSorted(), n = this.pick.size;
      s.setAttribute('aria-label', 'New group');
      const name = s.querySelector('input[name=gname]')?.value || '';
      s.innerHTML = `${this.sheetHead('New group')}
        <label class="so-field">Name (optional)<input name="gname" maxlength="40" placeholder="e.g. Lamar herd" autocomplete="off" value="${esc(name)}"></label>
        <div class="so-fieldset"><span class="so-cap2">Bring along</span>
          ${friends.length ? friends.map(f => `<button type="button" role="checkbox" class="so-check" aria-checked="${this.pick.has(f.id)}" data-act="pick" data-id="${esc(f.id)}">${av(f.id, 26)}<span class="so-cname">${esc(f.display || f.name)}</span>${this.box(this.pick.has(f.id))}</button>`).join('')
            : '<p class="so-note">A group is made from friends. Make it now and add them later, or find friends first.</p>'}</div>
        <button type="button" class="so-big" data-act="create">${n ? `Create with ${n} ${n > 1 ? 'friends' : 'friend'}` : 'Create group'}</button>`;
    } else if (this.sheet === 'edit') {
      const g = this.hub.groups.find(x => x.id === this.edit?.gid); if (!g) { this.closeSheet(false); return; }
      const mine = g.created_by === me, e = this.edit;
      const name = s.querySelector('input[name=gname]')?.value ?? g.name ?? '';
      const memberOf = id => g.members.find(m => m.id === id) || this.hub.friends.find(f => f.id === id) || { id, name: this.nameOf(id) };
      const addable = this.friendsSorted().filter(f => !e.members.includes(f.id));
      s.setAttribute('aria-label', 'Edit group');
      s.innerHTML = `${this.sheetHead('Edit group')}
        <label class="so-field">Name<input name="gname" maxlength="40" autocomplete="off" value="${esc(name)}" placeholder="${esc(this.groupLabel(g))}"></label>
        <div class="so-fieldset"><span class="so-cap2">Members · ${e.members.length}</span>
          ${e.members.map(id => { const m = memberOf(id); return `<div class="so-mrow">${av(id, 26, this.isOn(id) ? '' : 'dim')}<span class="so-names"><b>${esc(id === me ? `${m.display || m.name} (you)` : m.display || m.name)}</b><small>${id === g.created_by ? 'made it · ' : ''}${esc(id === me ? 'you' : this.stateOf(id).text)}</small></span>
            ${mine && id !== me ? `<button type="button" class="so-pill warn" data-act="mremove" data-id="${esc(id)}">Remove</button>` : ''}</div>`; }).join('')}</div>
        ${addable.length && e.members.length + e.add.size < GROUP_ADD_MAX + 1 ? `<div class="so-fieldset"><span class="so-cap2">Add friends</span>
          ${addable.map(f => `<button type="button" role="checkbox" class="so-check" aria-checked="${e.add.has(f.id)}" data-act="madd" data-id="${esc(f.id)}">${av(f.id, 26)}<span class="so-cname">${esc(f.display || f.name)}</span>${this.box(e.add.has(f.id))}</button>`).join('')}</div>` : ''}
        <button type="button" class="so-big" data-act="save">Save</button>
        <button type="button" class="so-leave" data-act="leave">${e.leave ? `Leave ${esc(g.name || 'the group')}? Press again` : 'Leave group'}</button>`;
    } else if (this.sheet === 'name') {
      s.setAttribute('aria-label', 'Change display name');
      s.innerHTML = `${this.sheetHead('Display name')}
        <label class="so-field">What friends call you (1 to 32 characters)<input name="display" maxlength="32" autocomplete="off" value="${esc(this.you?.display || '')}"></label>
        <p class="so-note">Your handle, <b>@${esc(this.you?.name || '')}</b>, stays the same.</p>
        <button type="button" class="so-big" data-act="namesave">Save</button>`;
      s.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.act('namesave'); } });
    } else if (this.sheet === 'blocked') {
      const list = this.hub.blocked || [];
      s.setAttribute('aria-label', 'Blocked people');
      s.innerHTML = `${this.sheetHead('Blocked people')}
        ${list.length ? list.map(u => `<div class="so-mrow">${av(u.id, 26)}<span class="so-names"><b>${esc(u.display || u.name)}</b><small>@${esc(u.name)}</small></span><button type="button" class="so-pill" data-act="unblock" data-id="${esc(u.id)}">Unblock</button></div>`).join('')
          : '<p class="so-note">No one is blocked. A blocked person cannot find, friend or message you.</p>'}`;
    }
    drawAvatars(s);
  }

  // ---- presses ----------------------------------------------------------------------------------------------------------
  act(act, id, b = null) {
    const hub = this.hub, refocus = sel => requestAnimationFrame(() => this.$(sel)?.focus());
    switch (act) {
      case 'menu': this.menuOpen = !this.menuOpen; this.renderCard(); if (this.menuOpen) refocus('.so-seg [aria-checked=true]'); else refocus('.so-menubtn'); break;
      case 'presence': hub.setMe({ presence: id }); this.toast({ tile: 'Friends see the place you are in', online: 'Friends see only that you are online', hidden: 'You appear offline to friends' }[id]); break;
      case 'displayname': this.openSheet('name'); break;
      case 'blocked': this.openSheet('blocked'); break;
      case 'signout': this.onSignOut?.(); break;
      case 'tab': this.tab = id; this.moreFor = null; this.render(); refocus(`#soTab-${id}`); break;
      case 'open': this.openGroup = id; this.menuOpen = false; this.render(); refocus('.so-draft'); break;
      case 'back': { const was = this.openGroup; this.openGroup = null; this.render(); refocus(was ? `.so-gcard[data-id="${CSS.escape(was)}"]` : '#soTab-groups'); break; }
      case 'info': this.openSheet('edit'); break;
      case 'new': this.openSheet('create'); break;
      case 'together': case 'join': {
        const tile = act === 'join' ? this.stateOf(id).tile : id; if (!tile) break;
        const who = act === 'join' ? this.nameOf(id) : null;
        this.onJoin?.(tile); this.toast(`Flying to ${this.placeName(tile)}${who ? ` to join ${who}` : ''}…`); break;
      }
      case 'invite': { const msg = this.onInvite?.([id]); if (msg?.ok) { this.invited.add(id); this.renderBody(); } this.toast(msg?.text || msg); break; }
      case 'more': this.moreFor = this.moreFor === id ? null : id; this.renderBody(); break;
      case 'unfriend': if (confirm(`Remove ${this.nameOf(id)} from your friends?`)) { hub.friend('remove', id); this.moreFor = null; this.toast(`${this.nameOf(id)} is no longer a friend`); } break;
      case 'block': if (confirm(`Block ${this.nameOf(id)}? They can no longer find, friend or message you.`)) { const n = this.nameOf(id); hub.friend('block', id); this.moreFor = null; this.toast(`${n} is blocked`); } break;
      case 'offline': this.showOffline = !this.showOffline; this.renderBody(); refocus('.so-fold'); break;
      case 'accept': { const n = this.nameOf(id); hub.friend('accept', id); this.toast(`${n} is now a friend`); break; }
      case 'ignore': case 'cancelreq': hub.friend('remove', id); break;
      case 'add': if (hub.friend('request', id)) { this.toast(`Friend request sent to ${this.nameOf(id)}`); setTimeout(() => this.renderResults(), 300); } break;
      case 'unblock': { const n = this.nameOf(id); hub.friend('unblock', id); this.toast(`${n} is unblocked`); break; }
      case 'sheetclose': this.closeSheet(); break;
      case 'pick': this.pick.has(id) ? this.pick.delete(id) : this.pick.size < GROUP_ADD_MAX && this.pick.add(id); this.renderSheet(); refocus(`.so-check[data-id="${CSS.escape(id)}"]`); break;
      case 'create': {
        const name = this.$('.so-sheet input[name=gname]').value.trim().slice(0, 40);
        this.creating = new Set(hub.groups.map(g => g.id));
        if (!hub.createGroup(name, [...this.pick])) { this.creating = null; this.toast('Not connected: the group was not made'); break; }
        this.closeSheet(false); break;
      }
      case 'mremove': this.edit.members = this.edit.members.filter(x => x !== id); this.renderSheet(); break;
      case 'madd': this.edit.add.has(id) ? this.edit.add.delete(id) : this.edit.add.add(id); this.renderSheet(); refocus(`.so-check[data-id="${CSS.escape(id)}"]`); break;
      case 'save': {
        const e = this.edit, g = hub.groups.find(x => x.id === e?.gid); if (!g) { this.closeSheet(); break; }
        const name = this.$('.so-sheet input[name=gname]').value.trim().slice(0, 40);
        if (name !== (g.name || '')) hub.nameGroup(g.id, name);
        for (const m of g.members) if (!e.members.includes(m.id)) hub.removeFromGroup(g.id, m.id);
        for (const u of e.add) hub.addToGroup(g.id, u);
        this.closeSheet(); this.toast('Group saved'); break;
      }
      case 'leave': {
        const e = this.edit; if (!e) break;
        if (!e.leave) { e.leave = true; this.renderSheet(); refocus('.so-leave'); break; }
        const g = hub.groups.find(x => x.id === e.gid), n = g?.name || (g ? this.groupLabel(g) : 'the group');
        hub.leaveGroup(e.gid); this.closeSheet(false); this.openGroup = null; this.render(); this.toast(`You left ${n}`); break;
      }
      case 'namesave': {
        const v = this.$('.so-sheet input[name=display]')?.value.trim().slice(0, 32);
        if (!v) break;
        hub.setMe({ display: v }); this.closeSheet(); this.toast('Display name changed'); break;
      }
    }
  }

  // ---- search ------------------------------------------------------------------------------------------------------
  searchSoon() { clearTimeout(this.searchT); this.searchT = setTimeout(() => this.searchNow(), SEARCH_WAIT_MS); }
  searchNow() {
    clearTimeout(this.searchT);
    const q = this.search.value.trim();
    if (q.length < SEARCH_MIN) { this.found = null; this.foundQ = ''; this.renderResults(); return; }
    if (q === this.foundQ) return;
    this.foundQ = q;
    if (!this.hub.search(q)) { this.found = []; this.renderResults(); }
  }

  dispose() {
    this.disposed = true;
    for (const off of this.offs) off?.();
    removeEventListener('pointerdown', this.outside, true);
    clearTimeout(this.searchT); clearTimeout(this.errT); clearTimeout(this.toastT);
    this.el.remove(); this.toastEl.remove();
  }
}
