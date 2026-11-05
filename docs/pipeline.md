# The tile pipeline

How a tile is built from nothing, the same way every time, anywhere a source reaches; how its species are researched,
looked up and grown; and what it costs. Written 2026-11-04 from an audit of `pipeline/` and every tile's manifest, then
reorganised the same day into four stages (Aaron: base, flora, fauna, games, each runnable on its own and in order).

Aaron's brief (2026-11-04): "When we create a new tile, we need to be going through all the steps, and making sure
the steps are repeatable so that we can accurately depict a tile anywhere on earth. When we create a new tile, we need
to generate all of the species for that tile if they don't already exist... a registry of species... which species
have been created and what level of fidelity that asset is at." And on the species: "the species creation pipeline
begins with research - what are the species in this region? We are specifically looking for the most populous species
plus all predators and scavengers... We list all the species, then we pick a species density equivalent or greater than
the foothills and start generating assets. For each type of species try to find reusable parts, riggings, algorithms
for creation. The goal is a pipeline that can reliably grow a new tile without many edits."

## One command, four stages

    python -m pipeline.build_tile --tile <id> --stage all            # everything, in order; current steps skipped (= --all)
    python -m pipeline.build_tile --tile <id> --stage base           # one stage; base, flora, fauna, games (comma-separated ok)
    python -m pipeline.build_tile --anchor -123.93 47.86 --stage all  # the 10 km cell holding a point
    python -m pipeline.build_tile --tile <id> --plan                 # what would run, and why, stage by stage
    python -m pipeline.build_tile --tile <id> --stage flora --force species_mix   # a step whatever its state
    python -m pipeline.build_tile --tile <id> --status                # per step: ran, missing, stale
    python -m pipeline.build_tile --tile <id> --adopt                 # a tile built before the graph, as its baseline
    python -m pipeline.build_tile --tile <id> --cost                  # what it cost: time, downloads, disk, client bytes
    python -m pipeline.build_tile --tile <id> --all --out /tmp/x       # into another tiles folder (WILD_EARTH_TILES)
    python -m pipeline.registry                                       # library/registry.json from what exists
    python -m pipeline.seams <id>                                     # the seams with the built neighbours

Run Python as `arch -arm64 .venv/bin/python` on this Mac (pyproj). A stage reads only its own and earlier stages'
outputs (asserted at import); run alone, it refuses a step whose input was never built, naming the stage to run first.
`--steps a,b` still runs named steps whatever their state (the dev server's build API; the old names `veg` and `derive`
map to `landcover` and `terrain`).

| stage | steps, in order | what it makes |
|---|---|---|
| **base** | dem, naip, osm, hydro*, channels*, rewild_hydro*, landcover, ice, lidar, water*, ground, terrain, erase, substrate, seasons, weather, unreal, seams | the ground: elevation (5 m, 1 m where flown), imagery and its erasure, the built footprint, the hydrology rewilded and banked, permanent snow and ice, soils, geology and exposed rock, the client's terrain rasters, place names, Sentinel-2 seasons, weather; the seams with built neighbours |
| **flora** | plants, species_mix, crowns, inpaint | the plant research (cover, records, the density target), missing species grown from their trait cards, the mix per 30 m cell (trees, shrubs, ground layer, riparian zones), the lidar crowns and the ground texture under them |
| **fauna** | species, animals, resources | GBIF presence, perception, calendar, locomotion and the density prior for the curated animals; the animal research (every animal recorded, ranked, every predator and scavenger, traits for those without, the Meshy queue); food, water and cover by season |
| **games** | games, game_seeds, registry, audit | each species' games; each shared game's world seed (acorn, dig, carrion); the species registry report and the licence audit that close every build |

\* the water lane's steps, folded in unchanged (`owner: water lane`).

One departure from the brief's lists, and why: **landcover** (LANDFIRE EVT/EVC/EVH/BpS and the habitat classes) is in
the base stage, not flora. The base layer's imagery erasure needs LANDFIRE's human classes, the substrate and the
ground's outcrop need its cover, and the terrain textures need the habitat classes; a stage may not read a later one.
Flora reads landcover for its species. The species mix (the communities, the unmatched ones, the ground plants) is
flora's, as are the crowns and their inpainting.

### Base

