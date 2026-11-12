# The behaviour rig: bodies that hold, carry, build and feed, and strides that are never the same

A design note, 2026-11-11. Its first lane is built (section 5, stride variation: [movement.md](movement.md) "Strides
that vary"); nothing else here is. It follows [movement.md](movement.md) (how every animal moves, said
once) and [animal-library.md](animal-library.md) (the meshes and the rig templates), and proposes the next layer.

Aaron, 2026-11-11: "I really want to think through the rigging for the animals - I feel like it is going to be a core
driver of whether it feels good or not. We know the taxonomy of species, and the different categories of movement. The
animals are getting better but still a bit funky looking. I really want to rig things like - building a nest, feeding
young, carrying prey - how do we automate the generation of these per species in a reliable way". And the same day: "I
also want the gaits to have organic variation - so the rigging has to be based on nature. Meaning, not every stride or
movement is the same."

## Where the rig stands (read from the library, 2026-11-11)

| body plan | records | how it is posed |
|---|---|---|
| bird | 35 | 14 on the part rig (rigid parts about pivots), 21 procedural models on the same parts; flight wings are cards from `birdWing.js` |
| rodent | 12 | 11 on the part rig, 1 (the snowshoe hare) on the skeleton |
| quadruped | 8 | the 20-joint skeleton (`tools/rig_quadruped.py`) and the gait engine (`client/src/gait.js`); the deer on its own clips |
| amphibian, reptile, gastropod | 6 | part rig or procedural |

What follows from that:

- **Nothing can hold anything.** Neither rig has a jaw, a bill that opens, toes that close or a neck of more than one
  joint. Carrying in the acorn game is a counter (`acorns.js` `carrying`), not a thing in a mouth. The catch's open list
  already says so: the hawk's feet, the jay carrying its take off.
- **Two rigs.** A behaviour written for the skeleton cannot run on the part rig, and 52 of 61 records are on the part
  rig or procedural.
- **A build script per species.** 48 `tools/build_*.py`, each finding joints from its own mesh. Much of the variance
  in how the animals look comes from here, and from constants tuned per species in `RIG`.
- **The meshes carry a pose.** A generated mesh arrives hunched, or with its wings standing off the flanks (the first
  raven). A skeleton does not fix that.
- **Every stride is the same stride.** On flat ground the engine repeats one cycle exactly; two animals of a species
  differ only in phase.
- **The verbs already exist.** `species_data.CALENDAR` gives each species `nest`, `den`, `rear`, `cache` and `hunt` by
  season ([games.md](games.md)). The logic of who does what when is designed; the body cannot yet do it.

## The principle

These behaviours are not animations to generate per species. They are **contact tasks**: bring a point on the body to
a point in the world and hold it there. The gait engine already solves exactly this for feet (a plant point read from
the terrain, the leg solved by IK, the body following). A bill placing a twig, a mouth closing on a vole and a chick's
gape meeting a parent's bill are the same problem with a different effector.

So the rig needs three things, each said once, as movement.md says locomotion once:

1. a skeleton per body plan with named effectors and sockets, fitted to any mesh by one tool;
2. a small set of motor primitives that every behaviour is built from;
3. the taxonomy tree saying which variant a taxon uses, at the widest rank where it holds.

A species then states only its size, its mass and what differs. Reliability comes from measured gates, not from review
of each animation (below, "What makes it reliable").

The logic stays apart from the drawing. Who carries what, how far a nest has got and whether the young are fed is
world state (as `acorns.js` collectors are). The primitives only draw it. So a behaviour works for a far animal, for a
species whose rig fails a gate, and across the network, where only a small state and a target id need to travel.

## 1. Skeletons with sockets

