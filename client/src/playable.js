import { GROUND } from './groundControl.js';
import { FLIERS } from './flierControl.js';

// The bodies the spirit can take (spirit.js), by species code: which control drives each. The raven (RavenFlight), the
// western gray squirrel (squirrelControl.js) and the acorn woodpecker (woodpeckerControl.js) have their own; every
// other species is a walker (groundControl.js GROUND) or a flier (flierControl.js FLIERS).
export const OWN = { corvus_corax: 'raven', sciurus_griseus: 'squirrel', melanerpes_formicivorus: 'woodpecker' };
export function bodyKind(code) { return OWN[code] || (GROUND[code] ? 'ground' : FLIERS[code] ? 'flier' : null); }
// Short names for tests (?skip=1&as=<short>): deer, fox, coyote, rabbit, jackrabbit, quail, scrubjay, stellers,
// vulture, hawk, lion, bear, vole, turkey, groundsquirrel, lizard, mtnquail.
export const SHORT = Object.fromEntries([...Object.entries(GROUND), ...Object.entries(FLIERS)].map(([code, s]) => [s.short, code]));

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
