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
python3 -m venv .venv && .venv/bin/pip install rasterio numpy pyproj shapely requests pillow opencv-python-headless && .venv/bin/pip install -r pipeline/requirements-hydro.txt -r pipeline/requirements-ground.txt
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
The same server hosts the acorn game's shared world: press Start game in two browsers on
the same tile and season (add `&seat=2` to the second URL to be a second player in one
browser) and both play in one world (`docs/game-acorn-stash.md`, v3).

## The client

`client/` is a three.js app with no build step. The raven model (`client/assets/raven.glb`)
is "Raven" by Teh_Bucket on OpenGameArt, CC0, re-exported from Blender with a glide clip.
The player raven (`client/assets/raven_player.glb`) was generated with Meshy (meshy.ai) on the account holder's paid plan (job 01a171aa, a level glide), owned by the account holder and released under CC BY-SA 4.0, and rebuilt by `tools/build_raven_player.py` (wings split at shoulder and wrist, three tiers, fly and glide clips); the CC0 OpenGameArt raven stays as the fallback (`?raven=old`).
The deer model (`client/assets/deer.glb`) is Deer by Quaternius, Ultimate Animated Animal Pack,
CC0, via Poly Pizza (<https://poly.pizza/m/T6Cs7tmMHJ>), rebuilt by `tools/build_deer.py`.
The California scrub-jay, California quail and western gray squirrel (`client/assets/scrubjay.glb`,
`quail.glb`, `squirrel.glb`) were generated with Meshy (meshy.ai) on the account holder's paid plan,
owned by the account holder and released under CC BY-SA 4.0, and rebuilt by `tools/build_scrubjay.py`,
`build_quail.py` and `build_squirrel.py` (job ids and prompts in each script's header).
The soaring red-tailed hawk and turkey vulture and the Steller's jay (`client/assets/redtail.glb`,
`vulture.glb`, `stellersjay.glb`) were generated with Meshy (meshy.ai) on the same terms, owned by the
account holder and released under CC BY-SA 4.0, and rebuilt by `tools/build_redtail.py`, `build_vulture.py`
and `build_stellersjay.py` (job ids and prompts in each script's header).
Gray fox (client/assets/fox.glb): "Fox" by Quaternius, Ultimate Animated Animal Pack, CC0 1.0, https://poly.pizza/m/Bc97C66HKi, reshaped and recoloured by tools/build_fox.py.
Coyote (coyote.glb): "Wolf" by Quaternius, Ultimate Animated Animal Pack, CC0 1.0, https://poly.pizza/m/P1gU3Qkr9r, tools/build_coyote.py.
Brush rabbit (rabbit.glb): "Rabbit" by Čestmír Dammer (CDmir), CC0, https://opengameart.org/content/rabbit-0, tools/build_rabbit.py.
Black-tailed buck (deer_buck.glb): "Deer" by Quaternius, CC0 1.0, https://poly.pizza/m/T6Cs7tmMHJ, procedural antlers, tools/build_deer.py --buck.
Mountain lion (cougar.glb): generated with Meshy (meshy.ai), task 01a171bb-8cae-7690-a80d-04545b70957e, CC BY-SA 4.0, tools/build_cougar.py.
California vole (vole.glb): generated with Meshy, task 01a171bc-b285-71cb-9e16-dc06982a34e4, CC BY-SA 4.0, tools/build_vole.py.
Review pages: `client/lineup.html` (trees) and `client/lineup_animals.html` (animal meshes at true size against a 1 m pole, with tiers, poses, metrics against the briefs and a local sign-off; see [docs/animal-library.md](docs/animal-library.md#lineup-page)).
The client reads a tile package's `client/`
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
The air is one shared atmosphere: height haze that fades distant ridges into the sky's own horizon colour (thickest in summer, clearest in winter, glowing toward a low sun), a sun that warms and dims toward the horizon with exposure to match, and drifting clouds whose shadows cross the terrain and trees.
Roads are decayed, not erased: ten years on they are linear clearings of cracked grey pavement with grass in the seams and a thinning verge, so US 50 still reads from the air; G toggles a ghost overlay of present-day roads with names on the major ones.
The default ground is the Imagery texture: NAIP 2022 with buildings, lots, lawns and fields erased (thin features inpainted, towns synthesized from real imagery of the backfilled habitat class) and pavement bleached, recoloured by season; Rewilded switches to the habitat-colour texture.
A mini-map (M to toggle, click to fly there) shows present-day NAIP imagery, roads and streams by design: the rewilded world laid against the real one.
Hold P (or the panel's Present day button; a tap toggles it on touch screens) to peek at the present day at the exact same spot: the ground cross-fades to 2022 NAIP with the human footprint still in it, the forest and grass step aside, the ghost roads come on and the mini-map swaps to the rewilded texture; the HUD's "today" row always names the nearest present-day road, stream or lake.

The first game is the acorn stash ([design](docs/game-acorn-stash.md)), opt-in with **Start game** in the panel (or `?game=1`). Oaks within 300 m carry acorns, more where the tile's fall acorn_mast score (`client/mast.png`) is high, and about one oak in eight has a stash hole on its trunk. Acorns glow as you close in from about 60 m; fly within 6 m to pick one up (you carry up to 3). After the first pickup stash holes glow blue-white; fly within 6 m of one to deposit, one acorn per beat, until it shows `capacity / capacity` and stops glowing. There are no new keys: it is all flying. Everything about an oak is hashed from its id, so every player finds the same acorns and holes, and picks and stash contents persist per world (tile and season) in the browser's localStorage.

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

## Credits

Icons: [Lucide](https://lucide.dev) (ISC licence). Ground detail textures are CC0 scans from [Poly Haven](https://polyhaven.com), credited in client/assets/ground/ATTRIBUTION.md. Data sources are listed per tile in
each manifest and in the tile spec.
