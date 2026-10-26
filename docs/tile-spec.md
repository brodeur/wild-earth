# Tile package spec

**Version 0.2.0.** A tile package is the contract between the three workstreams:
the pipeline writes it, the viewer inspects and edits it, the renderer consumes it.
Later it is the unit of exchange between federated nodes.

## Tile geometry

A tile is a square cell of a fixed grid, not a watershed. Watersheds (HUC12) are a
layer used for region naming and privacy snapping; the data and render unit is square.

- Grid: UTM zone of the anchor point, 10 km cells aligned to easting/northing multiples
  of 10 000 m.
- `tile_id`: `utm<zone><hemi>_<easting_km>_<northing_km>` of the cell's south-west corner,
  e.g. `utm10n_690_4280` for E 690 000–700 000, N 4 280 000–4 290 000 in EPSG:32610.
- The anchor a player supplies is never stored. Only the snapped cell is.

## Worlds

A joinable world is a tile plus a season: `utm10n_680_4280/fall`. The package is the
same for all four; the season selects resource bands, calendar entries and the look.
Player state (nests, caches, dens, edits made in play) is keyed by world, not tile.
Whether state flows from one season's world to the next is an open decision.

Game state lives beside the package, not in it: a node that serves a world keeps the acorn
game's state in `tiles/<tile_id>/game/<season>.json` (a snapshot: taken acorns, stash and
granary counts, buried acorns, collectors, board, round) and `<season>.events.jsonl` (the
accepted events in order). It is runtime data of that node, not a pipeline product; its
shape is in [game-acorn-stash.md](game-acorn-stash.md) (v3).

## Layout

```
tiles/<tile_id>/
  manifest.json                 required
  terrain/dem.tif               required  bare-earth elevation, float32 m, GeoTIFF, tile CRS
  terrain/hillshade.png         derived   viewer convenience, same grid as dem
  terrain/terrain_rgb.png       derived   Mapbox Terrain-RGB encoding for 3D viewers
  imagery/naip.tif              optional  present-day RGB orthoimagery ("real" layer)
  imagery/naip.png              derived   viewer convenience
  footprint/mask.geojson        required  human footprint features to erase and backfill
  footprint/mask.png            derived   rasterised mask, 0/255, same grid as dem
  hydro/flowlines.geojson       required  stream network
  hydro/waterbodies.geojson     required  lakes, ponds, reservoirs
  hydro/channels.geojson        derived   stream channels routed by gravity on the DEM, named and classed by NHD (see Channels); rewilded once hydrology_rewilded
  hydro/channels_present.geojson derived  the present-day routing, kept by the rewild step to judge against (see Hydrology rewilding)
  hydro/human_water.geojson     derived   every waterbody judged: human (rewilded: true) or kept, with the reasons and evidence
  hydro/osm_water.geojson       derived   OSM water polygons, dams and NID dam points (Overpass cache for the rewild step)
  terrain/dem_rewilded.tif      derived   dem.tif with the restored thalwegs carved through rewilded beds (routing only; dem.tif untouched)
  terrain/dem_1m.tif            optional  lidar step: 3DEP 1 m bare-earth DEM cut to the tile, float32 m NAVD88; pipeline only (see Lidar)
  terrain/dsm_1m.tif            optional  lidar step: highest point-cloud return per 1 m cell (first-return surface), float32; pipeline only
  terrain/lidar_dtm_check.tif   optional  lidar step: point-cloud ground minus dem_1m, 10 m mean, float32
  terrain/roughness_10m.tif     optional  lidar step: std of dem_1m about a quadratic per 10 m cell, float32 m (feeds the outcrop likelihood)
  terrain/lidar_stats.json      optional  lidar step: the run's point counts, timings and checks
  vegetation/chm_1m.tif         optional  lidar step: canopy height model, uint16 cm; pipeline only
  vegetation/canopy_height_10m.tif optional lidar step: p95 canopy height m, tree cover % (>= 4 m), shrub cover % (0.5-4 m), 10 m
  vegetation/evt.tif            required  LANDFIRE Existing Vegetation Type (what grows now), 30 m
  vegetation/evc.tif            required  LANDFIRE Existing Vegetation Cover (percent, coded)
  vegetation/evh.tif            optional  LANDFIRE Existing Vegetation Height (coded)
  vegetation/bps.tif            required  LANDFIRE Biophysical Settings (what would grow)
  vegetation/habitat_present.tif required habitat class per pixel from EVT (human pixels = 9)
  vegetation/habitat.tif        required  habitat class with human pixels backfilled from BpS
  vegetation/classes.json       required  code tables for the codes present, incl. habitat mapping
  vegetation/habitat.png        derived   RGBA habitat for viewers; habitat_present.png likewise
  geology/units.geojson         optional  bedrock map units clipped to the tile: name, lithology, age, rock_class, source, licence (see Geology and soils)
  geology/classes.json          optional  unit index -> name, lithology, age, rock_class; rock class rules and resistances; which source was used
  soils/mapunits.geojson        optional  SSURGO map unit polygons with dominant-component texture, fragments, depth to bedrock, parent material
  soils/classes.json            optional  soil map unit index -> mukey, name and those attributes, plus the rules used
  terrain/rewilded.png          derived   hillshade shaded by rewilded habitat color
  resources/<resource>.tif      required  0-100 score, 4 bands = winter, spring, summer, fall, 30 m
  resources/<resource>_<season>.png derived RGBA for viewers
  resources/resources.json      required  resource list, tables used, png paths, mean scores
  client/heights.png            derived   Terrain-RGB heights on the metric tile grid (no warp)
  client/texture.png            derived   rewilded texture on the metric tile grid
  client/habitat.png            derived   habitat class code in R, 30 m grid
  client/canopy.png             derived   tree / shrub / herb cover percent in R / G / B, 30 m grid
  client/roads.png              derived   decayed-road weight, 8-bit on the DEM grid: 255 pavement, verge falls to 0
  client/mast.png               derived   fall acorn_mast score 0..100 in R, 30 m grid (from resources/acorn_mast.tif band 4; optional)
  client/geology.png            derived   R geology unit index (geology/classes.json), G rock class index (1-based), 30 m grid
  client/soils.png              derived   R soil map unit index, G surface rock fragments % 0-100, B depth to bedrock dm (255 none/unknown), 30 m grid
  client/outcrop.png            derived   outcrop likelihood 0-255 in R, 30 m grid (formula in the manifest layer)
  client/ground_classes.json    derived   rock classes, unit and map unit tables for the two PNGs, per-tile fractions, outcrop summary
  client/texture_imagery.jpg    derived   NAIP with the human footprint erased and pavement bleached, 4000 px (2.5 m) JPEG
  client/texture_present.jpg    derived   present-day NAIP as captured, same 4000 px metric grid as texture_imagery, JPEG q88
  client/imagery.png            derived   present-day NAIP for the mini-map, 1024 px on the metric tile grid
  client/features.json          derived   present-day roads, streams (from hydro/channels.geojson when built) and waterbodies in tile-local metres
  client/channel_depth.png      derived   channel incision, uint8 decimetres on the DEM grid: mean DEM on a 20 m ring minus the channel cell, 0-25 m; 0 off channel
  client/channel_profile.png    derived   RGB on the DEM grid: R thalweg water depth (2 cm), G riffle-pool index, B rewilded water beds (see Hydrology rewilding)
  client/terrain_detail.png     derived   2 m micro-relief: 8-bit grey residual of the 1 m DEM against client/heights.png, (v - 128) x 4 cm (see Lidar)
  client/trees_lidar.bin        derived   lidar tree crowns: position, height, crown radius, confidence; 100 m cell index (see Lidar)
  client/canopy_height.png      derived   10 m RGB: R p95 canopy height (0.25 m), G tree cover %, B shrub cover % (see Lidar)
  client/masks.png              derived   soft season-recolour weights: R grassland, G oak woodland, B chaparral
  client/species_mix_index.png  derived   row index per 30 m cell into species_mix.json mixes (0 = none), 8-bit grey (see Species mix)
  client/species_mix_density.png derived  RGB per 30 m cell: R tree_density, G shrub_density (multiplier = byte / 100), B 0
  client/species_mix.json       derived   format 2: species columns, EVT/BpS name -> species mix rows with their weights, per-tile fractions
  client/species_prior.json     derived   animal density prior per species, a byte per 100 m cell, from CC0 and CC BY occurrence records only (see Species)
  unreal/heightmap.png          derived   16-bit Landscape heightmap at a valid size (2017 px)
  unreal/weights/<class>.png    derived   8-bit weight-blended layer per habitat class
  unreal/canopy_<kind>.png      derived   8-bit tree / shrub / herb cover for PCG density
  unreal/unreal.json            derived   Landscape scale, actor Z, component layout, layer list
  species/species.json          required  species list with roles, senses, sources
  species/occurrences.geojson   required  occurrence points for listed species; pipeline and viewer only (`for_clients: false`)
  species/seasonal.json         derived   per-species counts by month (phenology proxy); counts every record, so `for_clients: false`
  perception.json               required  who perceives whom
  calendar.json                 required  species x season activities and resources
```

