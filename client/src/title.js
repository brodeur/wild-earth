import * as THREE from 'three';
import { lastTile, locality, majorRoads, seasonHighlight } from './arrival.js';
import { seasonOfDate } from './season.js';
import { pointInTileId } from './goto.js';
import { HubStub } from './hubStub.js';
import { MapGlobe, TileOutline, latLonToXYZ, xyzToLatLon } from './mapGlobe.js';
import { Relief } from './relief.js';
import { Geocoder, MIN_CHARS } from './geocode.js';
import { avatarFor } from './social.js';
export { latLonToXYZ };

// The home screen: the title, the earth as a map, the places, and going there together (docs/multiplayer.md lanes 1
// and 3; redesigned 2026-11-04, docs/decisions.md "the home screen redesigned").
//
// TitleScreen fills #opening in place of the card screen (arrival.js OpeningScreen, kept for ?cards=1) and answers the
// same calls from main.js: onSelect(tileId) asks for a world, setPrep(tileId, text), setProgress(tileId, step) and
// setReady(tileId) report its build, readyIds remembers the built ones, point and onPoint are the arrival's, onBegin(choice)
// enters, close() takes the screen down.
//
// What happens: WILD EARTH over the stars while the page loads what the screen needs; then the earth rises as a
// crescent and the sign-in (account.js, through onGate; Explore when there is no hub) stands on the right, where the
// social panel will be. Signed in, the earth rises the rest of the way, the sun swings round, the map comes up over the
// earth (mapGlobe.js: OpenStreetMap's map from OpenFreeMap's vector tiles, draped on the globe, a globe from space and a
// map at a few kilometres), a dot marks each built tile, and the places are listed on the left with a search box at the
// top: first every place, the most active first ("Most Active (global)"); once the player drags or zooms the earth, the
// places in view, the most active first ("Most Active (visible)"). The search finds a built place by name at once and
// anywhere on earth through Photon (geocode.js); a place found outside the built tiles is flown to and pinned.
//
// The view: the camera looks at a point on the earth (the earth turned so the point faces it: yaw and pitch, the pitch
// the point's latitude) from `alt` earth radii away; from space straight down, tilting toward the horizon and widening
// its lens as it comes down (tiltFor, fovFor), the point kept in the middle of the space between the list and the social
// panel (the camera's view offset). A drag moves the map under the pointer, with inertia; the wheel zooms toward the
// pointer.
//
// Choosing a place (a row, a label on the map or a dot) flies to it: 10,000 ft above the ground south of the tile looking
// north across it, the tile's square outlined on the ground, a card above it (the place's name, its players' avatars and
// how many, which opens the list of them). The tile starts building at once (main.js, onSelect) and the bar at the bottom
// shows how far; Invite (above the bar) asks groups or friends along (multiplayer.js, onInvite), and Start, once built,
// goes in: the camera sinks toward the place while the screen fades to black, then onBegin enters the world through
// main.js's enterWorld. Each player starts on their own; one who joined an invite arrives behind and above the one who
// asked (multiplayer.js and arrival.js). choose(id) is the one function group travel wraps.
//
// The earth is drawn with the page's shared renderer: while the screen is up (ownsCanvas) main.js's world loop skips its
// visible draws, so the earth and a building world never fight over the one canvas. Everything the screen made on the
// GPU is let go in close().
//
// Privacy: the only ids sent anywhere are tile ids; a count per tile is all the hub sends about strangers; the search
// words go to the geocoder alone, and the map's tiles are asked of OpenFreeMap as any web map asks; nothing is stored.

const DEG = Math.PI / 180, R_KM = 6371;
const FOV_FAR = 38, FOV_NEAR = 55, TILT_MAX = 54 * DEG;    // the lens and the tilt from space, and at a few kilometres
const TILT_ALT = [0.03, 0.0009];                           // the altitudes (earth radii) between which they change
const ALT0 = 2.5, ALT_MIN = 0.6 / R_KM, ALT_MAX = 3.6;      // the camera's distance from the point it looks at
const CHOSEN_H_KM = 3.05;                                  // a chosen place is seen from 10,000 ft
const Y_BELOW = -2.7, Y_CRESCENT = -1.12;                  // where the earth's centre sits before it is lit: off screen, the crescent
const SUN_CRESCENT = [152 * DEG, 26 * DEG], SUN_LIT = [30 * DEG, 14 * DEG];   // [azimuth about Y from the camera's side, elevation]
const PITCH_MAX = 85 * DEG;
const STAR_N = 1500, STAR_R = 40;
const TITLE_MIN_MS = 2200, LOAD_MAX_MS = 12000;            // the title is seen at least this long; the loading waits at most this long
const DOT_LIFT = 0.004;                                    // the dots stand off the surface from space, on it up close
const HOVER_PX = 16;
const FLING_MAX = 3;                                       // rad/s: the fastest a released drag keeps the earth turning
const LIST_MAX = 60, LABEL_MAX = 24;
const AVATARS_MAX = 6;
// The build's steps (main.js buildSteps, w.next) with rough weights of their time, for the bar: a step's start is its share
const STEPS = [['atmosphere', 1], ['weather', 1], ['terrain', 10], ['sky', 1], ['vegetation', 12], ['impostors', 10], ['grass', 6], ['water', 4], ['rocks', 2],
  ['roads+flight', 1], ['shadows', 2], ['crownPlan', 8], ['impostors.crowns', 6], ['veg.update', 3], ['hud', 1], ['places', 1], ['arrival', 1], ['texture', 6],
  ['season', 6], ['applySeason', 1], ['acorns', 1], ['identify', 1], ['animals', 6], ['controls', 2], ['rocks.warm', 3], ['warm', 4], ['compile', 10],
  ['textures', 6], ['compile.wait', 4], ['upload', 3]];
const STEP_AT = (() => { const tot = STEPS.reduce((s, [, w]) => s + w, 0); let a = 0; const m = {}; for (const [n, w] of STEPS) { m[n] = [a / tot, (a + w) / tot]; a += w; } return m; })();

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const getJSON = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = u => 1 - (1 - u) ** 3;
const easeInOut = u => u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
const wait = ms => new Promise(r => setTimeout(r, ms));
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const countText = n => n > 0 ? `${n} here` : 'no one here';
const sunVec = ([az, el], out) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
// The yaw (about Y) and pitch (about X, applied after) that bring a sphere point to face the camera on +Z.
const facingOf = p => [Math.atan2(-p.x, p.z), Math.asin(clamp(p.y, -1, 1))];
const lonOfYaw = yaw => ((((90 - yaw / DEG) - 180) % 360) + 540) % 360 - 180;
const yawOfLon = lon => (90 - (lon + 180)) * DEG;
// Up close the camera tilts toward the horizon and the lens widens (0 from space, 1 at a few kilometres).
const nearness = alt => smooth(Math.log(TILT_ALT[0]), Math.log(TILT_ALT[1]), Math.log(alt));
const tiltFor = alt => TILT_MAX * nearness(alt);
const fovFor = alt => lerp(FOV_FAR, FOV_NEAR, nearness(alt));
// How much of the map is over the earth's own picture: some from space (the spirit earth shows through), all of it near.
const mapMixFor = alt => lerp(0.5, 1, smooth(1.4, 0.06, alt));

