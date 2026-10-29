# Animal library

Plants are grown from parameter files ([species-library.md](species-library.md)). Animals are
curated meshes, one per species (decision log, 2026-10-25), recorded in `library/animals/`
([README](../library/animals/README.md) has the entry schema and what the client expects from a
GLB). This page is the pipeline around the library and what the first generated model showed.

## Pipeline

1. **Resolve.** A tile's `species/species.json` (from GBIF occurrences) lists its animals by
   `code`. Each code resolves against `library/animals/<code>.json` (or an entry's `aliases`).
   Found and adopted: the client draws it. Missing, or only `candidates`: the gap is flagged in the
   tile build report and in the viewer, and the client falls back to the procedural low-poly body
   (`animalModels.js`) for that species' body plan.
2. **Fill a gap.** A maintainer looks for a CC0 or CC BY mesh first. If there is none, they
   generate one with `tools/meshy_generate.py` using their own key. Generation is a maintainer
   tool: it is never part of a tile build, it costs money, and its output is reviewed before
   anything ships. A crowdfunded region would pay for exactly this step.
3. **Adopt.** A build script per species (`tools/build_deer.py` is the model) scales the mesh to
   the entry's `size`, recolours it to the local animal, decimates to the tiers, and writes the
   rig template's per-vertex `_PART`, `_PARTW` and `_PIVOT` for the body plan, so the animal is
   posed by the same shader as every other (one draw call per species, motion from four floats).
4. **Sign off.** An animal lineup page (to build, like `client/lineup.html` for plants): every
   adopted species at true scale against 1 m poles, each tier, idle, walk and the body plan's
   poses, with the triangle counts. A local naturalist checks it against the animals they know and
   signs the entry off.

Rig templates by body plan: quadruped (legs A/B, tail, head), bird (adds wings L/R), rodent
(bounding pairs, tail curl), snake (to design). Meshy's auto-rigging is humanoid only (its rigging
docs: biped characters with clear limbs; animals return 422), so it does not replace the templates.
The tool wires it (`rig`) but refuses non-humanoid body plans unless forced.

## The tool

`tools/meshy_generate.py` (standard library only):

- `balance`: credits left (free).
- `pricing`: the credit cost per job, with the doc URL and the date it was read.
- `generate --species <id> --mode preview|refine|image`: `--prompt` for a preview, `--preview-job`
  (and `--texture-prompt` or `--texture-image`) for a refine, `--image` (file or URL) for
  image-to-3D, plus `--ai-model`, topology and polycount options. It prints the estimated cost,
  checks the balance, asks before spending (or `--yes`), submits, polls with backoff, downloads the
  GLB, textures and thumbnail into `library/animals/jobs/<species>/<job_id>/`, and writes
  `job.json`: mode, prompt, settings, task id, timestamps, credits charged (`consumed_credits`),
  balance before and after, each file's sha256, and a licence note. `--dry-run` prints the request
  with the key redacted and sends nothing.
- `status --job <dir> [--wait]`: resume an interrupted job and download it.
- `rig --job <dir>`: Meshy auto-rigging, wired but refused for animals (see above).

The key comes from `MESHY_API_KEY` in the environment or the git-ignored `.env` (see
`.env.example`); it is never printed or written. Requests are paced (20 per second is the plan
limit; the tool sends at most 4) and a 429 waits for `Retry-After`. Meshy deletes API output three
days after generation (Terms of Use 2.5), so the tool downloads as soon as a job succeeds.

## Cost (read 2026-10-24 from <https://docs.meshy.ai/en/api/pricing>)

| job | credits |
|---|---|
| text-to-3D preview, mesh only | 5 (`meshy-6-lite`, `meshy-t2`, `meshy-t2.5`), 20 (`meshy-6`, `latest` = `meshy-7.1`) |
| text-to-3D refine (texturing a preview) | 10 at 2K or 4K, 15 at 8K, on top of the preview |
| image-to-3D, mesh only | 5 or 20 as above |
| image-to-3D, textured | 15 (lite and t2 models, 2K) to 30 (`meshy-6`, `latest`, 2K or 4K), 35 at 8K |
| auto-rigging | 5 (humanoids only) |
| animation | 3 per action |

A textured species from text is a preview plus a refine: 15 to 30 credits. Failed tasks are
refunded. The API needs a paid plan.

## Licence