All GeoJSON is WGS84 (EPSG:4326) per RFC 7946. All rasters are in the tile CRS and
share the DEM grid unless the manifest says otherwise.

## manifest.json

```json
{
  "spec_version": "0.1.0",
  "tile_id": "utm10n_690_4280",
  "crs": "EPSG:32610",
  "bounds": [690000, 4280000, 700000, 4290000],
  "bounds_wgs84": [west, south, east, north],
  "size_m": 10000,
  "generated_at": "2026-10-22T00:00:00Z",
  "generator": {"name": "wild-earth-pipeline", "version": "0.1.0"},
  "status": {
    "human_landforms_removed": false,
    "hydrology_rewilded": false,
    "vegetation_backfilled": true,
    "projection_years": 0
  },
  "layers": {
    "terrain.dem": {"path": "terrain/dem.tif", "kind": "raster", "resolution_m": 5,
                    "units": "m", "nodata": -9999, "source": "usgs_3dep", "sha256": "..."},
    "footprint.mask": {"path": "footprint/mask.geojson", "kind": "vector",
                       "source": "osm", "feature_count": 1234}
  },
  "sources": {
    "usgs_3dep": {"name": "USGS 3D Elevation Program", "url": "...",
                  "license": "public domain", "license_url": "https://www.usgs.gov/...",
                  "attribution": "Elevation: U.S. Geological Survey, 3D Elevation Program (3DEP)",
                  "attribution_url": "https://www.usgs.gov/3d-elevation-program",
                  "attribution_required": false, "retrieved": "2026-10-22"},
    "osm": {"name": "OpenStreetMap via Overpass API", "url": "...",
            "license": "ODbL 1.0", "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
            "attribution": "© OpenStreetMap contributors",
            "attribution_url": "https://www.openstreetmap.org/copyright",
            "attribution_required": true, "retrieved": "2026-10-22"}
  },
  "edits": []
}
```

