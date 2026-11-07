// The abilities toolbar (owner, 2026-10-28: "For each playable animal create a toolbar at the bottom with their
// abilities. Sprint, fly, leap, grab, dig, pounce, eat, etc - all of the basic abilities of each animal even if they
// aren't built yet (greyed out) along with the keyboard key in the bottom right corner showing you what to press in a
// small all caps font; to the left of that are any status bars."). One row along the bottom right of the screen
// (index.html #bodyBar): the body's status bars on the left (needs.js's food and water meters, #needs, and the legs, a
// hunter's stamina, #legs, which this module draws from groundControl's stamina and tired in place of the hunt panel's
// own), then the abilities, one slot per ability with its name in a small letter-spaced all-caps font and its key in
// the slot's bottom right corner, and over the slots a dimmer line of the page's keys (map, roads, present day, tags,
// mute, back to spirit form: not the body's own, so not among its slots). The hunt's goal line and arc (hunt.js #hunt)
// stand above the row, the toast above it too (main.js layoutHud); the row replaces the long #help line, which hides
// while the row is up. On a narrow window the slots wrap and the status bars go up a line (flex wrap-reverse).
//
// The table. Each body's slots are its control's moves first, then the species' verbs: built ones lit, the ones not
// built yet greyed (opacity .35, title "not yet") with a key kept for them where one makes sense. An entry is
// { name, key, built, lit?, show?, tired?, title? }: key the keys as the player presses them, space separated, each
// drawn as its own small box ('W S', 'shift W', '' for none: a passive sense, a contact); lit(c) whether the ability
// is on now (its key held, or its state: sprinting, bedded, hovering, a squirrel up a trunk), which lights the slot
// stronger; show(c) whether it applies in the body's present mode (a flier's air keys aloft, its hop and peck on its
// feet; drink only for a walker that drinks open water: needs.js rhythm); tired(c) the legs gone (the sprint's slot
// turns red). c is the frame's context: the controls, the flight (its held keys: flight.keys, the codes of every key
// down), the needs and the hunt.
//
// Where the keys come from: each control's own help line and key handling, not memory. The walkers (groundControl.js
// helpLine and update): W S run and back, A D turn, Shift + W a walk (the lion's stalk), Space a jump (the turkey and
// quail hop, and from a run flush and fly), Shift held still alert (the rodents sit up, the lizard does push-ups), E the
// species' act (graze, sniff, the bear's dig, nibble, peck, the turkey's scratch, the lizard's head flick), X lie down,
// hunch or bask where S.rest has one. A hunter's full run is the sprint (S.sprint: the legs last that many seconds,
// then tired) and its E within reach the catch; the lion's sprint is the rush, which catches on contact, so the true
// leap (pounce) is grey. A scavenger's E beside a carcass feeds (animals.js feedNear: the coyote and the bear on the
// ground). Drinking is E at water (needs.js). The fliers (flierControl.js, on flight.js): the arrows pitch, A D turn,
// W S speed, Shift boost, Space flap, X Z climb and descend, H hover (the jays, the raven) or soar (the hawk, the
// vulture), a slow flight into a limb or the ground lands; on its feet W S hop, A D turn, Space takes off, E pecks. A
// hunter among them takes prey on contact (the hawk, the scrub-jay); the vulture feeds on contact at carrion. The
// raven's own flight has its call (C, sound.js) but no strike or feed wired. The squirrel (squirrelControl.js): run,
// turn, jump, sit up, run into a trunk to climb, Space on the wood to leap or drop, E pick up, bury, dig, C bark. The
// woodpecker (woodpeckerControl.js): on a trunk W S hitch, A D round, Space flies; flying W S speed, A D turn, the
// arrows climb and dive, Space a burst, a trunk flown into is clung to; E takes an acorn or hammers it into the
// granary; C its waka. The spirit (spirit.js): fly, turn, pitch, Shift rush, X rise, Z sink, Space lift, H hover, and
// touching an animal becomes it. Grey, with keys kept: pounce F (the lion), carry F (the raven, the hawk, the bear),
// display F (the turkey's strut, the quail's, the deer's rut), dig Q, cache Q (the jays, the raven), mark K, den or
// burrow J (the lizard's hide), swim W in deep water (every mammal but the vole; not the birds), climb W into a trunk
// (the bear, the lizard), roost or rest X where S.rest has none, nest J (the squirrel), drum Q (the woodpecker), call C for a species
// whose voice sound.js has but the player cannot yet give (C now plays the raven's kraa for them), eat E at a kill
// (the lion, the fox: the catch fills the belly at once). Smell is the sniff (scent.js, 2026-10-29): L held, or the slot
// itself held, shows every scent on the air with its name; lit while sniffing.
//
// The table is by species code (SPECIES), falling back by the walker's rig (RIG: quad, rodent, bird, lizard) and by the
// control (the moves: groundMoves, FLIER_AIR / FLIER_FOOT, SQUIRREL, WOODPECKER, SPIRIT). The slots are rebuilt when the
// body changes and otherwise only have their classes toggled (lit, tired, hidden) when they change, every frame.
import { setStill } from './stills.js';

