# California vole (Microtus californicus): mesh brief

Draft by agent (Claude), 2026-10-24. Research only: nothing generated or bought. Ambient in the
tile's species list; perceived by the raven, hawk, fox, coyote and other voles (the vole itself
perceives voles, foxes, coyotes, hawks and ravens). Not in `animals.js` yet. Tile records are few (2 on
the home tile; a *M. montanus* record on Placerville), but in grassland it is the most numerous
mammal by far: hundreds per acre at peaks, up to a thousand per hectare ([ADW][adw]).

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| total length | 139-214 mm (northern California 139-207); draw 0.17 m | [adw] |
| tail | 39-68 mm, short: about a quarter of the total; draw 0.045 m | [adw], [WP][wp] |
| mass | 30-81 g; males ~6% longer, 11% heavier; draw 50 g | [adw] |
| height | about 4 cm at the back when moving (estimated) | V1, V2 |

What makes it a vole and not a mouse or a hamster:
- **Blunt, rounded face**, short muzzle, **small eyes**, **small ears** half-hidden in the fur.
- **Stocky, cylindrical body**, short legs that barely show.
- **Short tail**, bicoloured (dark above, grey below), not the long thin tail of a deer mouse.
- **Coat**: cinnamon to tawny olive, ticked with darker hairs, grizzled brown on the back with a
  reddish tinge along the middle; grey to whitish belly; grey feet; coastal animals blackish,
  marsh animals darker ([adw], [wp]).
- Lives in **runways** through grass and in burrows (1.5-12 m long), with clipped grass piles
  ([adw], [wp]); active in short bursts every few hours, most at dawn and dusk, all year.

Colour (approximate sRGB):

| region | sRGB | note |
|---|---|---|
| back | `#6b5a48` | sampled `#5e554f` from V1, which is in shade |
| dorsal tinge | `#7a5c42` | reddish line down the back |
| flanks | `#7d6b57` | |
| belly | `#8f8b86` | blue-grey to whitish |
| feet | `#a39b91` | |
| tail top / underside | `#3d342d` / `#8a8580` | |
| eye | `#0d0d0d` | small, beady |

Seasons: no clear coat change. Juveniles: ~2.5 g at birth, weaned at ~2 weeks ([adw]); young
are smaller and look greyer and darker (local check). Breeds mainly in the wet season, so the
spring world has the most voles and the late-summer world the fewest.

## 2. Poses and motions

Rodent and lagomorph template R (see `sylvilagus_bachmani.md`), simplified: BODY, LEG_A (fore
pair), LEG_B (hind pair), HEAD; the tail is too short to animate and stays in BODY; ears in HEAD.