Meshy Terms of Use (<https://www.meshy.ai/terms-of-use>, last updated 2026-09-19):

- **3.2:** customers on a paid plan own their Customer Output, to the extent the law allows;
  free-plan output is owned by Meshy and offered under CC BY 4.0 with credit to Meshy. The API
  refuses free plans (402), so every API-generated model is paid-plan output owned by the account
  holder, who may release it under the project's CC BY-SA 4.0 asset licence. Meshy's help article
  on commercial use agrees (paid plans: private ownership, no attribution required;
  <https://intercom.help/meshy/en/articles/16102098-can-i-use-meshy-assets-commercially>).
- **2.4:** do not remove or alter AI-identifying metadata or watermarks Meshy embeds. The first
  GLB carried none (generator string only, no copyright or extras), but build scripts must carry
  over any that appear.
- **2.5:** non-Enterprise API output is deleted three days after generation.
- **2.6(xi):** generated assets may not be used to train AI models that compete with Meshy. This
  binds the account holder, not CC BY-SA licensees downstream, but note it in the entry.
- Caveat: AI-generated output may carry little or no copyright in some jurisdictions (the US
  Copyright Office position), so the CC BY-SA licence covers what rights exist; the credit
  "generated with Meshy" goes in the entry, the build script header and the GLB's
  `asset.copyright` regardless.

Redistribution in the open library is therefore allowed for API (paid) output. A model made on a
free web-app account is CC BY 4.0 owned by Meshy: also redistributable, with credit to Meshy, but
not relicensable as CC BY-SA. Meshy Community models are CC0 (3.3).

## First job: a standing common raven (2026-10-25 UTC)

One text-to-3D preview, `meshy-6-lite`, triangle remesh to 20,000 faces, 5 credits (balance 3,052
before, 3,047 after), 34 s of processing. Prompt and settings are in
`library/animals/jobs/corvus_corax/01a1718c-6181-76da-923a-ce2ae3f4293e/job.json`.

- **Silhouette:** reads as a raven from the side at once: a heavy, arched bill with a culmen
  ridge, shaggy throat hackles, a defined crown and eye, layered coverts and long primaries, a long
  tail. Better species likeness than the current flying model, which has a generic bill.
- **Wings:** folded, but they stand off the flanks at the shoulders, so the bird looks puffed or
  mantling: about 0.32 m wide at true scale against about 0.2 m for a sleek raven. A folded-wing
  mesh also cannot open into flight under the part rig, so it is a ground and perch model only.
- **Feet:** good: scaled tarsi, three forward toes and a hind toe with claws, flat on the ground.
- **Bill:** the best part. Nasal bristles are only hinted by feather shards at the base.
- **Tail:** long and tapered in plan; the wedge (graduated outer feathers) is weak.
- **Posture:** a forward hunch rather than an upright stance; plausible for a foraging raven.
- **Topology:** remesher triangle soup with sculpted feather shards, 20,627 triangles, 3% slivers,
  14 pieces once UV seams are welded, 20 open edges. UV-unwrapped, but no material or texture
  (a preview is mesh only). Normalised to 1.9 units long, +y up, bill toward +z, which matches
  the client's axes. It will decimate to 2,000 / 1,000 / 300 triangles without trouble; the
  feather shards will go.
- **Texture:** none. A raven is black with a blue-purple gloss, which the client can draw from
  vertex colour and the shader; a 10-credit refine would bake a 2K colour map with lighting
  partly baked in, which the deer pipeline would discard anyway.

Judgement: a good start for a ground raven. A refine is not worth paying for this species. If
more is spent, it should be one more `meshy-6-lite` preview (5 credits) with the wings pressed flat
to the flanks, or one `latest` preview (20 credits) to compare the full model, and a separate
spread-wing glide preview if a mesh flying raven is wanted.

## Rig templates

The drawn animals are posed by the procedural part rig in `client/src/animalModels.js`: no skeleton, each vertex
carries a part (`_PART`), that part's weight (`_PARTW`) and its pivot (`_PIVOT`), and the vertex shader turns
parts about their pivots from one per-instance vec4 (phase, gait, pose, flick). Parts 0-6 (body, legs A/B, tail,
wings L/R, head) are the original scheme the deer and every procedural model use, unchanged. Two templates extend
it (adopted 2026-10-25 for the scrub-jay, quail and squirrel):

- **Bird:** body, legs A/B (procedural legs added by the build script), tail, head (with the neck; pivot at the
  neck's base, nodding with each step on the quail), wing L/R (the arm, pivot at the shoulder) and HAND_L/R (9,
  10; pivot at the wrist). The generated mesh's folded wings stay body geometry. Flight uses wing cards (arm and
  hand per side, top and underside colours) that collapse into the shoulder as pose goes to 1, so they cost
  nothing visible on the ground and open for the flush or the jay's short flight. The hand lags the arm through
  the stroke.
- **Rodent:** body (hindquarters), CHEST (7; pivot at the lumbar: flexes with the bound, rises to sit up),
  head and fore legs (children of the chest), hind legs, tail and TAIL_TIP (8; child of the tail: a lagged wave
  and an extra curl on pose).

The parent chain is one level: a child's own rotation first, then its parent's about the parent's pivot (read
from the GLB's `extras.rig`). A second per-instance vec4, `aAnim2`, carries what the four floats cannot: wing bow
in a glide and tail spread for birds, leg splay (climbing) and the lagged tail-tip flick for the rodent, and a
colour variant (the female quail's second colour set, `_COLORB`). Per-species constants (sit-up angle, spine
flex, hand lag, collapse and so on) are in `RIG` in `animalModels.js`; a rebuild that moves a joint needs no
client change. Each drawn species falls back to its procedural model while loading or on error, and
`?<name>=proc` (`deer`, `squirrel`, `quail`, `jay`, `stjay`, `hawk`, `vulture`, `fox`, `coyote`, `rabbit`, `jackrabbit`, `vole`,
`lion` or `cougar`, `buck`; `animals` for all) draws the procedural one for A/B.

- **Quadruped:** the deer's parts (body, legs A/B as diagonal pairs, tail, head), on the plain path (doe, buck,
  gray fox, coyote, black bear: a Meshy mesh adopted by tools/build_bear.py, 2026-10-28) or the rig path when the tail has a TAIL_TIP (mountain lion). `aAnim2.w` is a gait selector:
  0 diagonal pairs (walk, trot), 1 fore pair against hind pair (gallop), read from the sign of each leg pivot's z.
  Every model carries `drop` (how far the body lowers at pose 1 so the folded legs meet the ground) and the lion
  `poseMax` 0.6 (past it the elbows sink).

### Soarers and the Steller's jay (2026-10-25)

- **Red-tailed hawk, turkey vulture** (`tools/build_redtail.py`, `build_vulture.py`): flight meshes on the bird
  template with the wings spread for good (`collapse` 0). The generated body, head and tail are kept and fixed
  (feet off, nose-up pitch levelled, the vulture's head shrunk and tail stretched); the generated wings are cut at
  the body and lofted from their traced plan outline, so dihedral (5 and 17 degrees), chord, hand shape and finger
  count (five and six) are set by the script and the underwing pattern is rows of faces at every tier. The client's
  existing soaring, banking, teetering, flapping and stoop drive them (arm at the shoulder, hand lagging at the
  wrist; the hawk's hands droop and tail closes in a stoop through `aAnim2`). Tiers 2,500 / 900 / 250 at 40 and
  150 m (hawk), 50 and 180 m (vulture); lod2 wings are 2.5x thicker so they never thin out edge-on.
  `?hawk=proc`, `?vulture=proc`.
- **Steller's jay** (`tools/build_stellersjay.py`): the scrub-jay's template and constants; one tail replaces the
  generated doubled one, crest blades replace the crest block. It is a new species in `animals.js` (it was sound
  only): the scrub-jay state machine anchored on pines from the vegetation's near set (`veg.nearPlants`; `veg.oaks`
  holds only oaks), conifer and mixed forest, groups of 2-4, cap 60; perched birds hop up their tree branch by
  branch and the group moves on to the next pine. Perches sit in the crown envelope, not on modelled branches.
  `?stjay=proc`.
- **Light through the feathers** (`animalModels.js` `UNDERWING`, 2026-10-25): flying birds get a transmission term in
  the shared animal material, so a wing or tail seen with the sun beyond it is lit through by its own vertex colour:
  the red-tail's pale lining glows with the wrist commas and dark edges standing out, the vulture's silver flight
  feathers read against the black lining. Thinness comes from the rig's parts (hand most, arm ramping to the trailing
  edge, tail 0.7, body 0.08) and the colour's brightness (dark feathers pass almost nothing: the raven stays black).
  Cloud shadow applies, the cascaded map does not (the wing would shadow its own underside); fades out at 300-420 m.
  Not on the ground raven or the mammals (they compile without it); gated off by pose for perched and ground birds;
  `underwingLight.value` scales it live. From below at 30-250 m the hawk's mean went from ~(63, 54, 43) to
  ~(140, 131, 116) and the vulture's from ~(42, 40, 36) to ~(81, 78, 73); views from above, the raven, a deer and a
  perched jay are unchanged. The lineup page's three.js shadow map does shadow the term (the game's does not).

### Mammals in the client (2026-10-25)

