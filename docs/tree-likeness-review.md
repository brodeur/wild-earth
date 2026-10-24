# Tree likeness review: photographs against the generator

Phase 1 of the likeness pass (2026-10-23). Six foothill species near Placerville
(300-900 m) compared with what `client/src/treegen.js` grows from
`library/species/*.json`. Phase 2 (implementation) waits until the generator files are
free; nothing in the generator or the species files was changed for this review.

**What was compared.** 48 reference photographs (8 per species; list, authors and
licences at the end; files are kept outside the repository as the species-library doc
asks), the committed lineup images (`lineup-summer.jpg`, `lineup-winter.jpg`), and the
lineup page rendered close up, one species at a time, from the working tree on
2026-10-23 (while another agent was editing the generator, so details such as the
ponderosa tiers may already have moved). Where a number is given it was measured:

- *Colour*: mean of sky-masked crown pixels, averaged in linear light, reported as sRGB
  plus the chromaticity ratios r/g and b/g (linear), which do not depend on exposure.
  Photographs have their own white balance and haze, so treat absolute values as a
  guide and the ratios and the ordering between species as the finding.
- *Silhouette*: crown masks from clear-sky photographs; width = 1st to 99th percentile
  of foliage pixels per row; porosity = fraction of sky inside that span (the "see
  through" of the crown). Render-side numbers are approximate (the lineup horizon and
  ground shadows fall inside some crops).

## Summary

| species | reads as the species today? | biggest gap |
|---|---|---|
| blue oak | partly in summer, no in winter | lollipop crown (bole to 45% of height, ~1:1) instead of a broad, low, lobed dome (1.4-1.6:1); winter crown is a sparse broom, not a twig haze |
| interior live oak | yes, closest of the six | too black inside (79% near-black crown pixels against 21-57% in photos), too emerald; no multi-stem or skirt |
| gray pine | no | looks like a forked broadleaf tree with opaque dark tufts; real crowns are pale, silvery and smoky, round to ovoid, with many short branches |
| ponderosa pine | yes at 150 m, weak at 20 m | carrot-orange, untextured trunk; spiky dark tiers instead of brush-tuft clumps; one age class |
| whiteleaf manzanita | the red stems read, the crown does not | crown near-black green; in photos it is the palest foliage of the six |
| chamise | no | a round head on bare stems (broccoli) instead of a ragged vase of wiry wands with grey dead stems |

Across all six, the four changes with the largest gain per unit of work are:
recalibrated colours (and per-instance colour jitter), a crown envelope with foliage
clumped in an outer shell, procedural bark textures, and per-species foliage textures
that match leaf and needle form (with a winter twig texture for blue oak). Details and
a phase-2 order are at the end.

## What the generator does today (for reference)

Weber-Penn skeleton (trunk or stems, two or three branch levels, crown shape by
height on the trunk, curve, tropism, droop/upturn), leaf cards with a per-species
canvas texture (`leaf_shape`: oval, lobed, lanceolate, needle_cluster,
needle_fascicle), cards placed along the deepest two levels with jitter, crown-shaped
normals and an inner darkening, three tiers (close: more smaller cards; near: cards;
mid: about 60 enlarged cards or k-means blobs), vertex-colour bark with a per-ring
pattern on 3-8 sided tubes and no UVs, seasons as a material tint plus a leaf-on rank
cut, three seeds per species instanced and scaled 0.75-1.25. It cannot today: put
textures on wood, shape the crown by where branch tips end (only by where branches
start), cluster foliage, vary colour per instance, make any stem dead, or show
anything but leaves in a bare deciduous crown.

---

## Blue oak (Quercus douglasii)

