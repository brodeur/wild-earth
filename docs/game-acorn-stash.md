# Acorn stash: the first game

The raven's fall activities in `calendar.json` are forage acorn mast and cache. This is
that loop, as Aaron described it on 2026-10-24, with the details filled in.

## What the player does

1. Press **Start game** in the panel. A game HUD appears: acorns carried, acorns stashed,
   stashes found, elapsed time.
2. Every oak (blue oak, interior live oak) carries a few acorns, as small brown nuts on
   the ground under its canopy and in its lower branches. Acorns **glow** as the raven
   gets close (from about 60 m), brighter the closer you are, so a loaded oak is
   findable from the air.
3. Flying within about 6 m of an acorn picks it up. A raven carries up to **3** at a time
   (ravens hold several in the throat pouch); the HUD shows the count.
4. Some oaks have a **stash hole**: a dark cavity on the trunk with a faint glowing rim.
   Stash holes are invisible until the first acorn is picked up, then visible and
   glowing more brightly as the raven approaches. About one oak in eight has one.
5. Flying within about 6 m of a stash hole while carrying deposits acorns one at a time
   (a short beat between each). A label appears over the hole: **current / capacity**,
   e.g. `2 / 6`. Capacity is 3 to 8 per hole. Full holes stop glowing.
6. Picked acorns stay picked and stash contents persist for this **world** (tile plus
   season), in the browser for now (`localStorage` key `wild-earth:stash:<tile>/<season>`).
   This is the first persistent player state and the first use of the season-world
   identity. State flow between seasons is still the open decision.

Not in this version: competitors (squirrels, other ravens), recovery of caches in the
winter world, scoring beyond counts, sound.

## Rules that keep it honest to the data

- Acorns per oak come from the fall **acorn_mast** resource for the cell (0-100): roughly
  `1 + round(score / 25)` in fall, halved in winter, one at most in spring and summer. A
  blue oak in a cell with high mast is a prize; a lone oak in grassland holds little.
- Which oaks have stash holes, and their capacity, are deterministic from the tree's
  identity (cell, index), so every player finds the same holes in the same trees.
- Only oaks within about 300 m of the raven carry live acorn and stash objects, for
  performance; the deterministic rules mean they reappear identically when you return.

## How it fits the code

- `client/src/vegetation.js` already places trees deterministically per 30 m cell; it
  needs to expose the oaks it placed (species, position, scale, a stable id `i,j,k`).
- A new `client/src/acorns.js` owns acorn and stash objects as instanced meshes with a
  small custom shader: billboarded glow whose intensity is computed in the vertex shader
  from distance to the camera, so there is no per-frame CPU work; stash visibility is a
  uniform. Labels are sprites, created only for stashes that have been found.
- Pickup and deposit are proximity checks against the raven's position each frame,
  over the small live set.
- The game is opt-in via the Start button so flying remains the default experience.

## v2: three species gathering (2026-10-25)

Aaron's design: "Woodpeckers, squirrels and ravens are all collecting acorns. There is a
species level leaderboard. There are many of each species always in the game, controlled
by ai or by people." v2 makes the ambient animals collectors while a game runs, from the
same acorns the player takes, and keeps a score per species.

### Who gathers, and how

- **Acorn woodpeckers** live in family groups of 3-6 (both sexes) on a granary: the
  nearest stash tree within 150 m of the family (the v1 one-oak-in-eight rule; snags count),
  else the nearest oak. At a decision point a bird may forage (chance per decision: fall
  0.55, winter 0.3, spring and summer 0.12): it flies to a free acorn on an oak within
  150 m of the granary (seven times in ten from the lower branches, else the ground),
  pecks it loose for about a second, carries it back in the bill, clings on the granary
  and hammers for two or three seconds, and deposits it. The granary's count shows on a
  small screen-constant tag ("granary 12") above the trunk within 140 m. A granary has
  no capacity; it is separate from the raven's stash hole on the same tree.
- **Western gray squirrels** work alone: from a pause, the nearest free ground acorn
  within 40 m (fall 0.5, winter 0.25, otherwise 0.1); a short head-down pick, then a run
  of 4-30 m from where it was found and two or three seconds of digging; the acorn is
  buried singly and a dark dug mark appears, fading over 1-4 game minutes (the cache
  stays). Now and then (winter 0.25, fall 0.06, otherwise 0.12 per pause) a squirrel goes
  to a buried acorn within 30 m, any squirrel's, digs it up and sits up to eat it. A
  squirrel scared up its tree keeps an acorn it holds and buries it when it comes down.
- **Common ravens** (ambient) gather less often (fall 0.3 per soaring decision): a glide
  down to a free ground acorn within 150 m, a second of pecking, a low flapped hop to
  the side of a shrub within 40 m (or open ground 8-25 m off) and a few pecks to push it
  in: a cache, with its own fading mark.
- **The player** is still the raven of v1: proximity pickup, carry three, deposit into
  stash holes. Those deposits count for ravens.

Collectors claim the acorn they head for, so two animals do not race for one; the claim
does not stop the player (or anyone) taking it first, and the animal then gives up or
looks again. Acorn searches are capped at two per frame across all animals. The acorn
rides at the bill or mouth: animals.js computes the head part's rotation on the CPU
(the same gains as the vertex shader; the drawn squirrel also through its chest) and
the game draws one small acorn with a faint glow per carrier.

Near the eye, v1's big glowing nuts (sized to be found from the air) now shrink toward
life size: 0.3 of their size inside 6 m, full beyond 40 m, the ground ones settling onto
the ground, and their halo is smaller close up.

Supply is v1's: acorns per oak from the fall mast score and the season, deterministic
per tree. New in v2: in **fall** a taken acorn's place fills again after 5-7.5 game
minutes (the oaks keep dropping through September and October); winter keeps what is on
the ground, with no new drops; spring and summer have the odd acorn. AI collectors work
only while a game is running; otherwise the animals do what they did before.

