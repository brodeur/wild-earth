import * as THREE from 'three';
import { parseLatLon, pointInTileId, lookupTile, buildTile, switchTile, noServerText } from './goto.js';
import { SEASONS, seasonOfDate } from './season.js';
import { PlaceNames } from './placenames.js';

// The opening screen and the arrival (docs/brief.md, "Worlds: a location plus a season"): joining is
// three choices, where, when and who, made before the world appears; then a scripted 12 s flight
// brings the player in over the chosen point, so the first thing they see is their own hills.
//
// OpeningScreen fills #opening. The tile named in `tileId` is the one main.js is already building
// behind the screen; picking another tile reloads the page into that tile (choices carried in
// sessionStorage), so Begin always finds its world ready and its press can start the sound.
// Arrival drives RavenFlight's pose and chase camera until it hands control to the player.

// Playable today: the raven (RavenFlight), the western gray squirrel (squirrelControl.js) and the acorn woodpecker
// (woodpeckerControl.js), the woodpecker as a male or a female (two cards; the sex is remembered beside the species).
// The squirrel's arrival is not this flight but a short run down and out of the nearest oak (SquirrelControl.arrive);
// the woodpecker arrives clinging to its family's granary (WoodpeckerControl.arrive).
const PLAYABLE = new Set(['corvus_corax', 'sciurus_griseus', 'melanerpes_formicivorus']);
const SEXED = { melanerpes_formicivorus: { male: 'red crown from the white forehead back', female: 'a black band between the white and the red' } };
const SEASON_LINE = {   // what the foothills are doing, hand-written; the raven half comes from calendar.json
  winter: 'Rain greens the hills; the blue oaks stand bare.',
  spring: 'Wildflowers, new oak leaves, creeks running full.',
  summer: 'Gold grass, dry creeks, heat shimmer in the canyons.',
  fall: 'Acorns drop under the oaks; the first rains settle the dust.',
};
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROAD_WEIGHT = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 1.5 };
const LAST_TILE = 'we.lastTile', LAST_SPECIES = 'we.lastSpecies', LAST_SEX = 'we.lastSex';

export const lastTile = () => { try { return localStorage.getItem(LAST_TILE); } catch { return null; } };
export const rememberTile = id => { try { localStorage.setItem(LAST_TILE, id); } catch { /* storage off */ } };
// The species chosen last time (the "who" card preselected on the next visit), remembered like the tile.
export const lastSpecies = () => { try { const c = localStorage.getItem(LAST_SPECIES); return PLAYABLE.has(c) ? c : null; } catch { return null; } };
export const rememberSpecies = code => { try { if (PLAYABLE.has(code)) localStorage.setItem(LAST_SPECIES, code); } catch { /* storage off */ } };
export const lastSex = () => { try { return localStorage.getItem(LAST_SEX) === 'female' ? 'female' : 'male'; } catch { return 'male'; } };
export const rememberSex = sex => { try { localStorage.setItem(LAST_SEX, sex === 'female' ? 'female' : 'male'); } catch { /* storage off */ } };

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

// One line of what a raven does in a season, from the tile's calendar.json.
function ravenLine(calendar, season, names) {
  const acts = calendar?.activities?.corvus_corax?.[season] || [];
  const pretty = c => names[c] || c.replace(/_/g, ' ');
  const parts = acts.map(a => a.goal && a.goal.includes(' ') ? a.goal : `${a.activity} ${a.goal || (a.resources || []).map(pretty).join(', ')}`.trim());
  return parts.length ? `ravens ${parts.join('; ')}` : '';
}
function monthsOf(calendar, season) {
  const m = calendar?.seasons?.[season]; if (!m?.length) return '';
  return `${MONTH[m[0] - 1]}–${MONTH[m[m.length - 1] - 1]}`;
}

