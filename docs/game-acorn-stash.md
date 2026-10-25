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