`status` is honest about what the tile is. A tile with `projection_years: 0` and
`human_landforms_removed: false` is present-day terrain with a footprint mask; that is
the v0 target. `edits` is an append-only log of viewer edits (mask polygons drawn by
hand, species flags) so local knowledge survives a pipeline re-run. `sources` is described
under Sources and attribution.

A layer with `for_clients: false` (and a `for_clients_note` saying why) must not be fetched
by a game client or copied into anything distributed: today `species.occurrences` and
`species.seasonal`, whose records and counts include CC BY-NC ones. The viewer, a local
review tool, may read them. A client reads the `client.*` layers, which are built from
data a client may carry.

## Sources and attribution

Every entry in the manifest's `sources` carries the licence and the credit a display must
show:

```
  name                  what the data are and how they were reached
  url                   the endpoint the pipeline read
  license               the licence or terms, as text
  license_url           the licence text or the publisher's terms
  attribution           the exact credit line to display, verbatim
  attribution_url       the link the credit line carries
  attribution_required  true when the licence makes showing the line a condition of use
                        (ODbL, CC BY); false for public-domain data whose publisher asks
                        for a credit but cannot require one
  retrieved             date fetched (YYYY-MM-DD)
```

**The rule.** A client, a viewer, and any derived work (a screenshot, video, exported map,
the Unreal export, a published texture or dataset) must show the `attribution` line of
every source with `attribution_required: true` whose data went into what is shown or
distributed, linked to `attribution_url` wherever the medium allows links (print the URL
where it does not). In an interactive client the required lines are one step from the main
view: an always-visible "Data" or credits link opening a panel built from
`manifest.sources`, not a page somewhere else. The panel should list the other sources'
lines too (they cost nothing and the publishers ask for them), each with its licence name
linked to `license_url`. Show the lines as written; do not shorten or merge them.

Per source:

- **OpenStreetMap** (`osm`, ODbL 1.0): "© OpenStreetMap contributors" linked to
  openstreetmap.org/copyright. Anything rendered from OSM (the game view, the ghost roads,
  the mini-map) is a Produced Work and needs only that line. The OSM-derived layers
  themselves (`footprint/mask.geojson`, `client/roads.png`, `client/features.json`) are
  Derivative Databases: distributed apart from the rendering, they are under ODbL
  (share-alike) and must carry the same notice.
- **Macrostrat** (`macrostrat`, CC BY 4.0): CC BY asks for the credit, the licence link and
  a note of changes, so the line says the units were clipped and reclassified. Macrostrat
  asks that the original maps be cited too: each unit in `geology/units.geojson` carries its
  original map in `reference`, which a geology info panel shows.
- **GBIF** (`gbif`): licences are per record (`license` and `dataset`, a GBIF dataset key
  resolving at `https://www.gbif.org/dataset/<key>`, in `species/occurrences.geojson`).
  CC BY records require attribution; the line credits GBIF.org and the contributing
  datasets, and the per-record dataset keys carry the rest. CC BY-NC records stay in the
  tile package as evidence for density models and the local-knowledge review and are not
  shipped to a game client (decision log, 2026-10-23): `species.occurrences` is marked
  `for_clients: false`, and the client's density prior (`client/species_prior.json`) is
  built from CC0 and CC BY records only, its layer recording the records used per licence
  and the records left out. The prior lists the GBIF datasets it used, which the credits
  panel links. A commercial derived work must leave the NC records out. Before a public release, register the records used as a GBIF derived
  dataset to get a citable DOI, and add it to the line.
- **Public domain** (USGS 3DEP, NHDPlus HR, SGMC; USDA NAIP, SSURGO; LANDFIRE): no credit
  is required. The lines follow each publisher's requested citation (USGS credit
  guidance, LANDFIRE's citation model, the NRCS SSURGO citation) and are shown anyway.

`python -m pipeline.audit_licenses` fails when a source lacks any of these fields, when a
licence that requires attribution (ODbL, CC BY) is not marked `attribution_required: true`,
when a required line or its link is empty, or when a layer's `source` or `sources_used`
names a source the manifest does not list. It warns when a manifest's lines differ from
the pipeline's registry (`pipeline.config.all_sources()`). Tiles built before these fields
existed are patched in place by `tools/patch_attribution.py`, which inserts the fields
after `license` and changes nothing else; `--refresh` rewrites lines that have since
changed in the registry. A new source is registered in `SOURCES` with every field;
`build_tile` refuses to record one without them.


## Footprint mask

Features carry `class` from this list, so the renderer knows what to backfill with:
`building`, `road`, `rail`, `power`, `canal`, `mine`, `reservoir`, `agriculture`,
`cleared`, `other`. OSM supplies the first few. `mine`, `canal`, `agriculture` and
`cleared` are expected to come largely from hand-drawn edits in the viewer; the
foothills carry hydraulic mining scars, ditches and orchard terraces that bare-earth
lidar does not remove.

In client products roads are decayed, not erased: `client/roads.png` and the baked
`client/texture.png` keep them as treeless strips of worn pavement (paths, footways,
cycleways, bridleways and steps excluded; tracks at half weight), so players keep their landmarks.

## Channels

