# California scrub-jay (Aphelocoma californica): mesh brief

Agent draft (research lane, 2026-10-24), needs local sign-off. Id `aphelocoma_californica`, body
plan `bird`. In the game: `ambient`; animals.js SPECIES cap 100; family groups of 2-4 per cell, tied
to an oak: perch in the crown (J_PERCH), drop to the ground under it to forage and, in fall, to bury
acorns (J_GROUND), fly as a group to another oak 20-90 m off, one after another (J_FLY). Flush when
the player comes within 10 m. Drawn now by `buildJay`, about 150 triangles.

## 1. Field marks a local would check

- Size: 27-31 cm long including the tail, wingspan about 39 cm, about 80 g. Build target: 0.29 m
  long, 0.39 m span.
- Shape: slim, crestless (a flat crown is a key difference from Steller's and the eastern blue jay),
  long tail about half the total length, short rounded wings, stout straight black bill with a small
  hook, long black legs.
- Plumage: bright blue head, wings, rump and tail; a grey-brown patch on the back (mantle); dark grey
  ear patch with a thin white eyebrow; white throat with fine streaks, edged by a partial blue
  breast band (the "necklace"); pale grey-white underparts; undertail whitish to pale blue.
- Sexes alike. Juvenile (summer, early fall): head and back mostly grey with little blue, no clear
  necklace, blue only on wings and tail.
- Behaviour that a local recognises: sentinel on a treetop or snag, long hops on the ground with the
  tail cocked, an acorn carried in the bill, pushed into the soil and covered with a leaf; flight low
  across a gap on rowing beats with short glides and a swoop up into the next crown.
- Approximate sRGB: blue #2f5fae (deeper tail #24498a), mantle #8a8074, underparts #d9d6cf, throat
  #eeece6, necklace #3a64a8, ear patch #4a4e58, bill and legs #1b1b1f, juvenile head #8c8f96.

## 2. Poses and motions the client needs

| motion (animals.js) | today | with a mesh |
|---|---|---|
| perched in a crown, looking about (J_PERCH: pitch -0.2, head flicks, yaw turns) | instance pitch and yaw; HEAD dips with flick | part rotation covers it |
| ground hops 0.3-0.7 m, probing (J_GROUND) | instance moves in steps; legs squash with pose | part rotation; a hop arc (instance y) would sell it |
| caching an acorn in fall (flick rate 1.4/s) | HEAD dip | part rotation for the stab; an acorn held in the bill needs a tiny extra instanced mesh, or a second variant with the acorn |
| tail cocked on landing, tail flicks | TAIL lifts with flick and pose (0.15) | part rotation |
| flight, rowing at 11 Hz with glides, swoop into the crown (J_FLY) | WING flap about z; wings fold by pose 1.45 | wing cards hidden when folded (as for the quail); a landing flare would need a clip |
| crossing 20-90 m between oaks in file | instance path | none extra |

Rig template (PART, metres, origin at the feet): BODY 0; LEG_A 1 / LEG_B 2 pivot (+-0.016, 0.03, 0);
TAIL 3 pivot (0, 0.06, -0.07); HEAD 6 pivot (0, 0.07, 0.06); WING_L 4 / WING_R 5 pivot
(+-0.03, 0.07, 0.01). The folded wings in the generated mesh stay BODY; flight wings are procedural
cards (rounded, about 0.16 m per side, blue above #2f5fae, grey below #8a8f99), collapsed into the
body when pose is 1 (the per-species collapse flag proposed in the quail brief). The tail is long and
should keep its own part so the cocked-tail landing reads.

## 3. Reference images (Wikimedia Commons)

1. **Image-to-3D pick A.** https://commons.wikimedia.org/wiki/File:California_Scrub-Jay_(Aphelocoma_Californica)_perched_in_a_Toyon_shrub.jpg
   Saiquaticlifeform, CC0. Side view in a toyon, whole bird, wings folded, long tail, necklace.
2. **Image-to-3D pick B.** https://commons.wikimedia.org/wiki/File:California_scrub_jay_(Aphelocoma_californica).jpg
   డా. గన్నవరపు నరసింహమూర్తి (Gannavarapu Narasimha Murthy), CC0. Side view on a rail, whole bird, head up (busy background).
3. https://commons.wikimedia.org/wiki/File:California_scrub_jay_(12188).jpg (Rhododendrites, CC BY-SA
   4.0) Monterey; front three-quarter on a fence: throat, necklace, mantle.
4. https://commons.wikimedia.org/wiki/File:Aphelocoma_californica_on_a_railing_at_A%C3%B1o_Nuevo_Beach.jpg
   (Grendelkhan, CC BY-SA 4.0) side-on with the tail raised.
5. Acorn: https://commons.wikimedia.org/wiki/File:California_Scrub-Jay_with_acorn_(26759466149).jpg
   (Becky Matsubara, CC BY 2.0) San Joaquin County, near the home tile; perched, acorn in the bill.
6. Acorn: https://commons.wikimedia.org/wiki/File:Western_Scrub_Jay_holding_an_Acorn_at_Waterfront_Park_in_Portland,_OR.JPG
   (Msulis, CC BY-SA 2.5) side-on on the ground with an acorn: the caching posture.
7. **Flight reference.** https://commons.wikimedia.org/wiki/File:Aphelocoma_californica_in_flight.jpg
   Lyle Troxell, CC BY 3.0. Ben Lomond, California; side-on in flight carrying a nut: rounded wing,
   long fanned tail.
8. Juvenile: https://commons.wikimedia.org/wiki/File:Scrub_jay_(51343778876).jpg (Joshua Tree NP,
   public domain) grey-headed juvenile.

