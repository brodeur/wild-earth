# Morning report, 2026-10-25

Overnight work under Aaron's standing authorization (2026-10-24 evening): "continue to
iterate on improving the quality as long as you are able... as richly textured as
possible, with special attention to the silhouettes." Plus the product frame: a child
who goes outside to pick up acorns; an adult who sees their parking lot as oak woodland.

Every item below was built by a delegated agent in its own files, verified in the
browser by me (screenshots, console, frame rate where measurable), then committed and
pushed separately. Main is at the last commit listed. Hard-refresh the client.

## What changed, in order of landing

1. **Present-day peek (hold P)** with place names: the ground swaps to the real 2022
   photo with everything else hidden, a "today" HUD row names the nearest road or creek
   with distance and direction, and the mini-map swaps roles. The adult-and-parking-lot
   moment. (9d4768b)
2. **Pipeline:** sharp present-day texture; LANDFIRE species mix per cell (every
   vegetation type in both tiles matched a rule); acorn woodpecker and scrub-jay added
   as species with records. (66883a2)
3. **Local knowledge into the tile:** the viewer's verify/flag, hand-drawn mask
   polygons and species notes now save to the manifest's edits log through the dev
   server; docs/contributing.md; and a fix so builds can no longer drop edits. (24fffc5)
4. **Sound:** a fully synthesised soundscape: wind by speed, height and bank; wingbeats
   on the downstroke; a raven call on C with a distant raven that answers; quail,
   acorn woodpecker, scrub-jay, red-tailed hawk and Steller's jay placed in 3D by the
   habitat they call from, with dawn and dusk choruses; a stream wash near creeks;
   crickets at summer dusk. N mutes. (0db553e)
5. **Grass and chaparral for the third-person camera:** blades take the ground's colour
   so the handover to texture vanishes, lean to show their faces from above, a shared
   gust field sweeps the ground, terrain-conforming shell layers, and a shrub field
   that finally makes chaparral read as dense shrubland. (5249262)
6. **Horizon silhouettes:** one baked impostor per real tree, same species, seed and
   position as the tree that replaces it, soft edges, height variety. Ridge lines are
   irregular tree lines of pine spires and oak domes; the blocks and sawteeth are gone.
   (11822fe)
7. **Acorn field guide:** cards on the first pickup of each oak species and on the first
   stash, with drawn acorns, three facts for a ten-year-old and "find a real one"
   invitations; species tally in the game HUD. The child-and-acorn moment. (caa3ec7)
8. **Cast shadows and contact AO:** three hand-rolled cascades; trees shadow the ground
   and each other, the raven has a shadow, shrubs sit on theirs, long dusk shadows;
   darker ground under canopy. The single biggest change to depth and texture. Plus
   **ambient animals**: squirrels, acorn woodpeckers, other ravens and deer with simple
   foraging behaviour and perception filtering. (f405656)
9. **Water:** seasonal stream surfaces and dry gravel beds by stream order and class,
   reflective ponds. (069e8a0)
10. **Birds and herds from the air:** quail coveys that flush, jay groups, hawks that
    stoop, turkey vultures teetering in circles, deer herds walking in file with
    shadows. Honest limit: from 120 m only a deer herd reads in a still frame.
    (2ba6355)
11. **Tree likeness from 48 reference photographs:** crown outlines traced from photos,
    clumped foliage with gaps, six new leaf textures, procedural bark per species,
    winter twigs and mistletoe on blue oak, photo-derived colours. Blue oak is a broad
    low dome, chamise a ragged vase, gray pine pale and see-through. Cost ~20% frame
    rate; a tuning pass is running. (4d93a85)
12. **Grass refinements:** canopy shading on grass, grassland grain to 200 m with
    wild-oat stands, shrub silhouettes in three shapes per species. (10dc487)
13. **Pipeline:** turkey vulture and Steller's jay as real species. (939eafe)

## Landed after the draft above

14. **Forest composition from LANDFIRE per cell** and no vegetation in ponds or stream
    channels, with a savanna oak minimum where the data says blue oak savanna. Whole-tile
    blue oak 18% -> 25%, gray pine 26% -> 19%. (4cc9511)
15. **Far impostors use the real forest's placement**, so every tree has an identical
    far twin and nothing changes species on approach; zero impostors in water. (766746a)
16. **Grass and shrubs out of water; the grid in the ground grain fixed** (a sin-based
    noise hash losing precision at kilometre coordinates). (8d54bc6)
17. **Water fixes:** large ponds reach their shoreline with a soft edge; rivers of order
    5-7 widened to 12/20/30 m. (9263c5b)
18. **Sound comes from real birds;** quail flushes and hawk stoops are events with their
    sounds; C gets an answer from the nearest real raven; a proper shadow-caster API,
    and all animals cast animated shadows. (2d2c76e)
19. **Tree frame cost recovered:** far-tier cards capped per tree and thinned with
    distance, cheaper mid trunks; tree GPU time cut 40-58%, likeness metrics unchanged.
    (f967a1f)
20. **Opening screen and arrival:** where (tile cards, typed place), when (season cards,
    "today" marked), who (species cards showing what each perceives; only the raven
    flyable), then a 12 s descent over your hills under a caption like "near Greenstone
    Road · fall · common raven". The first five minutes now have a shape. (949205a)
21. **Tree age classes and snags** for all six species on twelve variant slots (saplings
    to flat-topped old-growth ponderosa, forked gray pine veterans, grey snags that cast
    shadows and get impostors). Snags come out at 8%, a little high. (e1bb2bd)
22. **Haze rework:** two-term haze keeps far crowns dark against pale grass at 3-4 km;
    gold low sun; the pale horizon strip eased. (645dc6a, with an animals fix)
23. **Animals:** coveys and herds survive losing their leader (a crash after a season
    switch). (645dc6a)
24. **Far impostors keep each slot's own height; no acorns or stashes on saplings and
    snags.** (60425e6)

## Final measurements (one tab, nothing else rendering, 893x357 pane at 2x)

| View | Frame rate | Triangles | Draw calls |
|---|---|---|---|
| Start view, 150 m up | 68-69 fps | 5.5 M | 179 |
| 20 m low pass, oak woodland | 61 fps | 5.5 M | 214 |

Faster than the start of the night (about 50 fps at the start view after shadows):
the tree tuning more than paid for shadows, likeness, water, animals and sound.

## What I judged and left alone

- Close-tier crown interiors still read as sprays rather than leaves; the likeness pass
  fixed edges more than interiors. Winter blue oak twigs read as a brownish haze.
- From altitude, ground animals are invisible without the HUD, as real ones are; the
  alive feeling at 100 m comes from birds in flight, shadows, sound and the HUD.
- Grassland at 120 m is better but still mostly the photo.
- Snag share is 8% because variant slots are twelfths; 24 slots would cost a 120 MB atlas.
- No incised stream banks at 10 m terrain resolution; a few low spots inside the
  reservoir ring still show as land.
- Summer-noon ground near the camera is bright; that is exposure, not haze.
- Impostor bake at load is now 1.3 s with a 60 MB atlas.

## For you to decide

- Species sign-off: the lineup page (client/lineup.html) shows each species' classes,
  snags and photo targets; your eye on blue oak and gray pine would settle them.
- Licence (AGPL-3.0 vs MIT for code; CC BY-SA assets; CC0 spec) before the repo is
  shared more widely.
- Whether 8% snags is too many for the foothills you know.
- The opening screen's species cards promise five more playable species; the next game
  step (three-species acorn game, server, leaderboard) is on the roadmap.