const on = (name, key, lit = null, more = {}) => ({ name, key, built: true, lit, ...more });
const no = (name, key = '', more = {}) => ({ name, key, built: false, ...more });
const E = c => c.k('KeyE');

// the verbs shared across bodies
const CATCH = on('catch', 'E', E, { title: 'E within reach of prey (a rush that reaches it catches it too)' });
// a scavenger's feed slot is "ready" (a warm edge) while a carcass is within reach (carrion.js: the needs panel names it and its stage)
const carcassNear = c => !!c.carrion?.near && c.carrion.nearD < 3.2 && c.carrion.near.meat > 1e-6;
const FEED = on('feed', 'E', E, { ready: carcassNear, title: 'E beside a carcass: a bite from it (the carcass decays over a day: carrion.js)' });
// the canids' mousing pounce (groundControl.js CATCH.pounce): E within 2.6 m of prey ahead, or a run that reaches it
const POUNCE_AT = on('pounce', 'E', c => c.ground.mode === 'pounce', { title: 'E within 2.6 m of prey ahead: the fix, the spring, the kill at the landing (a run onto it springs at once)' });
// the sniff: its own slot (L) unless the body's act (E) is already a sniff (the fox, the coyote, the lion: groundControl S.act), which sniffs too
const SMELL = on('sniff', 'L', c => !!c.scent?.sniffing, { press: (c, down) => c.scent?.sniff?.(down), show: c => !(c.ground?.on && (/sniff/.test(c.ground.S?.act?.word || '') || c.ground.S?.act?.sniff)), title: 'L, or hold this: every scent on the air, each with its name; a new scent flickers in on its own (scent.js)' });
const DRINK = on('drink', 'E', c => !!c.needs?.atWater && E(c), { show: c => !!c.needs && c.needs.rhythm !== 'none', title: 'E at water' });
const DRINK_NO = no('drink', 'E');
const POUNCE = no('pounce', 'F'), CARRY = no('carry', 'F'), DIG = no('dig', 'Q'), CACHE = no('cache', 'Q'), MARK = no('mark', 'K');
const DEN = no('den', 'J'), BURROW = no('burrow', 'J'), SWIM = no('swim', 'W', { title: 'not yet: wading is built, deep water stops the body' });
const CLIMB = no('climb', 'W'), CALL = no('call', 'C'), EAT = no('eat', 'E', { title: 'not yet: eating at the kill (the catch fills the belly at once)' });
// the Dig game (dig.js, docs/game-dig.md): the vole's tunnels and the coyote's pit, Q held (or E held with nothing else for E to do)
const DIG_VOLE = on('dig', 'Q', c => !!c.ground.digging, { title: 'Q held (or E with nothing to eat under the nose): a tunnel from the nose at 5 cm/s; with Q held ↓ angles it down and ↑ up (let go and it holds the slope), A D or the mouse steer; or drag the view up over the body to dig down, low to dig up; dig round in a small circle for a chamber; up to the surface for a second hole' });
const BURROW_IN = on('burrow', '', c => c.ground.mode === 'tunnel', { title: 'walk onto a hole to go down it; underground W follows the tunnel, W at a hole comes up' });
const PULL = on('pull', 'F', c => !!c.ground.dig?.pullT, { show: c => c.ground.mode === 'tunnel', title: 'F held with the nose at a herb\'s roots underground: pull the plant down into the tunnel (gone from the surface for everyone this season; it lies here as food). E eats any root at the nose: a bulb, a corm, grass roots, an oak\'s' });
const DIG_BURROW = on('dig', 'Q', c => !!c.ground.digging, { title: 'Q held: a burrow of your own from the nose at 10 cm/s; with Q held ↓ angles it down and ↑ up (let go and it holds the slope), A D or the mouse steer; or drag the view up over the body to dig down, low to dig up; X at its end digs out a nest; brush rabbits dig none of their own in life (docs/game-dig.md)' });
// the den (digDen.js, 2026-11-06): only underground; lit while it is dug or placed; the sweep the part left to dig
const DIG_DEN = on('dig den', '1', c => !!(c.ground.dig?.denOn || c.ground.dig?.dens?.placing), { show: c => c.ground.mode === 'tunnel',
  cd: c => { const k = c.ground.dig?.dens?.progress?.(); return k === null || k === undefined ? 0 : 1 - k; },
  press: (c, down) => { if (down) c.ground.dig?.dens?.press(); },
  title: '1 underground: a den, a big room off your tunnel. Its green outline follows the mouse at your depth (red where it would not join a tunnel); click to place it, Esc or right click to put it away. Digging it takes a while: any move stops it, and 1 or Q back at its outline goes on. Dens that overlap are one room' });
