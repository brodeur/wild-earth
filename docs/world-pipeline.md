# The world pipeline: a tile anywhere on Earth, from land to games

A design for review, written 2026-11-05. It widens `docs/gestalt-pipeline.md` (the paragon, written earlier the same day)
to the whole pipeline, as Aaron asked: "don't anchor too heavily on my insights or ideas - anchor on the goal: A pipeline
that can generate a tile anywhere on earth. Paragon may not be the right approach - it's just an idea. Think about the
problem strategically, and design a pipeline from land generation, to the ecosystem through the seasons, the animal
behaviors and the games." The published version: https://claude.ai/artifact/CRXGhhEe16r6njnDD8dKvU.

It builds on the four-stage pipeline that exists (`docs/pipeline.md`: base, flora, fauna, games; fingerprints,
`cost.json`, the registry) and keeps its rules: every source credited, nothing non-commercial in a client layer, a stage
reads only earlier stages, hand edits are the measure of repeatability.

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
