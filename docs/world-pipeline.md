# The world pipeline: a tile anywhere on Earth, from land to games

A design for review, written 2026-11-05. It widens `docs/gestalt-pipeline.md` (the paragon, written earlier the same day)
to the whole pipeline, as Aaron asked: "don't anchor too heavily on my insights or ideas - anchor on the goal: A pipeline
that can generate a tile anywhere on earth. Paragon may not be the right approach - it's just an idea. Think about the
problem strategically, and design a pipeline from land generation, to the ecosystem through the seasons, the animal
behaviors and the games." The published version: https://claude.ai/artifact/CRXGhhEe16r6njnDD8dKvU.

It builds on the four-stage pipeline that exists (`docs/pipeline.md`: base, flora, fauna, games; fingerprints,
`cost.json`, the registry) and keeps its rules: every source credited, nothing non-commercial in a client layer, a stage
reads only earlier stages, hand edits are the measure of repeatability.

## Revision 2 (2026-11-05, after Aaron's review)

Aaron: "I don't see geology or soil - both of those should be a part of the pipeline... we need to understand the rocks
in order to produce good results. Probes first - figure out if the primitives are correct. IUCN may be a good base layer
but we can also build our ecosystems based on the research step for species. Grows on the shady side of mountains. Grows
in riparian zones. The sea and waterways are going to be necessary to figure out... we will need to give license for
creativity to make the underwater world interesting - the data is too thin. Players judging will be a later feature. For
now, I think we will allow players to 'request a tile'. Eventually, we will allow players to pay to have tiles made."

What changed, section by section below: **geology and soil** are first-class layers of the land stage (3a); **ecosystems
are composed from the species' researched niches**, with the IUCN groups as the structural base layer beneath them (3b);
**the sea and waterways** get their own design, with a labelled licence to invent under water (3c); **players request
tiles** through a queue, and judging by players comes later (3d); and the order of work is **probes first**: the three
probe tiles run through today's primitives with only what they need to run outside the US, and phase 1 is decided by
what they show (7, and the probe report `docs/probes-2026-11.md`).

## 1. The problem

**What makes a generated place feel true.** People recognise a scene's kind before they recognise anything in it:
openness, depth, roughness and the colour of the light are read in a glance, ahead of objects and species (Oliva and
Torralba 2001, the "spatial envelope"; Greene and Oliva 2009). That gives an order of what matters to the eye:

1. **Layout**: landform, water, the horizon, how open or closed the space is.
2. **Structure**: how tall the vegetation is, how dense, in how many layers, with what gaps.
3. **Light and colour**: the palette of the ground and the foliage, the sky, haze and fog, wetness.
4. **Time**: the season's state (leaf, flower, snow, flood, dry), the day's light, the weather.
5. **Signature**: the handful of things only this place has (moss-hung maples, saguaros, a wildebeest column).
6. **Life**: animals at believable numbers, doing believable things at the right hour and month; sound.
7. **Relationships**: who eats whom, who follows whom, who makes the holes others live in: the games.

The pipeline today is strongest at 1 and at the species half of 5 and 6, and weakest at 3, 4 and the structure half of
2. The Hoh measurement shows it (2026-11-05). The species are right, but against 56 openly licensed photos of the forest
floor the render is twice as dark (median L* 20 against 39), blue-green where the place is yellow-green (hue 145° against
117°), with no moss colour (0.03 % of pixels against 32 %). The two share 0.18 of their colour histogram; two photo sets
of the same place share 0.82.

**What anywhere means.** The pipeline today stops outside the US: NAIP and LANDFIRE fail loudly, and the resource
rasters, calendars and animal tables are California's. The rest of the planet differs in the ways that break it:

| where | what is different | what runs out |
|---|---|---|
| Europe, Japan, NZ, Australia, Canada | national lidar exists (often CC BY), no LANDFIRE | vegetation classes, US-only fetchers |
| Most of the land | 30 m terrain only, which is a surface model under forest | 1 m ground, crowns, logs |
| The tropics | cloud, hyper-diverse forests, wet and dry seasons instead of four | GBIF plants (Danum Valley: 1,750 plant records for a forest with hundreds of tree species; Serengeti: 459), lidar |
| Polar and high latitude | midnight sun and polar night, permafrost, sea ice | imagery in winter, species records |
| The coast and the sea | tides, waves, bathymetry, kelp and reef | everything the land pipeline knows; the client has no sea at all yet (the San Francisco cells) |
| Sparse places | few photos, few records, little literature | per-place research of any kind |

