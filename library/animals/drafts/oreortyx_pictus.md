# Mountain quail (Oreortyx pictus): mesh brief

Draft by agent (Claude), 2026-10-28, for the first Yosemite tile (`utm11n_270_4180`: Half Dome, the valley floor at
1,200 m up to 3,000 m). The Sierra's own quail: the California quail keeps to the foothills below about 1,500 m, the
mountain quail lives above it in mountain chaparral, brushy forest edges and the shrub understory of mixed conifer
forest, from about 600 m to 3,000 m, and walks downslope in fall to winter below the snow (the only North American
quail that migrates, and it does it on foot). Not in any tile's species list until `pipeline/species_data.py` lists it
and the species step is re-run; the client sees it everywhere until then (`animals.js` `PENDING`), within its band.
Shy: heard far more than seen (the male's loud "quee-ark" carries far across a canyon in spring), runs rather than
flies, and bursts up on whirring wings only when pressed.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| length | 26-29 cm bill to tail, the largest North American quail; draw 0.27 m | [aab], [bow] |
| mass | 230-290 g (a California quail is 140-230 g) | [aab], [bow] |
| wingspan | about 35-40 cm; short rounded wings | [aab] |
| plumes | two long, thin, straight plumes from the crown, up to ~6-7 cm in a male, held up and back (laid flat along the nape when it runs); the female's shorter | [aab], [bow] |
| legs | grey, short; three forward toes and a small hind toe | [bow] |

What makes it a mountain quail and not a California quail (the generators' prior, and the nearest species in the
game):
- **Plumes straight**: two narrow quills that stand straight up from the crown and lean back, not the California
  quail's teardrop topknot curling forward over the bill. At the lineup's scale and in a flush against the sky this is
  the identification.
- **Throat chestnut, bordered white**: a dark chestnut throat patch outlined by a white line that runs from the base
  of the bill under the eye and down the side of the neck; the rest of the head, the nape and the breast plain
  slate blue-grey. No black face, no white forehead line, no scaled belly.
- **Flanks chestnut, barred white**: broad chestnut flanks crossed by bold white vertical bars (each edged black);
  the California quail's flanks are brown with white streaks running back.
- **Back plain olive-brown**, a pale buff line along the edge of the folded wing (the tertials' inner edges).
- **Bigger and longer-bodied**, carried more horizontally; a short tail.

Sexes nearly alike ([aab], [bow]): the female's plume is shorter and her hindneck and nape are washed brown (the
male's are clean blue-grey). Juveniles are mottled grey-brown with a stub of a plume.

Colour (approximate sRGB; to check against Sierra photos):

| region | sRGB | note |
|---|---|---|
| breast, nape, crown, sides of the head | `#5e6a79` | slate blue-grey |
| throat patch | `#76321f` | dark chestnut |
| throat border, line under the eye | `#ebe7dc` | white |
| flanks | `#7a3a22` | chestnut |
| flank bars | `#ece6d8` | white, edged `#2a2220` |
| belly centre | `#b08a64` | cinnamon-buff |
| undertail | `#3c2218` | dark chestnut |
| back, wings, tail | `#6a5a43` | olive-brown |
| wing edge line | `#c8b48e` | buff |
| plumes | `#18161a` | black |
| bill | `#1c1c1e` | |
| eye | `#3a1c14` | dark red-brown |
| legs | `#7a7672` | grey |
| female: nape and hindneck | `#6c655c` | the grey washed brown |

Seasons ([bow], [cdfw]): coveys of 5-15 (family groups, sometimes two together) from late summer to late winter; they
walk downslope from the high country in September-October, below the deep snow (from ~2,000 m down), and back up in
March-April. Pairs from March; the male calls "quee-ark" from a rock or a shrub top in spring. A ground nest under
brush or a log, 9-10 eggs, chicks from June; the brood and both parents stay together as the summer covey. Seeds,
acorns and other mast, berries, bulbs and green leaves; insects in spring and by the chicks. Drinks daily in summer at
springs and seeps, the covey walking in single file to water.

## 2. Poses and motions

The California quail's bird rig (`callipepla_californica.md`, client/src/animalModels.js RIG.quail): BODY, LEG_A/B
(procedural legs, pivot at the knee under the belly), TAIL (a short fan), HEAD (head and neck, pivot at the neck's
base, with the plumes tagged HEAD so they nod with it), WING_L/R and HAND_L/R (flight cards that collapse into the
shoulder on the ground). The client drives it with the covey machinery (animals.js `coveyUpdate`, `quUpdate`).

| motion | how | part rotation enough? |
|---|---|---|
| foraging walk, quick steps | LEG_A/B swing about x; head nod (bob) | yes |
| pecking, scratching in litter | flick dips HEAD | yes (a scratch is a clip) |
| covey run in single file across an opening or to water | legs, instance yaw, body level | yes |
| crouch before the flush | amp to 0, pose held | yes |
| flush: a whirring burst up and a glide downhill into brush | WING_L/R and HAND_L/R cards open and flap (~19 Hz), then set and bow in the glide | yes (cards) |
| plumes laid back when running | a HEAD sub-part | no: the plumes stay up (a later aAnim2 channel could lay them back) |
| male calling from a rock | stand tall (pose) | partly |

## 3. Reference images

| # | what it shows | link | author | licence |
|---|---|---|---|---|
| M1 | **image-to-3D candidate**: adult side-on on the ground, plumes up | [Commons, category](https://commons.wikimedia.org/wiki/Category:Oreortyx_pictus) | various | check per file |
| M2 | mountain quail side view, flank bars and throat | [Commons search](https://commons.wikimedia.org/w/index.php?search=Oreortyx+pictus&title=Special:MediaSearch&type=image) | various | check per file |
| M3 | iNaturalist research-grade observations near Yosemite (CC0 / CC BY ones only) | [iNat](https://www.inaturalist.org/observations?taxon_name=Oreortyx%20pictus&place_id=68542) | observers | per photo |
| M4 | the species account's photos (plumes, the female's shorter plume) | [All About Birds](https://www.allaboutbirds.org/guide/Mountain_Quail/id) | Macaulay Library | not for reuse; reference only |

Image links are search starting points; the lineup page thumbnails only CC0 and CC BY files.

## 4. Generation and existing meshes

- **A, neutral.** "A mountain quail (Oreortyx pictus) of the Sierra Nevada, California, NOT a California quail: two
  long thin STRAIGHT black plumes rising from the crown and leaning back, no forward-curling topknot. One adult bird
  standing on the ground, side-on, body level, wings folded against a plump round body, about 27 cm long. Slate
  blue-grey head, nape and breast; a chestnut throat outlined by a white line from the bill under the eye; chestnut
  flanks with bold white vertical bars; olive-brown back, wings and short tail; short black bill; short grey legs.
  Realistic proportions. No base, no rock. Game-ready, clean closed mesh."
- **B, walking, level.** (If A comes out upright like the California quail's preview, or not a quail at all.) "A
  mountain quail (Oreortyx pictus), a plump round ground bird like a small partridge, NOT a dove, NOT a songbird. One
  adult walking on the ground, side-on, body low and horizontal, a short thick neck, a very short rounded tail, short
  legs. Two long thin straight black plumes rising from the crown and leaning back over the nape. About 27 cm long.
  Slate blue-grey head, nape and breast; a chestnut throat outlined in white; chestnut flanks with bold white vertical
  bars; olive-brown back and wings; a short stout black bill. Realistic proportions. No base, no rock. Game-ready,
  clean closed mesh."

Run 2026-10-28: A came out a slender dove or thrush (long neck, blade tail, no plumes), so B was run and adopted
(`library/animals/oreortyx_pictus.json`); 40 credits.

Settings as the California quail's and the bear's: text-to-3D preview, `ai_model latest`, triangle remesh to 20,000
faces (20 credits); no refine (vertex colour from the palette). One preview of A; a second (B) only if A is clearly
wrong. The plumes are expected to come out as a wire, a spike or a lump; they are replaced by procedural ones (section
6) whatever the generator makes.

Existing meshes: none found. Poly Pizza has the California quail ("Quail", Poly by Google, CC BY 3.0) and stylised
partridges; Quaternius, Kenney and OpenGameArt have no quail of this species (2026-10-28). Recolouring the California
quail's mesh would keep its upright teardrop body and forward topknot, which is what has to change.

## 5. Tier targets

As the California quail's: coveys of 6-12 in the live set, true scale on the ground (fliers grow to 1.6x beyond 100 m
only in the air), seen from 3-40 m. lod0 ~1,000 (within 12 m), lod1 ~400 (12-40 m), lod2 ~120 (beyond), wing cards on
every tier. lod2 keeps the plump body, the plumes as one or two triangles (the identification against the sky), and the
chestnut flanks against the grey breast. Vertex colour, faint per-face noise so the grey and olive do not read as flat
plastic.

## 6. Pitfalls

Generic list in `callipepla_californica.md`. Mountain quail specific:
- **California quail prior**: a forward-curling teardrop topknot, a black face bordered white, a scaled belly. Delete
  generated plume geometry; add two procedural straight plumes (narrow blades of 2-4 triangles each, side by side on
  the crown, leaning back about 20 degrees from vertical), tagged HEAD. Assert the tips stand above and behind their
  bases.
- **Partridge or chukar prior**: a red bill and legs, a black eye-line necklace. Check the bill and legs are dark and
  grey, and that no black band crosses the throat.
- **Upright teardrop**: generators make quail tall and upright; the mountain quail is longer and carried level. Pitch
  the body nose-down if it comes out upright (the California quail's build pitched 12 degrees).
- **Flank bars as streaks**: the bars are vertical (across the body), white on chestnut; vertex colour by the body's
  long axis, not by height.
- **Throat as a black face**: chestnut, not black; the white border is a line, not a mask.

## Sources

[aab]: https://www.allaboutbirds.org/guide/Mountain_Quail/
[bow]: https://birdsoftheworld.org/bow/species/mouqua/cur/introduction (Gutiérrez and Delehanty, Mountain Quail)
[cdfw]: https://wildlife.ca.gov/Conservation/Birds/Upland-Game-Birds (mountain quail)
- Also: Grinnell and Storer, Animal Life in the Yosemite (1924), the "plumed quail" of the Transition and Canadian
  zones; Wikipedia "Mountain quail" (sizes, plumes, migration on foot; read, not copied);
  `library/animals/drafts/callipepla_californica.md` and `ursus_americanus.md` (the brief's form);
  `client/src/animals.js`, `animalModels.js`.
