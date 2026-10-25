# Western gray squirrel (Sciurus griseus): mesh brief

Draft by agent (Claude), 2026-10-24, for the animal mesh library. Research only: nothing was
generated or bought. In the client it is an ambient animal (`animals.js` cap 160, one per oak
home range; `buildSquirrel` in `animalModels.js`), the acorn game's ground cacher, and on the
brief's list of playable species, so a player tier will follow.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| total length | 43-61 cm; draw 0.55 m | [Wikipedia][wp], [ADW][adw] |
| tail | 24-38 cm (9.5-15 in), about half the total; draw 0.28 m | [USFS PNW-GTR-348][usfs] |
| head and body | 27-39 cm | [usfs] |
| mass | 350-950 g | [adw] |
| ears | large, rounded, **no tufts** | [adw] |

What makes it a western gray and not the introduced eastern gray or fox squirrel:
- **Very long, very full tail**: a broad flat plume, grey with a black band inside a **white
  fringe**, held streaming behind when running and curled over the back when sitting.
- **Clean silver-grey back, pure white belly**, sharp line between them along the flank.
- **No brown or orange on the face, feet or back** (eastern grays have a brownish wash and
  feet; fox squirrels a rusty-orange belly, face and tail underside) ([Bay Nature][bn]).
- Size: the largest tree squirrel in its range; clearly bigger and longer-tailed than an eastern
  gray (400-600 g), about the mass of a fox squirrel (roughly 450-1,130 g) but slimmer and
  silver ([eastern gray][eg], [fox squirrel][fs]).
- Shy; forages on the ground near trees, avoids open ground, less acrobatic in the canopy than
  other tree squirrels ([wp]).

Colour (approximate sRGB; the client stores linear `COLOR_0`):
| region | sRGB | note |
|---|---|---|
| back, crown, outer legs | `#8a8d92` | silver gunmetal grey (agouti hairs with pale tips); the procedural model's `0x5b5f66` is too dark |
| flanks | `#6f7277` | slightly darker grey |
| belly, chin, inner legs | `#eeeeea` | pure white to cream |
| tail core / band / fringe | `#6b6e73` / `#26272a` / `#e4e4e2` | the fringe is what catches light |
| ear backs, winter | `#8a5a3c` | reddish-brown in the winter coat |
| eye, eye ring | `#141414`, `#e6e2da` | thin pale ring |

Sexes look alike. Moults in late spring and early fall; the tail moults only in spring, so the
tail is fullest in fall and winter (the acorn season). Juveniles (out of the nest March to
August): smaller, large head and feet for the body, thinner tail.

## 2. Poses and motions the client needs

From `animals.js` (states S_PAUSE, S_RUN, S_CLIMB, S_OUT, S_SIT, S_IN, S_DOWN; bounding gait
with the fore pair (LEG_A) and hind pair (LEG_B) half a cycle apart; tail and head on flick;
pose sits it up and curls the tail):

| motion | how | part rotation enough? |
|---|---|---|
| bounding run | fore and hind pairs half a cycle apart (exists) plus **spine flex**: CHEST pitches about the lumbar pivot with the stride; tail wave lags | yes, with a CHEST part |
| sitting up with an acorn | CHEST rotates up ~70 degrees about the hips, head pitches down to nibble (flick), fore legs fold to the chest, acorn drawn between the paws by acorns.js, tail curls up the back (TAIL + TAIL_TIP on pose) | yes |
| tail flick / alarm flag | TAIL and TAIL_TIP with a phase lag, a fast wave | yes |
| climbing | instance pitch vertical (head up climbing, head first descending as tree squirrels do), legs splayed out sideways: needs a leg abduction channel | yes, with `aAnim2` |
| bedded | spread-eagled on a limb (legs splayed, chest flat, tail along the limb) | yes; curled in a drey is out of sight, skip |
| player squirrel (later) | gallop, leap, dig and bury, climb cycle, eat, alarm call | needs a real skeleton and clips |

Proposed **rodent template** (extends `PART`; `BODY..HEAD` keep their ids):

