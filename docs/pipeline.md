# The tile pipeline

How a tile is built from nothing, the same way every time, anywhere a source reaches; and how its species are
found, looked up and grown. Written 2026-11-04 from an audit of `pipeline/` and every tile's manifest.

Aaron's brief (2026-11-04): "When we create a new tile, we need to be going through all the steps, and making sure
the steps are repeatable so that we can accurately depict a tile anywhere on earth. When we create a new tile, we need
to generate all of the species for that tile if they don't already exist... a registry of species... which species
have been created and what level of fidelity that asset is at."

## One command

    python -m pipeline.build_tile --tile utm10n_731_4235 --all         # everything, in order; current steps skipped
    python -m pipeline.build_tile --anchor -120.30 38.28 --all          # the 10 km cell holding a point
    python -m pipeline.build_tile --tile <id> --plan                    # what --all would run, and why
    python -m pipeline.build_tile --tile <id> --all --force derive      # a step whatever its state (and re-fetch)
    python -m pipeline.build_tile --tile <id> --status                  # per step: ran, missing, stale
    python -m pipeline.build_tile --tile <id> --adopt                   # a tile built before the graph, as its baseline
    python -m pipeline.build_tile --tile <id> --all --out /tmp/x        # into another tiles folder (WILD_EARTH_TILES)
    python -m pipeline.registry                                         # library/registry.json from what exists

