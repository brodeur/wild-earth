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

| 280a976 | The animal density prior is built by the pipeline from CC0 and CC BY records only (the client had been downloading CC BY-NC records); a "Data" pill in the HUD opens a credits panel with the required attribution lines. |
| 306fcef | Black-tailed jackrabbit brief and mesh (from the CC0 rabbit, reshaped into a hare). |
| a32f8c7 | The player raven walks, hops and takes off from the ground; the model swaps at landing and take-off are hidden. |
| 7bc2d9a | Channels rebuilt on the home and Placerville tiles with the edge-seed fix: Hangtown Creek's inflow now runs through the tile. |

| cae9b66 | The jackrabbit lives in the world (freeze at 30 m, zigzag bolt at 14 m/s); the brush rabbit's ears are symmetric; all three tiles' species lists carry it. |

| c5e5c60 | The riparian corridors' ground gets its own seasonal colour: olive-brown in fall, grey-brown in winter, green in spring. |
| d0ff616 | Light through the wings of flying birds seen from below: the hawk's pale lining and the vulture's silver flight feathers read. |
| 7282445 | Acorn game v4: squirrels, ravens and jays pilfer caches and raid granaries; woodpecker families mob raiders; two new shared-world events. |

Credits: 230 of the 1,000 spent across the night (balance 2,822). The dev server was restarted
again at the end so it accepts the v4 events. The run is complete: every lane has reported and
every verified result is on `main`.

**Next, pending your call:** real seasonal ground colour from Sentinel-2 composites and a
ground-only base texture with tree crowns inpainted, so the foothills go golden in fall and the
green-up comes in December.

**Disk:** the machine dipped to a few hundred MB free several times tonight while lanes wrote
captures; the session scratchpad was trimmed twice and the disk ended the night at about 9 GB
free. The volume as a whole is close to full and is worth a look.

**To do once you are up:** decide the attribution form for generated assets. The dev server was
restarted at the end of the night (now on port 8781) and the shared-world endpoint is live: the
game panel shows "shared world · 1 player here". A three.js upgrade lane (0.170 to the current
release, WebGL) was still running; its commit, if it verified, is the last in `git log`.

## The evening of 2026-10-26 (your asks of the day)

| Commit | What |
|---|---|
| cadef80 | The tree library holds any number of species; seventeen foothill drafts (valley, canyon live and black oak, buckeye, madrone, bay, walnut, maple, ash, incense cedar, Douglas-fir, toyon, redbud, poison oak, coyote brush, elderberry, coffeeberry); new leaf and bark forms. |
| bd79cc6 | The raven lands by contact on the ground or any limb that holds it (under 7 m/s, else it bounces with a flare) and hops on foot; the 2 m flight floor is gone. |
| c16f4a6 | Pipeline `lidar` step: the 1 m DEM and the 2.1-billion-point cloud for the home tile (USGS 3DEP, public domain), a canopy height model and 395k real tree crowns; 26 min to run. |
| a4cb0f4 | The seventeen species placed on all three tiles, following the ground within each community; the shrub flicker you saw is fixed (their shadows swayed like grass). |
| d26eb1b | Squirrels climb whole trees, run the limbs and leap between them; AI squirrels flee into the canopy and freeze on the far side of the trunk. |
| e3904db | The lidar's 1 m ground under the player as a 2 m mesh within 110 m, the 10 m grid beyond; the Hwy 50 cut is real geometry; a 2.5 m registration error in the height sampler fixed. |

| f6388e3 | Every tree on the home tile stands on a real lidar crown, sized to it; the biggest 5% of each species by crown (or over an absolute height: blue oak 15 m, ponderosa 40 m) are the old-growth trees, with the 20 largest per species carrying landmark ids; the savanna oaks line up with the photo; rare species share mesh sets between age classes, so the start view's draw calls fall from 412 to 295. |

