# Pipeline review, 2026-11-10

Aaron asked for a review of the world pipeline from basic assumptions: how good it really is, how comprehensive, whether
we fetch the right datasets, whether this is the right way to make a copy of the real world, and what fidelity we are
missing. This is a read-only review. I read every pipeline module, searched the code for each dataset to separate what
is implemented from what the design docs only name, and read all 18 built tiles' manifests, species mixes, animal lists
and judge numbers. A subagent checked the licence and access of each candidate dataset on the web (section 5).

## 1. Verdict

**From the air the pipeline is good, and on tiles with US lidar it is very good. At an animal's eye level, and in what
lives in a place, most of the world is inferred, and outside California a good share of it is wrong in ways that
nothing in the pipeline catches.**

- **Shape is measured.** Terrain, drainage, canopy height and individual crowns come from 1 m lidar where it exists.
  This is the strongest part and it is as good as open data allows.
- **Life is inferred.** Which plants grow where comes from the *name* of a mapped vegetation community plus rules
  written by hand for California. Which animals live there comes from where people logged sightings.
- **The check is narrow.** The only automated judge compares colour from straight above against the same family of
  imagery that the ground texture is made from. It cannot see a wrong species, a missing understory or an empty river.
- **The method is right.** Measured layers, then rules, then procedural detail, then a judge is the only approach that
  can cover wild land, remove people, stay openly licensed and run in a browser. Four assumptions inside it need to
  change (section 4).

## 2. What is strong

- **Terrain and water routing.** 1 m DEM, channels on the 1 m thalweg, seams matched between tiles, roads and dams
  removed and the water re-routed. I found nothing to change in the approach.
- **Canopy structure on lidar tiles.** Real crown positions and heights, a canopy height model, ground roughness.
- **Rewilding of structures.** Roads, buildings and reservoirs are erased from terrain, texture and hydrology by rule.
- **Engineering.** A fingerprinted step graph, a cost ledger, a licence audit and a species registry with fidelity
  levels. A tile anywhere on land builds from one command. Few projects of this kind have this.
- **Breadth.** Base, flora, fauna and games all run on all 18 tiles, including five outside the US.

## 3. How good it is, layer by layer

Measured from the built tiles on main, 2026-11-10.

| Layer | Where it comes from | State |
|---|---|---|
| Terrain | 3DEP 1 m (12 US tiles), 10 m (Olympus), Copernicus 30 m (5 global tiles) | Strong in the US. At 30 m the global tiles have no gullies, banks or boulders, and the surface still includes some forest canopy |
| Streams | NHDPlus HR + 1 m routing; OSM abroad | Position strong. Width is `1.6 x area^0.45`, the same in a rain forest and a desert. No discharge, depth or seasonal flow from data |
| Canopy structure | Lidar point cloud on 8 tiles; 1 m DEM only on 4; satellite canopy height (Meta, ETH) on 6 | Strong on the 8. The other 10 have no measured crowns |
| Understory | Canopy height 0.5-4 m, top surface only | Shrubs under trees are not measured anywhere, though the lidar returns hold them |
| Tree species | Community name -> rule | California good. Elsewhere, see below |
| Ground plants | Trait cards, USDA ecological sites at Lamar | Zero ground species on Grand Canyon, Corcovado and Danum; one on Serengeti; two on Lofoten |
| Ground colour | NAIP 0.6 m RGB (US), Sentinel-2 10 m (global) | Right from the air. It is a photo with shadows, not a material, and holds no detail under 0.6 m |
| Animals: who | GBIF records; elevation life zones for curated California species | No fish on any tile. Introduced species listed. No extirpated species |
| Animals: bodies | Meshy models, stand-ins | 469 of 678 species in the registry are at level 0. 288 of 323 birds and 142 of 173 mammals have no model of their own |
| Weather, seasons | ERA5 at the tile centre; Sentinel-2 monthly | One series per 10 km tile. Snow line is not from data |
| Sound | Synthesised in the client | No recordings. Birds are drawn from the habitat class, not the tile's list |
| Sea | None | No bathymetry, tides or surf on the coastal tiles |

### What the species mixes show

Share of each tile's 30 m cells by how the plant community was decided:

| Tile | Hand rule | Species taken from the community's name | Nothing known | Records x niche |
|---|---|---|---|---|
| Eight California tiles | 99-100% | 0 | 0-1% | 0 |
| Hoh | 99% | 1% | 0 | 0 |
| Lamar | 36% | 61% | 3% | 0 |
| Teton | 50% | 41% | 8% | 0 |
| Grand Canyon | 27% | 31% | 42% | 0 |
| Corcovado, Manu, Lofoten, Serengeti, Danum | 0 | 0 | 0 | about 100% |