const DIG_FORM = on('dig', 'Q', c => !!c.ground.digging, { title: 'Q held: scrape a shallow form under the chest (30 cm across, 7 cm deep); X hunches in it' });
const DIG_PIT = on('dig', 'Q', c => !!c.ground.digging, { title: 'Q held (or E with no prey within reach): a pit at the paws at 1.27 cm/s; a vole tunnel it meets opens and glows toward the voles in it' });

// The walkers' moves, from groundControl's species entry S.
function groundMoves(S) {
  if (S.rig === 'snake') return [on('raise head', 'shift', c => c.ground.sit > 0.5, { title: 'Shift held still: the fore body raised, watching' })];
  const alert = S.alert?.pushups ? 'push-ups' : S.alert?.pose ? 'sit up' : 'alert';
  return [on(alert, 'shift', c => c.ground.sit > 0.5, { title: 'Shift held still' })];   // (the moves themselves are keys only, 2026-11-06: the strip over the slots names them)
}
// X: lie down, hunch, freeze (the brush rabbit) or bask (S.rest), else grey (a bird's roost, a rodent's rest)
const restOf = S => { if (S.rest === 'coil') return on('coil · bask', 'X', c => !!c.ground.resting || !!c.ground.sn?.basking, { title: 'X: coil; X again: crawl out of the coil a body length and bask there, stretched out; any move gets up' });
  const r = { bed: 'lie down', hunch: 'hunch', bask: 'bask', freeze: 'freeze' }[S.rest]; return r ? on(r, 'X', c => !!c.ground.resting) : no(S.rig === 'bird' ? 'roost' : 'rest', 'X'); };
// the act's slot is "ready" (a warm edge) while a named food plant is within reach of a hungry body (needs.js plant: the glowing one under the nose, forage.js)
// with a plant targeted (quarry.js) the act needs its reach (canEat, the one rule): out of it the slot is greyed, "get closer"
// (E walks the body there, then eats: groundControl approach); in it, "ready" while hungry
const actOf = (name, title) => on(name, 'E', c => c.ground.actT > 0 || E(c) || !!c.ground.approach, { ready: c => !!c.needs?.plant && c.needs.hunger < 0.98 && (c.quarry?.canEat?.() ?? true),
  oor: c => !!c.quarry?.target?.plant && !c.quarry.canEat(), oorTitle: c => `get closer to the ${c.quarry.target.name} (E walks you there)`, ...(title ? { title } : {}) });

