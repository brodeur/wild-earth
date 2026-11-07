// The hunt's strikes (owner, 2026-11-06: "for cats, they will have bite, swipe and pounce. Those only work when a prey
// animal is in range. Bite, swipe and pounce have different animations and deal different damage. When the prey is
// targeted, they have a health bar. Each type of attack should affect the health bar and have a cooldown - think WoW game
// mechanics for combat rather than tekken."). The rules both sides use: the animal host decides every hit with them
// (animals.js hurt, and a mirror's `hit` request), the player's page uses them to light its buttons (combat.js).
//
// Who strikes how, by family (tiles' locomotion.json `family`; a stand-in reads its kin's): the cats bite, swipe and
// pounce; the dogs, hyenas, mustelids and the rest bite and lunge; the bears bite, swipe and lunge; the snakes strike
// (once: a bite at the end of a strike, with venom working on afterwards for the vipers and the elapids). Every number comes
// from the bodies, not from a table per species: a body's mass m (locomotion.json mass_kg, fauna.json mass_kg for a
// stand-in, times its size cubed) and its length (locomotion.json length_m, else LEN_K m^(1/3), Calder's length-mass
// scaling). Health is HP_K m^0.75 (Kleiber's scaling, as a body's metabolic reserve goes): a vole about 1, a brush rabbit
// 8, a mule deer 216, a zebra 640. A strike deals its share of that for the striker's own mass, so a bite takes a third of
// the health of prey the striker's own size (three bites kill a deer as big as the lion) and kills a rabbit outright. A
// strike reaches its share of the striker's length past its centre, plus the prey's half-length. Pounce is the gap-closer
// (the longest reach, the longest cooldown), bite the heavy hitter close in, swipe quick and cheap; lunge is the dog's
// shorter rush. A global cooldown (GCD) spaces any two strikes.
export const MOVES = {
  bite:   { key: 'bite',   name: 'bite',   reach: 1.0, cd: 4,   dmg: 0.34, hitAt: 0.22, dur: 0.5,  title: 'a lunge and a snap of the jaws: the heavy hit, close in' },
  swipe:  { key: 'swipe',  name: 'swipe',  reach: 1.15, cd: 1.5, dmg: 0.12, hitAt: 0.16, dur: 0.38, title: 'a forepaw raked across it: quick and cheap' },
  pounce: { key: 'pounce', name: 'pounce', reach: 5, cd: 12,  dmg: 0.2,  gap: true, title: 'a crouch, then a leap onto it from a distance: closes the gap' },
  lunge:  { key: 'lunge',  name: 'lunge',  reach: 3.5, cd: 7,   dmg: 0.18, gap: true, title: 'a short rush and a spring onto it' },
  // the snakes' one strike (2026-11-06): the fore body drawn back into an S, then thrown straight out at the prey and back,
  // a third of its length (a snake strikes a third to a half of its length; Greene 1997); its reach is measured from the
  // head, where a snake's position is (groundControl.js). A viper's carries venom: venom more of the struck prey's health
  // over venomT s after the bite (animals.js venomTick), the prey running off with it.
  strike: { key: 'strike', name: 'strike', reach: 0.33, cd: 2.5, dmg: 0.34, hitAt: 0.15, dur: 0.5, venom: 0.5, venomT: 8, title: 'drawn back into an S, then the head thrown out at it: a bite (a viper\'s carries venom, working on as the prey runs)' },
};
export const GCD = 1.0, HP_K = 10, LEN_K = 0.45, REGEN = 0.02, REGEN_DELAY = 8, FIGHT_K = 0.6, FIGHT_P = 0.18;   // s; health per kg^0.75; m per kg^(1/3); of the full health a second once REGEN_DELAY s past the last hit; prey this heavy against the striker may fight back, this often
const SNAKES = ['Colubridae', 'Natricidae', 'Viperidae', 'Elapidae', 'Boidae', 'Pythonidae', 'Lamprophiidae', 'Dipsadidae', 'Serpentes'];
const BY_FAMILY = { Felidae: ['bite', 'swipe', 'pounce'], Ursidae: ['bite', 'swipe', 'lunge'], ...Object.fromEntries(SNAKES.map(f => [f, ['strike']])) };
// the families whose bite carries venom that keeps working after the strike (MOVES.strike.venom)
export const venomous = family => family === 'Viperidae' || family === 'Elapidae';
export const DEFAULT_MOVES = ['bite', 'lunge'];
export const movesFor = family => (BY_FAMILY[family] || DEFAULT_MOVES).map(k => MOVES[k]);

// A species' body: { m: kg, len: m, family } from the tile's locomotion layer, a stand-in through its kin (its own mass from
// fauna.json, its length scaled from the kin's by the cube root of the masses).
export function bodyOf(tile, sp) {
  const L = tile?.locomotion?.species || {}, own = L[sp.code], kin = sp.standIn ? L[sp.standIn.kin] : null;
  let m = Number.isFinite(sp.mass_kg) ? sp.mass_kg : own?.mass_kg ?? null, len = own?.length_m ?? null;
  const family = own?.family || kin?.family || null;
  if (m == null && kin?.mass_kg) m = kin.mass_kg * (sp.standIn?.scale || 1) ** 3;
  if (m == null) m = 1;
  if (len == null && kin?.length_m && kin.mass_kg) len = kin.length_m * Math.cbrt(m / kin.mass_kg);
  if (len == null) len = LEN_K * Math.cbrt(m);
  return { m, len, family };
}
export const maxHp = m => Math.max(1, HP_K * Math.pow(Math.max(m, 0.001), 0.75));
export const damage = (move, m) => move.dmg * HP_K * Math.pow(Math.max(m, 0.001), 0.75);
// how far (m, centre to centre) a strike reaches from a striker of length len at prey of length lq
export const reachOf = (move, len, lq) => move.reach * len + 0.5 * lq;
