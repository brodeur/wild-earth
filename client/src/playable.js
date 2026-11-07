import { GROUND } from './groundControl.js';
import { snakeEntry } from './snake.js';
import { FLIERS } from './flierControl.js';

// The bodies the spirit can take (spirit.js), by species code: which control drives each. The raven (RavenFlight), the
// western gray squirrel (squirrelControl.js) and the acorn woodpecker (woodpeckerControl.js) have their own; every
// other species is a walker (groundControl.js GROUND) or a flier (flierControl.js FLIERS).
export const OWN = { corvus_corax: 'raven', sciurus_griseus: 'squirrel', melanerpes_formicivorus: 'woodpecker' };
export function bodyKind(code) { return OWN[code] || (GROUND[code] ? 'ground' : FLIERS[code] ? 'flier' : null); }
// Short names for tests (?skip=1&as=<short>): deer, fox, coyote, rabbit, jackrabbit, quail, scrubjay, stellers,
// vulture, hawk, lion, bear, vole, turkey, groundsquirrel, lizard, mtnquail.
export const SHORT = Object.fromEntries([...Object.entries(GROUND), ...Object.entries(FLIERS)].map(([code, s]) => [s.short, code]));

// The tile's stand-ins (animals.js installFauna: a species of the tile's own drawn on a kin's mesh, running its machine) take
// their kin's body: its walker or flier entry (the raven's, squirrel's and woodpecker's own controls by the nearest
// walker or flier: the crow, the Douglas squirrel, the hairy woodpecker), named for the species; their code is their short
// name (?as=<code>); a slot with its own model (fauna.json `model`, standIns' drawn) takes that body.
// registerStandIns(animals.standIns) when a world is made, registerStandIns({}) when it goes (main.js).
const OWN_TWIN = { corvus_corax: ['flier', 'corvus_brachyrhynchos'], sciurus_griseus: ['ground', 'tamiasciurus_douglasii'], melanerpes_formicivorus: ['flier', 'leuconotopicus_villosus'] };
let standIns = [];
export function registerStandIns(list) {
  for (const code of standIns) { delete GROUND[code]; delete FLIERS[code]; delete SHORT[code]; }
  standIns = [];
  for (const o of Object.values(list || {})) {
    const code = o?.code, kin = o?.kin; if (!code || GROUND[code] || FLIERS[code] || OWN[code]) continue;
    if (o.reptile === 'snake') { if (!o.drawn) continue; GROUND[code] = snakeEntry(o); SHORT[code] = code; standIns.push(code); continue; }   // a snake: its own walker on its own model (snake.js; none without one)
    const tw = OWN_TWIN[kin], T = GROUND[kin] ? GROUND : FLIERS[kin] ? FLIERS : tw ? (tw[0] === 'ground' ? GROUND : FLIERS) : null;
    const base = T ? T[kin] || T[tw?.[1]] : null; if (!base) continue;
    T[code] = { ...base, short: code, common: o.common || o.one || code, ...(o.drawn ? { model: o.drawn } : {}) };   // drawn: its own model (animals.playerModel)
    // a ground bird's own gait (fauna.json gait over the kin's; animals.js BGAIT): the walk and stride scaled, the run its
    // top speed; a flightless one (fauna.json flightless) has no flush: from a run it runs on
    const G = o.gait;
    if (T === GROUND && G && Number.isFinite(G.speed) && Number.isFinite(G.stride)) {
      const e = T[code];
      e.walk = base.walk * G.speed; e.run = Number.isFinite(G.top) && G.top > 0 ? G.top : base.run * G.speed;
      if (Number.isFinite(base.stride)) e.stride = base.stride * G.stride;
      if (Number.isFinite(base.step)) e.step = base.step * G.stride;
    }
    if (T === GROUND && o.flightless) T[code].flush = null;
    SHORT[code] = code; standIns.push(code);
  }
}

// Tests: into the AI animal of that species nearest (x, z) (the tile's centre, or the chosen point) through the
// spirit's own enter (so take, the HUD, the observer and the camera blend are the real ones). The population fills in
// over the first frames, so it looks every 0.25 s; after 6 s with none in the live set one is summoned ahead of the
// camera (animals.summon). Resolves to the animal's id, or null (none after `timeout` ms, or already in a body). A tab in the
// background draws no frames (and so fills no population): the timeout is long.
export function playAs(short, { animals, spirit, x, z, timeout = 60000 }) {
  const code = SHORT[short]; if (!code) return Promise.resolve(null);
  const t0 = performance.now(); let summoned = false;
  return new Promise(resolve => {
    const tick = () => {
      if (spirit.body) return resolve(null);
      let best = null, bd = Infinity;
      for (const a of animals.list) {
        if (animals.codeOf(a) !== code || !animals.alive(a)) continue;
        const d = (a.x - x) ** 2 + (a.z - z) ** 2; if (d < bd) { bd = d; best = a; }
      }
      if (best && spirit.enter(best.id)) return resolve(best.id);
      const t = performance.now() - t0;
      if (t > 6000 && !summoned) { summoned = true; animals.summon(code, 12); }
      if (t > timeout) { console.warn(`playAs: no ${short} found`); return resolve(null); }
      setTimeout(tick, 250);
    };
    tick();
  });
}
