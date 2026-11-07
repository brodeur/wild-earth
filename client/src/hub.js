// The hub's client (docs/multiplayer.md, "The hub" and "Protocol"; the server is hub.py). No UI: the screens
// (title.js, and lane 3's account, social and chat modules) subscribe to its events and call its methods.
//   const cfg = await Hub.config();            // null: this page's server has no hub (a static host)
//   const you = await Hub.me();                // null: not signed in
//   const hub = new Hub(); hub.on('counts', d => ...); hub.connect();
// Events: every message the hub sends, by its t (welcome, found, err, presence, friends, groups, chat,
// invite, pos, gone, counts, me, placed, answer, rtc, body), each with the message; plus 'open', 'close' and 'signedout'
// (the session is gone: no reconnect). The hub's state as last told is kept on the instance: you, friends,
// requests, blocked (the people this user blocked: Blocked people), groups, online (user id -> {state, tile?}), counts (tile id -> players), ice (the ICE servers for voice and
// video, voice.js: public STUN, and TURN when the hub has it; from the welcome, never kept past the page), bodies (user id -> {tile,
// code, here}: the group's bodies chosen or worn, the home screen's rings). The room, the watch and the player's own body
// are re-sent after a reconnect. The session is the HttpOnly we_session cookie: nothing here touches it, and
// nothing is kept in localStorage.

const RETRY_MAX = 30000;