| step | after | writes | sources (licence) | reach / fallback |
|---|---|---|---|---|
| dem | | terrain.dem (5 m) | USGS 3DEP (PD) | US; Planetary Computer 3DEP 10 m; **NASADEM 30 m (NASA, no restrictions), global, implemented** |
| naip | | imagery.naip | Planetary Computer / USGS NAIP (PD) | CONUS; elsewhere fails loudly (next: Sentinel-2 true colour) |
| osm | | footprint.mask | Overpass (ODbL) | global |
| hydro, channels, rewild_hydro, water | (water lane) | streams, beds, banks, riparian zones | NHDPlus HR (PD), OSM | NHD US; OSM fallback; routing on the DEM global |
| landcover | rewild_hydro | vegetation.* (EVT, EVC, EVH, BpS, habitat) | LANDFIRE (PD) | CONUS; elsewhere fails loudly (next: WorldCover + RESOLVE ecoregions, CC BY 4.0) |
| ice | dem, landcover | terrain.ice (+ client/ice.png, terrain/ice.json) | LANDFIRE Snow-Ice, OSM natural=glacier | global (OSM), US (LANDFIRE) |
| lidar | dem, osm, landcover | 1 m DEM, CHM, roughness, terrain detail, micro, lidar_cover | 3DEP 1 m DEM and point clouds (PD); TNM LPC search | US where flown; missing 1 m cells filled from the 5 m DEM and corrected by the point cloud's ground; the point cloud where it reaches (`client/lidar_cover.png`), LANDFIRE's canopy and the mix's trees beyond; DEM-only without a point; not applicable outside the US |
| ground | dem, landcover, lidar | geology, soils, outcrop, ground classes | Macrostrat (CC BY 4.0), SGMC, SSURGO (PD) | geology global; soils US (next: SoilGrids, CC BY 4.0) |
| terrain | dem ... water, landcover, ice | hillshade, heights, habitat, canopy, roads, textures, masks, features | Overpass places, Native Land | |
| erase | naip, osm, landcover, terrain, rewild_hydro | client.texture_imagery | | |
| substrate | ground, water, lidar, erase, terrain, ice | client.substrate | | |
| seasons | landcover, lidar, naip | Sentinel-2 monthly colour | Sentinel-2 L2A (Copernicus terms, credit) | global |
| weather | | client.weather | Open-Meteo (CC BY 4.0) | global |
| unreal | dem, landcover | the Unreal export | | |
| seams | dem, channels, water | the manifest's `seams` | | fails when the DEM steps across a seam or a stream of order 3+ crosses on one side only |

### Flora

| step | after | writes |
|---|---|---|
| plants | landcover, ice | species/plant_needs.json (the ranked plant list, the density target, the hand edits), species/localized.json (groves), library records grown from cards |
| species_mix | dem, landcover, water, ice, plants | client/species_mix.json + index and density PNGs: trees, shrubs, ground layer and riparian rows per cell |
| crowns | lidar, osm, landcover, terrain, species_mix | client.trees_lidar (not applicable without a point cloud) |
| inpaint | erase, lidar, crowns, terrain | the ground texture under the crowns (not applicable without a point cloud) |

### Fauna

| step | after | writes |
|---|---|---|
| species | dem, landcover | species.json (presence), occurrences (pipeline-only), seasonal, inventory, perception, calendar, locomotion, client.species_prior |
| animals | species, plants | species/animals.json (the ranked animal list, predators, scavengers, the Meshy queue, stand-ins), library/animals/traits/<id>.json for animals without an entry |
| resources | dem, hydro, landcover, terrain, species_mix, species | the seasonal resource rasters, client.mast |

### Games

| step | after | writes |
|---|---|---|
| games | species, resources, animals | games.json |
| game_seeds | games, resources, species | game_seeds.json: per game (acorn, dig, carrion) the seed (FNV-1a of tile and game, as server.py seed_of), the players on this tile, the hotspots, the client module and the world |
| registry | plants, species_mix, species, animals | species/registry.json |
| audit | every step | the manifest's licence_audit; fails on a missing credit or CC BY-NC data in a client layer |

## Repeatable: fingerprints, versions, sources, fallbacks

