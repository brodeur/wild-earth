import * as THREE from 'three';
import { loadTile, loadPresentTexture, HABITAT_NAMES } from './tilepackage.js';
import { Terrain } from './terrain.js';
import { SkyDome } from './sky.js';
import { Atmosphere } from './atmosphere.js';
import { RavenFlight } from './flight.js';
import { Raven } from './raven.js';
import { Vegetation, crownPlan } from './vegetation.js';
import { Impostors } from './impostors.js';
import { Grass } from './grass.js';
import { Forbs } from './forbs.js';
import { Emergents } from './emergents.js';
import { SPECIES } from './trees.js';
import { MiniMap } from './minimap.js';
import { RoadsOverlay } from './roadsOverlay.js';
import { setupGoTo, urlPoint, builtTileFor, localXY } from './goto.js';
import { NearBar } from './nearBar.js';
import { Needs } from './needs.js';
import { Hunt } from './hunt.js';
import { Scent } from './scent.js';
import { Sight } from './sight.js';
import { SoundCues } from './soundCues.js';
import { OpeningScreen, Arrival, lastTile, rememberTile } from './arrival.js';
import { SEASON_LOOK, seasonOfDate, sunDirection, dateForSeason, parseDate } from './season.js';
import { AcornGame } from './acorns.js';
import { Identify } from './identify.js';
import { PlaceNames } from './placenames.js';
import { Soundscape } from './sound.js';
import { Shadows, forgetQueuedCasters } from './shadows.js';
import { Animals } from './animals.js';
import { Water } from './water.js';
import { Rocks } from './rocks.js';
import { SquirrelControl } from './squirrelControl.js';
import { WoodpeckerControl } from './woodpeckerControl.js';
import { SpiritControl } from './spirit.js';
import { GroundControl } from './groundControl.js';
import { FlierControl } from './flierControl.js';
import { SHORT, playAs } from './playable.js';
import { setupCredits } from './credits.js';
import { Weather } from './weather.js';
import { fieldGuide } from './fieldguide.js';
import { runSliced, yieldToMain, slicer, sliceStats } from './slice.js';
import { uniforms as atmo } from './atmosphere.js';
import { groundUniforms } from './terrain.js';
import { detailUniforms } from './groundDetail.js';
import { setBodyScale } from './bodyScale.js';
import { Litter } from './litter.js';
import { Abilities } from './abilities.js';

const $ = id => document.getElementById(id);
const html = document.documentElement;
let screen = null, screenOpen = false;   // the opening screen (arrival.js) while it is up
// HUD layout for the window's size (index.html, html.narrow): under 1200 x 760 px the HUD, game box and panel shrink.
// The game box stays centred when it clears the HUD and the panel, else it moves into the gap between them, else under
// the HUD; the panel stops above the mini-map (and scrolls), the help line wraps before the mini-map and the species
// card sits above the help line. The body's row (abilities.js #bodyBar, bottom right, in place of the help line) rises
// over the nearby-animals bar when the two would meet; the hunt panel and the walkers' toast stand on it, the panel
// and the species card stop above it. Run on resize and with the HUD's text updates (the HUD's width follows its text).
function layoutHud() {
  document.documentElement.style.setProperty('--mapH', `${$('minimap')?.offsetHeight || 0}px`);   // the panel sits under the mini-map, top right (index.html #panel)
  const W = innerWidth, H = innerHeight;
  html.classList.toggle('narrow', W < 1200 || H < 760);
  const box = id => $(id).getBoundingClientRect(), pan = $('panel'), cs = getComputedStyle(pan);
  // the panel under the mini-map (top right) scrolls within the window; the key line (bottom left) runs to the window's
  // edge and, while the nearby-animals bar is up, sits above it
  const help = $('help'), hs = getComputedStyle(help), bar = $('nearBar'), row = $('bodyBar'), up = !!row && !row.hidden;
  if (up) {
    row.style.bottom = '';
    const nb = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
    if (nb && nb.width && row.getBoundingClientRect().left < nb.right + 10) row.style.bottom = `${12 + bar.offsetHeight + 10}px`;
  }
  const rr = up ? row.getBoundingClientRect() : null, rowTop = rr ? rr.top : H;
  html.style.setProperty('--barTop', `${Math.round(H - rowTop + 10)}px`);   // the toast's bottom (index.html #gcToast)
  const hn = $('hunt'); if (hn) hn.style.bottom = rr ? `${Math.round(H - rowTop + 8)}px` : '';
  const floor = Math.min(H - 12, rowTop - 10, hn && !hn.hidden ? hn.getBoundingClientRect().top - 10 : H);   // the panel stops above the row and the hunt's lines
  pan.style.maxHeight = `${Math.max(120, Math.floor(floor - pan.getBoundingClientRect().top - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)))}px`;
  help.style.maxWidth = `${Math.max(200, Math.floor(W - 14 - help.getBoundingClientRect().left - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight)))}px`;
  help.style.bottom = bar && !bar.hidden ? `${12 + bar.offsetHeight + 10}px` : '';
  const under = help.getClientRects().length ? help.getBoundingClientRect().top : rr && rr.left < 14 + 320 + 10 ? rowTop : H - 4;   // the help line, else the row where it reaches the card
  $('speciesCard').style.bottom = `${Math.max(12, Math.round(H - under + 8))}px`;
  const g = $('game'); if (g.classList.contains('hidden')) return;
  g.style.left = g.style.top = g.style.transform = '';   // centred, as styled
  const hud = box('hud'), pr = pan.getBoundingClientRect(), gr = g.getBoundingClientRect(), lo = hud.right + 10, hi = pr.left - 10;
  if (gr.left >= lo && gr.right <= hi) return;
  g.style.transform = 'none';
  if (hi - lo >= gr.width) g.style.left = `${Math.round(Math.min(Math.max(W / 2 - gr.width / 2, lo), hi - gr.width))}px`;
  else { g.style.left = `${Math.round(hud.left)}px`; g.style.top = `${Math.round(hud.bottom + 8)}px`; }
}

// Build phases, bracketed with performance marks ('we:<phase>') so a long task can be attributed to the phase it fell
// in (performance.getEntriesByType('mark'), and a PerformanceObserver on 'longtask').
const phase = name => performance.mark(`we:${name}`);
window.__slice = sliceStats;   // debugging: steps of the sliced build that ran long (slice.js)

