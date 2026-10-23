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
  vegetation/evt.tif            required  LANDFIRE Existing Vegetation Type (what grows now), 30 m
  vegetation/evc.tif            required  LANDFIRE Existing Vegetation Cover (percent, coded)
  vegetation/evh.tif            optional  LANDFIRE Existing Vegetation Height (coded)
  vegetation/bps.tif            required  LANDFIRE Biophysical Settings (what would grow)
  vegetation/habitat_present.tif required habitat class per pixel from EVT (human pixels = 9)
  vegetation/habitat.tif        required  habitat class with human pixels backfilled from BpS
  vegetation/classes.json       required  code tables for the codes present, incl. habitat mapping
  vegetation/habitat.png        derived   RGBA habitat for viewers; habitat_present.png likewise
  terrain/rewilded.png          derived   hillshade shaded by rewilded habitat color
  resources/<resource>.tif      required  0-100 score, 4 bands = winter, spring, summer, fall, 30 m
  resources/<resource>_<season>.png derived RGBA for viewers
  resources/resources.json      required  resource list, tables used, png paths, mean scores
  client/heights.png            derived   Terrain-RGB heights on the metric tile grid (no warp)
  client/texture.png            derived   rewilded texture on the metric tile grid
  client/habitat.png            derived   habitat class code in R, 30 m grid
  client/canopy.png             derived   tree / shrub / herb cover percent in R / G / B, 30 m grid
  unreal/heightmap.png          derived   16-bit Landscape heightmap at a valid size (2017 px)
  unreal/weights/<class>.png    derived   8-bit weight-blended layer per habitat class
  unreal/canopy_<kind>.png      derived   8-bit tree / shrub / herb cover for PCG density
  unreal/unreal.json            derived   Landscape scale, actor Z, component layout, layer list
  species/species.json          required  species list with roles, senses, sources
  species/occurrences.geojson   required  occurrence points for listed species
  species/seasonal.json         derived   per-species counts by month (phenology proxy)
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
                  "license": "public domain", "retrieved": "2026-10-22"}
  },
  "edits": []
}
```

`status` is honest about what the tile is. A tile with `projection_years: 0` and
`human_landforms_removed: false` is present-day terrain with a footprint mask; that is
the v0 target. `edits` is an append-only log of viewer edits (mask polygons drawn by
hand, species flags) so local knowledge survives a pipeline re-run.

## Footprint mask

Features carry `class` from this list, so the renderer knows what to backfill with:
`building`, `road`, `rail`, `power`, `canal`, `mine`, `reservoir`, `agriculture`,
`cleared`, `other`. OSM supplies the first few. `mine`, `canal`, `agriculture` and
`cleared` are expected to come largely from hand-drawn edits in the viewer; the
foothills carry hydraulic mining scars, ditches and orchard terraces that bare-earth
lidar does not remove.

## Habitat classes

`habitat.tif` collapses LANDFIRE into nine classes gameplay and rendering can reason
about: `oak_woodland`, `conifer_forest`, `mixed_forest`, `chaparral`, `grassland`,
`riparian`, `water`, `barren`, `human`. Rules live in `pipeline/habitat.py`. `human`
appears only in `habitat_present.tif`; in `habitat.tif` those pixels are replaced by
the Biophysical Settings class (BpS `human` or unknown falls back to grassland).
`status.vegetation_backfilled` is true once this has happened. The manifest records
`backfilled_fraction` so the size of the rewrite is visible.

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
habitat class and canopy cover. Trees are not stored; the client grows them from
habitat and canopy with a deterministic seed per 30 m cell, so every player sees the
same tree in the same place without the package carrying a tree list.

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