Data checked today on seven candidate tiles (GBIF records; iNaturalist research-grade, wild, openly licensed photos;
Wikimedia Commons geotagged files; 500 is the query's cap):

| tile | place | GBIF all | plants | mammals | iNat open photos | Commons |
|---|---|---|---|---|---|---|
| utm10n_429_5293 | Hoh rain forest (built) | 31,643 | 4,366 | 592 | 1,113 | 249 |
| utm12n_558_4964 | Lamar Valley, Yellowstone | 24,768 | 712 | 2,244 | 477 | 110 |
| utm36s_698_9724 | Seronera, Serengeti | 66,605 | 459 | 1,939 | 681 | 500 |
| utm33n_412_7531 | Moskenesøya, Lofoten | 13,515 | 4,184 | 142 | 201 | 500 |
| utm50n_582_543 | Danum Valley, Borneo | 71,761 | 1,750 | 895 | 1,202 | 176 |
| utm34n_687_5843 | Białowieża Forest | 242,913 | 76,136 | 80,676 | 1,771 | 346 |
| utm21s_532_8076 | Porto Jofre, Pantanal | 6,669 | 37 | 662 | 258 | 25 |

The density of evidence varies by three orders of magnitude, and not with how remarkable the place is. A pipeline for
anywhere has to make a good tile from the thinnest column, and a better one wherever the evidence is richer.

## 2. The approaches

| approach | how | strengths | weaknesses |
|---|---|---|---|
| **A. Research each place** (the paragon, as first designed) | an agent reads the literature and photos for each tile and writes its gestalt; generators read it | the best fidelity where literature is rich; captures signature | cost per tile; fails where literature is thin (most of Earth); quality depends on the agent's reading; hard to check |
| **B. Biome templates** | a library of ecosystem types; a tile is a mix of them | cheap, global, consistent; one card serves thousands of tiles | every savanna looks alike; misses signature; misses local structure |
| **C. Fit to measurements** | measure the tile from satellites and lidar, fit generator parameters to imagery and photos | grounded; improves automatically; works wherever satellites see | needs a measurable target for each parameter; photos thin in most places; can overfit colour while structure stays wrong |
| **D. Generative models** (diffusion textures, world models) | generate terrain, textures or scenes from prompts or images | fast visual plausibility | not grounded in the real place; inconsistent across tiles and seasons; provenance and licence unclear; no playable systems underneath |

**Recommended: measure everywhere, generalise by ecosystem, research only the signature, and judge everything.**

- **Measure** (C, without learning): every layer that a global or national dataset measures is taken from it, at the
  best resolution the tile has: terrain, water, land cover, canopy height and cover, colour by month, phenology, snow,
  climate, soils, the human footprint. A measurement is the same quality in Borneo as in Washington wherever the
  satellites reach.
- **Generalise** (B): what cannot be measured from space (the understory, moss, deadwood, the species' look, the animals'
  numbers and habits, the season's resources) comes from **ecosystem cards** keyed on the IUCN Global Ecosystem Typology
  (Keith et al. 2022: about 110 ecosystem functional groups across land, fresh water and sea, each with mapped
  indicative distributions), and from **trait-driven rules** for animals (body mass, diet, locomotion, activity). One card
  serves every tile of its ecosystem.
- **Specialise** (A, made small): an agent researches only the **signature layer** of a place (what the measurements and
  the ecosystem card miss), and only where evidence exists. The paragon survives as this layer, a few hundred words and
  a short ranked list, not the whole description.
- **Judge**: every tile is rendered and compared against what exists for it: always the satellite (a top-down render
  against Sentinel-2 by month), photos where there are any, ecological checks always, and people when they play it. The
  judge's scores, per layer, decide where the next hour of work goes.

Why this one: it is the only option whose floor is global and whose ceiling rises with evidence. A tile in the
Pantanal (37 plant records) is still built from measured terrain, water, structure, colour and seasons, an ecosystem
card's understory and a trait-driven fauna. The Hoh adds its moss and nurse logs through the signature layer, and the
judge shows which mattered. Option D is kept only as a possible texture source, never for the layers players rely on.

## 3. The pipeline, end to end

Six stages. The first four are today's base, flora, fauna and games, widened. Two are new.

    land ─> ecosystem ─> seasons ─> animals ─> games ─> judge
     │         │            │          │         │        │
     terrain   ecosystem    monthly    species   needs x   satellite
     sea       map (EFG)    state:     traits    resources photos
     water     structure    leaf,      density   x opp-    rubric
     ground    plants       snow,      behaviour osition   ecology sim
     climate   look         water,     bodies    inter-    fidelity
     footprint signature    fruit,     (models)  actions   report
                            presence             signature
                                                 games

Today's stages map onto these: base is land; flora is ecosystem; the seasons stage takes today's `seasons` and
`resources` steps and generalises them; fauna is animals; games is games; judge is new. Each step remains a `Step` with
modules, inputs, outputs and a fingerprint.

### Land (today's base, made global)

| layer | best available | global floor | notes |
|---|---|---|---|
| terrain | national lidar DTM 1 m (US 3DEP; Norway, Netherlands, England, Spain, Switzerland, Denmark, Finland, NZ, Australia, Canada: most CC BY or equivalent) | Copernicus DEM GLO-30 | GLO-30 is a surface model: under forest it carries the canopy. Subtract a canopy-height map's share (Meta/WRI 1 m or ETH 10 m) to approximate the ground; FABDEM does this but is non-commercial |
| sea floor and coast | national topobathy lidar; EMODnet (Europe) | GEBCO grid (about 450 m) | the coastline from OSM; the intertidal zone from tide range and slope |
| tides and waves | national tide predictions | ERA5 waves; the FES tide model if its licence allows redistribution (TPXO is academic-only: avoid) | v1 draws the sea surface, tides and shore; under water is later |
| water | NHDPlus HR (US), national hydrography | routing on the DEM everywhere (exists), MERIT Hydro (under its ODbL option) and OSM for names and permanence, HydroLAKES, JRC Global Surface Water for monthly extent (HydroRIVERS is pipeline-only: WWF's licence) | the reroute onto the 1 m thalweg exists where lidar does |
| ice and snow | national glacier maps | Randolph Glacier Inventory 7, OSM; monthly snow from Sentinel-2 | the meltwater rules exist |
| geology and soils | SSURGO (US), national | Macrostrat (exists, global), SoilGrids 250 m | |
| imagery | NAIP (US, 0.6-1 m) | Sentinel-2 10 m by month (the seasons step exists) | the human footprint erased with OSM and land cover (exists) |
| climate | Open-Meteo last year hourly (exists, global) | ERA5 monthly normals | WorldClim is non-commercial: pipeline-only |
| human footprint | OSM (exists, global) | + WorldCover built-up | |

### 3a. Geology and soil: first-class layers of the land stage

The US tiles already carry both. `geology/` (Macrostrat, then USGS SGMC) gives map units and a rock class per 30 m cell
(`client/geology.png`: unit index, rock class); `soils/` (SSURGO) gives map units with texture, rock fragments and depth to
bedrock (`client/soils.png`); `ground` combines them with slope, convexity and canopy into the outcrop likelihood
(`client/outcrop.png`) and ground classes; `substrate` makes the exposed rock, cliffs and their facets (`client/substrate.png`).
The world pipeline makes each global and makes rock drive more:

| layer | best | global | notes |
|---|---|---|---|
| bedrock lithology and age | national geological surveys (US SGMC; BGS, NGU, Geoscience Australia ... where open) | Macrostrat (CC BY 4.0, global carto layers; already the first source) then GLiM (the Global Lithological Map) as the coarse floor | rock class from lithology: the classes the client draws (sheeted granite, bedded slate and schist, blocky greenstone and volcanic) widened to limestone/karst, sandstone, basalt, serpentinite/ultramafic, unconsolidated sediment, ice |
| soil | SSURGO (US), national soil maps | SoilGrids 2.0 250 m (texture, coarse fragments, pH, organic carbon), in the SSURGO encoding (`pipeline/soils_global.py`, done for the probes) | depth to bedrock is not in SoilGrids: a global depth-to-bedrock layer (licence to check) or the rock and slope rule |
| exposed rock, cliffs, talus | lidar roughness (US) | outcrop from rock resistance x slope x convexity x thin soil; talus below cliffs by rock class and slope | the substrate step exists |

What rock drives, and where each lands in the pipeline:

- **Landform texture**: the cliff pattern, joints and scree size per rock class (client terrain shader, exists for three classes).
- **Outcrops, cliffs, talus**: the ground and substrate steps (exist), with the resistance of each new rock class.
- **Soil**: where no soil map exists, the parent rock sets texture and pH (granite: sandy, acid; limestone: clay, alkaline;
  basalt: fertile clay; serpentine: thin, toxic).
- **Water chemistry**: carbonate rock makes hard, clear water, travertine and springs; granite soft water; peat brown water.
  A per-reach water colour and clarity in the water step.
- **Species**: a species' niche names the rock and soil it needs (serpentine endemics, limestone calcicoles, granite-outcrop
  specialists, black cotton soil for whistling thorn); the composition step reads it (3b).

### Ecosystem (today's flora, keyed globally)

**The ecosystem map.** Every 10 m cell gets an ecosystem functional group (EFG) and a local setting:

- The EFG comes from land cover (ESA WorldCover 10 m, or Dynamic World), RESOLVE ecoregions, climate (ERA5), terrain
  position and the IUCN GET indicative maps. Where a better classification exists it is cross-walked: LANDFIRE EVT and
  NatureServe in the US, national vegetation maps elsewhere. Hoh valley floor: T2.3 oceanic cool temperate rainforest;
  Serengeti plains: T4.1 trophic savanna; Danum: T1.1 tropical lowland rainforest.
- **Structure is measured**, not assumed: canopy height and cover from lidar where it exists, else the Meta/WRI 1 m map,
  else ETH 10 m, checked against GEDI footprints. Gap fraction, layering and crown sizes follow; where there is no 1 m
  data, crowns are synthesised from the height and cover by allometry (the pipeline already fills unflown cells this way).

**Ecosystem cards** (`library/ecosystems/<efg>.json`) hold what is true across an EFG, as ranges with sources: vertical
structure by layer, plant functional types and their shares (needleleaf evergreen tree, broadleaf deciduous, palm,
succulent, tussock grass, forb, fern, moss, epiphyte), ground materials, moss and epiphyte load by substrate, deadwood,
fire and flood regime, phenology shape, light and air, typical animal guilds and densities. A **setting card** (designed
earlier today: valley-floor rain forest, braided gravel bar) specialises an EFG to a region and landform where the
difference shows. About 25 terrestrial EFGs cover most land area; cards are written once, by an agent, with sources, and
checked.

**Plants.** Species come in three tiers. Measured: the tile's GBIF records (CC0 and CC BY for anything shipped) and sPlotOpen vegetation plots (pipeline-only until the plot licence is confirmed), weighted by the EFG
cells (exists for GBIF). Regional: national floras and checklists where GBIF is thin. Functional: when a tile still lacks
species, a functional type stands in, coloured and sized by the EFG card and the tile's Sentinel-2 colour. This is the
registry's level 1. A plant species is a trait card (exists), reused by every tile it grows on.

**Look.** The EFG card, setting and signature compile into `client/look.json`, with rasters for setting, moss and
deadwood (designed in `docs/gestalt-pipeline.md`). The client's hard-coded foothill values (`MOSS_GREEN`, the ground's
thatch and oak litter, the resource curves) move into it.

**Signature** (the paragon, made small). An agent reads the place's sources (LANDFIRE BpS and NatureServe text, NPS and
park pages, Wikipedia, open literature) and photos. It writes only what the measurement and the card miss: a ranked list
of signature features and species, each with evidence, and the views the judge should render. In the Hoh that is the
clubmoss maples, nurse logs and colonnades. In the Serengeti it is kopjes, whistling-thorn and umbrella-thorn, and the
migration. With thin evidence the list is short or empty, and the tile still stands on its measurement and card.