### The leaderboard and the round

The game HUD gains a board: acorn woodpeckers *stashed*, western gray squirrels
*buried*, common ravens *cached*, each with this round's count and the season's total,
and the player's own line ("you, a raven") under their species. The round leader's name
turns amber. L hides and shows it. **Start game** starts a round of 10 minutes of game
time (`?round=<seconds>` for testing); at the end the board names the winning species
and every count, and the game keeps running until Stop. Season totals persist in the v1
key (`wild-earth:stash:<tile>/<season>`), now holding `v: 2`, the world clock, picks with
their times, stash and granary counts, buried acorns, the board and the player's total.
The first time this session that the camera is within 30 m of a woodpecker depositing, a
squirrel burying or a raven caching, a field-guide card explains it and invites the
player to look for the real thing.

### State and events (multiplayer-ready)

All game state is one plain object, `world` in acorns.js:

```
world = {
  tile, season, clock,                 // clock: game seconds this world has run
  picked: Map(acornKey -> clock),      // taken acorns ("i,j,k:n" per oak and acorn)
  stashes: { oakId: n },               // stash holes (v1)
  granaries: { oakId: n },             // woodpecker granaries
  caches: [{ id, x, y, z, by, species, kind: 'scatter' | 'cache', t }],
  board: { melanerpes_formicivorus, sciurus_griseus, corvus_corax },
  you,                                 // the player's own deposits
  species,                             // acorn kinds the player has found
  collectors: { id: { id, species, kind: 'ai' | 'player', carrying, cap, total } },
  round: { t, length, counts: { species: n }, you, over, winner },
}
```

It changes only through `applyEvent(world, e)`, with four events:

```
{ type: 'pickup',  by, key, x, y, z }
{ type: 'deposit', by, oak, into: 'stash' | 'granary', cap }
{ type: 'bury',    by, id, x, y, z, kind: 'scatter' | 'cache' }
{ type: 'dig',     by, id, keep }
```

`applyEvent` validates (the acorn is still there, the collector has room or holds one,
the hole is not full, the cache exists) and scores deposits and burials for the
collector's species and the round. `AcornGame.dispatch(e)` applies it and then draws
the result (instances, labels, marks, HUD) and calls `game.on(type, fn)` listeners. A
server can own `world` and `applyEvent` as they are: clients would send events and
receive applied ones; everything deterministic (which acorns and holes exist) is already
recomputed from tree ids. Claims (`reserved`) are a client-side AI courtesy, not state.

### Measured (2026-10-25, home tile, fall, 9:00)

About 110 collectors in the live set (63 squirrels, 41 woodpeckers, 5 ravens). In the
first minute of a round they gathered about 40 (woodpeckers), 50 (squirrels) and 2-3
(ravens); the player raven can add a few a minute. animals.js costs 0.27 ms per frame
with the game on against 0.22 ms off, the game itself 0.02-0.05 ms: well inside the
0.3 ms budget. Frame times on and off were within noise.

What reads: a woodpecker clinging at the granary with the glowing acorn at its bill, the
hammering, the "granary N" tag ticking up; squirrels running with an acorn and the dark
dug mark left behind; from the air, granary tags and dug marks scattered over open
ground. What does not yet: the woodpecker is ~15-25 px at 5 m, so the face reads as red
cap, white forehead and a dark eye patch rather than the full clown face; ravens are few
and slow, so ravens rarely win a round without the player; a woodpecker heading for an
acorn the player has taken still flies there before giving up; the identify card's line
"You picked up all the acorns" now also counts acorns animals took.

### What v3 needs

- **Networking** (done in v3, below): a node that owns `world` per tile and season, accepts events, echoes
  applied ones; remote players as collectors with kind 'player'; AI run by the server (or
  by one client per area) so everyone sees the same birds take the same acorns.
- **Playable squirrel and woodpecker**: the player record already has `species`; the
  leaderboard line follows it. Needed: a ground or trunk controller instead of flight,
  the species' own verbs on keys (bury, dig, hammer into a granary), carry caps (one for
  both), and their perception.
