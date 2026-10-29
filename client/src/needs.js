import { loadImageData, Grid8 } from './tilepackage.js';
import { bodyKind } from './playable.js';

// The games of life (owner, 2026-10-27; docs/games.md: the gather and drink archetypes): the player's hunger and
// thirst in a body, and how they are met. Both run from 1 (sated) to 0 over minutes of play (NEED_T; thirst by the
// species' rhythm in games.json's drink game: daily, often, rare; none means the species never needs open water and
// has no thirst). Eating: holding E (the walkers' act: grazing, nibbling, pecking) where one of the species' gather
// resources this season scores at least EAT_MIN on the 30 m grid (client/res_<resource>.png: the resource rasters'
// four seasons in RGBA, resources.py) fills hunger at a rate with the score. Drinking: E while wading, or where the
// water resource scores at the water. A need under NEED_LOW slows the body (slow) and the widget names the nearest
// good cell of the resource (the rasters, scanned round the body) with its bearing and distance. Everything here comes
// from games.json and the rasters, so a new species in the pipeline's tables gets its needs the same way. The widget (#needs, index.html) shows the two
// meters bottom right while the player is a walker; a spirit, and the birds and the squirrel for now, have no needs.
const NEED_T = { hunt: 24, food: 7, daily: 4, often: 8, rare: 16 };   // minutes from sated to empty
const EAT_MIN = 25, EAT_RATE = 0.06, DRINK_RATE = 0.1;      // score floor; fill per second at score 100 (empty to full in about 20 s of grazing); fill per second at water (10 s)
const NEED_LOW = 0.25, NEED_SLOW = 0.7;
const TARGET_MIN = 70, TARGET_CELLS = 70;   // the target: the nearest cell scoring at least TARGET_MIN within TARGET_CELLS cells (2.1 km), scanned in rings
const SEASON_CH = { winter: 0, spring: 1, summer: 2, fall: 3 };
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class Needs {
  constructor({ tile, el, season }) {
    this.tile = tile; this.el = el; this.season = season; this.rasters = new Map(); this.loading = new Map();
    this.hunger = 1; this.thirst = 1; this.code = null; this.sp = null; this.rhythm = 'none'; this.target = null; this.foodHere = 0; this.atWater = false;
    this.bars = el ? { food: el.querySelector('.nd.food'), water: el.querySelector('.nd.water') } : null;
  }
  // the player's species: a walker with games in games.json has needs; anything else has none (the widget hides)
  setSpecies(code) {
    const base = code ? code.split(':')[0] : null;
    const kind = base ? bodyKind(base) : null, flier = kind === 'flier';
    this.code = base; this.sp = base && (kind === 'ground' || flier) ? this.tile.games?.species?.[base] || null : null;   // walkers and fliers (a flier's only loop is the hunt: no thirst)
    this.hunger = this.hunter ? 0.45 : 1; this.thirst = 1; this.target = null; this.starved = false;   // a hunter's body is taken hungry (hunt.js; the control sets `hunter` before this)
    const drink = this.sp?.games.find(g => g.archetype === 'drink');
    this.rhythm = flier ? 'none' : drink?.rhythm || (drink ? 'often' : 'none');
    if (this.el) { this.el.hidden = !this.sp; if (this.bars?.water) this.bars.water.hidden = this.rhythm === 'none'; }
  }
  raster(r) {   // client/res_<r>.png as a Grid8, loaded on first need (null until then)
    if (this.rasters.has(r)) return this.rasters.get(r);
    if (!this.loading.has(r)) this.loading.set(r, loadImageData(`../tiles/${this.tile.id}/client/res_${r}.png`).then(img => this.rasters.set(r, new Grid8(img, this.tile.size))).catch(() => this.rasters.set(r, null)));
    return null;
  }
  foods(season) { return [...new Set(this.sp.games.filter(g => g.archetype === 'gather' && g.season === season && g.resource).map(g => g.resource))]; }
  // The plant species that are this body's food this season (games.json relations.forage, from the library's records: the
  // plants' eaten_by; 2026-10-29), as a Set of ids; empty on a tile whose games predate the relations.
  foodPlants(season) {
    const key = `${this.code}:${season}`; if (this.plantKey === key) return this.plantIds;
    const ids = new Set();
    for (const [a, plant, , , seasons] of this.tile.games?.relations?.forage || []) if (a === this.code && (!seasons.length || seasons.includes(season))) ids.add(plant);
    this.plantKey = key; this.plantIds = ids; return ids;
  }
  fed() { this.hunger = 1; }   // a catch (animals.js catchNear)
  get slow() { return this.sp && Math.min(this.hunger, this.rhythm === 'none' ? 1 : this.thirst) < NEED_LOW ? NEED_SLOW : 1; }
  // every frame in a walker: x, north the body; acting: E held (the act); wet: wading
  update(dt, { x, north, acting, wet }) {
    if (!this.sp) return;
    const season = this.season(), ch = SEASON_CH[season] ?? 3;
    const foods = this.foods(season);
    if (foods.length) this.hunger = Math.max(0, this.hunger - dt / (NEED_T.food * 60));
    else if (this.hunter) {   // a hunter's food is prey: the catch (fed) fills it; an empty belly ends the body (hunt.js: onStarve)
      this.hunger = Math.max(0, this.hunger - dt / (NEED_T.hunt * 60));
      if (this.hunger <= 0 && !this.starved) { this.starved = true; this.onStarve?.(); }
    }
    if (this.rhythm !== 'none') this.thirst = Math.max(0, this.thirst - dt / ((NEED_T[this.rhythm] || NEED_T.often) * 60));
    let here = 0;
    for (const r of foods) { const g = this.raster(r); if (g) here = Math.max(here, g.at(x, north, ch)); }
    this.foodHere = here;
    // the plant being eaten (main.js plantHere: the herb, shrub or grass under the body among this season's food plants),
    // looked up a few times a second while there is food here
    this.plantT = (this.plantT || 0) - dt;
    if (here >= EAT_MIN && this.plantHere && this.plantT <= 0) { this.plantT = 0.4; this.plant = this.plantHere(x, north, this.foodPlants(season)); }
    else if (here < EAT_MIN) this.plant = null;
    if (acting && here >= EAT_MIN) this.hunger = Math.min(1, this.hunger + dt * EAT_RATE * here / 100 * (this.plant ? 1.25 : 1));   // a named plant feeds a little faster
    const water = this.raster('water');
    this.atWater = !!wet || (!!water && water.at(x, north, ch) >= 100);
    if (acting && this.atWater && this.rhythm !== 'none') this.thirst = Math.min(1, this.thirst + dt * DRINK_RATE);
    // the target: the lower need's nearest good cell this season (the rasters, scanned in rings round the body; the
    // pipeline's hotspots are a tile summary, not the nearest), found again every TARGET_EVERY s or when it is reached
    const wantWater = this.rhythm !== 'none' && this.thirst < this.hunger, res = wantWater ? ['water'] : foods;
    this.targetT = (this.targetT || 0) - dt;
    if (this.targetT <= 0 || (this.target && (this.target.d < 40 || this.target.want !== wantWater))) {
      this.targetT = 2;
      let best = null;
      for (const r of res) { const g = this.raster(r); if (!g) continue; const c = this.nearest(g, x, north, ch); if (c && (!best || c.d < best.d)) best = { resource: r, ...c }; }
      this.target = best && { ...best, want: wantWater };
    } else if (this.target) {
      const t = this.target, dx = t.x - x, dn = t.north - north; t.d = Math.hypot(dx, dn); t.bearing = DIRS[Math.round(((Math.atan2(dx, dn) * 180 / Math.PI) + 360) % 360 / 45) % 8];
    }
    this.draw(wantWater);
  }
  // the nearest cell of grid g scoring at least TARGET_MIN in channel ch, as { x, north, d, bearing }, or null
  nearest(g, x, north, ch) {
    const [ci, cj] = g.cellOf(x, north), W = g.img.width, H = g.img.height;
    for (let ring = 0; ring <= TARGET_CELLS; ring++) {
      let best = null;
      for (let j = cj - ring; j <= cj + ring; j++) {
        if (j < 0 || j >= H) continue;
        const edge = j === cj - ring || j === cj + ring;
        for (let i = ci - ring; i <= ci + ring; i += edge ? 1 : 2 * ring || 1) {
          if (i < 0 || i >= W) continue;
          if (g.channel(i, j, ch) < TARGET_MIN) continue;
          const cx = (i + 0.5) * g.res, cn = g.size - (j + 0.5) * g.res, d = Math.hypot(cx - x, cn - north);
          if (!best || d < best.d) best = { x: cx, north: cn, d, bearing: DIRS[Math.round(((Math.atan2(cx - x, cn - north) * 180 / Math.PI) + 360) % 360 / 45) % 8] };
        }
      }
      if (best) return best;
    }
    return null;
  }
  draw(wantWater) {
    const B = this.bars; if (!B) return;
    const set = (bar, v, low, hint) => { if (!bar) return; bar.querySelector('b').style.width = `${Math.round(v * 100)}%`; bar.classList.toggle('low', low); const em = bar.querySelector('em'); if (em.textContent !== hint) em.textContent = hint; };
    const t = this.target, near = t ? `${t.resource.replace('_', ' ')} ${t.d < 1000 ? `${Math.round(t.d)} m` : `${(t.d / 1000).toFixed(1)} km`} ${t.bearing}` : '';
    const what = this.plant && this.plantName ? this.plantName(this.plant) : null;
    const foodHint = this.foodHere >= EAT_MIN ? (what ? `${what} here${this.hunger < 0.98 ? ': hold E' : ''}` : this.hunger < 0.98 ? 'food here: hold E' : 'food here') : (this.hunger < 0.6 && t && !wantWater ? near : '');
    set(B.food, this.hunger, this.hunger < NEED_LOW, foodHint);
    if (this.rhythm !== 'none') set(B.water, this.thirst, this.thirst < NEED_LOW, this.atWater ? (this.thirst < 0.98 ? 'at water: hold E' : 'at water') : (this.thirst < 0.6 && t && wantWater ? near : ''));
  }
}
