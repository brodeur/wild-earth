// What an animal is doing: one vocabulary for every species (docs/decisions.md 2026-11-07 "one vocabulary for what an
// animal is doing"). Each behaviour machine in animals.js maps its own states onto ACT (animals.js DOING), with an
// optional manner word (`how`: 'act:how', as 'forage:graze' or 'hunt:stalk'); animals.doing(a) answers the act, for the
// sniff, the hunt, the identify cards and the shared animals. The words a card shows (say) are made by rule from the
// act and manner, the animal's archetype (the pipeline's: pipeline/fauna_slots.py kin_for, so a stand-in on any tile
// reads as what it is, not as its kin) and the moment's context (the habitat under it, its group, the hour, its prey or
// food). A species' own phrases are an optional table (PHRASES): the hand-written lines of the first casts, kept as
// recorded fine-tunes over the rule.
//
// No three.js and no DOM here: node can import it (tests/test_activities.py).

export const ACT = Object.freeze({
  REST: 'rest',       // bedded, lying up, roosting, asleep
  FORAGE: 'forage',   // grazing, browsing, pecking, digging for food, eating, caching it
  HUNT: 'hunt',       // stalking, rushing, pouncing, stooping, watching for prey
  TRAVEL: 'travel',   // walking, running, climbing, crawling somewhere
  FLEE: 'flee',       // running, diving or dashing from a threat
  ALERT: 'alert',     // head up and watching, a sentry, a crouch before flushing, a charge or a stare
  PERCH: 'perch',     // sitting in a tree, on a rock or a post
  BASK: 'bask',       // warming in the sun
  COURT: 'court',     // displaying to a mate or a rival
  YOUNG: 'young',     // with and caring for its young
  HIDE: 'hide',       // frozen, in cover, down a burrow, drawn in
  NEST: 'nest',       // building a nest, digging a burrow or den
  SWIM: 'swim',       // swimming, floating, diving
  FLY: 'fly',         // flapping, soaring, gliding
});
export const ACTS = Object.freeze(Object.values(ACT));
// 'act:how' (or 'act') split; an unknown act reads as rest
export function parseDoing(s) {
  const i = typeof s === 'string' ? s.indexOf(':') : -1, act = i < 0 ? s : s.slice(0, i), how = i < 0 ? '' : s.slice(i + 1);
  return { act: ACTS.includes(act) ? act : ACT.REST, how };
}

// The archetype of each species the client draws itself (the pipeline's names, pipeline/fauna_slots.py kin_for); a fauna
// slot brings its own (fauna.json `archetype`).
export const STATIC_ARCHETYPE = {
  sciurus_griseus: 'tree squirrel', melanerpes_formicivorus: 'woodpecker', corvus_corax: 'corvid', odocoileus_hemionus: 'grazing or browsing herd',
  callipepla_californica: 'ground bird', aphelocoma_californica: 'perching bird', buteo_jamaicensis: 'soaring raptor', cathartes_aura: 'soaring scavenger',
  cyanocitta_stelleri: 'perching bird', urocyon_cinereoargenteus: 'coursing predator', canis_latrans: 'coursing predator', sylvilagus_bachmani: 'hopper',
  microtus_californicus: 'small rodent', puma_concolor: 'ambush predator', lepus_californicus: 'hopper', meleagris_gallopavo: 'ground bird',
  otospermophilus_beecheyi: 'ground colony', sceloporus_occidentalis: 'basking lizard', ursus_americanus: 'large omnivore', oreortyx_pictus: 'ground bird',
  cervus_canadensis: 'grazing or browsing herd', tamiasciurus_douglasii: 'tree squirrel', troglodytes_pacificus: 'perching bird', perisoreus_canadensis: 'perching bird',
  poecile_rufescens: 'perching bird', strix_varia: 'night perching bird', megaceryle_alcyon: 'kingfisher', haliaeetus_leucocephalus: 'soaring raptor',
  corvus_brachyrhynchos: 'corvid', lynx_rufus: 'ambush predator', lontra_canadensis: 'swimmer (otter)', lepus_americanus: 'hopper',
  tamias_townsendii: 'small rodent', peromyscus_maniculatus: 'small rodent', plethodon_vehiculum: 'amphibian', ensatina_eschscholtzii: 'amphibian',
  ariolimax_columbianus: 'slug', ardea_herodias: 'wading bird', mergus_merganser: 'waterbird', turdus_migratorius: 'perching bird',
  sturnus_vulgaris: 'perching bird', ixoreus_naevius: 'perching bird', junco_hyemalis: 'perching bird', regulus_satrapa: 'perching bird',
  empidonax_difficilis: 'perching bird', megascops_kennicottii: 'night perching bird', aegolius_acadicus: 'night perching bird', leuconotopicus_villosus: 'woodpecker',
  pandion_haliaetus: 'soaring raptor', accipiter_striatus: 'soaring raptor', falco_columbarius: 'soaring raptor', larus_glaucescens: 'gull',
  larus_californicus: 'gull', larus_occidentalis: 'gull', anas_platyrhynchos: 'waterbird', dendragapus_fuliginosus: 'ground bird',
  marmota_olympus: 'ground colony', tamias_amoenus: 'small rodent', sorex_monticolus: 'small ground mammal', anaxyrus_boreas: 'amphibian',
  rana_cascadae: 'amphibian',
};

