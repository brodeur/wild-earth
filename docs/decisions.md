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
