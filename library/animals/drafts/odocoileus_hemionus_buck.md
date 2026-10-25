# Black-tailed deer buck (Odocoileus hemionus columbianus): mesh brief

Draft by agent (Claude), 2026-10-24. Research only: nothing generated or bought. A variant of
the adopted doe (`odocoileus_hemionus.json`, Quaternius "Deer", CC0, `tools/build_deer.py`).
Client: herds of 3-6 (`animals.js` cap 90, `DEER_LOD = [30, 90]` m, walk 1.1-1.6 m/s, graze,
bedded 9:30-16:30). Also holds the quadruped template and generic pitfalls the other briefs use.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| shoulder height | males 84-106 cm, females 80-100 (whole species); draw the buck at 1.00 m (doe 0.95) | [ADW][adw] |
| weight | California adults 35-65 kg; bucks at and above the top of that | [WP][wp], [ADW][adw] |
| neck circumference | males 30-65 cm against 26-38 cm in does: the rut swell lives in that gap | [adw] |
| head length | 28-35 cm (does 27-33) | [adw] |
| antler form | main beam forks evenly ("Y"), not tines off one beam as in whitetail | [NPS][nps], [ODFW][odfw], [Rainier][mora] |
| antler cycle | cast January-March, regrown April-August (in velvet), hard September-January | [wp] |
| rut | November to early December, peak late November to mid-December | [wp], [adw] |

What a buck adds to the doe:
- **Antlers, forked.** Each beam sweeps up, back and out, then forks; in a mature buck the rear
  branch forks again (3 or 4 points a side, western count). Black-tailed racks are smaller and
  narrower than inland mule deer (often inside the ear spread; local check): commonly 2x2
  ("forked horn") or 3x3, yearlings spikes. Brow tines small or absent.
- **By season:** spring: antlerless (two dark pedicel knobs) or velvet buttons; summer: velvet,
  thick, rounded tips, grey-brown, full size by August; fall: hard, brown with pale tips, neck
  swollen, hocks stained (rut); winter: hard until cast from January.
- **Build:** neck and forequarters heavier than the doe's all year, thick from jaw to brisket
  in rut; darker forehead, white throat patch; ~5% larger; ears and tail as the doe.

Colour (approximate sRGB; client stores linear `COLOR_0`). Photo samples are lit, so albedo is
darker:

| region | sRGB | note |
|---|---|---|
| summer coat (Jun-Sep) | `#a5683f` | sampled `#b0704a` from R1 (lit flank) |
| winter coat | `#7a604a` | a shade darker than the doe's `0x86694b` |
| forehead patch | `#3b2c22` | darker in rut |
| throat patch, rump | `#ddd2bb` | as the doe |
| antler velvet | `#6e5a4a` | rounded, 1.3x thicker |
| antler hard, base to tip | `#6b5843` to `#d9ceb5` | burr dark, tips ivory |

Juveniles: fawns reddish with white spots through their first summer; male fawns show pedicel
bumps in fall. Tail top `#241a14` and stained hocks `#2e231b` as in the doe palette.

## 2. Poses, motions, and the quadruped template

From `drUpdate` (`aAnim` = phase, gait, pose, flick; deer `amp [0.3, 0.6, 1.5, 0]`,
`pose [0.12, 0, -0.15, 0]`): walk (diagonal pairs), graze (flick dips the head), bedded (pose
squashes the legs, the body drops 0.6 m). A buck needs the same plus rut chasing (trot and
gallop), a head-high alert with the antlers up, and later sparring.

**Quadruped template (Q)**, shared by buck, gray fox, coyote and mountain lion:

| part | id | pivot | moves by |
|---|---|---|---|
| BODY | 0 | origin between the feet | instance matrix (animals.js pitch, lift, yaw) |
| LEG_A | 1 | elbow (fore), stifle (hind); thigh stays with the body (README) | left fore + right hind: swing `sin(phase)` |
| LEG_B | 2 | as above | right fore + left hind: `sin(phase + pi)` |
| TAIL | 3 | tail root | flick and pose |
| HEAD | 6 | neck base at the withers: neck, head, ears, antlers | flick (dips; negative flick lifts) and pose |
| CHEST, TAIL_TIP | 7, 8 | as proposed in `sciurus_griseus.md` | spine flex; lion's tail-tip twitch |