// ---- worlds ------------------------------------------------------------------------------------------------------
// The page makes the renderer, the camera and the opening screen once; a world (a tile's terrain, forest, animals,
// controls, HUD wiring) is built only when the screen's card is chosen (onSelect), at once on the direct paths
// (?skip=1, ?game=1, ?as=), or in place of the world played when the game's Location box goes to another tile
// (switchWorld). Choosing another card while a world builds, or after it is ready but before Begin, abandons it, and
// so does a Go to another tile while one builds or is played: its build stops at its next slice (w.wait / w.sliced
// check w.dead after every await, and its fetches and the modules' own loads stop with its AbortSignal,
// tile.signal), then it is torn down (disposeWorld):
//   - every listener its code added to the window, the document or a page element while it was being built: captured
//     here (the patched addEventListener records them while `scope` is the world, i.e. only during the world's own
//     synchronous build code, never the screen's) and removed, so a later world never answers this one's keys;
//   - every element it put into the page (HUD rows, the mini-map canvas, the acorn board, the credits list, the peek
//     fade, ...): recorded by a MutationObserver (outside the screen's root) and removed;
//   - the HUD controls' handler properties it set and the HUD's words (h1, help line, credits) as the page had them;
//     window.__we; the screen's onPoint; the page's field guide (fieldguide.js, mounted once by the page) lets go of
//     its acorn game;
//   - the modules' page-level state: water.js and shadows.js stop pointing at it (shadows.js holds casters queued
//     before a Shadows exists weakly, so a late model load of a dead world is never adopted), terrain.js lets go of its
//     textures in the shared ground and detail uniforms, the acorn game's socket is closed, its sound (direct paths)
//     closed; the weather forecast, the crown list and the ground detail stop loading (tile.signal);
//   - its GPU objects: every geometry, material, texture and render target of its scenes (the world, the shadow and
//     contact-AO passes, the grass card bake, the spirit's post pass, the cloud bake), in slices.
// A world entered (Begin, or the arrival of a tile switch) is the page's (w.commit()): its listeners and elements
// keep being recorded while it is played, so the game's own tile switch tears it down the same way, with no reload
// and no URL change, and the Location box (goto.js) is the page's, set up once, not a world's.
let scope = null;
const addListener = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function (type, fn, opts) {
  const target = this ?? globalThis;   // a module's bare addEventListener(...) call is the window's
  if (scope && fn) scope.listeners.push([target, type, fn, opts]);
  return addListener.call(target, type, fn, opts);
};
const ABANDONED = Symbol('abandoned');
function createWorld(tileId) {
  const w = { tileId, dead: false, ready: false, committed: false, abort: new AbortController(), listeners: [], nodes: new Set(), m: {},
    scene: null, tile: null, enter: null, handle: null, onPoint: null };
  const root = $('opening');
  w.observer = new MutationObserver(recs => {
    for (const r of recs) {
      if (root && (r.target === root || root.contains(r.target))) continue;
      for (const n of r.addedNodes) if (n.nodeType === 1 && n !== root) w.nodes.add(n);
      for (const n of r.removedNodes) w.nodes.delete(n);
    }
  });
  w.observer.observe(html, { childList: true, subtree: true });
  // every await of the build goes through wait: the listener scope is off while others run, and an abandoned world
  // stops here (ABANDONED is thrown; its caller sees w.dead and lets it go)
  w.wait = async p => {
    if (scope === w) scope = null;
    let v;
    try { v = await p; } catch (e) { if (w.dead) throw ABANDONED; throw e; }
    if (w.dead) throw ABANDONED;
    scope = w;
    return v;
  };
  w.next = async name => { phase(name); await w.wait(yieldToMain()); };
  w.sliced = (gen, label) => w.wait(runSliced(gen, label, { signal: w.abort.signal }));
  // played: the recording goes on (the listeners and elements the game adds while it is played go with it when the
  // page switches tiles), so the world's code is the scope from here on
  w.commit = () => { if (w.committed) return; w.committed = true; scope = w; };
  return w;
}
function closeScreen() { if (!screen) return; screen.close(); screen = null; screenOpen = false; }
// The HUD's words as index.html has them (the spirit and the controls swap their own in and read these back): taken
// before any world, put back when one is torn down.
let hudWords = null;
function snapHud() {
  const h1 = $('hud')?.querySelector('h1'), near = $('animalsNear')?.parentElement;
  hudWords = { h1: h1?.firstChild?.nodeValue, help: $('help')?.innerHTML, near: near?.title, credits: $('credits')?.innerHTML };
}
function restoreHud() {
  if (!hudWords) return;
  const h1 = $('hud')?.querySelector('h1'), near = $('animalsNear')?.parentElement;
  if (h1?.firstChild && hudWords.h1 != null) h1.firstChild.nodeValue = hudWords.h1;
  if ($('help') && hudWords.help != null) $('help').innerHTML = hudWords.help;
  if (near) near.title = hudWords.near ?? '';
  if ($('credits') && hudWords.credits != null) $('credits').innerHTML = hudWords.credits;
  if ($('nearBar')) $('nearBar').hidden = true;   // the bar's slots went with the world's nodes; the bar itself waits for the next spirit
  if ($('needs')) $('needs').hidden = true;
}
function closeBitmaps(tile) {
  for (const im of [tile?.textureImage, tile?.imageryTextureImage, tile?.groundTextureImage, tile?.seasonImage, tile?.imagery]) if (im?.bitmap) { im.bitmap.close(); delete im.bitmap; }
}
// Tear an abandoned or left world down (see above): the page-level parts at once, the GPU objects in slices.
async function disposeWorld(w, renderer) {
  const t0 = performance.now();
  w.dead = true; w.ready = false; w.abort.abort();
  if (scope === w) scope = null;
  const m = w.m;
  // the modules' own page-level state first (closing the game's socket redraws its HUD row, so before the sweep)
  try { m.acorns?.net?.leave?.(); } catch (e) { /* closing */ }
  try { m.sound?.ctx?.close?.(); } catch (e) { /* closing */ }
  if (m.weather) m.weather.onThunder = null;
  m.abilities?.dispose?.();   // the body's row: its slots go, the row hides (abilities.js)
  if (fieldGuide.game === m.acorns) { fieldGuide.game = null; fieldGuide.log = []; fieldGuide.anchor = null; }   // the page's field guide (identify.js attached the game)
  m.water?.dispose?.(); m.shadows?.dispose?.(); m.terrain?.dispose?.(); m.litter?.dispose?.(); m.scent?.dispose?.(); m.sight?.dispose?.(); m.cues?.dispose?.(); m.grass?.dispose?.(); m.forbs?.dispose?.(); m.emergents?.dispose?.(); m.veg?.dispose?.(); forgetQueuedCasters();
  // then its listeners and the elements it put into the page; the HUD's own words back as the page had them
  for (const r of w.observer.takeRecords()) { for (const n of r.addedNodes) if (n.nodeType === 1) w.nodes.add(n); for (const n of r.removedNodes) w.nodes.delete(n); }
  w.observer.disconnect();
  for (const [t, type, fn, opts] of w.listeners) t.removeEventListener(type, fn, opts);
  for (const n of w.nodes) if (n.isConnected) n.remove();
  w.listeners = []; w.nodes.clear();
  // the animations its code put on the page's elements (a caption still fading, a filling one kept by its element:
  // their handlers hold the world), except the screen's own
  { const root = $('opening'); for (const a of document.getAnimations()) { const el = a.effect?.target; if (el && !root?.contains(el)) a.cancel(); } }
  restoreHud();
  for (const id of ['texImagery', 'texRewild', 'gameBtn', 'hoverBtn', 'spiritBtn']) if ($(id)) $(id).onclick = null;
  if ($('season')) $('season').onchange = null;
  if ($('detail')) $('detail').onchange = null;
  if ($('time')) $('time').oninput = null;
  if (screen && w.onPoint && screen.onPoint === w.onPoint) screen.onPoint = null;
  if (window.__we && window.__we === w.handle) delete window.__we;
  closeBitmaps(w.tile);
  w.disposeSyncMs = performance.now() - t0;   // the part inside the click that abandoned it
  // GPU objects
  await runSliced(disposeGpu(w, renderer), 'dispose');
  w.m = {}; w.scene = null; w.tile = null; w.handle = null; w.enter = null;
  w.disposeMs = Math.round(performance.now() - t0);
}
function* disposeGpu(w, renderer) {
  const m = w.m, roots = [w.scene, m.shadows?.scene, m.shadows?.ao?.scene, m.grass?.bakeScene, m.grass?.copyScene, m.spirit?.view?.post?.scene, m.atmosphere?.cloudBake?.scene];
  const geos = new Set(), mats = new Set(), texs = new Set(), rts = new Set();
  for (const r of roots) r?.traverse?.(o => { if (o.geometry) geos.add(o.geometry); for (const x of [o.material].flat()) if (x) mats.add(x); });
  if (m.atmosphere?.cloudBake?.material) mats.add(m.atmosphere.cloudBake.material);
  yield;
  const tex = v => { for (const t of [v].flat()) if (t?.isTexture) texs.add(t); };
  for (const x of mats) { for (const v of Object.values(x)) tex(v); if (x.uniforms) for (const u of Object.values(x.uniforms)) tex(u?.value); }
  for (const U of [atmo, groundUniforms, detailUniforms]) for (const u of Object.values(U)) tex(u?.value);
  for (const t of texs) if (t.renderTarget) rts.add(t.renderTarget);
  for (const t of [...(m.atmosphere?.cloudBake?.targets || []), m.grass?.atlas, m.grass?.strip]) if (t) rts.add(t);
  if (m.spirit?.view?.post?.tex) texs.add(m.spirit.view.post.tex);
  yield;
  const gl = renderer.getContext();
  let n = 0;
  for (const g of geos) { g.dispose(); if ((++n & 127) === 0) yield; }
  for (const x of mats) { x.dispose(); if ((++n & 127) === 0) yield; }
  for (const t of texs) {
    if (t.isExternalTexture && t.userData?.banded && t.sourceTexture) { gl.deleteTexture(t.sourceTexture); t.sourceTexture = null; }
    t.dispose(); if ((++n & 63) === 0) yield;
  }
  for (const rt of rts) { rt.dispose(); yield; }
  renderer.renderLists.dispose();
}