**Photographs.** Summer habit (01 Mount Diablo, 02 Shingle Springs), winter habit (03,
04 savanna), landscape (05 summer, 06 Jepson's Sierra foothill plate, about 1910),
bark (07), foliage (08).

- **Habit and proportions.** Open-grown trees are much wider than tall: the 01 crown
  measures 1.59 times its height; woodland trees (04, 06) are narrower, about 1:1.
  Short, stout bole, 1.5-2.5 m (0.15-0.25 of height), often leaning. Crown base is low:
  the lowest limbs run out almost horizontally and sag to 1-2 m above the grass, and
  on 01 one rests on the ground. Width profile of 01 from top to bottom in tenths of
  height: 82, 110, 128, 145, 151, 150, 156, 159, 150, 125 (% of height), i.e. a dome
  that keeps widening down to the skirt.
- **Trunk and branching.** Decurrent: the leader is gone by 2-3 m; 3-6 scaffold limbs
  leave the bole at 30-60 degrees, then go crooked, changing direction every metre or
  so. The inner crown is bare limbs (02, looking up); leaves are in the outer 1.5-2 m.
  Winter (03, 04) shows hundreds of second- and third-order branches that zig-zag at
  20-40 degrees per growth unit, ending in a dense, fine twig mass. Trunks are thick:
  dbh near 1 m on the 11 m tree in 01 (dbh/height about 0.09; the file has 0.05).
- **Bark.** Pale ash-grey to nearly white with lichen (sunlit trunks in 04 read white
  from 50 m), broken into small rectangular checks 2-5 cm across. Mean (115, 113, 115),
  r/g 1.02, b/g 1.03: neutral grey, not warm.
- **Foliage.** Leaves 3-7 cm, oblong, entire to shallowly wavy-lobed, matte, crowded at
  twig ends. Colour blue-grey-green: 01 crown mean (91, 93, 86), r/g 0.96, b/g 0.83;
  the file's summer colour is r/g 0.69, b/g 0.61, i.e. yellower and greener.
- **Density and texture.** At 20 m the crown is a surface of rounded "cumulus" clumps
  1-2 m across with dark gaps between them and a few holes to sky (porosity 0.21 in
  01). At 150 m (05) each tree is a separate, slightly flattened grey-green blob with a
  dark underside and a sharp cast shadow, clearly bluer and lighter than the
  near-black live oaks around it and darker than the gold grass.
- **Season.** Winter: the twig mass reads at 100 m as a hazy grey-brown to purple-grey
  dome, not a skeleton; dark green mistletoe balls (0.3-1 m) stand out in some crowns.
  Spring: pale yellow-green. Fall: brown and partly bare, unevenly from tree to tree.

**Generator now.** Crown starts at about 45% of height on a slim straight bole, so the
tree reads as a lollipop; crown about as wide as the tree is tall (roughly 1.05:1);
foliage in two or three large masses with a hard bright-top/dark-bottom split rather
than many clumps; colour greener than the photos. Winter: about 8 straight limbs and a
few dozen straight spike twigs radiating like a broom, and the leader continuing to the
top, which looks excurrent; bark darker and browner than the photos.

**Ranked changes.**

1. *Crown shape (parameters plus envelope).* Lower `trunk.length_ratio` to about
   0.3-0.35 and `base_size` to 0.12-0.18; 5-7 level-1 scaffolds with `length_ratio`
   1.1-1.3, `down_angle_deg` about 70 at the bottom and 35 at the top, `droop_deg`
   15-30 on the lowest; fit to a crown envelope 1.4-1.6 times as wide as tall (see the
   envelope idea below). Thicker trunk (`radius_ratio` 0.07-0.09 for open-grown).
2. *Foliage in clumps in an outer shell.* 1-2 m clumps at twig ends, nothing in the
   inner 50% of the crown radius, sky gaps between clumps (target porosity 0.2).
3. *Colour.* Summer about (127, 137, 122) instead of (118, 140, 112) (same luminance,
   photo chromaticity); per-instance jitter, since neighbouring trees in 05 differ
   visibly; per-instance leaf-on offset in fall and spring.
4. *Winter crown.* Zig-zag twigs (alternating bend per segment), a twig-texture card
   swapped in for the leaf texture in winter, and 0-3 mistletoe clumps per tree.
5. *Bark.* Pale neutral grey (about (139, 139, 139)) with a checkered texture.

## Interior live oak (Quercus wislizeni)

**Photographs.** Habit: 01 Pilot Hill (El Dorado County, local), 02 a park tree, 03
Hidden Falls (Placer, local, woodland form); 04 shrubby crown on a slope; 05
multi-stem (Hidden Falls); 06 trunks; 07 bark (Hidden Falls); 08 foliage.

- **Habit.** Evergreen, rounded-irregular, often 2-5 stems from the base (05, 06).
  Open-grown crowns are 1.1-1.5 times as wide as tall (01 measures 1.13, 02 about
  1.5) and come down to the ground on the open side (01 skirt at about 0.5 m). In
  canyons (03) taller and narrower, with upright trunks. On rocky slopes a dense
  shrub (04).
- **Trunk and branching.** Several leaning, slightly sinuous stems; many medium
  branches; dense twig network inside, with dead grey twigs.
- **Bark.** Dark grey to grey-brown, smooth to finely furrowed and scaly, lichen
  patches. Sunlit mean (141, 135, 126); in shade much darker.
- **Foliage.** Small (2-5 cm), glossy, dark green leaves, very dense; scattered yellow
  and brown old leaves (08). Sunlit crown mean (114, 123, 84), r/g 0.83, b/g 0.43:
  olive. The file's (60, 82, 50) is r/g 0.50: too emerald and dark.
- **Density and texture.** Porosity low (0.05-0.27, the 0.27 from a backlit, noisy
  mask). At 20 m the crown is a fine stipple with bright glints from glossy leaves, not
  large sprays. At 150 m the darkest crowns in the landscape (05 blue oak photo: the
  near-black clumps along drainages), dense and lumpy.
- **Season.** Little change; fresh pale growth and catkins in spring.

**Generator now.** The best of the six: dense, dark domes with a short trunk. Too
black: 79% of rendered crown pixels are near-black against 21-57% in photos. Spray
cards (1.5 m) make the surface coarser than the fine leaf texture. Mostly single
trunks, crown base a bit high, no skirt.

**Ranked changes.**

1. *Colour and shading.* Summer about (86, 95, 69); raise the inner-crown darkening
   floor for this species (an `ao_min` field); per-instance jitter.
2. *Multi-stem and skirt.* `stems` [1, 4] with 20-35 degree spread for open trees,
   `base_size` about 0.1, drooping lowest limbs.
3. *Finer foliage.* Smaller cards (0.8-1.0 m) with small elliptic leaves and a few
   bright specular-looking speckles drawn into the texture.
4. *Bark.* Fine-furrowed dark grey texture.
5. *Form variants.* A canyon form (taller, narrower) and a shrub form via age/site
   classes (see below).

## Gray pine (Pinus sabiniana)

**Photographs.** Habit: 01 with blue oaks (east side of the Sacramento Valley), 02
leaning, 03 a young single tree, 04 an old irregular tree with dead lower branches, 05
with mistletoe; 06 landscape (Mount Diablo); 07 bark; 08 needles.

- **Habit and proportions.** Crown round to ovoid, 0.55-0.7 times the tree height wide
  (01, 03), starting at 0.25-0.35 of height. Trunk single, often leaning or bowed (02),
  and commonly dividing into 2-4 ascending leaders in the upper third to half (01,
  05). The crown is wider in the middle than at the top (02 profile from the top: 31,
  64, 62, 95, 101, 100, 98, 104 % of crown height), not V-shaped.
- **Branching.** Many short-to-medium branches all the way up, ascending 30-60
  degrees, with many fine branchlets; foliage at the outer ends; dead grey branches in
  the lower crown are common (04).
- **Bark.** Dark grey-brown, irregularly furrowed into blocks with paler grey ridges;
  sunlit mean (140, 129, 111), r/g 1.20 (warmer and lighter than the file's (90, 85,
  78)).
- **Foliage.** Needles 20-30 cm, slender, in threes, drooping, grey-green and
  glaucous. In mass the tufts look like smoke: soft, translucent edges, no hard
  outline. Crown mean (106-112, 113-115, 102-103), r/g 0.83-0.99, b/g 0.76-0.89: with
  blue oak the bluest foliage of the six, and the lightest tree crowns.
