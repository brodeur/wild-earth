# The gestalt pipeline: making a tile feel like the place

A design, written 2026-11-05, for review before anything is built. **Widened the same day into `docs/world-pipeline.md`**
(Aaron: anchor on the goal, a tile anywhere on Earth, not on the paragon). There the paragon becomes the small signature
layer, the setting cards sit under global ecosystem cards, and the checks below become the judge's. This file stays as
the detail of the signature layer and of the Hoh prototype. It extends the four-stage tile pipeline
(`docs/pipeline.md`); it does not replace it. The published version with diagrams:
https://claude.ai/artifact/CRXGhhEe16r6njnDD8dKvU (2026-11-05 decision entry).

Aaron's brief (2026-11-05): "Research the square, understand the major animals and plant and tree species, what is the
'vibe' or gestalt of that area. Collect reference photos of the area (if available) and what the inter-species dynamics
are (for games)." And: "I've been to the hoh rainforest - in the depths of the valleys the entire understory is covered
in moss. The goal is a pipeline that produces something that feels like the place, by producing each object in such a
way that it contains the vibe of the paragon. Hoh is getting close." After review it runs on a new place.

## The gap this closes

The pipeline already gets the **right species** in the right cells: LANDFIRE communities, GBIF ranks, every predator
and scavenger, trait cards, a registry. What it does not know is **condition and structure**: how much of each surface is
moss, where the logs lie and what grows on them, how open the understory is and why, what colour the light is. Those live
in hard-coded foothill numbers today, so a new place inherits the Sierra:

| what the client draws | where its number comes from today | Hoh truth |
|---|---|---|
| bark moss season | `weather.js MOSS_GREEN`: dormant June to September (the foothills) | green all year (summer fog and drip) |
| bark moss amount | the species' lichen value x rainfall, saturating at 1,500 mm | 3,400 mm; the maples carry more epiphyte mass than leaves |
| ground material | `groundDetail.js`: thatch, oak litter, gravel, rock, pavement | moss carpet, needle duff, fern, rotten wood |
| ground layer | GBIF's vascular plants; no mosses, no clubmoss; ferns drawn as rosette forbs | moss is the floor; sword fern is the understory |
| deadwood | none on the ground beyond litter-sized branches | logs on a large share of the floor, most seedlings on them |
| understory density | the species mix's shrub weights | elk-browsed: open, park-like, a browse line |
| light and grade | ACES tone mapping, no per-place grade | soft, green-filtered, low contrast |

**Measured, not guessed** (prototype, 2026-11-05). 56 openly licensed photos of the Hoh's forest interior (Wikimedia
Commons, most of them NPS public-domain) against the current render at the root-flare lane's Hoh poses, in CIELAB:

| statistic | Hoh photos (56) | current render | two photo sets of the same place |
|---|---|---|---|
| median lightness L* | 39 (per photo 32-48) | 20 | |
| median hue of the greens | 117° (yellow-green, moss) | 145° (blue-green) | 117° vs 117° |
| moss-green pixels (hue 95-125°, C* > 14) | 32 % | 0.03 % | 25 % (close-ups) |
| near-black pixels (L* < 20) | 16 % | 50 % | 16 % |
| a*b* histogram overlap with the photos | 1.0 | 0.18 | 0.82 (close-ups vs interiors) |

The render is twice as dark, blue where the place is yellow-green, and has no moss colour at all. That is the gap in
numbers, and it is what the judge (below) will measure on every tile.

## Terms

