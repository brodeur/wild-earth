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
import { Forage } from './forage.js';
import { Fruit } from './fruit.js';
import { Dig } from './dig.js';
import { Carrion } from './carrion.js';
import { Sight } from './sight.js';
import { Quarry } from './quarry.js';
import { Dive } from './dive.js';
import { Combat } from './combat.js';
import { Pilot } from './pilot.js';
import { SniffWave } from './sniffWave.js';
import { SoundCues } from './soundCues.js';
import { OpeningScreen, Arrival, lastTile, rememberTile } from './arrival.js';
import { TitleScreen } from './title.js';
import { Multiplayer } from './multiplayer.js';
import { SEASON_LOOK, seasonOfDate, sunDirection, dateForSeason, parseDate, setSeasonMonths } from './season.js';
import { AcornGame } from './acorns.js';
import { Identify, habitatLabel } from './identify.js';
import { PlaceNames } from './placenames.js';
import { Soundscape } from './sound.js';
import { Shadows, forgetQueuedCasters } from './shadows.js';
import { Animals } from './animals.js';
import { Water } from './water.js';
import { Rocks } from './rocks.js';
import { SquirrelControl } from './squirrelControl.js';
import { WoodpeckerControl } from './woodpeckerControl.js';
import { SpiritControl } from './spirit.js';
import { RemotePlayers } from './players.js';
import { AnimalNet, PG } from './animalNet.js';
import { bodySample } from './bodySample.js';
import { GroundControl, GROUND } from './groundControl.js';
import { planJoin } from './joinSpawn.js';
import { FlierControl, FLIERS } from './flierControl.js';
import { SHORT, playAs, registerStandIns, bodyKind } from './playable.js';
import { setupCredits } from './credits.js';
import { Weather } from './weather.js';
import { fieldGuide } from './fieldguide.js';
import { runSliced, yieldToMain, slicer, sliceStats } from './slice.js';
import { uniforms as atmo } from './atmosphere.js';
import { groundUniforms } from './terrain.js';
import { detailUniforms } from './groundDetail.js';
import { setBodyScale } from './bodyScale.js';
import { Litter } from './litter.js';
import { CloseLife } from './closeLife.js';
import { Abilities } from './abilities.js';

