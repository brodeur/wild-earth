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

const on = (name, key, lit = null, more = {}) => ({ name, key, built: true, lit, ...more });
const no = (name, key = '', more = {}) => ({ name, key, built: false, ...more });
const E = c => c.k('KeyE');

// the verbs shared across bodies
const CATCH = on('catch', 'E', E, { title: 'E within reach of prey (a rush that reaches it catches it too)' });
const FEED = on('feed', 'E', E, { title: 'E beside a carcass' });
// the sniff: its own slot (L) unless the body's act (E) is already a sniff (the fox, the coyote, the lion: groundControl S.act), which sniffs too
const SMELL = on('sniff', 'L', c => !!c.scent?.sniffing, { press: (c, down) => c.scent?.sniff?.(down), show: c => !(c.ground?.on && /sniff/.test(c.ground.S?.act?.word || '')), title: 'L, or hold this: every scent on the air, each with its name; a new scent flickers in on its own (scent.js)' });
const DRINK = on('drink', 'E', c => !!c.needs?.atWater && E(c), { show: c => !!c.needs && c.needs.rhythm !== 'none', title: 'E at water' });
const DRINK_NO = no('drink', 'E');
const POUNCE = no('pounce', 'F'), CARRY = no('carry', 'F'), DIG = no('dig', 'Q'), CACHE = no('cache', 'Q'), MARK = no('mark', 'K');
const DEN = no('den', 'J'), BURROW = no('burrow', 'J'), SWIM = no('swim', 'W', { title: 'not yet: wading is built, deep water stops the body' });
const CLIMB = no('climb', 'W'), CALL = no('call', 'C'), EAT = no('eat', 'E', { title: 'not yet: eating at the kill (the catch fills the belly at once)' });

// The walkers' moves, from groundControl's species entry S.
function groundMoves(S) {
  const g = c => c.ground, still = c => !c.shift;
  const alert = S.alert?.pushups ? 'push-ups' : S.alert?.pose ? 'sit up' : 'alert';
  return [
    on('run', 'W S', c => still(c) && c.k('KeyW', 'KeyS', 'ArrowUp', 'ArrowDown')),
    on('turn', 'A D', c => c.k('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight')),
    on(S.stalk ? 'stalk' : 'walk', 'shift W', c => c.shift && c.k('KeyW', 'ArrowUp')),
    S.sprint && on(S.stalk ? 'rush' : 'sprint', 'W', c => !!g(c).rush, { tired: c => !!g(c).tired, title: `hold W: a full run lasts ${S.sprint} s, then the legs are tired` }),
    on(S.flush ? 'hop' : 'jump', 'space', c => c.k('Space') && g(c).mode !== 'fly'),
    S.flush && on('flush', 'space', c => g(c).mode === 'fly', { title: 'Space from a run: flush and fly' }),
    on(alert, 'shift', c => g(c).sit > 0.5, { title: 'Shift held still' }),
  ].filter(Boolean);
}
// X: lie down, hunch or bask (S.rest), else grey (a bird's roost, a rodent's rest)
const restOf = S => { const r = { bed: 'lie down', hunch: 'hunch', bask: 'bask' }[S.rest]; return r ? on(r, 'X', c => !!c.ground.resting) : no(S.rig === 'bird' ? 'roost' : 'rest', 'X'); };
const actOf = (name, title) => on(name, 'E', c => c.ground.actT > 0 || E(c), title ? { title } : {});

