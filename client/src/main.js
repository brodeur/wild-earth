import * as THREE from 'three';
import { loadTile, HABITAT_NAMES } from './tilepackage.js';
import { Terrain } from './terrain.js';
import { SkyDome } from './sky.js';
import { RavenFlight } from './flight.js';
import { Vegetation } from './vegetation.js';
import { Impostors } from './impostors.js';
import { Grass } from './grass.js';
import { MiniMap } from './minimap.js';
import { setupGoTo, takePendingPoint, builtTileFor } from './goto.js';
import { SEASON_LOOK, seasonOfDate, sunDirection } from './season.js';

const $ = id => document.getElementById(id);
const status = t => { $('status').textContent = t; $('status').classList.toggle('hidden', !t); };

async function main() {
  const params = new URLSearchParams(location.search);
  const pending = takePendingPoint(params);   // a lat/lon to land at, read once
  let tileId = params.get('tile');
  if (pending && !tileId) tileId = await builtTileFor(pending);   // null -> loader picks the first tile
  const tile = await loadTile(tileId);
  if (pending) history.replaceState(null, '', `?tile=${tile.id}`);   // never keep the point in the URL
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

  const terrain = new Terrain(tile); scene.add(terrain.group);
  const sky = new SkyDome(scene, renderer);
  status('growing forest…'); await new Promise(r => setTimeout(r, 20));
  const veg = new Vegetation(tile, scene);
  const far = new Impostors(tile, scene);
  const grass = new Grass(tile, scene);
  const flight = new RavenFlight(camera, tile.heights, renderer.domElement);
  flight.reset(tile.size / 2, -tile.size / 2, 150);
  veg.radius = +$('detail').value; veg.update(flight.pos.x, flight.pos.z, true);
  const minimap = new MiniMap({ container: $('minimap'), sizeM: tile.size, imagery: tile.imagery, features: tile.features, flight });
  const goto = setupGoTo({ tile, flight, input: $('gotoInput'), button: $('gotoBtn'), line: $('gotoStatus') });
  if (pending) goto.go(pending, { fromLoad: true });

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
  status('');
  window.__we = { tile, flight, camera, veg, terrain, far, grass, scene, renderer, minimap };   // debugging handle

  let last = performance.now(), hudT = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    const s = seasonNow(), look = SEASON_LOOK[s], sun = sunDirection(tile.latitude, s, state.hour);
    const f = flight.update(dt);
    veg.update(flight.pos.x, flight.pos.z);
    const lights = sky.update(sun, look, camera);
    far.update(camera, veg.radius, lights.sunColor, lights.skyColor, scene.fog);
    grass.update(flight.pos.x, flight.pos.z, dt, camera, look, lights.skyColor.clone().multiplyScalar(0.8).add(lights.sunColor.clone().multiplyScalar(0.5)), scene.fog);
    terrain.setLook(look, sun); terrain.uniforms.sunColor.value.copy(lights.sunColor).multiplyScalar(sky.sun.intensity * 0.45); terrain.uniforms.skyColor.value.copy(lights.skyColor);
    terrain.uniforms.fogColor.value.copy(scene.fog.color); terrain.uniforms.fogNear.value = scene.fog.near; terrain.uniforms.fogFar.value = scene.fog.far;
    renderer.render(scene, camera);
    minimap.update(flight.pos, f.heading);
    hudT += dt;
    if (hudT > 0.15) {
      hudT = 0;
      $('agl').textContent = `${f.agl.toFixed(0)} m`; $('elev').textContent = `${f.elev.toFixed(0)} m`;
      $('speed').textContent = `${f.speed.toFixed(1)} m/s`; $('heading').textContent = `${f.heading.toFixed(0)}°`;
      $('habitat').textContent = HABITAT_NAMES[tile.habitat.at(flight.pos.x, -flight.pos.z)] || '–';
      $('trees').textContent = `${veg.count.toLocaleString()} near · ${far.count.toLocaleString()} far`;
      const h = Math.floor(state.hour), mnt = Math.round((state.hour - h) * 60); $('timeLabel').textContent = `${h}:${String(mnt).padStart(2, '0')} · sun ${(sun.elevation * 180 / Math.PI).toFixed(0)}°`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(e => { console.error(e); status('error: ' + e.message); });
