import { Hub } from './hub.js';
import { AccountModal } from './account.js';
import { Social, avatarFor } from './social.js';
import { Chat } from './chat.js';
import { NF } from './animalNet.js';
import { Voice } from './voice.js';
import { FollowToast, FollowVeil } from './follow.js';

// The social screen's hookup (docs/multiplayer.md, lanes 3 and 4): one object main.js makes beside the title screen. It
// owns the page's Hub (hub.js) for the page's life, gives the title screen the hub to ask for config, me and the counts
// (title.js takes anything with config(), me(), watch(on), on('counts', fn) and close()), puts the sign-in modal
// (account.js) at the title's gate, and on sign-in connects the socket and mounts the friends row and list (social.js),
// the chat (chat.js) and voice and video with the group (voice.js: the microphone and camera toggles in the row beside
// the menu button, index.html #ctlRow, shown while another group member is in the same world). The same elements stand
// on the earth and in the world's HUD: layout() keeps them clear of the HUD's menu, its panels, the game box and the
// key line, whichever are showing, and the friends row right of the controls row.
//
// Going somewhere together (lane 4, the doc's item 9; the home screen's Invite since 2026-11-04): on the earth the
// player chooses a place and presses Invite (title.onInvite): a picker lists their groups and their friends, and the
// chosen are sent `place` (a group, the people named, or both); in a world the Location box's switch to another tile
// still asks the player's group along (main.js). The invited get the invite dialog, top middle, on the earth and over
// the HUD alike: "<picker> wants to go to <place>. Join · Not now". Join answers the hub and goes: on the earth the
// place is chosen as the player would (quietly, so no invite of its own goes out) and its world starts building; the
// joiner presses Start when they are ready (each player starts on their own); in a world the page switches to the tile.
// The joiner arrives in spirit form 6 m above and 10 m behind the picker, from the picker's relayed position (arrival.js
// plan's follow); until it comes, behind and above where the picker arrives (the point carried in the invite). The
// picker's card over the place shows who was asked, who is on the way and who is there (title.peopleAt), and the chat
// pane says who joined and who declined. The dialog goes after a minute.
//
// The hub's tile room is joined when a world is entered (main.js enterWorld, through entered()) and left on a tile
// switch (left()), and while in a room and in a group the spirit's position goes to the hub at 5 Hz (hub.js pos:
// x, y, z, yaw, form; rounded to the centimetre as the hub rounds), relayed to the group members in the same room and
// kept nowhere: not on disk, not in a log, not past the room. The last one relayed from each member is held in
// `poses` for the arrival (and for debugging) and cleared when the room is left. Each relayed position also goes to the
// world's RemotePlayers (players.js, `world.players`): the member's wisp in the world, their name, their avatar at the
// screen's edge when out of view and their dot on the mini-map. A member the hub says is offline or in another tile is
// dropped from it at once; one who just stops sending fades there after a few seconds. The same positions tell voice.js
// who is here (the row's mic and camera show while anyone is) and where each voice and video tile is.
//
// With ?hub=stub (the title screen's own verification) nothing here is mounted: the title makes the stub itself and
// signs in by itself. The dev paths (?skip=1, ?game=1, ?as=) never make this object.
//
// Group follow (Aaron, 2026-11-06; docs/multiplayer.md "Group follow"; the toast and the veil are follow.js): a player in
// a group who presses Start on the home screen asks the group's online members to join them (`place` with follow; not a
// joiner's own Start). Each gets the invitation (FollowToast: Join, Decline, gone after followMs). Join fades the screen
// to black (FollowVeil), the inviter's tile is built in place of whatever the joiner has (main.js followTile: the home
// screen closed, or the world played torn down, as a tile switch does), the bar following the build's steps (step());
// the world is entered with no arrival flight, and the hub's room join brings the inviter's last relayed position, from
// which the joiner is put behind them facing the same way (main.js place, arrival.js plan's follow): 6 m above and 10 m
// back when the inviter is a spirit or a flier, on the ground 6 m back when a ground animal. With no position within
// LEAD_WAIT_MS, behind the inviter's planned arrival. Then the veil fades out. A joiner already in the inviter's tile is
// only moved. Nothing is kept: the position is the relay's, used once.
//
// Debugging, on window.__weMp: showInvite({id, from, tile, point}) shows the dialog as the hub's invite would;
// answer(true | false) presses Join or Not now; placed is the last group follow's placement (the inviter's pose, ground or
// air, and where the joiner was put); toast and veil are the follow invitation and the Join's veil (follow.js); invite is the one showing; chose(tileId, point) asks the group along;
// poses holds the last position relayed per member; room the world entered (its lead and follow while arriving);
// fake(id, {x, y, z, yaw, form}) feeds a position as the hub's relay would (a test user drawn in the world, on the map
// and at the edge); fakes(n, r) runs n fake members circling the player at r m at 5 Hz (fakes(0) stops them), for the
// frame cost and the look.