## 4. Generation prompts (not run)

1. "A California scrub-jay (Aphelocoma californica), one adult bird perched with its wings folded,
   side-on pose. Realistic proportions, about 29 cm long with a long tail half the body length.
   Crestless flat crown. Bright blue head, wings and tail; grey-brown patch on the back; dark grey
   cheek with a thin white eyebrow; white streaked throat bordered by a partial blue breast band;
   pale grey-white belly. Stout straight black bill, long black legs, three toes forward and one back.
   No base, no perch. Game-ready, clean closed mesh."
2. "Western scrub jay standing on the ground, tail slightly raised, slim body, no crest, blue and
   grey-brown back, white throat with blue necklace, grey underparts, black bill and legs. Not a blue
   jay, no crest, no white wing bars, no black necklace. Single bird, no base, low-poly friendly."
3. Caching variant: "California scrub-jay on the ground leaning forward, holding an acorn in its bill,
   tail cocked up, wings folded. No base. Game-ready."
Image-to-3D: pick A's toyon leaves overlap the legs and tail; mask carefully or the leaves become
geometry. Pick B's rail is behind the feet. Feet are rebuilt anyway.

Existing meshes:
- No scrub-jay on Poly Pizza; the nearest is "Bluejay" by jeremy, CC BY 3.0, 884 triangles, a
  cartoon eastern blue jay: https://poly.pizza/m/dWfeVtr7M49. Not adoptable (crest, colours, style).
- Quaternius's CC0 "Pigeon" (https://poly.pizza/m/9NGlBTpDEr, 2,024 triangles, animated) is a round
  cartoon; not a usable base. Nothing on Kenney or OpenGameArt.
- So this is a generation (or hand-build) job; until then `buildJay` stays, and at 10-50 m it holds up.

## 5. Tier targets

Cap 100, groups of 2-4, often in the crowns at 5-10 m height and on the ground under oaks. A 0.29 m
bird covers about 22 px at 10 m, 6 px at 40 m.
- lod0 1,000 (within 12 m), lod1 400 (12-40 m), lod2 120 (beyond), plus about 40 triangles of wing
  cards per tier. Worst case 100 x 1,000 is 100,000 triangles; in practice a handful are within 12 m.
- lod2 keeps: the long tail (a jay without it reads as a sparrow), a flat crown with no crest, blue
  against the grey-brown mantle and the pale underside.
- Vertex colours throughout: the patterns are large patches; the necklace is one loop of faces at lod0.

## 6. Known pitfalls for generated birds, and what the build script does

- Blue jay bias: generators add a crest, white wing bars, white tail corners and a black necklace.
  Reject crested meshes; recolour to the palette above, which removes white from wings and tail.
- Tail too short or fused with the folded wings: the tail must be a separate plate behind the
  wingtips (wingtips reach only the tail base); cut it free and tag it TAIL.
- Slab or fused wings: fine on the perched mesh (folded wings are BODY); flight uses cards.
- Bad feet and perch fused to the toes: delete below mid-tarsus, add black procedural legs and toes,
  tagged LEG_A/B; jays perch on twigs, so the toes should curl rather than lie flat.
- Hollow eyes: a small dark closed ellipsoid in the grey ear patch, with the white brow above it.
- Bill: generators make it too thin and long (thrasher) or conical (finch); check length about 0.8
  of the head length, straight with a tiny hook.

## Sources

Wikipedia "California scrub jay" (size, caching; read, not copied). Commons file pages above. Poly Pizza
pages above. client/src/animals.js (scrub-jay section, SPECIES), client/src/animalModels.js (buildJay,
shader), library/animals/README.md.