Wired in `animals.js` / `animalModels.js` from the mammal build lane's GLBs. Per species: cap, tier switches,
habitat, hours, groups, motions.

- **Gray fox** (`loadFoxMesh`, plain path, amp `[0.5, 0.35, 1.0, 0]`, pose `[0.3, -0.25, 0.2, 0]`, drop 0.17 m):
  cap 16, tiers at 18 / 56 m; woodland and chaparral edges; about before 9:00 and after 16:30, bedded at an oak's
  foot by day; alone. Walks, trots, stands alert, sniffs and mouse-pounces; trots off from a low player inside
  32 m, or (one time in three) runs up a leaning oak to the fork and lies on a limb.
- **Coyote** (`loadCoyoteMesh`, amp `[0.45, 0.3, 1.1, 0]`, pose `[0.3, -0.35, 0.2, 0]`, drop 0.26 m): cap 8,
  22 / 68 m; grassland and open savanna; dawn and dusk (and night), bedded by day; alone or a pair (the mate keeps
  a slot behind). Long trots, pounces; flees at 40 m (a gallop when close), stops 60-110 m off and looks back.
- **Brush rabbit** (`loadRabbitMesh`, template R with a chest, no tail tip; `RIG.rabbit`): cap 80, 6 / 20 m, drawn
  and thought only within 120 m of the eye, spawned within 220 m; brush edges (brush beside grass); 1-3 around a
  patch of cover. Dawn and dusk: hops out to feed within 7 m of cover, nibbles, sits up; by day still in its form.
  A low player inside 22 m: it freezes, then hops quietly back to cover; inside 9 m (or 15 m when the freeze
  ends) it bolts for cover in a zig-zag bound, tail up. Rebuilt 2026-10-25 with the ear fix: `build_rabbit.py`
  shrank the right ear about the left ear's base (symmetrize copies the left half's group names onto the right),
  so it sat 1 cm nearer the midline; each ear is now picked by side (x sign), and lod2 keeps each ear's top 4 mm
  so the now-symmetric collapse does not take the ears down to stubs (898 / 300 / 58 triangles).