const html = document.documentElement;
const POS_MS = 200;             // the position relay: 5 Hz, the doc's rate
const INVITE_MS = 60000;        // the dialog's life (the hub keeps the invite a little longer, so a late Join lands)
const LEAD_WAIT_MS = 6000;       // group follow: how long the veil waits for the inviter's position before the planned point
const FOLLOW_WINDOW_S = 2.5;    // a joiner's arrival turns to follow the picker when the picker's position comes within this long of its start
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

export class Multiplayer {
  // hubParam: the URL's ?hub= ('stub' for the title screen's stub, else the real hub).
  constructor({ hubParam = null } = {}) {
    this.stub = hubParam === 'stub';
    this.hub = this.stub ? null : new Hub();
    this.titleHub = this.stub ? 'stub' : this.hub;   // what the title screen is given
    this.title = null; this.modal = null; this.social = null; this.chat = null; this.voice = null;
    this.observer = null; this.layoutFn = () => this.layout();
    this.invite = null; this.inviteEl = null; this.inviteT = null;   // the dialog: the invite showing, its element, its expiry
    this.joining = null;     // { from, tile, point } while a Join on the earth builds the picker's tile
    this.quiet = false;      // a title.choose made by a Join: no place of its own
    this.room = null;        // the world entered: { tileId, flight, arrival, form, caption, lead, follow }
    this.posTimer = null;
    this.poses = new Map();  // user id -> the last position relayed from a group member in the room (memory only)
    this.switchTile = null;  // main.js: (tileId, xy, lead) switches the world played, a Join from a world
    this.unseen = false;     // an answer came while the chat was hidden (arriving or switching): the pane is shown again after
    this.asked = new Map();  // tile id -> Map(user id -> 'asked' | 'join' | 'no'): whom this player invited there (this page only)
    this.pickEl = null;      // the invite picker (the home screen's Invite)
    this.followMs = INVITE_MS;   // group follow: the invitation's life
    this.toast = null;       // the follow invitation showing (follow.js FollowToast), with .inv the hub's invite
    this.veil = null;        // the black veil and loading bar of a Join (follow.js FollowVeil)
    this.following = null;   // { from, tile, point, name } from a follow Join until its world is entered
    this.followTile = null;  // main.js: (tileId, xy, lead) builds the tile in place of the home screen or the world, entered as a follow
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
    title.choose = id => {   // another place than the one an accepted invite named: no longer joining anyone
      if (this.joining && id !== this.joining.tile && !this.quiet) this.joining = null;
      this.closePick(); choose(id);
    };
    const onBegin = title.onBegin;
    title.onBegin = c => {
      const j = this.joining;
      if (j && c.tileId === j.tile) { c.point = j.point || c.point; c.lead = j.from; }   // the arrival behind the picker (main.js enterWorld)
      else this.askFollow(c.tileId, c.point || null);   // Start: the group is asked to follow (group follow)
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
    if (this.title && !this.title.closed) {   // the home screen: the social panel open on the right, Invite live, the card's players
      this.social.setOpen(true);
      this.title.onInvite = (tile, btn) => this.openPick(tile, btn);
      this.title.peopleAt = tile => this.peopleAt(tile);
      this.title.renderBar?.();
    }
    const refresh = () => this.title?.refreshPeople?.();

    this.chat = new Chat({ hub: this.hub, nameOf: id => this.social.nameOf(id), placeName });
    this.social.onLayout = this.layoutFn;
    const $ = id => document.getElementById(id);
    this.voice = new Voice({ hub: this.hub, row: { mic: $('micBtn'), cam: $('camBtn'), self: $('selfView') }, onRow: this.layoutFn });
    const hub = this.hub;
    hub.on('invite', d => (d.follow ? this.showFollow(d) : this.showInvite(d)));
    hub.on('placed', d => {
      if (d.follow) { if (d.to) { this.chat?.system(`asked ${d.to} ${d.to === 1 ? 'person' : 'people'} in your group to join you at ${placeName(d.tile) || d.tile}`); this.unseen = true; } return; }
      this.chat?.system(d.to ? `asked ${d.to} ${d.to === 1 ? 'person' : 'people'} to come to ${placeName(d.tile) || d.tile}` : 'no one else to ask along');
    });
    hub.on('answer', d => {
      this.chat?.system(`${this.social.nameOf(d.from)} ${d.join ? 'joined' : 'declined'}`); this.unseen = true;
      for (const m of this.asked.values()) if (m.has(d.from)) m.set(d.from, d.join ? 'join' : 'no');
      this.title?.refreshPeople?.();
    });
    for (const t of ['presence', 'groups', 'friends', 'open']) hub.on(t, () => this.title?.refreshPeople?.());
    hub.on('err', d => { if ((d.re === 'place' || d.re === 'answer') && d.why) this.chat?.system(d.why); });
    hub.on('pos', d => this.gotPos(d));
    hub.on('presence', d => {   // a member gone offline or to another tile is no longer seen here (players.js)
      if (d.state === 'offline' || (d.state === 'tile' && d.tile && this.room && d.tile !== this.room.tileId)) { this.poses.delete(d.user); this.room?.players?.drop(d.user); this.voice?.gone(d.user); }
    });
    hub.connect();
    addEventListener('resize', this.layoutFn);
    // the HUD's menu (html.menu), the game box and the opening class change under us: keep clear of them
    this.barObserver = new ResizeObserver(this.layoutFn); this.barObserver.observe(this.social.el.querySelector('.so-bar'));   // the friends row grows and shrinks
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
    this.toast?.close(); this.toast = null;
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
      try { title.choose(inv.tile); } finally { this.quiet = false; }   // its world starts building; the joiner presses Start
      if (title.sel !== inv.tile) this.joining = null;
      title.refreshPeople?.();
    } else if (this.switchTile) this.switchTile(inv.tile, inv.point, inv.from);
    return true;
  }

