import { Hub } from './hub.js';
import { AccountModal } from './account.js';
import { Social, avatarFor } from './social.js';
import { Chat } from './chat.js';
import { NF } from './animalNet.js';

// The social screen's hookup (docs/multiplayer.md, lanes 3 and 4): one object main.js makes beside the title screen. It
// owns the page's Hub (hub.js) for the page's life, gives the title screen the hub to ask for config, me and the counts
// (title.js takes anything with config(), me(), watch(on), on('counts', fn) and close()), puts the sign-in modal
// (account.js) at the title's gate, and on sign-in connects the socket and mounts the friends row and list (social.js),
// the chat (chat.js) and the Video and Audio toggles (below; off, "soon" on hover, lane 5 makes them live). The same
// elements stand on the earth and in the world's HUD: layout() keeps them clear of the HUD's menu, its panels, the
// game box and the key line, whichever are showing.
//
// Going somewhere together (lane 4, the doc's item 9): a choice of place by a player in a group (the earth's
// title.choose, wrapped here, or the Location box's switch to another tile, main.js) sends `place` and the other
// members get the invite dialog, top middle, on the earth and over the HUD alike: "<picker> wants to go to <place>.
// Join · Not now". Join answers the hub and goes: on the earth the place is chosen as the player would (quietly, so no
// invite of its own goes out) and Begins itself once built; in a world the page switches to the tile. The joiner
// arrives in spirit form 6 m above and 10 m behind the picker, from the picker's relayed position (arrival.js plan's
// follow); until it comes, over the point the picker planned to arrive at (carried in the invite). The picker's chat
// pane says who joined and who declined. The dialog goes after a minute.
//
// The hub's tile room is joined when a world is entered (main.js enterWorld, through entered()) and left on a tile
// switch (left()), and while in a room and in a group the spirit's position goes to the hub at 5 Hz (hub.js pos:
// x, y, z, yaw, form; rounded to the centimetre as the hub rounds), relayed to the group members in the same room and
// kept nowhere: not on disk, not in a log, not past the room. The last one relayed from each member is held in
// `poses` for the arrival (and for debugging) and cleared when the room is left. Each relayed position also goes to the
// world's RemotePlayers (players.js, `world.players`): the member's wisp in the world, their name, their avatar at the
// screen's edge when out of view and their dot on the mini-map. A member the hub says is offline or in another tile is
// dropped from it at once; one who just stops sending fades there after a few seconds.
//
// With ?hub=stub (the title screen's own verification) nothing here is mounted: the title makes the stub itself and
// signs in by itself. The dev paths (?skip=1, ?game=1, ?as=) never make this object.
//
// Debugging, on window.__weMp: showInvite({id, from, tile, point}) shows the dialog as the hub's invite would;
// answer(true | false) presses Join or Not now; invite is the one showing; chose(tileId, point) asks the group along;
// poses holds the last position relayed per member; room the world entered (its lead and follow while arriving);
// fake(id, {x, y, z, yaw, form}) feeds a position as the hub's relay would (a test user drawn in the world, on the map
// and at the edge); fakes(n, r) runs n fake members circling the player at r m at 5 Hz (fakes(0) stops them), for the
// frame cost and the look.

const html = document.documentElement;
const POS_MS = 200;             // the position relay: 5 Hz, the doc's rate
const INVITE_MS = 60000;        // the dialog's life (the hub keeps the invite a little longer, so a late Join lands)
const FOLLOW_WINDOW_S = 2.5;    // a joiner's arrival turns to follow the picker when the picker's position comes within this long of its start
const CAMERA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 11l5-3v8l-5-3"/><path class="bar" d="M3 3l18 18"/></svg>';
const MIC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/><path class="bar" d="M3 3l18 18"/></svg>';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

export class Multiplayer {
  // hubParam: the URL's ?hub= ('stub' for the title screen's stub, else the real hub).
  constructor({ hubParam = null } = {}) {
    this.stub = hubParam === 'stub';
    this.hub = this.stub ? null : new Hub();
    this.titleHub = this.stub ? 'stub' : this.hub;   // what the title screen is given
    this.title = null; this.modal = null; this.social = null; this.chat = null; this.media = null;
    this.observer = null; this.layoutFn = () => this.layout();
    this.invite = null; this.inviteEl = null; this.inviteT = null;   // the dialog: the invite showing, its element, its expiry
    this.joining = null;     // { from, tile, point } while a Join on the earth builds the picker's tile
    this.quiet = false;      // a title.choose made by a Join: no place of its own
    this.room = null;        // the world entered: { tileId, flight, arrival, form, caption, lead, follow }
    this.posTimer = null;
    this.poses = new Map();  // user id -> the last position relayed from a group member in the room (memory only)
    this.switchTile = null;  // main.js: (tileId, xy, lead) switches the world played, a Join from a world
    this.unseen = false;     // an answer came while the chat was hidden (arriving or switching): the pane is shown again after
    // the way back from Discord (hub.py sends the browser to /client/?signin=discord or ?signin=failed): remembered for
    // the modal and taken off the URL, signed in or not
    const u = new URL(location.href); this.back = u.searchParams.get('signin');
    if (this.back) { u.searchParams.delete('signin'); history.replaceState(null, '', u.search ? `${u.pathname}${u.search}` : u.pathname); }
    window.__weMp = this;   // debugging handle
  }

