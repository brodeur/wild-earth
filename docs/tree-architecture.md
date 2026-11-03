# Tree architecture over a life: why limbs droop and their ends turn up, and how to grow it for every species

Written 2026-11-01 from four research passes (the botany and biomechanics, the Placerville oaks species by species,
the procedural-modelling literature and tools, and a map of our own generator), for Aaron's question: "many of the
oaks here start out upright and then as they age, their branches droop down towards the ground, with the ends
reaching upwards. Is there an algorithm there we can learn? What are the variables, and can we find them reliably
for different species?" and his emphasis that the goal is the pipeline, every tree improved, the oak the first case.

## The short answer

Yes, there is an algorithm, and it is not oak lore: it is the mechanics of a limb that grows, holds for every tree,
and is already written down. A branch is a tapered beam fixed at one end. Every year it lengthens at the tip, adds a
ring of wood along its whole length, and carries more weight; the extra weight bends it, and the next ring is laid
down on the bent limb, so the sag becomes the limb's permanent shape (shape memory). The tree fights back with
reaction wood, which in a broadleaf is tension wood on the upper side pulling the limb up, but a year's correction is
one thin ring on an ever thicker limb while the load grows with the limb's whole reach, so thick old limbs lose to
gravity and sag, and thin young tips, which grow toward a set angle against gravity, win and turn up. Where the
leader's control over a limb fades with age, the limb's end rises further and founds a crown of its own, the
J-shaped limb of an old open-grown tree. A young tree is upright because its limbs are short, thin for their stiffness
and still held down by the leader. That is the whole progression, from first principles, with no oak in it.

What is per species is small: the wood's stiffness and density, how fast the tree grows in height and girth and for
how long, how wide its crown is for its height, how much foliage a shoot carries, and its architectural model (which
sets branch angles and whether limbs repeat the trunk). Most of those exist in databases covering thousands of
species. Two things do not exist as measurements for almost any tree: the branch insertion angle by order and the
gravitropic setpoint angle of its shoots. Those are defaulted by architectural model and leaf type and tuned against
photographs, as our parameter files are tuned today.

## The principles, by rank (what is true at the widest rank where it holds)

The locomotion tree (`library/animals/locomotion.json`) states each principle of movement once at the rank where it
holds and lets narrower ranks override; the tree model should do the same, in `library/species/architecture.json` or
a block in each species' record.

**All trees (universal physics).**
- A limb is a cantilever. Its bending stiffness is E I, with E the wood's modulus and I = π r⁴ / 4 for a round section
  of radius r. The load is the limb's own mass beyond each point, plus its foliage, times gravity, times the
  horizontal lever arm. The elastic bend of a segment is its moment over E I (Jirasek, Prusinkiewicz and Moulia 2000;
  the MAppleT apple model, Costes et al. 2008).
- Shape memory: each new ring is laid on the bent limb, so the rest curvature moves toward the loaded curvature in
  proportion to the new ring's share of the stiffness (Jirasek et al. 2000; Fournier 1991).
- Thickening: at a fork the parent's radius to a power equals the sum of the children's (the pipe model; Leonardo's
  rule has the power 2, measured 1.8 to 2.3 across many species, Eloy 2011).
- Stiffness scales almost linearly with green density across 161 species (Niklas and Spatz 2010), so stiffness per
  unit mass is nearly the same for every wood: sag differences come from geometry (how slender a limb is, how much it
  carries) and from how well reaction wood works, more than from the wood itself.
- Reaction wood corrects a tilted stem; whether a limb stays up is the race between that correction and the added
  weight (Alméras and Fournier 2009). A growing shoot's curving follows gravity sensing against its own curvature
  sensing, one dimensionless number B setting the shape (measured 0.9 to 9.3 across eleven angiosperms, Bastien et
  al. 2013).
- Most trees start excurrent (one leader) and become decurrent (a crown of competing limbs) with age, as the leader's
  apical control over the limbs fades (Wilson 2000).

**By leaf type.** Broadleaves make tension wood on the upper side and their apical control decays; conifers make
compression wood on the lower side and keep apical control (the spire), so their limbs stay level or droop as whorls
and the leader holds (van Rooij et al. 2023). Green modulus is about 0.9 of the dry modulus; green density about
1,000 kg/m³; tension-wood maturation strain 2,100 to 5,000 microstrain against 400 to 700 for normal wood.

