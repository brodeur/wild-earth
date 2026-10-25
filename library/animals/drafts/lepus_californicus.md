# Black-tailed jackrabbit (Lepus californicus): mesh brief

Draft by agent (Claude), 2026-10-25. Ambient in the tile's species list; prey and alarm for the raven, hawk,
fox, coyote and lion. The tiles hold far more jackrabbit records (14-17 each) than brush rabbit records (1
each), so this is the lagomorph a player will meet most often in the open. Built from the same CC0 source as
the brush rabbit (`tools/build_jackrabbit.py`, `client/assets/jackrabbit.glb`); not in `animals.js` yet.
The rodent and lagomorph template is in `sylvilagus_bachmani.md`; this brief only adds what differs.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| head and body | 47-63 cm; draw 0.55 m | [ADW][adw] |
| ear | 10-13 cm from the notch (10.8-13.5 cm); about a quarter of head and body | [adw], [tt] |
| hind foot | 12-14 cm, long and narrow | [tt] |
| tail | 5-11 cm: black on top, the black running a few cm up the rump as a stripe; grey-white below | [adw], [wp] |
| mass | 1.3-3.1 kg; females larger, otherwise alike | [adw], [tt] |
| height, sitting hunched | about 0.25-0.3 m at the back, 0.4-0.45 m to the ear tips (estimated from R1, R2) | R1, R2 |

What makes it a jackrabbit and not a brush rabbit or a cottontail:
- **Large and lanky**: almost twice the brush rabbit's length, a lean body on long legs; in the sit the slender
  forelegs stand straight and the long hind feet lie flat.
- **Very long ears with black tips**: the backs grey-buff, the outer tips black, the insides pale; held up and
  turned independently, laid flat along the back when it hides.
- **Black-topped tail and rump stripe**: no white powder puff; seen from behind as it runs, a black bar.
- **Grizzled coat**: dark buff peppered with black (agouti) above, paler sides, creamy white belly and inner
  legs ([wp]); buff to cinnamon nape and chest; pale buff legs and feet.
- **Out in the open**: sits in grass or under a lone shrub, never far into closed brush ([wp]).

Colour (approximate sRGB; R1 in shade samples `#5c606c` on the back, R9 in sun `#bfb09a`; set between):

| region | sRGB | note |
|---|---|---|
| back | `#8a7d6b` | grizzled grey-buff, the source texture's ticking multiplied in |
| flanks | `#9d907d` | |
| nape, chest | `#9c8160`, `#b09878` | buff to cinnamon |
| belly, inner legs | `#e0d9cb` | creamy white |
| legs, feet | `#c6b79d` | pale buff |
| ear back / tip / inside | `#8f8576` / `#1c1814` / `#cbbca4` | black on the outer distal quarter and all round the tip |
| tail top and rump stripe / underside | `#1e1a16` / `#d9d3c7` | stripe ~7 cm up the rump, ~3 cm wide |
| muzzle | `#a39176` | |
| eye, eye ring | `#24180e`, `#d6ccb8` | large eye, pale ring |

Seasons: little change (the winter coat a little greyer). Young: born furred and open-eyed in a shallow form,
nursed for only days, out in the grass within a week or two; several litters a year ([adw]), so half-size
leverets are around from late winter to summer. Activity: mainly crepuscular and nocturnal, resting in a form
(a scrape under a shrub or in tall grass) through the day and the hot afternoon ([adw], [wp]); moves daily
from shrub cover to open feeding ground ([wp]).

## 2. Poses and motions (template R, as the brush rabbit)

Parts as `sylvilagus_bachmani.md` section 2: BODY 0 (hindquarters), CHEST 7 (lumbar), LEG_A 1 (fore pair,
elbows) and HEAD 6 (neck, head, ears) children of the chest, LEG_B 2 (hind pair with the long feet, stifles),
TAIL 3. No TAIL_TIP; no EARS part yet (the ears ride with the head).