### 3b. Ecosystems from the species' niches, on an IUCN base layer

Aaron's point: the habitat rules should come from each species' researched niche ("grows on the shady side of
mountains", "grows in riparian zones"), composed per tile from the species list. The two fit as two layers:

- **The base layer (IUCN group, measured cover)** decides *structure*: how much of a cell is tree, shrub, herb, rock or
  water and how tall (WorldCover, canopy height, lidar), and gives what cannot be measured or researched for every
  species: the ground materials, moss and deadwood loads, phenology shape and the look. It also stands in when a tile's
  species are unknown.
- **The niche layer (species research)** decides *who* fills each cell. Every plant species gets a niche block on its trait
  card: elevation band, aspect (pole-facing, equator-facing), slope, height above the nearest stream and wetness index
  (riparian, floodplain, upland), rock class and soil (texture, pH, depth), light (canopy, gap, open), salt and tide, fire.
  Sources: the literature the card already cites, and the species' own GBIF occurrences on and around the tile
  sampled against the tile's rasters (an occurrence envelope: the 5-95 % range of each variable where it was recorded).
- **Composition** per 30 m cell: each candidate species' suitability is the product of its niche terms, times its regional
  abundance (GBIF records, vegetation plots), within the layer capacity the base layer measured (one canopy, an
  understory under it). The Hoh's zonation (Sitka spruce in the valleys, silver fir on the slopes, mountain hemlock high,
  alder on the bars) then comes out of the species' own niches instead of a regional table, and a new place needs no rule.
- The probes ran a first step of this (`species_mix.research_rule`): outside the regional tables a community is filled from
  the tile's researched species that have a record, weighted by records. Niches come next (phase 1).

### 3c. The sea and waterways

| part | measured | rules | invented (labelled) |
|---|---|---|---|
| rivers and streams | routing on the DEM (exists, global), OSM names, river width where open data allows, permanence from climate | banks, beds, pools and riffles (exist); width from discharge where unmeasured | |
| lakes | OSM, JRC surface water by month, HydroLAKES | depth from shore slope where no bathymetry | lake-bed texture |
| coast | OSM coastline, the DEM, WorldCover, lithology | cliff or beach from slope and rock; dunes behind sand; the intertidal zone from tide range and slope | |
| tides and waves | a tide model where its licence allows redistribution, national predictions; ERA5 waves | tide rhythm on the tile's clock; surf height from wave height and exposure | |
| sea floor | GEBCO (public domain), national and EMODnet bathymetry near shore | sediment from open seabed maps where they exist, else from depth, slope and the coast's rock | the scene under water: kelp, rock, sand ripples, coral, the small life |
| habitats | kelp, coral and seagrass extents where open (CC BY) | the marine ecoregion's typical habitats by depth and light | their arrangement at metre scale |

**The licence to invent under water.** The data is too thin to draw the sea floor at a diver's scale anywhere. Under water
the pipeline may create, within rules:

1. **Plausible for the place**: a scene is chosen from a library of sea-floor archetypes (kelp on rock, sand with seagrass,
   coral bommies, mud with burrows, boulder fields) by what is measured or known: depth, light, temperature, the coast's
   rock and sediment, the marine ecoregion. A tropical lagoon gets no kelp; Lofoten gets no coral.
2. **Never over a measurement**: a mapped reef, kelp bed or bathymetry is drawn as measured; invention fills only between.
3. **Labelled**: every invented layer carries `invented: true`, the rule and its seed in the manifest; the fidelity report
   lists invented layers apart from measured ones (an "I", never a level); the client can show what is real.
4. **Deterministic**: seeded by the tile and the place, so neighbours agree and a rebuild is the same.
5. **Reviewed**: an invented layer is a hand-edit item until someone has looked at it.

**Under water: rich, invented, and placed by physics** (Aaron: "interesting and detailed where it makes sense, but also
large portions will be sandy or muddy at the outflow of a river... the pipeline should invent rich ecosystems even if there
isn't data to support that"). Two passes, both labelled `invented` wherever no survey stands behind them:

*1. The sea floor's sediment and rock, from what is measured.* Inputs: bathymetry and its slope and rugosity (GEBCO,
EMODnet, national surveys); the river mouths and their sediment supply (the routed channels reaching the coast, their
drainage area times runoff times the catchment's erodibility from the geology); wave exposure (fetch along the coastline
and ERA5 wave height); tidal range (EOT20 or FES2022); the coast's rock; sea temperature and turbidity (Sentinel-2 and
the marine reanalysis); latitude. Rules, in order:

| where | sediment | why |
|---|---|---|
| off a river mouth, within a distance that grows with the sediment supply | a fan or delta: sand bars at the mouth fining seaward to silt, then prodelta mud; a turbid plume over it | the river drops its load where the current slows |
| sheltered bays and inlets, deep basins below the storm wave base (about 2-3 times the 1-in-1-year wave height) | mud | nothing stirs it |
| the exposed shelf within the wave base | sand, rippled across the dominant wave direction | waves winnow the fines |
| steep slopes, drop-offs, headlands of resistant rock (the geology's resistance), high rugosity | bare rock, boulders, cobble | too steep or too exposed for sediment to stay |
| the shore | sand beaches in sheltered concave coves with supply; gravel and cobble on exposed hard-rock coasts; mudflats in sheltered tidal flats | the coast's rock, exposure and tide |

So most of a coast's sea floor is plain sand and mud, as Aaron expects, and the detail gathers where it belongs.

*2. Life on it, invented where the data is thin.* Habitat by substrate, depth and light (the plume cuts light), water
temperature and latitude:

| substrate | conditions | habitat |
|---|---|---|
| rock | cold to temperate (sea surface under about 20 deg C), lit | kelp forest (Lofoten: Laminaria hyperborea), urchin barrens where kelp is grazed |
| rock or carbonate | warm (winter minimum above about 18 deg C), clear, lit, away from plumes | coral reef: fringing reef on the shore, bommies, a drop-off at its edge |
| sand or mud | lit, sheltered | seagrass meadows (temperate Zostera, tropical Thalassia) |
| mud | intertidal, tropical / temperate | mangrove (WorldCover maps it) / salt marsh and mudflat |
| rock walls, drop-offs | below the light | sponges, sea fans, anemones |
| sand and mud | deep, dark | burrowed mud: sea pens, burrows, brittle stars |

The species are chosen from OBIS records of the marine ecoregion and depth band (CC0 and CC BY records only), mapped to
marine archetypes the client can draw (kelp, seagrass, coral heads by growth form, sponge, anemone, sea star, urchin, a
schooling fish, a reef fish, a ray, a shark, a turtle, an octopus, a seal, an otter). Where OBIS is thin, a habitat card
holds the typical community of that habitat in that climate. The arrangement at a metre's scale (bommies along a reef
edge, sand channels, kelp holdfasts, ripple fields, boulder fields sized by the rock class, schools over the drop-off) is
invented, seeded and labelled. Detail and richness are spent where the habitat is complex (reefs, kelp, walls) and plain
sand stays plain.

The same licence will serve the other places the data cannot reach (caves, the soil's life under a digging animal).

### 3e. Bark from research: a description, then parameters, then a texture where parameters run out

Aaron: "there should be a research step to find descriptions of the bark and generate based on the description." Today a
species' bark is a few fields on its trait card (`trunk`: colour and one pattern of plates, fibrous, shreddy, smooth,
peeling or mottled), drawn by `treegen.js` (`barkTextureSteps`, the per-species `barkSp` moss, lichen and fissure depth)
with the close layer's parallax, hex tiling, moss and wet (decisions, 2026-11-04). The probes drew a Bornean dipterocarp,
an umbrella thorn and a downy birch with those few words; the generator had nothing else to go on.

**The research step** (`bark`, flora stage, before `plants`; one run per species, cached in the library like a card):
an agent reads published descriptions (floras and eFloras, Silvics of North America and FEIS (public domain), POWO (CC BY),
PROSEA and national floras, Wikipedia (CC BY-SA), field guides read for facts only), records each source and its licence,
and writes a structured `bark` block on the card:

| field | example (downy birch) | example (Parashorea malaanonan) |
|---|---|---|
| colour by age (young, mature, old), words and CIELAB | white to grey-white; old base dark grey-brown | grey to pale brown; reddish inner bark |
| pattern | smooth, lenticellate, peeling in thin horizontal strips; fissured at the base when old | flaky, shed in large thin irregular plates; buttressed |
| furrows: depth, width, orientation | old base only: 1-2 cm, vertical | shallow, none to 0.5 cm |
| plates and scales: size, shape | none | 10-30 cm, thin, irregular |
| lenticels: shape, size, density | horizontal dark bands 1-5 cm, dense | sparse, round |
| peeling: unit, colour under | papery strips, pink-orange under | plates, ochre under |
| age transitions | smooth to 30 cm dbh, base fissured past 60 years | smooth when young, flaking from 20 cm dbh |
| sources, confidence | per field | per field |