NHD says roughly where the streams are; the DEM says where water goes. `hydro/channels.geojson`
is the stream network routed by gravity on the 5 m bare-earth DEM (`pipeline/channels.py`, build
step `channels`): depressions at least 1 m deep outside mapped waterbodies are breached along the
least-cost path to lower ground (lidar sees a road embankment over a culvert as a dam), the rest
filled with the tile border as the outlet, flats resolved, D8 flow directions and accumulation,
with the upstream area of creeks entering the tile seeded where NHD flowlines cross its edge.
Cells draining 0.15 km² or more are channels; reaches run between heads and junctions, carry
Strahler order on that network, and are lightly smoothed. NHD supplies names and permanence: a
reach takes the `gnis_name` and `fcode` of the NHD flowlines within 60 m running the same way;
unmatched reaches are ephemeral (46007), or intermittent (46003) from 2 km². NHD stretches with no
DEM channel nearby but with the DEM draining at least the threshold there are kept with `source:
"nhd"`. Every feature carries `name`, `fcode`, `order`, `area_km2`, `source` (`dem` or `nhd`),
`width` (water, m, 1.6 · A^0.45 clamped 1-30) and `bed_width` (1.5 · width + 1), and
`in_waterbody` for pieces inside a waterbody ring (drawn as the pond, not as a channel). The
manifest layer `hydro.channels` records the parameters and match statistics, including the median
lateral offset between DEM channels and the NHD lines they matched.

Once the tile is rewilded (next section) the channels step reads `hydro/human_water.geojson`: the
rewilded waterbodies are no longer held as ponds (so their beds and dams are breached like any
other depression, and the reach through them is not `in_waterbody`), routing runs on
`terrain/dem_rewilded.tif`, NHD artificial paths (55800) through them cast no permanence votes,
the breach limit comes from the file (`breach_max_m`, 300 m by default), and the stats gain a
per-waterbody `rewild_check` (breaches, water still held on the carved thalweg and in the bed).
The FeatureCollection carries `"rewilded": true|false`.

## Hydrology rewilding

Build step `rewild_hydro` (`pipeline/rewild_hydro.py`, after `channels`) takes out the water
people made and restores the creeks under it. `status.hydrology_rewilded` is true once it has run.

Judging. Every NHD waterbody, and every OSM water polygon not already in NHD, is either human or
kept. Human: NHD FType 436 (reservoir); OSM `water=reservoir|basin|wastewater|...` or
`landuse=reservoir|basin` on an overlapping polygon (from `footprint/mask.geojson` and the Overpass
cache `hydro/osm_water.geojson`); an OSM dam line within 25 m or a National Inventory of Dams point
(`waterway=dam` node with `ref:US:NID`) within 80 m of the ring; or a pond under 1.5 ha with a dam
in the DEM: its ring straight at the outlet (at least 12 m, RMS off the line under 0.12 of its
length) and the ground 15-45 m beyond the outlet at least 1.5 m below the water. The outlet is
where the biggest present-day routed channel leaves the ring, or for a pond off the network (fed by
a swale under 0.15 km²) where the ground outside it is lowest. On a creek draining 5 km² or more
the test is stricter (RMS 0.08, 2 m), so the wide spots of real creeks stay. Everything else is
kept: ponds with no channel and no dam, irregular ponds, uncertain cases. The judging always uses
the present-day routing (`hydro/channels_present.geojson`, snapshotted the first time the step
sees a present-day `channels.geojson`), so a rerun reaches the same verdicts.
`hydro/human_water.geojson` holds every waterbody with `rewilded`, `kind` (`reservoir`,
`stock_pond`, `pond`, `natural`), `reasons` and `evidence` (level, outlet, drop, crest, edge
length and RMS, channel area and class, overlapping OSM features), plus the carve and breach
results.

