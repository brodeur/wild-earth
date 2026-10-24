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
