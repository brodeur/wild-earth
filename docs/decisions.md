# Decision log

One entry per decision that shaped the project: what was chosen, what was rejected,
and why. Newest at the bottom. Technical workarounds are included when they change
what a future contributor should expect.

## 2026-10-22: tiles are fixed 10 km UTM grid cells, not watersheds

Rejected: snapping a player's world to a watershed boundary. Regular square cells make
streaming, neighbour exchange and deterministic seeding trivial; watersheds vary wildly
in size and shape. Watersheds (HUC12) remain a layer for region naming and privacy
snapping, and a funded "region" can be a set of cells.

## 2026-10-22: the anchor is never stored

A player's location is snapped to its cell and discarded. The cell ID is the only
location that exists in the package or the repo. This is the privacy rule from the
brief made concrete.

## 2026-10-22: seasons track the real calendar; activities are verbs

Game time follows the real date at the tile; only the day cycle is accelerated. Each
species has activities per season drawn from a small fixed set of verbs with resources
they need, so adding a species is filling in a calendar, not writing new mechanics.
Rejected: bespoke mini-games per species and season (five species times four seasons
was judged a content trap).

## 2026-10-22: v0 is honest present-day data, not a projection

The +10-year species projection and pre-dam channel reconstruction were deferred. v0
carries present-day terrain and hydrology with a footprint mask marking what to erase;
the manifest's `status` block says exactly what has and has not been rewilded. The
projection becomes a delta layer later. Reason: the projection is the weakest science
and the least visible to a player.

## 2026-10-22: build order is spec, dataset, viewer, renderer

The tile package spec is the contract between the three workstreams and is written
first. A 2D viewer shows bad data in an afternoon; a renderer shows it after a week.

## 2026-10-22: USGS services are chipped; Planetary Computer is the fallback

The USGS National Map ArcGIS services (3DEP, NAIP Plus, NHDPlus HR) time out on
requests over about 500 px or 200 records. Requests are chipped and cached, hydrology
is paged slim, and Microsoft Planetary Computer's NAIP and 3DEP seamless COGs are the
fallback. OpenStreetMap waterways are the fallback of last resort for hydrology.
LANDFIRE comes from its ArcGIS image services, not the product service, which now
requires an email to submit jobs.

## 2026-10-23: vegetation and resources before gameplay or renderer

Rejected for that slot: a playable loop, species density surfaces, ground-truthing.
Every downstream piece consumes vegetation, and the calendar's resources were names
without map layers. Habitat is collapsed into nine classes; human pixels are
backfilled from LANDFIRE Biophysical Settings, which turned a quarter of the
Placerville tile and a third of the home tile back into oak woodland.

## 2026-10-23: browser client first, Unreal when the browser is the ceiling

Rejected for now: starting in Unreal Engine 5 as the brief says. A three.js client can
be built and verified in the loop, fits the web architecture of the game, and the demo
scales do not need Nanite. The tile package is engine-agnostic; only `client/` and
`unreal/` are engine-specific. Move to Unreal when the browser limits beauty rather
than our effort (dense near-ground vegetation, global illumination, insect scale). An
Unreal Landscape export step exists as a hedge and proves the spec is portable. The
likely end state is both: web for the viewer, invites and light play; Unreal for the
full game.

## 2026-10-23: vegetation is grown, not stored

Trees are procedural per species from a parameter set, placed per 30 m cell from
habitat class and canopy cover with a deterministic seed by coordinate. No tree list is
stored in the package. This is where an agent building a new region plugs in: it writes
a species parameter set, not a model. Rigged animals are the exception and will be
sourced for the demo.

## 2026-10-23: beauty before gameplay

Aaron's call, overriding the recommendation to build a forage-and-cache loop first.
Reasoning accepted: worlds can carry themselves (Proteus, Journey, flight simulation);
the hook is experiential; beauty is what the crowdfunding model sells. Amendment
accepted in return: motion and sound count as beauty, so the visual pass includes wind
and ambient wildlife. The loop comes when the world has earned it.

## 2026-10-23: viewer density is a client-side grid, not a GPU heatmap

