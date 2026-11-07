import * as THREE from 'three';
import { lastTile, placeName, territoriesOf, seasonHighlight } from './arrival.js';
import { seasonOfDate } from './season.js';
import { pointInTileId } from './goto.js';
import { HubStub } from './hubStub.js';
import { MapGlobe, TileOutline, latLonToXYZ, xyzToLatLon } from './mapGlobe.js';
import { Relief } from './relief.js';
import { Geocoder, MIN_CHARS } from './geocode.js';
import { avatarFor } from './social.js';
import { BodyRing } from './bodyRing.js';
export { latLonToXYZ };

// The home screen: the title, the earth as a map, the places, and going there together (docs/multiplayer.md lanes 1
// and 3; redesigned 2026-11-04, docs/decisions.md "the home screen redesigned").
//
// TitleScreen fills #opening in place of the card screen (arrival.js OpeningScreen, kept for ?cards=1) and answers the
// same calls from main.js: onSelect(tileId) asks for a world, setPrep(tileId, text), setProgress(tileId, step) and
// setReady(tileId) report its build, readyIds remembers the built ones, point and onPoint are the arrival's, onBegin(choice)
// enters, close() takes the screen down.
//
// What happens: WILD EARTH over the stars while the page loads what the screen needs (the boot screen's green faded to
// black and the stars twinkled in first: firstDrawn); then the title and the earth move to their final places together
// (land: the title to the top, the earth from below to the middle of the space the side panels leave), and only then do
// the panels slide in, all at once: the sign-in (account.js, through onGate; Explore when there is no hub) on the right,
// where the social panel will be, the earth a crescent behind it; signed in (or a session already known), the places
// from the left and the social column from the right together (sideIn). Signed in, the sun swings round, the map comes up over the
// earth (mapGlobe.js: OpenStreetMap's map from OpenFreeMap's vector tiles, draped on the globe, a globe from space and a
// map at a few kilometres), a dot marks each built tile, and the places are listed on the left with a search box at the
// top: first every place, the most active first ("Most active", "everywhere"); once the player drags or zooms the earth,
// the places in view, the most active first ("in view"); each row names the friends there with their wisps (friendsAt),
// as the labels on the map do. The search finds a built place by name at once and
// anywhere on earth through Photon (geocode.js); a place found outside the built tiles is flown to and pinned.
//
// The view: the camera looks at a point on the earth (the earth turned so the point faces it: yaw and pitch, the pitch
// the point's latitude) from `alt` earth radii away; from space straight down, tilting toward the horizon and widening
// its lens as it comes down (tiltFor, fovFor), the point kept in the middle of the space between the list and the social
// panel (the camera's view offset). A drag moves the map under the pointer, with inertia; the wheel zooms toward the
// pointer.
//
// Choosing a place (a row, a label on the map or a dot) flies to it: 10,000 ft above the ground south of the tile looking
// north across it, the tile's square outlined on the ground and framed in the stage (stageArea: the free centre, under the
// title, above the bar), the place's title over the buttons (its name and players' pill, its territories, the body Start
// arrives in, its players' avatars, which open the list of them), and once it has landed its animals teleport in over the
// tile as two rings, walkers and fliers, the spirit in the middle and chosen (bodyRing.js; 2026-11-07): a click chooses a
// body, the group sees each member's choice, and choosing a member's animal goes in beside them (docs/multiplayer.md
// "Bodies"). The tile starts building at once (main.js, onSelect) and the bar at the bottom shows how far; Invite (above the bar) asks groups or friends along (multiplayer.js, onInvite), and Start, once built,
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
// Flying to a chosen place is slow (Aaron, 2026-11-06: "slow enough so that the world has a chance to render ... by the
// time they arrive at the tile, it's mostly loaded"): PLACE_SLOW times the free flight's time, within PLACE_MS; its last
// stretch is paced by the world's build (flyToPlace: the flight's clock runs slower as it gets ahead of the loading bar,
// down to PACE_MIN, so it eases into a hold a few times the final height above the tile and goes on as the build does).
const PLACE_SLOW = 1.8, PLACE_MS = [5000, 8000], PACE_FROM = 0.55, PACE_SLACK = 0.12, PACE_MIN = 0.04;
const FOCUS_MARGIN = [40, 16];                             // px around the stage inside the free centre (desktop, phone)
const UNCHOOSE_AT = [0.3, 0.14, 350];                       // a chosen tile's width over the free centre's: armed at or over [0], deselected under [1] held [2] ms
const STAGE_TOP = 0.07;                                    // of the stage's height kept clear above the tile: the back animals stand up past its far edge
const Y_BELOW = -2.7;                                      // where the earth's centre sits before it lands: off screen, below
const SUN_CRESCENT = [152 * DEG, 26 * DEG], SUN_LIT = [30 * DEG, 14 * DEG];   // [azimuth about Y from the camera's side, elevation]
const PITCH_MAX = 85 * DEG;
const STAR_N = 1500, STAR_R = 40;
const TITLE_MIN_MS = 2400, LOAD_MAX_MS = 12000;            // the title is seen at least this long; the loading waits at most this long
// The start (Aaron, 2026-11-06): the boot screen's green fades to black on the first frame drawn, the stars twinkle in
// one by one (the brightest first) over STARS_IN_S, the title fades in from TITLE_IN_S, and when the earth is ready the
// title and the earth move to their final places together (land: one eased motion of LAND_MS drives both; a cross-fade
// of REFADE_MS under reduced motion), and only then do the side panels slide in, all at once (Aaron, 2026-11-06: "The
// logo and the earth should smoothly animate to their final destinations - they should arrive at their final destinations
// at the same time, and when complete, the side panels should slide in from their respective sides simultaneously").
// The earth is centred in the space the panels will leave free from the start (freeArea), so it never moves for them.
const STARS_IN_S = 2.6, TITLE_IN_S = 0.7, LAND_MS = 2200, REFADE_MS = 1200, SIDE_AFTER_SIGNIN_MS = 450;
// The panels' items come in one by one (Aaron, 2026-11-06: "the elements should fade in up, staggered from top to bottom
// ... and the interval between fadeInUps should decrease"): ordered by their top on screen across both columns, items
// within STAGGER_SAME_PX of each other together; the gaps STAGGER_FIRST ms, then each STAGGER_DECAY of the one before,
// down to STAGGER_MIN; each item rises STAGGER_RISE px as it fades in over STAGGER_MS (only fades under reduced motion).
const STAGGER_FIRST = 120, STAGGER_DECAY = 0.8, STAGGER_MIN = 25, STAGGER_SAME_PX = 6, STAGGER_MS = 520, STAGGER_RISE = 10;
const STAGGER_EASE = 'cubic-bezier(.2, .8, .25, 1)';
const GUEST_TIP = 'Log in or sign up to start';
const GUEST_COUNTS_MS = 20000;   // a signed-out visitor's place counts, asked of the hub this often
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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
const easeInOut = u => u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
const wait = ms => new Promise(r => setTimeout(r, ms));
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const countText = n => n > 0 ? `${n} here` : 'no one here';
// A place's player count (Aaron, 2026-11-06: "a pill with a user icon and a number after the placename"); 0 shown dimmed.
const USER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>';
const pillHTML = n => `<span class="tt-pill${n ? '' : ' zero'}" title="${n} ${n === 1 ? 'player' : 'players'} here now" aria-label="${n} ${n === 1 ? 'player' : 'players'} here now">${USER_ICON}<b>${n}</b></span>`;
// The territories as links to Native Land's pages for them, " · " between (their map is not an official or legal boundary:
// the credits say so, config.SOURCES native_land).
const terrHTML = ts => (ts || []).map(t => t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>` : esc(t.name)).join(' · ');
const andList = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
const FACES_MAX = 4;                                       // friends' wisps on a row or a label before the names say the rest
const TITLE_PX = 15;                                       // the risen title's size (Aaron's design, 2026-11-06)
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
// with no humans). No atmosphere (Aaron, 2026-11-06: "The globe doesn't need an atmosphere"): no shell, no haze rim.
// fade takes it in from black under reduced motion (land). The map is drawn over it.
const EARTH_FRAG = /* glsl */`
  uniform sampler2D map; uniform vec3 sunDir; uniform float exposure; uniform float fade;
  varying vec3 vN; varying vec2 vUv; varying vec3 vW;
  const vec3 SUN_TINT = vec3(0.4, 0.66, 1.0), AMB = vec3(0.3, 0.82, 0.95);
  void main() {
    vec3 n = normalize(vN);
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
    vec3 col = albedo * (0.02 * AMB + exposure * day * (0.45 * AMB + 0.55 * SUN_TINT * max(ndl, 0.0))) * fade;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
// Each star comes in at its own aDelay (seconds after uIn starts counting): a quick rise with a glint that settles
// (uGlint 0 under reduced motion: a plain fade).
const STAR_VERT = /* glsl */`
  attribute float aSize; attribute float aPhase; attribute float aDelay;
  uniform float uT; uniform float uDpr; uniform float uIn; uniform float uGlint;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float s = uIn - aDelay;
    float glint = s > 0.0 ? uGlint * 1.6 * exp(-s * 3.5) : 0.0;
    float on = clamp(s / mix(0.6, 0.22, uGlint), 0.0, 1.0);
    vA = (0.7 + 0.3 * sin(uT * (1.2 + aPhase * 2.5) + aPhase * 40.0)) * (0.45 + 0.55 * min(aSize, 1.0)) * on * (1.0 + glint);
    gl_PointSize = max(1.5, aSize * 2.4 * uDpr * (1.0 + 0.5 * glint));
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
  constructor({ root, renderer, index, tileId = null, pending = null, hub = null, onSelect = null, onDeselect = null, onBegin }) {
    this.root = root; this.renderer = renderer; this.index = index; this.onSelect = onSelect; this.onDeselect = onDeselect; this.onBegin = onBegin;
    this.ids = index.tiles.map(t => t.tile_id);
    this.readyIds = new Set(); this.status = {}; this.progress = {}; this.points = {}; this.counts = {};
    this.sel = null; this.begun = false; this.closed = false; this.phase = 'title';
    this.ownsCanvas = true;      // main.js: the world's loop leaves the canvas to the screen while this is true
    this.onPoint = null;         // main.js sets it: a search inside the chosen tile moves the arrival there
    this.onGate = null;          // multiplayer.js: called with the screen when the sign-in's place is reached; it calls onSignedIn
    this.onLit = null;           // multiplayer.js: called with the user (null exploring alone) once onSignedIn has lit the earth
    this.onInvite = null;        // multiplayer.js: (tileId, button) opens the invite picker; unset, Invite says to sign in
    this.peopleAt = null;        // multiplayer.js: tileId -> [{ id, name, state }] the players known to be there or coming
    this.friendsAt = null;       // multiplayer.js: tileId -> [{ id, name }] the friends and group members sharing that they are there
    this.bodiesAt = null;        // multiplayer.js: tileId -> [{ user, name, code, here }] the group's bodies chosen (or in) there
    this.onBody = null;          // multiplayer.js: (tileId, code) the player chose a body there ('spirit' for none)
    this.body = 'spirit'; this.joinWith = null;   // the body Start arrives in (the rings, bodyRing.js), and the member it goes beside
    this.user = null; this.config = null;
    this.hubParam = hub;
    this.layers = loadLayers();   // the Layers menu: which names the map draws (per viewer, localStorage)
    this.mode = 'global';        // the list: every place ('global') or the places in view ('visible')
    this.query = ''; this.found = null; this.pin = null;
    this.places = index.tiles.map(t => {
      const b = t.bounds_wgs84 || [0, 0, 0, 0], lat = (b[1] + b[3]) / 2, lon = (b[0] + b[2]) / 2;
      const hw = Math.min((b[3] - b[1]) * DEG, (b[2] - b[0]) * DEG * Math.cos(lat * DEG)) / 2 || 7.8e-4;   // the tile's half-width in earth radii (the rings')
      return { id: t.tile_id, lat, lon, bounds: b, hw, p0: latLonToXYZ(lat, lon), name: t.tile_id, region: '', count: 0, el: null, label: null, outline: null, sx: 0, sy: 0, near: false, onScreen: false };
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
    this.sun = [...SUN_CRESCENT]; this.mapFade = 0; this.offX = null; this.landed = false; this.reserveRight = true;
    this.tweens = []; this.time = 0; this.last = this.bornMs = performance.now();
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
        <button type="button" class="tt-loginpill" aria-expanded="false" hidden>Log in or sign up</button>
        <div class="tt-labels" aria-hidden="true"></div>
        <div class="tt-ring"></div>
        <div class="tt-dotname" hidden></div>
        <div class="tt-pin" hidden>${PIN_ICON}<span></span></div>
        <aside class="tt-places" aria-label="places">
          <label class="tt-search">${SEARCH_ICON}<input type="search" placeholder="Search any place on earth" autocomplete="off" spellcheck="false" maxlength="120" aria-label="search any place on earth"><button type="button" class="tt-sclear" aria-label="clear the search" hidden>×</button></label>
          <button type="button" class="tt-listbtn" aria-expanded="false">All places</button>
          <div class="tt-head"><h2 class="tt-mode">Most active</h2><button type="button" class="tt-modebtn"></button></div>
          <div class="tt-rows" role="list"></div>
          <div class="tt-found" role="list" hidden></div>
          <p class="tt-empty" hidden></p>
        </aside>
        <div class="tt-bar" aria-live="polite">
          <div class="tt-pcard" role="group" aria-label="the place chosen" hidden>
            <div class="pc-top"><h2 class="pc-name"></h2><span class="pc-pill"></span></div><p class="pc-region"></p>
            <p class="pc-body"><span class="pc-as"></span><span class="pc-with"></span></p>
            <div class="pc-peoplewrap"><button type="button" class="pc-people" aria-expanded="false"><span class="pc-avs"></span><span class="pc-n"></span></button>
            <div class="pc-list" role="list" hidden></div></div>
          </div>
          <div class="tt-acts"><button type="button" class="tt-invite">Invite</button><span class="tt-startwrap"><button type="button" class="tt-start" disabled aria-describedby="ttStartTip">Start</button><span class="tt-tip" id="ttStartTip" role="tooltip" hidden>${GUEST_TIP}</span></span></div>
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
    this.$('.tt-explore').onclick = () => this.onSignedIn(null);
    {   // the Layers menu (Aaron, 2026-11-04: "we can remove place names from the globe, or its a toggle under a Layers menu")
      const btn = this.$('.tt-layersbtn'), list = this.$('.tt-layerlist');
      btn.onclick = () => { list.hidden = !list.hidden; btn.setAttribute('aria-expanded', String(!list.hidden)); };
      for (const box of list.querySelectorAll('input')) {
        box.checked = !!this.layers[box.dataset.layer];
        box.onchange = () => { this.layers[box.dataset.layer] = box.checked; saveLayers(this.layers); this.map?.restyle(this.layers); };
      }
    }
    {   // Start; signed out it is greyed (aria-disabled, so it still takes hover and focus for its tooltip) and a tap shows the tip
      const start = this.$('.tt-start'), tip = this.$('.tt-tip');
      start.onclick = () => { if (this.guest) this.showTip(); else this.begin(); };
      start.addEventListener('pointerdown', e => { if (this.guest && e.pointerType === 'touch') this.tipTouch = true; });
      this.showTip = () => { if (!this.tipTouch) return; this.tipTouch = false; tip.classList.add('tap'); clearTimeout(this.tipT); this.tipT = setTimeout(() => tip.classList.remove('tap'), 2600); };
    }
    {   // a phone's signed-out view: the sign-in folds behind a pill at the top right, so the places can be browsed
      const pill = this.$('.tt-loginpill');
      pill.onclick = () => { const on = !this.wrap.classList.contains('gate-open'); this.wrap.classList.toggle('gate-open', on); pill.setAttribute('aria-expanded', String(on)); if (on) this.$('.tt-gate input')?.focus({ preventScroll: true }); };
    }
    this.$('.tt-invite').onclick = e => { if (this.sel && this.onInvite) this.onInvite(this.sel, e.currentTarget); };
    this.$('.tt-modebtn').onclick = () => this.setMode(this.mode === 'global' ? 'visible' : 'global');
    // a phone's chosen place takes the width: the list folds behind this button (title.css), which opens it over the stage
    this.$('.tt-listbtn').onclick = e => { const on = !this.wrap.classList.contains('listopen'); this.wrap.classList.toggle('listopen', on); e.currentTarget.setAttribute('aria-expanded', String(on)); };
    const people = this.$('.pc-people');
    people.onclick = () => { const l = this.$('.pc-list'), on = l.hidden; l.hidden = !on; people.setAttribute('aria-expanded', String(on)); };
    for (const p of this.places) {
      const el = document.createElement('div');
      el.className = 'tt-row'; el.dataset.tile = p.id; el.setAttribute('role', 'listitem'); el.tabIndex = 0;
      el.innerHTML = `<span class="tt-rtop"><span class="tt-rname">${esc(p.name)}</span><span class="tt-rpill">${pillHTML(0)}</span></span><span class="tt-rterr"></span><span class="tt-rcount"><span class="tt-faces"></span><span class="tt-rwho"></span></span>`;
      el.querySelector('.tt-rterr').addEventListener('click', e => { if (e.target.closest('a')) e.stopPropagation(); });   // a territory's link opens Native Land, not the place
      el.querySelector('.tt-rterr').addEventListener('keydown', e => { if (e.target.closest('a')) e.stopPropagation(); });
      el.addEventListener('click', () => this.choose(p.id));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.choose(p.id); } });
      el.addEventListener('pointerenter', () => { this.hotRow = p.id; });
      el.addEventListener('pointerleave', () => { if (this.hotRow === p.id) this.hotRow = null; });
      p.el = el;
      const lb = document.createElement('button');
      lb.type = 'button'; lb.className = 'tt-label'; lb.tabIndex = -1; lb.innerHTML = `<span class="tt-lname">${esc(p.name)}</span><span class="tt-faces"></span>`;
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
    if (f.places.length) { head('Wild places'); for (const p of f.places) row(p.name, [p.region, countText(p.count)].filter(Boolean).join(' · '), () => this.pickFound(null, p.id), 'wild'); }
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
      if (this.phase !== 'lit' || this.begun || !this.landed) return;
      const body = this.sel && this.ring ? this.ring.hit(e.clientX, e.clientY) : null;   // an animal in the rings (or the spirit): chosen, no drag
      if (body) { e.preventDefault(); this.chooseBody(body, e.pointerType === 'touch'); return; }
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
      w.setPointerCapture(e.pointerId); this.vyaw = this.vpitch = 0; this.stopFlight(); this.anchor = null;
      e.preventDefault();
    });
    w.addEventListener('pointermove', e => {
      this.px = e.clientX; this.py = e.clientY;
      if (!this.drag && this.ring && e.pointerType !== 'touch') {
        const over = this.sel && !this.begun && !e.target.closest('button, input, a, .tt-places, .tt-gate, .tt-bar') ? this.ring.hit(e.clientX, e.clientY) : null;
        this.ring.hover(over); this.wrap.classList.toggle('overbody', !!over);
      }
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
    w.addEventListener('pointerleave', () => { this.px = this.py = -1; this.ring?.hover(null); this.wrap.classList.remove('overbody'); });
    w.addEventListener('wheel', e => {
      if (e.target.closest('.tt-places, .tt-gate, .tt-pcard, .tt-bar')) return;
      e.preventDefault();
      if (this.phase !== 'lit' || this.begun || !this.landed) return;
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
    const sg = new THREE.BufferGeometry(), sp = new Float32Array(STAR_N * 3), ss = new Float32Array(STAR_N), sph = new Float32Array(STAR_N), sd = new Float32Array(STAR_N);
    for (let i = 0; i < STAR_N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp[3 * i] = r * Math.cos(a) * STAR_R; sp[3 * i + 1] = u * STAR_R; sp[3 * i + 2] = r * Math.sin(a) * STAR_R;
      const m = Math.random(); ss[i] = m < 0.8 ? 0.45 + Math.random() * 0.5 : m < 0.97 ? 0.9 + Math.random() * 0.6 : 1.5 + Math.random() * 0.8; sph[i] = Math.random();
      // the brightest first, as at dusk, each with some scatter, all in by STARS_IN_S after the first frame
      sd[i] = 0.3 + (1 - Math.min(1, (ss[i] - 0.45) / 1.6)) * (STARS_IN_S - 1.1) * 0.75 + Math.random() * (STARS_IN_S - 1.1) * 0.35;
    }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aSize', new THREE.BufferAttribute(ss, 1)); sg.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1)); sg.setAttribute('aDelay', new THREE.BufferAttribute(sd, 1));
    this.starU = { uT: { value: 0 }, uDpr: { value: dpr }, uFade: { value: 1 }, uIn: { value: 0 }, uGlint: { value: reducedMotion() ? 0 : 1 } };
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: this.starU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.stars.rotation.z = 0.3; this.stars.renderOrder = -1; scene.add(this.stars);
    const earth = this.earth = new THREE.Group(); earth.position.set(0, Y_BELOW, 0); scene.add(earth);
    this.earthU = { map: { value: null }, sunDir: { value: sunDir }, exposure: { value: 0.95 }, fade: { value: 1 } };
    // a little inside the unit sphere, so the map's tiles (on it) always cover it where they are drawn
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(0.996, 128, 80), new THREE.ShaderMaterial({ uniforms: this.earthU, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }));
    earth.add(this.globe);
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
    this.reserveRight = !!this.config || this.hubParam === 'stub';   // a hub: the sign-in, then the social column, stand on the right
    this.setPhase('crescent');
    if (this.user) this.onSignedIn(this.user, true);   // the stub, or a session the hub already knows: lit while it lands
    else if (this.config && this.onGate) this.browse();  // signed out with a hub: the places can be browsed, not started
    await this.land();   // the title and the earth to their places together
    if (this.closed) return;
    this.panelsIn();
    if (this.guest) { this.onGate(this); this.sideIn(); }                                 // the sign-in, the places, staggered together
    else if (this.phase === 'lit') this.sideIn();                                         // the places and the social column, staggered together
    else {
      this.setPhase('gate');
      if (this.onGate) { this.onGate(this); this.staggerIn([...this.root.querySelectorAll('.tt-gate .ac-modal, .tt-gate .ac-modal > :not(form), .tt-gate .ac-form > *')]); }   // the modal (account.js; it handles no hub too)
      else this.showExplore(this.config ? 'the sign-in is not built yet' : 'no hub here: explore alone');
    }
  }
  // Every place's name and region line from its features.json: the tile's locality, else its roads, else its id; the
  // Indigenous territories after.
  loadNames(say) {
    let n = 0;
    return Promise.all(this.places.map(async p => {
      const f = await getJSON(`../tiles/${p.id}/client/features.json`);
      // the name: the locality, else the main natural feature (arrival.js placeName; never a road, 2026-11-06); under it
      // the Indigenous territories (the pipeline's territories step, Native Land Digital), the row left out when none
      p.name = placeName(f) || p.id; p.terr = await territoriesOf(p.id, f);
      p.region = p.terr.map(t => t.name).join(' · ');
      p.el.querySelector('.tt-rname').textContent = p.name; p.el.querySelector('.tt-rterr').innerHTML = terrHTML(p.terr);
      p.el.setAttribute('aria-label', `${p.name} (${p.id})`); p.label.querySelector('.tt-lname').textContent = p.name;
      say(`loading the places… ${++n} / ${this.places.length}`);
    }));
  }
  // The title from the middle to its place at the top and the earth from below to its place in the middle of the free
  // space, as one motion: the same eased u moves both each frame, so they arrive together (the title's own CSS only
  // holds where it lands: .risen, --tt-top, --tt-s). Under reduced motion neither moves: the title fades out in the middle
  // and in at its place while the earth, already in its place, fades in from black. Resolves when both have landed.
  async land() {
    const t = this.$('.tt-title'), h1 = t?.querySelector('h1'); if (!t) return;
    t.classList.add('on');   // in already, unless the loading was quicker than its fade
    const fs = parseFloat(getComputedStyle(h1).fontSize) || 60, s1 = Math.min(1, TITLE_PX / fs);
    t.style.setProperty('--tt-s', String(s1));   // risen, the title is TITLE_PX high at any width
    const top1 = parseFloat(getComputedStyle(t).getPropertyValue('--tt-top')) || 36, top0 = t.clientHeight / 2 || innerHeight / 2;
    const rm = reducedMotion(), y0 = this.earth.position.y, place = (top, sc) => { h1.style.top = `${top}px`; h1.style.transform = `translate(-50%, -50%) scale(${sc})`; };
    place(top0, 1); t.classList.add('risen');   // the colour and shadow of its place; the inline top and scale move it
    if (rm) { this.earth.position.y = 0; this.earthU.fade.value = 0; h1.style.transition = 'none'; }   // the cross-fade is the tween's own
    await this.tween(rm ? REFADE_MS : LAND_MS, u => {
      if (!rm) { this.earth.position.y = lerp(y0, 0, u); place(lerp(top0, top1, u), lerp(1, s1, u)); return; }
      const out = clamp((u - 0.3) / 0.15, 0, 1), back = clamp((u - 0.5) / 0.5, 0, 1);
      if (u < 0.5) { h1.style.opacity = String(1 - out); } else { place(top1, s1); h1.style.opacity = String(back); }
      this.earthU.fade.value = back;
    }, rm ? (u => u) : easeInOut).p;
    h1.style.top = h1.style.transform = h1.style.opacity = h1.style.transition = ''; this.earthU.fade.value = 1; this.earth.position.y = 0;
    this.landed = true;
  }
  // The gate's panels may come in now (the sign-in and Explore); taken off when the screen closes.
  panelsIn() { if (!this.closed) document.documentElement.classList.add('tt-panels'); }
  // The side panels' items, staggered in (staggerIn), once the title and the earth have landed: the places, and the
  // social column when signed in (html.tt-side), or the sign-in when signed out; again for the social column alone when a
  // visitor signs in. Each part only once.
  sideIn() {
    if (this.closed) return;
    const html = document.documentElement, items = [];
    if (!this.wrap.classList.contains('listed')) {
      this.wrap.classList.add('listed');
      this.syncPlaces(innerWidth, innerHeight, 0);   // the rows in their order before they are measured
      items.push(...this.root.querySelectorAll('.tt-search, .tt-head, .tt-rows > .tt-row, .tt-layers, .tt-attrib'));
    }
    if (this.guest) items.push(...this.root.querySelectorAll('.tt-loginpill:not([hidden]), .tt-gate .ac-modal, .tt-gate .ac-modal > :not(form), .tt-gate .ac-form > *'));
    else if (!html.classList.contains('tt-side')) {
      html.classList.add('tt-side');
      const soc = document.getElementById('social');
      if (soc) items.push(...soc.querySelectorAll('.so-bar, .so-panel:not([hidden]) .so-card, .so-panel:not([hidden]) .so-aside, .so-panel:not([hidden]) .so-find, .so-panel:not([hidden]) .so-tabs, .so-panel:not([hidden]) .so-body > *, .so-panel:not([hidden]) .so-chead, .so-panel:not([hidden]) .so-line'));
    }
    this.staggerIn(items);
  }
  // Fade each item in rising a little, the topmost first, items at the same height together, the gaps between starts
  // shrinking (STAGGER_*). Below the window's bottom an item just shows. The starts are kept in staggerLog for debugging.
  staggerIn(els) {
    const rm = reducedMotion(), H = innerHeight;
    const items = [...new Set(els)].filter(e => e?.isConnected && e.getClientRects().length).map(e => ({ e, top: e.getBoundingClientRect().top })).filter(i => i.top < H).sort((a, b) => a.top - b.top);
    const frames = rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: `translateY(${STAGGER_RISE}px)` }, { opacity: 1, transform: 'translateY(0)' }];
    let t = 0, k = 0, at = null;
    this.staggerLog = [];
    for (const it of items) {
      if (at !== null && it.top - at > STAGGER_SAME_PX) { t += Math.max(STAGGER_MIN, STAGGER_FIRST * STAGGER_DECAY ** k); k++; }
      if (at === null || it.top - at > STAGGER_SAME_PX) at = it.top;
      it.e.animate(frames, { duration: STAGGER_MS, delay: t, easing: STAGGER_EASE, fill: 'backwards' });
      this.staggerLog.push({ ms: Math.round(t), top: Math.round(it.top), item: (it.e.className && typeof it.e.className === 'string' ? it.e.className.split(' ')[0] : it.e.tagName.toLowerCase()) + (it.e.textContent ? `: ${it.e.textContent.trim().slice(0, 24)}` : '') });
    }
  }
  setPhase(ph) {
    this.wrap.classList.remove(`phase-${this.phase}`); this.phase = ph; this.wrap.classList.add(`phase-${ph}`);
  }
  showExplore(note = '') {
    if (this.closed || this.phase === 'lit') return;
    const b = this.$('.tt-explore'), p = this.$('.tt-gate-note');
    b.hidden = false; b.classList.add('on');
    if (note) { p.textContent = note; p.hidden = false; }
    this.staggerIn([b, p]);
    b.focus({ preventScroll: true });
  }
  // Signed out, with a hub: the earth is lit as for a player (the sun round, the map, the dots, the places) and every
  // place can be chosen and flown to, but none started (Aaron, 2026-11-06: "show all locations and let them navigate
  // to them but not start them"): no world is built for a visitor (choose skips onSelect), Start is greyed with its
  // tooltip, and Invite, the friends' faces and the social column wait for the sign-in (onSignedIn), which builds the
  // chosen place's world then.
  browse() {
    if (this.closed || this.phase === 'lit') return;
    this.guest = true; this.wrap.classList.add('guest');
    this.$('.tt-loginpill').hidden = false;
    this.setPhase('lit');
    const s0 = [...this.sun];
    this.tween(LAND_MS + 400, u => { this.sun[0] = lerp(s0[0], SUN_LIT[0], u); this.sun[1] = lerp(s0[1], SUN_LIT[1], u); }, easeInOut);
    this.tween(2200, u => { this.mapFade = u; }, easeInOut, LAND_MS * 0.55);
    this.face(this.faceId, LAND_MS);
    this.dots.visible = true;
    this.tween(1400, u => { this.dotU.uFade.value = u; }, easeInOut, LAND_MS);
    // the places' player counts without a session (the hub's anonymous /api/hub/counts; signed in, the socket's watch)
    const poll = () => getJSON('/api/hub/counts').then(j => { if (this.guest && !this.closed && j?.tiles) this.setCounts(j.tiles); });
    poll(); this.countsT = setInterval(poll, GUEST_COUNTS_MS);
    this.renderBar();
  }
  // Signed in (the hub's `you`, or null exploring alone): the sun swings round to the facing side, the earth turns to
  // face the place, the map and the dots come in; the earth's place does not change (it landed there, or is landing:
  // `landing`, a session already known, lit over the landing's time). Then the side panels come in together: at the
  // landing's end (run), or once the sign-in has faded (SIDE_AFTER_SIGNIN_MS).
  onSignedIn(user, landing = false) {
    if (this.closed) return;
    if (this.guest) {   // a visitor signed in while browsing: Start, Invite and the social column; the chosen place's world builds now
      if (!user) return;
      this.guest = false; this.user = user; this.wrap.classList.remove('guest', 'gate-open'); if (this.ring) this.ring.guest = false; this.$('.tt-loginpill').hidden = true; clearInterval(this.countsT);
      this.hub.watch?.(true);
      this.onLit?.(this.user);
      if (this.sel) this.onSelect?.(this.sel);
      this.renderBar(); if (this.sel) this.renderPeople();
      setTimeout(() => this.sideIn(), SIDE_AFTER_SIGNIN_MS);
      return;
    }
    if (this.phase === 'lit') return;
    this.user = user || null;
    this.setPhase('lit');
    this.hub.watch?.(true);
    const s0 = [...this.sun], T = landing ? LAND_MS : 2600;
    this.tween(T + 400, u => { this.sun[0] = lerp(s0[0], SUN_LIT[0], u); this.sun[1] = lerp(s0[1], SUN_LIT[1], u); }, easeInOut);
    this.tween(2200, u => { this.mapFade = u; }, easeInOut, landing ? LAND_MS * 0.55 : 500);
    this.face(this.faceId, T);
    this.dots.visible = true;
    this.tween(1400, u => { this.dotU.uFade.value = u; }, easeInOut, landing ? LAND_MS : 900);
    if (!landing && this.landed) setTimeout(() => this.sideIn(), SIDE_AFTER_SIGNIN_MS);
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
  // pace(u): the flight's clock rate at raw progress u (flyToPlace), for a flight timed by something else.
  flyTo(lat, lon, alt, ms = null, pace = null) {
    this.vyaw = this.vpitch = 0; this.stopFlight(); this.anchor = null;
    const y0 = this.yaw, p0 = this.pitch, a0 = this.alt, dy = wrapPi(yawOfLon(lon) - y0), pT = clamp(lat * DEG, -PITCH_MAX, PITCH_MAX);
    const ang = Math.acos(clamp(latLonToXYZ(lat, lon).dot(latLonToXYZ(p0 / DEG, lonOfYaw(y0))), -1, 1));
    const peak = Math.max(a0, alt, Math.min(2.4, ang * 1.1)), la0 = Math.log(a0), la1 = Math.log(alt), bump = Math.log(peak) - Math.max(la0, la1);
    const free = clamp(1400 + 900 * Math.sqrt(ang) + 250 * Math.abs(la1 - la0), 1400, 4200);
    ms ??= pace ? clamp(free * PLACE_SLOW, PLACE_MS[0], PLACE_MS[1]) : free;
    this.altGoal = alt;
    const t = this.flying = this.tween(ms, u => {
      const e = easeInOut(u);
      this.yaw = y0 + dy * e; this.pitch = lerp(p0, pT, e);
      this.alt = this.altGoal = Math.exp(lerp(la0, la1, easeInOut(u)) + Math.max(0, bump) * 4 * u * (1 - u));
    }, u => u);
    t.view = true; t.rate = pace;
    return t.p;
  }
  stopFlight() {
    if (!this.flying) return;
    const t = this.flying; this.flying = null;
    const i = this.tweens.indexOf(t); if (i >= 0) { this.tweens.splice(i, 1); t.done(); }
  }
  // The stage (Aaron, 2026-11-07: "center the tile on the screen in its final position so that there is space on the
  // bottom for a proper Title above the Invite/start buttons"): the free centre between the side panels (freeArea, the
  // layout the earth lands in), under the risen title, above the bar (the place's title block, Invite and Start, the
  // loading line), less a margin. The rings of bodies fill it (bodyRing.js). In CSS pixels: { l, r, t, b }.
  stageArea(W, H) {
    const phone = matchMedia('(max-width: 720px)').matches, m = FOCUS_MARGIN[phone ? 1 : 0], [fl, fr] = this.freeArea(W);
    const title = parseFloat(getComputedStyle(this.$('.tt-title')).getPropertyValue('--tt-top')) || 36;
    const bar = this.bar.offsetHeight || 200, lb = phone && this.sel ? this.$('.tt-listbtn') : null;
    const top = lb?.offsetHeight ? this.list.offsetTop + lb.offsetTop + lb.offsetHeight + 10 : title + (phone ? 40 : 22);   // under the search and the list's button
    return { l: fl + m, r: fr - m, t: top, b: H - bar - m * 0.5 };
  }
  // Where a chosen tile is framed: the stage, a little kept clear above it for the rings' back animals (bodyRing.js: the
  // rings stand inside the tile's square, pinned to it)
  focusArea(W, H) {
    const st = this.stageArea(W, H);
    return { ...st, t: st.t + (st.b - st.t) * STAGE_TOP };
  }
  // The pose that shows a place: the camera looks at the tile's centre from the distance at which the whole tile, as the
  // camera sees it there (tilted toward the north's horizon as it comes down: tiltFor, fovFor), just fits the focus area;
  // the view's offset (frame: offX, offY) puts the tile's centre at the area's centre. Found by bisection on the distance.
  chosenPose(id) {
    const p = this.byId[id], [w, s, e, n] = p.bounds, lat = (s + n) / 2, lon = (w + e) / 2;
    const size = this.renderer.getSize(this._size), W = size.x || innerWidth, H = size.y || innerHeight, a = this.focusArea(W, H);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lat * DEG, yawOfLon(lon), 0, 'XYZ'));
    const pts = [];
    for (let i = 0; i <= 4; i++) { const u = i / 4; for (const [la, lo] of [[s, w + (e - w) * u], [n, w + (e - w) * u], [s + (n - s) * u, w], [s + (n - s) * u, e]]) pts.push(latLonToXYZ(la, lo).applyQuaternion(q)); }
    const cam = new THREE.PerspectiveCamera(FOV_FAR, W / H, 1e-5, 80), v = new THREE.Vector3();
    const offX = (a.l + a.r) / 2 - W / 2, offY = (a.t + a.b) / 2 - H / 2;
    const fits = A => {
      const t = tiltFor(A);
      cam.fov = fovFor(A); cam.near = Math.max(2e-5, A * Math.cos(t) * 0.3);
      cam.position.set(0, -A * Math.sin(t), 1 + A * Math.cos(t)); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 1);
      cam.setViewOffset(W, H, -offX, -offY, W, H); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      for (const p0 of pts) {
        v.copy(p0).project(cam);
        const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
        if (v.z >= 1 || x < a.l || x > a.r || y < a.t || y > a.b) return false;
      }
      return true;
    };
    let lo = Math.log(ALT_MIN), hi = Math.log(0.2);
    if (a.r - a.l < 40 || a.b - a.t < 40 || !fits(Math.exp(hi))) return { lat, lon, alt: 0.01 };   // no room to speak of: a regional view
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(Math.exp(mid))) hi = mid; else lo = mid; }
    return { lat, lon, alt: Math.exp(hi) };
  }
  flyToPlace(id) {
    const c = this.chosenPose(id);
    this.card.classList.remove('on');
    // the last stretch keeps behind the loading bar (this.shown, eased and continuous, so the pace never jumps): to pass
    // raw progress u the build must be about smooth(PACE_FROM, 1, u) along; ahead of that the clock slows smoothly
    const pace = u => {
      const load = this.readyIds.has(id) || this.sel !== id || this.guest ? 1 : (this.shown || 0);   // a visitor's: nothing loads, the slow pace alone
      return clamp(1 - (smooth(PACE_FROM, 1, u) - load) / PACE_SLACK, PACE_MIN, 1);
    };
    return this.flyTo(c.lat, c.lon, c.alt, null, pace).then(() => {
      if (this.sel !== id || this.closed) return;
      this.card.classList.add('on'); this.selArmed = true;
      this.ringFor = null; this.ring?.show(id).then(list => { if (list && this.sel === id && !this.closed) this.renderBody(); });   // the bodies teleport in once it has landed (loaded during the flight, or now)
    });
  }
  // A tween run by frame(): fn(eased 0..1) over ms after delay; .p resolves when done (or stopped); .view marks one a drag cancels.
  endTween(t) { const i = t ? this.tweens.indexOf(t) : -1; if (i < 0) return; this.tweens.splice(i, 1); if (this.flying === t) this.flying = null; t.done(); }
  tween(ms, fn, ease = easeInOut, delay = 0) {
    const t = { t: -delay, ms, fn, ease, done: null, view: false };
    t.p = new Promise(r => { t.done = r; });
    this.tweens.push(t);
    return t;
  }

  // ---- the list ------------------------------------------------------------------------------------------------------
  // 'global': every place, the most active first; 'visible': the places in view, the most active first.
  setMode(m) {
    if (this.mode === m && this.$('.tt-modebtn').textContent) return;
    this.mode = m; this.listKey = '';
    this.$('.tt-mode').textContent = 'Most active';
    this.$('.tt-modebtn').textContent = m === 'global' ? 'everywhere' : 'in view';
    this.$('.tt-modebtn').title = m === 'global' ? 'listing every place: list the places in view' : 'listing the places in view: list every place';
  }

  // ---- the hub's counts ---------------------------------------------------------------------------------------------
  // tiles: {tileId: n}. The dots grow and whiten with more players; the list re-sorts (in frame()).
  setCounts(tiles) {
    this.counts = tiles || {};
    this.places.forEach((p, i) => {
      p.count = Math.max(0, Math.round(+this.counts[p.id] || 0));
      this.dotSize.setX(i, 9 + 4 * Math.sqrt(p.count)); this.dotGlow.setX(i, Math.min(1, p.count / 6));
      this.renderWho(p);
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
    if (!this.ring) this.ring = new BodyRing({ renderer: this.renderer, box: this.$('.tt-ring'), guest: !!this.guest, onPick: code => this.pickedBody(code) });
    if (this.ring.tile && this.ring.tile !== id) this.ring.clear();   // the last place's bodies go while the earth flies on
    // its bodies load during the flight, but behind the world's heavy steps (terrain, vegetation...) so they do not slow
    // the paced zoom: once the build is past its animals step (ringLoad, from setProgress), at once when nothing builds
    this.ringFor = id;
    if (this.guest || this.readyIds.has(id)) this.ringLoad(id);
    this.body = 'spirit'; this.joinWith = null; this.autoStart = null; this.selArmed = false; this.smallSince = null;
    this.renderCard(); this.renderBar();
    this.wrap.classList.add('chosen'); this.wrap.classList.remove('listopen'); this.$('.tt-listbtn').setAttribute('aria-expanded', 'false');
    this.flyToPlace(id);
    this.relief?.show(id);
    if (!this.guest) this.onSelect?.(id);   // a visitor's choice builds nothing (they cannot start it)
  }
  // Zoomed away from the chosen place (Aaron, 2026-11-07: "If I zoom too far away from the selected tile, the tile becomes
  // deselected and the button and animals and title fade away"): its tile drawn under UNCHOOSE_AT[1] of the free centre's
  // width for UNCHOOSE_AT[2] ms, once it has been framed (armed at UNCHOOSE_AT[0]: the flight in from afar never counts).
  // Checked each frame by syncPlaces; one way: zooming back in does not choose it again.
  watchZoom(W) {
    const p = this.byId[this.sel]; if (!p || this.begun || this.flying || this.autoStart) return;
    const [w, s, e, n] = p.bounds, lat = (s + n) / 2, [fl, fr] = this.freeArea(W);
    const a = this.screenOf(latLonToXYZ(lat, w)), b = this.screenOf(latLonToXYZ(lat, e));
    if (!a || !b) return;
    const share = Math.abs(b[0] - a[0]) / Math.max(1, fr - fl);
    if (share >= UNCHOOSE_AT[0]) this.selArmed = true;
    if (!this.selArmed || share >= UNCHOOSE_AT[1]) { this.smallSince = null; return; }
    const now = performance.now(); this.smallSince ??= now;
    if (now - this.smallSince >= UNCHOOSE_AT[2]) this.unchoose();
  }
  // No place chosen any more: the rings beam out (fade, reduced motion), the title, Invite and Start fade with the bar, the
  // tile's outline and its row and label go back to a place among others, its world is let go (main.js onDeselect: as a
  // second choice lets the first go), and the group no longer sees a body chosen there.
  unchoose() {
    const id = this.sel; if (!id || this.begun) return;
    this.byId[id].el.classList.remove('sel'); this.byId[id].label.classList.remove('sel');
    this.sel = null; this.ringFor = null; this.autoStart = null; this.joinWith = null; this.body = 'spirit'; this.selArmed = false; this.smallSince = null;
    this.ring?.clear(); this.relief?.hide();
    this.wrap.classList.remove('chosen', 'listopen');
    this.renderBar();   // the bar's .on goes: it fades out with the title in it (title.css)
    if (!this.guest) { this.onBody?.(null, null); this.onDeselect?.(id); }
    this.listKey = '';
    this.unchosen = { id, at: Math.round(performance.now()) };   // debugging
  }
  // A point of the earth's unit sphere on screen [x, y] (CSS px), or null behind the earth
  screenOf(p0) {
    const size = this.renderer.getSize(this._size), W = size.x || innerWidth, H = size.y || innerHeight, c = this.earth.position, v = this._w.copy(p0).applyQuaternion(this.earth.quaternion).add(c);
    const toCam = this._v.copy(this.cam.position).sub(v); if (toCam.dot(v.clone().sub(c)) <= 0) return null;
    v.project(this.cam); if (v.z >= 1) return null;
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
  }
  // The card over the place: its name, its region line, the avatars of its players and how many, which opens the list.
  renderCard() {
    const p = this.byId[this.sel]; if (!p) { this.card.hidden = true; return; }
    this.card.hidden = false;
    this.card.querySelector('.pc-name').textContent = p.name;
    this.card.querySelector('.pc-region').innerHTML = terrHTML(p.terr);
    this.$('.pc-list').hidden = true; this.$('.pc-people').setAttribute('aria-expanded', 'false');
    this.renderPeople(); this.renderBody();
  }
  // ---- the bodies (bodyRing.js) ------------------------------------------------------------------------------------------
  // A body chosen in the rings (a click, or the ring's own clear back to the spirit): the title names it, the group is
  // told (multiplayer.js onBody, through the hub: the tile and the species, nothing else), and Start arrives in it.
  pickedBody(code) {
    this.body = code || 'spirit';
    this.renderBody();
    if (!this.guest && this.sel) this.onBody?.(this.sel, this.body);
  }
  // A click on an animal (or the spirit): chosen, its ring swinging it to the front; a visitor's shows the tip instead
  chooseBody(code, touch = false) {
    if (this.begun || !this.ring) return;
    if (this.guest) { this.ring.hover(code); if (touch) { clearTimeout(this.bodyTipT); this.bodyTipT = setTimeout(() => this.ring?.hover(null), 2600); } return; }
    if (code === this.body) return;
    this.ring.select(code);
  }
  // The body line under the place's name, and the group's picks there (multiplayer.js bodiesAt: [{ user, name, code,
  // here }]) as their faces over the animals; a pick of the same animal as a member's is going with them (joinWith: Start
  // arrives beside them, the one in the body there first).
  refreshBodies() { if (!this.closed && this.sel) this.renderBody(); }
  renderBody() {
    const el = this.$('.pc-body'); if (!el || !this.sel) return;
    const marks = (this.bodiesAt?.(this.sel) || []).filter(m => m && m.user && m.code);
    this.ring?.setMarks(marks);
    const b = this.body !== 'spirit' ? this.ring?.picked : null;
    if (this.body !== 'spirit' && !b) this.body = 'spirit';
    const mates = b ? marks.filter(m => m.code === this.body) : [];
    this.joinWith = (mates.find(m => m.here) || mates[0])?.user || null;
    const name = b ? b.name : '', art = /^[aeiou]/i.test(name) ? 'an' : 'a';
    el.querySelector('.pc-as').innerHTML = b ? `As ${art} <b>${esc(name)}</b>` : 'As <b>the spirit</b>';
    el.querySelector('.pc-with').textContent = mates.length ? ` · beside ${andList(mates.slice(0, 3).map(m => m.name || 'a friend'))}` : '';
  }
  // Called by multiplayer.js when who is there or coming changes. Known players (friends and group members the hub
  // says are in the tile, and the people invited) are named; the others the hub counts are anonymous wisps: a stranger's
  // name and whereabouts are never sent to anyone outside the tile's room.
  refreshPeople() { if (this.closed) return; for (const p of this.places) this.renderWho(p); this.listKey = ''; if (this.sel) this.renderPeople(); }
  // A place's row and label: the wisps of the friends there (those sharing their place) and their names, else how many
  // players are there ("3 here", "no one here").
  renderWho(p) {
    if (!p.el) return;
    const fr = (this.friendsAt?.(p.id) || []).filter(f => f && f.id);
    const text = fr.length ? `${andList(fr.slice(0, 3).map(f => f.name))}${fr.length > 3 ? ` +${fr.length - 3}` : ''} here` : '';
    const key = `${fr.map(f => f.id).join(',')}|${text}|${p.count}`; if (p.whoKey === key) return; p.whoKey = key;
    p.el.querySelector('.tt-rpill').innerHTML = pillHTML(p.count);
    p.el.querySelector('.tt-rwho').textContent = text;   // the friends there, by name (the count is the pill's)
    p.el.querySelector('.tt-rcount').classList.toggle('friends', fr.length > 0);
    for (const box of [p.el.querySelector('.tt-faces'), p.label.querySelector('.tt-faces')]) {
      box.replaceChildren(...fr.slice(0, FACES_MAX).map(f => { const a = avatarFor(f.id, 16); a.title = f.name; return a; }));
    }
  }
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
    this.$('.pc-people').hidden = !shown.length && !known.length;   // no one: the pill's 0 says it
    this.$('.pc-pill').innerHTML = pillHTML(p.count);
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
    const start = this.$('.tt-start'), inv = this.$('.tt-invite'), g = !!this.guest;
    this.bar.classList.toggle('guest', g);
    start.disabled = !g && (!ready || this.begun);   // greyed, not disabled, for a visitor: it keeps hover and focus for the tooltip
    start.toggleAttribute('aria-disabled', g); if (g) start.setAttribute('aria-disabled', 'true');
    this.$('.tt-tip').hidden = !g;
    inv.hidden = g;
    inv.disabled = !id || this.begun || !this.onInvite;
    inv.title = this.onInvite ? 'invite a group or friends to this place' : 'sign in to invite friends';
    this.$('.tt-bstatus').textContent = !id || g ? '' : this.autoStart && !this.begun ? `Going with ${this.autoStart}${ready ? '' : `: ${this.status[id] || 'loading…'}`}` : ready ? `${this.byId[id].name} is ready` : (this.status[id] || 'loading…');
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
    if (at[0] >= STEP_AT.animals[1]) this.ringLoad(id);
  }
  // The chosen place's bodies start loading (bodyRing.js show, held until the flight lands), once per choice
  ringLoad(id) {
    if (this.ringFor !== id || this.sel !== id || !this.ring || this.closed) return;
    this.ringFor = null;
    this.ring.show(id, { hold: true }).then(list => { if (list && this.sel === id && !this.closed) this.renderBody(); });
  }
  setReady(id = this.tileId) {
    if (!id) return;
    this.readyIds.add(id); this.progress[id] = 1;
    this.ringLoad(id);
    if (id === this.sel) { this.renderBar(); if (this.autoStart) this.begin(); }
  }
  // Start with a group member who just started here (multiplayer.js: the same body chosen at this place in the rings):
  // at once if the world is built, else as soon as it is.
  startWith(lead, name = '') {
    if (this.begun || this.guest || !this.sel) return;
    this.joinWith = lead; this.autoStart = name || 'them';
    if (this.ready) this.begin(); else this.renderBar();
  }
  // Start: the camera sinks toward the place while the screen fades to black; then onBegin enters the world through
  // main.js's enterWorld, whose own fade (.out) brings the spirit world in from the black.
  begin() {
    if (this.begun || !this.ready || this.guest) return;
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
      this.onBegin({ tileId: this.sel, season: this.season, date: null, point: this.points[this.sel] || null, body: this.body && this.body !== 'spirit' ? this.body : null, join: this.joinWith || null });
    }, 1500);
  }

  // The first frame is drawn (the stars' shader compiled): the boot screen's green fades to black (index.html #boot) and
  // the stars start coming in.
  firstDrawn() {
    this.drawnAt = this.time; this.drawnMs = performance.now();   // debugging: the page's clock at the first frame
    const boot = document.getElementById('boot');
    if (boot && !boot.classList.contains('out')) { boot.classList.add('out'); setTimeout(() => boot.remove(), 1000); }
  }

  // ---- every frame --------------------------------------------------------------------------------------------------
  // The space the earth's point of interest is centred in: between the list (left) and the social panel (right).
  // The panels' final layout, whether they are in yet or not, so the earth is centred once and stays: the places' column
  // on the left (its laid-out box: offsetLeft and offsetWidth ignore the slide's transform), the gate's on the right
  // where the sign-in and then the social column stand (when there is a hub; at a phone's width the column is a
  // toggle at the top and leaves the width free).
  freeArea(W) {
    const phone = matchMedia('(max-width: 720px)').matches, folded = phone && this.sel && this.phase === 'lit';   // a phone's chosen place: the list folds away
    const left = this.list.offsetWidth && !folded ? this.list.offsetLeft + this.list.offsetWidth : 0, gate = this.$('.tt-gate');
    const right = this.reserveRight && gate?.offsetWidth && !phone ? Math.min(W, gate.offsetLeft) : W;
    return [left, right];
  }
  frame(now) {
    if (this.closed) return;
    this.raf = requestAnimationFrame(this.frameFn);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.time += dt;
    for (const t of this.tweens.slice()) {
      t.t += dt * 1000 * (t.rate && t.t > 0 ? t.rate(Math.min(1, t.t / t.ms)) : 1); if (t.t < 0) continue;
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
    // a chosen tile's centre at the focus area's centre (chosenPose), up or down as well as across
    this.stage = this.stageArea(W, H);
    let offY = 0; if (this.sel && this.phase === 'lit') { const a = this.focusArea(W, H); offY = (a.t + a.b) / 2 - H / 2; }
    this.offY = this.offY == null ? offY : this.offY + (offY - this.offY) * (1 - Math.exp(-dt * 6));
    const flr = `${Math.round(fl)}px|${Math.round(W - fr)}px`;   // the free space's edges for the CSS: the bar's buttons and the toast centre in it
    if (flr !== this.flr) { this.flr = flr; const [l, rr] = flr.split('|'); document.documentElement.style.setProperty('--we-fl', l); document.documentElement.style.setProperty('--we-fr', rr); }
    this.offX = this.offX == null ? off : this.offX + (off - this.offX) * (1 - Math.exp(-dt * 6));   // set at once on the first frame
    if (Math.abs(this.offX) > 0.5 || Math.abs(this.offY) > 0.5) cam.setViewOffset(W, H, -this.offX, -this.offY, W, H); else cam.clearViewOffset();
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
    this.starU.uT.value = this.time;
    if (this.drawnAt != null) {
      this.starU.uIn.value = this.time - this.drawnAt;
      if (!this.titleOn && this.starU.uIn.value > TITLE_IN_S) { this.titleOn = true; this.$('.tt-title')?.classList.add('on'); }
    }
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
    if (this.ring) {   // the rings of bodies, pinned to the chosen tile (bodyRing.js): drawn through this camera in the tile's frame
      const p = this.sel && this.byId[this.sel];
      this.ring.pin(p ? { cam, earth: this.earth, p0: p.p0, hw: p.hw } : null);
      this.ring.render(dt, W, H);
    }
    r.setClearColor(this._cc, ca); r.autoClear = ac;
    if (this.drawnAt == null) this.firstDrawn();
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
    // with a place chosen, none in the rings' space or under the stage (the place's title and the buttons are there)
    const st = this.sel && this.stage, fa = st && this.focusArea(W, H), clear = p => !st || (p.sy < st.b - 6 && !(p.sx > fa.l && p.sx < fa.r && p.sy > fa.t - 20 && p.sy < fa.b));
    const boxes = [], order = this.places.filter(p => p.onScreen && p.id !== this.sel && clear(p)).sort((a, b) => (b.id === this.sel) - (a.id === this.sel) || b.count - a.count || a.name.localeCompare(b.name));
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
    if (this.sel) this.watchZoom(W);
    // the chosen place (its name over the buttons now: renderCard; the label on the map is left out above)
    if (this.sel) {
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
    this.closed = true; this.ownsCanvas = false; clearInterval(this.countsT);
    cancelAnimationFrame(this.raf);
    document.documentElement.classList.remove('tt-panels', 'tt-side');
    document.documentElement.style.removeProperty('--we-fl'); document.documentElement.style.removeProperty('--we-fr');
    this.geo.cancel();
    for (const ev of ['keydown', 'keyup']) removeEventListener(ev, this.guard, true);
    document.activeElement?.blur?.();
    if (this.hubParam && typeof this.hubParam === 'object') this.hub.watch?.(false); else this.hub?.close?.();   // a hub given from outside (multiplayer.js) lives on into the world
    this.map.dispose(); this.relief?.dispose(); this.ring?.dispose(); this.ring = null;
    for (const p of this.places) p.outline.dispose();
    for (const o of [this.globe, this.dots, this.stars]) { o.geometry.dispose(); o.material.dispose(); }
    this.tex?.dispose(); this.earthU.map.value = null;
    this.scene.clear(); this.scene = null;
    if (window.__weTitle === this) delete window.__weTitle;
    if (window.__weScreen === this) delete window.__weScreen;
    this.root.classList.add('out');
    setTimeout(() => { this.root.hidden = true; this.root.innerHTML = ''; this.root.classList.remove('we-title'); }, 900);
  }
}
