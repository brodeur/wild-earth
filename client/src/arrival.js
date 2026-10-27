import * as THREE from 'three';
import { pointInTileId } from './goto.js';
import { SEASONS, seasonOfDate, parseDate } from './season.js';
import { PlaceNames } from './placenames.js';

// The weather words come from weather.js when it is there (loaded apart, so the screen still opens without it:
// dayWords below has its own small table until then, and the label is redrawn once the module arrives).
let summarizeDay = null, weatherWords = null, onWeatherWords = null;
import('./weather.js').then(m => { summarizeDay = m.summarizeDay; weatherWords = m.weatherWords; onWeatherWords?.(); }).catch(() => { /* no weather module: the table below */ });

// The opening screen and the arrival (docs/brief.md, "Worlds: a location plus a season"): joining is
// two choices, where and when, made before the world appears (the player arrives as a spirit); then a
// scripted 12 s flight brings the player in over the chosen point, so the first thing they see is their own hills.
//
// OpeningScreen fills #opening. It starts dark, the spirit's wisp turning alone while the screen's own assets load (no
// world is built for it); then across the top a season slider from spring to the following winter rises in with, under
// it, a row of tall portrait cards, one per built tile (its map full bleed, its locality and roads as the title), none
// chosen. Hovering a card grows it a little; clicking it grows it more under a cover with the wisp as the spinner and
// the tile's animals gathering below it, and asks main.js (onSelect) to build that world behind the screen; its Begin
// appears when main.js reports it ready (setReady). Clicking another card meanwhile moves all of that to the new card
// and main.js drops the old build: no reload, no URL change. The wisp and the animals are pre-rendered
// (client/assets/opening/, client/tools/opening_sprites.html) and played by CSS alone, so nothing on the screen animates
// from JavaScript while a world builds on the same thread. The selected card, Begin and the slider's marks take the
// season colour under the slider's thumb.
// Other places and new tiles are reached in the world (the panel's Location box, goto.js).
// Arrival drives RavenFlight's pose and chase camera until it hands control to the player.

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROAD_WEIGHT = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 1.5 };
const LAST_TILE = 'we.lastTile';

export const lastTile = () => { try { return localStorage.getItem(LAST_TILE); } catch { return null; } };
export const rememberTile = id => { try { localStorage.setItem(LAST_TILE, id); } catch { /* storage off */ } };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const getJSON = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);

// The tile's best-known roads: named roads ranked by length times class, e.g. "Route 50, Missouri Flat Road".
function majorRoads(features, n = 2) {
  const score = new Map();
  for (const r of features?.roads || []) {
    const w = ROAD_WEIGHT[r.kind] || 0; if (!r.name || !w || !r.path) continue;
    let len = 0; for (let k = 1; k < r.path.length; k++) len += Math.hypot(r.path[k][0] - r.path[k - 1][0], r.path[k][1] - r.path[k - 1][1]);
    score.set(r.name, (score.get(r.name) || 0) + len * w);
  }
  return [...score].sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}

// The tile's locality for its card: the best-ranked OSM place in features.json `places` (pipeline/fetch_places.py),
// ties to the one nearest the tile's centre; null when the tile has none.
const PLACE_RANK = { city: 0, town: 1, village: 2, suburb: 3, neighbourhood: 4, hamlet: 5, locality: 6 };
function locality(features) {
  const size = features?.size_m || 10000, c = size / 2;
  const ps = (features?.places || []).filter(p => p.name && p.kind in PLACE_RANK);
  ps.sort((a, b) => PLACE_RANK[a.kind] - PLACE_RANK[b.kind] || Math.hypot(a.x - c, a.north - c) - Math.hypot(b.x - c, b.north - c));
  return ps[0]?.name || null;
}

// A day's weather in words for the slider's label ("light rain, 11 °C"): weather.js summarizeDay; should it fail,
// the commonest daylight code and the high in a small table of WMO codes.
function dayWords(day, opts) {
  try { const w = summarizeDay?.(day, opts); if (w) return w; } catch { /* below */ }
  const WMO = c => c === 0 ? 'clear' : c <= 3 ? 'partly cloudy' : c <= 48 ? 'fog' : c <= 57 ? 'drizzle' : c <= 67 ? 'rain' : c <= 77 ? 'snow' : c <= 82 ? 'showers' : 'thunderstorm';
  const ci = (opts.fields || []).indexOf('code'), n = {};
  for (const r of (day?.hourly || []).slice(9, 18)) { const c = Math.round(r?.[ci >= 0 ? ci : r.length - 1]); if (c >= 0) n[c] = (n[c] || 0) + 1; }
  const code = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0];
  return [code != null ? (weatherWords?.(+code) || WMO(+code)) : '', day?.tmax != null ? `${Math.round(day.tmax)} °C` : ''].filter(Boolean).join(', ');
}