- **Density.** Porosity 0.32-0.53: you see sky through most of the crown. Big brown
  cones (15-25 cm) hang in clusters (04, 05) and show as dark dots.
- **150 m** (06): pale, silvery, hazy ovoid crowns, lighter than every other plant on
  the slope, trunks visible through them. This colour and softness is the
  identification cue at distance.

**Generator now.** Reads as a forked broadleaf tree: a Y fork low on the trunk, a few
long bare limbs, a V-shaped crown wider at the top, and sparse, opaque, dark tuft
cards that look like seaweed. Porosity is about right (around 0.6) but for the wrong
reason: there are too few tufts, not wispy ones.

**Ranked changes.**

1. *Needle texture.* Long, thin, drooping strokes in loose fascicles with 30-40% alpha
   coverage, lighter greys, soft ends; draw a few cards crossed or at random rotation
   about the twig so tufts have volume; light transmission (wrap lighting) so the
   crown glows when backlit.
2. *Architecture.* Leader persists (`length_ratio` near 1), forking moved from the
   bole top to 0.45-0.65 of height (a new `split_height`), 2-3 leaders; 25-40 shorter
   level-1 branches (`length_ratio` 0.25-0.3) ascending 40-60 degrees; ovoid envelope.
3. *Deadwood.* 20-40% of lower-third branches dead (grey, no foliage).
4. *Colour.* Summer about (125, 133, 121); bark about (107, 99, 87) with a furrowed
   texture.
5. *Cones.* Optional: 3-8 small dark cards in clusters near branch ends.

## Ponderosa pine (Pinus ponderosa subsp. benthamiana)

**Photographs.** 01 young open-grown, 02 and 03 mature, 04 old flat-topped, 05 a
meadow stand, 06 crown from below, 07 bark, 08 needles. Note: most are Sierra
mid-elevation; at 600-900 m near Placerville ponderosa is at its lower edge.

- **Habit by age.** Young (01): conical, dense, branches to the ground, bright
  yellow-green. Mature (02, 03, 05): long straight clear bole for 40-60% of height,
  narrow irregular crown of a few long heavy limbs that droop then turn up at the tips,
  dead branch stubs on the bole. Old (04): flat or round-topped, umbrella-like, dense
  at the top (crown porosity 0.14).
- **Bark.** Plates 20-60 cm long, elongated vertically, cinnamon to buff-tan with
  jigsaw-puzzle flakes, separated by black fissures (10-20% of the area). Close-up
  mean (129, 114, 105), r/g 1.31; sunlit trunks (04) read orange at distance but
  nowhere near the file's (176, 108, 66) (r/g about 2.8 in linear light).
- **Foliage.** Needles 12-25 cm in threes, stiff, curving up, in dense bottle-brush
  tufts at the branch tips; tufts clumped with clear gaps between limbs. Dark
  yellow-green: r/g 0.89-1.10, b/g 0.47, i.e. clearly yellower and less blue than gray
  pine. The file's (52, 78, 46) is r/g 0.41: far too saturated green.
- **150 m.** Dark green narrow crowns with orange-brown trunk sections showing in the
  gaps.

**Generator now.** Tall straight trunk and whorled tiers read as a pine at distance.
Up close: the trunk is a uniform bright orange tube (carrot), tiers are spiky dark
cards rather than brush tufts, crown starts at 30-40% of height, all three seeds are
the same age class.

**Ranked changes.**

1. *Bark.* Plates texture (Voronoi cells stretched 2:1 vertically, black fissure
   network, flake detail) and a less saturated mean; plate colour about (168, 118, 84)
   with fissures, giving a mean near (145, 102, 74).
2. *Tufts.* Brush texture (radiating stiff needles forming round tufts) in clumps at
   branch ends; colour about (80, 86, 60).
3. *Age classes.* Young conical (branches to the ground), mature (clear bole 0.5),
   old (flat top, few huge limbs).
4. *Stubs and deadwood.* Short dead stubs along the clear bole; a few dead lower limbs.
5. *Fewer, heavier limbs* in the mature crown (15-20 visible, strong droop/upturn).

## Whiteleaf manzanita (Arctostaphylos viscida)

**Photographs.** Habit 01-04 (01, 02 and 04 are from southern Oregon, 03 from the
Sequoia National Park visitor centre), 05 a small tree, 06 crown texture, 07 bark, 08
foliage.

- **Habit.** 1.5-3.5 m shrub (to 5 m as a small tree, 05), broad dome 1.2-1.8 times
  as wide as tall. Many sinuous, crooked stems from a burl, spreading 30-60 degrees
  and branching repeatedly (sympodially); the crown is a continuous dense dome on top,
  and the underside shows the red stems and grey dead twigs, often with lichen.
- **Bark.** Smooth, polished, deep red-maroon, peeling in thin curls in summer; grey
  dead patches. Median (145, 71, 70). The file's (116, 40, 28) is about 10 times more
  red than green in linear light; the photos are about 3-4 times: maroon, not crimson.
- **Foliage.** Leaves 2.5-5 cm, ovate to round, held vertically, pale grey-green to
  almost white (glaucous). Crown mean (121-128, 123-131, 103-114), r/g 0.91-0.97, b/g
  0.59-0.74, low contrast (only 11-19% dark pixels). The palest foliage of the six.
- **150 m.** Pale grey-green patches with a faint red undertone.

**Generator now.** The red stems are the right idea and read immediately, but they are
crimson. The crown is near-black green (render mean about (74, 76, 61), 49% dark
pixels), darker than blue oak, which reverses the real order. Shapes are reasonable
domes.

**Ranked changes.**

1. *Colour.* Summer about (144, 149, 126) and a high inner-shading floor (low
   contrast); bark about (119, 66, 65) maroon.
2. *Leaf texture.* Round leaves seen edge-on and face-on, pale, with a light bloom.
3. *Sinuous stems.* Smooth S-bends (alternating curvature with low random jitter),
   more segments on level 0 and 1.
4. *Shell crown with an open underside* (foliage in the outer 0.5 m only) and 15-25%
   grey dead stems.
5. *Bark texture.* Smooth maroon with small pale curls.