// Archetype -> family (the phrase tables' key). Every archetype the pipeline can write is here (tests/test_activities.py
// reads them out of pipeline/fauna_slots.py); an unknown one falls back to its machine's family (MACHINE_FAMILY).
export const FAMILY = {
  'grazing or browsing herd': 'herd', 'soaring raptor': 'raptor', 'soaring scavenger': 'scavenger', 'night perching bird': 'owl',
  corvid: 'corvid', 'wading bird': 'wader', waterbird: 'waterbird', gull: 'gull', kingfisher: 'kingfisher', woodpecker: 'woodpecker',
  'ground bird': 'groundbird', 'perching bird': 'songbird', 'large ground primate (stand-in walker)': 'primate', 'arboreal climber': 'climber',
  'ambush predator': 'cat', 'coursing predator': 'canid', 'large omnivore': 'bear', 'swimmer (otter)': 'otter', 'small carnivore': 'smallcarn',
  hopper: 'hopper', 'rock colony': 'colony', 'ground colony': 'colony', 'tree squirrel': 'treesquirrel', 'large rodent': 'bigrodent',
  'small rodent': 'smallmammal', 'small ground mammal': 'insectivore', 'mammal (unplaced)': 'mammal', snake: 'snake', crocodilian: 'croc',
  turtle: 'turtle', tortoise: 'tortoise', 'basking lizard': 'lizard', 'monitor lizard': 'lizard', chameleon: 'lizard', amphibian: 'amphibian',
  slug: 'slug',
};
// a machine's family when the archetype says nothing (animals.js machineOf names the machines)
export const MACHINE_FAMILY = { sq: 'treesquirrel', wp: 'woodpecker', rv: 'corvid', dr: 'herd', mm: 'canid', rb: 'hopper', jk: 'hopper', vo: 'smallmammal',
  tk: 'groundbird', gs: 'colony', lz: 'lizard', rp: 'croc', sn: 'snake', sl: 'slug', qu: 'groundbird', sj: 'songbird', hk: 'raptor', tv: 'scavenger' };
export const BIRD_FAMILIES = new Set(['raptor', 'scavenger', 'owl', 'corvid', 'wader', 'waterbird', 'gull', 'kingfisher', 'woodpecker', 'groundbird', 'songbird']);
export function familyOf(archetype, machine) { return FAMILY[archetype] || MACHINE_FAMILY[machine] || 'mammal'; }

// What its group is called, by family (a canid of 15 kg or more runs in a pack: the wolf, not the fox; a mother's young
// are cubs or young)
const GROUP_WORD = { herd: 'herd', canid: 'family', groundbird: 'flock', songbird: 'flock', waterbird: 'flock', gull: 'flock', colony: 'colony',
  corvid: 'family', otter: 'family', primate: 'troop', climber: 'troop', scavenger: 'kettle', smallcarn: 'family', cat: 'group', bear: 'group' };
const YOUNG_WORD = { cat: 'cubs', bear: 'cubs', canid: 'pups' };

