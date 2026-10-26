# Wild turkey (Meleagris gallopavo): mesh brief

Agent draft (mesh lane, 2026-10-26), needs local sign-off. Id `meleagris_gallopavo`, body plan `bird` (the
quail's ground-bird template: it walks, scratches and pecks, runs, and flushes on wings that collapse on the
ground). The birds of the Sierra foothills are introduced Rio Grande turkeys (M. g. intermedia) with some
Merriam's (M. g. merriami) blood, very common in oak woodland and savanna. Not in the game yet: not in
`animals.js`, and not in the three tiles' `species/species.json` (checked 2026-10-26 by code and scientific name:
absent from 680_4280, 690_4280 and 680_4270), so the tile species step needs it in `species_data.py` before a
tile resolves it (the jackrabbit's `PENDING` route works until then).

## 1. Field marks a local would check

- Size: tom 1.0-1.25 m bill to tail, 7-11 kg; hen about 0.75-0.95 m, 3.5-5 kg. Wingspan 1.25-1.45 m. Standing
  about 0.9-1.0 m to the top of the head in the alert walk (tom). Build target: 1.10 m along the spine, 0.95 m
  to the top of the head; the hen is the same mesh at about 0.8 scale with her own colours.
- Shape: a big deep-bodied ground bird on long legs; small bare head on a long thin neck held up when walking
  alert, stretched forward when running; tail folded into a long wedge that continues the line of the back; wings
  folded high on the back with the pale barred secondaries showing as a patch on the flank.
- Tom (gobbler): body feathers dark bronze with a copper-green iridescence and black tips (a scaled look); wing
  coverts bronze; flight feathers black-brown crossed by white bars (the secondaries show white over half their
  area); rump and tail coverts dark with buff tips (Rio Grande) or whitish tips (Merriam's); tail feathers brown,
  finely barred black, with a buff (Rio Grande) or creamy white (Merriam's) band at the tip, conspicuous only when
  fanned. Bare head and upper neck: pale blue-white crown, blue-grey face, red wattle under the chin, red caruncles
  down the front of the neck, a fleshy snood hanging over the bill (long when relaxed). A black hair-like beard
  10-25 cm hangs from the upper breast. Legs long, pink-grey, with a spur on the back of each tarsus.
- Hen: smaller, duller and browner (feather tips buff-brown, little iridescence), the head grey-blue with sparse
  dark feathering so it looks feathered and grey from a distance, a small pinkish wattle, feathered neck higher up;
  rarely a short beard; no spur or a nub.
- Poults: buff with brown mottling; jakes (young toms) have a short beard and a stepped tail fan.
- Behaviour: winter flocks of 10-50 (hens and young together, toms in bachelor groups), walking and scratching
  through the leaf litter under oaks for acorns, grass seed and insects; run rather than fly, then flush on loud
  wingbeats and glide off downhill; fly up into oaks or pines to roost at dusk and glide down at first light. Toms
  strut in spring (February-May): tail fanned upright, body feathers puffed, wings dropped to drag the primaries,
  head drawn back and blazing red and white, gobbling. Hens nest on the ground in May; broods of poults in summer.
- Approximate sRGB (tom): body bronze #56432f (mean; feathers vary #2a201a to #8a6a46), wing coverts #4a3826,
  flight feathers #2a231d barred #d9d2c3, underwing #8a7f72 barred #b8afa2, rump tips #b89a6a, tail tip band
  #c4a774, crown #c9d3dc, face #8ea4bc, wattle and caruncles #b3322b, snood #a8383a, bill #c4b096, eye #1a120e,
  beard #17130f, feathered lower neck #3a2c20, drumstick feathers #4a3828, legs #a48c86, claws and spur #4a403a.
  Hen: body #6e5a43, head #8c8a86, face #7f8a94, wattle #a06a62, neck feathers #5b4a3a, drumstick #4e3f31, wing
  coverts #5e4a36.

## 2. Poses and motions the client needs

| motion | with the mesh |
|---|---|
| walk and forage (scratch, peck), 0.5-1.5 m/s | legs A/B swing at the hip; the head nods with each step (bob) and dips to peck (flick) |
| alert: stand tall, head up and turning | the base pose (head up, tail folded); a head yaw would need aAnim2 as the ground raven's |
| run, up to 5 m/s, neck stretched forward | legs at speed; head pitched forward a little (pose on HEAD) |
| flush: a burst of wingbeats, then a long glide | wing cards (arm and hand) open from the shoulder; tail spread by aAnim2.y |
| fly up to roost at dusk, glide down at dawn | the flush cards; perched in an oak crown (the jays' perch logic) |
| strut (toms, spring) | a later pose: tail fanned upright, body puffed, wings dropped. Needs a fan card set on TAIL and a body scale; the first Meshy preview (below) is a half-strut mesh that could seed it |
| dust bath, roost sitting | not planned |

Rig template (PART, metres, origin between the feet, +z forward): BODY 0 (with the folded wings); LEG_A 1 / LEG_B 2
procedural legs, pivot at the hip (+-0.068, 0.372, 0); TAIL 3 pivot (0, 0.454, -0.207), weight ramping over the
first 8 cm behind it; HEAD 6 with the neck, pivot at the neck's base (0, 0.688, 0.163), weight ramping over the first
7 cm up the neck; WING_L/R 4/5 arm cards, pivot at the shoulder (+-0.077, 0.632, 0.131); HAND_L/R 9/10, pivot at the
wrist (+-0.347, 0.632, 0.131). Cards collapse into the shoulder on the ground (`collapse` 1).

## 3. Reference images (Wikimedia Commons)

1. **Image-to-3D pick A.** https://commons.wikimedia.org/wiki/File:Wild_Turkey_(m)_(40253787974).jpg
   Becky Matsubara, CC BY 2.0. Tom in El Cerrito, California: the local mix, walking.
2. **Image-to-3D pick B.** https://commons.wikimedia.org/wiki/File:Meleagris_gallopavo_intermedia_184571244.jpg
   Mary K. Hanson, CC BY 4.0. Rio Grande wild turkey.
3. https://commons.wikimedia.org/wiki/File:Wild_Turkey_(m)_(40963017931).jpg (Becky Matsubara, CC BY 2.0) a
   second El Cerrito tom.
4. https://commons.wikimedia.org/wiki/File:Wild_turkey_in_Concord_California_.jpg (Checkingfax, CC BY-SA 4.0)
   Contra Costa County.
5. https://commons.wikimedia.org/wiki/File:Meleagris_gallopavo_intermedia_444975795.jpg (John Rosford, CC BY
   4.0) Rio Grande.
6. Strut: https://commons.wikimedia.org/wiki/File:Male_wild_turkey_(Meleagris_gallopavo)_strutting.jpg (Frank
   Schulenburg, CC BY-SA 4.0) a Rio Grande tom strutting at Deer Island Open Space, Marin County: the later pose.
7. Hen: https://commons.wikimedia.org/wiki/File:Wild_turkey_crossing_the_road_by_Trustom_Pond_(12584).jpg
   (Rhododendrites, CC BY-SA 4.0) hen walking, side-on (an eastern bird, the same shape).
8. Hen with poults: https://commons.wikimedia.org/wiki/File:Wild_turkey_with_chicks.jpg (Kevin Cole, CC BY 2.0).
9. Merriam's: https://commons.wikimedia.org/wiki/File:Merriams_turkey_-_Meleagris_gallopavo_merriami.jpg (U.S. Fish
   and Wildlife Service, public domain) tom displaying, the whitish tail band.

## 4. Generation (run 2026-10-26, 50 credits)

No usable CC0 or CC BY mesh was found (2026-10-26): Poly Pizza has a strutting low-poly tom (Poly by Google, CC BY
3.0, https://poly.pizza/m/4f31_AG9Iap: the strut pose, faceted, cartoon proportions), a crude black one
(https://poly.pizza/m/bMbD7yiAnML), a stylised standing one (jeremy, https://poly.pizza/m/b3E2cqagRPn), a Kenney
roast turkey and a cartoon pilgrim turkey; Sketchfab's CC0 and CC BY results are a museum study skin lying flat
(MooreLab, CC BY 4.0, 85k faces), a whiskey decanter and voxel packs; OpenGameArt, Quaternius and Kenney have no
live wild turkey. The Poly Google strutter is the best seed for the later strut pose if a mesh one is wanted.

Generated with `tools/meshy_generate.py`, ai_model `latest` (meshy-7.1):

1. Preview `01a179be-b056-7695-a6dd-a7aa6d1cda04` (20 credits): "A wild turkey (Meleagris gallopavo) of California,
   one adult male walking on the ground in a relaxed neutral pose, NOT strutting, NOT displaying: body sleek and
   level with feathers flat, tail folded shut and held level behind as a long narrow wedge, long neck upright, head
   up. ..." It came back half strutting anyway: tail fanned upright, back feathers raised, wings drooped to the
   ankles; but the best head and neck: an upright S-neck, snood, wattle and caruncles, beard, good legs and feet.
   2,662,902 triangles (no remesh requested).
2. Preview `01a179c3-b065-7483-b2b3-012571102311` (20 credits): "Field-guide side view of a wild turkey tom ...
   walking calmly while foraging, the ordinary resting posture, NOT strutting, NOT displaying. Tail feathers closed
   together into one narrow bundle that points backward and slightly down, not fanned ... Wings folded neatly up on
   the back, the wing tips resting on the rump above the tail, not drooping ..." Tail folded and wings on the back
   as asked, a good body, but the head hunched into the breast with no neck and the legs mid-run. Remeshed to
   30,000.
3. Refine `01a179c6-3c31-7276-8720-4254f8651097` of preview 2 (10 credits): texture prompt "Wild turkey tom plumage,
   natural matte colours with no lighting or shadows baked in: dark bronze body feathers with a coppery green sheen
   and black feather tips ...; folded wings with black primary feathers crossed by narrow white bars, white-barred
   secondaries and bronze wing coverts; tail feathers dark brown finely barred black with buff-tan tips; ...". The
   body came out near black (median #3a3230) with a white-barred secondary patch, buff-edged tail and a blue-black
   covert block; the head blue and red; the legs too red.

The build grafts preview 1's head and neck onto the refined body of preview 2 (section 6).

## 5. Tier targets

Flocks of 10-50 in winter under oaks; one at 0.95 m covers about 771 x 0.95 / d px: 73 px at 10 m, 18 px at 40 m,
7 px at 100 m. Detail pays inside about 25 m (head, wattle, wing patch); the silhouette (deep body, thin neck, long
legs, wedge tail) is what reads beyond.

- lod0 3,000 (within ~25 m), lod1 900 (25-80 m), lod2 300 (beyond), all including legs, beard, wing cards and eyes
  (eyes in lod0 only). Worst case, 50 birds at lod1, is 45,000 triangles. Suggested switches 25 / 80 m.
- lod2 keeps: the deep body, the thin upright neck and the blue head on it (procedural there), the wedge tail, the
  long legs.
- Vertex colours for all tiers (per face, sampled from the refine's texture on the body).

## 6. Known pitfalls for generated turkeys, and what the build script does

- "Turkey" pulls generators to the strut: even with NOT strutting, the first preview fanned the tail and drooped
  the wings. A second prompt framed as a field-guide side view of a foraging bird, with the tail "closed into one
  narrow bundle" and the wing tips "resting on the rump", got the folded pose but lost the neck.
- The head hunched into the breast: the build deletes it (and the beard and running legs) and grafts the first
  preview's head and neck, cut above the breast, stretched 2.7x through the bare neck to the alert walk, sunk into
  the front-top of the body with the parts inside the body removed.
- A puffed body: the generated body is deep and round; the build tilts it 10 degrees nose-up about the hip (the
  walking posture, back sloping to the tail), lifts the tail 14 degrees back toward the line of the back and
  stretches it 1.8x behind the rump (the generated folded tail is 0.17 m; a tom's is 0.35-0.45 m).
- Non-manifold seams (edges shared by three faces) stop Blender's collapse decimation at ~800 triangles: the build
  deletes those faces and fills the holes first.
- The texture is near black: the build grades the body from the texture's median to bronze per channel, grading
  pale pixels (wing bars, buff tips) more gently so they stay pale; the cut leg stumps' pink is replaced.
- Running legs: replaced by procedural legs (feathered drumstick to the intertarsal joint, bare pink-grey tarsus
  with a spur, three long forward toes and a hind toe), tagged LEG_A/B, pivot at the hip.

## Sources

Wikipedia "Wild turkey" and "Rio Grande wild turkey" (sizes, plumage, subspecies, behaviour; read, not copied).
Commons file pages above. Poly Pizza, Sketchfab and OpenGameArt search pages (2026-10-26). The quail brief and build
(`library/animals/drafts/callipepla_californica.md`, `tools/build_quail.py`), docs/animal-library.md,
library/animals/README.md.