## Chamise (Adenostoma fasciculatum)

**Photographs.** Habit: 01 El Dorado Hills and 02 Darrington Trail (both El Dorado
County, local), 03 and 04 southern California; 05 a stand at Pilot Hill in rust seed
(local), 06 a flowering stand, 07 stems, 08 foliage and buds.

- **Habit.** 1-3 m; 15-40 slender, wand-like stems from a burl, spreading 10-40
  degrees like a fountain or vase; the top is ragged, with single wands sticking out.
  1-1.5 times as wide as tall. In stands the shrubs merge into a continuous,
  fine-textured canopy.
- **Branching and wood.** Few side branches; the interior is a tangle of grey dead
  stems (07) that shows through the foliage.
- **Foliage.** Tiny (4-10 mm) linear leaves in bundles along the wands: the texture is
  bottlebrush stems, not leaves. Dark olive to grey-green: r/g 0.98, b/g 0.81 in 03;
  01 (El Dorado Hills, summer) is r/g 1.39, a mix of olive and rust.
- **Season.** Cream flower panicles at the tips in May-June (02, 06); rust-brown seed
  heads from July through winter that colour whole stands (05).
- **Density.** Porosity of a single shrub's silhouette 0.02-0.17; the vase shows sky
  between wands at the top.

**Generator now.** A round, dense head on 6-10 bare stems: it reads as broccoli or a
small topiary tree. No grey dead wood; porosity near zero; seasons are a tint of the
whole shrub.

**Ranked changes.**

1. *Architecture.* 15-30 stems, foliage along the outer 60-70% of each stem (level-0
   foliage for shrubs, or very short level-1 twigs), vase envelope (inverse conical)
   with high length variance for a ragged top.
2. *Texture.* Wiry stems with tiny bundles, 30-40% coverage.
3. *Deadwood.* 25-40% grey dead stems in the interior.
4. *Seasonal tips.* Cream (spring) and rust (summer-fall) applied to the outer 20% of
   each wand, not the whole shrub (a tip-weighted tint, see below).
5. *Cover.* Stands as a continuous layer (shrubfield work, already on the roadmap).

---

## Ideas for a better likeness

Costs are per tree and per frame. The scene draws about 30k instances of 18 meshes (6
species times 3 seeds), so anything that changes a mesh or a texture once is nearly
free at run time; per-instance attributes cost a few bytes each.

### 1. Photo-calibrated colour, per-instance variation and an `ao_min`

- *Gain:* high at every distance; the one change that most improves 150 m.
- *Cost:* zero triangles, zero fill. Per-instance colour is one `instanceColor`
  (12 bytes per instance).
- *Sketch:* adopt the proposed colours above, then tune on the lineup with a measured
  readout (idea 11). Add `foliage.color_var` (e.g. 0.06 in value, 0.03 in hue) and
  `foliage.leaf_on_var` (per-instance offset of the leaf-on cut, so fall and spring
  blue oaks change at different times). Add `foliage.ao_min` (the 0.62 floor in
  `cardGeometry` today, per species: higher for manzanita and live oak).

### 2. Crown envelope fitted to photographs

- *Gain:* high for blue oak, gray pine, chamise and manzanita silhouettes; it is what
  the eye reads first at 50-300 m.
- *Cost:* zero run time (generation only).
- *Sketch:* Weber and Penn already describe pruning: grow a branch, and if its tip
  leaves the envelope, shorten it. Add `crown.envelope` as a sampled profile from the
  photographs: `profile: [[h, r], ...]` with h the fraction of tree height and r the
  crown radius / height (blue oak 01 gives the numbers above), plus `asymmetry` (one
  side heavier, as on slopes and in leaning trees) and `lobes` (3-5 radial bulges for
  oaks). After a level-1 stem is grown, scale its length so its tip lands at
  `envelope(h, azimuth) * (0.85-1.0)`; deeper levels clipped the same way. Keep
  `crown.shape` for files without an envelope. Profiles can be traced semi-automatically
  from clear-sky photographs with the mask method used here (a small script under
  `library/`), so a contributor can add one per photo and the file keeps the average.

### 3. Foliage in clumps, in a shell

- *Gain:* high at 20-150 m for oaks and pines (lobes, gaps, the inner crown showing
  limbs), and it improves the mid tier because its 60 cards inherit the clumping.
- *Cost:* zero triangles (same card count, redistributed).
- *Sketch:* `foliage.clumps: { radius_m, per_m, shell }`. Pick clump centres at twig
  tips with a Poisson-disk spacing of about 1.5 radius; place each card inside a clump
  (Gaussian, sigma = radius / 2) instead of uniformly along the branch; drop cards
  whose normalised crown depth is below `shell` (oaks 0.5, manzanita 0.7, pines 0).
  Pines use small clumps exactly at branch ends (brush tufts).

### 4. Per-species foliage textures, version 2

- *Gain:* high under 50 m, medium at 150 m (texture sets the grain and the mean
  colour of the crown). Gray pine and chamise need it most.
- *Cost:* zero triangles; one 256x256 texture per species (two for the close tier).
  Lower alpha coverage for pines and chamise saves fill rate.
- *Sketch:* the canvas drawing exists; replace generic ellipses with outlines per
  `leaf_shape` and add shapes: `oblong_wavy` (blue oak: oblong with 2-4 shallow waves,
  matte), `elliptic_glossy` (live oak: small ellipses, some with spiny margins, a
  bright speckle per leaf), `round_vertical` (manzanita: round leaves, many seen
  edge-on as thin slivers), `needle_drooping` (gray pine: 3-needle fascicles of very
  long thin strokes that arc down, 30-40% coverage), `needle_brush` (ponderosa: dense
  round brushes of stiff upturned strokes), `fascicle_wand` (chamise: wiry stems with
  tiny bundles). Draw RGB, not grey: a small palette per species (leaf top and
  underside, old yellow leaves for live oak, dead tips for gray pine), still divided by
  its mean so the vertex colour keeps the species and season colour.

### 5. Winter twig cards and mistletoe (deciduous species)