// Per species: the walker's act word (E) and its verbs, built then not yet. Order on the bar: the moves, act, rest, verbs.
const SPECIES = {
  odocoileus_hemionus: { act: 'graze', verbs: [DRINK, SMELL, SWIM, MARK, no('rut', 'F'), CALL] },
  urocyon_cinereoargenteus: { act: 'sniff', verbs: [DRINK, SMELL, EAT, DIG, DEN, MARK, SWIM] },
  canis_latrans: { act: 'sniff', verbs: [FEED, DRINK, SMELL, DIG_PIT, DEN, MARK, SWIM, CALL] },
  puma_concolor: { act: 'sniff', verbs: [on('feed', 'E', c => !!c.ground.feeding, { ready: carcassNear, title: 'crouched over the kill after a catch, or E beside one' }), DRINK, SMELL, DEN, MARK, SWIM] },
  ursus_americanus: { act: 'dig', verbs: [FEED, DRINK, SMELL, CARRY, CLIMB, DEN, MARK, SWIM] },
  sylvilagus_bachmani: { act: 'nibble', verbs: [DRINK, SMELL, DIG_BURROW, DIG_DEN, BURROW_IN, PULL, SWIM] },
  lepus_californicus: { act: 'nibble', verbs: [DRINK, SMELL, DIG_FORM, SWIM] },
  microtus_californicus: { act: 'nibble', verbs: [DRINK, SMELL, DIG_VOLE, DIG_DEN, BURROW_IN, PULL] },
  otospermophilus_beecheyi: { act: 'pick seeds', verbs: [DRINK, SMELL, DIG, BURROW, SWIM, CALL] },
  sceloporus_occidentalis: { act: 'head flick', verbs: [DRINK, no('climb', 'W', { title: 'not yet: up a trunk or a fence (rocks it steps onto)' }), no('hide', 'J')] },
  meleagris_gallopavo: { act: 'peck · scratch', verbs: [DRINK, no('strut', 'F'), CALL] },
  callipepla_californica: { act: 'peck', verbs: [DRINK, no('display', 'F'), CALL] },
  oreortyx_pictus: { act: 'scratch', verbs: [DRINK, no('display', 'F'), CALL] },
  // the fliers (flierControl.js FLIERS) and the raven: their verbs after the flight's moves
  buteo_jamaicensis: { verbs: [on('strike', '', null, { title: 'fly into prey: taken on contact' }), CARRY, DRINK_NO, CALL] },
  cathartes_aura: { verbs: [on('feed', '', null, { ready: carcassNear, title: 'land beside a carcass: fed on contact, a bite every few seconds' }), SMELL, DRINK_NO] },
  aphelocoma_californica: { verbs: [on('take', '', null, { title: 'dive into a lizard: grabbed on contact, then down on it with a few pecks' }), CACHE, DRINK_NO, CALL] },
  cyanocitta_stelleri: { verbs: [CACHE, DRINK_NO, CALL] },
  corvus_corax: { verbs: [on('call', 'C', c => c.k('KeyC')),
    on('strike', 'E', c => !!c.flight.landed && c.flight.gnd?.stab > 0 && !!c.flight.gnd?.stabPrey, { show: c => !!c.flight.landed, title: 'E on the ground within reach of a lizard or vole: three quick hard bill stabs, the kill on the last' }),
    CARRY,
    on('feed', 'E', c => !!c.flight.landed && c.flight.gnd?.stab > 0 && !c.flight.gnd?.stabPrey, { show: c => !!c.flight.landed, ready: carcassNear, title: 'E beside a carcass: the same stabs; each burst a bite from it' }),
    CACHE, DRINK_NO] },
};
// the fallbacks by the walker's rig, for a species the table does not have
const RIG = {
  quad: { verbs: [DRINK, SMELL, SWIM] },
  rodent: { verbs: [DRINK, SMELL, BURROW] },
  bird: { verbs: [DRINK, CALL] },
  lizard: { verbs: [DRINK, no('hide', 'J')] },
  // a snake (snake.js): E's tongue flicks are its sniff (the scents and the sniff's wave); it swims (W into deep water)
  snake: { act: 'tongue flick', verbs: [on('swim', 'W', c => !!c.ground.wet, { show: c => c.ground.S?.swims !== false, title: 'W into deep water: it swims, the body riding the surface' }), DRINK, no('climb', 'W', { title: 'not yet: up a trunk or into a shrub' }), no('hide', 'J')] },
};

