# Steller's jay (Cyanocitta stelleri frontalis): mesh brief

Agent draft (research lane, 2026-10-24), needs local sign-off. Id `cyanocitta_stelleri`, body plan
`bird`. In the game: `ambient` in tiles/utm10n_680_4280/species/species.json and in the perception
matrix, but not drawn: animals.js has no Steller's jay; only sound.js places its call (habitat
weights conifer 1, mixed 0.7, riparian 0.2; conifer forest is about 10% of the home tile). A mesh
therefore also needs a behaviour entry: the scrub-jay state machine (perch, ground, group flight)
fits, anchored on pines and mixed forest instead of oaks, with groups of 2-4 and a cap near 60.

## 1. Field marks a local would check

- Size: 30-34 cm long, 100-140 g; wingspan 43-48 cm (sources differ: NPS 47.5 cm, iNaturalist
  45-48 cm). Build target: 0.31 m long, 0.45 m span; a little bigger and bulkier than the scrub-jay.
- Shape: the only crested jay west of the Rockies; a long, spiky black crest (raised when excited,
  laid back in flight), stout black bill, long tail, rounded wings, black legs.
- Sierra Nevada birds (subspecies frontalis, once called the blue-fronted jay):
  sooty black-brown head and crest with pale blue streaks on the forehead; sooty grey-brown upper back
  and breast fading into deep cobalt-blue lower back, rump, belly and vent; wings and tail deep blue
  with fine black bars across the secondaries, greater coverts and tail. No white anywhere (unlike the
  eastern blue jay) except, in some birds, a faint pale mark over the eye.
- Sexes alike. Juvenile: duller and sootier, shorter crest, weaker barring, little forehead streaking.
- Behaviour: climbs a conifer branch by branch in hops, then glides down to the next tree; caches
  acorns and conifer seeds in the ground and in bark; loud, often in pairs or small family groups;
  flight on rowing beats with long glides, crest flattened.
- Approximate sRGB: head and crest #1c1c22, forehead streaks #7fa6d8, mantle and breast #3e3e44,
  body blue #2c4f8a, wings and tail #2a4fa0 with bars #101018, bill and legs #141416, eye #1a1a1a.

## 2. Poses and motions the client needs