**By architectural model (Hallé, Oldeman and Tomlinson 1978; Barthélémy and Caraglio 2007).** The oaks are Rauh's
model: rhythmic growth in flushes, every axis monopodial (growing from its own tip), branches repeating the trunk's
architecture, so a limb can become a trunk (reiteration), which is how an old open-grown oak's crown is a colony of
reiterated units with the massive J limbs Tomlinson describes. The model gives the branch angles by order, whether
branching is rhythmic or continuous, and whether limbs reiterate; our records already carry `architectural_model`
for reviewers, and the generator does not read it (`docs/species-library.md`). It should.

**By species.** Wood density (Global Wood Density Database v2: 17,261 species), modulus (the Wood Handbook table
5-3a for US commercial species, none of the California oaks; else from density), height and crown width against
trunk diameter (Tallo: 499,000 trees, 5,163 species; Bechtold 2004 crown-width equations for 53 western species;
the FVS variants), growth by age (Silvics of North America, about 200 species; the Urban Tree Database, 171 species
with valley oak measured at n = 53), lifespan, shade tolerance (which drives self-pruning), phenology (the National
Phenology Network), and the descriptive habit (FEIS, Silvics, horticultural pages, photographs).

## The algorithm: a yearly growth loop

Over the tree's life, for a skeleton of segments each carrying its length, radius, rest angle to its parent and
current angle:

1. **Primary growth.** Each live tip extends by the species' height-growth curve for its age and branches by the
   architectural model (rhythmic: a flush of laterals at each year's growth unit, at the model's insertion angle for
   that order). New shoots steer toward their gravitropic setpoint (upward for a leader, a set angle from vertical for
   a lateral by order) with Bastien's curving. Resource is split between the leader and the laterals by Palubicki's
   apical-control weight λ (0.54 excurrent to 0.46 decurrent), which decays with age for broadleaves and holds for
   conifers. Shaded and overtopped limbs are shed when their light is too low for their size (self-pruning; the
   lower-limb loss of a closed stand against the low spreading limbs of an open tree).
2. **Thickening.** Add a ring: radii by the pipe rule from the tips down, with the species' ring growth for its age.
3. **Sag.** From the tips in, sum the mass beyond each joint (wood by green density, foliage by a per-species leaf
   load per terminal shoot) and its moment; bend each joint by moment over E I; propagate outward; one or two
   relaxation passes at yearly steps.
4. **Freeze.** Move the rest angle toward the loaded angle by the new ring's share of I (shape memory).
5. **Correct.** Reaction wood turns each segment back toward its setpoint by at most about 4 Δμ Δr ℓ / r² a year (Δμ
   the maturation-strain difference across the section, 1 to 2 × 10⁻³; Δr the ring; ℓ the segment; r its radius):
   the correction falls as 1/r² while the load moment grows faster, which is the droop of the old and the upturn of
   the young in one line.

Cost, estimated: 5,000 to 20,000 segments over 150 years with a few linear passes a year is about 10⁷ simple
operations, tens of milliseconds in JavaScript per species. Fine at a tile build or a species bake; not per tree.

**Where it runs.** Not in the client per tree: meshes are built once per distinct seed and instanced, and the lidar
crown list only picks a size class per tree. So the loop runs offline, once per species, as a tool that grows the
species through its life and writes the generator's parameters at a handful of ages (say 10, 30, 80 and 200 years)
into the species' `variants`, where `classRaw` already reads per-class overrides (`treegen.js` 220-240) and where
valley oak already carries a hand-set droop by class. The generator stays what it is; the age series it draws from
becomes grown instead of guessed, and a continuous blend between the classes by the drawn height is a small follow-up
(a `by_age` field, `skeleton()` after line 690).

## What our generator has (from the map of `client/src/treegen.js`)

- A Weber and Penn style generator with per-level `down_angle_deg` (bottom to top of the parent, with variance),
  `curve_deg`, `zigzag_deg`, `sinuous_deg`, `tropism` (positive pulls tips up), and `droop_deg` / `upturn_deg` (the
  inner half of a limb sags, the outer half lifts: a static picture of exactly this effect, added for the ponderosa's
  limbs), `taper`, `radius_ratio`, the crown envelope that prunes or stretches limbs.