- **Setting**: a recurring scene with one gestalt, mapped onto the tile. Keyed by ecological system (LANDFIRE EVT, which
  is NatureServe's), landform (valley floor, terrace, slope, bar, ridge, cliff) and region. The Hoh tile has five that
  matter: valley-floor rain forest, river terrace alder and maple, braided gravel bars, montane silver fir slopes, and
  subalpine. A setting is a card in `library/settings/<id>.json`, written once and reused by every tile that has it
  (Mount Olympus reuses the Hoh's montane and subalpine settings).
- **Paragon**: the tile's gestalt. Which settings, their share and where they are; the place's signature features ranked
  by how much they define it; a short narrative; the reference photos; the palette per setting; the signature views; the
  interactions that shape what you see. `tiles/<id>/place/paragon.json`.
- **Trait**: one quantified, sourced statement, such as moss cover on logs 0.9 (0.8-1.0), with its unit, range, sources,
  confidence, how it is checked (lidar, photos, literature, climate) and the generator parameters it drives.
- **Look**: the paragon compiled into generator parameters: `tiles/<id>/client/look.json` and three rasters
  (`client/setting.png`, the setting per 10 m cell; `client/moss.png`, moss and epiphyte load; `client/deadwood.bin`,
  the logs).

## Stages and data flow

    base ──> place (new) ──> flora ──> fauna ──> games ──> judge (new)
               │                │         │         │          │
               ├ settings_map   ├ plants*  ├ animals* ├ games*   ├ poses
               ├ structure      ├ species_mix*       ├ interactions (new)
               ├ sources        ├ deadwood (new)                ├ render
               ├ photos         ├ look (new)                    ├ judge
               ├ photo_stats    └ crowns, inpaint               └ score -> deltas -> next iteration
               ├ paragon   (agent, cached like a trait card)
               └ paragon_check
    * existing steps that read the paragon

The place stage sits after base and before flora because it reads only base outputs (landcover, the DEMs and lidar, the
water's reaches, weather, Sentinel seasons) and flora must read it. It asks GBIF itself, through `research.py`'s cached
reader, for the species the paragon names, so it does not wait for the plants step. The judge stage runs last because it
renders the finished tile. Each new step is a `Step` in `pipeline/steps.py` with its modules, inputs, outputs and stage, so
`--plan`, `--status`, the fingerprints, `--force` and `cost.json` work as they do now.

### Place (new)

| step | after | consumes | produces | cost per tile |
|---|---|---|---|---|
| settings_map | landcover, lidar, reroute, water, ice | EVT/BpS, 1 m DEM, height above the nearest stream (from the rerouted streams), slope, the water's bars, canopy height | `place/settings.json` (each setting's cells, share, mean structure), `client/setting.png` (10 m), unmatched settings listed as hand edits | seconds, no network |
| structure | settings_map, lidar, weather, seasons | the CHM, the point cloud grid, Sentinel NDVI by month, last year's weather | `place/structure.json` per setting: canopy height p50/p95, cover, gap fraction, understory returns 0.5-2 m and 2-8 m, log candidates (long low linear features in the 1 m ground and the lowest returns), NDVI amplitude, rain, humidity, fog hours | 1-3 min, no network |
| sources | landcover | the tile's EVT and BpS codes, its OSM place and park names | `place/sources.json` and a text cache: LANDFIRE BpS descriptions (public domain), NatureServe Explorer ecological systems (CC BY 4.0), Wikipedia (CC BY-SA), NPS pages (public domain) | 1-5 MB, under a minute |
| photos | settings_map | the tile's bbox | `place/photos.json` (each photo's source, licence, author, URL, location, date, category, setting, the features it shows) and thumbnails in `place/photos/` (git-ignored, like the rasters) | 20-60 MB, 5-10 min at the sources' polite rates; a Haiku pass to classify (about $0.05) |
| photo_stats | photos | the thumbnails by setting and category | `place/photo_stats.json`: palette (k-means in CIELAB), lightness percentiles, chroma, hue of the greens, moss-green and near-black shares, the a*b* histogram, the per-photo spread | under a minute |
| paragon | structure, sources, photo_stats | everything above, the existing setting cards, GBIF's top species | the setting cards it lacks (`library/settings/`), `place/paragon.json`, `place/paragon.md` | an agent run: $3-8 for a new biome, $1-2 for a tile whose settings exist |
| paragon_check | paragon | the paragon, the measurements, the photos | `place/paragon_check.json`: pass, warn or fail per trait | under a minute; a Haiku grounding pass (about $0.20) |

**Photos.** Wikimedia Commons by geosearch on the tile's box (it refuses boxes over about 22 km; a tile is 10), iNaturalist
research-grade observations whose own photo licence is cc0, cc-by or cc-by-sa (the API's `photo_license` matches an
observation if any one photo qualifies, so each photo is filtered), excluding captive and cultivated records, from the
open-data bucket. NPS galleries by park code (each asset says whether it is public domain). Flickr only if a key is
available (now a Pro feature): licences 4, 5, 9, 10, 11, 12. The allow-list is CC0, Public Domain Mark, US Government
work, CC BY and CC BY-SA; non-commercial and no-derivatives material is never fetched. Every photo keeps its licence,
author and URL; `place/CREDITS.md` is generated from them. Photos are for **deriving** (palette, texture statistics,
structure), **grounding** (a signature feature needs photos that show it) and **judging** (the reference set the renders
are compared with). The client never receives a photo; only numbers derived from them. A CC BY-SA photo is never baked
into a shipped texture.

The Hoh tile, as a test (2026-11-05): 242 geotagged files on Commons, 234 openly licensed (75 public domain, most of
them NPS), and 1,163 iNaturalist observations with open photos. Classified by eye as a vision model would: 56 forest
interiors, 17 close-ups of moss, bark and logs, 7 river and bar views, 15 animals; the rest are signs, buildings and
people. A box around a museum or zoo needs the captive filter: the Saguaro candidate's box holds the Arizona-Sonora
Desert Museum.

**The paragon step** is the one place an agent writes. It works like the trait cards: the agent's output is a file
(setting cards in the library, the paragon in the tile) and the step is deterministic about it. The paragon records the
hashes of its inputs. If the inputs are unchanged the step is current. If they change, the step is stale and listed as a
hand edit; it re-runs the agent only with `--research` (or when no paragon exists and an agent is available), so an
unattended build never spends Claude without being asked. The agent is `claude -p` with a fixed prompt
(`pipeline/prompts/paragon.md`), read-only tools plus web search, and write access to the two paths; the runner validates
the schema after it returns.

**Sourcing order** for a trait: a measurement on this tile (lidar, weather, Sentinel, photo statistics) first; a
classification description (LANDFIRE BpS, NatureServe) second; peer-reviewed or agency literature (FEIS, Silvics, NPS,
open-access papers) third; the agent's judgement last, marked `conf: low` with the reason.

**The check.** Schema: every trait has a value, unit, range, at least one source or measurement, and a confidence.
Measurement: a trait that a measurement covers must fall within tolerance (canopy height against lidar p95; understory
density against the 0.5-2 m return share; deadwood against the lidar log candidates; moss phenology against summer
humidity; the palette must be the photo statistics', never invented). Species: every species named is in the tile's or
region's GBIF records or a cited source. Grounding: every signature feature is shown by at least three classified photos
or cited in literature. A schema error or a contradicted measurement fails the build; the rest warn.

The check, run by hand on the Hoh prototype (`place/paragon.json` `check`): canopy height **passes** (McKee's 75-85 m
spruce layer against the lidar's p99 of 82 m on the floor's Sitka spruce cells); canopy cover **warns** (Woods' 93 % by
densiometer against 74 % over 5 m in the 1 m CHM, with 26 % of the floor under 2 m: the two instruments measure different
things, and the openings match McKee's "openings up to several hectares"; the lidar value draws, the densiometer value
lights); summer moss **warns** (July has 66 mm of rain, so green all year rests on fog drip, which only a search snippet
supports); the browse line and colonnade density **warn** (no source); and the species check **warns** because the mosses
and clubmoss are not in the tile's research at all.

### Flora (existing steps that read the paragon, two new)

| step | change |
|---|---|
| plants | adds the paragon's signature plants with `why: paragon`, including mosses, clubmoss, liverworts, lichens and fungi (GBIF's vascular-plant facet never lists them) |
| species_mix | ground-layer and shrub weights and density per setting: fern, moss, herb and shrub cover; browse pressure scales the browsed shrubs' cover and caps their height |
| deadwood (new) | places logs, stumps, root wads and nurse-log colonnades per setting: lidar log candidates where the point cloud shows them, the rest sampled to the paragon's volume, diameter and decay-class mix, oriented downslope or along the river for jams. Writes `client/deadwood.bin` and `.json` |
| look (new) | compiles the paragon and settings into `client/look.json` (per setting: moss by substrate and month, epiphytes by host, litter mix, ground materials, baseline wetness, light, fog, grade, water colour) and `client/moss.png` (setting x wetness from height above stream and the wetness index x light x substrate) |

### Fauna and games

| step | change |
|---|---|
| animals | the paragon's signature animals are listed whatever their GBIF rank (an elk is quieter on GBIF than a robin); density and group size per setting; Meshy prompt fragments (coat, condition, pose) from photos of the species in situ |
| interactions (new) | `species/interactions.json`: every pair of tile species that interact, from GloBI (CC0 bulk release; `includeObservations=true` for per-record citations), EltonTraits (already read) and the paragon's literature links. Each link: type, direction, season, evidence (record count, citation), and the game system it maps to |
| games | reads interactions.json beside the calendar and diet tables |

GloBI's types map onto what the client already plays:

| interaction (GloBI type) | Hoh example | game system |
|---|---|---|
| preysOn, eats (animal) | cougar on elk; bobcat on snowshoe hare; otter on salmon | `animals.js` preyOf, `DIET`, hunt.js and evade |
| scavenging (EltonTraits, literature) | ravens, eagles and bears at elk and salmon carcasses | `carrion.js`, `relations.scavenge` |
| eats (plant part) | elk browse vine maple, huckleberry, salmonberry | `relations.forage`, forage.js, fruit.js |
| browsing pressure (literature: exclosures) | elk keep the valley open | a new resource depletion: browse cells drawn down by the herd, shrub height and cover follow (a slow game state across seasons) |
| caches seeds (dispersalVectorOf) | Douglas squirrel middens of cones | the acorn stash generalised: `acorns.js` cache and recover, with cones |
| createsHabitatFor (cavities) | pileated woodpecker holes used by owls, ducks, flying squirrels | a cavity resource: excavators make them, secondary users compete for them |
| digs burrows | mountain beaver, deer mouse | `dig.js` (`plays.dig`) |
| competes | barred owl displacing spotted owl | shared hotspots in games.json, the competitor list |
| providesNutrientsFor | salmon carcasses feeding the riparian forest | a season event: the run brings bears, eagles and gulls to the bars |
| epiphyteOf, hasHost | clubmoss on bigleaf maple | not a game: drives the look (epiphytes by host) |

## How a trait reaches each generator

| generator (file) | paragon trait | parameter of an existing generator, or new |
|---|---|---|
| bark moss and lichen (`treegen.js` barkSp, `weather.js` barkWx) | `bryophytes.cover.trunk_base / trunk_mid`, `phenology_green` by month, colour | **parameter**: `MOSS_GREEN` and the climate factor move into look.json per setting; the species' moss liking stays on its card |
| moss on limbs (`treegen.js` branch material) | `epiphytes.by_host.<species>.load`, `bryophytes.cover.limb_upper` | **new shader term**: moss on the upward faces of limbs by host load (no new sampler; it shares the bark's noise) |
| hanging clubmoss and moss curtains | `epiphytes.by_host.acer_macrophyllum.curtains` (length, density) | **new generator** `epiphytes.js`: instanced curtain strips hung from the limbs of hosts above a load, swaying with `wind.js`; licorice fern as small fronds on the same limbs |
| close layer (`litter.js`, `closeLife.js`) | `ground.litter_mix` (hemlock and spruce needles, maple leaves, moss cushions, fern fronds), fungi by substrate | **parameter** for the mix; **new kinds**: moss cushion and fallen frond; the fungi table becomes per region |
| ground textures (`groundDetail.js`) | `ground.materials` per setting, `palette` | **new layer** in the detail array (moss carpet; a CC0 scan; no new sampler, it is a texture array) and per-setting material weights; under a closed canopy the floor colour comes from the photo palette, since NAIP sees the crowns, not the floor |
| understory, forbs, grass (`species_mix`, `forbs.js`, `shrubfield.js`) | `understory` covers and species weights per setting, `browse` | **parameter**; **new habit**: a fern (frond rosette with arching pinnate fronds) instead of the rosette forb: sword fern is the Hoh's understory |
| deadwood and nurse logs | `deadwood` volume, diameters, decay mix, nurse-log share, colonnades per ha | **new generator** `deadwood.js`: logs by decay class (bark on, bark sloughing, soft and moss-buried), root wads, stumps with seedlings, colonnades (a row of trees on stilt roots over a vanished log, using the root-flare code's roots) |
| trees (`treegen.js`, `crowns.js`) | `structure` heights against lidar, buttress and stilt roots on log-born trees | **parameter** (the lidar already places crowns); stilt roots are a root-flare option |
| atmosphere and fog (`atmosphere.js`, `weather.js`) | `air.fog` frequency, valley haze, `light.understory_transmittance`, the canopy's green transmission | **parameter**: hazeDensity, hazeHeightFalloff and the fog baseline per setting; under the canopy a green-tinted sky light |
| colour grade | `palette` targets from photo_stats (lightness median, green hue, contrast) | **new**, small: a per-tile lift, gamma and gain after ACES, bounded so it can never push a value outside the sourced range |
| wet sheen | `wet.baseline` by month | **parameter** of weather.js wetness (the bark already darkens with it) extended to ground, logs, rock and leaves: darker albedo and a sharper highlight |
| water (`water.js`) | `river.colour` (glacial flour: milky blue-grey), turbidity, bar vegetation by bar age | **parameter** for colour and turbidity; bar succession goes into species_mix's riparian rows |
| animals (`animals.js`) | density and group size per setting, `HOH`-style numbers | **parameter**: the per-species numbers move from `animals.js HOH` into look.json, so a new tile needs no client edit |
| Meshy prompts (`tools/meshy_generate.py`) | coat colour and condition from in-situ photos (k-means of the animal's pixels), pose | **parameter**: a prompt template filled from the paragon and photo_stats (e.g. "Roosevelt elk cow, dark chestnut neck mane, pale tan rump, wet coat"); a texture-only pass when a model's colour misses |

## The judge stage (new, last)

| step | consumes | produces |
|---|---|---|
| poses | the settings, the photos' locations and months, the signature views in the paragon, the signature animals' eye heights | `place/poses.json`: 8-12 fixed poses per tile (each setting over 5 % of the tile, each signature feature), at a person's eye (1.6 m) and a signature animal's (an elk's 1.7 m, a squirrel's 0.1 m), the month and hour of the photos, the weather fixed to the setting's usual (overcast for the Hoh) |
| render | poses, the client | `place/renders/*.jpg` (git-ignored) through the headless viewer harness (a boot page that drives frames without a visible window and posts the canvas to a capture server). Local only; skipped (and recorded) without a dev server |
| judge | renders, photos, photo_stats, paragon | `place/score.json` and a line in `place/scores.jsonl` |

**Scoring**, per pose and per tile, 0-100:

- **Image statistics, 30 %**: against the same setting's photos: a*b* histogram overlap, lightness distribution
  distance, the moss-green and near-black shares, edge density (texture). Deterministic and free, so it can run on every
  client change.
- **Vision rubric, 40 %**: a vision model (Opus 5.5) sees one render and four reference photos of the same setting and
  scores 0-4 on structure (layers, tree size and spacing), palette and light, density (understory, deadwood, epiphytes),
  and each signature feature present or absent, then names the one trait most wrong.
- **Signature checklist, 20 %**: the share of the paragon's signature features the rubric found.
- **The blind place test, 10 %**: the render alone, "where on Earth is this, and what ecosystem?"; correct if it names the
  setting's ecological system or the region.

**Feedback.** `score.json` lists deltas per trait through each trait's `drives` list, e.g. "lightness 20 against 39:
raise canopy transmittance or exposure", "moss-green 0 % against 32 %: moss cover and colour". Numeric look parameters with
a monotone image-statistic link (grade, exposure, fog density, moss hue and cover) are tuned by a bounded search (at most 8
renders, image statistics only) and written into look.json's `tuned` block with the score that justified them; a tuned
value may never leave the trait's sourced range, so the loop cannot paint the render to match photos the paragon does not
support. Structural gaps (a signature feature missing in every pose) become hand edits in the registry report: "new
generator: hanging clubmoss; absent in 6 of 6 poses". The judge's fingerprint includes the client code's hash, so a client
change re-runs it.

## The paragon schema

Two files. The setting card (library, reused) holds what is true wherever the setting occurs; the paragon (tile) holds
this place. Each number is a trait: `{"v": typical, "range": [lo, hi], "unit": ..., "src": [ids], "conf": high|med|low,
"check": lidar|photos|literature|climate|none, "drives": [parameters]}`.

**Setting card** (`library/settings/pnw_valley_rainforest.json`, worked in full in the repo):
`id`, `name`, `region`, `match` (EVT codes, height above stream, slope, elevation), `narrative`, `structure` (canopy
heights, cover, gap fraction, large trees per ha, layer covers), `understory` (shrub, fern, herb cover; browse pressure,
browse line; species weights), `bryophytes` (cover by substrate: soil, log, rock, root, trunk base, trunk mid, limb upper,
limb lower; mat thickness; colour; green by month), `epiphytes` (by host: load, kinds, curtain length), `deadwood` (volume,
logs per ha, diameters, decay mix, nurse-log share, share of seedlings on logs, colonnades, snags), `ground` (litter mix,
materials), `light` (understory transmittance, sun flecks), `air` (rain, humidity, fog), `wet` (baseline by month),
`river` where it applies, `palette` (from photo_stats), `fauna` (densities, groups), `sources`.

**Paragon** (`tiles/utm10n_429_5293/place/paragon.json`, the Hoh in the repo): `tile`, `place`, `gestalt` (120-200 words),
`settings` (card, share, where), `signature` (features ranked by weight, each with settings, traits, photo and literature
evidence, and the generator that draws it), `views` (the signature views the judge renders), `fauna` (signature animals),
`interactions` (the links that shape the look and the games), `photos` (counts by category and setting), `check`.

## Repeatability and cost

What a new place costs on top of the four stages, per tile (prices: `tools/token_meter.py`'s rates, Opus 5.5 $4/$20 per
million in/out, Haiku 5.5 $0.10/$0.50):

| step | Claude | downloads | wall time |
|---|---|---|---|
| settings_map, structure, photo_stats, poses, look, deadwood | none | none | 2-5 min |
| sources | none | 1-5 MB | under a minute |
| photos | about $0.05 (Haiku classification of 250-1,000 thumbnails) | 20-60 MB | 5-10 min |
| paragon | $3-8 for a new biome (4-6 new setting cards), $1-2 when the settings exist | | 10-20 min |
| paragon_check | about $0.20 | | 1 min |
| interactions | none (GloBI by API, or the 2.5 GB CC0 bulk file read once and cached for every tile) | 5-20 MB by API | 2-5 min |
| render and judge | about $0.50 a pass (12 poses with Opus), image statistics free | | 5-10 min |
| tuning | image statistics only, then one judge pass: about $0.50 | | 10-20 min |
| **a new place in all** | **$5-12** | **under 100 MB** | **40-70 min** |

For comparison, the Hoh's two tiles: the unattended pipeline builds about $1.50 of Claude for both (base 28 min and 9.1 GB of
lidar for the rain forest, 22 min for Mount Olympus; flora 3 and 1 min; fauna 2-3 min each); modelling 19 new animals 120
Meshy credits and about $41 of Claude agent time; the one-off pipeline development about $79. Per-tile numbers are in
`tiles/<id>/cost.json`; the new steps write theirs there the same way.

Meshy: the gestalt pipeline itself spends no credits. It changes how prompts are written, and may ask for a texture-only
pass (about 10 credits) when a model's colour misses the place's photos.

**Cached and reused across tiles**: setting cards (`library/settings/`), the source text cache (`pipeline/_cache/place/`,
by EVT and BpS code), GloBI answers by taxon pair, photo classifications by photo id, and the photo statistics of a setting
pooled across neighbouring tiles when one tile has too few photos (Mount Olympus pools the Hoh's montane photos).

**Implementing it**, estimated from what the Hoh lanes cost:

| piece | Claude (agent time) |
|---|---|
| place stage: settings_map, structure, sources, photos, photo_stats, paragon runner and prompt, check | $40-60 |
| interactions and the games mapping | $20-30 |
| epiphytes (limb moss, hanging curtains, licorice fern) | $30-50 |
| deadwood, nurse logs, colonnades | $40-60 |
| fern habit | $15-25 |
| moss ground layer, ground colour from the palette | $15-25 |
| look.json plumbing (treegen, weather, atmosphere, litter, water, animals) | $20-30 |
| colour grade, wet sheen | $15-25 |
| judge stage: poses, headless render, statistics, rubric, scores, tuning | $30-50 |
| **total** | **$225-355**, no Meshy credits |

Order: place stage and judge first (they measure; the Hoh gets a score before any generator changes), then look plumbing,
moss ground and grade (cheap, large effect on the statistics above), then epiphytes, deadwood and ferns, then interactions.

## Candidate places for the first run

All three are in the US, so every base source reaches them (3DEP lidar checked 2026-11-05), and none is like the
foothills or the Hoh.

| | Lamar Valley, Yellowstone | Saguaro National Park West, Arizona | Greenbrier, Great Smoky Mountains |
|---|---|---|---|
| tile | `utm12n_558_4964` | `utm12n_479_3565` | `utm17n_279_3949` |
| biome | cold semi-arid steppe and sagebrush, aspen and Douglas-fir on the slopes, a braided meadow river | Sonoran Desert: saguaro forest on bajadas and rocky hills, palo verde, creosote | southern Appalachian cove hardwood and hemlock forest, rhododendron thickets, boulder streams, blue haze |
| lidar | WY_YellowstoneNP_2020 | AZ_PimaCounty_2021 | ARRA_TN_SMOKYMTNS_2011 |
| open photos | 477 iNaturalist observations, 110 Commons files | 7,299 iNaturalist (many captive: the Desert Museum), 500+ Commons | 1,218 iNaturalist, 21 Commons |
| GBIF records | 19 k | 87 k (in the first box) | 70 k |
| what it tests | the interactions and games most: wolves, elk, bison, ravens, grizzlies, carcasses; open space, snow, wide light | the generators most: a succulent archetype (saguaro, cholla, prickly pear) that does not exist; harsh light and a pale palette; nurse plants (palo verde nursing saguaros) as the desert's nurse logs | the paragon on a forest unlike the Hoh: deciduous seasons, isoprene haze, rhododendron, ghost hemlocks; about 25 new tree trait cards |
| new assets | bison, gray wolf, pronghorn, grizzly (a black bear variant): 4-6 Meshy jobs, 120-180 credits | succulent generator ($40-80), rattlesnakes need the missing spine-wave rig, desert tortoise, Gila monster, javelina: 15-25 Meshy jobs | white-tailed deer and turkey exist as variants; salamanders on the existing template; mostly trait cards |

**Recommendation: Lamar Valley first.** It is unlike both places in every pillar (open where they are closed, dry where
the Hoh is wet, snow half the year), it puts the interactions research to the hardest use (the best-documented
predator-scavenger web in North America, which is what Aaron's games want), and it reuses most archetypes (grass,
sagebrush and aspen cards exist; elk, coyote, raven, eagle, otter and bear are modelled), so its result measures the
gestalt pipeline rather than a missing generator. Its new animals fit the 330 Meshy credits left. Saguaro is the second
run, as the stress test for generators. The Smokies third.

Estimated first run on Lamar Valley, after implementation: the four stages about $1 of Claude and 1-1.5 h (lidar
streaming dominates); the gestalt steps $5-12 and about an hour; trait cards for the steppe plants it lacks, about 10 at
12 k tokens each ($2-3); bison, wolf, pronghorn and grizzly about 150 Meshy credits and $20-35 of agent time to build and
rig on existing templates; then two judge-and-tune iterations, about $2. About **$30-55 of Claude and 150 Meshy credits**.

## Open questions

1. Agent writes: should the paragon agent run in an unattended `--all` when no paragon exists (spending $3-8 without a
   prompt), or always wait for `--research`? The design defaults to the first when no paragon exists and the second once
   one does.
2. Settings granularity: five settings on the Hoh tile. Finer (separating north and south slopes) costs cards and photos
   per setting; coarser loses the valley floor's look in the slope's average. Proposed: a setting needs at least 3 % of the
   tile or a signature feature.
3. The judge's weights (30/40/20/10) are a first guess. They should be fitted once against Aaron's own ranking of 10-20
   renders.
4. Season: photos are mostly summer. Should the paragon carry per-season palettes now (the Hoh in winter is darker and
   wetter), or summer only until the photos exist?
5. People in photos: trails and boardwalks appear in most Hoh interiors. The rubric is told to ignore them; the image
   statistics mask nothing. Is a person-and-sign mask worth it?
6. Outside the US: NAIP and LANDFIRE stop the base stage today. The place stage itself is global (Commons, iNaturalist,
   GloBI, NatureServe for the Americas); the settings map needs WorldCover and the RESOLVE ecoregions to key settings.
7. Should the colour grade exist at all, or should every colour come from materials? A grade is cheap and effective, but
   can hide wrong materials; the bound to the sourced range is the guard.

## What exists now (2026-11-05)

- This design and the published page.
- The Hoh paragon prototype: `library/settings/pnw_valley_rainforest.json`, `library/settings/pnw_braided_gravel_bar.json`
  and `tiles/utm10n_429_5293/place/paragon.json`, with sources.
- The photo statistics prototype (the numbers at the top): the photo list with licences and authors in
  `tiles/utm10n_429_5293/place/photos.json`; the scripts and contact sheets are in the shared notes folder
  (`gestalt-prototype/`).
- Nothing in the step graph has changed.