  // ---- group follow ----------------------------------------------------------------------------------------------------
  // Start pressed on the home screen: the group (the chat's, else the first with anyone else in it) is asked to follow.
  askFollow(tileId, point = null) {
    const hub = this.hub, me = hub?.you?.id; if (!hub || !tileId) return false;
    const others = g => g?.members?.some(m => m.id !== me);
    const cur = this.chat?.currentGroup(), group = others(hub.groups.find(g => g.id === cur)) ? cur : hub.groups.find(others)?.id;
    return group ? hub.place(tileId, group, point, null, true) : false;
  }
  // The hub's invite with follow: the toast. A newer one replaces an older unanswered one; none while a Join is loading.
  showFollow(d) {
    if (!this.social || !d?.tile || d.from === this.hub?.you?.id || this.veil?.active) return;
    this.closeInvite();
    const name = this.social.nameOf(d.from), place = this.placeName(d.tile) || d.tile;
    const inv = { id: d.id, from: d.from, group: d.group || null, tile: d.tile, point: d.point || null, name, place };
    const t = this.toast = new FollowToast({ from: d.from, name, place, ms: this.followMs,
      onJoin: () => { this.toast = null; this.hub?.answer(inv.id, true); this.follow(inv); },
      onDecline: () => { this.toast = null; this.hub?.answer(inv.id, false); },
      onExpire: () => { if (this.toast === t) this.toast = null; } });
    t.inv = inv;
    this.layout();
  }
  // Join: to black, build the inviter's tile (or, already there, only move), then behind the inviter (entered, gotPos).
  async follow(inv) {
    const veil = this.veil ||= new FollowVeil();
    this.closePick();
    const f = this.following = { from: inv.from, tile: inv.tile, point: inv.point, name: inv.name };
    await veil.show(inv.name, inv.place);
    if (this.following !== f) return;
    if (this.room?.tileId === inv.tile && this.room.place) {   // already in the inviter's tile: no build, only the move
      this.following = null; veil.ready();
      this.awaitLead(f.from, this.poses.get(f.from));
      return;
    }
    if (!this.followTile) { this.following = null; veil.fail('could not load the place'); return; }
    veil.step('loadTile'); veil.status('loading the place');
    let w = null;
    try { w = await this.followTile(inv.tile, inv.point, inv.from); } catch (e) { console.error(e); }
    if (this.following === f) { this.following = null; veil.fail(`could not load ${inv.place}`); }   // overtaken or failed: never entered
    return w;
  }
  // main.js buildSteps: the build's steps and words, for the veil's bar while a Join loads.
  step(tileId, name) { if (this.following && this.veil?.active) this.veil.step(name); }
  buildStatus(tileId, text) { if (this.following && this.veil?.active && text) this.veil.status(text.replace(/…$/, '')); }
  // Entered (or already in the tile): wait for the inviter's position, put the joiner behind them, lift the veil.
  awaitLead(lead, pose = null) {
    const r = this.room; if (!r?.place) { this.veil?.done(0); return; }
    clearTimeout(r.leadT);
    r.waitLead = lead;
    if (pose) { this.placeBehind(pose); return; }
    this.veil?.status(`finding ${this.social?.nameOf(lead) || 'them'}`);
    r.leadT = setTimeout(() => {
      if (this.room !== r || r.waitLead !== lead) return;
      r.waitLead = null; r.place(null);   // no position: behind the inviter's planned arrival
      this.liftVeil();
    }, LEAD_WAIT_MS);
  }
  placeBehind(d) {
    const r = this.room; if (!r?.place) return;
    clearTimeout(r.leadT); r.waitLead = null;
    const ground = !!d.form && d.form !== 'spirit' && r.kind?.(d.form) === 'ground';
    r.place({ x: d.x, y: d.y, z: d.z, yaw: d.yaw || 0, ground });
    const P = r.flight?.pos;   // debugging: the inviter's pose used and where the joiner was put
    this.placed = { lead: { x: d.x, y: d.y, z: d.z, yaw: d.yaw || 0, form: d.form || 'spirit' }, ground, me: P ? { x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r2(r.flight.yaw) } : null };
    this.liftVeil();
  }
  // a few frames drawn behind the black (the ground around the new place streams in) before the veil fades
  liftVeil() {
    const veil = this.veil; if (!veil?.active) return;
    veil.status('');
    let n = 0; const t0 = performance.now();
    const go = () => { if (++n >= 3 && performance.now() - t0 > 700) { veil.done(); return; } setTimeout(go, 120); };
    requestAnimationFrame(() => setTimeout(go, 120));
    setTimeout(() => { if (veil.active && !veil.el?.classList.contains('out')) veil.done(0); }, 4000);   // a hidden page draws no frames
  }

