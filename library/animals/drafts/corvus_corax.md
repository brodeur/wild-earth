# Common raven (Corvus corax): mesh brief

Draft by agent (Claude), 2026-10-24, for the animal mesh library. Research only: nothing was
generated or bought. In the client the raven is both the player (`client/src/raven.js`, one
skinned mesh) and an ambient bird (`animals.js` cap 60, `buildRaven` in `animalModels.js`).

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| length, bill tip to tail tip | 54-71 cm; draw 0.60-0.62 m | [Wikipedia][wp] |
| wingspan | 116-153 cm; draw 1.25 m | [wp] |
| mass | 0.69-2.25 kg (mean about 1.5 kg; western subspecies are the smaller ones) | [wp] |
| tail | 20-26 cm, graduated: a **wedge or diamond** when spread (a crow's is a square fan) | [wp] |
| bill | culmen 5.7-8.5 cm, deep at the base, culmen curved: about as long as the head | [wp] |
| subspecies here | *C. c. clarionensis* in California (smaller, narrower bill than *principalis*) | [wp]; image R3 |

What makes it a raven and not a crow, in order of what is seen from a few metres:
- **Heavy bill** with a curved culmen and **nasal bristles** covering the basal third of the
  upper mandible (a matte tuft, not a smooth bill base).
- **Shaggy throat hackles**: long pointed throat feathers that make the chin look bearded; they
  flare when the bird calls.
- Flat crown sloping into the bill (a "Roman nose" profile), thick neck.
- **Wedge tail** in flight; long wings with **4-5 separated outer primaries ("fingers")**;
  soars on flat wings like a hawk and flaps slowly; often glides where a crow would flap.
- Standing: long body, folded primaries reach close to the tail tip; walks, and hops two-footed
  when hurried.

Colour (approximate sRGB; the client stores linear `COLOR_0`):
| region | sRGB | note |
|---|---|---|
| plumage base | `#0e0f13` | all black; never brown in an adult |
| sheen highlight | `#3a3f66` | blue-violet gloss on back, scapulars, folded wing at grazing light |
| neck feather bases | `#8c8580` | pale grey-brown, shows only when wind lifts the hackles (player texture detail) |
| bill, legs, feet | `#141416` | matte black, scaled tarsus |
| iris | `#2a1c14` | dark brown adult; blue-grey `#6e7f8f` in fledglings |

Sexes look alike (males slightly larger). No seasonal plumage change; worn feathers in late
summer go dull brownish-black before the moult. Juvenile (May-August): duller, browner black,
pinkish gape at the bill base, blue-grey iris, shorter hackles.

## 2. Poses and motions the client needs

From `raven.js` (player: `fly` and `glide` clips crossfaded on the `flapping` flag) and
`animals.js` `rvUpdate` (states R_SOAR, R_GLIDE, R_PERCH, R_CLIMB; aAnim = phase, gait, pose,
flick; roll and pitch in the instance matrix):

| motion | ambient raven (part rig) | player raven (skinned) |
|---|---|---|
| glide | pose 0, amp 0; slight dihedral constant | clip `glide` (exists) |
| flap | phase x amp (2.6-3 Hz in animals.js); hand lags arm by ~0.6 rad so the wrist flexes on the upstroke | clip `fly` (exists, 1.4 s cycle) |
| bank | instance roll (exists) | body roll plus asymmetric wing twist: additive clip `bank` |
| soar | wings fully out, tail spread (new channel) | clip `soar`: primaries fingered, tail fanned |
| landing | instance pitch up, arms swept forward, hands cupped, tail fanned down, legs forward | clip `land` (flare, stall, feet reach): needs skeleton |
| hop / walk | legs in phase (hop) or alternate (walk) plus body bob | clips `walk`, `hop` |
| perched | pose 1: arm folds back, hand folds over the tail | clip `perch_idle` |
| calling | head dips forward then up (flick), throat puffs, tail flicks | clip `call` with bill open (lower mandible bone) |

Proposed **bird template** (extends `PART`; `BODY..HEAD` keep their ids so the deer and the
procedural birds are unchanged):

| part | id | pivot | moves by |
|---|---|---|---|
| BODY | 0 | origin at the feet | instance matrix only |
| LEG_A / LEG_B | 1 / 2 | hip, left / right | swing (phase); sign of gait picks walk (alternate) or hop (in phase); pose squashes to perch |
| TAIL | 3 | tail base (pygostyle) | pitch from flick and pose; **spread** = x scale from a new channel |
| WING_L / WING_R | 4 / 5 | shoulder | arm: flap (rotZ), fold (rotY), sweep |
| HEAD | 6 | base of the neck | pitch from flick and pose |
| HAND_L / HAND_R | 7 / 8 | wrist | primaries and hand coverts: own flex about the wrist, then the arm's rotation about the shoulder (shoulder pivot as a per-species constant, mirrored) |
| NECK (optional) | 9 | base of the neck | throat puff (scale) for calling; can stay in HEAD |

New per-instance `aAnim2` (16 bytes): `(sweep, handFlex, tailSpread, call)`. The shader adds a
one-level parent chain: HAND applies WING's rotation after its own, so a folded wing really
folds instead of squashing in x as it does now.

Part rotation is enough for every ambient motion above. A real skeleton is needed only for the
player (seen at 3.5-5 m from the chase camera): land, takeoff, walk/hop, call with the bill
opening, and the wing twist in a bank. Keep the player skinned (32 joints now).

## 3. Reference images

| # | what it shows | file | author | licence |
|---|---|---|---|---|
| R1 | **image-to-3D candidate**: side view, perched, whole bird, blurred background; post to be ignored | [Commons](https://commons.wikimedia.org/wiki/File:Common_Raven_(Corvus_corax)_perched_on_a_wooden_post.jpg) | Saiquaticlifeform | CC0 |
| R2 | **image-to-3D candidate**: side view standing on the ground, whole bird, even background (Yosemite) | [Commons](https://commons.wikimedia.org/wiki/File:Corvus_corax_(Common_Raven),_Yosemite_NP,_CA,_US_-_Diliff.jpg) | Diliff | CC BY-SA 3.0 |
| R3 | local subspecies calling: hackles flared, bill open, tail down (Point Reyes) | [Commons](https://commons.wikimedia.org/wiki/File:Corvus_corax_clarionensis,_Point_Reyes_National_Seashore.jpg) | Frank Schulenburg | CC BY-SA 4.0 |
| R4 | front view perched: true body width, wings tight (Marin Headlands) | [Commons](https://commons.wikimedia.org/wiki/File:Corvus_corax_clarionensis,_Marin_Headlands.jpg) | Frank Schulenburg | CC BY-SA 4.0 |
| R5 | head: nasal bristles, hackles, bill depth (Contra Costa County) | [Commons](https://commons.wikimedia.org/wiki/File:Common_Raven_(51739557477).jpg) | Becky Matsubara | CC BY 2.0 |
| R6 | bill profile and culmen curve (Yosemite) | [Commons](https://commons.wikimedia.org/wiki/File:Common_Raven,_Yosemite_NP,_California_2022.jpg) | Ant.tab | CC BY-SA 4.0 |
| R7 | underside, full span: wedge tail, 5 fingers, wing outline | [Commons](https://commons.wikimedia.org/wiki/File:Corvus_corax_Algonquin_Park_in_flight.jpg) | Mykola Swarnyk | CC BY-SA 4.0 |
| R8 | side-on glide, flat wing, tail closed | [Commons](https://commons.wikimedia.org/wiki/File:Common_raven_(Corvus_corax)_in_flight_Babadag.jpg) | Charles J. Sharp | CC BY-SA 4.0 |
| R9 | upstroke: hand flexed at the wrist, tail spread | [Commons](https://commons.wikimedia.org/wiki/File:Corvus_corax_Puy_Gros_20240707.jpg) | Marie-Lan Taÿ Pamart | CC BY 4.0 |

Licence note for image-to-3D: a mesh generated from a CC BY-SA photo may count as an adaptation,
so prefer R1 (CC0) as the input and use the SA images as visual reference only.

## 4. Generation

Text-to-3D prompts (the other lane's first Meshy preview used a standing prompt; its review
found the wings standing off the flanks, so prompt A stresses a sleek body):

- **A, standing, folded (ground tier).** "A common raven (Corvus corax), single adult standing on
  flat ground, side-on neutral pose, wings folded tight and sleek against the flanks, folded
  primaries reaching almost to the tail tip, body about one third as wide as it is long.
  Realistic proportions, about 60 cm long. Heavy deep black bill as long as the head with a
  curved culmen, matte nasal bristles over the base of the upper bill, shaggy pointed throat
  hackles, flat crown, dark brown eye. All-black plumage with a faint blue-violet gloss and
  visible feather edges. Long graduated wedge-shaped tail. Black scaled legs, three toes forward
  and one back, flat on the ground. No base, no perch, no rock. Game-ready, closed, symmetric."
- **B, flight, spread (flight tier).** "...in flight seen for rigging: wings fully extended
  straight out to the sides and flat (T-pose for a bird), wingspan about twice the body
  length, long arm and long hand, five separate finger-like outer primaries with gaps between
  them, tail spread into a wedge, legs tucked under the body, head level and bill forward.
  No base. Game-ready, symmetric left to right."
- **C, perched on nothing.** "...perched upright as if on a thin branch, toes curled to grip
  but no branch modelled, wings folded, tail angled down, head turned forward. No base."

Image-to-3D: use R1. Expect the post fused to the feet (delete below the tarsus and build feet
procedurally), a guessed far side (mirror the near side), black plumage read as a featureless
blob or a hallucinated texture (re-colour from the palette above), and a bill shortened by the
generator (rescale to culmen 7 cm).

Existing meshes:
| mesh | licence | triangles | verdict |
|---|---|---|---|
| ["Raven", Teh_Bucket, OpenGameArt](https://opengameart.org/content/raven-0) (2015) | CC0 | ~2k; as re-exported in `client/assets/raven.glb` 2,380, 32 joints, 1k texture | already the player; **adopt for the ambient flight tier** the deer way: decimate, map its arm and hand bones to WING/HAND parts with `_PARTW` from the skin weights |
| [Raven, Poly by Google](https://poly.pizza/m/bnpgn6o5qNs) | CC BY 3.0 | 844 | standing, plausible silhouette, static; usable as a lod1 ground fallback with credit |
| [Raven](https://poly.pizza/m/7eQ51arTYDj) / [Crow](https://poly.pizza/m/1MIvWQ5Q3R9), Poly by Google | CC BY 3.0 | 550 / 682 | too crude for lod0 |
| [Raven](https://poly.pizza/m/5oae0lwh9fF), Poly by Google | CC BY 3.0 | 562 | grey with a white bill: wrong |
| Quaternius, Kenney | none | | no corvid in any pack |

## 5. Tier targets

Seen at: ambient ravens soar 50-150 m up and perch on treetops; the flight scale grows to 1.6x
beyond 100 m. At 1080p and the client's 70 degree FOV a 1.25 m span is ~30 px at 30 m and ~9 px
(15 px with growth) at 100 m. The player is ~240 px across at 4 m.

| tier | triangles | distance | note |
|---|---|---|---|
| player | 4,000-6,000 (now 2,380) | 3.5-5 m | skinned; separated primaries and tail feathers as geometry |
| lod0 | 1,500 | < 30 m | ground and flight variants (state `air` picks) |
| lod1 | 500 | 30-120 m | |
| lod2 | 150 | > 120 m | silhouette: wedge tail and fingers still cut in |

Cap 60, rarely more than a few within 30 m. Texture: ambient ravens stay flat vertex colour.
For the player a **1k base-colour texture is worth keeping** (already in the file): an all-black
bird with flat colour reads as a hole; feather-edge value steps, the sheen band and grey neck
bases carry it. A 1k normal map is optional (three r170 `MeshLambertMaterial` accepts
`normalMap`); 2k is wasted at 240 px.

## 6. Pitfalls and what the build script should do

- **Thick slab wings** (generators give 2-5 cm wings): measure thickness over the wing region;
  above ~12 mm at raven scale, flatten to a thin double-sided shell or replace the wing with
  parametric arm and hand slabs (as `wingSlab`) tied to the shoulder and wrist landmarks.
- **Fused primaries**: the fingers are the raven's flight mark. Cut 5 notches into the hand's
  trailing tip, or build the outer 5 primaries as separate cards.
- **Wings standing off the body** (seen in the first Meshy preview): pull wing vertices toward
  the flank by a falloff from the shoulder, or regenerate with prompt A.
- **Bad feet**: toes melted into a pad or fused to a base. Delete below the tarsus and add
  procedural anisodactyl feet (3 forward, 1 back), ~40 triangles.
- **Hollow eyes**: deep sockets render as pits. Fill holes, place a 12-triangle dark brown eye.
- **Short bill / missing bristles**: scale the bill to the landmarks; colour the basal third of
  the upper mandible matte black-grey so it reads as bristles.
- **Remesher shards and slivers**: drop islands under ~20 faces, weld, decimate with X symmetry.
- **Pivots**: take a landmark file (bill tip, eye, neck base, shoulders, wrists, hips, tail
  base) picked once from preview renders, and derive `_PIVOT` and `_PART` from it.

## Sources

[wp]: https://en.wikipedia.org/wiki/Common_raven
- Common raven, Wikipedia (size, bill, hackles, tail, juvenile eye); Teh_Bucket's Raven page on
  OpenGameArt (CC0, ~2k tris, rig, flight clip); Poly Pizza pages above (licence, triangles)
- Client code read: `client/src/raven.js`, `client/src/animals.js`, `client/src/animalModels.js`;
  `library/animals/corvus_corax.json` (the Meshy preview review)