deck.gl's aggregation layers fail in any deck that has drawn terrain. Occurrences are
binned into 300 m cells and drawn as extruded columns. Technical, but it will bite
anyone who tries to add a heatmap back.

## 2026-10-23: a world is a location plus a season

Aaron's proposal. Each tile exists as four joinable worlds, one per season, rather
than one world locked to the calendar. The world whose season matches today's date is
the live one and can take live signals (this week's observations, weather); the other
three are stable and replayable. Onboarding becomes three choices: where, when, who.
Rejected: a single real-time world per tile (players joining in October would not see
spring until April) and spoofed in-game seasons (breaks the real-calendar honesty).
Consequences: persistent state (nests, caches, dens) belongs to a world, not a tile;
four worlds per tile shard multiplayer naturally; a federated node may host one season
of a tile; a season-world keeps a day cycle and loops its own three months rather
than freezing at a midpoint.

**Open:** whether state flows between seasons. One-way flow in calendar order (what a
raven caches in the fall world is recoverable in the winter world) makes the seasonal
loops work and is harder to add later; fully independent worlds are simpler to run.
To be decided per state type before the first persistent state is built.

## 2026-10-23: species record licensing is a mammal problem, not a bird problem

Audit (`pipeline.audit_licenses`): non-commercial records are 8% of the home tile and
2% of the Placerville tile overall, but birds come from eBird under CC BY while most
mammal records come from iNaturalist under CC BY-NC: deer 70% NC in the home tile,
mountain lion 100%. Decision: occurrence records are used only as evidence for
building density models and for the local-knowledge review in the viewer; no record
is shipped into a game client. Whether a density surface derived partly from NC
records is itself commercial use is **open** and needs a lawyer before any paid
product. The viewer shows each record's license.

## 2026-10-24: roads are decayed, not erased

Aaron's question ("roads are an important place marker"). Ten years after humans a
paved road is still a linear clearing: cracked pavement with grass in the seams, shrubs
at the edges, no trees on it yet. Client products now render roads that way, and a
ghost overlay (G) draws every road with its name for orientation. Rejected: erasing
roads entirely (loses place recognition, which is the experiential hook, and is less
true to the premise) and rendering present-day asphalt (breaks the fiction). This
refines the "no humans" rule from erased to decayed; buildings and other footprint
classes still await their own treatment, and the terrain's road cuts remain untouched.

## 2026-10-24: satellite imagery as the base texture, with humans erased

Aaron's proposal, ahead of the atmosphere step. NAIP imagery becomes the default ground
texture in the client because real pixels carry more beauty than nine habitat colours.
The premise is kept by erasure: an erase mask (OSM footprint except roads, buffered
buildings, LANDFIRE human cells, minus pavement) is inpainted where thin and
synthesized where large from clean pixels of the same backfilled habitat class, with
local brightness matching; highways and county roads stay as bleached pavement while
residential streets, service roads and tracks fade toward the surrounding ground (a
first look showed a bleached subdivision grid reading as a bright maze). The manifest records the
mask, inpainted and synthesized fractions and sets `status.imagery_erased`. The
habitat-colour texture stays as the fallback for places without free imagery (NAIP is
US-only) and as the "map" view. Rejected: showing imagery unedited (breaks the world),
and waiting for Unreal to do this (the erase step is engine-agnostic and the Unreal
export can consume the same texture). Known limits: summer baseline recoloured by
season relative to the imagery's own means; tree shadows baked in; 2.5 m pixels.

## 2026-10-24: the first game is the acorn stash

Aaron's call to start the gameplay loop now that the world looks like a place: oaks
carry acorns that glow as the raven nears, picking one up reveals stash holes in some
oaks, depositing shows current / capacity. Design in `docs/game-acorn-stash.md`.
Decisions inside it: proximity pickup and deposit (no button, flight stays the
input), a carry limit of three, acorn counts driven by the fall acorn_mast resource,
deterministic stash holes per tree, and persistence per world (tile plus season) in
the browser as the first persistent player state. Rejected for now: competitors, cache
recovery in winter, scoring.

## 2026-10-24: mission stated; open source and community-built

Aaron: "The goal of this is to connect modern people directly to their bioregion in a
fun and engaging way. I'm hoping to make it open source / crowdware." Recorded at the
top of the brief. Consequences: bioregions (watersheds, ecoregions) become the social
unit for communities, funding and local knowledge, with the tile as the technical
unit; the species parameter library and tile spec are public goods; contribution paths
(verify/flag, species parameters, mask edits) matter as much as features. **Open:**
the licences. Candidates: AGPL-3.0 for code so federated node operators share their
changes, or MIT/Apache-2.0 for maximum adoption; CC BY-SA 4.0 for generated assets and
species parameter sets; CC0 for the spec. Also open: whether CC BY-NC species records
are acceptable inputs for an open, non-commercial project (likely yes for display and
modelling, but derived assets should not inherit NC terms).

## 2026-10-24: third person, with a sourced raven

Aaron's call: the player sees the raven, not just the world through its eyes. The
camera chases from 5.5 m behind and 1.6 m above in the heading frame, follows half the
pitch so a dive still shows the ground, smooths its offset (not its position, so forward
flight never lags), and tilts a third of the bank into the horizon. V returns to first
person. The bird is the CC0 "Raven" by Teh_Bucket (OpenGameArt, 2015, ~1.2k triangles
after the mirror), exported from Blender 4.1 to `client/assets/raven.glb` with its fly
cycle and a glide clip added by holding the cycle's frame 28 (wings out, tips just above
the shoulders); the client scales it to a 1.3 m wingspan and relights it with the
lambert-plus-atmosphere material the trees use. Wings beat while climbing, boosting or
flapping and glide otherwise, cross-faded. This is the "rigged animals are sourced"
exception in practice. Rejected: a paid crow (Nestaeric, $68, 22 clips) until the look
of the world asks for feather detail; a Blender-free path (the file is .blend only).

