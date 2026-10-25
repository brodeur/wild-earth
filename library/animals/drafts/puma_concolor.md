# Mountain lion (Puma concolor): mesh brief

Draft by agent (Claude), 2026-10-24. Research only: nothing generated or bought. Ambient in the
tile's species list; perceived by the raven, deer, fox, coyote, vulture and other lions, so
it matters most in the deer game. Not in `animals.js` yet. Tile records: 1 (home tile), 3
(Placerville), and a 2012 trail-camera lion from Camino, near the Placerville tile (C9).

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| head and body | males 1.02-1.54 m, females 0.86-1.31 m; draw a female at 1.15 m, a male at 1.30 m | [ADW][adw] |
| tail | males 0.68-0.96 m, females 0.63-0.79 m: about 60% of the head and body; draw 0.72 / 0.80 m | [adw] |
| shoulder height | 60-90 cm; draw 0.68 m (female), 0.75 m (male) | [WP][wp] |
| mass | North America: males average 62 kg, females 42 kg | [wp] |

What makes it a mountain lion and not an African lioness, a house cat or a leopard:
- **Small round head** on a long, low, muscular body; hindquarters higher than the shoulders;
  big paws.
- **Long, heavy, cylindrical tail** with a **dark tip**, usually carried low with the end curved
  up (a J); a third of the animal's length.
- **Plain tawny coat**, no spots, no mane, no tail tuft; yellowish-brown to greyish-brown above,
  paler below ([adw]); silvery-grey to reddish across the range ([wp]).
- **Face**: white or cream muzzle, chin and throat; black patches at the sides of the muzzle
  (whisker bases); pinkish nose bordered in black; black backs of the ears ([adw]).

Colour (approximate sRGB; references C2-C4 are Californian, C1 is a greyer Patagonian cat):

| region | sRGB | note |
|---|---|---|
| body, flanks | `#a37e58` | estimated from the California references |
| back, top of tail | `#8b6a4b` | a shade darker |
| belly, inner legs, chin, muzzle, throat | `#e4dccd` | |
| muzzle-side patches, ear backs, tail tip | `#2a221d` | |
| nose | `#b08079` | pinkish, black border |
| eye | `#b08a3c` | golden to grey-brown in adults |

Seasons: summer coat shorter and redder, winter coat denser and greyer (local check). Juveniles:
kittens are spotted, with ringed tails and blue eyes ([wp]); the spots fade through the first
year and stay faint on the flanks of young lions still travelling with their mother, which can
be into their second year. Solitary except mothers with young and brief mating pairs ([adw]).

## 2. Poses and motions

Template Q (`odocoileus_hemionus_buck.md`) with a feline layout: fore pivot at the elbow, held
well below the shoulder blades; hind pivot at the stifle; TAIL plus TAIL_TIP (id 8) for the
long tail. Suggested `amp [0.35, 0.3, 0.6, 0]`, `pose [0.35, -0.2, 0.3, 0]`.