- *Gain:* very high for blue oak in winter (the crown becomes the grey-brown twig haze
  of photos 03 and 04 instead of a broom). Medium for chaparral fall views.
- *Cost:* zero extra triangles for twigs (same card geometry), mistletoe 6-12 cards
  per tree (+12-24 triangles).
- *Sketch:* draw a second texture per deciduous species: fractal twig silhouettes
  (zig-zag strokes, 10-20% coverage, warm grey-brown). In `applySeason`, when leaf-on
  is below a threshold, swap `map` to the twig texture and set the leaf-on cut to the
  twig fraction (`foliage.winter_twigs: 0.8`), so the same cards become twigs. Mistletoe:
  `epiphytes: { mistletoe: { prob, clumps: [0, 3], radius_m } }` places small dense
  dark-green card balls on level-2 stems; they keep leaf-on 1.

### 6. Procedural bark textures

- *Gain:* high under 30 m for ponderosa (plates), manzanita (polished maroon), blue
  oak (pale checks); low at 150 m except through the corrected mean colour.
- *Cost:* zero triangles; one 256x512 colour texture plus a normal map per species
  (about 1.5 MB GPU each with mips, 9 MB for six); trunks are a small share of screen
  pixels, so fill cost is negligible. `MeshLambertMaterial` takes `map` and
  `normalMap`.
- *Sketch:* add UVs in `tube()`: u around the circumference, v the arc length in
  metres divided by the texture's real height; the number of u repeats rounded to an
  integer per tube from `2 pi r / tile width`, so plates keep their real size from
  trunk to limb with no seam. Textures drawn on a canvas from `bark.pattern` and
  parameters: `plates` (Voronoi cells stretched 2:1 vertically, black fissure network
  at cell edges, small jigsaw flakes inside; ponderosa), `checkered` (small cells
  aligned to a grid with jitter, pale with white lichen dots; blue oak),
  `furrowed` (long anastomosing ridges; gray pine deep and coarse, live oak shallow
  and fine), `smooth_peeling` (flat maroon, sparse pale curls; manzanita),
  `shreddy` (grey strips; chamise). Normal map from the height field by a Sobel
  filter. Keep vertex colour as a multiplier so `bark_rgb` still sets the mean.
  Lefebvre and Neyret (2002), *Synthesizing bark*, model fissures as cracks that open
  as the trunk widens; a 1D crack simulation along u is a cheap way to get realistic
  fissure spacing if Voronoi looks too regular.

### 7. Branch architecture per model

- *Gain:* medium to high, mainly winter oaks, gray pine, chamise, manzanita.
- *Cost:* +10-20% wood triangles for zig-zag (more segments on level 2); none for the
  rest.
- *Sketch:*
  - `zigzag_deg` per level: at each segment, bend by +/- this angle about an axis that
    alternates (oak twigs and blue oak scaffolds; the photos show a direction change
    every growth unit).
  - `sinuous_deg` per level: a smooth S-curve (sine of arc length) instead of random
    jitter (manzanita stems, the sympodial Leeuwenberg habit).
  - `split_height` for the trunk: the fork can happen anywhere on the trunk, not only
    at the bole top (gray pine at 0.45-0.65 of height).
  - Level-0 foliage for shrubs (`foliage.levels: [0, 1]`), so chamise wands carry their
    own leaves.
  - Hallé reiteration for oaks: let each scaffold limb grow its own level-2 crown with
    its own envelope (a sub-crown), which gives the 3-5 lobes of blue oak naturally.

### 8. Deadwood and snags

- *Gain:* medium; very characteristic of gray pine (dead lower branches), chamise
  (grey interior), manzanita (grey stems), ponderosa (stubs on the bole) and drought
  blue oaks (dead tops).
- *Cost:* zero to slightly negative (dead stems carry no cards).
- *Sketch:* `deadwood: { fraction, where: "lower" | "inner" | "top", rgb }`; a stem
  marked dead gets no foliage, nor do its children; its tube is coloured `rgb` (grey)
  and slightly thinner. `stubs: { count, length_m }` on the clear bole for ponderosa.
  Snags: a `snag` variant (dead trunk with broken limbs) selected by
  `placement.snag_fraction` in `vegetation.js`.

### 9. Age and size classes

- *Gain:* medium to high for ponderosa (young cone, mature, old flat-top) and blue oak
  (narrow young trees, broad old ones); removes the cloned look of three seeds.
- *Cost:* memory only: 5-6 variants per species instead of 3 (about 2x the mesh
  memory, which is small); same draw calls if variants share materials.
- *Sketch:* `age_classes: [{ name, weight, height_m, overrides: {...} }]` merged over
  the base parameters per variant in `normalizeSpecies`; vegetation picks a variant by
  weight and by local canopy cover (open cells get more broad, old trees).

### 10. Lighting tweaks for foliage

- *Gain:* medium: gray pine and blue oak edges glow when backlit in photos; live oak
  and manzanita need less black interior.
- *Cost:* a few ALU instructions per canopy pixel.
- *Sketch:* in the canopy shader patch, add a transmission term,
  `trans = pow(max(0, dot(-viewDir, sunDir)), 4) * foliage.translucency`, added to
  diffuse; per-species `translucency` (gray pine 0.4, blue oak 0.25, live oak 0.1).

### 11. Measured lineup and parameter fitting against photo targets

- *Gain:* turns tuning from opinion into numbers, which matters for an open library
  with many contributors.
- *Cost:* development only.
- *Sketch:* species files get `targets` measured from the reference photographs:
  `{ crown_width_ratio, crown_base_ratio, porosity, foliage_srgb, bark_srgb }` with
  the photo links in `sources`. The lineup computes the same measures for each seed
  from the skeleton and cards (crown extents, a coarse orthographic coverage raster for
  porosity, the card colour mean) and shows them next to the targets, green when within
  10%. A later step, after Stava et al. (2014), *Inverse procedural modeling of trees*:
  a small random or coordinate search over 4-6 parameters per species in a headless
  lineup to hit the targets.

### 12. Space colonisation for oak crowns