So the pipeline is tuned for one region. The results elsewhere:

- **Grand Canyon** draws gray pine on 16% of its canopy and Sierra juniper on another 16%. Its shrubs are 26%
  manzanita, 25% chamise and 13% buckbrush. These are California species that do not grow in Arizona. The community is
  "Colorado Plateau Pinyon-Juniper Woodland"; the name lexicon maps "pinyon" to singleleaf pinyon, that has no library
  record, and the stand-in rule gives it gray pine. The real trees are Utah juniper and Colorado pinyon. The 38% of
  the tile that is bedrock canyon gets nothing, and the blackbrush and creosote scrub (25%) gets the tile's generic
  shrubs. There are no ground plants at all.
- **Lofoten** is 75% rowan and 25% downy birch. From general knowledge the real forest is the reverse, mostly birch.
  The records-times-niche rule follows what people photograph.
- **Serengeti** is 18% sausage tree, a scattered riverside tree, and has one grass.
- **Danum** has four tree species, no shrubs and no ground plants, in one of the most diverse forests on Earth.
- **Lamar** draws its 13% of spruce-fir forest as Douglas-fir and lodgepole, for want of spruce and fir records.

None of these is flagged by the build, and the judge cannot see them. I have not checked these against field plots;
the Arizona case is certain, the others are my reading.

### What the judge shows

| Probe | Overlap with imagery (1 = same colours) |
|---|---|
| Lofoten | 0.66 |
| Serengeti | 0.62 |
| Teton | 0.49 |
| Yosemite, El Dorado | 0.47, 0.45 |
| Lamar | 0.36 |
| Grand Canyon | 0.26 |
| Manu | 0.15 |
| Corcovado | 0.11 |
| Danum | 0.05 |

Open country scores well. Closed tropical forest fails even this one check: the three rain forest tiles barely share
a colour with their own imagery.

## 4. The basic assumptions

### 4.1 "A community's name tells us its plants"

This is the weakest assumption and the easiest to replace in the US, where composition is mapped directly: tree
species per 30 m cell from forest inventory plots, and shrub, grass, litter and bare-ground fractions for rangeland
(section 5). The name-keyed rules should become the fallback, not the source. Abroad there is no such map, so the
rule stays, but it should be weighted by plot data where plots exist, and it should never borrow a species from
another continent's list.

### 4.2 "Sighting records tell us who lives here"

GBIF is a map of where observers go. It over-counts the conspicuous and under-counts the nocturnal, small and
aquatic, and it has two blind spots that matter for this project:

- **Introduced species are listed.** European starling on every US tile, Eurasian collared dove on most, bullfrog on
  the California tiles, mountain goat at Lamar and Teton. The species step has no native or introduced field.
- **Extirpated species are absent.** The El Dorado tiles have no grizzly and no salmon. Fish are not fetched at all,
  so the Hoh has no salmon either.

### 4.3 "The imagery is the ground"

No open dataset resolves the ground below about half a metre, and an animal's eye is 0.2 to 1.5 m up. The air photo
is used as the ground's colour, which is correct from above and bakes in shadows, one season and one moment of
drought or green-up. The fix in principle: treat imagery as a *measurement* that sets parameters (cover fractions,
litter, soil colour, greenness by month) and synthesise the surface from those. Half of this exists already (soil
colours from the soil survey, calibrated sage at Lamar); it should be the rule, with the photo as a check.

### 4.4 "Colour from above is a fair judge"

It measures the layer that was already strongest, against data the layer was built from. A judge should be
independent of the inputs and should cover what players see. Four checks that open data supports:

1. **Structure:** canopy height and cover against GEDI lidar footprints (global), or against lidar held out of the
   build on US tiles.
2. **Composition:** the drawn species shares against inventory plots or a park's plant list.
3. **Species lists:** the animals listed against a park's checklist, as precision and recall.
4. **Eye level:** renders against geotagged ground photos at the same spot and month. The Hoh comparison did this
   once by hand and found real defects; it should be routine.

### 4.5 "Remove the structures and you have the wild world"

The baseline is not defined. Today's vegetation minus buildings is not a world without people: it carries a century
of fire suppression, logging, grazing and invasive annual grasses, and the animal lists carry introductions and lack
what was hunted out. The pipeline already makes one such choice, drawing LANDFIRE's pre-settlement vegetation under
cities (56% of one San Francisco tile). It needs a stated rule for the rest. This is a design decision for Aaron, not
a data question; my recommendation is in section 7.