Before a step runs: `fingerprint = sha256(version, the hash of its modules' code, its parameters, every upstream step's
output hash, the library folders it reads)`. The step is skipped when its last record has the same fingerprint and
every output it recorded is still on disk with the same hash (a file two steps write is checked only by the last
writer). A step whose outputs come out the same leaves its dependents current, so a code change re-runs exactly the part
of the graph it reaches. The manifest's `steps` holds per step its version, code hash, parameters, fingerprint, outputs
with their hashes, sources with their dates, the fallbacks it took (`pipeline/runlog.py`, recorded where they happen),
network reads against cache hits, coverage gaps, status, owner, time. A failed step stops the build (`--keep-going` runs
what does not depend on it); a step of a later stage whose input was never built is blocked, naming it.

## Reading cost.json (the cost meter, pipeline/cost.py)

`tiles/<id>/cost.json` is written after every step and at the end of every build:

- `steps.<name>`: the step's last run. `started_at` / `ended_at` (UTC ISO), `wall_s`, `cpu_self_s` and `cpu_children_s`
  (`resource.getrusage`, user + system, over the step: children are the lidar and Sentinel worker processes),
  `downloads` (`{source: {bytes, requests}}`: every HTTP read through `requests`, the step's worker processes included,
  counted by pipeline/netmeter.py), `cache` (`{source: {hits, misses}}`: reads answered from a cache against those that
  went to the source), `disk_bytes` (the step's output files), `meshy` (`spent`, `queued`, `queued_credits_est`), `status`.
- `stages.<name>`: the start and end of the stage's last run (its first step run to its last) and the sums of its steps.
- `runs`: every build invocation, with each stage's start, end, the steps run and the steps skipped.
- `client`: what a player downloads to enter the tile: every file under `client/` and the tables the viewer fetches
  (manifest, perception, calendar, locomotion, games, species/species.json). An upper bound: the present-day texture is
  fetched only on request. Reported apart from the build's disk.
- `totals`: the sums over the steps' last runs.

A rebuild from the caches shows its downloads near zero and its hits in `cache`. Not counted: reads GDAL makes itself
(rasterio opening a Planetary Computer COG: the NAIP and DEM fallbacks, the Sentinel-2 looks); the Sentinel cache hits
say whether the looks were read again. Claude's own work is not in the file: the stage timestamps are what
`tools/token_meter.py` (on main, kept separate) joins to the session transcripts to price it. `--cost` prints a summary.

## Caches and retries

| source | cache | retries / guard |
|---|---|---|
| 3DEP ImageServer | `_cache/3dep_5m_rRRcCC.tif`, 500 px chips | 3 tries per chip; Planetary Computer fallback; STAC search now 3 tries |
| NAIP | `imagery/naip.tif` itself | Planetary Computer first, USGS chips second |
| LANDFIRE | `_cache/landfire_<p>.tif`; tables in `pipeline/_cache/<p>.csv` | 4 tries, 45 s apart; a JSON error under an image content-type is refused and never cached (http.download) |
| Overpass | `_cache/overpass_*.json` | three mirrors, then curl, 60-600 s backoff, an hour's budget |
| NHD | none (gap: owned by the water lane, fetch_hydro.py) | 4 tries, then the OSM fallback |
| 3DEP lidar | `_cache/lidar_index/`, `_cache/lidar_grid_v2/` (resumable) | node reads 5 tries; failed nodes raise "re-run to retry"; ept.json reads 3 tries and **a read error is no longer taken for "no point cloud"** |
| GBIF | `_cache/gbif/q_<hash>.json` per query, name matches in `pipeline/_cache/gbif/` | **every read cached since 2026-11-04** (occurrences, month facets, inventory were asked again on every run); a failed read is not cached |
| Macrostrat, SDA | `_cache/macrostrat/`, `_cache/sda/` | 3 tries |
| Sentinel-2 | `pipeline/_cache/sentinel/<tile>/looks/` | provider fallback; failed dates recorded |
| Open-Meteo | `pipeline/_cache/weather/<tile>/` | 4 tries with Retry-After |

Known cache limits, left as they are: the lidar `projects.json` / `ept.json` and Macrostrat point caches are reused even
under `--force` (a newer 3DEP collection is not seen until they are deleted); the Overpass caches are keyed by file
name, not the query; the weather cache is keyed by the day it ran (last year's weather is relative to the build date,
so a rebuild on another day differs by design).

## Anywhere on Earth: no California in the defaults (pipeline/regions.py)

Two kinds of region. **Coverage**: `regions.COVERAGE` names, for every source, where it serves and the global source that
stands in (the table under Base). **Natural regions**: `regions.NATURAL` (california, pacific_northwest, great_basin;
boxes) says which tables were written for where. Every rule, table and test that was tuned for California is tagged so,
and a tile elsewhere never falls back to it in silence:

- **Species-mix rules** carry a `region`. Every rule written before 2026-11-04 is California's; open water and snow and
  ice hold anywhere; the North Pacific rules (Sitka spruce, western red-cedar and hemlock, silver fir, Douglas-fir and
  western hemlock, mountain hemlock, subalpine parkland, alpine heath and fell-field, bedrock and scree, lowland and
  montane riparian, avalanche chutes, lowland mixed forest) are the Pacific Northwest's. A tile matches only its own
  region's rules.
- **An unmatched community** is read from its name (`communities.named_species`, with a region's own reading first:
  "alpine dwarf-shrubland" is red mountain heather in the Sierra, pink and white heather in the Olympics); failing that it
  takes the tile's own species of the same habitat class (the tile pool); the foothill default is used in California
  only. Outside, a community nothing can read is drawn bare and recorded as a fallback and a hand edit.
- **The elevation zones** (gray pine to ponderosa to Jeffrey ...) and **the coast's oaks** are California's tables; the
  Pacific Northwest has its own terrain factors (`TERRAIN_BY_REGION`: Sitka spruce and western hemlock in the valleys,
  silver fir 600-1,200 m, mountain hemlock and subalpine fir to treeline, heath above), so one Olympic tile carries the
  whole zonation from the Hoh's floor to Mount Olympus.
- **The riparian zone rows and the ground layer** draw only species that grow in the tile's region (a record's
  `regions`, from its card; the older records are California's, those that also grow in the Pacific Northwest listed in
  `communities.ALSO_PNW`). The water step's rewrite of the riparian rows is re-filtered by the runner.
