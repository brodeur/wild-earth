// "Go to lat, lon": fly there inside this tile, switch to the tile that holds it (main.js builds it in place of
// this one: no reload, no URL change), or ask the dev server to build that tile first. The point is never
// written to the URL or sent anywhere but the local dev server, which snaps it to a tile and drops it.

// "38.70, -120.88" or "38.70 -120.88" -> { lat, lon } | { error }
export function parseLatLon(text) {
  const parts = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length !== 2) return { error: 'enter two numbers: lat, lon' };
  const [lat, lon] = parts.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: 'not a number' };
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: 'out of range; expected lat, lon' };
  if (lat < -80 || lat > 84) return { error: 'outside the UTM grid (lat -80 to 84)' };
  return { lat, lon };
}

// WGS84 lon/lat -> UTM easting/northing in a given zone (Snyder 1987, USGS PP 1395, eq. 8-9..8-15).
// Good to well under a metre within the zone.
export function lonLatToUtm(lon, lat, zone, north = true) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), e4 = e2 * e2, e6 = e4 * e2, ep2 = e2 / (1 - e2);
  const rad = Math.PI / 180, phi = lat * rad, lam0 = ((zone - 1) * 6 - 180 + 3) * rad;
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  const T = tan * tan, C = ep2 * cos * cos, A = cos * (lon * rad - lam0);
  const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi));
  const easting = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const northing = (north ? 0 : 10000000) + k0 * (M + N * tan * (A * A / 2
    + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return { easting, northing };
}

// Tile-local client coordinates (x east of the west edge, north of the south edge), or null if outside.
export function localXY(tile, lat, lon) {
  const m = /^utm(\d+)([ns])_/.exec(tile.id);
  if (!m) return null;
  const { easting, northing } = lonLatToUtm(lon, lat, +m[1], m[2] === 'n');
  const [x0, y0] = tile.manifest.bounds;
  const x = easting - x0, north = northing - y0;
  return x >= 0 && x <= tile.size && north >= 0 && north <= tile.size ? { x, north } : null;
}

const fmt = p => `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('json')) throw Object.assign(new Error('no API'), { noApi: true });
  return { ok: r.ok, status: r.status, data: await r.json() };
}

// Tile-local { x, north } of a point in the 10 km tile named by `id` (ids give exact UTM bounds), or null.
export function pointInTileId(id, p, size = 10000) {
  const m = /^utm(\d+)([ns])_(\d+)_(\d+)$/.exec(id || '');
  if (!m) return null;
  const { easting, northing } = lonLatToUtm(p.lon, p.lat, +m[1], m[2] === 'n');
  const x = easting - m[3] * 1000, north = northing - m[4] * 1000;
  return x >= 0 && x < size && north >= 0 && north < size ? { x, north } : null;
}

// Without the API: a built tile from tiles/index.json that holds the point.
async function indexTileFor(p) {
  try {
    const idx = await (await fetch('../tiles/index.json', { cache: 'no-cache' })).json();
    return idx.tiles.map(t => t.tile_id).find(id => pointInTileId(id, p)) || null;
  } catch { return null; }
}

// Which tile holds this point, built or not: { tile_id, built } from the dev server; without it,
// { tile_id, built: true } for a built tile in the index, else { noApi: true }. Throws on a bad point.
export async function lookupTile(p) {
  try {
    const { ok, data } = await api('/api/tile', { lon: p.lon, lat: p.lat });
    if (!ok) throw new Error(data.error || 'bad location');
    return { tile_id: data.tile_id, built: !!data.built };
  } catch (e) {
    if (!(e.noApi || e instanceof TypeError)) throw e;
    const id = await indexTileFor(p);
    return id ? { tile_id: id, built: true } : { noApi: true };
  }
}

export const noServerText = p => `needs the dev server: .venv/bin/python server.py — or build by hand: .venv/bin/python -m pipeline.build_tile --anchor ${p.lon} ${p.lat}`;

// Which built tile holds this point? Resolves to a tile id, or null if none is built.
export async function builtTileFor(p) {
  try { const { data } = await api('/api/tile', { lon: p.lon, lat: p.lat }); return data.built ? data.tile_id : null; }
  catch { return indexTileFor(p); }
}

// A ?lat=&lon= in the URL (a point to land at; main.js takes it off the URL), or null.
export function urlPoint(params) {
  if (!params.has('lat') || !params.has('lon')) return null;
  const q = parseLatLon(`${params.get('lat')} ${params.get('lon')}`);
  return q.error ? null : q;
}

// Ask the dev server to build the tile holding `p`, reporting progress through say(text, err), and switch to it
// (go(id, p)) when it is playable. Resolves once the build is under way or refused; another Go cancels the polling.
export async function buildTile(p, id, say, go) {
  const b = await api('/api/build', { lon: p.lon, lat: p.lat });
  if (b.status === 409) return say(`another tile is building (${b.data.running}); try again when it finishes`, true);
  if (!b.ok) return say(b.data.error || 'build refused', true);
  if (b.data.status === 'built') return go(id, p);
  say(`building ${id}…`);
  const poll = async () => {
    try {
      const { data: j } = await api(`/api/build/${id}`);
      const done = (j.steps || []).map(s => `${s.step} ${s.ok ? '✓' : '✗'}`);
      if (j.current) done.push(`${j.current} …`);
      if (j.status === 'done' || j.status === 'built') { say(`built ${id}; loading…`); return go(id, p); }
      if (j.status === 'failed') {
        say(`build of ${id} failed: ${done.join(' ')}${j.playable ? ' (playable anyway; ' : ' ('}see the server log)`, true);
        if (j.playable) buildTile.timer = setTimeout(() => go(id, p), 2500);
        return;
      }
      say(`building ${id}: ${done.join(' ')}`);
    } catch { say(`lost the dev server while building ${id}`, true); return; }
    buildTile.timer = setTimeout(poll, 3000);
  };
  clearTimeout(buildTile.timer); poll();
}

// The in-game Location box, the page's (set up once, main.js): current() is the world the page holds now, as
// { tile, flight, ready } (ready once it can be flown), or null while none; switchTile(id, p) builds that tile in
// place of it and arrives at p. A point in the tile flown now is flown to; a point in a tile still building (or in
// the one building now, so the arrival lands on it) switches; a Go while a tile builds abandons that build.
export function setupGoTo({ input, button, line, current, switchTile }) {
  const say = (t, err = false) => { line.textContent = t; line.classList.toggle('err', err); };

  function flyTo(p, loc, flight) {
    const yaw = flight.yaw;
    flight.reset(loc.x, -loc.north, 150);
    flight.yaw = yaw;   // keep the heading
    say(`flying to ${fmt(p)}`);
  }

  async function go(p, { fromLoad = false } = {}) {
    clearTimeout(buildTile.timer);
    if (fromLoad) input.value = `${p.lat}, ${p.lon}`;   // so Go can act on it
    const cur = current(), tile = cur?.tile || null;
    const loc = tile && localXY(tile, p.lat, p.lon);
    if (loc && cur.ready) return flyTo(p, loc, cur.flight);
    if (loc) { say(`loading ${tile.id}…`); return switchTile(tile.id, p); }
    say('looking up tile…');
    try {
      const { ok, data } = await api('/api/tile', { lon: p.lon, lat: p.lat });
      if (!ok) return say(data.error || 'bad location', true);
      if (tile && data.tile_id === tile.id) return say(`${fmt(p)} is at the edge of this tile`, true);
      if (data.built) { say(`loading ${data.tile_id}…`); return switchTile(data.tile_id, p); }
      if (fromLoad) return say(`tile ${data.tile_id} is not built; press Go to build it`);
      say(`tile ${data.tile_id} not built; building…`);
      await buildTile(p, data.tile_id, say, switchTile);
    } catch (e) {
      if (!(e.noApi || e instanceof TypeError)) return say('error: ' + e.message, true);
      const id = await indexTileFor(p);   // static server: built tiles still work
      if (id && id !== tile?.id) { say(`loading ${id}…`); return switchTile(id, p); }
      return say(noServerText(p), true);
    }
  }

  function submit() {
    const p = parseLatLon(input.value);
    if (p.error) return say(p.error, true);
    go(p);
  }
  button.onclick = submit;
  // keep typing out of the flight controls (they listen on window)
  for (const ev of ['keydown', 'keyup']) input.addEventListener(ev, e => { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Enter') submit(); });
  return { go, say };
}
