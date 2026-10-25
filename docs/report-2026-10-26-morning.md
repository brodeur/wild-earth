# Morning report, 2026-10-26

Second autonomous run, from "keep going as long as you can" through the night. Every lane
below was verified in the browser (or on the lineup pages) before its commit, and every
commit is on `main`. Credits: 230 of the 1,000 you authorized, balance about 2,820 at the
last job. The `.env` with the key is git-ignored and owner-only; no key material is in any
tracked file.

## What landed, in order

| Commit | Lane | What you will see |
|---|---|---|
| b1b9a0a | Streams by gravity | Channels follow the lidar DEM; NHD gives names and permanence. Median offset 11 m. |
| c57a06c | Geology and soils | Bedrock units, SSURGO soils, an outcrop likelihood raster per tile. |
| 4c59b29 | Ground detail | Thatch, litter, gravel, rock and pavement scans chosen per pixel inside 250 m. |
| 0447430, 66b8d43 | Trees | Pine needle bundles with per-needle shading and light through the needles; blue oak dense again; foliage per square metre of crown so big trees are as full as small ones. |
| b046aba | Grass near-field | Tufts come in from 9 m once you are a few metres up; shrub cards no longer cut around the bird. |
| a30519d, 652d76f, 6e38cff, 672c93a | Rocks | Outcrops and boulders placed from the geology, vegetation opening in strips along the strike, broken slate fins, jointed granite, clustered stones with talus halos, cobbles along streams and pond shores. |
| a622ee4 | Imagery erase | Only built pixels are erased in low-intensity cells; the smeared green savanna is gone (synthesized area 27% to 11%). |
| ff141a0 | Twig tier | Close trees grow twigs and hang their cards from them; winter blue oak is the clear win. |
| d69f508 | Grass continuity | One placement per cell; a tussock seen from 40 m is the same plant at your feet. |
| 727b358 .. ca67537 | Animals | Animal library, Meshy maintainer tool, 14 species briefs, bird and rodent rig templates, meshes adopted for deer (doe and buck), scrub-jay, quail, squirrel, red-tailed hawk, turkey vulture, Steller's jay, fox, coyote, rabbit, mountain lion, vole; an animal lineup page for sign-off. |

## Animals, where they stand

- **Drawn from meshes in the client:** deer doe, scrub-jay, quail, squirrel, red-tailed hawk,
  turkey vulture, Steller's jay (new species with a behaviour entry). Each has a build script
  in `tools/`, a library entry with source and licence, and a `?species=proc` switch.
- **Built, wiring in progress at the time of writing:** gray fox, coyote, brush rabbit, deer
  buck (procedural forked antlers switching by season), mountain lion, vole.
- **Raven:** two Meshy candidates chosen (a level glide for the player, a standing bird with
  every raven mark for the ground); the build and the switch in `raven.js` were in progress
  at the time of writing. The CC0 OpenGameArt raven stays as the fallback.
- **Acorn woodpecker:** five generated candidates, none adoptable (bill, feet, head); stays
  procedural. The clown face still wants painting from the brief.
- **Lineup page:** `client/lineup_animals.html`. It already caught the deer standing 23% too
  tall, fixed in 190d473.

## Decisions you may want to revisit

- Animal meshes are curated per species (CC0 downloads or Meshy output on your paid plan,
  released CC BY-SA); plants and ground stay procedural. Attribution on generated assets
  currently reads "generated with Meshy by agent (Claude) for Aaron Brodeur": say if you want
  the project or a handle named instead.
- Rocks come from the geology and soils rasters, never from slope and noise alone.
- The erase step now trusts the photo over LANDFIRE for low-intensity "developed" cells.

## Open, in priority order

1. Sunlit ponderosa at 20 to 60 m still partly reads as lobes; gray pine tufts are round
   clumps rather than hanging tassels.
2. Underwing patterns on the hawk and vulture are weak beyond close range (no translucency
   in the animal lighting).
3. Cameron Park Lake's erased fill is poor; parking aisles stay as pavement; the 12 m yard
   buffer still removes trees next to houses.
4. Jackrabbit needs a brief (far more records than brush rabbit); the bedded deer pose still
   looks sunk; buck antlers geometric close up.
5. Stream cobbles line both banks more than they form bars; schist reads pale.
6. Licence choice, species sign-off, WebGPU evaluation, multiplayer server: unchanged on the
   roadmap.

Lanes still running when this report was written are listed in `docs/roadmap.md` under
"Now"; their commits, if they verified, appear after d69f508 in `git log`.
