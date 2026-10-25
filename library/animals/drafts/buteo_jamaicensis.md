# Red-tailed hawk (Buteo jamaicensis calurus): mesh brief

Agent draft (research lane, 2026-10-24), needs local sign-off. Id `buteo_jamaicensis`, body plan `bird`.
In the game: `playable` in tiles/utm10n_680_4280/species/species.json, so it needs a player model like
the raven (client/src/raven.js: skinned, fly and glide clips) as well as the ambient soarer. Ambient:
animals.js SPECIES cap 6, one per 500 m territory cell with p 0.45, at least one within the live
radius, so 1-3 in view; always in the air 100-250 m up (H_SOAR, H_STOOP, H_PULL). Drawn now by
`buildHawk` (animalModels.js), about 200 triangles.

## 1. Field marks a local would check

- Size: 45-65 cm long, wingspan 105-145 cm, 690-1,600 g (males 690-1,300 g, females 900-2,000 g;
  females up to 25% larger). Build target: 0.55 m long, 1.24 m span (the procedural hawk's).
- Shape perched: bulky, broad-chested, short neck, big head, short hooked bill; wingtips fall short
  of the tail tip; legs feathered to the "knee", yellow bare tarsi and feet.
- Shape in flight: broad, rounded wings, five slotted outer primaries ("fingers"), short broad tail
  fanned when soaring; soars on flat wings or a slight dihedral (about 5 degrees).
- Western light morph (the default here): dark brown head and back, pale mottled scapulars forming a
  loose V on the back, pale cream breast, a dark streaked belly band; underwing pale with a dark bar
  on the leading edge of the inner wing (patagial bar), a dark comma at the wrist and a dark trailing
  edge. Tail brick-red above, paler pinkish below, a thin dark band near the tip.
- Morphs: western birds vary more than eastern; rufous (intermediate) and dark morphs are a minority
  here and worth one variant later (dark morph: all chocolate except the red tail).
- Juvenile (first year): tail brown with many narrow dark bars (no red), pale yellow eye (adult dark
  brown), heavier belly streaking, a pale window across the primaries in flight. Sexes alike in
  plumage; only size differs.
- Approximate sRGB (check against the references in daylight): back #4f3826, scapular mottling
  #8a6a4c, breast #e6dcc6, belly-band streaks #5a3e2a, tail above #b4502b, tail below #d9b8a0,
  patagial bar and wrist comma #3a2a20, underwing flight feathers #d8d4cc with trailing edge #5a5048,
  cere and feet #d9c25a, bill #2a2622, adult eye #4a2a18, juvenile eye #d8c88a.

## 2. Poses and motions the client needs

| motion (animals.js) | today | with a mesh |
|---|---|---|
| soar in circles, banked (H_SOAR) | whole-instance roll from `circle()` (bank = atan(V^2/gR) x 1.3), slow thermal rise | instance transform only: works on any spread-wing mesh |
| occasional flaps, 2.4 Hz, 0.8-1.8 s; 3 Hz pulling out (H_PULL) | WING_L/R rotate about z at the shoulder (amp 0.6 rad) | part rotation covers it at 100 m+; a hand that flexes on the upstroke needs a clip |
| stoop: wings swept back, nose down (H_STOOP, pose 0.75) | wings squash in x and rotate about y (pose x 1.4) | part rotation is acceptable; a two-segment wing (below) folds the hand properly |
| perched on a snag or pole (not in animals.js yet; the commonest way people see one) | none | separate perched mesh, wings folded, part rig for head turns and tail flick |
| kiting (hanging into the wind), landing flare, talons-forward strike, take-off | none | player hawk only: real skeletal clips |

Rig template (animalModels.js PART, metres, origin at the feet, +z forward):
BODY 0; LEG_A 1 / LEG_B 2 (left, right) pivot (+-0.035, 0.07, 0.0); TAIL 3 pivot (0, 0.10, -0.16);
WING_L 4 / WING_R 5 pivot (+-0.06, 0.11, 0.02); HEAD 6 pivot (0, 0.11, 0.15).
Two-segment wing: the shader has one wing part per side. Proposed for the client lane: HAND_L 7 /
HAND_R 8 pivot at the wrist (about +-0.30, 0.11, 0.0), rotated about the wrist before the arm's
rotation (the shoulder pivot as a per-species constant). Until then tag the hand WING with a
`_PARTW` falloff so the hand moves most, as the deer does with skin weights.
Player hawk: retarget the raven's 32-joint skeleton and fly/glide clips (similar size, also five
fingered primaries) to a red-tail mesh; add stoop, perch, land and strike clips later.

