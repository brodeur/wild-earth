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

## Still running when this was written

- Forest composition from the LANDFIRE per-cell mix, and trees kept out of ponds and
  stream channels.
- Tree frame-cost tuning (target: recover 10% without losing the photo metrics).

## What I judged and left alone

- The close-tier crown interiors still read as sprays, not leaves; the likeness pass
  improved edges more than interiors.
- From altitude the animals are invisible without the HUD. That is true of real
  wildlife too, but it means the "alive" feeling at 100 m comes from birds in flight,
  shadows and sound rather than from ground animals.
- Grassland at 120 m is better but still mostly the photo. The terrain grain shows a
  faint grid from the air; terrain.js owns that.
- Rivers of order 5-6 are drawn too narrow; no incised banks at 10 m terrain.
- The far forest is pale in the haze beyond 3 km.

## Frame rate

Measured in a small, contended pane: about 38 fps at the start view and at a 20 m
low pass after the likeness pass, down from ~48-50 after shadows. Shadows cost 7% at
the start view and 14% low; likeness about 20%. The tuning agent's result will be
appended below.

## For you to decide

- The species files are agent drafts "needing local sign-off"; the lineup page
  (client/lineup.html) now shows photo targets per species. Your eye on blue oak and
  gray pine would settle them.
- Licence choice is still open (AGPL-3.0 vs MIT; CC BY-SA for assets; CC0 spec).
- Whether the turkey vulture's smell-based perception matters for gameplay.