| motion | part rotation enough? |
|---|---|
| walk, trot | yes: diagonal pairs are both gaits; speed sets the phase rate |
| graze, browse, sniff | yes: flick (buck amplitude as the doe's; antlers ride with the head) |
| stand alert, head high | yes: flick about -0.3 |
| tail flag on alarm | yes: TAIL on flick |
| bedded | partly: the leg squash makes the body look sunk (open issue in the doe entry). A second leg pivot at carpus and hock, folding the cannon bones under, would fix it |
| gallop, stot, rut chase | no with fixed diagonal pairs. Proposal: the shader takes each leg's quadrant from `sign(aPivot.x)` and `sign(aPivot.z)` and a per-instance gait selector (`aAnim2.w`) that blends the phase offsets from diagonal (walk, trot) to fore-against-hind (bound, gallop, stot with all four in phase), with no new part ids |
| sparring, antler rubbing, lip curl | skinned clip (close range only) |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| R1 | **image-to-3D candidate**: side view, whole buck, hard 3x3 antlers, summer coat, river behind | [Commons](https://commons.wikimedia.org/wiki/File:Columbian_Black-tailed_Deer_buck.jpg) | Philip Cohen | CC BY-SA 4.0 |
| R2 | **image-to-3D candidate**: side view, antlered buck, open background | [Commons](https://commons.wikimedia.org/wiki/File:Black-tailed_deer_%287146688455%29.jpg) | USFWS | public domain |
| R3 | buck in October, side-on, hard antlers | [Commons](https://commons.wikimedia.org/wiki/File:2019-10-07_Black-tailed_Deer.jpg) | Allan Hack | CC BY-SA 2.0 |
| R4 | Audubon and Bachman plate, Columbian black-tailed males: antler form | [Commons](https://commons.wikimedia.org/wiki/File:Columbian_Black-Tailed_Deer,_Cervus_Richardsonii,_Aud_%26_Bach._Males_-_DPLA_-_5d24014f21392794735894c94895be1d.jpg) | J. J. Audubon | public domain |
| R5 | historical photo, Columbian black-tailed buck | [Commons](https://commons.wikimedia.org/wiki/File:Columbian_black-tailed_deer_buck.jpg) | Joseph Dixon | public domain |
| R6 | forked buck, December, winter coat (Santa Clara Co.) | [iNat photo 171078854](https://www.inaturalist.org/photos/171078854) | iNat observer | CC0 |
| R7 | buck in brush, December (Coyote Creek) | [iNat photo 341672333](https://www.inaturalist.org/photos/341672333) | iNat observer | CC0 |
| R8 | bedded deer, November (Sierra Azul): bedded pose | [iNat photo 56992552](https://www.inaturalist.org/photos/56992552) | iNat observer | CC0 |
| R9 | inland mule deer buck, for contrast (bigger, wider rack) | [Commons](https://commons.wikimedia.org/wiki/File:Mule_deer_buck_standing_on_ground_-_DPLA_-_22fc0e19747ae2e008234bc025ce15c0.jpg) | Warren Garst | CC BY-SA 4.0 |

## 4. Generation and existing meshes

Prompts (only if the adopt route fails; each under 800 characters):
- **A, hard antlers.** "A Columbian black-tailed deer buck (Odocoileus hemionus columbianus), one adult male
  standing still, side-on neutral pose, all four legs straight with clear gaps between them,
  hooves flat, head level, tail relaxed. Realistic proportions: 1.0 m at the shoulder, deep
  chest, thick neck, very large mule-deer ears. Mule-deer antlers: each main beam forks evenly
  and the rear branch forks again, three points per side, tiny brow tines, polished brown with
  pale tips, spread inside the ear tips. Grey-brown winter coat, darker forehead, white throat
  patch, white rump patch, short broad tail black on top and at the tip. No base, no ground.
  Game-ready."
- **B, velvet.** A with "reddish-brown summer coat, antlers in velvet: thick, rounded, fuzzy".
- **C, rut.** A with "neck swollen and thick from jaw to chest, dark stained hocks".

Image-to-3D: R1 or R2. Expect the antlers to fuse into a plate or vanish in the remesh; keep
the body only and add procedural antlers. Never use a generated rack as is.

| mesh | licence | triangles | verdict |
|---|---|---|---|
| [Deer, Quaternius](https://poly.pizza/m/T6Cs7tmMHJ) (the adopted doe) | CC0 | 2,096 | **base for the buck** |
| [Stag, Quaternius](https://poly.pizza/m/tQdzbZ1Cmw), same pack | CC0 | 1,933 (page) | red-deer rack, tines off one beam: wrong form; neck mane |
| [Mule deer, Poly by Google](https://poly.pizza/m/e6mV6AYvIrE) | CC BY 3.0 | 1,318 | antlered buck, static, faceted; credit needed |
| [Mule Deer, Poly by Google](https://poly.pizza/m/a4srWJqGtdR) | CC BY 3.0 | 788 | actually a spotted fawn: a fawn candidate |
| [Old Deer Male, CDmir (OpenGameArt)](https://opengameart.org/content/old-deer-male) | CC0 | not listed | rigged, textured; red-deer rack |
| [Deer Low Poly, crownjoshua (OpenGameArt)](https://opengameart.org/content/deer-low-poly-rigged) | CC0 | not listed | small whitetail-like spikes |

Route: `build_deer.py --buck`: scale 1.05, neck 1.1x (1.3x radially for rut), darker forehead,
**procedural antlers** (burr; beam up, back, then out; even fork at ~45%; rear branch forks again
for 3x3; tube radius 2.5 to 0.5 cm), HEAD part, weight 1, built per tier, never decimated with
the body. Age class from the instance seed; season from a per-vertex `_ANTLER` flag the shader
scales and colours (shed hidden, velvet 1.3x), so bucks stay one draw call with the does.

## 5. Tier targets

Same slot as the doe (`DEER_LOD` 30 / 90 m; a 1.6 m deer is ~40 px at 30 m, 70-degree 1080p).
Propose a buck per two or three does (unhunted); summer bachelor groups of 2-3, fall with does.

| tier | triangles | antlers |
|---|---|---|
| lod0 | ~2,350 | ~250 (6-sided tubes) |
| lod1 | ~1,100 | ~90 (3-sided) |
| lod2 | ~320 | ~16: one flat V per side, kept: from the air the rack is what says "buck" |

Vertex colour only, as the doe; the antler gradient runs burr to tip. No texture.

## 6. Pitfalls in generated or adopted quadrupeds (shared by the other mammal briefs)

- **Merged legs.** Slice at 15, 30, 45% of shoulder height; expect four closed sections below
  the belly. Shallow fusion: split on x = 0 and the fore-hind midplane; else regenerate ("clear
  gaps between all four legs") or reject.
- **Floating or sunk feet.** Fit the ground plane through the four legs' lowest vertices; reject
  if a foot is off by >1.5% of shoulder height; origin at the centre of the feet.
- **Wrong pivots.** Generated meshes have no skeleton: pivots from a landmark file (elbow,
  stifle, neck base, tail root as fractions of height and length), `_PARTW` blended over 5-10 cm
  so legs bend at the joint, not shear the flank. Quaternius: joints and skin weights, as
  `build_deer.py`. Render a walk in the preview; feet must not slide through the ground.
- **Over-smooth fur, lost features.** Fur returns as a blob or shards; ears, tail tips, muzzle,
  antlers melt in decimation. Protect them (separate pieces or low-collapse weights), restore
  ear size by measurement, draw grizzle as per-face colour noise.
- **Baked light, base plates, pose.** Sample textures to vertex colour, then recolour by region
  from the palette; cut everything under the foot plane; reject turned heads or lifted feet;
  symmetrize in x; scale to shoulder height, +z forward.
- **Buck.** Antler tips must clear the ground at full graze dip (clamp flick); keep 3 sides and
  1 cm minimum radius at lod1 so they do not shimmer.

## Sources

[adw]: https://animaldiversity.org/accounts/Odocoileus_hemionus/
[wp]: https://en.wikipedia.org/wiki/Columbian_black-tailed_deer
[nps]: https://home.nps.gov/orca/learn/nature/columbian-black-tailed-deer.htm
[odfw]: https://myodfw.com/index%2Ephp/big-game-hunting/species/deer
[mora]: https://www.nps.gov/parkhistory/online_books/mora/notes/vol3-14c.htm
- Also: Poly Pizza and OpenGameArt pages (licences, triangle counts); Meshy API docs (800-char
  prompts). Colour sampled from R1. Code read: `animals.js`, `animalModels.js`, `build_deer.py`.