| 4e2ef5d | Beyond the fine square the 10 m mesh passes through the 1 m ground, and grass, shrubs, rocks and still animals follow the drawn surface. |
| 775510b | The Placerville tile has its lidar too: 1 m ground, canopy height, 477k crowns (median 17.8 m; a taller forest than the home tile's), an hour to run. |
| 0f235d5 | The squirrel's camera dissolves the leaves in front of it in a crown and follows a leap. |
| e010634 | Trees are drawn on the surface drawn under them (draped in the vertex shader; perches and climbs unaffected); rare species get their old tree up close. |
| a97cb40 | Species polish: acorn cards for the three new oaks, buckeye candles and elderberry plates visible, lower crown bases, spec fields. |
| 8a828ae | The Cosumnes tile has its lidar too: 398k crowns; all three tiles now carry the 1 m ground, canopy height and real crowns. |
| 5456b86 | Pipeline: Sentinel-2 monthly ground colour (about 400 scenes per tile from 2019 on; open grass gold June to October, green from December) and a ground-only base texture with every lidar crown and its shadow inpainted (73-88% of each tile). |
| ad48513 | Client: the ground shows its measured colour for the date on the photo without its trees; January green, April greenest, late October gold-beige; forest floor as litter under dense canopy; grass blades match. |
| 0816e6d | Wild turkey, California ground squirrel and western fence lizard meshes (130 credits; 360 of the 1,000 spent). |
| a95fb59 | The three wired into the world on all tiles: turkey flocks of 6-15 that flush onto real limbs, ground squirrel colonies with a sentinel that dive into their burrows, fence lizards basking and doing push-ups on rocks and bark from March to October, on a new reptile rig; GBIF records all three on every tile. |
| 145d46f | Sounds for the three, all synthesised: turkey putts, purr, spring dawn gobble and heavy flush; the ground squirrel's whistle alarm and scuffle; the lizard's scuttle. |
| 3ce87d4 | Two San Francisco cells (Twin Peaks to Ocean Beach; the Richmond, Presidio and Golden Gate) built from scratch in 31 and 93 min as a stress test; the JSON writer refuses NaN (a sea-side lidar check had written one and the tile would not load). What they show: no sea (the seabed is drawn as terrain under the photo of the waves, streams routed across it), the street grid baked into the rewilded hills with the street trees in rows along it, the Golden Gate Bridge as a line of 64 m crowns, foothill species in the Presidio; the hills, cliffs, beaches and headlands read from the air. |
| 5ccda93 | `?fov=45` (and `__we.setFov`) tries a narrower lens than the 70 degree default so you can judge the silhouettes by eye; the woodpecker's flight lens never widens past the raven's. |
| 6497fcf | The whole-tile rewild you chose: a dense-urban rule (pipeline/urban.py) erases a city's blocks whole with the streets, synthesises them from the pre-settlement class and drops street trees and bridge crowns; both SF cells rebuilt (the Richmond is a scrub plain with no grid, the strait has no tree line). A real ordering bug found on the way: the lidar step ran before osm, so a fresh tile's crowns never dropped on buildings; a `crowns` step after derive now re-runs the finder. |
| 2844ddb | The opening screen you asked for: no title or headings, one 9:16 map card per tile titled by its roads, a day-of-year season slider on the footer, the tile loading under a spinner on its card that becomes Begin when ready. |
| 3af7489 | The spirit: arrive as a wisp of three ribbons and mist in a faint blue-green world, touch a glowing raven, squirrel or woodpecker to become it, B to leave; the camera blends across every jump. |
| 4ce0ac1 | Spirit follow-ups you picked: dusk keeps a floor and a violet horizon, a spirit-only pass cools the khaki leaves while the animals stay warm, and the wind is a lighter hiss that stops rising past 30 m/s. (19b0e11, between: the opening screen's slider across the top, no caption, no find row.) |
| 19b0e11, 77f3325 | The opening screen as you shaped it through the evening: slider across the top, no caption or find row, localities top-left, nothing selected on load, the wisp as the spinner, animals popping in at the deer's scale, season-coloured Begin in DM Sans. |
| de9d052 | In spirit form the sky is the mist's colour: no horizon line. |
| 96bc26d, 2124677 | Pipeline: every tile carries last year's hourly weather in local time (Open-Meteo) and the server answers today's; OSM place names in each tile's features (El Dorado, Placerville, Nashville, Daly City, Richmond District). |
| 9cee468 | Every day has weather: cloud, mist, wind, rain, snow and thunder from the measured day, today's live, a random hour between pre-dawn and post-dusk on a chosen day; a weather row on the HUD. |
| 2942b18 | The start screen's spinner is the spirit circling and chasing its tail, pre-rendered and played by CSS, and the animals are rendered stills popping in with a glimmer; hover steps the other cards back. |
| 8d1bcca | Every species is playable: a ground control for everything that walks and a flier control for the hawk, vulture and jays, entered by touching them; the wisp's ribbons trail the path flown. |
| d4db600, 2d98777, 894c542 | The screen's lineup centred and the cards receding with a constant gutter; the dark start with only the circling wisp until the world is ready; Escape leaves a body. |
| 676f39a | The world build yields: the main thread is blocked about 1.2 s over the build instead of 11.5, the worst input delay 290 ms instead of 5.4 s, the world byte-identical; your 30-40 s hover wait was this, not the animals. |
| 7562d52 | The start screen as you described it: it loads only its own assets, hover grows a card, a click builds that tile behind the screen with the wisp and the lineup, another click aborts and switches in place, no reload, no URL. |
| 9bffb32 | The in-game Location box goes to another tile the same way: the world is torn down, the next built in its place and entered at the point with the day carried, another Go mid-build abandons it, no reload, no URL. Found on the way: a played world was never freed (the arrival's caption animation held it); fixed, three switches and a drop leave 89 MB. |
| 5f4fe06 | The start screen's animals stand below and in front of the chosen card: feet just under its bottom edge, the deer, lion and coyote over its lower edge. |
| bea9aa3 | The band under the cards shrinks to the animals' feet and the cards grow into it: 676 to 747 px tall at a 924 px window, the feet 24 px above the bottom. |
| f6239ca | Merged the heap lane: a built world lets go of the CPU copies of what lives on the GPU (static geometry arrays, texture bytes, the far bake, the terrain index copy; the fine mesh remakes the chunk normals bit for bit). 139 MB fewer bytes per world, same draws and picks; verified here: build, a Location box switch, a drop to 90 MB. |
| 9092c65 | Every creature's soul in spirit form is coloured by its species' rarity on the tile, purple for the abundant to red for the rare, brighter the rarer, with a wider faint bubble. |
| 103c3e4 | The HUD, key line and panel sit behind a hamburger top left that becomes an X; in spirit form a nearby-animals bar at the bottom: stills on disc shadows with white count pills, ordered by rarity. |
| 8f998a0 | The bar lost its box, the map moved to the top right with the panel under it, rare souls reach across the whole live population and grow with rarity, and mountain lions carry a test beacon: a 90 m beam of light seen through the hills. |
| ef24ad6 | The bar's discs glow in each species' soul colour, purple to red along the row, instead of a black shadow. |
| 2f9474e | The tree and plant labels show only while the menu is open; the animals' tags are unchanged. |
| 30105b8 | The ground animals' camera sits 1.3 times higher and pitches so the body's centre lands 27% up from the bottom of the screen, whatever its size; deer and vole checked. |

Open from the day: the attribution form for generated assets; far placement on the lidar ground beyond the fine square; the squirrel's
crown camera in leafy oaks.
