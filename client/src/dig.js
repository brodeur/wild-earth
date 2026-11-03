import * as THREE from 'three';
import { uniforms as atmo } from './atmosphere.js';
import { groundUniforms } from './terrain.js';
import { GLOW_COL } from './forage.js';

// Dig: a game for the vole and the coyote (Aaron, 2026-11-02: "a new game for voles and coyotes. Dig! Voles may dig
// tunnels at a rate of .5"/s. They can create tunnel systems, big chambers etc. coyotes may dig down at a rate of .5"/s
// if where they dig intersects with a tunnel they are able to see the tunnel along with a bright glow from the tunnel
// side containing voles"). docs/game-dig.md.
//
// The model. A tile's tunnels are a graph: nodes (a point on a tunnel's centreline with the tube's radius there; a hole
// where it meets the surface; a chamber where the radius has grown) and segments between them, kept per tile in
// `world` and changed only through applyEvent(world, e) with the events below, as the acorn game's world is, so the
// shared-world socket can carry the same events later. A pit is the coyote's: a bowl at its paws, deepened while it
// digs; a tunnel its bottom meets is opened. The world is saved to localStorage (`wild-earth:dig:<tile>`) at most every
// SAVE_S s while it changes and on pagehide.
//
// Drawing. Every segment is a round cone (a tube between its two nodes' radii with hemispherical ends) in one
// preallocated BufferGeometry, every hole a collar and spoil ring, every pit a bowl and a mound, all in one dirt
// material (DIRT_FRAG: the soil colour from the tile's soils layer, roots, stones by the soil's rock fragments; lit
// inside only by the light down the nearest holes and pits, a faint warm glow at the player's whiskers and the scent
// glow along an opened system). The union of the tubes is made in the fragment shader: a fragment inside a
// neighbouring capsule is air and discarded (the capsules live in a float texture, each vertex names up to eight
// neighbours), so junctions, chambers and collars need no mesh booleans. The terrain is not edited: the ground shader
// discards a disc round each of the eight nearest holes and pits (groundUniforms.digCuts), so the hole is seen from
// above and the sky from below.
//
// Controls. The vole (groundControl.js, mode 'tunnel'): Q held, or E held with nothing to eat under the nose, digs
// from the nose at RATE m/s (1.27 cm/s) down the slope it looks along (the drag's pitch, within SLOPE_MAX; from the
// surface it starts at START_PITCH until it is under), turning as it turns; a dig that brings the face within
// CHAMBER_NEAR of another node of the system joins them and widens the nodes round into a chamber (up to R_CHAMBER);
// a face that reaches the surface breaks out as a hole. W walks the tunnel along its centreline (the branch nearest
// the way it faces at a junction), S backs, W at a hole with no tunnel ahead climbs out; a vole on the surface walking
// onto a hole goes down. The coyote: Q held, or E held over ground with no prey in reach, digs a pit at its paws at
// the same rate (the mousing dig's paw strikes), a tunnel it meets opens: the voles in it flee down the other branches
// and the tunnel glows toward where they are (GLOW_COL, brightest at a vole, dimming with distance along the tunnel).
// AI voles (animals.js voUpdate, state VL_TUN) run for a hole within HOLE_SEEK m when alarmed, go down to the far end
// or a chamber, and come up after HIDE_S s; a system holds SYS_CAP of them. AI coyotes do not dig.
//
// window.__weDig: `mult` multiplies the dig rate (verification), `world`, `reset()`, `stats` (update ms).

const TAU = Math.PI * 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);

export const RATE = 0.0127;                 // m/s: half an inch a second
export const R_TUBE = 0.03, R_CHAMBER = 0.10, CHAMBER_NEAR = 0.13, WIDEN_STEP = 0.025;
const R_MAX = R_CHAMBER;
const JOIN_PATH = 0.3, R_TURN = 0.07;   // R_TURN: the tightest curve a digging vole makes (m): a chamber is dug round one   // m along the tunnel within which a node is the face's own last stretch, not a place to join
const MAX_DEPTH = 0.5, SLOPE_MAX = 0.6, START_PITCH = -0.55, STEP = 0.02, BEND = 0.2, SEG_MAX = 0.35;
const PIT_R0 = 0.1, PIT_RK = 0.45, PIT_MAX = 0.6, PIT_STEP = 0.01, PAW_AHEAD = 1.1;   // PAW_AHEAD: body half-lengths ahead of the centre
const HOLE_CUT = 1.15, COLLAR_UP = 0.45;    // the ground's cut disc and the collar's rim, in tube radii
const SAVE_S = 2, GLOW_T = 0.25, GLOW_L = 1.0, VISIT_MS = 3600e3;   // glow falls by e per GLOW_L m along the tunnel from a vole
const HOLE_SEEK = 2.5, HIDE_S = [15, 40], SYS_CAP = 4, AI_WALK = 0.45, AI_FLEE = 1.0;
const AI_DIG_P = 0.004, AI_DIG_MAX = 2, AI_DIG_HOLES = 40;   // a calm AI vole's chance per pause of starting a burrow (the AI host), at most two at once, and none past forty holes in the world
const MAX_S = 1200, MAX_N = 1500, MAX_P = 120, MAX_H = 300;   // segments, nodes, pits, holes with a collar (digworld.py N_MAX, S_MAX, P_MAX)
const SIDES = 12, RINGS = 8, SEG_V = SIDES * RINGS, SEG_I = SIDES * (RINGS - 1) * 6;
const LATHE_S = 14, LATHE_R = 6, LATHE_V = LATHE_S * LATHE_R, LATHE_I = LATHE_S * (LATHE_R - 1) * 6;
const NB = 8;                                // neighbour capsules per vertex (two vec4 attributes)
const CUTS = 8, LIGHTS = 8, PITS_U = 4;
const SOIL = {   // the soil colour by the map unit's surface texture class (SSURGO, soils/classes.json), linear
  'silt loam': [0.33, 0.23, 0.13], loam: [0.34, 0.24, 0.14], 'clay loam': [0.36, 0.22, 0.13], clay: [0.38, 0.2, 0.12],
  'sandy loam': [0.42, 0.33, 0.2], sand: [0.48, 0.4, 0.26], 'gravelly loam': [0.36, 0.28, 0.18], 'silty clay loam': [0.35, 0.22, 0.13],
};
const SOIL_DEFAULT = [0.34, 0.24, 0.14];

// ---- the world and its events ---------------------------------------------------------------------
// The client's copy of a tile's tunnels (digworld.py holds the server's, in its shared shape: toShared/fromShared).
// node: { id, x, y, z, r, hole, sys, open, segs: [segId] } (y the centreline; a hole's y is one radius under the
// ground; sys the id of the hole the system began at); seg: { id, a, b }; pit: { id, x, z, y0, r, depth, hx, hz,
// open: [segId] }. Ids are strings, `<tag>.<n>`: a tag of this page's and its own counter, so two players never make
// the same id (the server refuses one it already has). Every event is anonymous.
export const STEP_MAX = 0.6;   // m: the longest step a dig event may make from its node (digworld.py STEP_MAX)
export function newWorld(tile) { return { v: 1, tile, nodes: [], segs: [], pits: [], byId: new Map() }; }
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function applyEvent(w, e) {
  const get = id => w.byId.get(id), taken = id => w.byId.has(id);
  switch (e.type) {
    case 'hole': {   // a tunnel's first node, at the surface (y one radius under the ground there); its own system
      if (taken(e.id)) return false;
      const n = { id: e.id, x: e.x, y: e.y, z: e.z, r: e.r ?? R_TUBE, hole: true, sys: e.id, open: false, segs: [], i: w.nodes.length };
      w.nodes.push(n); w.byId.set(n.id, n); return true;
    }
    case 'dig': {   // a new node joined to `from` by a new segment (the face advancing)
      const a = get(e.from); if (!a || !a.segs || taken(e.id) || taken(e.seg) || e.id === e.seg || d3(a, e) > STEP_MAX) return false;
      const n = { id: e.id, x: e.x, y: e.y, z: e.z, r: e.r ?? Math.min(a.r, R_TUBE), hole: false, sys: a.sys, open: false, segs: [], i: w.nodes.length };
      const s = { id: e.seg, a: a.id, b: n.id, i: w.segs.length };
      w.nodes.push(n); w.segs.push(s); w.byId.set(n.id, n); w.byId.set(s.id, s); a.segs.push(s.id); n.segs.push(s.id);
      return true;
    }
    case 'grow': {   // the face advancing without a new node: a leaf node moves
      const n = get(e.id); if (!n || !n.segs || n.segs.length !== 1 || n.hole) return false;
      const s = get(n.segs[0]), o = get(s.a === n.id ? s.b : s.a); if (d3(o, e) > STEP_MAX) return false;
      n.x = e.x; n.y = e.y; n.z = e.z; n.gy = undefined; return true;
    }
    case 'join': {   // a new segment between two existing nodes (a loop closes; the systems merge)
      const a = get(e.a), b = get(e.b); if (!a?.segs || !b?.segs || a === b || taken(e.seg) || d3(a, b) > STEP_MAX) return false;
      for (const id of a.segs) { const s = get(id); if (s.a === b.id || s.b === b.id) return false; }
      const s = { id: e.seg, a: a.id, b: b.id, i: w.segs.length }; w.segs.push(s); w.byId.set(s.id, s); a.segs.push(s.id); b.segs.push(s.id);
      if (a.sys !== b.sys) { const from = b.sys; for (const n of w.nodes) if (n.sys === from) n.sys = a.sys; }
      return true;
    }
    case 'widen': {   // nodes grown toward a chamber
      let ok = false; for (const id of e.ids) { const n = get(id); if (!n?.segs) continue; const r = Math.min(R_MAX, Math.max(n.r, e.r)); if (r !== n.r) { n.r = r; ok = true; } }
      return ok;
    }
    case 'surface': {   // the face broke out: the node is a hole
      const n = get(e.id); if (!n?.segs || n.hole) return false;
      n.hole = true; n.y = e.y; return true;
    }
    case 'pit': {   // a pit made or deepened
      let p = get(e.id);
      if (!p) { p = { id: e.id, x: e.x, z: e.z, y0: e.y0, r: e.r, depth: e.depth, hx: e.hx, hz: e.hz, open: [], pit: true, i: w.pits.length }; w.pits.push(p); w.byId.set(p.id, p); return true; }
      if (!p.pit || (e.depth <= p.depth && e.r <= p.r)) return false;
      p.depth = Math.max(p.depth, e.depth); p.r = Math.max(p.r, e.r); return true;
    }
    case 'open': {   // the pit's bottom met these segments: the tunnel is open to the sky there
      const p = get(e.pit); if (!p?.pit) return false;
      let ok = false;
      for (const id of e.segs) { const s = get(id); if (!s || s.segs || s.pit || p.open.includes(id)) continue; p.open.push(id); get(s.a).open = get(s.b).open = true; ok = true; }
      return ok;
    }
    case 'visit': return true;   // the server's clock of the last animal inside (the decay); nothing drawn changes
    case 'decay': {   // the server removed a system or a pit no animal entered for a week
      const gone = new Set([...(e.nodes || []), ...(e.segs || []), ...(e.pits || [])]); if (!gone.size) return false;
      w.nodes = w.nodes.filter(n => !gone.has(n.id)); w.segs = w.segs.filter(s => !gone.has(s.id)); w.pits = w.pits.filter(p => !gone.has(p.id));
      for (const id of gone) w.byId.delete(id);
      for (const n of w.nodes) n.segs = n.segs.filter(id => !gone.has(id));
      for (const p of w.pits) p.open = p.open.filter(id => !gone.has(id));
      reindex(w); return true;
    }
  }
  return false;
}
// the server's shape (digworld.py) and back: the welcome, the offline copy in localStorage, a clone
export function toShared(w) {
  const nodes = {}, segs = {}, pits = {};
  for (const n of w.nodes) nodes[n.id] = { x: n.x, y: n.y, z: n.z, r: n.r, h: n.hole ? 1 : 0, sys: n.sys, o: n.open ? 1 : 0 };
  for (const s of w.segs) segs[s.id] = [s.a, s.b];
  for (const p of w.pits) pits[p.id] = { x: p.x, z: p.z, y0: p.y0, r: p.r, d: p.depth, hx: p.hx, hz: p.hz, o: [...p.open] };
  return { v: 1, nodes, segs, pits };
}
export function fromShared(tile, d) {
  const w = newWorld(tile); if (!d) return w;
  for (const [id, n] of Object.entries(d.nodes || {})) { const o = { id, x: n.x, y: n.y, z: n.z, r: n.r, hole: !!n.h, sys: n.sys, open: !!n.o, segs: [] }; w.nodes.push(o); w.byId.set(id, o); }
  for (const [id, [a, b]] of Object.entries(d.segs || {})) { const A = w.byId.get(a), B = w.byId.get(b); if (!A || !B) continue; const s = { id, a, b }; w.segs.push(s); w.byId.set(id, s); A.segs.push(id); B.segs.push(id); }
  for (const [id, p] of Object.entries(d.pits || {})) { const o = { id, x: p.x, z: p.z, y0: p.y0, r: p.r, depth: p.d, hx: p.hx, hz: p.hz, open: (p.o || []).filter(s => w.byId.has(s)), pit: true }; w.pits.push(o); w.byId.set(id, o); }
  return reindex(w);
}
function reindex(w) { w.nodes.forEach((n, i) => { n.i = i; }); w.segs.forEach((s, i) => { s.i = i; }); w.pits.forEach((p, i) => { p.i = i; }); return w; }