| part | id | pivot | moves by |
|---|---|---|---|
| BODY (hindquarters) | 0 | origin under the hips | instance matrix only |
| LEG_A (fore pair) | 1 | shoulders | swing (phase); child of CHEST |
| LEG_B (hind pair) | 2 | hips | swing (phase + pi); pose folds the haunch |
| TAIL | 3 | tail base | pitch from flick and pose |
| HEAD | 6 | neck | pitch from flick and pose; child of CHEST |
| CHEST | 7 | lumbar, ~40% of the body from the rump | flex in the bound; rises to sit up |
| TAIL_TIP | 8 | ~40% along the tail | lags TAIL for the wave; curls further on pose; child of TAIL |

Shader change: a one-level parent chain (HEAD and LEG_A apply CHEST's rotation after their own;
TAIL_TIP applies TAIL's), with parent pivots as per-species constants; and `aAnim2 = (spine,
abduction, tailCurl, spare)`, 16 bytes per instance.

## 3. Reference images

| # | what it shows | file | author | licence |
|---|---|---|---|---|
| S1 | **image-to-3D candidate**: side view on all fours, tail out behind, whole animal, plain pavement (Santa Rosa) | [iNat 186492311](https://www.inaturalist.org/observations/186492311) | Alex | CC BY |
| S2 | **image-to-3D candidate**: sitting up, three-quarter, clean background, winter ears (Mt. Wilson) | [iNat 26374156](https://www.inaturalist.org/observations/26374156) | Eric Johnson | CC BY |
| S3 | sitting, eating a cone, white belly, tail over back (Santa Margarita Lake) | [Commons](https://commons.wikimedia.org/wiki/File:Squirrel,_western_gray_(Sciurus_griseus)_(8-21-09)_Santa_Margarita_lake,_slo_co,_ca_-01.jpg) | Alan Schmierer | CC0 |
| S4 | side view eating, tail plume (CC0 alternative to S1) | [iNat 395924601](https://www.inaturalist.org/observations/395924601) | iNaturalist observer | CC0 |
| S5 | sitting side-on on a limb, tail plume | [Commons](https://commons.wikimedia.org/wiki/File:WesternGraySquirrel1.jpg) | Fish Demon | CC BY 3.0 |
| S6 | all fours on a slope, full tail length (Sausalito) | [Commons](https://commons.wikimedia.org/wiki/File:Western_gray_squirrel,_Sausalito,_CA.jpg) | Julielynns | CC BY-SA 4.0 |
| S7 | on a trunk, head down: climbing pose | [Commons](https://commons.wikimedia.org/wiki/File:20240123-western-gray-squirrel-bonelli.jpg) | Grigory Heaton | CC BY-SA 4.0 |
| S8 | climbing a trunk, tail hanging (Montara) | [iNat 134468911](https://www.inaturalist.org/observations/134468911) | Cricket Raspet | CC BY |
| S9 | bounding across a road (motion blur), Granite Bay, near the tile | [iNat 78023735](https://www.inaturalist.org/observations/78023735) | Hawk T. | CC BY |
| S10 | "California Grey Squirrel", Audubon and Bachman, plate CLIII | [Commons](https://commons.wikimedia.org/wiki/File:The_quadrupeds_of_North_America_(Plate_CLIII)_(7752432766).jpg) | J. J. Audubon, J. Bachman | Public domain |

## 4. Generation

- **A, all fours neutral (rig pose).** "A western gray squirrel (Sciurus griseus), single adult
  standing on all fours, side-on neutral pose, legs straight under the body, head level, tail
  held straight out behind and slightly raised, fully fluffed. Realistic proportions: 55 cm
  long, half of it tail; slim body; large rounded ears with no ear tufts. Silver gunmetal-grey
  back and flanks, pure white belly and chin with a sharp flank line, no brown or orange
  anywhere. Very long broad flat bushy tail, grey with a black inner band and a white fringe.
  Dark eye with a thin pale eye ring. No base, no ground. Game-ready, symmetric."
- **B, sitting up.** "...sitting up on its haunches, back upright, fore paws held together at the
  chest, tail curled up along the back with the tip curving away. No acorn, no base."
- **C, low-poly-friendly.** Prompt A plus "clean silhouette, tail as one smooth volume without
  separate hair strands, toes as simple shapes".

Expected faults: tails as thin rat tails or hair-strand spikes; ear tufts (Eurasian red squirrel
prior); brown or orange colour drift (eastern gray and fox squirrel prior); paws fused to the
chest in B. Image-to-3D: S1 (CC BY, credit needed) or S4 (CC0); expect the ground fused under
the feet, the far legs guessed, and a tail that is too thin seen side-on (the photo shows its
narrow edge): widen it in plan to ~2.5x its depth.

Existing meshes:
| mesh | licence | triangles | verdict |
|---|---|---|---|
| [Squirrel, Poly by Google](https://poly.pizza/m/2WqY_AFEn-M) | CC BY 3.0 | 844 | grey, on all fours, closest proportions; tail far too thin; static |
| [Squirrel, Poly by Google](https://poly.pizza/m/caxos24uWC9) | CC BY 3.0 | 716 | cartoonish, tan face (eastern gray look) |
| [SQUIRREL, Danni Bittman](https://poly.pizza/m/1-x1WzixbjR) | CC BY 3.0 | 1,330 | grey, crouched eating, chunky low poly |
| [Paul Hoover](https://poly.pizza/m/24FL2riioG5), [Simon Graff](https://poly.pizza/m/dQdmcEiCXU3), [Poly by Google](https://poly.pizza/m/794lutNHni-) | CC BY 3.0 | 1,028 / 792 / 764 | cartoon, tan or upright toy |
| [Rat, Quaternius](https://poly.pizza/m/iltq5bVNaV) | CC0 | (animated) | a rat; only as a rodent rig reference |
| [Undead Squirrel, OpenGameArt](https://opengameart.org/content/undead-squirrel-animated) | CC0 | n/a | rigged and animated but a zombie |
| [Flying Squirrel, OpenGameArt](https://opengameart.org/content/flying-squirrel) | CC0 | n/a | "badly rigged", wrong animal |

None is good enough to adopt the way the deer was. Route: generate.

## 5. Tier targets

Seen at: on the ground and in oaks within the raven's live radius; the raven passes 30-150 m up,
lands and walks near oaks in the acorn game, so squirrels at 5-15 m are common. At 1080p and 70
degrees FOV a 0.55 m squirrel is ~40 px at 10 m, ~14 px at 30 m, ~4 px at 100 m.

| tier | triangles | distance | note |
|---|---|---|---|
| player (later) | 4,000-6,000 | chase camera | skinned, fur texture |
| lod0 | 1,500 | < 12 m | a quarter of it in the tail; ears and eye ring modelled |
| lod1 | 450 | 12-40 m | tail plume and white belly line kept |
| lod2 | 120 | > 40 m | grey body, white underside, plume |

Cap 160, usually a few within 12 m. No texture for ambient squirrels: flat vertex colour, with
the tail fringe as a lighter outer ring of faces. A player squirrel would want a 1k fur texture
(and card fringes on the tail).

## 6. Pitfalls and what the build script should do

- **Thin or spiky tail**: measure tail width and depth; scale the tail in plan to ~2.5x its depth
  and smooth hair-strand spikes; give it enough loops to bend in two segments.
- **Ear tufts**: remove anything above the ear rim.
- **Colour drift to brown or orange**: ignore the generated texture and re-colour by region from
  the palette (back, flank, belly, tail band and fringe), as build_deer did.
- **Bad feet / base plate**: cut at the ground plane, rebuild simple paws, origin at the feet.
- **Hollow eyes**: fill and place a dark eye with a pale ring.
- **Paws fused to chest** in sitting generations: generate A and pose the sit with the rig.
- **Pivots**: landmark file (nose, eye, neck, shoulders, lumbar, hips, tail base, tail mid);
  CHEST and TAIL_TIP weights blended over a short span so the spine and tail bend smoothly.

## Sources

[wp]: https://en.wikipedia.org/wiki/Western_gray_squirrel
[adw]: https://animaldiversity.org/accounts/Sciurus_griseus/
[usfs]: https://fs.usda.gov/pnw/pubs/pnw_gtr348.pdf
[bn]: https://baynature.org/2019/05/28/are-fox-squirrels-replacing-gray-squirrels-in-california/
[eg]: https://www.dimensions.com/element/eastern-gray-squirrel
[fs]: https://en.wikipedia.org/wiki/Fox_squirrel
- Western gray squirrel, Wikipedia; Animal Diversity Web; USDA Forest Service PNW-GTR-348
  (Oregon measurements); Bay Nature (telling it from fox and eastern gray squirrels): links above
- Poly Pizza and OpenGameArt pages listed above (licence and triangle counts from each page)
- Client code read: `client/src/animals.js`, `client/src/animalModels.js`
