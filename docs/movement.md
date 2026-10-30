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
- **The feet plant and the knees bend** (kingdom, class, order; 2026-10-30, "The legs" below). The drawn quadrupeds
  other than the deer are skinned to one skeleton and posed live by the gait engine from their locomotion row: the
  gait by the Froude bands, the footfalls of the gait diagrams, each foot held where it landed and swung to a plant
  point read from the terrain, the legs solved by IK, the body's height and pitch from the planted feet.

## The legs (2026-10-30): a skeleton and a gait engine for the quadrupeds

Aaron: "the leg rigging for quadrupeds still needs work - how do we get a good result". The part rig swung each leg as
one rigid box about the shoulder or hip from sin(phase): no knee, no foot, the feet sliding over the ground, a slope
met by pitching the whole body. Now every drawn quadruped (the gray fox, the coyote, the mountain lion, the black
bear) is skinned to one standard skeleton and posed by a gait engine, `client/src/gait.js`, that plants the feet on
the terrain and bends the knees; the deer keeps its hero clips. The code: `tools/rig_quadruped.py` (the skeleton and
the weights from a built GLB's geometry), `client/src/gait.js` (the engine), `tools/bake_gait.mjs` (the far tier's
cycles from the same engine), `animalModels.js` (the `SKIN_LIVE` shader branch and the pose texture).

**The skeleton** (`tools/rig_quadruped.py`, the same 20 joints for every quadruped): Hips (the root), Spine, Chest,
Neck, Head, a tail chain of three, and per leg three bones: the upper (the shoulder or hip joint to the elbow or
stifle), the lower (to the wrist or hock), the foot (the wrist or hock to the toe). Every joint's rest orientation is
the identity, so a bone's matrix in the pose texture is [R | p - R q] for its posed head p, rest head q and rotation
R. The joints come from the geometry alone (no source skeleton: the Meshy meshes never had one and the Quaternius
sources are not in the repo): the elbow and stifle are the part pivots the build scripts found at the belly line, the
wrist and hock sit at a fraction of that height (digitigrade 0.42 and 0.5, plantigrade 0.4 and 0.45 with the heel
behind the toe), each centred on the leg column's vertices at its height, the toe at the paw's print; the shoulder
joint above and ahead of the elbow in the chest (the humerus slopes down and back), the hip above and behind the
stifle (the femur down and forward); a vertex ring is cut at each joint so the low-poly leg has an edge to bend at.
Weights go by height along the leg with a short blend at each joint; the arm and thigh skin above the elbow and
stifle takes the upper bone fading toward the shoulder and hip; the trunk splits Hips / Spine / Chest by z; the head
part Neck / Head; the tail by its arc. The record's `rig` field names the joints and the posture.

**The engine**, by the rank of the tree each principle belongs to:
- *kingdom* a limb pushes against the world and the body follows: a foot that has landed is held at the world point
  where it landed while the body passes over it; it lifts at the duty factor's phase and swings on an arc to the next
  plant point, predicted half a stance ahead of where its shoulder or hip will be at touchdown (the body's speed and
  turn rate carried forward), the height read from the terrain there. A standing turn is the same cycle run at the
  turn's step rate: the feet step round the turn because their rest offsets turn with the body, and the body follows.
