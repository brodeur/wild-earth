# California ground squirrel (Otospermophilus beecheyi): mesh brief

Draft by agent (Claude), 2026-10-26, for the animal mesh library. The commonest mammal of the
foothill savanna, pasture and roadsides: colonies of 2-20 on open ground, each squirrel with its own
burrow entrance, most of the day within 25 m of it ([WP][wp]). In GBIF for all three tiles
(`species/inventory.json`, key 8080937: 8 occurrences on the home tile 680_4280, 5 on Placerville
690_4280, 1 on the Cosumnes forks 680_4270) but **not yet in any tile's `species/species.json`**
(not in `pipeline/species_data.py` `SPECIES`), so a tile does not resolve it until the species step
adds it. Not in `animals.js` yet; the wiring lane adds it with the wild turkey and the western fence
lizard.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| head and body | 23-28 cm (9-11 in); draw 0.26 m | [UC IPM][ipm]; [WP][wp] gives about 30 cm |
| tail | 13-23 cm (5-9 in), about two thirds of head and body; draw 0.18 m | [ipm], [wp] (about 15 cm) |
| mass | 450-900 g (UC IPM 600-850 g adults; WP 280-738 g); males a little larger | [ipm], [wp] |
| ears | erect and conspicuous, but short and rounded: smaller than the western gray's | [ipm] |
| burrow mouth | about 10 cm across, often several to a colony, bare earth fans | [ipm] |

