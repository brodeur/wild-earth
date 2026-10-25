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
900-1500 m fade, weighted toward the crown rim (inside it the real crown's own shadow takes it);
(3) thinned far trees grow by 1/keep in silhouette area (width keep^-0.72, height keep^-0.28,
was keep^-0.53 in total), so a stand's cover holds to the horizon instead of opening into single
trees on the skyline; (4) coverage-preserving mips shift the alpha instead of scaling it (no
saturated, square crowns at the coarse levels), trees sit inside a 6-texel cell margin and quads
are trimmed to what any level down to 8x8 texels covers; (5) slots that share a seed are baked
once (28 trees for 72 slots): atlas 60 to 23 MB, bake about 1.1 s to 0.45 s. Seam match after,
impostor minus real over the hand-over band (green, six views): -1.8% to +1.3% at 1.5 km (was
-3.5% to +1.2%), -1.3% to +3.3% at 900 m (was -4.6% to +1.5%). Rejected: sharper alpha-to-coverage edges
(they cured the capture salt by making crowns blocky), a blend state that keeps the canvas alpha
(0.45 ms at the start view for an off-screen artefact). Still open: the per-cell swap when the
mid set moves is a representation change on a ring of trees at about 1.5 km (subtle, not a seam);
impostors cast no shadows (beyond the mid set the ground between far trees is unshaded); far
crowns of 2-4 px are still single blobs whose shape is set by 4x4-texel mips.
