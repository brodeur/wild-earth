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
  sun, procedural forest of six species, ~30k instances at 65 fps; X/Z altitude keys;
  mini-map of present-day imagery, roads, streams and the raven's trail (M toggles,
  click to fly there); lat/long location box with a dev server build API; decayed
  roads (worn pavement, no trees on it) and a G-key ghost overlay with names;
  third-person chase camera on a CC0 rigged raven with flap and glide clips (V
  toggles first person).

- First game, 2026-10-24: the acorn stash (`docs/game-acorn-stash.md`): glowing acorns
  on oaks, proximity pickup (carry three), stash holes revealed on first pickup with
  current / capacity labels, a screen-constant acorn marker over full stashes, state
  saved per world (tile plus season) in the browser. Flight gained hover (H and a
  button), S slows to a stop then reverses, and slower pitch and bank settling.

- Species library, 2026-10-24: parametric trees from per-species parameter files
  (`library/species/`, Weber-Penn style generator, Hallé architectural model per
  species, two levels of detail, far foliage as leaf cards), six foothill species as
  agent drafts awaiting local sign-off, and a lineup review page (`client/lineup.html`).
  Start view went from ~38 to ~50-60 fps. Weak: chaparral reads far too sparse (shrub
  counts were tuned for blobs), ponderosa limbs too straight, leaf cards alias under
  5 m, no wind in canopies yet.

- Overnight 2026-10-24/25 (Aaron asleep, standing authorization): present-day peek (P)
  with place names; pipeline present-day texture, LANDFIRE species mix per cell, acorn
  woodpecker and scrub-jay; local-knowledge edits saved to the manifest from the viewer
  (verify/flag, mask polygons, species notes) with a contributing guide and a fix for
  builds dropping edits; a synthesised soundscape (wind, wingbeats, raven call,
  habitat birds, stream, crickets); grass and chaparral for the third-person camera
  (shells, shrub field, ground wind); horizon silhouettes as one baked impostor per
  real tree. Each verified in the browser and pushed separately.

- Daytime 2026-10-24/25: streams routed by gravity on the lidar DEM with NHD names
  and permanence; geology and soils step with an outcrop likelihood; near-ground
  detail layer (CC0 thatch, litter, gravel, rock, pavement chosen per pixel from
  data); pines with needle bundles, blue oak dense again, foliage set per square metre
  of crown so big trees are as full as small ones. Weak: sunlit ponderosa at 20-60 m
  still partly lobed (needs light through needles); needles under 3 m soft; the north
  edge of the home tile's photo is smeared.

## Next: the visual pass, in order of effect per hour

1. ~~Horizon~~ done 2026-10-23: two crossed-quad impostors with a canopy cap per
   30 m forested cell across the whole tile, fading where the near forest begins.
2. ~~Ground~~ done 2026-10-23: habitat colour upsampled bilinearly, darkened by canopy,
   broken with value noise; soft season masks; 2 m detail noise in the shader; grass
   tufts within 220 m. Still to do: cloud shadows and distance haze (step 3).
   Imagery base done 2026-10-24: NAIP as the default texture with the human footprint
   inpainted (thin) or synthesized from same-habitat pixels (large); highways and
   county roads stay as bleached pavement, minor streets fade to faint traces. Open
   blemishes: small unmapped structures and tank pads survive, baked tree shadows,
   the Placerville airport runway (aeroway is not a footprint class yet).
3. ~~Atmosphere~~ done 2026-10-24: aerial perspective fitted to the sky dome each
   frame (warm toward the sun, blue-grey away), haze by season and sun elevation,
   exposure by sky brightness, procedural cumulus with shadows cast along the sun
   ray, one tone-mapped lighting pipeline for all materials. Open: clouds repeat
   every 2.5 km, no cast shadows from terrain or trees, summer noon ground is bright.
   Grass done 2026-10-24: procedural blade clumps up close (wild oat, bromes,
   medusahead over purple needlegrass), seed heads and awns, wind with gusts, backlight,
   season palettes and heights, tuft cards to 250 m, 3 draw calls, ~2.6 ms at ground
   level and ~0 at altitude. Weak: from 10-40 m up the grass reads as stubble and the
   ground texture carries it; a mid-height grass impression (denser tufts or a shaded
   ground cover) is a follow-up.