| motion (proposed from the scrub-jay code) | part rig | notes |
|---|---|---|
| perched on a conifer branch, looking about | instance pitch and yaw, HEAD flick | crest is part of HEAD; it moves with the head |
| hopping up a tree branch by branch | instance steps along the trunk (like the squirrel's climb), LEG squash with pose | part rotation covers it |
| ground foraging and caching acorns and seeds | HEAD dips with flick | as the scrub-jay |
| crest raise when alarmed | needs its own part; none free in PART | a later CREST part, or two variants (crest up, crest down); start with the crest half raised |
| flight between trees, rowing beats and glides | WING flap about z on procedural cards | crest flattened in flight would need the variant or a part |
| tail flick on landing | TAIL with flick | part rotation |

Rig template (PART, metres, origin at the feet; the scrub-jay's scaled about 1.08): BODY 0;
LEG_A 1 / LEG_B 2 pivot (+-0.017, 0.033, 0); TAIL 3 pivot (0, 0.065, -0.075); HEAD 6 pivot
(0, 0.075, 0.065), crest included; WING_L 4 / WING_R 5 pivot (+-0.033, 0.075, 0.01). Flight wings are
procedural cards (blue above, grey-blue below), collapsed into the body when folded, as for the quail
and scrub-jay. No motion here needs a skeletal clip; a crest raise would need one more part.

## 3. Reference images (Wikimedia Commons)

1. **Image-to-3D pick A.** https://commons.wikimedia.org/wiki/File:Cyanocitta_stelleri_Mariposa_1.jpg
   Anita Ritenour, CC BY 2.0. Near Mariposa (Sierra foothills); side view on a rail, whole bird,
   crest up, blurred background.
2. **Image-to-3D pick B.** https://commons.wikimedia.org/wiki/File:Cyanocitta_stelleri_Big_Sur_May_2011.jpg
   King of Hearts, CC BY-SA 4.0. Side view on a rail, clean background (a coastal bird: check the
   head and back colour against the Sierra photos).
3. Local: https://commons.wikimedia.org/wiki/File:Cyanocitta_stelleri_-Emerald_Bay,_El_Dorado_County,_California,_USA-8.jpg
   (Wolfgang Krause, CC BY-SA 3.0) El Dorado County, the home tile's county; side-on on a branch.
4. https://commons.wikimedia.org/wiki/File:Cyanocitta_stelleri_at_Yosemite_National_Park.jpg
   (Andromeda2064, CC BY-SA 4.0) side-on on a pine branch: barring on wings and tail.
5. https://commons.wikimedia.org/wiki/File:Cyanocitta_stelleri_-Yosemite_National_Park,_California,_USA-8.jpg
   (Max Braun, CC BY-SA 2.0) crest fully raised, feathers fluffed.
6. https://commons.wikimedia.org/wiki/File:Cyanocitta_stelleri_-Yosemite-8.jpg (Roberto, CC BY 2.0)
   on granite, three-quarter rear: back and folded wing.
7. Colour check: https://commons.wikimedia.org/wiki/File:Naturalis_Biodiversity_Center_-_RMNH.AVES.140061_2_-_Cyanocitta_stelleri_frontalis_(Ridgway,_1873)_-_Corvidae_-_bird_skin_specimen.jpeg
   (Naturalis Biodiversity Center, CC0) a frontalis study skin on a grid: true colours and lengths.
8. **Flight reference.** https://commons.wikimedia.org/wiki/File:Steller%27s_Jay,_Running_Springs,_California_2009_-_12.jpg
   tracie7779, CC BY-SA 2.0. Taking off from a rail: wings open, barred flight feathers, tail fanned.
9. https://commons.wikimedia.org/wiki/File:Stellers-jay-inflight.jpg (David Margrave, public domain)
   small, wings raised mid-beat.

None of the clean side views is CC0; for image-to-3D prefer pick A (CC BY: attribution only).

## 4. Generation prompts (not run)

1. "A Steller's jay (Cyanocitta stelleri), Sierra Nevada form, one adult bird perched with its wings
   folded, side-on pose. Realistic proportions, about 31 cm long with a long tail. A tall spiky black
   crest, sooty black head with a few pale blue streaks on the forehead, sooty grey-brown upper back
   and breast, deep cobalt-blue belly, rump, wings and tail with fine black bars across the wing and
   tail feathers. Stout black bill, black legs, three toes forward and one back. No white on the face,
   wings or tail. No base, no perch. Game-ready, clean closed mesh."
2. "Steller's jay standing, crest raised, dark charcoal head and chest, vivid dark blue body, barred
   blue wings and tail, black beak and legs. Not a blue jay: no white face, no black necklace, no
   white wing bars or tail corners. Single bird, no base, low-poly friendly."
3. "Steller's jay hopping on the ground, body horizontal, crest half raised, long blue tail, holding
   an acorn in its bill. No base. Game-ready."
Image-to-3D: pick A has a rail under the feet; mask it. The crest's spikes tend to fuse into one
blade; acceptable, as long as it rises from the crown and sweeps back.

Existing meshes:
- "Bluejay" by jeremy on Poly Pizza (CC BY 3.0, 884 triangles, https://poly.pizza/m/dWfeVtr7M49) is a
  cartoon eastern blue jay: crested, but the colours and style are wrong. Not adoptable.
- No Steller's jay or other realistic jay on Poly Pizza, Quaternius, Kenney or OpenGameArt
  (2026-10-24). A generated mesh, or a procedural `buildStellersJay` from `buildJay` plus a crest cone
  and darker palette, is the route.

## 5. Tier targets

Not drawn yet; with the scrub-jay's behaviour and a cap near 60 (conifer and mixed forest only), the
scrub-jay's budget applies: lod0 1,000 (within 12 m), lod1 400 (12-40 m), lod2 120 (beyond), plus
about 40 triangles of wing cards per tier. A 0.31 m bird covers about 24 px at 10 m, 6 px at 40 m.
- lod2 keeps: the crest as a spike (the one shape that separates it from the scrub-jay at any
  distance), the dark front half against the blue back half, the long tail.
- Vertex colours throughout. The fine wing and tail barring is below vertex resolution; a 256 px
  texture on lod0 would show it, worth it only once the close camera spends time in the pines.

## 6. Known pitfalls for generated birds, and what the build script does

- Blue jay bias (the commonest failure for any "jay" prompt): white face, black necklace, white wing
  bars and tail corners, a pale belly. Reject; recolouring cannot fix a pale belly mapped on the
  wrong faces, so check the colour split before adopting.
- Crest: may come out as a single fin, as a backward-pointing horn, or not at all. If wrong, replace
  with a procedural crest (three to five thin blades rising from the crown, tagged HEAD).
- Tail fused to the folded wingtips, or too short: cut free and tag TAIL; the tail is about 45% of
  the length.
- Slab or fused wings: the perched mesh keeps folded wings as BODY; flight uses cards.
- Bad feet and toes fused to a perch: delete below mid-tarsus, add black procedural legs and curled
  toes, tagged LEG_A/B.
- Hollow eyes: a small black closed ellipsoid; it barely shows against the black head, which is right.
- Decimation must keep the boundary between the sooty front and the blue body as an edge loop.

## Sources

Wikipedia "Steller's jay" (size, crest, caching; read, not copied); NPS Bryce Canyon Steller's jay page
and iNaturalist guide (wingspan figures, via search summary). Commons file pages above. Poly Pizza page
above. client/src/sound.js (Steller's habitat weights), client/src/animals.js (scrub-jay behaviour
to reuse), tiles/utm10n_680_4280/species/species.json, library/animals/README.md.
