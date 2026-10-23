# Wild Earth

A federated MMO set in the real world as it would be with no humans, played as animals.
This repository is the proof of concept for one tile: the Sierra foothills cell that
contains Placerville, CA.

Three workstreams share one contract, the [tile package spec](docs/tile-spec.md):

| Workstream | Where | Status |
|---|---|---|
| Dataset pipeline | `pipeline/` | fetches terrain, imagery, footprint, hydrology, species for a tile |
| Admin/viewer | `viewer/` | 2D/3D inspection, perception filter, season calendar, verify/flag |
| Renderer | (Unreal, later) | the viewer's 3D terrain mode stands in for now |

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

Then open <http://127.0.0.1:8781/viewer/>.

## What the pipeline produces

`tiles/<tile_id>/` holds a tile package as described in the spec. Sources:

- Terrain: USGS 3DEP bare-earth DEM. The USGS ImageServer (1 m lidar exists for this tile)
  is tried first in 500 px chips; when it times out, the 10 m seamless DEM from Microsoft
  Planetary Computer is used. The manifest records which one a tile got.
- Imagery: NAIP 2022 at 2.5 m via Microsoft Planetary Computer, USGS NAIP Plus as fallback.
- Human footprint: OpenStreetMap buildings, roads, rail, power, canals, quarries,
  reservoirs, agriculture via Overpass. This is the erase-and-backfill mask.
- Hydrology: NHDPlus HR flowlines and waterbodies, with reservoirs flagged.
- Species: GBIF occurrences for the ten demo species (GBIF carries iNaturalist and
  eBird records), monthly counts as a phenology proxy, and an inventory of the most
  recorded birds and mammals in the tile.
- Perception matrix and seasonal activity calendar are curated in
  `pipeline/species_data.py` and written into the package.

Large rasters are git-ignored and regenerated; the manifest and vector layers are
committed.

## What is honest about v0

The manifest's `status` says so: landforms and hydrology are present-day, the
projection is zero years. The footprint mask marks what to erase; nothing is erased
yet. Species records are occurrences, not densities. The viewer's verify/flag buttons
keep edits in the browser and export them as JSON; appending them to the manifest's
`edits` log is the next step for the local-knowledge workflow.

## Next

1. Erase and backfill: remove masked landforms from the DEM, backfill vegetation from
   LANDFIRE Biophysical Settings.
2. Density surfaces per species from CWHR habitat suitability, then the +10 year delta.
3. Hand-drawn mask polygons in the viewer (mining scars, ditches, terraces).
4. Unreal import of `terrain/dem.tif` as a Landscape with PCG scattering.