// Placeholders, by the habitat class under the animal (pipeline/habitat.py: 1 oak woodland, 2 conifer, 3 mixed, 4 chaparral,
// 5 grassland, 6 riparian, 7 water, 8 barren, 9 human, rewilded as grassland). '' where nothing fits.
const HAB = {
  where: { 1: 'under the oaks', 2: 'on the forest floor', 3: 'in the woods', 4: 'in the brush', 5: 'in the grass', 6: 'by the stream', 7: 'at the water', 8: 'among the rocks', 9: 'in the grass' },
  open: { 1: 'in the open oak woodland', 2: 'in a forest clearing', 3: 'in a clearing', 4: 'between the shrubs', 5: 'on the open grass', 6: 'on the river flat', 7: 'at the water\'s edge', 8: 'on the stony ground', 9: 'on the open grass' },
  cover: { 1: 'in the shade of the oaks', 2: 'in the forest understory', 3: 'under the trees', 4: 'in the brush', 5: 'in the long grass', 6: 'in the streamside thicket', 7: 'by the water', 8: 'among the rocks', 9: 'in the long grass' },
  through: { 1: 'over the leaf litter', 2: 'over the needles', 3: 'over the leaf litter', 4: 'through the brush', 5: 'through the grass', 6: 'through the grass', 7: 'along the water', 8: 'over the rocks', 9: 'through the grass' },
  // a grazer in the open grazes; among trees it browses; between shrubs (a grazer on the grass between the sage, a browser
  // on the shrubs) it feeds
  graze: { 1: 'browsing', 2: 'browsing', 3: 'browsing', 4: 'feeding', 5: 'grazing', 6: 'grazing', 7: 'grazing', 8: 'grazing', 9: 'grazing' },
};