Restoring. The lakebed is the lidar's hydro-flattened water surface. Through each bed with a
channel the step carves a thalweg into `terrain/dem_rewilded.tif`: the least-cost path over the bed
from each inflow to the outlet, cost step x (1 + 30 / (2 + distance to the old shore in m)), so it
runs down the middle of the flat; lowered to the old level (the bed's 20th percentile) minus a cut
of 0.2 m at the farthest inflow growing to 1.2 m at the outlet, one 5 m cell wide; then on past the
outlet down the present-day outflow at the same grade (at least 0.5%) until the ground falls below
the thalweg's end, so no spillway sill or dam crest is left. Cells are only ever lowered. The
channels step then routes on that copy. `manifest.layers["hydro.human_water"]` lists each
rewilded waterbody (id, name, kind, area, centroid, bbox, reasons, carve, breach) and each kept
one with its reason, the rule, counts, the total area and the breach limit used (and any widening,
which happens only when more than a quarter of a carved thalweg still holds 0.3 m of water after
routing, and is undone if it does not help). `terrain.dem_rewilded` records the cells lowered and
the deepest cut.

Creek depth. `client/channel_profile.png` (RGB, DEM grid, row 0 north): along every channel, every
2.5 m, the DEM's long profile on the rewilded DEM, made non-increasing downstream, smoothed over
max(7.5 m, 2.5 water widths) for the local slope and over max(75 m, 10 widths) for the reach slope;
t = tanh(1.1 ln((S_local + 0.002) / (S_reach + 0.002))) is the riffle-pool index (+1 riffle, -1
pool), and the thalweg depth is 0.10 A^0.32 m (A km²) x exp(-0.85 t): about 2.3 times the reach
mean in the deepest pools, 0.43 times on riffles. R is that depth in 2 cm units (0-5.1 m, at least 1
on a channel), G is 127.5 (t + 1) (local width = reach width x (1 + 0.15 t)), both spread to 4 px
(20 m) from the centreline so a lookup anywhere on a drawn ribbon finds its thalweg value; at a
confluence the larger stream wins. Features shorter than about 15 m are below the 5 m DEM's
resolution: small creeks' pools and riffles are the larger steps and flats of their profile.

Rewilded water. B is 255 on a former reservoir or stock-pond bed (now a meadow or wet flat), 160
on the riparian corridor within 12 m of the restored channel through it, 0 elsewhere. This is the
hook for vegetation and ground: a bed (255) should take the backfilled habitat's grassland or wet
meadow (sedges, rushes, scattered valley oak at the edge) and the corridor (160) riparian (willow,
alder, cottonwood), and the imagery erase should synthesize meadow over the photo's water there.

Who reads it. On the 30 m vegetation grid (`habitat.rewilded_cells`) a cell is corridor where the
160 band covers 20% of it, and meadow where the bed covers half of it and LANDFIRE has it as water,
barren or human, or where it is LANDFIRE water with 15% of bed (the old shoreline cells); cells
LANDFIRE already sees as vegetation (the willow and oak fringe on the old shore) keep their class.
`veg` writes meadow cells as grassland (5; there is no wet-meadow class) and corridor cells as
riparian (6) into `habitat.tif` (`layers["vegetation.habitat"].rewilded_beds` has the counts);
`derive` gives those whose EVC is not vegetation a cover of 0/0/75% (meadow) and 40/20/55%
(corridor; tree/shrub/herb) in `client/canopy.png`; `species_mix` gives them their own rows,
`rewilded_meadow` (blue oak 0.85 standing in for valley oak, live oak 0.15, no shrubs; the client's
savanna rule sets about one oak per two cells) and `rewilded_riparian` (the tile's `riparian` rule:
live oak 0.7, blue oak 0.15, ponderosa 0.15; the library has no willow, alder or cottonwood). `erase`
leaves the beds (grown 5 m over the mudline) out of the human pass and synthesizes them after it:
the bed from grassland windows lit like the clean grassland within 250 m (900 m fallback), then the
corridor from riparian windows over that meadow (`layers["client.texture_imagery"].rewilded_beds`).
The client marks the matched rings `rewilded` (`tilepackage.markRewilded`, the same bbox match as
water.js), so `WaterMask` and the pond-shore stones leave them out and trees, grass and rocks grow on
the bed; it loads B as `tile.rewild`, keeps a corridor cell's trees to the 160 band (85% of those on
the open bed beside it are skipped), and gives `rewilded_meadow` cells a lower annual-grass share
(0.4: perennial bunchgrass, a wet meadow).

Client. `water.js` skips the rewilded rings (matched to `client/features.json` by bounding-box
overlap with the manifest list), draws the restored channel as an ordinary reach, loads
`client/channel_profile.png` after the tile, and colours the water by depth (warm gravel through
shallow riffle water with broken white water on the steepest, a dark column in the pools). It
exposes `depthAt(x, north, {anySeason})` (water depth in metres: ponds holding water this season,
level over the drawn ground; creeks running this season, thalweg depth across a parabolic section
of the drawn ribbon; 0 elsewhere) and `rewildAt(x, north)` (B), both as methods of the `Water`
object and as module functions.

## Geology and soils

Rocks come from data, not slope and noise (build step `ground`, after `veg`). Bedrock units come
from the Macrostrat API (`geologic_units/map`, point queries sampled on a 5 x 5 grid and then at
every uncovered part of the tile until it is covered), at the finest Burwell scale that answers
everywhere in the tile, preferring the USGS State Geologic Map Compilation (Macrostrat source 133);
if Macrostrat fails, the SGMC feature service is queried directly. In the Sierra foothills the
finest available map is Jennings 2010, 1:750 000, so contacts are generalised to a few hundred
metres. Each unit gets one rock class by keyword rules over its major lithologies, then its name,
then its description (`pipeline/fetch_geology.py`): `greenstone_metavolcanic`, `serpentinite`,
`slate_phyllite`, `schist`, `granitic`, `volcanic`, `sandstone_conglomerate`, `limestone_marble`,
`alluvium`, `other`. Volcanic rocks Jurassic or older (bottom age >= 145 Ma) are counted as
metavolcanic.