**Where the description becomes parameters.** Most of it maps onto what `treegen` already draws, widened: colour by age
class (the age classes exist), the pattern widened to the classes above, fissure depth and orientation (the parallax's
height field), plate and scale size (the hex tiling's cell size and the height profile per cell), lenticel bands (a new
term in the same shader: a horizontal dash pattern), peeling (the madrone's curl already exists), and a smooth-to-rough
transition by trunk diameter. **Where parameters run out** (a pattern the shader cannot make: the kigelia's flaking grey,
a paperbark, a strangler fig's lattice), a **texture is generated from the description**: procedurally first (a library of
bark recipes keyed by the pattern classes, seeded per species), and by a generative image model only where its licence
allows the output to ship (an open question kept from revision 1). Generated textures are CC0 by construction in the
procedural case and are recorded with their method either way.

**Checked against photos**: openly licensed close-ups of the species' bark (iNaturalist and Commons, CC0, CC BY, CC BY-SA,
filtered per photo as for the place photos), else of its genus. The render of the bark at 1 m is compared by the same
statistics as the place photos (CIELAB palette, lightness, the texture's orientation and feature size) and by the vision
rubric ("does this bark match these photos?"). A miss tunes the parameters inside the description's ranges; a species
without photos keeps the description's values, marked unchecked. Cost: about $0.30-0.60 of Claude a species for the
research, once; the photo check is compute.

### Seasons (new as a stage; built from today's seasons and resources steps)

The world runs on the tile's own calendar, not four northern seasons:

- **Months as the time step.** Each layer has a state per month: leaf on and off, colour (Sentinel-2 by month, exists),
  green-up and senescence dates per 30 m cell (fitted from the Sentinel-2 series), snow cover, water extent and level
  (JRC monthly, the gauges where they exist), flowering and fruiting per species (iNaturalist's phenology annotations,
  counted by month), animal presence per month (GBIF month facets, exists as `seasonal.json`), migration windows.
- **The tile's seasons are derived**, then named: the growing season from temperature and moisture, wet and dry from
  rainfall (the Serengeti's short rains, long rains and dry season), polar day and night from latitude (Lofoten has
  midnight sun from late May to mid July and polar night from early December), snow and thaw. The client's season name is
  the tile's own.
- **Resources by month** are derived, not tabled: browse, grass, forbs, fruit, seeds and mast, nectar, insects (degree
  days), carrion turnover, water and cover come from the plant functional types, phenology and climate. They replace
  `habitat.RESOURCE_BASE`, which gives acorn mast by California habitat class.

### Animals (today's fauna, made trait-driven)

- **Species.** GBIF by class, every predator and scavenger (exists); OBIS for the sea (CC0 and CC BY datasets); eBird only inside the pipeline (Cornell's terms bar
  commercial derived products). In sparse tiles, regional checklists fill the list; the signature research adds what records
  miss (cougars are rarely recorded; so are most of the night's animals).
- **Traits**: diet (EltonTraits, exists), body size and wing shape (AVONET for birds; COMBINE for mammals), amphibian traits
  (AmphiBIO), diel activity, locomotion (exists), senses (exists, by class and size).
- **Numbers from rules, corrected by evidence.** A herbivore's density follows its body mass, log10 D = 4.23 - 0.75 log10 M
  (Damuth 1981; D per km2, M in grams): about 4 per km2 for a 60 kg deer, 1.5 for a 250 kg elk. A carnivore's follows its
  prey: about 90 kg of a carnivore per 10,000 kg of prey (Carbone and Gittleman 2002). Then the habitat suitability per
  EFG cell (GBIF occurrences against the ecosystem map) and the literature where it exists correct it. The Hoh's elk are
  12 per km2 (Houston et al. 1987), eight times the rule: the research layer's job. Group size, home range and day range
  scale the same way by default, with Movebank tracks where an open study exists.
- **Behaviour from archetypes.** The kin machines in `animals.js` become about fifteen archetypes chosen by guild,
  locomotion and sociality: grazing herd, browser, rooting omnivore, ambush predator, coursing predator, pouncer, soaring
  scavenger, perching bird, ground bird, aerial insectivore, waterbird, burrower, arboreal climber, swimmer (new) and snake
  (new). Each is parametrised by the traits: speed, group, activity hours, flush distance, perch height, habitat. A species
  is a row of numbers and a body, not code. Signature behaviours are the exception and are written by hand: the acorn
  woodpecker's granary, a beaver's dam, a wildebeest column.
- **Bodies** climb the registry's ladder. A stand-in is the archetype's model recoloured from photos (0 credits). A
  variant is a related model reshaped (0 credits). Then comes Meshy (about 25-30 credits), then rigged and animated. The
  ladder makes every tile populated on day one, and credits are spent on the signature species first.

### Games (today's games, on global inputs)

- The classifier exists: needs x resources x opposition, per species, per season, placed on hotspots. It becomes global
  once the resources and calendars are (above).
- **The interaction web**: GloBI (its bulk release is CC0; per-record citations with `includeObservations`), EltonTraits,
  predation by body-size ratio where nothing is recorded, scavenging, and the signature research's local links (elk keep
  the Hoh's understory open; Douglas squirrels cache cones; pileated woodpeckers make the cavities others use). Each link
  maps onto a system the client plays (preyOf and hunt, carrion, forage and fruit, the cache game, dig, cavities,
  competition for hotspots, browse depletion as slow state).
- **Signature games** come from the research: the Serengeti's migration crossing the tile in its months, the Hoh's salmon
  run on the bars, the foothills' granaries.
- **Balance by simulation.** Before players see a tile, an AI-only season runs headless: every species' needs met, kills
  per predator against the literature's rates, encounter rates, carcass turnover, hotspot crowding. A food web that
  starves its predators, or a hunt that never lands, fails the judge.

### 3d. Requests: how a player's wish becomes a tile

Players judging tiles is a later feature. For now players can **request a tile**:

1. **Ask**: on the map, a player picks a 10 km cell and requests it. The request stores the cell id and the account, never
   a point (the anchor rule: a location is snapped to its cell and discarded). Requests for the same cell add up.
2. **Preflight** (automatic, minutes, no Claude): `build_tile --plan` plus an evidence check like the probes' table
   (GBIF records by kind, open photos, lidar, sea share, which ecosystem cards and species records exist) and a cost
   estimate from the cost model.
3. **Queue**: ranked by requests, readiness and cost, with neighbours of built tiles ahead (shared cards and seams).
   Aaron approves the next build, and any Meshy spend, from the queue.
4. **Build**: one worker runs `build_tile --stage all` and the judge; the tile's fidelity report and captures attach to
   the request.
5. **Publish**: after review the tile goes live and the requesters are told.

Later, paid requests: a payment funds the build and its models and moves the request up the queue.

### Judge (new)

| check | where it works | what it measures | cost |
|---|---|---|---|
| satellite | everywhere | a top-down render at 10 m, at the overpass hour, against the Sentinel-2 composite for each month: colour, texture, cover, snow and water extent | free (compute) |
| photos | where open photos exist (most tiles; thin in the Pantanal) | ground-level renders at the photos' places and months: palette, lightness, green hue, moss share, edge density | free |
| vision rubric | where photos exist | structure, palette and light, density, the signature features present, the trait most wrong; and a blind place test ("where on Earth is this?") | about $0.50 a pass |
| ecology | everywhere | the season simulation above; densities against rules and literature | free (compute) |
| people | once played | Aaron's review; later players' "this isn't right here" with a photo, in the federated spirit of the project | |

The result is a **fidelity report** per tile and per layer, 0-4, beside the registry's species levels: terrain 4 with
lidar, 2 with GLO-30; structure 4 with lidar, 3 from a canopy map, 1 from the card; colour, seasons, plants, animals,
behaviour, games likewise. The map can show where the world is good and where it is a sketch. Tuning closes the loop.
Look parameters with a measurable target (grade, fog, moss colour and cover, foliage colour by month) are adjusted
within each trait's sourced range. A structural gap becomes a hand edit ("new generator: hanging clubmoss; absent in 6
of 6 poses"), ranked by how much score it would buy.

## 4. What is measured, generalised and researched

| layer | measured per tile | generalised by ecosystem or trait | researched per place |
|---|---|---|---|
| terrain, water, ice, sea | DEM, lidar, hydrography, glaciers, bathymetry | | rewilding choices (dams) |
| structure | canopy height and cover, gaps (lidar or maps) | layering, crowns without lidar, deadwood, understory | signature structure (colonnades) |
| colour and light | Sentinel-2 by month; photos | material palettes per EFG; atmosphere by climate | |
| seasons | phenology dates, snow, water extent, climate | resource curves by functional type | named events (migration, run) |
| plants | GBIF, sPlotOpen | functional-type stand-ins | signature species; checklists where records are thin |
| animals | GBIF, OBIS, months | density, groups, ranges and behaviour from traits | signature species and behaviours; local densities |
| interactions and games | GloBI records | body-size predation; the games classifier | signature links and games |

## 5. Where data runs out, and what stands in

- **No lidar.** Terrain from GLO-30, corrected for canopy. Structure from the 1 m canopy-height map. Crowns synthesised.
  Logs and roots from the ecosystem card. The fidelity report says so.
- **The tropics.** Sentinel-2 composites built from many cloudy dates (Sentinel-1 radar and Landsat as fallbacks). Wet
  and dry seasons. Hyper-diverse forests drawn as functional types plus the signature species (dipterocarps, strangler
  figs, lianas). GBIF filled from regional checklists.
- **Polar.** Daylight from latitude. Winter imagery is dark, so winter colour comes from snow cover and the card. Sea
  ice, where the tile has sea.
- **The sea.** v1 is the surface and the shore: bathymetry for the colour and the surf, tides on the intertidal zone,
  kelp, seagrass and reef extents, seabirds and seals and what can be seen from the shore. Swimming play and fish come
  with the swim rig.
- **Sparse evidence everywhere.** The floor is the measurement plus the card; the signature list may be empty. That tile
  is honest, consistent and alive, and it is marked as a sketch.

## 5b. Licences (checked 2026-11-05)

Client layers take only public domain, CC0, CC BY, CC BY-SA, ODbL or an equivalent free licence; the audit step enforces
it. Full table with URLs: `global-data-licences.md` in the shared notes folder.

- **Client OK**: Copernicus DEM GLO-30 (with its fixed notice), NASADEM, GEBCO, EMODnet; the national lidar of Norway,
  the Netherlands (CC0), England and Scotland (OGL phases), Spain, Switzerland, Denmark, Finland, New Zealand, Australia
  (GA 5 m) and Canada; Meta/WRI and ETH canopy height, GEDI; WorldCover, Dynamic World, RESOLVE, the IUCN GET maps,
  MODIS phenology; Sentinel-2, Landsat; ERA5, CHELSA v2.1 (CC0); MERIT Hydro under its ODbL option, HydroLAKES, JRC
  Surface Water, RGI 7, SoilGrids; EltonTraits, AVONET, COMBINE, AmphiBIO, GloBI's bulk release (CC0); GBIF, OBIS,
  iNaturalist and Movebank records filtered to CC0 and CC BY.
- **Pipeline-only**: HydroSHEDS core and HydroRIVERS (WWF's licence bars stand-alone distribution), FABDEM and EOX
  cloudless (CC BY-NC-SA), WorldClim, eBird data and Status & Trends, IUCN and BirdLife range maps, UNEP-WCMC seagrass,
  every CC BY-NC record; sPlotOpen plots and the Movebank default until confirmed.
- **Avoid**: BIEN (CC BY-NC-ND) and the TPXO tide model (academic-only); FES if its terms allow redistribution.

Geology and the sea (checked 2026-11-05; `geology-marine-licences.md` in the shared notes): client OK are GLiM's 0.5
degree grid (CC BY 3.0), GLHYMPS (CC BY 4.0), OpenLandMap lithology (CC BY-SA 4.0), SoilGrids WRB classes (CC BY 4.0),
GSOCmap, GEBCO and its TID grid (public domain), EMODnet seabed habitats and substrate (CC BY 4.0), the Dutkiewicz seafloor
lithology grid (CC BY 3.0), Allen Coral Atlas per tile (CC BY 4.0), EOT20 tides (CC BY 4.0) and NOAA CO-OPS (CC0),
FES2022's derived tide predictions (its raw grids may not be re-served), HydroLAKES, GRWL, SWORD, GLOBathy (CC0) and the
OSM coastline (ODbL). **Macrostrat needs a per-source filter**: the site is CC BY 4.0, but 112 Arizona maps are CC BY-NC-SA
and most world-scale sources record no licence. Pipeline-only: HWSD v2 (CC BY-NC-SA), MEOW and PPOW, full-resolution GLiM,
Kelpwatch and NASA's GOT until confirmed. Avoid: the CGMW world GIS and UNEP-WCMC seagrass. OneGeology has no common
licence (and has closed): go to open national surveys directly.

## 6. Cost

Prices: `tools/token_meter.py`'s rates (Opus 5.5 $4 / $20 per million in / out; Haiku 5.5 $0.10 / $0.50). The Hoh, for
scale: the unattended builds were about $1.50 of Claude for both tiles. Base took 28 min with 9.1 GB of lidar for the
rain forest and 22 min for Mount Olympus; flora 3 and 1 min; fauna 2-3 min each. The 19 new animals took 120 Meshy
credits and about $41 of agent time. One-off pipeline development was about $79. Per-tile numbers are in
`tiles/<id>/cost.json`.

**A tile, once its ecosystem cards exist**:

| | lidar tile (US, Europe) | global tile (30 m) |
|---|---|---|
| wall time | 1-1.5 h (lidar streaming) | 40-60 min (Sentinel-2 series) |
| downloads | 1-9 GB | 1-3 GB |
| Claude: pipeline, signature research, photo classification, judge | $3-6 | $3-6 |
| plants: trait cards for new species | about $0.50 each | about $0.50 each |
| animals: stand-in or variant / Meshy model | $0-2 / 25-30 credits and about $2 | same |

**Once per ecosystem**: an EFG card, $5-10 with sources (about 25 cover most land: $150-250). **Once per new archetype**:
a plant form (succulent, palm, mangrove, bamboo, fern, epiphyte, deadwood) or an animal rig (swim, snake), $30-80 each.

**Implementing it**, in three phases, estimated from what the Hoh lanes cost (plus or minus half):

| phase | what | Claude |
|---|---|---|
| 1. the global floor | global land sources (GLO-30 and canopy correction, WorldCover, canopy height, MERIT Hydro, SoilGrids, ERA5); the ecosystem map and the first 10 EFG cards; the monthly state and derived resources; behaviour from traits on today's archetypes; the satellite judge and fidelity report | $250-400 |
| 2. places feel true | look.json plumbing; the moss, epiphyte, deadwood and fern generators; the signature research; the photo judge and rubric; the interaction web and the season simulation | $300-450 |
| 3. the rest of Earth | the sea surface and shore; tropical, polar and arid forms (palm, succulent, mangrove); swim and snake rigs; the remaining EFG cards; players' reports | $250-400 |

About $800-1,250 of Claude in all, plus Meshy credits per species. Phase 1 alone makes any land tile on Earth build at
fidelity 2 or better in every layer.


## 6b. The ceiling for a fresh tile in a fresh region, and pricing

Aaron: "I want to find out what the ceiling is for a fresh tile in a fresh region - I need to figure out pricing." A fresh
region is one whose species have no relatives in the library (the Serengeti), so nothing is a variant.

**What we have measured.** The Meshy ledger: 695 credits across 41 species with jobs (fruit included); per species 5-40
credits typically, the worst 80 (the raven, the first experiments) and 70 (the acorn woodpecker, every candidate
rejected). The Hoh's first batch, on the California library: 19 species, 120 credits, $41 of Claude. Its second batch, on
the first: 22 species, 25 credits, $31 of Claude, nearly all variants. A tile lists about 46 animals (the Hoh); the
density target is 22. Trait cards: about $0.50 of Claude each. The probes: about 27 minutes and $3-5 of Claude a tile
for the pipeline itself.

**Meshy's prices** (meshy.ai/pricing and docs.meshy.ai/en/api/pricing, read 2026-11-05): Pro $20 a month for 1,000
credits ($0.020 a credit), Premium $40 for 3,000 ($0.013), Ultra $100 for 8,000 ($0.0125), Studio $70 for 5,500 pooled
($0.013); Enterprise is custom, annual and volume-based. The API needs Pro or above and uses prepaid credits; extra credit
packs exist (Pro gets 20 % off them) but their prices are not published. Per call: a text-to-3D preview 20 credits
(meshy-7.1 or 6; 5 for lite), refine 10 (15 at 8K), image-to-3D with texture 15-35, retexture 10, remesh 5, auto-rigging 5,
animation 3 a clip. Paid plans own their outputs; the free plan's are CC BY 4.0.

**The ceiling, per tile:**

| | worst case: fresh region, everything modelled | typical: fresh region, the density target modelled | a neighbour in a grown region |
|---|---|---|---|
| animals modelled fresh | 46 at 80 credits (two failed candidates each) | 22 at 35 credits; the other 24 as stand-ins | 3-6 new, mostly variants |
| Meshy credits | 3,680 (about $46-74) | 770 (about $10-15) | 0-150 (under $3) |
| Claude: animals (build, rig fit, review) | 46 x $6 = $276 | 22 x $4 = $88 | $10-25 |
| Claude: new body plans (rigs: primate, snake, swimmer, giraffe proportions) | 4 x $50 = $200 | 2 x $40 = $80 | none |
| Claude: plants (cards, bark research, new forms) | 60 cards and bark $50, 2 new forms $100 | 40 cards and bark $30, 1 form $40 | 5-10 cards, $5 |
| Claude: pipeline, signature research, judge | $10-15 | $8-12 | $5-8 |
| compute and downloads | 1.5 h and 9 GB with lidar; 30-40 min and 1-3 GB without | the same | the same |
| **total** | **about $640-700 of Claude and $46-74 of Meshy** | **about $250-260 of Claude and $10-15 of Meshy** | **about $20-40 of Claude, under $3 of Meshy** |

Two things the table says. Claude's time, not Meshy's credits, dominates the price of a fresh tile: even the worst case's
credits cost less than a tenth of the agent work (the credit budget has been the binding limit so far, not the dollars).
And the cost falls fast as a region's library grows, as the Hoh's two batches show (a second batch at a fifth of the
credits and three-quarters of the Claude): by the evidence so far, the second tile of a region costs about a third of the
first, and from the fifth or so tile a new tile costs its pipeline run plus a few species.

**A pricing model for "pay to have a tile made"**: a price per tile set from the cost of its unique work, plus a share of
the species it brings into the library, because a species modelled once serves every later tile of its region.

- *Neighbour tile* (its region's library exists): a fixed price, set from the $20-40 of cost.
- *First tile of a new region*: the founder's price, set from the typical $250-275 of cost, and capped by the plan (the
  density target modelled, the rest as stand-ins until later tiles fund them). The founder is credited on the region.
- *Pooling*: requests in the same region pool their payments toward the region's first tile (the brief's matching pool),
  so the founder price is shared; later requesters pay neighbour prices.

**Batching shared species across requests.** The queue groups pending requests by region and takes the union of their
species lists. Each species is modelled once, in the order that serves the most pending tiles (a greedy cover: the
species on the most lists first), and the tiles are built in the order that reuses the most (the tile whose species
cover most of the others' first). Trait cards and bark research for a region run as one agent session (shared context,
cached reads), and Meshy jobs go in batches. A request's cost is its tile's unique work plus its share of the species it
shares with others.

## 7. The first run

The first run should test the claim "anywhere". So it is three cheap probes chosen for the gaps, then one place taken
deep:

| | Seronera, Serengeti | Moskenesøya, Lofoten | Danum Valley, Borneo |
|---|---|---|---|
| tile | `utm36s_698_9724` | `utm33n_412_7531` | `utm50n_582_543` |
| ecosystem | trophic savanna, kopjes, seasonal rivers | Arctic coast: rock peaks, heath, fjord, sea | tropical lowland rainforest |
| tests | global-only land data; wet and dry seasons; the migration; sparse plant records (459); megafauna games | national lidar outside the US (CC BY); the sea and tides; midnight sun and polar night; seabirds | cloud; no open lidar; hyper-diversity drawn by functional types; thin plant records (1,750) |
| first build | 3 EFG cards, stand-in animals | 3-4 EFG cards (heath, rocky shore, kelp, sea), stand-ins | 2 EFG cards, stand-ins |

**Probe cost**, after phase 1: about $50-80 of Claude, no Meshy credits, 4-6 h of machine time for the three. Each gets
a fidelity report and a judge score; the comparison shows which layer fails first where.

**Recommendation: take the Serengeti deep.** It is the most different from the foothills and the Hoh on every pillar,
and its gaps are the planet's typical gaps: global-only land data, few plant records, wet and dry seasons. It is the
strongest test of animals and games, with the best-known predator-scavenger web on Earth and a migration through the
tile's months. Taking it deep: about 8 Meshy models (wildebeest, plains zebra, Thomson's gazelle, Cape buffalo,
giraffe, elephant, spotted hyena, warthog; lion, cheetah and the vultures as variants), about 200-240 credits (330 are
left); 10 plant trait cards (umbrella and whistling thorn, balanites, sausage tree, red oat grass); the signature
research and two judge-and-tune passes. About $60-100 of Claude.

If Aaron wants a lower-risk first step before phase 1 exists, Lamar Valley, Yellowstone (`utm12n_558_4964`) runs on
today's US sources and tests a steppe and its wolves, elk, bison and ravens (about 150 credits). Białowieża
(`utm34n_687_5843`) is the data-rich European alternative: 243 k GBIF records and national lidar.

## 7b. The probes ran (2026-11-05), and the revised phase 1

The probes (three, then four more: the Grand Canyon, Grand Teton, Corcovado and Manu) went through today's primitives with only what they needed to run outside the US; the full report is
`docs/probes-2026-11.md`. Terrain, water routing, land cover, canopy, geology, soil, species research and the step graph
carried over. What failed is where a place's life is decided: which plants grow where (no niches; records taken for
abundance; growth forms guessed from a temperate family list), what the ground is made of (the foothills' materials
everywhere), which animals are drawn (a fixed North American cast by habitat: Danum got about 190 of them), and when the
seasons are (northern quarters everywhere). Against Sentinel-2 the renders share 0.00-0.15 of the satellite's colour
histogram, 7-10 L* lighter and half the chroma.

