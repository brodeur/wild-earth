# Tile scorecards

Written by `python -m pipeline.scorecard --all` from each tile's `scorecard.json` (the build's `scorecard` step). Do not edit by hand.

Each cell is **measured / ruled / guessed / blank**, in percent of the layer's unit:

- **measured**: from data of this place at the layer's resolution
- **ruled**: a hand or named rule applied to a measured class, or a coarser measurement resampled by rule
- **guessed**: stand-ins, back-fills, records x niche, borrowed pools, generated traits, painted fills
- **blank**: nothing known, or nothing drawn

Worst finding: the tile's finding that affects the largest share of its layer, a ruled share counting half (a coarse measurement is less unknown than a guess) and a whole missing kind counting as half a layer (`rank_findings`).

| Tile | Terrain | Canopy | Communities | Plant species | Ground | Streams | Animals | Bodies | Worst finding |
|---|---|---|---|---|---|---|---|---|---|
| Hoh rain forest (`utm10n_429_5293`) | 54/46/0/0 | 56/44/0/0 | 0/100/0/0 | 0/100/0/0 | 44/0/56/0 | 57/27/0/16 | 100/0/0/0 | 73/0/25/2 | 56% of the ground texture is painted in, not photographed |
| Mount Olympus (`utm10n_439_5293`) | 0/100/0/0 | 0/100/0/0 | 0/97/3/0 | 0/100/0/0 | 100/0/0/0 | 56/33/0/10 | 100/0/0/0 | 74/0/24/2 | 100% of the ground has no 1 m measurement (drawn from the 3DEP seamless service (resolution not recorded)) |
| San Francisco (south) (`utm10n_540_4170`) | 74/26/0/0 | 100/0/0/0 | 0/44/56/0 | 0/100/0/0 | 85/0/15/0 | 0/95/0/4 | 100/0/0/0 | 39/0/37/25 | 56% of cells are a back-filled class (pre-settlement under developed or farmed land, by the baseline rule), not today's vegetation |
| San Francisco (north) (`utm10n_540_4180`) | 87/13/0/0 | 100/0/0/0 | 0/73/27/0 | 0/100/0/0 | 83/0/17/0 | 9/69/0/22 | 100/0/0/0 | 39/0/38/23 | no fish species listed (none in the tile's GBIF records) |
| Cosumnes (`utm10n_680_4270`) | 94/6/0/0 | 100/0/0/0 | 0/92/8/0 | 0/100/0/0 | 18/0/82/0 | 57/8/0/35 | 97/3/0/0 | 59/0/41/0 | 82% of the ground texture is painted in, not photographed |
| El Dorado (home) (`utm10n_680_4280`) | 82/18/0/0 | 100/0/0/0 | 0/64/36/0 | 0/100/0/0 | 13/0/87/0 | 61/16/0/23 | 99/1/0/0 | 55/0/44/1 | 87% of the ground texture is painted in, not photographed |
| Placerville (`utm10n_690_4280`) | 85/15/0/0 | 100/0/0/0 | 0/74/26/0 | 0/100/0/0 | 4/0/96/0 | 59/9/0/32 | 98/2/0/0 | 53/0/43/3 | 96% of the ground texture is painted in, not photographed |
| Calaveras Big Trees (`utm10n_731_4235`) | 89/11/0/0 | 100/0/0/0 | 0/85/15/0 | 0/100/0/0 | 3/0/97/0 | 39/1/0/60 | 99/1/0/0 | 56/0/40/4 | 97% of the ground texture is painted in, not photographed |
| Yosemite (re-centred) (`utm11n_267_4175`) | 98/2/0/0 | 0/100/0/0 | 0/98/2/0 | 0/100/0/0 | 98/0/2/0 | 51/43/0/6 | 100/0/0/0 | 47/0/47/6 | 100% of the tile has no measured crowns (placed by rule from LANDFIRE cover and height classes (30 m)) |
| Yosemite (`utm11n_270_4180`) | 99/1/0/0 | 0/100/0/0 | 0/99/1/0 | 0/100/0/0 | 99/0/1/0 | 55/41/0/4 | 99/1/0/0 | 48/0/48/3 | 100% of the tile has no measured crowns (placed by rule from LANDFIRE cover and height classes (30 m)) |
| Grand Canyon (`utm12n_396_3988`) | 83/17/0/0 | 0/100/0/0 | 0/57/43/0 | 0/91/2/7 | 97/0/3/0 | 57/39/0/4 | 95/0/5/0 | 38/0/47/15 | 100% of the tile has no measured crowns (placed by rule from LANDFIRE cover and height classes (30 m)) |
| Teton (`utm12n_514_4838`) | 99/1/0/0 | 0/100/0/0 | 0/99/1/0 | 0/96/3/1 | 99/0/1/0 | 37/53/0/10 | 100/0/0/0 | 51/0/37/12 | 100% of the tile has no measured crowns (placed by rule from LANDFIRE cover and height classes (30 m)) |
| Lamar Valley (`utm12n_557_4964`) | 100/0/0/0 | 100/0/0/0 | 0/95/3/1 | 0/99/1/0 | 52/0/48/0 | 47/43/0/10 | 100/0/0/0 | 52/0/39/10 | no fish species listed (none in the tile's GBIF records) |
| Corcovado (`utm17n_210_932`) | 0/100/0/0 | 0/100/0/0 | 0/0/100/0 | 0/100/0/0 | 0/53/47/0 | 6/92/0/2 | 100/0/0/0 | 8/0/51/41 | no ground species at all |
| Manu (`utm19s_233_8679`) | 0/100/0/0 | 0/100/0/0 | 0/0/100/0 | 0/100/0/0 | 0/8/92/0 | 14/84/0/2 | 93/0/7/0 | 3/0/69/28 | no ground species at all |
| Lofoten (`utm33n_412_7531`) | 0/100/0/0 | 0/100/0/0 | 0/0/100/0 | 0/100/0/0 | 0/99/1/0 | 6/81/0/13 | 100/0/0/0 | 9/0/57/35 | 99% of cells draw recorded species weighted by niche, not a community rule |
| Serengeti (`utm36s_698_9724`) | 0/100/0/0 | 0/100/0/0 | 0/0/100/0 | 0/100/0/0 | 0/100/0/0 | 27/67/0/6 | 100/0/0/0 | 24/0/30/45 | 100% of cells draw recorded species weighted by niche, not a community rule |
| Danum Valley (`utm50n_582_543`) | 0/100/0/0 | 0/100/0/0 | 0/0/100/0 | 0/100/0/0 | 0/13/87/0 | 10/90/0/0 | 93/0/7/0 | 0/0/67/33 | no ground species at all |

## Per layer: what each share means

**Terrain** (share of the tile's area; resolution: 1 m (the ground detail the client draws and the 1 m channels are routed on)).
- measured: ground from a 1 m bare-earth lidar DEM product (terrain.dem_1m coverage.share_1m) or from a lidar point cloud's ground returns where no product exists (terrain/lidar_stats.json ground_from_points.share), less the road corridors re-graded by rule
- ruled: a coarser measurement of this place resampled to the drawn grid (3DEP seamless 5-10 m, Copernicus 30 m), plus the road corridors whose cut and fill were removed by rule (unroad corridor_share)
- guessed: none on any tile today (no ground is invented)
- blank: no ground value (1 - terrain.dem stats.valid_fraction)

**Canopy** (share of the tile's area; resolution: one tree (crown position and height)).
- measured: covered by a lidar point cloud: crowns and heights found in the returns (manifest status.lidar_coverage.point_cloud)
- ruled: crowns placed by rule to match a canopy map: a satellite canopy-height model (Meta, ETH, 10 m) or LANDFIRE cover and height classes (30 m)
- guessed: none recorded
- blank: none recorded
- not scored: the understory under the canopy: only the top surface is kept on every tile (vegetation.canopy_height_10m band 3 is shrub cover where the top surface is 0.5-4 m)

**Communities** (share of the tile's 30 m cells (species_mix.json communities[].cells); resolution: 30 m cell).
- measured: a cell whose species composition is mapped (plot-based maps such as TreeMap): no tile uses one today
- ruled: a hand rule (pipeline/species_mix.py RULES) or a named_from_* rule (the species the community's name names) applied to a measured existing-vegetation class (source evt); open water and permanent ice (rules that draw no plants); a tile_pool_* community with no woody donor that draws only the grasses and forbs of its own description or the region's ground table (ground_only)
- guessed: the tile pool (tile_pool_*: another community's species of the same habitat class), research_* (the tile's recorded species weighted by records x niche), recorded_* (a community whose name names nothing: the shrubs recorded on its own cells, pipeline/associates.py), habitat_default_* (California's foothill default), and every cell whose class is a back-fill rather than today's vegetation (source bps: pre-settlement LANDFIRE BpS under human land; rewild: former reservoir beds; habitat: no class)
- blank: a tile_pool_* community with no donor and no ground plants: drawn bare, nothing known

**Plant species** (share of the tile's drawn woody plant weight (trees and shrubs): each community's cells x its tree or shrub density x a species' share of the weights its rule wrote (species_mix.json communities[]); resolution: the species drawn in each 30 m cell).
- measured: a species share taken from a per-cell composition measurement: none on any tile today
- ruled: drawn as the species the community's rule asked for (it has a library record of its own)
- guessed: drawn as a stand-in for the species the rule asked for: the mix's `stand_ins` key when the build records it, else `substitutions` (named species -> record drawn); research_* rows whose note names functional stand-ins of the climate group; and a community layer whose every species is missing, drawn from the tile's other communities of its habitat class (communities[].generic, generic_drawn)
- blank: asked for but drawn as nothing: the mix's `missing` key when recorded, else a substitution to null (unless the community's layer is drawn generic: then guessed)
- baseline status: detail.status: introduced, restored and status_unknown counts over the drawn species (trees, shrubs, ground), from a per-species `status` on species/plant_needs.json needs[] or a species_status map in the mix; 'no status field in this build' until one exists

**Ground** (share of the tile's area; resolution: 2.5 m (client/texture_ground.jpg)).
- measured: the air photo kept where its native resolution is 2.5 m or finer (NAIP 0.6 m)
- ruled: the photo kept where it is coarser than the texture (Sentinel-2 10 m, resampled)
- guessed: ground painted in where the photo was replaced: under the 3D crowns, erased roads and buildings (client.texture_ground filled_fraction; on a tile without it, client.texture_imagery mask_fraction)
- blank: none recorded

**Streams** (share of stream length (km): the drawn channels plus the mapped flowlines left undrawn; resolution: the 1 m thalweg (channel position)).
- measured: a drawn channel a mapped flowline confirms (NHDPlus HR in the US, OSM abroad): nhd_matched, or a mapped reach kept where the DEM found none (source nhd)
- ruled: a channel placed by the flow-accumulation threshold on the DEM with no mapped line to confirm it
- guessed: none recorded
- blank: mapped flowline length no drawn channel covers (hydro.channels stats nhd_length_km - nhd_covered_length_km - nhd_kept_length_km; includes the tips dropped by rule)
- not scored: stream width, depth and discharge: width is the drainage-area rule (params.width) on every reach of every tile, so it is reported, not scored; lakes and ponds are not scored

**Animals** (share of the listed species (species/animals.json animals[]); resolution: the tile (10 km): is the species here).
- measured: listed with GBIF records on the tile and traits from a published table or a curated card
- ruled: listed by a range or life-zone rule without records on the tile
- guessed: listed with generated traits (generated_traits)
- blank: none by species; kinds with no species at all (fish, ...) are findings instead
- baseline status: detail.status: introduced, restored and status_unknown counts from a per-species `status` field (native | introduced | restored) on animals[]; 'no status field in this build' until one exists

**Bodies** (share of the listed species (client/fauna.json); resolution: one animal).
- measured: drawn with a body of its own: a curated client species (fauna.json allow) or a slot with its own model file
- ruled: none (no rule makes a body from a measurement)
- guessed: drawn with a kin's body, scaled and tinted (fauna.json slots[].kin, no model of its own)
- blank: listed but not drawn (fauna.json skipped[], or absent from allow and slots)

## The rewilding baseline

The baseline decided 2026-11-10: today's ecosystems; introduced species filtered out; natives people removed restored and marked; pre-settlement vegetation only where today's land is developed, farmed or ruderal. Introduced / restored / status unknown are counts of species; pre-settlement is a share of cells.

| Tile | Pre-settlement cells | Animals: introduced / restored / unknown | Plants: introduced / restored / unknown |
|---|---|---|---|
| Hoh rain forest | 0% | no status field in this build (64 unknown) | no status field in this build (46 unknown) |
| Mount Olympus | 0% | no status field in this build (62 unknown) | no status field in this build (46 unknown) |
| San Francisco (south) | 56% | no status field in this build (122 unknown) | no status field in this build (87 unknown) |
| San Francisco (north) | 27% | no status field in this build (120 unknown) | no status field in this build (85 unknown) |
| Cosumnes | 8% | no status field in this build (76 unknown) | no status field in this build (89 unknown) |
| El Dorado (home) | 36% | no status field in this build (87 unknown) | no status field in this build (90 unknown) |
| Placerville | 26% | no status field in this build (90 unknown) | no status field in this build (92 unknown) |
| Calaveras Big Trees | 15% | no status field in this build (80 unknown) | no status field in this build (93 unknown) |
| Yosemite (re-centred) | 2% | no status field in this build (100 unknown) | no status field in this build (93 unknown) |
| Yosemite | 1% | no status field in this build (95 unknown) | no status field in this build (93 unknown) |
| Grand Canyon | 4% | no status field in this build (94 unknown) | no status field in this build (50 unknown) |
| Teton | 1% | no status field in this build (89 unknown) | no status field in this build (55 unknown) |
| Lamar Valley | 1% | no status field in this build (83 unknown) | no status field in this build (46 unknown) |
| Corcovado | 0% | no status field in this build (88 unknown) | no status field in this build (11 unknown) |
| Manu | 0% | no status field in this build (68 unknown) | no status field in this build (10 unknown) |
| Lofoten | 0% | no status field in this build (69 unknown) | no status field in this build (5 unknown) |
| Serengeti | 0% | no status field in this build (86 unknown) | no status field in this build (5 unknown) |
| Danum Valley | 0% | no status field in this build (69 unknown) | no status field in this build (4 unknown) |

## The same on every tile

Kept out of the per-tile findings because no tile differs:

- plant composition is never measured: no tile reads a per-cell species map (plant communities and species: measured 0 everywhere)
- stream width comes from drainage area (1.6 x A^0.45) on every reach; no discharge, depth or seasonal flow from data
- the understory under the canopy is not measured on any tile; only the top surface is kept
- no species has a native status yet, so introduced and restored species cannot be counted (the baseline decided 2026-11-10 filters introduced species out and restores removed natives; the animals and plant species layers report the counts once a `status` field exists)

## Worst findings per tile

**Hoh rain forest** (`utm10n_429_5293`)
- 56% of the ground texture is painted in, not photographed
- no fish species listed (none in the tile's GBIF records)
- 16 of 64 listed animals wear a kin's body
- 45% of the ground has no 1 m measurement (drawn from the 3DEP seamless service (resolution not recorded))
- 44% of the tile has no measured crowns (placed by rule from LANDFIRE cover and height classes (30 m))
- 16% of mapped stream length is not drawn

**Mount Olympus** (`utm10n_439_5293`)
- 100% of the ground has no 1 m measurement (drawn from the 3DEP seamless service (resolution not recorded))
- 100% of the tile has no measured crowns (placed by rule from LANDFIRE cover and height classes (30 m))
- no fish species listed (none in the tile's GBIF records)
- 15 of 62 listed animals wear a kin's body
- 33% of stream length is placed by the DEM alone, no mapped stream confirms it
- 10% of mapped stream length is not drawn

**San Francisco (south)** (`utm10n_540_4170`)
- 56% of cells are a back-filled class (pre-settlement under developed or farmed land, by the baseline rule), not today's vegetation
- no fish species listed (none in the tile's GBIF records)
- 95% of stream length is placed by the DEM alone, no mapped stream confirms it
- 45 of 122 listed animals wear a kin's body
- 30 of 122 listed animals are not drawn

**San Francisco (north)** (`utm10n_540_4180`)
- no fish species listed (none in the tile's GBIF records)
- 45 of 120 listed animals wear a kin's body
- 69% of stream length is placed by the DEM alone, no mapped stream confirms it
- 27% of cells are a back-filled class (pre-settlement under developed or farmed land, by the baseline rule), not today's vegetation
- 28 of 120 listed animals are not drawn
- 22% of mapped stream length is not drawn

**Cosumnes** (`utm10n_680_4270`)
- 82% of the ground texture is painted in, not photographed
- no fish species listed (none in the tile's GBIF records)
- no invertebrate species listed (2 in the records, none listed)
- 31 of 76 listed animals wear a kin's body
- 35% of mapped stream length is not drawn
- 8% of cells are a back-filled class (pre-settlement under developed or farmed land, by the baseline rule), not today's vegetation

**El Dorado (home)** (`utm10n_680_4280`)
- 87% of the ground texture is painted in, not photographed
- no fish species listed (none in the tile's GBIF records)
- no invertebrate species listed (3 in the records, none listed)
- 38 of 87 listed animals wear a kin's body
- 36% of cells are a back-filled class (pre-settlement under developed or farmed land, by the baseline rule), not today's vegetation
- 23% of mapped stream length is not drawn

**Placerville** (`utm10n_690_4280`)
- 96% of the ground texture is painted in, not photographed
- no fish species listed (none in the tile's GBIF records)
- 39 of 90 listed animals wear a kin's body
- 32% of mapped stream length is not drawn
- 26% of cells are a back-filled class (pre-settlement under developed or farmed land, by the baseline rule), not today's vegetation
- 3 of 90 listed animals are not drawn

**Calaveras Big Trees** (`utm10n_731_4235`)
- 97% of the ground texture is painted in, not photographed
- 60% of mapped stream length is not drawn
- no fish species listed (none in the tile's GBIF records)
- 32 of 80 listed animals wear a kin's body
- 15% of cells are a back-filled class (pre-settlement under developed or farmed land, by the baseline rule), not today's vegetation
- 3 of 80 listed animals are not drawn

**Yosemite (re-centred)** (`utm11n_267_4175`)
- 100% of the tile has no measured crowns (placed by rule from LANDFIRE cover and height classes (30 m))
- no fish species listed (none in the tile's GBIF records)
- 47 of 100 listed animals wear a kin's body
- 43% of stream length is placed by the DEM alone, no mapped stream confirms it
- 6% of mapped stream length is not drawn
- 6 of 100 listed animals are not drawn

**Yosemite** (`utm11n_270_4180`)
- 100% of the tile has no measured crowns (placed by rule from LANDFIRE cover and height classes (30 m))
- no fish species listed (none in the tile's GBIF records)
- no invertebrate species listed (6 in the records, none listed)
- 46 of 95 listed animals wear a kin's body
- 41% of stream length is placed by the DEM alone, no mapped stream confirms it
- 3 of 95 listed animals are not drawn

**Grand Canyon** (`utm12n_396_3988`)
- 100% of the tile has no measured crowns (placed by rule from LANDFIRE cover and height classes (30 m))
- no fish species listed (none in the tile's GBIF records)
- 44 of 94 listed animals wear a kin's body
- 39% of stream length is placed by the DEM alone, no mapped stream confirms it
- 14 of 94 listed animals are not drawn
- 14% of the shrub weight is a named species with no record, drawn as nothing

**Teton** (`utm12n_514_4838`)
- 100% of the tile has no measured crowns (placed by rule from LANDFIRE cover and height classes (30 m))
- no fish species listed (none in the tile's GBIF records)
- no invertebrate species listed (2 in the records, none listed)
- 33 of 89 listed animals wear a kin's body
- 53% of stream length is placed by the DEM alone, no mapped stream confirms it
- 11 of 89 listed animals are not drawn

**Lamar Valley** (`utm12n_557_4964`)
- no fish species listed (none in the tile's GBIF records)
- no invertebrate species listed (1 in the records, none listed)
- 48% of the ground texture is painted in, not photographed
- 32 of 83 listed animals wear a kin's body
- 43% of stream length is placed by the DEM alone, no mapped stream confirms it
- 10% of mapped stream length is not drawn

**Corcovado** (`utm17n_210_932`)
- no ground species at all
- no shrub species at all
- 100% of cells draw recorded species weighted by niche, not a community rule
- 45 of 88 listed animals wear a kin's body
- 100% of the ground has no 1 m measurement (drawn from the 30 m copernicus_dem_glo30), a surface model with the forest canopy in it
- 100% of the tile has no measured crowns (placed by rule from satellite canopy height (eth_canopy_height, meta_canopy_height, meta_canopy_height_v2))

**Manu** (`utm19s_233_8679`)
- no ground species at all
- no shrub species at all
- 100% of cells draw recorded species weighted by niche, not a community rule
- 92% of the ground texture is painted in, not photographed
- 47 of 68 listed animals wear a kin's body
- 100% of the ground has no 1 m measurement (drawn from the 30 m copernicus_dem_glo30), a surface model with the forest canopy in it

**Lofoten** (`utm33n_412_7531`)
- 99% of cells draw recorded species weighted by niche, not a community rule
- 39 of 69 listed animals wear a kin's body
- 100% of the ground has no 1 m measurement (drawn from the 30 m copernicus_dem_glo30), a surface model with the forest canopy in it
- 100% of the tile has no measured crowns (placed by rule from satellite canopy height (eth_canopy_height, meta_canopy_height, meta_canopy_height_v2))
- one shrub species only (juniperus_communis)
- no reptile species listed (none in the tile's GBIF records)

**Serengeti** (`utm36s_698_9724`)
- 100% of cells draw recorded species weighted by niche, not a community rule
- 100% of the ground has no 1 m measurement (drawn from the 30 m copernicus_dem_glo30), a surface model with the forest canopy in it
- 100% of the tile has no measured crowns (placed by rule from satellite canopy height (eth_canopy_height, meta_canopy_height, meta_canopy_height_v2))
- one ground species only (themeda_triandra)
- one shrub species only (vachellia_drepanolobium)
- no fish species listed (none in the tile's GBIF records)

**Danum Valley** (`utm50n_582_543`)
- no ground species at all
- no shrub species at all
- 100% of cells draw recorded species weighted by niche, not a community rule
- 87% of the ground texture is painted in, not photographed
- 46 of 69 listed animals wear a kin's body
- 100% of the ground has no 1 m measurement (drawn from the 30 m copernicus_dem_glo30), a surface model with the forest canopy in it

## Plant species counts

| Tile | Canopy | Shrub | Ground | Stand-ins recorded | Missing recorded |
|---|---|---|---|---|---|
| Hoh rain forest | 15 | 13 | 20 | 0 | 0 |
| Mount Olympus | 15 | 13 | 20 | 0 | 1 |
| San Francisco (south) | 24 | 29 | 35 | 0 | 0 |
| San Francisco (north) | 22 | 29 | 35 | 0 | 0 |
| Cosumnes | 25 | 30 | 35 | 0 | 0 |
| El Dorado (home) | 25 | 31 | 35 | 0 | 0 |
| Placerville | 27 | 31 | 35 | 0 | 0 |
| Calaveras Big Trees | 30 | 31 | 34 | 0 | 0 |
| Yosemite (re-centred) | 31 | 31 | 34 | 0 | 0 |
| Yosemite | 31 | 31 | 34 | 0 | 0 |
| Grand Canyon | 9 | 22 | 21 | 11 | 10 |
| Teton | 9 | 13 | 34 | 3 | 3 |
| Lamar Valley | 7 | 8 | 32 | 2 | 1 |
| Corcovado | 11 | 0 | 0 | 0 | 0 |
| Manu | 10 | 0 | 0 | 0 | 0 |
| Lofoten | 2 | 1 | 2 | 0 | 0 |
| Serengeti | 3 | 1 | 1 | 0 | 0 |
| Danum Valley | 4 | 0 | 0 | 0 | 0 |

## What a layer could not be scored on

- terrain: source_resolution_m 1.0 is recorded for the 3DEP seamless service whatever it serves (pipeline/fetch_dem.py _from_usgs writes a constant); the native resolution of the ground outside the 1 m products is not recorded (2 tiles)
- canopy_structure: the understory under the canopy: only the top surface is kept on every tile (vegetation.canopy_height_10m band 3 is shrub cover where the top surface is 0.5-4 m) (every tile)
- water: stream width, depth and discharge: width is the drainage-area rule (params.width) on every reach of every tile, so it is reported, not scored; lakes and ponds are not scored (every tile)
- sea: no layer: the coast has no sea floor, tides or surf on any tile
- weather_and_seasons: one ERA5 series per tile (client/weather.json); no per-cell share to score
- sound: synthesised in the client; the build writes no sound document
