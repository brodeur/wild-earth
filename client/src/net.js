import { acornSpecies } from './fieldguide.js';

// The acorn game's shared world (docs/game-acorn-stash.md, "v3: shared world").
// The dev server (server.py, GameWorld) owns one world per tile and season. This client sends its events (the
// player's, and the AI collectors' when the server names it the AI host), applies everyone's accepted events in
// sequence and rolls back its own rejected ones. Two copies of the world: `confirmed` (the server's, as of the
// last sequence number) and the game's own `world`, which is confirmed plus this client's pending events (the
// prediction drawn on screen). A reject, or a remote event that does not apply to the prediction, rebuilds the
// prediction from confirmed (once per frame at most). Collector ids: this client's player is 'player' locally
// and 'p:<hash>' on the wire; other players are kind 'remote' locally, so their deposits never count as "you".
// When the page's server has no game endpoint (GET /api/game), nothing here runs and the game is v2's, offline.
// localStorage holds only the session id (wild-earth:sid) and the totals last seen, shown before connecting.
// Privacy: the id sent to the server is derived per world and per round (sha256 of the stored random id, tile,
// season and round number), so the server cannot link a player across rounds, tiles or seasons; it hashes it
// again. A new round (the server's 'round' with a new id) means a new id ('id', answered by 'you'). The season
// total ("you", SEASON column) and the field notes (acorn species found) are kept here only, never sent.
// v4 (raid, mob, pilfer): the server answers a dig with its verdict (own: whose cache it was, osp: its species, pil:
// someone else's), applied in place of this client's guess; a collector's pre-event state gains loot and off.

const PROTOCOL = 1;
const SID_KEY = 'wild-earth:sid';
const PENDING_MAX = 400;
const RETRY_MAX = 30000;