- **The curated animals' range test** (Grinnell and Storer's Sierra life zones) applies in California only; elsewhere a
  curated animal is present by its records alone.
- **Permanent snow and ice** (the `ice` step: LANDFIRE Snow-Ice, OSM glaciers) is bare in the species mix whatever the
  community; `terrain/ice.json` lists the ice's toes (where meltwater leaves it) for the water lane to seed streams from.
  Seeding the meltwater streams is the water lane's (channels.py): not done here.
- **Seams**: a tile's DEM and streams are checked against every built neighbour (`seams`; the two San Francisco cells:
  the DEM steps 0.108 m across their seam against 0.106 m inside; five small streams of order 1-2 cross on one side only,
  listed). For the two Hoh tiles at x = 439 km: both DEMs come from the same 3DEP mosaic on the same 5 m lattice, so they
  agree; a creek routed in one tile and not the other fails the seam (the fix is the routing's: route with the
  neighbour's DEM as a margin, the water lane).

What remains California-shaped, named so it is not mistaken for general: the resource rasters (`habitat.RESOURCE_BASE`
gives acorn mast by habitat class), the curated animals' calendar and perception tables (species_data.py), the
client's own habitat-class fallback mix for a cell without a row (the species mix gives every land cell a row).

## Species: research, the density target, assets by archetype

### Research first (flora: plants; fauna: animals; pipeline/research.py)

Every tile gets a ranked species list, written down with each species' kind, why it is on the list and its source:
`species/plant_needs.json` (plants) and `species/animals.json` (animals). Kinds: tree, shrub, forb, grass, emergent,
fern, moss, mammal, bird, reptile, amphibian, fish, invertebrate, and fungus (a place kept: GBIF's fungi are not
fetched yet).

- **Most populous, plants**: the cover each species holds in the tile's LANDFIRE communities (the community's cells x
  the species-mix rule's weight for it, or the species its name names), then GBIF's 150 most-recorded vascular plants on
  the tile (cached facet counts), the known ones first; each kind filled to the density target.
- **Most populous, animals**: GBIF's most-recorded species per class on the tile (birds 150, mammals 80, reptiles,
  amphibians, fish 30, land snails and slugs 20), domestic animals left out, each ranked by its share of its class's
  records. Records follow observers (birds over mammals, the charismatic over the cryptic), so species are ranked within
  their class, never across; a class's quota fills the target (birds 10, mammals 8, reptiles 2, amphibians 2, fish 1,
  invertebrates 1).
