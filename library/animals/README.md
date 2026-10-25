# Animal mesh library

Plants are grown from parameter files (`library/species/`); animals are curated meshes, one per
species (decision log, 2026-10-25: a tile holds a dozen animal species, so a reviewed mesh per
species is sound where an algorithm per morphology is not). This folder records, for every
species, which mesh the client draws, where it came from, under what licence, and whether a local
naturalist has signed it off. The pipeline around it is in
[docs/animal-library.md](../../docs/animal-library.md).

Files:

- `index.json`: the species ids in the library.
- `<species_id>.json`: one entry per species (below).
- `jobs/<species_id>/<job_id>/`: raw generation output from `tools/meshy_generate.py`
  (GLB, textures, thumbnail, `job.json`). Only `job.json` is tracked by git (`jobs/.gitignore`);
  the meshes stay local until a build script adopts them.
- Adopted tiers live in `client/assets/<name>.glb`, written by a build script in `tools/`
  (`tools/build_deer.py` is the model), never by hand.

## Entry schema

Units are metres. Ids follow the plant library: the lowercase scientific name with underscores,
the same code tiles use in `species/species.json` (`corvus_corax`). A subspecies goes in
`scientific`, not in the id, so a tile's GBIF species resolves to it.

| field | meaning |
|---|---|
| `id` | `genus_species`, matching `species.json` `code` |
| `aliases` | short or older ids that resolve here (`raven`, `black_tailed_deer`) |
| `scientific`, `common` | names as shown on the lineup; `scientific` may name the subspecies drawn |
| `body_plan` | `quadruped`, `bird`, `rodent`, `snake` or `other`. Picks the rig template (below) |
| `size` | `length_m` (nose or bill tip to tail tip; for a quadruped, head and body), `shoulder_or_wingspan_m` (shoulder height for quadrupeds and rodents, wingspan for birds), `note` with the range and what the build script scales to |
| `source` | where the mesh came from: `kind` (`meshy`, `cc0_download` or `contributor`), `title`, `author`, `url`, `file`, `original` (what the source file is), `prompt` or `reference_image` (for generated meshes), `job_id` (Meshy task id), `date`, `adopted_by` (the build script) |
| `license` | the mesh's licence (`CC0 1.0`, `CC BY 4.0`, or `CC BY-SA 4.0` for generated or contributed meshes the project owns or is given) |
| `license_detail` | `source_terms` (the clause or page the licence rests on, with its URL), `redistribute_under_cc_by_sa` (true or false: may the adopted tiers ship with the project's CC BY-SA asset licence), `note` |
| `tiers` | triangle counts of the adopted tiers (`lod0`, `lod1`, `lod2`, or `player`), the `file`, and the vertex `attributes` the client reads |
| `rig` | how the client poses it (the procedural part rig, or a skinned clip set) |
| `candidates` | optional: meshes under review that are not adopted yet (a Meshy job, a download), each with its own source, licence, cost and review notes |
| `status` | `agent draft, needs local sign-off` until a local naturalist signs it off |
| `accuracy_notes` | what was checked against the species here and what is still wrong, in your own words |
| `authors`, `sources` | contributors and model authors; references read (never paste text from them) |

The entry itself is CC BY-SA 4.0 like the plant files.

## What the client expects from an adopted GLB

From `client/src/animalModels.js` (`loadDeerMesh`):

- Meshes named `lod0`, `lod1`, `lod2`, one primitive each, indexed triangles.
- `POSITION` in metres, +y up, +z forward, +x the animal's left, origin where it stands.
- `COLOR_0` (linear RGB), or a texture the loader then has to wire up (the deer uses vertex colour
  only; the flying raven uses one base-colour texture).
- Custom attributes `_PART` (the rig part: `BODY 0, LEG_A 1, LEG_B 2, TAIL 3, WING_L 4, WING_R 5,
  HEAD 6`), `_PARTW` (that part's weight, 0-1) and `_PIVOT` (the joint it turns about). The vertex
  shader poses every instance from four floats (phase, gait, pose, flick); there is no skeleton.
- Budgets: about 2,000 / 1,000 / 300 triangles for herd animals; small birds and rodents less.

## Body-plan rig templates

A build script assigns `_PART` and `_PIVOT` from the template for the body plan:

| body plan | parts | notes |
|---|---|---|
| quadruped | body, legs A (left fore, right hind) and B, tail, head | the deer: thigh stays with the body, legs pivot at stifle and elbow |
| bird | body, legs A/B, tail, head, wings L/R | a standing bird's folded wings can tuck (pose) but cannot open into flight: a flying bird needs its own spread-wing mesh or a skinned clip set (the player raven) |
| rodent | body, legs A (fore pair) and B (hind pair), tail, head | bounding gait, tail curl on pose (squirrel) |
| snake | body only for now | needs a spine-wave template |
| other | per species | |

## Adding a species

1. Look for a CC0 or CC BY mesh first (Quaternius, Poly Pizza, OpenGameArt, Poly Haven, Kenney).
   No account creation, no paid models without the owner's say.
2. If there is none, a maintainer generates one: `python3 tools/meshy_generate.py pricing`, then
   `generate --mode preview` (5 credits on `meshy-6-lite`), review, and only then a refine or an
   image-to-3D job.
3. Write `<species_id>.json` with the source and licence; add the id to `index.json`.
4. Write `tools/build_<name>.py` that scales to `size`, recolours to the local animal, decimates to
   the tiers, and writes `_PART/_PARTW/_PIVOT` for the body plan.
5. Review on the animal lineup page (planned, see docs/animal-library.md) and in the world; a local naturalist signs off in `authors` with
   "reviewed" and the date.