  // ---- the home screen's Invite ----------------------------------------------------------------------------------------
  // Who is at or coming to a tile, for the card over the place (title.renderPeople): the friends and group members the
  // hub says are there (their presence, when they share their place), the people this player asked (asked, on the way,
  // not now), and, for a joiner, the one who asked them.
  peopleAt(tile) {
    if (!this.hub || !this.social) return [];
    const out = new Map(), name = id => this.social.nameOf(id), me = this.hub.you?.id;
    for (const [id, p] of this.hub.online) if (id !== me && p.state === 'tile' && p.tile === tile) out.set(id, { id, name: name(id), state: 'here' });
    for (const [id, st] of this.asked.get(tile) || []) if (!out.has(id)) out.set(id, { id, name: name(id), state: st === 'join' ? 'coming' : st === 'no' ? 'declined' : 'asked' });
    const j = this.joining; if (j && j.tile === tile && !out.has(j.from)) out.set(j.from, { id: j.from, name: name(j.from), state: 'invited' });
    return [...out.values()];
  }
  // The picker over the Invite button: the player's groups (each asks all its members) and friends (online first), ticked
  // and sent as one `place` per group and one for the friends not in a ticked group, each carrying the planned point.
  openPick(tile, btn) {
    if (this.pickEl) { this.closePick(); return; }
    if (!this.hub || !this.social) return;
    const hub = this.hub, me = hub.you?.id, st = id => this.social.stateOf(id);
    const el = this.pickEl = document.createElement('div'); el.id = 'invitePick'; el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `invite to ${this.placeName(tile) || tile}`);
    const groups = hub.groups.filter(g => g.members.some(m => m.id !== me));
    const friends = this.social.friendsSorted();
    const online = id => st(id).cls === 'on';
    el.innerHTML = `<h3>Invite to <b>${esc(this.placeName(tile) || tile)}</b></h3>
      ${groups.length ? `<h4>Groups</h4><div class="ip-list">${groups.map(g => {
        const others = g.members.filter(m => m.id !== me), on = others.filter(m => online(m.id)).length;
        return `<label class="ip-row"><input type="checkbox" data-group="${esc(g.id)}"><span class="ip-gav">${others.slice(0, 4).map(m => `<canvas data-av="${esc(m.id)}"></canvas>`).join('')}</span>
          <span class="ip-who"><b>${esc(g.name || others.map(m => m.display || m.name).join(', '))}</b><small>${others.length} ${others.length === 1 ? 'member' : 'members'} · ${on} online</small></span></label>`;
      }).join('')}</div>` : ''}
      ${friends.length ? `<h4>Friends</h4><div class="ip-list">${friends.map(f => `<label class="ip-row ${online(f.id) ? 'on' : 'off'}"><input type="checkbox" data-user="${esc(f.id)}"><canvas data-av="${esc(f.id)}"></canvas>
          <span class="ip-who"><b>${esc(f.display || f.name)}</b><small>${esc(st(f.id).text)}</small></span></label>`).join('')}</div>` : ''}
      ${groups.length || friends.length ? '' : '<p class="ip-note">No friends or groups yet. Find people in the panel on the right, then invite them here.</p>'}
      <div class="ip-btns"><button type="button" class="ip-cancel">Cancel</button><button type="button" class="ip-send" disabled>Invite</button></div>`;
    for (const cv of el.querySelectorAll('canvas[data-av]')) cv.replaceWith(avatarFor(cv.dataset.av, 22));
    const send = el.querySelector('.ip-send'), boxes = [...el.querySelectorAll('input[type=checkbox]')];
    const sync = () => { const n = boxes.filter(b => b.checked).length; send.disabled = !n; send.textContent = n > 1 ? `Invite ${n}` : 'Invite'; };
    for (const b of boxes) b.onchange = sync;
    el.querySelector('.ip-cancel').onclick = () => this.closePick();
    send.onclick = () => {
      const gids = boxes.filter(b => b.checked && b.dataset.group).map(b => b.dataset.group);
      const covered = new Set(hub.groups.filter(g => gids.includes(g.id)).flatMap(g => g.members.map(m => m.id)));
      const people = boxes.filter(b => b.checked && b.dataset.user && !covered.has(b.dataset.user)).map(b => b.dataset.user);
      const point = this.title?.points?.[tile] || null;
      let sent = false;
      for (const g of gids) sent = hub.place(tile, g, point) || sent;
      if (people.length) sent = hub.place(tile, null, point, people) || sent;
      if (sent) {
        const m = this.asked.get(tile) || new Map(); this.asked.set(tile, m);
        for (const id of [...covered, ...people]) if (id !== me && !m.has(id)) m.set(id, 'asked');
        this.title?.refreshPeople?.();
      } else this.chat?.system('not connected to the hub: the invite was not sent');
      this.closePick();
    };
    el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') this.closePick(); });
    el.addEventListener('keyup', e => e.stopPropagation());
    document.body.append(el);
    const r = btn?.getBoundingClientRect();
    if (r) { el.style.left = `${Math.round(clampN(r.left + r.width / 2, 170, innerWidth - 170))}px`; el.style.bottom = `${Math.round(innerHeight - r.top + 10)}px`; }
    requestAnimationFrame(() => el.classList.add('on'));
    this.pickOut = e => { if (!el.contains(e.target) && e.target !== btn) this.closePick(); };
    setTimeout(() => addEventListener('pointerdown', this.pickOut, true), 0);
  }
  closePick() {
    const el = this.pickEl; if (!el) return;
    this.pickEl = null; removeEventListener('pointerdown', this.pickOut, true);
    el.classList.remove('on'); setTimeout(() => el.remove(), 250);
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
    this.closePick();
    if (!this.entered1) { this.entered1 = true; this.social?.setOpen(false); }   // the home screen's open panel closes in the world
    this.room = { tileId, flight: world?.flight || null, arrival: world?.arrival || null, form: world?.form || null, body: world?.body || null, caption: world?.caption || null, lead: world?.lead || null, follow: null, players: world?.players || null,
      place: world?.place || null, kind: world?.kind || null, waitLead: null, leadT: 0 };
    if (this.room.players && this.social) this.room.players.nameOf = id => this.social.nameOf(id);
    this.voice?.setRoom({ players: this.room.players, sound: world?.sound || null });
    if (this.room.flight) this.posTimer = setInterval(() => this.sendPos(), POS_MS);
    const f = this.following;   // a follow Join's world: behind the inviter once their position comes (the room join brings it)
    if (f && f.tile === tileId && world?.follow) { this.following = null; this.room.lead = null; this.veil?.ready(); this.awaitLead(f.from); }
  }
  // The world is left (a tile switch): out of the room until the next world's entry; the positions held go.
  left(tell = true) {
    clearInterval(this.posTimer); this.posTimer = null; this.fakes(0);
    clearTimeout(this.room?.leadT);
    this.room?.players?.clear();
    this.voice?.setRoom(null);
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
    this.voice?.seen(d.user);
    r.players?.sample(d);
    if (r.waitLead && d.user === r.waitLead) { this.placeBehind(d); return; }   // group follow: behind the inviter
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

  // Keep the social list, the chat and the invite clear of the HUD's panels when both are showing: the friends row right
  // of the controls row (which grows by the mic, the camera and the self-view while the group is here), the list right
  // of the menu under the X while the menu is open, the chat above the key line, the invite under the game box.
  layout() {
    const inWorld = !html.classList.contains('opening'), menu = html.classList.contains('menu');
    const hidden = html.classList.contains('arriving') || html.classList.contains('switching');
    if (this.unseen && !hidden && this.chat) { this.unseen = false; this.chat.show(true); this.chat.hideSoon(); }   // who joined, once the picker has arrived
    else if (this.unseen && hidden) this.chat?.show(false);
    const H = innerHeight;
    if (this.social) {
      const row = document.getElementById('ctlRow')?.getBoundingClientRect();
      this.social.el.style.left = inWorld && row?.width ? `${Math.round(row.right + 10)}px` : '';
      const panel = this.social.panel; panel.style.left = '';
      if (inWorld && menu && this.social.open) {   // right of the menu under the X (index.html #menuList)
        const list = document.getElementById('menuList')?.getBoundingClientRect(), left = this.social.el.getBoundingClientRect().left;
        if (list && list.width && list.right + 10 > left) panel.style.left = `${Math.round(list.right + 10 - left)}px`;
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
    const game = document.getElementById('game');
    if (inWorld && game && !game.classList.contains('hidden')) top = Math.round(game.getBoundingClientRect().bottom + 8);
    if (this.inviteEl) this.inviteEl.style.top = `${top + 44}px`;   // where it stood under the old top-middle toggles
    if (this.toast?.el) this.toast.el.style.top = `${top + 44}px`;
  }

  dispose() {
    this.left(false);
    this.closeInvite(); this.closePick(); this.veil?.remove();
    this.observer?.disconnect(); this.barObserver?.disconnect(); removeEventListener('resize', this.layoutFn);
    this.modal?.close(); this.social?.dispose(); this.chat?.dispose(); this.voice?.dispose();
    this.hub?.close();
    if (window.__weMp === this) delete window.__weMp;
  }
}