  // The title screen is made: the gate gets the modal, sign-in mounts the rest, a choice asks the group along, a Join's
  // world Begins itself when built and carries the picker into the world's entry.
  attach(title) {
    this.title = title;
    if (this.stub) return;
    title.onGate = t => { this.modal = new AccountModal({ title: t, back: this.back }); };
    title.onLit = user => this.signedIn(user);
    const choose = title.choose.bind(title);
    title.choose = id => {
      const was = title.sel; choose(id);
      if (title.sel === id && was !== id && !this.quiet) this.chose(id, title.points?.[id] || null);
    };
    const setReady = title.setReady.bind(title);
    title.setReady = id => {
      setReady(id); const tid = id ?? title.tileId;
      if (this.joining && tid === this.joining.tile && title.sel === tid) title.begin();   // the joiner pressed Join, not Begin
    };
    const onBegin = title.onBegin;
    title.onBegin = c => {
      const j = this.joining;
      if (j && c.tileId === j.tile) { c.point = j.point || c.point; c.lead = j.from; }   // the arrival behind the picker (main.js enterWorld)
      this.joining = null;
      onBegin?.(c);
    };
  }
  placeName(tileId) { return this.title?.byId?.[tileId]?.name || null; }

  // Signed in as `user` (null: exploring alone with no hub; nothing social then).
  signedIn(user) {
    if (!user || !this.hub || this.social) return;
    const placeName = id => this.placeName(id);
    this.social = new Social({ hub: this.hub, placeName, onSignOut: () => this.signOut() });
    this.chat = new Chat({ hub: this.hub, nameOf: id => this.social.nameOf(id), placeName });
    this.social.onLayout = this.layoutFn;
    this.mountMedia();
    const hub = this.hub;
    hub.on('invite', d => this.showInvite(d));
    hub.on('placed', d => this.chat?.system(d.to ? `asked your group to come to ${placeName(d.tile) || d.tile}` : 'no one else in the group to ask along'));
    hub.on('answer', d => { this.chat?.system(`${this.social.nameOf(d.from)} ${d.join ? 'joined' : 'declined'}`); this.unseen = true; });
    hub.on('err', d => { if ((d.re === 'place' || d.re === 'answer') && d.why) this.chat?.system(d.why); });
    hub.on('pos', d => this.gotPos(d));
    hub.on('presence', d => {   // a member gone offline or to another tile is no longer seen here (players.js)
      if (d.state === 'offline' || (d.state === 'tile' && d.tile && this.room && d.tile !== this.room.tileId)) { this.poses.delete(d.user); this.room?.players?.drop(d.user); }
    });
    hub.connect();
    addEventListener('resize', this.layoutFn);
    // the HUD's menu (html.menu), the game box and the opening class change under us: keep clear of them
    this.observer = new MutationObserver(this.layoutFn);
    this.observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    const game = document.getElementById('game'); if (game) this.observer.observe(game, { attributes: true, attributeFilter: ['class', 'style'] });
    this.layout();
  }
  async signOut() {
    try { await Hub.signout(); } catch (e) { /* the session may be gone already */ }
    this.hub?.close();
    location.reload();   // back to the title and the sign-in
  }