Soils are SSURGO from USDA Soil Data Access: one SQL request per table for the map units
intersecting the tile, polygons clipped server-side. Each map unit takes its dominant component
(highest `comppct_r`): taxonomic order and subgroup, surface texture (first mineral horizon,
litter skipped), surface rock fragments (`chfrags.fragvol_r` summed; 100 for rock land and rock
outcrop), depth to bedrock (shallowest lithic or paralithic restriction, else the deepest horizon
with `bedrock_restriction: false`), parent material, slope and drainage. `rock_outcrop_pct` (the
map unit's Rock outcrop components) is recorded too but is not yet used.

`client/outcrop.png` is resistance by rock class (greenstone 0.9, granitic and serpentinite 0.8,
volcanic and limestone 0.7, schist and slate 0.6, sandstone and other 0.4, alluvium 0) times
shallowness (1 at <= 25 cm to bedrock, 0 at >= 150 cm) times terrain (slope / 35 degrees capped
at 1, plus 0.5 times convexity, the 30 m cell's height above its 150 m neighbourhood over 1.5 m)
times (1 - tree cover / 100 x 0.5), times 0.5 + min(lidar roughness / 0.12 m, 1.5) on a tile with
the lidar step (see Lidar), clipped to 0..1, and 0 on water. The manifest layer
`client.outcrop` records the formula and parameters. The client places boulders and outcrop
clusters from it, and takes gravel and dirt colour from the soil texture and fragments.
Geology polygons from SGMC are public domain (through Macrostrat, CC-BY 4.0); SSURGO is public domain.

## Lidar

Build step `lidar`, after `dem` (`pipeline/fetch_lidar.py`, `pipeline/lidar.py`; laspy with the lazrs
backend, `pipeline/requirements-lidar.txt`). It is long (the point cloud streams for about half an hour
per tile), so `python -m pipeline.lidar --tile <id>` runs it without holding the manifest and
`build_tile --steps lidar` then records the layers. A tile with it has `status.lidar: true`.

**Sources.** Both from AWS public buckets over HTTPS, public domain (USGS), credited as `usgs_3dep_1m`
and `usgs_3dep_lpc`:

- The 3DEP standard 1 m DEM (`prd-tnm/StagedProducts/Elevation/1m/Projects/<project>/TIFF/`), one file
  per 10 km UTM cell, named `USGS_1M_<zone>_x<west / 10 km>y<north / 10 km>_<project>.tif`, so a tile
  is exactly one file (plus a 6 m apron). Projects covering the tile come from the TNM Access API, or,
  when it fails, a listing of the bucket and one HEAD per project; the newest collection (metadata end
  date) wins. `terrain.dem_1m` records the project, collection dates and the others that cover it.
- The 3DEP point cloud as Entwine Point Tiles (`usgs-lidar-public/<project>/ept.json`, EPSG:3857
  octree of LAZ chunks), the project matched to the DEM's by name stem and overlap. Every node
  overlapping the tile is read at full depth, decoded in memory (never written), noise (classes 7, 18)
  and withheld points dropped, and reduced to 1 m grids. Nothing raw is kept.

NAD83 UTM is taken as the tile's WGS 84 UTM (PROJ's default is a null shift); the point-cloud ground
check finds no horizontal offset at 1 m.

**Products.** CHM = DSM - (dem_1m + the median point-cloud ground offset), the DEM standing in for the
point-cloud ground because it has no gaps under dense canopy. Crowns: local maxima of the CHM (3x3
median, then gaussian sigma 1 m) in a square window of radius round(1 + 0.1 h) m (1-5 m), h >= 4 m;
height is the median CHM's 3x3 maximum; the crown is the watershed region down to half the peak and
its radius sqrt(area / pi), clipped to 0.5 .. min(2 + 0.35 h, 15) m. The source classifies only
ground, unclassified, water and noise, so houses are in the DSM: a maximum is dropped on an OSM
building, where under 8% of the returns around it are multi-return (a roof, a wire), where the crown
is narrower than max(1 m, 0.06 h) (a tower), and where it is under 8 m and under 2 m above its
surroundings (a taller shrub in chaparral). The manifest layer `client.trees_lidar` records the
method and confidence formula.

`client/trees_lidar.bin` (little-endian): a 32-byte header (`WECR`, u16 version 1, u16 record bytes 8,
u16 cells per side 100, u16 cell metres 100, u32 count, f32 xy unit 0.2, f32 height unit 0.25, f32
radius unit 0.1, u32 0), then u32 `offsets[100 * 100 + 1]` (the crowns of index cell ci = floor(x / 100),
cj = floor(north / 100) are records `offsets[cj * 100 + ci]` to `offsets[cj * 100 + ci + 1]`, tallest
first), then 8-byte records: u16 x, u16 north (tile metres = value x 0.2 + 0.1), u8 height (x 0.25 m),
u8 crown radius (x 0.1 m), u8 confidence (/ 255), u8 multi-return share (/ 255). A client loads the
cells near the player from the index; `pipeline.lidar.read_trees` decodes it.

`client/terrain_detail.png` is the micro-relief the 5 m grid cannot hold: the 1 m DEM averaged to 2 m
minus `client/heights.png` as the client decodes it, interpolated bilinearly between **its pixel
centres** (x = 5i + 2.5, north = 10000 - 5j - 2.5). 8-bit grey, residual m = (v - 128) x 0.04, clamped
to +-5.08 m (0.01% of pixels: quarry walls, road cuts); its own pixel centres are at x = 2i + 1, so a
texture lookup at uv = (x, north) / 10000 with linear filtering returns the residual directly. A
residual rather than a normal map, because it gives the fine mesh near the player its geometry (and
ground contact for placed things) and normals follow from four taps; linear 8-bit rather than a 16-bit
R/G split because it filters in hardware and is half the size (9 MB against 22 MB).

`terrain/roughness_10m.tif` is the std of the 1 m DEM about a least-squares quadratic within each 10 m
cell (slope and curvature removed): boulders, outcrop steps, cut banks. The ground step multiplies the
outcrop likelihood by 0.5 + min(roughness / 0.12 m, 1.5), averaged to 30 m (Geology and soils).

**Checks** (home tile, `terrain.lidar_dtm_check` and `terrain/lidar_stats.json`): point-cloud ground
against the 1 m DEM, median offset 0.00 m, std 0.04 m, best shift 0 m; the 1 m DEM against the 3DEP
1/3 arc-second (10 m) seamless DEM, mean difference 0.00 m, std 0.19 m after a 4 m registration shift
of the 10 m product, cells more than 1 m apart on ridge crests, canyon floors and road cuts.

## Habitat classes

`habitat.tif` collapses LANDFIRE into nine classes gameplay and rendering can reason
about: `oak_woodland`, `conifer_forest`, `mixed_forest`, `chaparral`, `grassland`,
`riparian`, `water`, `barren`, `human`. Rules live in `pipeline/habitat.py`. `human`
appears only in `habitat_present.tif`; in `habitat.tif` those pixels are replaced by
the Biophysical Settings class (BpS `human` or unknown falls back to grassland).
`status.vegetation_backfilled` is true once this has happened. The manifest records
`backfilled_fraction` so the size of the rewrite is visible.

## Imagery erasure

`client/texture_imagery.jpg` is the NAIP imagery with humans taken out, on the NAIP grid.
The erase mask is every footprint feature except roads, buffered by its `buffer_m` (plus
12 m around buildings for yards, driveways and lots), united with the `human` cells of
`habitat_present.tif` (lawns and lots OSM lacks), minus road pavement (`roads.png` > 140).
Human cells whose EVT physiognomy is Developed-Medium or High Intensity, Agricultural or
Quarries are erased whole. The others (Developed-Low Intensity, Developed-Roads, and
developed or urban forest, shrubland and herbaceous: a quarter to a third of a foothill tile, and
mostly real oaks and dry grass) are erased only where the photo looks built: neutral grey or
white pixels not in shade (roofs, concrete, asphalt, gravel), blue (pools) and irrigated
green, opened to drop specks and grown by one pixel.
Each connected component of the mask is either inpainted from its surroundings (OpenCV
Telea, with grain from the synthesized texture laid over it) when it is small or thin
(under 400 m², or never more than 5 m from its edge; Telea smears anything larger), or
synthesized: image quilting from 32 px windows of clean imagery elsewhere in the tile whose
majority class is the backfilled habitat class there, drawn from the 5% of that class's
windows closest in brightness to clean ground within 100 m (so savanna is filled from savanna,
not from dense stands lit up to match), chosen to agree with neighbouring pixels and that
local colour, and joined along minimum-error seams. Pavement
is desaturated and blended halfway to sun-bleached grey; the verge is left alone. The
layer records `mask_fraction`, `inpainted_fraction` and `synthesized_fraction`,
`human_cells` (`whole_fraction`, `partial_fraction`, `partial_erased_fraction`), plus
`grass_mean` and `oak_mean` (sRGB 0..1), the imagery's own summer colours, which the
client recolours by season relative to. `encoding` and the docs comparison crops name the NAIP
year from `imagery/naip.tif` (the `imagery.naip` layer's `naip_year`), and the layer's `source` is
the imagery's own. `status.imagery_erased` is true once this has run.

## Resources

Each resource named in `calendar.json` that is a map layer (not a prey species) has a
raster: `acorn_mast`, `grass_forbs`, `browse`, `cover`, `insects`, `cavity`,
`cliff_or_snag`, `burrow`, `water`. Scores are 0-100 per 30 m pixel per season, from a
base score by habitat class times a seasonal multiplier, adjusted by canopy cover
(cover, cavity), slope (cliff_or_snag) and distance to perennial or intermittent
water (water). `resources.json` carries the tables used so the viewer can show them
and a later version can tune them. `carrion` and `small_mammals` are entity classes,
resolved at run time from species, not rasters.

## Species

`species.json` is a list. Each entry:

```json
{
  "code": "urocyon_cinereoargenteus",
  "common": "gray fox",
  "scientific": "Urocyon cinereoargenteus",
  "gbif_key": 5219243,
  "group": "mammal",
  "role": "playable",
  "scale": "fox",
  "senses": {"vision": {"range_m": 300, "color": "dichromat"},
             "hearing": {"range_m": 400}, "smell": {"range_m": 600}},
  "sources": ["gbif"],
  "confidence": "unverified"
}
```

`role` is `playable` or `ambient`. `scale` is the LOD bucket (`insect`, `vole`,
`squirrel`, `fox`, `deer`, `bird`). `confidence` is `unverified`, `verified` or
`flagged`, set from the viewer.

**Density prior.** `client/species_prior.json` (layer `client.species_prior`, build step
`species_prior`, also run at the end of `species`; `pipeline/derive.py`) is what a client
knows of the records. Only records whose licence is CC0 or CC BY and that fall inside the
tile count. Per species: records per 100 m cell, summed over an 11 x 11 box (about 500 m
radius) to `d`; `w = round(255 d / (d + mean))`, `mean` the mean of the non-zero `d`;
stored as base64 bytes, `cells` x `cells` (100 x 100), row 0 the north edge. The client's
prior is `0.6 + 0.8 w / 255`: 0.6 where nobody recorded the species, up to 1.4 where many
did, a weak multiplier on habitat suitability because records follow observers. A species
with no usable record is not in the file and gets 1 (neutral). The file also carries
`licenses_used`, `records_used`, `records_excluded` (by licence), `records_outside` and
`datasets` (GBIF dataset key, licence, records); the manifest layer repeats the counts
per licence and per species.

## Species mix

`client/species_mix*` (pipeline `species_mix.py`, client `tilepackage.js` `SpeciesMix`) say which species grow
in each 30 m cell and how densely, for any number of species. Format 2 (2026-10-25):

- `species_mix_index.png`: the cell's row in `mixes` (1-based; 0 = no row: the client uses its fixed mix for
  the habitat class). 8-bit grey; a tile with more than 255 rows writes RGB with the row = R + 256 G and says
  `"cells": {"index_bytes": 2}`.
- `species_mix_density.png`: RGB, R tree density and G shrub density, each a multiplier = byte / 100 on the
  client's per-habitat-class plant count (1.0 = the fixed-mix count; the count still scales with
  `client/canopy.png` cover). B is 0. No alpha, so a 2D canvas reads it unchanged.