| motion | how | part rotation enough? |
|---|---|---|
| scurry along a runway | fast small steps (fore and hind half a cycle apart), body bob from animals.js, mostly translation | yes |
| freeze | all still, head up a little | yes |
| forage, clip grass | head dips (flick); for a seed head, CHEST lifts a little | yes |
| sit up to eat | CHEST up 40 degrees, forepaws to the mouth | with CHEST; paws need a clip at close range |
| dash into a burrow | translate into the burrow mouth, scale down and cull | yes |
| groom, fight | | clip; only a vole player would see it |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| V1 | **image-to-3D candidate**: side view, whole vole on bare soil | [Commons](https://commons.wikimedia.org/wiki/File:California_Vole_%28Microtus_californicus%29.jpg) | Jerry Kirkhart | CC BY 2.0 |
| V2 | **image-to-3D candidate**: side view on gravel, whole animal (Half Moon Bay) | [iNat photo 263221940](https://www.inaturalist.org/photos/263221940) | Cricket Raspet | CC BY |
| V3 | cropped V1, closer | [Commons](https://commons.wikimedia.org/wiki/File:California_Vole_%28Microtus_californicus%29_%28cropped%29.jpg) | Jerry Kirkhart | CC BY 2.0 |
| V4 | side view on ground (Berkeley) | [iNat photo 146492538](https://www.inaturalist.org/photos/146492538) | Rupert Clayton | CC BY |
| V5 | face and eye (Ed R. Levin County Park) | [iNat photo 410769535](https://www.inaturalist.org/photos/410769535) | iNat observer | CC0 |
| V6 | in the open (Santa Clara Co.) | [iNat photo 9227915](https://www.inaturalist.org/photos/9227915) | iNat observer | CC0 |
| V7 | in grass, side (Moss Beach) | [iNat photo 428876001](https://www.inaturalist.org/photos/428876001) | Cricket Raspet | CC BY |
| V8 | coastal dark form (Moss Beach) | [iNat photo 419462619](https://www.inaturalist.org/photos/419462619) | Cricket Raspet | CC BY |
| V9 | among litter (Contra Costa Co.) | [iNat photo 408956959](https://www.inaturalist.org/photos/408956959) | datadan | CC BY |

## 4. Generation and existing meshes

- **A, neutral.** "A California vole (Microtus californicus), a wild meadow vole, NOT a mouse,
  NOT a hamster. One adult on all fours in a neutral side-on pose, feet on the ground, head
  level. Realistic proportions: 17 cm long including a short 4.5 cm tail, stocky cylindrical
  body, short legs, blunt rounded face, small beady eyes, small round ears almost hidden in
  fur. Grizzled cinnamon-brown back with darker ticking, grey belly, grey feet, tail dark above
  and grey below. No whiskers as strands. No base, no ground. Game-ready."
- **B, low-poly-friendly.** A with "smooth simple shapes, a rounded body, simple stub legs".
- **C, eating.** A with "sitting up holding a grass stem" (reference only).

Image-to-3D: V1 or V2; expect the soil to fuse under the body and stub legs.

| mesh | licence | triangles | verdict |
|---|---|---|---|
| [Rat, Quaternius](https://poly.pizza/m/iltq5bVNaV) | CC0 | not listed, skinned | rodent rig; needs tail cut to 30%, muzzle blunted, ears shrunk, body fattened: most of the shape changes |
| [Woodrat, Poly by Google](https://poly.pizza/m/24Xnzj_Nmln) | CC BY 3.0 | 964 | brown, long tail, big ears |
| [Mouse, Poly by Google](https://poly.pizza/m/4KKE4D2FV1D), [another](https://poly.pizza/m/5N7L6S3uIzx) | CC BY 3.0 | 776, 826 | mice: big ears, long tails |
| [Mouse basemesh, noway (OpenGameArt)](https://opengameart.org/content/mouse-basemesh) | CC0 | ~700 | untextured, "not game ready" |
| [Mice, MiniPoly](https://poly.pizza/m/Oud9UeK39O) | CC0 | 1,846 | cartoon |

None reads as a vole without rebuilding it. Route: one text-to-3D preview (A; `meshy-6-lite`,
5 credits), decimated to the tiers and recoloured from the palette. A procedural `buildVole` in
`animalModels.js` (two spheres and stubs, ~150 triangles) is an acceptable stand-in until then.

## 5. Tier targets

Draw voles only near small or low observers: within ~40 m of the camera when it is under ~10 m
above the ground (the raven sees them at 30 m as 4 px, which a lod2 dot covers), in grassland
and oak savanna. Propose cap 150, scattered along runways, more in spring. LOD by size: 3 m and
10 m; cull beyond 40 m.

| tier | triangles | note |
|---|---|---|
| lod0 | 400 | eye, ear bumps, feet |
| lod1 | 120 | body, head, tail stub |
| lod2 | 24 | a brown capsule |

Vertex colour only.

## 6. Pitfalls

Generic list in `odocoileus_hemionus_buck.md`. Vole specific:
- **Mouse prior**: big ears, big eyes, pointed snout, long thin tail, white belly; **hamster
  prior**: no tail, round cartoon face. Check tail / total (~0.27) and ear height.
- **No legs or fused stubs**: normal at this size, but the feet must sit on the ground plane.
- **Whisker strands and hair spikes**: delete thin shards before decimating.
- **Scale**: generators return a unit-size model; scale to 0.17 m and check against the rabbit
  and squirrel on the lineup.

## Sources

[adw]: https://animaldiversity.org/accounts/Microtus_californicus/
[wp]: https://en.wikipedia.org/wiki/California_vole
- Also: Poly Pizza and OpenGameArt pages (licences, triangle counts); Meshy API docs and
  `docs/animal-library.md` (credit costs); tile inventory and perception files;
  `client/src/animals.js`, `animalModels.js`. Colour sampled from V1.