- *Gain:* high for oaks if the parameter route stalls: Runions, Lane and Prusinkiewicz
  (2007), *Modeling trees with a space colonization algorithm*, grow branches toward
  attraction points scattered in a crown envelope. It produces the decurrent,
  crooked, gap-filled oak structure and the bare inner crown without tuning many
  angles, and it takes the photo envelope (idea 2) directly.
- *Cost:* generation time about 20-100 ms per skeleton in JavaScript for 2-3k
  attraction points (18 skeletons, once, can run in a worker and be cached); run-time
  cost the same as today.
- *Sketch:* `architecture: "space_colonization"` with `{ points, kill_m, influence_m,
  step_m }`; the result is converted to the same `Stem` list so meshing, cards and
  LODs are unchanged. Keep Weber-Penn as the default.

### 13. Lobes for the mid tier

- *Gain:* medium for 180-1500 m: Livny et al. (2011), *Texture-lobes for tree
  modelling*, represent a crown as textured lobes around branch clusters. With
  clumping (idea 3) the mid tier can draw one textured hull per clump group instead
  of k-means ellipsoids, which keeps the lobed silhouette of blue oak at distance.
- *Cost:* similar triangles to blobs; one more texture.
- *Sketch:* only after ideas 2 and 3; the cards mode may already be enough.

Not recommended for now: image-based reconstruction from single photographs (Tan et al.
2008; Argudo et al. 2016). It needs per-photo segmentation and gives one tree per
photo, while the library wants a parameter set per species; the envelope profile in
idea 2 keeps the useful part (the silhouette) in a shareable form.

---

## Phase 2 plan

Order chosen so each step is visible on the lineup and later steps build on the
earlier ones. Every new behaviour is a species field with a default that reproduces
today's tree, so files that do not use it are unchanged.

1. **Measured lineup with before/after.** `client/src/lineup.js`, `client/lineup.html`,
   a small `treegen.js` export of per-seed metrics, `targets` in the six species files,
   schema in `docs/species-library.md`. Lineup shows metrics against targets per
   species, and a `?baseline=1` mode that draws the built-in (pre-change) parameter set
   beside the library one, so every later step has an in-place before/after.
2. **Colour recalibration and per-instance variation.** Species files (colours,
   `color_var`, `leaf_on_var`, `ao_min`), `treegen.js` (`cardGeometry` floor,
   materials), `vegetation.js` (instance colour and leaf-on offset). Lineup: the colour
   readout moves to the target; summer lineup before/after screenshots.
3. **Crown envelope and clumped shell foliage.** `treegen.js` (pruning to
   `crown.envelope`, clump placement), species files for blue oak, live oak, gray pine,
   manzanita, chamise. Lineup: width ratio, crown base and porosity readouts; the blue
   oak lollipop becomes a broad dome.
4. **Foliage textures v2 and winter twig cards.** `treegen.js` (`leafTexture`, new
   shapes, RGB palettes, twig texture, `applySeason` swap, mistletoe), species files.
   Lineup: close view per species, winter view for blue oak.
5. **Bark textures.** `treegen.js` (UVs in `tube`, canvas bark generator, per-species
   trunk material; `trunkMaterial` gains a species argument), `vegetation.js` (trunk
   materials per species instead of one shared), species files (`bark` block). Lineup:
   close view of trunks; the ponderosa carrot becomes plated cinnamon.
6. **Architecture fields.** `treegen.js` (`zigzag_deg`, `sinuous_deg`, `split_height`,
   level-0 foliage, deadwood and stubs), species files for gray pine, chamise,
   manzanita, blue oak, ponderosa. Lineup: gray pine and chamise rebuilt; winter blue
   oak.
7. **Age classes and snags.** `treegen.js` (`normalizeSpecies` overrides, variant
   count), `vegetation.js` (variant choice by weight and canopy cover), species files.
   Lineup: show all variants per species (an "all variants" toggle).
8. **Optional:** translucency term (idea 10) and space colonisation for oaks (idea 12)
   if blue oak still misses its targets after step 6.

After each step: `python3 library/embed_builtin.py`, lineup screenshots in all four
seasons, a fly-over at 20 m and 150 m, and the frame rate at the start view against
the current 50-60 fps.

---

## Reference photographs

Kept outside the repository, in the review session's scratch folder
(`treerefs/<species>/`, with a `refs.json` per species recording title, author,
licence, licence URL, source page and the downloaded URL). All are CC0, CC BY, CC BY-SA
or public domain: 11 CC0, 2 public domain, 19 CC BY (2.0, 2.5 or 4.0) and 16 CC BY-SA
(2.0, 3.0 or 4.0). iNaturalist photographs are from El Dorado and Placer counties.

**quercus_douglasii**

| file | shows | author | licence | source |
|---|---|---|---|---|
| 01_habit_summer.jpg | habit summer | Awinch1001 | CC BY 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Quercus_douglasii_mature_specimen_Mount_Diablo_6.jpg) |
| 02_habit_summer_shingle_springs.jpg | habit summer shingle springs (4990 Barnett Ranch Rd, Shingle Springs, CA, US) | Sarah Angulo (iNaturalist: sarahangulo) | CC0 | [iNaturalist](https://www.inaturalist.org/photos/36055259) |
| 03_habit_winter.jpg | habit winter | Eugene Zelenko | CC BY-SA 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Quercus_douglasii-1.jpg) |
| 04_habit_winter_savanna.jpg | habit winter savanna | Chris M Morris | CC BY 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Blue_Oak_(24863731733).jpg) |
| 05_landscape_summer.jpg | landscape summer | Awinch1001 | CC BY 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Quercus_douglasii_Blue_Oak_Woodland_Mount_Diablo16.jpg) |
| 06_landscape_sierra_1910s.jpg | landscape sierra 1910s | Willis Linn Jepson | Public domain | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Quercus_douglasii_plate_3.jpg) |
| 07_bark.jpg | bark | Yath at English Wikipedia | CC BY-SA 3.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Blue_Oak_bark.jpg) |
| 08_foliage.jpg | foliage | Awinch1001 | CC0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Quercus_douglasii_Leaves_Stanford_Dish_Park.jpg) |