- `species_mix.json`:

```json
{
  "format": 2,
  "species": { "trees": ["quercus_douglasii", "quercus_wislizeni", "..."], "shrubs": ["arctostaphylos_viscida", "..."] },
  "cells": { "index": "client/species_mix_index.png", "index_bytes": 1, "density": "client/species_mix_density.png" },
  "mixes": [
    { "index": 1, "source": "evt", "code": 7027, "name": "Mediterranean California Dry-Mesic Mixed Conifer ...",
      "rule": "dry_mesic_mixed_conifer", "trees": { "pinus_ponderosa": 0.8, "quercus_wislizeni": 0.2 },
      "shrubs": { "arctostaphylos_viscida": 1 }, "tree_density": 1.0, "shrub_density": 0.6, "note": "...", "cells": 124,
      "tree_bytes": [["quercus_wislizeni", 51], ["pinus_ponderosa", 204]], "shrub_bytes": [["arctostaphylos_viscida", 255]],
      "density_bytes": [100, 60] }
  ],
  "unmatched": [], "fractions": { "tree_share": { "blue_oak": 0.43, "...": 0 } }
}
```

`species` lists the columns: canonical library ids, the original species first in their original order, then
any species a rule adds, appended. A row's `tree_bytes` and `shrub_bytes` hold the species with a non-zero
weight, in column order, each summing to 255 (largest remainder, ties to the earlier column; absent: no
trees or no shrubs in the row). The client draws a plant's species by walking that list in order with one
random number, so the order is part of the format: appending a column never moves an existing plant.
`density_bytes` repeats the row's densities (the density PNG holds them per cell). `trees`, `shrubs` and the
two densities as decimals are the rule as written, for people.

