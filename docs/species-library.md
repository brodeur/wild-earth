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
| `form` | `tree`, `shrub` or `multi_stem_shrub_tree` (grown like a shrub, drawn as a tree; see "Generator features for the foothill set"). For shrubs, `levels[0].count` is per stem and all stems spread |
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
| `bark_pattern` | `smooth`, `checkered`, `furrowed`, `plates`, `shreddy`, and (2026-10-25) `peeling_red`, `smooth_grey`, `fibrous`, `platy` (vertex-colour pattern on the trunk and the bark texture) |

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
| `leaf_on` | `{winter, spring, summer, fall}` 0-1, fraction of cards present; `leaf_on_by_month` (12 values) replaces it when present |

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


## Foliage by crown size (2026-10-24)

Review found that the bigger a tree, the sparser it looked. The old rule (cards per metre of bearing
stem, capped by `lod.near_tris_budget`) gave every tree of a species about the same number of cards,
because nearly every tree hit the budget cap. A veteran spread a sapling's cards over a crown four times
larger, and the mid tier's fixed card cap made it worse. Foliage is now set per square metre of crown.

- **Crown area.** Each tree's crown envelope (`crown.envelope`, after its class's `crown_scale` and the
  height fit) is integrated into a surface area: the lobed surface of revolution plus the disc under
  the crown base.
- **Density.** `foliage.cards_per_m2` sets cards per m² of envelope. Without it, the species' reference
  tree (base class, first seed: the lineup's first measured tree) keeps the card count the old rule
  gave it, and that count over its area is the density. Either way the reference tree stays within
  `lod.near_tris_budget`. A class's `leaf_density` (or its own `foliage.density`) scales the density.
- **Count.** Cards = density × area / s², where s is the card size factor (area ratio)^0.25, clamped
  0.9 to 1.4, so big crowns get somewhat larger cards and the count grows more slowly than the area.
  The card cap is the reference tree's count times 1.5 × the area ratio, clamped 0.15 to 2.5.
  `lod.near_tris_budget` is therefore the reference tree's budget, and a class's own
  `lod.near_tris_budget` is no longer read (live oak's veteran still sets one; it has no effect).
- **Mid tier.** The mid card cap is `lod.mid_cards` times the crown diameter ratio (square root of the
  area ratio), clamped 0.4 to 2.2 (0.7 to 2.2 for shrubs). The far thinning is unchanged.
- `buildTree(...)` also returns `crown: { area_m2, cards_per_m2, card_scale, mid_cap }` for
  inspection. The lineup's `__lineupMetrics('near', 0, 'classes')` measures one tree per class, and
  `__lineupSeeds(id)` gives the metrics of each measured seed.

Gaps (lineup porosity, near tier), smallest to largest class, before and after:

| species | before | after |
|---|---|---|
| ponderosa (pole, mature, old-growth) | 0.39, 0.45, 0.52 | 0.27, 0.35, 0.34 |
| gray pine (young, mature, veteran) | 0.21, 0.28, 0.51 | 0.39, 0.32, 0.40 |
| interior live oak (young, mature, veteran) | 0.06, 0.25, 0.42 | 0.24, 0.25, 0.37 |
| blue oak (sapling, young, mature, veteran) | 0.10, 0.21, 0.27, 0.50 | 0.21, 0.19, 0.24, 0.28 |
| whiteleaf manzanita (young, mature, decadent) | 0.02, 0.37, 0.56 | 0.30, 0.37, 0.42 |
| chamise (young, mature, decadent) | 0.11, 0.34, 0.62 | 0.30, 0.34, 0.51 |

Decadent shrubs and veterans stay a little more open on purpose: they carry dead stems and limbs.
Cost, measured at the start view (same pose, back to back against HEAD): near-set foliage 671,630
triangles against 627,162 (+7%, 637 plants), mid canopies 1.73 M against 1.78 M, all triangles
5.25 M against 5.27 M, and the frame rate the same within noise (two A/B pairs: 82.8/79.0 against
78.8/74.4 fps, then 62.8/64.7 against 66.6/65.1).

## Pine needles (2026-10-24)

Review comment: "Pines seem to have leaves rather than needles." The two pines' cards were large sprays
with many tufts drawn on them. From 20 m they read as flat dark sheets (ponderosa) or leafy clumps
(gray pine), because box-filtered mips turn a one-texel needle into dots and a tuft into a solid lobe.

- **Textures** (`leaf_shape` `needle_brush`, `needle_drooping`; `drawNeedleCard` in `treegen.js`).
  Each card is a branch end seen side-on: a twig from the card's lower edge and a few shoots, each
  carrying needle bundles (fascicles of three). Every needle is projected from 3D (an angle from the
  shoot and an azimuth around it), drawn as a thin five-piece arc, and shaded from a darker base to a
  lighter tip (`foliage.needle_tip`, an RGB multiplier).
  - `needle_brush` (ponderosa): 3-6 upturned shoots side by side, each a bottle-brush of stiff needles
    along its last 1-2 needle lengths, curving forward.
  - `needle_drooping` (gray pine): longer, sparser shoots, each ending in a loose tuft of very long
    needles that arch over and hang (`foliage.droop`).
  - The mid tier's texture (whole-clump cards) is a few large bursts of thick needles whose outer
    needles point out of the clump: round pom-poms for ponderosa, weeping bursts for gray pine.
- **Mips that keep the needles.** Every level down to 16×16 is drawn again from the same needles, at
  least one texel wide. A fixed random subset of needles is left out so that the level's alpha-test
  coverage matches level 0 (up to four passes), and the level's colour is rescaled to level 0's mean
  brightness. A far crown keeps lines rather than lobes, and neither washes out, fills in nor darkens.
  The smallest levels are box-filtered as before. The impostor bake uses the same textures and cards.
- **Cards.** `foliage.needle_planes` (2) crossed planes through the tuft's axis, so the needles read as
  radiating lines from any side. The card's base sits on the branch (`foliage.tuft_base`, default 0.42
  of the card along the axis). The axis fans out by up to `foliage.tuft_spread_deg` and turns up toward
  vertical by `foliage.tuft_up` (0-1). Mid cards use `lod.mid_planes` planes (1 for both pines: a
  second plane doubled the alpha-tested fill of the far forest), centred on their clump.
- **Placement.** Ponderosa foliage is on the outer part of each limb (level-2 `start` 0.5,
  `parent_start` 0.6) in clumps of two cards, so the crown is open inside. Gray pine is sparse
  (`cards_per_m2` 0.83). Ponderosa limbs went from 4 to 3 segments to give the foliage the triangles.

Lineup (mean of the three measured seeds, near tier; target in brackets):

| species | W/H | crown base | gaps | r/g | b/g |
|---|---|---|---|---|---|
| ponderosa | 0.42 → 0.45 (0.40) | 0.46 → 0.45 (0.45) | 0.56 → 0.35 (0.35) | 0.86 → 0.91 (0.95) | 0.45 → 0.48 (0.47) |
| gray pine | 0.55 → 0.57 (0.65) | 0.42 → 0.42 (0.30) | 0.43 → 0.37 (0.40) | 0.89 → 0.89 (0.88) | 0.79 → 0.78 (0.82) |
| blue oak | 1.43 → 1.47 (1.40) | 0.20 → 0.19 (0.15) | 0.27 → 0.21 (0.20) | 0.86 → 0.85 (0.90) | 0.74 → 0.74 (0.78) |

The mid tier now follows the near tier: mid gaps went from 0.56 to 0.41 (ponderosa), 0.49 to 0.36 (gray
pine) and 0.39 to 0.23 (blue oak). Gray pine's narrow W/H and high crown base were already off before
this change; they come from the skeleton, not the foliage.

**Blue oak** (same review: "the canopy is very sparse, seems like eucalyptus"): smaller cards
(`cluster_m` 1.1 → 0.95) with denser sprays (`foliage.leaf_fill`, a multiplier on the scattered leaves,
3.2), a thinner empty shell (0.45 → 0.2), sprays rolled at random in their own plane
(`foliage.roll_deg` 90, default 40) so they do not all hang along drooping twigs, `cards_per_m2` 1.6
(capped by the near budget), and leaf-on 1.0 in summer and 0.85 in fall.

**Known limits.**
- Under about 3 m a pine card is magnified: 256 texels over a 1.1 m close-tier card make needles look
  like broad soft streaks. A 512 close-tier texture with thinner lines would fix it.
- Ponderosa at 20-60 m in low sun still shows some rounded lobes at the crown edge (a dense brush
  minifies to a disc with a fringe), and a backlit crown is very dark. Light passing through the
  needles (`translucency` in the review) is the missing piece.
- Ponderosa colour is a compromise: the photo ratio (r/g 0.95) renders khaki under the warm morning
  sun, so it sits at 0.91.

## Needle light (2026-10-24)

Review after the pine needle pass: sunlit ponderosa between 20 and 60 m "still partly reads as rounded
lobes", backlit crowns are very dark, and gray pine against the sun is darker than the photos. Each card
was lit as one flat leaf with the crown-shaped normal, so a tuft was either fully lit or black; a card's
five or six overlapping brushes made one palmate outline; and every needle edge was darkened by
filtering.

- **Aux texture** (`needleTexture`, `texture.userData.aux`). Every level of a pine card is drawn a
  second time with the same strokes: rgb is each needle's shading normal in the card's frame (its
  outward direction from the shoot, bent 0.6 toward the needle's own direction, so the needles on the
  sunward side of a tuft face the light and those under and behind it do not; hanging gray pine
  needles face more down), alpha is how thin the foliage is around the texel (1 - local cover over
  about 2 cm of a near card). Its mips come from the same draws as the colour mips, so per-needle
  variety survives to the 32 and 16 texel levels that a tuft uses at 30-60 m.
- **Colour bleed.** Canvas leaves empty texels black, and bilinear filtering pulled that black into
  every needle edge: on the small levels, where a needle is one texel wide, most of a needle's
  fragments sample its edge and came out as dark as half its colour. Empty texels now take their covered neighbours' colour (three rings, then the
  mean). Alpha and the alpha-test cover are unchanged. The impostor bake reads the same texture, so it
  gets the same colour; no bake change was needed.
- **Lighting** (`canopyMaterial`, only for cards with an aux texture: the two pines; chamise's
  `fascicle_wand` cards and all broadleaf species are unchanged). The card's frame comes from the
  screen-space derivatives of position and uv (no new attributes, no extra draw calls). Per species:
  - `foliage.needle_normal` (0.55): how much of the needle normal is mixed into the crown normal, for
    the sun and the sky light.
  - `foliage.needle_wrap` (0.35): wrap lighting for the sun, so a tuft facing away is not black.
  - `foliage.translucency` (2.5): with the sun behind the tuft, a forward lobe
    `0.25 b + 0.75 b^4` (b = -view·sun) times the thinness, tinted `foliage.translucency_rgb`
    (default [1, 1.12, 0.55], yellow-green). Shadowed like the sun term, so it lights the needles
    at the edge of a crown, not inside it.
  - `foliage.needle_scatter` (0.15): a weak glow of the whole backlit crown (`b^2`, more at thin
    edges), light scattered on through the foliage, so not shadowed by the crown; cloud shadow
    applies.
  - All of it fades out from 900 to 1500 m, where the impostors (crown normal only) take over. The
    values are uniforms (`material.userData.needleLight`, `.needleScatterK`, `.needleTint`).
  - Ponderosa 0.55 / 0.35 / 2.5 / 0.15. Gray pine 0.65 / 0.6 / 3.5 / 0.3 with a less yellow tint
    [1, 1.06, 0.95] so its b/g stays near the photo.
- **Ponderosa tufts as starbursts** (`drawNeedleCard`, `needle_brush`). Four or five shoots forking
  at 0.55-0.9 rad (was four to six at 0.28-0.63), each with a brush on its last 1.4 needle lengths
  (was 2.2) whose needles spread to square with the shoot within a needle length of the apex. A card
  is a few separate round tufts instead of one fan; the alpha cover of the close texture went from
  0.315 to 0.303.

Lineup, near tier (mean of three seeds; photo target in brackets):

| species | gaps | r/g | b/g |
|---|---|---|---|
| ponderosa | 0.35 → 0.34 (0.35) | 0.91 → 0.90 (0.95) | 0.48 → 0.46 (0.47) |
| gray pine | 0.37 → 0.37 (0.40) | 0.89 → 0.88 (0.88) | 0.78 → 0.77 (0.82) |

