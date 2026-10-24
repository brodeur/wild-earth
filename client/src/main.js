import * as THREE from 'three';
import { loadTile, HABITAT_NAMES } from './tilepackage.js';
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
  const minimap = new MiniMap({ container: $('minimap'), sizeM: tile.size, imagery: tile.imagery, features: tile.features, flight });
  const goto = setupGoTo({ tile, flight, input: $('gotoInput'), button: $('gotoBtn'), line: $('gotoStatus') });
  if (pending) goto.go(pending, { fromLoad: true });

  // Base texture: the erased imagery when the tile has it, else the rewilded habitat texture.
  function setTexture(kind) {
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

  status('');
  window.__we = { tile, flight, raven, camera, veg, terrain, far, grass, roads, scene, renderer, minimap, atmosphere, sky, acorns, identify };   // debugging handle

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
    terrain.setLook(look);
    renderer.render(scene, camera);
    minimap.update(flight.pos, f.heading);
    hudT += dt;
    if (hudT > 0.15) {
      hudT = 0;
      $('hoverBtn').classList.toggle('on', !!f.hover); $('hoverBtn').textContent = f.hover ? 'Resume flight' : 'Hover';
      $('agl').textContent = `${f.agl.toFixed(0)} m`; $('elev').textContent = `${f.elev.toFixed(0)} m`;
      $('speed').textContent = `${f.speed.toFixed(1)} m/s`; $('heading').textContent = `${f.heading.toFixed(0)}°`;
      $('habitat').textContent = HABITAT_NAMES[tile.habitat.at(flight.pos.x, -flight.pos.z)] || '–';
      $('trees').textContent = `${veg.count.toLocaleString()} near · ${far.count.toLocaleString()} far`;
      identify.tick(now);
      const h = Math.floor(state.hour), mnt = Math.round((state.hour - h) * 60); $('timeLabel').textContent = `${h}:${String(mnt).padStart(2, '0')} · sun ${(sun.elevation * 180 / Math.PI).toFixed(0)}°`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(e => { console.error(e); status('error: ' + e.message); });