## 3. Reference images (Wikimedia Commons; licence as stated on the file page)

1. **Image-to-3D pick A.** https://commons.wikimedia.org/wiki/File:Buteo_jamaicensis_calurus_60879047.jpg
   Jonathan Eisen, CC BY 4.0. Sacramento; side view on a wire, plain grey sky, whole bird, red tail.
2. **Image-to-3D pick B.** https://commons.wikimedia.org/wiki/File:HAWK,_RED-TAILED_(11-7-08)_carrizo_plain,_slo_co,_ca_(3017642988).jpg
   Alan Schmierer, CC0. Carrizo Plain; perched on a post, rear three-quarter, clean blue sky.
3. https://commons.wikimedia.org/wiki/File:Buteo_jamaicensis_calurus_60879046.jpg (Jonathan Eisen,
   CC BY 4.0) same bird, other side.
4. https://commons.wikimedia.org/wiki/File:Buteo_jamaicensis_in_San_Francisco_1.jpg (Brocken
   Inaglory, CC BY-SA 3.0) standing, three-quarter front: belly band, breast, feathered legs.
5. https://commons.wikimedia.org/wiki/File:Red-Tailed_Hawk,_Perched_in_Oak_Tree_(30353999365).jpg
   (Eric Sonstroem, CC BY 2.0) California, perched in an oak: the setting the game uses.
6. https://commons.wikimedia.org/wiki/File:Red-tailed_hawk_on_power_pole-2033.jpg (Frank
   Schulenburg, CC BY-SA 4.0) Butte County, front view, scapular V.
7. **Flight reference.** https://commons.wikimedia.org/wiki/File:Red-tailed_hawk_soaring_over_Canaan_Valley_National_Wildlife_Refuge.jpg
   USFWS, public domain. Upper side, wings and tail fully spread: wing planform, red tail, fingers.
8. https://commons.wikimedia.org/wiki/File:HAWK,_RED-TAILED_(11-6-09)_carrizo_-01_(4086974317).jpg
   (Alan Schmierer, CC0) underside in flight: patagial bar, wrist comma, belly band.
9. https://commons.wikimedia.org/wiki/File:Red-tailed_hawk_flying_(rbm-QP301M8-1887-763).jpg
   (Eadweard Muybridge, public domain) plate 763, a full wingbeat sequence: reference for clips.
10. Juvenile: https://commons.wikimedia.org/wiki/File:Buteo_jamaicensis_calurus_in_flight,_Squaw_Valley,_California.jpg
    (Frank Schulenburg, CC BY-SA 4.0) barred brown tail, pale primary window; and
    https://commons.wikimedia.org/wiki/File:HAWK,_RED-TAILED_(2-21-07)_imm,_ca_(543195831).jpg
    (Alan Schmierer, CC0) pale juvenile eye.

Prefer the CC0 and public-domain photos as image-to-3D inputs: a mesh generated from a CC BY-SA
photo may carry its terms.

## 4. Generation prompts (not run; no money spent)

1. "A red-tailed hawk (Buteo jamaicensis calurus), one adult bird perched upright with its wings
   folded tight against the body. Realistic proportions, about 55 cm long: big rounded head, short
   hooked dark bill with a yellow cere, dark eye, broad chest. Dark brown back with pale mottled
   scapulars, cream breast with a band of dark streaks across the belly, brick-red tail with a thin
   dark band near the tip; folded wingtips stop short of the tail tip. Feathered thighs, bare yellow
   legs, four toes with black talons gripping nothing. No base, no perch, no rock. Game-ready, clean
   closed mesh."
2. "Western red-tailed hawk, light morph, standing perched, side view pose, wings folded, compact
   buteo shape, short broad brick-red tail, pale underparts with a dark belly band, dark brown upperparts,
   yellow feet, not an eagle, not a falcon. Single bird, no base, low-poly friendly game asset."
3. Flight variant (expect slab wings, see section 6): "A red-tailed hawk soaring, wings fully spread
   and flat, symmetrical, five separated primary feathers at each wingtip, broad rounded wings, short
   fanned brick-red tail, legs tucked, pale underwing with a dark leading-edge bar and dark wrist mark.
   No base. Game-ready."