What makes it a ground squirrel and not the western gray squirrel (the tree squirrel it lives beside):
- **Stockier, thick-set body on short legs**; a broad head with a blunter muzzle.
- **Shorter, less bushy tail** (about two thirds of head and body against the gray's equal or longer),
  moderately bushy and flattened, the hairs **pale-tipped** so the outline reads as a buff-grey fringe;
  "relatively bushy for a ground squirrel" ([wp]), "less bushy than a tree squirrel's" ([ipm]).
- **Mottled coat**: grey-brown flecked with buff and dusky (the gray squirrel is clean silver grey).
- **Pale silver-grey mantle** from the shoulders down the sides of the neck, the two pale patches
  meeting behind the head in a V with a **darker brown band** between them down the middle of the back.
- **Whitish eye ring**; buff to greyish-yellow belly, not white.
- **On open ground and at a burrow**, never up a tree for safety; sits **bolt upright on its haunches**
  at the burrow mouth as a sentinel, runs low and flat with the tail out behind, bounds.

Colour (approximate sRGB; the client stores linear `COLOR_0`; photos G1-G3 sampled in shade read
darker, about `#504132` for the back, so these are lifted for daylight):

| region | sRGB | note |
|---|---|---|
| back, crown, outer thighs | `#6e5e4c` | mottled grey-brown, the base of the fleck pattern |
| buff flecks | `#a8927a` | about one face in three on the back and flanks, scattered |
| dusky flecks | `#4a3e33` | about one face in six |
| back band (between the mantle stripes) | `#54443a` | darker brown, a hand's width wide, shoulders to rump |
| mantle (shoulders, sides of the neck) | `#a9a59c` | pale silver-grey, flecked lightly |
| flanks | `#7a6c5a` | a little lighter and greyer than the back |
| belly, chin, inner legs | `#c9b896` | buff to greyish-yellow |
| eye ring | `#e2dccb` | whitish, wide |
| eye, nose | `#141210`, `#3e342c` | |
| ears | `#6a5a4a` | rims a little paler |
| feet | `#8c7c68` | |
| tail core / outer band / fringe | `#5e5044` / `#3e352e` / `#b8aa94` | pale-tipped hairs: the fringe reads buff-grey |

Sexes look alike. Hibernates in cold areas; in the foothills adults are active mid-January through
October and many stay active all winter, juveniles out from April; may aestivate for days in the
hottest weeks ([ipm], [wp]). Active by day, mainly midmorning to late afternoon on warm days.
Young (born March-May, out at about 6 weeks) are smaller with relatively bigger heads and feet.

## 2. Poses and motions the client needs

Rodent template (`docs/animal-library.md`, "Rig templates"; the western gray squirrel's):
BODY (hindquarters), CHEST (7; pivot at the lumbar), HEAD and LEG_A (fore pair) as children of the
chest, LEG_B (hind pair), TAIL (3) and TAIL_TIP (8; child of the tail).

| motion | how | part rotation enough? |
|---|---|---|
| **sentinel, sitting bolt upright** (the pose a player sees most) | CHEST rises about 70-80 degrees about the lumbar, head pitched back down to level, fore paws folded to the chest, hindquarters lowered so the rump sits (a `drop`), tail lying flat behind | yes: pose (`sit`, head pose, `foreFold`, leg squash and drop) |
| alert on all fours, head up (the base pose) | rest | yes |
| run low and flat | fore and hind pairs half a cycle apart, small chest flex, tail out straight behind | yes |
| bound | as the gray squirrel's bound with less spine flex | yes |
| feed | head down (flick), short hops between | yes |
| tail flagging (alarm, at a snake) | TAIL and TAIL_TIP waving side to side: the rig waves only in pitch; a pitch wave reads well enough at range | partly |
| dive into the burrow | translate into the mouth and cull, as the vole | yes |
| alarm chirp | sound only | |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| G1 | **sentinel**: sitting upright on a bank, pale mantle on the shoulder, three-quarter | [iNat 100216601](https://www.inaturalist.org/observations/100216601) | Anne Parsons | CC0 |
| G2 | **running low and flat**, side-on, tail straight out behind, mottling and mantle | [iNat 72979563](https://www.inaturalist.org/observations/72979563) | Dario Taraborelli | CC0 |
| G3 | on a granite rock from behind, mottled back, tail with a pale fringe (Granite Bay, near the tiles) | [iNat 602978](https://www.inaturalist.org/observations/602978) | Justin Johnsen | CC BY |
| G4 | sitting up on a fence post | [iNat 124664510](https://www.inaturalist.org/observations/124664510) | Ryan F. Mandelbaum | CC BY |
| G5 | standing, UC Davis | [iNat 224501736](https://www.inaturalist.org/observations/224501736) | Jonathan Eisen | CC BY |

Avoid as colour references: iNat 182763009 and 197496651 (leucistic), 41967 (albino).

## 4. Generation and existing meshes

Existing meshes (looked for 2026-10-26):

| mesh | licence | verdict |
|---|---|---|
| Poly Pizza "Squirrel" (Poly by Google, several), Simon Graff, Danni Bittman, Paul Hoover, Tipatat Chennavasin | CC BY 3.0 | low-poly tree squirrels under 1,400 triangles, faceted, long tails; already judged not good enough for the western gray (its brief, section 4) and not ground squirrels |
| Poly Pizza "Gopher" (Poly by Google, two) | CC BY 3.0 | a pocket gopher, wrong animal |
| Sketchfab "Spermophilus" (John_Sergeevich, 73k faces) | CC BY | a toy (To-Do Tanhoi), and a Sketchfab download needs an account (401 without one) |
| Sketchfab "Spermophilus suslicus" (Mammal Research Institute PAS) | CC BY | a skull |
| Sketchfab prairie dogs (sadcats, Dayvable) | CC BY | wrong animal; account needed |
| OpenGameArt, Quaternius, Kenney, Poly Haven | | no ground squirrel |
| the western gray squirrel's own Meshy preview (`jobs/sciurus_griseus/01a1719c-...`) | CC BY-SA (project-owned) | adaptable in principle, but a slim tree squirrel with large ears and a removed tail: making it stocky, short-legged and small-eared is more surgery than a 20-credit preview |

Route: generate. Text-to-3D preview, `latest` (20 credits), triangle remesh to 20,000:

- **A, all fours alert (rig pose).** "A California ground squirrel (Otospermophilus beecheyi), NOT a
  tree squirrel, NOT a chipmunk, NOT a prairie dog. Single adult standing on all fours, alert, head
  raised, side-on neutral pose, four legs straight under the body with clear gaps, feet flat.
  Realistic proportions: 26 cm head and body, stocky thick-set body, short sturdy legs, rounded head,
  small erect rounded ears, blunt muzzle. Tail 18 cm, two thirds of the body length, moderately bushy
  and flattened, held straight out behind and slightly raised, not curled over the back. Mottled
  grey-brown coat flecked with buff, pale silver-grey mantle over the shoulders and sides of the neck
  with a darker brown band down the middle of the back, whitish eye ring, buff belly. No base, no
  ground. Game-ready, symmetric."
- **B, sentinel** (only if A cannot be posed): "...sitting bolt upright on its haunches, back
  vertical, fore paws held together at the chest, tail lying flat on the ground behind." Pose it with
  the rig instead: a generated sitting mesh cannot run.

Outcome (2026-10-26): prompt A as written came out half sitting up with a thin rat tail (a sentinel
prairie dog); reworded to "walking on all four legs ... NOT sitting, NOT standing up, NOT a prairie dog, NOT a
marmot" (the exact prompt is in the entry and its job.json) it gave a usable all-fours squirrel, adopted.

Expected faults: a tree-squirrel prior (long plume curled over the back, slim body, big ears); a
prairie-dog prior (a stub tail, a fat pear body); chipmunk stripes; hair-strand spikes on the tail;
whiskers as strands; closed eyes. The colour goes by region in the build script, so a refine's
texture is only a reference.

## 5. Tier targets

Seen at: in grass and on bare ground within the raven's live radius, often several at a colony; the
raven passes low over pasture, lands and walks; a sentinel at 5-30 m is the common sight. At 1080p
and 70 degrees FOV a 0.26 m body is about 19 px at 10 m and 6 px at 30 m.

| tier | triangles | distance | note |
|---|---|---|---|
| lod0 | ~2,000 | < 12 m | eye ring and ears modelled; mottling as scattered face colours; tail about a fifth |
| lod1 | ~600 | 12-40 m | mantle, back band and tail fringe kept |
| lod2 | ~200 | > 40 m | brown body, pale mantle, buff belly, tail |

No texture: flat vertex colour, the mottle as per-face flecks (buff and dusky faces scattered by a
hash of the face position, so the tiers mottle alike).

## 6. Pitfalls and what the build script should do

- **Tail too bushy or curled** (tree-squirrel prior): keep it a moderately bushy flattened tail about
  two thirds of head and body, held out behind; replace it with a lofted one if it is curled or fused.
- **Ears too big**: shrink anything above the rim.
- **Brown drift into rufous, or chipmunk stripes**: ignore the texture and recolour by region.
- **Whiskers, base plate, closed eyes**: drop thin strands, cut at the ground, place a dark eye
  with a wide pale ring.
- **Sentinel**: pose it from the rig (chest up about the lumbar, head counter-pitched, fore legs
  folded, the hindquarters dropped); measure the chest pivot so the sitting back is straight.

## Sources

[wp]: https://en.wikipedia.org/wiki/California_ground_squirrel
[ipm]: https://ipm.ucanr.edu/PMG/PESTNOTES/pn7438.html
- California ground squirrel, Wikipedia (sizes, colour, colonies, tail-flagging at snakes, foraging range)
- UC IPM Pest Notes: Ground Squirrel (Publication 7438): sizes, ears, tail, burrows, seasonal activity
- iNaturalist observations listed in section 3 (licences from the observation pages)
- Poly Pizza and Sketchfab search pages (licence and face counts from each page and the Sketchfab API)
- Client code read: `client/src/animalModels.js` (RIG, the rodent shader path), `tools/build_squirrel.py`