export class OpeningScreen {
  // index: tiles/index.json; tileId: the tile being built behind the screen; pending: a { lat, lon } to
  // preselect; carried: { season } kept from a reload; onBegin(choice) is called inside the click.
  constructor({ root, index, tileId, pending = null, carried = null, onBegin }) {
    this.root = root; this.index = index; this.tileId = tileId; this.onBegin = onBegin;
    this.live = seasonOfDate();
    this.season = SEASONS.includes(carried?.season) ? carried.season : this.live;
    this.species = PLAYABLE.has(carried?.species) ? carried.species : lastSpecies() || 'corvus_corax';
    this.sex = carried?.sex === 'female' || carried?.sex === 'male' ? carried.sex : lastSex();
    this.point = null;          // { x, north } in this tile, or null for the tile centre
    this.ready = false; this.begun = false; this.places = null; this.data = {};
    this.render();
    this.load(pending);
    // Keys typed on the screen stay on the screen (flight, peek, sound and the rest listen on window).
    this.guard = e => { if (!this.root.contains(e.target)) e.stopImmediatePropagation(); };
    for (const ev of ['keydown', 'keyup']) {
      addEventListener(ev, this.guard, true);
      root.addEventListener(ev, e => e.stopPropagation());
    }
  }

  $(sel) { return this.root.querySelector(sel); }

  render() {
    const tiles = this.index.tiles.map(t => t.tile_id);
    this.root.innerHTML = `
      <div class="op-wrap">
        <header><h1>Wild Earth</h1><p>Your own hills, rewilded. Choose where, when and who.</p></header>
        <section class="op-where"><h2>Where</h2>
          <div class="op-find"><input class="op-input" placeholder="a place as lat, lon (e.g. 38.70, -120.87)" autocomplete="off" spellcheck="false" aria-label="place as lat, lon"><button class="op-findbtn">Find</button></div>
          <div class="op-say muted" role="status"></div>
          <div class="op-tiles">${tiles.map(id => `
            <button class="op-card op-tile" data-tile="${esc(id)}" aria-pressed="${id === this.tileId}">
              <span class="op-thumb"><img alt="" src="../tiles/${esc(id)}/client/imagery.png" loading="lazy"><i class="op-dot"></i></span>
              <b>${esc(id)}</b><span class="op-roads muted">…</span>
            </button>`).join('')}
          </div>
        </section>
        <section class="op-when"><h2>When</h2><div class="op-seasons">${SEASONS.map(s => `
          <button class="op-card op-season" data-season="${s}" aria-pressed="${s === this.season}">
            <span class="op-head"><b>${s}</b>${s === this.live ? '<span class="op-today">today</span>' : ''}<span class="op-months muted"></span></span>
            <span class="op-line">${SEASON_LINE[s]}</span><span class="op-raven muted"></span>
          </button>`).join('')}</div>
        </section>
        <section class="op-who"><h2>Who</h2><div class="op-species muted">…</div></section>
        <footer class="op-foot">
          <div class="op-caption"></div>
          <button class="op-begin begin">Begin</button>
          <div class="op-prep muted"></div>
        </footer>
      </div>`;
    this.say = (t, err = false) => { const el = this.$('.op-say'); el.textContent = t; el.classList.toggle('err', err); };
    for (const b of this.root.querySelectorAll('.op-tile')) b.onclick = () => this.pickTile(b.dataset.tile);
    for (const b of this.root.querySelectorAll('.op-season')) b.onclick = () => this.pickSeason(b.dataset.season);
    this.$('.op-findbtn').onclick = () => this.find(this.$('.op-input').value);
    this.$('.op-input').addEventListener('keydown', e => { if (e.key === 'Enter') this.find(e.target.value); });
    this.$('.begin').onclick = () => this.begin();
    this.$('.begin').focus({ preventScroll: true });
  }