const $ = id => document.getElementById(id);
const html = document.documentElement;
let screen = null, screenOpen = false;   // the opening screen (arrival.js) while it is up
// HUD layout for the window's size (index.html, html.narrow): under 1200 x 760 px the HUD, game box and mini-map shrink.
// The game box stays centred when it clears the controls row and the HUD (the data panel, right, under the mini-map),
// else it moves into the gap between them, else under the controls row; the HUD stops above the body's row (and
// scrolls), the help line wraps before the mini-map and the species card sits above the help line. The body's row
// (abilities.js #bodyBar, bottom right, in place of the help line) rises over the nearby-animals bar when the two would
// meet; the hunt panel and the walkers' toast stand on it, the HUD and the species card stop above it. Run on resize
// and with the HUD's text updates. The old right-hand panel is in Settings now (#settings, which caps itself).
function layoutHud() {
  document.documentElement.style.setProperty('--mapH', `${$('minimap')?.offsetHeight || 0}px`);   // the HUD sits under the mini-map, top right (index.html #hud)
  const W = innerWidth, H = innerHeight;
  html.classList.toggle('narrow', W < 1200 || H < 760);
  const box = id => $(id).getBoundingClientRect(), pan = $('hud'), cs = getComputedStyle(pan);
  // the HUD under the mini-map (top right) scrolls within the window; the key line (bottom left) runs to the window's
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
  const floor = Math.min(H - 12, rowTop - 10, hn && !hn.hidden ? hn.getBoundingClientRect().top - 10 : H);   // the HUD stops above the row and the hunt's lines
  pan.style.maxHeight = `${Math.max(120, Math.floor(floor - pan.getBoundingClientRect().top - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)))}px`;
  help.style.maxWidth = `${Math.max(200, Math.floor(W - 14 - help.getBoundingClientRect().left - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight)))}px`;
  help.style.bottom = bar && !bar.hidden ? `${12 + bar.offsetHeight + 10}px` : '';
  const under = help.getClientRects().length ? help.getBoundingClientRect().top : rr && rr.left < 14 + 320 + 10 ? rowTop : H - 4;   // the help line, else the row where it reaches the card
  $('speciesCard').style.bottom = `${Math.max(12, Math.round(H - under + 8))}px`;
  const g = $('game'); if (g.classList.contains('hidden')) return;
  g.style.left = g.style.top = g.style.transform = '';   // centred, as styled
  const ctl = box('ctlRow'), pr = pan.getBoundingClientRect(), mr = $('minimap')?.getBoundingClientRect() || { width: 0 }, gr = g.getBoundingClientRect();
  const lo = Math.max(ctl.right, $('social')?.getBoundingClientRect().right || 0) + 10, hi = Math.min(pr.left, mr.width ? mr.left : W) - 10;
  if (gr.left >= lo && gr.right <= hi) return;
  g.style.transform = 'none';
  if (hi - lo >= gr.width) g.style.left = `${Math.round(Math.min(Math.max(W / 2 - gr.width / 2, lo), hi - gr.width))}px`;
  else { g.style.left = `${Math.round(ctl.left)}px`; g.style.top = `${Math.round(ctl.bottom + 8)}px`; }
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
  w.record = recs => {   // the screen's own nodes are never the world's (a title made again over it by Exit, too), nor
    // a node marked data-we-page (the page's own overlays: a group follow's veil, which stands across the switch)
    for (const r of recs) {
      if (root && (r.target === root || root.contains(r.target))) continue;
      for (const n of r.addedNodes) if (n.nodeType === 1 && n !== root && !n.hasAttribute('data-we-page')) w.nodes.add(n);
      for (const n of r.removedNodes) w.nodes.delete(n);
    }
  };
  w.observer = new MutationObserver(w.record);
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
  w.next = async name => { phase(name); if (screenOpen && !w.dead) screen?.setProgress?.(w.tileId, name); if (!w.dead) mp?.step?.(w.tileId, name); await w.wait(yieldToMain()); };   // the home screen's bar follows the steps (title.js), and a follow Join's veil (multiplayer.js)
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
  try { m.anet?.leave?.(); } catch (e) { /* closing */ }   // the shared animals' socket (animalNet.js)
  try { m.sound?.ctx?.close?.(); } catch (e) { /* closing */ }
  if (m.weather) m.weather.onThunder = null;
  m.abilities?.dispose?.();   // the body's row: its slots go, the row hides (abilities.js)
  if (fieldGuide.game === m.acorns) { fieldGuide.game = null; fieldGuide.log = []; fieldGuide.anchor = null; }   // the page's field guide (identify.js attached the game)
  m.players?.dispose?.();  // the other players' wisps, names and marks (players.js; before the spirit: they share its wisp's textures)
  m.spirit?.dispose?.();   // the souls' columns and the leaving wisps (spirit.js, 2026-11-01)
  m.carrion?.dispose?.();   // Scavenge: the carcasses' records, bones and halos (carrion.js; before the dig, whose socket it rides)
  m.dig?.dispose?.();   // the Dig game's tunnels, its socket and the terrain's cut discs (dig.js)
  if (m.animals) { m.animals.releaseFauna(); registerStandIns({}); }   // the tile's own fauna out of animals.js's module tables (installFauna) and its bodies (playable.js): the static cast as it was
  m.water?.dispose?.(); m.shadows?.dispose?.(); m.terrain?.dispose?.(); m.litter?.dispose?.(); m.life?.dispose?.(); m.scent?.dispose?.(); m.forage?.dispose?.(); m.fruit?.dispose?.(); m.sight?.dispose?.(); m.sniffWave?.dispose?.(); m.quarry?.dispose?.(); m.dive?.dispose?.(); m.combat?.dispose?.(); m.pilot?.dispose?.(); m.cues?.dispose?.(); m.grass?.dispose?.(); m.forbs?.dispose?.(); m.emergents?.dispose?.(); m.veg?.dispose?.(); forgetQueuedCasters();
  // then its listeners and the elements it put into the page; the HUD's own words back as the page had them
  w.record(w.observer.takeRecords());
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
let mp = null;   // the multiplayer hookup (multiplayer.js) when the title screen is up: the hub's room follows the world entered
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
// xy: a tile-local { x, north } to arrive at instead (the world built again after a lost context, where the player was).
// extra: { lead } the picker's user id when the switch answers a group's invite (the arrival ends behind them,
// multiplayer.js), with { follow } for a group follow's Join (no arrival flight: put behind them, multiplayer.js), or
// { quiet } for a build that asks no group along (the world built again after a lost context).
// The hub's room is left here and joined again at the new world's entry (enterWorld). Resolves to the world, or null.
async function switchWorld(id, point, params, xy = null, extra = {}) {
  const carry = world?.carry?.() || world?.arrive || {};   // the world's season and day; a build's, before it has them
  html.classList.add('switching'); html.classList.remove('arriving');
  renderer.setClearColor(0x000000, 1); renderer.clear();
  mp?.left();
  let w = null;
  try { w = await replaceWorld(id, { params, pending: point, arrive: { season: carry.season, date: carry.date, point, xy, ...extra } }); }
  catch (e) { console.error(e); $('status').textContent = `error: ${e.message}`; $('status').classList.remove('hidden'); goto.say(`could not load ${id}`, true); return null; }
  if (w) goto.say('');   // it entered itself (buildSteps, arrive)
  return w;
}
// Exit to main screen (the menu under the X): the hub's room is left as a switch leaves it, the world is torn down as a
// second choice on the earth tears one down (disposeWorld), and the title screen is made again over it (openTitle,
// main): the earth rises, the session's sign-in is known, and a place chosen builds a world as at the start. The direct
// paths (?skip=1, ?game=1, ?as=) have no title in the page: they load the page without them.
let openTitle = null;
async function exitToTitle() {
  if (!openTitle) { location.href = location.pathname; return; }
  html.classList.remove('menu', 'arriving', 'switching'); html.classList.add('opening');
  $('status').classList.add('hidden');
  mp?.left();
  gen++; const old = world; world = null;
  if (old && scope === old) scope = null;   // the title's listeners are the page's, not the world's going
  renderer.setClearColor(0x000000, 1); renderer.clear();
  openTitle();
  if (old) { const t = performance.now(), ready = old.ready; await disposeWorld(old, renderer); window.__weDisposed = { tileId: old.tileId, ready, ms: Math.round(performance.now() - t), exit: true }; }
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
  let reselect = null;   // the opening screen's select, for a world built again after a lost context (below)
  if (pending && !tileId) tileId = await builtTileFor(pending);   // null -> loader picks the first tile

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: true });   // stencil: the herd silhouettes mask out the herd's own bodies (herdSilhouette.js)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);
  window.__weRenderer = renderer;   // debugging: GPU memory (renderer.info) with or without a world
  // The WebGL context lost and given back (Chromium loses a process's oldest context once it holds more than sixteen,
  // a lineup page's, another viewer tab's, a bake's, and gives it back when one goes; a GPU reset does the same): three
  // uploads every geometry and texture again on the context it gets back, and a built world has let go of the CPU
  // side of its static ones (gpuRelease.js), so it cannot be drawn again (the first draw threw on a null array, in the
  // shadow pass, and the frame loop died with it). So the frames hold while the context is gone, and when it is back
  // the world is built again in its place: where the player was, with its season and day, as a tile switch builds;
  // behind the opening screen, the chosen card's world is built again behind it.
  renderer.domElement.addEventListener('webglcontextlost', () => {
    if (world) world.lost = true;
    if (!screenOpen) { $('status').textContent = 'the graphics context was lost; waiting for it…'; $('status').classList.remove('hidden'); }
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    const w = world; if (!w) return;
    if (screenOpen) { reselect?.(w.tileId); return; }
    const f = w.m.flight, xy = f ? { x: f.pos.x, north: -f.pos.z } : null;
    switchWorld(w.tileId, null, params, xy, { quiet: true });
  });
  fieldGuide.mount();   // the field guide's card and listeners are the page's (fieldguide.js), mounted before any world
  snapHud();
  // The Location box (goto.js) is the page's too: it flies within the world played, or switches the page to the tile
  // holding the point (switchWorld), at any time, a build under way included.
  goto = setupGoTo({ input: $('gotoInput'), button: $('gotoBtn'), line: $('gotoStatus'),
    current: () => (world?.tile && world.m.flight ? { tile: world.tile, flight: world.m.flight, ready: world.ready } : null),
    switchTile: (id, p) => { switchWorld(id, p, params); } });
  if (pending) $('gotoInput').value = `${pending.lat}, ${pending.lon}`;
  // The menu (owner, 2026-10-27): the HUD and the help line live behind the hamburger top left (index.html #menuBtn,
  // html.menu); open, it is an X with a short menu under it (Aaron, 2026-11-04: "Have a way to exit to the main screen
  // underneath the X, and also a 'Settings' page. Move the current admin panel into that area"): Settings opens the old
  // right-hand panel (#panel, every control as it was) in a card; Exit to main screen leaves the world for the earth
  // (exitToTitle, below). The X closes the menu and Settings with it; Esc closes Settings. Closed on load.
  const setMenu = on => { html.classList.toggle('menu', on); $('menuBtn').setAttribute('aria-expanded', String(on)); if (!on) setSettings(false); };
  const setSettings = on => {
    $('settings').hidden = !on; $('settingsBtn').setAttribute('aria-expanded', String(on));
    if (on) $('settings').querySelector('.st-close').focus({ preventScroll: true }); else if ($('settings').contains(document.activeElement)) renderer.domElement.focus?.();
  };
  $('menuBtn').onclick = () => { setMenu(!html.classList.contains('menu')); renderer.domElement.focus?.(); };
  $('settingsBtn').onclick = () => setSettings($('settings').hidden);
  $('settings').querySelector('.st-close').onclick = () => setSettings(false);
  $('exitBtn').onclick = () => { setMenu(false); exitToTitle(); };
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('settings').hidden) { e.stopImmediatePropagation(); setSettings(false); } }, true);
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
  // tear the world down and build nothing (a place deselected on the home screen: title.js unchoose; and for debugging), as a
  // second choice abandons the first (replaceWorld)
  const dropWorld = window.__weDrop = async () => { gen++; const old = world; world = null; if (old) { if (old.ready) screen?.readyIds?.delete?.(old.tileId); await disposeWorld(old, renderer); } };
  if (!direct) {
    const index = await (await fetch('../tiles/index.json', { cache: 'no-cache' })).json();
    const ids = index.tiles.map(t => t.tile_id);
    if (!ids.includes(tileId)) tileId = ids.includes(lastTile()) ? lastTile() : ids[0];
    if (!tileId) throw new Error('no tiles built');
    if (pending) history.replaceState(null, '', `?tile=${tileId}`);   // never keep the point in the URL
    // a choice abandons the world before it (building, or ready behind the screen)
    let choice = null;
    const select = reselect = async id => {
      choice = null;
      let w = null;
      try { w = await replaceWorld(id, { params, pending, direct }); } catch (e) { console.error(e); screen?.setPrep(id, `error: ${e.message}`); return; }
      if (!w) return;
      screen.setReady(id);
      if (choice?.tileId === id) w.enter(choice, true);   // Begin was pressed while it built
    };
    // The title screen (title.js: the title on stars, the earth with a dot per built tile and the places in view listed
    // by how many players are in each; docs/multiplayer.md, lane 1) stands in for the card screen unless ?cards=1 asks
    // for the cards; both answer the same calls (onSelect, setPrep, setReady, readyIds, point, close). ?hub=stub answers
    // as the hub would (hubStub.js).
    const Screen = params.get('cards') === '1' ? OpeningScreen : TitleScreen;
    if (Screen !== TitleScreen) $('boot')?.remove();   // the card screen has its own dark start (arrival.js .boot); the title fades the boot screen out itself
    // Lanes 3 and 4 (multiplayer.js): the page's hub, the sign-in modal at the title's gate, the friends, the chat and
    // the toggles, mounted on sign-in and kept into the world's HUD; the group's invites, and the tile's room joined at
    // the world's entry (enterWorld) and left on a switch (switchWorld); a Join from a world is a switch with the picker.
    mp = Screen === TitleScreen ? new Multiplayer({ hubParam: params.get('hub') }) : null;
    if (mp) mp.switchTile = (id, xy, lead) => { switchWorld(id, null, params, xy, { lead }); };
    // a group follow's Join (multiplayer.js follow): from the home screen too, which closes (its world, building or
    // ready, is abandoned as a second choice abandons it), and the tile is built and entered as a switch does
    // world: { season, date } the inviter's (the invitation's), entered in place of the joiner's own
    if (mp) mp.followTile = (id, xy, lead, world = {}) => {
      if (screenOpen) closeScreen();
      const extra = { lead, follow: true }; if (world.season) { extra.season = world.season; extra.date = world.date || null; extra.pick = !!world.date; }
      return switchWorld(id, null, params, xy, extra);
    };
    // made again by Exit to main screen (exitToTitle): the same screen, facing the tile last played, signed in still
    openTitle = (first = false) => {
      choice = null;
      screen = new Screen({ root: $('opening'), renderer, index, tileId: first ? tileId : lastTile(), pending: first ? pending : null, hub: mp ? mp.titleHub : params.get('hub'),
        onSelect: id => { select(id); },
        onDeselect: () => { choice = null; dropWorld(); },
        onBegin: c => { choice = c; if (world?.ready && world.tileId === c.tileId) world.enter(c, true); } });
      mp?.attach(screen);
      screenOpen = true;
    };
    openTitle(true);
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
// point, xy } from a tile switch (xy: a tile-local point instead of the lat/lon, the world built again after a lost
// context), entered at once when ready (the screen's Begin, or the direct paths' start, otherwise).
async function buildSteps(w, { params, pending, direct = false, arrive = null }) {
  const status = t => {
    if (w.dead) return;
    mp?.buildStatus?.(w.tileId, t);
    if (screenOpen) { screen.setPrep(w.tileId, t ? `preparing ${w.tileId}: ${t}` : ''); $('status').classList.add('hidden'); return; }
    $('status').textContent = t; $('status').classList.toggle('hidden', !t);
  };
  phase('loadTile');
  const tile = w.tile = await w.wait(loadTile(w.tileId, undefined, { signal: w.abort.signal }));
  setSeasonMonths(tile.manifest?.layers?.['climate.normals']?.season_months ?? null);   // the tile's own seasons (season.js)
  w.tileId = tile.id;   // the loader's choice when none was named (the direct paths without ?tile=)
  phase('afterTile');
  const arrivePoint = arrive?.xy ?? (arrive?.point ? localXY(tile, arrive.point.lat, arrive.point.lon) : null);   // a switch's arrival; null: the centre
  if (arrive && !arrive.lead && !arrive.quiet) mp?.chose(tile.id, arrivePoint);   // a switch to another tile asks the group along (multiplayer.js)
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
  const far = new Impostors(tile, scene); await w.sliced(far.build(renderer), 'impostors');   // the bake renders on this renderer (impostorBake.js)
  await w.next('grass');
  const grass = w.m.grass = new Grass(tile, scene); await w.sliced(grass.build(), 'grass');
  const forbs = w.m.forbs = new Forbs(tile, scene, grass);   // the herbs: poppies, lupines, clover, filaree... within 45 m (forbs.js)
  const emergents = w.m.emergents = new Emergents(tile, scene);   // cattail, tule, the sedges and rushes of the water system's margins (emergents.js)
  await w.next('water');
  const water = w.m.water = new Water(tile, scene); await w.sliced(water.build(), 'water');   // streams, dry beds and ponds by season (water.js)
  await w.next('rocks');
  const rocks = new Rocks(tile, scene, atmosphere);   // outcrops and boulders from the geology and soils rasters (rocks.js)
  const litter = w.m.litter = new Litter(tile, scene, { terrain, atmosphere, veg });   // the body-scaled ring of pebbles, leaves and stems (litter.js)
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
    if (!ms) { setDate(''); mp?.seasonChanged?.('auto'); return; }
    const m = ms[Math.floor(Math.random() * 3)], d = 1 + Math.floor(Math.random() * [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]);
    const day = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    setDate(day); $('season').value = v;
    mp?.seasonChanged?.(v, day);   // the group goes with them (multiplayer.js, group season)
  };
  // A group member's season (multiplayer.js gotSeason, or a follow invitation's): the same day, so the same weather, as the
  // select would set it, with no relay of its own. now(): the season shown, the day fixed (or null) and whether it is today's.
  const seasonCtl = {
    now: () => ({ season: seasonNow(), date: fixedDateStr || null, auto: state.season === 'auto' && !fixedDateStr }),
    set: (season, date = null) => {
      if (season === 'auto' || !season) { setDate(''); return; }
      if (date && parseDate(date)) { setDate(date); $('season').value = season; return; }
      state.season = season; $('season').value = season; applySeason();
    },
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
  // Games always on (2026-11-02, Aaron: "Games, rather than being something you turn on, are always available and
  // playable"): the acorn game starts with the world (the tile's shared world joined on entry), its box hidden until the
  // player carries or caches an acorn in a collector body (acorns.js v5); no Start button. ?game=1 shows the box at once.
  $('gameBtn').hidden = true;
  acorns.start(seasonNow());
  const life = w.m.life = new CloseLife({ scene, veg, atmosphere, acorns });   // the woodpeckers' granaries and the oak galls near the eye (closeLife.js)
  const setGame = on => { if (on) acorns.showBox(); };
  $('hoverBtn').onclick = () => { flight.setHover(!flight.hover); renderer.domElement.focus?.(); };
  if (params.get('game') === '1') setGame(true);

  // Species identification: HUD rows, click a tree for its card, T toggles name tags (identify.js).
  await w.next('identify');
  const identify = new Identify({ veg, grass, forbs, emergents, camera, dom: renderer.domElement, scene, flight, acorns, seasonNow,
    els: { nearest: $('nearestTree'), around: $('aroundYou'), card: $('speciesCard') } });

  // Ambient animals (animals.js): squirrels, acorn woodpeckers, other ravens, deer, filtered by perception.
  // During an acorn game the woodpeckers, squirrels and ravens gather from the game's acorns (game: acorns).
  await w.next('animals');
  const animals = w.m.animals = new Animals({ tile, scene, flight, veg, atmosphere, camera, identify, game: acorns });   // (w.m: disposeWorld takes the tile's stand-in slots out again)
  animals.renderer = renderer;   // (the game trails painted into the ground data texture: animals.js paintTrails)
  registerStandIns(animals.standIns);   // the tile's stand-ins (client/fauna.json) take their kin's walker or flier body (playable.js)
  // The shared animals (animalNet.js, docs/multiplayer.md "Shared animals"): the game socket's animals channel, joined for
  // the tile and season; one page in the world runs the animals for everyone and the rest mirror it. The three channels
  // of the page (the acorn game's, the dig's, this) carry one page id (PG), so the server names one page the AI host of all.
  acorns.net.pg = PG;
  const anet = w.m.anet = new AnimalNet(animals, { pg: PG });
  anet.join(tile.id, seasonNow()); anet.season = seasonNow();
  // The playable squirrel (squirrelControl.js): drives flight.pos and the camera in place of the raven when chosen.
  await w.next('controls');
  const squirrel = new SquirrelControl({ tile, scene, camera, flight, veg, animals, acorns, atmosphere, rocks, caption: $('caption') });
  animals.waterAt = (x, z) => squirrel.waterAt(x, z);   // the water's surface for the swimmers and waders (animals.js surfAt: the otter, the mergansers, the kingfisher's dive)
  // The playable acorn woodpecker (woodpeckerControl.js): clinging, hitching and short undulating flights, the same way.
  const woodpecker = new WoodpeckerControl({ tile, scene, camera, flight, veg, animals, acorns, atmosphere, caption: $('caption') });
  // Every other animal (2026-10-26): the walkers (groundControl.js: deer, fox, coyote, lion, rabbits, vole, ground
  // squirrel, lizard, turkey, quail) and the fliers (flierControl.js: hawk, vulture, the jays, on RavenFlight).
  const ground = new GroundControl({ tile, scene, camera, flight, veg, animals, atmosphere, squirrel });
  const flier = new FlierControl({ scene, camera, flight, raven, animals, atmosphere, say: t => ground.say(t) });   // the toast for a strike
  // The spirit (spirit.js): the form the player arrives in; touching an animal puts the player in that body (onBody:
  // the observer, Settings' way back), B or that button (Settings: Back to spirit form) leaves it.
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
  // The Dig game (dig.js, docs/game-dig.md): the tile's tunnels, chambers, holes and pits, shared through the game
  // server's world for the tile and season; the vole digs and walks them, the coyote digs pits, the AI voles use them.
  const dig = w.m.dig = new Dig({ tile, scene, camera, flight, ground, animals, squirrel, needs, season: seasonNow, forbs, veg, grass });   // forbs, veg, grass: the plants whose roots hang in the tunnels (digRoots.js)
  ground.dig = dig; animals.dig = dig; dig.net.pg = PG;
  const hunt = w.m.hunt = new Hunt({ tile, animals, flight, ground, needs, el: $('hunt') });   // the hunt loop's goal and arc (hunt.js)
  const scent = w.m.scent = new Scent({ tile, animals, flight, ground, flier, scene, camera, squirrel, labels: $('scentLabels') });   // the smell sense: wisps round the head toward each scent (scent.js); the squirrel's own control smells too
  hunt.scent = scent;   // the hunt panel's "scented" state (hunt.js)
  const forage = w.m.forage = new Forage({ tile, needs, forbs, shrubs: grass.shrubs, veg, grass, scene, flight, ground, squirrel, season: seasonNow });   // a forager's food plants glow and give a scent (forage.js)
  scent.plants = forage;
  // the sniff's shockwave: everything edible pulses as a ring runs out from the body, by how much this body wants it (sniffWave.js)
  const sniffWave = w.m.sniffWave = new SniffWave({ tile, scene, camera, animals, forage, scent, flight, season: seasonNow });
  // the fruit on the plants near the body, glowing, for a body that eats it this season (fruit.js)
  const fruit = w.m.fruit = new Fruit({ tile, scene, flight, veg, shrubs: grass.shrubs, ground, season: seasonNow });
  // Scavenge (carrion.js, docs/game-scavenge.md): every kill's carcass decays over a day in stages drawn on the body, smells
  // ("dead animal") and glows for the carrion eaters; shared through the dig channel's socket, so every player sees the same
  // carcass at the same stage. The AI's finding and feeding go through animals.scav.
  const carrion = w.m.carrion = new Carrion({ tile, animals, scene, flight, ground, flier, needs, dig, season: seasonNow, hour: () => state.hour });
  animals.scav = carrion; hunt.carrion = carrion;
  const sight = w.m.sight = new Sight({ tile, animals, flight, veg, scene, camera, ground });   // the predators and prey the player has in sight, and those that see the player, lit in their rarity colour (sight.js)
  const cues = w.m.cues = new SoundCues({ tile, animals, flight, camera, el: $('soundCues') });   // ring waves on the screen where a predator or prey is heard (soundCues.js)
  hunt.sight = sight;   // the hunt panel's "spotted" and "it sees you" (hunt.js)
  // a predator's selected prey (quarry.js: Tab or a click on one in sight, a ring under it) and a hunting bird's dive at it (dive.js)
  const quarry = w.m.quarry = ground.quarry = new Quarry({ animals, sight, camera, scene, dom: renderer.domElement, forage, flight });   // (forage: a plant eater's plant targets)
  const dive = w.m.dive = quarry.dive = flier.dive = new Dive({ animals, flight, flier, sight, quarry, say: s => ground.say(s) });
  hunt.quarry = quarry; identify.claim = (x, y) => quarry.claim(x, y);
  nearBar.onPick = k => quarry.pickSpecies(k);   // a chip: the nearest of that species (and the spirit flies there)
  const combat = w.m.combat = ground.combat = new Combat({ animals, ground, flier, quarry, camera, frame: $('targetFrame'), bar: $('targetBar'), say: s => ground.say(s) });
  let pilot = null;   // (made with the spirit, below)
  needs.onStarve = () => { ground.say('starved: the body lies down and the spirit leaves it'); setTimeout(() => { if (ground.on || flier.on) toSpirit(); }, 2200); };
  // a mirror's catch, confirmed by the host (animals.js request): the body that struck is fed and says so; a miss is said
  animals.onCaught = c => { if (ground.on) ground.caught(c); else if (flier.on) flier.took(c); else { needs.fed?.(); ground.say(`took a ${animals.speciesList()[c.sp]?.one || 'prey'}`); } };
  animals.onMiss = () => ground.say('the catch misses');
  const onBody = (code, sex = null) => {
    window.__we.playerSpecies = code; window.__we.playerSex = sex;
    animals.setObserver(code); acorns.setBody(code); fruit.setBody(code);   // the acorn game: collecting only in a collector body (acorns.js v5)
    $('spiritBtn').hidden = code === 'spirit';
    needs.setSpecies(code); hunt.setSpecies(code); setBodyScale(code); combat.setSpecies(code); pilot?.cancel();
  };
  const spirit = w.m.spirit = new SpiritControl({ scene, renderer, camera, flight, raven, animals, squirrel, woodpecker, ground, flier, atmosphere, onBody });
  $('spiritBtn').onclick = () => { spirit.leave(); renderer.domElement.focus?.(); };
  pilot = w.m.pilot = quarry.pilot = new Pilot({ flight, spirit, animals, quarry, say: s => ground.say(s) });
  // The other players of the group (players.js): their wisps, names, edge marks and map dots from the hub's relayed
  // positions (multiplayer.js feeds them while in the room); nothing to draw on the dev paths with no hub.
  const players = w.m.players = new RemotePlayers({ scene, renderer, camera, flight, animals, minimap, maps: spirit.wisp.maps, marks: $('herdMarks'), labels: $('playerLabels'), nameOf: mp ? id => mp.social?.nameOf(id) || 'someone' : null });
  spirit.setOthers(players);
  const toSpirit = () => { squirrel.setOn(false); woodpecker.setOn(false); ground.setOn(false); flier.setOn(false); spirit.setOn(true); onBody('spirit'); };
  // The body's row (abilities.js): its status bars and its abilities, one slot each with its key, along the bottom right.
  const abilities = w.m.abilities = new Abilities({ el: $('abilities'), legs: $('legs'), bar: $('bodyBar'), squirrel, woodpecker, ground, flier, spirit, flight, needs, hunt, scent, carrion, dive, combat, quarry, pilot });

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
    if (!sound) { sound = w.m.sound = new Soundscape({ tile, flight, raven, camera, els: { button: $('soundBtn'), volume: $('soundVol'), mute: $('muteBtn') } }); window.__we.sound = sound; weather.onThunder = (d, k) => sound.thunder(d, k); }
    return sound;
  };

  // tests and comparisons: __we.setDate('01-15') shows that day's measured colour ('' for today)
  // a declaration (hoisted): the season select's handler, set above, can run while the build still awaits (?skip=1)
  function setDate(str) { fixedDate = parseDate(str); fixedDateStr = fixedDate ? str : null; state.season = 'auto'; $('season').value = 'auto'; applySeason(); return terrain.seasonStats; }
  const setFov = deg => { const v = Math.min(LENS_RANGE[1], Math.max(LENS_RANGE[0], +deg || LENS_DEFAULT)); camera.fov = v; camera.updateProjectionMatrix(); return v; };
  const setHour = h => { state.hour = +h; $('time').value = state.hour; return state.hour; };
  animals.weatherTemp = () => (weather.day ? weather.fx.temp : null);   // the lizards' air (animals.js airT)
  w.handle = window.__we = { setDate, setFov, setHour, weather, tile, flight, raven, camera, veg, terrain, far, grass, forbs, emergents, roads, scene, renderer, minimap, atmosphere, sky, acorns, life, identify, places, peek, setPeek, sound, animals, anet, arrival, rocks, water, waterfalls: water.waterfalls, squirrel, woodpecker, ground, flier, spirit, players, credits, sight, quarry, dive, combat, pilot, nearBar, sniffWave, cues, forage, fruit, needs, dig, carrion };   // debugging handle
  const as = direct ? params.get('as') : null;
  if (!['raven', 'squirrel', 'woodpecker'].includes(as)) toSpirit();   // a spirit from the start (behind the opening screen too)
  if (!screenOpen) makeSound();

  // Into the world: season, observer, sound, then the arrival flight over the chosen point.
  const captionFor = (point, season) => {
    const near = places.nearest(point?.x ?? tile.size / 2, point?.north ?? tile.size / 2);
    return `${near ? `${near.over ? 'over' : 'near'} ${near.name}` : tile.id} · ${season} · spirit`;
  };
  // c: the opening screen's { tileId, season, date ('MM-DD', or null for today), point, caption }, or a tile switch's
  // arrival { season, date, point }. Older fields (species, sex) are ignored: everyone arrives as the spirit, but a Join
  // (c.follow), which comes in as the friend is (joinAs, below). c.lead is
  // the picker's user id when the entry answers a group's invite (multiplayer.js): the arrival turns to end behind them.
  // c.follow: a group follow's Join (multiplayer.js): no arrival flight; the spirit is put at once behind the inviter's
  // planned arrival, and again behind the inviter when their position comes (place, through mp.entered), under the veil.
  const enterWorld = (c, gesture) => {   // armed as w.enter once the world is ready (below), not while it compiles
    w.commit();   // from here this world is the page's: its listeners and HUD nodes stay
    rememberTile(tile.id);
    if (c.date && parseDate(c.date)) { setDate(c.date); if (c.pick && c.season) $('season').value = c.season; }   // that day's look, the season tracking it (pick: a group's chosen season, shown in the select as its own choice is)
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
    // c.body: the body chosen on the home screen (title.js, the rings): taken once the spirit has arrived (takeBody), beside
    // the group member gone with (c.lead: their last relayed pose), else under the arrival's end
    const wantBody = c.body && bodyKind(c.body) ? c.body : null;
    arrival.onDone = () => { html.classList.remove('arriving'); if (wantBody && !c.follow) takeBody(wantBody, c.lead ? mp?.poses?.get(c.lead) : null); };
    // follow: { x, y, z, yaw, ground, lead?, trail? } the inviter's pose (arrival.js plan's follow), or null for behind the
    // planned point; first: the spirit put there before the inviter's pose has come (the body waits for the pose, or the
    // wait's end). With lead (their relayed state) the joiner comes in as they are (joinAs): their species, 5 body lengths
    // behind on their trail, their heading and speed; the spirit above and behind stays only when no spot can hold it.
    // Returns joinAs's plan, or null.
    const place = (follow, first = false) => {
      if (follow?.again) return joinAs(follow.lead, follow.trail || [], true);   // the second placement: only the move
      if (follow?.lead && spirit.body) spirit.leave();   // a Join in the tile while in a body: out of it first
      arrival.plan(follow ? null : c.point, follow, !follow); arrival.start(null); arrival.finish(true);
      if (first) return null;
      const plan = follow?.lead ? joinAs(follow.lead, follow.trail || [], !!follow.again) : null;
      if (!plan && wantBody) takeBody(wantBody, follow);
      return plan;
    };
    if (c.follow) place(null, true);
    else {
      arrival.plan(c.point, null, !!c.lead);   // the wisp flies the arrival as the raven did; a joiner's ends behind and above the one who asked (multiplayer.js turns it to follow them)
      arrival.start(c.caption || captionFor(c.point, seasonNow()));
      html.classList.add('arriving');
    }
    html.classList.remove('opening'); html.classList.remove('switching');
    closeScreen();
    // the hub's room is this tile from here (the tile chat, the group's positions; multiplayer.js): the spirit's position
    // goes to the group at 5 Hz, and a joiner's arrival follows the picker's
    mp?.entered(tile.id, { flight, arrival, players, sound: () => w.m.sound, lead: c.lead || null, follow: !!c.follow, place, kind: bodyKind, season: seasonCtl, form: () => w.handle?.playerSpecies || 'spirit', body: (out, cst) => bodySample(w.handle, out, cst),
      caption: p => { const cap = $('caption'); if (cap && !cap.hidden) cap.querySelector('.cap-text').textContent = captionFor(p, seasonNow()); } });
  };
  // Into a body the home screen chose (Aaron, 2026-11-07, the rings: "Any other group member can click on that same animal
  // and join the tile in that body, right next to their friend"): an animal of that species summoned there and entered as
  // the spirit enters any body (spirit.enter: the camera's blend, the wisp diving in), put exactly: beside `near` (a
  // group member's relayed pose: 2.5 to 6 m off them on the clearest side, facing their way; in the air beside them when
  // both fly, else on the ground), or, alone, a flier where the spirit is (on the wing) and a walker on the ground 25 m ahead
  // of the arrival's end. Resolves to the animal's id, or null (no such species here, or already in a body).
  const takeBody = (code, near = null) => {
    if (!code || spirit.body || !bodyKind(code)) return null;
    const f = flight, air = bodyKind(code) !== 'ground' && bodyKind(code) !== 'squirrel';
    let x, z, yaw, y = null, where = 'ground';
    if (near) {
      yaw = near.yaw || 0;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      // a clear spot beside them, so the body and its camera do not start inside a bush or a trunk: the near plants' crowns
      // (veg.nearPlants, as forage.js reads them) kept 1.2 m off where it can be, right of them first, then left, behind,
      // and a little further out; the nearer and the righter as clear
      const plants = veg.nearPlants || [];
      const room = (px, pz) => { let m = 4; for (const q of plants) { const d = Math.hypot(px - q.x, pz - q.z) - Math.max(0.4, q.crownR || q.height * 0.35); if (d < m) m = d; } return m; };
      let best = -Infinity;
      for (const r of [2.5, 4, 6]) for (const [s, b] of [[1, 0.4], [-1, 0.4], [0.7, -0.7], [-0.7, -0.7], [0, -1], [0.7, 0.7], [-0.7, 0.7]]) {
        const px = near.x + (rx * s - fx * b) * r, pz = near.z + (rz * s - fz * b) * r;
        const sc = Math.min(room(px, pz), 1.2) * 10 - r * 0.4 - (s < 0 ? 0.3 : 0);
        if (sc > best) { best = sc; x = px; z = pz; }
      }
      const g = tile.heights.atXZ(x, z);
      if (air && near.y - tile.heights.atXZ(near.x, near.z) > 3) { y = Math.max(near.y, g + 4); where = 'air'; }
    } else {
      yaw = f.yaw;
      if (air) { x = f.pos.x; z = f.pos.z; y = f.pos.y; where = 'air'; }
      else { x = f.pos.x - Math.sin(yaw) * 25; z = f.pos.z - Math.cos(yaw) * 25; }
    }
    const S = tile.size, M = 30; x = Math.min(S - M, Math.max(M, x)); z = Math.max(-(S - M), Math.min(-M, z));
    const fresh = animals.summon(code, 0, { x, z }) || [];
    let best = null, bd = Infinity;
    for (const a of fresh) { if (animals.codeOf(a) !== code) continue; const dd = (a.x - x) ** 2 + (a.z - z) ** 2; if (dd < bd) { bd = dd; best = a; } }
    if (!best) { console.warn(`takeBody: no ${code} could be summoned`); return null; }
    const at = { x, z, yaw, where, y: y ?? tile.heights.atXZ(x, z) };
    if (where === 'air') Object.assign(at, { speed: 8, pitch: 0 });
    return spirit.enter(best.id, at) ? best.id : null;
  };
  window.__weTakeBody = takeBody;   // debugging
  // An animal of `code` summoned at `at` and entered there as the spirit enters any body (takeBody's end); a species
  // summon cannot make (the hawks: none came), the nearest one living on the tile, entered and put at `at`. Its id or null.
  const takeBodyAt = (code, at) => {
    const near = list => { let b = null, bd = Infinity; for (const a of list) { if (animals.codeOf(a) !== code || a.remote || a.dead || (animals.alive && !animals.alive(a))) continue; const dd = (a.x - at.x) ** 2 + (a.z - at.z) ** 2; if (dd < bd) { bd = dd; b = a; } } return b; };
    const best = near(animals.summon(code, 0, { x: at.x, z: at.z }) || []) || near(animals.list);
    if (!best) { console.warn(`joinAs: no ${code} on this tile`); return null; }
    return spirit.enter(best.id, at) ? best.id : null;
  };
  // Join as the friend is (Aaron, 2026-11-08; joinSpawn.js, docs/multiplayer.md "Join as the friend is"): can the body
  // stand at (x, y, z)? where 'air': clear of the ground, the water and the near plants' crowns by a margin; 'ground': on
  // the tile, not in water deeper than it wades (a swimmer that came from the water: in water), not on a cliff (slope over
  // 45 degrees) or a rock top taller than it jumps, not in a trunk. Returns { y, wet } or null.
  const joinTest = (where, x, y, z, o) => {
    const M = 30, S = tile.size;
    if (!(x > M && x < S - M && -z > M && -z < S - M)) return null;
    const sq = squirrel, g = tile.heights.atXZ(x, z), plants = veg.nearPlants || [];
    if (where === 'air') {
      const Fa = sq.footing(x, z, y + 0.5), floor = Math.max(g, Fa.y, Fa.surf ?? -Infinity);
      if (y < floor + 1.5) return null;
      for (const p of plants) if (y < p.y + (p.height || 0) + 0.5 && Math.hypot(x - p.x, z - p.z) < Math.max(0.5, p.crownR || 0) + 0.5) return null;
      return { y, wet: false };
    }
    const Fg = sq.footing(x, z, g + 60), deep = Fg.surf != null ? Fg.surf - Fg.bed : 0, wet = deep > 0.3, Sg = GROUND[o.code];
    if (o.probe) return { y: Fg.y, wet };
    if (o.swimmer) { if (o.water && !wet) return null; } else if (deep > (Sg?.wade ?? 0.1)) return null;
    const d = 0.75, h = (a, b) => tile.heights.atXZ(a, b);
    if (Math.hypot(h(x + d, z) - h(x - d, z), h(x, z + d) - h(x, z - d)) / (2 * d) > 1) return null;
    if (Fg.y - g > Math.max(0.6, Sg?.jumpH ?? 0.5)) return null;
    const rad = (Sg?.rad ?? 0.15) * (o.size || 1);
    for (const p of plants) if (Math.hypot(x - p.x, z - p.z) < (p.trunkR || 0.12) * 1.3 + rad + 0.15) return null;
    return { y: Fg.surf != null ? Fg.bed : Fg.y, wet };
  };
  // lead: the friend's relayed pos with `at` (when it came); trail: their recent points (multiplayer.js). The near set
  // is moved to them first, so the trunks and crowns tested are theirs. A body is entered there at their speed (a walker
  // holds it a moment, groundControl.js carry), the spirit flies on at it. Returns the plan or null.
  // again: the second placement, from the latest state just before the veil lifts (multiplayer.js placeBehind): the body
  // taken the first time is moved, not taken again.
  const joinAs = (lead, trail, again = false) => {
    const same = again && (spirit.body ? spirit.body.code === lead.form : (lead.form || 'spirit') === 'spirit');
    if (spirit.body && !same) return null;
    if (!same) flight.pos.set(lead.x, Math.max(lead.y, tile.heights.atXZ(lead.x, lead.z) + 2), lead.z);
    veg.update(lead.x, lead.z, true); veg.refreshNear?.(lead.x, lead.z);
    const plan = planJoin({ lead, trail, kind: bodyKind, test: joinTest, tables: { ground: GROUND, fliers: FLIERS } });
    if (!plan) return null;
    const f = flight, at = { x: plan.x, y: plan.y, z: plan.z, yaw: plan.yaw, where: plan.where, speed: plan.speed, pitch: 0, soaring: plan.soaring };
    plan.again = !!again;
    if (same && spirit.body) {   // moved where the latest state puts it, at its speed
      f.yaw = plan.yaw; f.camSettled = false;
      if (ground.on) { ground.place(plan.x, plan.z); ground.v = Math.min(ground.S?.run ?? plan.speed, plan.speed); ground.carry = { v: ground.v, t: 2.5 }; }
      else { f.pos.set(plan.x, plan.y, plan.z); f.pitch = 0; if (plan.where === 'air') { f.speed = plan.speed; f.landed = false; } }
      return plan;
    }
    if (plan.code !== 'spirit' && takeBodyAt(plan.code, at)) {
      if (ground.on) ground.carry = { v: Math.min(ground.S?.run ?? plan.speed, plan.speed), t: 2.5 };
      else if (flier.on && plan.where === 'air') {
        f.speed = plan.soaring ? f.speed : Math.max(f.speed, plan.speed); f.flapping = plan.flapping;
        if (plan.soaring) { f.soarDir = plan.soarDir; f.roll = 0.3 * plan.soarDir; } else if (f.hover) f.setHover(false);   // round the way they circle, or straight on
      }
    } else {   // the spirit (or no body to be had): at the spot, on at their speed
      if (plan.code !== 'spirit') plan.fellBack = true;
      f.pos.set(plan.x, plan.where === 'air' ? plan.y : plan.y + 2, plan.z); f.yaw = plan.yaw; f.pitch = 0; f.roll = 0;
      f.speed = plan.speed; f.hover = plan.speed < 0.5; f.keys.clear(); f.camSettled = false; f.camYaw = f.yaw;
      spirit.prevP?.copy(f.pos); spirit.wisp?.reset?.(f.pos);
    }
    return plan;
  };
  window.__weJoinAs = joinAs;   // debugging
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
  else if (arrive) enterWorld({ season: arrive.season, date: arrive.date, point: arrivePoint, lead: arrive.lead || null, follow: !!arrive.follow, pick: !!arrive.pick }, !!arrive.follow);   // a follow's Join was a press: its sound may start

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
    if (w.lost) { requestAnimationFrame(frame); return; }   // the context is gone (main): nothing can be drawn; built again when it is back
    if (screenOpen) {   // behind the opening screen: a few frames a second, enough to stream the world in and compile shaders
      if (now - heldAt < 150) { requestAnimationFrame(frame); return; }
      heldAt = now;
    }
    if (frameN < 3) phase(`frame${frameN}`); frameN++;   // the first frames, marked (as the build's phases)
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    const s = seasonNow(), look = SEASON_LOOK[s], sun = sunDirection(tile.latitude, s, state.hour);
    flight.ridden = squirrel.on || woodpecker.on || ground.on;   // a drag orbits for these, steers a flight (flight.js steering)
    if (spirit.on && !arrival.active && !screenOpen) pilot.step(dt);   // the spirit's autopilot to a chip's animal or into the Embody target (pilot.js)
    const f = screenOpen ? arrival.hold() : squirrel.on ? squirrel.update(dt) : woodpecker.on ? woodpecker.update(dt) : ground.on ? ground.update(dt) : flier.on ? flier.update(dt) : arrival.active ? arrival.update(dt) : spirit.on ? spirit.update(dt) : flight.update(dt);
    if (ground.on || flier.on) { needs.update(dt, { x: flight.pos.x, north: -flight.pos.z, acting: ground.on && ground.actT > 0, wet: ground.on && !!ground.wet, under: ground.on && ground.mode === 'tunnel' ? dig.underFood() : null, target: quarry.target?.plant ? quarry.target : null, reach: quarry.canEat() }); hunt.update(dt); scent.update(dt); }   // the plant target and its reach (quarry.js canEat); the games of life (needs.js, hunt.js); the smell sense (scent.js)
    else if (squirrel.on && !arrival.active) scent.update(dt);   // the gray squirrel's own control smells too (its game is the acorns, not the needs)
    fruit.update(dt); if (peek.shown) fruit.group.visible = false;   // the fruit near the body (fruit.js)
    forage.update(dt);   // the forager's food plants lit and their halos (forage.js; off in any other body)
    sniffWave.update(dt, ground.on || flier.on || squirrel.on);   // the sniff's shockwave (sniffWave.js)
    dig.update(dt);   // the Dig game's world, its openings in the ground, its glow (dig.js)
    if (s !== anet.season) { anet.season = s; anet.join(tile.id, s); }   // the season's animals channel (animalNet.js)
    carrion.update(dt);   // Scavenge: the carcasses' stages, bodies, bones and glow (carrion.js)
    if ((ground.on && ground.mode !== 'tunnel') || flier.on || (squirrel.on && !arrival.active)) { sight.update(dt); cues.update(dt); } else if (ground.on) { sight.clear(); cues.update(dt); } else { sight.clear(); cues.clear(); }
    // the selection and its ring (quarry.js: a hunting body's prey, any body's chip pick, the spirit's any animal), the
    // strikes and the target frame (combat.js)
    quarry.update(dt, spirit.on ? (arrival.active ? null : 'spirit') : (ground.on && ground.mode !== 'tunnel') || flier.on ? (sight.hunts ? 'hunt' : 'body') : squirrel.on || woodpecker.on ? 'body' : null);
    combat.update(dt);
    spirit.blendCamera(dt);   // across a switch of body: drawn from a blend of the old view and the new control's (spirit.js)
    raven.update(dt, flight.flapping, flight.speed);
    spirit.draw(dt);   // the wisp, while a spirit
    players.update(dt);   // the other players' wisps, names and marks (players.js)
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
    life.update(camera.position);
    acorns.update(dt, camera, s);
    animals.update(dt, s, state.hour);
    if (!peek.shown) terrain.setLook(look);
    // behind the screen, and for the first 2 s of a direct start (no screen: a few dark frames instead of a long one)
    const gated = screenOpen || now - readyAt < 2000;
    const draw = !gated || (!(compiling ||= compileNew()) && firstUse());
    if (draw) shadows.update(camera);
    if (draw && !(screenOpen && screen.ownsCanvas)) spirit.render(renderer, scene, camera);   // renderer.render, plus the spirit's view's passes while it is on; not while the title screen draws the earth on the shared canvas (title.js)
    if (draw && !(screenOpen && screen.ownsCanvas)) dig.xray(renderer);   // the underground view's pass over it, while the body is underground (dig.js)
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
      $('habitat').textContent = habitatLabel(tile, flight.pos.x, -flight.pos.z);   // the cell's own community (identify.js)
      $('trees').textContent = peek.shown ? 'hidden (present day)' : `${veg.count.toLocaleString()} near · ${far.count.toLocaleString()} far`;
      identify.tick(now);
      const where = places.describe(flight.pos.x, -flight.pos.z);
      $('soundNow').textContent = sound ? sound.describe() : '–';
      const wd = weather.describe(), wb = $('weatherNow');
      if (wd) { const i = document.createElement('i'); i.textContent = ` · ${wd.note}`; wb.replaceChildren(wd.text, i); } else wb.textContent = '–';
      $('animalsNear').textContent = animals.describe(now);
      nearBar.update(animals.counts, !screenOpen, quarry.target?.sp ?? -1);   // in a body too (2026-11-06: a chip selects)
      $('over').textContent = where.text; minimap.place = where.place;
      layoutHud();
      const h = Math.floor(state.hour), mnt = Math.round((state.hour - h) * 60); $('timeLabel').textContent = `${h}:${String(mnt).padStart(2, '0')} · sun ${(sun.elevation * 180 / Math.PI).toFixed(0)}°`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(e => {
  console.error(e); $('status').textContent = 'error: ' + e.message; $('status').classList.remove('hidden');
  const boot = $('boot');   // the opening hides the status: the boot screen says it in place of its loader
  if (boot && !boot.classList.contains('out')) { const p = document.createElement('p'); p.textContent = `could not start: ${e.message}`; boot.replaceChildren(p); }
});