- *class* Mammalia: the gait by the Froude number of the hip height (the row's `walk_mps`, `trot_mps`, with
  hysteresis); Hildebrand's footfalls (the walk's lateral sequence LH 0, LF 0.25, RH 0.5, RF 0.75; the trot's diagonal
  pairs at 0 and 0.5; the transverse gallop LH 0, RH 0.15, LF 0.5, RF 0.65, a rotary one for the cats and dogs at
  speed, the bound for the rodents later); the duty factor from 0.72 at the slowest walk to 0.5 at the trot and 0.4
  in the gallop; the cadence rising as v^0.45 to `stride_hz` at the trot-gallop change and nearly flat beyond, where
  the stride stretches instead (Heglund & Taylor); the body vaulting at a walk, springing at a trot, rising once a
  cycle in the gallop; the spine arching as the hind feet come under and extending as the fore feet reach; the head
  counter-pitched level over the stride (and dipped by the flick, raised when alert); the shoulder sliding fore and aft
  with its foot (the scapula's swing, which gives a real leg its reach) and a leg out of reach straightening toward
  its toe.
- *order* the foot: digitigrade (Carnivora: up on the toes, the wrist and hock in the air, the foot bone standing on
  its toe and flexing in the swing), plantigrade (Ursidae: the sole flat, the ankle low behind the toe); the bear's
  amble is a pace (the lateral pairs together) where the others trot, from the tree's `gaits.walk: amble`.
- *phylum* the head leads a turn and the spine bends toward the heading the hips lag behind (the deer's `bendOf`):
  the fore segment of the spine yaws about the Spine joint, the shoulders go with it and the planted fore feet stay,
  the IK taking up the difference; the tail lags the turn and swings with the gallop.
- *species* only its row (the Froude bands, the cadence and stride at the trot-gallop change, the posture, the turn
  block) and its skeleton; nothing is written per species in the engine. A tile without a locomotion table gets the
  numbers from the body (the hip height and a mass from it).
- The body's height is the planted feet's: the hips sit over the ground under the hind feet and the chest over the
  fore feet (the back following 80 % of a slope, the legs bending for the rest), the body rolling onto the supporting
  side; the instance matrix no longer pitches a live body with the slope. Pose (the AI's `aAnim.z`) crouches the body
  to a half (the lion's stalk, the bear's dig) and past it lowers it onto the ground with the legs folded (a sphinx:
  the fore legs under the chest, the hind legs alongside, the tail along the ground); a body in the air (a jump, a
  pounce) tucks its feet and replants on landing.

**The output**: live rows in the species' clip texture (32 rows after the baked frames, the texture then RGBA32F;
`LIVE_ROWS` in animalModels.js, `model.live`), the engine writing a row per near instance per frame (`writeRow`) in
the frame `tools/bake_clips.py` writes, and the skin shader reading the instance's row with its existing `skinFrame`
when `aClip.x` is negative (`SKIN_LIVE`): no new vertex attribute (the Metal limit) and no second sampler (the GPU's
sixteen texture units were already full with the atmosphere's and the bone texture; a separate pose texture was the
seventeenth and three.js warned). The AI's instances take the first rows (`legs.js` LegsPool, within the species'
lod1 radius, a row sticking to an instance until it leaves), the player's body the last (LegsBody). Far instances
take cycles baked offline by the same engine (`tools/bake_gait.mjs`: Idle, Walk, Trot, Gallop, Bed as
`<name>_clips.bin` + `.json`), driven by distance over each clip's stride (`farDrive`), so the far tier is the same
shader with a clip, as the deer.

**In the world** (2026-10-30, the same day): `animals.js` builds a LegsPool per legged species and, per frame, poses a
live instance from its position, drawn yaw (turnFollow's), speed, turn rate, pose, flick, the spine's bend (the control
yaw against the drawn), the lion's tail twitch and whether it is in the air (a pounce, a tree), the terrain from the
tile's heights; a live body's matrix stays level (the slope is in the legs), the far tier keeps its pitch. A dead
animal is bedded by the engine and rolled onto its side by the matrix as before. `groundControl.js` does the same for
the player (the footing's surface for the feet, the signed speed so backing steps backward, the jump in the air),
with pose to a half as the crouch (the lion's stalk). `?feet=1` draws every live foot's plant point.

**Sign-off**: `client/lineup_animals.html` runs the engine on the legged rows at `walk`, `trot`, `run` and `turn`, the
body travelling along the row with the camera following so a planted foot can be seen staying put on the ground
beside the fixed pole while the body passes; `&feet=1` marks each foot's plant point (red the fore, blue the hind,
small while swinging), `&slope=<deg>` tilts the ground, `&speed=<m/s>` sets the speed, `&far=1` draws the baked cycles
instead. Checked 2026-10-30: the coyote's walk (the planted feet still beside the pole over three frames), trot
(diagonal pairs), gallop (gathered and stretched), standing turn, bed and sniff; the fox's walk, the lion's walk,
gallop and bed, the bear's amble; in the world the player's coyote walking (a side camera: `ground.camSide = 1.4`),
up an 18-degree slope (the back pitched 14 degrees, the feet on the ground, the hips 6 cm below the chest's ground),
stepping round a standing turn at 2.2 rad/s (1.5 steps a second), galloping; AI foxes live within 56 m and on the
Walk and Bed clips beyond; the AI update 0.8 ms a frame with the mammals on the engine. Not checked: the lion and
bear in the world (none near the start), the deer herd silhouette's rows, the Yosemite tile.

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

What is missing, in order: the rodents' bound and the ground birds' walk on the leg engine (their templates still
swing rigid legs; the engine's footfall table has the bound ready); the deer on the engine where its clips run out (a
trot, a slope); the templates for Amphibia (the hop and the swim), Pisces
(the undulating swim), Serpentes (the lateral wave without limbs), Chiroptera (the flap on a membrane) and the
arthropods (the tripod gait at six legs, eight for the arachnids); the Froude bands driving the AI's gait choice
directly from the table instead of the per-species `trot` constants; an individual's variance (a limping old deer, a
fawn's higher cadence); and the turn's hoof planting measured against the ground rather than inferred from the clip.

## Open

- The part rig's spine bend and head lead (the chest and head parts turning about the vertical by the lag): done for
  the quadrupeds on the leg engine (2026-10-30); open on the rodent, bird and reptile templates.
- The AI's gaits from the Froude bands of the table: the leg engine picks its gait so (2026-10-30); the AI's own
  speeds (`MAMMAL` walk / trot / run) are still hand-set, not the row's.
- The leg engine's numbers to tune by eye against footage: the duty factors, the cadence exponent (0.45), the swing
  clearance, the walk's reach; the rotary gallop for Carnivora in the tree (`gaits.gallop`); a fore-aft asymmetry in
  the Meshy lion's forelegs that the rig follows.
- The tree's numbers for the birds' ground speeds (Garland's fit is for mammals; capped at 4 sqrt(g h) for now).