// The dig channel of the game socket (server.py GameWorld, the hello `t: 'dig'`): one per page while a world is up,
// whatever the body and whether or not the acorn game runs. As net.js does for the acorn game: `confirmed` is the
// server's world as of the last dseq, the game's `world` that plus this page's events not yet answered (the
// prediction drawn); a reject, or a remote event that does not apply to the prediction, rebuilds it. With no game
// endpoint (a static host, ?net=0) the world is this browser's alone, kept in localStorage per tile and season.
const RETRY_MAX = 30000;
export class DigNet {
  constructor(game) {
    this.game = game; const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    this.forcedOff = q.get('net') === '0'; this.mode = this.forcedOff ? 'offline' : 'probing';
    this.want = null; this.ws = null; this.connected = false; this.host = true; this.n = 1; this.dseq = 0;
    this.confirmed = null; this.pending = []; this.c = 0; this.retry = 0; this.timer = null; this.needRebuild = false;
    this.stats = { sent: 0, accepted: 0, rejected: 0, remote: 0, rebuilds: 0, reconnects: 0 };
  }
  get live() { return this.mode === 'online' && !!this.want; }
  async probe() {
    if (this.forcedOff) return (this.mode = 'offline');
    let mode = 'offline';
    try { const r = await fetch('/api/game', { cache: 'no-store' }); if (r.ok && (await r.json()).protocol === 1) mode = 'online'; } catch (e) { /* offline */ }
    return (this.mode = mode);
  }
  async join(tile, season) {
    this.leave(); this.want = { tile, season }; this.confirmed = null; this.pending = []; this.dseq = 0;
    const mode = await this.probe();
    if (this.want?.tile !== tile || this.want?.season !== season) return;
    if (mode === 'online') this.open(); else this.game.offline(tile, season);
  }
  leave() {
    clearTimeout(this.timer); this.want = null;
    if (this.ws) { const ws = this.ws; this.ws = null; ws.onclose = null; try { ws.close(); } catch (e) { /* closing */ } }
    this.connected = false; this.host = true;
  }
  open() {
    clearTimeout(this.timer);
    if (this.ws) { const old = this.ws; this.ws = null; old.onclose = null; try { old.close(); } catch (e) { /* closing */ } }
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/game/ws`); this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'dig', tile: this.want.tile, season: this.want.season }));
    ws.onmessage = m => { if (this.ws !== ws) return; let d; try { d = JSON.parse(m.data); } catch (e) { return; } this.on(d); };
    ws.onerror = () => {};
    ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; this.connected = false; if (this.want) this.later(); };
  }
  later() {
    clearTimeout(this.timer);
    const d = Math.min(RETRY_MAX, 1000 * 2 ** this.retry) * (0.75 + Math.random() * 0.5); this.retry = Math.min(this.retry + 1, 6);
    this.timer = setTimeout(async () => { if (!this.want) return; this.stats.reconnects++; if ((await this.probe()) === 'online') this.open(); else if (this.want) this.later(); }, d);
  }
  event(e) {   // a locally applied event: to the server, held until it answers
    if (!this.live) return;
    const p = { c: ++this.c, e }; this.pending.push(p); if (this.pending.length > 400) this.pending.shift();
    this.stats.sent++; if (this.ws && this.connected) this.ws.send(JSON.stringify({ t: 'dev', c: p.c, e }));
  }
  on(d) {
    const G = this.game;
    if (d.t === 'dwelcome') {
      this.connected = true; this.retry = 0; this.host = !!d.host; this.n = d.n; this.dseq = d.dig.seq; this.idle = d.idle;
      this.confirmed = fromShared(G.tile.id, d.dig);
      for (const p of this.pending) this.ws.send(JSON.stringify({ t: 'dev', c: p.c, e: p.e }));   // still unanswered: the server decides
      this.rebuild(); return;
    }
    if (d.t === 'dhost') { this.host = !!d.host; this.n = d.n; return; }
    if (!this.confirmed) return;
    if (d.t === 'dev') {
      if (d.dseq !== this.dseq + 1) { this.stats.reconnects++; this.open(); return; }   // a gap: a fresh welcome
      this.dseq = d.dseq;
      applyEvent(this.confirmed, d.e);
      if (d.c !== undefined) { const i = this.pending.findIndex(p => p.c === d.c); if (i >= 0) this.pending.splice(i, 1); this.stats.accepted++; return; }   // already drawn when it was predicted
      this.stats.remote++;
      if (applyEvent(G.world, d.e)) G.drawEvent(d.e); else this.needRebuild = true;
    } else if (d.t === 'drej') {
      const i = this.pending.findIndex(p => p.c === d.c); if (i >= 0) this.pending.splice(i, 1);
      this.stats.rejected++; this.needRebuild = true;
    }
  }
  tick() { if (this.needRebuild && this.confirmed) this.rebuild(); }
  rebuild() {
    this.needRebuild = false; this.stats.rebuilds++;
    const w = fromShared(this.game.tile.id, toShared(this.confirmed));
    for (const p of this.pending) applyEvent(w, p.e);
    this.game.adopt(w);
  }
}

// ---- the dirt ---------------------------------------------------------------------------------------
const DIRT_VERT = /* glsl */`
  attribute float aGlow; attribute vec4 aNb0; attribute vec4 aNb1;
  varying vec3 vPos; varying vec3 vN; varying float vGlow; varying vec4 vNb0; varying vec4 vNb1;
  void main(){ vPos = position; vN = normal; vGlow = aGlow; vNb0 = aNb0; vNb1 = aNb1; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const DIRT_FRAG = /* glsl */`
  varying vec3 vPos; varying vec3 vN; varying float vGlow; varying vec4 vNb0; varying vec4 vNb1;
  uniform sampler2D caps;                          // the capsules: texel 2i = (a, ra), 2i+1 = (b, rb)
  uniform vec4 lights[${LIGHTS}]; uniform int lightN;   // the nearest holes and pits: xyz, radius
  uniform vec4 pits[${PITS_U}]; uniform vec4 pitY[${PITS_U}]; uniform int pitN;   // x, z, r, depth; y0
  uniform vec4 nose;                               // the player's whiskers: xyz, reach
  uniform vec3 soil; uniform float stones; uniform float kind; uniform vec3 glowCol; uniform float time; uniform float skyK;
  uniform vec3 sunDir; uniform vec3 sunLight; uniform vec3 ambientSky; uniform vec3 ambientGround;
  float hash3(vec3 p){ uvec3 q = uvec3(ivec3(floor(p)) + 65536); uint h = q.x * 1597334677u ^ q.y * 3812015801u ^ q.z * 2798796415u;
    h = (h ^ (h >> 15)) * 2246822519u; h ^= h >> 13; return float(h) * (1.0 / 4294967296.0); }
  float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  // a round cone: the tube between a (radius r1) and b (radius r2) with round ends (iq)
  float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
    vec3 ba = b - a; float l2 = dot(ba, ba), rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1.0 / max(l2, 1e-9);
    vec3 pa = p - a; float y = dot(pa, ba), z = y - l2, x2 = dot(pa * l2 - ba * y, pa * l2 - ba * y), y2 = y * y * l2, z2 = z * z * l2;
    float k = sign(rr) * rr * rr * x2;
    if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
    if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
    return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1; }
  bool inCap(float fi, vec3 p) { int i = int(fi + 0.5); if (i < 0) return false;
    vec4 A = texelFetch(caps, ivec2(2 * i, 0), 0), B = texelFetch(caps, ivec2(2 * i + 1, 0), 0);
    return sdRoundCone(p, A.xyz, B.xyz, A.w, B.w) < -(0.045 * max(A.w, B.w) + 0.0012); }   // less the mesh's chord error (SIDES)
  void main(){
    vec3 p = vPos;
    // the air: inside a neighbouring capsule, or inside a pit's bowl (the bowls' own fragments skip it)
    if (inCap(vNb0.x, p) || inCap(vNb0.y, p) || inCap(vNb0.z, p) || inCap(vNb0.w, p) || inCap(vNb1.x, p) || inCap(vNb1.y, p) || inCap(vNb1.z, p) || inCap(vNb1.w, p)) discard;
    if (kind != 1.0) for (int i = 0; i < ${PITS_U}; i++) { if (i >= pitN) break;
      vec2 d = p.xz - pits[i].xy; float rho2 = dot(d, d), r2 = pits[i].z * pits[i].z;
      if (rho2 < r2 && p.y > pitY[i].x - pits[i].w * (1.0 - rho2 / r2) + 0.003) discard; }
    vec3 n = normalize(vN); if (dot(n, cameraPosition - p) < 0.0) n = -n;   // the side the eye sees
    // the wall: the soil's colour, a 2 cm and a 6 mm grain, stones (cells of 3 cm, by the soil's rock fragments) and
    // roots (pale threads, denser near the surface's side of a tube)
    float g1 = vnoise3(p * 50.0), g2 = vnoise3(p * 160.0 + 7.0), g3 = vnoise3(p * 500.0 + 3.0);
    vec3 col = soil * (0.75 + 0.35 * g1 + 0.2 * (g2 - 0.5) + 0.12 * (g3 - 0.5));
    { vec3 c = floor(p * 33.0), f = fract(p * 33.0) - 0.5; float h = hash3(c + 11.0);
      if (h < stones * 0.55) { float s = 0.18 + 0.22 * hash3(c + 23.0); vec3 o = (vec3(hash3(c + 31.0), hash3(c + 37.0), hash3(c + 41.0)) - 0.5) * 0.5;
        float d = length(f - o) / s; if (d < 1.0) { float t = hash3(c + 47.0); col = mix(col, mix(vec3(0.3, 0.29, 0.27), vec3(0.42, 0.36, 0.3), t) * (0.8 + 0.4 * g2), smoothstep(1.0, 0.7, d)); } } }
    if (kind == 0.0) { float rt = abs(vnoise3(vec3(p.x * 90.0, p.y * 25.0, p.z * 90.0) + 5.0) - 0.5) * 2.0;
      float root = smoothstep(0.965, 1.0, 1.0 - rt) * clamp(-n.y + 0.3, 0.0, 1.0) * step(0.55, vnoise3(p * 9.0 + 2.0));   // the roots hang from the roof
      col = mix(col, vec3(0.5, 0.4, 0.27) * (0.8 + 0.4 * g3), root * 0.7); }
    vec3 L;
    if (kind == 0.0) {   // inside: the light down the nearest holes and pits, the whiskers, the scent glow, a floor
      L = vec3(0.03, 0.032, 0.036);
      vec3 sky = (ambientSky * 0.8 + sunLight * 0.12 * max(sunDir.y, 0.0)) * skyK;
      for (int i = 0; i < ${LIGHTS}; i++) { if (i >= lightN) break;
        vec3 to = lights[i].xyz - p; float d = max(0.0, length(to) - lights[i].w);
        L += 0.6 * sky * exp(-d / (1.5 * lights[i].w)) * (0.45 + 0.55 * clamp(dot(n, normalize(to)), 0.0, 1.0)); }   // falls by e every 1.5 widths of the opening
      float dn = length(nose.xyz - p); L += vec3(1.0, 0.82, 0.55) * 2.4 * exp(-dn / nose.w);
    } else if (kind == 1.0) {   // a pit's bowl: the sky from above, less toward the bottom, the sun on the lit side
      float deep = clamp((pitY[0].x - p.y) / max(pits[0].w, 0.02), 0.0, 1.0);
      L = (ambientSky * (0.35 + 0.65 * max(n.y, 0.0)) * (1.0 - 0.55 * deep) + sunLight * max(dot(n, sunDir), 0.0) * (1.0 - 0.6 * deep)) * 0.3183;
    } else {   // spoil above ground: as the ground is lit; fresh earth, darker and lumpier than the surface's
      col *= 0.62 * (0.8 + 0.4 * vnoise3(p * 320.0 + 9.0));
      L = (sunLight * max(dot(n, sunDir), 0.0) + mix(ambientGround, ambientSky, 0.5 + 0.5 * n.y)) * 0.3183;
    }
    vec3 outc = col * L;
    if (kind == 0.0) outc += glowCol * vGlow * (0.75 + 0.25 * sin(time * 3.0 + p.x * 20.0)) * 1.6;   // the scent of the voles along an opened tunnel
    gl_FragColor = vec4(outc, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// a surface of revolution round the vertical axis at (cx, cy, cz): profile [[rho, dy], ...] from the inside out, written
// into the arrays at vertex v0 / index i0; the normal points into the dirt (the material is double sided; lighting
// flips it toward the eye)
function lathe(P, N, I, v0, i0, cx, cy, cz, prof, fx = 0, fz = 0) {   // fx, fz: the outer rings' centres shifted (a fan of spoil)
  for (let k = 0; k < LATHE_R; k++) {
    const u = k / (LATHE_R - 1), sh = u * u, ox = fx * sh, oz = fz * sh;
    const q = prof[Math.min(k, prof.length - 1)], q0 = prof[Math.max(0, Math.min(k, prof.length - 1) - 1)], q1 = prof[Math.min(prof.length - 1, Math.min(k, prof.length - 1) + 1)];
    const dr = q1[0] - q0[0], dy = q1[1] - q0[1], nl = Math.hypot(dr, dy) || 1, nr = dy / nl, ny = -dr / nl;   // (dy, -dr): the dirt side of the profile's tangent
    for (let s = 0; s < SIDES; s++) {   // LATHE_S sides but SIDES used for the stride: keep one stride for every ring
      const a = s / SIDES * TAU, ca = Math.cos(a), sa = Math.sin(a), v = (v0 + k * SIDES + s) * 3;
      P[v] = cx + ox + ca * q[0]; P[v + 1] = cy + q[1]; P[v + 2] = cz + oz + sa * q[0];
      N[v] = ca * nr; N[v + 1] = ny; N[v + 2] = sa * nr;
    }
  }
  let i = i0;
  for (let k = 0; k < LATHE_R - 1; k++) for (let s = 0; s < SIDES; s++) {
    const a = v0 + k * SIDES + s, b = v0 + k * SIDES + (s + 1) % SIDES, c = a + SIDES, d = b + SIDES;
    I[i++] = a; I[i++] = c; I[i++] = b; I[i++] = b; I[i++] = c; I[i++] = d;
  }
}

export class Dig {
  constructor({ tile, scene, camera, flight, ground, animals, squirrel, needs, season }) {
    Object.assign(this, { tile, scene, camera, flight, gc: ground, animals, sq: squirrel, needs, seasonNow: season });
    this.heights = animals.heights;
    this.mult = 1; this.stats = { ms: 0, max: 0 }; this.time = 0;
    this.tag = Math.random().toString(36).slice(2, 8); this.n = 0;   // this page's ids: <tag>.<n> (base 36)
    this.world = newWorld(tile.id); this.season = null; this.local = false;
    this.saveT = -1; this.dirty = false; this.visits = new Map(); this.seasonT = 0;
    this.tun = null;            // the player's vole in the tunnel: { a, b, t, prev }
    this.face = 0; this.digging = 0; this.pit = null;
    this.pd = { at: null, prev: null, yaw: 0, pitch: 0, face: 0, startDown: false };   // the player's vole's dig (digCore)
    this.HOLE_SEEK = HOLE_SEEK; this.AI_DIG_P = AI_DIG_P;   // animals.js reads them
    this.glowT = 0; this.glowOf = new Float32Array(MAX_N); this.dist = new Float32Array(MAX_N); this.heap = new Int32Array(MAX_N); this.parent = new Int32Array(MAX_N);
    this.soil = new THREE.Color(...SOIL_DEFAULT);
    this.nbScratch = new Int32Array(NB);
    this.build();
    this.net = new DigNet(this);
    this.onHide = () => this.save(); addEventListener('pagehide', this.onHide);
    this.soilFrom(tile);
    if (typeof window !== 'undefined') window.__weDig = this;
  }
  get key() { return `wild-earth:dig:${this.tile.id}/${this.season}`; }
  newId() { return `${this.tag}.${(this.n++).toString(36)}`; }
  // the season's world: the server's (DigNet) or, with no game endpoint, this browser's own
  join(season) {
    this.season = season; this.adopt(newWorld(this.tile.id)); this.local = false;
    this.net.join(this.tile.id, season);
  }
  offline(tile, season) {
    this.local = true; let w = null;
    try { const j = JSON.parse(localStorage.getItem(this.key) || 'null'); if (j?.v === 1) w = fromShared(tile, j); } catch (e) { /* private mode */ }
    this.adopt(w || newWorld(tile));
  }

  // ---- geometry -------------------------------------------------------------------------------------
  build() {
    const mk = (nv, ni, kind) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(nv), 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aNb0', new THREE.BufferAttribute(new Float32Array(nv * 4).fill(-1), 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aNb1', new THREE.BufferAttribute(new Float32Array(nv * 4).fill(-1), 4).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(ni), 1)); g.setDrawRange(0, 0);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);   // never culled by a stale bound
      const m = new THREE.Mesh(g, this.material(kind)); m.frustumCulled = false; m.name = `dig ${kind}`; m.renderOrder = -1; m.visible = false;
      this.scene.add(m); return m;
    };
    const capN = MAX_S + MAX_H;
    this.capsData = new Float32Array(capN * 2 * 4); this.capsTex = new THREE.DataTexture(this.capsData, capN * 2, 1, THREE.RGBAFormat, THREE.FloatType);
    this.capsTex.magFilter = this.capsTex.minFilter = THREE.NearestFilter; this.capsTex.needsUpdate = true;
    this.u = {
      caps: { value: this.capsTex }, lights: { value: Array.from({ length: LIGHTS }, () => new THREE.Vector4()) }, lightN: { value: 0 },
      pits: { value: Array.from({ length: PITS_U }, () => new THREE.Vector4()) }, pitY: { value: Array.from({ length: PITS_U }, () => new THREE.Vector4()) }, pitN: { value: 0 },
      nose: { value: new THREE.Vector4(0, -1e4, 0, 0.1) }, soil: { value: this.soil }, stones: { value: 0.2 }, glowCol: { value: GLOW_COL.clone() }, time: { value: 0 }, skyK: { value: 1 },
      sunDir: atmo.sunDir, sunLight: atmo.sunLight, ambientSky: atmo.ambientSky, ambientGround: atmo.ambientGround,
    };
    this.tubes = mk(MAX_S * SEG_V, MAX_S * SEG_I, 0);
    this.bowls = mk(MAX_P * LATHE_V, MAX_P * LATHE_I, 1);
    this.heaps = mk((MAX_H + MAX_P) * LATHE_V, (MAX_H + MAX_P) * LATHE_I, 2);
    this.holeSlot = new Map();   // node id -> collar slot
    // the scent trail over an opened system (a canid's nose): soft additive spots on the ground over its nodes and
    // segments, as bright as the tunnel's glow there (glowPass), drawn while the player is a coyote or a fox
    const TRAIL_N = this.TRAIL_N = 160, tg = new THREE.InstancedBufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3)); tg.setIndex([0, 1, 2, 0, 2, 3]);
    tg.setAttribute('aSpot', new THREE.InstancedBufferAttribute(new Float32Array(TRAIL_N * 4), 4).setUsage(THREE.DynamicDrawUsage));
    tg.instanceCount = 0;
    this.trail = new THREE.Mesh(tg, new THREE.ShaderMaterial({
      uniforms: { glowCol: this.u.glowCol, time: this.u.time },
      vertexShader: `attribute vec4 aSpot; varying vec2 vQ; varying float vG; uniform float time;
        void main(){ vQ = position.xy; vG = aSpot.w * (0.8 + 0.2 * sin(time * 3.0 + aSpot.x * 7.0));
          vec4 c = viewMatrix * vec4(aSpot.xyz, 1.0); float s = 0.1 + 0.12 * aSpot.w; c.xy += position.xy * s; gl_Position = projectionMatrix * c; }`,
      fragmentShader: `uniform vec3 glowCol; varying vec2 vQ; varying float vG;
        void main(){ float r = dot(vQ, vQ); if (r > 1.0) discard; gl_FragColor = vec4(glowCol * vG * (1.0 - r) * (1.0 - r) * 1.3, 1.0); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trail.frustumCulled = false; this.trail.name = 'dig scent trail'; this.trail.renderOrder = 2; this.trail.visible = false; this.scene.add(this.trail);
    // the dirt thrown back: a pool of specks (DIRT_N) recycled from the nose or the paws
    const DIRT_N = this.DIRT_N = 48;
    this.specks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: new THREE.Color(0.25, 0.17, 0.1) }), DIRT_N);
    this.specks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.specks.frustumCulled = false; this.specks.count = 0; this.specks.name = 'dig specks'; this.scene.add(this.specks);
    this.sp = new Float32Array(DIRT_N * 8); this.spN = 0;   // x y z vx vy vz life size
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._x = new THREE.Vector3();
    this._best = { d: 0, n: null, s: null }; this.cutIdx = new Int32Array(CUTS + LIGHTS);
    this.cuts = groundUniforms.digCuts.value;
  }
  material(kind) {
    const m = new THREE.ShaderMaterial({ vertexShader: DIRT_VERT, fragmentShader: DIRT_FRAG, uniforms: { ...this.u, kind: { value: kind } }, side: THREE.DoubleSide });
    m.name = `dirt ${kind}`; return m;
  }
  // the soil under the tile's origin cell for now: the map unit under the first hole (or the player) names the texture
  // class in soils/classes.json; its rock fragments set the stones
  async soilFrom(tile) {
    const g = tile.soils; if (!g) return;
    try {
      const r = await fetch(`../tiles/${tile.id}/soils/classes.json`); if (!r.ok) return;
      this.soilClasses = (await r.json()).mapunits || null;
    } catch (e) { this.soilClasses = null; }
    this.soilAt(this.flight.pos.x, -this.flight.pos.z);
  }
  soilAt(x, north) {
    const g = this.tile.soils; if (!g) return;
    const [i, j] = g.cellOf(x, north), idx = g.channel(i, j, 0), frag = g.channel(i, j, 1);
    const u = this.soilClasses?.[idx], c = SOIL[u?.texture_class] || SOIL_DEFAULT;
    this.soil.setRGB(c[0], c[1], c[2]); this.u.stones.value = clamp(frag / 100, 0.03, 0.7);
  }
  // capsule i: (a, ra) and (b, rb) into the float texture (i < MAX_S a segment, else a hole's collar)
  capsule(i, ax, ay, az, ra, bx, by, bz, rb) {
    const D = this.capsData, o = i * 8; D[o] = ax; D[o + 1] = ay; D[o + 2] = az; D[o + 3] = ra; D[o + 4] = bx; D[o + 5] = by; D[o + 6] = bz; D[o + 7] = rb;
    this.capsTex.needsUpdate = true;
  }
  segIndex(s) { return s ? s.i : -1; }
  // a segment's tube: eight rings of SIDES (three on each round end, two for the body) between its nodes' radii
  writeSeg(s) {
    const w = this.world, i = this.segIndex(s); if (i < 0 || i >= MAX_S) return;
    const A = w.byId.get(s.a), B = w.byId.get(s.b), g = this.tubes.geometry, P = g.attributes.position.array, N = g.attributes.normal.array;
    let tx = B.x - A.x, ty = B.y - A.y, tz = B.z - A.z; const L = Math.hypot(tx, ty, tz) || 1e-6; tx /= L; ty /= L; tz /= L;
    // a frame round the axis
    let ux = 0, uy = 1, uz = 0; if (Math.abs(ty) > 0.9) { ux = 1; uy = 0; }
    let nx = uy * tz - uz * ty, ny = uz * tx - ux * tz, nz = ux * ty - uy * tx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const v0 = i * SEG_V;
    for (let k = 0; k < RINGS; k++) {
      // rings 0-2: the cap at A (pole, 30, 60 degrees), 3: A's end ring, 4: B's end ring, 5-7: the cap at B (60, 30, pole)
      const atA = k <= 3, c = atA ? A : B, r = c.r, phi = k === 0 || k === 7 ? 0 : k === 1 || k === 6 ? Math.PI / 6 : k === 2 || k === 5 ? Math.PI / 3 : Math.PI / 2;
      const sp = Math.sin(phi), cp = Math.cos(phi) * (atA ? -1 : 1);
      for (let sdx = 0; sdx < SIDES; sdx++) {
        const a = sdx / SIDES * TAU, ca = Math.cos(a), sa = Math.sin(a), v = (v0 + k * SIDES + sdx) * 3;
        const rx = nx * ca + bx * sa, ry = ny * ca + by * sa, rz = nz * ca + bz * sa;
        const ox = rx * sp + tx * cp, oy = ry * sp + ty * cp, oz = rz * sp + tz * cp;
        P[v] = c.x + ox * r; P[v + 1] = c.y + oy * r; P[v + 2] = c.z + oz * r;
        N[v] = ox; N[v + 1] = oy; N[v + 2] = oz;
      }
    }
    const I = g.index.array; let q = i * SEG_I;
    if (I[q] === 0 && I[q + 1] === 0) for (let k = 0; k < RINGS - 1; k++) for (let sdx = 0; sdx < SIDES; sdx++) {   // written once per slot
      const a = v0 + k * SIDES + sdx, b = v0 + k * SIDES + (sdx + 1) % SIDES, c = a + SIDES, d = b + SIDES;
      I[q++] = a; I[q++] = c; I[q++] = b; I[q++] = b; I[q++] = c; I[q++] = d;
    }
    g.attributes.position.addUpdateRange(v0 * 3, SEG_V * 3); g.attributes.position.needsUpdate = true;
    g.attributes.normal.addUpdateRange(v0 * 3, SEG_V * 3); g.attributes.normal.needsUpdate = true;
    g.index.needsUpdate = true;
    const n = Math.min(w.segs.length, MAX_S); g.setDrawRange(0, n * SEG_I); this.tubes.visible = n > 0;
    this.capsule(i, A.x, A.y, A.z, A.r, B.x, B.y, B.z, B.r);
    this.writeGlow(s);
  }
  writeGlow(s) {
    const w = this.world, i = this.segIndex(s); if (i < 0 || i >= MAX_S) return;
    const ga = this.glowOf[w.byId.get(s.a).i] || 0, gb = this.glowOf[w.byId.get(s.b).i] || 0;
    const G = this.tubes.geometry.attributes.aGlow, v0 = i * SEG_V;
    for (let k = 0; k < RINGS; k++) { const t = k <= 3 ? 0 : k >= 4 ? 1 : 0.5, v = ga + (gb - ga) * t; for (let sdx = 0; sdx < SIDES; sdx++) G.array[v0 + k * SIDES + sdx] = v; }
    G.addUpdateRange(v0, SEG_V); G.needsUpdate = true;
  }
  // neighbours: the segments sharing a node, the collars at its holes, and any capsule within reach of it (a chamber's
  // neighbours), up to NB; written into every vertex of the segment (and the capsule texture for the hole collar)
  nbOf(s, out) {
    const w = this.world, A = w.byId.get(s.a), B = w.byId.get(s.b); let n = 0; out.fill(-1);
    const add = i => { if (n < NB && i >= 0 && !out.includes(i)) out[n++] = i; };
    for (const node of [A, B]) { for (const id of node.segs) { const o = w.byId.get(id); if (o !== s) add(this.segIndex(o)); } if (node.hole && this.holeSlot.has(node.id)) add(MAX_S + this.holeSlot.get(node.id)); }
    // capsules that overlap this one though not adjacent (a chamber swallowing a passing tube; a pit opened both)
    const rMax = Math.max(A.r, B.r) + R_CHAMBER, mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, mz = (A.z + B.z) / 2, hl = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) / 2 + rMax;
    for (let j = 0; j < w.segs.length && n < NB; j++) {
      const o = w.segs[j]; if (o === s || out.includes(j)) continue;
      const C = w.byId.get(o.a), D = w.byId.get(o.b), ox = (C.x + D.x) / 2, oy = (C.y + D.y) / 2, oz = (C.z + D.z) / 2;
      const reach = hl + Math.hypot(D.x - C.x, D.y - C.y, D.z - C.z) / 2 + Math.max(C.r, D.r);
      if ((ox - mx) ** 2 + (oy - my) ** 2 + (oz - mz) ** 2 > reach * reach) continue;
      if (segDist(A, B, C, D) < Math.max(A.r, B.r) + Math.max(C.r, D.r)) add(j);
    }
    return n;
  }
  writeNb(s) {
    const i = this.segIndex(s); if (i < 0 || i >= MAX_S) return;
    const nb = this.nbScratch; this.nbOf(s, nb);
    const g = this.tubes.geometry, N0 = g.attributes.aNb0, N1 = g.attributes.aNb1, v0 = i * SEG_V;
    for (let v = v0; v < v0 + SEG_V; v++) { for (let k = 0; k < 4; k++) { N0.array[v * 4 + k] = nb[k]; N1.array[v * 4 + k] = nb[4 + k]; } }
    N0.addUpdateRange(v0 * 4, SEG_V * 4); N0.needsUpdate = true; N1.addUpdateRange(v0 * 4, SEG_V * 4); N1.needsUpdate = true;
  }
  // the segments round a node (and their neighbours) relinked after a change there
  relinkAt(node) {
    const w = this.world, seen = new Set();
    for (const id of node.segs) { const s = w.byId.get(id); seen.add(s); const A = w.byId.get(s.a), B = w.byId.get(s.b); for (const m of [A, B]) for (const id2 of m.segs) seen.add(w.byId.get(id2)); }
    for (const s of seen) this.writeNb(s);
    if (node.hole) this.writeHole(node);
  }
  relinkAll() { for (const s of this.world.segs) this.writeNb(s); for (const p of this.world.pits) this.writePitNb(p); }
  // a hole: the collar (a vertical cylinder from under the node to COLLAR_UP radii over the ground) and the spoil ring
  // round it, one lathe; its capsule (the collar) in the texture past the segments'
  writeHole(n) {
    let slot = this.holeSlot.get(n.id);
    if (slot === undefined) { if (this.holeSlot.size >= MAX_H) return; slot = this.holeSlot.size; this.holeSlot.set(n.id, slot); }
    const r = n.r, gy = n.y + r, g = this.heaps.geometry, v0 = slot * LATHE_V;
    // the spoil thrown out away from the tunnel: the outer rings shifted that way (a fan, not a ring)
    let fx = 0, fz = 0; if (n.segs.length) { const o = this.node(this.otherEnd(n.segs[0], n)), dx = n.x - o.x, dz = n.z - o.z, dl = Math.hypot(dx, dz); if (dl > 1e-6) { fx = dx / dl * 2.4 * r; fz = dz / dl * 2.4 * r; } }
    lathe(g.attributes.position.array, g.attributes.normal.array, g.index.array, v0, slot * LATHE_I, n.x, gy, n.z,
      [[r, -1.3 * r], [r, COLLAR_UP * r], [1.35 * r, 0.75 * r], [2.0 * r, 0.5 * r], [2.8 * r, 0.18 * r], [3.6 * r, 0]], fx, fz);
    for (const a of ['position', 'normal']) { g.attributes[a].addUpdateRange(v0 * 3, LATHE_V * 3); g.attributes[a].needsUpdate = true; }
    g.index.needsUpdate = true;
    this.capsule(MAX_S + slot, n.x, n.y, n.z, r, n.x, gy + COLLAR_UP * r, n.z, r);
    const nb = this.nbScratch; nb.fill(-1); let k = 0; for (const id of n.segs) if (k < NB) nb[k++] = this.segIndex(this.world.byId.get(id));
    const N0 = g.attributes.aNb0, N1 = g.attributes.aNb1;
    for (let v = v0; v < v0 + LATHE_V; v++) for (let q = 0; q < 4; q++) { N0.array[v * 4 + q] = nb[q]; N1.array[v * 4 + q] = nb[4 + q]; }
    N0.addUpdateRange(v0 * 4, LATHE_V * 4); N0.needsUpdate = true; N1.addUpdateRange(v0 * 4, LATHE_V * 4); N1.needsUpdate = true;
    this.heapRange();
  }
  heapRange() { const n = MAX_H + Math.min(this.world.pits.length, MAX_P); this.heaps.geometry.setDrawRange(0, n * LATHE_I); this.heaps.visible = this.holeSlot.size > 0 || this.world.pits.length > 0; }
  pitIndex(p) { return p ? p.i : -1; }
  // a pit: the bowl (rim at the ground, a parabola to the bottom) and its mound of spoil behind
  writePit(p) {
    const i = this.pitIndex(p); if (i < 0 || i >= MAX_P) return;
    const g = this.bowls.geometry, v0 = i * LATHE_V, prof = [];
    for (let k = 0; k < LATHE_R; k++) { const u = k / (LATHE_R - 1), rho = p.r * Math.sqrt(u); prof.push([rho, -p.depth * (1 - u)]); }   // from the bottom out to the rim; even steps in height
    lathe(g.attributes.position.array, g.attributes.normal.array, g.index.array, v0, i * LATHE_I, p.x, p.y0, p.z, prof);
    for (const a of ['position', 'normal']) { g.attributes[a].addUpdateRange(v0 * 3, LATHE_V * 3); g.attributes[a].needsUpdate = true; }
    g.index.needsUpdate = true;
    const n = Math.min(this.world.pits.length, MAX_P); g.setDrawRange(0, n * LATHE_I); this.bowls.visible = n > 0;
    this.writePitNb(p);
  }
  writePitNb(p) {
    const i = this.pitIndex(p); if (i < 0 || i >= MAX_P) return;
    const g = this.bowls.geometry, v0 = i * LATHE_V, nb = this.nbScratch; nb.fill(-1); let k = 0;
    for (const id of p.open) if (k < NB) nb[k++] = this.segIndex(this.world.byId.get(id));
    const N0 = g.attributes.aNb0, N1 = g.attributes.aNb1;
    for (let v = v0; v < v0 + LATHE_V; v++) for (let q = 0; q < 4; q++) { N0.array[v * 4 + q] = nb[q]; N1.array[v * 4 + q] = nb[4 + q]; }
    N0.addUpdateRange(v0 * 4, LATHE_V * 4); N0.needsUpdate = true; N1.addUpdateRange(v0 * 4, LATHE_V * 4); N1.needsUpdate = true;
  }
  writePitHeap(p) {
    const i = this.pitIndex(p); if (i < 0 || i >= MAX_P) return;
    const slot = MAX_H + i, g = this.heaps.geometry, v0 = slot * LATHE_V, R = 0.5 * p.r + 0.12, h = Math.min(0.25, 0.45 * p.depth + 0.01);
    const gy = this.groundY(p.hx, p.hz);
    lathe(g.attributes.position.array, g.attributes.normal.array, g.index.array, v0, slot * LATHE_I, p.hx, gy, p.hz, [[0, h], [0.3 * R, 0.85 * h], [0.6 * R, 0.5 * h], [0.85 * R, 0.18 * h], [R, 0], [R, 0]]);
    for (const a of ['position', 'normal']) { g.attributes[a].addUpdateRange(v0 * 3, LATHE_V * 3); g.attributes[a].needsUpdate = true; }
    g.index.needsUpdate = true; this.heapRange();
  }

  // ---- events ---------------------------------------------------------------------------------------
  // Every change: applied to the prediction, drawn, sent (online) or saved (offline). ai: the AI's digging, sent only
  // by the AI host (the first page on the world's dig channel; offline, this page).
  dispatch(e, ai = false) {
    if (ai && !this.net.host && !this.local) return false;
    if (!applyEvent(this.world, e)) return false;
    this.drawEvent(e);
    if (this.local) { this.dirty = true; if (this.saveT < 0) this.saveT = SAVE_S; }
    else this.net.event(ai ? { ...e, ai: true } : e);
    return true;
  }
  // what an applied event changes on screen
  drawEvent(e) {
    const w = this.world, get = id => w.byId.get(id);
    switch (e.type) {
      case 'hole': this.writeHole(get(e.id)); break;
      case 'dig': { const s = get(e.seg); this.writeSeg(s); this.relinkAt(get(e.from)); this.writeNb(s); break; }
      case 'grow': { const n = get(e.id); for (const id of n.segs) this.writeSeg(get(id)); this.relinkAt(n); break; }
      case 'join': { const s = get(e.seg); this.writeSeg(s); this.relinkAt(get(e.a)); this.relinkAt(get(e.b)); break; }
      case 'widen': { const seen = new Set(); for (const id of e.ids) { const n = get(id); if (!n) continue; for (const sid of n.segs) seen.add(get(sid)); } for (const s of seen) this.writeSeg(s); for (const id of e.ids) { const n = get(id); if (n) this.relinkAt(n); } break; }
      case 'surface': { const n = get(e.id); for (const id of n.segs) this.writeSeg(get(id)); this.writeHole(n); this.relinkAt(n); break; }
      case 'pit': { const p = get(e.id); this.writePit(p); this.writePitHeap(p); break; }
      case 'open': { const p = get(e.pit); this.writePitNb(p); for (const id of e.segs) { const s = get(id); if (s) this.writeNb(s); } this.glowT = 0; break; }
      case 'decay': this.redrawAll(); this.checkTun(); break;
    }
  }
  // a whole new world (a welcome, a rebuild, a season): every slot written again
  adopt(w) { this.world = w; this.redrawAll(); this.checkTun(); }
  redrawAll() {
    const w = this.world; this.holeSlot.clear(); this.glowOf.fill(0);
    this.tubes.geometry.setDrawRange(0, 0); this.tubes.visible = false; this.bowls.geometry.setDrawRange(0, 0); this.bowls.visible = false;
    for (const s of w.segs) this.writeSeg(s);
    for (const n of w.nodes) if (n.hole) this.writeHole(n);
    for (const p of w.pits) { this.writePit(p); this.writePitHeap(p); }
    this.heapRange(); this.relinkAll();
  }
  // the player's vole underground in a system that is gone (decayed, or rolled back): back up on the surface
  checkTun() {
    const T = this.tun; if (!T || (this.world.byId.has(T.a) && this.world.byId.has(T.b))) return;
    const gc = this.gc, P = gc.flight.pos; this.tun = null; gc.mode = 'ground'; P.y = this.groundY(P.x, P.z); gc.camSettled = false; gc.last.copy(P);
  }
  save() {
    if (!this.local || !this.dirty || !this.season) return;
    try { localStorage.setItem(this.key, JSON.stringify(toShared(this.world))); this.dirty = false; } catch (e) { /* private mode or full */ }
    this.saveT = -1;
  }
  // an animal inside a system or a pit: the server's clock for the decay, at most once an hour per place
  visit(key, isPit, ai = false) {
    const now = Date.now(), last = this.visits.get(key) || 0; if (now - last < VISIT_MS) return;
    this.visits.set(key, now); if (this.local) return;
    if (ai && !this.net.host) return;
    this.net.event(isPit ? { type: 'visit', pit: key, ...(ai ? { ai: true } : {}) } : { type: 'visit', sys: key, ...(ai ? { ai: true } : {}) });
  }
  // ---- geometry of the ground --------------------------------------------------------------------------
  groundY(x, z) { const F = this.sq.footing(x, z, this.heights.atXZ(x, z) + 2); return F.surf !== null ? F.bed : F.y; }
  node(id) { return this.world.byId.get(id); }
  nearestNode(x, y, z, R, skip = null, skip2 = null) {
    let best = null, bd = R * R;
    for (const n of this.world.nodes) { if (n === skip || n === skip2) continue; const d2 = (n.x - x) ** 2 + (n.y - y) ** 2 + (n.z - z) ** 2; if (d2 < bd) { bd = d2; best = n; } }
    return best;
  }
  // the hole within R m of (x, z) on the ground (for an AI vole: in a system with room)
  holeNear(x, z, R, a = null, bare = false) {
    let best = null, bd = R * R;
    for (const n of this.world.nodes) {
      if (!n.hole || (n.segs.length === 0 && !bare)) continue;
      const d2 = (n.x - x) ** 2 + (n.z - z) ** 2; if (d2 >= bd) continue;
      if (a && this.sysCount(n.sys) >= SYS_CAP) continue;
      bd = d2; best = n;
    }
    return best;
  }
  sysCount(sys) { let n = 0; for (const a of this.aiIn) if (a.tun && this.node(a.tun.a)?.sys === sys) n++; return n; }
  get aiIn() { return this._aiIn ||= new Set(); }

  // ---- the player's dig: when ----------------------------------------------------------------------------
  // The dig key: Q held; or E held when it would do nothing else (the vole with nothing to eat under its nose, the
  // coyote with no prey within the pounce's reach and no carcass beside it).
  wantDig(gc, act) {
    const code = gc.code; if (code !== 'microtus_californicus' && code !== 'canis_latrans') return false;
    const k = gc.flight.keys; if (k.has('KeyQ')) return true;
    if (!k.has('KeyE')) return false;
    if (code === 'microtus_californicus') return !(this.needs && this.needs.foodHere >= 25);
    const P = gc.flight.pos;
    if (this.animals.preyNear?.(P.x, P.y, P.z, 2.6, gc.flight.yaw, 1.0)) return false;
    if (this.animals.carrionNear?.(P.x, P.z, 2.5)) return false;
    if (this.needs?.atWater) return false;
    return true;
  }
  // on the ground with the key held: the vole starts a tunnel at its nose (or goes down a hole there), the coyote digs
  // its pit. true when the vole left the ground (groundControl returns).
  surfaceDig(dt) {
    const gc = this.gc, f = gc.flight, P = f.pos, S = gc.S;
    if (gc.code === 'microtus_californicus') {
      const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), nx = P.x + fx * S.half * gc.size * 1.2, nz = P.z + fz * S.half * gc.size * 1.2;
      const h = this.holeNear(nx, nz, CHAMBER_NEAR, null, true); if (h) { this.enterHole(h); return true; }   // a hole at the nose: down it
      const gy = this.groundY(nx, nz), id = this.newId();
      if (this.nearestNode(nx, gy - R_TUBE, nz, CHAMBER_NEAR)) { gc.say('a tunnel runs just here'); return false; }
      if (!this.dispatch({ type: 'hole', id, x: nx, y: gy - R_TUBE, z: nz })) return false;
      const n = this.node(id); this.tun = { a: n.id, b: n.id, t: 1, prev: -1 }; this.pd.face = 0; this.pd.startDown = true;
      gc.mode = 'tunnel'; gc.v = 0; gc.sit = 0; gc.resting = false; gc.actT = 0; this.soilAt(nx, -nz);
      gc.say('digging in');
      return true;
    }
    // the coyote: the pit at its paws, widened and deepened while held; the paw strikes (groundControl animate)
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), px = P.x + fx * S.half * gc.size * PAW_AHEAD, pz = P.z + fz * S.half * gc.size * PAW_AHEAD;
    let p = this.pit && Math.hypot(this.pit.x - px, this.pit.z - pz) < 0.35 ? this.pit : null;
    if (!p) { for (const q of this.world.pits) if (Math.hypot(q.x - px, q.z - pz) < Math.max(0.35, q.r)) { p = q; break; } }
    if (!p) {
      const id = this.newId(), y0 = this.groundY(px, pz);
      if (!this.dispatch({ type: 'pit', id, x: px, z: pz, y0, r: PIT_R0, depth: 0.004, hx: P.x - fx * S.half * gc.size * 1.3, hz: P.z - fz * S.half * gc.size * 1.3 })) return false;
      p = this.world.pits.find(q => q.id === id); this.face = 0; this.soilAt(px, -pz);
    }
    this.pit = p; gc.digging = 1; gc.actT = 0; this.visit(p.id, true);
    if (p.depth >= PIT_MAX) return false;
    this.face += RATE * this.mult * dt;
    this.specksFrom(px, p.y0 - p.depth * 0.5, pz, -fx, -fz, 0.012 * gc.size, dt, 40, 0.9);
    if (this.face >= PIT_STEP) {
      const depth = Math.min(PIT_MAX, p.depth + Math.floor(this.face / PIT_STEP) * PIT_STEP); this.face %= PIT_STEP;
      this.dispatch({ type: 'pit', id: p.id, x: p.x, z: p.z, y0: p.y0, r: Math.min(1.0, PIT_R0 + PIT_RK * depth), depth, hx: p.hx, hz: p.hz });
      this.openCheck(p);
    }
    return false;
  }
  // the pit's bottom against the tunnels: a segment whose tube reaches up into the bowl opens
  openCheck(p) {
    const w = this.world, bottom = p.y0 - p.depth, open = [];
    for (const s of w.segs) {
      if (p.open.includes(s.id)) continue;
      const A = w.byId.get(s.a), B = w.byId.get(s.b);
      // the nearest point of the axis to the pit's centre line (vertical), then the bowl's floor there
      let t = 0; { const dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz; if (l2 > 1e-9) t = clamp(((p.x - A.x) * dx + (p.z - A.z) * dz) / l2, 0, 1); }
      const qx = A.x + (B.x - A.x) * t, qy = A.y + (B.y - A.y) * t, qz = A.z + (B.z - A.z) * t, r = A.r + (B.r - A.r) * t;
      const rho2 = (qx - p.x) ** 2 + (qz - p.z) ** 2; if (rho2 >= p.r * p.r) continue;
      const floor = bottom + p.depth * (rho2 / (p.r * p.r));
      if (qy + r > floor + 0.002) open.push(s.id);
    }
    if (!open.length) return;
    if (this.dispatch({ type: 'open', pit: p.id, segs: open })) {
      const s = w.byId.get(open[0]), sys = w.byId.get(s.a).sys;
      this.gc.say('a tunnel opens under the paws');
      this.flee(sys, w.byId.get(s.a));
    }
  }

  // ---- the vole underground ------------------------------------------------------------------------------
  enterHole(h) {
    const gc = this.gc, f = gc.flight;
    this.tun = { a: h.id, b: h.id, t: 1, prev: -1 }; this.pd.face = 0; this.pd.startDown = false;
    // facing the first segment down
    if (h.segs.length) { const s = this.node(this.otherEnd(h.segs[0], h)); f.yaw = Math.atan2(-(s.x - h.x), -(s.z - h.z)); }
    gc.mode = 'tunnel'; gc.v = 0; gc.sit = 0; gc.resting = false; gc.actT = 0; this.soilAt(h.x, -h.z);
    gc.say('down the hole');
  }
  // the nodes within L m of n along the tunnels (n's own last stretch: never a chamber's join)
  within(n, L) {
    const seen = this._within ||= new Set(), q = this._wq ||= [], dq = this._wd ||= []; seen.clear(); q.length = 0; dq.length = 0;
    seen.add(n); q.push(n); dq.push(0);
    for (let i = 0; i < q.length; i++) {
      const m = q[i], d = dq[i];
      for (const id of m.segs) { const o = this.node(this.otherEnd(id, m)); if (seen.has(o)) continue; const nd = d + Math.hypot(o.x - m.x, o.y - m.y, o.z - m.z); if (nd > L) continue; seen.add(o); q.push(o); dq.push(nd); }
    }
    return seen;
  }
  otherEnd(segId, n) { const s = this.node(segId); return s.a === n.id ? s.b : s.a; }
  // where the player's body is along the segment (a, b, t): the centreline point and the tube's radius there
  axisAt(T, out) { const A = this.node(T.a), B = this.node(T.b), t = T.t; out.x = A.x + (B.x - A.x) * t; out.y = A.y + (B.y - A.y) * t; out.z = A.z + (B.z - A.z) * t; out.w = A.r + (B.r - A.r) * t; return out; }
  // one frame in the tunnel (groundControl mode 'tunnel'): W along the centreline the way it faces, S back, A D turn
  // on the spot, the dig key digs from a node ahead, W at a hole with nothing ahead climbs out
  tunnelStep(dt, k) {
    const gc = this.gc, f = gc.flight, P = f.pos, S = gc.S, T = this.tun, ps = gc.pose;
    if (!T) { gc.mode = 'ground'; return; }
    const held = this.wantDig(gc); if (!held) this.broke = false;
    const dig = held && !this.broke;   // after a break-out the key must be let go before the next dig
    f.yaw += k.turn * (this.digging ? Math.min(S.turn, RATE * this.mult / R_TURN) : S.turn) * dt;   // digging, the body turns only as the face can carry a curve
    let A = this.node(T.a), B = this.node(T.b);
    let L = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
    const segYaw = L > 1e-6 ? Math.atan2(-(B.x - A.x), -(B.z - A.z)) : f.yaw;
    const fwd = L > 1e-6 ? Math.cos(wrap(f.yaw - segYaw)) >= 0 : true;   // facing toward B
    // speed along the tunnel (a walk; W builds to the cruise), signed toward B
    const want = k.fwd > 0 ? 0.5 : k.fwd < 0 ? -0.3 : (dig ? 0.3 : 0);   // the dig key walks it on to the node ahead
    gc.v = damp(gc.v, want, Math.abs(want) < Math.abs(gc.v) ? 12 : 8, dt); if (Math.abs(gc.v) < 0.005) gc.v = 0;
    const along = gc.v * (fwd ? 1 : -1);
    let atNode = null;
    if (L > 1e-6 && along !== 0) {
      T.t += along * dt / L;
      if (T.t >= 1) { T.t = 1; atNode = B; } else if (T.t <= 0) { T.t = 0; atNode = A; }
    } else if (L <= 1e-6) atNode = B;
    // at a node: the branch nearest the way it faces (within 100 degrees), else stop; out of a hole facing no branch
    if (atNode && along !== 0 || (atNode && dig)) {
      const n = atNode, cur = T.a === T.b ? null : (T.a === n.id ? T.b : T.a), fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
      let best = null, bc = -0.17;
      for (const id of n.segs) {
        const o = this.node(this.otherEnd(id, n)); if (o.id === cur && n.segs.length > 1 && k.fwd > 0) continue;
        const dx = o.x - n.x, dz = o.z - n.z, dl = Math.hypot(dx, dz) || 1e-6, c = (dx * fx + dz * fz) / dl;
        if (c > bc) { bc = c; best = o; }
      }
      if (best && (k.fwd > 0 || (dig && !this.wantNewDig(n, f)))) { T.prev = cur ?? T.prev; T.a = n.id; T.b = best.id; T.t = 0; A = n; B = best; L = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z); }
      else if (n.hole && k.fwd > 0 && !dig) { this.leaveHole(n); return; }
      else if (!dig) gc.v = 0;
    }
    // the dig: from the node the body stands at, the way it faces, down the slope it looks along
    const at = T.t >= 1 ? B : T.t <= 0 ? A : null;
    if (dig && at && (at === B || T.a === T.b || k.fwd <= 0)) this.digFrom(at, dt); else { this.digging = 0; gc.digging = 0; }
    // the body on the tunnel's floor, pitched with the slope; its camera on the centreline behind (camera())
    const Q = this.axisAt(T, this._ax ||= new THREE.Vector4());
    P.set(Q.x, Q.y - Q.w * 0.85, Q.z);
    gc.animate(dt, Math.abs(gc.v), false);
    this.visit(this.node(T.b).sys, false);
    const A2 = this.node(T.a), B2 = this.node(T.b), dh = Math.hypot(B2.x - A2.x, B2.z - A2.z), dy = B2.y - A2.y;
    const pitch = dh > 1e-6 ? -Math.atan2(dy, dh) : 0, fwd2 = Math.cos(wrap(f.yaw - (dh > 1e-6 ? Math.atan2(-(B2.x - A2.x), -(B2.z - A2.z)) : f.yaw))) >= 0;
    ps.pitch = damp(ps.pitch, (fwd2 ? pitch : -pitch) * 0.9, 10, dt);
    if (this.digging) {   // the dig's pose: nose down into the face, the fore feet scrabbling fast and low, the dirt back
      ps.pitch = damp(ps.pitch, 0.35 + 0.08 * Math.sin(this.time * 40), 14, dt); ps.amp = 0.45; ps.phase += dt * TAU * 9; ps.lift = 0.002 * Math.max(0, Math.sin(ps.phase * 2));
      ps.flick = damp(ps.flick, 0.6 + 0.3 * Math.sin(this.time * 31), 12, dt);
    }
    gc.spd = Math.abs(gc.v); gc.inAir = false;
  }
  // a dig from node n goes a new way when the body faces no existing segment within BEND of it (else it walks on)
  wantNewDig(n, f) {
    const d = this.digDir(n, f.yaw, f.pitch, this.pd), w = this.world;
    for (const id of n.segs) { const o = this.node(this.otherEnd(id, n)); const dx = o.x - n.x, dy = o.y - n.y, dz = o.z - n.z, l = Math.hypot(dx, dy, dz) || 1e-6; if ((dx * d.x + dy * d.y + dz * d.z) / l > Math.cos(BEND)) return false; }
    return true;
  }
  // the way a dig from node n goes: the heading yaw (the flight's convention: forward -z at 0) and the look's pitch,
  // steeply down from the surface until under (D.startDown), level or up once as deep as a vole goes. Into D.d.
  digDir(n, yaw, pitch, D) {
    const d = D.d ||= { x: 0, y: 0, z: 0, phi: 0 }, gy = this.groundY(n.x, n.z), depth = gy - n.y;
    let phi = clamp(pitch, -SLOPE_MAX, SLOPE_MAX);
    if (D.startDown && depth < 3 * R_TUBE) phi = Math.min(phi, START_PITCH); else D.startDown = false;
    if (depth > MAX_DEPTH) phi = Math.max(phi, 0.08);
    const c = Math.cos(phi); d.x = -Math.sin(yaw) * c; d.y = Math.sin(phi); d.z = -Math.cos(yaw) * c; d.phi = phi;
    return d;
  }
  // The face advancing, for the player's vole and the AI's alike: D = { at, prev (node ids), yaw, pitch, face (m dug
  // since the last step), startDown }; dt of digging at the rate. Returns 'join' (a chamber's join and widening),
  // 'surface' (broke out: D.at is the new hole), 'stop' (refused) or ''.
  digCore(D, dt, ai) {
    const w = this.world; let n = this.node(D.at); if (!n) return 'stop';
    D.face += RATE * this.mult * dt;
    const d = this.digDir(n, D.yaw, D.pitch, D);
    let steps = Math.floor(D.face / STEP); if (steps <= 0) return '';
    D.face -= steps * STEP; if (steps > 4) steps = 4;
    for (let i = 0; i < steps; i++) {
      this.digDir(n, D.yaw, D.pitch, D);
      const cx = n.x + d.x * STEP, cy = n.y + d.y * STEP, cz = n.z + d.z * STEP, cur = D.prev ? this.node(D.prev) : null;
      // a chamber: the face comes within CHAMBER_NEAR of an older part of the system (not its own last stretch)
      const near = this.nearestNode(cx, cy, cz, CHAMBER_NEAR, n, cur);
      if (near && !this.within(n, JOIN_PATH).has(near)) {
        const seg = this.newId();
        if (this.dispatch({ type: 'join', a: n.id, b: near.id, seg }, ai)) {
          const ids = []; for (const o of [n, near]) if (!o.hole) ids.push(o.id);
          for (const o of w.nodes) if (o !== n && o !== near && !o.hole && o.sys === n.sys && ids.length < 32 && (o.x - cx) ** 2 + (o.y - cy) ** 2 + (o.z - cz) ** 2 < (2 * CHAMBER_NEAR) ** 2) ids.push(o.id);
          const r = Math.min(R_CHAMBER, Math.max(n.r, near.r) + WIDEN_STEP);
          if (ids.length) this.dispatch({ type: 'widen', ids, r }, ai);
          D.prev = n.id; D.at = near.id; D.face = 0; D.joinR = r;
          return 'join';
        }
      }
      // straight on and short: the leaf node moves; else a new node
      let grown = false;
      if (cur && n.segs.length === 1 && !n.hole) {
        const sx = n.x - cur.x, sy = n.y - cur.y, sz = n.z - cur.z, sl = Math.hypot(sx, sy, sz) || 1e-6;
        if ((sx * d.x + sy * d.y + sz * d.z) / sl > Math.cos(BEND) && sl + STEP < SEG_MAX) grown = this.dispatch({ type: 'grow', id: n.id, x: cx, y: cy, z: cz }, ai);
      }
      if (!grown) {
        const id = this.newId(), seg = this.newId();
        if (!this.dispatch({ type: 'dig', from: n.id, id, seg, x: cx, y: cy, z: cz }, ai)) { D.face = 0; return 'stop'; }
        D.prev = n.id; D.at = id; n = this.node(id);
      }
      const gy = this.groundY(n.x, n.z);
      if (n.y + n.r >= gy - 0.003 && !D.startDown) { this.dispatch({ type: 'surface', id: n.id, y: gy - n.r }, ai); D.face = 0; return 'surface'; }
    }
    return '';
  }
  // the player's vole digging from node n, the way it faces and looks
  digFrom(n, dt) {
    const gc = this.gc, f = gc.flight, T = this.tun, D = this.pd;
    if (!this.wantNewDig(n, f)) { this.digging = 0; gc.digging = 0; return; }
    if (n.hole && n.segs.length && this.digDir(n, f.yaw, f.pitch, D).y > -0.15) {   // at a hole the way up is the open air: W climbs out
      this.digging = 0; gc.digging = 0; if (!this.toldOut) { this.toldOut = true; gc.say('at the surface: W climbs out'); } return;
    }
    this.toldOut = false; this.digging = 1; gc.digging = 1; gc.actT = 0;
    const d = this.digDir(n, f.yaw, f.pitch, D);
    this.specksFrom(n.x + d.x * n.r, n.y - n.r * 0.5, n.z + d.z * n.r, -d.x, -d.z, 0.004, dt, 30, 0.25);
    D.at = n.id; D.prev = T.a === T.b ? null : (T.a === n.id ? T.b : T.a); D.yaw = f.yaw; D.pitch = f.pitch;
    const res = this.digCore(D, dt, false);
    if (D.at !== n.id) { T.prev = D.prev; T.a = D.prev ?? D.at; T.b = D.at; T.t = 1; }
    if (res === 'join') gc.say(D.joinR >= R_CHAMBER ? 'a chamber' : 'the tunnel joins; the room widens');
    if (res === 'surface') { gc.say('out into the light: W climbs out'); this.broke = true; this.digging = 0; gc.digging = 0; }
  }
  leaveHole(n) {
    const gc = this.gc, P = gc.flight.pos, gy = n.y + n.r;
    gc.mode = 'ground'; P.set(n.x, gy, n.z); gc.v = 0.2; gc.digging = 0; this.digging = 0; this.tun = null; gc.camSettled = false; gc.last.copy(P);
    this.outOf = n;   // not straight back down it: ignored until the body is off it
    gc.say('up on the surface');
  }
  // the camera in the tunnel: on the centreline CAM_BACK m behind the body (back along the tunnel, round its bends),
  // looking along it past the body. true while it holds the camera.
  camStep(dt) {
    const T = this.tun; if (!T) return false;
    const gc = this.gc, f = gc.flight, cam = this.camera, Q = this.axisAt(T, this._ax ||= new THREE.Vector4());
    // straight back from the body along its heading and the tunnel's slope, then pulled in until it is inside the
    // tunnels (the union of the capsules near the body), so it never leaves through a wall or a bend
    const A = this.node(T.a), B = this.node(T.b), dh = Math.hypot(B.x - A.x, B.z - A.z), dy = B.y - A.y;
    const segYaw = dh > 1e-6 ? Math.atan2(-(B.x - A.x), -(B.z - A.z)) : f.yaw, fwd = Math.cos(wrap(f.yaw - segYaw)) >= 0;
    const slope = dh > 1e-6 ? Math.atan2(dy, dh) * (fwd ? 1 : -1) : 0, cs = Math.cos(slope);
    const bx = Math.sin(f.yaw) * cs, by = -Math.sin(slope), bz = Math.cos(f.yaw) * cs;
    const back = (0.2 + Q.w * 1.5) * (f.zoom || 1), near = this.within(this.node(T.b), 0.8);
    const C = this._v.set(Q.x, Q.y + Q.w * 0.2, Q.z);
    for (let d = 0.02; d <= back + 1e-6; d += 0.02) {
      const x = Q.x + bx * d, y = Q.y + Q.w * 0.2 + by * d, z = Q.z + bz * d;
      if (!this.inside(x, y, z, near, 0.012)) break;
      C.set(x, y, z);
    }
    if (!this.camSet) { cam.position.copy(C); this.camSet = true; } else cam.position.lerp(C, 1 - Math.exp(-dt * 10));
    const aim = this._w.set(Q.x - bx * 0.1, Q.y - Q.w * 0.2 - by * 0.1, Q.z - bz * 0.1);   // past the body along the tunnel
    cam.up.set(0, 1, 0); cam.lookAt(aim);
    this.u.nose.value.set(f.pos.x - Math.sin(f.yaw) * gc.S.half * gc.size, f.pos.y + 0.02, f.pos.z - Math.cos(f.yaw) * gc.S.half * gc.size, 0.14);
    return true;
  }
  // (x, y, z) inside the tunnels by `margin` m: within some segment's tube of the nodes given
  inside(x, y, z, nodes, margin) {
    for (const n of nodes) for (const id of n.segs) {
      const s = this.node(id), A = this.node(s.a), B = this.node(s.b);
      const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, l2 = dx * dx + dy * dy + dz * dz;
      const t = l2 > 1e-12 ? clamp(((x - A.x) * dx + (y - A.y) * dy + (z - A.z) * dz) / l2, 0, 1) : 0;
      const r = A.r + (B.r - A.r) * t, ex = A.x + dx * t - x, ey = A.y + dy * t - y, ez = A.z + dz * t - z;
      if (ex * ex + ey * ey + ez * ez < (r - margin) * (r - margin)) return true;
    }
    return false;
  }
  hudText() {
    const T = this.tun; if (!T) return '';
    const Q = this.axisAt(T, this._ax ||= new THREE.Vector4()), depth = this.groundY(Q.x, Q.z) - Q.y;
    const d = `${Math.max(0, Math.round(depth * 100))} cm down`;
    if (this.digging) { const phi = this.pd.d?.phi || 0; return `digging, ${Math.abs(phi) < 0.08 ? 'level' : (phi < 0 ? 'down ' : 'up ') + Math.round(Math.abs(phi) * 180 / Math.PI) + '°'} · ${d}`; }
    return `${Q.w > R_TUBE + 0.02 ? 'in a chamber' : 'in the tunnel'} · ${d}`;
  }
  // the player leaves the body underground (spirit.js): the AI vole takes it at the nearest hole on the surface
  leavePoint(out) {
    const T = this.tun; if (!T) return false;
    const n = this.node(T.b), h = this.nearestHoleOf(n); if (!h) return false;
    out.x = h.x; out.y = h.y + h.r; out.z = h.z; this.tun = null; this.gc.mode = 'ground'; return true;
  }
  nearestHoleOf(n) { let best = null, bd = Infinity; for (const o of this.world.nodes) if (o.hole && o.sys === n.sys) { const d = (o.x - n.x) ** 2 + (o.z - n.z) ** 2; if (d < bd) { bd = d; best = o; } } return best; }

  // ---- the dirt thrown back ------------------------------------------------------------------------------
  specksFrom(x, y, z, bx, bz, size, dt, rate, speed) {
    const S = this.sp, N = this.DIRT_N; let n = Math.floor(rate * dt + Math.random());
    for (let i = 0; i < N && n > 0; i++) {
      const o = i * 8; if (S[o + 6] > 0) continue;
      S[o] = x; S[o + 1] = y; S[o + 2] = z; const sp = speed * (0.6 + 0.8 * Math.random());
      S[o + 3] = bx * sp + (Math.random() - 0.5) * sp * 0.5; S[o + 4] = sp * (0.8 + 0.8 * Math.random()); S[o + 5] = bz * sp + (Math.random() - 0.5) * sp * 0.5;
      S[o + 6] = 0.35 + 0.35 * Math.random(); S[o + 7] = size * (0.6 + 0.8 * Math.random()); n--;
    }
  }
  specksStep(dt) {
    const S = this.sp, N = this.DIRT_N, M = this.specks, m = this._m, q = this._q, p = this._p, s = this._s; let k = 0;
    for (let i = 0; i < N; i++) {
      const o = i * 8; if (S[o + 6] <= 0) continue;
      S[o + 6] -= dt; S[o + 4] -= 9.8 * dt; S[o] += S[o + 3] * dt; S[o + 1] += S[o + 4] * dt; S[o + 2] += S[o + 5] * dt;
      p.set(S[o], S[o + 1], S[o + 2]); s.setScalar(S[o + 7]); q.set(0, 0, 0, 1); m.compose(p, q, s); m.toArray(M.instanceMatrix.array, k * 16); k++;
    }
    if (k !== M.count || k) { M.count = k; M.instanceMatrix.needsUpdate = true; }
    M.visible = k > 0;
  }

  // ---- the AI voles -----------------------------------------------------------------------------------------
  // animals.js voBurrow: a vole at a hole goes down (aiEnter), through the system to its far end or a chamber, waits
  // HIDE_S s, then back to a hole and up (aiStep false: out, with a runway from the hole); a vole the AI host sets
  // digging (aiDigStart) digs a burrow at the rate (aiDigStep): down, along, round into a chamber, up to a second hole.
  aiEnter(a, hole) {
    if (!hole || !hole.segs.length) return false;
    const goal = this.farNode(hole, null, true) || hole;
    a.tun = { path: this.pathTo(hole, goal), i: 0, t: 0, wait: HIDE_S[0] + Math.random() * (HIDE_S[1] - HIDE_S[0]), speed: AI_WALK, out: false };
    this.aiIn.add(a); a.buried = true; a.vis = 1;
    return true;
  }
  aiStep(a, dt, danger) {
    const T = a.tun; if (!T) { this.aiIn.delete(a); return false; }
    const r = a.rng || Math.random, last = this.node(T.path[T.path.length - 1]);
    if (!last) return this.aiOut(a);   // its tunnels went (decayed, or rolled back): up where it is
    if (T.i >= T.path.length - 1) {   // at the goal: wait, then head for a hole; out when there
      if (T.out) { if (last.hole) { this.aiLeave(a, last); return false; } const h = this.nearestHoleOf(last); if (!h) return this.aiOut(a); T.path = this.pathTo(last, h); T.i = 0; T.t = 0; T.out = false; T.going = true; if (T.path.length < 2) { this.aiLeave(a, last); return false; } }
      else if (T.going) { T.out = true; }
      else { T.wait -= dt; a.amp = damp(a.amp, 0, 10, dt); a.spd = 0; if (r() < dt * 0.5) a.flickV = 0.5; if (T.wait <= 0 && !danger) { T.out = true; T.speed = AI_WALK; } }
      this.visit(last.sys, false, true);
    }
    if (T.i < T.path.length - 1) {
      const A = this.node(T.path[T.i]), B = this.node(T.path[T.i + 1]);
      if (!A || !B) return this.aiOut(a);
      const L = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) || 1e-6;
      T.t += T.speed * dt / L;
      if (T.t >= 1) { T.t = 0; T.i++; if (T.i >= T.path.length - 1 && T.going) T.out = true; }
      const t = Math.min(1, T.t), rr = A.r + (B.r - A.r) * t;
      a.x = A.x + (B.x - A.x) * t; a.z = A.z + (B.z - A.z) * t; a.y = A.y + (B.y - A.y) * t - rr * 0.85 + 0.004 * Math.abs(Math.sin(a.phase)) * a.amp;
      a.yaw = Math.atan2(B.x - A.x, B.z - A.z); a.pitch = -Math.atan2(B.y - A.y, Math.hypot(B.x - A.x, B.z - A.z) || 1e-6);
      a.amp = damp(a.amp, 1, 14, dt); a.phase += dt * TAU * T.speed / 0.09; a.spd = T.speed;
      a.buried = !(A.open || B.open);
    } else a.buried = !last.open;
    a.vis = 1; a.pose = damp(a.pose, 0, 6, dt); a.roll = 0; a.e2 = 0;
    return true;
  }
  aiLeave(a, hole) {
    a.tun = null; a.dig = null; a.buried = false; this.aiIn.delete(a);
    const L = 2 + Math.random() * 2, ang = Math.random() * TAU;
    a.x = hole.x; a.z = hole.z; a.y = hole.y + hole.r; a.pitch = 0;
    a.sx = hole.x; a.sz = hole.z; a.tx = hole.x + Math.cos(ang) * L; a.tz = hole.z + Math.sin(ang) * L; a.u = 0; a.h = 0;
  }
  aiDead(a) { a.tun = null; a.dig = null; this.aiIn.delete(a); }   // killed down here (animals.js kill): it lies where it died
  aiOut(a) {   // its tunnels are gone: on the surface where it was
    a.tun = null; a.dig = null; a.buried = false; this.aiIn.delete(a);
    a.y = this.groundY(a.x, a.z); a.pitch = 0; a.sx = a.x; a.sz = a.z; a.tx = a.x + 2; a.tz = a.z; a.u = 0; a.h = 0;
    return false;
  }
  // the AI host starts a calm vole digging a burrow where it is: none within 4 m of another hole, at most AI_DIG_MAX
  // at once, none past AI_DIG_HOLES holes in the world, not in water
  aiDigStart(a) {
    if (!this.local && !this.net.host) return false;
    let n = 0; for (const b of this.aiIn) if (b.dig) n++; if (n >= AI_DIG_MAX) return false;
    let holes = 0; for (const o of this.world.nodes) if (o.hole) holes++; if (holes >= AI_DIG_HOLES) return false;
    if (this.holeNear(a.x, a.z, 4, null, true)) return false;
    const F = this.sq.footing(a.x, a.z, this.heights.atXZ(a.x, a.z) + 1); if (F.surf !== null) return false;
    const id = this.newId(), gy = F.y;
    if (!this.dispatch({ type: 'hole', id, x: a.x, y: gy - R_TUBE, z: a.z }, true)) return false;
    const r = a.rng || Math.random, yaw = r() * TAU;
    a.dig = { D: { at: id, prev: null, yaw, pitch: -0.5, face: 0, startDown: true }, stage: 0, depth: 0.12 + 0.12 * r(), len: 0.6 + 0.8 * r(), run: 0, turn: 0, wob: r() * TAU, side: r() < 0.5 ? -1 : 1 };
    this.aiIn.add(a); a.buried = true; a.tun = null;
    return true;
  }
  aiDigStep(a, dt, scared) {
    const G = a.dig; if (!G) return false;
    const D = G.D, n = this.node(D.at); if (!n) return this.aiOut(a);
    const gy = this.groundY(n.x, n.z), depth = gy - n.y, adv = RATE * this.mult * dt;
    if (G.stage === 0) { D.pitch = -0.5; if (depth >= G.depth) G.stage = 1; }
    else if (G.stage === 1 || G.stage === 3) { D.pitch = clamp((G.depth - depth) * -3, -0.2, 0.2); G.wob += dt * 0.05 * this.mult; D.yaw += Math.sin(G.wob) * 0.4 * adv; G.run += adv; if (G.run >= (G.stage === 1 ? G.len : 0.35)) { G.stage++; G.run = 0; } }
    else if (G.stage === 2) { D.pitch = 0; const w = Math.min(3, RATE * this.mult / R_TURN) * dt; D.yaw += G.side * w; G.turn += w; if (G.turn > TAU * 1.15) G.stage = 3; }
    else D.pitch = 0.5;
    const res = this.digCore(D, dt, true);
    const m = this.node(D.at); if (!m) return this.aiOut(a);
    a.x = m.x; a.z = m.z; a.y = m.y - m.r * 0.85; a.yaw = D.yaw + Math.PI; a.pitch = -(D.d?.phi || 0) * 0.8;
    a.amp = 0.45; a.phase += dt * TAU * 9; a.spd = 0; a.vis = 1; a.buried = !m.open; a.pose = damp(a.pose, 0, 6, dt);
    if (res === 'surface') { this.aiLeave(a, m); return false; }
    if (res === 'stop' && G.stage < 4) G.stage = 4;
    return true;
  }
  // the voles of a system flee the opened node down the other branches: each to the node farthest from it
  flee(sys, from) {
    for (const a of this.aiIn) {
      const T = a.tun; if (!T) continue; const here = this.node(T.path[Math.min(T.i, T.path.length - 1)]); if (!here || here.sys !== sys) continue;
      let goal = this.farNode(from, null, true) || here, going = false;
      if (goal.open) { const h = this.nearestHoleOf(here); if (h) { goal = h; going = true; } }   // nowhere closed left: out a hole
      T.path = this.pathTo(here, goal); T.i = 0; T.t = 0; T.speed = AI_FLEE; T.wait = HIDE_S[1]; T.out = false; T.going = going;
    }
  }
  // graph search over a system (Dijkstra, preallocated): dist from `src` (a node, or every vole when `multi`)
  search(src, multi) {
    const w = this.world, N = w.nodes, dist = this.dist, par = this.parent, H = this.heap; let hn = 0;
    const idx = n => (n && N[n.i] === n ? n.i : -1);
    dist.fill(Infinity, 0, N.length); par.fill(-1, 0, N.length);
    const push = i => { H[hn++] = i; let c = hn - 1; while (c > 0) { const p = (c - 1) >> 1; if (dist[H[p]] <= dist[H[c]]) break; const t = H[p]; H[p] = H[c]; H[c] = t; c = p; } };
    const pop = () => { const top = H[0]; H[0] = H[--hn]; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < hn && dist[H[l]] < dist[H[m]]) m = l; if (r < hn && dist[H[r]] < dist[H[m]]) m = r; if (m === c) break; const t = H[m]; H[m] = H[c]; H[c] = t; c = m; } return top; };
    if (multi) { for (const s of multi) { const i = idx(s.n); if (i >= 0 && hn < MAX_N) { if (s.d < dist[i]) { dist[i] = s.d; push(i); } } } }
    else { const i = idx(src); if (i < 0) return; dist[i] = 0; push(i); }
    while (hn > 0) {
      const i = pop(), n = N[i], d = dist[i];
      for (const id of n.segs) { const o = w.byId.get(this.otherEnd(id, n)), j = idx(o); if (j < 0) continue; const nd = d + Math.hypot(o.x - n.x, o.y - n.y, o.z - n.z); if (nd < dist[j]) { dist[j] = nd; par[j] = i; if (hn < MAX_N) push(j); } }
    }
  }
  farNode(from, _, chamberFirst = false) {
    this.search(from, null); const N = this.world.nodes; let best = null, bd = -1;
    for (let i = 0; i < N.length; i++) { const n = N[i]; if (!isFinite(this.dist[i]) || n.hole) continue; const sc = this.dist[i] + (chamberFirst && n.r > R_TUBE + 0.02 ? 1 : 0) - (n.open ? 100 : 0); if (sc > bd) { bd = sc; best = n; } }   // never an opened node while a closed one is left
    return best;
  }
  pathTo(from, to) {
    this.search(from, null); const N = this.world.nodes, path = []; let i = N.indexOf(to);
    if (i < 0 || !isFinite(this.dist[i])) return [from.id];
    while (i >= 0) { path.push(N[i].id); i = this.parent[i]; }
    return path.reverse();
  }
  // the scent glow along an opened system: brightest at a vole, falling by e per GLOW_L m along the tunnel; the
  // player's vole counts
  glowPass() {
    const w = this.world, N = w.nodes, G = this.glowOf;
    const open = this._open ||= new Set(); open.clear(); for (const n of N) if (n.open) open.add(n.sys);
    const old = this._gl ||= new Float32Array(MAX_N); old.set(G.subarray(0, N.length));
    G.fill(0, 0, N.length);
    if (open.size) {
      const src = this._src ||= []; src.length = 0; this.srcN = 0;
      for (const a of this.aiIn) { const T = a.tun, n = T ? this.node(T.path[Math.min(T.i, T.path.length - 1)]) : a.dig ? this.node(a.dig.D.at) : null; if (n && open.has(n.sys)) src.push(this.srcOf(n)); }
      if (this.tun) { const n = this.node(this.tun.b); if (n && open.has(n.sys)) src.push(this.srcOf(n)); }
      if (src.length) { this.search(null, src); for (let i = 0; i < N.length; i++) if (isFinite(this.dist[i]) && open.has(N[i].sys)) G[i] = Math.exp(-this.dist[i] / GLOW_L); }
    }
    for (const s of w.segs) { const ia = w.byId.get(s.a).i, ib = w.byId.get(s.b).i; if (G[ia] !== old[ia] || G[ib] !== old[ib]) this.writeGlow(s); }
    // the trail on the ground: a spot over each lit node and at each lit segment's middle
    const canid = this.gc.on && (this.gc.code === 'canis_latrans' || this.gc.code === 'urocyon_cinereoargenteus');
    const T = this.trail.geometry, A = T.attributes.aSpot.array; let k = 0;
    if (canid && open.size) {
      const gyOf = n => (n.gy ??= this.groundY(n.x, n.z));
      for (const n of N) { if (k >= this.TRAIL_N) break; const g = G[n.i]; if (g < 0.04) continue; A[k * 4] = n.x; A[k * 4 + 1] = gyOf(n) + 0.03; A[k * 4 + 2] = n.z; A[k * 4 + 3] = g; k++; }
      for (const s of w.segs) {
        if (k >= this.TRAIL_N) break; const a = w.byId.get(s.a), b = w.byId.get(s.b), g = (G[a.i] + G[b.i]) / 2; if (g < 0.04) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) < 0.08) continue;
        A[k * 4] = (a.x + b.x) / 2; A[k * 4 + 1] = (gyOf(a) + gyOf(b)) / 2 + 0.03; A[k * 4 + 2] = (a.z + b.z) / 2; A[k * 4 + 3] = g; k++;
      }
    }
    if (k || T.instanceCount) { T.instanceCount = k; T.attributes.aSpot.needsUpdate = true; }
    this.trail.visible = k > 0;
  }

  srcOf(n) { const pool = this._srcPool ||= []; const o = pool[this.srcN] ||= { n: null, d: 0 }; this.srcN++; o.n = n; o.d = 0; return o; }   // no allocation per pass
  // ---- each frame -----------------------------------------------------------------------------------------
  update(dt) {
    const t0 = performance.now(); this.time += dt; this.u.time.value = this.time;
    if ((this.seasonT -= dt) <= 0) { this.seasonT = 1; const s = this.seasonNow?.(); if (s && s !== this.season) this.join(s); }   // the season's world
    this.net.tick();
    const gc = this.gc, w = this.world, C = this.camera.position;
    this._C = C;
    if (gc.mode !== 'tunnel') { this.camSet = false; if (this.tun) this.tun = null; }
    if (!gc.on || gc.mode !== 'tunnel') this.u.nose.value.set(0, -1e4, 0, 0.1);
    if (!gc.on || !gc.digging) { gc.digging = 0; this.digging = 0; }
    if (gc.on && gc.mode === 'ground' && !gc.digging) this.pit = null;
    // the vole on the surface walking onto a hole goes down
    if (gc.on && gc.code === 'microtus_californicus' && gc.mode === 'ground' && Math.abs(gc.v) > 0.05) {
      const P = gc.flight.pos, h = this.holeNear(P.x, P.z, R_TUBE * 1.6);
      if (this.outOf && Math.hypot(P.x - this.outOf.x, P.z - this.outOf.z) > this.outOf.r * 3) this.outOf = null;
      if (h && h.segs.length && h !== this.outOf) { const fx = -Math.sin(gc.flight.yaw), fz = -Math.cos(gc.flight.yaw); if ((h.x - P.x) * fx + (h.z - P.z) * fz > -0.01) this.enterHole(h); }
    }
    // the ground's cut discs (the eight nearest holes and pits) and the tunnel's lights (the same openings)
    let k = 0; const cuts = this.cuts, lights = this.u.lights.value;
    const cand = this._cand ||= []; cand.length = 0;
    for (const n of w.nodes) if (n.hole) cand.push(n); for (const p of w.pits) cand.push(p);
    if (cand.length > CUTS) cand.sort(this.byNear ||= (a, b) => ((a.x - this._C.x) ** 2 + (a.z - this._C.z) ** 2) - ((b.x - this._C.x) ** 2 + (b.z - this._C.z) ** 2));
    for (let i = 0; i < cand.length && k < CUTS; i++, k++) {
      const o = cand[i];
      if (o.hole) { cuts[k].set(o.x, o.z, o.r * HOLE_CUT, 0); lights[k].set(o.x, o.y + o.r * (1 + COLLAR_UP), o.z, o.r); }
      else { cuts[k].set(o.x, o.z, o.r, 0); lights[k].set(o.x, o.y0 - o.depth, o.z, o.r * 0.7); }
    }
    groundUniforms.digCutN.value = k; this.u.lightN.value = k;
    // the four nearest pits, for the bowls' carving of the tubes and the bowls' own light
    let pits = w.pits; if (pits.length > PITS_U) { const q = this._pits ||= []; q.length = 0; for (const p of pits) q.push(p); pits = q.sort(this.byNear); }
    let pn = 0;
    for (let i = 0; i < pits.length && pn < PITS_U; i++, pn++) { const p = pits[i]; this.u.pits.value[pn].set(p.x, p.z, p.r, p.depth); this.u.pitY.value[pn].set(p.y0, 0, 0, 0); }
    this.u.pitN.value = pn;
    this.u.skyK.value = clamp(0.25 + 0.75 * clamp(atmo.sunDir.value.y * 4 + 0.4, 0, 1), 0.08, 1);
    this.specksStep(dt);
    if ((this.glowT -= dt) <= 0) { this.glowT = GLOW_T; this.glowPass(); }
    if (this.saveT >= 0 && (this.saveT -= dt) <= 0) this.save();
    const ms = performance.now() - t0; this.stats.ms += (ms - this.stats.ms) * 0.05; if (ms > this.stats.max) this.stats.max = ms;
  }
  dispose(all = true) {
    if (all) { this.save(); this.net.leave(); removeEventListener('pagehide', this.onHide); if (window.__weDig === this) delete window.__weDig; groundUniforms.digCutN.value = 0; }
    for (const m of [this.tubes, this.bowls, this.heaps, this.specks, this.trail]) { if (!m) continue; this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.capsTex?.dispose();
    for (const a of this.aiIn) { a.tun = null; a.buried = false; } this.aiIn.clear();
  }
}

// the distance between the segments AB and CD (Ericson, closest points of two segments)
function segDist(A, B, C, D) {
  const d1x = B.x - A.x, d1y = B.y - A.y, d1z = B.z - A.z, d2x = D.x - C.x, d2y = D.y - C.y, d2z = D.z - C.z, rx = A.x - C.x, ry = A.y - C.y, rz = A.z - C.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) return Math.hypot(rx, ry, rz);
  if (a <= 1e-12) t = clamp(f / e, 0, 1);
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) s = clamp(-c / a, 0, 1);
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const px = A.x + d1x * s - (C.x + d2x * t), py = A.y + d1y * s - (C.y + d2y * t), pz = A.z + d1z * s - (C.z + d2z * t);
  return Math.hypot(px, py, pz);
}
