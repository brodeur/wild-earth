# The held-out judge

Recommendation 3 of `pipeline-review-2026-11-10.md`. Until 2026-11-10 the only judge was `tools/probes/run.sh`: colour
from straight above against the imagery the ground is made from. It could not see a wrong species, a missing
understory or an empty river. The checks here compare a built tile with sources **the pipeline never reads**, so a
wrong tile scores badly.

Two rules keep it fair:

- **Held out means held out.** A source the pipeline uses as input cannot judge it. Each check says which is which.
- **No tuning to pass.** The rules are fixed in the modules' docstrings. A change is allowed when the comparison
  itself is wrong (a naming difference, a like-for-like error), never because a tile scores badly.

## Run it

```bash
arch -arm64 .venv/bin/python -I tools/probes/held_out.py utm12n_396_3988            # all checks on one tile
arch -arm64 .venv/bin/python -I tools/probes/held_out.py --checks species,composition   # every tile with a reference, no browser
arch -arm64 .venv/bin/python -I tools/probes/held_out.py --table                    # baseline beside now
```

- Results: `tiles/<tile>/judge/held_out.json`. Keys per check: `held_out`, `status`, `source`, `licence`, `fetched`,
  `scores`, `errors`, `limits`. `summary` holds the headline numbers.
- `--baseline` keeps the run as `judge/held_out_baseline.json` when none exists; `--rebaseline` overwrites it.
- `--offline` skips the GBIF synonym lookups and the park-boundary query. `--refresh` fetches the references again.
- Which park and which vegetation source judge a tile: `tools/probes/parks.json`. A tile with no entry reports
  `no reference`.
- Downloads go to git-ignored caches (`pipeline/_cache/judge/` per park, `tiles/<tile>/_cache/judge/` per tile), each
  into its own directory, read as data and never executed. Nothing fetched for judging is shipped to clients.

## The checks

| Check | Against | Held out? | Needs a browser |
|---|---|---|---|
| `species_lists` | The park's NPSpecies checklist | Yes | No |
| `composition` | Field plots, or maps that name dominants | Yes | No |
| `eye_level` | Openly licensed geotagged ground photos | Yes | Yes |
| `structure` | GEDI lidar footprints | Deferred | No |
| `colour_from_above` | Sentinel-2, the imagery family the ground is made from | **No** | Yes |

### 1. Species lists (`tools/probes/checklist.py`)

- **Reference.** NPSpecies, the National Park Service's vetted list per park: name and synonyms, occurrence,
  nativeness, abundance. Public domain, open REST service, no key.
- **Drawn.** Animals with `listed` in `species/animals.json` (marked `spawned` when the client has a slot for them).
  Plants with a share above zero in `client/species_mix.json`.
- **Scored against the rewilding baseline** (`brief.md`, 2026-11-10: today's ecosystems, introduced species out,
  natives that people removed restored and marked).
  - A drawn species the list has as present and native is a hit.
  - A drawn species the list marks non-native is an error, named (`non_native`; `summary.introduced_drawn` counts
    them).
  - A drawn native the list tags Historical, gone from the park, is a hit, listed under `restored_drawn`. The tile
    should mark it restored; the pipeline has no such field yet.
  - A Historical native the tile lacks is a gap, named `restorable_absent`, apart from the ordinary misses
    (`summary.restorable_absent` by group).
- **Scores.**
  - Precision per group: hits over the drawn species the list decides
    on. A record with no occurrence yet, or of unknown origin, is counted as undecided and left out. For plants also
    by share of the plants drawn in each layer.
  - Recall per group: the list's present, native, Abundant or Common species (vagrants left out) that the tile lists.
    Counted by species, so a park's subspecies records are one species to find. Plants carry no abundance on the
    list, so their recall is the composition check's job.
- **Named errors.** `not_on_list`, `non_native`, `not_present` (unconfirmed, a false report, not in the park),
  `expected_absent`, `restorable_absent`, `group_absent` (fish).
- **What it can show.** Precision is sound for a tile inside the park: a species the whole park lacks is wrong there.
- **What it cannot.** A park is far larger than a 10 km tile, so recall is an upper bound on what is missing. A
  species common in the park may live in a habitat the tile lacks. `expected_absent` names candidates; only a whole
  missing group is certain. Invertebrates are not judged.
- **The restoration gaps are a lower bound.** The Historical tag does not say why a species is gone, and a park
  list holds only the losses someone recorded: Grand Canyon's has four fish and no wolf, grizzly or jaguar. A range
  source of the world without people (PHYLACINE, reserved as a pipeline input) would give the rest.
- **Names.** Matching is by binomial and the list's synonyms, then a short table of published splits and lumps
  (`SPLITS`), then the epithet within the same family, then GBIF's synonyms. An animal reported `not_on_list` with
  `genus_on_list` true deserves a look for a taxonomic change before it is believed.

### 2. Composition (`tools/probes/composition.py`)

- **Drawn.** Each species' share of the plants drawn per layer (canopy, shrub, ground): cells x density x weight
  over the rows of `client/species_mix.json`.
- **Reference, kind `plots`** (Grand Canyon, Yosemite). The NPS Vegetation Mapping Inventory's classification plots
  inside the tile: percent cover of every species by stratum, measured in the field. CC0.
- **Reference, kind `mapped_dominants`** (Lamar). Yellowstone has no plot package, so: the canopy from the cover-type
  map, the shrubs and ground from the habitat-type map, by the area on which a species is named. Coarser, and no
  foreign share is scored against it.
