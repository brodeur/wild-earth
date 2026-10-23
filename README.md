# Wild Earth

A federated MMO set in the real world as it would be with no humans, played as animals.
This repository is the proof of concept for one tile: the Sierra foothills cell that
contains Placerville, CA.

Three workstreams share one contract, the [tile package spec](docs/tile-spec.md):

| Workstream | Where | Status |
|---|---|---|
| Dataset pipeline | `pipeline/` | fetches terrain, imagery, footprint, hydrology, species for a tile |
| Admin/viewer | `viewer/` | 2D/3D inspection, perception filter, season calendar, verify/flag |
| Client | `client/` | first playable slice: fly the tile as a raven in three.js |
| Renderer | (Unreal, later) | the browser client stands in for now |

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install rasterio numpy pyproj shapely requests pillow
```

Build the tile that contains an anchor point. The anchor is snapped to a 10 km UTM
grid cell and not stored anywhere:

```bash
.venv/bin/python -m pipeline.build_tile --anchor -120.7985 38.7296
```

Re-run single steps for an existing tile:

```bash
.venv/bin/python -m pipeline.build_tile --tile utm10n_690_4280 --steps species,derive
```

Serve the repo root and open the viewer:

```bash
python3 -m http.server 8781 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8781/viewer/> for the admin viewer, or
<http://127.0.0.1:8781/client/?tile=utm10n_680_4280> to fly the tile as a raven.

## The client

`client/` is a three.js app with no build step. It reads a tile package's `client/`
rasters and builds a 10 m terrain mesh, a vegetation-shaded texture that recolors grass
and oaks by season, a physically placed sun for the tile's latitude, and a forest of
procedural trees grown per 30 m cell from habitat class and canopy cover: blue oak,
interior live oak, gray pine, ponderosa pine, manzanita and chamise, each a parameter
set in `client/src/trees.js`. Trees are seeded by cell coordinates, so they are the same
for everyone. Flight is first person: arrows to pitch and turn, W/S for speed, space to
flap, gliding sinks slowly. Season follows today's date unless overridden; the sun
follows the time slider. No animals yet beyond the player.

## What the pipeline produces

`tiles/<tile_id>/` holds a tile package as described in the spec. Sources:

- Terrain: USGS 3DEP bare-earth DEM. The USGS ImageServer (1 m lidar exists for this tile)
  is tried first in 500 px chips; when it times out, the 10 m seamless DEM from Microsoft
  Planetary Computer is used. The manifest records which one a tile got.
- Imagery: NAIP 2022 at 2.5 m via Microsoft Planetary Computer, USGS NAIP Plus as fallback.
- Human footprint: OpenStreetMap buildings, roads, rail, power, canals, quarries,
  reservoirs, agriculture via Overpass. This is the erase-and-backfill mask.
- Hydrology: NHDPlus HR flowlines and waterbodies, with reservoirs flagged.
- Vegetation: LANDFIRE LF 2025 existing vegetation type, cover and height plus LF 2016
  Biophysical Settings from the LANDFIRE image services (synchronous, fast). Collapsed
  into nine habitat classes; human pixels are backfilled from Biophysical Settings.
  In the home tile that rewrites a quarter of the land, mostly back to blue oak woodland.
- Resources: per-season 0-100 rasters for every map resource the activity calendar
  names (acorn mast, grass and forbs, browse, cover, insects, cavities, cliffs and
  snags, burrows, water), from habitat class, canopy cover, slope and water proximity.
- Species: GBIF occurrences for the ten demo species (GBIF carries iNaturalist and
  eBird records), monthly counts as a phenology proxy, and an inventory of the most
  recorded birds and mammals in the tile.
- Perception matrix and seasonal activity calendar are curated in
  `pipeline/species_data.py` and written into the package.

Large rasters are git-ignored and regenerated; the manifest and vector layers are
committed.

## What is honest about v0

The manifest's `status` says so: landforms and hydrology are present-day, the
projection is zero years. Vegetation is backfilled, so the "rewilded" texture in the
viewer is a real map, but the footprint mask is not yet erased from the terrain.
Resource scores are first-guess tables, meant to be tuned in the viewer. Species records are occurrences, not densities. The viewer's verify/flag buttons
keep edits in the browser and export them as JSON; appending them to the manifest's
`edits` log is the next step for the local-knowledge workflow.

## Next

1. Erase masked landforms from the DEM (vegetation backfill is done).
2. Density surfaces per species from CWHR habitat suitability, then the +10 year delta.
3. Hand-drawn mask polygons in the viewer (mining scars, ditches, terraces).
4. Animals: rigged glTF models for the demo species, driven by the activity calendar,
   with the perception matrix deciding who is rendered for whom.
5. Unreal import of `terrain/dem.tif` as a Landscape with PCG scattering, when fidelity
   beyond the browser is needed.