// The rule's words. A key is 'act:how' or 'act'; GENERIC holds every act, so every animal has a line.
const GENERIC = {
  'rest': 'resting {where}', 'rest:bed': 'bedded down {cover} {group}', 'rest:form': 'hunched in its form {cover}', 'rest:roost': 'roosting for the night',
  'rest:dead': 'lying dead',
  'forage': 'feeding {where} {group}', 'forage:graze': '{graze} {open} {group}', 'forage:browse': 'browsing {where} {group}', 'forage:ground': 'foraging on the ground',
  'forage:walk': 'walking about on the ground, foraging', 'forage:scratch': 'scratching the leaves for food', 'forage:sniff': 'nosing about for food',
  'forage:kill': 'feeding on its kill', 'forage:carcass': 'feeding at a carcass', 'forage:circle': 'circling over a carcass', 'forage:cache': 'burying food to eat later',
  'forage:raid': 'raiding a woodpecker\'s acorn store', 'forage:acorn': 'taking an acorn', 'forage:eat': 'sitting up, eating', 'forage:bark': 'clinging to the bark, probing for insects',
  'forage:dabble': 'dabbling at the water\'s edge',
  'hunt': 'hunting', 'hunt:stalk': 'stalking {prey}', 'hunt:crouch': 'crouched low, watching {prey}', 'hunt:rush': 'rushing at {prey}', 'hunt:approach': 'closing in on {prey}',
  'hunt:fix': 'frozen, fixing {prey} before the pounce', 'hunt:pounce': 'pouncing on {prey}', 'hunt:dig': 'digging after {prey} underground', 'hunt:stoop': 'stooping on {prey}',
  'hunt:perch': 'watching for prey from its perch', 'hunt:watch': 'standing still, watching for prey', 'hunt:dive': 'diving after prey',
  'travel': 'on the move {group}', 'travel:climb': 'climbing the trunk', 'travel:limb': 'running along a limb', 'travel:home': 'heading for its burrow',
  'travel:runway': 'running along its runway', 'travel:cover': 'heading into cover', 'travel:carcass': 'heading for a carcass',
  'flee': 'fleeing', 'flee:burrow': 'running for its burrow', 'flee:cover': 'dashing for cover', 'flee:tree': 'escaping up a tree', 'flee:group': 'moving off with its {groupword}',
  'alert': 'standing alert, watching', 'alert:sit': 'sitting up, looking round', 'alert:sentry': 'keeping watch for its {groupword}', 'alert:peek': 'peeking out of its burrow',
  'alert:crouch': 'crouched, about to flush', 'alert:charge': 'bluff-charging', 'alert:stare': 'standing its ground, watching you', 'alert:mob': 'diving at an intruder',
  'perch': 'perched in a tree', 'perch:limb': 'sitting up on a limb, looking about', 'perch:top': 'keeping watch from a treetop', 'perch:ground': 'standing on the ground',
  'bask': 'basking in the sun', 'bask:coil': 'basking, coiled in the sun',
  'court': 'courting', 'court:pushup': 'doing push-ups (a male showing off)',
  'young': 'with its {youngword}', 'young:bed': 'lying up with its {youngword}', 'young:guard': 'standing over its {youngword}, watching',
  'hide': 'hidden in cover', 'hide:freeze': 'frozen still, trusting its camouflage', 'hide:burrow': 'down its burrow', 'hide:withdraw': 'drawn in, keeping still',
  'hide:sink': 'sunk to its eyes, watching',
  'nest': 'building its nest', 'nest:dig': 'digging a burrow',
  'swim': 'swimming', 'swim:float': 'floating in the water', 'swim:dive': 'diving under the water',
  'fly': 'flying', 'fly:soar': 'soaring on a thermal', 'fly:glide': 'gliding', 'fly:climb': 'climbing on strong wingbeats', 'fly:flush': 'flushed, flying off',
  'fly:up': 'flying up into a tree', 'fly:down': 'flying down to the ground',
};
// Each family's own words over GENERIC.
const FAMILY_PHRASES = {
  herd: { 'travel': 'walking {group}', 'alert': 'head up, watching', 'flee': 'running off {group}', 'young': 'with its young' },
  raptor: { 'fly:soar': 'soaring, watching the ground below', 'fly:glide': 'gliding over the land', 'fly': 'flying', 'perch': 'perched, watching for prey',
    'fly:climb': 'flapping back up into the sky', 'hunt:stoop': 'stooping on {prey}' },
  scavenger: { 'fly:soar': 'circling on the warm air', 'fly:glide': 'gliding low, looking for carrion', 'forage:circle': 'circling lower over a carcass' },
  owl: { 'fly': 'flying silently between the trees', 'hunt:perch': 'watching and listening from its perch', 'rest:roost': 'roosting through the day', 'perch': 'perched quietly' },
  corvid: { 'fly:soar': 'soaring and tumbling on the wind', 'fly:glide': 'gliding over the land', 'fly:climb': 'flapping up off the ground', 'forage:ground': 'on the ground, picking at food',
    'forage:cache': 'hiding food under a shrub', 'forage:walk': 'walking about on the ground, looking for food', 'perch': 'perched, looking about' },
  wader: { 'fly': 'flying off on slow deep wingbeats', 'fly:flush': 'flying off on slow deep wingbeats', 'hunt:stalk': 'stalking slowly through the shallows',
    'hunt:watch': 'standing still in the shallows, watching for fish', 'forage': 'wading in the shallows' },
  waterbird: { 'fly': 'flying off low over the water', 'fly:flush': 'flying off low over the water', 'swim': 'swimming on the water', 'swim:dive': 'diving under the water',
    'forage': 'feeding on the water', 'alert:crouch': 'head up, about to take off' },
  gull: { 'fly:soar': 'circling on the wind', 'fly:glide': 'gliding over the land', 'fly': 'flying' },
  kingfisher: { 'fly': 'flying low and fast over the water', 'hunt:dive': 'diving for a fish', 'hunt:perch': 'watching the water from its perch', 'perch': 'watching the water from its perch' },
  woodpecker: { 'fly': 'flying in deep undulations to the next trunk', 'forage:bark': 'clinging to the bark, tapping for insects', 'forage:cache': 'storing an acorn in its granary',
    'perch:top': 'keeping watch from the top of a tree', 'alert:mob': 'diving at a raider at its granary', 'forage:acorn': 'pecking an acorn free' },
  groundbird: { 'forage': 'scratching for seeds {where} {group}', 'travel': 'running {group}', 'fly:flush': 'flushed, whirring off', 'fly': 'flying off on whirring wings',
    'perch': 'up in a tree, watching', 'rest:roost': 'roosting for the night' },
  songbird: { 'forage:ground': 'hopping on the ground, foraging', 'perch': 'perched in a tree', 'fly': 'flying to the next tree', 'forage:raid': 'raiding a woodpecker\'s acorn store' },
  primate: { 'forage': 'foraging {where} {group}', 'travel': 'walking {group}' },
  climber: { 'forage': 'foraging {where} {group}', 'travel:climb': 'climbing', 'perch:limb': 'sitting in the branches, looking about' },
  cat: { 'travel': 'padding along {group}', 'rest:bed': 'lying up {cover} {group}', 'alert': 'standing still, watching', 'perch:limb': 'lying along a limb, watching' },
  canid: { 'travel': 'trotting along {group}', 'forage:sniff': 'nosing about for mice and scraps', 'rest:bed': 'curled up {cover} {group}', 'alert': 'standing, ears up, watching',
    'perch:limb': 'up in a tree, lying along a limb' },
  bear: { 'rest:bed': 'bedded down at the foot of a tree {group}', 'forage:sniff': 'nosing and digging for food', 'travel': 'ambling along {group}', 'alert': 'standing, testing the air' },
  otter: { 'swim': 'swimming in the water', 'rest:bed': 'curled up in its den by the bank', 'forage:sniff': 'on the bank, nosing about', 'alert': 'on the bank, looking round',
    'travel': 'loping along the bank' },
  smallcarn: { 'forage:sniff': 'nosing about for food', 'rest:bed': 'curled up in its den', 'travel': 'trotting along' },
  hopper: { 'forage': 'nibbling at the plants {where}', 'travel': 'hopping along', 'flee': 'bolting in a zigzag', 'alert:sit': 'sitting up, ears high' },
  colony: { 'forage': 'feeding near its burrow', 'alert:sentry': 'on guard at the burrow', 'alert:sit': 'sitting up, looking round', 'alert:peek': 'sitting up, looking round' },
  treesquirrel: { 'forage': 'foraging {where}', 'travel': 'scampering over the ground', 'forage:cache': 'burying a nut to eat later', 'forage:eat': 'sitting up, nibbling a nut' },
  bigrodent: { 'forage': 'feeding near its burrow', 'alert:sentry': 'sitting up at its burrow, keeping watch' },
  smallmammal: { 'forage': 'nibbling seeds and stems {where}', 'travel': 'scurrying along', 'travel:runway': 'scurrying along its runway', 'alert:sit': 'sitting up, sniffing the air' },
  insectivore: { 'forage': 'snuffling for insects {where}', 'travel': 'scurrying along', 'travel:runway': 'scurrying along its runway', 'alert:sit': 'stopped, sniffing the air',
    'forage:sniff': 'snuffling for insects {where}' },
  lizard: { 'alert': 'watching', 'travel': 'walking a few steps', 'flee:cover': 'dashing for cover' },
  snake: { 'travel': 'gliding {through}', 'travel:cover': 'gliding off into cover', 'alert': 'head raised, watching you', 'flee:cover': 'fleeing into cover', 'bask': 'basking, stretched out in the sun' },
  croc: { 'bask': 'basking on the bank', 'travel': 'walking slowly', 'swim:float': 'floating in the water', 'swim': 'swimming slowly' },
  turtle: { 'bask': 'basking on the bank', 'travel': 'walking slowly', 'swim:float': 'floating in the water', 'swim': 'swimming slowly', 'hide:sink': 'sunk under the surface, watching' },
  tortoise: { 'travel': 'walking slowly', 'forage:graze': 'grazing', 'hide:withdraw': 'keeping still, head drawn in', 'rest': 'resting' },
  amphibian: { 'rest': 'sitting still {where}', 'travel': 'crawling slowly {where}', 'flee:cover': 'scrambling away into cover', 'alert': 'sitting still, watching' },
  slug: { 'hide:withdraw': 'pulled in, its eyestalks withdrawn', 'travel': 'gliding over the forest floor on its slime', 'rest': 'resting, eyestalks out' },
};
// A species' own lines (recorded fine-tunes): the first casts' hand-written words, kept over the rule. `group` names its
// group (a covey). Keyed by species code: a stand-in reads by its archetype, never by its kin's lines.
export const PHRASES = {
  meleagris_gallopavo: { 'fly:down': 'flying down from the tree', 'fly:up': 'flying up into a tree', 'rest:roost': 'roosting for the night', 'perch': 'up in a tree, watching',
    'forage:scratch': 'scratching the leaves for food', 'travel': 'walking with its flock', 'forage': 'pecking for seeds and insects with its flock' },
  otospermophilus_beecheyi: { 'alert:sentry': 'on guard at the burrow', 'flee:burrow': 'running for its burrow', 'alert:sit': 'sitting up, looking round',
    'alert:peek': 'sitting up, looking round', 'forage': 'feeding near its burrow' },
  marmota_olympus: { 'alert:sentry': 'sitting up at its burrow, keeping watch', 'flee:burrow': 'running for its burrow', 'forage': 'grazing the meadow near its burrow' },
  sceloporus_occidentalis: { 'bask': 'basking in the sun', 'court:pushup': 'doing push-ups (a male showing off)', 'flee:cover': 'dashing for cover', 'alert': 'watching' },
  plethodon_vehiculum: { 'flee:cover': 'wriggling away under the litter', 'travel': 'walking slowly over the damp moss', 'rest': 'resting on the damp forest floor', 'alert': 'resting on the damp forest floor' },
  ensatina_eschscholtzii: { 'flee:cover': 'wriggling away under the litter', 'travel': 'walking slowly over the damp moss', 'rest': 'resting on the damp forest floor', 'alert': 'resting on the damp forest floor' },
  cervus_canadensis: { 'rest:bed': 'bedded down {cover}', 'travel': 'walking with its herd', 'flee:group': 'moving off with the herd', 'forage:graze': 'grazing {open}' },
  lontra_canadensis: { 'swim': 'swimming in the river' },
  megaceryle_alcyon: { 'fly': 'flying low over the water, rattling' },
  mergus_merganser: { 'fly': 'flying fast and low up the river', 'fly:flush': 'flying fast and low up the river', 'swim:dive': 'diving for fish', 'swim': 'swimming on the river' },
  anas_platyrhynchos: { 'fly': 'flying off, quacking', 'fly:flush': 'flying off, quacking' },
  dendragapus_fuliginosus: { 'fly': 'flushed, whirring off into the trees', 'fly:flush': 'flushed, whirring off into the trees', 'forage': 'walking the forest floor, picking at needles and berries',
    'travel': 'walking the forest floor, picking at needles and berries' },
  ursus_americanus: { 'alert:charge': 'bluff-charging', 'alert:stare': 'standing its ground, watching you' },
  oreortyx_pictus: { group: 'covey', 'fly:flush': 'flushed, whirring off downhill into the brush', 'alert:crouch': 'crouched, about to flush',
    'travel': 'running in single file with its covey', 'forage': 'scratching for seeds and berries with its covey' },
  callipepla_californica: { group: 'covey', 'travel': 'running in single file with its covey', 'forage': 'scratching for seeds and insects {group}' },
};

