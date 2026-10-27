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
import { MiniMap } from './minimap.js';
import { RoadsOverlay } from './roadsOverlay.js';
import { setupGoTo, takePendingPoint, builtTileFor, takeCarry, localXY } from './goto.js';
import { OpeningScreen, Arrival, lastTile, rememberTile } from './arrival.js';
import { SEASON_LOOK, seasonOfDate, sunDirection, dateForSeason, parseDate } from './season.js';
import { AcornGame } from './acorns.js';
import { Identify } from './identify.js';
import { PlaceNames } from './placenames.js';
import { Soundscape } from './sound.js';
import { Shadows } from './shadows.js';
import { Animals } from './animals.js';
import { Water } from './water.js';
import { Rocks } from './rocks.js';
import { SquirrelControl } from './squirrelControl.js';
import { WoodpeckerControl } from './woodpeckerControl.js';
import { SpiritControl } from './spirit.js';
import { setupCredits } from './credits.js';
import { Weather } from './weather.js';

const $ = id => document.getElementById(id);
const html = document.documentElement;
let screen = null, screenOpen = false;   // the opening screen (arrival.js) while it is up
// HUD layout for the window's size (index.html, html.narrow): under 1200 x 760 px the HUD, game box and panel shrink.
// The game box stays centred when it clears the HUD and the panel, else it moves into the gap between them, else under
// the HUD; the panel stops above the mini-map (and scrolls), the help line wraps before the mini-map and the species
// card sits above the help line. Run on resize and with the HUD's text updates (the HUD's width follows its text).
function layoutHud() {
  const W = innerWidth, H = innerHeight;
  html.classList.toggle('narrow', W < 1200 || H < 760);
  const box = id => $(id).getBoundingClientRect(), mm = box('minimap'), pan = $('panel'), cs = getComputedStyle(pan);
  pan.style.maxHeight = `${Math.max(120, Math.floor(mm.top - 10 - pan.getBoundingClientRect().top - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)))}px`;
  const help = $('help'), hs = getComputedStyle(help);
  help.style.maxWidth = `${Math.max(200, Math.floor(mm.left - 10 - help.getBoundingClientRect().left - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight)))}px`;
  $('speciesCard').style.bottom = `${Math.max(12, Math.round(H - help.getBoundingClientRect().top + 8))}px`;
  const g = $('game'); if (g.classList.contains('hidden')) return;
  g.style.left = g.style.top = g.style.transform = '';   // centred, as styled
  const hud = box('hud'), pr = pan.getBoundingClientRect(), gr = g.getBoundingClientRect(), lo = hud.right + 10, hi = pr.left - 10;
  if (gr.left >= lo && gr.right <= hi) return;
  g.style.transform = 'none';
  if (hi - lo >= gr.width) g.style.left = `${Math.round(Math.min(Math.max(W / 2 - gr.width / 2, lo), hi - gr.width))}px`;
  else { g.style.left = `${Math.round(hud.left)}px`; g.style.top = `${Math.round(hud.bottom + 8)}px`; }
}

const status = t => {
  if (screenOpen) { screen.setPrep(t ? `preparing ${screen.tileId}: ${t}` : ''); $('status').classList.add('hidden'); return; }
  $('status').textContent = t; $('status').classList.toggle('hidden', !t);
};