**quercus_wislizeni**

| file | shows | author | licence | source |
|---|---|---|---|---|
| 01_habit_pilot_hill.jpg | habit pilot hill (Pilot Hill, CA, US) | Kyle Elshoff (iNaturalist: kcelshoff) | CC BY 4.0 | [iNaturalist](https://www.inaturalist.org/photos/352336080) |
| 02_habit_park.jpg | habit park | Chris English | CC BY-SA 3.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:2013_-_Native_Live_Oak_Kept_in_Landscape,_Birch_Lane,_Forest_Lawn_Memorial_Park,_Glendale,_CA_-_panoramio.jpg) |
| 03_habit_hidden_falls.jpg | habit hidden falls (Hidden Falls Regional Park, Auburn, CA, US) | Joshua Zupan (iNaturalist: jzupan) | CC0 | [iNaturalist](https://www.inaturalist.org/photos/251778214) |
| 04_crown_slope.jpg | crown slope | Krzysztof Ziarnek, Kenraiz | CC BY-SA 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Quercus_wislizeni_kz08.jpg) |
| 05_multistem.jpg | multistem (Hidden Falls Regional Park, Auburn, CA, US) | Joshua Zupan (iNaturalist: jzupan) | CC0 | [iNaturalist](https://www.inaturalist.org/photos/341319463) |
| 06_trunks.jpg | trunks | Benny White | CC BY-SA 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Quercus_wislizeni_trunks.jpg) |
| 07_bark.jpg | bark (Hidden Falls Regional Park, Auburn, CA, US) | Joshua Zupan (iNaturalist: jzupan) | CC0 | [iNaturalist](https://www.inaturalist.org/photos/170122952) |
| 08_foliage.jpg | foliage | Krzysztof Ziarnek, Kenraiz | CC BY-SA 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Quercus_wislizeni_kz03.jpg) |

**pinus_sabiniana**

| file | shows | author | licence | source |
|---|---|---|---|---|
| 01_habit_with_blue_oak.jpg | habit with blue oak | Roarofthefour at Flickr | CC BY-SA 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_sabiniana_SacramentoValley.jpg) |
| 02_habit_leaning.jpg | habit leaning | Roarofthefour at Flickr | CC BY-SA 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_sabiniana_SacramentoValley2.jpg) |
| 03_habit_single.jpg | habit single | Vlad Butsky from San Jose, CA, USA | CC BY 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_sabiniana_Diablo_Mountain_2.jpg) |
| 04_habit_irregular.jpg | habit irregular | Awinch1001 | CC BY 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_sabiniana_mature_specimen_irregular_form_Mount_Diablo_13.jpg) |
| 05_habit_mistletoe.jpg | habit mistletoe | Awinch1001 | CC0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_sabiniana_Mt_Diablo.jpg) |
| 06_landscape.jpg | landscape | Awinch1001 | CC BY 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_sabiniana_typical_habitat_Mount_Diablo_10.jpg) |
| 07_bark.jpg | bark | Walter Siegmund | CC BY 2.5 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_sabineana_00061.JPG) |
| 08_foliage.jpg | foliage | Awinch1001 | CC BY 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_sabiniana_needles_Mount_Diablo_13.jpg) |

**pinus_ponderosa**

| file | shows | author | licence | source |
|---|---|---|---|---|
| 01_habit_young_open.jpg | habit young open | USFS Region 5 | CC BY 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_ponderosa_subsp_benthamiana_young_tree_Pine_Creek_Valley.jpg) |
| 02_habit_mature.jpg | habit mature | Dawn Beattie from Morro Bay, CA, USA | CC BY 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Ponderosa_Pine,_Yosemite_Creek,_California_1.jpg) |
| 03_habit_mature_2.jpg | habit mature 2 | CrabTree13 | CC BY-SA 3.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Ponderosa_Pine,_Crabtree_Hot_Springs,_Lake_County,_California.jpg) |
| 04_habit_old_flat_top.jpg | habit old flat top | Jeff Turner from Santa Clarita, CA, United States | CC BY 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Leavitt_Meadow-West_Walker_River_(20422889998).jpg) |
| 05_stand.jpg | stand | Jon Sullivan | Public domain | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Some_trees.jpg) |
| 06_crown_from_below.jpg | crown from below | stekkelpak | CC0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_ponderosa_subsp_benthamiana,_Santa_Cruz,_California_01.jpg) |
| 07_bark.jpg | bark | elonicera | CC0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_ponderosa_subsp_benthamiana,_bark,_Tuolumne,_California_1.jpg) |
| 08_foliage.jpg | foliage | Henri Sivonen from Helsinki, Finland | CC BY 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pinus_ponderosa_benthamiana_foliage_cones.jpg) |

**arctostaphylos_viscida**

| file | shows | author | licence | source |
|---|---|---|---|---|
| 01_habit.jpg | habit | brewbooks from near Seattle, USA | CC BY-SA 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Arctostaphylos_viscida_-_Flickr_-_brewbooks.jpg) |
| 02_habit_2.jpg | habit 2 | brewbooks from near Seattle, USA | CC BY-SA 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Arctostaphylos_viscida_-_Flickr_-_brewbooks_(1).jpg) |
| 03_habit_stems.jpg | habit stems | Krzysztof Ziarnek, Kenraiz | CC BY-SA 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Arctostaphylos_viscida_kz2.jpg) |
| 04_habit_3.jpg | habit 3 | SairusP | CC BY-SA 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Arctostaphylos_viscida_Oregon.jpg) |
| 05_habit_small_tree.jpg | habit small tree | Alex Abair | CC BY 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Arctostaphylos_viscida_viscida_7520186.jpg) |
| 06_crown_texture.jpg | crown texture | Walter Siegmund | CC BY 2.5 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Arctostaphylos_viscida_08225.JPG) |
| 07_bark.jpg | bark | Alex Abair | CC BY 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Arctostaphylos_viscida_30229731.jpg) |
| 08_foliage.jpg | foliage | Alex Abair | CC BY 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Arctostaphylos_viscida_viscida_7520191.jpg) |

