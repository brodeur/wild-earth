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

- **Networking**: a node that owns `world` per tile and season, accepts events, echoes
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
