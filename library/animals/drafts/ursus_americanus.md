# American black bear (Ursus americanus): mesh brief

Draft by agent (Claude), 2026-10-27, for the first Yosemite tile (`utm11n_270_4180`: Half Dome, the valley floor at
1,200 m up to 3,000 m). The Sierra's only bear (the California grizzly is extinct, the last one shot in 1922), so
the species any Yosemite visitor knows. Not in any tile's species list until `pipeline/species_data.py` lists it and
the species step is re-run; the client sees it everywhere until then (`animals.js` `PENDING`). A large omnivore that
hunts nothing here: acorns, berries, grass and sedge, insects and grubs, and carrion it comes to from far off.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| head and body | 1.2-1.9 m in the Sierra (males the larger); draw 1.5 m | [ADW][adw], [CDFW][cdfw] |
| shoulder height | 0.7-0.9 m standing on all fours; draw 0.8 m | [adw], [cdfw] |
| tail | a stub, 8-14 cm, mostly hidden in the rump fur | [adw] |
| mass | Sierra adults roughly 45-180 kg; males about half again a female; fall heavier than spring | [cdfw], [wp] |

What makes it a black bear and not a grizzly, a dog or a pig (the generators' priors):
- **No shoulder hump.** The top line is level or highest over the hips; a grizzly's is highest over a muscled hump
  at the shoulders. A heavy, round, barrel body on short, thick, straight legs, the head carried a little below the
  back line when it walks.
- **Straight face**: a long, straight muzzle from brow to nose (a "Roman" profile), not the grizzly's dished face;
  a broad forehead.
- **Ears tall and rounded**, set up on the crown and clearly visible (a grizzly's are short and round, half hidden),
  but small against the head beside a dog's or a cat's.
- **Short, curved dark claws** (about 3-4 cm, for climbing), not the grizzly's long pale digging claws.
- **Plantigrade**: walks on the whole sole of the hind foot; big, flat, wide paws.
- **Colour**: black, brown, cinnamon and blond all occur, and in the Sierra the brown and cinnamon phases are as
  common as black (a minority are jet black) ([cdfw]); the **muzzle is tan** in every phase, often with a pale chest
  blaze. So a dark brown body with a tan muzzle is right for the drawn bear; a cinnamon instance colour later is a
  cheap variant.

Colour (approximate sRGB; to check against Yosemite photos):

| region | sRGB | note |
|---|---|---|
| body, flanks | `#3d2b20` | dark chocolate brown |
| back, top of the head, shoulders | `#30221a` | a shade darker, guard hairs |
| legs, paws | `#2a1f19` | darkest (black bears' legs are darker than the body in brown phases) |
| belly | `#4a3527` | a little lighter, thinner fur |
| muzzle (to the eyes), cheeks below the eye | `#a8845e` | tan |
| nose pad, lips | `#1d1714` | |
| inner ears | `#4c3a2e` | |
| eye | `#2a1a10` | small, dark brown |
| claws | `#1e1915` | |
| cinnamon variant (not drawn yet) | `#8a5a35` | |

Seasons: dens from about December to March or April (in the Sierra a bear may wake and move on a warm winter day);
active in spring on new grass and carrion; in summer on berries, insects and grubs, bedding in shade at midday; in
fall (August to November) in **hyperphagia**, feeding up to 20 hours a day, much of it on acorns in oak woodland
below the conifers, and then out by day ([cdfw], [nps]). Young: one to three cubs, born in the den in January, out
with the sow from April, about 0.3 m at the shoulder their first summer, with her through their first winter.
Solitary except sows with cubs and brief mating pairs in June and July ([adw]).

## 2. Poses and motions

Template Q (`odocoileus_hemionus_buck.md`): BODY, LEG_A (left fore + right hind), LEG_B, TAIL (the stub; no
TAIL_TIP), HEAD (neck and head, pivot at the neck's base). Fore pivot at the elbow, held low (the bear's legs are
short and the elbow is at the belly line), hind pivot at the stifle. Suggested `amp [0.3, 0.1, 0.7, 0]` (a short
swing, a stub tail, a deep head dip for digging and foraging), `pose [0.3, 0.1, 0.35, 0]`.

| motion | how | part rotation enough? |
|---|---|---|
| walk (amble) | diagonal pairs, short swing, a slow 1 m/s; the head low and nodding | yes |
| trot, run | diagonal pairs to the gait selector's gallop (fore pair against hind pair) at a run (up to ~13 m/s in bursts) | yes, at distance |
| sniff, forage, dig | flick dips the head to the ground, held; a paw rake is a clip (at distance the dip reads) | yes |
| stand alert | flick about -0.3 (head up, nose up) | yes |
| bluff charge | a run of a few metres at the threat, then a stop facing it | yes (motion from animals.js) |
| stand up on the hind legs | to look or smell | no: a clip or a second pivot at the hips |
| bedded | pose 1: legs folded, belly on the ground, head on the paws (flick) | yes |
| climb a tree | instance on the bark as the fox's climb | crude |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| B1 | **image-to-3D candidate**: side view, a brown-phase black bear walking, Yosemite | [Commons, category](https://commons.wikimedia.org/wiki/Category:Ursus_americanus_in_Yosemite_National_Park) | various (many NPS, public domain) | check per file |
| B2 | black bear in Yosemite Valley meadow | [NPS Yosemite bears](https://www.nps.gov/yose/learn/nature/bears.htm) | NPS | public domain |
| B3 | cinnamon black bear, side view | [Commons, category](https://commons.wikimedia.org/wiki/Category:Cinnamon_bears) | various | check per file |
| B4 | black bear side profile (eastern, black phase), the head and ear shape | [Commons](https://commons.wikimedia.org/wiki/File:Ursus_americanus_PO.jpg) | | check |
| B5 | iNaturalist research-grade observations near Yosemite Valley (CC0 / CC BY ones only) | [iNat](https://www.inaturalist.org/observations?taxon_id=41638&place_id=68542) | observers | per photo |

Image links are search starting points; the lineup page thumbnails only CC0 and CC BY files.

## 4. Generation and existing meshes

- **A, neutral.** "An American black bear (Ursus americanus) of the Sierra Nevada, California, NOT a grizzly: no
  shoulder hump, a straight face profile and tall rounded ears. One adult standing still on all four legs, side-on
  neutral pose, legs straight with clear gaps between them, big flat paws with short dark claws, head level and a
  little lower than the shoulders. Realistic proportions: 80 cm at the shoulder, 1.5 m head and body, a heavy round
  body, the rump as high as the shoulders, short thick legs, a tiny stub tail. Dark brown fur, tan muzzle, black
  nose, small dark eyes. No base, no ground. Game-ready."
- **B, male.** A with "adult male, heavier neck and shoulders but still no hump, 85 cm at the shoulder, 1.7 m head
  and body".
- **C, foraging.** A with "head down to the ground, nose in the grass" (reference only).

Settings as the mountain lion's: text-to-3D preview, `ai_model latest`, triangle remesh to 20,000 faces (20
credits); no refine (vertex colour from the palette). One preview of A; a second (B) only if A is clearly wrong.

Existing meshes: Poly Pizza and OpenGameArt have cartoon or low-poly bears (Poly by Google "Bear", CC BY 3.0,
generic brown, grizzly-like; Quaternius animal packs, CC0, stylised, no black bear). None reads as a black bear at
the lineup's scale, so it is generated.

## 5. Tier targets

Rare like the lion: a home range of several to tens of km² (females smaller), spawned on a coarse territory grid
with a small chance, at most one group (a lone adult, or a sow with one or two cubs) in the live set. Cap 3. Seen
from 10-150 m by the ground animals and the raven. LOD by size (1.7 m long, 0.8 m high): 40 m and 124 m, as the lion.

| tier | triangles | note |
|---|---|---|
| lod0 | 3,000 | ears, tan muzzle, nose, eyes, claws |
| lod1 | 1,200 | muzzle tan, ears |
| lod2 | 350 | a dark round body on short legs |

Vertex colour; a dark coat suits it, with faint per-face noise so it does not read as a flat black shape.

## 6. Pitfalls

Generic list in `odocoileus_hemionus_buck.md`. Bear specific:
- **Grizzly prior**: a shoulder hump, a dished face, short round ears, long pale claws, a silver-tipped coat. Check
  the top line (highest over the hips or level) and the face profile.
- **Teddy-bear prior**: a huge round head, short muzzle, big round ears, sitting up. Check head length against body.
- **Black on black**: a pure black coat with no tan muzzle reads as a hole at a distance and hides the head; keep the
  muzzle tan and the body brown, darker on the legs.
- **Bedded sinking**: short legs, so the pose-1 squash puts the belly on the ground quickly; drop is small.
- **Tail**: the stub must stay a stub (no fox or dog tail from the generator); cut anything longer than ~15 cm.

## Sources

[adw]: https://animaldiversity.org/accounts/Ursus_americanus/
[cdfw]: https://wildlife.ca.gov/Conservation/Mammals/Black-Bear
[nps]: https://www.nps.gov/yose/learn/nature/bears.htm
[wp]: https://en.wikipedia.org/wiki/American_black_bear
- Also: `library/animals/drafts/puma_concolor.md` (the territory spawn, the tiers), Meshy API docs and
  `docs/animal-library.md` (credit costs); `client/src/animals.js`, `animalModels.js`.