| motion | how | part rotation enough? |
|---|---|---|
| walk | diagonal pairs at low amplitude (a cat's walk is a lateral sequence; at distance the diagonal reads) | yes |
| stalk | pose ~0.5 (legs half squashed, body low), head low and level (pose), slow phase with pauses, TAIL_TIP twitching | at distance yes; up close the squash sinks the elbows, so a clip |
| crouch, wait in ambush | pose ~0.8, still, tail tip twitch | yes, with TAIL_TIP |
| rush and leap onto the back of prey | gait selector to a bound, then a lift arc from animals.js | approximate; the kill is a clip |
| stand alert | flick about -0.2 | yes |
| bedded (sphinx or on the side) | pose 1 (sphinx); lying on the side needs a variant mesh | sphinx yes |
| feed at a cached kill, drink | flick dips the head | yes |
| leap into a tree (up to 5.5 m) | instance arc | yes, crude |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| C1 | **image-to-3D candidate**: side view, whole cat walking, open steppe (Patagonian race, greyer) | [Commons](https://commons.wikimedia.org/wiki/File:Puma_%28Puma_concolor_concolor%29_female_Leona_Amarga.jpg) | Charles J. Sharp | CC BY-SA 4.0 |
| C2 | **image-to-3D candidate**: P-1, side view, whole lion, dark night background (Santa Monica Mts.) | [Commons](https://commons.wikimedia.org/wiki/File:Puma_concolor_P-1.jpg) | NPS, Santa Monica Mountains NRA | public domain |
| C3 | P-12 walking (Santa Monica Mts.) | [Commons](https://commons.wikimedia.org/wiki/File:Puma_concolor_P-12.jpg) | NPS | public domain |
| C4 | P-2 in cover | [Commons](https://commons.wikimedia.org/wiki/File:Puma_concolor_P-2.jpg) | NPS | public domain |
| C5 | stalking crouch on gravel | [Commons](https://commons.wikimedia.org/wiki/File:Puma_%28Puma_concolor_concolor%29_female_hunting_Leona_Amarga.jpg) | Charles J. Sharp | CC BY-SA 4.0 |
| C6 | crouching | [Commons](https://commons.wikimedia.org/wiki/File:Crouching_Puma_%2813728011803%29.jpg) | Charles Barilleaux | CC BY 2.0 |
| C7 | on rock, Glacier NP | [Commons](https://commons.wikimedia.org/wiki/File:Mountain_Lion_in_Glacier_National_Park.jpg) | NPS | public domain |
| C8 | walking in green grass, California | [iNat photo 65506150](https://www.inaturalist.org/photos/65506150) | iNat observer | CC0 |
| C9 | trail camera, Camino, El Dorado County (near the tile) | [iNat photo 165246](https://www.inaturalist.org/photos/165246) | Bob Dodge | CC BY |
| C10 | crossing a road side-on (San Mateo Co.) | [iNat photo 120106486](https://www.inaturalist.org/photos/120106486) | J. Roe | CC BY |

## 4. Generation and existing meshes

- **A, neutral.** "A mountain lion (cougar, Puma concolor) of California, NOT an African lion,
  no mane, no spots. One adult female standing still, side-on neutral pose, four legs straight
  with clear gaps, big paws flat, head level. Realistic proportions: 68 cm at the shoulder,
  1.15 m head and body, small round head, long low muscular body, hindquarters a little higher
  than the shoulders, very long thick tail (0.72 m) hanging low with the tip curving up. Plain
  tawny coat, cream muzzle, chin, throat and belly, black patches beside the muzzle, black backs
  of the ears, dark tail tip. No base, no ground. Game-ready."
- **B, male.** A with "adult male, heavier neck and shoulders, 75 cm at the shoulder".
- **C, stalking.** A with "crouched low, stalking, head low and level" (reference only).

Image-to-3D: C2 (public domain, clean silhouette, but flash-lit colour) or C1 (greyer race;
recolour). Expect the tail fused to a hind leg in side views: cut and rebuild it.

| mesh | licence | triangles | verdict |
|---|---|---|---|
| [Cougar, Poly by Google](https://poly.pizza/m/8nuCN-gn2s-) | CC BY 3.0 | 980 | tawny, plain, standing; static, faceted; credit needed: **interim stand-in** |
| [Cougar, Poly by Google](https://poly.pizza/m/1ICRwBHSin7) | CC BY 3.0 | 948 | spotted (leopard-like): no |
| [Bobcat](https://poly.pizza/m/bvsVdF1hLme), [Jaguar](https://poly.pizza/m/4fb-oMr2uUF), [Lion](https://poly.pizza/m/3XAJojWxSWz), Poly by Google | CC BY 3.0 | 1,034, 1,020, 1,350 | wrong species |
| [Animated Animals, Quaternius (OpenGameArt)](https://opengameart.org/content/animated-animales-low-poly) | CC0 | | a domestic cat: no |

No CC0 cougar was found on Poly Pizza, OpenGameArt or Kenney. Route: generate from text (A, two
`meshy-6-lite` previews at 5 credits each, keep the better), decimate, recolour from the
palette; no refine needed (vertex colour). Use the Poly by Google cougar until then.

## 5. Tier targets

The rarest animal here: a lion's home range is tens to hundreds of km² (local check), so spawn
it like the hawks, on a coarse territory grid (several km) with a small chance, never more than
one adult in the live radius (a mother with 1-3 young at most). Propose cap 3. Because only one
or two are ever drawn, the budget can be higher than a deer's. Seen by deer players at 10-80 m,
by the raven at 30-150 m. LOD by size (2 m with tail): 40 m and 124 m.

| tier | triangles | note |
|---|---|---|
| lod0 | 3,000 | face marks, ear backs, paws, tail in two segments |
| lod1 | 1,200 | tail tip dark |
| lod2 | 350 | low tawny body, long tail |

Vertex colour; a plain coat suits it. A texture is not worth it unless the lion becomes playable.

## 6. Pitfalls

Generic list in `odocoileus_hemionus_buck.md`. Lion specific:
- **African lion prior**: mane, tail tuft, heavy head; **house cat prior**: big head, short
  legs, short tail; **leopard prior**: spots. Check head / body length and tail / body.
- **Short or fused tail**: rebuild to 60% of head and body, tapered little, dark tip, one TAIL
  segment and one TAIL_TIP.
- **Back line**: hindquarters must sit a little higher than the shoulders; a level or dipped
  back reads as a dog.
- **Stalk sinking**: the leg squash pulls the elbows into the chest; limit pose to ~0.6 until a
  second leg pivot exists.

## Sources

[adw]: https://animaldiversity.org/accounts/Puma_concolor/
[wp]: https://en.wikipedia.org/wiki/Cougar
- Also: Poly Pizza and OpenGameArt pages (licences, triangle counts); Meshy API docs and
  `docs/animal-library.md` (credit costs); tile inventory and perception files;
  `client/src/animals.js`, `animalModels.js`.