Phase 1 is reordered by what the probes showed, before any new generator:

| | piece | Claude (estimate) |
|---|---|---|
| 1 | composition by niche: niche blocks on plant cards (from sources and occurrence envelopes), abundance from cover, growth form from a trait source; the IUCN groups as the structural base layer | $60-90 |
| 2 | animals from the tile's own list: archetype, stand-in body and behaviour numbers per researched species; the client spawns only those; calendars and needs from traits | $60-90 |
| 3 | ground materials, grass and forbs from the tile; haze and colour calibrated against Sentinel-2 | $40-60 |
| 4 | water permanence from climate and drainage area; the sea surface and shore | $30-50 |
| 5 | seasons from the tile's climate in the pipeline and the client | $30-40 |
| 6 | national lidar outside the US; GLO-30 lowered by the canopy elsewhere | $20-40 |
| 7 | geology: Macrostrat licence filter, finer open national maps, depth to bedrock | $15-25 |
| 8 | the satellite judge automated, with the fidelity report | $20-30 |
| 9 | from the four later probes: no other region's species as a client fallback; formation colour and banding from the geology units; humidity haze in the tropics | $25-40 |
| | **phase 1, revised** | **$300-465** |

The probes and the code that let them run cost about $30 of Claude (on top of the $20 the design took), no Meshy credits.

