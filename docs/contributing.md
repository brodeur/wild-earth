# Contributing local knowledge

Wild Earth is only as true as the people who know each place make it. If you live in or
know a tile, here is how what you know gets into it. Everything you add goes into the
tile's `edits` log (`tiles/<tile_id>/manifest.json`), which is append-only and survives
pipeline re-runs. See [tile-spec.md](tile-spec.md) for the format.

## Open the viewer

```
.venv/bin/python server.py
```

Then open `http://localhost:8781/viewer/?tile=<tile_id>`. The badge under **Species**
says **saved to server** when edits go straight to the manifest. Opened any other way
(static files, no `server.py`), it says **this browser only**: edits are kept in the
browser and offered as **Send N browser edits to server** the next time you open the
viewer through `server.py`, or can be exported as `edits.json` and attached to a pull
request.

## What you can add

- **Verify or flag a species.** In the species list, ✓ means "this lives here", ⚑ means
  "wrong, or missing something". Add a short note saying why.
- **Draw mask polygons.** OSM knows roads and buildings. It does not know the hydraulic
  mining scars, ditches and flumes, orchard terraces and old clearings that bare-earth
  lidar keeps. Under **Mask polygons**, press **Draw mask polygon**, click around the
  feature, double-click (or **Finish**) to close it, choose a class (`mine`, `canal`,
  `agriculture`, `cleared`, `other`) and add a note if it helps. Backspace removes the
  last vertex, Esc cancels. It works in 3D too: clicks land on the terrain. Your polygons
  show with a dashed white outline, apart from the OSM footprint.
- **Write species notes.** Under **Species note**, pick an animal recorded in the tile or
  a plant from the species library and write what you know about it there: "blue oaks here
  drop acorns in late September", "gray pines on the south slopes only".
- **Review species parameter files.** Plants are drawn from the parameter files in
  `library/species/`. Open `client/lineup.html` and compare each species with the trees
  you know, across seasons. Sign off or say what is wrong as described under Review in
  [species-library.md](species-library.md).

Every edit appears under **Edit log** with its time. Clicking a polygon's row zooms to
it. The log is append-only: to correct something, add a new edit; the latest verify or
flag for a species wins.

## Adding a data source

A new source is registered in the pipeline's `SOURCES` (`pipeline/config.py`, or the fetch
module that uses it) with `license`, `license_url`, `attribution` (the exact credit line to
display), `attribution_url` and `attribution_required` (true when the licence makes the
credit a condition, as ODbL and CC BY do). `build_tile` refuses to record a source without
them, and `.venv/bin/python -m pipeline.audit_licenses` must pass before the tile is
committed. Use the publisher's own requested citation where it gives one. Data under a
non-commercial licence are not shipped to a game client. See Sources and attribution in
[tile-spec.md](tile-spec.md).

## Privacy

Edits are public and committed with the tile. Do not mark or describe where anyone
lives: no home locations, no addresses, no names of private people, no "my place". The
same rule applies to the player's own anchor, which Wild Earth never stores (see
[brief.md](brief.md)). Describe the land, not the people on it. Mark sensitive sites
(nests, dens, rare plants, cultural sites) with care, or leave them out.
