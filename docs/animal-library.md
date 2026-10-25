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
`?<name>=proc` (`deer`, `squirrel`, `quail`, `jay`; `animals` for all) draws the procedural one for A/B.

## Lineup page

`client/lineup_animals.html` (`client/src/lineupAnimals.js`) is the sign-off page, the animals' counterpart of
`client/lineup.html`. One row per species in `index.json` plus every species with a drawn mesh (the buck has its
own row): the drawn GLB on the left and the procedural model on the right, at true size beside a 1 m pole and
ground bar in 10 cm bands, under the game's atmosphere (sun, sky light, exposure; cloud shadow off) for any
season and hour. The camera stands a fixed 5.5 m off so sizes compare between rows; "zoom to fit" frames each row
instead, "three-quarter" and "from above" turn it, and dragging a view turns that row. Switches: tier (lod0-2),
pose or motion (idle, walk / bound / hop, graze / tail flick / peck, bedded / sit up / perched, flap, glide,
climb), written to the same `aAnim` / `aAnim2` attributes `animals.js` writes; a motion the body plan lacks
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

## Next (adoption lane)

1. `tools/build_raven_ground.py` on the deer model: scale to 0.62 m bill to tail, weld, decimate to
   three tiers, colour (black, a slightly browner worn wing, black bill and legs), assign the bird
   template's parts (head and neck, legs A/B, tail; folded wings as body or as a small "tuck" part)
   and pivots, and carry over any Meshy identifiers.
2. Decide the raven's runtime: the flying player keeps the skinned CC0 model; the ground and
   perched raven (acorn game, ambient) uses the new mesh, with a swap on landing and take-off.
3. The animal lineup page and the GBIF gap report in the tile build.