// The hunt's actions (owner, 2026-11-06: "For all hunters When a prey is targeted, the controls for the hunt appear"): shown
// only while a prey animal is selected (quarry.js), greyed while out of reach (`oor`), a radial sweep while cooling (`cd`).
// The dive (dive.js) for a hunting bird, key 1 (or Q); the walkers' strikes (combat.js: bite, swipe, pounce or lunge by
// family) on 1-3. A press of the slot plays it too.
const DIVE = on('dive', '1', c => !!c.dive?.active, { show: c => !!c.dive && !!c.quarry?.target && (c.dive.active || c.dive.me().hunts), oor: c => !c.dive.active && !c.dive.can(),
  press: (c, down) => { if (down) c.dive.toggle(); }, title: '1 (or Q) with a prey animal selected (Tab, or click it) below you: tuck the wings and stoop straight at it; it may see you coming; losing sight of it calls the dive off' });
const strikeSlot = (m, i) => on(m.name, String(i + 1), c => c.ground.strike?.kind === m.key || (m.key === 'pounce' && c.ground.mode === 'leap') || (m.key === 'lunge' && c.ground.mode === 'pounce'),
  { show: c => !!c.quarry?.target && !!c.combat?.active, oor: c => !c.combat.inReach(m.key), cd: c => c.combat.cooling(m.key), left: c => Math.max((c.combat.cd.get(m.key) || 0), c.combat.gcd) - c.combat.t,
    press: (c, down) => { if (down) c.combat.use(m.key); }, title: `${i + 1}: ${m.title} (its own cooldown ${m.cd} s)` });
// The spirit's one action while it holds a target (owner, 2026-11-06: "there is only one "action" [ Embody ] with the model
// of the animal as the icon"): the spirit flies itself into that animal and becomes it (pilot.js embody).
const EMBODY = on('embody', '1', c => !!c.pilot?.embodying, { show: c => !!c.quarry?.target, oor: c => !c.pilot?.embodying && c.quarry.animals.playable?.(c.quarry.target) === false, icon: c => c.quarry.target ? c.quarry.animals.speciesList()[c.quarry.target.sp] : null,
  press: (c, down) => { if (down) c.pilot?.embody(); }, title: '1 (or E): fly into this animal and become it' });
