# Turkey vulture (Cathartes aura): mesh brief

Agent draft (research lane, 2026-10-24), needs local sign-off. Id `cathartes_aura`, body plan `bird`.
In the game: `ambient` in tiles/utm10n_680_4280/species/species.json (added by the pipeline,
morning report item 13), though animals.js still lists it in VISUAL_ONLY. Ambient: SPECIES cap 6,
one per 450 m territory cell with p 0.4, at least one within the live radius, so 1-3 in view; always
in the air 40-180 m up, circling (V_SOAR) or on long straight glides (V_GLIDE); never flaps. Drawn
now by `buildVulture`, about 250 triangles, dihedral baked at 0.3 rad.

## 1. Field marks a local would check

- Size: 62-81 cm long, wingspan 1.5-2.0 m, 0.8-2.4 kg. Build target: 0.70 m long, 1.75 m span.
- In flight (how almost everyone sees it): long, fairly narrow, parallel-edged wings held in a raised
  V (a marked dihedral; the client uses 17 degrees); six long separated primaries at each tip; long
  rounded tail reaching well past the feet; a head so small the bird looks headless from below.
  Teeters side to side on the dihedral and rarely flaps (deep, laboured beats only at take-off).
- Underwing two-toned along its whole length: blackish lining in front, silvery-grey flight feathers
  behind. From above: uniform blackish-brown with paler brown wing coverts and pale primary shafts.
- Perched: hunched, long wings drooping and crossing over a long tail, small bare head on a thin neck,
  no feather ruff; often spreads its wings in the sun at dawn (horaltic pose). Coverts edged buff-brown,
  which gives perched birds a scaly look.
- Head: adult bare, wrinkled red skin, ivory-white hooked bill; juvenile head grey-black with a dark
  bill tip, reddening over the first year. Legs and feet pinkish-white, weak, chicken-like (flat
  toes, blunt claws). Sexes alike.
- Approximate sRGB: body #2a221d, covert edges #5a4636, underwing lining #1e1915, flight feathers
  below #a7a7a2, above #3f352d, adult head #b2392c, bill #e8dccb, legs #d8b8a8, juvenile head #3a3634.

## 2. Poses and motions the client needs

| motion (animals.js) | today | with a mesh |
|---|---|---|
| circling, banked at 0.8 of the turn's bank (V_SOAR) | whole-instance roll from `circle()` | instance transform only |
| teetering: an uneven rock, 0.2 sin(1.7 t) + 0.09 sin(3.3 t) rad, added to roll | whole-instance roll | instance transform only; the dihedral must be in the mesh for the rock to read |
| long straight glide, quartering the slopes (V_GLIDE) | instance transform, roll = rock x 1.2 | instance transform only |
| flapping | amp damped to 0: never | a take-off (two or three deep beats) would be WING rotation; not needed yet |
| perched on a snag, roost tree or post; horaltic wings-spread sunning | none | two static variants (wings folded; wings spread and drooped), part rig only for head turns |
| feeding on the ground, hopping | none | skeletal clip if ever wanted |

Rig template (PART, metres, origin at the feet): BODY 0; LEG_A 1 / LEG_B 2 pivot (+-0.04, 0.07, 0);
TAIL 3 pivot (0, 0.10, -0.20); WING_L 4 / WING_R 5 pivot (+-0.07, 0.11, 0.02); HEAD 6 pivot
(0, 0.11, 0.16). Bake the dihedral into the flight mesh in the build script (rotate each wing about its
shoulder pivot by 17 degrees, a `--dihedral` option), not in the source mesh, so one source serves both
species' tools. Teetering and banking need nothing from the mesh but the dihedral. A two-segment wing
(HAND 7/8 at the wrist, about +-0.42 m out) would only matter for a take-off clip.

## 3. Reference images (Wikimedia Commons)

1. **Image-to-3D pick A.** https://commons.wikimedia.org/wiki/File:VULTURE,_TURKEY_(12-26-09)_slo_co,_ca_-01_(4216325713).jpg
   Alan Schmierer, CC0. San Luis Obispo County; adult perched side-on on a stump, whole bird, red head.
2. **Image-to-3D pick B.** https://commons.wikimedia.org/wiki/File:Cathartes_aura_(01736).jpg
   Rhododendrites, CC BY-SA 4.0. Santa Rosa; clean side view on a fence post, plain green background.
3. https://commons.wikimedia.org/wiki/File:Cathartes_aura_at_Tomales_Bay.jpg (Frank Schulenburg,
   CC BY-SA 4.0) Marin; perched three-quarter side, covert scaling.
4. https://commons.wikimedia.org/wiki/File:Cathartes_aura_-San_Rafael,_California,_USA-8.jpg (Ingrid
   Taylar, CC BY 2.0) perched on a post, back and folded wing.
5. **Flight reference.** https://commons.wikimedia.org/wiki/File:VULTURE,_TURKEY_(12-30-07)_-03_(2150206618).jpg
   Alan Schmierer, CC0. Soaring, seen from below: two-toned underwing, six fingers, long tail.
6. https://commons.wikimedia.org/wiki/File:VULTURE,_TURKEY_(12-30-07)_-06_(2150207872).jpg (Alan
   Schmierer, CC0) gliding, side-on: the dihedral and silver flight feathers.
