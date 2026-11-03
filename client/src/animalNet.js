// Shared animals (docs/multiplayer.md "Shared animals", 2026-11-02; Aaron: "Do both users see the same animals moving
// the same direction?"). One page per world, the animal host, runs the animal simulation (animals.js) for everyone in
// the world and streams it over the game socket's `animals` channel (server.py GameWorld.animals_*); every other page
// mirrors it: animals.js in `mirror` mode draws the host's animals from the stream (the same instanced draw, gait engine
// and far tier) and runs no AI of its own. This module is the socket, the host's encoder and the mirror's decoder.
//
// The wire, at TICK_MS (4 Hz), from the host (`ast`): `s` spawns (one row per animal the others have not been told of:
// its number n, id, species, size and the few per-animal constants, then its first full sample as an update row has it:
// mask and fields, so it is never drawn before it is placed; a dead one's carries FL_DEAD), `u` updates (a row per animal: [n, mask, ...the
// FIELDS whose bit is set, quantized to FIELDS[i].q decimals; a field that did not change since the last row sent is
// left out), `d` drops (numbers of animals gone from the live set), `g` groups (number, leader, state, centre), `at` the
// host's clock. Which animals go in a tick: each one is due every tick within NEAR_M of any player, every other tick
// within MID_M, every fourth beyond; the rows go out in order of how overdue they are until the tick's share of the
// byte cap (CAP_BPS, bytes per second of JSON the host sends; the server relays the same to each mirror) is spent,
// and the rest wait for the next tick. Dead animals are not streamed: the kill event carries the last pose and the
// mirror lets the body fall and lie as the host does. The events that change the world (`aev`: a kill, carrion gone, a
// flush, a hunt, an alarm, a stoop) are ordered by the server (aseq) and applied in order.
// From a mirror: `areq` (a catch to confirm, a body taken or given back; the host decides and the kill it orders is the
// one everyone sees) and `apos` (where the mirror is, rounded to 10 m, and its species, once a second: the host
// simulates round every player and the species every player perceives; to the host only, never kept).
// Positions live in memory on the server and here only; nothing is logged or written. With no game endpoint (a static
// host, ?net=0, the dev paths alone) nothing here runs and the page is its own host as before.
// Debugging: window.__weAn is the AnimalNet; .stats counts bytes and rows; .bps() the bytes per second sent (host) or
// received (mirror) over the last second.

const TICK_MS = 250;                       // the host's stream: 4 Hz
const CAP_BPS = 24000;                     // bytes per second of state the host sends (the cap; see the doc)
const SPAWN_MSG = 30000;                   // bytes of spawns in one message at most: a join's full snapshot is spread over
                                           // ticks (the server refuses a message over 64 KB, ws.py WS_MAX_IN)