// The page: one renderer, one camera, the opening screen, the Location box; one world at a time.
let renderer = null, camera = null, goto = null;
let world = null, gen = 0;   // the world the page builds, holds or plays, and the choice it answers to
const LENS_DEFAULT = 70, LENS_RANGE = [30, 110];
// Build the tile's world in place of the one the page has (building, ready behind the screen, or played), which is
// abandoned and torn down first. Resolves to the world when it is ready, to null when another choice overtook it.
async function replaceWorld(id, opts) {
  const g = ++gen, old = world; world = null;
  if (old) {
    const wasReady = old.ready;
    if (wasReady) screen?.readyIds?.delete?.(old.tileId);   // the screen remembers a ready tile; choosing it again builds it again
    const t = performance.now(); await disposeWorld(old, renderer);
    window.__weDisposed = { tileId: old.tileId, ready: wasReady, ms: Math.round(performance.now() - t), syncMs: +old.disposeSyncMs.toFixed(1), at: Math.round(t) };   // debugging
  }
  if (g !== gen) return null;
  const w = world = createWorld(id);
  w.arrive = opts.arrive || null;   // what a switch overtaking this build carries on (switchWorld)
  try { await buildWorld(w, opts); } catch (e) { if (w.dead || e === ABANDONED) return null; throw e; }
  return w.dead ? null : w;
}
// A tile switch from the game (the Location box): the world played is torn down, the page goes dark with the build's
// status (html.switching: the HUD hidden, the panel and its Location box kept, so another Go can abandon this build
// for another tile's), and the tile holding the point is built in its place and entered there, the season and day
// carried over: no reload, no URL change.
async function switchWorld(id, point, params) {
  const carry = world?.carry?.() || world?.arrive || {};   // the world's season and day; a build's, before it has them
  html.classList.add('switching'); html.classList.remove('arriving');
  renderer.setClearColor(0x000000, 1); renderer.clear();
  let w = null;
  try { w = await replaceWorld(id, { params, pending: point, arrive: { season: carry.season, date: carry.date, point } }); }
  catch (e) { console.error(e); $('status').textContent = `error: ${e.message}`; $('status').classList.remove('hidden'); goto.say(`could not load ${id}`, true); return; }
  if (w) goto.say('');   // it entered itself (buildSteps, arrive)
}
async function main() {
  const params = new URLSearchParams(location.search);
  const pending = urlPoint(params);   // ?lat=&lon=: a point to land at (taken off the URL below)
  // ?game=1 and ?skip=1 go straight in, as before the opening screen (agents and tests rely on it): as a spirit at the
  // tile centre, flying (&as=spirit says so), or for tests &as=raven (the old start), &as=squirrel, &as=woodpecker, or any
  // other species by its short name (playable.js SHORT: &as=deer, &as=hawk, &as=vole, ...): into the AI one nearest the centre.
  // Otherwise the opening screen asks where and when, and the chosen card's world builds behind it; the URL's ?tile=
  // only says which card to bring into the middle.
  const direct = params.get('game') === '1' || params.get('skip') === '1';
  html.classList.toggle('opening', !direct);
  let tileId = params.get('tile');
  if (pending && !tileId) tileId = await builtTileFor(pending);   // null -> loader picks the first tile

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: true });   // stencil: the herd silhouettes mask out the herd's own bodies (herdSilhouette.js)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);
  window.__weRenderer = renderer;   // debugging: GPU memory (renderer.info) with or without a world
  fieldGuide.mount();   // the field guide's card and listeners are the page's (fieldguide.js), mounted before any world
  snapHud();
  // The Location box (goto.js) is the page's too: it flies within the world played, or switches the page to the tile
  // holding the point (switchWorld), at any time, a build under way included.
  goto = setupGoTo({ input: $('gotoInput'), button: $('gotoBtn'), line: $('gotoStatus'),
    current: () => (world?.tile && world.m.flight ? { tile: world.tile, flight: world.m.flight, ready: world.ready } : null),
    switchTile: (id, p) => { switchWorld(id, p, params); } });
  if (pending) $('gotoInput').value = `${pending.lat}, ${pending.lon}`;
  // The menu (owner, 2026-10-27): the HUD, the help line and the panel live behind the hamburger top left (index.html
  // #menuBtn, html.menu); open, it is an X. Closed on load.
  $('menuBtn').onclick = () => { const on = html.classList.toggle('menu'); $('menuBtn').setAttribute('aria-expanded', String(on)); renderer.domElement.focus?.(); };
  // The lens: ?fov=<degrees, vertical> (30..110, default LENS_DEFAULT). 70 shows about 103 degrees across a widescreen,
  // a wide-angle lens; the view is undistorted only when it matches the angle the screen fills in the eye, about
  // 45-50 degrees across at a desk (under 30 vertical), so a narrower lens makes the hills loom as they do in life
  // at the cost of peripheral view and the feeling of speed. __we.setFov(deg) changes it live for comparisons.
  const lensParam = parseFloat(params.get('fov'));
  const lens = Number.isFinite(lensParam) ? Math.min(LENS_RANGE[1], Math.max(LENS_RANGE[0], lensParam)) : LENS_DEFAULT;
  camera = new THREE.PerspectiveCamera(lens, innerWidth / innerHeight, 0.5, 60000);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); layoutHud(); });
  layoutHud();

  window.__weWorld = () => world;   // debugging: the world the page is building, holding or playing
  window.__weDrop = async () => { gen++; const old = world; world = null; if (old) { if (old.ready) screen?.readyIds?.delete?.(old.tileId); await disposeWorld(old, renderer); } };   // debugging: tear it down, build nothing
  if (!direct) {
    const index = await (await fetch('../tiles/index.json', { cache: 'no-cache' })).json();
    const ids = index.tiles.map(t => t.tile_id);
    if (!ids.includes(tileId)) tileId = ids.includes(lastTile()) ? lastTile() : ids[0];
    if (!tileId) throw new Error('no tiles built');
    if (pending) history.replaceState(null, '', `?tile=${tileId}`);   // never keep the point in the URL
    // a choice abandons the world before it (building, or ready behind the screen)
    let choice = null;
    const select = async id => {
      choice = null;
      let w = null;
      try { w = await replaceWorld(id, { params, pending, direct }); } catch (e) { console.error(e); screen?.setPrep(id, `error: ${e.message}`); return; }
      if (!w) return;
      screen.setReady(id);
      if (choice?.tileId === id) w.enter(choice, true);   // Begin was pressed while it built
    };
    screen = new OpeningScreen({ root: $('opening'), index, tileId, pending,
      onSelect: id => { select(id); },
      onBegin: c => { choice = c; if (world?.ready && world.tileId === c.tileId) world.enter(c, true); } });
    screenOpen = true;
    return;
  }
  const w = await replaceWorld(tileId, { params, pending, direct });
  if (!w) return;
  w.commit();
  if (pending && !localXY(w.tile, pending.lat, pending.lon)) goto.go(pending, { fromLoad: true });   // its tile is not built: say so
}