**adenostoma_fasciculatum**

| file | shows | author | licence | source |
|---|---|---|---|---|
| 01_habit_el_dorado_hills.jpg | habit el dorado hills (El Dorado Hills, CA, USA) | Kristy Moon (iNaturalist: kristy218) | CC0 | [iNaturalist](https://www.inaturalist.org/photos/578630142) |
| 02_habit_darrington_trail.jpg | habit darrington trail (Darrington Trail, El Dorado County, CA, USA) | Steve Woodward (iNaturalist: cnpsstevew) | CC0 | [iNaturalist](https://www.inaturalist.org/photos/188601168) |
| 03_habit.jpg | habit | Krzysztof Ziarnek, Kenraiz | CC BY-SA 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Adenostoma_fasciculatum_kz03.jpg) |
| 04_habit_2.jpg | habit 2 | Krzysztof Ziarnek, Kenraiz | CC BY-SA 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Adenostoma_fasciculatum_kz04.jpg) |
| 05_stand_fall_pilot_hill.jpg | stand fall pilot hill (Pilot Hill, CA 95664, USA) | Juli Ann Lingenberg (iNaturalist: radagast_97) | CC0 | [iNaturalist](https://www.inaturalist.org/photos/316670361) |
| 06_stand_flowering.jpg | stand flowering | cultivar413 from Fallbrook, California | CC BY 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:170411_790_Encinitas_-_San_Diego_Botanic_Gdn,_Overlook_Natural_Area,_Salvia_mellifera_Black_Sage,_Adenostoma_fasciculatum_Chamise_(33744396434).jpg) |
| 07_stems.jpg | stems | Walter Siegmund | CC BY 2.5 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Adenostoma_fasciculatum_00101.JPG) |
| 08_foliage.jpg | foliage | Stan Shebs (attribution from Commons file record) | CC BY-SA 3.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Adenostoma_fasciculatum_1.jpg) |


---

## Phase 2 results (2026-10-24, overnight)

Done in `client/src/treegen.js`, `client/src/lineup.js`, `client/src/vegetation.js` (bark
materials only), the six species files and `docs/species-library.md` ("Likeness fields").
Every new field defaults to the old behaviour. The `buildTree(id, seed, lod)` return shape and
the `stem` record used by the acorn game are unchanged, so the impostor baker picks up the new
crowns automatically.

Done, in the order Aaron asked for:

1. **Measured lineup.** Each seed is drawn side-on into an offscreen target and measured the
   way the photographs were: width/height, crown base, porosity and colour ratios. The label
   shows measured / photo target. Targets are stored per species as `targets`.
2. **Crown envelope and clumped shell foliage.** Envelopes were traced from the photographs.
   Branches are pruned or extended to land on the envelope, and foliage is placed in clumps
   with an inner shell left empty. At mid LOD there is one area-preserving card per clump,
   with a clump-shaped texture.
3. **Foliage textures v2.** Six new leaf and needle shapes, RGB palettes, chamise wand tips
   that change with season, winter twig cards for blue oak, and mistletoe.
4. **Bark textures.** Canvas-generated colour and normal maps per species: plates, checks,
   furrows, smooth with peeling curls, shreddy. Trunks get UVs. Textured bark is used near
   only (vegetation `barkMat`).
5. **Architecture fields.** Zig-zag and sinuous limbs, a high fork for gray pine, bole stubs,
   deadwood (branches and whole shrub stems).
6. **Colour.** Photo-chromaticity summer colours (other seasons scaled with them), new bark
   colours, an `ao_min` floor, and per-plant colour and leaf-out variation from a position
   hash in the shader. No instance buffers are needed.

Not done: age classes and snags (step 7), translucency, space colonisation.

### Metrics against photo targets (mean of 3 seeds, measured / target)

| species | W/H | crown base | gaps | r/g | b/g |
|---|---|---|---|---|---|
| ponderosa | 0.47 → **0.42** / 0.40 | 0.39 → **0.46** / 0.45 | 0.52 → 0.56 / 0.35 | 0.43 → **0.86** / 0.95 | 0.30 → **0.45** / 0.47 |
| gray pine | 0.68 → 0.55 / 0.65 | 0.40 → 0.42 / 0.30 | 0.56 → **0.43** / 0.40 | 0.85 → **0.89** / 0.88 | 0.62 → **0.79** / 0.82 |
| interior live oak | 0.94 → **1.21** / 1.20 | 0.23 → 0.17 / 0.08 | 0.08 → 0.31 / 0.12 | 0.52 → **0.84** / 0.85 | 0.32 → **0.44** / 0.50 |
| blue oak | 1.07 → **1.43** / 1.40 | 0.38 → **0.20** / 0.15 | 0.11 → **0.27** / 0.20 | 0.70 → **0.86** / 0.90 | 0.60 → **0.74** / 0.78 |
| manzanita | 1.17 → 1.28 / 1.40 | 0.28 → **0.17** / 0.15 | 0.07 → 0.34 / 0.10 | 0.81 → **0.91** / 0.95 | 0.63 → **0.68** / 0.68 |
| chamise | 0.82 → 1.01 / 1.20 | 0.31 → 0.18 / 0.10 | 0.07 → 0.29 / 0.15 | 0.95 → 1.11 / 1.00 | 0.57 → **0.61** / 0.70 |

The colour ratios are in linear light, so they do not depend on exposure. Live oak, manzanita
and chamise are now too open, which is the next thing to tune (density and clump size).
Gray pine is still a little narrow.

### Frame rate

The browser pane was shared with other agents' tabs all night, so timings varied by ±15%
from run to run. The best paired runs at the start view were HEAD 41.8 fps against 33.7 fps
for this work, with 20 m at about 29 fps against 35. That is outside the ~10% budget.

Already removed: an expensive per-vertex hash, mid trunks for shrubs, UVs on mid trunks, and
close-tier factor 3 → 2. Mid cards are now one per clump. A clean A/B on an idle machine is
needed before tuning further. If it is still over budget, the next levers are `lod.mid_cards`
for the trees and the clump overdraw in the close tier.
