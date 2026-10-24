# Wild Earth

A federated MMO set in the real world as it would be with no humans, played as animals.
This repository is the proof of concept, currently two tiles in the Sierra foothills
around Placerville, CA. The goal is in [docs/brief.md](docs/brief.md).

Three workstreams share one contract, the [tile package spec](docs/tile-spec.md):

| Workstream | Where | Status |
|---|---|---|
| Dataset pipeline | `pipeline/` | fetches terrain, imagery, footprint, hydrology, species for a tile |
| Admin/viewer | `viewer/` | 2D/3D inspection, perception filter, season calendar, verify/flag |
| Client | `client/` | first playable slice: fly the tile as a raven in three.js |
| Renderer | (Unreal, later) | the browser client stands in for now |

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install rasterio numpy pyproj shapely requests pillow opencv-python-headless
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

Run the dev server (static files from the repo root plus a small tile API):

```bash
.venv/bin/python server.py --port 8781 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8781/viewer/> for the admin viewer, or
<http://127.0.0.1:8781/client/?tile=utm10n_680_4280> to fly the tile as a raven.
The API answers which tile holds a point (`POST /api/tile {lon, lat}`) and builds a missing
one in the background (`POST /api/build`, progress at `GET /api/build/<tile_id>`); the
client's Location box uses it to fly, switch tiles, or build. Points are snapped to a tile
and never logged or stored.

## The client

`client/` is a three.js app with no build step. It reads a tile package's `client/`
rasters and builds a 10 m terrain mesh, a vegetation-shaded texture that recolors grass
and oaks by season, a physically placed sun for the tile's latitude, and a forest of
procedural trees grown per 30 m cell from habitat class and canopy cover: blue oak,
interior live oak, gray pine, ponderosa pine, manzanita and chamise, each a parameter
set in `client/src/trees.js`. Trees are seeded by cell coordinates, so they are the same
for everyone. Flight is first person: arrows to pitch and turn, W/S for speed, X/Z to climb or
descend, space to flap, gliding sinks slowly. Season follows today's date unless overridden; the sun
follows the time slider. Beyond the near forest, every forested 30 m cell carries two
impostor clusters so the tree line runs to the tile edge; grass tufts sway near the
camera. No animals yet beyond the player.
Roads are decayed, not erased: ten years on they are linear clearings of cracked grey pavement with grass in the seams and a thinning verge, so US 50 still reads from the air; G toggles a ghost overlay of present-day roads with names on the major ones.
The default ground is the Imagery texture: NAIP 2022 with buildings, lots, lawns and fields erased (thin features inpainted, towns synthesized from real imagery of the backfilled habitat class) and pavement bleached, recoloured by season; Rewilded switches to the habitat-colour texture.
A mini-map (M to toggle, click to fly there) shows present-day NAIP imagery, roads and streams by design: the rewilded world laid against the real one.

`pipeline.audit_licenses` counts occurrence records by license per tile; see the
decision log for what the numbers mean.

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

## Unreal Engine import

Every tile also exports as an Unreal Landscape (`pipeline.build_tile --steps unreal`,
run by default). In `tiles/<id>/unreal/`:

1. Create a Landscape, choose Import from File, pick `heightmap.png`.
2. Set Section Size 63x63 quads, Sections per Component 1x1, Number of Components
   32x32 for the 2017 px export (`unreal.json` lists these).
3. Set the Landscape scale to the X, Y, Z values in `unreal.json` and the actor's Z
   location to `actor_location_cm.z`.
4. Add a weight-blended Layer Info for each file in `weights/` and import them as layers.
5. Feed `canopy_tree.png` and the weight layers to a PCG graph for vegetation density
   and species mix.

Unreal is not required to produce the export; it is written by the pipeline alone.

## What is honest about v0

The manifest's `status` says so: landforms and hydrology are present-day, the
projection is zero years. Vegetation is backfilled, so the "rewilded" texture in the
viewer is a real map, but the footprint mask is not yet erased from the terrain.
Resource scores are first-guess tables, meant to be tuned in the viewer. Species records are occurrences, not densities. The viewer's verify/flag buttons
keep edits in the browser and export them as JSON; appending them to the manifest's
`edits` log is the next step for the local-knowledge workflow.

## Where things stand

- [docs/brief.md](docs/brief.md): the goal.
- [docs/decisions.md](docs/decisions.md): what was decided, what was rejected, and why.
- [docs/roadmap.md](docs/roadmap.md): done, next in order, then, parked. Kept current at
  each commit.