- Age as a fixed list of classes per species (sapling, young, mature, veteran) with per-class overrides; within a
  class nothing varies with size. Only valley oak changes its droop by class (4, 16, 28, 40 degrees); blue oak flattens
  its sapling; the other oaks change only trunk, crown size, counts and gnarl. No oak uses `upturn_deg`.
- The lidar crown list gives each tree a height and crown radius; `chooseClass` picks the class whose height range
  holds it, and the top 5 % by size in a 500 m block are old. Without lidar, a random scale.
- `architectural_model` in the records is for reviewers; the generator ignores it.
- The likeness review already says what is wrong with the oaks: a lollipop crown, about eight straight limbs and a
  leader to the top that reads excurrent, where the real blue oak's lowest limbs run out almost level and sag to a
  metre or two above the grass, crooked, and the review asked for droop on the lowest limbs and for Hallé reiteration
  (each scaffold growing its own sub-crown), still unbuilt.

## The oaks of Placerville as the first case

Measured, for all five (crown width in m against trunk diameter in cm, Bechtold 2004, stand-grown): blue
1.20 + 0.187 d, valley 0.91 + 0.230 d, interior live 1.56 + 0.196 d, canyon live 1.87 + 0.121 d, black
2.14 + 0.126 d. Height against diameter from Tallo's Sierra foothill plots: blue 1.30 d^0.525, interior live
1.90 d^0.433, canyon live 1.45 d^0.563, black 1.84 d^0.449. Valley oak by age (Sacramento street trees, n = 53):
crown width over height 0.56 under six years, 0.74 at 6-20, 0.91 at 20-40, 0.94 at 40-90, 1.14 past 160, the height
levelling near 20 m by 100 years; the crown widens relative to the height with age, which is the one measured signal
of the progression. Black oak by age (Silvics): 8 m at 20 years, 22 m at 100, 25 m at 140 then constant; diameter
fastest from 25 to 65 years. Blue oak: 20 cm at about 40 years, 60 cm at 125 on good sites; height growth nearly
stops past 65 cm; the oldest dated 459 years. Leaf-out and leaf fall at 300-1,200 m from the phenology network:
blue oak buds 16 March, last leaves 13 December; valley oak 24 March and 15 December; black oak 21 March and
9 December.

