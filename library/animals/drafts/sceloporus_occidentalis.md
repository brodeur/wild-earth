# Western fence lizard (Sceloporus occidentalis): mesh brief

Draft by agent (Claude), 2026-10-26. The "blue-belly": on every rock outcrop, fence post, woodpile and oak trunk in
the foothills from March to October. **Not in any tile's species list yet** (`tiles/*/species/species.json` on the
three tiles has no `sceloporus_occidentalis` and no reptile at all: the GBIF step lists birds and mammals only), so
the client will need it added to the species step or drawn as ambient by habitat until then. A small, numerous
animal: the player raven sees it at a few metres, a hawk or a jay hunts it.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| snout to vent | 5.7-8.9 cm; draw 7 cm | [wp] |
| total length | to ~21 cm; draw 18 cm (tail 11 cm, ~1.6x the body; field guides give the tail as 1.3-1.6x) | [wp] |
| height | back about 2.5 cm off the rock standing alert, the fore body raised; belly a few mm off when basking flat | estimated from F1, F4 |
| mass | 10-20 g (estimated) | |

What makes it a fence lizard and not a skink, an alligator lizard or a gecko:
- **Spiny, keeled, pointed scales**: a rough, matte, sandpaper back, not the shiny smooth skin of a skink.
- **Stout, slightly flattened body**, wider than deep; **broad triangular head**, short snout; legs **splayed out to
  the sides** (elbows and knees out), **long thin toes** with claws.
- **Pattern above**: grey-brown to black, a row of **dark wavy blotches or chevrons** down each side of the back,
  often with a pale trailing edge, and a pale **dorsolateral stripe** on many; tail faintly banded. Some males have
  turquoise flecks on the back ([wp]).
- **Below**: adults with **vivid blue patches on the sides of the belly** (edged with black in males) and males with
  a **blue throat patch**; females and young have them faint or absent. **Yellow-orange under the limbs** and on the
  back of the thighs ([wp], F2, F3).
- **Behaviour**: basks flat on warm rock (sides spread, belly pressed down), does **push-ups** (males defend a
  territory up to ~7.5 m across with them, flattening the sides to flash the blue), sprints in a burst with the tail
  whipping, and hides in a crack or under bark ([wp]).

Colour (approximate sRGB, sampled by eye from F1-F4; the tiers use these):

| region | sRGB | note |
|---|---|---|
| back | `#6f6557` | grey-brown, darker when cool |
| dorsal blotches | `#2a241f` | two rows, chevron-shaped, nape to tail base |
| blotch trailing edge | `#9a8f7e` | pale |
| dorsolateral stripe | `#9c8e75` | buff |
| flanks | `#665b4e` | speckled |
| head top / lips | `#554c42` / `#7d7262` | |
| belly | `#b3ada0` | cream-grey midline |
| **belly patches (male)** | `#2d5fa8`, edge `#1b2230` | cobalt with a black inner edge; `_BLUE` 1 (patch) / 0.5 (edge) |
| throat / **throat patch** | `#b8b2a6` / `#3a6cb0` | the patch at the back of the throat, `_BLUE` 1 |
| under the limbs, back of thighs | `#c9933a` | yellow-orange |
| legs / toes | `#62584c` / `#5a5048` | |
| tail top / bands / under | `#645a4e` / `#3d362f` / `#a29b8e` | bands fade toward the tip |
| eye | `#121010` | |

Variants: females have faint blue (the shader greys `_BLUE` toward the belly colour, `extras.rig.blue_off`);
juveniles (hatch mid to late summer, after ~60 days' incubation of eggs laid April-July [wp]) are smaller (draw at
0.5-0.6 scale) and greyer. Cool lizards are darker. Subspecies here is a local check (the foothills lie between the
northwestern and San Joaquin forms, the Sierra fence lizard higher up).

## 2. Poses and motions

The proposed reptile template (docs/animal-library.md, "Reptile template"): BODY, HEAD (pivot at the neck), LEG_A
(left fore, right hind) and LEG_B (right fore, left hind) splayed out with pivots at the shoulder and hip, TAIL
(pivot at the vent) and TAIL_TIP (mid-tail, child of the tail).

