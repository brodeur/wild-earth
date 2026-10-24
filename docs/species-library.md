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
- Bark texture and normal map are drawn per species (see "Likeness fields" below) and used within the
  near distance; the mid trunks are plain vertex colour with the same mean.
- Cones and fruit are not drawn. Chamise flower and seed heads are coloured wand tips (`foliage.tips`).
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

## Likeness fields (2026-10-24)

From the photo comparison in [tree-likeness-review.md](tree-likeness-review.md). Every field is
optional and its default reproduces the tree as it was grown before, so older files are unchanged.

| field | meaning |
|---|---|
| `crown.envelope` | crown outline traced from photographs: `profile` `[[h, r], ...]` (crown radius r at height h, both fractions of tree height), `lobes` and `lobe_depth` (bulges around the crown), `asymmetry` (one heavier side), `fill` (how far a level-1 limb may grow to reach the outline, 0.3 = 30% longer), `edge` (slack for twigs past the outline). Limbs and twigs are shortened (or lengthened, up to `fill`) so their tips land on the outline, Weber and Penn's pruning. Shrub stems are fitted too (the chamise vase) |
| `trunk.split_height` | where the trunk forks, as a fraction of its length; default the bole top. Gray pine forks high |
| `trunk.sinuous_deg`, `levels[].sinuous_deg` | smooth S-bends per segment (manzanita stems) |
| `levels[].zigzag_deg` | alternating turn per segment, the growth-unit zig-zag of oak limbs and twigs |
| `trunk.stubs` | `{ count: [min, max], length_m, radius_ratio }`: short dead stubs on the clear bole (ponderosa) |
| `trunk.bark` | bark texture: `tile_m` [width, height] of one tile in metres, `plate_m` [w, h] of a plate or check, `ridge_m`/`block_m` (furrowed), `fissure` (0-1), `contrast`, `lichen` (0-1), `relief` (normal-map strength). The pattern is `bark_pattern`, now also `shreddy`; `bark_rgb` stays the mean colour |
| `deadwood` | `{ fraction, where: lower / inner / any, levels, shorten, rgb }`: grey dead branches (or shrub stems with `levels: [0]`) without foliage |
| `epiphytes.mistletoe` | `{ prob, count: [min, max], radius_m }`: evergreen balls on the outer limbs, drawn with the wood so they show in a bare crown |
| `foliage.clumps` | `{ radius_m, cards_per_clump, shell, flatten, tip_bias }`: cards gathered into clumps at twig ends with gaps between them; `shell` drops clumps from the inner crown (fraction of the crown radius). Mid cards are then one per clump, sized to its leaf area |
| `foliage.leaf_shape` | adds `oblong_wavy` (blue oak), `elliptic_glossy` (live oak), `round_vertical` (manzanita), `needle_drooping` (gray pine), `needle_brush` (ponderosa), `fascicle_wand` (chamise) |
| `foliage.palette` | `[[weight, [r, g, b]], ...]`: per-leaf tints drawn into the texture (old yellow leaves in live oak) |
| `foliage.tips` | `{ season: [r, g, b] }`: colour of flowers or seed heads at the wand tips (chamise: cream in spring, rust in summer and fall) |
| `foliage.winter_twigs` | for deciduous species, the fraction of cards that show bare zig-zag twigs (coloured `trunk.twig_rgb`) when the crown is leafless |
| `foliage.twist_deg` | needle tufts turned about their twig by up to this much, so a pine crown has volume rather than sheets |
| `foliage.ao_min` | floor of the inner-crown darkening (default 0.62); higher for pale, low-contrast crowns |
| `foliage.color_var`, `foliage.leaf_on_var` | per-plant variation from a hash of the plant's position: `[value, yellow-blue]` colour spread, and how much whole plants leaf out or drop leaves early or late |
| `lod.mid_tex_scale` | size of the mid cards' texture relative to the near card (default 2) |
| `targets` | photo-measured `crown_width_ratio`, `crown_base_ratio`, `porosity`, `foliage_rg`, `foliage_bg` and where they came from. The lineup measures each seed the same way and prints measured / target under the label (green within tolerance); `?metrics=0` turns it off |

