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
import { setupGoTo, takePendingPoint, builtTileFor } from './goto.js';
import { SEASON_LOOK, seasonOfDate, sunDirection } from './season.js';
import { AcornGame } from './acorns.js';
import { Identify } from './identify.js';
import { PlaceNames } from './placenames.js';
import { Soundscape } from './sound.js';

const $ = id => document.getElementById(id);
const status = t => { $('status').textContent = t; $('status').classList.toggle('hidden', !t); };

async function main() {
  const params = new URLSearchParams(location.search);
  const pending = takePendingPoint(params);   // a lat/lon to land at, read once
  let tileId = params.get('tile');
  if (pending && !tileId) tileId = await builtTileFor(pending);   // null -> loader picks the first tile
  const tile = await loadTile(tileId);
  if (pending) history.replaceState(null, '', `?tile=${tile.id}${params.get('game') === '1' ? '&game=1' : ''}`);   // never keep the point in the URL
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
  const roads = new RoadsOverlay(tile, scene);   // ghost roads, G to toggle
  const flight = new RavenFlight(camera, tile.heights, renderer.domElement);
  scene.add(flight.body);
  const raven = new Raven(flight.body, atmosphere);   // the bird you see from the chase camera
  flight.reset(tile.size / 2, -tile.size / 2, 150);
  veg.radius = +$('detail').value; veg.update(flight.pos.x, flight.pos.z, true);
  const minimap = new MiniMap({ container: $('minimap'), sizeM: tile.size, imagery: tile.imagery, features: tile.features, flight, rewildImage: tile.textureImage });
  const places = new PlaceNames(tile.features, tile.size);   // nearest named road, stream or water, for the HUD
  const goto = setupGoTo({ tile, flight, input: $('gotoInput'), button: $('gotoBtn'), line: $('gotoStatus') });
  if (pending) goto.go(pending, { fromLoad: true });

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

  const state = { season: 'auto', hour: +$('time').value };
  const seasonNow = () => state.season === 'auto' ? seasonOfDate() : state.season;
  $('season').onchange = e => { state.season = e.target.value; applySeason(); };
  $('time').oninput = e => { state.hour = +e.target.value; };
  $('detail').onchange = e => { veg.radius = +e.target.value; veg.update(flight.pos.x, flight.pos.z, true); };
  addEventListener('keydown', e => { if (e.code === 'KeyR') flight.reset(tile.size / 2, -tile.size / 2, 150); });

  const perceives = tile.perception?.perceives?.corvus_corax || [];
  const names = Object.fromEntries((tile.species || []).map(s => [s.code, s.common]));
  $('perceives').textContent = perceives.length ? perceives.map(c => names[c] || c).join(', ') : 'everything (no perception matrix)';

  function applySeason() {
    const s = seasonNow(); $('seasonNote').textContent = state.season === 'auto' ? `(${s})` : '';
    veg.setLook(SEASON_LOOK[s]);
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
    for (const o of [veg, far, grass]) o.group.visible = !on;
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

  // Soundscape (sound.js): starts on the first click or key; N mutes, C calls.
  const sound = new Soundscape({ tile, flight, raven, camera, els: { button: $('soundBtn'), volume: $('soundVol') } });

  status('');
  window.__we = { tile, flight, raven, camera, veg, terrain, far, grass, roads, scene, renderer, minimap, atmosphere, sky, acorns, identify, places, peek, setPeek, sound };   // debugging handle

  let last = performance.now(), hudT = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    const s = seasonNow(), look = SEASON_LOOK[s], sun = sunDirection(tile.latitude, s, state.hour);
    const f = flight.update(dt);
    raven.update(dt, flight.flapping, flight.speed);
    veg.update(flight.pos.x, flight.pos.z);
    veg.updateClose(camera.position);
    atmosphere.update(dt, sun, look, s, state.hour, camera);
    sky.update(camera);
    far.update(camera, veg.radius);
    grass.update(flight.pos.x, flight.pos.z, dt, camera, look);
    acorns.update(dt, camera, s);
    if (!peek.shown) terrain.setLook(look);
    renderer.render(scene, camera);
    sound.update(dt, { season: s, hour: state.hour, sunElevation: sun.elevation });
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
      $('soundNow').textContent = sound.describe();
      $('over').textContent = where.text; minimap.place = where.place;
      const h = Math.floor(state.hour), mnt = Math.round((state.hour - h) * 60); $('timeLabel').textContent = `${h}:${String(mnt).padStart(2, '0')} · sun ${(sun.elevation * 180 / Math.PI).toFixed(0)}°`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(e => { console.error(e); status('error: ' + e.message); });