One skeleton per body plan, the same joints for every member, every rest orientation the identity (as the quadruped's
is, so a bone's matrix stays [R | p - R q]).

| body plan | joints | what is new |
|---|---|---|
| quadruped (Carnivora, Artiodactyla, Lagomorpha, Rodentia) | today's 20 plus a jaw | the jaw; the rodents move onto it (movement.md already lists their bound as missing from the engine) |
| bird | a rigid trunk (the root), a neck chain of three, head, lower mandible, tail, per leg thigh, shank, tarsus and one toe joint that closes, per wing the shoulder, wrist and fingertip joints `birdWing.js` already uses | everything but the wing joints; the flight cards stay and hang from the skeleton's shoulder |
| sprawler (lizards, salamanders, frogs) | the quadruped's joints with sprawled rest angles, a longer tail chain, a jaw | later |
| snake, fish, bat, arthropods | their own | later; the snake's path rig stays |

The bird's trunk is one bone because a bird's back is fused. The joint a bird's leg bends backward at is the ankle,
not the knee; the fitter must place it there (a wrong guess here is a known way for a bird to look wrong).

A bird's flight postures are poses of the same three wing joints: the soar, the beat, the fold of a perched bird and
the tuck of a dive. Aaron, 2026-11-11: "Every bird should have a "dive" ability - when used, they angle downwards and
tuck their wings and "speed blurs" ripple across the edges of the viewport". Today only a hunting bird with a prey
animal selected dives (`dive.js`). The free dive does not wait for this skeleton: the wing rig already tucks (`stoop`
sweeps a soarer's wings back, `fold` closes a percher's), so it is its own lane.

**Sockets** are named points on bones, the same names on every plan that has them:

- `mouth` (between the jaws or the bill tips), with a gape angle;
- `foot_fl`, `foot_fr`, `foot_hl`, `foot_hr` (a bird's two feet close; a quadruped's fore feet can pin or hold);
- `gape` (where a young animal takes food), `teat` (a row along the belly), `scruff` (where a carnivore lifts its
  young), `back` (young that ride), `cheek` and `crop` (carried out of sight: the item is hidden, the cheeks or throat
  swell).

The gait engine already has the whole pose on the CPU each frame (it writes the live rows), so a socket's world
transform is known there. A held item is an ordinary mesh placed at that transform: no new vertex attribute and no new
sampler, which matters because both are full (16 attribute slots on Metal, 16 texture units).

## 2. One fitter

`tools/rig_fit.py` replaces the joint-finding in the build scripts and generalises `rig_quadruped.py`:

- **Landmarks from the geometry**, as today (the leg columns, the belly line, the neck's base, the bill's tip).
- **Proportions from nature.** Each bone's share of the limb is bounded by the taxon's real anatomy: segment ratios
  per order stated in the tree, and measured lengths where a trait table gives them (AVONET's tarsus, bill, wing and
  tail lengths for every bird). A fit outside the bounds is a failed fit, not a tuned one.
- **Joint limits from anatomy**, per order, in the tree (an elbow does not bend forward).
- **The record carries the result**: the joints, the sockets, the posture and the fit's residuals, in `rig`.
- **The mesh must arrive in a stated pose** (standing square, head level, wings folded flat or fully spread, mouth
  closed). The generation brief asks for it and the fitter measures it; a mesh that misses is rejected before any
  credits go to refining it.

Per-species fine-tunes stay allowed where recorded in the species' record (Aaron, 2026-11-06). They adjust numbers,
never code.

## 3. The primitives

| primitive | what it is | the rest of the body |
|---|---|---|
| reach(effector, point) | IK on the chain behind the effector | the far joints first (head, neck), then the trunk (pitch, the crouch the engine already has), then a step; planted feet stay planted |
| grasp, release(socket, item) | the jaw, bill or toes close to the item's girth; the item rides the socket | none |
| carry(socket, item) | travel while holding | the load's share of body mass sets the head's height, the gait allowed and the mode: lift, drag, or cannot |
| place(item, point) | reach, then release | the item becomes a world object or a part of a nest |
| press(target) | lower the body onto a point and turn in place | the standing turn and the pose the engine has; shapes a cup, tamps mud |
| pin and tear(item) | a foot holds, the mouth pulls | gives the mantle and the feeding poses a real contact |
| gape(toward) | a young animal's head up, mouth open, toward the parent | wing quiver or a whole-body beg by taxon |
| pass(mouth, gape) | two bodies: one reaches its mouth to the other's gape; the item changes owner | both hold still for the contact |
| nurse | the adult stands or lies with the teats exposed; a young animal reaches a teat with its mouth | the bedded pose the engine has |
| brood | sit over the nest's slots | the lowered pose |

Ten primitives. A behaviour is a sequence of them with targets taken from the world:

- **Carrying prey:** grasp the carcass at `mouth` (or the feet, for a hawk), carry to cover, a cache or the young,
  place. A load too heavy to lift is dragged, the body straddling it or walking backward.
- **Feeding young:** carry food to the nest or den; the young gape; pass. Or nurse. Or, for young that feed
  themselves from the first day, lead them and nothing else.
- **Building a nest:** find material (the world already has twigs, grass, moss, mud and litter as resources), grasp,
  carry, place at the nest, press to shape, repeat until the nest object is whole.

## 4. The variant comes from the tree

A `care` block and a `carry` block on taxa in `library/animals/locomotion.json`, resolved by `pipeline/locomotion.py`
like the `catch` block: stated at the widest rank where it holds, a narrower taxon stating only what differs.

| rank | what it would own (to be read and sourced per row when its lane lands, as the catch was) |
|---|---|
| class | Aves: eggs, incubation, a nest of some kind. Mammalia: milk, live young |
| order | Passeriformes: a cup, helpless young fed bill to gape. Galliformes: a ground scrape, young that walk and feed themselves within hours. Accipitriformes: a stick platform, prey carried in the feet, torn and passed. Piciformes: a cavity cut in wood. Carnivora: a den, prey carried in the jaws, young lifted by the scruff. Rodentia and Lagomorpha: a burrow, a form or a lined nest |
| family | the nest's material and site; Canidae bringing food up for the pups; Sciuridae's leaf nest; chipmunks' cheek pouches; Cervidae's hidden fawn, nursed standing |
| species | its clutch or litter size, its season (the calendar has it), a display |

Example of the shape (numbers omitted until read):

```json
"Passeriformes": {
  "care": { "nest": { "type": "cup", "site": "branch", "material": ["twig", "grass", "moss"], "shape": "press" },
            "young": { "state": "altricial", "fed": "pass", "socket": "gape" } },
  "carry": { "socket": "mouth" }
}
```

**The load rule** is allometry, like the sprint: what a body can lift, what it must drag and what it leaves is a
share of its own mass, by the socket. The shares need reading and sources before any number is written.

**Young** are the adult's skeleton with juvenile proportions (a larger head, shorter legs: bone scales by age), a
natal coat as a colour set, and the `gape` primitive. This is only possible on a skeleton. Species whose young look
nothing like the adult (downy chicks) may need their own mesh; recolour and proportions first.

**The nest or den** is a world object with slots: for eggs and young, a rim point where the parent stands, and a
progress from 0 to 1 that its geometry follows.

## 5. Strides that are never the same

Variation has to come from causes, as it does in an animal. Random jitter on joints reads as tremor, not life. The
causes, by where they live:

| layer | cause | what changes |
|---|---|---|
| the ground | every foothold is different | the engine already reads each plant point from the terrain; add choosing a foothold (step over a rock, not onto its edge), stride length and cadence answering the slope and the surface (snow, mud, water) |
| the individual | no two bodies are the same | from the instance's seed: limb length and mass within the species' range (so its own Froude bands and cadence), a preferred speed, a preferred lead in the gallop, a slight left-right asymmetry; age (a fawn's quicker steps) and condition (hungry is slower, an injury is a limp) |
| the stride | muscles are not clocks | stride period, step length, foot placement and the legs' phase lags vary a little from stride to stride. The variation is correlated in time (a slow drift), not white noise, and stays inside the gait's footfall pattern. The size of it per gait is to be read from the gait literature before a number is written |
| the gait | gaits are a continuum | the phase lags slide with speed rather than snapping between Hildebrand's diagrams; the lead changes in a gallop on a turn or with fatigue; the first step from a stand and the steps of a stop are their own patterns |
| attention | an animal is rarely just walking | travel in bouts: walk, pause, look, lower the head, walk. The head and eyes follow sounds, scent and other animals independently of the legs; ears and tail move on their own clocks |
| the body's mass | soft parts follow late | the head, ears, belly and tail lag and overshoot the trunk (the lag exists; extend it to the parts); breathing by a rate from mass, locked to the stride in a gallop |

Rules that keep it honest:

- **Deterministic.** All of it derives from the instance's seed and the world clock, so a mirrored animal on another
  player's page takes the same strides (the shared-animals host and its mirrors must agree).
- **The feet still plant.** Variation changes where and when a foot lands, never whether it slides.
- **The far tier varies too**: per-instance rate and phase offsets on the baked cycles, and a few baked variants, so
  a herd does not march in step.
- **Measured.** The lineup harness records stride intervals and step lengths over a few hundred strides and checks
  that their spread and its correlation sit inside a band taken from the literature, that two animals side by side
  drift out of step, and that foot slide is still zero.

This layer is independent of the behaviours and can go first: it changes how every legged animal already on the
engine feels.

## What makes it reliable

- **Reach tests per species**, run by the fitter: can the mouth reach the ground, the bill reach its own feet, the
  feet close on an item of the size its prey is, the mouth reach a nest's slot from the rim. A behaviour declares the
  tests it needs.
- **A behaviour lineup** (as `lineup_animals.html` is for gaits): each behaviour played on a test stage for each
  species, measured for effector error at contact, item passing through the body, foot slide during a reach and joint
  limits broken, with a strip captured for a naturalist.
- **Tiers.** A species that fails a gate does the behaviour **symbolically**: the logic runs, the item appears at the
  nest, nothing is drawn wrong. The registry's level 4 ("full: behaviour") gains a per-behaviour mark (`full`,
  `symbolic`, `none`), so the scorecard shows what each species can really do.
- **Near only.** Live IK runs for the instances that have live rows (32 a species today); beyond them a behaviour is
  a baked pose or symbolic.

## Trait data

| source | gives | licence, as checked 2026-11-11 |
|---|---|---|
| AVONET (Tobias et al. 2022), already in `pipeline/avonet.py` | tarsus, bill, wing and tail lengths for every bird | CC BY 4.0 |
| Amniote life-history database (Myhrvold et al. 2015), already in the animals step | clutch and litter size, broods a year, maturity | reported as CC0; confirm at the Ecological Archives page before a new use |
| PanTHERIA, EltonTraits, already in the pipeline | mammal life history, diet | as recorded where they are used |
| Sheard et al. 2024, "Nest traits for the world's birds" (Global Ecology and Biogeography) | nest type, site and material by species | the article is CC BY 4.0; the data are supplementary files whose licence the search did not confirm |
| COMBINE (Soria et al. 2021) | 54 mammal traits, litter size among them | the paper says no copyright restrictions; the figshare record's licence is not confirmed |

A source whose licence is not confirmed is not used. CC BY-NC data are never shipped to clients, as everywhere.

## Order of work

1. **Stride variation on the gait engine** (section 5). Smallest step, touches every legged animal on the engine,
   needs no new rig. Done when the lineup's stride measures pass and a side-by-side film shows it.
   **Built 2026-11-11** (branch `claude/stride-variation-b27a6a`; [movement.md](movement.md) "Strides that vary" has
   what was built, what was read and from where, the measures and what was left): the individual, the stride's drift
   on a stride clock a host streams and a mirror locks to, the gait's lags as a continuum with a lead, the far tier's
   own cadence and phase, the slope and a foothold, the head and tail following late, and a reach rule that took foot
   slide to zero. Left: the preferred speed (the AI's), the first step from a stand, baked variants, a far herd's
   film, attention and bouts, the deer.
   **2026-11-12, beside it** ([avatar-realism.md](avatar-realism.md)): an idle layer on the same engine (breathing,
   gaze, ears, tail, acts by a director, a reach test that leaves out what a skeleton cannot do: the first of "What
   makes it reliable"), ear joints on the hero models, a bound on the leg's swing, and a hero model tier that keeps the
   generated source's surface with weights computed on the dense mesh. The neck chain and the jaw (item 3) are now what
   most limits the acts.
2. **The reading**: `care` and `carry` in the tree for the orders and families the library holds, with sources, and
   the load shares. Pipeline only.
3. **Sockets, the jaw and carrying on the quadruped skeleton.** A fox carries a vole; a lion drags a deer; a player
   picks up its kill. Done when the behaviour lineup passes for the carnivores.
4. **The fitter**, with the reach tests, and the rodents onto the skeleton.
5. **The bird skeleton.** The large piece: 35 records, 21 of them procedural (their builders know where the parts
   are, which helps). Ground and perch bodies first; a jay carries an acorn in its bill, which the acorn game wants.
6. **The nest object and the young**, then feeding (a jay at a cup nest, a fox at a den).
7. **Building.**

Not proposed: learned or physics-simulated motion. It is research, not a pipeline that gives the same result twice.
Not proposed either: clips per species beyond a rare hero (the deer), for the reason movement.md gives.

## Open, for Aaron

- Whether stride variation goes first, as ordered above, or carrying does.
- Whether young that look unlike the adult get their own meshes (Meshy credits) or wait.
- Whether the nest's season follows the calendar strictly (no nests in November) or a game may start one at any time.