## 2026-10-24: trees come from a species parameter library

Each species is a JSON parameter file (architectural model, trunk, branch levels,
foliage, seasonal colours, LOD budgets, notes, CC BY-SA 4.0) grown by one Weber-Penn
style generator; tiles reference species by id and carry no geometry. This is the seed
of the shared asset library in the brief: an agent or a resident writes a file from a
species' morphology, reviews it on the lineup page against photographs, and a local
signs it off. Rejected: hand-modelled or purchased tree meshes (not shareable, not
scalable to a region's species list). Far foliage defaults to leaf cards over blobs,
trading about ten frames per second for a continuous forest.

## 2026-10-24: browser first, then the three-species acorn game; no Rust client

Aaron's direction after the engine discussion: see how far the browser can be pushed,
then make the acorn game with woodpeckers, squirrels and ravens all collecting acorns,
a species leaderboard, and many of each species always present (AI or human). Rejected:
a Rust client (it would mean writing an engine before a game; Rust stays a candidate
for the federation node and simulation server), and starting the Unreal probe now
(kept as the hedge; the export step stays). The realism target is "recognisable":
someone who lives in a tile should find their own hill from the air. Open: which
open-source engine, if any, could astonish at Unreal's level (Godot 4, Bevy, O3DE are
the candidates; none is there today), versus the browser with WebGPU being the
astonishing thing because the place is real.

## 2026-10-25: rocks come from geology and soils data, not from slope alone

Aaron: "For rocks look for a pipeline route that is reproducible. soil types, rock
types etc." Bedrock units from the USGS State Geologic Map Compilation or the
Macrostrat API (lithology, age, description) map to rock classes with a look each
(Mother Lode greenstone, serpentinite, slate and phyllite, granite); SSURGO via Soil
Data Access gives surface texture, rock fragment percentage, depth to bedrock and
parent material per map unit. A pipeline step writes per-cell geology and soil rasters
plus an outcrop likelihood (lithology resistance x shallow soil x convexity x slope,
later x lidar roughness); the client places procedural boulders and outcrop clusters
from it and the ground-detail shader takes gravel and dirt colour from the soil data.
Rejected: placing rocks by slope and noise alone (not reproducible, not local).