- Pilfering by the player (a raven robbing a squirrel's cache), woodpecker families
  defending the granary from jays and squirrels, and juveniles.

## Playable squirrel (2026-10-25)

The western gray squirrel is the second playable animal: chosen at the opening screen
beside the raven (remembered), it arrives head down on the trunk of the oak nearest the
chosen point and runs out onto the ground. `client/src/squirrelControl.js` replaces the
raven's controller for the frame and moves the same player position, so everything that
followed the raven follows the squirrel. Tests: `?skip=1&as=squirrel`.

Controls: **W / S** run (a bound, up to 6 m/s) and back; **A / D** or a mouse drag turn
(a vertical drag tilts the look); **Space** jumps (about 0.5 m high and 3-4 m long at a
run: a creek, onto a rock) or, on a trunk, jumps off; **Shift** sits up (the camera rises
to about 1 m); **E** acts. Run into a trunk (within 0.8 m of the bark) and the squirrel
takes hold: **W** climbs, **S** comes down head first, **A / D** go round the trunk, up to
85 % of the tree's height; at the bottom it steps off facing out. Every tree of the near
set can be climbed (oaks, gray and ponderosa pines, snags), by its drawn bole.

The game's verbs for a squirrel, all on **E**, all through the v2 events:

- Not carrying, near a ground acorn (within 0.9 m of the nose): a half-second head-down
  pick, a `pickup`. The carry limit is **1** (in the mouth; the HUD shows `0 / 1`).
- On a trunk: a crown acorn within 1.2 m is picked from the bark; one within 3.2 m at
  about the same height (and in this tree's crown) is reached by a run out along a limb
  and back.
- Carrying, on open ground (not water, rock or roots): two and a half seconds of digging,
  a `bury` of kind `scatter`, the dug mark, scored for western gray squirrels and on the
  board's line "you, a squirrel". The field guide's burying card shows the first time.
- Not carrying, on a dug mark (any buried acorn within 1 m, anyone's: squirrels pilfer):
  a `dig` with `keep`, so it is carried again. Re-burying an acorn the collector dug up
  scores nothing: `applyEvent` counts dug acorns per collector (`dug`) and a burial uses
  one up before it scores.

A squirrel never deposits in stash holes (the raven's) and has no proximity pickup;
`AcornGame.setPlayerSpecies` switches that, the carry cap and the HUD rows ("acorns
buried"; "stashes found" hidden). AI squirrels no longer run up the trees from a player
squirrel. The "trees in view", "around you", identify, mini-map, time and place lines
are unchanged; perception is the tile's matrix for the squirrel.

Measured (2026-10-25, home tile, fall, 9:00, the built-in browser at 1021 x 924): the
controller costs about 0.1 ms per frame (rock rays 0.01 ms); frame rate as a squirrel
53-67 fps against 52 fps for the raven hovering 30 m over the same oak, within noise.

What reads: climbing (the splayed legs on the bark, head first coming down, the
over-the-shoulder camera from below), the run seen from the side (the bound and the
streaming tail), sitting up, landing on a boulder, a 4 m hop over Indian Creek. What does
not yet: from the chase camera straight behind, the squirrel is mostly tail, so the bound
and the acorn in its mouth hardly show; the bound is the AI's procedural rig, not a
gallop; the climb attaches to the bole's axis, so above the fork of a blue oak the
squirrel climbs on through the crown on an invisible extension of the trunk; v1's glowing
acorns are still large next to a squirrel; the game panel and the HUD overlap at narrow
windows; a frame-rate drop slows the squirrel (dt is capped at 0.1 s, as for the raven).

Next, for a playable woodpecker: a perch-and-fly controller (short undulating flights
between trees, clinging to bark with the tail braced, hitching up the trunk like the
squirrel's climb but with the woodpecker's CLING_PITCH), E to take an acorn from a crown
or the ground in the bill (cap 1, already in `PLAYER_CAP`), and E at its family's
granary (the nearest stash tree) for a `deposit` into `granaries`, with the hammering
beat; the board line follows `setPlayerSpecies`.

### Whole trees: the main stem, limbs and leaps (2026-10-25)

The squirrel now climbs the drawn wood itself (`perch.js`, the raven's branch index:
`treegen.treeWood` per near-set instance), not the bole's straight axis. On the bark it
is on one stem at an arc length, on the side its out-of-bark normal points to.
`perch.js` gained (additions only; the raven's calls are unchanged): `joins` (each
stem's parent, where it leaves it, its children; once per plant, about 0.04 ms),
`baseS`, `thinEnd`, `kidsNear` (children at a point), `leader` (the child that carries
a stem on), `fork` (the trunk's root stem and fork), `route` (a path along the wood
between two points of a plant), `recAt`, `nearOn` and `nearBut` (closest wood leaving
one stem out).

- **W / S**: up and down a steep stem head first; past the fork W carries on up the
  main stem (at a stem's end onto its leader: the child most in line and thickest) to
  the top wood 2 cm in radius (a blue oak about 8 m, a gray pine 17 m). Along a level
  limb W runs the way it faces, S goes in toward the trunk; a limb ends where it is
  1.5 cm thick.
- **A / D** at a junction (a child leaving within 0.4 m plus the stem's radius, on this
  side of a thick stem; near a limb's base, its parent up or down): A takes the one
  leaving most to the left, D most to the right, one leaving straight out either. A
  ring round each and a line at the foot of the screen ("A a limb · D up the main
  stem") show which. Without one, A / D go round a steep stem (to underneath it: "under
  a limb", the camera swings below), and a tap on a level limb turns round.
- **Space**: a leap (0.3-0.6 s arc) to wood within 2.5 m the way it faces (out from the
  bark on a steep stem), not its own stem, branches or parent and at least 0.8 m off:
  limb to limb, limb to trunk, trunk to trunk between close trees, into a manzanita.
  With none, a drop, legs spread, that takes hold of a limb it falls across, or lands;
  a fall over 6 m stuns for a second.
- **E** takes a crown acorn within 1.2 m; otherwise says which way the nearest within
  5 m is. The old run out along a limb is gone (the squirrel runs the limb itself).
- Camera: over the shoulder, behind and out from the bark; shorter (x0.55) out a limb
  or in its own crown; kept out of other crowns by the woodpecker's crown-sphere rule;
  drawn in short of a limb in the way (never nearer than 0.9 m); the boom's direction
  and length ease separately, so a swing round a stem never passes through the body.
- HUD row "where": "on a blue oak, 7 m up, on a limb" (trunk, main stem, a stem, a
  limb, a branch, under a limb; in the air, stunned, on the ground).

AI squirrels (`animals.js`) climb the same wood. Each oak's limbs (off the bole or main
stem, 3 cm thick at the base, a metre of 2 cm wood, ending 2 m up, not steeper than
~44 degrees there) and paths (ground to a limb's end, limb to limb, sampled every
0.25 m on the bark, on the limb's side of the trunk and the top of the limb) are built
once per tree (0.07 ms a path) and followed along a stored polyline (0.3 µs a frame).
They climb out a limb and sit, forage along the wood to another limb, and come back
down the way they went. A fleeing one runs round the foot of the trunk, climbs on the
far side, runs out the limb furthest from the player and freezes flat on it (15-40 s,
longer while the player is within 20 m). A player squirrel running at one (within 4 m,
over 2.5 m/s) is now a chase that sends it up; merely being near still does not.
Raids, and trees outside the near set, keep the old trunk-to-the-fork climb.

Verified (built-in browser, home tile, fall): a veteran blue oak to the top (8 m),
three limbs taken with A / D and run to their ends, a leap limb to limb, gray pine to
gray pine and onto a manzanita, a drop that caught a limb 4 m down, a 17 m drop
(stunned), a gray pine climbed to 17 m, a crown acorn from a limb, a chase (the AI
squirrel up the far side of an interior live oak and frozen 5 m up on the limb opposite the player), the raven still perching
on a blue oak; no console errors; 45 fps on the ground and 46 in the crown (animals
0.28-0.31 ms). Does not read well yet: inside a blue oak's crown the leaf cards fill
most of the view (the boom is shorter there, but the leaves are where the limbs are);
in the leap the ground chase camera sits low under the limbs; the junction rings are
plain tori; the leg splay is a single blend, not a grip; trees far from the player
(outside the near set) still have AI squirrels on the old fork-and-float climb.

**Camera in the crown and in the leap (2026-10-26).** Three things, all in `squirrelControl.js`:

- *Leaf cut.* In the tree (on the wood, the old trunk climb, a leap, a drop from the wood) the leaf and twig cards
  nearer the lens than the squirrel dissolve: within 0.85 of the squirrel's distance round the lens, and in a
  screen-space capsule from the squirrel to 1.4 m along the way it faces (the landing, in a leap), with a dithered
  edge (the LOD cross-fade's alpha hash). It is a fragment test chained once onto the vegetation's near and close
  canopy materials and the close twigs (`leafCut`), driven by uniforms the squirrel sets each frame (zero otherwise,
  so the raven and the woodpecker draw as before; shadows are unchanged). Leaves beyond the squirrel stay: the crown
  still surrounds the view, with a clear hole round the squirrel and the limb ahead.
- *Round the stem to a clear line.* The cut clears leaves, not wood: a branch across the line from the lens to the
  squirrel (perch.js `nearBut` sampled along it, every 0.1 s) swings the boom round the stem's axis to the nearest
  clear side (+/-0.45, 0.9, 1.35 rad), eased, and back when straight behind is clear again. The pull in short of a
  limb near the lens is now eased (15/s in, 3/s out) rather than a cut.
- *Leap and drop.* A leap keeps a tree camera, 1.5 m behind the leap and 0.7 m above, looking ahead toward the
  landing, easing into the landing limb's camera; it no longer falls back to the ground chase camera. A drop from the
  wood keeps a camera 1.7 m back and 1.1 m up over the fall and blends into the chase camera over the last 2.5 m.
- The junction rings are a thinner band with a chevron pointing the way the junction leaves, breathing a little.

Tried and not kept: a 0.6 m over-the-shoulder camera looking along the limb (the tail fills the lower third and the
leaves are still there); the leaf cut with a longer boom (0.8 x instead of 0.55 x: more context but the squirrel
small and more wood across the line). Verified (built-in browser, home tile, fall, before and after from the same
spots): a blue oak climbed with W to 5 m, a branch taken with D and run out to 7 m, looked round with the orbit
(-1.4 to 2.4 rad); limb-to-limb leaps (camera 0.4-0.7 m above, 1.2-1.6 m back throughout, no drop to the ground
camera); a 7 m drop (stunned) easing to the chase camera; the woodpecker and the raven draw as before; no console
errors; frame time with the cut on and off the same within the noise (28-34 ms median in this session's quiet
spells). Still does not read well: looking across the crown (orbited side-on) the leaves beyond the squirrel are a
wall behind it, and the cut's dithered edge shows as torn leaves against the sky; on a steep stem in the crown the
squirrel sits low in the frame (the head-up composition is unchanged); the leap camera does not test wood across
its line (only the eased pull near the lens).

## Playable woodpecker (2026-10-25)

The acorn woodpecker is the third playable animal: two cards at the opening screen's "who"
(male: the red crown reaching the white forehead; female: a black band between the white
and the red), species and sex remembered (`we.lastSpecies`, `we.lastSex`). It arrives
clinging to its **family's granary**: the AI families' rule (`animals.familyGranary`), the
nearest stash tree within 150 m of the chosen point, else the nearest oak. If no AI family
lives on that tree, one of 3-6 is spawned on it and kept through rebuilds
(`animals.familyOn`), so the player hammers beside its own family; a player woodpecker
flushes no woodpecker. The HUD gains "your family's granary: N acorns · 46 m west" (or "you
are on it"), and the granary's tag reads "your granary N" in amber, shown from 0. The camera
drifts in over about 3.5 s; any key skips. `client/src/woodpeckerControl.js` replaces the
raven's controller for the frame, as the squirrel's does. Tests:
`?skip=1&as=woodpecker[&sex=female]`.

Controls. **Clinging** (on a trunk, braced on the tail at the AI's `CLING_PITCH`): **W / S**
hitch up and down in short hops (13 cm in 0.11 s, a 0.08 s grip between; down is tail
first, as woodpeckers back down), **A / D** hitch round the trunk (at most 0.3 rad a hitch),
**Space** launches outward. Up to just under the fork of the drawn bole (the AI's
`forkHeight * 0.95`), and down off the bottom onto the ground. **Flying**: **W / S** speed
(2.5-12 m/s; left alone it eases back to 7), **A / D** turn, **↑ / ↓** or a mouse drag
climb and dive (level again when let go), **Space** a hard burst upward. **Perched** on the
ground or a branch (rare for this species): **W** a short hop (0.45 m), **A / D** turn,
**Space** launches. **E** acts.

The flight. Bursts of quick beats (12 Hz, 0.42 s) rising, then the wings shut against the
body (0.36 s) and the bird drops on a parabola: about 30 cm at cruise, scaled down below
8 m/s; slow (under 4.5 m/s), braking or climbing hard it beats on without the dip. The
dip is an offset on a base line that the pitch drives, so the undulation never changes
where the flight goes. The body pitches with the climb and the dip and banks in turns.
Chase camera 1.2 m up and 3 m back, following the pitch partly.

Landing. **Into a trunk**: each frame in flight, the near set's trees (not shrubs) within
1 m of the bark at the bird's height, below the fork and ahead of it (heading within about
65 degrees of the trunk) are a grip; the bird settles onto the bark in 0.22 s, turning to
face it and pitching to the cling, and is clinging. **S inside a crown** (over 1.5 m up,
within the crown's reach of the trunk, above 60 % of the fork) lands on a branch there; **S
under 4 m** elsewhere lands on the ground a little ahead.

Acorns, all on **E**, through the v2 events:
- Clinging, not carrying: a crown acorn within 1.2 m is pecked loose (0.8 s, a `pickup`);
  else one within 5 m in this tree's crown is reached by a short flight, pecked loose, and
  the bird flies back to the same spot on the bark.
- Flying or perched: the nearest acorn within 5 m (crown or ground), by a short flight,
  then perched where it was (on the branch or the ground); on the ground, one at the bill
  (0.8 m) directly.
- Carrying (cap 1, in the bill at the AI's carry point), clinging on the family's granary:
  2-3 s of hammering (the AI's beat, the head striking at about 6 Hz, the body rocking with
  it), then a `deposit` into `granary` for the family's oak, scored for acorn woodpeckers,
  the round and "you, a woodpecker"; the tag counts up and the field guide's granary card
  shows the first time this session (if the family has not already shown it). On another
  tree E says where the granary is. No burying, no stash holes.

Acorns near the eye of a small player (squirrel or woodpecker) shrink further than v2's:
0.06 of the far size inside 2 m (a nut about 5 cm long), full beyond 40 m, and their halo
is a quarter of the raven's close up (`setPlayerSpecies`).

Measured (2026-10-25, home tile, fall, 9:00, the built-in browser at 1021 x 924): arrived on
granary 168,166,0 (a blue oak, fork at 1.7 m); a family of four spawned on it; hitching
0.65 m/s up and 0.7 m/s down; a 46 m flight to an interior live oak in 4.2 s (bursts and
dips, up to 12 m/s) gripping its trunk at 1.1 m; a crown acorn taken; back in 6 s; hammered
in: granary 14 to 15, round "you" 0 to 1. Frame rate clinging 54-62 fps and flying 56,
against 63 for the raven hovering 30 m over the same granary: within noise (the close
camera inside low crowns adds overdraw). animals.js 0.26 ms, the game 0.01 ms.

What reads: the cling seen from behind (black back, white rump and wing patches, the red
cap), the family clinging and hammering on the same trunk, the wings up in a burst from the
chase camera, the hammering, the "your granary" tag and the board's line. What does not
yet: in flight at 3 m the bird is small (15-80 px depending on the wing phase), so the
dip reads better from the motion than from the bird; blue oaks fork low (1.4-1.7 m), so a
woodpecker can only hitch about half a metre on many granaries, and above the fork the
crown has no trunk to hold; branch perches are at a point in the crown, not on a drawn
limb; the clinging camera sits 0.85 m off the bark and sometimes inside a live oak's
foliage; the field guide's granary card says "you just watched" for the player's own
deposit; Space and E pressed during a short flight wait for it (up to half a second).

## v3: shared world (2026-10-25)

The first multiplayer node. The dev server (`server.py`, `GameWorld`) owns one acorn-game
world per tile and season; every browser in it sees the same acorns go, the same counts
and the same round. With no game endpoint (an older server, a static host, `?net=0`) the
game is v2 exactly: offline, its world in localStorage.

### What is authoritative where

- **Server**: the world (who took which acorn, stash and granary counts, buried acorns,
  every collector's carry and total, the board), the world clock, the round (start, end,
  winner) and fall regrowth. It checks every event with the rules of `applyEvent`, ported
  to Python (`game_reduce`), and computes a stash hole's existence and capacity itself from
  the oak id (the same FNV-1a and mulberry32 hashes; checked bit for bit against the JS).
  It does not hold the vegetation, so it trusts that an acorn key or a granary oak exists.
- **Client** (`client/src/net.js`): a prediction. `world` is the server's world plus this
  browser's unanswered events, drawn at once; the JS reducer is the prediction's rule. A
  reject, or a remote event that does not apply to the prediction, rebuilds it from the
  confirmed copy plus what is still pending (at most once a frame). Positions of the
  animals, the camera and all drawing stay local.
- **AI host**: the AI collectors run in one browser per world. The server names the first
  client to join; when it leaves, the next oldest is told. Only the host's AI events are
  accepted. The others' animals go about as they do outside a game (`animals.js`
  `gameOn` reads `game.aiLocal`) and carry an acorn in the bill or mouth when the world
  says that animal holds one, so who took which acorn and the counts agree everywhere.

### Protocol (WebSocket, JSON text frames, `GET /api/game/ws`)

`GET /api/game` answers `{protocol: 1}` (the feature test). Client to server:

```
{t:'hello', v:1, tile, season, species, r, sid}   join; sid is this browser's id for round r
                        (below); without it, or for another round, the server answers 'epoch'
{t:'id', r, sid}        the id for a new round (after a 'round' message with a new id)
{t:'ev', c, e}          an event; c: the client's own counter. A player's e has no `by`
                        (the server knows the connection); an AI's has by, sp, cap, held
{t:'start', length}     start a round if none is running (Start game sends it on joining)
{t:'species', species}  the player switched animal
```

Server to client:

```
{t:'epoch', r}          the round player ids belong to now: derive the id and ask again
{t:'welcome', you: 'p:<hash>', r, host, n, world}   the whole world (persisted shape below)
{t:'you', you, r}       the player's id for the new round (its events in between were held)
{t:'ev', seq, clock, e, pre: [carrying, dug], col: {sp, k, cap}[, c]}   an accepted event
                        (a player's burial comes back with the server's cache id, k<n>)
{t:'rej', c, why}       taken, full, empty, stash full, no stash hole, not the AI host ...
{t:'round', seq, clock, round}    started or over (winner)
{t:'regrow', seq, clock, keys}    fall acorns back on the ground
{t:'players', n, host}  on every join and leave
{t:'sum', seq, clock, board, rc, n}   every 5 s: a check on the client's reducer
```

`seq` numbers every change; a client that sees a gap reconnects for a fresh welcome. `pre`
is the collector's carry before the event, so a client applying someone else's event does
not depend on having seen that collector from the start. `held` is the AI animal's own
carry: a re-made animal starts empty (v2 already reset the record from the animal), and a
new host's animals start empty too. Conflicts: the first event to reach the server wins;
the other player's pickup is rejected ("taken") and rolled back on their screen.

Player ids: the browser keeps one random id (localStorage `wild-earth:sid`) and never sends
it. For each world and round it sends `sid = sha256(id|tile|season|r)` (32 hex digits; `r`
is the running or last round's number, 0 before the first), and the server calls the player
`p:` + 12 hex digits of `sha256(sid)`. A round starting ends every player id: the server
drops the old ids' records, holds a player's events until its next id arrives (`id`), and
moves the carry across in memory only. The leaderboard's "you" line for the round reads the
round's count for the current id; the SEASON column ("you" season total) and the field
notes are counted in the browser and kept only in its localStorage.

Round: Start game joins the world and asks for a round if none is running (`?round=<s>`
sets the asked length, 20-3600 s). The round runs on the world clock, which advances only
while someone is in the world; Stop game leaves the world (the round goes on for the
others). Everyone sees the same end and winner.

### Persisted shape

`tiles/<tile>/game/<season>.json`, written at most every 2 s while it changes and when
the last player leaves:

```
{ v: 3, tile, season, seq, clock, saved_at,
  picked: { acornKey: clock },  stashes: { oakId: n },  granaries: { oakId: n },
  caches: [{ id, x, y, z, species, kind, t }],       (no collector: k<n> for a player's)
  board: { species: n },
  collectors: { id: { id, species, kind: 'player' | 'ai', carrying, cap, total, dug } },
  round: { id, start, length, counts: { species: n }, by: { playerId: n }, over, winner } | null,
  rounds, cache_n }
```

`collectors` holds the AI animals and only the current round's player ids. Plus
`<season>.events.jsonl`, one line per change: `ev` (as broadcast, except a player's burial
and dig), `round`, `regrow`, and for a player's burial two lines with the same `seq`: the
count (`{type:'bury', by, kind}`, no place) and `{t:'cache', c:{id:'k<n>', x, y, z,
species, kind, t}}` (no player); a player's dig likewise as `{type:'dig', by, keep}` and
`{t:'uncache', id}`. On load the snapshot is read and the log's lines with a higher `seq`
replayed (a crash loses nothing that was acknowledged). Every time a snapshot is written,
the log's lines up to it are rewritten without player ids (`by` dropped from player events,
`by` dropped from round lines), so the log keeps the world's history and not a player's.
From the log alone (snapshot lost) the world rebuilds whole except the players' counts.

### What the node stores about a person

A hashed per-round id and counts, nothing else. Exactly:

- in the snapshot, for each player id of the current round: the animal species it plays,
  its carry capacity, how many acorns it carries, how many it has stored this round (total),
  how many it carries that it dug up (dug: re-burying those scores nothing), and its count
  in the round's `by`;
- in the log, until the next snapshot (at most 2 s while the world changes; at once on
  the next start after a crash): that id beside the acorn keys it picked up, the oaks it
  deposited into (a stash or granary oak id) and its burial and dig counts.

Not stored: the browser's random id, names, addresses or any network detail (the request
log prints method, path and status; messages are never printed), the acorn species found,
the season total, any position next to a player id. Burials and dug caches are positions
under an anonymous `k<n>` id. Limits that remain: an acorn key and an oak id name a tree,
so the unscrubbed tail of the log places a player near that tree for up to 2 s; a burial's
two lines share a `seq` for the same 2 s; and every connected browser receives each event
with its player id and position (needed to draw it; held in memory, not stored). The
server links a connection's old and new ids in memory at a round change (to carry its
acorns across) and writes no record of that.

### Limits of this node

- The AI runs around the host's player only (animals live within 400 m of the camera).
  Elsewhere in the tile, other players see no AI gathering; two players far apart see the
  AI near the host. AI positions are not synced: another player sees the host's squirrel
  bury an acorn as a dug mark appearing, not as their own squirrel doing it.
- A host change drops what the old host's animals were carrying (they never deposit it).
- Animal ids are deterministic per cell, so the same animal id exists in both browsers,
  but its local motion differs.
- While the server is unreachable mid-game the client keeps playing on its prediction and
  retries (1-30 s backoff); events are resent on reconnect and the server decides. Nothing
  is saved locally meanwhile. If the server is gone when Start game is pressed, the game
  goes back to the v2 world in localStorage.
- AI collector records accumulate (about 440 after five minutes); a snapshot was 90 KB.
- One Python process, one lock per world, events at most 40 per second per connection.

### Verified (2026-10-25, home tile, fall)

A test server on port 8805 (the 8782 dev server untouched). A standard-library WebSocket
client checked the protocol: host election, a round seen by both, the same acorn picked by
two players (first accepted, the second rejected "taken"), a stash deposit checked against
the hashed capacity, a deposit into an oak with no hole rejected, AI events refused from a
non-host, the host moving on leave, and the world persisting across reconnects and a
server restart (also from the log alone, with the snapshot removed). Then two browser pages
(a headless Chrome for Testing over CDP; the built-in browser was at its tab limit), a
raven and a squirrel (`?seat=2`) in one world: a 180 s round started by the first and seen
by both; both predicted the same acorn at the same instant, the squirrel's reached the
server first and the raven's rolled back; the raven hovered over the same blue oak and
took three, then filled a stash to 6/6; the squirrel buried one; the board (24 / 48 / 7),
the stash count and each player's own line agreed in both pages and the server. Closing
the raven's page moved the AI host to the squirrel's, which went on sending the AI's
events (22 accepted, none rejected). Reopening and reloading: same player ids, the
raven's total 6 and carry 3, the same round with the time left. The round ended on the
server with the same winner and message in both. Stop and Start in one page started round
2 for both. The server was killed and restarted mid-round: both reconnected, the host's
events were all accepted (no rejects) and the counts matched the server again. No reducer
mismatches in any `sum`. With the server stopped, Start game fell back to the v2 world
(localStorage, AI local); on a static server (`/api/game` 404) the squirrel played offline
as before. Console: no exceptions; only an existing three.js warning and the browser's
own lines for the refused or 404 probe.

Re-verified after the privacy rules (same day, test server on 8805). The protocol script
passed 21 checks, the earlier ones plus: the id derived per round (a new round, a new id;
the same round after a reconnect, the same id), events held across the id change, no acorn
species and no field notes on the server, a player's burial named `k1` by the server and
dug up by another player, no log line with both a player id and a position, and after a
snapshot no player id anywhere in the log. A crash test (SIGKILL before a snapshot):
the unsnapshotted lines still carried the id, the restart replayed them (carry, total,
round count, cache `k1`, granary) and scrubbed the whole log, and with the snapshot deleted
the scrubbed log alone rebuilt the board, round counts, picked acorns, cache and granary,
with no player's counts. Two browser pages (raven, squirrel): each page's id matched
`sha256(sha256(id|tile|fall|1))`, the same-instant race went to the squirrel and the
raven rolled back, the raven filled a stash (round "you" 6), the squirrel buried, dug its
own `k1` and buried it again (you 1: the re-burial scored nothing). Round 2 gave both new
ids, dropped the round-1 ids from the snapshot, reset the round "you" to 0 while the
SEASON column kept 6 and 1 (counted in the browser), and ended with the same winner and
"You gathered 1." in both. After 986 log lines, none carried a player id once the
snapshot covered it. Fixed on the way: a rebuilt prediction took the round's time left
from the last confirmed message (minutes stale on a quiet client).

## v4: defence and pilfering (2026-10-25)

Stores get robbed and defended. The natural history (Koenig and Mumme on acorn woodpecker
families; Vander Wall and Steele on scatter hoarders; neither mesh brief in
`library/animals/drafts/` says it, so the field-guide text stays general): an acorn woodpecker
family shares one granary and drives jays, squirrels and other thieves off it together, with
calls and repeated swoops; scatter-hoarded acorns are found by smell, and much of what is
buried is dug up by someone else.

### Rules

- **Pilfering.** A dig of someone else's buried acorn (a squirrel's, a raven's, a player's)
  scores +1 for the digger's species (and its "raided" line) and -1 for the owner's species
  (never below 0); the owner's own total drops too when it is known. A pilfered acorn that is
  kept counts as dug, so burying or caching it again scores nothing (v3's rule). Digging one's
  own cache is not a pilfer. Who digs: the player squirrel (E on a dug mark, as before); AI
  squirrels as in v2 (the nearest scatter cache within 30 m, anyone's), now keeping someone
  else's half the time and burying it again elsewhere; AI ravens, one forage decision in five,
  glide down to the nearest cache within 150 m that is not their own and cache it again; jays
  on the ground probe out one within 2.5 m now and then and eat it.
- **The owner learns of it.** A squirrel on the ground within 20 m of its dug-up cache sits up
  (0.5-1.1 s), runs to the spot and, if the thief is within 5 m of it, chases it (5.5 m/s, up
  to 5 s); caught (0.6 m), the thief is mobbed: it drops what it carries. A player whose cache
  is dug up gets a line in the game box ("a scrub-jay dug up one of your buried acorns").
- **Raiding a granary.** A raven or squirrel (player or AI; AI scrub-jays and Steller's jays
  too) can pull an acorn from a granary that holds one: the raven hovering or standing within
  2.2 m of the bark (H hovers), for 1.5 s; the squirrel on the trunk (climbed, 0.6 m up or
  more), for 2 s. The acorn comes free only when no family member is within **8 m** of the
  hole; while one is, the pull holds. A raid scores +1 for the raider's species and "raided",
  takes one from the granary's count and -1 from acorn woodpeckers. Woodpeckers do not raid.
  AI squirrels try it from a pause near a granary (fall 5 %, winter 4 % of pauses, within
  25 m); jays perched within 50 m of one (about one try per 80 s per jay in fall).
- **Defence.** A raider at a granary (pulling, or leaving with a stolen acorn within 20 m) is
  a threat. Family members within **20 m** of their granary answer: the rally call (the
  `rally` event; sound.js plays the waka from the nearest bird and a second from a family
  member), and the nearest one, or two when three or more are home, fly at the raider: up over
  it, then a dive straight through it and on past, again and again. The first swoop only
  brushes past; a later one within 0.8 m strikes (or they give up after 7 s). A strike is a
  `mob` event: the raid is interrupted, a squirrel carrying drops its acorn (a stolen one's
  score goes back), and the raider is driven off: **20 s** on the world clock in which the
  server refuses its raids (the HUD counts it down), 25 s for an AI raider.
- **Fairness: the family goes out in cycles.** In a game each family is away gathering for 40
  of every 100 game seconds, phased per granary from the shared world clock (so every browser
  sees the same family away at the same time). Away, birds near the granary fly out to oaks
  30-120 m off and forage from there; one with an acorn holds it until the family goes home,
  then hammers it in. At home they keep within ~45 m (the v2 long flights are off during a
  game). So a raider who waits for the family to leave gets an acorn; one who goes in while
  they are home is mobbed. The HUD says which ("the family is away gathering" / "the family
  is home: they will mob you").

### State and events

`world` gains `raided` and `mobbed` (per species, this season) and the round `raided` and
`mobbed`; a collector gains `loot` (stolen acorns it carries) and `off` (world clock until
which it may not raid). Two new events:

```
{ type: 'raid', by, oak }      an acorn pulled from a woodpecker granary (an AI's also x, y, z)
{ type: 'mob',  by, drop }     a raider driven off for DRIVEN_S; drop: it lost the acorn it carried
```

and `dig` gains the server's verdict (`own`: whose cache it was, `osp`: its species, `pil`:
someone else's), which clients apply in place of their own guess. Validation, the same in
`applyEvent` (acorns.js) and `game_reduce` (server.py), first event wins:

- raid: the collector's species is a raider (raven, squirrel, scrub-jay, Steller's jay), the
  granary holds at least one ("empty granary"), it has room ("full"), it is not driven off
  ("driven off": the server's clock against `off`);
- mob: a drop needs something carried ("empty"); it sets `off`;
- dig: as before (the cache exists, room when kept); the owner is the cache record's `by` for
  an AI's cache, the server's in-memory map for a player's.
- AI events for jays are accepted for dig, raid and mob only (they are not on the board).

**The 8 m rule is not checked by the server**: it has no positions of animals or players (a
player's events carry none, and AI positions are never synced). The raider's browser checks
it against the family birds it draws (the AI host for AI raiders, the player's own browser for
the player), and the server trusts that, as it trusts that an acorn key exists. The family's
away cycle is computable on the server (clock and oak id) but is not enforced there: members
can still be near the granary as the family leaves or comes back.

Protocol: `pre` is now `[carrying, dug, loot, off]` (a v3 log's two-element `pre` still
replays); `sum` adds `raided` and `rr` (the round's), checked like the board. The leaderboard
shows a line "raided N" under ravens and squirrels (this round, this season; "· driven off
M" this round), counting granary raids and pilfered caches together; woodpeckers have no line
(they are the raided). Field-guide cards: "Thieves at the larder" the first raid or pilfer the
player sees within 30 m or makes, and "Mobbed" (or "Chased off" by a squirrel) the first time
the player is mobbed.

### What the node stores about a person, v4

In addition to v3's list: in the snapshot, the player's `loot` (a count) and `off` (a clock
time). In memory only: which buried acorn a current-round player owns (cleared when a round
starts, never written beside a cache's place; after a restart a player's caches are anyone's).
In the log, a dig of a player's cache (by anyone) is written as two lines like a player's own
dig, the count with `own` and the place as `uncache`, and `own` is scrubbed with `by` on the
next snapshot. Broadcast, a dig carries `own` (a player id) beside a cache id whose place every
client already has: in memory on the clients, not stored. A raid and a mob from a player carry
no position.

### Verified (2026-10-25, home tile, fall)

Reducers: the same scenario (AI burial, player burial, pilfer, mob with drop, own dig,
re-burial, raven raid, deposit of the stolen acorn, driven off, empty granary, a woodpecker
refused, a jay's raid and drop, a scrubbed and a v3 log line) passes in both, with the same
counts. Offline (`&net=0`, the built-in browser): as the raven, hovering at a granary with the
family home, a rally and two birds diving, mobbed 0.5 s after the rally (the birds were 2-3 m
off; the first swoop is now a warning that only brushes past, and online the strike came 6.8 s
after the rally), "driven off: 18 s"; at a granary whose family was away, the acorn came
free after 1.5 s, the board read ravens "raided 1 / 1" and the field-guide card showed. As the
squirrel: a pilfer of an AI squirrel's cache 9 m from its owner, which sat up, ran over,
chased from under 5 m and caught the player ("you dropped it", raided back to what it was); a
raid up an away family's trunk (2 s pull, granary 2 to 1); a family member coming home within
20 m dived at the squirrel still on the trunk and it dropped the acorn (raided 10 to 9). AI:
squirrels raiding granaries and being mobbed with drops, a raven pilfering a squirrel's cache,
squirrels pilfering each other, a scrub-jay's raid mobbed. Online, on an isolated test node
(port 8806, its world under the scratchpad, not `tiles/`): a raven (AI host) and a squirrel
(`&seat=2`, a second pane tab) in a 90 s round; the server accepted the player's mob and two
raids, the squirrel's pilfer (with its verdict), the AI's pilfers, mobs and a Steller's jay's
raid, with no rejects and no reducer mismatches; host, second tab and the server's summary
agreed on board, raided, mobbed, round counts and granaries at the same `seq`. The log held no
player id at all once snapshotted; a SIGKILL restart and a rebuild from the log alone gave the
same board, raided, mobbed, granaries and caches. Console: no errors.

Per frame (the built-in browser with four other copies of the app open): the game 0.03 ms;
`defend()` 0.002 ms; animals.js 0.43 ms with the game on against 0.34 ms off (v2 measured 0.27
against 0.22 on a quieter machine; the difference is the collectors, mostly v2's).

What reads: the HUD's pulling / family-away / driven-off lines and the mobbed glow on the game
box; the board's "raided · driven off" line; a squirrel sitting up, running to its dug-up
cache and chasing the thief; the jay flying in to the trunk and away again. What does not yet:
the dive itself is hard to see from the raven's chase camera at a granary (the camera is often
inside the crown, and the woodpecker is 15-25 px); the AI's 8 m check uses each browser's own
birds, so another player's screen does not show why a raid was or was not stopped; woodpeckers
gather more slowly in a game (the away cycle and the flights out; about 14 a minute from 58
birds here against v2's 40 from 41); after a round change a player's caches from the last round are "someone
else's" to its new id (a pilfer of one's own old cache scores +1 / -1 for the same species
and +1 on the "you" line); the 8781 dev server runs the v3 node until it is restarted, and
until then it refuses raid and mob events (the client rolls them back) and its dig scoring
differs from the client's (the 5 s sum corrects it with a console warning).