// The line for an act and manner in a context: { code, archetype, machine, habitat (class), groupN (its group's size, 1
// alone), young ('mother' with young, 'cub' with its mother, else ''), prey (a name), mass (kg) }. The species' own line first,
// then its family's, then the generic; the manner dropped before the act alone; placeholders filled from the context.
export function say(act, how, ctx = {}) {
  const fam = familyOf(ctx.archetype, ctx.machine), own = PHRASES[ctx.code], F = FAMILY_PHRASES[fam] || {};
  const k1 = how ? `${act}:${how}` : act;
  const t = own?.[k1] ?? F[k1] ?? GENERIC[k1] ?? own?.[act] ?? F[act] ?? GENERIC[act] ?? GENERIC.rest;
  return fill(t, fam, own, ctx);
}
function fill(t, fam, own, ctx) {
  const h = ctx.habitat | 0, gw = own?.group || (fam === 'canid' && ctx.mass >= 15 ? 'pack' : GROUP_WORD[fam]) || 'group', yw = YOUNG_WORD[fam] || 'young';
  const group = ctx.young === 'mother' ? `with its ${yw}` : ctx.young === 'cub' ? 'beside its mother' : (ctx.groupN > 1 && GROUP_WORD[fam] !== undefined) || own?.group && ctx.groupN > 1 ? `with its ${gw}` : '';
  const out = t.replace(/\{(\w+)\}/g, (m, k) => k === 'group' ? group : k === 'groupword' ? gw : k === 'youngword' ? yw : k === 'prey' ? (ctx.prey ? `${/^[aeiou]/i.test(ctx.prey) ? 'an' : 'a'} ${ctx.prey}` : 'its prey')
    : HAB[k] ? (HAB[k][h] || (k === 'graze' ? 'grazing' : '')) : '');
  return out.replace(/\s+/g, ' ').trim();
}