  // ---- going somewhere together ---------------------------------------------------------------------------------------
  // The player chose a place (the earth's choose; the Location box's switch to another tile, from main.js): the group is
  // asked along. Which group, when in several: the chat's scope when it is a group, else the first (the picker's rule).
  // point: the planned arrival, tile-local { x, north }, or null for the centre.
  chose(tileId, point = null) {
    if (!this.hub || !this.hub.groups.length) return false;
    const group = this.chat?.currentGroup() || this.hub.groups[0].id;
    return this.hub.place(tileId, group, point);
  }
  // The hub's invite {id, from, group, tile, season, point?}: the dialog. A newer one replaces an older unanswered one.
  showInvite(d) {
    if (!this.social || !d?.tile || d.from === this.hub?.you?.id) return;
    this.closeInvite();
    this.invite = { id: d.id, from: d.from, group: d.group || null, tile: d.tile, season: d.season || null, point: d.point || null };
    const name = this.social.nameOf(d.from), place = this.placeName(d.tile) || d.tile;
    const el = this.inviteEl = document.createElement('div'); el.id = 'invite'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-live', 'assertive');
    el.innerHTML = `<div class="iv-row"><span class="iv-av"></span><span class="iv-text"><b>${esc(name)}</b> wants to go to <b>${esc(place)}</b>.</span></div>
      <div class="iv-btns"><button type="button" class="iv-join">Join</button><button type="button" class="iv-no">Not now</button></div>`;
    el.querySelector('.iv-av').replaceWith(avatarFor(d.from, 30));
    el.querySelector('.iv-join').onclick = () => this.answer(true);
    el.querySelector('.iv-no').onclick = () => this.answer(false);
    el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') this.answer(false); });   // keys here stay here
    el.addEventListener('keyup', e => e.stopPropagation());
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('on'));
    this.inviteT = setTimeout(() => this.closeInvite(), INVITE_MS);
    this.layout();
  }
  closeInvite() {
    clearTimeout(this.inviteT); this.inviteT = null;
    const el = this.inviteEl; this.inviteEl = null; this.invite = null;
    if (el) { el.classList.remove('on'); setTimeout(() => el.remove(), 400); }
  }
  // Join or Not now. Join answers the hub and goes: on the earth, the place is chosen as the player would (quietly) and
  // Begins itself when built (attach); in a world, the page switches to the tile (main.js switchWorld). Not now answers
  // and leaves the player where they are. Returns whether there was an invite to answer.
  answer(join) {
    const inv = this.invite; if (!inv) return false;
    this.closeInvite();
    this.hub?.answer(inv.id, join);
    if (!join) return true;
    const title = this.title, onEarth = html.classList.contains('opening') && title && !title.closed;
    if (onEarth) {
      if (title.phase !== 'lit' || title.begun) return true;   // the earth is not up yet, or is already leaving
      this.joining = { from: inv.from, tile: inv.tile, point: inv.point };
      this.quiet = true;
      try { title.choose(inv.tile); } finally { this.quiet = false; }
      if (title.sel === inv.tile && title.readyIds.has(inv.tile)) title.begin();   // built already (chosen before)
      else if (title.sel !== inv.tile) this.joining = null;
    } else if (this.switchTile) this.switchTile(inv.tile, inv.point, inv.from);
    return true;
  }

  // ---- the room, and the positions -----------------------------------------------------------------------------------
  // A world is entered (main.js enterWorld, the arrival just started): the hub's room is the tile, the chat's picker
  // follows, and the spirit's position goes to the hub at 5 Hz. world: { flight, arrival, form(), caption(point), lead }:
  // lead is the picker's user id when this entry answers an invite; the picker's position (the hub sends the room's
  // group members' last positions on entry, then each tick) within the arrival's first seconds turns the arrival to end
  // behind the picker, sliding with them, and the caption says where they are; later, the arrival goes on to the
  // picker's planned point and a position after that is only kept.
  entered(tileId, world = null) {
    if (!this.hub || !tileId) return;
    this.left(false);
    this.hub.enter(tileId);
    this.chat?.setRoom();
    this.room = { tileId, flight: world?.flight || null, arrival: world?.arrival || null, form: world?.form || null, body: world?.body || null, caption: world?.caption || null, lead: world?.lead || null, follow: null, players: world?.players || null };
    if (this.room.players && this.social) this.room.players.nameOf = id => this.social.nameOf(id);
    if (this.room.flight) this.posTimer = setInterval(() => this.sendPos(), POS_MS);
  }
  // The world is left (a tile switch): out of the room until the next world's entry; the positions held go.
  left(tell = true) {
    clearInterval(this.posTimer); this.posTimer = null; this.fakes(0);
    this.room?.players?.clear();
    this.room = null; this.poses.clear();
    if (tell && this.hub?.room) { this.hub.enter(null); this.chat?.setRoom(); }
  }
  sendPos() {
    const r = this.room; if (!r?.flight || !this.hub) return;
    const P = r.flight.pos, m = { x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r2(r.flight.yaw), form: r.form?.() || 'spirit' };
    // in a body: its pose as the animal stream has an animal (bodySample.js), so the group draws the animal (players.js)
    const b = this.bodyB ||= new Float32Array(32), c = this.bodyC ||= new Float32Array(8);
    if (m.form !== 'spirit' && r.body && r.body(b, c) >= 0) { m.b = Array.from(b.subarray(0, NF), r3); m.c = Array.from(c, r3); }
    this.hub.pos(m);
  }
  gotPos(d) {
    this.poses.set(d.user, d);
    const r = this.room; if (!r) return;
    r.players?.sample(d);
    if (!r.lead || d.user !== r.lead) return;
    const a = r.arrival; if (!a) { r.lead = null; return; }
    if (!a.active) { r.lead = null; r.follow = null; return; }   // arrived: free
    if (r.follow) { Object.assign(r.follow, { x: d.x, y: d.y, z: d.z, yaw: d.yaw }); return; }   // the arrival slides with the picker
    if (a.t > FOLLOW_WINDOW_S) { r.lead = null; return; }   // too late to turn: on to the picker's planned point
    r.follow = { x: d.x, y: d.y, z: d.z, yaw: d.yaw };
    a.plan(null, r.follow);
    r.caption?.({ x: d.x, north: -d.z });
  }

  // Debugging: a position as the hub would relay it, from a test user (named by `name` in the social list's found users,
  // so the label and the chat have a name for it). fakes(n, r): n of them circling the player at r m, at 5 Hz.
  fake(id, p, name = null) {
    if (name && this.social) { const f = this.social.found || (this.social.found = []); if (!f.some(u => u.id === id)) f.push({ id, name, display: name }); }
    this.gotPos({ t: 'pos', user: id, x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, form: p.form || 'spirit', ...(p.b ? { b: p.b, c: p.c } : {}) });
  }
  fakes(n = 4, r = 15) {
    clearInterval(this.fakeT); this.fakeT = null;
    for (let i = 0; i < 8; i++) this.room?.players?.drop(`fake-${i}`);
    if (!n || !this.room?.flight) return;
    const t0 = performance.now();
    this.fakeT = setInterval(() => {
      const P = this.room?.flight?.pos; if (!P) return;
      const t = (performance.now() - t0) / 1000;
      for (let i = 0; i < n; i++) {
        const a = t * 0.25 + i * Math.PI * 2 / n, R = r * (1 + 0.5 * (i % 3));
        this.fake(`fake-${i}`, { x: r2(P.x + Math.cos(a) * R), y: r2(P.y + 1 + 0.5 * Math.sin(t + i)), z: r2(P.z + Math.sin(a) * R), yaw: r2(-a), form: i % 2 ? 'spirit' : 'odocoileus_hemionus' }, `fake ${i + 1}`);
      }
    }, POS_MS);
  }

  // Video and Audio, top middle (docs item 7): two toggles, off, "soon" on hover, nothing behind them until lane 5.
  mountMedia() {
    const el = this.media = document.createElement('div'); el.id = 'media';
    el.innerHTML = `<button type="button" class="md-btn" aria-pressed="false" aria-disabled="true" data-soon="video: soon" title="video with your group: soon">${CAMERA_ICON}</button>
      <button type="button" class="md-btn" aria-pressed="false" aria-disabled="true" data-soon="audio: soon" title="voice with your group: soon">${MIC_ICON}</button>`;
    document.body.append(el);
  }

  // Keep the social list, the chat and the toggles clear of the HUD's panels when both are showing: the list right of
  // the HUD's readouts while the menu is open, the chat above the key line, the toggles under the game box, the invite
  // under the toggles.
  layout() {
    const inWorld = !html.classList.contains('opening'), menu = html.classList.contains('menu');
    const hidden = html.classList.contains('arriving') || html.classList.contains('switching');
    if (this.unseen && !hidden && this.chat) { this.unseen = false; this.chat.show(true); this.chat.hideSoon(); }   // who joined, once the picker has arrived
    else if (this.unseen && hidden) this.chat?.show(false);
    const H = innerHeight;
    if (this.social) {
      const panel = this.social.panel; panel.style.left = '';
      if (inWorld && menu && this.social.open) {
        const hud = document.getElementById('hud')?.getBoundingClientRect();
        if (hud && hud.width) panel.style.left = `${Math.round(hud.right + 10 - this.social.el.getBoundingClientRect().left)}px`;
      }
    }
    if (this.chat) {
      const help = document.getElementById('help'), card = document.getElementById('speciesCard');
      const showing = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';   // laid out and not hidden (the body's row replaces the key line: display none)
      let bottom = 12;
      if (inWorld && menu && showing(help)) bottom = Math.max(bottom, Math.round(H - help.getBoundingClientRect().top + 8));
      if (inWorld && showing(card)) bottom = Math.max(bottom, Math.round(H - card.getBoundingClientRect().top + 8));
      this.chat.el.style.bottom = `${bottom}px`;
    }
    let top = 12;
    if (this.media) {
      const game = document.getElementById('game');
      if (inWorld && game && !game.classList.contains('hidden')) top = Math.round(game.getBoundingClientRect().bottom + 8);
      this.media.style.top = `${top}px`;
    }
    if (this.inviteEl) this.inviteEl.style.top = `${top + (this.media?.getBoundingClientRect().height || 34) + 10}px`;
  }

  dispose() {
    this.left(false);
    this.closeInvite();
    this.observer?.disconnect(); removeEventListener('resize', this.layoutFn);
    this.modal?.close(); this.social?.dispose(); this.chat?.dispose(); this.media?.remove();
    this.hub?.close();
    if (window.__weMp === this) delete window.__weMp;
  }
}