// The hub over HTTP alone (no socket): config and me. A 404 or a network error from config is "no hub".
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
// dimmer overall, so the bright dots at the built tiles stand out; the night side a faint blue (no city lights: the earth
// with no humans); a thin haze-coloured rim inside the limb, stronger where the sun reaches. The map is drawn over it.
const EARTH_FRAG = /* glsl */`
  uniform sampler2D map; uniform vec3 sunDir; uniform float exposure;
  varying vec3 vN; varying vec2 vUv; varying vec3 vW;
  const vec3 SUN_TINT = vec3(0.4, 0.66, 1.0), AMB = vec3(0.3, 0.82, 0.95), HAZE = vec3(0.5, 0.85, 0.9);
  void main() {
    vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
    float ndl = dot(n, sunDir);
    float day = smoothstep(-0.05, 0.28, ndl);
    vec3 c = texture2D(map, vUv).rgb;
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
    vec3 col = albedo * (0.02 * AMB + exposure * day * (0.45 * AMB + 0.55 * SUN_TINT * max(ndl, 0.0)));
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.5);
    col += HAZE * rim * (0.06 + 0.9 * smoothstep(-0.15, 0.35, ndl)) * 0.55;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
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
// players, the hovered one larger still; none past the horizon (the earth's depth is the map's, which stops at the
// Mercator limit, so the test is the dot's own), lifted off the ground from space and on it up close.
const DOT_VERT = /* glsl */`
  attribute float aSize; attribute float aGlow; attribute float aHot;
  uniform float uDpr; uniform float uLift; uniform vec3 uCenter;
  varying float vG; varying float vH;
  void main() {
    vec4 w = modelMatrix * vec4(position * (1.0 + uLift), 1.0);
    vG = aGlow; vH = aHot;
    if (dot(normalize(w.xyz - uCenter), cameraPosition - w.xyz) < 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vec4 mv = viewMatrix * w;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (aSize + aHot * 5.0) * uDpr * min(1.6, 3.5 / max(0.5, -mv.z));
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

const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>';
const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

// The Layers menu's choices, kept per viewer: town names off by default (the world has no towns), waters and peaks on.
const LAYERS_KEY = 'wild-earth:map-layers';
function loadLayers() {
  const d = { places: false, nature: true };
  try { const v = JSON.parse(localStorage.getItem(LAYERS_KEY) || 'null'); if (v && typeof v === 'object') return { places: !!v.places, nature: v.nature !== false }; } catch {}
  return d;
}
function saveLayers(v) { try { localStorage.setItem(LAYERS_KEY, JSON.stringify(v)); } catch {} }

export class TitleScreen {
  // root: #opening; renderer: the page's; index: tiles/index.json; tileId: a hint for the facing tile (?tile=), else
  // the last tile played, else the first; pending: a { lat, lon } to arrive over (its tile faces, if built); hub:
  // 'stub' for hubStub.js, an object with config/me/watch/on/close for a real one (hub.js), else the server is asked
  // over HTTP; onSelect(tileId) and onBegin(choice) as the card screen's.
  constructor({ root, renderer, index, tileId = null, pending = null, hub = null, onSelect = null, onBegin }) {
    this.root = root; this.renderer = renderer; this.index = index; this.onSelect = onSelect; this.onBegin = onBegin;
    this.ids = index.tiles.map(t => t.tile_id);
    this.readyIds = new Set(); this.status = {}; this.progress = {}; this.points = {}; this.counts = {};
    this.sel = null; this.begun = false; this.closed = false; this.phase = 'title';
    this.ownsCanvas = true;      // main.js: the world's loop leaves the canvas to the screen while this is true
    this.onPoint = null;         // main.js sets it: a search inside the chosen tile moves the arrival there
    this.onGate = null;          // multiplayer.js: called with the screen when the sign-in's place is reached; it calls onSignedIn
    this.onLit = null;           // multiplayer.js: called with the user (null exploring alone) once onSignedIn has lit the earth
    this.onInvite = null;        // multiplayer.js: (tileId, button) opens the invite picker; unset, Invite says to sign in
    this.peopleAt = null;        // multiplayer.js: tileId -> [{ id, name, state }] the players known to be there or coming
    this.user = null; this.config = null;
    this.hubParam = hub;
    this.layers = loadLayers();   // the Layers menu: which names the map draws (per viewer, localStorage)
    this.mode = 'global';        // the list: every place ('global') or the places in view ('visible')
    this.query = ''; this.found = null; this.pin = null;
    this.places = index.tiles.map(t => {
      const b = t.bounds_wgs84 || [0, 0, 0, 0], lat = (b[1] + b[3]) / 2, lon = (b[0] + b[2]) / 2;
      return { id: t.tile_id, lat, lon, bounds: b, p0: latLonToXYZ(lat, lon), name: t.tile_id, region: '', count: 0, el: null, label: null, outline: null, sx: 0, sy: 0, near: false, onScreen: false };
    });
    this.byId = Object.fromEntries(this.places.map(p => [p.id, p]));
    let face = null;
    if (pending) {
      const id = this.ids.find(t => pointInTileId(t, pending));
      if (id) { this.points[id] = pointInTileId(id, pending); face = id; }
      const u = new URL(location.href); u.searchParams.delete('lat'); u.searchParams.delete('lon'); if (face) u.searchParams.set('tile', face);
      history.replaceState(null, '', u.search || location.pathname);   // never keep the point in the URL
    }
    this.faceId = face || (this.ids.includes(tileId) ? tileId : this.ids.includes(lastTile()) ? lastTile() : this.ids[0]);
    this.tileId = this.faceId;   // the chosen tile once one is chosen (main.js reads it), else the facing one
    [this.yaw, this.pitch] = facingOf(this.byId[this.faceId].p0);
    this.yaw -= 0.6;             // the crescent shows a little east of the facing; the sign-in swings it round
    this.vyaw = 0; this.vpitch = 0; this.drag = null; this.hover = null; this.anchor = null;
    this.alt = ALT0; this.altGoal = ALT0; this.flying = null;
    this.sun = [...SUN_CRESCENT]; this.mapFade = 0; this.offX = 0;
    this.tweens = []; this.time = 0; this.last = performance.now();
    this.px = -1; this.py = -1; this.listKey = '';
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._size = new THREE.Vector2(); this._cc = new THREE.Color(); this._e = new THREE.Euler();
    this._ray = new THREE.Raycaster(); this._ndc = new THREE.Vector2(); this._sph = new THREE.Sphere(new THREE.Vector3(), 1); this._m = new THREE.Matrix4();
    this.geo = new Geocoder();
    this.render();
    this.buildScene();
    window.__weScreen = window.__weTitle = this;   // debugging handle
    // Keys typed on the screen stay on the screen (flight, peek, sound and the rest listen on window).
    this.guard = e => { if (!e.target?.closest?.('#opening, #social, #chat, #invite, #invitePick')) e.stopImmediatePropagation(); };
    for (const ev of ['keydown', 'keyup']) { addEventListener(ev, this.guard, true); root.addEventListener(ev, e => e.stopPropagation()); }
    this.frameFn = now => this.frame(now);
    this.raf = requestAnimationFrame(this.frameFn);
    this.run().catch(e => { console.error('title screen:', e); this.showExplore(`error: ${e.message}`); });
  }

  $(sel) { return this.root.querySelector(sel); }
  get season() { return seasonOfDate(); }                   // the real season at the tile, by the calendar
  get point() { return this.points[this.tileId] || null; }
  get ready() { return !!this.sel && this.readyIds.has(this.sel); }
  get lat() { return this.pitch / DEG; }
  get lon() { return lonOfYaw(this.yaw); }

  // ---- the DOM ----------------------------------------------------------------------------------------------------
  render() {
    this.root.hidden = false; this.root.classList.add('we-title'); this.root.classList.remove('out');
    this.root.innerHTML = `
      <div class="tt-wrap phase-title">
        <div class="tt-title" aria-live="polite"><h1>Wild Earth</h1><p class="tt-load">loading…</p></div>
        <div class="tt-gate"><button class="tt-explore" type="button" hidden>Explore</button><p class="tt-gate-note" hidden></p></div>
        <div class="tt-labels" aria-hidden="true"></div>
        <div class="tt-dotname" hidden></div>
        <div class="tt-pin" hidden>${PIN_ICON}<span></span></div>
        <aside class="tt-places" aria-label="places">
          <label class="tt-search">${SEARCH_ICON}<input type="search" placeholder="Search any place on earth" autocomplete="off" spellcheck="false" maxlength="120" aria-label="search any place on earth"><button type="button" class="tt-sclear" aria-label="clear the search" hidden>×</button></label>
          <div class="tt-head"><h2 class="tt-mode"></h2><button type="button" class="tt-modebtn"></button></div>
          <div class="tt-rows" role="list"></div>
          <div class="tt-found" role="list" hidden></div>
          <p class="tt-empty" hidden></p>
        </aside>
        <div class="tt-pcard" role="group" aria-label="the place chosen" hidden>
          <b class="pc-name"></b><span class="pc-region"></span>
          <button type="button" class="pc-people" aria-expanded="false"><span class="pc-avs"></span><span class="pc-n"></span></button>
          <div class="pc-list" role="list" hidden></div>
        </div>
        <div class="tt-bar" aria-live="polite">
          <div class="tt-acts"><button type="button" class="tt-invite">Invite</button><button type="button" class="tt-start" disabled>Start</button></div>
          <div class="tt-bline"><span class="tt-bstatus"></span><span class="tt-bpct"></span></div>
          <div class="tt-progress" role="progressbar" aria-label="loading the place" aria-valuemin="0" aria-valuemax="100"><i></i></div>
        </div>
        <p class="tt-attrib">Map <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · search <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a></p>
        <div class="tt-layers"><button type="button" class="tt-layersbtn" aria-expanded="false">Layers</button>
          <div class="tt-layerlist" hidden>
            <label><input type="checkbox" data-layer="places"> Town and city names</label>
            <label><input type="checkbox" data-layer="nature"> Water and peak names</label>
          </div></div>
        <div class="tt-fade" aria-hidden="true"></div>
      </div>`;
    this.wrap = this.$('.tt-wrap'); this.card = this.$('.tt-pcard'); this.bar = this.$('.tt-bar'); this.list = this.$('.tt-places');
    this.wrap.style.setProperty('--hl', seasonHighlight(this.season));
    requestAnimationFrame(() => this.$('.tt-title')?.classList.add('on'));   // fades in from black
    this.$('.tt-explore').onclick = () => this.onSignedIn(null);
    {   // the Layers menu (Aaron, 2026-11-04: "we can remove place names from the globe, or its a toggle under a Layers menu")
      const btn = this.$('.tt-layersbtn'), list = this.$('.tt-layerlist');
      btn.onclick = () => { list.hidden = !list.hidden; btn.setAttribute('aria-expanded', String(!list.hidden)); };
      for (const box of list.querySelectorAll('input')) {
        box.checked = !!this.layers[box.dataset.layer];
        box.onchange = () => { this.layers[box.dataset.layer] = box.checked; saveLayers(this.layers); this.map?.restyle(this.layers); };
      }
    }
    this.$('.tt-start').onclick = () => this.begin();
    this.$('.tt-invite').onclick = e => { if (this.sel && this.onInvite) this.onInvite(this.sel, e.currentTarget); };
    this.$('.tt-modebtn').onclick = () => this.setMode(this.mode === 'global' ? 'visible' : 'global');
    const people = this.$('.pc-people');
    people.onclick = () => { const l = this.$('.pc-list'), on = l.hidden; l.hidden = !on; people.setAttribute('aria-expanded', String(on)); };
    for (const p of this.places) {
      const el = document.createElement('div');
      el.className = 'tt-row'; el.dataset.tile = p.id; el.setAttribute('role', 'listitem'); el.tabIndex = 0;
      el.innerHTML = `<span class="tt-rname">${esc(p.name)}</span><span class="tt-rregion"></span><span class="tt-rcount">${countText(0)}</span>`;
      el.addEventListener('click', () => this.choose(p.id));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.choose(p.id); } });
      el.addEventListener('pointerenter', () => { this.hotRow = p.id; });
      el.addEventListener('pointerleave', () => { if (this.hotRow === p.id) this.hotRow = null; });
      p.el = el;
      const lb = document.createElement('button');
      lb.type = 'button'; lb.className = 'tt-label'; lb.tabIndex = -1; lb.textContent = p.name;
      lb.addEventListener('click', () => this.choose(p.id));
      lb.addEventListener('pointerenter', () => { this.hotRow = p.id; });
      lb.addEventListener('pointerleave', () => { if (this.hotRow === p.id) this.hotRow = null; });
      p.label = lb; this.$('.tt-labels').append(lb);
    }
    this.wireSearch();
    this.wirePointer();
    this.setMode('global');
    this.renderBar();
  }

  // The search box: the built places matching the words at once; places anywhere on earth from the geocoder after a
  // pause (geocode.js). Enter asks at once and takes the first; Escape clears.
  wireSearch() {
    const input = this.$('.tt-search input'), clear = this.$('.tt-sclear');
    const update = now => {
      const q = this.query = input.value.trim();
      clear.hidden = !input.value;
      if (!q) { this.found = null; this.renderFound(); return; }
      this.found = { q, places: this.matchPlaces(q), earth: null, busy: q.length >= MIN_CHARS, err: false };
      this.renderFound();
      this.geo.ask(q, res => { if (this.found?.q !== q) return; this.found.earth = res || []; this.found.err = !res; this.found.busy = false; this.renderFound(); }, now);
    };
    input.addEventListener('input', () => update(false));
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { input.value = ''; update(false); input.blur(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const first = this.$('.tt-found .tt-frow');
        if (first && !this.found?.busy) first.click(); else update(true);
      } else if (e.key === 'ArrowDown') { e.preventDefault(); this.$('.tt-found .tt-frow')?.focus(); }
    });
    clear.onclick = () => { input.value = ''; update(false); input.focus(); };
  }
  matchPlaces(q) {
    const f = q.toLowerCase();
    return this.places.filter(p => `${p.name} ${p.region} ${p.id}`.toLowerCase().includes(f)).slice(0, 6);
  }
  renderFound() {
    const box = this.$('.tt-found'), rows = this.$('.tt-rows'), f = this.found;
    box.hidden = !f; rows.hidden = !!f; this.$('.tt-head').hidden = !!f;
    this.$('.tt-empty').hidden = true;
    if (!f) { this.listKey = ''; return; }
    box.innerHTML = '';
    const head = t => { const h = document.createElement('h3'); h.className = 'tt-fhead'; h.textContent = t; box.append(h); };
    const row = (name, sub, on, cls = '') => {
      const el = document.createElement('div'); el.className = `tt-frow ${cls}`; el.tabIndex = 0; el.setAttribute('role', 'listitem');
      el.innerHTML = `<span class="tt-rname">${esc(name)}</span>${sub ? `<span class="tt-rregion">${esc(sub)}</span>` : ''}`;
      el.onclick = on;
      el.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); on(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); el.nextElementSibling?.matches('.tt-frow') ? el.nextElementSibling.focus() : el.nextElementSibling?.nextElementSibling?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); const p = el.previousElementSibling; (p?.matches('.tt-frow') ? p : p?.previousElementSibling)?.focus?.() ?? this.$('.tt-search input').focus(); }
      };
      box.append(el);
    };
    if (f.places.length) { head('Wild places'); for (const p of f.places) row(p.name, `${p.region ? `${p.region} · ` : ''}${countText(p.count)}`, () => this.pickFound(null, p.id), 'wild'); }
    head('Anywhere on earth');
    if (f.busy) { const p = document.createElement('p'); p.className = 'tt-fnote'; p.textContent = 'searching…'; box.append(p); }
    else if (f.err) { const p = document.createElement('p'); p.className = 'tt-fnote'; p.textContent = 'the search is not answering; try again'; box.append(p); }
    else if (f.earth && !f.earth.length) { const p = document.createElement('p'); p.className = 'tt-fnote'; p.textContent = 'nothing found'; box.append(p); }
    else if (!f.earth) { const p = document.createElement('p'); p.className = 'tt-fnote'; p.textContent = `type ${MIN_CHARS} letters or more`; box.append(p); }
    for (const r of f.earth || []) row(r.name, [r.context, r.kind && r.kind !== 'yes' ? r.kind.replace(/_/g, ' ') : ''].filter(Boolean).join(' · '), () => this.pickFound(r));
  }
  // A search result: a built place is chosen as a row would be (and a point found inside one becomes the arrival's);
  // anywhere else the earth flies there and a pin marks it, and the list shows the places in view.
  pickFound(r, placeId = null) {
    const input = this.$('.tt-search input');
    const id = placeId || this.ids.find(t => pointInTileId(t, r));
    this.found = null; this.renderFound(); input.blur();
    if (r) input.value = r.name;
    this.$('.tt-sclear').hidden = !input.value;
    if (id) {
      if (r) { this.points[id] = pointInTileId(id, r); if (id === this.sel) this.onPoint?.(this.points[id]); }
      this.pin = null;
      if (id === this.sel) this.flyToPlace(id); else this.choose(id);
      return;
    }
    this.pin = { lat: r.lat, lon: r.lon, name: r.name, p: latLonToXYZ(r.lat, r.lon) };
    this.$('.tt-pin span').textContent = r.name;
    let alt = { country: 0.9, state: 0.25, region: 0.25, county: 0.04, city: 0.012, town: 0.006, village: 0.003, hamlet: 0.0016 }[r.kind] || 0.0025;
    if (r.extent) { const [w, s, e, n] = r.extent, span = Math.max((e - w) * Math.cos(r.lat * DEG), n - s) * DEG; alt = clamp(span * 1.4, 0.0012, 1.2); }
    this.flyTo(r.lat, r.lon, alt);
    this.setMode('visible');
  }

  // The drag moves the map (inertia on release), a still click on a dot chooses it, the wheel zooms toward the pointer.
  wirePointer() {
    const w = this.wrap;
    w.addEventListener('pointerdown', e => {
      if (e.button || e.target.closest('button, input, a, .tt-places, .tt-gate, .tt-pcard, .tt-bar')) return;
      if (this.phase !== 'lit' || this.begun) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
      w.setPointerCapture(e.pointerId); this.vyaw = this.vpitch = 0; this.stopFlight(); this.anchor = null;
      e.preventDefault();
    });
    w.addEventListener('pointermove', e => {
      this.px = e.clientX; this.py = e.clientY;
      const d = this.drag; if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y, now = performance.now(), dt = Math.max(4, now - d.t) / 1000;
      const [ky, kp] = this.dragRates();
      this.yaw += dx * ky; this.pitch = clamp(this.pitch + dy * kp, -PITCH_MAX, PITCH_MAX);
      this.vyaw = clamp(lerp(this.vyaw, dx * ky / dt, 0.4), -FLING_MAX, FLING_MAX); this.vpitch = clamp(lerp(this.vpitch, dy * kp / dt, 0.4), -FLING_MAX, FLING_MAX);
      d.x = e.clientX; d.y = e.clientY; d.t = now; d.moved += Math.hypot(dx, dy);
      if (d.moved > 4) { w.classList.add('dragging'); this.setMode('visible'); }
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
      if (e.target.closest('.tt-places, .tt-gate, .tt-pcard, .tt-bar')) return;
      e.preventDefault();
      if (this.phase !== 'lit' || this.begun) return;
      this.stopFlight();
      const k = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
      this.altGoal = clamp(this.altGoal * k, ALT_MIN, ALT_MAX);
      const hit = this.pick(e.clientX, e.clientY);   // the point under the pointer stays under it while the zoom eases
      this.anchor = hit ? { x: e.clientX, y: e.clientY, p: hit.clone(), until: performance.now() + 700 } : null;
      this.setMode('visible');
    }, { passive: false });
  }
  // Radians of yaw and pitch per pixel of drag: the ground under the pointer follows it; from space, a turn of the globe.
  dragRates() {
    const H = this.renderer.getSize(this._size).y || innerHeight, K = H / 2 / Math.tan(this.cam.fov / 2 * DEG);
    const k = Math.min(this.alt, 1.2) / K * (this.alt > 1 ? 1.25 : 1), cosLat = Math.max(0.15, Math.cos(this.pitch));
    const near = smooth(0.5, 0.05, this.alt);   // a map's pan near the ground (longitude by the latitude), a globe's turn from space
    return [k / lerp(1, cosLat, near), k / Math.max(0.35, Math.cos(this.tilt || 0))];
  }
  // The point of the earth (in the earth's own frame, the unit sphere) under a screen point, or null.
  pick(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect(); if (!r.width) return null;
    this._ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.cam);
    this.earth.updateMatrixWorld();
    const inv = this._m.copy(this.earth.matrixWorld).invert();
    const ray = this._ray.ray.applyMatrix4(inv);
    return ray.intersectSphere(this._sph, this._w) ? this._w : null;
  }

  // ---- the scene ---------------------------------------------------------------------------------------------------
  buildScene() {
    const scene = this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(FOV_FAR, 16 / 9, 0.01, 80);
    const sunDir = this.sunDir = sunVec(this.sun, new THREE.Vector3());
    const dpr = this.renderer.getPixelRatio();
    const sg = new THREE.BufferGeometry(), sp = new Float32Array(STAR_N * 3), ss = new Float32Array(STAR_N), sph = new Float32Array(STAR_N);
    for (let i = 0; i < STAR_N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp[3 * i] = r * Math.cos(a) * STAR_R; sp[3 * i + 1] = u * STAR_R; sp[3 * i + 2] = r * Math.sin(a) * STAR_R;
      const m = Math.random(); ss[i] = m < 0.8 ? 0.45 + Math.random() * 0.5 : m < 0.97 ? 0.9 + Math.random() * 0.6 : 1.5 + Math.random() * 0.8; sph[i] = Math.random();
    }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aSize', new THREE.BufferAttribute(ss, 1)); sg.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1));
    this.starU = { uT: { value: 0 }, uDpr: { value: dpr }, uFade: { value: 0 } };
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: this.starU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.stars.rotation.z = 0.3; this.stars.renderOrder = -1; scene.add(this.stars);
    const earth = this.earth = new THREE.Group(); earth.position.set(0, Y_BELOW, 0); scene.add(earth);
    this.earthU = { map: { value: null }, sunDir: { value: sunDir }, exposure: { value: 0.95 } };
    // a little inside the unit sphere, so the map's tiles (on it) always cover it where they are drawn
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(0.996, 128, 80), new THREE.ShaderMaterial({ uniforms: this.earthU, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }));
    earth.add(this.globe);
    this.atmoU = { sunDir: { value: sunDir }, shell: { value: 1.035 } };
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 64), new THREE.ShaderMaterial({ uniforms: this.atmoU, vertexShader: EARTH_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.atmo.renderOrder = 2; earth.add(this.atmo);
    this.map = new MapGlobe({ group: earth, renderer: this.renderer, sunDir });
    this.map.restyle(this.layers);
    this.relief = new Relief(earth, sunDir);   // the chosen place as an exaggerated relief model (relief.js)
    const n = this.places.length, dg = new THREE.BufferGeometry(), dp = new Float32Array(n * 3);
    this.places.forEach((p, i) => { dp[3 * i] = p.p0.x; dp[3 * i + 1] = p.p0.y; dp[3 * i + 2] = p.p0.z; });
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dotSize = new THREE.BufferAttribute(new Float32Array(n), 1); this.dotGlow = new THREE.BufferAttribute(new Float32Array(n), 1); this.dotHot = new THREE.BufferAttribute(new Float32Array(n), 1);
    dg.setAttribute('aSize', this.dotSize); dg.setAttribute('aGlow', this.dotGlow); dg.setAttribute('aHot', this.dotHot);
    this.dotU = { uDpr: { value: dpr }, uFade: { value: 0 }, uLift: { value: DOT_LIFT }, uCenter: { value: earth.position } };
    this.dots = new THREE.Points(dg, new THREE.ShaderMaterial({ uniforms: this.dotU, vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.dots.visible = false; this.dots.renderOrder = 4; this.dots.frustumCulled = false; earth.add(this.dots);
    for (const p of this.places) { p.outline = new TileOutline(p.bounds); p.outline.mesh.visible = false; earth.add(p.outline.mesh); }
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
    say('loading the earth…');
    await Promise.race([Promise.all([hubP, tex, names]), wait(LOAD_MAX_MS)]);
    await wait(Math.max(0, TITLE_MIN_MS - (performance.now() - t0)));
    if (this.closed) return;
    this.setPhase('crescent');
    await this.tween(2800, u => { this.earth.position.y = lerp(Y_BELOW, Y_CRESCENT, u); }, easeOut, 500).p;
    if (this.closed) return;
    this.setPhase('gate');
    if (this.user) { await wait(400); if (!this.closed) this.onSignedIn(this.user); }   // the stub, or a session the hub already knows
    else if (this.onGate) this.onGate(this);                                              // the modal (account.js; it handles no hub too)
    else this.showExplore(this.config ? 'the sign-in is not built yet' : 'no hub here: explore alone');
  }
  // Every place's name and region line from its features.json: the tile's locality, else its roads, else its id; the
  // Indigenous territories after.
  loadNames(say) {
    let n = 0;
    return Promise.all(this.places.map(async p => {
      const f = await getJSON(`../tiles/${p.id}/client/features.json`);
      const place = locality(f), roads = majorRoads(f).join(', '), terr = (f?.territories || []).map(t => t.name).join(' · ');
      p.name = place || roads || p.id; p.roads = place ? roads : ''; p.terr = terr;
      p.region = [place ? roads : '', terr].filter(Boolean).join(' · ');
      p.el.querySelector('.tt-rname').textContent = p.name; p.el.querySelector('.tt-rregion').textContent = p.region;
      p.el.setAttribute('aria-label', `${p.name} (${p.id})`); p.label.textContent = p.name;
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
  // Signed in (the hub's `you`, or null exploring alone): the earth rises to the middle, the sun swings round to the
  // facing side, the map, the dots and the list come in.
  onSignedIn(user) {
    if (this.closed || this.phase === 'lit') return;
    this.user = user || null;
    this.setPhase('lit');
    this.hub.watch?.(true);
    const y0 = this.earth.position.y, s0 = [...this.sun];
    this.rising = true;
    this.tween(2400, u => { this.earth.position.y = lerp(y0, 0, u); }, easeInOut, 100).p.then(() => { this.rising = false; });
    this.tween(3000, u => { this.sun[0] = lerp(s0[0], SUN_LIT[0], u); this.sun[1] = lerp(s0[1], SUN_LIT[1], u); }, easeInOut, 300);
    this.tween(2600, u => { this.mapFade = u; }, easeInOut, 1200);
    this.face(this.faceId, 2600, 200);
    this.dots.visible = true;
    this.tween(1400, u => { this.dotU.uFade.value = u; }, easeInOut, 1500);
    setTimeout(() => { if (!this.closed) this.wrap.classList.add('listed'); }, 1900);
    this.onLit?.(this.user);
    this.renderBar();
  }
  // Ease the view to face a place, not moving the camera's height (unless the player is dragging).
  face(id, ms = 900, delay = 0) {
    const p = this.byId[id]; if (!p || this.drag) return;
    const [yT, pT] = facingOf(p.p0), y0 = this.yaw, p0 = this.pitch, dy = wrapPi(yT - y0);
    this.vyaw = this.vpitch = 0; this.stopFlight();
    this.flying = this.tween(ms, u => { this.yaw = y0 + dy * u; this.pitch = lerp(p0, pT, u); }, easeInOut, delay);
    this.flying.view = true;
  }
  // Fly to look at lat, lon from alt earth radii away: over the earth in an arc whose height grows with the distance
  // flown, the camera tilting and the lens widening as it comes down (tiltFor, fovFor).
  flyTo(lat, lon, alt, ms = null) {
    this.vyaw = this.vpitch = 0; this.stopFlight(); this.anchor = null;
    const y0 = this.yaw, p0 = this.pitch, a0 = this.alt, dy = wrapPi(yawOfLon(lon) - y0), pT = clamp(lat * DEG, -PITCH_MAX, PITCH_MAX);
    const ang = Math.acos(clamp(latLonToXYZ(lat, lon).dot(latLonToXYZ(p0 / DEG, lonOfYaw(y0))), -1, 1));
    const peak = Math.max(a0, alt, Math.min(2.4, ang * 1.1)), la0 = Math.log(a0), la1 = Math.log(alt), bump = Math.log(peak) - Math.max(la0, la1);
    ms ??= clamp(1400 + 900 * Math.sqrt(ang) + 250 * Math.abs(la1 - la0), 1400, 4200);
    this.altGoal = alt;
    const t = this.flying = this.tween(ms, u => {
      const e = easeInOut(u);
      this.yaw = y0 + dy * e; this.pitch = lerp(p0, pT, e);
      this.alt = this.altGoal = Math.exp(lerp(la0, la1, easeInOut(u)) + Math.max(0, bump) * 4 * u * (1 - u));
    }, u => u);
    t.view = true;
    return t.p;
  }
  stopFlight() {
    if (!this.flying) return;
    const t = this.flying; this.flying = null;
    const i = this.tweens.indexOf(t); if (i >= 0) { this.tweens.splice(i, 1); t.done(); }
  }
  // The pose that shows a place: 10,000 ft over the ground south of the tile, looking north across it at the full tilt,
  // the tile's south edge just above the bar at the bottom of the view, its north edge high in the view under the card.
  chosenPose(id) {
    const p = this.byId[id], [w, s, e] = p.bounds, h = CHOSEN_H_KM / R_KM;
    const A = h / Math.cos(TILT_MAX), ahead = A * Math.sin(TILT_MAX), below = h * Math.tan(TILT_MAX - FOV_NEAR / 2 * DEG + 6 * DEG);   // the south edge clear of the bar
    return { lat: s + (ahead - below) / DEG, lon: (w + e) / 2, alt: A };
  }
  flyToPlace(id) {
    const c = this.chosenPose(id);
    this.card.classList.remove('on');
    return this.flyTo(c.lat, c.lon, c.alt).then(() => { if (this.sel === id && !this.closed) this.card.classList.add('on'); });
  }
  // A tween run by frame(): fn(eased 0..1) over ms after delay; .p resolves when done (or stopped); .view marks one a drag cancels.
  tween(ms, fn, ease = easeInOut, delay = 0) {
    const t = { t: -delay, ms, fn, ease, done: null, view: false };
    t.p = new Promise(r => { t.done = r; });
    this.tweens.push(t);
    return t;
  }

  // ---- the list ------------------------------------------------------------------------------------------------------
  // 'global': every place, the most active first; 'visible': the places in view, the most active first.
  setMode(m) {
    if (this.mode === m && this.$('.tt-mode').textContent) return;
    this.mode = m; this.listKey = '';
    this.$('.tt-mode').innerHTML = `Most Active <span>(${m === 'global' ? 'global' : 'visible'})</span>`;
    this.$('.tt-modebtn').textContent = m === 'global' ? 'in view' : 'show all';
    this.$('.tt-modebtn').title = m === 'global' ? 'list the places in view' : 'list every place';
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
    if (this.sel) this.renderPeople();
  }

  // ---- choosing a place and entering it -------------------------------------------------------------------------------
  // The one function group travel wraps: a dot, a label or a row was chosen; the earth flies to it, its card comes up and
  // main.js builds its world behind the earth (abandoning any other). Choosing the chosen place again flies back to it.
  choose(id) {
    if (this.phase !== 'lit' || this.begun || !this.byId[id]) return;
    if (id === this.sel) { this.flyToPlace(id); return; }
    const prev = this.sel;
    if (prev) { this.byId[prev].el.classList.remove('sel'); this.byId[prev].label.classList.remove('sel'); }
    this.sel = id; this.tileId = id; this.pin = null;
    this.byId[id].el.classList.add('sel'); this.byId[id].label.classList.add('sel');
    this.progress[id] = this.readyIds.has(id) ? 1 : (this.progress[id] || 0); this.shown = this.progress[id];
    this.renderCard(); this.renderBar();
    this.wrap.classList.add('chosen');
    this.flyToPlace(id);
    this.relief?.show(id);
    this.onSelect?.(id);
  }
  // The card over the place: its name, its region line, the avatars of its players and how many, which opens the list.
  renderCard() {
    const p = this.byId[this.sel]; if (!p) { this.card.hidden = true; return; }
    this.card.hidden = false;
    this.card.querySelector('.pc-name').textContent = p.name;
    this.card.querySelector('.pc-region').textContent = p.region || '';
    this.$('.pc-list').hidden = true; this.$('.pc-people').setAttribute('aria-expanded', 'false');
    this.renderPeople();
  }
  // Called by multiplayer.js when who is there or coming changes. Known players (friends and group members the hub
  // says are in the tile, and the people invited) are named; the others the hub counts are anonymous wisps: a stranger's
  // name and whereabouts are never sent to anyone outside the tile's room.
  refreshPeople() { if (this.sel) this.renderPeople(); }
  renderPeople() {
    const id = this.sel, p = this.byId[id]; if (!p || this.closed) return;   // the hub's events go on after the screen has closed
    const known = (this.peopleAt?.(id) || []).filter(k => k && k.id);
    const hereKnown = known.filter(k => k.state === 'here').length, coming = known.filter(k => k.state === 'coming').length;
    const others = Math.max(0, p.count - hereKnown);
    const avs = this.$('.pc-avs'); avs.innerHTML = '';
    const shown = [...known.filter(k => k.state !== 'declined'), ...Array.from({ length: others }, (_, i) => ({ id: `${id}#${i}`, anon: true }))];
    for (const k of shown.slice(0, AVATARS_MAX)) { const a = avatarFor(k.id, 26); a.classList.toggle('anon', !!k.anon); a.dataset.state = k.state || 'here'; avs.append(a); }
    if (shown.length > AVATARS_MAX) { const m = document.createElement('span'); m.className = 'pc-more'; m.textContent = `+${shown.length - AVATARS_MAX}`; avs.append(m); }
    const n = p.count + coming;
    this.$('.pc-n').textContent = n ? `${p.count ? countText(p.count) : ''}${p.count && coming ? ' · ' : ''}${coming ? `${coming} on the way` : ''}` : 'no one here yet';
    this.$('.pc-people').disabled = !shown.length && !known.length;
    const list = this.$('.pc-list'); list.innerHTML = '';
    const STATE = { here: 'here', coming: 'on the way', asked: 'asked', declined: 'not now', invited: 'invited you' };
    for (const k of known) {
      const r = document.createElement('div'); r.className = `pc-row ${k.state || ''}`; r.setAttribute('role', 'listitem');
      r.append(avatarFor(k.id, 22));
      const t = document.createElement('span'); t.className = 'pc-who'; t.innerHTML = `<b>${esc(k.name || 'someone')}</b><small>${esc(STATE[k.state] || k.state || '')}</small>`;
      r.append(t); list.append(r);
    }
    if (others) { const r = document.createElement('p'); r.className = 'pc-others'; r.textContent = `${others} ${others === 1 ? 'other player' : 'other players'} wandering here`; list.append(r); }
    if (!known.length && !others) { const r = document.createElement('p'); r.className = 'pc-others'; r.textContent = 'no one here yet: invite someone along'; list.append(r); }
  }
  // The bar: the build's progress for the chosen place, Invite, and Start once it is built.
  renderBar() {
    const id = this.sel, ready = !!id && this.readyIds.has(id);
    this.bar.classList.toggle('on', !!id && this.phase === 'lit'); this.bar.classList.toggle('ready', ready);
    const start = this.$('.tt-start'), inv = this.$('.tt-invite');
    start.disabled = !ready || this.begun;
    inv.disabled = !id || this.begun || !this.onInvite;
    inv.title = this.onInvite ? 'invite a group or friends to this place' : 'sign in to invite friends';
    this.$('.tt-bstatus').textContent = !id ? '' : ready ? `${this.byId[id].name} is ready` : (this.status[id] || 'loading…');
    if (ready && !this.begun && document.activeElement?.closest?.('.tt-places, .tt-search') == null) start.focus({ preventScroll: true });
  }
  // main.js reports "preparing <tileId>: <status>" while a world builds, each step's name (setProgress), and setReady.
  setPrep(a, b) {
    const [id, text] = b === undefined ? [this.tileId, a] : [a, b];
    if (!text || !id || this.readyIds.has(id)) return;
    this.status[id] = String(text).replace(/^preparing\s+\S+:\s*/, '');
    if (/^error/.test(this.status[id])) this.progress[id] = 0;
    if (id === this.sel) this.renderBar();
  }
  setProgress(id, step) {
    const at = STEP_AT[step]; if (!id || !at || this.readyIds.has(id)) return;
    this.progress[id] = Math.max(at[0], this.progress[id] || 0); this.stepEnd = at[1]; this.stepAt = performance.now();
  }
  setReady(id = this.tileId) {
    if (!id) return;
    this.readyIds.add(id); this.progress[id] = 1;
    if (id === this.sel) this.renderBar();
  }
  // Start: the camera sinks toward the place while the screen fades to black; then onBegin enters the world through
  // main.js's enterWorld, whose own fade (.out) brings the spirit world in from the black.
  begin() {
    if (this.begun || !this.ready) return;
    this.begun = true;
    this.renderBar();
    this.hub.watch?.(false);
    const p = this.byId[this.sel], pt = this.points[this.sel];
    let lat = p.lat, lon = p.lon;
    if (pt) { const [w, s, e, n] = p.bounds; lon = w + (e - w) * pt.x / 10000; lat = s + (n - s) * pt.north / 10000; }
    this.flyTo(lat, lon, Math.max(ALT_MIN, this.alt * 0.25), 1500);
    this.wrap.classList.add('zooming');
    setTimeout(() => { if (!this.closed) this.wrap.classList.add('leaving'); }, 600);
    setTimeout(() => {
      if (this.closed) return;
      this.onBegin({ tileId: this.sel, season: this.season, date: null, point: this.points[this.sel] || null });
    }, 1500);
  }

  // ---- every frame --------------------------------------------------------------------------------------------------
  // The space the earth's point of interest is centred in: between the list (left) and the social panel (right).
  freeArea(W) {
    let left = 0, right = W;
    if (this.wrap.classList.contains('listed')) { const r = this.list.getBoundingClientRect(); if (r.width) left = r.right; }
    const soc = document.getElementById('social'), panel = soc?.querySelector('.so-panel');
    const rr = (panel && !panel.hidden && panel.getBoundingClientRect().width ? panel : this.$('.tt-gate'))?.getBoundingClientRect();
    if (rr?.width && rr.left > W / 2 && (this.phase === 'lit' || this.phase === 'gate')) right = rr.left;
    return [left, right];
  }
  frame(now) {
    if (this.closed) return;
    this.raf = requestAnimationFrame(this.frameFn);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.time += dt;
    for (const t of this.tweens.slice()) {
      t.t += dt * 1000; if (t.t < 0) continue;
      const u = Math.min(1, t.t / t.ms); t.fn(t.ease(u));
      if (u >= 1) { const i = this.tweens.indexOf(t); if (i >= 0) this.tweens.splice(i, 1); if (this.flying === t) this.flying = null; t.done(); }
    }
    if (!this.drag) {
      if (this.phase === 'crescent' || this.phase === 'gate') this.yaw += dt * 0.02;   // a slow turn while the player signs in
      this.yaw += this.vyaw * dt; this.pitch = clamp(this.pitch + this.vpitch * dt, -PITCH_MAX, PITCH_MAX);
      const k = Math.exp(-dt * 2.4); this.vyaw *= k; this.vpitch *= k;
      if (Math.abs(this.vyaw) < 1e-4) this.vyaw = 0; if (Math.abs(this.vpitch) < 1e-4) this.vpitch = 0;
    }
    if (!this.flying) this.alt = Math.exp(lerp(Math.log(this.alt), Math.log(this.altGoal), 1 - Math.exp(-dt * 7)));
    const r = this.renderer, size = r.getSize(this._size), W = size.x || innerWidth, H = size.y || innerHeight, cam = this.cam;
    this.tilt = tiltFor(this.alt);
    const fov = fovFor(this.alt);
    if (Math.abs(cam.fov - fov) > 1e-3 || Math.abs(cam.aspect - W / H) > 1e-4) { cam.fov = fov; cam.aspect = W / H; }
    // the camera: alt from the looked-at point (on +Z of the earth's centre), tilted toward the north's horizon
    const e = this.earth.position, A = this.alt, t = this.tilt;
    this.earth.quaternion.setFromEuler(this._e.set(this.pitch, this.yaw, 0, 'XYZ'));
    cam.position.set(0, -A * Math.sin(t), 1 + A * Math.cos(t));   // the earth's own offset (below, before it is lit) is not followed
    cam.up.set(0, 1, 0); cam.lookAt(0, 0, 1);
    cam.near = Math.max(2e-5, A * Math.cos(t) * 0.3); cam.far = 70;
    const [fl, fr] = this.freeArea(W), off = (fl + fr) / 2 - W / 2;
    this.offX += (off - this.offX) * (1 - Math.exp(-dt * 6));
    if (Math.abs(this.offX) > 0.5) cam.setViewOffset(W, H, -this.offX, 0, W, H); else cam.clearViewOffset();
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // the wheel's zoom keeps the point under the pointer under it (the looked-at point moved by its offset, each frame)
    if (this.anchor && !this.drag) {
      if (now > this.anchor.until) this.anchor = null;
      else {
        const hit = this.pick(this.anchor.x, this.anchor.y);
        if (hit) {
          const a = xyzToLatLon(this.anchor.p), h = xyzToLatLon(hit);
          this.pitch = clamp(this.pitch + (a.lat - h.lat) * DEG, -PITCH_MAX, PITCH_MAX);
          this.yaw -= wrapPi((a.lon - h.lon) * DEG);
          this.earth.quaternion.setFromEuler(this._e.set(this.pitch, this.yaw, 0, 'XYZ'));
        }
      }
    }
    this.stars.rotation.y += dt * 0.004; this.stars.rotation.x += dt * 0.0007;
    this.stars.position.copy(cam.position);
    this.starU.uT.value = this.time; this.starU.uFade.value = Math.min(1, this.starU.uFade.value + dt * 0.5);
    sunVec(this.sun, this.sunDir);
    // the map over the earth, the dots on it, the chosen tile's outline (and the others' up close)
    this.map.mix = mapMixFor(A) * this.mapFade;
    this.map.root.visible = this.map.mix > 0.01;
    if (this.map.root.visible) this.map.update(cam, H);
    this.relief?.update(dt);
    this.dotU.uLift.value = Math.min(DOT_LIFT, A * 0.01);
    const close = smooth(0.0016, 0.006, A);   // the dots give way to the outlines on the ground
    this.dotU.uFade.value = this.phase === 'lit' ? Math.min(1, this.dotU.uFade.value + dt) * (0.15 + 0.85 * close) : this.dotU.uFade.value;
    const K = H / 2 / Math.tan(cam.fov / 2 * DEG), cl = this._v.copy(cam.position).sub(e).applyQuaternion(this._q.copy(this.earth.quaternion).invert());
    for (const p of this.places) {
      const o = p.outline, isSel = p.id === this.sel, near = A < 0.03;
      o.mesh.visible = this.phase === 'lit' && (isSel || near) && p.p0.dot(cl) > 1;
      if (!o.mesh.visible) continue;
      o.uniforms.width.value = (isSel ? 2.2 : 1.1) / K;
      o.uniforms.lift.value = Math.min(0.001, A * 0.002);
      o.uniforms.opacity.value = isSel ? 0.95 : 0.45 * smooth(0.03, 0.01, A);
      o.uniforms.color.value.set(isSel ? 0xffe2b0 : 0xd3ddd5);
    }
    // draw with the shared renderer, leaving it as it was
    const ac = r.autoClear, ca = r.getClearAlpha(); r.getClearColor(this._cc);
    r.setRenderTarget(null); r.setScissorTest(false); r.setViewport(0, 0, size.x, size.y); r.autoClear = true; r.setClearColor(0x000000, 1);
    r.render(this.scene, cam);
    r.setClearColor(this._cc, ca); r.autoClear = ac;
    if (this.phase === 'lit') this.syncPlaces(W, H, dt);
  }
  // The dots on screen (the hover and its name), the labels of the places on the map, the pin of a search, the card over
  // the chosen place, the bar's progress, and the list: every place, or the places in view, the most active first,
  // re-ordered only when the order changes (the rows glide to their new places) and never under the pointer.
  syncPlaces(W, H, dt) {
    const q = this.earth.quaternion, c = this.earth.position, camPos = this.cam.position;
    let hover = null, best = HOVER_PX * HOVER_PX;
    const wp = this._w, lift = 1 + this.dotU.uLift.value;
    const project = (p0, s) => {
      wp.copy(p0).multiplyScalar(s).applyQuaternion(q).add(c);
      const near = (wp.x - c.x) * (camPos.x - wp.x) + (wp.y - c.y) * (camPos.y - wp.y) + (wp.z - c.z) * (camPos.z - wp.z) > 0;
      wp.project(this.cam);
      return [(wp.x + 1) / 2 * W, (1 - wp.y) / 2 * H, near && wp.z < 1];
    };
    for (const p of this.places) {
      [p.sx, p.sy, p.near] = project(p.p0, lift);
      p.onScreen = p.near && p.sx >= 0 && p.sx <= W && p.sy >= 0 && p.sy <= H;
      if (p.near && this.px >= 0 && !this.drag) { const d = (p.sx - this.px) ** 2 + (p.sy - this.py) ** 2; if (d < best) { best = d; hover = p.id; } }
    }
    const hot = this.hotRow || hover;
    if (hot !== this.hot) {
      this.hot = hot;
      this.places.forEach((p, i) => this.dotHot.setX(i, p.id === hot ? 1 : 0)); this.dotHot.needsUpdate = true;
      for (const p of this.places) { p.el.classList.toggle('hot', p.id === hot); p.label.classList.toggle('hot', p.id === hot); }
      this.wrap.classList.toggle('overdot', !!hover);
    }
    this.hover = hover;
    // the labels on the map: the chosen and the busiest first, none over another; none during Start's dive
    const boxes = [], order = this.places.filter(p => p.onScreen).sort((a, b) => (b.id === this.sel) - (a.id === this.sel) || b.count - a.count || a.name.localeCompare(b.name));
    const shown = new Set();
    if (!this.begun) for (const p of order) {
      if (shown.size >= LABEL_MAX) break;
      const w = p.label.offsetWidth || p.name.length * 7 + 16, h = 22, x0 = p.sx + 10, y0 = p.sy - h / 2;
      if (boxes.some(b => x0 < b[2] && x0 + w > b[0] && y0 < b[3] && y0 + h > b[1])) continue;
      boxes.push([x0 - 14, y0, x0 + w, y0 + h]); shown.add(p);
    }
    for (const p of this.places) {
      const on = shown.has(p); p.label.classList.toggle('on', on);
      if (on) p.label.style.transform = `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px)`;
    }
    const name = this.$('.tt-dotname');
    if (hover && !shown.has(this.byId[hover])) { const p = this.byId[hover]; name.hidden = false; name.textContent = p.name; name.style.transform = `translate(${p.sx.toFixed(0)}px, ${p.sy.toFixed(0)}px)`; }
    else name.hidden = true;
    // the pin of a place found anywhere
    const pin = this.$('.tt-pin');
    if (this.pin && !this.begun) { const [x, y, near] = project(this.pin.p, 1); pin.hidden = !near; pin.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; }
    else pin.hidden = true;
    // the card over the chosen place: above the middle of the tile's north edge, kept on screen
    if (this.sel) {
      const p = this.byId[this.sel], [w, , e, n] = p.bounds;
      const [x, y, near] = project(latLonToXYZ(n, (w + e) / 2), 1);
      const ch = this.card.offsetHeight || 90, cw = this.card.offsetWidth || 240, [fl, fr] = this.freeArea(W);
      const cx = clamp(x, fl + cw / 2 + 12, fr - cw / 2 - 12), cy = clamp(y - 14, ch + 16, H - 150);
      this.card.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) translate(-50%, -100%)`;
      this.card.classList.toggle('behind', !near);
      // the bar: toward the step's end while it runs (never past it), all of it when ready
      const goal = this.readyIds.has(this.sel) ? 1 : lerp(this.progress[this.sel] || 0, this.stepEnd ?? 0, 0.85 * (1 - Math.exp(-(performance.now() - (this.stepAt || 0)) / 6000)));
      this.shown = Math.max(this.shown || 0, Math.min(1, lerp(this.shown || 0, Math.max(goal, this.progress[this.sel] || 0), 1 - Math.exp(-dt * 5))));
      const pct = Math.round(this.shown * 100);
      this.$('.tt-progress i').style.transform = `scaleX(${this.shown.toFixed(4)})`;
      this.$('.tt-progress').setAttribute('aria-valuenow', String(pct));
      const t = this.readyIds.has(this.sel) ? '' : `${pct}%`; const b = this.$('.tt-bpct'); if (b.textContent !== t) b.textContent = t;
    }
    // the list
    if (this.found) return;
    let rows = this.mode === 'global' ? this.places.slice() : this.places.filter(p => p.onScreen);
    rows = rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, LIST_MAX);
    const key = `${this.mode}:${rows.map(p => p.id).join(',')}`;
    if (key === this.listKey || this.hotRow) return;   // never re-sorted under the pointer: a row stays where it is being clicked
    this.listKey = key;
    const empty = this.$('.tt-empty');
    empty.hidden = rows.length > 0; empty.textContent = 'No wild places in view. Zoom out, or search.';
    const box = this.$('.tt-rows'), before = new Map([...box.children].map(el => [el, el.getBoundingClientRect().top]));
    for (const el of [...box.children]) if (!rows.some(p => p.el === el)) el.remove();
    for (const p of rows) { if (!before.has(p.el)) p.el.classList.add('in'); box.append(p.el); }
    for (const [el, top] of before) {   // FLIP: from where it was to where it is
      if (!el.isConnected) continue;
      const dy = top - el.getBoundingClientRect().top; if (!dy) continue;
      el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)`; el.getBoundingClientRect(); el.style.transition = ''; el.style.transform = '';
    }
    requestAnimationFrame(() => { for (const p of rows) p.el.classList.remove('in'); });
  }

  // Fade out and remove; the GPU objects and the map's worker go; keys go back to the world.
  close() {
    if (this.closed) return;
    this.closed = true; this.ownsCanvas = false;
    cancelAnimationFrame(this.raf);
    this.geo.cancel();
    for (const ev of ['keydown', 'keyup']) removeEventListener(ev, this.guard, true);
    document.activeElement?.blur?.();
    if (this.hubParam && typeof this.hubParam === 'object') this.hub.watch?.(false); else this.hub?.close?.();   // a hub given from outside (multiplayer.js) lives on into the world
    this.map.dispose(); this.relief?.dispose();
    for (const p of this.places) p.outline.dispose();
    for (const o of [this.globe, this.atmo, this.dots, this.stars]) { o.geometry.dispose(); o.material.dispose(); }
    this.tex?.dispose(); this.earthU.map.value = null;
    this.scene.clear(); this.scene = null;
    if (window.__weTitle === this) delete window.__weTitle;
    if (window.__weScreen === this) delete window.__weScreen;
    this.root.classList.add('out');
    setTimeout(() => { this.root.hidden = true; this.root.innerHTML = ''; this.root.classList.remove('we-title'); }, 900);
  }
}
