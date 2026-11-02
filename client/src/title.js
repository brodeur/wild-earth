import * as THREE from 'three';
import { lastTile, locality, majorRoads, CardLineup, seasonHighlight } from './arrival.js';
import { rarityColor, rarityByCode } from './animals.js';
import { seasonOfDate } from './season.js';
import { pointInTileId } from './goto.js';
import { HubStub } from './hubStub.js';

// The title and the earth (docs/multiplayer.md, "What the player sees" 1, 2, 4, 9 and 10, "The earth"; lane 1).
//
// TitleScreen fills #opening in place of the card screen (arrival.js OpeningScreen, kept for ?cards=1) and answers the
// same calls from main.js: onSelect(tileId) asks for a world, setPrep(tileId, text) and setReady(tileId) report its
// build, readyIds remembers the built ones, point and onPoint are the arrival's (the tile centre here, or ?lat=&lon=
// when a built tile holds it), onBegin(choice) enters, close() takes the screen down.
//
// What happens: a field of stars (points in the earth's own scene, drifting) with WILD EARTH across the middle while
// the page loads what the screen needs (the places' names from each tile's features.json, the hub's configuration,
// the month's earth texture); no world is built. Then the title fades and the earth rises from the bottom of the
// screen as a crescent, the sun almost behind it. There the sign-in modal (lane 3, account.js) takes over through
// onGate(title) and calls title.onSignedIn(user) when done (the modal says so and offers Explore when there is no hub);
// with ?hub=stub the stub signs in by itself; with no onGate set a plain Explore button stands in. Signed in, the earth
// rises the rest of the way, the sun swings round to light the side facing the player (the last tile played, else the
// first in the index), a dot appears at each built tile (brighter with more players, the one under the pointer named)
// and over the right side the places within 70 degrees of the facing point are listed, sorted by count then name.
// A drag spins the earth with inertia, the wheel zooms a little, the list follows. Choosing a place (a dot or a row)
// turns and zooms the earth so the place sits centred in the space left of the list, and the tile's card (the card
// screen's own: the map, its title, the wisp while the world builds, Begin when it is ready; arrival.js CardLineup and
// opening.css) stands beside the list, the tile's animals teleporting in round it one by one in their species' soul
// colour (animals.js rarityColor, the spirit view's) as main.js builds the world behind the earth. Begin zooms the earth
// in closer to the dot while the earth fades to black and the dot stays (a DOM spot in the dot's place); then the world
// (the spirit view's arrival) fades in through the same enterWorld path as the screen fades out, the dot with it.
// choose(id) is the one function group travel (lane 4) wraps.
//
// The earth is drawn with the page's shared renderer: while the screen is up (ownsCanvas) main.js's world loop skips
// its visible draws (its compiles and uploads behind the screen go on), so the earth and a building world never fight
// over the one canvas. Everything the screen made on the GPU is let go in close().
//
// Privacy: the only ids here are tile ids; a count per tile is all the hub sends; nothing is stored.

const DEG = Math.PI / 180;
const CAM_FOV = 38;
const DIST = [2.0, 4.6], DIST0 = 3.5;                       // the camera's distance from the earth's centre (radius 1): the wheel's range and its start
const DIST_CARD = 2.6, DIST_BEGIN = 1.45;                   // the zoom when a place is chosen (its card beside the list), and Begin's zoom in to the dot
const POP_CARD = [0.5, 1.0];                                // s between the card's animals' arrivals while the world builds
const Y_BELOW = -2.7, Y_CRESCENT = -1.12, Y_LIT = -0.08, X_LIT = -0.3;   // where the earth's centre sits: off screen, the crescent, lit (left of middle, the list on the right)
const SUN_CRESCENT = [152 * DEG, 26 * DEG], SUN_LIT = [30 * DEG, 14 * DEG];   // [azimuth about Y from the camera's side, elevation]
const VIEW_COS = Math.cos(70 * DEG);                       // a place within 70 degrees of the facing point is listed
const PITCH_MAX = 80 * DEG;
const STAR_N = 1500, STAR_R = 40;
const TITLE_MIN_MS = 2200, LOAD_MAX_MS = 12000;            // the title is seen at least this long; the loading waits at most this long
const DOT_R = 1.004;                                       // the dots stand just off the surface
const HOVER_PX = 16;
const FLING_MAX = 3;                                       // rad/s: the fastest a released drag keeps the earth turning

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const getJSON = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, u) => a + (b - a) * u;
const easeOut = u => 1 - (1 - u) ** 3;
const easeInOut = u => u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
const wait = ms => new Promise(r => setTimeout(r, ms));
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const countText = n => n > 0 ? `${n} here` : 'no one here';

// lat/lon to a point on the unit sphere matching SphereGeometry's mapping (u = 0, lon -180, on -X; lon -90 on +Z).
export function latLonToXYZ(lat, lon, out = new THREE.Vector3()) {
  const la = lat * DEG, phi = (lon + 180) * DEG, c = Math.cos(la);
  return out.set(-c * Math.cos(phi), Math.sin(la), c * Math.sin(phi));
}
const sunVec = ([az, el], out) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
// The yaw (about Y) and pitch (about X, applied after) that bring a sphere point to face the camera on +Z.
const facingOf = p => [Math.atan2(-p.x, p.z), Math.asin(clamp(p.y, -1, 1))];