// Per species: the walker's act word (E) and its verbs, built then not yet. Order on the bar: the moves, act, rest, verbs.
const SPECIES = {
  odocoileus_hemionus: { act: 'graze', verbs: [DRINK, SMELL, SWIM, MARK, no('rut', 'F'), CALL] },
  urocyon_cinereoargenteus: { act: 'sniff', verbs: [CATCH, DRINK, SMELL, EAT, DIG, DEN, MARK, SWIM] },
  canis_latrans: { act: 'sniff', verbs: [CATCH, FEED, DRINK, SMELL, DIG, DEN, MARK, SWIM, CALL] },
  puma_concolor: { act: 'sniff', verbs: [CATCH, DRINK, SMELL, POUNCE, EAT, DEN, MARK, SWIM] },
  ursus_americanus: { act: 'dig', verbs: [FEED, DRINK, SMELL, CARRY, CLIMB, DEN, MARK, SWIM] },
  sylvilagus_bachmani: { act: 'nibble', verbs: [DRINK, SMELL, SWIM] },
  lepus_californicus: { act: 'nibble', verbs: [DRINK, SMELL, SWIM] },
  microtus_californicus: { act: 'nibble', verbs: [DRINK, SMELL, BURROW] },
  otospermophilus_beecheyi: { act: 'pick seeds', verbs: [DRINK, SMELL, DIG, BURROW, SWIM, CALL] },
  sceloporus_occidentalis: { act: 'head flick', verbs: [DRINK, no('climb', 'W', { title: 'not yet: up a trunk or a fence (rocks it steps onto)' }), no('hide', 'J')] },
  meleagris_gallopavo: { act: 'peck · scratch', verbs: [DRINK, no('strut', 'F'), CALL] },
  callipepla_californica: { act: 'peck', verbs: [DRINK, no('display', 'F'), CALL] },
  oreortyx_pictus: { act: 'scratch', verbs: [DRINK, no('display', 'F'), CALL] },
  // the fliers (flierControl.js FLIERS) and the raven: their verbs after the flight's moves
  buteo_jamaicensis: { verbs: [on('strike', '', null, { title: 'fly into prey: taken on contact' }), CARRY, DRINK_NO, CALL] },
  cathartes_aura: { verbs: [on('feed', '', null, { title: 'land beside a carcass: fed on contact' }), SMELL, DRINK_NO] },
  aphelocoma_californica: { verbs: [on('take', '', null, { title: 'fly into a lizard: taken on contact' }), CACHE, DRINK_NO, CALL] },
  cyanocitta_stelleri: { verbs: [CACHE, DRINK_NO, CALL] },
  corvus_corax: { verbs: [on('call', 'C', c => c.k('KeyC')), no('strike'), CARRY, no('feed'), CACHE, DRINK_NO] },
};
// the fallbacks by the walker's rig, for a species the table does not have
const RIG = {
  quad: { verbs: [DRINK, SMELL, SWIM] },
  rodent: { verbs: [DRINK, SMELL, BURROW] },
  bird: { verbs: [DRINK, CALL] },
  lizard: { verbs: [DRINK, no('hide', 'J')] },
};

