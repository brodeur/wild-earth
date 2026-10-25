import * as THREE from 'three';
import { loadTile, loadPresentTexture, HABITAT_NAMES } from './tilepackage.js';
import { Terrain } from './terrain.js';
import { SkyDome } from './sky.js';
import { Atmosphere } from './atmosphere.js';
import { RavenFlight } from './flight.js';
import { Raven } from './raven.js';
import { Vegetation } from './vegetation.js';
import { Impostors } from './impostors.js';
import { Grass } from './grass.js';
import { MiniMap } from './minimap.js';
import { RoadsOverlay } from './roadsOverlay.js';
import { setupGoTo, takePendingPoint, builtTileFor, takeCarry, localXY } from './goto.js';
import { OpeningScreen, Arrival, lastTile, rememberTile } from './arrival.js';
import { SEASON_LOOK, seasonOfDate, sunDirection } from './season.js';
import { AcornGame } from './acorns.js';
import { Identify } from './identify.js';
import { PlaceNames } from './placenames.js';
import { Soundscape } from './sound.js';
import { Shadows } from './shadows.js';
import { Animals } from './animals.js';
import { Water } from './water.js';
import { Rocks } from './rocks.js';
import { SquirrelControl } from './squirrelControl.js';

const $ = id => document.getElementById(id);
const html = document.documentElement;
let screen = null, screenOpen = false;   // the opening screen (arrival.js) while it is up
const status = t => {
  if (screenOpen) { screen.setPrep(t ? `preparing ${screen.tileId}: ${t}` : ''); $('status').classList.add('hidden'); return; }
  $('status').textContent = t; $('status').classList.toggle('hidden', !t);
};