7. https://commons.wikimedia.org/wiki/File:Cathartes_aura-gliding.jpg (Peterwchen, CC BY-SA 4.0)
   Bolsa Chica, California; banked glide from below, red head visible.
8. https://commons.wikimedia.org/wiki/File:Turkey_vultures_(Cathartes_aura)_(01745)a.jpg
   (Rhododendrites, CC BY-SA 4.0) horaltic pose on a fence: the spread perched variant, upper wing.
9. https://commons.wikimedia.org/wiki/File:Cathartes_aura_-Santa_Teresa_County_Park,_San_Jose,_California,_USA_-adult-8a.jpg
   (Don DeBold, CC BY 2.0) on a snag with wings raised: silver flight feathers seen from below.
10. Juvenile: https://commons.wikimedia.org/wiki/File:VULTURE,_TURKEY-_1st_yr-_(7-05)_morro_bay,_slo_co,_ca_(543206309).jpg
    (Alan Schmierer, CC0) grey-black head and dark bill of a first-year bird.

## 4. Generation prompts (not run)

1. "A turkey vulture (Cathartes aura), one adult bird perched upright with its long wings folded
   against the body, wingtips reaching the end of a long rounded tail. Realistic proportions, about
   70 cm long. Small bare wrinkled red head on a thin neck with no feather ruff or collar, short
   hooked ivory-white bill with a see-through nostril, dark brown eye. Blackish-brown body plumage,
   wing coverts edged paler brown. Pinkish-white legs with weak flat toes. No base, no perch, no rock.
   Game-ready, clean closed mesh."
2. "Turkey vulture standing hunched, wings folded and slightly drooping, tiny red bald head, ivory
   beak, dark brown-black feathers with scaly paler edges on the wing, long tail, pale pink legs. Not
   a turkey, not a condor, not a griffon vulture, no white neck ruff. Single bird, no base."
3. Spread variant: "Turkey vulture perched with both wings spread wide and held out to the sides,
   sunning, upper surface showing dark brown coverts and paler brown flight feathers with six separated
   primaries per wing, small red head, ivory bill, long tail. No base. Game-ready."
Image-to-3D: pick A has a stump under the feet and grass behind; mask both. The far wing is hidden;
check it is folded the same way. Pick B is a cleaner silhouette but CC BY-SA.

Existing meshes:
- Poly Pizza "Turkey vulture" by Poly by Google, CC BY 3.0, 1,606 triangles, standing, static,
  red head and pink legs: https://poly.pizza/m/fvAgunyr1kd. Adoptable the way the deer was for the
  perched variant (recolour, parts, three tiers), with the credit in README. Not a flight mesh.
- No CC0 vulture on Poly Pizza, Quaternius, Kenney or OpenGameArt (2026-10-24); paid rigged vultures
  exist (TurboSquid, Fab) and were not considered.
- raven.glb's glide pose (CC0) is the closest spread-wing base: stretch the wing about 1.35x in span,
  lengthen the tail, shrink the head, bake the dihedral, recolour.

## 5. Tier targets

Seen at 100-400 m: the 1.75 m span is about 21 px at 100 m (with the 1.6x flier growth), 9 px at
250 m, 5-6 px at 400 m. Six birds at most, so cost is trivial; the job of the tiers is the silhouette.
- Flight mesh: lod0 2,500 (within 50 m), lod1 900 (50-180 m), lod2 250 (beyond).
- lod2 must preserve: the V (dihedral), the long parallel-edged wing with a blunt fingered tip (at
  least 4 notches), the long tail, the near-absent head (it must not grow a hawk's head), and the
  spanwise colour split (black front half, silver back half) as two rows of faces on the underside,
  since that two-tone flash as the bird teeters is the identification at any distance.
- Perched variants: 1,500 / 600 / 200.
- Vertex colours only: the colours are large blocks; the red head is a handful of faces.

## 6. Known pitfalls for generated birds, and what the build script does

- Slab wings and fused primaries: as for the red-tail, never take the flight tiers from a perched
  generation. Build the wing from cards: arm strip plus six tapered primaries, double-sided, 1-2 cm
  thick, with the under-faces split chordwise into lining and flight-feather colours.
- Text-to-3D species drift: generators confuse it with a wild turkey, a condor, a griffon (white
  ruff) or a black vulture (grey head, short tail, white wingtip patches). Reject on those.
- Head too big: check the head's width is under about 40% of the body's; scale HEAD-part vertices
  about the neck pivot if not.
- Feet: generated raptor talons are wrong here; replace below mid-tarsus with flat pinkish toes.
- Hollow eyes: a small dark brown closed ellipsoid; the bare skin around it stays red.
- Wrong wing folding: perched wingtips should reach the tail tip and may cross over it; wings
  standing off the flanks (as in the Meshy raven test) are pulled in before decimation.
- Dihedral: if a generated flight mesh comes with the wings bent at the wrist rather than raised at
  the shoulder, flatten it and re-apply the dihedral at the shoulder pivot.

## Sources

Wikipedia "Turkey vulture" (sizes, juvenile head, horaltic stance; read, not copied). Commons file
pages above. Poly Pizza model page above (licence, triangle count from the page data).
client/src/animals.js (tvUpdate, SPECIES, VISUAL_ONLY), client/src/animalModels.js (buildVulture),
library/animals/README.md, docs/report-2026-10-25-morning.md.