async function main() {
  const params = new URLSearchParams(location.search);
  const pending = takePendingPoint(params);   // a lat/lon to land at, read once
  const carry = takeCarry();                  // choices carried across a tile switch, read once
  // ?game=1 and ?skip=1 go straight in, as before the opening screen (agents and tests rely on it): as a spirit at the
  // tile centre, flying (&as=spirit says so), or for tests &as=raven (the old start), &as=squirrel, &as=woodpecker.
  // An in-game Go to another tile carries { arrive } and goes straight into an arrival. Otherwise
  // the opening screen asks where and when while the preselected tile builds behind it. The player always arrives as
  // the spirit (spirit.js) and becomes an animal by touching one.
  const direct = params.get('game') === '1' || params.get('skip') === '1';
  const carried = !direct && carry?.arrive ? carry.arrive : null;
  html.classList.toggle('opening', !direct && !carried); html.classList.toggle('arriving', !!carried);
  let tileId = params.get('tile');
  if (pending && !tileId) tileId = await builtTileFor(pending);   // null -> loader picks the first tile
  let chosen = null, enter = null;   // the screen's choice; enter() once the world exists
  if (!direct && !carried) {
    const index = await (await fetch('../tiles/index.json', { cache: 'no-cache' })).json();
    const ids = index.tiles.map(t => t.tile_id);
    if (!ids.includes(tileId)) tileId = ids.includes(lastTile()) ? lastTile() : ids[0];
    if (!tileId) throw new Error('no tiles built');
    screen = new OpeningScreen({ root: $('opening'), index, tileId, pending, carried: carry?.screen,
      onBegin: c => { chosen = c; if (enter) enter(c, true); } });
    screenOpen = true;
  }
  const tile = await loadTile(tileId);
  const flags = ['game', 'skip'].filter(k => params.get(k) === '1').map(k => `&${k}=1`).join('')
    + (params.has('fov') ? `&fov=${params.get('fov')}` : '');
  if (pending) history.replaceState(null, '', `?tile=${tile.id}${flags}`);   // never keep the point in the URL
  $('tileName').textContent = tile.id;
  const credits = setupCredits({ tile, link: $('creditsLink'), panel: $('credits') });   // HUD Data link: sources, licences, asset credits
  status('building terrain…');
  await new Promise(r => setTimeout(r, 20));

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  // The lens: ?fov=<degrees, vertical> (30..110, default LENS_DEFAULT). 70 shows about 103 degrees across a widescreen,
  // a wide-angle lens; the view is undistorted only when it matches the angle the screen fills in the eye, about
  // 45-50 degrees across at a desk (under 30 vertical), so a narrower lens makes the hills loom as they do in life
  // at the cost of peripheral view and the feeling of speed. __we.setFov(deg) changes it live for comparisons.
  const LENS_DEFAULT = 70, LENS_RANGE = [30, 110];
  const lensParam = parseFloat(params.get('fov'));
  const lens = Number.isFinite(lensParam) ? Math.min(LENS_RANGE[1], Math.max(LENS_RANGE[0], lensParam)) : LENS_DEFAULT;
  const camera = new THREE.PerspectiveCamera(lens, innerWidth / innerHeight, 0.5, 60000);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); layoutHud(); });
  layoutHud();

  const atmosphere = new Atmosphere(tile);   // shared haze, sun, sky light and clouds
  const weather = new Weather({ tile, scene, renderer, camera });   // the day's measured weather (weather.js), loading
  const terrain = new Terrain(tile); scene.add(terrain.group);
  const sky = new SkyDome(scene, renderer, atmosphere);
  status('growing forest…'); await new Promise(r => setTimeout(r, 20));
  const veg = new Vegetation(tile, scene, atmosphere);
  const far = new Impostors(tile, scene);
  const grass = new Grass(tile, scene);
  const water = new Water(tile, scene);   // streams, dry beds and ponds by season (water.js)
  const rocks = new Rocks(tile, scene, atmosphere);   // outcrops and boulders from the geology and soils rasters (rocks.js)
  const roads = new RoadsOverlay(tile, scene);   // ghost roads, G to toggle
  const flight = new RavenFlight(camera, tile.heights, renderer.domElement);
  scene.add(flight.body);
  const raven = new Raven(flight.body, atmosphere);   // the bird you see from the chase camera
  const shadows = new Shadows({ renderer, scene, tile, terrain, veg, raven, grass, far });   // cascaded sun shadows (shadows.js)
  flight.reset(tile.size / 2, -tile.size / 2, 150);
  // On a tile with a lidar crown list (crowns.js) the trees stand on the crowns: wait for the plan (the list has been
  // downloading since the Vegetation was built) so the first frame has its trees rather than shrubs alone.
  if (crownPlan(tile)) { status('placing the trees on their lidar crowns…'); await crownPlan(tile); }
  veg.radius = +$('detail').value; veg.update(flight.pos.x, flight.pos.z, true);
  const minimap = new MiniMap({ container: $('minimap'), sizeM: tile.size, imagery: tile.imagery, features: tile.features, flight, rewildImage: tile.textureImage });
  const places = new PlaceNames(tile.features, tile.size);   // nearest named road, stream or water, for the HUD
  const goto = setupGoTo({ tile, flight, input: $('gotoInput'), button: $('gotoBtn'), line: $('gotoStatus'),
    carry: () => ({ arrive: { season: seasonNow(), date: dateCarry() } }) });
  if (pending && direct) goto.go(pending, { fromLoad: true });
  if (pending && !direct) $('gotoInput').value = `${pending.lat}, ${pending.lon}`;
  // The scripted arrival (arrival.js); behind the screen the bird waits at its start so the forest streams in there.
  const arrival = new Arrival({ flight, camera, heights: tile.heights, size: tile.size, caption: $('caption') });
  const carriedPoint = carried && pending ? localXY(tile, pending.lat, pending.lon) : null;
  if (screen) { screen.onPoint = p => { arrival.plan(p); arrival.hold(); }; arrival.plan(screen.point); }
  else if (carried) arrival.plan(carriedPoint);
  if (!direct) { arrival.hold(); veg.update(flight.pos.x, flight.pos.z, true); }

  // Base texture: the erased imagery when the tile has it (without its tree crowns when the tile has
  // client.texture_ground; ?base=imagery shows the photo with them, for comparison), else the rewilded habitat texture.
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

  const state = { season: 'auto', hour: +$('time').value };   // 'auto' tracks today's date (or ?date=MM-DD)
  let fixedDate = parseDate(params.get('date')), fixedDateStr = fixedDate ? params.get('date') : null;
  // The date the ground's measured colour shows: today (or ?date), or the chosen season's mid-month.
  const dateNow = () => state.season === 'auto' ? (fixedDate || new Date()) : dateForSeason(state.season);
  const seasonNow = () => state.season === 'auto' ? seasonOfDate(dateNow()) : state.season;
  // the date a tile switch carries: a fixed date ('MM-DD') while the season tracks one, else null (today, or the season)
  const dateCarry = () => state.season === 'auto' && fixedDate ? `${String(fixedDate.getMonth() + 1).padStart(2, '0')}-${String(fixedDate.getDate()).padStart(2, '0')}` : null;
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
  weather.ready.then(weatherDay);
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
  applySeason();

  // Acorn stash game (docs/game-acorn-stash.md): opt-in, so flying stays the default.
  const acorns = new AcornGame(tile, scene, flight, veg, {
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
  const identify = new Identify({ veg, camera, dom: renderer.domElement, scene, flight, acorns, seasonNow,
    els: { nearest: $('nearestTree'), around: $('aroundYou'), card: $('speciesCard') } });

  // Ambient animals (animals.js): squirrels, acorn woodpeckers, other ravens, deer, filtered by perception.
  // During an acorn game the woodpeckers, squirrels and ravens gather from the game's acorns (game: acorns).
  const animals = new Animals({ tile, scene, flight, veg, atmosphere, camera, identify, game: acorns });
  // The playable squirrel (squirrelControl.js): drives flight.pos and the camera in place of the raven when chosen.
  const squirrel = new SquirrelControl({ tile, scene, camera, flight, veg, animals, acorns, atmosphere, rocks, caption: $('caption') });
  // The playable acorn woodpecker (woodpeckerControl.js): clinging, hitching and short undulating flights, the same way.
  const woodpecker = new WoodpeckerControl({ tile, scene, camera, flight, veg, animals, acorns, atmosphere, caption: $('caption') });
  // The spirit (spirit.js): the form the player arrives in; touching a raven, squirrel or woodpecker puts the player in
  // that body (onBody: the observer, the perception line, the panel's way back), B or the panel button leaves it.
  const onBody = (code, sex = null) => {
    window.__we.playerSpecies = code; window.__we.playerSex = sex;
    animals.setObserver(code); showPerceives(code);
    $('spiritBtn').hidden = code === 'spirit';
  };
  const spirit = new SpiritControl({ scene, renderer, camera, flight, raven, animals, squirrel, woodpecker, atmosphere, onBody });
  $('spiritBtn').onclick = () => { spirit.leave(); renderer.domElement.focus?.(); };
  const toSpirit = () => { squirrel.setOn(false); woodpecker.setOn(false); spirit.setOn(true); onBody('spirit'); };

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
    identify.tagGroup.visible = !on && identify.tagsOn;
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
    if (!sound) { sound = new Soundscape({ tile, flight, raven, camera, els: { button: $('soundBtn'), volume: $('soundVol') } }); window.__we.sound = sound; weather.onThunder = (d, k) => sound.thunder(d, k); }
    return sound;
  };

  // tests and comparisons: __we.setDate('01-15') shows that day's measured colour ('' for today)
  const setDate = str => { fixedDate = parseDate(str); fixedDateStr = fixedDate ? str : null; state.season = 'auto'; $('season').value = 'auto'; applySeason(); return terrain.seasonStats; };
  const setFov = deg => { const v = Math.min(LENS_RANGE[1], Math.max(LENS_RANGE[0], +deg || LENS_DEFAULT)); camera.fov = v; camera.updateProjectionMatrix(); return v; };
  const setHour = h => { state.hour = +h; $('time').value = state.hour; return state.hour; };
  animals.weatherTemp = () => (weather.day ? weather.fx.temp : null);   // the lizards' air (animals.js airT)
  window.__we = { setDate, setFov, setHour, weather, tile, flight, raven, camera, veg, terrain, far, grass, roads, scene, renderer, minimap, atmosphere, sky, acorns, identify, places, peek, setPeek, sound, animals, arrival, rocks, squirrel, woodpecker, spirit, credits };   // debugging handle
  const as = direct ? params.get('as') : null;
  if (!['raven', 'squirrel', 'woodpecker'].includes(as)) toSpirit();   // a spirit from the start (behind the opening screen too)
  if (!screen) makeSound();

  // Into the world: season, observer, sound, then the arrival flight over the chosen point.
  const captionFor = (point, season) => {
    const near = places.nearest(point?.x ?? tile.size / 2, point?.north ?? tile.size / 2);
    return `${near ? `${near.over ? 'over' : 'near'} ${near.name}` : tile.id} · ${season} · spirit`;
  };
  // c: the opening screen's { tileId, season, date ('MM-DD', or null for today), point, caption }, or a carried arrival
  // { season, date, point }. Older fields (species, sex) are ignored: everyone arrives as the spirit.
  enter = (c, gesture) => {
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
    html.classList.add('arriving'); html.classList.remove('opening');
    if (screen) { screen.close(); screenOpen = false; }
  };
  if (screen) screen.setReady();
  status('');
  if (as === 'squirrel') {   // tests: ?skip=1&as=squirrel puts a squirrel by the oak nearest the centre
    onBody('sciurus_griseus');
    squirrel.setOn(true); squirrel.arrive(pending ? localXY(tile, pending.lat, pending.lon) : null, null);
  } else if (as === 'woodpecker') {   // tests: ?skip=1&as=woodpecker[&sex=female] puts a woodpecker on the granary nearest the centre
    const sex = params.get('sex') === 'female' ? 'female' : 'male';
    onBody('melanerpes_formicivorus', sex);
    woodpecker.setOn(true, sex); woodpecker.arrive(pending ? localXY(tile, pending.lat, pending.lon) : null, null);
  } else if (as === 'raven') onBody('corvus_corax');   // tests: the old start, the raven at the tile centre, flying
  else if (direct) { /* a spirit at the tile centre, flying */ }
  else if (carried) enter({ season: carried.season, date: carried.date, point: carriedPoint }, false);
  else if (chosen) enter(chosen, true);   // Begin was pressed while the world was loading

  let last = performance.now(), hudT = 0, heldAt = 0;
  function frame(now) {
    if (screenOpen) {   // behind the opening screen: a few frames a second, enough to stream the world in and compile shaders
      if (now - heldAt < 150) { requestAnimationFrame(frame); return; }
      heldAt = now;
    }
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    const s = seasonNow(), look = SEASON_LOOK[s], sun = sunDirection(tile.latitude, s, state.hour);
    const f = screenOpen ? arrival.hold() : squirrel.on ? squirrel.update(dt) : woodpecker.on ? woodpecker.update(dt) : arrival.active ? arrival.update(dt) : spirit.on ? spirit.update(dt) : flight.update(dt);
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
    water.update(dt, look);
    rocks.update(camera);
    acorns.update(dt, camera, s);
    animals.update(dt, s, state.hour);
    if (!peek.shown) terrain.setLook(look);
    shadows.update(camera);
    spirit.render(renderer, scene, camera);   // renderer.render, plus the spirit's view's passes while it is on
    spirit.unblendCamera();   // the control's own camera back for its next frame
    sound?.update(dt, { season: s, hour: state.hour, sunElevation: sun.elevation, weather: wx });
    if (peek.pending !== null) { if (peek.pending !== peek.shown) { crossFade(); applyPeek(peek.pending); } peek.pending = null; }
    minimap.update(flight.pos, f.heading);
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
      $('over').textContent = where.text; minimap.place = where.place;
      layoutHud();
      const h = Math.floor(state.hour), mnt = Math.round((state.hour - h) * 60); $('timeLabel').textContent = `${h}:${String(mnt).padStart(2, '0')} · sun ${(sun.elevation * 180 / Math.PI).toFixed(0)}°`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(e => { console.error(e); status('error: ' + e.message); });