`trunkMaterial(patch, spec)` returns the species' bark material; without `spec` it is the
shared plain material as before. `applySeason` also switches card textures (season tips,
winter twigs).


## Frame-cost fields (2026-10-25)

| field | meaning |
|---|---|
| `lod.mid_cards` | cap on far-tier cards per plant after merging interior clumps (default 40 trees, 24 shrubs); the outline keeps its lumps |
| `lod.mid_segments` | segments per branch level in the mid tier (default `[3, 1]`); mid trunks default to 4 sides |
| `lod.mid_branches` | limbs kept in the mid tier (ponderosa 2, gray pine 3, blue oak 4, live oak 2) |

Mid cards thin with distance beyond 300 m: the outer 20% always stay, inner cards fall
to a 25% floor and grow to hold cover. Bark textures draw within 120 m. The lineup can
measure any tier: `__lineupMetrics('mid' | 'close')`, and `__lineupMetrics('mid', 900)`.


## Age classes and snags (2026-10-24)

Phase 2 step 7 of [tree-likeness-review.md](tree-likeness-review.md). A woodland is not one
tree repeated: it has saplings, young trees, mature trees, a few veterans and some dead ones.
`variants` may now be a list of weighted age classes instead of a count, and `snag` adds a
dead tree. A file with `"variants": 3` is grown exactly as before.