| motion | how | part rotation enough? |
|---|---|---|
| alert (base pose) | fore body raised on straight fore legs, head up, tail straight back on the ground | the mesh |
| bask | pose < 0: body down onto the rock (`drop`), legs splayed further out, head down, flanks spread | yes, plus a y squash and an x spread of BODY |
| push-up display | pose > 0, bobbing: the fore legs straighten so the fore body rises about the hips, head up, sides compressed (x squash) to flash the belly and throat blue (`_BLUE` brightened) | yes, with the squash and `_BLUE` |
| sprint | phase: sprawling diagonal gait, legs swinging about the vertical at the shoulder and hip, a lateral S-wave down the spine and tail (amplitude grows toward the tip, TAIL_TIP lagging) | yes: the wave is a vertex bend by position along the spine (no extra attribute) |
| head turn, tail flick | flick | yes |
| hide | translate into a crack or under bark and cull | yes |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| F1 | adult male, side, on rock | [Commons](https://commons.wikimedia.org/wiki/File:Adult_male_western_fl.jpg) | Glenbrooks | CC BY-SA 4.0 |
| F2 | the blue belly from below | [Commons](https://commons.wikimedia.org/wiki/File:Blue_Belly_(11939461576).jpg) | Santa Monica Mountains NRA (NPS) | public domain |
| F3 | central California animal on rock | [Commons](https://commons.wikimedia.org/wiki/File:Common_lizard,_California.JPG) | Brian MacIntosh | CC BY-SA 4.0 |
| F4 | basking in the sun | [Commons](https://commons.wikimedia.org/wiki/File:Happy_Lizard_(8410988615).jpg) | USFS Pacific Southwest Region 5 | public domain |
| F5 | on a tree trunk (Coast Range form) | [Commons](https://commons.wikimedia.org/wiki/File:Coast_Range_Fence_Lizard_on_tree.jpg) | Holly Cheng | CC BY-SA 3.0 |
| F6 | dorsal pattern, close | [Commons](https://commons.wikimedia.org/wiki/File:2016.04.24_Sceloporus_occidentalis_-_Flickr_-_andrey_zharkikh.jpg) | Andrey Zharkikh | CC BY 2.0 |
| F7 | juvenile | [Commons](https://commons.wikimedia.org/wiki/File:Juvenile_Fence_Lizard_(27817956514).jpg) | National Park Service | CC BY 2.0 |

## 4. Existing meshes and generation

| mesh | licence | triangles | verdict |
|---|---|---|---|
| [Lizard, madtrollstudio](https://poly.pizza/m/0z3NJc5zAE) | CC BY 3.0 | 1,351 | a fire salamander: smooth tube body, yellow blotches, slender legs under it |
| [Spotted Gecko, Jeff Larson](https://poly.pizza/m/65Yj7059c2K) | CC BY 3.0 | 4,849 | cartoon gecko, huge eyes, 95 pieces |
| [Gecko, jeremy](https://poly.pizza/m/3FxwLOrGiNL) | CC BY 3.0 | 846 | blocky toy |

None reads as a spiny lizard (record: `library/animals/jobs/sceloporus_occidentalis/download-polypizza/job.json`).
Generated instead, `latest` (meshy-7.1), one preview (20 credits) and one refine (10):

- **Preview prompt (used):** "A western fence lizard (Sceloporus occidentalis), a spiny lizard of California, NOT a
  gecko, NOT a salamander, NOT a cartoon. One adult standing alert on all four legs, side-on neutral pose: front of
  the body slightly raised on straight fore legs, head up, tail straight back and resting on the ground. Realistic
  proportions: 18 cm total length, body 7 cm snout to vent, tail 1.3 times the body, thick at the base and tapering
  to a point. Stout, slightly flattened body; broad triangular head with a short blunt snout and small eyes. Legs
  splayed out to the sides with elbows and knees out, long thin toes spread flat on the ground. Coarse keeled pointed
  spiny scales over the back and tail. No base, no ground, no rock. Game-ready, one closed mesh."
- **Texture prompt (refine, a colour reference only):** male: grey-brown back with wavy black chevrons down each side
  and a pale buff dorsolateral stripe, speckled flanks, banded tail, pale belly with cobalt patches edged in black,
  throat with blue patches, yellow-orange under the legs; matte, no baked light. It came back grey-brown with
  plausible blotches and a blue-grey throat, jaw and chest, with yellow claws (the yellow belongs under the limbs); the
  tiers use the palette above as vertex colour, as the other drawn animals do.

What the preview got right and wrong: a convincing iguanid stance (raised fore body, splayed limbs, long five-toed
feet with claws, triangular head, ear opening, keeled scale texture). Wrong: the tail was only 0.6x the body (the
build stretches it 2x along its axis and lays it on the ground), the body deeper than wide (squashed 0.75x), and a
small iguana-like crest of spines along the spine (sub-millimetre at true size; it survives as a slight serration on
lod0).

## 5. Tier targets

Small and numerous: draw within ~25 m of a camera under ~10 m above the ground (at 25 m an 18 cm lizard is a few
pixels), on rock, trunks and fence lines. Propose cap 120, LOD switches at 2 m and 8 m, cull beyond 25 m.

| tier | triangles | note |
|---|---|---|
| lod0 | 1,200 | toes, eye, blotch pattern, throat patch |
| lod1 | 400 | five spiky toes per foot, coarse pattern |
| lod2 | 120 | body, head, leg stubs, tail; plain back, blue belly |

Vertex colour only, plus `_BLUE`.

## 6. Pitfalls

- **Gecko and iguana priors**: big round eyes, toe pads, a crest of spines, a smooth or green skin. Check the eye
  size, the toes (thin with claws), no crest, the matte spiny back.
- **Salamander prior**: smooth skin, legs under the body. The legs must stand out to the sides.
- **Short tail**: generators shorten long tails; check tail / total (~0.6).
- **Blue in the wrong place**: the blue is on the belly sides and throat, seen from the side only as a low edge; not
  on the back.
- **Scale**: 18 cm; on the lineup compare with the vole (17 cm) and the 10 cm bar.

## Sources

[wp]: https://en.wikipedia.org/wiki/Western_fence_lizard
- Also: Animal Diversity Web classification (<https://animaldiversity.org/accounts/Sceloporus_occidentalis/>),
  Wikimedia Commons photos above (colours sampled by eye), Poly Pizza pages (licences), Meshy API docs and
  `docs/animal-library.md` (credit costs), tile species lists.
