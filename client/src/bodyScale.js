// Body scale (2026-10-28): one number for how small the player's body is, which the near-detail systems read so the
// world keeps its detail at every scale. The instance budget per frame stays about constant; what shrinks with the
// body is the radius it is spent on, and what grows is the density inside that radius. A deer is 1; a lizard 0.026.
//
// Who reads it (each subscribes with onBodyScale and keeps its own copy):
//   grass.js       the ground tier's radius and density (real blade density inside a ring a few metres wide for a vole)
//   litter.js      the body-scaled ring of pebbles, leaves, twigs and stems drawn from the ground detail's material weights
//   terrain.js     the micro-relief patch under the body (its finest cell size) and the third detail octave
//   vegetation.js  the leaf level's distance (a squirrel gets single leaves to ~24 m, a deer to ~15 m, a hawk never)
// The scale is the species' shoulder height over the deer's (groundControl.js GROUND[code].shoulder), clamped to
// [MIN, 1]. The spirit and the fliers are 1 (the air does not need it; a landed raven is near enough a rabbit's
// world but spends its time in the air). The squirrel (its own control) is 0.1.
import { GROUND } from './groundControl.js';

export const SCALE_MIN = 0.025, DEER_SHOULDER = 0.95;
const FIXED = { spirit: 1, sciurus_griseus: 0.1 };

export function scaleOf(code) {
  if (code in FIXED) return FIXED[code];
  const sh = GROUND[code]?.shoulder;
  if (!sh) return 1;
  return Math.min(1, Math.max(SCALE_MIN, sh / DEER_SHOULDER));
}

export const bodyScale = { v: 1, code: 'spirit' };
const listeners = new Set();

// Set from main.js onBody. Listeners get (scale, code); a world's systems unhook in their dispose.
export function setBodyScale(code) {
  const v = scaleOf(code);
  if (v === bodyScale.v && code === bodyScale.code) return v;
  bodyScale.v = v; bodyScale.code = code;
  for (const fn of listeners) { try { fn(v, code); } catch (err) { console.warn('bodyScale listener:', err); } }
  return v;
}
export function onBodyScale(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function resetBodyScale() { listeners.clear(); bodyScale.v = 1; bodyScale.code = 'spirit'; }
