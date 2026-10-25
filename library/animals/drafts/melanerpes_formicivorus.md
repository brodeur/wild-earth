# Acorn woodpecker (Melanerpes formicivorus): mesh brief

Draft by agent (Claude), 2026-10-24, for the animal mesh library. Research only: nothing was
generated or bought. In the client it is an ambient bird (`animals.js` cap 200, family groups
of 2-4 on a granary oak; `buildWoodpecker` in `animalModels.js`) and the acorn game's rival
cacher: granaries are the game's stash trees, so the player sees woodpeckers from 3-10 m.

## 1. Field marks a local would check

| mark | target | source |
|---|---|---|
| length | 19-23 cm; draw 0.21 m | [Wikipedia][wp] |
| wingspan | 35-43 cm; draw 0.40 m | [wp] |
| mass | 65-90 g | [wp] |
| tail | stiff, black, pointed central feathers used as a prop on bark | [wp] |
| bill | straight, chisel-tipped, black, about as long as the head | |

The **clown face** is the species: a black mask around the bill, lores and eye, ringed by a
white forehead band that runs down in front of the eye into a pale **yellow-cream throat**;
black chin; **red cap**; **pale cream iris** staring out of the black (adults). Below: glossy
black breast band breaking into black streaks on a white belly. In flight: **white rump** and a
round **white patch at the base of the primaries** on an all-black wing, flight a few beats then
a closed-wing dip ("undulating", the bird drops about 30 cm between bursts). Clings upright
on trunks, braced on the tail; zygodactyl feet (two toes forward, two back).

Colour (approximate sRGB; the client stores linear `COLOR_0`):
| region | sRGB | note |
|---|---|---|
| back, wings, tail, breast band | `#15161c` | glossy blue-black, sheen `#23304a` |
| forehead band, belly, rump, wing patch | `#f2f0e8` | clean white |
| throat / foreface | `#efe2a6` | pale yellow-cream, the "clown" ring |
| cap | `#c8102e` | bright red |
| iris | `#f3efd8` | adults pale; juveniles dark `#3a2a22` |
| bill, mask | `#111114` | |
| legs, feet | `#6b6f6a` | grey |

**Sexes**: the male's red cap reaches the white forehead; the **female has a black band
between the white forehead and the red** (smaller red patch). This is the one mark a local
will check; both sexes should be in the build (two colourings of one mesh; the colour can be
per-instance or two InstancedMeshes). No seasonal plumage change. **Juvenile** (summer):
duller, browner black, dark iris, and a fuller red crown in both sexes (sources differ on the
extent: [Condor 1975][condor], [10,000 Birds][tkb]).

## 2. Poses and motions the client needs

From `animals.js` (states W_CLING, W_TOP, W_FLY; `CLING_PITCH = -1.72`; pecking is `flick` at
`sin(time * 38)`, about 6 Hz; flight bursts at the ends and in a 2.2 Hz cycle):

| motion | how | part rotation enough? |
|---|---|---|
| undulating flight | bursts of 3-5 beats (phase x amp), then wings shut against the body (pose 0.8) while the bird dips | yes; with a HAND segment the closed wing tucks properly |
| clinging on a trunk | instance pitch (exists); tail rotated to brace on the bark (pose); legs forward and splayed; feet static zygodactyl | yes |
| hammering | head and neck strike about the base of the neck (flick); a small counter-rock of the body adds weight | yes; move the HEAD pivot back to the base of the neck |
| caching an acorn | carry: acorn drawn at the bill tip (acorns.js computes the head rotation on the CPU from the same aAnim); then test-fit and a burst of hammering to wedge it | yes, with the acorn as a separate instance |
| perched on top (W_TOP) | pose 1, upright, tail down | yes |
| wing-spread display (optional) | wings half open, both sides, at the granary | yes |

