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

## 2026-10-25: near-ground detail is CC0 scans multiplied over the photo, chosen from data

The aerial photo blurs to paint inside about 50 m. The fix is a detail layer rather than
a higher-resolution photo: five tileable CC0 ground scans (dry thatch, oak leaf litter,
gravelly dirt, cobbles and rock, worn pavement) with normal maps, normalised to a mean
of one and multiplied over the photo inside 250 m, so the photo still supplies colour
and the grass and shrub roots still match the ground. Which surface shows at a pixel
comes from data already in the tile: habitat (thatch in open grassland, litter under
canopy, gravel in chaparral), slope and curvature from the heights (rock above about
30 degrees and in concave channels), a bare-ground term from the photo, and the roads
mask for pavement. Tiling is broken with two UV warps and a fade as each repeat shrinks
on screen. Cost is about one GPU millisecond at 3 m and nothing at the start view.
Rejected: triplanar everywhere (budget), and detail that replaces the photo colour (it
would fight the recoloured seasons and the grass). Next: the soils raster from the
geology step drives the gravel and dirt choice, and outcrops are placed from the
outcrop likelihood.

## 2026-10-25: foliage is set per square metre of crown, not per tree

Aaron: "the bigger the tree the sparser it seems." The generator had a card budget per
species, so a veteran spread the same foliage over four times the crown surface of a
young tree. Now each species states cards per square metre of crown envelope, scaled
from its reference tree, with card size growing by at most 1.4x and the near and mid
caps scaling with crown size; gaps now stay within a narrow band across age classes
(blue oak 0.19 to 0.28 where it was 0.10 to 0.50). Pines draw needle bundles on crossed
cards, with mip levels redrawn from the needles so a tuft at 20 m stays spiky instead
of blurring into a leaf lobe. Rejected: a global density multiplier (it would have
over-filled saplings). Still open: light through needles (sunlit ponderosa at 20 to
60 m still partly reads as rounded lobes), and a higher-resolution close texture for
needles under 3 m.

## 2026-10-25: outcrops and boulders are placed in the client from the outcrop raster

First pass of the rocks lane (client/src/rocks.js). Placement is a hash of each 30 m
cell, so every client sees the same rocks: outcrop clusters where the likelihood passes
0.45 (2 to 6 main masses shaped by rock class: slate and schist as fins along a fixed
N35W Mother Lode strike, greenstone as dark knobs, granite as a dome with split
boulders, serpentinite as blocky blue-green masses with rubble), and boulders of 0.4 to
2 m scaled by likelihood and the soils' rock fragment percentage, skipping water and
pavement. Procedural shapes in five detail tiers with dithered hand-overs out to
1.5 km; each rock seated on the drawn terrain mesh. Zero cost at the start view, about
one GPU millisecond at 3 m in the densest outcrop. The ground detail layer raises its
bare term on outcrop cells so the rock material wins there. Honest look: slate fins are
plank-straight, granite domes read as smooth eggs, and most strong outcrop cells are
chaparral, so the shrub carpet hides the rocks from about 80 m up. Rejected: downloaded
rock meshes (not reproducible per class), tilting rocks with the slope (fins must keep
their dip). Same day: grass blades, shells, tussocks and oats, the shrub impostors and the placed
trees and shrubs all thin on outcrop cells by one curve (tilepackage rockKeep: nothing
below likelihood 0.4, 15% kept from 0.65 up, bilinear between cells), so an outcrop is
open rocky ground and a greenstone ridge reads as a rocky clearing from 120 m up. Then
made patchy: the opening comes in strips along the strike (about 8 m across, 30 m
along), 15% of plants kept on a strip and 65% between, and the ground detail's bare
term follows the same strips (rock on a strip, gravel between), so an outcrop reads as
fins with brush between them. The detail shader draws a second copy of the top material
turned 63 degrees, swapped in over 5 m noise patches, which removes the lattice a 3 m
rock tile showed over 30 m of open slope (two extra texture samples on top-down ground
inside 250 m; not measurable on a noisy machine, bounded by the layer's own ~1 ms).
Open: jagged fin edges and jointed granite; strike from the geology polygons.

## 2026-10-25: pine needles get their own shading and let light through

Sunlit ponderosa at 20 to 60 m still read as rounded lobes after the needle pass, and
backlit crowns went black. Two changes in the generator, for the two pines only: each
needle card texture now carries a second copy with each needle's own lighting
direction and local sparseness (mips drawn from the same strokes, so the variety
survives to the 16 to 32 texel levels a tuft uses at 30 to 60 m), which the shader
mixes into the crown normal so needles on the sun side light and those behind shade;
and a transmission term (softer shading toward the sun, a yellow-green glow at thin
edges when the sun is behind the tuft, a weak glow over the whole backlit crown),
fading out where the impostors take over. Empty texels no longer bleed black into
needle edges, and ponderosa tufts fork into separate starbursts. Lineup metrics hold
(ponderosa gaps 0.34 vs 0.35 target). Cost about one millisecond in a full-screen pine
stand, start view within noise. Rejected: a translucency texture per species (one
channel of the existing card texture does it). Still open: gray pine tufts are round
clumps rather than hanging tassels; shadow maps treat cards as opaque so sparse crowns
get dark clumps; a twig tier for the close set is the next tree pass.

## 2026-10-25: animals may be curated CC0 meshes; trees and ground stay procedural

Aaron asked about Meshy models. The procedural argument (one algorithm per morphology
scales to every species on earth) is for plants and ground, which number in the
thousands per region; animals are a dozen species per tile, so a curated mesh per
species is sound. First one: the black-tailed deer is now "Deer" by Quaternius
(Ultimate Animated Animal Pack, CC0, via Poly Pizza), rebuilt by tools/build_deer.py
into three tiers (2,096 / 1,000 / 298 triangles) with big ears, a grey-brown coat,
black tail top and white rump, and posed by the existing procedural rig through
per-vertex part weights rather than its own skeleton, so grazing, bedding, tail flicks,
shadows and lighting are unchanged. The procedural deer stays as the fallback when the
mesh fails to load. The Meshy deer the user pointed at is CC0 but its download needs an
account, so it was not used; no account was created. Rule for animal meshes: CC0 or
CC BY with the credit in README, a build script in tools/ that records source and
licence, local species accuracy checked (ears, tail, antlers), and tiers sized for a
herd. Open: a buck with mule-deer forked antlers; the bedded pose still looks sunk.

## 2026-10-25: stones come in clusters, with talus around big rocks and cobbles along water

Aaron: "Stones should appear in clusters. If there are big stones, there should be small
stones around. If there are small stones, there should be a number of small stones
together. Some places should have lots of stones, especially near the edges of water."
rocks.js now places boulders in one to three tight clusters per cell rather than a
scatter; every outcrop mass and every boulder over a metre gets a talus halo of 5 to
30 smaller stones shrinking outward and spreading downhill; small stones only come in
groups of 5 to 20; a pebble tier (one draw call, 80 triangles, fading by on-screen
size) carries them; and stream beds and banks get rounded, paler water-worn cobble and
gravel at the widths water.js draws, bigger on bigger channels, with gravel bars on the
inside of bends and a gravel band outside pond shores, nothing on the water surface.
Shapes reworked in the same pass: slate and schist fins swept from boxes with stepped
crests, splintered ends and leaning flakes; granite jointed into blocks with
exfoliation sheets and pale split faces; serpentinite as angular blocks with dark
striated joint faces; all classes darken slightly with distance so far granite is
grey, not white. Cost in the densest slate cell at 3 m about 1.8 ms against 1.4 ms
before. Open: stream cobbles line both banks more than they form bars; long reefs
still a little rail-like at 20 m; schist reads pale.

## 2026-10-25: a plant seen from the air is the same plant at your feet

Aaron: "When I get close to the ground, grass and herbs and small shrubs disappear,
replaced with a different grass layer - is it possible for them to stay?" The blade
tiers, tufts, tussock and oat impostors were four placements with their own seeds, so
every hand-over was one population vanishing while another appeared, and the tussocks
were held 45 to 60 m from a low camera. Now one placement per cell gives every plant a
rank and each tier draws a slice of the same list: the cards are some of the blade
plants, not extra ones, each card is a baked picture of its own clump (rebaked when
the season changes) lit and coloured by the blade rules, and each plant hands over in
place, blades thinning exactly where its card dithers in (tufts at 26 to 38 m, 9 to 15
m from the air; tussocks and oats at 6 to 12 m at every height). Tussocks are now
80-leaf clumps so they survive past 15 m. Within 0.5 ms at 3 m and about 1 ms cheaper
from the air; start view pixel-identical. Rejected: more cards near the camera (cotton
balls) and crossed planes for the shrub cards (breaks their dome shading). Still
changing on descent: the sward densifies as the ground and close blade tiers fill in,
and the shells fade between 10 and 6 m; nothing visible vanishes.

## 2026-10-25: clouds are a world-space field with no repeat, drawn as domed cumulus

The roadmap's open atmosphere item was "clouds repeat": one 2.5 km noise tile on a
plane, faded out before its rows showed. atmosphere.js now builds the cloud field in
world metres from one tileable noise texture read at unrelated scales, rotations and
drift speeds (a 41 km coverage field, an 11 km domain warp, 5.3 km bodies and 1.4 km
billows that only erode), so no lattice or recurring shape appears across the dome,
and the shear between layers slowly reshapes the clouds. The dome draws it as a 900 m
slab of heightfield cumulus with flat bases about 1.6 km over the ground and domed
tops: three cuts along each view ray (base, a third and two thirds up), lit by sky,
ground bounce and a sun that is dimmed by cloud up the sun ray, with grey bases, warm
tops at low sun, silver rims when backlit, and sun at cloud height lasting about 1.4
degrees past ground sunset. A thin, streaky cirrus sheet sits 7 km above. Coverage is
season plus an afternoon build-up. Shadows: the opacity of the same three cuts up the
sun ray is baked around the camera (30 km, 39 m texels, a quarter per frame into a
double buffer), so cloudOnly() still costs one lookup and a cloud covers the sun from
inside its shadow; uniform and function names are unchanged. Cost at the start view,
five alternating rounds: frame 8.43 ms before (8.24 to 8.54), 8.55 ms after (8.37 to
8.62); the full-screen sky pass 1.16 ms before, 1.25 ms after. Rejected: more cuts
(six showed far clouds as stacked plates or, dithered, as grain) and a real ray march
(several times the cost). Open: far clouds near the horizon still read as thin flakes,
cloud interiors look a little smooth and plastic, and the cirrus is brush-stroked.

## 2026-10-25: acorn game v2, three species gather from one supply, scored by species

Aaron's design for the second version: woodpeckers, squirrels and ravens all collecting
acorns, many of each always in the game (AI or people), a species-level leaderboard.
Decided: while a game runs, the ambient acorn woodpeckers (families of 3-6 on a stash-tree
granary, both sexes drawn), western gray squirrels and ravens are collectors that take
the same acorns as the player, each in its own way (granary deposit, single burial with a
fading dug mark and the odd dig-up, a raven's cache by a shrub), through one plain state
object and four events (pickup, deposit, bury, dig) that a server can own later. The
board counts per species for a 10-minute round and for the world (tile plus season,
localStorage); the player's line sits under their species, which is a field on the
player's collector record (raven today). In fall taken acorns regrow after 5-7.5 game
minutes; winter, spring and summer keep v1's counts with no regrowth. Near the eye the
v1 acorns shrink toward life size so an animal at one is not dwarfed. AI collects only
during a game; claims keep two animals off one acorn but never block the player. Cost
with about 110 collectors live: 0.05 ms more in animals.js and 0.02-0.05 ms in the game
per frame. Rejected for now: networking, playable squirrel and woodpecker, pilfering by
the player, granary defence. Design and state shape in `docs/game-acorn-stash.md` (v2).

## 2026-10-25: the western gray squirrel is playable, a ground and trunk controller beside the raven's

Chosen at the opening screen's "who" beside the raven and remembered like the tile
(`we.lastSpecies`). Decided: a separate controller (`client/src/squirrelControl.js`) that
drives the same `flight.pos` and `flight.yaw` RavenFlight does, so the forest, grass,
minimap, identify, animals, acorn game and sound follow a squirrel unchanged; main.js
picks one controller per frame and flight.js and raven.js are untouched. The squirrel
runs at up to 6 m/s with a bound whose stride lengthens with speed, jumps a ~0.5 m,
3-4 m arc, sits up, and climbs any tree of the near set (not shrubs) by its drawn bole
(the variant's stem and the instance's rotation, through animals.js trunkAt) to 85 % of
its height; the camera chases at 0.6 m and 2.5 m, and on a trunk stands off the bark
over its shoulder and orbits with it. The ground is the drawn terrain mesh plus the tops
of the close rocks (a downward ray). The model is the AI squirrel's drawn mesh (a clone
of lod0 with its own aAnim and aAnim2), posed by the rodent rig from the controller.
Acorns: one in the mouth; E picks up, buries on open ground, digs up a dug mark, and on
a trunk takes a crown acorn within 1.2 m or runs out a limb to one within 3.2 m; no
stash holes. A dug-up acorn re-buried scores nothing (collector `dug` count in
applyEvent), so a cache cannot be farmed. The arrival is a short run down and out of
the oak nearest the chosen point. Rejected for now: a skeleton with clips (the brief's
"needs a real skeleton" stays open), a squirrel call (C is silent for a squirrel), and
other perception changes than the existing perception matrix.

## 2026-10-25: the acorn woodpecker is playable, a perch-and-fly controller beside the squirrel's

Chosen at the opening screen's "who" as a male or a female (two cards; sex remembered as
`we.lastSex`). Decided: a third controller (`client/src/woodpeckerControl.js`) on the same
`flight.pos` and `flight.yaw` contract as the squirrel's; flight.js and raven.js untouched.
Two modes as the bird lives: clinging on a trunk (the AI's `CLING_PITCH`, hitching in 13 cm
hops, up to the drawn fork) and short undulating flights (beats then a closed-wing dip of
about 30 cm as an offset on a pitch-driven line, 2.5-12 m/s), plus a rare perch on the
ground or a branch. Landing on a trunk is flying into it (within 1 m of the bark, facing it,
below the fork); S lands in a crown or near the ground. The model is the AI's procedural
woodpecker as one extra instance per sex. The player arrives on its family's granary (the
AI families' rule, exposed as `animals.familyGranary`); a family is spawned on it when none
lives there (`animals.familyOn`), and a player woodpecker flushes no woodpecker. E takes an
acorn (crown in reach or by a short flight, ground) and, carrying, at the family granary
hammers 2-3 s and deposits through the v2 `deposit` event, scored for woodpeckers. Acorns
near a small player's eye shrink to about life size. Rejected for now: depositing in any
granary (only the family's scores, as a family defends its own), a drawn bird with a real
wing fold (the brief's mesh lane), hovering (acorn woodpeckers do not), and a woodpecker
call.

## 2026-10-25: the dev server owns the acorn game's world; one browser per world runs the AI

The first multiplayer node, as the 2026-10-24 entry put it ("the dev server grows into
it; Rust is the candidate for the real node"). Decided: `server.py` holds one world per
tile and season in memory, persisted under `tiles/<tile>/game/` as a snapshot plus an
append-only event log, and is the authority: it checks every event with `applyEvent`'s
rules ported to Python (stash capacities from the same hash of the oak id), numbers it,
sends it to everyone in the world, and rejects the loser of a conflict; it runs the world
clock, the round and fall regrowth. Clients predict with the JS reducer and roll back on a
reject (`client/src/net.js`). Transport: a minimal RFC 6455 WebSocket in the standard
library (nothing in .venv provides one, and long-polling would need its own ordering and
acks). The AI collectors run in the first browser to join (the AI host), handed on when it
leaves, so each animal acts once per world; the others see the outcome and their own
animals' motion. A player is a hash of a random id kept in localStorage combined with the tile, season and round, so ids cannot be linked across rounds or tiles, and the node never stores an id beside a position: no names, no
addresses, no positions for pickups. Without the game endpoint the client is v2, offline.
Rejected for now: running the AI on the server (it would need the vegetation and the
animals' rules in Python, which is the Rust node's job), syncing animal positions,
accounts, and federating worlds between nodes. Details and limits: `docs/game-acorn-stash.md`
(v3).

## 2026-10-25: far impostors are lit from prefiltered normals, keep their cover to the horizon, and pines carry their needle light

Review of the far forest (impostors.js, impostorBake.js) after the needle, crown-density and sky
passes, judged from the start view, 150 m and 400 m up in four directions, and from 2 m across
valleys, at 10:00, 14:00 and 17:30 in fall and summer, with the real forest pushed out to 2.4 km
as the reference for the same trees. Findings: the bake is not stale (it runs at load from the
current treegen trees), and at the default 1.5 km hand-over the impostors matched the real trees
to within about 2% in front and side light; backlit they were 3.5% darker (4.6% with the near
900 m forest setting), because the pines' light through the needles stops at the hand-over. The
"pale salt" over the far forest seen in review captures is a capture artefact, not on screen:
alpha to coverage leaves the premultiplied canvas alpha below 1 on partly covered pixels, which
the near-black page hides but toDataURL and drawImage un-premultiply into white. Captures for
review should read the drawing buffer's RGB. Changes: (1) normals are averaged without
renormalising at every level and lit as the mean of max(n.L, 0) (a smooth max of the mean
normal's term and its spread), so a far crown shades as a crown rather than one arbitrary lobe
per pixel; (2) pines get treegen's wrap, light through the needles and backlit glow with the same
900-1500 m fade, weighted toward the crown rim (inside it the real crown's own shadow takes it),
compiled only into a material that can hold trees nearer than 1.2 km (the ring with the 900 m
forest; with the default 1.5 km the real pines keep at most a quarter of it at the hand-over, and
it cost 0.1 ms in the ring and 0.3 ms over the far billboards); (3) thinned far trees grow by
1/keep in silhouette area (width keep^-0.72, height keep^-0.28, was keep^-0.53 in total), so a
stand's cover holds to the horizon instead of opening into single trees on the skyline; (4) coverage-preserving mips shift the alpha instead of scaling it (no
saturated, square crowns at the coarse levels), trees sit inside a 6-texel cell margin and quads
are trimmed to what any level down to 8x8 texels covers; (5) slots that share a seed are baked
once (28 trees for 72 slots): atlas 60 to 23 MB, bake about 1.1 s to 0.45 s. Seam match after,
impostor minus real over the hand-over band (green, six views): -2.4% to +1.5% at 1.5 km (was
-3.5% to +1.2%), -0.8% to +3.2% at 900 m (was -4.6% to +1.5%). Start view GPU, five fresh loads
alternated with HEAD's two files, medians: 6.79 ms after, 6.80 ms before (rounds within 0.06 ms of
each other). Rejected: sharper alpha-to-coverage edges (they cured the capture salt by making
crowns blocky), a blend state that keeps the canvas alpha (0.45 ms at the start view for an
off-screen artefact). Still open: the per-cell swap when the
mid set moves is a representation change on a ring of trees at about 1.5 km (subtle, not a seam);
impostors cast no shadows (beyond the mid set the ground between far trees is unshaded); far
crowns of 2-4 px are still single blobs whose shape is set by 4x4-texel mips.

## 2026-10-25: human water is rewilded: reservoirs and stock ponds out, creeks restored through their beds

The foothill tiles have no large dam, but they are full of small ones: of 109 NHD waterbodies in
the two tiles, 71 are reservoirs or dammed stock ponds (69 ha), and the client drew every one as
open water the creeks ran into. A new build step after `channels` judges each waterbody from data
(NHD FType 436, OSM reservoir and basin tags, OSM and National Inventory of Dams points) and, for the
unmapped stock ponds, from the DEM: a pond under 1.5 ha whose ring is straight at its outlet with
the ground falling 1.5 m or more within 45 m beyond it has a dam. The test is stricter on creeks
draining 5 km² or more so their wide spots stay, and anything irregular or uncertain is kept (37
kept). Rewilded beds are not held as ponds by the routing; a shallow thalweg (0.2 m at the inflow
to 1.2 m at the outlet, one 5 m cell wide, down the middle of the flat by least-cost path away
from the old shore) is carved into a derived copy of the DEM, carried at grade through the
spillway or dam until the ground falls below it, and the channels step routes on that copy, never
on an edited `dem.tif`. The 300 m breach limit was never the problem: what held water after the
first attempts was a sill under 1 m (below the breach threshold, so filled) at the outlet; carrying
the grade past the outlet fixed it, and no tile needed a longer breach. Creek depth comes from the
DEM's long profile (local slope against the reach's own: steps are riffles, flats are pools) scaled
by a hydraulic-geometry mean depth from drainage area, and goes to the client as a 5 m RGB raster
that also carries the rewilded beds for vegetation and the erase to read later. Judging is always
against the present-day routing (snapshotted), so reruns agree. Alternatives rejected: drawing
the old reservoirs as dry pans (the dams would still be implied), refilling the beds to a guessed
pre-dam valley (no data under hydro-flattened water), a fixed sine pool-riffle pattern (the squirrel
had one; it ignores the terrain). Known misses: a 4 ha pond on Indian Creek with an irregular edge
is kept though it is very likely impounded; the dams themselves remain in the terrain
(`human_landforms_removed` stays false).

## 2026-10-25: the drawn animals call where they are, from what they are doing (sound.js near layer)

Decided: a "near" layer in sound.js, ticked 4x a second, that reads animals.js (species slots by mesh name,
the AI states by value, quail coveys, the flush event) and voices the animals close to the player, all
synthesised: the acorn woodpecker's rising "waka" rally (on landing, mostly at its granary, and now and
then on it; it replaces the old waka) and its hammering as dry knocks in step with the AI's peck rate; the
gray squirrel's chuffing alarm bark when the player comes within 15 m (its tail flicks on each chuff) and a
soft chatter; jays scolding within 20 m (the Steller's jay also gains its "shaaar" and whistle); quail
"pit" clucks near a foraging covey and a "chi-ca-go" assembly after a flush; a deer snort-wheeze once as
the player comes within 30 m of an active herd; a gray fox's rare night bark; a brush rabbit's rare
thump. Each has per-animal or per-group and overall cooldowns (a few calls a minute near animals), a
tighter distance model for soft sounds, and at most 6 of the 14 voice slots. C gives the player's
species' call (squirrel bark, woodpecker waka; a neighbour may answer). Rejected for now: hoofbeats (deer
do not flee yet), vole sounds, and copying any recording (CC0 references only for study). Needed from
animals.js for a closer fit: a deer flee state or event, and exported state constants.

## 2026-10-25: rewilded beds are meadow with a riparian corridor, read by habitat, cover, mix, erase and client

The rewild step left the old reservoir and stock-pond floors as the photo's water with nothing growing
on them. Now every layer reads channel_profile B: on the 30 m grid the bed becomes grassland (there is
no wet-meadow class, and adding one would touch every habitat table for a few hundred cells) and the
12 m corridor along the restored channel riparian; open-water cells get a meadow or young-gallery cover
so the client's counts are not zero; the species mix has two rows of its own (a meadow with scattered
oaks, blue oak standing in for valley oak; the corridor takes the tile's `riparian` rule because the
library has no willow, alder or cottonwood); the imagery erase synthesizes the bed from grassland
windows lit like the clean grassland nearby (not like the woodland on its shore, which the general
local mean would have used) and then the corridor from riparian windows, as separate passes after the
human erase so its output is unchanged. Cells LANDFIRE already sees as vegetation on the old shore
keep their class. The client takes the water mask from the present-day waterbodies minus the removed
ones, keeps a corridor cell's trees to the corridor, and gives the meadow a perennial grass share; the
squirrel's creek depth is water.js depthAt (the DEM's pools and riffles), replacing its sine pattern.
Rejected: a wet-meadow habitat class now (later, with sedge and rush in the grass library), and
erasing only the photo's water pixels inside the ring (NAIP here is RGB only: no NIR to tell murky water
from canopy). Known: the corridor's ground is summer-green photo canopy (riparian has no season
recolour), ponderosa is 15% of the corridor mix, and the dams are still in the terrain.

## 2026-10-25: the far hand-over is per tree and dithered; far trees cast into the largest cascade

The real forest used to end where the mid set (rebuilt every 200 m) ended, so each rebuild swapped a
crescent of trees about 1.5 km out between real and impostor at once (0.7% of the screen changed at
300 m up, the band 3% darker at 50 m). Now each tree hands over by its own distance to the bird across
a 70 m band (1209-1279 m with the 1.5 km setting; vegetation.js `handover`), the mid tree and its
impostor sharing the pixels with the complementary screen-space dither the tiers already use, and the
rebuild changes nothing on screen (0.000% at 300 m). The band sits 256 m inside the setting because the
mid set must hold every tree that can reach it until the next rebuild; moving it out by building a
larger mid set cost 0.75 ms. Nothing grows, thins or varies inside 1750 m. Beyond the band the far
impostors cast into cascade 2 as sun-facing crown ellipses, half of them at twice the area, within
4.5 km (their own instance buffer, so a map render costs about 0.5 ms, not 1.2 ms). The forest floor
1.6-3.5 km out is 2-3.5% darker, and the band just past the hand-over matches the real trees to -2.7%
to +0.1%. GPU at the start view, five alternated loads: 8.44 ms against 8.25 ms per frame. Rejected:
`flat` varyings for the per-tree share (0.85 ms on ANGLE/Metal), a dithered mid trunk (sub-pixel there),
and a canopy-cover darkening in the ground shader (it would not follow the drawn trees). Still open:
backlit summer blue oaks are paler as real trees than as impostors, now visible 250 m nearer, and the
mid set's 15 ms rebuild still lands every 200 m.

## 2026-10-25: the client runs three.js r186.1 on WebGLRenderer; the sky dome stays r170's

All four import maps (`client/index.html`, `lineup.html`, `lineup_animals.html`, and the
`?v=` default in `webgpu_test.html`) moved from 0.170.0 to 0.186.1 (released 2026-09-24),
same unpkg pattern. This is the first step docs/webgpu-evaluation.md recommends; the
renderer stays WebGLRenderer. Changes, from the migration guide r170 to r186:

- **Sky dome.** r183 removed the Preetham dome's legacy gamma curve ("not possible to
  restore the previous look with a different parameterization"), and by r186 the addon has
  a new sun disc, built-in clouds and no `up` uniform. Its fragment no longer contains the
  line `atmosphere.js` `attachSky` patches, so the haze, cirrus and cumulus would silently
  drop out. `client/src/preethamSky.js` is r170's `examples/jsm/objects/Sky.js` verbatim
  (MIT) and `sky.js` imports it. Rejected: re-tuning the new dome, because the haze in
  `ATMOSPHERE_GLSL` reuses the old dome's exact colours.
- **GLSL.** `inverseTransformDirection` is deprecated in r185 (now a `#define` alias); the
  two chunk patches that use it on a normal (`atmosphere.js` patchLambert, `rocks.js`) call
  `transformNormalByInverseViewMatrix`, the same maths.
- **Shadow type.** `PCFSoftShadowMap` is deprecated for WebGLRenderer in r182 and logs a
  warning; the two lineups use `PCFShadowMap`, which is now soft. The game's shadows are the
  hand-rolled cascades in shadows.js and do not use three's shadow map.

Checked and unaffected: every other chunk the onBeforeCompile patches replace exists
unchanged or with the same anchors (`color_vertex` now writes a vec4 `vColor`; the animal
patch in animalModels.js only touches `.rgb`), the update-range, render-target, DataArrayTexture, colour-space,
tone-mapping and GLTFLoader paths, and `Object3D.updateWorldMatrix` (r185) because nothing
sets `matrix` by hand.

**Measured** in the built-in browser (Chrome 152, M1 Pro, 1920x1080 canvas), with a
temporary harness that fixes the frame clock and seeds `Math.random`, HEAD's code on r170
against this code on r186, tile 690_4280: mean absolute RGB difference 0.002/255 at the start
view and 0.000 at 3 m, the same as two r170 loads against each other (0.003 and 0.000); the
oak, pine, water, rocks and animal views were also at or under 0.004. Five alternating
rounds, medians: GPU 12.20 ms (r170) vs 11.97 ms (r186) at the start view, 15.79 vs 15.92
ms at 3 m; CPU per frame 2.0 vs 2.1 ms and 2.6 vs 2.7 ms (0.1 ms timer resolution). That is
parity. The tree lineup differs by 0.017/255, at shadow edges (the PCF change). r186 draws
eight more numbers from `Math.random` while loading (object UUIDs), so a seeded run's
animals diverge once time runs; this is not a rendering change. Console: no new warnings
or errors; the existing `toNonIndexed(): BufferGeometry is already non-indexed` warning
remains.

## 2026-10-26: every source carries the credit line a client must show

A fresh-tile build showed the manifests recorded licences but no attribution, and
OpenStreetMap's ODbL requires one. Each source entry now carries license_url,
attribution (the exact line), attribution_url and attribution_required, with the rule
in the tile spec that a client or derived work shows every required line, linked, one
step from the main view; build_tile refuses a source without them and
audit_licenses.py fails on a missing or unmarked one; tools/patch_attribution.py added
the fields to the three existing manifests without changing another byte. Required
lines: "© OpenStreetMap contributors", Macrostrat CC BY 4.0 over the USGS SGMC, and
GBIF with its contributing datasets. Found in passing and to fix: the game client
downloads the full occurrence records, including CC BY-NC ones, to build its animal
density prior, against the 2026-10-23 decision; the prior must be built by the
pipeline from CC0 and CC BY records only, and the client given a credits panel.
Open: a GBIF derived-dataset DOI before any public release; the California Geological
Survey map's own terms under the SGMC.

Addendum, fixed: the pipeline now builds the prior (`client/species_prior.json`, layer
`client.species_prior`, build step `species_prior`) from CC0 and CC BY records only, a
byte per species per 100 m cell, and the client reads that and never requests
`species/occurrences.geojson`, which the manifest now marks `for_clients: false` (as
`species/seasonal.json`, whose monthly counts include every record). So the 2026-10-23
question of whether a surface derived partly from NC records is commercial use no longer
arises for the client. The cost: the home tile's deer prior keeps 11 of its 39 in-tile
records, and fox, coyote, brush rabbit and mountain lion (all their records NC) fall back
to the neutral prior, as a species with no records always did. The HUD has a "Data" link
to a credits panel built from the manifest's sources, required lines first, with the
GBIF datasets behind the prior and the model, texture and icon credits; the viewer's
sources table shows each line and its link.

## 2026-10-26: the riparian floor has its own season, a hue shift from the texture's own corridor mean

The creek and rewilded corridors (habitat 6) read teal in fall at 20 m: the photo there is
summer-green canopy and only grassland and oak were recoloured. masks.png has no riparian
channel, so terrain.js builds the weight from the 30 m habitat grid (bilinear, the same soft
edge masks.png gives the oaks) and pulls the texture's own linear riparian mean (interior cells
only, computed per texture at load) to a season hue in `SEASON_LOOK.riparian`, the ratio
normalised to unit luminance so the photo's light and dark survive, times a brightness:
fall yellow-ochre litter over damp soil (sRGB 0.48, 0.43, 0.28; x0.85; mix 0.75), winter
grey-brown over wet ground (0.40, 0.38, 0.32; x0.75; 0.8), spring yellow-green (0.54, 0.60,
0.28; x1.1; 0.65), summer the photo (mix 0). The present-day peek turns it off. Terrain shader
only: grass, shrubs and blades keep groundAlbedo as it was (there is little grass on the
corridor floor). Outside the corridors the start view is unchanged (0.13/255 mean difference,
terrain only). Rejected: a fourth masks.png channel (a pipeline rebuild for one weight) and the
grass-style ratio to a manifest mean (no riparian mean in the manifest). Known: the rewilded
habitat texture's riparian colour is itself teal, so that texture still shows teal corridors in
summer; the litter detail already wins under corridor cover, so its rule is unchanged.

## 2026-10-25: raids and pilfers score against the owner; the 8 m guard rule is the raider's browser's to check

Acorn game v4 (docs/game-acorn-stash.md, "v4: defence and pilfering"). A dig of someone else's
cache and a pull from a woodpecker granary (`raid`) score +1 for the thief's species and -1 for
the owner's (clamped at 0), and a stolen acorn counts as dug, so storing it again scores
nothing; a `mob` event drives the raider off (20 s, refused by the server) and a dropped stolen
acorn gives its score back. A raid comes free only when no family member is within 8 m: the
server has no positions (players send none, AI positions are not synced), so the raider's
browser (the AI host for the AI) checks it and the server trusts it, as it trusts acorn keys;
everything else (first wins, the granary holds one, room, raiding species, driven off) is
checked in both reducers. Families go out gathering 40 s in every 100 s, phased per granary
from the shared world clock, so raiding has fair windows and every browser agrees when they
are. A player's cache owner is kept in server memory only, never beside the cache's place.
Rejected: positions on the wire for a server-side distance check (a player id beside a
position, against the privacy rules) and a random away schedule per browser (the browsers
would disagree about when a raid is fair).

## 2026-10-25: the raven lands by contact, on the ground or on any limb that will hold it

Aaron: "if I fly into the ground or a branch I should attach to it and wasd should be hopping".
`flight.js` tests contact every 0.15 m of each frame's move: the body within 0.35 m of the
footing or 0.3 m of a limb's bark at under 7 m/s takes hold; faster, or against wood it cannot
stand on (a trunk, a limb steeper than ~44 degrees, wood under 1.5 cm), it bounces off with 85%
of its speed and a flare. The 2 m flight floor is gone. The limbs come from `perch.js`: each
near plant's wood in world space, read from the drawn instances and the cached skeleton
(`treegen.treeWood`, nothing regrown), on a 10 m grid, so a query costs ~0.01 ms. On foot the
raven hops (W/S 0.6/0.4 m, A/D 45-degree hop-turns, Space takes off, X hovers, E picks); the
walking gait is dropped because ravens on the ground mostly hop. Rejected: landing only on
tagged perch points (the player would hunt for them) and collision with the drawn leaf
geometry (too costly and leaves do not hold a raven). The squirrel's full-tree climb will use
the same perch queries. Verified: ground landing, perching on a live oak limb at 3 m with the
HUD "perched on an interior live oak, 3 m up", 0.6 m hops, take-off; no console errors.

## 2026-10-26: lidar gives the tile a 1 m ground and a crown list; the client keeps its 5 m grid

A `lidar` build step after `dem` reads the USGS 3DEP 1 m DEM and the 3DEP point cloud (Entwine Point
Tiles) from the AWS public buckets. The home tile is covered by CA_SierraNevada_B22 (flown 2021-11 to
2022-09, ending the year of the 2022 NAIP photo; the 2019-20 Upper South American collection also covers it
and is listed as the alternative): 2.08 G points, 21 per m2, streamed in 26 min by 16 processes,
decoded in memory with laspy/lazrs and reduced to 1 m grids, nothing raw kept. From them: a 1 m DSM and
canopy height model (pipeline only), 395 k tree crowns by local maxima and watershed in a 3.2 MB binary
the client reads by 100 m cell (`client/trees_lidar.bin`), a 10 m canopy height and cover raster, a 2 m
micro-relief residual against the client's 5 m heights (`client/terrain_detail.png`, 9 MB, 8-bit
linear so the GPU filters it), and a 10 m roughness that now multiplies the outcrop likelihood
(0.5 + min(sigma / 0.12 m, 1.5); cells above 0.5 went from 4.0% to 5.8% of the tile, the mean from
0.172 to 0.178). The client stays on the 5 m grid for distance and adds the residual near the player.
Rejected: PDAL (absent here, and it needs its C++ library, not a pip install), a full 1 m height grid for the client (400 MB, and only the
ground near the player needs it), a normal map for the detail (shading without geometry, so placed
things would float or sink), a 16-bit residual (unfilterable and twice the size), and the point-cloud
ground for the CHM (gaps under dense canopy; the DEM is the same ground points interpolated, and the
two agree to 4 cm). Found on the way: the client's `Heightfield.at` puts heights.png samples at
pixel corners rather than centres, a 2.5 m shift of the terrain against everything on the metric grid;
the residual is defined against pixel centres, so the client pass fixes that when it adds the detail.

## 2026-10-26: species follow the ground within a community, and the foothill shrubs are impostors too

The seventeen foothill species are placed by the species mix, and within each LANDFIRE community a species'
weight now follows the terrain of the cell (effective elevation band, valley floor or steep slope, north-facing:
`species_mix.py` `TERRAIN`), so valley oak stands on the floors, canyon live oak on the steep ground, black oak,
incense cedar and Douglas-fir come in above about 525-600 m (lower on north slopes, Douglas-fir almost only
there), madrone and bay on north slopes. Rows stay plain weights (one per community and distinct terrain
response; the client is unchanged), at the price of two-byte row indices and a 262 KB `species_mix.json`.
Rejected: per-cell weight rasters (format 1's way, retired the day before) and separate LANDFIRE-style rules
per elevation band (they would duplicate every community). The six shrubs join the shrub impostor field as
negative kinds with their own random stream, placed from the mix at an understory cover per habitat class,
because the canopy layer gives woodland and grassland cells no shrub cover; negative because `shadows.js`
treats kinds over 1.5 as grass, whose swaying shadows made neighbouring shrubs flicker. Cost: 26 species take
the start view from 239 to 417 draw calls and about 1.4 ms more CPU; the far atlas is at its 64-tree cap on
every tile. Details in species-library.md, "Integration of the foothill set".

## 2026-10-26: squirrels climb whole trees on the same wood the raven perches on

Aaron: "make it so squirrels can climb all the way up trees, and climb on branches as well". The
player squirrel's climb no longer stops at the fork: W carries on up the main stem into the
child most in line and thickest until the wood is 2 cm in radius; at a junction (a child stem
leaving within 0.4 m of the feet, ringed on screen and named in a caption) A or D take the
limb on that side, W runs it out to where it is 1.5 cm thick, S heads back, and with no
junction A/D go round the stem, to the underside with the camera swinging below. Space leaps
to wood within 2.5 m in the facing direction (never its own stem or a limb a junction would
reach), else drops with the legs spread and grabs the first limb it falls across; falls over
6 m stun for a second. E takes a crown acorn within 1.2 m of a limb (the old automatic run
out along a limb is gone). AI squirrels climb into the canopy on routes worked out once per
tree (about 0.3 µs a frame to follow), forage along the wood and come down the way they went;
a fleeing one takes the limb furthest from the player and freezes flat on it, so it vanishes
round the far side of the trunk. All of it reads `perch.js` (the raven lane's wood queries,
extended with joins, the fork, routes and children at a point) so the squirrel and the raven
agree on what wood is there. Rejected: a separate climb graph per species (two copies of the
same wood). Known: a blue oak's leaves fill the view in its crown, the leap camera drops to the
ground view, the leg spread is one blend, and on limbs sloped past ~27 degrees the squirrel
can go round instead of staying on top. Verified: a blue oak climbed to 7 m past the fork,
a branch taken and run out, a drop that caught a limb 3 m down, a gray pine to 17 m, a crown
acorn from a limb, a chase up the far side of a live oak; 45-46 fps, no console errors.

## 2026-10-26: the lidar's 1 m ground under the player, the 5 m heights beyond

Aaron asked for higher-resolution lidar terrain "and use lower res data for further away". The client
now reads `client/terrain_detail.png` (the 2 m residual) on a tile that has it, and draws it in a 2 m
mesh around the player: a square 110 m either side of a centre on the 10 m lattice, its vertices on the
residual's own pixel centres (odd metres), heights from `Heightfield.at` (5 m heights plus the residual,
both bilinear between pixel centres), normals from the mesh itself, so road cuts, gullies and terraces
shade and stand as geometry. The 10 m chunks drop their quads under the square (a hole in their index
buffer, so no overdraw, no z-fighting and no `discard` in the terrain shader); the square's outer 20 m
ease from the 10 m surface to the 1 m one, its edge vertices sit on the 10 m mesh's (an odd-metre edge
cut the corner at every coarse vertex and showed a crack), and a 0.6 m skirt hangs under the edge. When
the player strays 10 m from the centre a new square is computed into staging arrays against a 1.5 ms
budget per frame (a whole one takes about 1.4 ms) and swapped in in one frame with the hole; 26,418
triangles with the skirt. `Heightfield.ground` is the surface drawn this frame (the fine grid inside
the square, the 10 m triangles outside): the raven's and the animals' footing read it (main.js points
`flight.meshAt` and `animals.heights` at it until those lanes take it in), cached placement (grass,
shrubs, rocks) reads `at`, and the water ribbons carry both heights and pick the drawn one in the vertex
shader. Fixed on the way: the client read `heights.png` samples as pixel corners, 2.5 m off the metric
grid the pipeline writes (rasterio `from_bounds`, sample i at 5 i + 2.5) and the textures use; every
height is now 2.5 m east and south of where it was, in step with the texture. Rejected: a clipmap with
a 4 m ring (the residual is what matters within 100 m, and beyond it 2 m features are under a pixel);
`discard` over a coarse mesh left whole (costs early-z on the heaviest shader); hiding whole 1 km chunks.
Verified on the home tile: the Hwy 50 cut near x 9100, north 8790 reads as a flat bed between banks
(a smooth bowl with a ridge before); no crack in 120 low views along the seams (terrain alone against a
magenta clear); 51.5-51.9 fps against 52.9-53.7 with the fine mesh off, 38.6-40.4 against 40.7-41.3
flying at 25 m/s; the raven landed in the cut on the 1 m ground, 4.4 m below the 10 m surface there;
the two tiles without lidar load unchanged.

## 2026-10-26: trees stand on the lidar crowns; the oldest trees are the biggest real ones

Where a tile has `client/trees_lidar.bin` (the home tile), every tree is one crown: `crowns.js` loads the list
after the meshes are built (cellPlan keeps the shrubs; its tree draws are still taken, so the shrubs stand where
they did) and plans each crown once for the near forest and the far impostors alike. Species: the crown's 30 m
cell's tree mix by weight times a height fit (1 up to the top of the species' tallest class range, to 0.1 at
1.4 x that), else the row's tallest-capable species, so a 22 m crown in blue oak woodland becomes a gray pine or
live oak and a 34 m one in the ponderosa stand an old-growth pine. Variant: the age class whose height range holds
the crown, the tree scaled to the crown height (0.4-1.7) and widened toward the crown radius (aspect 0.8-1.25, so
readers that take the x scale as the size stay close). Old (veteran, old-growth): the top 5% by height plus radius
of the species within a 500 m block, or over an absolute height (blue oak 15 m, valley oak 25, ponderosa 40, gray
pine 25, else the old class's range top): 61.8 k of 395 k crowns (blue oak 24%, live oak 26%, ponderosa 5%, gray
pine 7%); snags at the file fractions (7.7 k). The 20 largest crowns per species carry a stable landmark id
(`blue_oak:308,258:1`, a 19.5 m blue oak). No crown is thinned for rocks, roads or the built footprint; 2.3 k on
water move to dry ground under their own crown. Result, home tile: blue oak 96 k, gray pine 111 k, live oak 69 k,
ponderosa 49 k, valley oak 16 k, canyon live oak 13 k. To pay for 40% more trees: rare species share meshes between
age classes (under 2% of the tile's trees one tree, 2-3% mature plus old, shrubs under 10% one; all tiles), and
beyond the far thinning start a crown tile's impostors keep 0.7 of what they would. Start view, before / after:
412 / 295 draw calls, 19.4 / 20.6 ms, 5.7 / 7.8 M triangles, 26.0 k / 33.9 k mid plants, 569 / 895 near, 203 k /
202 k far drawn (330 k / 431 k records), JS heap 568 / 566 MB, vegetation instance buffers 107 / 61 MB, 64 / 49
baked far trees. Over the ponderosa stand at 60 m: 660 / 458 draw calls, 25-27 / 23 ms. Placerville 383 / 278 and
Cosumnes 372 / 256 draw calls with identical placements. Rejected: a synchronous load before the constructors
(main.js is another lane's, and a blocking request on the main thread) and placeholder cell trees until the list
arrives (a visible swap); the cost is a shrub-only forest until the main thread first goes idle (about the first
frame). Known: rare species' old crowns draw their mature tree scaled; crowns over 1.7 x a tree's height are drawn
shorter than measured (the 40-54 m maxima, some of them lidar noise); the blue oak and live oak old shares follow
the lidar's tall crowns and are a tuning knob (`OLD_ABS`). Verified: the savanna at (4309, 3440) from 150 m
draws its oaks where the present-day photo has crowns (28 crowns within 120 m, blue oak, the five over 15 m old);
the ponderosa stand has 30-34 m old-growth pines over a 12-18 m canopy; the HUD's nearest tree, the acorn game's
oaks (10.9 k, 2.1 k acorns and 57 stashes near the stand) and a raven perched 3 m up a crown's blue oak work; the
far impostor of a crown is its own tree in 95% of mid trees (the rest an atlas sibling), same height and width.

## 2026-10-26: the squirrel's camera dissolves the leaves in front of it rather than leaving the crown

In a blue oak's crown the leaf cards filled most of the squirrel's view: the limbs are where the leaves are, so no
camera position near the squirrel is outside them. Decided: dissolve the leaf and twig cards nearer the lens than
the squirrel (round the lens, and in a screen-space capsule to the limb ahead), with a dithered edge, by a fragment
test `squirrelControl.js` chains once onto the vegetation's near and close canopy materials and close twigs; its
uniforms are zero unless the player squirrel is in a tree, so every other view draws as before. Wood across the line
is handled by swinging the boom round the stem to a clear side instead. Rejected: a 0.6 m over-the-shoulder camera
(the tail blocks the limb ahead and the leaves remain); orbiting to the side with fewer leaves (no cheap leaf-density
query: the perch index knows wood, not cards); placing the camera outside the crown with a longer lens (the camera
ends up ahead of the squirrel running out a limb). Cost: one branch on a uniform per leaf fragment; frame time the
same within the noise. The hook reaches into another module's materials from the squirrel's file (chosen to keep
this change in one file); if vegetation.js ever rebuilds its canopy materials, `leafCut` must be called again.


## 2026-10-26: beyond the fine square, the 10 m mesh passes through the 1 m ground and what is placed on it follows the drawn surface

Grass cards, shrubs and rocks place on the 1 m ground (`Heightfield.at`), but beyond the fine square the 10 m mesh
was built from the 5 m heights alone, so they floated or sank by the residual (on the Hwy 50 cut's banks grass cards
5 m, shrubs and rocks to 2-5 m). Decided, measured: the 10 m mesh's vertices are now `Heightfield.vert` = `at` on a
lidar tile (the far surface goes through the true ground at every vertex; `coarse`, the fine square's band and edge
pinning, the water ribbons' `aCoarseY` and the footing all follow), and cached placement is draped on whatever is
drawn: each instance is raised or lowered by (1 - `fineShare`) x (coarse - at) at its root, `fineShare` being the fine
square's own 0..1 band ease. `ClumpField` (shrubs and the three grass card fields) keeps a per-cell copy on the 10 m
mesh and blends only cells across the band, refilling when `Heightfield.fine` changes; `rocks.js` `seat()` moves each
instance origin on fill and on each square move; `animals.js` moves every animal within 1 m of the old surface by new
minus old (`groundIn`) when the square moves, since several still states keep their height. Grass shells move 1 m onto
the fine mesh's odd-metre vertices (normals over +-2 m as the fine mesh); on a lidar tile the terrain's rock rule
also takes the drawn mesh's own slope (`geoSlope`), so cut banks near the player take rock; the GPU placement page
samples heights.png at pixel centres and its CPU reference uses `base` (the GPU side has no residual).
Measured, |1 m ground - 10 m mesh| over 5000 random points of the home tile, 5 m vertices then 1 m-ground vertices:
p50 0.17 / 0.07 m, p95 0.74 / 0.51, max 3.36 / 1.77; slopes over 30 degrees 0.57 / 0.23, 1.52 / 1.18, 4.64 / 3.74;
convex crests 0.37 / 0.36, 1.09 / 0.96, 5.09 / 2.46 (mean +0.40 either way: the mesh cuts under a crest between
vertices). Vertex second differences on steep ground grew (p95 4.4 to 5.4 m); no spike shows on the cut from 400 m
or 2 km, and its banks now stand as benches instead of a 5 m bulge over the bed. Placed things outside the square
against the drawn surface, seven views (ground, 60 m, 400 m, 2 km): p50 0.23-0.44 m, p95 1.1-3.3, max 2.1-5.3 before;
0 after; inside the square (band included) p95 0.57 to 0.13, max 4.85 to 0.22. Shells against the fine mesh: p95
6.6 cm, max 27.5 to 0. Approaching animals placed 160-400 m off with the re-seat off: a buck floated 0.78 m, a doe
0.12, a jackrabbit sank 0.09; with it all within 4 cm. 192 low views along the seams of three squares (the cut
among them), terrain alone on magenta: no hole. Flying 25 m/s at 40 m, alternating: 36.5 / 36.9 fps against 36.5 /
36.1 with the re-seats off (the clump fields refill most frames in flight anyway); the GPU page's sweep matches (629
cells, 2.47 M plants, no difference); Placerville and Cosumnes load unchanged without errors. Rejected: placing far
things on the 10 m mesh and re-seating on the CPU per plant (the drape is exact and costs only the refill); a 10 m
tent-filtered residual at the vertices (same accuracy, smoother, but a filtering pass at load for no visible gain).
Known: trees (vegetation.js) still stand on `at` - 0.3 everywhere, so on crests beyond the square they float about
0.1 m on average; crests pop up by the cut-under (0.4 m typical, 2.5 m at most) when the square arrives, things on
them with them; a rock is re-seated at its origin only, its tilt still fitted to the 1 m ground; blades fade out
before the band and are not re-seated.

## 2026-10-26: trees are drawn on the surface drawn under them; a rare species' old crowns get its old tree up close

Trees (vegetation.js, the near, close and mid tiers) still stood on the 1 m ground less 0.3 m everywhere, so beyond
the fine square they floated or sank by the 10 m mesh's cut-under (on crests up to 3.5 m), and the far impostors
the same. Decided: the drape is done in the vertex shader. Each instance carries `seatDc`, the 10 m mesh minus the 1 m
ground at its root (computed at placement, once per crown), and is drawn raised or lowered by (1 - fineShare) x seatDc,
fineShare being the square's own band ease from two uniforms set each frame from `Heightfield.fine` (SEAT_GLSL in
lodPatch, so every tree and shrub material vegetation.js draws has it). The instance matrices stay on the 1 m ground,
so perch.js's wood, the squirrel's trees, `nearPlants`, the close copies and the acorn game's oaks are unchanged, and
inside 90 m of the square's centre (where a bird or squirrel can touch a tree: the square is never more than 10 m from
the player) the drawn tree is its matrix. Moving the square moves two uniforms; nothing is re-uploaded or re-indexed.
The 0.3 m sink is kept. The far impostors are always beyond the hand-over, so far outside the square: their records
are moved onto the 10 m mesh (`Heightfield.coarse`) lazily, the kept prefix of a chunk the first time a rebuild copies
it. Rejected: re-seating the near and mid matrices on the CPU and bumping `nearVersion`, as shrubs and rocks do. perch.js
keeps a plant's record, matrix and built stems by `species:seed:x:z` across near refreshes, so a tree first indexed
outside the square (every tree a bird flies to) would keep its draped matrix when the square arrived, and a bird would
perch on wood up to the drape (p95 0.5 m) off the drawn limb; it would also re-upload 34 k mid matrices every 10 m of
flight. Measured, trunk base (instance origin + 0.3 + the drape) against the drawn surface (`Heightfield.ground`), trees
in the camera's frustum over seven views (60 m, 155 m and 400 m above ground, looking north from 5134, 5934 toward a
crest at 5134, 6154, from 7124, 8004 toward 7124, 8254, east from 3000, 3000, and the start view), before / after: outside the square p50 0.07-0.12 / 0, p95
0.34-0.84 / 0, max 1.96-3.48 / 0 m (about 5 k trees a view); across the band p95 0.16-0.45 / 0.03-0.07, max 0.16-0.52 /
0.04-0.15; inside unchanged (p95 0.06-0.09, the fine mesh's 2 m triangles); far impostors in view p50 0.08-0.11 / 0, p95
0.47-0.68 / 0, max 1.6-3.0 / 0. The shader itself, read back from the GPU: a gray pine on the crest at 7124, 8254 (the 10 m
mesh 2.24 m under the 1 m ground), 145 m off from 60 m up: its lowest pixel on the 10 m mesh's row with the drape (37 against
37.6), 10 px higher without it. A raven perched on a blue oak limb at 5020, 5002 (feet 474.37 m = the limb's top), goto 2 km
east (the square with it) and back: the same perch record, the instance matrix bit-identical, re-perched at 474.37;
866 perch records against the near instances: none stale, the drape 0 within 80 m of the bird.
Rare species' old trees: on the home tile ten tree species are under 2% (alder, cottonwood, black oak, madrone, bay, walnut,
maple, ash, incense cedar, Douglas fir) and drew their old crowns as the shared mature tree, scaled up and capped at 1.7 x
(a 35.8 m landmark black oak was drawn as a dense 21.6 m mature oak). Decided: on a crown tile each such species gets its
old class's tree (the first seed) in the near and close tiers only. Its old crowns and snags stay in the shared tree's mid
set, tagged; refreshNear moves them into the old tree's near set with the matrix refitted to the old tree's own height and
crown radius (the plan's fit, crowns.js step 4), so the mid tree and the near tree have the same height and width at the
180 m hand-over; the oak records take the old tree's stem, height and class. The mid tier and far atlas keep the shared
tree. Draw calls (main pass, same session, old code / new): home start view 294 / 300 (three species with an old crown in
the near set), the 60 m view above the crest 410 / 418, 400 m over the ridge 221 / 223; fps within noise (start 61.5-64.0 /
63.9-64.0, 60 m view 44.3-45.0 / 42.3-44.8, 400 m 72.8-73.4 / 73.9-75.3); triangles at the start view 7.760 / 7.762 M.
Cosumnes unchanged (262 / 262 calls, identical placement sums); Placerville gained its lidar crowns from the pipeline during
the session and loads with the drape and eleven old near trees: 273 / 285 calls, identical placements, no errors. Rejected:
drawing the old tree for every crown of a rare species (its old crowns are 3-13% of them: most black oaks would be veterans);
a full mature + old set (all ten species have old crowns within the 1.24 km mid range from every view checked: about +20
calls, past the 310 budget); one merged geometry with both trees and a per-instance switch (perch.js reads a set's one seed:
a bird would perch on the other tree's wood). Cost: ten more tree builds at load (near, mid for the near trunks' shadow
caster, close: about 0.37 s with the pipeline running). Known: at the 180 m hand-over an old rare tree's trunk switches from
the old skeleton to the shared one (the canopies cross-fade), and the far impostor is the shared tree; shadows.js casts
from the instance matrices, so a tree beyond the square casts from the 1 m ground (off by the drape, under the far
cascades' texel); an animal resting on a crown beyond the square stands on the undraped tree (as before); if near matrices
are ever moved on the CPU, perch.js must key its records on the matrix too.

## 2026-10-26: the ground's colour by month is measured from Sentinel-2, not guessed from a palette

The base texture is one NAIP photo (flown 20-21 July 2022 over the home tile), and the client recolours it by
season with a palette ratio relative to the photo's own grass and oak means (season.js): a guess at what a foothill
January or October looks like. Decided: a `seasons` build step (`pipeline/fetch_sentinel.py`) composites every
Sentinel-2 L2A scene since 2019 with scene cloud under 40% into a median per calendar month over all years, cloud,
shadow and snow masked by the scene classification (dilated 3 px), at 20 m, and ships two 4 x 3 sheets of 500 px
frames (`client/season_rgb.png`, sRGB-encoded reflectance / 0.35; `client/season_ndvi.png`) with per-month,
per-class mean colours and NDVI in the layers (tile-spec.md, Seasonal colour). The client lane replaces the palette
with the measured ratio, month over July (the NAIP month), per pixel or per class. Home tile: 401 scenes (all MGRS
10SFH; the 10SFJ row only touches the corner), 397 dates with clear pixels, 2.72 GB of COG blocks read in 18.7 min
(bandwidth-bound at about 2.5 MB/s; 12 worker processes: 12 threads managed only a date per 15 s, apparently
serialised on the remote COG opens); a re-run reads nothing (533 MB of per-date looks cached under pipeline/_cache) and composites in 40 s. Clear
looks per pixel, median: 18 23 23 28 35 46 44 44 35 31 23 12 (January to December); no month refused; pixels under
3 looks filled from the neighbouring months are at most 1,614 of 250,000 (December). Mean NDVI over open grass
(grassland under 10% lidar tree cover): 0.51 0.59 0.65 0.66 0.52 0.31 0.24 0.23 0.22 0.23 0.28 0.37: green January
to April (peak April), turning in May, gold June to October (under 0.31), green-up starting in December with the
rains. Oak woodland and conifer stay at 0.65-0.76 all year; riparian stays green longest of the open classes (0.70
in May, 0.58 in July against grass 0.24). The July frame is the NAIP month, so the base texture is the gold season. Placerville (690_4280): 770 scenes (it lies where relative orbits 70 and 113
overlap), 3.48 GB in 27.5 min, looks 13-62, open grass 0.24-0.66; Cosumnes forks (680_4270): 400 scenes, 2.72 GB in
18.7 min, looks 14-45, open grass 0.21-0.72 with the deepest gold (August-September 0.21). Same calendar on all three.
Known: a month's frame carries that month's sun: November to January (noon sun 28-33 degrees) the north slopes are
dark, so a per-pixel ratio against July would darken them twice in a client that also lights the terrain; divide
the frames' brightness out, or use the per-class means. A 20 m pixel is a mix: under closed canopy the colour is the
canopy's, so the frames are the land from above, trees included; the tree-free ground colour is `open_grass`.
Rejected: one composite per season (green-up and browning each take a few weeks); per-year months (a single year's
January is 1-4 clear looks; 10-40 exist only pooled); reading at 10 m (over twice the bytes for a colour used at 20 m
and coarser); a Planetary Computer key (anonymous signing works). Copernicus's notice makes the credit line
("Contains modified Copernicus Sentinel data 2019-2026 ...") required wherever the colour is shown.

## 2026-10-26: the client shows the ground's measured colour for the date, on the photo without its trees

The client recoloured the summer NAIP photo by a hand palette per season (season.js SEASON_LOOK, terrain.js
groundRecolour), and the photo still held every tree crown, so in fall the ground under the 3D trees stayed canopy
green. Decided: on a tile with `client.texture_ground` and `client.season_rgb`, imagery mode draws `texture_ground.jpg`
(`?base=imagery` shows `texture_imagery.jpg` for comparison; the peek keeps `texture_present.jpg`), and each texel is
the base times a multiplier for the date, built on the CPU (season.js SeasonColour) into one 500 px texture (20 m,
RGBA8 holding sRGB(multiplier / 2), so 1 MB on the GPU and one bilinear fetch, no mipmaps; the ratio is smooth).
Per calendar month, per 20 m pixel: the linear colour of the month over July of the open ground (tree plus shrub
cover from the lidar 10 m grid: weight 1 under 10%, 0 at 35%; shrubs under 4 m stay green in July and damp the
ratio, oak open ground Apr 0.66 -> 0.60 red ratio with them excluded) of the pixel's own habitat class around it
(two 100 m box passes, sigma ~40 m, normalised by the open weight, shrunk toward the class's tile-wide open mean
with a prior of 0.15), so a canopy pixel takes its class's nearby open ground and never the canopy's colour. The
date blends the two months around it linearly from the 15th to the 15th; a season choice is its month's 15th.
Luminance rule: the hue of that local ratio is kept; its brightness is the class's on flat ground. Per month the
log luminance ratio of every open pixel is regressed on the slope's northness (n_north from the 5 m DEM over 20 m)
and the slope term removed (home tile: -0.39 in January, -0.28 in February, about 0 in summer), and the local
brightness left after that passes within +-12%. Measured on the home tile's open grassland, north- against
south-facing (northness > 0.2 / < -0.2): the frames' own ratio January 0.51 / 0.59 (N/S 0.86), December 0.59 /
0.72 (0.83); the multiplier 0.54 / 0.53 (1.03) and 0.66 / 0.63 (1.04); flat ground keeps 0.53 and 0.65, so winter
ground is about half as bright as July and greener, but a north slope is not darkened a second time under the
client's own low sun. Rejected: a blur alone (100 m leaves hillside-scale shading in); a cosine model of the
Sentinel overpass sun (10:45 solar time) with 0-40% diffuse over-corrected (north/flat 1.00-1.23 after, from
0.79-0.88); per-pixel luminance kept whole. Under closed canopy (lidar tree cover 50% -> 90%, smoothstep, 0.9 at
most) the multiplier turns toward litter: sRGB needle duff (0.40, 0.31, 0.22) under conifer, oak leaf litter
(0.43, 0.37, 0.28) under oak and riparian, half each under mixed forest, over the ground texture's own mean under
cover of 60% and more (the crown fill's flat beige: linear 0.28, 0.25, 0.16 on the home tile), on top of the sky
occlusion; not seasonal. The ponderosa stand (2958, 9835, cover 0.99) reads as brown needle duff from 20 m and
from 1.5 m in every month, where it was pale grey-beige. Riparian is a class in the multiplier, so in imagery mode
ripMix is 0; the rewilded habitat texture's grass, oak and riparian take the manifest's whole-class means
(open_grass, oak_woodland, riparian; month over July, linear) in place of the palette, oakMix 1. Grass blades and
tuft cards: the season's palette keeps its shape (root to tip, heads, awns) and its mean leaf colour is set, in
linear light, to the summer palette's (tuned against the July photo) times class grassland's flat-ground ratio
from the same build, so up close and at the hand-over they are the colour of the ground. A tile without the
seasons layers keeps the palette path unchanged (seasonOn 0, `measured` unset). Results, home tile at 4309, 3440
from 60 m and 1.5 m, and the same four dates on Placerville (2868, 5500) and Cosumnes (5751, 7400) and from 400 m:
15 January green and dark, 15 April the greenest (open grass ratio 0.35, 0.60, 0.51 against January's 0.39, 0.57,
0.48), 15 July the photo, 26 October gold-beige and a little darker (ratio about 0.88), no 20 m blocks or class
seams visible from 60 or 400 m, blades and ground the same colour at the hand-over. Cost: fps at the home 60 m view
38.3 before, 38.4-38.9 after (37.9 with the multiplier off, same session), at 1.5 m 37.5 / 36.5-36.7 (35.3 off):
within noise. GPU: +1 MB (texture_ground replaces texture_imagery, both 4000 px). JS heap about +25 MB (the 20 m
class, cover, open weight, northness, the July half of the blur, up to four cached months at 3 MB). Load: +6.7 MB
season_rgb.png; texture_imagery.jpg is still fetched (groundDetail.js reads its bare-ground mask from it). CPU on
a date change only: the first build at load 0.56-0.63 s (prepare, July, two months, litter), a date needing two new
months 0.29-0.34 s, a date in cached months 26-60 ms; nothing per frame. `__we.setDate('MM-DD')` and `?date=MM-DD`
set the day. Known: open ground in the oak woodland and chaparral classes greens much less than grassland
(April red ratio 0.60 against 0.34, with shrubs excluded; it is measured, not contamination: the strictest
openness gives the same), so oak savanna floor reads grey-olive in April beside emerald grassland; barren cells
(class 8, about 0.8 grey in April) stay pale all year; the litter is one colour per class with no seasonal leaf
fall; the October gold is the July photo's grey-beige slightly darkened, not more saturated.

## 2026-10-26: a reptile rig template with a spine wave; lizards sit on the drawn rocks and bark, and live only near the eye

The western fence lizard is the first reptile, and the part rig's templates could not pose it: it walks with its legs
splayed out to the side, swinging about the vertical rather than fore and aft, and its body and tail bend side to side
in a wave. A new `reptile` template (`REPTILE_BODY`, picked by the GLB's `extras.rig.kind`) keeps the one-draw, four-
float scheme: phase drives the diagonal legs and a wave travelling down the spine computed from each vertex's z (the
rest pose is straight), so no extra attribute is needed; pose below 0 basks and above 0 does the push-up about the hip
axis; aAnim2 carries the C-bend, the tail-tip whip, a blue flash and the sex. A lizard is 0.18 m long, so it is placed
on what is drawn rather than on data: the top of a rock is found by rays on that rock's drawn close tier (rocks.js's own
instance and geometry, read only), a trunk's bark by perch.js, which means an instance needs a full orientation (pitch,
yaw and roll from the surface), which the matrix already allows. Lizards are spawned within 70 m and drawn and thought
only within 25 m of the eye, and placed lazily (two a frame) when first in reach, so from the air they cost nothing. Their
activity reads an air temperature from the month and hour (Placerville normals), the first in the client; it is a
stand-in until the atmosphere has weather. Rejected: a skinned clip set (a second draw path for one species); placing
on the rock plan's matrix alone (the top of a deformed icosphere is not where its matrix says); spawning lizards with
the 400 m live set (120 small animals would fill the cap far from anyone who could see them). Wild turkeys and ground
squirrels needed no new template (bird and rodent, with the build lanes' constants); turkeys roost on the drawn wood
through the squirrel's limb queries where the wood is known and are simply not drawn where it is not.

## 2026-10-26: the turkey, ground squirrel and fence lizard are heard from what animals.js says they are doing

The three new animals' sounds are synthesised like the rest of the soundscape, and each is tied to the AI rather than
to chance: the turkey's flush and the ground squirrel's alarm are animals.js events (`turkeyFlush`, `gsAlarm`), the
settling flaps, the squirrels' scuffle and the lizard's scuttle are state changes the near layer already watches for
(flight to perch, a dive ending in a burrow, the sprint), and the gobble comes from a real tom within 300 m in its real
season and hour (March to May, first light to two hours after sunrise, the sunrise solved from the latitude and the
season's noon elevation so it matches the drawn sun). Voices go on the near layer, sharing its NEAR_MAX slots,
cooldowns and log, so a crowded scene drops a call rather than piling them up. The gobble is shaped to what is
measured of the real one (about a second, a 10-14 Hz pulse train, a voiced tone rising then falling); the ground
squirrel's alarm is the whistle near 5 kHz; the lizard, otherwise silent, only makes a sound with its feet and only
within 6 m. The ground squirrel's sentinel is found as the member that dived without a wait, because the event
fires after animals.js has cleared `g.sentinel`. Rejected: samples (the soundscape has none); a timer for the settling
flaps and the scuffle (they would be heard where nothing is landing); every bird of a flush as its own voice (fifteen
voices for one event would starve the slots); a gobble from the habitat fallback when no flock is near (a gobble
without a turkey is the kind of mismatch the near layer exists to avoid).

## 2026-10-26: two San Francisco cells built from scratch as a stress test; the JSON writer refuses NaN

Aaron asked whether a San Francisco tile would take long; the answer was "about three hours a cell, and these gaps
will show", and he said go. Two cells cover most of the city: `utm10n_540_4170` (Twin Peaks, the Sunset, Ocean
Beach) and `utm10n_540_4180` (the Richmond, the Presidio, the Golden Gate, with the Marin Headlands across the
strait); downtown and the bay shore fall in `utm10n_550_4180`, not built. Every step ran unchanged: 31 min and
93 min, far under the estimate, because the lidar over the sea has no points to fetch and the city has fewer crowns
(32k and 82k against the foothills' 400k). The licence audit passes on both.

What the stress test found, in the order it matters:

- **The sea is not there.** The 1 m DEM carries bathymetry (the strait floor is at -95 m, the beach shelf at
  -11 m), the client labels it "water" from the masks, and draws it as terrain wearing the photo of the waves.
  The channel step routed 185 km of streams across that seabed. A sea surface (level, waves, surf, tide, fog) is
  a client feature of its own and the first thing a coastal tile needs.
- **The city is still legible.** The erase step rewilds the built pixels (46% of the Sunset cell, 21% of the
  Richmond cell) with synthesised ground, but the roads step keeps every street as a decayed clearing, so the
  grid is baked into the hills as a lattice; and the lidar crowns are the street trees, planted in rows along
  it. Rewilding a city needs a whole-tile rule (streets gone, blocks as one habitat from the pre-settlement layer),
  not the few-roads rule written for the foothills.
- **The Golden Gate Bridge is a row of 64 m trees.** The crown finder drops crowns on OSM buildings, not on
  bridges; the towers and cables became about 180 crowns clamped at the 8-bit height ceiling (63.75 m) in a line
  across the strait. The ground under it is right (the lidar classed the deck as non-ground).
- **The species are the foothills'.** The habitat layer maps the coastal scrub to "chaparral" (29% of the Richmond
  cell, 52% water) and the tree library has no coast live oak, Monterey cypress or pine, so the Presidio is gray
  pine, ponderosa and blue oak. The mixes still match LANDFIRE, so the fix is library content, not pipeline code.
- **Coast and headlands read.** Twin Peaks, Mount Davidson, Lands End's cliffs, Crissy Field's beach and the
  Marin Headlands across the strait are recognisable from the air; the lidar ground is as good as the foothills'.

One real bug: the lidar DEM check over the sea wrote `"rms_m": NaN` into the Sunset cell's manifest (Python's
`json.dump` allows it; browsers' `JSON.parse` does not), so the tile loaded nothing. `write_json` in
pipeline/config.py now replaces non-finite numbers with `null` and dumps with `allow_nan=False`, so no manifest
can carry one again. The two cells' building footprints (99 MB and 45 MB of OSM geojson) are git-ignored and
regenerated by the osm step, unlike the foothill tiles' small masks. Rejected: a special case in the lidar check
(the writer is the one place every manifest passes through); building a sea before showing the tile (Aaron
asked to see what the pipeline makes of a city as it is).

## 2026-10-26: the lens is a URL parameter, so the field of view can be judged by eye before it is changed

Aaron asked about matching the viewport's "focal length" to the human eye. The raven's camera has been a 70 degree
vertical lens since the first flight, about 103 degrees across a widescreen window: a wide-angle lens, which shows
twice what a window the size of the screen would and makes the hills read small and far. The eye has no focal
length, but a view is undistorted only when the camera's field of view equals the angle the screen fills in the
eye, about 45-50 degrees across at a desk (under 30 vertical); games settle between 60 and 70 vertical to keep
the peripheral view and the feeling of speed. Rather than pick, `?fov=<degrees>` (30-110) sets the lens and
`__we.setFov(deg)` changes it live, so 45, 55 and 70 can be compared on the same hill. Checked on the home tile:
at 45 the Hwy 50 ridge and the pines loom as they do in life and the raven, whose chase camera sits at a fixed
distance, fills more of the frame (a chosen narrower default would want the chase offset scaled with the lens).
The woodpecker's flight lens (52) is now the narrower of itself and the raven's, so a narrow lens never widens
when the bird takes off. Depth of field is a different thing and was not added: in daylight the eye focuses at
infinity on a hillside and blurs nothing past a metre or two, so a flying raven would see none; it would earn
its place only in the squirrel's and woodpecker's close cameras. Rejected: changing the default now (his eye
decides); a post-process blur on the raven's view (a film look, not a human one).

## 2026-10-26: a dense-urban rule rewilds a city whole; the crown finder runs again after the masks exist

Aaron chose the whole-tile rewild as the first lane after seeing the San Francisco cells. The rule is per area, not
per tile, so the foothill tiles are untouched: pipeline/urban.py marks densely built ground (`footprint/urban.tif`,
5 m: building cover within 100 m of at least 15%, or 7.5% on LANDFIRE's medium and high intensity cells; kept
within 25 m of a building, closed by 40 m so the streets between blocks are inside, holes under 3 ha filled,
patches under 75 ha dropped, because Placerville's densest patch is 47 ha and Sausalito's, the smallest city
patch, is 93 ha). Inside the mask: every street but motorways and trunks weighs 0 in roads.png (no pavement, no
verge); every pixel is erased and synthesised from clean ground of the cell's rewilded class, whatever the
development intensity, with the local colour from a 150 m gaussian of clean ground easing to the class median deep
inside (the old box filter drew lit squares around parks) and sparse classes borrowing their fallbacks under 200
windows; and lidar crowns go unless the 30 m rewilded class is oak woodland, conifer or mixed forest or riparian
(the street trees go with the streets; the Presidio forest and Golden Gate Park sit outside the mask and keep their
real trees). Bridges: fetch_osm keeps the bridge tags and fetches man_made=bridge outlines, and the crown finder
drops crowns within 35 m of a motorway or trunk bridge, 20 m of another road or rail bridge, 8 m of a footbridge
(20 m would have taken 128 boardwalk and park trees) and 10 m of an outline. Checked in the client: the Richmond
from 260 m is a scrub plain with no grid; the strait has no tree line. The city fill is honest but flat, a near
uniform olive; the texture still shows the bridge deck as a photo strip (a deck is its road's, not erased).

Numbers on the Richmond cell: road fraction 3.8% to 1.5%, erased 21% to 25%, crowns 82k to 28k (54k of them on
buildings that the first build never dropped, because the lidar step ran before osm and had no footprints; 626
on the bridge, 17.8k street trees); on the Sunset cell crowns 32k to 15.6k. That ordering was the real bug: the
lidar step runs first (its point cloud streams for an hour) and so its crown list knew no buildings, bridges,
classes or mask on a fresh tile. The products stage now also saves the multi-return share (`vegetation/multi_1m.tif`,
uint8) and a `crowns` build step after derive re-runs the finder from the CHM and that raster, with everything it
drops on in place; `build_crowns` falls back to the kept grids on a tile from before the raster. Rejected: moving
the whole lidar step after derive (the ground step reads its roughness); a tile-level "city" flag (a few blocks of
Placerville are not a city, and a coastal cell is half sea).

## 2026-10-26: the opening screen is the map cards and a season slider, nothing else

Aaron's words: "Remove title & subtitle. Make cards big - 9:16, full bleed map, location title over map. Remove
metadata tags. At the bottom of the screen is a slider from Spring to Winter with titles for summer and fall in
the middle." With the player now entering every world as a spirit (the next entry), the "who" cards go too, so
the screen is where and when and nothing else. Each built tile is one portrait card, 9:16, as tall as the space
above the footer allows, the tile's photo full bleed (its square middle, panned so a typed arrival point near an
edge stays in view) and darkened at the foot, titled by its two best-known roads (length times class: "Route 50,
Mother Lode Drive"; the tile id small under it; a tile without named roads shows its id) with the selected card
ringed and the rest dimmed; the row scrolls sideways and centres the chosen card. The season is a day of the year
on one track: Spring at the left end is March 20, Summer's title at a third is June 21, Fall's at two thirds
September 22, Winter at the right end December 20, a day per step between them, today marked and the thumb on
it; the game gets `date` ('MM-DD', or null on today so it keeps tracking the calendar) and the season of that
date, so the measured monthly ground colour follows the slider. Later the same day, on his word: the track is a
bar across the top and the cards fill everything under it; the caption is off the screen (the arrival flight
still shows it); the lat/lon find row is gone (a point on the URL still preselects the dot, and the in-game
Location box reaches and builds other tiles); and while the tile loads the chosen card wears a scrim with a
spinner and the live status under it, the spinner becoming the Begin button in place when the world is ready
(so Begin cannot be pressed early any more), a click on another card showing its spinner before the reload. The
screen's styles moved out of index.html into client/opening.css so it can be reworked apart from the HUD.

Through the evening, each on his word as he watched the working files: nothing is selected when the screen opens
(all cards at full brightness; a click brings one forward at 1.08 and steps the others back a little, 94% and
80% brightness, no blur); the cards are centred vertically with the same margin below as above the row (the
slider bar's band, about 140 px), the height following from that and the width from 9:16, a 14 px gap; the
title is the tile's locality top-left (OSM place names, a new `places` list in features.json: El Dorado,
Placerville, Nashville, Daly City, Richmond District) with the roads line small under it, no tile id and no
arrival dot; DM Sans throughout; the selected card's ring, glow and Begin take the track's own colour under the
thumb, sliding from spring green through summer gold and fall amber to winter blue, Begin filled with it in
black text and centred on the card; the loading spinner is the spirit's own wisp (the `Wisp` export, on a
transparent three.js canvas over the screen) imploding into Begin on ready; and as each species' model loads
its animal pops in with a spark of light, one at a time in random order, the ground animals grouped on the
page background in the bottom margin under the selected card and the birds on slow orbits round its top, all
at one true scale from the deer (so the fence lizard and the vole are specks, as in life; his call whether a
floor is wanted). The label above the thumb reads "Oct 26 • clear, 20 °C": the date and that day's weather on
the prepared tile, that day last year from client/weather.json for a chosen day and today's from the dev
server for today, the words from weather.js's `summarizeDay` (loaded apart, with a small table of WMO codes
until it arrives, so the screen opens without it). Rejected: a four-stop season picker (the slider is a date,
and the ground colour is monthly); keeping the species cards as a "who" (the spirit chooses by touch instead);
cheating the smallest animals' scale (he asked for the deer's scale for all).

Then, seeing the wisp and the pop-ins stutter ("very slow and jerky"): the cause was the world building on the
same thread behind the screen (shader compiles, crown placement), which freezes any WebGL drawn from JavaScript,
while CSS animates on the compositor. His choice was to keep them pre-rendered: a dev-only render page
(client/tools/opening_sprites.html, PNGs saved through tools/sprite_receiver.py and converted to WebP) draws
the wisp from straight above flying one circle per loop, chasing its tail, 48 frames on one sheet (two laps
cross-faded, since the weave is not periodic over one), and each species once in the lineup's light at one
scale, 268 px per metre, into client/assets/opening/ (968 KB in all, the sheet 882 KB at quality 70). The screen
plays the sheet by CSS steps() with a glow pulse and an implode into Begin, and places the stills true to
scale under and around the card with CSS pop-in and glimmer keyframes, their delays set once as each image
loads; openingScene.js and the canvas are gone, and the screen has no animation loop. Hovering a card (pointer
only) starts the same step-back on the others as a click. Known: faint straight lines in the wisp frames
where ribbon ends point at the camera; a card at the end of the row runs its lineup a little past a phone's
edge. Then, on his words, the lineup is centred in the black band under the card (the deer's middle at the band's
middle, the group centred under the card), the other cards recede further once Begin shows (86%, 60%
brightness) and keep the same 14 px gutter as they shrink (a sideways shift per card laid edge to edge from the
one in focus, a few lines of JavaScript run only on a change, the motion a CSS transition; hover is tracked
with pointer events so the same layout serves it). His "30-40 s before hover works" was measured to be the
world build blocking the main thread (11.7 s of long tasks in the first 40 s with no animal image loaded), not
the animals, so they stay and the build is being made to yield. Then his simpler cure for the stall: the screen opens dark with only the circling wisp and the status line
(the map images and the prepared tile's stills preloading meanwhile), and when the world is ready the wisp
implodes and the slider and cards rise in together, all at full brightness and nothing selected, so nothing
interactive is on screen while the build blocks the thread; another tile returns to the dark phase. Rejected:
removing them (his call: keep, pre-rendered); animating them live only after ready (they are the loading
indicator).

## 2026-10-26: the player arrives as a spirit and becomes the animal it touches

Aaron's words: "I'd like for the user to start out as a spirit. A glowing, swirling wisp with the same controls as
the raven, but can fly even faster. Whenever the spirit comes into contact with one of the species that can be
piloted, they 'jump' into the body and the controls/interface change to that species. There is a 'back to spirit
form'." client/src/spirit.js holds it. The spirit flies on RavenFlight's keys through a `spirit` flag in
flight.js: cruise 25 m/s, 90 with W held, no stall physics, never a landing (it skims 0.8 m over ground and limbs);
the raven's models are hidden. Contact with an AI raven, gray squirrel or acorn woodpecker (2.5 m from its body,
4 m for a bird in flight, checked every 2 m along the frame's path so 90 m/s cannot skip a squirrel) makes the
player that animal where it is, through the control's own entry (`enterAt`): the AI animal is held out of the
population meanwhile (no double) and resumes its life where the player leaves it, `B` or the panel's "Back to
spirit form", from any state of the squirrel (ground, wood, mid-leap, stunned) or woodpecker (cling, fly, perch,
work). Animals cannot see the spirit, so nothing flees it. The camera never cuts: `CameraBlend` in spirit.js,
called by main.js around the render, eases position (held above the ground), orientation, lens and near plane
from the old view to the new control's own over 0.8 s, up to 1.4 s when the views are far apart, both ways.

The wisp, after his "more like ribbons or mist": three camera-facing ribbons following the recent path and
weaving round the centre at lengths 1 : 1.4 : 1.9 with weave periods 1 : 1.31 : 1.73 (so they never line up),
seven noisy mist billboards drifting round a small warm core, a few dim motes streaked along the velocity; three
draw calls, no light (adding a light recompiles every lit material). At rest it is half size and 60% brightness
and swells to full from 14 m out to the contact radius, so the pull is felt before the jump. In spirit mode the
world is faint, misty and blue-green, by his steer "just make the sun faint and blue": the Atmosphere hands a
faint blue sun, blue-green sky light and thicker blue-green haze to every material, a veil covers the sky, and
the three playable species are drawn self-lit in full colour with a warm glow that brightens on the wisp's swell
curve; fades in over 0.9 s as the wisp forms and out with the camera blend. Everyone enters as the spirit, from
the opening screen and from `?skip=1`; `?skip=1&as=raven|squirrel|woodpecker` keep the old starts for tests.
Three fixes he picked from the open list the same night: the spirit's dusk keeps a floor of sky light and mist
(`LOOK_FLOOR`, `LOOK_HAZE_FLOOR`) and the veil thins toward the sun with a blue-violet glow that follows the
sky's own sunset until the sun is 17° down, so 17:30 is a violet horizon over readable land and 19:30 a moonlit
blue; fall leaves and gold grass, khaki under the blue sun, go grey-blue-green through a spirit-only post pass
(the scene copied and a full-screen pass pulling warm hues toward blue-green with a small contrast drop, then
camera layer 1 redrawn over it with depth testing: the playable species, their glow, the veil and the wisp stay
warm and are still hidden by hills; `POST_WARM`, `POST_CONTRAST`; about 1.5 ms a frame at pixel ratio 1.5); and
the spirit's wind is a lighter, airier hiss that is the raven's loudness by 30 m/s and barely rises to 90
(`SPIRIT_WIND`, `SPIRIT_WIND_RISE` in sound.js). The wisp is exported as `Wisp` (an Object3D with `animate`,
`setSwell`, `dispose`, no dependency on the flight or the atmosphere) for the opening screen's spinner. On his
"make the sky the same color as the mist" the veil takes the haze's own horizon colour (the atmosphere's
three-line formula copied into spirit.js, after the look's tint and floor, through the same tone mapping),
nearly opaque and uniform from the horizon up, so the far trees fade into the sky with no edge. On his "when I
turn, the tail should trail behind me like a ribbon" the ribbons follow the path flown rather than the heading:
the wisp keeps its past positions every 0.15 m (filled in along each frame's move, up to 160 points), each
ribbon's strip runs back along them with its weave round the path (a gentler twist along a long trail), the
longest about 0.8 s of travel capped at 14 m and scaled by the swell, blended from the hover curl below
1.5 m/s to the full trail above 10 m/s, so a turn leaves a curved trail hanging in the air that the body pulls
away from (`TRAIL_*` constants beside the ribbon ones). Escape leaves a body too (his ask), but only when it
closed nothing else: the field guide and the species card take it first and the credits panel holds it while
open. Still
open: the acorn game counts the player as a raven. Rejected: a post-process tint first (the lit route first,
the pass only for what the light could not cool); a pull-in before the switch (the body takes over on contact,
input during the blend).

## 2026-10-26: every day has weather: last year's hourly weather per tile, today's live, drawn as sky, mist, wind, rain and snow

Aaron's words: "Every day has weather. The weather is today's weather for the square. Picking a season picks a
random day between pre-dawn and post-dusk in the season to start, and the weather is the weather from that day
last year." The data: pipeline/fetch_weather.py (a `weather` step) takes the tile centre's hourly weather from
Open-Meteo's archive (temperature, humidity, precipitation, rain, snow, snow depth, cloud by layer, wind, WMO
code) for last year and this year to date into client/weather.json, about 630 KB a tile (manifest layer
client.weather, source open_meteo, CC BY 4.0 with the credit line; the free API is for non-commercial use, which
the spec notes). The hours are local wall-clock time: Open-Meteo reports on one fixed offset for the whole
file, which put winter rows an hour ahead, so the fetch is in UTC and converted with the zone's own rules, the
two changeover days padded or trimmed to 24 rows and sunrise/sunset checked against the daylight flag. The dev
server answers GET /api/weather/<tile_id> from the forecast API in the same shape plus `current`, cached 30 min;
only the tile id reaches the server and only the tile centre reaches Open-Meteo.

The client (client/src/weather.js, `__we.weather`): today is today's weather from the server (then today's rows
in the file, then the same day last year), starting at the current hour held inside pre-dawn..post-dusk; a
chosen day ('MM-DD') is that day last year at a random hour between sunrise - 30 min and sunset + 30 min, the
time slider's range set to that span; 'YYYY-MM-DD' names an exact day for tests. Hours between slider steps
interpolate the rows, looked up by name. What it drives: low and mid cloud set the cumulus layer's cover
(calibrated so 28% reads as a scatter and 100% a full deck) and high cloud the cirrus, the deck greys and
flattens the light (the sun to 45%, sky light up 35% and grey) and the cloud base comes from the dew-point
spread; humidity raises the haze by sqrt(0.5 / (1 - RH)) and fog (a fog code, or saturated air under a
ground-level deck, less with wind) lies dense in the valleys; wind sets the grass and trees' sway, the clouds'
drift (the fixed westerly is gone) and a floor under the airspeed wind in the soundscape; rain is one Points
box of up to 7,000 streaks round the camera, leaning with the wind, thinner for drizzle, with wet ground
darkening (`wxGround`), lower far contrast and a rain layer of hiss and patter louder under canopy; snow is
drawn only at 0.3 cm/h and about 2 °C or colder and lies at 2 cm depth or more, whitening the ground, the grass
blades and cards, fullest on flat and north-facing ground and thinner under trees; thunderstorm codes flash the
sky with a delayed rumble (none in the data yet); the measured temperature is the lizards' air temperature. The
HUD gains "weather: light rain · 11 °C · wind 34 km/h SE · last year's 4 Feb", the Data panel the Open-Meteo
line. The spirit look composes on top of the weather, except that the weather's extra haze is added after it
(the spirit thickens the haze fourteenfold; rain or fog under that was a white-out). Checked: a February rain
day on the home tile (grey deck, wet ground, slanted streaks), a March morning on the Placerville tile with
5 cm of snow white under the conifers, a misty October dawn, a windy March day, and today; 60 fps with rain on
or off. Open: the reanalysis has no fog codes (fog comes from humidity and low cloud), falling snow is subtle,
gusts are synthetic (the file has no gust column), the drawn sun uses the season's middle day rather than the
date (season.js), and the pipeline's lanes and the screen's each copy a small WMO table. Rejected: fetching
weather in the browser from Open-Meteo directly (the server proxies it, so the client makes no third-party
calls); a per-season weather instead of a real day (he asked for the day).

## 2026-10-26: every species is playable through two generic controls, parameterised per species

Aaron: "Can you make the other animals playable." Fifteen bespoke controls would be weeks; two generic ones cover
them, with the species' own behaviours (the hawk's stoop, the lion's stalk, the deer's herd) as a later layer.
client/src/groundControl.js drives everything that walks (deer, fox, coyote, lion, brush rabbit, jackrabbit,
vole, ground squirrel, lizard, and the turkey and quail on foot) on the squirrel's footing, terrain and water code
without the climbing: W builds from a walk to the run (the deer walks, trots, gallops; Shift+W walks, the lion
stalks), S backs, A/D or a drag turn, Space jumps (from a run the quail and turkey flush instead: a whirring
climb, a glide, a landing), Shift is alert or sitting up (the lizard's push-ups), E grazes, sniffs, pecks or
scratches, X lies down, hunches or basks; water stops the small and lets deer, coyote and lion wade; trunks push
the body aside. One table (`GROUND`) holds each species' walk and run speeds, jump height and length, wading
depth and chase camera (the vole's 20 cm behind and 7 cm up, in the grass; the lion's 3.5 m back).
client/src/flierControl.js flies the hawk, vulture, scrub-jay and Steller's jay on RavenFlight with a per-species
parameter set (flight.js takes one; with none it is the raven as before): cruise and top speed, flap rate, H
soars the hawk and vulture in a slow circle that holds height (A/D tighten or widen it), the chase camera scaled
by wingspan, and perch.js takes a per-species perch rule (the hawk only on snags and pines, 5 cm wood 5 m up).
client/src/playable.js maps species to control and short name (`?skip=1&as=deer|fox|coyote|rabbit|jackrabbit|
quail|scrubjay|stellers|vulture|hawk|lion|vole|turkey|groundsquirrel|lizard`). animals.js can take and give
back every species (a group's lead passes to another member; a released animal re-enters one of its own AI
states: the vole a new runway, the lizard a new home, a rabbit a new form if moved over 30 m), and the AI
animal's size, sex colouring, antlers, pose and stride carry into the body. The spirit routes a touch to the
right control. Checked: the deer walking into a gallop, jumping and lying down, then released bedded; the fox
and hawk entered by touch with their HUD and perceives; the hawk soaring on H; the vole's camera in the grass;
the quail's flush; the lizard basking; the camera blend across all. Not yet: swimming, climbing (the fox stays
down), a flushing bird through trunks and no tree landing, the hawk and vulture standing low and hunched
(flight meshes with no legs or folding wings), the new species outside the acorn game, shrubs hiding the deer
from its camera; coyote, lion, both rabbits, ground squirrel, turkey, Steller's jay and vulture run on the same
code but were not opened. Rejected: a control per species (the parameters differ, the verbs do not).

## 2026-10-26: the world build yields: no multi-second tasks on the main thread while the screen is up

Aaron: "after page load I have to wait about 30-40 secs before hover effects work." Measured: 11.7 s of long
tasks in the first 40 s with no animal image loaded, one of 5.7 s (the first frame compiling every shader; 16 s
on a cold shader cache), Vegetation's canvas-drawn leaf and bark textures 4.6 s, Impostors 1.0 s, Terrain 0.9 s,
crown planning 1.6 s. The animals were not the cause. Now client/src/slice.js runs each heavy loop as a
generator in ~10 ms slices (`runSliced`, `yieldToMain` on `scheduler.yield` or a message channel, a `drain()`
for the old synchronous calls), at row, cell or tree boundaries so the results are identical; tilepackage decodes
images off-thread with `createImageBitmap` and reads back in strips; client/src/gpuUpload.js uploads big
textures a band of rows per task into an `ExternalTexture` with the storage, sampler and mips three would give;
shaders compile in parallel with `compileAsync` across the scene, shadow passes, grass bake, spirit pass and
cloud bake; behind the screen the first frame's streaming runs during the build and the frame skips drawing
while late meshes compile. Result (headless, cold, home tile, first 40 s): long tasks 11.2-11.7 s to 1.15-1.35 s,
largest 5.6 s to about 300 ms, worst input delay 5,361 ms to 290 ms (median 9), build done 12.5 s to 12.8 s
with the shader compile now inside it; about 30 hashed quantities (geometry, instance matrices, crown plan,
impostor atlases, leaf and bark textures, terrain, season colour, rasters) match byte for byte. Still over 50 ms:
the Atmosphere's cloud noise (~300 ms, atmosphere.js was off-limits to the lane), a few leaf-texture canvases
(splitting a canvas's drawing changed 1-2% of texels, so they stay whole; an IndexedDB cache of baked textures
would fix repeat loads), the downscaled draws of the 4000 px photos (Chrome decodes in drawImage), and the
`?skip=1` first frame. Rejected: moving the work to a Worker first (slicing got nearly all of it, with no copies).

## 2026-10-27: a tile is built when its card is clicked, aborted when another is, with no reload and no URL

Aaron's words: "It should be initial load - which just loads the animals, then displaces all of the cards when
the animals have loaded. Then when hovering over a card, it gets a little bigger. Then when clicking on a card it
gets even bigger and the spirit spinner starts. The animals also start popping in at this point. If I click on
another tile while this is happening, all loading should abort and there shouldn't be a page reload/route change.
Handle the tile loading behind the scenes not through URL params." So the page builds no world at load: the
dark phase gathers only the screen's own assets (every card's title data and map, the species lists, the 18
stills, the weather label; 12 s at most), then the slider and cards rise in with nothing selected. Hover grows a
card to 1.04 (and scrolls a card cut off at an edge just far enough into frame, snapping off for a mouse, no
chained scrolls); a click grows it to 1.08, scrolls it to the middle, starts its cover, wisp and status, pops the
lineup in and calls `onSelect(tileId)`; main.js builds that tile behind the screen, driving `setPrep(tileId,
text)` and `setReady(tileId)` (a status or ready for a tile not selected is kept for later); a click on another
card clears the first, retargets the lineup (shared animals slide over) and calls `onSelect` again, and main.js
cancels the first build within a slice and tears it down. `?tile=` is only a centring hint; the reload-based
switching and its carry are gone (the in-game Location box still reloads, for now). Teardown is one general
mechanism plus a few hooks rather than a dispose in every module: `addEventListener` is patched to record every
listener added while the world's code runs (never the screen's) and remove them all; a MutationObserver records
the elements a world adds outside the screen and removes them, the HUD's original header, help and credits put
back; the HUD controls' handlers are cleared; the field guide is mounted once per page and the world's acorn
game detached from it (that attachment kept whole worlds alive); the game socket is closed; one AbortController
per world cancels the tile load, crown list and planning, ground detail, water, weather; water, shadows and
terrain release what they hold of the shared uniforms and render targets; every geometry, material, texture and
target is disposed in slices. Measured: after three worlds exactly one mini-map, field-guide card, acorn board
and notes row; window listeners 25 back to 6; heap 580-890 MB ready to 101-105 MB dropped, flat over cycles,
about 80 MB of it the tree generator's per-species caches kept on purpose (faster rebuilds); the abort's click
handler 0.6-20 ms and the teardown 5-111 ms in slices. Known: 15 shader programs and a few geometries and
textures outlive a world (small, not growing); a dead world's late model download finishes in the background
and is never adopted. Rejected: a dispose() in every module (the record-and-remove mechanism covers them all
and cannot miss a new one); keeping the reload (it restarted the dark phase and lost the choice).

## 2026-10-27: the in-game Location box switches tiles in place, through the same abortable build

Aaron's words: "Make the in-game Location box's go-to-another-tile and build flows use the same in-place
abortable build as the start screen, with no reload and no URL change." The reload-based switch (a point and
the season carried in sessionStorage, `location.href = ?tile=`) is gone with its carry: goto.js no longer knows
`switchTile`; the box is the page's, set up once in main.js (not rebuilt by every world), and asks the page for the
world it holds now (`current()`: its tile, flight and whether it is ready) and calls `switchTile(id, p)`
(main.js `switchWorld`) to go elsewhere. A point in the tile played is flown to as before; a point in another
built tile, or in a tile the dev server has just built (goto.js `buildTile` polls as before and calls the same
switch when it is playable), tears the world down, darkens the page with the build's status in the middle and the
panel kept (html.switching: the HUD, mini-map, help and game hidden), builds the tile in its place through
`replaceWorld` (the one path the screen's card click uses: generation counter, abandon within a slice, teardown)
and enters it at the point with the season and day carried from the world left (`w.carry`, or the arrival a
still-building world was heading for). A Go while a tile builds abandons that build for the new tile's, a Go to a
point inside the tile building restarts it with the new point, and the URL never changes (`?lat=&lon=` on the
direct paths is still taken off it). Two changes made the played world disposable: `w.commit()` (Begin, or a
switch's arrival) no longer stops the listener and element recording but makes the world the scope for the rest
of its life, so what the game adds while played goes with it; and the arrival's caption animation (and the
squirrel's and woodpecker's) is cancelled when it finishes, because a filling (`fill: 'forwards'`) animation stays
on the element for good and its finish handler held the arrival, whose onDone closure held the whole world: an
entered world was never freed (found with a FinalizationRegistry: a world played and dropped was collected, an
entered one never, until this). Teardown now also cancels every animation outside the screen's root. Measured
(FinalizationRegistry on world, tile, scene, acorns; heap read once the page idles): three in-game switches and a
drop free all three worlds, heap 89 MB, GPU 8 geometries and 33 textures, one mini-map, field guide and acorn
board; a mid-build Go abandons the build in 6-23 ms; the lookup of the next tile takes up to 5 s while the dev
server is busy serving the build (one Python thread). Known: a Go at the very start of a switch build carries
the arrival's season rather than the world's (the world has no state yet); the panel's other controls are dead
until the new world wires them, a few seconds into the build.

## 2026-10-27: the start screen's animals stand below and in front of the chosen card

Aaron: "the animals' feet should be below the card, the bigger animals' heads and torsos can be over the card, like they are
standing below and in front of it." The ground animals' foot line (`--fy`, arrival.js placeLineup) was the middle of the band
between the card's bottom and the window's, with the tallest animal centred in it, so the whole lineup sat under the card with
a gap. Now the foot line is 0.035 card heights under the card's bottom edge (FOOT_BELOW), kept at least 0.03 card heights above
the window's bottom on a short window (FOOT_MARGIN); the lineup layer already draws over the cards (the birds cross the top
edge the same way), so the deer, lion and coyote now stand over the card's lower edge with their feet and contact shadows just
below it, and the small animals stand in front of its edge. Verified on the home and Placerville cards at 924 px: card bottom
at 800, feet at 814-827, the lineup carried across a change of card by the same CSS transition. Then, Aaron's "yes, shrink
it": the band under the cards had been the mirror of the top gap (the bar plus `--mt`, the card centred in the viewport),
so the feet left it mostly empty. The band is now its own `--mb` (max(9vh, 44px), opening.css), sized for the feet, the
contact shadows and a margin, and the card's height is the row's less `--mt` and `--mb` (centred between them only when
the window's width caps the card instead). At 924 px the card grew from 676 to 747 px (bottom at 868, feet 885-900, 24 px
to the window's bottom); at 1700 px tall 1,447 px (feet 1,632-1,660, 40 px left); at 560 px tall 419 px (feet 534-543, 17 px
left; the FOOT_MARGIN clamp did not engage). Also seen, not new: a chosen card scrolled to the row's edge has its lineup
cut off at the window's edge.

## 2026-10-27: a built world lets go of the CPU side of what lives on the GPU

Measured first (home tile, `?skip=1`, heap read 1 s after 20 s idle at a fixed pose, old code): 597-618 MB of JS heap, of
which 84 MB were the arrays of static geometry attributes three keeps after uploading them, 74 MB the bytes of DataTextures
and the leaf textures' mip levels, 42 MB the far bake's two atlases with their mips, 11 MB a copy of every terrain chunk's
index. three keeps all of it to upload again after a dispose or a lost context; a world is built once and disposed whole, so
for the static parts the copy is dead weight. gpuRelease.js: `releaseGeometry(g, { keep, keepIndex })` drops each static
attribute's array once three has uploaded it (`BufferAttribute.onUpload`, called right after `gl.bufferData`), except
the named ones; `releaseTexture(t)` drops a DataTexture's bytes and mip levels once uploaded (`Texture.onUpdate`, the end
of three's uploadTexture), `dropTextureData(t)` at once for the banded path (gpuUpload.js). Dynamic attributes (instance
seats, per-frame buffers) and interleaved ones are never touched; the bounds are computed first; a released attribute
can never be uploaded again (no needsUpdate, no clone, no draw after a dispose). Applied where nothing reads the array
again, checked by grep for every `.array` read: the terrain chunks' positions and uvs (20 MB; the normals stay for
FineTerrain.coarseNormal, the index for FineTerrain.hole, which now writes the plane's own index order instead of copying
a kept `full` array, 11 MB); the mid-tier trees and the close twigs; the dry stream beds and the ponds (the streams stay:
squirrelControl.js streamAt reads them); the roads overlay; the ground detail's two 1024 x 1024 x 5 array textures and
its mask (44 MB); the atmosphere's and the shrub fields' noise textures and the riparian mask; the far bake's atlases
(42 MB, dropped after the banded upload, or on first use without it). The near and close canopies and the near trunks are
raycast by identify.js's pick, which needs position, uv, leafRank and the index and nothing else, but three's raycast
also reads a normal and colour where the geometry has them: the probe now raycasts a stripped geometry sharing those
four attributes (`pickGeometry`), and the drawn ones let normal and colour go (12 MB). Not released: the leaf textures'
256 px mips (25.7 MB, the per-species cache kept across worlds on purpose: a disposed texture re-uploads from them, and
opaque() reads level 0), the season map (rewritten on a date change), the streams, the rocks (stood on and raycast),
the animals (the player's model is cloned at Begin), the terrain index. Measured after (same protocol): heap 472-477
MB, 120-145 MB lower across readings, with 139 MB fewer bytes reachable from the world (static geometry 84 to 45 MB,
textures 74 to 27 MB, bake 42 to 0, the index copy gone). The start view draws the same 21 calls and 66,772 triangles
at the frozen pose; a grid of 89 picks from the same camera matrices gives the same species, ids and distances to the
millimetre (hash-equal lists) on old and new code, close-canopy picks under 90 m included; the Location box switch to
Placerville builds and the home world finalises (FinalizationRegistry on world, tile, scene and terrain) once the page
idles; `__weDrop()` frees the Placerville world the same way, heap 84 MB with no world (old code 87). Known: an attribute
is released on its first draw, so chunks and trees never yet in any view (about 6 MB at the start view) keep their arrays
until they are; the roads overlay's lines keep theirs until G shows them.

## 2026-10-27: the terrain chunks' normals go too; the fine mesh makes the ones it needs again

The one reader of a coarse chunk's normal array was FineTerrain.coarseNormal, which blends the fine square's outer band
onto the coarse mesh's own vertex normals so the seam shades as the mesh beside it. Rather than keep 12 MB for a few hundred
reads per rebuild, `chunkVertexNormal` makes a chunk vertex's normal the way `BufferGeometry.computeVertexNormals` made it
in Terrain.build: the same float32 positions (PlaneGeometry's corner plus the chunk's origin, the height from H.vert at the
same double), the same faces in the same order (quad (ix, iy) is (a, b, d) then (b, c, d), quads in row order), each cross
product added and rounded to float32 as the attribute array rounded it, then normalised as Vector3 does. Checked over all
1,020,100 vertices of the home tile's 100 chunks against the live arrays before they were let go: 0 differing components
(587 ms for the whole tile). The rebuild caches the vertices it touches on its job (`J.normals`); a 220 m square's band
takes about 4,400 fine vertices from a few hundred chunk vertices, 5 ms over 4 frames, as before. Rejected: a compact
copy (an Int16 copy halves it but changes the band's normals in the last bit; an exact recompute costs nothing visible).

## 2026-10-27: the HUD behind a hamburger, a nearby-animals bar, and souls by rarity

Aaron: the HUD behind a small hamburger menu top left that becomes an X when everything is open; in spirit form the
animals nearby at the bottom of the screen, small, about an action bar, with a count pill (white, dark text) and a disc
shadow under each to stand on at about .4 opacity; the spirits' colours by rarity, purple for the most abundant species
to red for the rarest; then: a wider faint bubble round every creature's soul, the abundant dimmer, the rare brighter.
The menu (index.html `#menuBtn`, main.js): closed on load, so the readouts, the key line and the controls panel are
hidden (opacity and visibility, so their layout still measures) and the HUD moved down under the button; a click sets
`html.menu` (the three bars turn into an X by CSS) and shows all three; hidden behind the opening screen. The bar
(nearBar.js, `#nearBar`): the species within NEAR_R of the spirit, the counts `animals.describe` already fills for the
HUD's line, one slot each with the start screen's still (assets/opening, fitted to a 58 x 50 px slot rather than to
scale), a black disc at .4 under its feet and the count pill top right; the slots are ordered by rarity, abundant left,
rare right; rebuilt only when the set or a count changes; hidden in a body (onBody) and after a world is torn down. The
souls (spirit.js glow): rarity per species (animals.js `rarity`, 0 to 1 by rank of the tile's GBIF occurrence_count in
species/species.json, unlisted species and ties by the game's density k, evenly spaced), `rarityColor` a hue from 275
(purple) to 0 (red) through blue, green and yellow at HSL .85 / .62; each glow quad carries its species' colour and a
brightness from 0.55 for the most abundant to 1.4 for the rarest; the quad is 2.4 times the core and a faint bubble
(0.09 of the core's peak, a wide gaussian fading out at the quad's edge) surrounds it; the instance cap went from 256
to 1024 since every animal present gets one (the far ones leave the vertex shader off screen). Verified on the home
tile as a spirit near a jackrabbit: the menu opens and closes, the HUD at 54 px under the button; the bar shows nine
species with pills and discs; the jackrabbit's soul yellow-green. Known: with the menu open the key line runs under the
bar at the bottom; the stills are side views at one size, so a vole and a deer are the same height in the bar.

## 2026-10-27: the bar without its box, the map top right, the rare found from further off, a lion beacon for testing

Aaron: remove the dark box from the species list; move the map to the top right; the goal is finding the rarest species,
so they should appear from further away and brighter; for testing, make it extremely bright or obvious where the mountain
lions are even from far away. The bar (`#nearBar`) lost its background, blur and padding: the stills stand on the world.
The mini-map is at the top right; the panel, when the menu opens it, sits under the map (`--mapH`, set by layoutHud from
the map's height, the panel's max-height the rest of the window, scrolling), the key line runs to the window's edge and
rises above the bar while the bar is up. The souls (spirit.js): a soul's reach, the distance its far strength fades over,
runs from 250 m for the most abundant to 600 m for the rarest (GLOW_REACH; animals live within 400 m of the player,
animals.js LIVE_R, so the rare are lit across the whole live population) and its quad grows with rarity up to 1.6 times
(GLOW_RARE_SIZE); the glow's alpha attribute now carries the rarity itself (brightness and reach are mixed in the vertex
shader), or 2 for a beacon species. BEACON = { puma_concolor }: a beacon's soul never fades with distance, is 8 times
the base brightness and 5 times the size, and carries a beam: a 90 m column of light 2.5 m wide over the animal, a
billboard turning about the vertical, additive, drawn through the terrain (no depth test, on layer 1 over the spirit's
post pass), in the soul's colour (red for the lion, the rarest). Verified on the home tile: a lion lives in territory
cell (2, 0) at about x 3994, z -386; from 362 m away at 45 m up the beam and the pink soul are the brightest thing in
the view; at 122 m the lion is seen under it. Known: the beacon is a test aid (the set is one line to empty); a lion only
exists within the live radius, so "far away" means up to about 500 m; the beam reads white at its core where the additive
blend saturates.

## 2026-10-27: the bar's discs glow in the souls' colours

Aaron: "make the shadow colour underneath the models the same glow as the map glow." Each slot's disc (nearBar.js, `--soul`
on the slot; index.html .nb-disc) is now a radial glow in the species' rarity colour, the colour its soul is lit in the
world (animals.js rarityColor), paler at the centre and fading to nothing at the rim, at .85 opacity, instead of the
black .4 shadow; so the row reads purple to red along with the souls. Verified: nine species near a lion from scrub-jay
#d694f9 to mountain lion #f99494.

## 2026-10-27: the plant labels only while the menu is open

Aaron: "labels for trees and plants should only appear when the menu is open." identify.js `shown()`: the tag group is
visible when tags are on (T), the present-day peek is not hiding them (main.js sets `identify.hidden`) and `html.menu` is
set; read every HUD tick, so the labels come and go with the hamburger at once. The animals' tags (animals.js) are
unchanged. Verified on the home tile: 33 tags hidden with the menu closed, shown when opened, hidden again on close.

## 2026-10-27: the walkers' camera raised, the body framed in the bottom third

Aaron: "for all ground animals, raise the camera so that the animal is in the bottom third of the screen." groundControl.js:
the chase camera sits CAM_RAISE (1.3) times each body's `up` above it, and instead of looking at a fixed point ahead and
`aimUp` up, its pitch is set every frame from the line to the body's centre (half the shoulder height up) so that centre
lands FRAME_Y (-0.45) of the half view below the screen's middle, about 27% up from the bottom, whatever the body's size,
its sitting or lying, the ground under the lens or the lift the clearances add; the drag's tilt adds to that pitch, the yaw
is the smoothed aim's as before (the three-quarter view on the inside of a turn). Verified on the home tile in a deer and
a vole: both centres at 27% from the bottom (NDC -0.46), the horizon in the upper half. Not tried: a turkey (none within
reach); the rule is one for every walker. The fliers (flierControl.js), the raven, the squirrel and the woodpecker are
unchanged.

## 2026-10-27: rarity by the game's own population, not the GBIF record counts

Aaron: "mountain lions I would expect to be rare, one showed up as green." The tile's GBIF occurrence counts rank reports,
not animals: on the Cosumnes tile the lion had 7 records (green) and the vole none (red, the rarest); on Placerville the
lion was orange. Aaron chose the game's own expected population. animals.js `expectedPerKm2(s)`: a cell species is its
k per 30 m cell times the mean size of what a cell spawns (GROUP: woodpecker family 4.5, quail covey 12, turkey flock
10.5, ground squirrel colony 8, raven 1.55, deer 1.6, jays 3, coyote 1.4, rabbit and vole 1.3) over the cell's area at a
mean suitability of 0.5; a soarer one per grid cell with probability p; the lion one adult or a mother with young per
1500 m territory cell at p 0.4 (0.23 per km^2); variants take their base species. Rarity is the rank of that, the same
order on every tile: vole, fence lizard, brush rabbit, quail, squirrel, woodpecker, scrub-jay, Steller's jay, jackrabbit,
ground squirrel, gray fox, raven, deer, coyote, wild turkey, vulture, hawk, mountain lion (red). Verified on the home
tile: the bar's discs run purple to red in that order. The species list still carries the GBIF counts (species.json)
for the field guide; they no longer colour anything.

## 2026-10-27: herd species are piloted as a herd; the herd takes back over when the player stops

Aaron: "herd species could be piloted as a herd, a chaotic centre of gravity the animals trend towards; when the user
stops moving for too long the herd/flock takes back over." Where it sits: the group AI in animals.js already moves each
herd, covey and flock as a unit (a deer leader's waypoints with the rest in file; a covey's and a flock's centre with
members in slots round it), and a taken animal is lifted out of the population with its group intact (take/release).
So the pilot is one hook on the group: `animals.pilot(g, x, z)` sets the point the group trends toward (the deer leader
walks to it, up to a run when it has fallen behind; the covey's or flock's centre runs or walks to it), `pilot(g, null)`
hands the group back to its own life where it stands (its home moves there). A piloted herd is up whatever the hour; a
piloted covey or flock is not flushed by the player among it. The control side (groundControl.js herdDrive): in a
member of a herd species (deer, quail, turkey: HERD_WORD) the point is HERD_LEAD (5) body half-lengths ahead of the
player while any key is pressed; after HERD_IDLE (6) s without one the group takes over, and the player's body walks
with it as a member (keys synthesized toward its slot: behind the leader in file while it walks, round it or round the
centre otherwise), until any key, which takes the lead back; the HUD's where line adds "leading the herd" or "the herd
leads" and a line is said at each handover. Verified on the home tile in a herd of four: running 12 s took the herd 87 m
behind (at a trot cap of 4.5 m/s, since raised to 8 so a run keeps it in touch); idle, the herd took over at 6 s and
closed from 62 to 11 m with the body walking in its slot; a key took the lead back. Not yet: the jay families (fliers,
flierControl.js), the lion mother's young, the ground squirrel colony and the woodpecker family (they do not roam as a
group). Open: the camera could follow the group's centroid while the herd leads.

## 2026-10-27: games are found and classified from the package, not written per tile

Aaron: "figure out a pipeline for games: species-level games, collective games... predator-prey, get water, get food:
graze, forage. What are the games for the species we have, and how do we discover and classify them from a pipeline
perspective." The design is docs/games.md. In short: a game is a calendar activity (the verb, its resources, its goal)
with a place (the resource raster's best cells that season), an opposition (the other species' hunt lists, the species
after the same resource the same season, the season's scarcity) and a unit (how the species moves: herd, covey, flock,
family, colony, pair, mother and young, or alone; a group's games are collective, and only groups have watch). A new
`games` step (pipeline/games.py, in derive after the resources) writes `games.json` per tile with every species' games
by season, classified into ten archetypes (gather, drink, hunt, evade, cache, shelter, court, rear, disperse, watch),
placed (up to 12 hotspots in the resource's top 3%, 150 m apart) and scored (scarcity), and the tile's relations
(predation, competition per resource and season, scavenging, alarm from the perception matrix). On the five built tiles:
18 species, 160 games, 79 collective, 14 predator-prey pairs, the raven following the lion, 4 alarm links. The classifier
showed the data's gaps at once (games.md lists them): the calendar's hunt lists give quail, turkeys, the jays, the
woodpecker and the raven no predator, only the deer's calendar names water, the perception matrix is too full for
alarms to mean much, and court has no place. Next: a needs table and a diet table per species for the step to read,
perception with range and sense, and the client's games.js, one runtime per archetype, with the acorn game as the cache
archetype's raven instance and the herd pilot as the base of every collective game.

## 2026-10-27: the pipeline survives a lidar collection without a point cloud, and a LANDFIRE service that answers errors

The first tile outside zone 10, Yosemite Valley's utm11n_270_4180 (Half Dome, Yosemite Falls, the village meadows), found two
holes. The lidar step: the newest 1 m collection over the tile (CA_YosemiteNP_2019_D19) has its DEM published, but no
Entwine point cloud in the public bucket usgs-lidar-public matches its name or overlaps the tile (all 2,292 projects
listed; the CA_SierraNevada_*_2022 and Eldorado 2019 projects stop short of the park; the requester-pays raw bucket is
not used). `fetch_lidar.find_ept` now raises `NoPointCloud`, and `lidar.build_lidar` falls back to `build_dem_only`: the
products the 1 m DEM alone gives, the client's 2 m terrain detail and the 10 m roughness (18.6 s), recorded in
terrain/lidar_dem_only.json with `status.lidar = "dem_only"`; no DSM, canopy height, multi-return or crowns, so the crowns
step skips as before, the inpaint step now skips too (the client draws the imagery where there is no ground texture),
the vegetation places trees from the cell mix, and the ground step's lidar term is 1. The vegetation step: LANDFIRE's
image services (lfps.usgs.gov, LF2025 and LF2024 alike, EVT, EVC and EVH, for every bbox tried including the home tile
that built two days ago; only LF2016 BPS answers) returned a 130-byte JSON error ({"error":{"code":400,...,"General
function failure"}}) under an image/tiff content-type, which `http.download` cached as the raster, so every rerun read
the same bad file. `download` now sniffs a small body that starts with "{" or "<" and refuses it; `fetch_vegetation._export`
tries four times 45 s apart, deletes a bad cache file between tries, and fails with the service's words. The WCS
endpoint of the service is not enabled and no 2024 class table is published, so there is no fallback source; the build is
retried every 15 minutes while the service is down. Known: a build run writes the manifest after each step from the copy
it loaded, so two runs on one tile at once lose each other's layers (the lidar step is cheap to rerun from its cache).

## 2026-10-27: a needs table and a diet table per species feed the games step

Aaron: "add the per-species needs and diet tables and feed them into the games step." species_data.py NEEDS: per
species how it drinks (daily, often, rare, none: open water, or moisture from food and dew), the resource it shelters in
(cover, cavity, burrow, a tall roost) and its courting ground; DIET: per predator its prey among the species here and
whose kills it scavenges (the hawk takes quail; the coyote and the lion take turkeys; the raven and the scrub-jay take
lizards, voles and quail nests; the raven, the vulture and the coyote follow the lion's kills). games.py reads them beside
the calendar: predation and scavenging come from DIET (the calendar's hunt lists were the hunter's story), a drink game
per season for every species that uses open water, a shelter game in every season the calendar left bare, the courting
ground on court. Home tile before and after: 160 games, 14 predator-prey pairs, 1 scavenging link, drink for the deer
alone; now 275 games, 146 collective, 29 pairs, 5 scavenging links, drink for thirteen species, the covey with four
evade games and a sentinel. Still open (games.md): alarms need perception with range and sense; difficulty needs the
competitors' numbers against the hotspots' capacity.

## 2026-10-27: perception has range and sense; alarms are about who notices first

Aaron: "give perception range and sense so the alarm links are about who notices first." species_data.py SIGNATURE: how
far each species gives itself away in the open by sight (size, exposure, movement), sound (everyday calls and footfall;
a coyote hunts quiet) and scent; `detect_m(p, q)` = the best of p's senses (the SPECIES senses, the sensor's reach)
against q's signature, so a deer smells a lion at 300 m it would see at 60, a raven sees a hawk at 1,200 m, a vole
notices a hawk at 100 m by hearing and a lizard at 30 m. The species step writes the whole matrix to perception.json
(`detects`, with the signatures and ALARM_CALL, the species whose alarm calls others heed and how far they carry) beside
the old `perceives` lists, which the client still reads. games.py: an alarm link is a watcher with an alarm call that
perceives both and notices the predator at least a quarter further off than the prey; the home tile went from 4 links
to 51, each with both distances; evade games carry `notice_m` and their watchers' distances, hunt games
`noticed_at_m` per prey. The numbers are a first table from natural history, not measured; the animal briefs should
check them. Next: the client's animals reading the matrix (the jay's scold sending the covey to cover; a hunter noticed
at the prey's distance).

## 2026-10-27: the animals notice the player at their own distance, and alarm calls send the hunted to cover

Aaron: "make the client's animals read the detection matrix: alarm calls send others to cover, and a hunter is noticed
at each prey's distance." animals.js: with the player in a species, `notice[sp]` is how far species sp notices that
species (perception.json `detects`); `preyOf` is whom the player's species hunts (games.json relations). An animal is
alert within min(notice, 120 m): deer stand with their heads up, rabbits and jackrabbits freeze; its flee or flush radius
(the covey's 48 m, the turkeys', the colony's, the canids' and the lion's, the rabbits', the vole's, the lizard's, the
woodpecker's) is capped by its notice, so a lion is not fled until it is noticed. Deer flee at 35 m: the leader takes the
herd 80-120 m the other way at a trot and the home moves there. Alarm calls: a species in perception.json `alarm_calls`
with a member within min(notice, 120 m) of the player, while the player hunts someone here, calls once per 12 s (the
'alarm' event; the HUD's animals-near line says who called for 4 s); every animal of a hunted species within the call's
carry is alarmed for 8 s, and an alarmed animal or group within 150 m of the player goes to cover or flees as if the
player were at its flee radius (a settled covey flushes again on an alarm). Verified on the home tile with the player
read as a red-tailed hawk: at 82 m from a covey a raven within 120 m called, 203 animals within its 700 m carry were
alarmed, four coveys flushed with the alarm as the cause, then the jays, quail and squirrels called in turn; the deer
near the first test fled and stood alert. Found on the way: the herd pilot's commit (0a7687c) had a comment that
swallowed the rest of its line and a closing brace, which left the page blank from then until this commit; every
client module is now syntax-checked as an ES module before a commit (the memory note). Not done: the AI predators are
not threats to the AI prey (only the player is, as before); the sound layer has no voice for the 'alarm' event yet.

## 2026-10-27: the wheel zooms every view, off-screen herd members get an edge marker, the wisp has six tendrils

Aaron: "for all view modes, scroll up zooms out, scroll down zooms in"; "in flock mode, when a member of the flock is not
visible on screen, a small avatar inside a circle appears at the edge of the screen closest to the member"; "add a few
more tendrils just like the ones already there to the spirit, increasingly shorter." Zoom (flight.js): one `zoom` on
the flight, 0.35 to 4, a notch of 100 about 11%, set by a wheel listener on the window (not over the panel, the credits,
a card or the opening screen); every chase camera scales its distance by it: the raven's and the spirit's (flight.js),
the walkers' (groundControl.js, the framing rule unchanged), the squirrel's and the woodpecker's; the first-person view
is untouched. Verified: the spirit's camera 5.8 m, 10.5 m after five notches up, 2.5 m after twelve down; a deer's 4.6 to
7.9 m. Markers (herdMarks.js, `#herdMarks`): in a herd, covey or flock, each member not on screen (projected outside the
view, or behind the camera, which marks the edge toward where it would be if the view turned round) is a 34 px circle
with the species' still from the start screen at the screen's edge nearest it, 26 px in; members on screen have none;
placed every frame, removed when the body is left. Verified in a herd of four: none while all were in view, one at the
bottom edge for the member behind the camera. The wisp (spirit.js): six ribbons, the first three as before and three more
of the same kind at 0.75, 0.55 and 0.4 of the base length with their own weave periods, radii and phases; the spine still
runs the longest one's length.

## 2026-10-27: the start screen's wisp is the live one; eight tendrils; the animals beam in under pillars of light

Aaron: the first-load wisp "is irregularly shaped and spins at a weird angle; make it a rendered wisp, even lo-res,
flying in a circle, a glowing ball with ribbons trailing behind"; "for the in-game wisp one medium and one short ribbon
more, spinning the opposite direction at a slightly lower opacity"; on the start screen, loading a second tile "the
animals just move to the new tile; the new tile could be a completely different continent; the animals should come in as
their own sequence, with dancing pillars of light, similar to Star Trek". wispLoop.js: the real Wisp (spirit.js) in a
256 px canvas of its own with a small renderer, flying one anticlockwise lap of a 0.45 m circle every 1.6 s, seen from
above at a slant; it takes the dark start's slot and then a loading card's (one live wisp serves the screen), the sprite
sheet's inline background removed; disposed with the screen. The page composites a WebGL canvas as premultiplied
colour, where no channel may exceed the alpha, and the wisp's additive materials write light with no alpha (so the
mist's and ribbons' quads came out as dark squares, then, with a custom blend, vanished): the scene renders to an opaque
black target and a full-canvas quad writes it as light, alpha the brightest channel, so only the light reaches the page.
spirit.js: eight ribbons, the sixth and seventh added last (0.75, 0.55, 0.4 of the base) and now a medium and a short
one (1.0, 0.55) with negative weave periods, the other way round the spine, at 0.65 brightness (RIB_ALPHA). The
transporter (opening.css, arrival.js lineup): each still arrives inside a column of light (its ::after: a soft column at
least 90 px tall with fine bright streaks running up it, stepping at 4 frames per 0.32 s, plus-lighter) while the still
forms from a bright, desaturated blur over 1.5 s, staggered as before; on a tile change the whole lineup beams out the
same way over 1.1 s (shared species included) and the new tile's animals come in after it; the old op-pop and glimmer
are gone, and since the base rule starts a still at opacity 0 the in and out states set it to 1. Verified: the card's
live wisp as a glowing ball with a trailing ribbon; a change from the home card to Placerville with 18 out and 18 in,
the pillars standing over the lion, fox and turkey as they went and over each arrival. Found on the way: the browser
kept an old opening.css while the page was fresh, so the stylesheet link now carries a version query. Known: the first
load's boot is too short to see its wisp with cached assets; the pillars read as a fine grid at close range.

## 2026-10-27: the animals arrive as an aurora

Aaron, after the pillars: "more like vertical aurora borealis lines, 10-15 vertical lines that wiggle left and right all
clustered together at differing heights, then the model of the animal fades in at the same colour and then the colour
fades in on the animal as the vertical lines shimmer out at different odd intervals." arrival.js `auroraLines`: 10-15
lines per still, clustered round its middle (a two-dice spread of 30%), 40-170% of the still's height, each with its own
colour from five aurora greens, cyans and a violet, wiggle period (0.45-1.35 s, left and right by 3 px), delay (0-0.5 s)
and life (1.3-2.7 s), so they shimmer out at their own odd intervals; a silhouette (.op-sil: the still as a mask over
the lines' colour) under the still. opening.css: on arrival the lines rise and the silhouette fades in over the first
third, the still's own colours fade in from the middle as the silhouette goes, the lines by their own lives; a tile
change runs it backwards over 1.4 s (the colours go first, the silhouette holds, the lines last) and the new tile's
animals come in a second later. The pillars (the entry before) are gone. Verified: the deer forming as a mint silhouette
among lines, the turkey and the small animals after it, the colours in by two seconds; on the change to Placerville the
whole row to silhouettes with lines, then lines alone, then the new arrivals.

## 2026-10-27: the wheel's zoom bounded and eased; the walkers' camera a little further; the lineup moves with the cards; the pill; the spirit in the lower third

Aaron: "in game the camera starts way too close to the subject and isn't able to zoom in or out" (in a jackrabbit);
"when the cards move horizontally there is a lag between when the cards move and when the animals move"; "the pill for
the number of nearby animals can be in the bottom left of the bounding box, tinted the highlight colour, semi-transparent,
maybe .8"; "in spirit mode the camera frame should be such that the spirit is in the lower third of the frame". The
zoom (flight.js): a trackpad flick fires dozens of wheel events whose pixel deltas pinned the zoom to an end of its range
at once, which looked like no zoom at all and a camera on the rabbit's back. Now one event moves the target by at most
60 px worth (lines and pages scaled to px), the target stays within 2.5 times the zoom the camera is at, and the cameras
read an eased zoom (7 per second). Verified: 80 events of 120 px in a burst take the target to 0.4, not 0.35, and 80
back up return it to 1. The walkers' chase distance gains CAM_PLUS (0.5 m back, 0.2 m up) for every body, so a
jackrabbit's camera starts at 2.2 m rather than 1.5. The lineup's left, top, width and height now transition in .5 s on
the cards' own curve (they were .6 s, two curves), and while the row scrolls the lineup has no transition (.scrolling,
set by the row's scroll events and dropped 150 ms after the last), so the animals stay under their card frame by frame.
The bar's count pill (index.html .nb-n) sits bottom left of the slot in the highlight orange #c98a4e at .8 with dark
text. The spirit (flight.js updateCamera): the same framing rule as the walkers', the camera's pitch from the line to the
wisp looking 0.45 of the half view above it plus half the wisp's own pitch; verified at 29% up from the bottom.

## 2026-10-27: the aurora in white, faster

Aaron: "I like the fade in on the animals, but it is a very saturated teal: completely de-saturate it, and it can all
happen faster." The lines are white to light grey (#ffffff to #c9ccd0), the silhouette #e4e6e8; the arrival takes 1.3 s
(2.3 before), a line lives 0.8-1.6 s with a delay under 0.3 s, the beam-out 0.9 s (1.4) and the new tile's animals
start 0.6 s after it (1.0). Verified on a change from the home card to Placerville.

## 2026-10-27: the bar's count pills in each species' colour

Aaron: "each pill should be a light version of the colour of that animal's rarity; the pill for quail should be a white
tinted with that same purple." index.html .nb-n: the background is the slot's soul colour (nearBar.js --soul, the
rarity hue) mixed 42% into white, at .8, dark text; verified from the vole's lilac to the raven's pale green.

## 2026-10-27: a need asks the world for what it takes; the first games of life; real acorns; the beacon dimmed; zoom inverted

Aaron: "whenever a species has a need, we also need to generate a request for that species to be generated by the
pipeline. Add some of the basic games of life (food, water). Acorns can be realistically sized"; "wherever possible make
sure the pipeline can account for any species"; "the light beam can be about 30% as bright, and not visible through
trees"; "invert the scroll". Done: games.py `requires` per game and `requests` per tile (docs/games.md, "What a need asks
the world to contain"); resources.py writes `client/res_<resource>.png`, the four seasons as RGBA on the tile grid, for
the client; the hotspots are now in tile metres (they were the raster's UTM coordinates, so a target read 4,338 km).
needs.js, the hunger and thirst of a walker, fed and watered by E on the rasters, with the nearest good cell as the
target (docs/games.md, "The games of life in the client"); all of it from games.json and the rasters, no species named
in the client. The acorns are 2 by 3 cm (ACORN_R) and lie on the ground; the carried ones keep their size in the bill.
The lion's beacon glow and beam are at 30% of their first brightness and the beam is depth-tested, so trees and hills
hide it. The wheel: down zooms out, up zooms in. Verified on the home tile in a deer: hunger 0.50 to 0.65 in 3 s of
grazing at an acorn score of 90, the water target 669 m south, the widget bottom right; the beam faint over the lion at
360 m; five notches down took the zoom from 1 to 1.43.

## 2026-10-27: the wisp's speed: a slower cruise, quieter wind, taps that nudge and holds that ramp

Aaron: "the wisp's auto speed is too fast, and its wind speed is too loud. Tapping W or S should increment in smaller
amounts; holding should increase the speed on an exponential curve and ease into the top and bottom speeds."
flight.js updateSpirit: the cruise is 12 m/s (25); a tap of W or S moves the speed by 2.5 m/s; a hold applies a rate
toward the end speed (90 up, 0 and then -10 backing down) that grows exponentially from 0.08 to 2.2 per second over
three seconds of holding, so the speed eases into the end; Shift doubles the rate. sound.js: the spirit's wind is at
0.45 of the raven's loudness and rises half as much past 30 m/s. Verified: cruise 12, a tap to 14.7 and back to
cruise, a held W 19, 26, 36, 50, 66, 80, 87, 89, a held S 68, 62, 53, 39, 24, 10, 3, 1.

## 2026-10-27: hidden herd members as luminous silhouettes

Aaron: "when members of a flock, herd or group are not visible, behind foliage, they should still be findable: a luminous
silhouette visible through trees, less luminous the further away until invisible." herdSilhouette.js: in a group, each
member's body is drawn a second time by one small InstancedMesh per species (up to 32, filled every frame from the
animals' own instance matrices and pose values, the geometry the drawn tier 0's or the procedural model's, cloned for
its own pose attributes) with animalModels.js `animalSilhouetteMaterial`: the species' part animation, a flat glow in
the species' soul colour fading from full at 25 m to nothing at 150 m, additive, no depth write, and drawn only where
the fragment lies behind what is already drawn (depthFunc GreaterDepth): front faces only, pushed toward the eye by a
polygon offset so a body's own far side and the parts just behind its nearer parts do not count as hidden. The visible
parts stay as they are. A first cut as a MeshLambert variant hit the Metal shader translation bug the atmosphere's
shadow taps have in some programs, so the material is its own small shader. Verified in a deer herd: in the open the
members show at most slivers; behind a bush two deer come through as bright silhouettes speckled by the leaves. With
the edge markers for members off the screen, every member is findable. Known: a member just over a rise shows through
the hill too; the birds and the squirrel have no groups to show.

## 2026-10-27: the Indigenous territories under a card's place name (Native Land Digital)

Aaron: "under the place name in the start screen put the territory or territories from native-land.ca."
pipeline/fetch_territories.py: five point queries to Native Land's territories API (the tile's centre and corners),
cached and merged by slug, written to client/features.json as `territories` [{ name, slug, url }] with a source note;
derive.client_features calls it at build, `python -m pipeline.fetch_territories <tile>` refreshes a built tile. The
API needs a free account's key (NATIVE_LAND_KEY in the environment or .env; .env.example documents it; never printed
or written): without one the tile has no territories and the note says so, nothing fails. config.SOURCES
`native_land` carries their disclaimer (the map does not represent official or legal boundaries of any Indigenous
nation) as a required attribution, so the credits show it first. The card (arrival.js, opening.css .op-terr): a third
line under the locality and roads, in a warm pale tone, the names joined by dots, hidden when empty. Verified: the
parser on a sample response, the no-key path on the home tile, the line's display on a card. Aaron has to sign up for
the key (an account is not mine to make); then `python -m pipeline.fetch_territories utm10n_680_4280` fills the tiles.

## 2026-10-27: a drag turns the head with the camera, then the body

Aaron: "for all animals, clicking and dragging should move the camera in line with the head. If I drag the camera to
look right the animal's head should turn right, until it can't turn any more, then the body turns, to allow the camera
to keep moving." flight.js (the drag every control shares): `look`, the head's yaw off the body, takes a drag's turn up
to `lookMax` rad each way (1.0 for the quadrupeds, 1.2 for the rodents, 1.3 for the birds and the raven, 0 for the
spirit, which has no head), the rest goes to the body's yaw; the cameras look along yaw + look (the walkers', the
squirrel's, the woodpecker's, the raven's and the fliers'); moving (W, a turn, the herd's own steering) settles the
look back into the body at 3 per second, the body turning under a camera that stays, so the animal walks where you
look. The head itself: animalModels.js animalMaterial takes a `head` uniform (the player's own body material only,
every control passes flight.headYaw) and turns the HEAD part about the vertical through its pivot after its dip.
Verified in a deer: 20 drag steps turned the head 0.84 rad with the body still; 45 steps put the head at its limit and
turned the body 1.48 rad; W settled the head straight with the camera where it was. Known: the ground raven's own
head turn (aAnim2.y) and the look both apply; the lizard's reptile body has no head yaw.

Aaron: "the occlusion effect for herds should not be triggered by their own body or by the bodies of other members
of the flock/herd." The silhouette pass (2d7ba15) drew wherever a member's body was behind what was already drawn,
which included the member's own far side (slivers along every visible deer) and the members standing in front of it.
Now the herd marks the stencil: while the player is in a group, that species' AI materials (the instanced mesh and
the drawn tiers) and the player's own body material write 1 to the stencil as they draw (stencilFunc Always, ZPass
Replace), and the silhouette material draws only where the stencil is not 1 (NotEqual, no writes); the renderer is
created with `stencil: true` (three 0.186 defaults it off). herdSilhouette.js `mark(k, me, on)` sets and restores the
properties when the group's species or the player's body changes and on clear. Verified in a deer herd at 11:00: the
visible deer show no slivers; two members behind the toyon still glow; the member in front of them does not. Known:
a member behind another member and also behind a bush shows only where neither body covers it, which is the ask.

Yosemite tile `utm11n_270_4180` (2026-10-28, Aaron's choice of a new region: "Half Dome, Yosemite Falls, the village
meadows"): built over the night by a side session and finished here. Every step ran: the 3DEP 1 m DEM (the lidar step
found no point cloud in the public Entwine bucket for CA_YosemiteNP_2019, so the tile is marked `lidar: dem_only`: a
1 m terrain detail and roughness from the DEM, no canopy height model, no real crowns, no inpainted ground), NAIP
2022, OSM (609 roads, 689 buildings), NHD hydrology routed on the DEM, LANDFIRE vegetation after three hours of
failed exports (their image services answered errors from 03:00 to 05:08 UTC; a retry loop every 15 min caught the
first good answer), Sentinel-2 monthly colour, Open-Meteo weather, derive (habitat, species mix, resources, games: 18
species, 19 requests), erase, export. Loaded: Half Dome reads at once from the meadow at (3216, 864) tile metres,
the Yosemite Falls cliff at (1228, 1986) has no fall drawn (a 739 m drop is a steep channel to the hydrology), the
granite walls are flat grey (no outcrop texture scale for walls this size; no lidar relief), and the species are the
foothill set (the species step draws on the same tables; the GBIF prior only weights them), which is wrong for the
valley: no black bear, no mule deer, no Steller's-jay-dominant corvids, no coyote-only; the Sierra set is a pipeline
ask. The start point is the tile centre on Tioga Road rather than the valley floor. The buck in a herd showed
silhouette slivers: the stencil mask marked only the player's species slot, and the buck is its own slot; fixed
(herdSilhouette.js marks every species slot present in the group, reconciled each frame).

## 2026-10-27: the first Yosemite tile, utm11n_270_4180, built DEM-only and played

Aaron: "with all the pipeline upgrades we should try a new region", then "build the Yosemite tile utm11n_270_4180 (Half
Dome, Yosemite Falls, the village meadows) first." The first tile outside UTM zone 10 (the zone comes from the anchor,
config.py; nothing else cared). The full build ran in about 25 minutes before the two failures above (lidar: the 2019
collection has no public point cloud; veg: LANDFIRE's services answering errors for hours); with the fixes, the DEM-only
lidar step took 18.6 s (terrain detail: residual std 1.1 m, 26% of 2 m cells over 0.5 m, 0.4% clipped at +-5.08 m on
the cliffs; roughness median 0.08 m), the vegetation came through on the ninth 15-minute retry, and derive, erase and
the Unreal export followed (crowns and inpaint skipped). What the tile has: the 1 m DEM's detail on the 5 m heights,
NAIP erased, the habitat and species mix (foothill species standing in: ponderosa, black oak and incense cedar are in the
library, white fir and sugar pine are not), the rewilded hydrology, Sentinel-2 months, weather, the resource rasters
and the games file. What it lacks: a canopy height, crowns and trees on real crowns (3.9 M far trees from the cell mix
instead), the ground-only texture (the client draws the erased imagery under the trees). In the viewer (port 8783, the
same code): the world builds with no console errors and 461 MB of heap; as the raven at midday Half Dome, the north
wall and Clouds Rest read at once from above the meadows. Seen: the arrival caption says "near Tenaya Creek" for the
Half Dome point, since the valley's names come from the OSM places within reach. Not yet: the three neighbouring cells
that hold the rest of the valley (El Capitan and Bridalveil in utm11n_260_4170).

Bark on scaled trees (2026-10-28, seen on Yosemite's old ponderosas): a tree drawn at an instance scale above 1 (old
growth from the lidar or EVH height, girth and height scaled apart in vegetation.js) carried its bark plates scaled
with it, a 2.5x trunk showing 1 m plates. The bark UVs are laid in metres on the unscaled geometry (treegen.js tube:
u in texture widths round the stem, v in texture heights along it), so trunkMaterial's vertex shader now multiplies
the map and normal-map UVs by the instance's (girth, height) scale under USE_INSTANCING; a tree at scale 1 is
unchanged, the lineup's single meshes too. Verified at the Yosemite meadow: the giant ponderosa's plates are the
species' size.

Cliffs at any distance (2026-10-28, Yosemite's walls): the terrain's near detail (rock within 250 m) left a wall seen
from the valley as the photo's smooth grey. terrain.js now gives any ground steeper than about 35 degrees (the
detail mask's slope, or the drawn mesh's on a lidar tile) ledges and stains at every distance: bands by height (7 m
and 2.6 m value noise, wandering +-4.5 m along the face) as a +-14% tone and a tilt of the lighting normal about the
horizontal from the bands' rise (rising relief faces down, so ledge tops catch the sun and undersides shade), and
water streaks (1.4 m across, 17 m long) as a -9% tone; it backs off to 30% where the near detail's rock takes over.
Verified from the meadow: the Yosemite Falls cliff reads as layered granite at 1 km; Half Dome's face is mostly haze
at 15:00 (the atmosphere, not the rule). Known: the bands are the same for granite and for a road cut's metamorphic
bank; geology.png could choose a pattern per rock later.

Alarm calls are heard (2026-10-28, an Opus lane, verified here with synthetic events: deer, scrub-jay and ground
squirrel logged "<name> alarm" at 26 m with no errors; not yet heard by ear in play). sound.js voices animals.js's
'alarm' event: the caller species' own alarm from where it stands (the panner follows the caller when it is found
within 1.5 m), out to the call's carry clamped to 60 m .. a per-species range (160-600 m). The voices reuse the
existing synths wherever one fits: the scrub-jay's shreep in an alarm form (2-4 noisier 0.25 s calls rising to
3.8 kHz), the Steller's "shaaar" clipped into a "shaack" (2-3 of 0.2 s from 2.9 kHz), a sharper waka, two kraas, the
turkey's alarm putts, the quail's pits (pulled out of the flush), the ground squirrel's whistle and the gray
squirrel's bark (with its tail flicks). The deer gets a new short snort (band-passed noise 1.9 -> 1.1 kHz, 6 ms
attack) and a 40-80 Hz forefoot stamp; any other caller a generic chip. The calls go through _play into the bird bus
as 'event' sources, at most one voice per event and two alarms at once, with small refDistances (10-20 m), so at
200 m a call is about 20 dB under its 10 m level. A ground squirrel's 'gsAlarm' whistle and its 'alarm' within a
second are one call.

AI hunters are threats (2026-10-28, an Opus lane; animals.js `threat`, `aiAlarms`, `huntStart`). Prey used to react
only to the player. Now they react to the nearest predator they notice: the player at `notice[sp]` as before, or
any live AI fox, coyote, lion, hawk, raven or jay whose species hunts them in games.json `relations.predation`, at
perception.json `detects[prey][hunter]`. The hunter list is rebuilt every 0.3 s from the live set within 300 m, and
hunters more than 30 m above the prey do not count. Its position goes into the existing flee, freeze, bolt, flush and
dive code. Things that are about the player as a camera stay on the player (field-guide sightings, the raven's low
pass over a covey, the acorn game). Watchers call at an AI fox, coyote, lion or hawk as they do at a hunting player,
at 2.5x the cooldown per watcher species (foxes and coyotes are about all dawn: with the player's cooldown seven
calls came in 15 s), and the alarmed prey flee from that hunter. Hunters hunt: a lion stalks a deer herd, jackrabbit
or turkey flock within 200 m and rushes for 4-5 s when within 25 m or when the prey breaks within 50 m, at most once
a minute or two. Foxes and coyotes trot at voles, rabbits, jackrabbits and ground squirrels within 60 m and pounce.
Half the hawk's stoops go at voles and ground squirrels. Nothing is killed yet: the hunter gives up after the rush or
pounce, so prey numbers are unchanged until kills are added (a kill should leave carrion for the scavenge relation).
Verified: the lane saw a summoned lion stalk a herd leader from 45 m, the herd flee 2.5 s later and the lion rush at
6 m/s, a fox pounce a vole, a coyote trot at a jackrabbit, the hawk stoop at a vole; here, a dawn with foxes and
coyotes about raised jay, woodpecker, quail, squirrel, deer and raven alarms at them with no errors.

Waterfalls (2026-10-28, an Opus lane; client/src/waterfall.js, built by water.js inside its own step so the teardown
disposes them with the water): wherever a drawn channel drops steeply, a fall. The reaches water.js draws (perennial
and intermittent, outside ponds, without NHD duplicates) are walked every 2.5 m on the 1 m ground, the profile made
non-increasing, the slope taken over +-5 m; a leap is a stretch steeper than 35 degrees with gentler gaps under 10 m
bridged, kept from an 8 m drop, and each run is extended 80 m into its downstream run so a leap across a junction
stays whole. Each leap is a white curtain standing off the face along its normal (1 m at the lip, arcing to 6 m), a
fading run of foam below and a mist billboard at the plunge, all in one merged mesh and one draw call; the shader
scrolls the streaks in time of flight, sqrt(2 dv / g), so they accelerate and stretch, dense at the lip and breaking
into strands and spray, lit with the atmosphere uniforms, and kept at least ~1.3 px wide far off. Falls follow the
water's season (an intermittent creek's fall is dry in summer and fall), and the water and bed ribbons fade on faces
steeper than ~55 degrees where the fall replaces them. Yosemite tile: 76 falls; Yosemite Falls as a 415 m upper fall,
four cascades of 10-42 m, and a 106 m lower fall (real: 436, 206, 98 m). The foothill home tile: one 10 m cascade on
Hangtown Creek. Verified here on 15 May at 11:00: the upper fall is a white streak on the cliff from the meadow and a
curtain from 300 m. Known: the channel over the falls is classed intermittent and carries 10 km2 while the named
perennial Yosemite Creek (84 km2) runs off the tile's west edge (a hydrology ask), so in autumn the cliff is dry (as
it is in life); the curtain is a few metres wide where the May plume is 10-20 m (width should follow drainage area
and season); a leap the DEM smooths under 35 degrees is not found; a road embankment over a creek could make a false
one; `we.setDate('05-15')` shows it today.
## 2026-10-27: the deer is skinned and clip-animated on the GPU, still one draw call a species

Aaron: "we could massively improve the realism of our animals by improving the rigging." The part rig (animalModels.js:
no skeleton, each vertex turning about its part's pivot from four floats) was the right first step for one draw call a
species, but a deer whose legs swing as rigid slabs and whose hooves stay with the body cannot read as a deer up close.
The black-tailed deer's CC0 source (Quaternius) came with a 46-joint skin and 13 clips that the build script dropped. They
are back, without giving up the instancing.

The path: `tools/bake_clips.py` reads the source GLB (standard library and numpy, nothing from it executed), samples each
clip's joint matrices at 30 Hz and writes a bone texture (RGBA half floats, three texels a joint for the 3x4 matrix, one row
a frame; 138 x 531 for the deer, 586 KB) and a JSON index next to the adopted tier (`client/assets/deer_clips.bin/.json`).
Each matrix is T G_j(t) G_j(rest)^-1 T^-1 with T the build's scale and ground shift (now in the GLB's `extras.skin`): the
adopted vertices are the rest-skinned source (checked: the doe's body within 1 mm, only the enlarged ears differ), so the
inverse bind matrices drop out and the matrix carries an adopted vertex straight to its posed place. `tools/build_deer.py`
keeps the four heaviest vertex groups per vertex as JOINTS_0 / WEIGHTS_0 (they survive the decimation) in the skin's joint
order; the buck's antlers are skinned to the Head. The rebuilt GLBs differ from the old ones by those two attributes and
the extras only. The buck reuses the doe's texture: its matrices' translation column is scaled by its own size over the
texture's (1.045).

In the client (animalModels.js, the skin path of `animalMaterial`, `animalDepthMaterial` and `planarShadowMaterial`): a
third per-instance vec4, aClip = (clip, phase 0..1, blend-to clip with its phase in the fraction, blend weight). The vertex
shader fetches the four joints' matrices at the clip's two frames round the phase (texelFetch; 24 fetches, 48 during a
blend), lerps, and for a transition lerps with the second clip's. The lighting, self-lit, cascaded-shadow and planar-shadow
paths are the part rig's with the body swapped. Metal's 16 vertex-attribute slots were the one surprise: with the part
rig's five attributes still declared beside the skin's three and the instance matrix's four, the program failed to
validate ("Too many attributes"); the skin path now declares only what it reads.

The drive (animalModels.js `driveClips`, `DEER_DRIVE`) turns the part rig's values into clips on the CPU, so animals.js and
groundControl.js think as before: bed when pose passes 0.5; the Gallop above 3.5 m/s (back to the Walk under 2.8); the Walk
when moving; Eating when the flick says grazing; Idle (or Idle_2, by a seed) standing. A change blends from the old clip
over 0.3 s (gaits), 0.5 (grazing, idle) or 1.0 s (bedding). The Walk's hooves are planted: the baker measures the planted
hoof's ground travel over its stance and spreads it over the cycle (0.65 m a cycle on the doe), and the drive advances the
phase by distance over that stride, so at any walking speed the stance hoof moves back under the body at the body's speed
(the source's walk was authored for 0.56 m/s, so a 1.1 m/s AI walk runs it at 1.7 Hz; capped at 2.6 Hz for the hurried
walk that stands in for a trot, which the source lacks). The Gallop's stride is set by hand at 3 m (an in-place gallop's
brief contact says nothing about the distance flown), its rate between 1.3 and 2.8 Hz. The source has no bedded clip
either: the recipe (`library/animals/clips/odocoileus_hemionus.json`) builds one frame from Idle_Headlow by aiming the leg
bones (fore knees forward on the ground, cannons back under the chest; hind legs tucked forward with the hocks behind) and
dropping every joint 0.45 m, so the model's `drop` is 0 and the bedded body no longer needs lowering by animals.js. Idle
loops run on the clock from a per-animal seed so a herd is not in unison.

Verified on the home tile (worktree on port 8782): the herd walks, grazes, stands alert and beds (hour 13 bedded the herd;
an alarmed herd gallops off); the player's deer walks, gallops, grazes and beds, and a jump runs the gallop in the air;
the buck walks, grazes and beds with its hard October antlers on its head. No console errors (the earlier attribute-limit
error is gone), the planar and cascaded shadows compile and draw. Draw calls at the same pose beside the herd: 368 with the
skinned deer, 366 with the procedural deer swapped in, 370 on main; the deer still draws one call a tier plus its planar
shadow and shadow caster. CPU submit time of a render back to back in the same tab: 2.4 ms skinned, 2.7 ms procedural (gl.finish
does not wait for the GPU in Chrome, and the hidden browser pane throttles requestAnimationFrame to ~27 Hz, so a GPU frame
time and a true fps could not be read here; the skinned work is 11 deer x ~1,400 vertices x 24-48 texel fetches a pass,
three passes, which is nothing beside the 9 M triangles of the view). Every other species is untouched (the part rig's
shader text is the same; the deer's procedural fallback stays for a failed load or `?deer=proc`).

Merged with main's drag-look and herd silhouettes the same night: on the skin path the look turns the vertices weighted
to the neck, head and ear joints about the vertical through the neck base (`SKIN_HEAD`, the chain and the neck's rest
position from the clip index), and a hidden herd member's silhouette carries the deer's clip and phase.

Open: a true trot needs a clip the source does not have; the Walk's small authored steps mean the AI's 1.1-1.6 m/s walks run
at 1.7-2.5 Hz (a real doe walks nearer 1.4 Hz with longer strides); an alert pose with the ears forward is the Idle clip
for now; the lineup page draws the skinned deer in its first clip's first frame rather than its motion switches. A
web auto-rigger (autorig.online) could give the Meshy species (lion, rabbits, rodents, turkey) skeletons and retargeted
clips for the same path; that is a separate step and uploads nothing from here.

Kills and carrion (2026-10-28, the hunt archetype's end; animals.js CARRION, kill, catchNear, lieStill, bury; needs.js
fed and the hunter's drain; groundControl's E). A decision taken under the standing authorization, for Aaron to
veto in the morning: predation now ends in a death. The player in a hunter's body (lion, coyote, fox) presses E
within reach (2.4, 1.6, 1.3 m) of prey its species hunts (games.json relations.predation) and catches it: "caught a
deer", the hunger meter fills (a hunter's hunger drains over 14 min with no raster food, so the hunt is its eating
loop). An AI lion's rush that reaches its prey kills it with chance 0.35 and the lion stands by the kill 45 s; a
canid's pounce that lands kills with 0.4. Only species without a kept member list die (deer, bucks, jackrabbits,
rabbits, voles: KILLABLE); turkeys, quail and ground squirrels scatter and live. The dead animal lies where it fell
on its side in its species' rest pose (the skin drive's bed clip; state D_BED and pose 1, rolled 1.45 rad) for 10 min
(small prey 2.5 min), no longer thinking but drawn every frame, the herd going on without it (a new leader if it was
one), then goes (bury: unseen at once, dropped at the next rebuild; its cell's rebuild brings another in later, so
numbers hold). The scavengers of relations.scavenge come: a raven within 300 m that is not fed moves its circle over
the carrion at 18 m and glides down beside it to stand there 15-50 s; a vulture within 600 m slides its circle over
it, tightening to 28 m and 28 m up, for 1-2.5 min; a coyote within 200 m trots to it and noses it over, once per
carcass. Verified: as a lion, E at 1.6 m killed a deer, the caption read, hunger filled; the carcass lay in the open
grass; within 30 s three vultures circled 31 m over it and ravens came in (one landed and left). Not seen in a test:
an AI lion's or canid's own kill (the chance paths are the rush's and the pounce's). Open: no 'kill' sound; no blood
or feeding pose; the lion's own feeding is a stand; a death the player's herd sees has no reaction beyond the flee.

The fliers' strike (2026-10-28): a player hawk or raven passing within reach (1.4 m, 0.9 m) of prey its species hunts
takes it, in flight or standing beside it (flierControl.js, every 0.1 s through animals.js catchNear; the toast says
"took a jackrabbit"). No key: the stoop that connects is the strike. Verified: a hawk reset 1.2 m over a jackrabbit
took it at once. The fliers have no hunger meter yet (needs.js is the walkers'), so the strike is its own reward.

The stalk and the fliers' hunger (2026-10-28). A hunter's signature follows how it moves: groundControl scales every
species' notice of the player (animals.js setStalk over the observer's noticeBase) by 0.4 frozen (shift), 0.55 creeping
(under 0.9 m/s), 1 walking, 1.3 running (over 2.4 m/s), so a lion creeping in is noticed by a deer at 165 m instead of
300 and a running one at 390; the factor resets when the body is left. The fliers (hawk, raven, the jays, the vulture)
have the needs widget now (needs.js takes a flier body: hunger only, no thirst, since a flier has no drinking loop
yet), a hunter's hunger draining over 14 min and filling on a strike. The start screen's lineup (arrival.js) skips the
species the pipeline marks `present: false` in species.json (the species lane's record-and-range rule), so Yosemite's
card shows fifteen animals, without the brush rabbit, the jackrabbit and the vole.

The plume by season (2026-10-28): a fall's curtain, run-out and mist are built once at the channel's width, and a
`flow` uniform now widens them by season (waterfall.js FLOW: spring 2.2, winter 1.5, summer 0.6, fall 0.45; the mist
by the square root), since a Sierra fall is a broad sheet in May's melt and a thread by October. Verified at
Yosemite Falls: the upper fall is a wide white sheet on 15 May and a narrow ribbon on 20 January.

Species follow the place (2026-10-28, an Opus lane; pipeline/fetch_species.py, species_data.py RANGE and
perceives_on, games.py, build_tile.py). Every tile used to get the same 18 curated species, so the Yosemite Valley
tile had brush rabbits and jackrabbits. Now the species step decides `present` per tile. A species is present if GBIF
has at least 3 records of it within 10 km of the tile in the last 15 years, or else if at least 5% of the tile lies
in its elevation band on its habitats (species_data.RANGE, central Sierra west-slope life zones from Grinnell and
Storer's 1924 Yosemite transect). Records alone would fail both ways: the brush rabbit has no record near the home
tile since 2011, and the mountain lion and gray fox have only one or two around Yosemite Valley, though all three
live where they are kept; the range alone would ignore the evidence we have. So the records decide first, and the
band only keeps a species the records miss where it can live. Yosemite loses the brush rabbit, jackrabbit and
California vole and keeps 15; the three foothill tiles keep all 18 (home: perception.json unchanged). An absent
species has no row in perception.json `perceives`, appears in no row, and has no games; the species-level tables
(`detects`, `signatures`, `alarm_calls`) still list everyone; species.json carries `present`, `rule`,
`records_buffer`, `range_share` and `evidence`; the buffered GBIF counts are cached per tile. The bands fit only the
central Sierra west slope; other regions will need their own. The species Yosemite really has (black bear, mountain
quail) need new species, not this rule (the bear is in progress). Client follow-ups still open: animals.js PENDING
re-adds a species no `perceives` row names (on Yosemite the jackrabbit), the spirit perceives every species the client
knows rather than the present ones, sound.js builds its callers from every species.json entry; the lineup already
skips absent species (arrival.js).

The kill sounds (2026-10-28, an Opus lane; sound.js `_onKill`, verified here: "deer taken" and "vole taken" logged at
their spots with no errors). A kill from animals.js plays as one voice at the spot. The prey's last cry comes first
(a deer's buzzy falling bawl, a rabbit's wavering squeal near 2.3 kHz pitched lower for the jackrabbit, a vole's two
thin chips), then the struggle: 0.3 s of 150-600 Hz scuffle with 2-3 thumps. The hunter's sound goes over the
struggle: a lion's low growl, a coyote's or fox's snarl, a hawk's two wing-slaps, nothing from a raven. It uses the
bird bus and the 'event' source like the alarms, with refDistance 8-12 m, heard out to 120 m (a rabbit or vole 50 m)
and fading a further 60% past 60 m, so a deer kill at 22 m matches a raven alarm and at 115 m is near the floor; at
most two kills play at once. The player's own catch plays at the player without a panner, at about the level of the
player's own call. Each kill is logged as "<prey> taken". The soundscape's callers now skip species the pipeline
marks absent (species.json `present`), the species lane's sound.js follow-up.

Edge leaks are handed back to their stream (2026-10-28, an Opus lane; pipeline/channels.py `_link_edge_leaks`,
verified here: the stream over the Yosemite Falls lip is Yosemite Creek, perennial, order 4, 110 km2, 13 m wide; all
29 of its pieces perennial; the fall draws in October as a thread and the minimap names the creek). The fill makes
every border cell an outlet, so a creek on a flat floor along the tile edge wanders onto a border cell and leaves
with its whole basin; on the Yosemite Valley tile, Yosemite Creek runs within 40 m of the west edge for 3 km above
the falls, left there, and reached the lip carrying 10 km2 instead of 110, unnamed and intermittent (the inflow
seeds at the tile edge were already there; this was the loss after them). Now each border outlet draining 0.15 km2
or more with an NHD flowline within 60 m is judged against that stream followed downstream: if NHD stays inside, the
outlet is pointed at the lowest cell near the stream further down; if NHD leaves and comes back at an inflow seed,
the outlet is pointed at that seed, nothing is drawn along the border, and the seed adds only the NHD area the
handed-over flow does not already carry (the tributaries that joined outside), so no area is counted twice; the
network walk takes those cuts and the Strahler order crosses a hand-over. Chosen over routing on a DEM buffered
beyond the tile because it needs no new downloads, keeps routing on the lidar tile alone and leaves interior routing
untouched; the home tile changes by under 1 km2 on two creeks (dry run, not rewritten). Not covered: a creek the DEM
sends off the edge far from any NHD line (Tenaya Creek here, 400 m off, so the Merced below shows 587 km2 against
NHD's 707); the connectors where NHD stays inside are straight (Snow Creek's longest 398 m along the east edge).

American black bear (Ursus americanus) for the Yosemite tile (2026-10-28, an Opus lane; verified here: a sow with two
cubs summoned at the village meadow, brown with a tan muzzle, standing, walking and bedding, the player in the sow's
body, no errors). No CC0 or CC BY mesh reads as a black bear, so it was generated: one Meshy `latest` preview (20
credits, job 01a1814a; 380 of the 1,000 spent in all), prompt A of library/animals/drafts/ursus_americanus.md. It
read as a black bear, not a grizzly (no shoulder hump, straight face, tall ears, stub tail), so no second preview and
no refine. tools/build_bear.py turns the head back to the midline (18 degrees off), lengthens the body 1.12x and
scales it to 0.8 m at the shoulder (1.34 m nose to rump), colours a brown-phase Sierra bear with a tan muzzle and
builds tiers of 2,998 / 1,199 / 459 triangles (lod2 decimates the body, then the head, so the far tier keeps a
snout). The client spawns it like the lion: one lone bear or a sow with cubs per 1.5 km territory cell, at most one
group live; home is forest and chaparral from 1,000 m, or oak woodland from 800 m in fall; few are about in winter.
It is about at dawn and dusk, all day in fall (hyperphagia), bedded at the summer midday; it ambles, digs and forages
with its head down, goes to oaks in fall, feeds at carrion within 300 m for a minute, hunts nothing and flees from
nothing; a player inside 8 m gets a short bluff charge or a stare. Playable (E digs, X lies down); a lineup row and
the opening-screen still (client/tools/opening_sprites.js gained `?only=`). The pipeline lists it with an 800-3,000 m
range (this project's estimate), everyone perceives it, and it scavenges the lion's and the coyote's kills.
Open: a cinnamon colour variant; standing on the hind legs; in shade the brown reads near black at a distance.

The client honours the present species (2026-10-28, the species lane's follow-ups): the spirit, which has no
`perceives` row, now perceives the union of every row (the present species) rather than every species the client
knows, and PENDING (species the client draws that a tile package predates) applies only to a species the package's
species.json does not know at all, so an absent species is not re-added; the sound module's callers skip absent
species as well. On Yosemite the spirit no longer sees jackrabbits, brush rabbits or voles.

Scavengers feed (2026-10-28): a player whose species is a scavenger in games.json relations.scavenge (raven, vulture,
coyote, bear) feeds at carrion within 2.5 m: E for a walker, landing beside it for a flier (animals.js feedNear,
groundControl, flierControl); the hunger fills once per carcass and the toast says "fed at the deer". Feeding does
not consume the carcass. Verified: a coyote's E beside its own kill filled its hunger from 0.4. So the raven's loop
closes: follow the lion's kill, land, feed.

Tenaya Creek reaches the Merced (2026-10-28, an Opus lane; pipeline/channels.py `_route`; verified here: Tenaya
Creek 123 km2 ending at the Merced, the Merced 707 km2 at the exit against NHD's 707-708, no unnamed stream over
100 km2, Yosemite Creek over the falls unchanged at 110 km2). On the Yosemite Valley tile, Tenaya Creek left its
channel east of the village, crossed the floor south-west and left the tile at (4452, 2) with 114 km2, so the Merced
reached the west edge with 587 km2. The cause was routing, not terrain: pysheds leaves a few cells with no flow
direction, one on a level stretch of Tenaya's own channel, and the fallback that hooks such cells to a neighbour
that drains out of the tile took the first one reached, rise or not, hooking the channel 6 m up the bank though the
level channel led on to the Merced. Now a pass attaches only cells with a draining neighbour no higher than
themselves, and a rise only when none is left (ATTACH_PASSES 2000; the accumulation runs once after). The home tile
is unchanged in a dry run (named creeks within 2.3 m, the same areas and orders); the other tiles shift slightly on
their next channels build. Burning NHD perennial lines into the DEM was tried first and rejected: even half a metre
pulled the home tile's lidar creeks up to 50 m onto NHD's offset lines, and the fix does not need it.

Mountain quail (Oreortyx pictus) for the Sierra (2026-10-28, an Opus lane; verified here: a summoned covey of 11 and
seven natural coveys, 51 birds, on the rocky ground by the village meadow, no errors). The Sierra's own quail, for
the Yosemite tile: a Meshy `latest` preview (prompt B; prompt A came out a dove; 40 credits in all, 420 of the 1,000
spent) adopted by tools/build_mountain_quail.py into client/assets/mountain_quail.glb, 0.27 m, tiers 1,000/400/119
at 12 and 40 m, the bird rig with HEAD-tagged plumes and a female colour set. The generator sculpted the breast as
overlapping scale flaps whose tunnels stopped Blender's collapse at 550-1,100 faces and broke a voxel remesh, so the
build re-skins the body (a sphere pushed out to the outer surface along rays from the body's centre) and keeps the
generator's head and neck; the plumes (two straight 5.5 cm quills leaning back), legs and tail fan are procedural.
In animals.js it is slot MQ and reuses the California quail's covey machinery through a covey's own species, on its
own covey list so sound.js's California quail clucks and assembly calls stay with the California quail; its flush
event has group null with species and covey. Coveys of 6-12 (pairs in spring) live on chaparral, brushy edges and
forest understory from 600 to 3,000 m (2,000 m in winter, below the snow), so the foothill tiles have it only in
their highest brush; a flushed covey glides downhill into brush; hawks stoop at it and coyotes flush it. Playable as
`mtnquail` with the covey pilot. In the pipeline: RANGE 600-3,000 m on chaparral and mixed and conifer forest, prey
of the hawk, coyote, fox and raven, ALARM_CALL 150 m, UNIT covey. Open: the female's shorter plume, plumes laid back
when running, its quee-ark call in sound.js, the lineup's back-colour flag (the buff wing stripe is broad).

Mountain quail voice (2026-10-28, an Opus lane; sound.js; verified here: a synthetic alarm logged "mountain quail
alarm" and a flush "mountain quail" at 14-15 m with no errors). The male's "quee-ark" (rising 1.3 -> 1.9 kHz, a gap,
falling 1.7 -> 1.1 kHz, a whistle with a breath of noise) is a CALLERS entry that plays only from a real bird within
400 m (no random-spot fallback, since animals.js keeps the birds to their brush and 600-3,000 m), weighted by the
month (April-June full, July half, fall and winter near silent) and given in bouts of 3-6 calls 4-8 s apart on the
same bird, one bout per species at a time. Its covey's flush (species oreortyx_pictus, group null) is one voice:
2-3 birds' trilled "krrr"/"quit" alarm clucks (2.5-3.5 kHz, 0.1 s notes) within 150 m, then the existing whirr
without the California quail's pits or "chi-ca-go"; the same clucks are its ALARM entry (refDistance 12 m, range
150 m), and a flush with clucks and an alarm within a second share the de-duplication time. The caller fields `r`,
`real`, `bout` and `months` are optional and leave the other callers unchanged.

The hunt loop (2026-10-28, Aaron's "make the lion's and coyote's hunt a replayable loop with a stake, a HUD goal and
a dawn-to-full-belly arc"; client/src/hunt.js and the pieces it leans on). The stake: a hunter's body is taken hungry
(needs.js 0.45) and drains over 24 min; an empty belly ends the body (needs onStarve: the toast, then the spirit
leaves it), the exit Aaron pointed to. The goal: a panel above the needs with the nearest prey within 400 m, its
distance, an arrow from the body's heading, and its state: unaware (beyond its notice), alert (noticed, head up) or
fleeing; the legs (stamina) and the arc line ("hunting 1:20 · 1 rush · best 2:10"). The stalk now counts the cover
(groundControl: the tree and shrub cover at the body scales the stalk factor by up to 0.35, so a lion frozen in brush
is noticed at 42 m instead of 300) and animals.js danger() shrinks a species' flee radius for a threat it can barely
see (base times n/120, floor 0.35: a hidden lion is fled at 12 m instead of 35), so the ambush gets close only in
cover. The chase: a deer herd's flight is a startled trot for its first second, then a gallop at 11 m/s while the
hunter is within 40 m (trotting again 2 s after it falls behind); a hunter's full run lasts S.sprint s (lion 3, fox
4, coyote 7), then it is tired at half speed until the legs come back (25-30 s); a rush that reaches its prey catches
it on contact (no key), a rush that fails makes the hunter known (every species notices it 1.6x as far for 45 s); the
lion's run ramps in 1 s now, a cat's explosive rush. The arc: a catch fills the belly and ends it ("a full belly: 1
kill in 0:34, 2 rushes"); kills per tile and the best time persist in localStorage. Verified: an open-ground rush
from 25 m fails (the deer galloped, the lion tired at 35 m and was known); from 12 m the lion caught a deer in its
first second and the arc closed; hunger 0.45 at the take; starvation returned the spirit. Not verified by play: the
feel of a real stalk through brush to 12 m, and the coyote's loop on rabbits (its mechanics are the same, its
sprint 7 s against a rabbit's 5-6 m/s bolt). Open: the fox and the coyote's small prey give no chase to speak of; the
panel's arrow could become a mark on the ground; the prey's own win (a herd that reaches cover) has no reward yet.

## 2026-10-28: detail at every scale: one body-scale number drives the near world

Aaron's three asks, in one program ("way way more grass for lizards, and stones"; "individual leaves rather than cards
for things < 20 m"; "simulated detail to create micro-variations so that the world looks good at every scale"; and
"for the LIDAR map we have, can we add simulated detail there?"; "Ok move forward with all of this"). The principle:
the instance budget per frame stays about constant and what shrinks with the body is the radius it is spent on; and
each scale's data is the next scale's conditioning, nothing finer is random. `client/src/bodyScale.js` is the one knob:
the species' shoulder height over the deer's (groundControl.js GROUND[code].shoulder), clamped to [0.025, 1]; the
lizard 0.026, the vole 0.042, the ground squirrel 0.095, the rabbit 0.16, the fox 0.39, the deer 1; the squirrel's own
control 0.1; the spirit and the fliers 1. main.js sets it from the body hook (onBody) and the near-detail systems
subscribe. Five lanes, each an Opus agent with strict file ownership, verified here before its commit:

- **The body-scaled grass ring** (grass.js): a tier that exists only below scale 0.6, radius 16 sqrt(scale) m clamped
  to 1.5-10 (a lizard 2.6 m, a vole 3.3, a rabbit 6.4, a fox 10), blades at real density (400-1000 bases per m² on
  grassland) from a separate denser hashed placement; at scale 1 the frame is byte-for-byte today's.
- **The litter ring** (litter.js): pebbles and grit, fallen oak leaves, acorn caps, twigs and lying stems inside the
  same ring, drawn from the terrain shader's own material weights (the ground-detail mask, the habitat masks and the
  canopy), so the 3D pebbles sit where the photo and the 2 m detail texture already show gravel.
- **Micro-relief and the third octave** (terrain.js, groundDetail.js, tilepackage.js): a nested patch under the body,
  side 24 sqrt(scale) m over 96 cells (a lizard 3.9 m at 4 cm, a deer 24 m at 25 cm; 192 cost 2.2 ms of tiny triangles at
  a lizard's eye, so the shape is 96 and the lighting comes from bump normals baked at 384, 1 cm for a lizard), displaced by a
  deterministic noise implemented alike in JS and GLSL and conditioned on the material (rock sharp to 12 cm, tussock
  bumps on thatch, nothing on pavement and water), scaled by the lidar's roughness where there is one; the ground
  sampler returns the patch surface inside it so feet sit on the bumps; the five detail textures sampled again at a
  20 cm repeat within the patch.
- **The leaf level** (treegen.js, vegetation.js): a fourth meshing inside 6-15 m of the camera (a deer 6, the squirrel
  15) where each close card becomes its individual leaves at the positions the card's texture was drawn from, instanced
  through the close canopy's matrices, with per-leaf wind; conifers as fascicles; built lazily per (species, seed); at
  most 100 k leaves a tree, not the 40 k first asked (a blue oak records ~440 k, a canyon live oak 1.7 M: at 40 k the kept
  leaves came out 3-5x too large; at 100 k big oaks keep 14-35 % at 1.3-2.2x). Aaron's shimmer rides on the cards:
  the lit colour lifts toward a pale sheen in waves travelling downwind at the wind's speed, phased by a hash of the
  card's world position and gated by the gust field, pixel-identical to a calm frame at wind 0.02.
- **The lidar micro raster** (pipeline/lidar.py): client/lidar_micro.png at 4 m (2500 px, 13 MB; the 2 m first cut was
  52 MB, too heavy to ship) on the lidar tiles, R the ground-return intensity (the source has it), G the ground
  roughness, B the multi-return share under a 1 m canopy (standing low vegetation), re-streamed from the point cloud
  (about an hour a tile). G was first the spread of ground points about their 1 m cell's mean, as asked, and on the home
  tile that was almost entirely slope (a tilted plane spreads s / sqrt(12) over the metre; correlation with slope 0.87),
  so it is the spread about the 1 m DEM surface instead (slope and curvature removed; correlation 0.38; p50 1.7 cm,
  p90 3.1, p99 6), and the client subtracts only the tile's ranging noise (p10, 0.95 cm) before scaling the bumps 0.6-2.2x.

Verification and what landed: see the report rows for each commit (docs/report-2026-10-26-morning.md).

## 2026-10-29: the gray squirrel's own control smells too, with a legibility floor on the wisps

The one body left out of the smell sense (scent.js, 3a7e015) was the western gray squirrel, which has its own control
(squirrelControl.js) rather than the generic walker's, so main.js never called scent.update for it. Now it does
(while the squirrel is on and not mid-arrival; its game stays the acorns, not the needs). Scent takes the squirrel
control and places the ring as a rodent's: a 10 cm shoulder times the rodent head factor over its feet on the ground
(11 cm), lifted 45 % when it sits up on shift (16 cm), 8 cm ahead of the body; on a trunk, a limb or in the air at the
body. Its reach was already in the table (40 m, SOURCE 0.8 as a source).

Found while verifying: at the squirrel's scale (0.1) the ring is 9 cm and a strand 2-3 cm, which from its chase camera
2.6 m off was a 3 px by 10 px smudge, invisible on gravel. The deer's wisps are sized for a 90 cm ring seen from a few
metres, so a small body seen from proportionally farther loses the strand. The floor: a strand shorter than 36 px on
screen is drawn longer, with its motes bigger, by up to 6x (the squirrel's 3.6x: a 10 cm strand, 8 px motes); the ring
keeps its size (Aaron's circle round the head), so what grows is the plume off it. The deer's strands (70-90 px) are
untouched (the factor clamps to 1); a lizard's grow a little.

Verified on the clean worktree as the squirrel (?skip=1&as=squirrel) with the wind pinned and a fox summoned 20 m and
10 m upwind: smelled it at 0.37 and 0.65, bearing right, 0.04 ms a frame; the strand reads in profile from the chase
camera; B back to the spirit leaves the list empty and the wisps dark.

## 2026-10-29: "scented" on the hunt panel, and the leaf level to 15 m

**Scented** (Aaron: "Yes, scented state"): the hunt panel's goal line (hunt.js) gains " · scented" (or " · a faint
scent" under 0.3) when the smell sense has the prey it names. The first cut read scent.smelled, the list of the six
strongest wisps, and the fox's vole 31 m off was not in it (six other animals were stronger), so the panel showed
nothing; the sense now answers for one animal (scent.js smell(a), the query's formula factored out as strengthOf) and
the hunt asks for its target. What it tells the player: the prey is upwind, so the hunter is on the side it cannot
smell from. The prey's own nose is not modelled yet (no animal smells the player; see the roadmap).

**The leaf level to 15 m** (Aaron, the same hour: "The individual leaves look great on trees - can you expand the
radius where I see that from 10ft or so to 50 feet?"): vegetation.js LEAF_R0 6 -> 15 m for a deer (the spirit and the
fliers too), LEAF_R1 15 -> 24 m for the smallest bodies (the fox 21). The caps hold it: at a fox's spot in the home
tile's oak woodland 13 trees and 958 k leaf quads (of the 1.5 M frame cap, 48 trees), 25.7 fps against 26.7 at the
old radius and 28.7 with no leaves (the pane at 2x DPR, 2044 x 1848 px, 10 M triangles: GPU-bound there anyway); as a
deer 11 trees and 914 k quads. The LRU of 24 built geometries is 28 MB at 12. If a spot ever fills the cap, the farthest
trees keep their cards (nearest first), which is the designed fallback.

## 2026-10-29: the prey's nose: every animal smells the player by the wind

Aaron: "Yes, prey's nose". Until now an animal noticed the player at perception.json `detects` (species_data.detect_m:
the best of its senses against the player's signature), one number per species, scaled by the stalk; a deer's best
sense of a lion is its nose (300 m), so a lion creeping low was noticed at 120 m from any side and the wind meant
nothing. Now perception.json carries each species' own `senses` (vision, hearing, smell; build_tile.py writes it,
every tile's file updated in place), and the client splits the notice: what the species sees and hears of the player
(min of its range and the player's signature, the larger of the two; scaled by the stalk and by being known) and what
it smells (min of its smell and the player's scent signature), shaped by the wind through wind.js scentCarry, the
same shape the player's nose uses (full with the wind blowing from the player to it, half crosswind, a fifth
downwind, 0.45 in still air; not by the stalk, since a hunter low and slow smells the same; 1.6x while known).
animals.js noticeAt gives the larger; threat() uses it for the player, so every species' alert, freeze, flee, bolt and
flush code sees the wind through it. notice[sp] (the old best-of) stays for the callers with no position (a watcher's
alarm call, a bird's flush) and for the AI hunters' prey (no wind between AI animals: a later pass).

Measured as a lion frozen 72 m from a deer, wind 0.4: with the wind from the lion to the deer it notices at 300 m
(capped at the 120 m alert), with it the other way at 60 m (its eyes 24 m, its nose 300 x 0.2); in still air 135 m.
The hunt panel judges unaware/alert the same way and adds " · downwind of you" (orange) when the wind carries the
hunter's scent to the prey it names (carry over 0.75), so the player learns to come round. A tile without `senses`
(none now) falls back to the old one number, no wind.

## 2026-10-29: a turning deer steps first, and the body follows the legs

Aaron: "Can you do another pass on animal rigging - its looking much better but I think we still have some ways to
go. For instance, when a deer rotates or turns in place it should move its legs and step for its torso to move - the
legs move first in real life and pull/push the body." A deer turning in place rotated about its origin with the idle
clip playing: a figure on a turntable.

Now (animalModels.js DEER_DRIVE.turn, driveClips, turnFollow; groundControl.js draw; animals.js drSteer): a standing
deer (under 0.08 m/s) turning faster than 0.45 rad/s plays a 'turn' kind, the Walk clip laid over the standing clip
it came from (idle, grazing, alert) at 0.4 of its stride for a slow turn and 0.6 at 2 rad/s, with the step rate from
the hooves' ground travel round the turn (0.42 m from the turning centre to a hoof over the stride): the player's full
A/D turn at 1.8 rad/s steps at 2.0 Hz, a 0.6 rad/s turn at 0.9 Hz, held between 0.7 and 2.4 Hz. Hysteresis: in above
0.45 rad/s, out after 0.35 s under 0.2 so the step under way finishes; blends 0.2 s in and 0.5 s out, and a change
undone mid-blend swaps the two clip slots keeping each clip's phase (this also removed a leg-phase jump on walk, idle,
walk). The body follows the legs: the drawn yaw lags the control yaw by 0.15 s, never more than 25 degrees, fully
under 0.3 m/s and gone by 1.2 m/s; flight.yaw, the camera and the look are untouched, and the instance matrix carries
the lagged yaw so the planar shadow and the herd silhouette agree. No assets added (no Meshy credits). The AI deer got
the same through a new steer: a turn capped at 2.2 rad/s (6 fleeing) and the walk scaled down by heading error (full
within about 29 degrees, standing past about 80), so a deer whose waypoint or herd is behind it turns on the spot,
stepping, then walks, instead of crabbing sideways while spinning at 6 rad/s; a standing deer steps round to face a
threat it is alert to more than 40 degrees off, and a grazing one takes a new heading about every 14 s from its own
seeded numbers. One behaviour change to know: a fleeing herd wheels for about 0.35 s before it bolts, which widens a
rush's window a little; kept, since that is what a herd does. The fox, coyote, lion and bear are on the procedural part
rig, not driveClips, so the deer alone has it; the same for them is a small change in groundControl.animate (leg
amplitude 0.5 and phase from the turn rate at a standstill, turnFollow in draw).

Verified on the clean worktree as the deer: holding A from a standstill goes to 'turn' within 0.25 s at 2.0 Hz, the
Walk at 0.45 of the blend, the body 12-13 degrees behind; releasing ends it 0.5 s later with no flicker; a side view
mid-turn shows a fore leg lifted and a hind leg stepping back as the body comes round. Hooves still slide some in a
turn (the Walk moves a planted hoof back along the body, not sideways round the arc); the lane's list of the next rig
fixes, in order: a spine twist so the head, shoulders and hips turn in that order; a sideways-step clip or IK on the
cannon bones so hooves plant in a turn; the Walk phase run backwards when backing up (S); a trot between 2.2 and 3.5
m/s; leg length to the slope (downhill hooves float on a cross-slope); an alert pose of its own (head high, ears
forward, a fore hoof raised) instead of the Idle clip.

## 2026-10-29: the wind ripples across each crown

Aaron: "The wind in an individual tree is good - I can tell its on a sine wave in a larger system - but there should
be a micro-sine-wave in each tree. Right now all the branches of a tree move in unison. The wind intensity should
ripple across them in a transition from the direction of the wind to its destination." The crown cards had no
positional sway at all: the only wind in a tree was the leaf shimmer (a 9 m brightness wave) and the leaf level's
flutter, both scaled by the slow gust term whose cells are about 20 m across, so a whole tree swelled and faded
together.

Now (treegen.js LEAF_WAVE_GLSL, CROWN_SWAY = (0.35 m, 3.5 m, 4 m/s, 0.7)): a sine of the point's distance along the
wind from the plant's origin, travelling downwind at 4 m/s (the speed the gust cells already travel, so the small
wave rides inside the big one; about 1.1 Hz, a branch's frequency; the windward side of a 4 m crown leads the leeward
by about a second), wavelength 3.5 m (an oak crown holds two or three waves; a 2 m shrub moves nearly as one, as real
ones do; not scaled by crown size, which the shader does not have short of a new attribute), plus a per-branch phase
of up to 0.35 rad from the card's rank (the leaf level has the same rank, so its phase agrees). Each vertex is pushed
downwind, and a quarter as much down, by up to 0.35 m times windStrength, scaled by the wave, by the slow gust (30 %
in a lull, 100 % in a gust) and by its reach from the plant's origin over 8 m, so trunks and inner crowns hold still:
at windStrength 0.3 the outer branches move up to about 10 cm. The shimmer's and the flutter's gate is multiplied
0.7-1.3 by the same wave, so the brightening ripples across the crown too. The offset comes from the vertex position
less the plant's origin, taken into the plant's frame by crownLocal() (rotation and per-axis scale): no new
attribute, about a sine and a dozen operations a vertex. Near and close cards sway, the leaf level's single leaves
with the identical displacement (a tree's motion does not change at the leaf radius), and the close twigs: a 1-float
twigT (0 at the base, 1 at the tip) in twigGeometry and vegetation.js twigSway() keep a twig's base on its limb while
its tip follows the card hanging from it. Mid cards (beyond 180 m) get the shimmer change only (10 cm is under a pixel
there); impostors unchanged. Every term is gated by smoothstep(0.03, 0.2, windStrength): the calm frame is unchanged.

Verified: the lane rendered one blue oak with time frozen and compared frames 0.1 s apart, sway on against off: the
peak moves downwind about 0.5 m per 0.1 s (the 4 m/s) with a repeat about 3 m (the 3.5 m wavelength); at windStrength
0.02 the sway-on and sway-off frames differ by 100 pixels, the same as two identical frames (96). All 277 shader
programs compile on ANGLE/Metal. On the clean worktree as a deer in the oak woodland: 30.0 fps with the sway and 28.7
without (noise); no console errors. Open: the shadow casters (shadows.js) do not sway, so moving leaves can cross
their still shadow; a slow sway of the whole crown bending the limbs; Aaron can tune the amplitude, wavelength and
speed live through CROWN_SWAY.value in treegen.js.

## 2026-10-29: the deer bends into a turn and steps sideways round it

The second rig pass of the day (Aaron: "Yes, next rig pass"), on the two opens the first left: the deer turned as a
rigid body a beat behind its legs, and the hooves slid in a turn because the Walk clip moves a planted hoof straight
back along the body while the body turns under it. Both are a per-instance bend now (aBend, a vec4 on the skin path
beside aClip: animalModels.js bendOf, called after turnFollow and driveClips for the player in groundControl.draw and
for the AI in animals.update, carried through the LOD tiers, the herd silhouette and the lineup):

- The spine (aBend.x). The lag between the control yaw and the drawn hips (turnFollow's dy) is drawn as a bend: a
  rotation about the vertical through the hips whose angle grows with the vertex's rest z, nothing at the hips, all
  of it from the neck base on (smoothstep between the BackShoulder and Neck1 joints' rest z), so the head faces where
  the deer is going and the hips come round behind it: head, shoulders, hips in order, as Aaron asked. At the full A/D
  turn (1.8 rad/s) the bend is 12 degrees; the cap is turnFollow's 25.
- The head (aBend.y) leads a turn by 0.12 rad per rad/s, up to 0.25, every deer; it is the look's rotation about the
  neck base, which the player's look (uHeadYaw) adds to, so the PLAYER_HEAD block became the SKIN_HEAD block.
- The legs (aBend.z the fore, aBend.w the hind). Each leg's swing out of standing (the vertex's place under the Idle
  clip's first frame as the reference: 12 more texel fetches, for the leg vertices of a turning deer only) is turned
  about the vertical by atan2(w r, v), w the smoothed turn rate, r the fore or hind hoof's rest z (0.35 m ahead,
  0.43 behind, from the clip index's joint_rest), v the speed floored at 0.1 m/s: a standing turn steps square
  sideways, the fore hooves toward the turn and the hind hooves away (the direction a planted hoof must travel for the
  body to wheel about its centre); a walk on a curve arcs the hooves a little; a straight walk is unchanged. Only while
  a gait clip plays. A leg swung forward by an angle, turned 90 degrees about the vertical through the shoulder, is
  the same leg swung sideways by that angle, so the Walk's own clip does the sidestep: no new clip, no bake change.
  The joints' roles come from the index's joint names (the Front*/IKFront*/FF.* joints the fore legs, Back*/IKBack*/
  FFB.* the hind, PoleTarget* with their leg).

Verified on the clean worktree: an AI deer pinned in front of the camera turning at 1.5 rad/s plays the turn at
1.8 Hz with spine 0.21 rad and legs +1.38/-1.41 rad, and a sequence of close frames shows the forequarters leading
and the legs stepping across sideways, the body whole; the player's D turn 1.8 rad/s at 33.7 fps; bucks draw with
the antler program (15 attributes) without a shader error. Not measured: whether the planted hoof is now still on
the ground to the centimetre (the turned swing follows the Walk's own stance travel, which was spread over the cycle
by the bake); Aaron's eye decides whether a true sideways-step clip is still wanted. The same stepping turn for the
fox, coyote, lion and bear on the part rig followed the same hour (below).

## 2026-10-29: the fox, coyote, lion and bear step round a turn too

An Opus lane with the deer's design, on the part rig (animalModels.js PART_TURN: the deer's thresholds, step
amplitude and rate, and the drawn body's lag, through the same turnFollow). The player's quadruped
(groundControl.animate) standing and turning over 0.45 rad/s steps at 0.4-0.6 of the walk with the rate from the
paws' travel round the turn (r half the body length, the stride the species'), off under 0.2 rad/s after 0.35 s, and
draw lags its yaw as the deer's. The legs' swing is turned about the vertical through the pivot by atan2(w r, max(v,
0.1)), carried in aAnim2.z, which the lane checked is unused on the part rig's quadrupeds (the gait selector is .w,
the lion's tail twitch .y; the ground raven's hop and the buck's antlers read .z, so the block is behind ANIM_GAIT and
not ANIM_ANTLER): the fore legs toward the turn, the hind legs against, by conjugating the fore-aft swing with a yaw.
The AI (mmUpdate): mmStep turns by drSteer, 2.2 rad/s walking and 6 fleeing, rushing, charging or over 3 m/s, with
the travel scaled by the heading error so an animal facing away turns on the spot first instead of crabbing; four
instant yaw changes (the sniffing re-heading, the look back after a flight, a bear's stare at the player, and the
bear's snap to face the player before a charge, which now steers round to its target instead) step round through
a.wy at 1.2 rad/s; the turn rate measured from the previous yaw drives the step and aAnim2.z. Behaviour change
beyond the drawing: a charging bear no longer faces its target instantly, so the charge's first half second turns.
Measured by the lane: the player fox at 2.6 rad/s steps at 1.8 Hz, amp 0.6, legs 1.42 rad, body lag 0.35; the lion
at 2.0 rad/s 1.5 Hz; a pinned AI fox at 1.5 rad/s 1.16 Hz, a bear at 1.2 rad/s 1.33 Hz; 36 fps as the fox, 35 as
the lion; no shader errors. Checked on the clean worktree as the fox: 2.6 rad/s, amp 0.6, 1.63 Hz, legs 1.42 rad,
lag 0.35, 35 fps, the legs splayed across the turn in the close frames; a pinned AI fox amp 0.53, 1.33 rad. Not
driven: the coyote (the fox's path), a walk on a curve. Known: when a turn ends the last steps swing from sideways
back to fore-aft as the smoothed rate falls while the amplitude eases out, continuous but visible.
## 2026-10-29: the eyes and the ears: who the player has in sight, who sees the player, what the player hears

Aaron: "I'd also like for sight and sound to have indicators for predators and prey. For prey animals, if they are
within a certain distance of predators and visible to the camera, there is a chance that their body becomes highlighted
in their rarity colors - the opposite of how a herd sees. The herd sees occluded, the predator sees only what is
visible highlighted. Same vice versa - the prey animal has a chance of 'spotting' the predator. If that chance succeeds,
the predator becomes highlighted. Any animal across species retains the highlight for 5 seconds - if they are spotted
again within that 5 seconds, the timer resets. This makes it possible to hide in cover and 'lose' the predator or make
it so the prey can't see you anymore. For sound, if I hear a predator or prey, little sound bubble waves pulse out
around/near where the sound originated from. If the location is not in the viewport, the sound waves appear at the
edge of the screen closest."

**Sight** (sight.js): every live animal the player's species hunts or is hunted by (games.json relations.predation
both ways, animals.js preySlots) within the player's vision of it (perception.json senses[player].vision against
signatures[it].sight, the smaller: a lion sees a deer to 300 m, a deer a lion to 60) rolls, each frame it is in the
camera's view, a chance of being spotted: 3 per second at the eye falling with distance as (1 - d/range)^1.5, times its
motion (a still body 0.3, a walk 0.7, a trot 1.5, a bolt 4: a bolting deer is spotted at once, a bedded one in a few
seconds, a lion standing 45 m off about once in nine) and times how much of it the camera can see. That visibility is
a CPU line test from the camera to the body's centre: the drawn ground marched every 4 m (a rise hides outright; the
micro-relief gets 15 cm of tolerance, since the first cut had two low bodies hidden from each other by the bumps of a
flat field), every tree in vegetation.js's near set (inside 180 m) as a crown sphere at 0.62 of its height, a third of
it across, hiding by the chord's depth (a glimpse through the edge keeps some), and a trunk cylinder up to the crown
hiding 65 %; a plant under 6 m is a shrub, foliage to the ground (a sphere at half its height, nearly as wide as tall,
no trunk); beyond the near set the canopy raster's tree cover per 30 m cell; and the shrub cover of the cell the body
stands in. Tested four times a second per animal, 0.05-0.15 ms a frame with a herd and a lion about. A success holds
the highlight 5 s from now (a re-spot resets it), so an animal that steps behind cover is lost once the hold runs out.
The same the other way: each such animal's chance of spotting the player is judged as its AI judges a threat
(animals.js noticeAt: its eyes and ears shrunk by the stalk, or its nose in the wind), the sight part scaled by its own
view of the player's body (from its eye to the player's shoulder), 2 per second per unit of notice over distance above
0.8: a lion's 300 m sight has a deer 45 m off in the open within a frame, and loses it behind a shrub (the hold lapsed
both ways with the deer 1.3 m behind a 4.6 m shrub 45 m from a standing lion; stepping out, the lion had it again in
0.2 s). Both are chances the player cannot inspect, which is the point: a lion in plain view is not always lit.

The highlight is the herd silhouette's opposite (herdSilhouette.js draws what cover hides): one InstancedMesh per
species with the species' own posing (animalModels.js animalSilhouetteMaterial, its depth test turned to LessEqual
with a polygon offset toward the eye), so only the surface the camera sees is lit, additively at 0.42 (0.7 made a lit
deer a flat cutout; at 0.42 its shading shows through the wash) in the species' rarity colour, fading over the last
second of the hold; a body that sees the player throbs at 1.6 Hz. The intensity rides in the instance matrix's unused
element [3] (m[0][3], zero in any affine matrix; the vertex shader reads it out and zeroes it): no new vertex
attribute, the buck's skin path being at 15 of Metal's 16. The hunt panel (hunt.js) says "it sees you" in place of
alert when the prey has the hunter in sight and adds " · spotted" in the prey's colour while the hunter has it.

**Sound** (soundCues.js, index.html #soundCues): the same predators and prey are heard as far as the player's hearing
(senses[player].hearing) and as far as their own sound carries now: signatures[it].sound (the carry of its loudest
sound) times what it is doing, judged from its speed over the last frames: standing or grazing 0.06 (a grazing deer
is heard from 4 m), a walk 0.35, a trot 0.8, a gallop or a bolt 1.6 (a bolting deer from 96 m), a bird on the wing
0.15; plus the calls and flushes on the animals' event bus ('alarm' with its carry from alarm_calls, 'flush',
'turkeyFlush', 'gsAlarm'), heard within their carry whoever made them. A heard source puts three thin concentric rings
pulsing out on the screen at the projected point of the sound (20-56 px across by its level, the species' rarity
colour, fading over a second), repeated every 0.55-1.1 s while it goes on (faster when louder), a burst of three for a
call; a source outside the viewport, or behind the camera, shows at the screen's edge nearest its direction, as the
herd's off-screen marks do (herdMarks.js: a source behind the camera is mirrored, so a deer bolting behind you rings at
the top edge), inside an edge box that clears the menu button, the mini-map's column and the abilities row (the first
cut's bottom rings sat under the row). At most 24 pulses on screen; 0.02-0.1 ms a frame.

Verified on the worktree (port 8784) as a lion with a summoned herd (every species' notice damped and the herd pinned
in place so it stood instead of bolting at a lion 14 m off; otherwise the watchers' alarm calls sent it off at once): a
bedded buck lit beside its unlit herd-mates after a few seconds, the hunt line "unaware · spotted · scented"; the herd
released, all five lit and throbbing within 1.8 s ("fleeing · spotted"), rings at each; the lion turned round, the rings
at the top edge. As a deer with a summoned lion pinned standing 16 m off: the lion lit red and throbbing (both ways)
within 4 s; behind the shrub at 45 m, lost both ways after the hold; out of the shrub, seen again in 0.2 s. No console
errors. Not verified: the hunt loop played through with the indicators (the pinned and damped animals are a test
rig); the sight of the fliers (a hawk's view of a vole goes through the same test, untried); a spotted animal
with a drawn tier other than 0 (the pass copies tier 0's geometry, as the herd silhouette does); the cost with many
spotted bodies of many species (one mesh per species, up to 16 bodies each). Open: the "it sees you" throb and the
"spotted" steady wash share one colour, told apart only by the throb and the hunt line; the chance per second and the
motion factors are first numbers for Aaron to tune (RATE, STILL..BOLT, SEES_K in sight.js); an animal's view of the
player ignores the player's own cover beyond the shrub cover of its cell (the stalk already shrinks the notice).

## 2026-10-29: the sniff: every scent on the air, and a new one flickers in

Aaron: "For scent, each animal that relies on smell should have a 'Sniff' button that shows all the smells. When I
smell something new, the smell should flicker onto the screen and then flicker away."

Until now the smell sense (scent.js) drew the six strongest scents all the time. Now a scent is drawn when it is new
(not smelled within the last 8 s: its strand blinks on over 0.6 s, on-off-on-off-on, holds 4 s and blinks away, then
off at once) and whenever the player sniffs: the L key held (N is mute), the abilities row's "sniff L" slot held, or a
tap of either for 3 s; the fox, the coyote and the lion sniff with their own E act too (groundControl S.act "sniffing",
head down for 3 s), and for them the row shows no second sniff slot. Sniffing, the query keeps every source in reach
(up to 24, not the six strongest) and every strand shows; the hold over, they flicker away. Each strand carries a
label at its tip (index.html #scentLabels: the species' word, "dead" for carrion, in the rarity colour, as bright as
the strand; one within 48 px of another's is not drawn, since four deer on one bearing stacked "DEER" four times). The
hunt panel's "scented" (scent.js smell(a)) is unchanged: the nose knows what it is not showing.

Verified on the worktree as a fox: before the sniff nothing drawn with six scents in reach; L held, six strands and
their labels (two visible on screen, the rest behind the fox or overlapping), the slot lit; released, all flickered
away within a second. A deer herd summoned 20 m off: the buck's strand blinked in (alpha 1,0,0,1,0,0,1... at 50 ms),
its label "buck" with it, held 3.2 s more, blinked away and went dark; nothing drawn 5 s on. The fox's E sniff, on the committed code: one sniff slot (E) on its row, 24 strands and their labels while the act runs,
none 3 s after. Not verified: the slot held with the pointer (the key path was used); a carcass's "dead" label. Open: the label's word is the species' short
name, not "deer, upwind, 40 m"; the blink pattern is one fixed rhythm (a time-hash per strand would vary it).

## 2026-10-29: the map, small and close, and the full map on a click

Aaron: "The map should be smaller relative to the viewport and show a much more zoomed in view. Clicking on it should
open a fullscreen map. The roads markers should be white and semi-transparent." The mini-map (minimap.js) was the
whole 10 km tile at 240 px, 42 m a pixel, so a walking animal never moved on it. Now it is 150 px (120 on a narrow
window) and shows the 800 m round the player, 5 m a pixel, north up: the base (imagery, water, roads, names) is drawn
once for the whole tile at that scale (capped at 2400 px a side, so 4 m a pixel at dpr 2) and each frame the window
round the player is blitted from it, with the trail, the player, the nearest place name, the N and the caption drawn
over. A click on it, or M, opens the full map: the whole tile over the view, with the same overlay, where a click
flies there as the mini-map's click did and closes it; M, Esc or a click outside close it. M no longer hides the
mini-map. Roads are white and half transparent (minor 0.35, major 0.55 at 2 px over a faint dark casing, the names
white at 0.8) instead of orange over a dark casing. Verified on the clean worktree as a deer: Swan Lane under the
player in the window; the full map 876 px on the pane; a click a quarter of the way in flies to (2500, 7500) exactly
and closes; M opens, Esc closes. Memory: the two bases (present day and rewilded) are 23 MB each at 2400 px.

## 2026-10-29: the crown wave loosened in a strong wind, and the limbs flex

Aaron, on the crown wave of the morning: "The wind in the trees is looking good. The sine waves are a little too
tight sometimes when the wind is very intense, it just makes the tree look like its vibrating rather than the leaves
being individually disrupted because the cards are all moving as one. If it's possible to have the limbs flex in the
direction of the wind I think that would add to the effect." The wave's wavelength and speed were fixed (3.5 m at
4 m/s, 1.1 Hz) whatever the wind, and only its amplitude grew, so a strong wind shook the whole crown at 1.1 Hz with
the cards a few tenths of a radian apart.

Now (treegen.js LEAF_WAVE_GLSL): the wavelength grows with the wind, 3.5 m x (1 + 1.5 x windStrength up to 1), so a
strong wind's wave is long and slow (6 m and 0.65 Hz at 0.5, 8.75 m and 0.45 Hz at 1) and a light wind's is as it
was; the per-card phase is +-0.8 rad (was +-0.35); and each card and single leaf has a jitter of its own, 0.3 of the
sway's amplitude at 1.6-3 Hz from its rank, downwind and half as much across, so neighbouring sprays are disrupted
one by one (the twigs take no jitter: a card jitters about its twig tip). And the limbs flex (crownFlexW, the new
CROWN_FLEX uniform: lean 0.035 rad per unit windStrength, rock 0.4 Hz by +-0.4, jitter 0.3): every point of the tree
is moved downwind by the lean times the gust (0.4 in a lull, all in a gust) times a slow rock of the whole crown at
0.4 Hz with a phase from the plant's position, times its height above the plant's origin (quadratic over the first
6 m, linear above, so the lower trunk holds and the top moves most) and a little more at the outer limbs, and a
little down so a limb bends rather than tilts: about 0.3 m at the top of a 12 m tree in a 0.5 gust, 5 cm in a lull.
The near and close cards, the single leaves, the whole twigs (their bases with the limbs, their tips with the
cards) and the near trunk tier (trunkFlex on both trunk materials) take it, so the crown stays on its limbs; the mid
cards and mid trunks beyond 180 m are still; the calm frame is unchanged by the same gate. Verified on the clean
worktree with the wind pinned at 0.6: at seven times the lean a pine's trunk tip and crown move downwind together and
a near tree's crown stays on its stem; no shader errors; 36 fps as before. Not verified: the rhythm by eye over time
(a recording would show it); the shadows still do not sway or flex (shadows.js, open).

## 2026-10-29: the wind softened, the leaves from further, and the shadows move with the trees

Aaron, after the limb flex: "The swaying is too intense. Also I think the individual leaves can appear from further
away", and yes to the shadows. CROWN_SWAY.x 0.35 -> 0.2 m per unit windStrength and CROWN_FLEX (0.035, 0.4, 0.4, 0.3)
-> (0.02, 0.4, 0.3, 0.2): the lean 2 cm per metre of height per unit wind, the rock +-0.3, the jitter 0.2. The leaf
level's radius 15/24 -> 24/36 m (a deer 24 m, the smallest bodies 36), its frame cap 1.5 -> 2.2 M quads, the pool
48 -> 72 trees, the LRU 24 -> 32: as a deer at the home spawn 21 trees draw 1.54 M leaf quads at 31 fps (11 trees and
0.9 M at 33-36 before). And the shadows (shadows.js DEPTH_VERT): the near card casters take the crown's wave, their
jitter and the limbs' flex, the near trunk casters the flex, through treegen.js LEAF_WAVE_GLSL's own functions and
uniforms, so a leaf's shadow is where the leaf is; cascade 0 re-renders every frame, so the shadows within 120 m move
with the trees, and cascade 1 keeps the pose it last rendered (under its 0.6 m texel). The mid ellipsoids, the far
casters and the contact AO are unchanged. Verified: no shader errors in the caster programs, cascade 0 rendering
every frame, 37.7 fps as a deer with the wind pinned at 0.6. Not verified: the shadows' motion frame to frame (the
light at the spot was hazy; the motion follows from the shared functions). Open in the wind: the rhythm by eye.

## 2026-10-29: a cruise, a sprint and a meter for every body

Aaron: "All animals should have a top speed that is not their top speed - and a sprint button (shift) with a sprint
meter that is appropriate for their species." Until now W ramped a ground body all the way to its true top (S.run)
and Shift W walked; only the hunters had a meter (the legs: S.sprint seconds of a full run, shown during a hunt), and
the birds' Shift boost ran to vmax without end.

Now (groundControl.js LEGS, per species [cruise, sprint, recover]): W ramps from the walk to a cruise the body can
hold (deer 7 m/s, coyote 7.5, lion 6, fox and bear 5.5, jackrabbit 8, rabbit 4, turkey 3.8, ground squirrel 2.8,
quail 2.8 and 3.2, lizard 1.4, vole 1.0), Shift W is the sprint to S.run, the true top, for `sprint` s (deer 10,
coyote 9, jackrabbit 7, fox and bear 5, rabbit, turkey and ground squirrel 4, the quails and the vole 3, the lion's
rush 3, the lizard 2.5), after which the legs are tired (the top falls to 0.6 of the cruise) until they come back
over `recover` s (15 for the vole to 40 for the deer; sprinting again from half). The hunters' rush and the catch
ride the sprint exactly as before (hunt.js), and only a hunter's failed rush makes it known to the prey. Alt W is the
walk (the lion's stalk); the herd pilot walks with Alt near its slot. The birds (flight.js): W holds sp.fast (raven
18, hawk 16, vulture 14, jays 10 and 11), a dive still runs past it, and Shift sprints to vmax for sp.sprint s (raven
8, hawk 5, jays 4, vulture 3; recover 20-40). The squirrel: W 4 m/s, Shift W the full 6 m/s bound for 4 s, back over
20; Shift still sits up as before. The woodpecker: W holds 9 m/s, Shift the full 12 for 4 s. The abilities row shows
walk (alt W) and sprint or rush (shift W, red when tired) for every body, and the legs meter for every control.
Verified on the clean worktree: the deer 6.98 m/s on W, 11.99 on Shift, the meter empty after 10 s and the speed
capped at 4.2, recovering; the squirrel 4 and 6 with the meter half gone at 2 s; the hawk 16 on W, 44-45 on Shift
with the meter at 0.09 after 6 s; the legs meter shown for all three. Not driven: the woodpecker, the lizard, the
quails. Note for the Windows player: Alt alone focuses a browser's menu bar on key-up; a creep key that is not Alt
may be wanted there.

## 2026-10-29: no twitch at peak wind

Aaron: "When wind goes up in intensity when I'm near a single tree it still gets way too twitchy near peak intensity."
The weather's gust swell is slow (13 to 71 s periods), so the twitch was the shader's fast terms growing with the
wind: the leaf flutter wave ran at 2 + 9 x windStrength m/s (1.7 Hz at 1.5), the leaf's own tremble at 1.1-1.9 Hz
and the cards' jitter at 1.6-3 Hz, all with amplitudes that grew to 1.5. Now (treegen.js LEAF_WAVE_GLSL and the leaf
level) they stop growing: the flutter wave's speed is capped at windStrength 0.6 (0.8 Hz at most), the leaf's turn with
it at 0.8 and its tremble at 0.6 and 0.8-1.4 Hz, and the cards' jitter keeps the amplitude it has at 0.5 and runs at
0.8-1.6 Hz. The slow terms still grow (the crown wave at 0.45-0.65 Hz in a strong wind, the limb flex and the 0.4 Hz
rock), so a strong wind reads as big slow motion. Verified on the clean worktree at a pinned windStrength 1.3 with
the camera pinned inside a crown: frames 0.12 s apart shift the leaves a little each, no jumps; 35 fps; no shader
errors. Not verified: the rhythm by eye over time.
## 2026-10-29: the understory. Grasses, herbs and shrubs the animals live in and on

Aaron: "Can we add more grass and shrub and herb species - especially for terrestrial animals." Thirty species join
the library (56 now; `docs/species-library.md`, "Grasses, herbs and shrubs of the foothill understory"), every one an
agent draft, CC BY-SA 4.0, needing local sign-off, with the animals written into the records for the first time
(`relations.eaten_by` and `cover_for`) and where each belongs (`habitat`: class weights, floor / mid / steep / north,
shade, disturbed ground). Nothing downloaded: the plants are procedural.

- **Nine shrubs**, grown by the tree generator and drawn by the shrub impostor field like the six of 2026-10-26: common
  manzanita, buckbrush and deerbrush (the ceanothus), birch-leaf mountain mahogany, sticky monkeyflower, California
  wild rose, snowberry, Sierra gooseberry and chaparral currant. The species mix (`pipeline/species_mix.py`
  UNDERSTORY_SHRUBS, TERRAIN) weights them per community: buckbrush leads the dry chaparral and the blue oak slopes,
  deerbrush the pine and black oak belt above about 525 m, mountain mahogany and monkeyflower the rock, snowberry
  the north slopes and the oak understory, wild rose the floors and the riparian strips. The impostor field
  (`shrubfield.js`) now takes every shrub of the library but chamise and manzanita (FH, kinds -1 down, up to 16) with a
  look table (FH_LOOK: lobes, fringe, vase, fine leaves) instead of six hard-wired constants. Home tile shrub shares:
  chamise 21%, manzanita 19, buckbrush 11, poison oak 8, coyote brush 5, monkeyflower 5, snowberry 4, toyon 4,
  mountain mahogany 4, wild rose 4, common manzanita 3, coffeeberry 3, gooseberry 2, redbud 2, currant 1, deerbrush 1,
  elderberry 1.
- **Seven grasses** (`form: "grass"`): purple needlegrass, blue wildrye, California oatgrass, wild oat, soft chess,
  ripgut brome and hare barley. `grass.js` draws every plant as a species now: the blades, the body tier and the cards
  carry a species index (the instance code's 64s; the cards' kind + 8 species), the shaders read the species' season
  palette (root, tip, head, awn) and whether its heads show from uniform arrays, and the plant's clump is scaled by
  the species' height and width (blue wildrye 1.5x the bunch, hare barley 0.6x the annual). The species comes from the
  cell's ground mix (below) by type: the needlegrass share and its drifts still decide annual against bunch, so the
  sward's pattern is as it was, and the wild oat stands are the wild oat. The old two palettes are the wild oat's and
  the needlegrass's records, so the sward is the colour it was where they are placed.
- **Fourteen herbs** (`form: "forb"`), a new layer (`forbs.js`): California poppy, miniature and silver bush lupine,
  miner's lettuce, tomcat clover, soap plant, yarrow, gray mule's ears, blue dicks, fiddleneck, redstem filaree, hairy
  vetch, popcorn flower and common madia. Each is three alpha-tested quads (two crossed uprights and one on the
  ground for the rosettes) textured from a picture of the species baked at load with canvas 2D from its record (habit,
  leaf shape, size and colour, flower shape, colour and months, height by month, dead-stalk colour), side and top, for
  the month the season stands for: a poppy is a mound of ferny leaves with orange cups in April and a few pale stalks
  in July; soap plant a rosette of straps, then a dry stalk; blue dicks a bare stalk with a purple ball. Placed within
  45 m of the camera per 30 m cell (1.2 candidates per m², kept by the herb cover, the habitat, the verge and water,
  outcrops and the sward's bare patches) as a species from the cell's ground mix weighted by the month (gone when its
  height is 0), the cell's tree cover against the species' shade, and a patch noise of its own; density LOD by rank
  from 18 m to a quarter; a dithered fade at 36-45 m. No shadows from them.
- **The ground mix in the tile build**: `species_mix.json` rows carry `ground_bytes` beside the tree and shrub bytes
  (`species.ground`), each community's grasses and forbs from the records' own `habitat` blocks (class weight x
  density, then the record's floor / mid / steep / north factors as its terrain row; GROUND_RULES for the meadow and
  the ruderal rows), so a new grass or herb needs only its record. 465 rows on the home tile (424 before).
  `tilepackage.js` reads them as `row.ground`; cells without a row take the records' class weights.
- **The animals**: `pipeline/games.py` reads every record's `relations` and writes `games.json` `relations.forage`
  ([animal, plant, part, resource, seasons]; 187 on the home tile) and `relations.cover`, and each gather game's
  `plants`; a shrub's leaves and flowers count as browse, a grass's and herb's as grass_forbs. `needs.js` names the
  plant under a feeding body when "food here" is one of its foods this season ("blue dicks here: hold E", "hairy
  vetch here", "blue wildrye here"): the nearest herb within 1.5 m, else a food shrub of the near set within 3 m, else
  the leading grass of the sward there; a named plant feeds a quarter faster. The field guide (`identify.js`) picks a
  herb under the cursor and, where the ray meets bare sward, the grass there (the card lists the rest of the sward),
  and every plant card now has "eaten by" (this season, with the part) and "shelter for" lines from its record; a
  grass or herb card says annual or perennial and native or introduced instead of the architecture line. The HUD's
  species counts include the herbs within 30 m.

Verified on the worktree (port 8785) as a deer with the date set to 18 April: a grassland with lupine, popcorn flower,
poppies and blue dicks among the sward and "blue dicks here: hold E"; a click on one opens the blue dicks card with
its eaters; a dry-mesic chaparral slope seen from 9 m with buckbrush in white flower among chamise and manzanita and
soap plant rosettes between (16 impostor kinds drawn, 8,942 instances; 3D buckbrush, common manzanita, mountain
mahogany and monkeyflower within 40 m); an oak understory with miner's lettuce in the shade, poison oak and
snowberry impostors, blue wildrye tussocks and "soap plant here"; as a vole the body ring draws 2,903 clumps of all seven
species; no shader errors; the licence audit passes. Frame rate, alternating with main's build at the same pose with
three worlds open on a contended machine: as a deer at the spawn 12.7 / 11.7 fps against 13.3 / 12.3 (26 more draw
calls, the nine shrub species' meshes), as a vole 14.0 / 10.0 against 11.7 / 6.7; the herbs on or off made no
measurable difference. Not verified: the summer and winter looks of the herbs (soap plant's dry stalk, the bare
months), a lineup measurement of the nine shrubs against their targets (buckbrush and mahogany read more open:
gaps 0.32 / 0.48 against 0.15 / 0.3), the far look of the new impostor kinds, and the fliers' view of any of it.

## 2026-10-29: every walker steps round a turn, and the controls read the locomotion table

Aaron: "did you do this for all animals, if not, can you". The deer (the skin path) and the fox, coyote, lion and
bear (the part rig) stepped round a turn since the morning; an Opus lane carried the principle to the nine other
walkers, each in its order's way (docs/movement.md): the rodents and the gray squirrel on the ground turn with the
bound at 0.35-0.5 of its slow length, the fore feet hopping round the hind feet (the fore legs' swing turned sideways
in aAnim2.z under a new rig constant turnFore, the hind legs' swing fading as the angle grows so the hind feet stay
planted), 1-3.5 Hz, the body lagging 0.1 s and at most 0.3 rad, nothing on a trunk or limb; the ground birds step in
place at 0.45-0.65 of the walk with the head leading by 0.15 rad per rad/s up to 0.35 (aAnim2.z under turnHead),
lag 0.12 s / 0.35 rad; the fence lizard turns by its C-bend (0.25 x the rate, capped at 0.8) with the sprawl gait at
0.3-0.45 and 1.2-4 Hz, no lag beyond the bend. The AI of all nine turns at a capped rate (3.5 rad/s, 8 fleeing for
the small bodies; 2.2 and 6 for the turkey; the lizard's turn on the spot takes |turn|/3.5 s), the travel scaled by
the heading error, the rate from the previous yaw driving the step; a jackrabbit's settling and look-back, a sentry
ground squirrel's look-round and a squirrel's heading after coming down a trunk step round instead of snapping, and
foraging quail step round between spots. Measured by the lane as the player: rabbit 3.5 rad/s at 3.57 Hz, swing 1.44,
lag 0.29; vole 4.0 at 3.44 Hz; squirrel 2.6 at 2.1 Hz; turkey 2.2 at 1.84 Hz, head 0.33; quail 4.0 at 3.51 Hz, head
0.35; lizard 4.0 at 3.29 Hz, bend 0.8; a pinned AI of each at 1.5 rad/s stepping; no shader errors. Checked on the
clean worktree: the rabbit 3.5 rad/s, amp 0.5, 3.33 Hz, swing 1.44, lag 0.23; the quail 4 rad/s, amp 0.65, 3.5 Hz,
head 0.35, lag 0.35, 34.7 fps. Not driven: a walk on a curve, the flush hand-off. And the locomotion hook
(groundControl.js): the species' entry is the hand-tuned table filled from the tile's locomotion table (cruise, sprint,
recover), or a whole entry derived from the taxon and the body when the table has none, so a new species walks from
its taxonomy alone once it has a mesh (the turkey's derived entry: walk 1.64, cruise 6.0, top 9.3 m/s, sprint 5.9 s;
the tuned one: 0.7, 3.8, 6, 4). Open: the part rig's spine bend; the AI's gaits from the Froude bands.
## 2026-10-29: the water system. Every creek and pond built as one thing, with its bed, banks and riparian plants

Aaron: "work on the riparian habitat - make sure there are plenty of riparian plant species, and that banks have a
transition 'down' into the body - the bottoms of waterways should also have lots of rocks when the waterway dries.
There should be a pass in the pipeline to build all the waterways/water bodies and riparian systems. If there are
missing important riparian species like willow or cattail have them generated. Water systems are first class citizens
like animals - they should be very well made as every species will have to utilize them."

Until now a creek was a ribbon draped on the ground at the ground's own height (the 5 m DEM is flattened at the water
surface), so an animal met a flat shore with water painted on it; the riparian trees were a 12 m thinning band and two
bank species; nothing grew in the water. Now:

- **A pipeline pass, `water`** (`pipeline/water.py`, after `rewild_hydro`, re-runnable alone; docs/tile-spec.md "Water
  and riparian"). Every drawn reach is sampled every 2.5 m with its level (the DEM along it, non-increasing downstream,
  smoothed), the thalweg depth and riffle index from the profile, and a wandering water half width; every 5 m cell
  (and, on a lidar tile, every 2 m cell) within reach is carved to the cross-section: the bed a parabola D deep under
  the level, the wet margin rising hm over m metres, both by stream order. The banks and terraces are zones over the
  real ground: a first run also cut a template bank (0.75-2.15 m high over 1.6-5 m) and it cut the lidar's real banks
  back into a gentler, wider trough on every incised channel, so it was dropped; cells are only ever lowered, by at
  most 2 m. Kept ponds get a basin (0.6-2.4 m deep by area, the shallows under 0.45 m the margin and drawdown mud), a
  shore band and a terrace. The bed material follows the slope, the riffle index and the order (boulders on the
  cascades, cobble on riffles and the big creeks, gravel on the runs, sand and silt in the pools, bars inside the
  bends). All of it is one RGB raster for the client, `client/water.png` (zone, order and permanence; material;
  the water level to 2 cm against the heights), plus the half width in `client/water_width.png`, plus the banked DEM,
  the client's heights and the 2 m detail rebuilt from it. Rejected: writing the level into the ribbons' geometry at
  build time in the client (it is a property of the reach, every layer needs it), and a fourth PNG channel for the
  width (the browser's canvas premultiplies colour by alpha on decode and the zone bits came back garbled).
- **Twenty-one riparian records** (docs/species-library.md "The water's plants"): red, Pacific and sandbar willow,
  California sycamore (a new `mottled` bark), buttonbush, creek dogwood, blackberry, wild grape, spicebush, cattail,
  tule, bulrush, two sedges, a rush, horsetail, mugwort, nettle, seep monkeyflower, watercress and duckweed, plus
  `habitat.riparian` (zones, orders, permanence, water) and `relations.shades_water` on the sixteen riparian records
  the library had. A new form, `emergent`, for the tall wetland monocots.
- **The zone mixes** (`species_mix.py` riparian_rows): one row per zone x order class x permanence from the records'
  blocks, like the ground layer, written into species_mix.json. Rejected: hand-weighting the zones per LANDFIRE rule
  (a creek runs through every community; the zone is the habitat).
- **The client**: `tilepackage.js` WaterGrid and SpeciesMix.ripRow; `water.js` draws the streams at the level across
  the carved width (so the ribbon lies on a surface, the bed below it the terrain), the dry bed coloured by material,
  the ponds at the grid's level; `rocks.js` lays the beds' stones by material (gravel scatters, cobbles with a
  water-worn boulder, boulder cascades, the bars twice as dense; darker than the bank stones so they read on the
  pale sand), bare when a reach dries and under the water when it runs; `terrain.js` tints the wet margins and the
  ponds' mud; the plant layers take a zone's species from its row (vegetation.js zoneSpecies and the extra gallery
  trees, also in impostors.js and crowns.js so a lidar crown on a bank is a willow, alder, cottonwood or sycamore;
  shrubfield.js; forbs.js with duckweed floating on the pond's level); `emergents.js`, new, draws the cattails, tules,
  sedges, rushes and horsetail in the beds, margins and shallows out to 120 m; grass thins to a fifth on a dry bed and
  to nothing on the mud. The animals' water is unchanged in form: groundControl's footing reads the ribbon's height
  and depthAt(), which now agree with the carved bed, so a wading deer stands on the bed under 0.34 m of Weber Creek.

Verified on the worktree (port 8786, the pass run on the home tile: 377 reaches, 70,235 samples, 42 ha of channel bed,
91 ha of margin, 124 ha of bank, 227 ha of terrace, 19 pond basins, 16,476 cells lowered by 0.48 m on average, 2 m at
most; 48 zone rows; the licence audit passes): as a deer in Weber Creek (order 5, perennial) the water stands at
450.44 m over a bed at 450.09 (depth 0.34, "at water: hold E"), tules in the channel and the banks rising either side;
on Mound Springs Creek (order 3, intermittent) the bed is dry gravel and cobble in late October and runs 0.10 m deep in
January; a sycamore with its mottled bark on the bank; from the raven the creek winds through its gallery. Frame rate
at the same pose and date, alternating with main's build: as a deer at Weber Creek 11.7 / 11.3 fps against 11.3 / 11.3
(40 more draw calls: the new species' meshes, the emergents, the bed boulders). Not verified: the ponds' drawdown ring
and basin in the client (the browser pane went off screen before those shots, and a hidden pane runs no frames), the
raven's frame rate, the emergents' and bed stones' far look, the willows' and cattails' look against references, and
any tile but the home tile (the pass is additive and the other tiles need `--steps water`).

## 2026-10-29: the re-centred Yosemite tile, and a tile at any whole-kilometre origin

Aaron: "Is stitching tiles together that are adjacent possible? ... Yosemite valley is not in the center of the tile - it
goes off the tile in two directions", then "build a re-centred Yosemite tile with the valley in the middle". The
pipeline's tile id was always any whole kilometre of easting and northing (config.py Tile.from_id), not only the
10 km grid, so a tile can sit anywhere; nothing in the client cared. The valley's landmarks in UTM 11N (Pohono
bridge 265.0 E, Bridalveil 266.7, El Capitan meadow 267.8, Yosemite Falls 271.2, the village 271.5, Glacier Point
273.2, Mirror Lake 275.2, Half Dome 276.8; north 4177.7 to 4182.0 km) span 11.8 km east to west, more than a tile,
so the origin is 267 E, 4175 N: the valley centred north to south (4180 at the tile's middle) and running from El
Capitan meadow to Half Dome, Bridalveil 300 m off the west edge. `utm11n_267_4175` built end to end in 45 min (the
DEM from the Planetary Computer seamless fallback, the USGS ImageServer answering 502; Overpass took 17 min of
retries for the rewilded hydrology; the Sentinel months 10 min), with two failures fixed and re-run: the species
step (my locomotion hook used tile.id for tile_id) and the lidar step, which read one 1 m DEM product at the tile's
window and got a zero-width window because the 1 m products are 10 km cells on the grid and a tile off the grid
straddles up to four. lidar.py build_dem_1m now lists the cells a tile covers (dem_cells), pastes each product's
overlap into the tile's 1 m grid, and when a cell's newest product covers none of the overlap (the 2020 Southern
Sierra edge product over the south-west cell: 10 MB, 0 %) falls back to the next collection (the 2019 Yosemite NP
products, about 280 MB each); the manifest records the projects used. The 1 m mosaic against the 10 m fallback DEM:
every quadrant valid, residual std 7 to 25 m on the cliffs (the first Yosemite tile had 1.1 m against the 1/3
arc-second ImageServer DEM: the fallback is coarser, the detail is clipped at +-5 m as before). The water pass ran
on it (363 reaches). What it lacks, as the first Yosemite tile: a point cloud, so no canopy height, crowns or
inpaint. In the viewer: Yosemite Falls and the north wall from the arrival at the tile's centre, the mini-map reading
Sentinel Drive.

Stitching, answered: possible and laid out for (the shared UTM grid, the same seamless DEM, deterministic seeding);
it needs a shared world origin, packages loaded with offsets, the edge rows joined, roads and streams continued,
ranges that cross, and the map and games reconciled; the costs are memory (double for a pair) and colour seams
between NAIP flights. A bigger tile is one constant (TILE_SIZE_M) at the same memory cost per area. The re-centred
tile is the cheap answer for one valley; stitching is the long one.

## 2026-10-30: the catch rigged (branch claude/catch-rigging-4301f4)

Aaron asked for a bit of reading on how each hunter actually catches its prey, then the rigging: the moment of the kill
as a bodily act for the AI animals and the player's body alike, and the prey's death, rather than a distance check
that snaps a deer onto its side. docs/movement.md "The catch" has the reading and its sources; this entry is the
decisions, one per step, each verified by eye in the worktree viewer (port 8784) from a browser harness
(scratch/catch_harness.js: it teleports the spirit to a lion and a deer herd, makes the prey blind to the hunter,
sets `__weCarrion.lionCatch = 1`, starts the hunt and records a montage from a camera that follows the prey).

**1. The prey's death.** `kill()` no longer sets the rest pose and `lieStill()` no longer snaps the roll: a killed
animal falls over `CARRION.fall` (0.4 s). The roll onto its side and the small drop follow u^2 (gravity: slow to
start, hard at the ground), the gait's amplitude slackens linearly to nothing, the pose goes from the one it died in
to its rest (`REST_POSE`: 1 for the rest, the lizard flat at -0.95), the pitch it ran with levels. The deer's bed clip
is picked from the first frame (pose 1 at once) and blended in at 0.35 of its usual second (`makeClipState().quick`,
read by driveClips' blend time), so the legs fold under it as it rolls. A body that died on a rock stays on the rock
(`yDead`): the first dead lizard sank into its rock. The lizard is KILLABLE (solitary, no member list to unwind; its
site and home are its own), with its own reach for the jay (0.6 m) beside the raven's; the fox's hunt lists it among
its prey (a lizard not hidden, not up a trunk, drawn), `fled` reads its sprint and hide. Verified: an AI lion from
12 m kills a deer at 2.1 s of its rush, the deer rolls over 0.45 s (amp 0.71, 0.19, 0 at 0.2 s steps) into the bed
clip; an AI fox trots at a lizard on its rock, pounces and the lizard rolls onto its side over 0.4 s, staying on the
rock. Still a distance check at this step: the lion stands by its kill, the fox's kill lands at the pounce's start.

**2. The cat's catch: the leap, the neck bite, the feeding crouch.** The reading (movement.md): a cougar closes in cover,
then an explosive series of bounds, launches onto the prey's back and hangs on while it bites the nape or throat; over
in seconds; then it feeds crouched over the kill. The AI lion's rush (M_RUSH) no longer kills at a distance: within
`HUNT.leapD` (3.2 m) of its prey the last bound is M_LEAP, a bound of 0.45 s and 0.55 m that homes on the prey each
frame and lands with the forequarters over its back (0.7 m short of the prey's centre); the gait is held at the
gallop's flight pose with the fore pair reaching (amp 1.25, the phase pinned at pi/2 and swept to 3pi/2 by the
landing, so the legs gather under it), the body pitches from nose-up at the launch to nose-down at the landing, and
the head is driven down (flick 1) into the neck over the last 40 %. The kill is rolled at the landing (within
CARRION.reach, lionCatch 0.35) and the lion goes to M_FEED for CARRION.feed s: pose at poseMax (the crouch), the head
low and working at it (flick 0.85 with a slow tug, the tail tip twitching), no longer a hunter to the prey
(refreshHunters); a miss is a twist away (`a.twist`: a roll pulse and the heading swung 1 rad over 0.4 s), then it
stands. The player's lion (groundControl.js CATCH.leap, S.catch 'leap'): a rush within 3.2 m of prey ahead
(animals.js preyNear, a cone of 0.8 rad) takes the controls for the leap (mode 'leap', leapStep), the same channels,
the catch at the landing (catchNear, certain for the player as the rush was), and then the feeding crouch (`feeding`)
until any key moves the body; E beside a kill crouches over it again. abilities.js: the lion's grey pounce became the
lit leap (lit while leaping) and its grey eat the feed (lit while feeding). Verified: the AI lion from 12 m rushes,
leaps at 3.2 m (1.95 s: lift 0.32, nose-up; 2.20 s: lift 0.41, nose-down), lands over the deer's hindquarters at
2.32 s with its head down, the deer rolls under it and the lion stays crouched over the carcass; the player's lion the
same from 9 m (the leap at 1.52 s, the kill at 1.84 s, feeding at pose 0.6 and flick 0.8-0.96).

**3. The canids' mousing pounce.** The reading: a coyote fixes a rodent by ear, the head cocked to each side, freezes
in a tense braced stance, springs high and drops on the prey hitting it with the front feet, the forelegs held
straight and braced for the jar; the first pounce often misses and three or four quick paw strikes follow, then it
digs it out with nose and paws and takes it in the jaws with a head toss; the gray fox is the same pounce at a
smaller scale. M_POUNCE was a lift and a pitch with the kill rolled at its start; now the AI canid within
HUNT.pounceD of its prey goes to M_FIX for 0.45-0.8 s (speed 0, the gait's amplitude damped out, a slight crouch, the
head up with the ears on it, and the whole body rolling 0.13 rad side to side at 1.1 Hz as the head cock: the plain
quadruped rig has no head roll), then springs (M_POUNCE: 0.5 m for the fox, 0.75 for the coyote, no leg swing so the
legs hang straight, nose-up at the launch to nose-down at the landing, the head down at the forepaws over the last
45 %) onto where the prey is at the launch, not homing: a prey that moves in the air is missed. At the landing the
kill within CARRION.reach (canidCatch 0.4) goes to M_TOSS (0.3 s, the head thrown up, flick -1.2) and then the nose
down at it (M_SNIFF, flick 1); a miss goes to M_PAW (0.75 s of 4 Hz paw strikes: the forequarters dropped 0.35 rad on
the spot with a 5 cm hop each, the head half down) and then the nose and paws at the spot (M_SNIFF). The random
mouse pounce from a sniff goes through the fix too. The player's fox and coyote (groundControl.js CATCH.pounce, S.catch
'pounce'): E within 2.6 m of prey ahead (a cone of 1 rad) takes the controls (mode 'pounce') through the fix, the
spring and the landing, where catchNear decides the kill (the toss, then the act's sniff with the nose down) or the
miss (the paw strikes, then the sniff); a run that reaches prey springs at once with no fix. abilities.js: the canids'
catch slot became the pounce (lit while pouncing). Verified: an AI fox from 3 m trots, fixes a rabbit for 0.6 s with
the body rocking, springs 0.49 m high and lands on it (the kill at 1.82 s), tosses its head and noses it; with the
catch chance at 0 the same spring lands 1.4 m from a rabbit that moved during the fix, three paw strikes follow and
the nose goes down; the player's fox from 2 m with E: the fix (roll -0.13, flick -0.3), the spring to 0.49 m, the
kill at 1.36 s, the toss (flick -1.2) and the sniff.

**4. The hawk's brake, grab and mantle.** The reading: a red-tail hunts from a perch or a stoop, folds the wings and
drops, extends the legs and feet forward at the last moment to grab, kills by the talons piercing, then mantles over
the kill, wings half spread and drooped round it, head down. The AI stoop (hkUpdate, now started by hkStoop) at prey
(a vole, ground squirrel, rabbit, jackrabbit or lizard: huntTarget's kinds) ends HUNT.hawkOver (0.35 m) over it
instead of 2.5 m, tracks the prey over the stoop's second half, and in its last HUNT.hawkBrake (0.4 s) brakes
(`a.brake` 1): the body pitched up to -0.45 rad, the wings thrown from the tuck (pose 0.75) to full spread (pose 0) at
rate 14, the hands un-drooped and the tail fanned (extra: e0 0, e1 1). At the end the kill within CARRION.reach[HK]
(hawkCatch 0.4) puts the hawk on the ground over it in H_MANTLE for 18-35 s (`a.brake` 2: pose 0.45, the wings half
swept and drooped round the kill by e0 1, the tail fanned 0.7, the head down and tearing at it, flick 0.85-1; no
hunter to the prey meanwhile), then it flaps up (H_PULL); a miss pulls up as before. The feet: tools/build_redtail.py
deletes the generated feet and the rig has no leg parts, so the feet coming forward is not drawn; a leg pair as
LEG_A/LEG_B parts in the builder is the next step for the hawk and is left for a later commit (a Blender rebuild,
with the same tooling the other builders use). The player's hawk (flierControl.js FLARE, FLARE_PITCH): flying at prey
within FLARE s of contact (animals.js preyNear with the heading, a cone of 0.7) the body is drawn pitched up 0.5 rad
over the flare while the wings and tail open (draw: pose 0, e0 0, e1 1); the strike within reach kills (catchNear, as
before) and the hawk is set down on its kill at once (flight.settleOn) and mantles there (`mantle`: pose 0.45, e0 1,
e1 0.7, the head down) until it hops, takes off or leaves the kill; landing beside a kill mantles too. Verified: the AI
hawk from 40 m off and 35 m up stoops at a jackrabbit, brakes at 0.4 s out (pitch -0.43, pose 0.01, the tail at 0.93),
kills at the end and mantles over it; the player's hawk on a dive at 20 m/s flares from 8 m out (the tail fanned to
0.91, the wings open) and takes the jackrabbit at 1.5 s, then mantles. The stoop's montage was taken in a dark spot
under the oaks; the mantle still reads (the hawk flat over the jackrabbit, wings out).

**5. The corvids' bill stab.** The reading: a raven kills small prey (voles, lizards, young rabbits, nestlings) with
a stabbing strike of the bill, repeated jabs at the head and chest until the prey is still, then plucks and opens it
with the bill; a scrub-jay dives down, grabs a lizard in the bill, pecks at it repeatedly and carries it off into
cover. The player's raven (flight.js peck, STAB_N and STAB_T; raven.js): E on the ground within reach of the bill
(animals.js preyNear, the raven's 0.9 m) of a lizard or vole gives three quick hard stabs (each a 0.2 s dip, drawn
deeper and faster than a peck: 2.3 against 1.7, the head's lerp at 32), the kill on the last (catchNear, the belly
filled, the toast); E beside a carcass (feedNear) the same stabs, fed once per carcass. abilities.js: the raven's grey
strike and feed are lit, each while its stabs run. The AI raven at carrion (rvUpdate R_PERCH on the ground with
`feedOn`, the carcass it glided down to) works it in bursts of three stabs at 4 Hz with pauses between, the head driven
down and up outright (the frame's slow flick decay would hold it down). The player's scrub-jay (flierControl.js): the
take on contact as before, then it is set down on the lizard at once and pecks three times (the ground peck at 0.3 s
each); carrying it off is not built. No AI corvid hunts yet (the ravens and jays have no hunt state), so the stab is
the player's and the feed the AI's. Verified: the player's raven's three stabs at 5 Hz with the kill of a lizard at
0.6 s; the summoned AI raven at a carcass stabbing in bursts (flick 1.15, 0.58, 1.15 over 0.25 s steps); the player's
jay taking a lizard on a dive, set down and pecking three times.

**6. The catch in the tree.** The catch is a family-level principle, so it lives in `library/animals/locomotion.json`
as a `catch` block per family: Felidae the leap and the neck bite (reach 2.4 m, from 3.2 m, 0.45 s, 0.55 m high,
landing 0.7 m short, 45 s crouched over the kill), Canidae the mousing pounce (reach 1.6, from 2.4, the fix 0.45-0.8 s,
0.55 s and 0.75 m high, the paw strikes at 4 Hz for 0.75 s, the toss 0.3 s), Accipitridae (a new family node under
Accipitriformes) the talon strike and the mantle (reach 1.4, the brake 0.4 s, 0.35 m over the prey, the mantle
18-35 s), Corvidae the bill stab (reach 0.9, three stabs of 0.2 s, the feed in 0.75 s bursts at 4 Hz), Ursidae the
swat (reach 1.8; not drawn yet), with species overrides for the fox (reach 1.3, 0.5 m high) and the jay (reach 0.6).
`pipeline/locomotion.py` passes the merged block through to `tiles/<id>/locomotion.json` (rebuilt for the home tile
and the re-centred Yosemite); `client/src/locomotion.js` gives `catchOf(code)` and sets a walker's `catch` move
(groundControl's CATCH key) in the derived entry and in `fill`; `animals.js buildHunts` reads the table into
`catchOf` and `reach` per species slot (CARRION.reach's hand-set values win, the table fills the rest), and the AI
picks the leap or the pounce by the family's move (a lion leaps because Felidae says so, with the species test as the
fallback), the kill reaches by `reach`. A hunter new to a tile gets its family's catch: a bobcat would leap, a kit fox
pounce, a Cooper's hawk strike and mantle, a crow stab. Verified on the home tile after the change: the AI lion's leap
and the AI fox's pounce as before, from the table. Not in the tree: the AI corvid hunt and the bear's swat (nothing
draws them yet); the kill sound was already in sound.js (the prey's last cry on the kill event), so the roadmap's
"no kill sound" was stale.

## 2026-10-30: the quadrupeds' legs: one skeleton, a gait engine that plants the feet, the far tier baked from it

Aaron: "the leg rigging for quadrupeds still needs work - how do we get a good result". The part rig drew a quadruped's
legs as two rigid boxes (the diagonal pairs) swinging about the shoulder and hip from sin(phase): no knee, no foot, the
feet sliding, a slope met by pitching the body, the gallop with no spine. The decision: no baked clips per species (a
hero clip set is the deer's privilege), but a skeleton every quadruped shares and an engine that poses it from what the
AI and the player already know, driven from the locomotion tree, so a new species on a new tile walks right from its
taxon and its body. `docs/movement.md` "The legs" has the principles by rank; in short:

- `tools/rig_quadruped.py` gives a built GLB (fox, coyote, cougar, bear) the standard 20-joint skeleton from its
  geometry alone: the elbow and stifle at the part pivots, the wrist and hock at a fraction of that height by posture,
  the shoulder and hip in the body, the toe at the paw's print, a vertex ring cut at each joint, weights by height with
  short blends; JOINTS_0 / WEIGHTS_0 and extras.skin as the deer's. The source Fox and Wolf GLBs are not on disk and the
  Meshy meshes never had a skeleton, so the same rigger serves all four (and any quadruped the build scripts emit).
  Free: no Meshy credits spent.
- `client/src/gait.js`: per instance on the CPU each frame, the gait by the Froude bands of the row (walk, trot or the
  bear's pace, a transverse or rotary gallop), Hildebrand's footfalls, the duty factor falling with speed, the cadence
  and stride from `stride_hz` and `stride_m`; each foot held where it landed, lifted at the duty phase and swung to a
  plant point predicted half a stance ahead of its hip at touchdown on the terrain; two-bone IK per leg with the foot
  on its toe (digitigrade) or flat (plantigrade), the shoulder sliding with the foot; the hips and chest over the
  ground under their feet (a slope met by the legs), the bob, the roll, the gallop's spine flex, the head level and
  leading, the tail lagging; the standing turn as real steps; a crouch and a folded bed from pose. Pure arithmetic, no
  three.js, so node runs it too.
- The output is a live pose texture per species (one row per near instance, RGBA32F) read by a `SKIN_LIVE` branch of the
  skin shader when `aClip.x` is negative: no new vertex attribute. The far tier is the same engine baked once per gait
  (`tools/bake_gait.mjs`: Idle, Walk, Trot, Gallop, Bed in `tools/bake_clips.py`'s format) and driven by distance, so
  the far tier is the deer's shader with a clip.
- Verified on the lineup page (the engine walks the body along the row with the camera following, `&feet=1` marks the
  plant points): the coyote's walk with the pole fixed and the planted feet staying put while the body passes, the
  trot in diagonal pairs, the gallop with its gathered and stretched phases, the standing turn, the bed and the sniff;
  the fox, lion and bear at a walk, the lion's gallop and bed. Not yet: in the world (the AI and the player), slopes.

What it costs: four GLBs 40-55 % bigger (the cut rings and the skin), 17-29 KB of clips each, ~10 µs per live instance a
frame (the mammals' caps are 16, 8, 3 and 3).

Step two, the same day: the AI (`animals.js`, a LegsPool per legged species in `legs.js`) and the player
(`groundControl.js`, a LegsBody) on the engine in the world, verified as the player's coyote from a side camera on the
flat and up an 18-degree slope, in a standing turn and at a gallop, and on AI foxes near and far. One correction on
the way: the first build gave the live poses a texture of their own, and three.js warned of a seventeenth texture unit
(the atmosphere's samplers and the bone texture already fill the sixteen), so the live rows moved into the species'
clip texture (32 rows after the baked frames, read by the shader's existing `skinFrame`); the clip textures of the
legged species are RGBA32F for it (the deer's stays half floats). Touch points for the merge with the catch lane:
`animals.js` the import, the constructor's `_legInp` and `feetMarks`, `buildTiers` (the pool), the per-animal write
block (`LG`, `legRow`, the level matrix, the engine call) and the `end()` loop after it; `groundControl.js` the
import, `meshFor` (LegsBody), `useSpecies` (reset), the stalk's pose line, `draw` (the level matrix, the engine
instead of driveClips for a legs body, the turn table); `animalModels.js` the skin shader's SKIN_LIVE branch, `skinDecl`,
`loadClips` / `loadTiers` / `restOnlySkin` (the live rows, `model.legs`, `model.live`), the four loaders.

## 2026-11-01: a tree's base perpendicular to the slope (branch claude/gracious-swartz-132b77)

Aaron: "The base of a tree should always be perpendicular to the surface it is on, and the rest of the trunk should bend
to go on its normal path from there."

**Decided: a per-instance attribute, not baked slope classes.** Every near-trunk instance carries `slopeN`, two floats:
the x and z of the ground's unit normal at the plant's foot (vegetation.js `groundLean`, central differences of the 1 m
heightfield a metre either side, filled with the matrices in `place`, `placeCrowns` and `refreshNear`; the mid set keeps
a plain array). The slope varies tree by tree and two floats an instance cost nothing; a set of baked classes would have
meant a mesh per class per species per seed. The attribute is read by the near trunk's vertex shader (treegen.js
`trunkFlex`, with the wind flex) and by nothing else: the instance matrices stay upright, so what reads them (perch.js,
the squirrel, the near-plant list, the close copies, the acorn stash holes) is unchanged, and the crown, limbs and twigs
stand where they stood.

**The bend.** The collar is moved uphill along the surface to where a trunk leaving the ground along the normal and
curving back to vertical over `SLOPE_BEND_M` (1.8 m) would have it (half the bend's height times the sine of the tilt:
0.64 m on a 45-degree slope, 0.16 m on 10), and the first 1.8 m of the trunk follow a cubic Hermite from that collar
(tangent the normal) to the axis (tangent vertical), each cross-section turned with the tangent. The first formulation,
a rotation about the root fading with height, was wrong: it moves the collar nowhere (a rotation about a point moves
nothing at the point) and gave a 0.3 m S-curve on a 45-degree slope that read as nothing. Pinning the collar at the
placed foot and shifting the whole tree downhill instead would have needed the same shift in every canopy, twig and
leaf shader (the cards would float 0.6 m off their limbs); pinning the axis and moving the collar uphill keeps the bend
in one shader. Not bent: the mid trunks (past 180 m, a pixel wide, no bark), the far impostors, the lineup page (not
instanced). A tree on the flat is unchanged (the shader skips at under 0.6 degrees of tilt).

**Verified** on the home tile, the page rendering its own camera and posting the frames to a scratch receiver (the pane
gives no frames while hidden): a 9.5 m blue oak on a 45-degree slope at (4547, 5300) and a 10 m interior live oak on 50
degrees at (4746, 4575), from a walker's eye across the slope at 7 m, from downhill at 8 m, at the collar from 3.5 m
and from the air 40 m up. At the collar the trunk leaves the hillside perpendicular to the surface with the collar
uphill of the axis and curves to vertical within two metres; from across the slope the foot of the trunk shows the
curve; from the air nothing changes. No shader or console errors. Not verified: the near-to-mid hand-over at 180 m (the
mid trunk is straight; at that distance the collar's 0.6 m is under a pixel), the squirrel climbing the bent base (it
climbs the matrices' straight axis, 0.6 m off the drawn wood at the collar on the steepest slopes), the frame cost (one
vec2 attribute and a few dozen vertex operations on the near trunks; not measured).

## 2026-11-01: trees grow their age, built (branch claude/gracious-swartz-132b77)

Step 1 of `docs/tree-architecture.md`, with the valley oak's parts of steps 2 and 3: `tools/grow_species.mjs` grows a
species through its life by its limb mechanics from a `growth` block in its record and writes the generator's age
classes; valley oak first, blue oak the counter-case, ponderosa the conifer control.

**The loop as built** (node, no three.js; 10-35 k segments over 200 years in 8-14 s). A skeleton of yearly growth units,
each with a rest orientation relative to its parent (a quaternion) and an elastic bend. Each year: the leader extends by
the species' height curve and the laterals by what the crown lacks of the species' crown width for the age (never less
than a mature shoot's 0.15 m), new units steering toward their gravitropic setpoint by Bastien's fraction; each unit
bears the model's flush of laterals at the insertion angle for the next order (Rauh: spiralled; the pine's in whorls of
five); a tip's light falls with its depth inside the crown's own surface and a shaded tip dies; thickening by the pipe
rule from the measured dbh for the age; the sag from the mass beyond each joint (wood by green density, a leaf load per
tip from the Urban Tree Database's leaf area) over E I, two relaxation passes; shape memory by the new ring's share of
the stiffness; reaction wood toward the setpoint by at most 4 dmu dr l / r^2 over the share of the ring that is reaction
wood. Apical control (lambda 0.54 to 0.46, decaying over 40 years for broadleaves, held for conifers) fades the leader's
share and lets any steep tip at the crown's top grow for height (reiteration), and steepens the finer orders' setpoints
toward vertical. The constants and their sources are in the tool's header.

**What the sources gave** (each value's source and date sit beside it in the records). Valley oak: height, dbh and
crown width by age fitted to the Urban Tree Database's 49 aged Sacramento trees (9.4 m at 10 y, 16.6 at 30, 20.6 at 80,
21 at 200; dbh 18, 42, 81, 130 cm; crown 6.3, 12.6, 18.7, 21 m), its leaf-area equation, Bechtold's crown width as a
check, dry density 550 from Pillsbury, white oak's green modulus 8.6 GPa standing in. Blue oak: Silvics' diameters by
age (23 cm at 40 y, 57 at 125) turned into heights through Tallo's foothill fit (H = 1.30 dbh^0.525), Bechtold's crown
width times 1.15 open-grown, Karlik and McKay's 310 g dry leaf per m2 of crown. Ponderosa: Silvics' site curves read by
eye (12 m at 25 y, 35 at 110, 42 at 300), Tallo's California fit for the dbh, Bechtold times 1.2, the Handbook's 6.9 GPa
and 0.38 specific gravity. Not given anywhere: the insertion angles and setpoints (defaults by model and leaf type),
the moduli of the California oaks, a leaf mass per area for valley oak, how fast apical control fades.

**What the build found.** (1) At the Handbook's modulus over a creep factor of 2 (4.3 GPa) the loop's limbs stay level
to 200 years: a thick limb's base sags a tenth of a degree a century and its middle is held by reaction wood. The sag
that matches the photographs needs the limbs' effective modulus at 2.8 GPa (branch wood is juvenile wood with knots at
50-70 % of the clear-specimen value, under decades of creep; MAppleT fitted 1.1 GPa for apple limbs), with the trunk
stiffened 3 x because the loop has no eccentric growth or whole-tree righting and a soft trunk bends over under its
crown. This is the one number tuned to the photographs; at 2.5 the sag is heavy by 80 years, at 3.2 the veteran's
limbs barely dip. (2) Three light models were tried: Palubicki's shadow propagation killed every tip a layer below the
surface (it rations buds, it does not say which die); Beer's law down columns let a limb's own rising laterals shade
its tip to death; depth inside the crown's own surface (top and underside counted as surfaces, so an open-grown tree is
lit from below; a radius per height band and azimuth sector, because one radius per band let whichever side reached out
first shade the other into a flag-shaped crown with the trunk leaning away) keeps a shell of live shoots and sheds the inside. (3) Lateral extension tied to the leader's dies when
the height curve saturates, so the crown width by age drives it; a shoot past the species' reach idles and well past it
dies back. (4) The reaction-wood share of the ring by MAppleT's formula on the lean (0.164 (1 - cos)) gives steep young
limbs almost no righting and they sag in their first decade; half the sine of the angle off the setpoint keeps them.
(5) Epicormic sprouting (0.8 a year for oaks) against a live-tip cap churned the crown apart; it is off until the cap is
a light budget. (6) The tip cap must spare the leader (it died on a light tie at year 19) and the edge rule must spare
it too (the pine's leaned 2 m and was cut).

**The grown trees** (the tool's own measures from the final run; the lineup captures and the SVGs in the report).
Valley oak: 9.3 m at 10 y, crown 0.73 of the height, limbs rising 32 degrees at the base with the shoot ends drooping
to -20; 16.5 m at 30 y, crown 0.79 x, scaffolds leaving 10 degrees up, level at mid-limb, the ends rising 34; 22 m at
80 y, dbh 81 cm, crown 0.96 x, scaffolds leaving 12 degrees up, dipping 4 below at mid-limb, the ends turned up 31 (the
J, mild); 22.4 m at 200 y, dbh 129, crown 1.18 x, limbs leaving 3 degrees up, sagging to 9 below, the ends 10 up, the
lowest wood 1.2 m off the ground. The trunk dissolves from the whole height at 30 y to 0.8 of it at 80 and 200 (the fit
reads the trunk as ending where its radius falls to 40 % of the breast-height radius). An earlier run of the same
inputs (before the light model got its azimuth sectors) gave a heavier sag, 17/-30/37 at 80 y and 9/-21/0 at 200: the
sag depends on which limbs live, so run to run it moves by 10-20 degrees. Blue oak: 2.6, 5.4, 10.8, 14.4 m; crown
1.2-1.6 x the height; the limbs at 30-44 degrees up at 10 and 30 y, level with rising ends at 80 (5/0/29), and at 200 y
three huge scaffolds that sag to 39 degrees below horizontal at mid-limb (-3/-39/-6): the counter-case holds to 80 years
and fails at 200, where the crown rests on three limbs each as long as the trunk and the fit's level-1 numbers rest on
them. Ponderosa: 11.4, 34.8, 43.5 m with the leader to the top at every age; the whorls level (-13/-20/-6 degrees at
25 y, -5/-2/5 at 110, 2/2/10 at 300); crown 0.45, 0.36, 0.42 of the height; the lowest live whorl at 0.16 H at 25 y, 0.11
at 110 (the clear bole the photographs show, 0.4-0.6, does not form: the open-grown light rule keeps the low whorls lit
from below), 0.8 H at 300 (flat-topped).

**Against the lidar crowns of the home tile** (395,356 crowns, all species, mostly stand-grown): crown width over
height by height class, medians 1.05 at 4-8 m, 0.82 at 8-12, 0.76 at 12-16, 0.72 at 16-20, 0.63 at 20-24, 0.53 at 24-28,
0.46 at 28-32, 0.38 at 32-36, 0.33 at 36-40, 0.30 at 40-44. The grown pine (0.45, 0.29, 0.42 at 11, 35, 43 m) sits in
the lidar's range for tall trees; the grown oaks (0.8-1.5) sit at or above the lidar's 95th percentile for their heights
(1.52 at 4-8 m, 1.01 at 12-16, 0.89 at 20-24), as open-grown trees should against a list that is mostly closed stands
with segmented crowns.

**What still reads wrong.** The sapling valley oak's shoot ends droop (the record's note wants an upright crown); the
200-year valley oak's sag is milder than the photographs' limbs-to-the-grass (3/-9/10 against a mid-limb well below
horizontal), and its crown is 1.18 x the height against the open-grown photographs' 1.3-1.8 (the Urban Tree Database's
curve, 1.14 at 220 y, is what it follows); the blue oak weeps at 200 years on three scaffolds (it should not: its old
crown needs the reiteration of order-2 sub-crowns the loop does not give it, and a stiffer or shorter limb), so its
veteran class carries a droop of 36 and an upturn of 33 that the photographs contradict; the pine's pole and mature trees keep whorls to near the ground where the photographs show a clear bole of 0.4-0.6 of the height (the open-grown light rule); the fit's
envelope profile is the 92nd-percentile radius by band and jumps where a band is sparse; the envelope-depth light model
has no neighbours, so every tree is open-grown. Not verified: the trees in the world (only the lineup page), winter, the
mid and close tiers, the frame cost (the classes are the same parameter sets, so none expected).

**Step 2 will need**, per species: a height curve by age (Silvics or the Urban Tree Database; else Tallo's height on
Silvics' diameters), a dbh curve, a crown-width source (Bechtold's 53 western species cover most of the library's trees;
an open-grown factor where the photographs show wider), a leaf load (the Urban Tree Database's leaf-area equations where
the species is in it, else a leaf mass per crown area), the Handbook's modulus for the genus, shade tolerance from
Silvics or FEIS, and the class ages. The defaults by model and leaf type carry the rest. A pipeline script can fill the
curves from Tallo and Bechtold by scientific name; Silvics and the Handbook are prose and tables to read.

## 2026-11-01: white water that reads as water in motion (branch claude/water-whitewater-dc7695)

Aaron: "I see there is white water, but it ends up looking like a misty haze." He asked for the research on how to get
the water flowing right, then a lane to do it.

**The diagnosis, checked in the code and the viewer.** In water.js the white water was one term, `froth`: a scrolling
value-noise threshold where the riffle index was high, mixed 50 % into the water's body colour and only within the
`coarse` distance: low in contrast, half transparent, shapeless, unrelated to rocks, drops or banks, so it read as a
pale mist lying on the surface (the before captures: a Weber Creek riffle from a deer's eye is a grey-blue sheet with
faint lighter streaks; the Hangtown Creek cascade from 6 m up is a translucent pale wash over the bed). In waterfall.js
the curtain dissolved into "mist" over its lower part, the plunge was one soft radial billboard, and the run-out fell
off over 10-30 m: three soft translucent things with no opaque white boil and no structure. Also found: the ripples and
the froth scrolled by `uTime * speed` with the speed varying across the surface (riffles run 1.6 times faster than
pools), so the pattern sheared without bound over the minutes of a session.

**The reading** (kept short so the next person knows what came from where):
- Vlachos, "Water Flow in Portal 2" (SIGGRAPH 2010 Advances course): the two-phase flow-map trick, two samples of the
  texture offset by half a cycle of the scroll and blended by a triangle wave, so an advected texture never stretches
  or snaps where the flow varies. Taken whole, for the ripples and the foam; the blend is renormalised so the coverage
  does not pulse with the phase.
- Yu, Neyret, Bruneton and Holzschuch, "Scalable real-time animation of rivers" (Eurographics 2009) and Proland's river
  plugin: detail that rides a steady flow field (wave sprites advected along it). Taken as the principle that the flow
  is steady, so nothing needs simulating: the foam's sources and sinks can be walked once and baked.
- Malan, "Rendering Water in Horizon Forbidden West" (SIGGRAPH 2022 Advances; read as the slides, which carry it):
  the rivers get localised 2D effects (standing waves round rocks, eddies, ripples) instanced where they belong, and
  every waterfall impact is a broad opaque region of churning foam, not a cloud (the with-and-without pair of slides 38
  and 39 is the whole argument); foam carried in vertex colour cannot make features smaller than a triangle, so the
  fine structure must come from the shader (slide 41). Taken: the boil as an opaque disc, the foam's structure in the
  fragment shader with only its coverage per vertex.
- Reference photographs (Wikimedia Commons: the South Fork American at Coloma, Lava North rapid, a creek riffle, Yosemite
  Falls in May and in October, the base of the Lower Fall): foam is bright and nearly opaque where it exists, in lace
  and streaks drawn out along the flow with sharp edges over dark water; a cascade is white streaks and rafts over dark
  water between the boulders, never a flat white sheet; each boulder has a pillow of broken water upstream and a tail
  of foam downstream; the May plume is a broad sheet with a spray cloud tens of metres across at the foot, the October
  fall a thread with a small boil.

**What was built.**
- **The foam itself** (`FOAM_GLSL`, in waterfall.js so both water shaders share it): a lace of value noise stretched
  along the flow (a streaky octave and a ridged finer one, the bubble lines), advected in two phases at the water's
  speed, cut by a sharp threshold set by the coverage (`foamCut`: full coverage still leaves gaps, a cascade is never a
  flat white sheet), nearly opaque where it is, lit as a white scattering surface (the sun by the broken surface's
  normal, never dark on the side turned away, the sky all round) with its own tone from the field. Far off it collapses
  to its mean, a pale patch, never to nothing (the old froth vanished past the `coarse` distance). `FOAM_TUNE` /
  the `foamTune` uniform (coverage scale, the threshold and its fall, the brightness) can be dialled live from the
  console; the baked values came from captures at the deer's eye and the raven's height at three settings each.
- **Sources and sinks, walked once** (water.js `walkFoam`): every run is walked every 2.5 m on the 1 m ground, the
  profile made non-increasing downstream as waterfall.js does, the slope taken over +-5 m; foam is made at a rate
  rising from a 3 % slope to full at 15 % and decays downstream over 6 + 2.5 x order metres, so it trails from every
  drop in streaks and rafts; a section's coverage is the most foam within 5 m of it, its roughness the steepest slope
  there. Both go into the water ribbon's vertices (`aFoam`). In the shader the coverage is made patchy along the reach
  (the profile's riffle index and a slow pattern fixed to the bed: white where the water breaks over the drops, dark in
  the pools between) and the riffles add their own crests. Rejected: a 1-D texture per reach (a new texture unit for
  what four floats a vertex carry).
- **The broken surface**: on a rough stretch the ripple amplitude grows up to 2.6 times, a field of standing waves fixed
  in flow coordinates (haystacks, only breathing in time) is added to the normal, and the glint lobe widens four times,
  so the glint pattern breaks with the surface.
- **Emergent rocks and their wakes**: where the bed material is boulder on a stretch at least 4 % steep (order 2+, half
  width 0.8 m+), a rock every 1.8 x the run's median half width (at least 5 m) of arc at a hashed place across the
  channel, its radius 0.3-1.2 m. The water shader draws each one's wake from its arc length and offset (`rHash`, an
  integer hash shared bit for bit with JS `rockHash`, so the wake is drawn exactly where the rock is): a pillow of
  broken water upstream, a foam tail downstream that opens into a V and lingers in the eddy, the ripples bent round it,
  windowed out smoothly before the shader's cell range ends. rocks.js `riverRocks` places a boulder at each (its top
  clear of the water by the depth there plus 0.3 m plus half its radius, rounder and lower than a bank boulder; own
  random stream, the same draws in 'full' and 'count'), through water.js's exported `emergentRocksIn`. Per vertex the
  run's rock spacing and seed, the stretch's arc range and the previous stretch's (`aRock`), with a section repeated
  at every change of stretch so the ranges never interpolate between two stretches and a wake runs on past the seam.
  823 rocks on the home tile. Rejected: wakes for rocks.js's own random bed boulders (the water would have to know
  their places; the walk owns the rocks instead and rocks.js draws them).
- **The falls** (waterfall.js): the boil, a disc of opaque churning white water on the stream at the plunge (kind 3:
  radius 0.9 x the plume's width plus 3 % of the drop, 2-14 m, pushed downstream by half its radius, its rim pushed out
  by the season's flow, never clear at its centre, lace toward a ragged rim); the run-out as foam rafts and streaks cut
  from the same lace and riding the current over 12 + 0.25 x drop + 2 x width metres (at most 50), thinning
  downstream; the mist as three small ragged sprites about the foot that drift up and sway, thin and local, with one
  wide faint cloud behind them only on a fall over 40 m; the curtain kept, its lower part breaking into clumps of
  spray that stay strands instead of dissolving into a haze. Still one merged geometry and one draw call.
- **The two-phase scroll** for the ripples too, so a reach's glint pattern no longer shears over a session.

**Verified** (before and after at the same frozen poses from the same own camera, canvas captures posted to a scratch
server because the browser pane gives no frames while hidden; scratch/whitewater_harness.js, whitewater_poses.js,
whitewater_poses_yos.js): the Weber Creek riffle from a raven's height (30 m) reads as white water running down the
channel in streaks; from a deer's eye on the right bank the foam is a lace with sharp edges over dark water between the
boulders, lit from the sun's side, and a capture 0.7 s later in the water's time shows it moved; the Hangtown Creek
cascade from 14 m and its biggest emergent rock from 6 m up: the pillow upstream, the V and the tail downstream of the
rock, the foam streaks trailing from the drops into the pool below; Yosemite Falls on 15 May: the upper fall's foot a
white boil with the run-out below it from 200 m, the Lower Fall's boil and run-out from 110 m and its run-out from the
stream 55 m below the plunge; on 15 October the upper fall a thread with a small boil (the lower fall's reach is
intermittent and dry, as before). No shader errors (`__ww.check()` reads every water program's log; a reserved word,
`patch`, cost an hour) and no new console errors. Frame cost: the browser pane gives no frames while hidden, so the frame was timed as 40 renders each followed by a 1 x 1 readPixels (which waits for the GPU; gl.finish on ANGLE/Metal does not), with the water drawn and with it hidden, at the raven's and the deer's poses on both builds: the whole frame 27-35 ms on both (the pane's canvas at 1920 x 1200 here against 1536 x 1152 on main's tab), and the water's share, drawn minus hidden, within the measurement's noise of about 2 ms on both builds, so a rise of 1 ms cannot be resolved this way and none was seen; the draw-call count is unchanged (427-439 at the poses). The build's cost: the walk and the foam attributes add about 0.6 s to the water step on the home tile (not timed apart) and 8 bytes a vertex to the stream ribbons.

**Not verified, and what still looks wrong.** The North Fork Cosumnes tile has no water pass yet (`--steps water`), so
its cascades were not captured; the foam's motion was checked from two stills, not watched; the emergent boulders'
look against the water from the bank was seen only at the Hangtown cascade; the falls were not seen from the valley
floor at a walker's eye (the ribbon under a steep run-out fades on the face, so from the stream 70 m below the upper
fall's plunge there is no water to stand by). The lace on a cascade is still too even in scale (one foam look for a 2 m
creek and a 10 m fall's run-out); the standing waves are invisible under full foam; the boil has no spray thrown up and
no wetness on the rocks round it; the wide May spray cloud is one faint sprite; the ribbon's own triangle edges show
through the foam where a wide ribbon folds into a V-valley (a pre-existing fold); the lace and the ripples restart
where one run meets the next (the flow coordinates are each run's arc length, as before), a straight seam across the
channel at a junction; a wake's eddy does not slow the ripples, only the foam.

## 2026-11-01: multiplayer designed before it is built (docs/multiplayer.md)

Aaron's spec of 2026-11-01 (the title on stars, the earth rising as a crescent, the sign-in, the lit earth
with dots and a list of places by players, friends and groups, the chat, going somewhere together, video
and audio toggles) is written up as a design in `docs/multiplayer.md` with a lane plan, so the decisions
every lane depends on are made once, by him, before any lane starts. Decided:

- **Sign-in:** username and password first, with no email address asked for (recovery codes shown once at
  sign-up stand in for a reset by email), and Discord through the `identify` scope only; Google and Apple
  drawn greyed until their keys exist. The application registrations are Aaron's to make; the keys live in
  the git-ignored `.env` like `MESHY_API_KEY` and are never printed.
- **The hub:** one process beside `server.py` (in it, for now) with SQLite at `data/hub.sqlite`, mounted
  at `/api/hub/*` and `/api/hub/ws`; the WebSocket framing factored out of `GameConn` into `ws.py` and
  shared. The acorn game's world and the hub never share an id. A public host is a later, separate step.
- **Privacy, restated.** The rule was "never store a player id beside a position". Groups need positions
  shared live and the places list needs a count per tile, so the rule becomes: a position is relayed to
  the group members in the same tile and persisted nowhere, not logged, gone when the connection closes;
  the places list is counts per tile, never who; presence is a tile id at most. Rejected: a presence table
  or a last-seen tile in the database (nothing in the tables is a place or a time of play).
- **A place is a tile.** "Go to Placerville, five other people are there": the dots on the earth are the
  built tiles, the list is sorted by the hub's count for each. Regions can group tiles later.
- **The season** on the earth is the real one at the tile; the opening screen's season slider does not
  come across (the HUD's control stays for play). The dev paths (`?skip=1`, `?as=`) bypass the title, the
  sign-in and the hub, so the viewer stays verifiable from a URL.
- **Lanes:** the title and the earth (client, against a stub hub) and the hub (server, with tests) run
  together since they share no file; the social screen after the first merges; group travel after those;
  video and audio last.

## 2026-11-01: the `byteLength` error at load was a lost WebGL context; the world is built again when it comes back

Seen on the home tile at 37cd57b and e975425: once, during or just after the build, the shadow pass threw
`TypeError: Cannot read properties of null (reading 'byteLength')` in three's `createBuffer` (`WebGLAttributes.update`,
from `Shadows.update`, shadows.js:514, from `frame`), and the frame loop died with it (main.js requests the next frame
at the end of `frame`), which is why it was seen once. `createBuffer` runs only for an attribute the renderer holds no
buffer for, and the released geometries (gpuRelease.js, 2026-10-27) have no array to upload again, so the question was
what makes three upload a released attribute a second time. Not a dispose and redraw: with `BufferGeometry.dispose`
hooked, four loads of the home tile (direct, and through the opening screen with a card switch) disposed no released
geometry; and the earlier check that every null-array geometry in the main scene "still carries its dispose listener"
told nothing, because `WebGLGeometries.get` adds the listener again right before the upload that throws, and an
emptied `_listeners.dispose` array is still truthy. The cause: a lost WebGL context given back. `forceContextLoss()`
then `forceContextRestore()` on the page's renderer reproduces the stack exactly (three.module.js:70:22 is
`array.byteLength` in `createBuffer`; the shadow pass first, since it renders before the screen pass): on the restore
three makes new `WebGLAttributes`, `WebGLGeometries` and `WebGLTextures`, every geometry is uploaded again, and the
first released one throws. What loses a context in play: Chromium holds at most sixteen WebGL contexts a process and
loses the oldest past that, giving it back when one goes (verified in the pane: eighteen scratch contexts opened in the
page lost the page's own). The viewer opened a context per world build (the impostor bake's own `WebGLRenderer`, lost
at the end of the bake) besides the page's, the opening screen's wisp another, each lineup page one, and several viewer
tabs ran side by side, so the oldest viewer's context went when a later page baked. A GPU reset loses a context the
same way.

The fix, in three parts. main.js: on `webglcontextlost` the frames hold (`w.lost`; three draws nothing on a lost context
anyway, and the status says so); on `webglcontextrestored` the world is built again in its place, where the player
was, with its season and day, through the tile switch path (`switchWorld` takes a tile-local `xy` now, carried in
`arrive.xy`), or behind the opening screen through the screen's own select (`reselect`); the player arrives as the
spirit, as after a tile switch. impostorBake.js: `bakeSteps(input, renderer)` bakes on the page's renderer into a
render target of its own, putting the target, clear colour and alpha back after each step (the frames drawn between
the sliced steps are untouched; a render target has no tone mapping and a linear output on either renderer, so the
atlas is the same), so a build opens no context of its own; without a renderer it opens one as before (the lineups).
And a bug in the way: `Terrain.dispose` read `G`, a name local to `build`, so every tile switch since the water commit
(dba8539, 2026-10-29) ended in "error: G is not defined" with the old world half torn down; it reads `groundUniforms`.
gpuRelease.js's header names the context restore as the one event three would upload everything again after.

Verified in the worktree viewer (port 8786): five direct loads of the home tile with no `byteLength` error, the
cascades rendering from the first frames (109 cascade-0 renders by frame 938 on the first), 64 of the 100 terrain
chunks' arrays released by the first frame and 94 a few hundred frames on (the rest not drawn yet), the far layer baked on
the page's renderer (202,139 far trees drawn). A forced loss in the world: the frames held (the frame counter still at 1511 after 0.8 s), the
status line showed; a forced restore: the old world disposed in 22 ms and the same tile built again, the spirit
arriving at the fox's point (x 4980, z -5023), no error. Behind the opening screen the same loss and restore built the
chosen card's world again behind it; and the card switch that failed on `G` builds the second card's world. Cost: a
loss costs a rebuild (as a tile switch does) and the body: the player comes back as the spirit where they were. Open:
the opening screen's wisp loop still runs a renderer of its own (one a page, closed with the screen); a lost context
that is never given back leaves the status line up for good.

## 2026-11-01: the hub built (lane 2 of docs/multiplayer.md, branch claude/mp-hub-54b819)

The hub is `hub.py` beside `server.py`, mounted by a two-line hook in `do_GET` and `do_POST`, with the
WebSocket framing and threads factored into `ws.py` for both it and the acorn game. Decided where the design
was silent (the details are under lane 2's "Built" note in `docs/multiplayer.md`):

- **PBKDF2 where there is no scrypt.** This machine's Python (3.9, LibreSSL) has no `hashlib.scrypt`, and the
  rule is no new dependency, so the hash is scrypt where Python has it, else PBKDF2-HMAC-SHA256 at 600,000
  iterations (0.2 s here); the stored hash names its algorithm and a sign-in rehashes to the preferred one.
  Rejected: a pure-Python scrypt (seconds per sign-in), a dependency.
- **Recovery codes** are 16 characters (80 bits) from an alphabet without look-alikes, so an unsalted
  SHA-256 is enough; a recovery ends every other session, since whoever had the old password may hold one.
- **A session's last_seen is kept to the day** and the session slides once a day: the table holds when an
  account was last used to the day, not when anyone played. `PRAGMA secure_delete` is on, so a pruned chat
  line or an ended session is overwritten in the file rather than left in a free page.
- **Presence turned down** (the doc's "a user can turn presence down to online-only") needed a column:
  `users.presence`, set by a new `me` message along with the display name and findability.
- **A user may be in several groups**; chat and `place` name the group when it is ambiguous, and a position
  goes to the members of any of the sender's groups in the same room. A group is made from friends.
- **Discord is one path** (the redirect and the return are both `/api/hub/oauth/discord`, as the design names
  the redirect Aaron registers); a signed-in user going through it links the identity.
- **Cross-site requests are refused** by the `Origin` header (a page elsewhere could otherwise open the hub
  socket with the visitor's cookie, or sign them in to another account).
- **The game's framing fix.** `recv` returned a ping that arrived between a message's fragments and lost the
  fragments before it; pings are now answered inside `recv`. Browsers do not fragment small messages, so
  the game's behaviour is otherwise the same, and its client is untouched.
- **Tests run the real server** on a free port with the hub's data and the tiles in a temporary folder, and
  finish by reading the database file's bytes and the captured log for the tile ids, the position's
  numbers, the chat, the password and every name used.

## 2026-11-01: the title and the earth (lane 1 of docs/multiplayer.md)

The title screen is built (`client/src/title.js`, `client/title.css`, `client/src/hubStub.js`, the earth's
textures in `client/assets/earth/`) and stands in for the card screen in `main.js`; the card screen stays behind
`?cards=1` until the earth is verified on the home tile by Aaron. Seen in the viewer on the home tile against the
stub hub and with no hub: the title on stars, the fade and the crescent rising, the Explore button where the modal
will be, the sun swinging round, the dots and the list following a drag and re-sorting as the stub's counts change,
the home tile built behind the earth and entered through Begin as a card did, a second choice tearing the first
world down cleanly, the dev paths and the card screen unchanged. Decided on the way:

- **The face.** Syncopate (Google Fonts, loaded as opening.css loads DM Sans) reads well at 0.45 em letter
  spacing: wide, simple, geometric, as the spec asked. The body text stays DM Sans.
- **The earth on the shared canvas.** The spec asks for the page's one renderer. Its canvas is also where a
  building world warms up its shaders behind the screen (`main.js`'s held frames draw it), so the earth and the
  world would have fought over the one surface. The screen owns the canvas while it is up (`ownsCanvas`): the
  world loop's one visible draw is skipped then (one guarded line in `main.js`; its compiles, uploads and first-use
  passes go on), and the earth renders every frame with the renderer's state put back as it found it. Rejected: a
  second renderer and canvas for the earth (against the spec; the wisp of the card screen already has one), and
  drawing the earth inside the world's loop (6 frames a second while a world builds).
- **The root is #opening.** The title fills the card screen's element rather than one of its own, because
  `main.js`'s MutationObserver, which removes an abandoned world's page elements, skips that root: a list row added
  while a world built would otherwise go with the world. The root's background is made transparent so the canvas
  shows through; `.out` fades it as before.
- **Begin goes to black first.** A card's Begin faded the cards over a world already drawn behind them. Here the
  canvas holds the earth until the world's first visible frame, which would be a cut; so Begin fades the screen to
  black (0.55 s), then calls onBegin, and `.out` fades the black over the world: the world comes up from black.
- **The list.** A row is the card's title (the tile's locality, else its roads, else its id, by the same
  `locality` and `majorRoads` now exported from arrival.js), its region line (the roads when the title is a place,
  then the Indigenous territories) and "N here" (0 is "no one here"). Sorted by count then name, the rows glide to
  their new places (FLIP), and never re-sort while the pointer is over the list: a row stays where it is being
  clicked (the first attempt to press Begin hit a row that had just moved under the pointer).
- **The view.** Yaw and pitch of the earth group (pitch is the latitude of the facing point), a drag in radians per
  earth-radius of pixels, inertia decaying at 2.4 per second, the fling capped at 3 rad/s (a synthetic drag flung
  it to the pole), pitch within 80 degrees, the wheel between 2.7 and 4.6 radii. A chosen place eases the earth to
  face it over a second unless the player is dragging. The crescent phase turns slowly and sits 0.6 rad east of the
  facing point, so the sign-in's swing brings the player's place round.
- **The sun** is a world-space direction: azimuth 152 degrees from the camera's side and 26 up for the crescent,
  30 and 14 for the lit earth, tweened over 3 s on sign-in. No night lights, no clouds; the atmosphere is a rim term
  inside the limb plus a back-faced shell 3.5% larger, both lit only where the sun reaches.
- **The hub, before it exists.** The screen takes `hub`: `'stub'` (hubStub.js: `config`, `welcome`/`me`, counts
  every 3 s that walk up and down, nothing on the network), an object with the same calls (lane 3's `hub.js`), else
  HTTP alone: `GET /api/hub/config` (404 or a network error is "no hub") and `/api/hub/me`. The gate: a known user
  signs in at once; a hub with no modal yet, or no hub, shows Explore; lane 3 sets `title.onGate` and calls
  `title.onSignedIn(user)`. Group travel wraps `title.choose(id)`.
- **Season** is `seasonOfDate()` at the choice: the world enters with the season on auto, today's date.
- **Fixed in passing:** `Terrain.dispose` referenced `G`, a local of another method, and threw on every second
  choice on either screen (the water commit of 2026-10-29); it is `groundUniforms` now.

Open after this lane: the sign-in modal and hub.js (lane 3) over `onGate`/`onSignedIn`; counts over the hub's socket
(the HTTP hub has none, so without the stub every place reads "no one here"); a Begin control on the earth itself
(the row's is the one built); the two Yosemite tiles both titled "Yosemite Village" (their region lines differ);
the three foothill tiles' dots merge at the lit zoom (the hover names the nearest); the card screen's removal with
its sprites once Aaron has seen the earth; clouds; a touch screen and a narrow window are untested; the stars and
the earth were judged on screenshots at 1280 x 800 only.

## 2026-11-01: the landing made forgiving. The ground takes the bird at any speed, a limb within reach takes it, wood deflects instead of bouncing

Aaron: "When flying, if the user runs into the ground they should land. When landing, there should be a few hops
afterwards. Currently, running into branches causes a boomerang effect, I think I have to be going very slow and be
very precise to land on a branch - make it a bit more forgiving." Before, a contact landed only under ATTACH_V (7 m/s,
cruise is 12) and within 0.3 m of a limb; anything else mirrored the flight about the contact normal with 85 % of the
speed kept (`flight.js` bounce), which is the boomerang. Now (`flight.js` contacts, deflect, enterGround, hop):

- **The ground** takes the bird at any speed (the deep-water skim stays), and the landing speed runs out as hops: one
  per RUNOUT_V (3 m/s), at most four, the first long and each shorter, before the keys take over. A hover landing
  gives one settling hop.
- **A limb** a bird can stand on within PERCH_REACH (0.6 m, was 0.3) of the body takes it at up to the species' fast
  speed (18 m/s for the raven, was 7; the flare absorbs it), the stance searched 1.5 m along the limb (was 0.6); a
  landing faster than ATTACH_V gives one hop along the limb.
- **Wood that will not hold it** (a trunk, a steep limb) deflects the flight along the surface: the part of the
  velocity into the wood is lost and half of the rest kept; near head-on there is nothing left, so the bird stops,
  noses down and flutters down (dropV) onto the ground or a limb below. The wings open either way. The old bounce is
  kept only for the water skim.

Rejected: a landing assist that pulls the bird onto a limb from further off (it would land birds that meant to fly
through a crown). Verified on the home tile as the raven with the flight scripted: a 12 m/s dive into the grassland
lands with four run-out hops; a 10 m/s flight at a blue oak's trunk from 6 m takes a low limb instead of bouncing;
deflect's head-on case stops the bird (1.5 m/s, nosed down, a 2.5 m/s drop) and its glancing case sends it along the
wood at half the tangential speed. Not verified: the other fliers' feel (the hawk's and the jay's numbers are their
own in flierControl.js and go through the same code), a crash into a pond.

## 2026-11-01: trees grow their age. The droop of old limbs and the upturn of their tips is mechanics, grown once per species (docs/tree-architecture.md)

Aaron: "many of the oaks here start out upright and then as they age, their branches droop down towards the ground,
with the ends reaching upwards. Is there an algorithm there we can learn? What are the variables, and can we find
them reliably for different species?" and "our goal is to improve the pipeline so that all trees are improved not
just placerville oaks". Four research passes (botany and biomechanics, the five Placerville oaks species by species,
the procedural-modelling literature and tools, a map of `treegen.js`) are written up in `docs/tree-architecture.md`.
Decided:

- **The model is general, not oak lore.** A limb is a growing cantilever: each year adds weight along its whole
  reach but one thin ring of correcting tension wood, so thick old limbs lose to gravity and sag while thin new tips
  grow up toward their setpoint; the sag is frozen into the wood ring by ring (shape memory); the leader's apical
  control decays with age in broadleaves so the limbs' ends rise and found crowns of their own. Jirasek,
  Prusinkiewicz and Moulia 2000 and the MAppleT model (Costes et al. 2008) implement the loop; Alméras and Fournier
  2009 give the race between correction and weight; Bastien et al. 2013 the tip's curving. Conifers differ by leaf
  type (compression wood, apical control kept).
- **Principles by rank**, as the locomotion tree does for animals: universal physics, then by leaf type, then by
  architectural model (the oaks are Rauh's model; `architectural_model` in the records, which the generator ignores
  today, will drive the insertion angles and reiteration), then per species.
- **Per species, only a small set of inputs**, most of them in databases covering thousands of species: wood density
  (GWDD v2), modulus (the Wood Handbook, else from density), height and crown width against diameter (Tallo,
  Bechtold 2004, FVS), growth by age (Silvics, the Urban Tree Database), lifespan, shade tolerance, phenology. Not
  measured for almost any tree: branch insertion angles by order and the gravitropic setpoint; those default by model
  and leaf type and are tuned against photographs, as now.
- **The loop runs offline, once per species**, as a tool that grows the species through its life and writes the
  generator's age classes (`variants`, already read per class by `classRaw`), not in the client per tree (meshes are
  instanced per seed; the lidar crown list only picks a class). Rejected: a growth simulation in the client, and
  hand-tuning droop per oak (what valley oak has today).
- **The first case is the valley oak**, the one species whose weeping limbs are described repeatedly and historically
  and the one with a measured age table; the blue oak is the counter-case (compact, crooked, not weeping in any
  source), black and canyon live next, then the ponderosa for the conifer defaults.

## 2026-11-01: the soul leaves a dead animal, and every soul carries a column by its rarity

Aaron, 2026-11-01: "When an animal dies, especially of predation, a spirit sprite just like the user's should shoot
up and out of the animal's body and fade away. Color should be the highlight color for that species." And: "In
spirit form, the vertical column above mountain lions is excellent. It can be about 30% less bright. Lets see how it
affects performance to have all other species shoot up a column. Lets take the mountain lion as the biggest, and the
most common animal is the smallest - only a foot or so tall. Each other animal having a column relative to its
species rarity."

Built in `client/src/spirit.js` (`SoulPool`, the column shader, the `Wisp`'s `setTint` and shared textures) and
`client/src/animals.js` (the `'kill'` event carries the species index, the id and the body's height; the dead are
out of `eachPlayable` and `playableNear`). Decided on the way:

- **The soul is the wisp itself.** Not a new sprite: the `Wisp` class the player flies as, tinted. `setTint(colour)`
  makes the head the colour lightened toward white, the tail and mist the colour itself, the motes nearly white; the
  player's wisp keeps WARM, COOL and WHITE. The colour is the species' soul colour (`rarityColor` of its rarity), the
  one the spirit's view already gives its glow and the nearby-animals bar its disc. Six wisps are built once
  (`SOULS`), sharing the player's wisp's two canvas textures (`maps`), and reused: a death takes a free one or the
  oldest; nothing is allocated at a death and a finished wisp is hidden, so an idle pool costs nothing.
- **Seen in every form.** The souls are on camera layer 2, drawn by `SpiritLook.render` in a pass after the world,
  and after the spirit's post pass and layer-1 redraw when the look is on, so their colour is not cooled; depth-tested
  against the world (a soul behind a trunk is hidden), with no light on the layer (the wisp's materials need none, so
  no shadow pass runs). A coyote watching a lion take a deer sees the deer's soul rise; so does a vole, a hawk, a
  raven. Rejected: layer 0 (the post pass would pull a red soul to grey-blue-green in spirit form) and layer 1 (its
  pass redraws every playable animal, which the player in a body does not need).
- **Its path.** 3.5 m up and 1.2 m to one side over 2.2 s, fast at first and slowing (1 - (1 - u)^2.4: "shoot up and
  out"), swirling 1.6 times the player's resting rate, the burst's motes out of the body at the start, a 1.8x flare
  falling to 1 (the 2.5x first tried read as a flashbulb at the kill), the fade over the second half, the form
  shrinking to 55% by the end. Sized by the body: 0.55 of the player's wisp for the smallest to 1 for a body 1.6 m
  tall or more (`TAG_DY` times the animal's size as the height). Grown with the eye's distance, x1 within 20 m to x8 at
  300 m and beyond, so a kill at the hunt panel's range (400 m) still shows a mark; the near form is true size.
- **Every death is `kill()`.** The hunts' kills, the player's catch, every path there is: `dead` is set in one
  place. There is no starvation path for the AI in `animals.js` (the needs are the player's own, `needs.js`), so one
  hook covers all deaths; a future one goes through `kill`. The player's own body is excluded by id (the player is
  the spirit already). The carrion loses its glow and column, since the soul has gone, and a spirit can no longer
  enter a carcass (it could, before: `playableNear` did not look at `dead`).
- **The columns' scale: the log of the inverse frequency.** Every soul carries a column in spirit form (the lion's
  beacon generalised: one instanced quad each, the height an instance attribute, cap 1024 as the glow's). Heights run
  from 0.3 m for the most abundant species to 90 m for the rarest (the lion's, as it was), with the log of the height
  linear in the log of the inverse of the species' expected population (`expectedPerKm2`, the game's own spawn rules;
  the vole's 650 per km2 against the lion's 0.23, a ratio of 2800). The rarity rank that colours the souls was the
  other candidate; it is evenly spaced, but it splits the deer from the buck and the woodpecker from the female,
  which are one population each, so the two sexes would stand under columns of different heights. On this scale:
  vole 0.30 m, lizard 0.52, rabbit 0.54, quail 0.57, gray squirrel 0.60, woodpecker 0.73, scrub-jay 1.03, Steller's
  jay and mountain quail 1.15, jackrabbit 1.54, ground squirrel 1.81, fox 3.7, raven 3.8, deer and buck 4.5,
  coyote 6.3, turkey 7.0, vulture 19, hawk 21, bear 78, lion 90. The width grows with the square root of the height
  (0.26 m per sqrt m, at most 2.5 m: the lion's 2.47), so a vole's is a 14 cm thread and a deer's half a metre wide.
  Brightness 0.385, the beacon's 0.55 less 30% (Aaron), for every column alike; the lion's glow keeps its beacon
  size and its no-fade with distance. `window.__we.spirit.view.allColumns = false` gives the beacon-only build
  (a debugging handle, for the measurement below).
- **The cost: about 0.06 to 0.08 ms a frame.** Measured on the home tile with `EXT_disjoint_timer_query_webgl2`
  (available on this Chrome and Metal): the column draw repeated 30 times a frame inside a GPU timer query from the
  mesh's `onAfterRender` (`renderBufferDirect`), the median over 35 to 47 frames divided by 30, against an empty
  query (median 0 ms) and against the beacon-only build. At the start view (the spirit 150 m up over the tile's
  centre, 272 columns in the live set): 2.40 ms for 30 draws, 0.080 ms a frame; the beacon-only build drew nothing
  there (no lion within 400 m). At a deer herd (the spirit 2.5 m up beside three bedded deer, 223 columns, a mother
  lion and her young 230 m off): 1.71 ms for 30 draws, 0.057 ms a frame, against 1.50 ms, 0.050 ms, for the two lion
  columns alone. The columns are filled in the loop that already fills the glow; nothing new is allocated. Well under
  the 0.5 ms Aaron set, so they ship with no radius cut. Caveat: the browser pane ran at 7 to 12 frames a second
  during the measurement (six sessions' viewers were open on the machine), the means were noisy (one sample of 238 ms
  when the page janked) and only the medians are quoted; a quiet machine would read lower, not higher.

Verified in the worktree's viewer on the home tile: a lion's kill of a deer (the catch harness's hunt, the deer blind
to the lion) with the deer's yellow-green soul rising and swirling out of the body under the lion's red column, seen
as the spirit; the same seen as a coyote 5 m away in daylight (the kill forced through `kill` with the lion as the
killer, since the real hunt's kill landed 40 m off), rising to half its course; the lion's column dimmed; columns on
a herd of three deer (4.5 m), a rabbit (0.54 m, blue-violet) and a vole (0.30 m, a purple glow with a thread of
column); the counts and heights above; a second lion kill followed over the soul's whole course, the slot freed and
nothing left at the end; two souls placed on open ground 100 m and 320 m from the spirit (the pool's `spawn`
called directly) showing as a clear green glow and a small green mark against the frame after they had gone; no
console errors from the new code (one 404 for a tile file the worktree had not symlinked). Not verified: a soul
from a real kill at 300 m (the one tried lay behind trees), touch and narrow screens, a second world after
`dispose` (`SpiritControl.dispose` exists for `main.js` to call in `disposeWorld`; `main.js` is another lane's
file today, so the kill listener of an abandoned world is guarded by a flag until then), the frame cost on a quiet
machine.

## 2026-11-01: the social screen (lane 3 of docs/multiplayer.md)

The sign-in, the friends and groups and the chat are built over `client/src/hub.js` and the real hub
(`client/src/account.js`, `social.js`, `chat.js`, `multiplayer.js`, `client/social.css`; the Built note under
lane 3 in `docs/multiplayer.md` has what was verified and what lane 4 needs). Decided where the design was
silent:

- **One hookup object, one place in main.js.** `Multiplayer` (multiplayer.js) is made beside the title screen
  and owns the page's `Hub` for the page's life: the title screen is given the hub as the object the lane 1
  note asked for (`config`, `me`, `watch`, `on('counts')`, `close`), the modal is put at `title.onGate`, the
  friends, the chat and the toggles are mounted on a new `title.onLit(user)` hook, and the tile's room is
  joined by wrapping `title.onBegin`. `main.js` changes at the one place the screen is made; the title screen
  no longer closes a hub it did not make, so the socket lives on into the world. Rejected: mounting from
  title.js (the screen would then own page-level elements that outlive it) and a second place in `main.js`'s
  `enterWorld` for the room (lane 4 moves the join to the entry and the switch anyway).
- **The elements are the page's, not the screen's.** `#social`, `#chat` and `#media` are fixed elements in
  `body`, over the title screen (z 21 over its 20) and then in the world's HUD, where CSS moves the friends
  beside the menu button and `Multiplayer.layout()` keeps the list right of the HUD's readouts while the menu
  is open, the chat above the key line and the toggles under the game box, run on resize and on the `html`
  and `#game` class changes (a MutationObserver, so `main.js`'s `layoutHud` is untouched). They hide with the
  HUD while arriving or switching.
- **The modal replaces the title's Explore placeholder for both cases.** The gate goes to `onGate` whether or
  not there is a hub; with no `config` the modal says there is no hub and offers Explore
  (`title.onSignedIn(null)`), with one it signs in, signs up (the six codes shown once, a copy button that
  falls back to selecting them, a plain warning) or recovers. Errors are the hub's words with the field marked;
  the rules are checked in the modal first in the same words. The way back from Discord (`?signin=`) is read
  and taken off the URL by `Multiplayer`, signed in or not, and told to the modal.
- **The title's input stays the title's; the modal's and the panes' stay theirs.** The earth's drag handler
  captured the pointer on the modal's links and inputs (a click on "Make an account" went to the globe) and
  the title's key guard killed every key typed outside `#opening` (Escape in the chat did nothing): the drag
  and the wheel now leave `.tt-gate` alone and the guard lets `#social` and `#chat` keep their keys; both
  elements stop their keys from reaching the window, where the world's controls listen.
- **The avatar is drawn, not fetched.** `avatarFor(id, size)` hashes the id (FNV-1a) into a hue, a second hue,
  a turn and two or three ribbons, and draws the wisp on a canvas: a dark disc, a glow, the ribbons spiralling
  out through the two hues, a bright core. `--hue` is set on the canvas for the row's ring. Rows are written as
  HTML with a blank canvas each and drawn after, since a canvas serialises blank.
- **The chat's scope.** A picker appears only when there is more than one scope (the tile's room and the
  groups); with one the placeholder names it; with none the input says there is no one to talk to yet. The
  hub echoes the sender's line, so nothing is shown locally first. The pane hides 7 s after the last line and
  stays while the input has focus; a group's history from `welcome` is put in without fading the pane in.
- **Two seats.** `hub.js` has no seat (the session is the cookie), so the second user in the verification
  was a script over `tests/wsclient.py` signed up over HTTP; the doc's `?seat=2` is left to a later step if
  it is ever needed.
- **Small things:** Sign out reloads the page (the cleanest way back to the title and its gate); the display
  name and a group's name go through `prompt()` and Block and Leave through `confirm()` for now; the search
  box asks 350 ms after the typing stops and only with 3 characters or more; the browser logs the hub's 401
  to `me` with no session as a failed resource, which is the hub saying not signed in, not an error thrown.
- **The earth is the spirit world seen from space** (Aaron, 2026-11-01, after lane 1 was merged, done here since
  this lane holds `title.js`): the earth's shader takes the spirit view's palette from `spirit.js` rather than a
  hue of its own: the albedo goes through the same post pass (warm hues pulled to grey-blue-green by their
  distance from the blue-green axis, contrast taken off toward 0.42), the day side is lit by the view's blue sun
  tint and blue-green sky light (`LOOK_SUN_TINT`, `LOOK_AMB`, leaning to the sky light), the rim and the
  atmosphere shell are the view's haze colour, the exposure is 0.95 where it was 1.7, and the night side is a
  faint blue. The dots at the built tiles (the spirits gathered there) are brighter, with a wider halo and a
  larger base size, still growing and whitening with more players, so they read as bright clusters on a dim
  world. The crescent's rise and the sun's swing are untouched. Seen with the stub's counts on the home tile; the
  foothill tiles' dots merge into one bright cluster at the lit zoom, as lane 1 noted.
- **A choice zooms to the place and shows its card; Begin zooms into the dot** (Aaron, 2026-11-01, done here with
  the earth tint). A click on a dot or a row turns the earth to face the place and zooms it (the camera from 3.5 to
  2.6 radii) so the dot sits centred in the space left of the list, at mid height: the earth's centre is solved
  each frame from the dot's wanted screen place and the current distance (the dot is nearer the camera than the
  centre), smoothed toward. The tile's card stands beside the list on the right: the card screen's own markup and
  styles (opening.css `.op-tile`, the map, the title with its roads and territories, the wisp and the build's
  status under the cover, Begin growing in when the world is ready), in a box that is a size container so the card
  rule's `100cqh` is the box's height; the rows' own Begin is gone. The tile's animals gather round the card
  through `CardLineup`, factored out of `OpeningScreen` into a class of its own in `arrival.js` (the card screen
  uses it unchanged behind `?cards=1`), paced 0.5 to 1 s apart while the world builds, each arriving in its
  species' soul colour: `rarityByCode()` in `animals.js` ranks the species as `Animals.rarity` does and
  `rarityColor` gives the hue, set on the still (`--aur`: the silhouette, the aurora lines, the pillar of light
  recoloured in title.css). The card's highlight colour is the season's, `seasonHighlight` exported from
  `arrival.js`. Begin: the earth zooms in to 1.45 radii over 1.5 s while the card and the list fade; a DOM spot takes
  the chosen dot's place (the WebGL dot is zeroed) and is held at its screen position by setting the earth's place
  outright each frame; the screen's fade to black starts at 0.7 s and is under the spot, so the dot stays on the
  black; `onBegin` fires at 1.5 s and `enterWorld` closes the screen, whose own fade (`#opening.out`) brings the
  spirit world in as the black and the dot go. Rejected: keeping the dot in WebGL through the hand-over (the world
  owns the canvas from its first frame) and a second place in `main.js` (none was needed).

## 2026-11-01: the grassland as a continuous sward (branch claude/busy-brattain-dbc54e)

Aaron: "the earth always looks bare no matter how many sparse tufts. Is there a low cost way to add the sense of more
grass at a middle distance and lots of grass at a close distance for appropriate grasslands? The foothills is entirely
covered in grass where there's not forest, rocks or water, it's just everywhere."

**Diagnosis.** On the home tile's open grassland (x 6960, north 7032) at the deer's eye, the ground between the clumps
was the photo's dry tan and read as dirt with scattered tufts; from the raven at 30 m it was the photo with a faint
speckle of plants. A 0.6 m NAIP texel is the mean of the sward it shows and carries none of its structure, and every tier
of plants (the blade clumps to 85 m, the cards to 250 m, the shells from 8 m up) stood on it with gaps between them: the
gaps are what read as soil, at every distance and in every season. A real foothill grassland is a continuous surface in
every season: a solid green sward in spring, a mat of pale thatch in fall, never bare soil between plants.

**The four steps** (docs/grass-notes.md "Seventh pass" has the mechanics), each on its own A/B switch:

1. *The ground is the sward* (c035902; terrain.js `swardPaint`, `swardOn`). The largest win and no geometry: in grassland
   the surface between the plants is painted as blades lying along the wind field, lit root to tip with the season's
   palette, in three octaves that fade by pixel footprint, over a shade floor, the photo modulating only the metre scale.
   Decided: the paint thins by the very same bare-patch field the plants use (grass.js's `bareField`, rebuilt in GLSL in
   uint arithmetic so it matches the JS imul to the bit), so a bare patch is the same patch on the ground and in the
   plants, rather than a second noise that would leave plants on painted dirt and paint under no plants; the material
   terms (rock, the photo's own bare reading, pavement, tree cover) are hoisted out of the near-detail block so the paint
   is excluded there at any distance; the thatch scan backs off under the paint rather than being removed (its relief
   still reads). Rejected: painting with absolute palette colours (an absolute straw turned to snow on pale slopes when
   the oat stands tried it); a single isotropic noise (reads as texture, not grass).
2. *Cover held as the tiers thin* (0c74690; grass.js NEAR_VERT `widenOn`, grassBlades.js). Survivors of a thinning
   widened by the square root of what was cut, at most 1.8x, in view space along the camera's right (AMD's trick, and
   Ghost of Tsushima's push-apart so an edge-on blade is never a sliver); a full 1 / keep cost ~4 ms when tried before.
   The annual and needlegrass leaves lean more, arch over and are broader, checked against the cured annual sward at
   1-3 m. Every clump now records the side of its blade in aBlade.w.
3. *Sward sheets for level eyes* (grass.js SHEET, `sheetsOn`). Where the shells fail (grazing views) and the thinned
   tiers show the ground, strips of baked sward silhouette across the view on a jittered 2 m grid stack into a continuous
   fuzzy sward with a soft horizon. Decided: the strip is baked into a sixteenth row of the existing card atlas, so no
   texture, render target or disposal path is new (main.js, which the multiplayer lane owns, disposes the atlas as
   before); the sheets fade out exactly where the shells fade in (the sine of the depression angle 0.12-0.3) and from
   8-14 m up, so the two never stack; they are coloured by the ground under each and the cards' own colouring code, so
   they hand over to the blades and the paint without a seam of their own. Bowed in plan, on the ground's local plane.
4. *Lots of grass close for every body* (grass.js updateBody). The body-tier ring, which only bodies under 0.6 scale
   had, goes to the big ones (the deer, the lion, the coyote, the bear, the turkey, the spirit near the ground, a landed
   flier) at a third of its density and a 7 m radius: an even subsample, the cells being in rank order.

**Seen** (captures in the session scratchpad's shots/, `before_*` against `s4_*`, 1280 x 800 at 1.5x): the deer at
6945, -7022 (yaw 0.9) in fall and in spring, at its eye and from its chase camera; the raven at 30 and 80 m over
6960, -7032 (pitch -0.75); the lion on the same ground. Fall at the eye: a combed straw mat from the feet to a fuzzy
horizon, where it was tan dirt with tufts; spring: a green sward with blades over it; the chase camera's 5-40 m band a
straw field with a soft sward beyond; the raven at 30 m sees grained ground. No console errors.

**Cost** (EXT_disjoint_timer_query around every render call, summed per frame, A/B on the switch in alternating rounds,
the medians' and the p10s' deltas; the machine ran at a load average of 12-17 throughout, other lanes rendering, so the
p10 is the number to read): at the deer's chase camera (2.2 m up, the ground most of the frame, 1920 x 1200), each step on its own
switch, 4 rounds of 14 frames: the paint +0.4 to +0.8 ms (measured while the frame was 21 ms; a later run at 36 ms frames gave
-1.0, noise), the widening -1.7 (noise), the sheets +0.6, the ring +0.45 (about 6 k clumps drawn); all four at once +3.4 ms
by the medians (+6.5 by the p10s) on a frame of 36 ms against the 21 ms of the quiet hour, so about 2 ms scaled to a quiet
GPU and over the 2 ms asked for on this one. From the raven at 30 m the paint +0.2 to +0.4 (p10), the sheets and the ring
off; at the start view (the tile centre, 150 m up) only the paint runs, within 110-160 m, and the A/B is within the noise
(p10s 17-22 ms on and 17-23 off). Nothing new above 14 m but the paint.

**Still wrong / not verified.** The painted strokes are a tone past ~10 m at a level eye (the sheets carry that band, as
a pale haze rather than blades); the sheets' lower edge shows where they dither in at 4-8 m from the eye; the fall sward
is as pale as the photo (it is the photo's brightness); the sheets do not cast shadows nor stand in the shells' shade; the
coyote, the bear and the spirit were not seen with the ring (the deer and the lion were); touch and narrow screens
untested; the costs are from a loaded machine.


## 2026-11-01: the forager's food glows, and it can smell the plants (branch worktree-forage-glow)

Aaron: "For animals that can forage, plants they can forage should glow. They can smell nearby plants." Built as
`client/src/forage.js` on the understory of 2026-10-29 (the herbs of forbs.js, the shrub impostors of shrubfield.js,
the sward of grass.js) and the senses of 2026-10-29 (scent.js). Decided:

- **Who forages is the data, not a list.** A body forages when the tile's `games.json` `relations.forage` has rows for
  its species this season (`needs.foodPlants`, from the library records' `eaten_by`). The deer in April has 53 plants,
  the vole 15, the bear 3 (bulbs and currants), the lion none, the lizard none (its insects are not plants), the spirit
  and the fliers none: nothing glows for them and they smell no plants. A coyote in fall would see manzanita berries lit,
  which is what the records say it eats.
- **One warm colour, not the species' rarity colour.** The spirit view's soul colours are by rarity: the abundant deer's
  is purple, and a meadow of purple poppies would read as a different world. The glow is one warm plant light
  (`GLOW_COL`, amber) for every forager, the same colour as the plant scents' strands and labels, so "this is food"
  reads the same from the eyes and the nose. The flowering herbs keep their own colours under it.
- **The glow rides on the existing draws.** A uniform `glow` (the body's x z, its radius, the gain) and a weight per
  species this season (`glowSp[16]` in forbs.js, `glowFh[FH_N]` and `glowKind` in shrubfield.js) in the shaders that
  already draw the plants: the herb is lit warm, most at the soft edges of its picture; a shrub impostor's dome is lit
  at its rim with a skirt past its analytic outline. No new texture unit, no new vertex attribute, no second pass. A
  halo from the herb picture's alpha skirt (the texels under the alpha cut) was tried first: the mipmapped alpha
  spreads over the whole card a few metres off and drew each herb as a translucent yellow box. The near 3D shrubs (vegetation.js, treegen's materials:
  the tree lane's files) and the sward (thousands of clumps, the sward lane's file) take a pool of light on the ground
  instead, one instanced draw of soft additive discs from forage.js: under each 3D food shrub within the radius, and
  under the body's nose when the sward's leading grass is food. A billboard halo behind the 3D crowns was tried first
  and read as a yellow cutout over the shrub.
- **The radius is the body's sight of the ground.** `R_BY` m by species: the deer and the bear 22, the jackrabbit and
  the turkey 10, the brush rabbit and the ground squirrel 8, the quails 6, the vole 3; else 12. The glow falls as
  (1 - d / R)^1.2 and the nearest few get a boost inside 0.15 R. The part in season is brighter (`PART`: a herb's
  flower while it flowers at 1.35, its seeds once it has set them 1.2, a shrub's berries or flowers while its crown
  shows them 1.3; a part out of season 0.4-0.45; leaves and browse 1), so blue dicks and mule's ears glow more in
  April than filaree. Pulsing slowly (0.45 Hz, 15 %).
- **Hunger sets the gain.** 0.3 at a full belly rising to 1 at an empty one ((1 - hunger)^0.7, needs.js); the gray
  squirrel, which has no needs, sits at a middling 0.5.
- **The plants are scents.** scent.js takes a `plants` provider (forage.js `sources`): one source per food species in
  reach, the nearest herb of it among the staged herbs (forbs.js stages them within 45 m), the nearest food shrub among
  the near 3D plants and the impostor field's cached cells, and the sward as one source at the nearest food sward on
  rings of bearings when the body does not already stand in one. Their reach is 0.35 of the species' (a deer 70 m, a
  vole 7, a bear 140), shaped by the wind as every scent is, their strength 0.85 of an animal's. They take the module's
  rule unchanged: a scent is drawn only when new (it flickers in and away) or while the player sniffs (L), with its
  label the plant's common name. One change to the slots: the strongest six animals and, beside them, the strongest
  three plants, because a deer's own herd filled every slot and no plant was ever new.
- **The feed verb lights.** abilities.js marks the act slot (graze, nibble, peck) "ready" (a warm edge, `.ab.ready`)
  while needs.js has a named food plant within reach of a hungry body: the same plant the "blue dicks here: hold E"
  line names, and the one glowing under the nose.

Verified on the home tile in the worktree's viewer (the pane hidden, the frames driven by a scratch boot page's
requestAnimationFrame shim, the machine's load average 10-20 all the while): a deer at the grassland (6960, 7032) on
18 April with the lupine, the poppies, filaree, vetch and blue dicks weighted and the fiddleneck, popcorn flower, madia
and silver lupine at zero; the gain 0.85 at hunger 0.3 and 0.25 fed; the same deer in the oak understory (7132, 6892)
smelling miner's lettuce at 2 m, hairy vetch, yarrow, lupine and nettle, and with a sniff every food plant within 70 m
by name (filaree, buckbrush, mugwort among them) beside the squirrel; a vole with its 3 m radius smelling popcorn
flower, filaree, vetch and fiddleneck from its 7 m; a lion with no glow, no halo and no plant scent; the act slot
"ready" at filaree. The frame at the understory pose, 36 renders each with the forage on and off, alternating:
p10 58.6 / 58.5 ms, median 60.0 / 59.4, within the noise of a loaded machine; forage.js's own update 0.02 ms, the
scent's query 0.1 ms; at the grassland pose p10 56.1 / 56.9, median 57.6 / 59.0. Captures in the session's scratchpad
`shots/` (the v6 set at 11:00: the close-up of a popcorn flower left green beside a lit filaree at hunger 0.3, 1.0 and
with the forage off; the deer's eye with and without; the wide view with the pool under the nose). Three rounds of
tuning on the look: the shrub impostors' glow was first far too strong (a lime blob at 20 m) and was cut to a quarter;
the sward pool under the nose was a saturated yellow wash and was cut to 0.3; the herbs' glow is weighted by the
texel's alpha and the leaf's tone so the picture's structure stays. Reads wrong still: a dense herb (a poppy mound)
seen from the deer's eye at 2 m is already a translucent block of mip-averaged leaves in the forbs' own draw, and lit
it is a yellow block; the herbs' glow at this level is on the subtle side at a metre (`forage.k` scales it live).
Checked again on the merged main (e1376c7, with the sward lane's grass, the social screen and the growth tool in):
no shader diagnostics, the deer at the grassland with the three plant scents, the halo and the act slot ready, the
same close-up; two runs of 100 renders each way on a quieter machine (load 8.5): p10 25.5 / 24.8 and 25.2 / 25.1 ms,
median 26.6 / 26.4 and 26.5 / 26.5, so the forage's share is 0.1 to 0.7 ms.

Open: the trees' browse and acorns (willow, alder, the valley oak's acorns) do not glow (the tree lane's files; the
acorns on the ground are the acorn game's own glow); the emergents (sedge leaves for the deer and the vole) neither;
the herbs' pictures have no part-of-plant mask, so a glowing bulb lights the whole soap plant; a flier that forages
(the quail in flight) has no glow; the sward's pool is under the nose only, not a lit sward around the body; the
captures were taken with the sward lane's grass unmerged.

## 2026-11-02: going somewhere together (lane 4 of docs/multiplayer.md)

The group's invites, the joiner's world and the arrival behind the picker are built over the hub as lanes 2 and 3
left it (`client/src/multiplayer.js`, `arrival.js`, `main.js`, `hub.js`, `chat.js`, `social.css`; `hub.py` and
`tests/test_hub.py` where the protocol needed it; the Built note under lane 4 in `docs/multiplayer.md` has what was
verified and what lane 5 needs). Decided where the design was silent:

- **The hub keeps a connection's last position for the next member to enter the room.** The doc relays a position
  and keeps nothing; a joiner who enters the picker's tile needs the picker's place at once to plan an arrival
  behind them, and the next 5 Hz tick is a fifth of a second away at best, a round trip over the internet at
  worst, while the arrival has already started. So `HubConn.last_pos` holds the last relayed `pos` in memory and
  `room join` sends the joiner each group member's last one in that room. The rule stands as the doc states it:
  relayed, never written, never logged, gone with the room or the connection; `test_zz` still searches the
  database file and the log for the numbers. Rejected: the client waiting on the room join before starting the
  arrival (a pause on every entry for a rare case), and planning only from the invite's point (the joiner ends 120 m
  over where the picker meant to arrive, not behind where they are).
- **The invite carries the picker's planned point.** When both are still building, the joiner arrives over the
  point the picker will arrive at (the doc's fallback), so `place` takes `point {x, north}` tile-local and the invite
  relays it rounded to the centimetre; the hub's invite record keeps no point, as it keeps no tile. A switch from the
  Location box sends `place` once the tile's manifest is loaded, because the lat/lon only becomes a tile-local point
  then (a second or two after Go); the earth's choice sends it at once with the title's point.
- **The arrival re-plans rather than waits.** The joiner's arrival starts on the invite's point as every arrival
  does; the picker's first `pos` within 2.5 s of the start re-plans it as a follow (`Arrival.plan(point, follow)`:
  in from behind the picker along their heading, ending 6 m up and 10 m back, slowing to a hover), later ones slide
  the whole path with a picker who moves. The first 2.5 s are 400 m up and over a kilometre back under the screen's
  fade, so the turn is not seen; over localhost the `pos` comes with the room join. After 2.5 s the arrival goes on
  to the planned point, which is what the doc asks for when the picker has not entered. Rejected: a second flight
  from the planned point to the picker (two arrivals), and a cut to the end pose at the end (a jump).
- **Join Begins by itself.** The doc has the joiner's world "built for that tile" and the joiner arriving: on the
  earth, Join chooses the place as the player would (`title.choose` under a quiet flag so no second invite goes
  out), the card shows the build as for any choice, and `title.begin()` is pressed for them the moment the tile is
  ready (the wrapped `setReady`), since they already said yes. In a world, Join is the Location box's switch with
  the picker carried (`switchWorld`'s `extra.lead`). Not now answers and does nothing else.
- **The room joins at the world's entry.** Lane 3 joined it at Begin; it is now `mp.entered` at the end of
  `enterWorld` and `mp.left` at the start of `switchWorld`, so the counts say who is in a world rather than who is
  zooming in to one, and a switch leaves one room before it enters the next. The position goes to the hub from a
  200 ms timer while entered (`hub.js` still refuses it outside a room or a group), rounded to the centimetre before
  it is sent so the client holds nothing finer than the hub relays.
- **Which group is asked.** The chat's scope picker decides when the player is in several groups: the group the chat
  goes to is the group asked along; when the chat goes to the tile, the first group. A picker in several groups who
  wants another group can change the chat's scope first; a chooser for the invite itself is a later nicety.
- **The picker is told in the chat pane, and told again after arriving.** `placed` and each `answer` are system
  lines; an answer that comes while the pane is hidden with the HUD (the picker switching or arriving) shows the
  pane again once they have arrived, else they would never see who joined without opening the chat.
- **A dialog lasts a minute, the hub's invite a minute and a half.** The doc's "expires after a minute" is the
  dialog; the hub keeps the invite 30 s longer so a Join pressed at the last moment still lands (`INVITE_S` 90, was
  15 min). A newer invite replaces an older unanswered one without answering it (the picker is not told "declined"
  for an invite the member never saw go).

## 2026-11-02: the group's players seen in the world, on the map and at the screen's edge

Aaron, after testing with two browsers: "I can't see the other player's spirit. The players should show up on the
map and just like if I'm in a deer herd, if the other player is not visible on the screen their avatar should be
shown at the edge of the screen closest to them." Built as `client/src/players.js` over lane 4's position relay
(the Built note under "Seeing the other players" in `docs/multiplayer.md`'s Open has the detail and what was
verified). Decided where the words left room:

- **A spirit wisp in the avatar's colours, whatever the member's form.** The relayed `pos` carries `form`, but the
  bodies of other players (their species drawn and animated from the relay) are a step of their own; until then a
  member in a body is a small wisp over where the body is, so the player sees them and sees that they are not a
  spirit. The wisp is the player's own `Wisp` class in the two hues `avatarFor` draws the member's avatar with, so
  what is seen in the world, in the friends row, in the chat and at the screen's edge is one identity. Rejected: a
  plain marker sprite (nothing in the world looks like that), and the player's own warm-and-cool colours for every
  member (they could not be told apart).
- **Runs between samples, not extrapolation first.** A 5 Hz relay drawn raw steps five times a second. Each sample
  starts a run from where the wisp is drawn to the sample over the samples' measured spacing, so the wisp is a
  fifth of a second behind the member and never jumps; past a run's end it keeps the run's velocity for 0.4 s
  (a late packet), then holds, and 3 s of silence fades it out. Rejected: dead reckoning ahead of the samples
  (overshoots on every turn, and a spirit turns on the spot), and a fixed interpolation delay of two samples (half
  a second behind for no gain over localhost or a good connection).
- **The souls' camera layer, in every form.** The wisps are on layer 2 with the souls, drawn by `SpiritLook.render`
  after the world and the spirit's post pass, so the colours stand under the spirit's view and the wisp is seen
  from a deer's eyes as well as a spirit's; `extra` on the look is the pool, drawn while any slot is live. No new
  texture unit: the pool shares the player's wisp's two textures (THREE already warns at 17 on the terrain's
  program, a pre-existing count, not this lane's).
- **The herd marks' placement, shared.** The circle at the screen's edge nearest an off-screen member is the same
  rule the herd marks use for a herd member out of view, so it moved into one exported function (`edgePlace`)
  rather than a copy; the bottom edge's inset is measured from the HUD's bottom rows (the abilities row with its
  key line, the nearby bar, the chat) so a bottom mark stands over them, which the herd marks gain too. The mark is
  the member's avatar with the distance under it, since a wisp at 300 m is a glow and the number says whether to
  walk or fly.
- **Grown with distance, the souls' rule, from nearer.** A resting wisp is 1 m of ribbon: at 150 m a few pixels.
  The souls grow x8 by 300 m so a kill is seen from the hunt's range; a friend's wisp grows the same from 8 m,
  so it stays a readable glow across a meadow. Within 8 m it is the player's own wisp's size, a little brighter.
- **Who is not drawn.** The hub relays within a room to co-members only (lane 2's rule), so a member in another tile
  or not in a world, and a stranger in the same tile, send nothing here; the social row says who is online. A
  `presence` that says offline or another tile drops the slot at once; otherwise silence fades it, since a member
  who hides their tile ("online" only) still sends positions while in the room.
- **Measured.** Four faked members within 25 m: 0.2 ms more on the CPU in `players.update` (0.3 vs 0.1 ms median),
  the render submit within noise; past 60 m a wisp's form updates on alternate frames and four far ones cost 0.1.

## 2026-11-02: hosting: one origin, one always-on container; Vercel is not for the hub (docs/hosting.md)

Aaron, after two players on one Mac lagged: "Maybe a hosted version would be faster?" then "I have a vercel instance we
could use, but i think it's time". The lag was two worlds rendering on one machine, not the hub. Decided:

- **Vercel does not hold the hub**: serverless functions have no WebSocket server, no process between requests, no
  persistent SQLite. It could serve the static client, but the session cookie wants one origin. Rejected: splitting
  the client from the hub across origins.
- **One container, one origin, always on**: `server.py` as it runs on the workstation, behind TLS, on Fly.io
  (`fly.toml`, TLS at the edge, a volume) or any Docker VPS (`deploy/docker-compose.yml` with Caddy). The hub's
  database and the played game worlds on the volume (`deploy/entrypoint.sh` symlinks each tile's `game/` there).
- **The pipeline is a workstation dependency**: `server.py` imports it if it can and otherwise turns the build API off
  (503); the image is Python and pyproj, with each tile's `client/` rasters and JSON layers (412 MB for seven tiles)
  and none of the pipeline's intermediates (`.dockerignore`).
- Not run as a container here (the Docker daemon was off); the first `fly deploy` is the test. The accounts, the
  domain and the Discord registration are Aaron's.


## 2026-11-02: Dig, a game for the vole and the coyote, shared from the first hole (docs/game-dig.md)

Aaron: "a new game for voles and coyotes. Dig! Voles may dig tunnels at a rate of .5"/s. They can create tunnel
systems, big chambers etc. coyotes may dig down at a rate of .5"/s if where they dig intersects with a tunnel they are
able to see the tunnel along with a bright glow from the tunnel side containing voles", and the same day: "I want the
holes to be persistent. For holes in trees, they should disappear if empty after 1 month. For holes in ground, they
should disappear if no animal has been inside for 1 week. I want them to be seen by all players and animals. I want
animals to do the behaviors as well." Decided:

- **A graph, not a voxel field.** Tunnels are nodes on their centrelines with a radius and segments between them; a
  chamber is one room node that absorbs the nodes round a dug loop; a pit is a bowl. Rejected: a voxel or signed-distance
  field of the ground (memory per tile, a remesh per dig step, and nothing to send but bricks); merging a loop into
  widened capsules (the first build: thirty overlapping 10 cm capsules a chamber, a ray through it crossing dozens of
  walls).
- **Events in the acorn game's world, from the start.** The tunnels go through `server.py`'s `GameWorld` for the tile
  and season on the same socket, a dig channel with its own sequence (`dseq`) so the acorn clients' gap check never
  trips, the same reducer in Python (`digworld.py`) and JS, the snapshot (v4) and log; the client predicts and rolls
  back as `net.js` does; offline, localStorage. Every page in a tile is on the channel while in the world, the acorn game
  running or not; the first is the AI host for the digging. Events carry no player or animal id, so a tunnel's position
  is never kept beside whose it was. Rejected: localStorage first and the socket later (Aaron's change of plan); the
  acorn game's player ids on the dig (nothing in the dig needs to know who).
- **Decay on wall time, on the server's tick.** A system or pit unseen for 7 days goes (a dig or an hourly `visit` from a
  page with an animal in it resets it); a stash hole or granary empty for 30 days goes (`held`, `since`, `gone`; an
  untouched stash hole dates from when the rule began). Checked every 60 s whether or not anyone is in the world.
- **The terrain is not edited.** The ground's shader discards a disc in the eight nearest openings, the grass drops a
  clump rooted in one; the tubes' union is made in their fragment shader against their neighbours' capsules in a float
  texture. Rejected: cutting the terrain mesh (the fine square and the micro patch rebuild on their own schedules) and a
  stencil mask (a pass for every opening, and the grass and shells would need it too).
- **The cost underground is over the 1 ms asked.** From above, with only the stretches near an opening drawn, 0.1-0.2
  ms; from inside, the walls filling the screen, 3.1 ms of the dig's own GPU time at 1920 x 1200, though the frame was
  no slower (the walls hide the world). A depth pre-pass to keep the early depth test (twice) and drawing after the
  terrain cost more and were dropped. Next: a cheaper wall.
- **AI coyotes dig too** (Aaron's change of plan; the first brief had them not): on the AI host, a coyote that smells a
  buried vole within 15 m digs over it and pounces when the tunnel shows it.
- Registered in `games.json` by a pipeline rule (`pipeline/games.py` PLAYS): the vole's burrow-shelter games and the
  coyote's hunt of the vole carry `play: ['dig']`, the tile `plays.dig`; the client digs only for a species listed there.

## 2026-11-02: a drag orbits the camera round the body

Aaron: "The camera should work so that the pivot point is the character, not the camera. So when the mouse is dragging
and moving it is orbiting and panning with the user as the focal point." Before, a horizontal drag turned the head up
to its limit and then the body (it steered), and a vertical drag pitched a flight or tilted the walker's look about the
camera. Now (`flight.js` `orbitBy`, `easeOrbit`, `resetOrbit`; read by every control's camera):

- A drag sets `orbitYaw` (any amount round the vertical) and `orbitPitch` (0.45 rad down to 1.15 rad up from the
  set-up's own), and never turns the body or pitches a flight. Each camera adds the yaw to its own and swings its
  boom up or down by the pitch about the body, and turns its aim by the same yaw and shortens its look-ahead as it
  rises, so the body keeps its place in the frame: measured, a 100-degree orbit of the deer moved it 35 px on screen,
  a 120-degree orbit of the hovering raven 12 px.
- The orbit holds while the body stands or hovers; 0.8 s after the last drag, once the keys move the body (or a
  flight flies on), it eases back behind at 1.6 per second. A new body starts behind (`resetOrbit`).
- The head turns toward the orbit within its limit (`headYaw`). On the wood the squirrel's and woodpecker's tree
  cameras take the orbit as their own swing round the trunk.
- Steering is the keys' alone now (A / D, the arrows); the help lines say "drag to orbit the camera".

## 2026-11-02: shared animals: one page runs them, the others mirror its stream

Aaron, after two browsers on the site: "Do both users see the same animals moving the same direction?" They did not:
each browser ran its own. Decided (`docs/multiplayer.md` "Shared animals"):

- **The host client simulates; the server only relays.** One page per world (tile and season) runs `animals.js` for
  every player in the world and streams the state at 4 Hz; the server relays it to the others in memory and orders the
  events that change the world (a kill, a carcass gone, a flush). Rejected: the animals on the server (Python would
  need the whole AI, the terrain and the vegetation the AI reads; a port, not a relay); every page running the AI from a
  shared seed (the AI reads the player's position and its own random draws every frame, so two pages part within
  seconds); lockstep (the frame rates differ and a hidden tab stops).
- **The AI host is one page.** The acorn game's AI collectors, the Dig game's AI digging and the animals are one
  page's: the server matches a page's three sockets by a random page id and names the acorn game's AI host the host of
  the other two. Rejected: separate hosts per channel (the collectors are animals; two pages would each run half an
  animal).
- **A mirror's catch is the host's decision.** The mirror asks; the host checks reach and orders the kill everyone
  sees, or answers a miss. Rejected: the mirror kills and tells (two players striking the same rabbit would both eat
  it); optimistic kills rolled back (a body that falls and gets up again).
- **Interpolate, never simulate, on a mirror.** Two samples per animal, eased, extrapolated 0.4 s, snapped on a jump
  or a silence; the state and the phase rate from the newer. The leg engine, the deer's clips and the far tier run on
  the mirror from the streamed speed, turn rate and pose, so the legs look the same without streaming them.
- **A byte cap, not a count.** 24 KB/s of JSON from the host, the near animals first, the far ones less often; a
  spawn carries its first full sample so nothing is drawn unplaced. Binary packing was left for when the cap binds
  with many players (JSON was kept so the server can stay a relay with no parser of its own).
- **Hand-over from the mirror's last state.** The next host rebuilds the live set and releases each animal it was
  mirroring into the AI where it stood, as a body the player leaves is; nothing vanishes near the players who stay.
- Found in passing and fixed: the hunt panel counted an AI hunter's kill as the player's when they were the same
  species (`hunt.js` read the kill's species); a kill now says whether it was the player's own (`mine`).

## 2026-11-02: the other players as their animals, through the animals' own pool

The second half of Aaron's observation ("each user can see the other, but not in their animal form"). A group member in
a body sends its pose with the hub's 5 Hz position as the animal stream's fields (`bodySample.js`), and the receiving
page draws it as a record in the species' pool of `animals.js`, mirrored like the host's animals. Rejected: a second
renderer for player bodies (the controls' own meshes, one per species, a second copy of every model and its leg
engine); streaming the leg engine's joints (the gait inputs reproduce the legs on the receiving side, as for the AI).
Kept: the wisp for a member in spirit form, the group-only relay (the privacy rule), and a remote body is no one's
prey and no one's body to take.

## 2026-11-02: games are always on; the acorn game's round is the season

Aaron: "Games, rather than being something you turn on, are always available and playable." Decided
(`docs/game-acorn-stash.md` "v5: always on"):

- **No Start button; the world is joined on entry.** The acorn game starts with the world, so every page is in the
  tile's shared world (the same socket as the shared animals and the dig) and the AI collectors gather on the AI host
  all the time. Rejected: starting it on the first acorn the player touches (the AI collectors and the other players'
  events would be missing until then, and the board would jump).
- **Live in a collector body, quiet otherwise.** The player's acorn actions only in the raven, squirrel or woodpecker;
  the game box hidden until the player first carries or caches. Rejected: the box at entry (a HUD panel for a game the
  player may never play, in every body).
- **The round is the calendar's season.** One round per calendar instance of the world's season (`season_label`:
  "2026-fall"), with no length, begun on the first join and replaced when that season comes round a year later; the
  board's columns are this season and all seasons. Player ids are still derived per round, so they rotate per season.
  Rejected: a round per real-time window (a clock nobody started); one round forever (the ids would never rotate, and
  a player's caches would be linkable across years).

## 2026-11-02: Scavenge, a death in the world lasts a day (docs/game-scavenge.md, branch claude/scavenge-game-e5b676)

Aaron: "New game: Scavenge. When an animal dies, it begins to decompose over the course of 1 day. It emits a smell
'dead animal' and appears to glow from an appropriate distance for carrion eaters." Decided:

- **The stages are drawn on the body that fell, by one number.** The dead animal keeps its instance in its species'
  mesh and its bedded pose; its gait phase, free once the fall is over, carries the decay and the share eaten, and every
  animal shader reads it (bloat, sink, dull, open, dry). Rejected: a carcass model of its own per species and stage (a
  mesh per stage and species, and the catch's pose lost), a per-instance attribute (the deer's skin path is at 12 of
  Metal's 16 slots and the buck's at 15), a texture (the 16 units are full). The bones are the one new mesh.
- **A day by mass, the heat and the feeding.** A deer 24 h, a jackrabbit or brush rabbit 12, a vole or lizard 6;
  summer half again as fast, winter two thirds; the afternoon faster, integrated over the age so the hour of the kill
  does not change the day; a bite advances the decay by 0.45 of its share and an emptied store is bones. The first build
  multiplied the whole age by the current hour's heat (a deer killed at 8 pm was bones at 19 h).
- **The smell is the existing scent, its reach by stage, with slots of its own.** A fresh kill carries three quarters
  of the nose's carrion reach (a coyote's 340 m downwind), a bloated one a third more than the reach (580 m; the
  vulture's 1 km), a dried one half, bones a fifth. Its label is "dead animal" until the scent is strong enough to
  name the species. Two slots are the carcasses' own: in a meadow the voles and squirrels filled every one of the 24
  sniff slots and the dead deer at 0.2 was never drawn.
- **The glow is a forager's pool near, a beacon far.** Within 60 m a pool of light on the ground (forage.js's halo); by
  300 m it faces the eye and rises, grows to stay a few pixels and brightens up to four times. The reach by species:
  the vulture 3 km, the raven 400 m, the coyote 150, the bear 120, the lion 60 (its own or a lion's kill).
- **A meat store and bites, not a feed flag.** The player's and the AI's feeds take kilos by species (the coyote 1.5,
  a raven's stab burst 0.12) and fill the belly by that share; the flank darkens as the store goes down.
- **The AI by what it notices, in a pecking order.** The vulture and the raven by eye (the vulture once the kill
  smells), the coyote and the bear by the nose and the wind, the coyote mostly at dusk and night; the birds give way to
  a canid, bear or lion feeding, the coyote to a bear or lion. The vulture circles low and does not land (no ground
  model): a gap.
- **Shared on the dig channel's socket, as Dig.** `carrion` in the world's snapshot and log, `cev` messages with their
  own `cseq`, a birth stamped with the server's clock, feeds as kilos, the sweep removing what a day has taken;
  anonymous (species codes only). The carcass's id is the animal's: a page that holds a live animal of that id kills it
  when the world reports the carcass, and a cell that spawns it again while its carcass lies there gets the carcass.
  When the shared-animals lane lands, the kill is a server-ordered event and the carcass hangs on it.
- **Verified** (the machine at load 10-30 from other lanes, the page stepped by hand where its frames crawled): a deer
  killed as the lion through every stage to bones (montages at 0-23.5 h, and at 12, 26, 52 per cent eaten); the
  coyote 300 m downwind smelling a fresh deer ("dead animal", faint) and following the wisp alone from 280 m to it,
  the label turning to "deer · dead" at 160 m; E there taking 1.5 kg bites; the vulture 1.7 km off and 260 m up seeing
  it glow with its stage on the panel; a vulture circling over a two-hour carcass, two ravens feeding in stab bursts,
  an AI coyote smelling a jackrabbit carcass at dusk and feeding, then sent to the deer, the ravens taking off; the
  carcass back after reloads at its age from the server; tests/test_carrion.py. Not resolved: the frame cost. With ten
  carcasses in view the frame has 6 more draw calls (of about 500) and 29 thousand more triangles (of 12.3 million),
  and the module's own update is under 0.01 ms; the GPU frame time at the 10th percentile was 37.2 ms against 36.1
  without them, but the medians (63 and 46 ms) and tails swung by tens of ms with the other lanes' load, so the
  difference is inside the noise. Not seen: the bear or the fox at carrion, a summer carcass, two pages at one carcass
  at once (the tests do that on the server), a vole or lizard carcass's stages up close.
- **After the shared animals (fix on main).** The AI's carcass births and bites were sent only by the dig channel's
  host, but the AI now runs on the animals channel's host; when the two were different pages (the page leading the
  hosts on neither channel, or a page without an id) a carcass was never born on the server, and a mirror's own catch
  was sent twice (by the mirror and by its host; the server refused the second as "taken"). Now the page that runs the
  animals sends them and the server takes `ai` events from it (`runs_animals`). The sweep test failed in the evening:
  five summer hours take a vole only by day (a vole killed at 9 pm reaches 0.97, the night being cooler than the mean),
  so it now uses margins that hold at any hour (6 h, and 20 for the deer).

## 2026-11-02: tree heights on a long-tailed curve, the giants drawn (client/src/stature.js)

Aaron: "On a flat plane like the bottom of yosemite valley, it's very clear there is an upper bound to trees - the
horizon looks flat. Really, some trees live significantly longer and get significantly bigger on a bell curve, so the
horizon should be more irregular." Diagnosed on the Yosemite tile (DEM only, no crown list), three causes:

- **The near and mid forest**: a tree was its slot's class tree times a uniform 0.75-1.25, so every species stopped at
  1.25 x its tallest class tree (ponderosa 53.7 m in the mid set), and a rare species' one shared tree was its whole
  range (every cottonwood 17 m +-25 %, max 21.3; valley oak 24.5; ash 22.1).
- **The far tier beyond about 1.75 km** threw each record's scale away and drew the baked tree at the species range's
  spread about it (`hrange`: ponderosa +-15 % about the baked 32 m), and the atlas bakes one or two trees a species
  (no old-growth): every far ponderosa on the tile was 40.2 m or less. That is the flat line along the valley.
- **The clamp** `SCALE` [0.4, 1.7] (crowns.js) on a drawn tree's height scale, shared by the far records.

Decided:

- **A size curve per species, the class from the height.** A canopy tree (a slot of the base or old class) takes its
  height from a log-normal fitted to the species' typical (median) and tall (95th percentile) heights and truncated
  at its record, at the quantile of the placement's own scale draw (the same random number, so nothing moves); the
  stand's tree cover (x0.88 in a closed stand) and slope (x1.1 on a flat floor) shift the curve. One 30 m cell in 250
  trees holds an emergent at tall x 1 to 1.35 (hash of the cell). The class is the one whose range holds the height,
  the old class for the top 8 % of the curve and every emergent (the lidar tiles' rule is the top 5 % by size), and
  the slot one of that class's by hash. Young classes and snags keep their class range and the uniform scale: the
  regeneration and the dead stay as they were. Rejected: a Weibull (two parameters fit the same two numbers; the
  log-normal's quantile is one probit); stretching every slot by the curve (the poles would vanish into the canopy).
- **The far records carry the drawn height.** A cell tree's record holds its target height (negative), as a crown's
  already did, and `mapRecords` scales the baked tree that stands in for it to that height; a young tree's or a snag's
  record carries its slot tree's height x its scale, which also fixes the hand-over for them (they were drawn as the
  atlas's stand-in times the near scale: a 2.6 m young canyon oak was 3.4 m far, a ponderosa snag 23 m near was 27 m
  far). The far tier keeps the record's height at every distance with a +-6 % jitter (`FAR_JITTER`).
- **The clamp raised to [0.4, 3]**, the near forest clamped the same way so both sides agree: a rare species' one
  shared tree scaled to a giant (a 13 m buckeye on its 4.6 m tree) and a giant black oak far, drawn as the baked
  mature 12.7 m tree, need it. The giants' crowns widen with them (the instance scale is uniform), as an old tree's do.

Measured on the Yosemite tile (the far records, every tree on the tile): ponderosa p50 29.5 -> 32.6 m, p99 40.0 ->
52.2, max 40.2 -> 64; incense cedar max 27.5 -> 54.9; black oak 15.8 -> 31.7; cottonwood 21.3 -> 38.4; Douglas-fir
58.8 -> 76.8 (default numbers by form, before the records carry their own). Near and far heights agree for 39,200 of
39,415 trees within 2 % (mean 0.07 %); the rest are young trees under the 0.4 clamp on a taller stand-in. Same
placement (43,462 mid plants, 562,105 far records before and after).

**The records' numbers** (second commit): every tree species carries `stature` (typical, tall, record, with the
source beside them), read 2026-11-02 from Jepson eFlora and Silvics (both through 2024 Wayback snapshots: Jepson is
behind a Cloudflare check, Silvics left srs.fs.usda.gov), FEIS, the National Champion Tree register's 2024 file, the
Gymnosperm Database and mdvaden.com; the three growth blocks' height curves set the oaks' and ponderosa's typical
heights. Where no measured record was found (interior live oak, Hinds walnut, bigleaf maple, the willows, the Sierra's
Douglas-fir) the record is an estimate and says so; a champion on the register's points is not taken as the tallest.
Canyon live oak's typical is lowered to its foothill class trees (12 m, not FEIS's mid-range). With them a species
first piled up at its record (capping the height there: Douglas-fir p99 = max = 67 m): the curve is now truncated by
its quantile (the draw spread under the record's), and the emergents' span is fitted under the record. A far record's
scale on its baked stand-in may reach 4 (`FAR_SCALE_MAX`; the near forest stays at 3 on the slot's own tree): canyon
live oak is baked as one 8.6 m tree. Yosemite's far records then: ponderosa p50 31.1, p95 45.7, p99 52.2, max 65.5 m;
incense cedar 28.8, 44.9, 53.3, 64.6; black oak 13.2, 24.6, 29.6, 37.7; Douglas-fir 34.5, 55.5, 63.0, 67; cottonwood
19.5, 29.5, 32.8, 34.1; valley oak 20.9, 30.3, 35.8, 43.3.

**On the lidar tile** (the home tile, 395,356 crowns, checked third): heights are the crowns', so only the clamp and
the classes were checked. The old clamp 1.7 capped 16,011 crowns (4 %) by up to 29.7 m; at 3, 142 still exceed it.
The tallest crowns (ponderosa 54.5, 54.0, 51.5 m) are drawn at their height on the old-growth tree (43 m, x1.27) with
their landmark ids. The far tier now keeps every crown's measured height at any distance (before, beyond about
1.75 km it was the species' spread about the baked tree). Found, not fixed: the crown plan gives a few 49-51 m crowns
to madrone, sycamore and black oak (chooseSpecies falls back to the row's tallest-capable species when none reaches
the crown), and those species draw one shared mature tree (12.7 m madrone), now stretched x3 to 38 m where it was
x1.7 to 22 m; the species fit could read the records' `stature` record instead of the class ranges.

**Cost**: the same draw calls and triangles at the home tile's poses before and after (316 / 7.73 M from the air, 423 /
9.36 M on the ground) and within 3 % at Yosemite's (river bank 424 / 15.006 M before, 423 / 15.012 M after); the GPU
timer-query medians overlap (the pane's GPU time wandered 18-38 ms round to round at one pose, so no finer claim).
No console errors on either tile.

Not done here: the meadow belt on the valley floor is mostly broadleaf (LANDFIRE's mix there: alder, willow,
cottonwood, bay, ash, valley oak), so the ponderosa and incense cedar giants that stand over the real valley's
meadows are few near them; sugar pine and white fir are not in the library.


## 2026-11-02: cliffs with sharp geometry: a cliff material by rock class, slabs on the faces, and the rims left as measured (branch claude/cliff-geometry-1d20bb)

Aaron: "Yosemite's cliffs look 'soft' because of their repeating patterns and lack of sharp geometry." Diagnosed in the
viewer on `utm11n_267_4175` (El Capitan from the meadow at the raven's height and from the valley floor at a deer's
eye, Half Dome's north-west face from the air, the walls above Yosemite Falls) against photographs of El Capitan
(Wikimedia Commons: the sheeted face, its near-vertical joints and dihedrals, the dark water streaks, the pale scars of
recent falls, the hard rim). Three things were soft: the texture (past ~35 degrees the photo is a smear stretched down
the face, and the 2026-10-28 rule laid one set of 7 m and 2.6 m bands over it, the same for granite and a road cut),
the geometry (a 10 m mesh of a DEM whose cliffs are smoothed: the 900 m wall is one surface, no edge, roof or ledge
breaks it or throws a shadow), and, it was thought, the rims (the DEM's mosaic leaves "about 10 m of noise" there).

- **A cliff material, by rock class, without repetition** (terrain.js CLIFF_GLSL cliffShade). On ground past 42-55
  degrees, held off vegetated ground below 60 (tree or shrub cover, the habitat's oak and chaparral), the face is
  painted in place of the photo at every distance: a base colour per rock pattern (groundDetail.js CLIFF_PATTERN from
  geology.png's rock class, carried in the detail mask's A channel, which held a road weight nothing read: 1 sheeted
  granite, pale; 2 bedded slate, schist and sandstone, grey-brown; 3 blocky greenstone and volcanic rock, dark; 0
  without geology); 100 m bands; arching exfoliation scars at 22 m and 99 m spacings, a quarter of the small lines and
  a third of the big ones kept in runs, each with a shadow line, a recess facing down below it and a lip above; dark
  water-streak zones tens of metres wide and hundreds tall with 2 m ribbons in them; lichen on granite; a 15-40 m bulge
  field tilting the light so a wall seen from the meadow is not one tone; a third of the photo's own light and dark
  kept. The metre scale is two made layers in the detail array (groundDetail.js cliffLayerSteps: sheeted granite with
  two near-vertical joint sets and diagonal dihedrals; bedded slate with beds dipping 27 degrees and cross joints;
  cracks tapered to their tips, the albedo and normal dithered to 8 bits), hex-tiled (each cell of the triangle grid
  turned +-14 degrees, half of them about, and shifted by its hash; three copies blended), on the two vertical planes
  blended by facing, at the layer's repeat within ~0.1 m a pixel and again at 10x out to ~0.7 m a pixel. cliffOn 0
  gives back the 2026-10-28 rule for A/B.
  Mistakes on the way, each seen in captures: the face fields keyed on a dot of the world position (thousands of
  metres out) with the per-pixel normal marbled every pattern into wood grain (a degree's turn of the normal moves the
  coordinate tens of metres; now two world axes blended by facing, as a triplanar blend); the sheet-edge spacing taken
  from a noise drew contours of the noise down the wall; three sheet steps a repeat in the joint layer tiled into ruled
  lines every 1.3 m; the layer's cracks were never drawn (a typed array drops a write at a fractional index); the top-
  down projection laid joints like straw on 45 degree slopes.
- **Slabs and wedges on the faces** (cliffs.js). The texture cannot break a silhouette or throw a shadow, so over
  every face past ~55 degrees (the 1 m ground over +-4 m and the 5 m heights over +-6 m past 48; none on vegetated
  ground below 62) a 15 m lattice per 30 m cell places a group of instanced, flat-shaded slabs shaped by the rock's
  pattern: granite big facets (sheets and buttresses 8-25 m along, 12-40 m up, 2-6 m thick, heavy-tailed, edges near
  the joint sets, one in eight on the diagonal set, roofs as wedges one in five, a second sheet further out on a third),
  bedded rock as tilted beds, blocky rock as cubes. Each slab is pushed back along the normal until nine points of its
  back face are 0.25 m inside the ground (the vertical gap times the normal's y, exact for a plane), so no gap shows and
  the heightfield is not edited (the brief asked for the mesh to be displaced toward the blocks; seating the blocks in
  the ground does the same with no change to the terrain, its footing or the fine and micro meshes); a slab standing
  under 0.4 m or over 7 m out is dropped. Drawn with the terrain's cliff material and a per-slab tone (one in six the
  pale rock of a recent fall), casting into all three shadow cascades with back faces. Cached per cell, rebuilt every
  150 m of camera travel in 2.5 ms slices into staging arrays and swapped whole; within 800 m every slab, to 2.2 km
  the big ones, the small ones thinned by a per-slab hash; no per-frame allocation. The first pass laid 30 slabs of
  2-10 m in a cell: from below the faces read as paving, each slab a dash of shadow; few big facets read better.
- **The rims, measured and left as they are.** On the 5 m heights the rims are already near the grid's limit: the
  knee (the run from 2 m to 25 m under the plateau) is a median 14 m, about three samples, and the edge's position
  wanders a median 2.5 m RMS over 40 m along the rim (p90 6.3 m; 189 rim points) - not 10 m. At El Capitan's rim the
  plateau sample is at 2147 m and the next one down at 2107 m. Two rules for an edit on the decoded heights were built
  and measured (each sample at a knee snapped from rim-averaged profiles: raised to the plateau line, which widened
  the knee from 23.5 to 24.5 m where it fired and built lips on domed plateaus; and snapped to the nearer of the
  plateau and face lines, which narrowed it from 14.0 to 13.5 m), then lighting steep ground by its triangle's own
  normal (under 1% of pixels changed by more than 8 levels, and those showed the 10 m mesh as slivers down the walls).
  None was worth shipping; nothing of them is in the client. What softens a rim is the 10 m mesh drawing a 14 m knee in
  one or two triangles; the slabs break the rims' silhouettes within a few hundred metres.
- **Measured** (GPU timer query round each render, alternating the states, p10 of 24, 1920 x 1200, Yosemite at 15:00):
  see the table in the report row of this branch. Texture units: the terrain's programs stay at 15; the slabs' at 7.
  The micro patch's program asks for 17 (three.js warns "Trying to use 17 texture units"): that was so before this
  branch (counted at the start, before any edit) and is not changed by it.
- **Not done or not verified**: the slabs from 600 m and further read as small rectangles, not yet as the wall's own
  big geometry; the near-vertical faces of El Capitan are still one smooth surface at a kilometre (the haze at 15:00
  takes most of the contrast); talus at the foot of the walls is the rocks module's as before (nothing new placed where
  the slope breaks); the slabs are drawn only (animals and the player stand on the heightfield under them); the frame
  times in the pane are noisy (load average 13-19 from other lanes), so only the GPU-timed numbers are reported.

## 2026-11-02: the rabbits rigged: a lagomorph skeleton, the half-bound hop on the leg engine (branch claude/rabbit-rig)

Aaron: "Can you run a rigging pass on the rabbit". The brush rabbit and the black-tailed jackrabbit swung rigid boxes on
the part rig (template R: the fore pair against the hind pair, a chest that pitched, a lift added to the body). They
now join the quadrupeds on the leg engine with a gait set of their own; `docs/movement.md` "The rabbits" has the gait.

- **The same rigger, a lagomorph path.** `tools/rig_quadruped.py` rigs a template R file whose species is in
  Lagomorpha: twenty joints as the quadrupeds' (the legs in the same places, so the engine, the shader's live rows and
  the bake need nothing new), the tail chain's three slots given to the two ears and the scut. The drawn crouch is read
  as it stands: the hock is the heel and the foot bone the whole long foot lying flat; the hip behind the stifle. The
  legs are weighted along their bones, not by height (the sole and the shank overlap in height); the haunch and the
  upper arm by distance to the upper bone, the bottom of the haunch (it rests on the heel) with the shank. The ears are
  found where the head splits into two above the crown. Free: no Meshy credits; the source FBX on disk had ear bones,
  but rebuilding from it would have changed the meshes the lineup signed off.
- **Ears and scut as carried joints.** An ear's pose is its parent's matrix times its own rotation (skel.attach,
  st.loc), so it swivels about its own length, which the bones-from-positions writer cannot express.
- **The gait set by the order.** The tree's Lagomorpha node carries `hop` and Lepus the observation hop; the engine
  takes the hop path when the row has it (or the skeleton is a lagomorph's). Below Froude 1 the shuffle, above it the
  half-bound; the turn on the hind feet; the pose's sign is the sit-up (above 0) or the crouch (the freeze at -0.6,
  the form at -1). Two things the quadrupeds did not need: the body *lurches* at a forage (the hindquarters wait over
  the planted hind feet, then hop up after the chest), because a rabbit's slow hop is not a steady glide and a steady
  body with a 62 % hind stance dragged the feet far behind; and the shuffle's stride is held within the body's length.
- **In the world.** The AI's states map to the engine's pose and ears (`animals.js` lagoInput: the form, the freeze
  with the ears back, the sit-up, a bolt with the ears back and the brush rabbit's scut up); the drawn body stays on the
  ground (the AI's bound lift and rock are the engine's now); the zigzag stays the AI's. Live within lod1 (20 m, 40 m),
  the baked set beyond. **The player's rabbits keep the rodent controls** (Shift sits up, X is the brush rabbit's new
  freeze and the jackrabbit's form) and are drawn on LegsBody with the hop: the brief said rig `quad`, but that would
  have brought the quadrupeds' stalk, bed and feeding controls, which a rabbit has none of; the engine is chosen by the
  model's legs as for the quadrupeds and the set by the row.
- **Measured.** The engine costs 9 us per live rabbit a frame in node (the fox 9 us); in the world the AI update's
  median was 0.5 ms with 17 rabbits drawn and 4 live (their pool writes 0.08 ms a frame), main's 0.5 ms at the same
  spot and hour (load average 15-28 from other work; 122 and 30 frames). No new texture unit; the only "17 texture
  units" warnings are the terrain micro patch's (`terrainMicro`), on main as well (the cliffs entry above). No new
  console errors (counted over a live jackrabbit bolt and the player's freeze and run).
- **Not done or weak.** The numbers are first guesses by eye (the lean, the lurch, the flight, the duty at speed, the
  ears); at full stretch the pale belly and inner thigh show where the skin stretches as the hind legs extend; the far
  tier has no observation hop and no ears' swivel; the vole and the ground squirrel still bound on the part rig.

## 2026-11-03: static files are an allow-list (server.py static_allowed)

- **Why.** The architecture review (`docs/architecture-review-2026-11-03.md`) found that the server served the
  whole repo root with directory listings, and the Fly volume is mounted inside it: `https://wild-earth.fly.dev/data/hub.sqlite`
  answered 200 (the accounts, friends, groups and group chat), and the dev server answered `/.env`.
- **What.** Only `client/`, `viewer/`, `library/`, `tiles/index.json` and each tile's folder (not its `game/` or
  `unreal/`) are served; no path segment may start with `.` or `_`; `scratch/` only when bound to loopback (the
  browser harnesses); no directory listings; `/` redirects to `/client/`; `log_error` is silenced (it printed the
  client address and raw request line). `tests/test_static.py`; all 32 server tests pass.
- **Not done.** The rest of the review's server hardening (the real client address behind Fly's proxy for the rate
  limits, socket timeouts, byte-capped send queues, a scrypt semaphore, the game socket's Origin check).

## 2026-11-03: a drag steers in flight again; it orbits when still (client/src/flight.js steering)

- **Why.** Aaron: for birds in flight and the spirit, the mouse drag "used to change the flight path of the avatar.
  This was lost when we shifted the pivot position. Lets return it."
- **What.** `flight.steering()`: the spirit always, and a bird in the air that is not hovering, steer by a drag as
  before the orbit (the head then the body by `turnLook`, the flight's pitch); standing, perched, hovering, or as a
  walker or climber (`flight.ridden`, set by main.js each frame from the ground, squirrel and woodpecker controls) the
  drag orbits the camera round the body. The orbit's hold timer only counts orbit drags, so a steering drag lets an
  old orbit ease back behind. The raven's, the fliers' and the spirit's help lines say so.
- **Verified** by dispatched drags in the viewer: flying, yaw +0.7 and pitch +0.1 with the orbit untouched; hovering
  and ridden, the orbit took the drag and the heading stayed; the spirit hovering, yaw +0.7. Not tried by hand with a
  mouse, nor the woodpecker's own flight (it keeps the orbit).

## 2026-11-03: food shown by diet, and the eat reaches the food (acorns.js eatsAcorns; animalModels.js eatReach; gait.js reachDip)

- **Why.** Aaron: "Right now acorns are seem to be visible to all players of all animals. Each animal should only see
  fruits they can harvest/eat. For all animals, there should be a more dramatic eating/gathering animation - for
  instance a quail's head should lower all the way to the ground."
- **Food by diet.** The acorn game drew its acorns, their glows, the stash holes, the granary and stash tags and the dug
  marks for every body. Now `acorns.js eatsAcorns(games, code, season)` decides from the tile's `games.json`: a gather or
  cache game on `acorn_mast` that season, or a `relations.forage` row for an oak's `acorns` (the library's `eaten_by`);
  a tile with no games falls back to the collector bodies. On the home tile in fall that is the raven, deer, fox,
  coyote, bear, gray squirrel, ground squirrel, woodpecker, both quails, both jays and the turkey; not the hawk, vulture,
  lion, rabbits, vole or lizard. In winter the jays, woodpecker, squirrel, mountain quail, turkey and deer. A body that
  does not eat them this season neither sees them nor picks them up (`collecting`; the squirrel's and woodpecker's E
  says "not your food this season"). The other food was already by diet: the forage glow and the plant scents
  (`relations.forage`), carrion's glow (`relations.scavenge`; everyone still smells a carcass, a smell is not food).
- **The shared state is untouched (evidence).** Only the drawing follows the body: the meshes sit in a `food` group
  whose visibility is set per body and season, while `refresh()` still fills `liveAcorns` and `liveStashes` every
  rebuild, and those are what the AI collectors (animals.js, on the host) and the squirrel's and woodpecker's controls
  read; `world.picked`, the stashes, granaries and caches change only by events. Measured as a brush rabbit under the
  oaks: `food.visible` false and 2,530 live acorns in the set. An acorn in an AI collector's bill or mouth is still
  drawn (`carriedNuts` stays outside the food group): it is the animal's, not food lying about.
- **The spirit sees no food.** It eats nothing, the forage and carrion glows already showed it none, and the open
  world reads better from the air without a thousand glows; a body is how one sees as an animal.
- **The eat's reach, three rigs.**
  - *Leg engine* (fox, coyote, lion, bear, both rabbits): a flick of 1 was a fixed 0.9 rad dip that left a fox's nose
    30 cm up. `gait.js reachDip` scans the neck-and-head dip for the least that puts the nose `EAT_CLEAR` (2.5% of the
    hip height) above the terrain under it, and when the neck is too short lowers the forequarters (`st.eatDrop`, the fore
    legs bending under planted feet, at most 0.6 of the leg). Above a flick of 0.5 it blends to that reach; below, the
    old dip (a stalk's low head is unchanged). In node, standing on flat ground at flick 1, the nose ends 9 mm (fox),
    14 mm (coyote), 18 mm (lion), 20 mm (bear), 4 mm and 7 mm (the rabbits) up. The far tier gets a baked `Eat` frame
    (`tools/bake_gait.mjs`), taken standing at a flick over a half (`farDrive`). Re-baking also refreshed the other
    clips, which were older than the engine (a bake of HEAD's engine matches the new bake's rows byte for byte).
  - *Part rig* (the quails, turkey, jays, ground raven, vole, ground squirrel, gray squirrel, hawk, vulture): a flick
    past 1, to 2, is the eat. `animalModels.js eatReach` solves per model from its own geometry: a ground bird leans
    its body forward over its feet about the hips (the least lean, 0.2 to 0.8 rad, with its breast kept off the
    ground, at which a head turn of at most 1.6 rad reaches), then turns its head down about the base of the neck
    (`rig_eatHead`); a bird still short crouches the rest on its legs (`rig_eatDrop`, the turkey, whose HEAD part is the
    head alone); a rodent turns its head only, and sitting up keeps the old dip to the forepaws. The quail's bill ends
    3 mm up (lean 0.35, head 1.48), the mountain quail 2 mm, the jays 3-6 mm, the vole 2 mm, the ground squirrel 4 mm,
    the gray squirrel 16 mm; `r.eat` on each model says how far. `animals.js carryPoint` follows it (`eatTurn`), so an
    acorn stays at the bill. Flicks to 1 keep their old dip, so a perched jay's glance or a squirrel's tail flick on a
    trunk is as before.
  - *The deer's clips*: the source's Eating clip held the muzzle 19 cm up. `tools/bake_clips.py` gains a clip
    `reach` (the recipe's `"Eating": { "reach": { "about": "Neck1", "head": "Head", "to": 0.03 } }`): each frame's neck
    turned further down in proportion to how low the source already holds the head there, bisected so the lowest
    frame's muzzle is 3 cm up (28 degrees at that frame); the source's own lifts to chew and look keep their height.
    Only the Eating rows change; the buck shares the texture.
- **Driven by the eat, not a timer.** The AI's feeding states set the reach: the quails' and turkey's pecks, the jays'
  probing, the ground raven's pecks and its stabs at carrion, the vole's clipping, the ground squirrel's seeds, the gray
  squirrel's pick and dig (`EAT_PECK`, the peck's `eatK`); the deer's graze and the canids' and bear's sniffing already
  drove a flick of 1, which now reaches. The player (`groundControl.js`): while E's act runs where needs.js finds the
  body's food under it (a gather resource scoring at least 25, or a named food plant) or a carcass it feeds on, a bird
  pecks faster with each peck to the ground and the head held low between, a rodent keeps its nose down nibbling, a
  quadruped holds the full reach; E with no food is the old shallow dip. The squirrel's own pick and dig, and the
  fliers' pecks and the hawk's mantle (`flierControl.js`), reach too.
- **Verified** in the viewer (8790) against main (8781), close-up montages from a scratch camera
  (`scratch/eat_harness.js`, `scratch/eat-captures/`): the player quail leaning and pecking to the ground (main: a 30
  degree dip in the air), the deer grazing with its muzzle in the grass (main: 19 cm up), the brush rabbit's nose to
  the ground, the gray squirrel's nose to the acorn and carrying it, an AI quail of the covey pecking to flick 2; as a
  rabbit no acorn or granary tag drawn, as the deer, squirrel and quail they are; as the spirit none. The 32 server tests
  pass. **Not done or weak:** the AI deer herd was not caught mid-graze on camera (it shares the player's clip); the
  fox, coyote, lion and bear reach was measured in node, not filmed; the quail's head folds close to its breast (the rig
  turns the head part, it has no neck to stretch); the turkey crouches to reach; the woodpecker (procedural) and the
  player's raven (RavenFlight) are unchanged; the lizard's food is insects, which nothing draws; holding E still runs
  the act for the species' `act.t` per press.

## 2026-11-03: the rabbits dig, and the underground view sees through the ground (docs/game-dig.md, branch claude/rabbit-dig-xray)

Aaron: "Rabbits should also be able to dig holes for themselves. When a vole or other rodent digs underground, the
camera should stay where it is but the ground/outside should become semi-transparent, and the hole becomes visible as a
glowing channel that the animal is in." Decided:

- **Each rabbit digs what it digs, sized to its body, through the same channel.** `dig.js` DIGGERS: the brush rabbit a
  short burrow (6.5 cm tubes, 2.54 cm/s, to 32 cm, X at its end digs an 11 cm nest), the jackrabbit a scraped form (a
  pit of kind `form`, to 15 cm radius and 7 cm deep). Rejected: one hole for both (a jackrabbit does not burrow); a new
  event type for a form (a pit already persists, decays, opens tunnels and is drawn; `digworld.py` only had to keep
  `k`). A body goes down only a hole that fits it, so a rabbit never squeezes into a vole's tunnel; a vole goes down a
  rabbit's.
- **Past the biology, said plainly.** The brush rabbit digs no burrow in life (Chapman 1990: it "occasionally uses
  burrows made by other species, but does not dig its own"); it digs one here because Aaron asked, kept short and
  shallow, a cottontail doe's nest cavity drawn out. The jackrabbit's form is the biology (forms a few centimetres
  deep, Tiemeier & Plenert 1964), round rather than oval because the pits are round.
- **The AI on the host.** A brush rabbit settled by day goes down a burrow that fits within 2 m or, with no hole within
  3 m, three times in ten digs one and lies up in its nest; bolting, it makes for a burrow within 6 m not past the
  danger. A jackrabbit scrapes its form as it settles into it (or uses one within 30 cm again). Caps: two diggers at
  once, 40 holes, 30 forms in the world.
- **The fore feet dig on the leg engine.** `gait.js` hopStep takes `inp.dig`: the chest low, the head down, the fore
  feet in turn reaching to the ground and raking back under the chest at 4.5 Hz, curled on the way forward; the hind
  feet planted. A burrowing body's legs stand on the tunnel's floor (`dig.floorAt` for the player's, lagoInput's floor
  for the AI's). Kept to one input and one block so the eating lane's edits to the same function merge.
- **The underground view: a second pass, not a transparent world.** The chase camera stays above (framed from the
  ground over the body, a little higher); after the world's draw a full-screen quad dims the outside toward the soil,
  the depth is cleared, and layer 5 draws the player's body, the tunnels within 10 m as an added rim-lit glow (the
  dirt's own buffers, a cheap shader, the union by the same neighbour test) and a glow at every other animal
  underground. Rejected: making the terrain, grass, trees and rocks truly translucent (every material, sorted blending,
  and nothing below the ground to see but the tunnels: the dimmed overlay looks the same); drawing the AI's pools in
  the pass (an instanced pool cannot draw only its buried members, so they are glows); keeping the camera inside. Cost
  0.02-0.73 ms of GPU by pose at 1920 x 1200 (min to p10 over an empty pass, under load), under the 1 ms asked, where
  the view from inside cost 3.1 ms. Another player's body underground is flagged buried in its sample, so it is no
  one's prey and a glow in this view.
- Found and fixed in passing: an AI digger dropped from the population stayed in the dig's list and held a digger's
  slot for good; a room dug round the body left the tunnel step holding a replaced position object.
- **Not done.** Another player's body underground as a glow was not looked at (the coyote's pit from below was: red
  over the channel, the opened stretch glowing toward the vole);
  the glows are discs, not bodies; a mirror's jackrabbit does not show the scrape.

## 2026-11-03: cliffs from the substrate: each rock breaks its own way, the slabs gone (branch claude/cliff-substrate)

Aaron, on the 2026-11-02 pass: "there is also heavy 'square' artifacting ... There aren't that many types of rocks on
earth. We should know from rock/soil data what the substrate is ... Slate/shale will make a crumbly surface with lots
of edges. Granitic substrate will result in big surfaces with cracks. There should be a pipeline for rendering these
cliffs and steep slopes and analysis during the ground creation step to determine where large patches of exposed
substrate area." And on a granite dome: "this was an earnest attempt to add geometry, but it is too regular for a cliff."

- **The square artifacts, each traced to its source** in the viewer by switching one thing off at a time at the same
  pose (Half Dome's north-west face from 1.2 km on `utm11n_267_4175`; slopes near the start on `utm10n_680_4280`):
  1. *The grid of rounded-square dark blotches on the dome*: the cliff material's bulge field, a value noise on an
     axis-aligned lattice (rnoise with angle 0) at 28 m in (h, 1.3 y), differentiated over 2 m and multiplied by 12
     into the lighting normal. A value noise's gradient carries its lattice, so the face was lit in rounded squares on a
     28 m grid. It went with the tilt alone switched off; it stayed with the slabs, the cast shadows and the canopy off.
  2. *The rectangles stuck on at random angles, and the rectangular cast shadows*: the slabs of cliffs.js (boxes and
     wedges, 8-25 m sheets and 2-6 m beds), each a flat-shaded rectangle; the bedded ones, stacked 1-2 m apart in 2-4
     thin boards, are the "stacked boards".
  3. *Pale parallel strips and large flat planes up close*: the made bedded layer (24 beds a 2.5 m repeat, hex-tiled in
     cells of ~3.75 m, each cell's strips turned its own way) and the sheeted layer's 7 vertical cracks a 4 m repeat,
     which read as straw at a few metres.
  4. *Rounded squares where a slope sits near the threshold* (found on this pass, also in the 2026-11-02 rule): the
     cliff weight took its slope from the 10 m detail mask, bilinear, so a smoothstep over 42-55 degrees drew 10 m
     squares on the faces at the edge of the rule; and the hold-off on vegetated ground came from the 30 m canopy and
     habitat cells, the same at 30 m. Not the shadow maps: the blotches stayed with csmStrength 0.
  Not a cliff source, recorded for the record: on the home tile the steepest slate "faces" are the US-50 road cuts and
  an erased quarry, and the new rule leaves most of them as photo (little exposed rock there).
- **Substrate in the pipeline** (`pipeline/substrate.py`, build step `substrate`; tile-spec "Substrate and exposed
  rock"). Each geology unit goes to one of ten lithologies (granitic, slate/phyllite/shale, schist, greenstone,
  sandstone, basalt, volcanic, serpentinite, limestone/marble, surficial), by rock class and, where that is too coarse,
  by name: Yosemite's Talus and Till units were `other` and got the blocky cliff; they are surficial now (no face).
  Each lithology carries its morphology: form, facet sizes at three scales, elongation and its axis, tilt, the share
  of edges that are open joints and of edges that step, joint width, talus, colour. Orientations from the data: the
  fabric's strike from the geologic contacts (length-weighted doubled angles: N4W for the home tile's slate, R 0.68;
  N11W schist; N50W Franciscan sandstone in San Francisco), the joint sets from the strikes of the DEM's faces past 55
  degrees (Yosemite granite N47E and N77E; N42E and N12E on the next tile), dips by default (the maps carry none).
- **Exposed rock at ground creation** (`client/substrate.png` R, 5 m): steepness (the 5 m DEM and the 1 m lidar's
  slope), bareness (lidar tree and shrub cover, or LANDFIRE EVC), the humans-erased NAIP (grey or pale and not green,
  relative to the photo's own canopy green; dry grass is pale but yellow, roofs and roads are erased first), convexity,
  the soils' Rock outcrop share, none on surficial deposits; and the bare slabs at any slope (LANDFIRE barren). Patches
  are connected runs over 0.5 with their size in B. Yosemite: 12.9% exposed, 107 patches over a hectare, the largest
  2.7 km2; the home tile 0.2%, three over a hectare (its rock is under oak and grass or in road cuts). Built for all
  seven tiles (about 8 s each, no fetch).
- **The faces drawn from those layers** (terrain.js CLIFF_GLSL). The client folds the substrate into the 5 m roads
  texture (R the road weight, G exposed rock, B lithology, A patch size; the terrain programs have no free texture
  unit). Where the exposure passes 0.15-0.45 on ground past 34-48 degrees (the mesh's interpolated normal, not the 10 m
  mask), the face is painted as its lithology breaks: cellular facets at the lithology's three sizes, elongated along
  the dip (granite's vertical joints, basalt's columns) or along the fabric's trace on the face (the face's normal
  crossed with the fabric's, so a slate face shows the strike the contacts gave); each facet its own plane, bending
  smoothly into its neighbour where the edge is no open joint, a crisp joint and a groove on the lithology's share of
  edges. Granite: 46 m facets over 110 m tall, few long joints along the elongation, a soft grain within a few metres,
  the exfoliation arcs only on faces past ~60 degrees; slate: 4 m, 1.1 m and 0.3 m plates, nearly every edge a joint
  or a groove: a crumbly face of small edges. On gentle rock the facets go on the ground plane, along the first joint
  set. Every noise is on a rotated lattice; the lithology's contacts wander +-7 m rather than step along the 5 m
  texels; the canopy's 30 m sky occlusion is not laid on rock. On a tile without the substrate step the 2026-11-02
  rule chooses where (pattern from geology.png) with the new material.
  The cells are baked once (groundDetail.js cellLayerSteps, a layer of the detail array where the two joint layers
  were): a Voronoi diagram of 32 x 32 jittered seeds on a torus, per texel the facet's and its neighbour's id bytes,
  the edge's normal, and the distance to the edge signed by the pair's order, so a filtered read crosses zero on the
  edge (the unsigned distance drew the grooves as dashes; the nearest texel's ids alone stair-stepped them). The
  shader turns, stretches and offsets the diagram per scale and plane, so its 32-facet period never lines up. The
  first version searched nine hashed cells per scale and plane: about five times the 2026-11-02 material's cost.
- **Removed**: cliffs.js (the slabs and wedges) and the two made joint layers of the detail array (groundDetail.js
  slots 5 and 6, cliffLayerSteps). Geometry is not replaced on this pass: the facets are in the shading only, so a
  rim's silhouette is the mesh's (see below).
- **Mistakes on the way, each seen in captures**: vertical-plane facets on a 50-degree dome flank stretched into
  zigzags (the ground plane added); the exfoliation arcs, lips and lichen as functions of height drew contour lines on
  gentle flanks (arcs only past ~60 degrees, lichen on the face plane); every cell edge drawn as a joint made a mosaic
  of flat tones at 300 m and a mesh of scratches at 9 m (open-joint and step shares per scale; bends elsewhere); a
  second exfoliation set at an even 22 m read as rows of dashes; slate's first big facets (5 by 16 m, turned 26
  degrees) shaded as rounded rectangles in a row on the home tile's face (big tilt 10, elongation 2).
- **Measured** (GPU timer query, 1920 x 1200, the terrain drawn alone, cliffOn 1 against 0 at the same pose, one render
  per query and 150 alternating samples, p10; longer queries were swamped: another Chrome on the machine was running
  the game, and load averages ran 8-15): Half Dome from 1.2 km +3.6 ms (main's 2026-11-02 material by the same
  protocol +1.7), El Capitan from 330 m +2.3 (main +2.6), El Capitan 9 m off, the whole screen three scales of rock,
  +8.3. The terrain alone with the material off read 2.2-4.0 ms. The previous lane measured main's material at +0.4
  to +1.0 ms as whole frames on a quieter machine, so this protocol reads high; by the ratio this material costs about
  what the last one did at mid range and twice it at a distance. **Not verified: well under 1 ms.** The close-up
  (+8 ms here) is the one to cut first, on a quiet machine: the third scale and the second plane near the player.
- **Not done**: geometry (silhouettes, cast shadows from the facets); talus at the foot of the faces from the
  lithology's `talus`; rocks.js's outcrop forms are still from the rock class; the dips from data (the maps have no
  attitudes); the patch size (B, A in the client) is carried but nothing reads it yet.

## 2026-11-03: the cliffs' cost brought under main's (branch claude/cliff-substrate)

The orchestrating session held the substrate cliffs for their cost (+8.3 ms at 9 m off El Capitan, +2.3 to +3.6 at a
distance): "find the cost first ... cut by on-screen footprint ... measure on a quiet machine ... within about 0.5 ms
of main's material at all three poses".

- **The timer was reading other work.** ANGLE/Metal's TIME_ELAPSED query also counts GPU work still queued from before
  its begin: renders issued back to back read each other's time (the first pass's one-render queries, and rounds of
  states issued in one task, gave orderings that made no sense: a cheaper state slower than its superset). The
  protocol now (`scratch/cliff_diag.js` __gpuAB, __cliffFinal): per sample the state is applied and rendered once
  untimed, a fence (fenceSync) waited on so the GPU is idle, then K = 8 renders inside the query, its result waited
  on before the next; states alternate in rounds; the terrain drawn alone, with the fine mesh hidden (it follows the
  player, who spawns in different places: one page drew it at a pose and the other did not). Medians with
  interquartile ranges of 0.1-0.3 ms on a machine still busy (a video call, other sessions' viewers, load 9-13).
- **Where the cost was** (terms switched off one at a time, and the material compiled with the cliff code stubbed
  out): (1) the code's mere presence: the cliff path's registers weighed on every pixel of the terrain program, cliff
  or not, 0.9 ms at Half Dome, the nested loops (scales inside planes) and the two planes' sums the most of it; (2) the
  second projection plane: the facets and sheets evaluated twice on any face turned between the axes (most of Half
  Dome's north-west face), 1.35 ms there; (3) at 9 m the ground's own detail (four or five noises, three or four
  detail-texture fetches) computed under rock that then covered it, 5 ms of the close-up; (4) the facets themselves,
  about 1 ms for the big scale and 0.6 and 0.25 for the finer ones close up; the sheets 0.5, the grain 0.1.
- **What changed**:
  - One projection plane per pixel, the one the face faces most, chosen with two octaves of rotated noise where two
    face it alike, so the boundary wanders off the slope's contours; the boundary is drawn as a joint. (One loop over
    the planes and scales together was tried: the slate came back as it was, the register weight did not: 0.9 ms.)
  - The elongation axis per plane from the lithology's fabric (the plane's normal crossed with the fabric's) or the
    plane's vertical, never from the pixel's normal: with long plates the old axis drew zigzag bands and contour rings
    (the lattice slid metres when the normal turned a degree, the 2026-11-02 lesson again).
  - Each scale's numbers packed in two uniform vectors read inside the loop; the scales' rotations constant.
  - The ground's detail skipped where the rock is whole (cliff weight > 0.99), decided before it.
  - Chunks with no exposed rock (exposure under 0.15 or ground under 28 degrees over the chunk and two texels round it)
    drawn by a second program compiled without the cliff code (`NO_CLIFF`): 46 of the home tile's 100 chunks, 3 of
    Yosemite's.
  - The sheets only past ~55 degrees (they were computed and multiplied by zero below).
- **The slate's look.** The first pass's slate owed its fine horizontal striations to the second plane seen nearly
  edge-on: a projection stretch, the smear this work set out to remove. With one plane the 47-degree slate face showed
  a mosaic of flat-toned plates; the cleavage is now drawn on purpose: the foliated rocks' finer plates thinner (slate
  1.6, 3.2, 4.8 times as long as wide; schist and serpentinite less), the slate's plates turned less (5, 10, 9
  degrees) and toned less (0.06), schist's and serpentinite's softened likewise (`pipeline/substrate.py`
  LITHOLOGIES; substrate.json rebuilt for the seven tiles, the PNGs unchanged byte for byte). The home tile's slate
  cleavage strikes N4W, so on that east-west face its traces are steep: steep plates with many joints, where the
  first pass showed horizontal streaks. Granite looks as it did; Half Dome's flank lost the faint contour marbling.
- **Measured** (1920 x 1200, terrain alone, fine mesh hidden, median ms per render, two interleaved rounds each; main
  is d2587bf, the branch's parent):

  | pose | main off | main | branch off | branch | branch - main |
  |---|---|---|---|---|---|
  | Half Dome from 1.2 km | 2.16 / 2.19 | 4.75 / 4.69 | 2.50 / 2.38 | 4.10 / 4.28 | -0.65 / -0.41 |
  | El Capitan from 330 m | 1.58 / 1.58 | 3.57 / 3.59 | 1.95 / 1.94 | 3.86 / 3.74 | +0.29 / +0.15 |
  | El Capitan 9 m off | 3.64 / 3.63 | 6.69 / 6.97 | 4.20 / 4.35 | 5.23 / 5.24 | -1.46 / -1.73 |

  Main's material costs +2.0 to +3.3 ms over its off state by this protocol at these poses (the "+0.4 to +1.0" of the
  earlier lane was whole frames at other poses); the branch's +1.0 to +1.8. The branch's off state is 0.35-0.7 ms
  above main's on Yosemite: the cliff code's registers in the rocky chunks. On the home tile's grassland (looking
  north over rock-free chunks) the branch reads 1.85 ms against main's 2.43, and at the slate face 3.17 against 3.44.
- **Not done**: the cliffs are still not "well under 1 ms" in absolute terms; neither was main's material. The next
  cuts, if wanted: the big scale's facets at a distance (a facet over ~100 pixels could shade from one texel fetch
  without the edge work), and the register weight in rocky chunks.

## 2026-11-03: rocks cluster: groups and gaps, rockfall talus below the faces (client/src/rocks.js)

Aaron: "Rocks are looking better, but they are spaced too evenly - rocks should cluster together - if there are rocks
nearby they should be even closer together or further apart." His shot: Yosemite near Mirror Lake, stones of every size
at near-uniform spacing over a slope and up the lower face of a granite wall.

- **Why the spacing was even** (`scratch/rock_cluster.js`: pair correlation, Clark-Evans, quadrat counts, plan maps).
  The stones were already clustered at the scale of a few metres (Clark-Evans 0.4-0.5, pair correlation 4-10 under
  4 m: each boulder's halo, each cell's tight groups), but the groups themselves tiled the ground: every 30 m cell at a
  given outcrop likelihood or soil fragment share got the same rate, 1-3 groups and its outcrop masses at a centre
  jittered a quarter of a cell. Pair correlation was flat (about 1.3) from 8 m to 64 m and under a third of 30 m
  squares were empty; on Half Dome's apron the plan shows the outcrop masses on a 30 m lattice. Near Mirror Lake the
  outcrop likelihood is 0 and the stones came from the soils' fragment share ("other" and alluvium cells: rounded
  knobs) and the water system's beds, spread evenly over whole soil units, the steep bare slab included.
- **What it is now:**
  - Float and outcrop-cell boulders: a Neyman-Scott process. A Poisson number of groups per cell (so many cells have
    none), each of a heavy-tailed size (3-40), a Rayleigh scatter round a point anywhere in the cell; the rate under a
    ~90 m log-normal patchiness. Outcrop groups follow the same patchiness (about two outcrop cells in five bare, the
    rest with a few more masses) and sit anywhere in their cell.
  - Rockfall talus from the substrate step: each 30 m cell with bare rock past 40 degrees is a source; its share is
    traced down the steepest neighbour through the fall zone (ground past ~35 degrees, where nothing rests) and comes to
    rest over the runout (Lr = 15 m + 0.12 x the drop, faster on flat ground), a fifth to each side so the deposit
    widens into a cone. Mapped surficial deposits that the photo shows bare on 20-40 degrees count as talus too. The
    stones fall in groups stretched down the slope, sorted by the runout (fines at the apex, blocks at the toe, bigger
    at a lobe's foot), in the fallen rock's class: granite blocks with a quarter flat slabs; slate fewer and platy.
  - On bare granite under 30 degrees (dome backs): an erratic now and then, groups of flat exfoliation slabs.
  - Resting: no loose stone (float, talus, halos, bed cobbles and boulders, bank gravel) on ground past ~40 degrees or
    on bare bedrock past ~30, and no outcrop mass on bare bedrock past ~35 (the cliff material draws that rock: the
    granite "domes" there read as droplets stuck to the slab).
  - The talus field is computed once per tile when the first plan is made (82-87 ms on Yosemite, during the load).
    Every placement is still a hash of the cell; every mode draws the same streams.
- **Measured** (radius 200 m, stones of 0.4 m and up; main = 1369e80):

  | window | rocks / ha | empty 10 m squares | empty 30 m squares | pair correlation 0.5-1 / 4-8 / 16-32 m |
  |---|---|---|---|---|
  | Half Dome NW apron, main | 187 | 0.59 | 0.30 | 4.9 / 2.7 / 1.4 |
  | Half Dome NW apron, new | 31 | 0.89 | 0.56 | 13.2 / 5.5 / 1.1 |
  | west of Mirror Lake, main | 31 | 0.84 | 0.42 | 11.7 / 7.0 / 2.1 |
  | west of Mirror Lake, new | 23 | 0.90 | 0.67 | 27.3 / 11.1 / 3.0 |
  | home slate slope, main | 28 | 0.89 | 0.51 | 79 / 11 / 2.2 |
  | home slate slope, new | 19 | 0.94 | 0.70 | 143 / 37 / 1.3 |
  | talus below the north wall, main | 15 | 0.93 | 0.77 | |
  | talus below the north wall, new | 99 | 0.75 | 0.49 | 15.6 / 8.8 / 2.9 |

  Whole Yosemite tile (census): masses 81,401 -> 54,645, boulders 754,245 -> 623,872, pebble-tier stones 6.38 M ->
  4.37 M, cells with a boulder 57,213 -> 36,414. Drawn at the poses: Half Dome low 3,903 far masses and 295 boulders ->
  1,643 and 59; from above 3,130 masses -> 1,242; the talus fan 1,012 masses and 180 boulders -> 255 and 899 (the
  boulders now where the rock fell). The rocks' GPU time (terrain with and without them, fenced timer queries) read
  within its noise of main's at the talus poses (0.1-0.2 ms) and lower at Half Dome (0.13 against 1.2 at the low pose;
  quartiles span +-0.5 ms on this machine). Main's home grassland window: empty 30 m squares 0.30 -> 0.62.
- **Not done**: the water system's bed stones still follow its channels, and the rewilded hydrology lays channels and a
  pond basin on Half Dome's apron (its bed stones are now kept off the steep slab, the basin ring is the terrain's);
  the talus is traced on the 30 m grid, so a cone's outline is coarse; the remaining knobs on the apron's gentler back
  are the outcrop rule's (L from the pipeline).

## 2026-11-04: going down a hole is easy, the body crawls and fits the bore

Aaron: a hole's entry reach should be about 1.75 times the hole so a body running for cover gets in; the avatar walks a
few steps in; underground the rig crawls so the body never leaves the tunnel; the entrance and mound glow like the
channel. Chosen: the reach measured from the body's front (centre to nose), not its centre, so a run ends nose first in
the hole; the walk-in as the tunnel's own forward key for three half-lengths, so the tunnel's branching and dig rules
need nothing new; the crawl as an input of the rabbits' hop step; and, because the drawn brush rabbit is taller and
wider than its 6.5 cm burrow even crawling, the body drawn narrowed and lowered to the bore from measured crawl sizes.
Rejected: widening the brush rabbit's burrow (every dug burrow is persisted at its radius, and 6.5 cm was set from the
animal's real width); a per-frame fit from the skinned pose (the bones are posed on the GPU; a measured size per species
is exact enough with a margin). The openings join the underground pass rather than glowing from above, as asked.

## 2026-11-04: the home screen redesigned: the places on the left, the earth as a map, choosing, inviting and starting (branch claude/home-map)

Aaron's spec: the list of places on the left and the social panel on the right; the list sorted by "Most Active
(global)" on landing and "Most Active (visible)" once the earth is moved like a map; a search box that finds any place
on earth; "basically an OpenStreetMap version of the globe that the user can zoom to"; a choice flies to a 10,000 ft
view with the tile outlined and a card over it (the name, the players' avatars and how many, opening the list of
them); a loading bar at the bottom with Invite and Start over it; Invite asks groups or people, an acceptor's avatar
appears and their client loads the same tile; players start on their own; a joiner arrives in spirit form behind and
above the one who asked. Built in `client/src/title.js` (rewritten), `mapGlobe.js`, `mapTiles.worker.js`, `mvt.js`,
`geocode.js` (new), `multiplayer.js`, `arrival.js`, `main.js`, `hub.js`, `title.css`, `social.css`, `hub.py`.
Decided where the words left room:

- **The map is OpenFreeMap's vector tiles, drawn by us.** OpenFreeMap needs no key, sets no limit and allows any use
  with the attribution (shown bottom left on the screen, and in the credits panel and the README); its tiles are
  OpenStreetMap's data in the OpenMapTiles schema. A small Mapbox Vector Tile reader (`mvt.js`, no dependency) and a
  module worker (`mapTiles.worker.js`) draw each Web Mercator tile on a 512 px OffscreenCanvas in the home screen's
  night palette (land, landcover, parks, water; rivers, borders, roads by class; the names of places, waters and
  peaks, each kept only when wholly inside its tile so nothing is cut at a seam), overzoomed past z14 from the z14
  data, and send an ImageBitmap back. No buildings and no points of interest. Rejected: tile.openstreetmap.org's
  raster tiles (a globe asks for many; the tile policy asks for light use), CARTO's and Stadia's (non-commercial
  or keyed), Esri's (keyless use not clearly permitted), and MapLibre GL (a bundled library with its own GL context;
  its globe would not share the page's one renderer or the spirit earth under it).
- **The map is draped on the globe, which stays the spirit earth from space.** `MapGlobe` picks the tiles each frame
  from a quadtree refined largest-on-screen first (a tile splits past 400 px; at most 120 drawn; culled by the
  frustum and by an angular horizon test), each a 16 x 16 grid on the sphere positioned at its own centre for
  precision; a tile not yet drawn shows its ancestor's picture at most two levels up (further up a name would be
  drawn huge over the ground), else the earth's own picture under it. The Blue Marble earth is drawn at 0.996 of the
  radius under the tiles, and the map covers it by half from space and wholly below ~100 km (`mapMixFor`). 72
  pictures are held at most, the least recently drawn let go. Beyond the Mercator limit there is no map.
- **The camera looks at a point from an altitude, tilting and widening as it comes down.** The earth turns so the
  point faces the camera (yaw and pitch, as before); the camera stands `alt` earth radii from the point, straight
  down from space and tilting north toward the horizon (to 54 degrees) with its lens widening (38 to 55 degrees)
  between ~190 km and ~6 km, and the camera's view offset keeps the point in the middle of the space between the list
  and the social panel. A drag moves the ground under the pointer (longitude by the latitude near the ground, a
  globe's turn from space), with inertia; the wheel zooms toward the pointer (the point under it re-solved each
  frame while the zoom eases); 600 m to 3.6 radii.
- **"A 10,000 ft view of the region".** A tile is 10 km square, wider than a 3 km straight-down view shows, so the
  chosen view is 10,000 ft over the ground just south of the tile, looking north across it at the full tilt: the
  tile's south edge just above the bar, its north edge high in the view with the card over it; its south corners
  run off the sides (seen from that height they would). The flight there arcs higher with the distance flown.
- **The sort's two modes.** On landing every place is listed, the most active first: "Most Active (global)". The
  first drag or wheel by the player lists the places on screen instead: "Most Active (visible)". The flights the
  screen makes itself (a choice, a search inside a built place) keep the mode; a search elsewhere is a move by the
  player and switches. A small button by the heading switches back ("show all") or forward ("in view").
- **The search asks Photon, not Nominatim.** Nominatim's policy forbids search as you type; Photon (komoot's
  OpenStreetMap geocoder) is built for it and asks for fair use, so the box asks after a 450 ms pause, with three
  characters or more, one question at a time (a newer one aborts the older), and keeps this page's answers so a
  backspace asks nothing; the page's origin goes as the Referer (a browser cannot set the User-Agent). The words go
  to Photon alone, never to our server, and nothing is stored. The built places matching the words are listed first
  ("Wild places"), then "Anywhere on earth". A result inside a built tile chooses that tile and makes the found point
  the arrival's; anywhere else the earth flies there (the altitude from the result's extent or kind) and a pin
  marks it.
- **The card names only who the player may know is there.** The hub sends strangers' whereabouts to no one outside
  a tile's room, so the players' row shows the friends and group members the hub's presence puts in the tile, the
  people this player invited (asked, on the way, here, not now) and, for a joiner, the one who asked them, by name and
  avatar; the rest of the hub's count are anonymous wisps ("2 other players wandering here"). No new hub message was
  needed for it.
- **Invite is a button now, and it can name people.** Lane 4 asked the group along on every choice; now a choice
  only builds the world, and Invite opens a picker of the player's groups and friends (online first). The hub's
  `place` takes `to: [user ids]` (friends or fellow group members, not blocked; 1 to 16) with or without a group, each
  person asked once (`tests/test_hub.py` test_invite_people). One `place` goes per ticked group and one for the
  people not in a ticked group. A switch from the Location box in a world still asks the group along as before.
- **Each player starts on their own.** Join on the earth chooses the place (quietly) and its world starts building;
  the joiner presses Start when they want (lane 4 began it by itself). The inviter's card shows the joiner on the way,
  then there.
- **Behind and above, always.** When the inviter is already in the world, the hub hands the joiner their last
  position on entering the room and the arrival follows them as lane 4 built. When the inviter has not entered yet,
  the joiner's arrival now ends 10 m behind and 6 m above where the inviter's own arrival will end (`Arrival.plan`'s
  `behind`: the inviter's planned arrival as a still lead), so the inviter flies in to find them there, rather than
  both ending at the same point. Verified both ways with a scripted second player: 10 m behind along the inviter's
  heading and 6 m up, hovering, in spirit form.
- **The bar follows the build's steps.** `main.js` tells the screen each step's name (`w.next`), and the screen
  weighs the steps by their usual time; within a step the bar creeps toward the step's end without passing it.
- **The card's animal lineup is gone from the home screen.** The new card stands over a map and names the players;
  the tile's animals arriving round a big card (Aaron's refinement of 2026-11-01) would cover the map. `CardLineup`
  is unchanged for `?cards=1`.
- **The social panel is the right column.** On the home screen it opens on sign-in under the friends row, top right,
  the sign-in modal stands where it will be, the chat sits bottom right and the Video and Audio toggles beside the
  friends row (the top middle is the card's); in a world they go back where they were and the panel closes once.
  A row's hover actions are an overlay now (they took their width while hidden and squeezed the name to nothing).
- **Fixed on the way:** three.js sorts a Group's children by the group's own renderOrder ahead of theirs, so a
  renderOrder on the map's group drew it over the outline and the dots; the hub tests sign up from one address and
  passed the per-address limit with one more test, so the test server allows 40.

Not verified: two real browsers (the second player was a script over `tests/wsclient.py`), touch, narrow windows,
Safari (OffscreenCanvas in a worker is Safari 16.4+), a lost WebGL context on the home screen, the frame cost of the
map (about 120 draw calls at the chosen view), and the map's look beyond the foothills, the Bay, Yosemite and Mount
Fuji.

## 2026-11-04: voice and video with the group, and the controls row

Aaron: "Lets redesign the ingame menu. First, lets move the audio toggle up into the row with video and microphone"
and "If the user is in a world with no other users, video and microphone should disappear." Built as lane 5 of
`docs/multiplayer.md` (its Built note has the whole of it). Chosen:

- **One row beside the menu button** (`index.html #ctlRow`): the sound toggle (sound.js, still N), then the
  microphone and the camera (`client/src/voice.js`), then the self-view while the camera is on. The old greyed
  Video and Audio toggles top middle (`#media`, "soon") are gone, and the friends row now stands right of the
  controls row (multiplayer.js layout). The mic and camera show only while another member of the player's group is
  in the same world, and "in the same world" is the hub's position relay (a `pos` within 6 s): the hub relays
  positions only to group members in the same tile room, so the row needs no new presence. Alone again, they go and
  are turned off with the devices let go: a hidden toggle left on would be a mic the player cannot see.
- **A WebRTC mesh** (to about six) with the hub as the signalling relay: one new message, `rtc` {to, tc?, k: sdp |
  ice | state | bye}, relayed under the positions' rule (the addressed group member, the same room, no blocks), to
  one connection of theirs (the `tc` named, else the tab that entered the room last) so a member with two tabs
  answers once. Its own token bucket (a mesh's candidates come in bursts). Perfect negotiation (the lower user id is
  polite); the mic and camera toggles replace a sender's track rather than renegotiate. Rejected: an SFU now
  (LiveKit is the next step past six); the media through the hub (it must not hold media at all).
- **Voices in the world**: Web Audio, an HRTF panner at the member's wisp or body (inverse distance, 6 m
  reference), on a talk bus of the soundscape that the volume and mute cover; the context stays running in a hidden
  tab while anyone is heard (the soundscape itself stays silent there), so a friend is still heard after alt-tab.
- **Video modest**: 320x240 at 15 fps, capped at 300 kb/s per sender; the tile is scaled by distance and turns into
  the edge avatar off screen (two video elements on one stream rather than moving one between parents).
- **ICE**: public STUN (Google's and Cloudflare's) by default; TURN from env (`TURN_URL` with `TURN_USERNAME` and
  `TURN_CREDENTIAL`, or `TURN_SECRET` for coturn's time-limited credentials) handed out in the hub's `welcome`, over
  the signed-in socket, not in the public `/api/hub/config` (an open TURN credential would be anyone's relay).
  Peers see each other's IP addresses through ICE; the docs say so. No accounts made; what Aaron needs to set up is
  in `docs/multiplayer.md` "TURN".

## 2026-11-04: the menu under the X: Settings, Exit to main screen; the data panel on the right

Aaron: "The current data panel should have its text size decreased so that it can fit underneath the admin panel on
the right. Remove "PERCEIVES" and subsequent text from admin panel. Have a way to exit to the main screen underneath the
X, and also a "Settings" page. Move the current admin panel into that area." Read as: the data panel is `#hud` (the
readouts), the admin panel is `#panel` (Location, Start game, Hover, Present day, sound, Texture, Season, Time of day,
Forest detail, Perceives), and "underneath the admin panel on the right" is where the admin panel stood, since the
admin panel itself moves into Settings. Chosen:

- **The data panel** stands in the right column under the mini-map (`top: --mapH + 24px`, 230 px wide; 212 on a narrow
  window), at 11.5 px rows with a 1.3 line height (11 px narrow); at 1280x800 it is 322 px tall and does not scroll; on
  a short window it scrolls above the body's row (layoutHud caps it as it capped the panel). Its title row wraps so the
  tile id and the Data link never run off the edge.
- **Perceives** is gone from the page and the code that wrote it with it (main.js showPerceives); the perception matrix
  still drives the animals (animals.js setObserver).
- **The menu under the X** (`#menuList`): Settings, then Exit to main screen, shown while the menu is open.
- **Settings** (`#settings`): a card top middle holding `#panel` itself, every control with its id and handler as it
  was. The X closes the menu and Settings with it (Settings is part of the menu); Esc or the card's x closes Settings
  alone. Rejected: Settings as a full page replacing the view (the time of day and the season are adjusted while
  looking at the world).
- **Exit to main screen** (main.js exitToTitle): the hub's room left as a tile switch leaves it, the world torn down by
  disposeWorld as a second choice on the earth tears one down, and the title screen made again over it through the same
  constructor and hookup as at the start (`openTitle`, `mp.attach`), facing the tile last played: the session's
  sign-in is known, so the earth rises lit with no sign-in; choosing a place builds a world as at the start. The direct
  paths (?skip=1, ?game=1, ?as=) have no title in the page: Exit loads the page without them. Found in doing it: the
  world's teardown drained its observer's pending records without the filter that skips the screen's own nodes, so a
  title rendered in the same task as the teardown was swept as the world's (fixed: one `record` for both); and a
  played world stays the listener scope, so the new title's key guard was recorded as the world's (the scope is let go
  before the title is made).


## 2026-11-04: what a tile costs is measured, not guessed (tools/token_meter.py)

Aaron asked for a token meter or cost estimator, "to get a sense for what a fresh tile actually costs". The cost has two
halves.

**The Claude half: `tools/token_meter.py`.** It reads the transcripts Claude Code already keeps under
`~/.claude/projects/<checkout slug>/`, including every subagent's. It sums each request's usage once, by requestId. A
forked session's copied history counts only for its parent. Usage is priced at first-party API rates per model.

- With `--since` and `--until` it prices any time window, which is how a pipeline stage's Claude work is priced.
- With `--worktrees` it covers the lane worktrees too.
- On the orchestrating session it gives $2,065.73 where Claude Code's own `cost-state` record says $2,069.76.
- The dollars are API-equivalent. On a subscription they say what the work would cost, not what is billed.

**The machine half** belongs to the pipeline runner (the pipeline and registry lane). Per step and stage it records, in
`tiles/<id>/cost.json`:

- wall and CPU time;
- bytes fetched per source, and cache hits;
- disk written;
- the bytes a player downloads to enter the tile;
- Meshy credits spent or queued;
- each stage's start and end, which the token meter prices.

**The one earlier data point.** The first build of `utm10n_680_4270`, on 2026-10-25, used every species and step that
already existed. It took 59 minutes and $5.35 of Claude (an Opus agent, 84 requests), with no Meshy credits. That was
before Lidar crowns and the Sentinel seasons were in the pipeline. The capability around it cost far more, for example
about $90 of agent work for the 17 foothill species' files and generator.

On disk a tile is 0.5–0.9 GB with its sources, and a player downloads 32–67 MB of client layers.

## 2026-11-04: the wind moves leaves, then limbs, then trunks, by its speed

Aaron: "light breezes flutter the leaves. Medium breezes make the leaves move a lot but also start pushing around the
branches, extreme winds push the trunks". The Beaufort scale's land column says the same:

| Speed | What moves |
|---|---|
| 2–5 m/s | leaves rustle, then move constantly |
| 5.5–8 m/s | small branches |
| 11–14 m/s | large branches |
| 14 m/s and up | whole trees |

Before this change, every tree motion grew with `windStrength` together and stopped growing near 11 m/s.

**How the speed is read.** `windMs()` reads the speed back from `windStrength`, so no new uniform is needed and the
console tuning still works. Three smoothsteps over `WIND_TIERS` (`treegen.js`) then drive three motions:

- **Leaves, 0.3–3.5 m/s.** The flutter, the shimmer and a quick 2.2–3.5 Hz flutter of each spray. They are fully
  moving by a gentle breeze and never move faster after that.
- **Limbs, 4.5–12 m/s.** The crown's slow wave and each spray's own swing.
- **Trunks, 9–19 m/s.** The whole tree's lean and rock. A 12 m tree's top bows about 0.8 m in a gale's gust.

In a gale the mid-distance crowns and trunks bow as well, so the far forest moves; before, they never moved. The shadow
casters use the same functions, so shadows follow.

**Measured** on the home tile from 25 m up, as the mean pixel change over half a second with time and wind pinned:

| Wind | Mean change | What moves |
|---|---|---|
| 3 m/s | 0.53 | nearly all leaf flutter |
| 8 m/s | 1.71 | sprays four-fifths of it |
| 20 m/s | 5.11 | trunks as much as sprays |

Not changed: shrubs, grass and the far impostors (past about 900 m, where a 1 m lean is a pixel).

## 2026-11-04: fruit on the plants, glowing near the body (client/src/fruit.js, branch claude/fruit-glow)

- **Why.** Aaron: "For each edible fruit, render a small version of it. Whenever a plant has fruit, show that fruit
  glowing around the plant just like we do for acorns. Fruits/nuts should become visible only when I'm close to a plant."
- **What counts as an edible fruit is the data.** Every part of a woody plant that a record's `eaten_by` names as
  berries or seeds: the berries of thirteen shrubs (toyon, common and whiteleaf manzanita, coffeeberry, creek dogwood,
  chaparral currant, Sierra gooseberry, California rose, California blackberry, blue elderberry, snowberry, poison oak,
  wild grape) and the seeds of five trees and shrubs (black walnut, bay nut, big-leaf maple's samaras, buckbrush and
  deerbrush capsules, redbud pods): 19 kinds (`fruit.js KINDS`). The acorns stay the acorn game's (acorns.js, untouched).
  Not drawn: the herbs' and grasses' seeds (forbs.js and the sward already glow for them, and they are too many and too
  small to model one by one); the buckeye's, madrone's, spicebush's, buttonbush's and mountain mahogany's fruit, which
  the records show in the crowns but no animal's `eaten_by` names; pine nuts (no record has them as food yet).
- **A small procedural model per kind, one instanced draw each.** Built in code from ellipsoid blobs and thin stalks
  with vertex colours (`Builder`): a toyon's flat corymb of 16 berries, the manzanitas' little apples, a coffeeberry
  cluster ripening black from red and green, the dogwood's white cyme, the currant's and poison oak's racemes, the
  gooseberry's spines and dried flower tip, three rose hips with their sepals, blackberries of 16 drupelets each (one
  reddening), the elderberry's compound umbel, a grape bunch, the walnut in its green husk, the olive-like bay nut, a
  pair of samaras, three-lobed ceanothus capsules, flat redbud pods. Life size in the geometry, drawn larger (`SHOW_K`:
  2.2 on a shrub, 1.4 on the ground): life size, a toyon cluster was a red speck from three metres. No Meshy credits.
- **When a plant shows fruit.** In fruit when the species' `foliage.berries` shows this month (treegen.js `decoActive`,
  the same test that paints the berries into the crowns and the impostors), or, with no berries block, in the seasons of
  its `eaten_by` rows; and, as the acorns since 2026-11-03, only for a body that eats that part of that plant this
  season (the tile's `relations.forage`, or the library's `eaten_by` on a tile with no forage rows: Placerville's games
  predate them). The spirit and a body underground see none. On the home tile in early November a bear sees toyon,
  whiteleaf manzanita, coffeeberry and rose hips (the grape, elderberry and manzanita are past their months), the gray
  squirrel walnuts, bay nuts and samaras, a California quail toyon, whiteleaf manzanita, coffeeberry, rose hips,
  snowberry, poison oak and the ceanothus and redbud seeds.
- **Near the body only, faded.** The plants within `FRUIT_R` (16 m) of the body get fruit: the 3D shrubs and trees of
  vegetation.js `nearPlants` and the impostor shrubs of the shrub field's cached cells (forage.js's two sources). Both
  shaders scale the fruit and its glow by the distance from the body, full inside 10 m, gone at 16, so nothing pops and
  nothing is drawn for the tile. The CPU rebuilds the set when the body has moved 2 m or the plants changed (0.4-1.6 ms).
- **Where the fruit hangs.** On the crown's outline from a hash of the plant's place (the same toyon, the same
  clusters): the 3D shrub's ellipsoid from its drawn height and `crown_width_ratio`, the impostor's own dome (root +
  H/2, R across, H/2 tall), each kind in its band of the crown (grapes under it, elderberry umbels on top). A tree's nuts
  lie on the ground under its crown, as the acorns do. Rejected: a third of them in the low branches as the acorns'
  1.2-2.5 m, then in the lower crown; a walnut has no limbs at 2 m and its open, leaning crown left nuts in the sky; the
  crowns already paint their own nuts into the leaf cards.
- **The impostors' card.** An impostor shrub writes the depth of a flat card pulled toward the camera from its crown's
  centre by 0.6 R, not its dome's: fruit on the dome's sides was behind the card and hidden. Each fruit on an impostor
  carries its plant (`aPlant`: centre, R) and slides along its own view ray to just in front of the card (which keeps its
  place on the screen, its size scaled to match); one on the far side of the dome is dropped.
- **The glow is the acorns'.** The same billboard (a wide halo with a small hot core, additive), one per cluster or
  nut, sized to it, tinted between the fruit's colour and the acorns' amber (a toyon's red-orange, a walnut's
  yellow-green), level 0.42 (`fruit.k` scales it live). First at 0.7 with a bigger halo: overlapping halos on a toyon
  blew out to a yellow wash.
- **Cost.** No texture (the 16 units are full); attributes: the fruit 9 of 16 (position, normal, colour, instance
  matrix, instance colour, aPlant), the glow 8. One draw per kind in fruit near the body plus one for all the glows: +2
  draws for the bear by the oak, +4 with every kind forced on. Frame (1280 x 800, readPixels after each render, 100
  each way, load 3.8): p10 31.0 / 31.3 ms on / off, median 33.0 / 33.2; with every kind on 32.4 / 32.0, 33.9 / 33.8;
  the update 0.007 ms. Within the noise.
- **Verified** in the worktree's viewer (8801) with captures from an own camera: on the home tile a bear at a toyon
  impostor (red berry rings round the shrub, soft red-amber glow), the same camera with the bear 30 m off (no fruit, the
  toyon only its painted berries) and beside it (toyon and coffeeberry sparkling), the chase camera at the toyon and by
  a valley oak (the acorns' glow under the oak, whiteleaf manzanita flecked with berries beside it); the gray squirrel
  under the walnuts (green husked nuts in the litter, glowing) and a bay laurel; on Placerville a bear at a toyon in
  shade (fruit from the library's rows). A lineup of all 19 models. No shader diagnostics, no console errors; the
  repeated "17 texture units" warning is main's (39 in 1.5 s with the fruit off and on alike).
- **Weak.** A toyon impostor's dome is drawn translucent by the field's own near fade, so its clusters read against a
  screen-door crown; the hanging clusters are placed on an ellipsoid, not on the 3D crown's twigs, and some sit inside
  dense leaves; fruit does not sway in the wind; nothing is eaten from it (E still feeds from needs.js); a bay laurel's
  crown hanging to the ground hides its nuts from outside; low-poly berries (20 faces) show facets within a metre.

## 2026-11-04: the fruit's Meshy models: the acorn and the rose hips (tools/build_fruit.py)

- **Why.** Aaron, through the orchestrating session: Meshy is allowed for the fruit, "whichever method reliably gives
  the best result": Meshy where a real shape and texture read at a few centimetres (the acorn and its cap, walnut,
  buckeye, pine nut or cone, wild grape, rose hips), the tiny clustered berries procedural; up to 200 credits; each
  model decimated to a few hundred triangles because they are instanced.
- **Generated** with `tools/meshy_generate.py` (the main checkout's copy, which reads the key from its git-ignored `.env`;
  `--out` into `library/fruit/jobs/<id>/`, a new jobs folder with the animals' ignore rules, job.json kept): five
  text-to-3D previews on `latest` (20 each) and three 2K texture refines (10 each): **130 credits** (balance 2,632 to
  2,502; 550 of the 1,000 spent in all, the ledger now `library/*/jobs/*/*/job.json`).
- **Adopted: the acorn and the rose hips.** The acorn (a slender valley oak acorn, the warty buff cap, the stem) replaces
  the acorn game's procedural nut (`acorns.js`, the nuts on the ground and in the branches and the AI collectors' carried
  ones), 160 triangles because the game draws every acorn within 300 m (2,400 by a valley oak: +190k triangles, the
  frame's p10 34.8 ms either way); its nut graded from the texture's saturated red-brown toward chestnut. The rose hips
  (three glossy hips with their dark sepals on a twig, flipped to hang) replace fruit.js's procedural spray, 360
  triangles. `tools/build_fruit.py` (Blender 4.1): import, orient, life size, origin where the client attaches it,
  collapse to the target (again until near it), and the texture baked into colours: each corner takes the texture at
  the nearest point of the full-detail surface a quarter of the way to its triangle's centre, vertices split only where
  corners clearly differ, so no sampler is drawn (POSITION, NORMAL, COLOR_0). fruit.js `fruitModel(id)` loads them once
  a page and swaps them in; the procedural models stand in until then, or if a load fails.
- **Rejected after generating.** The wild grape bunch (refined): at a few hundred triangles its 25 berries stalled at
  1,082 (non-manifold where they touch) or, voxel-remeshed, collapsed to a faceted lump; the procedural bunch (20
  triangles a berry) reads better and stays. The walnut preview came out furrowed like a shelled nut (a small pumpkin),
  not the smooth husk on the tree, and the bay nut a plain egg: neither better than the procedural ones, so not refined.
  Not generated: the buckeye and pine nuts, which no record names as food (so nothing would carry them), and the berry
  clusters (procedural, as asked). A first export drew the hips and the grapes as shards: the source is split at every
  UV seam and the weld was never written back (a line comment had swallowed the call), so the collapse made a soup.
- **The acorns near the eye (a fix in acorns.js).** The near shrink (0.3 of the size inside 6 m; 0.06 for a squirrel or
  woodpecker) and its settle (0.2 m) were tuned for the 70 cm nut of v1; since the nut went life size on 2026-10-27 they
  made it a 9 mm speck (1.7 mm for the squirrel) sunk 14 cm into the ground, so near the eye only its glow showed. Both
  factors are 1 now and the settle is the nut's own radius; seen with the Meshy acorn sitting on the ground at 15 cm.
- **Verified** in the worktree's viewer: a lineup of the models; the rose hips hanging round a rose with their glow; the
  acorn at 15 cm and 1.5 m under a valley oak (as the bear). No console errors, no shader diagnostics.

## 2026-11-04: water at the lowest point: every stream rerouted onto the 1 m lidar ground (pipeline/reroute.py, branch claude/water-reroute)

Aaron: "We have a LIDAR map. We have a map with water paths. Currently we are using the map of water paths to path the
water. This results in weird collisions. We need a step in the pipeline where the water is re-routed according to the
LIDAR maps - it needs to be at the lowest point, period."

What was there. The channels were already routed by gravity, not drawn from NHD (2026-10-25: D8 on the 5 m DEM, NHD
giving only names and permanence), but at 5 m: a reach is a chain of 5 m cell centres, smoothed, and its water level
the 5 m DEM along it. On the 1 m ground that line runs a metre to several metres off the thalweg. The new checker
(`pipeline/water_check.py`) measured it: on the home tile only 46% of the drawn samples had their ground within 5 cm of
the lowest ground across the channel, the water stood more than 10 cm above the ground beside it at 40% of them (the 5 m
level is a cell average, higher than a narrow creek's bed), and the level climbed into the receiving reach at 18
confluences (up to 2.5 m). The water step then cut a trench along the 5 m line, beside the dry creek: the "collisions".

Chosen: a `reroute` step between `rewild_hydro` and `water` that keeps the 5 m network's topology and attributes and
takes every reach's geometry from the 1 m ground (docs/tile-spec.md "Rerouting on the 1 m ground"): a corridor around
the network, priority-flood breaching on it from the network's outlets, flow directions and accumulation, nodes
snapped to the most accumulated cell, each reach the flow path between its nodes, the line centred on its
cross-section's lowest run. The level comes from the 1 m ground along the new line. Found on the way, each fixed:

- **Corridors touch.** In one union corridor a trace leaked over a low saddle into the next creek rather than cross a
  high road fill (one went 3.7 km into another valley; 56 of 379 home reaches failed). Each cell now belongs to its
  nearest reach and the flood crosses only between reaches sharing a node: the map's topology, enforced.
- **Tributaries meet the stream just under the node.** A trace that joins the flow path within 150 m below its node has
  arrived; one that meets the bigger stream above it stops there (the bigger stream owns the shared cells).
- **Road fills.** Under US-50 and the old highway the 1 m trace ran down the roadside ditch at the toe of the fill to
  wherever the crest was lowest, a rectangle around the culvert. Where a reach crosses an erased road (`roads.png`
  >= 128 grown 10 m) its 5 m line (which breached straight through at 5 m) is cut into the 1 m ground, graded and never
  rising: the culvert. 656 crossings on the home tile, the deepest cut 12.8 m. The raw ground there is still the fill,
  so the checker reports the same numbers away from the roads too.
- **The running minimum hangs on pits.** At 1 m every hole holds the level down for the rest of the reach. The level is
  now the profile's least-squares non-increasing trend (pool adjacent violators), kept 5 cm under the lower ground at
  the wet margin's edge, and a tributary ending under the water it flows into is raised to it.
- **Wiggles narrower than the ribbon.** Centring each vertex alone gave 4,866 sharp turns on segments shorter than the
  channel's width (ribbons fold there) and 4.3 times the vertices. The cross-section offsets are now median-filtered
  and smoothed along the line, the first smoothing scales with width, the simplification too: 793 sharp turns, 2.4 times
  the vertices.
- **The Merced's floor.** In Yosemite Valley the river's lidar surface varies about 10 cm across 40 m, and a 2 cm "lowest
  run" in a +-6 m window kept the line on the south bank. The window is now +-0.75 widths (to 22 m), the section smoothed
  across, the run's tolerance 0.02 widths (2-15 cm): the line moves to the middle of the floor.
- **Kept ponds.** A reach across a kept pond's flat water has no lowest line; its piece keeps its line (the pond is
  drawn there).

Results (`scratch/reroute/before_<tile>.json`, `after_<tile>.json`; before = the 5 m lines with the 5 m levels, as the
water step drew them):

| Tile | Bed within 5 cm of the cross-section's lowest ground | ... away from erased roads | Ground over the level by 1 m+ (clip) | Water over the bank by 10 cm+ | Level rising into the receiving reach | Shift from the 5 m line, median / p90 / max | Median distance to NHD |
|---|---|---|---|---|---|---|---|
| utm10n_680_4280 | 45.6% -> 88.6% | 46.4% -> 95.4% | 5.2% -> 2.5% | 39.8% -> 0.6% | 18 -> 0 (max 2.49 -> 0.0 m) | 1.08 / 5.515 / 29.9 m | 11.1 -> 11.3 m |
| utm10n_690_4280 | 40.6% -> 85.4% | 40.5% -> 93.2% | 2.4% -> 2.4% | 43.0% -> 0.4% | 13 -> 0 (max 8.73 -> 0.0 m) | 0.959 / 3.562 / 30.9 m | 11.0 -> 10.7 m |
| utm10n_680_4270 | 41.6% -> 91.3% | 42.0% -> 94.6% | 0.8% -> 0.6% | 45.2% -> 0.1% | 4 -> 0 (max 0.33 -> 0.0 m) | 1.112 / 3.212 / 36.0 m | 9.9 -> 9.8 m |
| utm11n_270_4180 | 35.0% -> 78.1% | 34.7% -> 78.4% | 3.5% -> 3.1% | 40.4% -> 0.4% | 8 -> 0 (max 1.0 -> 0.0 m) | 1.608 / 9.267 / 49.2 m | 10.2 -> 10.3 m |

Yosemite stays lower (78%) where the channel is a boulder field, a talus cone or a cascade on a cliff: no 5 cm
lowest line exists across a jumble of 2 m blocks, and the level is a trend through steps there. Every tile: no level
rising anywhere downstream. Snap shifts are small (median about 1 m); the large maxima are where
the 5 m line had cut a corner or crossed a fill. Reaches that fell back to their 5 m line: 0, 1, 1 and 2 of about 380.
The median distance to the NHD lines barely moves, and shouldn't: NHD is digitised at coarse scale, 10 m off the ground
either way. Water triangles in the client: home 125k -> 180k, Placerville 136k -> 190k, Yosemite 169k -> 257k (the lines
follow the ground's bends; the client takes a section at every vertex).

Seen in the viewer (port 8788, before/after at the same poses, captures in the shared notes folder
`reroute-captures/`): Hangtown Creek's ribbon that ran across a smooth slope now sits in the ravine; Weber Creek's lay
on the bank and now runs in the channel; Hunchup Creek (Placerville) followed the valley's side and now its floor; below
Yosemite Falls the outflow that ran off east of the plunge (the 5 m line's detour) now lands at the base. The falls'
finder still finds the upper fall (414 -> 422 m) and the lower (104 -> 102 m); the tile's falls 66 -> 57 (small steps
on the old line's corner cuts gone). No console errors, no shader failures.

Refused: `utm11n_267_4175`. Its `terrain/dem.tif` is the 3DEP seamless product, not the 1 m ground averaged (std of the
difference 13.2 m; 0.3 m on the foothill tiles, 1.0 on 270_4180), and its terrain_detail residual clips beyond +-5 m on
36% of the tile, so the client's ground there is not the 1 m ground. Rerouted, 29% of its bed cells' levels ran past the
+-2.54 m the level byte holds against the 5 m heights (1% before). The step now refuses such a tile; 267_4175 keeps its
5 m water until its `dem.tif` is rebuilt from `dem_1m.tif` (and every step after). San Francisco was not run.

Still wrong: the ground over the level by 1 m or more on 2-3% of samples. These are the fills themselves (the raw ground
is the road) and cascades, where the level is a trend through steps. The 1 m ground has no culverts, so a reach under a
19 m fill still drapes over it in the client (the carve stops at 2 m). The "after" captures on Yosemite were taken
before the hidden pane had streamed the sky and the plants, so only their water and ground compare.

## 2026-11-04: the chosen place as a relief model, and a Layers menu for the map's names

Aaron: "When the user selects a tile in the start screen is it possible to quickly render an exaggerated relief map
of the tile instead of the current flattened map tile? Also, we can remove place names from the globe, or its a
toggle under a Layers menu".

**The relief (`client/src/relief.js`).** On choosing a place, the home screen fetches three files the world then
loads anyway, so the browser fetches them once:

- `heights.png`, decoded at 192×192 with nearest sampling so the encoded heights stay whole;
- the tree cover: the Lidar's `canopy_height.png` G where the tile has it, else LANDFIRE's `canopy.png`;
- `water.png`, pooled at its own resolution into each cell's share of stream bed and pond.

From these it builds the tile's UTM square on the globe, every vertex at its own latitude and longitude. The inverse
UTM series is in the file and matches pyproj to 1e-7°. Each vertex is raised by its height above the tile's floor times
an exaggeration: 1,200 m over the tile's range, clamped to 1–3. The foothills (275–657 m on the home tile) stand 3×;
Yosemite (1,203–3,005 m) is drawn true to scale, so nothing reaches the 10,000 ft camera. Short walls drop to the map,
so it reads as a model standing on the map.

It is coloured as a relief map: dry grass to tan with height, rock above 2,200 m, snow above 2,900 m, forest green by
cover, blue water. It is lit by the title's sun plus a fixed northwest light. It fades in over 0.8 s, and out when
another place is chosen.

**Layers.** A Layers button above the attribution opens two toggles:

- **Town and city names:** off by default, since the world has no towns.
- **Water and peak names:** on.

The choice is kept per viewer in `localStorage`. `MapGlobe.restyle` asks for every picture again in the new style
(`mapTiles.worker.js` opts) and draws the old picture until the new one comes, so the map doesn't flash.

## 2026-11-04: the close layer: the last metre round a small body (branch claude/close-layer-ea5b16)

Aaron: "Is there an even better layer of detail realism we can achieve at <1m?", then yes to the plan. No survey data
exists below about half a metre (the home tile's lidar is 21 points a square metre, a 0.5 m ground at best under
canopy), so everything here is procedural, and each choice is conditioned on something real about the spot: the tree
overhead (its species, its crown, its age, whether it is a snag), the water system's bars, the season, the weather,
the north side, the tile's rainfall. Three commits, in the order asked.

**1. Litter and micro relief by the tree overhead** (`litter.js`, `vegetation.js` nearPlants gains crownR, trunkR and
snag, `terrain.js` MicroPatch.node). The litter ring already drew pebbles, oak leaves, caps, twigs and stems from the
ground texture's own material weights; its oak leaves were the cell's oak share, not the tree above. Now the near trees
are indexed on a 10 m grid and each 2 m cell lays the litter of the crowns that reach it (cover 1 inside 0.75 of the
crown radius, falling to nothing at 1.35 R + 0.5 m: the drip line, spread by wind; several crowns combine as 1 - prod(1 -
w) and a candidate takes one of them by weight):
- leaves from an eight-cell atlas at each species' size and colours (blue, interior and canyon live, valley, black oak;
  a lanceolate cell for bay, buckeye, willows, ash and walnut leaflets; an elliptic one for madrone, alder and
  cottonwood; a palmate one for maple and sycamore), fewer the bigger they are (150 a square metre at 4.5 cm);
- each species' month (`SEASONS`): the deciduous oaks, maple and walnut drop in October to December, the live oaks and
  bay in April and May, madrone its leaves in June and July and its bark curls (an atlas cell, rolled by the leaf's
  curl) in July to September, buckeye in July and August, the pines their needles in September to November; the fresh
  share (paler, flatter, the fall colour) peaks then, the rest is old grey-brown and curled;
- pine fascicles (three needles from a sheath, gray pine 20-30 cm at 350 a square metre, ponderosa 12-25 cm at 600;
  Douglas-fir and incense cedar short), cones (one procedural cone, 72 scales on the golden-angle spiral with
  apophysis, umbo and a hook the instance scales: a gray pine's 15-25 cm claws, a ponderosa's 8-13 cm prickles,
  Douglas-fir 5-9 cm, cedar 2-3 cm), acorn caps under the oaks in autumn;
- twigs, fallen branches with a side branch (0.08 a square metre under a crown, three times that under an old tree,
  five round a snag; bigger under both), and surface roots from boles past 12 cm (three to seven, more on an old tree,
  half buried, brown and soiled);
- rounded, water-worn pebbles (0.6-4 cm, 160 a square metre) on the water system's bars and on the dry bed and margin
  of gravel and cobble reaches, below the 5 cm stones rocks.js lays there.
Where no crown reaches, the old rule stays at 40 % (the duff under shrubs, the cover the raster sees but no near tree
carries); with no crown index yet, all of it. The litter darkens and deepens with the ground's wetness and hides under
lying snow. The crown cover gives the micro patch's litter relief its height (`tile.closeDuff`: up to 2.5 times the
2 cm litter amplitude, more under old trees and pines). Weak: the needles are a tone darker than real ponderosa duff in
the canopy's shade; the roots are straight tubes, and from a vole's 3.5 cm eye the fallen limbs under an old tree read as dark, smooth logs in deep shade (procedural furrows, no bark texture); nothing of this is drawn for a body of scale 0.6 and up (a deer), as
before.

**2. Bark up close** (`treegen.js` barkTextureSteps, trunkMaterial; `weather.js`). Checked first: the bark material
binds the colour map and the normal map; nothing here adds a sampler (the height goes into the normal map's alpha: a
DataTexture, since through a canvas an alpha under 255 premultiplies the normal away) and no attribute (the per-tree
offset and the foot height come from the instance matrix).
- Hex tiling: three taps at random offsets per cell of a hexagonal grid over the bark (1.6 cells a tile, offsets only, so
  the grain stays upright) and per tree, blended by the hex weights and each tap's height, sharpened so a seam is thin and
  plates do not ghost. The 0.5 x 1 m tile no longer repeats round an old trunk.
- Parallax within 1.5-2.5 m: the dominant tap marched along the view ray through the height field, 6 layers head-on to
  12 grazing and a secant step, to the species' fissure depth (0.018 m x relief x (0.3 + 0.7 fissure): 2.2 cm in a
  valley oak's furrows, 2 mm on a madrone), then 4 steps toward the sun, so a plate shades the fissure beside it. A cavity term darkens the sky
  light in the fissures at every distance.
- Moss on the north side and the foot of the trunk, in the fissures first, by the species' liking (from its lichen
  value, almost none on madrone, manzanita and sycamore), the tile's climate (its weather file's mean yearly rain: 300 mm
  none, 1500 mm full; the home tile 0.54) and the month (olive-brown and dormant June to September, green through the
  rains, green again within days of rain); crustose lichen in pale rosettes on the plates.
- Wet: the bark darkens and deepens with weather.js's ground wetness, the fissures darkest.
- First cut too dear: six 3D noise lookups for the moss and lichen cost about a millisecond with a trunk filling the
  screen; they share two now, the bark's own grain breaking them finer.
- Rejected: a close trunk tier of displaced geometry within 2 m. The parallax gives the plates their depth inside the
  silhouette; the outline still shows the polygon. Left for the squirrel's own lane if its climbing view needs it.

**3. Leaves and small life** (`treegen.js` leafMaterial, `closeLife.js`, `litter.js`).
- Leaf veins: the single-leaf level's broadleaves get a midrib and side veins pressed into their face as a normal detail
  within 6 m (vein pairs by leaf shape), faded as a vein falls under a pixel.
- Granaries: the acorn woodpeckers' storage trees are the acorn game's stash trees (`animals.js isStashTree`, now
  exported: one oak in eight, the woodpecker families live on them), so the holes are where the game's woodpeckers
  hammer. Within 25 m their bole is drilled from 0.6 m to the fork: 260 holes a square metre on an old tree or a snag, a
  third of that on a younger one, each holding an acorn by the month's share (85 % in autumn and winter, 30 % in
  summer) and at least as many as the game's granary holds. Each hole is cast out from the trunk's axis (the tree's own
  wood, treegen.treeWood) onto the near trunk's triangles and lies flush on the facet it meets, a decal with polygon
  offset; the acorn's blunt end a dome 3 mm proud. First tried as cups set on the stem's radius: on a polygon trunk they
  stood out of the facets by up to 5 cm at the silhouette.
- Galls: oak apples on valley oaks (3-10 cm) and smaller galls on blue oaks (1-3 cm) on the thinnest drawn wood, a third
  of the trees heavily galled, coloured by the month (fresh cream in spring, tan in summer, brown in winter, a quarter of
  them a year old and black).
- Fungi: a placeholder, off by default (`?fungi=1`, `Litter.fungi`): a data table (`FUNGI`) of brackets along fallen
  branches and capped mushrooms in troops in the oak litter, in the wet months. Stand-ins until the species and their
  seasons are researched.

**Cost** (GPU timer queries, a fence before each sample, 8 renders a sample, states alternated, medians; 1280 x 800 at
DPR 1.5; the machine shared, load 5-6; the whole frame is about 19-20 ms of GPU here):

| Pose | Whole frame, all on | ... without | Drawn alone (an upper bound: no early-z) |
|---|---|---|---|
| A vole under the valley oak (eye 3.5 cm) | 19.31 ms | litter off 19.17 ms (+0.14) | litter 0.73 ms (IQR 0.41-1.2) |
| A squirrel's eye on the granary oak's bark (12 cm off, 2 m up) | 19.86 ms | old bark, no granary, no veins 19.81 ms (+0.05, IQR 0.2) | bark 2.3-2.5 ms new, 0.7-0.9 old; granary and galls 0.32 ms (3,335 holes, 2,818 acorns, 45 galls) |
| The same oak from 3 m (no parallax) | | | bark 1.2-1.8 ms new, 0.5-0.9 old |
| Leaves from 3 m (leaf level, 2 M triangles) | | | veins on 3.6 ms, off 4.5 ms (within the noise) |

Drawn alone the new bark is two to three times the old where it fills the screen, but in the frame it hides under the
vertex-bound work: the whole-frame difference is within the noise at every pose measured. CPU: planning a 2 m litter
cell 0.84 ms (0.7 before; the 1.5 ms a frame budget is unchanged), a refill 0.7 ms; the granary layer's rebuild 2-4 ms
when the eye has moved 4 m near a granary (the first time a tree's holes are cast onto its trunk included). No shader
diagnostics (`renderer.info.programs`), no texture unit or vertex attribute added to any material but the litter's
own new kinds (needle, wood, cone and fungus 10 attribute slots each, of 16).

**Seen** in the worktree's viewer (port 8806) against main's (562409f on 8808) at the same poses, hour 13, the forager's
halos off: a vole and a brush rabbit under a valley oak, under a gray pine, in open grass (a dry bar) and at an old
valley oak granary; the bark at 12 and 25 cm and 2.5 m; galls with the foliage hidden. Captures in the shared notes
folder (`close-layer-captures/`). Not done: a real squirrel climbing (the squirrel's view was a camera on the bark);
other tiles.

**Found on the way, not this lane's:** the forager's food halos (forage.js) wash a translucent band across a vole's
eye view when one sits a few centimetres off the eye.

## 2026-11-04: Dig carves the soil instead of adding tubes (client/src/digCarve.js, digMesh.js; branch claude/dig-carve-0f9d58)

Aaron: "is there a way instead to "remove" from a polygon? ... The user "digs" which creates a joint between these two
surfaces, and then starts "removing" the polygon. Players will want to dig elaborate structures together." Chosen: the
soil as a signed distance field (the drawn ground and its spoil, minus the carved air: a round cone per segment, an
ellipsoid per room, a shaft per hole, a bowl per pit) meshed by surface nets in sparse 16 cm chunks in a Web Worker,
cells sized by the smallest radius in reach and uniform over a joined component so neighbours share their borders
exactly; the mouth is part of the field (the ground and spoil within 6 cm of an opening, the terrain's cut disc just
inside it, under the spoil), so ground and tunnel wall are one surface. The world model and its events are unchanged;
one digging rule was added on the existing `join` (a face reaching another system's node joins it), so two diggers'
tunnels that meet are one walkable system. The caps went from 1,500 nodes and 1,200 segments to 5,000 each.
Rejected: more neighbours in the old fragment-shader union (it can never know every capsule a loop or a crossing
brings near, and its discard turned the early depth test off); CSG on meshes (fragile on coplanar and tangent cases,
and the joins would need remeshing anyway); marching cubes (more triangles for the same cells, and its vertices on the
cell edges make a 3 cm bore faceted at 1 cm); dual contouring with QEF (sharp features are not wanted in soil, and
surface nets with one Newton step onto the analytic field are smooth and simpler); one cell size everywhere (a pit at
1 cm is four times the triangles of the same pit at 2 cm, and most forms and pits stand alone); a smooth minimum over
every primitive (it bulges a tunnel at every node by a quarter of the fillet: a plain minimum within a straight run).
The player's face between the 2 cm steps is a short cone of its own, so one or a few chunks are meshed each frame
(2.7 mm behind the drawn face at the real rate).

## 2026-11-04: the tile pipeline as one repeatable graph, and a species registry

Aaron: "OK, we need to work on our pipeline. When we create a new tile, we need to be going through all the steps -
and making sure the steps are repeatable so that we can accurately depict a tile anywhere on earth. When we create a
new tile, we need to generate all of the species for that tile if they don't already exist. This means we should have
a registry of species, or something like that, to keep track of which species have been created and what level of
fidelity that asset is at." The audit, the graph, the regions and the species side are in `docs/pipeline.md`.

- **A graph of steps with fingerprints** (`pipeline/steps.py`), not a list that runs every named step: a step reruns
  when its version, its modules' code, its parameters, an upstream output or a library folder it reads changes, or an
  output it recorded is gone. Rejected: timestamps (make-style), since a rebuilt upstream file with the same content
  would rerun the whole tail, and the tiles' files are copied between checkouts (mtimes mean nothing); and a version
  number alone, which nobody bumps (the audit found steps whose code changed after they ran on every tile). The code
  hash over-triggers on a comment edit; that costs a rerun, never a stale tile.
- **Fallbacks recorded where they are taken** (`pipeline/runlog.py`): a fetch module calls `runlog.fallback()` and the
  step's manifest record carries it. Rejected: return values threaded through every fetch function (twenty signatures
  to change for a record).
- **A failed step stops the build.** The old runner logged the failure and ran the rest, so later steps failed on missing
  inputs or wrote partial products and logged ok (the LANDFIRE outage loop failed erase on roads.png every round for two
  hours). `--keep-going` remains for a long build that should finish what it can.
- **The order fixed**, not documented around: substrate after erase and derive, lidar after osm and veg, crowns after
  derive; derive's mast written once acorn_mast exists.
- **The water lane's steps are folded in as they are** (`owner: water lane` on hydro, channels, rewild_hydro, water):
  their modules are untouched; the wrapper re-records the species mix that water rewrites in place. A new step from that
  lane (`pipeline/reroute.py` is in progress) is one entry in `STEPS`.
- **Anywhere on Earth: NASADEM, not Copernicus GLO-30**, as the global DEM: NASA's terms put no conditions on reuse;
  GLO-30's licence is its own (free, credit required, not CC). Only the DEM fallback is implemented; imagery (Sentinel-2),
  communities (WorldCover + RESOLVE ecoregions, both CC BY 4.0) and soils (SoilGrids, CC BY 4.0) are named in
  `pipeline/regions.py` as the next step, and a tile outside CONUS stops loudly at `naip`.
- **Plants are generated, animals are queued.** A plant species a tile needs is grown from a trait card
  (`library/plant_cards/`, `pipeline/plantgen.py`) on a template of its genus or family: the card holds only what makes
  it itself (heights, crown outline, colours by season, bark, habitat, relations, sources). Rejected: hand-writing every
  record (the 2026-10-25 foothill set took a day per ten), and a record per genus without species (red fir and white
  fir are told apart by bark and bloom, which a genus record cannot carry). Animals cost Meshy credits, so the registry
  lists the jobs with an estimate and never runs them.
- **Fidelity is scanned, not declared**: the registry reads what each asset has. A generated record is held at level 2
  until its card carries a lineup review, so a generated species is never reported as finished.
- **Elevation zones and a coast context over the existing rules**, not a rule set per region: LANDFIRE names the same
  "Cliff and Canyon", "Montane Riparian" or "Mixed Conifer" from 300 m to 3,000 m and on the coast and inland, and the
  foothill rules put blue oak and gray pine wherever those names land. A replacement table per band (and one for a
  coastal tile) fixes every generic rule at once; the communities with their own species (red fir, lodgepole, redwood,
  coast live oak, coastal scrub, Jeffrey pine, aspen, subalpine, alpine) have their own rules. The foothill tiles are
  unchanged below 1,100 m.
- **Giant sequoia by its GBIF groves**, not by a community (LANDFIRE has none): CC0 and CC BY records only (the mix ships
  to clients), three records within 700 m to count as a grove, since the Yosemite tiles' few records are planted trees.
  Neither Yosemite tile holds a grove (the Tuolumne and Merced groves are 15-20 km west).

Results (docs/pipeline.md, Proof): `utm11n_270_4180` rebuilt from nothing into a scratch folder matches the tile on disk
in 117 of 156 files (116 byte for byte); the rest is the water pass the tile never had, Sentinel-2 scenes and GBIF records
newer than the tile, and last year's weather. A second `--all` skipped all 22 steps. `utm10n_731_4235` (Calaveras Big
Trees) built by `--all` alone, stopping loudly at two real bugs (the first off-grid lidar tile chose an EPT project that
only overlapped by its box; a layer's file list) and resuming with the same command. The registry: 126 species, 76 at
level 4, 21 at 3, 29 at 2; 139 animals queued for Meshy (4,170 credits est., 580 left), none run. Yosemite and San
Francisco verified in the viewer before and after (captures in the session notes): the north rim at 2,100 m drew
foothill broadleaf woodland and now draws fir and pine; the Marin headlands drew uniform chaparral and now draw
flowering coastal scrub. Not done: the generated records' lineup reviews; the riparian rows and the ground layer at
elevation; a global vegetation source.

## 2026-11-04 (later): four stages, a cost meter, research first, and no California in the defaults

Four requests from the project brief, relaying Aaron: the pipeline in four stages (base, flora, fauna, games), each
runnable on its own and in order; no California assumptions, since the next test is two adjacent Olympic tiles from the
Hoh Rain Forest to Mount Olympus (ice, a full zonation in one tile, a shared seam), built by the brief's session after
the merge; a cost meter (time, downloads, disk, client bytes, Meshy credits, stage timestamps); and a species pipeline
that begins with research (the most populous species and every predator and scavenger, to at least the home tile's
density, assets by archetype, hand edits counted). docs/pipeline.md is rewritten around the stages.

- **Landcover in the base stage**, against the brief's list (which put LANDFIRE vegetation and habitat in flora): the
  imagery erasure, the substrate, the ground's outcrop and the terrain textures read it, and a stage may not read a later
  one. Rejected: moving erasure and substrate to flora (they are the ground, not what grows on it), and fetching LANDFIRE
  twice. Flora reads landcover for its species.
- **`derive` split** into terrain (base), species_mix (flora), resources (fauna) and games: one step that touched every
  stage could not be staged. Old names (`veg`, `derive`) still work with `--steps`.
- **Regions as tags, not rule sets per place**: every species-mix rule, substitution table, lexicon reading and range
  test carries the natural region it was written for (regions.NATURAL); a tile elsewhere does not match it. An
  unmatched community is read from its name, then drawn from the tile's own species of the same habitat class, and only
  in California from the foothill default; elsewhere a community nothing reads is drawn bare and recorded (a fallback and
  a hand edit). Rejected: a global default mix (it would be the foothills again under another name).
- **EltonTraits for diet and body mass**, not a hand table: 15,000 birds and mammals, CC BY 4.0 (Ecological Archives'
  default; not CC0, as the brief assumed), so every predator and scavenger GBIF records anywhere is found without a
  person. Thresholds: half the diet from vertebrates makes a predator (30 % called the Douglas squirrel one), a tenth from
  carrion a scavenger.
- **Generated animal traits are data, not species_data code**: `library/animals/traits/<id>.json` (diet, senses, size,
  locomotion from locomotion.py), for the registry and a later client; the curated `species_data.py` animals are
  untouched, and nothing new is drawn until a mesh is adopted.
- **The cost meter wraps requests in every process** (netmeter.py, through pipeline/__init__.py when a step sets
  WE_NETMETER_DIR): the lidar and Sentinel workers are separate processes. GDAL's own COG reads are not counted (no
  hook); their caches stand in. Claude's tokens are not metered here: the stage timestamps are joined to the transcripts
  by tools/token_meter.py, kept separate as the brief asked.
- **Seams checked, not fixed**: the seams step fails a tile whose DEM steps across a shared edge or whose stream of order
  3+ crosses on one side only. The two San Francisco cells pass (DEM step 0.108 m against 0.106 m inside). Making streams
  continuous is the routing's (the water lane): routing each tile with its neighbour's DEM as a margin.
- **Ice as a base product** (LANDFIRE Snow-Ice and OSM glaciers): bare in the species mix; its toes listed for the
  water lane's meltwater; no client material for it yet.
- **The Olympic species as cards only**: 20 cards (Sitka spruce, western hemlock, western redcedar, Pacific silver fir,
  subalpine fir, red alder, vine maple, black cottonwood, salmonberry, red huckleberry, devil's club, dwarf Oregon grape,
  thimbleberry, pink and white mountain heather, sword fern, deer fern, redwood sorrel, subalpine lupine, green fescue),
  checked in the lineup and then their records removed, so the Hoh build grows them itself (the automatic path the test
  is about). The forb atlas raised from 16 to 24 species so the ferns can be drawn. A generator fix found by them: an
  evergreen card on a deciduous template inherited its bare winter months.

## 2026-11-04: roots in the tunnels, eaten or pulled down (client/src/digRoots.js, the `pull` event)

Aaron: "showing roots hanging from the ceiling and letting players either pull the plant down or eat the roots."
Chosen: roots generated, not stored, from what already places the plants (the forbs' deterministic candidates, the
near set's trees and shrubs, the sward's species and density) wherever a ceiling passes under them within a rooting
depth set by kind (the library has none: fibrous grass to 45 cm or 1 m, bulbs and corms at their depths, oaks at any
depth a vole digs); drawn as instanced strands and bulbs with no sampler and three or four attributes. Eating goes
through needs.js unchanged but for its source underground (what is at the nose, scored by kind), so the hunger, the
E key and the food line are the surface's. Pulling is a world event by the plant's own id (`f:<i>.<j>.<k>`, a pure
function of the tile's habitat grid), kept per tile and season in the dig world as the acorn game keeps its state,
anonymous; a bulb eaten out is the same event with nothing left. Rejected: storing roots in the world (they follow
from the plants and the tunnels, and the shared state would grow with every metre dug); pulling grass clumps (they
have no ids: grass.js draws a field); a sampler for a root texture (the dirt's and the terrain's programs are near
their units, and a strand is too thin to show one); tying pulls to a tunnel system's decay (a plant pulled down stays
gone for the season, as a gopher's harvest does).

## 2026-11-04 (night): a part-lidar tile, and Overpass when every mirror is down

The Hoh test (the brief's session, on main: `utm10n_429_5293 --stage base`) stopped at lidar: "no 3DEP 1 m DEM project
covers utm10n_420_5290". In fact none of the tile's four product cells has a 1 m DEM: the Olympic Peninsula was flown in
2013, before the 1 m DEM program, and has only its point cloud (USGS_LPC_WA_Olympic_Peninsula_2013_LAS_2015, 21 G
points; about 65 % of the tile); Mount Olympus's tile has neither.

- **Fill, do not fail**: a cell without a 1 m product is the 5 m DEM resampled, marked in `dem_1m_source.tif`; a stage
  never fails because one block is missing.
- **Find the point cloud by its own collection** (TNM's LPC products over the tile), not through the DEM's project name
  (the old route: a tile whose DEM is missing never looked for its point cloud).
- **The ground from the point cloud** where the 1 m DEM is the fill: the ground returns' mean height less the DEM,
  smoothed over 2 m. Rejected: the 5 m DEM as the ground under the canopy (metres of error on the Hoh's valley walls
  become false canopy height).
- **Crowns where the point cloud is, the species mix beyond**: `client/lidar_cover.png` per 30 m cell, read by
  vegetation.js and impostors.js (crowns.js `crownCell`); the canopy raster filled from LANDFIRE beyond, so substrate,
  seasons, relief and the shrub counts need no change. Rejected: a crown tile treeless where the point cloud stops
  (what the client did), and scattering LANDFIRE trees under the real crowns.
- **No point in the tile is DEM-only**, not a failure (a collection's box overlapping Mount Olympus).
- **Overpass**: every public mirror was down at once (overpass-api.de and its lz4 and z servers 502, kumi and
  private.coffee timing out, mail.ru 504). The mirrors grow to six, a dead one costs 15 s to connect instead of 240,
  curl is tried only after a TLS failure (the reason it was there), and the mirror that last answered goes first
  (`pipeline/_cache/overpass_mirrors.json`). An outage still waits out the hour's budget; the next step, if outages
  recur, is the OSM API's map call for a rural tile (0.25 square degrees, 50,000 nodes) as a last resort.

Tested on utm10n_429_5293 in the worktree (base, then flora). Base: every step ok in 36 min.
- **lidar** (20 min): the 1 m DEM is 0 % products and 100 % the 5 m fill. The point cloud
  (1.34 G points, 29,885 nodes, 9 GB streamed) covers 56 % of the tile.
- **The ground and the datum**: the point cloud's ground corrects the fill on 55 % of the tile. That needed one more
  fix found by the test: the collection is ellipsoidal, 21.26 m below NAVD88 here, so the correction subtracts the DTM
  check's offset. The first run lowered the DEM by 21 m and clipped 55 % of the terrain detail; after the fix the
  detail's residual has a mean of 0.016 m and a std of 0.47 m.
- **Crowns and the client**: 207,433 crowns where the point cloud reaches. The client draws the mix's trees beyond
  them, and the forest runs unbroken across the edge.

Flora: 4 min.
- **The mix**: western hemlock 32 %, Pacific silver fir 29 %, Douglas-fir 19 %, western redcedar 6 %, Sitka spruce 4 %
  and red alder 4 % over red huckleberry, dwarf Oregon grape, vine maple and salal; sword fern 37 % and redwood sorrel
  34 % of the ground. No foothill species.
- **Grown with no hands**: 13 Olympic species, from their cards (the records were not kept, so main's build grows them
  again).
- **Hand edits: 32.** 30 trait cards for species GBIF ranks on the tile, and 2 communities read from the tile pool:
  "Rocky Mountain Subalpine Mesic-Wet Spruce-Fir" and "Southern Vancouverian Lowland Ruderal Grassland".
- **The tree target is not met: 12 of 21.** A temperate rain forest has fewer tree species than the foothills; the
  target was the foothills'.

Cost: 9 GB downloaded (the point cloud). A player downloads 58 MB to enter the tile.

## 2026-11-05: streams continue across a tile seam; meltwater from the ice (pipeline/water_seams.py, branch claude/water-reroute)

The project brief, from the seams step on the two Hoh tiles (`utm10n_429_5293`, the rain forest, and `utm10n_439_5293`,
Mount Olympus, sharing x = 439 km): "4 stream(s) of order >= 3 cross on one side only: Hoh River (order 5) at 5301992 m
(three times), Mount Tom Creek". Asked: a stream crossing a tile edge continues on the neighbour's side with the same
identity, position, level, banks and zones, whichever tile is built first; meltwater streams seeded from the ice step's
`terrain.ice` (the Blue and Hoh Glaciers' outflows); both tiles rebuilt, seams and Olympus's audit unblocked.

What was wrong. The rivers did continue, but not onto the edge: each tile clips, routes and reroutes its own network,
so the rain forest's Hoh began at its inflow seed 20 m inside the edge (the seed is inset 15 m) while Olympus's ended on
it, with a zero-length 'kept' stub on the edge counted twice; the order was 4 on one side (the NHD seed's) and 5 on the
other (the DEM's Strahler), the widths and levels each side's own. And on Olympus the NHD Ice Masses (FType 378: the
Blue, White and Hubert Glaciers and 20 unnamed) were kept as ponds by the water step and drawn as lakes by the client,
the routed lines across them marked in_waterbody.

Chosen (tile-spec: Streams across seams, and meltwater):

- **A crossing record per stream per edge** (`hydro/edges.json`, UTM): point on the edge line, flow tangent, name,
  fcode, order, area, width, and the water step's level, depth and half width. The first tile built decides; a tile
  built next to one with edges.json adopts each crossing within 60 m (the other way round): point, tangent, identity,
  the higher order (carried down the reaches below). The line is cut back 12 m from the edge and runs straight to the
  point. A neighbour's crossing into us with no stream of ours near starts an inflow here, traced down our 5 m flow.
  Without a neighbour, own: the line carried on to the edge, then the lowest 1 m ground along it nearby.
  Rejected: routing each tile with a margin of the neighbour's DEM (each tile would need the other's lidar, and two
  margins still disagree where the lidar does), and snapping to the NHD line's crossing alone (NHD is ~10 m off the
  ground, the 1 m thalweg is better and one side can always see it).
- **The level is the mean of the two sides' own.** Copying one side's level was wrong by metres on the steep side
  creeks: the rain forest's 1 m lidar at the edge against Olympus's 5 m heights clamped 2.5 m in, on slopes near 1:1,
  differ by up to 6 m (the DEM seam check passes: the 5 m columns step as much inside). Each side records its own
  level; the shared one is their mean, faded to each side's own over max(60 m, the move / 0.05); the half width eases
  to width / 2 at the edge. The first tile built has only its own until the neighbour exists; the seams step names it
  for one more `--steps reroute,water`, which converges (the mean of two fixed own levels).
- **Ice.** terrain/ice.tif with the NHD Ice Masses: lines split at the ice's edge, the pieces on it `on_ice` (not
  drawn), the piece below starting at the toe as `meltwater`, perennial, named for its glacier. Meltwater heads: the
  whole tile routed on the 5 m DEM with the ice's area carried down; every first cell off the ice draining 0.05 km2 of
  ice starts a stream to the network, unless it runs back onto the ice (a rock island in the glacier: 60 of 110 heads)
  or meets a stream within 25 m (that stream is tagged). The first try drew 5 m D8 staircases across the Blue Glacier
  from its nunataks: now stopped at the ice, and smoothed over 8 m. Glaciers are not ponds (water.py, features.json's
  new `glaciers`).

Results. Built 439, 429, 439 (`--steps reroute,water`), then seams on both: **pass**. The shared edge has 9 crossings
on each side, 8 matched at 0.00 m apart, levels within 0.001 m (after one more water run each: 0.032 m before), widths and orders equal (Hoh River 5, 16.4 m wide, level
251.90 m; Mount Tom Creek 4); the two left are order 1 and 2 heads each side thinks flows in from the other (listed,
not failing). The own-level step across the seam: median about 1 m, at most 5.87 m. Olympus: 99 lines touched the ice
(28.1 km now on_ice, not drawn), 20 meltwater lines added, 41 streams tagged, 41 reaches made perennial. The water
checker before -> after (`scratch/seam/check_*`), bed within 5 cm of the cross-section's lowest ground: rain forest
76.9% -> 76.7%, Olympus 57.7% -> 57.1%; water over the bank by 10 cm 0.11% -> 0.21% and 0.17% -> 0.21%; rises 0 -> 0
(this work moves ends and levels near the edges; the bed fit is the reroute's). Reverse order (429 first, in a scratch
tiles folder, then 439, 429 and 439 again with the water step alone): the seam passes the same way, 8 crossings at 0.00 m, levels within 1 mm. The points differ from the forward order's where the first tile's own point decided (Mount Tom Creek 10 m along the edge), as designed. Found on the way: a reach leaving the tile was sampled every 2.5 m from its start, so its last sample could stop 2.5 m short of the edge and miss its crossing (now the end is sampled too), and the reroute's copy of the neighbour's level went stale when the neighbour's water step ran again (the water step now reads it fresh): convergence takes water runs only, at most A, B, A, B when the second tile has crossings the first lacked.

Left: on the steep creeks the shared level sits up to 3 m off one side's ground for the first tens of metres (the
ground's own step; fixing it is the terrain seam's, not the water's); the reroute and water of the tile built first
must run again once its neighbour exists; tiles without a 1 m DEM (no reroute) get no crossings; meltwater is order 1
(Strahler not recomputed below a new head); the order raise at an inflow ignores the +1 when equal orders meet.

## 2026-11-05: root flare and surface roots, fitted to the slope (branch claude/root-flare)

Aaron: "One thing to add to the tree pipeline is root flare and roots - roots don't always need to be visible, but
especially if the tree is not on a flat surface it will have some evidence of flaring or roots." Before this a trunk
was a cylinder sunk 0.3 m into the ground with a 0.35 m cone at its foot, nearly all of it under the soil; on a slope
the slope bend (2026-11-01) tilted its foot to the surface and that was all.

**What drives it.** The records already carried `trunk.flare` (the trait cards too): redwood and Sitka spruce 1.9,
giant sequoia 2.0, western redcedar 2.1 (old growth 2.6), hemlock 1.4, oaks 1.3-1.4, Douglas-fir 1.3, pines 1.2-1.25.
With f = flare - 1 and r0 the bole's radius: the flare stands r0 x (1 + 2 f) above the ground (an oak's 0.7 m, a
mature redcedar's 2 m), is 1 + 0.9 f wider on its buttresses at the ground, and its fluting (`buttress`, how much of it
is in fins) defaults to 1.1 (f - 0.12), so pines and oaks flare round and cedars in fins. 3-7 buttresses, each going on
as a surface root; on boles past 30 cm up to two thinner roots between them; no roots under a 10 cm bole. An optional
`trunk.roots` block shapes it per species (`docs/species-library.md`); set on 18 records and their cards: the
redwoods, Sitka spruce and redcedar more and sharper buttresses, Sitka and the redwoods and the riparian trees longer
roots, hemlock shallow and long, the pines (a taproot) three or four short ones, valley oak wide-spreading.

**The shapes** (`treegen.js` `rootPlan`, `flareGeometry`, `rootGeometry`). The flare is a sleeve from the stem's
buried foot to its top ring, which lies on the trunk tube's first ring (its vertices on that polygon's edges, its UVs,
colours and normals taken from it), so the bark runs on with no seam and the trunk above is tubed from there; its
radius widens as (1 - t)^3 toward the ground, lobed by the buttresses (narrower fins near the ground). A root runs from
inside the flare to where the buttress meets the ground, then on for its length (r0 x (2 + 0.4 f), 0.65-1.35 of it),
wandering and rising and falling a little, tapering, taller than wide where it leaves the trunk (a plank root), half
buried by a third of its length and gone by its end: on flat ground a hint, as Aaron asked. Same bark material: the
bark texture, parallax and moss (moss a little more on the up-facing flare and root tops by the ground). Built in the
tree's frame without its lean, so a leaning tree's roots still lie on the ground.

**The slope** (`trunkFlex`). Every tree already carries the ground's normal at its foot (vegetation.js `groundLean`,
the 1 m heightfield a metre either side), which gives the slope and the downhill direction; nothing new is sampled.
Drawn on flat ground, each root is moved in the vertex shader: it leaves the bent trunk's collar (uphill of the axis)
at the foot's level and follows the ground only along its length (the share (1 - s)^2 left level, s from where it
leaves the flare), so downhill it stands clear of a ground that falls away and then grips and enters it, and uphill it
is under the soil the slope piles there; a downhill root is drawn steeper and shorter on the map (the props of a tree
on a steep slope); the tip sinks a little more on a slope (a hillside is rarely the plane at the foot). The flare is
pushed down into the soil on the uphill side and stretched down the slope on the downhill side, by its weight up the
flare squared, after the existing bend. On a 41-degree slope of the Hoh an old redcedar stands on two or three exposed
buttress roots on its downhill side with its uphill flank buried to a hint; a blue oak on 34 degrees on the home tile
grips with one; on the flat a hemlock or a fir shows a modest flare and the ridges of its roots.

**Wind.** The roots do not move; the flare's flex goes from none at its foot to the trunk's at its top (the flex times
1 - its weight), so a gale bows the trunk over a still base with no seam (measured: the base region's pixels change
0.09 against the trunk's 3.2 between two moments of a gale).

**Tiers and cost.** First tried with the roots in every near trunk (to 180 m): +0.36 ms at a view from 40 m up the
home tile, the roots a pixel there; the roots now are their own instanced mesh per tree in the close tier (on the close
canopy's matrices, with the near instance's ground normal copied; drawn only while a tree of that set is within 97 m),
and sink into the soil from 50 to 80 m from the eye and collapse past it (`ROOT_LOD`). The near trunk keeps the flare
(a round flare at the trunk's own sides and one ring fewer, a fluted one 16 columns, a buttressed one 24); the mid
trunk gets the flare as one ring; the far impostors bake as before (`buildTree(..., { roots: false })`). No sampler; one
vertex attribute (`rootT`, of 16 slots: the near trunk uses 12). The close layer's litter roots (2026-11-04) are gone:
the trees draw their own. GPU timer queries, a fence before each sample, 8 renders a sample, states alternated, medians
and interquartile ranges, 1280 x 800, the machine shared (load 5-7); 'off' is each near trunk on its `roots: false`
geometry with the shader's root code compiled out (`ROOT_FLARE_OFF`) and the close roots hidden, i.e. main's trunks:

| Pose | On | Off | Triangles, draws |
|---|---|---|---|
| Home tile, eye 1.6 m in the oak woodland | 22.29 ms (22.05-22.36) | 22.11 (22.08-22.19) | +68 k of 10.9 M, +22 |
| Home tile, 40 m up | 17.16 (16.93-17.92) | 17.08 (16.82-18.02) | |
| Hoh, eye 1.6 m on the cedar slope | 39.11 (38.97-39.41) | 38.94 (38.11-39.02) | +111 k of 35.0 M, +9 |
| Hoh, 40 m up | 42.69 (41.93-43.01) | 42.58 (41.88-43.98) | |

Drawn alone at the Hoh eye pose: the close roots 0.05 ms; the near trunks 1.93 ms with the flare and 2.07 without (40 m
up 3.12 and 3.09). Main's own page, loaded twice at the home eye pose, read 22.31 and 23.31 ms: page to page the frame
moves by more than this change. CPU: renderer.render 3.9 against 3.8 ms (the clock's 0.1 ms grain).

**Seen** at fixed cameras against main (0c3c454 on 8781, the branch on 8811, the same tile, date 10 July, hour 13):
the Hoh's redcedars on 41 and 44 degrees, Douglas-firs on 37, a hemlock on the flat; the home tile's blue oaks on 34 and
32, a valley oak on 24, a black oak on 27, a buckeye on 28. Captures in the shared notes folder (`root-flare-captures/`).

Not done: stilt roots (a hemlock or a Sitka spruce standing on the roots that grew over a nurse log since rotted: the
cards name it); roots do not cast shadows (the near trees' shadow is the mid trunk's, which has the flare ring); the
slope is the plane at the foot, so on a convex brow a downhill root's tip can show above the ground for a few
centimetres; animals do not climb on or step over roots, and a squirrel climbing the foot of a big flare climbs the
skeleton's radius (perch.js treeWood), inside the flare's lower metre.

## 2026-11-05: the Hoh rain forest's animals, nineteen species on their kin's behaviour (branch worktree-agent-a8ac59863e116a3ea)

Aaron: the Hoh tile "looks empty": 39 animals listed, 6 drawn. He approved the rest of the Meshy allowance (450 credits)
for about fifteen Hoh animals, free variants first.

- **Nineteen species for 120 credits** (550 -> 670 of 1,000): Roosevelt elk (bull and cow), river otter, great blue heron
  (`latest` previews), Pacific wren, Canada jay, chestnut-backed chickadee, barred owl, belted kingfisher, common merganser,
  western red-backed salamander (lite previews); bobcat, snowshoe hare, Douglas squirrel, Townsend's chipmunk, deer mouse,
  American crow, ensatina, bald eagle (variants of existing sources, no credits; the eagle's own lite preview, 5 credits,
  came back flapping and is unused); the Pacific banana slug procedural. Both elk prompts asked for a cow and came back
  antlered, so the cow is the second bull with its antlers cut. 330 credits are left; none were needed for the rest.
- **Kin, not new machines.** Each new slot runs an existing species' behaviour (`animals.js KIN`): elk the deer's herds
  (bulls as the buck's variant slot), the conifer birds and the owl and kingfisher the Steller's jay's, the eagle the hawk's,
  the crow the raven's (its air model the procedural raven at 0.72), the bobcat and otter the fox's, the hare the brush
  rabbit's, the chipmunk and deer mouse the vole's, the salamanders the fence lizard's, the heron and mergansers the quail's
  covey machine on the water. Per-species numbers in `HOH`. Why: fifteen hand-written machines were weeks of work; the kin
  machines already carry the herd, the covey, the flush, the perch and the runway, and the differences that matter at
  game distance are where, how many and when. The cost is fidelity of behaviour (no otter paddling, no owl hunting from a
  perch, no elk rut), listed in docs/animal-library.md.
- **Conifers for everyone.** The Steller's jays of the Hoh never spawned: the conifer index held only the two foothill
  pines. It now takes every conifer genus, so the Olympic forest's hemlock, spruce, fir and cedar hold the jays, the
  Douglas squirrel, the wren, the chickadees, the Canada jays and the owl.
- **Water.** The kingfisher, otter, heron and mergansers spawn only where water runs this season (`wetCell`, water.js
  `depthAt`) and keep to it (`waterSpot`), riding the stream ribbon's height (`surfAt`).
- **Elk, not red deer.** GBIF and EltonTraits lump the American elk with Cervus elaphus; on American tiles (UTM zones
  1-24) `pipeline/fauna.py` lists those records as Cervus canadensis, and a listed animal takes the library's common name.
- **Playable**, all but the slug (groundControl.js, flierControl.js). The near bar's stills rendered for all nineteen
  (client/tools/opening_sprites.html, now `?recv=` for a receiver on another port).

Verified on the Hoh tile (`?tile=utm10n_429_5293&date=06-15`): on the river flats at (1500, 7600) the live set held 17
elk and 2 bulls in herds, Douglas squirrels, wrens, chickadees, Canada jays, a kingfisher over the river, a bald eagle
soaring, crows, bobcats, otters along the river, snowshoe hares, chipmunks, deer mice, salamanders, ensatinas, a heron and
eight mergansers (one diving), banana slugs; all moving and phasing, no NaN in 2.5 s; entered the elk (walked), the crow,
the eagle, the chickadee, the bobcat, the otter, the salamander, the merganser and the Douglas squirrel from the spirit.
The lineup page drew all twenty models at their brief's sizes. Tests pass. Fauna and games rerun on both Hoh tiles: all
nineteen present by their records, each at registry fidelity 3.

## 2026-11-05: the gestalt pipeline: a paragon per tile, carried into every generator and judged against photos (design; branch claude/sweet-feistel-2054bb)

Aaron: "Research the square, understand the major animals and plant and tree species, what is the 'vibe' or gestalt of
that area. Collect reference photos ... and what the inter-species dynamics are (for games)", and "a pipeline that
produces something that feels like the place, by producing each object in such a way that it contains the vibe of the
paragon." A design for review, `docs/gestalt-pipeline.md`; the published page: https://claude.ai/artifact/CRXGhhEe16r6njnDD8dKvU.
Nothing in the step graph or the client changed.

- **Chosen: two new stages around the existing four**, `place` after base (settings_map, structure, sources, photos,
  photo_stats, paragon, paragon_check) and `judge` last (poses, render, judge), plus `deadwood` and `look` in flora and
  `interactions` in fauna. Place reads only base, so flora can read it; judge needs the finished tile. Rejected: a
  separate tool outside `build_tile` (it would lose `--plan`, `--status`, the fingerprints and `cost.json`).
- **Chosen: settings, not one description per tile.** A setting (valley-floor rain forest, braided gravel bar, montane
  silver fir, subalpine) is a card in `library/settings/` keyed by EVT, landform and region and reused by neighbours; the
  tile's paragon names its settings, shares, ranked signature features, views and interactions. Rejected: a single
  per-tile gestalt (the Hoh tile is 75 % valley wall; an average would lose the valley floor's look).
- **Chosen: every number is a sourced, checked trait** with a range and the look parameters it drives. Source order:
  this tile's measurement, then classification text (LANDFIRE BpS, NatureServe), then literature, then judgement marked
  low. The check fails on a schema error or a contradicted measurement and warns on the rest.
- **Chosen: the agent writes files, the pipeline stays deterministic.** The paragon step is a trait card's pattern: an
  agent (`claude -p`, fixed prompt) writes the setting cards and the paragon; the step records its inputs' hashes and is
  stale, not re-run, when they change, unless `--research`.
- **Chosen: photos are measured and judged, never shipped.** CC0, PDM, US Government, CC BY and CC BY-SA only, filtered
  per photo; licence and author kept per photo; the client gets numbers only.
- **Chosen: a judge with four parts**: image statistics (30), a vision rubric (40), the signature checklist (20) and a
  blind place test (10). Tuning is bounded to each trait's sourced range, so the loop cannot paint renders to match
  photos the paragon does not support; structural gaps become registry hand edits.
- **Measured today, the prototype**: 234 openly licensed Commons photos geotagged in the Hoh tile (75 public domain,
  mostly NPS); 56 forest interiors against the current render in CIELAB: median lightness 39 against 20, green hue 117°
  against 145°, moss-green pixels 32 % against 0.03 %, a*b* overlap 0.18 (two photo sets of the place: 0.82). Lidar
  against the literature: canopy p99 82 m on the floor's Sitka spruce cells against McKee's 75-85 m (pass); 74 % cover
  over 5 m in the 1 m CHM against Woods' 93 % densiometer (warn: different instruments).
- **Prototype files**: `library/settings/pnw_valley_rainforest.json`, `library/settings/pnw_braided_gravel_bar.json`,
  `tiles/utm10n_429_5293/place/paragon.json`, `tiles/utm10n_429_5293/place/photos.json`. The scripts, contact sheets,
  the source-licence survey and the Hoh fact sheet are in the shared notes folder.
- **Cost**: per new place $5-12 of Claude, under 100 MB, 40-70 min on top of the four stages; to implement $225-355, no
  Meshy credits.
- **First new place, recommended: Lamar Valley, Yellowstone** (`utm12n_558_4964`): unlike both the foothills and the Hoh,
  the hardest test of the interactions and games, and mostly existing archetypes (4-6 Meshy jobs, about 150 credits).
  Then Saguaro West (`utm12n_479_3565`, the generator stress test), then the Smokies' Greenbrier (`utm17n_279_3949`).
  Not run; that waits for Aaron's review.

## 2026-11-05 (later): the world pipeline: measure everywhere, generalise by ecosystem, research only the signature, judge everything (design; branch claude/sweet-feistel-2054bb)

Aaron widened the brief: "don't anchor too heavily on my insights or ideas - anchor on the goal: A pipeline that can
generate a tile anywhere on earth. Paragon may not be the right approach - it's just an idea. Think about the problem
strategically, and design a pipeline from land generation, to the ecosystem through the seasons, the animal behaviors
and the games." Design: `docs/world-pipeline.md`; the same page, republished:
https://claude.ai/artifact/CRXGhhEe16r6njnDD8dKvU. Nothing built.

- **The problem, ordered by what the eye reads first**: layout, structure, light and colour, time, signature, life,
  relationships (scene gist: Oliva and Torralba 2001; Greene and Oliva 2009). The pipeline is strongest at layout and
  species and weakest at structure below the canopy, light and the season's state; the Hoh measurement shows it (colour
  overlap 0.18 with photos where two photo sets of the place share 0.82).
- **Evidence varies by three orders of magnitude** and not with how remarkable a place is: plant records on seven
  candidate tiles run from 37 (Pantanal) and 459 (Serengeti) to 76,136 (Białowieża).
- **Chosen: measure, generalise, specialise, judge.** Layers a dataset measures come from it at the best resolution the
  tile has; what space cannot see comes from ecosystem cards keyed on the IUCN Global Ecosystem Typology and from
  trait-driven animal rules (density from body mass, Damuth 1981; carnivores from prey biomass, Carbone and Gittleman
  2002; behaviour from about fifteen archetypes generalised from the kin machines); an agent researches only the
  signature layer where evidence exists; a judge scores every layer (a top-down render against Sentinel-2 by month
  everywhere, photos and a vision rubric where they exist, an AI-only season simulation, people) into a fidelity report.
- **Rejected as the core**: per-place research for everything (the paragon as first designed: cost per tile, and it fails
  where literature is thin, which is most of Earth); biome templates alone (every savanna alike); fitting to imagery
  alone (photos are thin, colour can be fitted while structure stays wrong); generative models (not grounded, inconsistent
  across tiles and seasons, unclear provenance; at most a texture source).
- **Stages**: land (base, global: GLO-30 corrected for canopy, national lidar, GEBCO and the shore, MERIT Hydro and JRC
  water, SoilGrids, ERA5), ecosystem (the EFG map, measured structure, plants by records then checklists then functional
  types, look, signature), seasons (new: monthly state and the tile's own calendar, resources derived), animals, games
  (the classifier on global inputs, the interaction web, signature games, balance by simulation), judge (new).
- **The paragon** is kept as the signature layer; its general content moves to ecosystem and setting cards and its
  checks to the judge.
- **Cost**: a tile $3-6 of Claude once its cards exist (1-1.5 h with lidar, 40-60 min without); an EFG card $5-10 (about
  25 cover most land); implementing in three phases, $800-1,250 of Claude plus Meshy per species; phase 1 alone builds
  any land tile at fidelity 2 or better.
- **First run**: three probes after phase 1 (Seronera, Serengeti `utm36s_698_9724`; Moskenesøya, Lofoten
  `utm33n_412_7531`; Danum Valley, Borneo `utm50n_582_543`), about $50-80 and no credits; then the Serengeti taken deep
  (about 8 Meshy models, 200-240 credits, $60-100). Lamar Valley stays the lower-risk US alternative. Not run; waits for
  Aaron's review.

## 2026-11-05: the dig goes the way the orbit camera looks (docs/game-dig.md "Steering by the camera")

Aaron: "Can you make the orbit controls work for digging - so that it's easy to dig down."

Since the orbit camera, a drag on the ground only swung the camera, so the dig's slope (the flight's pitch) was
always 0. A player could not dig down past the opening dive.

The orbit is now the aim:
- **Pitch.** Its pitch off the set-up is the slope, down to 83 degrees and up to 57. A level view digs level, so the
  keyboard path is unchanged.
- **Held.** Underground and while digging, its pitch is held rather than eased back.
- **Yaw.** While digging, its yaw turns the body as fast as the face can curve.

Considered:
- **Arrow keys or a modifier for pitch.** Rejected: Aaron asked for the orbit, and the drag is already in the
  player's hand.
- **The camera's exact view direction as the dig direction.** Rejected: the chase camera's set-up already looks down
  20-40 degrees to frame the body, so a neutral view would dig downhill.
- **Steering the body by the camera at all times underground.** Rejected: orbiting to look at the animal would spin
  it round. The steer applies only while digging, and only with the camera within 100 degrees of behind.

Walking a shaft by looking up or down came with it: the walk direction and the branch choice weigh a segment's slope by
the aim, and are unchanged on the slopes the old dig could make.


## 2026-11-05: limbs and trunks sway in a breeze, not only in a strong wind

Aaron: "I don't see the trunks swaying in the breeze, still just the leaf cards - it doesn't look like the branches are moving either". The wind tiers of 2026-11-04 started the limbs at 4.5 m/s and the trunks at 9 m/s, each on a smoothstep, which is flat at its foot. So the 2-4 m/s breeze that the hourly weather usually gives moved only the cards: at 3 m/s the limbs and trunks were exactly still. Now `windLimbs()` ramps from 0.8 to 12 m/s and `windTrunks()` from 1.2 to 19 m/s, on ramps that rise from the foot (`windRamp`, exponents 0.65 and 0.75): 0.35 and 0.18 of full at 3 m/s, 0.53 and 0.31 at 5, and the full motion at 12 and 19 as before. The amplitudes (`CROWN_SWAY`, `CROWN_FLEX`, cut on 2026-10-29 for "the swaying is too intense") are unchanged, so a breeze gives a slow, gentle sway of the crowns and the whole tree rather than a fast one. The mid crowns and trunks, gated on `windTrunks() > 0`, now bow together in any breeze over 1.2 m/s.

The measurement: on the Hoh at 3 m/s from the forest floor, with a fixed camera and frames 0.15 s apart for 4.5 s, the most any frame differs from the first went from 0.54 to 3.67 in the trunk area and from 2.95 to 5.93 in the crowns.

## 2026-11-06: the rest of the Olympic animals; the rigger's short legs; upright birds fly level (branch hoh-birds-2)

Aaron approved modelling the animals the Hoh and Mount Olympus still listed without a model: 22 species (the Hoh's 14,
Olympus's 8 more), for 25 credits (670 -> 695 of 1,000): lite previews of the robin, starling, sooty grouse, Olympic
marmot and western toad; every other one a variant (the varied thrush of the robin; the junco, kinglet and flycatcher of
the chickadee; the two small owls of the barred owl; the osprey, sharp-shinned hawk, merlin and three gulls of the
red-tail, one parameterised `tools/build_soarer.py`; the mallard of the merganser; the yellow-pine chipmunk of Townsend's;
the montane shrew of the deer mouse; the Cascades frog of the toad), and the hairy woodpecker procedural as the acorn
woodpecker is. Each runs a kin's behaviour as the first batch's do (`animals.js KIN`, `HOH`); the marmot gets the ground
squirrel's colonies (`colonyUpdate` by `g.sp`), the woodpecker clings to the conifers' bark (`HOH.trunk`).

Fauna and games rerun on both tiles: both queues empty, all 46 listed animals on each tile with a model at fidelity 3.
The montane shrew and (on Olympus) the western gull stay absent by the presence rule (under 3 records near the tile).
Verified on both tiles: the new slots spawn where their rules put them (the robins, juncos, thrushes, starlings, the
woodpecker, toads and gulls on the Hoh's river flats; marmots and yellow-pine chipmunks on Olympus's talus at 1,500 m,
sharp-shins and merlins over it), move and phase with no NaN, and play; animals.update 0.66 ms a frame with 236 animals.

Two fixes asked for with it: `tools/rig_quadruped.py`'s leg bands widen instead of failing on a short decimated leg
(`band_at`, a test), and the upright meshes (the owls, the kingfisher, the flycatcher) tip forward to fly level as the
player (`flierControl.js` `upright`).

## 2026-11-05 (night): the probes first; geology and soil, niches, the sea and tile requests in the design (branch claude/sweet-feistel-2054bb)

Aaron, after reviewing the world pipeline: geology and soil must be first-class; "Probes first - figure out if the
primitives are correct"; ecosystems from the species research ("grows on the shady side of mountains", "in riparian
zones") with IUCN as a possible base; the sea and waterways designed for, with "license for creativity" under water;
players request tiles now, judge later, pay later. Phase 1 was stopped at a clean commit (564adc6: the global readers and
the ecosystem classifier) and the probes run instead.

- **The probes ran** (`docs/probes-2026-11.md`): Seronera (`utm36s_698_9724`), Moskenesoya (`utm33n_412_7531`) and Danum
  Valley (`utm50n_582_543`) through all four stages with only what a tile needs outside the US, each recorded as a
  fallback: Copernicus GLO-30 for the DEM (NASADEM stops at 60 N), a Sentinel-2 composite for NAIP, OSM for NHD (with the
  osm step's curl-capable Overpass reader), WorldCover, Meta canopy height, ERA5 and SoilGrids written as LANDFIRE-shaped
  rasters (`pipeline/landcover_global.py`) plus the IUCN GET ecosystem map, SoilGrids in SSURGO's encoding
  (`pipeline/soils_global.py`), communities composed from the tile's own researched species (`species_mix.research_rule`),
  and 14 trait cards for the probes' dominants. About 27 min each, no Meshy credits. Captured at fixed poses and compared
  with Sentinel-2 by hand.
- **Found**: terrain, routing, land cover, canopy, geology, soil, the species research and the step graph carry over. What
  fails is where a place's life is decided: composition (no niches; records taken for abundance; growth form guessed from
  a temperate family list, so Danum's research had no trees), the ground (the foothills' materials and grasses
  everywhere), the animals (the client draws a fixed North American cast by habitat: about 190 in Borneo), the seasons
  (northern quarters everywhere), water permanence (NHD codes: Danum's big river is dry), and colour (satellite overlap
  0.00-0.15, lighter and half the chroma). Global geology is coarse where the signature is rock (no kopjes), and
  Macrostrat's per-source licences are not filtered.
- **Phase 1 reordered by the findings**: composition by niche; animals from the tile's own list; ground and palette;
  water permanence and the sea surface; seasons from the tile's climate; national lidar and canopy-corrected GLO-30;
  geology licence filter and finer maps; the satellite judge automated. $275-425 of Claude, estimated.
- **Design, revision 2** (`docs/world-pipeline.md`, the page republished as v3): geology and soil as land-stage layers and
  what rock drives; the niche layer composing species per cell over the IUCN base layer; the sea and waterways with a
  labelled licence to invent under water (plausible for the place, never over a measurement, labelled `invented`,
  deterministic, reviewed); the request queue (ask by cell id only, preflight, queue, build, publish; paid later).
- **Fixes the probes forced**: a treegen guard for a reference tree without a crown envelope; `write_json` is atomic and
  the tile index skips a manifest mid-write (parallel builds); the hydro OSM fallback uses the osm step's reader; the
  ecosystem layer's source registered (the audit refused it until then). Two semi-deciduous cards (desert date, sausage
  tree) corrected after the card test caught them.
- **Regression**: the Hoh (`utm10n_429_5293`) rebuilt with this branch's code in a scratch copy: the steps whose code
  changed re-ran, 173 files byte-identical, the 7 that differ are timestamps or the 2 forage rows the new library species
  add; audit passes, seams unchanged; the viewer loads it with no console error. All 63 tests pass.

## 2026-11-05 (late night): a cost ceiling and pricing, bark from research, the sea floor by physics, four more probes (branch claude/sweet-feistel-2054bb)

Aaron: "For Meshy at scale, I want to find out what the ceiling is for a fresh tile in a fresh region - I need to figure
out pricing. For generative textures, there should be a research step to find descriptions of the bark and generate based
on the description. For underwater topography... large portions will be sandy or muddy at the outflow of a river... the
pipeline should invent rich ecosystems even if there isn't data to support that." Then: "We should also run something
within the US. Maybe Grand Canyon, Wyoming. I'm also curious about Costa Rica or somewhere dramatic in the Amazon."

- **The ceiling** (`docs/world-pipeline.md` 6b): a fresh tile in a fresh region costs about $640-700 of Claude and $46-74
  of Meshy at worst (all 46 animals modelled fresh at 80 credits, four new body plans), about $250-260 and $10-15 typically
  (the 22 of the density target), and $20-40 once a region's library has grown. Claude's agent time dominates, not the
  credits: Meshy is $0.0125-0.020 a credit (meshy.ai/pricing, read 2026-11-05: Pro $20 for 1,000, Ultra $100 for 8,000).
  Pricing: a fixed neighbour price, a founder's price for a region's first tile, payments pooled per region; the queue
  models each shared species once, ordered by how many pending tiles need it.
- **Bark from research** (3e): a per-species research step writes a structured bark block (colour by age, pattern,
  furrows, plates, lenticels, peeling, age transitions, sources and licences); most of it maps onto treegen's bark
  parameters, a procedural recipe (CC0 by construction) fills what they cannot draw, a generative model only where its
  licence lets the output ship; checked against openly licensed bark photos.
- **The sea floor** (3c): sediment placed by physics (fans and deltas off river mouths by sediment supply, mud below the
  wave base and in sheltered bays, rippled sand on the exposed shelf, rock on steep and hard-rock ground), then life
  invented on it by substrate, light, temperature and latitude (kelp, reef, seagrass, mangrove, walls, burrowed mud), the
  species from OBIS by marine ecoregion and depth, labelled invented.
- **Four more probes** (`docs/probes-2026-11.md`): the Grand Canyon (`utm12n_396_3988`), Grand Teton (`utm12n_514_4838`,
  chosen over Lamar Valley for testing more at once), Corcovado (`utm17n_210_932`) and Manu (`utm19s_233_8679`). The US
  path works on new land and the Tetons read as the place (imagery overlap 0.52); Macrostrat gives the Canyon's real
  formations but the client draws three rock classes; on the tropical tiles an empty species mix lets the client's
  California fallback draw pines, and the humid haze washes the scene out. Phase 1 gains a ninth item ($25-40): no other
  region's species as a fallback, formation colours from the geology, humid haze. Revised phase 1: $300-465.
- Fixed on the way: the dem step's Planetary Computer fallback wrote the open dataset into the manifest (a shadowed
  variable, reached when USGS answered 502); Macrostrat's coverage test failed every coastal tile. The US point clouds were
  skipped with the lidar step's DEM-only mode (4-5 h each; crowns proven elsewhere). The later captures used a headless
  Chrome over the DevTools protocol, the pane being hidden.

## 2026-11-06: phase 1, iteration 1: every fix a rule for every tile (branch claude/sweet-feistel-2054bb)

Aaron: "implement as many as you can on your own before showing me something you all are proud of that is the result of
the pipeline not fiddling with individual species." The seven probes are the regression set (tools/probes: fixed poses,
a headless Chrome over CDP, the sheet and the satellite statistics); each change below is a rule, a generator or a data
source that holds on every tile, and is judged by re-running the set.

- **The tile's own animals** (`pipeline/fauna_slots.py`, the `animals` step; the client side in `animals.js`): the
  client spawned a fixed North American cast by habitat (about 190 in Borneo). Now every tile writes `client/fauna.json`:
  which curated species may spawn there (those the tile's research or records list; the rest are gated off) and up to
  40 stand-in slots for its own researched species, each an existing species' body and behaviour (its kin) chosen by rules
  over taxonomy, diet and mass, scaled by the mass ratio's cube root, at a density from body mass (Damuth 1981 for
  herbivores, 30 / mass kg for carnivores, a softer law for birds), with group size by guild and hours and water from
  the traits. Known errors are listed per slot (a giraffe on a deer's proportions). A tile without the layer is unchanged.
- **The research lists the animals that matter** (`fauna.py` CLASS_QUOTA): the quota of 8 mammals by records left out
  the Serengeti's wildebeest, zebra, giraffe, elephant and buffalo (11th-22nd by records); it is now 25 mammals, 25 birds
  (5 reptiles, 4 amphibians), each needing 3 records, and the client slots order mammals by records x sqrt(mass).
- **Composition by the records' own niches** (`species_mix.research_rule`, `terrain_weights`): a researched species is
  weighted by its card's habitat class weights (the riparian sausage tree is no longer the commonest tree on the open
  plains: weight 31 -> 1.5) and, where no regional table has a row, by its own floor / mid / steep / north factors.
- **No other climate's plants** (`species_mix` class_fallback, `vegetation.js cellPlan`): a cell whose row had no
  trees borrowed the client's California class mix (the pines in Manu and Corcovado). Outside LANDFIRE's reach the
  client no longer borrows it, and a tile whose research has no tree on record gets functional stand-ins from the
  library's trees of its own climate group only (REGION_CLIMATE), labelled as stand-ins.
- **Rivers run where the climate says** (`channels.perennial_area_km2`): outside NHD, OSM gives no permanence and the
  area rule made a rainforest's river intermittent (Danum's drawn dry). Now the aridity index (ERA5 precipitation over
  potential evapotranspiration) sets the drainage area above which a stream is perennial (humid 0.5 km2, sub-humid 10,
  semi-arid 300, arid none). The Serengeti's Seronera stays seasonal.
- **A forest floor under the canopy without a point cloud** (`inpaint_crowns.litter_under_canopy`): the base texture on a
  global tile is a satellite composite, so a closed canopy's floor showed the crowns' green from above (the "lawn"). The
  imagery is now blended toward leaf litter by the canopy map's tree cover.
- **The tile's own seasons** (`fetch_global.season_months`, in `climate.normals`): the season-keyed tables were written
  for a Mediterranean north; a seasonally dry tropics now maps them onto its own rainfall (the Serengeti: spring
  November-January, summer June-August), a temperate south shifts six months.
- **The judge compares like with like** (`tools/probes`): the top-down render is drawn without haze (Sentinel-2 L2A is
  corrected for the atmosphere) and compared with the Sentinel-2 composite of the capture's own month.

## 2026-11-06: phase 1, iteration 2: the tile's own animals get bodies of their own (branch claude/sweet-feistel-2054bb)

Aaron: "the Serengeti deep pass waits until phase 1 spawns a tile's own animals (archetype plus stand-in body)... Build
that first, then model", and "the result of the pipeline not fiddling with individual species". Every hand build before
this one (build_cougar.py, build_elk.py ...) carried its species' palette, landmarks and reshapes in code. This
iteration replaces that, for four-legged mammals, with one path that reads everything from data.

- **One build for every quadruped** (`tools/build_quadruped.py`): parts from the geometry (the tail behind a cut at the
  rump, narrower than the body; the feet on the floor split fore and hind at the widest gap; the legs below the belly
  line; the head ahead of a plane at the neck base), colour from the Meshy refine's texture (each face of each tier the
  mean of the nearest source faces' texture colour), size from the body mass, then the existing `rig_quadruped.py` and
  `bake_gait.mjs`. Tried without credits on the ground squirrel, cougar and bear jobs already in the library.
- **Meshy meshes are not manifold** (a refine had 627 edges on three or more faces), and the collapse decimation stalls
  on them (3,821 triangles whatever the ratio). The build voxel-remeshes at 1/200 of the length after reading the
  colour (colour goes by position, so the UVs are no longer needed).
- **Size from mass, not the trait card's shoulder height**: the cards' shoulder heights are allometric guesses from mass
  that ignore build (a hippo 2.5 m at the shoulder, a zebra 1.65 m). The build sizes the closed mesh so its volume at
  1,000 kg/m3 holds the card's mass (EltonTraits / PanTHERIA): the cougar comes out 0.70 m at the withers (hand build
  0.72), the lion 1.0 m. The prompts carry no dimensions.
- **Which species get a model** (`pipeline/fauna_models.py`, run by hand with a credit budget, never by a tile build):
  every predator over 15 kg (largest first), then the four-legged mammals by biomass (density x mass), until the budget;
  a model the library already has costs nothing on any tile. The prompts come from the card and the place (OpenStreetMap
  reverse geocoding: "Serengeti, Mara Region, Tanzania") with a fixed pose the build needs (side-on, four feet flat,
  nothing else on the ground). A build that cannot find four legs earns one more preview, then the slot stays a stand-in.
  The ledger per run: tiles/<tile>/fauna/models_run.json; the library's models: library/animals/models.json; the tile's
  fauna.json slot carries `model` when the library has one (`fauna_slots.py`).
- **The coat's contrast** (found in the Serengeti pass): a face coloured by the mean texture under it turned the zebra
  grey and the leopard plain. Each face now takes the commonest of the coat's own palette colours under it (k-means, 10
  colours), and a patterned coat (the mean lightness step between neighbouring source faces: plain coats 0.024-0.058,
  the zebra, giraffe, cheetah and leopard 0.089-0.125) gets up to 12,000 triangles at the near tier (4,000 for a plain
  one).
- **Legs that stand on the floor**: an elephant's trunk hanging below the leg cut was taken for a foreleg, a narrow
  antelope's close-set legs for its belly, and a walking pose passed with a hind leg missed. A leg is now a piece below
  the cut that reaches the floor; the belly is the torso's down-facing underside; every quadrant must have a foot on the
  floor or the attempt fails (and the slot gets its one retry, then stays a stand-in: the hartebeest).
- **Paid jobs first**: before buying a species, the step rebuilds its existing refine jobs with today's build;
  `--rebuild` rebuilds every library model from its job (all eleven were, after each rule above).
- **No California forbs outside the regional tables** (`forbs.js`): iteration 1 stopped the class mix for trees and
  shrubs; the forbs still took their class weights (filaree rosettes lying flat on the Serengeti and at Lofoten, the
  "floating leaf cards"). A tile with `class_fallback` false now draws only its own rows' forbs.
- **The measured ceiling** (docs/probes-2026-11.md): twelve signature species of the Serengeti, 480 credits; 11
  modelled, the hartebeest a stand-in; 30 credits a species when the first preview stands square, 60 when it takes two.
- **A client that draws a slot's own model** (`animalModels.js loadFaunaModel`, `animals.js installFauna`): a slot with
  `model` gets a drawn mesh on the skinned path, real size, with the template of its kin; the procedural stand-in stays
  the fallback.
- **Fixes the regression set found**: Manu's page hung for ten minutes building the water grid (a 1,624-vertex OSM river
  polygon over the whole tile, tested whole at each of 4 million pixels): rings are now indexed by 30 m band of north
  (`tilepackage.js ringBands`). Then it, and Corcovado, threw: a cell with no tree mix (iteration 1's no-fallback rule)
  still drew its riparian extras from the null mix (`vegetation.js`, `impostors.js`). The capture script now gives up on
  a page that never becomes ready and the run goes on to the next probe.

## 2026-11-06: the image leaves out the pipeline's Sentinel-2 cache

The world probes left 6.8 GB of Sentinel-2 composites in `pipeline/_cache/sentinel`. Because the Dockerfile copies
`pipeline/` whole, the image grew from 4.0 GB to 8.4 GB. Fly recorded releases v27 and v28, but the machine stayed on
v26's image, and the live site served the old client with no error from `fly deploy`. `.dockerignore` now leaves that
cache out (the server reads no pipeline cache). After a deploy, check the machine's image (`fly machine status`), not
only the release list, and compare a live file's md5 with the local copy.

## 2026-11-06: phase 1, iteration 3: behaviour from traits, the judge's clear sky, heath cover, the registry (branch claude/sweet-feistel-2054bb)

The Serengeti evaluation's first finding: the bodies were the species' own, the behaviour was still the kin's (every
grazer bedded 9:30-16:30 like a mule deer, giraffes lay down in a crowd, leopards came in fours). Fixed by rules over the
traits, for every tile:

- **A slot's own day** (`fauna_slots.behaviour`, client `animals.js` ACT): 24 hours about or resting, from EltonTraits'
  activity flags and PanTHERIA's activity cycle, and a share of the day from diet and mass (a herbivore feeds longer the
  larger it is, 0.35 + 0.1 log10 kg, 0.4-0.75, after Owen-Smith 1988; a carnivore rests most of the day, 0.45 - 0.07
  log10 kg, 0.15-0.45). The Serengeti: wildebeest about 5-12 and 14-19, hippos at night, lions seven hours at dawn and
  dusk. The deer and carnivore machines read it in place of their own clocks.
- **Rest posture**: lying, except land mammals over 800 kg, which rest on their feet (elephants, giraffes; a hippo lies
  in the water).
- **Groups and numbers from PanTHERIA** (`pipeline/pantheria.py`, Jones et al. 2009; "Copyright restrictions: None"): the
  social group size as [sqrt(g), g] up to 30 (buffalo 3-12, wildebeest 4-20, elephants 4-20), solitary where the species'
  own population group is 1 (the leopard; not from a genus median, which made the lion solitary), and the measured
  population density where the species has one (lion 0.11 per km2, wildebeest 8.0) in place of the allometric rule.
- **The judge's top-down under a clear sky** (`tools/probes/capture.mjs`): the composite is the month's cloud-free
  median, and the tropical probes' archived days are overcast. Danum moved only from L* 17 to 18: the darkness is the
  canopy's own shading (below).
- **Heath cover** (`landcover_global.DWARF_SHRUB`): the canopy map starts at 0.5 m and WorldCover calls heath grass or
  moss, so Lofoten's heath had no shrub cover. The open cells of a heath, shrubland or tundra group now carry its typical
  dwarf-shrub cover (T3.3 60 %, T3.2 50 %, T3.1 45 %, T6.3 35 %, T6.4 30 %). Not yet visible: a crowberry carpet needs
  thousands of plants a cell, which only the ground layer draws, and the ground layer's species atlas is fixed at load
  for the whole library (24 slots, 21 used by California and Olympic forbs). A per-tile atlas is the next step there.
- **Two-sided leaves** (`treegen.js` leafTransmit, canopyMaterial, leafMaterial; `impostors.js`): broadleaf foliage was
  one-sided Lambert, so every card facing away from the sun got only the ground's bounce light and shaded crowns went
  black. A thin leaf passes about as much green light as it reflects (PROSPECT / LOPEX: reflectance 0.10-0.15,
  transmittance 0.06-0.12 at 550 nm), so the sun and sky now also light a leaf from behind, by the card's own
  translucency (default 0.5), under the same cast and cloud shadow; the same rule at the near, mid and impostor tiers (no
  seam). Pines and scales unchanged. Tropical canopies +4.5 L* from above; Teton and the Serengeti unchanged.
- **A fair judge** (`tools/probes/sheet.py`, `capture.mjs`): the composite's reflectance through the capture's own light,
  exposure and ACES, beside the old stretch. Through it the canopies sit within 2 L* of their reflectance and the open
  ground is the outlier (docs/probes-2026-11.md, iteration 3).
- **The registry knows the pipeline's models** (`pipeline/registry.py`): the eleven Serengeti models are fidelity 3 (own
  mesh, skinned, the leg engine), with credits, attempts and how each was sized.

## 2026-11-06: phase 1, iteration 4: groups from social organisation (branch claude/sweet-feistel-2054bb)

- **Group sizes from Prox and Farine 2020** (`pipeline/sociality.py`; CC BY 4.0, figshare 10.6084/m9.figshare.8208959):
  PanTHERIA has no social group size for the lion, so the Serengeti's lions came in the ambush archetype's 1-4. This
  scoring of 180 mammal societies gives each an average group size and a fission-fusion flag: a fission-fusion society
  (a pride, a hyena clan, an elephant family) is seen in its subgroups, [g^0.5, g^0.75]; a cohesive one (a wild dog
  pack, a cheetah coalition) whole, [g/2, g]; capped at 30 a group. Lions 3-4 (pride 7), hyenas 7-17 (clan 45), wild dogs
  4-7, cheetahs 2-3, elephants 4-8, buffalo 30. It comes before PanTHERIA; PanTHERIA, then the archetype, where it has no
  row. Rows are matched by the genus column and the epithet beside it ("Leo panthera, males"; "Acynoncyx jubatus").
- **Ground brightness, a preview for Aaron** (notes folder `ground-albedo/`): the home tile and the Serengeti with the
  terrain at its measured reflectance (x0.46 NAIP, x0.38 Sentinel-2), page-side only. Held for Aaron's look decision.
- **Rock walls coloured by their strata** (`pipeline/strata.py`, terrain.js `strataUniforms`; tile-spec "Stratigraphic
  column"): where the map's units sort by elevation (superposed along their contacts, bases fitted as gently dipping
  planes), a steep face takes the lithology and colour of the band at its height, the colour read from each unit's
  own description (cliff sentences first), else a lithology table; uniforms only, no sampler. The Grand Canyon tile gets
  ten bands, Kaibab to Tapeats; the other probes none. Two fixes found on the way: a description's rock class is the rule
  it names most (the Hermit Formation was alluvium by one "sand dune"), and the geology fetch's gap filling stops at
  600 queries, not 80 (a quarter of the Grand Canyon tile was unmapped).
- **A tile's own ground plants** (`forbs.js` forbSet, `forage.js`): the herb layer's 24-species atlas was fixed at load
  for the whole library (21 slots used by California and Olympic forbs), so no other region's ground plants could ever
  draw. It is now chosen per tile from its own mix (its ground species and riparian rows, ranked by cells), the library
  set filling empty slots only where a tile may borrow the class weights. Two old bugs fixed on the way, which change the
  home tiles' look slightly: the atlas was flipped (slot k drew species 23-k's picture; poppy and both lupines were
  invisible) and the colours were decoded twice (dark leaves drew black).
- **Dwarf shrubs are ground plants** (`plantgen.py` v3, `species_mix.py`): a woody card topping out at 0.5 m or less
  gets a `ground` block from the card (a mat as wide as height x crown ratio, leaf colour by season, flowers and berries
  in their months) and goes to the ground layer as a carpet (a third density byte: the carpet's share of the shrub
  cover). Lofoten's heath now carries crowberry and heather mats; they read as sparse dark mats more than a carpet, and
  the junipers (0.7 m, still shrubs) draw far too large.
- **Stems fill the cover** (`species_mix.crown_fill`): on tiles outside the regional tables a row's tree density is
  multiplied by the library's median California crown (318 m2) over the row's mean crown, 1-3x: Manu's stilt and stem
  palms (10-24 m2 crowns) had left the measured canopy open.
- **A tile's own trees** (`pipeline/tree_cards.py`, the `plants` step): the canopy's dominant trees chosen from open plot
  inventories within 250 km (by importance value), open descriptions of the place, and the tile's GBIF records of species
  WCVP calls trees (Kew, CC BY 4.0; introduced species dropped), then a sourced trait card for each (every value cited,
  null where no source had it). Manu and Corcovado draw 20 neotropical species instead of Borneo's dipterocarps. The
  palms stand on a broadleaf template until treegen has a palm architecture (Corner's model). Some research records cite
  pages that are not openly licensed: only facts (heights, leaf sizes) are taken from them, never text or images.
- **Birds get bodies of their own** (`tools/build_bird.py`, `fauna_models.py --kind birds`): the archetype decides the
  pose asked of Meshy (soarers in flight, the rest standing), the parts come from the geometry (wing roots where the body
  thins, legs traced up from the feet, the neck walked from the bill), standing birds get generated flight wing cards,
  size from mass at a feathered outline's density (150 kg/m3 standing, 250 for a soarer's body). The rule chose the
  lappet-faced vulture, marabou, ostrich, Egyptian goose and blacksmith lapwing: 150 credits, all first attempts
  (balance 1,727). Bird slots now alternate a size-weighted and a sighting-count ranking (the Serengeti's birds had been
  starlings and weavers only). Reptiles (sprawling legs) need their own build: notes in the probe report.

## 2026-11-06: phase 1, iteration 5 (branch claude/sweet-feistel-2054bb)

- **Reptiles were never researched** (`research.ANIMAL_CLASSES`): GBIF's backbone no longer has a class Reptilia (key 358
  returns no records anywhere); its reptiles are the classes Squamata, Testudines and Crocodylia. Every tile's research
  listed no reptile. The three are now faceted and ranked together as reptiles: the Serengeti lists the Nile crocodile
  (151 records), Mwanza flat-headed agama, leopard tortoise, Nile monitor, striped skink, flap-necked chameleon, the
  African rock python and the puff adder.
- **Birds' kin by way of life** (`pipeline/avonet.py`, `fauna_slots.kin_for`; AVONET, Tobias et al. 2022, CC BY 4.0): a
  bird's kin now comes from its primary lifestyle (terrestrial, insessorial, aquatic, aerial), its Hand-Wing Index and
  flightlessness (the ratite and penguin families, or an index under 1), before the family rules. A flightless slot never
  takes off: its flush is a run at its own cruise speed (the ostrich ~7 m/s), it stands at night instead of roosting,
  and its stride, speed and flush distance scale by its trait card's gait. The Serengeti's lapwings and starlings walk
  the grass (quail machinery); Lofoten's auks and loons swim, its oystercatcher and pipits walk. Static species unchanged.
- **Every species chip has an image** (`pipeline/stills.py`, the `stills` step): a modelled species is rendered by the
  page that made the hand-made stills (same framing, light and size); a stand-in reuses its kin's still at the slot's
  scale (it is drawn with the kin's body); the client falls back to a glyph. Manu's chips: 40 of 40 empty -> 0.
- **Canopy height from the map** (`pipeline/canopy_top.py`, the `canopy_top` step; `stature.js cellStature`): where a
  tile has the measured canopy height (Meta/WRI, global tiles), each 30 m cell's tree mix is scaled so the stand's top
  matches it, keeping each species' relative stature, a sourced height only moving by what lies outside its range, crown
  widths kept. It went the other way from expected: the tropical canopies drew about twice the map (Manu 42 m vs 19 m)
  and now match it (18.2 / 19.2, Danum 23.3 / 23.1, Corcovado 22.2 / 21.9). Open question: Meta's first canopy map
  is reported to underestimate tall canopies; the cards' sourced 40-55 m dipterocarps disagree with it at Danum. One
  function (`speciesScale`) decides which wins. Lidar and LANDFIRE tiles unchanged.
- **Shrubs drawn at their own size** (`stature.js shrubSlot`): one shrub slot in twelve drew common juniper as its
  Sierra juniper template's 15.5 m snag (820 dead trees on Lofoten); a shrub slot outside 0.5-2x its class's height range
  now draws a slot that fits (junipers 0.13 / 0.51 / 0.71 m at the 10th / 50th / 90th percentile vs the card's 0.2-0.7).
- **Heath as heath** (`forbs.js`): the carpet laid as a mosaic of closed patches and gaps holding the cell's cover,
  domed mats lying on the slope, heather's purple in its months (the ground layer now follows the day shown, not the
  season's middle), reaching 80 m at eye height and 260 m from 150 m up. Lofoten's probe pose moved by rule onto the
  heath cell with the highest carpet cover near the old one (201 m away).
- **A tile's own grass** (`grass.js`): a tile outside the regional tables never borrows California's grasses (the
  Serengeti had drawn mostly wild oat); where its grasses have no record, a generic perennial tufted grass coloured by the
  tile's measured season.
- **Palms as palms** (`treegen.js` palmSkeleton, plantgen v4, tree_cards palm_block): Corner's model, one unbranched stem
  (or a clump), a crownshaft, a spiral of pinnate or palmate leaves with leaflet strips, ringed and spined stems, stilt
  roots, at every tier including the far impostor bake; driven by card fields from the palms' sources (Henderson 1990,
  Henderson & Galeano 1996 and others). Near-tier palms cost 700-1,300 triangles against 2,600 for a broadleaf emergent.
- **The grass follows the tile's own seasons** (`grass.js`): on a tile outside the regional tables a grass's record
  palette was rescaled to California's July sward times the measured ratio, so the Serengeti's wet-season February drew
  straw; outside July's own season (by the tile's season months) a tile's own grass now keeps its record's palette. The
  Serengeti in February is green, July red-straw; Lofoten and Teton unchanged. Still California's: the winter grass shape
  (half height, last year's dead leaves).
- **Reptiles with legs** (`tools/build_reptile.py`; `pipeline/amniote.py`, Myhrvold et al. 2015 amniote life-history
  database, CC0): feet within 0.6 % of the length of the floor in four corners (the rear third ignored for sprawlers, so
  a tail on the ground is not a foot), legs as the pieces reaching a foot beyond the flank (or under a tortoise's
  shell), pivots at the shoulder and hip, the tail behind the hips, the neck at the narrowest point behind the head;
  size from mass at 1,000 kg/m3 (EltonTraits has no reptiles: the amniote database's masses replace the cards'
  defaults, the crocodile 94 kg); the palette vote; a gate that refuses unusable meshes, run on the untextured preview
  before paying for the refine. The Nile crocodile, Nile monitor, leopard tortoise and Mwanza agama: 120 credits, all first
  attempts (balance 1,607; the Serengeti 750 of its 800). Client: a sprawler and a tortoise template; crocodiles bask on
  the bank in the warm hours and float in the water otherwise, hurrying in when threatened; tortoises walk slowly and
  freeze; lizards bask on the fence lizard's machinery without its Sierra season. Reptiles get up to 6 slots beyond the 40
  (client cap 48). Snakes have no rig and are skipped with a reason.

## 2026-11-06: phase 1, iteration 6 (branch claude/sweet-feistel-2054bb)

- **A grass's shape through the year from its own record and the tile's measured season** (`grass.js` ownSeasonCurve):
  on a tile outside the regional tables the sward's height, dead leaves, leaf length and heads no longer come from
  California's season rows (half height, no heads and 35 % grey thatch in "winter", which drew the Serengeti's rainy
  February as a short, dead sward). They come from the open grass's measured NDVI of each month (the manifest's
  client.season_rgb classes, open_grass else grassland): the live share is the month's NDVI on the tile's own range (a
  swing under 0.15 a year mutes it), and a small standing-grass cycle run to steady state turns it into the rest: what
  dies back is this year's straw, a third of it weathers each month into last year's grey leaves, a fifth of all standing
  dead goes each month (grazing, trampling, fire); the height follows the standing total, growing half the way a month
  and dropping with it, above a base of 0.5 for a perennial tussock and 0.3 for an annual (the records' `lifespan`,
  weighted by share of the sward); thatch = `cure` x grey share, leaf length 1 - 0.35 `cure` x dead share (the records'
  `cure`, until now unused). Heads in each record's `heads.months` as calendar months at the tile, wrapping the year, to
  four months past the last; the generic tufted grass's in the two months before the tile's greenest and in it (Lofoten:
  June-August, its old months). `dry` stays the season's (the chaparral field reads its season from it). Serengeti
  (red oat grass, cure 0.8, perennial): 15 Feb height 0.98 of full, thatch 0.13, no heads (was 0.5, 0.35); 20 Apr 0.99,
  heads up (was 0.5, none); 15 Jul 0.98, cured, thatch 0.19 (was 0.9, 0); 15 Oct 0.80, half the leaves grey, shorter
  curled leaves (was 0.8, 0). Lofoten 20 Jun: 0.77 still growing, thatch 0.10 (was 0.9 and summer-cured leaf 0.8).
  Teton, California, the Hoh: the rows as before (uniforms identical). No record field added: `lifespan`, `cure` and
  `heads.months` were enough. Open: a season picked without a date reads the north's mid-quarter month (seasonMonth),
  not the tile's own; a record's months are taken as written for the tile, with no hemisphere shift for a record from
  elsewhere.
- **Canopy heights settled by a second and third map** (`pipeline/canopy_maps.py`, `pipeline/canopy_top.py`, the
  `canopy_top` step v2). Two more open maps of each global tile's canopy, read by window over anonymous HTTP: Meta /
  WRI's **CHM v2** (Brandt et al. 2026, arXiv:2603.06382; the same 1 m method retrained on far more airborne lidar; AWS
  open data, CC BY 4.0 by Meta's registry entry, `forests/v2/global/dinov3_global_chm_v2_ml3`, zoom-10 quadkeys) and
  **ETH Global Canopy Height 2020** (Lang et al. 2023, Nature Ecology & Evolution; 10 m from Sentinel-2, calibrated on
  GEDI RH98; CC BY 4.0; the ETH library's public share over WebDAV, 3-degree COGs). Stand tops (the step's statistic,
  30 m cells with trees, p50 / p90, m): Danum v1 21.6 / 30.0, v2 31.1 / 46.9, ETH 46.2 / 50.3; Manu 21.0 / 25.2, 26.7 /
  33.0, 33.9 / 36.7; Corcovado 21.3 / 25.4, 26.8 / 33.1, 36.6 / 40.3; Serengeti 6.8 / 11.8, 6.0 / 9.1, 4.0 / 10.0;
  Lofoten 5.2 / 8.1, 5.0 / 8.2, 6.0 / 9.0. The evidence: on held-out lidar v2's mean absolute error is 3.0 m against
  v1's 4.3 and ETH's 8.4, its bias 0.0 m against v1's +2.6, much improved at 30 m and over but still short in the upper
  tail (Brandt et al.); in Moudry et al. 2024 (Ecosphere 15:e70026) Meta's v1 underestimates canopies of every height and
  ETH overestimates low canopies and underestimates tall ones. ETH has no crowns or gaps (r 0.1-0.45 with the 1 m maps
  per 10 m cell, its own SD 7-12 m in the tropics), and at Danum it does not see the edge both Meta maps draw between the
  tall primary forest (v2 40-45 m per km block) and the logged forest beside it (v2 20-28 m): it reads 43-49 m on both
  sides. The rule: **CHM v2 is the stand** (v1 scaled to v2's level by their median ratio fills v2's masked holes: 5 % of
  Danum); **where v2 itself sees tall closed forest, ETH sets the level**: per ~1 km block, ETH's closed-forest median
  minus v2's is added to the treed cells, weighted from 0 at a v2 block median of 25 m to 1 at 35 m, never lowering, a
  block without 100 closed cells not lifted. The lift keeps v2's own contrasts in metres (gaps, emergents); the species'
  sourced heights then hold where they agree with the chosen top (`stature.js speciesScale`, unchanged). A lidar tile
  keeps its point cloud's CHM. Result (p50 / p90 / p95): Danum 36.4 / 52.8 / 56.6 (the primary half ~47 m, the logged
  half ~25 m), Manu 27.9 / 34.7 / 36.5, Corcovado 28.9 / 36.0 / 38.4, Serengeti 6.0 / 9.1 / 10.1 and Lofoten 5.0 / 8.2 /
  9.8 (v2 as it is). The probes' fair judge (L_render vs L_fair, overlap_fair), before -> after: Danum 27.5 -> 25.7 vs
  20.9, 0.067 -> 0.077; Manu 30.0 -> 28.3 vs 26.9, 0.119 -> 0.134; Corcovado 24.0 -> 23.1 vs 23.1, 0.134 -> 0.144;
  Serengeti and Lofoten unchanged (38.2 / 0.387, 33.1 / 0.495). No independent site reference reached anonymously: GEDI
  L2A needs an Earthdata login, ETH's filtered RH98 footprints on Zenodo are 29-40 GB archives (and ETH's own training
  targets), Meta's lidar test chips miss all five tiles, and the site papers found (Taylor et al. 2015, Osa lidar tops to
  67 m; Shenkin et al. 2019, Danum's 100.8 m Menara) give maxima, not stand-top distributions. Open: Manu and Corcovado
  sit just under the gate (v2 closed medians 26.9 and 27.1 m: lifted 1.4 and 2.0 m on average where ETH says 7-10 m
  more); a lidar or GEDI reference there would settle whether the gate should open lower.
- **A model coloured as its species is described** (`pipeline/appearance.py`, `fauna_models.py`): the generic texture
  prompt ("natural colours and markings of a wild adult ...") gave the leopard tortoise a brown and orange shell with no
  blotches, the Mwanza agama the orange head of the red-headed rock agama, the Nile monitor no yellow spots, the
  blacksmith lapwing red legs and the leopard grey-white legs. Now every species gets an appearance step, one rule for
  all: its Wikipedia article (lead and description sections) and its Animal Diversity Web account (Physical
  Description), plus the genus article when neither gives the body's colour (the Masai giraffe's article only describes
  the spots' shape). Kept: sentences that name a colour and a body word. Dropped: the young, change with age ("fades to"),
  morphs and captives, regional variants, other taxa, extinct forms, non-body matter, and female-only clauses when the
  male is described. Each colour phrase is placed by rule: just before a pattern word it is a marking; just before a body
  word, that region's; otherwise the colour of the clause's subject. Stored as facts only (colours and markings by
  canonical region, source URLs, the Wikipedia revision) in `library/animals/appearance/<code>.json`, beside the trait
  cards, not in them (fauna.py may rewrite a generated card). A summary built from those facts leads the refine's
  texture prompt. After the build, a check compares the GLB's vertex colours by region (parts; the body split by normal
  into back, flanks and belly) with the described colours: CIEDE2000 at kL 2 within 16, counting the colours between two
  named chromatic ones. A described region passes when half of it matches and the whole model when 60% does, and each
  described marking must cover 1.5% of its region. A failure is re-refined once from the same preview (10 credits; the
  mesh is kept). That prompt carries a correction naming what the check found ("shell yellow, not cinnamon or orange").
  The build with fewer failures, then the higher score, is kept. `--check` and `--recolour [--codes]` do this for the
  library; `--rebuild` takes `--codes`. Of the 20 models, 5 failed. 60 credits were spent (balance 1,607 to 1,547):
  agama 0.55 to 0.94, passes (red head, dark blue body); lapwing 0.93 to 1.0, passes (black legs); leopard 0.80 to 0.82,
  passes, barely changed; tortoise twice, 0.43 to 0.43, now golden with black blotches but still failing, because
  Meshy's albedo for "yellow" comes out amber or ginger (its thumbnail is lit and looks yellow); Nile monitor 1.0, the
  re-refine came out grey and was rejected, still without its yellow spots. Open: a texture reference image for colours
  Meshy will not take from words (the tortoise's straw yellow, the monitor's spots). The vulture's bare pink head and
  the lapwing's grey wing coverts appear only in regional or comparative sentences that the rule drops, so the check
  cannot see them.
- **The heath as a carpet; the juniper built as a shrub** (`forbs.js`, `shrubfield.js`, `treegen.js`, `plantgen.py` v5).
  Lofoten's probe pose (`b_heath_eye`) was mostly not the carpet: the shrub field's chaparral program draws chamise and
  manzanita in every shrubland cell (class 4), so the heath was under California's domes (the manzanita's red
  branching was the "striped" mats), and the foothill shrubs (the junipers) filled the whole shrub cover again as if it
  were chaparral. Two rules: a tile outside the regional tables (`class_fallback` false) draws chamise and manzanita
  only where its own mix lists them (California and Teton unchanged); and a row's carpet share (`density_bytes[2]`) is
  the carpet's, so the shrub field takes the rest of the cover (the heath's junipers 0.4 -> 0.07). The carpet itself:
  each mat a clone's patch, 1.8x the card's crown width at the card's height, a plateau with rounded shoulders
  (side view and top quad: the ground quad is now a centre, two rings and the square, which keeps the herbs' pictures
  exactly), growing across rather than up where it is closed or thinned; its places on the R2 sequence (every prefix
  even) so closed patches close and the distance thinning thins evenly; drifts of old wood and fresh tips and of
  heather's flowers inside a mat, a clone's own warmth; and a translucent skirt round each mat (its shade and litter)
  shown only where the carpet closes, so the ground between overlapping mats takes the carpet's tone. Mats staged
  19,000 -> 10,300 (4.51 -> 4.27 M triangles in the frame); the frame within the noise of a loaded machine (eye 14.4 /
  15.3 vs 16.5 / 13.5 ms, 10 m up 12.8 / 13.2 vs 11.4 / 11.1). The juniper: treegen reads a shrub's level-1 `count`
  per stem and a tree's per plant, so the Sierra juniper template's 36 limbs grew on each of 3-8 stems (3,900-5,900
  wood triangles of its 2,200 budget, foliage left 6-12 cards). plantgen now marks a shrub on a tree template
  `count_of: "plant"` (treegen shares it among the stems) and drops the tree's snag (a 16-30 m dead juniper; no
  library shrub has one): its near tier 250-1,300 triangles, no warning. Only the juniper was a shrub on a tree
  template. Still warning (not this rule): 28 classes of 22 records at 70-106% of their budget
  (cornus sericea's old class 1,464 of 1,300, rubus parviflorus and spectabilis young 1,320 and 1,380 over), and the
  generated trees' snags keep their templates' heights (birch 3-8 m with 10-18 m snags, vine maple 3-8 with 14-24).
  Open: the heath's gaps are the photo alone (no moss or grass drawn where the herb cover is 0), so open ground with a
  few small mats still reads as dots on a lawn from 10 m up.
- **Snakes as a body plan** (`tools/build_snake.py`, `fauna_models.py --kind snakes`, `fauna_slots.py`, `animals.js`
  snUpdate, `animalModels.js` SNAKE_BODY): a snake slot was skipped ("no snake rig"); now it is a slot on the fence
  lizard's cells and sites with the way `snake`, drawn only by a model of its own (no stand-in body: a lizard is no
  snake). One build for every snake: the Meshy mesh (asked for a snake lying stretched out in one gentle S, no coils,
  nothing of the body touching another) is remeshed closed, its two ends found as the vertices farthest apart along the
  surface, its centreline traced (each vertex projected onto the line within a window of its arc guess, so the inside of
  a tight bend is never taken for the other arm; slices 0.6 of a radius thick, smoothed), the head the thicker end, then
  straightened along +z on a rotation-minimising frame with each section's lowest point on the floor (a raised head laid
  down), sized by mass at 1,000 kg/m3 (the volume before straightening), coloured by the palette vote, the neck at the
  first narrowing behind the head. Gates: taller than 0.35 of its extent, in pieces, a jumping line, no taper, not
  slender (under 10 diameters), standing up, something besides the body, over 0.2% of edges stretched 3 times. The
  pipeline builds a snake's untextured preview first and pays the refine only if it passes; a paid preview no refine was
  made from is tried before a new one. The template (`RIG.snake`, no per-species constant): each vertex's pivot is its
  centreline point (z its arc); the shader draws the centreline again as headings integrated from the snout in 40 steps
  with the mean point and heading taken out: lateral undulation (a wave standing in the ground's frame as the body
  slides, the head steadier, 1.35 waves at 0.65 rad crawling, a 0.75-wave gentle S at rest), a turn's C, a flat spiral
  coil (tail tip inside, the loops touching), the head rigid and turned about the neck, the fore body raised when
  alert, the middle following the ground's hump or hollow under the chord. The machine: basks near its cover (a rock,
  a trunk, else a patch of ground) while it is warm (the basking lizards' lzWarm, not the slot's diet-guessed hours:
  EltonTraits has no reptiles and the default made a garter snake nocturnal), coiled under 22 C, stretched out above;
  glides to another spot now and then (0.12 m/s at 0.4 kg, slower when heavier); raises its head at 1.8 times its
  flight distance (2.2 m times the root of its length); dashes (0.9 m/s) into cover and is gone until the player is
  twice as far. Snakes in the research: Lamar's terrestrial garter snake (28 records), Teton's, Corcovado's fer-de-lance,
  the Amazon tree boa and Danum's pit viper; the Serengeti's rock python and puff adder have 3 records each, under the
  threshold. Lamar's garter snake: 60 credits (a preview the gate refused: head reared, body crossing itself; a second
  that passed, its refine, one re-refine for the colour check kept the first), 0.71 m, 1.6 cm radius at 0.4 kg (the
  amniote database). Open: it is yellow all over: the appearance research reads Wikipedia's stripe colours as the body's
  ("body yellow with yellow stripes") and the check passes it (0.996); a garter snake is dark with yellow stripes. The
  appearance rule needs the ground colour of a striped snake, then a 10-credit re-refine. Also: `register` now merges
  into a fresh read of the registry (a mammals run started earlier wrote its stale copy over the snake's entry).
- **Wolves were never researched** (`fauna.py` DOMESTIC, `_less_dogs`): "Canis lupus" was on the domestic list so that
  dogs (C. l. familiaris) would not count, which removed the gray wolf from every tile, Yellowstone included. The species
  stays; the dog subspecies' records on the tile (GBIF key 6164210) are subtracted. Still on the list and wild in their
  native ranges: Sus scrofa, Anser anser, Columba livia, Oncorhynchus mykiss (a range test is the fix).
- **Chaparral only where a row lists it** (`shrubfield.js`): the shrub field drew California's chamise and manzanita in
  every shrubland cell of a regional-table tile; Yellowstone's sagebrush steppe was covered in manzanita domes. A
  shrubland cell now draws chaparral only where its own row lists a chaparral species (California's chaparral rows do).
- **The judge rejects a model that fails its species** (`fauna_models.model_for`, `models.json` `judge`): a model whose
  defining features are wrong is not drawn and the slot keeps its stand-in; the paid job stays for a retry from a
  reference image. Rejected: the mountain goat (an ibex's long curved horns, brown patches), the American badger (a
  raccoon's ringed tail), the terrestrial garter snake (all yellow: the colour research read the stripes as the body).
- **canopy_top on a fresh lidar tile** (`steps._canopy_top`): the step read the lidar CHM's source from the manifest
  before the lidar layer was recorded, took the global path and failed; it now also checks the lidar status.
- **A second tile end to end: Yellowstone's Lamar Valley** (`utm12n_557_4964`, the US path with a 2.25 billion-point lidar
  cloud): 13 models chosen by rule and generated for 400 credits (bison, wolf, grizzly, bighorn, pronghorn, mountain
  goat, badger, golden eagle, white pelican, sandhill crane, the garter snake; the moose failed the leg gate twice, 60 of
  them), 3 rejected by the judge; balance 1,087 (all of iteration 6: 520 credits). From the air it reads as the Lamar
  Valley. At eye height it is not ready: the big sagebrush draws dark (the shrub field's own lighting darkens its grey-
  green record) over bare ground (the steppe's rows list no grasses: the tile is in no natural-region table and the
  library's grasses are California's). Next: a ground layer of the northern Rockies' bunchgrasses and silver shrubs.

## 2026-11-06: the image leaves out Meshy's raw job outputs

With iteration 6's 13 Lamar Valley models the image reached 1.7 GB, 776 MB of it in `library/animals/jobs`: every Meshy
task's downloaded model, textures and thumbnail, kept so a paid result is never lost and the credit ledger can be read
from the job records. The server and client read none of it; what the client draws is the built, rigged model in
`client/assets/fauna`. `.dockerignore` now leaves `library/animals/jobs` out. The job records stay in git and the raw
files stay on disk in the main checkout. A job is copied into its own task folder only, never one level up, or the
ledger counts it twice.

Iteration 8 brought the image to 1.4 GB (v36) with the pipeline's build-time caches of reference photos, their
segmentations and the model-check builds (`pipeline/_cache/references`, `segmentation`, `verdict_builds`, about 470 MB).
Only the pipeline reads them while it builds models, so `.dockerignore` leaves them out too.

The hosted server never answered `/api/weather` (503 since the weather step): `pipeline/fetch_weather.py` imports
`requests`, which the image did not install, and the bare except turned the import error into "weather unavailable",
so every client fell back to last year's day. The Dockerfile now installs requests and tzdata.

## 2026-11-06: phase 1, iteration 7 (branch claude/sweet-feistel-2054bb)

- **The riparian weight rides in the cover texture's alpha; the micro patch's program fits in 16 texture units**
  (`terrain.js` coverTexture): since the micro patch (2026-10-28) its program sampled 17 textures where the GPU has 16
  (MAX_TEXTURE_IMAGE_UNITS): the terrain fragment shader's 16 (cloudMap, csmMap0-2, map, masks, roads, canopyMap,
  contactAO, seasonMap, waterMap, detailAlbedo, detailNormal, detailMask, ripMask, mcNrm) plus mcDisp in its vertex
  shader. three warned "Trying to use 17 texture units" on every frame the patch was drawn (the camera within ~4 m of
  the ground, on every tile, not Lofoten alone: all five logged it at eye height, none from 150 m up). The riparian
  weight (ripMask, an R8 texture on the 333 px habitat grid) now rides in the alpha of canopyMap, whose canopy.png is on
  the same grid and whose alpha was unused: one RGBA DataTexture, the same texels, filters and GPU mips, so the ground
  is unchanged to the bit. Checked by rendering the same frozen frame with the old program and textures restored in
  the page and with the new: 0 pixels differ at 20 poses on Lofoten, the Serengeti, the Grand Canyon, Lamar and the
  home tile, also with the riparian tint forced on (which moves up to 490,000 pixels by up to 59 levels, so the test
  sees it); no tile logs the warning now. The terrain program is at 14 units, the micro patch's at 16: a new sampler
  for the ground must replace one (pack it into a free channel), not add one.
- **A tile's own ground layer outside the regional tables; sagebrush in its record's colour** (`pipeline/ground_cards.py`,
  the `plants` step v4, `species_mix` v3; `grass.js` grassSet / ownGround, `forbs.js`, `shrubfield.js`). Yellowstone's
  Lamar Valley and Grand Teton are LANDFIRE tiles in no natural-region table, so their rows listed no ground species
  (the library's grasses are California's) and the sagebrush steppe drew dark green domes over bare ground. Choosing the
  species, one rule for every such tile: each EVT and BpS community gets its **LANDFIRE BpS model description** (public
  domain, USFS / DOI / USGS / TNC; the docx named by bps.csv BPS_MODEL, fetched from landfirereview.org's document
  zipper, read as zip + XML, cached in `pipeline/_cache/landfire_bps/`). A BpS row has its own model. An EVT row takes
  the same system's model in the tile's map zone, else the BpS under most of its cells (a ruderal grassland on a
  sagebrush site takes the steppe's grasses). From it: the Dominant and Indicator Species table (weight 1.0), then the
  binomials of the Vegetation Description (0.5). Names are resolved by the **USDA PLANTS Database** (public domain; old
  names followed), and "Genus spp." becomes the tile's most-recorded native congener. Kept: grasses (PLANTS growth
  habit Graminoid) and forbs (Forb/herb), native in the lower 48, with a GBIF record within 0.5 deg; up to 6 + 6 per
  community and 11 grasses / 16 forbs per tile (the grass layer's slots), by cells x weight. NatureServe Explorer was
  not used (its terms are not CC). Lamar's montane sagebrush steppe (BpS 11260_21) gets bluebunch wheatgrass, Idaho
  fescue and Sandberg bluegrass from the table; squirreltail, slender wheatgrass and needle-and-thread from the text;
  and sulphur buckwheat, arrowleaf balsamroot, silvery lupine, low larkspur, Cusick's paintbrush and sticky geranium.
  Prairie junegrass is named too but is the seventh grass. Spruce-fir and lodgepole rows get elk sedge, Ross' sedge
  and heartleaf arnica; aspen rows get bluejoint. The **cards are written by rule from PLANTS characteristics**
  (a species without its own takes its nominate infraspecific taxon's): height (Height, Mature), live leaf colour
  (Foliage Color lexicon), the seasons from Active Growth Period (live, curing, cured straw, weathered grey, a calendar
  quarter each), flowering months (Bloom Period), flower colour, cure (0.8 spring-only growth, 0.6 into summer, 0.4
  evergreen), shade; a Triticeae grass heads in a spike, others in a panicle; a forb's flower and leaf shape by family.
  36 cards (Lamar 27, Teton adds 9; region tag `landfire_mz21`, not a natural region), grown by plantgen. Their records
  have **no habitat-class weights**, so they are drawn only where a description names them, never from a regional
  tile's class fallback (the home tile and the Hoh draw exactly what they drew). species_mix writes `natural_regions`;
  where it is empty, grass.js and forbs.js borrow nothing (`ownGround`, as for class_fallback false). The grass layer's
  species are now chosen per tile (`grassSet`: a tile's own grasses by cells; a regional tile's, the library grasses of
  its regions; an older mix, the library-wide set as before). A shrubland cell whose own row lists grasses gets grass
  at 0.8 of grassland density, with the herb floor 0.6 under a shrub canopy (LANDFIRE's EVC gives such a cell herb 0;
  the steppe's description says 40-85 % herb cover). **The sagebrush's colour**: the shrub field turned a record's
  sRGB into albedo with a per-channel factor fitted to chamise alone, `[0.6, 0.6, 0.48]`. That darkened every foothill
  shrub by 40 % and cut its blue by half, so grey-green 134,138,120 drew dark olive. It also pulled 20 % toward the
  ground photo's hue. Now the albedo is linear x 1.3 on every channel. The 1.3 was measured so that the impostor matches
  the same species drawn by treegen at the same light (big sagebrush 1.44, coyote brush about 1.2). There is no ground
  pull for a foothill shrub (the chaparral domes keep theirs). A shrub missing from the look table takes chamise's fine
  picture when its record's leaves are 25 mm or under. On Lamar the impostor now renders at about the treegen sage's
  luminance, linear G 0.100 vs 0.103 (was 0.047). Side effects of the same rule: the home tile's foothill shrubs (toyon,
  coyote brush and the others) draw about twice as bright in linear, the chaparral is unchanged; red huckleberry on the
  Hoh and Lofoten's junipers take the fine picture. Open: from 10 m the sage reads as smooth grey stones (the far
  impostor's dome shading); the steppe's sage cover still looks closed near the camera; the grassland rows' pooled
  dwarf shrubs are California's Brewer's mountain heather (communities.LEXICON's "alpine dwarf-shrubland"), 16-24 % of
  the ground weights; bloom months are PLANTS' range-wide ones, uncorrected for elevation; the bedrock-and-scree EVT
  takes the subalpine woodland's sedges at 0.2 density.
- **A second rung from a reference photo; a feature check; Lamar's rejected animals redone** (`pipeline/reference_photos.py`,
  `pipeline/appearance.py` features and checks, `pipeline/fauna_models.py` --redo / --judge, `tools/build_quadruped.py`,
  `tools/build_snake.py`). Iteration 6's judge kept three of Lamar's models off the tile (the mountain goat's ibex horns,
  the badger's raccoon tail and mask, the garter snake yellow all over), the moose failed the leg gate twice, and the
  pronghorn's impala horns and the grizzly's pale blotch were drawn. Sized at 140 credits (160 at most) before spending;
  spent 290 of the 350 allowed (balance 1,087 to 797), every job folder copied to the main checkout's
  library/animals/jobs/<code>/<task_id>/.
  - **Reference photos, one rule for every species**: iNaturalist research-grade observations whose photos carry CC0,
    CC BY or CC BY-SA (each photo's own licence checked), those within 300 km of the tile first (a photo from elsewhere
    scores 0.75 of a local one: the first garter snake photo was a coastal red-spotted form), adults first; and Wikimedia
    Commons files in the species' category whose licence is CC0, CC BY or CC BY-SA. 36 + 24 candidates per species, each
    fetched into its own folder in the git-ignored cache and read as image data. Scored by rule after a GrabCut cut:
    whole (not cut by the frame), side-on (wider than tall), size, one animal, legs clear, standing square, plain
    background, the described colours. The store, `library/animals/references/<code>.json`, keeps every candidate's
    licence, author, attribution line and page; the job that uses a photo carries it (`reference.png`, `reference.json`)
    and models.json records the chosen photo's attribution. GrabCut without a learned model takes rocks and hillsides for
    the animal on busy photos, so the scores make a shortlist and the judge picks from its contact sheet against the same
    criteria (`--pick`, recorded with the rule's rank and the reason: the rule's first was kept for the pronghorn; for the
    others a lying badger, a range map and tall grass hiding the legs ranked first). A second photo comes from the judge's
    shortlist only (the rule's order once gave the badger a photo of it lying down).
  - **The feature check** (`appearance.feature_check`, part of the check): the same sources are read for what the colour
    facts leave out: each measurement (number and unit, a range) given to the subject named nearest before it in its
    clause or to the phrase after it ("at the shoulder", "from nose to tail"), bracketed conversions and horn spans
    dropped, the median of the figures kept; the horns' words and colour. On a quadruped's GLB: the horns are the thin
    pieces standing out above the skull (the head part voxelised and opened by a ball of half the skull's thickness), in
    the described horn colour, else the head's pieces in that colour; their length over the withers against the described
    horn length over the shoulder height, allowed 1.6 times; the tail (its parts' reach from the root) over the head and
    body; a tail ringed (lightness alternating along it) where the description gives no rings; a pale patch over 5% of
    the back and flanks on a coat described with no markings. A failed horn or tail length needs a new mesh, a ring or
    patch a new texture. The old pronghorn (horns 0.66 of the withers against the described 0.29) and goat (0.45 against
    0.23) and the grizzly's blotch (6%) fail; the library's other models pass, except the elephant (a 28% dusty pale
    back). The mesh prompt now carries the described horns and tail ("Horns short, thin, curved, black, about 23 cm long.
    Tail short, about 15 cm."). The colour check gains **a marking is a marking**: where markings are described, the
    region's ground colours must hold 12% of it (the yellow snake matched its stripes' yellow and passed).
  - **The striped snake's research**: "a yellow, light orange, or white dorsal stripe" gave the back yellow (the region
    word "dorsal" stood between the colour and "stripe"); a region word before a pattern word is now the marking's place,
    modifiers are skipped in colour lists, "bellies" is a region, and "some varieties / occasionally" sentences go. The
    garter snake: back greyish-green with yellow, light orange or white stripes, belly yellow, yellow side stripes.
  - **The second rung** (`--redo`, and run() after a gate failure or a geometry failure): a geometry failure, a judge's
    rejection or no model is tried with Meshy image-to-3D from the photo cropped to the animal (30 credits; the quadruped
    build turns it side-on, snapped to the quarter turn, head end by rule), a second photo when the first one's mesh
    fails the gate; a texture failure is first re-refined from the text with the check's correction, then once with the
    photo as the refine's texture reference (10). A snake's rung is always the texture reference. Image-to-3D copies the
    photo's pose: two goat, two badger and both moose photos walked or turned their heads, and the gate refused them.
  - **Build fixes found on the way** (`build_quadruped.py`): left and right legs split at the legs' own median x, not
    the bounding box's centre (a moose's lopsided antlers had put both forelegs on one side: iteration 6's "3 leg
    columns"); a tail piece may not stand on the floor and the tail's width test uses the body's rear half (the moose's
    hind leg and hindquarters were taken for its tail); floor contact must split into fore and hind feet with a gap (a
    badger lying down passed as standing). Rebuilt to scratch, the library's other quadrupeds find the same tails and legs as before (the lion's tail cut 1% further back). And
    `build_snake.py` builds each tier as a structured tube cast from the centreline (16 points a ring at lod0) instead of
    a collapse decimation, which lost a garter snake's stripes in long cross-body triangles.
  - **Results** (the judge's verdicts in models.json, each from a render against the description):
    mountain goat, 60 credits, two photos (the first a stride the gate refused): white shaggy coat, short black horns
    (0.32 of the withers against 0.23), **accepted**. American badger, 90 credits, three photos, none usable (two walking
    with a forefoot lifted, one lying down): **rejected**, the slot keeps its stand-in. Garter snake, 30 credits (the text
    re-refine came out ochre with faint stripes; the coastal photo's texture red-spotted; a dark striped snake's photo):
    black-brown with a pale dorsal stripe and pale side stripes, **accepted**; the colour check still fails (cream stripes
    for ADW's yellow, a black back for its greyish-green, a grey belly for its yellow). Pronghorn, 30 credits, one photo:
    short black pronged horns, black face mask, white belly and rump, **accepted**. Grizzly, 20 credits: the photo's
    texture came out near black (an American black bear's look, which the colour check passes because the description
    names "almost black" in the coat's range); the text re-refine with the correction "the coat evenly chestnut, no pale
    patches" is brown with darker legs and a paler frosted band over the shoulders (ADW: Rocky Mountain grizzlies' long
    shoulder and back hairs frosted with white), **accepted** and drawn; the patch rule still flags it (8%): it cannot
    tell a frosting from a blotch. Moose, 60 credits for two photos that failed the gate, then **accepted** at no cost
    from iteration 6's second paid refine once the leg split was fixed: a dark brown bull, pale palmate antlers, dewlap (the patch rule flags 5% pale on it, borderline). Lamar re-linked (animals, stills: 5 chips rendered, 11 modelled slots, the badger's a stand-in); in the world (headless, mirror false) the goat, pronghorn, grizzly, moose and snake draw their own models, no shader errors.
  - Open: a photo's pose binds image-to-3D, so a standing-square photo is the hard part (the stance score does not see a
    lifted foot in GrabCut's mask); the badger needs one, or text-to-3D with the feature lead. A learned segmenter would
    let the rule pick without the judge. The pale-patch rule needs the description's frostings and saddles as markings.
- **California's lexicon stays in California** (`species_mix.named_rule`): a tile outside every natural-region table
  read community names with California's lexicon, so "alpine" put Brewer's mountain heather (a California endemic) in
  Yellowstone's grassland rows as a carpet. There a named species is now kept only where GBIF records it within 0.5
  degrees of the tile: big sagebrush stays, the heather goes.
- **Lamar at eye height, where it stands**: silver sagebrush with bunchgrass and the steppe's forbs; the rejected
  models redrawn from reference photos (mountain goat, pronghorn, grizzly, moose, garter snake; the badger still a
  stand-in). Not yet holding: the sage draws as tall smooth domes (the shrub field's dome shape and size, closed near the
  camera), bare ground between the tufts, and an OSM water polygon by the river that the imagery shows as dry ground
  (a rule to test mapped water against the imagery is next).


## 2026-11-06: phase 1, iteration 8 (branch claude/sweet-feistel-2054bb)

- **Mapped water against the imagery** (`pipeline/water_seasons.py`, a new base step `water_seasons` after `seasons`
  and before `water`; docs/tile-spec.md "Mapped water against the imagery"). The dark polygon by the Lamar River was
  not OSM: it is NHD waterbody 120047263, FCode 46600 (Swamp/Marsh), 6.3 ha, on a meadow; the water step drew every
  NHD and OSM polygon as open water, marshes included (13 of Lamar's 20). Now every polygon is tested against the
  tile's monthly Sentinel-2 composites, which carry red, green, blue and NDVI but no SWIR, so NIR is recovered as
  red (1 + NDVI) / (1 - NDVI): over the pixels wholly inside the polygon (inset 10 m), water is NDWI > 0 or NIR < 0.04
  (a dark algal pond has NDWI near 0); bright pixels (ice, snow, cloud) leave the count so a frozen lake is not dry;
  a month is wet at >= 25% open water. Wet in no observed month: dry (no surface, basin or pond zone; the streams
  through it drawn; `dry_waterbodies` in features.json with its bed, meadow or bare); wet in >= 75% of them:
  permanent; else seasonal (water.js's intermittent ponds). Under two core pixels or three observed months the tags
  decide (NHD intermittent FCodes and 46600, OSM intermittent/seasonal/wetland: seasonal). The evidence per polygon
  (class, basis, core pixels, water fraction per month) is in hydro/waterbody_seasons.json and the manifest layer
  `hydro.waterbody_seasons`; resources' water score skips the dry ones and counts the seasonal with the intermittent
  streams. Results: Lamar 5 permanent, 3 seasonal, 12 dry (108 ha, every marsh; the 44 ha marsh over the braided
  river among them; the lake at 8.7 km east kept); Teton 32 / 1 / 13 (Jenny, String, Taggart, Bradley open in every
  month; 11 marshes and 2 small ponds dry); home 36 / 5 / 8 (the dry ones grassed-over stock ponds and Depot Lake,
  most already rewilded); Lofoten 109 / 1 / 5 (every named lake permanent; dry are two slivers cut across land where
  the OSM fallback closed a multipolygon's member ways one by one); Manu 4 / 0 / 1 (the river and both oxbow lakes
  kept; a 35 ha "lagoon" under closed forest, NDVI 0.8, dry); Serengeti 7 / 0 / 1 (one 1.2 ha river pool dry, the
  rest too small to judge); Danum has no waterbodies.
- **The water step's riparian splice ate the home tile's species mix**: `_water` replaced the first `"riparian":` in
  client/species_mix.json, which on the home tile is a community's share inside `context`; the file was cut short.
  It now replaces the top-level key, checks the result parses back to the rows, and re-serialises otherwise; the home
  tile's file was restored from git and re-spliced (its riparian rows now carry red alder, as riparian_rows gives
  today). The home tile had no step records and was adopted (`--adopt`) to run its steps.
- Open: the Lamar `c_river` pose is not in a mapped polygon; it stands in the Lamar River's channel as NAIP shot it in
  July 2022 (a month after the flood) and as Sentinel-2 sees it, while the drawn river follows the DEM's thalweg 20-30 m
  away, so the photo's water is painted as dark ground (the reverse test, water in the imagery with none drawn, is
  next). Lofoten's Trolldalsvatnet (73 ha) and Ågvatnet rings self-intersect for the same multipolygon reason and
  water.js skips them: real lakes with no surface, before and after (fetch_hydro's OSM fallback should assemble a
  relation's outer ways into rings). A permanent pond's basin is mostly drawdown margin (Lamar's lake reads as mud
  with a small pool) where the imagery shows water to the shore all year.
- **Reference photos chosen by the rule alone; the check fitted to the judge's verdicts** (`pipeline/reference_photos.py`
  mask, pose, usable; `pipeline/appearance.py` colour_stats, colour_fails, described_pale, fit_check, `--fit`;
  `library/animals/models.json` `verdicts`, `library/animals/check_fit.json`). Iteration 7 left two steps to the agent's
  judgement: picking the photo from a contact sheet (4 of 5 species) and accepting three models the check flagged. No
  Meshy credits spent.
  - **The subject mask** is learned now: U-2-Net (Qin et al. 2020) and IS-Net / DIS (Qin et al. 2022), class-agnostic
    salient-object segmenters, Apache-2.0 code and weights, in rembg's ONNX exports (MIT), fetched once each into its
    own folder in the git-ignored cache, pinned by SHA-256, run as data by OpenCV's DNN module (no torch, no model
    code); the mask is the mean of their two maps, cached per photo. GrabCut's rocks and hillsides are gone (the
    badger's rock is cut as a rock, and refused for having no legs).
  - **The pose filter**, from the silhouette: whole (pixels on the frame's edge), size, one animal, clearly seen (the
    width of the segmenters' uncertain band at the outline: twigs, tall grass, blur), a body (the mask's share of its
    convex hull: a museum skeleton of a pronghorn ranked second before), side-on (aspect, and light under the belly
    between fore and hind legs), the head toward an end of the box, legs (the leg zone between belly and ground over
    0.12 of the height, two or more leg pieces) and standing square: each leg piece's lean (the slope of its midline
    in the lower 65% of the leg zone); a stride opens fore and hind legs into a V, so the spread of the leans over 18
    degrees costs the stance (0 at 38), all legs leaning together over 15, and a leg ending 0.06 of the height above
    the ground line (perspective lifts the far feet a little). The photo's colours are counted within the check's own
    tolerance (16, not 32: at 32 every candidate scored 1.0). A photo is usable only when whole, size, side-on, legs,
    stance (0.6), body and clarity pass (`USABLE`; a snake's photo is a texture reference and may lose its tail to the
    frame); none usable, no reference (the photo rung then has nothing to try).
  - **Agreement on iteration 7's cached candidates** (rescored, no downloads but the chosen photos' full size): the
    mountain goat takes the agent's pick (commons_9825969); every photo whose mesh failed the build's gate is refused:
    the goat's stride (lean spread 67 deg), the badger's two walks (44, 95 deg) and its lying photo (no legs), and the
    two moose photos the agent picked (37, 40 deg); also the badger's rock and the moose's three tall-grass photos the
    agent passed over. The badger has no usable photo (the judge rejected all three meshes). The grizzly takes
    inat_469943715, the agent's second (its first, a walking bear, spread 28 deg, is refused; it was only a texture
    reference and that texture was rejected). The moose takes commons_540185, a bull side-on in shallow water. The
    garter snake takes inat_124247019, a local striped snake laid out on gravel; the agent's Commons photo is usable at
    rank 5 (a non-local photo scores 0.75, and its tail leaves the frame); the coastal red-spotted form ranks third.
    Disagreement: the pronghorn takes inat_717073114, side-on with four legs clear but grazing head-down; the agent's
    pick (inat_250877072, whose mesh passed) is refused because grass hides the legs (leg zone 0.15 of the height),
    the same reason the judge gave for passing over the moose's grass photos. A judge's earlier pick stays in each
    store as `judged`; `--pick` remains only as a recorded override.
  - **The check, fitted**: the known verdicts are each species' current model (its judge's verdict, else drawn and
    accepted) and the judged jobs, now recorded in models.json `verdicts` and built again into the cache: the
    iteration-6 goat (ibex horns), the yellow, ochre and coastal red-spotted garter snakes, iteration 6's pronghorn
    (impala horns), the grizzly's cream-blotched and near-black refines, and the leopard tortoise and Nile monitor,
    whose colours iteration 5 recorded as still wrong (labels for the fit, not a judge's rejection: both are drawn).
    39 models, 10 rejected. Rule changes first, each for a reason: grey before a hue names a low chroma (ISCC-NBS
    "grayish", chroma x 0.4: "grayish-green" was a fresh green at chroma 29); one marking per pattern on the body,
    whatever colour each source gives it, looked for on the back and flanks together (ADW's yellow stripes and
    Wikipedia's "yellow, light orange or white" are the same stripes); a snake's underside lies on the ground, unseen,
    and is not judged; a pale patch in a colour the description gives the coat is described, not a blotch (the
    grizzly's frosted shoulders are ADW's "whitish-cream" on the back, the moose's brown and the elephant's dusty red
    and brown are in their coats' colours; the ends of a range, "almost white", do not count). Then a grid over the
    thresholds (match tolerance, the lightness weight of a phrase naming its lightness, region and model pass shares,
    ground share, marking share, patch share), balanced accuracy, ties toward iteration 7's values: the fit kept every
    threshold but the region pass (0.5 to 0.3) and the model pass (0.6 to 0.4), both for the snake's black back against
    its described greyish-green (34% and 44%); a phrase's own lightness (kL 1 for "light brown") was not taken (it
    fails the Egyptian goose). Confusion on the 39 (rejected flagged / rejected passed / accepted passed / accepted
    flagged): iteration 7 9 / 1 / 25 / 4 (the elephant, snake, grizzly and moose flagged); fitted 8 / 2 / 29 / 0;
    leave-one-out 8 / 2 / 28 / 1 (the snake: no other model supports the lower pass shares). Lost: the grizzly's stark
    cream blotch now passes (its band is over the shoulders in a described colour, like the accepted one's: the two
    differ in starkness, which no rule here measures); still passed: the near-black grizzly (its coat is
    "brownish-black", a described colour; the judge saw a black bear's look). No species-specific exception.
    models.json's stored colour checks refreshed: the snake, grizzly and moose pass, the badger's stand-in text model
    fails (no white stripes, a ringed tail).
  - Open: a grazing or head-turned pose is not measured (the pronghorn's pick); the standing test reads leans from a
    silhouette, so near and far legs overlapping in one piece count as one leg; a colour's starkness against its
    surround (a blotch against a frosting) and species identity beyond colour words (a black bear's look) are not in
    the check; the pronghorn and moose now have rule-chosen photos no mesh has been made from.
- **Lamar's sagebrush steppe at eye height: shrubs at the stand's measured height and cover, a grassland between them**
  (`client/src/shrubfield.js`, `grass.js`, `forbs.js`; `pipeline/species_mix.py` stand_structure). Rules, for every tile:
  - *The stand's structure per mix row* (species_mix.json `mixes[].shrub_h_m`, `herb_cover`): LANDFIRE EVH's shrub
    height (codes 201-299, 0.1 m steps) as the median over the row's cells where at least half of them have one
    (none on a synthetic EVH: Serengeti, Lofoten); the herbaceous cover range its community's BpS model description
    gives ("Herbaceous cover is moderate to abundant, ranging from 40-85%": only 11260 of the cached models words it
    so). `python -m pipeline.species_mix --structure <tile>` adds both to a built tile in place (done for Lamar and
    Teton; the rows, index and other keys unchanged); a new build writes them.
  - *A shrub's size*: every foothill-field plant's height comes from its record's age classes; a record's stand height
    is its crown-area-weighted mean height (sum w E[H^3] / sum w E[H^2]); in a row with EVH and no chaparral, every
    plant is scaled by EVH over the row's stand height (within 0.5-2). Big sagebrush's classes run to 2.0 m (stand
    height 1.39 m), EVH 0.8 m, so k 0.57. *The count follows the drawn crowns*: a cell's candidates are its cover's disc
    density over its mix's mean visible crown area at that scale, so the drawn cover is the cell's cover at any size
    (the fixed 3 m^2 per plant drew sagebrush at about 0.4 of its cover, and the understory's 1.6x patches made it look
    closed in places). *A shrubland row without chaparral is a stand*: its shrubs take the cell's whole shrub cover with
    the chaparral's openings, not 0.8 of it in understory patches. *The LOD from the layer's crowns*: D0 and KMIN scale
    with the layer's cover-weighted crown width against the chaparral's 2.2 m (Lamar 0.72 m: D0 38 m, KMIN 0.048; home
    1.94 m: D0 101, KMIN 0.34, was 115 / 0.44), so a far impostor stands for several small shrubs at about the
    chaparral's cost per screen.
  - *Its look from its record* (a shrub not in FH_LOOK): lobes from the envelope's lobe_depth, the fringe from the
    porosity (0.95 - 1.5 p, fitted to the table's shrubs), a vase from the envelope profile; for every foothill shrub
    the porosity and a leaf-sized picture tile. Fine-leaved shrubs (leaf <= 25 mm: sagebrush, coyote brush, buckbrush,
    snowberry) drew chamise's wand picture up close, long dark stripes down each crown: they now have their own
    picture ('sprig': small leaves in tufts on short crooked twigs, 66 % coverage, its tile from the leaf size), seen
    through between tufts toward the outline by the porosity (whole gaps, by the crown's octave: a fractional coverage
    dithered into a screen door), the outline broken deeper and the light bent tuft by tuft by the porosity; the near
    gain measured against the far program (leafGainF 3.4 / 1.2: near/far mean sRGB 108/104 on Lamar).
  - *The herb layer between shrubs* (grass.js, forbs.js; a tile that borrows nothing, shrubland cells whose row lists
    grasses): its herb cover is the description's (the range's middle, else 0.6) over the ground the shrubs leave open
    (1 - canopy.png's shrub cover), at a grassland's density: Lamar 0.625 / 0.65 = 0.96, so the sward density goes
    0.67 -> 0.95, the bare patches 15.7 % -> 8.5 % of the ground (the same bareField threshold rule), the forbs
    (where the description gives a cover) 0.23 -> 0.98, a grassland's.
  - Measured on Lamar (`b_valley_eye`, every instance of the cells within 15 m of the camera; LANDFIRE: EVC 35 %, EVH
    0.8 m): shrub cover (union of the crowns' discs) 17 % -> 33 %; plants 0.17 -> 1.02 per m^2; heights p10 / p50 / p90 /
    max 0.32 / 1.0 / 1.67 / 1.87 m -> 0.19 / 0.60 / 0.98 / 1.14 m; the field's instances in view 9.2 k -> 22 k. GPU frame
    (timer query, the least of 10 x 8 renders, a GPU shared with other headless Chromes: two "before" runs differ by up
    to 1.7 ms): eye 8.9-10.2 -> 10.6 ms, a second eye-height pose 8.8-10.8 -> 10.1, 10 m up 7.0-8.7 -> 8.6, 50 m up
    5.8-7.0 -> 6.0. Teton's sagebrush (EVH 0.7 m, D0 34 m) is an even stand at the cell's cover where the understory's
    patches left it bare by the camera; the home tile's chaparral, Serengeti and Lofoten draw as before (the home
    tile's foothill shrubs stand elsewhere in their cells: the count rule changed their random stream; its LOD floor
    went 0.44 -> 0.34 with its 1.94 m layer width). 146 tests pass (4 new: tests/test_species_mix_structure.py).
  - Open: the probe pose itself stands in one of the bare patches (bareField 0.25, the 5th percentile); the near crowns
    are still rounded masses (an impostor dome with sprays), not yet gnarled and flat-topped; the treegen sagebrush
    in vegetation.js is drawn at 25 % of its count (shrubScale reads the lidar's 0.5-4 m shrub cover, 2.6 % where EVC
    says 34 %: the lidar misses knee-high sage) and its close tier reads as a dithered haze; the chaparral program's
    chamise and manzanita keep their table sizes where EVH says 1.8 m (home); lidar.py reads EVH 2xx as 0.5 m steps
    (they are 0.1 m).
- **The porous crowns' black holes** (`shrubfield.js` FRAG, near program): every foothill shrub out of flower drew black
  patches through its near crown (sagebrush, coyote brush, buckbrush; there before this iteration as well, the chamise
  picture's gaps then). The flower-tip choice was `step(rnd, tipShare)` and a foothill shrub's tipShare is 0: in the leaf
  picture's gaps the per-leaf random is 0, `step(0, 0)` is 1, and the tip colour (its flowers', black when none show)
  filled the gap at alpha 1 (found by drawing the near program in flat magenta, then alpha / body / colour: the blotches
  were its own fragments, opaque, colour 0). Now strictly under the share. With it, a porous crown's gaps by rule: a share
  of them are holes through the crown, porosity x (1.2 at the centre to 2.5 at the outline), chosen whole by the crown's
  fine octave; the rest show its far side, the picture again offset and scaled at 0.55 of its shade. Lamar's sage at
  eye height now reads grey with soil, grass and stems seen through it at every distance; the home tile's coyote brush
  and buckbrush have no holes either. The probe pose stands in a bare patch (bareField 0.25, sward 0.27 at its foot);
  three positions 15-20 m off (bareField 0.51-0.72) have a full sward at the foot (1.0) with bunchgrass and forbs
  between the sage.
- **The ground at its measured reflectance, the exposure re-tuned** (Aaron: "Physical, re-tune exposure";
  `pipeline/ground_albedo.py`, a new base step `ground_albedo`, layer `client.ground_albedo`, tile-spec "Ground
  albedo"; atmosphere.js `groundLook`, terrain.js `groundGain`). The ground used the texture's display colour as albedo
  (NAIP's numbers, or Sentinel-2 as sRGB(2.5 x reflectance)), so open ground rendered 13-26 L* above its reflectance.
  - *The factor, one rule on every tile*: per channel, the sum of the reference month's L2A reflectance over the sum of
    the texture's linear colour on open ground (tree cover < 10 %, shrub < 15 %, not water or built; no clipped pixel;
    20 m). The reference month is the one the season multiplier is relative to (the NAIP flight month, else July), so
    after the multiplier the ground's mean is that month's composite. Fits (luminance; R G B): home 0.596 (0.72, 0.56,
    0.60), Grand Canyon 0.82, Teton 0.39, Lamar 0.37, Hoh 0.21 (its open ground is 1 % of the tile, river bars; a weak
    fit), Serengeti 0.44, Lofoten 0.47, Danum 0.43, Corcovado 0.47, Manu 0.34. On the Sentinel-2 tiles the fit differs
    from the stretch's 0.4 by the reference month against the texture's three-year median, which is what the
    multiplier needs. The tiles without a Sentinel-2 sheet take the fit of the nearest tile of the same NAIP
    acquisition: the 2022 California tiles home's, Mount Olympus the Hoh's.
  - *What moves with it*: the terrain (the photo's colour after its display-tuned recolouring, water tints, sward paint
    and detail; the cliffs compare their rock with the photo's reflectance now), and the herb layer, every colour tuned
    against the photo: groundAlbedo (the sward sheets, the forb carpets, litter, grass ground match), the grass type and
    species palettes and thatch, the forb pictures, the litter palettes and GROUND_REF. Trees, shrubs (shrubfield's
    chaparral domes pull toward the photo's brightness against 0.075: the shrub lane scales that reference by the gain),
    emergents, animals, rock and snow keep their own colours.
  - *The exposure*: `tune.exposure` x EXPOSURE_K = 1.38 for every tile and hour. The mean L* of the eight probes' 32
    frames was 50.1; ground at its reflectance with the old exposure 43.8, x1.6 53.0; interpolated in log exposure, 1.38.
    Measured in a paired run (before and after back to back per probe): mean L* 50.4 -> 50.3, mean linear Y 0.281 -> 0.291.
    `?ground=display` draws today's look, `?ground=luminance` the luminance factor (the photo's hue), `?gexp=` another K.
  - *The judge* (L_render vs L_fair, overlap_fair; L_fair rises with the exposure, since it is computed through it),
    before -> after: Serengeti 58.8 vs 38.2, 0.387 -> 44.5 vs 47.2, 0.841; Lamar 65.1 vs 39.3, 0.360 -> 46.6 vs 48.3,
    0.597; Lofoten 46.7 vs 33.1, 0.495 -> 40.5 vs 41.6, 0.662; Teton 40.9 vs 27.6, 0.514 -> 34.4 vs 35.5, 0.459; Danum
    25.7 vs 20.9, 0.078 -> 31.8 vs 27.9, 0.047; Corcovado 23.1 vs 23.1, 0.145 -> 28.3 vs 30.4, 0.112; Manu 28.3 vs 26.9,
    0.135 -> 30.5 vs 34.7, 0.138; Grand Canyon 48.3 vs 55.2, 0.212 -> 53.3 vs 64.3, 0.391. Open ground now sits 1-3 L*
    under its reflectance (was 13-26 over); the closed forests stay within 2-4 (their chroma rises with the exposure, so
    overlap_fair falls at Danum and Corcovado); the Grand Canyon, darker than its reflectance before, is darker still
    (-11: its NAIP is darker than L2A, factor 0.82, under the walls' own rock and the canyon's double shading).
  - *Herds*: none vanished. The Serengeti's buffalo at eye height stand out more (brighter, against darker grass); on
    Lamar from 150 m, in the same world toggled in place, the dark dots (bison and rocks) keep their relative contrast
    (Weber 0.28 -> 0.27) but are 15 L* under the ground around them where they were 20.
  - *The hue*: the factor per channel takes Sentinel-2's hue as well: the home foothills' July ground is red / green 1.28
    in L2A against 0.99 in NAIP, so the home ground turns red-brown; Lamar redder (0.87 vs 0.74); the Sentinel-2 tiles
    barely move. Aaron's pair (notes ground-albedo-v2/) shows both, the per-channel change and the luminance factor.
  - Open: the Hoh's fit rests on river bars; shrubs and sage now stand out paler against the darker ground (Lamar); the
    emergents' atlas is decoded twice (`pow(t.rgb, 2.2)` on an sRGB texture, the bug forbs.js fixed): the cattails are
    drawn too dark. 155 tests pass (3 new: tests/test_ground_albedo.py).
- **Physical ground by default, with today's hue: the luminance factor** (Aaron, 2026-11-06, "Go ahead" on the
  brief's recommendation of the luminance-only factor; atmosphere.js `GROUND_HUE`). The per-channel factor turned the
  home foothills red-brown in May (Sentinel-2's red / green 1.28 against NAIP's 0.99), which read as wrong. The default is
  now the factor's luminance on every channel: the ground takes its measured brightness and keeps the photo's hue.
  `?ground=physical` shows the per-channel factor and `?ground=display` the old look, for comparison; `?gexp=` as before.
  - *The judge, re-run* (tools/probes/run.sh, all eight; L_render vs L_fair, overlap_fair; per-channel and display in
    brackets): Serengeti 44.6 vs 47.2, 0.630 (per-channel 0.841, display 0.387); Lamar 46.5 vs 48.3, 0.395 (0.597,
    0.360); Lofoten 40.5 vs 41.6, 0.655 (0.662, 0.495); Teton 34.5 vs 35.5, 0.492 (0.459, 0.514); Danum 31.8 vs 27.9,
    0.046 (0.047, 0.078); Corcovado 28.3 vs 30.4, 0.112 (0.112, 0.145); Manu 30.5 vs 34.7, 0.149 (0.138, 0.135); Grand
    Canyon 53.3 vs 64.3, 0.220 (0.391, 0.212). The brightness is the per-channel run's to within 0.1 L* on every probe
    (open ground 1-3 L* under its reflectance, the forests within 2-4, the Grand Canyon 11 under). The colour overlap
    falls back toward the display run's where the photo's hue and Sentinel-2's differ most (Serengeti, Lamar, Grand
    Canyon) and stays above it everywhere but Teton and the forests; Lamar's ground is still too saturated (chroma 21.3
    against a fair 14.6). The first Lofoten capture lost its light record (the placeholder sun) and was re-run.
- **The drawn river where the imagery shows water: the reverse test, the large rivers moved onto it**
  (`pipeline/water_imagery.py`, a new base step `water_imagery` after `reroute`, `seasons` and `water_seasons`, before
  `water`; evidence in hydro/water_imagery.json and the layer `hydro.water_imagery`; the DEM's lines kept as
  hydro/channels_dem.geojson; reroute.py starts from them on a rerun). Iteration 8 asked whether mapped water holds water;
  this asks the reverse, per reach. On Lamar the drawn river was not 20-30 m off but up to 450 m: the 5 m DEM's route
  (reroute refused: the 5 m and 1 m grounds disagree) crosses the braided gravel plain and the meadows east of it, while
  the 2022 channel runs along the west bluff 6-8 m higher in the DEM (the lidar predates the flood).
  - *The water*: imagery/naip.tif is RGB at 2.5 m on every tile (no NIR band; Sentinel-2's own RGB on the world tiles),
    so the water is Sentinel-2's (20 m). Iteration 8's water pixel (NDWI > 0 or NIR < 0.04) misses a river narrower than
    its pixel (the Lamar's per-month frequency was 0.5 along a third of it). The fraction: each pixel's NDWI (upper quartile
    of its clear months) unmixed between the never-wet land within 300 m (its mean NDWI) and the tile's always-wet
    pixels (median NDWI; Lamar 0.28 against land -0.44); water where max(frequency, fraction) >= 0.5 on ground the DEM
    holds under slope 0.2 (a shadowed cliff is as dark as water in the NIR) and above 0.5 m (not the sea), bilinear onto
    the 5 m grid. Lamar's whole river is then continuous water, Soda Butte Creek (15 m) only in pieces.
  - *The test per reach* (every 10 m): water within max(w/2, 10 m) is `on`, within max(60 m, 2 w) `near`; on >= 0.6
    on water, near >= 0.5 off water, else no water seen. *The undrawn water*: patches >= 1,600 m2 beyond w/2 + 20 m of
    every reach and 20 m of every kept pond, each labelled by what the map says there.
  - *The move*, large rivers only (DEM reaches >= 10 m wide; a smaller stream keeps the DEM's routing): the large reaches
    cut into stems (biggest drainage first); a stem not on water is traced again, least-cost on the 5 m grid within
    600 m of its line on the valley floor (<= 10 m over its line's DEM), water cheap and cheapest mid-channel, land 12x
    and cheaper near the DEM's line (a gap the imagery cannot see keeps the DEM's route); edge ends fixed (the seams),
    interior ends snapped to water within 60 m; kept when on >= 0.5 and >= the old line's + 0.2. The stem is cut back
    into its reaches (attributes kept), widths from the imagery where its 200 m running median is >= 40 m (two pixels);
    the reaches meeting a moved node are bent to it (<= 30 m) or extended straight to it (one per node); a braid's
    water off the moved ribbon becomes a side channel (`source: imagery`, `anabranch`, along its skeleton, >= 150 m);
    NHD's own large stretches the imagery shows dry beside a moved river are dropped.
  - Results (reaches on / off / no water seen, before -> after): **Lamar** 19 / 19 / 327 -> 47 / 7 / 311: 3 stems moved
    (the Lamar below and above Soda Butte, on 0.32 -> 0.88, 0.30 -> 0.88, 0.57 -> 0.90; median shifts 42, 124, 19 m, max
    410-450 m), 53 reaches moved, 48 bent or extended, 10 side channels, 7 NHD stretches dropped; undrawn water
    249,100 -> 6,675 m2. Kept: Soda Butte Creek (on 0.04, the trace no better: its water is resolved in pieces only) and
    the short unnamed stems. Water under the drawn ground on 9.4 % of the moved line's samples (2.9 % on the other
    big reaches): where the new line crosses a bar the DEM holds higher than the 2 m carve. **Teton** 13 / 3 / 346,
    nothing moved: Cottonwood Creek below the Jenny Lake outlet is unresolved (on 0.06) and its rerouted line is on
    NAIP's channel; undrawn 8,675 m2 (6,400 a rewilded pond). **Home** 6 / 1 / 369, Weber Creek under canopy (no water
    seen), nothing moved; undrawn 209,250 m2, 204,850 of it the rewilded reservoirs and stock ponds (not drawn by the
    rule). **Manu**: the Manu runs inside its kept OSM polygon (no large reach outside a waterbody), nothing moved;
    undrawn 10,675 m2, all inside the 35 ha "lagoon" water_seasons judged dry (some of its pixels do show water). **Danum**: the Segama
    (brown water, NDWI under 0) no water seen, kept; its line follows the visible river. **Serengeti**: no water in any
    month anywhere (the Seronera dry), nothing moved. **Lofoten**: nothing large; undrawn 673,100 m2, 622,350 unmapped:
    Trolldalsvatnet, Ågvatnet and other lakes the OSM fallback never assembled into a polygon (iteration 8's open item).
    The 11 other tiles have not run water_seasons: the step is recorded blocked there.
  - *The probe poses by rule* (`tools/probes/pose_rule.js`, run in the loaded page; the rule and its numbers in
    probes.json lamar `_notes`): `b_valley_eye` is the nearest position to the old one in the same mix row whose cell's
    shrub cover is at the row's median (34 %, +-20 %) and whose sward (grass.js swardDensity over a 6 m disc and the
    foreground along the view) averages the row's median cell sward (0.84) and nowhere falls under 0.75 of it, no road
    within 20 m nor water zone within 30 m: [5310, 5306] (11.7 m off; sward 0.66 mean / 0.007 min -> 0.99 / 0.65).
    `c_river` is the nearest dry bank or terrace cell of the highest-order stream within 150 m, within 25 m of its
    ribbon, looking at its centreline 40-120 m away nearest the old bearing: [5296, 4892] -> [5205, 4945] (the old pose
    now stands in the drawn river).
  - Rebuilt Lamar with `--steps reroute,water_imagery,water,terrain,substrate,seams`; the other probe tiles ran
    water_imagery alone (their lines unchanged, so channels.geojson is not rewritten; their water step is stale only by
    input). 155 tests pass (6 new: tests/test_water_imagery.py). Open: the 2.5 m imagery has no NIR band (re-fetching
    NAIP's fourth band would resolve 10-20 m streams like Soda Butte Creek); where the moved river crosses a bar the DEM
    holds high the water sits under the ground (a level from the imagery's river, not the DEM's thalweg, is next); the
    extended tributaries cross the gravel plain straight; the drawn water reads pale and shallow from the bank.
- **Sagebrush up close: no black crowns, no screen door, one colour near and far; the HUD's Californian leaks**
  (`client/src/shrubfield.js`, `vegetation.js`, `crowns.js`, `impostors.js`, `identify.js`; `main.js` one line). Aaron on
  Teton (main): "Sage looks amazing in the tetons but when I get close they turn black", a stipple between, and the HUD
  reading "below me: chaparral" and "nearest tree: blue oak Quercus douglasii, 189 m". Rules, for every tile and shrub:
  - *The black*: the shrub field lit each crown by one cast-shadow test (shadows.js's cascades) at its centre, 2 m toward
    the sun. Where that point fell in a neighbour's shadow, or the plant's own caster's, the whole crown drew in sky light
    only, near-black among lit ones, and only within the near cascade's reach, where the shrubs cast (10-20 m: Aaron's
    "when I get close"; Lamar's eye-height poses on main show the same black crowns). Now the test is taken where the
    crown takes the sun, half on its sun-facing side and half on its top (black crowns 0 on the Lamar pose that had five;
    the frame matches one drawn with no cast shadow on the field). Main also drew the porous crowns' gaps black (the
    `step(rnd, tipShare)` fix below, not yet merged then).
  - *The screen door*: near and far programs split a plant across nearBand (14-26 m) by a per-pixel R2 dither, and the
    camera fade dissolved every crown within 1.2-3.5 m of the eye (with the shrub one walks up to). Now each plant switches
    whole at its own distance in nearBand (a hash of its root), and goes, whole, only when the camera is in or at its
    crown (centre distance under its half extent plus 0.1-0.4 m). In vegetation.js a shrub's materials (`lodPatch` whole)
    keep or give up the whole plant at each hand-over (near / mid, near / close, close / leaf level) by a hash of its root,
    the leaf level's share taken at the root, both sides of each hand-over hashing the same root; trees keep the pixel
    dither.
  - *One colour*: a foothill shrub's near program is lit as its far one is (the record's albedo, dome, clusters, sun and
    sky), the leaf picture only modulating that about its own mean shade (measured at bake, 0.6 of its contrast), with the
    far program's shaded holes where the picture is not resolved. The measured sprig gains (3.4 / 1.2) had put the lit
    tufts at 2.5-3.7x the record's albedo, white over dark gaps: the "snow-dusted stones". A porous crown is lit through
    (diffuse wrapped by 2x the record's porosity, both programs). The chaparral keeps its measured gains.
  - *The record's colour with the physical ground*: FH_GAIN (1.3, a lift of the display-era scene) is 1.0 when the ground
    is drawn at its reflectance (atmosphere.js groundLook.physical), whose exposure lift covers the whole scene: with both,
    Lamar's sage drew near-white. The domes' pull toward the photo compares against the ground's reflectance
    (groundGain), as asked by the ground lane.
  - *Borrowing nothing*: a tile in LANDFIRE's reach but in no natural region of the tables (species_mix.json
    natural_regions empty: Teton, Lamar) took the client's class mixes (California's) wherever a row had no trees or
    shrubs: blue oaks in grassland cells, gray pines in the steppe, chamise and manzanita in class-4 cells. `borrowsNothing` (the same test as grass.js ownGround) now
    governs cellPlan, cellTreeMix, tileSpecies (no California meshes built), the chaparral field and the crown plan,
    whose last resort is the tile's own tree shares (`crownFallback`; a plan with none fails over to the cell plan).
    Such a tile counts and draws the plants the class mix drew and skips them after their draws, so every plant of its
    own rows stands where it stood. California's tiles (neither key) are unchanged.
  - *The HUD names the cell's own community*: "below me" is the species-mix row's name (LANDFIRE's ecological system:
    "Inter-Mountain Basins Montane Sagebrush Steppe"), else a class name, "shrubland" and "woodland" for California's
    "chaparral" and "oak woodland" outside California's tables (identify.js habitatLabel). Teton at Aaron's spot: before
    "chaparral" / "blue oak Quercus douglasii · 163 m"; after "Inter-Mountain Basins Montane Sagebrush Steppe" /
    "lodgepole pine Pinus contorta subsp. murrayana · 203 m"; Lamar "Inter-Mountain Basins Montane Sagebrush Steppe" /
    Douglas-fir; home "Northern and Central California Dry-Mesic Chaparral"; the Hoh its forest's system name.
  - Open: the lodgepole record names the Sierra subspecies (murrayana) on Teton and limber pine is drawn as ponderosa (a
    pipeline substitution); vegetation.js's 3D sagebrush (25 % of its count) is still treegen's record (pale leaf level,
    the decadent class's long bare stems past the crown, dark close cards), not the field's look; the near field crowns
    are still rounded masses at 5-15 m rather than gnarled flat-topped bushes; a tile built before natural_regions
    was written (Grand Canyon: class_fallback true, no natural_regions key) still borrows until its mix is rebuilt; the
    ridge's lodgepole and whitebark rows on Teton draw as pole-and-puff trees at 200 m and beyond (not looked into).
- **Aaron on per-species tuning** (2026-11-06): "Maybe a per-species fine tune is actually necessary as part of the
  pipeline. What I meant is that the pipeline should be the focus - not the individual species. So as part of our
  pipeline we may want to include per-species fine tuning, rather than discovering the algorithm that produces all
  species (I think we would need DNA to get this right!) - the goal is a pipeline that reliably produces good results."
  So a recorded, repeatable per-species tuning step (a judged photo pick, an accepted model over a check's flag, a
  species' correction kept as data with its reason) is a legitimate stage of the pipeline, not a violation of it; what
  stays out is unrecorded hand edits. The judge verdicts and picks already stored in library/animals are that stage.
- **Lamar's water in the low points: the drawn DEM from the 1 m ground, and a refused step that fails loudly**
  (`pipeline/fetch_dem.py` drawn_dem, `pipeline/steps.py`, `pipeline/runlog.py` Refused, `pipeline/build_tile.py`,
  `pipeline/lidar.py` _fill_from_5m, `pipeline/water_check.py` by_reach and named; tests/test_drawn_dem.py). Aaron on
  Lamar: "the waterways look like they are not in the right area based on the ground color and elevation - has the 'put
  water in the low points' part of the pipeline not happened yet?" It had not. The USGS ImageServer answered 504, so the
  dem step took the 3DEP seamless 10 m, an older survey 3.9 m (std) off the 1 m lidar ground, and the reroute refused
  the tile. The step record still read `ok` with no outputs after 4 s, and the water stayed on the 5 m lines: Soda Butte
  Creek ran straight across the meadow, and the Lamar's ribbon turned into dry stony bed where its line left the drawn
  channel.
  - *The rule* (every tile, the dem step, version 2): wherever the 3DEP 1 m products cover at least 95 % of the tile
    (`DRAWN_1M_MIN_SHARE`), terrain/dem.tif is the 1 m ground averaged, each 5 m cell the mean of its 25 1 m cells,
    where all 25 are the product's. This holds whichever 5 m service answered. The fetched DEM is kept as
    terrain/dem_5m.tif (layer `terrain.dem_5m`) and fills only the gaps, shifted toward the 1 m ground near the seam:
    the seam's difference is smoothed over 15 m and fades to 0 over 50 m into the gap. The dem step builds the 1 m
    mosaic itself (lidar.build_dem_1m, filling from the fetched DEM), and the lidar step reuses it.
    *The threshold, from the evidence*: Teton has 100 % coverage; Lamar 98.7 % (one gap, the south-west corner, at the
    collection's edge); the Grand Canyon 86.1 % (a 1.1 x 8 km strip on its west side, in three pieces); the Hoh 0 %.
    At 95 % or more the gaps are a collection's ragged edge, and the reroute's test (std <= 3 m) holds by construction:
    Lamar is now at 0.13 m. Below it, the 1 m is one source of two over a large part of the tile. The tile then keeps
    the ImageServer's DEM, itself the 1 m resampled where it exists: the Grand Canyon's agrees at 1.6 m and was
    already rerouted. Its dem step re-ran and wrote byte-identical output, so nothing downstream of it moved.
  - *Order of reroute and water_imagery* (kept: reroute, then water_imagery): reroute puts every reach on the 1 m
    thalweg, the only evidence that resolves streams the 20 m Sentinel-2 water cannot see (Soda Butte Creek). Then
    water_imagery moves only a large river (>= 10 m) whose rerouted line still misses the imagery's water, for example
    a channel that moved after the lidar was flown. Lamar's 1 m collection (WY_GrandTetonNP_D22) was flown in
    September 2022, after the June flood, so its thalweg is the present channel. water_imagery now moves nothing
    there: 41 reaches on water, 5 off, 345 with no water seen. Before the fix it moved 3 stems that were 20-450 m off
    on the 10 m DEM.
  - *A refusal is a failure*: a step raising runlog.Refused is recorded `refused` with its reason (never `ok`) and is
    never current, so every build tries it again. Its dependents still run, on the lines it would have replaced. The
    build and `--status` exit 1. `--status` flags the step, including a refusal recorded the old way (status.reroute
    "refused: ..." with the step `ok`). The audit step fails on any step whose last run refused or failed
    (`build_audit` in the manifest, steps.refusals).
  - *Results on Lamar* (water_check, before -> after; the before is the branch's tile from just before the rebuild):
    bed within 5 cm of the section's lowest 1 m ground 28.0 % -> 87.6 % of samples, within 15 cm 47.2 % -> 94.4 %;
    median gap 0.173 -> 0.005 m, p95 1.905 -> 0.169 m; reaches whose median gap is over 15 cm (the water above the
    low point along most of the reach) 53.7 % -> 1.4 %; ground over the level by more than 1 m 51.7 % -> 0.56 %;
    level over the bank by more than 10 cm 35.0 % -> 0.29 %; rises into the receiving reach 28 -> 0. Within 15 cm per
    stream: the Lamar 71.5 % -> 97.5 %, Soda Butte Creek 19.4 % -> 84.0 %, Rose Creek 18.7 % -> 98.3 %. Aaron's view,
    before and after, is in the shared notes folder `lamar-river/` (30 m up along the river at the Soda Butte
    junction, top-down, the mini-map). Rebuilt: the base stage, then species_mix, canopy_top, crowns, inpaint,
    resources, games, game_seeds, registry and audit. plants, species, animals and stills are left stale by other
    lanes' library changes; their inputs do not depend on the heights.
  - *Teton* (`utm12n_514_4838`, 100 % 1 m, ImageServer DEM; it had been rerouted at std 1.47 m) takes the rule too:
    its drawn ground moves by 1.47 m (std; mean +0.07 m), and the reroute's agreement goes from 1.47 to 0.0 m.
    Rebuilt the same way. water_check, before -> after: bed within 5 cm 76.8 % -> 78.4 %, within 15 cm 86.2 % ->
    87.4 %, p95 gap 0.55 -> 0.52 m, reaches whose median gap is over 15 cm 4.7 % -> 3.1 %. Its seasons step re-ran in
    the cascade and took one new Sentinel-2 scene (November), so water_seasons and water_imagery now judge 7 months.
    water_imagery moved one stem (6 / 4 / 352 -> 7 / 3 / 352; it was 13 / 3 / 346 on the old months and lines).
    Teton's audit is blocked, as before: its stills step has never run (the fauna lane's).
  - Not rebuilt here: `utm11n_267_4175` (its rasters are not in this worktree; its dem step will take the rule when it
    next runs) and the home tile `utm10n_680_4280` (it has no coverage record; its 1 m DEM is treated as 100 %, so its
    next dem run draws from the 1 m and re-runs the stale steps it already has). Every other tile's dem step re-runs
    once for the new code and version: where the 1 m covers under 95 % and the fetched DEM's chips are
    cached (`_cache/3dep_5m_*`), the output is the same bytes, so nothing downstream re-runs. 158 tests pass (3 new).

## 2026-11-06: a predator's eyes, the selected quarry and the dive (branch claude/predator-dive)

Aaron: "For predators - predators should be able to see prey from very far away. When a user spots prey they must be
actually visible line of sight to the camera. When they are line of sight they become highlighted in the species
highlight color. The user can press "tab" or click on a prey species to "select" them. This creates a glowing ring on
the ground below the prey if on the ground or just below if flying. For predator birds above their prey, their should
be a "swoop" or "dive" attack button when a prey is selected and the bird is above the prey. The bird tucks its wings
and flies directly to the prey. The prey has a chance to detect this attack, increasing as the bird gets closer and
closer. If the bird loses line of sight the attack is canceled and the bird reverts to soaring."

- **Seeing prey far off is the line of sight, not a roll.** sight.js already lit what the camera had in sight by a
  chance per second within the smaller of the player's vision and the target's sight signature (a vole's is 10 m). For
  the species the player's species hunts (`animals.preySlots`, from games.json `relations.predation`: no hand list) the
  roll gives way to the line itself: in the camera's view, within the player's vision (perception.json
  `senses[player].vision`, capped at 600 m), lit while its visibility is 0.3 or more and for 0.5 s after. The prey's
  sight signature is how near a watcher must be to notice it, not how far a hawk's eye reaches, so it is not the limit.
  The predators the player is prey to keep the roll. Rejected: raycasts against the meshes (the tree crowns are
  alpha-tested cards, thousands a frame).
- **The test stays cheap.** The existing line test (a heightfield march; the near trees' crowns and trunks; the canopy
  raster beyond 180 m; the target cell's shrub cover) now finds its trees through a 20 m grid walked along the line, each
  cell once, instead of every near tree per test; each animal is tested at most four times a second and the frame at
  most 24 times (round robin from where the last frame stopped); the selected quarry ten times a second, in or out of the
  frame. Measured on the home tile as a red-tail soaring 230 m up (headless Chrome, the machine at load 7 to 10, so
  high): 8.4 µs a test, about 480 tests a second, the whole sight pass 0.30 ms a frame at the median, 0.5 at the 90th
  percentile and 0.7 at the 99th, with 141 prey alive, 70 of them in the frame and 24 to 48 lit.
- **Two faults in the line test, found from the air.** A crown was a sphere a third of the tree's height across, so a
  Serengeti sausage tree's umbrella (7 m tall, 22 m across) hid a skink under it and the dive went through the crown; a
  crown is now an ellipsoid with the plant's drawn half-width (vegetation.js `nearPlants` crownR, and its bole's trunkR),
  its top at the tree's top and no deeper than 0.4 of the height (a shrub's foliage still to the ground). And the canopy
  raster dimmed the line for every wooded cell it crossed past 180 m, even 100 m over the trees, which a ground animal
  never noticed and a hawk's every long line did; a cell now counts only where the line runs under the stand's top
  (the lidar p95 canopy height, else the measured stand top, else 15 m).
- **A predator's prey lives as far as its eyes.** Voles were culled 40 m from the camera (and under a camera over 10 m),
  rabbits 120, ground squirrels 150, and spawned only within 140 to 300 m, so a soaring hawk had nothing to see. For the
  player's prey species (and, on the host, another player's: `centres[].sp`) the cull and the spawn radius become 320 m
  (`animals.js EYE_R`, `eyeOf`, `inEye`). About 100 more animals live round a hawk on the home tile, 0.1 to 0.2 ms more of
  `animals.update` a frame.
- **Far off a body is under a pixel**, so a lit prey animal also gets a dot of its species' colour (`rarityColor`, the
  colour of its highlight, its soul and its chip) that keeps 13 px on the screen, faded in from 18 to 45 m away: one
  Points draw over the scene.
- **Selecting** (quarry.js): Tab takes the lit prey animal nearest the screen's centre, each Tab after it the next out;
  a click within 30 px of a lit one takes it (identify.js asks `claim` first, so it opens no card). The ring under it is
  its colour, on the ground's slope (level a little under a flier), at least 3.2% of the distance in radius so it reads at
  any range, drawn over the scene with no depth test (the leaf cards and grass round a vole hid it), bright while the
  line to it is open and dim while not. Escape clears it and then does not also leave the body (spirit.js reads
  `e.quarryCleared`); so does 3 s without a line to it (turning the camera away is not losing it), its death, or leaving
  the body. The hunt panel names the selection as its goal.
- **The dive** (dive.js; the action bar's dive slot, key Q, shown only while it can start): a flier whose species hunts,
  in the air, with the selection in its line of sight at least 8 m below it and 15 degrees under the horizon, within
  600 m, and the catch able to take it (`animals.killable`: KILLABLE has no ground squirrel, tree squirrel or quail yet,
  so Tab selects them but no dive is offered: a dive at a hyrax on the Serengeti only ever missed). The bird is turned straight at the prey at 2.6 rad/s, its pitch let down to 87 degrees (flight.js `pitchMin`),
  wings tucked (flierControl's stoop pose for any flier; a jay's folded) and no wingbeat, gaining 4 m/s² plus gravity
  along the slope up to its top speed (a red-tail from 11 to 45 m/s in about 2.4 s). Within a frame's flight plus its
  reach it strikes: `animals.catchNear` at the prey (the kill, or on a mirror the host's confirmation), the bird down on
  it with no landing hops (a hop ends the hawk's mantle) and fed. Lost line of sight for 0.3 s cancels it: the bird pulls
  its nose up for 1.1 s and soars again. Q again or Escape calls it off.
- **The prey's chance of seeing it coming** is a hazard of 0.9 (1 - d/n)² a second inside n, n how far the prey's
  species notices the player's (perception.json `detects`, 150 m where the tile does not say), so it rises as the bird
  closes. A prey animal that sees it is alarmed for 8 s (`animals.startle`, as a watcher's call alarms it) and its own
  flight from danger runs: the brush rabbit and the jackrabbit bolt, the ground squirrel goes down its burrow, the vole
  runs to hide, the gray squirrel runs up its tree (its scare now also follows an alarm). Two changes made that true:
  for the alarm's while the diver counts as at the prey's own level (`diveSeen`), since a vole pays no mind to a flier
  more than 4 m over it and a rabbit 20, which hid every stoop; and a prey animal that saw the dive and reached cover (the
  vole hidden, the ground squirrel down, the lizard in its crevice) is not there to take (`reachedCover`, in the catch
  and the host's confirmation alike), while one still running can be caught. Rejected: a dodge roll at the strike (the
  species' own escapes already exist and are what Aaron asked for).
- **Multiplayer** follows the catch: a mirror's strike is the existing `catch` request; its detection is a new `startle`
  request (`areq {k: 'startle', n, x, y, z, sp}`), and the host alarms the prey with the remote diver as a stand-in
  hunter at its point (`threat` accepts it), within 600 m of where the diver says it is. A pre-existing race broke every
  mirror's catch: the carcass's own message on the dig channel (carrion.js `adopt`) often came before the animal
  channel's kill and killed the mirror's copy as 'shared', and `applyEvent` then dropped the kill as already done, so
  the striker was never told it had caught. A kill for this page on a body already dead now still calls `onCaught`.
- **Not done:** the raven (its own control) and the ground predators get the eyes, the selection and the ring but no
  dive; the Serengeti has no predation pairs in games.json (pipeline/species_data.py DIET covers the North American cast
  only), so nothing is prey there until the pipeline writes them; the hunt panel's kill count on a mirror misses a catch
  that came by the race above (the feeding and the toast do not).

## 2026-11-06: the hunt's strikes, keys for the moves, and the spirit's targets (branch claude/predator-dive)

Aaron extended the predator work the same day: "Controls for all animals can have their movement control buttons
removed. For ground hunters, the targeting works the same way. For all hunters When a prey is targeted, the controls for
the hunt appear. For birds, they can initiate a dive from far away. But for cats, they will have bite, swipe and pounce.
Those only work when a prey animal is in range. Bite, swipe and pounce have different animations and deal different
damage. When the prey is targeted, they have a health bar. Each type of attack should affect the health bar and have a
cooldown - think WoW game mechanics for combat rather than tekken." Then, for the spirit: "When in spirit form, if I click
on any of the species along the bottom of the screen (species within view), my spirit changes course and pilots itself
directly to the closest species." and "If a spirit clicks on an animal's avatar, rather than the chip, that animal
becomes targeted. Tab also cycles through targeting every available target. In spirit form, when an animal is targeted
there is only one "action" [ Embody ] with the model of the animal as the icon. Clicking on it pilots the spirit
directly to/into the target animal".

- **The movement slots are gone** (abilities.js): run, turn, walk, sprint, jump, hop, flush, pitch, speed, flap, climb,
  descend, hover, soar, land, take off, the squirrel's and the woodpecker's and the spirit's moves. They were labels, not
  buttons (a phone steers by the drag on the canvas, flight.js pointer events, which stays), and the help line hides while
  the bar is up, so the keys moved into the dim strip over the slots ("W S move · A D turn · shift W sprint ..."), now the
  one place they are taught. The actions stay (act, rest, sniff, drink, dig, peck, call, the greyed verbs).
- **The strikes** (strikes.js the rules, combat.js the player's side, groundControl.js the bodies). By family from the
  tile's locomotion layer (a stand-in through its kin): the cats bite, swipe and pounce; the bears bite, swipe and lunge;
  every other hunter bites and lunges. Keys 1 to 3, and slots shown only while a prey animal is selected, greyed while out
  of that strike's reach, with WoW's clock sweep and the seconds while cooling (its own cooldown, or the 1 s global one
  after any strike). Nothing per species: health is 10 m^0.75 (Kleiber), a strike deals its share of that for the
  striker's mass (bite 0.34, swipe 0.12, pounce 0.2, lunge 0.18), so three bites kill prey of the striker's own size; reach
  is a share of the striker's length (bite 1.0, swipe 1.15, pounce 5, lunge 3.5) plus half the prey's; cooldowns bite 4 s,
  swipe 1.5 s, pounce 12 s, lunge 7 s. A mule deer has about 220 to 250 health, a puma's bite 69, its pounce 40, its
  swipe 24; the Serengeti's buffalo 953 against the lion's bite 154. Health comes back 2% a second once 8 s pass without
  a hit (worked out when read, so a mirror needs no stream for it). At none, the kill is the catch's (fed, the word, the
  cat over its kill). E with prey in reach is the bite now, and a hunter with strikes no longer kills by the rush's last
  bound or the canids' E-pounce alone (an instant kill would make the bar meaningless); small prey still die to one hit.
  The elk joined KILLABLE (it runs the deer's machine and dies the deer's way), so the Serengeti's zebra, wildebeest and
  buffalo can be killed.
- **The animations** are procedural on the leg engine's pose channels, as the hawk's tuck is: the bite winds up (the head
  drawn up and back), then lunges up to a metre in and snaps down and through; the swipe raises the forequarters, turned
  to a side, one foreleg reaching (the gallop's flight pose), then rakes across; the pounce is a crouch (0.28 s) and the
  cat's existing leap stretched to the distance; the lunge is the canids' existing spring. No rig has clips for these.
- **Struck prey reacts:** it flees with its own escape (animals.startle, as at a seen dive); prey heavier than 0.6 of the
  striker now and then (18%) fights back instead: the striker is thrown back about a metre, staggers, and cannot strike for
  1.5 s ('kick').
- **The target frame** (index.html #targetFrame, combat.js): the selection's name, its bar and numbers at the top centre,
  red under 30%, and a small bar over the animal with the struck numbers floating up from it; for any selection,
  the spirit's too.
- **Multiplayer:** the host decides every hit. A mirror's strike is a `hit` request (`areq {k: 'hit', n, mv, sp, x, y,
  z}`); the host checks the move is one the striker's family has, the prey is its prey and within that move's reach (and
  the stream's slack), and the move's cooldown (a fifth's leeway), then deals the damage by the striker's mass, and tells
  everyone (`aev {k: 'hp', n, hp, max, by, mv}`); a kick goes to the striker (`aev {k: 'kick', to, n}`); a kill is the
  existing kill event, the striker's own catch. Seen with two headless Chromes: a mirror puma's bite and the host
  coyote's bite set the same bar on both pages (246.2, 177.5, 153.7), and the mirror's last strike killed the deer on the
  host, the mirror fed by onCaught.
- **The dive from far away:** the bird only has to be over the prey (3 m), within 600 m; the old rule asked for 15
  degrees under the horizon. Key 1 as well as Q. In the home tile's oak woodland a shallow dive mostly loses its line in
  the crowns on the long approach and is called off; steeper ones catch.
- **Ground hunters target as birds do**: the same sight, highlight, Tab, click and ring (they always had it; the strikes
  now hang on it).
- **The spirit's targets** (quarry.js mode 'spirit'): any animal is a target. A click takes the one at the pointer, Tab
  walks every animal on the screen with a line of sight (out from the centre; a round remembers who it has visited, so it
  walks them all as birds fly in and out of the line), and the selection stays until Escape or its going. The bar's one
  action is **Embody** (key 1 or E) with the species' still as its icon (stills.js, as the chips).
- **The chips** (nearBar.js) are buttons and show in a body too: a chip selects the nearest individual of its species (the
  next nearest on a second click). In the spirit the autopilot (pilot.js) then flies there: straight at it, holding 18 m
  over the highest ground in the next 220 m (a ridge is a climb and a descent, never a line through the hill), slowing
  from 45 m/s, and stops short at nine times the body's size (9 to 40 m off, 0.45 of that above), circling it slowly. Embody
  flies the same way into the animal and becomes that individual by the existing become (spirit.enter), else the nearest
  of its kind. Any movement key, a moving drag or a touch steer hands control back and keeps the target. In a body a chip
  selects only one the camera can see. Seen on the home tile: from 320 m behind a ridge standing 25 m over the straight
  line, the spirit climbed 42 m over it (10 m clear at the crest) and came down to hold 9 m off a deer; a turn key took it
  back; Embody from 45 m became that deer (its id) in 5.4 s.
- **Not done:** the bird's dive deals no damage (a stoop at small prey is the catch, as before); the raven, squirrel and
  woodpecker controls have no strikes; ground squirrels, tree squirrels and quail still cannot be killed, so no strike or
  dive is offered at them; the fight-back has no health of the player's to take (it staggers); the swipe has no paw of its
  own on the part rig (the leg engine's foreleg reach stands in).

## 2026-11-06: the startup sequence (branch claude/startup-sequence)

Aaron: "On first load on the web there is a dark green background - nothing happens. We should add a little loader on
that first screen. It should fade to black when stars are ready to render. Stars should twinkle in. Wild earth should
fade in. When the world is ready to enter, animate in and up into the center and its final position before showing
either side panel. Side panels fade and slide in from the sides."

- **The boot screen** (index.html `#boot`, inline CSS): the opening's dark green, with a small dot orbiting a faint ring in
  the middle, from the first paint (before any module has loaded) until the title screen draws its first frame. The
  loader fades in after 0.35 s, so a warm load never flashes it. Only on the opening paths (html.opening); `?skip=1` and
  `?game=1` never show it, and the card screen (`?cards=1`) removes it at once because it has its own dark start. If main()
  throws before the title is up, the boot screen shows the error where the loader was (the opening hides `#status`).
- **To black, then the stars** (title.js firstDrawn, STAR_VERT): on the first frame drawn (the stars' shader compiled) the
  green fades to black over 0.9 s. Each star has its own delay (`aDelay`, the brightest first, as at dusk, with some
  scatter; all are in about 2 s after the first frame) and comes in with a quick rise and a glint that settles
  (`uGlint`). Under reduced motion it is a plain fade.
- **The title** fades in 0.7 s after the first frame, with the loading line under it. "When the world is ready to enter"
  is read as the moment the home screen's own loading is done (the hub's config and session, the earth texture, the
  places' names, at least TITLE_MIN_MS 2.4 s): the title rises from the middle and shrinks to its place at the top centre
  (`.risen`, 1.4 s; `--tt-top` 40 px, scale 0.42), while the earth's crescent rises under it. It stays there while a
  place is chosen and goes with the screen at Start (zooming). Before, it faded out as the earth rose.
- **The side panels after it lands** (title.js panelsIn, `html.tt-panels`): the sign-in modal and Explore slide in from the
  right, the places list from the left (56 px), and the social column and the chat from the right as a CSS animation, so
  they slide in whether they are made on sign-in or kept from the world by Exit to main screen. None of them shows
  before the title has landed. A sign-in before the crescent is up ends the crescent tween (endTween), so the two rises
  never pull the earth at once.
- **Not slower than before:** the sign-in used to come 2.2 s + 3.3 s (the crescent's full rise) after the loading
  started; it now comes after the title lands, 2.4 s + 1.4 s. A known session goes on to the lit earth 0.4 s later, as
  before.
- **Reduced motion** (`prefers-reduced-motion: reduce`): the loader pulses in place of orbiting, the stars only fade, the
  title fades out in the middle and in at its place (tt-refade keyframes: it moves only while invisible, 1 s), and the
  panels only fade. The earth's own camera moves are unchanged.
- **Phone width** (720 px and under): the title's place is 22 px from the top, and the places list and the social column
  start at 42 px, under it.
- Verified in the browser pane on the local viewer (800x600 and 375x812, `?hub=stub` and the real local hub): the
  boot screen, the fade, the twinkle, the title's rise, the sign-in sliding in, the list after sign-in, choose, Begin, x
  skipping the arrival, Exit to main screen running the sequence again (the panels slide in once more), `?cards=1` (no
  boot screen), `?skip=1` (no boot screen, straight in). The reduced-motion cross-fade was checked by applying its CSS rule
  directly (the pane cannot emulate the media query); it moves only while invisible. A cold load over the network was not
  measured: the local server answers in milliseconds. Debugging fields: `__weTitle.bornMs` and `drawnMs`.

## 2026-11-06: the keys strip lives in the menu, top centre

Aaron: "This toolbar can be moved into the menu and can be displayed at the top in the middle." The dim strip of the
page's keys over the body's slots (abilities.js `.ab-more`: the movement keys, the hunt's, map, roads, present day,
tags, mute and the mouse) now shows only while the menu is open, centred at the top between the menu button's row and
the mini-map, in the menu's own card style; it wraps to two lines at 1280 px wide. The hunt's target frame steps down
under it while the menu is open (`--abMoreH`, measured when the strip is built). On a phone the top holds the menu list
and the map, so there it sits at the bottom over the nearby-animals row instead. The slots themselves stay where they
were, bottom right, and always show.

## 2026-11-06: the home screen's social panel, after Aaron's design (branch claude/home-social)

Aaron: "Lets redesign the home screen to look and work like this", pointing at his Design canvas "Wild Earth — start
screen social panel" (artboard "Start screen — social panel v1", 1440x900). The design keeps the home screen's places on
the left and the earth in the middle and redesigns the right: an account card over a social panel. Built to match it:

- **The account card** (social.js renderCard): the player's wisp ringed green while friends can see them, grey while
  appearing offline; the display name; "@handle · sharing your place" (or "online", "appearing offline"); the `…` menu:
  "Friends see" as a three-way switch (My place, Just online, Nothing), Change display name, Blocked people, Sign out.
  The display name and Blocked people open sheets in the panel (no more `prompt()`).
- **The social panel**: "Find people by name" (three characters or more; results drop down with Add friend, Asked,
  Friend, Accept or Unblock; "No one named …"), then the tabs Groups, Friends (count online), Requests (count, in the
  accent colour #c98a4e). Groups: a card per group (up to four wisps, offline ones dim; the name; "2 in Upper Hoh Road",
  "1 online" or "quiet"; the last line) and a dashed New group. A card opens **the group's chat inside the panel**: back,
  the name and who is in it, the info button, "Join Maya and Juno in <place>" (accent) when members share a place, the
  lines and the message box. Friends: online first with a green dot and their place, Join when they share a place,
  Invite when not; "Offline · N" folds the rest. Requests: Accept and Ignore; the requests sent are listed under Asked
  with Cancel. New group and Edit group rise from the panel's bottom as sheets (name, Bring along / Members with Remove
  for the creator, Add friends, Save, Leave group).
- **The left list and the map labels** name the friends at each place with their wisps ("Juno and Maya here", and
  "· 3 more" for the strangers counted), from the presence the hub already sends (title.js renderWho, multiplayer.js
  friendsAt). The heading is "Most active" with the list's mode as a quiet text button ("everywhere" / "in view").
- **The title** rises to 15 px high at any width (the design's size; rise() computes the scale from the font size).
- **Layout**: 24 px gutters, the places 300 px wide on the left, the social column 380 px on the right from top to bottom;
  Invite, Start and the toast centre in the space between them (title.js sets `--we-fl` and `--we-fr` each frame from
  freeArea). The sign-in modal stands where the column will be. In the world the same panel drops from the friends row
  beside the menu button, as before; at a phone's width (720 px and under) the home screen shows the row and its toggle
  at the top right and the panel drops as a sheet over a dimmed screen.
- **The startup sequence** is kept: the account card and the social panel slide in from the right a beat apart once the
  title has landed (`html.tt-panels`), the places from the left; under reduced motion they fade, and the sheets, menu and
  toast fade without moving.

Decisions where the design and the client differ:

- **The hub's two additions.** "Friends see: Nothing" is a new presence value `hidden`: friends and group members hear
  offline, and a welcome leaves the user out of `online` (hub.py presence, online_for, m_me). Blocked people needs the
  list: the `friends` message and the welcome carry `blocked` (id, name, display of those this user blocked; never who
  blocked them). Tests in test_friends_blocks_and_search.
- **"Messages aren't kept"** in the design is not true of the hub (it keeps a group's lines 7 days, MESSAGE_DAYS), so the
  chat says "Messages go after 7 days".
- **Where a line was sent from** (the design's "Maya · Upper Hoh Road"): the hub does not record it, so a line that comes
  while the page is open shows its sender's shared place at that moment (or the player's own world), and older lines
  show when they were sent ("8 min ago"). Nothing new is sent or kept.
- **Not built, needing the hub:** the animal a friend is playing ("as a raven"), "last on 2 days ago", and "friend of
  Maya" on a request. A friend online without a shared place reads "online".
- **The design dims the places list** (a design tweak, on by default) to point at the panel; the built list is not
  dimmed, since it is the way to choose a place.
- **The toast's Undo** in the design only closes the toast; the built toast has no button.
- **More on a friend** (Remove friend, Block) is a `…` on the row, shown on hover or focus: the design has no way to
  remove or block, and blocking must stay reachable.
- **Leave group** asks once inline ("Leave Explorers? Press again"), since leaving as the last member deletes the group.
- **On the home screen the chat pane is not shown** (the group's chat is in the panel); the invite answers and the
  hub's place errors become toasts there. In the world the chat pane is as it was.
- **Exit to main screen** used to leave the panel kept from the world closed and Invite unhooked (signedIn returned
  early when the panel existed); it now re-hooks the home screen (multiplayer.js homeHooks).

Verified in the browser pane against a local viewer and hub on 127.0.0.1 with test accounts and a scripted second set of
players (friends, two groups, lines, a request, two friends in a world): every press above round-trips through the hub
(rename and add on Save, create opening the new group's chat, two-press leave, accept, add friend, block and unblock,
presence hidden and back, display name, Join choosing the friend's place, Invite with and without a place chosen), the
signed-out gate and signing in through it, Start into the world with the panel as a dropdown, Exit to main screen,
`?cards=1`, `?skip=1`, and 375x812. Side by side with the design rendered from its own source at 1440x900. Not checked:
the reduced-motion media query itself (the pane cannot emulate it), touch, Safari, two real browsers.

## 2026-11-06: the title and the earth land together, then the panels; no atmosphere (branch claude/home-social)

Aaron, on v42's startup: the earth came up, slowed, moved left, then up, then right, because the side panels arrived at
different times and the earth re-centred in the space left each time. His words: "The logo and the earth should smoothly
animate to their final destinations - they should arrive at their final destinations at the same time, and when complete,
the side panels should slide in from their respective sides simultaneously." And: "The globe doesn't need an atmosphere,
I don't think it's adding anything."

- **One landing** (title.js land): after the loading, one tween of LAND_MS (2.2 s, ease in-out) moves the earth from
  below to its final place and the title from the middle to its place at the top, from the same eased value each frame,
  so they arrive together. The title's movement is driven from JS (inline top and scale); its CSS only holds where it
  lands (`.risen`, `--tt-top`, `--tt-s`). The earth now lands at its final place in every path: there is no separate
  crescent rise and no second rise after sign-in. Before sign-in it sits there lit as a crescent; signing in swings the
  sun round, turns it to face the place and brings the map up, without moving it. A session already known is lit over
  the landing's own time.
- **The final layout is reserved from the start** (freeArea): the free space is the places column's laid-out box
  (offsetLeft and offsetWidth, which ignore the slide's transform) on the left and the gate's column on the right, where
  the sign-in and then the social column stand, whether or not they are in yet. The right column is reserved only when
  there is a hub (with none, the Explore button stands over the earth's space), and at a phone's width the column is a
  toggle at the top, so only the places are reserved. The view offset is set on the first frame instead of easing in.
- **The panels after the landing, together** (sideIn, `html.tt-side` and `.listed` on the same frame): the places from
  the left and the social column from the right, each 56 px over 0.9 s with one easing (cubic-bezier(.2, .8, .25, 1)), no
  stagger. Signed out, the sign-in slides in from the right with the same slide when the landing ends; after signing in
  the places and the social column come in together 0.45 s later, as the sign-in fades. The map's labels fade in with
  the panels. The earth cannot be dragged or zoomed until it has landed.
- **Reduced motion**: neither moves while visible. The earth is put in its place faded to black; the title fades out in
  the middle and in at its place while the earth fades in (REFADE_MS 1.2 s, one tween); then the panels fade in together.
- **No atmosphere**: the haze shell (a back-faced sphere at 1.035 with its own shader) and the haze rim inside the earth's
  limb are gone. The earth's day side, terminator and night side are lit as before.

Verified in the browser pane by tracing the earth's projected centre and radius, the title's box and the panel classes
every frame through the startup (scratch trace, before and after): before, the earth's centre moved x 720 to 518 and back
to 652 (a reversal) and the panels came at 3.9 s and 6.2 s; after, at 1440x900 signed in, the centre's x stays 680 (the
middle of the space between the 324 px places column and the column at 1036 px), y goes 1457 to 450 in one move, the title
goes from 68 to 15 px high and from the middle to 36 px over the same 2.53 to 4.5 s, and the gate, the places and the
social column switch on together at 4.62 s; signed out, the sign-in comes at 4.63 s and the places and column together at
7.21 s after signing in, with the earth not moving after it landed; at 375x812 the same, the centre's x fixed at 280;
with the reduced-motion path forced (the pane cannot emulate the media query, so matchMedia was stubbed), the earth's
place never changes while it is visible. Also checked: `?hub=stub`, Start, x skipping the arrival, and Exit to main
screen replaying the sequence. Not checked: a page with no hub (the Explore path), and the CSS fades' timing in a real
browser (the pane's hidden page does not advance CSS transitions).

## 2026-11-06: group follow (branch claude/group-follow)

Aaron: "When a player in a group is in a tile with another player, and one of them leaves to go to the main screen - when
that person presses "START" the other people in the group receive an invitation to join them which they can decline.
Their screen fades to black and a loading bar begins and then they should enter the tile where the person who originated
the invitation is, above and behind them." Details in docs/multiplayer.md "Group follow".
- **Built on lane 4's `place` / `invite` / `answer`, not a new channel.** `place` gains `follow: true`; the hub sends that
  invite only to members online and marks it, so the client shows the follow toast instead of the plan dialog. The
  inviter's position comes from the room join's last `pos` (the existing relay), so nothing new is kept anywhere.
- **Every Start from the main screen asks the group**, not only one after Exit to main screen: the moment is the same
  ("I am going in here now"), and the first Start of a session is where a group most often wants to go in together. A
  joiner's own Start from the older Invite flow asks no one.
- **The group asked** is the chat's group when it has anyone else in it, else the first group that does (the rule `chose`
  already used).
- **No arrival flight for a joiner**: the veil covers the build and the joiner is put at Arrival's follow end pose at once
  (6 m up, 10 m back, the inviter's yaw), since Aaron asked for a fade, a bar, then being there. Behind a ground animal
  the end is on the ground 6 m back at the spirit's 2 m climb-out height rather than in the air.
- **Expiry 60 s** with a visible line running down, the same life as the existing invite dialog; an expiry answers
  nothing (it is not a decline).
- **Files kept apart from the home screen's rewrite**: the toast and the veil are `follow.js` and `follow.css` (linked from
  the module), and the bar's step weights are a copy of title.js STEPS, so title.js, title.css and index.html are not
  touched.
- **Page nodes across a switch**: main.js records every node added to the page while a world is played and removes them
  with it; a node marked `data-we-page` is now left out, so the veil stands across a world-to-world switch.

## 2026-11-06: group season (branch claude/group-follow)

Aaron: "If one player changes the season, it changes for everyone in the group." Details in docs/multiplayer.md "Group
season".
- **The same channel as the follow invitation**: a hub `season` message relayed to the online members of the sender's
  groups (memory only), and `place` carrying the sender's season and day into the follow invitation.
- **It follows, with no confirmation**: the room, positions, wisps and voice are per tile, not per season, so a member
  left in another season would share the group's company but not its forest or animals. The veil and the chat notice
  ("<name> changed the season to winter") say who changed it.
- **The same day, not only the same season**: the select picks a random day in the season and the weather is that day's,
  so the day is relayed too and the group shares the weather.
- **In place, not rebuilt**: a season change never rebuilt the world (it re-colours and moves the animals' channel), so a
  member in the tile stays where they are; the veil covers the change for a moment rather than a build.
- **Elsewhere, kept for the next Start**: a member on another tile or the main screen is told and goes into that season
  at their next Start, and their invitation carries it.


## 2026-11-06: a chosen place fills the centre, not the screen (branch claude/home-tile-framing)

Aaron: "Right now clicking on a tile zooms to have the tile fill the whole screen. It should just fill the center of the
screen." The chosen pose was a fixed 10,000 ft (3.05 km) south of the tile looking north at the full tilt, framed for
the whole viewport, so the tile ran under the places list and the social column.

- **The focus area** (title.js focusArea): the free centre the earth lands in (freeArea: right of the places column, left
  of the social column when there is a hub), under the title and the card over the tile, above Invite, Start and the
  loading line, less a margin (40 px; 16 px at a phone's width).
- **The pose** (chosenPose): the camera looks at the tile's centre from the distance at which the whole tile, as the
  camera sees it there (its tilt and lens change with the height: tiltFor, fovFor), just fits the focus area. Found by
  bisection on the distance against the tile's edges projected through a camera built as frame() builds it. At 1440x900
  a 10 km tile is seen from about 18.5 km, so the tilt is shallower than before.
- **Centred in the area, both ways**: the view's offset already put the looked-at point in the free space's horizontal
  middle (offX); a vertical offset (offY) now puts it at the focus area's vertical middle while a place is chosen,
  eased like offX.
- **Phone**: Invite and Start centre on the screen, not in the narrow strip beside the places (they ran off its edge).

Verified in the browser pane on the local viewer by projecting the chosen tile's edges after the flight: at 1440x900
Upper Hoh Road spans x 364 to 996, the area's full width (width is the limit there), its centre at (680, 458) against the
area's (680, 459); Yosemite the same within a pixel; at 375x812 the tile fills the 158 px strip beside the places (x 201
to 359), centred to a pixel. Backing out: the wheel zooms out from the chosen view as before (to about 23,000 km); a
flight from one chosen place to another arcs out and comes down to the new fit; choosing the place again flies back to
the same fit. While a place stays chosen and the player zooms out, the vertical offset stays (8 px at 1440x900).

## 2026-11-06: the species library arrives in one response

On the hosted site (v43) a headless load of the title screen warned for 20 species "signal is aborted without
reason; using the built-in parameters". `treegen.js` blocks module load on the species library: index.json, then all
193 files fetched in parallel, each given 2.5 s. On the single small Fly machine, alongside the earth textures, a score
of them missed that and fell back to the built-in shapes (and a species with no built-in set has no shape at all), so
players over a real connection could get generic trees. This went back to the species library's first version.

Now `server.py` answers `GET /api/species-library` with every file index.json lists as one JSON object
`{id: file}`, gzipped (1.16 MB to 250 KB), with an ETag (304 on a match) and rebuilt whenever a file or the index
changes. The client asks for it first (15 s), and a host without the endpoint (a static copy) gets the files one by
one as before, now 8 s each. Measured on the local server with the cache off: one request, 193 species from the
library, none built-in, also under a throttled 4 Mbps / 150 ms network (title up at 12.9 s there).
`tests/test_species_bundle.py` covers the bundle (every listed id, the files unchanged, gzip, plain, 304).

## 2026-11-06: no pool of light under a grazer

Aaron: "There is a faint glow below the player no matter what animal - lets remove that." It was forage.js's sward
halo: when the grass just ahead of the body's nose was one of its foods, one soft additive disc lay on the ground
there. Every grazer (the rabbits, the deer, the bison, the elk) stands in its food grass nearly all the time, so it
read as a light under the body wherever it went. That halo is gone; the food herbs' and shrub impostors' glow, the
pools under near 3D food shrubs and the sward's scent strand stay. Checked as a brush rabbit on the home tile in
October: three food grasses, the forage glow on, no halo drawn.

## 2026-11-06: the zoom to a place is slow and keeps pace with its world's loading (branch claude/home-tile-framing)

Aaron: "zooming to the location should be slow enough so that the world has a chance to render. While it is a slow
zoom, begin loading world assets right away so that by the time they arrive at the tile, it's mostly loaded."

- **Loading at once was already so**: choosing a place calls main.js `select`, which starts building its world behind
  the earth on the click (`replaceWorld`: the tile package, rasters, the forest, models, shaders); Start enters that
  world when it is ready (`world.enter`), and a second choice abandons the first build (`disposeWorld`). Unchanged.
- **The slow zoom** (title.js flyToPlace): the flight to a chosen place takes PLACE_SLOW (1.8) times the free flight's
  time, within 5 to 8 s, and its clock is paced by the loading bar's eased progress (`this.shown`, continuous, so the
  pace never jumps): to pass raw progress u the build must be about smooth(0.55, 1, u) along; ahead of that the clock
  slows smoothly to PACE_MIN (0.04 of its speed), so the camera eases into a slow drift a few times the final height above
  the tile and comes the rest of the way as the build does. A world already built (choosing the place again) flies at
  the natural pace. The search's flights are not paced. The fit is the centre framing above (focusArea, chosenPose).

Measured in headless Chrome over CDP (`Network.emulateNetworkConditions` 20 Mbit/s each way and 60 ms latency, the cache
disabled, `?hub=stub`, Upper Hoh Road, Start pressed as soon as both the zoom and the world are done; before = main
96ff697, after = this branch; the machine's load average 8 to 20, so a few seconds is noise):

| run | zoom ends | world ready | waiting at the tile | world shown | arrival done |
|---|---|---|---|---|---|
| before, 1440x900 | 3.9 s | 45.5 s | 41.6 s | 47.3 s | 59.5 s |
| before, 1440x900 | 3.5 s | 38.7 s | 35.2 s | 40.5 s | 53.2 s |
| after, 1440x900 | 37.3 s | 37.3 s | 0 | 39.1 s | 52.1 s |
| after, 1440x900 | 38.8 s | 38.8 s | 0 | 40.7 s | 53.4 s |
| before, 375x812 | 3.6 s | 39.1 s | 35.5 s | 40.9 s | 53.1 s |
| after, 375x812 | 37.9 s | 37.9 s | 0 | 39.7 s | 52.2 s |

The click-to-playable time is the same (the world's build is the limit, and it already started on the click); what
changes is that the player rides the zoom down instead of waiting at the tile for half a minute. The altitude trace of an
after run: 15,880 km at the click, 72 km by 3.7 s, a drift from 57 to 25 km over the next 20 s while the build loads, and
the 18.5 km fit as the world becomes ready. Two things seen in both: the loading bar reports nothing for the first ~22 s
under this throttle (the tile package's download comes before the first build step), and the page's main thread is held
for ~13 s once by the build (nothing animates then, before or after).

Abandoning: choosing Yosemite mid-flight while Upper Hoh Road was 57% built tore Upper Hoh Road down (`__weDisposed`, 7 to
9 ms) and Yosemite was ready 20 s later. Five choices in a row, 7 s apart, alternating the two, showed the renderer's
geometry count climbing by about 75 to 100 per abandoned build (textures and programs do not climb), on main as on this
branch: an older leak in the teardown of an abandoned build, not touched here and noted as a follow-up.

## 2026-11-06: the panels' items fade in up, staggered; visitors browse the places (branch claude/home-tile-framing)

Aaron: "instead of sliding in left and right the elements should fade in up, staggered from top to bottom ... and the
interval between fadeInUps should decrease." And: "For not logged in users, show all locations and let them navigate to
them but not start them. Start button should be grayed out - when hovered a tooltip should appear saying 'Log in or sign
up to start'".

**The entrance** (title.js sideIn, staggerIn): no slides. Once the title and the earth have landed, the panels become
visible and their items (the search box, the heading, each place's row, Layers and the credits; the account card, the
social panel's frame, the find box, the tabs, each group card or friend row; the sign-in card and each of its rows; the
phone's pill and row) each fade in rising 10 px over 520 ms with one easing, ordered by their top on screen across both
columns, items within 6 px of each other together. The gaps between starts are 120 ms, then 0.8 of the one before, down to
25 ms. Below the window's bottom an item just shows. Reduced motion: the same order, fades only. The same sequence runs
after the landing, after a visitor signs in (the social column alone), after Exit to main screen, for the signed-out
sign-in card and for the no-hub Explore button. A row added later by the list's own re-sort also fades in up (tt-in).
Start times at 1440x900 signed in (`staggerLog`):

| ms | top px | item |
|---|---|---|
| 0 | 24 | `tt-search` × |
| 0 | 24 | `so-card` aaron@aaron_t · sharin |
| 120 | 84 | `tt-head` Most activeeverywhere |
| 216 | 95 | `so-aside` GroupsFriendsRequests1 |
| 216 | 96 | `so-find`  |
| 293 | 128 | `tt-row` ArnoldHighway 4, Big T |
| 354 | 152 | `so-tabs` GroupsFriendsRequests1 |
| 403 | 221 | `so-gcard` Explorersquiet |
| 443 | 231 | `tt-row` Daly CityJohn F Foran  |
| 474 | 313 | `so-gcard` Sunday flightquiet |
| 499 | 334 | `tt-row` El DoradoRoute 50, Mot |
| 524 | 405 | `so-new` New group |
| 549 | 437 | `tt-row` Fossil ForestNortheast |
| 574 | 540 | `tt-row` Grand Canyon VillageEa |
| 599 | 643 | `tt-row` MoskenesMoskenesveien, |
| 624 | 746 | `tt-row` NashvilleSand Ridge Ro |
| 649 | 823 | `tt-layers` Layers |
| 674 | 849 | `tt-row` PlacervilleRoute 50, P |
| 699 | 857 | `tt-attrib` Map OpenFreeMap · © Op |
**Visitors** (title.js browse): signed out, with a hub, the earth is lit as for a player and the places list, the dots
and the labels come in with the sign-in card. Any place can be chosen and flown to with the slow centre-framed zoom
(paced at its own speed: nothing loads) and backed out of; the hub is not asked for anything more. No world is built
for a visitor (choose skips onSelect), since they cannot enter it. Start is greyed with `aria-disabled="true"` (not
`disabled`, which takes no hover) and does nothing when pressed; its tooltip, "Log in or sign up to start", is the home
screen's own (`.tt-tip`, role tooltip, `aria-describedby`), shown on hover and keyboard focus, and for 2.6 s after a
tap on a touch screen. Invite, the loading line, the friends' faces and the social column are not shown. On a phone the
sign-in folds behind a "Log in or sign up" pill at the top right so the places can be browsed. Signing in while a place
is chosen takes Start's greying off, builds that place's world at once and staggers the social column in. A page with
no hub (Explore) and `?hub=stub` are unchanged; `?skip=1` has no home screen.

Verified in headless Chrome on the local hub (127.0.0.1, test accounts): signed out at 1440x900 and 375x812 (20 and 22
items staggered; Start `aria-disabled`, not disabled; Invite hidden; no world building; the tooltip shown on hover and
on a touch tap, no page errors), signed in at both widths (19 and 14 items), reduced motion (the same order, no rise),
signing in while Upper Hoh Road was chosen (Start live, the world at 20% 2.5 s later, the social column's 7 items
staggered, Start enabled when ready), `?hub=stub`, a static host with no hub (Explore staggered in, then the places),
and `?skip=1`. Frames were captured every ~100 to 250 ms (headless screenshots are slow); the start times are exact.
