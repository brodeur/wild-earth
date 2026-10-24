# Species library

Plants are grown, not stored (decision log, 2026-10-23). Each plant species is one
parameter file, `library/species/<id>.json`, written from the species' morphology. The
client grows every tree and shrub from it with a generator in the spirit of Weber and
Penn (1995), *Creation and Rendering of Realistic Trees*. A species written once is
available in every region that has it: this folder is the start of the shared,
community-built species library the [brief](brief.md) calls for. Tiles reference
species by id and never carry plant geometry (see [tile-spec.md](tile-spec.md),
"Species library").

Files: `library/species/index.json` lists the species; one `<id>.json` per species;
`library/embed_builtin.py` copies them into the client as an offline fallback.
Generator: `client/src/treegen.js` (`client/src/trees.js` keeps the older interface).
Review page: `client/lineup.html`.

![Lineup, summer](lineup-summer.jpg)
![Lineup, winter: blue oak bare](lineup-winter.jpg)

## Licence

Species parameter files are **CC BY-SA 4.0**. Every file says so in `license`. Credit
contributors in `authors`. Sources you read go in `sources`; record facts and your
reasoning in your own words in `notes`, and never paste text from a source.

## How a tree is grown

1. **Skeleton.** A trunk (level 0, or several stems for shrubs) with a straight bole,
   then curved segments. Branch levels follow: level 1 on the trunk, level 2 on level
   1, and so on. Each level sets how many branches there are, where they sit, their
   angles, length, curvature and taper. Lengths on the trunk follow a crown shape.
   Height is drawn from `height_m` per seed, and the whole tree is scaled so its top
   is exactly at that height.
2. **Foliage.** Leaf cards (two-sided quads with a leaf-spray or needle-tuft texture
   drawn on a canvas for the species) along the outer branches: the deepest level
   from `foliage.start` out, plus the tips of the level above.
3. **Two meshings of the same skeleton**, so the level-of-detail switch changes detail
   and not shape:
   - *near* (within 180 m of the camera): tubes for the trunk and branches, plus leaf
     cards. About 800-2,000 triangles.
   - *mid* (180 m to 1.5 km): trunk and the main limbs as tubes, foliage as a few
     lumpy ellipsoids fitted to the cards by k-means. About 230-390 triangles.
   - Beyond the vegetation radius, the per-cell impostors take over (`impostors.js`).
4. **Season.** The summer colour is baked into the vertex colours. Each season tints
   the species' material by `colors[season] / colors.summer` and drops leaf cards
   above `leaf_on[season]` (each card has a fixed random rank), so a deciduous crown
   thins out and then empties instead of fading.

