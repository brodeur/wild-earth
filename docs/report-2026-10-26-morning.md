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

## Later in the night (after the draft above)

| Commit | What you will see |
|---|---|
| 5054263 | Fox, coyote, brush rabbit, vole, mountain lion and buck live in the world with their own behaviours; bucks cast, grow velvet and harden antlers through the year; bedded deer lie on the ground (animals now stand on the drawn terrain). |
| 8534c49 | Clouds no longer repeat: cumulus with grey flat bases and lit tops in a 900 m layer, cirrus above, shadows that match. |
| cc1290f | Acorn game v2: woodpecker families, squirrels and ravens gather the same acorns as you; species leaderboard with 10-minute rounds; the woodpecker's painted clown face. |
| 9d87136, ded78fa | Playable western gray squirrel: bound, jump, climb trunks, pick, bury, dig; it wades and swims rather than running along creek beds. |
| 0026e62, 2e491c4 | Game polish: the oak card says who took the acorns; cards speak in the player's voice; three-quarter squirrel camera; HUD lays out without overlaps down to 900 px; closer woodpecker camera kept out of leaves. |
| 01d44dd | Playable acorn woodpecker: cling and hitch, undulating flight, pick from a crown, hammer acorns into the family granary. |
| 0f7c4d2 | Chaparral shrub cards show leaves, wands and stems within 26 m. |

| 22673a3 | Acorn game v3: a shared world per tile and season served by the dev server (WebSocket, first pickup wins, AI host election, snapshots and an append-only log); the node stores only a per-round hashed id and counts, never an id beside a position. The endpoint goes live when the dev server is restarted. |
| 02d228d | Chaparral shrub impostors sized to the species (chamise under 2.5 m, manzanita under 3.5 m), cover kept. |
| a6ddbaa, 84101bc, 3712f7f | Hydrology rewilding: 30 reservoirs and stock ponds on the home tile (54 ha) and 41 on Placerville returned to channels with a carved thalweg; creeks get a real depth with pools and riffles; the beds become meadow with a riparian corridor and the erase paints them; the HUD says "over the old bed of Patterson Lake". |
| 18ef9bc | Calls for the drawn animals: woodpecker rally and hammering, squirrel bark and chatter, Steller's jay scold and whistle, quail clucks and assembly, deer snort, fox bark, rabbit thump. |
| 6151294, 216e2fd | Far forest: horizon keeps its cover, backlit pines match, bake halved; per-tree dithered hand-over so the ring no longer swaps every 200 m; far trees cast shadows. |
| 07526b7 | WebGPU evaluation: stay on WebGL for the demo; GPU compute for placement is the one clear win; upgrade three.js first. |

| 3638fda, 9cb054d, 37d6c20 | Raven: the player flies the generated glide model (CC0 raven as fallback, `?raven=old`); a standing raven with every raven mark and a corrected texture; ambient ravens walk, hop, flick and cache on the ground, and the player can land (hover, then Z) and take off. |
| 9311921 | Arroyo willow, white alder and Fremont cottonwood in the tree library; riparian corridors use them. |

| 3aa8172 | Willows line the creek banks with alders behind; near and far placement agree. |
| a744aff | three.js 0.170 to 0.186.1 on WebGL, pixel-identical (r170's sky dome kept verbatim because the haze is tuned to it). |
| 9926a0c | A third tile, utm10n_680_4270 (the Cosumnes forks), built from scratch in 58 minutes; Overpass now waits and retries; rivers entering at a tile edge are seeded onto the valley floor (the home tile's Hangtown Creek inflows need a channels rebuild for this). |

| 1ea743c | Every manifest source carries the credit line a client must show (OSM, Macrostrat, GBIF required); the audit fails without it. |
| 7a54460 | GPU placement prototype: places exactly what grass.js places, 100x faster per frame, but only pays for 4-8x denser ground cover. |

Lanes still running at the time of this update: the player raven walking on the ground with a
softer landing swap; a pipeline-built species prior from CC0 and CC BY records only (the client
had been downloading CC BY-NC records, against the project's rule) with a data-credits panel;
and a black-tailed jackrabbit brief and mesh. Their commits, if they verified, follow 7a54460.

**Disk:** the machine dipped to a few hundred MB free several times tonight while lanes wrote
captures; the session scratchpad was trimmed twice and the disk ended the night at about 9 GB
free. The volume as a whole is close to full and is worth a look.

**To do once you are up:** decide the attribution form for generated assets. The dev server was
restarted at the end of the night (now on port 8781) and the shared-world endpoint is live: the
game panel shows "shared world · 1 player here". A three.js upgrade lane (0.170 to the current
release, WebGL) was still running; its commit, if it verified, is the last in `git log`.
