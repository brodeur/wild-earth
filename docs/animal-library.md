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
  gray fox, coyote) or the rig path when the tail has a TAIL_TIP (mountain lion). `aAnim2.w` is a gait selector:
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