// The hub over HTTP alone, before lane 3's hub.js: config and me. A 404 or a network error from config is "no hub".
class HubHttp {
  async config() { const r = await fetch('/api/hub/config', { cache: 'no-cache' }); return r.ok ? r.json() : null; }
  async me() { const r = await fetch('/api/hub/me', { cache: 'no-cache' }); if (!r.ok) return null; const j = await r.json(); return j?.you || (j?.id ? j : null); }
  watch() {}
  on() {}
  close() {}
}

// ---- shaders ------------------------------------------------------------------------------------------------------
const EARTH_VERT = /* glsl */`
  varying vec3 vN; varying vec2 vUv; varying vec3 vW;
  void main() {
    vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
// The earth is the spirit world seen from space (Aaron, 2026-11-01): the day side lit by the sun with a soft terminator,
// in the spirit view's palette (spirit.js SpiritLook: the sun's tint LOOK_SUN_TINT, the sky light LOOK_AMB, and its post
// pass, which pulls the warm hues to grey-blue-green by their distance from the blue-green axis and takes contrast off),
// dimmer overall, so the bright dots at the built tiles (the spirits gathered there) stand out; the night side a faint
// blue (no city lights: the earth with no humans); a thin haze-coloured rim inside the limb, stronger where the sun reaches.
const EARTH_FRAG = /* glsl */`
  uniform sampler2D map; uniform vec3 sunDir; uniform float exposure;
  varying vec3 vN; varying vec2 vUv; varying vec3 vW;
  const vec3 SUN_TINT = vec3(0.4, 0.66, 1.0), AMB = vec3(0.3, 0.82, 0.95), HAZE = vec3(0.5, 0.85, 0.9);
  void main() {
    vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
    float ndl = dot(n, sunDir);
    float day = smoothstep(-0.05, 0.28, ndl);
    vec3 c = texture2D(map, vUv).rgb;
    // the spirit view's post pass on the albedo
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), ch = mx - mn, hue = 0.0;
    if (ch > 1e-4) {
      if (mx == c.r) hue = 60.0 * mod((c.g - c.b) / ch, 6.0);
      else if (mx == c.g) hue = 60.0 * ((c.b - c.r) / ch + 2.0);
      else hue = 60.0 * ((c.r - c.g) / ch + 4.0);
    }
    float off = abs(mod(hue - 185.0 + 180.0, 360.0) - 180.0) / 180.0, sat = ch / max(mx, 1e-4);
    float pull = smoothstep(0.22, 0.55, off) * smoothstep(0.02, 0.12, sat);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 albedo = mix(c, l * vec3(0.86, 1.02, 1.04), pull);
    albedo = (albedo - 0.42) * 0.85 + 0.42;
    // lit by a blue sun and a blue-green sky light, dim
    vec3 col = albedo * (0.02 * AMB + exposure * day * (0.45 * AMB + 0.55 * SUN_TINT * max(ndl, 0.0)));
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.5);
    col += HAZE * rim * (0.06 + 0.9 * smoothstep(-0.15, 0.35, ndl)) * 0.55;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