4. Wind: vertex sway in canopies (grass has it), stronger on ridges.
5. Water: streams and ponds from the hydrology layer, with reflection.
6. Life: a circling hawk and a deer herd as placeholder motion, filtered by the
   perception matrix.

Then judge the result against the "beautiful enough" bar and decide whether the
browser stays the renderer.

## Browser push (before any native engine)

1. WebGPU renderer evaluation (three.js WebGPURenderer): compute-driven grass at
   Tsushima scale, far more foliage instances, and a path to real-time GI.
2. ~~Cast shadows from trees and terrain~~ done overnight (three cascades, contact AO).
   Canopy wind: still to do.
3. ~~Chaparral density and a shrub-field layer; impostors for far trees~~ done overnight.
4. ~~Close-range grass band~~ done overnight (grassland still reads as photo at 120 m).
5. ~~Water in the streams~~ done overnight (seasonal surfaces, dry beds, ponds). Volumetric
   clouds: still to do.
6. ~~Tree frame cost~~ recovered overnight (far cards capped and thinned).
7. ~~Consume the per-cell species mix~~ done overnight (client/species_mix_*.png) in vegetation.js so the
   forest composition follows LANDFIRE instead of a fixed mix per habitat class.
   Judge each against the success metric in the brief (a resident finds their own hill
   from the air without the mini-map), not against Unreal.

## The acorn game, version two

- Three player species: acorn woodpecker (granary trees drilled with hundreds of
  holes), western gray squirrel (scatter-hoarding in the ground), common raven
  (caching). Each has its own pickup, stash and theft rules.
- Many of each species always present, driven by AI foraging behaviour; a person can
  take over any individual. Perception matrix decides who sees whom.
- Species-level leaderboard per world (tile plus season), persistent on the server.
- Needs: acorn woodpecker added to the species list and pipeline; an authoritative game
  server (the dev server grows into it; Rust is the candidate for the real node);
  WebSocket multiplayer; AI behaviour trees driven by the activity calendar.

## Then

- Geology and soils step done 2026-10-24 (Macrostrat/SGMC lithology at 1:750k, SSURGO
  texture, fragments and depth to bedrock; client rasters and an outcrop likelihood).
  Next: procedural boulders and outcrops in the client placed from client/outcrop.png
  and the rock class, and gravel/dirt detail blended from the soils raster.

- Choose licences (code, assets and species parameters, spec), add LICENSE and a short
  CONTRIBUTING with the contribution paths; set up the public repository.

- Decide state flow between season-worlds before the first persistent state is built
  (open question in the decision log).
- Get a licensing read on density surfaces derived from CC BY-NC mammal records
  before any paid product (open question in the decision log).

- First animals with behaviour from the activity calendar; perception matrix decides
  who is rendered for whom.
- Competitors for the acorn stash (squirrels, other ravens) and cache recovery in the
  winter world.
- Species density surfaces from CWHR habitat suitability; then the +10-year delta.
- Erase masked landforms from the DEM (vegetation backfill is done; terrain is not).
- Hand-drawn mask polygons in the viewer (mining scars, ditches, terraces) and
  appending viewer edits to the manifest's `edits` log.
- Ground-truth the footprint mask on foot with the viewer on a phone.
- Neighbouring tiles side by side in the viewer and client.
- ~~World selection in the client (where, when, who) as the opening screen~~ done overnight.
- Test the Unreal import on a real install.

## Parked (in the brief, not started)

- Federation protocol between nodes.
- Crowdfunding, matching pool, invites.
- CARE-aligned governance for community-held knowledge.
- Insect scale and the full progressive LOD system.
- Pre-dam channel reconstruction (no large reservoirs in either tile so far).
- Sound.