- **Every predator and scavenger**: from EltonTraits 1.0 (Wilman et al. 2014, Ecology 95:2027; birds and mammals
  worldwide; downloaded once into `pipeline/_cache/eltontraits/`, read as data). A predator takes half or more of its
  diet from vertebrates, a scavenger a tenth or more from carrion; a name EltonTraits files differently falls back to its
  genus' and then its family's means (elk is its *Cervus elaphus*). Every predator and scavenger with 3 or more records
  on the tile is listed whatever its rank.
- **Licences**: EltonTraits is CC BY 4.0 (Ecological Archives' default; the record states no copyright restrictions),
  credited in the tile's sources. GBIF is read as facet counts (numbers); occurrence records stay pipeline-only
  (`for_clients: false`), and only CC0 and CC BY records place anything a client sees (the density prior, the sequoia
  groves). No CC BY-NC data is shipped: the audit step fails the build if a client layer is marked otherwise.

### The density target

The home tile is the bar (research.TARGET): 21 trees, 23 shrubs, 26 ground plants and 22 animals, each with a role. A
tile's list is filled to at least that per kind, from the top of each class; `plant_needs.json` `summary.meets_target`,
`animals.json` `meets_target` and the registry report's `density` say whether it got there, and how many have models.

### Assets by archetype

Every kind is a parameter set on a shared generator or rig; a species is a file, not code.

| archetype | generator / rig | what is automatic | what needs hands | cost per species |
|---|---|---|---|---|
| tree, shrub | `treegen.js` from a species record; `pipeline/plantgen.py` builds the record from a trait card on a template of its genus or family | the record, its age classes (the template's, rescaled), impostors, the species mix's weights, stand-ins until it exists | the trait card (an agent's research: heights, crown outline, colours, habitat, relations, sources) and a lineup review | ~12 k Claude tokens and ~1 min per card (49 cards: 584 k tokens over three agent runs); no credits; seconds to grow |
| forb, grass, emergent, fern | `forbs.js`, `grass.js`, `emergents.js` from the record's `ground` block (plantgen, on a template of the same form) | the record, the ground layer's weights from its habitat block | the card; a fern habit (drawn as a rosette forb today) | as above; the forb atlas holds 24 species (raised from 16 for the Olympic ferns) |
| grown age classes | `tools/grow_species.mjs` from a `growth` block (height and dbh by age) | nothing yet: only valley, blue and live oak have growth blocks | a growth block per card (Silvics curves): the next step, not done here | |
| mammal (quadruped) | a mesh fitted to `tools/rig_quadruped.py`'s skeleton, `gait.js` / `legs.js` | traits (`library/animals/traits/`): diet and mass (EltonTraits), senses (the class's ranges scaled by size), size, locomotion (`locomotion.py` from the taxon tree and the body); the Meshy queue entry and its stand-in | the mesh (Meshy, then a review and the rig fit), the calendar, a voice | ~30 credits (a preview 20, a refine 10) |
| rodent, lagomorph | the rodent part rig; the hop gait (gait.js hopStep) for lagomorphs | as above | as above | ~30 credits |
| bird | the bird part rig, flierControl | as above | as above | ~30 credits |
| reptile, amphibian | the reptile template (amphibians hop on it) | as above | the mesh; snakes need a spine-wave rig (none yet) | ~25 credits |
| gastropod (banana slug) | none: a procedural body of rings and a foot wave | traits (a slug's foot wave: millimetres a second) | the procedural body | no credits |
| fish | none yet: a body-wave swim rig | traits | the rig | ~25 credits |
| fungus | none | a place in the kinds | everything | |

### The registry (pipeline/registry.py)

`library/registry.json` and each tile's `species/registry.json`, built by scanning (never by hand): plant records and
cards, animal entries, generated traits, the leg engine (the GLB's `extras.skin.legs`), voices (`sound.js`), behaviour
tables (`species_data.py`), the plants' relations (a herbivore's diet), the locomotion tree, playable bodies, and every
tile's species mix, presence, research and queues.

| level | plants (trees, shrubs; ground plants alike) | animals |
|---|---|---|
| 0 none | no record: a stand-in species is drawn in its place | no model (generated traits may exist; a stand-in is recorded, nothing drawn) |
| 1 stand-in look | a record generated with only its own size and colour on the template's form | drawn with another species' mesh |
| 2 own model | its own crown, branching and foliage (a generated record stays here until its card carries a lineup `review`) | its own mesh, not animated |
| 3 grown / rigged | three or more age classes and four seasons' colours | rigged and animated (part rig, skin and clips, or client code) |
| 4 full | habitat and relations | behaviour (senses, diet, calendar) and a voice |

### Hand edits: the goal's measure

Each tile's registry report lists `hands`: the edits a person or an agent must still make for that tile, by kind (a
trait card to write, a community to give a lexicon phrase or a rule, a mesh to make and review, generated traits to
review). A tile that grows without edits has none but the Meshy approvals.

## Work tiles needed that the step list did not do

From the git log and the manifests' logs (the audit in full: the 2026-11-04 decision entry).

| what | how it was done | now |
|---|---|---|
| point clouds streamed | `python -m pipeline.lidar` out of band, then `--steps lidar` to record | the lidar step, resumable |
| crowns re-found on the SF cells after the dense-urban rule | `pipeline.lidar --stage crowns` by hand | the crowns step after derive |
| LANDFIRE outage (2026-10-27) | an external loop re-running veg..unreal every 15 min, without derive, so erase failed each round | retries in the step; a failure stops the build |
| species_mix runs | a script and a hand-written log entry (`species_mix (format 2)`, `(foothill set, terrain)`, `+games (water lane)`) | part of derive |
| perception senses, locomotion, games plays | scripts rewriting the JSON in place, manifests untouched | the species and derive steps |
| place names, territories | `python -m pipeline.fetch_places` / `fetch_territories` | inside derive (and rewild_hydro); a skip is a recorded fallback |
| licence audit | by hand per commit | the audit step |
| Yosemite DEM-only, re-centred tile, edge seeds, substrate tuning | code fixes then a re-run | the graph re-runs what a code change reaches |

## The tiles as they stand (`--status`, 2026-11-04, before this lane's rebuilds)

"stale" is one of: code changed after the step last ran (git, 12 h margin), a file differs from its manifest hash, or
a layer the step owns is missing. MISSING: never ran. n/a: not applicable.

| step | 540_4170 | 540_4180 | 680_4270 | 680_4280 | 690_4280 | 267_4175 | 270_4180 |
|---|---|---|---|---|---|---|---|
| dem | 10-26 | 10-26 | 10-25 | stale (code) | stale (code) | 10-29 | 10-28 |
| naip | 10-26 | 10-27 | 10-25 | stale (code) | stale (code) | 10-29 | 10-28 |
| osm | 10-27 | 10-27 | stale (code) | stale (code) | stale (code) | 10-29 | 10-28 |
| hydro | 10-26 | 10-27 | 10-25 | 10-23 | stale (code) | 10-29 | 10-28 |
| channels | stale (code) | stale (code) | stale (code) | stale (code) | stale (code) | 10-29 | 10-28 |
| rewild_hydro | stale (code) | stale (code) | stale (code) | stale (code) | stale (code) | 10-29 | 10-28 |
| veg | stale (code) | stale (code) | stale (code) | stale (code) | stale (code) | 10-29 | 10-28 |
| lidar | stale (no lidar_micro, multi_1m) | stale (same) | stale (code) | stale (code) | stale (code) | 10-29 | stale (code) |
| water | MISSING | MISSING | MISSING | 10-29 | MISSING | 10-29 | MISSING |
| ground | 10-26 | 10-27 | 10-26 | 10-26 | 10-26 | 10-29 | 10-28 |
| species | stale (perception hash, no locomotion layer) | same | same | same | same | stale (locomotion hash) | same as 540 |
| plants | MISSING (new step) | | | | | | |
| derive | stale (resources hash, no games layer) | same | stale (games hash) | stale (games hash) | stale (games hash) | stale (species_mix, games hashes; no mast) | stale (games hash) |
| crowns | MISSING | MISSING | MISSING | MISSING | MISSING | n/a | n/a |
| erase | 10-27 | 10-27 | stale (code) | stale (code) | stale (code) | 10-29 | 10-28 |
| substrate | 11-03 | 11-03 | 11-03 | 11-03 | 11-03 | 11-03 | 11-03 |
| inpaint | 10-27 | 10-27 | 10-26 | stale (code) | stale (code) | n/a | n/a |
| seasons, weather, unreal | ran | ran | ran | ran | ran | ran | ran |
| registry, audit | MISSING (new) | | | | | | |

The full table, with the commits behind each "code" flag, is in each manifest after `--adopt`, and `--status` prints it.

## Proof

**An existing tile rebuilt from nothing** (2026-11-04): `utm11n_270_4180` (the first Yosemite cell) built by
`build_tile --tile utm11n_270_4180 --all --out <scratch>` into an empty folder holding only a copy of the tile's raw
fetch cache (`_cache/`: the 3DEP chips, LANDFIRE exports, Overpass answers, lidar index, Macrostrat and SDA answers;
the shared Sentinel looks in `pipeline/_cache/`); every product was made again, the 1 m DEM products downloaded again,
NAIP read again from the Planetary Computer, GBIF asked again. All 22 steps ran (the lidar step DEM-only, recorded as a
fallback; crowns and inpaint not applicable), and a second `--all` skipped all 22. Against the tile on disk (the
committed JSON, the rasters as built on 2026-10-28, its species mix rebuilt today), 117 of 156 files are the same, 116
byte for byte: the DEM, NAIP, every LANDFIRE raster and the habitat, the footprint, the hydrology and channels, the 1 m
DEM and roughness, geology, soils and outcrop, the erased imagery, the species mix and the games. What differs, and why:

| files | why |
|---|---|
| terrain/dem_banked.tif, client/water.png, water_width.png, hydro/water_reaches.json (new); client/heights.png, terrain_detail.png, terrain/hillshade.png, terrain_rgb.png, rewilded.png, client/texture.png (0.2-2 % of pixels), substrate.png / .json | the water step, which never ran on this tile: the banks are carved into the DEM that derive and substrate read. The tile on disk was stale, not the rebuild |
| seasons/s2_10.tif (85 % of pixels, mean 0.0006 reflectance), s2_11.tif (12 %), the other months under 1.2 %; client/season_rgb.png, season_ndvi.png; months.json | Sentinel-2 scenes from October 2026 that did not exist when the tile was built (the composites span 2019-2026) |
| species/occurrences.geojson (8,332 records against 8,281), seasonal.json, client/species_prior.json, plant_needs.json, registry.json | GBIF records added since 2026-10-28; from now on the answers are cached, so a rebuild reads the same ones |
| client/weather.json | last year's weather is relative to the build date, by design |
| hydro/channels_present.geojson, human_water.geojson | the present-day channel snapshot is taken once (rewild_hydro); the tile's was taken before the 2026-10-28 channel fixes |
| manifest.json, lidar_dem_only.json | the steps table, the water layers and status, and the products' timing |

**A new tile from nothing**: `utm10n_731_4235`, Calaveras Big Trees, centred on the North Grove (the tile id at any
whole kilometre: 731 E 4235 N), built by `build_tile --tile utm10n_731_4235 --all` and nothing else. Every step ran;
the build stopped loudly twice and resumed with the same command, each time skipping what was done:

1. at `lidar`: the first off-grid tile with a point cloud. The first EPT project that overlapped by its box
   (CA_SierraNevada_3_2022) held 54 k points and none in the tile, and the products' statistics failed on the empty
   grid. Fixed in lidar.py: the candidate whose hierarchy has the most points in the tile's nodes is taken
   (CA_SierraNevada_5_2022, 3.76 G points, 78,754 nodes, 53 min), recorded as a fallback; an empty grid now fails at the
   grid with its reason.
2. at `seasons`: a layer whose `files` is a list (fixed in the runner while the build ran; the build held the old code).

Then a code change (the sequoia grove radius) re-ran exactly derive and its dependents. Times: dem 20 s, naip 36,
osm 89, hydro 30, channels 18, rewild_hydro 136, veg 6, lidar 3,169 (DTM check: median offset -0.001 m, std 0.066;
531,657 crown maxima), water 16, ground 45, species 167, plants 6, derive 28, crowns 111, erase 22, substrate 5,
inpaint 76, seasons 74 (860 Sentinel-2 dates read on the first try, 21 min), weather 6, unreal 1, registry, audit;
the licence audit passes. The tile's trees: ponderosa 31 %, white fir 16, incense cedar 11, sugar pine 11, black oak
9, canyon live oak 6, Douglas-fir 5, giant sequoia 1.4 % (4,256 grove cells from 134 CC0 / CC BY records; 469 CC BY-NC
records left out); shrubs whiteleaf manzanita, deerbrush, mountain misery, greenleaf manzanita, snowberry. 60 plant
species needed, all with records, none unread; 48 animals GBIF records there queued for Meshy (1,440 credits est.).
It loads in the viewer with no console error.

Nothing differs that the inputs do not explain: the build is repeatable up to its time-relative sources, which are now
cached (GBIF) or dated (Sentinel years, the weather period).

## The registry and the five tiles today (2026-11-04, after the four stages)

`library/registry.json`: 253 species. 77 at level 4, 21 at 3, 32 at 2 (the generated plant records, held until reviewed),
none at 1, and 123 at 0: the species the research lists and nothing has made yet (a card to write for a plant; a mesh to
make for an animal, most with generated traits already). By kind at 0: 69 birds, 29 mammals, 5 amphibians, 4
invertebrates (the slugs), 6 trees, 6 shrubs, 3 forbs, 1 grass. 20 Olympic trait cards wait for the Hoh tiles to grow
them. Meshy: 420 of 1,000 credits spent; 107 animals queued across the tiles (~3,065 credits est.); nothing run.

| tile | plants 0/1/2/3/4 | animals 0/1/2/3/4 | trees / shrubs / ground with a model (target 21 / 23 / 26) | animals listed (target 22) | predators / scavengers | hand edits |
|---|---|---|---|---|---|---|
| utm10n_731_4235 Calaveras | 24/0/15/11/59 | 34/0/0/4/14 | 28 / 31 / 26 | 52 (18 with a model) | 19 / 10 | 57: 24 trait cards, 33 meshes |
| utm11n_267_4175 Yosemite | 22/0/22/12/59 | 40/0/0/3/14 | 35 / 31 / 27 | 57 (17) | 21 / 17 | 77: 22 cards, 39 meshes, 16 trait reviews |
| utm11n_270_4180 Yosemite | 22/0/22/12/59 | 36/0/0/3/14 | 35 / 31 / 27 | 53 (17) | 19 / 16 | 61: 22 cards, 35 meshes, 4 trait reviews |
| utm10n_540_4170 San Francisco | 18/0/15/11/60 | 68/0/0/5/13 | 26 / 33 / 27 | 86 (18) | 46 / 18 | 134: 18 cards, 1 community, 67 meshes, 48 trait reviews |
| utm10n_540_4180 San Francisco | 18/0/17/11/60 | 69/0/0/5/13 | 27 / 34 / 27 | 87 (18) | 48 / 19 | 92: 18 cards, 1 community, 68 meshes, 5 trait reviews |

Every tile meets the plant targets with modelled species; every tile lists more than 22 animals but models 17-18 of
them, so the animal target waits on meshes (Meshy credits, Aaron's call). The hand edits are what "grow a new tile
without many edits" measures: on Calaveras, a tile built only by the pipeline, 57, all of them a card or a mesh; no
community needed a rule and no code changed for the tile's species (the two bugs it found were fixed in the pipeline).

**What a fresh tile costs** (Calaveras, the first runs of each step): about 1.5 h of wall time, 53 min of it the lidar
step streaming 3.76 G points with 10 workers, 21 min Sentinel-2 (860 dates), 2.5 min GBIF; about 1 GB on disk (88 MB of
it raw-fetch cache); 75 MB a player downloads to enter it (the largest: lidar_micro 14 MB, terrain_detail 10 MB, the
ground texture 8 MB). A rebuild from the caches: 6 min, 30 MB of downloads (the Sentinel STAC search), 1,436 cache hits
against 26 misses. Its trait cards: ~12 k Claude tokens each; its animals: ~30 Meshy credits each.

## Next

- The global vegetation source (WorldCover + RESOLVE ecoregions) and a Sentinel-2 imagery step: the two gaps that stop
  a tile outside the US at `naip` and `landcover`.
- Grown age classes by default: a `growth` block on every card, so `tools/grow_species.mjs` grows each species' classes.
- With the water lane: meltwater from the ice's toes, streams continuous across a seam, elevation-aware riparian rows.
- forbs.js choosing a tile's 24 forbs by its ground layer; region-neutral habitat classes and resource rasters.
- Fungi: GBIF's fungi into the research (the kind is reserved), and an archetype to draw them.
- Cache keys for Overpass (the query) and the lidar index; games.json's build time out of its hash.
- The San Francisco cells' lidar re-streamed (`--force lidar`) so their crowns step can run.