- **Black-tailed jackrabbit** (`loadJackrabbitMesh`, template R with a chest, no tail tip; `RIG.jackrabbit`: the
  rabbit's with amp `[0.95, 0.4, 0.85, 0]` (longer reach, a deep head dip) and spine 0.26): cap 40, 12 / 40 m,
  drawn and thought only within 250 m of the eye, spawned within 300 m; open grassland, savanna and pasture, sparse
  chaparral (`SUIT` times openness); one or two per cell, each its own form (beside a shrub of the near set, else
  in the grass). By day hunched in the form (pose -0.6: chest down, forelegs forward, head tilted back; the ears
  stay up, no ears part); about before 8:00 and after 17:30 (and 8% of them by day): lopes 10-40 m out at 3-5.5
  m/s, feeds in 0.3-0.6 m hops with the head down 1-3.5 s at a time, sits up, lopes on to another patch within
  45 m of the form. A low player (under 25 m above it) inside 30 m: it freezes, ears up, 1-4 s (in the form 4-10 s,
  flushing only inside 7 m), then bolts if still inside 30 m (at once inside 10 m): ~14 m/s, bounds of ~4-5 m
  (6 m on an occasional high bound), 15-30 degrees to one side of the line away from the player and then the
  other (a 30-60 degree turn every 2-4 bounds), 60-150 m, then a lope and a sit, looking back. Constants in
  `animals.js` `JACK`. Until a tile's species step has run with the jackrabbit in `species_data.py` it is seen by
  every observer (`PENDING`). Sound: a thump (the rabbit's synth, a little louder) now and then on a freeze or bolt.
- **California vole** (`loadVoleMesh`, template R, no tail part; `RIG.vole`): cap 150, 3 / 10 m, drawn and thought
  only within 40 m of a camera under 10 m above the ground, spawned within 140 m; grass; any hour; one or two per
  2-5 m runway. Scurries, clips grass, sits up to eat; a player within 4 m sends it down the runway into a burrow.
- **Mountain lion** (`loadCougarMesh`, rig path for TAIL_TIP 8; `RIG.lion`, amp `[0.35, 0.3, 0.6, 0]`, pose
  `[0.35, 0.6, 0.3, 0]`, poseMax 0.6, drop 0.19 m): cap 3, 40 / 124 m. One territory per 1.5 km cell (p 0.4) whose
  home is oak, mixed, chaparral or riparian; only the nearest within 550 m lives, so at most one group: a lone adult
  or a mother with one or two young at 0.6 scale. About before 8:30 and after 17:00, crouched under an oak by day.
  Stalks (slow, low, head down, tail tip twitching) with crouched waits; slinks off low from a player inside 50 m.
  The brief's tail pose (-0.2) became +0.6: the tail's J reaches the ground, and a lowered tail sank into it.
- **Buck** (`loadDeerBuckMesh`, the doe's constants, drop 0.515 m): its own slot (BK, cap 40, 30 / 90 m, planar
  shadow), about one in three of a herd's followers. Antlers per instance (`ANIM_ANTLER`, `aAnim2` = growth,
  velvet, young): each buck casts between 1 January and 1 March, regrows in velvet from late April (full by July),
  sheds the velvet in late August or early September; so hard in fall and early winter, cast in late winter and
  spring, velvet in summer. The date is today's when the season is the real one, else the season's midpoint.
  Cast: every antler vertex but the burr ring folds into the burr (mirrored in x); velvet: pushed out along the
  normal (most at the base) and greyed; a young forked-horn (35%) folds the rear second fork (`_TINE` 1) into its
  base. Procedural fallback: `buildDeerBuck` (buildDeer 5% larger with cone antlers).
- **Deer bedded drop:** the drawn deer drop 0.49 m (doe) and 0.515 m (buck), scaled with the instance, in
  `drUpdate`, the planar shadow (which now scales the drop by the instance) and the lineup; the procedural deer
  keeps 0.6 m.
- **Ground:** animals now stand on the rendered terrain (the 10 m triangle mesh, rocks.js `meshH`), not on the
  finer bilinear height field, which in a hollow lies up to ~0.6 m under the mesh and buried bedded deer.
- Procedural fallbacks for all five (`buildFox`, `buildCoyote`, `buildCougar`: one box-and-ball quadruped
  builder; `buildRabbit`, `buildVole`). Planar sun shadows for fox, coyote, lion and buck as for the doe.
- Sound: a coyote yip-and-howl caller in `sound.js` (dawn, dusk and night over grass; on a real coyote within
  300 m when there is one).
- Cost (2026-10-25, the start view, 281 animals): `animals.update` 0.11-0.16 ms a frame, the mammals' updates
  0.016 ms of it; frame time with the six new species shown or hidden within noise at the start view and beside a
  herd. Debugging: `__we.animals.summon('fox' | 'coyote' | 'rabbit' | 'jackrabbit' | 'vole' | 'lion' | 'buck', d)` puts a group
  d m ahead of the camera until `clearSummoned()`; `antlerMonth` pins the antler date.

## Lineup page

`client/lineup_animals.html` (`client/src/lineupAnimals.js`) is the sign-off page, the animals' counterpart of
`client/lineup.html`. One row per species in `index.json` plus every species with a drawn mesh (the buck has its
own row): the drawn GLB on the left and the procedural model on the right, at true size beside a 1 m pole and
ground bar in 10 cm bands, under the game's atmosphere (sun, sky light, exposure; cloud shadow off) for any
season and hour. The camera stands a fixed 5.5 m off so sizes compare between rows; "zoom to fit" frames each row
instead, "three-quarter" and "from above" turn it, and dragging a view turns that row. Switches: tier (lod0-2),
pose or motion (idle, walk / bound / hop, run (gallop, bolt, dash), graze / tail flick / peck, bedded / sit up /
perched, flap, glide, climb), each model with its own bedded drop and pose limit, the buck's antlers for the
season (the second-colour box draws a young forked-horn), written to the same `aAnim` / `aAnim2` attributes `animals.js` writes; a motion the body plan lacks
shows idle and says so. GLBs load as their rows scroll into view (`?all=1` loads every one); a missing or broken
file leaves the procedural model and a note. A GLB without a loader in `animalModels.js` is read the same way
with generic rig constants (marked on the row); a new `load<Name>Mesh` export or a GLB whose `extras.species`
names a species joins its row.

Metrics, from the rest geometry: triangles per tier, GLB size, length (with the tail), head and body (nose to
the TAIL pivot), shoulder (top of the body over the fore legs' pivot) or wingspan, top, and the area-weighted
mean colour of the up-facing body faces (buried faces of the procedural primitives skipped) against the brief's
back or coat colour for the season (ΔE76). The brief's numbers are the entry's `size` (head and body or total
length, by its note), then the draft's "draw" values. Red marks a difference over 10% (ΔE over 10). Two
reference photos per species from the draft's section 3 (image-to-3D picks first), thumbnailed only when CC0 or
CC BY and served cross-origin (Wikimedia Commons and iNaturalist APIs), else a link. A local picks a verdict and
writes notes; both stay in that browser's localStorage, and "copy JSON" gives `{species, verdict, notes}` for an
issue. Scripting: `__animalLineup.metrics()`, `.table()`, `.loadAll()`, `.set({tier, motion, season, hour,
view, fit})`. URL: `?only=<id,...>&tier=&motion=&season=&hour=&view=&fit=1&slow=1&all=1`.

Known measurement limits: the vole's tail is part of BODY, so its head and body reads as the whole length; the
rabbit crouches, so its straight-line length is shorter than the spine the build script scaled; the squirrel's
curled tail shortens its total length the same way.

## Ground raven wired (2026-10-25)

`raven_ground.glb` is drawn by `animalModels.js` `loadRavenGroundMesh` on the bird template with a ground variant
(RIG_GROUND): aAnim2 = (wing flick, head yaw, hop). The folded wings never collapse; a flick lifts and opens WING at
the shoulder with HAND following at the wrist; hop swings both legs together (0 alternates them: a walk). lod0 is
drawn with its texture and smooth file normals (turned with the parts), vertex colours off; lod1 and lod2 with
vertex colours. Ambient ravens (`animals.js`, DRAWN[RV] hybrid) use it on the ground and perched (standing,
walking, hopping, pecking, caching beside a shrub within 6 m on foot), tiers at 15 / 50 m, and the procedural
flying raven in the air; the swap is at touchdown and take-off with position and heading kept and the flying model
lifted 0.12 m so the bodies line up. The player (`raven.js`) lands with hover then Z (`flight.js` `landed`) and
stands on the ground model, head following the look and the body catching up in hops (since: walking, below).
`?ravenground=proc` for A/B. Still a shape change at the swap itself (spread or folded procedural wings against the
mesh's folded ones), softened by the wings settling after touchdown and lifting before take-off.

## The player raven on foot: landing by contact, hopping, the swaps hidden (2026-10-25)

**Landing is by contact** (`flight.js` `contacts`, swept every 0.15 m of each frame's move so a long frame or a dive
cannot pass through): the body within 0.35 m of the ground (drawn terrain or a close rock top, the squirrel
controller's footing) or the bark of a limb within 0.3 m, at under 7 m/s airspeed, and the raven takes hold. On the
ground it keeps its heading; on a branch it turns along the limb (toward the tip or the trunk, whichever is nearer
its heading) with its feet on the bark's top. Over 0.25 s it slides from where it touched to the perch while the
wings fold, then the models swap (below); the camera dips slightly. Faster than 7 m/s, or into wood it cannot stand
on (a trunk, a limb steeper than ~44 degrees), it bounces: heading mirrored about the contact normal, 85% of the
speed kept, a flap (the flare); grazing the ground it skims (the old 2 m flight floor is gone). Deep water is
skimmed, not landed on. Hover then Z down still works and is the gentle way in. After a take-off contacts are
ignored for 0.6 s, and the plant just left for 1 s. A HUD row ("landed") says "perched on a blue oak, 4 m up" or
"on the ground".

**Branches** (`perch.js` `Perches`): the plants of the vegetation's near set, read from the near instances themselves
(species, the variant's seed, the instance matrix), so the wood is exactly the drawn wood: `treegen.treeWood`
exports the stems the near tier tubes for that (species, seed) from the cached skeleton (nothing regrown). A plant's
world-space stems (points, radii, arc lengths, a box each) are built the first time a query comes near it (about
0.2 ms for an oak) and kept while it stays in the near set. Plants sit on a 10 m grid by their crown reach; a query
reads one cell and tests only stems whose box holds the point: about 4 segments and 0.012 ms per query, 0.02 ms per
flight frame. Perchable: wood at least 1.5 cm thick, sloping less than ~44 degrees, its top 0.8 m or more above the
ground, and clear (0.1 m) of the parent limb at its base. Thinner wood (the close tier's twigs, the near tier's
outer twigs) is passed through.

**On foot** (`updateGround`, state in `flight.gnd`, drawn by `raven.js`): no walking gait; ravens on the ground
mostly hop. **W / S** hop forward 0.6 m and back 0.4 m on both feet (held: hop after hop); on the ground each hop
goes as far as the footing lets it (rises up to 0.45 m, the arc raised over what it crosses, no deep water); on a
branch it moves along the limb the way the body faces along it and stops where the limb stops being perchable (the
thin end, a steep bend, the parent limb), the body keeping to the limb as it bends; facing across the limb, a hop on
the spot. **A / D** held hop round 45 degrees at a time; tapped (under 0.14 s), a step round of about 17 degrees.
**Arrows, a drag, or Shift with W A S D** look about (the head follows; on the ground the body hops round when the look
runs more than ~57 degrees ahead). **Space** takes off: from the ground forward and up to 2 m, from a branch a drop
(nose down, falling at first) into a glide; **X** straight up into a hover; either way the folded wings lift and
open for 0.2 s first. **E** pecks up an acorn within 0.8 m of the bill on the ground, or from a branch a crown
acorn within 1.2 m (`acorns.js` `acornNear` / `playerPick`; the raven's automatic 6 m pickup often gets there
first). Chase camera on the ground 0.8 m up and 2.5 m back, about 23 degrees off the tail; perched 0.55 m up and
1.7 m back, pulled in short of any limb between it and the bird.

**Swaps**: on touchdown the flying model's wings fold over 0.25 s (bones swept back, lowered and scaled toward the
folded wing's length, the body tilted 0.3 rad nose up with the head kept level), then a 0.12 s alpha-hash dissolve
to the ground model (incoming fully in over the first half, outgoing out over the second); on take-off the ground
model's wings lift and open over 0.2 s, then the flying model dissolves in from half folded at the top of a
wingbeat and unfolds over 0.3 s. The touchdown slide and the turn onto the limb are continuous (largest per-frame
step 4 cm). Known: the dissolve's dither shows for 6-7 frames; a turn onto a limb at right angles to the approach
is a quick swivel (0.25 s); perched, the camera often sits in the crown's foliage; bouncing off a low limb just
after a take-off under a crown is common; the ambient ravens still perch on treetops their own way (`animals.js`
does not use `perch.js` yet).

## Next (adoption lane)

1. `tools/build_raven_ground.py` on the deer model: scale to 0.62 m bill to tail, weld, decimate to
   three tiers, colour (black, a slightly browner worn wing, black bill and legs), assign the bird
   template's parts (head and neck, legs A/B, tail; folded wings as body or as a small "tuck" part)
   and pivots, and carry over any Meshy identifiers.
2. Done (see "Ground raven wired"): the ground and perched raven (acorn game, ambient, the landed player) uses
   the new mesh, with a swap on landing and take-off.
3. The animal lineup page and the GBIF gap report in the tile build.

## Western fence lizard and the reptile template (proposal, 2026-10-26)

`client/assets/fence_lizard.glb` (`tools/build_fence_lizard.py`; brief `library/animals/drafts/sceloporus_occidentalis.md`;
entry `library/animals/sceloporus_occidentalis.json`): one Meshy `latest` preview (20 credits) and a refine kept as a
colour reference (10); no CC0 or CC BY lizard was usable. 0.18 m (snout to vent 0.07 m, tail 0.11 m), back 2.6 cm,
belly 8 mm up; lod0 1,200, lod1 400, lod2 120 triangles. Not wired: no `load…Mesh`, no `RIG` entry, not in `index.json`
or any tile's `species.json` (the GBIF step has no reptiles). The wiring lane adds the template below.

**Parts** (`_PART`, `_PARTW`, `_PIVOT`, as the other templates): BODY 0 (the root), LEG_A 1 (left fore, right hind) and
LEG_B 2 (right fore, left hind), splayed out, pivots at the shoulder and hip rings where the limb leaves the trunk;
HEAD 6, pivot at the neck; TAIL 3 (inner half, pivot at the vent) and TAIL_TIP 8 (outer half, pivot mid-tail, a child
of TAIL: one-level chain as the lion's). No CHEST. A per-vertex `_BLUE` (1 the male's belly and throat patches, 0.5 the
patch's black edge, 0 elsewhere). `extras.rig` (`kind: 'reptile'`): `head`, `tail`, `tail_tip`, `fore` and `hind` (the
left pivots, as the rodent's), `legs` {FL, FR, HL, HR}, `snout_z`, `vent_z`, `tail_end_z` (the spine's ends, for the
wave), `belly_y`, `back_y`, `drop` (0.007 m), `blue_off` and `throat_off` (linear colours the patches fade to).

**aAnim** (phase, gait, pose, flick):
- **phase**: the stride. Legs in diagonal pairs (A against B, half a cycle apart), a sprawling swing: each leg turns
  about the vertical through its pivot (protraction and retraction, hind legs ~1.3x the fore) and lifts about the
  body's long axis on the forward half (max(0, cos)) so the foot clears. And the **lateral undulation**: every vertex is
  bent sideways by a travelling wave along the spine, s = (snout_z - z) / (snout_z - tail_end_z), x += A · gait ·
  env(s) · sin(phase - k·s) with env ~0.25 at the shoulders rising to 1 at the tail tip, and the tangent's yaw applied
  to the parts so legs and head ride the curve (the head counter-turns a little to stay on line). Bend after the part
  rotations; no extra attribute (z is the spine coordinate, the rest pose is straight).
- **gait**: 0 still to 1 sprint: scales the swing and the wave. A burst is 0.5-3 m to cover at ~2 m/s; the phase rate
  from distance over a ~0.1 m stride, capped near 12 Hz on screen (the wave carries the read past that).
- **pose**: -1 basking flat, 0 alert (the mesh), +1 the top of a push-up.
  - pose < 0 (bask): BODY down by `drop`·|pose| (belly onto the rock), BODY spread in x (1 + 0.15|pose|) and squashed in
    y toward the belly, legs abducted further (~0.5 rad about the long axis) with the feet kept in place, head down onto
    the rock (~0.25 rad), tail flat.
  - pose > 0 (push-up): the fore body pitches up about the hip axis (the line through HL and HR, ~0.35 rad at 1), the
    fore legs extend to keep the fore feet planted, the head lifts a further ~0.2 rad, and the trunk is compressed in x
    (1 - 0.25·pose) with `_BLUE` vertices pushed down and out, so the blue sides face the viewer; the patches brighten by
    pose · `_BLUE`. The client bobs pose (a bout of 3-8 push-ups, ~2 per second, with head bobs).
- **flick**: a head turn or jerk about the neck (signed yaw, ±0.5 rad).

**aAnim2**: x a static lateral C-bend (signed: steering in a turn, curling round a trunk), y the tail tip's lag and
whip (TAIL_TIP behind the tail's wave plus a flick, as the rodent's `tipLag`), z blue flash (0-1, the patches' colour
alone, for a lateral display without the push-up), w the colour variant (1 male vivid; 0 female: `_BLUE` mixed to
`blue_off` / `throat_off`). Starting constants for a `RIG.lizard`: amp `[0.6, 0.35, 0.4, 0]`, pose `[1, 0, 0, 0]`,
k { wave 0.006 m at the tail tip, waveK 1.6π, pushPitch 0.35, baskAbduct 0.5, squash 0.25, tipLag 0.6 }, drop from the
file; all estimates to tune on the lineup.

**Placement and behaviour** (for `animals.js`): rock outcrops and boulder tops (rocks.js), oak and pine trunks (the
instance on the bark, belly to the trunk, head up or down: the instance needs a full orientation, not yaw only), fence
lines, posts, woodpiles, walls and road edges of the human footprint, and sunny open slopes in grassland, oak savanna and
chaparral; not in deep shade. One male per rock or post with 1-3 females near; cap ~120, LOD switches at 2 and 8 m,
cull past ~25 m from a low camera. Active March-October, by day: out once the sun has warmed the rock, all day in spring
and fall, morning and late afternoon in summer heat (shade at midday); hiding under ~15 C air (cool mornings, cloud,
winter; a few on warm winter days). States: bask (pose -0.6 to -1), alert (pose 0, head flicks), push-up bouts (males,
spring most), sprint to cover from a low player, raven or hawk inside ~2-4 m (a crack, under the rock, or round the
trunk to its far side), hide (culled in the crack), re-emerge after 10-60 s.

## California ground squirrel (2026-10-26)

`client/assets/ground_squirrel.glb` (`tools/build_ground_squirrel.py`; entry `library/animals/otospermophilus_beecheyi.json`,
brief `drafts/otospermophilus_beecheyi.md`). No CC0 or CC BY ground squirrel mesh was usable (Poly Pizza's CC BY 3.0
squirrels are faceted tree squirrels; Sketchfab's CC BY *Spermophilus* models are a toy and a skull and need an account),
so it was generated: two `latest` previews (20 credits each; the first came out half sitting up with a rat tail) and a
refine of the second (10 credits, kept as a colour reference only: its legs and eye ring drifted orange). 50 credits.
The build drops whiskers and fur shards, lofts a new tail (0.18 m, held out behind, 1.7:1, mottled core, darker band,
pale fringe) in place of the strand fan, raises the head 8 degrees, opens the eyes in a wide whitish ring, scales head
and body to 0.26 m, and colours by region with hashed buff and dusky flecks: the pale mantle on the shoulders and neck
in a V either side of a darker band down the back, buff belly. Tiers 2,000 / 600 / 200 triangles; rodent template
(BODY, CHEST 7, HEAD and LEG_A children of the chest, LEG_B, TAIL, TAIL_TIP 8), pivots in `extras.rig`. Not wired yet:
the entry's `rig_notes` give the proposed `RIG` constants for the sentinel sit-up (sit 1.25, foreFold 2.2, pose
`[0.4, -0.3, 1.05, 0]`, drop 0.016 m), checked only by posing the GLB with the shader's math in Blender. The species is
in GBIF for all three tiles (8, 5 and 1 records) but not yet in `species_data.py` `SPECIES`, so no tile's
`species.json` lists it.

## Wild turkey (2026-10-26)

`client/assets/turkey.glb` (`tools/build_turkey.py`; entry `library/animals/meleagris_gallopavo.json`, brief
`drafts/meleagris_gallopavo.md`). No usable CC0 or CC BY mesh (Poly Pizza's CC BY 3.0 turkeys are a faceted strutting
tom and cartoons; Sketchfab's CC BY wild turkey is a flat museum skin), so it was generated with `latest`: the first
preview came back half strutting (fan up, wings drooped) despite "NOT strutting", but with the best head and neck; a
second preview framed as a field-guide foraging bird got the folded tail and wings but hunched the head into the breast;
a refine of the second (10 credits) gave the plumage pattern, too dark. 50 credits (balance 2,822 before this lane's
first job, 2,692 after the three lanes). The build grafts the first preview's head and neck (stretched to the alert
walk) onto the second's body, tilts the body 10 degrees nose-up, lengthens the tail to 0.31 m, adds procedural legs
(drumstick, pink-grey tarsus with a spur, toes), a beard and flush wing cards (bronze coverts, flight feathers barred
white, 1.27 m span), and samples the refine's texture per face, graded to bronze (hen in `_COLORB`). Scaled to 1.10 m
along the spine and 0.95 m to the top of the head (belly 0.35 m, back 0.71 m). Tiers 3,000 / 899 / 300 triangles (lod2
with a procedural neck and head); bird template: BODY, LEG_A/B (hip), TAIL, HEAD with the neck (neck base), WING_L/R and
HAND_L/R, pivots in `extras.rig`. Collapse decimation stalled at ~800 triangles on the generated body's non-manifold
seams (edges with three faces); deleting those faces and filling the holes fixed it, which may help other `latest`
meshes. Not wired; not in any tile's `species.json` or in `index.json` yet.

## Turkey, ground squirrel and fence lizard wired (2026-10-26)

In `animals.js` (slots 17-19: `TK`, `GS`, `LZ`), `animalModels.js`, `lineupAnimals.js`, `identify.js` and `fieldguide.js`.
`pipeline/species_data.py` lists all three (GBIF taxon keys 9606290, 8080937, 2451234; habitat, senses, perception,
calendar; the lizard is the first `reptile`), and the species step was re-run on the three tiles. GBIF records
(home 680_4280 / Placerville 690_4280 / Cosumnes 680_4270): wild turkey 271 / 332 / 37, ground squirrel 8 / 5 / 1,
fence lizard 37 / 21 / 8; each tile's `species.json`, prior and perception matrix carry them (raven, gray squirrel and
acorn woodpecker players perceive all three). Placement does not need a record: like every cell species it is habitat
suitability times the weak occurrence prior (0.6 where no one recorded it), as the hawk's territory cells are habitat
and chance alone. Until a tile's species step has run they are seen by everyone (`PENDING`).

- **Wild turkey** (`loadTurkeyMesh`, bird template, `RIG.turkey`: the quail's constants with amp `[0.55, 0.25, 0.9,
  1.0]` (a far peck on the long neck), collapse 1, bob 0.12, spread 0.5; aAnim2.w the hen colour set, hens drawn at
  0.8 scale): cap 90, tiers at 25 / 80 m. Oak woodland and savanna (`SUIT` times some tree cover, fewer under closed
  canopy), k 0.0014 per 30 m cell for a flock: about 38 flocks on the home tile (computed over its 110,889 cells with
  the prior), 6-15 birds, 60% hens. A flock forages in a loose 6 m spread (walks, pecks, scratches: a few kicks back,
  then a look down), and every 20-60 s walks on 15-40 m (strung out behind the lead) to the best of a few spots of open
  woodland within 150 m of home. Flush: a bird on the ground within 15 m of a raven or hawk player, 8 m of a squirrel,
  10 m of a woodpecker (12 m otherwise) sends the flock, staggered over 0.8 s, on a heavy flight (5 Hz beats on the
  climb, a glide on bowed wings, beats to land) to perches on the drawn wood (perch.js through `sqWood`: on top of a
  limb 3.5 cm or more thick, 3 m or more up, across it) of the oak 12-70 m off that lies most nearly away from the
  threat; down again after 25-60 s to the ground 12-27 m from the tree; wary for 60-120 s after. At dusk (sun under
  about 2 degrees) the flock flies up to a tall oak within 60 m, down at dawn; where the wood is not known (beyond the
  near set) a bird flies into the crown and is not drawn once there. Event `turkeyFlush` (sound.js plays the heavy flush on it).
- **California ground squirrel** (`loadGroundSquirrelMesh`, rodent template, `RIG.groundSquirrel` with the build
  lane's sit-up constants: sit 1.25, foreFold 2.2, spine 0.2, spinePhase 1.2, tipLag 0.6, tipWave 0.25, tipCurl 0.2,
  drop 0.016 m): cap 160, tiers 12 / 40 m, culled beyond 150 m of the eye, spawned within 220 m. Grassland and open
  savanna (`SUIT` times openness), k 0.012 per cell for a colony (about 270 colonies on the home tile in summer; none
  December to February: `SEASON` winter 0, now read with `??` so a 0 holds), 4-12 squirrels round 3-6 burrow mouths
  (one instanced draw: a dark hole in a 0.27 m ring of bare dirt, tilted to the slope). One sentinel at a time sits
  bolt upright (pose 1) at a burrow mouth for 15-60 s; the rest feed low, sit up now and then and move in short runs.
  A raven or hawk player within 25 m (3D, of the colony's 5 m spread), any other player within 10 m, an ambient hawk
  within 25 m, or night: all run for the nearest burrow (3.6 m/s) and vanish; 20-40 s after the threat has gone they
  come up one by one, sit at the mouth, and feed again. Event `gsAlarm`.
- **Western fence lizard** (`loadLizardMesh`, the new reptile template, `RIG.lizard`: amp.x 0.8, wave 0.024 m at the tail
  tip, waveK 5.03, envS 0.2, pushPitch 0.35, baskAbduct 0.5, squash 0.25, legLift 0.4, hindK 1.3, bend 0.05, flickYaw
  0.5, tipLag 0.6): cap 120, tiers 2 / 8 m, drawn and thought only within 25 m of the eye, spawned within 70 m.
  `REPTILE_BODY` in `animalModels.js` replaces the part code for `extras.rig.kind === 'reptile'` (material, shadow depth
  and planar shaders alike): the diagonal legs swing about the vertical and lift on the forward half, a lateral wave
  travels down the spine from each vertex's z (legs and head rigid at their pivot's offset and tangent), basking
  settles the body by the file's drop onto the belly, wider and flatter with the legs splayed, and the push-up pitches
  the fore body about the hip axis with the fore legs stretched to the ground, the trunk compressed sideways and the
  `_BLUE` patches pushed down, out and brightened (`REPTILE_COLOR`; aAnim2.w 0 mixes them to the female's
  `blue_off` / `throat_off`). Sites per cell (`lzSites`): the cell's biggest rocks from rocks.js's own cached plan
  (read only), an oak and a pine trunk, and the open ground beside one; one male at each with 0-2 females. Placed the
  first time it comes within 25 m of the eye (two per frame): on a rock, the highest of six downward rays on the
  rock's drawn close tier (its instance matrix and geometry) with the face normal for up; on a trunk, perch.js's bark
  (`nearOn`) at 0.2-1.5 m, belly to it, head up the stem (one in three down), so the instance takes a full orientation
  (pitch, yaw, roll from the surface basis); on the ground, the terrain's normal. Active March to October while the
  sun is up and the air is 15-34 C (`airTemp`: Placerville monthly normals, low at 6:00, high at 15:00; nothing else
  reads it); otherwise not drawn and not counted. Basks (longer in air under 24 C), sits alert with head flicks, turns
  on the spot curved into the turn, steps on a trunk or the ground; males push up every 10-30 s (3-8 bobs at 2 Hz). A
  player within 2 m: a 0.25-0.55 s dash at 2 m/s (up the trunk, away over the rock, or to its rock or tree) and it is
  gone for 30 s, back at its spot once the player is 3.5 m off.
- HUD "animals near" counts only those present (not down a burrow, in a crack, cold or hidden in a crown); tags skip
  hidden animals. Species cards: clicking one of the three (identify.js `pickAnimal`: a sphere per animal at least
  ~1.2 degrees across) shows its names, distance, what it is doing (`animals.activity`), the season's line and a field
  guide button; the field guide's card for each (what it is, who eats it here, when, and an invitation) also shows the
  first time the player is within 25 m of a turkey, 15 m of a ground squirrel or 3 m of a lizard. The month follows
  `?date=MM-DD` (it also sets the antler date). Procedural fallbacks `buildTurkey`, `buildGroundSquirrel`,
  `buildLizard` (the plain path: no spine wave or push-up); `?turkey=proc`, `?gsquirrel=proc`, `?lizard=proc`;
  `summon('turkey' | 'gsquirrel' | 'lizard', d)`. Lineup: rows for the three with their loaders; motions walk and
  flap / glide (turkey), walk, run and rest = sit-up (ground squirrel), walk, run = sprint, rest = bask, graze = head
  flicks and a new display = push-up (lizard); the second-colour box draws the hen and the female lizard.
- Verified on the home tile (2026-10-26, `?date=06-15`, 9:00): a summoned flock of 13 (6 hens) foraging in the
  savanna flushed from a squirrel player at 6 m and from the raven 12 m off, all 13 onto limbs of an oak 51 m off at
  3.2-8 m, and came down after the timer; the colony 65 m from the squirrel start (7 squirrels, 4 burrows, in open
  oak woodland) kept one sentinel upright, all dived within 1 s of the player coming to 12 m, and came up 22.6 s
  after it left; lizards resolved on an oak trunk (head up, belly to the bark), on a slate fin, push-ups on the
  trunk, a dash up 0.57 m and gone 30 s; with `?date=01-15` no lizards (4 C) and no ground squirrels. Cost at the raven's
  start view: `animals.update` 0.37 ms a frame in all (234 animals, 7 ground squirrels and 14 lizards live, all lizards
  culled from the air), the three species' own updates about 0.015 ms of it; the other tiles load with them, the
  woodpecker and squirrel players unaffected. Captures in the session scratchpad.
- Known: the lizard's wave is gentle at 0.024 m (the build's tail is a stretched copy and thin); its back reads pale
  from directly above in strong sun; a lizard on a rock sprinting moves on the rock's tangent plane, so on a curved top
  it can lift off it for the 0.3 s before it vanishes; the turkey's wing cards read edge-on from the side; a flushed
  flock's perches are often hidden by the crown's leaves (as real ones are); roosting birds beyond the near set are
  simply not drawn.
- Sounds (2026-10-26, `sound.js`, all synthesised; this replaces the "no sounds yet" above). Turkey: a flock foraging
  or walking within 40 m gives a contact call every 12-28 s from a random bird, a soft "putt" (1-3 notes, a sawtooth
  falling a fifth in 50-70 ms through 1.3 and 2.6 kHz formants with a noise click) or, one time in three, a purr (a
  420 Hz voiced tone chopped at 20-26 pulses a second for 0.6-1.3 s); March to May, from first light to two hours after
  sunrise (computed from the latitude and season as `sunDirection` does), a tom of a flock within 300 m gobbles every
  1-3 minutes (a ~1 s rattle: an 11-14 Hz pulse train on a voiced tone rising 330 -> 560 Hz and falling to 300, with
  warble, two formants and breath), and two times in five a tom of another flock within 600 m answers. `turkeyFlush`
  with an oak gives heavy wingbeats (one 5-6 Hz run of broadband thumps and feather hiss per bird, staggered as
  `tkToTree` sends them) and alarm putts from several birds; the near layer adds a few settling flaps (and the crown's
  leaves) as birds go from flight to perch, at most two per flush; with no oak the flock runs off putting. Ground
  squirrel: `gsAlarm` gives a 2-4 note whistle-chirp (a near-pure tone rising 4.3 -> 5.4 kHz and falling to 4.5 kHz,
  90-140 ms each) from the sentinel (the member that dived with no wait), then a soft scuffle when the first of the
  others reaches its burrow (no sooner than 0.6 s after); a colony feeding within 50 m chirps softly now and then.
  Fence lizard: a dash (`L_SPRINT`, or a hide that came between ticks) within 6 m of the listener gives a 0.1-0.2 s dry
  scuttle of claw clicks (noise high-passed at 24 dB/octave, sharper on rock, duller on bark), refDistance 2.5 m;
  nothing else. All of these use the near layer's slots, cooldowns and log (HUD labels "wild turkey", "ground
  squirrel", "fence lizard"); the player cannot be these species, so C gives none of them.

## The skin path: the deer from its own clips (2026-10-27)

Decision log, 2026-10-27 ("the deer is skinned and clip-animated on the GPU"). A species whose adopted GLB keeps its
source's skin (`JOINTS_0` / `WEIGHTS_0`, the skin's joint order and the build's frame in `extras.skin`) and has a baked
clip set beside it is drawn skinned instead of by the part rig, still one InstancedMesh and one draw call a tier.

- **Bake:** `.venv/bin/python tools/bake_clips.py <source.glb> client/assets/<name>_clips --fit client/assets/<name>.glb
  --recipe library/animals/clips/<species>.json [--rate 30] [--f32]`. The recipe lists the clips to bake (loop; `gait`
  with the hoof joint to measure the stride and touchdown; an optional `stride_m` override) and synthetic one-frame poses
  (a frame of a clip with joints aimed or rotated about their heads and every joint moved by `root`). Output: the texture
  (`.bin`, RGBA16F, joints x 3 texels wide, one row a frame) and the index (`.json`: rate, size, joints, scale and offset
  of the frame, per clip first / count / loop / duration / root_motion / stride_m / touchdown / speed_mps). The tool
  prints each clip's numbers and a synthetic pose's hoof heads and lowest joint so a recipe can be tuned blind, then
  checked in the game.
- **Build:** `tools/build_deer.py` (doe and buck) writes the skin attributes; a build script for another skinned source
  does the same (the four heaviest groups, normalised, in the source skin's joint order, read from the GLB's JSON).
- **Client:** `animalModels.js` `loadTiers(url, model, { skin: true })` loads the clip set named by `extras.skin.clips`
  (shared between models of one skeleton; the buck scales the translation column by its size over the texture's) and
  sets `model.skin` and `drop` 0; a missing clip set leaves the part rig. `animalMaterial`, `animalDepthMaterial` and
  `planarShadowMaterial` swap in the skin body and declare only its attributes (Metal has 16 vertex attribute slots).
  The third per-instance vec4 `aClip` = (clip, phase 0..1, blend-to clip + its phase in the fraction, blend weight) is
  written by `driveClips(skin, DEER_DRIVE, state, speed, pose, flick, dt, out, slot)` from the part rig's values, in
  `animals.js` update (per deer and buck; `a.spd` is the AI's speed) and `groundControl.js` draw (the player). Gait clips
  advance by distance over the clip's stride (planted hooves), loops on the clock from a seed; a change blends over
  0.3-1.0 s. `__weDeerDrive.force = 'bed' | 'walk' | 'run' | 'graze' | 'idle' | 'alert'` holds every deer in one clip for
  checking; `__weDeerDrive` also holds the thresholds and rates.
- **Deer clips** (`client/assets/deer_clips.json`, 138 x 531, 586 KB): Idle, Idle_2, Idle_Headlow (100 frames each),
  Eating (180), Walk (35; stride 0.65 m, left fore touchdown at 0.4, authored at 0.56 m/s), Gallop (15; stride set to
  3 m), bed (1, synthetic). Open: no trot clip (the Walk hurries, capped at 2.6 Hz), no eared alert pose, the lineup page
  shows the first frame only.


## What the animals eat and hide in (2026-10-29)

The plant records carry the animals (`library/species/<id>.json` `relations`: `eaten_by` [{animal, part, seasons}],
`cover_for` [animal ids]; the schema in `docs/species-library.md`, "Grasses, herbs and shrubs of the foothill
understory"), so the food web is written once, on the plant's side, and `pipeline/games.py` turns it into each
tile's `games.json` `relations.forage` ([animal, plant, part, resource, seasons]: a grass's or herb's leaves, seeds,
flowers, bulbs and roots are the grass_forbs resource, a shrub's leaves, flowers and berries browse, acorns
acorn_mast) and `relations.cover`, and lists each gather game's `plants`. On the home tile: 187 forage relations.
A deer browses buckbrush, deerbrush, mountain mahogany, toyon, coffeeberry, redbud, wild rose, snowberry, poison
oak, elderberry, monkeyflower and the manzanitas, and grazes the grasses, filaree, clover, vetch, miner's lettuce,
mule's ears and the poppy in spring; the brush rabbit and the jackrabbit graze filaree, clover, vetch, the annual
grasses and needlegrass and hide in buckbrush, coyote brush, poison oak, toyon, wild rose and snowberry; the vole
grazes the grasses, filaree, popcorn flower and clover and digs blue dicks; the ground squirrel takes the grass
seed, filaree, clover and the corms; the quail take seed of the grasses, filaree, lupine, fiddleneck, popcorn
flower and madia and the berries of toyon, snowberry, coffeeberry, elderberry and poison oak, and hide in
buckbrush, coyote brush, toyon, wild rose and the tall grasses; the turkey the acorns, the grass seed, poison
oak's and elderberry's berries. The client reads it in `needs.js` (the plant under a feeding body is named: "blue
dicks here: hold E") and `identify.js` (every plant card's "eaten by" and "shelter for" lines).