async function buildWorld(w, opts) {
  scope = w;
  try { await buildSteps(w, opts); } finally { if (scope === w && !w.committed) scope = null; }
}
// pending: a lat/lon to land at, or null; direct: no opening screen, into the world at once; arrive: { season, date,
// point } from a tile switch, entered at once when ready (the screen's Begin, or the direct paths' start, otherwise).
async function buildSteps(w, { params, pending, direct = false, arrive = null }) {
  const status = t => {
    if (w.dead) return;
    if (screenOpen) { screen.setPrep(w.tileId, t ? `preparing ${w.tileId}: ${t}` : ''); $('status').classList.add('hidden'); return; }
    $('status').textContent = t; $('status').classList.toggle('hidden', !t);
  };
  phase('loadTile');
  const tile = w.tile = await w.wait(loadTile(w.tileId, undefined, { signal: w.abort.signal }));
  w.tileId = tile.id;   // the loader's choice when none was named (the direct paths without ?tile=)
  phase('afterTile');
  const flags = ['game', 'skip'].filter(k => params.get(k) === '1').map(k => `&${k}=1`).join('')
    + (params.has('fov') ? `&fov=${params.get('fov')}` : '');
  if (pending && direct) history.replaceState(null, '', `?tile=${tile.id}${flags}`);   // never keep the point in the URL
  $('tileName').textContent = tile.id;
  const credits = setupCredits({ tile, link: $('creditsLink'), panel: $('credits') });   // HUD Data link: sources, licences, asset credits
  status('building terrain…');
  await w.wait(new Promise(r => setTimeout(r, 20)));

  const scene = w.scene = new THREE.Scene();

  await w.next('atmosphere');
  const atmosphere = w.m.atmosphere = new Atmosphere(tile);   // shared haze, sun, sky light and clouds
  await w.next('weather');
  const weather = w.m.weather = new Weather({ tile, scene, renderer, camera });   // the day's measured weather (weather.js), loading
  await w.next('terrain');
  const terrain = w.m.terrain = new Terrain(tile); await w.sliced(terrain.build(), 'terrain'); scene.add(terrain.group);
  await w.next('sky');
  const sky = new SkyDome(scene, renderer, atmosphere);
  status('growing forest…');
  await w.next('vegetation');
  const veg = w.m.veg = new Vegetation(tile, scene, atmosphere); await w.sliced(veg.build(), 'vegetation');
  await w.next('impostors');
  const far = new Impostors(tile, scene); await w.sliced(far.build(), 'impostors');
  await w.next('grass');
  const grass = w.m.grass = new Grass(tile, scene); await w.sliced(grass.build(), 'grass');
  const forbs = w.m.forbs = new Forbs(tile, scene, grass);   // the herbs: poppies, lupines, clover, filaree... within 45 m (forbs.js)
  const emergents = w.m.emergents = new Emergents(tile, scene);   // cattail, tule, the sedges and rushes of the water system's margins (emergents.js)
  await w.next('water');
  const water = w.m.water = new Water(tile, scene); await w.sliced(water.build(), 'water');   // streams, dry beds and ponds by season (water.js)
  await w.next('rocks');
  const rocks = new Rocks(tile, scene, atmosphere);   // outcrops and boulders from the geology and soils rasters (rocks.js)
  const litter = w.m.litter = new Litter(tile, scene, { terrain, atmosphere });   // the body-scaled ring of pebbles, leaves and stems (litter.js)
  await w.next('roads+flight');
  const roads = new RoadsOverlay(tile, scene);   // ghost roads, G to toggle
  const flight = new RavenFlight(camera, tile.heights, renderer.domElement);
  scene.add(flight.body);
  const raven = new Raven(flight.body, atmosphere);   // the bird you see from the chase camera
  await w.next('shadows');
  const shadows = w.m.shadows = new Shadows({ renderer, scene, tile, terrain, veg, raven, grass, far });   // cascaded sun shadows (shadows.js)
  flight.reset(tile.size / 2, -tile.size / 2, 150);
  // On a tile with a lidar crown list (crowns.js) the trees stand on the crowns: wait for the plan (the list has been
  // downloading since the Vegetation was built, and is planned in slices) so the first frame has its trees rather than
  // shrubs alone; then the near forest and the far impostors take it.
  await w.next('crownPlan');
  if (crownPlan(tile)) {
    status('placing the trees on their lidar crowns…');
    const plan = await w.wait(crownPlan(tile));
    veg.useCrownPlan(plan); await w.next('impostors.crowns');
    await w.sliced(far.useCrownPlan(plan), 'impostors.crowns');
  }
  await w.next('veg.update');
  veg.radius = +$('detail').value; veg.update(flight.pos.x, flight.pos.z, true);
  await w.next('hud');
  const minimap = new MiniMap({ container: $('minimap'), sizeM: tile.size, imagery: tile.imagery, features: tile.features, flight, rewildImage: tile.textureImage });
  await w.next('places');
  const places = new PlaceNames(tile.features, tile.size);   // nearest named road, stream or water, for the HUD
  // The scripted arrival (arrival.js); behind the screen the bird waits at its start so the forest streams in there.
  await w.next('arrival');
  const arrival = new Arrival({ flight, camera, heights: tile.heights, size: tile.size, caption: $('caption') });
  const arrivePoint = arrive?.point ? localXY(tile, arrive.point.lat, arrive.point.lon) : null;   // null: the centre
  if (screenOpen) { screen.onPoint = w.onPoint = p => { arrival.plan(p); arrival.hold(); }; arrival.plan(screen.point); }
  else if (arrive) arrival.plan(arrivePoint);
  if (!direct) { arrival.hold(); veg.update(flight.pos.x, flight.pos.z, true); }

  // Base texture: the erased imagery when the tile has it (without its tree crowns when the tile has
  // client.texture_ground; ?base=imagery shows the photo with them, for comparison), else the rewilded habitat texture.
  await w.next('texture');
  const baseImagery = params.get('base') === 'imagery';
  const photo = (!baseImagery && tile.groundTextureImage) || tile.imageryTextureImage;
  terrain.useLitter = photo === tile.groundTextureImage;   // forest-floor litter only on the crown-free ground
  const peek = { want: false, shown: false, pending: null, present: null, roadsWere: false };   // present-day peek, below
  let texKind = 'rewilded';
  function setTexture(kind) {
    texKind = kind;
    if (peek.shown) return;   // applied when the peek ends
    const imagery = kind === 'imagery' && photo;
    terrain.setTexture(imagery ? photo : tile.textureImage);
    terrain.setImagery(!!imagery, tile.imageryRef);
    $('texImagery').classList.toggle('on', !!imagery); $('texRewild').classList.toggle('on', !imagery);
  }
  $('texImagery').disabled = !photo;
  if (!photo) $('texImagery').title = 'this tile has no erased imagery; run the erase step';
  $('texImagery').onclick = () => setTexture('imagery');
  $('texRewild').onclick = () => setTexture('rewilded');
  setTexture(photo ? 'imagery' : 'rewilded');
  await w.sliced(terrain.uploadSteps(renderer), 'ground upload');   // the large ground images to the GPU in bands (terrain.js)

  await w.next('season');
  const state = { season: 'auto', hour: +$('time').value };   // 'auto' tracks today's date (or ?date=MM-DD)
  let fixedDate = parseDate(params.get('date')), fixedDateStr = fixedDate ? params.get('date') : null;
  // The date the ground's measured colour shows: today (or ?date), or the chosen season's mid-month.
  const dateNow = () => state.season === 'auto' ? (fixedDate || new Date()) : dateForSeason(state.season);
  const seasonNow = () => state.season === 'auto' ? seasonOfDate(dateNow()) : state.season;
  // the date a tile switch carries: a fixed date ('MM-DD') while the season tracks one, else null (today, or the season)
  const dateCarry = () => state.season === 'auto' && fixedDate ? `${String(fixedDate.getMonth() + 1).padStart(2, '0')}-${String(fixedDate.getDate()).padStart(2, '0')}` : null;
  // what a tile switch from this world carries (switchWorld): its season and day; while it is still building towards
  // an arrival of its own, that arrival's (its own state takes them at enterWorld)
  w.carry = () => (arrive && !w.committed ? { season: arrive.season, date: arrive.date } : { season: seasonNow(), date: dateCarry() });
  // Picking a season picks a random day in it (its weather is that day last year, weather.js); the select keeps
  // showing the season while the game tracks the day. "tracks today's date" goes back to today.
  const SEASON_MONTHS = { winter: [12, 1, 2], spring: [3, 4, 5], summer: [6, 7, 8], fall: [9, 10, 11] };
  $('season').onchange = e => {
    const v = e.target.value, ms = SEASON_MONTHS[v];
    if (!ms) { setDate(''); return; }
    const m = ms[Math.floor(Math.random() * 3)], d = 1 + Math.floor(Math.random() * [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]);
    setDate(`${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`); $('season').value = v;
  };
  $('time').oninput = e => { state.hour = +e.target.value; };
  // The day's weather and the time slider: pre-dawn..post-dusk of the day, starting now (today) or at a random hour.
  const mmdd = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function weatherDay() {
    if (!weather.loaded) return;
    const p = weather.pick(state.season === 'auto' ? fixedDateStr : mmdd(dateNow()));
    if (!p) return;
    const t = $('time'), lo = Math.floor(p.pre * 10) / 10, hi = Math.ceil(p.post * 10) / 10;
    t.min = lo.toFixed(1); t.max = hi.toFixed(1);
    state.hour = Math.min(hi, Math.max(lo, Math.round(p.start * 10) / 10)); t.value = state.hour;
  }
  weather.ready.then(() => { if (!w.dead) weatherDay(); });
  $('detail').onchange = e => { veg.radius = +e.target.value; veg.update(flight.pos.x, flight.pos.z, true); };
  addEventListener('keydown', e => { if (e.code === 'KeyR') flight.reset(tile.size / 2, -tile.size / 2, 150); });

  const names = Object.fromEntries((tile.species || []).map(s => [s.code, s.common]));
  const showPerceives = code => {
    if (code === 'spirit') { $('perceives').textContent = 'everything: a spirit perceives every animal, and none perceives it'; return; }
    const p = tile.perception?.perceives?.[code] || []; $('perceives').textContent = p.length ? p.map(c => names[c] || c).join(', ') : 'everything (no perception matrix)'; };
  showPerceives('corvus_corax');

  function applySeason() {
    const s = seasonNow(), d = dateNow(), measured = terrain.setDate(d);   // the ground's measured colour for the date
    $('seasonNote').textContent = state.season === 'auto' ? `(${s}${measured ? `, ${d.toLocaleDateString('en', { day: 'numeric', month: 'short' })}` : ''})` : '';
    veg.setLook(SEASON_LOOK[s]);
    if (far.setSeason) far.setSeason(s);   // far impostors follow the season too
    weatherDay();
  }
  // The season's leaf textures and the ground's measured colour for the date, made in slices; applySeason then finds them.
  await w.sliced(terrain.setDateSteps(dateNow()), 'season colour');
  await w.sliced(veg.setLookSteps(SEASON_LOOK[seasonNow()]), 'season');
  await w.next('applySeason');
  applySeason();

  // Acorn stash game (docs/game-acorn-stash.md): opt-in, so flying stays the default.
  await w.next('acorns');
  const acorns = w.m.acorns = new AcornGame(tile, scene, flight, veg, {
    box: $('game'), carried: $('gameCarried'), stashed: $('gameStashed'), found: $('gameFound'), time: $('gameTime'), hint: $('gameHint'),
  });
  const setGame = on => {
    if (on) acorns.start(seasonNow()); else acorns.stop();
    $('gameBtn').textContent = on ? 'Stop game' : 'Start game'; $('gameBtn').classList.toggle('on', on);
  };
  $('gameBtn').onclick = () => setGame(!acorns.running);
  $('hoverBtn').onclick = () => { flight.setHover(!flight.hover); renderer.domElement.focus?.(); };
  if (params.get('game') === '1') setGame(true);

  // Species identification: HUD rows, click a tree for its card, T toggles name tags (identify.js).
  await w.next('identify');
  const identify = new Identify({ veg, grass, forbs, emergents, camera, dom: renderer.domElement, scene, flight, acorns, seasonNow,
    els: { nearest: $('nearestTree'), around: $('aroundYou'), card: $('speciesCard') } });

  // Ambient animals (animals.js): squirrels, acorn woodpeckers, other ravens, deer, filtered by perception.
  // During an acorn game the woodpeckers, squirrels and ravens gather from the game's acorns (game: acorns).
  await w.next('animals');
  const animals = new Animals({ tile, scene, flight, veg, atmosphere, camera, identify, game: acorns });
  // The playable squirrel (squirrelControl.js): drives flight.pos and the camera in place of the raven when chosen.
  await w.next('controls');
  const squirrel = new SquirrelControl({ tile, scene, camera, flight, veg, animals, acorns, atmosphere, rocks, caption: $('caption') });
  // The playable acorn woodpecker (woodpeckerControl.js): clinging, hitching and short undulating flights, the same way.
  const woodpecker = new WoodpeckerControl({ tile, scene, camera, flight, veg, animals, acorns, atmosphere, caption: $('caption') });
  // Every other animal (2026-10-26): the walkers (groundControl.js: deer, fox, coyote, lion, rabbits, vole, ground
  // squirrel, lizard, turkey, quail) and the fliers (flierControl.js: hawk, vulture, the jays, on RavenFlight).
  const ground = new GroundControl({ tile, scene, camera, flight, veg, animals, atmosphere, squirrel });
  const flier = new FlierControl({ scene, camera, flight, raven, animals, atmosphere, say: t => ground.say(t) });   // the toast for a strike
  // The spirit (spirit.js): the form the player arrives in; touching an animal puts the player in that body (onBody:
  // the observer, the perception line, the panel's way back), B or the panel button leaves it.
  const nearBar = w.m.nearBar = new NearBar({ el: $('nearBar'), animals });   // the species within reach, in spirit form (nearBar.js)
  const needs = w.m.needs = new Needs({ tile, el: $('needs'), season: seasonNow });   // hunger and thirst in a walker (needs.js)
  // The plant under a feeding body (needs.js names it): the nearest herb within 1.5 m of the body's foods, else a food shrub
  // of the near set within 3 m, else the grass under it when a food grass grows there (the leading species of the sward).
  needs.plantName = id => SPECIES[id]?.common || id.replace(/_/g, ' ');
  needs.plantHere = (x, north, ids) => {
    const f = forbs.nearest(x, -north, 1.5, ids); if (f) return f.species;
    const em = emergents.nearest(x, -north, 1.5, ids); if (em) return em.species;
    let best = null, bd = 9;
    for (const q of veg.nearPlants) { if (!ids.has(q.species)) continue; const d = Math.hypot(q.x - x, q.z + north) - 0.5 * (q.radius || 1); if (d < 3 && d < bd) { bd = d; best = q.species; } }
    if (best) return best;
    const g = grass.speciesAt(x, north); if (!g) return null;
    if (ids.has(g.id)) return g.id;
    for (const id of g.ids) if (ids.has(id)) return id;
    return null;
  };
  ground.needs = needs; flier.needs = needs;
  const hunt = w.m.hunt = new Hunt({ tile, animals, flight, ground, needs, el: $('hunt') });   // the hunt loop's goal and arc (hunt.js)
  const scent = w.m.scent = new Scent({ tile, animals, flight, ground, flier, scene, camera, squirrel, labels: $('scentLabels') });   // the smell sense: wisps round the head toward each scent (scent.js); the squirrel's own control smells too
  hunt.scent = scent;   // the hunt panel's "scented" state (hunt.js)
  const sight = w.m.sight = new Sight({ tile, animals, flight, veg, scene, camera, ground });   // the predators and prey the player has in sight, and those that see the player, lit in their rarity colour (sight.js)
  const cues = w.m.cues = new SoundCues({ tile, animals, flight, camera, el: $('soundCues') });   // ring waves on the screen where a predator or prey is heard (soundCues.js)
  hunt.sight = sight;   // the hunt panel's "spotted" and "it sees you" (hunt.js)
  needs.onStarve = () => { ground.say('starved: the body lies down and the spirit leaves it'); setTimeout(() => { if (ground.on || flier.on) toSpirit(); }, 2200); };
  const onBody = (code, sex = null) => {
    window.__we.playerSpecies = code; window.__we.playerSex = sex;
    animals.setObserver(code); showPerceives(code);
    $('spiritBtn').hidden = code === 'spirit'; $('nearBar').hidden = code !== 'spirit';
    needs.setSpecies(code); hunt.setSpecies(code); setBodyScale(code);
  };
  const spirit = w.m.spirit = new SpiritControl({ scene, renderer, camera, flight, raven, animals, squirrel, woodpecker, ground, flier, atmosphere, onBody });
  $('spiritBtn').onclick = () => { spirit.leave(); renderer.domElement.focus?.(); };
  const toSpirit = () => { squirrel.setOn(false); woodpecker.setOn(false); ground.setOn(false); flier.setOn(false); spirit.setOn(true); onBody('spirit'); };
  // The body's row (abilities.js): its status bars and its abilities, one slot each with its key, along the bottom right.
  const abilities = w.m.abilities = new Abilities({ el: $('abilities'), legs: $('legs'), bar: $('bodyBar'), squirrel, woodpecker, ground, flier, spirit, flight, needs, hunt, scent });

  // Present-day peek (hold P, or the panel button): the ground shows today's NAIP with the human
  // footprint still in it, the forest and grass step aside and the ghost roads come on, so a player
  // can see the parking lot they know at the exact spot they are flying over. The swap happens just
  // after a frame is rendered: that frame is copied to an overlay canvas which then fades out over
  // 300 ms, a screen-space cross-fade (terrain.setTexture has one map, so the shader cannot blend).
  const fade = document.createElement('canvas'); fade.id = 'peekFade'; renderer.domElement.after(fade);
  async function setPeek(on) {
    if (on === peek.want) return;
    peek.want = on; $('peekBtn').classList.toggle('on', on);
    if (!on && !peek.shown) $('peekBanner').classList.add('hidden');   // released while loading
    if (on && !peek.present) {
      $('peekBanner').textContent = 'present day · loading…'; $('peekBanner').classList.remove('hidden');
      peek.present = await loadPresentTexture(tile);
      if (!peek.present) { $('peekBanner').textContent = 'no present-day imagery in this tile'; return; }
    }
    peek.pending = peek.want;   // frame() applies it right after the next render
  }
  function applyPeek(on) {
    peek.shown = on;
    for (const o of [veg, far, grass, animals]) o.group.visible = !on;
    identify.hidden = on; identify.tagGroup.visible = identify.shown();
    acorns.group.visible = !on && acorns.running;
    if (on) { peek.roadsWere = roads.group.visible; roads.group.visible = true; } else roads.group.visible = peek.roadsWere;
    if (on) {
      terrain.setTexture(peek.present.image);
      // Season recolour off without touching terrain.js: in imagery mode the shader multiplies by
      // grassTint / grassRef (normalised) and by oakTint / oakRef times oakMix, so equal tint and ref
      // and oakMix 0 leave the photo's colour as it is. frame() skips setLook while peeking.
      terrain.setImagery(true, null);
      const u = terrain.uniforms; u.grassTint.value.setRGB(u.grassRef.value.x, u.grassRef.value.y, u.grassRef.value.z); u.oakMix.value = 0;
    } else setTexture(texKind);
    minimap.setPeek(on);
    $('peekBanner').textContent = `present day · ${peek.present?.year || 2022} imagery`;
    $('peekBanner').classList.toggle('hidden', !on);
  }
  function crossFade() {
    const c = renderer.domElement;
    if (fade.width !== c.width || fade.height !== c.height) { fade.width = c.width; fade.height = c.height; }
    fade.getContext('2d').drawImage(c, 0, 0);   // same task as the render, so the drawing buffer is intact
    fade.getAnimations().forEach(a => a.cancel());
    fade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-in-out' });
  }
  const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  addEventListener('keydown', e => { if (e.code === 'KeyP' && !e.repeat && !typing(e)) setPeek(true); });
  addEventListener('keyup', e => { if (e.code === 'KeyP') setPeek(false); });
  addEventListener('blur', () => setPeek(false));   // a keyup or pointerup lost to another window
  // mouse or pen: pressed while held; touch: a tap toggles
  $('peekBtn').addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.pointerType === 'touch') { setPeek(!peek.want); return; }
    setPeek(true);
    const up = () => { setPeek(false); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
  $('peekBtn').addEventListener('click', e => { if (e.detail === 0) setPeek(!peek.want); });   // keyboard activation toggles

  // Soundscape (sound.js): starts on the first click or key; N mutes, C calls. Behind the opening
  // screen it is made at Begin and started by that press, so choosing cards stays quiet.
  let sound = null;
  const makeSound = () => {
    if (!sound) { sound = w.m.sound = new Soundscape({ tile, flight, raven, camera, els: { button: $('soundBtn'), volume: $('soundVol') } }); window.__we.sound = sound; weather.onThunder = (d, k) => sound.thunder(d, k); }
    return sound;
  };

  // tests and comparisons: __we.setDate('01-15') shows that day's measured colour ('' for today)
  // a declaration (hoisted): the season select's handler, set above, can run while the build still awaits (?skip=1)
  function setDate(str) { fixedDate = parseDate(str); fixedDateStr = fixedDate ? str : null; state.season = 'auto'; $('season').value = 'auto'; applySeason(); return terrain.seasonStats; }
  const setFov = deg => { const v = Math.min(LENS_RANGE[1], Math.max(LENS_RANGE[0], +deg || LENS_DEFAULT)); camera.fov = v; camera.updateProjectionMatrix(); return v; };
  const setHour = h => { state.hour = +h; $('time').value = state.hour; return state.hour; };
  animals.weatherTemp = () => (weather.day ? weather.fx.temp : null);   // the lizards' air (animals.js airT)
  w.handle = window.__we = { setDate, setFov, setHour, weather, tile, flight, raven, camera, veg, terrain, far, grass, forbs, emergents, roads, scene, renderer, minimap, atmosphere, sky, acorns, identify, places, peek, setPeek, sound, animals, arrival, rocks, water, waterfalls: water.waterfalls, squirrel, woodpecker, ground, flier, spirit, credits, sight, cues };   // debugging handle
  const as = direct ? params.get('as') : null;
  if (!['raven', 'squirrel', 'woodpecker'].includes(as)) toSpirit();   // a spirit from the start (behind the opening screen too)
  if (!screenOpen) makeSound();

  // Into the world: season, observer, sound, then the arrival flight over the chosen point.
  const captionFor = (point, season) => {
    const near = places.nearest(point?.x ?? tile.size / 2, point?.north ?? tile.size / 2);
    return `${near ? `${near.over ? 'over' : 'near'} ${near.name}` : tile.id} · ${season} · spirit`;
  };
  // c: the opening screen's { tileId, season, date ('MM-DD', or null for today), point, caption }, or a tile switch's
  // arrival { season, date, point }. Older fields (species, sex) are ignored: everyone arrives as the spirit.
  const enterWorld = (c, gesture) => {   // armed as w.enter once the world is ready (below), not while it compiles
    w.commit();   // from here this world is the page's: its listeners and HUD nodes stay
    rememberTile(tile.id);
    if (c.date && parseDate(c.date)) setDate(c.date);   // that day's look, the season tracking it
    else if (c.season) { state.season = c.season === seasonOfDate() ? 'auto' : c.season; $('season').value = state.season; applySeason(); }
    toSpirit();
    const snd = makeSound();
    if (gesture) {
      snd.start();   // inside the Begin click when the world was ready; otherwise the press already activated the page
      if (snd.ctx?.state === 'suspended') {   // a stricter browser: resume on the next press
        const kick = () => { removeEventListener('pointerdown', kick, true); removeEventListener('keydown', kick, true); if (!snd.muted) snd.ctx.resume(); };
        addEventListener('pointerdown', kick, true); addEventListener('keydown', kick, true);
      }
    }
    arrival.plan(c.point);   // the wisp flies the arrival as the raven did
    arrival.onDone = () => { html.classList.remove('arriving'); };
    arrival.start(c.caption || captionFor(c.point, seasonNow()));
    html.classList.add('arriving'); html.classList.remove('opening'); html.classList.remove('switching');
    closeScreen();
  };
  const known = new WeakSet(), used = new WeakSet(), drawable = o => o.isMesh || o.isPoints || o.isLine || o.isSprite;   // meshes compiled ahead (below)
  // The rock plans around the bird (rocks.js warm), made in slices so the first frame's rock fill only places them.
  await w.next('rocks.warm');
  await w.sliced(rocks.warm(flight.pos.x, flight.pos.z), 'rocks');
  // Behind the opening screen the bird holds still, so the first frame's streaming (the fine terrain square, the far
  // impostor rebuild, the rock sets, the grass pools) is done here, a step per task, in the frame's own order; the
  // first frames then find it done (the same calls, at the same place) and only draw.
  if (screenOpen) {
    await w.next('warm');
    arrival.hold(); camera.updateMatrixWorld();
    terrain.update(flight.pos.x, flight.pos.z); veg.update(flight.pos.x, flight.pos.z); veg.updateClose(camera.position); await w.wait(yieldToMain());
    far.update(camera, veg.radius); await w.wait(yieldToMain());
    grass.update(flight.pos.x, flight.pos.z, 0, camera, SEASON_LOOK[seasonNow()]); await w.wait(yieldToMain());
    rocks.update(camera); await w.wait(yieldToMain());
  }
  // Shader programs, compiled before the first frame instead of inside it (the first render compiled every program of
  // the world in one task of seconds): each mesh through renderer.compileAsync, a slice at a time, so the driver
  // compiles them in parallel while the opening screen keeps responding; then the textures are uploaded, one per
  // task. The first frame then only draws.
  await w.next('compile');
  status('compiling shaders…');
  {
    // pending: the programs the first frames draw with (meshes shown now), waited for; the rest (hidden tiers, the
    // close canopies, ...) finish compiling in the background, well before they are first drawn.
    const tick = slicer(), pending = [], objs = [];
    const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    scene.updateMatrixWorld();
    scene.traverse(o => { if (drawable(o)) { known.add(o); objs.push(o); } });
    for (const o of objs) { const p = renderer.compileAsync(o, camera, scene); if (shown(o)) pending.push(p); if (tick.due()) await w.wait(tick.yield()); }
    pending.push(...await w.wait(shadows.precompile(tick, known)));
    pending.push(...grass.precompileBake(renderer));
    const post = spirit.view?.post;   // the spirit's look: its full-screen pass (spirit.js), drawn to the screen
    if (post?.scene) pending.push(renderer.compileAsync(post.scene, post.cam));
    const cb = atmosphere.cloudBake;
    if (cb?.scene && cb.camera && cb.targets) { const prev = renderer.getRenderTarget(); renderer.setRenderTarget(cb.targets[0]); pending.push(renderer.compileAsync(cb.scene, cb.camera)); renderer.setRenderTarget(prev); }
    await w.next('textures');
    await w.sliced(far.uploadSteps(renderer), 'impostor atlases');   // in bands (gpuUpload.js); the rest one per task
    const textures = new Set();
    scene.traverse(o => { for (const m of [o.material].flat()) if (m) for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      for (const m of [o.material].flat()) if (m?.uniforms) for (const u of Object.values(m.uniforms)) for (const v of [u?.value].flat()) if (v?.isTexture && !v.isRenderTargetTexture) textures.add(v); });
    for (const t of textures) { if (t.image || t.mipmaps?.length) renderer.initTexture(t); await w.wait(yieldToMain()); }
    await w.next('compile.wait');
    await w.wait(Promise.all(pending));
    // A program's first use reads its link status, logs and uniform and attribute locations (three's onFirstUse,
    // a millisecond or so each): done here for the programs that are ready, a slice at a time, not in the first render.
    for (const p of renderer.info.programs) { if (p.isReady()) { p.getUniforms(); p.getAttributes(); used.add(p); } if (tick.due()) await w.wait(tick.yield()); }
    // The first draw of a mesh uploads its buffers and textures (the forest's instance buffers are tens of MB): each
    // part of the scene goes through one render here with nothing drawn (every instance and draw count of it 0, the
    // rest of the scene hidden; all put back at once, in the same task), a part per task, so three uploads what it
    // would draw without the first frame uploading it all in one task, and without any GPU work but the uploads.
    await w.next('upload');
    const units = [], split = g => g.children.length > 8 && !g.isMesh;
    const add = o => { if (split(o)) for (const c of o.children) add(c); else units.push(o); };
    for (const c of scene.children) add(c);
    const vp = renderer.getViewport(new THREE.Vector4()), sc = renderer.getScissor(new THREE.Vector4()), st = renderer.getScissorTest();
    const ready = async u => {   // the unit's programs compiled (as the state now asks) and first-used before its render
      await w.wait(renderer.compileAsync(u, camera, scene));
      const progs = new Set();
      u.traverse(o => { for (const x of [o.material].flat()) { const p = x && renderer.properties.get(x).currentProgram; if (p) progs.add(p); } });
      for (const p of progs) {
        while (!p.isReady()) await w.wait(new Promise(r => setTimeout(r, 16)));
        if (!used.has(p)) { p.getUniforms(); p.getAttributes(); used.add(p); if (tick.due()) await w.wait(tick.yield()); }
      }
    };
    for (const u of units) {
      if (!u.visible) continue;
      await ready(u);
      const hidden = []; for (const o of units) if (o !== u && o.visible) { o.visible = false; hidden.push(o); }
      const counts = [], geos = new Map();
      u.traverse(o => {
        if (!drawable(o)) return;
        if (o.isInstancedMesh) { counts.push([o, o.count]); o.count = 0; }
        const g = o.geometry; if (!g || geos.has(g)) return;
        geos.set(g, [g.instanceCount, g.drawRange.count]); if (g.isInstancedBufferGeometry) g.instanceCount = 0; g.drawRange.count = 0;
      });
      renderer.setViewport(0, 0, 1, 1); renderer.setScissor(0, 0, 1, 1); renderer.setScissorTest(true);
      try { renderer.render(scene, camera); } finally {
        renderer.setViewport(vp); renderer.setScissor(sc); renderer.setScissorTest(st);
        for (const [o, n] of counts) o.count = n;
        for (const [g, [ic, dc]] of geos) { if (g.isInstancedBufferGeometry) g.instanceCount = ic; g.drawRange.count = dc; }
        for (const o of hidden) o.visible = true;
      }
      await w.wait(yieldToMain());
    }
  }
  // The tile images' off-thread decodes (tilepackage.js) have been read: freed. Later readers draw the image itself.
  closeBitmaps(tile);
  phase('compiled');
  w.enter = enterWorld; w.ready = true;
  status('');
  phase('ready');
  if (as === 'squirrel') {   // tests: ?skip=1&as=squirrel puts a squirrel by the oak nearest the centre
    onBody('sciurus_griseus');
    squirrel.setOn(true); squirrel.arrive(pending ? localXY(tile, pending.lat, pending.lon) : null, null);
  } else if (as === 'woodpecker') {   // tests: ?skip=1&as=woodpecker[&sex=female] puts a woodpecker on the granary nearest the centre
    const sex = params.get('sex') === 'female' ? 'female' : 'male';
    onBody('melanerpes_formicivorus', sex);
    woodpecker.setOn(true, sex); woodpecker.arrive(pending ? localXY(tile, pending.lat, pending.lon) : null, null);
  } else if (as === 'raven') onBody('corvus_corax');   // tests: the old start, the raven at the tile centre, flying
  else if (SHORT[as]) {   // tests: ?skip=1&as=deer (fox, coyote, lion, rabbit, jackrabbit, vole, groundsquirrel, lizard, turkey, quail, scrubjay, stellers, hawk, vulture): into the one nearest the centre
    const p = pending ? localXY(tile, pending.lat, pending.lon) : null;
    playAs(as, { animals, spirit, x: p?.x ?? tile.size / 2, z: -(p?.north ?? tile.size / 2) });
  }
  else if (direct) { const p = pending ? localXY(tile, pending.lat, pending.lon) : null; if (p) flight.reset(p.x, -p.north, 150); }   // a spirit, flying, at ?lat=&lon= or the centre
  else if (arrive) enterWorld({ season: arrive.season, date: arrive.date, point: arrivePoint }, false);

  let last = performance.now(), hudT = 0, heldAt = 0;
  // Behind the opening screen, meshes that appear after the build (the rock sets of the first fill, animal models as
  // they load, their shadow casters) are compiled with compileAsync before they are first drawn: while any is still
  // compiling, the frame updates the world but does not render it (nobody sees it), instead of stalling on the
  // compile inside the render. Once the screen is gone the frame always renders, as before.
  // A program's first use (three's onFirstUse: link status, logs, uniform and attribute locations, a millisecond or more
  // each) is done for every ready program before the frame draws, a few milliseconds of it per frame; while any is
  // left, or still compiling, the frame behind the screen does not draw.
  const firstUse = () => {
    const t0 = performance.now();
    for (const p of renderer.info.programs) {
      if (used.has(p)) continue;
      if (!p.isReady() || performance.now() - t0 > 8) return false;
      p.getUniforms(); p.getAttributes(); used.add(p);
    }
    return true;
  };
  let compiling = null;
  const compileNew = () => {   // a promise while new programs compile, else null
    const ps = [];
    scene.traverse(o => { if (drawable(o) && !known.has(o)) { known.add(o); ps.push(renderer.compileAsync(o, camera, scene)); } });
    ps.push(...shadows.compileNew(known));
    if (!ps.length) return null;
    return Promise.race([Promise.all(ps), new Promise(r => setTimeout(r, 3000))]).then(() => { compiling = null; });   // never hold the frames for long
  };
  let frameN = 0;
  const readyAt = performance.now();
  function frame(now) {
    if (w.dead) return;   // torn down (an abandoned build behind the screen): its loop ends here
    if (screenOpen) {   // behind the opening screen: a few frames a second, enough to stream the world in and compile shaders
      if (now - heldAt < 150) { requestAnimationFrame(frame); return; }
      heldAt = now;
    }
    if (frameN < 3) phase(`frame${frameN}`); frameN++;   // the first frames, marked (as the build's phases)
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    const s = seasonNow(), look = SEASON_LOOK[s], sun = sunDirection(tile.latitude, s, state.hour);
    const f = screenOpen ? arrival.hold() : squirrel.on ? squirrel.update(dt) : woodpecker.on ? woodpecker.update(dt) : ground.on ? ground.update(dt) : flier.on ? flier.update(dt) : arrival.active ? arrival.update(dt) : spirit.on ? spirit.update(dt) : flight.update(dt);
    if (ground.on || flier.on) { needs.update(dt, { x: flight.pos.x, north: -flight.pos.z, acting: ground.on && ground.actT > 0, wet: ground.on && !!ground.wet }); hunt.update(dt); scent.update(dt); }   // the games of life (needs.js, hunt.js); the smell sense (scent.js)
    else if (squirrel.on && !arrival.active) scent.update(dt);   // the gray squirrel's own control smells too (its game is the acorns, not the needs)
    if (ground.on || flier.on || (squirrel.on && !arrival.active)) { sight.update(dt); cues.update(dt); } else { sight.clear(); cues.clear(); }   // the eyes and the ears (sight.js, soundCues.js)
    spirit.blendCamera(dt);   // across a switch of body: drawn from a blend of the old view and the new control's (spirit.js)
    raven.update(dt, flight.flapping, flight.speed);
    spirit.draw(dt);   // the wisp, while a spirit
    terrain.update(flight.pos.x, flight.pos.z);   // the near fine mesh follows the player
    veg.update(flight.pos.x, flight.pos.z);
    veg.updateClose(camera.position);
    const wx = weather.update(dt, state.hour);   // the measured weather first: wind, ground, rain or snow; then the air
    atmosphere.update(dt, sun, look, s, state.hour, camera, wx);
    spirit.look(dt);   // the spirit's view: faint blue light, blue-green mist, the bodies it can join warm (spirit.js)
    atmosphere.applyWeatherHaze();   // the rain's, snow's and fog's extinction (after the look: see atmosphere.js)
    sky.update(camera);
    far.update(camera, veg.radius);
    grass.update(flight.pos.x, flight.pos.z, dt, camera, look);
    forbs.update(camera, look);
    emergents.update(camera, look);
    water.update(dt, look);
    rocks.update(camera);
    litter.update(dt, camera, flight.pos);
    acorns.update(dt, camera, s);
    animals.update(dt, s, state.hour);
    if (!peek.shown) terrain.setLook(look);
    // behind the screen, and for the first 2 s of a direct start (no screen: a few dark frames instead of a long one)
    const gated = screenOpen || now - readyAt < 2000;
    const draw = !gated || (!(compiling ||= compileNew()) && firstUse());
    if (draw) shadows.update(camera);
    if (draw) spirit.render(renderer, scene, camera);   // renderer.render, plus the spirit's view's passes while it is on
    spirit.unblendCamera();   // the control's own camera back for its next frame
    sound?.update(dt, { season: s, hour: state.hour, sunElevation: sun.elevation, weather: wx });
    if (peek.pending !== null) { if (peek.pending !== peek.shown) { crossFade(); applyPeek(peek.pending); } peek.pending = null; }
    minimap.update(flight.pos, f.heading);
    abilities.update(!screenOpen);   // the abilities' slots lit by the keys held and the body's state (abilities.js)
    hudT += dt;
    if (hudT > 0.15) {
      hudT = 0;
      $('hoverBtn').classList.toggle('on', !!f.hover); $('hoverBtn').textContent = f.hover ? 'Resume flight' : 'Hover';
      $('agl').textContent = `${f.agl.toFixed(0)} m`; $('elev').textContent = `${f.elev.toFixed(0)} m`;
      $('speed').textContent = `${f.speed.toFixed(1)} m/s`; $('heading').textContent = `${f.heading.toFixed(0)}°`;
      $('habitat').textContent = HABITAT_NAMES[tile.habitat.at(flight.pos.x, -flight.pos.z)] || '–';
      $('trees').textContent = peek.shown ? 'hidden (present day)' : `${veg.count.toLocaleString()} near · ${far.count.toLocaleString()} far`;
      identify.tick(now);
      const where = places.describe(flight.pos.x, -flight.pos.z);
      $('soundNow').textContent = sound ? sound.describe() : '–';
      const wd = weather.describe(), wb = $('weatherNow');
      if (wd) { const i = document.createElement('i'); i.textContent = ` · ${wd.note}`; wb.replaceChildren(wd.text, i); } else wb.textContent = '–';
      $('animalsNear').textContent = animals.describe(now);
      nearBar.update(animals.counts, spirit.on);
      $('over').textContent = where.text; minimap.place = where.place;
      layoutHud();
      const h = Math.floor(state.hour), mnt = Math.round((state.hour - h) * 60); $('timeLabel').textContent = `${h}:${String(mnt).padStart(2, '0')} · sun ${(sun.elevation * 180 / Math.PI).toFixed(0)}°`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(e => { console.error(e); $('status').textContent = 'error: ' + e.message; $('status').classList.remove('hidden'); });