// ---- the season slider's year ----------------------------------------------------------------------
// Spring (left end) to the following winter (right end), the season titles at the thirds: Mar 20, Jun 21,
// Sep 22, Dec 20 sit at 0, 1/3, 2/3 and 1, linear by day between them; it does not wrap. A step is a day:
// day i is March 20 + i. Today outside that span (Dec 21 to Mar 19) sits on the end of its own season.
const ANCHORS = [[2, 20], [5, 21], [8, 22], [11, 20]];   // [month 0-based, day]
const TITLES = ['spring', 'summer', 'fall', 'winter'];
const DAY_MS = 864e5;
class SeasonYear {
  constructor(year = new Date().getFullYear()) {
    this.year = year;
    const d0 = new Date(year, 2, 20, 12);
    this.a = ANCHORS.map(([m, d]) => Math.round((new Date(year, m, d, 12) - d0) / DAY_MS));   // [0, 93, 186, 275]
    this.last = this.a[3];
  }
  date(i) { return new Date(this.year, 2, 20 + i, 12); }
  index(d) { return Math.round((new Date(this.year, d.getMonth(), d.getDate(), 12) - this.date(0)) / DAY_MS); }
  pos(i) {   // day -> 0..1 along the track
    const k = i >= this.a[2] ? 2 : i >= this.a[1] ? 1 : 0;
    return (k + (i - this.a[k]) / (this.a[k + 1] - this.a[k])) / 3;
  }
  at(p) {    // 0..1 along the track -> nearest day
    const q = Math.min(1, Math.max(0, p)) * 3, k = Math.min(2, Math.floor(q));
    return Math.round(this.a[k] + (q - k) * (this.a[k + 1] - this.a[k]));
  }
  // Today's day on the slider: inside the span its own day; outside, the end of its season (winter right, early March left).
  today(now = new Date()) {
    const i = this.index(now);
    return i >= 0 && i <= this.last ? i : seasonOfDate(now) === 'spring' ? 0 : this.last;
  }
}
const label = d => `${MONTH[d.getMonth()]} ${d.getDate()}`;
const PX_PER_M_CARD = 0.112;              // the lineup's scale: a metre as a fraction of the card's height (the deer ~15%)
const POP_GAP = [0.18, 0.42];             // s between the animals' arrivals
const FOOT_BELOW = 0.035, FOOT_MARGIN = 0.03;   // the ground animals' foot line: card heights under the card's bottom edge, and the least above the window's
const BOOT_MAX = 12;                      // s: the dark start waits at most this long for its assets
// The track's own season colours at its four titles (opening.css .op-track, the same stops): the selected card's
// highlight, the Begin button and the slider's marks take the colour under the thumb, continuously.
const TRACK = [[0x8f, 0xb5, 0x9a], [0xd8, 0xbd, 0x6a], [0xc9, 0x8a, 0x4e], [0x8e, 0xa4, 0xb4]];
function trackColor(p) {
  const q = Math.min(1, Math.max(0, p)) * 3, k = Math.min(2, Math.floor(q)), f = q - k;
  return `rgb(${TRACK[k].map((c, i) => Math.round(c + (TRACK[k + 1][i] - c) * f)).join(' ')})`;
}
const mmdd = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export class OpeningScreen {
  // index: tiles/index.json; tileId: an optional hint, the card to bring into the middle (nothing is chosen until a
  // click); pending: a { lat, lon } to arrive over (its tile becomes the hint); carried: { season, date } kept from an
  // earlier page; onSelect(tileId): a card was chosen, build its world (main.js aborts any other build); onBegin(choice)
  // is called inside the Begin click. main.js reports the build with setPrep(tileId, text) and setReady(tileId); the
  // older calls without a tileId mean the hint's tile (the one a page load built).
  constructor({ root, index, tileId = null, pending = null, carried = null, onBegin, onSelect = null }) {
    this.root = root; this.index = index; this.onBegin = onBegin; this.onSelect = onSelect;
    this.ids = index.tiles.map(t => t.tile_id);
    this.hint = this.ids.includes(tileId) ? tileId : null;
    this.tileId = this.hint;    // the chosen tile once one is chosen (main.js reads it), else the hint
    this.sel = null;            // the chosen tile
    this.year = new SeasonYear();
    this.todayDay = this.year.today();
    this.day = this.todayDay;   // the slider's day; on todayDay the game tracks today's date
    const cd = carried?.date && parseDate(carried.date);
    if (cd) { const i = this.year.index(cd); if (i >= 0 && i <= this.year.last) this.day = i; }
    else if (!carried?.date && SEASONS.includes(carried?.season) && carried.season !== seasonOfDate()) this.day = this.year.a[TITLES.indexOf(carried.season)];
    this.points = {};           // tile id -> { x, north }: where to arrive (else the centre)
    this.feat = {}; this.places = {}; this.wx = {}; this.wxToday = {}; this.status = {}; this.readyIds = new Set();
    this.begun = false;
    onWeatherWords = () => this.update();
    this.render();
    // The dark start (.boot): the wisp turning alone until the screen's own assets are in (the animal stills, the
    // cards' maps and titles, the weather label's data; no world is built for it), then the slider and the cards rise in.
    this.assets = this.loadAssets(pending);
    window.__weScreen = this;   // debugging handle (the main.js lane tests setPrep/setReady against it)
    // Keys typed on the screen stay on the screen (flight, peek, sound and the rest listen on window).
    this.guard = e => { if (!this.root.contains(e.target)) e.stopImmediatePropagation(); };
    for (const ev of ['keydown', 'keyup']) {
      addEventListener(ev, this.guard, true);
      root.addEventListener(ev, e => e.stopPropagation());
    }
  }

  $(sel) { return this.root.querySelector(sel); }

  get onToday() { return this.day === this.todayDay; }
  get date() { return this.onToday ? null : mmdd(this.year.date(this.day)); }
  get season() { return seasonOfDate(this.onToday ? new Date() : this.year.date(this.day)); }
  get point() { return this.points[this.tileId] || null; }   // main.js plans the arrival over it
  get labelTile() { return this.sel || this.hint || this.ids[0]; }   // whose weather the slider's label shows

  render() {
    const pct = p => `${(100 * p).toFixed(3)}%`;
    this.root.innerHTML = `
      <div class="op-wrap boot">
        <div class="op-boot" aria-live="polite"><i class="op-wisp" aria-hidden="true"></i><span class="op-boot-status">loading…</span></div>
        <div class="op-bar">
          <div class="op-slider" role="slider" tabindex="0" aria-label="day of the year" aria-valuemin="0" aria-valuemax="${this.year.last}">
            <div class="op-track">
              ${[1, 2].map(k => `<i class="op-tick" style="left:${pct(k / 3)}"></i>`).join('')}
              <i class="op-todaymark" style="left:${pct(this.year.pos(this.todayDay))}" title="today"></i>
              <div class="op-thumb"><span class="op-date"></span></div>
            </div>
            <div class="op-titles">${TITLES.map((t, k) => `<span data-season="${t}" style="left:${pct(k / 3)}">${t[0].toUpperCase() + t.slice(1)}</span>`).join('')}</div>
          </div>
        </div>
        <div class="op-tiles">${this.ids.map(id => `
          <div class="op-tile" data-tile="${esc(id)}">
            <span class="op-map"><img alt="" src="../tiles/${esc(id)}/client/imagery.png" draggable="false"></span>
            <button class="op-pick" aria-pressed="false" aria-label="${esc(id)}"></button>
            <span class="op-cover" aria-live="polite"><span class="op-mid"><i class="op-wisp" aria-hidden="true"></i><button class="op-begin" tabindex="-1" disabled>Begin</button><span class="op-status"></span></span></span>
            <span class="op-name"><b class="op-title"></b><span class="op-sub"></span></span>
          </div>`).join('')}
        </div>
        <div class="op-lineup" aria-hidden="true"></div>
      </div>`;
    for (const b of this.root.querySelectorAll('.op-pick')) b.onclick = () => this.pickTile(b.closest('.op-tile').dataset.tile);
    for (const b of this.root.querySelectorAll('.op-begin')) b.onclick = () => this.begin();
    this.wireSlider();
    // The row scrolls sideways: a mouse wheel scrolls it too.
    const row = this.$('.op-tiles');
    row.addEventListener('wheel', e => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || row.scrollWidth <= row.clientWidth) return;
      row.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 32 : 1); e.preventDefault();
    }, { passive: false });
    // the lineup follows the chosen card when the row scrolls or the window changes (its positions are CSS from these)
    this.place = () => this.placeLineup();
    this.relayout = () => this.layoutCards();
    row.addEventListener('scroll', this.place, { passive: true }); addEventListener('resize', this.relayout);
    // a hovering pointer (not touch) grows the card under it a little and steps the rest back (layoutCards)
    for (const c of this.root.querySelectorAll('.op-tile')) {
      c.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { this.hovered = c; this.layoutCards(); this.bringIntoView(c); } });
      c.addEventListener('pointerleave', e => { if (this.hovered === c) { this.hovered = null; this.layoutCards(); } });
    }
    this.update();   // the slider and its colour at once
  }

  cardOf(id) { return id ? this.root.querySelector(`.op-tile[data-tile="${CSS.escape(id)}"]`) : null; }

  centreCard(smooth = false) {
    const row = this.$('.op-tiles'), card = this.cardOf(this.sel || this.hint);   // the chosen card, else the hint's
    if (!row || !card) return;
    const r = row.getBoundingClientRect(), c = card.getBoundingClientRect();
    row.scrollTo({ left: row.scrollLeft + c.left + c.width / 2 - (r.left + r.width / 2), behavior: smooth ? 'smooth' : 'auto' });
  }

  // The season slider: drag or click anywhere on it, arrows a day, Page keys a week, Home/End the ends, T today.
  wireSlider() {
    const el = this.$('.op-slider'), track = this.$('.op-track');
    const fromX = x => { const r = track.getBoundingClientRect(); this.setDay(this.year.at((x - r.left) / r.width)); };
    el.addEventListener('pointerdown', e => { if (e.button) return; el.setPointerCapture(e.pointerId); el.classList.add('drag'); fromX(e.clientX); e.preventDefault(); el.focus({ preventScroll: true }); });
    el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) fromX(e.clientX); });
    const end = e => { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); el.classList.remove('drag'); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', e => {
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -7, PageUp: 7 }[e.key];
      if (step) this.setDay(this.day + step);
      else if (e.key === 'Home') this.setDay(0);
      else if (e.key === 'End') this.setDay(this.year.last);
      else if (e.key === 't' || e.key === 'T') this.setDay(this.todayDay);
      else return;
      e.preventDefault();
    });
    this.$('.op-todaymark').addEventListener('pointerdown', e => { e.stopPropagation(); if (!e.button) this.setDay(this.todayDay); });
  }

  setDay(i) {
    i = Math.min(this.year.last, Math.max(0, Math.round(i)));
    if (i === this.day) return;
    this.day = i; this.update();
  }

  // ---- the dark start: the screen's own assets, then the reveal ---------------------------------------------------
  // Each card's title (features.json: its locality, its roads under it) and place names, its map image, every tile's
  // species list, the animal stills (assets/opening/index.json) and the label tile's weather; at most BOOT_MAX s.
  async loadAssets(pending) {
    const status = t => { const el = this.$('.op-boot-status'); if (el) el.textContent = t; };
    const img = src => new Promise(r => { const im = new Image(); im.onload = im.onerror = () => r(im); im.src = src; });
    const feats = Promise.all(this.ids.map(async id => {
      const f = await getJSON(`../tiles/${id}/client/features.json`);
      this.feat[id] = f; this.places[id] = f ? new PlaceNames(f, f.size_m || 10000) : null;
      const card = this.cardOf(id), roads = majorRoads(f).join(', '), place = locality(f);
      card.querySelector('.op-title').textContent = place || roads || id;
      card.querySelector('.op-sub').textContent = place ? roads : '';
      card.querySelector('.op-pick').setAttribute('aria-label', [place, roads].filter(Boolean).join(': ') + ` (${id})`);
    }));
    const maps = Promise.all([...this.root.querySelectorAll('.op-map img')].map(im => im.complete ? null : new Promise(r => { im.onload = im.onerror = r; })));
    this.lineupData = Promise.all([getJSON('./assets/opening/index.json'), Promise.all(this.ids.map(id => getJSON(`../tiles/${id}/species/species.json`)))])
      .then(([index, lists]) => ({ index, lists: Object.fromEntries(this.ids.map((id, i) => [id, lists[i] || []])) }));
    const stills = this.lineupData.then(({ index }) => {
      const files = Object.values(index?.species || {}).map(s => s.file);
      let n = 0; status(`gathering the animals… 0 / ${files.length}`);
      return Promise.all(files.map(f => img(`./assets/opening/${f}`).then(() => status(`gathering the animals… ${++n} / ${files.length}`))));
    });
    const weather = this.loadWeather(this.labelTile);
    await Promise.race([Promise.all([feats, maps, stills, weather]), new Promise(r => setTimeout(r, BOOT_MAX * 1000))]);
    if (this.closed) return;
    if (pending) this.preselect(pending);
    this.reveal();
  }

  // A point handed over by main.js (?lat=&lon=): in a built tile it is where that tile's arrival goes, and that card
  // is the hint (brought to the middle); elsewhere nothing changes.
  preselect(p) {
    const id = this.ids.find(t => pointInTileId(t, p)); if (!id) return;
    this.points[id] = pointInTileId(id, p);
    if (!this.sel) { this.hint = id; this.tileId = id; }
    this.update();
  }

  // The assets are in: the wisp implodes and the slider and the cards fade and rise in, nothing chosen.
  reveal() {
    if (this.revealed) return;
    this.revealed = true;
    const wrap = this.$('.op-wrap'); wrap.classList.remove('boot'); wrap.classList.add('booted');
    this.centreCard(); this.layoutCards(); this.update();
  }

  // ---- choosing a card ------------------------------------------------------------------------------------------
  // A click: the card grows (1.08) under its cover with the wisp and the build's status, the tile's animals pop in
  // below it, and onSelect asks main.js to build that world (aborting any other). Clicking another card while one
  // builds clears the first (cover, spinner, Begin) and moves the lineup over; clicking the chosen card does nothing.
  pickTile(id) {
    if (!this.revealed || id === this.sel || this.begun) return;
    const prev = this.cardOf(this.sel);
    if (prev) {
      prev.classList.remove('sel', 'loading', 'ready'); prev.querySelector('.op-pick').setAttribute('aria-pressed', 'false');
      const b = prev.querySelector('.op-begin'); b.disabled = true; b.tabIndex = -1; if (document.activeElement === b) b.blur();
    }
    this.sel = id; this.tileId = id;
    const card = this.cardOf(id);
    card.classList.add('sel'); card.querySelector('.op-pick').setAttribute('aria-pressed', 'true');
    card.querySelector('.op-status').textContent = this.status[id] || 'loading…';
    if (this.readyIds.has(id)) this.showReady(card); else card.classList.add('loading');
    this.layoutCards(); this.centreCard(true);
    this.lineup(id);
    this.loadWeather(id).then(() => this.update());
    this.update();
    this.onSelect?.(id);
  }

  // main.js reports "preparing <tileId>: <status>" while a world builds: setPrep(tileId, text), or setPrep(text) for the
  // hint's tile. The chosen card shows the status part under its spinner; an empty report keeps the last line.
  setPrep(a, b) {
    const [id, text] = b === undefined ? [this.hint, a] : [a, b];
    if (!text || !id || this.readyIds.has(id)) return;
    const t = String(text).replace(/^preparing\s+\S+:\s*/, '');
    this.status[id] = t;
    if (id === this.sel) this.cardOf(id).querySelector('.op-status').textContent = t;
  }
  // A world is built: setReady(tileId), or setReady() for the hint's tile. On the chosen card the spinner implodes into
  // Begin and the other cards recede; a tile not chosen (now) is remembered, so choosing it shows Begin at once.
  setReady(id = this.hint) {
    if (!id) return;
    this.readyIds.add(id);
    const card = this.cardOf(id);
    if (id === this.sel && card?.classList.contains('loading')) this.showReady(card);
  }
  get ready() { return !!this.sel && this.readyIds.has(this.sel); }
  showReady(card) {
    card.classList.remove('loading'); card.classList.add('ready');
    this.layoutCards();   // the others recede further
    card.querySelector('.op-status').textContent = '';
    const b = card.querySelector('.op-begin'); b.disabled = false; b.tabIndex = 0;
    b.focus({ preventScroll: true });
  }

  begin() {
    if (this.begun || !this.ready) return;
    this.begun = true;
    const b = this.cardOf(this.sel)?.querySelector('.op-begin'); if (b) b.disabled = true;
    this.onBegin({ tileId: this.sel, season: this.season, date: this.date, point: this.points[this.sel] || null, caption: this.caption() });
  }

  // ---- the lineup ------------------------------------------------------------------------------------------------
  // The chosen tile's animals as pre-rendered stills (assets/opening/index.json), true to scale (the deer's rule: a
  // metre is PX_PER_M_CARD of the card's height), ground animals standing just below and in front of the chosen card, birds
  // round its top on a slow CSS float. Each still is laid out in units of the card's height (--H) from the card's centre
  // (--cx) and bottom (--by, birds) or the foot line (--fy, ground animals), so a scroll, a resize or a new card only
  // changes those (a CSS transition carries the animals over). A new tile's lineup keeps the species both tiles share
  // (they move to their new places), drops the others (they fade) and pops the new ones in with a glimmer, staggered by
  // an animation-delay set once as each image is ready, in a random order POP_GAP s apart.
  async lineup(id) {
    const { index, lists } = await this.lineupData;
    if (this.closed || id !== this.sel || !index?.species) return;
    const box = this.$('.op-lineup'), rnd = Math.random;
    this.anEls ||= new Map();
    const known = [...new Set((lists[id] || []).map(s => s.code))].filter(c => index.species[c]);
    const ground = known.filter(c => index.species[c].kind === 'ground'), birds = known.filter(c => index.species[c].kind === 'bird');
    const m = c => index.species[c].width / index.species[c].px_per_m;   // the still's width in metres
    // ground slots: biggest at the two ends, smallest toward the middle; each slot's share of the span by its width
    ground.sort((a, b) => m(b) - m(a));
    const order = []; ground.forEach((c, i) => { order[i % 2 ? ground.length - 1 - (i >> 1) : i >> 1] = c; });
    const wts = order.map(c => m(c) * 0.8 + 0.05), sum = wts.reduce((a, b) => a + b, 0) || 1;
    const Hc = (this.cardOf(id)?.offsetHeight || 600) * 1.08;
    const SPAN = Math.min(0.74, (innerWidth - 24) / Hc);   // in card heights: about 1.3 card widths, within the window
    let acc = 0;
    const items = order.map((c, i) => { const f = (acc + wts[i] / 2) / sum; acc += wts[i]; return { c, x: (f - 0.5) * SPAN, back: i % 2 === 1 }; })
      .concat(birds.map((c, k) => ({ c, bird: k })));
    // the ones not in this tile go
    for (const [c, el] of this.anEls) if (!known.includes(c)) { el.classList.add('gone'); this.anEls.delete(c); setTimeout(() => el.remove(), 500); }
    for (const it of items.sort(() => rnd() - 0.5)) {   // new ones created, so loaded, in a random order
      const sp = index.species[it.c], k = PX_PER_M_CARD / sp.px_per_m;   // card heights per still pixel
      const s = it.bird == null && it.back ? 0.92 : 1;   // the back row a step further off
      const w = sp.width * k * s, h = sp.height * k * s;
      let el = this.anEls.get(it.c), fresh = false;
      if (!el) {
        fresh = true; el = document.createElement('span'); this.anEls.set(it.c, el);
        el.className = `op-an ${it.bird != null ? 'bird' : 'ground'}`;
        const img = new Image(), inner = document.createElement('i');
        img.alt = ''; img.decoding = 'async';
        img.onload = () => {
          const now = performance.now() / 1000, at = Math.max(now + 0.05, this.popAt || 0);
          this.popAt = at + POP_GAP[0] + rnd() * (POP_GAP[1] - POP_GAP[0]);
          el.style.animationDelay = `${(at - now).toFixed(3)}s`;
          el.classList.add('in');
        };
        img.src = `./assets/opening/${sp.file}`;
        inner.append(img); el.append(inner); box.append(el);
      }
      let x, y;   // the still's centre x and top y, in card heights: birds from the card's centre x and bottom, ground
                  // animals from the card's centre x and the foot line (--fy, just under the card: placeLineup)
      if (it.bird != null) {
        const a = [-2.2, -0.9, -1.6, -0.4, -2.7, -1.25][it.bird % 6], r = 0.36 + 0.06 * (it.bird % 3);
        x = Math.cos(a) * r * 1.15; y = -1 + 0.12 + Math.sin(a) * r * 0.32 - h / 2;   // round the card's top
        if (fresh) { el.style.setProperty('--fd', `${(5 + rnd() * 3).toFixed(2)}s`); el.style.setProperty('--fx', `${(rnd() < 0.5 ? -1 : 1) * (6 + rnd() * 8) | 0}px`); }
      } else {
        x = it.x; y = (it.back ? -0.015 : 0) - (sp.foot_px ?? sp.height) * k * s;
        el.classList.toggle('back', !!it.back);
      }
      el.classList.toggle('flip', x > 0.02);   // face the card's middle (the stills face right)
      el.style.setProperty('--x', (x - w / 2).toFixed(4)); el.style.setProperty('--y', y.toFixed(4));
      el.style.setProperty('--w', w.toFixed(4)); el.style.setProperty('--h', h.toFixed(4));
    }
    this.placeLineup();
  }

  // The cards' scales and brightness by state, and the sideways shifts that keep the gutters between them as wide as
  // at full size whatever the scales (a scale about each card's centre would widen them): the card in focus (the chosen
  // one, else the hovered one) stays put, the others are laid out edge to edge outward from it. Set as CSS variables;
  // the transitions are CSS. Nothing chosen and no hover: all at full size.
  //   chosen 1.08; hovered 1.04; the others 0.94 and 80% bright, 0.86 and 60% once the chosen one's world is ready.
  layoutCards() {
    const cards = [...this.root.querySelectorAll('.op-tile')]; if (!cards.length) return;
    const sel = cards.findIndex(c => c.classList.contains('sel')), hov = this.hovered ? cards.indexOf(this.hovered) : -1;
    const ready = sel >= 0 && cards[sel].classList.contains('ready'), f = sel >= 0 ? sel : hov;
    const S = cards.map((c, i) => i === sel ? [1.08, 1, 1] : i === hov ? [1.04, 1, 1] : f < 0 ? [1, 1, 1] : ready ? [0.86, 0.6, 0.8] : [0.94, 0.8, 0.88]);
    const w = cards[0].offsetWidth, g = parseFloat(getComputedStyle(this.$('.op-tiles')).columnGap) || 0, tx = cards.map(() => 0);
    if (f >= 0) for (const dir of [1, -1]) {
      let edge = S[f][0] * w / 2;   // the far edge so far, from the focus card's centre
      for (let i = f + dir; i >= 0 && i < cards.length; i += dir) {
        const at = edge + g + S[i][0] * w / 2;
        tx[i] = dir * at - (i - f) * (w + g); edge = at + S[i][0] * w / 2;
      }
    }
    this.target = new Map(cards.map((c, i) => [c, { tx: tx[i], s: S[i][0] }]));
    cards.forEach((c, i) => {
      c.style.setProperty('--s', S[i][0]); c.style.setProperty('--b', S[i][1]); c.style.setProperty('--sat', S[i][2]);
      c.style.setProperty('--tx', `${tx[i].toFixed(1)}px`); c.classList.toggle('hover', i === hov);
    });
    this.cardShift = { el: sel >= 0 ? cards[sel] : null, tx: sel >= 0 ? tx[sel] : 0 };
    this.placeLineup();
  }

  // A hovered card cut off at an edge of the row: scroll the least that shows it whole at the size and place it is going
  // to (layoutCards), with a gutter's margin; a card already in view scrolls nothing (and leaving it scrolls nothing back).
  bringIntoView(card) {
    const row = this.$('.op-tiles'), t = this.target?.get(card); if (!row || !t) return;
    const r = row.getBoundingClientRect(), c = card.getBoundingClientRect(), now = new DOMMatrix(getComputedStyle(card).transform).m41;
    const g = parseFloat(getComputedStyle(row).columnGap) || 0, cx = c.left + c.width / 2 - now + t.tx, half = card.offsetWidth * t.s / 2;
    const left = cx - half - g, right = cx + half + g;
    const dx = left < r.left ? left - r.left : right > r.right ? right - r.right : 0;
    if (Math.abs(dx) < 0.5 || performance.now() < (this.hoverScrollUntil || 0)) return;   // not again while a card slides under a still pointer
    this.hoverScrollUntil = performance.now() + 700;
    row.scrollBy({ left: dx, behavior: 'smooth' });
  }

  // The lineup's anchors for its CSS: the chosen card's centre x (where its shift is going), its bottom at the grown size
  // (birds round its top), and the foot line: FOOT_BELOW card heights under the card's bottom, so the animals stand
  // below and in front of the card, the taller ones' heads and backs over its lower edge (kept on screen when the
  // window is short: the line stays FOOT_MARGIN above the window's bottom).
  placeLineup() {
    const card = this.cardOf(this.sel), box = this.$('.op-lineup'); if (!card || !box) return;
    const r = card.getBoundingClientRect(), now = new DOMMatrix(getComputedStyle(card).transform).m41;
    const tx = this.cardShift?.el === card ? this.cardShift.tx : 0;
    const H = card.offsetHeight * 1.08, cy = r.top + r.height / 2, by = cy + H / 2;
    const fy = Math.min(by + FOOT_BELOW * H, this.root.clientHeight - FOOT_MARGIN * H);
    box.style.setProperty('--cx', `${(r.left + r.width / 2 - now + tx).toFixed(1)}px`);
    box.style.setProperty('--by', `${by.toFixed(1)}px`);
    box.style.setProperty('--fy', `${fy.toFixed(1)}px`);
    box.style.setProperty('--H', `${H.toFixed(1)}px`);
    box.classList.add('on');
  }

  // ---- the slider's label: the date and that day's weather ------------------------------------------------------
  // A tile's weather (fetched once per tile): the year of days (client/weather.json) for a chosen day, that day last
  // year; today's from the dev server (/api/weather), else the same day last year. The label is the chosen tile's, else
  // the hint's (else the first card's); the date alone until its weather arrives.
  loadWeather(id) {
    if (!id) return Promise.resolve();
    return (this.wxLoad ||= {})[id] ||= Promise.all([
      getJSON(`/api/weather/${encodeURIComponent(id)}`).then(j => { if (j?.days) this.wxToday[id] = j; }),
      getJSON(`../tiles/${id}/client/weather.json`).then(w => { if (w?.days) this.wx[id] = w; }),
    ]).then(() => this.update());
  }
  weatherFor(d) {
    const id = this.labelTile, key = (y, m, dd) => `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const t = this.wxToday[id];
    if (this.onToday && t) {
      const k = t.current?.time?.slice(0, 10) || key(d.getFullYear(), d.getMonth() + 1, d.getDate());
      const day = t.days[k]; if (day) return dayWords(day, { today: true, fields: t.fields });
    }
    const w = this.wx[id]; if (!w) return '';
    const day = w.days[key(d.getFullYear() - 1, d.getMonth() + 1, d.getDate())];
    return day ? dayWords(day, { fields: w.fields }) : '';
  }

  // "near Missouri Flat Road · fall · spirit": not shown on the screen; the arrival flight shows it in the world
  caption() {
    const id = this.sel, f = this.feat[id], size = f?.size_m || 10000, p = this.points[id];
    const near = this.places[id]?.nearest(p?.x ?? size / 2, p?.north ?? size / 2);
    const where = near ? `${near.over ? 'over' : 'near'} ${near.name}` : id;
    return `${where} · ${this.season} · spirit`;
  }

  update() {
    // The square map shows its middle 9/16 on the portrait card; pan it so an arrival point near an edge stays in view.
    for (const [id, p] of Object.entries(this.points)) {
      const card = this.cardOf(id), size = this.feat[id]?.size_m || 10000; if (!card) continue;
      const half = 9 / 32, c = Math.min(1 - half, Math.max(half, p.x / size));
      card.querySelector('.op-map').style.setProperty('--cx', c.toFixed(4));
    }
    const d = this.onToday ? new Date() : this.year.date(this.day), season = this.season;
    const s = this.$('.op-slider'), p = `${(100 * this.year.pos(this.day)).toFixed(3)}%`;
    if (!s) return;
    s.style.setProperty('--p', p);
    this.$('.op-wrap').style.setProperty('--hl', trackColor(this.year.pos(this.day)));
    s.setAttribute('aria-valuenow', this.day);
    s.setAttribute('aria-valuetext', `${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}, ${season}${this.onToday ? ', today' : ''}`);
    s.classList.toggle('today', this.onToday);
    const wx = this.weatherFor(d);
    this.$('.op-date').textContent = wx ? `${label(d)} • ${wx}` : label(d);
    for (const t of s.querySelectorAll('.op-titles span')) t.classList.toggle('on', t.dataset.season === season);
    this.onPoint?.(this.point);
  }

  // Fade out and remove; keys go back to the world.
  close() {
    for (const ev of ['keydown', 'keyup']) removeEventListener(ev, this.guard, true);
    document.activeElement?.blur?.();
    this.root.classList.add('out');
    this.closed = true; removeEventListener('resize', this.relayout);
    setTimeout(() => { this.root.hidden = true; this.root.innerHTML = ''; }, 900);
  }
}

// ---- the arrival flight ----------------------------------------------------------------------------
// 12 s from 400 m up and 1.5 km south of the point, heading north, to 120 m over it, the view
// levelling from a look down at the hills to the raven's own glide. Positions follow a Hermite ease
// that starts fast and ends at cruise speed, so the hand-over to RavenFlight has no jolt; a gentle
// weave (zero heading change at the end) and a bank from the turn rate keep it reading as flight.
// The altitude profile is precomputed and lifted where the straight descent would clip a ridge.
const T = 12, START_AGL = 400, END_AGL = 120, RUN = 1500, CRUISE = 12, CLEAR = 60;
const PITCH0 = -0.42, PITCH1 = -0.06;
const smooth = (a, b, u) => { const t = Math.min(1, Math.max(0, (u - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Arrival {
  constructor({ flight, camera, heights, size, caption }) {
    Object.assign(this, { flight, camera, heights, size, captionEl: caption });
    this.active = false; this.t = 0; this.onDone = null;
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._aim = new THREE.Vector3();
    this.plan(null);
  }

  // point: { x, north } tile-local, or null for the tile centre.
  plan(point) {
    const S = this.size, M = 100;
    const x = THREE.MathUtils.clamp(point?.x ?? S / 2, M, S - M), n = THREE.MathUtils.clamp(point?.north ?? S / 2, M, S - M);
    let dir = 1, run = Math.min(RUN, n - M);   // from the south, heading north
    if (run < 900) { const fromNorth = Math.min(RUN, S - M - n); if (fromNorth > run) { dir = -1; run = fromNorth; } }   // too near the south edge
    this.x = x; this.n = n; this.dir = dir; this.run = run;
    this.weave = (x < S / 2 ? 1 : -1) * Math.min(70, run * 0.05);   // bow toward the tile's middle
    this.v1 = CRUISE * T / run;                                        // end slope of s(u): cruise speed
    const N = 64, g = i => { const p = this.ground2(i / N); return this.heights.at(p.x, p.n); };
    const y0 = g(0) + START_AGL, y1 = g(N) + END_AGL, base = [], need = [];
    for (let i = 0; i <= N; i++) { const s = i / N; base[i] = y0 + (y1 - y0) * smooth(0, 1, s); need[i] = Math.max(0, g(i) + CLEAR - base[i]); }
    this.prof = base.map((b, i) => {   // lift: the largest deficit under a cos^2 window 0.35 wide
      let lift = 0;
      for (let j = 0; j <= N; j++) if (need[j]) { const d = Math.abs(i - j) / N; if (d < 0.35) lift = Math.max(lift, need[j] * Math.cos(Math.PI / 2 * d / 0.35) ** 2); }
      return b + lift;
    });
    this.prevYaw = null; this.roll = 0;
  }
  ground2(s) { return { x: this.x + this.weave * Math.sin(Math.PI * s) * (1 - s), n: this.n - this.dir * this.run * (1 - s) }; }
  ease(u) {   // cubic Hermite: s(0)=0, s(1)=1, s'(0)=1.4, s'(1)=v1
    const u2 = u * u, u3 = u2 * u;
    return 1.4 * (u3 - 2 * u2 + u) + (-2 * u3 + 3 * u2) + this.v1 * (u3 - u2);
  }

  // Put the bird where it is at time t; returns the HUD numbers flight.update would.
  pose(t, dt) {
    const f = this.flight, u = Math.min(1, t / T), s = Math.min(1, Math.max(0, this.ease(u)));
    const p = this.ground2(s), N = this.prof.length - 1, k = s * N, i = Math.min(N - 1, Math.floor(k));
    const y = this.prof[i] + (this.prof[i + 1] - this.prof[i]) * (k - i);
    const dx = this.weave * (Math.PI * Math.cos(Math.PI * s) * (1 - s) - Math.sin(Math.PI * s)), dn = this.dir * this.run;
    const yaw = Math.atan2(-dx, dn);
    if (this.prevYaw !== null && dt > 0) {
      const rate = Math.atan2(Math.sin(yaw - this.prevYaw), Math.cos(yaw - this.prevYaw)) / dt;
      this.roll += (THREE.MathUtils.clamp(0.43 * rate, -0.5, 0.5) - this.roll) * (1 - Math.exp(-dt * 2));
    }
    this.prevYaw = yaw;
    const prev = f.pos.clone();
    f.pos.set(p.x, y, -p.n); f.yaw = yaw; f.pitch = PITCH0 + (PITCH1 - PITCH0) * smooth(0, 1, u); f.roll = this.roll * (1 - smooth(0.85, 1, u));
    const speed = dt > 0 ? prev.distanceTo(f.pos) / dt : 0;
    f.speed = CRUISE; f.hover = false; f.flap = 0;
    f.flapping = u > 0.8 && u < 0.93;   // a few wingbeats as it slows to cruise
    this._q.setFromEuler(this._e.set(f.pitch, f.yaw, 0));
    f.body.quaternion.copy(this._q); f.body.rotateZ(f.roll);
    const dir = this._v.set(0, 0, -1).applyQuaternion(this._q);
    f.updateCamera(dt || 1, dir);
    if (f.view === 'chase') {   // pulled back at first, so the bird is small against its hills
      const cam = this.camera, pull = 1 + 1.8 * (1 - smooth(0.3, 1, u));
      cam.position.sub(f.pos).multiplyScalar(pull).add(f.pos);
      const gy = this.heights.atXZ(cam.position.x, cam.position.z) + 1.5; if (cam.position.y < gy) cam.position.y = gy;
      const aim = this._aim.copy(f.pos).addScaledVector(dir, 6); aim.y += 0.3; cam.lookAt(aim);
    }
    const ground = this.heights.atXZ(f.pos.x, f.pos.z);
    return { hover: false, agl: f.pos.y - ground, elev: f.pos.y, speed, heading: ((Math.atan2(dir.x, -dir.z) * 180 / Math.PI) + 360) % 360 };
  }

  // Hold at the start pose (behind the opening screen) so the world streams in around it.
  hold() { this.prevYaw = null; return this.pose(0, 0); }

  start(caption) {
    this.active = true; this.t = 0; this.prevYaw = null; this.flight.camSettled = false;
    this.skipKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;   // browser shortcuts pass
      e.stopImmediatePropagation(); e.preventDefault(); this.finish(true);
    };
    addEventListener('keydown', this.skipKey, true);
    const c = this.captionEl;
    if (c && caption) {
      c.querySelector('.cap-text').textContent = caption;
      c.hidden = false; c.getAnimations().forEach(a => a.cancel());
      // released when done (cancel): a filling animation stays on the element for good, and its handler would hold
      // this arrival, and through onDone the whole world, after the page has switched tiles
      const a = this.capAnim = c.animate([{ opacity: 0 }, { opacity: 0, offset: 0.08 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.68 }, { opacity: 0, offset: 0.92 }, { opacity: 0 }],
        { duration: T * 1000, fill: 'forwards' });
      a.onfinish = () => { c.hidden = true; a.cancel(); };
    }
  }

  update(dt) {
    this.t += dt;
    const f = this.pose(Math.min(this.t, T), dt);
    if (this.t >= T) this.finish(false);
    return f;
  }

  finish(skipped) {
    if (!this.active) return;
    this.active = false;
    removeEventListener('keydown', this.skipKey, true);
    if (skipped) { this.pose(T, 0); this.flight.camSettled = false; }
    const f = this.flight;
    f.speed = CRUISE; f.pitch = PITCH1; f.roll = 0; f.hover = false; f.flap = 0; f.keys.clear(); f.drag = null;
    if (skipped && this.capAnim) {   // a skipped caption still fades rather than vanishing
      const c = this.captionEl, o = +getComputedStyle(c).opacity;
      this.capAnim.cancel();
      const a = c.animate([{ opacity: o }, { opacity: 0 }], { duration: 1200, fill: 'forwards' });
      a.onfinish = () => { c.hidden = true; a.cancel(); };
    }
    this.capAnim = null;
    this.onDone?.(skipped);
  }
}