  async load(pending) {
    const base = id => `../tiles/${id}/`;
    // every card's roads; the chosen tile's species, perception and calendar
    await Promise.all(this.index.tiles.map(async t => {
      const f = await getJSON(base(t.tile_id) + 'client/features.json');
      const el = this.root.querySelector(`.op-tile[data-tile="${CSS.escape(t.tile_id)}"] .op-roads`);
      if (el) el.textContent = majorRoads(f).join(', ') || 'no named roads';
      if (t.tile_id === this.tileId) { this.data.features = f; this.places = f ? new PlaceNames(f, f.size_m || 10000) : null; }
    }).concat([
      getJSON(base(this.tileId) + 'species/species.json').then(j => { this.data.species = j || []; }),
      getJSON(base(this.tileId) + 'perception.json').then(j => { this.data.perception = j; }),
      getJSON(base(this.tileId) + 'calendar.json').then(j => { this.data.calendar = j; }),
    ]));
    const names = Object.fromEntries(this.data.species.map(s => [s.code, s.common]));
    for (const s of SEASONS) {
      const card = this.root.querySelector(`.op-season[data-season="${s}"]`);
      card.querySelector('.op-months').textContent = monthsOf(this.data.calendar, s);
      card.querySelector('.op-raven').textContent = ravenLine(this.data.calendar, s, names);
    }
    this.renderSpecies(names);
    if (pending) { this.$('.op-input').value = `${pending.lat}, ${pending.lon}`; this.find(this.$('.op-input').value, { fromLoad: true }); }
    this.update();
  }

  renderSpecies(names) {
    const all = this.data.species, playable = all.filter(s => s.role === 'playable');
    const per = this.data.perception?.perceives || {};
    const box = this.$('.op-species'); box.classList.remove('muted');
    if (!playable.length) { box.textContent = 'no species list in this tile'; return; }
    if (!playable.some(s => s.code === this.species && PLAYABLE.has(s.code))) this.species = 'corvus_corax';   // not playable in this tile
    box.innerHTML = playable.flatMap(s => {
      const list = per[s.code], flyable = PLAYABLE.has(s.code), n = list ? list.length : all.length;
      const sees = new Set(list || all.map(a => a.code));
      const dots = all.map(a => `<i class="${sees.has(a.code) ? 'on' : ''}" title="${esc(a.common)}"></i>`).join('');
      const title = list ? `perceives: ${list.map(c => names[c] || c).join(', ')}` : 'no perception matrix: everything';
      const card = sex => `<button class="op-card op-sp" data-code="${esc(s.code)}"${sex ? ` data-sex="${sex}"` : ''} aria-pressed="false" ${flyable ? '' : 'disabled'} title="${esc(title)}">
        <span class="op-head"><b>${esc(s.common)}</b>${sex ? `<span class="op-soon">${sex}</span>` : ''}${flyable ? '' : '<span class="op-soon">coming soon</span>'}</span>
        <i class="op-sci muted">${sex && flyable ? esc(SEXED[s.code][sex]) : esc(s.scientific || '')}</i>
        <span class="op-sees">perceives ${n} of ${all.length} species</span><span class="op-dots">${dots}</span>
      </button>`;
      return SEXED[s.code] && flyable ? ['male', 'female'].map(card) : [card(null)];
    }).join('');
    for (const b of box.querySelectorAll('.op-sp:not([disabled])')) b.onclick = () => { this.species = b.dataset.code; if (b.dataset.sex) this.sex = b.dataset.sex; this.update(); };
  }

  pickSeason(s) { this.season = s; this.update(); }

  pickTile(id) {
    if (id === this.tileId) { this.point = null; this.$('.op-input').value = ''; this.say(''); this.update(); return; }
    this.say(`loading ${id}…`);
    switchTile(id, null, { screen: { season: this.season, species: this.species, sex: this.sex } });
  }