// The fliers' moves (flight.js on flierControl's numbers, and the raven's own): aloft, and on its feet.
const aloft = c => !c.flight.landed, afoot = c => !!c.flight.landed;
function flierMoves() {
  return [on('peck', 'E', c => E(c) || c.flight.gnd?.peck > 0, { show: afoot })];   // (the flight's moves are keys only: the strip names them)
}
// The squirrel's (squirrelControl.js): its modes ground, trunk, wood, limb, leap, air, work, stun.
const sqUp = c => ['trunk', 'wood', 'limb'].includes(c.squirrel.mode), sqWork = k => c => c.squirrel.work?.kind === k;
const SQUIRREL = [
  on('sit up', 'shift', c => c.squirrel.sit > 0.5),
  on('pick up', 'E', sqWork('pick')), on('bury', 'E', sqWork('bury')), on('dig', 'E', sqWork('dig')),
  on('call', 'C', c => c.k('KeyC')), SMELL,
  DRINK_NO, SWIM, no('nest', 'J'),
];
// The woodpecker's (woodpeckerControl.js): on a trunk (cling, and its work and paths), or flying.
const wpFly = c => c.woodpecker.mode === 'fly', wpOn = c => !wpFly(c);
const WOODPECKER = [
  on('take acorn', 'E', c => c.woodpecker.work?.kind === 'pick'),
  on('hammer', 'E', c => c.woodpecker.work?.kind === 'hammer', { title: 'E on your family\'s granary' }),
  on('call', 'C', c => c.k('KeyC')),
  no('drum', 'Q'), DRINK_NO,
];
// The spirit's (spirit.js, flight.js updateSpirit).
const SPIRIT = [
  EMBODY,
];
// The page's keys, by control, as each help line has them: the dim line over the slots.
// the movement keys (2026-11-06: the slots for them are gone; this strip is where the keys are taught)
const MOVE_KEYS = {
  ground: [['W S', 'move'], ['A D', 'turn'], ['shift W', 'sprint'], ['alt W', 'walk'], ['space', 'jump']],
  snake: [['W', 'crawl'], ['shift W', 'dash'], ['A D', 'steer'], ['S', 'stop'], ['E', 'tongue · strike'], ['X', 'coil · bask']],
  flier: [['↑ ↓', 'pitch'], ['A D', 'turn'], ['W S', 'speed'], ['shift', 'sprint'], ['space', 'flap'], ['X Z', 'climb · descend'], ['H', 'soar or hover']],
  raven: [['↑ ↓', 'pitch'], ['A D', 'turn'], ['W S', 'speed'], ['shift', 'sprint'], ['space', 'flap'], ['X Z', 'climb · descend'], ['H', 'hover']],
  squirrel: [['W S', 'run'], ['A D', 'turn'], ['shift W', 'sprint'], ['space', 'jump · leap']],
  woodpecker: [['W S', 'hitch · speed'], ['A D', 'round · turn'], ['↑ ↓', 'climb · dive'], ['space', 'fly · burst']],
  spirit: [['W S', 'fly'], ['A D', 'turn'], ['↑ ↓', 'pitch'], ['shift', 'rush'], ['X Z', 'rise · sink'], ['H', 'hover'], ['tab', 'target']],
};
const HUNT_KEYS = [['tab', 'target prey'], ['esc', 'clear']];
const DIG_KEYS = [['Q ↑ ↓', 'dig up · down'], ['1', 'dig den (underground)']];   // the tunnel diggers (dig.js KEY_DRAG): with Q held the arrows steer the dig's slope
const MORE = {
  ground: [['M', 'map'], ['G', 'roads'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute'], ['B', 'spirit form']],
  flier: [['V', 'view'], ['M', 'map'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute'], ['B', 'spirit form']],
  raven: [['V', 'view'], ['R', 'reset'], ['M', 'map'], ['G', 'roads'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute'], ['B', 'spirit form']],
  squirrel: [['M', 'map'], ['G', 'roads'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute'], ['B', 'spirit form']],
  woodpecker: [['M', 'map'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute'], ['B', 'spirit form']],
  spirit: [['V', 'view'], ['R', 'reset'], ['M', 'map'], ['G', 'roads'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute']],
};
const MOUSE = 'drag to orbit the camera · click a tree to identify';
const MOUSE_AIR = 'drag to steer in flight, to orbit the camera when still · click a tree to identify';   // flight.js steering
const MOUSE_SPIRIT = 'drag to steer · click a tree to identify';

// The slots for a body: kind is the control (ground, flier, raven, squirrel, woodpecker, spirit), code the species.
export function abilitiesFor(kind, code, S = null, strikes = null) {
  const sp = SPECIES[code];
  if (kind === 'ground' && S) {
    const t = sp || RIG[S.rig] || { verbs: [] }, word = t.act || S.act?.word || 'act';
    return [...(strikes || []).map(strikeSlot), ...groundMoves(S), actOf(word), restOf(S), ...t.verbs].filter(Boolean);
  }
  if (kind === 'flier') return [DIVE, ...flierMoves(), ...(sp?.verbs || [DRINK_NO, CALL])];
  if (kind === 'raven') return [...flierMoves(), ...(sp?.verbs || [DRINK_NO, CALL])];
  if (kind === 'squirrel') return SQUIRREL;
  if (kind === 'woodpecker') return WOODPECKER;
  return SPIRIT;
}

export class Abilities {
  // el: #abilities; legs: #legs (the legs meter in the status column); bar: #bodyBar (the row); the controls, the
  // flight, the needs and the hunt as main.js makes them
  constructor({ el, legs, bar, squirrel, woodpecker, ground, flier, spirit, flight, needs, hunt, scent = null, carrion = null, dive = null, combat = null, quarry = null, pilot = null }) {
    Object.assign(this, { el, legs, bar, squirrel, woodpecker, ground, flier, spirit, flight, needs, hunt, scent, carrion, dive, combat, quarry, pilot });
    this.body = ''; this.slots = []; this.visible = null;
    this.legsBar = legs?.querySelector('b') || null;
    const keys = flight.keys;
    this.c = { k: (...codes) => codes.some(x => keys.has(x)), shift: false, squirrel, woodpecker, ground, flier, spirit, flight, needs, hunt, scent, carrion, dive, combat, quarry, pilot };
  }
  // which body the player is in: [control, species code, the species' entry]
  which() {
    if (this.squirrel.on) return ['squirrel', 'sciurus_griseus', null];
    if (this.woodpecker.on) return ['woodpecker', 'melanerpes_formicivorus', null];
    if (this.ground.on) return ['ground', this.ground.code, this.ground.S];
    if (this.flier.on) return ['flier', this.flier.code, this.flier.S];
    if (this.spirit.on) return ['spirit', 'spirit', null];
    return ['raven', 'corvus_corax', null];
  }
  build(kind, code, S) {
    const row = document.createElement('div'); row.className = 'ab-row';
    const strikes = kind === 'ground' && this.combat?.code === code ? this.combat.moves : null;
    this.slots = abilitiesFor(kind, code, S, strikes).map(entry => {
      const d = document.createElement('div');
      d.className = entry.built ? 'ab' : 'ab off';
      let img = null, cd = null;
      if (entry.icon) { img = document.createElement('img'); img.className = 'ab-icon'; img.alt = ''; d.append(img); d.classList.add('icon'); }   // the target's still (the Embody slot)
      if (entry.cd) { cd = document.createElement('i'); cd.className = 'ab-cd'; cd.hidden = true; d.append(cd); }   // the cooldown's radial sweep
      d.title = entry.built ? (entry.title || entry.name) : (entry.title || 'not yet');
      const n = document.createElement('span'); n.className = 'ab-name'; n.textContent = entry.name; d.append(n);
      if (entry.key) {
        const k = document.createElement('span'); k.className = 'ab-k';
        for (const s of entry.key.split(' ')) { const b = document.createElement('kbd'); b.textContent = s; k.append(b); }
        d.append(k);
      }
      if (entry.built && entry.press) {   // a slot that is also a button: held down (the sniff)
        d.style.cursor = 'pointer';
        const up = e => { e.preventDefault(); entry.press(this.c, false); };
        d.addEventListener('pointerdown', e => { e.preventDefault(); entry.press(this.c, true); });
        d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up); d.addEventListener('pointerleave', up);
      }
      row.append(d);
      return { entry, el: d, img, cd, iconSp: null, cdf: -1, lit: false, tired: false, ready: false, oor: false, shown: true };
    });
    const more = document.createElement('div'); more.className = 'ab-more';
    for (const [key, word] of [...(MOVE_KEYS[kind === 'ground' && S?.rig === 'snake' ? 'snake' : kind] || []), ...(kind === 'ground' && (code === 'microtus_californicus' || code === 'sylvilagus_bachmani') ? DIG_KEYS : []), ...(strikes?.length || kind === 'flier' ? HUNT_KEYS : []), ...(MORE[kind] || [])]) { const s = document.createElement('span'), b = document.createElement('kbd'); b.textContent = key; s.append(b, ` ${word}`); more.append(s); }
    const m = document.createElement('span'); m.textContent = kind === 'spirit' ? MOUSE_SPIRIT : kind === 'raven' || kind === 'flier' ? MOUSE_AIR : MOUSE; more.append(m);
    this.el.replaceChildren(more, row);
    requestAnimationFrame(() => document.documentElement.style.setProperty('--abMoreH', `${more.offsetHeight || 30}px`));   // the target frame steps under the strip while the menu is open (index.html)
  }
  // every frame: show: the world is up and playable (not behind the opening screen)
  update(show = true) {
    if (this.visible !== show) { this.visible = show; if (this.bar) this.bar.hidden = !show; document.documentElement.classList.toggle('abilities', show); }
    if (!show) return;
    const [kind, code, S] = this.which(), body = `${kind}:${code}`;
    if (body !== this.body) { this.body = body; this.build(kind, code, S); }
    const c = this.c; c.shift = c.k('ShiftLeft', 'ShiftRight'); c.alt = c.k('AltLeft', 'AltRight');
    for (const s of this.slots) {
      const e = s.entry, shown = !e.show || !!e.show(c);
      if (shown !== s.shown) { s.shown = shown; s.el.hidden = !shown; }
      if (!e.built) continue;
      const lit = shown && !!e.lit?.(c), tired = shown && !!e.tired?.(c), ready = shown && !lit && !!e.ready?.(c);
      if (lit !== s.lit) { s.lit = lit; s.el.classList.toggle('lit', lit); }
      if (tired !== s.tired) { s.tired = tired; s.el.classList.toggle('tired', tired); }
      if (ready !== s.ready) { s.ready = ready; s.el.classList.toggle('ready', ready); }
      if (!shown) continue;
      if (e.oor) {
        const o = !!e.oor(c) && !lit; if (o !== s.oor) { s.oor = o; s.el.classList.toggle('oor', o); }
        if (e.oorTitle) { const tt = o ? e.oorTitle(c) : (e.title || e.name); if (s.el.title !== tt) s.el.title = tt; }   // (names the present target)
      }
      if (s.cd) {   // WoW's clock: the dark part is what is left, cleared clockwise from twelve; the seconds over 1.5
        const f = Math.max(0, Math.min(1, e.cd(c))), q = Math.round(f * 120) / 120;
        if (q !== s.cdf) {
          s.cdf = q; s.cd.hidden = q <= 0;
          if (q > 0) { s.cd.style.background = `conic-gradient(transparent 0deg ${((1 - q) * 360).toFixed(1)}deg, rgba(4,8,6,.68) 0deg)`; const left = e.left?.(c) ?? 0; s.cd.textContent = left > 1.5 ? `${Math.ceil(left)}` : ''; }
        }
      }
      if (s.img) { const sp = e.icon(c); if (sp && sp !== s.iconSp) { s.iconSp = sp; setStill(s.img, sp); } }
    }
    // the legs (the wings for a bird): every body's sprint meter (groundControl, squirrelControl, woodpeckerControl, the
    // birds' flight: stamina 0..1 and tired), red when tired
    if (this.legs) {
      const src = kind === 'ground' ? this.ground : kind === 'squirrel' ? this.squirrel : kind === 'woodpecker' ? this.woodpecker : kind === 'flier' || kind === 'raven' ? this.flight : null;
      const want = !!(src && src.stamina !== undefined);
      if (this.legs.hidden === want) this.legs.hidden = !want;
      if (want) {
        const w = `${Math.round((src.stamina ?? 1) * 100)}%`; if (this.legsBar && this.legsBar.style.width !== w) this.legsBar.style.width = w;
        this.legs.classList.toggle('low', !!src.tired);
      }
    }
  }
  // the world torn down (main.js disposeWorld): the slots go, the row hides
  dispose() {
    this.el.replaceChildren(); this.slots = []; this.body = '';
    if (this.bar) this.bar.hidden = true; if (this.legs) this.legs.hidden = true;
    document.documentElement.classList.remove('abilities');
  }
}
