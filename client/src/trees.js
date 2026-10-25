// Trees are grown from species parameter files (library/species/<id>.json) by treegen.js, a
// Weber & Penn style generator; see docs/species-library.md. This module keeps the original
// interface: SPECIES[id] with .deciduous and .shrub, buildTree(id, seed) -> { trunk, canopy, height, stem },
// mulberry32. The old short ids (blue_oak, live_oak, gray_pine, ponderosa, manzanita, chamise) stay as
// aliases of the canonical scientific-name ids, and so are the riparian trees added on 2026-10-25: willow
// (salix_lasiolepis), alder (alnus_rhombifolia) and cottonwood (populus_fremontii), the names the
// species-mix rows use. Aliases come from each species file's `aliases`.

import { LIBRARY, ALIASES, buildTree, mulberry32, resolveSpecies } from './treegen.js';

export const SPECIES = {};
for (const [id, s] of Object.entries(LIBRARY)) SPECIES[id] = s;
for (const [alias, id] of Object.entries(ALIASES)) SPECIES[alias] = LIBRARY[id];

export const SPECIES_IDS = Object.keys(LIBRARY);   // canonical ids only (no aliases)

export { buildTree, mulberry32, resolveSpecies };
