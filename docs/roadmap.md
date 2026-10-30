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
  5 m, no wind in canopies yet (the crowns sway since 2026-10-29).
- Species library, 2026-10-26: twenty-six species. The seventeen foothill species Aaron
  sees around him (valley, canyon live and black oak, buckeye, madrone, bay, walnut,
  maple, ash, incense cedar, Douglas-fir, toyon, redbud, poison oak, coyote brush,
  elderberry, coffeeberry) are placed on all three tiles from species-mix rows that
  follow the ground within each community (floor, mid-slope, steep; north-facing;
  elevation band), and the six new shrubs are impostors like chamise and manzanita.
  Weak: the start view costs 1.4 ms more CPU in draw calls (rare species' age classes
  do not share meshes), buckeye's May candles and elderberry's flower plates are faint,
  crown bases sit high on four shrubs, and woodland shrubs are impostors only (not
  clickable).
- Lidar, 2026-10-26: the home tile has a 1 m ground, a canopy height model and a list of
  395k real tree crowns from USGS 3DEP (pipeline `lidar` step, 26 min for 2.1 billion
  points). The client draws a 2 m mesh of the lidar ground within 110 m of the player and
  the 10 m grid beyond (no cracks, 26k triangles, fps within 3%); the raven, the animals,
  rocks and grass stand on the drawn ground; the Hwy 50 cut reads as geometry. A half-pixel
  registration error in the height sampler is fixed (the terrain moved 2.5 m to line up
  with the textures). The 10 m mesh beyond the square passes through the 1 m ground at its
  vertices, and grass, shrubs, rocks and still animals follow the drawn surface (re-seated
  when the square moves); trees are draped onto the drawn surface in the vertex shader
  (their matrices, which the raven perches on and the squirrel climbs, stay put), and a rare
  species' old crowns get its old tree up close. Weak: crests rise by what the 10 m mesh
  cuts under them (typically 0.4 m) when the square arrives; an old rare tree's trunk
  switches branching at the 180 m hand-over; crowns taller than 1.7x their tree are drawn
  shorter than measured.
- The understory, 2026-10-29: thirty more species in the library (56), every one with the animals that eat it and
  shelter in it and where it belongs: nine shrubs (buckbrush, deerbrush, common manzanita, mountain mahogany,
  monkeyflower, wild rose, snowberry, gooseberry, currant) grown and drawn as the six of 10-26, the shrub impostor
  field taking any shrub of the library; seven grasses drawn by grass.js as species (palette, height, heads per
  record, from each cell's ground mix); fourteen herbs in a new layer (forbs.js: side and top pictures baked from the
  record per month, crossed quads within 45 m). The species mix carries a ground layer per community from the
  records' habitat blocks; games.json carries who eats which plant; the needs widget names the plant under the body;
  the field guide names a herb or the grass under the cursor and says who eats it. Weak: the herbs are flat pictures
  (no shadow, a visible X from above), the chaparral impostors' near leaf pictures repeat on big crowns as before,
  the 3D shrubs of the woodland understory are still few (the impostors carry it), the grass species change only the
  blades' colour and size (one clump shape per type), and the nine shrubs are unmeasured on the lineup.
- Trees on the lidar crowns, 2026-10-26: one tree per real crown on the home tile, species by the cell's mix and the crown's height, the biggest real trees old-growth with landmark ids; start view 295 draw calls (412 before). Weak: shrub-only for the first moments after load, rare species' old crowns are scaled mature trees.
- Ground colour by date, 2026-10-26: the base is the NAIP photo with the tree crowns replaced by ground, recoloured per 20 m by the Sentinel-2 monthly median for the day over July (class-aware 100 m blur of open ground, slope shading regressed out, per-class flat-ground brightness), forest litter under closed canopy, grass blades and the rewilded palette from the same means; fps unchanged. Weak: oak-woodland and chaparral open ground greens less than grassland (measured, reads grey-olive in April), litter is one fixed colour, the first build costs 0.6 s at load.

