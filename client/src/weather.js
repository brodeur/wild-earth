import * as THREE from 'three';
import { windUniforms } from './wind.js';
import { groundUniforms } from './terrain.js';
import { uniforms as atmo } from './atmosphere.js';

// Weather (owner: "Every day has weather. The weather is today's weather for the square. Picking a season picks a
// random day between pre-dawn and post-dusk in the season to start, and the weather is the weather from that day last
// year.") The hours come from Open-Meteo (tile-spec client.weather): client/weather.json holds last year's and this
// year's days, hourly rows on the local wall clock (index 0 = 00:00), columns named by `fields`; the dev server's
// GET /api/weather/<tile> answers today (yesterday, today and tomorrow in the same `days` shape, plus `current`).
//
// The day: today (no date chosen) is today's weather from the server, else today's row in weather.json if the file
// has it, else the same calendar day last year; the start hour is now, held between pre-dawn and post-dusk. A chosen
// date 'MM-DD' is that day last year ('YYYY-MM-DD' that exact day, for tests) and the start hour a random one between
// pre-dawn (sunrise - 30 min) and post-dusk (sunset + 30 min). The game's hour is local solar time (season.js
// sunDirection: hour 12 is solar noon), so it is turned into the wall clock with the tile's longitude and the zone's
// offset on that date before the rows are read; the slider's range (main.js) is the day's pre-dawn..post-dusk in
// the same solar hours, so the drawn sun rises and sets near the measured times.
//
// Each frame update(dt, hour) interpolates the rows (precipitation, a sum over the hour before its row, is centred
// on the half hour; wind as a vector; the WMO code is the nearest hour's) into `now`, and derives `fx`, the few
// numbers the world reads:
//   slab, high      cumulus-slab and cirrus cover 0..1 (cloud_low and cloud_mid onto the slab, cloud_high the cirrus);
//                   atmosphere.js maps the slab cover onto its field's coverage offset (calibrated: COVER below)
//   overcast        how flat and grey the light is: 0 under broken cloud, 1 under a full deck
//   sunDim          the direct sun's factor (the deck, the cirrus veil, fog), on top of the local cloud shadows
//   cloudBase       m above the ground: the lifting condensation level, 125 m per degree of dew-point spread
//                   (raised toward 2.6 km when mid cloud dominates)
//   fog             0..1: WMO fog codes, or saturated air under a ground-level deck (the reanalysis gives no fog
//                   codes here: RH 97-100 % with low cloud is what a foggy foothill morning looks like in it)
//   hazeMul, hazeAdd  the aerosol's growth with humidity, sqrt(0.5 / (1 - RH)), and the extinction of rain
//                   (3e-4 per m at 1 mm/h, x rate^0.63), drizzle (4e-4) and snow; fog adds 3.5e-3 (about 1 km)
//   rain, snow      mm/h, cm/h (snow only at about 2 C or below and 0.3 cm/h or more: the reanalysis' warm traces
//                   are not drawn); wet 0..1, the ground's wetness (rain soaks it within the hour and it dries
//                   over hours, slower when humid and cold); snowCover / snowGrass the lying snow's cover
//   windKmh, windMs, windTo   speed and the direction it blows toward (x east, z south); gust 0.6..1.5, a slow swell
//   flash           a thunderstorm's lightning, 0..1 (atmosphere.js lights the sky with it; the rumble follows)
// It sets wind.js's strength and direction and the ground's wetness and snow (terrain.js groundUniforms.wxGround)
// itself, and draws the rain or snow (Precip below). main.js passes fx to atmosphere.update before spirit.js's look,
// so the spirit's view still lies over the weather.

const FIELDS = ['temp_c', 'humidity', 'precip_mm', 'rain_mm', 'snow_cm', 'snow_depth_m', 'cloud', 'cloud_low', 'cloud_mid', 'cloud_high', 'wind_kmh', 'wind_dir', 'gust_kmh', 'code'];
const F = Object.fromEntries(FIELDS.map((f, i) => [f, i]));
const SUMS = new Set([F.precip_mm, F.rain_mm, F.snow_cm]);   // accumulated over the hour before the row
const WMO = { 0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorm', 96: 'thunderstorm, hail', 99: 'thunderstorm, hail' };
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const hm = s => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] + m[2] / 60 : null; };
const NEUTRAL = { slab: 0, high: 0, overcast: 0, sunDim: 1, cloudBase: 1800, fog: 0, hazeMul: 1, hazeAdd: 0, rain: 0, drizzle: 0,
  snow: 0, wet: 0, snowCover: 0, snowGrass: 0, windKmh: 10, windMs: 2.8, windTo: [1, 0.25], gust: 1, flash: 0, rainVis: 0, temp: null, on: false };

