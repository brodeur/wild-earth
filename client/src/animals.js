import * as THREE from 'three';
import { mulberry32, SPECIES as PLANTS } from './trees.js';
import { hash } from './vegetation.js';
import { addCaster, removeCaster } from './shadows.js';
import { seasonOfDate, parseDate } from './season.js';
import { uniforms as atmo } from './atmosphere.js';
import { fieldGuide } from './fieldguide.js';
import { buildSquirrel, buildWoodpecker, buildRaven, buildDeer, buildQuail, buildJay, buildHawk, buildVulture, buildStellersJay,
  buildDeerBuck, buildFox, buildCoyote, buildCougar, buildRabbit, buildVole, buildJackrabbit, buildTurkey, buildGroundSquirrel, buildLizard,
  animalMaterial, animalDepthMaterial, planarShadowMaterial, loadDeerMesh, loadSquirrelMesh, loadQuailMesh, loadJayMesh, driveClips, makeClipState, DEER_DRIVE,
  loadStellersJayMesh, loadRedtailMesh, loadVultureMesh, loadDeerBuckMesh, loadFoxMesh, loadCoyoteMesh, loadCougarMesh,
  loadRabbitMesh, loadJackrabbitMesh, loadVoleMesh, loadRavenGroundMesh, loadTurkeyMesh, loadGroundSquirrelMesh, loadLizardMesh,
  RAVEN_GROUND, hasAnim2, antlerState, SEASON_MONTH } from './animalModels.js';

// Ambient animals: the first step toward "many of each species always present" (docs/brief.md,
// Direction; roadmap visual pass step 6 "Life"). Western gray squirrels, acorn woodpeckers, other
// common ravens and black-tailed deer, each a procedural low-poly model (animalModels.js) drawn as
// one InstancedMesh, posed in the vertex shader from a per-instance vec4.
//
// Population is deterministic per 30 m habitat cell, like the vegetation: a cell's hash against an
// expected count from habitat suitability (class and tree canopy, woodland edges), a weak prior from
// the tile's CC0 / CC BY occurrence records within ~500 m (client.species_prior), and the season.
// Only cells within LIVE_R of the player hold animals; the set is rebuilt when the player has moved
// REBUILD_MOVE m, and an animal that stays in the set keeps its state. Behaviour is a small state
// machine per animal, anchored on the oaks the vegetation placed (veg.oaks). Only species the
// player's species perceives are created (tile.perception.perceives[observer]); setObserver(code)
// switches.
//
// Life seen from the air (a raven at 30-150 m): birds in flight are what a real raven notices, so
// there are flocks and flights. California quail coveys run across openings and burst into a short
// whirring flight when the raven passes low (or a hawk stoops at them, or now and then by
// themselves); scrub-jay groups hop tree to tree through the oaks; woodpeckers make long undulating
// flights between granaries 50-150 m apart; red-tailed hawks soar 100-250 m up with an occasional
// stoop; turkey vultures teeter in slow circles and long glides; Steller's jays work up through the pines
// branch by branch in small groups and glide down to the next tree. Birds in flight are drawn up to 1.6x
// their size with distance (true size within 30 m, 1.6x beyond 100 m) so they stay a few pixels
// wide; ground animals stay true scale. Deer move in herds of 3-6 that leave cover for open savanna
// at dawn and dusk and walk in file. Hawks and vultures are not tied to 30 m cells but to coarse
// territory cells (one bird per cell at most, at least one of each within the live radius).
// Turkey vulture is not in the tile's species list or perception matrix yet: it is a visual only,
// seen by every observer (VISUAL_ONLY) until the pipeline adds it.
//
// Shadows: animals receive the cascaded sun shadows through patchLambert. To cast, every species'
// InstancedMesh is registered with shadows.js addCaster on the near cascade (the only one
// re-rendered every frame, so the shadows move with the animals; it is off above ~110 m camera
// height), drawn with its customDepthMaterial (animalDepthMaterial: the same part animation, so a
// wingbeat's shadow beats). Deer also keep a planar shadow: the posed model projected onto the
// plane through its feet along the sun, which works at any height and gives the long dawn and dusk
// shadows that make a herd readable from the air; it fades out inside cascade 0's map, where the
// real shadow is drawn, so the ground under a near deer is not darkened twice.
//
// Mammals (2026-10-25): gray foxes along woodland and chaparral edges, coyotes (alone or a pair) on grassland and
// savanna, brush rabbits at brush edges, California voles on their runways in the grass and a mountain lion (one
// adult, or a mother with one or two young, per coarse territory cell; at most one group in the live set) in oak
// and chaparral. Foxes, rabbits and the lion are about at dawn, dusk and night and bedded (in a form, for the rabbit)
// through the day; coyotes at dawn and dusk; voles at any hour. Each walks, trots (the drawn quadrupeds also gallop:
// the gait selector, aAnim2.w), stands alert, sniffs and forages, and reacts to a low player: foxes and coyotes trot
// off at 30-40 m (a fox may climb a leaning oak), the lion slinks away at 50 m, rabbits freeze at ~22 m and bolt for
// cover inside ~9 m, voles dash down the runway and hide. Rabbits are drawn within 120 m of the eye, voles within 40 m
// of a camera under 10 m above the ground (and only think there). Bucks (their own species slot, BK, sharing the code
// and the herds) are one in three or four of the herd's followers; their antlers follow the date (antlers()).
// Black-tailed jackrabbits (2026-10-25; jkUpdate): alone or in twos on open grassland, savanna and pasture and in
// sparse chaparral, hunched in a form by day (beside a shrub when the near set has one, else in the grass); out at
// dawn, dusk and night to feed in short hops with head dips, sitting up now and then and loping on in 1-3 m bounds.
// A low player within ~30 m: it freezes, ears up, then bolts in a zigzag at ~14 m/s, bounds to ~6 m, swinging
// 30-60 degrees off its line every 2-4 bounds. Drawn within 250 m of the eye (lod 12 / 40 m). Until the tile's
// species step has run with the jackrabbit in pipeline/species_data.py, it is seen by everyone (PENDING).
//
// Wild turkeys, California ground squirrels and western fence lizards (2026-10-26; tkUpdate, gsUpdate, lzUpdate):
// turkeys in flocks of 6-15 in oak woodland and savanna, walking and foraging together (pecking, scratching), flushing
// into a short heavy flight up into an oak from a raven within 15 m or a squirrel within 8 m, and roosting in the oaks
// after dusk (on a limb of the drawn wood, else out of sight in the crown). Ground squirrels in colonies of 4-12 round
// a cluster of burrow mouths (dark discs in a ring of bare dirt) in grassland and open savanna, March to November by
// day: one sentinel bolt upright at a time, the rest feeding low; a raven or hawk within 25 m, or a player within
// 10 m, sends them all running down the burrows, to come up again 20-40 s after it has gone. Fence lizards on rock
// tops (rocks.js, read only: the drawn close tiers), the bottom 1.5 m of oak and pine trunks (perch.js: the drawn
// bark, the instance oriented onto it) and the open ground beside them, March to October by day when the air is 15 C
// or more: basking flat, alert with head flicks, the males doing push-up bouts every 10-30 s; a player within 2 m
// sends one in a dash into a crack or round the trunk, gone for 30 s. Drawn and thought within 25 m of the eye.
//
// Events (for sound.js): on(type, fn) / off(type, fn). 'flush' { group, x, y, z, n, cause } when a
// quail covey bursts up (x, y, z: where it takes off; cause 'raven', 'hawk', 'self' or 'debug');
// 'stoop' { animal, x, y, z, target } when a red-tailed hawk tips into a stoop.
//
// Acorn game v2 (acorns.js, docs/game-acorn-stash.md): while a game runs, woodpeckers, squirrels and ravens are
// collectors. They take acorns from the game's supply (the same acorns as the player, claimed so two animals do
// not head for one) and store them through the game's events: woodpecker families fly to oaks within ~150 m of
// their granary, pick an acorn, carry it back and hammer it in (deposit); a squirrel picks one under an oak, runs
// it up to 30 m off and buries it (bury), and now and then digs one up and eats it (dig); ravens glide down for a
// ground acorn now and then and cache it under a shrub (bury, kind 'cache'). The existing motions carry it out;
// the acorn rides at the bill or mouth (carryPoint: the head part's rotation on the CPU). Acorn searches are
// capped at SEARCHES per frame. Woodpeckers come in both sexes: the female is her own slot (WF), as bucks are.
//
// Acorn game v4 (docs/game-acorn-stash.md, "v4: defence and pilfering"): stores get robbed and defended. A woodpecker
// family goes out gathering together in cycles (famAway: AWAY.out of every AWAY.cycle game seconds, phased per
// granary from the shared world clock, so every browser sees the same family away at the same time) and is home in
// between. A raider at a granary (raider(): the player through acorns.js, a scrub-jay or Steller's jay, a squirrel up
// the trunk) is a threat; a family with members within DEFEND_R m of its granary rallies (the 'rally' event, sound.js
// gives the waka), and one or two of them fly at the raider and dive through it (W_MOB) until one hits: the raid is
// interrupted or the acorn dropped (acorns.js 'mob') and the raider is driven off. A raid comes free only when no
// family member is within RAID_GUARD_R m of the hole. Squirrels guard their buried acorns weakly: one whose cache is
// dug up by someone else while it is within GUARD.notice m runs to the spot, and chases the thief if it gets within
// GUARD.chase m of it (sqGuard). AI squirrels now and then keep a pilfered acorn and bury it again; ravens glide down to
// dig up someone else's cache (less often than they forage) and cache it again; jays on the ground dig one up and eat
// it, and jays and squirrels raid granaries.

//
// The spirit (spirit.js, 2026-10-26): the player starts as a wisp that every animal here is blind to (observer 'spirit':
// it perceives everything, and update() hands the animals' reactions a player position far off, so nothing flushes,
// freezes or climbs from it). Touching any animal (2026-10-26: every species, PLAYABLE; the raven, squirrel and
// woodpecker have their own controls, the rest groundControl.js and flierControl.js) puts the player in that
// body: playableNear finds the one in reach, take(id) lifts it out of the population (held: rebuilds do not respawn it,
// so there is no double) and hands back where and how it was (info), and release(id, where) puts it back where the
// player leaves it, in a state its own behaviour carries on from (on the ground, the bark or a limb, or in the air),
// kept through rebuilds while it stays within reach of the player (freed) even if its home cell is out of the set.

const TERRAIN_SPACING = 10;   // terrain.js default vertex spacing (main.js builds it with the defaults)
const LIVE_R = 400, REBUILD_MOVE = 100, NEAR_R = 150, TAG_R = 40, TAG_MAX = 6, BUCKET = 30;
// Drawn meshes (DRAWN below): the deer (a CC0 download, tools/build_deer.py) and the scrub-jay, quail,
// squirrel, Steller's jay, red-tailed hawk and turkey vulture (Meshy previews, tools/build_scrubjay.py,
// build_quail.py, build_squirrel.py, build_stellersjay.py, build_redtail.py, build_vulture.py) are drawn from a
// GLB in three tiers by distance from the eye: lod0 within lod[0] m, lod1 within lod[1] m, lod2 beyond. The
// procedural model (animalModels.js build*) still holds every animal's matrix and pose and is drawn instead
// until the GLB has loaded, if it fails to load, or with ?<param>=proc (?deer=proc, ?squirrel=proc,
// ?quail=proc, ?jay=proc, ?stjay=proc, ?hawk=proc, ?vulture=proc, ?fox=proc, ?coyote=proc, ?rabbit=proc, ?jackrabbit=proc, ?vole=proc,
// ?lion=proc or ?cougar=proc, ?buck=proc (?deer=proc covers the buck too), ?turkey=proc, ?gsquirrel=proc, ?lizard=proc;
// ?animals=proc for all) for A/B; live:
// __we.animals.setMesh('quail', false) (and
// __we.animals.deerMesh = false as before). __we.animals.lodForce.quail = 0/1/2 pins every quail to one tier
// (deerLodForce still works). The drawn birds and squirrel take a second per-instance vec4 (aAnim2, see
// animalModels.js rig templates), filled here per animal: wing bow and tail spread for birds, leg splay and
// a lagged tail-tip flick for the squirrel, and the colour variant (female quail).
// Ravens are drawn by two models (DRAWN[RV].hybrid): in the air the procedural flying raven (buildRaven), on the ground
// or perched (standing, walking, hopping, pecking, caching) the ground raven (raven_ground.glb, loadRavenGroundMesh; its
// three tiers within 15 / 50 m / beyond). The swap is at touchdown (the end of a glide) and at take-off (leaving
// R_PERCH): same position and heading, and the flying model is drawn RAVEN_LIFT higher along its own up axis so its body
// is where the ground model's body is (the two origins differ: the ground raven stands on its feet, its body 0.21 m up;
// the procedural raven's body is 0.09 m above its origin). On touchdown the ground raven's folded wings settle (a flick
// dying away); before take-off they lift and open, and the flying model starts half unfolded. On the ground ravens
// walk (legs alternate) and hop (legs together, aAnim2.z), glance about (head yaw, aAnim2.y), flick their wings
// (aAnim2.x), peck, and now and then walk or hop to a shrub to cache. ?ravenground=proc draws the procedural raven
// throughout (A/B); live: __we.animals.setMesh('raven', false); __we.animals.lodForce.raven = 0/1/2 pins the tier;
// __we.animals.ravenCache() sends the nearest raven on the ground to cache beside a shrub.
const LOD_R2 = 250 * 250;   // ground animals farther than this from the eye think on alternate frames (with the summed dt)
const FLY_NEAR = 30, FLY_FAR = 100, FLY_GROW = 0.6;   // birds in flight: true size within FLY_NEAR m of the eye, 1.6x beyond FLY_FAR
const VISUAL_ONLY = new Set(['cathartes_aura']);     // not in the species list or perception matrix yet: seen by everyone
// in pipeline/species_data.py but maybe not yet in this tile's package (run its species step): seen by everyone until
// the tile's perception matrix names it, then as the matrix says
const PENDING = new Set(['lepus_californicus', 'meleagris_gallopavo', 'otospermophilus_beecheyi', 'sceloporus_occidentalis']);
const TAU = Math.PI * 2;
const CLING_PITCH = -1.72;   // a clinging woodpecker: nose up, tipped just past vertical so the tail braces on the bark

// FNV-1a over the oak id with the acorn game's stash salt: the same "one oak in eight has a stash
// hole" rule as acorns.js oakInfo(), so woodpecker granaries are the acorn game's stash trees.
function seedOf(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const isStashTree = oak => oak.cls !== 'sapling' && mulberry32(seedOf(oak.id, 0x57a5))() < 1 / 8;   // snags are real granaries; saplings are not

// Suitability by habitat class (pipeline/habitat.py codes): 1 oak woodland, 2 conifer, 3 mixed,
// 4 chaparral, 5 grassland, 6 riparian, 7 water, 8 barren, 9 human (rewilded: treat as grassland).
const SUIT = {
  sciurus_griseus:         { 1: 1, 2: 0.45, 3: 0.9, 4: 0.1, 5: 0.2, 6: 0.75, 9: 0.15 },
  melanerpes_formicivorus: { 1: 1, 2: 0.2, 3: 0.7, 4: 0.05, 5: 0.35, 6: 0.6, 9: 0.3 },
  corvus_corax:            { 1: 0.6, 2: 0.45, 3: 0.55, 4: 0.5, 5: 0.6, 6: 0.6, 7: 0.4, 8: 0.6, 9: 0.6 },
  odocoileus_hemionus:     { 1: 0.8, 2: 0.3, 3: 0.5, 4: 0.35, 5: 0.7, 6: 1, 9: 0.6 },
  callipepla_californica:  { 1: 0.6, 3: 0.3, 4: 0.75, 5: 0.85, 6: 0.7, 9: 0.8 },
  aphelocoma_californica:  { 1: 1, 2: 0.15, 3: 0.8, 4: 0.45, 5: 0.15, 6: 0.8, 9: 0.3 },
  cyanocitta_stelleri:     { 2: 1, 3: 0.7, 6: 0.2 },   // conifer and mixed forest (sound.js uses the same weights)
  urocyon_cinereoargenteus: { 1: 1, 2: 0.3, 3: 0.8, 4: 0.9, 5: 0.25, 6: 0.8, 9: 0.4 },   // woodland and chaparral, edges (below)
  canis_latrans:            { 1: 0.6, 2: 0.15, 3: 0.3, 4: 0.5, 5: 1, 6: 0.5, 8: 0.3, 9: 0.8 },   // grassland and savanna
  sylvilagus_bachmani:      { 1: 0.5, 3: 0.4, 4: 1, 5: 0.35, 6: 0.8, 9: 0.3 },   // brush; times the brush-edge factor
  lepus_californicus:       { 1: 0.45, 3: 0.05, 4: 0.25, 5: 1, 6: 0.15, 8: 0.3, 9: 0.9 },   // open ground; times openness (canopy)
  microtus_californicus:    { 1: 0.35, 4: 0.1, 5: 1, 6: 0.5, 9: 0.6 },   // grass
  puma_concolor:            { 1: 1, 2: 0.4, 3: 0.7, 4: 0.9, 6: 0.6 },   // a territory's home: oak and chaparral
  meleagris_gallopavo:      { 1: 1, 2: 0.15, 3: 0.6, 4: 0.15, 5: 0.45, 6: 0.7, 9: 0.5 },   // oak woodland and savanna; times some trees
  otospermophilus_beecheyi: { 1: 0.6, 4: 0.2, 5: 1, 6: 0.3, 8: 0.3, 9: 0.9 },   // grass and open savanna; times openness
  sceloporus_occidentalis:  { 1: 1, 2: 0.5, 3: 0.8, 4: 0.9, 5: 0.5, 6: 0.4, 8: 0.8, 9: 0.8 },   // times rock and trunks (spawnCell)
};
// Expected individuals (or groups) per 30 m cell at suitability 1, and season multipliers.
const SEASON = {
  sciurus_griseus:         { fall: 1.25, winter: 0.8, spring: 1, summer: 0.9 },
  melanerpes_formicivorus: { fall: 1.2, winter: 1, spring: 1, summer: 0.9 },
  corvus_corax:            { fall: 1, winter: 1, spring: 1, summer: 1 },
  odocoileus_hemionus:     { fall: 1, winter: 1, spring: 1, summer: 1 },
  callipepla_californica:  { fall: 1.1, winter: 1, spring: 1.2, summer: 1 },
  aphelocoma_californica:  { fall: 1.2, winter: 1, spring: 0.9, summer: 0.9 },
  cyanocitta_stelleri:     { fall: 1.15, winter: 1.1, spring: 0.9, summer: 0.9 },
  urocyon_cinereoargenteus: { fall: 1.1, winter: 1, spring: 1, summer: 1 },
  canis_latrans:            { fall: 1, winter: 1, spring: 1, summer: 1 },
  sylvilagus_bachmani:      { fall: 0.9, winter: 0.85, spring: 1.1, summer: 1 },
  lepus_californicus:       { fall: 0.95, winter: 0.85, spring: 1.1, summer: 1.05 },   // leverets from late winter to summer
  microtus_californicus:    { fall: 0.8, winter: 1, spring: 1.3, summer: 0.8 },
  puma_concolor:            { fall: 1, winter: 1, spring: 1, summer: 1 },
  meleagris_gallopavo:      { fall: 1, winter: 1, spring: 1, summer: 1 },
  otospermophilus_beecheyi: { fall: 0.9, winter: 0, spring: 1, summer: 1 },   // below ground December to February
  sceloporus_occidentalis:  { fall: 1, winter: 0, spring: 1, summer: 1 },     // March to October (lzActive narrows fall)
};
const SPECIES = [
  { code: 'sciurus_griseus', one: 'squirrel', many: 'squirrels', k: 0.45, salt: 9101, cap: 160, scale: 1, build: buildSquirrel },
  { code: 'melanerpes_formicivorus', one: 'woodpecker', many: 'woodpeckers', k: 0.075, salt: 9202, cap: 200, scale: 1, build: buildWoodpecker },
  { code: 'corvus_corax', one: 'raven', many: 'ravens', k: 0.022, salt: 9303, cap: 60, scale: 1, build: buildRaven },
  { code: 'odocoileus_hemionus', one: 'deer', many: 'deer', k: 0.017, salt: 9404, cap: 90, scale: 1, build: buildDeer },
  { code: 'callipepla_californica', one: 'quail', many: 'quail', k: 0.04, salt: 9505, cap: 200, scale: 1, build: buildQuail, bird: true, common: 'California quail' },
  { code: 'aphelocoma_californica', one: 'scrub-jay', many: 'scrub-jays', k: 0.07, salt: 9606, cap: 100, scale: 1, build: buildJay, bird: true, common: 'California scrub-jay' },
  { code: 'buteo_jamaicensis', one: 'hawk', many: 'hawks', salt: 9707, cap: 6, scale: 1, build: buildHawk, bird: true, common: 'Red-tailed hawk', grid: 500, p: 0.45 },
  { code: 'cathartes_aura', one: 'vulture', many: 'vultures', salt: 9808, cap: 6, scale: 1, build: buildVulture, bird: true, common: 'Turkey vulture', grid: 450, p: 0.4 },
  { code: 'cyanocitta_stelleri', one: "Steller's jay", many: "Steller's jays", k: 0.06, salt: 9909, cap: 60, scale: 1, build: buildStellersJay, bird: true, common: "Steller's jay" },
  // mammals (see the header). liveR: spawned only within this distance of the player (the small ones are culled
  // near the eye anyway, and a 400 m set would fill the cap far from it). planar: the planar sun shadow too.
  { code: 'urocyon_cinereoargenteus', one: 'gray fox', many: 'gray foxes', k: 0.035, salt: 9131, cap: 16, scale: 1, build: buildFox, planar: true, common: 'Gray fox' },
  { code: 'canis_latrans', one: 'coyote', many: 'coyotes', k: 0.012, salt: 9232, cap: 8, scale: 1, build: buildCoyote, planar: true, common: 'Coyote' },
  { code: 'sylvilagus_bachmani', one: 'brush rabbit', many: 'brush rabbits', k: 0.4, salt: 9333, cap: 80, scale: 1, build: buildRabbit, liveR: 220, common: 'Brush rabbit' },
  { code: 'microtus_californicus', one: 'vole', many: 'voles', k: 0.9, salt: 9434, cap: 150, scale: 1, build: buildVole, liveR: 140, common: 'California vole' },
  { code: 'puma_concolor', one: 'mountain lion', many: 'mountain lions', salt: 9535, cap: 3, scale: 1, build: buildCougar, planar: true, common: 'Mountain lion', territory: 1500, p: 0.4 },
  // the buck: the deer's code and herds, its own mesh slot (spawned by the deer herds, not by cells)
  { code: 'odocoileus_hemionus', one: 'buck', many: 'bucks', salt: 9636, cap: 40, scale: 1, build: buildDeerBuck, planar: true, variantOf: 3 },
  // the female acorn woodpecker: the woodpecker's code and families, her own colouring (a black band between the
  // white forehead and the red), so her own mesh slot
  { code: 'melanerpes_formicivorus', one: 'female woodpecker', many: 'female woodpeckers', salt: 9737, cap: 200, scale: 1, build: () => buildWoodpecker(true), variantOf: 1 },
  // the black-tailed jackrabbit: open ground, one or two per cell, 40 at most (culled beyond 250 m of the eye)
  { code: 'lepus_californicus', one: 'jackrabbit', many: 'jackrabbits', k: 0.12, salt: 9838, cap: 40, scale: 1, build: buildJackrabbit, liveR: 300, common: 'Black-tailed jackrabbit' },
  // 2026-10-26: wild turkey flocks (k per 30 m cell for a flock: a few dozen flocks on a 10 km tile), ground squirrel
  // colonies, fence lizards (k per cell for a group at its rocks and trunks; spawned within 70 m, culled at 25 m)
  { code: 'meleagris_gallopavo', one: 'wild turkey', many: 'wild turkeys', k: 0.0014, salt: 9939, cap: 90, scale: 1, build: buildTurkey, bird: true, common: 'Wild turkey' },
  { code: 'otospermophilus_beecheyi', one: 'ground squirrel', many: 'ground squirrels', k: 0.012, salt: 9940, cap: 160, scale: 1, build: buildGroundSquirrel, liveR: 220, common: 'California ground squirrel' },
  { code: 'sceloporus_occidentalis', one: 'fence lizard', many: 'fence lizards', k: 0.55, salt: 9941, cap: 120, scale: 1, build: buildLizard, liveR: 70, common: 'Western fence lizard' },
];
const SQ = 0, WP = 1, RV = 2, DR = 3, QU = 4, SJ = 5, HK = 6, TV = 7, ST = 8, FX = 9, CY = 10, RB = 11, VO = 12, ML = 13, BK = 14, WF = 15, JR = 16, TK = 17, GS = 18, LZ = 19;
SPECIES[DR].planar = true;
// the spirit's bodies (playableNear): the species a player can take over (all of them), and their body centre over the
// origin standing (m; in the air the origin is the body)
const PLAYABLE = SPECIES.map((sp, k) => k);
const BODY_Y = SPECIES.map(() => 0); BODY_Y[SQ] = 0.12; BODY_Y[RV] = 0.2; BODY_Y[WP] = BODY_Y[WF] = 0.05;
BODY_Y[DR] = 0.75; BODY_Y[BK] = 0.8; BODY_Y[FX] = 0.25; BODY_Y[CY] = 0.4; BODY_Y[ML] = 0.5; BODY_Y[RB] = 0.1; BODY_Y[JR] = 0.15;
BODY_Y[VO] = 0.02; BODY_Y[TK] = 0.45; BODY_Y[GS] = 0.08; BODY_Y[LZ] = 0.02; BODY_Y[QU] = 0.1; BODY_Y[SJ] = BODY_Y[ST] = 0.1;
// The spirit's view (spirit.js SpiritLook): while the world's light goes faint and blue-green, the playable species are
// drawn in their own colour, self-lit and clear of the haze: SELF_LIT.value (0..1) blends their lit and hazed colour
// toward their albedo times SELF_LIGHT. A wrapper on their materials (selfLit), with its own program cache key. Their meshes are also on camera
// layer 1, which spirit.js redraws over its post pass so they keep their colour.
export const SELF_LIT = { value: 0 };
// A species' rarity, 0 the most abundant to 1 the rarest (Animals.rarity, by index): the spirit's view colours each soul
// by it (rarityColor: purple for the abundant through blue, green and yellow to red for the rare) and makes the rare ones
// brighter (spirit.js). Ranked by the game's own expected population (expectedPerKm2 below), the same order on every
// tile, evenly spaced so the spectrum is read whatever the numbers. (2026-10-27: the tile's GBIF record counts ranked
// first, but those count reports, not animals: a lion with 7 records outranked a vole with none.)
export function rarityColor(r, out = new THREE.Color()) { return out.setHSL(((1 - r) * 275) / 360, 0.85, 0.62); }
const SELF_LIGHT = 1.15;
function selfLit(m) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    shader.uniforms.uSelfLit = SELF_LIT;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSelfLit;')
      .replace('#include <opaque_fragment>', `outgoingLight = mix(outgoingLight, diffuseColor.rgb * ${SELF_LIGHT.toFixed(2)}, uSelfLit);\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `${key ? key() : ''}|selflit`;
  m.needsUpdate = true;
  return m;
}
const TAG_DY = [0.5, 0.5, 0.7, 2.1, 0.4, 0.4, 0.7, 0.7, 0.45, 0.65, 0.95, 0.4, 0.2, 1.1, 2.2, 0.5, 0.6, 1.2, 0.32, 0.12];
const INDEX = Object.fromEntries(SPECIES.map((sp, k) => [sp.code, k]).filter(([, k]) => SPECIES[k].variantOf === undefined));
// The expected population per km^2 of each species, from the spawn rules above: a cell species (k per BUCKET m cell,
// spawnCell) is k times the mean size of what a cell spawns (GROUP: a woodpecker family of 3-6, a quail covey of 5-20, a
// turkey flock of 6-15, a ground squirrel colony of 4-12, a raven pair 55% of the time...) over the cell's area, at a
// mean suitability of 0.5; a soarer (hawk, vulture) is one per `grid` m cell with probability p (spawnSoarers); the lion
// one adult, or a mother with young, per `territory` m cell with probability p (spawnLion); a variant (buck, female
// woodpecker) is its base species. Only the order matters (rarity).
const GROUP = { [WP]: 4.5, [RV]: 1.55, [DR]: 1.6, [QU]: 12, [SJ]: 3, [ST]: 3, [CY]: 1.4, [RB]: 1.3, [VO]: 1.3, [TK]: 10.5, [GS]: 8, [ML]: 1.3 };
export function expectedPerKm2(s) {
  const sp = SPECIES[s];
  if (sp.variantOf !== undefined) return expectedPerKm2(sp.variantOf);
  if (sp.territory) return (sp.p || 1) * (GROUP[s] || 1) / (sp.territory / 1000) ** 2;
  if (sp.grid) return (sp.p || 1) * (GROUP[s] || 1) / (sp.grid / 1000) ** 2;
  return (sp.k || 0) * (GROUP[s] || 1) * 0.5 / (BUCKET / 1000) ** 2;
}
const DRAWN = {
  [DR]: { name: 'deer', param: 'deer', load: loadDeerMesh, lod: [30, 90], planar: true },
  [SQ]: { name: 'squirrel', param: 'squirrel', load: loadSquirrelMesh, lod: [12, 40] },
  [QU]: { name: 'quail', param: 'quail', load: loadQuailMesh, lod: [12, 40] },
  [SJ]: { name: 'scrub-jay', param: 'jay', load: loadJayMesh, lod: [12, 40] },
  [ST]: { name: 'stellers-jay', param: 'stjay', load: loadStellersJayMesh, lod: [12, 40] },
  // soarers: seen at 100-400 m nearly always; lod0 only on pull-outs near the ground or a raven alongside
  [HK]: { name: 'hawk', param: 'hawk', load: loadRedtailMesh, lod: [40, 150] },
  [TV]: { name: 'vulture', param: 'vulture', load: loadVultureMesh, lod: [50, 180] },
  // mammals: the lane's switch distances; cull: not drawn (nor thought) beyond this from the eye
  [FX]: { name: 'fox', param: 'fox', load: loadFoxMesh, lod: [18, 56], planar: true },
  [CY]: { name: 'coyote', param: 'coyote', load: loadCoyoteMesh, lod: [22, 68], planar: true },
  [RB]: { name: 'rabbit', param: 'rabbit', load: loadRabbitMesh, lod: [6, 20] },
  [JR]: { name: 'jackrabbit', param: 'jackrabbit', load: loadJackrabbitMesh, lod: [12, 40] },
  [VO]: { name: 'vole', param: 'vole', load: loadVoleMesh, lod: [3, 10] },
  [ML]: { name: 'lion', param: 'lion', alias: 'cougar', load: loadCougarMesh, lod: [40, 124], planar: true },
  [BK]: { name: 'buck', param: 'buck', alias: 'deer', load: loadDeerBuckMesh, lod: [30, 90], planar: true },
  [TK]: { name: 'turkey', param: 'turkey', load: loadTurkeyMesh, lod: [25, 80] },
  [GS]: { name: 'ground-squirrel', param: 'gsquirrel', load: loadGroundSquirrelMesh, lod: [12, 40] },
  [LZ]: { name: 'lizard', param: 'lizard', load: loadLizardMesh, lod: [2, 8] },
  // the raven on the ground or perched; in the air the procedural flying raven (hybrid: see the header)
  [RV]: { name: 'raven', param: 'ravenground', load: loadRavenGroundMesh, lod: [15, 50], hybrid: true },
};
const PROC_RAVEN_BODY_Y = 0.09, RAVEN_LIFT = RAVEN_GROUND.bodyY - PROC_RAVEN_BODY_Y;   // m, at size 1
const CULL = { [RB]: 120, [VO]: 40, [JR]: 250, [GS]: 150, [LZ]: 25 }, VOLE_CAM = 10;   // m from the eye; voles also only under a camera this low (m above ground)
// Steller's jays perch in conifers (veg.nearPlants, the plants within ~240 m of the eye; veg.oaks holds only oaks)
// Crown radius as a fraction of the tree's height, by height fraction (the crown envelopes in library/species/).
const CONIFERS = new Set(['pinus_ponderosa', 'pinus_sabiniana']);
const CROWN = {
  pinus_ponderosa: [[0.4, 0.2], [0.6, 0.22], [0.8, 0.2], [0.92, 0.13], [1.0, 0.04]],
  pinus_sabiniana: [[0.22, 0.16], [0.38, 0.29], [0.55, 0.33], [0.7, 0.31], [0.84, 0.23], [0.94, 0.13], [1.0, 0.04]],
};
function crownR(sp, h) {
  const t = CROWN[sp] || CROWN.pinus_ponderosa;
  if (h <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (h <= t[i][0]) return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * (h - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
  return t[t.length - 1][1];
}

// states
const S_PAUSE = 0, S_RUN = 1, S_CLIMB = 2, S_OUT = 3, S_SIT = 4, S_IN = 5, S_DOWN = 6;   // squirrel
const S_WORK = 7, S_EAT = 8;                                                            // squirrel, acorn game: pick, bury or dig; eat
const W_CLING = 10, W_TOP = 11, W_FLY = 12, W_PICK = 13;                                // woodpecker (W_PICK: taking an acorn)
const R_SOAR = 20, R_GLIDE = 21, R_PERCH = 22, R_CLIMB = 23, R_GROUND = 24;            // raven (R_GROUND: picking or caching)
const R_WALK = 25;                                                                      // raven: walking or hopping on the ground (or on its perch)
const D_WALK = 30, D_GRAZE = 31, D_BED = 32;                                           // deer
const Q_FORAGE = 40, Q_WAIT = 41, Q_FLY = 42;                                           // quail (bird)
const G_FORAGE = 0, G_RUN = 1, G_SETTLE = 2;                                            // quail (covey)
const J_PERCH = 50, J_GROUND = 51, J_FLY = 52;                                          // scrub-jay
const H_SOAR = 60, H_STOOP = 61, H_PULL = 62;                                           // hawk
const V_SOAR = 70, V_GLIDE = 71;                                                        // vulture
const M_BED = 80, M_STAND = 81, M_MOVE = 82, M_SNIFF = 83, M_POUNCE = 84, M_FLEE = 85,
  M_CLIMB = 86, M_TREE = 87, M_DOWN = 88, M_STALK = 89, M_CROUCH = 90, M_RUSH = 91;     // fox, coyote, lion (M_RUSH: a hunt's trot or rush, huntStart)
const B_FORM = 100, B_FORAGE = 101, B_HOP = 102, B_SIT = 103, B_FREEZE = 104, B_BOLT = 105;   // brush rabbit
const VL_RUN = 110, VL_PAUSE = 111, VL_SIT = 112, VL_HIDE = 113;                         // vole
const JK_FORM = 120, JK_FEED = 121, JK_HOP = 122, JK_SIT = 123, JK_FREEZE = 124, JK_BOLT = 125;   // jackrabbit
// Jackrabbit (jkUpdate): speeds (m/s; lope a range), how far out from the form it feeds (m), the freeze and the
// flush-at-once distances for a low player (m; in the form it sits tighter), what counts as low (m above it), the
// bolt's length (m), the hunched day rest's pose (below 0, see animalModels.js RIG.jackrabbit) and the bound length
// by speed (m per bound: 0.7 m at a feeding hop, 1.6 m at a 4.5 m/s lope, 4.3 m at the bolt; a high bound now and
// then is 1.35x longer and 1.7x higher).
const JACK = { hop: 1.2, lope: [3, 5.5], bolt: 14, out: [10, 40], range: 45, freeze: 30, flush: 10, formFlush: 7, low: 25,
  run: [60, 150], hunch: -0.6, alert: 0.35,
  bound: (v, k) => Math.min(6, (0.35 + 0.28 * v) * k), lift: v => 0.035 + 0.02 * v };
// Wild turkey (tkUpdate; the flock is the unit, flockUpdate): states per bird and per flock; flush distances by the
// player's species (m, 3D); walking speeds (m/s) and the stride (m per leg cycle); the flush flight's speed (m/s) and
// the wingbeat (Hz); how long a flushed flock stays up in its tree (s); the flock's spread (m) and wander (m from home).
const T_FORAGE = 130, T_SCRATCH = 131, T_WAIT = 132, T_FLY = 133, T_PERCH = 134, T_DOWN = 135;
const TF_FORAGE = 0, TF_WALK = 1, TF_TREE = 2, TF_ROOST = 3;
const TURKEY = { flush: { corvus_corax: 15, buteo_jamaicensis: 15, sciurus_griseus: 8, melanerpes_formicivorus: 10 }, flushOther: 12,
  walk: 0.35, move: [0.5, 0.8], stride: 0.55, fly: 8, beat: 5, tree: [25, 60], spread: 6, range: 150, hen: 0.6, roostMinH: 3 };
// California ground squirrel (gsUpdate; the colony is the unit, colonyUpdate): states; the alarm distances (m, 3D: the
// raven or hawk, the player otherwise); run and feed speeds (m/s); how long they stay down (s); the colony's burrows
// and members; the sentinel's watch (s).
const G_FEED = 140, G_HOP = 141, G_SIT = 142, G_SENTRY = 143, G_DIVE = 144, G_DOWN = 145, G_PEEK = 146;
const C_OK = 0, C_ALARM = 1, C_DOWN = 2;
const GSQ = { raptor: 25, player: 10, run: 3.6, feed: [0.3, 0.7], down: [20, 40], burrows: [3, 6], members: [4, 12], watch: [15, 60], spread: 5 };
// Western fence lizard (lzUpdate): states; the flight distance (m), dash speed (m/s), how long it stays hidden (s), the
// push-up bouts (males: one every 10-30 s, 3-8 bobs at 2 Hz), the stride (m), and the air temperature it needs (C).
const L_BASK = 150, L_ALERT = 151, L_PUSH = 152, L_TURN = 153, L_SPRINT = 154, L_HIDE = 155, L_MOVE = 156;
const LIZ = { flee: 2, dash: 2, hide: 30, push: [10, 30], bobs: [3, 8], bobHz: 2, stride: 0.1, warm: 15, hot: 34, resolves: 2 };
// Air temperature (C) for the foothills at ~600 m (Placerville normals, rounded): the mean daily low and high by month,
// a low at 6:00 and a high at 15:00. For the lizards; nothing else reads it yet.
const T_LOW = [1, 2, 4, 6, 9, 13, 16, 15, 13, 9, 4, 1], T_HIGH = [13, 15, 17, 20, 25, 30, 34, 33, 30, 24, 17, 12];
export function airTemp(month, hour) {
  const m = month - 1.5, i = ((Math.floor(m) % 12) + 12) % 12, j = (i + 1) % 12, f = m - Math.floor(m);
  const lo = T_LOW[i] + (T_LOW[j] - T_LOW[i]) * f, hi = T_HIGH[i] + (T_HIGH[j] - T_HIGH[i]) * f;
  const h = hour < 6 ? hour + 24 : hour;
  const u = h <= 15 ? (h - 6) / 9 : 1 - (h - 15) / 15;   // up from 6:00 to 15:00, down to the next 6:00
  return lo + (hi - lo) * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u))));
}
// Fox, coyote and lion: speeds (m/s), stride (m per cycle at a walk; it lengthens with speed), half the body length
// (for the slope pitch), flee and flee-to distances (m), home range (m), when they are about (hour), climbing and
// pouncing chances.
const MAMMAL = {
  [FX]: { walk: 0.9, trot: 2.3, run: 5.5, stride: 0.6, half: 0.25, flee: 32, fleeTo: [40, 70], range: 110, climb: 0.35, pounce: 0.25,
    active: h => h < 9 || h > 16.5 },
  [CY]: { walk: 1.1, trot: 2.8, run: 7, stride: 0.8, half: 0.35, flee: 40, fleeTo: [60, 110], range: 220, climb: 0, pounce: 0.3,
    active: h => h < 9 || h > 16.5 },
  [ML]: { walk: 0.9, trot: 2.0, run: 6, stride: 1.0, half: 0.45, flee: 50, fleeTo: [60, 100], range: 250, climb: 0, pounce: 0,
    active: h => h < 8.5 || h > 17 },
};

// Acorn game (see the header): collector tasks, acorn searches per frame, and how keen each species is to forage
// by season (chance per decision). CARRY: where the acorn rides, in the model's space: the head part's pivot (py,
// pz), the point at the bill or mouth (ty, tz) and how the head turns (flick and pose gains, as animalModels.js).
const T_GET = 1, T_STORE = 2, T_DIG = 3, T_RAID = 4;
const S_RAIDP = 9, W_MOB = 14, J_RAID = 53;                 // v4: a squirrel or a jay at a granary hole; a woodpecker mobbing
const AWAY = { cycle: 100, out: 40 };                        // a family's gathering cycle (game s): out, then home
const DEFEND_R = 20, RAID_GUARD_R = 8, FLEE_R = 20, DRIVEN_T = 25;   // m, m, m (with the acorn), s an AI raider keeps off
const GUARD = { notice: 20, chase: 5 };                      // m: a squirrel notices a dig of its cache; chases a thief this close
const RAID_ODDS = { sq: { fall: 0.05, winter: 0.04 }, jay: { fall: 0.012, winter: 0.008 } };   // per squirrel pause; per jay-second perched
const SEARCHES = 2;
const FORAGE = {
  [WP]: { fall: 0.55, winter: 0.3, spring: 0.12, summer: 0.12 },
  [SQ]: { fall: 0.2, winter: 0.12, spring: 0.05, summer: 0.05 },
  [RV]: { fall: 0.6, winter: 0.4, spring: 0.15, summer: 0.15 },
};
const CARRY = {
  [WP]: { py: 0.062, pz: 0.05, ty: 0.066, tz: 0.137, flick: 0.45, pose: 0 },
  [RV]: { py: 0.11, pz: 0.14, ty: 0.118, tz: 0.335, flick: 0.4, pose: 0 },
  [SQ]: { py: 0.12, pz: 0.09, ty: 0.125, tz: 0.192, flick: 0.35, pose: -0.2 },          // the procedural squirrel
  sqRig: { py: 0.116, pz: 0.106, ty: 0.1, tz: 0.172, flick: 0.35, pose: 0.75, cy: 0.099, cz: 0.017 },   // the drawn one (rodent rig)
  // the ground raven (raven_ground.glb): head pivot at the base of the neck, the acorn a little behind the bill tip
  rvGround: { py: RAVEN_GROUND.head[1], pz: RAVEN_GROUND.head[2], ty: RAVEN_GROUND.bill[1] - 0.004, tz: RAVEN_GROUND.bill[2] - 0.02, flick: 0.6, pose: 0 },
};
CARRY[WF] = CARRY[WP];
CARRY[SJ] = { py: 0.07, pz: 0.06, ty: 0.083, tz: 0.13, flick: 0.4, pose: 0 };     // the procedural scrub-jay's bill (animalModels.js)
CARRY[ST] = { py: 0.11, pz: 0.06, ty: 0.128, tz: 0.125, flick: 0.4, pose: 0 };    // the Steller's jay's

const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const monthOf = d => d.getMonth() + 1 + (d.getDate() - 1) / 31;   // 1 = 1 January
const FG_SEEN = { [TK]: 25, [GS]: 15, [LZ]: 3 };   // m from the player: the field guide's first-sighting card
// Noticing (2026-10-27, docs/games.md): perception.json `detects` says how far each species notices each other by
// sight, sound and scent. With the player in a species, notice[sp] is how far species sp notices the player; an animal
// is alert (head up, frozen, the sentinel up) within min(notice, ALERT_MAX) m, and the flee and flush radii below are
// capped by it, so a stalking lion is not fled until it is noticed. Alarm calls: a species in perception.json
// `alarm_calls` that notices the player within ALARM_NEAR m, when the player's species hunts anyone here (games.json relations), calls
// (once per ALARM_COOL s per species, the 'alarm' event); every animal of a species the player hunts within the
// call's carry is alarmed for ALARM_T s, and an alarmed animal goes to cover or flees as if the player were at its
// flee radius while it is within ALARM_REACT_R m of it.
const ALERT_MAX = 120, ALARM_NEAR = 120, ALARM_T = 8, ALARM_COOL = 12, ALARM_REACT_R = 150, DEER_FLEE = 35;   // ALARM_NEAR: a watcher calls at a predator this close (and noticed), not one it merely sees far off
// AI hunters (2026-10-27): the threat an animal reacts to is the nearest predator of it that it notices: the player (at
// notice[sp], as before) or an AI hunter, an animal whose species hunts it (games.json relations.predation), not bedded
// or up a tree, within HUNT.r m of the player (huntersOf, rebuilt every HUNT.every s), noticed at perception.json
// detects[prey][hunter] m and no more than 30 m above it. threat() picks it; the per-species updates feed its position
// to their alert, freeze, flee, bolt, flush and dive code where the player's was. The player as a camera stays the
// player's (field-guide sightings, the raven's low pass over a covey, the acorn game's raiders). Watchers call at an AI
// fox, coyote, lion or hawk (ALARM_AT) as at the player (aiAlarms; the same cooldown per watcher species), alarming
// that hunter's prey within the call's carry, who then flee from it. Hunts (huntStart): a lion in its hours stalks the
// nearest deer herd, jackrabbit or turkey flock within HUNT.lionR m (walking in, creeping the last HUNT.near m) and
// rushes at its run for HUNT.rushT s from HUNT.rush m, or as soon as the prey breaks within HUNT.rushFar m, then stands
// and goes back to its routine, at most once per HUNT.lionCool s. A fox or coyote trots at a vole, rabbit, jackrabbit
// or ground squirrel within HUNT.canidR m and pounces on it (a short run first if it bolts). A hawk stoops now and then
// (HUNT.hawk of its stoops) at a vole or ground squirrel. Nothing is caught yet: the hunter gives up after the rush.
// Kills (2026-10-28, the hunt archetype's end): a rush that reaches its prey, a pounce that lands, or the player's E
// within reach of prey its species hunts (reach by hunter) kills it with the chance given; the prey lies where it fell
// as carrion for t s (small prey small s), on its side, then goes (its cell's rebuild brings another in later). The
// scavengers of games.json relations.scavenge come: ravens circle in from scavR m and land beside it, vultures bring
// their circle over it, a coyote trots to it. Only KILLABLE species die: those without a flock, covey or colony whose
// unit the code keeps a member list for. feed: how long the lion stands by its kill.
const CARRION = { t: 600, small: 150, reach: { [ML]: 2.4, [CY]: 1.6, [FX]: 1.3, [HK]: 1.4, [RV]: 0.9 }, lionCatch: 0.35, canidCatch: 0.4, scavR: 300, ravenStay: [20, 45], feed: 45 };
const KILLABLE = new Set([DR, BK, JR, RB, VO]);
const HUNT = { r: 300, every: 0.3, lionR: 200, near: 60, stalk: 0.5, rush: 25, rushFar: 50, rushT: [4, 5], lose: 260, stalkMax: 180,
  lionCool: [60, 120], canidR: 60, trotMax: 25, pounceD: 2.4, chaseT: [2, 3.5], canidCool: [20, 45], look: [8, 16], hawk: 0.5, quail: 30 };
const ALARM_AT = new Set([FX, CY, ML, HK]);
// A ground squirrel's burrow mouth: a dark hole in a low ring of bare dirt, 0.27 m across, coloured per vertex.
function burrowGeometry() {
  const R = [0, 0.045, 0.07, 0.15, 0.27], Y = [-0.03, 0, 0.022, 0.012, 0], C = [0x060504, 0x16110c, 0x6c5a46, 0x786650, 0x7d6b55], N = 14;
  const pos = [], col = [], c = new THREE.Color();
  const pt = (k, i) => { const a = i / N * TAU; return [Math.cos(a) * R[k], Y[k], Math.sin(a) * R[k]]; };
  const put = (k, i) => { pos.push(...pt(k, i)); c.setHex(C[k]); col.push(c.r, c.g, c.b); };
  for (let k = 0; k < R.length - 1; k++) for (let i = 0; i < N; i++) {
    put(k, i); put(k + 1, i + 1); put(k + 1, i);   // facing up
    put(k, i); put(k, i + 1); put(k + 1, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// A point on an oak's trunk axis at height h above the ground, following the variant's lean (the
// same frame as acorns.js trunkPoint: limb along +y, rotateZ(lean), rotateY(leanDir + rot), scale).
export function trunkAt(oak, h, out) {
  const st = oak.stem, s = oak.scale;
  if (!st) { out.x = oak.x; out.y = oak.y + h; out.z = oak.z; out.r = 0.25 * s; return out; }
  const sl = Math.sin(st.lean), cl = Math.cos(st.lean), A = st.leanDir + oak.rot;
  const t = (h + 0.3) / (s * cl);
  out.x = oak.x - sl * Math.cos(A) * t * s; out.y = oak.y + h; out.z = oak.z + sl * Math.sin(A) * t * s;
  out.r = s * (st.r0 + (st.r1 - st.r0) * Math.min(1, t / st.len));
  return out;
}
const forkHeight = oak => oak.stem ? Math.max(1.5, oak.scale * oak.stem.len * Math.cos(oak.stem.lean) - 0.3) : 2.5;
const treeHeight = oak => Math.max(3, (oak.height || 8) * oak.scale);

export class Animals {
  constructor({ tile, scene, flight, veg, atmosphere, camera, identify = null, game = null }) {
    Object.assign(this, { tile, flight, veg, camera, identify, atmosphere, game });   // game: the acorn game (acorns.js), or null
    this.searches = SEARCHES;
    // v4: families by granary (rebuilt with the live set), raiders the families may chase
    this.fams = new Map(); this.threats = new Map();
    this.notice = SPECIES.map(() => Infinity); this.preyOf = new Set(); this.alarmCool = {}; this.lastAlarm = null; this.carrion = []; this.lastKill = null;   // noticing (ALERT_MAX above); carrion (CARRION)
    if (game) { game.animals = this; game.on?.('dig', e => this.onDig(e)); }
    // Animals stand on the terrain as drawn this frame (tilepackage.js Heightfield.ground: the near fine mesh of the
    // lidar ground where the tile has one, else the 10 m mesh with each square split SW-NE), which in a hollow runs
    // above the bilinear height field and would bury a bedded deer or hide a vole. Same sampler as flight.meshAt.
    const hts = tile.heights;
    this.heights = { at: (x, north) => hts.ground(x, north), atXZ: (x, z) => hts.ground(x, -z) };
    this.group = new THREE.Group(); this.group.name = 'animals'; scene.add(this.group);
    this.names = Object.fromEntries((tile.species || []).map(s => [s.code, s.common]));
    { const order = SPECIES.map((sp, k) => k).sort((a, b) => (expectedPerKm2(b) - expectedPerKm2(a)) || (a - b));   // the abundant first
      this.rarity = new Float32Array(SPECIES.length); order.forEach((k, i) => { this.rarity[k] = i / Math.max(1, order.length - 1); }); }
    this.time = 0; this.season = null; this.hour = 9;
    this.list = []; this.byId = new Map(); this.bySpecies = SPECIES.map(() => []);
    this.lastCenter = null; this.vegVersion = -1; this.dirty = true;
    this.observer = null; this.perceived = new Set();
    this.held = new Map(); this.freed = new Set();   // the spirit's: animals the player is in, and ones it has left
    this.ms = 0; this.counts = new Int32Array(SPECIES.length); this.lastDescribe = -1e9; this.text = '–';
    this.prior = null; this.priorReady = false; this.priorDeadline = performance.now() + 4000;
    this.loadPrior();
    // one InstancedMesh per species
    this.meshes = SPECIES.map((sp, k) => {
      const model = sp.build();
      const geo = model.geometry;
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(sp.cap * 4), 4); anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const mesh = new THREE.InstancedMesh(geo, animalMaterial(atmosphere, model), sp.cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0; mesh.frustumCulled = false; mesh.name = sp.one;
      mesh.castShadow = mesh.receiveShadow = true;   // receive: patchLambert's csmShadow; cast: the proxies below
      this.group.add(mesh);
      sp.tris = model.tris; sp.model = model;
      if (PLAYABLE.includes(k)) { selfLit(mesh.material); mesh.layers.enable(1); }   // layer 1: redrawn over the spirit's post pass
      return mesh;
    });
    // Shadow casters (see the header): every species on the near cascade through shadows.js
    // addCaster, which follows the mesh's count, visibility and instance buffer itself; deer also a
    // planar shadow.
    this.listeners = {};
    this.planars = SPECIES.map(() => null);
    SPECIES.forEach((sp, k) => {
      const mesh = this.meshes[k];
      mesh.customDepthMaterial = animalDepthMaterial(sp.model);
      addCaster(mesh, { cascades: [0], simple: false });
      if (sp.planar) {
        const ps = new THREE.InstancedMesh(mesh.geometry, planarShadowMaterial(sp.model, { nearFade: true }), sp.cap);
        ps.instanceMatrix = mesh.instanceMatrix; ps.count = 0; ps.frustumCulled = false; ps.name = `${sp.one} shadow`; ps.renderOrder = 1;
        this.group.add(ps); this.planars[k] = ps;
      }
    });
    this.planar = this.planars[DR];
    // ground squirrel burrow mouths (colonyUpdate): a dark hole in a ring of bare dirt, one draw for all of them
    this.colonies = []; this.flocks = []; this.burrowN = 0;
    {
      const bm = new THREE.MeshLambertMaterial({ vertexColors: true });
      atmosphere.patchLambert(bm);
      this.burrows = new THREE.InstancedMesh(burrowGeometry(), bm, 120);
      this.burrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.burrows.count = 0; this.burrows.frustumCulled = false; this.burrows.name = 'ground squirrel burrows'; this.burrows.receiveShadow = true;
      this.group.add(this.burrows);
    }
    this.fgSeen = new Set(); this.lzBudget = LIZ.resolves;
    if (identify) identify.animals = this;   // animal species cards (identify.js)
    // how far each species' body drops when bedded (pose 1): the drawn mesh's when it is on, else the procedural's
    this.drops = SPECIES.map(sp => sp.model.drop || 0); this.poseMax = SPECIES.map(sp => sp.model.poseMax || 1);
    this.month = 10.5;
    this.tris = Object.fromEntries(SPECIES.map(sp => [sp.one, sp.tris]));
    // oak lookup (rebuilt when the vegetation rebuilds); conifer lookup (rebuilt when the near set refreshes)
    this.oaks = []; this.oakGrid = new Map(); this.granary = new Uint8Array(0);
    this.conifers = []; this.coniferGrid = new Map(); this.nearVersion = -1;
    // temporaries
    this._t = { x: 0, y: 0, z: 0, r: 0 }; this._p = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._s = new THREE.Vector3(); this._m = new THREE.Matrix4();
    this._sqF = new THREE.Vector3(); this._sqN = new THREE.Vector3(); this._sqX = new THREE.Vector3(); this._sqM = new THREE.Matrix4(); this._sqE = new THREE.Euler(0, 0, 0, 'YXZ');
    // name tags
    this.tagGroup = new THREE.Group(); this.tagGroup.renderOrder = 19; this.group.add(this.tagGroup);
    this.coveys = []; this.frame = 0; this.camPos = camera.position;
    this.tagPool = []; this.tagMats = {}; this.tagged = [];
    this.setObserver((typeof window !== 'undefined' && window.__we?.playerSpecies) || 'corvus_corax');
    // drawn meshes (DRAWN): per species { on, tiers, planar, loading, casting }, filled by setMesh
    this.drawn = {}; this.lodForce = {}; this._dc = [0, 0, 0];
    this.anim2 = SPECIES.map((sp, k) => DRAWN[k] ? new Float32Array(sp.cap * 4) : null);
    this.clip = SPECIES.map((sp, k) => DRAWN[k] ? new Float32Array(sp.cap * 4) : null);   // aClip for the skinned models (deer, buck)
    this.debugIds = new Set(); this.debugN = 0;
    const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    this.fixedDate = parseDate(q.get('date'));   // ?date=MM-DD: the month (lizards, ground squirrels, antlers) follows it
    for (const k of Object.keys(DRAWN)) {
      const D = DRAWN[k], proc = q.get(D.param) === 'proc' || (D.alias && q.get(D.alias) === 'proc') || q.get('animals') === 'proc';
      if (!proc) this.setMesh(+k, true);
    }
  }

  // ---- drawn meshes (see DRAWN) ------------------------------------------------------------------------
  get deerMesh() { return !!this.drawn[DR]?.on; }
  set deerMesh(on) { this.setMesh(DR, !!on); }
  get deerLodForce() { return this.lodForce.deer ?? null; }
  set deerLodForce(t) { this.lodForce.deer = t; }
  // which: a species index, DRAWN name ('deer', 'squirrel', 'quail', 'scrub-jay') or URL param ('jay').
  async setMesh(which, on) {
    const k = typeof which === 'number' ? which : +Object.keys(DRAWN).find(i => DRAWN[i].name === which || DRAWN[i].param === which);
    const D = DRAWN[k]; if (!D) return;
    const st = this.drawn[k] ||= { on: false, tiers: null, planar: null, loading: null, casting: false };
    st.on = !!on;
    if (st.on && !st.tiers) {
      if (!st.loading) st.loading = D.load().then(model => this.buildTiers(k, model))
        .catch(e => console.warn(`${D.name} mesh failed to load; drawing the procedural ${D.name}`, e));
      await st.loading;
    }
    if (!st.tiers) { st.on = false; return; }   // fallback: the procedural model stays
    const proc = this.meshes[k], use = st.on;
    proc.material.visible = !use;
    const mdl = use ? st.model : SPECIES[k].model;
    this.drops[k] = mdl.drop || 0; this.poseMax[k] = mdl.poseMax || 1;
    if (use !== st.casting) {
      st.casting = use;
      if (use) { removeCaster(proc); for (const m of st.tiers) addCaster(m, { cascades: [0], simple: false }); }
      else { for (const m of st.tiers) removeCaster(m); addCaster(proc, { cascades: [0], simple: false }); }
    }
    for (const m of st.tiers) m.visible = false;
    if (st.planar) for (const m of st.planar) m.visible = false;
  }
  meshOn(k) { const st = this.drawn[k]; return !!(st && st.on && st.tiers); }
  // The player's own animal (squirrelControl.js) draws from the same model as the AI's: the drawn mesh's lod0 once it
  // has loaded (else the procedural model), with its rig and template values. Resolves to { model, geometry, drawn, sp };
  // sp is the species slot carryPoint() takes.
  async playerModel(which = 'squirrel') {
    const k = +Object.keys(DRAWN).find(i => DRAWN[i].name === which);
    const st = this.drawn[k]; if (st?.loading) await st.loading;
    return this.meshOn(k) ? { model: st.model, geometry: st.tiers[0].geometry, drawn: true, sp: k }
      : { model: SPECIES[k].model, geometry: this.meshes[k].geometry, drawn: false, sp: k };
  }
  buildTiers(k, model) {
    const sp = SPECIES[k], cap = sp.cap, D = DRAWN[k], st = this.drawn[k];
    st.model = model;
    st.tiers = model.tiers.map((geo, t) => {
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      if (hasAnim2(model)) { const a2 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); a2.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aAnim2', a2); }
      if (model.skin) { const ac = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); ac.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aClip', ac); }
      const m = new THREE.InstancedMesh(geo, animalMaterial(this.atmosphere, model, { map: model.maps?.[t] || null }), cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.name = `${D.name} mesh lod${t}`; m.visible = false;
      m.castShadow = m.receiveShadow = true;
      m.customDepthMaterial = animalDepthMaterial(model);
      if (PLAYABLE.includes(k)) { selfLit(m.material); m.layers.enable(1); }
      this.group.add(m);
      return m;
    });
    st.planar = D.planar ? st.tiers.map((m, t) => {
      const ps = new THREE.InstancedMesh(m.geometry, planarShadowMaterial(model, { nearFade: true }), cap);
      ps.instanceMatrix = m.instanceMatrix; ps.count = 0; ps.frustumCulled = false; ps.name = `${D.name} mesh shadow lod${t}`; ps.renderOrder = 1; ps.visible = false;
      this.group.add(ps);
      return ps;
    }) : null;
    if (D.hybrid) {   // the flying model in the air: the procedural geometry with its own instance buffers (tier 3)
      const pm = sp.model, geo = pm.geometry.clone();
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const m = new THREE.InstancedMesh(geo, animalMaterial(this.atmosphere, pm), cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.name = `${D.name} mesh air`; m.visible = false;
      m.castShadow = m.receiveShadow = true;
      m.customDepthMaterial = animalDepthMaterial(pm);
      if (PLAYABLE.includes(k)) { selfLit(m.material); m.layers.enable(1); }
      this.group.add(m);
      st.tiers.push(m);
      this.rvGM ||= new Uint8Array(cap);
    }
    sp.meshTris = model.tris;
  }
  // The ravens (DRAWN[RV].hybrid): those on the ground (rvGM, set per animal in update) into the ground model's tiers
  // by distance, those in the air into tier 3, the flying model, lifted RAVEN_LIFT along their own up axis.
  distributeHybrid(k) {
    const st = this.drawn[k], D = DRAWN[k], G = this.rvGM;
    const src = this.meshes[k], n = src.count, M = src.instanceMatrix.array, A = src.geometry.attributes.aAnim.array, A2 = this.anim2[k];
    const C = this.camPos, cnt = this._dc4 ||= [0, 0, 0, 0], T = st.tiers, f = this.lodForce[D.name] ?? null;
    const r0 = D.lod[0] * D.lod[0], r1 = D.lod[1] * D.lod[1];
    cnt[0] = cnt[1] = cnt[2] = cnt[3] = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      if (M[o] === 0 && M[o + 1] === 0 && M[o + 2] === 0) continue;   // culled or hidden (scale 0)
      if (!G[i]) {
        const m = T[3], j = cnt[3]++, D16 = m.instanceMatrix.array;
        D16.set(M.subarray(o, o + 16), j * 16);
        D16[j * 16 + 12] += M[o + 4] * RAVEN_LIFT; D16[j * 16 + 13] += M[o + 5] * RAVEN_LIFT; D16[j * 16 + 14] += M[o + 6] * RAVEN_LIFT;
        m.geometry.attributes.aAnim.array.set(A.subarray(i * 4, i * 4 + 4), j * 4);
        continue;
      }
      const x = M[o + 12] - C.x, y = M[o + 13] - C.y, z = M[o + 14] - C.z, d2 = x * x + y * y + z * z;
      const t = f ?? (d2 < r0 ? 0 : d2 < r1 ? 1 : 2), m = T[t], j = cnt[t]++;
      m.instanceMatrix.array.set(M.subarray(o, o + 16), j * 16);
      m.geometry.attributes.aAnim.array.set(A.subarray(i * 4, i * 4 + 4), j * 4);
      m.geometry.attributes.aAnim2.array.set(A2.subarray(i * 4, i * 4 + 4), j * 4);
    }
    for (let t = 0; t < 4; t++) {
      const m = T[t], c = cnt[t], an = m.geometry.attributes.aAnim;
      m.count = c; m.visible = src.visible && c > 0;
      if (!c) continue;
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, c * 16); m.instanceMatrix.needsUpdate = true;
      an.clearUpdateRanges(); an.addUpdateRange(0, c * 4); an.needsUpdate = true;
      if (t < 3) { const a2 = m.geometry.attributes.aAnim2; a2.clearUpdateRanges(); a2.addUpdateRange(0, c * 4); a2.needsUpdate = true; }
    }
  }
  // Copy each animal's matrix and pose from the procedural mesh's buffers (written by update) into its tier.
  distribute(k) {
    const st = this.drawn[k], D = DRAWN[k];
    if (D.hybrid) return this.distributeHybrid(k);
    const src = this.meshes[k], n = src.count, M = src.instanceMatrix.array, A = src.geometry.attributes.aAnim.array, A2 = this.anim2[k], AC = this.clip[k];
    const C = this.camPos, cnt = this._dc, T = st.tiers, f = this.lodForce[D.name] ?? null, rig = hasAnim2(st.model), skin = !!st.model.skin;
    const r0 = D.lod[0] * D.lod[0], r1 = D.lod[1] * D.lod[1];
    cnt[0] = cnt[1] = cnt[2] = 0;
    for (let i = 0; i < n; i++) {
      if (M[i * 16] === 0 && M[i * 16 + 1] === 0 && M[i * 16 + 2] === 0) continue;   // culled or hidden (scale 0)
      const x = M[i * 16 + 12] - C.x, y = M[i * 16 + 13] - C.y, z = M[i * 16 + 14] - C.z, d2 = x * x + y * y + z * z;
      const t = f ?? (d2 < r0 ? 0 : d2 < r1 ? 1 : 2), m = T[t], j = cnt[t]++;
      m.instanceMatrix.array.set(M.subarray(i * 16, i * 16 + 16), j * 16);
      m.geometry.attributes.aAnim.array.set(A.subarray(i * 4, i * 4 + 4), j * 4);
      if (rig) m.geometry.attributes.aAnim2.array.set(A2.subarray(i * 4, i * 4 + 4), j * 4);
      if (skin) m.geometry.attributes.aClip.array.set(AC.subarray(i * 4, i * 4 + 4), j * 4);
    }
    for (let t = 0; t < 3; t++) {
      const m = T[t], c = cnt[t], an = m.geometry.attributes.aAnim;
      m.count = c; m.visible = src.visible && c > 0;
      if (st.planar) { st.planar[t].count = c; st.planar[t].visible = m.visible; }
      if (!c) continue;
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, c * 16); m.instanceMatrix.needsUpdate = true;
      an.clearUpdateRanges(); an.addUpdateRange(0, c * 4); an.needsUpdate = true;
      if (rig) { const a2 = m.geometry.attributes.aAnim2; a2.clearUpdateRanges(); a2.addUpdateRange(0, c * 4); a2.needsUpdate = true; }
      if (skin) { const ac = m.geometry.attributes.aClip; ac.clearUpdateRanges(); ac.addUpdateRange(0, c * 4); ac.needsUpdate = true; }
    }
  }

  // ---- events (see the header) --------------------------------------------------------------------
  on(type, fn) { (this.listeners[type] ||= []).push(fn); return () => this.off(type, fn); }
  off(type, fn) { const a = this.listeners[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(type, e) {
    const a = this.listeners[type]; if (!a) return;
    for (const fn of a.slice()) { try { fn(e); } catch (err) { console.error(`animals: '${type}' listener`, err); } }
  }
  // Unregister the shadow casters (a teardown; main.js keeps one Animals for the page's life).
  dispose() { for (const m of this.meshes) removeCaster(m); this.group.removeFromParent(); }

  // ---- perception --------------------------------------------------------------------------------
  setObserver(code) {
    this.observer = code;
    const list = this.tile.perception?.perceives?.[code];
    this.perceived = new Set(list || SPECIES.map(s => s.code));   // no matrix: everything
    for (const c of VISUAL_ONLY) this.perceived.add(c);
    const named = new Set(Object.values(this.tile.perception?.perceives || {}).flat());
    for (const c of PENDING) if (!named.has(c)) this.perceived.add(c);
    SPECIES.forEach((sp, k) => { this.meshes[k].visible = this.perceived.has(sp.code); });
    // noticing: how far each species notices this observer (perception.json detects), and whom it hunts (games.json)
    const det = this.tile.perception?.detects || null;
    this.noticeBase = SPECIES.map(sp => { const row = det?.[sp.code.split(':')[0]]; const v = row ? row[code] : undefined; return typeof v === 'number' ? v : Infinity; });
    this.stalkK = 1; this.notice = this.noticeBase.slice();
    this.preyOf = new Set((this.tile.games?.relations?.predation || []).filter(([pr]) => pr === code).map(([, q]) => q));
    this.dirty = true;
  }
  // The player's stalk (groundControl): k scales how far every species notices the player (1 walking; 0.55 creeping,
  // 0.4 frozen, 1.3 running: the signature of a hunter moving low and slow is smaller, a running one's larger).
  setStalk(k) { if (k === this.stalkK || !this.noticeBase) return; this.stalkK = k; this.notice = this.noticeBase.map(v => v * k); }
  // Danger to an animal or a group o of species sp at distance d from the player, whose own flee radius is base: within
  // base and noticed, or alarmed by a call and within ALARM_REACT_R. alert: noticed, within ALERT_MAX.
  // n: how far sp notices the threat at hand (threat() T.n; the player's notice[sp] by default).
  danger(sp, o, d, base, n = this.notice[sp]) { return ((o?.alarmUntil || 0) > this.time && d < ALARM_REACT_R) || d < Math.min(base, n); }
  alert(sp, d, n = this.notice[sp]) { return d < Math.min(n, ALERT_MAX); }
  alarmed(o) { return (o?.alarmUntil || 0) > this.time; }
  // The alarm calls (the header): a watcher species that notices the player, while the player hunts someone here.
  alarms(px, py, pz) {
    if (!this.preyOf.size) return;
    const calls = this.tile.perception?.alarm_calls; if (!calls) return;
    for (const code in calls) {
      const k = INDEX[code]; if (k === undefined || !this.meshes[k]?.visible || (this.alarmCool[code] || 0) > this.time) continue;
      const R = Math.min(this.notice[k], ALARM_NEAR); if (!isFinite(R)) continue;
      let caller = null;
      for (const a of this.bySpecies[k]) { if (a.culled) continue; const dx = a.x - px, dy = a.y - py, dz = a.z - pz; if (dx * dx + dy * dy + dz * dz < R * R) { caller = a; break; } }
      if (!caller) continue;
      this.alarmCool[code] = this.time + ALARM_COOL;
      const carry = calls[code], until = this.time + ALARM_T; let n = 0;
      for (const a of this.list) {
        if (!this.preyOf.has(SPECIES[a.sp].code.split(':')[0])) continue;
        const dx = a.x - caller.x, dz = a.z - caller.z; if (dx * dx + dz * dz > carry * carry) continue;
        a.alarmUntil = until; a.alarmBy = null; if (a.group) { a.group.alarmUntil = until; a.group.alarmBy = null; } n++;
      }
      this.lastAlarm = { code, t: this.time, n };
      this.emit('alarm', { species: code, x: caller.x, y: caller.y, z: caller.z, carry, alarmed: n, predator: this.observer });
    }
  }
  // ---- AI hunters (HUNT above) ------------------------------------------------------------------------
  // Who hunts whom by slot (preySlots[hunter]: a Set of prey slots; the buck shares the deer's code) and how far each
  // species notices each other (det[prey][hunter], m; Infinity when perception.json does not say).
  buildHunts() {
    const slots = code => SPECIES.map((s, k) => s.code === code ? k : -1).filter(k => k >= 0);
    this.preySlots = SPECIES.map(() => null);
    for (const [h, q] of this.tile.games?.relations?.predation || []) for (const hk of slots(h)) {
      const s = this.preySlots[hk] ||= new Set();
      for (const qk of slots(q)) s.add(qk);
    }
    const det = this.tile.perception?.detects || {};
    this.det = SPECIES.map(p => SPECIES.map(h => { const v = det[p.code.split(':')[0]]?.[h.code.split(':')[0]]; return typeof v === 'number' ? v : Infinity; }));
    this.huntersOf = SPECIES.map(() => []); this.hunterList = [];
  }
  // The live AI hunters near the player (not bedded, not up a tree), by the prey slot they hunt.
  refreshHunters(P) {
    if (!this.preySlots) this.buildHunts();
    for (const l of this.huntersOf) l.length = 0;
    this.hunterList.length = 0;
    const R2 = HUNT.r * HUNT.r;
    for (const a of this.list) {
      const prey = this.preySlots[a.sp]; if (!prey) continue;
      if (a.state === M_BED || a.state === M_TREE || a.state === M_CLIMB || a.state === M_DOWN) continue;
      if ((a.x - P.x) ** 2 + (a.z - P.z) ** 2 > R2) continue;
      this.hunterList.push(a);
      for (const k of prey) this.huntersOf[k].push(a);
    }
  }
  // The threat to an animal or group o of species sp at (x, y, z): the player at (px, py, pz) when it is noticed (or
  // its alarm call is on o) and no noticed AI hunter is nearer; else the nearest AI hunter of sp that sp notices; else,
  // when o is alarmed by an AI hunter's call, that hunter; else the player (so with no AI hunter about, exactly as
  // before). Returns a shared { x, y, z, n (how far sp notices it), who (the hunter, or null for the player) }.
  threat(sp, o, x, y, z, px, py, pz) {
    const T = this._T ||= { x: 0, y: 0, z: 0, n: 0, who: null };
    T.x = px; T.y = py; T.z = pz; T.n = this.notice[sp]; T.who = null;
    const hs = this.huntersOf?.[sp], by = (o?.alarmUntil || 0) > this.time ? (o.alarmBy ?? null) : undefined;
    if ((!hs?.length && !by) || !this.det) return T;
    const pn = this.notice[sp], dp = (px - x) ** 2 + (pz - z) ** 2, row = this.det[sp];
    const lim = dp < pn * pn || by === null ? dp : Infinity;
    let best = null, bd = lim;
    for (const h of hs || []) {
      if (h === o || h.y - y > 30) continue;
      const d2 = (h.x - x) ** 2 + (h.z - z) ** 2, n = row[h.sp];
      if (d2 < bd && d2 < n * n) { bd = d2; best = h; }
    }
    if (!best && by && lim === Infinity && this.alive(by)) best = by;
    if (best) { T.x = best.x; T.y = best.y; T.z = best.z; T.n = row[best.sp]; T.who = best; }
    return T;
  }
  // The watchers' alarm calls at AI hunters (a fox, coyote, lion or hawk; ALARM_AT): as alarms() does for the player,
  // with 2.5x the cooldown per watcher species (the hunters are about all dawn); the alarmed are that hunter's prey within the carry, and flee from it.
  aiAlarms() {
    const calls = this.tile.perception?.alarm_calls; if (!calls || !this.hunterList?.length) return;
    for (const code in calls) {
      const k = INDEX[code]; if (k === undefined || !this.meshes[k]?.visible || (this.alarmCool[code] || 0) > this.time) continue;
      let caller = null, by = null;
      for (const h of this.hunterList) {
        if (!ALARM_AT.has(h.sp) || h.sp === k) continue;
        const R = Math.min(this.det[k][h.sp], ALARM_NEAR);
        for (const w of this.bySpecies[k]) {
          if (w.culled) continue;
          const dx = w.x - h.x, dy = w.y - h.y, dz = w.z - h.z;
          if (dx * dx + dy * dy + dz * dz < R * R) { caller = w; break; }
        }
        if (caller) { by = h; break; }
      }
      if (!caller) continue;
      this.alarmCool[code] = this.time + ALARM_COOL * 2.5;   // AI hunters are about all dawn: a watcher species calls at them a third as often as at the player
      const carry = calls[code], until = this.time + ALARM_T, prey = this.preySlots[by.sp]; let n = 0;
      for (const a of this.list) {
        if (!prey.has(a.sp)) continue;
        const dx = a.x - caller.x, dz = a.z - caller.z; if (dx * dx + dz * dz > carry * carry) continue;
        a.alarmUntil = until; a.alarmBy = by; if (a.group) { a.group.alarmUntil = until; a.group.alarmBy = by; } n++;
      }
      const predator = SPECIES[by.sp].code;
      this.lastAlarm = { code, t: this.time, n, predator };
      this.emit('alarm', { species: code, x: caller.x, y: caller.y, z: caller.z, carry, alarmed: n, predator, hunter: by });
    }
  }
  // A hunt's target (an animal, or a turkey flock) still there, and broken away (fled).
  huntAlive(t) { return t.sp === undefined ? this.flocks.includes(t) : this.alive(t); }
  fled(t) {
    if (t.sp === undefined) return t.state === TF_TREE || t.state === TF_ROOST;
    switch (t.sp) {
      case DR: case BK: return (t.group?.fleeT || 0) > 0;
      case JR: return t.state === JK_BOLT;
      case RB: return t.state === B_BOLT;
      case VO: return t.state === VL_HIDE || (t.state === VL_RUN && t.next === VL_HIDE);
      case GS: return t.state === G_DIVE || t.state === G_DOWN;
    }
    return false;
  }
  huntable(b) {
    switch (b.sp) {
      case VO: return b.state !== VL_HIDE;
      case RB: return b.state !== B_FORM && b.state !== B_BOLT;
      case JR: return b.state !== JK_BOLT;
      case GS: return b.state !== G_DOWN && b.state !== G_DIVE && b.group?.state === C_OK;
    }
    return true;
  }
  // The nearest prey for hunter a within R m: a lion's a deer herd (its leader), a jackrabbit or a turkey flock; a fox's
  // or coyote's (and a hawk's) a vole, rabbit, jackrabbit or ground squirrel; only species a's hunts (relations).
  huntTarget(a, R, kinds) {
    const prey = this.preySlots?.[a.sp]; if (!prey) return null;
    let best = null, bd = R * R;
    for (const k of kinds) {
      if (!prey.has(k) || !this.meshes[k].visible) continue;
      for (const b of this.bySpecies[k]) {
        if (!this.huntable(b)) continue;
        const d2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2; if (d2 < bd) { bd = d2; best = b; }
      }
    }
    if (a.sp === ML && prey.has(TK) && this.meshes[TK].visible) for (const g of this.flocks) {
      if (g.state !== TF_FORAGE && g.state !== TF_WALK) continue;
      const d2 = (g.x - a.x) ** 2 + (g.z - a.z) ** 2; if (d2 < bd) { bd = d2; best = g; }
    }
    if (best && (best.sp === DR || best.sp === BK) && best.group?.leader && this.alive(best.group.leader)) best = best.group.leader;
    return best;
  }
  // A fox, coyote or lion (a group's leader or alone) looks for prey: when it is off its cooldown and finds some, the
  // ---- kills and carrion (CARRION above) ------------------------------------------------------------
  kill(prey, by) {
    if (!prey || prey.dead || prey.sp === undefined || !KILLABLE.has(prey.sp)) return false;
    const small = prey.sp === VO || prey.sp === RB;
    prey.dead = true; prey.diedAt = this.time; prey.carrionUntil = this.time + (small ? CARRION.small : CARRION.t);
    prey.hunt = null; prey.air = 0; prey.speed = 0; prey.amp = 0; prey.flick = 0; prey.flickV = 0; prey.lift = 0; prey.fleeT = 0; prey.spd = 0;
    prey.state = prey.sp === VO ? VL_SIT : prey.sp === RB ? B_FORM : prey.sp === JR ? JK_FORM : D_BED; prey.pose = 1;   // the rest pose (the skin drive's bed clip), on its side
    prey.lieRoll = (prey.rng ? prey.rng() : Math.random()) < 0.5 ? -1 : 1;
    if (prey.group) {   // a herd member: the herd goes on without it
      const g = prey.group; prey.group = null;
      if (g.leader === prey) { const o = this.list.find(b => b !== prey && b.group === g && !b.dead); if (o) g.leader = o; else prey.group = g; }
    }
    this.carrion.push(prey);
    const who = by === 'player' ? this.observer || 'player' : SPECIES[by.sp].code;
    this.lastKill = { prey: SPECIES[prey.sp].code, by: who, t: this.time, x: Math.round(prey.x), z: Math.round(prey.z) };
    this.emit('kill', { prey: SPECIES[prey.sp].code, by: who, x: prey.x, y: prey.y, z: prey.z, small });
    return true;
  }
  lieStill(a) {   // on its side on the ground, a little up so the body is not under it
    a.y = this.heights.atXZ(a.x, a.z) + 0.04;
    a.roll = a.lieRoll * 1.45; a.pitch = 0; a.amp = 0; a.pose = 1; a.speed = 0; a.flick = 0;
  }
  bury(a) {   // the carrion goes: unseen at once, dropped by the next rebuild
    a.gone = true; a.vis = 0; a.culled = true;
    if (a.slot >= 0 && this.meshes[a.sp]) this.meshes[a.sp].instanceMatrix.array.fill(0, a.slot * 16, a.slot * 16 + 16);
    this.byId.delete(a.id); this.carrion = this.carrion.filter(c => c !== a); this.dirty = true;
  }
  carrionNear(x, z, R) {
    let best = null, bd = R * R;
    for (const c of this.carrion) { if (c.gone) continue; const d2 = (c.x - x) ** 2 + (c.z - z) ** 2; if (d2 < bd) { bd = d2; best = c; } }
    return best;
  }
  // The player's catch (E within reach of prey its species hunts): the kill, or null.
  catchNear(x, y, z) {
    const k = INDEX[this.observer], prey = this.preySlots?.[k], reach = CARRION.reach[k]; if (!prey || !reach) return null;
    let best = null, bd = reach * reach;
    for (const a of this.list) {
      if (!prey.has(a.sp) || a.dead || a.culled || !KILLABLE.has(a.sp)) continue;
      const d2 = (a.x - x) ** 2 + (a.y - y) ** 2 * 0.25 + (a.z - z) ** 2; if (d2 < bd) { bd = d2; best = a; }
    }
    if (best) this.kill(best, 'player');
    return best;
  }
  // lion stalks (M_STALK with a.hunt), a canid trots at it (M_RUSH). true when a hunt starts.
  huntStart(a) {
    if (this.time < (a.huntAt || 0) || !this.preySlots?.[a.sp]) return false;
    const r = a.rng, lion = a.sp === ML;
    const t = lion ? this.huntTarget(a, HUNT.lionR, [DR, BK, JR]) : this.huntTarget(a, HUNT.canidR, [VO, RB, JR, GS]);
    if (!t) { a.huntAt = this.time + HUNT.look[0] + r() * (HUNT.look[1] - HUNT.look[0]); return false; }
    a.hunt = t; a.rush = 0; a.rolled = 0; a.huntEnd = this.time + (lion ? HUNT.stalkMax : HUNT.trotMax); a.tx = t.x; a.tz = t.z;
    if (lion) { a.state = M_STALK; a.speed = MAMMAL[ML].walk; a.t = 1e9; }
    else { a.state = M_RUSH; a.speed = MAMMAL[a.sp].trot; }
    this.lastHunt = { id: a.id, hunter: SPECIES[a.sp].code, prey: t.sp === undefined ? 'meleagris_gallopavo' : SPECIES[t.sp].code, t: this.time };
    return true;
  }
  // The hunt is over (nothing is caught yet): stand (the lion) or sniff (a canid), and no new hunt for a while.
  huntOver(a, state) {
    const r = a.rng, cool = a.sp === ML ? HUNT.lionCool : HUNT.canidCool;
    a.hunt = null; a.rush = 0; a.state = state; a.t = state === M_SNIFF ? 2 + r() * 3 : 3 + r() * 4;
    a.huntAt = this.time + cool[0] + r() * (cool[1] - cool[0]);
  }

  // ---- occurrence prior --------------------------------------------------------------------------
  // The pipeline's density prior (client/species_prior.json, manifest layer client.species_prior;
  // pipeline/derive.py species_prior), built from CC0 and CC BY occurrence records only: per species a
  // byte per 100 m cell, w / 255 = d / (d + dMean), d = records summed over an 11 x 11 box (~500 m
  // radius). prior = 0.6 + 0.8 w / 255: 0.6 where nobody recorded the species, up to 1.4 where many did.
  // A weak prior on purpose: records follow observers (roads, houses), not animals. The records
  // themselves (species/occurrences.geojson, CC BY-NC ones among them) are never fetched by a client.
  async loadPrior() {
    try {
      const g = this.tile.speciesPrior;   // tilepackage.js loadSpeciesPrior
      if (!g) throw new Error('tile has no client.species_prior layer; run the species_prior step');
      const prior = {};
      for (const [code, w] of Object.entries(g.species))
        if (SPECIES.some(sp => sp.code === code)) prior[code] = { w, N: g.cells, cell: g.cellM };
      this.prior = prior;
    } catch (e) { console.warn('animals: no occurrence prior', e); }
    this.priorReady = true; this.dirty = true;
  }
  priorAt(code, x, north) {
    const p = this.prior?.[code]; if (!p) return 1;   // no prior loaded: neutral; species with no usable records: neutral too
    const i = Math.min(p.N - 1, Math.max(0, Math.floor(x / p.cell))), j = Math.min(p.N - 1, Math.max(0, Math.floor(north / p.cell)));
    return 0.6 + 0.8 * p.w[(p.N - 1 - j) * p.N + i] / 255;   // row 0 = north edge
  }

  // ---- oaks ---------------------------------------------------------------------------------------
  indexOaks() {
    this.oaks = this.veg.oaks; this.vegVersion = this.veg.version;
    const grid = new Map(), n = this.oaks.length, gran = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const o = this.oaks[k];
      const key = Math.floor(o.x / BUCKET) + Math.floor(-o.z / BUCKET) * 4096;
      let arr = grid.get(key); if (!arr) grid.set(key, arr = []);
      arr.push(k); gran[k] = isStashTree(o) ? 1 : 0;
    }
    this.oakGrid = grid; this.granary = gran;
  }
  // Nearest oak to (x, z) within r (granaryOnly: stash trees only), or null. No allocation.
  nearestOak(x, z, r, granaryOnly = false) {
    const n = -z, b = Math.ceil(r / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(n / BUCKET);
    let best = null, bd = r * r;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.oakGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const idx = arr[k]; if (granaryOnly && !this.granary[idx]) continue;
        const o = this.oaks[idx], dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = o; }
      }
    }
    return best;
  }
  // The family granary for a woodpecker at (x, z), the families' rule (spawnCell): the nearest stash tree within
  // 150 m, else the nearest oak (within 400 m). For the player woodpecker (woodpeckerControl.js); indexes the oaks
  // first when the forest was just rebuilt there.
  familyGranary(x, z) {
    if (this.veg.version !== this.vegVersion && this.veg.oaks.length) this.indexOaks();
    return this.nearestOak(x, z, 150, true) || this.nearestOak(x, z, 400);
  }
  // The player woodpecker's family on its granary: the woodpeckers anchored there, or (none living there) a family of
  // 3-6 spawned on it as a cell would (spawnCell), kept through rebuilds while it is the player's granary.
  // Returns the family's members.
  familyOn(oak) {
    if (!oak) { this.familyIds = null; this.dirty = true; return []; }
    const on = a => (a.sp === WP || a.sp === WF) && a.anchor && Math.abs(a.anchor.x - oak.x) < 0.5 && Math.abs(a.anchor.z - oak.z) < 0.5;
    let fam = this.list.filter(on);
    if (!fam.length) {
      const keep = new Set(), rnd = mulberry32(seedOf(oak.id, 0xfa31));
      this._near = true; this.spawnCell(WP, 'family', oak.id, oak.x, -oak.z, rnd, keep, 0); this._near = false;
      this.familyIds = keep; this.dirty = true;
      fam = [...keep].map(id => this.byId.get(id)).filter(Boolean);
    }
    return fam;
  }
  // A random oak within r of (x, z), other than `not` (reservoir sampling, no allocation).
  randomOak(x, z, r, rng, not = null, minH = 0) {
    const n = -z, b = Math.ceil(r / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(n / BUCKET);
    let pick = null, seen = 0;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.oakGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const o = this.oaks[arr[k]]; if (o === not) continue;
        const dx = o.x - x, dz = o.z - z; if (dx * dx + dz * dz > r * r) continue;
        if (minH && treeHeight(o) < minH) continue;
        seen++; if (rng() * seen < 1) pick = o;
      }
    }
    return pick;
  }

  // A random oak between rMin and rMax of (x, z) (granaryOnly: stash trees only), or null. No allocation.
  ringOak(x, z, rMin, rMax, rng, granaryOnly = false, not = null) {
    const n = -z, b = Math.ceil(rMax / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(n / BUCKET);
    let pick = null, seen = 0;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.oakGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const idx = arr[k]; if (granaryOnly && !this.granary[idx]) continue;
        const o = this.oaks[idx]; if (o === not) continue;
        const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz; if (d2 > rMax * rMax || d2 < rMin * rMin) continue;
        seen++; if (rng() * seen < 1) pick = o;
      }
    }
    return pick;
  }

  // ---- conifers (Steller's jays) ------------------------------------------------------------------
  // { x, y, z, height } per pine in the vegetation's near set; y is the ground at the trunk.
  indexConifers() {
    this.nearVersion = this.veg.nearVersion;
    const had = this.conifers.length, grid = new Map(), list = [];
    for (const pl of this.veg.nearPlants || []) {
      if (!CONIFERS.has(pl.species) || !(pl.height > 4)) continue;
      const o = { id: pl.id, sp: pl.species, x: pl.x, y: pl.y, z: pl.z, height: pl.height, conifer: true };
      const key = Math.floor(o.x / BUCKET) + Math.floor(-o.z / BUCKET) * 4096;
      let arr = grid.get(key); if (!arr) grid.set(key, arr = []);
      arr.push(list.length); list.push(o);
    }
    this.conifers = list; this.coniferGrid = grid;
    if (!had && list.length) this.dirty = true;   // the first near set: place the jays now rather than after 100 m
  }
  // Nearest conifer to (x, z) within r, or a random one between rMin and rMax (other than `not`); no allocation.
  nearestConifer(x, z, r) {
    const b = Math.ceil(r / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(-z / BUCKET);
    let best = null, bd = r * r;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.coniferGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) { const o = this.conifers[arr[k]], dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = o; } }
    }
    return best;
  }
  ringConifer(x, z, rMin, rMax, rng, not = null) {
    const b = Math.ceil(rMax / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(-z / BUCKET);
    let pick = null, seen = 0;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.coniferGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const o = this.conifers[arr[k]]; if (o === not || (not && o.id === not.id)) continue;
        const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz; if (d2 > rMax * rMax || d2 < rMin * rMin) continue;
        seen++; if (rng() * seen < 1) pick = o;
      }
    }
    return pick;
  }

  // ---- population ---------------------------------------------------------------------------------
  rebuild(px, pz) {
    this.lastCenter = [px, pz]; this.dirty = false;
    const t = this.tile, hab = t.habitat, can = t.canopy, res = hab.res, size = t.size, north = -pz;
    const [ci, cj] = hab.cellOf(px, north), cells = Math.ceil(LIVE_R / res);
    const keep = new Set();
    const live = SPECIES.map(sp => this.perceived.has(sp.code));
    const lzOn = this.lzMonth();   // March to October (a cool day keeps them hidden, lzUpdate)
    for (let j = cj - cells; j <= cj + cells; j++) for (let i = ci - cells; i <= ci + cells; i++) {
      if (i < 0 || j < 0 || i >= hab.img.width || j >= hab.img.height) continue;
      const cx = (i + 0.5) * res, cn = size - (j + 0.5) * res;
      const dist = Math.hypot(cx - px, cn - north);
      if (dist > LIVE_R) continue;
      const cls = hab.channel(i, j, 0); if (!cls) continue;
      const tree = can.channel(i, j, 0) / 100;
      let edge = 0;   // woodland next to open ground within 60 m
      if (cls !== 7) {
        const wood = c => c === 1 || c === 2 || c === 3 || c === 6, open = c => c === 4 || c === 5 || c === 9;
        const me = wood(cls);
        for (const [di, dj] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= hab.img.width || jj >= hab.img.height) continue;
          const c2 = hab.channel(ii, jj, 0); if (me ? open(c2) : wood(c2) && open(cls)) { edge = 1; break; }
        }
      }
      let brushEdge = 0;   // brush rabbits: brush (chaparral, riparian) beside grass, or grass beside brush
      if (live[RB] && dist < SPECIES[RB].liveR) {
        const brush = c => c === 4 || c === 6, grass = c => c === 5 || c === 9;
        if (brush(cls) || grass(cls)) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= hab.img.width || jj >= hab.img.height) continue;
          const c2 = hab.channel(ii, jj, 0); if (brush(cls) ? grass(c2) : brush(c2)) { brushEdge = 1; break; }
        }
        if (!brushEdge) brushEdge = brush(cls) ? 0.35 : cls === 1 && edge ? 0.5 : 0;
      }
      for (let s = 0; s < SPECIES.length; s++) {
        if (!live[s] || SPECIES[s].grid || SPECIES[s].territory || SPECIES[s].variantOf !== undefined) continue;   // soarers, lion: territory cells; bucks: in the herds
        const sp = SPECIES[s]; if (sp.liveR && dist > sp.liveR) continue;
        const suit = SUIT[sp.code][cls] || 0; if (!suit) continue;
        let f = suit;
        if (s === SQ) f *= 0.25 + 0.75 * Math.min(1, tree * 1.5);
        else if (s === WP) f *= 0.3 + 0.7 * Math.min(1, tree * 2);
        else if (s === RV) f *= 0.6 + 0.6 * edge;
        else if (s === QU) f *= (0.35 + 0.65 * edge) * (1 - 0.5 * Math.min(1, tree));   // open ground with cover near
        else if (s === SJ) f *= 0.4 + 0.6 * Math.min(1, tree * 2);
        else if (s === ST) f *= 0.3 + 0.7 * Math.min(1, tree * 1.5);
        else if (s === FX) f *= 0.35 + 0.65 * edge;                                  // woodland and chaparral edges
        else if (s === CY) f *= (1 - 0.6 * Math.min(1, tree * 1.5)) * (0.8 + 0.3 * edge);   // open grass and savanna
        else if (s === RB) f *= brushEdge;
        else if (s === VO) f *= 1 - 0.8 * Math.min(1, tree * 1.5);                    // runways in open grass
        else if (s === JR) f *= 1 - 0.9 * Math.min(1, tree * 1.6);                    // open: grass, savanna, pasture
        else if (s === TK) f *= (0.3 + 0.7 * Math.min(1, tree * 2.5)) * (1 - 0.5 * Math.max(0, tree - 0.6));   // oaks with openings
        else if (s === GS) f *= 1 - 0.9 * Math.min(1, tree * 1.8);                    // open grass, low shrubs
        else if (s === LZ) { if (!lzOn) continue; f *= 0.25 + 0.75 * Math.min(1, (t.outcrop ? t.outcrop.at(cx, cn) / 255 : 0) * 2.5 + tree * 1.2); }
        else f *= 0.6 + 0.5 * edge;
        const lambda = sp.k * f * this.priorAt(sp.code, cx, cn) * (SEASON[sp.code][this.season] ?? 1);
        const rnd = mulberry32(hash(i, j, sp.salt));
        if (rnd() >= lambda) continue;
        this.spawnCell(s, i, j, cx, cn, rnd, keep);
      }
    }
    for (const s of [HK, TV]) if (live[s]) this.spawnSoarers(s, px, pz, keep);
    if (live[ML]) this.spawnLion(px, pz, keep);
    for (const id of this.debugIds) if (this.byId.has(id)) keep.add(id);   // summoned (debugging) animals stay
    if (this.familyIds) for (const id of this.familyIds) if (this.byId.has(id)) keep.add(id);   // the player woodpecker's family
    for (const id of this.freed) {   // left by the player (release): kept while near, wherever its home cell is
      const a = this.byId.get(id);
      if (a && Math.hypot(a.x - px, a.z - pz) < LIVE_R + 100 && this.perceived.has(SPECIES[a.sp].code)) keep.add(id); else this.freed.delete(id);
    }
    // drop animals whose home cell left the live set; rebuild the per-species slot lists
    for (const [id, a] of this.byId) if (!keep.has(id)) this.byId.delete(id);
    this.list = [...this.byId.values()];
    this.bySpecies = SPECIES.map(() => []);
    for (const a of this.list) { const arr = this.bySpecies[a.sp]; if (arr.length < SPECIES[a.sp].cap) { a.slot = arr.length; arr.push(a); } else a.slot = -1; }
    this.list = this.list.filter(a => a.slot >= 0);
    this.bySpecies.forEach((arr, s) => { this.meshes[s].count = arr.length; });
    this.cullOn = SPECIES.map((sp, k) => !!CULL[k]);
    for (const a of this.list) a.culled = false;
    const cov = new Set(); for (const a of this.bySpecies[QU]) cov.add(a.group);
    this.coveys = [...cov];
    const fl = new Set(); for (const a of this.bySpecies[TK]) fl.add(a.group);
    this.flocks = [...fl];
    const col = new Set(); for (const a of this.bySpecies[GS]) col.add(a.group);
    this.colonies = [...col]; this.placeBurrows();
    this.fams = new Map();   // v4: each granary's family
    for (const a of this.list) if ((a.sp === WP || a.sp === WF) && a.anchor) { let f = this.fams.get(a.anchor.id); if (!f) this.fams.set(a.anchor.id, f = []); f.push(a); }
    this.tagged.length = 0;
  }

  // Hawks and vultures: one bird per coarse territory cell with probability sp.p, its home a hashed
  // point in the cell; those within LIVE_R + 100 m live. At least one of each always: if no cell
  // passes, the cell whose draw came closest does.
  spawnSoarers(s, px, pz, keep) {
    const sp = SPECIES[s], G = sp.grid, north = -pz, R = LIVE_R + 100, size = this.tile.size;
    let best = null, bestU = 2, n = 0;
    for (let J = Math.floor((north - R) / G); J <= Math.floor((north + R) / G); J++)
      for (let I = Math.floor((px - R) / G); I <= Math.floor((px + R) / G); I++) {
        const rnd = mulberry32(hash(I + 1000, J + 1000, sp.salt)), u = rnd();
        const hx = (I + 0.1 + 0.8 * rnd()) * G, hn = (J + 0.1 + 0.8 * rnd()) * G;
        if (hx < 0 || hn < 0 || hx > size || hn > size || Math.hypot(hx - px, hn - north) > R) continue;
        if (u < sp.p) { this.spawnSoarer(s, I, J, hx, -hn, rnd, keep); n++; }
        else if (u < bestU) { bestU = u; best = [I, J, hx, -hn, rnd]; }
      }
    if (!n && best) this.spawnSoarer(s, best[0], best[1], best[2], best[3], best[4], keep);
  }
  spawnSoarer(s, I, J, x, z, rnd, keep) {
    this.add(`${s}:T${I},${J}`, s, rnd, a => {
      a.hx = x; a.hz = z;
      const dir = rnd() < 0.5 ? 1 : -1, th = rnd() * TAU;
      if (s === HK) this.soarStart(a, x, z, 45 + rnd() * 45, 100 + rnd() * 150, dir, th, H_SOAR);
      else this.soarStart(a, x, z, 50 + rnd() * 60, 40 + rnd() * 140, dir, th, V_SOAR);
    }, keep);
  }

  // The mountain lion: one per coarse territory cell (sp.territory m) with probability sp.p, its home a hashed point in
  // the cell that must be oak, mixed, chaparral or riparian; of the cells within LIVE_R + 150 m only the nearest
  // passing one lives (at most one adult, or a mother with young, in the live set; none is forced).
  spawnLion(px, pz, keep) {
    const sp = SPECIES[ML], G = sp.territory, north = -pz, R = LIVE_R + 150, size = this.tile.size;
    let best = null, bd = Infinity;
    for (let J = Math.floor((north - R) / G); J <= Math.floor((north + R) / G); J++)
      for (let I = Math.floor((px - R) / G); I <= Math.floor((px + R) / G); I++) {
        const rnd = mulberry32(hash(I + 3000, J + 3000, sp.salt)); if (rnd() >= sp.p) continue;
        const hx = (I + 0.15 + 0.7 * rnd()) * G, hn = (J + 0.15 + 0.7 * rnd()) * G;
        if (hx < 0 || hn < 0 || hx > size || hn > size) continue;
        const d = Math.hypot(hx - px, hn - north); if (d > R || d >= bd) continue;
        if ((SUIT.puma_concolor[this.tile.habitat.at(hx, hn)] || 0) < 0.6) continue;
        bd = d; best = [I, J, hx, -hn, rnd];
      }
    if (best) this.spawnLionGroup(`${ML}:L${best[0]},${best[1]}`, best[2], best[3], best[4], keep);
  }
  spawnLionGroup(base, x, z, rnd, keep) {
    const female = rnd() < 0.6, young = female && rnd() < 0.4 ? 1 + (rnd() < 0.4) : 0;
    const bed = this.nearestOak(x, z, 60);
    const g = { hx: x, hz: z, leader: null, bx: bed ? bed.x + 1.2 : x, bz: bed ? bed.z + 0.8 : z };
    for (let m = 0; m <= young; m++) this.add(`${base}:${m}`, ML, rnd, a => {
      a.group = g; a.rank = m; if (!m) g.leader = a;
      a.size = m ? 0.6 * (0.95 + 0.1 * rnd()) : female ? 0.94 : 1.04;
      a.ox = m ? (rnd() - 0.5) * 3 : 0; a.oz = m ? -1 - rnd() * 2 : 0;
      this.mmStart(a, x, z);
    }, keep);
  }

  // One cell's animals (a squirrel; a woodpecker family; a raven or a pair; a deer group).
  spawnCell(s, i, j, cx, cn, rnd, keep, jitter = 30) {
    const x = cx + (rnd() - 0.5) * jitter, z = -(cn + (rnd() - 0.5) * jitter);
    const base = `${s}:${i},${j}`;
    if (s === SQ) {
      const home = this.nearestOak(x, z, 45); if (!home) return;
      this.add(base, s, rnd, a => { a.anchor = home; a.tree = home; this.sqStart(a); }, keep);
    } else if (s === WP) {   // a family of 3-6 on its granary (a stash tree; summoned ones take the nearest oak)
      const gran = (this._near && (this.nearestOak(x, z, 30, true) || this.nearestOak(x, z, 30))) || this.nearestOak(x, z, 150, true) || this.nearestOak(x, z, 60);
      if (!gran) return;
      const n = 3 + Math.floor(rnd() * 4);
      for (let m = 0; m < n; m++) {
        const id = `${base}:${m}`, female = (seedOf(id, 0xfe3) & 1) === 1;
        this.add(id, female ? WF : s, rnd, a => { a.anchor = gran; this.wpStart(a, m); }, keep);
      }
    } else if (s === RV) {
      const n = rnd() < 0.55 ? 2 : 1, R = 35 + rnd() * 40, alt = 50 + rnd() * 100, dir = rnd() < 0.5 ? 1 : -1, th = rnd() * TAU;
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.hx = x; a.hz = z; this.rvStart(a, x, z, R + m * 8, alt + m * 6, dir, th + m * 0.6);
      }, keep);
    } else if (s === QU) {
      const se = this.season, n = se === 'spring' ? 2 + Math.floor(rnd() * 3) : se === 'summer' ? 6 + Math.floor(rnd() * 7) : 8 + Math.floor(rnd() * 8);
      const g = { x, z, hx: x, hz: z, tx: x, tz: z, dx: 0, dz: 1, state: G_FORAGE, t: 5 + rnd() * 30, cool: 10 + rnd() * 60, n, leader: null, speed: 3 };
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.group = g; a.rank = m; if (!m) g.leader = a;
        const ang = rnd() * TAU, d = Math.sqrt(rnd()) * 2.8;
        a.ox = Math.cos(ang) * d; a.oz = Math.sin(ang) * d;
        a.x = x + a.ox; a.z = z + a.oz; a.y = this.heights.atXZ(a.x, a.z); a.yaw = rnd() * TAU;
        a.state = Q_FORAGE; a.pose = 1; a.t = rnd() * 3;
      }, keep);
    } else if (s === SJ || s === ST) {   // a family group around a home tree (oaks; pines for the Steller's jay)
      const home = s === ST ? this.nearestConifer(x, z, 60) : this.nearestOak(x, z, 60); if (!home) return;
      const n = 2 + Math.floor(rnd() * 3), g = { home, tree: home, leader: null, move: 0, t: 4 + rnd() * 15, ground: false };
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.group = g; a.rank = m; if (!m) g.leader = a; a.anchor = home; a.tree = home;
        this.jaySpot(a, home, false); a.x = a.tx; a.y = a.ty; a.z = a.tz;
        a.state = J_PERCH; a.pose = 1; a.yaw = rnd() * TAU; a.t = rnd() * 4;
      }, keep);
    } else if (s === FX || s === CY) {   // a fox alone; a coyote alone or a pair
      const n = s === CY && rnd() < 0.4 ? 2 : 1, bed = s === FX ? this.nearestOak(x, z, 40) : null;
      const g = { hx: x, hz: z, leader: null, bx: bed ? bed.x + 1.5 : x, bz: bed ? bed.z - 1 : z };
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.group = g; a.rank = m; if (!m) g.leader = a;
        a.ox = m ? (rnd() - 0.5) * 4 : 0; a.oz = m ? -2 - rnd() * 3 : 0;
        this.mmStart(a, x, z);
      }, keep);
    } else if (s === RB) {   // one to three brush rabbits around a patch of cover (an oak if one is near, else the brush)
      const n = 1 + Math.floor(rnd() * rnd() * 3), o = this.nearestOak(x, z, 20);
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        const ang = rnd() * TAU, d = rnd() * 4;
        a.hx = (o ? o.x : x) + Math.cos(ang) * d; a.hz = (o ? o.z : z) + Math.sin(ang) * d;
        a.x = a.hx; a.z = a.hz; a.y = this.heights.atXZ(a.x, a.z); a.yaw = rnd() * TAU; a.size = 0.9 + rnd() * 0.15;
        a.state = B_FORM; a.t = rnd() * 6;
      }, keep);
    } else if (s === JR) {   // a jackrabbit, or two a few metres apart: each its own form, beside a shrub if one is near
      const n = rnd() < 0.3 ? 2 : 1;
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        let fx = x + (m ? (rnd() - 0.5) * 14 : 0), fz = z + (m ? (rnd() - 0.5) * 14 : 0);
        const sh = this.shrubSpot(fx, fz, 10); if (sh) { fx = sh.x; fz = sh.z; }
        a.hx = fx; a.hz = fz; a.x = fx; a.z = fz; a.yaw = rnd() * TAU; a.size = 0.92 + rnd() * 0.16; a.u1 = rnd(); a.peak = 1;
        a.state = JK_FORM; a.t = rnd() * 8; a.pose = JACK.hunch;
        if (this.jkActive(a)) {   // spawned at night: already out on its feeding ground
          const ang = rnd() * TAU, d = JACK.out[0] + rnd() * (JACK.out[1] - JACK.out[0]);
          a.bx = fx + Math.cos(ang) * d; a.bz = fz + Math.sin(ang) * d;
          if (this.landOK(a.bx, a.bz)) { a.x = a.bx; a.z = a.bz; a.state = JK_FEED; a.pose = 0; a.t = rnd() * 4; }
        }
        a.y = this.heights.atXZ(a.x, a.z);
      }, keep);
    } else if (s === TK) {   // a flock of 6-15 wild turkeys: hens (0.8 scale, the hen colours) and toms
      const n = 6 + Math.floor(rnd() * 10);
      const g = { x, z, hx: x, hz: z, tx: x, tz: z, state: TF_FORAGE, t: 5 + rnd() * 30, cool: 0, n, leader: null, tree: null, roost: false, ft: 0 };
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.group = g; a.rank = m; if (!m) g.leader = a;
        const ang = rnd() * TAU, d = Math.sqrt(rnd()) * TURKEY.spread;
        a.ox = Math.cos(ang) * d; a.oz = Math.sin(ang) * d;
        a.x = x + a.ox; a.z = z + a.oz; a.y = this.heights.atXZ(a.x, a.z); a.yaw = rnd() * TAU;
        a.variant = (seedOf(a.id, 0x7e4) % 100) < TURKEY.hen * 100 ? 1 : 0;   // hen
        a.size = (a.variant ? 0.8 : 1) * (0.95 + 0.1 * rnd());
        a.state = T_FORAGE; a.pose = 1; a.t = rnd() * 3;
      }, keep);
    } else if (s === GS) {   // a colony of 4-12 round 3-6 burrow mouths
      const nb = GSQ.burrows[0] + Math.floor(rnd() * (GSQ.burrows[1] - GSQ.burrows[0] + 1)), burrows = [];
      for (let b = 0; b < nb * 3 && burrows.length < nb; b++) {
        const ang = rnd() * TAU, d = 1 + rnd() * 4, bx = x + Math.cos(ang) * d, bz = z + Math.sin(ang) * d;
        if (this.landOK(bx, bz)) burrows.push({ x: bx, z: bz, y: 0, yaw: rnd() * TAU });
      }
      if (!burrows.length) return;
      const n = GSQ.members[0] + Math.floor(rnd() * (GSQ.members[1] - GSQ.members[0] + 1));
      const g = { x, z, burrows, state: C_OK, t: 0, sentinel: null, watch: 5 + rnd() * 20, leader: null, threat: 0 };
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        a.group = g; a.rank = m; if (!m) g.leader = a;
        const b = burrows[m % burrows.length], ang = rnd() * TAU, d = rnd() * 4;
        a.hb = b; a.x = b.x + Math.cos(ang) * d; a.z = b.z + Math.sin(ang) * d; a.y = this.heights.atXZ(a.x, a.z);
        a.yaw = rnd() * TAU; a.size = 0.85 + rnd() * 0.25; a.state = G_FEED; a.t = rnd() * 3;
      }, keep);
    } else if (s === LZ) {   // fence lizards at the cell's rocks and trunks (a male at each, a female or two near)
      const sites = this.lzSites(x, z, cx, cn, rnd);
      for (let k = 0, m = 0; k < sites.length; k++) {
        const site = sites[k], nf = rnd() < 0.5 ? 0 : 1 + (rnd() < 0.3 ? 1 : 0);
        for (let f = 0; f <= nf; f++, m++) this.add(`${base}:${m}`, s, rnd, a => {
          a.site = site; a.male = f === 0 ? 1 : 0; a.home = null; a.tries = 0; a.vis = 0;
          a.size = (a.male ? 1 : 0.85) * (0.9 + 0.2 * rnd()); a.x = site.x; a.z = site.z; a.y = this.heights.atXZ(site.x, site.z);
          a.state = L_BASK; a.t = rnd() * 2; a.next = LIZ.push[0] + rnd() * (LIZ.push[1] - LIZ.push[0]);
        }, keep);
      }
    } else if (s === VO) {   // a vole on its runway (two now and then): a 2-5 m track through the grass
      const n = rnd() < 0.3 ? 2 : 1;
      for (let m = 0; m < n; m++) this.add(`${base}:${m}`, s, rnd, a => {
        const ang = rnd() * TAU, L = 2 + rnd() * 3, cx = x + (rnd() - 0.5) * 6, cz = z + (rnd() - 0.5) * 6;
        a.sx = cx - Math.cos(ang) * L / 2; a.sz = cz - Math.sin(ang) * L / 2; a.tx = cx + Math.cos(ang) * L / 2; a.tz = cz + Math.sin(ang) * L / 2;
        a.u = rnd(); a.h = a.u; a.x = a.sx + (a.tx - a.sx) * a.u; a.z = a.sz + (a.tz - a.sz) * a.u; a.y = this.heights.atXZ(a.x, a.z); a.yaw = Math.atan2(a.tx - a.sx, a.tz - a.sz);
        a.state = VL_PAUSE; a.t = rnd() * 3;
      }, keep);
    } else {
      // deer: a herd of 3-6 around a leader doe; about one follower in three is a buck (its own slot, BK)
      const n = 3 + Math.floor(rnd() * 4), g = { hx: x, hz: z, leader: null, wx: x, wz: z };
      for (let m = 0; m < n; m++) {
        const id = `${base}:${m}`, buck = m > 0 && (this._forceBuck || (seedOf(id, 0xb0c) % 1000) < 300);
        this.add(id, buck ? BK : s, rnd, a => {
          a.group = g; a.rank = m; a.ox = m ? (rnd() - 0.5) * 9 : 0; a.oz = m ? (rnd() - 0.5) * 9 : 0;
          if (!m) g.leader = a;
          a.x = x + a.ox; a.z = z + a.oz; a.yaw = rnd() * TAU; a.state = D_GRAZE; a.t = rnd() * 10;
          if (buck) { const h = seedOf(id, 0xa47); a.u1 = (h & 1023) / 1023; a.u2 = ((h >>> 10) & 1023) / 1023; a.u3 = ((h >>> 20) & 1023) / 1023; a.young = (seedOf(id, 0x7e5) % 100) < 35 ? 1 : 0; if (a.young) a.size *= 0.94; }
        }, keep);
      }
    }
  }
  add(id, s, rnd, init, keep) {
    keep.add(id);
    if (this.held.has(id)) return;   // the player is in it (take)
    const old = this.byId.get(id);
    if (old) return;   // still live: keeps its state
    const seed = (rnd() * 4294967296) >>> 0;
    const a = {
      id, sp: s, slot: -1, rng: mulberry32(seed), size: 0.9 + rnd() * 0.2,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, lift: 0,
      state: 0, t: 0, u: 0, dur: 1, speed: 0, next: 0,
      phase: rnd() * TAU, amp: 0, pose: 0, flick: 0, flickV: 0,
      sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, arc: 0,
      anchor: null, tree: null, face: 0, h: 0, scared: 0,
      hx: 0, hz: 0, cx: 0, cz: 0, R: 50, alt: 80, dir: 1, th: 0, flapT: 0,
      group: null, ox: 0, oz: 0, rank: 0, air: 0, fly: 0, acc: 0, wait: 0, moveSeen: 0, peak: 0, V: 10, rock: 0,
      e0: 0, e1: 0, variant: s === QU ? seedOf(id, 0x5e7) & 1 : 0,   // aAnim2 (drawn meshes); the quail's sex
      hopU: 1, hopX: 0, hopZ: 0, hopDX: 0, hopDZ: 0, hopH: 0,         // scrub-jay ground hop
      hFrac: 0.5,                                                      // Steller's jay: perch height in the crown (fraction of the tree)
      e2: 0, e3: 0, vis: 1, culled: false, next2: 0, cool: 0, zig: 0, zigT: 0,   // mammals (aAnim2.z, .w; hidden; pounce lift)
      u1: 0.5, u2: 0.5, u3: 0.5, young: 0,                             // buck: antler calendar jitter, forked-horn
      task: 0, acorn: null, carry: 0, ep: -1, bx: 0, bz: 0, cid: null, work: 0,   // acorn game collector
      raidOak: null, raidH: 0, fleeOak: null, offT: 0, eatT: 0, guard: null, mob: null, mobT: 0, dive: 0,   // v4: raids, guards, mobbing
      gm: 0, wfV: 0, wing: 0, look: 0, hopping: 0, after: 0, afterT: 0, perchY: null, perchTop: false, hop0: 0, tRest: 0,   // raven on the ground (ground model)
    };
    init(a);
    this.byId.set(id, a);
  }

  // ---- squirrel -----------------------------------------------------------------------------------
  sqStart(a) {
    const o = a.tree, r = a.rng;
    if (r() < (this.season === 'fall' ? 0.25 : 0.45)) {   // start up in the crown
      const rec = this.sqWood(o), k = rec ? Math.floor(r() * rec.sqLimbs.length) : -1, p = rec && this.sqPath(rec, -1, k);
      if (p) {   // out on a limb of the drawn wood
        a.path = p; a.prec = rec; a.limb = k; a.pdir = 1; a.pu = p.len; a.pi = 0; this.sqFollow(a, 0, 0);
        a.state = S_SIT; a.t = 3 + r() * 20; a.pose = 0.6; return;
      }
      a.path = null; a.face = r() * TAU; this.sqBranch(a); a.state = S_SIT; a.t = 3 + r() * 20; a.pose = 1;
      a.x = a.tx; a.y = a.ty; a.z = a.tz; a.pitch = -0.5;
    } else {
      const ang = r() * TAU, d = Math.sqrt(r()) * (3 + 3 * o.scale);
      a.x = o.x + Math.cos(ang) * d; a.z = o.z + Math.sin(ang) * d; a.y = this.heights.atXZ(a.x, a.z);
      a.yaw = r() * TAU; a.state = S_PAUSE; a.t = r() * 3;
    }
  }
  sqBranch(a) {   // a sitting place out on a limb, just above the fork
    const o = a.tree, r = a.rng, fh = forkHeight(o), t = trunkAt(o, fh, this._t);
    const d = (1.0 + r() * 1.6) * o.scale, hh = 0.3 + r() * 0.9;
    a.tx = t.x + Math.sin(a.face) * d; a.ty = t.y + hh; a.tz = t.z + Math.cos(a.face) * d;
  }
  sqRunTo(a, x, z, speed, next) {
    a.tx = x; a.tz = z; a.speed = speed; a.next = next; a.state = S_RUN; a.via = false;
    a.yaw = Math.atan2(x - a.x, z - a.z);
  }
  // Run to the trunk base and climb. With the drawn wood known (sqWood): up the trunk and out along a limb (sqPath),
  // a scared one out the limb on the far side of the trunk from the player; running round the trunk's foot to the
  // limb's side first. Otherwise (a raid; wood not known) up the trunk on the side facing us to the fork, as before.
  sqToTrunk(a, speed) {
    const o = a.tree, r = a.rng; a.face = Math.atan2(a.x - o.x, a.z - o.z);
    const rec = a.task === T_RAID ? null : this.sqWood(o);
    if (rec) {
      const L = rec.sqLimbs, P = this.flight.pos;
      let k = Math.floor(r() * L.length);
      if (a.scared) {
        const px = P.x - o.x, pz = P.z - o.z, pl = Math.hypot(px, pz) || 1;
        let bv = Infinity;
        L.forEach((l, i) => { const v = (l.hx * px + l.hz * pz) / pl + 0.3 * r(); if (v < bv) { bv = v; k = i; } });
      }
      const p = this.sqPath(rec, -1, k);
      if (p) {
        a.path = p; a.prec = rec; a.limb = k; a.pdir = 1; a.pu = 0; a.pi = 0;
        const t = trunkAt(o, 0, this._t), x = p.pts[0], z = p.pts[2];
        this.sqRunTo(a, x, z, speed, S_CLIMB);
        // the straight way passes the trunk: first round its foot on our side
        const ex = x - a.x, ez = z - a.z, e2 = ex * ex + ez * ez, u = e2 > 1e-6 ? Math.max(0, Math.min(1, ((t.x - a.x) * ex + (t.z - a.z) * ez) / e2)) : 0;
        const R = t.r + 0.35;
        if (Math.hypot(a.x + ex * u - t.x, a.z + ez * u - t.z) < R) {
          const side = Math.sign(Math.sin(Math.atan2(x - t.x, z - t.z) - a.face)) || 1, ang = a.face + side * Math.PI / 2;
          a.vx = x; a.vz = z; a.via = true; a.tx = t.x + Math.sin(ang) * R; a.tz = t.z + Math.cos(ang) * R; a.yaw = Math.atan2(a.tx - a.x, a.tz - a.z);
        }
        return;
      }
    }
    a.path = null;
    const t = trunkAt(o, 0, this._t), rr = t.r + 0.06;
    this.sqRunTo(a, t.x + Math.sin(a.face) * rr, t.z + Math.cos(a.face) * rr, speed, S_CLIMB);
  }

  // ---- squirrel in the canopy: the drawn wood (perch.js) ------------------------------------------
  // The tree's wood as perch.js knows it (the near set's instance of this oak), with the limbs a squirrel goes out on
  // (sqLimbs) and its paths (sqPaths), both cached on the record; null when the wood is not known (the trunk-and-fork
  // climb then). Limbs: off the bole or the main stem's wood, at least 3 cm thick at the base, with a metre or more of
  // wood 2 cm thick, ending 2 m or more above the ground, not steeper than ~44 degrees there, reaching 0.5 m out.
  sqWood(o) {
    const Q = this.flight.perchQuery?.(); if (!Q) return null;
    let rec = o.prec;
    if (!rec || Q.byKey.get(rec.key) !== rec) rec = o.prec = Q.recAt(o.x, o.z);
    if (!rec) return null;
    if (!rec.sqLimbs) {
      const stems = Q.joins(rec), fk = Q.fork(rec), L = [], q = {};
      rec.sqRoot = fk ? fk.st : null; rec.sqPaths = new Map();
      if (fk) for (const st of stems) {
        if (!st.par) continue;
        const b = Q.baseS(st), e = Q.thinEnd(st, 0.02) - 0.1;
        if (st.rad[0] < 0.03 || e - b < 1) continue;
        Q.at(st, e, q);
        if (q.y - this.heights.atXZ(q.x, q.z) < 2 || Math.abs(q.dy) > 0.7) continue;
        const hx = q.x - rec.x, hz = q.z - rec.z, h = Math.hypot(hx, hz); if (h < 0.5) continue;
        L.push({ st, s: e, hx: hx / h, hz: hz / h });
      }
      rec.sqLimbs = L;
    }
    return rec.sqLimbs.length ? rec : null;
  }
  // The path along the wood (perch.js route) from the ground (-1) or limb `from` to limb `to`, cached per tree: the feet
  // on the bark every 0.25 m at most, on the side away from the trunk (on top of a limb; on the trunk, the limb's side)
  // and the way out of the bark there: { pts, ups, cum, len }.
  sqPath(rec, from, to) {
    const key = from * 1000 + to; let p = rec.sqPaths.get(key); if (p !== undefined) return p;
    const Q = this.flight.perchQuery(), L = rec.sqLimbs, end = k => k < 0 ? { st: rec.sqRoot, s: 0.35 } : L[k];
    const R = Q.route(rec, end(from), end(to));
    if (!R || R.rad.length < 2) { rec.sqPaths.set(key, null); return null; }
    const side = L[to], n = R.rad.length, A = R.pts, pts = new Float32Array(n * 3), ups = new Float32Array(n * 3), cum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = Math.min(i, n - 2), dx = A[j * 3 + 3] - A[j * 3], dy = A[j * 3 + 4] - A[j * 3 + 1], dz = A[j * 3 + 5] - A[j * 3 + 2], d2 = dx * dx + dy * dy + dz * dz || 1;
      const x = A[i * 3], y = A[i * 3 + 1], z = A[i * 3 + 2];
      let hx = x - rec.x, hz = z - rec.z; const h = Math.hypot(hx, hz);
      if (h < 0.8) { hx = side.hx; hz = side.hz; } else { hx /= h; hz /= h; }
      let px = hx, py = 0.8, pz = hz; const k = (px * dx + py * dy + pz * dz) / d2;
      px -= dx * k; py -= dy * k; pz -= dz * k; const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
      const rr = R.rad[i] + 0.015;
      pts[i * 3] = x + px * rr; pts[i * 3 + 1] = y + py * rr; pts[i * 3 + 2] = z + pz * rr; ups[i * 3] = px; ups[i * 3 + 1] = py; ups[i * 3 + 2] = pz;
      if (i) cum[i] = cum[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]);
    }
    p = { pts, ups, cum, len: cum[n - 1] }; rec.sqPaths.set(key, p);
    return p;
  }
  // Along a.path at `speed` m/s in a.pdir (+1 out, -1 back): position, the body set by the bark (forward along the path,
  // up out of it: Euler from the basis), the bound. True at the path's end.
  sqFollow(a, dt, speed) {
    const p = a.path, C = p.cum, n = C.length;
    a.pu = Math.max(0, Math.min(p.len, a.pu + a.pdir * speed * dt));
    let i = Math.min(a.pi, n - 2); while (i < n - 2 && C[i + 1] < a.pu) i++; while (i > 0 && C[i] > a.pu) i--; a.pi = i;
    const L = C[i + 1] - C[i], t = L > 1e-6 ? (a.pu - C[i]) / L : 0, P = p.pts, U = p.ups, o = i * 3;
    a.x = P[o] + (P[o + 3] - P[o]) * t; a.y = P[o + 1] + (P[o + 4] - P[o + 1]) * t; a.z = P[o + 2] + (P[o + 5] - P[o + 2]) * t;
    if (L > 1e-4) {
      const F = this._sqF.set((P[o + 3] - P[o]) * a.pdir, (P[o + 4] - P[o + 1]) * a.pdir, (P[o + 5] - P[o + 2]) * a.pdir).normalize();
      const N = this._sqN.set(U[o] + (U[o + 3] - U[o]) * t, U[o + 1] + (U[o + 4] - U[o + 1]) * t, U[o + 2] + (U[o + 5] - U[o + 2]) * t);
      N.addScaledVector(F, -N.dot(F)).normalize();
      this._sqM.makeBasis(this._sqX.crossVectors(N, F), N, F); this._sqE.setFromRotationMatrix(this._sqM, 'YXZ');
      a.pitch = this._sqE.x; a.yaw = this._sqE.y; a.roll = this._sqE.z;
      a.splay = Math.abs(F.y) > 0.5 || N.y < 0.5 ? 1 : 0;
    }
    if (speed > 0) { a.amp = 1; a.phase += dt * TAU * (2.5 + 1.2 * speed); a.pose = 0; }
    return a.pdir > 0 ? a.pu >= p.len - 1e-4 : a.pu <= 1e-4;
  }
  // Back down from where it is on a path (the way it came), to the ground.
  sqDownPath(a) {
    if (a.limb >= 0 && a.path !== a.prec.sqPaths.get(-1000 + a.limb)) {   // out on a limb it went to from another: home path
      const p = this.sqPath(a.prec, -1, a.limb); if (p) { a.path = p; a.pu = p.len; a.pi = p.cum.length - 2; }
    }
    a.pdir = -1; a.state = S_IN; a.pose = 0;
  }
  sqOffPath(a) {   // at the foot of the trunk: onto the ground
    a.path = null; a.state = S_PAUSE; a.t = 1 + a.rng() * 2; a.pitch = 0; a.roll = 0; a.yaw = a.face + (a.rng() - 0.5) * 2; a.scared = 0; a.splay = 0;
    a.y = this.heights.atXZ(a.x, a.z);
  }
  sqUpdate(a, dt, px, py, pz) {
    const r = a.rng, H = this.heights;
    if (a.guard) { this.sqGuard(a, dt); return; }   // v4: off to its dug-up cache, or after the thief
    if (a.fleeOak) this.fleeing(a);
    const dx = a.x - px, dy = a.y - py, dz = a.z - pz, near2 = dx * dx + dy * dy + dz * dz;
    // (a player squirrel, squirrelControl.js, is one of them: it does not send them up the trees by being near)
    // (a player squirrel only when it runs at one: within 4 m at over 2.5 m/s, on the ground: a chase)
    const pSq = this.observer === SPECIES[SQ].code, chase = pSq && near2 < 4 * 4 && (this.flight.speed || 0) > 2.5 && Math.abs(dy) < 1.5;
    if ((a.state === S_PAUSE || a.state === S_WORK || a.state === S_EAT || (a.state === S_RUN && a.next !== S_CLIMB)) && near2 < 15 * 15 && (!pSq || chase)) {
      if (a.task !== T_STORE) this.dropTask(a);   // an acorn it holds goes up the tree with it
      if (a.state === S_EAT) a.carry = 0;          // (dropped while eating)
      a.tree = this.nearestOak(a.x, a.z, 30) || a.anchor; a.scared = 1;
      this.sqToTrunk(a, 4.5);
    }
    a.t -= dt;
    switch (a.state) {
      case S_PAUSE: {
        a.amp = damp(a.amp, 0, 10, dt); a.pose = damp(a.pose, 0.15, 4, dt); a.pitch = damp(a.pitch, 0, 6, dt);
        if (r() < dt * 1.2) a.flickV = 1;   // tail flicks and a dip of the head
        a.y = H.atXZ(a.x, a.z);
        if (a.t <= 0 && this.gameOn(a) && this.sqCollect(a)) break;
        if (a.t <= 0) {
          const fall = this.season === 'fall', q = r(), o = a.tree;
          if (q < (fall ? 0.7 : 0.45)) {   // forage: a hop to another spot under this oak
            const ang = r() * TAU, d = Math.sqrt(r()) * (2 + 3.5 * o.scale);
            const x = o.x + Math.cos(ang) * d, z = o.z + Math.sin(ang) * d, dd = Math.hypot(x - a.x, z - a.z);
            this.sqRunTo(a, x, z, dd > 2 ? 3 : 1.5, S_PAUSE);
          } else if (q < (fall ? 0.86 : 0.65)) {   // over to another oak in the home range
            const o2 = this.randomOak(a.anchor.x, a.anchor.z, 40, r, o) || a.anchor;
            a.tree = o2; const ang = r() * TAU, d = (1 + r() * 2.5) * o2.scale;
            this.sqRunTo(a, o2.x + Math.cos(ang) * d, o2.z + Math.sin(ang) * d, 3, S_PAUSE);
          } else this.sqToTrunk(a, 2.5);   // up the tree
        }
        break;
      }
      case S_RUN: {
        const ex = a.tx - a.x, ez = a.tz - a.z, d = Math.hypot(ex, ez), step = a.speed * dt;
        a.amp = damp(a.amp, 1, 12, dt); a.pose = damp(a.pose, 0, 10, dt);
        a.phase += dt * TAU * a.speed / 0.42;
        a.yaw = Math.atan2(ex, ez);
        if (d <= step) {
          a.x = a.tx; a.z = a.tz;
          if (a.via) { a.via = false; a.tx = a.vx; a.tz = a.vz; a.y = H.atXZ(a.x, a.z); break; }   // round the trunk's foot, then on
          if (a.next === S_CLIMB) { a.state = S_CLIMB; a.h = 0; if (a.path) { a.pu = 0; a.pi = 0; a.pdir = 1; } }
          else if (a.task) {   // at the acorn, the burying spot or the cache: to work
            a.state = S_WORK; a.work = a.task;
            a.t = a.task === T_GET ? 0.5 + r() * 0.4 : a.task === T_STORE ? 2.2 + r() * 1.2 : 1.6 + r();
          } else { a.state = S_PAUSE; a.t = (this.season === 'fall' ? 2 : 1) + r() * 4; }
        } else { a.x += ex / d * step; a.z += ez / d * step; }
        a.y = H.atXZ(a.x, a.z) + Math.abs(Math.sin(a.phase)) * 0.05 * a.amp;
        break;
      }
      case S_CLIMB: case S_DOWN: {
        if (a.path) {   // up the trunk and out along the limb, then sits (a scared one freezes)
          if (this.sqFollow(a, dt, a.scared ? 2.4 : 1.4)) { a.state = S_SIT; a.t = a.scared ? 15 + r() * 25 : 5 + r() * 20; }
          break;
        }
        const up = a.state === S_CLIMB, fh = forkHeight(a.tree), v = a.scared ? 2.2 : 1.3;
        a.h += (up ? v : -1.1) * dt;
        a.amp = 1; a.phase += dt * TAU * 3.5; a.pose = 0;
        a.pitch = up ? -Math.PI / 2 : Math.PI / 2; a.yaw = up ? a.face + Math.PI : a.face;
        const t = trunkAt(a.tree, Math.max(0, Math.min(a.h, fh)), this._t), rr = t.r + 0.06;
        a.x = t.x + Math.sin(a.face) * rr; a.y = t.y; a.z = t.z + Math.cos(a.face) * rr;
        if (up && a.task === T_RAID && a.h >= a.raidH) { a.state = S_RAIDP; a.t = 1.8 + r() * 0.8; a.wait = 7; }   // v4: at the granary's holes
        else if (up && a.h >= fh) { this.sqBranch(a); a.sx = a.x; a.sy = a.y; a.sz = a.z; a.u = 0; a.state = S_OUT; }
        else if (!up && a.h <= 0) { a.state = S_PAUSE; a.t = 1 + r() * 2; a.pitch = 0; a.yaw = a.face + (r() - 0.5) * 2; a.scared = 0; }
        break;
      }
      case S_OUT: case S_IN: {
        if (a.path) {   // out to another limb (S_OUT), or back along the way it came and down (S_IN)
          if (this.sqFollow(a, dt, a.state === S_IN ? (a.scared ? 2.2 : 1.4) : 1.6)) {
            if (a.state === S_OUT) { a.state = S_SIT; a.t = 4 + r() * 16; } else this.sqOffPath(a);
          }
          break;
        }
        a.u = Math.min(1, a.u + dt / 1.1);
        const k = a.u; a.amp = 1; a.phase += dt * TAU * 4;
        a.x = a.sx + (a.tx - a.sx) * k; a.y = a.sy + (a.ty - a.sy) * k; a.z = a.sz + (a.tz - a.sz) * k;
        a.yaw = Math.atan2(a.tx - a.sx, a.tz - a.sz); a.pitch = -0.15;
        if (a.u >= 1) {
          if (a.state === S_OUT) { a.state = S_SIT; a.t = a.scared ? 15 + r() * 25 : 5 + r() * 20; }
          else { a.state = S_DOWN; a.h = forkHeight(a.tree); }
        }
        break;
      }
      case S_WORK: {   // nose down and paws going: working an acorn free, digging a hole and tamping it, digging one up
        const pick = a.work === T_GET;
        a.amp = damp(a.amp, pick ? 0 : 0.35, 10, dt); a.pose = damp(a.pose, 0, 6, dt); a.pitch = damp(a.pitch, 0.15, 6, dt);
        if (!pick) a.phase += dt * TAU * 4.5;
        a.flick = pick ? damp(a.flick, 0.9, 10, dt) : 0.45 + 0.45 * Math.sin(this.time * 15 + a.phase * 0.1);
        a.y = H.atXZ(a.x, a.z);
        if (a.t <= 0) this.sqWorkDone(a);
        break;
      }
      case S_RAIDP: {  // v4: on a granary's trunk, working an acorn out of a hole
        a.amp = damp(a.amp, 0, 10, dt); a.pose = 0; a.pitch = -Math.PI / 2; a.yaw = a.face + Math.PI;
        a.flick = 0.4 + 0.4 * Math.sin(this.time * 14);
        this.raidStep(a, dt, () => { a.state = S_DOWN; });
        break;
      }
      case S_EAT: {    // sitting up with it, nibbling
        a.amp = damp(a.amp, 0, 10, dt); a.pose = damp(a.pose, 1, 4, dt); a.pitch = damp(a.pitch, 0, 4, dt);
        a.flick = 0.25 + 0.25 * Math.sin(this.time * 11);
        a.y = H.atXZ(a.x, a.z);
        if (a.t <= 0) { a.carry = 0; a.state = S_PAUSE; a.t = 1 + r() * 2; }
        break;
      }
      case S_SIT: {
        if (a.path) {   // on a limb: sitting up and looking about, or (scared) frozen flat along it
          a.amp = damp(a.amp, 0, 8, dt); a.pose = damp(a.pose, a.scared ? 0 : 0.6, 3, dt);
          if (!a.scared && r() < dt * 0.5) a.flickV = 1;
          if (near2 < 20 * 20) a.t = Math.max(a.t, 4);
          if (a.t > 0) break;
          const L = a.prec.sqLimbs;
          if (!a.scared && L.length > 1 && r() < 0.45) {   // foraging: along the wood to another limb
            let k = Math.floor(r() * (L.length - 1)); if (k >= a.limb) k++;
            const p = this.sqPath(a.prec, a.limb, k);
            if (p) { a.path = p; a.limb = k; a.pdir = 1; a.pu = 0; a.pi = 0; a.state = S_OUT; break; }
          }
          this.sqDownPath(a);
          break;
        }
        a.amp = damp(a.amp, 0, 8, dt); a.pose = damp(a.pose, 1, 3, dt); a.pitch = damp(a.pitch, -0.55, 3, dt);
        if (r() < dt * 0.5) a.flickV = 1;
        if (r() < dt * 0.15) a.yaw += (r() - 0.5) * 1.5;   // looks around
        if (near2 < 20 * 20) a.t = Math.max(a.t, 4);      // stays put while the raven is close
        if (a.t <= 0) {   // back along the limb to the trunk, then down
          const t = trunkAt(a.tree, forkHeight(a.tree), this._t), rr = t.r + 0.06;
          a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tx = t.x + Math.sin(a.face) * rr; a.ty = t.y; a.tz = t.z + Math.cos(a.face) * rr;
          a.u = 0; a.state = S_IN; a.pose = 0;
        }
        break;
      }
    }
  }

  // Acorn game: the squirrel's part at a pause. Carrying: off to bury it, 4-30 m from where it was found. Otherwise
  // now and then back to a buried one (any squirrel's: they pilfer each other), or out to the nearest free acorn
  // on the ground within 40 m. True when it chose.
  sqCollect(a) {
    const r = a.rng, G = this.game;
    if (a.carry && a.task !== T_DIG) {
      let x = a.x, z = a.z;
      for (let k = 0; k < 5; k++) {
        const ang = r() * TAU, d = 4 + r() * 26;
        x = a.bx + Math.cos(ang) * d; z = a.bz + Math.sin(ang) * d;
        if (this.landOK(x, z)) break;
      }
      a.task = T_STORE; this.sqRunTo(a, x, z, 2.8, S_PAUSE); return true;
    }
    const se = this.season;
    if (this.time > a.offT && r() < (RAID_ODDS.sq[se] || 0)) {   // v4: up a granary's trunk for one of the woodpeckers' acorns
      const o = this.granaryNear(a.x, a.z, 25);
      if (o) {
        a.task = T_RAID; a.tree = o; a.raidOak = o; a.raidH = Math.min(forkHeight(o) * 0.9, 1.1 + r() * 1.4);
        this.sqToTrunk(a, 3); return true;
      }
    }
    if (r() < (se === 'winter' ? 0.25 : se === 'fall' ? 0.06 : 0.12)) {
      const k = G.cacheNear(a.x, a.z, 30, 'scatter');
      if (k) { a.cid = k.id; a.task = T_DIG; this.sqRunTo(a, k.x, k.z, 2.5, S_PAUSE); return true; }
    }
    if (r() >= (FORAGE[SQ][se] || 0.1)) return false;
    const ac = this.findAcorn(a.x, a.z, 40, r, true, false, true); if (!ac) return false;
    this.claim(a, ac);
    const ex = a.x - ac.x, ez = a.z - ac.z, e = Math.hypot(ex, ez) || 1;   // stop with the nose at it
    this.sqRunTo(a, ac.x + ex / e * 0.3, ac.z + ez / e * 0.3, 3, S_PAUSE);
    return true;
  }
  sqWorkDone(a) {
    const r = a.rng, G = this.game, task = a.work; a.work = 0;
    a.state = S_PAUSE; a.t = 0.3 + r() * 0.5;
    if (!this.gameOn(a)) return;
    if (task === T_GET) {
      if (this.takeAcorn(a)) { a.bx = a.x; a.bz = a.z; } else a.task = 0;
    } else if (task === T_STORE) {
      if (a.carry && G.bury(a.id, a.x, a.y, a.z, 'scatter')) a.carry = 0;
      a.task = 0; a.t = 1 + r() * 2;
    } else if (task === T_DIG) {
      a.task = 0;
      // dug up and eaten on the spot; someone else's, half the time carried off and buried again elsewhere (v4)
      const k = G.world.caches.find(c => c.id === a.cid), keep = !!k && k.by !== a.id && r() < 0.5;
      if (keep) G.collector(a.id, SPECIES[SQ].code).carrying = a.carry;
      if (G.dig(a.id, a.cid, keep)) {
        a.carry = 1;
        if (keep) { a.bx = a.x; a.bz = a.z; a.t = 0.3; } else { a.state = S_EAT; a.t = 4 + r() * 3; }
      }
    }
  }

  // ---- woodpecker ---------------------------------------------------------------------------------
  wpStart(a, m) {
    const r = a.rng, o = m === 0 || r() < 0.5 ? a.anchor : (this.randomOak(a.anchor.x, a.anchor.z, 45, r) || a.anchor);
    if (r() < 0.25) this.wpPlaceTop(a, o); else this.wpPlaceCling(a, o, r() * TAU);
    a.x = a.tx; a.y = a.ty; a.z = a.tz; a.state = a.next; a.t = r() * 8; a.pose = 1;
    a.yaw = a.state === W_CLING ? a.face + Math.PI : r() * TAU; a.pitch = a.state === W_CLING ? CLING_PITCH : -0.35;
  }
  wpPlaceCling(a, o, face) {
    const r = a.rng, top = Math.min(forkHeight(o) * 0.95, 6), h = 1.2 + r() * Math.max(0.3, top - 1.2);
    const t = trunkAt(o, h, this._t), rr = t.r + 0.02;
    a.tree = o; a.h = h; a.face = face;
    a.tx = t.x + Math.sin(face) * rr; a.ty = t.y; a.tz = t.z + Math.cos(face) * rr; a.next = W_CLING;
  }
  wpPlaceTop(a, o) {
    const r = a.rng, ang = r() * TAU, d = r() * 1.2 * o.scale;
    a.tree = o; a.tx = o.x + Math.cos(ang) * d; a.tz = o.z + Math.sin(ang) * d; a.ty = o.y + treeHeight(o) * 0.96; a.next = W_TOP;
  }
  wpFly(a, o, toTop) {
    a.sx = a.x; a.sy = a.y; a.sz = a.z;
    if (toTop) this.wpPlaceTop(a, o);
    else this.wpPlaceCling(a, o, Math.atan2(a.x - o.x, a.z - o.z) + (a.rng() - 0.5));
    this.wpLaunch(a);
  }
  // Fly to a point (an acorn: in the lower branches, or on the ground) and land in state `next`.
  wpFlyTo(a, x, y, z, next) {
    a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tx = x; a.ty = y; a.tz = z; a.next = next;
    this.wpLaunch(a);
  }
  wpLaunch(a) {
    const d = Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz), long = d > 40;
    // long flights between granaries go up over the crowns, in deeper undulations
    a.dur = Math.max(0.5, d / (long ? 9.5 : 8)); a.arc = long ? Math.min(14, 5 + d * 0.06) : Math.min(4, d * 0.12) + 0.3;
    a.peak = long ? 0.7 : 0.25; a.u = 0; a.state = W_FLY; a.speed = d;
  }
  wpUpdate(a, dt, px, py, pz) {
    const r = a.rng; a.t -= dt;
    if (a.state === W_MOB) { this.wpMob(a, dt); return; }
    if (a.state === W_FLY) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, d = a.speed;
      const ox = a.x, oy = a.y, oz = a.z;
      a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u;
      a.y = a.sy + (a.ty - a.sy) * u + a.arc * Math.sin(Math.PI * u) + a.peak * Math.sin(u * d / (a.peak > 0.5 ? 6 : 2.5) * TAU) * Math.sin(Math.PI * u);
      a.air = 1;
      // bounding flight: bursts of quick beats with the wings shut between them; flap through take-off and landing
      const burst = u < 0.15 || u > 0.8 || Math.sin(this.time * TAU * 2.2 + a.phase * 0.1) > -0.2;
      a.amp = damp(a.amp, burst ? 1 : 0, 20, dt); a.pose = damp(a.pose, burst ? 0 : 0.8, 20, dt);
      a.phase += dt * TAU * 13;
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = u > 0.85 && a.next === W_CLING ? damp(a.pitch, CLING_PITCH, 10, dt) : -Math.atan2(vy, vh + 1e-5) * 0.7;
      a.flick = 0;
      if (u >= 1) {
        a.state = a.next; a.amp = 0; a.air = 0;
        a.t = a.state === W_CLING ? (a.tree === a.anchor && this.season === 'fall' ? 6 : 3) + r() * 9 : 4 + r() * 10;
        if (a.state === W_CLING) a.yaw = a.face + Math.PI;
        if (a.state === W_PICK) a.t = 0.7 + r() * 0.6;                                   // a few pecks to work it free
        else if (a.task === T_STORE && a.carry && a.tree === a.anchor) a.t = 1.6 + r() * 1.4;   // hammer it into the granary
      }
      return;
    }
    a.amp = damp(a.amp, 0, 10, dt); a.pose = damp(a.pose, 1, 8, dt); a.air = 0;
    // in a game they let the player watch from closer; a player woodpecker (woodpeckerControl.js) is one of them: it
    // flushes none of them, at its granary or anywhere
    const game = this.gameOn(a), fr = this.observer === SPECIES[WP].code ? 0 : game ? 5 : 8;
    const dx = a.x - px, dy = a.y - py, dz = a.z - pz, flush = fr > 0 && this.danger(a.sp, a, Math.sqrt(dx * dx + dy * dy + dz * dz), fr);
    if (a.state === W_CLING) {
      a.pitch = damp(a.pitch, CLING_PITCH, 8, dt); a.yaw = a.face + Math.PI;
      // pecking: drilling and wedging acorns at the granary in fall, probing bark otherwise
      const granaryFall = a.tree === a.anchor && this.season === 'fall';
      if (a.task === T_STORE && a.carry && a.tree === a.anchor) a.flickV = Math.max(a.flickV, 1);   // hammering it home
      else if (r() < dt * (granaryFall ? 1.2 : 0.5)) a.flickV = 1.6;
      a.flick = a.flickV > 0 ? Math.max(0, Math.sin(this.time * 38)) * Math.min(1, a.flickV) : 0;
      a.flickV -= dt;
      if (r() < dt * 0.15 && a.h < forkHeight(a.tree) * 0.85) {   // hitch up the trunk
        a.h += 0.25; const t = trunkAt(a.tree, a.h, this._t), rr = t.r + 0.02;
        a.x = t.x + Math.sin(a.face) * rr; a.y = t.y; a.z = t.z + Math.cos(a.face) * rr;
      }
    } else if (a.state === W_PICK) {   // at an acorn: bent to it, pecking
      a.pitch = damp(a.pitch, 0.45, 8, dt);
      if (r() < dt * 3) a.flickV = 0.8;
      a.flick = a.flickV > 0 ? Math.max(0, Math.sin(this.time * 20)) * Math.min(1, a.flickV) : damp(a.flick, 0, 6, dt);
      a.flickV -= dt;
    } else {   // W_TOP: a sentinel on the crown
      a.pitch = damp(a.pitch, -0.35, 6, dt); a.flick = damp(a.flick, 0, 6, dt);
      if (r() < dt * 0.4) a.yaw += (r() - 0.5) * 2;
    }
    if (flush && a.task === T_GET) this.dropTask(a);
    // v4: in a game the family goes out gathering together in cycles (famAway) and keeps near home in between
    const inGame = !!this.game?.active, away = inGame && (a.t <= 0 || flush) && !!a.anchor && this.famAway(a.anchor.id);
    if ((a.t <= 0 || flush) && game && this.wpCollect(a, flush, away)) return;
    if (a.t <= 0 || flush) {
      if (away && !flush) { this.wpFly(a, this.nearAnchor(a, 25) ? this.awayOak(a) : (this.randomOak(a.x, a.z, 30, r, a.tree) || a.tree), false); return; }
      const q = r(), fall = this.season === 'fall';
      const far = !flush && !inGame && r() < (fall ? 0.18 : 0.12) ? (this.ringOak(a.x, a.z, 50, 150, r, true, a.tree) || this.ringOak(a.x, a.z, 50, 120, r, false, a.tree)) : null;
      if (far) this.wpFly(a, far, r() < 0.3);   // a long flight to a granary (or any oak) 50-150 m off
      else if (a.tree !== a.anchor && q < (fall ? 0.55 : 0.3)) this.wpFly(a, a.anchor, false);
      else if (q < 0.8 || flush) this.wpFly(a, this.randomOak(a.anchor.x, a.anchor.z, 45, r, a.tree) || a.anchor, false);
      else this.wpFly(a, r() < 0.5 ? a.tree : (this.randomOak(a.anchor.x, a.anchor.z, 45, r, a.tree) || a.anchor), true);
    }
  }

  // Acorn game: the woodpecker's part at a decision point. True when it chose (and started) what to do next.
  wpCollect(a, flush, away = false) {
    const r = a.rng, G = this.game;
    if (a.state === W_PICK && !flush && a.task === T_GET) {
      // home with it, or (the family out gathering) on to an oak away from the granary to wait with it
      if (this.takeAcorn(a)) { a.task = T_STORE; this.wpFly(a, away ? this.awayOak(a) : a.anchor, false); return true; }
      a.task = 0;   // someone was quicker: back to the usual round
      return false;
    }
    if (a.carry && a.task === T_STORE && a.state === W_CLING && a.tree === a.anchor && !flush) {
      const t = trunkAt(a.anchor, a.h, this._t);
      if (G.depositGranary(a.id, a.anchor.id, a.x + (a.x - t.x) * 0.5, a.y, a.z + (a.z - t.z) * 0.5)) a.carry = 0;
      else a.carry = G.world.collectors[a.id]?.carrying || 0;
      a.task = 0; a.t = 1 + r() * 4; a.flickV = 0;
      return true;
    }
    if (a.carry && away && !flush) {   // out gathering: it holds the acorn until the family goes home
      a.task = T_STORE;
      if (this.nearAnchor(a, 25)) this.wpFly(a, this.awayOak(a), false); else a.t = 2 + r() * 3;
      return true;
    }
    if (away && !flush && !a.carry && this.nearAnchor(a, 25)) { this.wpFly(a, this.awayOak(a), false); return true; }
    if (a.carry) { a.task = T_STORE; this.wpFly(a, a.anchor, false); return true; }   // flushed with it: back to the granary
    if (flush || r() >= (FORAGE[WP][this.season] || 0.1)) return false;
    const branch = r() < 0.7;   // mostly off the tree, as they do; the ground under it when the branches are bare
    const fx = away ? a.x : a.anchor.x, fz = away ? a.z : a.anchor.z, fr = away ? 60 : 150;   // out: near where it is
    const ac = this.findAcorn(fx, fz, fr, r, false, branch) || (branch && this.findAcorn(fx, fz, fr, r, false, false));
    if (!ac) return false;
    this.claim(a, ac);
    const ang = r() * TAU, ground = !ac.branch;
    const x = ac.x + Math.sin(ang) * 0.1, z = ac.z + Math.cos(ang) * 0.1;
    this.wpFlyTo(a, x, ground ? this.heights.atXZ(x, z) : ac.y - 0.05, z, W_PICK);
    return true;
  }

  // ---- raven --------------------------------------------------------------------------------------
  rvStart(a, cx, cz, R, alt, dir, th) {
    a.cx = cx; a.cz = cz; a.R = R; a.alt = alt; a.dir = dir; a.th = th; a.state = R_SOAR; a.t = 15 + a.rng() * 40;
    a.x = cx + R * Math.cos(th); a.z = cz + R * Math.sin(th); a.y = this.heights.atXZ(cx, cz) + alt;
  }
  rvUpdate(a, dt) {
    const r = a.rng, H = this.heights, V = 10, gm = this.meshOn(RV); a.t -= dt;
    a.flapT -= dt;
    a.air = a.state === R_PERCH || a.state === R_GROUND || a.state === R_WALK ? 0 : 1;
    if (a.state === R_SOAR) {
      if (a.carr && (a.carr.gone || a.carr.carrionUntil < this.time)) a.carr = null;
      if (!a.carr && this.carrion.length && this.time > (a.fedAt || 0) && r() < dt * 0.5) {   // carrion in sight: the circle moves over it
        const c = this.carrionNear(a.x, a.z, CARRION.scavR); if (c) { a.carr = c; a.hx = c.x; a.hz = c.z; a.alt = 18; a.t = 6 + r() * 8; }
      }
      if (a.carr && a.t <= 0 && Math.hypot(a.x - a.carr.x, a.z - a.carr.z) < 80) {   // down to it: a glide to the ground beside it
        const c = a.carr; a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tx = c.x + (r() - 0.5) * 3; a.tz = c.z + (r() - 0.5) * 3; a.ty = H.atXZ(a.tx, a.tz);
        a.task = 0; a.perchTop = false; a.arc = 0; a.fedAt = this.time + CARRION.t; a.carr = null; a.hx = a.cx; a.hz = a.cz;
        const d = Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz); a.dur = Math.max(1.5, d / V); a.u = 0; a.state = R_GLIDE;
        return;
      }
      // the centre drifts on the breeze and is pulled back toward home
      const hx = a.hx - a.cx, hz = a.hz - a.cz, hd = Math.hypot(hx, hz);
      a.cx += (0.6 + (hd > 120 ? hx / hd * 1.5 : 0)) * dt; a.cz += (0.3 + (hd > 120 ? hz / hd * 1.5 : 0)) * dt;
      a.th += a.dir * V / a.R * dt;
      a.x = a.cx + a.R * Math.cos(a.th); a.z = a.cz + a.R * Math.sin(a.th);
      const gy = H.atXZ(a.cx, a.cz) + a.alt + 5 * Math.sin(a.th * 0.5 + a.phase);
      a.y = damp(a.y, Math.max(gy, H.atXZ(a.x, a.z) + 25), 0.5, dt);
      const vx = -Math.sin(a.th) * a.dir, vz = Math.cos(a.th) * a.dir;
      a.yaw = Math.atan2(vx, vz);
      const lx = Math.cos(a.yaw), lz = -Math.sin(a.yaw), left = (a.cx - a.x) * lx + (a.cz - a.z) * lz;
      a.roll = damp(a.roll, (left > 0 ? -1 : 1) * Math.atan(V * V / (9.8 * a.R)) * 1.4, 2, dt);
      a.pitch = damp(a.pitch, 0, 2, dt);
      if (a.flapT <= 0 && r() < dt * 0.08) a.flapT = 1 + r() * 1.5;   // a few beats now and then
      a.amp = damp(a.amp, a.flapT > 0 ? 1 : 0, 6, dt); a.pose = damp(a.pose, 0, 4, dt);
      if (a.flapT > 0) a.phase += dt * TAU * 2.6; else a.phase = damp(a.phase, Math.round(a.phase / Math.PI) * Math.PI, 3, dt);
      a.flick = damp(a.flick, 0, 3, dt);
      if (a.t <= 0 && this.gameOn(a) && r() < (FORAGE[RV][this.season] || 0.1)) {   // acorn game: down for one on the ground
        const k = r() < 0.2 ? this.game.cacheNear(a.cx, a.cz, 150, null, a.id) : null;   // v4: or someone else's cache to rob
        if (k) {
          a.task = T_DIG; a.cid = k.id; a.tree = null;
          this.rvGlide(a, k.x + 0.3, k.z + 0.3, 0);
          return;
        }
        const ac = this.findAcorn(a.cx, a.cz, 150, r, true, false);
        if (ac) {
          this.claim(a, ac); a.tree = null;
          const ex = a.x - ac.x, ez = a.z - ac.z, e = Math.hypot(ex, ez) || 1;
          this.rvGlide(a, ac.x + ex / e * 0.35, ac.z + ez / e * 0.35, 0);
          return;
        }
      }
      if (a.t <= 0) {
        const o = r() < 0.35 ? this.randomOak(a.cx, a.cz, 140, r, null, 7) : null;
        if (o) {   // glide down to a treetop
          a.tree = o; a.sx = a.x; a.sy = a.y; a.sz = a.z; a.arc = 0; a.perchTop = true;
          a.tx = o.x + (r() - 0.5) * o.scale; a.tz = o.z + (r() - 0.5) * o.scale; a.ty = o.y + treeHeight(o) * 0.97;
          const d = Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz); a.dur = d / V; a.u = 0; a.state = R_GLIDE;
        } else a.t = 20 + r() * 40;
      }
    } else if (a.state === R_GLIDE || a.state === R_CLIMB) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, e = a.state === R_GLIDE ? 1 - (1 - u) * (1 - u) : u * u * (3 - 2 * u);   // glide: steep at first, flat on the approach
      const ox = a.x, oy = a.y, oz = a.z;
      a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u; a.y = a.sy + (a.ty - a.sy) * e + a.arc * Math.sin(Math.PI * u);
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw += wrapAngle(Math.atan2(vx, vz) - a.yaw) * (1 - Math.exp(-dt * 7));   // turns into the line (no snap off the ground)
      a.pitch = damp(a.pitch, -Math.atan2(vy, vh + 1e-5) * 0.6, 4, dt); a.roll = damp(a.roll, 0, 2, dt);
      const flap = a.state === R_CLIMB || u > 0.85 || a.arc > 0;   // (arc: a short low hop, flapped)
      a.amp = damp(a.amp, flap ? 1 : 0, 6, dt); a.pose = damp(a.pose, 0, 6, dt);
      if (flap) a.phase += dt * TAU * 3;
      if (u >= 1) {
        if (a.state === R_GLIDE && a.task) { a.state = R_GROUND; a.t = a.task === T_GET || a.task === T_DIG ? 1 + r() * 0.6 : 2.4 + r() * 1.2; a.pitch = 0; this.rvLand(a); }
        else if (a.state === R_GLIDE) { a.state = R_PERCH; a.t = 15 + r() * 35; a.pitch = 0; this.rvLand(a); }
        else { a.state = R_SOAR; a.th = Math.atan2(a.z - a.cz, a.x - a.cx); a.t = this.game?.active ? 8 + r() * 20 : 30 + r() * 60; }
      }
    } else if (a.state === R_GROUND) {   // on the ground at an acorn, or pushing one under a shrub (caching)
      // (the ground model leans in a little and pecks with its head; the procedural raven tips its whole body)
      a.amp = damp(a.amp, 0, 6, dt); a.pose = damp(a.pose, 1, 4, dt); a.roll = damp(a.roll, 0, 4, dt); a.pitch = damp(a.pitch, gm ? 0.12 : 0.3, 4, dt);
      a.y = H.atXZ(a.x, a.z); a.look = 0;
      if (r() < dt * 2.5) a.flickV = 1;   // pecks: working it loose, then poking it in and covering it
      if (a.t <= 0) this.rvGroundDone(a);
    } else if (a.state === R_WALK) {
      this.rvWalk(a, dt);
    } else {   // R_PERCH on a treetop, or standing on the ground (a beat before taking off, or a while when summoned)
      a.amp = damp(a.amp, 0, 6, dt); a.pose = damp(a.pose, 1, 3, dt); a.roll = damp(a.roll, 0, 4, dt); a.pitch = damp(a.pitch, -0.1, 3, dt);
      if (r() < dt * 0.3) a.flickV = 1;
      if (gm) {   // the ground model: glances about, flicks its wings, turns with a hop, walks or hops about and caches
        const ground = a.perchY === null;
        if (ground) a.y = H.atXZ(a.x, a.z);
        if (r() < dt * 0.6) a.look = r() < 0.3 ? 0 : (r() - 0.5) * 2;
        if (r() < dt * 0.07) a.wfV = 1;
        a.wing = a.t < 0.3 ? 0.75 : 0;   // the wings lift and open just before take-off
        if (a.t > 1.5) {
          if (r() < dt * 0.1) {   // turn round with a hop on the spot
            const yaw = a.yaw + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 1.2);
            this.rvStep(a, a.x + Math.sin(yaw) * 0.08, a.z + Math.cos(yaw) * 0.08, 1, R_PERCH, 0);
          } else if (ground && a.t > 4 && r() < dt * 0.04) {   // cache something beside a shrub, if one is close
            const spot = this.shrubSpot(a.x, a.z, 6), d = spot ? Math.hypot(spot.x - a.x, spot.z - a.z) : 0;
            if (d > 0.3) this.rvStep(a, spot.x, spot.z, d > 2 ? 1 : 0, R_GROUND, 2.4 + r() * 1.2);
          } else if (ground && r() < dt * 0.12) {   // a few steps, or a few hops
            const ang = a.yaw + (r() - 0.5) * 2.4, d = 0.4 + r() * 1.8, x = a.x + Math.sin(ang) * d, z = a.z + Math.cos(ang) * d;
            if (this.landOK(x, z)) this.rvStep(a, x, z, d > 1.2 && r() < 0.6 ? 1 : 0, R_PERCH, 0);
          }
        }
      } else if (r() < dt * 0.1) a.yaw += (r() - 0.5) * 2;
      if (a.t <= 0) {   // back up to a new circle near home
        if (gm) { a.pose = Math.min(a.pose, 0.55); a.wing = 0; a.look = 0; }   // the flying model starts half unfolded
        a.perchY = null;
        a.cx = a.hx + (r() - 0.5) * 120; a.cz = a.hz + (r() - 0.5) * 120; a.R = 35 + r() * 40;
        a.th = Math.atan2(a.z - a.cz, a.x - a.cx); a.alt = 50 + r() * 100;
        a.sx = a.x; a.sy = a.y; a.sz = a.z;
        a.tx = a.cx + a.R * Math.cos(a.th); a.tz = a.cz + a.R * Math.sin(a.th); a.ty = H.atXZ(a.cx, a.cz) + a.alt;
        a.dur = Math.max(4, Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz) / 7); a.u = 0; a.state = R_CLIMB; a.arc = 0;
      }
    }
  }

  // A glide (from a soar, arc 0) or a low flapped hop (arc > 0) to a point on the ground, as R_GLIDE.
  rvGlide(a, x, z, arc) {
    a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tx = x; a.tz = z; a.ty = this.heights.atXZ(x, z); a.arc = arc; a.perchTop = false;
    const d = Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz); a.dur = Math.max(1.2, d / (arc ? 7 : 10)); a.u = 0; a.state = R_GLIDE;
  }
  rvGroundDone(a) {
    const r = a.rng, G = this.game, task = a.task;
    a.task = 0;
    if (this.gameOn(a) && ((task === T_GET && this.takeAcorn(a)) || (task === T_DIG && this.rvDig(a)))) {   // got it: hop to a shrub to hide it
      const near = this.meshOn(RV) ? this.shrubSpot(a.x, a.z, 6) : null;
      const spot = near || this.cacheSpot(a.x, a.z, r), d = Math.hypot(spot.x - a.x, spot.z - a.z);
      a.task = T_STORE;
      // a shrub close by: on foot (the ground model: walks, or hops past 2 m); farther, a low flapped hop
      if (near || (this.meshOn(RV) && d < 6)) this.rvStep(a, spot.x, spot.z, d > 2 ? 1 : 0, R_GROUND, 2.4 + r() * 1.2);
      else this.rvGlide(a, spot.x, spot.z, Math.min(4, 1 + d * 0.1));
      return;
    }
    if (task === T_STORE && a.carry && this.gameOn(a) && G.bury(a.id, a.x, a.y, a.z, 'cache')) a.carry = 0;
    a.state = R_PERCH; a.t = 0.6 + r() * 1.2;   // a beat, then back up to the circle
    if (!task && a.tRest > 0) { a.t = a.tRest; a.tRest = 0; }   // cached on its own while standing about: stands on
  }
  // v4: dig up the cache it came down for (someone else's), to cache again; false when it is gone.
  rvDig(a) {
    const G = this.game; G.collector(a.id, SPECIES[RV].code).carrying = a.carry;
    if (!G.dig(a.id, a.cid, true)) return false;
    a.carry = 1; return true;
  }
  // Touchdown at the end of a glide (on the ground, or a treetop: perchY holds its height). The ground model takes over
  // here: its folded wings settle (a flick dying away) and the landing shuffle is short.
  rvLand(a) {
    a.perchY = a.perchTop ? a.y : null; a.perchTop = false;
    a.e0 = 0.9; a.wfV = 0; a.wing = 0; a.look = 0; a.e1 = 0; a.hopping = 0; a.e2 = 0;
    a.amp = Math.min(a.amp, 0.3);
  }
  // Walk (hop 0: legs alternate, ~0.55 m/s) or hop (hop 1: legs together, 0.42 m hops) to (x, z) on the ground or along
  // the perch, then go on as `after` (R_PERCH, or R_GROUND for afterT s: caching).
  rvStep(a, x, z, hop, after, afterT) {
    if (after === R_GROUND && !a.task) a.tRest = a.t;   // the standing time left, after caching
    a.tx = x; a.tz = z; a.hopping = hop; a.after = after; a.afterT = afterT; a.state = R_WALK; a.hopU = 1.3;
  }
  rvWalk(a, dt) {
    const H = this.heights, dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
    const base = () => a.perchY ?? H.atXZ(a.x, a.z);
    a.pose = damp(a.pose, 1, 6, dt); a.roll = damp(a.roll, 0, 6, dt); a.pitch = damp(a.pitch, 0.04, 6, dt); a.look = damp(a.look, 0, 4, dt);
    if (d > 0.02) a.yaw += wrapAngle(Math.atan2(dx, dz) - a.yaw) * (1 - Math.exp(-dt * (a.hopping ? 14 : 8)));
    let done = false;
    if (!a.hopping) {
      const step = Math.min(d, 0.55 * dt);
      if (d > 1e-4) { a.x += dx / d * step; a.z += dz / d * step; }
      a.amp = damp(a.amp, d > 0.02 ? 1 : 0, 10, dt); a.phase += dt * TAU * 2.4;
      a.y = base();
      done = d <= 0.02;
    } else {
      if (a.hopU >= 1.3) {   // the next hop
        if (d <= 0.02) done = true;
        else { const L = Math.min(d, 0.42); a.hopX = a.x; a.hopZ = a.z; a.hopDX = dx / d * L; a.hopDZ = dz / d * L; a.hopU = 0; a.hop0 = Math.round(a.phase / TAU) * TAU; }
      }
      if (!done) {
        a.hopU += dt / 0.28;
        const h = Math.min(1, a.hopU), e = h * h * (3 - 2 * h);
        a.x = a.hopX + a.hopDX * e; a.z = a.hopZ + a.hopDZ * e;
        a.y = base() + 0.07 * Math.sin(Math.PI * h) * Math.min(1, Math.hypot(a.hopDX, a.hopDZ) / 0.15 + 0.4);
        a.phase = a.hop0 + h * TAU; a.amp = damp(a.amp, h < 1 ? 1 : 0, 12, dt);
      }
    }
    if (done) {
      a.state = a.after; a.hopping = 0; a.y = base();
      if (a.after === R_GROUND) a.t = a.afterT;
    }
  }
  // debugging: a raven on the ground (a, else the nearest to the eye) walks or hops to a shrub within 6 m and caches
  // there. Returns the distance, or null.
  ravenCache(a = null) {
    const C = this.camPos; a ||= this.nearestOf('corvus_corax', C.x, C.y, C.z, 200);
    if (!a || !(a.state === R_PERCH || a.state === R_GROUND) || a.perchY !== null) return null;
    const spot = this.shrubSpot(a.x, a.z, 6), d = spot ? Math.hypot(spot.x - a.x, spot.z - a.z) : 0;
    if (!spot) return null;
    a.t = Math.max(a.t, 8);
    this.rvStep(a, spot.x, spot.z, d > 2 ? 1 : 0, R_GROUND, 2.4 + a.rng() * 1.2);
    return +d.toFixed(2);
  }
  // Beside the nearest shrub of the near set within r m (the side facing x, z), or null.
  shrubSpot(x, z, r) {
    let pick = null, bd = r * r;
    for (const p of this.veg.nearPlants || []) {
      const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz; if (d2 > bd || !PLANTS[p.species]?.shrub) continue;
      bd = d2; pick = p;
    }
    if (!pick) return null;
    const ang = Math.atan2(x - pick.x, z - pick.z), d = 0.4 + 0.25 * (pick.scale || 1);
    return { x: pick.x + Math.sin(ang) * d, z: pick.z + Math.cos(ang) * d };
  }
  // A caching place: beside a shrub of the near set within 40 m (reservoir pick), else open ground 8-25 m off.
  cacheSpot(x, z, rng) {
    let pick = null, seen = 0;
    for (const p of this.veg.nearPlants || []) {
      const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz > 1600 || !PLANTS[p.species]?.shrub) continue;
      seen++; if (rng() * seen < 1) pick = p;
    }
    if (pick) {
      const ang = Math.atan2(x - pick.x, z - pick.z), d = 0.4 + 0.25 * (pick.scale || 1);
      return { x: pick.x + Math.sin(ang) * d, z: pick.z + Math.cos(ang) * d };
    }
    for (let k = 0; k < 5; k++) {
      const ang = rng() * TAU, d = 8 + rng() * 17, px = x + Math.cos(ang) * d, pz = z + Math.sin(ang) * d;
      if (this.landOK(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  }

  // ---- acorn game v4: granary defence, cache guarding, raids (see the header) ----------------------------
  // Is the family of this granary out gathering? AWAY.out of every AWAY.cycle s of the world clock, phased per granary.
  famAway(id) {
    const G = this.game; if (!G?.active || !id) return false;
    return (G.world.clock + (seedOf(id, 0xa3a7) % 1000) / 1000 * AWAY.cycle) % AWAY.cycle < AWAY.out;
  }
  // How many of the family of granary oakId are within r m of (x, y, z).
  familyWithin(oakId, x, y, z, r) {
    const f = this.fams.get(oakId); if (!f) return 0;
    let n = 0;
    for (const a of f) { if (this.byId.get(a.id) !== a) continue; const dx = a.x - x, dy = a.y - y, dz = a.z - z; if (dx * dx + dy * dy + dz * dz < r * r) n++; }
    return n;
  }
  nearAnchor(a, r) { return Math.hypot(a.x - a.anchor.x, a.z - a.anchor.z) < r; }
  // An oak away from the granary for a family out gathering.
  awayOak(a) { return this.ringOak(a.anchor.x, a.anchor.z, 30, 120, a.rng) || this.randomOak(a.anchor.x, a.anchor.z, 120, a.rng, a.anchor) || a.anchor; }
  // The nearest granary holding acorns within r m of (x, z) (the world's granaries), or null.
  granaryNear(x, z, r) {
    const G = this.game, g = G?.world?.granaries; if (!g) return null;
    let best = null, bd = r * r;
    for (const id in g) {
      if (!(g[id] > 0)) continue;
      const o = G.oakById(id); if (!o) continue;
      const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = o; }
    }
    return best;
  }
  // A raider at granary oakId (called every frame while it is at it): the family may chase it; hit() when one strikes.
  raider(id, oakId, x, y, z, hit) {
    let t = this.threats.get(id);
    if (!t || t.oak !== oakId || (t.done && this.time - t.doneAt > 3)) {
      t = { id, oak: oakId, x, y, z, hit, seen: this.time, rallied: false, again: 0, chasers: 0, done: false, doneAt: 0 };
      this.threats.set(id, t);
    }
    t.x = x; t.y = y; t.z = z; t.hit = hit; t.seen = this.time;
    return t;
  }
  // Each frame in a game: families with members within DEFEND_R m of their granary answer a raider there with the rally
  // call and one or two birds flying at it (the nearest; two when three or more are home). Again after 6 s if it stays.
  defend() {
    if (!this.threats.size) return;
    for (const [id, t] of this.threats) {
      if (this.time - t.seen > 0.5) { this.threats.delete(id); continue; }   // gone, or not at it any more
      if (t.done || t.chasers > 0 || (t.rallied && this.time < t.again)) continue;
      const f = this.fams.get(t.oak), o = f?.[0]?.anchor; if (!o) continue;
      let n = 0, best = null, bd = Infinity, second = null, sd = Infinity;
      for (const a of f) {
        if (this.byId.get(a.id) !== a || a.state === W_MOB) continue;
        const gx = a.x - o.x, gz = a.z - o.z; if (gx * gx + gz * gz > DEFEND_R * DEFEND_R) continue;
        n++;
        const d = (a.x - t.x) ** 2 + (a.y - t.y) ** 2 + (a.z - t.z) ** 2;
        if (d < bd) { second = best; sd = bd; best = a; bd = d; } else if (d < sd) { second = a; sd = d; }
      }
      if (!n) continue;
      t.rallied = true; t.again = this.time + 6;
      this.emit('rally', { animal: best, x: best.x, y: best.y, z: best.z, oak: t.oak });
      for (const a of n > 2 && second ? [best, second] : [best]) this.wpMobStart(a, t);
    }
  }
  wpMobStart(a, t) {
    if (a.task === T_GET) this.dropTask(a);
    a.mob = t; t.chasers++; a.state = W_MOB; a.mobT = 7; a.dive = 0; a.air = 1; a.passes = 0;
  }
  // Mobbing: up over the raider, then a dive straight through where it is and on past; again until one strikes (within
  // 0.8 m: the raider's hit(); the first swoop is a warning that only brushes past) or 7 s pass, then home.
  wpMob(a, dt) {
    const t = a.mob; a.mobT -= dt;
    if (!t || a.mobT <= 0 || this.time - t.seen > 0.5 || (t.done && !a.dive)) {
      if (t) t.chasers = Math.max(0, t.chasers - 1);
      a.mob = null; a.dive = 0; this.wpFly(a, a.anchor, false); return;
    }
    const ox = a.x, oy = a.y, oz = a.z;
    if (!a.dive) {
      const dx = t.x - a.x, dy = t.y + 2.2 - a.y, dz = t.z - a.z, d = Math.hypot(dx, dy, dz), step = Math.min(d, 10 * dt);
      if (d < 1.2) {
        const ex = t.x - a.x, ey = t.y + 0.15 - a.y, ez = t.z - a.z, e = Math.hypot(ex, ey, ez) || 1;
        a.dive = 1; a.tx = ex / e; a.ty = ey / e; a.tz = ez / e; a.u = e + 2.5;
      } else if (d > 1e-4) { a.x += dx / d * step; a.y += dy / d * step; a.z += dz / d * step; }
    } else {
      const step = 12 * dt; a.x += a.tx * step; a.y += a.ty * step; a.z += a.tz * step; a.u -= step;
      if (!t.done && a.passes > 0 && Math.hypot(a.x - t.x, a.y - t.y, a.z - t.z) < 0.8) { t.done = true; t.doneAt = this.time; t.hit?.(); }
      if (a.u <= 0) { a.dive = 0; a.passes++; }
    }
    a.y = Math.max(a.y, this.heights.atXZ(a.x, a.z) + 0.3);
    a.air = 1; a.amp = damp(a.amp, a.dive ? 0.25 : 1, 20, dt); a.pose = damp(a.pose, a.dive ? 0.8 : 0, 20, dt); a.phase += dt * TAU * 13;
    const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
    if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
    a.pitch = -Math.atan2(vy, vh + 1e-5) * 0.8; a.flick = 0;
  }
  // An AI raider at a granary hole (a squirrel on the trunk, a jay): a threat to the family while it works; after a.t s
  // the acorn comes free if no family member is within RAID_GUARD_R m (else it keeps at it, up to a.wait s). done(): away.
  raidStep(a, dt, done) {
    const G = this.game, o = a.raidOak;
    if (!o || !this.gameOn(a)) { a.raidOak = null; a.task = 0; done(); return; }
    this.raider(a.id, o.id, a.x, a.y, a.z, () => this.aiMobbed(a));
    a.wait -= dt;
    if (a.t > 0) return;
    if (a.wait <= 0) { a.raidOak = null; a.task = 0; done(); return; }
    if (this.familyWithin(o.id, a.x, a.y, a.z, RAID_GUARD_R)) { a.t = 0.3; return; }
    G.collector(a.id, SPECIES[a.sp].code).carrying = a.carry;
    if (G.raid(a.id, o.id, a.x, a.y, a.z)) { a.carry = 1; a.fleeOak = o; a.bx = a.x; a.bz = a.z; a.eatT = 0; a.task = a.sp === SQ ? T_STORE : 0; }
    else a.task = 0;
    a.raidOak = null; done();
  }
  // Off with a stolen acorn: still a target while within FLEE_R m of the granary.
  fleeing(a) {
    const o = a.fleeOak;
    if (!a.carry || !this.game?.active || Math.hypot(a.x - o.x, a.z - o.z) > FLEE_R) { a.fleeOak = null; return; }
    this.raider(a.id, o.id, a.x, a.y, a.z, () => this.aiMobbed(a));
  }
  jayRaid(a, o) {
    const r = a.rng, h = Math.min(forkHeight(o) * 0.9, 1.4 + r() * 1.6), face = Math.atan2(a.x - o.x, a.z - o.z) + (r() - 0.5);
    const t = trunkAt(o, h, this._t), rr = t.r + 0.05;
    a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tx = t.x + Math.sin(face) * rr; a.ty = t.y; a.tz = t.z + Math.cos(face) * rr;
    a.face = face; a.raidOak = o; a.next = J_RAID; a.tree = o;
    const d = Math.hypot(a.tx - a.sx, a.tz - a.sz); a.dur = Math.max(0.8, d / 9); a.u = 0; a.state = J_FLY; a.air = 1; a.peak = 0;
  }
  jayFlee(a) {
    const r = a.rng, o = this.ringOak(a.x, a.z, 30, 70, r) || a.group?.tree || a.anchor; if (!o) return;
    a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tree = o; this.jaySpot(a, o, false);
    const d = Math.hypot(a.tx - a.sx, a.tz - a.sz); a.dur = Math.max(0.8, d / 10); a.u = 0; a.state = J_FLY; a.air = 1; a.peak = 0;
  }
  // A jay on the ground probes out a buried acorn within 2.5 m (not its own) and eats it.
  jayDig(a) {
    const G = this.game, k = G.cacheNear(a.x, a.z, 2.5, null, a.id); if (!k) return;
    a.yaw = Math.atan2(k.x - a.x, k.z - a.z); a.flickV = 1;
    G.collector(a.id, SPECIES[a.sp].code).carrying = 0;
    G.dig(a.id, k.id, false);
  }
  // Someone else's cache dug up (acorns.js 'dig', with the place: this browser's own digs only). Its owner, a squirrel
  // on the ground within GUARD.notice m, runs to the spot (sqGuard).
  onDig(e) {
    const G = this.game;
    if (!G?.active || !e.pil || e.x === undefined || (e.by !== 'player' && G.aiLocal === false)) return;
    const o = e.own != null ? this.byId.get(e.own) : null;
    if (!o || o.sp !== SQ || o.guard || o.state === S_CLIMB || o.state === S_OUT || o.state === S_SIT || o.state === S_IN
      || o.state === S_DOWN || o.state === S_RAIDP) return;   // up a tree: it does not see
    if (Math.hypot(o.x - e.x, o.z - e.z) > GUARD.notice) return;
    if (o.task === T_GET) this.dropTask(o);
    o.guard = { x: e.x, z: e.z, by: e.by, t: 10, chase: false, look: 0.5 + o.rng() * 0.6 };   // a look up first
    o.state = S_PAUSE;
  }
  // The owner at its dug-up cache: a run to the spot; a thief within GUARD.chase m is chased (5.5 m/s, up to 5 s) and,
  // caught (0.6 m), mobbed: it drops what it carries and is driven off.
  sqGuard(a, dt) {
    const g = a.guard, r = a.rng, H = this.heights;
    if (g.look > 0) {   // sat up, looking: then off
      g.look -= dt; a.amp = damp(a.amp, 0, 10, dt); a.pose = damp(a.pose, 1, 8, dt); a.pitch = damp(a.pitch, -0.3, 6, dt);
      a.yaw = Math.atan2(g.x - a.x, g.z - a.z); if (r() < dt * 4) a.flickV = 1;
      return;
    }
    g.t -= dt;
    const p = g.by === 'player' ? this.flight.pos : this.byId.get(g.by);
    const px = p ? p.x : g.x, pz = p ? p.z : g.z, dp = Math.hypot(px - a.x, pz - a.z);
    if (!g.chase && p && dp < GUARD.chase) { g.chase = true; g.t = Math.min(g.t, 5); }
    if (g.t <= 0 || (g.chase && !p)) { this.sqGuardEnd(a); return; }
    const tx = g.chase ? px : g.x, tz = g.chase ? pz : g.z, speed = g.chase ? 5.5 : 3.2;
    const ex = tx - a.x, ez = tz - a.z, d = Math.hypot(ex, ez), step = speed * dt;
    a.state = S_RUN; a.next = S_PAUSE; a.tx = tx; a.tz = tz; a.speed = speed;   // drawn as a run
    a.amp = damp(a.amp, 1, 12, dt); a.pose = damp(a.pose, 0, 10, dt); a.pitch = damp(a.pitch, 0, 8, dt);
    a.phase += dt * TAU * speed / 0.42;
    if (d > 1e-3) a.yaw = Math.atan2(ex, ez);
    if (r() < dt * 3) a.flickV = 1;   // the tail going
    const stop = g.chase ? 0.35 : 0;   // (up to the thief, not into it)
    if (d > step + stop) { a.x += ex / d * step; a.z += ez / d * step; } else if (!g.chase) { a.x = tx; a.z = tz; }
    a.y = H.atXZ(a.x, a.z) + Math.abs(Math.sin(a.phase)) * 0.05;
    if (g.chase && dp < 0.6 && Math.abs(p.y - a.y) < 1.2) { this.chaseHit(g.by); this.sqGuardEnd(a); return; }
    if (!g.chase && d < 0.3) this.sqGuardEnd(a);   // at the spot: a sniff; the thief is gone
  }
  sqGuardEnd(a) { a.guard = null; a.state = S_PAUSE; a.t = 1.5 + a.rng() * 2; if (a.task !== T_STORE) a.task = 0; }
  chaseHit(by) {
    if (by === 'player') { this.game.playerMobbed('squirrel'); return; }
    const a = this.byId.get(by); if (a) this.aiMobbed(a);
  }
  // An AI raider struck by the family (or caught by a cache's owner): a 'mob' event (it drops what it carries) on the
  // AI host, and off it goes; it keeps away from granaries for DRIVEN_T s.
  aiMobbed(a) {
    const G = this.game, r = a.rng;
    if (this.gameOn(a)) {
      G.collector(a.id, SPECIES[a.sp].code).carrying = a.carry;
      if (G.mob(a.id, a.carry > 0) && a.carry) a.carry = 0;
    }
    a.raidOak = null; a.fleeOak = null; a.offT = this.time + DRIVEN_T; a.acorn = null;
    if (a.task !== T_STORE || !a.carry) a.task = 0;
    if (a.sp === SQ) {
      if (a.state === S_CLIMB && a.path) { a.scared = 1; a.pdir = -1; a.state = S_IN; }
      else if (a.state === S_RAIDP || a.state === S_CLIMB) { a.scared = 1; a.state = S_DOWN; }
      else if (a.state !== S_DOWN && a.state !== S_OUT && a.state !== S_SIT && a.state !== S_IN) {
        const ang = r() * TAU, d = 10 + r() * 10; this.sqRunTo(a, a.x + Math.cos(ang) * d, a.z + Math.sin(ang) * d, 5, S_PAUSE);
      }
    } else if (a.sp === SJ || a.sp === ST) this.jayFlee(a);
    else if (a.sp === RV) { a.task = 0; a.state = R_PERCH; a.t = 0; }
  }

  // ---- acorn game: collectors (see the header) -------------------------------------------------------
  // Is the game on for this animal? A task from a game that has stopped, or from another world, is dropped.
  // Shared world (net.js): the AI collectors run in one browser per world, the server's AI host (G.aiLocal); elsewhere
  // the animals go about as they do outside a game and show the acorns the host's animals carry (the carry loop).
  gameOn(a) {
    const G = this.game;
    if (!G || !G.active || G.aiLocal === false) { if (a.task || a.carry) { a.task = 0; a.acorn = null; a.carry = 0; } return false; }
    if (a.ep !== G.epoch) { a.ep = G.epoch; a.task = 0; a.acorn = null; a.carry = 0; }
    return true;
  }
  dropTask(a) { if (a.acorn && this.game) this.game.release(a.acorn.key, a.id); a.acorn = null; if (a.task !== T_STORE) a.task = 0; }
  claim(a, ac) { this.game.reserve(ac.key, a.id); a.acorn = ac; a.task = T_GET; }
  // Take the claimed acorn (a pickup event); false when someone was there first.
  takeAcorn(a) {
    const G = this.game, ac = a.acorn; a.acorn = null;
    if (!ac || !G) return false;
    const rec = G.collector(a.id, SPECIES[a.sp].code); rec.carrying = a.carry;   // an animal re-made by a rebuild starts empty
    if (!G.take(a.id, ac)) return false;
    a.carry = 1; return true;
  }
  // A free acorn within r of (x, z) from the game's supply: ground or branch only when asked; a random one, or the
  // nearest. At most SEARCHES per frame (null when the budget is spent; the animal goes on as usual).
  findAcorn(x, z, r, rng, ground = false, branch = false, nearest = false) {
    const G = this.game; if (!G || this.searches <= 0) return null;
    this.searches--;
    const b = Math.ceil(r / BUCKET), bi = Math.floor(x / BUCKET), bj = Math.floor(-z / BUCKET);
    let pick = null, seen = 0, bd = r * r;
    for (let j = bj - b; j <= bj + b; j++) for (let i = bi - b; i <= bi + b; i++) {
      const arr = this.oakGrid.get(i + j * 4096); if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const o = this.oaks[arr[k]], dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
        if (d2 > r * r || (nearest && d2 >= bd)) continue;
        const ac = G.freeAcorn(o, ground, branch); if (!ac) continue;
        if (nearest) { bd = d2; pick = ac; } else { seen++; if (rng() * seen < 1) pick = ac; }
      }
    }
    return pick;
  }
  // Where the carried acorn is: the bill or mouth point (CARRY) turned with the head part (and, for the drawn
  // squirrel, the chest it hangs from) as the vertex shader does, then through the instance matrix m.
  carryPoint(a, m) {
    let C = CARRY[a.sp], chest = false, lift = 0, yaw = 0;
    if (a.sp === RV && this.meshOn(RV)) { if (a.gm) { C = CARRY.rvGround; yaw = a.e1; } else lift = RAVEN_LIFT; }
    if (a.sp === SQ && this.meshOn(SQ)) {
      C = CARRY.sqRig; chest = true;
      const piv = this.drawn[SQ].model?.rig?.piv;
      if (piv?.head && !C.fromModel) { C.py = piv.head[1]; C.pz = piv.head[2]; if (piv.chest) { C.cy = piv.chest[1]; C.cz = piv.chest[2]; } C.fromModel = true; }
    }
    let y = C.ty - C.py, z = C.tz - C.pz;
    let g = a.flick * C.flick + a.pose * C.pose, c = Math.cos(g), s = Math.sin(g);
    let y2 = c * y - s * z + C.py, z2 = s * y + c * z + C.pz;
    if (chest) {
      g = -(Math.sin(a.phase + 1.2) * a.amp * 0.28 + a.pose * 0.7); c = Math.cos(g); s = Math.sin(g);
      y = y2 - C.cy; z = z2 - C.cz; y2 = c * y - s * z + C.cy; z2 = s * y + c * z + C.cz;
    }
    let x2 = 0;
    if (yaw) { z = z2 - C.pz; x2 = Math.sin(yaw) * z; z2 = C.pz + Math.cos(yaw) * z; }   // the ground raven's head turn
    return (this._cp ||= new THREE.Vector3()).set(x2, y2 + lift, z2).applyMatrix4(m);
  }

  // ---- deer ---------------------------------------------------------------------------------------
  // How open a spot is for a herd at dawn or dusk: grassland and savanna best, closed woods and
  // chaparral poor, water and conifer forest never (-1).
  openness(x, z) {
    const c = this.tile.habitat.at(x, -z); if (c === 7 || c === 2 || !c) return -1;
    const can = this.tile.canopy.at(x, -z) / 100;
    return c === 5 ? 1 : c === 9 ? 0.9 : c === 1 ? 0.95 - can : c === 6 ? 0.5 : c === 3 ? 0.35 - can * 0.2 : 0.2;
  }
  drUpdate(a, dt, px = 1e7, py = 1e7, pz = 1e7) {
    const r = a.rng, g = a.group, H = this.heights, hr = this.hour;
    // the player: alert (head up, standing) when noticed within ALERT_MAX; off at a trot when within DEER_FLEE and
    // noticed, or alarmed by a call: the leader takes the herd 80-120 m the other way (the pilot's point, if piloted).
    // The player or an AI hunter of deer, whichever is the threat (threat()).
    const T = this.threat(DR, a, a.x, a.y, a.z, px, py, pz), tn = T.n; px = T.x; py = T.y; pz = T.z;
    const dh = Math.hypot(a.x - px, a.z - pz), low = py - a.y < 30, alertNow = low && this.alert(DR, dh, tn);
    if (low && g.leader === a && !g.pilot && this.danger(DR, a, dh, DEER_FLEE, tn) && (g.fleeT || 0) <= 0) {
      const ang = Math.atan2(a.z - pz, a.x - px) + (r() - 0.5) * 0.6, d = 80 + r() * 40;
      g.wx = a.x + Math.cos(ang) * d; g.wz = a.z + Math.sin(ang) * d; g.fleeT = 8; g.hx = g.wx; g.hz = g.wz;
      for (const b of this.bySpecies[a.sp]) if (b.group === g) { b.state = D_WALK; b.pose = 0; }
    }
    if (g.leader === a && g.fleeT > 0) g.fleeT -= dt;
    const active = !!g.pilot || g.fleeT > 0 || alertNow || hr < 9.5 || hr > 16.5;   // dawn and dusk; bedded through the middle of the day (a piloted, fleeing or alert herd is up)
    a.t -= dt;
    let speed = 0;
    if (!active) {
      a.state = D_BED; a.pose = damp(a.pose, 1, 0.8, dt); a.flick = damp(a.flick, 0, 2, dt);
    } else {
      a.pose = damp(a.pose, 0, 1.2, dt);
      if (a.pose > 0.3) { a.state = D_GRAZE; }
      else if (g.leader === a && g.pilot) {   // piloted: to the player's point, at a trot when far behind it (pilot above)
        const ex = g.pilot.x - a.x, ez = g.pilot.z - a.z, d = Math.hypot(ex, ez);
        if (d < 2.5) { if (a.state === D_WALK) { a.state = D_GRAZE; a.t = 4 + r() * 8; } }
        else { a.state = D_WALK; speed = Math.min(8, 0.6 + d * 0.3); a.x += ex / d * speed * dt; a.z += ez / d * speed * dt; a.yaw += wrapAngle(Math.atan2(ex, ez) - a.yaw) * Math.min(1, dt * 3); }   // up to a run when the player has run ahead
      } else if (g.leader === a) {
        if (a.state !== D_WALK && a.t <= 0) {   // next waypoint: the most open of a few spots 40-110 m off, within 160 m of home
          let best = -2;
          for (let k = 0; k < 6; k++) {
            const ang = r() * TAU, d = 40 + r() * 70;
            let x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
            const hx = x - g.hx, hz = z - g.hz, hd = Math.hypot(hx, hz);
            if (hd > 160) { x = g.hx + hx / hd * 160; z = g.hz + hz / hd * 160; }
            const sc = this.openness(x, z) + r() * 0.3;
            if (sc > best) { best = sc; g.wx = x; g.wz = z; }
          }
          a.state = D_WALK;
        }
        if (a.state === D_WALK) {
          const ex = g.wx - a.x, ez = g.wz - a.z, d = Math.hypot(ex, ez);
          if (d < 1) { a.state = D_GRAZE; a.t = 4 + r() * 8; }
          else { speed = g.fleeT > 0 ? 4 : 1.1; a.x += ex / d * speed * dt; a.z += ez / d * speed * dt; a.yaw += wrapAngle(Math.atan2(ex, ez) - a.yaw) * Math.min(1, dt * 2); }
        }
      } else {   // walking: single file behind the leader; grazing: spread around it
        const L = g.leader || a, walking = L.state === D_WALK;   // a herd can lose its leader; follow yourself
        let tx, tz;
        if (walking) {
          const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw), back = a.rank * 2.6, side = a.ox * 0.18;
          tx = L.x - fx * back + fz * side; tz = L.z - fz * back - fx * side;
        } else { tx = L.x + a.ox; tz = L.z + a.oz; }
        const ex = tx - a.x, ez = tz - a.z, d = Math.hypot(ex, ez);
        if (d > (a.state === D_WALK ? 0.6 : 2.5)) {
          a.state = D_WALK; speed = Math.min(g.pilot ? 8 : g.fleeT > 0 ? 4.5 : 1.6, 0.4 + d * 0.3);   // a piloted or fleeing herd keeps up, at a run when strung out
          a.x += ex / d * speed * dt; a.z += ez / d * speed * dt;
          const want = Math.atan2(ex, ez); a.yaw += wrapAngle(want - a.yaw) * Math.min(1, dt * 3);
        } else a.state = D_GRAZE;
      }
      a.flick = damp(a.flick, a.state === D_GRAZE && !alertNow ? 1 : 0, 2, dt);   // alert: head up
    }
    a.amp = damp(a.amp, speed > 0.05 ? 1 : 0, 5, dt); a.spd = speed;   // spd: the skinned deer's clip choice (driveClips)
    a.phase += dt * TAU * speed / 1.5;
    const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    const hf = H.atXZ(a.x + sy * 0.6, a.z + cy * 0.6), hb = H.atXZ(a.x - sy * 0.6, a.z - cy * 0.6);
    a.pitch = -Math.atan2(hf - hb, 1.2) * 0.8;
    // bedded: the body drops by the drawn model's drop (doe 0.49 m, buck 0.515 m) or the procedural deer's 0.6 m
    a.y = Math.min(hf, hb) * 0.5 + H.atXZ(a.x, a.z) * 0.5 - this.drops[a.sp] * a.pose * a.size;
  }

  // ---- California quail ---------------------------------------------------------------------------
  // The covey is the unit: it forages in a loose knot, now and then runs across an opening in a
  // stream, and flushes all at once (staggered by a few tenths of a second) away from a threat: the
  // raven low overhead, a stooping hawk, or now and then nothing anyone can see.
  // ---- piloting a group (owner, 2026-10-27: "herd species piloted as a herd, a chaotic centre of gravity the animals
  // trend towards; when the user stops moving for too long the herd takes back over") -------------------------------
  // While the player is in a member of a deer herd, a quail covey or a turkey flock (groundControl.js herdDrive), the
  // group trends toward a point the player steers: pilot(g, x, z) every frame sets it. The herd's leader walks to it at
  // a trot when far behind and the rest follow in file as they do; the covey's and the flock's centre runs to it and the
  // members keep their slots round the centre. pilot(g, null) hands the group back to its own life where it stands (its
  // home moves there, so it does not walk back to the old one). A piloted herd is up and moving whatever the hour; a
  // piloted covey or flock is not flushed by the player among it, but keeps its own flushes and the roost.
  pilot(g, x, z) {
    if (!g) return;
    if (x == null) {
      if (g.pilot) { const L = g.leader; g.hx = g.x ?? L?.x ?? g.hx; g.hz = g.z ?? L?.z ?? g.hz; g.pilot = null; }
      return;
    }
    (g.pilot ||= { x: 0, z: 0 }).x = x; g.pilot.z = z;
  }
  groupRng(g, list) {
    // A group can lose its leader (member cap hit while placing, or a rebuild mid-season); adopt any member.
    if (!g.leader || !g.leader.rng) { g.leader = null; for (const a of list) if (a.group === g) { g.leader = a; break; } }
    return g.leader ? g.leader.rng : null;
  }
  coveyUpdate(g, dt, px, py, pz) {
    const r = this.groupRng(g, this.bySpecies[QU]); if (!r) return;
    const H = this.heights;
    g.t -= dt; g.cool -= dt;
    if (g.state !== G_SETTLE && (g.cool <= 0 || this.alarmed(g))) {   // an alarm call sends a settled covey to cover again
      // the player's low pass (48 m), or an AI hunter of quail on the ground within HUNT.quail m (threat())
      const gy = H.atXZ(g.x, g.z), T = this.threat(QU, g, g.x, gy, g.z, px, py, pz), ai = T.who;
      const dx = T.x - g.x, dz = T.z - g.z;
      const d = Math.hypot(dx, dz), al = this.alarmed(g);
      if (!g.pilot && ((d < Math.min(ai ? HUNT.quail : 48, T.n) && T.y - gy < 42) || (al && d < ALARM_REACT_R))) {
        this.flushCovey(g, T.x, T.z, al ? 'alarm' : !ai ? 'raven' : ai.sp === HK ? 'hawk' : ai.sp === RV ? 'raven' : 'hunter'); return;
      }
      if (g.cool <= 0 && r() < dt / 160) { const ang = r() * TAU; this.flushCovey(g, g.x + Math.cos(ang) * 30, g.z + Math.sin(ang) * 30, 'self'); return; }
    }
    if (g.pilot && g.state !== G_SETTLE) {   // piloted: the knot runs to the player's point and forages there (pilot above)
      const ex = g.pilot.x - g.x, ez = g.pilot.z - g.z, d = Math.hypot(ex, ez);
      if (d > 2.5) { g.tx = g.pilot.x; g.tz = g.pilot.z; g.dx = ex / d; g.dz = ez / d; g.speed = Math.min(3.6, 1.4 + d * 0.3); g.state = G_RUN; }
      else if (g.state === G_RUN) { g.state = G_FORAGE; g.t = 8 + r() * 10; }
    }
    if (g.state === G_FORAGE) {
      if (g.t <= 0) {   // run across an opening: 15-40 m, back toward home when strayed
        const hx = g.hx - g.x, hz = g.hz - g.z, hd = Math.hypot(hx, hz);
        let ang = r() * TAU; if (hd > 45) ang = Math.atan2(hz, hx) + (r() - 0.5);
        const d = 15 + r() * 25;
        g.tx = g.x + Math.cos(ang) * d; g.tz = g.z + Math.sin(ang) * d; g.dx = Math.cos(ang); g.dz = Math.sin(ang);
        g.speed = 2.4 + r() * 1.2; g.state = G_RUN;
      }
    } else if (g.state === G_RUN) {
      const ex = g.tx - g.x, ez = g.tz - g.z, d = Math.hypot(ex, ez), step = g.speed * dt;
      if (d <= step) { g.x = g.tx; g.z = g.tz; g.state = G_FORAGE; g.t = 15 + r() * 35; }
      else { g.x += ex / d * step; g.z += ez / d * step; }
    } else if (g.t <= 0) { g.state = G_FORAGE; g.t = 20 + r() * 30; }   // G_SETTLE: everyone down, regrouping
  }
  flushCovey(g, fx, fz, cause = 'raven') {
    if (g.state === G_SETTLE) return;
    const r = this.groupRng(g, this.bySpecies[QU]); if (!r) return;
    let n = 0; for (const a of this.bySpecies[QU]) if (a.group === g) n++;
    if (n) this.emit('flush', { group: g, x: g.x, y: this.heights.atXZ(g.x, g.z), z: g.z, n, cause });
    let ang = Math.atan2(g.z - fz, g.x - fx) + (r() - 0.5) * 0.8;   // away from the threat
    const d = 35 + r() * 40;
    let lx = g.x + Math.cos(ang) * d, lz = g.z + Math.sin(ang) * d;
    const o = this.nearestOak(lx, lz, 30); if (o) { lx = o.x + (lx - o.x) * 0.3; lz = o.z + (lz - o.z) * 0.3; }   // into cover
    g.x = lx; g.z = lz; g.state = G_SETTLE; g.t = 9; g.cool = 40 + r() * 40;
    for (const a of this.bySpecies[QU]) if (a.group === g) {
      a.state = Q_WAIT; a.wait = a.rank * 0.04 + r() * 0.45;
      a.tx = lx + a.ox * 2.2 + (r() - 0.5) * 5; a.tz = lz + a.oz * 2.2 + (r() - 0.5) * 5;
    }
  }
  quUpdate(a, dt) {
    const r = a.rng, g = a.group, H = this.heights;
    a.t -= dt;
    if (a.state === Q_WAIT) {   // crouch, then go
      a.wait -= dt; a.amp = damp(a.amp, 0, 10, dt);
      if (a.wait <= 0) {
        a.sx = a.x; a.sy = a.y; a.sz = a.z; a.ty = H.atXZ(a.tx, a.tz);
        const d = Math.hypot(a.tx - a.sx, a.tz - a.sz);
        a.dur = Math.max(1.5, d / 13); a.peak = 2.5 + r() * 3 + d * 0.03; a.u = 0; a.state = Q_FLY; a.air = 1;
      }
      return;
    }
    if (a.state === Q_FLY) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, ox = a.x, oy = a.y, oz = a.z;
      a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u;
      // up steeply on whirring wings, then a long flat glide down into cover
      const rise = u < 0.25 ? Math.sin(u / 0.25 * Math.PI / 2) : 1 - Math.pow((u - 0.25) / 0.75, 2.2);
      a.y = Math.max(H.atXZ(a.x, a.z) + 0.15, a.sy + (a.ty - a.sy) * u + a.peak * rise);
      const whirr = u < 0.5 || u > 0.93;
      a.amp = damp(a.amp, whirr ? 1 : 0, 25, dt); a.pose = damp(a.pose, 0, 20, dt);
      if (whirr) a.phase += dt * TAU * 19; else a.phase = damp(a.phase, Math.round(a.phase / TAU) * TAU + 0.6, 8, dt);
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = -Math.atan2(vy, vh + 1e-5) * 0.6;
      if (u >= 1) {
        a.state = Q_FORAGE; a.air = 0; a.t = 1 + r() * 3; a.pitch = 0;
        a.ox = a.x - g.x; a.oz = a.z - g.z;   // landed scattered; drift back into a knot
      }
      return;
    }
    // Q_FORAGE: keep to a slot around the covey centre (or a place in the stream while it runs)
    a.air = 0;
    let tx, tz;
    if (g.state === G_RUN) {
      const back = a.rank * 0.75, side = a.oz * 0.35;
      tx = g.x - g.dx * back - g.dz * side; tz = g.z - g.dz * back + g.dx * side;
    } else {
      if (g.state === G_FORAGE) { const k = Math.min(1, dt * 0.15); a.ox -= a.ox * k * (Math.abs(a.ox) > 3 ? 1 : 0); a.oz -= a.oz * k * (Math.abs(a.oz) > 3 ? 1 : 0); }
      if (a.t <= 0) { a.t = 1.5 + r() * 4; a.ox += (r() - 0.5) * 1.2; a.oz += (r() - 0.5) * 1.2; }
      tx = g.x + a.ox; tz = g.z + a.oz;
    }
    const ex = tx - a.x, ez = tz - a.z, d = Math.hypot(ex, ez);
    let speed = 0;
    if (d > 0.25) {
      speed = Math.min(g.state === G_RUN ? 4.5 : 3, d * 2.5);
      a.x += ex / d * speed * dt; a.z += ez / d * speed * dt;
      a.yaw += wrapAngle(Math.atan2(ex, ez) - a.yaw) * Math.min(1, dt * 10);
    } else if (r() < dt * 1.5) a.flickV = 1;   // peck
    a.amp = damp(a.amp, speed > 0.1 ? 1 : 0, 12, dt); a.pose = damp(a.pose, 1, 10, dt);
    a.phase += dt * TAU * speed / 0.14;
    a.pitch = damp(a.pitch, 0, 8, dt);
    a.y = H.atXZ(a.x, a.z);
  }

  // ---- California scrub-jay -----------------------------------------------------------------------
  // A family group moves through the oaks together: the leader flies to a tree 20-90 m off (or drops
  // to the ground under one to forage and, in fall, to bury acorns), the others follow one by one.
  // The Steller's jay does the same in the pines (stellerSpot), and between moves works up its tree in short hops
  // from branch to branch (jayFly with hop > 0), then glides down to the next tree with the group.
  jaySpot(a, o, ground, hop = 0) {
    if (o.conifer) return this.stellerSpot(a, o, ground, hop);
    const r = a.rng, ang = r() * TAU;
    if (ground) {
      const d = (1.5 + r() * 4) * o.scale;
      a.tx = o.x + Math.cos(ang) * d; a.tz = o.z + Math.sin(ang) * d; a.ty = this.heights.atXZ(a.tx, a.tz);
    } else {
      const d = r() * 1.6 * o.scale;
      a.tx = o.x + Math.cos(ang) * d; a.tz = o.z + Math.sin(ang) * d; a.ty = o.y + treeHeight(o) * (0.86 + 0.1 * r());
    }
    a.next = ground ? J_GROUND : J_PERCH;
  }
  // A branch in a pine's crown: out along a limb (30-80 % of the crown's radius at that height), on the side
  // facing a random direction; hop > 0 climbs that much (fraction of the height) above the present perch.
  stellerSpot(a, o, ground, hop) {
    const r = a.rng, H = o.height;
    const ang = hop ? Math.atan2(a.z - o.z, a.x - o.x) + (r() - 0.5) * 1.2 : r() * TAU;   // a hop stays on the same side of the trunk
    if (ground) {
      const d = 1 + r() * Math.max(1.5, 0.12 * H);
      a.tx = o.x + Math.cos(ang) * d; a.tz = o.z + Math.sin(ang) * d; a.ty = this.heights.atXZ(a.tx, a.tz);
    } else {
      const lo = o.sp === 'pinus_sabiniana' ? 0.3 : 0.45;
      const h = hop ? Math.min(0.9, a.hFrac + hop) : lo + r() * 0.25; a.hFrac = h;
      const d = H * crownR(o.sp, h) * (0.3 + 0.5 * r());
      a.tx = o.x + Math.cos(ang) * d; a.tz = o.z + Math.sin(ang) * d; a.ty = o.y + H * h;
    }
    a.next = ground ? J_GROUND : J_PERCH;
  }
  jayFly(a, o, ground, hop = 0) {
    a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tree = o;
    this.jaySpot(a, o, ground, hop);
    const d = Math.hypot(a.tx - a.sx, a.tz - a.sz);
    a.dur = hop ? Math.min(0.9, 0.3 + Math.hypot(d, a.ty - a.sy) / 10) : Math.max(0.8, d / 9); a.u = 0; a.state = J_FLY; a.air = 1;
    if (hop) { a.peak = -0.3; return; }   // a short bound up to the next branch
    // a drop from the perch, low across the gap, and a swoop up into the next crown
    a.peak = ground ? -Math.min(2, d * 0.1) : Math.min(0.4 * Math.max(0, Math.min(a.sy, a.ty) - this.heights.atXZ((a.sx + a.tx) / 2, (a.sz + a.tz) / 2) - 2), d * 0.25);
  }
  sjUpdate(a, dt, px, py, pz) {
    const r = a.rng, g = a.group, H = this.heights;
    a.t -= dt;
    if (a.fleeOak) this.fleeing(a);
    if (a.state === J_FLY) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, ox = a.x, oy = a.y, oz = a.z;
      const e = u * u * (3 - 2 * u);
      a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u;
      a.y = Math.max(H.atXZ(a.x, a.z) + 0.8 * (1 - (u > 0.9 && a.next === J_GROUND ? (u - 0.9) * 10 : 0)), a.sy + (a.ty - a.sy) * e - a.peak * Math.sin(Math.PI * u));
      const glide = u > 0.78 || Math.sin(this.time * TAU * 1.6 + a.phase * 0.05) < -0.45;   // rowing beats with short glides; glide in
      a.amp = damp(a.amp, glide ? 0 : 1, 18, dt); a.pose = damp(a.pose, 0, 14, dt);
      if (!glide) a.phase += dt * TAU * 11;
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = -Math.atan2(vy, vh + 1e-5) * 0.7;
      if (u >= 1) {
        a.state = a.next; a.air = 0; a.t = 3 + r() * 8; a.pitch = 0;
        if (a.state === J_RAID) { a.t = 1.4 + r() * 0.8; a.wait = 6; a.yaw = a.face + Math.PI; }   // v4: at a granary hole
      }
      return;
    }
    a.air = 0;
    if (a.state === J_RAID) {   // v4: clinging at a granary hole, working an acorn out
      a.amp = damp(a.amp, 0, 10, dt); a.pose = damp(a.pose, 1, 8, dt); a.pitch = damp(a.pitch, -1.1, 8, dt); a.yaw = a.face + Math.PI;
      if (r() < dt * 4) a.flickV = 1;
      this.raidStep(a, dt, () => this.jayFlee(a));
      return;
    }
    a.amp = damp(a.amp, 0, 10, dt); a.pose = damp(a.pose, 1, 8, dt);
    if (a.state === J_PERCH) {
      a.pitch = damp(a.pitch, -0.2, 5, dt); if (r() < dt * 0.6) a.flickV = 1; if (r() < dt * 0.3) a.yaw += (r() - 0.5) * 2;
      if (a.tree?.conifer && a.hFrac < 0.84 && a.moveSeen === g.move && r() < dt * 0.08) { this.jayFly(a, a.tree, false, 0.05 + 0.07 * r()); return; }
      if (a.carry && (a.eatT += dt) > 5) a.carry = 0;   // v4: a stolen acorn, eaten on the perch
      if (!a.carry && this.time > a.offT && r() < dt * (RAID_ODDS.jay[this.season] || 0) && this.gameOn(a)) {   // v4: a raid on a granary
        const o = this.granaryNear(a.x, a.z, 50); if (o) { this.jayRaid(a, o); return; }
      }
    }
    else {   // J_GROUND: hops, probes and (in fall) pushes acorns into the ground
      a.pitch = damp(a.pitch, 0, 6, dt);
      if (a.hopU < 1) {   // a two-footed hop: a low arc over 0.16 s, tail flicked up on landing
        a.hopU = Math.min(1, a.hopU + dt / 0.16); const k = a.hopU;
        a.x = a.hopX + a.hopDX * k; a.z = a.hopZ + a.hopDZ * k;
        a.y = H.atXZ(a.x, a.z) + Math.sin(Math.PI * k) * a.hopH;
        if (a.hopU >= 1) a.e1 = 1;
      } else {
        if (r() < dt * (this.season === 'fall' ? 1.4 : 0.8)) a.flickV = 1;   // probing, or pushing an acorn in
        if (r() < dt * 0.04 && this.gameOn(a)) this.jayDig(a);               // v4: someone's buried acorn, dug up and eaten
        if (r() < dt * 0.5) {
          const h = 0.3 + r() * 0.4; a.yaw += (r() - 0.5) * 1.5;
          a.hopX = a.x; a.hopZ = a.z; a.hopDX = Math.sin(a.yaw) * h; a.hopDZ = Math.cos(a.yaw) * h; a.hopH = 0.03 + h * 0.1; a.hopU = 0;
        }
        a.y = H.atXZ(a.x, a.z);
      }
    }
    const dx = a.x - px, dy = a.y - py, dz = a.z - pz, flush = dx * dx + dy * dy + dz * dz < 10 * 10;
    if (g.leader === a) {
      g.t -= dt;
      if (g.t <= 0 || flush) {   // the group moves on
        const ground = !flush && r() < (this.season === 'fall' ? 0.4 : 0.25);
        const o = ground && r() < 0.5 ? g.tree : g.home.conifer ? (this.ringConifer(g.home.x, g.home.z, 0, 90, r, g.tree) || g.home)
          : (this.ringOak(g.home.x, g.home.z, 0, 90, r, false, g.tree) || g.home);
        g.tree = o; g.ground = ground; g.move++; g.t = 8 + r() * 22;
        a.moveSeen = g.move; this.jayFly(a, o, ground);
      }
    } else if (a.moveSeen !== g.move) {   // follow, one after another
      if (a.wait <= 0) a.wait = 0.4 + a.rank * 0.7 + r() * 1.5;
      a.wait -= dt;
      if (a.wait <= 0 || flush) { a.moveSeen = g.move; a.wait = 0; this.jayFly(a, g.tree, g.ground); }
    }
  }

  // ---- soarers: red-tailed hawk, turkey vulture ---------------------------------------------------
  soarStart(a, cx, cz, R, alt, dir, th, state) {
    a.cx = cx; a.cz = cz; a.R = R; a.alt = alt; a.dir = dir; a.th = th; a.state = state; a.air = 1;
    a.t = state === H_SOAR ? 30 + a.rng() * 60 : 40 + a.rng() * 60; a.V = state === H_SOAR ? 9 : 9.5;
    a.x = cx + R * Math.cos(th); a.z = cz + R * Math.sin(th); a.y = this.heights.atXZ(cx, cz) + alt;
    a.rock = a.rng() * 100;
  }
  // One step around the circle; returns the bank angle for it.
  circle(a, dt, floor) {
    const H = this.heights;
    a.th += a.dir * a.V / a.R * dt;
    a.x = a.cx + a.R * Math.cos(a.th); a.z = a.cz + a.R * Math.sin(a.th);
    const gy = H.atXZ(a.cx, a.cz) + a.alt + 6 * Math.sin(a.th * 0.5 + a.phase);
    a.y = damp(a.y, Math.max(gy, H.atXZ(a.x, a.z) + floor), 0.12, dt);   // a thermal: slow rises, never into the hill
    a.yaw = Math.atan2(-Math.sin(a.th) * a.dir, Math.cos(a.th) * a.dir);
    return a.dir * Math.atan(a.V * a.V / (9.8 * a.R)) * 1.3;   // same sense as the raven's: right turn, left wing up
  }
  // Re-centre the circle on the bird's present heading so a new one starts where it is (no jump).
  joinCircle(a, R, dir) {
    a.R = R; a.dir = dir; a.th = dir > 0 ? -a.yaw : Math.PI - a.yaw;
    a.cx = a.x - R * Math.cos(a.th); a.cz = a.z - R * Math.sin(a.th);
  }
  hkUpdate(a, dt) {
    const r = a.rng, H = this.heights; a.t -= dt; a.flapT -= dt; a.air = 1;
    if (a.state === H_SOAR) {
      const hx = a.hx - a.cx, hz = a.hz - a.cz, hd = Math.hypot(hx, hz);
      a.cx += (0.5 + (hd > 200 ? hx / hd * 1.2 : 0)) * dt; a.cz += (0.25 + (hd > 200 ? hz / hd * 1.2 : 0)) * dt;
      const bank = this.circle(a, dt, 40);
      a.roll = damp(a.roll, bank, 1.5, dt); a.pitch = damp(a.pitch, 0, 2, dt);
      const low = a.y < H.atXZ(a.cx, a.cz) + a.alt - 40;   // working up out of a stoop: flap now and then
      if (a.flapT <= 0 && r() < dt * (low ? 0.4 : 0.04)) a.flapT = 0.8 + r();
      a.amp = damp(a.amp, a.flapT > 0 ? 1 : 0, 6, dt); a.pose = damp(a.pose, 0, 3, dt);
      if (a.flapT > 0) a.phase += dt * TAU * 2.4; else a.phase = damp(a.phase, Math.round(a.phase / Math.PI) * Math.PI, 3, dt);
      if (a.t <= 0) {   // stoop: at a covey in reach (if this observer sees quail), else at open ground below
        let tx = 0, tz = 0, cov = null, bd = 230 * 230;
        if (this.meshes[QU].visible) for (const g of this.coveys) { const dx = g.x - a.x, dz = g.z - a.z, d2 = dx * dx + dz * dz; if (d2 < bd && g.state !== G_SETTLE) { bd = d2; cov = g; } }
        // now and then a vole or a ground squirrel below instead, when nearer (HUNT.hawk; they react to it as a threat)
        let prey = null;
        if (r() < HUNT.hawk) { prey = this.huntTarget(a, Math.sqrt(bd), [VO, GS]); if (prey) cov = null; }
        if (prey) { tx = prey.x; tz = prey.z; }
        else if (cov) { tx = cov.x; tz = cov.z; }
        else { const ang = r() * TAU, d = 30 + r() * 90; tx = a.x + Math.cos(ang) * d; tz = a.z + Math.sin(ang) * d; }
        if (cov || prey || this.openness(tx, tz) > 0.5) {
          a.group = cov; a.sx = a.x; a.sy = a.y; a.sz = a.z; a.tx = tx; a.tz = tz; a.ty = H.atXZ(tx, tz) + 2.5;
          a.dur = Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz) / 24 + 0.8; a.u = 0; a.state = H_STOOP;
          if (prey) this.lastStoop = { id: a.id, prey: SPECIES[prey.sp].code, t: this.time };
          this.emit('stoop', { animal: a, x: a.x, y: a.y, z: a.z, target: cov || prey });
        } else a.t = 15 + r() * 30;
      }
    } else if (a.state === H_STOOP) {
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, ox = a.x, oy = a.y, oz = a.z, e = u * u * (1.6 - 0.6 * u);   // tips over slowly, then falls fast
      a.x = a.sx + (a.tx - a.sx) * e; a.z = a.sz + (a.tz - a.sz) * e; a.y = a.sy + (a.ty - a.sy) * e;
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = damp(a.pitch, -Math.atan2(vy, vh + 1e-5) * 0.9, 4, dt); a.roll = damp(a.roll, 0, 4, dt);
      a.amp = damp(a.amp, 0, 6, dt); a.pose = damp(a.pose, u > 0.15 ? 0.75 : 0.2, 3, dt);   // wings swept back
      if (u > 0.9 && a.group) { this.flushCovey(a.group, a.x, a.z, 'hawk'); a.group = null; }
      if (u >= 1) { a.state = H_PULL; a.t = 2.5; a.speed = 18; }
    } else {   // H_PULL: wings open, flap up out of the dive, then rejoin a circle and climb in it
      a.speed = damp(a.speed, 9, 0.8, dt);
      a.x += Math.sin(a.yaw) * a.speed * dt; a.z += Math.cos(a.yaw) * a.speed * dt;
      a.y = Math.max(a.y + 3.5 * dt, H.atXZ(a.x, a.z) + 2);
      a.pitch = damp(a.pitch, 0.35, 3, dt); a.pose = damp(a.pose, 0, 6, dt); a.amp = damp(a.amp, 1, 6, dt); a.phase += dt * TAU * 3;
      if (a.t <= 0) {
        this.joinCircle(a, 40 + r() * 45, r() < 0.5 ? 1 : -1);
        a.alt = 100 + r() * 150; a.state = H_SOAR; a.t = 50 + r() * 70;
      }
    }
  }
  tvUpdate(a, dt) {
    const r = a.rng, H = this.heights; a.t -= dt; a.air = 1;
    // teetering: an uneven rock on the dihedral, the vulture's signature at any distance
    const rock = 0.2 * Math.sin(this.time * 1.7 + a.rock) + 0.09 * Math.sin(this.time * 3.3 + a.rock * 2.1);
    if (a.state === V_SOAR) {
      if (a.carr && (a.carr.gone || a.carr.carrionUntil < this.time)) { a.carr = null; a.alt = 40 + r() * 140; }
      if (!a.carr && this.carrion.length && r() < dt * 0.3) { const c = this.carrionNear(a.x, a.z, CARRION.scavR * 2); if (c) { a.carr = c; a.t = 60 + r() * 90; } }
      if (a.carr) {   // the circle slides over the carrion and tightens and lowers
        const k = Math.min(1, dt * 0.06); a.cx += (a.carr.x - a.cx) * k; a.cz += (a.carr.z - a.cz) * k; a.alt = damp(a.alt, 28, 0.08, dt); a.R = damp(a.R, 28, 0.08, dt);
      }
      a.cx += 0.4 * dt; a.cz += 0.2 * dt;   // drifts on the breeze
      const bank = this.circle(a, dt, 30);
      a.roll = damp(a.roll, bank * 0.8 + rock, 3, dt); a.pitch = damp(a.pitch, 0.05, 2, dt);
      if (a.t <= 0) {   // set off on a long straight glide, quartering the slopes, back toward home if strayed
        const hx = a.hx - a.x, hz = a.hz - a.z, hd = Math.hypot(hx, hz);
        const ang = hd > 250 ? Math.atan2(hx, hz) + (r() - 0.5) * 0.6 : a.yaw + (r() - 0.5) * 1.2;
        const d = 150 + r() * 200;
        a.sx = a.x; a.sz = a.z; a.tx = a.x + Math.sin(ang) * d; a.tz = a.z + Math.cos(ang) * d;
        a.alt = 40 + r() * 140; a.u = 0; a.dur = d / a.V; a.state = V_GLIDE;
      }
    } else {   // V_GLIDE
      a.u = Math.min(1, a.u + dt / a.dur);
      const want = Math.atan2(a.tx - a.sx, a.tz - a.sz);
      a.yaw += wrapAngle(want - a.yaw) * Math.min(1, dt * 0.6);   // turns out of the circle onto the line
      a.x += Math.sin(a.yaw) * a.V * dt; a.z += Math.cos(a.yaw) * a.V * dt;
      a.y = damp(a.y, Math.max(H.atXZ(a.x, a.z) + a.alt, H.atXZ(a.x, a.z) + 30), 0.15, dt);
      a.roll = damp(a.roll, rock * 1.2, 3, dt); a.pitch = damp(a.pitch, 0.05, 2, dt);
      if (a.u >= 1) { this.joinCircle(a, 50 + r() * 60, r() < 0.5 ? 1 : -1); a.state = V_SOAR; a.t = 40 + r() * 80; }
    }
    a.amp = damp(a.amp, 0, 3, dt); a.pose = damp(a.pose, 0, 3, dt);   // hardly ever flaps
  }

  // ---- gray fox, coyote, mountain lion ------------------------------------------------------------
  // One state machine for the three (MAMMAL holds what differs). The group's leader (or a lone animal) chooses:
  // stand alert, sniff and forage (the canids end some of it in a mouse pounce), move off within its home range at
  // a walk or a trot, and, for the lion, stalk (slow, low, head down) with crouched waits, the tail tip twitching.
  // Out of its active hours it walks to the group's bed spot (an oak's foot for the fox and the lion) and beds.
  // Followers (a coyote's mate, a lioness's young) keep a slot behind the leader on the move, near it otherwise,
  // and bed beside it. A low player within cfg.flee sends it off (cool-down 6 s); a fox may run up a leaning oak.
  mmStart(a, x, z) {
    const g = a.group, r = a.rng;
    a.hx = g.hx; a.hz = g.hz; a.rock = r() * 100;
    if (!MAMMAL[a.sp].active(this.hour)) { a.x = g.bx + a.ox; a.z = g.bz + a.oz; a.state = M_BED; a.pose = this.poseMax[a.sp]; a.t = 5 + r() * 20; }
    else { a.x = x + a.ox; a.z = z + a.oz; a.state = M_STAND; a.t = r() * 4; }
    a.yaw = r() * TAU; a.y = this.heights.atXZ(a.x, a.z);
  }
  landOK(x, z) { const c = this.tile.habitat.at(x, -z); return c && c !== 7 && x > 5 && -z > 5 && x < this.tile.size - 5 && -z < this.tile.size - 5; }
  // A point d m off in direction ang (radians from +x), pulled back to within `range` of home; dry land, a few tries.
  mmPoint(a, dMin, dMax, range, ang = null) {
    const r = a.rng; let x = a.x, z = a.z;
    for (let k = 0; k < 4; k++) {
      const th = ang ?? r() * TAU, d = dMin + r() * (dMax - dMin);
      x = a.x + Math.cos(th) * d; z = a.z + Math.sin(th) * d;
      const hx = x - a.hx, hz = z - a.hz, hd = Math.hypot(hx, hz);
      if (hd > range) { x = a.hx + hx / hd * range; z = a.hz + hz / hd * range; }
      if (this.landOK(x, z)) break;
      ang = null;
    }
    a.tx = x; a.tz = z;
  }
  mmGo(a, speed, next, state = M_MOVE) { a.speed = speed; a.next = next; a.state = state; }
  // Step toward (tx, tz) at a.speed, turning smoothly (an arc), straight in for the last metre and a half. true on arrival.
  mmStep(a, dt, speed, turn = 3) {
    const ex = a.tx - a.x, ez = a.tz - a.z, d = Math.hypot(ex, ez), step = speed * dt;
    if (d <= Math.max(step, 0.05)) { a.x = a.tx; a.z = a.tz; return true; }
    a.yaw += wrapAngle(Math.atan2(ex, ez) - a.yaw) * Math.min(1, dt * turn);
    if (d < 1.5) { a.x += ex / d * step; a.z += ez / d * step; }
    else { a.x += Math.sin(a.yaw) * step; a.z += Math.cos(a.yaw) * step; }
    return false;
  }
  mmNext(a, act) {
    const r = a.rng, cfg = MAMMAL[a.sp], g = a.group, q = r();
    if (!act) { a.tx = g.bx + a.ox; a.tz = g.bz + a.oz; this.mmGo(a, cfg.walk, M_BED); return; }
    if (this.huntStart(a)) return;   // prey in reach: a stalk (the lion) or a trot at it (HUNT above)
    if (a.sp === CY && this.carrion.length && this.time > (a.fedAt || 0)) {   // carrion about: trot to it and nose it over
      const c = this.carrionNear(a.x, a.z, 200);
      if (c) { a.tx = c.x + (r() - 0.5) * 2; a.tz = c.z + (r() - 0.5) * 2; a.fedAt = this.time + CARRION.t; this.mmGo(a, cfg.trot, M_SNIFF); return; }
    }
    if (a.sp === ML && q < 0.45) { this.mmPoint(a, 15, 40, cfg.range); a.speed = 0.35; a.state = M_STALK; a.t = 4 + r() * 6; return; }
    if (q < 0.5) {
      const far = a.sp === CY ? [30, 120] : a.sp === FX ? [15, 60] : [40, 150];
      this.mmPoint(a, far[0], far[1], cfg.range);
      const trot = a.sp === CY ? r() < 0.6 : a.sp === FX ? r() < 0.4 : false;
      this.mmGo(a, trot ? cfg.trot : cfg.walk, M_STAND); return;
    }
    if (q < 0.8) { a.state = M_SNIFF; a.t = 3 + r() * 7; return; }
    a.state = M_STAND; a.t = 2 + r() * 4;
  }
  mmUpdate(a, dt, px, py, pz) {
    const r = a.rng, cfg = MAMMAL[a.sp], g = a.group, H = this.heights, act = cfg.active(this.hour), lion = a.sp === ML;
    const pmax = this.poseMax[a.sp];
    a.t -= dt; a.cool -= dt;
    let speed = 0, wantPose = 0, wantFlick = 0, twitch = 0;
    const treed = a.state === M_CLIMB || a.state === M_TREE || a.state === M_DOWN || (a.state === M_FLEE && a.next === M_CLIMB);
    // a low player (or an AI hunter of it: a coyote from a lion; threat()) close by: off (bedded canids sit tighter;
    // the lion slinks off at its full distance). A hunt is dropped.
    const T = this.threat(a.sp, a, a.x, a.y, a.z, px, py, pz), tn = T.n; px = T.x; py = T.y; pz = T.z;
    const dx = a.x - px, dz = a.z - pz, dh = Math.hypot(dx, dz);
    if (!treed && a.cool <= 0 && a.state !== M_FLEE && py - a.y < 30 && this.danger(a.sp, a, dh, cfg.flee * (a.state === M_BED && !lion ? 0.6 : 1), tn)) {
      a.cool = 6; a.lift = 0; if (a.hunt) { a.hunt = null; a.rush = 0; a.huntAt = this.time + 20; }
      const o = cfg.climb && r() < cfg.climb ? this.nearestOak(a.x, a.z, 14) : null;
      if (o && forkHeight(o) > 2) {   // a gray fox up a tree
        a.tree = o; a.face = Math.atan2(a.x - o.x, a.z - o.z);
        const t = trunkAt(o, 0, this._t), rr = t.r + 0.1;
        a.tx = t.x + Math.sin(a.face) * rr; a.tz = t.z + Math.cos(a.face) * rr; this.mmGo(a, cfg.run * 0.8, M_CLIMB, M_FLEE);
      } else {
        this.mmPoint(a, cfg.fleeTo[0], cfg.fleeTo[1], cfg.range + 80, Math.atan2(dz, dx) + (r() - 0.5) * 0.8);
        this.mmGo(a, lion ? cfg.trot : dh < cfg.flee * 0.5 ? cfg.run : cfg.trot * 1.15, M_STAND, M_FLEE);
      }
    }
    const L = g && g.leader !== a && g.leader && this.alive(g.leader) ? g.leader : null;
    if (L && a.state !== M_FLEE && !treed) {
      // follower: bed beside the leader, keep a slot behind it on the move, stay near it otherwise
      const lbed = L.state === M_BED || (L.state === M_MOVE && L.next === M_BED), moving = L.state === M_MOVE || L.state === M_FLEE || L.state === M_STALK || L.state === M_RUSH;
      const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw), back = 1.2 + a.rank * 1.4 * a.size + (lion ? 0.6 : 0);
      if (lbed) { a.tx = g.bx + a.ox; a.tz = g.bz + a.oz; }
      else if (moving) { a.tx = L.x - fx * back + fz * a.ox * 0.4; a.tz = L.z - fz * back - fx * a.ox * 0.4; }
      else { a.tx = L.x + a.ox; a.tz = L.z + a.oz; }
      const d = Math.hypot(a.tx - a.x, a.tz - a.z);
      if (d > (moving ? 0.4 : lbed ? 0.6 : 3)) {
        speed = Math.min(Math.max(L.speed * 1.25, cfg.walk), Math.max(cfg.walk * 0.6, d * 1.2));
        if (L.state === M_FLEE || L.state === M_RUSH) speed = Math.max(speed, L.speed);
        this.mmStep(a, dt, speed); a.state = M_MOVE; a.next = M_STAND;
        if (L.state === M_STALK) { wantPose = 0.45; wantFlick = 0.25; }
      } else {
        a.state = lbed ? M_BED : L.state === M_SNIFF || L.state === M_CROUCH || L.state === M_STALK ? L.state : M_STAND;
        if (a.state === M_STALK) a.state = M_CROUCH;
      }
      if (a.state === M_BED) wantPose = pmax;
      else if (a.state === M_CROUCH) { wantPose = pmax; wantFlick = 0.15; twitch = 1; }
      else if (a.state === M_SNIFF) wantFlick = 1;
      else if (a.state === M_STAND) wantFlick = -0.3;
    } else switch (a.state) {
      case M_BED:
        wantPose = pmax;
        if (act && a.t <= 0) { a.state = M_STAND; a.t = 2 + r() * 4; }
        else if (!act) a.t = Math.max(a.t, 3);
        break;
      case M_STAND:
        wantFlick = -0.3;   // head up, alert
        if (a.t <= 0) this.mmNext(a, act);
        break;
      case M_SNIFF:
        wantFlick = 1;
        if (r() < dt * 0.4) a.yaw += (r() - 0.5) * 1.2;
        if (a.t <= 0) {
          if (act && this.huntStart(a)) break;   // a vole, rabbit, jackrabbit or ground squirrel in reach: after it
          if (cfg.pounce && r() < cfg.pounce) {   // a mouse pounce: up and over onto the forepaws
            const d = (a.sp === CY ? 1.5 : 1.1) + r() * 0.8;
            a.sx = a.x; a.sz = a.z; a.tx = a.x + Math.sin(a.yaw) * d; a.tz = a.z + Math.cos(a.yaw) * d;
            a.u = 0; a.dur = 0.55 + d * 0.1; a.peak = a.sp === CY ? 0.6 : 0.45; a.state = M_POUNCE;
          } else this.mmNext(a, act);
        }
        break;
      case M_POUNCE: {
        a.u = Math.min(1, a.u + dt / a.dur);
        const u = a.u; a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u;
        a.lift = a.peak * Math.sin(Math.PI * u); a.pitch = -0.6 * Math.cos(Math.PI * u);
        wantFlick = u > 0.55 ? 1 : -0.3; a.amp = 0;
        if (u >= 1) { a.lift = 0; a.state = M_SNIFF; a.t = 2 + r() * 3; }
        break;
      }
      case M_MOVE: case M_FLEE:
        if (a.state === M_MOVE && a.next !== M_BED && act && r() < dt * 0.5 && this.huntStart(a)) break;   // prey seen on the way
        speed = a.speed;
        if (this.mmStep(a, dt, speed, a.state === M_FLEE ? 4 : 2.5)) {
          const fled = a.state === M_FLEE;
          a.state = a.next; speed = 0;
          if (a.state === M_BED) a.t = 20 + r() * 40;
          else if (a.state === M_CLIMB) { a.h = 0; a.pose = 0; }
          else { a.t = fled ? 4 + r() * 5 : 2 + r() * 4; if (fled) a.yaw = Math.atan2(px - a.x, pz - a.z); }   // looks back
        }
        if (lion && a.state === M_FLEE) { wantPose = 0.35; wantFlick = 0.2; }   // slinks, low
        break;
      case M_STALK:
        speed = 0.35; wantPose = 0.45; wantFlick = 0.25; twitch = 0.6;
        if (a.hunt) {   // a hunt (huntStart): walk in low, creep the last HUNT.near m; rush from HUNT.rush m or when it breaks
          const t = a.hunt, d = this.huntAlive(t) ? Math.hypot(t.x - a.x, t.z - a.z) : Infinity, broke = d < Infinity && this.fled(t);
          if (d > HUNT.lose || this.time > a.huntEnd || (broke && d > HUNT.rushFar)) { speed = 0; this.huntOver(a, M_STAND); break; }
          a.tx = t.x; a.tz = t.z;
          if (d < HUNT.rush || broke) {
            a.state = M_RUSH; a.rush = 1; a.t = HUNT.rushT[0] + r() * (HUNT.rushT[1] - HUNT.rushT[0]); a.speed = cfg.run;
            this.lastRush = { id: a.id, d, t: this.time, broke };
            break;
          }
          speed = a.speed = d > HUNT.near ? cfg.walk : HUNT.stalk;
          this.mmStep(a, dt, speed, 1.5);
          break;
        }
        if (act && r() < dt * 0.2 && this.huntStart(a)) break;   // a stalk with prey in reach becomes a hunt
        if (this.mmStep(a, dt, speed, 1.5)) { a.state = M_STAND; a.t = 3 + r() * 4; }
        else if (a.t <= 0) { a.state = M_CROUCH; a.t = 3 + r() * 5; }
        break;
      case M_RUSH: {   // a hunt: the lion's rush (a.rush) at its run for a.t s; a canid's trot at the prey, a run if it bolts
        const t = a.hunt, d = t && this.huntAlive(t) ? Math.hypot(t.x - a.x, t.z - a.z) : Infinity;
        if (d === Infinity) { this.huntOver(a, lion ? M_STAND : M_SNIFF); break; }
        a.tx = t.x; a.tz = t.z;
        if (lion && a.rush && !a.rolled && d < CARRION.reach[ML]) {   // the rush reaches it: a kill, or it twists away
          a.rolled = 1;
          if (KILLABLE.has(t.sp) && r() < CARRION.lionCatch) { this.kill(t, a); this.huntOver(a, M_STAND); a.t = CARRION.feed; break; }
        }
        if (!lion && d < HUNT.pounceD) {   // on it: the pounce (a kill with CARRION.canidCatch)
          const L = Math.min(d, 2.2);
          a.yaw = Math.atan2(t.x - a.x, t.z - a.z);
          a.sx = a.x; a.sz = a.z; a.tx = a.x + Math.sin(a.yaw) * L; a.tz = a.z + Math.cos(a.yaw) * L;
          a.u = 0; a.dur = 0.55 + L * 0.1; a.peak = a.sp === CY ? 0.6 : 0.45;
          if (KILLABLE.has(t.sp) && r() < CARRION.canidCatch) this.kill(t, a);
          this.huntOver(a, M_POUNCE); this.lastPounce = { id: a.id, prey: SPECIES[t.sp].code, t: this.time };
          break;
        }
        if (!a.rush) {
          if (this.fled(t) && t.sp !== VO) { a.rush = 1; a.t = HUNT.chaseT[0] + r() * (HUNT.chaseT[1] - HUNT.chaseT[0]); }   // it bolts
          else if (this.time > a.huntEnd || d > HUNT.canidR * 1.5) { this.huntOver(a, M_SNIFF); break; }
        } else if (a.t <= 0) { speed = 0; this.huntOver(a, lion ? M_STAND : M_SNIFF); break; }
        speed = a.speed = a.rush ? cfg.run : cfg.trot;
        wantPose = lion ? 0.2 : 0; wantFlick = a.rush ? 0.3 : 0.6;
        this.mmStep(a, dt, speed, a.rush ? 5 : 4);
        break;
      }
      case M_CROUCH:
        wantPose = pmax; wantFlick = 0.15; twitch = 1;
        if (a.t <= 0) { if (r() < 0.6) { a.state = M_STALK; a.t = 4 + r() * 6; } else { a.state = M_STAND; a.t = 2 + r() * 3; } }
        break;
      case M_CLIMB: case M_DOWN: {   // up (or down) the trunk, nose to the bark
        const up = a.state === M_CLIMB, top = Math.min(forkHeight(a.tree), 3.5);
        a.h += (up ? 1.3 : -1.0) * dt; speed = 1.2;
        const t = trunkAt(a.tree, Math.max(0, Math.min(a.h, top)), this._t), rr = t.r + 0.1;
        a.x = t.x + Math.sin(a.face) * rr; a.y = t.y; a.z = t.z + Math.cos(a.face) * rr;
        a.pitch = up ? -1.15 : 1.0; a.yaw = up ? a.face + Math.PI : a.face;
        if (up && a.h >= top) { a.state = M_TREE; a.t = 20 + r() * 25; const d = 0.7 * a.tree.scale; a.x += Math.sin(a.face) * d; a.z += Math.cos(a.face) * d; a.pitch = 0; }
        else if (!up && a.h <= 0) { a.state = M_STAND; a.t = 2 + r() * 3; a.pitch = 0; a.cool = 4; }
        break;
      }
      case M_TREE:   // lying along a limb, watching
        wantPose = 0.5; wantFlick = -0.2;
        if (a.t <= 0 && !(py - a.y < 30 && dh < cfg.flee)) { a.state = M_DOWN; a.h = Math.min(forkHeight(a.tree), 3.5); }
        break;
    }
    // gait: amplitude by speed (walk, trot, gallop) and the gait selector to the fore-against-hind gallop
    a.amp = damp(a.amp, a.state === M_POUNCE ? 0 : speed < 0.05 ? 0 : speed < cfg.trot * 0.75 ? 0.75 : speed < cfg.trot * 1.4 ? 1 : 1.25, 5, dt);
    a.e3 = damp(a.e3, speed > cfg.trot * 1.4 ? 1 : 0, 4, dt);
    a.phase += dt * TAU * speed / (cfg.stride * a.size * (0.8 + 0.25 * speed));
    a.pose = damp(a.pose, Math.min(wantPose, pmax), 2, dt);
    a.flick = damp(a.flick, wantFlick, 3, dt);
    a.e1 = damp(a.e1, twitch * 0.7 * Math.sin(this.time * 3.3 + a.rock) * (Math.sin(this.time * 0.6 + a.rock) > 0.1 ? 1 : 0.15), 8, dt);
    if (a.state === M_CLIMB || a.state === M_DOWN) return;
    if (a.state === M_TREE) { a.y = trunkAt(a.tree, Math.min(forkHeight(a.tree), 3.5), this._t).y + 0.15 - this.drops[a.sp] * a.pose * a.size; return; }
    const half = cfg.half * a.size, sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    const hf = H.atXZ(a.x + sy * half, a.z + cy * half), hb = H.atXZ(a.x - sy * half, a.z - cy * half);
    if (a.state !== M_POUNCE) a.pitch = damp(a.pitch, -Math.atan2(hf - hb, 2 * half) * 0.8, 6, dt);
    a.y = Math.min(hf, hb) * 0.5 + H.atXZ(a.x, a.z) * 0.5 - this.drops[a.sp] * a.pose * a.size + a.lift;
  }

  // ---- brush rabbit -------------------------------------------------------------------------------
  // Out of cover (its form, a.hx/hz: under an oak or in the brush) at dawn and dusk to feed within ~7 m of it in short
  // hops, nibbling, now and then sitting up; in the form through the day. A low player inside ~22 m: it freezes; inside
  // ~9 m (or still within 15 m when the freeze ends) it bolts for cover in a zig-zag bound, the white tail up, and
  // sits tight there.
  rbBolt(a, px, pz) {
    const r = a.rng, toCover = Math.hypot(a.hx - a.x, a.hz - a.z), coverToP = Math.hypot(a.hx - px, a.hz - pz), meToP = Math.hypot(a.x - px, a.z - pz);
    if (toCover > 1 && coverToP > meToP * 0.8) {   // cover is not past the player: into it and a little beyond
      const ang = Math.atan2(a.hz - pz, a.hx - px), d = 1 + r() * 2;
      a.tx = a.hx + Math.cos(ang) * d; a.tz = a.hz + Math.sin(ang) * d;
    } else { const ang = Math.atan2(a.z - pz, a.x - px) + (r() - 0.5) * 0.6, d = 8 + r() * 8; a.tx = a.x + Math.cos(ang) * d; a.tz = a.z + Math.sin(ang) * d; a.hx = a.tx; a.hz = a.tz; }
    a.state = B_BOLT; a.speed = 5 + r(); a.zigT = 0;
  }
  rbHop(a, d, next) {
    const r = a.rng, ang = r() * TAU;
    let x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
    const hx = x - a.hx, hz = z - a.hz, hd = Math.hypot(hx, hz);
    if (hd > 7) { x = a.hx + hx / hd * 7; z = a.hz + hz / hd * 7; }
    a.tx = x; a.tz = z; a.state = B_HOP; a.next = next; a.speed = 1.1;
  }
  rbUpdate(a, dt, px, py, pz) {
    const r = a.rng, H = this.heights, hr = this.hour, act = hr < 9.5 || hr > 16.5;
    a.t -= dt;
    const T = this.threat(RB, a, a.x, a.y, a.z, px, py, pz), tn = T.n; px = T.x; py = T.y; pz = T.z;   // the player or an AI hunter
    const near = py - a.y < 20 ? Math.hypot(a.x - px, a.z - pz) : Infinity;
    if (a.state !== B_BOLT && this.danger(RB, a, near, 9, tn)) this.rbBolt(a, px, pz);
    else if (this.alert(RB, near, tn) && (a.state === B_FORAGE || (a.state === B_HOP && a.next !== B_FORM) || a.state === B_SIT)) { a.state = B_FREEZE; a.t = 4 + r() * 6; }
    let speed = 0, lift = 0, wantPose = 0, wantFlick = 0;
    switch (a.state) {
      case B_FORM:
        if (a.t <= 0) { if (act && near > 30) { const ang = r() * TAU; a.tx = a.hx + Math.cos(ang) * (2 + r() * 5); a.tz = a.hz + Math.sin(ang) * (2 + r() * 5); a.state = B_HOP; a.next = B_FORAGE; a.speed = 1.1; } else a.t = 5 + r() * 10; }
        break;
      case B_FORAGE:
        if (r() < dt * 1.2) a.flickV = 1;   // nibbling
        if (a.t <= 0) {
          const q = r();
          if (!act) { a.tx = a.hx; a.tz = a.hz; a.state = B_HOP; a.next = B_FORM; a.speed = 1.1; }
          else if (q < 0.2) { a.state = B_SIT; a.t = 2 + r() * 3; }
          else this.rbHop(a, 0.3 + r() * 1.2, B_FORAGE);
        }
        break;
      case B_SIT: wantPose = 1; if (a.t <= 0) { a.state = B_FORAGE; a.t = 2 + r() * 5; } break;
      case B_FREEZE:
        if (a.t <= 0) {   // still close: bolt; still about: hop quietly back into cover; gone: feed again
          if (near < 15) this.rbBolt(a, px, pz);
          else if (near < 22) { a.tx = a.hx; a.tz = a.hz; a.state = B_HOP; a.next = B_FORM; a.speed = 1.4; }
          else { a.state = B_FORAGE; a.t = 1 + r() * 3; }
        }
        break;
      case B_HOP: case B_BOLT: {
        const bolt = a.state === B_BOLT;
        speed = a.speed;
        if (bolt && (a.zigT -= dt) <= 0) { a.zig = (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.5); a.zigT = 0.35 + r() * 0.4; }   // zig-zag
        const ex = a.tx - a.x, ez = a.tz - a.z, d = Math.hypot(ex, ez), step = speed * dt;
        if (d <= step) {
          a.x = a.tx; a.z = a.tz; speed = 0; a.zig = 0;
          if (bolt) { a.state = B_FORM; a.t = 15 + r() * 20; } else { a.state = a.next; a.t = a.next === B_FORM ? 20 + r() * 30 : 1.5 + r() * 4; }
        } else {
          const want = Math.atan2(ex, ez) + (bolt && d > 2 ? a.zig : 0);
          a.yaw += wrapAngle(want - a.yaw) * Math.min(1, dt * (bolt ? 12 : 8));
          a.x += Math.sin(a.yaw) * step; a.z += Math.cos(a.yaw) * step;
          lift = (bolt ? 0.13 : 0.06) * Math.max(0, Math.sin(a.phase));
        }
        if (bolt) wantFlick = 0.8;   // the tail up: the white flash
        break;
      }
    }
    a.amp = damp(a.amp, speed > 0.05 ? 1 : 0, 10, dt);
    a.phase += dt * TAU * speed / (speed > 2 ? 0.9 : 0.32);
    a.pose = damp(a.pose, wantPose, 5, dt);
    if (wantFlick) a.flick = damp(a.flick, wantFlick, 8, dt);
    a.pitch = damp(a.pitch, speed > 0.05 ? -0.18 * Math.cos(a.phase) : 0, 12, dt);
    a.y = H.atXZ(a.x, a.z) + lift;
  }

  // ---- black-tailed jackrabbit --------------------------------------------------------------------
  // By day hunched in its form (a.hx/hz; pose JACK.hunch); about at dawn, dusk and night, and a few by day (a.u1):
  // it lopes 10-40 m out to a feeding ground (a.bx/bz) and feeds there in short hops (0.3-0.6 m) with the head down
  // for a few seconds at a time (a.look, a.wait), sits up now and then, lopes on to another patch within JACK.range m
  // of the form; back to the form (beside a shrub if the near set has one) when it is light. A low player within
  // JACK.freeze m: it freezes, ears up, for 1-4 s (in the form, longer: it sits tight) and then, if the player is still
  // inside it, bolts (at once inside JACK.flush m): ~14 m/s away from the player in bounds to ~6 m, 15-30 degrees to
  // one side of that line and then the other, a 30-60 degree turn every 2-4 bounds (a.zig, a.zigT counts bounds;
  // turned back off water and the tile edge),
  // a high bound now and then (a.peak), for 60-150 m (a.u), then a lope and a sit, looking back (a.sx/sz).
  jkActive(a) { const h = this.hour; return h < 8 || h > 17.5 || a.u1 < 0.08; }
  jkGo(a, x, z, speed, next) { a.tx = x; a.tz = z; a.speed = speed; a.next = next; a.state = JK_HOP; }
  jkLope(a) { return JACK.lope[0] + a.rng() * (JACK.lope[1] - JACK.lope[0]); }
  jkBolt(a, px, pz) {
    const r = a.rng;
    if (a.state !== JK_HOP) a.speed = 2;
    a.state = JK_BOLT; a.sx = px; a.sz = pz; a.u = JACK.run[0] + r() * (JACK.run[1] - JACK.run[0]);
    a.zig = (r() < 0.5 ? -1 : 1) * (0.26 + r() * 0.26); a.zigT = 2 + Math.floor(r() * 3); a.peak = 1;
  }
  jkUpdate(a, dt, px, py, pz) {
    const r = a.rng, H = this.heights, act = this.jkActive(a);
    a.t -= dt;
    const T = this.threat(JR, a, a.x, a.y, a.z, px, py, pz), tn = T.n; px = T.x; py = T.y; pz = T.z;   // the player or an AI hunter
    const near = py - a.y < JACK.low ? Math.hypot(a.x - px, a.z - pz) : Infinity;
    if (a.state !== JK_BOLT) {
      const form = a.state === JK_FORM || (a.state === JK_FREEZE && a.next === JK_FORM);
      if (this.danger(JR, a, near, form ? JACK.formFlush : JACK.flush, tn)) this.jkBolt(a, px, pz);
      else if (this.alert(JR, near, tn) && a.state !== JK_FREEZE) {
        a.next = a.state === JK_FORM ? JK_FORM : JK_FEED; a.state = JK_FREEZE; a.speed = 0;
        a.t = a.next === JK_FORM ? 4 + r() * 6 : 1 + r() * 3; a.sx = px; a.sz = pz;
      }
    }
    let speed = 0, wantPose = 0, wantFlick = 0;
    switch (a.state) {
      case JK_FORM:
        wantPose = JACK.hunch;
        if (a.t <= 0) {
          if (act && near > JACK.freeze) {   // out to feed: a point 10-40 m off on dry land
            for (let k = 0; k < 4; k++) {
              const ang = r() * TAU, d = JACK.out[0] + r() * (JACK.out[1] - JACK.out[0]);
              a.bx = a.hx + Math.cos(ang) * d; a.bz = a.hz + Math.sin(ang) * d;
              if (this.landOK(a.bx, a.bz)) break;
            }
            this.jkGo(a, a.bx, a.bz, this.jkLope(a), JK_FEED);
          } else a.t = 5 + r() * 10;
        }
        break;
      case JK_FEED:
        if ((a.wait -= dt) <= 0) { a.look = a.look ? 0 : 1; a.wait = a.look ? 1 + r() * 2.5 : 0.6 + r() * 1.5; }
        wantFlick = a.look ? 0.9 : 0;   // head down, cropping; then up, chewing and watching
        if (a.look && r() < dt * 2) a.flickV = 0.5;
        if (a.t <= 0) {
          const q = r();
          if (!act) {   // light: home to the form, beside a shrub if one is near it now
            const sh = this.shrubSpot(a.hx, a.hz, 10); if (sh) { a.hx = sh.x; a.hz = sh.z; }
            this.jkGo(a, a.hx, a.hz, this.jkLope(a), JK_FORM);
          } else if (q < 0.12) { a.state = JK_SIT; a.t = 2 + r() * 4; a.look = 0; }
          else if (q < 0.22) {   // on to another patch, within range of the form
            const ang = r() * TAU, d = 5 + r() * 15;
            let x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
            const hx = x - a.hx, hz = z - a.hz, hd = Math.hypot(hx, hz);
            if (hd > JACK.range) { x = a.hx + hx / hd * JACK.range; z = a.hz + hz / hd * JACK.range; }
            if (this.landOK(x, z)) this.jkGo(a, x, z, this.jkLope(a), JK_FEED); else a.t = 1 + r() * 2;
          } else {   // a short hop: 0.3-0.6 m
            const ang = a.yaw + (r() - 0.5) * 2.2, d = 0.3 + r() * 0.3;
            this.jkGo(a, a.x + Math.sin(ang) * d, a.z + Math.cos(ang) * d, JACK.hop, JK_FEED);
          }
        }
        break;
      case JK_SIT: wantPose = 1; if (a.t <= 0) { a.state = JK_FEED; a.t = 1 + r() * 3; } break;
      case JK_FREEZE:
        wantPose = a.next === JK_FORM ? JACK.hunch * 0.3 : JACK.alert;   // ears up, still; in the form it raises its head a little
        if (a.t <= 0) {
          if (near < JACK.freeze) this.jkBolt(a, px, pz);
          else if (near < JACK.freeze * 1.5) a.t = 1 + r() * 2;   // still about: stay still
          else { a.state = a.next; a.t = a.next === JK_FORM ? 10 + r() * 20 : 1 + r() * 3; }
        }
        break;
      case JK_HOP: {
        speed = a.speed;
        if (this.mmStep(a, dt, speed, speed > 2 ? 6 : 10)) {
          speed = 0; a.state = a.next;
          if (a.state === JK_FORM) { a.t = 30 + r() * 60; a.yaw += (r() - 0.5) * 2; }
          else if (a.state === JK_SIT) { a.t = 3 + r() * 4; a.yaw = Math.atan2(a.sx - a.x, a.sz - a.z); }   // looks back
          else a.t = 1.5 + r() * 4;
        }
        break;
      }
      case JK_BOLT: {
        speed = a.speed = Math.min(JACK.bolt * (0.9 + 0.15 * a.size), a.speed + dt * 16);   // full speed in ~1 s
        const T = near < 60 ? [px, pz] : [a.sx, a.sz]; a.sx = T[0]; a.sz = T[1];
        let want = Math.atan2(a.x - a.sx, a.z - a.sz) + a.zig;
        const ax = a.x + Math.sin(want) * 8, az = a.z + Math.cos(want) * 8;
        if (!this.landOK(ax, az)) { a.zig = -a.zig; want = Math.atan2(a.x - a.sx, a.z - a.sz) + a.zig; }
        a.yaw += wrapAngle(want - a.yaw) * Math.min(1, dt * 12);
        const step = speed * dt;
        a.x += Math.sin(a.yaw) * step; a.z += Math.cos(a.yaw) * step; a.u -= step;
        if (a.u <= 0) {   // run out: lope a few metres on and sit up, looking back
          a.zig = 0;
          const d = 4 + r() * 6;
          this.jkGo(a, a.x + Math.sin(a.yaw) * d, a.z + Math.cos(a.yaw) * d, JACK.lope[0], JK_SIT);
          a.hx = a.x + (a.hx - a.x) * 0.5; a.hz = a.z + (a.hz - a.z) * 0.5;   // a new form between here and the old one
        }
        break;
      }
    }
    // the bound: amplitude and length by speed, the body lifted through the flight phase of each bound
    const prev = a.phase, L = JACK.bound(Math.max(speed, 0.5), a.peak);
    a.amp = damp(a.amp, speed < 0.05 ? 0 : speed < 2 ? 0.7 : speed < 7 ? 1 : 1.15, 8, dt);
    a.phase += dt * TAU * speed / L;
    if (speed > 0.05 && Math.floor(a.phase / TAU) !== Math.floor(prev / TAU)) {   // a bound landed
      a.peak = a.state === JK_BOLT && r() < 0.12 ? 1.35 : 1;
      if (a.state === JK_BOLT && --a.zigT <= 0) {   // the zigzag: 15-30 degrees to the other side of the line, a 30-60 degree turn
        a.zig = -Math.sign(a.zig || 1) * (0.26 + r() * 0.26); a.zigT = 2 + Math.floor(r() * 3);
      }
    }
    const lift = speed > 0.05 ? JACK.lift(speed) * (a.peak > 1 ? 1.7 : 1) * Math.max(0, Math.sin(a.phase)) : 0;
    a.pose = damp(a.pose, wantPose, a.state === JK_FREEZE ? 8 : 4, dt);
    if (wantFlick) a.flick = damp(a.flick, wantFlick, 6, dt);
    a.pitch = damp(a.pitch, speed > 0.05 ? -0.14 * Math.cos(a.phase) * Math.min(1, speed / 4 + 0.4) : 0, 12, dt);
    a.y = H.atXZ(a.x, a.z) + lift;
  }

  // ---- California vole ----------------------------------------------------------------------------
  // Up and down its runway (a.sx/sz to a.tx/tz; a.u where it is, 0-1, a.h where it is going): scurries, stops to
  // clip grass, sits up to eat; a low player within 4 m sends it down the runway, away, into a burrow (scaled out)
  // for a while. Any hour.
  voUpdate(a, dt, px, py, pz) {
    const r = a.rng, H = this.heights, L = Math.max(0.5, Math.hypot(a.tx - a.sx, a.tz - a.sz));
    a.t -= dt;
    const T = this.threat(VO, a, a.x, a.y, a.z, px, py, pz), tn = T.n; px = T.x; py = T.y; pz = T.z;   // the player or an AI hunter
    const near = py - a.y < 4 ? Math.hypot(a.x - px, a.z - pz) : Infinity;
    if (this.danger(VO, a, near, 4, tn) && a.state !== VL_HIDE && !(a.state === VL_RUN && a.next === VL_HIDE)) {
      const d0 = Math.hypot(a.sx - px, a.sz - pz), d1 = Math.hypot(a.tx - px, a.tz - pz);
      a.h = d0 > d1 ? 0 : 1; a.speed = 1.6; a.state = VL_RUN; a.next = VL_HIDE;
    }
    let speed = 0, wantPose = 0;
    switch (a.state) {
      case VL_RUN: {
        speed = a.speed;
        const du = speed * dt / L, dir = Math.sign(a.h - a.u);
        if (Math.abs(a.h - a.u) <= du) { a.u = a.h; a.state = a.next; a.t = a.next === VL_HIDE ? 6 + r() * 14 : 1 + r() * 3; speed = 0; }
        else a.u += dir * du;
        a.yaw = Math.atan2(a.tx - a.sx, a.tz - a.sz) + (dir < 0 ? Math.PI : 0);
        break;
      }
      case VL_PAUSE:
        if (r() < dt * 1.5) a.flickV = 1;   // clipping grass
        if (a.t <= 0) {
          const q = r();
          if (q < 0.25) { a.state = VL_SIT; a.t = 1.5 + r() * 2.5; }
          else { let u = r(); if (Math.abs(u - a.u) < 0.3) u = a.u < 0.5 ? Math.min(1, a.u + 0.3 + r() * 0.4) : Math.max(0, a.u - 0.3 - r() * 0.4); a.h = u; a.speed = 0.35 + r() * 0.4; a.state = VL_RUN; a.next = VL_PAUSE; }
        }
        break;
      case VL_SIT: wantPose = 1; if (r() < dt * 2) a.flickV = 0.6; if (a.t <= 0) { a.state = VL_PAUSE; a.t = 1 + r() * 2; } break;
      case VL_HIDE: if (a.t <= 0 && near > 6) { a.state = VL_PAUSE; a.t = 2 + r() * 3; } break;
    }
    a.vis = a.state === VL_HIDE ? (a.vis < 0.03 ? 0 : damp(a.vis, 0, 14, dt)) : damp(a.vis, 1, 6, dt);
    a.x = a.sx + (a.tx - a.sx) * a.u; a.z = a.sz + (a.tz - a.sz) * a.u;
    a.amp = damp(a.amp, speed > 0.05 ? 1 : 0, 14, dt);
    a.phase += dt * TAU * speed / 0.09;
    a.pose = damp(a.pose, wantPose, 6, dt);
    a.y = H.atXZ(a.x, a.z) + 0.004 * Math.abs(Math.sin(a.phase)) * a.amp;
  }

  // ---- wild turkey --------------------------------------------------------------------------------
  // The flock is the unit (g): it forages in a loose spread round its centre, now and then walks on 15-40 m to another
  // patch of open oak woodland (the birds strung out behind), flushes up into an oak from the player (TURKEY.flush, by
  // the player's species) and comes down after 25-60 s, and flies up to roost in a tall oak at dusk, down at dawn.
  tkFlushR() { return TURKEY.flush[this.observer] ?? TURKEY.flushOther; }
  flockUpdate(g, dt, px, pz) {
    const r = this.groupRng(g, this.bySpecies[TK]); if (!r) return;
    g.t -= dt; g.cool -= dt;
    const sun = atmo.sunDir.value.y;
    if (sun < 0.04 && g.state !== TF_ROOST) {   // dusk: up to roost (a flushed flock already up stays in its tree)
      if (g.state === TF_TREE) g.state = TF_ROOST; else this.tkToTree(g, null, true);
      return;
    }
    if (g.state === TF_ROOST) { if (sun > 0.08) this.tkDown(g); return; }
    if (g.state === TF_TREE) { if (g.t <= 0) this.tkDown(g); return; }
    const near = g.near; g.near = false;
    if (near && g.cool <= 0 && !g.pilot) { this.tkFlush(g, g.nx ?? px, g.nz ?? pz); return; }   // away from the threat that was near
    if (g.pilot && (g.state === TF_FORAGE || g.state === TF_WALK)) {   // piloted: to the player's point, then forage there (pilot above)
      const ex = g.pilot.x - g.x, ez = g.pilot.z - g.z, d = Math.hypot(ex, ez);
      if (d > 2.5) { g.tx = g.pilot.x; g.tz = g.pilot.z; g.state = TF_WALK; g.speed = Math.min(2.6, 0.6 + d * 0.2); }
      else if (g.state === TF_WALK) { g.state = TF_FORAGE; g.t = 20 + r() * 40; g.speed = TURKEY.move[0]; }
    }
    if (g.state === TF_FORAGE) {
      if (g.t <= 0) {   // walk on 15-40 m to the best of a few spots among the oaks (open woodland), back toward home when strayed
        let best = -Infinity;
        for (let k = 0; k < 5; k++) {
          const ang = r() * TAU, d = 15 + r() * 25;
          let x = g.x + Math.cos(ang) * d, z = g.z + Math.sin(ang) * d;
          const hx = x - g.hx, hz = z - g.hz, hd = Math.hypot(hx, hz);
          if (hd > TURKEY.range) { x = g.hx + hx / hd * TURKEY.range; z = g.hz + hz / hd * TURKEY.range; }
          if (!this.landOK(x, z) || this.openness(x, z) < 0) continue;
          const can = this.tile.canopy.at(x, -z) / 100, sc = Math.min(1, can * 3) - Math.max(0, can - 0.7) * 2 + r() * 0.5;
          if (sc > best) { best = sc; g.tx = x; g.tz = z; }
        }
        if (best > -Infinity) { g.state = TF_WALK; g.speed = TURKEY.move[0] + r() * (TURKEY.move[1] - TURKEY.move[0]); }
        else g.t = 10 + r() * 20;
      }
    } else if (g.state === TF_WALK) {
      const ex = g.tx - g.x, ez = g.tz - g.z, d = Math.hypot(ex, ez), step = g.speed * dt;
      if (d <= step) { g.state = TF_FORAGE; g.t = 20 + r() * 40; g.speed = TURKEY.move[0]; }
      else { g.x += ex / d * step; g.z += ez / d * step; g.dx = ex / d; g.dz = ez / d; }
    }
  }
  // Flushed: up into the oak 12-70 m off that lies most nearly away from the threat; with none, the flock runs off.
  tkFlush(g, px, pz) {
    const r = this.groupRng(g, this.bySpecies[TK]);
    const ax = g.x - px, az = g.z - pz, al = Math.hypot(ax, az) || 1;
    let best = null, bs = -Infinity;
    for (let k = 0; k < 6; k++) {
      const o = this.ringOak(g.x, g.z, 12, 70, r); if (!o || treeHeight(o) < 6) continue;
      const dx = o.x - g.x, dz = o.z - g.z, dl = Math.hypot(dx, dz) || 1, sc = (dx * ax + dz * az) / (dl * al) + 0.3 * r();
      if (sc > bs) { bs = sc; best = o; }
    }
    g.cool = 60 + r() * 60;
    this.emit('turkeyFlush', { group: g, x: g.x, y: this.heights.atXZ(g.x, g.z), z: g.z, tree: best });
    if (best) { this.tkToTree(g, best, false); return; }
    g.tx = g.x + ax / al * 40; g.tz = g.z + az / al * 40; g.dx = ax / al; g.dz = az / al; g.state = TF_WALK; g.speed = 2.2;
  }
  // The flock up into an oak (a flush; or at dusk the roost, a tall oak within 60 m, else the nearest): each bird to a
  // perch on top of a limb of the drawn wood 3 m or more up, else (the wood not known: beyond the near set) a place in
  // the crown, where it is out of sight once it gets there. At dusk with no oak in reach they are simply not drawn.
  tkToTree(g, oak, roost) {
    const r = this.groupRng(g, this.bySpecies[TK]); if (!r) return;
    if (!oak && roost) oak = this.randomOak(g.x, g.z, 60, r, null, 9) || this.nearestOak(g.x, g.z, 150);
    g.state = roost ? TF_ROOST : TF_TREE; g.t = TURKEY.tree[0] + r() * (TURKEY.tree[1] - TURKEY.tree[0]); g.tree = oak;
    let k = 0;
    for (const a of this.bySpecies[TK]) if (a.group === g) {
      a.down = 0;
      if (!oak) { a.state = T_PERCH; a.hidden = 1; continue; }
      const P = this.tkPerch(oak, k++, r);
      a.tx = P.x; a.ty = P.y; a.tz = P.z; a.perchYaw = P.yaw; a.hidden = P.hidden ? 1 : 0;
      a.state = T_WAIT; a.wait = roost ? r() * 8 : a.rank * 0.05 + r() * 0.8;
    }
  }
  tkPerch(oak, k, r) {
    const out = this._tkP ||= { x: 0, y: 0, z: 0, yaw: 0, hidden: false }, rec = this.sqWood(oak);
    if (rec) {
      const Q = this.flight.perchQuery(), L = rec.sqLimbs, q = this._tkQ ||= {};
      for (let n = 0; n < L.length; n++) {
        const l = L[(k + n) % L.length], b = Q.baseS(l.st), s = b + (l.s - b) * (0.2 + 0.45 * r());
        Q.at(l.st, s, q); if (q.r < 0.035) continue;
        const yaw = Math.atan2(q.dx, q.dz) + (r() < 0.5 ? 1 : -1) * Math.PI / 2;   // across the limb
        Q.top(l.st, s, q);
        if (q.y - this.heights.atXZ(q.x, q.z) < TURKEY.roostMinH) continue;
        out.x = q.x; out.y = q.y; out.z = q.z; out.yaw = yaw; out.hidden = false;
        return out;
      }
    }
    const H = treeHeight(oak), t = trunkAt(oak, forkHeight(oak), this._t), ang = r() * TAU, d = (0.15 + 0.15 * r()) * H;
    out.x = t.x + Math.sin(ang) * d; out.y = Math.max(t.y + 1, oak.y + H * (0.45 + 0.15 * r())); out.z = t.z + Math.cos(ang) * d;
    out.yaw = r() * TAU; out.hidden = true;
    return out;
  }
  // Down from the tree (after a flush, or at dawn) to the ground 12-27 m out, staggered.
  tkDown(g) {
    const r = this.groupRng(g, this.bySpecies[TK]); if (!r) return;
    const o = g.tree, dawn = g.state === TF_ROOST, ang = r() * TAU, d = 12 + r() * 15;
    let x = (o ? o.x : g.x) + Math.cos(ang) * d, z = (o ? o.z : g.z) + Math.sin(ang) * d;
    if (!this.landOK(x, z)) { x = o ? o.x + 3 : g.x; z = o ? o.z + 3 : g.z; }
    g.x = x; g.z = z; g.state = TF_FORAGE; g.t = 10 + r() * 20; g.tree = null;
    for (const a of this.bySpecies[TK]) if (a.group === g) {
      if (!o) { a.hidden = 0; a.state = T_FORAGE; a.down = 0; continue; }   // a roost with no oak: they were just not drawn
      a.tx = x + a.ox; a.tz = z + a.oz; a.ty = this.heights.atXZ(a.tx, a.tz);
      a.state = T_WAIT; a.wait = dawn ? r() * 10 : r() * 4; a.down = 1;
    }
  }
  tkUpdate(a, dt, px, py, pz) {
    const r = a.rng, g = a.group, H = this.heights;
    a.t -= dt;
    if (a.state === T_FORAGE || a.state === T_SCRATCH) {   // the player (or an AI hunter, threat()) close to a bird on the ground: the flock flushes
      const T = this.threat(TK, g, a.x, a.y, a.z, px, py, pz);
      const dx = a.x - T.x, dy = a.y - T.y, dz = a.z - T.z, R = T.who ? TURKEY.flushOther : this.tkFlushR();
      if (this.danger(TK, g, Math.sqrt(dx * dx + dy * dy + dz * dz), R, T.n)) { g.near = true; g.nx = T.x; g.nz = T.z; }
    }
    if (a.state === T_WAIT) {   // a crouch (or a few seconds on the limb at dawn), then off
      a.wait -= dt; a.amp = damp(a.amp, 0, 8, dt); a.pose = damp(a.pose, 1, 8, dt);
      if (a.wait <= 0) {
        a.sx = a.x; a.sy = a.y; a.sz = a.z;
        const d = Math.hypot(a.tx - a.sx, a.tz - a.sz);
        a.dur = Math.max(1.4, (d + Math.max(0, a.ty - a.sy) * 1.5) / TURKEY.fly); a.u = 0; a.state = T_FLY; a.air = 1;
        a.peak = 0.6 + 0.03 * d;
      }
      return this.tkVis(a, dt);
    }
    if (a.state === T_FLY) {   // a heavy climb on beating wings, a glide on set wings, a few beats to land
      a.u = Math.min(1, a.u + dt / a.dur);
      const u = a.u, ox = a.x, oy = a.y, oz = a.z, up = a.ty > a.sy + 1;
      a.x = a.sx + (a.tx - a.sx) * u; a.z = a.sz + (a.tz - a.sz) * u;
      const k = up ? Math.sin(u * Math.PI / 2) : u * u * (3 - 2 * u);
      a.y = Math.max(H.atXZ(a.x, a.z) + 0.05, a.sy + (a.ty - a.sy) * k + a.peak * Math.sin(Math.PI * u));
      const beat = up ? u < 0.6 || u > 0.9 : u < 0.2 || u > 0.88;
      a.amp = damp(a.amp, beat ? 1 : 0, 14, dt); a.pose = damp(a.pose, 0, 12, dt);
      if (beat) a.phase += dt * TAU * TURKEY.beat; else a.phase = damp(a.phase, Math.round(a.phase / TAU) * TAU + 0.6, 6, dt);
      const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-5) a.yaw = Math.atan2(vx, vz);
      a.pitch = -Math.atan2(vy, vh + 1e-5) * 0.5;
      if (u >= 1) {
        a.air = 0; a.pitch = 0;
        if (a.down) { a.down = 0; a.state = T_FORAGE; a.t = 1 + r() * 3; a.ox = a.x - g.x; a.oz = a.z - g.z; a.hidden = 0; }
        else { a.state = T_PERCH; a.yaw = a.perchYaw; }
      }
      return this.tkVis(a, dt);
    }
    if (a.state === T_PERCH) {   // in the tree: still, a look round now and then
      a.amp = damp(a.amp, 0, 8, dt); a.pose = damp(a.pose, 1, 6, dt);
      if (r() < dt * 0.15) a.flickV = 0.4;
      return this.tkVis(a, dt);
    }
    // on the ground: a slot round the flock's centre (strung out behind it on a walk); pecks and scratches
    let tx, tz;
    if (g.state === TF_WALK) {
      const back = (a.rank % 5) * 1.6 + Math.floor(a.rank / 5) * 1.1, side = a.oz * 0.4;
      tx = g.x - g.dx * back - g.dz * side; tz = g.z - g.dz * back + g.dx * side;
    } else {
      if (a.t <= 0) {
        a.t = 2 + r() * 5; a.ox += (r() - 0.5) * 2; a.oz += (r() - 0.5) * 2;
        const od = Math.hypot(a.ox, a.oz); if (od > TURKEY.spread) { a.ox *= TURKEY.spread / od; a.oz *= TURKEY.spread / od; }
      }
      tx = g.x + a.ox; tz = g.z + a.oz;
    }
    const ex = tx - a.x, ez = tz - a.z, d = Math.hypot(ex, ez);
    let speed = 0;
    if (a.state === T_SCRATCH) {   // two or three kicks back through the litter, then a look at what turned up
      a.scr -= dt; a.phase += dt * TAU * 2.4; a.amp = damp(a.amp, 0.8, 10, dt);
      if (a.scr <= 0 || d > 2) { a.state = T_FORAGE; a.flickV = 1; }
    } else if (d > 0.3) {
      speed = Math.min(g.state === TF_WALK ? g.speed * 1.4 : TURKEY.walk, d * 0.8);
      a.x += ex / d * speed * dt; a.z += ez / d * speed * dt;
      a.yaw += wrapAngle(Math.atan2(ex, ez) - a.yaw) * Math.min(1, dt * 3);
    } else if (r() < dt * 0.9) a.flickV = 1;   // peck
    else if (r() < dt * 0.25) { a.state = T_SCRATCH; a.scr = 0.7 + r() * 0.8; }
    if (a.state !== T_SCRATCH) { a.amp = damp(a.amp, speed > 0.05 ? Math.min(1, 0.45 + speed * 0.6) : 0, 6, dt); a.phase += dt * TAU * speed / TURKEY.stride; }
    a.pose = damp(a.pose, 1, 6, dt); a.pitch = damp(a.pitch, 0, 6, dt);
    a.y = H.atXZ(a.x, a.z);
    this.tkVis(a, dt);
  }
  tkVis(a, dt) {   // hidden in the crown (the wood not known): out of sight once it is up there
    const off = a.hidden && (a.state === T_PERCH || (a.state === T_FLY && a.u > 0.85 && !a.down));
    a.vis = off ? (a.vis < 0.03 ? 0 : damp(a.vis, 0, 8, dt)) : damp(a.vis, 1, 6, dt);
  }

  // ---- California ground squirrel -----------------------------------------------------------------
  // The colony (g) is the unit: its burrow mouths (g.burrows, drawn by placeBurrows), one sentinel at a time sitting bolt
  // upright at a burrow for 15-60 s (g.watch) while the others feed low within a few metres of their own burrow, sit up
  // now and then and move on in short runs. A threat (a raven or hawk within GSQ.raptor m, the player of any other
  // species within GSQ.player m; or night) sends them all running for the nearest burrow, where they vanish; 20-40 s
  // after it has gone they come up again one by one, sit at the mouth a moment and go back to feeding.
  colonyUpdate(g, dt, px, py, pz) {
    const r = this.groupRng(g, this.bySpecies[GS]); if (!r) return;
    g.t -= dt; g.watch -= dt;
    const H = this.heights, gy = H.atXZ(g.x, g.z);
    const R = (this.observer === 'corvus_corax' || this.observer === 'buteo_jamaicensis' ? GSQ.raptor : GSQ.player) + GSQ.spread;
    let threat = this.danger(GS, g, Math.sqrt((px - g.x) ** 2 + (py - gy) ** 2 + (pz - g.z) ** 2), R);
    if (!threat) {   // an AI hunter of ground squirrels (threat(); the player out of it): a raptor at GSQ.raptor m, others at GSQ.player
      const T = this.threat(GS, g, g.x, gy, g.z, 1e7, 1e7, 1e7), h = T.who;
      if (h) threat = this.danger(GS, g, Math.sqrt((T.x - g.x) ** 2 + (T.y - gy) ** 2 + (T.z - g.z) ** 2), (h.sp === HK || h.sp === RV ? GSQ.raptor : GSQ.player) + GSQ.spread, T.n);
    }
    if (!threat) for (const h of this.bySpecies[HK]) if ((h.x - g.x) ** 2 + (h.y - gy) ** 2 + (h.z - g.z) ** 2 < (GSQ.raptor + GSQ.spread) ** 2) { threat = true; break; }
    const night = atmo.sunDir.value.y < 0.06;
    g.threat = threat;
    if ((threat || night) && g.state === C_OK) {
      g.state = C_ALARM; g.sentinel = null;
      for (const a of this.bySpecies[GS]) if (a.group === g && a.state !== G_DOWN) this.gsDive(a, a.state === G_SENTRY ? 0 : 0.15 + r() * 0.5);
      if (threat) this.emit('gsAlarm', { group: g, x: g.x, y: gy, z: g.z });
    }
    if (g.state !== C_OK) {
      if (threat || night) g.t = GSQ.down[0] + r() * (GSQ.down[1] - GSQ.down[0]);   // down while it lasts, then 20-40 s more
      else if (g.t <= 0) {
        g.state = C_OK; g.watch = 4 + r() * 6;
        for (const a of this.bySpecies[GS]) if (a.group === g) { a.state = G_DOWN; a.t = r() * 8; a.up = 1; }
      }
      return;
    }
    if (g.watch <= 0 || !g.sentinel || g.sentinel.group !== g || !this.alive(g.sentinel)) {   // a new sentinel
      const old = g.sentinel; let pick = null, seen = 0;
      for (const a of this.bySpecies[GS]) if (a.group === g && a !== old && (a.state === G_FEED || a.state === G_SIT)) { seen++; if (r() * seen < 1) pick = a; }
      if (old && old.state === G_SENTRY) { old.state = G_FEED; old.t = 1 + r() * 3; }
      g.sentinel = pick; g.watch = GSQ.watch[0] + r() * (GSQ.watch[1] - GSQ.watch[0]);
      if (pick) {
        let b = pick.hb, bd = Infinity;
        for (const c of g.burrows) { const d = Math.hypot(c.x - pick.x, c.z - pick.z); if (d < bd) { bd = d; b = c; } }
        const ang = r() * TAU; pick.tx = b.x + Math.cos(ang) * 0.2; pick.tz = b.z + Math.sin(ang) * 0.2;
        pick.speed = 1.2; pick.state = G_HOP; pick.next = G_SENTRY;
      }
    }
  }
  gsDive(a, wait) {
    const g = a.group; let b = a.hb, bd = Infinity;
    for (const c of g.burrows) { const d = Math.hypot(c.x - a.x, c.z - a.z); if (d < bd) { bd = d; b = c; } }
    a.tx = b.x; a.tz = b.z; a.state = G_DIVE; a.wait = wait; a.up = 0;
  }
  gsUpdate(a, dt) {
    const r = a.rng, g = a.group, H = this.heights;
    a.t -= dt;
    let speed = 0, pose = 0;
    switch (a.state) {
      case G_FEED:   // low in the grass, head down picking seeds; now and then a few steps on, or a sit-up to look
        if (r() < dt * 1.2) a.flickV = 1;
        if (a.t <= 0) {
          if (r() < 0.2) { a.state = G_SIT; a.t = 1 + r() * 3; }
          else {
            const b = a.hb, ang = r() * TAU, d = r() * 6;
            a.tx = b.x + Math.cos(ang) * d; a.tz = b.z + Math.sin(ang) * d; a.speed = GSQ.feed[0] + r() * (GSQ.feed[1] - GSQ.feed[0]);
            a.state = G_HOP; a.next = G_FEED;
          }
        }
        break;
      case G_HOP: case G_DIVE: {
        if (a.state === G_DIVE && a.wait > 0) { a.wait -= dt; pose = 0.4; break; }   // a startled look first
        const ex = a.tx - a.x, ez = a.tz - a.z, d = Math.hypot(ex, ez);
        speed = a.state === G_DIVE ? GSQ.run : a.speed;
        if (d <= speed * dt + 0.02) {
          a.x = a.tx; a.z = a.tz; speed = 0;
          if (a.state === G_DIVE) a.state = G_DOWN;
          else { a.state = a.next; a.t = 2 + r() * 4; }
        } else { a.x += ex / d * speed * dt; a.z += ez / d * speed * dt; a.yaw += wrapAngle(Math.atan2(ex, ez) - a.yaw) * Math.min(1, dt * 12); }
        break;
      }
      case G_SIT: pose = 0.75; if (a.t <= 0) { a.state = G_FEED; a.t = 2 + r() * 4; } break;
      case G_SENTRY: pose = 1; if (r() < dt * 0.35) a.yaw += (r() - 0.5) * 1.4; break;   // bolt upright, turning to look
      case G_DOWN:
        if (a.up && a.t <= 0) { a.up = 0; a.state = G_PEEK; a.t = 2 + r() * 3; a.x = a.hb.x; a.z = a.hb.z; a.yaw = r() * TAU; }
        break;
      case G_PEEK: pose = 0.6; if (a.t <= 0) { a.state = G_FEED; a.t = 1 + r() * 3; } break;
    }
    a.vis = a.state === G_DOWN ? (a.vis < 0.03 ? 0 : damp(a.vis, 0, 18, dt)) : damp(a.vis, 1, a.state === G_PEEK ? 3 : 6, dt);
    a.amp = damp(a.amp, speed > 0.05 ? 1 : 0, 12, dt);
    a.phase += dt * TAU * speed / (speed > 2 ? 0.32 : 0.16);
    a.pose = damp(a.pose, pose, 5, dt);
    a.y = H.atXZ(a.x, a.z) - this.drops[GS] * Math.max(0, a.pose) * a.size;
  }
  // The burrow mouths of the live colonies (a dark hole in a ring of bare dirt, tilted to the slope).
  placeBurrows() {
    const B = this.burrows, H = this.heights, M = this._m, q = this._q, p = this._p, s = this._s.setScalar(1);
    const up = this._up ||= new THREE.Vector3(0, 1, 0), n = this._bn ||= new THREE.Vector3(), cap = B.instanceMatrix.count;
    let k = 0;
    for (const g of this.colonies) for (const b of g.burrows) {
      if (k >= cap) break;
      n.set(H.atXZ(b.x - 0.3, b.z) - H.atXZ(b.x + 0.3, b.z), 0.6, H.atXZ(b.x, b.z - 0.3) - H.atXZ(b.x, b.z + 0.3)).normalize();
      this._e.set(0, b.yaw, 0, 'YXZ'); q.setFromUnitVectors(up, n).multiply((this._q2 ||= new THREE.Quaternion()).setFromEuler(this._e));
      p.set(b.x, H.atXZ(b.x, b.z) + 0.006, b.z); M.compose(p, q, s); M.toArray(B.instanceMatrix.array, k * 16); k++;
    }
    B.count = k; B.instanceMatrix.needsUpdate = true; this.burrowN = k;
  }

  // ---- western fence lizard -----------------------------------------------------------------------
  // Each lizard has a site (spawnCell: a rock of the cell's plan, an oak or pine trunk, or the open ground beside one)
  // and is placed on it (lzResolve) the first time it comes within the cull distance of the eye: on a rock, the highest
  // of a few downward rays on the rock's drawn close tier (its own instance matrix and geometry, read only), the
  // surface's normal for its up; on a trunk, the bark perch.js gives at 0.2-1.5 m (the drawn wood), belly to it, head
  // up the stem (or down it, one in three); on the ground, the terrain's normal. Active (lzOn) March to October while
  // the sun is up and the air is 15-34 C; else not drawn. Basks flat (longer in cool air), sits alert with head flicks,
  // turns, moves a little on a trunk or the ground; males push up every 10-30 s (3-8 bobs at 2 Hz). A player within
  // 2 m: a dash of a few tenths of a second (away over the rock, up the trunk, or to its rock or tree) and it is gone
  // into a crack for 30 s, back at its spot once the player is 3.5 m off.
  lzMonth() { return this.month >= 3 && this.month < 11; }
  lzSites(x, z, cx, cn, rnd) {
    const sites = [], R = typeof window !== 'undefined' ? window.__we?.rocks : null;
    if (R?.enabled && R.on) {
      const res = R.res, i = Math.floor(cx / res), j = Math.floor((this.tile.size - cn) / res);
      if (i >= 0 && j >= 0 && i < R.W && j < R.W) {
        const id = j * R.W + i, p = R.plans.has(id) ? R.plans.get(id) : R.plan(i, j);   // the rocks' own cached plan
        if (p) {
          const cand = [];
          for (const it of p.out) cand.push({ it, role: 'close' });
          for (const it of p.bould) if (it.s >= 0.45) cand.push({ it, role: 'bclose' });
          cand.sort((a, b) => b.it.s - a.it.s);
          const n = Math.min(cand.length, 1 + Math.floor(rnd() * 3));
          for (let k = 0; k < n; k++) sites.push({ kind: 'rock', role: cand[k].role, item: cand[k].it, x: cand[k].it.x, z: cand[k].it.z });
        }
      }
    }
    const o = this.nearestOak(x, z, 18);
    if (o && o.cls !== 'sapling' && rnd() < 0.7) sites.push({ kind: 'trunk', tree: o, x: o.x, z: o.z });
    const pine = this.conifers.length ? this.nearestConifer(x, z, 18) : null;
    if (pine && rnd() < 0.6) sites.push({ kind: 'trunk', tree: pine, x: pine.x, z: pine.z });
    if (sites.length && rnd() < 0.5) {   // the sunny open ground beside one of them
      const b = sites[Math.floor(rnd() * sites.length)], ang = rnd() * TAU, d = 1 + rnd() * 2;
      sites.push({ kind: 'ground', x: b.x + Math.cos(ang) * d, z: b.z + Math.sin(ang) * d, near: b });
    }
    if (!sites.length && this._near) sites.push({ kind: 'ground', x, z });   // summoned
    return sites;
  }
  lzResolve(a) {
    const S = a.site, r = a.rng, H = this.heights;
    const h = a.home ||= { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, fx: 0, fy: 0, fz: 1 };
    let fx = Math.sin(r() * TAU), fy = 0, fz = 0; fz = Math.sqrt(1 - fx * fx) * (r() < 0.5 ? -1 : 1);
    if (S.kind === 'rock') {
      const R = window.__we?.rocks, m = R?.meshes.get(`${S.role}|${S.item.key}`);
      const items = m?.visible ? m.userData.items : null, q = items ? items.indexOf(S.item) : -1;
      if (q < 0 || q >= m.count) { a.home = null; return false; }
      const M = this._lzM ||= new THREE.Matrix4(), tmp = this._lzMesh ||= new THREE.Mesh(), ray = this._lzRay ||= new THREE.Raycaster(), hits = this._lzHits ||= [];
      const nm = this._lzN ||= new THREE.Matrix3(), n = this._lzV ||= new THREE.Vector3();
      M.fromArray(m.instanceMatrix.array, q * 16); tmp.geometry = m.geometry; tmp.material = m.material; tmp.matrixWorld.copy(M); nm.getNormalMatrix(M);
      const s = S.item.s; let best = null;
      for (let k = 0; k < 6; k++) {
        const ang = r() * TAU, d = Math.sqrt(r()) * 0.35 * s, x = S.item.x + Math.cos(ang) * d, z = S.item.z + Math.sin(ang) * d;
        ray.ray.origin.set(x, M.elements[13] + 3 * s + 2, z); ray.ray.direction.set(0, -1, 0); ray.near = 0; ray.far = 3 * s + 6;
        hits.length = 0; tmp.raycast(ray, hits);
        if (!hits.length) continue;
        n.copy(hits[0].face.normal).applyMatrix3(nm).normalize();
        if (n.y < 0.45) continue;
        if (!best || hits[0].point.y > best.y) best = { x: hits[0].point.x, y: hits[0].point.y, z: hits[0].point.z, nx: n.x, ny: n.y, nz: n.z };
      }
      tmp.geometry = null;
      if (!best) { a.home = null; return false; }
      Object.assign(h, best);
    } else if (S.kind === 'trunk') {
      const Q = this.flight.perchQuery?.(), rec = Q?.recAt(S.tree.x, S.tree.z);
      if (!rec) { a.home = null; return false; }
      const g = H.atXZ(S.tree.x, S.tree.z), ang = r() * TAU, y = g + 0.2 + r() * 1.3;
      const hit = Q.nearOn(rec, S.tree.x + Math.sin(ang) * 1.2, y, S.tree.z + Math.cos(ang) * 1.2, 1.5, 0.05);
      if (!hit || hit.ay - g > 1.8 || hit.ay - g < 0.1) { a.home = null; return false; }
      const off = hit.r + 0.002;
      h.x = hit.ax + hit.nx * off; h.y = hit.ay + hit.ny * off; h.z = hit.az + hit.nz * off; h.nx = hit.nx; h.ny = hit.ny; h.nz = hit.nz;
      const sg = (hit.dy < 0 ? -1 : 1) * (r() < 0.33 ? -1 : 1);   // head up the stem, one in three down it
      fx = hit.dx * sg; fy = hit.dy * sg; fz = hit.dz * sg;
    } else {
      h.x = S.x; h.z = S.z; this.groundNormal(h.x, h.z, h); h.y = H.atXZ(h.x, h.z);
    }
    const d = fx * h.nx + fy * h.ny + fz * h.nz; fx -= h.nx * d; fy -= h.ny * d; fz -= h.nz * d;
    const L = Math.hypot(fx, fy, fz) || 1; h.fx = fx / L; h.fy = fy / L; h.fz = fz / L;
    this.lzHome(a);
    return true;
  }
  groundNormal(x, z, out) {
    const H = this.heights, nx = H.atXZ(x - 0.25, z) - H.atXZ(x + 0.25, z), nz = H.atXZ(x, z - 0.25) - H.atXZ(x, z + 0.25), L = Math.hypot(nx, 0.5, nz);
    out.nx = nx / L; out.ny = 0.5 / L; out.nz = nz / L; return out;
  }
  lzHome(a) {
    const h = a.home; a.x = h.x; a.y = h.y; a.z = h.z;
    a.N ||= new THREE.Vector3(); a.F ||= new THREE.Vector3(); a.N.set(h.nx, h.ny, h.nz); a.F.set(h.fx, h.fy, h.fz);
    this.lzOrient(a);
  }
  // pitch, yaw and roll (YXZ) of the body: up the surface normal N, forward F (in the surface)
  lzOrient(a) {
    const N = a.N, F = a.F; F.addScaledVector(N, -F.dot(N)).normalize();
    this._sqM.makeBasis(this._sqX.crossVectors(N, F), N, F); this._sqE.setFromRotationMatrix(this._sqM, 'YXZ');
    a.pitch = this._sqE.x; a.yaw = this._sqE.y; a.roll = this._sqE.z;
  }
  lzNext(a) {
    const r = a.rng, q = r(), cool = this.airT < 24;
    if (q < (cool ? 0.45 : 0.2)) { a.state = L_BASK; a.t = 5 + r() * (cool ? 20 : 8); }
    else if (q < 0.7) { a.state = L_ALERT; a.t = 2 + r() * 6; }
    else if (q < 0.85 || a.site.kind === 'rock') { a.state = L_TURN; a.u = 0; a.dur = 0.3 + r() * 0.3; a.turn = (r() < 0.5 ? -1 : 1) * (0.5 + r() * 1.5); }
    else { a.state = L_MOVE; a.u = 0; a.dur = 0.2 + r() * 0.4; a.mdir = r() < 0.5 ? 1 : -1; }
  }
  lzSprint(a, px, py, pz) {
    const r = a.rng, S = a.site, N = a.N, F = this._lzF ||= new THREE.Vector3();
    if (S.kind === 'trunk') F.copy(a.F).multiplyScalar(a.F.y < 0 ? -1 : 1);   // up the trunk and round it
    else if (S.kind === 'ground' && S.near) F.set(S.near.x - a.x, 0, S.near.z - a.z);   // to its rock or tree
    else F.set(a.x - px, 0, a.z - pz);   // away over the rock
    F.addScaledVector(N, -F.dot(N)); if (F.lengthSq() < 1e-6) F.copy(a.F);
    a.F.copy(F.normalize()); this.lzOrient(a);
    a.state = L_SPRINT; a.u = 0; a.dur = 0.25 + r() * 0.3; a.flick = 0; a.fl = 0;
  }
  lzUpdate(a, dt, px, py, pz) {
    const r = a.rng, H = this.heights;
    a.t -= dt;
    if (!this.lzOn) { a.vis = a.vis < 0.03 ? 0 : damp(a.vis, 0, 10, dt); a.amp = 0; return; }   // cold, dark or out of season
    if (!a.home) {   // placed the first time it is near the eye (a budget per frame; retried while the rock or wood is not drawn)
      if (a.tries > 0) { a.tries -= dt; return; }
      if (this.lzBudget <= 0) return;
      this.lzBudget--;
      if (!this.lzResolve(a)) {
        a.fails = (a.fails || 0) + 1; a.tries = 0.5;
        if (a.fails > 6 && a.site.kind !== 'ground') a.site = { kind: 'ground', x: a.site.x + 1.5, z: a.site.z + 0.5, near: a.site };
        return;
      }
      a.state = this.airT < 24 ? L_BASK : L_ALERT; a.t = r() * 8; a.vis = 0.001;
    }
    const T = this.threat(LZ, a, a.x, a.y, a.z, px, py, pz), tn = T.n; px = T.x; py = T.y; pz = T.z;   // the player or an AI hunter
    const dx = a.x - px, dy = a.y - py, dz = a.z - pz, near = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (this.danger(LZ, a, near, LIZ.flee, tn) && a.state !== L_SPRINT && a.state !== L_HIDE) this.lzSprint(a, px, py, pz);
    let speed = 0, pose = 0, bend = 0;
    switch (a.state) {
      case L_HIDE:
        if (a.t <= 0 && near > LIZ.flee + 1.5) { this.lzHome(a); a.state = L_ALERT; a.t = 3 + r() * 5; }
        break;
      case L_BASK: pose = this.airT < 27 ? -0.95 : -0.6; if (r() < dt * 0.15) a.fl = (r() - 0.5) * 1.2; if (a.t <= 0) this.lzNext(a); break;
      case L_ALERT: if (r() < dt * 0.9) a.fl = (r() - 0.5) * 2; if (a.t <= 0) this.lzNext(a); break;
      case L_PUSH: {   // a bout of push-ups, the head bobbing with them
        a.u += dt; const k = a.u * LIZ.bobHz; pose = 0.5 - 0.5 * Math.cos(TAU * k); a.fl = 0;
        if (k >= a.bobs) { a.state = L_ALERT; a.t = 2 + r() * 4; }
        break;
      }
      case L_TURN: {   // a quick turn on the spot, the body curved into it
        a.u += dt; const w = a.turn / a.dur;
        a.F.applyAxisAngle(a.N, w * dt); this.lzOrient(a); bend = Math.sign(a.turn) * 0.8; speed = 0.4;
        if (a.u >= a.dur) { a.state = L_ALERT; a.t = 1 + r() * 4; }
        break;
      }
      case L_MOVE: {   // a few steps on the trunk (along it) or the ground, staying near its spot
        a.u += dt; speed = 0.6;
        const h = a.home, nx = a.x + a.F.x * a.mdir * speed * dt, nz = a.z + a.F.z * a.mdir * speed * dt, ny = a.y + a.F.y * a.mdir * speed * dt;
        if (Math.hypot(nx - h.x, ny - h.y, nz - h.z) < (a.site.kind === 'trunk' ? 0.4 : 1.2)) {
          a.x = nx; a.z = nz;
          if (a.site.kind === 'trunk') a.y = ny; else { a.y = H.atXZ(a.x, a.z); this.groundNormal(a.x, a.z, this._gn ||= {}); a.N.set(this._gn.nx, this._gn.ny, this._gn.nz); this.lzOrient(a); }
        } else a.u = a.dur;
        if (a.u >= a.dur) { a.state = L_ALERT; a.t = 1 + r() * 3; }
        break;
      }
      case L_SPRINT: {   // the dash: legs a blur, the body and tail whipping, then into the crack
        a.u += dt; speed = LIZ.dash;
        a.x += a.F.x * speed * dt; a.y += a.F.y * speed * dt; a.z += a.F.z * speed * dt;
        if (a.site.kind === 'ground') a.y = H.atXZ(a.x, a.z);
        if (a.u >= a.dur) { a.state = L_HIDE; a.t = LIZ.hide; }
        break;
      }
    }
    if (a.male && (a.state === L_ALERT || a.state === L_BASK)) {   // males: a push-up bout every 10-30 s
      a.next -= dt;
      if (a.next <= 0) { a.state = L_PUSH; a.u = 0; a.bobs = LIZ.bobs[0] + Math.floor(r() * (LIZ.bobs[1] - LIZ.bobs[0] + 1)); a.next = LIZ.push[0] + r() * (LIZ.push[1] - LIZ.push[0]); }
    }
    a.fl = (a.fl || 0) * Math.exp(-1.5 * dt);
    a.flick = damp(a.flick, a.fl, 12, dt);
    a.bend = damp(a.bend || 0, bend, 10, dt);
    a.vis = a.state === L_HIDE ? (a.vis < 0.05 ? 0 : damp(a.vis, 0, 25, dt)) : damp(a.vis, 1, 4, dt);
    a.amp = damp(a.amp, speed > 0.05 ? Math.min(1, speed / LIZ.dash + 0.3) : 0, 20, dt);
    a.phase += dt * TAU * Math.min(12, speed / LIZ.stride);
    a.pose = a.state === L_PUSH ? pose : damp(a.pose, pose, 4, dt);
  }
  // What an animal is doing, in a few words (identify.js species cards).
  activity(a) {
    const s = a.state;
    if (a.sp === TK) {
      if (s === T_FLY) return a.down ? 'flying down from the tree' : 'flying up into a tree';
      if (s === T_PERCH || s === T_WAIT && !a.down && a.group.state !== TF_FORAGE) return a.group.state === TF_ROOST ? 'roosting for the night' : 'up in a tree, watching';
      if (s === T_SCRATCH) return 'scratching the leaves for food';
      return a.group.state === TF_WALK ? 'walking with its flock' : 'pecking for seeds and insects with its flock';
    }
    if (a.sp === GS) return s === G_SENTRY ? 'on guard at the burrow' : s === G_DIVE ? 'running for its burrow' : s === G_SIT || s === G_PEEK ? 'sitting up, looking round' : 'feeding near its burrow';
    if (a.sp === LZ) return s === L_BASK ? 'basking in the sun' : s === L_PUSH ? 'doing push-ups (a male showing off)' : s === L_SPRINT ? 'dashing for cover' : 'watching';
    return '';
  }
  codeOf(a) { return SPECIES[a.sp].code; }
  // Drawn and in view now (identify.js picks only these).
  shown(a) { return this.meshes[a.sp].visible && !a.culled && a.vis > 0.3 && this.present(a); }
  // Is this one present (the HUD and the cards): not down a burrow, not hidden in a crack or a crown, not too cold.
  present(a) {
    if (a.sp === LZ) return this.lzOn && a.state !== L_HIDE;
    if (a.sp === GS) return a.state !== G_DOWN;
    if (a.sp === TK) return a.vis > 0.3;
    return true;
  }

  // debugging: a group of a species (code, SPECIES index, or its one/DRAWN name: 'gray fox', 'fox', 'buck', 'lion')
  // d m ahead of the camera, kept through rebuilds until clearSummoned(). Returns the new animals.
  summon(which, d = 12) {
    const k = typeof which === 'number' ? which : SPECIES.findIndex((sp, i) => sp.code === which && sp.variantOf === undefined || sp.one === which || DRAWN[i]?.name === which || DRAWN[i]?.param === which || DRAWN[i]?.alias === which);
    if (k < 0) return null;
    const C = this.camera, dir = new THREE.Vector3(); C.getWorldDirection(dir); dir.y = 0; dir.normalize();
    const x = C.position.x + dir.x * d, z = C.position.z + dir.z * d, keep = new Set(), n = ++this.debugN;
    const rnd = mulberry32(hash(n, 7, 9999 + k)), before = new Set(this.byId.keys());
    if (k === ML) this.spawnLionGroup(`${ML}:dbg${n}`, x, z, rnd, keep);
    else { this._forceBuck = k === BK; this._near = true; this.spawnCell(k === BK ? DR : k === WF ? WP : k, 'dbg', n, x, -z, rnd, keep, 0); this._forceBuck = this._near = false; }
    for (const id of keep) this.debugIds.add(id);
    this.dirty = true;
    const fresh = [...this.byId.values()].filter(a => !before.has(a.id));
    if (k === RV) fresh.forEach((a, i) => {   // ravens come down: standing on the ground a while at the spot
      a.x = x + (i ? 0.9 : 0); a.z = z + (i ? 0.5 : 0); a.y = this.heights.atXZ(a.x, a.z); a.yaw = rnd() * TAU;
      a.state = R_PERCH; a.t = 30 + rnd() * 30; a.pose = 1; a.amp = 0; a.pitch = 0; a.roll = 0; a.fly = 0; a.perchY = null; a.air = 0;
    });
    return fresh;
  }
  clearSummoned() { this.debugIds.clear(); this.dirty = true; }

  // The animal of a species nearest to (x, y, z) within maxR, or null (for sound.js: calls placed on
  // real birds). No allocation.
  nearestOf(code, x, y, z, maxR = Infinity) {
    const s = INDEX[code]; if (s === undefined || !this.meshes[s].visible) return null;
    const arr = this.bySpecies[s]; let best = null, bd = maxR * maxR;
    for (let k = 0; k < arr.length; k++) { const a = arr[k], dx = a.x - x, dy = a.y - y, dz = a.z - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; best = a; } }
    return best;
  }
  // Every animal of a species within maxR of (x, y, z), pushed into out (cleared first). For sound.js.
  within(code, x, y, z, maxR, out = []) {
    out.length = 0;
    const s = INDEX[code]; if (s === undefined || !this.meshes[s].visible) return out;
    const arr = this.bySpecies[s], r2 = maxR * maxR;
    for (let k = 0; k < arr.length; k++) { const a = arr[k], dx = a.x - x, dy = a.y - y, dz = a.z - z; if (dx * dx + dy * dy + dz * dz < r2) out.push(a); }
    return out;
  }
  // ---- the spirit's bodies (see the header) --------------------------------------------------------------
  // The playable animal nearest (x, y, z) within r of its body (a raven in the air within rAir: it is catchable at
  // speed), other than `skip` (an id), or null: info() of it. Any species (PLAYABLE).
  playableNear(x, y, z, r = 2.5, rAir = 4, skip = null) {
    let best = null, bd = Infinity;
    for (const s of PLAYABLE) {
      if (!this.meshes[s].visible) continue;
      const arr = this.bySpecies[s];
      for (let k = 0; k < arr.length; k++) {
        const a = arr[k]; if (a.culled || a.id === skip || !this.present(a)) continue;
        const R = a.air ? rAir : r, dx = a.x - x, dy = a.y + BODY_Y[s] * (a.air ? 0 : 1) - y, dz = a.z - z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < R * R && d2 < bd) { bd = d2; best = a; }
      }
    }
    return best ? this.info(best) : null;
  }
  // Where and how a playable animal is, for the player to carry on from: species code and sex, position (its origin:
  // the feet on the ground or bark, the body in the air), yaw in the flight's frame (forward -z at 0; the animals'
  // forward is +z), speed, and where: 'air', 'ground', 'trunk' (a squirrel on the bole: tree, face, h), 'tree' (a
  // squirrel out on the wood), 'cling' (a woodpecker on the bark: tree, face, h) or 'top' (perched up in a tree).
  info(a) {
    const s = a.sp, g = this.heights.atXZ(a.x, a.z);
    const o = { id: a.id, code: SPECIES[s].code, sex: s === WF ? 'female' : s === WP ? 'male' : null, x: a.x, y: a.y, z: a.z,
      yaw: wrapAngle(a.yaw + Math.PI), pitch: 0, speed: 0, where: 'ground', tree: a.tree || null, face: a.face, h: a.h, anchor: a.anchor || null,
      size: a.size, soaring: false };
    if (s === SQ) {
      if ((a.state === S_CLIMB || a.state === S_DOWN || a.state === S_RAIDP) && !a.path && a.tree) o.where = 'trunk';
      else if (a.y - g > 0.4) o.where = 'tree';
    } else if (s === RV) {
      if (a.state === R_SOAR) { o.where = 'air'; o.speed = 10; }
      else if (a.state === R_GLIDE || a.state === R_CLIMB) { o.where = 'air'; o.speed = Math.min(25, Math.hypot(a.tx - a.sx, a.ty - a.sy, a.tz - a.sz) / Math.max(0.5, a.dur)); }
      else o.where = a.perchY !== null && a.y - g > 0.5 ? 'top' : 'ground';
      if (o.where === 'air') o.pitch = -a.pitch;   // the animals' pitch is nose down positive
    } else if (s === WP || s === WF) {
      if (a.state === W_CLING || a.state === S_RAIDP) o.where = 'cling';
      else if (a.state === W_FLY || a.state === W_MOB) { o.where = 'air'; o.speed = a.state === W_FLY ? Math.min(12, a.speed / Math.max(0.5, a.dur)) : 8; }
      else o.where = a.y - g < 0.3 ? 'ground' : 'top';
    } else {   // the rest (groundControl.js, flierControl.js): in the air, up a tree or a rock, or on the ground
      o.where = a.air ? 'air' : a.y - g > 0.5 ? 'top' : 'ground';
      if (o.where === 'air') {
        o.pitch = -a.pitch;
        o.soaring = a.state === H_SOAR || a.state === V_SOAR || a.state === V_GLIDE;
        o.speed = s === HK || s === TV ? (a.state === H_STOOP ? 24 : a.state === H_PULL ? a.speed : a.V || 9)
          : s === QU ? 13 : s === TK ? TURKEY.fly : Math.min(14, Math.hypot(a.tx - a.sx, a.tz - a.sz) / Math.max(0.5, a.dur));
      } else o.speed = a.amp > 0.3 ? a.speed || 0 : 0;
    }
    return o;
  }
  // Each playable animal drawn now: fn(x, y, z) at its body (the spirit's glow on them, spirit.js).
  speciesList() { return SPECIES; }   // the bar's (nearBar.js): code, one, many, common, by the index counts and rarity use
  eachPlayable(fn) {
    for (const s of PLAYABLE) {
      if (!this.meshes[s].visible || !this.group.visible) continue;
      for (const a of this.bySpecies[s]) if (!a.culled && this.present(a)) fn(a.x, a.y + BODY_Y[s] * (a.air ? 0 : 1), a.z, s);
    }
  }
  // A held or living animal's info by id (the spirit's flash closes on it), or null.
  peek(id) { const a = this.byId.get(id); return a ? this.info(a) : null; }
  // Lift a playable animal out of the population (the player is in it now); returns its info, or null.
  take(id) {
    const a = this.byId.get(id); if (!a || !PLAYABLE.includes(a.sp)) return null;
    const o = this.info(a);
    this.dropTask(a);
    if (a.state === W_MOB) a.mob = null;
    const g = a.group;   // a group's leader: another member leads while the player is in it (it comes back a follower)
    if (g && g.leader === a) { g.leader = null; for (const b of this.list) if (b !== a && b.group === g && this.byId.get(b.id) === b) { g.leader = b; break; } }
    this.byId.delete(id); this.freed.delete(id); this.held.set(id, a);
    this.dirty = true;   // rebuilt (and every matrix rewritten) on this frame's update
    return o;
  }
  // Put a held animal back where the player leaves it: o is { x, y, z, yaw (the flight's frame), where (as info), tree
  // (a trunk record, for 'trunk', 'tree' and 'cling'), face, h, speed }. It carries on from a state of its own.
  release(id, o) {
    const a = this.held.get(id); if (!a) return null;
    this.held.delete(id);
    const r = a.rng, H = this.heights, g = H.atXZ(o.x, o.z), oak = t => (t && this.nearestOak(t.x, t.z, 1.5)) || t;
    a.x = o.x; a.y = o.y; a.z = o.z; a.yaw = wrapAngle(o.yaw + Math.PI); a.pitch = 0; a.roll = 0; a.amp = 0;
    a.task = 0; a.acorn = null; a.guard = null; a.fleeOak = null; a.raidOak = null; a.mob = null; a.scared = 0;
    a.vis = 1; a.culled = false; a.acc = 0; a.air = 0; a.flickV = 0;
    if (a.sp === SQ) {
      a.path = null; a.via = false;
      const tr = oak(o.tree);
      if (o.where === 'trunk' && tr) { a.tree = tr; a.face = o.face; a.h = Math.max(0, o.h); a.state = S_DOWN; }   // down the bole
      else if (o.where === 'tree' && tr) {   // sits a while, then back along to the trunk and down (S_SIT without a path)
        a.tree = tr; a.face = Math.atan2(o.x - tr.x, o.z - tr.z); a.state = S_SIT; a.t = 3 + r() * 6; a.pose = 1; a.pitch = -0.55;
      } else { a.y = g; a.tree = this.nearestOak(o.x, o.z, 30) || a.anchor; a.state = S_PAUSE; a.t = 1 + r() * 2; }
    } else if (a.sp === RV) {
      a.perchY = null; a.perchTop = false; a.task = 0; a.tRest = 0; a.hopping = 0; a.wing = 0; a.look = 0;
      if (o.where === 'air') {   // soaring on: a circle that passes through here along its heading
        const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), R = 35 + r() * 30, th = Math.atan2(-fx, fz);
        a.dir = 1; a.R = R; a.th = th; a.cx = o.x - R * Math.cos(th); a.cz = o.z - R * Math.sin(th);
        a.alt = Math.max(25, o.y - H.atXZ(a.cx, a.cz)); a.state = R_SOAR; a.t = 20 + r() * 30; a.air = 1; a.fly = 1;
      } else {   // standing a while (on the ground, or the limb: perchY), then back up to a circle
        if (o.where === 'top') a.perchY = o.y; else a.y = g;
        a.state = R_PERCH; a.t = 4 + r() * 10; a.pose = 1; a.gm = this.meshOn(RV) ? 1 : 0;
      }
    } else if (a.sp !== WP && a.sp !== WF) this.releaseOther(a, o, g);
    else {
      a.path = null;
      if (o.where === 'cling' && o.tree) {
        const tr = oak(o.tree);
        a.tree = tr; a.face = o.face; a.h = Math.max(0.3, o.h); a.state = W_CLING; a.t = 3 + r() * 6; a.yaw = a.face + Math.PI; a.pitch = CLING_PITCH; a.pose = 1;
      } else if (o.where === 'top') { a.state = W_TOP; a.t = 2 + r() * 6; a.pose = 1; a.tree = this.nearestOak(o.x, o.z, 15) || a.anchor; }
      else {   // off to an oak near home
        if (o.where === 'ground') a.y = g;
        this.wpFly(a, this.randomOak(a.anchor.x, a.anchor.z, 45, r, null) || a.anchor, false);
      }
    }
    this.byId.set(id, a); this.freed.add(id); this.dirty = true;
    return a;
  }
  // release() for the species of groundControl.js and flierControl.js: back into a state of its own behaviour where the
  // player left it (o: leaveInfo: where 'air' or 'ground' or 'top', speed, soaring, resting), its group kept.
  releaseOther(a, o, g) {
    const r = a.rng, s = a.sp, grp = a.group;
    a.path = null; a.hidden = 0; a.down = 0; a.lift = 0; a.zig = 0; a.speed = 0; a.e3 = 0; a.wait = 0; a.look = 0;
    const far = (x, z) => Math.hypot(o.x - x, o.z - z) > 30;
    if (s === HK || s === TV) {   // soaring on in a circle through here; a hawk off a perch or out of a glide flaps up first
      a.air = 1; a.fly = 1; a.pose = 0;
      if (s === HK && !(o.where === 'air' && o.soaring)) { a.state = H_PULL; a.t = 4; a.speed = 9; a.pitch = 0; return; }
      this.joinCircle(a, s === HK ? 40 + r() * 40 : 50 + r() * 50, r() < 0.5 ? 1 : -1);
      a.alt = Math.max(s === HK ? 40 : 30, o.y - this.heights.atXZ(a.cx, a.cz)); a.V = 9;
      a.state = s === HK ? H_SOAR : V_SOAR; a.t = 30 + r() * 40; return;
    }
    if (s === SJ || s === ST) {   // perched, on the ground, or flying on to the group's tree
      a.air = 0; a.moveSeen = grp ? grp.move : 0; a.hopU = 1;
      if (o.where === 'top') { a.state = J_PERCH; a.t = 3 + r() * 6; a.pose = 1; a.tree = (s === ST ? this.nearestConifer(o.x, o.z, 20) : this.nearestOak(o.x, o.z, 20)) || a.tree || a.anchor; }
      else if (o.where === 'ground') { a.y = g; a.state = J_GROUND; a.t = 3 + r() * 5; a.pose = 1; }
      else this.jayFly(a, grp?.tree || a.tree || a.anchor, false);
      return;
    }
    a.air = 0; a.fly = 0; a.y = g; a.vis = 1;
    if (s === DR || s === BK) { a.state = D_GRAZE; a.t = 2 + r() * 4; a.pose = o.resting ? 1 : Math.min(a.pose, 0.2); }
    else if (s === FX || s === CY || s === ML) {
      a.tree = null; a.cool = 4; a.pose = o.resting ? this.poseMax[s] : 0;
      a.state = o.resting ? M_BED : M_STAND; a.t = o.resting ? 20 + r() * 30 : 2 + r() * 4;
    } else if (s === RB) { if (far(a.hx, a.hz)) { a.hx = o.x; a.hz = o.z; } a.state = B_FORAGE; a.t = 1 + r() * 3; a.pose = 0; }
    else if (s === JR) {
      if (far(a.hx, a.hz)) { a.hx = o.x; a.hz = o.z; }
      a.state = o.resting ? JK_FORM : JK_FEED; a.t = o.resting ? 20 + r() * 30 : 1 + r() * 3; a.pose = o.resting ? JACK.hunch : 0;
    } else if (s === VO) {   // a new runway from here along its heading (the old one may be far)
      const L = 1.5 + r() * 2;
      a.sx = o.x; a.sz = o.z; a.tx = o.x + Math.sin(a.yaw) * L; a.tz = o.z + Math.cos(a.yaw) * L; a.u = 0; a.h = 0; a.state = VL_PAUSE; a.t = 1 + r() * 2;
    } else if (s === GS) { a.state = G_FEED; a.t = 2 + r() * 3; a.pose = 0; }
    else if (s === LZ) {   // a new home on the ground here, facing its way
      a.site = { kind: 'ground', x: o.x, z: o.z, near: null };
      const h = a.home ||= { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, fx: 0, fy: 0, fz: 1 };
      h.x = o.x; h.z = o.z; this.groundNormal(h.x, h.z, h); h.y = g;
      let fx = Math.sin(a.yaw), fz = Math.cos(a.yaw); const d = fx * h.nx + fz * h.nz;
      let fy = -h.ny * d; fx -= h.nx * d; fz -= h.nz * d; const L = Math.hypot(fx, fy, fz) || 1; h.fx = fx / L; h.fy = fy / L; h.fz = fz / L;
      this.lzHome(a); a.state = L_ALERT; a.t = 2 + r() * 4; a.tries = 0; a.fails = 0; a.pose = 0;
    } else if (s === QU) { a.state = Q_FORAGE; a.t = 1 + r() * 2; a.pose = 1; a.pitch = 0; if (grp) { a.ox = a.x - grp.x; a.oz = a.z - grp.z; } }
    else if (s === TK) { a.state = T_FORAGE; a.t = 1 + r() * 3; a.pose = 1; a.pitch = 0; if (grp) { a.ox = a.x - grp.x; a.oz = a.z - grp.z; } }
  }
  // Is this animal still in the live set (not dropped by a rebuild)?
  alive(a) { return this.byId.get(a.id) === a; }
  // debugging: flush the covey nearest to the player, as if the raven had dropped onto it
  flush() {
    const P = this.flight.pos; let best = null, bd = Infinity;
    for (const g of this.coveys) { const d = Math.hypot(g.x - P.x, g.z - P.z); if (d < bd) { bd = d; best = g; } }
    if (best) { best.cool = 0; if (best.state === G_SETTLE) best.state = G_FORAGE; this.flushCovey(best, P.x, P.z, 'debug'); }
    return best ? Math.round(bd) : null;
  }
  // debugging: send the hawk nearest the player into a stoop on its next frame
  stoop() {
    const P = this.flight.pos, h = this.nearestOf('buteo_jamaicensis', P.x, P.y, P.z);
    if (!h) return null;
    if (h.state === H_SOAR) h.t = 0;
    return Math.round(Math.hypot(h.x - P.x, h.y - P.y, h.z - P.z));
  }

  // ---- frame --------------------------------------------------------------------------------------
  update(dt, season, hour) {
    const t0 = performance.now();
    dt = Math.max(0, dt);   // the page's first frame can arrive with a timestamp before the loop's start
    this.time += dt; this.hour = hour; this.searches = SEARCHES;
    if (season !== this.season) { this.season = season; this.dirty = true; }
    const want = typeof window !== 'undefined' && window.__we?.playerSpecies;   // a species switch elsewhere, when one exists
    if (want && want !== this.observer) this.setObserver(want);
    const P = this.flight.pos;
    if (this.veg.version !== this.vegVersion && this.veg.oaks.length) { this.indexOaks(); this.dirty = true; }
    if (this.veg.nearVersion !== this.nearVersion && (this.perceived.has('cyanocitta_stelleri') || this.perceived.has('sceloporus_occidentalis'))) this.indexConifers();
    if (!this.priorReady && performance.now() < this.priorDeadline) return;   // wait (briefly) for the occurrence prior
    // The fine square of the 1 m ground moved (terrain.js): an animal standing or bedded on the ground keeps its
    // height between moves in several states (a quail crouched to flush, a raven on the ground, ...), so one placed
    // on the 10 m mesh would float or sink once the fine mesh arrives under it. Each one on or near the old surface
    // (within 1 m: a bedded body's drop, a pounce) moves by the new surface minus the old under it.
    const hf = this.tile.heights;
    if (hf.fine !== this.fineSeen) {
      const F0 = this.fineSeen, F1 = hf.fine; this.fineSeen = F1;
      if (F0 !== undefined) for (const a of this.list) {
        if (a.air) continue;
        const n = -a.z, g0 = hf.groundIn(F0, a.x, n);
        if (Math.abs(a.y - g0) < 1) { const dg = hf.groundIn(F1, a.x, n) - g0; a.y += dg; if (a.home) a.home.y += dg; }
      }
      this.placeBurrows();
    }
    this.month = this.antlerMonth ?? (this.fixedDate && seasonOfDate(this.fixedDate) === season ? monthOf(this.fixedDate)
      : season === seasonOfDate() ? monthOf(new Date()) : SEASON_MONTH[season] ?? 10.5);
    if (this.lzMonth() !== this.lzMonthWas) { this.lzMonthWas = this.lzMonth(); this.dirty = true; }
    this.airT = this.weatherTemp?.() ?? airTemp(this.month, hour);   // the day's measured air (main.js: weather.js), else the normals
    this.lzOn = this.lzMonth() && atmo.sunDir.value.y > 0.1 && this.airT >= LIZ.warm && this.airT <= LIZ.hot; this.lzBudget = LIZ.resolves;
    let fresh = false;   // slots were reassigned: every animal writes its matrix this frame
    if (this.dirty || !this.lastCenter || Math.hypot(P.x - this.lastCenter[0], P.z - this.lastCenter[1]) > REBUILD_MOVE) { this.rebuild(P.x, P.z); fresh = true; }
    const odd = (++this.frame) & 1;
    const ghost = this.observer === 'spirit';   // the spirit: nothing reacts to it (see the header)
    const px = ghost ? 1e7 : P.x, py = ghost ? 1e7 : P.y, pz = ghost ? 1e7 : P.z;
    const list = this.list, e = this._e, q = this._q, p = this._p, s = this._s, m = this._m;
    if (!ghost) this.alarms(px, py, pz);   // the watchers' alarm calls (danger, alert above)
    this.huntT = (this.huntT || 0) - dt;
    if (fresh || this.huntT <= 0) { this.huntT = HUNT.every; this.refreshHunters(P); this.aiAlarms(); }   // the AI hunters (HUNT above)
    if (this.meshes[QU].visible) for (let k = 0; k < this.coveys.length; k++) this.coveyUpdate(this.coveys[k], dt, px, py, pz);
    if (this.meshes[TK].visible) for (let k = 0; k < this.flocks.length; k++) this.flockUpdate(this.flocks[k], dt, px, pz);
    if (this.meshes[GS].visible) for (let k = 0; k < this.colonies.length; k++) this.colonyUpdate(this.colonies[k], dt, px, py, pz);
    this.burrows.visible = this.meshes[GS].visible && this.burrowN > 0;
    const C = this.camPos, cx = C.x, cy = C.y, cz = C.z;
    const dt0 = dt;
    const camAGL = cy - this.heights.atXZ(cx, cz), cull = this.cullOn || [];
    for (let k = 0; k < list.length; k++) {
      const a = list[k], sp = a.sp;
      const ex = a.x - cx, ey = a.y - cy, ez = a.z - cz, d2 = ex * ex + ey * ey + ez * ez;
      a.acc += dt0;
      const dead = a.dead;   // carrion (kill): lies where it fell (no thinking, still drawn), then goes
      if (dead) { if (!a.gone) { if (this.time > a.carrionUntil) this.bury(a); else this.lieStill(a); } if (a.gone) { a.acc = 0; continue; } }
      if (cull[sp]) {   // rabbits, jackrabbits and voles: neither drawn nor thought beyond CULL (voles: also under a high camera)
        const R = CULL[sp];
        if (d2 > R * R || (sp === VO && camAGL > VOLE_CAM)) {
          if (!a.culled || fresh) { this.meshes[sp].instanceMatrix.array.fill(0, a.slot * 16, a.slot * 16 + 16); a.culled = true; }
          a.acc = 0; continue;
        }
        a.culled = false;
      }
      if (!fresh && !a.air && d2 > LOD_R2 && ((k & 1) === odd)) continue;   // far and on the ground: every other frame
      const dt = a.acc; a.acc = 0;
      a.flick = sp === WP || sp === WF || sp === LZ ? a.flick : damp(a.flick, 0, 1, dt);
      if (dead) a.acc = 0;
      else if (sp === SQ) this.sqUpdate(a, dt, px, py, pz);
      else if (sp === WP || sp === WF) this.wpUpdate(a, dt, px, py, pz);
      else if (sp === RV) {
        this.rvUpdate(a, dt);
        a.gm = this.meshOn(RV) && (a.state === R_GROUND || a.state === R_PERCH || a.state === R_WALK) ? 1 : 0;
        if (this.rvGM) this.rvGM[a.slot] = a.gm;
      }
      else if (sp === DR || sp === BK) this.drUpdate(a, dt, px, py, pz);
      else if (sp === FX || sp === CY || sp === ML) this.mmUpdate(a, dt, px, py, pz);
      else if (sp === RB) this.rbUpdate(a, dt, px, py, pz);
      else if (sp === JR) this.jkUpdate(a, dt, px, py, pz);
      else if (sp === VO) this.voUpdate(a, dt, px, py, pz);
      else if (sp === TK) this.tkUpdate(a, dt, px, py, pz);
      else if (sp === GS) this.gsUpdate(a, dt);
      else if (sp === LZ) this.lzUpdate(a, dt, px, py, pz);
      else if (sp === QU) this.quUpdate(a, dt);
      else if (sp === SJ || sp === ST) this.sjUpdate(a, dt, px, py, pz);
      else if (sp === HK) this.hkUpdate(a, dt);
      else this.tvUpdate(a, dt);
      if (a.flickV > 0 && a.sp !== WP && a.sp !== WF && a.sp !== LZ) { a.flick = Math.max(a.flick, Math.sin(Math.min(1, 1 - a.flickV) * Math.PI)); a.flickV -= dt * 3; }
      if (a.phase > 1e4) a.phase -= TAU * 1000;
      const mesh = this.meshes[a.sp], o = a.slot;
      // birds in flight grow with distance from the eye so they stay a few pixels wide
      let grow = 1;
      if (a.air || a.fly > 0.01) {
        a.fly = damp(a.fly, a.air, 3, dt);
        grow = 1 + FLY_GROW * a.fly * clamp01((Math.sqrt(d2) - FLY_NEAR) / (FLY_FAR - FLY_NEAR));
      }
      e.set(a.pitch, a.yaw, a.roll, 'YXZ'); q.setFromEuler(e); p.set(a.x, a.y, a.z); s.setScalar(a.size * SPECIES[sp].scale * grow * a.vis);
      m.compose(p, q, s); m.toArray(mesh.instanceMatrix.array, o * 16);
      const an = mesh.geometry.attributes.aAnim.array;
      an[o * 4] = a.phase % TAU; an[o * 4 + 1] = a.amp; an[o * 4 + 2] = a.pose; an[o * 4 + 3] = a.flick;
      const a2 = this.anim2[sp];
      if (a2) { this.extra(a, dt); a2[o * 4] = a.e0; a2[o * 4 + 1] = a.e1; a2[o * 4 + 2] = a.e2; a2[o * 4 + 3] = sp === QU || sp === TK ? a.variant : a.e3; }
      // the skinned models (deer, buck): clip and phase from the speed, pose and flick (animalModels.js driveClips)
      const sk = this.drawn[sp]?.model?.skin;
      if (sk) driveClips(sk, DEER_DRIVE, a.cs ||= makeClipState(), a.spd || 0, a.pose, a.flick, dt, this.clip[sp], o);
    }
    // acorn game v4: the families' defence of their granaries
    if (this.game?.active) this.defend(); else if (this.threats.size) this.threats.clear();
    // acorn game: the acorns carried in bills and mouths, every frame (also for animals thinking on alternate frames)
    const G = this.game;
    if (G && G.active) {
      G.carryBegin();
      for (let k = 0; k < list.length; k++) {
        const a = list[k], carry = G.aiLocal === false ? G.world.collectors[a.id]?.carrying : a.carry;   // not the AI host: as the events say
        if (!carry || a.culled || !this.meshes[a.sp].visible) continue;
        const ex = a.x - cx, ey = a.y - cy, ez = a.z - cz;
        const grow = a.fly > 0.01 ? 1 + FLY_GROW * a.fly * clamp01((Math.sqrt(ex * ex + ey * ey + ez * ez) - FLY_NEAR) / (FLY_FAR - FLY_NEAR)) : 1;
        e.set(a.pitch, a.yaw, a.roll, 'YXZ'); q.setFromEuler(e); p.set(a.x, a.y, a.z); s.setScalar(a.size * SPECIES[a.sp].scale * grow * a.vis);
        m.compose(p, q, s);
        const c = this.carryPoint(a, m);
        G.carryAt(c.x, c.y, c.z, a.yaw, a.pitch, a.size * grow);
      }
      G.carryEnd();
    }
    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k], n = mesh.count; if (!n) continue;
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
      const an = mesh.geometry.attributes.aAnim; an.clearUpdateRanges(); an.addUpdateRange(0, n * 4); an.needsUpdate = true;
    }
    // (the shadow casters follow the meshes inside shadows.js)
    for (let k = 0; k < SPECIES.length; k++) {   // procedural planar shadows, while the drawn mesh is off
      const ps = this.planars[k]; if (!ps) continue;
      const d = this.meshes[k]; ps.count = d.count; ps.visible = d.visible && d.count > 0 && !this.meshOn(k);
    }
    for (const k in DRAWN) if (this.meshOn(k)) this.distribute(k);
    this.placeTags();
    this.ms = this.ms * 0.95 + (performance.now() - t0) * 0.05;
  }

  // The drawn meshes' second channel (aAnim2.x, .y; see animalModels.js rig templates), eased per animal.
  extra(a, dt) {
    if (a.sp === SQ) {
      const wood = a.path && (a.state === S_CLIMB || a.state === S_OUT || a.state === S_IN || a.state === S_SIT);
      a.e0 = damp(a.e0, wood ? a.splay || 0 : a.state === S_CLIMB || a.state === S_DOWN || a.state === S_RAIDP ? 1 : 0, 8, dt);   // legs splayed round the trunk
      a.e1 = damp(a.e1, a.flick, 5, dt);                                             // the tail tip lags the flick
    } else if (a.sp === QU) {
      const fly = a.state === Q_FLY;
      a.e0 = damp(a.e0, fly && a.amp < 0.5 ? 1 : 0, 6, dt);                          // wings set and bowed in the glide
      a.e1 = damp(a.e1, fly ? (a.u > 0.85 ? 1 : 0.4) : 0, 8, dt);                    // tail fanned to land
    } else if (a.sp === SJ || a.sp === ST) {
      const fly = a.state === J_FLY;
      a.e0 = damp(a.e0, fly && a.amp < 0.5 ? 0.4 : 0, 6, dt);
      a.e1 = damp(a.e1, fly ? (a.u > 0.75 ? 1 : 0.35) : 0, a.e1 > 0.9 && !fly ? 3 : 8, dt);   // fanned in, and briefly on a hop's landing
    } else if (a.sp === HK) {
      const stoop = a.state === H_STOOP;
      a.e0 = damp(a.e0, stoop ? a.pose : 0, 4, dt);                                  // hands droop as the wings tuck
      a.e1 = damp(a.e1, stoop ? -a.pose : a.state === H_PULL ? 0.3 : 0, 4, dt);       // tail closed in the dive, fanned pulling out
    } else if (a.sp === RV) {   // the ground raven: wing flick, head yaw, hop (legs together)
      if (a.wfV > 0) { a.e0 = Math.max(a.e0 * Math.exp(-6 * dt), Math.sin(Math.PI * (1 - a.wfV)) * 0.9); a.wfV -= dt / 0.4; }
      else a.e0 = damp(a.e0, a.wing, a.wing > a.e0 ? 10 : 5, dt);
      a.e1 = damp(a.e1, a.look, 7, dt);
      a.e2 = damp(a.e2, a.hopping, 14, dt); a.e3 = 0;
    } else if (a.sp === BK) this.antlers(a);
    else if (a.sp === TK) {
      const fly = a.state === T_FLY;
      a.e0 = damp(a.e0, fly && a.amp < 0.5 ? 1 : 0, 5, dt);                          // wings set and bowed in the glide
      a.e1 = damp(a.e1, fly ? (a.u > 0.85 ? 1 : 0.3) : 0, 6, dt);                    // tail fanned to land
    } else if (a.sp === GS) { a.e0 = 0; a.e1 = damp(a.e1, a.flick, 5, dt); }       // the tail tip lags the flick
    else if (a.sp === LZ) {   // C-bend, tail-tip whip, blue flash, male
      a.e0 = a.bend || 0;
      a.e1 = damp(a.e1, a.state === L_SPRINT ? Math.sin(a.phase * 0.5) : a.state === L_PUSH ? 0.3 * Math.sin(a.u * 9) : 0, 10, dt);
      a.e2 = 0; a.e3 = a.male;
    }
    // fox, coyote, lion: e3 (gait selector) and the lion's e1 (tail-tip twitch) are set in mmUpdate
  }
  // A buck's antlers for the date (this.month): aAnim2 = (growth, velvet, young forked-horn). Each buck casts on
  // its own day between 1 January and 1 March and regrows from late April (u1-u3, from its id).
  antlers(a) {
    const st = antlerState(this.month, a.u1, a.u2, a.u3);
    a.e0 = st.growth; a.e1 = st.velvet; a.e2 = a.young;
  }

  // ---- HUD and tags (main.js HUD tick) ------------------------------------------------------------
  // "4 squirrels · 2 woodpeckers · 1 raven" within NEAR_R of the player, at most 4 times a second.
  describe(now = performance.now()) {
    if (now - this.lastDescribe < 250) return this.text;
    this.lastDescribe = now;
    const P = this.flight.pos, c = this.counts; c.fill(0);
    for (const a of this.list) {
      const dx = a.x - P.x, dy = a.y - P.y, dz = a.z - P.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < NEAR_R * NEAR_R && this.present(a)) c[a.sp]++;
      // the field guide's card for a turkey, ground squirrel or fence lizard the first time one is close and in view
      const fg = FG_SEEN[a.sp];
      if (fg && d2 < fg * fg && !this.fgSeen.has(a.sp) && a.vis > 0.5 && this.present(a) && this.meshes[a.sp].visible) {
        this.fgSeen.add(a.sp); fieldGuide.animalSeen(SPECIES[a.sp].code);
      }
    }
    c[DR] += c[BK]; c[BK] = 0;   // bucks count as deer
    c[WP] += c[WF]; c[WF] = 0;   // and female woodpeckers as woodpeckers
    const parts = [];
    for (let k = 0; k < SPECIES.length; k++) if (c[k]) parts.push(`${c[k]} ${c[k] === 1 ? SPECIES[k].one : SPECIES[k].many}`);
    this.text = parts.length ? parts.join(' · ') : (this.list.length ? `none within ${NEAR_R} m` : '–');
    if (this.lastAlarm && this.time - this.lastAlarm.t < 4) this.text = `${SPECIES[INDEX[this.lastAlarm.code]]?.one || this.lastAlarm.code} calls the alarm · ` + this.text;
    this.scanTags();
    return this.text;
  }
  get tagsOn() { return this.identify ? this.identify.tagsOn : true; }
  scanTags() {
    this.tagged.length = 0;
    if (!this.tagsOn) return;
    const cam = this.camera.position, cand = [];
    for (const a of this.list) {
      if (a.vis < 0.3 || a.culled || !this.present(a)) continue;   // down a burrow, in a crack, out of sight
      const dx = a.x - cam.x, dy = a.y - cam.y, dz = a.z - cam.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < TAG_R * TAG_R) cand.push([d2, a]);
    }
    cand.sort((x, y) => x[0] - y[0]);
    for (let i = 0; i < Math.min(TAG_MAX, cand.length); i++) this.tagged.push(cand[i][1]);
  }
  tagMaterial(sp) {
    if (this.tagMats[sp]) return this.tagMats[sp];
    const name = this.names[SPECIES[sp].code] || SPECIES[sp].common || SPECIES[sp].one, font = '600 30px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
    const c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = font; const w = Math.ceil(g.measureText(name).width) + 28; c.width = w; c.height = 46;
    g.font = font; g.fillStyle = 'rgba(28,20,10,0.66)'; g.beginPath(); g.roundRect(1, 1, w - 2, 44, 12); g.fill();
    g.fillStyle = '#ffe2b8'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, w / 2, 24);
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false, fog: false });
    m.userData.aspect = w / 46;
    return (this.tagMats[sp] = m);
  }
  placeTags() {   // per frame: follow the tagged animals (at most TAG_MAX sprites)
    const on = this.tagsOn; this.tagGroup.visible = on;
    const H = 0.028; let used = 0;
    if (on) for (const a of this.tagged) {
      if (!this.byId.has(a.id)) continue;
      let sp = this.tagPool[used];
      if (!sp) { sp = new THREE.Sprite(this.tagMaterial(a.sp)); sp.renderOrder = 19; this.tagPool.push(sp); this.tagGroup.add(sp); }
      const m = this.tagMaterial(a.sp); if (sp.material !== m) sp.material = m;
      sp.scale.set(H * m.userData.aspect, H, 1);
      sp.position.set(a.x, a.y + TAG_DY[a.sp], a.z); sp.visible = true; used++;
    }
    for (let i = used; i < this.tagPool.length; i++) this.tagPool[i].visible = false;
  }

  // debugging: { total, squirrel, woodpecker, raven, deer, ms }
  get stats() {
    const o = { total: this.list.length, ms: +this.ms.toFixed(3) };
    SPECIES.forEach((sp, k) => { o[sp.one] = this.bySpecies[k].length; });
    return o;
  }
}
