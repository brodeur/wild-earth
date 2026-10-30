# Movement: how every animal moves, and how to say it once

Aaron, 2026-10-29: "did you do this for all animals, if not, can you - and pay special attention to pipeline steps -
how do we reproduce this effectively for every species on the planet, what are the principles of movement that can be
broadly applied, and what is species level or even at the genus, family, order, class, phylum or kingdom levels."

This page answers that: the principles, which rank of the tree each belongs to, how the client draws them today, and
the pipeline that carries them from a species record to a moving body. The code: `library/animals/locomotion.json`
(the tree of principles and numbers), `pipeline/locomotion.py` (the resolver and the allometry), `client/src/locomotion.js`
(the client's reader), the controls (`groundControl.js`, `squirrelControl.js`, `flierControl.js`, `flight.js`,
`woodpeckerControl.js`), the AI (`animals.js`) and the rigs (`animalModels.js`).

## The principle, stated once

An animal is drawn by a few floats a frame (the part rig: phase, amplitude, pose, flick, plus four extras; the deer's
skin path: a clip, a phase, a blend and a bend). Nothing about how a body moves is written per species if a wider
group shares it. A fact is stated once at the widest rank where it holds, and a narrower group states only what
differs. A species states its size, its mass, its measured speeds where known, and its displays. Everything else
derives: from the taxon above it and from its body by allometry (the laws that relate speed, cadence and stride to
mass and leg length across animals). So a new species on a new tile moves from its taxonomy and its body alone, and a
naturalist's sign-off adjusts numbers, not code.

## The ranks, and what each one owns

| rank | what it owns | examples in the tree |
|---|---|---|
| kingdom (Animalia) | muscle pulls, so motion is a pull toward a point; mass sets the tempo (small is quick, large is slow); the body is drawn a beat behind the thing that moved it (the lag); nothing moves by itself: a limb pushes against the world and the body follows (the stepping turn) | `lag`, `turn` defaults |
| phylum (Chordata) | an axial skeleton: the head leads, the spine bends toward the turn, the tail trails; bilateral, faces where it goes | `bend` (the spine's share of the lag, the head's lead) |
| class | the limb plan and the gait family. Mammalia: limbs under the body, walk / trot / gallop by the Froude number of the hip height, a flexing spine in the gallop, a level head, an aerobic sprint of seconds to a minute by size. Aves: a biped on the ground that walks or hops with the head bobbing to hold the eyes still, wings that flap, glide and stoop, the head leading a turn on the neck. Reptilia (Squamata): sprawling limbs, the body undulating with the stride, a turn as a C-bend, a sprint of a second or two then rest (ectotherm) | `posture`, `gaits`, `sprint` scaling |
| order | the foot and the travelling gait. Artiodactyla: unguligrade on hooves, a stiff walk, a long trot, a bounding gallop, the frozen head-high alert. Carnivora: digitigrade or plantigrade, the flexible spine, the stalk, the rush, the pounce. Rodentia: the bound, the sit-up, the freeze. Lagomorpha: the half-bound hop, the pivot on the hind feet, the freeze then the zigzag burst. Galliformes: runners first, a burst flush. Passeriformes: the hop, flap-and-glide. Accipitriformes and Cathartiformes: the soar. Piciformes: undulating flight, the cling | `gaits`, `cruise_of_top`, `turn` (rate and step), `lag` for the small orders |
| family | the character of the gait and the signature moves. Cervidae: the stot, the rump flag, the file. Canidae: the trot as the travelling gait, the tail's mood. Felidae: the crouched stalk and the explosive short rush, a cat does not run far. Ursidae: the amble (a pace), the bounding burst. Sciuridae: the tail flag, head-first down a trunk. Cricetidae: the scurry in runways. Corvidae: walk as well as hop. Odontophoridae: the covey's file, the topknot | `stot`, `stalk`, `tail_flag`, the sprint's length, the turn's amplitude |
| genus | rarely anything: a genus differs from its family in size more than in motion | (empty in the tree today) |
| species | its size and mass (the record), its own measured speeds where known (`top_mps`, `cruise_mps`, `stalk_mps`), its displays (the lizard's push-up, the turkey's strut, the quail's assembly call), its colours, its calls | the `species` block, the record |

Below the species: the individual (its seed: a per-animal phase, a herd rank, a size variance) and the moment (its
state: fleeing, grazing, bedded; its needs: hungry is slower). Those are the AI's, not the library's.

## The principles as the client draws them today

- **The legs move first and the body follows** (kingdom). A standing turn over 0.45 rad/s plays the walk at 0.4-0.6
  of its stride at a rate from the feet's travel round the turn; the drawn body lags the control yaw by 0.15 s, at most
  25 degrees, fully when standing and not at all at a walk; a planted foot travels round the turn, not straight back
  (the leg's swing turned about the vertical: the fore feet toward the turn, the hind feet away). Deer (the skin path,
  commits 41ca4f4 and fc7bfb0), fox, coyote, lion, bear (the part rig, f09af03); the rodents, the ground birds, the
  lizard and the squirrel the same day, each in its order's way (a rabbit pivots on its hind feet with hops of the
  fore feet; a bird steps in place with the head leading; a lizard C-bends).