async function main() {
  const params = new URLSearchParams(location.search);
  const pending = takePendingPoint(params);   // a lat/lon to land at, read once
  const carry = takeCarry();                  // choices carried across a tile switch, read once
  // ?game=1 and ?skip=1 go straight in, as before the opening screen (agents and tests rely on it).
  // An in-game Go to another tile carries { arrive } and goes straight into an arrival. Otherwise
  // the opening screen asks where, when and who while the preselected tile builds behind it.
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
  const flags = ['game', 'skip'].filter(k => params.get(k) === '1').map(k => `&${k}=1`).join('');
  if (pending) history.replaceState(null, '', `?tile=${tile.id}${flags}`);   // never keep the point in the URL
  $('tileName').textContent = tile.id;
  status('building terrain…');
  await new Promise(r => setTimeout(r, 20));

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.5, 60000);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  const atmosphere = new Atmosphere(tile);   // shared haze, sun, sky light and clouds
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
  const shadows = new Shadows({ renderer, scene, tile, terrain, veg, raven, grass });   // cascaded sun shadows (shadows.js)
  flight.reset(tile.size / 2, -tile.size / 2, 150);
  veg.radius = +$('detail').value; veg.update(flight.pos.x, flight.pos.z, true);
  const minimap = new MiniMap({ container: $('minimap'), sizeM: tile.size, imagery: tile.imagery, features: tile.features, flight, rewildImage: tile.textureImage });
  const places = new PlaceNames(tile.features, tile.size);   // nearest named road, stream or water, for the HUD
  const goto = setupGoTo({ tile, flight, input: $('gotoInput'), button: $('gotoBtn'), line: $('gotoStatus'),
    carry: () => ({ arrive: { season: seasonNow(), species: window.__we?.playerSpecies || 'corvus_corax' } }) });
  if (pending && direct) goto.go(pending, { fromLoad: true });
  if (pending && !direct) $('gotoInput').value = `${pending.lat}, ${pending.lon}`;
  // The scripted arrival (arrival.js); behind the screen the bird waits at its start so the forest streams in there.
  const arrival = new Arrival({ flight, camera, heights: tile.heights, size: tile.size, caption: $('caption') });
  const carriedPoint = carried && pending ? localXY(tile, pending.lat, pending.lon) : null;
  if (screen) { screen.onPoint = p => { arrival.plan(p); arrival.hold(); }; arrival.plan(screen.point); }
  else if (carried) arrival.plan(carriedPoint);
  if (!direct) { arrival.hold(); veg.update(flight.pos.x, flight.pos.z, true); }

  // Base texture: the erased imagery when the tile has it, else the rewilded habitat texture.
  const peek = { want: false, shown: false, pending: null, present: null, roadsWere: false };   // present-day peek, below
  let texKind = 'rewilded';
  function setTexture(kind) {
    texKind = kind;
    if (peek.shown) return;   // applied when the peek ends
    const imagery = kind === 'imagery' && tile.imageryTextureImage;
    terrain.setTexture(imagery ? tile.imageryTextureImage : tile.textureImage);
    terrain.setImagery(!!imagery, tile.imageryRef);
    $('texImagery').classList.toggle('on', !!imagery); $('texRewild').classList.toggle('on', !imagery);
  }
  $('texImagery').disabled = !tile.imageryTextureImage;
  if (!tile.imageryTextureImage) $('texImagery').title = 'this tile has no erased imagery; run the erase step';
  $('texImagery').onclick = () => setTexture('imagery');
  $('texRewild').onclick = () => setTexture('rewilded');
  setTexture(tile.imageryTextureImage ? 'imagery' : 'rewilded');

  const state = { season: 'auto', hour: +$('time').value };   // 'auto' tracks today's date
  const seasonNow = () => state.season === 'auto' ? seasonOfDate() : state.season;
  $('season').onchange = e => { state.season = e.target.value; applySeason(); };
  $('time').oninput = e => { state.hour = +e.target.value; };
  $('detail').onchange = e => { veg.radius = +e.target.value; veg.update(flight.pos.x, flight.pos.z, true); };
  addEventListener('keydown', e => { if (e.code === 'KeyR') flight.reset(tile.size / 2, -tile.size / 2, 150); });

  const names = Object.fromEntries((tile.species || []).map(s => [s.code, s.common]));
  const showPerceives = code => { const p = tile.perception?.perceives?.[code] || []; $('perceives').textContent = p.length ? p.map(c => names[c] || c).join(', ') : 'everything (no perception matrix)'; };
  showPerceives('corvus_corax');

  function applySeason() {
    const s = seasonNow(); $('seasonNote').textContent = state.season === 'auto' ? `(${s})` : '';
    veg.setLook(SEASON_LOOK[s]);
    if (far.setSeason) far.setSeason(s);   // far impostors follow the season too
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
    if (!sound) { sound = new Soundscape({ tile, flight, raven, camera, els: { button: $('soundBtn'), volume: $('soundVol') } }); window.__we.sound = sound; }
    return sound;
  };

  window.__we = { tile, flight, raven, camera, veg, terrain, far, grass, roads, scene, renderer, minimap, atmosphere, sky, acorns, identify, places, peek, setPeek, sound, animals, arrival, rocks, squirrel };   // debugging handle
  if (!screen) makeSound();

  // Into the world: season, observer, sound, then the arrival flight over the chosen point.
  const captionFor = (point, season, species) => {
    const near = places.nearest(point?.x ?? tile.size / 2, point?.north ?? tile.size / 2);
    const who = names[species] || species;
    return `${near ? `${near.over ? 'over' : 'near'} ${near.name}` : tile.id} · ${season} · ${who}`;
  };
  enter = (c, gesture) => {
    rememberTile(tile.id);
    state.season = c.season === seasonOfDate() ? 'auto' : c.season; $('season').value = state.season; applySeason();
    window.__we.playerSpecies = c.species; animals.setObserver(c.species); showPerceives(c.species);
    squirrel.setOn(c.species === 'sciurus_griseus');
    const snd = makeSound();
    if (gesture) {
      snd.start();   // inside the Begin click when the world was ready; otherwise the press already activated the page
      if (snd.ctx?.state === 'suspended') {   // a stricter browser: resume on the next press
        const kick = () => { removeEventListener('pointerdown', kick, true); removeEventListener('keydown', kick, true); if (!snd.muted) snd.ctx.resume(); };
        addEventListener('pointerdown', kick, true); addEventListener('keydown', kick, true);
      }
    }
    if (squirrel.on) squirrel.arrive(c.point, c.caption || captionFor(c.point, c.season, c.species), () => html.classList.remove('arriving'));   // out of an oak
    else {
      arrival.plan(c.point);
      arrival.onDone = () => { html.classList.remove('arriving'); };
      arrival.start(c.caption || captionFor(c.point, c.season, c.species));
    }
    html.classList.add('arriving'); html.classList.remove('opening');
    if (screen) { screen.close(); screenOpen = false; }
  };
  if (screen) screen.setReady();
  status('');
  if (direct && params.get('as') === 'squirrel') {   // tests: ?skip=1&as=squirrel puts a squirrel by the oak nearest the centre
    window.__we.playerSpecies = 'sciurus_griseus'; animals.setObserver('sciurus_griseus'); showPerceives('sciurus_griseus');
    squirrel.setOn(true); squirrel.arrive(pending ? localXY(tile, pending.lat, pending.lon) : null, null);
  } else if (direct) { /* as before: the bird is at the tile centre, flying */ }
  else if (carried) enter({ season: carried.season, species: carried.species || 'corvus_corax', point: carriedPoint }, false);
  else if (chosen) enter(chosen, true);   // Begin was pressed while the world was loading

  let last = performance.now(), hudT = 0, heldAt = 0;
  function frame(now) {
    if (screenOpen) {   // behind the opening screen: a few frames a second, enough to stream the world in and compile shaders
      if (now - heldAt < 150) { requestAnimationFrame(frame); return; }
      heldAt = now;
    }
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    const s = seasonNow(), look = SEASON_LOOK[s], sun = sunDirection(tile.latitude, s, state.hour);
    const f = screenOpen ? arrival.hold() : squirrel.on ? squirrel.update(dt) : arrival.active ? arrival.update(dt) : flight.update(dt);
    raven.update(dt, flight.flapping, flight.speed);
    veg.update(flight.pos.x, flight.pos.z);
    veg.updateClose(camera.position);
    atmosphere.update(dt, sun, look, s, state.hour, camera);
    sky.update(camera);
    far.update(camera, veg.radius);
    grass.update(flight.pos.x, flight.pos.z, dt, camera, look);
    water.update(dt, look);
    rocks.update(camera);
    acorns.update(dt, camera, s);
    animals.update(dt, s, state.hour);
    if (!peek.shown) terrain.setLook(look);
    shadows.update(camera);
    renderer.render(scene, camera);
    sound?.update(dt, { season: s, hour: state.hour, sunElevation: sun.elevation });
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
      $('animalsNear').textContent = animals.describe(now);
      $('over').textContent = where.text; minimap.place = where.place;
      const h = Math.floor(state.hour), mnt = Math.round((state.hour - h) * 60); $('timeLabel').textContent = `${h}:${String(mnt).padStart(2, '0')} · sun ${(sun.elevation * 180 / Math.PI).toFixed(0)}°`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(e => { console.error(e); status('error: ' + e.message); });