| motion | how | part rotation enough? |
|---|---|---|
| sit hunched (by day, under a shrub; the drawn rest pose) | pose 0: hind legs folded, forelegs straight, ears up | yes |
| freeze | everything still, ears up (or flat: needs EARS), body low | yes, ears flat no |
| feed | flick dips the head; slow hops of 0.3-0.6 m between bites | yes |
| loping run | fore pair against hind pair, chest flexing; animals.js moves it 1-3 m a bound at 3-5 bounds a second | yes |
| flight: zigzag at up to 50 km/h (14 m/s) | the run at full amplitude with bounds to 6 m ([adw]: 30-35 mph, 20 ft); animals.js yaws 30-60 degrees every 2-4 bounds; often a higher bound now and then (commonly reported, unchecked) | yes |
| sit up, alert | CHEST up, head level, ears up and turning | yes |
| ears up and down | needs an EARS part (9, pivot at the ear bases) to lay them flat (hiding, bedded) and turn them | no: proposed |
| groom, box (spring) | | clip, close range only |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| R1 | **image-to-3D candidate**: side view, sitting hunched at a tree foot (Marin Co.) | [Commons](https://commons.wikimedia.org/wiki/File:Blacktailed_jackrabbit_Lepus_californicus_MarinCo.jpg) | Dcrjsr | CC BY 3.0 |
| R2 | side view, hunched, feeding in leaf litter (San Luis Obispo) | [iNat photo 204353936](https://www.inaturalist.org/photos/204353936) | Hawk T. | CC BY |
| R3 | side view, mid-bound, legs extended | [iNat photo 170415897](https://www.inaturalist.org/photos/170415897) | Forest Botial-Jarvis | CC BY |
| R4 | crouched, rufous nape and black tail top (Arizona) | [Commons](https://commons.wikimedia.org/wiki/File:Lepus_californicus_(black-tailed_jackrabbit)_(Canyon_de_Chelly,_Arizona,_USA)_1.jpg) | James St. John | CC BY 2.0 |
| R5 | head on, ears up: inner ear, black rims and tips | [Commons](https://commons.wikimedia.org/wiki/File:Black-tailed_jackrabbit_(6785302534).jpg) | USFWS (Bitter Creek NWR, CA) | public domain |
| R6 | running toward the camera (Santa Clara Co.) | [iNat photo 253751199](https://www.inaturalist.org/photos/253751199) | anonymous | CC0 |
| R7 | two leaping, chase (Joseph D. Grant County Park) | [iNat photo 298893802](https://www.inaturalist.org/photos/298893802) | anonymous | CC0 |
| R8 | resting by cholla in shade by day | [Commons](https://commons.wikimedia.org/wiki/File:Black-tailed_jackrabbit_(Lepus_californicus)_resting;_Cholla_Cactus_Garden_(16956324355).jpg) | Joshua Tree NP | public domain |
| R9 | three-quarter, walking, pale sunlit coat (San Mateo Co.) | [iNat photo 709700732](https://www.inaturalist.org/photos/709700732) | anonymous | CC0 |
| R10 | hopping along a fence in dry grass (Yolo Co.) | [iNat photo 130405103](https://www.inaturalist.org/photos/130405103) | Jonathan Eisen | CC BY |

## 4. Generation and existing meshes

Prompts (kept for a Meshy preview if the adopted mesh is rejected; not run):
- **A, neutral.** "A black-tailed jackrabbit (Lepus californicus), a wild North American hare, NOT a pet bunny.
  One adult sitting hunched on all fours, side-on, feet flat, head level, ears straight up. Realistic
  proportions: 55 cm long, lean body, long slender forelegs, very long hind feet, very long broad ears about
  12 cm with black tips, large eye. Grizzled grey-buff coat peppered with black, creamy white belly, pale buff
  legs, a black-topped tail. No base, no ground. Game-ready."
- **B, low-poly-friendly.** A with "clean silhouette, ears as simple thick blades, simple feet".
- **C, running.** A with "mid-bound, forelegs reaching, hind legs extended" (reference only).

Image-to-3D: R1 (true side view, plain background; the far legs will be guessed).

| mesh | licence | triangles | verdict |
|---|---|---|---|
| [Rabbit, CDmir (OpenGameArt)](https://opengameart.org/content/rabbit-0) | CC0 | ~1,700 body | **adopted**: realistic, rigged, a long-eared long-legged hare-like rabbit; ears kept (0.92x, 1.3x broader), forearms 1.12x, body 0.9x wide, recoloured. The brush rabbit uses the same source |
| [Jackrabbit, dook / Poly by Google](https://poly.pizza/m/biNOm96olTH) | CC BY 3.0 | ~994 | static, faceted, credit needed; fallback |
| [Rabbit, Quaternius](https://poly.pizza/m/mKev485XTR) | CC0 | | plush cartoon: no |
| [Generic rabbit, Djsedj (OpenGameArt)](https://opengameart.org/content/generic-rabbit-obj) | CC0 | | a rabbit, rough mouth, unrigged: no |
| Meshy text-to-3D preview from A | paid-plan output, CC BY-SA 4.0 | 20k remesh | not run (0 credits): the CC0 mesh read right |

## 5. Tier targets

Spawn in open grassland, savanna and pasture, and sparse chaparral with grass between (not closed brush or
closed forest, [wp]); by day under a shrub or in tall grass within a few metres of open ground. Common: propose
cap 40, singles or pairs (1-2), loose feeding gatherings at dawn and dusk. Seen by the raven at 30-200 m (a
0.55 m hare is ~13 px at 30 m, ~3 px at 150 m) and by the fox, coyote and lion players at 5-60 m. LOD by size:
12 m and 40 m; cull beyond ~250 m.

| tier | triangles | built |
|---|---|---|
| lod0 | 1,000 | 1,000: eyes, ear tips, foot shapes |
| lod1 | 350 | 350: ears as broad blades, no eye |
| lod2 | 80 | 80: a grey-buff wedge with two ears and stick legs |

Vertex colour only.

## 6. Pitfalls

Rabbit list in `sylvilagus_bachmani.md`. Jackrabbit specific:
- **Rabbit prior**: a compact body, short legs, a white puff tail. Keep the lean body, long legs and the black
  tail top.
- **Ear length**: measure from the notch, not from the skull; the build prints both (13 cm and 15 cm).
- **Symmetrize names**: Blender's symmetrize copies the left half's vertex group names onto the right, so select
  per-ear geometry by side (x sign), not by `_L` / `_R` group.
- **Black stripe**: a few faces wide at lod0; at lod2 it is the tail end only.

## Sources

[adw]: https://animaldiversity.org/accounts/Lepus_californicus/
[wp]: https://en.wikipedia.org/wiki/Black-tailed_jackrabbit
[tt]: https://wtamu.edu/~rmatlack/Mammalogy/Species_accounts_2003/Lepus_californicus_account.htm
- Animal Diversity Web; Wikipedia (from the USFS Fire Effects Information System); a West Texas A&M mammalogy
  species account (measurements after Goodwin and Currie 1965); Best 1996, Mammalian Species 530 (not read).
  Poly Pizza and OpenGameArt pages; the mammal briefs' tile record counts. Colour from R1, R2 and R9.
