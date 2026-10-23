# Roadmap

Kept current at each commit. Done is a record; Next is in order; Then is agreed but not
sequenced; Parked is in the brief but deliberately not started.

## Done

- Tile package spec 0.2.0 (`docs/tile-spec.md`).
- Pipeline: terrain, imagery, footprint mask, hydrology, vegetation with backfill,
  seasonal resource rasters, species occurrences, client rasters, Unreal export.
- Two tiles built: `utm10n_690_4280` (Placerville) and `utm10n_680_4280` (home).
- Admin viewer: 2D/3D, three textures, habitat and resource layers, perception filter,
  season calendar, verify/flag edits exported as JSON, density grid, pipeline status.
- Client: fly the tile as a raven; 10 m terrain, season-recolored texture, latitude
  sun, procedural forest of six species, ~30k instances at 65 fps.

## Next: the visual pass, in order of effect per hour

1. Horizon: distant forest beyond the detail radius (impostors or a canopy pass) so the
   tree line never ends.
2. Ground: blend habitat boundaries, near-camera instanced grass, colour variation
   within a class.
3. Atmosphere: haze by distance and time of day, warmer low sun, cloud shadows.
4. Wind: vertex sway in canopies and grass, stronger on ridges.
5. Water: streams and ponds from the hydrology layer, with reflection.
6. Life: a circling hawk and a deer herd as placeholder motion, filtered by the
   perception matrix.

Then judge the result against the "beautiful enough" bar and decide whether the
browser stays the renderer.

## Then

- First animals with behaviour from the activity calendar; perception matrix decides
  who is rendered for whom.
- The forage-and-cache loop (raven in fall, squirrels as competitors) as the first
  test of play.
- Species density surfaces from CWHR habitat suitability; then the +10-year delta.
- Erase masked landforms from the DEM (vegetation backfill is done; terrain is not).
- Hand-drawn mask polygons in the viewer (mining scars, ditches, terraces) and
  appending viewer edits to the manifest's `edits` log.
- Ground-truth the footprint mask on foot with the viewer on a phone.
- Neighbouring tiles side by side in the viewer and client.
- Test the Unreal import on a real install.

## Parked (in the brief, not started)

- Federation protocol between nodes.
- Crowdfunding, matching pool, invites.
- CARE-aligned governance for community-held knowledge.
- Insect scale and the full progressive LOD system.
- Pre-dam channel reconstruction (no large reservoirs in either tile so far).
- Sound.