Placement is not in the file. Habitat class and canopy cover per 30 m cell decide how
many plants a cell holds, and the species mix per habitat decides which
(`client/src/vegetation.js`; later the tile's own mix). Each plant is one of
`variants` seeds, scaled 0.75-1.25 and rotated by a seed from the cell's coordinates.

## Schema

Units: metres and degrees. Colours are sRGB 0-255. Fields left out take the
defaults in `treegen.js` (`DEFAULTS`).

| field | meaning |
|---|---|
| `id` | lowercase scientific name with underscores, e.g. `quercus_douglasii`; the same code tiles use in `species.json` |
| `aliases` | older or short ids that resolve to this species (`blue_oak`) |
| `scientific`, `common` | names as shown on the lineup page |
| `form` | `tree` or `shrub`. For shrubs, `levels[0].count` is per stem and all stems spread |
| `architectural_model` | the Hallé-Oldeman-Tomlinson model, e.g. `Rauh` (oaks, pines), `Leeuwenberg` (manzanita), with "(provisional)" if unsure. Documentation for reviewers; the generator does not read it |
| `deciduous` | true if the crown empties in some season (default: `leaf_on.winter < 0.5`) |
| `height_m` | `[min, max]` mature height in this region |
| `variants` | how many seeds the client builds per species (3) |
| `notes`, `sources`, `authors`, `license` | morphology and reasoning, references, contributors, `"CC BY-SA 4.0"` |

`trunk`:

| field | meaning |
|---|---|
| `length_ratio` | trunk (leader) length / tree height before the final fit. About 1 for pines (excurrent: the leader runs to the top), about 0.5 for oaks (decurrent: it dissolves into limbs) |
| `radius_ratio` | dbh / height |
| `taper` | 0 = cylinder, 1 = cone to a point at the trunk tip |
| `flare` | base radius multiplier (root flare), in the first 0.35 m |
| `bole_ratio` | straight, clear bole as a fraction of trunk length; also where a split happens. The acorn game puts stash holes on it |
| `base_size` | fraction of the trunk bare of level-1 branches (Weber and Penn's BaseSize) |
| `curve_deg`, `curve_var_deg`, `segments` | total bend above the bole, random bend per segment, segments above the bole |
| `lean_deg` | maximum lean of the whole tree |
| `tropism` | per-segment pull toward vertical (optional) |
| `stems` | `[min, max]` stems from the base (multi-trunk trees, shrubs) |
| `stem_spread_deg` | tilt of the extra stems (all stems for shrubs) |
| `split_prob`, `split_count`, `split_angle_deg` | chance the trunk forks at the bole top, into how many leaders, at what angle |
| `bark_rgb`, `twig_rgb` | trunk colour; colour the branches blend to by level |
| `bark_pattern` | `smooth`, `checkered`, `furrowed` or `plates` (vertex-colour pattern on the trunk) |

`crown.shape`: Weber and Penn's shapes for level-1 length along the trunk:
`conical`, `spherical`, `hemispherical`, `cylindrical`, `tapered_cylindrical`,
`flame`, `inverse_conical`, `tend_flame`.

`levels[]`, one object per branch level (two is typical; three is supported):

| field | meaning |
|---|---|
| `count` | level 1: branches per tree (per stem for shrubs). Deeper levels: branches per parent, scaled by the parent's length |
| `whorl` | level 1: branches per whorl (conifers); 0 = spiral |
| `start` | deeper levels: fraction of the parent where branching starts (default 0.15) |
| `down_angle_deg`, `down_angle_var_deg` | angle from the parent; 90 is perpendicular, over 90 droops |
| `down_angle_tip_deg` | optional: the down angle at the top of the trunk (level 1) or the tip of the parent, interpolated |
| `rotation_deg`, `rotation_var_deg` | angle around the parent between successive branches (140 is a spiral); negative alternates left and right by that much, which gives flat sprays |
| `length_ratio`, `length_var` | level 1: times trunk length times crown shape. Deeper: times (parent - 0.6 x offset) |
| `curve_deg`, `curve_var_deg` | bend along the branch, random part |
| `tropism` | per-segment pull up (positive: upswept tips) or down (negative: weeping) |
| `taper`, `radius_ratio` | taper along the branch; base radius / parent radius at the fork |
| `segments` | tube segments at near LOD |

`foliage`:

| field | meaning |
|---|---|
| `type` | `broadleaf`, `needle` or `scale` |
| `leaf_size_m` | one leaf (or needle length); sets the scale of the drawn spray |
| `leaf_shape` | `oval`, `lobed`, `lanceolate` (leaf sprays), `needle_cluster` (tufts at twig ends), `needle_fascicle` (tiny bundled leaves, chamise) |
| `cluster_m` | size of one leaf card, which is a spray of many leaves, not one leaf |
| `density` | cards per metre of bearing branch (capped by `lod.near_tris_budget`) |
| `start`, `parent_start` | where foliage starts on the deepest level, and on the level above (default 0.75: tips only) |
| `orientation` | `outward` (from the crown centre, randomised), `vertical` (held edge-on, manzanita) or `along` (cards contain the twig: needle tufts) |
| `droop` | 0-1, needles hang (gray pine) |
| `crossed` | true adds a second card at right angles (more volume, twice the triangles) |
| `colors` | `{winter, spring, summer, fall}` sRGB; summer is baked, the rest are tints |
| `leaf_on` | `{winter, spring, summer, fall}` 0-1, fraction of cards present |

`lod`:

| field | meaning |
|---|---|
| `near_tris_budget` | target triangles for the near tree; wood first, cards fill the rest (the console warns if wood alone takes over 70%) |
| `near_sides` | tube sides per level at near, e.g. `[7, 5, 3]`; 0 skips the level's geometry (its foliage stays) |
| `mid_blobs` | ellipsoids at mid |
| `mid_branches` | how many level-1 limbs are drawn at mid (longest first) |
| `mid_sides` | tube sides for trunk and limbs at mid (default `[6, 3]`, shrubs `[4, 3]`) |
| `mid_blob_scale` | below 1 shrinks the blobs for open, see-through crowns (gray pine and ponderosa 0.7) |
| `mid_canopy` | `blobs` (default) or `cards`: the mid canopy as about `mid_cards` (60) of the near cards, enlarged to keep the leaf area. See "Known limits" |
| `mid_cards` | cards kept in `cards` mode |

## Writing a species

1. Copy the closest existing file and rename it to the new `id`. Add the id to
   `index.json`.
2. Read species accounts. FEIS (USDA Fire Effects Information System), Jepson eFlora,
   Calflora, USDA PLANTS and Silvics of North America are good for habit, height, dbh,
   bark, leaves and phenology. Look at many photographs of mature trees in the region.
3. Work from the large shape down:
   - height range and dbh (`radius_ratio` = dbh / height);
   - excurrent or decurrent (`trunk.length_ratio`), clear bole, forking, lean, crookedness;
   - crown shape and level-1 angles, length and count;
   - twigs (level 2);
   - foliage size, shape, density and colour by season, and leaf-on by season.
4. Write `notes`: the morphology you used and why each unusual number is what it is
   (e.g. "drought-deciduous, so leaf_on.fall 0.6"). Name the architectural model, and
   mark it provisional if you are not sure.
5. Run `python3 library/embed_builtin.py`, open `client/lineup.html` (dev server:
   `.venv/bin/python server.py`), and iterate.

## Review

A species is accepted when:

1. **Lineup.** On `client/lineup.html`, all three seeds read as the species at a
   glance next to the others and against the 5 m poles; the near and mid LODs match
   in silhouette, density and colour (toggle "mid LOD"); and every season looks right
   (deciduous species bare in winter). The triangle counts on the labels are within
   budget. The page warns if the built-in copy is stale.
2. **In the world.** A low pass at 20 m and a pass at about 150 m over a tile where
   the species grows, in at least two seasons.
3. **Local knowledge sign-off.** Someone who knows the species where it grows (a local
   naturalist, forester, tribal land steward or long-time resident) compares the
   lineup with the trees they know and signs off by adding themselves to `authors`
   with "reviewed" and the date, or flags what is wrong in `notes`. Until then the
   file says "needs local sign-off". The six starter species are agent drafts and are
   all waiting for this.

Reference photographs belong in the review conversation, not in the library.
Link to them; do not copy them into the repository.

## Starter species (Sierra foothills, 2026-10-23)

| id | alias | model | near / mid triangles |
|---|---|---|---|
| `quercus_douglasii` (blue oak) | `blue_oak` | Rauh | 1,354-1,784 / 348 |
| `quercus_wislizeni` (interior live oak) | `live_oak` | Rauh | 2,000 / 360-408 |
| `pinus_sabiniana` (gray pine) | `gray_pine` | Rauh | 1,400 / 348-408 |
| `pinus_ponderosa` (ponderosa pine) | `ponderosa` | Rauh | 2,000 / 348 |
| `arctostaphylos_viscida` (whiteleaf manzanita) | `manzanita` | Leeuwenberg | 982-1,000 / 280-296 |
| `adenostoma_fasciculatum` (chamise) | `chamise` | Leeuwenberg (provisional) | 702-900 / 228-240 |

Counts are per seed (the three variants), with blobs at mid. In `cards` mode the mid
counts are 204-290.

## Known limits

- Leaf cards are sprays, not single leaves: close up (under about 5 m) the spray
  texture is visible, and the alpha-tested edges alias.
- Bark is vertex colour on 5-8 sided tubes; there is no bark texture or normal map yet.
- Cones, flowers and fruit are colour shifts at most.
- No wind yet. The skeleton has what wind needs (per-level stems), but nothing animates it.
- Mid-LOD blobs are axis-aligned and lumpy. From 180 m to about 400 m they read as
  clumps of balls, denser and smoother than the near crowns, so the switch at 180 m
  shows as a change in texture even with the dithered cross-fade (±15 m). The
  `cards` mode (`lod.mid_canopy: "cards"`, or `?mid_canopy=cards` on the client URL
  to preview it for all species) hides the switch almost completely and draws fewer
  triangles, but alpha-tested cards cost fill rate: about 50 fps against about 60 at
  the start view on the development Mac (2026-10-23).
- Chaparral cover is sparse: the shrub count per cell was tuned for the old blob
  shrubs and gives about 6% cover where the data says 50-60%. Closing it needs either
  many more instances or a shrub-field layer, not a parameter change.


## Far foliage

Beyond the near distance the generator draws either ellipsoid blobs or about sixty
enlarged leaf cards (`lod.mid_canopy`: `blobs` or `cards`). The default is `cards`:
in side-by-side review (2026-10-24) blobs made the far forest read as a crowd of green
balls while cards kept it continuous, at a cost of roughly ten frames per second on a
laptop. A species file may set `blobs` to buy that back.


## Fields added 2026-10-24

| field | meaning |
|---|---|
| `description` | two sentences for the species card: appearance, where it grows here, one ecological note |
| `season_notes` | one line per season (winter, spring, summer, fall) shown on the card |
| `status` | `agent draft, needs local sign-off` until a resident signs the file off |
| `levels[].droop_deg`, `levels[].upturn_deg` | downward arch of a branch level and the upturn of its tips (ponderosa limbs) |
| `lod.close_factor`, `lod.close_scale` | close tier (within ~70 m): multiplier on leaf-card count and card size relative to the near tier |

## How a tree is grown, addendum

Three tiers now: close (within ~70 m, 3-3.5x the leaf cards at 0.6x size with a leaf
texture drawn at true leaf size, alpha-to-coverage edges), near (to ~240 m) and mid
(beyond, cards or blobs). Tiers hand over with a complementary screen-space dither so
no tree pops. The close tier is empty at altitude and costs nothing there.

## In the client

`client/src/identify.js`: the HUD names the nearest tree and counts species within
100 m four times a second; a click on a tree (not a drag) opens the species card built
from the file; T toggles name tags over one tree in ten within 160 m.