Rig: the **bird template** in [corvus_corax.md](corvus_corax.md) section 2 (BODY, LEG_A/B,
TAIL with spread, WING arm + HAND, HEAD; optional `aAnim2`). For this bird the shoulder sits
high on the back, the origin stays at the feet (so a pitched bird clings by them, as now), and
the head pivot is the base of the neck. Nothing here needs a skeleton unless the woodpecker
becomes playable.

## 3. Reference images

| # | what it shows | file | author | licence |
|---|---|---|---|---|
| W1 | **image-to-3D candidate**: perched upright on a branch, front three-quarter, whole bird, clean sky | [iNat 9012774](https://www.inaturalist.org/observations/9012774) | iNaturalist observer | CC0 |
| W2 | **image-to-3D candidate**: side view on a horizontal limb, whole bird, clean sky (granary oak) | [Commons](https://commons.wikimedia.org/wiki/File:Acorn_woodpecker_on_granary_tree-7270.jpg) | Frank Schulenburg | CC BY-SA 4.0 |
| W3 | female clinging, tail braced, acorn in bill (Upper Bidwell Park, Chico) | [Commons](https://commons.wikimedia.org/wiki/File:Female_acorn_woodpecker_with_nut_at_Upper_Bidwell_Park-6161.jpg) | Frank Schulenburg | CC BY-SA 4.0 |
| W4 | male clinging at a granary (El Sobrante) | [Commons](https://commons.wikimedia.org/wiki/File:Acorn_Woodpecker_(m)_in_granary_tree_(38978598750).jpg) | Becky Matsubara | CC BY 2.0 |
| W5 | male face close-up: cap meets forehead, pale iris, yellow throat | [iNat 218651301](https://www.inaturalist.org/observations/218651301) | iNaturalist observer | CC0 |
| W6 | female face: black band between forehead and cap | [iNat 248182604](https://www.inaturalist.org/observations/248182604) | iNaturalist observer | CC0 |
| W7 | male with an acorn at granary holes | [Commons](https://commons.wikimedia.org/wiki/File:Acorn_Woodpecker_.jpg) | Jamstechs | CC BY-SA 4.0 |
| W8 | clinging on a granary snag, back view (public domain) | [Commons](https://commons.wikimedia.org/wiki/File:Acorn_woodpecker_at_refuge_(53332435725).jpg) | USFWS Pacific | Public domain |
| W9 | bird at a granary hole on a snag | [iNat 70825377](https://www.inaturalist.org/observations/70825377) | Mary K. Hanson | CC BY |
| W10 | granary bark: hole size and spacing for the stash tree | [iNat 75785442](https://www.inaturalist.org/observations/75785442) | iNaturalist observer | CC0 |

Gap: no CC0 or CC BY flight photo turned up (Commons "in flight" search was empty); search
iNaturalist by hand before modelling the open wing. Many top-voted iNat acorn woodpeckers are
leucistic (white) birds; do not use those as references.

## 4. Generation

- **A, perched neutral (main tier).** "An acorn woodpecker (Melanerpes formicivorus), single
  adult male perched upright, side-on neutral pose, as if gripping a vertical trunk but no tree
  modelled. Realistic proportions, 21 cm long, compact body, short neck, straight chisel bill as
  long as the head. Clown face: black mask around bill and eye, white forehead band continuing
  down in front of the eye into a pale yellow throat, bright red crown, pale cream iris. Glossy
  blue-black back, wings and stiff pointed tail; black breast band streaking into a white belly;
  white rump. Wings folded. Zygodactyl feet, two toes forward, two back. No base, no branch.
  Game-ready, symmetric."
- **B, clinging.** "...body nearly vertical, stiff tail pressed down as a prop, feet forward and
  wide, head drawn back ready to strike. No trunk, no base."
- **C, flight spread.** "...wings fully extended straight out to the sides (T-pose for a bird),
  black wings with a round white patch at the base of the outer primaries, white rump showing,
  tail spread, legs tucked. No base. Symmetric."

Generators tend to give a generic woodpecker (crest, downy spots, red nape) or a cartoon face;
the face pattern will come out wrong and is cheaper to paint from the palette than to prompt.
Image-to-3D: W1 (CC0) as input; expect the branch fused under the feet, a front-biased guess of
the side profile (check against W2), a thick tail plate, and the face texture as a blur. Paint
the face by region from landmarks (bill base, eye, crown) rather than trusting the texture.

Existing meshes:
| mesh | licence | triangles | verdict |
|---|---|---|---|
| [Woodpecker, Poly by Google](https://poly.pizza/m/8-xKRYwdgmL) | CC BY 3.0 | 1,554 | a pileated woodpecker (crest, long neck); wrong shape, not worth recolouring |
| [Bird basemesh, noway, OpenGameArt](https://opengameart.org/content/bird-basemesh) | CC0 | ~750 | generic sparrow, "not game ready"; a possible start for a hand-built bird |
| [bird, Poly Pizza](https://poly.pizza/m/HuiupQEszx) | CC BY 3.0 | 260 | generic toy bird |
| Quaternius, Kenney | none | | no woodpecker |

None is good enough to adopt. Route: generate (A), or hand-build from the procedural model.

## 5. Tier targets

Seen at: 3-10 m when the raven deposits at a granary (stash holes are ~1 in 8 oaks and are the
woodpeckers' granaries), 10-60 m flying past, and as dots in long undulating flights 50-150 m.
At 1080p and 70 degrees FOV a 0.21 m bird is ~32 px at 5 m, ~16 px at 10 m, ~5 px at 30 m.

| tier | triangles | distance | note |
|---|---|---|---|
| lod0 | 900 | < 8 m | about a third of it in the head, so the face pattern can be face-coloured |
| lod1 | 300 | 8-30 m | red cap, white forehead, belly and wing patch still separate faces |
| lod2 | 70 | > 30 m | black body, white rump and wing-patch faces (that is what is seen in flight) |

Cap 200; with families clustered on granaries, perhaps 5-10 within 8 m at a granary. No
texture: flat vertex colour with patchLambert, as now, provided the head is dense enough for
the face. If the lod0 face still smears, a 128 px head texture is the cheapest fix.

## 6. Pitfalls and what the build script should do

- **Thick slab wings and tail**: flatten anything over ~5 mm at this scale; the tail should be a
  thin wedge that can bend to the bark.
- **Fused primaries** matter less here (no fingers), but the white primary patch must be its own
  faces on the wing's upper and lower sides.
- **Bad feet**: generated birds fuse toes to a branch. Delete below the tarsus and add
  procedural zygodactyl feet (2 forward, 2 back) angled for clinging.
- **Hollow eyes**: the pale iris is a field mark; replace sockets with a cream eye and black
  pupil, ~16 triangles.
- **Wrong face**: re-colour by landmark regions (mask, forehead band, throat, cap), two sexes.
- **Crest or red nape** from a generic-woodpecker prior: flatten the crown, re-colour the nape
  black.
- **Pivots**: landmark file (bill tip, eye, neck base, shoulders, wrists, hips, tail base);
  origin at the feet.

## Sources

[wp]: https://en.wikipedia.org/wiki/Acorn_woodpecker
[condor]: https://sora.unm.edu/sites/default/files/journals/condor/v077n03/p0342-p0344.pdf
[tkb]: https://www.10000birds.com/acorn-woodpeckers-the-clowns-of-the-avian-world.htm
- Acorn woodpecker, Wikipedia (size, granaries, flight, juvenile eye): link above
- The Condor 77(3): 342-344 (adult female crown band): link above
- 10,000 Birds, "Acorn woodpeckers: the clowns of the avian world" (juvenile crown and iris)
- Poly Pizza and OpenGameArt pages listed above (licence and triangle counts from each page)
- Client code read: `client/src/animals.js`, `client/src/animalModels.js`, `docs/game-acorn-stash.md`
