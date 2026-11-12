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
| 1. Source | a generated mesh with a painted coat, standing square | `tools/meshy_generate.py`, `pipeline/fauna_models.py` (30 credits: preview 20 + 2K refine 10, or image-to-3D 30) | the model acceptance rule and the judge, as today |
| 2. Game tiers | the reduced tiers, the 20-joint skeleton fitted from geometry, the far tier's baked cycles | `tools/build_quadruped.py`, `tools/rig_quadruped.py`, `tools/bake_gait.mjs` | as today; these stay as the far tier and as the fallback |
| 3. Hero tier | the source's surface on a clean 20,000-triangle mesh with new UVs, colour, normal and occlusion maps baked from the dense source, weights computed on the hero mesh itself, a tail chain, ear joints, a hair-length factor per vertex, two more LODs | `tools/hero_model.py` (Blender, headless) | alignment residual; eight pose tests (inverted faces, edge stretch, skin spanning the legs, trunk volume); bytes under 3 MB a species |
| 4. On screen | hero LODs in the species' shared pool, the full hero with fur shells for the player's body, one draw a tier, lazy, with a switch | `client/src/hero.js`, `animalMaterial({hero})` | sampler and attribute counts read from the GL programs; frame cost by shell count; texture bytes |
| 5. Motion | strides that vary (yesterday's lane), then the idle layer: breathing, weight, gaze, ears, tail, and acts chosen by a director, all read from the taxonomy tree | `client/src/gait.js`, `client/src/idle.js`, the tree's `vary` and `idle` blocks | `tools/gait_measure.mjs`, `tools/idle_measure.mjs`: rates against the tree, feet never slide, same seed same behaviour, an act a skeleton cannot do is left out by a reach test |

Nothing in stages 3 to 5 is written per species. The tool ran unchanged on the wolf, the bison and the grizzly.

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

1. **The ten home species have no source to build from.** The coyote, elk, mule deer, cougar, bobcat, black bear, fox,
   otter and the rabbits were hand-built or reduced from previews Meshy has since deleted (it keeps output three days).
   Each needs a new generation (about 300 credits for all ten) and then to enter as a pipeline model, with its
   hand-built model kept as the fallback. This is the step that puts the result in front of a player on the home tile.
2. **The neck and the jaw.** One neck joint is why the cats cannot groom and the deer cannot scratch, and why a head
   turned far looks like a roll. No jaw is why there is no yawn, no real chewing and no carrying
   ([behaviour-rig.md](behaviour-rig.md) item 3). A neck chain of three and a jaw, added the way the ears were.
3. **Volume.** Bone heat loses 15 to 21 % of the trunk's volume in the sit. A corrective (a bulge with the bend) or
   dual-quaternion blending in the skin shader.
4. **Texture memory.** 35 MB a species will not hold for a tile of twenty. Compressed textures (KTX2) and the
   full-size maps only for the body the player is in.
5. **The build's tail finder** (4 of 19 fauna models without tail weights) and the **ear finder under horns** (the
   bison): fix the rules in `tools/build_quadruped.py` and `tools/hero_model_blender.py`.
6. **The legs are still the old proportions.** The skeleton is fitted from geometry with fixed fractions, and its leg
   is short for the body on the big ungulates (the elk's leg joints stand 1.0 m high under 1.3 m withers), which is why
   they now walk too quick; measured
   limb-bone lengths exist for 423 mammal species (Serio et al. 2024, Dryad; its licence to confirm) and belong in the
   fitter ([behaviour-rig.md](behaviour-rig.md) section 2).
7. **Eyes.** They are paint. A corneal highlight and a lid that blinks (dogs blink 14.5 times a minute: Tada et al.
   2013) need two small joints or a shader term.
8. **The idle clock across pages.** A mirror runs its own; it should take the host's as the stride clock does. The
   fauna-step species read generated rows without an `idle` block and get Mammalia's defaults until
   `pipeline/fauna.py` writes them.
9. **Attention.** `inp.look` is a hook nothing calls yet: the head and ears should follow sounds, scent and other
   animals. That is the AI's lane.

Not checked: the fur in motion at speed (stills only), the hero tiers on a phone-class GPU, two browsers as host and
mirror, anything on the home tile, the ears by eye (they are small on film; they rest on the measures), the world after
the last round (the stance bound and the sit were filmed in the lineup only). `tools/idle_measure.mjs` has a cost band
that failed once on a loaded machine (load 17) and passed on the next run.

## Licences

- Generated models are the account holder's under Meshy's paid-plan terms and ship under the project's CC BY-SA, as
  before; the hero tier is derived from the same jobs and records the source task in `extras.hero`.
- Meshy's own rigging is for humanoids only; the animal shape models (SMAL and its relatives) are licensed for
  non-commercial research and cannot ship; the rig stays ours.
- **To check:** Quaternius's models are no longer offered as CC0 (its licence now forbids redistributing them as
  assets). The coyote is recorded as a Quaternius CC0 download. CC0 cannot be withdrawn from a copy taken under it, but
  the record should show what applied on the day of the download; a generated coyote (item 1) removes the question.
