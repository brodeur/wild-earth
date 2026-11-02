// Friends and groups (docs/multiplayer.md, "What the player sees" 5 and 6; lane 3), over hub.js. Top left: the row of
// the avatars of the friends online and a button toggling the full list: Create group at its top, a search box (three
// characters or more; the results with Add), the friends (online first, then offline), the pending requests in and out
// (Accept, a Block option), the groups (a dialog to name one and add people from the friends; the members under the
// group's name with Leave and, for the creator, Remove), and the player's own display name and presence setting (the
// hub's `me` message). The same element stands on the earth screen and in the world's HUD (social.css places it beside
// the HUD's menu button once the opening screen is gone; multiplayer.js keeps it clear of the HUD's panels).
//
// An avatar is a wisp coloured from the user's id, drawn on a small canvas (avatarFor, exported for the chat): no
// uploads, nothing fetched. Nothing here is a position: presence is a state and, when a friend allows it, a tile id,
// which is shown as the place's name.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const DEG = Math.PI / 180;
const ROW_MAX = 8;   // avatars in the row before "+N"
const SEARCH_MIN = 3, SEARCH_WAIT_MS = 350;

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

// The rows are written as HTML with a blank <canvas data-av=id> where the avatar goes (a canvas serialises blank): drawn here.
const drawAvatars = root => { for (const cv of root.querySelectorAll('canvas[data-av]')) cv.replaceWith(avatarFor(cv.dataset.av, 24)); };

const PEOPLE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M15.5 14.3a4.6 4.6 0 0 1 5 4.7"/></svg>';