// The fliers' moves (flight.js on flierControl's numbers, and the raven's own): aloft, and on its feet.
const aloft = c => !c.flight.landed, afoot = c => !!c.flight.landed;
function flierMoves(soar) {
  return [
    on('pitch', '↑ ↓', c => c.k('ArrowUp', 'ArrowDown'), { show: aloft }),
    on('turn', 'A D', c => c.k('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'), { show: aloft }),
    on('speed', 'W S', c => c.k('KeyW', 'KeyS'), { show: aloft }),
    on('boost', 'shift', c => c.shift, { show: aloft }),
    on('flap', 'space', c => c.k('Space') || c.flight.flap > 0, { show: aloft }),
    on('climb', 'X', c => c.k('KeyX'), { show: aloft }),
    on('descend', 'Z', c => c.k('KeyZ'), { show: aloft }),
    on(soar ? 'soar' : 'hover', 'H', c => !!c.flight.hover, { show: aloft }),
    on('land', '', null, { show: aloft, title: 'fly slowly into a limb or the ground' }),
    on('hop', 'W S', c => !c.shift && c.k('KeyW', 'KeyS'), { show: afoot }),
    on('turn', 'A D', c => !c.shift && c.k('KeyA', 'KeyD'), { show: afoot }),
    on('take off', 'space', c => c.k('Space') || c.flight.gnd?.lift >= 0, { show: afoot }),
    on('peck', 'E', c => E(c) || c.flight.gnd?.peck > 0, { show: afoot }),
  ];
}
// The squirrel's (squirrelControl.js): its modes ground, trunk, wood, limb, leap, air, work, stun.
const sqUp = c => ['trunk', 'wood', 'limb'].includes(c.squirrel.mode), sqWork = k => c => c.squirrel.work?.kind === k;
const SQUIRREL = [
  on('run', 'W S', c => c.k('KeyW', 'KeyS', 'ArrowUp', 'ArrowDown')),
  on('turn', 'A D', c => c.k('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight')),
  on('jump', 'space', c => c.k('Space') && !sqUp(c)),
  on('sit up', 'shift', c => c.squirrel.sit > 0.5),
  on('climb', '', sqUp, { title: 'run into a trunk' }),
  on('leap', 'space', c => c.squirrel.mode === 'leap', { title: 'Space on the wood: a leap to wood ahead, or a drop' }),
  on('pick up', 'E', sqWork('pick')), on('bury', 'E', sqWork('bury')), on('dig', 'E', sqWork('dig')),
  on('call', 'C', c => c.k('KeyC')), SMELL,
  DRINK_NO, SWIM, no('nest', 'J'),
];
// The woodpecker's (woodpeckerControl.js): on a trunk (cling, and its work and paths), or flying.
const wpFly = c => c.woodpecker.mode === 'fly', wpOn = c => !wpFly(c);
const WOODPECKER = [
  on('hitch', 'W S', c => c.k('KeyW', 'KeyS'), { show: wpOn }),
  on('round', 'A D', c => c.k('KeyA', 'KeyD'), { show: wpOn }),
  on('fly', 'space', c => c.k('Space'), { show: wpOn }),
  on('speed', 'W S', c => c.k('KeyW', 'KeyS'), { show: wpFly }),
  on('turn', 'A D', c => c.k('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'), { show: wpFly }),
  on('climb · dive', '↑ ↓', c => c.k('ArrowUp', 'ArrowDown'), { show: wpFly }),
  on('burst', 'space', c => c.k('Space'), { show: wpFly }),
  on('cling', '', null, { show: wpFly, title: 'fly into a trunk; S low to land' }),
  on('take acorn', 'E', c => c.woodpecker.work?.kind === 'pick'),
  on('hammer', 'E', c => c.woodpecker.work?.kind === 'hammer', { title: 'E on your family\'s granary' }),
  on('call', 'C', c => c.k('KeyC')),
  no('drum', 'Q'), DRINK_NO,
];
// The spirit's (spirit.js, flight.js updateSpirit).
const SPIRIT = [
  on('fly', 'W S', c => c.k('KeyW', 'KeyS')),
  on('turn', 'A D', c => c.k('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight')),
  on('pitch', '↑ ↓', c => c.k('ArrowUp', 'ArrowDown')),
  on('rush', 'shift', c => c.shift),
  on('rise', 'X', c => c.k('KeyX')),
  on('sink', 'Z', c => c.k('KeyZ')),
  on('lift', 'space', c => c.k('Space')),
  on('hover', 'H', c => !!c.flight.hover),
  on('become', '', null, { title: 'touch an animal to become it (the warm ones)' }),
];
// The page's keys, by control, as each help line has them: the dim line over the slots.
const MORE = {
  ground: [['M', 'map'], ['G', 'roads'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute'], ['B', 'spirit form']],
  flier: [['V', 'view'], ['M', 'map'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute'], ['B', 'spirit form']],
  raven: [['V', 'view'], ['R', 'reset'], ['M', 'map'], ['G', 'roads'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute'], ['B', 'spirit form']],
  squirrel: [['M', 'map'], ['G', 'roads'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute'], ['B', 'spirit form']],
  woodpecker: [['M', 'map'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute'], ['B', 'spirit form']],
  spirit: [['V', 'view'], ['R', 'reset'], ['M', 'map'], ['G', 'roads'], ['P', 'present day'], ['T', 'tags'], ['N', 'mute']],
};
const MOUSE = 'drag to look · click a tree to identify';

// The slots for a body: kind is the control (ground, flier, raven, squirrel, woodpecker, spirit), code the species.
export function abilitiesFor(kind, code, S = null) {
  const sp = SPECIES[code];
  if (kind === 'ground' && S) {
    const t = sp || RIG[S.rig] || { verbs: [] }, word = t.act || S.act?.word || 'act';
    return [...groundMoves(S), actOf(word), restOf(S), ...t.verbs].filter(Boolean);
  }
  if (kind === 'flier' || kind === 'raven') return [...flierMoves(!!S?.flight?.soar), ...(sp?.verbs || [DRINK_NO, CALL])];
  if (kind === 'squirrel') return SQUIRREL;
  if (kind === 'woodpecker') return WOODPECKER;
  return SPIRIT;
}

export class Abilities {
  // el: #abilities; legs: #legs (the legs meter in the status column); bar: #bodyBar (the row); the controls, the
  // flight, the needs and the hunt as main.js makes them
  constructor({ el, legs, bar, squirrel, woodpecker, ground, flier, spirit, flight, needs, hunt, scent = null }) {
    Object.assign(this, { el, legs, bar, squirrel, woodpecker, ground, flier, spirit, flight, needs, hunt, scent });
    this.body = ''; this.slots = []; this.visible = null;
    this.legsBar = legs?.querySelector('b') || null;
    const keys = flight.keys;
    this.c = { k: (...codes) => codes.some(x => keys.has(x)), shift: false, squirrel, woodpecker, ground, flier, spirit, flight, needs, hunt, scent };
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
    this.slots = abilitiesFor(kind, code, S).map(entry => {
      const d = document.createElement('div');
      d.className = entry.built ? 'ab' : 'ab off';
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
      return { entry, el: d, lit: false, tired: false, shown: true };
    });
    const more = document.createElement('div'); more.className = 'ab-more';
    for (const [key, word] of MORE[kind] || []) { const s = document.createElement('span'), b = document.createElement('kbd'); b.textContent = key; s.append(b, ` ${word}`); more.append(s); }
    const m = document.createElement('span'); m.textContent = MOUSE; more.append(m);
    this.el.replaceChildren(more, row);
  }
  // every frame: show: the world is up and playable (not behind the opening screen)
  update(show = true) {
    if (this.visible !== show) { this.visible = show; if (this.bar) this.bar.hidden = !show; document.documentElement.classList.toggle('abilities', show); }
    if (!show) return;
    const [kind, code, S] = this.which(), body = `${kind}:${code}`;
    if (body !== this.body) { this.body = body; this.build(kind, code, S); }
    const c = this.c; c.shift = c.k('ShiftLeft', 'ShiftRight');
    for (const s of this.slots) {
      const e = s.entry, shown = !e.show || !!e.show(c);
      if (shown !== s.shown) { s.shown = shown; s.el.hidden = !shown; }
      if (!e.built) continue;
      const lit = shown && !!e.lit?.(c), tired = shown && !!e.tired?.(c);
      if (lit !== s.lit) { s.lit = lit; s.el.classList.toggle('lit', lit); }
      if (tired !== s.tired) { s.tired = tired; s.el.classList.toggle('tired', tired); }
    }
    // the legs: a walking hunter's stamina (groundControl S.sprint), shown while the hunt is on
    if (this.legs) {
      const g = this.ground, want = !!(g.on && g.S?.sprint && this.hunt?.on);
      if (this.legs.hidden === want) this.legs.hidden = !want;
      if (want) {
        const w = `${Math.round((g.stamina ?? 1) * 100)}%`; if (this.legsBar && this.legsBar.style.width !== w) this.legsBar.style.width = w;
        this.legs.classList.toggle('low', !!g.tired);
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