Run Python as `arch -arm64 .venv/bin/python` on this Mac (pyproj). `--steps a,b` still runs named steps whatever
their state (the dev server's build API uses it, one step per call).

## The step graph (pipeline/steps.py)

Each step declares its version, the modules whose code it runs, the steps whose outputs it reads (`after`), the
sources it fetches and when it does not apply. The order below is a valid order of the graph (`_check_graph` asserts
it at import).

| step | after | writes (manifest layers) | sources (licence) | where they reach / fallback |
|---|---|---|---|---|
| dem | | terrain.dem (5 m) | USGS 3DEP ImageServer (PD) | US; then Planetary Computer 3DEP seamless 10 m (PD); then **NASADEM 30 m (NASA, no restrictions), global 60 N-56 S, implemented** |
| naip | | imagery.naip (2.5 m) | Planetary Computer NAIP (PD), USGS NAIP Plus (PD) | CONUS only; outside: fails loudly. Next: Sentinel-2 true colour |
| osm | | footprint.mask | Overpass, three mirrors (ODbL) | global |
| hydro | | hydro.flowlines, hydro.waterbodies | NHDPlus HR (PD) | CONUS, HI, PR; fetch_hydro's own OSM fallback (recorded as a fallback); owner: water lane |
| channels | dem, hydro | hydro.channels, client.channel_depth | | gravity routing on the DEM, global; owner: water lane |
| rewild_hydro | dem, channels, hydro, osm | hydro.human_water, terrain.dem_rewilded, client.channel_profile, client.features | Overpass water and dams, Overpass places, Native Land | owner: water lane |
| veg | rewild_hydro | vegetation.evt/evc/evh/bps, habitat, habitat_present, classes | LANDFIRE 2025 / BpS 2016 (PD) | CONUS (the _CONUS services); outside: fails loudly. Next: ESA WorldCover + RESOLVE ecoregions |
| lidar | dem, osm, veg | terrain.dem_1m, vegetation.chm_1m, client.trees_lidar, client.terrain_detail, client.lidar_micro, ... | 3DEP 1 m DEM products and EPT point clouds (PD) | US, where flown; DEM-only from the 1 m products without a point cloud; **not applicable** outside the US (the 5 m base DEM carries the terrain) |
| water | dem, rewild_hydro, hydro, lidar | terrain.dem_banked, client.water, client.heights, hydro.water_reaches | | owner: water lane (pipeline/water.py, unchanged here) |
| ground | dem, veg, lidar | geology.*, soils.*, client.geology, client.soils, client.outcrop, client.ground_classes | Macrostrat (CC BY 4.0), USGS SGMC (PD), USDA SDA SSURGO (PD) | geology global (Macrostrat); soils US only. Next: SoilGrids 2.0 (CC BY 4.0) |
| species | dem, veg | species.list/occurrences/seasonal/inventory, perception, calendar, locomotion, client.species_prior | GBIF (per record CC0 / CC BY / CC BY-NC) | global |
| plants | veg, species | species.plant_needs (+ library records grown) | GBIF (cached) | global |
| derive | dem, naip, osm, hydro, channels, rewild_hydro, water, veg, species, plants | the client rasters, client.species_mix, resources, games, client.features | Overpass places, Native Land | |
| crowns | lidar, osm, veg, derive | client.trees_lidar | | not applicable without a canopy height model |
| erase | naip, osm, veg, derive, rewild_hydro | client.texture_imagery | | |
| substrate | ground, water, dem, lidar, naip, veg, erase, derive | client.substrate, client.substrate_classes | | |
| inpaint | erase, lidar, crowns, derive | client.texture_ground, client.texture_ground_mask | | not applicable without a canopy height model |
| seasons | veg, lidar, naip | seasons.s2_monthly, client.season_rgb, client.season_ndvi | Sentinel-2 L2A via Planetary Computer, Earth Search fallback (Copernicus terms, credit) | global |
| weather | | client.weather | Open-Meteo ERA5 (CC BY 4.0) | global |
| unreal | dem, veg | unreal | | |
| registry | species, plants, derive | species.registry | | |
| audit | every step | licence_audit in the manifest | | |

What the graph fixes against the old step list (`ALL_STEPS` ran dem, lidar, naip, osm, hydro, channels, rewild_hydro,
water, veg, ground, substrate, species, derive, crowns, erase, inpaint, seasons, weather, unreal, with a failed step
logged and the next one run anyway):

- `substrate` ran before `derive` and `erase` but prefers their outputs (client/habitat.png, texture_imagery.jpg); on
  a one-pass build it read raw NAIP, where roofs and roads are grey rock. It now runs after both.
- `lidar` found its crowns before `osm`, `veg` and `derive` existed; it now runs after osm and veg, and `crowns` (which
  the five lidar tiles never ran through build_tile) runs after derive.
- `derive` wrote client/mast.png from resources/acorn_mast.tif, which it wrote later in the same step: a fresh tile
  needed derive twice. It now writes the rasters again when the mast is missing.
- `derive` logged ok and wrote nothing without its inputs (Yosemite, 2026-10-28 03:15); it now fails, naming them.
- `water` rewrote client/species_mix.json without re-recording the layer (its sha256 went stale on 267_4175); the step
  wrapper re-records it.
- `crowns` and `inpaint` decided from layer names in the manifest and logged "ok" when they skipped; they are now
  `not_applicable` with the reason, decided by the file on disk.
- A failed step stops the build (exit 1); `--keep-going` runs the steps that do not depend on it.
- `audit` (the licence audit, `audit_licenses.py`) was a separate command; it is the build's last step and fails the
  build on a missing credit or a client layer marked `for_clients: false`.

## Repeatable: fingerprints, versions, sources, fallbacks

Before a step runs: `fingerprint = sha256(version, the hash of its modules' code, its parameters, every upstream step's
output hash, the library folders it reads)`. The step is skipped when its last record has the same fingerprint and
every output it recorded is still on disk with the same hash (a file two steps write, client/heights.png or
terrain_detail.png, is checked only by the last writer). A step whose outputs come out the same leaves its dependents
current, so a code change re-runs exactly the part of the graph it reaches. File hashes are cached per tile in
`_cache/hashes.json` by size and mtime.

The manifest's `steps` holds per step: `version`, `code`, `params`, `fingerprint` and the `parts` it was made of,
`layers`, `outputs` (file -> sha256 prefix), `out_hash`, `sources` (each with the date it was retrieved), `fallbacks`
(see below), `notes`, `fetched` (network reads and cache hits), `status` (ok, not_applicable, failed, blocked, adopted,
stale), `coverage` (sources that do not reach the tile), `ran_at`, `seconds`, and `owner` where the step's code is
another lane's. The old `log` list is still appended.

Fallbacks are written where they happen (`pipeline/runlog.py`): `runlog.fallback("...")` from inside a fetch module
lands in the step's record. Recorded today: the Planetary Computer DEM after a USGS failure and NASADEM after both, the
USGS NAIP chips after a Planetary Computer failure, a LANDFIRE export answered on a later try, the DEM-only lidar
products (and a tile kept DEM-only by an earlier run), an EPT point cloud chosen over another that only overlapped by
its box, NHD replaced by OSM, Macrostrat replaced by SGMC, a Sentinel provider replaced or dates left out, places and
territories skipped.

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

## Anywhere on Earth (pipeline/regions.py)

`regions.COVERAGE` names, for every source, the region it serves and the global source that stands in. A step whose
source does not reach the tile records the gap in `coverage`; the source's own answer still decides at run time.

| needed | US source | global stand-in | state |
|---|---|---|---|
| bare-earth DEM | 3DEP (1 m lidar, 10 m seamless) | NASADEM 1" (30 m, 60 N-56 S; NASA, no restrictions) | **implemented** (`fetch_dem`, also the last fallback inside the US) |
| point cloud | 3DEP EPT | none open | the lidar step is not applicable; the 5 m DEM carries the terrain |
| imagery | NAIP | Sentinel-2 L2A true colour, 10 m (Copernicus terms: free, credit) | next: the seasons step already composes it; the erase step needs a 10 m variant |
| streams | NHDPlus HR | channels.py already routes on the DEM; names and permanence from OSM waterways (ODbL, a source already); HydroRIVERS (CC BY 4.0) for large rivers | partly: fetch_hydro falls back to OSM |
| communities | LANDFIRE EVT/BpS | ESA WorldCover 2021 10 m (CC BY 4.0) for the classes and cover, RESOLVE Ecoregions 2017 (CC BY 4.0) for the community; species_mix rules keyed on ecoregion and class | next (the largest gap) |
| soils | SSURGO | SoilGrids 2.0 250 m (CC BY 4.0) | next |
| geology | Macrostrat (global) | | done |
| species, weather, seasons, OSM | global already | | done |

Copernicus GLO-30 was not used: its licence is its own (free, credit required), not CC.

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

## Species: needs, the registry and fidelity

### What a tile needs (pipeline/needs.py, the plants step)

The species a tile needs are every species that its LANDFIRE communities name (`pipeline/communities.py` LEXICON reads
"Mediterranean California Red Fir Forest" as red fir, "California Coastal Closed-Cone Conifer Forest" as Monterey pine,
Monterey cypress and bishop pine), every species the matching species-mix rule weights, every plant GBIF has 10 or more
records of on the tile that the library, a trait card or the lexicon knows, and the species placed by their records
(giant sequoia in its groves: `species/localized.json`, CC0 and CC BY records only). A community the lexicon cannot read
and no rule matches is listed as `unread`: the cue to extend the lexicon for a new region.

For each need: a library record, or a trait card (`library/plant_cards/<id>.json`) from which the step grows the record
now (`pipeline/plantgen.py`: the card's heights, crown outline, leaf and bark colours by season, habitat and relations
on the branching of a template species of the same genus or family; free, automatic, re-embedded into treegen.js), or
neither, in which case it is queued for a card and the species mix draws its stand-in (`communities.stand_in`: the
card's own stand-in, else the same genus, else the same family and leaf type). The species mix records every
substitution (`species_mix.json` `substitutions`).

### The registry (pipeline/registry.py, library/registry.json, tiles/<id>/species/registry.json)

Built by scanning, never by hand: the plant records and cards, the animal entries (mesh tiers, source, Meshy job and
credits, rig and clips, the leg engine read from the GLB's `extras.skin.legs`), the voices in `client/src/sound.js`, the
behaviour tables in `species_data.py`, the plants' `relations` (a herbivore's diet), the locomotion tree, the playable
bodies, and every tile's species mix, presence table, needs and GBIF inventory. Keyed by scientific name.

Fidelity:

| level | plants (trees, shrubs; ground plants alike) | animals |
|---|---|---|
| 0 none | no record: a stand-in species is drawn in its place | not drawn |
| 1 stand-in look | a record generated with only its own size and colour on the template's form | drawn with another species' mesh |
| 2 own model | its own crown, branching and foliage (hand-written, or generated with its own outline or leaf; a generated record stays at 2 until it is reviewed in the lineup and the card carries a `review`) | its own mesh, not animated |
| 3 grown / rigged | three or more age classes and four seasons' colours (impostors are baked by the client for every tree and shrub) | rigged and animated (part rig, skin and clips, or client code) |
| 4 full | habitat and relations (where it stands, who eats it) | behaviour (senses, a diet, a calendar) and a voice |

Meshy is never run by the build: animals GBIF records on a tile with no library entry are queued in the tile report and
in `library/registry.json` `meshy.queued`, with an estimate (a "latest" preview 20 credits and a refine 10; rigging by
our own tools) and whether it fits what is left of the 1,000 credits (420 spent, from the jobs' `job.json`). Past the
budget is Aaron's call.

## Proof

Filled in by the 2026-11-04 entry in docs/decisions.md: the rebuild of an existing tile into a scratch folder and its
diff against the committed tile, and the first tile built by `--all` alone (Calaveras Big Trees, `utm10n_731_4235`).

## Next

- The global vegetation source (WorldCover + RESOLVE ecoregions) and a Sentinel-2 imagery step: the two gaps that stop
  a tile outside the US at `naip` and `veg`.
- The riparian zone rows (water lane) and the ground layer (grasses and forbs) are still foothill-only: Yosemite's high
  streams draw alder and cottonwood (the elevation zones do not reach the zone rows), its meadows foothill annuals.
- Elevation zones are set for the central Sierra (37-38 N); a latitude shift (about 100 m per degree) belongs in them.
- Cache keys for Overpass (the query) and the lidar index (`--force` should clear it).
- NHD caching in fetch_hydro (water lane's file).