- **The head leads and the spine bends** (phylum). The deer's forequarters swing toward the heading the hips lag
  behind (a fan about the hips, nothing at the hips, all of it from the neck base), the head a little ahead of that.
  The part rig has no spine bend yet (open: the chest and head parts could carry it).
- **Gaits by the Froude number** (class Mammalia). Walk to Fr 0.5, trot to 2.5, gallop beyond, of the hip height: the
  controls' `walk`, `trot` and `run` and the AI's gait amplitude follow these bands; the deer's clips change at them.
- **A cruise that is not the top, and a sprint sized to the body** (class, order, family). Every body holds a cruise
  on W and sprints on Shift at its true top for seconds that scale with mass to the quarter power from 10 s at
  50 kg, a cat's rush short, a canid's long (61a9b7d). The tree gives the shares and the exponents; the records'
  masses give the seconds.
- **The bound, the hop, the sprawl, the flush, the soar** (order). Each is a rig template: the rodent template's bound
  and sit-up, the reptile template's sprawl and lateral wave, the bird template's walk, flush and wings, the quadruped
  template's walk, trot and gallop. A species names its template through its body plan; the template's constants are
  per species only where the sign-off wanted them (`RIG` in animalModels.js).

## The pipeline

1. **The record** (`library/animals/<code>.json`): `taxonomy` (kingdom to genus), `mass_kg`, `size` (length, shoulder
   or wingspan), `body_plan`, the mesh and its rig template, the clips if any. A species' own measured speeds go in
   `locomotion.json`'s `species` block, with the source.
2. **The tree** (`library/animals/locomotion.json`): one node per taxon with a note (the principle in words) and the
   numbers that hold for every member: the turn's thresholds and step, the lag, the spine's share, the gaits, the
   cruise's share of the top, the sprint's length at 50 kg and its mass exponent, the posture, the flags (stot, stalk,
   sit_up, tail_flag, turn_bend, head_lead, cling).
3. **The resolver** (`pipeline/locomotion.py`): merges the chain kingdom -> phylum -> class -> order -> family ->
   genus -> species, deeper winning key by key, then derives the numbers nobody wrote from the body: the walk and
   trot tops from the Froude bands of the hip height (Alexander & Jayes 1983), the top speed from mass (Garland 1983,
   capped for the small and the birds), the cruise as the taxon's share, the stride rate at the trot-gallop change
   from mass (Heglund & Taylor 1988) and the stride length from it, the sprint and recovery from mass and the taxon's
   exponent, the on-the-spot turn rate and the lag from the body length. `python -m pipeline.locomotion` prints the
   table for the library; the `species` step of a tile build writes `tiles/<id>/locomotion.json` for the species
   present (step 4 below).
4. **The tile** carries `locomotion.json` (a table layer like `perception.json`), fetched by `tilepackage.js` as
   `tile.locomotion`.