Which show the habit: **valley oak** most strongly and historically ("large limbs in great curves, 30 to 50 feet
long, almost touching the ground", Brewer, 1860s; settlers' "weeping oaks"; terminal branches droop to the ground).
Open-grown **canyon live oak** and **black oak** next: long horizontal limbs, a broad crown near the ground, no source
calling them drooping. **Interior live oak** does not: a dense rounded mass of short branches, often multi-stemmed.
**Blue oak** does not in the sources: compact, round, on many crooked branches, sparse, with heavy dead limbs when
old; the upturned tips appear in no text or measurement for any of them, only in photographs. So the first case is
the valley oak, which is also the one species with an age table; the blue oak is the test that the same loop gives a
compact crooked crown from different inputs (slow growth, a small crown for its height, heavy self-pruning) and not a
weeping one.

What is only prose or photographs for every species: habit by life stage, branch angles, the drooping and the
upturned tips, crown shape categories, bark by age, retained dead wood, age at first seed. The pipeline fills those
by architectural model and leaf type, then by review against photographs on the lineup page, as now.

## Sources a pipeline can look up by scientific name

| Source | Gives | Licence | Reliability |
|---|---|---|---|
| Global Wood Density Database v2 | wood density, 17,261 species | open data | high |
| Wood Handbook (FPL-GTR-190) table 5-3a | green and dry modulus and density, US commercial species | public domain | high; no California oaks |
| Tallo | height and crown radius against diameter per tree, 5,163 species | CC BY 4.0 | good, thin for many species |
| Bechtold 2004; FVS variant overviews | crown width against diameter equations, western species by code | public domain | good within the fitted ranges |
| Silvics of North America | growth by age, form, lifespan, first seed, phenology, about 200 species | public domain | high, dated 1990, some errors |
| FEIS | form, size, phenology, sprouting, bark, over a thousand species | public domain | high, numbers in prose |
| Urban Tree Database | age to diameter to height and crown, 171 urban species | public USFS data | good; irrigated growth runs fast |
| USA National Phenology Network | leaf-out and leaf-fall dates per tree, by API | open, citation asked | moderate, volunteer |
| USDA PLANTS | coarse categories by JSON API | public domain | low |
| TRY plant traits | height, phenology, leaf size, 305,000 taxa, by request | CC BY by default | not checked for crown traits |
| iNaturalist, CalPhotos | photographs of habit by age | per photo | the only source for angles and tips |
| MAppleT (Costes et al. 2008) | a fitted growth-plus-bending model: E 1.1 GPa (1 to 7 tested), pipe exponent 2.49, reaction-wood fraction 0.164 (1 − cos tilt) − 0.178 Δθ | paper | the working example |
| DeepTree appendix (Stava et al. 2014 sets) | per-species sets including oak: apical-dominance age factor 0.3, gravitropism −0.1, gravity bending 6.0 with thickness exponent 3.0, age 35 | paper | a second working example |

## The plan

1. **The growth tool** (`tools/grow_species.mjs`, node, no three.js): the loop above over a species' record, from a
   new `growth` block (height curve by age, ring growth, lifespan, crown width against height, leaf load, green
   density or modulus, λ and its decay by leaf type, the setpoint and insertion angles by order from the
   architectural model), writing the generator's `variants` at the chosen ages with their `down_angle_deg`,
   `droop_deg`, `upturn_deg`, `curve_deg`, `length_ratio`, `radius_ratio` and the envelope fitted from the grown
   skeleton, and a side-by-side image of the grown skeleton against the generator's tree at each age for review.
   First on valley oak, then blue oak as the counter-case, then black and canyon live, then a conifer (ponderosa) to
   prove the leaf-type defaults.
2. **The records**: a `growth` block for every tree species in the library, filled by a pipeline script from the
   sources above (GWDD, Bechtold, Tallo, Silvics, the Urban Tree Database), with the source and date beside each
   value as the animal records do, and defaults by architectural model and leaf type where a species has no number.
3. **The generator reads the model**: `architectural_model` drives the insertion angles by order and reiteration
   (a scaffold limb past a size founding its own sub-crown, the review's open item), and the age classes blend by
   the drawn height.
4. **Verification**: the lineup page per species at the four ages against reference photographs and the lidar crown
   list's own height-to-crown ratios by size class on the home tile (the real local trees as a check of the
   allometry the loop produces).

## Built (2026-11-01, step 1 with the valley oak's parts of steps 2 and 3)

`tools/grow_species.mjs` runs the loop above over a `growth` block in a species' record (format in
`docs/species-library.md`, "Growth block") and writes the generator's age classes; `library/species/grown/<id>.json`
(git-ignored, regenerated by the tool) holds the grown skeletons and the lineup page draws them beside the class trees
with `?classes=1&grown=1`. Valley oak, blue oak and ponderosa carry growth blocks and fitted classes. What the build
found, what was tuned and what still reads wrong is in the decisions log (2026-11-01, "Trees grow their age, built").
The one knob fitted to photographs is the limbs' effective modulus (2.8 GPa for the two oaks, with the trunk stiffened
3 x); the rest are the cited constants and the species' measured curves. Step 2 (every species' growth block) and
step 3 (the generator reading `architectural_model`, the age classes blending by the drawn height) are open.

Also built the same day, in the placement rather than the loop (Aaron: "the base of a tree should always be perpendicular
to the surface it is on, and the rest of the trunk should bend to go on its normal path from there"): each near-trunk
instance carries the ground's normal at its foot and its vertex shader moves the collar uphill onto the surface and
bends the first 1.8 m from the normal to the vertical (treegen.js `trunkFlex`, `SLOPE_BEND_M`; vegetation.js `groundLean`).
Verified at a walker's eye and from the air on 45 and 50-degree slopes of the home tile; the decisions entry has the
choice (a per-instance attribute over baked slope classes) and what is not bent.

Also in the placement, 2026-11-02 (Aaron: "some trees live significantly longer and get significantly bigger on a bell
curve, so the horizon should be more irregular"), the first part of step 3's "age classes blend by the drawn height":
on tiles without lidar crowns a canopy tree's height is drawn from its species' size curve (`client/src/stature.js`, a
log-normal on the record's `stature` typical and tall heights, truncated at the record, with an emergent in about one
cell of 250 trees) and its age class is the one that holds that height, the top 8 % of the curve old, so the rare giant
is drawn with the veteran's limbs, as the lidar tiles already did from the measured crowns. The decisions log has the
diagnosis (the class ranges, the uniform scale and the far tier's rescale capped every species) and the numbers.