async function call(method, path, body) {
  const r = await fetch(path, {
    method, cache: 'no-store', credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  if ((r.headers.get('Content-Type') || '').includes('application/json')) {
    try { data = await r.json(); } catch (e) { data = null; }
  }
  return { ok: r.ok, status: r.status, data };
}

// An HTTP answer as a value or a thrown HubError {status, field, message} (the field named, never the value).
export class HubError extends Error {
  constructor(status, data) { super(data?.error || `hub answered ${status}`); this.status = status; this.field = data?.field || null; }
}
async function must(method, path, body) {
  const r = await call(method, path, body);
  if (!r.ok) throw new HubError(r.status, r.data);
  return r.data;
}

export class Hub {
  // {hub, providers} or null when the page's server has no hub.
  static async config() {
    try { const r = await call('GET', '/api/hub/config'); return r.ok && r.data ? r.data : null; } catch (e) { return null; }
  }
  static async me() {
    try { const r = await call('GET', '/api/hub/me'); return r.ok ? r.data.you : null; } catch (e) { return null; }
  }
  static signup(name, password) { return must('POST', '/api/hub/signup', { name, password }); }   // {you, recovery}
  static signin(name, password) { return must('POST', '/api/hub/signin', { name, password }); }   // {you}
  static recover(name, code, password) { return must('POST', '/api/hub/recover', { name, code, password }); }  // {you, left}
  static signout() { return must('POST', '/api/hub/signout'); }
  static discordUrl() { return '/api/hub/oauth/discord'; }   // navigate the page there; it comes back signed in

  constructor() {
    this.ws = null; this.want = false; this.connected = false; this.retry = 0; this.timer = null;
    this.handlers = new Map();
    this.you = null; this.friends = []; this.requests = []; this.blocked = []; this.groups = []; this.online = new Map(); this.counts = {}; this.ice = null;
    this.room = null; this.watching = false;
  }

  // The title screen asks its hub object for these (title.js): the same HTTP calls as the statics.
  config() { return Hub.config(); }
  me() { return Hub.me(); }

  on(t, fn) {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set());
    this.handlers.get(t).add(fn);
    return () => this.handlers.get(t)?.delete(fn);
  }
  emit(t, d) {
    for (const fn of [...(this.handlers.get(t) || [])]) {
      try { fn(d); } catch (e) { console.error(`hub: a '${t}' handler failed`, e); }
    }
  }

  connect() { this.want = true; this.open(); }
  close() {
    this.want = false; clearTimeout(this.timer);
    if (this.ws) { const ws = this.ws; this.ws = null; ws.onclose = null; try { ws.close(); } catch (e) { /* closing */ } }
    if (this.connected) { this.connected = false; this.emit('close', {}); }
  }
  open() {
    clearTimeout(this.timer);
    if (this.ws) { const old = this.ws; this.ws = null; old.onclose = null; try { old.close(); } catch (e) { /* closing */ } }
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/hub/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello' }));
    ws.onmessage = m => { if (this.ws !== ws) return; let d; try { d = JSON.parse(m.data); } catch (e) { return; } this.got(d); };
    ws.onerror = () => {};   // onclose follows
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.connected) { this.connected = false; this.emit('close', {}); }
      if (this.want) this.later();
    };
  }
  later() {   // reconnect with backoff (1, 2, 4 ... 30 s, jittered), while still signed in
    clearTimeout(this.timer);
    const d = Math.min(RETRY_MAX, 1000 * 2 ** this.retry) * (0.75 + Math.random() * 0.5);
    this.retry = Math.min(this.retry + 1, 6);
    this.timer = setTimeout(async () => {
      if (!this.want) return;
      if (await Hub.me()) this.open();
      else { this.want = false; this.emit('signedout', {}); }
    }, d);
  }
  send(obj) { if (this.ws && this.connected) { this.ws.send(JSON.stringify(obj)); return true; } return false; }

  got(d) {
    switch (d.t) {
      case 'welcome':
        this.connected = true; this.retry = 0;
        this.you = d.you; this.friends = d.friends; this.requests = d.requests; this.blocked = d.blocked || []; this.groups = d.groups; this.ice = Array.isArray(d.ice) ? d.ice : null;
        this.online = new Map(d.online.map(o => [o.user, { state: o.state, tile: o.tile }]));
        this.bodies = new Map((d.bodies || []).map(b => [b.user, { tile: b.tile, code: b.code, here: !!b.here }]));
        if (this.myBody) this.send({ t: 'body', ...this.myBody });
        if (this.room) this.send({ t: 'room', op: 'join', tile: this.room, ...(this.roomSeason ? { season: this.roomSeason } : {}) });
        if (this.watching) this.send({ t: 'watch', on: true });
        this.emit('open', d);
        break;
      case 'err':
        if (d.field === 'session') { this.want = false; this.emit('signedout', d); }
        break;
      case 'presence':
        if (d.state === 'offline') this.online.delete(d.user);
        else this.online.set(d.user, { state: d.state, tile: d.tile });
        break;
      case 'friends': this.friends = d.friends; this.requests = d.requests; this.blocked = d.blocked || []; break;
      case 'groups': this.groups = d.groups; break;
      case 'counts': this.counts = d.tiles; break;
      case 'me': this.you = d.you; break;
      case 'body':
        if (!d.tile) this.bodies?.delete(d.user);
        else (this.bodies ||= new Map()).set(d.user, { tile: d.tile, code: d.code, here: !!d.here });
        break;
    }
    this.emit(d.t, d);
  }

  // ---- the protocol, client to hub (docs/multiplayer.md; the additions in lane 2's Built note) ----------
  search(q) { return this.send({ t: 'search', q }); }
  friend(op, user) { return this.send({ t: 'friend', op, user }); }   // request | accept | remove | block | unblock
  createGroup(name, users) { return this.send({ t: 'group', op: 'create', name, users }); }
  addToGroup(group, user) { return this.send({ t: 'group', op: 'add', group, user }); }
  removeFromGroup(group, user) { return this.send({ t: 'group', op: 'remove', group, user }); }
  leaveGroup(group) { return this.send({ t: 'group', op: 'leave', group }); }
  nameGroup(group, name) { return this.send({ t: 'group', op: 'name', group, name }); }
  chat(text, scope = this.groups.length ? 'group' : 'tile', group) {
    return this.send(group ? { t: 'chat', scope, text, group } : { t: 'chat', scope, text });
  }
  // point: the picker's planned arrival, tile-local { x, north } (relayed in the invite, never kept); group when in several;
  // to: user ids asked by name (friends or fellow group members: the home screen's Invite), with or without a group.
  // follow: the player pressed Start and goes in now (group follow): the group's online members are asked to join them.
  // world: { season, date } the season and day they go into when not the calendar's (the group's season), relayed.
  place(tile, group, point = null, to = null, follow = false, world = null) {
    const m = { t: 'place', tile }; if (group) m.group = group; if (to?.length) m.to = [...to]; if (point) m.point = { x: point.x, north: point.north };
    if (follow) m.follow = true;
    if (world?.season && world.season !== 'auto') { m.season = world.season; if (world.date) m.date = world.date; }
    return this.send(m);
  }
  // The player changed the season (group season): 'spring' .. 'winter' with the day picked ('MM-DD'), or 'auto' (today's).
  season(season, date = null) { return this.send(date && season !== 'auto' ? { t: 'season', season, date } : { t: 'season', season }); }
  answer(invite, join) { return this.send({ t: 'answer', invite, join: !!join }); }
  // The tile's room, in the season the world is in (the world is the tile and the season: docs/multiplayer.md "Who sees
  // whom"): joined when a world is entered and again when its season changes in place (null leaves). Kept, and re-joined
  // after a reconnect.
  enter(tile, season = null) {
    this.room = tile || null; this.roomSeason = tile ? season || null : null;
    return this.send(tile ? { t: 'room', op: 'join', tile, ...(season ? { season } : {}) } : { t: 'room', op: 'leave' });
  }
  // {x, y, z, yaw, form}: at 5 Hz while in a room (the caller paces it). The hub relays it under the rule: to the group in
  // any form, to everyone else in the world while a spirit; a body's pose with no group goes nowhere. Never kept.
  pos(p) {
    if (!this.room) return false;
    return this.send({ t: 'pos', x: p.x, y: p.y, z: p.z, yaw: p.yaw, form: p.form, ...(p.b ? { b: p.b, c: p.c } : {}) });   // b, c: the body's pose (bodySample.js)
  }
  // WebRTC signalling to a group member in the same room (voice.js): {to, tc?, k: 'sdp'|'ice'|'state'|'bye', ...}. Relayed
  // by the hub to that member's connection only, never kept.
  rtc(m) { return this.room ? this.send({ t: 'rtc', ...m }) : false; }
  // The body this player chose for a tile on the home screen ('spirit' for none), or wears there (here: in its world):
  // relayed to the online members of their groups (title.js rings). tile null takes it back. Kept for a reconnect only.
  body(tile, code = 'spirit', here = false) {
    const m = tile ? { tile, code: code || 'spirit', here: !!here } : { tile: null };
    if (this.myBody?.tile === m.tile && this.myBody?.code === m.code && this.myBody?.here === m.here) return true;
    this.myBody = tile ? m : null;
    return this.send({ t: 'body', ...m });
  }
  watch(on) { this.watching = !!on; return this.send({ t: 'watch', on: !!on }); }
  setMe(fields) { return this.send({ t: 'me', ...fields }); }   // {display?, findable?, presence?: 'tile'|'online'|'hidden'}
}