W/H and crown base are unchanged; blue oak, live oak, manzanita and chamise are identical. Ponderosa by
class: pole gaps 0.27 → 0.31, mature 0.35, old-growth 0.34. A canopy-only render under the lineup's
light (no shadows) is brighter, not darker: ponderosa front-lit mean +23 %, backlit +85 %; gray pine
+26 % and +186 % (in the world the crown's own shadow keeps the backlit gain to the edges).

Cost: one more texture fetch and the derivative frame per pine fragment. Measured A/B against HEAD on a
heavily loaded machine (load average 10-13): start view 48-57 fps against 48-55; the ponderosa stand
at 40 m 34-50 fps against 46-54, and a synchronous render of that view 23.1 / 23.6 ms against
21.6 / 23.0 ms (best of five), so about 1 ms in a full-screen pine stand.

**Known limits.**
- Gray pine tufts still read as round clumps at 20 m; the photos show long hanging tassels and a hazy
  edge. Its tuft shape (`needle_drooping`) was not changed in this pass.
- A crown's shaded side is still lit only by the sky: shadow maps treat a card as opaque, so a sparse
  gray pine has dark clumps where the real crown is lit through.
- Close up (under about 8 m) a face-on lit tuft is still fairly uniform: a card is flat.

## Twigs in the close tier (2026-10-24)

Review comment: "I think the trees just need more branches when the user gets closer." Up close the
crown was limbs and level-2 stems with foliage cards floating around them, and a bare blue oak was a
broom of straight spikes. The close tier (within `CLOSE_R` = 90 m of the camera, at most 600 trees per
mesh, empty at the start view) now grows one more level of short twigs, and its cards hang from them.
The near and mid tiers, the near card list and the far impostors are untouched, so the lineup's near
and mid metrics are identical to before.

- **Twigs** (`growTwigs` in `treegen.js`). A species with a `twigs` block gets a third level (the
  shrubs, which have one branch level, a second) grown in its own random stream from the skeleton
  before the height fit. Clumped foliage: each clump gets `count` twigs forking from its bearing stem,
  `length` x the clump radius long, `down_deg` off the stem, with the usual level parameters (curve,
  zigzag, droop, upturn, tropism). The fork is moved back along the stem by `recentre` (0.5) of the
  group's reach, so the cards on the twig tips stay round the clump's centre. Unclumped foliage
  (chamise): `count` forks split off a bearing wand at `split` of its length. Tubes are `sides` (3)
  sided, `segments` (1-2) long, plain vertex colour (`twigs.rgb`, else `trunk.twig_rgb`), no bark UVs.
- **Cards on twigs** (`placeOnTwig`). The close card count and size are unchanged (`close_factor`,
  `close_scale`). Each close card still picks its clump as before, then a twig of that clump, and hangs
  from it: its base (where the spray's drawn stem starts; `attach` x the card size) sits on a point in
  the outer `along` (0.5) of the twig, fanned up to `fan_deg` about the twig's direction, with a little
  `jitter` (fraction of the clump radius). Pine cards already sit on their base (`tuft_base`). Chamise
  cards past the split move onto a fork. A clump that got no twigs (budget) keeps its old cards.
- **Budget.** `twigs.tris` (default half of `lod.near_tris_budget`) for the species' reference tree,
  scaled with each tree's card count like the card cap (0.3-2.5x); over it, fewer clumps get twigs.
  Blue oak sets 1140 (0.6x) to afford two-segment zigzag twigs, which is what its bare crown is.
- **Deadwood and snags.** Dead stems at the bearing level get `dead` (0.5) x the twigs, grey
  (`deadwood.rgb`), shortened like a dead limb (`deadwood.shorten`), no cards. A snag keeps its
  `snag.twigs` fraction where the broken limb still reaches them (blue oak 0.3, pines 0).
- **Wiring** (`vegetation.js`). `buildTree(id, seed, 'close')` returns `twigs` (geometry, or null)
  beside `canopy`. Vegetation draws it as a second instanced mesh on the close canopy's instance
  matrices, with the plain wood material dithered in over the close band like the close canopy, in
  every season (a bare crown keeps its twigs). Twigs cast no shadow. The lineup has a "close LOD"
  box (`?close=1`) and counts the twigs as wood in the close silhouette; `__lineupMetrics('close', 0,
  'seeds', false)` leaves them out.

| field (`twigs`) | meaning |
|---|---|
| `count`, `prob` | twigs per clump (or forks per wand) [min, max]; chance a clump gets any |
| `length` | clump foliage: fraction of the clump radius; unclumped: fraction of the stem past `split` |
| `down_deg`, `down_var_deg`, `whorl` | angle off the bearing stem; `whorl` spaces a group evenly round it |
| `curve_deg`, `curve_var_deg`, `zigzag_deg`, `droop_deg`, `upturn_deg`, `tropism` | as for a level |
| `segments`, `sides`, `radius_m`, `taper` | the tube: 1-2 segments, 3 sides, base radius (at most 0.8 x the stem's) |
| `fan_deg`, `jitter`, `along`, `attach`, `recentre` | card placement on the twig (above) |
| `dead`, `split`, `rgb`, `tris` | dead-limb factor, chamise fork point, colour, triangle budget |

| species | twigs |
|---|---|
| blue oak | 1-2 per clump, stout (1.2 cm), spreading 50°, two segments zigzagging 28° |
| interior live oak | 3-4 per clump, fine (5 mm), short, wide fan: the dense twig network |
| ponderosa | 1-2 whorled shoots per tuft clump, stout (1.4 cm), turned up (tropism 0.2) |
| gray pine | 1-2 per clump (forks), sparse, drooping (tropism -0.25) |
| whiteleaf manzanita | 1-2 per clump, red (`twig_rgb`), crooked: two segments, zigzag 25°, curve 35° |
| chamise | 1-2 stiff upright forks (14°, 4 mm) on 60% of the wands, split at 0.8 of their length |

Triangles, reference tree (first measured seed): near tree (wood + cards), twigs (count), and the close
tree (near wood + twigs + close cards) before and after.

| species (`near_tris_budget`) | near | twigs | twigs / budget | close tree before → after |
|---|---|---|---|---|
| ponderosa (2200) | 2198 | 1068 (178) | 0.49 | 3718 → 4786 |
| gray pine (1800) | 1552 | 948 (158) | 0.53 | 2632 → 3580 |
| interior live oak (2000) | 2000 | 888 (148) | 0.44 | 2996 → 3884 |
| blue oak (1900) | 1900 | 1236 (103) | 0.65 | 3054 → 4290 |
| whiteleaf manzanita (1100) | 1100 | 564 (47) | 0.51 | 2068 → 2632 |
| chamise (1000) | 1000 | 342 (57) | 0.34 | 1992 → 2334 |

The close cards alone were already 2-3x the near cards, so "within 1.5x the near budget" is read as
near tree plus twigs: 1.34-1.51x, blue oak 1.65x. Bigger trees get more twigs with their cards
(ponderosa's third seed 1620, blue oak's second 1752).

Lineup, close tier, mean of the three measured seeds (W/H, crown base, gaps; HEAD → twigs). Near and
mid are unchanged; r/g and b/g move by at most 0.01.

| species | W/H | base | gaps |
|---|---|---|---|
| ponderosa | 0.43 → 0.42 | 0.46 → 0.45 | 0.37 → 0.35 |
| gray pine | 0.53 → 0.52 | 0.44 → 0.44 | 0.38 → 0.39 |
| interior live oak | 1.24 → 1.19 | 0.17 → 0.17 | 0.36 → 0.35 |
| blue oak | 1.48 → 1.43 | 0.21 → 0.20 | 0.25 → 0.26 |
| whiteleaf manzanita | 1.24 → 1.20 | 0.20 → 0.22 | 0.36 → 0.36 |
| chamise | 1.01 → 0.99 | 0.21 → 0.20 | 0.39 → 0.38 |

For scale: drawing HEAD's close cards from another random stream moves a single tree's gaps by up to
0.06 and W/H by 0.07, and the three-seed means by 0.01 and 0.04. One tree per class (`classes`) mostly
stays within that; the outliers are blue oak veteran (gaps 0.38 → 0.30, W/H 1.33 → 1.24, a fuller
crown) and manzanita young and decadent (gaps 0.23 → 0.31 and 0.37 → 0.44, more open).

Cost (A/B against HEAD by swapping `treegen.js` and `vegetation.js`, raven hovering at 3, 15 and 40 m
above ground, four rounds each, machine load 9-18, medians): oak woodland (4309, 3440) 70.2 / 69.7 /
76.4 fps against 65.7 / 70.6 / 71.8 with twigs; ponderosa stand (2958, 9835) 77.3 / 68.9 / 64.7
against 76.7 / 69.5 / 64.0; chaparral (3830, 1210) 57.5 / 60.5 / 63.9 against 57.4 / 59.1 / 65.1. The
spread between rounds (up to 20 fps) is larger than any difference. A synchronous render with the twig
meshes switched on and off in one session: ponderosa stand 13.3 against 12.9 ms (317 close plants,
306k twig triangles), oak woodland 15.2 against 15.2 ms (49 plants), chaparral 20.8 against 21.4 ms
(449 plants). Twigs are a pixel or two wide, so they add vertices, not fill.

**Known limits.**
- At 8-15 m in leaf the change is small: the cards still make the crown, and a 1-2 cm twig is about a
  pixel at 10 m. It shows most in the bare blue oak (zigzag forks where there were straight spikes)
  and in gray pine (tufts hanging from short shoots).
- The close cards bunch more round the twig tips than they did round the clump centre, so the close
  crown is up to 0.05 narrower (live oak, blue oak) than before; the near/close hand-over at 70-110 m
  shows no pop in captures at 74, 89 and 109 m.
- The winter twig texture on the close cards minifies to speckle; with the 3D twigs under it the
  speckle now sits on wood, but the texture itself was not changed.

## Riparian trees (2026-10-25)

Three streamside species, all native to the El Dorado County foothill creeks, so the riparian rows of the
species mix no longer borrow live oak and ponderosa. Agent drafts, `status` "agent draft, needs local
sign-off", CC BY-SA 4.0.

| id (alias) | form | height (file / classes) | crown | foliage | seasons |
|---|---|---|---|---|---|
| `salix_lasiolepis` (`willow`, `arroyo_willow`) | 5-9 stems spread 40°, each a leader to the top; 44 short upswept limbs, longest low (`crown.shape` conical) | 4-8 m; young 2-4, old 6-10 (grey dead wands) | broad mound, foliage to the ground | `lanceolate`, 8 cm, 30% pale undersides | yellow-green spring, dull green summer, yellow fall (leaf-on 0.7), bare winter with silvery upright catkins |
| `alnus_rhombifolia` (`alder`, `white_alder`) | one straight excurrent trunk (sometimes 2), 18 limbs at 58° to 34° with drooping tips, flat level-2 sprays | 13-22 m; young 5-10 (conical), veteran 18-25; snag 8% (top broken) | narrow egg, `tapered_cylindrical` | `oval`, 7 cm, dark green held flat | no fall colour (green-brown, leaf-on 0.8), bare winter with hanging catkins |
| `populus_fremontii` (`cottonwood`, `fremont_cottonwood`) | stout furrowed trunk forking low (split 0.6) into heavy sinuous limbs, leaning up to 12° | 15-24 m; young 6-12, veteran 22-30 (three-way fork, dead limbs); snag 8% | broad lobed dome, asymmetric | `deltoid` (new), 7 cm, glossy | fresh green spring, glossy green summer, yellow fall (leaf-on 0.8), bare winter |

**Generator additions** (`treegen.js`, minimal; every other species draws exactly as before):

| field | meaning |
|---|---|
| `foliage.leaf_shape: "deltoid"` | triangular leaf with a pointed tip and broad flat base, with the glossy glint of `elliptic_glossy` (cottonwood) |
| `foliage.catkins` | `{ rgb, len_m, width, hang, prob }`: catkins drawn at the twig ends of the bare-crown (`winter_twigs`) texture, tinted from `rgb` relative to `trunk.twig_rgb`; `hang` true hangs them (alder), false holds them along the twig (willow); `prob` per twig end |
| `targets.fall_rg`, `targets.fall_bg`, `targets.photos` | the fall colour measured from a photograph (not shown by the lineup yet), and the reference photographs with URL, author and licence |

**Reference photographs** (iNaturalist and Wikimedia Commons, CC0 / CC BY / CC BY-SA; listed in each file's
`targets.photos`, not copied into the repository), measured as in
[tree-likeness-review.md](tree-likeness-review.md): willow from single clumps and thickets at creeks
(W/H 1.28 for the best single clump, 2.1-2.2 for low wide clumps), alder from forest-grown streambank trees (W/H
0.59-0.68, rough: no clean sky silhouette of a mature streambank alder was found), cottonwood from lone mature
trees (W/H 1.0-1.5) and younger California trees (0.8-0.9).

**Lineup** (near tier, mean of the three measured seeds; photo target in brackets; mid and close within 0.08):

| species | W/H | crown base | gaps | r/g | b/g | near triangles (budget) |
|---|---|---|---|---|---|---|
| arroyo willow | 1.16 (1.3) | 0.15 (0.05) | 0.26 (0.30) | 0.88 (0.86) | 0.47 (0.47) | 1,642-1,800 (1,800) |
| white alder | 0.67 (0.70) | 0.28 (0.25) | 0.16 (0.12) | 0.86 (0.84) | 0.53 (0.53) | 2,000-2,616 (2,000) |
| Fremont cottonwood | 1.12 (1.05) | 0.23 (0.20) | 0.21 (0.15) | 0.83 (0.83) | 0.49 (0.51) | 2,200-2,898 (2,200) |

Fall colour from the files (summer measured times the fall tint): willow r/g about 1.37 (photo 1.34), b/g
about 0.47 (0.49); cottonwood about 1.37 (1.41) and 0.42 (0.43). Mid triangles 80-288 per tree.
To afford the leaf cards the three draw no level-2 tubes at near (`near_sides` [.., .., 0], as live oak) and
willow's stems have four sides.

**Species mix** (`pipeline/species_mix.py`, both tiles re-run for this step only): the tree slots grew from
four to seven. `species_mix_c.png` (RGB) holds the willow, alder and cottonwood weights (with
`species_mix_a.png` they sum to 255); `mixes[].bytes` keeps the original eight columns and appends the three,
and `species_mix.json` `bytes_layout` names every column, which `tilepackage.js` reads (older tiles fall
back to the original layout). Rows:

| rule | trees | tree / shrub density |
|---|---|---|
| `riparian` (foothill riparian woodland) | willow 0.38, alder 0.24, live oak 0.20, cottonwood 0.10, blue oak 0.08 (for valley oak) | 1.6 / 0.3 |
| `rewilded_riparian` (restored channels through old reservoir beds) | willow 0.45, alder 0.25, live oak 0.18, cottonwood 0.12; no pine, no chaparral shrubs | 2.0 / 0 |
| `riparian_shrubland` | willow 0.75, live oak 0.15, alder 0.10 | 1.2 / 0.2 |
| `montane_riparian` (BpS backfill) | alder 0.40, willow 0.25, live oak 0.15, ponderosa 0.12, cottonwood 0.08 | 1.3 / 0.3 |
| `wet_meadow_marsh` | willow 0.8, live oak 0.2 | 0.05 / 0.05 |

Tree shares in the home tile: willow 2.9%, alder 2.3%, cottonwood 0.7%.

**Cost** (start view of the home tile, headless Chromium on Metal, A/B against HEAD's library and mix, two
rounds): 64.0 / 65.7 fps against 65.2 / 66.0 (noise), draw calls 234 against 206, triangles unchanged
(5.9-6.1 M both), 393 geometries against 324. The far impostor atlas holds 108 slots instead of 72: 35 MB
instead of 23 MB, bake about 650 ms instead of 530 ms.

**Placement on the bank** (`vegetation.js` `placePlant`, the shared placement both placers should call).
Willow and alder are exempt from the riparian thinning (`placementSkip` takes the species as an optional
last argument; oaks, pines and cottonwood thin as before). A willow whose drawn position has a channel
(perennial or intermittent reach; in a `rewilded_riparian` cell the restored channel, ephemeral or not)
within 30 m moves straight toward the channel's nearest point to 2-10 m from its edge (the water mask's
half-width), an alder to 3-15 m (inside a rewilded corridor both stop at 11 m from the centreline), the
distance from the plant's own hash; one already in its band stays put, and a move landing in water, on
any road or off the tile is not made. Cottonwood stays where it falls. No random draw changed: every
other species' placements are bit-identical on both tiles (all 332k plants of the home tile compared).
Home tile: willows 9,370 to 10,625 and alders 6,396 to 7,202 (the thinning no longer drops them); of the
willows with a channel within 30 m, 3,392 now stand 2-10 m from its edge (1,025 before); none in water.
The far impostors (`impostors.js` `buildRecords`) still call `placementSkip` without the species and
take the drawn position; for them to agree it needs `const at = placePlant(tile, i, j, k, name, px, pn,
isTree); if (!at) continue;` in place of the `placementSkip` line, with `at.x` / `at.n` for `px` / `pn`
in the record and chunk below it.

**Known limits.**
- Willow reads as a shrubby tree with leafy sprays rather than a thicket of upright wands, and its lowest
  foliage sits at 0.15 of its height (photos 0.05): level-1 limbs are shared among the stems.
- At under 10 m the close-tier cards show their spray outline (broad lobes), most visibly on willow, whose
  real foliage is fine and narrow.
- Far impostors: until `impostors.js` calls `placePlant` (below), willows and alders beyond the hand-over
  (about 1.2 km) stand where they were drawn and are thinned near the channel, so a handful swap places
  across the dither band.
- Cottonwood leaves do not flutter (no wind) and its red catkins are not drawn; alder cones are not drawn.
- The riparian understory (blackberry, wild rose, spicebush) and valley oak, Oregon ash, bigleaf maple and box
  elder are not in the library.

## Generator features for the foothill set (2026-10-25)

What the next seventeen foothill species need from the generator, the species mix and the far forest, so
that the library can hold any number of species. Every field is optional and a file without it grows
exactly as before: the nine existing species are pixel-identical on the lineup (same metrics, same canvas
hash) and every one of their plants stands where it stood on all three tiles.

**Leaf shapes** (`foliage.leaf_shape`; drawn by `drawShapedLeaf` in `treegen.js`, one leaf at a time,
spaced along the spray's twigs by `LEAF_STEP` because a compound or large leaf is one big unit).
`leafSpecimen(shape, foliage, px)` draws a single leaf for checking.

| `leaf_shape` | for | fields |
|---|---|---|
| `palmate_compound` | buckeye | `leaflets` (default `[5, 7]`) radiating from the tip of a long petiole, the middle one longest; `leaflet_ratio` (0.62): middle leaflet / `leaf_size_m` |
| `pinnate_compound` | walnut, ash, elderberry | `leaflets` (`[5, 9]`, odd: opposite pairs plus a terminal one) along a rachis `leaf_size_m` long; `leaflet_ratio` (0.28) |
| `trifoliate` | poison oak | three lobed-wavy, glossy leaflets, the terminal one on a short stalk |
| `lobed_large` | black oak, big-leaf maple | `lobes` (7), `lobe_depth` (0.55, fraction of the half-width cut away), `lobe_style` `pinnate` (lobes along the midrib, oaks) or `palmate` (from the petiole, maple), `lobe_tip` `pointed` (default; black oak's bristle-tipped lobes, maple) or `round` |
| `cordate` | redbud | broad heart shape, notched base, short point |
| `needle_scale` | incense cedar | `type: "scale"`. Flat sprays of scale leaves: each twig of the card is a frond branched twice in its plane; `leaf_size_m` is one branchlet (about 0.05-0.08 m). `orientation: "vertical"` holds the sprays edge-up |
| `needle_flat` | Douglas-fir | `type: "needle"`. Flat soft needles (`leaf_size_m` one needle, 0.02-0.03 m) in two ranks along flat, pinnately branched shoots. Drawn on the pine needle path, so it gets the needle-keeping mips and the needle light (`needle_normal`, `needle_wrap`, `translucency`, as the pines) |

`leaf_size_m` is the whole leaf for the compound and large shapes. A card holds fewer large leaves than
small ones, so these crowns need a higher `leaf_fill` (about 1.5-2.5) or `cards_per_m2` to stay as dense
as an oak. The existing shapes are unchanged.

**Bark** (`trunk.bark_pattern`, texture `barkTexture`, plus the vertex-colour pattern of the mid trunks):

| pattern | for | look, and the `trunk.bark` fields it reads |
|---|---|---|
| `peeling_red` | madrone | smooth satin red-orange (`bark_rgb` is the mean) in sheets; a third of them freshly bared, pale olive-cream, and only a border between bared and old bark shows, as the old sheet's curled lip and its shadow. `plate_m` (default `[0.1, 0.18]`) is a sheet |
| `smooth_grey` | buckeye, bay | smooth, faintly mottled, with short horizontal lenticels; `lichen` adds pale patches |
| `fibrous` | incense cedar | long interlacing fibrous ridges and dark furrows, fine lengthwise fibres, a few pale peeling strips; `ridge_m` (0.04) |
| `platy` | black oak, valley oak | thick blocky plates (`plate_m`, default `[0.1, 0.2]`), deep dark fissures (`fissure`), a few horizontal cross-checks |

`checkered`, `furrowed`, `shreddy`, `smooth` and `plates` are as before.

**Flowers and berries** (`foliage.flowers`, `foliage.berries`): drawn into the card textures in the season
they show, at the spray's twig ends (on a bare-crown texture at its twig ends and, for flowers, along its
outer twigs), in their own random stream after the leaves, so the leaves are unchanged. They show in every
tier that uses card textures (close, near and mid) but not in the far impostors, and not on pine needle
cards (`needle_brush`, `needle_drooping`, `needle_flat`).

| field | meaning |
|---|---|
| `season` | `"spring"` etc., or a list (`["fall", "winter"]`) |
| `months` | optional `[from, to]` (1-12, inclusive, may wrap: `[11, 1]`); when given it decides instead of `season`. Use it when flowers and berries share a season (elderberry flowers in June, berries in August) |
| `form` | flowers: `candle` (an upright spike, full most of its length and tapering to the tip: buckeye), `cluster` (a round head of florets: toyon, elderberry, redbud), `bud` (one small dot); berries: `cluster` (default) or `bud` |
| `rgb` | sRGB colour |
| `size_m` | size of one inflorescence or berry cluster |
| `density` | 0-1, the fraction of twig ends that carry one. On a bare crown, flowers cover at most 0.6 x density of the spray and berries hang from about a dozen shoots per card |
| `per_card` | opt-in, instead of `density`: this many heads on a near card, times the card's area relative to it (a close card at `lod.close_scale` 0.6 gets 0.36 of them, a mid card at scale 2 four times as many; the fraction by chance), at the twig ends first and then at points of the spray, each whole on the card and at least 0.75 `size_m` from the next. Buckeye 8, elderberry 5 (2026-10-26) |
| `width` | `candle` only: half-width over length (default 0.2) |
| `before_leaves` | flowers only: shown on the bare-crown texture while the crown is under half in leaf (redbud in March, on max(`winter_twigs`, 0.5) of the cards); once it is half leafed they show on the leaf texture |

Defaults: flowers `{ form: "cluster", size_m: 0.1, density: 0.5, before_leaves: false, season: "spring" }`,
berries `{ form: "cluster", size_m: 0.06, density: 0.4, season: "fall" }`. Other fields (`rgb_unripe`) are
not read. The colour is applied as a linear ratio to the season's leaf colour (or the twig colour on a bare
crown) with up to 8x headroom, so white candles on dark leaves read white; the material's gain comes from
the leaves alone.

**Months** (`foliage.leaf_on_by_month`: twelve values, January first, each the middle of its month, linear
in between and round the year). When present it replaces `leaf_on[season]`, so buckeye can be full in April,
dropping in July and bare by August. The client works in months: the season selector's "tracks today's date"
uses today's date, a chosen season its middle month (winter 1.5 = mid-January, spring 4.5, summer 7.5, fall
10.5; `SEASON_MONTH`, `seasonMonth`, `leafOnAt` and `decoActive` in `treegen.js`). Vegetation, the far
impostors and the lineup (a Month menu, `?month=1..12`) all pass it. Season colours stay per season.

**Form `multi_stem_shrub_tree`** (toyon, elderberry at 3-6 m). The shrub form spreads every stem from the
base and gives each its own branches, which suits them, but it also draws the plant as a shrub: shrub LOD
defaults and caps and, past the hand-over, a chaparral patch (the far impostor widens far shrubs three
times). A willow-style `tree` with several stems shares one tree's level-1 limbs among its stems. This form
grows like a shrub (all stems spread, `levels[0].count` per stem, stems fitted to the crown envelope, dead
stems with `deadwood.levels: [0]`) and is drawn as a tree. Use `trunk.stems` (`[3, 6]`) and
`trunk.stem_spread_deg` (15-30). It may sit in either list of a species-mix row.

**Library size.** Vegetation builds meshes only for the species the tile can place (its mix rows plus the
class mixes, `tileSpecies` in `vegetation.js`), and a mix row that names a species missing from the library
leaves it out with a warning instead of failing. The lineup shows every species in `index.json`;
`?add=<id>,<id>` also loads files not yet listed (drafts, the `_test_` files) and `?only=<id>,...` shows just
those. `addSpecies(raw)` registers a species at run time. `embed_builtin.py` embeds every listed species and
skips ids starting with `_`.

**Species mix: format 2.** Cells carry only their row (`species_mix_index.png`) and their two density
multipliers (`species_mix_density.png`); the rows carry the weights of however many species they name, as
`tree_bytes` / `shrub_bytes` in the column order of `species`. The weights were never varied per cell (every
cell of a row held the row's bytes), so nothing was lost. The species-mix step was re-run on the three tiles;
every row's bytes match format 1 and every plant's position, slot, scale and rotation hash the same for all
nine species on all three tiles. Format 1 tiles still load. Details in
[tile-spec.md](tile-spec.md), "Species mix". A new species in a rule is appended to the columns
automatically (`columns()` in `species_mix.py`); the existing columns keep their order.

**Far impostor atlas.** Every plant still draws one of 12 slots, but the atlas bakes trees per species by how
common the species is on the tile (`planSlots` in `impostors.js`): at least 2% of its layer (trees or
shrubs) 12 slots, which bake its 4-6 distinct class trees; rarer 4 slots (4 trees); not placed on the tile,
none. Over 64 distinct trees (`MAX_TREES`: 64 trees x 5 views in rows of ten 128-texel cells is a
1280 x 4096 atlas, inside every WebGL2 device's texture limit; 53 MB with mips for both atlases), the species
with the smallest share of all plants per baked tree gives up a tree, repeatedly, none under 2 trees before
all are at 2. A plant whose own tree is not baked draws its class's baked tree (`impostorSeed`). Measured and
modelled:

| tile | species | distinct trees | atlas | MB |
|---|---|---|---|---|
| any tile before (9 species x 12 slots) | 9 | 42 | 1280 x 2688 | 35 |
| home tile now (cottonwood 0.9% of trees: 4 slots) | 9 | 41 | 1280 x 2688 | 35 |
| 15 species (the nine plus black oak, valley oak, incense cedar, buckeye, toyon, poison oak) | 15 | 70, capped to 63 | 1280 x 4096 | 53 |
| all 26, home-tile proportions (uncapped: 114 trees, 95 MB, 1280 x 7296, too tall for many GPUs) | 26 | 64 | 1280 x 4096 | 53 |

With all 26, blue oak, live oak, gray pine and ponderosa keep all their class trees (6, 4, 5, 5) and every
other species has 2. The bake costs about 70 ms per tree at load.

**Known limits.**
- Flowers and berries are texture detail: they do not stand out of the crown's silhouette, and the far
  impostors (beyond about 1.2 km) do not show them (they are baked from the summer texture and tinted).
- A flowering texture stores the leaves at up to 1/8 brightness to leave room for white flowers, so its
  leaves have fewer grey levels (about 10) than the plain texture; it is used only in its season.
- `needle_scale` sprays have no needle light (they are drawn on the leaf path); `needle_flat` has no flowers
  or cones.
- Rare species beyond the hand-over have as few as 2 tree shapes when a tile holds all 26 species.


## Foothill trees, set A (2026-10-25)

Six broadleaf trees of the foothills around Placerville and Shingle Springs (300-700 m), so the oak woodland,
canyons and creeks no longer borrow oaks for them. Agent drafts, `status` "agent draft, needs local sign-off",
CC BY-SA 4.0. Registration in `index.json`, the generator fields they use and placement in the species mix
belong to other lanes; until those land the files are on disk but not loaded by the client.

| id (alias) | form | height (file / classes) | crown | foliage | seasons |
|---|---|---|---|---|---|
| `aesculus_californica` (`buckeye`) | 1-4 pale smooth stems (`smooth_grey`), short thick trunk forking low, long limbs drooping to the grass | 4-9 m; young 2-4 (shrubby), veteran 8-12 | low broad dome, wider than tall | `palmate_compound` (5-7 leaflets), 18 cm; white flower candles in spring; big brown fruit in fall | leaf-out February-March, full April-June, brown and dropping July, bare August-January (`leaf_on_by_month`) |
| `arbutus_menziesii` (`madrone`) | leaning, sinuous red stems (`peeling_red`, green-cream under-bark), often 2-3 from a burl | 10-22 m; young 4-9, veteran 18-28; snag 5% | irregular, one-sided, billowy clumps at the branch ends | `elliptic_glossy`, 11 cm, old leaves red in the palette; white flower clusters in spring, red berries in fall | evergreen |
| `juglans_hindsii` (`black_walnut`) | one stout, dark, deeply furrowed trunk, coarse sparse branching | 12-18 m; young 5-10, veteran 16-22; snag 5% | broad rounded dome, feathery and see-through | `pinnate_compound` (15-19 leaflets), 30 cm; green nuts in fall | leaf-out April, yellow October, bare November |
| `umbellularia_californica` (`bay`) | 2-5 stems from a burl, each keeping a leader (`smooth_grey`, green twigs) | 10-20 m; young 3-8 (shrubby clump), veteran 18-25 (3-7 stems) | dense dark dome, foliage low | `elliptic_glossy`, 8 cm; pale yellow flowers in winter; olive-like fruit | evergreen |
| `acer_macrophyllum` (`bigleaf_maple`) | one to three trunks, opposite branching (rotation 90), mossy bark | 15-24 m; young 6-12, veteran 22-30 (2-4 stems); snag 5% | rounded, big lobes | `lobed_large` (5 lobes), 25 cm; yellow-green flower tassels before the leaves | leaf-out March-April, gold October-November |
| `fraxinus_latifolia` (`oregon_ash`) | straight trunk keeping its leader, stiff ascending opposite branches | 12-20 m; young 5-10, veteran 18-25; snag 5% | narrow oval, open | `pinnate_compound` (5-7 leaflets), 22 cm, pale hairy undersides | late leaf-out (April), clear yellow early October, bare early |

**Fields used** (added by the generator lane working in parallel, uncommitted in the working tree when these
files were checked): `foliage.leaf_shape` `palmate_compound` and `pinnate_compound` with `foliage.leaflets`
[min, max], `lobed_large` with `foliage.lobes`, `lobe_depth` and `lobe_style: "palmate"` (maple);
`trunk.bark_pattern` `smooth_grey` and `peeling_red`; `foliage.flowers`, `foliage.berries` (buckeye's large fruit
and walnut's nuts are drawn as berries; `size_m` is one fruit or one cluster) and `foliage.leaf_on_by_month`
(twelve values, January first). Maple and ash seeds (samaras) and walnut catkins are not drawn. The season
`leaf_on` values stay for older code; with `leaf_on_by_month` the lineup's summer is mid-July, so buckeye is
measured with about 55% of its cards, between its full June crown and its bare August one.

**Reference photographs** (Wikimedia Commons and iNaturalist, public domain, CC0, CC BY, CC BY-SA; listed with
author and licence in each file's `targets.photos`, not copied into the repository), measured as in
[tree-likeness-review.md](tree-likeness-review.md): W/H and crown base from the tree's extremes, porosity as
the sky fraction inside the crown rows that have sky behind them, colour as the linear mean of crown pixels
with sky, flowers and (new for these) orange-red bark masked out. Few photos have a clean sky silhouette of
a whole tree; where the lower crown is hidden (Oregon ash in thickets) the crown base is a judgement, and the
madrone W/H (0.9) is set between the open-grown (1.49) and forest-grown (0.46) trees measured.

**Lineup metrics** (near tier, the three measured seeds, `client/lineup.html?add=<ids>&only=<ids>` with the
generator lane's working-tree `treegen.js` and `lineup.js` of 2026-10-25 evening; photo target in brackets):

| species | W/H | crown base | gaps | r/g | b/g | near triangles (budget) |
|---|---|---|---|---|---|---|
| California buckeye (mid-July, about 55% of cards) | 1.46 (1.45) | 0.13 (0.05) | 0.15 (0.18) | 0.82 (0.80) | 0.36 (0.36) | 1,048-1,514 (1,900) |
| Pacific madrone | 0.89 (0.9) | 0.30 (0.30) | 0.29 (0.28) | 0.87 (0.88) | 0.70 (0.69) | 1,602-2,612 (2,000) |
| black walnut | 1.11 (1.15) | 0.19 (0.13) | 0.29 (0.34) | 0.78 (0.78) | 0.49 (0.49) | 1,168-1,276 (2,000) |
| California bay | 1.09 (1.0) | 0.15 (0.10) | 0.25 (0.25) | 0.94 (0.94) | 0.52 (0.50) | 2,134-2,428 (2,300) |
| big-leaf maple | 1.00 (0.9) | 0.21 (0.15) | 0.21 (0.25) | 0.88 (0.88) | 0.51 (0.50) | 1,658-1,908 (2,200) |
| Oregon ash | 0.66 (0.7) | 0.31 (0.25) | 0.29 (0.33) | 0.80 (0.80) | 0.42 (0.42) | 1,754-1,900 (1,900) |

All within the lineup's tolerances except buckeye's crown base (0.13 against 0.05: the photos show foliage to
the grass; lowering the limbs further put cards below ground and raised the base instead). Summer colours were set from the photo ratios
and then the blue raised by about 0.05 so the rendered ratio lands on the target, since the lineup's render
reads b/g lower than the file's linear colour. Every class and snag builds without errors in the near, mid and
close tiers; veterans run over the reference budget as the other species' do. An earlier pass against HEAD's
generator (leaf shapes falling back to the plain spray) gave the same numbers within 0.02, so the gaps come
from the card layout, not the new leaf textures.

**Known limits.**
- Not seen in the world: the files are not in `index.json` or the species mix yet. On the lineup the crowns read
  as clumps of rounded sprays; walnut in particular is less feathery than the photos, and buckeye's flower
  candles (density 0.6) are drawn into the cards but barely show at lineup distance.
- Local sign-off is the main open question, especially buckeye's summer-dry timing on local sites, how far
  black walnut (and its hybrids) reaches up the foothill creeks, and whether madrone and bay here grow as in the
  coastal photos used.

## Foothill trees, set B (2026-10-25)

Three oaks and two conifers of the foothills around Placerville and Shingle Springs (300-900 m): the big
valley-floor oak, the canyon-wall oak, the oak of the lower conifer forest, and the two conifers that come
down north slopes and canyons into the oak woodland. Agent drafts, `status` "agent draft, needs local
sign-off", CC BY-SA 4.0. Registration in `index.json`, the generator fields they use and placement in the
habitats and species mix belong to other lanes; until those land the files are on disk but not loaded by the
client.

| id (alias) | form | height (file / classes) | crown | foliage | seasons |
|---|---|---|---|---|---|
| `quercus_lobata` (`valley_oak`) | massive short trunk (`platy`, grey blocks), forking into a few heavy limbs that arch down, pendulous outer branchlets; mistletoe common | 15-25 m; sapling 3-6, young 8-15, veteran 22-30 (broad, drooping skirt, dead limbs); snag 5% | broad dome, wider than tall, foliage low | `oblong_wavy`, 8 cm, `lobe_depth` 0.55 (deeply lobed) | leaf-out March, dark green summer, yellow-brown fall (leaf-on 0.75), bare winter |
| `quercus_chrysolepis` (`canyon_live_oak`, `canyon_oak`, `goldcup_oak`) | 1-3 stems, short trunk, leaning out over the slope (lean 12, asymmetry 0.22); pale scaly bark (`checkered`, fine) | 8-18 m; young 3-8 (shrubby, 1-3 stems), veteran 15-22; snag 4% | dense wide dome to the ground | `elliptic_glossy`, 5 cm, golden and grey undersides in the palette | evergreen; pale golden new growth in spring |
| `quercus_kelloggii` (`black_oak`, `california_black_oak`) | upright, clean bole, forking with age; dark, nearly black `platy` bark | 10-22 m; sprout clump 2.5-6 (2-4 stems after fire), young 6-12 (narrow), veteran 18-26 (forked, hollow); snag 5% | rounded, about as wide as tall | `lobed_large` (`lobes` 7), 15 cm | pink leaf-out April-May (leaf-on 0.85), yellow-green summer, yellow to orange fall (leaf-on 0.75), bare winter |
| `calocedrus_decurrens` (`incense_cedar`) | excurrent, 36 spiral limbs drooping then turning up; swollen base; cinnamon `fibrous` bark | 20-36 m; young 4-12 (dense cone to the ground), old-growth 32-45 (ragged, clear bole, dead lower limbs); snag 5% (top broken) | narrow cone, irregular when old | `scale` / `needle_scale`: flat fan sprays, one plane per card along the shoot | evergreen; slightly golden in winter (pollen cones) |
| `pseudotsuga_menziesii` (`douglas_fir`) | excurrent, 30 limbs in whorls of four, drooping with upturned tips, pendent side shoots; deep `furrowed` bark (young: `smooth`) | 30-48 m; young 6-18 (dense spire), old-growth 45-60 (long clear bole, ragged top); snag 6% (top broken) | narrow cone over a clear bole | `needle_flat`, 2.5 cm, one plane per card, hanging (`droop` 0.4) | evergreen; bright yellow-green spring flush |

**Acorns.** All three oaks bear acorns for the acorn game: valley oak (long, slender, 3-5 cm, ripen in one
season, drop September-November), canyon live oak (large, in a thick golden-woolly cup, two seasons) and black
oak (2.5-3 cm, deep scaly cup, two seasons). The game finds oaks through `OAK_SHORT` in `vegetation.js`; the
aliases `valley_oak`, `canyon_live_oak` and `black_oak` are there for that lane. Incense cedar and Douglas-fir
have cones only, and no cone field is set (Douglas-fir's hanging cones with three-pointed bracts belong to
`needle_flat` if the generator draws them).

**Fields used** (from the generator lane working in parallel; names as agreed, not yet in `treegen.js` at the
time of writing): `foliage.leaf_shape` `lobed_large` with `foliage.lobes` (black oak), `needle_scale` (incense
cedar, `foliage.type` `scale`, `leaf_size_m` 0.012 is one scale leaf; a spray is 10-20 cm), `needle_flat`
(Douglas-fir); `foliage.lobe_depth` on `oblong_wavy` (valley oak, ignored if the shape does not support it);
`trunk.bark_pattern` `platy` (valley and black oak) and `fibrous` (incense cedar). The conifers also use the
pines' needle fields (`needle_planes`, `tuft_spread_deg`, `tuft_up`, `droop`, `twist_deg` and the needle-light
strengths, set a little below ponderosa's).

**Reference photographs** (Wikimedia Commons and iNaturalist, public domain, CC0, CC BY, CC BY-SA; 4-6 per
species with author and licence in each file's `targets.photos`, not copied into the repository), measured as
in [tree-likeness-review.md](tree-likeness-review.md): W/H from the 1st-99th percentile of non-sky columns per
row, crown base from the lowest crown row, porosity as the sky fraction inside the crown span over rows with
sky behind them, colour as the linear mean of the crown mask eroded by 3 px with near-black shadow left out.
Almost every clean silhouette is an open-grown tree. Where the trees here grow crowded, the target is set
below the open-grown median and the file says so: canyon live oak W/H 1.35 (photos 1.05-1.54), valley oak
1.35 (1.30-1.84), and Douglas-fir W/H 0.5 and crown base 0.3 against open-grown 0.58-0.77 and 0.03-0.10,
because here it stands in mixed conifer on north slopes. Black oak's summer b/g is lowered from 0.70 to 0.62
for the blue cast of the one open-grown summer photo (an old film scan).

**Lineup metrics** (near tier, the three measured seeds, measured with the lineup's own method in a scratch
copy of the page with the files loaded by hand, run in headless Chromium, against `treegen.js` as in the
working tree on 2026-10-25 before the new fields landed: `lobed_large`, `needle_scale` and `needle_flat` fall
back to the plain leaf spray and `platy` and `fibrous` to the default bark; photo target in brackets):

| species | W/H | crown base | gaps | r/g | b/g | near triangles (budget) | mid W/H, base, gaps |
|---|---|---|---|---|---|---|---|
| valley oak | 1.35 (1.35) | 0.11 (0.10) | 0.30 (0.23) | 0.97 (1.00) | 0.62 (0.64) | 2,188-3,126 (2,200) | 1.35, 0.11, 0.20 |
| canyon live oak | 1.26 (1.35) | 0.16 (0.12) | 0.20 (0.12) | 0.96 (0.94) | 0.44 (0.45) | 2,000-3,844 (2,000) | 1.23, 0.14, 0.17 |
| California black oak | 0.90 (0.92) | 0.25 (0.21) | 0.21 (0.30) | 0.88 (0.87) | 0.61 (0.62) | 1,356-1,604 (2,000) | 0.83, 0.25, 0.28 |
| incense cedar | 0.40 (0.42) | 0.13 (0.14) | 0.28 (0.15) | 0.92 (0.92) | 0.39 (0.42) | 2,200-2,690 (2,200) | 0.41, 0.13, 0.06 |
| Douglas-fir | 0.49 (0.50) | 0.27 (0.30) | 0.38 (0.30) | 0.91 (0.91) | 0.60 (0.61) | 1,658-2,600 (2,600) | 0.41, 0.31, 0.77 |

Off tolerance: canyon live oak's and incense cedar's gaps (both too open on the plain spray), valley oak's
gaps by 0.07, and Douglas-fir in the mid tier (0.77 gaps: the plain spray minified at mid is nearly empty; with
`needle_brush` standing in for `needle_flat` the same skeleton measured 0.18-0.36 mid and 0.53 near). Black
oak's wood took 1,980 of its 2,000 triangles at first (12 cards); its level-2 tubes are now off at near
(`near_sides` [7, 3, 0]), as are valley oak's. Douglas-fir has the largest crowns in the library (a 47 m
reference tree, 2,250 m² of envelope), so it has a 2,600 budget and large cards (2.6 m). Every class and snag
builds without errors; veterans and the largest mature seeds run over the reference budget as the other
species' do (canyon live oak's veteran 4,758). One tree per class (`classes`): valley oak sapling, young,
mature, veteran W/H 1.08, 1.02, 1.57, 1.31; black oak young 0.49 (the narrow stand form); Douglas-fir young
gaps 0.58 (too open for a dense young spire, card cap). Re-measure all five once the new leaf shapes and bark
patterns are drawn: the textures will move the gaps and colour.

**Known limits.**
- Unverified on the real lineup and in the world: the files are not in `index.json` and the new fields were not
  drawn when they were written.
- Douglas-fir's targets for W/H and crown base are a judgement for stand-grown trees, not a photo median; no
  clean sky silhouette of a Sierra stand-grown tree was found. The only measured Sierra photographs are an
  incense cedar in Placer County, one at Long Barn and an old valley oak at Mariposa; the rest are from the Coast
  Ranges, the Cascades, southern California mountains and Washington.
- Local sign-off is the main open question: how low Douglas-fir and incense cedar actually come on the north
  slopes and canyons near Placerville, how far black oak reaches below 500 m, and whether the canyon live oaks
  here are mostly the canyon-wall tree or the shrubby ridge form.

## Foothill shrubs (2026-10-25)

Six shrubs of the Placerville and Shingle Springs foothills, so the oak woodland understory, the grassland edges
and the chaparral are not only manzanita and chamise. Agent drafts, `status` "agent draft, needs local sign-off",
CC BY-SA 4.0. They use the generator fields of the foothill set (`leaf_shape` `cordate`, `trifoliate`,
`pinnate_compound`, `bark_pattern` `smooth_grey`, `foliage.flowers`, `foliage.berries` with `months` [from, to],
`leaf_on_by_month`, `form: "multi_stem_shrub_tree"`). Registration in `index.json`, the species mix, the habitats
and the shrub impostor field are other lanes' work.

| id (alias) | form | height (file / classes) | crown | foliage | seasons |
|---|---|---|---|---|---|
| `heteromeles_arbutifolia` (`toyon`) | `multi_stem_shrub_tree`: 3-6 grey stems spreading 22°, 6 limbs each | 2.5-5 m; young 1-2.5, old 4-6 (a small tree of a few leaning trunks, dead limbs) | dense rounded dome, W/H about 1.1, leafy nearly to the ground | `elliptic_glossy`, 8 cm, dark glossy green, a few yellow and red old leaves | evergreen; cream flower clusters June-July; red berries November-January (`season` fall and winter) |
| `cercis_occidentalis` (`redbud`) | `shrub`: 5-9 straight stems in a vase (34°), zig-zag red-brown twigs | 2.5-5 m; young 1.2-2.5 (narrow vase), old 4-6 | inverse-conical vase to a broad uneven top, crown base 0.2 | `cordate`, 7.5 cm, blue-green (palette: 15% bloom) | magenta clusters on bare wood February-April (`before_leaves`), leaves from mid-April, orange to red-brown in fall, bare December-March with hanging brown pods (the `catkins` field) |
| `toxicodendron_diversilobum` (`poison_oak`) | `shrub`: 3-7 slender leaning stems with one level of short leafy shoots, foliage on the stems from 20% up | 1-2.5 m; low 0.3-0.9 (a few shoots in the grass), thicket 1.8-3 | open, taller than wide (W/H 0.8), porous | `trifoliate`, 10 cm (the leaf of three) | red-tinged leaves in March, glossy green, scarlet in October, bare November-February; greenish flowers April-May, whitish berries August-November |
| `baccharis_pilularis` (`coyote_brush`) | `shrub`: 8-14 stems spreading 38°, short upright twigs | 1-2.5 m; young 0.5-1.2, decadent 1.8-3 (grey dead centre) | rounded mound, W/H 1.2, leafy to the ground | `oval`, 2.2 cm, bright to olive green | evergreen; cream flower heads September-December (female plants go white and fluffy) |
| `sambucus_nigra_caerulea` (`elderberry`) | `multi_stem_shrub_tree`: 5-10 stems spreading 32°, arching limbs (droop 8°) | 3-6 m; young 1.5-3 (upright wands), old 5-7 (corky trunks, dead canes) | broad irregular dome, W/H about 1.4 | `pinnate_compound`, 22 cm leaves | flat cream flower plates April-June, powder-blue berries July-September, yellow and dropping in fall, bare December-February |
| `frangula_californica` (`coffeeberry`) | `shrub`: 5-9 stems spreading 42° | 1.5-3.5 m; young 0.7-1.5, old 2.5-4 | dense rounded dome wider than tall, W/H 1.4 | `elliptic_glossy`, 6 cm, grey-green (the hoary ssp. *tomentella* is common here; 25% pale leaves) | evergreen; red and black berries August-November |

`levels[0].count` is per stem for all six (the generator grows `multi_stem_shrub_tree` like a shrub, with tree
LOD defaults). Berry and flower `size_m` is the size of one cluster.

**Reference photographs** (in each file's `targets.photos`; 37 in all, not copied into the repository): iNaturalist
research-grade observations from El Dorado and Placer counties (CC0 and CC BY: Hidden Falls, Auburn, Foresthill,
Pilot Hill, Cameron Park, Shingle Springs, El Dorado Hills, Placerville, Pollock Pines, Ice House Road), plus
Wikimedia Commons for the elderberry and poison oak habit, of which there were no clean local photographs. Most
local photographs are close-ups or shrubs in thickets, so W/H was read off a 10% grid from the few open-grown plants
(often cropped at a side: a lower bound) and the porosity targets are judgement, not measurement. Colour is the
linear mean of the foliage pixels in a hand-placed box.

**Lineup** (near tier, mean of the three measured seeds; photo target in brackets; measured 2026-10-25 against the
working-tree generator with the foothill-set leaf shapes, by adding the files to `LIBRARY` in the page, since they are
not in `index.json` yet):

| species | W/H | crown base | gaps | r/g | b/g | near triangles per seed (budget) | mid gaps |
|---|---|---|---|---|---|---|---|
| toyon | 0.96 (1.1) | 0.15 (0.1) | 0.12 (0.15) | 0.89 (0.86) | 0.53 (0.58) | 774-858 (1,200) | 0.28 |
| western redbud | 0.96 (1.0) | 0.30 (0.2) | 0.24 (0.25) | 0.82 (0.83) | 0.59 (0.61) | 658-962 (1,100) | 0.47 |
| poison oak | 0.74 (0.8) | 0.15 (0.15) | 0.29 (0.35) | 0.76 (0.75) | 0.43 (0.47) | 364-442 (1,000) | 0.36 |
| coyote brush | 1.24 (1.2) | 0.16 (0.05) | 0.20 (0.2) | 0.95 (0.95) | 0.46 (0.48) | 654-1,006 (1,000) | 0.30 |
| blue elderberry | 1.48 (1.4) | 0.20 (0.08) | 0.26 (0.22) | 0.87 (0.86) | 0.54 (0.56) | 922-1,164 (1,300) | 0.65 |
| coffeeberry | 1.29 (1.4) | 0.18 (0.08) | 0.13 (0.18) | 0.99 (0.98) | 0.65 (0.70) | 704-1,142 (1,100) | 0.29 |

Card density is set per species with `foliage.cards_per_m2` (tuned to the gaps). Mid triangles 39-151 per plant.
Every class builds at near, mid and close.

**Impostor cards wanted** (for the lane that adds these to the shrub impostor field, `shrubfield.js`, in the manner
of the fifth and sixth passes):

| species | outline | wood seen at the base | leaf picture | seasons on the card |
|---|---|---|---|---|
| toyon | a big rounded dome (W/H 1.0-1.5), lumpy in 4-6 sub-crowns, nearly to the ground; old plants a small tree with a short trunk | 3-6 smooth grey stems, lichen-spotted, under the dome only on old plants | dark glossy elliptic leaves 5-10 cm in rosettes at the shoot ends, a bright glint, a few yellow-red old leaves | cream flat flower clusters on the top in June; red berry clusters in bunches on the outer crown November-January (the one red shrub in a green winter woodland) |
| western redbud | a vase: narrow at the base, broad, uneven flat-ish top; open | many straight grey-brown stems fanning from one point, red-brown zig-zag twigs | round heart-shaped leaves, flat, blue-green, overlapping like scales | magenta-pink covering the bare twigs (March to mid-April); bronze-green new leaves; orange, yellow and red-brown in fall; bare grey twigs with hanging brown pods in winter |
| poison oak | tall and loose (W/H 0.6-1.0), ragged top, sky through it; colonies merge into a low tangle | 3-7 thin grey-brown leaning stems, bare in the lowest fifth | leaves of three, lobed like small oak leaves, glossy | red-tinged in March, bright glossy green, scarlet and orange from September (the brightest red in the woodland), bare grey stems November-February. Its vine form up oak trunks belongs on the oaks, not in the field |
| coyote brush | a dense round mound (W/H 1.2-1.6), fine-textured, edge of many small twig tips | rarely seen; on old plants grey dead stems in an open centre | tiny (1-4 cm) toothed bright green leaves crowded on upright twigs: a fine, slightly glossy texture like a coarse moss | brightest green in spring; dusty olive in late summer; cream flecks September-December, and on half the plants (the females) a white fluffy haze in November-December |
| blue elderberry | a broad, irregular dome wider than tall, arching branches drooping at the edge, gappy | several pale grey-brown corky stems leaning out, grey dead canes inside | long feather-compound leaves (5-9 narrow leaflets), yellow-green to grey-green, a soft, drooping texture | flat cream plates 10-30 cm across on the top April-June; powder-blue berry clusters July-September; yellowing and thinning in fall; bare pale stems December-February |
| coffeeberry | a dense rounded dome, wider than tall, smooth outline | smooth grey stems, reddish twigs, seldom seen | narrow oval leaves 3-8 cm, dull grey-green with pale undersides (hoary form), finer than toyon's | evergreen; red and black berries mixed on the outer crown August-November |

**Known limits and uncertain points.**
- Crown bases come out 0.15-0.30 against photo targets of 0.05-0.2 (manzanita and chamise also read 0.19): limbs
  start a little way up the stems. Toyon and coffeeberry read a little narrow, elderberry a little wide.
- The mid tier is much more open than the near tier for elderberry (0.65 against 0.26) and redbud (0.47 against
  0.24); raising `lod.mid_cards` did not change it, so it is the far card's texture for large compound and
  heart-shaped leaves. Worth a look in the generator.
- Poison oak's vine form, the commonest way people meet it under the oaks, is not drawn (an epiphyte on oak trunks,
  like the mistletoe, would do it).
- Redbud's bare winter crown (`winter_twigs` 0.4 with pods) still reads as reddish-brown clumps at the lineup's
  distance rather than a fine grey twig haze; its flowers render a dusty magenta, darker than in the photographs.
- Coffeeberry: which subspecies dominates near Placerville (the grey hoary ssp. *tomentella* or the greener
  ssp. *californica*) needs a local answer; the leaf shape `elliptic_glossy` is too shiny for the hoary form.
  `berries.rgb_unripe` (red) documents the red stage and is not read by the generator.
- Architectural models are provisional for all six (Troll for redbud and Champagnat for elderberry are guesses).
- Fall targets (`fall_rg`) for poison oak and elderberry are rough: no clean full-shrub fall photograph was measured.

## Integration of the foothill set (2026-10-26)

The seventeen drafts are registered (`index.json`, 26 species, embedded by `embed_builtin.py`), placed by the
species mix on all three tiles, and the six shrubs are in the shrub impostor field. Aliases (from the files):
buckeye, madrone, walnut, bay, maple, ash, valley_oak, canyon_live_oak, black_oak, incense_cedar, douglas_fir,
toyon, redbud, poison_oak, coyote_brush, elderberry, coffeeberry (`walnut` and `maple` added to the files).
Valley, canyon live and black oak bear acorns: `OAK_SHORT` in `vegetation.js` names them, so the acorn game
finds them (home tile, start view: 547 valley, 795 canyon live and 569 black oaks among the game's oaks). The
field guide (`fieldguide.js` `ACORNS`) had no card for them at first; it has since 2026-10-26 (below).

**Fixes to the files** (targets and photos unchanged):

| species | change | why |
|---|---|---|
| valley oak | `leaf_shape` `lobed_large`, 9 pinnate lobes, `lobe_tip` round (was `oblong_wavy` with `lobe_depth`, which that shape ignores); `cluster_m` 1.9 to 2.15 | the generator lane's note; the larger lobed leaf opened the crown (gaps 0.32), larger cards close it again |
| canyon live oak | `cluster_m` 1.6 to 1.9 | gaps 0.20 against 0.12 (raising `leaf_fill` to 3.6 changed nothing: the gaps are between cards, not within them) |
| black oak | `cards_per_m2` 0.75 to 0.55 | gaps 0.21 against 0.30 |
| incense cedar | `cluster_m` 1.6 to 1.95 | gaps 0.23 against 0.15 (`leaf_fill` 7.5 changed nothing) |
| Douglas-fir | `density` 14 to 18, `near_tris_budget` 2,600 to 3,000; `lod.mid_canopy` `blobs` (12 blobs, scale 0.55) | near gaps 0.38 against 0.30; the mid tier drew nearly empty cards (gaps 0.77): the `needle_flat` far card is 14 short combs at the 5 px minimum needle length, whatever the file says, so the mid tier uses lumpy blobs instead (gaps 0.22); a fuller far card belongs in `treegen.js` |
| redbud | `levels[0].start` 0.22 to 0.12, `foliage.start` 0.3 to 0.15, `parent_start` 0.5 to 0.35 | crown base 0.30 against 0.20 |
| coffeeberry | `foliage.start` 0 and `parent_start` 0.05; `berries.rgb` a dark red between the ripe black and the red (`rgb_unripe`, which the generator does not read, removed); `near_sides` [3, 3, 0] and `near_tris_budget` 1,200 | W/H 1.29 to 1.37 (base unchanged); the old class's wood took over 70% of the budget and warned in the console |
| toyon | `berries.density` 0.8 to 0.45 | at close range the whole crown read red |
| all seventeen | the mature class grows one seed instead of two | draw calls: each distinct tree is four meshes (near and mid trunk and canopy) for every species a tile places |

**Final lineup** (near tier, the three measured seeds, real leaf shapes and bark, summer; photo target in
brackets; ! outside the lineup's tolerance; mid and close gaps for the other tiers):

| species | W/H | crown base | gaps | r/g | b/g | near triangles | mid gaps | close gaps |
|---|---|---|---|---|---|---|---|---|
| valley oak | 1.35 (1.35) | 0.11 (0.10) | 0.29 (0.23) | 0.97 (1.00) | 0.62 (0.64) | 2,188-3,126 | 0.20 | 0.32 |
| canyon live oak | 1.26 (1.35) | 0.16 (0.12) | 0.17 (0.12) | 0.96 (0.94) | 0.44 (0.45) | 2,000-3,844 | 0.15 | 0.14 |
| California black oak | 0.84 (0.92) | 0.24 (0.21) | 0.24 (0.30) | 0.88 (0.87) | 0.61 (0.62) | 1,164-1,290 | 0.34 | 0.29 |
| California buckeye (mid-July) | 1.46 (1.45) | 0.13 (0.05) ! | 0.14 (0.18) | 0.82 (0.80) | 0.36 (0.36) | 1,048-1,514 | 0.25 | 0.16 |
| Pacific madrone | 0.89 (0.90) | 0.30 (0.30) | 0.29 (0.28) | 0.87 (0.88) | 0.70 (0.69) | 1,602-2,612 | 0.39 | 0.29 |
| California bay | 1.09 (1.00) | 0.15 (0.10) | 0.25 (0.25) | 0.94 (0.94) | 0.52 (0.50) | 2,134-2,428 | 0.46 | 0.30 |
| black walnut | 1.11 (1.15) | 0.19 (0.13) | 0.29 (0.34) | 0.78 (0.78) | 0.49 (0.49) | 1,168-1,276 | 0.44 | 0.36 |
| big-leaf maple | 1.00 (0.90) | 0.21 (0.15) | 0.21 (0.25) | 0.88 (0.88) | 0.51 (0.50) | 1,658-1,908 | 0.46 | 0.29 |
| Oregon ash | 0.66 (0.70) | 0.31 (0.25) | 0.29 (0.33) | 0.80 (0.80) | 0.42 (0.42) | 1,754-1,900 | 0.40 | 0.40 |
| incense cedar | 0.42 (0.42) | 0.13 (0.14) | 0.18 (0.15) | 0.92 (0.92) | 0.39 (0.42) | 2,200-2,690 | 0.02 | 0.29 |
| Douglas-fir | 0.48 (0.50) | 0.26 (0.30) | 0.34 (0.30) | 0.91 (0.91) | 0.60 (0.61) | 1,860-3,000 | 0.22 | 0.62 |
| toyon | 0.96 (1.10) | 0.15 (0.10) | 0.12 (0.15) | 0.92 (0.86) ! | 0.58 (0.58) | 774-858 | 0.28 | 0.07 |
| western redbud | 0.99 (1.00) | 0.24 (0.20) | 0.24 (0.25) | 0.82 (0.83) | 0.58 (0.61) | 658-962 | 0.45 | 0.30 |
| poison oak | 0.74 (0.80) | 0.15 (0.15) | 0.29 (0.35) | 0.76 (0.75) | 0.43 (0.47) | 364-442 | 0.36 | 0.37 |
| coyote brush | 1.24 (1.20) | 0.16 (0.05) ! | 0.20 (0.20) | 0.95 (0.95) | 0.46 (0.48) | 654-1,006 | 0.30 | 0.19 |
| blue elderberry | 1.48 (1.40) | 0.20 (0.08) ! | 0.26 (0.22) | 0.87 (0.86) | 0.63 (0.56) ! | 922-1,164 | 0.65 | 0.22 |
| coffeeberry | 1.37 (1.40) | 0.18 (0.08) ! | 0.12 (0.18) | 0.98 (0.98) | 0.65 (0.70) | 664-1,070 | 0.24 | 0.15 |

Twelve of seventeen sit within every tolerance. The misses: crown base on buckeye, coyote brush, elderberry
and coffeeberry (the lowest cards hang from limbs a little way up the stems; lowering `foliage.start` and the
first limbs moved coffeeberry's W/H but not its base, and raised elderberry's to 0.27, so it was put back;
manzanita and chamise read 0.19 for the same reason); toyon's r/g (0.88 without its cream flowers, which the
lineup's summer, mid-July, shows) and elderberry's b/g (0.50 without the powder-blue berries of July). The set B
numbers against the real leaf shapes and bark came out within 0.02 of the stand-in measurements: the measures
are set by the card layout, not the leaf texture. Every class and snag of all seventeen builds at near, mid and
close without errors. Mid gaps of the set A broadleaves and elderberry run 0.40-0.65 (more `mid_cards` did
not help: the far cards for large compound and lobed leaves are sparse; a generator matter).

**Species mix.** Each community row now also follows the ground (`pipeline/species_mix.py` `TERRAIN`): every
30 m cell gets a terrain class from the DEM, an effective elevation band (mean elevation, plus 100 m on
north-facing and minus 50 m on south-facing ground: <450, 450-525, 525-600, >=600 m), a position (floor: under
6 degrees and 2 m or more below its 330 m neighbourhood; steep: 16 degrees or more; else mid-slope) and
north-facing or not, and a species' weight is multiplied by its factors for that class: valley oak x2.5 on
floors, x0.15 on steep ground, fading above 525 m; canyon live oak x3 on steep ground, x1.6 north; black oak
x0.1 below 450 m effective up to x1 above 600 m (not in the black-oak communities, which LANDFIRE names for
it); incense cedar and Douglas-fir likewise from about 525 m, Douglas-fir x2 north and x0.12 elsewhere; madrone
and bay x2.2 north and x0.3 elsewhere; buckeye and redbud up on steep ground; coyote brush, elderberry and
poison oak up on floors. A community has one row per distinct response (`mixes[].terrain` lists its classes,
`mixes[].community` points into the new `communities[]`, which holds the weights as written): 424, 429 and 326
rows on the three tiles, so `species_mix_index.png` is now two bytes (RGB); `species_mix.json` 262 KB (one row
per line). The nine original species keep their weights; the new ones are added beside them (black oak leads
the black-oak communities, valley oak takes blue oak's stand-in share in the riparian rows and the mixed-oak
savanna, canyon live oak, madrone, bay and Douglas-fir take live oak's and ponderosa's in the mixed evergreen
row). Rules (trees | shrubs | tree / shrub density):

| rule | trees | shrubs | densities |
|---|---|---|---|
| `wet_meadow_marsh` | willow 0.8, live oak 0.2, valley oak 0.1 | manzanita 0.5, elderberry 0.25, coyote brush 0.25 | 0.05 / 0.05 |
| `riparian_shrubland` | willow 0.75, alder 0.1, live oak 0.15, ash 0.05 | manzanita 0.5, chamise 0.5, elderberry 0.45, poison oak 0.45, coffeeberry 0.1 | 1.2 / 0.2 |
| `montane_riparian` | alder 0.4, willow 0.25, live oak 0.15, ponderosa 0.12, cottonwood 0.08, maple 0.12, ash 0.06, walnut 0.02, bay 0.04, incense cedar 0.05, douglas fir 0.04 | manzanita 1, elderberry 0.5, poison oak 0.6 | 1.3 / 0.3 |
| `riparian` | willow 0.38, alder 0.24, cottonwood 0.1, live oak 0.17, blue oak 0.03, valley oak 0.12, walnut 0.06, maple 0.05, ash 0.07, bay 0.03, buckeye 0.02 | manzanita 0.3, elderberry 0.5, poison oak 0.7, coffeeberry 0.1, coyote brush 0.1 | 1.6 / 0.3 |
| `blue_oak_foothill_pine` | blue oak 0.65, live oak 0.1, gray pine 0.25, valley oak 0.07, buckeye 0.04, canyon live oak 0.02, black oak 0.01 | manzanita 0.5, chamise 0.5, poison oak 0.3, toyon 0.12, coffeeberry 0.1, redbud 0.05, coyote brush 0.08 | 1 / 0.5 |
| `blue_oak` | blue oak 0.85, live oak 0.1, gray pine 0.05, valley oak 0.06, buckeye 0.05, canyon live oak 0.02 | manzanita 0.4, chamise 0.6, poison oak 0.3, toyon 0.1, coffeeberry 0.08, redbud 0.04, coyote brush 0.06 | 1 / 0.4 |
| `foothill_pine` | gray pine 0.6, blue oak 0.25, live oak 0.15, buckeye 0.04, canyon live oak 0.03 | manzanita 0.4, chamise 0.6, toyon 0.12, coffeeberry 0.1, redbud 0.06, poison oak 0.15 | 0.9 / 1 |
| `black_oak_conifer` | black oak 0.45, ponderosa 0.4, live oak 0.12, gray pine 0.02, incense cedar 0.12, douglas fir 0.08, madrone 0.04, canyon live oak 0.03 | manzanita 0.8, chamise 0.2, toyon 0.1, poison oak 0.25, coffeeberry 0.15, redbud 0.03 | 1.1 / 0.6 |
| `black_oak` | black oak 0.6, live oak 0.15, ponderosa 0.15, madrone 0.04, bay 0.02, canyon live oak 0.03, incense cedar 0.03 | manzanita 0.9, chamise 0.1, poison oak 0.3, toyon 0.1, coffeeberry 0.15 | 1 / 0.5 |
| `mixed_oak_savanna` | blue oak 0.45, live oak 0.3, gray pine 0.05, valley oak 0.25, buckeye 0.03 | manzanita 0.3, chamise 0.7, coyote brush 0.2, poison oak 0.2, toyon 0.05 | 0.6 / 0.3 |
| `mixed_oak` | blue oak 0.4, live oak 0.45, gray pine 0.15, valley oak 0.05, canyon live oak 0.06, buckeye 0.05, black oak 0.08, madrone 0.03, bay 0.02 | manzanita 0.6, chamise 0.4, toyon 0.15, poison oak 0.35, coffeeberry 0.15, redbud 0.06 | 1 / 0.6 |
| `mixed_evergreen` | canyon live oak 0.25, live oak 0.25, madrone 0.15, bay 0.1, douglas fir 0.1, ponderosa 0.2, black oak 0.1, incense cedar 0.05 | manzanita 1, toyon 0.3, poison oak 0.3, coffeeberry 0.3 | 1.2 / 0.5 |
| `ponderosa_jeffrey` | ponderosa 0.9, live oak 0.1, black oak 0.1, incense cedar 0.06 | manzanita 0.9, chamise 0.1, coffeeberry 0.05 | 0.8 / 0.8 |
| `dry_mesic_mixed_conifer` | ponderosa 0.5, live oak 0.1, black oak 0.2, incense cedar 0.15, douglas fir 0.08, canyon live oak 0.03, madrone 0.02 | manzanita 1, toyon 0.05, poison oak 0.1, coffeeberry 0.1 | 1 / 0.6 |
| `mesic_mixed_conifer` | ponderosa 0.4, incense cedar 0.2, douglas fir 0.2, black oak 0.12, live oak 0.06, madrone 0.03, bay 0.02 | manzanita 1, poison oak 0.1, coffeeberry 0.1 | 1.2 / 0.4 |
| `lower_montane_conifer` | ponderosa 0.58, live oak 0.1, gray pine 0.1, black oak 0.14, incense cedar 0.08, douglas fir 0.05, canyon live oak 0.03, madrone 0.02, bay 0.02 | manzanita 0.85, chamise 0.15, toyon 0.08, coffeeberry 0.1, poison oak 0.12, redbud 0.03 | 1 / 0.6 |
| `montane_woodland_chaparral` | live oak 0.3, ponderosa 0.25, gray pine 0.15, canyon live oak 0.15, black oak 0.1 | manzanita 0.8, chamise 0.2, toyon 0.1, coffeeberry 0.1, redbud 0.05 | 0.6 / 1 |
| `serpentine_woodland` | gray pine 0.6, live oak 0.4, buckeye 0.03 | manzanita 0.6, chamise 0.4, coffeeberry 0.1, redbud 0.05, toyon 0.05 | 0.6 / 1 |
| `xeric_chaparral` | gray pine 0.7, live oak 0.3 | chamise 0.8, manzanita 0.2, toyon 0.03, redbud 0.03 | 0.15 / 1 |
| `dry_mesic_chaparral` | gray pine 0.6, live oak 0.4, canyon live oak 0.05, buckeye 0.03 | chamise 0.65, manzanita 0.35, toyon 0.1, coffeeberry 0.08, redbud 0.05, poison oak 0.04 | 0.3 / 1 |
| `mesic_chaparral` | live oak 0.6, gray pine 0.4, canyon live oak 0.1, bay 0.03, madrone 0.03 | manzanita 0.6, chamise 0.4, toyon 0.2, coffeeberry 0.15, redbud 0.05, poison oak 0.05 | 0.35 / 1 |
| `chaparral` | gray pine 0.6, live oak 0.4 | chamise 0.6, manzanita 0.4, toyon 0.08, coffeeberry 0.06, redbud 0.04 | 0.3 / 1 |
| `ruderal_forest` | live oak 0.4, blue oak 0.25, gray pine 0.2, ponderosa 0.15, valley oak 0.05, black oak 0.05, buckeye 0.03, walnut 0.03 | manzanita 0.5, chamise 0.5, coyote brush 0.3, poison oak 0.3, toyon 0.08, elderberry 0.05 | 0.8 / 0.8 |
| `ruderal_scrub` | gray pine 0.5, live oak 0.5 | chamise 0.5, manzanita 0.5, coyote brush 0.6, poison oak 0.2, toyon 0.05 | 0.2 / 0.8 |
| `great_basin_shrub` | gray pine 1 | chamise 1, coyote brush 0.3 | 0 / 0.6 |
| `grassland_savanna` | blue oak 0.85, gray pine 0.15, valley oak 0.1, buckeye 0.02 | chamise 1, coyote brush 0.6, poison oak 0.1 | 1 / 0.3 |
| `sparse_rock` | gray pine 0.5, live oak 0.5, canyon live oak 0.4 | chamise 0.6, manzanita 0.4, redbud 0.2, toyon 0.1 | 0.25 / 0.3 |
| `rewilded_meadow` | blue oak 0.55, valley oak 0.35, live oak 0.1 | - | 0.5 / 0 |
| `rewilded_riparian` | willow 0.45, alder 0.25, cottonwood 0.12, live oak 0.18, valley oak 0.06, ash 0.05, maple 0.03, walnut 0.02 | - | 2 / 0 |

Tree shares (each layer of the whole tile; shrubs below):

| tile | trees | shrubs |
|---|---|---|
| home 680_4280 | blue oak 38.3%, gray pine 21.6, live oak 14.4, ponderosa 8.2, valley oak 4.0, buckeye 2.6, willow 2.4, canyon live oak 2.2, alder 1.8, black oak 1.3, cottonwood 0.6, bay 0.5, walnut 0.5, maple 0.4, madrone 0.4, ash 0.4, incense cedar 0.3, Douglas-fir 0.1 | chamise 33.4, manzanita 31.1, poison oak 12.7, toyon 6.9, coyote brush 6.8, coffeeberry 5.1, redbud 3.1, elderberry 1.0 |
| Placerville 690_4280 | ponderosa 26.9, blue oak 20.8, gray pine 12.7, live oak 12.3, black oak 9.9, canyon live oak 3.9, incense cedar 3.6, Douglas-fir 1.9, madrone 1.4, willow 1.4, alder 1.2, buckeye 1.1, bay 1.0, valley oak 0.7, cottonwood 0.4, maple 0.3, ash 0.3, walnut 0.2 | manzanita 47.2, chamise 21.0, poison oak 11.8, toyon 7.1, coffeeberry 6.9, redbud 3.4, coyote brush 2.1, elderberry 0.5 |
| Cosumnes 680_4270 | blue oak 36.0, gray pine 21.7, ponderosa 14.5, live oak 13.5, valley oak 3.1, canyon live oak 2.9, buckeye 2.8, willow 1.2, black oak 1.1, alder 0.8, bay 0.6, walnut 0.5, madrone 0.4, cottonwood 0.3, ash 0.2, maple 0.2, incense cedar 0.2, Douglas-fir 0.1 | chamise 35.1, manzanita 31.3, poison oak 10.3, coyote brush 7.7, toyon 6.8, coffeeberry 4.6, redbud 3.6, elderberry 0.7 |

Where they stand on the home tile (share of the species' trees, against the share of the ground): valley oak
35% on floors (11% of the ground), 52% below 450 m; canyon live oak 63% on steep ground (15%), 60% north-facing
(23%); black oak 49% at 525 m or more effective elevation (24%), 56% north-facing; Douglas-fir 98% north-facing,
78% at 525 m or more; madrone 83% north-facing. On the Placerville tile black oak is 87% at 600 m or more.

**Client.** Each tile places all 26 species (`tileSpecies`). The far atlas sits at its cap on every tile: 64
baked trees, 1280 x 4096, 53.3 MB with mips (bake 0.9-1.1 s); blue oak, live oak, gray pine and ponderosa keep
12 slots each (and black oak on the Placerville tile), every other species 2. Start view of the home tile
(1920 x 1080, headless Chromium on Metal, A/B against HEAD's code, library and mix, three rounds each): draw
calls 239 to 417 (each extra species adds up to four meshes per distinct tree; 461 before the mature classes
went to one seed), triangles 5.72 M to 5.87 M, CPU per frame 2.5-2.9 ms to 4.0-4.9 ms (all of it in
`renderer.render`: about 8 microseconds a draw call), GPU 17.7-19.0 ms against 15.7-18.6 ms (within the noise
of the timer queries; the frame is GPU-bound), shrub impostors 1,180 to 2,243.

**The shrub impostor field** (`shrubfield.js`) draws the six shrubs as kinds -1 to -6 of the same impostor, in
the manner of the shrub lane's card notes: toyon a big lumpy dome, redbud a vase, poison oak small, ragged and
open, coyote brush a smooth fine mound, elderberry broad and gappy, coffeeberry a smooth dense dome; each
season's leaf colour, bark and twig colour, leaf-on (`leafOnAt`) and flowers or berries (`decoActive`) come
from the species files through uniforms set when the season (or the real date's month) changes. A bare crown
is a haze of twigs (far) or the bare stems (near); flowers and berries are clusters over the outer, upper
crown that stay on a bare crown, so redbud is magenta on bare wood in March and toyon carries red berries
from November to January. The canopy layer gives woodland, grassland and riparian cells almost no shrub
cover, so the six are placed from each cell's row (their share of its shrub weights) at an understory cover
per habitat class (oak woodland 14%, mixed 12%, conifer 8%, riparian 18%, grassland 3%, times the row's shrub
density, in patches), and in chaparral at 0.8 of the field's own cover times their share, from their own random
stream merged into the cell's list by rank: chamise and manzanita stand and draw exactly as before. Their kinds
are negative because `shadows.js` casts every kind over 1.5 as grass, with a grass blade's sway (0.35 H): with
kinds 5-10 (the first try) a toyon's shadow swung a metre or more across its neighbours in the wind, and since a
shrub impostor takes the cast shadow at its centre, a manzanita beside a toyon switched between lit and shaded
from one second to the next with the camera still (measured at x=3830 north=1180, 12 m, fall, 9:00: the plant's
mean went 88 to 45 and back; with negative kinds it holds at 26 over 8 s, and the frame-to-frame difference is
grain at the leaf edges, as on HEAD).

**Seen in the world** (home tile, headless, the real date set with the browser clock): buckeye bare in August
and in full leaf in May (the white candles do not show at 7-15 m); madrone's red-orange trunks at 5 m; a black
oak yellow-orange in October at 631 m (x=9962 north=8797, the tile's east edge; the spot at x=2958 north=9835
is 407 m in the conifer stand, where black oak is rare on south slopes); valley oaks yellow-brown over a grassy
floor; toyon with red berries in January (3D and impostor); poison oak scarlet in October (3D in the chaparral,
impostors in the woodland); redbud magenta on bare stems in March (3D and impostor); big-leaf maple gold and
walnut yellowing in a riparian corridor in October. Species cards read correctly for all seventeen (the form
line shows toyon's and elderberry's form as `multi_stem_shrub_tree`). No console errors but the favicon 404
HEAD also has.

**Known limits.**
- Douglas-fir's mid tier is blobs until the `needle_flat` far card is fuller; the set A broadleaves are open at mid.
- Buckeye's flower candles and elderberry's flower plates barely show on the 3D trees; the impostors show them.
  (Fixed 2026-10-26, below.)
- The six shrubs in woodland and grassland exist only as impostors (no 3D plants there, since the canopy layer's
  shrub cover is about zero), so they cannot be clicked for a card; in chaparral they are 3D as well.
- 26 species cost about 1.4 ms of CPU at the start view in draw calls; vegetation could share meshes between a
  rare species' classes (as the far atlas does) to bring it back.
- `docs/tile-spec.md` "Species mix" does not yet describe `mixes[].terrain`, `community` and `communities[]`.
  (Done 2026-10-26.)

## Polish of the foothill set (2026-10-26)

**Crown base.** Buckeye, coyote brush, elderberry and coffeeberry measured 0.13, 0.16, 0.20 and 0.18 against
0.05, 0.05, 0.08 and 0.08. Two causes. Elderberry, coffeeberry and coyote brush had a bare skirt: the first limbs
left the stems a fifth of the way up and the clumps sat at the limb tips. Buckeye's foliage already reached
the ground: its 0.13 came from cards and drooping limbs that reach up to a fifth of the tree's height below
y = 0. The lineup measures from the lowest pixel, so a card under the ground lowers the plant's bottom and
raises its crown base; in the world the terrain hides those cards. The same measure from the ground line (the
lineup's silhouettes, counting only what is above y = 0, which is what the world shows) read buckeye 0.06,
coyote brush 0.13, coffeeberry 0.16 and elderberry 0.19 before.

The files now spread the stems wider and branch them lower, with the clumps along the limbs rather than at
their tips. The values come from a search of 40-60 random variants per species (stems, limb angles and
counts, foliage `start`, clumps, the envelope's base width), measured on the lineup's three seeds, then
checked on the lineup itself:

| species | changes | lineup W/H, base, gaps (target) | base above the ground |
|---|---|---|---|
| buckeye | level-1 `count` 9 to 12, level-2 `start` 0.15 to 0.12, `base_size` 0.05 to 0.03, `stem_spread_deg` 28 to 29; clumps `radius_m` 0.8 to 0.66, `tip_bias` 1.4 to 0.89 | 1.46 to 1.50 (1.45), 0.13 to 0.11 (0.05), 0.14 to 0.11 (0.18) | 0.06 to 0.05 |
| coyote brush | `stem_spread_deg` 38 to 54, `base_size` 0.05 to 0.04, first limbs 48±14 to 51±8 degrees, `droop_deg` 3, `tropism` 0.08 to 0.05; foliage `start` 0.05 to 0.01, `parent_start` 0.01, `cluster_m` 0.36 to 0.34, `cards_per_m2` 12 to 13.5; clumps `radius_m` 0.3 to 0.25, `shell` 0.45 to 0.02, `tip_bias` 1.3 to 0.7; envelope base 0.4 to 0.42 | 1.24 to 1.22 (1.2), 0.16 to 0.11 (0.05), 0.20 to 0.20 (0.2) | 0.13 to 0.07 |
| elderberry | `stem_spread_deg` 32 to 62, first limbs 62 to 55 degrees, level-2 `start` 0.3 to 0.22; foliage `start` 0.15 to 0.02, `parent_start` 0.35 to 0.18; clumps `radius_m` 0.55 to 0.49, `tip_bias` 1.2 to 0.6; envelope base 0.5 to 0.66 | 1.48 to 1.48 (1.4), 0.20 to 0.13 (0.08), 0.26 to 0.25 (0.22) | 0.19 to 0.07 |
| coffeeberry | `stem_spread_deg` 42 to 58, `base_size` 0.05 to 0.02, first limbs 38±14 to 39±8 degrees, `droop_deg` 3, `tropism` 0.05 to 0.08; foliage `parent_start` 0.05 to 0.03, `cluster_m` 0.5 to 0.47, `cards_per_m2` 5.5 to 6.2; clumps `radius_m` 0.38 to 0.32, `shell` 0.45 to 0.02, `flatten` 0.8 to 0.74, `tip_bias` 1.3 to 0.6; envelope base 0.54 to 0.56 | 1.37 to 1.42 (1.4), 0.18 to 0.12 (0.08), 0.12 to 0.18 (0.18) | 0.16 to 0.08 |

All four are within the lineup's tolerance now (base within 0.07 of the target), and r/g and b/g did not move
(elderberry's b/g stays 0.63 against 0.56: the July berries). Mid and close tiers, base before and after:
buckeye 0.15 to 0.12 and 0.14 to 0.15, coyote brush 0.13 to 0.13 and 0.19 to 0.11, elderberry 0.27 to 0.12 and
0.20 to 0.14, coffeeberry 0.13 to 0.11 and 0.19 to 0.12. Near triangles: buckeye 822-1,642 (was 1,048-1,514),
coyote brush 708-1,068 (654-1,006), elderberry 984-1,180 (922-1,164), coffeeberry 718-1,154 (664-1,070).
No variant tried brought the lineup's base much below 0.11: a card hangs half its size below its clump
centre, so clumps near the ground put some cards under it. The variants also scatter by plus or minus 0.02
between seeds (a change of `cards_per_m2` alone moved buckeye between 0.11 and 0.15), so these are good draws
in a noisy measure. Closing the rest of the gap belongs in the generator (keep cards above the ground at the
base of a crown) or in the lineup (measure from the ground line), not in the files.

**Flowers.** With `density` a card got its flowers at its twig ends. The close tier, which the world draws
within about 90 m, has smaller cards with few twig ends, mostly at the card's edge. So buckeye's close card
had three candles, two cut off by the card's edge, and elderberry's close card often had none. Elderberry
showed no flowers at 10 m in June, and buckeye's candles were small specks. New opt-in `per_card` (table
above) sets a number of heads per card, whole and apart; candles are now spikes (full to two thirds of their
length) and `width` sets their girth. Buckeye: `per_card` 8, `size_m` 0.15 to 0.17, `width` 0.17. Elderberry:
`per_card` 5. That is about 3 candles on a buckeye close card, 8 near and 32 mid, and 2, 5 and 20 elderberry
plates. Every other species' flower and berry textures are bit-identical to before (all seasons, months,
scales and the bare-crown texture compared against HEAD's generator). The colour is unchanged: a buckeye
candle reads cream rather than white, because its blue needs 15x the spring leaf's and the texture holds 8x
(raising that would coarsen every leaf of the card). Seen in the world (home tile, headless, the browser clock
set to 12 May and 14 June): buckeye at 10 m and 40 m covered in cream spikes; elderberry's plates plain at
10 m and 40 m, where before there were none. The cards' roll turns some candles sideways.

**Field guide.** Acorn cards for valley oak (big and long, 3-5 cm, deep knobbly cap, ripens in one summer),
canyon live oak (plump, 2-4 cm, thick turban cap with golden fuzz, two years) and black oak (long and blunt,
about 3 cm, deep thin-scaled cap hiding up to half the nut, two years), each with its own drawing
(`fieldguide.js` `ACORN_LOOK`; blue oak and interior live oak draw exactly as before). Their species cards now
show the acorn line and the field-guide button.

**Species card.** The form line shows plain words (`identify.js` `FORM_WORD`): toyon and elderberry read
"multi-stemmed shrub or small tree".

## Grasses, herbs and shrubs of the foothill understory (2026-10-29)

Aaron: "Can we add more grass and shrub and herb species - especially for terrestrial animals." The library gains
two ground-layer forms beside `tree`, `shrub` and `multi_stem_shrub_tree`: **`grass`** (drawn by `grass.js` as a
blade clump of its type, coloured and sized from the file) and **`forb`** (drawn by `forbs.js` as a small plant card:
leaves and, in its months, flowers, baked from the file at load). Neither is grown by the tree generator, so a grass or
forb file has no `trunk`, `levels` or `foliage`; `vegetation.js`, the far atlas and the lineup skip any species whose
form is not a tree or shrub. Every record is CC BY-SA 4.0, `status` "agent draft, needs local sign-off", with
`sources` read and `notes` in the author's own words, as the trees. Nothing is downloaded: the plants are procedural.

Common fields (all forms): `id`, `aliases`, `scientific`, `common`, `form`, `description` (two sentences for the card),
`season_notes`, `status`, `notes`, `sources`, `authors`, `license`, and the two blocks below, which the trees and shrubs
now carry too.

`habitat` (where it belongs; the pipeline's species mix reads it, `pipeline/species_mix.py` GROUND):

| field | meaning |
|---|---|
| `classes` | relative weight per habitat class name: `grassland`, `oak_woodland`, `chaparral`, `mixed_forest`, `conifer_forest`, `riparian` (0 or absent: not there) |
| `floor`, `mid`, `steep` | terrain position factors (valley floors and swales; mid-slopes; 16 degrees and over), default 1 |
| `north` | factor on north-facing ground (default 1): shade and moisture lovers above 1, sun lovers below |
| `shade` | 0 (open sun) to 1 (under the canopy): the client places it by the cell's tree cover |
| `disturbed` | factor on road verges and old fields (default 1): the weeds and pioneers above 1 |

`relations` (the animals; `pipeline/games.py` writes them into each tile's `games.json` `relations.forage` and
`relations.cover`, and `needs.js` names the plant under the body when "food here" is one of its foods):

| field | meaning |
|---|---|
| `eaten_by` | `[{ animal: <animal id>, part: leaves / seeds / flowers / browse / berries / bulbs / roots / acorns, seasons: [...] }]` |
| `cover_for` | animal ids that hide, nest or form in it (quail coveys, rabbits, towhees) |

`ground` for `form: "grass"` (the renderer's parameters, `grass.js` GRASS_SPECIES):

| field | meaning |
|---|---|
| `type` | `annual` (a soft, leafy tuft that cures gold: the bromes, wild oats, barley) or `bunch` (a perennial tussock: needlegrass, wildrye, oatgrass); the blade clump the renderer grows |
| `height` | times the type's clump height (the annual clump is about 0.45 m at full height, the bunch 0.6 m) |
| `width` | times the clump's spread |
| `palette` | per season (`winter`, `spring`, `summer`, `fall`): `root`, `tip`, `head`, `awn` sRGB 0-255, the blade from its base to its tip, the seed head and the awns; summer and fall are the cured colours |
| `heads` | `{ shape, months: [from, to] }`: `panicle` (open, nodding: oats, ripgut), `spike` (a dense head: barley, wildrye), `raceme` (needlegrass's loose, awned); drawn while the month is in range, else the blades alone |
| `cure` | 0-1, how fully it dries to straw in summer (annuals 1; needlegrass 0.5 stays grey-green at the base) |

`ground` for `form: "forb"` (`forbs.js` bakes one picture per species per month from it):

| field | meaning |
|---|---|
| `habit` | `rosette` (leaves flat on the ground, a stalk up: filaree, soap plant), `erect` (a stem with leaves and a flower on top: poppy, fiddleneck, tarweed), `mound` (a leafy clump: lupine, yarrow, mule's ears), `sprawling` (clover, miner's lettuce), `climbing` (vetch, over the grass), `bulb` (a few grass-like leaves and a bare stalk: blue dicks) |
| `leaf` | `{ shape, size_m, rgb }`: `ferny` (poppy, yarrow, filaree), `palmate` (lupine), `trifoliate` (clover), `round` (miner's lettuce), `strap` (soap plant), `ovate` (mule's ears, big and grey), `pinnate` (vetch), `linear` (blue dicks, popcorn flower, tarweed), `lobed` |
| `flower` | `{ shape, rgb, size_m, months: [from, to], per_plant }`: `cup` (poppy), `spike` (lupine, fiddleneck's coil as `coil`), `umbel` (yarrow's flat plate), `ball` (blue dicks, clover), `daisy` (mule's ears, tarweed), `pea` (vetch), `tiny` (popcorn flower, filaree, miner's lettuce) |
| `height_by_month` | 12 values, 0-1: the plant's height this month as a share of `height_m`; 0 is gone (the annuals from July to the rains), so the field reads the calendar |
| `dead_rgb` | the colour of the dried stalks after flowering (shown while `height_by_month` is above 0 after the last flowering month) |
| `density` | relative abundance, 1 the common ones |

Grass species are placed by `grass.js` per plant from the cell's ground mix (`species_mix.json` `ground_bytes`, the
grasses' share of it) in the drifts the needlegrass share already used; forbs by `forbs.js` from the same row, in
patches, at a density from the cell's herb cover (`canopy.png` B) and the season. Both tell the field guide what a
click on them is (`identify.js`): a forb by its card, a grass by the species under the cursor.

**The records (2026-10-29).** Thirty agent drafts, each with `habitat` and `relations`; the eight shrubs of 10-25 gained
the two blocks too. Grasses and herbs have no lineup (nothing grows them); the shrubs build at near, mid and close.

| form | id (common) | habit, size | where | eaten by |
|---|---|---|---|---|
| grass | `stipa_pulchra` (purple needlegrass) | bunch, 0.4-1 m, awns purple in April | grassland, oak savanna | deer, rabbits, vole (leaves); quail, turkey, ground squirrel (seed) |
| grass | `elymus_glaucus` (blue wildrye) | bunch 1.5x, 0.6-1.5 m, a spike | oak woodland edges, north slopes, riparian | deer (leaves); quail, turkey, squirrel (seed) |
| grass | `danthonia_californica` (California oatgrass) | bunch 0.6x, 0.2-0.6 m | meadows, swales, savanna | deer, rabbits, vole |
| grass | `avena_fatua` (wild oat) | annual 1.25x, 0.6-1.3 m, the oat stands | grassland, verges | squirrels, quail, turkey, vole (seed); deer, rabbits (green) |
| grass | `bromus_hordeaceus` (soft chess) | annual 0.75x, 0.2-0.6 m | the annual sward | everything that grazes; seed to quail, squirrels, vole |
| grass | `bromus_diandrus` (ripgut brome) | annual 1.15x, 0.4-1 m, coarse | under the oaks, verges | deer, rabbits when green; squirrel seed |
| grass | `hordeum_murinum` (hare barley) | annual 0.6x, 0.2-0.5 m, bristly red-tinged heads | verges, burrow mounds | rabbits, vole, deer green; squirrel, quail seed |
| forb | `eschscholzia_californica` (California poppy) | mound, ferny, orange cups March-June | open sunny ground, south slopes, verges | deer (a little), quail, squirrel seed |
| forb | `lupinus_bicolor` (miniature lupine) | mound, palmate, blue spikes March-May | grassland, open slopes | deer (a little); quail, squirrel seed |
| forb | `lupinus_albifrons` (silver bush lupine) | mound to 1.5 m, silver, blue spikes, evergreen | rocky slopes, road cuts, chaparral edges | quail, squirrel seed; cover for quail |
| forb | `claytonia_perfoliata` (miner's lettuce) | sprawling, round leaves, Feb-May | shade under oaks, riparian, north slopes | deer, quail, rabbits, vole, squirrel |
| forb | `trifolium_willdenovii` (tomcat clover) | sprawling, trifoliate, purple balls April-May | grassland, moist open ground | deer, rabbits, jackrabbit, vole, squirrel; quail seed |
| forb | `chlorogalum_pomeridianum` (soap plant) | rosette of straps, a 1-2 m stalk May-July | grassland, oak woodland, chaparral openings | bear (bulb), deer (leaves) |
| forb | `achillea_millefolium` (yarrow) | mound, ferny, white plates May-Aug | meadows, open woodland, disturbed | deer, rabbits (a little) |
| forb | `wyethia_helenioides` (gray mule's ears) | mound, big grey leaves, yellow heads March-May | blue oak savanna, north and east slopes | deer (leaves, flowers); squirrel, quail seed |
| forb | `dipterostemon_capitatus` (blue dicks) | bulb, a bare stalk with a purple ball March-May | everywhere open | squirrel, vole, bear (corms); deer, rabbits, jackrabbit |
| forb | `amsinckia_menziesii` (fiddleneck) | erect, bristly, orange coils March-May | grassland, verges, old fields | quail, squirrel, vole seed |
| forb | `erodium_cicutarium` (redstem filaree) | rosette, ferny, pink Feb-May | everywhere; the most eaten plant | deer, rabbits, jackrabbit, squirrel, vole, quail, turkey |
| forb | `vicia_villosa` (hairy vetch) | climbing over the grass, purple pea April-June | grassland, verges, savanna | deer, rabbits, jackrabbit, vole; quail, turkey, squirrel seed |
| forb | `plagiobothrys_nothofulvus` (popcorn flower) | erect, tiny white, sheets March-May | grassland, swales | quail, vole |
| forb | `madia_elegans` (common madia) | erect, sticky, yellow June-Oct | grassland, open slopes | quail, squirrel, vole seed |
| shrub | `arctostaphylos_manzanita` (common manzanita) | 2-6 m, red stems, green oval leaves | chaparral and oak woodland, the lower slopes | bear, fox, coyote, jays, quail (berries); deer (a little) |
| shrub | `ceanothus_cuneatus` (buckbrush) | 1-3 m, rigid, tiny leaves, white March-April | dry chaparral, blue oak slopes | deer (the browse), jackrabbit; cover for quail, rabbits |
| shrub | `ceanothus_integerrimus` (deerbrush) | 1-4 m, open, deciduous, white plumes May-June | the pine and black oak belt above ~525 m | deer; cover for quail |
| shrub | `cercocarpus_betuloides` (mountain mahogany) | 2-6 m, erect, silver seed plumes July-Oct | rocky chaparral, canyon walls | deer (winter browse) |
| shrub | `diplacus_aurantiacus` (sticky monkeyflower) | 0.5-1.5 m, orange April-July | rock, road cuts, chaparral edges | deer (a little); cover for lizards |
| shrub | `rosa_californica` (California wild rose) | 1-2.5 m thicket, pink May-July, red hips into winter | riparian, swales, floors | bear, fox, coyote, quail, turkey, jays (hips); deer, rabbit; cover for quail, rabbits |
| shrub | `symphoricarpos_albus` (snowberry; S. mollis drawn the same) | 0.5-1.5 m, thin stems, white berries Sept-Jan | oak understory, north slopes, riparian edges | deer; quail, turkey (berries); cover for quail, rabbits, voles |
| shrub | `ribes_roezlii` (Sierra gooseberry) | 0.5-1.5 m, spiny, red berries June-Aug | rocky slopes, pine and oak woodland | bear, fox, coyote, jays, quail; cover for quail, rabbits |
| shrub | `ribes_malvaceum` (chaparral currant) | 1-2.5 m, pink Nov-March on bare stems, summer-deciduous | chaparral, dry oak edges | jays, quail, fox, coyote, bear; deer (a little); cover for quail |

Where they draw: the grasses in every blade tier and card of `grass.js` (the species in the instance code; `GRASS_SPECIES`),
the herbs in `forbs.js` within 45 m, the shrubs as 3D plants of `vegetation.js` from the species mix and as impostors of
`shrubfield.js` (`FH`, `FH_LOOK`). The home tile's ground mix (species_mix.json `ground_bytes`) places all 21 grasses and
herbs; its shrub shares are in decisions.md (2026-10-29). Not done: a lineup measurement of the nine shrubs against
their targets (they build without errors), a far tier for the herbs (a poppy field from the air), herb shadows, the
grass clump shapes per species (one geometry per type), and the local sign-off every record waits for.

## The water's plants and the riparian zones (2026-10-29)

Aaron: "make sure there are plenty of riparian plant species ... if there are missing important riparian species like
willow or cattail have them generated." Twenty-one records join the library (77 now), every one an agent draft, CC BY-SA
4.0, needing local sign-off, nothing downloaded, and the sixteen riparian records already in it gained the blocks below.
Two schema additions and one new form:

`habitat.riparian` (every plant of the water's edge; `pipeline/species_mix.py` riparian_rows builds the zone mixes
from it, `pipeline/water.py` places the zones, docs/tile-spec.md "Water and riparian"):

| field | meaning |
|---|---|
| `zones` | relative weight per zone: `channel` (the bed, in the water when the creek runs), `margin` (the wet margin above the summer line, flooded in winter), `bank`, `terrace` (the floodplain), `pond_water` (the open water: duckweed), `pond_margin` (the shallows and drawdown mud), `pond_shore` (just outside the water), `pond_terrace` |
| `orders` | `[min, max]` Strahler orders of the reaches it lines (1 a swale, 5 Weber Creek) |
| `permanence` | `perennial`, `intermittent` or `any`: the least permanent water it stands beside (a perennial species gets a tenth beside a seasonal reach) |
| `water` | one sentence on its water needs, for the card and the reviewer |

`relations.shades_water` (0-1): how much a mature plant shades the channel (alder 1.0, cottonwood 0.8, the willow
thickets 0.5-0.6, shrubs 0.1-0.3, herbs 0); written for the day the water has a temperature.

**Form `emergent`** (the tall wetland monocots and the horsetail; drawn by `client/src/emergents.js` as clumps of two
crossed cards baked from the record for the month, placed in the channel beds, wet margins and pond shallows by zone):

| field | meaning |
|---|---|
| `ground.habit` | `cattail` (flat blades to 2.5 m), `tule` (round stems with a tassel), `sedge` (an arching tussock), `rush` (a stiff one), `horsetail` (jointed evergreen stems) |
| `ground.palette` | per season: `root`, `tip` (the stem or blade from its base to its tip), `head` |
| `ground.heads` | `{ shape: cattail | tassel | spike | cluster | none, months: [from, to] }` |
| `ground.clump_m`, `ground.stems` | one clump's diameter and its stems |
| `ground.height_by_month`, `ground.density` | as the forbs |

Forb habits gain `floating` (duckweed: a mat drawn on the water's level in the ground quad only).

**The records.** The trees and shrubs are grown by the generator (the sycamore's bark is the new `mottled` pattern: a
mosaic of cream, pale green-grey and tan patches); the emergents and forbs are cards.

| form | id (common) | size | zones; orders, permanence | relations |
|---|---|---|---|---|
| tree | `salix_laevigata` (red willow) | 6-13 m | bank, pond_shore, terrace, margin, pond_terrace; orders [2, 5], intermittent | 2 eaten_by, shades 0.6 |
| tree | `salix_lasiandra` (Pacific willow) | 5-11 m | bank, pond_shore, margin, terrace; orders [2, 6], perennial | 2 eaten_by, shades 0.6 |
| tree | `platanus_racemosa` (California sycamore) | 15-26 m | terrace, bank, pond_terrace; orders [3, 7], intermittent | 1 eaten_by, shades 0.7 |
| shrub | `salix_exigua` (sandbar willow) | 2-4.5 m | margin, bank, pond_shore, pond_margin, channel; orders [2, 5], intermittent | 2 eaten_by, shades 0.3 |
| shrub | `cephalanthus_occidentalis` (buttonbush) | 2-4 m | margin, pond_shore, pond_margin, bank; orders [2, 7], perennial | 1 eaten_by, shades 0.3 |
| shrub | `cornus_sericea` (creek dogwood) | 1.8-3.5 m | bank, pond_shore, margin, terrace; orders [2, 6], perennial | 7 eaten_by, shades 0.3 |
| shrub | `rubus_ursinus` (California blackberry) | 0.6-1.6 m | terrace, bank, pond_terrace, pond_shore, margin; orders [1, 6], any | 10 eaten_by, shades 0.1 |
| shrub | `vitis_californica` (California wild grape) | 2-4 m | terrace, bank, pond_terrace, pond_shore; orders [2, 6], intermittent | 8 eaten_by, shades 0.3 |
| shrub | `calycanthus_occidentalis` (western spicebush) | 1.5-3 m | bank, terrace, margin, pond_shore; orders [2, 4], perennial | 0 eaten_by, shades 0.2 |
| emergent | `typha_latifolia` (broadleaf cattail) | 1.5-2.5 m | pond_margin, margin, pond_shore, channel; orders [2, 7], perennial | 0 eaten_by, shades 0.1 |
| emergent | `schoenoplectus_acutus` (hardstem tule) | 1.5-3 m | pond_margin, margin, channel; orders [2, 7], perennial | 0 eaten_by, shades 0.1 |
| emergent | `schoenoplectus_californicus` (California bulrush) | 1.5-3 m | pond_margin, margin, channel; orders [3, 7], perennial | 0 eaten_by, shades 0.1 |
| emergent | `carex_barbarae` (Santa Barbara sedge) | 0.5-1.0 m | margin, pond_shore, bank, terrace, pond_margin; orders [1, 6], any | 3 eaten_by, shades 0 |
| emergent | `carex_nudata` (torrent sedge) | 0.3-0.7 m | channel, margin; orders [2, 5], intermittent | 1 eaten_by, shades 0 |
| emergent | `juncus_effusus` (common rush) | 0.6-1.2 m | margin, pond_shore, bank, pond_margin, channel; orders [1, 6], intermittent | 0 eaten_by, shades 0 |
| emergent | `equisetum_hyemale` (scouring rush) | 0.5-1.5 m | margin, bank, pond_shore, terrace, channel; orders [1, 6], intermittent | 0 eaten_by, shades 0 |
| forb | `artemisia_douglasiana` (California mugwort) | 0.8-2.0 m | terrace, bank, pond_terrace, pond_shore, margin; orders [1, 6], any | 1 eaten_by, shades 0 |
| forb | `urtica_dioica` (hoary nettle) | 1.0-2.5 m | terrace, margin, bank, pond_shore, pond_terrace; orders [1, 6], intermittent | 1 eaten_by, shades 0 |
| forb | `erythranthe_guttata` (seep monkeyflower) | 0.15-0.8 m | margin, pond_margin, pond_shore, channel, bank; orders [1, 4], intermittent | 1 eaten_by, shades 0 |
| forb | `nasturtium_officinale` (watercress) | 0.1-0.5 m | channel, margin, pond_margin; orders [1, 4], perennial | 2 eaten_by, shades 0 |
| forb | `lemna_minor` (common duckweed) | 0.003-0.01 m | pond_water; orders [1, 7], perennial | 0 eaten_by, shades 0 |

The sixteen older records with the new blocks: white alder (bank at the toe, perennial, shades 1.0), arroyo willow
(margin and bank, any), Fremont cottonwood (terrace, 0.8), big-leaf maple, Oregon ash, black walnut, valley oak, bay,
blue elderberry, wild rose, snowberry, poison oak, blue wildrye, miner's lettuce, California oatgrass and yarrow; the
eight trees had no `habitat` or `relations` block before and got both. The library has no ducks, raccoon or towhee,
so duckweed lists no eaters and those animals are named in the notes. Not done: the local sign-off every record
waits for, a lineup measurement of the new trees and shrubs against targets (they build without errors), and the
emergents' far look (they fade at 120 m).