Image-to-3D: crop pick A to the bird, paint out the wire under the feet, mask to a plain background;
expect the far side of the bird to be invented, so check the folded wing on the hidden side. If a
multi-image mode is used, pair pick A with pick B (same morph, other angle).

Existing meshes:
- Poly Pizza "Red-tailed hawk" by Poly by Google, CC BY 3.0, 1,112 triangles, perched on a branch,
  static, flat colours: https://poly.pizza/m/9adZAZ2BmGL. Adoptable the way the deer was for a
  perched variant (cut the branch off, recolour, part weights), credit in README. Not a flight mesh.
- Poly Pizza "Hawk Lp Rigged" by Sherkiz, CC BY 3.0, 9,956 triangles, animated, kestrel-like
  colours: https://poly.pizza/m/RkN6MEbP6g. Too heavy and the wrong species; its clips might help a player rig.
- No CC0 hawk on Poly Pizza (searches for bird, hawk, eagle, vulture, crow, pigeon on 2026-10-24: the
  only CC0 bird is Quaternius's cartoon Pigeon, 2,024 triangles), Quaternius or OpenGameArt (CC0 there:
  a generic bird basemesh, a pigeon, chickens). Kenney has no realistic birds.
- The project's own raven.glb (Teh_Bucket, CC0, 2,380 triangles, glide pose) is a CC0 spread-wing
  base: re-proportion (broader wing, shorter fanned tail) and recolour for the flight tiers.

## 5. Tier targets

Seen at 100-400 m nearly always: with the 70 degree vertical field of view on a 1080 px screen a bird
covers about 771 x size / distance pixels, and animals.js draws fliers up to 1.6x beyond 100 m, so the
1.24 m span is about 15 px at 100 m, 6 px at 250 m and 4 px at 400 m. Only six exist, so triangles
cost little; the far tier is about not flickering.
- Flight mesh: lod0 2,500 (within 40 m: pull-outs near the ground, a player raven alongside),
  lod1 900 (40-150 m), lod2 250 (beyond). lod2 must keep: span-to-length ratio, a straight leading
  edge to the wrist and a tapering hand with at least 3 notches at the tip, the short fanned tail
  (red-tail) distinct from the vulture's long one, head and neck projecting well ahead of the leading
  edge (a vulture's barely does), and the underwing pattern as separate faces (pale lining, dark patagial bar, dark belly).
- Perched variant: 1,500 / 600 / 200.
- Player: 2,500-4,000 triangles skinned, one base-colour texture (seen close in third person).
- Vertex colours are enough for the ambient tiers (big blocks of colour); the player model wants a
  texture for scapular mottling, tail band and belly streaks.

## 6. Known pitfalls for generated birds, and what the build script does

- Slab wings (one thick plate, feathers only painted): flight tiers are not taken from a perched
  generation at all. Build the flight mesh from raven.glb's glide pose or from wing cards: per wing an
  arm quad strip and a hand with five tapered primary quads, double-sided, 1-2 cm thick so it never
  vanishes edge-on, under-faces coloured separately.
- Fused primaries: cut the hand off at the wrist and replace it with procedural fingers (five, the
  outer four slotted), rather than trying to separate fused geometry.
- Bad feet (blobs, too many toes, fused to a perch): delete everything below mid-tarsus and add a
  procedural tarsus plus three-forward-one-back toes in #d9c25a, tagged LEG_A/B.
- Hollow eyes (concave sockets or painted eyes): replace with a small closed dark ellipsoid; add a
  pale brow ridge, which is what makes a hawk's face read.
- Wrong wing folding: check wingtip-to-tail ratio (red-tail wingtips short of the tail tip) and that
  the folded wing lies against the flank (the Meshy raven had wings standing off the body); pull
  wing vertices toward the body plane before decimating.
- Eagle or falcon bias: reject meshes with a feathered head ruff, a long pointed wing or a heavy
  eagle bill; check the belly band and red tail colours are present.
- Decimation must lock colour-boundary edges (lining against patagial bar) and keep the wingtip
  notches; decimate wing and body separately with X symmetry, like build_deer.py.

## Sources

Wikipedia "Red-tailed hawk" (sizes, dimorphism; read, not copied). Commons file pages above. Poly
Pizza model pages above (licence and triangle counts from the page data). client/src/animals.js,
client/src/animalModels.js, client/src/raven.js, tools/build_deer.py header, library/animals/README.md,
library/animals/corvus_corax.json (Meshy raven review), docs/decisions.md 2026-10-25.
