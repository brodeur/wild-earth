// How each animal moves, from its taxon and its body (pipeline/locomotion.py writes tiles/<id>/locomotion.json from
// library/animals/locomotion.json and the records' taxonomy, mass and size; docs/movement.md has the principles).
// The hand-tuned tables (groundControl.js GROUND, flierControl.js FLIERS) win where they give a value; this fills what
// they do not, and gives a whole entry for a species that has none, so a new species on a new tile moves from its
// taxon alone: a walker's walk, cruise, top, sprint and recover, its turn and its lag, a bird's cruise and top.
export class Locomotion {
  constructor(table) { this.rows = table?.species || {}; }
  get(code) { return this.rows[code] || null; }
  // a GROUND-shaped entry for a walker (groundControl.js) with every field a control needs, from the resolved row
  groundEntry(code) {
    const r = this.get(code); if (!r || r.flier) return null;
    const plan = r.body_plan, rodent = r.order === 'Rodentia' || r.order === 'Lagomorpha', bird = r.class === 'Aves', lizard = r.class === 'Reptilia';
    const half = r.length_m * 0.4, shoulder = r.hip_m, stride = Math.max(0.05, r.stride_m * 0.6);
    const e = {
      short: code.split('_').pop(), common: code.replace(/_/g, ' '), model: null, rig: lizard ? 'lizard' : bird ? 'bird' : rodent ? 'rodent' : 'quad',
      walk: r.walk_mps, run: r.top_mps, cruise: r.cruise_mps, back: r.walk_mps * 0.6, ramp: Math.max(0.5, 3 * Math.sqrt(r.length_m / 1.3)),
      accel: Math.min(10, 2.2 * Math.sqrt(1.3 / r.length_m)), stop: Math.min(14, 4 * Math.sqrt(1.3 / r.length_m)), turn: r.turn_rad_s,
      jumpH: Math.min(1.6, shoulder * 1.6), jumpL: Math.min(4.5, r.length_m * 2.5), step: Math.min(0.55, shoulder * 0.5), wade: Math.min(0.7, shoulder * 0.7),
      half, rad: half * 0.5, shoulder, stride, trot: r.trot_mps * 0.5, sprint: r.sprint_s, recover: r.recover_s,
      cam: { back: Math.max(0.2, r.length_m * 2.8), up: Math.max(0.07, shoulder * 1.6), look: Math.max(0.25, r.length_m * 2), aimUp: Math.max(0.03, shoulder), side: 0.35, clear: Math.max(0.035, shoulder * 0.35), near: Math.max(0.02, shoulder * 0.2) },
      act: { flick: 1, t: 3, word: 'foraging' }, alert: bird || rodent ? { pose: 1 } : { flick: -0.4 }, rest: lizard ? 'bask' : rodent ? null : 'bed',
      derived: true,
    };
    if (r.stalk_mps) e.stalk = r.stalk_mps;
    if (plan === 'quadruped' && r.posture === 'plantigrade') e.act = { flick: 1, dig: true, t: 4, word: 'digging' };
    return e;
  }
  // fill the fields a hand-tuned entry leaves out (cruise, sprint, recover, turn), never overwrite what it gives
  fill(code, entry) {
    const r = this.get(code); if (!r || !entry) return entry;
    for (const [k, v] of [['cruise', r.cruise_mps], ['sprint', r.sprint_s], ['recover', r.recover_s]]) if (entry[k] === undefined && v !== undefined) entry[k] = v;
    return entry;
  }
}