// SHA-256 (synchronous, so it works where crypto.subtle does not: a page served over plain http to another
// machine). Returns hex.
const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
  0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
  0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256hex(str) {
  const m = new TextEncoder().encode(str), n = ((m.length + 9 + 63) >> 6) << 6, b = new Uint8Array(n);
  b.set(m); b[m.length] = 0x80;
  const dv = new DataView(b.buffer); dv.setUint32(n - 4, (m.length * 8) >>> 0); dv.setUint32(n - 8, Math.floor(m.length / 0x20000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64), r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], c = W[i - 2];
      W[i] = W[i - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + W[i - 7] + (r(c, 17) ^ r(c, 19) ^ (c >>> 10));
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map(x => x.toString(16).padStart(8, '0')).join('');
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

export class GameNet {
  // game: the AcornGame; fns: { applyEvent, newWorld } from acorns.js (passed in, so this module imports no game code).
  constructor(game, { applyEvent, newWorld }) {
    this.game = game; this.applyEvent = applyEvent; this.newWorld = newWorld;
    const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    this.forcedOff = q.get('net') === '0';
    this.seat = q.get('seat');                     // ?seat=2: a second player in the same browser (tests)
    this.mode = this.forcedOff ? 'offline' : 'probing';   // 'probing' | 'offline' | 'online' (the server has the game)
    this.want = null;                              // { tile, season } while the game runs
    this.ws = null; this.connected = false; this.pid = null; this.host = false; this.players = 0;
    this.epoch = null;                             // the round this player's id belongs to (the server says)
    this.confirmed = null; this.pending = []; this.cseq = 0; this.seq = 0;
    this.retry = 0; this.timer = null; this.needRebuild = false; this.wantRound = false;
    this.stats = { sent: 0, accepted: 0, rejected: 0, remote: 0, rebuilds: 0, mismatches: 0, reconnects: 0 };
    this.row = null;
    if (!this.forcedOff) this.probe();
  }

  get enabled() { return this.mode === 'online'; }
  get live() { return this.enabled && !!this.want; }       // in a shared world, connected or reconnecting

  async probe() {
    if (this.forcedOff) return this.mode;
    let mode = 'offline';
    try {
      const r = await fetch('/api/game', { cache: 'no-store' });
      if (r.ok && (await r.json()).protocol === PROTOCOL) mode = 'online';
    } catch (e) { /* no server, or no game endpoint: offline */ }
    const was = this.mode; this.mode = mode;
    if (was === 'online' && mode === 'offline') this.game.netLost?.();   // back to the v2 world in localStorage
    return mode;
  }

  sessionId() {
    const key = this.seat ? `${SID_KEY}:${this.seat}` : SID_KEY;
    try {
      let s = localStorage.getItem(key);
      if (!s || !/^[0-9a-f]{32}$/.test(s)) { s = randomHex(16); localStorage.setItem(key, s); }
      return s;
    } catch (e) { return (this.memSid ||= randomHex(16)); }   // private mode: a new player each page load
  }
  // Totals last seen in this world (shown before the snapshot arrives): { board, you, species }.
  lastSeenKey(tile, season) { return `wild-earth:net:${tile}/${season}${this.seat ? `:${this.seat}` : ''}`; }
  lastSeen() {
    const w = this.want; if (!w) return null;
    try { return JSON.parse(localStorage.getItem(this.lastSeenKey(w.tile, w.season)) || 'null'); } catch (e) { return null; }
  }
  // The id this browser goes by in this world for round r: never the stored id itself, never the same twice.
  roundSid(r) { const w = this.want; return sha256hex(`${this.sessionId()}|${w.tile}|${w.season}|${r}`).slice(0, 32); }
  hello() {
    const w = this.want; if (!w || !this.ws) return;
    const r = this.epoch;
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, tile: w.tile, season: w.season, species: this.game.player.species,
      ...(r === null ? {} : { r, sid: this.roundSid(r) }) }));
  }

  // ---- joining and leaving ------------------------------------------------------------------------
  async join(tile, season) {
    if (this.want?.tile !== tile || this.want?.season !== season) this.epoch = null;
    this.want = { tile, season }; this.wantRound = true;
    this.pending = []; this.confirmed = null; this.seq = 0;
    const mode = await this.probe();
    if (!this.want || this.want.tile !== tile || this.want.season !== season) return;
    if (mode === 'online') this.open(); else this.line();
  }
  leave() {
    this.want = null; clearTimeout(this.timer);
    if (this.ws) { const ws = this.ws; this.ws = null; ws.onclose = null; try { ws.close(); } catch (e) { /* closing */ } }
    this.connected = false; this.pending = []; this.confirmed = null; this.host = false; this.players = 0;
    this.game.aiLocal = true; this.line();
  }
  open() {
    clearTimeout(this.timer);
    if (this.ws) { const old = this.ws; this.ws = null; old.onclose = null; try { old.close(); } catch (e) { /* closing */ } }
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/game/ws`);
    this.ws = ws;
    ws.onopen = () => this.hello();
    ws.onmessage = m => { if (this.ws !== ws) return; let d; try { d = JSON.parse(m.data); } catch (e) { return; } this.on(d); };
    ws.onerror = () => {};   // onclose follows
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null; this.connected = false; this.line();
      if (this.want) this.later();
    };
  }
  later() {   // reconnect with backoff (1, 2, 4 ... 30 s, jittered)
    clearTimeout(this.timer);
    const d = Math.min(RETRY_MAX, 1000 * 2 ** this.retry) * (0.75 + Math.random() * 0.5);
    this.retry = Math.min(this.retry + 1, 6);
    this.timer = setTimeout(async () => {
      if (!this.want) return;
      this.stats.reconnects++;
      if ((await this.probe()) === 'online') this.open(); else if (this.want) this.later();
    }, d);
  }
  send(obj) { if (this.ws && this.connected) this.ws.send(JSON.stringify(obj)); }

  // ---- outgoing ------------------------------------------------------------------------------------
  // A locally applied event (the game's dispatch). pre: the collector's carry before it (an AI animal's own carry
  // is the truth for it: a re-made animal starts empty).
  event(e, pre) {
    if (!this.live) return;
    const p = { c: ++this.cseq, e: this.wire(e, pre) };
    this.pending.push(p); if (this.pending.length > PENDING_MAX) this.pending.shift();
    this.stats.sent++;
    this.send({ t: 'ev', c: p.c, e: p.e });
  }
  wire(e, pre) {
    const { by, ...rest } = e;
    if (by === 'player') return rest;                           // the server knows who this connection is
    const c = this.game.world.collectors[by];
    return { ...rest, by, sp: c?.species, cap: c?.cap || 1, held: pre ?? 0 };
  }
  startRound(length) { this.send({ t: 'start', length }); }
  species(code) { this.send({ t: 'species', species: code }); }

  // ---- incoming ------------------------------------------------------------------------------------
  on(d) {
    const G = this.game;
    if (d.t === 'epoch') {   // the id was for another round (or there was none yet): derive it for this one
      this.epoch = d.r;
      if (this.connected) this.send({ t: 'id', r: d.r, sid: this.roundSid(d.r) }); else this.hello();
      return;
    }
    if (d.t === 'you') { this.pid = d.you; this.epoch = d.r; return; }
    if (d.t === 'welcome') {
      this.connected = true; this.retry = 0; this.pid = d.you; this.epoch = d.r; this.host = !!d.host; this.players = d.n;
      const prev = this.confirmed, seen = prev ? null : this.lastSeen();
      this.seq = d.world.seq; this.confirmed = this.toLocal(d.world);
      // the season total and the field notes are this browser's: from before the reconnect, or as last seen
      this.confirmed.you = prev ? prev.you : +seen?.you || 0;
      this.confirmed.species = prev ? [...prev.species] : (Array.isArray(seen?.species) ? seen.species.filter(id => acornSpecies(id) === id) : []);
      for (const p of this.pending) this.send({ t: 'ev', c: p.c, e: p.e });   // still unanswered: the server decides
      this.rebuild();
      const r = this.confirmed.round;
      if (this.wantRound && (!r || r.over)) this.startRound(G.roundLength);
      this.wantRound = false;
      G.aiLocal = this.host; this.line();
      return;
    }
    if (!this.confirmed) return;
    if (d.seq !== undefined && d.t !== 'sum') {
      if (d.seq !== this.seq + 1) { this.resync(); return; }   // a gap: start over from a fresh snapshot
      this.seq = d.seq;
    }
    if (d.clock !== undefined) this.confirmed.clock = d.clock;
    if (d.t === 'ev') this.onEvent(d);
    else if (d.t === 'rej') {
      const i = this.pending.findIndex(p => p.c === d.c);
      if (i >= 0) this.pending.splice(i, 1);
      this.stats.rejected++; this.needRebuild = true;
    } else if (d.t === 'round') {
      if (d.round.id !== this.epoch) {   // a new round: a new id (the server holds this player's events until it comes)
        this.epoch = d.round.id; this.send({ t: 'id', r: d.round.id, sid: this.roundSid(d.round.id) });
      }
      this.confirmed.round = this.toRound(d.round, this.confirmed.clock);
      const w = G.world; w.round = this.toRound(d.round, this.confirmed.clock); w.clock = this.confirmed.clock;
      G.roundChanged();
    } else if (d.t === 'regrow') {
      for (const k of d.keys) { this.confirmed.picked.delete(k); G.world.picked.delete(k); }
      G.dirty = true;
    } else if (d.t === 'players') {
      this.players = d.n; this.host = !!d.host; G.aiLocal = this.host; this.line();
    } else if (d.t === 'sum') this.onSum(d);
  }
  onEvent(d) {
    const G = this.game, mine = d.c !== undefined;
    const e = this.prep(this.confirmed, d);
    if (!this.applyEvent(this.confirmed, e)) this.stats.mismatches++;   // the server applied it: our reducer disagrees
    if (mine) {
      const i = this.pending.findIndex(p => p.c === d.c), p = i >= 0 ? this.pending.splice(i, 1)[0] : null;
      this.stats.accepted++;
      if (e.by === 'player' && e.type === 'pickup' && p) {   // the acorn's species never goes to the server
        const sp = acornSpecies(p.e.species); if (sp && !this.confirmed.species.includes(sp)) this.confirmed.species.push(sp);
      }
      if (e.by === 'player' && e.type === 'bury') this.needRebuild = true;   // the server named the cache (k<n>)
      if (e.type === 'dig' || e.type === 'raid' || e.type === 'mob') this.needRebuild = true;   // its verdict and clock, not our guess
      return;                                                            // already drawn when it was predicted
    }
    this.stats.remote++;
    const le = this.prep(G.world, d);
    if (this.applyEvent(G.world, le)) G.remote(le); else this.needRebuild = true;
  }
  // The board and the round's counts every few seconds: a check on the replicated reducer (and the clock).
  onSum(d) {
    const c = this.confirmed, w = this.game.world;
    c.clock = d.clock;
    if (Math.abs(w.clock - d.clock) > 1) w.clock = d.clock;
    if (w.round && c.round) w.round.t = d.clock - c.round.start;
    if (d.seq !== this.seq) return;                                      // events still in flight: compare next time
    let off = false;
    for (const [s, n] of Object.entries(d.board || {})) if ((c.board[s] || 0) !== n) { c.board[s] = n; off = true; }
    if (d.rc && c.round) for (const [s, n] of Object.entries(d.rc)) if ((c.round.counts[s] || 0) !== n) { c.round.counts[s] = n; off = true; }
    for (const [s, n] of Object.entries(d.raided || {})) if ((c.raided[s] || 0) !== n) { c.raided[s] = n; off = true; }
    if (d.rr && c.round) { c.round.raided ||= {}; for (const [s, n] of Object.entries(d.rr)) if ((c.round.raided[s] || 0) !== n) { c.round.raided[s] = n; off = true; } }
    if (off) { this.stats.mismatches++; console.warn('net: counts differed from the server; corrected'); this.needRebuild = true; }
    this.players = d.n; this.line();
  }
  // An event as broadcast, ready for one of the client's worlds: the collector exists (from the event's col), its
  // carry and dug count are the server's before the event (pre), and this client's own id reads 'player'.
  prep(w, d) {
    const by = d.e.by === this.pid ? 'player' : d.e.by;
    let c = w.collectors[by];
    if (!c) c = w.collectors[by] = { id: by, species: d.col.sp, kind: by === 'player' ? 'player' : d.col.k === 'player' ? 'remote' : 'ai', carrying: 0, cap: d.col.cap, total: 0 };
    c.species = d.col.sp; c.cap = d.col.cap;
    if (d.pre) { c.carrying = d.pre[0]; c.dug = d.pre[1]; if (d.pre.length > 3) { c.loot = d.pre[2]; c.off = d.pre[3]; } }
    const e = { ...d.e, by };
    if (e.own !== undefined) e.own = e.own === this.pid ? 'player' : e.own;   // a dig's owner, in this client's terms
    return e;
  }
  resync() {   // reconnect: the welcome is a fresh snapshot, pending events are sent again
    this.stats.reconnects++;
    if (this.want && this.enabled) this.open();
  }

  // Called by the game each frame: rebuild the prediction when something did not apply.
  tick() { if (this.needRebuild && this.confirmed) this.rebuild(); }
  rebuild() {
    this.needRebuild = false; this.stats.rebuilds++;
    const w = structuredClone(this.confirmed), now = this.game.world?.clock;
    if (now > w.clock) w.clock = now;                    // the confirmed clock moves only with messages: keep time
    if (w.round) w.round.t = Math.max(0, w.clock - w.round.start);
    for (const p of this.pending) {
      const e = { ...p.e, by: p.e.by || 'player' };
      const pc = w.collectors[e.by];
      if (e.by !== 'player' && pc && p.e.held !== undefined) { pc.carrying = p.e.held; pc.loot = Math.min(pc.loot || 0, pc.carrying); }
      this.applyEvent(w, e);
    }
    this.game.adoptWorld(w);
  }

  // ---- the server's world in the client's terms ----------------------------------------------------
  toLocal(s) {
    const w = this.newWorld(s.tile, s.season);
    w.clock = s.clock;
    w.picked = new Map(Object.entries(s.picked || {}));
    w.stashes = { ...s.stashes }; w.granaries = { ...s.granaries };
    w.caches = (s.caches || []).map(k => ({ ...k }));
    w.board = { ...w.board, ...s.board };
    w.raided = { ...w.raided, ...s.raided }; w.mobbed = { ...s.mobbed };
    for (const [id, c] of Object.entries(s.collectors || {})) {
      const me = id === this.pid, lid = me ? 'player' : id;
      w.collectors[lid] = { id: lid, species: c.species, kind: me ? 'player' : c.kind === 'player' ? 'remote' : 'ai',
        carrying: c.carrying, cap: c.cap, total: c.total || 0, dug: c.dug || 0, loot: c.loot || 0, off: c.off || 0 };
    }
    w.round = this.toRound(s.round, s.clock);   // (you and species: the caller's, from this browser)
    return w;
  }
  toRound(r, clock) {
    if (!r) return null;
    return { id: r.id, start: r.start, t: Math.max(0, clock - r.start), length: r.length, counts: { ...r.counts },
      you: r.by?.[this.pid] || 0, over: !!r.over, winner: r.winner || null, raided: { ...r.raided }, mobbed: { ...r.mobbed } };
  }

  // ---- the panel line: "N players here" ------------------------------------------------------------
  line() {
    const box = this.game.ui?.box; if (!box || typeof document === 'undefined') return;
    if (!this.row) {
      const row = document.createElement('div'); row.className = 'row net-players';
      row.innerHTML = '<span>shared world</span><b></b>';
      const hint = this.game.ui.hint;
      box.insertBefore(row, hint && hint.parentElement === box ? hint : box.firstChild?.nextSibling || null);
      this.row = { el: row, b: row.querySelector('b') };
    }
    const show = !!this.want && this.enabled;
    this.row.el.style.display = show ? '' : 'none';
    if (!show) return;
    const text = !this.connected ? 'connecting…'
      : `${this.players} ${this.players === 1 ? 'player' : 'players'} here${this.host ? ' · animals run here' : ''}`;
    if (this.row.b.textContent !== text) this.row.b.textContent = text;
    this.row.b.title = this.host ? 'the woodpeckers, squirrels and ravens gathering here are run by this browser for everyone in this world'
      : 'the gathering animals are run by another player\'s browser; you see what they take';
  }
}