// ---- Words (pure: the opening screen uses them too) ----------------------------------------------------------
// A WMO weather code in words ('light rain'), or '' for an unknown code.
export function weatherWords(code) { return WMO[Math.round(code)] ?? ''; }
// A snow code in an hour too warm for the snow to be drawn (weather.js draws it at about 2 C and below; the
// reanalysis reports snow codes for wet hours a few degrees above that) reads as the rain it would be.
const SNOW_AS_RAIN = { 71: 61, 73: 63, 75: 65, 77: 51, 85: 80, 86: 81 };
const asDrawn = (c, temp) => (temp != null && temp > 4 && SNOW_AS_RAIN[c] ? SNOW_AS_RAIN[c] : c);
const group = r => (r <= 2 ? 0 : r === 3 ? 1 : r <= 6 ? 2 : r);
// How notable a code is: clear 0, partly cloudy 1, overcast 2, fog 3, drizzle 4, rain 5, heavy rain 6, snow 7, thunder 8.
function rank(c) {
  return c >= 95 ? 8 : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 7 : c === 65 || c === 67 || c === 82 ? 6
    : (c >= 61 && c <= 66) || c === 80 || c === 81 ? 5 : c >= 51 && c <= 57 ? 4 : c === 45 || c === 48 ? 3 : c === 3 ? 2 : c === 2 ? 1 : 0;
}
// A day of weather.json's `days` (sunrise, sunset, tmax, tmin, precip_mm, hourly) as a short phrase for a label:
// "light rain, 11 °C", "fog, then sun, 14 °C". The daylight hours (sunrise to sunset, wall clock) are split in
// halves; each half is its worst wet, foggy or stormy code if it has one, else its commonest sky; the later half is
// added ("then") when it is clearly different. The temperature is the day's high. fields: the file's column names
// (by default the code is the last column and the temperature the first, as in weather.json and the server's answer).
// today: the server's today holds the hours so far and the forecast for the rest, so it reads the same.
export function summarizeDay(day, { today = false, fields = null } = {}) {
  void today;
  const rows = day?.hourly || [];
  const ci = fields ? fields.indexOf('code') : -1, ti = fields ? fields.indexOf('temp_c') : 0;
  const codeOf = r => (r ? r[ci >= 0 ? ci : r.length - 1] : null);
  const a = Math.max(0, Math.floor(hm(day?.sunrise) ?? 7)), b = Math.min(rows.length, Math.ceil(hm(day?.sunset) ?? 18));
  const pickHalf = (i0, i1) => {
    const cs = []; for (let i = i0; i < i1; i++) { const c = codeOf(rows[i]); if (c != null) cs.push(asDrawn(Math.round(c), ti >= 0 ? rows[i][ti] : null)); }
    if (!cs.length) return null;
    const worst = cs.reduce((x, c) => (rank(c) > rank(x) || (rank(c) === rank(x) && c > x) ? c : x), cs[0]);
    if (rank(worst) >= 3) return worst;
    const n = {}; for (const c of cs) n[c] = (n[c] || 0) + 1;
    return +Object.entries(n).sort((x, y) => y[1] - x[1] || +y[0] - +x[0])[0][0];
  };
  const mid = Math.round((a + b) / 2), c1 = pickHalf(a, mid), c2 = pickHalf(mid, b);
  const first = c1 ?? c2;
  let words = first != null ? weatherWords(first) || 'clear' : '';
  if (c1 != null && c2 != null) {
    const r1 = rank(c1), r2 = rank(c2);
    if (group(r1) !== group(r2) || (group(r1) === 0 && Math.abs(r1 - r2) >= 2)) words += `, then ${r2 === 0 ? 'sun' : weatherWords(c2) || 'clear'}`;
  }
  let t = day?.tmax;
  if (t == null && ti >= 0) for (const r of rows) if (r?.[ti] != null) t = Math.max(t ?? -99, r[ti]);
  const temp = t != null ? `${Math.round(t)} °C` : '';
  return [words, temp].filter(Boolean).join(', ');
}