  // A typed place: this tile -> arrive over it; another built tile -> switch to it; unbuilt -> offer a build.
  async find(text, { fromLoad = false } = {}) {
    if (!text.trim()) { this.point = null; this.say(''); this.update(); return; }
    const p = parseLatLon(text);
    if (p.error) return this.say(p.error, true);
    const loc = pointInTileId(this.tileId, p);
    if (loc) { this.point = loc; this.say(`in ${this.tileId}; you will arrive over this point`); this.update(); return; }
    const other = this.index.tiles.map(t => t.tile_id).find(id => pointInTileId(id, p));
    const carry = { screen: { season: this.season, species: this.species, sex: this.sex } };
    if (other) { this.say(`in ${other}; loading…`); return switchTile(other, p, carry); }
    this.say('looking up tile…');
    try {
      const t = await lookupTile(p);
      if (t.noApi) return this.say(noServerText(p), true);
      if (t.built) { this.say(`loading ${t.tile_id}…`); return switchTile(t.tile_id, p, carry); }
      this.say(`${t.tile_id} is not built yet. `);
      const b = document.createElement('button'); b.className = 'op-build'; b.textContent = `Build ${t.tile_id}`;
      b.onclick = () => { b.remove(); this.say(`asking the dev server to build ${t.tile_id}…`); buildTile(p, t.tile_id, this.say, { screen: { season: this.season, species: this.species, sex: this.sex } }).catch(e => this.say('error: ' + e.message, true)); };
      this.$('.op-say').append(b);
      if (!fromLoad) b.focus();
    } catch (e) { this.say(e.message, true); }
  }

  // "near Missouri Flat Road · fall · common raven"
  caption() {
    const size = this.data.features?.size_m || 10000, x = this.point?.x ?? size / 2, n = this.point?.north ?? size / 2;
    const near = this.places?.nearest(x, n);
    const where = near ? `${near.over ? 'over' : 'near'} ${near.name}` : this.tileId;
    const who = this.data.species?.find(s => s.code === this.species)?.common || 'common raven';
    return `${where} · ${this.season} · ${who}`;
  }

  update() {
    for (const b of this.root.querySelectorAll('.op-season')) b.setAttribute('aria-pressed', b.dataset.season === this.season);
    for (const b of this.root.querySelectorAll('.op-sp')) b.setAttribute('aria-pressed', b.dataset.code === this.species && (!b.dataset.sex || b.dataset.sex === this.sex));
    const card = this.root.querySelector(`.op-tile[data-tile="${CSS.escape(this.tileId)}"]`);
    if (card) {
      const size = this.data.features?.size_m || 10000, dot = card.querySelector('.op-dot');
      dot.style.left = `${100 * (this.point?.x ?? size / 2) / size}%`; dot.style.top = `${100 * (1 - (this.point?.north ?? size / 2) / size)}%`;
      dot.classList.add('on');
    }
    this.$('.op-caption').textContent = this.caption();
    this.onPoint?.(this.point);
  }

  setPrep(text) { this.$('.op-prep').textContent = text; }
  setReady() { this.ready = true; this.setPrep(''); }

  begin() {
    if (this.begun) return;
    this.begun = true;
    const b = this.$('.begin'); b.disabled = true;
    rememberSpecies(this.species); if (SEXED[this.species]) rememberSex(this.sex);
    if (!this.ready) { b.textContent = 'Preparing…'; this.setPrep('almost ready; the world is still loading'); }
    this.onBegin({ tileId: this.tileId, season: this.season, species: this.species, sex: this.sex, point: this.point, caption: this.caption() });
  }

  // Fade out and remove; keys go back to the world.
  close() {
    for (const ev of ['keydown', 'keyup']) removeEventListener(ev, this.guard, true);
    document.activeElement?.blur?.();
    this.root.classList.add('out');
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
      this.capAnim = c.animate([{ opacity: 0 }, { opacity: 0, offset: 0.08 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.68 }, { opacity: 0, offset: 0.92 }, { opacity: 0 }],
        { duration: T * 1000, fill: 'forwards' });
      this.capAnim.onfinish = () => { c.hidden = true; };
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
      a.onfinish = () => { c.hidden = true; };
    }
    this.onDone?.(skipped);
  }
}