| field | meaning |
|---|---|
| `variants` | `[{ name, weight, ... }, ...]`: age classes. Each class is the file plus the overrides below. The class marked `"base": true` (else the one named `mature`, else the heaviest) is the file as written and keeps the old seeds, so its trees, the lineup's measured seeds and every metric are unchanged |
| `variants[].height_m` | the class's height range (replaces the file's) |
| `variants[].trunk_radius` | multiplies `trunk.radius_ratio` (slender saplings, thick veterans) |
| `variants[].crown_scale` | multiplies the crown envelope's radii and the level-1 limb length (broader veterans) |
| `variants[].branches` | multiplies every level's branch `count` |
| `variants[].gnarl` | multiplies curve variance and lean of trunk and limbs, and their zig-zag |
| `variants[].leaf_density` | multiplies `foliage.density` |
| `variants[].deadwood` | a fraction (keeps the file's `deadwood` block, else inner limbs and twigs, levels 1 and 2) or a `deadwood` block merged over the file's: dead limbs without leaves inside a living crown, or grey dead shrub stems with level 0 |
| `variants[].set` | any other fields, merged over the file before the multipliers (objects merge, arrays replace, `levels` merge by index), e.g. a class's own `crown.envelope`, `trunk.bark_rgb` or `lod.near_tris_budget` |
| `variants[].seeds` | distinct trees grown for the class (default 1; mature classes use 2 so half the woodland is not one tree) |
| `variants[].note` | what the class should look like, for reviewers |
| `snag` | `{ fraction, from, height_m, limbs, twigs, levels, broken_top, shorten, rgb, set }`: a dead tree grown as class `from`, then stripped: no foliage or mistletoe, grey wood (`rgb`), branches deeper than `levels` removed except a `twigs` fraction, a `limbs` fraction of level-1 limbs kept (the rest broken to stubs or gone), every kept stem broken back to `shorten` [min, max] of its length, and for conifers the top snapped at `broken_top` [min, max] of the height with a splintered point |

Materials stay per species (leaf texture, bark texture, colours), so a class must not change
`foliage.leaf_shape`, `leaf_size_m`, `cluster_m` or the season colours; geometry and vertex
colour (bark tone, dead wood) may change freely.

**Slots.** Every plant draws one variant slot, `Math.floor(rnd() * VARIANTS)`, exactly where it
always drew its variant, so positions, species and acorn-stash ids do not move.
`VARIANTS = SLOTS = 12` (`treegen.js`), and `variantSlots(id)` hands the slots to the classes
and the snag by largest remainder in proportion to the weights, every class getting at least
one. Shares are therefore in twelfths: a 3% snag becomes 1/12 (8%). Slots of one class cycle
through its `seeds` trees. Vegetation builds one mesh set per distinct tree and points the
slots at them (`veg.meshes[id]`: distinct trees, `veg.slots[id]`: the 12 slots). The far
impostors (`impostors.js`) bake every slot from `variantSeed(id, v)` and draw the same slot per
plant, so a far tree is still its own impostor, snags included. A class tree's seed carries the
class (`(class index + 1) * 0x10000 + 1000 + 17 * copy + id length`); base-class seeds are the
old `1000 + 17 * copy + id length`.

| species | classes (share of plants, height) | snag |
|---|---|---|
| blue oak | sapling 8% (2-4 m), young 17% (5-8 m), mature 50% (file, 6-12 m), veteran 17% (10-14 m: thick, broad, gnarled, dead limbs, more mistletoe) | 8%, from veteran, 8-13 m, keeps 60% of limbs and some twigs, pale grey |
| ponderosa pine | pole 25% (8-15 m: blackjack bark, conical crown to 22% of height), mature 50% (file), old-growth 17% (30-40 m: flat top, clear bole to 62%, pale yellow plates, dead lower limbs) | 8%, from mature, top broken at 55-85%, 30% of limbs |
| gray pine | young 25% (6-12 m: single leaning leader), mature 50% (file), veteran 17% (15-24 m: forked into three, many dead limbs) | 8%, from veteran (forked), 12-20 m, top broken at 70-95% |
| interior live oak | young 25% (4-8 m, one or two stems), mature 58% (file), veteran 17% (11-16 m: two to four heavy stems, some dead limbs) | none (resprouts) |
| whiteleaf manzanita | young 25% (0.7-1.5 m), mature 50% (file), decadent 25% (2-3.5 m: grey dead stems among the red) | none |
| chamise | young 25% (0.6-1.3 m, dense), mature 50% (file), decadent 25% (1.5-2.6 m: half the stems grey) | none |

A snag's canopy holds six zero-size cards along its upper trunk, so its canopy geometry is never
empty: the shadow proxy built from the mid canopy bounds is then a slim spire, not a crown, and
the impostor bake gets a cap height. The near trunk (limbs included) casts the real snag
shadow.

**Lineup.** "all variants" (`?classes=1`) shows one tree per class plus the snag for every
species, labelled with the class, the tree's height, the class range and its share of plants.
The measured layout (three base-class seeds) is unchanged and its metrics are identical.

**Cost** (start view, same pose, A/B against the previous commit): frame rate unchanged (51 fps
both, GPU-bound on the test machine), 169 draw calls instead of 130, triangles 5.8 M instead of
6.1 M (saplings and young trees are smaller), render CPU 0.92 ms instead of 0.85 ms. 28 distinct
trees instead of 18. The impostor atlas holds 72 slots instead of 18: 60 MB with mips instead of
15 MB, and the bake takes about 1.3 s instead of 0.4 s at load.

**Known limits.**
- Shares are twelfths, so the rarest classes are over-represented (snags 8% instead of 3-5%).
  More slots cost atlas memory and bake time linearly (20 slots: 100 MB, about 2.2 s).
- Far impostors beyond about 1.75 km rescale every tree's height into the species' `height_m`
  (the base class's range), so a sapling slot there is stretched taller and a snag gets a
  living tree's height. At that range a tree is a few pixels.
- Acorn-stash holes sit on whichever class the oak is: on a sapling they are low (under 0.5 m)
  on a 3 cm stem, and a snag can hold a stash (acorn woodpeckers do use dead oaks).