const NEAR_M = 80, MID_M = 250;            // m from the nearest player: every tick, every other, else every fourth
const POS_MS = 1000;                       // a mirror's apos: once a second (and at once on a species change)
const RETRY_MAX = 30000;
export const PG = typeof crypto !== 'undefined' && crypto.getRandomValues ? [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('') : Math.random().toString(16).slice(2, 18);

// The streamed fields of an animal, in wire order. q: decimals kept; k: how the mirror moves between two samples:
// 'lerp' (eased), 'ang' (the shorter way round), 'step' (the newer sample's, at once), 'phase' (advanced by phz, snapped
// to the sample the shorter way round).
export const FIELDS = [
  ['x', 2, 'lerp'], ['y', 2, 'lerp'], ['z', 2, 'lerp'], ['yaw', 3, 'ang'], ['pitch', 2, 'ang'], ['roll', 2, 'ang'],
  ['spd', 2, 'lerp'], ['wr', 2, 'lerp'], ['pose', 2, 'lerp'], ['amp', 2, 'lerp'], ['flick', 2, 'lerp'], ['vis', 2, 'lerp'], ['lift', 2, 'lerp'],
  ['e0', 2, 'lerp'], ['e1', 2, 'lerp'], ['e2', 2, 'lerp'], ['e3', 2, 'step'], ['state', 0, 'step'], ['phase', 2, 'phase'], ['phz', 1, 'step'],
  ['fl', 0, 'step'], ['speed', 2, 'step'],
];
export const NF = FIELDS.length;
export const F = Object.fromEntries(FIELDS.map((f, i) => [f[0], i]));   // field name -> index
const Q = FIELDS.map(f => 10 ** f[1]);
// fl: packed flags
export const FL_AIR = 1, FL_GM = 2, FL_BURIED = 4, FL_HIDDEN = 8, FL_DEAD = 16;

export class AnimalNet {
  constructor(animals, { pg = PG } = {}) {
    this.animals = animals; this.pg = pg;
    const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    this.forcedOff = q.get('net') === '0'; this.mode = this.forcedOff ? 'offline' : 'probing';
    this.want = null; this.ws = null; this.connected = false; this.host = true; this.n = 1; this.me = 0; this.members = []; this.aseq = 0;
    this.retry = 0; this.timer = null; this.tickT = null; this.posT = null; this.full = true;
    this.known = new Map();      // host: animal id -> n (told to the others)
    this.byNum = new Map();      // host: n -> the animal (a mirror's request names it by n)
    this.nextN = 0; this.groups = new Map();   // host: group object -> { n, leader, state, x, z } as last sent
    this.remoteHeld = new Map(); // host: animal id -> { from, o } (a body a mirror is in)
    this.centres = new Map();    // host: member number -> { x, z, sp, at }
    this.c = 0; this.lastSp = null; this.lastPos = null;
    this.stats = { bytesOut: 0, bytesIn: 0, rows: 0, spawns: 0, drops: 0, events: 0, ticks: 0, deferred: 0, reconnects: 0, handovers: 0 };
    this.win = { t: 0, out: 0, in: 0, lastOut: 0, lastIn: 0 };   // the last second's bytes (bps)
    animals.relay = this;
    if (typeof window !== 'undefined') window.__weAn = this;
  }
  get live() { return this.mode === 'online' && !!this.want; }
  bps() { return { out: this.win.lastOut, in: this.win.lastIn }; }
  async probe() {
    if (this.forcedOff) return (this.mode = 'offline');
    let mode = 'offline';
    try { const r = await fetch('/api/game', { cache: 'no-store' }); if (r.ok && (await r.json()).protocol === 1) mode = 'online'; } catch (e) { /* offline */ }
    return (this.mode = mode);
  }
  async join(tile, season) {
    this.leave(); this.want = { tile, season };
    const mode = await this.probe();
    if (this.want?.tile !== tile || this.want?.season !== season) return;
    if (mode === 'online') this.open();
  }
  leave() {
    clearTimeout(this.timer); clearInterval(this.tickT); clearInterval(this.posT); this.tickT = this.posT = null; this.want = null;
    if (this.ws) { const ws = this.ws; this.ws = null; ws.onclose = null; try { ws.close(); } catch (e) { /* closing */ } }
    this.connected = false; this.setHost(true); this.members = []; this.centres.clear(); this.animals.setCentres?.([]);
  }
  open() {
    clearTimeout(this.timer);
    if (this.ws) { const old = this.ws; this.ws = null; old.onclose = null; try { old.close(); } catch (e) { /* closing */ } }
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/game/ws`); this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'animals', tile: this.want.tile, season: this.want.season, pg: this.pg }));
    ws.onmessage = m => { if (this.ws !== ws) return; this.stats.bytesIn += m.data.length; this.win.in += m.data.length; let d; try { d = JSON.parse(m.data); } catch (e) { return; } this.on(d); };
    ws.onerror = () => {};
    ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; this.connected = false; this.setHost(true); this.timers(); if (this.want) this.later(); };
  }
  later() {
    clearTimeout(this.timer);
    const d = Math.min(RETRY_MAX, 1000 * 2 ** this.retry) * (0.75 + Math.random() * 0.5); this.retry = Math.min(this.retry + 1, 6);
    this.timer = setTimeout(async () => { if (!this.want) return; this.stats.reconnects++; if ((await this.probe()) === 'online') this.open(); else if (this.want) this.later(); }, d);
  }
  send(obj) {
    if (!this.ws || !this.connected) return 0;
    const s = JSON.stringify(obj); this.ws.send(s); this.stats.bytesOut += s.length; this.win.out += s.length; return s.length;
  }

  // ---- host or mirror ------------------------------------------------------------------------------------------------
  setHost(host) {
    const A = this.animals, was = this.host; this.host = host;
    if (host !== was) {
      if (host) { this.known.clear(); this.byNum.clear(); this.groups.clear(); this.nextN = 0; this.full = true; if (A.mirror) { A.becomeHost(); this.stats.handovers++; } }
      else { A.becomeMirror(); this.known.clear(); this.byNum.clear(); }
    }
    this.timers();
  }
  // the host's stream tick, or a mirror's apos, while connected
  timers() {
    const host = this.host;
    if (!this.connected || (host && this.tickT) || (!host && this.posT)) { if (!this.connected) { clearInterval(this.tickT); clearInterval(this.posT); this.tickT = this.posT = null; } return; }
    clearInterval(this.tickT); clearInterval(this.posT); this.tickT = this.posT = null;
    if (host) this.tickT = setInterval(() => this.tick(), TICK_MS);
    else { this.posT = setInterval(() => this.sendPos(), POS_MS); this.lastSp = null; this.sendPos(); }
  }
  on(d) {
    const A = this.animals;
    if (d.t === 'awelcome' || d.t === 'ahost') {
      const fresh = d.t === 'awelcome';
      if (fresh) { this.connected = true; this.retry = 0; this.aseq = d.aseq || 0; this.lastSp = null; }
      this.n = d.n; this.me = d.you; this.members = d.m || [];
      if (d.full) this.full = true;
      for (const k of [...this.centres.keys()]) if (!this.members.includes(k)) this.centres.delete(k);
      if (this.host) {   // a mirror that left while in one of this host's animals: the body goes back where it was taken
        for (const [id, h] of [...this.remoteHeld]) if (!this.members.includes(h.from)) { this.remoteHeld.delete(id); A.release(id, h.o); }
        A.setCentres?.([...this.centres.values()]);
      }
      this.setHost(!!d.host);
      if (fresh && !this.host) this.aseq = d.aseq || 0;
      A.line?.();
      return;
    }
    if (!this.connected) return;
    if (d.t === 'ast') { if (!this.host) this.decode(d); return; }
    if (d.t === 'aev') {
      if (d.aseq !== this.aseq + 1 && this.aseq) { this.aseq = d.aseq; }   // a gap: the state stream carries the rest
      else this.aseq = d.aseq;
      this.stats.events++;
      if (d.c !== undefined) return;    // the host's own, applied when it happened
      A.applyEvent?.(d.e, this.me);
      return;
    }
    if (d.t === 'areq' && this.host) { A.request?.(d.e, d.from); return; }
    if (d.t === 'apos' && this.host) {
      this.centres.set(d.from, { x: +d.x || 0, z: +d.z || 0, sp: d.sp || null, at: performance.now() });
      A.setCentres?.([...this.centres.values()]);
    }
  }
  // ---- a mirror's messages -------------------------------------------------------------------------------------------
  sendPos() {
    const A = this.animals; if (this.host || !this.connected) return;
    const P = A.flight.pos, sp = A.observer, x = Math.round(P.x / 10) * 10, z = Math.round(P.z / 10) * 10;
    if (sp === this.lastSp && this.lastPos && this.lastPos[0] === x && this.lastPos[1] === z) return;
    this.lastSp = sp; (this.lastPos ||= [0, 0])[0] = x; this.lastPos[1] = z;
    this.send({ t: 'apos', x, z, sp });
  }
  request(e) { if (!this.host && this.connected) this.send({ t: 'areq', e }); }
  // ---- the host's events ---------------------------------------------------------------------------------------------
  event(e) { if (this.host && this.connected && this.n > 1) { this.stats.events++; this.send({ t: 'aev', c: ++this.c, e }); } }   // alone on the channel: no one to tell
  numberOf(a) { return this.known.get(a.id) ?? -1; }
  // animals.js emit(type, e): the ones the mirrors need, as events (the mirror re-emits them for its sounds and souls)
  emitted(type, e) {
    if (!this.host || !this.connected) return;
    const A = this.animals;
    if (type === 'flush' || type === 'turkeyFlush' || type === 'gsAlarm') {
      const g = e.covey || e.group; const gn = g ? this.groupNumber(g) : -1;
      this.event({ k: type, g: gn, species: e.species || null, x: r2(e.x), y: r2(e.y), z: r2(e.z), n: e.n || 0, cause: e.cause || null });
    } else if (type === 'alarm') this.event({ k: 'alarm', species: e.species, x: r2(e.x), y: r2(e.y), z: r2(e.z), carry: e.carry, alarmed: e.alarmed });
    else if (type === 'stoop') this.event({ k: 'stoop', n: this.numberOf(e.animal), x: r2(e.x), y: r2(e.y), z: r2(e.z), target: e.target ? this.numberOf(e.target) : -1 });
    else if (type === 'rally') this.event({ k: 'rally', n: this.numberOf(e.animal), x: r2(e.x), y: r2(e.y), z: r2(e.z) });
    else if (type === 'hunt') this.event({ k: 'hunt', n: this.numberOf(e.animal), prey: e.prey ? this.numberOf(e.prey) : -1 });
    else if (type === 'kill') {
      const a = e.animal; if (!a) return;
      this.event({ k: 'kill', n: this.numberOf(a), by: e.aid ? `p:${e.aid}` : e.by, bysp: e.aid ? e.by : null, x: r2(a.x), y: r2(a.y), z: r2(a.z), yaw: r3(a.yaw),
        pitch: r2(a.pitch0 || 0), roll: r2(a.roll || 0), amp: r2(a.amp0 || 0), pose: r2(a.pose0 || 0), flick: r2(a.flick0 || 0), lr: a.lieRoll || 1 });
    } else if (type === 'gone') this.event({ k: 'gone', n: this.numberOf(e.animal) });
    else if (type === 'miss') this.event({ k: 'miss', to: e.aid, n: this.numberOf(e.animal) });
  }
  groupNumber(g) {
    let r = this.groups.get(g);
    if (!r) { r = { n: ++this.nextN, leader: -2, state: NaN, x: NaN, z: NaN }; this.groups.set(g, r); }
    return r.n;
  }

  // ---- the host's tick: spawns, updates, drops, groups ---------------------------------------------------------------
  tick() {
    const A = this.animals; if (!this.host || !this.connected) return;
    if (this.n <= 1) { this.full = true; return; }   // alone on the channel: nothing to send (the next joiner gets everything)
    const now = performance.now(); this.stats.ticks++;
    if (now - this.win.t >= 1000) { this.win.lastOut = this.win.out; this.win.lastIn = this.win.in; this.win.out = this.win.in = 0; this.win.t = now; }
    const full = this.full; this.full = false;
    if (full) { for (const a of A.list) a.wsFull = true; for (const r of this.groups.values()) { r.leader = -2; r.state = NaN; } }
    const s = [], u = [], d = [], g = [];
    const live = new Set(); let sBytes = 0;
    // the centres: the host's player and the mirrors (where the animals are judged near or far)
    const C = this.cs ||= []; C.length = 0; C.push(A.flight.pos.x, A.flight.pos.z);
    for (const c of this.centres.values()) C.push(c.x, c.z);
    // spawns, and which are due
    const due = this.due ||= []; due.length = 0;
    for (const a of A.list) {
      if (a.gone || a.sp === undefined || a.remote) continue;
      let n = this.known.get(a.id);
      live.add(a.id);
      const fresh = n === undefined;
      if (fresh) { n = ++this.nextN; this.known.set(a.id, n); this.byNum.set(n, a); a.n = n; this.stats.spawns++; }
      if (fresh || full || a.wsFull) {   // the constants, then the first sample in full (past SPAWN_MSG: the next tick)
        a.wsFull = true; a.wtick = 0;
        if (sBytes > SPAWN_MSG) { this.stats.deferred++; continue; }
        const sr = [n, a.id, a.sp, r2(a.size), a.variant || 0, a.male || 0, a.young || 0, r3(a.u1 ?? 0.5), r3(a.u2 ?? 0.5), r3(a.u3 ?? 0.5), a.group ? this.groupNumber(a.group) : -1, a.rank || 0];
        const row = this.row(a); for (let i = 1; i < row.length; i++) sr.push(row[i]);
        s.push(sr); sBytes += JSON.stringify(sr).length + 1; continue;
      }
      if (a.dead || a.culled) continue;
      let bd = Infinity;
      for (let i = 0; i < C.length; i += 2) { const dx = a.x - C[i], dz = a.z - C[i + 1], d2 = dx * dx + dz * dz; if (d2 < bd) bd = d2; }
      const every = bd < NEAR_M * NEAR_M ? 1 : bd < MID_M * MID_M ? 2 : 4;
      a.wdue = ((a.wtick || 0) + 1) / every;   // ticks since sent over the ticks allowed: 1 means due
      a.wd2 = bd;
      if (a.wdue >= 1) due.push(a);
    }
    for (const [id, n] of this.known) if (!live.has(id)) { this.known.delete(id); this.byNum.delete(n); d.push(n); this.stats.drops++; }
    due.sort((p, q) => (q.wdue - p.wdue) || (p.wd2 - q.wd2));
    // groups: the leader, state and centre, when changed
    for (const [grp, r] of this.groups) {
      const L = grp.leader ? (this.known.get(grp.leader.id) ?? -1) : -1, st = grp.state ?? -1, x = grp.x != null ? r2(grp.x) : NaN, z = grp.z != null ? r2(grp.z) : NaN;
      if (L !== r.leader || st !== r.state || (x === x && (Math.abs(x - r.x) > 0.5 || Math.abs(z - r.z) > 0.5)) || (x !== x && r.x === r.x)) {
        r.leader = L; r.state = st; r.x = x; r.z = z;
        g.push(x === x ? [r.n, L, st, x, z] : [r.n, L, st]);
      }
    }
    // the rows, until the tick's share of the cap
    let bytes = 30 + sBytes + JSON.stringify(d).length + JSON.stringify(g).length, budget = CAP_BPS * TICK_MS / 1000;
    let k = 0;
    for (; k < due.length; k++) {
      const a = due[k], row = this.row(a); if (!row) { a.wtick = 0; continue; }
      const len = JSON.stringify(row).length + 1;
      if (bytes + len > budget && u.length) break;
      bytes += len; u.push(row); a.wtick = 0; this.stats.rows++;
    }
    for (; k < due.length; k++) { due[k].wtick = (due[k].wtick || 0) + 1; this.stats.deferred++; }
    for (const a of A.list) if (!a.dead && !a.culled && a.wdue < 1) a.wtick = (a.wtick || 0) + 1;
    if (s.length || u.length || d.length || g.length) this.send({ t: 'ast', s, u, d, g, at: r2(A.time) });
  }
  // one animal's row: [n, mask, ...changed fields], or null when nothing changed
  row(a) {
    const first = !a.ws || a.wsFull;
    if (!a.ws) a.ws = new Float32Array(NF);
    a.wsFull = false;
    const ws = a.ws, row = [a.n, 0]; let mask = 0;
    for (let i = 0; i < NF; i++) {
      const name = FIELDS[i][0];
      let v = name === 'fl' ? ((a.air ? FL_AIR : 0) | (a.gm ? FL_GM : 0) | (a.buried ? FL_BURIED : 0) | (a.hidden ? FL_HIDDEN : 0) | (a.dead ? FL_DEAD : 0)) : name === 'phase' ? a.phase % 6.283185307179586 : a[name];
      v = Math.round((+v || 0) * Q[i]) / Q[i];
      if (first || v !== ws[i]) { ws[i] = v; mask |= 1 << i; row.push(v); }
    }
    if (!mask) return null;
    row[1] = mask;
    return row;
  }

  // ---- the mirror's decoder ------------------------------------------------------------------------------------------
  decode(d) {
    const A = this.animals, now = performance.now();
    if (Array.isArray(d.s)) for (const r of d.s) A.mirrorSpawn(r, now);
    if (Array.isArray(d.g)) for (const r of d.g) A.mirrorGroup(r);
    if (Array.isArray(d.u)) for (const r of d.u) A.mirrorRow(r, now);
    if (Array.isArray(d.d)) for (const n of d.d) A.mirrorDrop(n);
    if (now - this.win.t >= 1000) { this.win.lastOut = this.win.out; this.win.lastIn = this.win.in; this.win.out = this.win.in = 0; this.win.t = now; }
  }
}
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
