# Gray fox (Urocyon cinereoargenteus): mesh brief

Draft by agent (Claude), 2026-10-24. Research only: nothing generated or bought. A **playable**
species in the brief and in the tile's perception matrix (it perceives deer, rabbits, voles,
coyotes, lions and other foxes), so it needs an ambient model and, later, a player model seen
from a chase camera. Not in `animals.js` yet. Northern California race: *U. c. townsendi*.
Tile records: 6 (home tile) and 19 (Placerville), second only to deer among these mammals.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| total length | 76-112.5 cm | [WP][wp] |
| tail | 27.5-44.3 cm, about a third of the total; draw 0.36 m | [wp], [ADW][adw] |
| head and body | about 53-74 cm; draw 0.60 m | [IL DNR][il] |
| shoulder height | about 35-40 cm (sources vary, 30-43); draw 0.37 m | [SC DNR][sc], [Dimensions][dim] |
| mass | usually 3-5 kg, up to 9; males slightly larger | [adw], [wp] |

What makes it a gray fox and not a red fox (the generators' default):
- **Black dorsal stripe** that runs down the tail as a coarse black mane and ends in a **black
  tip** (never white).
- **Grizzled grey back** (salt-and-pepper guard hairs banded white, grey and black), with **rusty
  cinnamon** on the sides of the neck, a band along the lower flanks, the chest sides, the backs
  of the legs and the ear edges. White throat, cheeks and belly centre.
- **Black facial stripe** from the inner eye to the muzzle, black lips and nose; oval pupils.
- **Cat-like build**: shorter legs and muzzle than a red fox, compact body; **no black
  stockings**; looks smaller than a red fox of the same weight.
- **Climbs trees**, the only canid that does: up leaning trunks and branchless trunks to ~18 m,
  jumps branch to branch, comes down backwards or jumps; dens up to ~9 m up in hollows.

Colour (approximate sRGB; photo samples are lit, albedo a little darker):

| region | sRGB | note |
|---|---|---|
| back, crown, upper flanks | `#7c7d7f` | sampled `#838486` from F1 |
| dorsal stripe, tail mane | `#2a2725` | black-tipped guard hairs |
| tail tip | `#1d1b1a` | black |
| rust: neck sides, flank band, leg backs, ear edges, tail underside | `#a2683e` | estimated; F1 samples mix grey and rust (`#937b61`) |
| throat, cheeks, belly centre | `#e8e2d6` | |
| eye-to-muzzle stripe, lips, nose | `#1a1817` | |

Seasons: one moult a year; the winter coat is dense with a full tail, the summer coat thin, so
summer foxes look leggy and small. Juveniles: kits born in spring are dark brown at birth
([adw]); they hunt with the parents from ~3 months and disperse in fall ([wp]). In the summer
world a family is 2 adults and ~3-5 half-grown kits.

## 2. Poses and motions

Quadruped template Q (see `odocoileus_hemionus_buck.md`): LEG_A left fore + right hind, LEG_B
the other diagonal, TAIL, HEAD (neck, head, ears). Suggested `amp [0.5, 0.35, 1.0, 0]`,
`pose [0.3, -0.25, 0.2, 0]` (tail droops when bedded).

| motion | how | part rotation enough? |
|---|---|---|
| walk, trot (main travel gait) | diagonal pairs | yes |
| stand alert | flick about -0.3: head up, ears forward with it | yes |
| sniff, forage, eat | flick dips the head | yes |
| mouse pounce | arc from animals.js (lift, pitch) with forelegs reaching | approximate; fore-hind split (template Q gait selector) for the reach |
| flee, gallop | gait selector to fore-against-hind | yes with the selector |
| tree climb | squirrel-style: instance pitched up a leaning oak trunk (`trunkAt`), legs alternate fore and hind; descend tail-first or jump | at distance yes; close up a clip |
| sit on haunches | hind pair folds, chest up | needs CHEST (id 7) |
| bedded curled, tail over nose | cannot be posed from standing | a second, curled mesh (few foxes, so a separate InstancedMesh is cheap) |
| player fox | trot, gallop, pounce, climb, dig, curl, mark | keep the Quaternius skeleton and clips (skinned), not the part rig |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| F1 | **image-to-3D candidate**: side view, whole fox standing on a log, clean pose (Nevada) | [Commons](https://commons.wikimedia.org/wiki/File:Gray_fox.jpg) | VJAnderson | CC BY-SA 4.0 |
| F2 | **image-to-3D candidate**: side view, whole animal (Red Rock Canyon, NV) | [Commons](https://commons.wikimedia.org/wiki/File:Gray_Fox_-_Red_Rock_Canyon,_Nevada_copy.jpg) | James Marvin Phelps | CC BY 3.0 |
| F3 | California fox, standing (CA Dept. of Water Resources) | [Commons](https://commons.wikimedia.org/wiki/File:Grey_Fox_(Urocyon_cinereoargenteus).jpg) | CA DWR | public domain |
| F4 | San Luis Obispo County | [Commons](https://commons.wikimedia.org/wiki/File:GRAY_FOX_(Urocyon_cinereoargenteus)_(5-29-08)_canet_rd,_slo_co,_ca_(2542733736).jpg) | Alan Schmierer | CC0 |
| F5 | profile, eastern Sierra, 7,000 ft | [Commons](https://commons.wikimedia.org/wiki/File:Urocyon_cinereoargenteus_grayFox_cameo.jpg) | Dcrjsr | CC BY 3.0 |
| F6 | CDFW file photo | [Commons](https://commons.wikimedia.org/wiki/File:Gray_fox_02_(urocyon_cinereoargenteus)_(22170855673).jpg) | CDFW | CC BY 2.0 |
| F7 | walking side-on (Inverness, CA) | [iNat photo 524183670](https://www.inaturalist.org/photos/524183670) | datadan | CC BY |
| F8 | **in a tree**: climbing reference (Los Angeles Co.) | [iNat photo 348131156](https://www.inaturalist.org/photos/348131156) | klicklo | CC BY |
| F9 | in brush, side (Muir Beach) | [iNat photo 46962938](https://www.inaturalist.org/photos/46962938) | Catie Clune | CC BY |

## 4. Generation and existing meshes

- **A, neutral.** "A gray fox (Urocyon cinereoargenteus), NOT a red fox. One adult standing
  still, side-on neutral pose, four legs straight with clear gaps, feet flat, head level, tail
  held out low behind. Realistic proportions: 37 cm at the shoulder, 60 cm head and body, compact
  cat-like build, short legs, short muzzle, large triangular ears. Grizzled salt-and-pepper grey
  back, rusty cinnamon neck sides, flank band and leg backs, white throat and cheeks, black
  stripe from eye to muzzle, no black stockings. Thick tail with a black stripe along the top
  and a black tip, no white tip. No base, no ground. Game-ready."
- **B, low-poly-friendly.** A with "clean silhouette, tail as one smooth volume, simple paws".
- **C, trotting.** A with "mid-trot, diagonal legs forward" (pose reference only, not rigged).

Image-to-3D: F1 (CC BY-SA, credit) or F2. Expect the log fused under the feet and the far legs
guessed; cut at the foot plane.

| mesh | licence | triangles | verdict |
|---|---|---|---|
| [Fox, Quaternius](https://poly.pizza/m/Bc97C66HKi), same pack as the deer | CC0 | 1,826, skinned, clips | **adopt**: a red fox (orange, black socks, white tail tip); recolour by region, legs 0.9x, muzzle 0.9x, tail thicker with a black top stripe and black tip |
| [Gray fox, Poly by Google](https://poly.pizza/m/2LZMldgUhTj) | CC BY 3.0 | 1,024 | the right species, static, faceted; credit needed; good fallback and colour check |
| [Fox, br-n518 (OpenGameArt)](https://opengameart.org/content/fox-0) | CC0 | 342, textured, animated | cartoon proportions |
| other Poly Pizza foxes (Google, Jake Blakeley, madtrollstudio) | CC BY 3.0 | 560-1,340 | red foxes, stylised |

Route: adopt the Quaternius Fox like the deer (`tools/build_fox.py`), keeping its skeleton and
clips for the later player model.

## 5. Tier targets

Gray fox territories are on the order of 1 km² (local check), so 0-2 ambient foxes within the
400 m live radius, plus players. Propose cap 16 (family groups to 6 in summer). Seen by a raven
at 30-150 m (a 0.95 m fox is ~25 px at 30 m) and by other ground players at 3-60 m.
LOD by size (lod0 above ~40 px): 18 m and 56 m.

| tier | triangles | note |
|---|---|---|
| player | 4,000-6,000 skinned | chase camera at 3-5 m; a 1K albedo texture for the grizzle and face mask |
| lod0 | 1,800 | the source as is; facial stripe and tail tip as their own faces |
| lod1 | 700 | black tail tip and white throat kept |
| lod2 | 200 | grey body, dark tail line |

Ambient: vertex colour, plus per-face colour noise for the grizzle. Worth testing a shared
object-space fur-noise multiply at lod0 (like the rock detail texture), cheaper than UVs.

## 6. Pitfalls

Generic list in `odocoileus_hemionus_buck.md` (merged legs, floating feet, pivots, over-smoothing,
baked light, base plates). Gray-fox specific:
- **Red fox drift**: orange coat, white tail tip, black stockings, long legs. Recolour from the
  palette regardless of the texture; check the tail tip is black and the legs are not.
- **Thin tail**: widen to the brushy volume of the references, keep it one piece for TAIL.
- **Fennec ears**: oversized ears from "fox" priors; measure ear height against head length.
- **Front leg pivots too low**: a trot looks robotic if the fore pivot sits at the knee (carpus);
  put it at the elbow, as the README's template says.
- **Climb**: the pitched body must touch the bark; offset the instance by the chest depth.

## Sources

[wp]: https://en.wikipedia.org/wiki/Gray_fox
[adw]: https://animaldiversity.org/accounts/Urocyon_cinereoargenteus/
[il]: https://dnr.illinois.gov/education/wildaboutpages/wildaboutwildmammals/wildaboutmammalscarnivores/wawmgrayfox.html
[sc]: https://dnr.sc.gov/marine/mrri/acechar/speciesgallery/Mammals/GrayFox/index.html
[dim]: https://www.dimensions.com/element/gray-fox
- Also: Poly Pizza and OpenGameArt pages (licences, triangle counts); tile inventory and
  perception files; `client/src/animals.js`, `animalModels.js`. Colour sampled from F1.