## 8. What happens to the paragon

It is kept, made smaller, and moved. What it described splits three ways:

- Everything measurable moves to the measurement: canopy height, gaps, colour by month, snow.
- Everything general moves to the ecosystem and setting cards: the moss by substrate, the deadwood, the understory, the
  light. `library/settings/pnw_valley_rainforest.json` becomes a setting under EFG T2.3.
- The paragon keeps only the signature: a ranked list with evidence, and the views to judge.

Its checks become the judge's. The Hoh prototype files stay as the worked example.

## 9. Open questions

1. **Probes first, or one place deep?** The design recommends three probes after phase 1, then the Serengeti. The
   alternative is Lamar on today's US pipeline, sooner and narrower.
2. **The ecosystem key.** The IUCN GET is global and functional, but its maps are indicative. Is a cross-walk to
   national classes worth the work where they exist (LANDFIRE, the EU's habitat maps), or is GET plus measured structure
   enough?
3. **The sea's scope** in phase 3: the surface and shore only, or swimming and fish too?
4. **Honesty in the client.** Should a tile show its fidelity report to players (the sketch areas marked), or only to us?
5. **Players as the judge.** The federated design suggests local players correct their own tiles with photos and notes.
   Is that a goal for this pipeline, or later?
6. **Meshy at scale.** At 25-30 credits a species and 40-60 animals a tile, models dominate the cost of new places. The
   stand-in ladder makes every tile alive at zero credits. How far up the ladder should a new tile go before Aaron reviews
   it?
7. **Generative textures** (option D) for ground and bark materials, where no CC0 scan exists: allowed, if the model's
   licence permits, or not at all?

## 10. Sources

Oliva and Torralba 2001, Int. J. Computer Vision 42:145 (the spatial envelope); Greene and Oliva 2009, Psychological
Science 20:464; Keith et al. 2022, Nature 610:513 (IUCN Global Ecosystem Typology); Damuth 1981, Nature 290:699;
Carbone and Gittleman 2002, Science 295:2273; Houston, Moorhead and Olson 1987 (Hoh elk). Dataset licences:
`global-data-licences.md` and `gestalt-sources-licences.md` in the shared notes folder, summarised in the published page.
