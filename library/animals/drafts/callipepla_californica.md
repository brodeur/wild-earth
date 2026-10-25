# California quail (Callipepla californica): mesh brief

Agent draft (research lane, 2026-10-24), needs local sign-off. Id `callipepla_californica`, body plan
`bird`. In the game: `ambient`; animals.js SPECIES cap 200 (the largest bird population), coveys per
30 m cell of 2-4 birds in spring, 6-12 in summer, 8-15 in fall and winter. Mostly on the ground
(Q_FORAGE, covey runs G_RUN); flushes as a covey when the raven passes within 48 m and 42 m above,
when a hawk stoops, or now and then by itself. Drawn now by `buildQuail`, about 230 triangles.

## 1. Field marks a local would check

- Size: 24-27 cm long, wingspan 32-37 cm, 140-230 g. Build target: 0.25 m long, 0.35 m span.
- Shape: plump, round-backed, small head, short stout black bill, short rounded wings, short tail;
  stands upright when alert, crouched and horizontal when foraging or running.
- Topknot: a black, teardrop-shaped plume of a few feathers rising from the forehead and curling
  FORWARD over the bill; longer in males. (Gambel's quail has a longer one and no scaling.)
- Male: black face and throat outlined in white, a white line across the forehead and over the eye,
  chestnut-brown crown, speckled nape; slate blue-grey breast; buff belly with black-edged feathers
  (the scaled belly) and a chestnut patch at its centre; olive-brown back and wings; brown flanks
  with bold white streaks.
- Female: grey-brown head without the black and white face pattern, a smaller brown-black plume,
  grey-brown breast, the same scaled belly without the chestnut patch, streaked flanks.
- Juvenile: mottled buff and brown, a stub of a plume; chicks striped buff and dark brown.
- Legs dull grey, short; three forward toes and a small raised hind toe.
- Behaviour: coveys forage in a loose knot, run in single file across openings, a male stands guard
  on a post or shrub top and calls; the whole covey bursts up on whirring wings (about 19 beats a
  second in animals.js), glides, and drops into cover; dust baths; roosts in shrubs and trees.
- Approximate sRGB (male): breast #5f6874, back and wings #6f604f, belly ground #c9b48c, belly scaling
  #2a2420, belly patch #8a4a2a, face and topknot #18181a, face border #ece8dc, crown #6b4a32, flank
  streaks #e8e2d4 on #6a5a48, legs #6e6862, bill #1c1c1e. Female: head and breast #7a6e60.

## 2. Poses and motions the client needs

| motion (animals.js) | today | with a mesh |
|---|---|---|
| foraging walk, quick steps (Q_FORAGE; phase advances at speed / 0.14 m) | LEG_A/B swing about x, half a cycle apart | part rotation covers it; a head bob would need a clip or a HEAD z-translation |
| pecking | flick dips HEAD (amp 0.5 rad) | part rotation |
| covey run in single file, up to 4.5 m/s (G_RUN) | legs, instance yaw | part rotation; a crouched running posture is a small body pitch |
| crouch before the flush (Q_WAIT) | amp to 0, pose held | a slight squash (legs pose) is enough |
| flush: whirr up, glide, whirr in to land (Q_FLY; 19 Hz, pitch from the climb) | WING_L/R flap about z; pose 1.5 folds them into the body | needs wings that do not exist on a folded mesh: separate wing cards hidden when folded (below) |
| sentinel on a post, standing tall; dust bath; roosting | none | a "tall" variant or a body-pitch pose; dust bath would be a clip |

Rig template (PART, metres, origin at the feet): BODY 0; LEG_A 1 / LEG_B 2 pivot (+-0.022, 0.05,
0.005); TAIL 3 pivot (0, 0.09, -0.08); HEAD 6 pivot (0, 0.11, 0.06), the topknot tagged HEAD.
Wings: the generated body keeps its folded wings as BODY. Add procedural wing cards (round, about
0.17 m per side, two segments if HAND 7/8 arrive) tagged WING_L/R at (+-0.04, 0.10, 0.0). Today's
fold squashes x to 0.55 and swings the wing back, which would leave cards sticking out of the flanks;
proposed for the client lane: a per-species flag that collapses a WING part to its pivot as pose goes
to 1, so the cards vanish into the body on the ground and open in flight.

## 3. Reference images (Wikimedia Commons)

1. **Image-to-3D pick A.** https://commons.wikimedia.org/wiki/File:069_-_CALIFORNIA_QUAIL_canet_rd,_sloco,_ca_(8718696139).jpg
   Alan Schmierer, CC0. Morro Bay; adult male side-on on a rock, whole bird, plain grassy background.
2. **Image-to-3D pick B.** https://commons.wikimedia.org/wiki/File:Callipepla_californica_465070011.jpg
   Dan Vickers, CC BY 4.0. Male side-on atop a post, even background.
3. https://commons.wikimedia.org/wiki/File:Callipepla_californica_-Santa_Teresa_County_Park,_San_Jose,_California,_USA_-male-8a_(cropped).jpg
   (Don DeBold, CC BY 2.0) male side view, crisp scaling and flank streaks.
4. https://commons.wikimedia.org/wiki/File:QUAIL,_CALIFORNIA_(3-24-09)_canet_rd_(3385631507).jpg
   (Alan Schmierer, CC0) male side-on, standing on a branch.
5. https://commons.wikimedia.org/wiki/File:069_-_CALIFORNIA_QUAIL_(4-19-07)_canet_rd,_sloco,_ca_(2)_(8718697437).jpg
   (Alan Schmierer, CC0) male front view: face pattern, breast, belly patch and scaling.
6. Female: https://commons.wikimedia.org/wiki/File:Callipepla_californica_-California,_USA_-female_and_chick-_8.jpg
   (Alan Vernon, CC BY 2.0) female side-on walking on pavement with a chick: the walking posture.
7. Female: https://commons.wikimedia.org/wiki/File:069_-_CALIFORNIA_QUAIL_(!0-17-09)_canet_rd,_slo_co,_ca_(8719817146).jpg
   (Alan Schmierer, CC0) female front three-quarter, scaled belly without the patch.
8. Pair: https://commons.wikimedia.org/wiki/File:California_Quail_Fallon_NV_(19978763835).jpg
   (BLM Nevada, CC BY 2.0) male and female together on gravel: relative size and colour.
9. Chick: https://commons.wikimedia.org/wiki/File:QUAIL,_CALIFORNIA_(6-17-10)_canet_rd,_morro_bay,_slo_co,_ca_-03_(4715775664).jpg
   (Alan Schmierer, CC0).
10. **Flight reference (proxy).** https://commons.wikimedia.org/wiki/File:Joshua_Tree_-_Gambel%27s_Quails_flying.jpg
    (Jarek Tuszyński, CC BY-SA 3.0) Gambel's quail, the sister species with the same short round
    wing; no CC-licensed California quail flight photo was found on Commons. An iNaturalist search
    filtered to CC0/CC BY photos of California quail is the next place to look.

## 4. Generation prompts (not run)

1. "A male California quail (Callipepla californica), one bird standing upright with its wings
   folded against a plump round body. Realistic proportions, about 25 cm long. A black teardrop-
   shaped topknot plume rising from the forehead and curling forward over the short black bill.
   Black face and throat outlined in white, white forehead line, chestnut-brown crown, slate
   blue-grey breast, buff belly with black-edged scaled feathers and a chestnut centre patch,
   olive-brown back, brown flanks with white streaks, short grey legs. No base, no rock. Game-ready,
   clean closed mesh."
2. "California quail cock standing on the ground, side view, plump body, forward-curling black
   head plume, scaly belly pattern, blue-grey chest, black and white face, not a Gambel's quail,
   not a bobwhite, not a partridge. Single bird, no base, low-poly friendly."
3. Female: "A female California quail standing, plump, grey-brown head and breast without a face
   pattern, a small brown-black forward-curling topknot, scaled buff belly, white-streaked brown
   flanks, short grey legs. No base. Game-ready."
Image-to-3D: pick A has the bird's feet on a rock; mask it and rebuild the feet procedurally. Expect
the topknot to come out as a spike or to merge with the head; it is replaced anyway (section 6).

Existing meshes:
- Poly Pizza "Quail" by Poly by Google, CC BY 3.0, 950 triangles, standing male with a forward plume,
  black and white face and spotted belly, static: https://poly.pizza/m/4A0kLzM65Mg. The best
  adoptable base the way the deer was: recolour to California (scaling, chestnut patch, blue-grey
  breast), check the plume curls forward, tag parts, decimate. Credit in README.
- Same author, two cruder quails: https://poly.pizza/m/3WonMe83zEX (398 triangles, blocky) and
  https://poly.pizza/m/0Bde17Sy506 (1,208 triangles, stylised blue and white). Not recommended.
- No CC0 quail on Poly Pizza, Quaternius, Kenney or OpenGameArt (2026-10-24).

## 5. Tier targets

Up to 200 on screen in winter, all true scale on the ground (fliers grow 1.6x beyond 100 m only
while airborne). A 0.25 m quail covers about 771 x 0.25 / d px: 19 px at 10 m, 5 px at 40 m, 2 px
at 100 m. Detail pays only inside about 12 m (the third-person camera near a covey).
- lod0 1,000 (within 12 m), lod1 400 (12-40 m), lod2 120 (beyond), plus about 40 triangles of wing
  cards on every tier. Worst case, 200 birds at lod1, is 88,000 triangles.
- lod2 keeps: the plump teardrop body, the topknot as one or two triangles (it is the identification
  even at 5 px against the sky in a flush), and the blue-grey breast against the brown back.
- Vertex colours for all tiers. The scaled belly and flank streaks are below vertex resolution; a
  256 px texture for lod0 only is worth it if the close camera spends time near coveys, not before.

## 6. Known pitfalls for generated birds, and what the build script does

- Topknot backwards, a spike or a crest: delete generated plume geometry and add a procedural one
  (a flattened teardrop of 4-6 triangles on a short stalk, tip forward of its base), tagged HEAD.
  Assert tip z > base z.
- Species drift to Gambel's (no scaling, rusty crown, black belly patch), bobwhite or partridge:
  check the belly and breast colours before adopting.
- Wings fused into the flanks: expected and fine for the ground mesh; flight comes from the cards.
  Slab wings from a flight prompt are not used.
- Bad feet: delete below mid-tarsus, add grey procedural legs and toes (three forward, a small hind
  toe), tagged LEG_A/B, so walking swings them cleanly.
- Hollow eyes: a small dark closed ellipsoid inside the white face border.
- Proportions: generators often make the head too large and the body too upright; check the head
  is about a third of the body's height and allow a forage posture (body pitch about 10 degrees down).
- Decimation must keep the face-border loop (black against white) as edges, or the face reads as a
  grey blur at lod1.

## Sources

Wikipedia "California quail" (sizes, topknot, sexes, coveys, dust baths; read, not copied). Commons
file pages above. Poly Pizza model pages above. client/src/animals.js (quail section, SPECIES, spawnCell),
client/src/animalModels.js (buildQuail, shader), library/animals/README.md.