export class Social {
  // hub: a connected (or connecting) Hub; placeName(tileId) -> the place's name for a friend's presence; onSignOut().
  constructor({ hub, placeName = null, onSignOut = null }) {
    this.hub = hub; this.placeName = placeName || (id => id); this.onSignOut = onSignOut;
    this.open = false; this.found = null; this.foundQ = ''; this.blocked = new Set(); this.err = ''; this.errT = null;
    this.offs = [];
    this.el = document.createElement('div'); this.el.id = 'social';
    this.el.innerHTML = `
      <div class="so-bar">
        <div class="so-avatars" aria-label="friends online"></div>
        <button type="button" class="so-toggle" aria-expanded="false" aria-controls="socialPanel" title="friends and groups">${PEOPLE_ICON}<b class="so-n" hidden></b></button>
      </div>
      <div class="so-panel" id="socialPanel" hidden>
        <div class="so-me"></div>
        <div class="so-top"><button type="button" class="so-create">Create group</button></div>
        <div class="so-search"><input type="search" placeholder="find people by name" autocomplete="off" spellcheck="false" maxlength="24" aria-label="find people by name"><div class="so-results"></div></div>
        <p class="so-err" role="alert" hidden></p>
        <div class="so-lists"></div>
      </div>
      <div class="so-dialog" role="dialog" aria-label="create a group" hidden></div>`;
    document.body.append(this.el);
    this.toggle = this.el.querySelector('.so-toggle'); this.panel = this.el.querySelector('.so-panel');
    this.toggle.onclick = () => this.setOpen(!this.open);
    this.el.querySelector('.so-create').onclick = () => this.groupDialog();
    const si = this.search = this.el.querySelector('.so-search input');
    si.addEventListener('input', () => this.searchSoon());
    si.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.searchNow(); } });
    for (const t of ['open', 'friends', 'groups', 'presence', 'me', 'close', 'signedout']) this.offs.push(hub.on(t, () => this.render()));
    this.offs.push(hub.on('found', d => { if (d.q === this.foundQ) { this.found = d.users || []; this.renderResults(); } }));
    this.offs.push(hub.on('err', d => this.showErr(d)));
    // keys typed in the panel stay in it (the world's controls listen on window)
    this.el.addEventListener('keydown', e => e.stopPropagation());
    this.el.addEventListener('keyup', e => e.stopPropagation());
    this.render();
  }

  $(sel) { return this.el.querySelector(sel); }
  get you() { return this.hub.you; }
  // The friends online first (a presence of online or tile), then offline, each by display name.
  friendsSorted() {
    const on = u => (this.hub.online.get(u.id)?.state || 'offline') !== 'offline';
    return [...this.hub.friends].sort((a, b) => (on(b) - on(a)) || (a.display || a.name).localeCompare(b.display || b.name));
  }
  // Everyone the hub has named to us, by id: for the chat's lines too (multiplayer.js).
  nameOf(id) {
    if (!id) return '';
    if (this.you?.id === id) return this.you.display || this.you.name;
    for (const list of [this.hub.friends, this.hub.requests, ...this.hub.groups.map(g => g.members), this.found || []]) {
      const u = list.find(x => x.id === id); if (u) return u.display || u.name;
    }
    return 'someone';
  }
  stateOf(id) {
    const p = this.hub.online.get(id);
    if (!p || p.state === 'offline') return { cls: 'off', text: 'offline' };
    if (p.state === 'tile' && p.tile) return { cls: 'on', text: `in ${this.placeName(p.tile) || 'a world'}` };
    return { cls: 'on', text: 'online' };
  }

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

  // ---- rendering ------------------------------------------------------------------------------------------------------
  render() {
    if (this.disposed) return;
    const connected = this.hub.connected, you = this.you;
    this.el.classList.toggle('offline', !connected);
    // the row: the friends online
    const row = this.$('.so-avatars'); row.replaceChildren();
    const online = this.friendsSorted().filter(u => this.stateOf(u.id).cls === 'on');
    for (const u of online.slice(0, ROW_MAX)) {
      const a = avatarFor(u.id, 28); const st = this.stateOf(u.id);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'so-chip'; b.title = `${u.display || u.name} · ${st.text}`; b.setAttribute('aria-label', b.title);
      b.append(a); b.onclick = () => this.setOpen(true); row.append(b);
    }
    if (online.length > ROW_MAX) { const m = document.createElement('span'); m.className = 'so-more'; m.textContent = `+${online.length - ROW_MAX}`; row.append(m); }
    const n = this.$('.so-n'); n.hidden = !online.length; n.textContent = String(online.length);
    const reqIn = this.hub.requests.filter(r => r.dir === 'in').length;
    this.toggle.classList.toggle('pending', reqIn > 0);
    this.toggle.title = connected ? `friends and groups${reqIn ? ` · ${reqIn} request${reqIn > 1 ? 's' : ''}` : ''}` : 'friends and groups (not connected)';
    if (!this.open) return;
    // me
    const me = this.$('.so-me'); me.replaceChildren();
    if (you) {
      const av = avatarFor(you.id, 34);
      me.append(av);
      const col = document.createElement('div'); col.className = 'so-mecol';
      col.innerHTML = `<button type="button" class="so-display" title="change the display name">${esc(you.display || you.name)}</button><span class="so-handle">@${esc(you.name)}</span>
        <label class="so-presence"><span>friends see</span><select aria-label="presence"><option value="tile">which place I am in</option><option value="online">only that I am online</option></select></label>`;
      col.querySelector('select').value = you.presence === 'online' ? 'online' : 'tile';
      col.querySelector('select').onchange = e => this.hub.setMe({ presence: e.target.value });
      col.querySelector('.so-display').onclick = () => this.editDisplay();
      me.append(col);
      const out = document.createElement('button'); out.type = 'button'; out.className = 'so-signout'; out.textContent = 'Sign out'; out.onclick = () => this.onSignOut?.();
      me.append(out);
    } else {
      me.innerHTML = `<p class="so-note">${connected ? '' : 'connecting to the hub…'}</p>`;
    }
    this.renderResults();
    // the lists
    const lists = this.$('.so-lists'); const h = [];
    const reqs = this.hub.requests;
    if (reqs.length) {
      h.push('<h3>Requests</h3>');
      for (const r of reqs) {
        h.push(`<div class="so-row" data-id="${esc(r.id)}">${this.who(r)}<span class="so-state">${r.dir === 'in' ? 'asks to be friends' : 'asked'}</span>
          <span class="so-acts">${r.dir === 'in' ? `<button type="button" data-act="accept">Accept</button><button type="button" data-act="remove" title="ignore the request">Ignore</button><button type="button" data-act="block" class="warn">Block</button>`
            : '<button type="button" data-act="remove">Cancel</button>'}</span></div>`);
      }
    }
    const friends = this.friendsSorted();
    h.push(`<h3>Friends${friends.length ? ` <small>${online.length} online</small>` : ''}</h3>`);
    if (!friends.length) h.push('<p class="so-note">No friends yet. Find people by name above.</p>');
    for (const u of friends) {
      const st = this.stateOf(u.id);
      h.push(`<div class="so-row ${st.cls}" data-id="${esc(u.id)}">${this.who(u)}<span class="so-state">${esc(st.text)}</span>
        <span class="so-acts"><button type="button" data-act="remove" title="no longer friends">Remove</button><button type="button" data-act="block" class="warn" title="they can no longer find, friend or message you">Block</button></span></div>`);
    }
    const groups = this.hub.groups;
    h.push(`<h3>Groups</h3>`);
    if (!groups.length) h.push('<p class="so-note">No group yet. Create one and add friends; the chat and travelling together are the group\'s.</p>');
    for (const g of groups) {
      const mine = g.created_by === you?.id, others = friends.filter(f => !g.members.some(m => m.id === f.id));
      h.push(`<div class="so-group" data-group="${esc(g.id)}">
        <div class="so-ghead"><button type="button" class="so-gname" data-act="gname" title="rename the group">${esc(g.name || this.groupLabel(g))}</button><span class="so-gn">${g.members.length}</span>
          <span class="so-acts"><button type="button" data-act="leave" title="leave the group">Leave</button></span></div>
        <div class="so-members">${g.members.map(m => `<div class="so-row so-member ${this.stateOf(m.id).cls}" data-id="${esc(m.id)}">${this.who(m)}<span class="so-state">${m.id === you?.id ? 'you' : esc(this.stateOf(m.id).text)}${m.id === g.created_by ? ' · made it' : ''}</span>
          ${mine && m.id !== you?.id ? '<span class="so-acts"><button type="button" data-act="gremove" class="warn">Remove</button></span>' : ''}</div>`).join('')}</div>
        ${others.length && g.members.length < 16 ? `<label class="so-gadd"><select aria-label="add a friend to the group"><option value="">add a friend…</option>${others.map(f => `<option value="${esc(f.id)}">${esc(f.display || f.name)}</option>`).join('')}</select></label>` : ''}
      </div>`);
    }
    lists.innerHTML = h.join('');
    drawAvatars(lists);
    for (const b of lists.querySelectorAll('[data-act]')) b.onclick = () => this.act(b);
    for (const s of lists.querySelectorAll('.so-gadd select')) s.onchange = () => { if (s.value) this.hub.addToGroup(s.closest('.so-group').dataset.group, s.value); s.value = ''; };
    this.onLayout?.();
  }
  who(u) {
    return `<span class="so-who"><canvas data-av="${esc(u.id)}"></canvas><span class="so-names"><b>${esc(u.display || u.name)}</b><small>@${esc(u.name)}</small></span></span>`;
  }
  groupLabel(g) {
    const names = g.members.filter(m => m.id !== this.you?.id).map(m => m.display || m.name);
    return names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '') : 'just you';
  }
  renderResults() {
    const box = this.$('.so-results'); box.replaceChildren();
    if (this.found === null) return;
    if (!this.found.length) { box.innerHTML = `<p class="so-note">no one named ${esc(this.foundQ)}…</p>`; return; }
    for (const u of this.found) {
      const row = document.createElement('div'); row.className = 'so-row'; row.dataset.id = u.id;
      const friend = this.hub.friends.some(f => f.id === u.id), req = this.hub.requests.find(r => r.id === u.id);
      row.innerHTML = `${this.who(u)}<span class="so-acts">${friend ? '<span class="so-state">friend</span>'
        : req?.dir === 'out' ? '<span class="so-state">asked</span>' : req?.dir === 'in' ? '<button type="button" data-act="accept">Accept</button>'
        : this.blocked.has(u.id) ? '<button type="button" data-act="unblock">Unblock</button>' : '<button type="button" data-act="request">Add</button>'}</span>`;
      for (const b of row.querySelectorAll('[data-act]')) b.onclick = () => this.act(b);
      box.append(row);
    }
    drawAvatars(box);
  }
  // The buttons: friend ops, group ops.
  act(b) {
    const act = b.dataset.act, id = b.closest('[data-id]')?.dataset.id, gid = b.closest('[data-group]')?.dataset.group;
    if (['request', 'accept', 'remove', 'block', 'unblock'].includes(act)) {
      if (act === 'block' && !confirm(`Block ${this.nameOf(id)}? They can no longer find, friend or message you.`)) return;
      if (act === 'block') this.blocked.add(id); if (act === 'unblock') this.blocked.delete(id);
      this.hub.friend(act, id);
      if (this.found) this.renderResults();
    } else if (act === 'leave') { if (confirm('Leave this group?')) this.hub.leaveGroup(gid); }
    else if (act === 'gremove') this.hub.removeFromGroup(gid, id);
    else if (act === 'gname') {
      const g = this.hub.groups.find(x => x.id === gid), name = prompt('The group\'s name', g?.name || '');
      if (name !== null) this.hub.nameGroup(gid, name.trim().slice(0, 40));
    }
  }
  editDisplay() {
    const name = prompt('Your display name (1 to 32 characters)', this.you?.display || '');
    if (name !== null && name.trim()) this.hub.setMe({ display: name.trim().slice(0, 32) });
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

  // ---- the group dialog ----------------------------------------------------------------------------------------------
  groupDialog() {
    const d = this.$('.so-dialog'), friends = this.friendsSorted();
    d.hidden = false; this.el.classList.add('dialog');
    d.innerHTML = `<h3>Create a group</h3>
      <label>Name <small>optional</small><input name="name" maxlength="40" placeholder="the group's name" autocomplete="off"></label>
      <div class="so-pick">${friends.length ? friends.map(f => `<label class="so-pickrow"><input type="checkbox" value="${esc(f.id)}"><span class="so-who"><canvas data-av="${esc(f.id)}"></canvas><span class="so-names"><b>${esc(f.display || f.name)}</b><small>@${esc(f.name)}</small></span></span><span class="so-state">${esc(this.stateOf(f.id).text)}</span></label>`).join('')
        : '<p class="so-note">A group is made from friends; add some first. You can make the group now and add them later.</p>'}</div>
      <div class="so-dbtns"><button type="button" class="so-cancel">Cancel</button><button type="button" class="so-ok">Create</button></div>`;
    drawAvatars(d);
    d.querySelector('.so-cancel').onclick = () => this.closeDialog();
    d.querySelector('.so-ok').onclick = () => {
      const users = [...d.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value).slice(0, 15);
      this.hub.createGroup(d.querySelector('input[name=name]').value.trim(), users);
      this.closeDialog();
    };
    d.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeDialog(); });
    d.querySelector('input[name=name]').focus();
  }
  closeDialog() { const d = this.$('.so-dialog'); d.hidden = true; d.innerHTML = ''; this.el.classList.remove('dialog'); }

  dispose() {
    this.disposed = true;
    for (const off of this.offs) off?.();
    clearTimeout(this.searchT); clearTimeout(this.errT);
    this.el.remove();
  }
}
