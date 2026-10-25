# Brush rabbit (Sylvilagus bachmani): mesh brief

Draft by agent (Claude), 2026-10-24. Research only: nothing generated or bought. Ambient in the
tile's species list; perceived by the raven, hawk, fox, coyote, lion, squirrel, quail and other rabbits; prey in
the fox and coyote games. Not in `animals.js` yet. Tile records are few (1 on each tile; the
black-tailed jackrabbit, *Lepus californicus*, has 14-17 and will need its own brief), but brush
rabbits are common and secretive along chaparral and riparian edges. This brief holds the
rodent and lagomorph template the vole brief refers to.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| head and body | 30-37 cm; draw 0.33 m | [Plazi][hmw], [WP][wp] |
| tail | 1-3 cm: small, dark above, white below, barely visible | [hmw], [ADW][adw] |
| ear | 5-6 cm, small, slightly pointed | [hmw] |
| hind foot | 7.1-8.6 cm, slender, short hind legs | [hmw] |
| mass | 0.51-0.92 kg; females slightly larger | [hmw], [adw] |
| height, hunched | about 0.15 m at the shoulder (estimated from photos) | R1, R2 |

What makes it a brush rabbit and not a desert cottontail, a jackrabbit or a pet bunny:
- **Small and dark**: evenly dark grey-brown, a mix of steel grey, black and orange ticking
  ([adw]); pale grey to whitish belly ([wp], [hmw]).