- **Scores per layer, on genus shares.** Bray-Curtis dissimilarity (0 the same, 1 nothing in common). Foreign share:
  the drawn share in genera the plots never record on this ground. Missed share: the reference's share in genera not
  drawn. An empty layer where the reference has plants scores 1.
- **Limits.**
  - Plots sit in stands chosen as typical of a type, not at random, and a tile holds 12 to 14 of them. Rare types
    such as river banks are over-counted.
  - Drawn shares count plants; the reference is cover.
  - Genus level is lenient: gray pine in place of Colorado pinyon is the right genus. The species-list check's plant
    precision by share catches that.
  - Read the numbers as a ranking of what is most wrong.
- **Reserved, not used here.** TreeMap, FIA BIGMAP, RCMAP and the National Wetlands Inventory are candidate pipeline
  inputs (review, recommendation 5). The judge keeps to NPS plots and maps so that it stays independent when those
  arrive.
- **A better reference.** Weight the plots by the area of their vegetation type. The inventory's accuracy-assessment
  points are a designed sample of types (28 in the Grand Canyon tile, 69 in Yosemite's), but their map-unit codes do
  not join to the plots' association codes without a crosswalk.

### 3. Eye level (`eye_photos.py`, `eye_capture.mjs`, `eye_level.py`)

```bash
arch -arm64 .venv/bin/python -I tools/probes/eye_photos.py <tile>          # find, filter, fetch, select photos
python3 tools/probes/receiver.py 8793 tiles/<tile>/_cache/judge/renders &   # the capture receiver
node tools/probes/eye_capture.mjs 9333 http://localhost:<viewer port> <tile> 8793
arch -arm64 .venv/bin/python -I tools/probes/held_out.py <tile> --checks eye
```

- **Photos.** Wikimedia Commons and iNaturalist, CC0, public domain, CC BY or CC BY-SA only, chosen by rule and blind
  to the game. Author, licence and page of each are in `tiles/<tile>/judge/eye_photos.json`; the images stay in the
  cache.
- **Renders.** The viewer at the photo's point, 1.6 m up, the photo's month when known, clear sky, toward the
  photo's heading, in a tall 75-degree frame. A photo's tilt is never recorded, so a 45-degree window is cut from the
  frame at the height whose skyline fits the photo. With no heading, eight bearings are rendered and the bearing is
  fitted the same way. The skyline is terrain, not the colours being judged.
- **Unplaced photos.** A photo with no sky and no heading cannot be placed. It is shown on the sheet and left out of
  the scores.
- **Measure.** Three bands per image; per pair the difference in sky share, in the green share of the land, and in
  the land's mean colour (delta E). `distance` is their mean, 0 to 1.
- **Honest limits.** Colour and cover statistics only: no species, shape or texture. Season, weather, hour, exposure,
  the photo's unknown lens and tilt, and GPS error all move the number. **The sheets are the deliverable**
  (`tiles/<tile>/judge/eye_level_sheet_<n>.jpg`, git-ignored): a person judges them.
- **A better measure** needs the photo's lens and tilt, photos by month, and a learned comparison (both images
  segmented into sky, rock, bare ground, grass, shrub and tree) checked against people's rankings of the sheets.

### 4. Structure against GEDI: deferred

GEDI needs a NASA Earthdata login that only Aaron can make. What it takes is recorded in every result under
`checks.structure.needs`:

- An Earthdata account and its token in the git-ignored `.env`.
- GEDI L2A (canopy height) and L2B (cover, vertical profile) footprints over the tile, and `h5py` in the venv.
- Per 25 m footprint: the height and cover the tile draws against the footprint's, as bias, RMSE and rank correlation.
- GEDI is held out only where the canopy is not built from it. The satellite canopy-height maps used on the six
  tiles without lidar were trained on GEDI. It covers 51.6 N to 51.6 S, so not Lofoten.
- With no account: hold out part of the 3DEP point cloud on US tiles and judge the DEM-only build against it.

### Colour from above: kept, labelled

`tools/probes/run.sh` is unchanged. Pass its `satellite_stats.json` with `--colour` and the overlap is copied into
`checks.colour_from_above` with `held_out: false` and the reason.

## Sources and licences

| Source | Used for | Licence | Pipeline input? |
|---|---|---|---|
| NPSpecies (NPS IRMA) | Species lists | Public domain (US Government work) | No |
| NPS Vegetation Mapping Inventory plots, open-format packages 2314567 (Grand Canyon), 2312926 (Yosemite) | Composition | CC0 1.0 | No |
| Yellowstone cover types (1045508) and habitat types (1045618), NPS DataStore | Composition at Lamar | Public domain (NPS work; the record has no licence field, constraints "None") | No |
| NPS park boundaries (Land Resources Division service) | The tile's share inside the park | Public domain | No |
| GBIF backbone (species match and synonyms) | Name thesaurus only | CC0 | GBIF occurrences are; the backbone's names decide nothing here |
| Wikimedia Commons, iNaturalist photos | Eye level | Per photo: CC0, public domain, CC BY, CC BY-SA | No (the model step uses other photos, of animals) |
| Copernicus Sentinel-2 | Colour from above | Copernicus open | **Yes** |

## Baseline, 2026-11-10

Main at `defcb5f`, before the stand-ins lane. Kept in each tile's `judge/held_out_baseline.json`; the table and the
worst named errors are in `decisions.md` (2026-11-10, the wider judge).