- Yosemite, 2026-10-28: `utm11n_270_4180` (Half Dome, Yosemite Falls, the village meadows) built end to end with the DEM-only lidar fallback (no public point cloud); Half Dome recognisable from the meadow. Weak: no fall drawn, flat grey granite, foothill species on a Sierra tile, start point on Tioga Road.
- Night 2026-10-27/28 (standing authorization, up to $100 of credits; docs/report-2026-10-26-morning.md rows from fbc2c07): the herd silhouettes masked by the herd's own bodies (stencil); the Yosemite tile finished; the world hunts without the player (AI hunters as threats, watchers calling at them, lions stalking herds, canids pouncing, hawks stooping); alarm calls heard; kills and carrion with ravens, vultures and coyotes coming (a death in the world: Aaron's call to keep); the player's catch as lion, coyote, fox, hawk or raven; waterfalls on steep channels (Yosemite Falls); cliffs read as rock at any distance; bark plates at their size on old trees; the skinned, clip-animated deer merged; species present per tile from GBIF records (pipeline). Weak: no kill sound or feeding pose; the fliers have no hunger; the falls are a few metres wide where May's plume is twenty; the Sierra species (bear, mule deer, mountain quail) have no models yet.
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

- Night 2026-10-25/26 (standing authorization, see docs/report-2026-10-26-morning.md):
  imagery erase fixed (only built pixels in low-intensity cells); pines with per-needle
  shading and transmission; twig tier in the close trees; rocks reshaped and clustered with
  talus and stream cobbles; grass continuity (one placement per cell, cards are the blade
  plants); the animal library and Meshy maintainer tool, 14 species briefs, bird and rodent
  rig templates, meshes adopted for deer, scrub-jay, quail, squirrel, hawk, vulture,
  Steller's jay, fox, coyote, rabbit, jackrabbit, buck, mountain lion and vole, an animal
  lineup page; the raven lands by contact on the ground or a limb and hops; the squirrel climbs whole trees, runs the limbs and leaps between them; the woodpecker is playable; acorn
  game v2-v4 (AI collectors, leaderboard, a shared world per tile, granary defence and
  pilfering); hydrology rewilded with willow, alder and cottonwood corridors; a third tile
  built from scratch; attribution on every source and a credits panel; three.js 0.186.
  Sentinel-2 monthly ground colour on a crown-inpainted base photo; the turkey, ground
  squirrel and fence lizard with their sounds; two San Francisco cells built from scratch as
  a stress test, then a dense-urban rule that rewilds a city whole (streets gone, blocks
  synthesised from the pre-settlement class, bridges and street trees dropped from the crown
  finder; a `crowns` step after derive); the player arrives as a spirit in a misty blue-green
  world and becomes the glowing raven, squirrel or woodpecker it touches, the opening screen
  is map cards and a season slider; every day has its real weather (Open-Meteo: last year's
  hour by hour per tile, today's live), drawn as cloud, mist, wind, rain and snow (2026-10-26); a
  tile is built in place when its card is clicked or the Location box leaves for it, abandoned
  when another is chosen, no reload, no URL (2026-10-27); the HUD behind a hamburger, a nearby-animals bar in spirit form, souls coloured and brightened by rarity, the rare lit from further off, a mountain-lion beacon for testing (2026-10-27); herd species piloted as a herd, the herd taking over when the player stops (2026-10-27); a games step classifies every species' games per tile from the calendar, resources and perception (docs/games.md, 2026-10-27); the animals notice the player at their own distance and heed alarm calls; the wheel zooms every view; off-screen herd members are marked at the screen's edge (2026-10-27). Weak: woodpecker stays procedural; a
  coastal tile has no sea (the seabed is drawn as terrain), the city fill is a flat olive
  scrub, and the species library is the foothills' (see decisions.md, 2026-10-26).

- The water system, 2026-10-29: a `water` pipeline pass carves every creek's bed and wet
  margin and every pond's basin into the terrain, lays the bed material (boulders, cobble,
  gravel, sand, silt, bars), writes the water level and the riparian zones (channel, margin,
  bank, terrace; the pond's water, margin, shore, terrace) for the client, and builds a species
  mix per zone from the records' new `habitat.riparian` blocks; twenty-one riparian records
  (willows, sycamore, buttonbush, dogwood, blackberry, grape, spicebush, cattail, tule, bulrush,
  sedges, rush, horsetail, mugwort, nettle, monkeyflower, watercress, duckweed) and a new
  `emergent` form drawn by `emergents.js`; the streams drawn at their level in the carved
  channel, the dry beds rocky, the margins tinted, the gallery trees by zone.

- The catch, 2026-10-30 (branch claude/catch-rigging-4301f4, docs/decisions.md "the catch rigged", docs/movement.md
  "The catch"): the prey falls over 0.4 s instead of snapping onto its side (the deer's bed clip blended in fast), the
  lizard can be taken (the fox's pounce, the raven's and jay's takes).

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
   ray, one tone-mapped lighting pipeline for all materials. Clouds reworked 2026-10-25: no repeat, cumulus with flat grey bases and lit tops in a 900 m layer, cirrus above, shadows matching. Open: horizon clouds flaky
   every 2.5 km, no cast shadows from terrain or trees, summer noon ground is bright.
   Grass done 2026-10-24: procedural blade clumps up close (wild oat, bromes,
   medusahead over purple needlegrass), seed heads and awns, wind with gusts, backlight,
   season palettes and heights, tuft cards to 250 m, 3 draw calls, ~2.6 ms at ground
   level and ~0 at altitude. Weak: from 10-40 m up the grass reads as stubble and the
   ground texture carries it; a mid-height grass impression (denser tufts or a shaded
   ground cover) is a follow-up.
4. Wind: done 2026-10-29 for the crowns (treegen.js CROWN_SWAY: a wave across each crown from the windward side,
   the single leaves and the close twigs with it); open: the shadow casters do not sway, no whole-crown limb bend,
   not stronger on ridges.
5. Water: streams and ponds from the hydrology layer, with reflection.
6. Life: a circling hawk and a deer herd as placeholder motion, filtered by the
   perception matrix.

Then judge the result against the "beautiful enough" bar and decide whether the
browser stays the renderer.

## Browser push (before any native engine)

1. ~~WebGPU renderer evaluation~~ done 2026-10-25: [webgpu-evaluation.md](webgpu-evaluation.md).
   Stay on WebGLRenderer for the demo: at client scale WebGPU draws no faster (r186 at parity,
   r170 slower), none of the ~1,900 lines of GLSL run on it, and its WebGL2 fallback is slower than
   today. Next: upgrade three to the current release on WebGL, then a standalone compute-driven
   ground-cover prototype (GPU placement measured at about 1 ms against 25-80 ms on the CPU per 100 k).
   The port, if that prototype earns it, is one cutover in the order the evaluation gives.
   Prototype done 2026-10-25: [gpu-placement-prototype.md](gpu-placement-prototype.md). The GPU
   places grass.js's plants exactly. It earns the port only for 4-8x denser ground cover (the CPU
   path stalls there), as a GPU cell cache with a per-frame cull. At today's density the CPU cache
   copes at any speed.
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

- Water, next: the ponds' drawdown ring and basin checked in the client; the raven's frame rate
  over the creek; the emergents' far tier and their look against references (the tule and rush
  pictures read dark against the water); the stones' contrast on the dry beds from the chase
  camera; the other tiles rebuilt with `--steps water`; a water temperature from
  `relations.shades_water`; the animals' crossings at the bars (deer, raven) made deliberate.

## Then

- Detail at every scale (2026-10-28, docs/decisions.md "detail at every scale"): done, one body-scale number
  (bodyScale.js) drives the body-scaled grass ring, the litter ring, the micro-relief patch with its 20 cm octave, the
  leaf level and the leaf shimmer; the lidar micro raster (4 m: intensity, roughness about the DEM, low vegetation)
  conditions the bumps on the lidar tiles. Open: the gray squirrel's own control has no body-scaled hooks beyond the leaf
  level and the smell (2026-10-29); the leaf level does not cover chamise or bare-twig textures; a mid-scale (fox, coyote) is the
  least served, its ring at half density; the DEM-only Yosemite tile has no roughness to condition on. The HUD's
  abilities row and the smell sense (scent.js) landed the same day. The rig (2026-10-29): a turning deer steps and its
  body follows the legs; the same day its spine bends into the turn (the head faces where it is going, the hips come
  round behind), the head leads, and the legs step sideways round a standing turn and arc on a curve (docs/decisions.md);
  next in the rig, in order: the Walk backwards on S, a trot, leg length to the slope, an alert pose of its own, a true
  sideways-step clip if the turned swing is not enough; the fox, coyote, lion and bear step round their turns the same way on the
  part rig, and the same day every other walker in its order's way (the rodents' fore-foot hops, the birds' steps in
  place with the head leading, the lizard's C-bend; 2026-10-29); the mini-map shows the 800 m round the player and a
  click opens the full tile (2026-10-29); the crown wave loosens in a strong wind and the limbs flex
  downwind with the near trunks, and the near shadows move with them (2026-10-29); every body cruises on W and sprints on Shift with a
  species-sized legs meter (2026-10-29); docs/movement.md and the locomotion layer (library tree,
  pipeline/locomotion.py, tile locomotion.json, client/src/locomotion.js) say how every species moves from its taxon
  and body (2026-10-29); next: the part rig's spine bend, the AI's gaits from the Froude bands, the templates for
  snakes, frogs, fish, bats and arthropods; "scented" on the hunt panel and the leaf level to
  15 m for a deer (24 for the smallest) on 2026-10-29. Next: the greyed abilities one by one (dig, pounce, carry, swim,
  climb, call, mark, den, display); the prey's nose landed 2026-10-29 (animals.js noticeAt: the wind decides how far an
  animal smells the player). Open: no wind between AI animals (an AI lion's prey notices it at detects, as before).
  The player's own senses as indicators (2026-10-29, docs/decisions.md "the eyes and the ears" and "the sniff"):
  sight.js lights a predator or prey the camera has in sight in its rarity colour for a 5 s hold (a chance per second by
  distance, motion and a line test through the ground, the near trees and shrubs and the canopy raster), and throbs one
  that has the player in sight; soundCues.js rings a heard one on the screen at its point, or at the nearest edge;
  scent.js draws a scent only when new (it flickers in and away) or while the player sniffs (L, the slot, or the
  canids' and the lion's E), every strand with its label. Open: the chance's numbers are first guesses to tune
  (sight.js RATE, STILL..BOLT, SEES_K); one colour for "spotted" and "it sees you" (the throb tells them apart); the
  fliers' sight untried; the sniff slot untried with the pointer; a carcass's "dead" label unseen.

- Geology and soils step done 2026-10-24 (Macrostrat/SGMC lithology at 1:750k, SSURGO
  texture, fragments and depth to bedrock; client rasters and an outcrop likelihood).
  Outcrops and boulders placed from it in the client 2026-10-25 (rocks.js), with grass,
  shrubs, impostors and placed plants thinned on outcrop cells so the rocks show from
  the air, in strips along the strike with brush between; the rock detail texture's
  repeat broken by a second turned copy. Next: jagged fin edges and jointed granite;
  strike from the geology polygons; gravel and dirt detail blended from the soils raster.

- Choose licences (code, assets and species parameters, spec), add LICENSE and a short
  CONTRIBUTING with the contribution paths; set up the public repository.

- Decide state flow between season-worlds before the first persistent state is built
  (open question in the decision log).
- Get a licensing read on density surfaces derived from CC BY-NC mammal records
  before any paid product (open question in the decision log).

- ~~First animals with behaviour from the activity calendar; perception matrix decides
  who is rendered for whom.~~ done: twenty species with behaviour, the detection matrix, hunts and kills (2026-10-28).
- Competitors for the acorn stash (squirrels, other ravens) and cache recovery in the
  winter world.
- Species density surfaces from CWHR habitat suitability; then the +10-year delta.
- Erase masked landforms from the DEM (vegetation backfill is done; terrain is not).
- Hand-drawn mask polygons in the viewer (mining scars, ditches, terraces) and
  appending viewer edits to the manifest's `edits` log.
- Ground-truth the footprint mask on foot with the viewer on a phone.
- Neighbouring tiles side by side in the viewer and client. (A tile at any whole-kilometre origin builds since 2026-10-29: the re-centred Yosemite
  tile utm11n_267_4175 holds the valley from El Capitan meadow to Half Dome; the first stitch is the next step.)
- ~~World selection in the client (where, when, who) as the opening screen~~ done overnight.
- Test the Unreal import on a real install.

## Parked (in the brief, not started)

- Federation protocol between nodes.
- Crowdfunding, matching pool, invites.
- CARE-aligned governance for community-held knowledge.
- Insect scale and the full progressive LOD system.
- ~~Pre-dam channel reconstruction~~ first pass 2026-10-25: build step `rewild_hydro` takes out
  reservoirs and dammed stock ponds (30 in the home tile, 53.9 ha, Patterson Lake and Indian Creek
  Reservoir the largest; 41 in Placerville, 15.1 ha), carves the restored channel through each bed,
  exports creek depth with pools and riffles from the DEM profile (`depthAt()` in water.js) and a
  rewilded-bed mask. Still open: the beds keep the photo's water and no vegetation until the erase
  and vegetation read the mask; the dams stay in the terrain; the squirrel still uses its own
  notional creek depth.
- Sound.