5. **The client** (`client/src/locomotion.js`): the hand-tuned tables (`GROUND`, `FLIERS`, the rig constants) win
   where they give a value, because a naturalist or Aaron tuned them by eye; the table fills what they leave out
   (today: cruise, sprint, recover for a species that has none) and gives a whole entry for a species with no
   hand-tuned one, so a new species moves at once. Where a derived number and a tuned one disagree by much, the table
   is the thing to question first (the deer's derived cruise is 9.2 m/s where the tuned one is 7: the tuned is a
   doe's trot, which is right for a herd on the move).
6. **Sign-off**: the lineup page shows each species idle, walking, running, turning and alert at true scale; the
   naturalist corrects the record's numbers or the tree's, never the code.

## For every species on the planet

What scales: the tree is small (a few dozen nodes for the vertebrate classes and the common orders and families) and
every species of an order inherits it; the records are a taxonomy, a mass and a size, which GBIF, Wikidata and the
field guides give for every described species; the allometry fills the numbers; the rig templates are per body plan,
not per species (quadruped, rodent, bird, flier, reptile today; a snake, a frog, a fish, a bat, an insect's tripod
gait and a spider's eight are the next templates, each one shader path on the same four floats). What does not
scale and is not meant to: a hero species' own clips (the deer), which stay rare.

What is missing, in order: the spine bend on the part rig; the templates for Amphibia (the hop and the swim), Pisces
(the undulating swim), Serpentes (the lateral wave without limbs), Chiroptera (the flap on a membrane) and the
arthropods (the tripod gait at six legs, eight for the arachnids); the Froude bands driving the AI's gait choice
directly from the table instead of the per-species `trot` constants; an individual's variance (a limping old deer, a
fawn's higher cadence); and the turn's hoof planting measured against the ground rather than inferred from the clip.

## The catch

Aaron, 2026-10-30: a bit of reading on how each species catches its prey, then the rigging, so a kill reads as a bodily
act rather than a distance check. The reading, by family (the catch is a family-level principle: a cat's leap and neck
bite, a canid's mousing pounce, a hawk's talon strike, a corvid's bill stab), with its sources; then how the client
draws each, step by step as the branch lands them (docs/decisions.md "the catch rigged").

**The prey's death** (every family). A killed animal falls over 0.4 s (animals.js `CARRION.fall`, `lieStill`): the roll
onto its side and the drop follow the square of time (gravity: slow to start, hard at the ground), the gait's
amplitude slackens to nothing, the pose goes to the species' rest (the deer's bed clip blended in at a third of its
usual time; a lizard flat), the running pitch levels; where it died on a rock it stays on the rock. The lizard is prey
(solitary, nothing to unwind): the fox's pounce, the raven's and the jay's takes land on it.

**Felidae: the leap and the neck bite.** The mountain lion is a stalk-and-ambush cat with small lungs that cannot run
far; it closes in cover, then an explosive series of bounds, strikes from behind, launches onto the prey's back and
hangs on with its claws while it delivers the killing bite to the nape at the base of the skull or to the throat
(suffocation); over within seconds. Then it feeds at the kill, crouched over it, head low. Sources: WildSafeBC,
"Cougar" (https://wildsafebc.com/species/cougar/); ExplorersWeb, "Dealing with wildlife, part 1: cougars"
(https://explorersweb.com/dealing-with-wildlife-part-1-cougars/); Santa Cruz Puma Project
(https://www.santacruzpumas.org/?p=1478). In the client (animals.js M_LEAP and M_FEED, HUNT.leapD; groundControl.js
CATCH.leap): the rush's last bound within 3.2 m is a leap of 0.45 s that homes on the prey and lands with the
forequarters over its back, the fore pair reaching (the gallop's flight pose held, then gathered under it), the body
pitching from nose-up to nose-down, the head driven down into the neck; the kill is rolled at the landing; then
45 s crouched over the kill (poseMax, the head low and working), a miss a twist away. The player's lion does the same
from its rush (the leap takes the controls for 0.45 s), and crouches to feed until a key moves it (E beside a kill
crouches again).

## Open

- The part rig's spine bend and head lead (the chest and head parts turning about the vertical by the lag).
- The AI's gaits from the Froude bands of the table.
- The tree's numbers for the birds' ground speeds (Garland's fit is for mammals; capped at 4 sqrt(g h) for now).