// The zone's offset from UTC (hours) on a date, from the browser's time-zone rules.
function zoneOffset(tz, y, m, d, fallback) {
  try {
    const t = Date.UTC(y, m - 1, d, 12);
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(t)).map(x => [x.type, +x.value]));
    return (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - t) / 3600e3;
  } catch { return fallback; }
}
// Today's wall-clock date in the zone.
function zoneToday(tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date()).map(x => [x.type, +x.value]));
    return [p.year, p.month, p.day];
  } catch { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; }
}

export class Weather {
  constructor({ tile, scene, renderer, camera }) {
    this.tile = tile; this.camera = camera;
    const b = tile.manifest?.bounds_wgs84;
    this.lon = b ? (b[0] + b[2]) / 2 : -120.9;
    this.file = null; this.today = null; this.day = null;
    this.now = Object.fromEntries(FIELDS.map(f => [f, null]));
    this.fx = { ...NEUTRAL };
    this.precip = new Precip(scene, renderer, camera);
    this.t = 0; this.flashT = 0; this.nextFlash = 0; this.onThunder = null;
    this.ready = this.load();
  }

  async load() {
    const L = this.tile.manifest?.layers?.['client.weather'];
    const file = L ? fetch(this.tile.dir + L.path).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
    const today = fetch(`/api/weather/${encodeURIComponent(this.tile.id)}`, { signal: ctl.signal, cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null).catch(() => null).finally(() => clearTimeout(timer));
    [this.file, this.today] = await Promise.all([file, today]);
    if (this.today && !this.today.days) this.today = null;
    if (this.file?.longitude != null) this.lon = this.file.longitude;
    this.tz = this.file?.timezone || this.today?.timezone || 'America/Los_Angeles';
    this.fallbackOff = (this.file?.utc_offset_seconds ?? this.today?.utc_offset_seconds ?? -this.lon / 15 * 3600) / 3600;
    return !!(this.file || this.today);
  }
  get loaded() { return !!(this.file || this.today); }

  // Rows of one source's day as arrays in FIELDS order (missing columns null), or null.
  _rows(src, key) {
    const d = src?.days?.[key]; if (!d?.hourly) return null;
    const idx = FIELDS.map(f => (src.fields || []).indexOf(f));
    return d.hourly.map(r => idx.map(i => (i >= 0 && r[i] != null ? +r[i] : null)));
  }

  // Choose the day: dateStr null (today), 'MM-DD' (that day last year) or 'YYYY-MM-DD'. Returns
  // { key, pre, post, start, today } in solar hours, or null when there is no weather for it.
  pick(dateStr = null) {
    if (!this.loaded) return null;
    const [ty, tm, td] = zoneToday(this.tz);
    let y, m, d, src = null, isToday = false;
    if (!dateStr) {
      const cur = /^(\d{4})-(\d{2})-(\d{2})/.exec(this.today?.current?.time || '');
      [y, m, d] = cur ? [+cur[1], +cur[2], +cur[3]] : [ty, tm, td];
      const key = ymd(y, m, d);
      if (this.today?.days?.[key]) { src = this.today; isToday = true; }
      else if (this.file?.days?.[key]?.hourly?.some(r => r.some(v => v != null))) { src = this.file; isToday = true; }
      else { y -= 1; if (m === 2 && d === 29) d = 28; }
    } else {
      const g = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(dateStr); if (!g) return this.pick(null);
      [y, m, d] = [g[1] ? +g[1] : ty - 1, +g[2], +g[3]];
      if (!g[1] && m === 2 && d === 29) d = 28;
    }
    let key = ymd(y, m, d);
    if (!src) src = this.file?.days?.[key] ? this.file : this.today?.days?.[key] ? this.today : null;
    if (!src) {   // outside the file: the nearest day it has
      const keys = Object.keys(this.file?.days || {}).sort(); if (!keys.length) return null;
      const t = Date.UTC(y, m - 1, d);
      key = keys.reduce((a, k) => Math.abs(Date.parse(k) - t) < Math.abs(Date.parse(a) - t) ? k : a, keys[0]);
      src = this.file; [y, m, d] = key.split('-').map(Number);
    }
    // three days of rows, yesterday and tomorrow from either source, else the day's own first or last row repeated
    const day = src.days[key], rows = this._rows(src, key);
    const near = k => this._rows(this.file, k) || this._rows(this.today, k);
    const dk = n => { const t = new Date(Date.UTC(y, m - 1, d + n)); return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
    const prev = near(dk(-1)) || Array.from({ length: 24 }, () => rows[0].slice());
    const next = near(dk(1)) || Array.from({ length: 24 }, () => rows[rows.length - 1].slice());
    const S = [...prev.slice(0, 24), ...rows.slice(0, 24), ...next.slice(0, 24)];
    while (S.length < 72) S.push(S[S.length - 1].slice());
    // nulls: the neighbouring hour's value (nearest on either side)
    for (let f = 0; f < FIELDS.length; f++) {
      let last = null; const fwd = S.map(r => (r[f] != null ? (last = r[f]) : last));
      last = null; for (let i = S.length - 1; i >= 0; i--) { if (S[i][f] != null) last = S[i][f]; else S[i][f] = fwd[i] ?? last; }
    }
    // the ground's wetness through the three days: soaked by rain within the hour, drying over hours
    const wet = new Float32Array(72); let w = 0;
    for (let i = 0; i < 72; i++) {
      const r = S[i], p = r[F.rain_mm] ?? r[F.precip_mm] ?? 0, t = r[F.temp_c] ?? 10, rh = r[F.humidity] ?? 60;
      w += (1 - w) * (1 - Math.exp(-p / 0.4));
      const tau = (2 + 10 * clamp((rh - 40) / 55) + 4 * clamp((r[F.cloud] ?? 0) / 100)) * (t < 5 ? 1.6 : 1);
      w *= Math.exp(-1 / tau); wet[i] = w;
    }
    const off = zoneOffset(this.tz, y, m, d, this.fallbackOff);
    this.toWall = -this.lon / 15 + off;   // wall clock = solar hour + toWall
    const sr = hm(day.sunrise), ss = hm(day.sunset);
    const pre = (sr ?? 6.5) - this.toWall - 0.5, post = (ss ?? 18) - this.toWall + 0.5;
    let start;
    if (isToday) { const n = new Date(), solar = n.getUTCHours() + n.getUTCMinutes() / 60 + this.lon / 15; start = clamp(((solar % 24) + 24) % 24, pre, post); }
    else start = pre + Math.random() * (post - pre);
    this.day = { key, y, m, d, S, wet, pre, post, today: isToday, server: src === this.today, label: isToday ? 'today' : y === ty - 1 ? `last year's ${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}` };
    this.fx.on = true;
    return { key, pre, post, start, today: isToday };
  }

  // Interpolated row at solar hour h (series index 24 + wall hour).
  _sample(h) {
    const D = this.day, x = 24 + h + this.toWall, S = D.S, o = this.now;
    const at = (f, xi) => { const i = clamp(Math.floor(xi), 0, 70), t = clamp(xi - i); return S[i][f] + (S[i + 1][f] - S[i][f]) * t; };
    for (let f = 0; f < FIELDS.length; f++) {
      if (f === F.wind_dir || f === F.code) continue;
      o[FIELDS[f]] = S[0][f] == null ? null : at(f, SUMS.has(f) ? x + 0.5 : x);
    }
    // wind: the vector it blows toward, interpolated, so a veer through north goes the short way
    const i = clamp(Math.floor(x), 0, 70), t = clamp(x - i), vec = k => { const s = S[k][F.wind_kmh] ?? 0, a = (S[k][F.wind_dir] ?? 270) * Math.PI / 180; return [-Math.sin(a) * Math.max(s, 0.5), Math.cos(a) * Math.max(s, 0.5)]; };
    const a = vec(i), b = vec(i + 1), vx = a[0] + (b[0] - a[0]) * t, vz = a[1] + (b[1] - a[1]) * t;
    o.wind_dir = ((Math.atan2(-vx, vz) * 180 / Math.PI) + 360) % 360;
    this._to = [vx / (Math.hypot(vx, vz) || 1), vz / (Math.hypot(vx, vz) || 1)];
    o.code = S[clamp(Math.round(x), 0, 71)][F.code];
    o.wet = D.wet[i] + (D.wet[i + 1] - D.wet[i]) * t;
    return o;
  }

  update(dt, hour) {
    this.t += dt;
    const fx = this.fx;
    if (!this.day) { this.precip.update(dt, fx); return fx; }
    const n = this._sample(hour), code = n.code ?? 0;
    const T = n.temp_c ?? 10, RH = clamp((n.humidity ?? 60) / 100, 0.01, 1);
    const low = clamp((n.cloud_low ?? 0) / 100), mid = clamp((n.cloud_mid ?? 0) / 100), high = clamp((n.cloud_high ?? 0) / 100);
    fx.slab = 1 - (1 - low) * (1 - 0.85 * mid);
    fx.high = high;
    fx.overcast = smooth(0.55, 0.98, fx.slab);
    // cloud base: dew-point spread (Magnus) x 125 m, lifted toward mid-level when that is the deck
    const g = Math.log(RH) + 17.62 * T / (243.12 + T), td = 243.12 * g / (17.62 - g);
    const lcl = clamp(125 * (T - td), 0, 3000);
    fx.cloudBase = clamp(lcl + (2600 - lcl) * clamp(mid / Math.max(low + mid, 1e-3)) * smooth(0.05, 0.4, mid), 300, 2600);
    const wind = n.wind_kmh ?? 8;
    const fogCode = code === 45 || code === 48 ? 1 : 0;
    fx.fog = Math.max(fogCode, smooth(0.95, 1.0, RH) * smooth(0.5, 1, low) * smooth(250, 0, lcl), 0.45 * smooth(0.97, 1.0, RH)) * (1 - smooth(12, 28, wind) * (1 - fogCode));
    fx.drizzle = code >= 51 && code <= 57 ? 1 : 0;
    const snowOk = smooth(4.0, 1.5, T);
    fx.snow = (n.snow_cm ?? 0) >= 0.3 ? (n.snow_cm ?? 0) * snowOk : 0;
    fx.rain = Math.max(0, (n.rain_mm ?? n.precip_mm ?? 0)) + (fx.snow > 0 ? 0 : Math.max(0, (n.snow_cm ?? 0) * 0.7));
    if (fx.drizzle && fx.rain < 0.05) fx.rain = 0.05;
    fx.rainVis = smooth(0, 4, fx.rain);
    fx.hazeMul = clamp(Math.sqrt(0.5 / (1 - Math.min(RH, 0.97))), 0.75, 3.2);
    fx.hazeAdd = 3e-4 * Math.pow(fx.rain, 0.63) + 4e-4 * fx.drizzle + 1.2e-3 * Math.pow(fx.snow, 0.7) + 3.5e-3 * fx.fog;
    fx.sunDim = (1 - 0.55 * fx.overcast) * (1 - 0.3 * high) * (1 - 0.75 * fx.fog) * (1 - 0.3 * fx.rainVis);
    fx.wet = n.wet;
    const depth = n.snow_depth_m ?? 0, lying = smooth(6, 2, T) * (depth >= 0.02 ? 1 : 0);
    fx.snowCover = smooth(0.0, 0.06, depth) * lying + 0.5 * smooth(0, 1.5, fx.snow);
    fx.snowGrass = smooth(0.02, 0.25, depth) * lying + 0.25 * smooth(0, 1.5, fx.snow);
    fx.windKmh = wind; fx.windMs = wind / 3.6; fx.windTo = this._to; fx.temp = T;
    // gusts: a slow swell, as strong as the gust ratio when the source gives one
    const gr = n.gust_kmh != null && wind > 1 ? clamp(n.gust_kmh / wind - 1, 0.1, 1.2) : 0.35, s = this.t;
    fx.gust = clamp(1 + gr * 0.6 * (0.6 * Math.sin(s * 2 * Math.PI / 37) * Math.sin(s * 2 * Math.PI / 13 + 1) + 0.4 * Math.sin(s * 2 * Math.PI / 71 + 2)), 0.6, 1.5);
    // wind.js: strength 0.12 calm, 0.42 at 10 km/h, about 1 at 40 km/h
    windUniforms.windStrength.value = (0.12 + 0.3 * Math.pow(wind / 10, 0.8)) * fx.gust;
    windUniforms.windDir.value.set(this._to[0], this._to[1]);
    groundUniforms.wxGround.value.set(fx.wet, fx.snowCover, fx.snowGrass);
    // lightning: a flash every 8-40 s in a thunderstorm hour, two or three flickers, the rumble 1-10 s after
    fx.flash = 0;
    if (code >= 95) {
      if (this.t > this.nextFlash) {
        const dist = 300 + Math.random() * 3000;
        this.flashT = this.t; this.flashK = clamp(1.4 - dist / 3500, 0.3, 1); this.nextFlash = this.t + 8 + Math.random() * 32;
        this.onThunder?.(dist / 343, this.flashK);
      }
      const e = this.t - this.flashT;
      if (e < 0.6) fx.flash = this.flashK * (Math.exp(-e / 0.06) + 0.6 * Math.exp(-Math.abs(e - 0.18) / 0.04) + 0.3 * Math.exp(-Math.abs(e - 0.35) / 0.05));
    }
    this.precip.update(dt, fx);
    return fx;
  }

  // HUD: "light rain · 11 °C · wind 20 km/h SW" and the day it is.
  describe() {
    if (!this.day) return null;
    const n = this.now, fx = this.fx, code = fx.snow > 0 ? n.code ?? 0 : asDrawn(n.code ?? 0, n.temp_c);
    let w = WMO[code] ?? (code ? `code ${code}` : 'clear');
    if (code <= 3 && fx.fog > 0.5) w = fx.fog > 0.8 ? 'fog' : 'mist';
    if (fx.snow > 0 && !(code >= 71 && code <= 86)) w = 'snow';
    const sunUp = atmo.sunDir.value.y > 0;
    if (!sunUp && (code === 0 || code === 1)) w = code ? 'mostly clear' : 'clear';
    const dir = COMPASS[Math.round((n.wind_dir ?? 0) / 45) % 8];
    return { text: `${w} · ${Math.round(n.temp_c ?? 0)} °C · wind ${Math.round(fx.windKmh)} km/h ${dir}`, note: this.day.label };
  }
}

// ---- Rain and snow: one Points object round the camera ---------------------------------------------------
// MAX drops in a box of BOX m (half sizes; SNOW_BOX for snow) that follows the camera: each drop's seed position falls with the wind's
// lean and wraps in the box, so nothing is written per frame but uniforms (and the draw range, from the rate). A drop
// is a point sprite covering its streak on screen: the vertex shader projects the head and the tail (the head minus
// the velocity times the exposure), the fragment shader draws the segment between them; snow is the same with a
// short exposure, a slow fall, a sway and a wider round flake. Nothing is drawn above the cloud base, and the drops
// fade out toward the box's sides so the wrap never shows.
const MAX = 7000, BOX = [20, 14, 20], SNOW_BOX = [13, 10, 13];   // half sizes (m): snow's flakes are only seen near
const PRECIP_VERT = /* glsl */`
  attribute vec4 aSeed;
  uniform vec3 uCam; uniform vec3 uBox; uniform float uTime; uniform vec3 uVel; uniform float uStreak; uniform float uSnow;
  uniform float uCloudY; uniform vec2 uRes; uniform float uPx; uniform float uSize; uniform float uMaxPt;
  varying vec4 vSeg; varying float vHalf; varying float vW; varying float vA;
  void main() {
    float sp = 0.8 + 0.4 * aSeed.w, ph = aSeed.w * 6.2832;
    vec3 rel = mod((aSeed.xyz * 2.0 - 1.0) * uBox + uVel * sp * uTime - uCam + uBox, 2.0 * uBox) - uBox;
    vec3 w = uCam + rel + uSnow * vec3(sin(uTime * (0.6 + aSeed.w) + ph), 0.0, cos(uTime * (0.45 + aSeed.x) + ph * 1.3)) * 0.35;
    vec3 tl = w - uVel * sp * uStreak;
    vec3 e = abs(rel) / uBox;
    float a = (1.0 - smoothstep(0.7, 1.0, max(e.x, e.z))) * (1.0 - smoothstep(0.8, 1.0, e.y)) * step(w.y, uCloudY) * smoothstep(0.4, 1.2, length(rel));
    vec4 ca = projectionMatrix * viewMatrix * vec4(w, 1.0), cb = projectionMatrix * viewMatrix * vec4(tl, 1.0);
    if (a <= 0.0 || ca.w < 0.3 || cb.w < 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vec2 sa = ca.xy / ca.w * uRes * 0.5, sb = cb.xy / cb.w * uRes * 0.5;
    float raw = uSize * uPx / ca.w, wd = clamp(raw, 0.8, 7.0);
    vec2 d = sb - sa; float L = length(d), maxL = uMaxPt - 2.0 * wd - 4.0;
    if (L > maxL) sb = sa + d * (maxL / L);
    vec2 mid = 0.5 * (sa + sb);
    float size = length(sb - sa) + 2.0 * wd + 3.0;
    gl_PointSize = size;
    gl_Position = vec4(mid / (uRes * 0.5) * ca.w, ca.z, ca.w);
    vSeg = vec4(sa - mid, sb - mid); vHalf = 0.5 * size; vW = 0.5 * wd;
    vA = a * clamp(raw / 0.8, 0.25, 1.0);
  }`;
const PRECIP_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity; uniform float uSnow;
  varying vec4 vSeg; varying float vHalf; varying float vW; varying float vA;
  void main() {
    vec2 q = (gl_PointCoord - 0.5) * vec2(1.0, -1.0) * (2.0 * vHalf);
    vec2 a = vSeg.xy, ab = vSeg.zw - vSeg.xy;
    float t = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0), dd = length(q - a - ab * t);
    float cov = 1.0 - smoothstep(vW * 0.4, vW + 0.8, dd);
    float alpha = cov * vA * uOpacity * mix(1.0 - 0.5 * t, 1.0, uSnow);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Precip {
  constructor(scene, renderer, camera) {
    this.renderer = renderer; this.camera = camera;
    const g = new THREE.BufferGeometry(), seed = new Float32Array(MAX * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setDrawRange(0, 0);
    const gl = renderer.getContext(), range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this.u = {
      uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...BOX) }, uTime: { value: 0 }, uVel: { value: new THREE.Vector3(0, -7, 0) },
      uStreak: { value: 0.06 }, uSnow: { value: 0 }, uCloudY: { value: 1e9 }, uRes: { value: new THREE.Vector2(1, 1) }, uPx: { value: 1000 },
      uSize: { value: 0.004 }, uMaxPt: { value: Math.min(range?.[1] || 64, 256) }, uColor: { value: new THREE.Color(0.5, 0.5, 0.5) }, uOpacity: { value: 0.5 },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: PRECIP_VERT, fragmentShader: PRECIP_FRAG, uniforms: this.u, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false; this.points.renderOrder = 5; this.points.name = 'precip'; this.points.visible = false;
    scene.add(this.points);
    this._v = new THREE.Vector2(); this.enabled = true;
  }
  update(dt, fx) {
    const u = this.u, snow = fx.snow > 0 ? 1 : 0, rate = snow ? fx.snow : fx.rain;
    const n = !this.enabled || rate <= 0 ? 0 : Math.round(MAX * clamp(snow ? 0.35 + 0.45 * Math.log2(1 + rate) : 0.22 + 0.26 * Math.log2(1 + rate), 0.12, 1));
    this.points.geometry.setDrawRange(0, n); this.points.visible = n > 0; this.count = n;
    if (!n) return;
    u.uTime.value = (u.uTime.value + dt) % 3600;
    const cam = this.camera, ws = fx.windMs * fx.gust, drizzle = fx.drizzle && fx.rain < 1;
    const fall = snow ? 1.0 : drizzle ? 3.5 : 6 + 2 * clamp(fx.rain / 8);
    const lean = snow ? 0.8 : 0.6;
    u.uVel.value.set(fx.windTo[0] * ws * lean, -fall, fx.windTo[1] * ws * lean);
    u.uStreak.value = snow ? 0.02 : drizzle ? 0.05 : 0.07;
    u.uSize.value = snow ? 0.025 : drizzle ? 0.0025 : 0.004;
    u.uSnow.value = snow; u.uBox.value.set(...(snow ? SNOW_BOX : BOX));
    u.uCam.value.copy(cam.position);
    u.uCloudY.value = atmo.cloudHeight.value;
    const b = this.renderer.getDrawingBufferSize(this._v);
    u.uRes.value.copy(b); u.uPx.value = b.y / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    // lit like the air: the sky light, a little sun; snow takes the sun on its faces
    const sy = Math.max(atmo.sunDir.value.y, 0);
    const c = u.uColor.value, sl = atmo.sunLight.value, ks = snow ? 0.6 * sy : 0.08, ka = snow ? 1.4 : 0.75;
    c.copy(atmo.ambientSky.value).multiplyScalar(ka); c.r += sl.r * ks; c.g += sl.g * ks; c.b += sl.b * ks; c.multiplyScalar(0.3183);
    u.uOpacity.value = snow ? 0.9 : drizzle ? 0.35 : 0.45 + 0.2 * clamp(fx.rain / 10);
  }
}