- **Short ears and short legs**: ears about a sixth of body length (a desert cottontail's are
  longer, a jackrabbit's twice as long with black tips).
- **Inconspicuous tail**: no big white powder puff; the white underside shows only in flight.
- **Never far from brush**: feeds at the edge, runs a network of runways inside the cover,
  freezes, thumps a hind foot when startled, zig-zags to cover, sometimes climbs into low
  branches ([wp], [adw]).

Colour (approximate sRGB):

| region | sRGB | note |
|---|---|---|
| back | `#7a6553` | sampled `#8a7260` (lit) from R1 |
| flanks | `#8a7663` | |
| nape, ear backs | `#7b5a40` | warmer; ear rims darker `#3a2e25` |
| belly, chin, inner legs | `#c6bfb2` | |
| tail top / underside | `#4a3c30` / `#cfc9bd` | |
| feet | `#9a856c` | buff |
| eye, eye ring | `#120f0d`, `#d8cfbf` | pale ring |

Seasons: small changes (winter coat a little greyer and denser). Juveniles: born in a covered
ground nest, eyes open at ~10 days, out and weaned at 2-3 weeks ([adw]); small young with
bigger heads and shorter ears are around from spring to late summer. Mostly crepuscular: out
after sunset and again until late morning, rarely in the afternoon ([adw]).

## 2. Poses and motions: the rodent and lagomorph template (R)

The README's rodent plan, extended as in `sciurus_griseus.md` (CHEST 7, TAIL_TIP 8):

| part | id | pivot | moves by |
|---|---|---|---|
| BODY (hindquarters) | 0 | origin under the hips | instance matrix |
| LEG_A (fore pair) | 1 | elbows | swing `sin(phase)` |
| LEG_B (hind pair) | 2 | stifles; the long hind feet stay with the leg | `sin(phase + pi)`; pose folds them under |
| TAIL | 3 | tail root | flick lifts it (flash of white) |
| HEAD | 6 | neck; ears ride with the head | flick dips (nibble), negative lifts (alert) |
| CHEST | 7 | lumbar | rises to sit up; flexes in the bound |
| EARS (proposed) | 9 | ear bases | lie back flat on pose (freeze in cover, bedded) |

| motion | how | part rotation enough? |
|---|---|---|
| freeze | everything still, ears up, body low (pose 0.3) | yes |
| foraging hop | fore pair then hind pair; animals.js adds a 0.1-0.2 m arc and slight pitch per hop, 0.2-0.4 m per hop | yes |
| sprint and zig-zag to cover | fast bound, animals.js yaws 30-60 degrees every few hops | yes |
| feed, hunched | pose folds the hind legs, flick nibbles | yes |
| sit up, alert | CHEST up 30-50 degrees, head level | yes with CHEST |
| thump, groom, wash face | | clip (close range only) |
| in a form (bedded) | pose: legs folded, ears back (EARS) | yes with EARS |
| climb a low branch | instance lift and pitch | approximate |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| R1 | **image-to-3D candidate**: side view, whole rabbit on bare sand | [Commons](https://commons.wikimedia.org/wiki/File:Sylvilagus_bachmani_414242237.jpg) | Pat Farris | CC BY 4.0 |
| R2 | **image-to-3D candidate**: side view, crouched, plain path (San Mateo Co.) | [iNat photo 116224536](https://www.inaturalist.org/photos/116224536) | John Hibbard | CC BY |
| R3 | side view in leaf litter | [Commons](https://commons.wikimedia.org/wiki/File:Sylvilagus_bachmani_446422261.jpg) | Cricket Raspet | CC BY 4.0 |
| R4 | riparian brush rabbit in cover (USFWS) | [Commons](https://commons.wikimedia.org/wiki/File:Riparian_brush_rabbitt_sylvilagus_bachmani_riparius.jpg) | Brian Hansen, USFWS | public domain |
| R5 | riparian brush rabbit, side (USFWS) | [Commons](https://commons.wikimedia.org/wiki/File:Riparian_brush_rabbit_(5614738360).jpg) | USFWS Pacific Southwest | public domain |
| R6 | side view (Half Moon Bay) | [iNat photo 184587938](https://www.inaturalist.org/photos/184587938) | Cricket Raspet | CC BY |
| R7 | side view in grass (San Francisco) | [iNat photo 188605509](https://www.inaturalist.org/photos/188605509) | Rudyard | CC BY |
| R8 | sitting up, alert (Richmond) | [iNat photo 279406227](https://www.inaturalist.org/photos/279406227) | Michael Warner | CC BY |
| R9 | at the edge of cover (Point Lobos) | [iNat photo 283598468](https://www.inaturalist.org/photos/283598468) | Irina Mitine | CC BY |

## 4. Generation and existing meshes

- **A, neutral.** "A brush rabbit (Sylvilagus bachmani), a small wild cottontail, NOT a pet
  bunny, NOT a hare. One adult crouched on all fours in a neutral side-on pose, feet flat,
  head level, ears upright. Realistic proportions: 33 cm long, compact rounded body, short
  legs, short rounded ears about 5.5 cm, small eyes. Evenly dark grey-brown coat ticked with
  black and buff, warmer brown nape, pale grey belly, a tiny tail dark on top. No base, no
  ground. Game-ready."
- **B, low-poly-friendly.** A with "clean silhouette, ears as simple thick shapes, simple feet".
- **C, alert.** A with "sitting up on its haunches, ears up" (reference only).

Image-to-3D: R1 (clean sand, true side view). Expect the far legs guessed and the ears merged.

| mesh | licence | triangles | verdict |
|---|---|---|---|
| [Rabbit, CDmir (OpenGameArt)](https://opengameart.org/content/rabbit-0) | CC0 (author confirms in comments) | not listed: measure on import | **adopt**: realistic, rigged and animated, textured; hare-like ears: shorten to ~0.55x, shrink the tail, darken; bake the texture to vertex colour |
| [Cottontail rabbit, Poly by Google](https://poly.pizza/m/3vvONbRCuEF) | CC BY 3.0 | 954 | grey cottontail, static, faceted; credit needed; fallback |
| [Rabbit, Poly by Google](https://poly.pizza/m/9OBTRVYUSmt), [another](https://poly.pizza/m/dyeBDJxhDwP) | CC BY 3.0 | 674, 314 | stylised |
| [Jackrabbit, Poly by Google](https://poly.pizza/m/biNOm96olTH) | CC BY 3.0 | 994 | for the jackrabbit brief, not this one |
| [Rabbit Grey, Quaternius](https://poly.pizza/m/KRnXIKJbqp), [Bunny](https://poly.pizza/m/irZjWFARyl) | CC0 | 1,570, 5,948 | cartoon characters: no |
| [Cube Pets, Kenney](https://kenney.nl/assets/cube-pets) | CC0 | | cube style: no |

## 5. Tier targets

Spawn only along brush edges (chaparral, riparian, woodland with shrub cover) within a few metres
of cover; locally common, several per hectare in good cover (local check). Propose cap 80,
singles with loose clusters of 2-4 at dawn and dusk. Seen by the raven at 30-150 m (a 0.33 m
rabbit is ~8 px at 30 m, ~2 px at 120 m) and by fox and coyote players at 2-30 m. LOD by size:
6 m and 20 m; cull beyond ~120 m.

| tier | triangles | note |
|---|---|---|
| lod0 | 900 | eyes, ears, foot shapes |
| lod1 | 300 | ears as two thick blades |
| lod2 | 60 | a dark grey-brown egg with ears |

Vertex colour only; no texture is worth it at these sizes.

## 6. Pitfalls

Generic list in `odocoileus_hemionus_buck.md`. Rabbit specific:
- **Pet-bunny prior**: big head, huge eyes, long ears, white powder-puff tail, pastel colours.
  Measure ear / body length (target ~0.17) and recolour from the palette.
- **Hare prior** (and the CDmir source): long ears, long legs; shorten both.
- **Hind feet**: they are what reads in the hop; keep them as long flat shapes, part of LEG_B,
  and put the hind pivot at the stifle, not the hock.
- **Legs merged into the body** are normal in a crouch; separate only the forelegs for LEG_A.

## Sources

[hmw]: https://tb.plazi.org/GgServer/xml/03822308B740FFF1FF66F6E0FAD9F454
[wp]: https://en.wikipedia.org/wiki/Brush_rabbit
[adw]: https://animaldiversity.org/accounts/Sylvilagus_bachmani/
- Plazi treatment of *S. bachmani* (descriptive notes), Wikipedia, Animal Diversity Web;
  Poly Pizza, OpenGameArt and Kenney pages; tile
  inventory and perception files; `client/src/animals.js`, `animalModels.js`. Colour from R1.