// The atmosphere outside the limb: a back-faced shell a little larger than the earth; the band seen past the limb
// glows most against the earth and fades to nothing at its own edge, and only where the sun reaches it.
const ATMO_FRAG = /* glsl */`
  uniform vec3 sunDir; uniform float shell;
  varying vec3 vN; varying vec2 vUv; varying vec3 vW;
  void main() {
    vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
    float edge = sqrt(1.0 - 1.0 / (shell * shell));
    float band = clamp(-dot(n, v) / edge, 0.0, 1.0);
    float lit = smoothstep(-0.3, 0.35, dot(n, sunDir));
    vec3 col = vec3(0.5, 0.85, 0.9) * pow(band, 1.7) * (0.04 + 0.96 * lit) * 0.55;   // the spirit view's haze colour (spirit.js LOOK_HAZE)
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const STAR_VERT = /* glsl */`
  attribute float aSize; attribute float aPhase;
  uniform float uT; uniform float uDpr;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = (0.7 + 0.3 * sin(uT * (1.2 + aPhase * 2.5) + aPhase * 40.0)) * (0.45 + 0.55 * min(aSize, 1.0));
    gl_PointSize = max(1.5, aSize * 2.4 * uDpr);
  }`;
const STAR_FRAG = /* glsl */`
  uniform float uFade;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.3, r) * vA * uFade;
    gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * a, 1.0);
    #include <colorspace_fragment>
  }`;
// The dots, the spirits gathered at each built tile: bright warm discs with a wide halo, larger and whiter with more
// players, the hovered one larger still; bright against the dim earth.
const DOT_VERT = /* glsl */`
  attribute float aSize; attribute float aGlow; attribute float aHot;
  uniform float uDpr;
  varying float vG; varying float vH;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (aSize + aHot * 5.0) * uDpr * (3.5 / max(0.5, -mv.z));
    vG = aGlow; vH = aHot;
  }`;
const DOT_FRAG = /* glsl */`
  uniform float uFade;
  varying float vG; varying float vH;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = smoothstep(0.55, 0.15, r), halo = pow(1.0 - r, 1.6) * 0.5;
    float a = (core * 1.25 + halo) * uFade * (0.8 + 0.6 * vG + 0.5 * vH);
    vec3 c = mix(vec3(1.0, 0.78, 0.5), vec3(1.0, 0.98, 0.92), vG);
    gl_FragColor = vec4(c * a, 1.0);
    #include <colorspace_fragment>
  }`;

export class TitleScreen {
  // root: #opening; renderer: the page's; index: tiles/index.json; tileId: a hint for the facing tile (?tile=), else
  // the last tile played, else the first; pending: a { lat, lon } to arrive over (its tile faces, if built); hub:
  // 'stub' for hubStub.js, an object with config/me/watch/on/close for a real one (lane 3's hub.js), else the server
  // is asked over HTTP; onSelect(tileId) and onBegin(choice) as the card screen's.
  constructor({ root, renderer, index, tileId = null, pending = null, hub = null, onSelect = null, onBegin }) {
    this.root = root; this.renderer = renderer; this.index = index; this.onSelect = onSelect; this.onBegin = onBegin;
    this.ids = index.tiles.map(t => t.tile_id);
    this.readyIds = new Set(); this.status = {}; this.points = {}; this.counts = {};
    this.sel = null; this.begun = false; this.closed = false; this.phase = 'title';
    this.ownsCanvas = true;      // main.js: the world's loop leaves the canvas to the screen while this is true
    this.onPoint = null;         // main.js sets it (unused here: nothing moves the arrival point on the earth)
    this.onGate = null;          // lane 3: called with the screen when the sign-in's place is reached; it calls onSignedIn
    this.onLit = null;           // lane 3: called with the user (null exploring alone) once onSignedIn has lit the earth
    this.user = null; this.config = null;
    this.hubParam = hub;
    // the places: one per built tile, at the centre of its bounds
    this.places = index.tiles.map(t => {
      const [w, s, e, n] = t.bounds_wgs84 || [0, 0, 0, 0], lat = (s + n) / 2, lon = (w + e) / 2;
      return { id: t.tile_id, lat, lon, p0: latLonToXYZ(lat, lon), name: t.tile_id, region: '', count: 0, el: null, sx: 0, sy: 0, near: false, inView: false };
    });
    this.byId = Object.fromEntries(this.places.map(p => [p.id, p]));
    // the facing tile: ?lat=&lon= in a built tile, else the hint, else the last played, else the first
    let face = null;
    if (pending) {
      const id = this.ids.find(t => pointInTileId(t, pending));
      if (id) { this.points[id] = pointInTileId(id, pending); face = id; }
      const u = new URL(location.href); u.searchParams.delete('lat'); u.searchParams.delete('lon'); if (face) u.searchParams.set('tile', face);
      history.replaceState(null, '', u.search || location.pathname);   // never keep the point in the URL
    }
    this.faceId = face || (this.ids.includes(tileId) ? tileId : this.ids.includes(lastTile()) ? lastTile() : this.ids[0]);
    this.tileId = this.faceId;   // the chosen tile once one is chosen (main.js reads it), else the facing one
    // the view: yaw and pitch of the earth, the camera's distance, the sun, the earth's place on screen
    [this.yaw, this.pitch] = facingOf(this.byId[this.faceId].p0);
    this.yaw -= 0.6;             // the crescent shows a little east of the facing; the sign-in swings it round
    this.vyaw = 0; this.vpitch = 0; this.drag = null; this.hover = null;
    this.dist = DIST0; this.distTarget = DIST0;
    this.sun = [...SUN_CRESCENT];
    this.tweens = []; this.time = 0; this.last = performance.now();
    this.px = -1; this.py = -1; this.listKey = '';
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._size = new THREE.Vector2(); this._cc = new THREE.Color(); this._e = new THREE.Euler();
    this.render();
    this.buildScene();
    window.__weScreen = window.__weTitle = this;   // debugging handle
    // Keys typed on the screen stay on the screen (flight, peek, sound and the rest listen on window).
    this.guard = e => { if (!e.target?.closest?.('#opening, #social, #chat')) e.stopImmediatePropagation(); };   // the social list and the chat (lane 3) keep their own keys too
    for (const ev of ['keydown', 'keyup']) { addEventListener(ev, this.guard, true); root.addEventListener(ev, e => e.stopPropagation()); }
    this.onResize = () => { if (this.wrap.classList.contains('carded')) this.lineup.place(this.card); };
    addEventListener('resize', this.onResize);
    this.frameFn = now => this.frame(now);
    this.raf = requestAnimationFrame(this.frameFn);
    this.run().catch(e => { console.error('title screen:', e); this.showExplore(`error: ${e.message}`); });
  }

  $(sel) { return this.root.querySelector(sel); }
  get season() { return seasonOfDate(); }                   // the real season at the tile, by the calendar
  get point() { return this.points[this.tileId] || null; }
  get ready() { return !!this.sel && this.readyIds.has(this.sel); }

  // ---- the DOM ----------------------------------------------------------------------------------------------------
  render() {
    this.root.hidden = false; this.root.classList.add('we-title'); this.root.classList.remove('out');
    this.root.innerHTML = `
      <div class="tt-wrap phase-title">
        <div class="tt-title" aria-live="polite"><h1>Wild Earth</h1><p class="tt-load">loading…</p></div>
        <div class="tt-gate"><button class="tt-explore" type="button" hidden>Explore</button><p class="tt-gate-note" hidden></p></div>
        <div class="tt-dotname" hidden></div>
        <div class="tt-cardbox"><div class="op-tile tt-card" hidden>
          <span class="op-map"><img alt="" draggable="false"></span>
          <span class="op-cover" aria-live="polite"><span class="op-mid"><i class="op-wisp" aria-hidden="true"></i><button class="op-begin" type="button" tabindex="-1" disabled>Begin</button><span class="op-status"></span></span></span>
          <span class="op-name"><b class="op-title"></b><span class="op-sub"></span><span class="op-terr"></span></span>
        </div></div>
        <div class="op-lineup tt-lineup" aria-hidden="true"></div>
        <aside class="tt-places" aria-label="places"><div class="tt-rows" role="list"></div></aside>
        <div class="tt-fade" aria-hidden="true"></div>
        <i class="tt-spot" aria-hidden="true" hidden></i>
      </div>`;
    this.wrap = this.$('.tt-wrap'); this.card = this.$('.tt-card'); this.spot = this.$('.tt-spot');
    this.wrap.style.setProperty('--hl', seasonHighlight(this.season));   // the card's colour: the season's (opening.css)
    this.card.querySelector('.op-begin').onclick = () => this.begin();
    this.rarity = rarityByCode();
    this.lineup = new CardLineup({ box: this.$('.tt-lineup'), data: () => this.lineupData, gap: POP_CARD,
      colourOf: code => (code in this.rarity ? `#${rarityColor(this.rarity[code]).getHexString()}` : null) });
    requestAnimationFrame(() => this.$('.tt-title')?.classList.add('on'));   // fades in from black
    this.$('.tt-explore').onclick = () => this.onSignedIn(null);
    for (const p of this.places) {
      const el = document.createElement('div');
      el.className = 'tt-row'; el.dataset.tile = p.id; el.setAttribute('role', 'listitem'); el.tabIndex = 0;
      el.innerHTML = `<span class="tt-rname">${esc(p.name)}</span><span class="tt-rregion"></span><span class="tt-rcount">${countText(0)}</span>
        <span class="tt-rstate"><span class="tt-rstatus"></span></span>`;
      el.addEventListener('click', () => this.choose(p.id));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.choose(p.id); } });
      el.addEventListener('pointerenter', () => { this.hotRow = p.id; });
      el.addEventListener('pointerleave', () => { if (this.hotRow === p.id) this.hotRow = null; });
      p.el = el;
    }
    this.wirePointer();
  }

  // The drag spins the earth (inertia on release), a still click on a dot chooses it, the wheel zooms a little.
  wirePointer() {
    const w = this.wrap;
    w.addEventListener('pointerdown', e => {
      if (e.button || e.target.closest('button, .tt-places, .tt-gate, .tt-cardbox')) return;   // the gate and the card keep their own pointer
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
      w.setPointerCapture(e.pointerId); this.vyaw = this.vpitch = 0; this.tweens = this.tweens.filter(t => !t.view);
      e.preventDefault();
    });
    w.addEventListener('pointermove', e => {
      this.px = e.clientX; this.py = e.clientY;
      const d = this.drag; if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y, now = performance.now(), dt = Math.max(4, now - d.t) / 1000, R = this.earthPx();
      this.yaw += dx / R; this.pitch = clamp(this.pitch + dy / R, -PITCH_MAX, PITCH_MAX);
      this.vyaw = clamp(lerp(this.vyaw, dx / R / dt, 0.4), -FLING_MAX, FLING_MAX); this.vpitch = clamp(lerp(this.vpitch, dy / R / dt, 0.4), -FLING_MAX, FLING_MAX);
      d.x = e.clientX; d.y = e.clientY; d.t = now; d.moved += Math.hypot(dx, dy);
      if (d.moved > 4) w.classList.add('dragging');
    });
    const up = e => {
      const d = this.drag; if (!d || d.id !== e.pointerId) return;
      this.drag = null; w.classList.remove('dragging');
      if (d.moved <= 4) { this.vyaw = this.vpitch = 0; if (this.hover && this.phase === 'lit') this.choose(this.hover); }
      else if (performance.now() - d.t > 90) { this.vyaw = this.vpitch = 0; }   // held still before the release: no fling
    };
    w.addEventListener('pointerup', up); w.addEventListener('pointercancel', up);
    w.addEventListener('pointerleave', () => { this.px = this.py = -1; });
    w.addEventListener('wheel', e => {
      if (e.target.closest('.tt-places, .tt-gate, .tt-cardbox')) return;
      this.distTarget = clamp(this.distTarget * (1 + e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0012)), DIST[0], DIST[1]); e.preventDefault();
    }, { passive: false });
  }

  // ---- the scene ---------------------------------------------------------------------------------------------------
  buildScene() {
    const scene = this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.1, 200);
    this.cam.position.set(0, 0, DIST0);
    const sunDir = this.sunDir = sunVec(this.sun, new THREE.Vector3());
    const dpr = this.renderer.getPixelRatio();
    // the stars: a sphere of points round the camera, turning slowly
    const sg = new THREE.BufferGeometry(), sp = new Float32Array(STAR_N * 3), ss = new Float32Array(STAR_N), sph = new Float32Array(STAR_N);
    for (let i = 0; i < STAR_N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp[3 * i] = r * Math.cos(a) * STAR_R; sp[3 * i + 1] = u * STAR_R; sp[3 * i + 2] = r * Math.sin(a) * STAR_R;
      const m = Math.random(); ss[i] = m < 0.8 ? 0.45 + Math.random() * 0.5 : m < 0.97 ? 0.9 + Math.random() * 0.6 : 1.5 + Math.random() * 0.8; sph[i] = Math.random();
    }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aSize', new THREE.BufferAttribute(ss, 1)); sg.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1));
    this.starU = { uT: { value: 0 }, uDpr: { value: dpr }, uFade: { value: 0 } };
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: this.starU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.stars.rotation.z = 0.3; scene.add(this.stars);
    // the earth and its atmosphere
    const earth = this.earth = new THREE.Group(); earth.position.set(0, Y_BELOW, 0); scene.add(earth);
    this.earthU = { map: { value: null }, sunDir: { value: sunDir }, exposure: { value: 0.95 } };   // dim: the spirit world from space
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 80), new THREE.ShaderMaterial({ uniforms: this.earthU, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }));
    earth.add(this.globe);
    this.atmoU = { sunDir: { value: sunDir }, shell: { value: 1.035 } };
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 64), new THREE.ShaderMaterial({ uniforms: this.atmoU, vertexShader: EARTH_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    earth.add(this.atmo);
    // the dots, one per built tile
    const n = this.places.length, dg = new THREE.BufferGeometry(), dp = new Float32Array(n * 3);
    this.places.forEach((p, i) => { dp[3 * i] = p.p0.x * DOT_R; dp[3 * i + 1] = p.p0.y * DOT_R; dp[3 * i + 2] = p.p0.z * DOT_R; });
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dotSize = new THREE.BufferAttribute(new Float32Array(n), 1); this.dotGlow = new THREE.BufferAttribute(new Float32Array(n), 1); this.dotHot = new THREE.BufferAttribute(new Float32Array(n), 1);
    dg.setAttribute('aSize', this.dotSize); dg.setAttribute('aGlow', this.dotGlow); dg.setAttribute('aHot', this.dotHot);
    this.dotU = { uDpr: { value: dpr }, uFade: { value: 0 } };
    this.dots = new THREE.Points(dg, new THREE.ShaderMaterial({ uniforms: this.dotU, vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.dots.visible = false; earth.add(this.dots);
    this.setCounts({});
  }

  // ---- the loading, then the choreography --------------------------------------------------------------------------
  async run() {
    const t0 = performance.now(), load = this.$('.tt-load'), say = t => { if (load) load.textContent = t; };
    this.hub = this.hubParam === 'stub' ? new HubStub({ tiles: this.ids, home: this.faceId }) : this.hubParam && typeof this.hubParam === 'object' ? this.hubParam : new HubHttp();
    const hubP = (async () => {
      this.config = await this.hub.config().catch(() => null);
      this.user = this.config ? await this.hub.me().catch(() => null) : null;
    })();
    this.hub.on?.('counts', m => this.setCounts(m?.tiles || {}));
    const tex = new THREE.TextureLoader().loadAsync(`./assets/earth/bmng_${String(new Date().getMonth() + 1).padStart(2, '0')}.jpg`)
      .then(t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); this.tex = t; this.earthU.map.value = t; this.renderer.initTexture(t); })
      .catch(e => console.warn('title: the earth texture did not load', e));
    const names = this.loadNames(say);
    // the card's animals: the stills' index and each tile's species list (arrival.js CardLineup reads them)
    this.lineupData = Promise.all([getJSON('./assets/opening/index.json'), Promise.all(this.ids.map(id => getJSON(`../tiles/${id}/species/species.json`)))])
      .then(([index, lists]) => ({ index, lists: Object.fromEntries(this.ids.map((id, i) => [id, lists[i] || []])) }));
    say('loading the earth…');
    await Promise.race([Promise.all([hubP, tex, names]), wait(LOAD_MAX_MS)]);
    await wait(Math.max(0, TITLE_MIN_MS - (performance.now() - t0)));
    if (this.closed) return;
    // the title fades to black, the earth rises as a crescent
    this.setPhase('crescent');
    await this.tween(2800, u => { this.earth.position.y = lerp(Y_BELOW, Y_CRESCENT, u); }, easeOut, 500).p;
    if (this.closed) return;
    this.setPhase('gate');
    if (this.user) { await wait(400); if (!this.closed) this.onSignedIn(this.user); }   // the stub, or a session the hub already knows
    else if (this.onGate) this.onGate(this);                                              // lane 3's modal (account.js; it handles no hub too)
    else this.showExplore(this.config ? 'the sign-in is not built yet' : 'no hub here: explore alone');
  }
  // Every place's name and region line from its features.json: the tile's locality as the card's title (its roads
  // under it), else its roads, else its id; the Indigenous territories after.
  loadNames(say) {
    let n = 0;
    return Promise.all(this.places.map(async p => {
      const f = await getJSON(`../tiles/${p.id}/client/features.json`);
      const place = locality(f), roads = majorRoads(f).join(', '), terr = (f?.territories || []).map(t => t.name).join(' · ');
      p.name = place || roads || p.id; p.roads = place ? roads : ''; p.terr = terr;
      p.region = [place ? roads : '', terr].filter(Boolean).join(' · ');
      p.el.querySelector('.tt-rname').textContent = p.name; p.el.querySelector('.tt-rregion').textContent = p.region;
      p.el.setAttribute('aria-label', `${p.name} (${p.id})`);
      say(`loading the places… ${++n} / ${this.places.length}`);
    }));
  }
  setPhase(ph) {
    this.wrap.classList.remove(`phase-${this.phase}`); this.phase = ph; this.wrap.classList.add(`phase-${ph}`);
  }
  showExplore(note = '') {
    if (this.closed || this.phase === 'lit') return;
    const b = this.$('.tt-explore'), p = this.$('.tt-gate-note');
    b.hidden = false; requestAnimationFrame(() => b.classList.add('on'));
    if (note) { p.textContent = note; p.hidden = false; }
    b.focus({ preventScroll: true });
  }
  // Signed in (the hub's `you`, or null exploring alone): the earth rises the rest of the way, the sun swings round
  // to the facing side, the dots and the list come in. Lane 3's modal calls this.
  onSignedIn(user) {
    if (this.closed || this.phase === 'lit') return;
    this.user = user || null;
    this.setPhase('lit');
    this.hub.watch?.(true);
    const y0 = this.earth.position.y, x0 = this.earth.position.x, s0 = [...this.sun];
    this.rising = true;
    this.tween(2400, u => { this.earth.position.y = lerp(y0, Y_LIT, u); this.earth.position.x = lerp(x0, X_LIT, u); }, easeInOut, 100).p.then(() => { this.rising = false; });
    this.tween(3000, u => { this.sun[0] = lerp(s0[0], SUN_LIT[0], u); this.sun[1] = lerp(s0[1], SUN_LIT[1], u); }, easeInOut, 300);
    this.face(this.faceId, 2600, 200);
    this.dots.visible = true;
    this.tween(1400, u => { this.dotU.uFade.value = u; }, easeInOut, 1500);
    setTimeout(() => { if (!this.closed) this.wrap.classList.add('listed'); }, 1900);
    this.onLit?.(this.user);
  }
  // Ease the view to face a place (unless the player is dragging).
  face(id, ms = 900, delay = 0) {
    const p = this.byId[id]; if (!p || this.drag) return;
    const [yT, pT] = facingOf(p.p0), y0 = this.yaw, p0 = this.pitch, dy = wrapPi(yT - y0);
    this.vyaw = this.vpitch = 0; this.tweens = this.tweens.filter(t => !t.view);
    this.tween(ms, u => { this.yaw = y0 + dy * u; this.pitch = lerp(p0, pT, u); }, easeInOut, delay).view = true;
  }
  // A tween run by frame(): fn(eased 0..1) over ms after delay; .p resolves when done; .view marks one a drag cancels.
  tween(ms, fn, ease = easeInOut, delay = 0) {
    const t = { t: -delay, ms, fn, ease, done: null, view: false };
    t.p = new Promise(r => { t.done = r; });
    this.tweens.push(t);
    return t;
  }

  // ---- the hub's counts ---------------------------------------------------------------------------------------------
  // tiles: {tileId: n}. The dots grow and whiten with more players; the list re-sorts (in frame()).
  setCounts(tiles) {
    this.counts = tiles || {};
    this.places.forEach((p, i) => {
      p.count = Math.max(0, Math.round(+this.counts[p.id] || 0));
      this.dotSize.setX(i, 9 + 4 * Math.sqrt(p.count)); this.dotGlow.setX(i, Math.min(1, p.count / 6));
      const c = p.el.querySelector('.tt-rcount'); if (c.textContent !== countText(p.count)) c.textContent = countText(p.count);
    });
    this.dotSize.needsUpdate = true; this.dotGlow.needsUpdate = true;
    this.listKey = '';   // re-sort on the next frame
  }

  // ---- choosing a place and entering it -------------------------------------------------------------------------------
  // The one function group travel (lane 4) wraps: a dot or a row was chosen; the earth turns to it and main.js builds
  // its world behind the earth (abandoning any other). Choosing the chosen place again does nothing.
  choose(id) {
    if (this.phase !== 'lit' || this.begun || !this.byId[id] || id === this.sel) return;
    if (this.sel) this.byId[this.sel].el.classList.remove('sel', 'ready', 'loading');
    this.sel = id; this.tileId = id;
    this.face(id, 1000);
    this.distTarget = Math.min(this.distTarget, DIST_CARD);   // zoom to the place (the wheel may have zoomed closer already)
    this.showCard(id);
    this.renderRow(id);
    this.onSelect?.(id);
  }
  // The tile's card beside the list (the card screen's markup and styles, opening.css): its map, its title, the roads
  // and territories under it; the wisp and the build's status until the world is ready, then Begin. The tile's animals
  // gather round it (CardLineup), each arriving in its species' soul colour.
  showCard(id) {
    const p = this.byId[id], card = this.card;
    card.hidden = false; card.classList.add('sel');
    card.querySelector('.op-map img').src = `../tiles/${id}/client/imagery.png`;
    card.querySelector('.op-title').textContent = p.name; card.querySelector('.op-sub').textContent = p.roads || ''; card.querySelector('.op-terr').textContent = p.terr || '';
    this.wrap.classList.add('carded');
    this.lineup.show(id, card, { still: () => !this.closed && this.sel === id });
  }
  renderRow(id) {
    const p = this.byId[id], el = p?.el; if (!el) return;
    const isSel = id === this.sel, ready = this.readyIds.has(id);
    el.classList.toggle('sel', isSel); el.classList.toggle('ready', isSel && ready); el.classList.toggle('loading', isSel && !ready);
    el.setAttribute('aria-pressed', String(isSel));
    el.querySelector('.tt-rstatus').textContent = isSel && !ready ? (this.status[id] || 'loading…') : '';
    if (!isSel) return;
    const card = this.card;   // the card follows the chosen place's state: the wisp while loading, Begin when ready
    card.classList.toggle('ready', ready); card.classList.toggle('loading', !ready);
    card.querySelector('.op-status').textContent = ready ? '' : (this.status[id] || 'loading…');
    const b = card.querySelector('.op-begin'); b.disabled = !ready || this.begun; b.tabIndex = ready ? 0 : -1;
    if (ready && !this.begun) b.focus({ preventScroll: true });
  }
  // main.js reports "preparing <tileId>: <status>" while a world builds, and setReady when it is built.
  setPrep(a, b) {
    const [id, text] = b === undefined ? [this.tileId, a] : [a, b];
    if (!text || !id || this.readyIds.has(id)) return;
    this.status[id] = String(text).replace(/^preparing\s+\S+:\s*/, '');
    if (id === this.sel) this.renderRow(id);
  }
  setReady(id = this.tileId) {
    if (!id) return;
    this.readyIds.add(id);
    if (id === this.sel) this.renderRow(id);
  }
  // Begin: the earth zooms in closer to the dot (the card and the list fading), the earth fades to black while the dot
  // stays (the DOM spot takes the dot's place, so it is over the fade), then onBegin enters the world through main.js's
  // enterWorld: the world's first frame is never a cut from the earth, and the screen's own fade (.out) brings the spirit
  // world in as the black and the dot go.
  begin() {
    if (this.begun || !this.ready) return;
    this.begun = true;
    this.card.querySelector('.op-begin').disabled = true;
    const i = this.places.indexOf(this.byId[this.sel]);
    this.dotSize.setX(i, 0); this.dotSize.needsUpdate = true;   // the WebGL dot gives way to the spot
    this.spotOn = true; this.spot.hidden = false;
    this.face(this.sel, 1300);
    const d0 = this.dist;
    this.tween(1500, u => { this.dist = this.distTarget = lerp(d0, DIST_BEGIN, u); }, easeInOut);
    this.wrap.classList.add('zooming');
    setTimeout(() => { if (!this.closed) this.wrap.classList.add('leaving'); }, 700);
    this.hub.watch?.(false);
    setTimeout(() => {
      if (this.closed) return;
      this.onBegin({ tileId: this.sel, season: this.season, date: null, point: this.points[this.sel] || null });
    }, 1500);
  }
  // Where the earth's centre goes, in world units: left of the middle when nothing is chosen (X_LIT, Y_LIT); with a
  // card up, where the chosen place's dot (nearer the camera than the centre: DOT_R out from it, facing) sits in the
  // middle of the space left of the card, at the screen's mid height. Smoothed toward in frame(), except while Begin
  // zooms in, when it is set outright so the dot stays put as the distance changes.
  wanted(W, H, out) {
    if (!this.wrap.classList.contains('carded')) return out.set(X_LIT, Y_LIT, 0);
    const left = this.$('.tt-cardbox').getBoundingClientRect().left, K = H / 2 / Math.tan(CAM_FOV / 2 * DEG), d = this.dist - DOT_R;
    return out.set((left / 2 - W / 2) / K * d, 0, 0);
  }

  // ---- every frame --------------------------------------------------------------------------------------------------
  earthPx() {   // the earth's radius on screen, in CSS pixels
    const h = this.renderer.getSize(this._size).y || innerHeight;
    return Math.max(40, h / 2 / Math.tan(CAM_FOV / 2 * DEG) / (this.dist - this.earth.position.z));
  }
  frame(now) {
    if (this.closed) return;
    this.raf = requestAnimationFrame(this.frameFn);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.time += dt;
    for (const t of this.tweens.slice()) {
      t.t += dt * 1000; if (t.t < 0) continue;
      const u = Math.min(1, t.t / t.ms); t.fn(t.ease(u));
      if (u >= 1) { this.tweens.splice(this.tweens.indexOf(t), 1); t.done(); }
    }
    if (!this.drag) {
      if (this.phase === 'crescent' || this.phase === 'gate') this.yaw += dt * 0.02;   // a slow turn while the player signs in
      this.yaw += this.vyaw * dt; this.pitch = clamp(this.pitch + this.vpitch * dt, -PITCH_MAX, PITCH_MAX);
      const k = Math.exp(-dt * 2.4); this.vyaw *= k; this.vpitch *= k;
      if (Math.abs(this.vyaw) < 1e-3) this.vyaw = 0; if (Math.abs(this.vpitch) < 1e-3) this.vpitch = 0;
    }
    this.dist += (this.distTarget - this.dist) * (1 - Math.exp(-dt * 8));
    if (this.phase === 'lit' && !this.rising) {
      const r0 = this.renderer.getSize(this._size), w = this.wanted(r0.x || innerWidth, r0.y || innerHeight, this._v), e = this.earth.position;
      if (this.begun) e.set(w.x, w.y, 0); else { const k = 1 - Math.exp(-dt * 4); e.x += (w.x - e.x) * k; e.y += (w.y - e.y) * k; }
    }
    this.earth.quaternion.setFromEuler(this._e.set(this.pitch, this.yaw, 0, 'XYZ'));
    this.stars.rotation.y += dt * 0.004; this.stars.rotation.x += dt * 0.0007;
    this.starU.uT.value = this.time; this.starU.uFade.value = Math.min(1, this.starU.uFade.value + dt * 0.5);
    sunVec(this.sun, this.sunDir);
    // draw with the shared renderer, leaving it as it was
    const r = this.renderer, size = r.getSize(this._size), cam = this.cam;
    if (size.x && size.y && Math.abs(cam.aspect - size.x / size.y) > 1e-4) { cam.aspect = size.x / size.y; cam.updateProjectionMatrix(); }
    cam.position.set(0, 0, this.dist); cam.updateMatrixWorld();
    const ac = r.autoClear, ca = r.getClearAlpha(); r.getClearColor(this._cc);
    r.setRenderTarget(null); r.setScissorTest(false); r.setViewport(0, 0, size.x, size.y); r.autoClear = true; r.setClearColor(0x000000, 1);
    r.render(this.scene, cam);
    r.setClearColor(this._cc, ca); r.autoClear = ac;
    if (this.phase === 'lit') this.syncPlaces(size.x, size.y);
    if (this.spotOn) {   // the chosen dot as a DOM spot (begin): where the dot is, as big as the shader draws it
      const p = this.byId[this.sel], d = (9 + 4 * Math.sqrt(p.count)) * 3.5 / Math.max(0.5, this.dist - DOT_R) * 1.6;
      this.spot.style.setProperty('--d', `${d.toFixed(1)}px`); this.spot.style.transform = `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px)`;
    }
  }
  // The dots on screen (for the hover and its name) and the list of the places within 70 degrees of the facing point,
  // sorted by count then name, re-ordered only when the order changes (the rows glide to their new places).
  syncPlaces(W, H) {
    const q = this.earth.quaternion, c = this.earth.position, camPos = this.cam.position;
    const face = this._v.set(0, 0, 1).applyQuaternion(this._q.copy(q).invert());
    let hover = null, best = HOVER_PX * HOVER_PX;
    const wp = new THREE.Vector3();
    for (const p of this.places) {
      p.inView = p.p0.dot(face) >= VIEW_COS;
      wp.copy(p.p0).multiplyScalar(DOT_R).applyQuaternion(q).add(c);
      p.near = (wp.x - c.x) * (camPos.x - wp.x) + (wp.y - c.y) * (camPos.y - wp.y) + (wp.z - c.z) * (camPos.z - wp.z) > 0;   // on the side facing the camera
      wp.project(this.cam); p.sx = (wp.x + 1) / 2 * W; p.sy = (1 - wp.y) / 2 * H;
      if (p.near && this.px >= 0 && !this.drag) { const d = (p.sx - this.px) ** 2 + (p.sy - this.py) ** 2; if (d < best) { best = d; hover = p.id; } }
    }
    const hot = this.hotRow || hover;
    if (hot !== this.hot) {
      this.hot = hot;
      this.places.forEach((p, i) => this.dotHot.setX(i, p.id === hot ? 1 : 0)); this.dotHot.needsUpdate = true;
      for (const p of this.places) p.el.classList.toggle('hot', p.id === hot);
      this.wrap.classList.toggle('overdot', !!hover);
    }
    this.hover = hover;
    const label = this.$('.tt-dotname');
    if (hover) { const p = this.byId[hover]; label.hidden = false; label.textContent = p.name; label.style.transform = `translate(${p.sx.toFixed(0)}px, ${p.sy.toFixed(0)}px)`; }
    else label.hidden = true;
    const shown = this.places.filter(p => p.inView).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const key = shown.map(p => p.id).join(',');
    if (key === this.listKey || this.hotRow) return;   // never re-sorted under the pointer: a row stays where it is being clicked
    this.listKey = key;
    const rows = this.$('.tt-rows'), before = new Map([...rows.children].map(el => [el, el.getBoundingClientRect().top]));
    for (const el of [...rows.children]) if (!shown.some(p => p.el === el)) el.remove();
    for (const p of shown) { if (!before.has(p.el)) p.el.classList.add('in'); rows.append(p.el); }
    for (const [el, top] of before) {   // FLIP: from where it was to where it is
      if (!el.isConnected) continue;
      const dy = top - el.getBoundingClientRect().top; if (!dy) continue;
      el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)`; el.getBoundingClientRect(); el.style.transition = ''; el.style.transform = '';
    }
    requestAnimationFrame(() => { for (const p of shown) p.el.classList.remove('in'); });
  }

  // Fade out and remove; the GPU objects go; keys go back to the world.
  close() {
    if (this.closed) return;
    this.closed = true; this.ownsCanvas = false;
    cancelAnimationFrame(this.raf);
    for (const ev of ['keydown', 'keyup']) removeEventListener(ev, this.guard, true);
    removeEventListener('resize', this.onResize);
    document.activeElement?.blur?.();
    if (this.hubParam && typeof this.hubParam === 'object') this.hub.watch?.(false); else this.hub?.close?.();   // a hub given from outside (multiplayer.js) lives on into the world
    for (const o of [this.globe, this.atmo, this.dots, this.stars]) { o.geometry.dispose(); o.material.dispose(); }
    this.tex?.dispose(); this.earthU.map.value = null;
    this.scene.clear(); this.scene = null;
    if (window.__weTitle === this) delete window.__weTitle;
    if (window.__weScreen === this) delete window.__weScreen;
    this.root.classList.add('out');
    setTimeout(() => { this.root.hidden = true; this.root.innerHTML = ''; this.root.classList.remove('we-title'); }, 900);
  }
}
