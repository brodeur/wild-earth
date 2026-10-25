# Coyote (Canis latrans): mesh brief

Draft by agent (Claude), 2026-10-24. Research only: nothing generated or bought. Ambient in the
tile's species list, perceived by every observer species in the tile's perception matrix; not in `animals.js` yet.
Tile records: 2 (home tile), 12 (Placerville). Local race: California valley coyote,
*C. l. ochropus*.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| total length | 1.0-1.35 m, of which the tail ~40 cm | [WP][wp] |
| head and body | 75-100 cm; draw 0.85 m | [ADW][adw] |
| shoulder height | 53-61 cm, about 61 cm (24 in) in another account; draw 0.58 m | [Dimensions][dim], [NH Nature][nh] |
| mass | 7-21 kg; males larger; southern races lighter (~11.5 kg) than northern (~18 kg); draw ~12 kg | [adw], [wp] |
| tail | about half the body length, bushy, black-tipped, **carried low** when walking and running (a wolf's is level) | [adw], [wp] |

What makes it a coyote and not a wolf, dog or fox:
- **Lean and leggy**, narrow chest, long thin legs, light frame (a third of a wolf's weight).
- **Big pointed ears** for the head (longer than a wolf's, relatively) and a **narrow, pointed
  muzzle**; yellow eyes, round pupils.
- **Grizzled tan-grey**: grey-brown to yellowish grey above with black-tipped guard hairs that
  make a dark dorsal stripe and a dark cross over the shoulders; **rufous** forelegs, ear backs,
  muzzle sides and feet; whitish throat and belly ([adw]).
- **Tail** a bushy bottle shape with a black tip and a dark spot over the scent gland near the
  base, hanging below the back line.

Colour (approximate sRGB):

| region | sRGB | note |
|---|---|---|
| back, grizzled | `#7e6650` | sampled `#835c3e` (lit) from C1, greyer in winter |
| dorsal stripe, shoulder cross | `#4b3b2e` | black-tipped guard hairs |
| flanks | `#a48563` | |
| forelegs, ear backs, muzzle sides, feet | `#b27c4e` | rufous |
| throat, belly, inner legs | `#e2d9c9` | |
| tail tip, gland spot | `#1f1a17` | |

Seasons: one moult a year, May to July ([adw]). The summer coat is short and ragged, so summer
coyotes look thin, long-legged and small-tailed; the fall and winter coat is full, with a ruff
and a bushy tail. Juveniles: pups born in spring, sooty brown, ears upright from ~10 days, out of
the den at 3-4 weeks, weaned by 5 weeks ([adw]); half-grown pups follow adults in the summer
world. Social unit: a breeding pair and its young; hunts alone, in pairs or as a family ([adw]).

## 2. Poses and motions

Template Q (`odocoileus_hemionus_buck.md`). Suggested `amp [0.45, 0.3, 1.1, 0]`,
`pose [0.3, -0.35, 0.2, 0]`; the tail's rest angle points down and back, never up.

| motion | how | part rotation enough? |
|---|---|---|
| trot (travel, long distances) | diagonal pairs, fast phase, tail low | yes |
| walk | diagonal pairs | yes |
| stand alert, ears forward | flick about -0.3 | yes |
| sniff, mouse in grass | flick dips the head | yes |
| mousing pounce | high arc from animals.js (lift and pitch), forelegs stiff and together on landing | approximate; fore-hind gait selector for the leap |
| flee, gallop | gait selector, tail straight out behind | yes with the selector |
| howl | head pitched up ~0.8 rad (negative flick), mouth closed | yes; an open mouth needs a clip |
| bedded, curled | separate curled mesh | no: variant mesh |
| playing pups, pinning prey | | clip, close range only |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| C1 | **image-to-3D candidate**: whole coyote on snow, near-white background, winter coat (Yosemite) | [Commons](https://commons.wikimedia.org/wiki/File:Canis_latrans_(Yosemite,_2009).jpg) | Yathin S Krishnappa | CC BY-SA 3.0 |
| C2 | **image-to-3D candidate**: side view walking in grass | [Commons](https://commons.wikimedia.org/wiki/File:Coyote_(Canis_latrans)_(39844726795).jpg) | Jerry Kirkhart | CC BY 2.0 |
| C3 | Golden Gate Park, standing | [Commons](https://commons.wikimedia.org/wiki/File:Canis_latrans_-_Dario_Taraborelli_-_444429592.jpeg) | Dario Taraborelli | CC0 |
| C4 | Sobrante Ridge, Richmond | [Commons](https://commons.wikimedia.org/wiki/File:Coyote_(38132396022).jpg) | Becky Matsubara | CC BY 2.0 |
| C5 | standing side-on on a lawn (Westminster) | [Commons](https://commons.wikimedia.org/wiki/File:Canis_latrans_DSC_0459_(52534803828).jpg) | Tracie Hall | CC BY-SA 2.0 |
| C6 | mousing leap (Sausalito) | [Commons](https://commons.wikimedia.org/wiki/File:Coyote_(Canis_latrans)_(7147080735).jpg) | Franco Folini | CC BY-SA 2.0 |
| C7 | side view walking on a path (Golden Gate Park) | [iNat photo 175005235](https://www.inaturalist.org/photos/175005235) | iNat observer | CC0 |
| C8 | side view walking (Rancho San Antonio) | [iNat photo 459597155](https://www.inaturalist.org/photos/459597155) | iNat observer | CC0 |
| C9 | bedded (Fort Mason) | [iNat photo 232940251](https://www.inaturalist.org/photos/232940251) | iNat observer | CC0 |
| C10 | pounce in mid-air (Santa Clara Co.) | [iNat photo 603527016](https://www.inaturalist.org/photos/603527016) | Annette Herz | CC BY |

## 4. Generation and existing meshes

- **A, neutral.** "A coyote (Canis latrans), NOT a wolf, NOT a dog. One adult standing still,
  side-on neutral pose, four long thin legs straight with clear gaps, feet flat, head level,
  bushy tail hanging down below the back line. Realistic proportions: 58 cm at the shoulder,
  85 cm head and body, lean narrow chest, large pointed upright ears, long narrow pointed muzzle.
  Grizzled tan-grey coat, darker along the spine and across the shoulders, rufous forelegs, ear
  backs and muzzle sides, whitish throat and belly, black tail tip. No collar, no base, no
  ground. Game-ready."
- **B, summer.** A with "short ragged summer coat, thin tail, looks lean and long-legged".
- **C, low-poly-friendly.** A with "clean silhouette, tail as one smooth volume, simple paws".

Image-to-3D: C1 (white background, but three-quarter, so the far side is guessed) or C2/C8 for
a clean side profile.

| mesh | licence | triangles | verdict |
|---|---|---|---|
| [Wolf, Quaternius](https://poly.pizza/m/P1gU3Qkr9r), same pack as the deer | CC0 | 1,928, skinned, clips | **adopt**: scale to 0.58 m, narrow chest and neck 0.85x, legs thinner, ears 1.25x, muzzle narrower, tail lowered and thinned, recolour |
| [Coyote, Poly by Google](https://poly.pizza/m/auVAs_kT6nE) | CC BY 3.0 | 952 | right species and colour, static, faceted; credit needed; fallback |
| [Husky, Quaternius](https://poly.pizza/m/wcWiuEqwzq) | CC0 | 1,822 | curled tail, dog head: no |
| [Wolf, Quaternius (2023)](https://poly.pizza/m/XU7oNeKShV) | CC0 | 2,740 | blocky cartoon style: no |
| [Jackal, Poly by Google](https://poly.pizza/m/4o4WNpVVGXh) | CC BY 3.0 | 1,024 | similar build, wrong colours |
| [Wolf Low Poly, crownjoshua (OpenGameArt)](https://opengameart.org/content/wolf-low-poly-rigged) | CC0 | not listed | rigged, dark stylised |

Route: adopt the Quaternius Wolf with the edits above (`tools/build_coyote.py`), the way the
deer was adopted; the Poly by Google coyote is the check for proportions and colour.

## 5. Tier targets

A family's territory covers several km² (local check), so expect 0-1 groups within the 400 m
live radius: propose cap 8, groups of 1-2 (fall to spring) and up to 6 with pups in summer.
Seen by a raven at 30-150 m (~30 px at 30 m) and by ground players at 5-80 m. LOD by size:
22 m and 68 m.

| tier | triangles | note |
|---|---|---|
| lod0 | 1,900 | ears and tail tip protected in decimation |
| lod1 | 800 | ears still pointed, tail tip dark |
| lod2 | 220 | lean silhouette, low tail |

Vertex colour only; the saddle and shoulder cross as darker face bands, grizzle as per-face
noise.

## 6. Pitfalls

Generic list in `odocoileus_hemionus_buck.md`. Coyote specific:
- **Wolf or dog prior**: heavy chest, broad head, small ears, thick legs, curled or level tail.
  Measure ear height / head length and chest width / shoulder height against the references.
- **Fox prior**: orange coat, white tail tip. Recolour from the palette.
- **Tail carriage**: the rest pose must hang the tail down and back; a level tail reads as wolf
  from the air, where the tail is half the silhouette.
- **Pounce**: a fore pivot at the elbow and a hind pivot at the stifle, or the leap folds wrong.

## Sources

[wp]: https://en.wikipedia.org/wiki/Coyote
[adw]: https://animaldiversity.org/accounts/Canis_latrans/
[dim]: https://dimensions.com/element/coyote
[nh]: https://nhnature.org/visit/animal_info_sheets/coyote.php
- Also: Poly Pizza and OpenGameArt pages (licences, triangle counts); tile inventory and
  perception files; `client/src/animals.js`, `animalModels.js`. Colour sampled from C1.