Format 1 (tiles built before 2026-10-25) had RGBA weight PNGs `species_mix_a/_b/_c.png` and `mixes[].bytes`
with a `bytes_layout` naming each column by short alias; the client still reads it (and the original eight
columns without `bytes_layout`), but the pipeline writes only format 2 and removes the old PNGs. The three
tiles were regenerated in format 2: every row's bytes and every plant's placement are identical.

## Species library

Plants are not in the package. A tile references plant species by id only (the same
lowercase scientific-name codes as `species.json`, e.g. `quercus_douglasii`), through
the habitat classes and species mixes, and never carries tree or shrub geometry, tree
lists or positions. The client grows every plant from that species' parameter file in
the shared library, `library/species/<id>.json`, placing it per 30 m cell with a seed
derived from the cell's coordinates, so every node renders the same tree in the same
place. A species written once is available to every tile and region that has it.
Parameter files are CC BY-SA 4.0 and are reviewed on the lineup page; the schema and
the review process are in [species-library.md](species-library.md).

## perception.json

```json
{
  "perceives": {
    "corvus_corax": ["corvus_corax", "buteo_jamaicensis", "sciurus_griseus", "..."]
  }
}
```

A species exists for a player only if it is in that player's list. Senses in
`species.json` set how far and in what color; this matrix sets what at all.

## calendar.json

Seasons are northern-hemisphere meteorological seasons and track the real calendar at
the tile's location. Activities are a small fixed set of verbs parameterised per
species, not bespoke mini-games:

`forage`, `cache`, `hunt`, `nest`, `den`, `court`, `rear`, `disperse`, `shelter`.

Resources are named layers or entity classes a verb needs:
`acorn_mast`, `grass_forbs`, `browse`, `carrion`, `small_mammals`, `insects`, `water`,
`cover`, `cavity`, `cliff_or_snag`, `burrow`, plus any species code (as prey).

```json
{
  "seasons": {"winter": [12, 1, 2], "spring": [3, 4, 5], "summer": [6, 7, 8], "fall": [9, 10, 11]},
  "activities": {
    "sciurus_griseus": {
      "fall": [{"activity": "cache", "resources": ["acorn_mast"]}]
    }
  }
}
```

## Client rasters

Game clients work in tile-local meters (x east, north from the south edge, elevation
up), so `client/` carries the same products on the unwarped tile grid. A client needs
nothing else from the package to render terrain and vegetation: heights, texture,
habitat class and canopy cover. Trees are not stored (on a tile without lidar); the client grows them from
habitat and canopy with a deterministic seed per 30 m cell, so every player sees the
same tree in the same place without the package carrying a tree list.

Every raster sample is a pixel centre: sample (i, j) of an n-pixel raster stands for x = (i + 0.5)
size / n, north = size - (j + 0.5) size / n, so a bilinear lookup is at x / res - 0.5 (a GPU texture
lookup at uv = (x, north) / size does the same). The web client (`client/src/tilepackage.js`
Heightfield) reads `heights.png` that way and, on a lidar tile, adds `terrain_detail.png` the same
way: `at(x, north)` is the 1 m ground every footing query uses, `base` the 5 m heights alone. Its far
terrain is a 10 m mesh of `base`; within 110 m of the player (a square on the 10 m lattice, rebuilt
when the player strays 10 m) a 2 m mesh of `at` on the residual's own pixel centres, its outer 20 m
eased to the 10 m surface and its edge on the 10 m mesh's vertices, so the seam is closed;
`ground(x, north)` is the surface drawn this frame. `canopy_height.png` is loaded as `tile.canopyHeight`.

## Unreal export

`unreal/` is the same tile as an Unreal Engine 5 Landscape. The heightmap uses
Unreal's encoding (0-65535 spans -256..+256 m at Z scale 100), with the Z scale chosen
to fit the tile's relief and the actor's Z location carrying the mid elevation, so
`unreal.json` has every number the import dialog needs. Weight layers are one per
habitat class, soft-edged across 30 m cells and normalised to sum to 255. Nothing in
the package is engine-specific except this folder and `client/`.

## Versioning

`spec_version` is semver. A viewer or renderer refuses a tile whose major version it
does not know. Minor versions add optional layers or fields only.
