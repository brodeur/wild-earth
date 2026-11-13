# Avatar realism: a pipeline for a beautiful model and a body that idles like its species

2026-11-12. Aaron, 2026-11-11: "How do we achieve a deeper level of realism with the animal avatars - how do we design a
pipeline that produces a beautiful model, and species-appropriate idle behaviors", then "Feel free to go until morning
trying to figure it out." This note is the answer, with what was built overnight to test it (branch
`claude/avatar-realism`). It follows [animal-library.md](animal-library.md) (how a model is made today),
[movement.md](movement.md) (the gait engine) and [behaviour-rig.md](behaviour-rig.md) (the rig's next layers).

## The finding that shapes everything

The generator was never the problem. The Meshy refine of the gray wolf in `library/animals/jobs/canis_lupus/` is a
31,000-triangle mesh with a 2K painted coat, and it looks like a wolf. The game drew a 5,000-triangle reduction of it
in which each face takes one flat colour voted from a ten-colour palette, with the UVs, the normals and the texture
thrown away (`tools/build_quadruped.py`, `tools/animal_glb.py`). The realism was lost in our own reduction step.

And the renderer was never the obstacle. An animal draw binds 5 to 7 texture samplers and 12 to 13 of the 16 vertex
attribute slots; the "all sixteen units are full" belief is true of the terrain, not of animals. A textured,
smooth-shaded tier already existed for one bird (the ground raven).

So the pipeline does not need a better generator first. It needs to stop throwing the source away, and to give the
dense mesh a rig and a motion layer that deserve it.

## The pipeline, stage by stage

Each stage has a gate that is measured, so a species passes or fails without anyone's eye, and a species that fails
keeps what it had.

| stage | what it does | tool | gate |
|---|---|---|---|
| 1. Source | a generated mesh with a painted coat, standing square | `tools/meshy_generate.py`, `pipeline/fauna_models.py` (30 credits: preview 20 + 2K refine 10, or image-to-3D 30) | the pose gate on the preview, before the refine is paid (`pipeline/pose_gate.py`); the model acceptance rule, which now ends in the likeness to photographs of the species (`pipeline/likeness.py`); see "The gates before credits" |
| 2. Game tiers | the reduced tiers, the 20-joint skeleton fitted from geometry, the far tier's baked cycles | `tools/build_quadruped.py`, `tools/rig_quadruped.py`, `tools/bake_gait.mjs` | as today; these stay as the far tier and as the fallback |
| 3. Hero tier | the source's surface on a clean 20,000-triangle mesh with new UVs, colour, normal and occlusion maps baked from the dense source, weights computed on the hero mesh itself, a tail chain, ear joints, a hair-length factor per vertex, two more LODs | `tools/hero_model.py` (Blender, headless) | alignment residual; eight pose tests (inverted faces, edge stretch, skin spanning the legs, trunk volume); bytes under 3 MB a species |
| 4. On screen | hero LODs in the species' shared pool, the full hero with fur shells for the player's body, one draw a tier, lazy, with a switch | `client/src/hero.js`, `animalMaterial({hero})` | sampler and attribute counts read from the GL programs; frame cost by shell count; texture bytes |
| 5. Motion | strides that vary (yesterday's lane), then the idle layer: breathing, weight, gaze, ears, tail, and acts chosen by a director, all read from the taxonomy tree | `client/src/gait.js`, `client/src/idle.js`, the tree's `vary` and `idle` blocks | `tools/gait_measure.mjs`, `tools/idle_measure.mjs`: rates against the tree, feet never slide, same seed same behaviour, an act a skeleton cannot do is left out by a reach test |

Nothing in stages 3 to 5 is written per species. The tool ran unchanged on the wolf, the bison and the grizzly, and then
the whole pipeline was run from nothing for two home species, the mountain lion and the coyote (below, "From nothing").

### Stage 3 in detail: the hero model (`tools/hero_model.py <species>`)

1. **Align** the source to the game model's frame by a similarity (principal axes, then trimmed ICP with scale). The
   wolf's residual is 0.67 mm median; the build had only scaled and moved the source.
2. **Clean and reduce**: weld, drop loose pieces, close holes, decimate to 20,000 triangles (ears, muzzle, toes, tail
   and horns keep their outline at that count).
3. **Unwrap** into a few large islands cut where they are least seen (the belly's midline, the inside of the legs,
   under the tail and throat), the head at 1.4 times the texel density. The source's atlas is thousands of fragments.
4. **Bake** from the dense source onto the new UVs: base colour (2048), a tangent-space normal map (1024), ambient
   occlusion (1024). The whole set is 2.2 to 2.6 MB a species.
5. **Rig**: the game's skeleton, but weights computed on the hero mesh by bone heat, cleaned along the back and neck,
   the tail by arc length. Copying the game's low-poly weights was tried first and lost on every species: bending a
   fore leg 40 degrees dragged a sheet of skin between the legs.
6. **Tail and ears**: the tail's joints are placed on its centreline when the game rig's are a stub (4 of 19 fauna
   models have no tail weights: the build's tail finder is fooled by a stepped-back hind leg); two ear joints are
   added after the usual twenty (as the lagomorph rig has them) when the ears can be found.
7. **Fur factor**: a hair length per vertex (0 bare to 1 longest) in the second UV channel, from how far the dense
   source stands off the clean surface, capped on bare parts.
8. `client/assets/hero/index.json` lists what exists; the client reads it and nothing else.

Measured over eight poses (a fore and a hind leg reaching both ways, a head turn to the ground, a sit, a gallop's
flex), bone heat against the copied weights:

| | wolf | bison | grizzly |
|---|---|---|---|
| inverted faces, all poses | 942 against 1,339 | 622 against 2,843 | 1,041 against 4,265 |
| worst edge stretch | 14.2 against 25.3 | 8.3 against 19.2 | 6.6 against 13.0 |
| skin between the fore legs, worst, times rest | 1.08 against 1.77 | 1.03 against 1.35 | 1.02 against 1.32 |
| trunk volume in the sit | -15 % against -9 % | | -21 % against -12 % |

### Stage 4 in detail: on screen (`client/src/hero.js`)

- The species' shared pool takes hero lod1 (6,666 triangles) as its near tier and hero lod2 (2,000) as its middle
  tier; the old faceted mesh stays as the far tier. A wolf met at 5 m and at 50 m is the same animal.
- The player's own body (its own mesh and material in `groundControl.js`) takes hero lod0 with full-size maps and fur
  shells: the body drawn again N times in one instanced draw, each shell pushed out along the skinned normal by the
  hair factor, strands from a hash of the UV, darker at the root. A rim term on every hero tier stands in for light
  scattering through the coat.
- Measured on the GL programs: 14 of 16 attribute slots, 8 texture units. Texture memory 35 MB a hero species (29 MB
  of it the player's full-size maps). GPU time with the wolf filling a third of a 1920x1200 frame: body 0.5 to 1.5 ms,
  8 shells 1.5 to 2 ms more, 16 shells 3.5 to 4 ms more and no better to look at, so 8 is the default.
- Switches: `?hero=0` (the whole tier off), `?fur=N`, `?rim=0`; in the lineup `&hero=0|1|2`.

### Stage 5 in detail: the idle layer (`client/src/idle.js`, applied in `gait.js`)

Before tonight a standing animal did nothing: no breathing anywhere in the animal code, no glance, no ear or tail life
outside the hares. Now, read from the tree's `idle` blocks (Mammalia, with Artiodactyla, Cervidae, Carnivora, Canidae,
Felidae, Ursidae, Lagomorpha and Hippopotamidae saying only what differs) and from the body's seed and a clock:

- **Always on.** Breathing (the chest and spine swell; the rate by Stahl's rule, 53.5 x mass^-0.26 a minute; faster
  and deeper after a run, settling over minutes). Weight drifting over one hind leg and back. The gaze: quick turns and
  log-normal holds, a caller's target when given (`inp.look`), the head coming up from the feed at intervals. The ears
  lead the gaze by 0.3 s, wander each on its own, flick, lie flat in a gallop and a shake, stand forward when alert.
  The tail by family: hoofed animals switch it, canids carry it low, cats twitch the tip. Bedded ruminants chew: about
  one chew a second in runs of 34 to 46, a pause of a few seconds, shown as the nod the jaw's work gives the head.
- **Acts**, scheduled by a director so they never overlap and yield at once when the body moves: shake, scratch,
  stretch, sit, sniff, stamp, groom, the hares' face wash. Each act's share of standing time is in the tree; the gaps
  between acts are drawn log-normally. The sit is made the way the engine makes everything: the hind feet step in
  under the body one after the other, the hips come down behind them, the fore legs stay vertical over their planted
  feet (the wolf's back at 46 degrees against the tree's 47; the cat and the bears sit lower than their tree angles,
  38 and 42 to 46 degrees against 57 and 65, because the spine has one middle joint).
- **The gate.** An act names what a skeleton needs, and each skeleton is tested once when it loads. A scratch needs the
  hind toe to reach the neck by the engine's own IK (the coyote, the wolf, the hare and, from the new seat, the grizzly
  pass; the cats, the deer, the bison and the black bear do not, because they bend the neck to meet the foot and the
  skeleton has one neck joint). A groom needs a neck
  of two joints, so it is off for every species until the rig has one. An act that fails is left out, not faked.
- **Measured** (`tools/idle_measure.mjs`, an hour of standing a species): breathing within 1 % of the rule (coyote
  27.1 a minute against 27.3, elk 12.4 against 12.6, cougar 18.2 against 18.3); every act's share within 15 % of the
  tree's over 200 hours; the elk's chew runs a median of 41; planted toes moved 0.00 mm; the same seed gives the same
  behaviour and two seeds differ; starting to walk mid-act never jumps a joint. Cost: 0.4 to 2.4 microseconds a
  standing body a frame, nothing when moving.

**The stance's reach** (found on the hero wolf, whose legs show what the faceted one hid). Yesterday's reach rule let
a foot land and stay planted out to the leg's whole geometric reach, and a leg in the air swung further still: the
wolf's 62 to 70 degrees ahead of the vertical at a gallop, the big ungulates' "splits". The line from the hip or
shoulder to the toe is now held within an angle each side of the vertical (the tree's Mammalia `vary`: 28 and 28 degrees
at a walk, 28 and 30 at a trot, 32 and 36 at a gallop, ahead and behind; by eye: no measured limb angles were reached),
and the rest of a fast stride is time in the air. The duty factors that result: coyote 0.58 to 0.60 at a walk, 0.41 to
0.44 at a trot, 0.33 at a gallop; elk 0.59 to 0.61, 0.30 to 0.34, 0.19 to 0.29 (a trotting horse's is about 0.31 and a
cheetah's about 0.2 by the two sources read). Foot slide is still 0.0 mm. The far tier's 30 clip sets were baked again.
The cost: the elk, the bison and the zebra now walk with shorter, quicker strides than the allometry gives (the elk
1.04 m at 1.46 a second, where it was 1.48 m at 1.03), because the rig's legs are short for the body and a walk must
keep a foot on the ground more than half the time; the giraffe's walk still fails that check (0.38). That is the rig
fitter's to fix (item 6 below), not the bound's.

What was read and from where is in the tree's notes. Read: Stahl 1967 (breathing, through two later papers), Li 2013
(rumination, Table 2), Eckstein & Hart 2000 (a cat grooms 8 % of its waking time), Hudson & Kuzyk 2007 (deer groom
1 to 4 %), Tolkamp & Kyriazakis 1999 (gaps between bouts are log-normal), Dickerson et al. 2012 (a shake's frequency
falls as mass^-0.22). Not found, and so by eye and marked so: scan rates and durations, ear and tail rates, how long a
scratch lasts, every act's shape. Most of the ethology asked for was not found in the time; the tree's notes are the
honest list.

## From nothing: the mountain lion and the coyote

The three species above had a source on disk. The home tile's animals did not, so two were taken through every stage
in one go, for 80 credits (the lion 30; the coyote 50, its first preview rejected for a turned head and a bent spine):
a new source by the fauna step's own prompt and judge, the game tiers and rig as a fauna-step model, the hero tier, the
22-joint clips. A hand-built species opts in through one loader wrapper (`pipelineOr` in `client/src/animalModels.js`):
the pipeline's model when the hero index lists the species, the hand-built one otherwise or under `?hero=0`.

What the run taught, each fixed as a rule: the described colours were misread ("tip of the tail black" as a black
tail); a furry mesh sized by mass came out a third too small, so a curated shoulder height now wins; the ear finder
took a tip near the nose. And what it could not fix: a generator that will not always give a level, forward head (the
coyote's is turned about 25 degrees in the source and it shows), and a painted coat more saturated than the animal.
The pose is the gate to tighten: reject at the 20-credit preview, never at the refine (done the same day: "The gates
before credits", below).

On the home tile the hand-built lion is a faceted shape and the pipeline's is a cougar (`home_lion_before_after.jpg`,
`home_lion_light_matched.jpg`, `lineup_lion_gaits.jpg`).

The hunt on the new body, filmed on the home tile before the merge (2026-11-12, `scratch/catch_harness.js`): the AI
lion's stalk behind its leader (pose 0.45), the rush, the leap (state 93, lift to 0.55 m), the kill at the landing and
the crouch over it, three hunts, three kills (`home_lion_ai_hunt.jpg`, `home_lion_ai_leap_feed.jpg`); the player's
pounce (the crouch, the leap, the landing), the kill and the feeding crouch, the stalk on Alt+W, and the tail's last
joint swinging with the twitch as the lion lies (`home_lion_player_pounce.jpg`, `home_lion_player_feed_stalk.jpg`,
`home_lion_tail_twitch.jpg`). The body holds in each: no torn skin, no folded joint, the tail with the body. The
poses are the leg engine's, as before; only the surface is new. What the film cannot say: the twitch is a small
movement seen from above in dim light, and the feed was seen through grass from the side and clear only from above.
The lion does not climb in this game (`climb: 0` in its row; the player's lion has no climb), so there is nothing
to check there. Frame times on the page were 80 to 100 ms on a machine at load 10 to 13, the same on main at the
same place (84 ms), with the animals' update at 1.6 ms against main's 1.5 ms: the branch adds no measurable cost
there, and the film's uneven time stamps are the machine's.

**The coyote is built but held back.** Its generated coat is not a coyote's: a grey back with a black saddle and
rufous legs, nearer a jackal, on a head turned in the source. The pipeline's colour check passed it; anyone who knows
the animal would not. So the hero index can hold a species (`hold`, with the reason; the hand-built model draws), and
the gate that let it through was the thing to fix: a likeness check against reference photographs of the species, not
only against a description's colour words. That check now exists and refuses this coyote by measure (next section);
the hold is written from the acceptance rule's record (`tools/hero_model.py --holds`), no longer by hand.

## The gates before credits: pose and likeness (2026-11-12)

Two rules now stand between the generator and the game, both for every four-legged species and neither written per
species. Neither spends credits to run.

**The pose gate** (`pipeline/pose_gate.py`, on a preview's mesh, before its 10-credit refine). Seen from above, the
trunk's centreline is traced between the hind and the fore feet; the gate measures the head's turn from that line,
the bend between the trunk's two halves, how far apart along the body each pair of feet stands (a stride), and that
four feet are down. Limits: head 9.9 degrees (9.5 on the first measure, below), spine 3.5 degrees, stagger 1.0 leg
length. Synthetic box animals with a known turn, bend and stride read within 1 degree and 0.03 leg lengths
(`tests/test_pose_gate.py`).

- It gets the known cases right: the coyote's two previews fail (head 25.1 and 32.5 degrees, spine 7.2 and 4.4) and
  the lion's passes (2.1 and 1.0).
- It also says something nobody had measured: **11 of the 21 four-legged species the game serves have a head turned
  more than 9.5 degrees** in their source (8 more than 12.5; 5 more than 20: the wildebeest 36.0, the coyote 32.5,
  the wolf 25.1, the wild dog 22.5, the mountain goat 22.2). Checked by eye on top-down pictures: those heads are
  turned. They were accepted because a side view hides it. So about half of the generator's previews would be refused
  at 9.5 degrees (at 12.5, the next gap in the library's numbers, about four in ten), which puts a species at about
  50 credits, not 30, until the build can straighten a head. It now does: the next section. (These are the first
  measure's numbers, on the surface's foremost point; the head's end is now found on the solid, and the same heads
  read a little further off: next section.)

**The likeness** (`pipeline/likeness.py`, on a refine's textured model, and as the last stage of the model acceptance
rule). The model is pictured side-on from both sides in its own colours under a plain sky, cut out and set on grey;
the species' openly licensed reference photos (the photo rule's, those it scores whole, clear and side-on) are cut out
by their masks the same way. A network trained to tell pictures apart (DINOv2, small) gives each picture an
embedding. A model is recognised when its own species' photos are the nearest of every species' in the store and it is
as near them as nine in ten of them are to each other. Nothing in it is fitted to our verdicts.

- **Can it name an animal at all?** Each photo was left out in turn and set against every species: 169 of 188 photos
  of 12 species land on their own (90 %; chance is 8 %). Six of the 19 misses are wolf photos taken for coyotes; the
  wolf's own photos are the weak set (7 of 15 land on the wolf).
- **The coyote fails, for the reason a person gave.** It is nearer the photos of the black-backed jackal (0.776) than
  the coyote's own (0.746), on both sides. The other eight served models with photos pass, each nearest its own
  species by 0.13 to 0.35 (the grizzly's second is the black bear), except the wolf, which is nearest its own by 0.04
  with the jackal second.
  `likeness_hero_five.jpg` in the captures shows the five hero species beside their species' photos.
- **Against the 13 recorded verdicts it can be run on, it agrees with 9.** It refuses the mountain goat with an ibex's
  horns and brown patches and the coyote, and passes every accepted model. The four it does not see: two refused for
  their shape (a pronghorn with an impala's horns, a legless badger), which the build's gate and the feature check
  own, and two grizzly coats (a stark cream blotch, a near-black coat): a wrong patch on the right animal is not what
  it measures.
- **What was tried first and kept only as words.** Colour by body region (the trunk, and the back, underside, legs and
  ends against the flank, in CIELAB, each in the photos' own spreads) named a left-out photo's species 42 % of the
  time among seven species, and its verdict on the coyote flipped when one measure was added. It cannot decide. It
  stays as the description beside a verdict ("the trunk 13 yellower than the photos'", the lion), for a texture
  prompt or a person.
- **In the pipeline.** A paid run measures each preview's pose before the refine, and each built model's likeness
  after it; a model its species' photos do not recognise is re-refined once with the species' most typical photo as
  the texture reference (10 credits) and the better of the two kept. The acceptance rule records the likeness stage
  (`models.json`); a species with no photos in the store, or a checkout without the network's weights, is not judged
  and not refused.

Limits, plainly: the photo sets are small (7 to 26 readable photos a species) and uneven (iNaturalist's wolf includes
dogs); between close kin the margins are a few hundredths; a model is told only from the species whose photos are in
the store (12 on 2026-11-12, among them the wolf, coyote, jackal, red fox and black bear), so a new species needs its kin's photos
fetched with its own; the picture is the generated source's, not the hero's graded map.

## A turned head set straight, a body set square (2026-11-12, `pipeline/straighten.py`)

The pose gate found the turned heads; refusing them would have cost a preview each. They are now turned back in the
mesh before anything is built from it, by one rule for every four-legged species, at no credits. The generator's file
is kept; `model_straight.glb` is written beside it once, with a record of what was found (`straighten.json`), and the
quadruped build, the hero build, the likeness picture and the pose gate all read that mesh (`straighten.source`).
Only positions and normals differ: the texture, its coordinates and the triangles are the generator's.

How, in the order it runs:

1. **The head's end, found on the solid.** The first measure took the surface's foremost point, and a moose's antler
   tines reach past its muzzle (a leopard's whiskers past its nose); horns and ears in that slab also pulled the head's
   middle toward the body's line. The part ahead of the fore feet is now filled as a solid, everything thinner than
   2.5 % of the body's length taken away (ears, tines, whiskers), and the head's end is the front of what is left. The
   same heads read further off than before: the bison 17.9 degrees (14.1), the moose 10.3 (6.5), the wolf 26.2 (25.1).
   The gate's limit moved with the measure, to 9.9: the gap is 9.4 (the cheetah, no turn seen) to 10.3 (the moose, its
   muzzle off the line from the front). By it, 12 of the 21 served sources were over the limit.
2. **Where along the neck and head each vertex sits**, 0 to 1: the steady state of heat on the mesh, the trunk and
   legs held at 0 and the nose at 1. What hangs from the head takes the value where it joins, so antlers and horns
   reaching back over the shoulders go with the head whole; a hump, a mane or the withers touch the trunk under them
   and stay.
3. **The neck and head's centreline seen from above**, through the middle of each band of that field (weighted by
   where the field climbs, which leaves ears and horns out), fitted by one smooth curve that leaves the neck's base
   along the trunk.
4. **The unbend.** The curve is laid straight along the trunk's own line with its length kept, and every vertex goes
   with its place on it. Heights do not change: a lowered head stays lowered.
5. **The body set square.** The whole animal can stand turned in the file: the wolf stood 16.9 degrees off the axis
   the build and the rig take for forward, so in the game its body ran crabwise to its own skeleton (the mountain goat
   12.2, the coyote 7.7; fifteen of the 21 under 2). Over 2 degrees, the mesh is turned onto the nearest axis.
6. **The check.** The pose is measured again. Nothing is written when the head was turned over 45 degrees, is still
   over 3, or an edge in a hundred changed length by more than a factor of 2; the pose gate then refuses the mesh for
   its head, as before.

What it did, measured:

| | |
|---|---|
| served sources with a head turned over 3 degrees | 14 of 21 (5.5 to 38.4 degrees) |
| after straightening | 0.1 to 2.3 degrees, all 14 |
| volume and surface area of the 14 meshes | within 0.6 % and 0.7 % of what they were |
| the most an edge in a hundred changed length | a factor of 1.04 to 1.83 (the wolf, 26 degrees on a short ruffed neck) |
| every mesh in the library (37 distinct) passing the pose gate | 28, where 12 did |
| heads over the limit that could be straightened | 20 of 21 (a moose from a photo was left at 3.4, and is refused) |
| the game's rebuilt models, head off the body's line | 0.4 to 3.8 degrees (was 6.0 to 37.2) |
| the game's rebuilt models, body off the forward axis | within 0.2 degrees (the wolf was 16.7) |

By eye, on each of the 14 from above, the front and three-quarter, before and after
(`straighten_sources_before_after_1.jpg` and `_2.jpg` in the captures): each faces forward, the antlers and horns sit
square on the head, and I could find no tear, fold or smeared texture. In the game's own renderer the hero wolf and
bison walk with the head along the body where the wolf ran crabwise with its head aside
(`straighten_game_before_after.jpg`: the lineup page, the old models from the main checkout beside the new;
`straighten_game_models_before_after.jpg`: all 14 game models from above and the front, drawn from their files). On the test's lofted
animal with its neck swung 35 degrees, the neck's centre comes out within 1.3 % of the body's length of the line and a
bar set along the head 4 degrees off it (`tests/test_straighten.py`).

**All 14 models were rebuilt from the straightened mesh** (the 13 served and the held coyote; no credits), and the
wolf's, the bison's and the coyote's hero tiers with them (the bison's ears, which the ear finder could not find
under its horns on the turned head, are found on the straight one: 22 joints now). Nothing changed in what is served; the coyote is still
refused by likeness (0.77 against the jackal's 0.78). Two rules had to be corrected on the way, because a square
animal showed them up:

- **The build's tail finder** took the rear face of the mountain goat's rump for an 18 cm tail once the goat stood
  square to its cut. A tail now has to reach further along its surface from where it joins the body than that join's
  half-width. The 14 tails the build finds read 4.0 to 40.7 on that ratio and the hippo's stub 2.0; the goat's rump
  face 0.74 (the cut moves on and finds its real 3.5 cm stub) and the coyote's tail, fused to its rump and legs by
  the remesh, 0.67 (no tail part, as for the wolf).
- **The horn check** read the same goat's horns as 1.5 cm: one nub the voxels found kept it from looking at the horn-
  coloured pieces, where the horns are 22 cm. It now looks at the pieces when the voxels find nothing or only a nub.

What a turned head costs now: nothing. Of the meshes on disk about three in four pass the pose gate (28 of 37) where
one in three did, so a species is back near 37 credits by that rate (20 x 37/28 for the previews, 10 for the refine),
not 50, and the 347 credits above the reserve are about nine species. That rate is from 37 meshes, a third of them
from photos.

Limits, plainly: the largest turn it has been seen to fix is 38 degrees; the fitted curve is one bend and its return,
so a neck with two bends would come out wavy and be refused by the check; the texture's painted light and any
asymmetry the generator drew for a turned head (an ear folded, fur swept) stay; **a bent spine is not straightened**
(the wild dog is served with 6.3 degrees, the coyote has 4.4), though the same unbend could be run along the trunk;
a stride is not undone.

**The hero answers the light as the old models do.** The first home captures looked too bright, so both paths were
given the same flat grey and the pixels read, in sun, under trees, at 9 and at 17 and in the misty arrival: they agree
within 1.2 %. What differed was the painted coat. One rule now applies to every hero map (`grade` in the index):
saturation is only ever scaled down to the old palette's, and value scaled to its luminance (the lion: saturation
x 0.895, value x 1.176; the wolf, bison and grizzly near 1). The lion is still about 15 % more saturated than the
hand-built one.

## The bobcat: refused for 50 credits, and a gate on the preview's shape (2026-11-12)

The first home species through the gates. Aaron approved "about 37 credits"; the run was capped at 50 and spent all
of it, and the model is refused. The hand-built bobcat draws as before; nothing in the client changed.

**Before any credits** (all free):

- The description, read from Wikipedia and Animal Diversity Web, was wrong in ways that would have misled both the
  prompt and the check, each fixed as a reading rule in `pipeline/appearance.py`:
  - *The tail.* "47.5-125 cm long from the head to the base of its distinctive stubby tail, averaging 82.7 cm" gave the
    tail 82.7 cm, and "a total length, including the tail, of up to 125 cm" gave it 125: the bobcat's tail was recorded
    as 47 to 51 cm. A tail named inside a longer measure's phrase is no longer the subject, and "from the head to the
    base of the tail" is the head and body. Now: tail 10 to 19.5 cm, head and body 0.65 to 1.04 m, total 1.25 m, and
    the mesh prompt gains "Tail short, about 15 cm".
  - *"Long".* "The tail is 9 to 20 cm long" made the tail both "short" and "long": a "long" that only closes a figure
    is not a word for the tail.
  - *Eyes and nose.* "Its eyes are yellow with black slit pupils" and "the nose is pinkish-red" made the body black,
    yellow and pinkish-red: a colour said of the eyes or the nose is not the coat's.
  - *A sentence that goes on.* "A few melanistic bobcats have been sighted ... They appear black" made the body black:
    a sentence beginning They, These, Those or Such is dropped with the one before it when that one was about a colour
    form, the young or another animal.
  - Ear tufts are tufts ("black tufts" was the head's ground colour).
- The same rules re-read on the stored species from their cached sources: the colours of one change (the Canada goose loses "legs black",
  read from a sentence about goslings; its stored record was left), the features of six (the pronghorn, hippo,
  leopard, buffalo and grizzly lose a "long" that closed a figure; the cougar's total length reads 2.05 to 2.4 m,
  not 1.95 to 2.58), rewritten; `--accept`: 0 changes in what is served.
- Photographs: the bobcat's (97 openly licensed candidates, 14 the judge can read), the Canada lynx's (85, 11) and
  the house cat's (25, 2). With them the store's photos left out one at a time land on their own species 194 times
  of 213 (91 %, 14 species); no bobcat was taken for a lynx or a lynx for a bobcat.

**The run** (`python -m pipeline.fauna_models utm10n_680_4280 --budget 50 --codes lynx_rufus`; `--codes` now names
species for a paid run, a tile slot or a four-legged species' trait card):

| job | credits | result |
|---|---|---|
| preview | 20 | passes the pose gate (head 1.3 degrees, spine 0.9) |
| refine | 10 | colours pass; no black bars or streaks; tail too long |
| refine again, for the markings | 10 | markings pass; kept |
| refine again, from the species' most typical photo | 10 | likeness no better (0.63); not kept |

The model is a lean orange cat with a long hanging tail (`likeness_bobcat_refused.jpg`). Refused twice over: the tail
is 0.43 of the head and body where 0.17 is described, and it is nearer the cougar's photos (0.72) than the bobcat's
(0.66). By eye the same: no bobbed tail, no cheek ruff, no spots. Balance 597.

**What the run showed was wrong in the pipeline**, each fixed as a rule:

1. *The prompt asked for it.* Every four-legged mesh prompt says "tail hanging free clear of the legs", and the
   bobcat's then said "Tail short, about 15 cm". A tail described short is now asked for as "the short tail a stub,
   held clear of the legs".
2. *The shape was measurable at 20 credits.* The long tail is in the untextured preview. `fauna_models.shape_gate`
   builds the preview to a scratch file (7 s) and measures the described shape on it (the tail against the head and
   body, the horns against the withers) before the refine is paid. Over the library's 30 text previews it refuses
   three (the bobcat's, and the mountain goat's two with an ibex's horns, both of which were refined and neither
   of which is the model served), none of them behind a model that is served, and finds one the build cannot use (a
   wildebeest's, which was refined and is not the model served).
3. *A wrong shape was given two more textures.* A model whose shape fails after the refine gets no texture retry.
4. With 2 and 3 the same preview would have cost 20, not 50.
5. A dry run rebuilt the species from its newest paid refine and registered it (the bobcat's entry was rewritten from
   the run's ledger); a dry run no longer builds.
6. A model the rule alone refuses, never drawn and never judged, counted as "accepted: drawn, no rejection recorded"
   among the recorded verdicts (`appearance.known_verdicts`); it is left out. The bobcat's verdict is recorded
   (rejected, by eye), so the rule is now measured on 42 verdicts: no accepted model refused, 10 of 12 rejected
   models refused.

**What it means for the cost.** "About 37 credits a species" counted only the pose. One species is not a rate, but
the estimate had no term for a preview of the wrong animal, and this one cost 50 with nothing to draw. The next try
at the bobcat is either a new text preview on the corrected prompt (20 to see its shape, 30 if it passes) or a mesh
from its best photo (30; the rule's `due`; four of the 97 photos stand whole, side-on and square enough).

**Left open**: the stored features of the moose and the spotted hyena are older than today's reading rule and
source text. Read again, the hyena's tail is "short" and the rule would refuse the served hyena (tail 0.37 of the
head and body against 0.25); both records were left as stored. The house cat has two readable photos, too few to
tell a bobcat from one.

### The second try (2026-11-13): refused at the preview, 20 credits

Aaron answered "Try again, 30". The run was capped at 30 (`--budget 30 --codes lynx_rufus`), paid for one preview
(20) on the corrected prompt and stopped there: the pose gate refused it and the budget had no second preview in it.
Balance 577; the bobcat has now cost 70 credits and has no model to draw. The hand-built bobcat draws as before.

- **What came back.** By eye, drawn side-on from the mesh: a cat standing with its fore feet together and a long tail
  that hangs to the ground, its end curled on it. The prompt said "the short tail a stub, held clear of the legs ...
  Tail short, about 15 cm". Two prompts, two long-tailed cats: twice is not a rate, but the words about the tail did
  not reach the mesh either time.
- **What the gates read.** The pose gate found three pieces on the ground where four feet should be, which is right
  (the tail's end is one of them). It also read "a fore stride of 1.48 leg lengths", which is wrong: the fore feet
  stand together, and with three pieces the gate cannot know which two are a pair. A stride is now read only between
  four feet. The build found no tail on this mesh (a tail joined to the ground is not found), so the shape gate, run
  alone, would have passed it as short-tailed: the tail finder's weakness (it finds none on 7 of 21) is a hole in the
  shape gate, and here the pose gate stood in front of it.
- **Rules fixed around the run.** (1) Named again after a refusal, the species would have been rebuilt from its
  newest paid refine (the photo one, not kept), called modelled and given no new preview: a species named whose
  record holds a refused model now goes to a new preview (`already_refused`). (2) Registering a new model replaced
  the species' jobs and dropped its re-refine and photo records: the earlier jobs now stay, the run's come last, and
  the records are kept (`jobs_with`). (3) A run that pays for previews and builds nothing left the species' record
  untouched: its credits, attempts and each refused preview with the reason now go on the record
  (`note_unbuilt`, `refused_previews`); the bobcat's reads 70 credits, 3 attempts.
- **What the gates saved.** The first try paid 30 credits after a failure that was in the preview; this one paid
  nothing after it.
- **What is left to try.** The text route has drawn a long tail twice. The other rung is a mesh from the rule's
  photo (30 credits; iNaturalist 205959042, CC BY 4.0, Ken-ichi Ueda): the animal stands side-on with all four feet
  down and the bobbed tail plain to see, and its head is turned to the camera, by eye about 70 degrees; the largest
  turn the straightening has set straight is 38.4. Not run: it waits for Aaron.

## What it looks like

In the session notes' `avatar-realism-captures`:
- `hero_canis_lupus_sheet.jpg`, `hero_bison_bison_sheet.jpg`, `hero_ursus_arctos_sheet.jpg`: the generated source, the
  game's old model and the hero model from three views, and the pose tests with old and new weights.
- `world_wolf_before_after.jpg`: the player's body on the Lamar tile, the old wolf against the hero wolf, standing and
  walking.
- `lineup_hero_gaits.jpg`, `world_grizzly_hero.jpg` (before the stance bound), `lineup_round3_gaits.jpg` (the hero
  wolf's and the elk's walk, trot and gallop after it), `lineup_round3_sits.jpg` (the wolf and the grizzly sitting),
  `lineup_hero_idle_round2.jpg`.

In Blender the hero is hard to tell from the generated source at the side and three-quarter views. In the game the old
wolf is faceted and its legs smear into a sheet at a walk; the hero wolf is a textured animal with a soft coat edge
standing in the scene's light.

## What a species costs

| | |
|---|---|
| credits | 30 for a new source (none if a textured refine is already on disk: 19 leg-engine species have one) |
| machine time | about ten minutes of Blender for the hero tier |
| download | 2.2 to 2.6 MB a hero species, on top of the game tiers, fetched only for species on the tile |
| GPU memory | 35 MB a hero species as built; see "next" for cutting it |
| frame | about 2 ms for the player's fur at 8 shells; the pool's hero tiers cost what a textured mesh costs |

## What is weak, and the order I would take it in

1. **Eight home species still have no source to build from** (the lion and the coyote now do). The elk, mule deer,
   bobcat, black bear, fox, otter and the rabbits were hand-built or reduced from previews Meshy has since deleted (it
   keeps output three days). Each needs a new generation (30 to 50 credits, so about 300 for the eight) and the loader
   wrapper. The deer is the hard one: it plays hero clips on its own skeleton, not the engine's. The rabbits need the
   hero tool to handle the lagomorph rig. Both gates now stand before the spending (above), and a turned head no
   longer costs a preview: it is set straight in the mesh (the section above), so a species was put near 37 credits.
   The bobcat, the first tried, cost 50 and is refused ("The bobcat", above): its preview was a long-tailed cat, which
   the shape gate now catches at 20; a second preview on the corrected prompt (20) had a long tail again and was
   refused at the gate ("The second try"). 277 credits stand above the reserve. Before generating, each species' and its
   kin's reference photos have to be in the store (the bobcat's and the Canada lynx's are; the elk, mule deer and
   grey fox were started).
2. **The neck and the jaw.** One neck joint is why the cats cannot groom and the deer cannot scratch, and why a head
   turned far looks like a roll. No jaw is why there is no yawn, no real chewing and no carrying
   ([behaviour-rig.md](behaviour-rig.md) item 3). A neck chain of three and a jaw, added the way the ears were.
3. **Volume.** Bone heat loses 15 to 21 % of the trunk's volume in the sit. A corrective (a bulge with the bend) or
   dual-quaternion blending in the skin shader.
4. **Texture memory.** 35 MB a species will not hold for a tile of twenty. Compressed textures (KTX2) and the
   full-size maps only for the body the player is in.
5. **A bent spine** is still a refusal (two of the library's text previews, and the served wild dog's 6.3 degrees):
   the head's unbend run along the trunk would straighten it, the legs going with their stations.
6. **The build's tail finder** (7 of 21 quadrupeds with no tail part: the wolf, the lion, the wild dog, the moose, the
   pronghorn, the bighorn, the grizzly; and the coyote's tail fused to its legs): fix the rule in
   `tools/build_quadruped.py`. (The hero tier finds its own tail and does not depend on it.)
7. **The legs are still the old proportions.** The skeleton is fitted from geometry with fixed fractions, and its leg
   is short for the body on the big ungulates (the elk's leg joints stand 1.0 m high under 1.3 m withers), which is why
   they now walk too quick; measured
   limb-bone lengths exist for 423 mammal species (Serio et al. 2024, Dryad; its licence to confirm) and belong in the
   fitter ([behaviour-rig.md](behaviour-rig.md) section 2).
8. **Eyes.** They are paint. A corneal highlight and a lid that blinks (dogs blink 14.5 times a minute: Tada et al.
   2013) need two small joints or a shader term.
9. **The idle clock across pages.** A mirror runs its own; it should take the host's as the stride clock does. The
   fauna-step species read generated rows without an `idle` block and get Mammalia's defaults until
   `pipeline/fauna.py` writes them.
10. **Attention.** `inp.look` is a hook nothing calls yet: the head and ears should follow sounds, scent and other
   animals. That is the AI's lane.

Not checked after the straightening (2026-11-12): any of the 14 rebuilt models on a tile in the world (the hero wolf
and bison were filmed walking in the lineup page; the other twelve were drawn from their files, not in the game's
renderer); the idle measures on the rebuilt heroes (`tools/idle_measure.mjs` not re-run); the rebuilt bison's new ear
joints in motion.

Not checked: the fur in motion at speed (stills only), the hero tiers on a phone-class GPU, two browsers as host and
mirror, anything on the home tile, the ears by eye (they are small on film; they rest on the measures), the world after
the last round (the stance bound and the sit were filmed in the lineup only). `tools/idle_measure.mjs` has a cost band
that failed once on a loaded machine (load 17) and passed on the next run.

## Licences

- The likeness gate's reference photos are CC0, CC BY or CC BY-SA only (iNaturalist research grade and Wikimedia
  Commons), each with its licence, author and page in `library/animals/references/<code>.json`. The photos themselves
  stay in the git-ignored cache and are never shipped; nothing of them enters a model unless a refine copies a coat
  from one, and then the job records it, as before.
- The embedding network is DINOv2 small (Apache-2.0; Oquab et al. 2023), the ONNX export Xenova/dinov2-small from
  Hugging Face (88 MB), pinned by SHA-256 in `pipeline/likeness.py`, kept in the git-ignored cache and run as data by
  OpenCV, as the photo rule's two segmenters are. Aaron approved the download on 2026-11-12. Nothing of it ships.
- Generated models are the account holder's under Meshy's paid-plan terms and ship under the project's CC BY-SA, as
  before; the hero tier is derived from the same jobs and records the source task in `extras.hero`.
- Meshy's own rigging is for humanoids only; the animal shape models (SMAL and its relatives) are licensed for
  non-commercial research and cannot ship; the rig stays ours.
- **To check:** Quaternius's models are no longer offered as CC0 (its licence now forbids redistributing them as
  assets). The coyote is recorded as a Quaternius CC0 download. CC0 cannot be withdrawn from a copy taken under it, but
  the record should show what applied on the day of the download; a generated coyote (item 1) removes the question.