**Decided 2026-11-10.** Aaron adopted the recommendation in section 7 ("Yes, adopt it"). One correction to the
paragraph above: `docs/brief.md` did state a species baseline ("today's species, with ranges and densities as
predicted 10 years after humans disappear"); nothing in the pipeline implemented it. The adopted rule replaces it.

### 4.6 "One snapshot, one weather series"

One climate series per 10 km tile, though Yosemite's tile spans 2 km of relief. Snow comes from coarse reanalysis
while the Sentinel-2 scenes we already download classify snow per pixel per month, and that class is masked out.
There is no fire history or stand age, so every forest is the same age.

### Is it the right method at all?

Yes. The alternatives each fail a hard requirement:

- **Photogrammetry and 3D map tiles** are aerial, closed-licence, and full of buildings.
- **Splats or radiance fields from ground photos** need dense photos, which wild places lack, and give a frozen scene.
- **Generative world models** have no ground truth and cannot be audited or licensed.

Where learned models do belong is as *estimators*: turning satellite data into maps of species, cover or canopy
height that the procedural generator then draws. That is the direction to add, not a replacement.

## 5. Datasets

### Signals already downloaded and not used

| Signal | What it would give |
|---|---|
| NAIP near-infrared band (only RGB is read) | Live against dead vegetation, conifer against broadleaf, water and wet ground |
| Sentinel-2 snow class (masked out) | Snow line and melt date per pixel per month |
| Lidar returns under the canopy (only the top surface is kept) | Understory density, the thing an animal walks through |
| Lidar-measured channel width | Real stream widths instead of the area formula |

### Candidate sources

Licence and access were checked on the web by a subagent on 2026-11-10. I re-read the provider's own page for four
of them (TreeMap, RCMAP, AlphaEarth, PHYLACINE); the rest are as the subagent reported, and "presumed" means a US
federal product with no licence statement found.

**United States, measured where we now infer**

| Dataset | What it gives | Licence and access | Use |
|---|---|---|---|
| USFS TreeMap 2023 | A forest inventory plot assigned to every 30 m forest cell: tree species, diameters, heights, density | Federal, "without additional permissions or fees"; direct download, 4.9 GB | Tree composition and stand structure. Right in aggregate, often wrong for one cell |
| FIA BIGMAP | Biomass of each of 327 tree species, 30 m, about 2018 | Public domain (presumed); one file per species | Weights for the species mix |
| RCMAP 1985-2024 | Percent cover of sagebrush, other shrubs, perennial and annual herbs, litter, bare ground; shrub height; 30 m | USGS, public domain; direct download | Sage steppe, desert and grassland cover: Lamar, Teton, Grand Canyon |
| RAP 10 m | Cover by plant group, invasive annual grass, pinyon-juniper | Licence not stated on its own site | Hold until the licence is confirmed |
| National Wetlands Inventory | Wetland and riparian polygons by type | Public domain (presumed); state downloads | Wet meadows, marsh, riparian. Fixes meadows drawn as forest |
| NPS vegetation maps | Plant associations mapped per park, with plots | CC0 for the packages checked; per park | Composition and a held-out check in Yosemite, Yellowstone, Grand Canyon, Olympic |
| National Water Model v3 | Hourly modelled flow for every stream reach, 1979-2023 | Open, no restrictions; anonymous S3 | Width, depth, speed and seasonal flow. NHDPlus mean annual flow is the simpler first step |
| USGS GAP | Habitat maps for 1,590 vertebrates, 30 m | Public domain or CC0, sources differ | Animal presence by habitat, not by sightings. Based on 2001 land cover and coarse |
| MTBS | Burn severity for large fires since 1984 | Public domain or CC BY, sources differ | Burn scars, snags, stand age |
| NOAA CUDEM | Land and sea floor together, about 3 m, US coasts | Open; anonymous S3 | The sea at the San Francisco tiles |
| SNODAS | Modelled snow depth, 1 km daily | Public domain | Snow, though the Sentinel-2 snow class we already hold is sharper |

**Anywhere**

| Dataset | What it gives | Licence and access | Use |
|---|---|---|---|
| AlphaEarth satellite embeddings | A 64-number summary of each 10 m cell per year, 2017-2025 | CC BY 4.0, fixed attribution text; no account | Not a measurement. With a few labels it maps species or cover classes where no map exists. The best single addition for global tiles |
| National lidar | 1 m terrain and point clouds | Norway CC BY 4.0 (terrain model confirmed); Netherlands, England, France, Spain, Switzerland, New Zealand, Estonia open | Lofoten could be built at 1 m |
| GEDI | Canopy height and vertical profile at 25 m footprints, 51.6 N to 51.6 S | NASA open, but needs a free Earthdata login | An independent structure check for the tropical tiles. Aaron would need to make the account. Does not reach Lofoten |
| JRC Global Surface Water 1.5 | How often each 30 m cell is water, 1984-2024 | Free, no restriction | Stream and lake permanence abroad, where OSM has none |
| CHELSA 2.1 | Climate normals at 1 km | CC0 | Climate gradient inside a tile |
| GEBCO 2025, EOT20 | Sea floor at 450 m; tide constituents | Public domain; CC BY | Sea and tides abroad |
| PHYLACINE 1.2 | Mammal ranges as they would be without people, 96 km grid | CC0 | Restoring extirpated mammals. Very coarse |
| GloBI | Records of which species eats or pollinates which | CC0 for the compiled product | Food webs by species |
| TetraDENSITY, HomeRange | Measured animal densities and home ranges | HomeRange CC0; TetraDENSITY 2 unverified | Herd sizes and territory sizes |
| Sound: iNaturalist, GBIF media, Wikimedia Commons | Recordings with a licence per item | Filter to CC0, CC BY, CC BY-SA | The tile's own species, heard |
| Ground photos: iNaturalist, Commons, KartaView | Geotagged photos | Per item; KartaView CC BY-SA | The eye-level judge. Pipeline-side only |

**Not usable for clients, or needing review**

- **xeno-canto:** most recordings are non-commercial and the API now needs an account.
- **PRISM:** commercial use needs permission.
- **TESSERA embeddings:** sources disagree between CC BY and CC BY-SA.
- **Mapillary:** token required and the terms need review.
- **sPlotOpen:** licence per plot, some non-commercial; not confirmed.
- **eBird Status and Trends:** already excluded.

## 6. Missing fidelity that is not a map

- **Sound.** A place's dawn chorus is the fastest route to "this is the Hoh". Real recordings of the tile's own
  species, where licences allow, would add more felt realism than any visual change of the same effort.
- **Fish and invertebrates.** Rivers are empty and there are 14 invertebrates in the registry, all without models.
  Salmon runs, insect hatches and pollinators are what make many of the games' food webs real.
- **Abundance.** Herd and flock sizes are set by hand. Density scales with body mass and productivity, and there are
  open compilations of measured densities and home ranges.
- **Who eats whom.** Diet comes from trait tables at the level of "eats seeds". Open interaction records name the
  actual species pairs.
- **Disturbance and age.** Burn scars, snags, windthrow, beaver meadows, avalanche tracks. These are most of what
  makes a forest look wild rather than planted.
- **The sea.** Two San Francisco tiles and Lofoten have a coast with no tide, surf or sea floor.

## 7. Recommendations, in order

1. **Make the build say how good each tile is.** A scorecard per tile and layer: what was measured, what was ruled,
   what was guessed, what is blank. Everything in section 3 was computed by hand for this review and should be an
   output of every build. Small.
2. **Stop silent stand-ins across regions.** A species without a record takes a stand-in from its own region and
   genus, or is reported as missing. Never a California tree in Arizona. Small.
3. **Widen the judge** with the four held-out checks in 4.4, starting with composition and eye-level photos. Medium.
   This comes before new data so that each new source can be shown to help.
4. **Use the four discarded signals** in section 5. Small to medium each, no new downloads.
5. **Measured composition in the US** in place of name-keyed rules, and wetlands from the wetland inventory, which
   also fixes wet meadows drawn as gallery forest. Medium.
6. **Decide the baseline** (4.5). Recommended: today's ecosystems; introduced species removed by a native-status
   filter; extirpated natives restored from present-natural range maps and marked as restored; pre-settlement
   vegetation only where today's is developed, farmed or ruderal. Small once decided.
7. **Stream discharge** from modelled flows, giving width, depth, speed and seasonal change. Medium.
8. **Real sound** for each tile's species list, from openly licensed recordings only. Medium, and the largest gain
   in feel.
9. **Fish, then abundance and interactions.** Medium.
10. **Better global tiles:** Norway's 1 m terrain for Lofoten, satellite embeddings to map composition from a few
    labels, GEDI as the structure check. Large, tile by tile.

## 8. What this review did not check

- I did not open the viewer or take new captures; the eye-level judgements rest on the decisions log and earlier
  comparisons.
- The species-composition errors are checked against general knowledge, not field plots, except Grand Canyon.
- Server, client rendering and games were out of scope (see `architecture-review-2026-11-03.md`).
